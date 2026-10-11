// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: everything turned in for one lab, whether each counts (and the
 * teacher's say over it), who still has to do it, and the listening log and
 * pause results behind each number. Each student's row is the attempt that
 * counts, with marks for the flags on their other attempts, the rule it was
 * judged by when that differs from today's, and what the page's voice meter
 * measured (information only: the page reports it).
 *
 * A test (an exam lab, v1.19.0) has no pause rule; in place of "Still to do"
 * it lists who started this form, with the Reset that gives a student one more
 * start in the set (ExamRoster).
 */
import { Fragment, useState } from 'react';
import type { LabMicStats } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { formatClock } from '../../utils/labAudio';
import ExamRoster from './ExamRoster';

const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
const green = 'text-green-700 dark:text-green-400';
const amber = 'text-amber-800 dark:text-amber-300';
const red = 'text-red-700 dark:text-red-400';
const note = 'text-xs text-gray-500 dark:text-gray-400';
const redChip = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
const amberChip = 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';

/** `labs.setCredit` takes at most this many submissions at once. */
const SET_CREDIT_MAX = 200;

const KIND_LABELS: Record<string, string> = {
  open: 'Opened the lab',
  play: 'Playing from',
  tick: 'At',
  pause: 'Paused at',
  end: 'Finished at',
  // Where the page went on without a microphone.
  nomic: 'No microphone',
};

type Translate = ReturnType<typeof useI18n>['t'];
type RowStatus = 'done' | 'redo' | 'check';
type StatusReason = 'no-mic' | 'asked' | 'teacher' | 'held' | null;

/** The order flags are shown in: the red ones (the log or the results do not add up) first. */
const FLAG_ORDER = ['skipped', 'odd-answers', 'late', 'overlap', 'constant-sound', 'noisy', 'short-answers', 'little-speech', 'no-mic'];
const byFlagOrder = (a: string, b: string) =>
  (FLAG_ORDER.indexOf(a) + 1 || FLAG_ORDER.length + 1) - (FLAG_ORDER.indexOf(b) + 1 || FLAG_ORDER.length + 1);

/** A pause result of −2: two results for the pause in one playback, so neither counted (the server's scorePauses). */
const CONFLICTED = -2;
/** "In the background for …" shows from this much time played without the page in front (a moment in the tray is normal). */
const BACKGROUND_NOTE_MS = 60_000;

/** Whether two moments (as the API sends them) are the same, null included. */
const sameTime = (a: Date | string | null, b: Date | string | null) =>
  a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime();

/** Voice in seconds, one decimal: 820 -> "0.8". */
const voiceSeconds = (ms: number) => (ms / 1000).toFixed(1);

/** A level in dBFS as a whole number with a real minus sign: −47.6 -> "−48". */
const decibels = (db: number) => String(Math.round(db)).replace('-', '−');

/**
 * A flag's chip: its label, colour and, for the new ones, what it means.
 * `oddCount` is how many pause results did not add up (rejected or in
 * conflict); 0 when the results only failed the no-microphone check.
 */
function flagChip(flag: string, t: Translate, oddCount = 0): { label: string; tone: string; title?: string } {
  switch (flag) {
    case 'skipped': return { label: t('Skipped ahead'), tone: redChip };
    case 'little-speech': return { label: t('Little speech'), tone: amberChip };
    case 'odd-answers': return {
      label: t('Odd results'),
      tone: redChip,
      title: oddCount > 0
        ? t("{{count}} pause result(s) don't add up: two results for one pause in one playback, or answers the page could not have sent. They did not count. Check the log.", { count: oddCount })
        : t('The answers add up to more voice than the page heard in all. Check the log.'),
    };
    case 'late': return {
      label: t('Sent late'),
      tone: redChip,
      title: t('Part of the listening log reached the server long after it happened, so the pauses in it did not count. The page may have been changed. Check the log.'),
    };
    case 'overlap': return {
      label: t('Two at once'),
      tone: amberChip,
      title: t('Another window of this student was playing a lab at the same time.'),
    };
    case 'constant-sound': return {
      label: t('Sound in every pause'),
      tone: amberChip,
      title: t('There was sound through almost every pause, start to end. That is more like music, a video or a second window than answers.'),
    };
    case 'noisy': return {
      label: t('Voice outside the pauses'),
      tone: amberChip,
      title: t('The mic heard a voice outside the pauses about as often as in them: a phone or video, a neighbour, or speakers instead of headphones.'),
    };
    case 'short-answers': return {
      label: t('Short answers'),
      tone: amberChip,
      title: t("This student's answers were much shorter than the class's: often one sound in each pause."),
    };
    case 'no-mic': return { label: t('No microphone'), tone: amberChip };
    default: return { label: flag, tone: amberChip };
  }
}

