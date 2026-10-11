// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { getTimezoneOffsetMinutes } from '../../utils/time';
import UserPinPanel from './UserPinPanel';
import { ExtensionSlot } from '../../extensions';
import { amber, card, chip, Fact, gray, Section } from './userDetailParts';

type Detail = inferRouterOutputs<AppRouter>['admin']['userDetail'];

export interface UserDetailProps {
  userId: number;
  /** The Users tab's own actions, kept reachable here. */
  onShowHistory: (userId: number) => void;
  onEditSettings: (userId: number) => void;
  onToggleRole: (user: { id: number; name: string; role: 'admin' | 'user' }) => void;
}

const th = 'px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider';
const td = 'px-4 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap';
const rowTh = 'px-4 py-2 text-left text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap';
const green = 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
// The tables' scroll boxes take focus (tabIndex 0): on a phone they scroll sideways and hold nothing else to tab to.

/** A school day (YYYY-MM-DD) as a short month/day in the viewer's language. */
function shortDay(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

/**
 * Admin → Users (or the Dashboard's User Activity, or a group) → a name: one
 * user on one page (/admin/users/:userId). Who they are, then their
 * flashcards, conjugation, labs, speaking tasks and study limits (and what extensions add).
 * Back returns to where the teacher came from, as it was: the Users list (its
 * search and sort are in this page's URL), the Dashboard (?from=dashboard,
 * with its panel's search and page), or a group on the Groups tab
 * (?from=group&group=12: "Back to Period 1"). The admin page then puts focus
 * back on this user's name, for this link and for the browser's Back alike.
 */
export default function UserDetail({ userId, onShowHistory, onEditSettings, onToggleRole }: UserDetailProps) {
  const { t, formatDate, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { data, error } = trpc.admin.userDetail.useQuery({
    userId,
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
  });

  const fromDashboard = searchParams.get('from') === 'dashboard';
  const fromGroup = searchParams.get('from') === 'group';
  const groupValue = searchParams.get('group') ?? '';
  const groupId = fromGroup && /^\d+$/.test(groupValue) ? Number(groupValue) : null;
  // The group's name for "Back to …": the Groups tab has the list already (else the user's own groups name it).
  const { data: groups } = trpc.admin.getGroups.useQuery(undefined, { enabled: groupId !== null });
  const groupName = groupId === null
    ? null
    : groups?.find((g) => g.id === groupId)?.name ?? data?.groups.find((g) => g.id === groupId)?.name ?? null;
  const backTo = useMemo(() => {
    if (fromGroup) {
      const params = new URLSearchParams({ tab: 'groups' });
      if (groupId !== null) params.set('group', String(groupId));
      return `/admin?${params.toString()}`;
    }
    if (fromDashboard) {
      // The panel's search and page go along, so a new tab (or a reload) finds it as it was.
      const params = new URLSearchParams({ tab: 'dashboard' });
      for (const key of ['q', 'page']) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      return `/admin?${params.toString()}`;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('from');
    params.set('tab', 'users');
    return `/admin?${params.toString()}`;
  }, [searchParams, fromDashboard, fromGroup, groupId]);

  // Focus moves to the user's name once it is on screen (a screen reader starts there).
  const loadedId = data?.user.id ?? null;
  useEffect(() => {
    if (loadedId !== null) headingRef.current?.focus();
  }, [loadedId]);

  const back = (
    <Link
      to={backTo}
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
    >
      ← {fromGroup
        ? (groupName !== null ? t('Back to {{name}}', { name: groupName }) : t('Back to group'))
        : fromDashboard ? t('Back to dashboard') : t('Back to users')}
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <p role="alert" className="text-red-700 dark:text-red-400">{error.message}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        {back}
        <div className="animate-pulse" role="status">{t('Loading...')}</div>
      </div>
    );
  }

  const { user } = data;
  const dash = '—';
  const date = (ms: number | null) => (ms === null ? dash : formatDate(ms));

  return (
    <div className="space-y-6">
      {back}

      <div className={`${card} p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {user.picture && <img src={user.picture} alt="" className="w-12 h-12 rounded-full flex-shrink-0" />}
            <div className="min-w-0">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                {user.name}
              </h2>
              <div className="flex flex-wrap gap-2 mt-1">
                <span className={`${chip} ${user.role === 'admin' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' : gray}`}>
                  {user.role === 'admin' ? t('Admin') : t('Student')}
                </span>
                <ExtensionSlot name="userDetail.badges" detail={data} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onShowHistory(user.id)}
              className="text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 text-sm"
            >
              {t('History')}
            </button>
            <button
              type="button"
              onClick={() => onEditSettings(user.id)}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
            >
              {t('Settings')}
            </button>
            <button
              type="button"
              onClick={() => onToggleRole({ id: user.id, name: user.name, role: user.role })}
              className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
            >
              {user.role === 'admin' ? t('Demote') : t('Promote')}
            </button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Fact label={t('Email')}><span className="break-all">{user.email}</span></Fact>
          <Fact label={t('School ID')}>{user.studentNumber ?? dash}</Fact>
          <Fact label={t('Groups')}>
            {data.groups.length > 0 ? data.groups.map((g) => g.name).join(', ') : dash}
          </Fact>
          <Fact label={t('Joined')}>{formatDate(user.createdAt)}</Fact>
          <Fact label={t('Last Active')}>{user.lastActiveAt === null ? t('Never') : formatDate(user.lastActiveAt)}</Fact>
          <Fact label={t('Study Limits')}>
            <LimitsText settings={data.settings} />
          </Fact>
        </dl>
      </div>

      <UserPinPanel userId={user.id} name={user.name} />

      <Section id="user-detail-flashcards" title={t('Flashcards')}>
        {data.flashcards.length === 0 ? (
          <Empty>{t('No decks assigned yet')}</Empty>
        ) : (
          <div tabIndex={0} className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className={th}>{t('Deck')}</th>
                  <th scope="col" className={th}>{t('Learned')}</th>
                  <th scope="col" className={th}>{t('Due today')}</th>
                  <th scope="col" className={th}>{t("Today's Progress")}</th>
                  <th scope="col" className={th}>{t('Last studied')}</th>
                  <th scope="col" className={th}>{t('“All Done!” in the last {{count}} days', { count: data.finishDays.length })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.flashcards.map((deck) => (
                  <tr key={deck.id}>
                    <th scope="row" className={rowTh}>{deck.name}</th>
                    <td className={td}>{t('{{answered}} of {{total}}', { answered: deck.learned, total: deck.cardCount })}</td>
                    <td className={td}>{deck.dueToday}</td>
                    <td className={td}>
                      {t('{{newDone}}/{{newLimit}} new, {{reviewDone}}/{{reviewLimit}} reviews', {
                        newDone: deck.newToday,
                        newLimit: deck.newLimit,
                        reviewDone: deck.reviewsToday,
                        reviewLimit: deck.reviewLimit,
                      })}
                    </td>
                    <td className={td}>{date(deck.lastStudiedAt)}</td>
                    <td className={td}>
                      <FinishStrip days={data.finishDays} finished={deck.finishedDays} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* v1.18.0: the days nothing was left in any deck (all of the day's flashcards finished). */}
              <tfoot className="border-t-2 border-gray-200 dark:border-gray-700">
                <tr>
                  <th scope="row" className={rowTh}>{t('All flashcards')}</th>
                  <td colSpan={4} className={td}>{t('Days with nothing left in any deck')}</td>
                  <td className={td}>
                    <FinishStrip days={data.finishDays} finished={data.allDoneDays ?? []} locale={locale} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <Section id="user-detail-conjugation" title={t('Conjugation')}>
        {data.conjugation.length === 0 ? (
          <Empty>{t('No conjugation quiz is on for these decks.')}</Empty>
        ) : (
          <div tabIndex={0} className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className={th}>{t('Deck')}</th>
                  <th scope="col" className={th}>{t('Mastered')}</th>
                  <th scope="col" className={th}>{t('Last played')}</th>
                  <th scope="col" className={th}>{t('Days practised')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.conjugation.map((quiz) => (
                  <tr key={quiz.deckId}>
                    <th scope="row" className={rowTh}>{quiz.deckName}</th>
                    <td className={td}>{t('{{answered}} of {{total}}', { answered: quiz.mastered, total: quiz.total })}</td>
                    <td className={td}>{date(quiz.lastPlayedAt)}</td>
                    <td className={td}>{quiz.daysPractised}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="user-detail-labs" title={t('Labs')}>
        {data.labs.length === 0 ? (
          <Empty>{t('No labs for this user.')}</Empty>
        ) : (
          <div tabIndex={0} className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className={th}>{t('Lab')}</th>
                  <th scope="col" className={th}>{t('Status')}</th>
                  <th scope="col" className={th}>{t('Pauses answered')}</th>
                  <th scope="col" className={th}>{t('Turned in')}</th>
                  <th scope="col" className={th}>{t('Attempts')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.labs.map((lab) => (
                  <tr key={lab.id}>
                    <th scope="row" className={rowTh}>{lab.title}</th>
                    <td className={td}><LabStatus lab={lab} /></td>
                    <td className={td}>
                      {lab.pausesCounted === null || lab.pausesAnswered === null
                        ? dash
                        : t('{{answered}} of {{total}}', { answered: lab.pausesAnswered, total: lab.pausesCounted })}
                    </td>
                    <td className={td}>{date(lab.submittedAt)}</td>
                    <td className={td}>{lab.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="user-detail-speaking" title={t('Speaking')}>
        {data.speaking.length === 0 ? (
          <Empty>{t('No speaking tasks for this user.')}</Empty>
        ) : (
          <div tabIndex={0} className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className={th}>{t('Task')}</th>
                  <th scope="col" className={th}>{t('Attempts')}</th>
                  <th scope="col" className={th}>{t('Turned in')}</th>
                  <th scope="col" className={th}>{t('Grade')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.speaking.map((task) => (
                  <tr key={task.id}>
                    <th scope="row" className={rowTh}>{task.title}</th>
                    <td className={td}>{task.attempts}</td>
                    <td className={td}>{date(task.lastSubmittedAt)}</td>
                    <td className={td}>
                      {task.attempts === 0 ? dash : task.score === null ? t('Not graded yet.') : (
                        <>
                          {t('{{score}} out of 100', { score: Number.isInteger(task.score) ? task.score : task.score.toFixed(1) })}
                          {task.gradedBy && task.gradedBy !== 'teacher' && (
                            <span className="text-gray-500 dark:text-gray-400"> · {task.gradedBy}</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Extensions' sections, last. */}
      <ExtensionSlot name="userDetail.sections" detail={data} />
    </div>
  );
}

function LimitsText({ settings }: { settings: Detail['settings'] }) {
  const { t } = useI18n();
  const lock = !settings.isOverride
    ? null
    : settings.limitRule === 'locked'
      ? t('Locked')
      : settings.limitRule === 'higher'
        ? t('User can set higher')
        : settings.limitRule === 'lower'
          ? t('User can set lower')
          : `${t('User can set higher')} · ${t('User can set lower')}`;
  return (
    <>
      {t('{{newLimit}} new / {{reviewLimit}} reviews', { newLimit: settings.newCardsPerDay, reviewLimit: settings.reviewsPerDay })}
      {lock && (
        <span className="block text-xs mt-0.5">
          <span className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 rounded mr-1">
            {t('Override')}
          </span>
          <span className="text-gray-600 dark:text-gray-400">{lock}</span>
        </span>
      )}
    </>
  );
}

function LabStatus({ lab }: { lab: Detail['labs'][number] }) {
  const { t } = useI18n();
  if (lab.status === 'todo') return <span className={`${chip} ${gray}`}>{t('Not done yet')}</span>;
  if (lab.status === 'done') return <span className={`${chip} ${green}`}>{t('Done')}</span>;
  if (lab.status === 'check') {
    return (
      <span className={`${chip} ${amber}`}>
        {t('Check it')}
        {lab.reason === 'no-mic' && <> · {t('No microphone')}</>}
        {lab.reason === 'asked' && <> · {t("Says the mic didn't hear them")}</>}
        {/* Held by a check the lab failed (odd results, two labs at once): the lab's review says which. */}
        {lab.reason === 'held' && <> · {t('Held for you')}</>}
      </span>
    );
  }
  return <span className={`${chip} ${amber}`}>{t('Needs redo')}</span>;
}

/**
 * One square per school day, green when the student reached "All Done!" in the
 * deck (or, for "All flashcards", had nothing left in any deck). The squares
 * are for the eye; a screen reader gets the count and dates.
 */
function FinishStrip({ days, finished, locale }: { days: string[]; finished: string[]; locale: string }) {
  const { t } = useI18n();
  const done = new Set(finished);
  const dates = finished.map((d) => shortDay(d, locale)).join(', ');
  return (
    // relative: the sr-only list is positioned against this, inside the table's scroll box; against the page it widened a phone's page.
    <div className="relative flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-0.5">
        {days.map((day) => (
          <span
            key={day}
            title={shortDay(day, locale)}
            className={`inline-block w-2.5 h-2.5 rounded-sm ${done.has(day) ? 'bg-green-600 dark:bg-green-500' : 'bg-gray-200 dark:bg-gray-600'}`}
          />
        ))}
      </span>
      <span className="text-xs text-gray-600 dark:text-gray-400">{finished.length}</span>
      <span className="sr-only">{finished.length === 0 ? t('None') : dates}</span>
    </div>
  );
}
