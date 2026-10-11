import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../api/trpc';
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';

export default function VirtualDeckList() {
  const { t } = useI18n();
  const { data: virtualDecks, isLoading, refetch } = trpc.virtualDecks.list.useQuery();
  const { data: decks } = trpc.cards.getMyDecks.useQuery({
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
  });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const deleteMutation = trpc.virtualDecks.delete.useMutation({
    onSuccess: () => refetch(),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 animate-pulse">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Virtual Decks')}</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          {t('Create Virtual Deck')}
        </button>
      </div>

      {showCreate && (
        <CreateVirtualDeck
          decks={decks ?? []}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}

      {(!virtualDecks || virtualDecks.length === 0) && !showCreate ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-8 text-center">
          <div className="flex justify-center mb-4 text-gray-300">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-1.243 1.007-2.25 2.25-2.25h13.5" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">{t('No virtual decks yet')}</h3>
          <p className="text-gray-600 dark:text-gray-400">
            {t('Create a virtual deck to study a subset of cards from your existing decks.')}
          </p>
        </div>
      ) : (
        virtualDecks?.map((vd) => (
          <div key={vd.id} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 hover:shadow-md dark:hover:shadow-gray-900/30 transition-shadow">
            {editingId === vd.id ? (
              <EditVirtualDeck
                virtualDeck={vd}
                onClose={() => setEditingId(null)}
                onSuccess={() => {
                  setEditingId(null);
                  refetch();
                }}
              />
            ) : (
              <div className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{vd.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('From: {{name}}', { name: vd.sourceDeckName })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingId(vd.id)}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      title={t('Edit')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(t('Delete this virtual deck?'))) {
                          deleteMutation.mutate({ id: vd.id });
                        }
                      }}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                      title={t('Delete')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-4 font-mono bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded">
                  {vd.cardSelection}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('{{count}} cards', { count: vd.cardCount })}</span>
                  <Link
                    to={`/study/virtual/${vd.id}`}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
                  >
                    {t('Study')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

interface CreateProps {
  decks: Array<{ id: number; name: string; cardCount: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateVirtualDeck({ decks, onClose, onSuccess }: CreateProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [sourceDeckId, setSourceDeckId] = useState<number | null>(null);
  const [cardSelection, setCardSelection] = useState('');

  const createMutation = trpc.virtualDecks.create.useMutation({
    onSuccess,
    onError: (err) => {
      alert(err.message);
    },
  });

  const validationQuery = trpc.virtualDecks.validateSelection.useQuery(
    { sourceDeckId: sourceDeckId ?? 0, cardSelection },
    { enabled: sourceDeckId !== null && cardSelection.length > 0 }
  );
  const validation = validationQuery.data;
  const hasRequiredFields = Boolean(sourceDeckId) && name.trim().length > 0 && cardSelection.trim().length > 0;
  const canSubmit = hasRequiredFields && (validation ? validation.valid : true);
  const validationErrorMessage = validationQuery.error
    ? t('Could not validate selection right now. You can still try creating and the server will validate on submit.')
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceDeckId || !name || !cardSelection) return;

    createMutation.mutate({
      name,
      sourceDeckId,
      cardSelection,
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Create Virtual Deck')}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Name')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('My subset')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Source Deck')}</label>
          <select
            value={sourceDeckId ?? ''}
            onChange={(e) => setSourceDeckId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('Select a deck...')}</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name} ({t('{{count}} cards', { count: deck.cardCount })})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('Card Selection')}
          </label>
          <input
            type="text"
            value={cardSelection}
            onChange={(e) => setCardSelection(e.target.value)}
            placeholder="1-100, 250, 550-557"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('Use ranges (1-100) or single numbers (250) separated by commas')}
          </p>
          {validation && (
            <div className="mt-2 text-sm">
              {validation.valid ? (
                <span className="text-green-700 dark:text-green-400">{t('{{count}} cards selected', { count: validation.cardCount })}</span>
              ) : (
                <span className="text-red-600 dark:text-red-400">{validation.error}</span>
              )}
            </div>
          )}
          {!validation && validationErrorMessage && hasRequiredFields && (
            <p className="mt-2 text-sm text-amber-700">{validationErrorMessage}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={createMutation.isPending || !canSubmit}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? t('Creating...') : t('Create')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {t('Cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}

interface EditProps {
  virtualDeck: {
    id: number;
    name: string;
    cardSelection: string;
    sourceDeckId: number;
    sourceDeckName: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

function EditVirtualDeck({ virtualDeck, onClose, onSuccess }: EditProps) {
  const { t } = useI18n();
  const [name, setName] = useState(virtualDeck.name);
  const [cardSelection, setCardSelection] = useState(virtualDeck.cardSelection);

  const updateMutation = trpc.virtualDecks.update.useMutation({
    onSuccess,
    onError: (err) => {
      alert(err.message);
    },
  });

  const validationQuery = trpc.virtualDecks.validateSelection.useQuery(
    { sourceDeckId: virtualDeck.sourceDeckId, cardSelection },
    { enabled: cardSelection.length > 0 }
  );
  const validation = validationQuery.data;
  const hasRequiredFields = name.trim().length > 0 && cardSelection.trim().length > 0;
  const canSubmit = hasRequiredFields && (validation ? validation.valid : true);
  const validationErrorMessage = validationQuery.error
    ? t('Could not validate selection right now. You can still try saving and the server will validate on submit.')
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: virtualDeck.id,
      name,
      cardSelection,
    });
  };

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Edit Virtual Deck')}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('Name')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('Card Selection (from {{name}})', { name: virtualDeck.sourceDeckName })}
          </label>
          <input
            type="text"
            value={cardSelection}
            onChange={(e) => setCardSelection(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {validation && (
            <div className="mt-2 text-sm">
              {validation.valid ? (
                <span className="text-green-700 dark:text-green-400">{t('{{count}} cards selected', { count: validation.cardCount })}</span>
              ) : (
                <span className="text-red-600 dark:text-red-400">{validation.error}</span>
              )}
            </div>
          )}
          {!validation && validationErrorMessage && hasRequiredFields && (
            <p className="mt-2 text-sm text-amber-700">{validationErrorMessage}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={updateMutation.isPending || !canSubmit}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateMutation.isPending ? t('Saving...') : t('Save')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {t('Cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
