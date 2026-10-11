// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module virtualDecks
 *
 * Manages virtual sub-deck "views" — named subsets of a source deck's cards
 * selected by 1-based positional index (e.g. "1-50, 75, 100-110").
 *
 * Module invariants
 * -----------------
 * • Card selection strings are always validated before any DB write.
 *   A TRPCError(BAD_REQUEST) is thrown if validation fails; no row is inserted.
 * • Index semantics: selection indices are 1-based; the mapping to array
 *   position is `allCards[index - 1]`.  This contract must be preserved if the
 *   card ordering query (ORDER BY id ASC) ever changes.
 * • All DB mutations include `userId` in the WHERE clause — cross-user access
 *   is prevented at the query level, not just by the caller.
 * • `getVirtualDeckCardIds` returns [] (not an error) when the virtual deck
 *   does not exist or the source deck has fewer cards than requested.
 *
 * Function ledger
 * ---------------
 * parseSelection(selection) → ParsedSelection   [private]
 *   Pure.  Returns `{indices: [], error}` on any violation or `{indices: [...]}`
 *   on success.  Early-return on each error branch — no partial state.
 *   Limits enforced: MAX_CARD_SELECTION_LENGTH chars, MAX_CARD_SELECTION_RANGE_SPAN
 *   per range, MAX_CARD_SELECTION_ITEMS total.
 *
 * parseCardSelection(selection) / validateCardSelection(selection)
 *   Pure wrappers over parseSelection.  No DB.
 *
 * createVirtualDeck(userId, sourceDeckId, name, cardSelection)
 *   Requires:  cardSelection passes validateCardSelection.
 *   Restores:  New virtualDecks row exists on success.
 *   Early-return (throws BAD_REQUEST): DB never written.
 *
 * getUserVirtualDecks(userId)
 *   Read-only.  Batches sourceDeck + cardCount queries with Promise.all.
 *   Returns [] early if user has no virtual decks (no further DB access).
 *
 * getVirtualDeck(virtualDeckId, userId)
 *   Read-only.  Returns undefined if not found (not an error).
 *
 * deleteVirtualDeck(virtualDeckId, userId)
 *   Requires:  virtualDeckId belongs to userId (enforced in WHERE).
 *   Restores:  Row deleted; no cascade side-effects (cardStates reference cardId).
 *   Early-return: silent no-op if row not found or userId mismatch.
 *
 * getVirtualDeckCardIds(virtualDeckId, userId)
 *   Requires:  Virtual deck belongs to userId.
 *   Restores:  Returns ordered list of real card IDs for the selection.
 *   Early-return: Returns [] if deck not found.
 *
 * updateVirtualDeck(virtualDeckId, userId, updates)
 *   Requires:  If cardSelection provided, it must pass validateCardSelection.
 *   Restores:  Row updated; returns re-fetched state.
 *   Early-return (throws BAD_REQUEST): DB never written.
 *   Note: two DB ops (UPDATE then SELECT) — not atomic; re-fetch should always
 *   succeed because userId is in both WHERE clauses.
 */
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, schema } from '../db/index.js';

export const MAX_CARD_SELECTION_LENGTH = 1000;
export const MAX_CARD_SELECTION_RANGE_SPAN = 5000;
export const MAX_CARD_SELECTION_ITEMS = 10000;

type ParsedSelection = {
  indices: number[];
  error?: string;
};

function parseSelection(selection: string): ParsedSelection {
  if (selection.length > MAX_CARD_SELECTION_LENGTH) {
    return {
      indices: [],
      error: `Card selection is too long (max ${MAX_CARD_SELECTION_LENGTH} characters)`,
    };
  }

  const parts = selection
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return { indices: [], error: 'Card selection cannot be empty' };
  }

  const indices = new Set<number>();

  for (const part of parts) {
    if (part.includes('-')) {
      const rangeParts = part.split('-');
      if (rangeParts.length !== 2) {
        return { indices: [], error: `Invalid range format: "${part}"` };
      }

      const start = Number.parseInt(rangeParts[0].trim(), 10);
      const end = Number.parseInt(rangeParts[1].trim(), 10);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return { indices: [], error: `Invalid numbers in range: "${part}"` };
      }
      if (start <= 0 || end <= 0) {
        return { indices: [], error: `Card indices must be positive: "${part}"` };
      }
      if (start > end) {
        return { indices: [], error: `Range start must be <= end: "${part}"` };
      }

      const span = end - start + 1;
      if (span > MAX_CARD_SELECTION_RANGE_SPAN) {
        return {
          indices: [],
          error: `Range "${part}" is too large (max ${MAX_CARD_SELECTION_RANGE_SPAN} cards per range)`,
        };
      }
      if (indices.size + span > MAX_CARD_SELECTION_ITEMS) {
        return {
          indices: [],
          error: `Card selection is too large (max ${MAX_CARD_SELECTION_ITEMS} cards)`,
        };
      }

      for (let i = start; i <= end; i += 1) {
        indices.add(i);
      }

      continue;
    }

    const num = Number.parseInt(part, 10);
    if (Number.isNaN(num)) {
      return { indices: [], error: `Invalid number: "${part}"` };
    }
    if (num <= 0) {
      return { indices: [], error: `Card indices must be positive: "${part}"` };
    }
    if (!indices.has(num) && indices.size + 1 > MAX_CARD_SELECTION_ITEMS) {
      return {
        indices: [],
        error: `Card selection is too large (max ${MAX_CARD_SELECTION_ITEMS} cards)`,
      };
    }
    indices.add(num);
  }

  return {
    indices: Array.from(indices).sort((a, b) => a - b),
  };
}

