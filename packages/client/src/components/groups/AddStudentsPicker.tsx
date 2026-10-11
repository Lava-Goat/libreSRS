// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useI18n } from '../../i18n';
import { SortHeader, TablePager, TableSearch } from '../admin/TablePager';
import { textMatches, useTableView, type SortColumn, type TableViewState } from '../admin/useTableView';

/** Where this device remembers the "Add students" list's page size and sort. */
export const GROUP_ADD_STORAGE_KEY = 'libresrs.admin.groupAddStudents';

export interface AddCandidate {
  id: number;
  name: string;
  email: string;
  studentNumber?: string | null;
}

type AddSort = 'name' | 'email';

const byName = (a: AddCandidate, b: AddCandidate) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const ADD_COLUMNS: Record<AddSort, SortColumn<AddCandidate>> = {
  name: { compare: byName, firstDir: 'asc' },
  email: { compare: (a, b) => a.email.localeCompare(b.email), firstDir: 'asc' },
};
const candidateMatches = (user: AddCandidate, needle: string) => textMatches(needle, user.name, user.email, user.studentNumber);

const linkButton = 'text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded '
  + 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:no-underline';

/**
 * A group's "Add students": everyone not in it yet, a page at a time, to
 * search, sort and tick. The ticks outlast the page and the search, and the
 * buttons say how many they tick: "Select this page (25)" or "Select all 42"
 * ("…matching" while a search is typed); both untick again once all theirs are
 * ticked. The count says how many ticks are out of sight ("3 selected (2 not
 * shown)"): "Add selected" adds them too. The search and the ticks are the
 * caller's, so a successful add can clear them.
 */
export default function AddStudentsPicker({
  groupId,
  candidates,
  loaded,
  selected,
  onSelectedChange,
  view: keptView,
  onViewChange,
  onAdd,
  adding,
}: {
  groupId: number;
  /** Everyone who could join (not in the group yet). */
  candidates: AddCandidate[];
  /** False while the users or the members are still loading. */
  loaded: boolean;
  selected: ReadonlySet<number>;
  onSelectedChange: (next: Set<number>) => void;
  view: TableViewState;
  onViewChange: (view: TableViewState) => void;
  onAdd: () => void;
  adding: boolean;
}) {
  const { t } = useI18n();
  const titleId = `group-add-title-${groupId}`;
  const view = useTableView<AddCandidate, AddSort>({
    storageKey: GROUP_ADD_STORAGE_KEY,
    // Ten at first: it sits above the members, and should not push them off the screen.
    defaultPageSize: 10,
    rows: candidates,
    matches: candidateMatches,
    columns: ADD_COLUMNS,
    defaultSort: { key: 'name', dir: 'asc' },
    tieBreak: byName,
    view: keptView,
    onViewChange,
  });

  const withIds = (ids: number[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id); else next.delete(id);
    }
    onSelectedChange(next);
  };
  const searching = view.search.trim() !== '';
  const allMatchingSelected = view.matched > 0 && view.matchedRows.every((user) => selected.has(user.id));
  const pageSelected = view.rows.length > 0 && view.rows.every((user) => selected.has(user.id));
  /** Ticks not on this page (another page, or hidden by the search). */
  const notShown = selected.size - view.rows.filter((user) => selected.has(user.id)).length;
  const nothingSelected = selected.size === 0;
  const header = (key: AddSort, label: string) => (
    <SortHeader label={label} sort={view.sortKey === key ? view.sortDir : null} onSort={() => view.sortBy(key)} padding="px-3" paddingY="py-2" />
  );

  return (
    <div role="group" aria-labelledby={titleId} className="mb-4 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      <div className="px-3 py-3 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
        <h4 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('Add students')}</h4>
        <TableSearch
          id={`group-add-search-${groupId}`}
          label={t('Search users')}
          placeholder={t('Name, email or school ID')}
          value={view.search}
          onChange={view.setSearch}
        />
      </div>

      {!loaded ? (
        <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">{t('Loading...')}</p>
      ) : candidates.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">{t('Everyone is in this group already.')}</p>
      ) : (
        <>
          {/* relative: keeps the table's sr-only texts inside the scroll box, not widening a phone's page. */}
          <div className="relative overflow-x-auto">
            <table aria-labelledby={titleId} className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">{t('Select')}</span>
                  </th>
                  {header('name', t('Name'))}
                  {header('email', t('Email'))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {view.matched === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-center text-gray-500 dark:text-gray-400">{t('No matching users.')}</td>
                  </tr>
                )}
                {view.rows.map((user) => {
                  const box = `group-add-${groupId}-${user.id}`;
                  return (
                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-3 py-1.5">
                        <input
                          id={box}
                          type="checkbox"
                          checked={selected.has(user.id)}
                          onChange={(e) => withIds([user.id], e.target.checked)}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      {/* Both labels name the box: the name, then the email that tells two Anas apart. */}
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <label htmlFor={box} className="cursor-pointer text-gray-900 dark:text-gray-100">{user.name}</label>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <label htmlFor={box} className="cursor-pointer text-gray-600 dark:text-gray-400">{user.email}</label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePager view={view} emptyText={t('No matching users.')} announce labelledBy={titleId} className="border-t border-gray-200 dark:border-gray-700" />
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* On one page, "this page" and "all" are the same ticks: only "all" is offered. */}
          {loaded && view.pageCount > 1 && (
            <button type="button" onClick={() => withIds(view.rows.map((user) => user.id), !pageSelected)} className={linkButton}>
              {pageSelected
                ? t('Deselect this page ({{count}})', { count: view.rows.length })
                : t('Select this page ({{count}})', { count: view.rows.length })}
            </button>
          )}
          {loaded && view.matched > 0 && (
            <button type="button" onClick={() => withIds(view.matchedRows.map((user) => user.id), !allMatchingSelected)} className={linkButton}>
              {allMatchingSelected
                ? (searching ? t('Deselect all {{count}} matching', { count: view.matched }) : t('Deselect all {{count}}', { count: view.matched }))
                : (searching ? t('Select all {{count}} matching', { count: view.matched }) : t('Select all {{count}}', { count: view.matched }))}
            </button>
          )}
          {/* Always there (unavailable while nothing is ticked): pressed, it keeps the keyboard's focus. */}
          <button
            type="button"
            aria-disabled={nothingSelected || undefined}
            onClick={() => { if (!nothingSelected) onSelectedChange(new Set()); }}
            className={linkButton}
          >
            {t('Clear selection')}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
            {notShown > 0
              ? t('{{count}} selected ({{hidden}} not shown)', { count: selected.size, hidden: notShown })
              : t('{{count}} selected', { count: selected.size })}
          </span>
          <button
            type="button"
            onClick={onAdd}
            disabled={selected.size === 0 || adding}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? t('Adding…') : t('Add selected')}
          </button>
        </div>
      </div>
    </div>
  );
}
