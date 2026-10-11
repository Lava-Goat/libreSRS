// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState } from 'react';

/**
 * A long admin table as the teacher sees it: a search, a sort, and one page of
 * rows at a time. The page size and the sort are remembered on this device
 * (localStorage, one key per table); the search is not.
 */

export type SortDir = 'asc' | 'desc';

/** How many rows a page holds. 'all' is every row on one page. */
export const PAGE_SIZES = [10, 25, 50, 'all'] as const;
export type PageSize = typeof PAGE_SIZES[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Text as a search compares it: no accents, no case ("López" is found by "lopez"). */
export const plainText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether any of these texts holds the needle (a search already made plain). */
export function textMatches(needle: string, ...texts: (string | null | undefined)[]): boolean {
  return texts.some((text) => text != null && plainText(text).includes(needle));
}

export interface SortColumn<T> {
  /** Orders two rows from smallest to biggest (A to Z, oldest to newest). */
  compare: (a: T, b: T) => number;
  /** The way a first click sorts: names A to Z, numbers and dates biggest or newest first. */
  firstDir: SortDir;
  /** A row with nothing to sort by (never active, no reviews) goes last whichever way. */
  isBlank?: (row: T) => boolean;
}

/** The part of the view a page may keep for itself (to find it again after a user's page). */
export interface TableViewState {
  search: string;
  page: number;
}
export const INITIAL_TABLE_VIEW: TableViewState = { search: '', page: 1 };

export interface TableViewOptions<T, K extends string> {
  /** Where this table's page size (and sort) are remembered, e.g. "libresrs.admin.userActivity". */
  storageKey: string;
  /** The page size until the teacher picks one (DEFAULT_PAGE_SIZE when left out). */
  defaultPageSize?: PageSize;
  /** Every row, before the search. */
  rows: readonly T[];
  /** Whether a row matches the search; `needle` is already trimmed and plain (see plainText). */
  matches?: (row: T, needle: string) => boolean;
  /** The sortable columns. Without them the rows keep their order (a caller that sorts them itself). */
  columns?: Record<K, SortColumn<T>>;
  defaultSort?: { key: K; dir: SortDir };
  /** Orders rows that tie (by name, say). */
  tieBreak?: (a: T, b: T) => number;
  /** The search and page, when the caller keeps them; otherwise the hook does. */
  view?: TableViewState;
  onViewChange?: (view: TableViewState) => void;
}

export interface TableView<T, K extends string> {
  search: string;
  setSearch: (text: string) => void;
  sortKey: K | null;
  sortDir: SortDir;
  sortBy: (key: K) => void;
  /** aria-sort for a column's header: only the sorted column says it. */
  ariaSort: (key: K) => 'ascending' | 'descending' | undefined;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  /** The page shown, from 1 (clamped to the pages there are). */
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  /** Rows before the search. */
  total: number;
  /** Rows the search matched. */
  matched: number;
  /** Where this page starts and ends among the matched rows, from 1 (both 0 when none match). */
  first: number;
  last: number;
  /** This page's rows. */
  rows: T[];
  /** Every row the search matched, in order, on every page ("Select all 42 matching"). */
  matchedRows: T[];
  /** The page (from 1) that holds the first matched row this picks out, or null when none does. */
  pageOf: (pick: (row: T) => boolean) => number | null;
}

interface Remembered {
  pageSize?: PageSize;
  sort?: string;
  dir?: SortDir;
}

/** What this device remembers for a table. A private window can refuse localStorage, or throw. */
export function readRemembered(storageKey: string): Remembered {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const { pageSize, sort, dir } = parsed as Record<string, unknown>;
    return {
      pageSize: (PAGE_SIZES as readonly unknown[]).includes(pageSize) ? (pageSize as PageSize) : undefined,
      sort: typeof sort === 'string' ? sort : undefined,
      dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
    };
  } catch {
    return {};
  }
}

function remember(storageKey: string, value: Remembered) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Not remembered this time; the table still works.
  }
}

/** The rows that match, in order. */
export function filterAndSort<T>(
  rows: readonly T[],
  needle: string,
  matches: ((row: T, needle: string) => boolean) | undefined,
  column: SortColumn<T> | undefined,
  dir: SortDir,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const found = needle && matches ? rows.filter((row) => matches(row, needle)) : rows.slice();
  if (!column) return found;
  const sign = dir === 'asc' ? 1 : -1;
  return found.sort((a, b) => {
    const blankA = column.isBlank?.(a) ?? false;
    const blankB = column.isBlank?.(b) ?? false;
    if (blankA !== blankB) return blankA ? 1 : -1;
    return (blankA ? 0 : sign * column.compare(a, b)) || (tieBreak?.(a, b) ?? 0);
  });
}

export function useTableView<T, K extends string = never>(options: TableViewOptions<T, K>): TableView<T, K> {
  const { storageKey, rows, matches, columns, defaultSort, tieBreak, defaultPageSize = DEFAULT_PAGE_SIZE } = options;
  const [remembered, setRemembered] = useState<Remembered>(() => readRemembered(storageKey));
  const [ownView, setOwnView] = useState<TableViewState>(INITIAL_TABLE_VIEW);
  const view = options.view ?? ownView;
  const setView = options.onViewChange ?? setOwnView;

  const pageSize = remembered.pageSize ?? defaultPageSize;
  // A remembered sort counts only while that column is still there. Its own column:
  // `in` would also find "toString" or "constructor" on every object.
  const rememberedSort = columns && remembered.sort && Object.hasOwn(columns, remembered.sort) ? (remembered.sort as K) : null;
  const sortKey: K | null = columns ? rememberedSort ?? defaultSort?.key ?? null : null;
  const sortDir: SortDir = (rememberedSort ? remembered.dir : undefined)
    ?? (sortKey !== null && sortKey === defaultSort?.key ? defaultSort.dir : undefined)
    ?? (sortKey !== null && columns ? columns[sortKey].firstDir : 'asc');

  const save = (next: Remembered) => {
    setRemembered(next);
    remember(storageKey, next);
  };

  const needle = plainText(view.search.trim());
  const found = filterAndSort(rows, needle, matches, sortKey !== null ? columns?.[sortKey] : undefined, sortDir, tieBreak);
  const size = pageSize === 'all' ? Math.max(found.length, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(found.length / size));
  // The page is clamped here, not in state: while the list is loading (or after it
  // shrinks) the last page is shown, and the page asked for comes back with the rows.
  const page = Math.min(Math.max(1, Math.floor(view.page) || 1), pageCount);
  const start = (page - 1) * size;
  const pageRows = found.slice(start, start + size);

  return {
    search: view.search,
    // A new search, sort or page size starts again from the first page.
    setSearch: (text) => setView({ search: text, page: 1 }),
    sortKey,
    sortDir,
    sortBy: (key) => {
      if (!columns) return;
      const dir: SortDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : columns[key].firstDir;
      save({ ...remembered, sort: key, dir });
      setView({ search: view.search, page: 1 });
    },
    ariaSort: (key) => (key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined),
    pageSize,
    setPageSize: (next) => {
      save({ ...remembered, pageSize: next });
      setView({ search: view.search, page: 1 });
    },
    page,
    pageCount,
    setPage: (next) => setView({ search: view.search, page: Math.min(Math.max(1, next), pageCount) }),
    total: rows.length,
    matched: found.length,
    first: pageRows.length > 0 ? start + 1 : 0,
    last: start + pageRows.length,
    rows: pageRows,
    matchedRows: found,
    pageOf: (pick) => {
      const index = found.findIndex(pick);
      return index < 0 ? null : Math.floor(index / size) + 1;
    },
  };
}
