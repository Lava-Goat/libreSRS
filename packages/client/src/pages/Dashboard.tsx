import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import DeckList from '../components/DeckList';
import VirtualDeckList from '../components/VirtualDeckList';
import UserStats from '../components/UserStats';
import UserSettings from '../components/UserSettings';
import { StudyAllFlashcardsButton } from '../components/studyAll/StudyAllFlashcardsButton';
import { StudyAllConjugationButton } from '../components/conjugation/StudyAllConjugationButton';
import { DashboardNotices } from '../components/dashboard/DashboardNotices';
import { useDashboardNotices } from '../components/dashboard/useDashboardNotices';
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import { ExtensionSlot } from '../extensions';
import { LOGO_SRC } from '../brand';
import LegalLinks from '../components/LegalLinks';

export default function Dashboard() {
  const { user, isAdmin, logout } = useAuth();
  const { t } = useI18n();
  usePageTitle('Dashboard');
  const { data: stats } = trpc.cards.getStats.useQuery({
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
  });
  // Vocabulary tests, labs, speaking and sign-ups (sign-ups are the students' own).
  const notices = useDashboardNotices(isAdmin);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            {/* Decorative: the heading beside it says the name. */}
            <img src={LOGO_SRC} alt="" className="h-8 w-8 shrink-0" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">libreSRS</h1>
          </div>
          <div className="flex items-center gap-4 min-w-0">
            {isAdmin && (
              <Link
                to="/admin"
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              >
                {t('Admin Dashboard')}
              </Link>
            )}
            {/* On a phone the logo, a Google photo and a long name share 343 px: the name gives way.
                The Google photo is an administrator's only: a student's browser never fetches it from
                Google. */}
            <div className="flex items-center gap-2 min-w-0">
              {isAdmin && user?.picture && (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="w-8 h-8 rounded-full shrink-0"
                />
              )}
              <span className="min-w-0 truncate max-w-[30vw] sm:max-w-none text-gray-700 dark:text-gray-300" title={user?.name}>{user?.name}</span>
            </div>
            <button
              onClick={logout}
              className="shrink-0 whitespace-nowrap text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {t('Sign out')}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Extensions' news, above the notices: what is told once is never folded away. */}
        <ExtensionSlot name="dashboard.top" isAdmin={isAdmin} />
        {/* Vocabulary tests, labs, speaking and sign-ups: full cards, or folded into one row of chips (v1.18.0). */}
        <DashboardNotices notices={notices} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('Your Decks')}</h2>
                {/* "Study all" (v1.18.0): flashcards newest deck first; conjugation from every quiz. */}
                <div className="flex flex-wrap gap-2">
                  <StudyAllFlashcardsButton />
                  <StudyAllConjugationButton />
                </div>
              </div>
              <DeckList />
            </div>
            <VirtualDeckList />
          </div>
          <div>
            <div className="space-y-6">
              <ExtensionSlot name="dashboard.side" isAdmin={isAdmin} />
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Your Progress')}</h2>
                {stats && <UserStats stats={stats} />}
              </div>
              <div>
                <UserSettings />
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="max-w-7xl mx-auto px-4 pb-8 sm:px-6 lg:px-8">
        <LegalLinks />
      </footer>
    </div>
  );
}
