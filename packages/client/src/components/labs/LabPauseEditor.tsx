// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin → Labs → Edit: a lab's answer pauses. Kept small on purpose: how many
 * the scan found and how many count, a warning when the count may be off,
 * "Don't count pauses after" (for a dictation at the end), and "Find pauses
 * again". The scan found every pause of a set of sample labs, so there is no
 * per-pause list to edit.
 *
 * A scan that finds pauses of 10 s or more (the "write it down" pauses of the
 * generator labs) suggests leaving them out: with "Don't count pauses after"
 * when they all sit at the end, otherwise by saving the list without them.
 * The upload queue and "Find pauses" on the Labs list suggest the same.
 */
import { useEffect, useId, useState } from 'react';
import { countedPauses, scanNeedsCheck, type LabPause, type LabPauseScan } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { formatClock, parseClock, scanLabUrl } from '../../utils/labAudio';

/** What the editor needs of a lab (a row of `labs.adminList`). */
export interface LabPauseInfo {
  id: number;
  audioUrl: string;
  /** Pauses that count now; null when the lab has not been scanned. */
  pauseCount: number | null;
  /** Every pause the scan found; null when the lab has not been scanned. */
  pauseTotal: number | null;
  pauseScan: LabPauseScan | null;
  pauseCountUntilMs: number | null;
  /** The lab's must-hear-through point: pauses too close to it don't count. */
  requiredThroughMs: number;
  needsCheck?: boolean;
}

const input = 'px-2 py-1 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 tabular-nums w-24';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
const amberText = 'text-amber-800 dark:text-amber-300';

const seconds = (ms: number | null | undefined) => (ms == null ? '—' : (ms / 1000).toFixed(2));

/**
 * A pause at least this long is a "write it down" pause, where students write
 * instead of speaking. In the generator labs those are 11.3 s; the longest
 * answer pause of any course lab is 9.6 s.
 */
export const WRITING_PAUSE_MS = 10_000;
/** Writing pauses "at the end" start no further than this from the end of the last counted pause. */
const WRITING_AT_END_MS = 3 * 60_000;

/** What to suggest for a lab's long pauses. */
export interface LongPauseAdvice {
  /** The counted pauses of 10 s or longer. */
  long: LabPause[];
  /**
   * Where to stop counting when they all sit at the end (the start of the first,
   * so it and every pause after it stop counting); null when they don't.
   */
  cutOffMs: number | null;
}

/**
 * The long pauses among those that count, and whether a "Don't count pauses
 * after" point at the first of them would do: they all start in the lab's last
 * three minutes of pauses, and it keeps at least half of the counted pauses.
 * null when no counted pause is that long.
 */
export function longPauseAdvice(
  pauses: readonly LabPause[],
  countUntilMs: number | null,
  requiredThroughMs: number,
): LongPauseAdvice | null {
  const counted = countedPauses(pauses, countUntilMs, requiredThroughMs);
  const long = counted.filter(([startMs, endMs]) => endMs - startMs >= WRITING_PAUSE_MS);
  if (long.length === 0) return null;
  const firstMs = long[0][0];
  const lastEndMs = counted[counted.length - 1][1];
  const kept = counted.filter(([startMs]) => startMs < firstMs).length;
  const atEnd = lastEndMs - firstMs <= WRITING_AT_END_MS && kept * 2 >= counted.length;
  return { long, cutOffMs: atEnd ? firstMs : null };
}

/** The pause list without the long ones ("Don't count these"). */
export const withoutPauses = (pauses: readonly LabPause[], remove: readonly LabPause[]): LabPause[] =>
  pauses.filter(([startMs]) => !remove.some(([s]) => s === startMs));

/** The suggestion for long pauses, with its buttons. */
export function LongPauseBanner({ advice, busy = false, onCountUntil, onDontCount, onKeep }: {
  advice: LongPauseAdvice;
  busy?: boolean;
  onCountUntil: (cutOffMs: number) => void;
  onDontCount: () => void;
  onKeep: () => void;
}) {
  const { t } = useI18n();
  const count = advice.long.length;
  const { cutOffMs } = advice;
  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
      {/* It appears when a scan ends, maybe under a row far from the button pressed: a status line so a
          screen reader says a choice is waiting. The buttons stay outside it, so they aren't read out again. */}
      <p role="status">{t('{{count}} pause(s) are 10 seconds or longer. In the generator labs these are the “write it down” pauses, where students write instead of speaking.', { count })}</p>
      <div className="flex flex-wrap gap-2">
        {cutOffMs !== null ? (
          <button type="button" onClick={() => onCountUntil(cutOffMs)} disabled={busy} className={secondary}>
            {t('Count pauses only until {{time}}', { time: formatClock(cutOffMs) })}
          </button>
        ) : (
          <button type="button" onClick={onDontCount} disabled={busy} className={secondary}>
            {t("Don't count these {{count}}", { count })}
          </button>
        )}
        <button type="button" onClick={onKeep} disabled={busy} className={secondary}>{t('Keep them')}</button>
      </div>
    </div>
  );
}

