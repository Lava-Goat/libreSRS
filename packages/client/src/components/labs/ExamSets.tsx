// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin › Labs: the tests (v1.19.0), one card per exam set with its forms,
 * how many of its students started it and turned it in, and how many resets
 * it has had. "Students and resets" opens the set's list (ExamRoster), where
 * the teacher gives a student one more start. Shown only once a lab is in a set.
 */
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';

const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';

export default function ExamSets({ onOpenSet }: { onOpenSet: (set: string) => void }) {
  const { t } = useI18n();
  const { data: sets, isLoading, error } = trpc.labs.examSets.useQuery();

  return (
    <section aria-labelledby="exam-sets-heading" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
      <h2 id="exam-sets-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Tests (exam sets)')}</h2>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
      ) : isLoading || !sets ? (
        <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sets.map((set) => (
            <li key={set.examSet} className="rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 border-l-amber-600 dark:border-l-amber-400 p-4 space-y-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Exam set {{set}}', { set: set.examSet })}</h3>
              <ul className="text-sm text-gray-700 dark:text-gray-300">
                {set.labs.map((lab) => (
                  <li key={lab.id}>
                    {lab.title}
                    <span className="text-gray-500 dark:text-gray-400"> · {lab.active ? t('Visible') : t('Hidden')}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('{{started}} of {{students}} started · {{finished}} turned in · {{resets}} reset(s)', {
                  started: set.startedCount, students: set.studentCount, finished: set.finishedCount, resets: set.resetCount,
                })}
              </p>
              <button
                onClick={() => onOpenSet(set.examSet)}
                className={secondary}
                aria-label={t('Students and resets: {{set}}', { set: set.examSet })}
              >
                {t('Students and resets')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
