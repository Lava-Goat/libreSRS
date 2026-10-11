// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * One sign-up sheet, as a student sees it: every day, how full it is, who has
 * it (first name and last initial, when the teacher shows names), and a button
 * to pick or drop a day.
 */
import { useMemo, useState } from 'react';
import { trpc } from '../../api/trpc';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import { formatDay, formatDayLong, formatMonth } from '../../utils/calendarDate';

const primary = 'px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';

/** Seconds between refreshes, so a day a classmate just took stops looking open. */
const REFRESH_MS = 20_000;

export default function SignupSheet({ sheetId, onBack }: { sheetId: number; onBack: () => void }) {
  const { t, locale } = useI18n();
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();
  const { data: sheet, isLoading, error: loadError, refetch, isFetching } = trpc.signups.get.useQuery(
    { sheetId },
    { refetchInterval: REFRESH_MS },
  );
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const afterChange = async () => {
    await Promise.all([utils.signups.get.invalidate({ sheetId }), utils.signups.list.invalidate()]);
    setPendingId(null);
  };
  const claim = trpc.signups.claim.useMutation({
    onSuccess: () => setError(null),
    onError: (e) => setError(e.message),
    onSettled: afterChange,
  });
  const release = trpc.signups.release.useMutation({
    onSuccess: () => setError(null),
    onError: (e) => setError(e.message),
    onSettled: afterChange,
  });

  const dates = useMemo(() => sheet?.dates ?? [], [sheet]);
  const myDays = dates.filter((d) => d.mine);
  const pastCount = dates.filter((d) => d.locked && !d.mine).length;
  const visible = dates.filter((d) => (showPast || !d.locked || d.mine)
    && (!onlyOpen || d.mine || (d.taken < d.capacity && !d.locked)));
  const months: { month: string; days: typeof visible }[] = [];
  for (const d of visible) {
    const month = d.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.month === month) last.days.push(d);
    else months.push({ month, days: [d] });
  }

  if (isLoading) return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  if (!sheet) {
    return (
      <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
        <p className="text-red-700 dark:text-red-400">
          {loadError?.data?.code === 'FORBIDDEN'
            ? t('This sign-up sheet is not for your class.')
            : loadError?.data?.code === 'NOT_FOUND'
              ? t('This sign-up sheet is not open. Check the link with your teacher.')
              : t('Could not load the sign-up sheet. Check your connection and try again.')}
        </p>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} disabled={isFetching} className={secondary}>{t('Retry')}</button>
          <button onClick={onBack} className={secondary}>{t('All sign-up sheets')}</button>
        </div>
      </div>
    );
  }

  const full = sheet.myCount >= sheet.picksPerStudent;
  // The teacher sees what students see, without taking a student's spot.
  const canChange = sheet.open && !isAdmin;
  const busy = claim.isPending || release.isPending;

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 space-y-3">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-words">{sheet.title}</h2>
        {sheet.description && (
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line break-words">{sheet.description}</p>
        )}
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ${full
            ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-900 dark:text-green-200'
            : 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'}`}
        >
          <p className="font-medium">
            {t('You have picked {{count}} of {{total}} day(s).', { count: sheet.myCount, total: sheet.picksPerStudent })}
          </p>
          {myDays.length > 0 && (
            <p className="mt-1">
              {t('Your days:')}{' '}
              {myDays.map((d) => formatDay(d.date, locale)).join(' · ')}
            </p>
          )}
          {sheet.open && full && myDays.some((d) => !d.locked && !d.assigned) && (
            <p className="mt-1">{t('To change a day, drop it first, then pick another.')}</p>
          )}
        </div>
        {isAdmin && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('This is the student view. Put students on days from the roster in Admin → Sign-ups.')}
          </p>
        )}
        {!sheet.open && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t('This sign-up sheet is closed. Ask your teacher to change your day.')}
          </p>
        )}
        {error && <div role="alert" className={alertBox}>{error}</div>}
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          {t('Only days with room')}
        </label>
        {pastCount > 0 && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            {t('Show past days ({{count}})', { count: pastCount })}
          </label>
        )}
      </div>

      {months.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-500 dark:text-gray-400">
          {dates.length === 0 ? t('No days on this sheet yet.') : t('No days match.')}
        </div>
      ) : months.map(({ month, days }) => (
        <section key={month} aria-labelledby={`month-${month}`}>
          <h3 id={`month-${month}`} className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            {formatMonth(days[0].date, locale)}
          </h3>
          <ul className="space-y-2">
            {days.map((d) => {
              const left = Math.max(0, d.capacity - d.taken);
              const canPick = canChange && !d.locked && !d.mine && left > 0 && !full;
              const canDrop = canChange && !d.locked && d.mine && !d.assigned;
              const longDay = formatDayLong(d.date, locale);
              return (
                <li
                  key={d.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-4 border-l-4 ${d.mine
                    ? 'border-green-600 dark:border-green-400'
                    : d.locked || left === 0 ? 'border-gray-300 dark:border-gray-600' : 'border-blue-500'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">
                        <time dateTime={d.date} title={longDay}>{formatDay(d.date, locale)}</time>
                        {d.label && <span className="font-normal text-gray-600 dark:text-gray-400"> — {d.label}</span>}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {d.locked
                          ? t('Closed')
                          : left === 0
                            ? t('Full')
                            : t('{{count}} of {{total}} spot(s) open', { count: left, total: d.capacity })}
                        {d.people.length > 0 && ' · '}
                        {d.people.map((p, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {p.you
                              ? <strong className="text-green-800 dark:text-green-300">{t('You')}</strong>
                              : (p.name ?? t('Taken'))}
                          </span>
                        ))}
                      </p>
                      {d.mine && d.assigned && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('Your teacher put you on this day.')}</p>
                      )}
                    </div>
                    {canPick && (
                      <button
                        onClick={() => { setPendingId(d.id); claim.mutate({ dateId: d.id }); }}
                        disabled={busy}
                        aria-label={t('Pick {{day}}', { day: longDay })}
                        className={primary}
                      >
                        {pendingId === d.id && claim.isPending ? t('Saving...') : t('Pick this day')}
                      </button>
                    )}
                    {canDrop && (
                      <button
                        onClick={() => {
                          if (!window.confirm(t('Drop {{day}}? Someone else may take it.', { day: longDay }))) return;
                          setPendingId(d.id);
                          release.mutate({ dateId: d.id });
                        }}
                        disabled={busy}
                        aria-label={t('Drop {{day}}', { day: longDay })}
                        className={secondary}
                      >
                        {pendingId === d.id && release.isPending ? t('Saving...') : t('Drop')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
