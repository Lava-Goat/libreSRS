// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module fsrs (service)
 *
 * Core spaced-repetition state machine — schedule card reviews, persist outcomes
 * atomically, undo the most recent review, and aggregate user statistics.
 *
 * Module invariants
 * -----------------
 * 1. One cardStates row per (cardId, userId, direction).  Creating duplicates
 *    violates the unique constraint and causes runtime errors; callers must not
 *    create card states directly.
 * 2. `reviewCard` and `undoReview` wrap ALL DB writes in a single transaction.
 *    If the transaction throws, the card state is left unchanged — no partial
 *    state is ever persisted.
 * 3. `reviewCard` enforces ownership with `userId` in both the pre-fetch SELECT
 *    and the transaction UPDATE WHERE clause.  A mismatched userId causes the
 *    pre-fetch to return null, which throws before any transaction begins.
 * 4. `undoReview` enforces "latest log" before the transaction.  TOCTOU window:
 *    a concurrent review that completes between the latestLog check and the
 *    transaction could sneak through because "is latest" is not re-validated
 *    inside the transaction.  The UI serialises reviews per card to mitigate this.
 * 5. The fire-and-forget AI trigger in `reviewCard` runs OUTSIDE the transaction.
 *    Its failure is logged but never propagates — it cannot corrupt card state.
 *
 * Function ledger
 * ---------------
 * getLearningCards / getReviewCards / getNewCards   [private helpers]
 *   Read-only.  No invariants broken by early-return (returns []).
 *
 * getDueCards(userId, deckId, options) → CardWithState[]
 *   Read-only.  Clamps limit/newLimit/reviewLimit to ≥0.
 *   Early-return: [] if limit=0 OR options.cardFilter is an empty array.
 *   Does NOT initialise card state rows; new cards appear via getNewCards which
 *   selects cards without an existing state row.
 *
 * reviewCard(cardStateId, userId, rating, timeSpentMs)
 *   Requires:  cardState with matching (cardStateId, userId) exists in DB.
 *   Restores:  cardState updated + reviewLog inserted atomically; reviewLogId > 0.
 *   The page's timeSpentMs is stored as at most the time since the student's
 *   previous rating in the deck, and at most RATING_TIME_CAP_MS, read inside
 *   the same transaction (see storedTimeSpent).
 *   Early-return (card not found): throws Error('Card state not found') — no DB write.
 *   reviewLogId === 0 after commit: invariant violated — throws immediately.
 *   AI trigger: fire-and-forget outside transaction; failure cannot affect card state.
 *
 * getReviewOptions(cardState) → NextReviewOptions
 *   Pure.  Delegates to @libresrs/shared.  No invariants.
 *
 * undoReview(reviewLogId, userId)
 *   Requires:  reviewLog belongs to userId AND is the latest log for its cardState
 *              (enforced by latestLog pre-check, subject to TOCTOU — see #4 above).
 *              reviewLog.previousStateSnapshot must be present and parseable.
 *   Restores:  cardState rolled back to snapshot + log deleted atomically.
 *   Early-return: throws if log not found, not latest, snapshot missing.
 *   Post-transaction: re-reads cardState to return fresh data; throws if not found.
 *
 * getDueCount(userId, deckId, cardIds?, timezoneOffsetMinutes?)
 *   Read-only (dueToday.dueTodayByDeck).  Returns 0 if cardIds is an empty array.
 *
 * getUserStats(userId, timezoneOffsetMinutes?)
 *   Read-only.  Cards due is the sum of dueTodayByDeck over the user's decks;
 *   returns totalDue=0 if user has no group membership.
 */
import { z } from 'zod';
import { createNewCardState, scheduleReview, getNextReviewOptions, Rating, State, CardDirection } from '@libresrs/shared';
import type { CardForReview, SchedulingResult, ReviewRating, NextReviewOptions } from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { eq, and, lte, sql, inArray, gte, asc, notInArray, isNull, desc, ne } from 'drizzle-orm';
import { startOfDayForOffset } from '../utils/time.js';
import { logger } from '../logger.js';
import { dueTodayByDeck } from './dueToday.js';
import { getUserDeckIds } from './deckAccess.js';
import { RATING_TIME_CAP_MS } from './flashcardDay.js';

export { Rating, State };

const StateSchema = z.nativeEnum(State);
const DirectionSchema = z.nativeEnum(CardDirection);

function parseState(value: unknown): State {
  return StateSchema.parse(value);
}

function parseDirection(value: unknown): CardDirection {
  return DirectionSchema.parse(value);
}

export interface CardWithState {
  card: {
    id: number;
    deckId: number;
    front: string;
    back: string;
  };
  state: CardForReview & { id: number };
  direction: CardDirection;
}

export interface DueCardOptions {
  limit: number;
  newLimit: number;
  reviewLimit?: number;
  cardFilter?: number[]; // Optional: only include cards with these IDs (for virtual decks)
}

function toCardState(state: typeof schema.cardStates.$inferSelect): CardForReview & { id: number } {
  return {
    id: state.id,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    state: parseState(state.state),
    lastReview: state.lastReview,
  };
}

type DueCardQuery = {
  userId: number;
  deckId: number;
  now: Date;
  directions: CardDirection[];
  cardFilter?: number[];
  limit: number;
};

function toCardWithState(
  card: typeof schema.cards.$inferSelect,
  state: typeof schema.cardStates.$inferSelect
): CardWithState {
  return {
    card: {
      id: card.id,
      deckId: card.deckId,
      front: card.front,
      back: card.back,
    },
    state: toCardState(state),
    direction: parseDirection(state.direction),
  };
}

async function getLearningCards(query: DueCardQuery): Promise<CardWithState[]> {
  if (query.limit <= 0) return [];
  const conditions = [
    eq(schema.cardStates.userId, query.userId),
    eq(schema.cards.deckId, query.deckId),
    lte(schema.cardStates.nextReview, query.now),
    inArray(schema.cardStates.direction, query.directions),
    inArray(schema.cardStates.state, [State.Learning, State.Relearning]),
  ];

  if (query.cardFilter) {
    conditions.push(inArray(schema.cardStates.cardId, query.cardFilter));
  }

  const rows = await db
    .select({ card: schema.cards, state: schema.cardStates })
    .from(schema.cardStates)
    .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
    .where(and(...conditions))
    .orderBy(asc(schema.cardStates.nextReview), asc(schema.cardStates.cardId))
    .limit(query.limit);

  return rows.map((row) => toCardWithState(row.card, row.state));
}

async function getReviewCards(query: DueCardQuery): Promise<CardWithState[]> {
  if (query.limit <= 0) return [];
  const conditions = [
    eq(schema.cardStates.userId, query.userId),
    eq(schema.cards.deckId, query.deckId),
    lte(schema.cardStates.nextReview, query.now),
    inArray(schema.cardStates.direction, query.directions),
    notInArray(schema.cardStates.state, [State.New, State.Learning, State.Relearning]),
  ];

  if (query.cardFilter) {
    conditions.push(inArray(schema.cardStates.cardId, query.cardFilter));
  }

  const rows = await db
    .select({ card: schema.cards, state: schema.cardStates })
    .from(schema.cardStates)
    .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
    .where(and(...conditions))
    .orderBy(asc(schema.cardStates.nextReview), asc(schema.cardStates.cardId))
    .limit(query.limit);

  return rows.map((row) => toCardWithState(row.card, row.state));
}

async function getNewCards(
  userId: number,
  deckId: number,
  directions: CardDirection[],
  cardFilter: number[] | undefined,
  limit: number
): Promise<CardWithState[]> {
  if (limit <= 0) return [];
  const results: CardWithState[] = [];
  let remaining = limit;

  for (const direction of directions) {
    if (remaining <= 0) break;

    // 1) Cards that already have a card_states row with state=New (pre-initialized)
    const preInitConditions = [
      eq(schema.cardStates.userId, userId),
      eq(schema.cards.deckId, deckId),
      eq(schema.cardStates.direction, direction),
      eq(schema.cardStates.state, State.New),
    ];
    if (cardFilter) {
      preInitConditions.push(inArray(schema.cards.id, cardFilter));
    }

    const preInitRows = await db
      .select({ card: schema.cards, state: schema.cardStates })
      .from(schema.cardStates)
      .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
      .where(and(...preInitConditions))
      .orderBy(asc(schema.cards.id))
      .limit(remaining);

    for (const row of preInitRows) {
      results.push(toCardWithState(row.card, row.state));
    }
    remaining = limit - results.length;
    if (remaining <= 0) break;

    // 2) Truly unseen cards (no card_states row at all)
    const unseenConditions = [
      eq(schema.cards.deckId, deckId),
      isNull(schema.cardStates.id),
    ];
    if (cardFilter) {
      unseenConditions.push(inArray(schema.cards.id, cardFilter));
    }

    const rows = await db
      .select({ card: schema.cards })
      .from(schema.cards)
      .leftJoin(
        schema.cardStates,
        and(
          eq(schema.cardStates.cardId, schema.cards.id),
          eq(schema.cardStates.userId, userId),
          eq(schema.cardStates.direction, direction)
        )
      )
      .where(and(...unseenConditions))
      .orderBy(asc(schema.cards.id))
      .limit(remaining);

    if (rows.length === 0) {
      continue;
    }

    const cardIds = rows.map((row) => row.card.id);
    const newState = createNewCardState();
    const now = new Date();

    await db.insert(schema.cardStates).values(
      cardIds.map((cardId) => ({
        cardId,
        userId,
        direction,
        stability: newState.stability,
        difficulty: newState.difficulty,
        elapsedDays: newState.elapsedDays,
        scheduledDays: newState.scheduledDays,
        reps: newState.reps,
        lapses: newState.lapses,
        state: newState.state,
        lastReview: newState.lastReview,
        nextReview: now,
      }))
    ).onConflictDoNothing({
      target: [schema.cardStates.userId, schema.cardStates.cardId, schema.cardStates.direction],
    });

    const states = await db.query.cardStates.findMany({
      where: and(
        eq(schema.cardStates.userId, userId),
        eq(schema.cardStates.direction, direction),
        inArray(schema.cardStates.cardId, cardIds)
      ),
    });

    const stateMap = new Map(states.map((state) => [state.cardId, state]));

    for (const row of rows) {
      const state = stateMap.get(row.card.id);
      if (!state) {
        continue;
      }
      results.push(toCardWithState(row.card, state));
    }

    remaining = limit - results.length;
  }

  return results;
}

export async function getDueCards(userId: number, deckId: number, options: DueCardOptions): Promise<CardWithState[]> {
  const limit = Math.max(0, options.limit);
  const newLimit = Math.max(0, options.newLimit);
  const reviewLimit = options.reviewLimit !== undefined ? Math.max(0, options.reviewLimit) : limit;

  if (limit === 0) {
    return [];
  }

  if (options.cardFilter && options.cardFilter.length === 0) {
    return [];
  }

  const now = new Date();

  // Fetch deck to check reversible flag
  const deck = await db.query.decks.findFirst({
    where: eq(schema.decks.id, deckId),
  });

  if (!deck) {
    return [];
  }

  const directions = deck.reversible
    ? [CardDirection.Forward, CardDirection.Reverse]
    : [CardDirection.Forward];

  const baseQuery = {
    userId,
    deckId,
    now,
    directions,
    cardFilter: options.cardFilter,
  };

  const learningCards = await getLearningCards({
    ...baseQuery,
    limit,
  });

  const remainingForReview = Math.min(reviewLimit, limit - learningCards.length);
  const reviewCards = await getReviewCards({
    ...baseQuery,
    limit: remainingForReview,
  });

  const remainingForNew = Math.min(newLimit, limit - learningCards.length - reviewCards.length);
  const newCards = await getNewCards(
    userId,
    deckId,
    directions,
    options.cardFilter,
    remainingForNew
  );

  return [...learningCards, ...reviewCards, ...newCards];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The time a rating is stored with. The page times each card from when it is
 * shown to the rating and waits for each review before showing the next card,
 * so its time is never more than the time since the student's previous rating
 * in the deck, as the server saw it. A made-up time (the console can send any
 * number) is held to that gap, and every rating to RATING_TIME_CAP_MS (a card
 * left open over lunch is not two hours of study). reviewed_at keeps whole
 * seconds, so up to about a second of slack remains.
 */
function storedTimeSpent(tx: Tx, userId: number, deckId: number | null, claimedMs: number, now: Date): number {
  let limit = RATING_TIME_CAP_MS;
  if (deckId !== null) {
    const previous = tx.select({ at: schema.reviewLogs.reviewedAt })
      .from(schema.reviewLogs)
      .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
      .where(and(eq(schema.reviewLogs.userId, userId), eq(schema.cards.deckId, deckId)))
      .orderBy(desc(schema.reviewLogs.reviewedAt))
      .limit(1)
      .get();
    if (previous) limit = Math.min(limit, Math.max(0, now.getTime() - previous.at.getTime()));
  }
  return Math.max(0, Math.min(Math.round(claimedMs), limit));
}

export async function reviewCard(
  cardStateId: number,
  userId: number,
  rating: ReviewRating,
  timeSpentMs: number
): Promise<{ result: SchedulingResult; reviewLogId: number }> {
  logger.info({
    event: 'review.start',
    cardStateId,
    userId,
    rating,
    timeSpentMs,
  }, 'Review requested');

  const cardState = await db.query.cardStates.findFirst({
    where: and(
      eq(schema.cardStates.id, cardStateId),
      eq(schema.cardStates.userId, userId)
    ),
  });

  if (!cardState) {
    logger.warn({
      event: 'review.missing_card_state',
      cardStateId,
      userId,
      rating,
    }, 'Review failed because card state was not found');
    throw new Error('Card state not found');
  }

  const previousState = parseState(cardState.state);
  const cardForReview: CardForReview = {
    stability: cardState.stability,
    difficulty: cardState.difficulty,
    learningSteps: cardState.learningSteps,
    elapsedDays: cardState.elapsedDays,
    scheduledDays: cardState.scheduledDays,
    reps: cardState.reps,
    lapses: cardState.lapses,
    state: previousState,
    lastReview: cardState.lastReview,
  };

  const result = scheduleReview(cardForReview, rating);
  const card = await db.query.cards.findFirst({ where: eq(schema.cards.id, cardState.cardId), columns: { deckId: true } });
  const previousStateSnapshot = JSON.stringify({
    stability: cardState.stability,
    difficulty: cardState.difficulty,
    elapsedDays: cardState.elapsedDays,
    scheduledDays: cardState.scheduledDays,
    reps: cardState.reps,
    lapses: cardState.lapses,
    state: previousState,
    lastReview: cardState.lastReview ? cardState.lastReview.getTime() : null,
    nextReview: cardState.nextReview.getTime(),
  });

  let reviewLogId = 0;
  let storedTimeMs = timeSpentMs;

  try {
    // better-sqlite3 transactions are synchronous — the callback must not be
    // async (a returned promise would escape the transaction boundary).
    db.transaction((tx) => {
      // Read here, not before: two ratings sent at once each see the other's log, so the
      // time since the last one can be claimed once, never by both.
      storedTimeMs = storedTimeSpent(tx, userId, card?.deckId ?? null, timeSpentMs, new Date());

      // Sync drizzle builders are LAZY — without .run() this update silently
      // never executes (caught by review before it could eat review data).
      tx.update(schema.cardStates)
        .set({
          stability: result.stability,
          difficulty: result.difficulty,
          elapsedDays: result.elapsedDays,
          scheduledDays: result.scheduledDays,
          reps: result.reps,
          lapses: result.lapses,
          learningSteps: result.learningSteps,
          state: result.state,
          lastReview: result.lastReview,
          nextReview: result.nextReview,
        })
        .where(and(
          eq(schema.cardStates.id, cardStateId),
          eq(schema.cardStates.userId, userId)
        ))
        .run();

      const inserted = tx.insert(schema.reviewLogs).values({
        cardId: cardState.cardId,
        userId,
        rating,
        timeSpentMs: storedTimeMs,
        previousState,
        newState: result.state,
        cardStateId,
        previousStateSnapshot,
      }).returning({ id: schema.reviewLogs.id }).all();

      reviewLogId = inserted[0]?.id ?? 0;
    });
  } catch (err) {
    logger.error({
      event: 'review.transaction_failed',
      err,
      cardStateId,
      cardId: cardState.cardId,
      userId,
      rating,
    }, 'Review transaction failed');
    throw err;
  }

  if (!reviewLogId) {
    logger.error({
      event: 'review.log_insert_failed',
      cardStateId,
      cardId: cardState.cardId,
      userId,
      rating,
    }, 'Review completed without creating a review log');
    throw new Error('Failed to create review log');
  }

  logger.info({
    event: 'review.success',
    cardStateId,
    cardId: cardState.cardId,
    userId,
    reviewLogId,
    rating,
    timeSpentMs,
    storedTimeMs,
    previousState,
    newState: result.state,
    previousLapses: cardState.lapses,
    newLapses: result.lapses,
    previousStability: cardState.stability,
    newStability: result.stability,
    nextReviewAt: result.nextReview.toISOString(),
  }, 'Review completed');

  return { result, reviewLogId };
}

export function getReviewOptions(cardState: CardForReview): NextReviewOptions {
  return getNextReviewOptions(cardState);
}

type CardStateSnapshot = {
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: number | null;
  nextReview: number;
};

function parseSnapshot(raw: string | null): CardStateSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CardStateSnapshot;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return {
      stability: Number(parsed.stability),
      difficulty: Number(parsed.difficulty),
      elapsedDays: Number(parsed.elapsedDays),
      scheduledDays: Number(parsed.scheduledDays),
      reps: Number(parsed.reps),
      lapses: Number(parsed.lapses),
      state: parseState(parsed.state),
      lastReview: parsed.lastReview === null ? null : Number(parsed.lastReview),
      nextReview: Number(parsed.nextReview),
    };
  } catch {
    return null;
  }
}

