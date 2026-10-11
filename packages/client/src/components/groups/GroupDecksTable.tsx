// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useRef, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { isPlainRowClick, SortHeader, TablePager, TableSearch } from '../admin/TablePager';
import { textMatches, useTableView, type SortColumn } from '../admin/useTableView';
import { deckPage, useFocusAfterRemove } from './links';

/** Where this device remembers the Assigned Decks list's page size and sort. */
export const GROUP_DECKS_STORAGE_KEY = 'libresrs.admin.groupDecks';

export interface AssignedDeck {
  id: number;
  name: string;
  description?: string | null;
  cardCount: number;
}

type DeckSort = 'name' | 'cards';

const byName = (a: AssignedDeck, b: AssignedDeck) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const DECK_COLUMNS: Record<DeckSort, SortColumn<AssignedDeck>> = {
  name: { compare: byName, firstDir: 'asc' },
  cards: { compare: (a, b) => a.cardCount - b.cardCount, firstDir: 'desc' },
};
/** By name: the one thing the list shows of a deck. */
const deckMatches = (deck: AssignedDeck, needle: string) => textMatches(needle, deck.name);

/** A click that stays in this tab (not one meant for a new tab or window). */
const inThisTab = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const cell = 'px-3 py-2 whitespace-nowrap';
const linkId = (deckId: number) => `group-deck-link-${deckId}`;

/**
 * The decks assigned to a group, a page at a time: search them by name, sort
 * them, open one on the Decks tab (its name is a link; so is its row), and
 * take one off the group. Back from the Decks tab puts focus on the deck's
 * name here again, on the page that holds it.
 */
export default function GroupDecksTable({
  groupId,
  titleId,
  decks,
  onRemove,
  onOpenDeck,
  returnFocusDeckId = null,
  onReturnFocusDone,
}: {
  groupId: number;
  /** The heading that names the list (the card's "Assigned Decks"). */
  titleId: string;
  /** The group's decks; undefined while they load. */
  decks: AssignedDeck[] | undefined;
  onRemove: (deck: AssignedDeck) => void;
  /** Told before a deck opens on the Decks tab from here, so Back can find its name here again. */
  onOpenDeck?: (deckId: number) => void;
  /** A deck the teacher just came back from: its name takes focus, once. */
  returnFocusDeckId?: number | null;
  onReturnFocusDone?: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const view = useTableView<AssignedDeck, DeckSort>({
    storageKey: GROUP_DECKS_STORAGE_KEY,
    rows: decks ?? [],
    matches: deckMatches,
    columns: DECK_COLUMNS,
    defaultSort: { key: 'name', dir: 'asc' },
    tieBreak: byName,
  });
  // Back from a deck puts focus on its name, once, on the page that holds it.
  const loaded = !!decks;
  const focusPage = returnFocusDeckId === null ? null : view.pageOf((deck) => deck.id === returnFocusDeckId);
  const shownPage = view.page;
  useEffect(() => {
    if (!loaded || returnFocusDeckId === null) return;
    if (focusPage !== null && focusPage !== shownPage) {
      view.setPage(focusPage);
      return;
    }
    document.getElementById(linkId(returnFocusDeckId))?.focus();
    onReturnFocusDone?.();
    // Primitives only: the view and the callback are new on every render.
  }, [loaded, returnFocusDeckId, focusPage, shownPage]);

  const removeId = (id: number) => `group-deck-remove-${groupId}-${id}`;
  const focusAfterRemove = useFocusAfterRemove(
    (decks ?? []).map((deck) => deck.id),
    view.rows.map((deck) => deck.id),
    removeId,
    searchRef,
  );
  const open = (deckId: number) => {
    onOpenDeck?.(deckId);
    navigate(deckPage(deckId));
  };
  const emptyText = view.total === 0 ? t('No decks assigned yet') : t('No decks match');
  const header = (key: DeckSort, label: string) => (
    <SortHeader label={label} sort={view.sortKey === key ? view.sortDir : null} onSort={() => view.sortBy(key)} padding="px-3" paddingY="py-2" />
  );

  return (
    <div>
      <TableSearch
        id={`group-decks-search-${groupId}`}
        label={t('Search decks')}
        placeholder={t('Deck name')}
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
                {header('name', t('Deck'))}
                {header('cards', t('Cards'))}
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {!loaded && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">{t('Loading...')}</td>
                </tr>
              )}
              {loaded && view.matched === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">{emptyText}</td>
                </tr>
              )}
              {view.rows.map((deck, index) => (
                <tr
                  key={deck.id}
                  onClick={(event) => { if (isPlainRowClick(event)) open(deck.id); }}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <td className={cell}>
                    <Link
                      id={linkId(deck.id)}
                      to={deckPage(deck.id)}
                      onClick={(event) => { if (inThisTab(event)) onOpenDeck?.(deck.id); }}
                      className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
                    >
                      {deck.name}
                    </Link>
                  </td>
                  <td className={`${cell} text-gray-600 dark:text-gray-400`}>{deck.cardCount}</td>
                  <td className={cell}>
                    <button
                      type="button"
                      id={removeId(deck.id)}
                      // Named for its row: every row has a Remove (the name starts with the word on screen).
                      aria-label={`${t('Remove')} ${deck.name}`}
                      onClick={() => {
                        focusAfterRemove(deck.id, index);
                        onRemove(deck);
                      }}
                      className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
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
