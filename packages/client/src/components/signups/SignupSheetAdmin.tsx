// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: one sign-up sheet in full — every day with the students on it (full
 * names), who has not picked yet, and the controls to move people, add days
 * and take days off.
 */
import { useId, useState } from 'react';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { downloadCsv } from '../../utils/downloadCsv';
import { formatDay, formatDayLong, parseDayLines } from '../../utils/calendarDate';
import { studentLink } from './studentLink';

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const hint = 'text-xs text-gray-500 dark:text-gray-400';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';

const csvCell = (value: string | number | boolean | null | undefined) => {
  let text = value === null || value === undefined ? '' : String(value);
  // A name like "=HYPERLINK(…)" must stay text when the file opens in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export default function SignupSheetAdmin({ sheetId, onBack }: { sheetId: number; onBack: () => void }) {
  const { t, locale } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const { data, isLoading, error: loadError } = trpc.signups.adminGet.useQuery({ sheetId }, { refetchInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [daysText, setDaysText] = useState('');
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const refresh = () => Promise.all([
    utils.signups.adminGet.invalidate({ sheetId }),
    utils.signups.adminList.invalidate(),
  ]);
  const onError = (e: { message: string }) => setError(e.message);
  const assign = trpc.signups.assign.useMutation({ onSuccess: () => setError(null), onError, onSettled: refresh });
  const unassign = trpc.signups.unassign.useMutation({ onSuccess: () => setError(null), onError, onSettled: refresh });
  const removeDate = trpc.signups.removeDate.useMutation({ onSuccess: () => setError(null), onError, onSettled: refresh });
  const saveDates = trpc.signups.saveDates.useMutation({ onError, onSettled: refresh });
  const update = trpc.signups.update.useMutation({ onSuccess: () => setError(null), onError, onSettled: refresh });

  if (isLoading) return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  if (!data) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className={secondary}>← {t('All sign-up sheets')}</button>
        <div role="alert" className={alertBox}>{loadError?.message ?? t('Could not load the sign-up sheet.')}</div>
      </div>
    );
  }

  const { sheet, dates, roster, today } = data;
  const owing = roster.filter((s) => s.dates.length < sheet.picksPerStudent);
  const nameOf = (s: { name: string | null; email: string }) => s.name || s.email;
  const parsed = parseDayLines(daysText);

  const exportCsv = () => {
    const rows = [['date', 'label', 'name', 'email', 'placed_by_teacher']];
    for (const d of dates) {
      if (d.claims.length === 0) rows.push([d.date, d.label ?? '', '', '', '']);
      for (const c of d.claims) rows.push([d.date, d.label ?? '', c.name ?? '', c.email, c.assigned ? 'yes' : '']);
    }
    for (const s of owing) rows.push(['', t('not picked yet'), s.name ?? '', s.email, '']);
    downloadCsv(rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), `${sheet.title.replace(/[^\p{L}\p{N}]+/gu, '_')}.csv`);
  };

  const addDays = async () => {
    setAddedNote(null);
    if (parsed.problems.length > 0) {
      setError(t('Line {{line}} does not start with a date: {{text}}', { line: parsed.problems[0].line, text: parsed.problems[0].text }));
      return;
    }
    if (parsed.days.length === 0) return;
    try {
      const result = await saveDates.mutateAsync({ sheetId, dates: parsed.days });
      setError(null);
      setDaysText('');
      setAddedNote(t('{{added}} day(s) added, {{updated}} relabeled.', result));
    } catch {
      // onError has shown it.
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">← {t('All sign-up sheets')}</button>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-words">{sheet.title}</h2>
          <p className={hint}>
            {t('{{slots}} per day · {{picks}} day(s) each · student link: {{link}}', {
              slots: sheet.slotsPerDate, picks: sheet.picksPerStudent, link: studentLink(sheet.id),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => update.mutate({ id: sheet.id, open: !sheet.open })}
            disabled={update.isPending}
            className={secondary}
          >
            {sheet.open ? t('Close sign-ups') : t('Reopen sign-ups')}
          </button>
          <button
            onClick={() => update.mutate({ id: sheet.id, active: !sheet.active })}
            disabled={update.isPending}
            className={secondary}
          >
            {sheet.active ? t('Hide from students') : t('Show to students')}
          </button>
          <button onClick={exportCsv} className={secondary}>{t('Download CSV')}</button>
        </div>
      </div>

      {error && <div role="alert" className={alertBox}>{error}</div>}

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          {t('Not done picking ({{count}} of {{total}})', { count: owing.length, total: roster.length })}
        </h3>
        {owing.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('Everyone has picked their days.')}</p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm text-gray-800 dark:text-gray-200">
            {owing.map((s) => (
              <li key={s.id} title={s.email}>
                {nameOf(s)} <span className="text-gray-500 dark:text-gray-400">({s.dates.length}/{sheet.picksPerStudent})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* relative: keeps the table's sr-only texts inside the scroll box, not widening a phone's page. */}
      <section className="relative overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-4 font-medium">{t('Day')}</th>
              <th className="py-2 pr-4 font-medium">{t('Label')}</th>
              <th className="py-2 pr-4 font-medium">{t('Students')}</th>
              <th className="py-2 font-medium"><span className="sr-only">{t('Actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => {
              const past = d.date <= today;
              const over = d.claims.length > d.effectiveCapacity;
              const onDay = new Set(d.claims.map((c) => c.userId));
              return (
                <tr key={d.id} className={`border-b border-gray-100 dark:border-gray-800 align-top ${past ? 'opacity-60' : ''}`}>
                  <td className="py-2 pr-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                    <time dateTime={d.date} title={formatDayLong(d.date, locale)}>{formatDay(d.date, locale)}</time>
                    <div className={over ? 'text-xs text-red-700 dark:text-red-400' : hint}>
                      {d.claims.length}/{d.effectiveCapacity}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{d.label ?? ''}</td>
                  <td className="py-2 pr-4">
                    <ul className="space-y-1">
                      {d.claims.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                          <span title={c.email}>{nameOf(c)}</span>
                          {c.assigned && <span className={hint}>({t('placed by you')})</span>}
                          <button
                            onClick={() => unassign.mutate({ claimId: c.id })}
                            disabled={unassign.isPending}
                            aria-label={t('Take {{name}} off {{day}}', { name: nameOf(c), day: formatDayLong(d.date, locale) })}
                            className="text-red-700 dark:text-red-400 hover:underline text-xs"
                          >
                            {t('Remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="sr-only" htmlFor={`${id}-add-${d.id}`}>
                      {t('Put a student on {{day}}', { day: formatDayLong(d.date, locale) })}
                    </label>
                    <select
                      id={`${id}-add-${d.id}`}
                      value=""
                      disabled={assign.isPending}
                      onChange={(e) => { if (e.target.value) assign.mutate({ dateId: d.id, userId: Number(e.target.value) }); }}
                      className={`${input} mt-1 text-xs`}
                    >
                      <option value="">{t('+ Add a student')}</option>
                      {roster.filter((s) => !onDay.has(s.id)).map((s) => (
                        <option key={s.id} value={s.id}>
                          {nameOf(s)} ({s.dates.length}/{sheet.picksPerStudent})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => {
                        const message = d.claims.length > 0
                          ? t('Take {{day}} off the sheet? {{count}} student(s) on it will lose it.', { day: formatDayLong(d.date, locale), count: d.claims.length })
                          : t('Take {{day}} off the sheet?', { day: formatDayLong(d.date, locale) });
                        if (window.confirm(message)) removeDate.mutate({ dateId: d.id });
                      }}
                      disabled={removeDate.isPending}
                      className={`${secondary} text-red-700 dark:text-red-400`}
                    >
                      {t('Remove day')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {dates.length === 0 && <p className="text-gray-500 dark:text-gray-400 py-3">{t('No days on this sheet yet.')}</p>}
      </section>

      <section className="space-y-2">
        <label htmlFor={`${id}-days`} className="block font-semibold text-gray-900 dark:text-gray-100">{t('Add days')}</label>
        <p className={hint}>
          {t('One per line: a date, then an optional label. A day already on the sheet gets the new label; no day is removed here.')}
        </p>
        <textarea
          id={`${id}-days`}
          value={daysText}
          onChange={(e) => setDaysText(e.target.value)}
          className={`${input} w-full font-mono text-sm`}
          rows={4}
          spellCheck={false}
        />
        <div className="flex items-center gap-3">
          <button onClick={() => void addDays()} disabled={saveDates.isPending || parsed.days.length === 0} className={primary}>
            {saveDates.isPending
              ? t('Saving...')
              : parsed.days.length === 0 ? t('Add days') : t('Add {{count}} day(s)', { count: parsed.days.length })}
          </button>
          {addedNote && <span role="status" className="text-sm text-green-700 dark:text-green-400">{addedNote}</span>}
        </div>
      </section>
    </div>
  );
}
