// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: an exam set's students and their one start, with the teacher's Reset (v1.19.0). Every
 * student the set's labs are for, with the form they started, when, how far
 * they got, whether they turned it in and how many resets they have had.
 * Reset gives a student exactly one more start in the set; their earlier play
 * stays in the record (listed under them) and nothing they heard is deleted.
 *
 * Shown whole from Admin › Labs › Tests ("Students and resets"), and, with
 * `labId`, inside a form's Review page: only the students who started that form.
 */
import { EXAM_APP_CODES } from '@libresrs/shared';
import { useState } from 'react';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { formatClock } from '../../utils/labAudio';
import { appCodeOf } from './ExamText';

const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
const linkButton = 'text-sm font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300';
const note = 'text-xs text-gray-500 dark:text-gray-400';
const amber = 'text-amber-800 dark:text-amber-300';
const green = 'text-green-700 dark:text-green-400';

/** How often the list refreshes while it is open: students start the test while the teacher watches. */
const REFRESH_MS = 15_000;

const when = (ms: number) => new Date(ms).toLocaleString();

export default function ExamRoster({ examSet, labId, onBack, onOpenSet }: {
  examSet: string;
  /** Only the students who started this form (a Review page). */
  labId?: number;
  onBack?: () => void;
  /** Opens the whole set's list (from a form's Review page). */
  onOpenSet?: (set: string) => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.labs.examRoster.useQuery(
    labId === undefined ? { examSet } : { examSet, labId },
    { refetchInterval: REFRESH_MS },
  );
  const reset = trpc.labs.resetExamStart.useMutation();
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);

  const set = data?.examSet ?? examSet;
  const embedded = labId !== undefined;

  /** One more start for a student, after the teacher confirms. Nothing they heard is deleted. */
  const resetStart = async (student: { name: string; current: { startId: number } | null }) => {
    if (!student.current || resetting !== null) return;
    if (!window.confirm(t('Give {{name}} one more start in {{set}}? Their earlier play stays in the record.', { name: student.name, set }))) return;
    setResetError(null);
    setResetting(student.current.startId);
    try {
      await reset.mutateAsync({ startId: student.current.startId });
    } catch (err) {
      setResetError(appCodeOf(err) === EXAM_APP_CODES.alreadyReset
        ? t('This start was already reset. Reload the list.')
        : err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setResetting(null);
      void utils.labs.examRoster.invalidate();
      void utils.labs.examSets.invalidate();
      void utils.labs.adminList.invalidate();
    }
  };

  const heading = embedded ? (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Starts on this form')}</h3>
      {onOpenSet && (
        <button type="button" onClick={() => onOpenSet(set)} className={linkButton}>
          {t('All students in {{set}}', { set })}
        </button>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('Exam set {{set}}', { set })}</h2>
      {onBack && <button onClick={onBack} className={secondary}>{t('Back to labs')}</button>}
    </div>
  );

  const students = data?.students ?? [];

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      {heading}
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t("One start per student across this set's forms. Reset gives a student one more start; their earlier play stays in the record.")}
      </p>
      {resetError && (
        <div role="alert" className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
          {resetError}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      ) : students.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">
          {embedded ? t('Nobody has started this form yet.') : t('No students are assigned to this set.')}
        </p>
      ) : (
        // relative: keeps the table's sr-only texts inside the scroll box (see LabReview).
        <div className="relative overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('Student')}</th>
                <th className="py-2 pr-3 font-medium">{t('Form')}</th>
                <th className="py-2 pr-3 font-medium">{t('Started')}</th>
                <th className="py-2 pr-3 font-medium">{t('How far')}</th>
                <th className="py-2 pr-3 font-medium">{t('Turned in')}</th>
                <th className="py-2 pr-3 font-medium">{t('Resets')}</th>
                <th className="py-2 font-medium"><span className="sr-only">{t('Actions')}</span></th>
              </tr>
            </thead>
            {/* One body per student: their row, and under it their earlier (reset) plays. */}
            {students.map((student) => {
              const current = student.current;
              const howFar = (start: { heardThroughMs: number | null; durationMs: number | null }) =>
                start.heardThroughMs === null
                  ? '—'
                  : start.durationMs === null
                    ? formatClock(start.heardThroughMs)
                    : t('{{heard}} of {{length}}', { heard: formatClock(start.heardThroughMs), length: formatClock(start.durationMs) });
              return (
                <tbody key={student.userId} className="border-t border-gray-100 dark:border-gray-700">
                  <tr className="align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-gray-900 dark:text-gray-100">
                      {student.name}
                      <div className={note}>{student.email}</div>
                      {!student.assigned && <div className={`text-xs ${amber}`}>{t("not in the set's groups now")}</div>}
                    </th>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                      {current ? (
                        <>
                          {current.labTitle}
                          {current.source === 'past' && <div className={note}>{t('counted from a practice play, or one in another set')}</div>}
                          {current.labId === null && <div className={note}>{t('lab deleted')}</div>}
                        </>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">{t('Not started')}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{current ? when(current.startedAt) : ''}</td>
                    <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">{current ? howFar(current) : ''}</td>
                    <td className="py-2 pr-3">
                      {current && (current.finished
                        ? <span className={`font-medium ${green}`}>{t('Yes')}</span>
                        : <span className="text-gray-700 dark:text-gray-300">{t('No')}</span>)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">{student.earlier.length}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {current && (
                        <button
                          onClick={() => void resetStart(student)}
                          disabled={resetting !== null}
                          className={secondary}
                          aria-label={t('Reset: {{name}}', { name: student.name })}
                        >
                          {t('Reset')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {student.earlier.length > 0 && (
                    <tr>
                      <td colSpan={7} className="pb-2 pr-3">
                        <ul className="space-y-0.5">
                          {student.earlier.map((start) => (
                            <li key={start.startId} className={note}>
                              {t('Earlier: {{form}} · {{when}} · reached {{time}} · reset {{resetWhen}} by {{by}}', {
                                form: start.labTitle,
                                when: when(start.startedAt),
                                time: start.heardThroughMs === null ? '—' : formatClock(start.heardThroughMs),
                                resetWhen: start.resetAt === null ? '—' : when(start.resetAt),
                                by: start.resetByName ?? '—',
                              })}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}
