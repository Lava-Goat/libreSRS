// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's tests (v1.21.0): their own tab, apart from labs and speaking, linking
 * to the same interface. One card per
 * exam set: its listening forms (exam labs, v1.19.0) and its speaking tests.
 * Each opens here in the same runner the Labs and Speaking pages use, with
 * the same rules; only the way back comes here.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import LabRunner from '../components/labs/LabRunner';
import SpeakingRunner from '../components/speaking/SpeakingRunner';
import { testSets } from '../components/tests/testSets';

const startButton = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700';
const openButton = 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600';

export default function Tests() {
  const { user, logout } = useAuth();
  const { t, formatDate } = useI18n();
  usePageTitle(t('Tests'));
  const utils = trpc.useUtils();
  const [searchParams, setSearchParams] = useSearchParams();
  const labId = Number(searchParams.get('lab')) || null;
  const taskId = labId === null ? Number(searchParams.get('task')) || null : null;
  const open = labId !== null || taskId !== null;

  // The same lists the Labs and Speaking pages read; this page keeps only their tests.
  const labsList = trpc.labs.list.useQuery({ exams: true }, { enabled: !open });
  const speakingList = trpc.speaking.list.useQuery(undefined, { enabled: !open });
  const sets = testSets(labsList.data, speakingList.data);

  // While a runner holds work, the header's links would throw it away.
  const [busy, setBusy] = useState(false);
  // However the item was left (its own buttons, or a confirmed browser Back), none open means nothing to guard.
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  // Always back to this list, even for an item that turned practice meanwhile.
  const close = () => {
    setBusy(false);
    setSearchParams({}, { replace: true });
    utils.labs.list.invalidate();
    utils.speaking.list.invalidate();
  };
  const retry = () => {
    void labsList.refetch();
    void speakingList.refetch();
  };

  const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            {!busy && (
              <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
                ← {t('Back to Study')}
              </Link>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('Tests')}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-gray-700 dark:text-gray-300">{user?.name}</span>
            {!busy && (
              <button
                onClick={logout}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                {t('Sign out')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {labId !== null ? (
          <LabRunner key={labId} labId={labId} fromTests onExit={close} onBusyChange={setBusy} />
        ) : taskId !== null ? (
          <SpeakingRunner key={taskId} taskId={taskId} fromTests onExit={close} onBusyChange={setBusy} />
        ) : labsList.isLoading || speakingList.isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : (labsList.error && !labsList.data) || (speakingList.error && !speakingList.data) ? (
          // Not the empty state: a student told there are no tests would stop looking.
          <div role="alert" className={`${card} space-y-4`}>
            <p className="text-red-700 dark:text-red-400">{t('Could not load your tests. Check your connection and try again.')}</p>
            <button
              onClick={retry}
              disabled={labsList.isFetching || speakingList.isFetching}
              className={`${openButton} disabled:opacity-50`}
            >
              {t('Retry')}
            </button>
          </div>
        ) : sets.length === 0 ? (
          <div className={`${card} text-gray-500 dark:text-gray-400`}>
            {t('No tests are open for you right now.')}
          </div>
        ) : (
          <ul className="space-y-6">
            {sets.map((set) => {
              // The start is the student's in the whole set: every form carries the same one.
              const exam = set.labs[0]?.exam;
              const start = exam?.start ?? null;
              const canStart = !!exam?.preview || start === null;
              return (
                <li
                  key={set.name}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-l-4 border-amber-600 dark:border-amber-400 space-y-4"
                >
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('Test {{set}}', { set: set.name })}</h2>

                  {set.labs.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Listening')}</h3>
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {t('Open only the form printed on your paper. You can start one form of each test, once.')}
                      </p>
                      {!canStart && start && (
                        <div className="text-sm space-y-1">
                          <p className="text-gray-800 dark:text-gray-200">
                            {t('You started {{title}} on {{date}}.', { title: start.title, date: formatDate(start.startedAt) })}
                            {start.finished && <>{' '}<span className="text-green-700 dark:text-green-400 font-medium">{t('Turned in.')}</span></>}
                          </p>
                          <p className="text-amber-800 dark:text-amber-300">{t('To start again, ask your teacher.')}</p>
                        </div>
                      )}
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {set.labs.map((lab) => (
                          <li key={lab.id} className="py-2 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-gray-900 dark:text-gray-100">{lab.title}</p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {t('About {{minutes}} minutes', { minutes: Math.ceil(lab.durationMs / 60000) })}
                              </p>
                              {lab.description && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{lab.description}</p>}
                            </div>
                            {canStart && (
                              <button
                                onClick={() => setSearchParams({ lab: String(lab.id) })}
                                className={startButton}
                                aria-label={`${t('Start')}: ${lab.title}`}
                              >
                                {t('Start')}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {set.speaking.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Speaking')}</h3>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {set.speaking.map((task) => {
                          const label = task.submittedAt ? t('Open') : t('Start');
                          return (
                            <li key={task.id} className="py-2 flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 break-words">{task.title}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  {task.submittedAt
                                    ? t('Turned in {{date}}', { date: formatDate(task.submittedAt) })
                                    : t('Not done yet')}
                                  {/* Still turned in: only a nudge to record it again. */}
                                  {task.submittedAt && task.littleSpeech && (
                                    <span className="text-amber-800 dark:text-amber-300">
                                      {' · '}{t('We could hardly hear you. Record it again, closer to the microphone.')}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <button
                                onClick={() => setSearchParams({ task: String(task.id) })}
                                className={task.submittedAt ? openButton : startButton}
                                aria-label={`${label}: ${task.title}`}
                              >
                                {label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
