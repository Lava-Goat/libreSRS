// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Admin panel for the Vocabulómetro: configure tests, open/close them per
// group/class, and analyze recorded results (replaces the standalone app's
// code-paste "panel del profesor").
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import {
  DATA, MODE_LABELS, PRESETS,
  buildPlan, buildCtestPassage, dashChartSVG, estRecord, fmt, isV2, ledger, levelOf, meanSE, pct, runningEstimate, tcrit,
  BANDOFF,
  isFlaggedQuality, splitByQuality,
  type DashRecord, type OccasionGroup, type ProfileRecord, type VocabMode, type VocabSummary, type VocabTestSettings,
} from '../vocab/logic';
import { ProfileView, recordsFromResults } from '../vocab/VocabProfile';
import { isVocabTestWindowInverted, vocabTestWindowState, type VocabTestWindow, type VocabTestWindowState } from '../vocab/testWindow';
import '../vocab/vocab.css';

const MODES: VocabMode[] = ['size', 'mastery', 'listen', 'listen2', 'dictado', 'ctest', 'ldt', 'ei', 'c500', 'a500', 's5000'];

// Curated Spanish accent options for the TTS bank ('' = provider default voice)
const SPANISH_ACCENTS = ['', 'Mexican', 'Castilian', 'Argentine', 'Colombian', 'Chilean', 'Cuban', 'Puerto Rican'];

interface TestFormState {
  id?: number;
  name: string;
  mode: VocabMode;
  occasion: string;
  groupIds: number[];
  isOpen: boolean;
  opensAt: string; // datetime-local value or ''
  closesAt: string;
  settings: VocabTestSettings;
}

const EMPTY_FORM: TestFormState = {
  name: '',
  mode: 'size',
  occasion: '',
  groupIds: [],
  isOpen: false,
  opensAt: '',
  closesAt: '',
  settings: {},
};

