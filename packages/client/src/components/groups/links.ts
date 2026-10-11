// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useState, type RefObject } from 'react';

/**
 * A student's page opened from a group (its Members or its "Flashcards by
 * day"): the page's Back link returns to that group on the Groups tab.
 */
export const userPageFromGroup = (userId: number, groupId: number) => `/admin/users/${userId}?from=group&group=${groupId}`;

/** A deck, open on the Decks tab. */
export const deckPage = (deckId: number) => `/admin?tab=decks&deck=${deckId}`;

/**
 * After a row's Remove, focus goes where the keyboard was: the Remove button
 * now at that place on the page (the next row's, or the last one's), or the
 * list's search box when the page is empty. It waits until the row has left
 * the whole list (not only this page: a search typed meanwhile is not a removal).
 *
 * `listIds` is every row's id, `pageIds` this page's, in order; `removeId`
 * names a row's Remove button.
 */
export function useFocusAfterRemove(
  listIds: readonly number[],
  pageIds: readonly number[],
  removeId: (id: number) => string,
  fallback: RefObject<HTMLElement | null>,
): (id: number, index: number) => void {
  const [pending, setPending] = useState<{ id: number; index: number } | null>(null);
  const pendingId = pending?.id ?? null;
  const pendingIndex = pending?.index ?? 0;
  const gone = pendingId !== null && !listIds.includes(pendingId);
  const page = pageIds.join(',');
  useEffect(() => {
    if (pendingId === null || !gone) return;
    const ids = page ? page.split(',').map(Number) : [];
    const next = ids[Math.min(pendingIndex, ids.length - 1)];
    const target = next === undefined ? null : document.getElementById(removeId(next));
    (target ?? fallback.current)?.focus();
    setPending(null);
    // Primitives only: removeId and fallback are the caller's, the same every render in effect.
  }, [pendingId, pendingIndex, gone, page]);
  return (id, index) => setPending({ id, index });
}