/** What held a row for the teacher, by the flags' names: "Odd results, Two at once". */
const heldLabels = (heldFor: readonly string[] | null | undefined, t: Translate) =>
  [...(heldFor ?? [])].sort(byFlagOrder).map((flag) => flagChip(flag, t).label).join(', ');

/** Why a `check` row waits for the teacher. `held` names what held it. */
function checkReason(reason: StatusReason, t: Translate, held: string): string | null {
  if (reason === 'no-mic') return t('No microphone');
  if (reason === 'asked') return t("Says the mic didn't hear them");
  // A hold whose list could not be read still waits for the teacher.
  if (reason === 'held') return held ? t('Held: {{flags}}', { flags: held }) : t('Held for you');
  return null;
}

/** Pause results that were in conflict (−2). */
const conflictedPauses = (results: readonly [number, number][] | null) =>
  (results ?? []).filter(([, voicedMs]) => voicedMs === CONFLICTED).length;

/** Voice in the counted pauses: the best pass of each, nothing for one not reported or in conflict. */
const voiceInPauses = (results: readonly [number, number][]) =>
  results.reduce((sum, [, voicedMs]) => sum + Math.max(0, voicedMs), 0);

/**
 * How many of a student's other attempts carry each flag, for the marks on the
 * row that counts. "No microphone" is left out: a mic that failed, then a redo
 * that worked, is what should happen, not a mark against the student.
 */
function otherAttemptFlags(own: readonly { id: number; flags: string[] }[], countingId: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const attempt of own) {
    if (attempt.id === countingId) continue;
    for (const flag of new Set(attempt.flags)) {
      if (flag !== 'no-mic') counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
  }
  return counts;
}

/** The microphone's processing as the lab page's browser reported it. */
function processingText(processing: NonNullable<LabMicStats['processing']>, t: Translate): string {
  const state = (on: boolean | undefined) => (on === undefined ? t('not reported') : on ? t('on') : t('off'));
  return t('Mic processing: echo cancellation {{echo}}, noise suppression {{noise}}, auto gain {{gain}}', {
    echo: state(processing.echoCancellation),
    noise: state(processing.noiseSuppression),
    gain: state(processing.autoGainControl),
  });
}

/** What the page's voice meter measured that the row does not show, under the log. */
function MicDetails({ stats }: { stats: LabMicStats }) {
  const { t } = useI18n();
  return (
    <ul aria-label={t('Microphone')} className="mb-3 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
      <li>{t('Non-voice sound in the pauses: {{time}}', { time: formatClock(stats.loudNotVoiceInPausesMs) })}</li>
      {stats.processing && <li>{processingText(stats.processing, t)}</li>}
    </ul>
  );
}

