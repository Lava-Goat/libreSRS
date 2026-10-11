// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { isPlainRowClick, SortHeader, TablePager, TableSearch } from '../admin/TablePager';
import { PAGE_SIZES, textMatches, useTableView, type SortColumn } from '../admin/useTableView';

/** Where this device remembers the groups list's page size and sort. */
export const GROUPS_STORAGE_KEY = 'libresrs.admin.groups';

export interface GroupRow {
  id: number;
  name: string;
  description?: string | null;
  memberCount: number;
  deckCount: number;
}

type GroupSort = 'name' | 'members';

const byName = (a: GroupRow, b: GroupRow) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const GROUP_COLUMNS: Record<GroupSort, SortColumn<GroupRow>> = {
  name: { compare: byName, firstDir: 'asc' },
  members: { compare: (a, b) => a.memberCount - b.memberCount, firstDir: 'desc' },
};
/** By name: the one thing the list shows of a group. */
const groupMatches = (group: GroupRow, needle: string) => textMatches(needle, group.name);

/** A list this long or shorter fits on the smallest page: no pager. */
const SHORT_LIST = PAGE_SIZES[0];

/**
 * The Groups tab's list of groups: search by name, sort by name or by how many
 * members, and pick one (its name, or anywhere on its row). Paged only when it
 * is longer than a page; a group picked from the URL (a link, a reload, Back
 * from a student's page) is shown on its page of the list.
 */
export default function GroupList({
  titleId,
  groups,
  selectedGroupId,
  onSelect,
}: {
  /** The heading that names the list (the card's "Groups"). */
  titleId: string;
  groups: GroupRow[];
  selectedGroupId: number | null;
  onSelect: (groupId: number) => void;
}) {
  const { t } = useI18n();
  const view = useTableView<GroupRow, GroupSort>({
    storageKey: GROUPS_STORAGE_KEY,
    rows: groups,
    matches: groupMatches,
    columns: GROUP_COLUMNS,
    defaultSort: { key: 'name', dir: 'asc' },
    tieBreak: byName,
  });
  // The group picked shows on the page of the list that holds it: once for each group
  // picked (as soon as it is in the list: a new one comes with the next fetch), so the
  // teacher's own paging and sorting are left alone afterwards.
  const selectedPage = selectedGroupId === null ? null : view.pageOf((group) => group.id === selectedGroupId);
  const shownPage = view.page;
  const pagedToRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedGroupId === null || selectedPage === null || pagedToRef.current === selectedGroupId) return;
    pagedToRef.current = selectedGroupId;
    if (selectedPage !== shownPage) view.setPage(selectedPage);
    // Primitives only: the view is new on every render.
  }, [selectedGroupId, selectedPage]);

  const header = (key: GroupSort, label: string) => (
    <SortHeader label={label} sort={view.sortKey === key ? view.sortDir : null} onSort={() => view.sortBy(key)} />
  );

  return (
    <>
      <div className="px-4 pt-3">
        <TableSearch
          id="group-list-search"
          label={t('Search groups')}
          value={view.search}
          onChange={view.setSearch}
          className="w-full"
        />
      </div>
      <div className="overflow-x-auto mt-3">
        <table aria-labelledby={titleId} className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              {header('name', t('Group'))}
              {header('members', t('Members'))}
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('Decks')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {view.matched === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-gray-500 dark:text-gray-400">{t('No groups match')}</td>
              </tr>
            )}
            {view.rows.map((group) => {
              const selected = group.id === selectedGroupId;
              return (
                <tr
                  key={group.id}
                  onClick={(event) => { if (isPlainRowClick(event)) onSelect(group.id); }}
                  className={`cursor-pointer ${selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => onSelect(group.id)}
                      className="text-left font-medium text-gray-900 dark:text-gray-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                    >
                      {group.name}
                    </button>
                  </td>
                  {/* Darker than the usual grey: it has to hold 4.5:1 on the selected row's blue-50 too. */}
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{group.memberCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{group.deckCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {groups.length > SHORT_LIST && (
        <TablePager view={view} emptyText={t('No groups match')} announce labelledBy={titleId} className="border-t border-gray-200 dark:border-gray-700" />
      )}
    </>
  );
}
