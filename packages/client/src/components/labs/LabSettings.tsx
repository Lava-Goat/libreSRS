// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin → Labs: the pause rule. How many of a lab's answer pauses a student
 * must speak in for the lab to count (0 turns the rule off), how much voice
 * answers a pause, whether voice outside the pauses also holds a lab for the
 * teacher, and (under Advanced) how far over the room's level the page's
 * voice meter wants a voice. A session keeps the rule it began with, so a
 * change applies to labs started afterwards.
 */
import { useId, useState, type FormEvent } from 'react';
import { GATE_MARGIN_RANGE_DB, MIN_ANSWERED_PCT_RANGE, VOICE_PER_PAUSE_RANGE_MS } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';

const input = 'px-2 py-1 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 tabular-nums w-24';
const inputOk = 'border-gray-300 dark:border-gray-600';
const inputBad = 'border-red-500 dark:border-red-400';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';

/** "75" -> 75; null unless a whole number within the range. */
function parseWhole(text: string, [min, max]: readonly [number, number]): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** "0.5" (or "0,5") seconds -> 500 ms; null unless within 0.2–2 s. */
function parseVoiceSeconds(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$/.test(trimmed)) return null;
  const ms = Math.round(Number(trimmed) * 1000);
  return ms >= VOICE_PER_PAUSE_RANGE_MS[0] && ms <= VOICE_PER_PAUSE_RANGE_MS[1] ? ms : null;
}

const secondsText = (ms: number) => String(ms / 1000);