function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export default function VocabManager() {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data: tests } = trpc.vocab.listTests.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const [editing, setEditing] = useState<TestFormState | null>(null);
  const [resultsTestId, setResultsTestId] = useState<number | 'all'>('all');
  // The status pills read the clock at render time; this only forces a
  // re-render as time passes (and when a throttled background tab comes
  // back), so a scheduled test flips to "open" (and an open one to "ended")
  // without a page reload.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const tick = () => setClockTick((n) => n + 1);
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const invalidate = () => {
    utils.vocab.listTests.invalidate();
    utils.vocab.getResults.invalidate();
    utils.vocab.getCensusResults.invalidate();
  };

  const createMutation = trpc.vocab.createTest.useMutation({ onSuccess: () => { invalidate(); setEditing(null); } });
  const updateMutation = trpc.vocab.updateTest.useMutation({ onSuccess: () => { invalidate(); setEditing(null); } });
  const toggleMutation = trpc.vocab.updateTest.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.vocab.deleteTest.useMutation({ onSuccess: invalidate });

  const saveTest = () => {
    if (!editing) return;
    const payload = {
      name: editing.name.trim(),
      occasion: editing.occasion.trim() || undefined,
      settings: editing.settings,
      groupIds: editing.groupIds,
      isOpen: editing.isOpen,
      opensAt: fromLocalInput(editing.opensAt),
      closesAt: fromLocalInput(editing.closesAt),
    };
    if (editing.id) {
      updateMutation.mutate({ id: editing.id, ...payload, occasion: editing.occasion.trim() || null });
    } else {
      createMutation.mutate({ ...payload, mode: editing.mode });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  // A window that closes before it opens is never visible to students.
  const windowInverted = editing !== null
    && isVocabTestWindowInverted(fromLocalInput(editing.opensAt), fromLocalInput(editing.closesAt));
  const saveError = createMutation.error ?? updateMutation.error;

  return (
    <div className="space-y-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Vocabulómetro</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('Configure vocabulary tests and open or close them for groups of students. Results are recorded under each student’s account.')}
            </p>
          </div>
          <button
            onClick={() => setEditing({ ...EMPTY_FORM })}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            {t('New test')}
          </button>
        </div>

        {!tests || tests.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 py-6 text-center">
            {t('No vocabulary tests configured yet.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {[t('Name'), t('Mode'), t('Occasion'), t('Groups'), t('Window'), t('Results'), t('Status'), t('Actions')].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {tests.map((test) => (
                  <tr key={test.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{test.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{MODE_LABELS[test.mode as VocabMode]}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{test.occasion ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {test.groups.length === 0 ? (
                        <span className="text-orange-500">{t('None')}</span>
                      ) : test.groups.map((g) => g.name).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {test.opensAt ? formatDate(test.opensAt) : '—'} → {test.closesAt ? formatDate(test.closesAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{test.resultCount}</td>
                    <td className="px-4 py-3">
                      <VocabTestStatusButton
                        test={test}
                        disabled={toggleMutation.isPending}
                        onToggle={() => toggleMutation.mutate({ id: test.id, isOpen: !test.isOpen })}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditing({
                            id: test.id,
                            name: test.name,
                            mode: test.mode as VocabMode,
                            occasion: test.occasion ?? '',
                            groupIds: test.groups.map((g) => g.id),
                            isOpen: test.isOpen,
                            opensAt: toLocalInput(test.opensAt),
                            closesAt: toLocalInput(test.closesAt),
                            settings: (test.settings ?? {}) as VocabTestSettings,
                          })}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                        >
                          {t('Edit')}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(t('Delete this test and all its recorded results?'))) {
                              deleteMutation.mutate({ id: test.id });
                            }
                          }}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                        >
                          {t('Delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="vocab-test-dialog-title">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/30 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 id="vocab-test-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {editing.id ? t('Edit test') : t('New test')}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="vocab-test-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Name')}</label>
                  <input
                    id="vocab-test-name"
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="p. ej. Sondeo semana 3 · Español 2"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="vocab-test-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Mode')}</label>
                  <select
                    id="vocab-test-mode"
                    value={editing.mode}
                    disabled={!!editing.id}
                    onChange={(e) => setEditing({ ...editing, mode: e.target.value as VocabMode, settings: {} })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  >
                    {MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="vocab-test-occasion" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('Occasion (used to measure progress across administrations)')}
                </label>
                <input
                  id="vocab-test-occasion"
                  type="text"
                  value={editing.occasion}
                  onChange={(e) => setEditing({ ...editing, occasion: e.target.value })}
                  placeholder="p. ej. Otoño 2026"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <SettingsEditor
                mode={editing.mode}
                settings={editing.settings}
                onChange={(settings) => setEditing({ ...editing, settings })}
              />

              <div>
                <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('Groups')}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  {groups?.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={editing.groupIds.includes(g.id)}
                        onChange={(e) => setEditing({
                          ...editing,
                          groupIds: e.target.checked
                            ? [...editing.groupIds, g.id]
                            : editing.groupIds.filter((id) => id !== g.id),
                        })}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
                {editing.groupIds.length === 0 && (
                  <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                    {t('No groups selected — no student will see this test.')}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label htmlFor="vocab-test-opens" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Opens at (optional)')}</label>
                  <input
                    id="vocab-test-opens"
                    type="datetime-local"
                    value={editing.opensAt}
                    onChange={(e) => setEditing({ ...editing, opensAt: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="vocab-test-closes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Closes at (optional)')}</label>
                  <input
                    id="vocab-test-closes"
                    type="datetime-local"
                    value={editing.closesAt}
                    onChange={(e) => setEditing({ ...editing, closesAt: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={editing.isOpen}
                    onChange={(e) => setEditing({ ...editing, isOpen: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Open for students')}</span>
                </label>
              </div>

              {windowInverted && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {t('The closing time must be after the opening time.')}
                </p>
              )}
              {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError.message}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={saveTest}
                  disabled={saving || !editing.name.trim() || windowInverted}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? t('Saving...') : t('Save')}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AudioBankPanel />

      <TextsPanel />

      <EiSentencesPanel />

      <VocabResultsPanel
        tests={tests ?? []}
        resultsTestId={resultsTestId}
        setResultsTestId={setResultsTestId}
      />
    </div>
  );
}

const STATUS_PILL_CLASS: Record<VocabTestWindowState, string> = {
  closed: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
  scheduled: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50',
  open: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50',
  ended: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600',
  invalid: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50',
};

// The test list's status pill. It shows what students actually see — the
// isOpen flag combined with the opensAt/closesAt window, the same rule the
// server applies — while a click still flips only the isOpen flag, so the
// tooltip and accessible name spell out that effect ("Close"/"Open").
function VocabTestStatusButton({ test, disabled, onToggle }: {
  test: VocabTestWindow & { name: string };
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t, locale } = useI18n();
  // Read the clock now, not a copy held in state: a re-render after a save or
  // refetch must not judge the window against a time up to 30 s old.
  const state = vocabTestWindowState(test, Date.now());
  const when = (value: string | Date | null | undefined) =>
    value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const label = {
    closed: t('Closed'),
    scheduled: t('Scheduled'),
    open: t('Open'),
    ended: t('Ended'),
    invalid: t('Invalid window'),
  }[state];
  const detail = state === 'scheduled'
    ? t('Opens {{date}}', { date: when(test.opensAt) })
    : state === 'ended'
      ? t('Ended {{date}}', { date: when(test.closesAt) })
      : state === 'invalid'
        ? t('Closes before it opens')
        : null;
  const action = test.isOpen
    ? t('Close “{{name}}” for students', { name: test.name })
    : t('Open “{{name}}” for students', { name: test.name });
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={action}
      aria-label={`${label}${detail ? ` (${detail})` : ''}: ${action}`}
      data-state={state}
      className={`px-2 py-1 text-xs font-medium ${detail ? 'rounded-lg' : 'rounded-full'} transition-colors text-left disabled:opacity-60 ${STATUS_PILL_CLASS[state]}`}
    >
      <span className="block whitespace-nowrap">{label}</span>
      {detail && <span className="block whitespace-nowrap font-normal opacity-80">{detail}</span>}
    </button>
  );
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number | ''; min: number; max: number;
  onChange: (v: number | undefined) => void;
}) {
  // Tie the label to its input, so a screen reader names the field and a click on the label focuses it.
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

/** Whether the "repeat the sentence" recordings can be transcribed here (Admin > AI), said where the test is set up. */
function EiTranscriptionStatus() {
  const { t } = useI18n();
  const status = trpc.vocab.transcriptionStatus.useQuery(undefined, { staleTime: 30_000 });
  if (!status.data) return null;
  if (!status.data.enabled) {
    return (
      <p role="status" className="text-xs text-amber-800 dark:text-amber-300">
        {t('Speech transcription is switched off in Admin > AI, so students cannot take this test. Turn it on there first (only if your school has agreed to it).')}
      </p>
    );
  }
  if (!status.data.aiEnabled) {
    return <p role="status" className="text-xs text-amber-800 dark:text-amber-300">{t('AI is switched off in Admin > AI, so the recordings cannot be transcribed.')}</p>;
  }
  return null;
}

function SettingsEditor({ mode, settings, onChange }: {
  mode: VocabMode;
  settings: VocabTestSettings;
  onChange: (s: VocabTestSettings) => void;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<VocabTestSettings>) => onChange({ ...settings, ...patch });
  const id = useId();
  const bandCounts = settings.bandCounts ?? PRESETS[settings.preset ?? 'rapida'].slice(0, 5);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {t('Test settings')}
      </p>

      {(mode === 'listen2' || mode === 'dictado') && (
        <div>
          <label htmlFor={`${id}-accent`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('TTS accent')}</label>
          <select
            id={`${id}-accent`}
            value={settings.accent ?? ''}
            onChange={(e) => set({ accent: e.target.value })}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SPANISH_ACCENTS.map((a) => <option key={a} value={a}>{a === '' ? t('Default voice') : a}</option>)}
            <option value="random">{t('Randomize (mix of accents)')}</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {settings.accent === 'random'
              ? t('Each word is played in a randomly chosen accent — tests comprehension across dialects. Generate clips for several accents below first.')
              : t('The audio bank for this accent must be generated below before students can take the test.')}
          </p>
        </div>
      )}

      {mode === 'ctest' && (
        <CtestSettingsEditor settings={settings} onChange={onChange} />
      )}

      {mode === 'ei' && (
        <div className="space-y-2">
          <NumberField
            label={t('Sentences (3–30)')}
            value={settings.nsent ?? 10}
            min={3}
            max={30}
            onChange={(v) => set({ nsent: v })}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('The student hears each sentence (generated audio in the Vocabulómetro voice; browser speech only for a sentence without a clip) and repeats it aloud; the recording is transcribed and scored. Requires AI (transcription) enabled and student microphone permission. Manage the sentence bank below.')}
          </p>
          <EiTranscriptionStatus />
        </div>
      )}

      {mode === 'ldt' && (
        <NumberField
          label={t('Response deadline (ms)')}
          value={settings.deadlineMs ?? 2500}
          min={1000}
          max={10000}
          onChange={(v) => set({ deadlineMs: v })}
        />
      )}

      {(mode === 'size' || mode === 'listen2' || mode === 'ldt') && (
        <>
          <div>
            <label htmlFor={`${id}-preset`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('Precision preset')}</label>
            <select
              id={`${id}-preset`}
              value={settings.preset ?? 'rapida'}
              onChange={(e) => {
                const preset = e.target.value as 'rapida' | 'precision';
                onChange({ ...settings, preset, bandCounts: undefined, npseudo: undefined });
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="rapida">Rápida — 70 ítems, ~7 min (cribado de grupo)</option>
              <option value="precision">Precisión individual — 130 ítems, ~12 min</option>
            </select>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {['1–500', '501–1.000', '1.001–2.000', '2.001–3.000', '3.001–5.000'].map((label, i) => (
              <NumberField
                key={label}
                label={label}
                value={bandCounts[i] ?? ''}
                min={4}
                max={40}
                onChange={(v) => {
                  const next = [...bandCounts];
                  next[i] = v ?? next[i];
                  set({ bandCounts: next });
                }}
              />
            ))}
            <NumberField
              label={t('Pseudowords')}
              value={settings.npseudo ?? PRESETS[settings.preset ?? 'rapida'][5]}
              min={6}
              max={30}
              onChange={(v) => set({ npseudo: v })}
            />
          </div>
          {mode === 'size' && (
            <NumberField
              label={t('Adaptive stop ± words (optional)')}
              value={settings.stopSE ?? ''}
              min={150}
              max={2000}
              onChange={(v) => set({ stopSE: v ?? null })}
            />
          )}
        </>
      )}

      {mode === 'dictado' && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {['1–500', '501–1.000', '1.001–2.000', '2.001–3.000', '3.001–5.000'].map((label, i) => {
            const dictCounts = settings.bandCounts ?? [6, 5, 4, 3, 2];
            return (
              <NumberField
                key={label}
                label={label}
                value={dictCounts[i] ?? ''}
                min={0}
                max={40}
                onChange={(v) => {
                  const next = [...dictCounts];
                  next[i] = v ?? next[i];
                  set({ bandCounts: next });
                }}
              />
            );
          })}
        </div>
      )}

      {mode === 'mastery' && (
        <NumberField
          label={t('Top-500 items')}
          value={settings.nmast ?? 50}
          min={20}
          max={120}
          onChange={(v) => set({ nmast: v })}
        />
      )}

      {mode === 'listen' && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('Fixed form: 52 audio items (40 real, 12 pseudo), identical for every student.')}
        </p>
      )}

      {mode === 'c500' && (
        <NumberField label={t('Census block (1–10)')} value={settings.blk ?? 1} min={1} max={10} onChange={(v) => set({ blk: v })} />
      )}

      {mode === 'a500' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${id}-form`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('Form')}</label>
            <select
              id={`${id}-form`}
              value={settings.form ?? 'A'}
              onChange={(e) => set({ form: e.target.value as 'A' | 'B' })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>A</option>
              <option>B</option>
            </select>
          </div>
          <NumberField label={t('Block (1–5)')} value={settings.blk ?? 1} min={1} max={5} onChange={(v) => set({ blk: v })} />
        </div>
      )}

      {mode === 's5000' && (
        <>
          <NumberField label={t('Week (1–30)')} value={settings.blk ?? 1} min={1} max={30} onChange={(v) => set({ blk: v })} />
          <div>
            <label htmlFor={`${id}-plan`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('Adaptive plan code (optional — overrides the week; generate it from a student’s Plan button below)')}
            </label>
            <textarea
              id={`${id}-plan`}
              rows={2}
              value={settings.planCode ?? ''}
              onChange={(e) => set({ planCode: e.target.value.trim() || null })}
              placeholder="VNHS1.eyJ2IjozLC…"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </>
      )}

      {mode !== 'listen' && (
        <div>
          <NumberField
            label={t('Seed (optional — same form for every student)')}
            value={settings.seed ?? ''}
            min={0}
            max={4294967295}
            onChange={(v) => set({ seed: v ?? null })}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('Leave blank for an independent random draw per student.')}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------- results & class analytics ----------------

export function VocabResultsPanel({ tests, resultsTestId, setResultsTestId }: {
  tests: { id: number; name: string }[];
  resultsTestId: number | 'all';
  setResultsTestId: (v: number | 'all') => void;
}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const resultsFilter = resultsTestId === 'all' ? {} : { testId: resultsTestId };
  // Summary rows for every attempt (uncapped); census rows arrive without their
  // per-word states, which only the Anuario reads — fetched below on demand.
  const { data: results } = trpc.vocab.getResults.useQuery(resultsFilter);
  const hasCensus = !!results?.some((r) => r.censusItems != null);
  const { data: censusResults } = trpc.vocab.getCensusResults.useQuery(resultsFilter, { enabled: hasCensus });
  const deleteResult = trpc.vocab.deleteResult.useMutation({
    onSuccess: () => {
      utils.vocab.getResults.invalidate();
      utils.vocab.getCensusResults.invalidate();
      utils.vocab.listTests.invalidate();
    },
  });
  const [copiedPlanFor, setCopiedPlanFor] = useState<number | null>(null);
  // Class tables follow the profile's rule: flagged attempts are out unless asked for.
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [recordsShown, setRecordsShown] = useState(RECORDS_PAGE);

  // recordsFromResults carries each attempt's quality flag (same parse as the profile)
  const records: ProfileRecord[] = useMemo(() => recordsFromResults(results ?? []), [results]);
  const censusRecords: ProfileRecord[] = useMemo(
    () => (hasCensus ? recordsFromResults(censusResults ?? []).filter((r) => isV2(r.summary)) : []),
    [hasCensus, censusResults]
  );
  const censusQ = useMemo(() => splitByQuality(censusRecords, includeFlagged), [censusRecords, includeFlagged]);

  const LED = useMemo(() => ledger(censusQ.used), [censusQ]);
  const ledgerKeys = Object.keys(LED).map(Number).sort((a, b) => LED[a].name.localeCompare(LED[b].name));
  const occKey = (r: DashRecord) => r.occ || r.date || '—';

  const exportCSV = () => {
    if (!results) return;
    const san = (x: unknown) => String(x == null ? '' : x).replace(/,/g, ' ');
    const head = 'student,email,date,occasion,test,mode,block,form,size,se_size,coverage,se_coverage,mastery,se_mastery,f,flagged\n';
    const rows = results.map((r) => {
      let e: ReturnType<typeof estRecord> = {};
      try { e = estRecord(JSON.parse(r.summaryJson) as VocabSummary); } catch { /* skip */ }
      return [
        san(r.userName), san(r.userEmail), new Date(r.completedAt).toISOString().slice(0, 10),
        san(r.occasion), san(r.testName), r.mode, san(r.blk), san(r.form),
        e.size?.toFixed(0) ?? '', e.seS?.toFixed(0) ?? '',
        e.cov?.toFixed(4) ?? '', e.seC?.toFixed(4) ?? '',
        e.mast?.toFixed(4) ?? '', e.seM?.toFixed(4) ?? '',
        e.f?.toFixed(4) ?? '',
        isFlaggedQuality(r.qualityJson) ? '1' : '0',
      ].join(',');
    }).join('\n');
    const blob = new Blob([head + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vocabulometro_resultados.csv';
    a.click();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 vm-root">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id="vocab-results-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Results & class progress')}</h2>
        <div className="flex items-center gap-3">
          <select
            aria-labelledby="vocab-results-title"
            value={resultsTestId === 'all' ? 'all' : String(resultsTestId)}
            onChange={(e) => setResultsTestId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t('All tests')}</option>
            {tests.map((test) => <option key={test.id} value={test.id}>{test.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={includeFlagged}
              onChange={(e) => setIncludeFlagged(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            {t('Include flagged attempts in class tables')}
          </label>
          <button
            onClick={exportCSV}
            disabled={!results || results.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
          >
            {t('Export CSV')}
          </button>
        </div>
      </div>

      {!results || results.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 py-4">{t('No results recorded yet.')}</p>
      ) : (
        <>
          <StudentProfilesSection />

          {/* Anuario: word-by-word ledger from censo/activo/sondeo blocks */}
          {censusRecords.length > 0 && (
            <>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-4">
                Anuario · censo y sondeo (palabra por palabra)
              </h3>
              <FlaggedNote q={censusQ} />
              {ledgerKeys.length > 0 && <table className="vm-table">
                <thead>
                  <tr>
                    <th>Estudiante</th>
                    <th className="num">Top 500 verificadas</th>
                    <th className="num">Top 500 activas</th>
                    <th className="num">Tamaño 5.000 (en curso)</th>
                    <th className="num">Censado</th>
                    <th className="num">f̄ (n pseudo)</th>
                    <th className="num">Bloques</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerKeys.map((uid) => {
                    const st = LED[uid];
                    const b1 = [...Array(BANDOFF[1]).keys()];
                    const v = b1.filter((i) => st.pas[i] >= 2).length, tst = b1.filter((i) => i in st.pas).length;
                    const a = b1.filter((i) => st.act[i] === 3).length, atst = b1.filter((i) => i in st.act).length;
                    const R = runningEstimate(st);
                    return (
                      <tr key={uid}>
                        <td>{st.name}</td>
                        <td className="num">{v} / {tst}</td>
                        <td className="num">{a} / {atst}</td>
                        <td className="num">{fmt(R.size)} ± {fmt(1.96 * R.se)}</td>
                        <td className="num">{pct(R.cens, 0)}</td>
                        <td className="num">{pct(R.f, 0)} ({R.psN})</td>
                        <td className="num">
                          {st.events.length}{' '}
                          <button
                            className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
                            onClick={() => {
                              navigator.clipboard?.writeText(buildPlan(st));
                              setCopiedPlanFor(uid);
                              setTimeout(() => setCopiedPlanFor(null), 1800);
                            }}
                          >
                            {copiedPlanFor === uid ? 'Plan copiado ✓' : 'Plan'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
              <p className="note">
                Tamaño ± se estrecha con cada bloque: bandas 1–2 cuentan solo palabras <em>verificadas</em> (dos puertas,
                sin término f), bandas 3–5 usan Sí/No con la tasa de falsa alarma acumulada del estudiante. «Plan» copia
                un código de plan adaptativo para pegarlo en un nuevo sondeo.
              </p>
            </>
          )}

          {/* Per-occasion means + paired growth for size/listen */}
          {(['size', 'listen', 'listen2', 'dictado', 'ldt'] as const).map((mode) => {
            const modeAll = records.filter((r) => r.mode === mode && !isV2(r.summary) && !('ct' in r.summary) && !('ei' in r.summary));
            const q = splitByQuality(modeAll, includeFlagged);
            if (!q.flagged && !q.used.length) return null;
            const recs = q.used;
            const label = mode === 'size' ? 'Tamaño y cobertura (escrito)'
              : mode === 'listen' ? 'Auditiva · Forma A'
                : mode === 'listen2' ? 'Auditiva · banco TTS'
                  : mode === 'ldt' ? 'Decisión léxica cronometrada'
                    : 'Dictado · escritura al oído';
            if (!recs.length) {
              return (
                <div key={mode}>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                    {label} · por ocasión
                  </h3>
                  <FlaggedNote q={q} />
                </div>
              );
            }
            const occs = [...new Set(recs.map(occKey))].sort((a, b) => {
              const d = (o: string) => recs.filter((r) => occKey(r) === o).map((r) => r.date).sort()[0] || '';
              return d(a) < d(b) ? -1 : 1;
            });
            const groups: (OccasionGroup & { rs: { r: DashRecord; e: ReturnType<typeof estRecord> }[]; rtMean: number | null })[] = occs.map((o) => {
              const rs = recs.map((r) => ({ r, e: estRecord(r.summary) })).filter((x) => occKey(x.r) === o);
              const C = meanSE(rs.map((x) => x.e.cov ?? 0), rs.map((x) => x.e.seC ?? 0));
              const Sz = meanSE(rs.map((x) => x.e.size ?? 0), rs.map((x) => x.e.seS ?? 0));
              const fbar = rs.reduce((acc, x) => acc + (x.e.f ?? 0), 0) / rs.length;
              const rtVals = rs.map((x) => x.e.rtMed).filter((v): v is number => typeof v === 'number');
              const rtMean = rtVals.length ? rtVals.reduce((a, b) => a + b, 0) / rtVals.length : null;
              return { o, rs, C, Sz, fbar, rtMean };
            });
            let growth: React.ReactNode = null;
            if (groups.length >= 2) {
              const A = groups[0], B = groups[groups.length - 1];
              const byUser = (g: typeof A) => {
                const m: Record<number, { r: DashRecord; e: ReturnType<typeof estRecord> }> = {};
                g.rs.forEach((x) => {
                  const k = x.r.userId;
                  if (!m[k] || x.r.date > m[k].r.date) m[k] = x;
                });
                return m;
              };
              const mA = byUser(A), mB = byUser(B);
              const pairs = Object.keys(mA).map(Number).filter((k) => k in mB).map((k) => ({
                name: mA[k].r.name,
                dC: (mB[k].e.cov ?? 0) - (mA[k].e.cov ?? 0),
                dS: (mB[k].e.size ?? 0) - (mA[k].e.size ?? 0),
              }));
              if (pairs.length) {
                const n = pairs.length, tc = tcrit(n - 1);
                const dc = meanSE(pairs.map((p) => p.dC), [0]), ds = meanSE(pairs.map((p) => p.dS), [0]);
                const up = pairs.filter((p) => p.dC > 0).length;
                const sig = n > 1 && Math.abs(dc.m) > tc * dc.se;
                const endpointsQ = splitByQuality(modeAll.filter((r) => occKey(r) === A.o || occKey(r) === B.o), includeFlagged);
                growth = (
                  <>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                      Crecimiento pareado · {A.o} → {B.o}
                    </h3>
                    <FlaggedNote q={endpointsQ} />
                    <div className="res-head">
                      <div className="stat"><div className="n">{(dc.m >= 0 ? '+' : '') + (100 * dc.m).toFixed(1)}<small> pts</small></div><div className="l">Δ cobertura media (n={n} parejas)</div></div>
                      <div className="stat"><div className="n">{(ds.m >= 0 ? '+' : '') + fmt(ds.m)}<small> pal</small></div><div className="l">Δ tamaño medio</div></div>
                      <div className="stat"><div className="n">{up}<small> / {n}</small></div><div className="l">estudiantes que suben</div></div>
                    </div>
                    <p className="ci">
                      IC 95% (t, gl={n - 1}): Δcobertura {(100 * (dc.m - tc * dc.se)).toFixed(1)} a {(100 * (dc.m + tc * dc.se)).toFixed(1)} pts ·
                      Δtamaño {fmt(ds.m - tc * ds.se)} a {fmt(ds.m + tc * ds.se)} palabras
                      {n > 1 ? (sig ? ' — el crecimiento del grupo es distinguible de cero.' : ' — el IC incluye cero: aún no distinguible del ruido de medición.') : ' — con una sola pareja no hay IC de grupo.'}
                    </p>
                    <table className="vm-table">
                      <thead><tr><th>Estudiante</th><th className="num">Δ cobertura</th><th className="num">Δ tamaño</th></tr></thead>
                      <tbody>
                        {pairs.map((p) => (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td className="num">{(p.dC >= 0 ? '+' : '') + (100 * p.dC).toFixed(1)} pts</td>
                            <td className="num">{(p.dS >= 0 ? '+' : '') + fmt(p.dS)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                );
              }
            }
            return (
              <div key={mode}>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                  {label} · por ocasión
                </h3>
                <FlaggedNote q={q} />
                <table className="vm-table">
                  <thead>
                    <tr>
                      <th>Ocasión</th><th className="num">n</th><th className="num">Cobertura media</th>
                      <th className="num">Tamaño medio</th>
                      <th className="num">{mode === 'ldt' ? 'Automaticidad (ms)' : 'Nivel léxico'}</th>
                      <th className="num">f̄</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const tc = tcrit(g.C.n - 1);
                      return (
                        <tr key={g.o}>
                          <td>{g.o}</td>
                          <td className="num">{g.C.n}</td>
                          <td className="num">{pct(g.C.m)} ± {(100 * tc * g.C.se).toFixed(1)}</td>
                          <td className="num">{fmt(g.Sz.m)} ± {fmt(tc * g.Sz.se)}</td>
                          <td className="num">{
                            mode === 'ldt' ? (g.rtMean != null ? `${Math.round(g.rtMean)}` : '—')
                              : mode === 'dictado' || mode === 'listen2' ? '—'
                                : levelOf(Math.max(0, Math.min(5000, g.Sz.m))).l
                          }</td>
                          <td className="num">{pct(g.fbar, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div dangerouslySetInnerHTML={{ __html: dashChartSVG(groups) }} />
                {growth}
              </div>
            );
          })}

          {/* Mastery per occasion */}
          {(() => {
            const q = splitByQuality(records.filter((r) => r.mode === 'mastery' && !isV2(r.summary)), includeFlagged);
            if (!q.flagged && !q.used.length) return null;
            const mast = q.used;
            const occs = [...new Set(mast.map(occKey))].sort();
            return (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                  Dominio Top 500 · por ocasión
                </h3>
                <FlaggedNote q={q} />
                {mast.length > 0 && <table className="vm-table">
                  <thead><tr><th>Ocasión</th><th className="num">n</th><th className="num">Dominio medio (corr.)</th></tr></thead>
                  <tbody>
                    {occs.map((o) => {
                      const es = mast.filter((r) => occKey(r) === o).map((r) => estRecord(r.summary));
                      const M = meanSE(es.map((e) => e.mast ?? 0), es.map((e) => e.seM ?? 0));
                      const tc = tcrit(M.n - 1);
                      return (
                        <tr key={o}>
                          <td>{o}</td>
                          <td className="num">{M.n}</td>
                          <td className="num">{pct(M.m)} ± {(100 * tc * M.se).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>}
              </div>
            );
          })()}

          {(() => {
            const q = splitByQuality(records.filter((r) => 'ct' in r.summary), includeFlagged);
            if (!q.flagged && !q.used.length) return null;
            const cts = q.used;
            const occs = [...new Set(cts.map(occKey))].sort();
            return (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                  C-test · por ocasión
                </h3>
                <FlaggedNote q={q} />
                {cts.length > 0 && <table className="vm-table">
                  <thead><tr><th>Ocasión</th><th className="num">n</th><th className="num">Exactas media</th><th className="num">Con acentos tolerados</th></tr></thead>
                  <tbody>
                    {occs.map((o) => {
                      const es = cts.filter((r) => occKey(r) === o).map((r) => estRecord(r.summary));
                      const M = meanSE(es.map((e) => e.ctExact ?? 0), [0]);
                      const L = meanSE(es.map((e) => e.ctLenient ?? 0), [0]);
                      const tc = tcrit(M.n - 1);
                      return (
                        <tr key={o}>
                          <td>{o}</td>
                          <td className="num">{M.n}</td>
                          <td className="num">{pct(M.m)} ± {(100 * tc * M.se).toFixed(1)}</td>
                          <td className="num">{pct(L.m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>}
              </div>
            );
          })()}

          {(() => {
            const q = splitByQuality(records.filter((r) => 'ei' in r.summary), includeFlagged);
            if (!q.flagged && !q.used.length) return null;
            const eis = q.used;
            const occs = [...new Set(eis.map(occKey))].sort();
            return (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
                  Imitación provocada (habla) · por ocasión
                </h3>
                <FlaggedNote q={q} />
                {eis.length > 0 && <table className="vm-table">
                  <thead><tr><th>Ocasión</th><th className="num">n</th><th className="num">Precisión media</th></tr></thead>
                  <tbody>
                    {occs.map((o) => {
                      const es = eis.filter((r) => occKey(r) === o).map((r) => estRecord(r.summary));
                      const M = meanSE(es.map((e) => e.eiMean ?? 0), [0]);
                      const tc = tcrit(M.n - 1);
                      return (
                        <tr key={o}>
                          <td>{o}</td>
                          <td className="num">{M.n}</td>
                          <td className="num">{pct(M.m)} ± {(100 * tc * M.se).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>}
              </div>
            );
          })()}

          <ItemStatsSection testId={resultsTestId === 'all' ? undefined : resultsTestId} />

          {/* Raw records */}
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm mt-6">
            {t('Records')} ({results.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="vm-table">
              <thead>
                <tr>
                  <th>{t('Student')}</th><th>{t('Date')}</th><th>{t('Test')}</th><th>{t('Occasion')}</th>
                  <th>{t('Mode')}</th><th className="num">{t('Summary')}</th><th>{t('Quality')}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, recordsShown).map((r) => {
                  let sum: string = r.mode;
                  try {
                    const s = JSON.parse(r.summaryJson) as VocabSummary;
                    if (s.v === 2) {
                      // the summary shape omits the per-word states; the server counts them
                      sum = `${r.mode} bloque ${r.blk ?? '?'}${r.form ?? ''} · ${r.censusItems ?? 0} palabras`;
                    } else {
                      const e = estRecord(s);
                      sum = e.mast !== undefined
                        // estRecord is deliberately unclamped (class means must
                        // average the raw corrected scores); a single student's
                        // row clamps so nobody reads a negative percentage.
                        ? `${pct(Math.max(0, e.mast), 0)} dominio`
                        : e.ctExact !== undefined
                          ? `${pct(e.ctExact, 0)} exactas (${e.ctN} huecos)`
                          : e.eiMean !== undefined
                            ? `${pct(e.eiMean, 0)} repetición (${e.eiN} frases)`
                            : `${fmt(e.size ?? 0)} pal · ${pct(e.cov ?? 0, 0)}${e.rtMed != null ? ` · ${e.rtMed}ms` : ''}`;
                    }
                  } catch { /* keep mode label */ }
                  return (
                    <tr key={r.id}>
                      <td>{r.userName}</td>
                      <td className="num">{formatDate(r.completedAt)}</td>
                      <td>{r.testName}</td>
                      <td>{r.occasion ?? '—'}</td>
                      <td>{r.mode}</td>
                      <td className="num">{sum}</td>
                      <td><QualityBadge qualityJson={r.qualityJson} /></td>
                      <td>
                        <button
                          onClick={() => {
                            if (window.confirm(t('Delete this result?'))) deleteResult.mutate({ id: r.id });
                          }}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm font-bold px-2"
                          aria-label={t('Delete')}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {results.length > recordsShown && (
            <p className="note mt-2">
              {t('Showing the newest {{shown}} of {{total}} records.', { shown: recordsShown, total: results.length })}{' '}
              <button
                className="text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setRecordsShown((n) => n + RECORDS_PAGE)}
              >
                {t('Show more')}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- attempt quality & item statistics ----------------

/** Records table page size: every row is loaded; this only limits DOM rows until "Show more". */
const RECORDS_PAGE = 500;

/** Per-table line saying how many quality-flagged attempts the table left out (or includes). */
function FlaggedNote({ q }: { q: { flagged: number; excluded: number } }) {
  if (!q.flagged) return null;
  return (
    <p className="note text-orange-700 dark:text-orange-300">
      {q.excluded > 0
        ? `⚠ ${q.excluded} intento(s) marcado(s) por baja calidad excluido(s) de esta tabla, como en el perfil.`
        : `⚠ Incluye ${q.flagged} intento(s) marcado(s) por baja calidad.`}
    </p>
  );
}

interface AttemptQuality {
  itemCount: number;
  medianMs: number | null;
  yesCount: number;
  fastYesCount: number;
  fastYesShare: number | null;
  faRate: number | null;
  flagged: boolean;
}

function QualityBadge({ qualityJson }: { qualityJson: string | null }) {
  if (!qualityJson) return <span className="text-gray-500 dark:text-gray-400">—</span>;
  let q: AttemptQuality;
  try {
    q = JSON.parse(qualityJson) as AttemptQuality;
  } catch {
    return <span className="text-gray-500 dark:text-gray-400">—</span>;
  }
  const detail = [
    q.faRate !== null ? `f=${(100 * q.faRate).toFixed(0)}%` : null,
    q.medianMs !== null ? `mediana ${q.medianMs}ms` : null,
    q.fastYesShare !== null ? `sí rápidos ${(100 * q.fastYesShare).toFixed(0)}%` : null,
  ].filter(Boolean).join(' · ');
  return (
    <span
      title={detail}
      className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${
        q.flagged
          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      }`}
    >
      {q.flagged ? '⚠' : '✓'}
    </span>
  );
}

// Word classification for item analysis: band index, pseudoword, or unknown.
const PSEUDO_SET = new Set<string>([...DATA.pseudo, ...DATA.pseudoX]);
const BAND_OF_WORD = (() => {
  const m = new Map<string, number>();
  DATA.bands.forEach((band, b) => band.words.forEach((w) => { if (!m.has(w)) m.set(w, b); }));
  return m;
})();

function ItemStatsSection({ testId }: { testId: number | undefined }) {
  const { t } = useI18n();
  const [loadRequested, setLoadRequested] = useState(false);
  const { data, isFetching, isError, error, refetch } = trpc.vocab.getItemStats.useQuery(
    { testId },
    { enabled: loadRequested }
  );

  if (!loadRequested) {
    return (
      <div className="mt-6">
        <button
          onClick={() => setLoadRequested(true)}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm"
        >
          {t('Compute item statistics')}
        </button>
      </div>
    );
  }
  if (isError) {
    return (
      <p className="note mt-6 text-red-600 dark:text-red-400">
        {error?.message ?? 'Error'}{' '}
        <button className="underline" onClick={() => refetch()}>{t('Retry')}</button>
      </p>
    );
  }
  if (isFetching || !data) {
    return <p className="note mt-6">{t('Loading...')}</p>;
  }

  const pseudo = data.items
    .filter((it) => PSEUDO_SET.has(it.w) && it.ynN >= 3)
    .map((it) => ({ ...it, fa: it.ynYes / it.ynN }));
  const meanFA = pseudo.length ? pseudo.reduce((a, p) => a + p.fa, 0) / pseudo.length : 0;
  const pseudoSorted = [...pseudo].sort((a, b) => b.fa - a.fa).slice(0, 25);

  const real = data.items
    .filter((it) => BAND_OF_WORD.has(it.w) && it.ynN >= 5)
    .map((it) => ({ ...it, band: BAND_OF_WORD.get(it.w) as number, yesRate: it.ynYes / it.ynN }));
  const hardest = [...real].sort((a, b) => a.yesRate - b.yesRate).slice(0, 25);

  const mc = data.items
    .filter((it) => it.mcN >= 5)
    .map((it) => ({ ...it, okRate: it.mcOk / it.mcN }))
    .sort((a, b) => a.okRate - b.okRate)
    .slice(0, 25);

  return (
    <div className="mt-6">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm">
        Estadística de ítems · {data.attempts} intentos
      </h3>
      <p className="note">
        Base para la calibración empírica: dificultad observada frente a banda de frecuencia y control de calidad de
        las pseudopalabras. Sí/No proviene solo de pruebas de tamaño y cuenta una observación (la más reciente) por
        estudiante y palabra; base = los últimos {fmt(data.attempts)} intentos (máx. {fmt(data.maxAttempts)}).
      </p>
      {data.truncated && (
        <p className="note text-orange-700 dark:text-orange-300">
          ⚠ Hay más de {fmt(data.maxAttempts)} intentos con respuestas: los más antiguos quedan fuera de esta
          estadística. Filtra por prueba para analizar una administración completa.
        </p>
      )}

      {pseudoSorted.length > 0 && (
        <>
          <h4 className="font-medium text-gray-800 dark:text-gray-200 text-sm mt-4">
            Pseudopalabras · tasa de falsa alarma (media {pct(meanFA, 0)})
          </h4>
          <table className="vm-table">
            <thead>
              <tr><th>Pseudopalabra</th><th className="num">n</th><th className="num">FA</th><th>Señal</th></tr>
            </thead>
            <tbody>
              {pseudoSorted.map((p) => {
                const tooWordlike = p.ynN >= 5 && meanFA > 0 && p.fa >= Math.max(0.35, 2 * meanFA);
                const tooObvious = p.ynN >= 10 && p.fa === 0;
                return (
                  <tr key={p.w}>
                    <td>{p.w}</td>
                    <td className="num">{p.ynN}</td>
                    <td className="num">{pct(p.fa, 0)}</td>
                    <td>{tooWordlike ? '⚠ demasiado verosímil' : tooObvious ? '⚠ demasiado obvia' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {hardest.length > 0 && (
        <>
          <h4 className="font-medium text-gray-800 dark:text-gray-200 text-sm mt-4">
            Palabras reales más difíciles (Sí/No, n ≥ 5)
          </h4>
          <table className="vm-table">
            <thead>
              <tr><th>Palabra</th><th>Banda</th><th className="num">n</th><th className="num">% sí</th><th className="num">RT medio</th></tr>
            </thead>
            <tbody>
              {hardest.map((it) => (
                <tr key={it.w}>
                  <td>{it.w}</td>
                  <td>{DATA.bands[it.band].label}</td>
                  <td className="num">{it.ynN}</td>
                  <td className="num">{pct(it.yesRate, 0)}</td>
                  <td className="num">{it.ynMsN ? `${Math.round(it.ynMsSum / it.ynMsN)} ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {mc.length > 0 && (
        <>
          <h4 className="font-medium text-gray-800 dark:text-gray-200 text-sm mt-4">
            Verificación de significado más fallada (MC/escrito, n ≥ 5)
          </h4>
          <table className="vm-table">
            <thead>
              <tr><th>Palabra</th><th className="num">n</th><th className="num">% acierto</th></tr>
            </thead>
            <tbody>
              {mc.map((it) => (
                <tr key={it.w}>
                  <td>{it.w}</td>
                  <td className="num">{it.mcN}</td>
                  <td className="num">{pct(it.okRate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {pseudoSorted.length === 0 && hardest.length === 0 && mc.length === 0 && (
        <p className="note">{t('Not enough recorded responses yet — statistics appear once items accumulate 3–5 exposures.')}</p>
      )}
    </div>
  );
}

// ---------------- TTS audio bank management ----------------

const AUDIO_SCOPES: { key: string; label: string; words: () => string[] }[] = [
  { key: 'top500', label: 'Top 500', words: () => DATA.bands[0].words },
  { key: 'b2', label: '501–1.000', words: () => DATA.bands[1].words },
  { key: 'b3', label: '1.001–2.000', words: () => DATA.bands[2].words },
  { key: 'b4', label: '2.001–3.000', words: () => DATA.bands[3].words },
  { key: 'b5', label: '3.001–5.000', words: () => DATA.bands[4].words },
  { key: 'pseudo', label: 'Pseudopalabras (48)', words: () => DATA.pseudo },
];

function AudioBankPanel() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [accent, setAccent] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set(['top500', 'pseudo']));

  const bankQuery = trpc.vocab.getAudioBankWords.useQuery({ accent });
  // Poll at 2s during an active batch, 15s otherwise (another admin's batch
  // must still become visible here and re-disable the generate button).
  const progressQuery = trpc.vocab.getAudioBankProgress.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 2000 : 15000),
  });
  const generateMutation = trpc.vocab.generateAudioBank.useMutation({
    onSuccess: () => {
      progressQuery.refetch();
    },
  });
  const sentenceStatusQuery = trpc.vocab.getEiSentenceAudioStatus.useQuery();
  const generateSentencesMutation = trpc.vocab.generateEiSentenceAudio.useMutation({
    onSuccess: () => {
      progressQuery.refetch();
    },
  });

  const ready = useMemo(() => new Set(bankQuery.data?.words ?? []), [bankQuery.data]);
  const progress = progressQuery.data;

  // Refresh coverage whenever a batch completes — keyed on startedAt so a
  // batch that ran entirely between two polls (another admin's, or a fast one)
  // still triggers exactly one refresh.
  const lastHandledBatch = useRef<number | null>(null);
  useEffect(() => {
    if (!progress || progress.startedAt === null) return;
    if (progress.status !== 'generating' && lastHandledBatch.current !== progress.startedAt) {
      lastHandledBatch.current = progress.startedAt;
      utils.vocab.getAudioBankWords.invalidate();
      utils.vocab.getEiSentenceAudioStatus.invalidate();
    }
  }, [progress, utils]);

  const selectedWords = [...new Set(AUDIO_SCOPES
    .filter((s) => scopes.has(s.key))
    .flatMap((s) => s.words()))];
  const missing = selectedWords.filter((w) => !ready.has(w));
  const selectedPseudo = selectedWords.filter((w) => PSEUDO_SET.has(w));
  const missingPseudo = missing.filter((w) => PSEUDO_SET.has(w));
  const busy = progress?.status === 'generating' || generateMutation.isPending || generateSentencesMutation.isPending;
  const sentenceStatus = sentenceStatusQuery.data;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Audio bank (TTS)')}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t('Generated clips power the aural test modes. One clip per word and accent; generation uses the configured AI voice and runs in the background.')}
      </p>

      <VocabVoicePicker />

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="vocab-tts-accent" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('TTS accent')}</label>
          <select
            id="vocab-tts-accent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SPANISH_ACCENTS.map((a) => <option key={a} value={a}>{a === '' ? t('Default voice') : a}</option>)}
            <option value="random">{t('Randomize (mix of accents)')}</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-3">
          {AUDIO_SCOPES.map((scope) => {
            const total = scope.words().length;
            const done = scope.words().filter((w) => ready.has(w)).length;
            return (
              <label key={scope.key} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={scopes.has(scope.key)}
                  onChange={(e) => {
                    const next = new Set(scopes);
                    if (e.target.checked) next.add(scope.key); else next.delete(scope.key);
                    setScopes(next);
                  }}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                {scope.label}
                <span className={`text-xs ${done === total ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {done}/{total}
                </span>
              </label>
            );
          })}
        </div>
        <button
          onClick={() => generateMutation.mutate({ words: missing, accent, pseudoWords: missingPseudo })}
          disabled={missing.length === 0 || busy}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
        >
          {t('Generate {{count}} missing clip(s)', { count: missing.length })}
        </button>
        <button
          onClick={() => {
            if (window.confirm(t('Re-generate all {{count}} selected clip(s), overwriting existing audio? Use this after changing the accent or to fix mispronounced words.', { count: selectedWords.length }))) {
              generateMutation.mutate({ words: selectedWords, accent, pseudoWords: selectedPseudo, force: true });
            }
          }}
          disabled={selectedWords.length === 0 || busy}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 text-sm"
        >
          {t('Re-generate {{count}} selected', { count: selectedWords.length })}
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {t('Pseudowords are generated with a stricter “pronounce in Spanish, even invented words” instruction. If some still sound anglicized, re-generate them.')}
      </p>

      {generateMutation.isError && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-3">{generateMutation.error.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Elicited-imitation sentences')}</span>
        {sentenceStatus && (
          <span className={`text-xs ${sentenceStatus.total > 0 && sentenceStatus.ready === sentenceStatus.total ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {t('{{ready}} / {{total}} sentences ready in this voice', { ready: sentenceStatus.ready, total: sentenceStatus.total })}
          </span>
        )}
        <button
          onClick={() => generateSentencesMutation.mutate({})}
          disabled={!sentenceStatus || sentenceStatus.total === 0 || sentenceStatus.ready === sentenceStatus.total || busy}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
        >
          {t('Generate sentence audio')}
        </button>
        <button
          onClick={() => {
            if (window.confirm(t('Re-generate audio for every sentence, overwriting the clips in this voice?'))) {
              generateSentencesMutation.mutate({ force: true });
            }
          }}
          disabled={!sentenceStatus || sentenceStatus.total === 0 || busy}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 text-sm"
        >
          {t('Re-generate sentence audio')}
        </button>
      </div>
      {sentenceStatus && sentenceStatus.ready < sentenceStatus.total && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          {t('Sentences without a clip in this voice are read by the student’s browser voice, which differs from device to device.')}
        </p>
      )}
      {generateSentencesMutation.isError && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-2">{generateSentencesMutation.error.message}</p>
      )}

      {progress && progress.status !== 'idle' && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>
              {progress.kind === 'sentence' ? `${t('Sentence audio')} · ` : ''}
              {progress.status === 'generating' ? t('Generating…') : progress.status === 'done' ? t('Done') : t('Failed')}
              {' '}{progress.processed} / {progress.total}
              {progress.failed > 0 ? ` · ${progress.failed} ${t('failed')}` : ''}
            </span>
          </div>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${progress.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`}
              style={{ width: progress.total > 0 ? `${Math.round((progress.processed / progress.total) * 100)}%` : '0%' }}
            />
          </div>
          {progress.lastError && (
            <p className="text-xs text-red-500 mt-1">{progress.lastError}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** ElevenLabs voice category → how the picker names it. */
function voiceCategoryLabel(category: string | undefined, t: (s: string) => string): string | null {
  switch (category) {
    case 'professional': return t('professional clone');
    case 'cloned': return t('instant clone');
    case 'premade': return t('premade');
    case 'generated': return t('designed voice');
    default: return category ?? null;
  }
}

/**
 * The voice that speaks the Vocabulómetro's default accent and its sentences.
 * Stored apart from the flashcard voice map, so choosing it here never changes
 * flashcard audio.
 */
export function VocabVoicePicker() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const voiceQuery = trpc.vocab.getVocabVoice.useQuery();
  const elevenLabs = voiceQuery.data?.ttsProvider === 'elevenlabs';
  const voicesQuery = trpc.ai.listTtsVoices.useQuery(undefined, {
    enabled: elevenLabs && Boolean(voiceQuery.data?.hasElevenLabsKey),
    retry: false,
  });
  const saveMutation = trpc.vocab.setVocabVoice.useMutation({
    onSuccess: () => {
      utils.vocab.getVocabVoice.invalidate();
      // Readiness is per voice: a new voice starts with its own (empty) bank.
      utils.vocab.getAudioBankWords.invalidate();
      utils.vocab.getEiSentenceAudioStatus.invalidate();
    },
  });

  const data = voiceQuery.data;
  if (!data) return null;
  if (!elevenLabs) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('Speech is served by OpenAI, so the bank uses its OpenAI clips. Switch the TTS provider to ElevenLabs in Admin → AI to choose a Vocabulómetro voice.')}
      </p>
    );
  }

  const voices = voicesQuery.data?.voices ?? [];
  const selected = data.vocabVoiceId ?? '';
  const defaultVoice = voices.find((v) => v.voiceId === data.defaultVoiceId);
  return (
    <div className="mb-4">
      <label htmlFor="vocab-voice" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('Voice')}</label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="vocab-voice"
          value={selected}
          onChange={(e) => saveMutation.mutate({ voiceId: e.target.value || null })}
          disabled={saveMutation.isPending}
          className="min-w-64 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">
            {defaultVoice
              ? t('Default AI voice ({{name}})', { name: defaultVoice.name })
              : t('Default AI voice')}
          </option>
          {voices.map((v) => {
            const category = voiceCategoryLabel(v.category, t);
            return (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}{category ? ` · ${category}` : ''}
              </option>
            );
          })}
          {selected && !voices.some((v) => v.voiceId === selected) && (
            <option value={selected}>{selected}</option>
          )}
        </select>
        {saveMutation.isPending && <span className="text-xs text-gray-500 dark:text-gray-400">{t('Saving...')}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {t('Speaks the default accent and the elicited-imitation sentences; other accents keep their voices from Admin → AI. Only clips made in the current voice are played, so generate the bank again after changing it.')}
      </p>
      {voicesQuery.isError && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{voicesQuery.error.message}</p>
      )}
      {saveMutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{saveMutation.error.message}</p>
      )}
    </div>
  );
}

// ---------------- source texts (C-test) ----------------

function CtestSettingsEditor({ settings, onChange }: {
  settings: VocabTestSettings;
  onChange: (s: VocabTestSettings) => void;
}) {
  const { t } = useI18n();
  const { data: texts } = trpc.vocab.listTexts.useQuery();
  const selected = settings.textIds ?? [];
  return (
    <div className="space-y-3">
      <div>
        <p className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('Source texts')}</p>
        {!texts || texts.length === 0 ? (
          <p className="text-xs text-orange-500">{t('No texts yet — add class passages in the "Source texts" panel below.')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
            {texts.map((text) => (
              <label key={text.id} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={selected.includes(text.id)}
                  disabled={!selected.includes(text.id) && selected.length >= 20}
                  onChange={(e) => onChange({
                    ...settings,
                    textIds: e.target.checked ? [...selected, text.id] : selected.filter((id) => id !== text.id),
                  })}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate">{text.title}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {buildCtestPassage(text.title, text.content, 999).gaps.length === 0 ? '⚠ 0 huecos' : `${buildCtestPassage(text.title, text.content, 999).gaps.length} huecos`}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <NumberField
        label={t('Total gaps (~20-30 recommended)')}
        value={settings.ngaps ?? 25}
        min={5}
        max={60}
        onChange={(v) => onChange({ ...settings, ngaps: v })}
      />
    </div>
  );
}

function TextsPanel() {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data: texts } = trpc.vocab.listTexts.useQuery();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const createMutation = trpc.vocab.createText.useMutation({
    onSuccess: () => {
      utils.vocab.listTexts.invalidate();
      setTitle('');
      setContent('');
    },
  });
  const deleteMutation = trpc.vocab.deleteText.useMutation({
    onSuccess: () => utils.vocab.listTexts.invalidate(),
    onError: (err) => window.alert(err.message),
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Source texts')}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t('Class passages that power the generated measures (C-test). Use texts your students have not memorized.')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Title')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('Paste a passage (at least a few sentences — the first sentence stays intact).')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => createMutation.mutate({ title: title.trim(), content: content.trim() })}
            disabled={!title.trim() || content.trim().length < 50 || createMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
          >
            {createMutation.isPending ? t('Saving...') : t('Add text')}
          </button>
          {createMutation.isError && <p className="text-sm text-red-600 dark:text-red-400">{createMutation.error.message}</p>}
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {!texts || texts.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('No texts yet.')}</p>
          ) : texts.map((text) => (
            <div key={text.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{text.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {text.content.split(/\s+/).length} {t('words')} · {formatDate(text.createdAt)}
                </p>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(t('Delete this text?'))) deleteMutation.mutate({ id: text.id });
                }}
                className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm font-bold px-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- per-student proficiency profiles ----------------

interface ProfileResultRow {
  userId: number;
  userName: string;
  mode: string;
  blk: string | null;
  form: string | null;
  occasion: string | null;
  summaryJson: string;
  qualityJson: string | null;
  completedAt: string | Date;
}

function StudentProfilesSection() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // The profile is always whole-history per student, independent of the results
  // test filter — a profile built from one test would not be multi-factor.
  const { data: allResults } = trpc.vocab.getResults.useQuery({});
  const byUser = new Map<number, { name: string; rows: ProfileResultRow[] }>();
  for (const r of (allResults ?? []) as ProfileResultRow[]) {
    const slot = byUser.get(r.userId) ?? { name: r.userName, rows: [] };
    slot.rows.push(r);
    byUser.set(r.userId, slot);
  }
  const students = [...byUser.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  if (students.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm">
        Perfil de competencia · por estudiante
      </h3>
      <p className="note">
        Índice multifactor: cada factor (amplitud, profundidad, automaticidad, oído, producción, competencia
        integrada) se alimenta de instrumentos distintos, para medir el progreso real hacia la competencia y no solo
        la habilidad de aprobar una prueba concreta.
      </p>
      <div className="mt-2 space-y-2">
        {students.map(([uid, { name, rows }]) => {
          const isOpen = expanded.has(uid);
          return (
            <div key={uid} className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                onClick={() => {
                  const next = new Set(expanded);
                  if (isOpen) next.delete(uid); else next.add(uid);
                  setExpanded(next);
                }}
                className="w-full flex items-center justify-between px-4 py-2 text-left"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">{name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {rows.length} intento(s){(() => {
                    const flagged = rows.filter((r) => { try { return JSON.parse(r.qualityJson ?? 'null')?.flagged === true; } catch { return false; } }).length;
                    return flagged > 0 ? ` (${flagged} baja calidad)` : '';
                  })()} · {isOpen ? 'ocultar' : 'ver perfil'}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  <ProfileView records={recordsFromResults(rows)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- elicited imitation sentence bank ----------------

function EiSentencesPanel() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: sentences } = trpc.vocab.listEiSentences.useQuery();
  const [text, setText] = useState('');
  const [difficulty, setDifficulty] = useState(2);
  // Sentence changes move the sentence-audio readiness count in the audio bank panel.
  const refreshSentences = () => {
    utils.vocab.listEiSentences.invalidate();
    utils.vocab.getEiSentenceAudioStatus.invalidate();
  };
  const create = trpc.vocab.createEiSentence.useMutation({
    onSuccess: () => { refreshSentences(); setText(''); },
  });
  const del = trpc.vocab.deleteEiSentence.useMutation({
    onSuccess: refreshSentences,
  });
  const seed = trpc.vocab.seedEiSentences.useMutation({
    onSuccess: refreshSentences,
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Elicited-imitation sentences')}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('Graded Spanish sentences the student hears and repeats. Difficulty 1 = shortest.')}
          </p>
        </div>
        {(!sentences || sentences.length === 0) && (
          <button
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm"
          >
            {seed.isPending ? t('Seeding...') : t('Seed default sentences')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="space-y-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('Sentence text')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-2">
            <label htmlFor="ei-difficulty" className="text-xs text-gray-600 dark:text-gray-400">{t('Difficulty')}</label>
            <input
              id="ei-difficulty"
              type="number"
              min={1}
              max={10}
              value={difficulty}
              onChange={(e) => setDifficulty(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="w-16 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-sm"
            />
            <button
              onClick={() => create.mutate({ text: text.trim(), difficulty })}
              disabled={text.trim().length < 3 || create.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
            >
              {create.isPending ? t('Saving...') : t('Add sentence')}
            </button>
          </div>
          {create.isError && <p className="text-sm text-red-600 dark:text-red-400">{create.error.message}</p>}
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {!sentences || sentences.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('No sentences yet.')}</p>
          ) : sentences.map((sen) => (
            <div key={sen.id} className="flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
              <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">{sen.difficulty}</span>{sen.text}
              </span>
              <button onClick={() => del.mutate({ id: sen.id })} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm font-bold px-1">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
