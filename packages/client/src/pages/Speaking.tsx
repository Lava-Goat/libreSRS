// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's speaking tasks. Speaking tests (a task with an exam set,
 * v1.21.0) are listed on the Tests page, never here: this page only points
 * there. One opened here by a direct link (/speaking?task=ID) still opens,
 * the same as ever, and its way back goes to the Tests page.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import SpeakingRunner from '../components/speaking/SpeakingRunner';

export default function Speaking() {
  const { user, logout } = useAuth();
  const { t, formatDate } = useI18n();
  usePageTitle(t('Speaking'));
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = Number(searchParams.get('task')) || null;

  const { data: items, isLoading, error: listError, refetch, isFetching } = trpc.speaking.list.useQuery(undefined, { enabled: activeId === null });
  // The tests are listed on the Tests page, and only pointed to here. (A list cached before v1.21.0 has no examSet.)
  const tasks = items?.filter((task) => !task.examSet);
  const hasTests = !!items?.some((task) => task.examSet);

  // While a recording is not turned in, the header's links would throw it away.
  const [busy, setBusy] = useState(false);
  // However the task was left (its own buttons, or a confirmed browser Back), none open means nothing to guard.
  useEffect(() => { if (activeId === null) setBusy(false); }, [activeId]);

  const open = (id: number) => setSearchParams({ task: String(id) });
  /** A speaking test (opened by a direct link) goes back to the Tests page, where it is listed. */
  const close = (test: boolean) => {
    setBusy(false);
    utils.speaking.list.invalidate();
    if (test) navigate('/tests', { replace: true });
    else setSearchParams({}, { replace: true });
  };

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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('Speaking')}</h1>
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
        {activeId !== null ? (
          <SpeakingRunner key={activeId} taskId={activeId} onExit={close} onBusyChange={setBusy} />
        ) : isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : listError && !items ? (
          // Not the empty state: a student told there is nothing to record would stop looking.
          <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
            <p className="text-red-700 dark:text-red-400">{t('Could not load your speaking tasks. Check your connection and try again.')}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {t('Retry')}
            </button>
          </div>
        ) : (
          <>
            {hasTests && (
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                {t('Looking for a test?')}{' '}
                <Link to="/tests" className="font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300">
                  {t('Go to Tests')}
                </Link>
              </p>
            )}
            {!tasks || tasks.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-500 dark:text-gray-400">
                {t('Nothing to record right now.')}
              </div>
            ) : (
              <ul className="space-y-3">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className={`bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-l-4 ${
                      !task.submittedAt ? 'border-blue-500' : task.littleSpeech ? 'border-amber-500' : 'border-green-500'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-gray-900 dark:text-gray-100 break-words">{task.title}</h2>
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
                        onClick={() => open(task.id)}
                        className={task.submittedAt
                          ? 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                          : 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700'}
                      >
                        {task.submittedAt ? t('Open') : t('Start')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
