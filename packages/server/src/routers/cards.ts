// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module cardsRouter
 *
 * tRPC procedures for the authenticated user's review session: fetch decks and
 * due cards, submit reviews, undo, retrieve stats, and export history.
 *
 * Module invariants
 * -----------------
 * • All procedures are `protectedProcedure`.  ctx.user.id is a verified,
 *   authenticated user ID supplied by the Passport session — never trust raw
 *   input as a user identity substitute.
 * • Deck-scoped procedures call assertDeckAccess(userId, deckId) BEFORE the first
 *   data query.  A failed access check throws FORBIDDEN with no data leaked.
 * • Ownership of card state is enforced inside the fsrs.ts service layer (userId
 *   appears in every UPDATE/SELECT WHERE clause) — this router trusts that layer.
 * • exportMyHistory is bounded by EXPORT_HISTORY_MAX_ROWS = 100,000.  Exceeding
 *   this limit throws PAYLOAD_TOO_LARGE before any data is returned to the client.
 *
 * Procedure ledger
 * ----------------
 * getMyDecks
 *   Read-only.  Cards and learned counts, and each deck's due count from
 *   dueToday.dueTodayByDeck: exactly what Study would open with now, plus the
 *   reviews waiting past today's limit.
 *   Early-return: [] if getUserDeckIds returns no IDs (no further DB access).
 *
 * studyAll
 *   Read-only.  "Study all" (v1.18.0): the decks of the user's groups with cards
 *   due today (dueToday.dueTodayByDeck on the page's clock), newest deck first.
 *   The page studies each as its own session: getDueCards, review and
 *   logStudyCompletion per deck, unchanged.
 *
 * getDueCards
 *   assertDeckAccess precedes all reads.
 *   Two sequential today-count queries (not batched — both are fast indexed reads).
 *   Delegates heavy lifting to fsrs.getDueCards.
 *
 * review
 *   Delegates to fsrs.reviewCard.  Maps Error strings to TRPCError codes.
 *   Transaction safety: fsrs.reviewCard uses a DB transaction; partial state
 *   is never persisted even if this procedure throws.
 *   A review that empties the deck's day (a card into review, none in
 *   learning, nothing left on the school's clock) records the "All Done!"
 *   itself (finishDeckDay), so the teacher sees the finish whatever becomes of
 *   the page's own report, and checks whether that finished ALL the student's
 *   decks for the day (recorded in flashcard_all_done).  That check never fails
 *   the review.  An extension may add fields to the response (the review hook).
 *
 * undoReview
 *   Delegates to fsrs.undoReview.  Maps Error strings to TRPCError codes.
 *   CONFLICT is returned when the review log is not the latest for the card.
 *
 * logStudyCompletion
 *   The "All Done!" (sloth) log.  The server counts the session's cards from
 *   review_logs and ignores the page's numbers.  A deck's session_complete is
 *   stored only when dueToday.cardsLeftToday finds nothing under the page's
 *   own selection, nor on the school's clock ({ logged: false, reason:
 *   'cards-due' } otherwise), and something in the deck was rated today on
 *   the school's clock ('nothing-rated' otherwise).  The session's cards are
 *   counted from the later of the two midnights: a forged offset cannot pass
 *   yesterday's work off as today's.  A
 *   virtual deck must be the caller's (NOT_FOUND) and counts only its selected
 *   cards; one with none of its cards rated today is 'nothing-rated'.
 *   session_complete repeats only when nothing was rated since the
 *   last one; nothing_due repeats within 5 minutes per deck or virtual deck.
 *   Every finish asks whether ALL the student's decks are done for the day
 *   (allFlashcards.recordAllFlashcardsDay, recorded once a day) and says
 *   which decks still have cards (decksLeft, school's clock, newest first).
 *   An extension may add fields to the finish report (the studyFinish hook).
 *
 * getStats
 *   Read-only.  Delegates to fsrs.getUserStats.
 *
 * getDeckProgress
 *   assertDeckAccess precedes all reads.
 *   Batches 6 queries with Promise.all.  Reviewed cards are those started
 *   (not a New row set up when the deck was opened); time counts each rating
 *   up to RATING_TIME_CAP_MS.
 *
 * exportMyHistory
 *   No per-deck access check; userId in WHERE scopes data to the caller.
 *   Bounded by EXPORT_HISTORY_MAX_ROWS to prevent unbounded response sizes.
 *   CSV escaping strips HTML tags and double-quotes control characters.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { eq, and, sql, inArray, gte, isNull, desc, ne } from 'drizzle-orm';
import { getDueCards, reviewCard, undoReview, getReviewOptions, getUserStats } from '../services/fsrs.js';
import type { ReviewRating } from '@libresrs/shared';
import { CardDirection, State } from '@libresrs/shared';
import { startOfDayForOffset } from '../utils/time.js';
import { assertDeckAccess, getUserDeckIds, hasDeckAccess } from '../services/deckAccess.js';
import { schoolOffsetMinutes } from '../services/schoolCalendar.js';
import { decksToday, recordAllFlashcardsDay, type DeckToday } from '../services/allFlashcards.js';
import {
  cardsLeftToday, countRatings, dueTodayByDeck, inLearning, sessionCounts, studyDay, type RatingScope,
} from '../services/dueToday.js';
import { RATING_TIME_CAP_MS } from '../services/flashcardDay.js';
import { getVirtualDeck, getVirtualDeckCardIds } from '../services/virtualDecks.js';
import { logger } from '../logger.js';
import { fieldsBeside, type FieldsBeside } from '../extensions/api.js';
import { ext, type ExtensionFields } from '../extensions/registry.js';

/** A nothing_due within this long of the last one, for the same deck, is a reload of the same screen. */
const NOTHING_DUE_DEDUPE_MS = 5 * 60 * 1000;

/** What logStudyCompletion answers (core's fields; an extension may add its own: StudyCompletionResult). */
export interface CoreStudyCompletionResult {
  /** A row was stored. */
  logged: boolean;
  /** Not stored: the same "All Done!" was already logged. */
  deduped: boolean;
  /**
   * Not stored: cards are still due today (under the page's selection, or on the school's clock),
   * or nothing in the deck was rated today, so there was no session to finish.
   */
  reason?: 'cards-due' | 'nothing-rated';
  /**
   * The decks of the student's groups with cards still due today on the school's clock, newest
   * first ("Study all" order): the "All Done!" screen can send the student on to them.
   */
  decksLeft: DeckLeft[];
  /**
   * The decks of the student's groups with nothing due now but a card waiting on a learning step
   * later today, newest first: the day is not done until it comes back and is answered, so the
   * "All Done!" screen says when.
   */
  decksWaiting: DeckWaiting[];
}

/**
 * What logStudyCompletion answers: core's fields, plus the fields of the studyFinish hook
 * (optional: a build without extensions has none). JSON keeps them where they were: after
 * `reason`, before `decksLeft`.
 */
export type StudyCompletionResult = CoreStudyCompletionResult & FieldsBeside<CoreStudyCompletionResult, ExtensionFields['studyFinish']>;

/** A deck whose only cards left today wait on a learning step (StudyCompletionResult.decksWaiting). */
export interface DeckWaiting {
  deckId: number;
  deckName: string;
  /** Cards waiting on a learning step later today. */
  count: number;
  /** How long until the first of them comes back (ms), or null. */
  backInMs: number | null;
}

/** A deck with cards still due today (StudyCompletionResult.decksLeft). */
export interface DeckLeft {
  deckId: number;
  deckName: string;
  /** What its deck card shows: learning, reviews and new cards Study would open with now. */
  total: number;
}

/** What a "Study all" deck holds today (cards.studyAll). */
export interface StudyAllDeck {
  deckId: number;
  deckName: string;
  learning: number;
  reviews: number;
  newCards: number;
  total: number;
}

/** The decks with cards due, newest first; nothing for a deck with none. */
const decksWithCardsDue = (decks: readonly DeckToday[]): DeckLeft[] => decks
  .filter((d) => d.due.total > 0)
  .map((d) => ({ deckId: d.id, deckName: d.name, total: d.due.total }));

/** The decks with nothing due now whose cards wait on a learning step later today, newest first. */
const decksWaitingOnLearning = (decks: readonly DeckToday[], now: Date): DeckWaiting[] => decks
  .filter((d) => d.due.total === 0 && d.due.learningLater > 0)
  .map((d) => ({
    deckId: d.id,
    deckName: d.name,
    count: d.due.learningLater,
    backInMs: d.due.nextLearningAt === null ? null : Math.max(0, d.due.nextLearningAt - now.getTime()),
  }));

/** What is left today in the student's decks, for a finish report (nothing when that could not be read). */
const leftToday = (decks: readonly DeckToday[] | null, now: Date) => ({
  decksLeft: decks ? decksWithCardsDue(decks) : [],
  decksWaiting: decks ? decksWaitingOnLearning(decks, now) : [],
});

/**
 * Every deck of the student's groups with what it holds today on the school's
 * clock (for the all-flashcards day and decksLeft), or null when that could
 * not be read: a finish report never fails on it.
 */
function schoolDecksToday(userId: number, now: Date): DeckToday[] | null {
  try {
    return decksToday(userId, schoolOffsetMinutes(now), now);
  } catch (err) {
    logger.error({ err, event: 'cards.decks_today_failed', userId }, 'Reading the day of every deck failed');
    return null;
  }
}

/** What was finished: a deck, or a virtual deck (the student's own selection of a deck's cards). */
interface FinishTarget {
  scope: RatingScope;
  virtualDeckId: number | null;
}

/**
 * Store a session's "All Done!" when the server's own records bear it out
 * (see logStudyCompletion), and say which decks still have cards, with any
 * fields an extension adds to the finish (the studyFinish hook).
 * `pageOffsetMinutes` is the page's clock; the day is read on the school's
 * clock too.
 */
async function finishSession(
  user: { id: number; role: string },
  target: FinishTarget,
  pageOffsetMinutes: number | undefined,
  now: Date,
): Promise<StudyCompletionResult> {
  const userId = user.id;
  const { scope, virtualDeckId } = target;
  // This deck's earlier rows: the deck's own, or this one virtual deck's.
  const sameDeck = virtualDeckId !== null
    ? eq(schema.studyCompletions.virtualDeckId, virtualDeckId)
    : and(eq(schema.studyCompletions.deckId, scope.deckId), isNull(schema.studyCompletions.virtualDeckId));

  // Whether every deck of the student's is done for today, recorded once a day (never fails the
  // log); the deck's own row below is the teacher's grid. Any finish asks, a mini-deck's too:
  // whichever emptied the last deck's day, extensions hear of it (the studyFinish hook, outside
  // any transaction), and the student hears which decks still have cards.
  const schoolDecks = schoolDecksToday(userId, now);
  const allDone = recordAllFlashcardsDay(user, now, schoolDecks ?? undefined);
  const fields: ExtensionFields['studyFinish'] = await ext().run('studyFinish', { user, now, allDone });
  const left = leftToday(schoolDecks, now);

  // "Today" is the page's, but a page can send any offset: one that starts today back in
  // yesterday would let yesterday's work stand for today's. So the day is also read on the
  // school's clock, and only work that is today on both counts.
  const schoolOffset = schoolOffsetMinutes(now);
  const pageTodayStart = startOfDayForOffset(pageOffsetMinutes, now);
  const schoolTodayStart = startOfDayForOffset(schoolOffset, now);
  const todayStart = pageTodayStart > schoolTodayStart ? pageTodayStart : schoolTodayStart;

  if (virtualDeckId === null) {
    // A deck's cards must really be done: nothing left today under the page's own selection,
    // nor under the school's day (the same for every school device).
    const samePageAndSchool = pageTodayStart.getTime() === schoolTodayStart.getTime();
    if (await cardsLeftToday(userId, scope.deckId, pageOffsetMinutes, now)
      || (!samePageAndSchool && await cardsLeftToday(userId, scope.deckId, schoolOffset, now))) {
      return { logged: false, deduped: false, reason: 'cards-due', ...fields, ...left };
    }
  }

  // From here on nothing awaits (better-sqlite3 is synchronous), so two copies of one request
  // cannot both pass the repeat check and both be stored.
  // The same "All Done!" again (a retry, a second tab, the page's report of a finish the
  // server recorded at the last review): nothing rated since the last one.
  const last = db.select({ completedAt: schema.studyCompletions.completedAt })
    .from(schema.studyCompletions)
    .where(and(
      eq(schema.studyCompletions.userId, userId),
      sameDeck,
      eq(schema.studyCompletions.reason, 'session_complete'),
    ))
    .orderBy(desc(schema.studyCompletions.completedAt), desc(schema.studyCompletions.id))
    .limit(1)
    .get();
  if (last && countRatings(userId, scope, { since: last.completedAt, after: true }) === 0) {
    return { logged: false, deduped: true, ...fields, ...left };
  }
  // A session means cards rated in it today (on the school's clock, as the all-flashcards day asks):
  // for a virtual deck, its own cards.
  if (countRatings(userId, scope, { since: schoolTodayStart }) === 0) {
    return { logged: false, deduped: false, reason: 'nothing-rated', ...fields, ...left };
  }

  // The session's cards: after this deck's last "All Done!" today, else since the start of today.
  const counts = last && last.completedAt.getTime() >= todayStart.getTime()
    ? sessionCounts(userId, scope, last.completedAt, { after: true })
    : sessionCounts(userId, scope, todayStart);
  db.insert(schema.studyCompletions).values({
    userId,
    // A virtual deck's row names only the virtual deck: it is not the deck's daily work.
    deckId: virtualDeckId !== null ? null : scope.deckId,
    virtualDeckId,
    reason: 'session_complete',
    ...counts,
  }).run();
  return { logged: true, deduped: false, ...fields, ...left };
}

/**
 * The "All Done!" a review recorded by emptying the deck's day: the card went
 * into review, no card of the deck is left in learning, and nothing is left
 * today on the school's clock. Any study counts, a mini-deck's too: the same
 * cards under the same limits. Read-only checks first, and never an error:
 * a finish must not cost the review.
 */
async function finishDeckDayAtReview(user: { id: number; role: string }, reviewLogId: number, newState: State, now: Date): Promise<void> {
  if (newState !== State.Review) return;
  try {
    const card = db.select({ deckId: schema.cards.deckId })
      .from(schema.reviewLogs)
      .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
      .where(and(eq(schema.reviewLogs.id, reviewLogId), eq(schema.reviewLogs.userId, user.id)))
      .get();
    if (!card || inLearning(user.id, card.deckId) > 0) return;
    const schoolOffset = schoolOffsetMinutes(now);
    if ((dueTodayByDeck(user.id, [card.deckId], schoolOffset, now).get(card.deckId)?.total ?? 1) > 0) return;
    if (!await hasDeckAccess(user.id, card.deckId)) return;
    await finishDeckDay(user, card.deckId, schoolOffset, now);
  } catch (err) {
    logger.error({ err, event: 'cards.finish_at_review_failed', userId: user.id, reviewLogId }, 'Recording "All Done!" at a review failed');
  }
}

/** A deck's day finished: stored as session_complete when the records bear it out (finishSession). */
function finishDeckDay(user: { id: number; role: string }, deckId: number, pageOffsetMinutes: number | undefined, now = new Date()) {
  return finishSession(user, { scope: { deckId }, virtualDeckId: null }, pageOffsetMinutes, now);
}

export const cardsRouter = router({
  getMyDecks: protectedProcedure
    .input(z.object({
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const deckIds = await getUserDeckIds(ctx.user.id);

      if (deckIds.length === 0) {
        return [];
      }

      const decks = await db.query.decks.findMany({
        where: inArray(schema.decks.id, deckIds),
      });
      if (decks.length === 0) {
        return [];
      }

      const [cardCounts, learnedCounts] = await Promise.all([
        db
          .select({
            deckId: schema.cards.deckId,
            count: sql<number>`count(*)`,
          })
          .from(schema.cards)
          .where(inArray(schema.cards.deckId, deckIds))
          .groupBy(schema.cards.deckId),

        db
          .select({
            deckId: schema.cards.deckId,
            count: sql<number>`sum(case when ${schema.cardStates.state} >= 2 and (${schema.decks.reversible} = 0 or ${schema.cardStates.direction} = ${CardDirection.Forward}) then 1 else 0 end)`,
          })
          .from(schema.cardStates)
          .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
          .innerJoin(schema.decks, eq(schema.cards.deckId, schema.decks.id))
          .where(and(
            eq(schema.cardStates.userId, ctx.user.id),
            inArray(schema.cards.deckId, deckIds),
          ))
          .groupBy(schema.cards.deckId),
      ]);
      // Due: exactly what Study would open each deck with now (never a New row counted twice).
      const due = dueTodayByDeck(ctx.user.id, deckIds, input?.timezoneOffsetMinutes);

      const cardCountMap = new Map(cardCounts.map((row) => [row.deckId, row.count]));
      const learnedCountMap = new Map(learnedCounts.map((row) => [row.deckId, row.count ?? 0]));

      return decks.map((deck) => {
        const day = due.get(deck.id);
        return {
          ...deck,
          cardCount: cardCountMap.get(deck.id) ?? 0,
          learnedCount: learnedCountMap.get(deck.id) ?? 0,
          dueCount: day?.total ?? 0,
          /** Reviews due now past today's review limit: "+N more waiting after today's limit". */
          reviewsBeyondLimit: day?.reviewsBeyondLimit ?? 0,
        };
      });
    }),

  /**
   * Flashcard "Study all" (v1.18.0): every deck of the student's groups with
   * cards due today, newest deck first (by creation, then id: the newest unit
   * leads), each with what its deck card shows (dueToday.dueTodayByDeck on
   * the page's clock). The page studies each in turn as its own session
   * (getDueCards, review, logStudyCompletion per deck). `learningLater` and
   * `learningBackInMs`: cards waiting on a learning step later, in any deck
   * (the day is not done while one waits). Mini-decks are not decks here.
   */
  studyAll: protectedProcedure
    .input(z.object({
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }).optional())
    .query(({ ctx, input }) => {
      const now = new Date();
      const decks = decksToday(ctx.user.id, input?.timezoneOffsetMinutes, now);
      const due: StudyAllDeck[] = decks.filter((d) => d.due.total > 0).map((d) => ({
        deckId: d.id,
        deckName: d.name,
        learning: d.due.learning,
        reviews: d.due.reviews,
        newCards: d.due.newCards,
        total: d.due.total,
      }));
      const later = decks.map((d) => d.due.nextLearningAt).filter((at): at is number => at !== null);
      return {
        decks: due,
        totalDue: due.reduce((sum, d) => sum + d.total, 0),
        learningLater: decks.reduce((sum, d) => sum + d.due.learningLater, 0),
        learningBackInMs: later.length > 0 ? Math.max(0, Math.min(...later) - now.getTime()) : null,
      };
    }),

  getDueCards: protectedProcedure
    .input(z.object({
      deckId: z.number(),
      limit: z.number().min(1).max(500).optional(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);

      // Per-deck limits (falling back to global) and what today already used of them.
      const day = await studyDay(ctx.user.id, input.deckId, input.timezoneOffsetMinutes);
      const remainingNewCards = day.remainingNew;
      const remainingReviews = day.remainingReviews;

      // Session limit is just the requested batch size (default to max allowed or reasonable chunk)
      // We don't clamp by totalRemaining because Learning cards are unlimited and not tracked in remaining* variables
      const sessionLimit = input.limit ?? 500;

      const cards = await getDueCards(ctx.user.id, input.deckId, {
        limit: sessionLimit,
        newLimit: remainingNewCards,
        reviewLimit: remainingReviews,
      });

      const cardsWithOptions = cards.map(({ card, state, direction }) => ({
        card,
        state: {
          id: state.id,
          stability: state.stability,
          difficulty: state.difficulty,
          reps: state.reps,
          lapses: state.lapses,
          state: state.state,
        },
        direction,
        nextReviewOptions: getReviewOptions(state),
      }));

      // Count new vs review cards in the current batch (State.New = 0)
      const newCardsInBatch = cardsWithOptions.filter(c => Number(c.state.state) === 0).length;
      const reviewCardsInBatch = cardsWithOptions.length - newCardsInBatch;

      // Nothing to study now: cards still in learning come back later ("3 cards come back in about 10 min").
      const now = new Date();
      const later = cards.length === 0 ? dueTodayByDeck(ctx.user.id, [input.deckId], input.timezoneOffsetMinutes, now).get(input.deckId) : undefined;

      return {
        cards: cardsWithOptions,
        counts: {
          remainingNewCardsToday: remainingNewCards,
          remainingReviewsToday: remainingReviews,
          newCardsInBatch,
          reviewCardsInBatch,
          newCardsLimit: day.newCardsPerDay,
          reviewsLimit: day.reviewsPerDay,
          /** Cards in learning whose next step is later (only when nothing is due now). */
          learningLater: later?.learningLater ?? 0,
          /** How long until the first of them comes back (ms), or null. */
          learningBackInMs: later?.nextLearningAt != null ? Math.max(0, later.nextLearningAt - now.getTime()) : null,
        },
      };
    }),

  /**
   * Record that a student reached the "All Done!" screen (the sloth).
   *
   * `reason` separates real work from an empty deck: finishing a session is
   * study, arriving to find nothing due is not, and grading needs to tell them
   * apart. The page only says that a session ended; the server decides the
   * rest from its own records:
   *
   * - a deck's session_complete is stored only when nothing is left today
   *   under the selection the page studies, otherwise
   *   `{ logged: false, reason: 'cards-due' }`;
   * - the session's cards are counted from the review log (since the start of
   *   today, or since this deck's last "All Done!" today), never from the page;
   * - a virtual deck must be the student's own, and only its selected cards
   *   count (nothing need be left in it: a custom selection is not the deck's
   *   daily work), but one of them must have been rated today ('nothing-rated');
   * - a session_complete repeats (and is not stored again) only when nothing
   *   was rated since the last one, so a real second sloth is always logged;
   *   nothing_due repeats within 5 minutes, per deck or virtual deck.
   *
   * Finishing ALL flashcards for the day is decided separately with its own
   * checks on the school's clock (services/allFlashcards.ts): any finish that
   * leaves nothing due in any deck records it, a mini-deck's too, and an
   * extension may add fields to the report (the studyFinish hook). The server
   * also records a deck's finish itself at the review that empties the day, so
   * this report is often the same finish again: deduped, with the same
   * extension fields. `decksLeft` names
   * the decks still holding cards today, newest first; `decksWaiting` those
   * whose only cards left wait on a learning step (back later today).
   * A page sends a lost report again for a few minutes (client utils/finishRetry.ts).
   */
  logStudyCompletion: protectedProcedure
    .input(z.object({
      deckId: z.number().int().optional(),
      virtualDeckId: z.number().int().optional(),
      reason: z.enum(['session_complete', 'nothing_due']),
      // Sent by pages from before v1.14 and ignored: the server counts the session itself.
      newCardsDone: z.number().int().min(0).max(100000).optional(),
      reviewsDone: z.number().int().min(0).max(100000).optional(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }).refine((i) => (i.deckId === undefined) !== (i.virtualDeckId === undefined), {
      message: 'Send either a deckId or a virtualDeckId.',
    }))
    .mutation(async ({ ctx, input }): Promise<StudyCompletionResult> => {
      const userId = ctx.user.id;
      const virtualDeckId = input.virtualDeckId ?? null;

      // What was finished: a deck, or a virtual deck (the student's own selection of a deck's cards).
      let scope: RatingScope;
      if (virtualDeckId !== null) {
        const virtualDeck = await getVirtualDeck(virtualDeckId, userId);
        if (!virtualDeck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found', cause: { appCode: 'VIRTUAL_DECK_NOT_FOUND' } });
        }
        await assertDeckAccess(userId, virtualDeck.sourceDeckId);
        scope = { deckId: virtualDeck.sourceDeckId, cardIds: await getVirtualDeckCardIds(virtualDeckId, userId) };
      } else {
        scope = { deckId: input.deckId as number };
        await assertDeckAccess(userId, scope.deckId);
      }

      if (input.reason === 'session_complete') {
        return finishSession(ctx.user, { scope, virtualDeckId }, input.timezoneOffsetMinutes, new Date());
      }

      // An empty deck: stored, unless the same screen was reloaded within minutes.
      const sameDeck = virtualDeckId !== null
        ? eq(schema.studyCompletions.virtualDeckId, virtualDeckId)
        : and(eq(schema.studyCompletions.deckId, scope.deckId), isNull(schema.studyCompletions.virtualDeckId));
      const recent = db.select({ id: schema.studyCompletions.id })
        .from(schema.studyCompletions)
        .where(and(
          eq(schema.studyCompletions.userId, userId),
          sameDeck,
          eq(schema.studyCompletions.reason, 'nothing_due'),
          gte(schema.studyCompletions.completedAt, new Date(Date.now() - NOTHING_DUE_DEDUPE_MS)),
        ))
        .get();
      const now = new Date();
      const left = leftToday(schoolDecksToday(userId, now), now);
      if (recent) return { logged: false, deduped: true, ...ext().defaults.studyFinish, ...left };
      db.insert(schema.studyCompletions).values({
        userId,
        deckId: virtualDeckId !== null ? null : scope.deckId,
        virtualDeckId,
        reason: 'nothing_due',
        newCardsDone: 0,
        reviewsDone: 0,
      }).run();
      return { logged: true, deduped: false, ...ext().defaults.studyFinish, ...left };
    }),

  review: protectedProcedure
    .input(z.object({
      cardStateId: z.number().int(),
      rating: z.number().int().min(1).max(4),
      // Clamped, never refused: a card left open for hours (a closed Chromebook lid) must still
      // take its rating, and a clock stepped back sends a negative time. The server stores no more
      // than the time since the last rating, and at most RATING_TIME_CAP_MS, anyway (reviewCard).
      timeSpentMs: z.number().int().transform((ms) => Math.min(Math.max(ms, 0), 3_600_000)),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const reviewResult = await reviewCard(
          input.cardStateId,
          ctx.user.id,
          input.rating as ReviewRating,
          input.timeSpentMs
        );
        const { result, reviewLogId } = reviewResult;
        // The last card of the day: the server records the "All Done!" itself (never fails the review).
        await finishDeckDayAtReview(ctx.user, reviewLogId, result.state, new Date());
        // What extensions add to the review (never fails it: a hook that throws leaves its defaults).
        const reviewFields: ExtensionFields['review'] = await ext().run('review', { user: ctx.user, reviewLogId, now: new Date() });

        const after = {
          nextReview: result.nextReview,
          newState: result.state,
          state: {
            id: input.cardStateId,
            stability: result.stability,
            difficulty: result.difficulty,
            reps: result.reps,
            lapses: result.lapses,
            state: result.state,
          },
          nextReviewOptions: getReviewOptions(result),
        };
        // The extensions' fields right after reviewLogId, as before; none may take a core field's name.
        return { reviewLogId, ...fieldsBeside({ reviewLogId, ...after }, reviewFields, 'cards.review'), ...after };
      } catch (error) {
        if (error instanceof Error && error.message === 'Card state not found') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
            cause: { appCode: 'CARD_STATE_NOT_FOUND' },
          });
        }
        throw error;
      }
    }),

  undoReview: protectedProcedure
    .input(z.object({
      reviewLogId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const state = await undoReview(input.reviewLogId, ctx.user.id);
        return {
          state: {
            id: state.id,
            stability: state.stability,
            difficulty: state.difficulty,
            reps: state.reps,
            lapses: state.lapses,
            state: state.state,
          },
          nextReviewOptions: getReviewOptions(state),
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Review log not found') {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: error.message,
              cause: { appCode: 'REVIEW_LOG_NOT_FOUND' },
            });
          }
          if (error.message === 'Review log is not latest') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: error.message,
              cause: { appCode: 'REVIEW_LOG_NOT_LATEST' },
            });
          }
          if (error.message === 'Review log is missing snapshot' || error.message === 'Review log is missing card state') {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: error.message,
              cause: { appCode: 'REVIEW_LOG_MISSING_SNAPSHOT' },
            });
          }
          if (error.message === 'Card state not found after undo') {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: error.message,
              cause: { appCode: 'CARD_STATE_NOT_FOUND' },
            });
          }
        }
        throw error;
      }
    }),

  getStats: protectedProcedure
    .input(z.object({
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      return getUserStats(ctx.user.id, input?.timezoneOffsetMinutes);
    }),

  getDeckProgress: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);

      const deck = await db.query.decks.findFirst({
        where: eq(schema.decks.id, input.deckId),
      });
      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
          cause: { appCode: 'DECK_NOT_FOUND' },
        });
      }

      const progressStateFilters = [
        eq(schema.cardStates.userId, ctx.user.id),
        eq(schema.cards.deckId, input.deckId),
      ];
      if (deck.reversible) {
        progressStateFilters.push(eq(schema.cardStates.direction, CardDirection.Forward));
      }

      const [totalCards, reviewed, learned, totalReviews, totalTime, correctReviews] = await Promise.all([
        db.select({ count: sql<number>`count(*)` })
          .from(schema.cards)
          .where(eq(schema.cards.deckId, input.deckId)),

        // Started cards: a New row set up when the deck was opened is not reviewed yet.
        db.select({ count: sql<number>`count(distinct ${schema.cardStates.cardId})` })
          .from(schema.cardStates)
          .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
          .where(and(...progressStateFilters, ne(schema.cardStates.state, State.New))),

        db.select({ count: sql<number>`count(distinct ${schema.cardStates.cardId})` })
          .from(schema.cardStates)
          .innerJoin(schema.cards, eq(schema.cardStates.cardId, schema.cards.id))
          .where(and(
            ...progressStateFilters,
            sql`${schema.cardStates.state} >= 2`
          )),

        db.select({ count: sql<number>`count(*)` })
          .from(schema.reviewLogs)
          .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
          .where(and(
            eq(schema.reviewLogs.userId, ctx.user.id),
            eq(schema.cards.deckId, input.deckId)
          )),

        // Each rating counted up to RATING_TIME_CAP_MS: older rows could claim any time.
        db.select({ sum: sql<number>`coalesce(sum(min(max(${schema.reviewLogs.timeSpentMs}, 0), ${RATING_TIME_CAP_MS})), 0)` })
          .from(schema.reviewLogs)
          .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
          .where(and(
            eq(schema.reviewLogs.userId, ctx.user.id),
            eq(schema.cards.deckId, input.deckId)
          )),

        db.select({ count: sql<number>`count(*)` })
          .from(schema.reviewLogs)
          .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
          .where(and(
            eq(schema.reviewLogs.userId, ctx.user.id),
            eq(schema.cards.deckId, input.deckId),
            sql`${schema.reviewLogs.rating} >= 3`
          )),
      ]);

      const retentionRate = totalReviews[0].count > 0
        ? correctReviews[0].count / totalReviews[0].count
        : 0;

      return {
        totalCards: totalCards[0].count,
        reviewedCards: reviewed[0].count,
        learnedCards: learned[0].count,
        totalReviews: totalReviews[0].count,
        totalTimeMs: totalTime[0].sum,
        retentionRate,
      };
    }),

  exportMyHistory: protectedProcedure
    .query(async ({ ctx }) => {
      const EXPORT_HISTORY_MAX_ROWS = 100_000;
      const RATING_LABELS = ['', 'Again', 'Hard', 'Good', 'Easy'];
      const STATE_LABELS = ['New', 'Learning', 'Review', 'Relearning'];

      const rows = await db
        .select({
          reviewedAt: schema.reviewLogs.reviewedAt,
          rating: schema.reviewLogs.rating,
          previousState: schema.reviewLogs.previousState,
          newState: schema.reviewLogs.newState,
          timeSpentMs: schema.reviewLogs.timeSpentMs,
          front: schema.cards.front,
          back: schema.cards.back,
          deckName: schema.decks.name,
        })
        .from(schema.reviewLogs)
        .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
        .innerJoin(schema.decks, eq(schema.cards.deckId, schema.decks.id))
        .where(eq(schema.reviewLogs.userId, ctx.user.id))
        .orderBy(schema.reviewLogs.reviewedAt)
        .limit(EXPORT_HISTORY_MAX_ROWS + 1);

      if (rows.length > EXPORT_HISTORY_MAX_ROWS) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Export exceeds maximum row limit. Please contact an administrator.',
        });
      }

      const escape = (val: string) => `"${val.replace(/"/g, '""').replace(/<[^>]*>/g, '')}"`;

      const header = 'reviewed_at,deck,front,back,rating,from_state,to_state,time_ms\n';
      const lines = rows.map((r) => [
        escape(r.reviewedAt?.toISOString() ?? ''),
        escape(r.deckName),
        escape(r.front),
        escape(r.back),
        escape(RATING_LABELS[r.rating] ?? String(r.rating)),
        escape(STATE_LABELS[r.previousState] ?? String(r.previousState)),
        escape(STATE_LABELS[r.newState] ?? String(r.newState)),
        String(r.timeSpentMs),
      ].join(','));

      return { csv: header + lines.join('\n') };
    }),
});
