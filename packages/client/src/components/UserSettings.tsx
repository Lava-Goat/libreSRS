import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/messages';

const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  zh: '中文',
  vi: 'Tiếng Việt',
  'pt-BR': 'Português (BR)',
  ru: 'Русский',
  fa: 'فارسی',
  he: 'עברית',
};

type MnemonicMode = 'manual' | 'disabled';

function ToggleSwitch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

function LockedField({ locked, children, t }: { locked: boolean; children: ReactNode; t: (key: string) => string }) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none opacity-60">{children}</div>
      <span className="absolute top-0 right-0 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded border border-orange-200 dark:border-orange-700">
        {t('Locked by admin')}
      </span>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 pt-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h4>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

export default function UserSettings() {
  const { t, locale, setLocale } = useI18n();
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.get.useQuery();

  const [baseline, setBaseline] = useState<{
    newCardsPerDay: number;
    reviewsPerDay: number;
    aiEnabled: boolean;
    autoPlayAudio: boolean;
    autoPlayAudioFront: boolean;
    mnemonicMode: MnemonicMode;
    locale: string | null;
  } | null>(() => (
    settings
      ? {
          newCardsPerDay: settings.newCardsPerDay,
          reviewsPerDay: settings.reviewsPerDay,
          aiEnabled: settings.aiEnabled ?? true,
          autoPlayAudio: settings.autoPlayAudio ?? false,
          autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
          mnemonicMode: settings.mnemonicMode ?? 'manual',
          locale: settings.locale ?? null,
        }
      : null
  ));

  const locks = {
    aiEnabled: settings?.aiEnabledLocked ?? false,
    autoPlayAudio: settings?.autoPlayAudioLocked ?? false,
    autoPlayAudioFront: settings?.autoPlayAudioFrontLocked ?? false,
    mnemonicMode: settings?.mnemonicModeLocked ?? false,
    locale: settings?.localeLocked ?? false,
  };

  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: (data) => {
      utils.settings.get.setData(undefined, data);
      const next = {
        newCardsPerDay: data.newCardsPerDay,
        reviewsPerDay: data.reviewsPerDay,
        aiEnabled: data.aiEnabled ?? true,
        autoPlayAudio: data.autoPlayAudio ?? false,
        autoPlayAudioFront: data.autoPlayAudioFront ?? false,
        mnemonicMode: data.mnemonicMode ?? 'manual',
        locale: data.locale ?? null,
      };
      setBaseline(next);
      setNewCardsPerDay(next.newCardsPerDay);
      setReviewsPerDay(next.reviewsPerDay);
      setAiEnabled(next.aiEnabled);
      setAutoPlayAudio(next.autoPlayAudio);
      setAutoPlayAudioFront(next.autoPlayAudioFront);
      setMnemonicMode(next.mnemonicMode);
      setSelectedLocale((next.locale as Locale | null) ?? locale);
    },
  });

  const [newCardsPerDay, setNewCardsPerDay] = useState(settings?.newCardsPerDay ?? 20);
  // The teacher's override: the server keeps it whatever this form sends.
  const limitsLocked = settings?.limitsLocked ?? false;
  const [reviewsPerDay, setReviewsPerDay] = useState(settings?.reviewsPerDay ?? 20);
  const [aiEnabled, setAiEnabled] = useState(settings?.aiEnabled ?? true);
  const [autoPlayAudio, setAutoPlayAudio] = useState(settings?.autoPlayAudio ?? false);
  const [autoPlayAudioFront, setAutoPlayAudioFront] = useState(settings?.autoPlayAudioFront ?? false);
  const [mnemonicMode, setMnemonicMode] = useState<MnemonicMode>(settings?.mnemonicMode ?? 'manual');
  const [selectedLocale, setSelectedLocale] = useState<Locale>((settings?.locale as Locale | null) ?? locale);

  const aiConfigQuery = trpc.ai.getConfig.useQuery();

  useEffect(() => {
    if (!settings) return;

    const sAiEnabled = settings.aiEnabled ?? true;
    const sAutoPlayAudio = settings.autoPlayAudio ?? false;
    const sAutoPlayAudioFront = settings.autoPlayAudioFront ?? false;
    const sMnemonicMode: MnemonicMode = settings.mnemonicMode ?? 'manual';
    const sLocale = settings.locale ?? null;

    if (
      baseline &&
      baseline.newCardsPerDay === settings.newCardsPerDay &&
      baseline.reviewsPerDay === settings.reviewsPerDay &&
      baseline.aiEnabled === sAiEnabled &&
      baseline.autoPlayAudio === sAutoPlayAudio &&
      baseline.autoPlayAudioFront === sAutoPlayAudioFront &&
      baseline.mnemonicMode === sMnemonicMode &&
      baseline.locale === sLocale
    ) {
      return;
    }

    setBaseline({
      newCardsPerDay: settings.newCardsPerDay,
      reviewsPerDay: settings.reviewsPerDay,
      aiEnabled: sAiEnabled,
      autoPlayAudio: sAutoPlayAudio,
      autoPlayAudioFront: sAutoPlayAudioFront,
      mnemonicMode: sMnemonicMode,
      locale: sLocale,
    });
    setNewCardsPerDay(settings.newCardsPerDay);
    setReviewsPerDay(settings.reviewsPerDay);
    setAiEnabled(sAiEnabled);
    setAutoPlayAudio(sAutoPlayAudio);
    setAutoPlayAudioFront(sAutoPlayAudioFront);
    setMnemonicMode(sMnemonicMode);

    // Apply saved locale from DB if it differs from current
    if (sLocale && sLocale !== locale) {
      setLocale(sLocale as Locale);
    }
    setSelectedLocale((sLocale as Locale | null) ?? locale);
  }, [settings, baseline, locale, setLocale]);

  const isDirty = baseline
    ? newCardsPerDay !== baseline.newCardsPerDay
      || reviewsPerDay !== baseline.reviewsPerDay
      || aiEnabled !== baseline.aiEnabled
      || autoPlayAudio !== baseline.autoPlayAudio
      || autoPlayAudioFront !== baseline.autoPlayAudioFront
      || mnemonicMode !== baseline.mnemonicMode
      || selectedLocale !== (baseline.locale ?? locale)
    : false;

  const handleLocaleChange = (next: Locale) => {
    setSelectedLocale(next);
    setLocale(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSettings.mutate({
      newCardsPerDay,
      reviewsPerDay,
      aiEnabled,
      autoPlayAudio,
      autoPlayAudioFront,
      mnemonicMode,
      locale: selectedLocale,
    });
  };

  const showAiSection = aiConfigQuery.data && (
    aiConfigQuery.data.pronunciation || aiConfigQuery.data.image || aiConfigQuery.data.mnemonic
  );

  const isSaving = updateSettings.isPending;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Default Settings')}</h3>
        {updateSettings.isSuccess && !isDirty && (
          <span role="status" className="text-xs text-green-700 dark:text-green-400">{t('Saved')}</span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
        {t('These settings apply to all decks by default. Each deck can override them individually.')}
      </p>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('Loading settings...')}</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Study Limits */}
          <div>
            <SectionHeader title={t('Study Limits')} />
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="new-cards-per-day"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t('New cards per day')}
                </label>
                <input
                  id="new-cards-per-day"
                  type="number"
                  min={0}
                  max={500}
                  value={newCardsPerDay}
                  onChange={(e) => setNewCardsPerDay(parseInt(e.target.value || '0', 10))}
                  disabled={limitsLocked}
                  aria-describedby={limitsLocked ? 'limits-locked' : undefined}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="reviews-per-day"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t('Reviews per day')}
                </label>
                <input
                  id="reviews-per-day"
                  type="number"
                  min={0}
                  max={500}
                  value={reviewsPerDay}
                  onChange={(e) => setReviewsPerDay(parseInt(e.target.value || '0', 10))}
                  disabled={limitsLocked}
                  aria-describedby={limitsLocked ? 'limits-locked' : undefined}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('Reviews are cards that come back after you learned them (not new cards).')}
                </p>
                {limitsLocked && (
                  <p id="limits-locked" className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('Set by your teacher.')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* AI & Audio */}
          {showAiSection && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
              <SectionHeader title={t('AI & Audio')} />
              <div className="space-y-3">
                <LockedField locked={locks.aiEnabled} t={t}>
                  <ToggleSwitch
                    id="ai-enabled"
                    checked={aiEnabled}
                    onChange={locks.aiEnabled ? () => {} : setAiEnabled}
                    label={t('AI Features')}
                  />
                </LockedField>
                {aiConfigQuery.data?.pronunciation && (
                  <>
                    <LockedField locked={locks.autoPlayAudioFront} t={t}>
                      <ToggleSwitch
                        id="auto-play-front"
                        checked={autoPlayAudioFront}
                        onChange={locks.autoPlayAudioFront ? () => {} : setAutoPlayAudioFront}
                        label={t('Auto-play question audio')}
                      />
                    </LockedField>
                    <LockedField locked={locks.autoPlayAudio} t={t}>
                      <ToggleSwitch
                        id="auto-play-back"
                        checked={autoPlayAudio}
                        onChange={locks.autoPlayAudio ? () => {} : setAutoPlayAudio}
                        label={t('Auto-play answer audio')}
                      />
                    </LockedField>
                  </>
                )}
                {aiConfigQuery.data?.mnemonic && (
                  <LockedField locked={locks.mnemonicMode} t={t}>
                    <div>
                      <label
                        htmlFor="mnemonic-mode"
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >
                        {t('Mnemonic generation')}
                      </label>
                      <select
                        id="mnemonic-mode"
                        value={mnemonicMode}
                        onChange={(e) => !locks.mnemonicMode && setMnemonicMode(e.target.value as MnemonicMode)}
                        disabled={locks.mnemonicMode}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <option value="manual">{t('Manual only')}</option>
                        <option value="disabled">{t('Disabled')}</option>
                      </select>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {mnemonicMode === 'manual' && t('Mnemonics are only generated when you click the button.')}
                        {mnemonicMode === 'disabled' && t('No new mnemonics will be generated. Existing saved mnemonics still appear.')}
                      </p>
                    </div>
                  </LockedField>
                )}
              </div>
            </div>
          )}

          {/* Language */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <SectionHeader title={t('Language')} />
            <LockedField locked={locks.locale} t={t}>
              <select
                id="locale-select"
                value={selectedLocale}
                onChange={(e) => !locks.locale && handleLocaleChange(e.target.value as Locale)}
                disabled={locks.locale}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                aria-label={t('Language')}
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_DISPLAY_NAMES[loc]}
                  </option>
                ))}
              </select>
            </LockedField>
          </div>

          <button
            type="submit"
            disabled={!isDirty || isSaving}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? t('Saving...') : t('Save Settings')}
          </button>
        </form>
      )}

      <DownloadHistoryButton />
    </div>
  );
}

function DownloadHistoryButton() {
  const { t } = useI18n();
  const exportQuery = trpc.cards.exportMyHistory.useQuery(undefined, { enabled: false });

  const handleDownload = async () => {
    const result = await exportQuery.refetch();
    if (result.data?.csv) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'review-history.csv';
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={handleDownload}
        disabled={exportQuery.isFetching}
        className="w-full py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        {exportQuery.isFetching ? t('Exporting...') : t('Download Review History (CSV)')}
      </button>
    </div>
  );
}