export default function LabPauseEditor({ lab, disabled = false, onBusyChange }: {
  lab: LabPauseInfo;
  /** Another scan is running (one decode at a time). */
  disabled?: boolean;
  /** True while this editor scans the lab's audio. Pass a stable function. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const updateLab = trpc.labs.update.useMutation();
  const setPauses = trpc.labs.setPauses.useMutation();
  const ids = useId();
  const [untilText, setUntilText] = useState(lab.pauseCountUntilMs == null ? '' : formatClock(lab.pauseCountUntilMs));
  const [untilProblem, setUntilProblem] = useState(false);
  const [finding, setFinding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The pauses the last "Find pauses again" saved, while their long ones wait for the teacher's choice. */
  const [longFound, setLongFound] = useState<{ pauses: LabPause[]; scan: LabPauseScan; advice: LongPauseAdvice } | null>(null);
  const [longBusy, setLongBusy] = useState(false);

  useEffect(() => {
    if (!finding) return;
    onBusyChange?.(true);
    return () => onBusyChange?.(false);
  }, [finding, onBusyChange]);

  const scanned = lab.pauseTotal !== null;
  const needsCheck = lab.needsCheck ?? (scanned && scanNeedsCheck(lab.pauseScan, lab.pauseTotal ?? 0));

  /** Saves a "don't count pauses after" point; true when saved. */
  const saveUntil = async (value: number | null): Promise<boolean> => {
    try {
      await updateLab.mutateAsync({ id: lab.id, pauseCountUntilMs: value });
      await utils.labs.adminList.invalidate();
      setNotice(t('Saved.'));
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t('Could not save'));
      return false;
    }
  };

  const apply = async () => {
    const text = untilText.trim();
    let value: number | null;
    if (text === '') value = null;
    // Left as shown, it keeps the exact point saved (the box shows whole seconds).
    else if (lab.pauseCountUntilMs != null && text === formatClock(lab.pauseCountUntilMs)) value = lab.pauseCountUntilMs;
    else value = parseClock(text);
    setNotice(null);
    setProblem(null);
    if (value === null && text !== '') {
      setUntilProblem(true);
      return;
    }
    setUntilProblem(false);
    await saveUntil(value);
  };

  const countUntil = async (cutOffMs: number) => {
    setNotice(null);
    setProblem(null);
    setLongBusy(true);
    if (await saveUntil(cutOffMs)) {
      setUntilText(formatClock(cutOffMs));
      setUntilProblem(false);
      setLongFound(null);
    }
    setLongBusy(false);
  };

  const dontCount = async () => {
    if (!longFound) return;
    setNotice(null);
    setProblem(null);
    setLongBusy(true);
    try {
      await setPauses.mutateAsync({ id: lab.id, pauses: withoutPauses(longFound.pauses, longFound.advice.long), scan: longFound.scan });
      await utils.labs.adminList.invalidate();
      setLongFound(null);
      setNotice(t('Pauses saved.'));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setLongBusy(false);
    }
  };

  const find = async () => {
    setNotice(null);
    setProblem(null);
    setLongFound(null);
    setFinding(true);
    try {
      let found: Awaited<ReturnType<typeof scanLabUrl>>;
      try {
        found = await scanLabUrl(lab.audioUrl);
      } catch {
        setProblem(t("Could not read this lab's audio."));
        return;
      }
      try {
        // Keeps the lab's "don't count pauses after" point.
        await setPauses.mutateAsync({ id: lab.id, pauses: found.pauses, scan: found.scan });
      } catch (err) {
        setProblem(err instanceof Error ? err.message : t('Could not save'));
        return;
      }
      await utils.labs.adminList.invalidate();
      setNotice(t('Pauses saved.'));
      const advice = longPauseAdvice(found.pauses, lab.pauseCountUntilMs, lab.requiredThroughMs);
      if (advice) setLongFound({ pauses: found.pauses, scan: found.scan, advice });
    } finally {
      setFinding(false);
    }
  };

  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
      <h3 id={`${ids}-heading`} className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('Pauses')}</h3>
      {!scanned ? (
        <p className={`text-sm ${amberText}`}>{t('Not scanned')}</p>
      ) : lab.pauseTotal === 0 ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('No answer pauses found.')}</p>
      ) : (
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <p>{t('{{count}} pauses · {{counted}} count', { count: lab.pauseTotal ?? 0, counted: lab.pauseCount ?? 0 })}</p>
          {lab.pauseScan && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('Shortest pause {{short}} s · longest other silence {{long}} s', {
                short: seconds(lab.pauseScan.shortestKeptMs),
                long: seconds(lab.pauseScan.longestLeftOutMs),
              })}
            </p>
          )}
        </div>
      )}
      {scanned && needsCheck && (
        <p className={`text-sm ${amberText}`}>
          {t("Some silences are close to the cut-off, or there is sound under the pauses, so the count may be off. Compare it with the lab's transcript before you release the lab.")}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${ids}-until`} className="block text-sm text-gray-700 dark:text-gray-300">
            {t("Don't count pauses after (m:ss)")}
          </label>
          <input
            id={`${ids}-until`}
            value={untilText}
            onChange={(e) => { setUntilText(e.target.value); setUntilProblem(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}
            aria-invalid={untilProblem || undefined}
            aria-describedby={untilProblem ? `${ids}-until-error` : undefined}
            className={`${input} ${untilProblem ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
          />
        </div>
        <button type="button" onClick={() => void apply()} disabled={updateLab.isPending} className={secondary}>{t('Apply')}</button>
        <button type="button" onClick={() => void find()} disabled={finding || disabled || setPauses.isPending} className={secondary}>
          {scanned ? t('Find pauses again') : t('Find pauses')}
        </button>
      </div>
      {untilProblem && (
        <p id={`${ids}-until-error`} className="text-xs text-red-700 dark:text-red-400">{t('Type a time like 14:06, or leave it empty.')}</p>
      )}
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {finding ? <span className="text-gray-600 dark:text-gray-400">{t('Scanning…')}</span> : notice ?? ''}
      </p>
      {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      {longFound && (
        <LongPauseBanner
          advice={longFound.advice}
          busy={longBusy || finding}
          onCountUntil={(cutOffMs) => void countUntil(cutOffMs)}
          onDontCount={() => void dontCount()}
          onKeep={() => setLongFound(null)}
        />
      )}
    </section>
  );
}
