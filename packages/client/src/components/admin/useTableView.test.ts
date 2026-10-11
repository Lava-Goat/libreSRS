// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  readRemembered,
  textMatches,
  useTableView,
  type SortColumn,
  type TableViewOptions,
  type TableViewState,
} from './useTableView';

interface Row { id: number; name: string; email: string; score: number | null }
type Key = 'name' | 'score';

const KEY = 'libresrs.test.table';

/** Row n: "Student 01"…, with a score that is missing on every fifth row. */
const row = (n: number): Row => ({
  id: n,
  name: `Student ${String(n).padStart(2, '0')}`,
  email: `${10000 + n}@students.school.test`,
  score: n % 5 === 0 ? null : n * 10,
});
const ROWS = Array.from({ length: 60 }, (_, i) => row(i + 1));

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
const COLUMNS: Record<Key, SortColumn<Row>> = {
  name: { compare: byName, firstDir: 'asc' },
  score: { compare: (a, b) => (a.score ?? 0) - (b.score ?? 0), firstDir: 'desc', isBlank: (r) => r.score === null },
};

function setup(overrides: Partial<TableViewOptions<Row, Key>> = {}) {
  return renderHook(
    (props: Partial<TableViewOptions<Row, Key>>) => useTableView<Row, Key>({
      storageKey: KEY,
      rows: ROWS,
      matches: (r, needle) => textMatches(needle, r.name, r.email),
      columns: COLUMNS,
      defaultSort: { key: 'name', dir: 'asc' },
      tieBreak: byName,
      ...props,
    }),
    { initialProps: overrides },
  );
}
const ids = (rows: Row[]) => rows.map((r) => r.id);

/** Runs with window.localStorage replaced (its getter may throw, as a private window's can). */
function withLocalStorage(get: () => Storage, run: () => void) {
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get });
  try {
    run();
  } finally {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete (window as { localStorage?: Storage }).localStorage;
  }
}

