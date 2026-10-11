// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { useI18n } from '../../i18n';
import { isPlainRowClick, SortHeader, TablePager, TableSearch } from '../admin/TablePager';
import { textMatches, useTableView, type SortColumn } from '../admin/useTableView';
import { useFocusAfterRemove, userPageFromGroup } from './links';

export type GroupMember = inferRouterOutputs<AppRouter>['admin']['getGroupMembers'][number];

/** Where this device remembers the Members list's page size and sort. */
export const GROUP_MEMBERS_STORAGE_KEY = 'libresrs.admin.groupMembers';

type MemberSort = 'name' | 'email' | 'active' | 'joined';

const byName = (a: GroupMember, b: GroupMember) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
/** A date as the server sends it (a Date, its ISO text, or ms), in ms. */
const ms = (value: Date | string | number | null | undefined) => (value == null ? null : new Date(value).getTime());

/** Names and emails A to Z first; dates newest first, with never (or unknown) last either way. */
const MEMBER_COLUMNS: Record<MemberSort, SortColumn<GroupMember>> = {
  name: { compare: byName, firstDir: 'asc' },
  email: { compare: (a, b) => a.email.localeCompare(b.email), firstDir: 'asc' },
  active: { compare: (a, b) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0), firstDir: 'desc', isBlank: (m) => m.lastActiveAt == null },
  joined: { compare: (a, b) => (ms(a.joinedAt) ?? 0) - (ms(b.joinedAt) ?? 0), firstDir: 'desc', isBlank: (m) => ms(m.joinedAt) === null },
};

/** Name, email, or school ID (one the teacher typed, else the email's digits). */
const memberMatches = (member: GroupMember, needle: string) => textMatches(needle, member.name, member.email, member.studentNumber);

const cell = 'px-3 py-2 whitespace-nowrap';

/**
 * A group's members, a page at a time: search them, sort them by any column,
 * open a member's page from their name (or anywhere on their row), and remove
 * them. Back from a member's page returns here as it was, focused on the name.
 */
export default function GroupMembersTable({
  groupId,
  titleId,
  members,
  canRemove,
  onRemove,
  onOpenUser,
  returnFocusUserId = null,
  onReturnFocusDone,
}: {
  groupId: number;
  /** The heading that names the list (the card's "Members"). */
  titleId: string;
  /** The group's members; undefined while they load. */
  members: GroupMember[] | undefined;
  /** False for the "All" group, which everyone stays in. */
  canRemove: boolean;
  onRemove: (member: GroupMember) => void;
  /** Told before a member's page opens from here, so Back can find the name here again. */
  onOpenUser?: () => void;
  /** A member whose page the teacher just came back from: their name takes focus, once. */
  returnFocusUserId?: number | null;
  onReturnFocusDone?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const view = useTableView<GroupMember, MemberSort>({
    storageKey: GROUP_MEMBERS_STORAGE_KEY,
    rows: members ?? [],
    matches: memberMatches,
    columns: MEMBER_COLUMNS,
    defaultSort: { key: 'name', dir: 'asc' },
    tieBreak: byName,
  });

  // Back from a member's page puts focus on their name, once, on the page that holds it.
  const loaded = !!members;
  const focusPage = returnFocusUserId === null ? null : view.pageOf((member) => member.id === returnFocusUserId);
  const shownPage = view.page;
  useEffect(() => {
    if (!loaded || returnFocusUserId === null) return;
    if (focusPage !== null && focusPage !== shownPage) {
      view.setPage(focusPage);
      return;
    }
    document.getElementById(`group-member-link-${returnFocusUserId}`)?.focus();
    onReturnFocusDone?.();
    // Primitives only: the view and the callback are new on every render.
  }, [loaded, returnFocusUserId, focusPage, shownPage]);

  const removeId = (id: number) => `group-member-remove-${id}`;
  const focusAfterRemove = useFocusAfterRemove(
    (members ?? []).map((member) => member.id),
    view.rows.map((member) => member.id),
    removeId,
    searchRef,
  );

  const open = (member: GroupMember) => {
    onOpenUser?.();
    navigate(userPageFromGroup(member.id, groupId));
  };
  const emptyText = view.total === 0 ? t('No members yet') : t('No members match');
  const header = (key: MemberSort, label: string) => (
    <SortHeader label={label} sort={view.sortKey === key ? view.sortDir : null} onSort={() => view.sortBy(key)} padding="px-3" paddingY="py-2" />
  );

  return (
    <div>
      <TableSearch
        id={`group-members-search-${groupId}`}
        label={t('Search members')}
        placeholder={t('Name, email or school ID')}
        value={view.search}
        onChange={view.setSearch}
        inputRef={searchRef}
        className="w-full sm:w-72 mb-3"
      />
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table aria-labelledby={titleId} className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {header('name', t('Name'))}
                {header('email', t('Email'))}
                {header('active', t('Last Active'))}
                {header('joined', t('Joined'))}
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {!loaded && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">{t('Loading...')}</td>
                </tr>
              )}
              {loaded && view.matched === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">{emptyText}</td>
                </tr>
              )}
              {view.rows.map((member, index) => (
                <tr
                  key={member.id}
                  // The name is the link (for the keyboard, and a new tab); the rest of the row is a wider target.
                  onClick={(event) => { if (isPlainRowClick(event)) open(member); }}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <td className={cell}>
                    <div className="flex items-center gap-2">
                      {member.picture && <img src={member.picture} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />}
                      <Link
                        id={`group-member-link-${member.id}`}
                        to={userPageFromGroup(member.id, groupId)}
                        onClick={() => onOpenUser?.()}
                        className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
                      >
                        {member.name}
                      </Link>
                      {member.role === 'admin' && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">
                          {t('Admin')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${cell} text-gray-600 dark:text-gray-400`}>{member.email}</td>
                  <td className={`${cell} text-gray-600 dark:text-gray-400`}>
                    {member.lastActiveAt != null ? formatDate(member.lastActiveAt) : t('Never')}
                  </td>
                  <td className={`${cell} text-gray-600 dark:text-gray-400`}>
                    {member.joinedAt != null ? formatDate(member.joinedAt) : '—'}
                  </td>
                  <td className={cell}>
                    <button
                      type="button"
                      id={removeId(member.id)}
                      // Named for its row: every row has a Remove (the name starts with the word on screen).
                      aria-label={`${t('Remove')} ${member.name}`}
                      onClick={() => {
                        if (!canRemove) return;
                        focusAfterRemove(member.id, index);
                        onRemove(member);
                      }}
                      disabled={!canRemove}
                      className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm disabled:cursor-not-allowed disabled:text-gray-400 dark:disabled:text-gray-500"
                    >
                      {t('Remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Nothing to page through in an empty list: the table says so on its own. */}
        {loaded && view.total > 0 && (
          <TablePager view={view} emptyText={emptyText} announce labelledBy={titleId} className="border-t border-gray-200 dark:border-gray-700" />
        )}
      </div>
    </div>
  );
}
