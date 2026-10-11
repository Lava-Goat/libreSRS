// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's practice labs. Tests (exam labs, v1.19.0) are listed on the
 * Tests page (v1.21.0), never here: this page only points there. An exam lab
 * opened here by a direct link (/labs?lab=ID) still opens, with the same
 * rules, and its way back goes to the Tests page.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import LabRunner from '../components/labs/LabRunner';

export default function Labs() {
  const { user, logout } = useAuth();
  const { t, formatDate } = useI18n();
  usePageTitle(t('Labs'));
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = Number(searchParams.get('lab')) || null;

  // With the exam labs, the same list the Tests page reads: they are listed there, and only pointed to here.
  const { data: items, isLoading } = trpc.labs.list.useQuery({ exams: true }, { enabled: activeId === null });
  const labs = items?.filter((lab) => !lab.exam);
  const hasTests = !!items?.some((lab) => lab.exam);

  // While a session holds work, the header's links would throw it away.
  const [busy, setBusy] = useState(false);
  // However the session ended (its own buttons, or a confirmed browser Back), no lab open means nothing to guard.
  useEffect(() => { if (activeId === null) setBusy(false); }, [activeId]);

  const open = (id: number) => setSearchParams({ lab: String(id) });
  /** A test (opened by a direct link) goes back to the Tests page, where it is listed. */
  const close = (test: boolean) => {
    setBusy(false);
    utils.labs.list.invalidate();
    if (test) navigate('/tests', { replace: true });
    else setSearchParams({}, { replace: true });
  };

  // The practice labs, as they have always been listed.
  const practiceList = labs && labs.length > 0 && (
    <ul className="space-y-3">
      {labs.map((lab) => {
        // A list cached from before statuses: a turned-in lab was done.
        const status = lab.status ?? (lab.submittedAt ? 'done' : 'todo');
        const todo = status === 'todo';
        const border = status === 'done' ? 'border-green-500' : todo ? 'border-blue-500' : 'border-amber-500';
        const amber = 'text-amber-800 dark:text-amber-300';
        const where = status === 'done'
          ? lab.submittedAt && t('Submitted {{date}}', { date: formatDate(lab.submittedAt) })
          : status === 'redo'
            ? (
              <span className={amber}>
                {lab.redoByTeacher || lab.pausesCounted == null
                  ? t('Your teacher asked you to do it again.')
                  // The need the attempt was judged by: the rule may have changed since.
                  : t("Didn't count: you answered {{answered}} of {{total}} pauses ({{needed}} needed)", {
                    answered: lab.pausesAnswered ?? 0, total: lab.pausesCounted, needed: lab.needed ?? 0,
                  })}
              </span>
            )
            : status === 'check'
              ? <span className={amber}>{t('Waiting for your teacher to check it.')}</span>
              : t('Not done yet');
        return (
          <li
            key={lab.id}
            className={`bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-l-4 ${border}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">{lab.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('About {{minutes}} minutes', { minutes: Math.ceil(lab.durationMs / 60000) })}
                  {where && <>{' · '}{where}</>}
                </p>
                {lab.description && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{lab.description}</p>}
              </div>
              <button
                onClick={() => open(lab.id)}
                // A redo is the next thing to do; a lab that counts, or waits for the teacher, can be done again.
                className={todo || status === 'redo'
                  ? 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700'
                  : 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}
              >
                {todo ? t('Start') : t('Do it again')}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('Labs')}</h1>
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
          <LabRunner key={activeId} labId={activeId} onExit={close} onBusyChange={setBusy} />
        ) : isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
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
            {practiceList || (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-500 dark:text-gray-400">
                {t('No labs are open for you right now.')}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
