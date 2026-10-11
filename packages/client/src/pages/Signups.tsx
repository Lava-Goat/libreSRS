// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import { formatDay } from '../utils/calendarDate';
import SignupSheet from '../components/signups/SignupSheet';

export default function Signups() {
  const { user, logout } = useAuth();
  const { t, locale } = useI18n();
  usePageTitle(t('Sign-ups'));
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = Number(searchParams.get('sheet')) || null;

  const { data: sheets, isLoading, error: listError, refetch, isFetching } = trpc.signups.list.useQuery(undefined, { enabled: activeId === null });

  const open = (id: number) => setSearchParams({ sheet: String(id) });
  const close = () => setSearchParams({}, { replace: true });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            {activeId !== null ? (
              <button onClick={close} className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
                ← {t('All sign-up sheets')}
              </button>
            ) : (
              <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
                ← {t('Back to Study')}
              </Link>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('Sign-ups')}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-gray-700 dark:text-gray-300">{user?.name}</span>
            <button
              onClick={logout}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {t('Sign out')}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {activeId !== null ? (
          <SignupSheet key={activeId} sheetId={activeId} onBack={close} />
        ) : isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : listError && !sheets ? (
          <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
            <p className="text-red-700 dark:text-red-400">{t('Could not load the sign-up sheets. Check your connection and try again.')}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {t('Retry')}
            </button>
          </div>
        ) : !sheets || sheets.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-500 dark:text-gray-400">
            {t('No sign-up sheets right now.')}
          </div>
        ) : (
          <ul className="space-y-3">
            {sheets.map((sheet) => {
              const done = sheet.myDates.length >= sheet.picksPerStudent;
              return (
                <li
                  key={sheet.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-l-4 ${done ? 'border-green-500' : 'border-blue-500'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100 break-words">{sheet.title}</h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {sheet.myDates.length > 0
                          ? t('Your days: {{days}}', { days: sheet.myDates.map((d) => formatDay(d, locale)).join(' · ') })
                          : sheet.open ? t('You have not picked a day yet') : t('Closed')}
                      </p>
                    </div>
                    <button
                      onClick={() => open(sheet.id)}
                      className={done || !sheet.open
                        ? 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        : 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700'}
                    >
                      {done || !sheet.open ? t('Open') : t('Pick days')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