describe('useTableView', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows the first 25 rows by default, sorted by the default column', () => {
    const { result } = setup();
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.rows[0].name).toBe('Student 01');
    expect(result.current).toMatchObject({ page: 1, pageCount: 3, total: 60, matched: 60, first: 1, last: 25 });
    expect(result.current.ariaSort('name')).toBe('ascending');
    expect(result.current.ariaSort('score')).toBeUndefined();
  });

  it('pages forward and back, and shows every row on one page with "all"', () => {
    const { result } = setup();
    act(() => result.current.setPage(3));
    expect(result.current).toMatchObject({ page: 3, first: 51, last: 60 });
    expect(ids(result.current.rows)).toEqual(Array.from({ length: 10 }, (_, i) => 51 + i));
    // Past either end is the end.
    act(() => result.current.setPage(9));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(0));
    expect(result.current.page).toBe(1);

    act(() => result.current.setPageSize('all'));
    expect(result.current).toMatchObject({ page: 1, pageCount: 1, first: 1, last: 60 });
    expect(result.current.rows).toHaveLength(60);
  });

  it('searches names and emails, whatever the accents and case, from the first page', () => {
    const rows = [...ROWS, { id: 99, name: 'Ana López', email: 'ana@example.com', score: 5 }];
    const { result } = setup({ rows });
    act(() => result.current.setPage(2));
    act(() => result.current.setSearch('  LOPEZ '));
    expect(ids(result.current.rows)).toEqual([99]);
    expect(result.current).toMatchObject({ page: 1, matched: 1, total: 61, first: 1, last: 1 });

    // A school ID is the email's digits.
    act(() => result.current.setSearch('10042'));
    expect(ids(result.current.rows)).toEqual([42]);

    act(() => result.current.setSearch('nobody'));
    expect(result.current).toMatchObject({ matched: 0, first: 0, last: 0, page: 1, pageCount: 1, rows: [] });
  });

  it('sorts by a column: its own way first, then the other; blanks last both ways; ties by name', () => {
    const rows: Row[] = [
      { id: 1, name: 'Carla', email: 'c@x', score: 50 },
      { id: 2, name: 'Ana', email: 'a@x', score: null },
      { id: 3, name: 'Beto', email: 'b@x', score: 90 },
      { id: 4, name: 'Dani', email: 'd@x', score: 50 },
    ];
    const { result } = setup({ rows });
    act(() => result.current.setPage(1));
    act(() => result.current.sortBy('score'));
    expect(result.current.ariaSort('score')).toBe('descending');
    expect(result.current.ariaSort('name')).toBeUndefined();
    expect(ids(result.current.rows)).toEqual([3, 1, 4, 2]);
    act(() => result.current.sortBy('score'));
    expect(result.current.ariaSort('score')).toBe('ascending');
    expect(ids(result.current.rows)).toEqual([1, 4, 3, 2]);

    act(() => result.current.sortBy('name'));
    expect(result.current.sortDir).toBe('asc');
    expect(ids(result.current.rows)).toEqual([2, 3, 1, 4]);
    act(() => result.current.sortBy('name'));
    expect(ids(result.current.rows)).toEqual([4, 1, 3, 2]);
  });

  it('starts from the first page when the sort or the page size changes', () => {
    const { result } = setup();
    act(() => result.current.setPage(3));
    act(() => result.current.sortBy('score'));
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(2));
    act(() => result.current.setPageSize(10));
    expect(result.current).toMatchObject({ page: 1, pageCount: 6, last: 10 });
  });

  it('shows the last page there is when the list shrinks, and the page asked for when it grows back', () => {
    const { result, rerender } = setup();
    act(() => result.current.setPage(3));
    rerender({ rows: ROWS.slice(0, 30) });
    expect(result.current).toMatchObject({ page: 2, pageCount: 2, first: 26, last: 30 });
    // Next from the clamped page stays on it (it is the last).
    act(() => result.current.setPage(result.current.page + 1));
    expect(result.current.page).toBe(2);

    // While the list is loading there is one empty page; the rows bring the page back.
    const loading = setup();
    act(() => loading.result.current.setPage(3));
    loading.rerender({ rows: [] });
    expect(loading.result.current).toMatchObject({ page: 1, matched: 0 });
    loading.rerender({ rows: ROWS });
    expect(loading.result.current.page).toBe(3);
  });

  it('remembers the page size and the sort on this device, per table, but not the search or page', () => {
    const first = setup();
    act(() => first.result.current.setPageSize(10));
    act(() => first.result.current.sortBy('score'));
    act(() => first.result.current.setSearch('student'));
    act(() => first.result.current.setPage(2));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ pageSize: 10, sort: 'score', dir: 'desc' });
    first.unmount();

    const again = setup();
    expect(again.result.current).toMatchObject({ pageSize: 10, sortKey: 'score', sortDir: 'desc', search: '', page: 1 });
    expect(again.result.current.rows).toHaveLength(10);

    // Another table keeps its own.
    const other = setup({ storageKey: 'libresrs.test.other' });
    expect(other.result.current).toMatchObject({ pageSize: 25, sortKey: 'name', sortDir: 'asc' });
  });

  it('ignores what it cannot use from storage', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(readRemembered(KEY)).toEqual({});
    window.localStorage.setItem(KEY, JSON.stringify({ pageSize: 7, sort: 'gone', dir: 'sideways' }));
    const { result } = setup();
    expect(result.current).toMatchObject({ pageSize: 25, sortKey: 'name', sortDir: 'asc' });
    window.localStorage.setItem(KEY, JSON.stringify({ pageSize: 'all', sort: 'score' }));
    const next = setup();
    // A remembered column with no direction sorts its own way first.
    expect(next.result.current).toMatchObject({ pageSize: 'all', sortKey: 'score', sortDir: 'desc' });
  });

  it('takes no column from what every object has ("toString", "constructor", "__proto__")', () => {
    for (const sort of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      window.localStorage.setItem(KEY, JSON.stringify({ pageSize: 10, sort, dir: 'desc' }));
      const { result, unmount } = setup();
      expect(result.current).toMatchObject({ pageSize: 10, sortKey: 'name', sortDir: 'asc' });
      expect(result.current.rows[0].name).toBe('Student 01');
      unmount();
    }
  });

  it('finds the page a row is on, among the rows the search matched, in their order', () => {
    const { result } = setup();
    expect(result.current.pageOf((r) => r.id === 1)).toBe(1);
    expect(result.current.pageOf((r) => r.id === 26)).toBe(2);
    expect(result.current.pageOf((r) => r.id === 60)).toBe(3);
    act(() => result.current.sortBy('score'));
    // Highest score first (row 59); the twelve without one last, by name (row 5 is the 49th row).
    expect(result.current.pageOf((r) => r.id === 59)).toBe(1);
    act(() => result.current.setPageSize(10));
    expect(result.current.pageOf((r) => r.id === 5)).toBe(5);
    expect(result.current.pageOf((r) => r.id === 60)).toBe(6);
    act(() => result.current.setSearch('student 1'));
    expect(result.current.pageOf((r) => r.id === 42)).toBeNull();
    expect(result.current.pageOf((r) => r.id === 15)).toBe(1);
  });

  it('starts from its own page size when it has one, until the teacher picks another', () => {
    const { result } = setup({ defaultPageSize: 10 });
    expect(result.current.pageSize).toBe(10);
    expect(result.current.rows).toHaveLength(10);
    act(() => result.current.setPageSize(50));
    expect(result.current.rows).toHaveLength(50);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ pageSize: 50 });
  });

  it('hands over every matched row, on every page, in order (for "Select all 42 matching")', () => {
    const { result } = setup();
    expect(result.current.matchedRows).toHaveLength(60);
    act(() => result.current.setPageSize(10));
    act(() => result.current.setSearch('student 1'));
    // Ten matched, on one page of ten; the page and the whole list agree.
    expect(ids(result.current.matchedRows)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    act(() => result.current.setSearch('student'));
    act(() => result.current.sortBy('name'));
    expect(ids(result.current.rows)).toHaveLength(10);
    expect(ids(result.current.matchedRows)).toEqual(ids([...ROWS].reverse()));
  });

  it('works on, unremembered, when localStorage throws (a private window)', () => {
    withLocalStorage(() => { throw new DOMException('The operation is insecure.', 'SecurityError'); }, () => {
      const { result } = setup();
      expect(result.current.pageSize).toBe(25);
      act(() => result.current.setPageSize(50));
      act(() => result.current.sortBy('score'));
      expect(result.current).toMatchObject({ pageSize: 50, sortKey: 'score', sortDir: 'desc' });
      expect(result.current.rows).toHaveLength(50);
    });
  });

  it('works on when saving throws (storage full)', () => {
    const setItem = vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const full = { getItem: () => null, setItem } as unknown as Storage;
    withLocalStorage(() => full, () => {
      const { result } = setup();
      act(() => result.current.setPageSize(10));
      expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify({ pageSize: 10 }));
      expect(result.current.rows).toHaveLength(10);
    });
  });

  it('leaves the search and page to the caller that keeps them', () => {
    let kept: TableViewState = { search: 'student 1', page: 2 };
    const onViewChange = vi.fn((view: TableViewState) => { kept = view; });
    const { result, rerender } = setup({ view: kept, onViewChange });
    // "Student 1" and "Student 10"…"Student 19", 10 a page.
    expect(result.current).toMatchObject({ search: 'student 1', page: 1, matched: 10 });
    act(() => result.current.setPageSize(10));
    rerender({ view: kept, onViewChange });
    expect(result.current.page).toBe(1);

    act(() => result.current.setSearch('student'));
    expect(onViewChange).toHaveBeenLastCalledWith({ search: 'student', page: 1 });
    rerender({ view: kept, onViewChange });
    act(() => result.current.setPage(4));
    expect(onViewChange).toHaveBeenLastCalledWith({ search: 'student', page: 4 });
    rerender({ view: kept, onViewChange });
    expect(result.current).toMatchObject({ page: 4, first: 31, last: 40 });
  });

  it('keeps the rows in their order without columns (a caller that sorts them itself)', () => {
    const reversed = [...ROWS].reverse();
    const { result } = renderHook(() => useTableView<Row>({ storageKey: 'libresrs.test.plain', rows: reversed }));
    expect(result.current.sortKey).toBeNull();
    expect(result.current.rows[0].id).toBe(60);
    act(() => result.current.setPage(2));
    expect(result.current.rows[0].id).toBe(35);
  });
});