/** One student's listening log for this lab, session by session. */
function ListenLog({ labId, userId }: { labId: number; userId: number }) {
  const { t } = useI18n();
  const { data, isLoading, error } = trpc.labs.listenLog.useQuery({ labId, userId });
  if (isLoading) return <div className="animate-pulse text-gray-500 dark:text-gray-400 text-sm">{t('Loading...')}</div>;
  if (error) return <p role="alert" className={`text-sm ${red}`}>{error.message}</p>;
  if (!data || data.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No listening was logged for this student.')}</p>;

  return (
    <div className="space-y-4">
      {data.map((session) => {
        let previous: { positionMs: number; clientMs: number } | null = null;
        return (
          <div key={session.startedAt} className="text-sm">
            <p className="font-medium text-gray-800 dark:text-gray-200">
              {t('Opened {{when}}', { when: new Date(session.startedAt).toLocaleString() })}
              {' · '}
              {session.started
                ? t('heard through {{time}}', { time: formatClock(session.summary.heardThroughMs) })
                : t('never started')}
              {session.summary.skips > 0 && (
                <span className={red}> · {t('{{count}} skip(s)', { count: session.summary.skips })}</span>
              )}
              {session.submitted ? ` · ${t('submitted')}` : ` · ${t('not submitted')}`}
            </p>
            <ol className="mt-1 max-h-48 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-700 pl-3">
              {session.events.map((e, i) => {
                // Red means the audio moved further than the page's clock did: a skip.
                // Going back is normal. Server arrival times are not used: a late packet is not a skip.
                const ahead = e.kind !== 'open' && previous !== null
                  && e.positionMs - previous.positionMs > e.clientMs - previous.clientMs + 1500;
                const label = e.kind === 'seek'
                  ? (previous !== null && e.positionMs < previous.positionMs ? 'Went back to' : 'Jumped to')
                  : (KIND_LABELS[e.kind] ?? e.kind);
                if (e.kind !== 'open') previous = e;
                return (
                  <li key={i} className={ahead ? `${red} font-semibold` : ''}>
                    {new Date(e.at).toLocaleTimeString()} — {t(label)}{e.kind === 'open' ? '' : ` ${formatClock(e.positionMs)}`}
                    {(e.answers ?? []).map(([startMs, voicedMs]) => (
                      ` · ${t('voice in the pause at {{time}}: {{seconds}} s', { time: formatClock(startMs), seconds: voiceSeconds(voicedMs) })}`
                    )).join('')}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One square per counted pause: green answered, amber under the floor, gray not
 * reported, red when two results came for it in one playback (neither counted).
 */
function PauseStrip({ results, floorMs }: { results: [number, number][]; floorMs: number }) {
  const { t } = useI18n();
  return (
    <ol aria-label={t('Pauses answered')} className="flex flex-wrap gap-0.5 mb-3">
      {results.map(([startMs, voicedMs], i) => {
        const at = { n: i + 1, time: formatClock(startMs) };
        const title = voicedMs === CONFLICTED
          ? t('Pause {{n}} at {{time}}: two results for one pause in one playback; neither counted.', at)
          : voicedMs < 0
            ? t('Pause {{n}} at {{time}}: not reported', at)
            : t('Pause {{n}} at {{time}}: {{seconds}} s of voice', { ...at, seconds: voiceSeconds(voicedMs) });
        const tone = voicedMs === CONFLICTED
          ? 'bg-red-600 dark:bg-red-500'
          : voicedMs < 0
            ? 'bg-gray-300 dark:bg-gray-600'
            : voicedMs >= floorMs ? 'bg-green-600 dark:bg-green-500' : 'bg-amber-500 dark:bg-amber-400';
        return (
          <li key={`${startMs}-${i}`}>
            <span role="img" aria-label={title} title={title} className={`block w-2 h-2 rounded-sm ${tone}`} />
          </li>
        );
      })}
    </ol>
  );
}

export default function LabReview({ labId, onBack, onOpenSet }: {
  labId: number;
  onBack: () => void;
  /** Opens an exam set's whole list of students and resets (a test's Review page links to it). */
  onOpenSet?: (set: string) => void;
}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.labs.submissions.useQuery({ labId });
  const missingQuery = trpc.labs.missing.useQuery({ labId });
  const missing = missingQuery.data;
  const setCredit = trpc.labs.setCredit.useMutation();
  const [showAll, setShowAll] = useState(false);
  const [openLog, setOpenLog] = useState<number | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (error) {
    return (
      <div className="space-y-4">
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
          {error.message}
        </div>
        <button onClick={onBack} className={secondary}>{t('Back to labs')}</button>
      </div>
    );
  }
  if (isLoading || !data) return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  const { lab, submissions, summary } = data;
  /** The exam set this lab is a form of (null: a practice lab). */
  const examSet = lab.examSet ?? null;

  /** true gives credit, false takes it away (or asks for a redo), null goes back to the automatic result. */
  const giveCredit = async (submissionIds: number[], credit: boolean | null) => {
    if (submissionIds.length === 0) return;
    setSaving(true);
    setCreditError(null);
    try {
      for (let i = 0; i < submissionIds.length; i += SET_CREDIT_MAX) {
        await setCredit.mutateAsync({ submissionIds: submissionIds.slice(i, i + SET_CREDIT_MAX), credit });
      }
    } catch (err) {
      setCreditError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setSaving(false);
      void utils.labs.submissions.invalidate({ labId });
      void utils.labs.adminList.invalidate();
    }
  };

  const bulk = (ids: number[]) => {
    if (window.confirm(t('Give credit to {{count}} student(s)?', { count: ids.length }))) void giveCredit(ids, true);
  };

  // Rows come newest first per student. The row that describes each student is the one that
  // counts (the newest with credit, else the newest), as on the summary line, Still to do, the
  // student's own Labs page and the CSV: its result is where they stand. It comes first, with
  // marks for the flags on the student's other attempts, which show with "Show all attempts"
  // (newest first; an attempt after the one that counts is not "earlier").
  const own = new Map<number, typeof submissions>();
  for (const s of submissions) own.set(s.userId, [...(own.get(s.userId) ?? []), s]);
  const countingOf = (mine: typeof submissions) => mine.find((s) => s.effectiveCredit) ?? mine[0];
  const rows = [...own.values()].flatMap((mine) => {
    const counting = countingOf(mine);
    return [
      { ...counting, counting: true, marks: otherAttemptFlags(mine, counting.id) },
      ...mine.filter((s) => s !== counting).map((s) => ({ ...s, counting: false, marks: new Map<string, number>() })),
    ];
  }).filter((s) => showAll || s.counting);
  const byId = new Map(submissions.map((s) => [s.id, s]));
  /** The teacher's decision on a student is theirs, not one attempt's: every attempt that counts loses its credit. */
  const creditedIds = (userId: number) => (own.get(userId) ?? []).filter((s) => s.effectiveCredit).map((s) => s.id);
  /** Undo takes back one decision: every attempt of the student it was made on at once. */
  const sameDecision = (row: typeof submissions[number]) => (own.get(row.userId) ?? [])
    .filter((s) => s.creditOverride === row.creditOverride && sameTime(s.creditOverrideAt, row.creditOverrideAt))
    .map((s) => s.id);
  const studentsTurnedIn = new Set(submissions.filter((s) => !s.isTeacher).map((s) => s.userId)).size;

  // Each student's standing, with what their counting row says about it: the need it was judged
  // by, and what held it.
  const standing = summary.byStudent.map((s) => {
    const row = byId.get(s.countingRowId);
    return { ...s, needed: row?.needed ?? null, held: s.reason === 'held' ? heldLabels(row?.heldFor, t) : '' };
  });
  const waiting = standing.filter((s) => s.status === 'check');
  // A held lab waits for a look at it, not for credit in bulk.
  const waitingBulk = waiting.filter((s) => s.reason !== 'held');
  const heldCount = waiting.length - waitingBulk.length;
  const redo = standing.filter((s) => s.status === 'redo');
  // A redo the teacher asked for stays one: "all who need a redo" means the automatic ones.
  const redoAutomatic = redo.filter((s) => s.reason !== 'teacher');
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  // Today's rule applies to labs started from now on; each row keeps the rule it began with.
  const required = formatClock(lab.requiredThroughMs);
  const header = lab.pauseCount === null ? null
    : lab.pauseCount === 0
      ? t('Must hear through {{required}} · speak for at least {{voice}}', { required, voice: formatClock(lab.minimumVoicedMs) })
      : lab.settings.minAnsweredPct <= 0
        ? t('Must hear through {{required}} · the pause rule is off, so labs started from now on all count', { required })
        : t('Must hear through {{required}} · labs started from now on count with {{needed}} of {{total}} pauses answered', {
          required, needed: lab.needed ?? 0, total: lab.pauseCount,
        });

  /** The rule a scored row was judged by, in full (its cell's title). */
  const ruleTitle = (s: typeof submissions[number]): string | undefined => {
    if (s.pausesCounted == null || s.minAnsweredPct == null) return undefined;
    if (s.minAnsweredPct <= 0) return t('This attempt started while the pause rule was off, so it counted whatever it answered.');
    return t('This attempt was judged by the rule when it started: {{pct}}% of the pauses ({{needed}} of {{total}}), {{seconds}} s of voice in each.', {
      pct: s.minAnsweredPct, needed: s.needed ?? 0, total: s.pausesCounted, seconds: (s.voicePerPauseMs ?? lab.settings.voicePerPauseMs) / 1000,
    });
  };
  /**
   * The row's rule where it differs from today's, or null: the rule off first (a 0% row
   * needed 0, which is not the point), else the need and the voice in each pause.
   */
  const ruleDifference = (s: typeof submissions[number]): string | null => {
    if (s.pausesCounted == null || s.minAnsweredPct == null) return null;
    const rowOff = s.minAnsweredPct <= 0;
    if (rowOff && lab.settings.minAnsweredPct > 0) return t('the rule was off');
    const parts: string[] = [];
    if (!rowOff && s.needed !== lab.needed) parts.push(t('needed {{needed}}', { needed: s.needed ?? 0 }));
    if (s.voicePerPauseMs != null && s.voicePerPauseMs !== lab.settings.voicePerPauseMs) {
      parts.push(t('{{seconds}} s each', { seconds: s.voicePerPauseMs / 1000 }));
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{lab.title}</h2>
          {examSet !== null ? (
            // A test: no pause rule, one start per student across its set.
            <>
              <p className={`text-sm font-medium ${amber}`}>
                {t("Test · exam set {{set}}: one start per student across the set's forms.", { set: examSet })}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('Must hear through')} {required}</p>
            </>
          ) : header !== null ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">{header}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('Must hear through')} {required}</p>
              <p className={`text-sm ${amber}`}>
                {t('No pause list yet: this lab uses the old rule (speak for at least {{voice}}).', { voice: formatClock(lab.minimumVoicedMs) })}
              </p>
            </>
          )}
        </div>
        <button onClick={onBack} className={secondary}>{t('Back to labs')}</button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {t('Turned in ({{count}})', { count: studentsTurnedIn })}
          </h3>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t('Show all attempts')}
          </label>
        </div>
        {summary.byStudent.length > 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {t('{{count}} done · {{redo}} need a redo · {{check}} waiting for you', {
              count: summary.done, redo: summary.redo, check: summary.check,
            })}
          </p>
        )}
        {(waitingBulk.length > 0 || redoAutomatic.length > 0 || heldCount > 0) && (
          <div className="mb-4 space-y-2">
            {(waitingBulk.length > 0 || redoAutomatic.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {waitingBulk.length > 0 && (
                  <button onClick={() => bulk(waitingBulk.map((s) => s.countingRowId))} disabled={saving} className={secondary}>
                    {t('Give credit to all {{count}} waiting for you', { count: waitingBulk.length })}
                  </button>
                )}
                {redoAutomatic.length > 0 && (
                  <button onClick={() => bulk(redoAutomatic.map((s) => s.countingRowId))} disabled={saving} className={secondary}>
                    {t('Give credit to all {{count}} who need a redo', { count: redoAutomatic.length })}
                  </button>
                )}
              </div>
            )}
            {heldCount > 0 && (
              <p className={`text-sm ${amber}`}>
                {t('Held labs ({{count}}) are not in “Give credit to all”: look at each one.', { count: heldCount })}
              </p>
            )}
          </div>
        )}
        {creditError && (
          <div role="alert" className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
            {creditError}
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t('Nobody has turned this lab in yet.')}</p>
        ) : (
          // relative: the table's screen-reader-only texts are positioned, and would otherwise sit
          // outside the scroll box and widen a phone's page to the whole table.
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('Student')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Turned in on')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Heard through')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Pauses answered')}</th>
                  <th
                    className="py-2 pr-3 font-medium"
                    title={t('Voice in the counted pauses (the best pass of each), and all the voice the microphone heard while the lab played.')}
                  >
                    {t('Voice heard')}
                  </th>
                  <th className="py-2 pr-3 font-medium">{t('Result')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Flags')}</th>
                  <th className="py-2 font-medium"><span className="sr-only">{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((s) => {
                  const override = s.creditOverride === true
                    ? t('You gave credit')
                    : s.creditOverride === false
                      ? (s.credit ? t('You took credit away') : t('You asked for a redo'))
                      : null;
                  // On the row that describes the student, the buttons act for the student; on another attempt, for it alone.
                  const takeAway = s.counting ? [...new Set([s.id, ...creditedIds(s.userId)])] : [s.id];
                  const undo = s.counting ? sameDecision(s) : [s.id];
                  const name = s.studentName;
                  const stats = s.micStats;
                  const difference = ruleDifference(s);
                  const reason = checkReason(s.statusReason, t, heldLabels(s.heldFor, t));
                  const oddCount = Math.max(s.rejectedAnswers, conflictedPauses(s.pauseResults));
                  // A flag also on other attempts says so on its own chip; the rest get a mark of their own.
                  const marks = [...s.marks].filter(([flag]) => !(s.flags as readonly string[]).includes(flag)).sort(([a], [b]) => byFlagOrder(a, b));
                  return (
                    <Fragment key={s.id}>
                      <tr className={s.counting ? '' : 'opacity-60'}>
                        <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                          {s.studentName}
                          {s.isTeacher && <span className="text-xs text-gray-500 dark:text-gray-400"> · {t('your test run')}</span>}
                          {s.counting && s.attempts > 1 && <span className="text-xs text-gray-500 dark:text-gray-400"> · {t('{{count}} attempts', { count: s.attempts })}</span>}
                          {!s.counting && <span className="text-xs text-gray-500 dark:text-gray-400"> · {t('another attempt')}</span>}
                        </td>
                        <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {new Date(s.submittedAt).toLocaleString()}
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('{{minutes}} min after opening', { minutes: Math.round(s.elapsedMs / 60000) })}</div>
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                          {formatClock(s.listenedCoveredMs)}
                          {stats && stats.unfocusedPlayedMs >= BACKGROUND_NOTE_MS && (
                            <div className={`${note} whitespace-nowrap`}>
                              {t('In the background for {{time}}', { time: formatClock(stats.unfocusedPlayedMs) })}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap" title={ruleTitle(s)}>
                          {s.pausesCounted == null
                            ? '—'
                            : t('{{answered}} of {{total}}', { answered: s.pausesAnswered ?? 0, total: s.pausesCounted })}
                          {difference && <div className={note}>{difference}</div>}
                          {stats && stats.levelOnlyAnswered != null && s.pausesCounted != null && (
                            <div className={note}>
                              {t('Old meter: {{n}} of {{total}} pauses', { n: stats.levelOnlyAnswered, total: s.pausesCounted })}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {/* Not scored (before the pause rule, or no pauses to count): the page's total, as before. */}
                          {s.pauseResults === null || s.pauseResults.length === 0 ? formatClock(s.voicedMs) : (
                            <>
                              {t('{{time}} in the pauses', { time: formatClock(voiceInPauses(s.pauseResults)) })}
                              <div className={note}>{t('{{time}} while playing', { time: formatClock(s.voicedMs) })}</div>
                            </>
                          )}
                          {stats && stats.ambientDbP50 !== null && stats.gateDbP50 !== null && (
                            <div className={note}>
                              {t('Room level {{db}} dB · a voice needed {{gate}} dB', { db: decibels(stats.ambientDbP50), gate: decibels(stats.gateDbP50) })}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`font-medium ${s.status === 'done' ? green : amber}`}>
                            {s.status === 'done' ? t('Done') : s.status === 'check' ? t('Check it') : t('Needs redo')}
                          </span>
                          {s.status === 'check' && reason && (
                            <div className="text-xs text-gray-600 dark:text-gray-400">{reason}</div>
                          )}
                          {override && (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {override}{s.creditOverrideAt ? ` · ${formatDate(s.creditOverrideAt)}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {s.flags.map((flag) => {
                              const chip = flagChip(flag, t, oddCount);
                              const others = s.marks.get(flag);
                              return (
                                <span key={flag} title={chip.title} className={`px-2 py-0.5 rounded text-xs font-medium ${chip.tone}`}>
                                  {others ? t('{{flag}} · also on {{count}} other', { flag: chip.label, count: others }) : chip.label}
                                  {/* The meaning, for screen readers (a title never reaches the keyboard). */}
                                  {chip.title && <span className="sr-only">: {chip.title}</span>}
                                </span>
                              );
                            })}
                            {marks.map(([flag, count]) => (
                              <span key={`mark-${flag}`} data-flag-mark={flag} className={`px-2 py-0.5 rounded text-xs font-medium border border-dashed border-current ${flagChip(flag, t).tone}`}>
                                {t('{{flag}} · on {{count}} other attempt(s)', { flag: flagChip(flag, t).label, count })}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 whitespace-nowrap text-right space-x-2">
                          {s.creditOverride !== null ? (
                            <button onClick={() => void giveCredit(undo, null)} disabled={saving} className={secondary}
                              aria-label={t('Undo: {{name}}', { name })}>{t('Undo')}</button>
                          ) : s.status === 'done' ? (
                            <button onClick={() => void giveCredit(takeAway, false)} disabled={saving} className={secondary}
                              aria-label={t('Take credit away from {{name}}', { name })}>{t('Take credit away')}</button>
                          ) : (
                            <>
                              <button onClick={() => void giveCredit([s.id], true)} disabled={saving} className={secondary}
                                aria-label={t('Give credit to {{name}}', { name })}>{t('Give credit')}</button>
                              {s.status === 'check' && (
                                <button onClick={() => void giveCredit(takeAway, false)} disabled={saving} className={secondary}
                                  aria-label={t('Ask for a redo: {{name}}', { name })}>{t('Ask for a redo')}</button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => setOpenLog((current) => (current === s.id ? null : s.id))}
                            aria-expanded={openLog === s.id}
                            aria-label={t('Log: {{name}}', { name })}
                            className={secondary}
                          >
                            {t('Log')}
                          </button>
                        </td>
                      </tr>
                      {openLog === s.id && (
                        <tr>
                          <td colSpan={8} className="py-3 px-2 bg-gray-50 dark:bg-gray-900/40">
                            {s.pauseResults && s.pauseResults.length > 0 && (
                              <PauseStrip
                                results={s.pauseResults}
                                floorMs={s.voicePerPauseMs ?? lab.settings.voicePerPauseMs}
                              />
                            )}
                            {stats && <MicDetails stats={stats} />}
                            <ListenLog labId={lab.id} userId={s.userId} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {examSet !== null ? (
        <ExamRoster examSet={examSet} labId={lab.id} onOpenSet={onOpenSet} />
      ) : (
        <StillToDo
          missing={missing}
          missingError={missingQuery.error?.message ?? null}
          redo={[...redo].sort(byName)}
          waiting={[...waiting].sort(byName)}
        />
      )}
    </div>
  );
}

interface StudentStanding {
  userId: number;
  name: string;
  status: RowStatus;
  reason: StatusReason;
  answered: number | null;
  counted: number | null;
  /** The pauses the counting row needed, by the rule it was judged by. */
  needed: number | null;
  /** What held the counting row, by the flags' names ('' when not held). */
  held: string;
}

/** Who still has to do this lab: never turned it in, need a redo, or wait for the teacher. */
function StillToDo({ missing, missingError, redo, waiting }: {
  missing: {
    id: number;
    name: string;
    opened: boolean;
    started: boolean;
    heardThroughMs: number | null;
    skips: number;
    lastSeenAt: number | null;
  }[] | undefined;
  missingError: string | null;
  redo: StudentStanding[];
  waiting: StudentStanding[];
}) {
  const { t } = useI18n();
  const count = missing ? missing.length + redo.length + waiting.length : null;
  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {count === null ? t('Still to do') : t('Still to do ({{count}})', { count })}
      </h3>
      {missingError ? (
        <p role="alert" className={`text-sm ${red}`}>{missingError}</p>
      ) : !missing ? (
        <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      ) : count === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t('Everyone is done.')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
          {missing.map((m) => (
            <li key={`missing-${m.id}`} className="py-2 flex flex-wrap justify-between gap-2">
              <span className="text-gray-900 dark:text-gray-100">{m.name}</span>
              <span className="text-gray-600 dark:text-gray-400">
                {!m.opened || m.lastSeenAt === null
                  ? t('Never opened it')
                  : !m.started
                    ? t('Opened it, never started · last seen {{when}}', { when: new Date(m.lastSeenAt).toLocaleString() })
                    : t('Reached {{time}} · last seen {{when}}', {
                      time: formatClock(m.heardThroughMs ?? 0),
                      when: new Date(m.lastSeenAt).toLocaleString(),
                    })}
                {m.skips > 0 && <span className={red}> · {t('{{count}} skip(s)', { count: m.skips })}</span>}
              </span>
            </li>
          ))}
          {redo.map((s) => (
            <li key={`redo-${s.userId}`} className="py-2 flex flex-wrap justify-between gap-2">
              <span className="text-gray-900 dark:text-gray-100">{s.name}</span>
              <span className={amber}>
                {s.reason === 'teacher'
                  ? t('Needs redo · you asked for it')
                  : s.answered != null && s.counted != null
                    ? t('Needs redo · {{answered}} of {{total}} pauses (needed {{needed}})', { answered: s.answered, total: s.counted, needed: s.needed ?? 0 })
                    : t('Needs redo')}
              </span>
            </li>
          ))}
          {waiting.map((s) => (
            <li key={`check-${s.userId}`} className="py-2 flex flex-wrap justify-between gap-2">
              <span className="text-gray-900 dark:text-gray-100">{s.name}</span>
              <span className={amber}>
                {s.reason === 'no-mic'
                  ? t('Waiting for you · no microphone')
                  : s.reason === 'held'
                    ? (s.held ? t('Waiting for you · held: {{flags}}', { flags: s.held }) : t('Waiting for you · held'))
                    : t("Waiting for you · says the mic didn't hear them")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
