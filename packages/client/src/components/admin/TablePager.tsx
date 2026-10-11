// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useId, type MouseEvent, type ReactNode, type Ref } from 'react';
import { useI18n } from '../../i18n';
import { PAGE_SIZES, type PageSize, type SortDir } from './useTableView';

/** What the pager needs from useTableView. */
export interface PagerView {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  matched: number;
  first: number;
  last: number;
}

const pagerButton = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 '
  + 'hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 '
  + 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-gray-100 dark:aria-disabled:hover:bg-gray-700';

/**
 * Under a long admin table: which rows are shown ("1–25 of 190"), Previous and
 * Next, and how many rows a page holds ("Show [25] per page", its name read
 * from both words). At either end the button stays focusable (aria-disabled,
 * not disabled), so a keyboard does not lose its place on the last page. The
 * buttons are named by their own visible words, in every language.
 *
 * Where several lists share a page (a group's Members, "Add students", decks…),
 * `labelledBy` names the list each pager belongs to: its page-size box reads
 * "Members Show per page", and its buttons sit in a group named for the list
 * and the rows shown ("Members 1–25 of 30").
 */
export function TablePager({
  view,
  emptyText,
  announce = false,
  className = '',
  labelledBy,
}: {
  view: PagerView;
  /**
   * Announced instead of the range when nothing matches ("No users match").
   * The table says so in a row of its own, so here it is for screen readers only.
   */
  emptyText?: string;
  /** Announce the range as it changes: a search, a sort, Next or Previous (otherwise a page changes in silence). */
  announce?: boolean;
  className?: string;
  /** The id of the list's heading, when other lists (and their pagers) share the page. */
  labelledBy?: string;
}) {
  const { t } = useI18n();
  const sizeId = useId();
  const showId = useId();
  const perPageId = useId();
  const statusId = useId();
  const atStart = view.page <= 1;
  const atEnd = view.page >= view.pageCount;

  const status = view.matched === 0
    ? emptyText ?? ''
    : t('{{first}}–{{last}} of {{total}}', { first: view.first, last: view.last, total: view.matched });

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 ${className}`}>
      <p id={statusId} aria-live={announce ? 'polite' : undefined} className={view.matched === 0 ? 'sr-only' : undefined}>{status}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label id={showId} htmlFor={sizeId}>{t('Show')}</label>
          <select
            id={sizeId}
            aria-labelledby={labelledBy ? `${labelledBy} ${showId} ${perPageId}` : `${showId} ${perPageId}`}
            value={String(view.pageSize)}
            onChange={(e) => {
              const size = PAGE_SIZES.find((option) => String(option) === e.target.value);
              if (size !== undefined) view.setPageSize(size);
            }}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={String(size)}>{size === 'all' ? t('All') : size}</option>
            ))}
          </select>
          <span id={perPageId}>{t('per page')}</span>
        </div>
        <div
          className="flex items-center gap-2"
          role={labelledBy ? 'group' : undefined}
          aria-labelledby={labelledBy ? `${labelledBy} ${statusId}` : undefined}
        >
          <button
            type="button"
            aria-disabled={atStart || undefined}
            onClick={() => { if (!atStart) view.setPage(view.page - 1); }}
            className={pagerButton}
          >
            <span aria-hidden="true">‹ </span>{t('Previous')}
          </button>
          <button
            type="button"
            aria-disabled={atEnd || undefined}
            onClick={() => { if (!atEnd) view.setPage(view.page + 1); }}
            className={pagerButton}
          >
            {t('Next')}<span aria-hidden="true"> ›</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A sortable column's header: a button in the cell, and aria-sort on the cell
 * of the column the table is sorted by.
 */
export function SortHeader({
  label,
  sort,
  onSort,
  padding = 'px-4',
  paddingY = 'py-3',
  className = '',
  upper = true,
  detail,
}: {
  label: ReactNode;
  /** This column's direction when the table is sorted by it; null when it is not. */
  sort: SortDir | null;
  onSort: () => void;
  /** The cell's side padding, as the table's other cells have it. */
  padding?: string;
  /** Its top and bottom padding. */
  paddingY?: string;
  className?: string;
  /** Small capitals, as the admin tables' headers are; false for a name as it is written (a deck's). */
  upper?: boolean;
  /** A line under the button, in the same cell (and in the column's name): "1 of 2 finished". */
  detail?: ReactNode;
}) {
  const letters = upper ? 'uppercase tracking-wider' : '';
  return (
    <th
      scope="col"
      aria-sort={sort === null ? undefined : sort === 'asc' ? 'ascending' : 'descending'}
      className={`${padding} ${paddingY} text-left text-xs font-medium text-gray-500 dark:text-gray-400 ${letters} ${className}`}
    >
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex items-center gap-1 ${letters} ${upper ? '' : 'text-gray-700 dark:text-gray-300'} hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded`}
      >
        {label}
        <span aria-hidden="true" className={sort === null ? 'invisible' : ''}>{sort === 'asc' ? '▲' : '▼'}</span>
      </button>
      {detail}
    </th>
  );
}

/** A table's search box, with its label above it (the admin tables' look). */
export function TableSearch({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputRef,
  className = 'w-full sm:w-72',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

/**
 * A click on a table row itself, meant to open what the row's link opens: not
 * on a link, button or field in it, not one meant for a new tab, and not the
 * end of a text selection.
 */
export function isPlainRowClick(event: MouseEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((event.target as Element).closest('a, button, input, select, textarea, label')) return false;
  return !window.getSelection()?.toString();
}
