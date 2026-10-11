import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server/src/routers/index.ts';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { isDev } from '../utils/env';
import { isPlainRowClick, SortHeader, TablePager, TableSearch } from './admin/TablePager';
import { textMatches, useTableView, type SortColumn, type TableViewState } from './admin/useTableView';
import LegalLinks from './LegalLinks';

declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;

type UserStat = inferRouterOutputs<AppRouter>['admin']['getUserStats'][number];

/** Where this device remembers the User Activity panel's page size and sort. */
export const USER_ACTIVITY_STORAGE_KEY = 'libresrs.admin.userActivity';

function formatTime(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

export interface AdminDashboardProps {
  /**
   * The User Activity panel's search and page, when the admin page keeps them:
   * a user's page and its Back then find the panel as the teacher left it.
   */
  activityView?: TableViewState;
  onActivityViewChange?: (view: TableViewState) => void;
  /**
   * A user whose page the teacher just came back from: their name takes focus
   * (on whichever page of the list it is now), once, and then onReturnFocusDone.
   */
  returnFocusUserId?: number | null;
  onReturnFocusDone?: () => void;
}

export default function AdminDashboard({
  activityView, onActivityViewChange, returnFocusUserId = null, onReturnFocusDone,
}: AdminDashboardProps = {}) {
  const { t } = useI18n();
  const { data: userStats } = trpc.admin.getUserStats.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const { data: decks } = trpc.admin.getDecks.useQuery();

  const totalReviews = userStats?.reduce((sum, u) => sum + u.totalReviews, 0) ?? 0;
  const totalTimeMs = userStats?.reduce((sum, u) => sum + u.totalTimeMs, 0) ?? 0;
  // Pooled over students with reviews: right answers ÷ all answers. A mean of per-user rates
  // let a teacher's test account, or a student with 2 reviews, weigh as much as a whole class.
  const withReviews = userStats?.filter((u) => u.role !== 'admin' && u.totalReviews > 0) ?? [];
  const pooledReviews = withReviews.reduce((sum, u) => sum + u.totalReviews, 0);
  const pooledCorrect = withReviews.reduce(
    (sum, u) => sum + (u.correctReviews ?? Math.round(u.retentionRate * u.totalReviews)),
    0,
  );
  const avgRetention = pooledReviews > 0 ? pooledCorrect / pooledReviews : null;
  const buildVersion = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '';
  const buildCommit = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown';

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label={t('Total Users')}
          value={userStats?.length ?? 0}
          icon={<UsersIcon />}
        />
        <StatCard
          label={t('Total Groups')}
          value={groups?.length ?? 0}
          icon={<GroupIcon />}
        />
        <StatCard
          label={t('Total Decks')}
          value={decks?.length ?? 0}
          icon={<DecksIcon />}
        />
        <StatCard
          label={t('Total Reviews')}
          value={totalReviews}
          icon={<ReviewsIcon />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('Time on Task')}</h2>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{formatTime(totalTimeMs)}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Total across all users')}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('Average Retention')}</h2>
          <p className="text-3xl font-bold text-green-700 dark:text-green-400">
            {avgRetention === null ? '—' : `${(avgRetention * 100).toFixed(0)}%`}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Students with reviews')}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('Total Cards')}</h2>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {decks?.reduce((sum, d) => sum + d.cardCount, 0) ?? 0}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Across all decks')}</p>
        </div>
      </div>

      <UserActivity
        userStats={userStats}
        view={activityView}
        onViewChange={onActivityViewChange}
        returnFocusUserId={returnFocusUserId}
        onReturnFocusDone={onReturnFocusDone}
      />
      <div className="flex gap-3">
        <ExportProgressButton />
      </div>
      <footer className="text-xs text-gray-500 dark:text-gray-400">
        {!isDev() && buildVersion ? (
          <>
            {t('Version:')} <span className="font-mono">{buildVersion}</span>
          </>
        ) : (
          <>
            {t('Git build:')} <span className="font-mono">{buildCommit}</span>
          </>
        )}
        <LegalLinks className="mt-2 [&_ul]:justify-start" />
      </footer>
    </div>
  );
}

type ActivitySort = 'name' | 'reviews' | 'time' | 'retention' | 'active';

const byName = (a: UserStat, b: UserStat) =>
  a.userName.localeCompare(b.userName, undefined, { numeric: true, sensitivity: 'base' });
const lastActiveMs = (user: UserStat) => (user.lastActive == null ? null : new Date(user.lastActive).getTime());

/** The panel's columns: names A to Z first, numbers and dates biggest or newest first. */
const ACTIVITY_COLUMNS: Record<ActivitySort, SortColumn<UserStat>> = {
  name: { compare: byName, firstDir: 'asc' },
  reviews: { compare: (a, b) => a.totalReviews - b.totalReviews, firstDir: 'desc' },
  time: { compare: (a, b) => a.totalTimeMs - b.totalTimeMs, firstDir: 'desc' },
  // No reviews is no retention (not 0%): those users go last either way.
  retention: { compare: (a, b) => a.retentionRate - b.retentionRate, firstDir: 'desc', isBlank: (u) => u.totalReviews === 0 },
  // Never active goes last either way.
  active: { compare: (a, b) => (lastActiveMs(a) ?? 0) - (lastActiveMs(b) ?? 0), firstDir: 'desc', isBlank: (u) => lastActiveMs(u) === null },
};

