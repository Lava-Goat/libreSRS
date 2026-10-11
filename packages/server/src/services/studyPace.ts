// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The pace rule: how a student's first answers went on a day, read from the
 * server's own records. The teacher's "Flashcards by day" grid
 * (services/flashcardDay.ts paceOf) marks a day "Fast" or "all Easy" by these
 * numbers, and anything else that judges effort reads the same ones, so a
 * mark on the grid and a judgement elsewhere can never disagree.
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { Rating, State } from '@libresrs/shared';
import { db, schema } from '../db/index.js';

// ---------------------------------------------------------------------------
// The pace rule (v1.16). These are the only place its numbers live: the
// teacher's grid (services/flashcardDay.ts) and the tests read them from here,
// so changing one is a one-line edit (and the one test that pins the speed
// line).

/**
 * A day is "Fast" when half of its first answers took less than this: 1.0 s.
 * Below it, a day's first answers come faster than a student can read the
 * card; every scripted run in the v1.15 simulation was under 1.2 s. (First
 * answers take cards rated New or in Review, and cards carried over in
 * learning from an earlier day, see firstAnswerRows.)
 */
export const FAST_FIRST_ANSWER_MEDIAN_MS = 1000;
/** "All Easy" needs at least this many new cards rated that day... */
export const ALL_EASY_MIN_NEW_CARDS = 10;
/** ...and this share of them rated Easy the first time they were shown. */
export const ALL_EASY_MIN_SHARE = 0.9;

/**
 * How a student's first answers went (firstAnswerRows): the time of each, and
 * how many new cards were rated, and rated Easy.
 */
export interface FirstAnswers {
  timesMs: number[];
  newCards: number;
  easyNew: number;
}

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function medianMs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One first answer: whose, in which deck, and how it went. */
export interface FirstAnswerRow {
  userId: number;
  deckId: number;
  timeSpentMs: number;
  previousState: number;
  rating: number;
}

/**
 * The first answers of these students in these decks in [start, end): each
 * card's first rating in that span (each way of a reversible card on its own),
 * whatever state it was in.
 *
 * - A new card counts once: its learning steps later that day are quick
 *   re-views for everyone, and would pull an honest median down. A review
 *   card likewise: its relearning steps after a lapse are left out.
 * - A card carried over in learning from an earlier day counts too: its first
 *   rating today is a real recall. Otherwise a day of nothing but carry-overs
 *   (every card rated Again yesterday, then mashed through today) would have
 *   no first answers to judge.
 *
 * Read in rating order and picked here: a student's day in a deck is a few
 * hundred ratings, a class's a few thousand.
 */
export function firstAnswerRows(userIds: readonly number[], deckIds: readonly number[], start: Date, end?: Date): FirstAnswerRow[] {
  if (userIds.length === 0 || deckIds.length === 0) return [];
  const R = schema.reviewLogs;
  const rows = db.select({
    userId: R.userId,
    deckId: schema.cards.deckId,
    cardId: R.cardId,
    cardStateId: R.cardStateId,
    timeSpentMs: R.timeSpentMs,
    previousState: R.previousState,
    rating: R.rating,
  })
    .from(R)
    .innerJoin(schema.cards, eq(R.cardId, schema.cards.id))
    .where(and(
      inArray(R.userId, [...userIds]),
      inArray(schema.cards.deckId, [...deckIds]),
      gte(R.reviewedAt, start),
      end ? lt(R.reviewedAt, end) : undefined,
    ))
    // reviewed_at keeps whole seconds: the id orders ratings within one.
    .orderBy(asc(R.reviewedAt), asc(R.id))
    .all();
  const seen = new Set<string>();
  const first: FirstAnswerRow[] = [];
  for (const row of rows) {
    // A card's state is one way of it; logs from before card_state_id was kept name only the card.
    const key = `${row.userId}:${row.cardStateId ?? `card ${row.cardId}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    first.push({ userId: row.userId, deckId: row.deckId, timeSpentMs: row.timeSpentMs, previousState: row.previousState, rating: row.rating });
  }
  return first;
}

/**
 * A student's first answers in a deck, or in several (every deck of their
 * groups), since a time (the start of the school day).
 */
export function firstAnswersSince(userId: number, deckIds: number | readonly number[], since: Date): FirstAnswers {
  const rows = firstAnswerRows([userId], typeof deckIds === 'number' ? [deckIds] : deckIds, since);
  const newRows = rows.filter((r) => r.previousState === State.New);
  return {
    timesMs: rows.map((r) => Math.max(0, r.timeSpentMs)),
    newCards: newRows.length,
    easyNew: newRows.filter((r) => r.rating === Rating.Easy).length,
  };
}