/**
 * Parse a card selection string like "1-100, 250, 550-557" into an array of indices (1-based)
 */
export function parseCardSelection(selection: string): number[] {
  return parseSelection(selection).indices;
}

/**
 * Validate a card selection string
 */
export function validateCardSelection(selection: string): { valid: boolean; error?: string } {
  const parsed = parseSelection(selection);
  if (parsed.error) {
    return { valid: false, error: parsed.error };
  }
  return { valid: true };
}

export async function createVirtualDeck(
  userId: number,
  sourceDeckId: number,
  name: string,
  cardSelection: string
) {
  const validation = validateCardSelection(cardSelection);
  if (!validation.valid) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: validation.error ?? 'Invalid card selection',
      cause: { appCode: 'INVALID_CARD_SELECTION' },
    });
  }

  const result = await db.insert(schema.virtualDecks).values({
    name,
    userId,
    sourceDeckId,
    cardSelection,
    createdAt: new Date(),
  }).returning();

  return result[0];
}

export async function getUserVirtualDecks(userId: number) {
  const virtualDecks = await db.query.virtualDecks.findMany({
    where: eq(schema.virtualDecks.userId, userId),
  });

  if (virtualDecks.length === 0) return [];

  // Batch: fetch all source decks and their card counts in two queries
  const sourceDeckIds = [...new Set(virtualDecks.map((vd) => vd.sourceDeckId))];

  const [sourceDecks, cardCountRows] = await Promise.all([
    db.query.decks.findMany({
      where: inArray(schema.decks.id, sourceDeckIds),
    }),
    db
      .select({ deckId: schema.cards.deckId, count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(inArray(schema.cards.deckId, sourceDeckIds))
      .groupBy(schema.cards.deckId),
  ]);

  const deckMap = new Map(sourceDecks.map((d) => [d.id, d]));
  const cardCountMap = new Map(cardCountRows.map((r) => [r.deckId, r.count]));

  return virtualDecks.map((vd) => {
    const indices = parseCardSelection(vd.cardSelection);
    const sourceCardCount = cardCountMap.get(vd.sourceDeckId) ?? 0;
    const validIndices = indices.filter((i) => i <= sourceCardCount);
    return {
      ...vd,
      sourceDeckName: deckMap.get(vd.sourceDeckId)?.name ?? 'Unknown',
      cardCount: validIndices.length,
    };
  });
}

export async function getVirtualDeck(virtualDeckId: number, userId: number) {
  const virtualDeck = await db.query.virtualDecks.findFirst({
    where: and(
      eq(schema.virtualDecks.id, virtualDeckId),
      eq(schema.virtualDecks.userId, userId)
    ),
  });

  return virtualDeck;
}

export async function deleteVirtualDeck(virtualDeckId: number, userId: number) {
  await db.delete(schema.virtualDecks).where(
    and(
      eq(schema.virtualDecks.id, virtualDeckId),
      eq(schema.virtualDecks.userId, userId)
    )
  );
}

/**
 * Get the card IDs that belong to a virtual deck based on its selection
 */
export async function getVirtualDeckCardIds(
  virtualDeckId: number,
  userId: number
): Promise<number[]> {
  const virtualDeck = await db.query.virtualDecks.findFirst({
    where: and(
      eq(schema.virtualDecks.id, virtualDeckId),
      eq(schema.virtualDecks.userId, userId)
    ),
  });

  if (!virtualDeck) {
    return [];
  }

  // Get all cards from source deck ordered by id (creation order)
  const allCards = await db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(eq(schema.cards.deckId, virtualDeck.sourceDeckId))
    .orderBy(asc(schema.cards.id));

  const indices = parseCardSelection(virtualDeck.cardSelection);

  // Map 1-based indices to actual card IDs
  const cardIds: number[] = [];
  for (const index of indices) {
    if (index <= allCards.length) {
      cardIds.push(allCards[index - 1].id);
    }
  }

  return cardIds;
}

export async function updateVirtualDeck(
  virtualDeckId: number,
  userId: number,
  updates: { name?: string; cardSelection?: string }
) {
  if (updates.cardSelection) {
    const validation = validateCardSelection(updates.cardSelection);
    if (!validation.valid) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: validation.error ?? 'Invalid card selection',
        cause: { appCode: 'INVALID_CARD_SELECTION' },
      });
    }
  }

  await db.update(schema.virtualDecks)
    .set(updates)
    .where(and(
      eq(schema.virtualDecks.id, virtualDeckId),
      eq(schema.virtualDecks.userId, userId)
    ));

  return getVirtualDeck(virtualDeckId, userId);
}