export async function undoReview(reviewLogId: number, userId: number): Promise<CardForReview & { id: number }> {
  const reviewLog = await db.query.reviewLogs.findFirst({
    where: and(
      eq(schema.reviewLogs.id, reviewLogId),
      eq(schema.reviewLogs.userId, userId)
    ),
  });

  if (!reviewLog) {
    throw new Error('Review log not found');
  }

  if (!reviewLog.cardStateId) {
    throw new Error('Review log is missing card state');
  }

  const snapshot = parseSnapshot(reviewLog.previousStateSnapshot);
  if (!snapshot) {
    throw new Error('Review log is missing snapshot');
  }

  const latestLog = await db
    .select({ id: schema.reviewLogs.id })
    .from(schema.reviewLogs)
    .where(and(
      eq(schema.reviewLogs.userId, userId),
      eq(schema.reviewLogs.cardStateId, reviewLog.cardStateId)
    ))
    .orderBy(desc(schema.reviewLogs.reviewedAt), desc(schema.reviewLogs.id))
    .limit(1);

  if (!latestLog[0] || latestLog[0].id !== reviewLog.id) {
    throw new Error('Review log is not latest');
  }

  db.transaction((tx) => {
    tx.update(schema.cardStates)
      .set({
        stability: snapshot.stability,
        difficulty: snapshot.difficulty,
        elapsedDays: snapshot.elapsedDays,
        scheduledDays: snapshot.scheduledDays,
        reps: snapshot.reps,
        lapses: snapshot.lapses,
        state: snapshot.state,
        lastReview: snapshot.lastReview === null ? null : new Date(snapshot.lastReview),
        nextReview: new Date(snapshot.nextReview),
      })
      .where(and(
        eq(schema.cardStates.id, reviewLog.cardStateId as number),
        eq(schema.cardStates.userId, userId)
      ))
      .run();

    tx.delete(schema.reviewLogs)
      .where(eq(schema.reviewLogs.id, reviewLog.id))
      .run();
  });

  const updated = await db.query.cardStates.findFirst({
    where: and(
      eq(schema.cardStates.id, reviewLog.cardStateId as number),
      eq(schema.cardStates.userId, userId)
    ),
  });

  if (!updated) {
    throw new Error('Card state not found after undo');
  }

  return toCardState(updated);
}