export default function LabSettings() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.labs.settings.useQuery();
  const save = trpc.labs.saveSettings.useMutation();
  const ids = useId();
  // null: show the saved value; a string: what the teacher is typing.
  const [pctText, setPctText] = useState<string | null>(null);
  const [voiceText, setVoiceText] = useState<string | null>(null);
  const [marginText, setMarginText] = useState<string | null>(null);
  const [hold, setHold] = useState<boolean | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [problems, setProblems] = useState<{ pct: boolean; voice: boolean; margin: boolean }>({ pct: false, voice: false, margin: false });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const heading = <h2 id={`${ids}-heading`} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Speaking in the pauses')}</h2>;
  const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4';

  if (error) {
    return (
      <section aria-labelledby={`${ids}-heading`} className={card}>
        {heading}
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
      </section>
    );
  }
  if (isLoading || !data) {
    return (
      <section aria-labelledby={`${ids}-heading`} className={card}>
        {heading}
        <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      </section>
    );
  }

  const pctValue = pctText ?? String(data.minAnsweredPct);
  const voiceValue = voiceText ?? secondsText(data.voicePerPauseMs);
  const marginValue = marginText ?? String(data.gateMarginDb);
  const holdValue = hold ?? data.holdOutsideVoice;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const minAnsweredPct = parseWhole(pctValue, MIN_ANSWERED_PCT_RANGE);
    const voicePerPauseMs = parseVoiceSeconds(voiceValue);
    const gateMarginDb = parseWhole(marginValue, GATE_MARGIN_RANGE_DB);
    setProblems({ pct: minAnsweredPct === null, voice: voicePerPauseMs === null, margin: gateMarginDb === null });
    setSaved(false);
    setSaveError(null);
    // The margin sits under Advanced: open it so its problem shows.
    if (gateMarginDb === null) setAdvancedOpen(true);
    if (minAnsweredPct === null || voicePerPauseMs === null || gateMarginDb === null) return;
    try {
      const result = await save.mutateAsync({ minAnsweredPct, voicePerPauseMs, gateMarginDb, holdOutsideVoice: holdValue });
      utils.labs.settings.setData(undefined, result);
      setPctText(null);
      setVoiceText(null);
      setMarginText(null);
      setHold(null);
      setSaved(true);
      // The review page's header shows how many pauses a lab needs at these settings.
      void utils.labs.settings.invalidate();
      void utils.labs.submissions.invalidate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('Could not save'));
    }
  };

  const describedBy = (field: 'pct' | 'voice' | 'margin', hint?: string) =>
    [hint, problems[field] ? `${ids}-${field}-error` : null].filter(Boolean).join(' ') || undefined;

  return (
    <section aria-labelledby={`${ids}-heading`} className={card}>
      {heading}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t('The microphone hears whether there is a voice in a pause, not what is said.')}
      </p>
      <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div className="space-y-1">
            <label htmlFor={`${ids}-pct`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('Pauses a student must answer (%)')}
            </label>
            <input
              id={`${ids}-pct`}
              type="number"
              inputMode="numeric"
              min={MIN_ANSWERED_PCT_RANGE[0]}
              max={MIN_ANSWERED_PCT_RANGE[1]}
              step={5}
              value={pctValue}
              onChange={(e) => { setPctText(e.target.value); setSaved(false); }}
              aria-invalid={problems.pct || undefined}
              aria-describedby={describedBy('pct', `${ids}-pct-hint`)}
              className={`${input} ${problems.pct ? inputBad : inputOk}`}
            />
            <p id={`${ids}-pct-hint`} className="text-xs text-gray-500 dark:text-gray-400">{t('0 turns this off: every lab counts.')}</p>
            {problems.pct && (
              <p id={`${ids}-pct-error`} className="text-xs text-red-700 dark:text-red-400">{t('Use a whole number from 0 to 100.')}</p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${ids}-voice`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('Voice needed in a pause (seconds)')}
            </label>
            <input
              id={`${ids}-voice`}
              type="number"
              inputMode="decimal"
              min={VOICE_PER_PAUSE_RANGE_MS[0] / 1000}
              max={VOICE_PER_PAUSE_RANGE_MS[1] / 1000}
              step={0.05}
              value={voiceValue}
              onChange={(e) => { setVoiceText(e.target.value); setSaved(false); }}
              aria-invalid={problems.voice || undefined}
              aria-describedby={describedBy('voice')}
              className={`${input} ${problems.voice ? inputBad : inputOk}`}
            />
            {problems.voice && (
              <p id={`${ids}-voice-error`} className="text-xs text-red-700 dark:text-red-400">{t('Use a number of seconds from 0.2 to 2.')}</p>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('While the rule is on, two kinds of lab always wait for you instead of counting: results the page could not have sent, and a second, different lab played at the same time as another.')}
          </p>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={holdValue}
              onChange={(e) => { setHold(e.target.checked); setSaved(false); }}
              aria-describedby={`${ids}-hold-hint`}
            />
            {t('Also hold labs with voice outside the pauses')}
          </label>
          <p id={`${ids}-hold-hint`} className="text-xs text-gray-500 dark:text-gray-400">
            {t('A phone, a video, music or a neighbour, not answers. In a loud room or on speakers this can hold honest students.')}
          </p>
        </div>
        <details open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-300">{t('Advanced')}</summary>
          <div className="mt-2 space-y-1">
            <label htmlFor={`${ids}-margin`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('Room margin (dB)')}
            </label>
            <input
              id={`${ids}-margin`}
              type="number"
              inputMode="numeric"
              min={GATE_MARGIN_RANGE_DB[0]}
              max={GATE_MARGIN_RANGE_DB[1]}
              step={1}
              value={marginValue}
              onChange={(e) => { setMarginText(e.target.value); setSaved(false); }}
              aria-invalid={problems.margin || undefined}
              aria-describedby={describedBy('margin', `${ids}-margin-hint`)}
              className={`${input} ${problems.margin ? inputBad : inputOk}`}
            />
            <p id={`${ids}-margin-hint`} className="text-xs text-gray-500 dark:text-gray-400">{t('How much louder than the room a voice must be to count.')}</p>
            {problems.margin && (
              <p id={`${ids}-margin-error`} className="text-xs text-red-700 dark:text-red-400">{t('Use a whole number from 4 to 12.')}</p>
            )}
          </div>
        </details>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('Changes apply to labs started from now on.')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={save.isPending} className={primary}>{t('Save')}</button>
          <span role="status" className="text-sm text-green-700 dark:text-green-400">{saved ? t('Saved.') : ''}</span>
        </div>
        {saveError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{saveError}</p>}
      </form>
    </section>
  );
}