/** Name, email, or school ID (one the teacher typed, else the email's digits, which the email holds too). */
const activityMatches = (user: UserStat, needle: string) => textMatches(needle, user.userName, user.email, user.studentNumber);

/**
 * Every user's flashcard work, a page at a time: search it, sort it by any
 * column, and open a user's page from their name (or anywhere on their row).
 * Back from that page returns here as it was, focused on the same name.
 */
function UserActivity({
  userStats,
  view: keptView,
  onViewChange,
  returnFocusUserId,
  onReturnFocusDone,
}: {
  userStats: UserStat[] | undefined;
  view?: TableViewState;
  onViewChange?: (view: TableViewState) => void;
  returnFocusUserId: number | null;
  onReturnFocusDone?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const view = useTableView<UserStat, ActivitySort>({
    storageKey: USER_ACTIVITY_STORAGE_KEY,
    rows: userStats ?? [],
    matches: activityMatches,
    columns: ACTIVITY_COLUMNS,
    defaultSort: { key: 'active', dir: 'desc' },
    tieBreak: byName,
    view: keptView,
    onViewChange,
  });

  // Back from a user's page puts focus on their name here, once. If the list
  // changed since (it was loaded again), the page that now holds them is shown first.
  const loaded = !!userStats;
  const focusPage = returnFocusUserId === null ? null : view.pageOf((user) => user.userId === returnFocusUserId);
  const shownPage = view.page;
  useEffect(() => {
    if (!loaded || returnFocusUserId === null) return;
    if (focusPage !== null && focusPage !== shownPage) {
      view.setPage(focusPage);
      return;
    }
    document.getElementById(`activity-user-link-${returnFocusUserId}`)?.focus();
    onReturnFocusDone?.();
    // Primitives only: the view and the callback are new on every render.
  }, [loaded, returnFocusUserId, focusPage, shownPage]);

  /** A user's page, remembering that the teacher came from here (and this panel's search and page). */
  const userPage = (userId: number) => {
    const params = new URLSearchParams({ from: 'dashboard' });
    if (view.search) params.set('q', view.search);
    if (view.page > 1) params.set('page', String(view.page));
    return `/admin/users/${userId}?${params.toString()}`;
  };
  /** What the table says when it has no rows: none match the search, or there are none at all. */
  const emptyText = view.total === 0 ? t('No users yet') : t('No users match');
  const header = (key: ActivitySort, label: string) => (
    <SortHeader label={label} sort={view.sortKey === key ? view.sortDir : null} onSort={() => view.sortBy(key)} padding="px-6" />
  );

  return (
    <section aria-labelledby="user-activity-title" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-end justify-between gap-3">
        <h2 id="user-activity-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('User Activity')}</h2>
        <TableSearch
          id="user-activity-search"
          label={t('Search users')}
          placeholder={t('Name, email or school ID')}
          value={view.search}
          onChange={view.setSearch}
        />
      </div>
      <div className="overflow-x-auto">
        <table aria-labelledby="user-activity-title" className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              {header('name', t('User'))}
              {header('reviews', t('Reviews'))}
              {header('time', t('Time'))}
              {header('retention', t('Retention'))}
              {header('active', t('Last Active'))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {loaded && view.matched === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{emptyText}</td>
              </tr>
            )}
            {view.rows.map((user) => (
              <tr
                key={user.userId}
                // The name is the link (for the keyboard, and a new tab); the rest of the row is a wider target for a mouse or a finger.
                onClick={(event) => { if (isPlainRowClick(event)) navigate(userPage(user.userId)); }}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      id={`activity-user-link-${user.userId}`}
                      to={userPage(user.userId)}
                      className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
                    >
                      {user.userName}
                    </Link>
                    {user.role === 'admin' && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">
                        {t('Admin')}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                  {user.totalReviews}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                  {formatTime(user.totalTimeMs)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.totalReviews === 0 ? (
                    // No reviews is no retention, not 0%.
                    <span className="text-gray-500 dark:text-gray-400">—</span>
                  ) : (
                    <span
                      className={`font-medium ${
                        user.retentionRate >= 0.8
                          ? 'text-green-700 dark:text-green-400'
                          : user.retentionRate >= 0.6
                          ? 'text-yellow-700 dark:text-yellow-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {(user.retentionRate * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">
                  {user.lastActive
                    ? formatDate(user.lastActive)
                    : t('Never')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {userStats && (
        <TablePager
          view={view}
          emptyText={emptyText}
          announce
          className="border-t border-gray-200 dark:border-gray-700 sm:px-6"
        />
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <div className="flex items-center gap-4">
        <div className="text-blue-600">{icon}</div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
      </div>
    </div>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ExportProgressButton() {
  const { t } = useI18n();
  const exportQuery = trpc.admin.exportUserProgress.useQuery(undefined, {
    enabled: false,
  });

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      downloadCsv(result.data.csv, 'user-progress.csv');
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exportQuery.isFetching}
      className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
    >
      {exportQuery.isFetching ? t('Exporting...') : t('Export User Progress (CSV)')}
    </button>
  );
}

function UsersIcon() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  );
}

function DecksIcon() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-1.243 1.007-2.25 2.25-2.25h13.5" />
    </svg>
  );
}

function ReviewsIcon() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