/**
 * A deck's due count, or a mini-deck's (`cardIds`, its selection of the
 * deck): exactly what Study would open with now (dueToday.dueTodayByDeck).
 * A mini-deck's limits are counted within its selection.
 */
export async function getDueCount(
  userId: number,
  deckId: number,
  cardIds?: number[],
  timezoneOffsetMinutes?: number,
) {
  return dueTodayByDeck(userId, [deckId], timezoneOffsetMinutes, new Date(), cardIds).get(deckId)?.total ?? 0;
}

export async function getUserStats(userId: number, timezoneOffsetMinutes?: number) {
  // Cards the student has started: a New row set up when a deck was opened is not one yet.
  const totalCards = await db.select({ count: sql<number>`count(*)` })
    .from(schema.cardStates)
    .where(and(eq(schema.cardStates.userId, userId), ne(schema.cardStates.state, State.New)));

  // Cards due: what Study would open with now in each of the user's decks, added up.
  let totalDue = 0;
  for (const day of dueTodayByDeck(userId, await getUserDeckIds(userId), timezoneOffsetMinutes).values()) {
    totalDue += day.total;
  }

  const today = startOfDayForOffset(timezoneOffsetMinutes);

  const [cardsLearned, totalReviews, correctReviews, totalTime, reviewsToday] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(schema.cardStates)
      .where(and(
        eq(schema.cardStates.userId, userId),
        sql`${schema.cardStates.state} >= 2`
      )),

    db.select({ count: sql<number>`count(*)` })
      .from(schema.reviewLogs)
      .where(eq(schema.reviewLogs.userId, userId)),

    db.select({ count: sql<number>`count(*)` })
      .from(schema.reviewLogs)
      .where(and(
        eq(schema.reviewLogs.userId, userId),
        sql`${schema.reviewLogs.rating} >= 3`
      )),

    // Each rating counted up to RATING_TIME_CAP_MS: older rows could claim any time.
    db.select({ sum: sql<number>`coalesce(sum(min(max(${schema.reviewLogs.timeSpentMs}, 0), ${RATING_TIME_CAP_MS})), 0)` })
      .from(schema.reviewLogs)
      .where(eq(schema.reviewLogs.userId, userId)),

    db.select({ count: sql<number>`count(*)` })
      .from(schema.reviewLogs)
      .where(and(
        eq(schema.reviewLogs.userId, userId),
        gte(schema.reviewLogs.reviewedAt, today)
      )),
  ]);

  const retentionRate = totalReviews[0].count > 0
    ? correctReviews[0].count / totalReviews[0].count
    : 0;

  return {
    totalCards: totalCards[0].count,
    cardsDue: totalDue,
    cardsLearned: cardsLearned[0].count,
    retentionRate,
    totalTimeSpentMs: totalTime[0].sum,
    reviewsToday: reviewsToday[0].count,
    streakDays: 0,
  };
}
