import { useEffect, useRef, useState, type FormEvent } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';

interface Props {
  deckId: number;
  onClose: () => void;
}

type MnemonicMode = 'manual' | 'disabled';
/** How the teacher lets this student set the deck's daily limits (server: limitRuleFor). */
type LimitRule = 'free' | 'locked' | 'higher' | 'lower';

const LIMIT_MIN = 0;
const LIMIT_MAX = 500;
const LIMIT_INPUT_CLASS = 'w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-60 disabled:cursor-not-allowed';
const LIMIT_INPUT_VALID = 'border-gray-300 dark:border-gray-600';
const LIMIT_INPUT_INVALID = 'border-red-500 dark:border-red-400';

/** The range a limit input allows under the teacher's rule. */
function limitBounds(rule: LimitRule, teacherValue: number | null): { min: number; max: number } {
  if (teacherValue === null) return { min: LIMIT_MIN, max: LIMIT_MAX };
  const teacher = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, teacherValue));
  if (rule === 'higher') return { min: teacher, max: LIMIT_MAX };
  if (rule === 'lower') return { min: LIMIT_MIN, max: teacher };
  if (rule === 'locked') return { min: teacher, max: teacher };
  return { min: LIMIT_MIN, max: LIMIT_MAX };
}

function ToggleSwitch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function DeckSettings({ deckId, onClose }: Props) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.getDeckSettings.useQuery({ deckId });
  const { data: globalSettings } = trpc.settings.get.useQuery();
  const aiConfigQuery = trpc.ai.getConfig.useQuery();

  type Baseline = {
    newCardsPerDay: number;
    reviewsPerDay: number;
    deckAiEnabled: boolean | null;
    deckAutoPlayAudio: boolean | null;
    deckAutoPlayAudioFront: boolean | null;
    deckMnemonicMode: MnemonicMode | null;
  };

  const [baseline, setBaseline] = useState<Baseline | null>(null);

  const updateSettings = trpc.settings.updateDeckSettings.useMutation({
    onSuccess: (data) => {
      utils.settings.getDeckSettings.setData({ deckId }, data);
      setBaseline({
        newCardsPerDay: data.newCardsPerDay,
        reviewsPerDay: data.reviewsPerDay,
        deckAiEnabled: data.deckAiEnabled as boolean | null ?? null,
        deckAutoPlayAudio: data.deckAutoPlayAudio as boolean | null ?? null,
        deckAutoPlayAudioFront: data.deckAutoPlayAudioFront as boolean | null ?? null,
        deckMnemonicMode: data.deckMnemonicMode ?? null,
      });
      setNewCardsPerDay(data.newCardsPerDay);
      setReviewsPerDay(data.reviewsPerDay);
      setDeckAiEnabled(data.deckAiEnabled as boolean | null ?? null);
      setDeckAutoPlayAudio(data.deckAutoPlayAudio as boolean | null ?? null);
      setDeckAutoPlayAudioFront(data.deckAutoPlayAudioFront as boolean | null ?? null);
      setDeckMnemonicMode(data.deckMnemonicMode ?? null);
    },
  });

  const resetSettings = trpc.settings.resetDeckSettings.useMutation({
    onSuccess: (data) => {
      utils.settings.getDeckSettings.setData({ deckId }, data);
      setBaseline({
        newCardsPerDay: data.newCardsPerDay,
        reviewsPerDay: data.reviewsPerDay,
        deckAiEnabled: null,
        deckAutoPlayAudio: null,
        deckAutoPlayAudioFront: null,
        deckMnemonicMode: null,
      });
      setNewCardsPerDay(data.newCardsPerDay);
      setReviewsPerDay(data.reviewsPerDay);
      setDeckAiEnabled(null);
      setDeckAutoPlayAudio(null);
      setDeckAutoPlayAudioFront(null);
      setDeckMnemonicMode(null);
    },
  });

  const [newCardsPerDay, setNewCardsPerDay] = useState(settings?.newCardsPerDay ?? 20);
  const [reviewsPerDay, setReviewsPerDay] = useState(settings?.reviewsPerDay ?? 20);
  // null = inherit from global default
  const [deckAiEnabled, setDeckAiEnabled] = useState<boolean | null>(
    (settings as { deckAiEnabled?: boolean | null } | undefined)?.deckAiEnabled ?? null
  );
  const [deckAutoPlayAudio, setDeckAutoPlayAudio] = useState<boolean | null>(
    (settings as { deckAutoPlayAudio?: boolean | null } | undefined)?.deckAutoPlayAudio ?? null
  );
  const [deckAutoPlayAudioFront, setDeckAutoPlayAudioFront] = useState<boolean | null>(
    (settings as { deckAutoPlayAudioFront?: boolean | null } | undefined)?.deckAutoPlayAudioFront ?? null
  );
  const [deckMnemonicMode, setDeckMnemonicMode] = useState<MnemonicMode | null>(
    (settings as { deckMnemonicMode?: MnemonicMode | null } | undefined)?.deckMnemonicMode ?? null
  );

  // Whether AI/audio overrides are enabled for this deck
  const hasAiOverrides = deckAiEnabled !== null || deckAutoPlayAudio !== null || deckAutoPlayAudioFront !== null || deckMnemonicMode !== null;
  const [overrideAiSettings, setOverrideAiSettings] = useState(hasAiOverrides);

  useEffect(() => {
    if (!settings) return;
    const s = settings as typeof settings & {
      deckAiEnabled?: boolean | null;
      deckAutoPlayAudio?: boolean | null;
      deckAutoPlayAudioFront?: boolean | null;
      deckMnemonicMode?: MnemonicMode | null;
    };

    const newBaseline: Baseline = {
      newCardsPerDay: s.newCardsPerDay,
      reviewsPerDay: s.reviewsPerDay,
      deckAiEnabled: s.deckAiEnabled ?? null,
      deckAutoPlayAudio: s.deckAutoPlayAudio ?? null,
      deckAutoPlayAudioFront: s.deckAutoPlayAudioFront ?? null,
      deckMnemonicMode: s.deckMnemonicMode ?? null,
    };

    if (
      baseline &&
      baseline.newCardsPerDay === newBaseline.newCardsPerDay &&
      baseline.reviewsPerDay === newBaseline.reviewsPerDay &&
      baseline.deckAiEnabled === newBaseline.deckAiEnabled &&
      baseline.deckAutoPlayAudio === newBaseline.deckAutoPlayAudio &&
      baseline.deckAutoPlayAudioFront === newBaseline.deckAutoPlayAudioFront &&
      baseline.deckMnemonicMode === newBaseline.deckMnemonicMode
    ) {
      return;
    }

    setBaseline(newBaseline);
    setNewCardsPerDay(s.newCardsPerDay);
    setReviewsPerDay(s.reviewsPerDay);
    setDeckAiEnabled(s.deckAiEnabled ?? null);
    setDeckAutoPlayAudio(s.deckAutoPlayAudio ?? null);
    setDeckAutoPlayAudioFront(s.deckAutoPlayAudioFront ?? null);
    setDeckMnemonicMode(s.deckMnemonicMode ?? null);
    setOverrideAiSettings(
      s.deckAiEnabled !== null ||
      s.deckAutoPlayAudio !== null ||
      s.deckAutoPlayAudioFront !== null ||
      s.deckMnemonicMode !== null
    );
  }, [settings, baseline]);

  const handleOverrideToggle = (enabled: boolean) => {
    setOverrideAiSettings(enabled);
    if (!enabled) {
      // Clear all AI overrides when disabling
      setDeckAiEnabled(null);
      setDeckAutoPlayAudio(null);
      setDeckAutoPlayAudioFront(null);
      setDeckMnemonicMode(null);
    } else {
      // Seed overrides with effective (global default) values
      if (globalSettings) {
        setDeckAiEnabled(globalSettings.aiEnabled ?? true);
        setDeckAutoPlayAudio(globalSettings.autoPlayAudio ?? false);
        setDeckAutoPlayAudioFront(globalSettings.autoPlayAudioFront ?? false);
        setDeckMnemonicMode(globalSettings.mnemonicMode ?? 'manual');
      }
    }
  };

  // The teacher's lock on the two limits. Older servers and mocks send none: free.
  const limitRule: LimitRule = settings?.limitRule ?? 'free';
  const limitsLocked = limitRule === 'locked';
  const teacherNewCardsPerDay = settings?.teacherNewCardsPerDay ?? null;
  const teacherReviewsPerDay = settings?.teacherReviewsPerDay ?? null;
  const newCardsBounds = limitBounds(limitRule, teacherNewCardsPerDay);
  const reviewsBounds = limitBounds(limitRule, teacherReviewsPerDay);
  const newCardsOutOfRange = !limitsLocked
    && (Number.isNaN(newCardsPerDay) || newCardsPerDay < newCardsBounds.min || newCardsPerDay > newCardsBounds.max);
  const reviewsOutOfRange = !limitsLocked
    && (Number.isNaN(reviewsPerDay) || reviewsPerDay < reviewsBounds.min || reviewsPerDay > reviewsBounds.max);
  const limitHint = (teacherValue: number | null) => {
    if (teacherValue === null) return null;
    if (limitRule === 'higher') return t('Your teacher set {{count}}. You can go higher.', { count: teacherValue });
    if (limitRule === 'lower') return t('Your teacher set {{count}}. You can go lower.', { count: teacherValue });
    return null;
  };
  const newCardsHint = limitHint(teacherNewCardsPerDay);
  const reviewsHint = limitHint(teacherReviewsPerDay);
  const newCardsHintId = `deck-${deckId}-new-cards-hint`;
  const reviewsHintId = `deck-${deckId}-reviews-hint`;
  const limitsLockedId = `deck-${deckId}-limits-locked`;

  const isDirty = baseline
    ? newCardsPerDay !== baseline.newCardsPerDay
      || reviewsPerDay !== baseline.reviewsPerDay
      || (overrideAiSettings ? deckAiEnabled : null) !== baseline.deckAiEnabled
      || (overrideAiSettings ? deckAutoPlayAudio : null) !== baseline.deckAutoPlayAudio
      || (overrideAiSettings ? deckAutoPlayAudioFront : null) !== baseline.deckAutoPlayAudioFront
      || (overrideAiSettings ? deckMnemonicMode : null) !== baseline.deckMnemonicMode
    : false;

  const isUsingGlobalDefaults = baseline
    ? baseline.newCardsPerDay === (globalSettings?.newCardsPerDay ?? 20) &&
      baseline.reviewsPerDay === (globalSettings?.reviewsPerDay ?? 20) &&
      baseline.deckAiEnabled === null &&
      baseline.deckAutoPlayAudio === null &&
      baseline.deckAutoPlayAudioFront === null &&
      baseline.deckMnemonicMode === null
    : false;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The inputs' min/max make the browser explain; this covers a submit that skips validation.
    if (newCardsOutOfRange || reviewsOutOfRange) return;
    updateSettings.mutate({
      deckId,
      // Locked: the teacher's values (the server ignores the deck's own anyway).
      newCardsPerDay: limitsLocked && baseline ? baseline.newCardsPerDay : newCardsPerDay,
      reviewsPerDay: limitsLocked && baseline ? baseline.reviewsPerDay : reviewsPerDay,
      aiEnabled: overrideAiSettings ? deckAiEnabled : null,
      autoPlayAudio: overrideAiSettings ? deckAutoPlayAudio : null,
      autoPlayAudioFront: overrideAiSettings ? deckAutoPlayAudioFront : null,
      mnemonicMode: overrideAiSettings ? deckMnemonicMode : null,
    });
  };

  const handleReset = () => {
    resetSettings.mutate({ deckId });
  };

  const isSaving = updateSettings.isPending || resetSettings.isPending;

  // Focus the panel when it opens
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const showAiSection = aiConfigQuery.data && (
    aiConfigQuery.data.pronunciation || aiConfigQuery.data.image || aiConfigQuery.data.mnemonic
  );

  // Helper to get effective display value (deck override or global default)
  const effectiveAiEnabled = deckAiEnabled ?? (globalSettings?.aiEnabled ?? true);
  const effectiveAutoPlayAudio = deckAutoPlayAudio ?? (globalSettings?.autoPlayAudio ?? false);
  const effectiveAutoPlayAudioFront = deckAutoPlayAudioFront ?? (globalSettings?.autoPlayAudioFront ?? false);
  const effectiveMnemonicMode: MnemonicMode = deckMnemonicMode ?? globalSettings?.mnemonicMode ?? 'manual';

  return (
    <div ref={panelRef} tabIndex={-1} className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 focus:outline-none">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Deck Settings')}</h4>
        <button
          onClick={onClose}
          className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
        >
          {t('Close')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Study Limits */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('Study Limits')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={`deck-${deckId}-new-cards`}
                  className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                >
                  {t('New cards/day')}
                </label>
                <input
                  id={`deck-${deckId}-new-cards`}
                  type="number"
                  min={newCardsBounds.min}
                  max={newCardsBounds.max}
                  value={newCardsPerDay}
                  onChange={(e) => setNewCardsPerDay(parseInt(e.target.value || '0', 10))}
                  disabled={limitsLocked}
                  aria-invalid={newCardsOutOfRange || undefined}
                  aria-describedby={limitsLocked ? limitsLockedId : newCardsHint ? newCardsHintId : undefined}
                  className={`${LIMIT_INPUT_CLASS} ${newCardsOutOfRange ? LIMIT_INPUT_INVALID : LIMIT_INPUT_VALID}`}
                />
                {newCardsHint && (
                  <p
                    id={newCardsHintId}
                    className={`text-xs mt-1 ${newCardsOutOfRange ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    {newCardsHint}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor={`deck-${deckId}-reviews`}
                  className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                >
                  {t('Reviews/day')}
                </label>
                <input
                  id={`deck-${deckId}-reviews`}
                  type="number"
                  min={reviewsBounds.min}
                  max={reviewsBounds.max}
                  value={reviewsPerDay}
                  onChange={(e) => setReviewsPerDay(parseInt(e.target.value || '0', 10))}
                  disabled={limitsLocked}
                  aria-invalid={reviewsOutOfRange || undefined}
                  aria-describedby={limitsLocked ? limitsLockedId : reviewsHint ? reviewsHintId : undefined}
                  className={`${LIMIT_INPUT_CLASS} ${reviewsOutOfRange ? LIMIT_INPUT_INVALID : LIMIT_INPUT_VALID}`}
                />
                {reviewsHint && (
                  <p
                    id={reviewsHintId}
                    className={`text-xs mt-1 ${reviewsOutOfRange ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    {reviewsHint}
                  </p>
                )}
              </div>
            </div>
            {limitsLocked && (
              <p id={limitsLockedId} className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('Set by your teacher.')}
              </p>
            )}
          </div>

          {/* AI & Audio Overrides */}
          {showAiSection && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('AI & Audio')}
                </p>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideAiSettings}
                    onChange={(e) => handleOverrideToggle(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('Override defaults')}</span>
                </label>
              </div>

              {overrideAiSettings ? (
                <div className="space-y-2.5 pl-1">
                  <ToggleSwitch
                    id={`deck-${deckId}-ai-enabled`}
                    checked={effectiveAiEnabled}
                    onChange={(v) => setDeckAiEnabled(v)}
                    label={t('AI Features')}
                  />
                  {aiConfigQuery.data?.pronunciation && (
                    <>
                      <ToggleSwitch
                        id={`deck-${deckId}-auto-play-front`}
                        checked={effectiveAutoPlayAudioFront}
                        onChange={(v) => setDeckAutoPlayAudioFront(v)}
                        label={t('Auto-play question audio')}
                      />
                      <ToggleSwitch
                        id={`deck-${deckId}-auto-play-back`}
                        checked={effectiveAutoPlayAudio}
                        onChange={(v) => setDeckAutoPlayAudio(v)}
                        label={t('Auto-play answer audio')}
                      />
                    </>
                  )}
                  {aiConfigQuery.data?.mnemonic && (
                    <div>
                      <label
                        htmlFor={`deck-${deckId}-mnemonic-mode`}
                        className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                      >
                        {t('Mnemonic generation')}
                      </label>
                      <select
                        id={`deck-${deckId}-mnemonic-mode`}
                        value={effectiveMnemonicMode}
                        onChange={(e) => setDeckMnemonicMode(e.target.value as MnemonicMode)}
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                      >
                        <option value="manual">{t('Manual only')}</option>
                        <option value="disabled">{t('Disabled')}</option>
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">
                  {t('Using global defaults')}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!isDirty || isSaving}
              className="flex-1 py-1.5 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? t('Saving...') : t('Save')}
            </button>
            {!isUsingGlobalDefaults && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isSaving}
                className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                {t('Reset to Default')}
              </button>
            )}
          </div>

          {isUsingGlobalDefaults && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('Using global defaults')}</p>
          )}
        </form>
      )}
    </div>
  );
}
