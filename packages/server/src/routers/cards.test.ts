// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const fsrsMocks = {
  getDueCards: vi.fn(),
  reviewCard: vi.fn(),
  undoReview: vi.fn(),
  getReviewOptions: vi.fn(),
  getUserStats: vi.fn(),
};

const user = {
  id: 1,
  googleId: 'user-1',
  email: 'user1@example.com',
  name: 'User One',
  picture: null,
  role: 'user' as const,
};

const otherUser = {
  id: 2,
  googleId: 'user-2',
  email: 'user2@example.com',
  name: 'User Two',
  picture: null,
  role: 'user' as const,
};

async function createCaller(currentUser = user) {
  const { cardsRouter } = await import('./cards.js');
  return cardsRouter.createCaller({
    req: { user: currentUser } as Request,
    res: {} as Response,
    user: currentUser,
  });
}

async function expectTrpcError(
  promise: Promise<unknown>,
  code: TRPCError['code'],
  appCode?: string
) {
  try {
    await promise;
    throw new Error(`Expected ${code} error`);
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    const trpcError = error as TRPCError;
    expect(trpcError.code).toBe(code);
    if (appCode) {
      const cause = trpcError.cause as { appCode?: string } | undefined;
      expect(cause?.appCode).toBe(appCode);
    }
  }
}

describe('cards router', () => {
  beforeEach(async () => {
    vi.resetModules();
    fsrsMocks.getDueCards.mockReset();
    fsrsMocks.reviewCard.mockReset();
    fsrsMocks.undoReview.mockReset();
    fsrsMocks.getReviewOptions.mockReset();
    fsrsMocks.getUserStats.mockReset();
    fsrsMocks.getReviewOptions.mockReturnValue({
      hard: new Date('2030-01-01T00:00:00.000Z'),
      good: new Date('2030-01-02T00:00:00.000Z'),
      easy: new Date('2030-01-03T00:00:00.000Z'),
    });

    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));
    vi.doMock('../services/fsrs.js', () => ({
      State: { New: 0, Learning: 1, Review: 2, Relearning: 3 },
      getDueCards: fsrsMocks.getDueCards,
      reviewCard: fsrsMocks.reviewCard,
      undoReview: fsrsMocks.undoReview,
      getReviewOptions: fsrsMocks.getReviewOptions,
      getUserStats: fsrsMocks.getUserStats,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values([
      {
        id: 1,
        googleId: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
      },
      {
        id: 2,
        googleId: 'user-2',
        email: 'user2@example.com',
        name: 'User Two',
      },
    ]);

    await testDb.insert(schema.groups).values({
      id: 1,
      name: 'Group A',
      description: 'Test group',
    });

    await testDb.insert(schema.userGroups).values({
      userId: 1,
      groupId: 1,
    });

    await testDb.insert(schema.decks).values({
      id: 1,
      name: 'Deck 1',
      createdBy: 1,
      reversible: false,
    });

    await testDb.insert(schema.deckGroups).values({
      deckId: 1,
      groupId: 1,
    });

    await testDb.insert(schema.cards).values([
      { id: 1, deckId: 1, front: 'Front 1', back: 'Back 1' },
      { id: 2, deckId: 1, front: 'Front 2', back: 'Back 2' },
      { id: 3, deckId: 1, front: 'Front 3', back: 'Back 3' },
      { id: 4, deckId: 1, front: 'Front 4', back: 'Back 4' },
      { id: 5, deckId: 1, front: 'Front 5', back: 'Back 5' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no decks when user has no group-based deck access', async () => {
    const caller = await createCaller(otherUser);
    const decks = await caller.getMyDecks();
    expect(decks).toEqual([]);
  });

  it('shows as due exactly what Study would open with: a New row set up by opening the deck is counted once', async () => {
    const now = new Date('2026-02-15T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await testDb.insert(schema.userSettings).values({
      userId: 1,
      newCardsPerDay: 3,
      reviewsPerDay: 20,
      createdAt: now,
      updatedAt: now,
    });

    // Card 1 is a review due now; cards 2 and 3 were new this morning and wait on a learning
    // step (not due yet); cards 4 and 5 are New rows the last visit to Study set up.
    const state = (cardId: number, fields: { state: number; nextReview: Date }) => ({
      cardId, userId: 1, direction: 0, stability: 2.5, difficulty: 5, reps: fields.state === 0 ? 0 : 1, lapses: 0,
      lastReview: fields.state === 0 ? null : new Date(now.getTime() - 60_000), ...fields,
    });
    await testDb.insert(schema.cardStates).values([
      state(1, { state: 2, nextReview: new Date(now.getTime() - 60 * 1000) }),
      state(2, { state: 1, nextReview: new Date(now.getTime() + 9 * 60 * 1000) }),
      state(3, { state: 1, nextReview: new Date(now.getTime() + 9 * 60 * 1000) }),
      state(4, { state: 0, nextReview: new Date(now.getTime() - 5 * 60 * 1000) }),
      state(5, { state: 0, nextReview: new Date(now.getTime() - 5 * 60 * 1000) }),
    ]);

    // The two new cards rated this morning, as the page timed them (an honest pace).
    await testDb.insert(schema.reviewLogs).values([
      {
        cardId: 2,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now.getTime() - 60_000),
        timeSpentMs: 4_000,
        previousState: 0,
        newState: 1,
      },
      {
        cardId: 3,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now.getTime() - 30_000),
        timeSpentMs: 3_500,
        previousState: 0,
        newState: 1,
      },
    ]);

    const caller = await createCaller();
    const decks = await caller.getMyDecks({ timezoneOffsetMinutes: 0 });

    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      id: 1,
      cardCount: 5,
      learnedCount: 1,
      // 1 due review + 1 more new card under today's limit of 3 (the New rows 4 and 5 are not due twice).
      dueCount: 2,
      reviewsBeyondLimit: 0,
    });
  });

  it('passes computed remaining limits to due-card selection', async () => {
    const now = new Date('2026-02-15T13:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await testDb.insert(schema.userSettings).values({
      userId: 1,
      newCardsPerDay: 5,
      reviewsPerDay: 4,
      createdAt: now,
      updatedAt: now,
    });

    await testDb.insert(schema.reviewLogs).values([
      {
        cardId: 1,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now.getTime() - 60_000),
        timeSpentMs: 4_000,
        previousState: 0,
        newState: 1,
      },
      {
        cardId: 2,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now.getTime() - 50_000),
        timeSpentMs: 4_000,
        previousState: 0,
        newState: 1,
      },
      {
        cardId: 3,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now.getTime() - 40_000),
        timeSpentMs: 4_000,
        previousState: 2,
        newState: 2,
      },
    ]);

    fsrsMocks.getDueCards.mockResolvedValue([
      {
        card: { id: 1, deckId: 1, front: 'Front 1', back: 'Back 1' },
        state: { id: 10, stability: 1.2, difficulty: 5, reps: 0, lapses: 0, state: 0 },
        direction: 0,
      },
      {
        card: { id: 2, deckId: 1, front: 'Front 2', back: 'Back 2' },
        state: { id: 11, stability: 3.4, difficulty: 4, reps: 3, lapses: 0, state: 2 },
        direction: 0,
      },
    ]);

    const caller = await createCaller();
    const result = await caller.getDueCards({
      deckId: 1,
      limit: 50,
      timezoneOffsetMinutes: 0,
    });

    expect(fsrsMocks.getDueCards).toHaveBeenCalledWith(1, 1, {
      limit: 50,
      newLimit: 3,
      reviewLimit: 3,
    });

    expect(result.cards).toHaveLength(2);
    expect(result.counts).toMatchObject({
      remainingNewCardsToday: 3,
      remainingReviewsToday: 3,
      newCardsInBatch: 1,
      reviewCardsInBatch: 1,
      newCardsLimit: 5,
      reviewsLimit: 4,
    });
  });

  it('shows a deck\'s progress: cards started (not New rows set up by opening it), and each rating\'s time up to the cap', async () => {
    const { RATING_TIME_CAP_MS } = await import('../services/flashcardDay.js');
    const now = new Date();
    await testDb.insert(schema.cardStates).values([
      { cardId: 1, userId: 1, state: 2, reps: 2, nextReview: now },
      { cardId: 2, userId: 1, state: 1, reps: 1, nextReview: now },
      { cardId: 3, userId: 1, state: 0, nextReview: now },
    ]);
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 1, rating: 3, reviewedAt: now, timeSpentMs: 5_000, previousState: 0, newState: 2 },
      { cardId: 2, userId: 1, rating: 3, reviewedAt: now, timeSpentMs: 9_000_000, previousState: 0, newState: 1 },
    ]);
    const progress = await (await createCaller()).getDeckProgress({ deckId: 1 });
    expect(progress).toMatchObject({ totalCards: 5, reviewedCards: 2, learnedCards: 1, totalReviews: 2, totalTimeMs: 5_000 + RATING_TIME_CAP_MS });
  });

  it('returns mapped review payload for successful reviews', async () => {
    const nextReview = new Date('2026-02-20T12:00:00.000Z');
    fsrsMocks.reviewCard.mockResolvedValue({
      reviewLogId: 77,
      result: {
        nextReview,
        state: 2,
        stability: 12.5,
        difficulty: 4.6,
        reps: 3,
        lapses: 1,
      },
    });

    const caller = await createCaller();
    const response = await caller.review({
      cardStateId: 5,
      rating: 3,
      timeSpentMs: 1200,
    });

    expect(response.reviewLogId).toBe(77);
    expect(response.nextReview).toEqual(nextReview);
    expect(response.newState).toBe(2);
    expect(response.state).toMatchObject({
      id: 5,
      stability: 12.5,
      difficulty: 4.6,
      reps: 3,
      lapses: 1,
      state: 2,
    });
    expect(fsrsMocks.reviewCard).toHaveBeenCalledWith(5, 1, 3, 1200);
  });

  it('maps card-state-not-found review errors to NOT_FOUND', async () => {
    fsrsMocks.reviewCard.mockRejectedValue(new Error('Card state not found'));
    const caller = await createCaller();

    await expectTrpcError(
      caller.review({ cardStateId: 123, rating: 3, timeSpentMs: 500 }),
      'NOT_FOUND',
      'CARD_STATE_NOT_FOUND'
    );
  });

  it('maps undoReview domain errors to tRPC error codes', async () => {
    const caller = await createCaller();

    const cases = [
      { message: 'Review log not found', code: 'NOT_FOUND' as const, appCode: 'REVIEW_LOG_NOT_FOUND' },
      { message: 'Review log is not latest', code: 'CONFLICT' as const, appCode: 'REVIEW_LOG_NOT_LATEST' },
      {
        message: 'Review log is missing snapshot',
        code: 'PRECONDITION_FAILED' as const,
        appCode: 'REVIEW_LOG_MISSING_SNAPSHOT',
      },
      {
        message: 'Review log is missing card state',
        code: 'PRECONDITION_FAILED' as const,
        appCode: 'REVIEW_LOG_MISSING_SNAPSHOT',
      },
      { message: 'Card state not found after undo', code: 'NOT_FOUND' as const, appCode: 'CARD_STATE_NOT_FOUND' },
    ];

    for (const testCase of cases) {
      fsrsMocks.undoReview.mockRejectedValueOnce(new Error(testCase.message));
      await expectTrpcError(caller.undoReview({ reviewLogId: 42 }), testCase.code, testCase.appCode);
    }
  });

  it('forwards getStats to fsrs user stats service', async () => {
    const stats = { cardsReviewedToday: 7 };
    fsrsMocks.getUserStats.mockResolvedValue(stats);

    const caller = await createCaller();
    const result = await caller.getStats({ timezoneOffsetMinutes: 180 });

    expect(result).toEqual(stats);
    expect(fsrsMocks.getUserStats).toHaveBeenCalledWith(1, 180);
  });

  it('exports sanitized review history CSV', async () => {
    const now = new Date('2026-02-15T14:00:00.000Z');

    await testDb
      .update(schema.cards)
      .set({
        front: '<b>Hello "there"</b>',
        back: '<i>Back side</i>',
      })
      .where(eq(schema.cards.id, 2));

    await testDb.insert(schema.reviewLogs).values({
      cardId: 2,
      userId: 1,
      rating: 4,
      reviewedAt: now,
      timeSpentMs: 1200,
      previousState: 0,
      newState: 1,
    });

    const caller = await createCaller();
    const { csv } = await caller.exportMyHistory();

    expect(csv.startsWith('reviewed_at,deck,front,back,rating,from_state,to_state,time_ms')).toBe(true);
    expect(csv).toContain('"Hello ""there"""');
    expect(csv).toContain('"Back side"');
    expect(csv).toContain('"Easy"');
    expect(csv).toContain('"New"');
    expect(csv).toContain('"Learning"');
    expect(csv).not.toContain('<b>');
    expect(csv).not.toContain('<i>');
  });
});

