// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** A deck of the user's groups, as "Study all" orders them. */
export interface AssignedDeck {
  id: number;
  name: string;
  createdAt: Date;
}

/**
 * The decks of a user's groups, newest first (by creation, then id), each once:
 * the order "Study all" runs them in (v1.18.0), the newest unit leading, and
 * the decks "finished all flashcards" looks at. Real decks only: a mini-deck is
 * the student's own selection of one of these.
 */
export function userDecksNewestFirst(userId: number): AssignedDeck[] {
  return db.selectDistinct({ id: schema.decks.id, name: schema.decks.name, createdAt: schema.decks.createdAt })
    .from(schema.userGroups)
    .innerJoin(schema.deckGroups, eq(schema.userGroups.groupId, schema.deckGroups.groupId))
    .innerJoin(schema.decks, eq(schema.deckGroups.deckId, schema.decks.id))
    .where(eq(schema.userGroups.userId, userId))
    .orderBy(desc(schema.decks.createdAt), desc(schema.decks.id))
    .all();
}

export async function getUserDeckIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ deckId: schema.deckGroups.deckId })
    .from(schema.userGroups)
    .innerJoin(
      schema.deckGroups,
      eq(schema.userGroups.groupId, schema.deckGroups.groupId)
    )
    .where(eq(schema.userGroups.userId, userId));

  return [...new Set(rows.map((row) => row.deckId))];
}

export async function hasDeckAccess(userId: number, deckId: number): Promise<boolean> {
  const rows = await db
    .select({ deckId: schema.deckGroups.deckId })
    .from(schema.userGroups)
    .innerJoin(
      schema.deckGroups,
      eq(schema.userGroups.groupId, schema.deckGroups.groupId)
    )
    .where(
      and(
        eq(schema.userGroups.userId, userId),
        eq(schema.deckGroups.deckId, deckId)
      )
    )
    .limit(1);

  return rows.length > 0;
}

export async function assertDeckAccess(userId: number, deckId: number): Promise<void> {
  const allowed = await hasDeckAccess(userId, deckId);
  if (allowed) {
    return;
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'You do not have access to this deck',
    cause: { appCode: 'DECK_ACCESS_DENIED' },
  });
}
