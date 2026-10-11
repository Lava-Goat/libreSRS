// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Finished all flashcards" (v1.18.0): a
 * student's school day on which nothing is due in ANY deck of their groups,
 * after rating at least one card that day. "Nothing due" is what every deck
 * card shows (services/dueToday.ts dueTodayByDeck: learning, reviews within the
 * limits and new cards within the limits, all zero), and, as a deck's "All
 * Done!" asks of one deck, no card waiting on a learning step later that day
 * (allDoneIn): it comes back today. Mini-decks do not count.
 *
 * It is checked by any path, "Study all" (newest deck first) or deck by deck,
 * whenever a deck's day empties: at the review that empties it
 * (routers/cards.ts finishDeckDayAtReview) and at logStudyCompletion
 * (recordAllFlashcardsDay). A deck's own "All Done!" still logs its
 * study_completions row (the teacher's grid).
 *
 * The day is recorded (flashcard_all_done) for the teacher's Flashcards-by-day
 * grid; an extension hears of it through the studyFinish hook.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import { startOfDayForOffset } from '../utils/time.js';
import { dueTodayByDeck, type DueToday } from './dueToday.js';
import { userDecksNewestFirst, type AssignedDeck } from './deckAccess.js';
import { schoolDayOf, schoolOffsetMinutes } from './schoolCalendar.js';

/** A deck of the student's groups with what it holds today. */
export interface DeckToday extends AssignedDeck {
  due: DueToday;
}

/**
 * Every deck of the student's groups, newest first (Study all's order), with
 * what each holds today under the student's limits at this clock offset (the
 * page's for "Study all", the school's for the all-flashcards day: schoolCalendar.ts
 * schoolOffsetMinutes). Only reads.
 */
export function decksToday(userId: number, timezoneOffsetMinutes: number | undefined, now = new Date()): DeckToday[] {
  const decks = userDecksNewestFirst(userId);
  const due = dueTodayByDeck(userId, decks.map((d) => d.id), timezoneOffsetMinutes, now);
  return decks.flatMap((deck) => {
    const today = due.get(deck.id);
    return today ? [{ ...deck, due: today }] : [];
  });
}

/** Nothing due now in any of these decks (the deck cards' numbers all zero). */
export const nothingDueIn = (decks: readonly DeckToday[]): boolean => decks.every((d) => d.due.total === 0);

/**
 * The day is done in every one of these decks: nothing due now (nothingDueIn)
 * and no card waiting on a learning step later today, as a deck's "All Done!"
 * asks of one deck. A card left in learning comes back today: its deck is not done.
 * (A session that ends normally leaves none: the page asks a learning card
 * again until it graduates.)
 */
export const allDoneIn = (decks: readonly DeckToday[]): boolean =>
  nothingDueIn(decks) && decks.every((d) => d.due.learningLater === 0);

/** Ratings by the student in these decks since a time (the start of the school day). */
export function ratedSince(userId: number, deckIds: readonly number[], since: Date): number {
  if (deckIds.length === 0) return 0;
  return db.select({ count: sql<number>`count(*)` })
    .from(schema.reviewLogs)
    .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
    .where(and(eq(schema.reviewLogs.userId, userId), inArray(schema.cards.deckId, [...deckIds]), gte(schema.reviewLogs.reviewedAt, since)))
    .get()?.count ?? 0;
}

/**
 * Records that the student finished all flashcards on the school day of `at`
 * (the first moment only: a later call that day changes nothing). Students
 * only: a teacher's practice is not a school day's work. Returns true when
 * this call wrote the day's row. The caller has checked the day (see the top
 * of this file); this only writes.
 */
export function markAllFlashcardsDone(user: { id: number; role: string }, deckIds: readonly number[], at = new Date()): boolean {
  if (user.role === 'admin') return false;
  return db.insert(schema.flashcardAllDone)
    .values({ userId: user.id, day: schoolDayOf(at), completedAt: at, deckIds: JSON.stringify([...deckIds]) })
    .onConflictDoNothing()
    .returning({ userId: schema.flashcardAllDone.userId })
    .all().length > 0;
}

/** When each of these students first finished all their flashcards on a school day (YYYY-MM-DD), by user id. */
export function allFlashcardsDoneOn(userIds: readonly number[], day: string): Map<number, Date> {
  if (userIds.length === 0) return new Map();
  const D = schema.flashcardAllDone;
  return new Map(db.select({ userId: D.userId, completedAt: D.completedAt }).from(D)
    .where(and(eq(D.day, day), inArray(D.userId, [...new Set(userIds)])))
    .all()
    .map((row) => [row.userId, row.completedAt]));
}

/** A school day on which the student finished all flashcards: the day, the decks it was judged by, and when it began. */
export interface AllFlashcardsDay {
  /** The school day (YYYY-MM-DD). */
  day: string;
  /** Every deck of the student's groups, newest first. */
  deckIds: number[];
  /** The start of that school day. */
  todayStart: Date;
}

/**
 * Whether the student has finished all flashcards for the school day of
 * `now`, checked against the server's own records on the school's clock (a
 * page can send any offset), and if so records it (markAllFlashcardsDone,
 * whatever any other setting says, for the teacher's grid):
 *
 * - null for a teacher;
 * - every deck of the student's groups done for the day (allDoneIn: nothing
 *   due under the limits, nothing in learning), and at least one of their
 *   cards rated today; otherwise null.
 *
 * `schoolDecks` is decksToday at the school's offset for `now`, when the caller
 * has it already (routers/cards.ts finishSession). Never fails its caller:
 * errors are logged and null is returned.
 */
export function recordAllFlashcardsDay(
  user: { id: number; role: string },
  now = new Date(),
  schoolDecks?: readonly DeckToday[],
): AllFlashcardsDay | null {
  try {
    if (user.role === 'admin') return null;
    const offset = schoolOffsetMinutes(now);
    const decks = schoolDecks ?? decksToday(user.id, offset, now);
    if (decks.length === 0 || !allDoneIn(decks)) return null;
    const deckIds = decks.map((d) => d.id);
    const todayStart = startOfDayForOffset(offset, now);
    if (ratedSince(user.id, deckIds, todayStart) === 0) return null;
    markAllFlashcardsDone(user, deckIds, now);
    return { day: schoolDayOf(now), deckIds, todayStart };
  } catch (err) {
    logger.error({ err, event: 'cards.all_flashcards_day_failed', userId: user.id }, 'Checking the all-flashcards day failed');
    return null;
  }
}
