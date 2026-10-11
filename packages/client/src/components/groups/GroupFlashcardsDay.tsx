// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { isPlainRowClick, SortHeader, TablePager, TableSearch } from '../admin/TablePager';
import { textMatches, useTableView, type SortColumn } from '../admin/useTableView';
import { userPageFromGroup } from './links';

type FlashcardDay = inferRouterOutputs<AppRouter>['admin']['groupFlashcardDay'];
type StudentRow = FlashcardDay['students'][number];
type Cell = StudentRow['cells'][number];

/** Where this device remembers the grid's page size and sort. */
export const GROUP_FLASHCARDS_STORAGE_KEY = 'libresrs.admin.groupFlashcards';

/** The grid's columns as the sort names them: the student, "all flashcards" (v1.18.0), or a deck ("deck-12"). */
type GridSort = 'student' | 'all' | `deck-${number}`;

const byName = (a: StudentRow, b: StudentRow) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
/** How far a student got in a deck that day: finished, studied, or nothing. */
const reached = (cell: Cell | undefined) => (cell == null ? 0 : cell.finishedAt != null ? 2 : cell.answers > 0 ? 1 : 0);

/**
 * The student column; "All flashcards", those who finished all first (the
 * earliest first among them); then one per deck: finished first (the most work
 * first among them), then studied, and a student who did nothing in it last
 * either way.
 */
function gridColumns(deckIds: readonly number[]): Record<GridSort, SortColumn<StudentRow>> {
  const columns: Record<string, SortColumn<StudentRow>> = {
    student: { compare: byName, firstDir: 'asc' },
    all: {
      // Descending puts those who finished first, the earliest of them on top.
      compare: (a, b) => (a.allDone == null ? 0 : 1) - (b.allDone == null ? 0 : 1) || (b.allDone ?? 0) - (a.allDone ?? 0),
      firstDir: 'desc',
      isBlank: (student) => student.allDone == null,
    },
  };
  deckIds.forEach((deckId, index) => {
    const cellOf = (student: StudentRow) => student.cells[index]?.deckId === deckId
      ? student.cells[index]
      : student.cells.find((c) => c.deckId === deckId);
    columns[`deck-${deckId}`] = {
      compare: (a, b) => {
        const x = cellOf(a);
        const y = cellOf(b);
        return reached(x) - reached(y) || (x?.answers ?? 0) - (y?.answers ?? 0) || (x?.newCards ?? 0) - (y?.newCards ?? 0);
      },
      firstDir: 'desc',
      isBlank: (student) => reached(cellOf(student)) === 0,
    };
  });
  return columns as Record<GridSort, SortColumn<StudentRow>>;
}

const studentMatches = (student: StudentRow, needle: string) => textMatches(needle, student.name, student.email);

/**
 * Seconds a card with one decimal, rounded up: "0.4" for 374 ms, so the grid
 * never makes a student look faster than they were.
 */
