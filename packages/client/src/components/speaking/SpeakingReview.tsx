// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: every recording turned in for one speaking task, its grade (from
 * the teacher or a grading agent), and who has not recorded it yet.
 *
 * Since v1.16.0 each take carries what the server found when it arrived:
 * red for audio posted before (the student's own, a classmate's, the model),
 * amber for a page that timed it much longer than the file or heard very
 * little voice, grey for a file it could not read.
 */
import { Fragment, useId, useState, type FormEvent } from 'react';
import { RED_SPEAKING_FLAGS, type LabMicProcessing, type SpeakingFlag } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { formatClock } from '../../utils/labAudio';

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';

/** `gradedBy` for a grade given here; a grading agent sends its own name. */
const TEACHER = 'teacher';

const redChip = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
const amberChip = 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
const greyChip = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

type Translate = ReturnType<typeof useI18n>['t'];
type FormatDate = ReturnType<typeof useI18n>['formatDate'];

interface AudioMatch {
  taskTitle: string;
  studentName: string;
  submittedAt: Date | string;
}

/** What a take's chips need to know about it. */
interface Checked {
  durationMs: number;
  clientDurationMs?: number | null;
  flags?: SpeakingFlag[];
  sameFileAs?: AudioMatch | null;
  copiedFrom?: AudioMatch | null;
}

/** A flag's chip: its words (naming the take it matches, when that is still there) and colour. */
function flagChip(flag: SpeakingFlag, take: Checked, t: Translate, formatDate: FormatDate): { label: string; tone: string; title?: string } {
  switch (flag) {
    case 'same-file': return {
      label: take.sameFileAs
        ? t('Same file as the recording for “{{task}}” ({{date}})', { task: take.sameFileAs.taskTitle, date: formatDate(take.sameFileAs.submittedAt) })
        : t('Same file as an earlier recording'),
      tone: redChip,
    };
    case 'copied': return {
      label: take.copiedFrom
        ? t('Same file as {{name}}’s recording', { name: take.copiedFrom.studentName })
        : t('Same file as another student’s recording'),
      tone: redChip,
      title: take.copiedFrom
        ? t('Their recording for “{{task}}” ({{date}}).', { task: take.copiedFrom.taskTitle, date: formatDate(take.copiedFrom.submittedAt) })
        : undefined,
    };
    case 'model': return { label: t('This is the model recording'), tone: redChip };
    case 'length-mismatch': return {
      label: t('The page timed it at {{claimed}}; the file is {{actual}}', {
        claimed: formatClock(take.clientDurationMs ?? 0), actual: formatClock(take.durationMs),
      }),
      tone: amberChip,
    };
    case 'little-speech': return { label: t('Very little speaking'), tone: amberChip };
    case 'unmeasured': return { label: t('Length not checked: the file could not be read'), tone: greyChip };
  }
}

/** "Echo cancellation: Off · Noise suppression: Off · 48 kHz": what the student's browser applied. */
function micProcessing(settings: LabMicProcessing, t: Translate): string {
  const onOff = (on: boolean) => (on ? t('On') : t('Off'));
  const parts: string[] = [];
  if (settings.echoCancellation !== undefined) parts.push(`${t('Echo cancellation')}: ${onOff(settings.echoCancellation)}`);
  if (settings.noiseSuppression !== undefined) parts.push(`${t('Noise suppression')}: ${onOff(settings.noiseSuppression)}`);
  if (settings.autoGainControl !== undefined) parts.push(`${t('Automatic gain')}: ${onOff(settings.autoGainControl)}`);
  if (settings.voiceIsolation !== undefined) parts.push(`${t('Voice isolation')}: ${onOff(settings.voiceIsolation)}`);
  if (settings.sampleRate !== undefined) parts.push(`${Math.round(settings.sampleRate / 100) / 10} kHz`);
  return parts.join(' · ');
}

interface Submission {
  id: number;
  studentName: string;
  gradeScore: number | null;
  gradeDetails: string | null;
  gradeFeedback: string | null;
  gradedBy: string | null;
  gradedAt: Date | string | null;
}

const formatScore = (score: number) => (Number.isInteger(score) ? String(score) : score.toFixed(1));

