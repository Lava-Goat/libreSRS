// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A student's day in a deck, from the server's own records: their limits,
 * what they rated today, what is left, and whether anything is still due.
 *
 * getDueCards (routers/cards.ts) picks the day's cards with these numbers,
 * logStudyCompletion checks a claimed "All Done!" against the same selection
 * and counts the session's cards, and "finished all flashcards"
 * (services/allFlashcards.ts) reads the day the same way. One place, so the
 * page, the log and the day never disagree about what "today's cards" were.
 *
 * Ratings are counted by the card's state before the rating, as the limits
 * mean them: New for new cards, Review for reviews. A learning step counts
 * toward neither.
 *
 * dueTodayByDeck is what every "due" number shows (the deck list, Your
 * Progress, a mini-deck, the teacher's user page) and what the finish checks
 * read: exactly the cards getDueCards would open Study with now. It only
 * reads, so a check or a page never sets up a card's state.
 */
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { CardDirection, State } from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { computeEffectiveLimits, getDeckUserSettings } from './userSettings.js';
import { startOfDayForOffset } from '../utils/time.js';

export interface StudyDay {
  /** The student's effective limits for this deck. */
  newCardsPerDay: number;
  reviewsPerDay: number;
  /** Midnight on the student's clock (the page's timezone offset). */
  todayStart: Date;
  /** Rated today: cards that were new, cards that were in review. */
  newToday: number;
  reviewsToday: number;
  remainingNew: number;
  remainingReviews: number;
}

/**
 * Which ratings count: a deck's, or only a virtual deck's selection of it
 * (its card ids, from services/virtualDecks.getVirtualDeckCardIds).
 */
export interface RatingScope {
  deckId: number;
  cardIds?: readonly number[];
}

export interface RatingWindow {
  /** Ratings at or after this time (`after: false`), or strictly after it (`after: true`). */
  since: Date;
  /**
   * Strictly after `since`. Used when `since` is an earlier "All Done!": the
   * clock keeps whole seconds, and a session's last rating shares its
   * completion's second, so it must not count again for the next session.
   */
  after?: boolean;
}

function toScope(scope: number | RatingScope): RatingScope {
  return typeof scope === 'number' ? { deckId: scope } : scope;
}

/** Ratings by a student in a deck (or a selection of it) in a window, optionally only those from one card state. */
export function countRatings(userId: number, scope: number | RatingScope, range: RatingWindow, previousState?: State): number {
  const { deckId, cardIds } = toScope(scope);
  if (cardIds && cardIds.length === 0) return 0;
  const conditions = [
    eq(schema.reviewLogs.userId, userId),
    eq(schema.cards.deckId, deckId),
    range.after ? gt(schema.reviewLogs.reviewedAt, range.since) : gte(schema.reviewLogs.reviewedAt, range.since),
  ];
  if (previousState !== undefined) conditions.push(eq(schema.reviewLogs.previousState, previousState));
  if (cardIds) conditions.push(inArray(schema.reviewLogs.cardId, [...cardIds]));
  return db.select({ count: sql<number>`count(*)` })
    .from(schema.reviewLogs)
    .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
    .where(and(...conditions))
    .get()?.count ?? 0;
}

/** What today holds for a student in a deck: their limits, what they rated, what is left. */
export async function studyDay(userId: number, deckId: number, timezoneOffsetMinutes?: number, now = new Date()): Promise<StudyDay> {
  const settings = await getDeckUserSettings(userId, deckId);
  const todayStart = startOfDayForOffset(timezoneOffsetMinutes, now);
  const newToday = countRatings(userId, deckId, { since: todayStart }, State.New);
  const reviewsToday = countRatings(userId, deckId, { since: todayStart }, State.Review);
  return {
    newCardsPerDay: settings.newCardsPerDay,
    reviewsPerDay: settings.reviewsPerDay,
    todayStart,
    newToday,
    reviewsToday,
    remainingNew: Math.max(0, settings.newCardsPerDay - newToday),
    remainingReviews: Math.max(0, settings.reviewsPerDay - reviewsToday),
  };
}

/**
 * Cards rated in a session: new ones and reviews since `since`, as the day's
 * limits count them. `since` is inclusive unless `after` is set.
 */
export function sessionCounts(
  userId: number,
  scope: number | RatingScope,
  since: Date,
  options: { after?: boolean } = {},
): { newCardsDone: number; reviewsDone: number } {
  const range = { since, after: options.after };
  return {
    newCardsDone: countRatings(userId, scope, range, State.New),
    reviewsDone: countRatings(userId, scope, range, State.Review),
  };
}

/** What a deck holds for a student today, as Study would open it now. */
export interface DueToday {
  /** Learning and relearning steps due now (no daily limit applies to them). */
  learning: number;
  /** Reviews due now, up to what today's review limit still allows. */
  reviews: number;
  /** New cards, up to what today's new-card limit still allows. */
  newCards: number;
  /** learning + reviews + newCards: the number of cards Study opens with now. */
  total: number;
  /** Reviews due now past today's review limit: they wait for another day. */
  reviewsBeyondLimit: number;
  /** Cards in learning whose next step is later: they come back today, or soon. */
  learningLater: number;
  /** When the first of those comes back (ms), or null when none waits. */
  nextLearningAt: number | null;
}

const NOTHING_DUE: DueToday = {
  learning: 0, reviews: 0, newCards: 0, total: 0, reviewsBeyondLimit: 0, learningLater: 0, nextLearningAt: null,
};

/** Seconds, as the `timestamp` columns hold them (raw SQL sees no Date mapping). */
const toSeconds = (at: Date) => Math.floor(at.getTime() / 1000);

/**
 * Each deck's day for a student: the cards getDueCards would give Study now,
 * under the student's limits for the deck and what today already used of
 * them. Grouped reads, one of each kind for all the decks, and nothing is
 * written: no card state is set up and no settings row is created.
 *
 * - Card states count only in the directions the deck is studied (a
 *   reversible deck both ways, any other forward only), as getDueCards reads them.
 * - New cards: every card in each direction, less those started (a state other
 *   than New). A New row set up when the deck was opened is still a new card,
 *   counted once.
 * - `cardFilter` narrows it to a mini-deck's cards: the cards, their states and
 *   today's ratings, so its limits are counted within the selection
 *   (as routers/virtualDecks.getDueCards does).
 *
 * A deck that does not exist is left out of the map.
 */
export function dueTodayByDeck(
  userId: number,
  deckIds: readonly number[],
  timezoneOffsetMinutes?: number,
  now = new Date(),
  cardFilter?: readonly number[],
): Map<number, DueToday> {
  const out = new Map<number, DueToday>();
  const ids = [...new Set(deckIds)];
  if (ids.length === 0) return out;
  const decks = db.select({ id: schema.decks.id, reversible: schema.decks.reversible })
    .from(schema.decks).where(inArray(schema.decks.id, ids)).all();
  if (cardFilter && cardFilter.length === 0) {
    for (const deck of decks) out.set(deck.id, { ...NOTHING_DUE });
    return out;
  }
  const filter = cardFilter ? [...cardFilter] : null;
  const deckIdList = decks.map((d) => d.id);
  if (deckIdList.length === 0) return out;

  const C = schema.cards;
  const S = schema.cardStates;
  const R = schema.reviewLogs;
  const nowSeconds = toSeconds(now);
  const learningStates = sql`(${State.Learning}, ${State.Relearning})`;

  const cardCounts = new Map(db.select({ deckId: C.deckId, count: sql<number>`count(*)` })
    .from(C)
    .where(and(inArray(C.deckId, deckIdList), filter ? inArray(C.id, filter) : undefined))
    .groupBy(C.deckId)
    .all()
    .map((row) => [row.deckId, Number(row.count)]));

  const states = new Map(db.select({
    deckId: C.deckId,
    learning: sql<number>`coalesce(sum(case when ${S.state} in ${learningStates} and ${S.nextReview} <= ${nowSeconds} then 1 else 0 end), 0)`,
    learningLater: sql<number>`coalesce(sum(case when ${S.state} in ${learningStates} and ${S.nextReview} > ${nowSeconds} then 1 else 0 end), 0)`,
    nextLearning: sql<number | null>`min(case when ${S.state} in ${learningStates} and ${S.nextReview} > ${nowSeconds} then ${S.nextReview} end)`,
    reviewDue: sql<number>`coalesce(sum(case when ${S.state} = ${State.Review} and ${S.nextReview} <= ${nowSeconds} then 1 else 0 end), 0)`,
    started: sql<number>`coalesce(sum(case when ${S.state} != ${State.New} then 1 else 0 end), 0)`,
  })
    .from(S)
    .innerJoin(C, eq(S.cardId, C.id))
    .innerJoin(schema.decks, eq(C.deckId, schema.decks.id))
    .where(and(
      eq(S.userId, userId),
      inArray(C.deckId, deckIdList),
      // The decks' cards by id as well: SQLite then reads just those states through the
      // (user, card, direction) index instead of every state the student has (this runs at
      // each review that could end the day).
      inArray(S.cardId, filter ?? db.select({ id: C.id }).from(C).where(inArray(C.deckId, deckIdList))),
      sql`(${schema.decks.reversible} = 1 or ${S.direction} = ${CardDirection.Forward})`,
    ))
    .groupBy(C.deckId)
    .all()
    .map((row) => [row.deckId, row]));

  const todayStart = startOfDayForOffset(timezoneOffsetMinutes, now);
  const ratings = new Map(db.select({
    deckId: C.deckId,
    newToday: sql<number>`coalesce(sum(case when ${R.previousState} = ${State.New} then 1 else 0 end), 0)`,
    reviewsToday: sql<number>`coalesce(sum(case when ${R.previousState} = ${State.Review} then 1 else 0 end), 0)`,
  })
    .from(R)
    .innerJoin(C, eq(R.cardId, C.id))
    .where(and(
      eq(R.userId, userId),
      inArray(C.deckId, deckIdList),
      gte(R.reviewedAt, todayStart),
      filter ? inArray(R.cardId, filter) : undefined,
    ))
    .groupBy(C.deckId)
    .all()
    .map((row) => [row.deckId, row]));

  // The student's limits as getDeckUserSettings works them out, read without creating their row.
  const userSettings = db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).get() ?? null;
  const deckSettings = new Map(db.select().from(schema.deckUserSettings)
    .where(and(eq(schema.deckUserSettings.userId, userId), inArray(schema.deckUserSettings.deckId, deckIdList)))
    .all()
    .map((row) => [row.deckId, row]));

  for (const deck of decks) {
    const limits = computeEffectiveLimits(userSettings, deckSettings.get(deck.id) ?? null);
    const state = states.get(deck.id);
    const rated = ratings.get(deck.id);
    const learning = Number(state?.learning ?? 0);
    const reviewDue = Number(state?.reviewDue ?? 0);
    const unseen = Math.max(0, (cardCounts.get(deck.id) ?? 0) * (deck.reversible ? 2 : 1) - Number(state?.started ?? 0));
    const reviews = Math.min(reviewDue, Math.max(0, limits.reviewsPerDay - Number(rated?.reviewsToday ?? 0)));
    const newCards = Math.min(unseen, Math.max(0, limits.newCardsPerDay - Number(rated?.newToday ?? 0)));
    const nextLearning = state?.nextLearning;
    out.set(deck.id, {
      learning,
      reviews,
      newCards,
      total: learning + reviews + newCards,
      reviewsBeyondLimit: reviewDue - reviews,
      learningLater: Number(state?.learningLater ?? 0),
      nextLearningAt: nextLearning === null || nextLearning === undefined ? null : Number(nextLearning) * 1000,
    });
  }
  return out;
}

/** Cards of the deck the student still has in learning (the session is not over while one waits for its step). */
export function inLearning(userId: number, deckId: number): number {
  return db.select({ count: sql<number>`count(*)` })
    .from(schema.cardStates)
    .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
    .where(and(
      eq(schema.cardStates.userId, userId),
      eq(schema.cards.deckId, deckId),
      // By the deck's card ids too, so only its states are read (see dueTodayByDeck).
      inArray(schema.cardStates.cardId, db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.deckId, deckId))),
      inArray(schema.cardStates.state, [State.Learning, State.Relearning]),
    ))
    .get()?.count ?? 0;
}

/**
 * Whether a card of the deck is still waiting today under the student's
 * limits: the same selection getDueCards gives the study page, so an honest
 * "All Done!" (every queued card graduated, the last rating saved) always
 * finds none. It only reads (dueTodayByDeck).
 */
export async function cardsLeftToday(userId: number, deckId: number, timezoneOffsetMinutes?: number, now = new Date()): Promise<boolean> {
  return (dueTodayByDeck(userId, [deckId], timezoneOffsetMinutes, now).get(deckId)?.total ?? 0) > 0;
}