const secondsText = (ms: number, locale: string) =>
  (Math.ceil(ms / 100) / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** An amber note under a cell, with its meaning as a title and for screen readers. */
function Chip({ text, why }: { text: string; why?: string }) {
  return (
    <span
      className="mt-0.5 block w-fit rounded px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
      title={why}
    >
      {text}
      {/* The meaning, for screen readers (a title never reaches the keyboard). */}
      {why && <span className="sr-only">: {why}</span>}
    </span>
  );
}

/**
 * Admin → Groups → a group: "Flashcards by day". Rows are the group's
 * students, columns "All flashcards" and then the group's decks; a check means
 * the student reached "All Done!" in that deck that school day, or (All
 * flashcards, v1.18.0) had nothing left in any of their decks: all of the
 * day's flashcards finished (admin.groupFlashcardDay). One query per group
 * and day: it does not poll. A page of students at a time: search them, sort
 * by the student or by any deck, and open a student's page from their name.
 */
export default function GroupFlashcardsDay({
  groupId,
  onOpenUser,
  returnFocusUserId = null,
  onReturnFocusDone,
}: {
  groupId: number;
  /** Told before a student's page opens from here, so Back can find the name here again. */
  onOpenUser?: () => void;
  /** A student whose page the teacher just came back from: their name takes focus, once. */
  returnFocusUserId?: number | null;
  onReturnFocusDone?: () => void;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  /** The day picked, or '' for the school's today (the server decides it). */
  const [day, setDay] = useState('');
  const { data, error, isLoading } = trpc.admin.groupFlashcardDay.useQuery({ groupId, day: day || undefined });

  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const titleId = `flashcards-day-${groupId}`;
  const decks = data?.decks ?? [];
  const view = useTableView<StudentRow, GridSort>({
    storageKey: GROUP_FLASHCARDS_STORAGE_KEY,
    rows: data?.students ?? [],
    matches: studentMatches,
    columns: gridColumns(decks.map((deck) => deck.id)),
    defaultSort: { key: 'student', dir: 'asc' },
    tieBreak: byName,
  });

  // Back from a student's page puts focus on their name here, once, on the page that holds it.
  const loaded = !!data;
  const focusPage = returnFocusUserId === null ? null : view.pageOf((student) => student.id === returnFocusUserId);
  const shownPage = view.page;
  useEffect(() => {
    if (!loaded || returnFocusUserId === null) return;
    if (focusPage !== null && focusPage !== shownPage) {
      view.setPage(focusPage);
      return;
    }
    document.getElementById(`group-flashcards-link-${returnFocusUserId}`)?.focus();
    onReturnFocusDone?.();
    // Primitives only: the view and the callback are new on every render.
  }, [loaded, returnFocusUserId, focusPage, shownPage]);
  // A grid that cannot load has no name to focus: the request is given up, not left waiting
  // (a later grid of another group would take it).
  const failed = !!error;
  useEffect(() => {
    if (failed && returnFocusUserId !== null) onReturnFocusDone?.();
    // Primitives only: the callback is new on every render.
  }, [failed, returnFocusUserId]);

  const open = (studentId: number) => {
    onOpenUser?.();
    navigate(userPageFromGroup(studentId, groupId));
  };
  const emptyText = t('No students match');

  return (
    <section aria-labelledby={titleId} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id={titleId} className="font-semibold text-gray-900 dark:text-gray-100">{t('Flashcards by day')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {t('A check means the student reached “All Done!” in that deck that day.')}
            {' '}{t('“All flashcards” means nothing was left in any of the student’s decks.')}
          </p>
        </div>
        <div>
          <label htmlFor={`${titleId}-date`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {t('Day')}
          </label>
          <input
            id={`${titleId}-date`}
            type="date"
            value={day || data?.day || ''}
            onChange={(e) => setDay(e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="p-4">
        {error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
        ) : isLoading || !data ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">{t('Loading...')}</p>
        ) : data.decks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('No decks are assigned to this group.')}</p>
        ) : data.students.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('No members yet')}</p>
        ) : (
          <>
            <TableSearch
              id={`${titleId}-search`}
              label={t('Search students')}
              placeholder={t('Name or email')}
              value={view.search}
              onChange={view.setSearch}
              className="w-full sm:w-72 mb-3"
            />
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Not a tab stop of its own: on a phone it scrolls sideways as the keyboard moves along its sort buttons and links.
                  relative: keeps the chips' sr-only texts inside the scroll box, not widening a phone's page. */}
              <div className="relative overflow-x-auto">
                <table aria-labelledby={titleId} className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <SortHeader
                        label={t('Student')}
                        sort={view.sortKey === 'student' ? view.sortDir : null}
                        onSort={() => view.sortBy('student')}
                        padding="px-3"
                        paddingY="py-2"
                        className="align-bottom"
                      />
                      <SortHeader
                        label={t('All flashcards')}
                        upper={false}
                        sort={view.sortKey === 'all' ? view.sortDir : null}
                        onSort={() => view.sortBy('all')}
                        padding="px-3"
                        paddingY="py-2"
                        className="align-bottom"
                        detail={(
                          <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                            {t('{{count}} of {{total}} finished', {
                              count: data.students.filter((s) => s.allDone != null).length,
                              total: data.students.length,
                            })}
                          </span>
                        )}
                      />
                      {data.decks.map((deck, index) => {
                        const finished = data.students.filter((s) => s.cells[index]?.finishedAt != null).length;
                        const key: GridSort = `deck-${deck.id}`;
                        return (
                          <SortHeader
                            key={deck.id}
                            label={deck.name}
                            upper={false}
                            sort={view.sortKey === key ? view.sortDir : null}
                            onSort={() => view.sortBy(key)}
                            padding="px-3"
                            paddingY="py-2"
                            className="align-bottom"
                            detail={(
                              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                                {t('{{count}} of {{total}} finished', { count: finished, total: data.students.length })}
                              </span>
                            )}
                          />
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {view.matched === 0 && (
                      <tr>
                        <td colSpan={data.decks.length + 2} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">{emptyText}</td>
                      </tr>
                    )}
                    {view.rows.map((student) => (
                      <tr
                        key={student.id}
                        // The name is the link (for the keyboard, and a new tab); the rest of the row is a wider target.
                        onClick={(event) => { if (isPlainRowClick(event)) open(student.id); }}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          <Link
                            id={`group-flashcards-link-${student.id}`}
                            to={userPageFromGroup(student.id, groupId)}
                            onClick={() => onOpenUser?.()}
                            className="text-blue-700 dark:text-blue-300 hover:underline"
                          >
                            {student.name}
                          </Link>
                        </th>
                        <td className="px-3 py-2 align-top whitespace-nowrap" data-testid="all-flashcards-cell">
                          {student.allDone != null ? (
                            <span className="block text-green-800 dark:text-green-300 font-medium">
                              <span aria-hidden="true">✓ </span>{t('Finished {{time}}', { time: time(student.allDone) })}
                            </span>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">—</span>
                          )}
                        </td>
                        {student.cells.map((cell) => {
                          // Minutes are whole; a few quick cards still took some time, so never "0 min".
                          const work = cell.minutes > 0
                            ? t('{{new}} new · {{answers}} answers · {{minutes}} min', { new: cell.newCards, answers: cell.answers, minutes: cell.minutes })
                            : t('{{new}} new · {{answers}} answers · <1 min', { new: cell.newCards, answers: cell.answers });
                          return (
                            <td key={cell.deckId} className="px-3 py-2 align-top whitespace-nowrap">
                              {cell.finishedAt != null ? (
                                <>
                                  <span className="block text-green-800 dark:text-green-300 font-medium">
                                    <span aria-hidden="true">✓ </span>{t('Finished {{time}}', { time: time(cell.finishedAt) })}
                                  </span>
                                  <span className="block text-xs text-gray-600 dark:text-gray-400">{work}</span>
                                </>
                              ) : cell.answers > 0 ? (
                                <>
                                  <span className="block text-gray-600 dark:text-gray-400">{t('Not finished')}</span>
                                  <span className="block text-xs text-gray-600 dark:text-gray-400">{work}</span>
                                </>
                              ) : (
                                <span className="text-gray-500 dark:text-gray-400">—</span>
                              )}
                              {cell.fast && cell.medianFirstMs !== null && (() => {
                                const seconds = secondsText(cell.medianFirstMs, locale);
                                return (
                                  <Chip
                                    text={t('Fast: {{seconds}} s a card', { seconds })}
                                    why={t("Half of today's first answers in this deck took less than {{seconds}} s.", { seconds })}
                                  />
                                );
                              })()}
                              {cell.allEasy && (
                                <Chip text={t('Easy on {{easy}} of {{new}} new cards', { easy: cell.easyNew, new: cell.newCards })} />
                              )}
                              {cell.lowLimit && (
                                <Chip
                                  text={t('limit {{count}}', { count: cell.newLimit })}
                                  why={t("This student's new-card limit for this deck is {{count}}, below the group's {{group}}.", {
                                    count: cell.newLimit,
                                    group: data.groupNewLimit,
                                  })}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePager view={view} emptyText={emptyText} announce labelledBy={titleId} className="border-t border-gray-200 dark:border-gray-700" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