/** Pretty-printed when it is JSON, as stored otherwise. */
function prettyDetails(details: string): string {
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

function GradePanel({ submission, taskId }: { submission: Submission; taskId: number }) {
  const { t } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const grade = trpc.speaking.grade.useMutation({
    // Awaited, so the panel shows the new grade by the time the button is free again.
    onSuccess: () => Promise.all([
      utils.speaking.submissions.invalidate({ taskId }),
      utils.speaking.adminList.invalidate(),
    ]),
  });
  const current = submission.gradeScore;
  const graded = current !== null;
  const [score, setScore] = useState(current === null ? '' : formatScore(current));
  const [feedback, setFeedback] = useState(submission.gradeFeedback ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const grader = submission.gradedBy === TEACHER
    ? t('graded by you')
    : submission.gradedBy
      ? t('graded by {{grader}}', { grader: submission.gradedBy })
      : t('grader unknown');
  // Students see only the teacher's grades: another grader's waits for Save.
  const hiddenFromStudent = graded && submission.gradedBy !== TEACHER;

  const save = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(score.trim().replace(',', '.'));
    if (score.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      setError(t('Enter a score from 0 to 100.'));
      return;
    }
    setError(null);
    setNotice(null);
    grade.mutate(
      { submissionId: submission.id, score: value, feedback: feedback.trim() || null, gradedBy: TEACHER },
      { onSuccess: () => setNotice(t('Grade saved.')), onError: (err) => setError(err.message) },
    );
  };

  const clear = () => {
    setError(null);
    setNotice(null);
    grade.mutate(
      { submissionId: submission.id, score: null, gradedBy: TEACHER },
      {
        onSuccess: () => { setScore(''); setFeedback(''); setNotice(t('Grade cleared.')); },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 text-sm">
        <h4 className="font-semibold text-gray-900 dark:text-gray-100">{t('Grade')}</h4>
        {current !== null ? (
          <>
            <p className="text-gray-800 dark:text-gray-200">
              <span className="font-medium tabular-nums">{t('{{score}} out of 100', { score: formatScore(current) })}</span>
              {' · '}{grader}
              {submission.gradedAt && ` · ${new Date(submission.gradedAt).toLocaleString()}`}
            </p>
            {hiddenFromStudent && (
              <p className="text-amber-800 dark:text-amber-300">{t("The student can't see this grade until you save it.")}</p>
            )}
            {submission.gradeFeedback && (
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{submission.gradeFeedback}</p>
            )}
            {submission.gradeDetails && (
              <details>
                <summary className="cursor-pointer text-gray-700 dark:text-gray-300">{t('Grader details')}</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-xs text-gray-800 dark:text-gray-200">
                  {prettyDetails(submission.gradeDetails)}
                </pre>
              </details>
            )}
          </>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">{t('Not graded yet.')}</p>
        )}
      </div>

      <form onSubmit={save} noValidate className="space-y-2">
        <div>
          <label htmlFor={`${id}-score`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('Score (0–100)')}</label>
          <input
            id={`${id}-score`}
            inputMode="decimal"
            className={`${input} mt-1 w-24 tabular-nums`}
            value={score}
            disabled={grade.isPending}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-feedback`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('Comment for the student (they will see it)')}</label>
          <textarea
            id={`${id}-feedback`}
            rows={3}
            maxLength={4000}
            className={`${input} mt-1 block w-full`}
            value={feedback}
            disabled={grade.isPending}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {notice && <p role="status" className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={grade.isPending} className={primary}>{t('Save grade')}</button>
          {graded && (
            <button type="button" onClick={clear} disabled={grade.isPending} className={secondary}>{t('Clear grade')}</button>
          )}
        </div>
      </form>
    </div>
  );
}

export default function SpeakingReview({ taskId, onBack }: { taskId: number; onBack: () => void }) {
  const { t, formatDate } = useI18n();
  const { data, isLoading, error } = trpc.speaking.submissions.useQuery({ taskId });
  const missingQuery = trpc.speaking.missing.useQuery({ taskId });
  const missing = missingQuery.data;
  const [showEarlier, setShowEarlier] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  if (error) {
    return (
      <div className="space-y-4">
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
          {error.message}
        </div>
        <button onClick={onBack} className={secondary}>{t('Back to speaking tasks')}</button>
      </div>
    );
  }
  if (isLoading || !data) return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  const { task, submissions } = data;

  // Rows come newest-first per student; the first per student is the one that counts.
  const seen = new Set<number>();
  const rows = submissions.map((s) => {
    const latest = !seen.has(s.userId);
    seen.add(s.userId);
    const own = (s.flags ?? []).map((flag) => flagChip(flag, s, t, formatDate));
    // A copy turned in earlier and recorded over still shows on the take that counts; a quiet
    // or mistimed earlier take does not (recording again was the right thing to do).
    const carried: { label: string; tone: string; title?: string }[] = [];
    if (latest) {
      for (const earlier of submissions) {
        if (earlier.userId !== s.userId || earlier.id === s.id) continue;
        for (const flag of earlier.flags ?? []) {
          if (!RED_SPEAKING_FLAGS.includes(flag)) continue;
          const chip = flagChip(flag, earlier, t, formatDate);
          if (![...own, ...carried].some((c) => c.label === chip.label)) carried.push(chip);
        }
      }
    }
    return { ...s, latest, chips: [...own, ...carried.map((c) => ({ ...c, label: t('{{flag}} · earlier attempt', { flag: c.label }) }))] };
  }).filter((s) => showEarlier || s.latest);
  const studentsTurnedIn = new Set(submissions.filter((s) => !s.isTeacher).map((s) => s.userId)).size;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 wrap-anywhere">{task.title}</h2>
          {task.targetSeconds !== null && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('Target length: {{time}}', { time: formatClock(task.targetSeconds * 1000) })}
            </p>
          )}
        </div>
        <button onClick={onBack} className={secondary}>{t('Back to speaking tasks')}</button>
      </div>

      {(task.referenceText || task.modelAudioUrl) && (
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
          {task.modelAudioUrl && (
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('Model recording')}</h3>
              <audio controls preload="none" src={task.modelAudioUrl} aria-label={t('Model recording')} className="max-w-full" />
            </div>
          )}
          {task.referenceText && (
            <details>
              <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">{t('Reference text')}</summary>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200">{task.referenceText}</p>
            </details>
          )}
        </section>
      )}

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {t('Turned in ({{count}})', { count: studentsTurnedIn })}
          </h3>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={showEarlier} onChange={(e) => setShowEarlier(e.target.checked)} />
            {t('Show earlier attempts')}
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t('Nobody has recorded this task yet.')}</p>
        ) : (
          // relative: keeps the table's sr-only texts inside the scroll box, not widening a phone's page.
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('Student')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Turned in on')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Length')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Spoke for')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Grade')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((s) => (
                  <Fragment key={s.id}>
                    <tr className={s.latest ? '' : 'opacity-60'}>
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                        {s.studentName}
                        {s.isTeacher && <span className="text-xs text-gray-400"> · {t('your test run')}</span>}
                        {s.latest && s.attempts > 1 && <span className="text-xs text-gray-400"> · {t('{{count}} attempts', { count: s.attempts })}</span>}
                        {!s.latest && <span className="text-xs text-gray-400"> · {t('earlier')}</span>}
                        {s.chips.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {s.chips.map((chip) => (
                              <span key={chip.label} title={chip.title} className={`px-2 py-0.5 rounded text-xs font-medium ${chip.tone}`}>
                                {chip.label}
                                {chip.title && <span className="sr-only">: {chip.title}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {new Date(s.submittedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">{formatClock(s.durationMs)}</td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">{formatClock(s.voicedMs)}</td>
                      <td className="py-2 pr-3">
                        {s.gradeScore !== null ? (
                          <>
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{formatScore(s.gradeScore)}</span>
                            <div className="text-xs text-gray-400">
                              {s.gradedBy === TEACHER ? t('by you') : s.gradedBy || t('grader unknown')}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400">{t('Not graded')}</span>
                        )}
                      </td>
                      <td className="py-2 whitespace-nowrap text-right">
                        <button
                          onClick={() => setOpen((current) => (current === s.id ? null : s.id))}
                          aria-expanded={open === s.id}
                          className={secondary}
                        >
                          {open === s.id ? t('Hide') : t('Listen')}
                        </button>
                      </td>
                    </tr>
                    {open === s.id && (
                      <tr>
                        <td colSpan={6} className="py-3 px-2 bg-gray-50 dark:bg-gray-900/40">
                          <div className="space-y-4">
                            {/* Opened by the teacher's click on Listen, so it may start by itself. */}
                            <audio
                              controls
                              autoPlay
                              preload="auto"
                              src={s.audioUrl}
                              aria-label={t('Recording by {{name}}', { name: s.studentName })}
                              className="w-full max-w-xl"
                            />
                            {/* Each recording keeps the text as it read then, and a grader compares against that. */}
                            {s.referenceText !== task.referenceText && (
                              <div className="space-y-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
                                <p className="text-amber-800 dark:text-amber-300">
                                  {s.referenceText
                                    ? t('The reference text has changed since this was recorded. Graders compare it with the text it was made against.')
                                    : t('This was recorded before the task had a reference text, so graders have no text to compare it with.')}
                                </p>
                                {s.referenceText && (
                                  <details>
                                    <summary className="cursor-pointer font-medium text-gray-900 dark:text-gray-100">
                                      {t('Text this recording was made against')}
                                    </summary>
                                    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200">{s.referenceText}</p>
                                  </details>
                                )}
                              </div>
                            )}
                            {s.micSettings && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('Microphone processing: {{list}}', { list: micProcessing(s.micSettings, t) })}
                              </p>
                            )}
                            <GradePanel key={s.id} submission={s} taskId={task.id} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t('Spoke for is measured by the student’s page, capped at the file’s real length.')}
            </p>
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {missing ? t('Not turned in ({{count}})', { count: missing.length }) : t('Not turned in')}
        </h3>
        {missingQuery.error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{missingQuery.error.message}</p>
        ) : !missing ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : missing.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t('Everyone has turned it in.')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
            {missing.map((m) => (
              <li key={m.id} className="py-2 flex flex-wrap justify-between gap-2">
                <span className="text-gray-900 dark:text-gray-100">{m.name}</span>
                <span className="text-gray-600 dark:text-gray-400">{m.email}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