describe('logStudyCompletion (the sloth screen)', () => {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  /** The page's timezone: the machine's own, as getTimezoneOffsetMinutes() sends it. */
  const offset = () => -new Date().getTimezoneOffset();
  const student = { id: 1, googleId: 'u1', email: 'u1@example.com', name: 'Student', picture: null, role: 'user' as const };
  const classmate = { id: 2, googleId: 'u2', email: 'u2@example.com', name: 'Classmate', picture: null, role: 'user' as const };

  beforeEach(async () => {
    vi.resetModules();
    // The real card selection: "nothing left today" is what it says.
    vi.doUnmock('../services/fsrs.js');
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'u1', email: 'u1@example.com', name: 'Student', role: 'user' },
      { id: 2, googleId: 'u2', email: 'u2@example.com', name: 'Classmate', role: 'user' },
    ]);
    await testDb.insert(schema.decks).values([
      { id: 1, name: 'Unit 1', createdBy: 1, reversible: false },
      { id: 2, name: 'Unit 2', createdBy: 1, reversible: false },
    ]);
    await testDb.insert(schema.groups).values({ id: 1, name: 'All' });
    await testDb.insert(schema.userGroups).values([{ userId: 1, groupId: 1 }, { userId: 2, groupId: 1 }]);
    await testDb.insert(schema.deckGroups).values([{ deckId: 1, groupId: 1 }, { deckId: 2, groupId: 1 }]);
    // Unit 1 is cards 10-13, Unit 2 is card 20.
    await testDb.insert(schema.cards).values([
      ...[10, 11, 12, 13].map((id) => ({ id, deckId: 1, front: `f${id}`, back: `b${id}` })),
      { id: 20, deckId: 2, front: 'f20', back: 'b20' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function caller(currentUser: typeof student = student) {
    const { cardsRouter } = await import('./cards.js');
    return cardsRouter.createCaller({
      req: { user: currentUser } as Request,
      res: {} as Response,
      user: currentUser,
    });
  }

  /** The student's cards, all graduated and next due in days: nothing is left today. */
  async function allLearned(cardIds = [10, 11, 12, 13, 20], userId = 1) {
    await testDb.insert(schema.cardStates).values(cardIds.map((cardId) => ({
      cardId, userId, state: 2, reps: 2, nextReview: new Date(Date.now() + 3 * DAY),
    })));
  }

  /** A rating: previousState 0 is a new card, 2 a review, 1 a learning step. */
  const rating = (cardId: number, previousState: number, reviewedAt = new Date(), userId = 1) =>
    ({ cardId, userId, rating: 3, reviewedAt, timeSpentMs: 1000, previousState, newState: 2 });

  const completions = () => testDb.select().from(schema.studyCompletions).orderBy(schema.studyCompletions.id);

  it('records a finished session with the work done, counted from the review log, not from what the page says', async () => {
    await allLearned();
    const now = new Date();
    await testDb.insert(schema.reviewLogs).values([
      rating(10, 0), rating(11, 0), // two new cards
      rating(12, 2), // one review
      rating(10, 1), // a learning step: counts toward neither limit
      rating(13, 0, new Date(now.getTime() - 3 * DAY)), // days ago
      rating(20, 0), // another deck
      rating(12, 0, now, 2), // another student
    ]);
    // A page from before v1.14 still sends its own numbers: they are ignored.
    const result = await (await caller()).logStudyCompletion({
      deckId: 1, reason: 'session_complete', newCardsDone: 99, reviewsDone: 99, timezoneOffsetMinutes: offset(),
    });
    expect(result).toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });

    const rows = await completions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'session_complete', deckId: 1, virtualDeckId: null, newCardsDone: 2, reviewsDone: 1, userId: 1 });
  });

  it('refuses a completion claimed while cards are still due today, and stores nothing', async () => {
    const c = await caller();
    await testDb.insert(schema.reviewLogs).values([rating(10, 0)]);
    // Cards 11-13 were never seen: new cards the page would still show.
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: false, deduped: false, reason: 'cards-due', decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });

    // Every card seen, but one review is due now. (Checking set up the state of the new card it found.)
    await testDb.delete(schema.cardStates);
    await testDb.insert(schema.cardStates).values([10, 11, 12].map((cardId) => ({ cardId, userId: 1, state: 2, reps: 2, nextReview: new Date(Date.now() + 3 * DAY) })));
    await testDb.insert(schema.cardStates).values({ cardId: 13, userId: 1, state: 2, reps: 2, nextReview: new Date(Date.now() - MIN) });
    expect((await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() })).reason).toBe('cards-due');

    // A learning step that has come due.
    await testDb.update(schema.cardStates).set({ state: 1, reps: 1 }).where(eq(schema.cardStates.cardId, 13));
    expect((await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() })).reason).toBe('cards-due');
    expect(await completions()).toEqual([]);

    // Its next step is later today: the page has nothing to show now, so the sloth is real.
    await testDb.update(schema.cardStates).set({ nextReview: new Date(Date.now() + 10 * MIN) }).where(eq(schema.cardStates.cardId, 13));
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    expect(await completions()).toHaveLength(1);
  });

  it('judges "nothing left" by the student\'s limits, the same selection the study page makes', async () => {
    // One new card a day, and today's is done: the three unseen cards wait for tomorrow.
    await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 1, reviewsPerDay: 20 });
    await testDb.insert(schema.cardStates).values({ cardId: 10, userId: 1, state: 2, reps: 1, nextReview: new Date(Date.now() + 3 * DAY) });
    await testDb.insert(schema.reviewLogs).values([rating(10, 0)]);
    const result = await (await caller()).logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    expect(result).toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    expect((await completions())[0]).toMatchObject({ newCardsDone: 1, reviewsDone: 0 });
  });

  it('counts a second session after the first "All Done!" today, and logs it: a real second sloth is not a repeat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Tuesday 6 October 2026, noon in California (19:00 UTC): the first rating, 40 minutes earlier,
    // is on the same school day. On the real clock this failed between midnight and 12:40 am.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 19, 0)));
    await allLearned();
    const now = Date.now();
    const firstDone = new Date(now - 30 * MIN);
    // The first session: two new cards, logged 30 minutes ago.
    await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(now - 40 * MIN)), rating(11, 0, new Date(now - 35 * MIN))]);
    await testDb.insert(schema.studyCompletions).values({ userId: 1, deckId: 1, reason: 'session_complete', newCardsDone: 2, reviewsDone: 0, completedAt: firstDone });
    // Its last rating shares the completion's second (the clock keeps whole seconds): it is not the second session's.
    await testDb.insert(schema.reviewLogs).values([rating(11, 1, firstDone)]);
    // The second session: one new card and one review.
    await testDb.insert(schema.reviewLogs).values([rating(12, 0, new Date(now - 10 * MIN)), rating(13, 2, new Date(now - 5 * MIN))]);

    const result = await (await caller()).logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    expect(result).toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    const rows = await completions();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ newCardsDone: 1, reviewsDone: 1 });
  });

  it('collapses a repeat of the same "All Done!" (nothing rated since), however late it comes', async () => {
    await allLearned();
    const c = await caller();
    await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.now() - 2 * MIN))]);
    await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    const second = await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    expect(second).toEqual({ logged: false, deduped: true, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });

    // An hour later, still nothing rated in the deck: the same sloth.
    await testDb.update(schema.studyCompletions).set({ completedAt: new Date(Date.now() - 60 * MIN) });
    await testDb.update(schema.reviewLogs).set({ reviewedAt: new Date(Date.now() - 61 * MIN) });
    expect((await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() })).deduped).toBe(true);
    // A rating in another deck does not make it a new session in this one.
    await testDb.insert(schema.reviewLogs).values([rating(20, 0)]);
    expect((await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() })).deduped).toBe(true);
    expect(await completions()).toHaveLength(1);
  });

  it('stores one row when the same "All Done!" arrives twice at once', async () => {
    await allLearned();
    await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.now() - 2 * MIN))]);
    const c = await caller();
    const send = () => c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.logged).sort()).toEqual([false, true]);
    expect(await completions()).toHaveLength(1);
  });

  it('counts "today" on the page\'s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 11:30 pm on Sunday 4 October in California (UTC-7), already Monday in UTC.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 6, 30)));
    await allLearned();
    // 4 pm Sunday in California: today there, yesterday in UTC.
    await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.UTC(2026, 9, 4, 23)))]);
    const c = await caller();

    await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: -420 });
    expect((await completions())[0]).toMatchObject({ newCardsDone: 1 });

    await testDb.delete(schema.studyCompletions);
    await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: 0 });
    expect((await completions())[0]).toMatchObject({ newCardsDone: 0 });
  });

  it('checks the day on the school\'s clock too: a forged timezone cannot pass yesterday\'s work off as today\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Tuesday 6 October 2026, 9:00 am in California (16:00 UTC).
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 16, 0)));
    const extra = Array.from({ length: 21 }, (_, i) => 100 + i);
    await testDb.insert(schema.cards).values(extra.map((id) => ({ id, deckId: 1, front: `f${id}`, back: `b${id}` })));
    // Yesterday at 2 pm: 20 new cards learned (next due in days), and yesterday's "All Done!".
    const learned = [10, 11, 12, 13, ...extra.slice(0, 16)];
    const yesterday = new Date(Date.UTC(2026, 9, 5, 21, 0));
    await testDb.insert(schema.cardStates).values(learned.map((cardId) => ({ cardId, userId: 1, state: 2, reps: 2, nextReview: new Date(Date.UTC(2026, 9, 9)) })));
    await testDb.insert(schema.reviewLogs).values(learned.map((cardId) => rating(cardId, 0, yesterday)));
    await testDb.insert(schema.studyCompletions).values({
      userId: 1, deckId: 1, reason: 'session_complete', newCardsDone: 20, reviewsDone: 0, completedAt: new Date(Date.UTC(2026, 9, 5, 21, 5)),
    });
    // Today at 8:55 am: one card rated. Five new cards are still waiting today.
    await testDb.insert(schema.reviewLogs).values(rating(10, 2, new Date(Date.UTC(2026, 9, 6, 15, 55))));
    const c = await caller();

    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: -420 }))
      .toMatchObject({ logged: false, reason: 'cards-due' });
    // The same request made by hand with a "today" that began at 9:30 am yesterday (UTC+7:30):
    // under it yesterday's 20 new cards fill today's limit, but the school's day still has 5 due.
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: 450 }))
      .toMatchObject({ logged: false, reason: 'cards-due' });
    expect(await completions()).toHaveLength(1);

    // Once today's cards are really done, the odd offset is no bar, and only today's work is counted.
    // (Checking set up the state of the new card it found.)
    await testDb.delete(schema.cardStates).where(inArray(schema.cardStates.cardId, extra.slice(16)));
    await testDb.insert(schema.cardStates).values(extra.slice(16).map((cardId) => ({ cardId, userId: 1, state: 2, reps: 1, nextReview: new Date(Date.UTC(2026, 9, 9)) })));
    await testDb.insert(schema.reviewLogs).values(extra.slice(16).map((cardId) => rating(cardId, 0, new Date(Date.UTC(2026, 9, 6, 15, 58)))));
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: 450 })).toMatchObject({ logged: true });
    expect((await completions())[1]).toMatchObject({ newCardsDone: 5, reviewsDone: 1 });
  });

  it('refuses an "All Done!" with nothing rated in the deck today: there was no session to finish', async () => {
    await allLearned();
    await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.now() - 3 * DAY))]);
    expect(await (await caller()).logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: false, deduped: false, reason: 'nothing-rated', decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    expect(await completions()).toEqual([]);
  });

  it('distinguishes an empty deck from real work, so grading can tell them apart', async () => {
    await (await caller()).logStudyCompletion({ deckId: 1, reason: 'nothing_due' });

    const rows = await completions();
    expect(rows[0].reason).toBe('nothing_due');
    expect(rows[0].reviewsDone).toBe(0);
  });

  it('names the decks that still have cards today, newest first, on every answer: "Study all" goes on with them', async () => {
    await allLearned([10, 11, 12, 13]);
    await testDb.insert(schema.reviewLogs).values([rating(10, 0)]);
    const c = await caller();
    // Unit 1 is done; Unit 2's one card was never seen.
    const left = [{ deckId: 2, deckName: 'Unit 2', total: 1 }];
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' })).toEqual({ logged: true, deduped: false, decksLeft: left, decksWaiting: [] });
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: true, deduped: false, decksLeft: left, decksWaiting: [] });
    // A claimed finish of Unit 2 itself is refused, and still says what is left.
    expect(await c.logStudyCompletion({ deckId: 2, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: false, deduped: false, reason: 'cards-due', decksLeft: left, decksWaiting: [] });
  });

  it('collapses reloads of an empty deck within 5 minutes, deck by deck', async () => {
    const c = await caller();
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' })).toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    expect(await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' })).toEqual({ logged: false, deduped: true, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
    // Another deck is its own.
    expect((await c.logStudyCompletion({ deckId: 2, reason: 'nothing_due' })).logged).toBe(true);
    // Six minutes on, the same deck logs again.
    await testDb.update(schema.studyCompletions).set({ completedAt: new Date(Date.now() - 6 * MIN) });
    expect((await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' })).logged).toBe(true);
    expect(await completions()).toHaveLength(3);
  });

  it('still records a different outcome on the same deck', async () => {
    await allLearned();
    await testDb.insert(schema.reviewLogs).values([rating(10, 0)]);
    const c = await caller();
    await c.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' });

    expect(await completions()).toHaveLength(2);
  });

  it('refuses a deck the student cannot reach', async () => {
    await testDb.insert(schema.decks).values({ id: 3, name: 'Other class', createdBy: 1, reversible: false });
    await expectTrpcError((await caller()).logStudyCompletion({ deckId: 3, reason: 'session_complete' }), 'FORBIDDEN');
    expect(await completions()).toEqual([]);
  });

  it('needs a deck or a virtual deck, not both', async () => {
    const c = await caller();
    await expectTrpcError(c.logStudyCompletion({ reason: 'nothing_due' }), 'BAD_REQUEST');
    await testDb.insert(schema.virtualDecks).values({ id: 5, name: 'First two', userId: 1, sourceDeckId: 1, cardSelection: '1-2' });
    await expectTrpcError(c.logStudyCompletion({ deckId: 1, virtualDeckId: 5, reason: 'nothing_due' }), 'BAD_REQUEST');
    expect(await completions()).toEqual([]);
  });

  describe('a virtual deck', () => {
    beforeEach(async () => {
      // The student's "First two" (cards 10, 11) and "Last two" (12, 13) of Unit 1, and a classmate's.
      await testDb.insert(schema.virtualDecks).values([
        { id: 5, name: 'First two', userId: 1, sourceDeckId: 1, cardSelection: '1-2' },
        { id: 6, name: 'Last two', userId: 1, sourceDeckId: 1, cardSelection: '3-4' },
        { id: 7, name: 'Mine', userId: 2, sourceDeckId: 1, cardSelection: '1-4' },
      ]);
    });

    it('counts only its own cards and names only the virtual deck, while its deck\'s day is not done', async () => {
      await testDb.insert(schema.reviewLogs).values([rating(10, 0), rating(11, 2), rating(12, 0), rating(20, 0)]);
      const result = await (await caller()).logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete', timezoneOffsetMinutes: offset() });
      // Not checked against the deck's day (card 13 is still due in Unit 1): a custom selection is not the deck's daily work.
      expect(result).toEqual({ logged: true, deduped: false, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
      expect(await completions()).toEqual([
        expect.objectContaining({ reason: 'session_complete', deckId: null, virtualDeckId: 5, newCardsDone: 1, reviewsDone: 1 }),
      ]);
    });

    it('stores nothing for one with none of its own cards rated today: there was no session to finish', async () => {
      const c = await caller();
      // Cards 12 and 13 ("Last two") rated today, and card 10 days ago: "First two" was not studied today.
      await testDb.insert(schema.reviewLogs).values([rating(12, 0), rating(13, 0), rating(10, 0, new Date(Date.now() - 3 * DAY))]);
      expect(await c.logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
        .toEqual({ logged: false, deduped: false, reason: 'nothing-rated', decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
      expect(await completions()).toEqual([]);
      expect((await c.logStudyCompletion({ virtualDeckId: 6, reason: 'session_complete', timezoneOffsetMinutes: offset() })).logged).toBe(true);
    });

    it('collapses repeats by virtual deck: one virtual deck\'s "All Done!" never hides another\'s', async () => {
      await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.now() - 2 * MIN)), rating(12, 0, new Date(Date.now() - 2 * MIN))]);
      const c = await caller();
      expect((await c.logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete' })).logged).toBe(true);
      expect(await c.logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete' })).toEqual({ logged: false, deduped: true, decksLeft: expect.any(Array), decksWaiting: expect.any(Array) });
      expect((await c.logStudyCompletion({ virtualDeckId: 6, reason: 'session_complete' })).logged).toBe(true);

      // Rating one of "First two"'s cards makes a new session there, and only there.
      await testDb.insert(schema.reviewLogs).values([rating(11, 0, new Date(Date.now() + 2000))]);
      expect((await c.logStudyCompletion({ virtualDeckId: 6, reason: 'session_complete' })).deduped).toBe(true);
      expect((await c.logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete' })).logged).toBe(true);

      // Empty screens, within minutes: each virtual deck, and the deck itself, logs its own.
      expect((await c.logStudyCompletion({ virtualDeckId: 5, reason: 'nothing_due' })).logged).toBe(true);
      expect((await c.logStudyCompletion({ virtualDeckId: 6, reason: 'nothing_due' })).logged).toBe(true);
      expect((await c.logStudyCompletion({ deckId: 1, reason: 'nothing_due' })).logged).toBe(true);
      expect((await c.logStudyCompletion({ virtualDeckId: 6, reason: 'nothing_due' })).deduped).toBe(true);
      expect(await completions()).toHaveLength(6);
    });

    it('keeps its rows tied to it, as the database does: they go when it is deleted, and none names a virtual deck that does not exist', async () => {
      await testDb.insert(schema.reviewLogs).values([rating(10, 0)]);
      await (await caller()).logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete' });
      expect(await completions()).toHaveLength(1);
      await testDb.delete(schema.virtualDecks).where(eq(schema.virtualDecks.id, 5));
      expect(await completions()).toEqual([]);
      await expect(testDb.insert(schema.studyCompletions).values({ userId: 1, deckId: null, virtualDeckId: 99, reason: 'nothing_due' }))
        .rejects.toThrow(/FOREIGN KEY/);
    });

    it('is refused when it is not the student\'s own, or does not exist', async () => {
      const c = await caller();
      await expectTrpcError(c.logStudyCompletion({ virtualDeckId: 7, reason: 'session_complete' }), 'NOT_FOUND', 'VIRTUAL_DECK_NOT_FOUND');
      await expectTrpcError(c.logStudyCompletion({ virtualDeckId: 99, reason: 'nothing_due' }), 'NOT_FOUND', 'VIRTUAL_DECK_NOT_FOUND');
      // The classmate's own is fine for the classmate.
      expect((await (await caller(classmate)).logStudyCompletion({ virtualDeckId: 7, reason: 'nothing_due' })).logged).toBe(true);
      expect(await completions()).toHaveLength(1);
    });

    it('is refused when its deck is no longer the student\'s', async () => {
      await testDb.delete(schema.deckGroups).where(eq(schema.deckGroups.deckId, 1));
      await expectTrpcError((await caller()).logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete' }), 'FORBIDDEN');
      expect(await completions()).toEqual([]);
    });
  });
});

// The libsql/better-sqlite3 client is shared by every describe in this file —
// close it once, after all of them, not at the end of the first block.
afterAll(async () => {
  await client.close();
});

describe('finishing all flashcards (v1.18.0): the day, recorded by any finish', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const future = () => new Date(Date.now() + 5 * DAY);
  const offset = () => -new Date().getTimezoneOffset();
  /** The pace rule's numbers (services/studyPace.ts), read after the database is mocked. */
  let rule: typeof import('../services/studyPace.js');
  /** A first answer at an honest pace: well over the rule's minimum median. */
  let HONEST_MS = 0;

  beforeEach(async () => {
    vi.resetModules();
    // The real card selection: "nothing left today" is what it says.
    vi.doUnmock('../services/fsrs.js');
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    rule = await import('../services/studyPace.js');
    HONEST_MS = rule.FAST_FIRST_ANSWER_MEDIAN_MS * 3;
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'u1', email: '100008@students.school.test', name: 'Ana', role: 'user' },
      { id: 2, googleId: 't', email: 'teacher@school.test', name: 'Teacher', role: 'admin' },
    ]);
    await testDb.insert(schema.decks).values({ id: 1, name: 'Unit 1', createdBy: 2, reversible: false, createdAt: new Date('2026-08-20T16:00:00Z') });
    await testDb.insert(schema.groups).values({ id: 1, name: 'P1' });
    await testDb.insert(schema.userGroups).values([{ userId: 1, groupId: 1 }, { userId: 2, groupId: 1 }]);
    await testDb.insert(schema.deckGroups).values({ deckId: 1, groupId: 1 });
    await testDb.insert(schema.cards).values([10, 11].map((id) => ({ id, deckId: 1, front: `f${id}`, back: `b${id}` })));
  });

  afterEach(async () => {
    await vi.dynamicImportSettled();
    vi.useRealTimers();
  });

  /** More cards in Unit 1: ids from 100. */
  async function moreCards(count: number): Promise<number[]> {
    const ids = Array.from({ length: count }, (_, i) => 100 + i);
    await testDb.insert(schema.cards).values(ids.map((id) => ({ id, deckId: 1, front: `f${id}`, back: `b${id}` })));
    return ids;
  }

  /** "Unit 2", the class's newer deck (created after Unit 1), with these cards, never seen. */
  async function unit2(cardIds = [20, 21]) {
    await testDb.insert(schema.decks).values({ id: 2, name: 'Unit 2', createdBy: 2, reversible: false, createdAt: new Date('2026-09-20T16:00:00Z') });
    await testDb.insert(schema.deckGroups).values({ deckId: 2, groupId: 1 });
    await testDb.insert(schema.cards).values(cardIds.map((id) => ({ id, deckId: 2, front: `f${id}`, back: `b${id}` })));
  }

  /** These cards learned (next due in days) and rated today, as new cards, each `timeMs` long. */
  async function doneToday(cardIds: number[], timeMs = HONEST_MS, userId = 1) {
    await testDb.insert(schema.cardStates).values(cardIds.map((cardId) => ({ cardId, userId, state: 2, reps: 2, nextReview: future() })));
    await testDb.insert(schema.reviewLogs).values(cardIds.map((cardId) => ({
      cardId, userId, rating: 3, reviewedAt: new Date(), timeSpentMs: timeMs, previousState: 0, newState: 2,
    })));
  }

  async function setup(options: {
    learned?: number[];
    learning?: number[];
    ratedToday?: number[];
    /** Each rated card's time (ms); an honest pace unless given. */
    times?: number[];
    userId?: number;
  } = {}) {
    const userId = options.userId ?? 1;
    for (const cardId of options.learned ?? [10, 11]) {
      await testDb.insert(schema.cardStates).values({ cardId, userId, state: 2, reps: 2, nextReview: future() });
    }
    for (const cardId of options.learning ?? []) {
      await testDb.insert(schema.cardStates).values({ cardId, userId, state: 1, reps: 1, nextReview: future() });
    }
    const rated = options.ratedToday ?? [10, 11];
    if (rated.length > 0) {
      await testDb.insert(schema.reviewLogs).values(rated.map((cardId, i) => ({
        cardId, userId, rating: 3, reviewedAt: new Date(), timeSpentMs: options.times?.[i] ?? HONEST_MS, previousState: 0, newState: 2,
      })));
    }
    const { cardsRouter } = await import('./cards.js');
    const user = userId === 2
      ? { id: 2, googleId: 't', email: 'teacher@school.test', name: 'Teacher', picture: null, role: 'admin' as const }
      : { id: 1, googleId: 'u1', email: '100008@students.school.test', name: 'Ana', picture: null, role: 'user' as const };
    const api = cardsRouter.createCaller({ req: { user } as Request, res: {} as Response, user });
    /** The page's "All Done!" report for a deck (Unit 1 unless named). */
    const finish = (deckId = 1) => api.logStudyCompletion({ deckId, reason: 'session_complete', timezoneOffsetMinutes: offset() });
    return { finish, api };
  }
  const completions = () => testDb.select().from(schema.studyCompletions).orderBy(schema.studyCompletions.id);
  const allDone = () => testDb.select().from(schema.flashcardAllDone);

  it('records the day once every deck\'s cards are done, once a day; the deck\'s own finish is its row, and no extension field is told', async () => {
    const { finish } = await setup();
    expect(await finish()).toEqual({ logged: true, deduped: false, decksLeft: [], decksWaiting: [] });
    const day = (await import('../services/schoolCalendar.js')).schoolDayOf(new Date());
    // The day is recorded for the teacher's grid; the deck's own finish is its row.
    expect(await allDone()).toMatchObject([{ userId: 1, day, deckIds: '[1]' }]);
    expect(await completions()).toMatchObject([{ reason: 'session_complete', deckId: 1 }]);
    // A second "All Done!" that day (a retry, a lost response): the same day, recorded once.
    expect(await finish()).toEqual({ logged: false, deduped: true, decksLeft: [], decksWaiting: [] });
    expect(await allDone()).toHaveLength(1);
  });

  it('waits for every deck: the newest deck done leaves the older one\'s cards, and finishing the last deck records the day', async () => {
    await unit2();
    // Unit 2, the newest, is done first ("Study all" leads with it); Unit 1 still has its two new cards.
    const { api, finish } = await setup({ learned: [], ratedToday: [] });
    await doneToday([20, 21]);
    expect(await finish(2)).toEqual({
      logged: true, deduped: false, decksLeft: [{ deckId: 1, deckName: 'Unit 1', total: 2 }], decksWaiting: [],
    });
    expect(await allDone()).toEqual([]);

    // Then Unit 1: nothing is due anywhere now.
    await doneToday([10, 11]);
    expect(await finish(1)).toEqual({ logged: true, deduped: false, decksLeft: [], decksWaiting: [] });
    // Each deck's "All Done!" is its own row, as the teacher's grid reads them; the day lists the decks newest first.
    expect((await completions()).map((c) => c.deckId)).toEqual([2, 1]);
    expect(await allDone()).toMatchObject([{ userId: 1, deckIds: '[2,1]' }]);
    // Unit 2's report sent again (a lost response): the same day.
    expect(await api.logStudyCompletion({ deckId: 2, reason: 'session_complete', timezoneOffsetMinutes: offset() }))
      .toEqual({ logged: false, deduped: true, decksLeft: [], decksWaiting: [] });
    expect(await allDone()).toHaveLength(1);
  });

  it('judges "today" by the school\'s clock, whatever offset the page sends', async () => {
    // The school's offset itself: services/schoolCalendar.test.ts.
    // Yesterday's cards only, and a page that says it is 14 hours ahead of UTC: no day.
    await setup({ ratedToday: [] });
    const yesterday = new Date(Date.now() - DAY);
    await testDb.insert(schema.reviewLogs).values([10, 11].map((cardId) => ({
      cardId, userId: 1, rating: 3, reviewedAt: yesterday, timeSpentMs: HONEST_MS, previousState: 0, newState: 2,
    })));
    const { cardsRouter } = await import('./cards.js');
    const user = { id: 1, googleId: 'u1', email: '100008@students.school.test', name: 'Ana', picture: null, role: 'user' as const };
    const api = cardsRouter.createCaller({ req: { user } as Request, res: {} as Response, user });
    expect(await api.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: 840 })).toMatchObject({ logged: false });
    expect(await allDone()).toEqual([]);
  });

  it('records nothing for a completion the page made up: no card rated today', async () => {
    const { finish } = await setup({ ratedToday: [] });
    expect(await finish()).toMatchObject({ logged: false, reason: 'nothing-rated' });
    expect(await allDone()).toEqual([]);
  });

  it('records nothing while cards are left for today in any deck, or one is still in learning', async () => {
    await testDb.insert(schema.cards).values({ id: 12, deckId: 1, front: 'f12', back: 'b12' }); // new, never seen: still due today
    const { finish } = await setup();
    await finish();
    expect(await allDone()).toEqual([]);
    // Seen now, and still in learning (its next step later today): the day is not over.
    await testDb.insert(schema.cardStates).values({ cardId: 12, userId: 1, state: 1, reps: 1, nextReview: future() });
    await finish();
    expect(await allDone()).toEqual([]);
    // Graduated: Unit 1 is done. But a card of Unit 2 waits on a learning step later today.
    await testDb.update(schema.cardStates).set({ state: 2, reps: 2 }).where(eq(schema.cardStates.cardId, 12));
    await unit2([20]);
    await testDb.insert(schema.cardStates).values({ cardId: 20, userId: 1, state: 3, reps: 3, nextReview: new Date(Date.now() + 10 * 60 * 1000) });
    const result = await finish();
    // Unit 2 has nothing due now, so it is not "still due", but its card comes back in 10 minutes:
    // the "All Done!" screen says so (the day waits for it).
    expect(result).toMatchObject({ decksLeft: [] });
    expect(result.decksWaiting).toEqual([{ deckId: 2, deckName: 'Unit 2', count: 1, backInMs: expect.any(Number) }]);
    expect(result.decksWaiting[0].backInMs).toBeGreaterThan(9 * 60 * 1000);
    expect(result.decksWaiting[0].backInMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(await allDone()).toEqual([]);
    // Its step done: now every deck is.
    await testDb.update(schema.cardStates).set({ state: 2 }).where(eq(schema.cardStates.cardId, 20));
    await finish();
    expect(await allDone()).toMatchObject([{ userId: 1, deckIds: '[2,1]' }]);
  });

  it('never records a teacher\'s day: a teacher\'s practice is not a school day\'s work', async () => {
    const { finish } = await setup({ userId: 2 });
    expect(await finish()).toMatchObject({ logged: true });
    expect(await allDone()).toEqual([]);
  });

  it('never fails the report when the check fails', async () => {
    const { finish } = await setup();
    await client.execute('ALTER TABLE flashcard_all_done RENAME TO flashcard_all_done_gone');
    try {
      const result = await finish();
      expect(result).toEqual({ logged: true, deduped: false, decksLeft: [], decksWaiting: [] });
    } finally {
      await client.execute('ALTER TABLE flashcard_all_done_gone RENAME TO flashcard_all_done');
    }
    expect(await allDone()).toEqual([]);
  });

  describe('cards.studyAll: the decks with cards due today, newest first', () => {
    it('lists each deck with what its deck card shows, by creation (then id), leaving out decks with nothing due', async () => {
      await unit2([20, 21]);
      // "Unit 3", the newest by creation though not by id; and an old deck with nothing due today.
      await testDb.insert(schema.decks).values([
        { id: 3, name: 'Old review', createdBy: 2, reversible: false, createdAt: new Date('2026-08-01T16:00:00Z') },
        { id: 0, name: 'Unit 3', createdBy: 2, reversible: true, createdAt: new Date('2026-10-08T16:00:00Z') },
      ]);
      await testDb.insert(schema.deckGroups).values([{ deckId: 3, groupId: 1 }, { deckId: 0, groupId: 1 }]);
      await testDb.insert(schema.cards).values([
        { id: 30, deckId: 3, front: 'f30', back: 'b30' },
        { id: 40, deckId: 0, front: 'f40', back: 'b40' },
      ]);
      const { api } = await setup({ learned: [10, 30], ratedToday: [] });
      // Unit 1: one review due now, one new card; Unit 2: two new cards; Unit 3: one card both ways.
      await testDb.update(schema.cardStates).set({ nextReview: new Date(Date.now() - 60_000) }).where(eq(schema.cardStates.cardId, 10));
      expect(await api.studyAll({ timezoneOffsetMinutes: offset() })).toEqual({
        decks: [
          { deckId: 0, deckName: 'Unit 3', learning: 0, reviews: 0, newCards: 2, total: 2 },
          { deckId: 2, deckName: 'Unit 2', learning: 0, reviews: 0, newCards: 2, total: 2 },
          { deckId: 1, deckName: 'Unit 1', learning: 0, reviews: 1, newCards: 1, total: 2 },
        ],
        totalDue: 6,
        learningLater: 0,
        learningBackInMs: null,
      });
    });

    it('keeps to the student\'s limits (stored, never assumed), and says when cards in learning come back', async () => {
      const { api } = await setup({ learned: [], ratedToday: [] });
      await moreCards(3);
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 2, reviewsPerDay: 250 });
      await testDb.insert(schema.cardStates).values({ cardId: 10, userId: 1, state: 1, reps: 1, nextReview: new Date(Date.now() + 5 * 60_000) });
      const view = await api.studyAll({ timezoneOffsetMinutes: offset() });
      expect(view.decks).toEqual([{ deckId: 1, deckName: 'Unit 1', learning: 0, reviews: 0, newCards: 2, total: 2 }]);
      expect(view.learningLater).toBe(1);
      expect(view.learningBackInMs).toBeGreaterThan(4 * 60_000);
      expect(view.learningBackInMs).toBeLessThanOrEqual(5 * 60_000);
    });

    it('is empty for a student whose decks are all done, and for one with no decks', async () => {
      const { api } = await setup();
      expect(await api.studyAll()).toEqual({ decks: [], totalDue: 0, learningLater: 0, learningBackInMs: null });
      await testDb.delete(schema.userGroups).where(eq(schema.userGroups.userId, 1));
      expect((await api.studyAll()).decks).toEqual([]);
    });
  });

  describe('recorded by the server at the review that empties the day', () => {
    const START = new Date('2026-10-06T16:00:00Z'); // Tuesday 9 am at the school

    async function student() {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(START);
      const { api } = await setup({ learned: [], ratedToday: [] });
      /** Study's own page: open a deck, then rate each card it shows, `gapMs` apart, each after `claimedMs` on it. */
      const open = async (deckId = 1) => (await api.getDueCards({ deckId, timezoneOffsetMinutes: -420 })).cards;
      const rate = async (cardStateId: number, rating: number, gapMs = HONEST_MS + 500, claimedMs = HONEST_MS) => {
        vi.setSystemTime(new Date(Date.now() + gapMs));
        return api.review({ cardStateId, rating, timeSpentMs: claimedMs });
      };
      return { api, open, rate };
    }

    it('stores the "All Done!" and records the day at the last card; a review that leaves cards stores nothing', async () => {
      const { api, open, rate } = await student();
      const [first, second] = await open();
      const review = await rate(first.state.id, 4);
      // No extension loaded: the review tells nothing beyond core's fields.
      expect(Object.keys(review).sort()).toEqual(['newState', 'nextReview', 'nextReviewOptions', 'reviewLogId', 'state']);
      expect(await completions()).toEqual([]);
      await rate(second.state.id, 4);
      expect(await completions()).toMatchObject([{ reason: 'session_complete', deckId: 1, virtualDeckId: null, newCardsDone: 2, reviewsDone: 0 }]);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06', deckIds: '[1]' }]);

      // The page's own report comes after: the same finish (nothing stored).
      expect(await api.logStudyCompletion({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: -420 }))
        .toEqual({ logged: false, deduped: true, decksLeft: [], decksWaiting: [] });
      expect(await completions()).toHaveLength(1);
      expect(await allDone()).toHaveLength(1);
    });

    it('runs "Study all": the newest deck first, each its own session, and the last card of the last deck records the day', async () => {
      await unit2([20, 21]);
      const { api, open, rate } = await student();
      expect((await api.studyAll({ timezoneOffsetMinutes: -420 })).decks.map((d) => d.deckName)).toEqual(['Unit 2', 'Unit 1']);
      for (const card of await open(2)) await rate(card.state.id, 4);
      // Unit 2's day is done (its "All Done!" stored at its last card), Unit 1's is not: no day yet.
      expect(await completions()).toMatchObject([{ reason: 'session_complete', deckId: 2 }]);
      expect(await allDone()).toEqual([]);
      expect(await api.logStudyCompletion({ deckId: 2, reason: 'session_complete', timezoneOffsetMinutes: -420 }))
        .toEqual({ logged: false, deduped: true, decksLeft: [{ deckId: 1, deckName: 'Unit 1', total: 2 }], decksWaiting: [] });
      expect((await api.studyAll({ timezoneOffsetMinutes: -420 })).decks.map((d) => d.deckName)).toEqual(['Unit 1']);

      for (const card of await open(1)) await rate(card.state.id, 4);
      expect((await completions()).map((c) => c.deckId)).toEqual([2, 1]);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06', deckIds: '[2,1]' }]);
      expect(await api.studyAll({ timezoneOffsetMinutes: -420 })).toMatchObject({ decks: [], totalDue: 0 });
    });

    it('records the day deck by deck in any order too: the older deck first, then the newest', async () => {
      await unit2([20]);
      const { open, rate } = await student();
      for (const card of await open(1)) await rate(card.state.id, 4);
      expect(await allDone()).toEqual([]);
      for (const card of await open(2)) await rate(card.state.id, 4);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06' }]);
    });

    it('stores nothing while a card waits on a learning step: Exit after one pass and reopen stays "nothing due"', async () => {
      const { api, open, rate } = await student();
      for (const card of await open()) await rate(card.state.id, 3);
      // Both cards are in learning, their next step minutes away: nothing is due, and nothing is finished.
      expect(await open()).toEqual([]);
      // The deck itself waits on them (its page tells its own; another deck's "All Done!" would name it).
      expect(await api.logStudyCompletion({ deckId: 1, reason: 'nothing_due', timezoneOffsetMinutes: -420 })).toEqual({
        logged: true, deduped: false, decksLeft: [],
        decksWaiting: [{ deckId: 1, deckName: 'Unit 1', count: 2, backInMs: expect.any(Number) }],
      });
      expect((await completions()).map((c) => c.reason)).toEqual(['nothing_due']);
      expect(await allDone()).toEqual([]);

      // Their step comes due, and the last of them graduates: now the day is done.
      vi.setSystemTime(new Date(Date.now() + 15 * 60 * 1000));
      for (const card of await open()) await rate(card.state.id, 3);
      expect((await completions()).map((c) => c.reason)).toEqual(['nothing_due', 'session_complete']);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06' }]);
    });

    it('stores the server\'s own times when the cards went by too fast, and still records the day', async () => {
      await moreCards(6);
      const { open, rate } = await student();
      const [first, ...rest] = await open();
      // The page claims an honest time for every card, but after the first the ratings came 0.1 s apart.
      await rate(first.state.id, 4);
      for (const card of rest) await rate(card.state.id, 4, 100);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06' }]);
      const times = (await testDb.select().from(schema.reviewLogs).orderBy(schema.reviewLogs.id)).map((r) => r.timeSpentMs);
      expect(times).toHaveLength(8);
      expect(times[0]).toBe(HONEST_MS);
      // reviewed_at keeps whole seconds, so each is the gap plus up to a second: never the page's claim.
      for (const ms of times.slice(1)) expect(ms).toBeLessThanOrEqual(1_100);
      expect(rule.medianMs(times)).toBeLessThan(rule.FAST_FIRST_ANSWER_MEDIAN_MS);
    });

    it('counts a mini-deck study that empties the last deck\'s day as finishing all flashcards', async () => {
      const { api, rate } = await student();
      await testDb.insert(schema.virtualDecks).values({ id: 5, name: 'All of it', userId: 1, sourceDeckId: 1, cardSelection: '1-2' });
      const { virtualDecksRouter } = await import('./virtualDecks.js');
      const user = { id: 1, googleId: 'u1', email: '100008@students.school.test', name: 'Ana', picture: null, role: 'user' as const };
      const mini = virtualDecksRouter.createCaller({ req: { user } as Request, res: {} as Response, user });
      for (const card of await mini.getDueCards({ virtualDeckId: 5, timezoneOffsetMinutes: -420 })) await rate(card.state.id, 4);
      expect(await completions()).toMatchObject([{ reason: 'session_complete', deckId: 1, virtualDeckId: null }]);
      // The mini-deck's own "All Done!" is stored too.
      expect(await api.logStudyCompletion({ virtualDeckId: 5, reason: 'session_complete', timezoneOffsetMinutes: -420 }))
        .toEqual({ logged: true, deduped: false, decksLeft: [], decksWaiting: [] });
      expect((await completions()).map((c) => [c.deckId, c.virtualDeckId])).toEqual([[1, null], [null, 5]]);
      expect(await allDone()).toMatchObject([{ userId: 1, day: '2026-10-06', deckIds: '[1]' }]);
    });

    it('never fails the review when recording the finish fails', async () => {
      const { open, rate } = await student();
      const [first, second] = await open();
      await rate(first.state.id, 4);
      await client.execute('ALTER TABLE study_completions RENAME TO study_completions_gone');
      try {
        expect(await rate(second.state.id, 4)).toMatchObject({ newState: 2 });
      } finally {
        await client.execute('ALTER TABLE study_completions_gone RENAME TO study_completions');
      }
      expect((await testDb.select().from(schema.reviewLogs)).length).toBe(2);
    });
  });

  describe('the time a rating is stored with', () => {
    it('is the page\'s, held to the time since the student\'s last rating in the deck and to RATING_TIME_CAP_MS', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-06T16:00:00Z'));
      const { api } = await setup({ learned: [], ratedToday: [] });
      const { RATING_TIME_CAP_MS } = await import('../services/flashcardDay.js');
      const [first, second] = (await api.getDueCards({ deckId: 1 })).cards;
      const stored = async () => (await testDb.select().from(schema.reviewLogs).orderBy(schema.reviewLogs.id)).map((r) => r.timeSpentMs);
      // The first rating of the day: nothing to measure it against but the cap.
      await api.review({ cardStateId: first.state.id, rating: 1, timeSpentMs: 3_000_000 });
      expect(await stored()).toEqual([RATING_TIME_CAP_MS]);
      // A second later, a claimed 30 s is stored as the second that passed (up to a second more: whole-second clock).
      vi.setSystemTime(new Date(Date.now() + 1000));
      await api.review({ cardStateId: second.state.id, rating: 1, timeSpentMs: 30_000 });
      expect((await stored())[1]).toBeGreaterThanOrEqual(1000);
      expect((await stored())[1]).toBeLessThanOrEqual(2000);
      // Two ratings sent at once share the time that passed: only one of them can claim it.
      vi.setSystemTime(new Date(Date.now() + 5000));
      await Promise.all([
        api.review({ cardStateId: first.state.id, rating: 3, timeSpentMs: 5000 }),
        api.review({ cardStateId: second.state.id, rating: 3, timeSpentMs: 5000 }),
      ]);
      const [, , a, b] = await stored();
      expect(Math.min(a, b)).toBe(0);
      expect(Math.max(a, b)).toBeLessThanOrEqual(6000);
      // A card left open for two hours (a closed lid), or a clock stepped back: still rated, and
      // stored within the cap and never below zero.
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      expect(await api.review({ cardStateId: first.state.id, rating: 3, timeSpentMs: 7_200_000 })).toMatchObject({ reviewLogId: expect.any(Number) });
      vi.setSystemTime(new Date(Date.now() + 3000));
      expect(await api.review({ cardStateId: second.state.id, rating: 3, timeSpentMs: -5000 })).toMatchObject({ reviewLogId: expect.any(Number) });
      const [, , , , long, negative] = await stored();
      expect(long).toBe(RATING_TIME_CAP_MS);
      expect(negative).toBe(0);
    });
  });
});
