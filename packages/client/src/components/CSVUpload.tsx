import { useState, useRef, useEffect, useCallback, lazy, Suspense, Component, type ReactNode } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { TTS_LANGUAGES, TTS_ACCENTS } from '@libresrs/shared';

// Carries the conjugation engine: loaded only when a deck is open.
const ConjugationSettings = lazy(() => import('./conjugation/ConjugationSettings'));

/**
 * Keeps a Conjugation section that fails (its chunk renamed by a deploy while
 * the page was open) from taking the whole Admin page down with it.
 */
class ConjugationBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const MAX_CSV_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_ANKI_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_CSV_UPLOAD_MB = Math.floor(MAX_CSV_UPLOAD_BYTES / (1024 * 1024));
const MAX_ANKI_UPLOAD_MB = Math.floor(MAX_ANKI_UPLOAD_BYTES / (1024 * 1024));
type ImportType = 'csv' | 'anki';
type ImportStage = 'reading' | 'encoding' | 'uploading' | 'previewing';

type ImportProgress = {
  type: ImportType;
  stage: ImportStage;
  percent: number | null;
};

type AnkiFieldInfo = { name: string; index: number; sample: string };

type AnkiPreview = {
  apkgBase64: string;
  fields: AnkiFieldInfo[];
  noteCount: number;
  frontFieldIndex: number;
  backFieldIndex: number;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export default function CSVUpload({ initialDeckId = null, onConjugationDirtyChange }: {
  /** The deck to open first: a link to it (?tab=decks&deck=5, from a group's Assigned Decks). */
  initialDeckId?: number | null;
  /** Told whenever the open deck's Conjugation draft gains or loses unsaved changes, so the page can guard leaving. */
  onConjugationDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const { t } = useI18n();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDescription, setNewDeckDescription] = useState('');
  const [newDeckSourceLang, setNewDeckSourceLang] = useState('');
  const [newDeckTargetLang, setNewDeckTargetLang] = useState('');
  const [newDeckSourceAccent, setNewDeckSourceAccent] = useState('');
  const [newDeckTargetAccent, setNewDeckTargetAccent] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(initialDeckId);
  /** The deck a link opened, whose name takes focus once it is on screen (the link it came from is gone). */
  const [focusDeckId, setFocusDeckId] = useState<number | null>(initialDeckId);
  const deckHeadingRef = useRef<HTMLHeadingElement>(null);
  // Whether the open deck's Conjugation section holds unsaved edits (switching decks drops them).
  const conjugationDirty = useRef(false);
  // Read through a ref so the callback handed down stays the same across renders.
  const onDirtyChangeRef = useRef(onConjugationDirtyChange);
  onDirtyChangeRef.current = onConjugationDirtyChange;
  const onConjugationDirty = useCallback((dirty: boolean) => {
    conjugationDirty.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, []);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [ankiPreview, setAnkiPreview] = useState<AnkiPreview | null>(null);
  const [scanningDeckId, setScanningDeckId] = useState<number | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const ankiFileInputRef = useRef<HTMLInputElement>(null);
  const [csvDragActive, setCsvDragActive] = useState(false);
  const [ankiDragActive, setAnkiDragActive] = useState(false);

  const { data: decks, refetch: refetchDecks } = trpc.admin.getDecks.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const { data: deckGroups, refetch: refetchDeckGroups } = trpc.admin.getDeckGroups.useQuery(
    { deckId: selectedDeckId! },
    { enabled: selectedDeckId !== null }
  );

  const createDeck = trpc.admin.createDeck.useMutation({
    onSuccess: () => {
      refetchDecks();
      setShowCreateForm(false);
      setNewDeckName('');
      setNewDeckDescription('');
      setNewDeckSourceLang('');
      setNewDeckTargetLang('');
      setNewDeckSourceAccent('');
      setNewDeckTargetAccent('');
    },
  });

  const deleteDeck = trpc.admin.deleteDeck.useMutation({
    onSuccess: () => {
      refetchDecks();
      setSelectedDeckId(null);
    },
  });

  const [resetTarget, setResetTarget] = useState<string>('');
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const usersQuery = trpc.admin.getUsers.useQuery();
  const resetProgress = trpc.admin.resetDeckProgress.useMutation({
    onSuccess: (r) => {
      setResetStatus(`Reset ${r.cardStatesCleared} card state(s) and ${r.reviewLogsCleared} review(s).`);
    },
    onError: (e) => setResetStatus(e.message || 'Reset failed.'),
  });
  const updateDeck = trpc.admin.updateDeck.useMutation({
    onSuccess: () => {
      refetchDecks();
    },
  });

  const uploadCards = trpc.admin.uploadCards.useMutation({
    onSuccess: (result) => {
      setImportProgress(null);
      refetchDecks();
      if (result.success) {
        setUploadStatus({
          success: true,
          message: `Successfully added ${result.cardsAdded} cards${
            result.errors.length > 0 ? ` (${result.errors.length} errors)` : ''
          }`,
        });
      } else {
        setUploadStatus({
          success: false,
          message: `Upload failed: ${result.errors.join(', ') || 'No cards were imported.'}`,
        });
      }
    },
    onError: (error) => {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: `Error: ${error.message}`,
      });
    },
  });

  const previewAnkiDeck = trpc.admin.previewAnkiDeck.useMutation();

  const uploadAnkiDeck = trpc.admin.uploadAnkiDeck.useMutation({
    onSuccess: (result) => {
      setImportProgress(null);
      refetchDecks();

      const warningPart = result.warnings.length > 0
        ? ` Warnings: ${result.warnings.join(' ')}`
        : '';

      if (result.success) {
        setUploadStatus({
          success: true,
          message: `Successfully added ${result.cardsAdded} cards from Anki deck${
            result.errors.length > 0 ? ` (${result.errors.length} errors)` : ''
          }.${warningPart}`,
        });
      } else {
        setUploadStatus({
          success: false,
          message: `Anki import failed: ${result.errors.join(', ') || 'No cards were imported.'}.${warningPart}`,
        });
      }
    },
    onError: (error) => {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: `Error: ${error.message}`,
      });
    },
  });

  const assignDeckToGroup = trpc.admin.assignDeckToGroup.useMutation({
    onSuccess: () => refetchDeckGroups(),
  });

  const removeDeckFromGroup = trpc.admin.removeDeckFromGroup.useMutation({
    onSuccess: () => refetchDeckGroups(),
  });

  const regenerateAssets = trpc.ai.regenerateDeckAssets.useMutation({
    onSuccess: (_, variables) => {
      setScanningDeckId(variables.deckId);
    },
  });

  const scanProgressQuery = trpc.ai.getScanProgress.useQuery(
    { deckId: scanningDeckId! },
    {
      enabled: scanningDeckId !== null,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === 'done' || status === 'failed') return false;
        return 1000;
      },
    }
  );

  useEffect(() => {
    if (scanProgressQuery.data?.status === 'done' || scanProgressQuery.data?.status === 'failed') {
      const timer = setTimeout(() => setScanningDeckId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [scanProgressQuery.data?.status]);

  const selectedDeck = decks?.find((d) => d.id === selectedDeckId);
  const shownDeckId = selectedDeck?.id ?? null;
  useEffect(() => {
    if (focusDeckId === null || shownDeckId !== focusDeckId) return;
    deckHeadingRef.current?.focus();
    setFocusDeckId(null);
  }, [focusDeckId, shownDeckId]);
  const assignedGroupIds = new Set(deckGroups?.map((g) => g.id) ?? []);

  const processCsvFile = (file: File) => {
    if (!selectedDeckId) return;

    if (file.size > MAX_CSV_UPLOAD_BYTES) {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: `CSV file is too large. Maximum size is ${MAX_CSV_UPLOAD_MB} MB.`,
      });
      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = '';
      }
      return;
    }

    const reader = new FileReader();
    setUploadStatus(null);
    setImportProgress({ type: 'csv', stage: 'reading', percent: 0 });
    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setImportProgress({ type: 'csv', stage: 'reading', percent });
    };
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== 'string') {
        setImportProgress(null);
        setUploadStatus({
          success: false,
          message: 'Failed to read CSV file.',
        });
        return;
      }
      setImportProgress({ type: 'csv', stage: 'uploading', percent: null });
      uploadCards.mutate({ deckId: selectedDeckId, csvContent: content });
    };
    reader.onerror = () => {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: 'Failed to read CSV file.',
      });
    };
    reader.readAsText(file);

    if (csvFileInputRef.current) {
      csvFileInputRef.current.value = '';
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processCsvFile(file);
  };

  const processAnkiFile = (file: File) => {
    if (!selectedDeckId) return;

    if (file.size > MAX_ANKI_UPLOAD_BYTES) {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: `Anki deck is too large. Maximum size is ${MAX_ANKI_UPLOAD_MB} MB.`,
      });
      if (ankiFileInputRef.current) {
        ankiFileInputRef.current.value = '';
      }
      return;
    }

    const reader = new FileReader();
    setUploadStatus(null);
    setImportProgress({ type: 'anki', stage: 'reading', percent: 0 });
    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setImportProgress({ type: 'anki', stage: 'reading', percent });
    };
    reader.onload = (event) => {
      const content = event.target?.result;
      if (!(content instanceof ArrayBuffer)) {
        setImportProgress(null);
        setUploadStatus({
          success: false,
          message: 'Failed to read Anki deck file.',
        });
        return;
      }

      setImportProgress({ type: 'anki', stage: 'encoding', percent: null });
      setTimeout(async () => {
        try {
          const apkgBase64 = arrayBufferToBase64(content);
          setImportProgress({ type: 'anki', stage: 'previewing', percent: null });
          const preview = await previewAnkiDeck.mutateAsync({ apkgBase64 });
          setImportProgress(null);
          if (preview.fields.length >= 2) {
            setAnkiPreview({
              apkgBase64,
              fields: preview.fields,
              noteCount: preview.noteCount,
              frontFieldIndex: 0,
              backFieldIndex: 1,
            });
          } else {
            // No field info available, import with defaults
            setImportProgress({ type: 'anki', stage: 'uploading', percent: null });
            uploadAnkiDeck.mutate({ deckId: selectedDeckId, apkgBase64 });
          }
        } catch {
          setImportProgress(null);
          setUploadStatus({
            success: false,
            message: 'Failed to process Anki deck file.',
          });
        }
      }, 0);
    };
    reader.onerror = () => {
      setImportProgress(null);
      setUploadStatus({
        success: false,
        message: 'Failed to read Anki deck file.',
      });
    };
    reader.readAsArrayBuffer(file);

    if (ankiFileInputRef.current) {
      ankiFileInputRef.current.value = '';
    }
  };

  const handleAnkiFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processAnkiFile(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('Decks')}</h2>
            <button
              onClick={() => setShowCreateForm(true)}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
            >
              {t('+ New Deck')}
            </button>
          </div>

          {showCreateForm && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <input
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder={t('Deck name')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
              <textarea
                value={newDeckDescription}
                onChange={(e) => setNewDeckDescription(e.target.value)}
                placeholder={t('Description (optional)')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                rows={2}
              />
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select
                  value={newDeckSourceLang}
                  onChange={(e) => setNewDeckSourceLang(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">{t('Col 1 Language')}</option>
                  {TTS_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <select
                  value={newDeckTargetLang}
                  onChange={(e) => setNewDeckTargetLang(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">{t('Col 2 Language')}</option>
                  {TTS_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select
                  value={newDeckSourceAccent}
                  onChange={(e) => setNewDeckSourceAccent(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">{t('Col 1 Accent')}</option>
                  {TTS_ACCENTS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <select
                  value={newDeckTargetAccent}
                  onChange={(e) => setNewDeckTargetAccent(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">{t('Col 2 Accent')}</option>
                  {TTS_ACCENTS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => createDeck.mutate({
                    name: newDeckName,
                    description: newDeckDescription,
                    sourceLanguage: newDeckSourceLang || undefined,
                    targetLanguage: newDeckTargetLang || undefined,
                    sourceAccent: newDeckSourceAccent || undefined,
                    targetAccent: newDeckTargetAccent || undefined,
                  })}
                  disabled={!newDeckName.trim()}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {t('Create')}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {decks?.map((deck) => (
              <button
                key={deck.id}
                onClick={() => {
                  if (
                    deck.id !== selectedDeckId
                    && conjugationDirty.current
                    && !window.confirm(t('Switch decks? Your unsaved Conjugation changes will be lost.'))
                  ) return;
                  if (deck.id !== selectedDeckId) conjugationDirty.current = false;
                  setSelectedDeckId(deck.id);
                  setUploadStatus(null);
                }}
                className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  selectedDeckId === deck.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{deck.name}</div>
                {/* Darker than the usual grey: it has to hold 4.5:1 on the selected row's blue-50 too. */}
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {t('{{count}} cards', { count: deck.cardCount })}
                  {deck.reversible && ` (${t('{{count}} to learn', { count: deck.cardCount * 2 })})`}
                </div>
              </button>
            ))}
            {(!decks || decks.length === 0) && (
              <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">{t('No decks yet')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        {selectedDeck ? (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2
                    ref={deckHeadingRef}
                    tabIndex={-1}
                    className="text-xl font-semibold text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    {selectedDeck.name}
                  </h2>
                  {selectedDeck.description && (
                    <p className="text-gray-600 dark:text-gray-400 mt-1">{selectedDeck.description}</p>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t('{{count}} cards', { count: selectedDeck.cardCount })}
                    {selectedDeck.reversible && ` (${t('{{count}} to learn', { count: selectedDeck.cardCount * 2 })})`}
                  </p>
                </div>
                <div className="flex gap-3">
                  <ExportDeckButton deckId={selectedDeck.id} deckName={selectedDeck.name} />
                  <button
                    onClick={() => {
                      if (confirm(t('Are you sure you want to delete this deck?'))) {
                        deleteDeck.mutate({ id: selectedDeck.id });
                      }
                    }}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                  >
                    {t('Delete Deck')}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{t('Reversible')}</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('Study cards in both directions (front→back and back→front)')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!selectedDeck.reversible}
                  aria-label={t('Reversible')}
                  onClick={() =>
                    updateDeck.mutate({
                      id: selectedDeck.id,
                      reversible: !selectedDeck.reversible,
                    })
                  }
                  disabled={updateDeck.isPending}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    selectedDeck.reversible ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  } ${updateDeck.isPending ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      selectedDeck.reversible ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Col 1 Language (front)')}</span>
                <select
                  aria-label={t('Col 1 Language (front)')}
                  value={selectedDeck.sourceLanguage ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    updateDeck.mutate({ id: selectedDeck.id, sourceLanguage: val });
                  }}
                  className="w-40 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">—</option>
                  {TTS_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Col 2 Language (back)')}</span>
                <select
                  aria-label={t('Col 2 Language (back)')}
                  value={selectedDeck.targetLanguage ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    updateDeck.mutate({ id: selectedDeck.id, targetLanguage: val });
                  }}
                  className="w-40 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">—</option>
                  {TTS_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Col 1 Accent (front)')}</span>
                <select
                  aria-label={t('Col 1 Accent (front)')}
                  value={selectedDeck.sourceAccent ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    updateDeck.mutate({ id: selectedDeck.id, sourceAccent: val });
                  }}
                  className="w-48 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">—</option>
                  {TTS_ACCENTS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Col 2 Accent (back)')}</span>
                <select
                  aria-label={t('Col 2 Accent (back)')}
                  value={selectedDeck.targetAccent ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    updateDeck.mutate({ id: selectedDeck.id, targetAccent: val });
                  }}
                  className="w-48 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">—</option>
                  {TTS_ACCENTS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div className="py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Generate audio for')}</span>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  {t('Turn off a side to skip generating its audio — its play button disappears too.')}
                </p>
                {([
                  { key: 'audioFrontEnabled' as const, label: t('Col 1 (front)'), on: selectedDeck.audioFrontEnabled ?? true },
                  { key: 'audioBackEnabled' as const, label: t('Col 2 (back)'), on: selectedDeck.audioBackEnabled ?? true },
                ]).map((row) => (
                  <label key={row.key} className="flex items-center gap-2 py-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.on}
                      onChange={(e) => {
                        updateDeck.mutate({ id: selectedDeck.id, [row.key]: e.target.checked });
                      }}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    {row.label}
                  </label>
                ))}
              </div>

              <div className="py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-900 dark:text-gray-100">{t('Reset study progress')}</span>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  {t('Makes this deck brand new again — clears scheduling and review history. Cards and audio are kept.')}
                </p>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={t('Reset study progress')}
                    value={resetTarget}
                    onChange={(e) => { setResetTarget(e.target.value); setResetStatus(null); }}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                  >
                    <option value="">{t('Everyone')}</option>
                    {usersQuery.data?.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const who = resetTarget
                        ? usersQuery.data?.find((u) => String(u.id) === resetTarget)?.name ?? t('this student')
                        : t('EVERYONE');
                      if (!window.confirm(t('Reset progress on “{{deck}}” for {{who}}? Review history will be deleted.', { deck: selectedDeck.name, who }))) return;
                      setResetStatus(null);
                      resetProgress.mutate({
                        deckId: selectedDeck.id,
                        ...(resetTarget ? { userId: Number(resetTarget) } : {}),
                      });
                    }}
                    disabled={resetProgress.isPending}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {resetProgress.isPending ? t('Resetting…') : t('Reset')}
                  </button>
                </div>
                {resetStatus && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{resetStatus}</p>
                )}
              </div>

              <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{t('AI Assets')}</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('Regenerate pronunciation and images')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (confirm(t('Regenerate all AI assets for this deck? This may take a while.'))) {
                      regenerateAssets.mutate({ deckId: selectedDeck.id, assetTypes: ['audio', 'image'] });
                    }
                  }}
                  disabled={regenerateAssets.isPending}
                  className="px-3 py-1 bg-orange-700 text-white rounded-lg text-sm hover:bg-orange-800 disabled:opacity-50"
                >
                  {regenerateAssets.isPending ? t('Regenerating...') : t('Regenerate All')}
                </button>
              </div>
              {scanningDeckId !== null && scanProgressQuery.data && (
                <div className="pb-3">
                  {scanProgressQuery.data.status === 'scanning' ? (
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span>{t('Generating AI assets...')}</span>
                        <span>{scanProgressQuery.data.processed} / {scanProgressQuery.data.total}</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: scanProgressQuery.data.total > 0
                              ? `${Math.round((scanProgressQuery.data.processed / scanProgressQuery.data.total) * 100)}%`
                              : '0%'
                          }}
                        />
                      </div>
                    </div>
                  ) : scanProgressQuery.data.status === 'done' ? (
                    <div className="text-sm text-green-700 dark:text-green-400">{t('AI assets generated.')}</div>
                  ) : (
                    <div className="text-sm text-red-600 dark:text-red-400">{t('AI generation encountered errors.')}</div>
                  )}
                </div>
              )}
              {!scanningDeckId && regenerateAssets.isSuccess && (
                <div className="text-sm text-green-700 dark:text-green-400 pb-2">
                  {t('Regeneration started in background.')}
                </div>
              )}
            </div>

            <ConjugationBoundary
              fallback={(
                <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-sm text-gray-700 dark:text-gray-300">
                  {t('The Conjugation section could not load. Reload the page to see it.')}{' '}
                  <button type="button" onClick={() => window.location.reload()} className="text-blue-600 dark:text-blue-400 underline">
                    {t('Reload')}
                  </button>
                </div>
              )}
            >
              <Suspense fallback={null}>
                <ConjugationSettings
                  key={selectedDeck.id}
                  deckId={selectedDeck.id}
                  cardCount={selectedDeck.cardCount}
                  onDirtyChange={onConjugationDirty}
                />
              </Suspense>
            </ConjugationBoundary>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Import Cards')}</h3>

              <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Upload Cards (CSV)')}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('CSV file should have front and back columns. HTML formatting is supported (bold, italic, underline, colors, images, and audio).')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t('Maximum file size: 100 MB.')}
              </p>

              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${csvDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600'}`}
                onDragOver={(e) => { e.preventDefault(); setCsvDragActive(true); }}
                onDragEnter={(e) => { e.preventDefault(); setCsvDragActive(true); }}
                onDragLeave={() => setCsvDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setCsvDragActive(false);
                  const file = e.dataTransfer.files[0];
                  if (file) processCsvFile(file);
                }}
              >
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                  id="csv-upload"
                />
                <label
                  htmlFor="csv-upload"
                  className="cursor-pointer inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {uploadCards.isPending ? t('Uploading...') : t('Choose CSV File')}
                </label>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{t('or drag and drop')}</p>
              </div>
              {importProgress?.type === 'csv' && (
                <div className="mt-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {importProgress.stage === 'reading'
                      ? t('Reading file... {{percent}}%', { percent: importProgress.percent ?? 0 })
                      : t('Uploading and importing...')}
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                    {importProgress.percent === null ? (
                      <div className="h-full w-1/3 animate-pulse bg-blue-600 dark:bg-blue-500" />
                    ) : (
                      <div
                        className="h-full bg-blue-600 transition-all duration-150 dark:bg-blue-500"
                        style={{ width: `${Math.max(2, importProgress.percent)}%` }}
                      />
                    )}
                  </div>
                </div>
              )}

              <h4 className="font-medium text-gray-900 dark:text-gray-100 mt-6 mb-2">{t('Import Anki Deck (.apkg)')}</h4>
              <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 mb-4">
                {t('Only front/back text and supported HTML are imported. Card templates, scheduling, tags, media attachments, audio references, cloze behavior, and extra note fields are stripped.')}
              </p>

              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${ankiDragActive ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-300 dark:border-gray-600'}`}
                onDragOver={(e) => { e.preventDefault(); setAnkiDragActive(true); }}
                onDragEnter={(e) => { e.preventDefault(); setAnkiDragActive(true); }}
                onDragLeave={() => setAnkiDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setAnkiDragActive(false);
                  const file = e.dataTransfer.files[0];
                  if (file) processAnkiFile(file);
                }}
              >
                <input
                  ref={ankiFileInputRef}
                  type="file"
                  accept=".apkg,application/zip"
                  onChange={handleAnkiFileUpload}
                  className="hidden"
                  id="anki-upload"
                />
                <label
                  htmlFor="anki-upload"
                  className="cursor-pointer inline-block px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800 transition-colors"
                >
                  {uploadAnkiDeck.isPending ? t('Importing...') : t('Choose Anki Deck')}
                </label>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{t('or drag and drop')}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Supported file: .apkg')}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Maximum file size: 100 MB.')}</p>
              </div>
              {ankiPreview && selectedDeckId && (
                <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <h5 className="font-medium text-amber-900 dark:text-amber-200 mb-2">
                    {t('Map Anki Fields')} ({ankiPreview.noteCount.toLocaleString()} {t('notes')})
                  </h5>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                    {t('Select which field maps to the front (question) and back (answer) of each card.')}
                  </p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">{t('Front (question)')}</label>
                      <select
                        value={ankiPreview.frontFieldIndex}
                        onChange={(e) => setAnkiPreview({ ...ankiPreview, frontFieldIndex: parseInt(e.target.value, 10) })}
                        className="w-full px-2 py-1 border border-amber-300 dark:border-amber-700 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                      >
                        {ankiPreview.fields.map((f) => (
                          <option key={f.index} value={f.index}>{f.name}{f.sample ? ` — ${f.sample}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">{t('Back (answer)')}</label>
                      <select
                        value={ankiPreview.backFieldIndex}
                        onChange={(e) => setAnkiPreview({ ...ankiPreview, backFieldIndex: parseInt(e.target.value, 10) })}
                        className="w-full px-2 py-1 border border-amber-300 dark:border-amber-700 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                      >
                        {ankiPreview.fields.map((f) => (
                          <option key={f.index} value={f.index}>{f.name}{f.sample ? ` — ${f.sample}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (!selectedDeckId) return;
                        setImportProgress({ type: 'anki', stage: 'uploading', percent: null });
                        uploadAnkiDeck.mutate({
                          deckId: selectedDeckId,
                          apkgBase64: ankiPreview.apkgBase64,
                          frontFieldIndex: ankiPreview.frontFieldIndex,
                          backFieldIndex: ankiPreview.backFieldIndex,
                        });
                        setAnkiPreview(null);
                      }}
                      disabled={ankiPreview.frontFieldIndex === ankiPreview.backFieldIndex || uploadAnkiDeck.isPending}
                      className="px-4 py-1 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 disabled:opacity-50"
                    >
                      {t('Import')}
                    </button>
                    <button
                      onClick={() => setAnkiPreview(null)}
                      className="px-4 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                    >
                      {t('Cancel')}
                    </button>
                  </div>
                  {ankiPreview.frontFieldIndex === ankiPreview.backFieldIndex && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">{t('Front and back fields must be different.')}</p>
                  )}
                </div>
              )}

              {importProgress?.type === 'anki' && (
                <div className="mt-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {importProgress.stage === 'reading'
                      ? t('Reading file... {{percent}}%', { percent: importProgress.percent ?? 0 })
                      : importProgress.stage === 'encoding' || importProgress.stage === 'previewing'
                        ? t('Analyzing deck...')
                        : t('Uploading and importing...')}
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                    {importProgress.percent === null ? (
                      <div className="h-full w-1/3 animate-pulse bg-amber-600 dark:bg-amber-500" />
                    ) : (
                      <div
                        className="h-full bg-amber-600 transition-all duration-150 dark:bg-amber-500"
                        style={{ width: `${Math.max(2, importProgress.percent)}%` }}
                      />
                    )}
                  </div>
                </div>
              )}

              {uploadStatus && (
                <div
                  className={`mt-4 p-3 rounded-lg ${
                    uploadStatus.success
                      ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                  }`}
                >
                  {uploadStatus.message}
                </div>
              )}

              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Example CSV format:')}</h4>
                {/* Wraps rather than scrolls: a box that scrolls sideways on a phone would have to take keyboard focus. */}
                <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                  {`front,back
"What is 2+2?","4"
"Capital of France?","<b>Paris</b>"
"H2O is?","Water <i>(hydrogen + oxygen)</i>"`}
                </pre>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Assigned to Groups')}</h3>
              </div>
              <div className="p-4">
                <select
                  aria-label={t('Assign to group...')}
                  onChange={(e) => {
                    const groupId = parseInt(e.target.value, 10);
                    if (groupId) {
                      assignDeckToGroup.mutate({ deckId: selectedDeck.id, groupId });
                    }
                  }}
                  value=""
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">{t('Assign to group...')}</option>
                  {groups
                    ?.filter((g) => !assignedGroupIds.has(g.id))
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>

                <div className="space-y-2">
                  {deckGroups?.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded-lg"
                    >
                      <span className="font-medium text-gray-900 dark:text-gray-100">{group.name}</span>
                      <button
                        onClick={() =>
                          removeDeckFromGroup.mutate({
                            deckId: selectedDeck.id,
                            groupId: group.id,
                          })
                        }
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                      >
                        {t('Remove')}
                      </button>
                    </div>
                  ))}
                  {(!deckGroups || deckGroups.length === 0) && (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">{t('Not assigned to any groups')}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">{t('Select a deck to manage cards and group assignments')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ExportDeckButton({ deckId, deckName }: { deckId: number; deckName: string }) {
  const { t } = useI18n();
  const exportQuery = trpc.admin.exportDeckCards.useQuery(
    { deckId },
    { enabled: false }
  );

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${deckName.replace(/[^a-zA-Z0-9]/g, '_')}-cards.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exportQuery.isFetching}
      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
    >
      {exportQuery.isFetching ? t('Exporting...') : t('Export CSV')}
    </button>
  );
}
