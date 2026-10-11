// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb, sqlite } = createTestDb();

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** Mon 5 Oct 2026, 10:00 in California (UTC-7). */
const NOW = new Date(Date.UTC(2026, 9, 5, 17));
const PDT = -420;

async function load() {
  return import('./dueToday.js');
}

/** A rating: previousState 0 is a new card, 2 a review, 1 a learning step. */
const rating = (cardId: number, previousState: number, reviewedAt: Date, userId = 1) =>
  ({ cardId, userId, rating: 3, reviewedAt, timeSpentMs: 1000, previousState, newState: 2 });

describe('dueToday: a student\'s day in a deck', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'u1', email: 'u1@example.com', name: 'Ana', role: 'user' },
      { id: 2, googleId: 'u2', email: 'u2@example.com', name: 'Beto', role: 'user' },
    ]);
    await testDb.insert(schema.decks).values([
      { id: 1, name: 'Unit 1', createdBy: 1, reversible: false },
      { id: 2, name: 'Unit 2', createdBy: 1, reversible: false },
    ]);
    // Unit 1 is cards 10-14, Unit 2 is card 20.
    await testDb.insert(schema.cards).values([
      ...[10, 11, 12, 13, 14].map((id) => ({ id, deckId: 1, front: `f${id}`, back: `b${id}` })),
      { id: 20, deckId: 2, front: 'f20', back: 'b20' },
    ]);
  });

  describe('studyDay', () => {
    it('reads the limits and what today used of them: new cards and reviews, not learning steps, other decks, other students or yesterday', async () => {
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 3, reviewsPerDay: 2 });
      await testDb.insert(schema.reviewLogs).values([
        rating(10, 0, new Date(NOW.getTime() - 60 * MIN)),
        rating(11, 0, new Date(NOW.getTime() - 50 * MIN)),
        rating(10, 1, new Date(NOW.getTime() - 40 * MIN)), // a learning step
        rating(12, 2, new Date(NOW.getTime() - 30 * MIN)),
        rating(13, 2, new Date(NOW.getTime() - 20 * MIN)),
        rating(14, 2, new Date(NOW.getTime() - 10 * MIN)), // one review over the limit
        rating(20, 0, new Date(NOW.getTime() - 10 * MIN)), // Unit 2
        rating(14, 0, new Date(NOW.getTime() - DAY)), // yesterday
        rating(10, 0, new Date(NOW.getTime() - 10 * MIN), 2), // Beto
      ]);
      const { studyDay } = await load();
      expect(await studyDay(1, 1, PDT, NOW)).toEqual({
        newCardsPerDay: 3,
        reviewsPerDay: 2,
        todayStart: new Date(Date.UTC(2026, 9, 5, 7)), // midnight in California
        newToday: 2,
        reviewsToday: 3,
        remainingNew: 1,
        remainingReviews: 0, // never below zero
      });
    });

    it('uses the deck\'s own limits when the student set them', async () => {
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 20 });
      await testDb.insert(schema.deckUserSettings).values({ userId: 1, deckId: 1, newCardsPerDay: 5, reviewsPerDay: 7 });
      const { studyDay } = await load();
      expect(await studyDay(1, 1, PDT, NOW)).toMatchObject({ newCardsPerDay: 5, reviewsPerDay: 7, remainingNew: 5, remainingReviews: 7 });
      expect(await studyDay(1, 2, PDT, NOW)).toMatchObject({ newCardsPerDay: 20, reviewsPerDay: 20 });
    });

    it('starts today at midnight on the page\'s clock', async () => {
      // 11:30 pm Sunday in California is already Monday in UTC.
      const lateSunday = new Date(Date.UTC(2026, 9, 5, 6, 30));
      // 4 pm Sunday in California: Sunday UTC too, so "yesterday" for a page on UTC.
      await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date(Date.UTC(2026, 9, 4, 23)))]);
      const { studyDay } = await load();
      expect((await studyDay(1, 1, PDT, lateSunday)).newToday).toBe(1);
      expect((await studyDay(1, 1, 0, lateSunday)).newToday).toBe(0);
    });
  });

  describe('countRatings and sessionCounts', () => {
    it('count a deck\'s ratings, or only a virtual deck\'s cards', async () => {
      const since = new Date(NOW.getTime() - 60 * MIN);
      await testDb.insert(schema.reviewLogs).values([
        rating(10, 0, NOW), rating(11, 2, NOW), rating(12, 0, NOW), rating(12, 1, NOW), rating(20, 0, NOW),
      ]);
      const { countRatings, sessionCounts } = await load();
      expect(countRatings(1, 1, { since })).toBe(4);
      expect(countRatings(1, { deckId: 1, cardIds: [10, 11] }, { since })).toBe(2);
      expect(countRatings(1, { deckId: 1, cardIds: [] }, { since })).toBe(0);
      // A card id of another deck is not this deck's rating.
      expect(countRatings(1, { deckId: 1, cardIds: [10, 20] }, { since })).toBe(1);
      expect(sessionCounts(1, 1, since)).toEqual({ newCardsDone: 2, reviewsDone: 1 });
      expect(sessionCounts(1, { deckId: 1, cardIds: [11, 12] }, since)).toEqual({ newCardsDone: 1, reviewsDone: 1 });
    });

    it('can start strictly after a time: the rating in an earlier "All Done!"\'s own second is that session\'s', async () => {
      const done = new Date(Date.UTC(2026, 9, 5, 16, 30));
      await testDb.insert(schema.reviewLogs).values([
        rating(10, 0, new Date(done.getTime() + 400)), // the same whole second as the completion
        rating(11, 0, new Date(done.getTime() + 60_000)),
      ]);
      const { countRatings, sessionCounts } = await load();
      expect(countRatings(1, 1, { since: done })).toBe(2);
      expect(countRatings(1, 1, { since: done, after: true })).toBe(1);
      expect(sessionCounts(1, 1, done, { after: true })).toEqual({ newCardsDone: 1, reviewsDone: 0 });
    });
  });

  describe('cardsLeftToday: the study page\'s own selection', () => {
    const future = () => new Date(Date.now() + 3 * DAY);
    async function state(cardId: number, fields: { state: number; nextReview: Date }) {
      await testDb.insert(schema.cardStates).values({ cardId, userId: 1, reps: 1, ...fields });
    }

    it('finds an unseen new card, until today\'s new-card limit is used', async () => {
      for (const id of [10, 11, 12, 13]) await state(id, { state: 2, nextReview: future() });
      const { cardsLeftToday } = await load();
      expect(await cardsLeftToday(1, 1)).toBe(true); // card 14 was never seen
      // The check only reads: it set up neither the card's state nor the student's settings.
      expect(await testDb.select().from(schema.cardStates).where(eq(schema.cardStates.cardId, 14))).toEqual([]);
      expect(await testDb.select().from(schema.userSettings)).toEqual([]);
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 1, reviewsPerDay: 20 });
      await testDb.insert(schema.reviewLogs).values([rating(10, 0, new Date())]);
      expect(await cardsLeftToday(1, 1)).toBe(false);
    });

    it('finds a review due now, until today\'s review limit is used', async () => {
      for (const id of [10, 11, 12, 13, 14]) await state(id, { state: 2, nextReview: future() });
      await testDb.update(schema.cardStates).set({ nextReview: new Date(Date.now() - MIN) }).where(eq(schema.cardStates.cardId, 12));
      const { cardsLeftToday } = await load();
      expect(await cardsLeftToday(1, 1)).toBe(true);
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 1 });
      await testDb.insert(schema.reviewLogs).values([rating(11, 2, new Date())]);
      expect(await cardsLeftToday(1, 1)).toBe(false);
    });

    it('finds a learning step that has come due, not one later today', async () => {
      for (const id of [10, 11, 12, 13]) await state(id, { state: 2, nextReview: future() });
      await state(14, { state: 1, nextReview: new Date(Date.now() - MIN) });
      const { cardsLeftToday } = await load();
      expect(await cardsLeftToday(1, 1)).toBe(true);
      await testDb.update(schema.cardStates).set({ nextReview: new Date(Date.now() + 10 * MIN) }).where(eq(schema.cardStates.cardId, 14));
      expect(await cardsLeftToday(1, 1)).toBe(false);
    });

    it('is only this student\'s deck', async () => {
      for (const id of [10, 11, 12, 13, 14]) await state(id, { state: 2, nextReview: future() });
      const { cardsLeftToday } = await load();
      expect(await cardsLeftToday(1, 1)).toBe(false);
      expect(await cardsLeftToday(1, 2)).toBe(true); // Unit 2's card was never seen
      expect(await cardsLeftToday(2, 1)).toBe(true); // Beto has seen nothing
    });
  });

  describe('dueTodayByDeck: the due number is exactly what Study opens with', () => {
    // Unit 3 (cards 100-124) is bigger than a day's 20 new cards; Both ways (200-204) is reversible.
    const BIG = 3;
    const BOTH = 4;
    const big = Array.from({ length: 25 }, (_, i) => 100 + i);
    const both = [200, 201, 202, 203, 204];

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      await testDb.insert(schema.decks).values([
        { id: BIG, name: 'Unit 3', createdBy: 1, reversible: false },
        { id: BOTH, name: 'Both ways', createdBy: 1, reversible: true },
      ]);
      await testDb.insert(schema.cards).values([...big, ...both].map((id) => ({ id, deckId: id < 200 ? BIG : BOTH, front: `f${id}`, back: `b${id}` })));
      await testDb.insert(schema.groups).values({ id: 1, name: 'Period 1' });
      await testDb.insert(schema.userGroups).values([{ userId: 1, groupId: 1 }, { userId: 2, groupId: 1 }]);
      await testDb.insert(schema.deckGroups).values([1, 2, BIG, BOTH].map((deckId) => ({ deckId, groupId: 1 })));
    });

    afterEach(async () => {
      // A review's AI follow-up is imported after the review returns: let it land in this test.
      await vi.dynamicImportSettled();
      vi.useRealTimers();
    });

    async function callers(userId = 1) {
      const { cardsRouter } = await import('../routers/cards.js');
      const { virtualDecksRouter } = await import('../routers/virtualDecks.js');
      const user = { id: userId, googleId: `u${userId}`, email: `u${userId}@example.com`, name: 'Ana', picture: null, role: 'user' as const };
      const ctx = { req: { user } as unknown as Request, res: {} as Response, user, requestId: null };
      return { cards: cardsRouter.createCaller(ctx), mini: virtualDecksRouter.createCaller(ctx) };
    }

    /**
     * A deck's due number three ways, read before Study opens it (opening sets up the
     * states of the new cards it shows): dueTodayByDeck, the deck list and the cards Study opens with.
     */
    async function dueThreeWays(deckId: number) {
      const { dueTodayByDeck } = await load();
      const counted = dueTodayByDeck(1, [deckId], PDT, new Date()).get(deckId);
      const { cards } = await callers();
      const listed = (await cards.getMyDecks({ timezoneOffsetMinutes: PDT })).find((d) => d.id === deckId);
      const opened = (await cards.getDueCards({ deckId, timezoneOffsetMinutes: PDT })).cards;
      return { counted, listed, opened };
    }

    /** Every card of a deck in review, due `dueIn` from now. */
    async function inReview(cardIds: number[], dueIn: number, direction = 0) {
      await testDb.insert(schema.cardStates).values(cardIds.map((cardId) => ({
        cardId, userId: 1, direction, state: 2, reps: 2, stability: 5, nextReview: new Date(Date.now() + dueIn),
      })));
    }

    it('a fresh deck: today\'s 20 new cards, and only reads (no card state, no settings row)', async () => {
      const { dueTodayByDeck } = await load();
      expect(dueTodayByDeck(1, [BIG], PDT, NOW).get(BIG)).toEqual({
        learning: 0, reviews: 0, newCards: 20, total: 20, reviewsBeyondLimit: 0, learningLater: 0, nextLearningAt: null,
      });
      expect(await testDb.select().from(schema.cardStates)).toEqual([]);
      expect(await testDb.select().from(schema.userSettings)).toEqual([]);
      const { counted, listed, opened } = await dueThreeWays(BIG);
      expect([counted?.total, listed?.dueCount, opened.length]).toEqual([20, 20, 20]);
    });

    it('opened and left: still 20, not 40 (the New rows Study set up are counted once)', async () => {
      const first = await dueThreeWays(BIG);
      expect(first.opened).toHaveLength(20);
      expect(await testDb.select().from(schema.cardStates)).toHaveLength(20);
      const again = await dueThreeWays(BIG);
      expect([again.counted?.total, again.listed?.dueCount, again.opened.length]).toEqual([20, 20, 20]);
      // Your Progress adds up the deck list, and a New row is not a card studied.
      const { getUserStats } = await import('./fsrs.js');
      const decks = await (await callers()).cards.getMyDecks({ timezoneOffsetMinutes: PDT });
      const stats = await getUserStats(1, PDT);
      expect(stats.cardsDue).toBe(decks.reduce((sum, d) => sum + d.dueCount, 0));
      expect(stats.cardsDue).toBe(5 + 1 + 20 + 10);
      expect(stats.totalCards).toBe(0);
    });

    it('after 5 Good: 15 now (those 5 are learning, not due yet), and the 5 come back into the count once their step is due', async () => {
      const { cards } = await callers();
      const opened = (await cards.getDueCards({ deckId: BIG, timezoneOffsetMinutes: PDT })).cards;
      for (const card of opened.slice(0, 5)) {
        vi.setSystemTime(new Date(Date.now() + 3000));
        await cards.review({ cardStateId: card.state.id, rating: 3, timeSpentMs: 2500 });
      }
      const now = await dueThreeWays(BIG);
      expect(now.counted).toMatchObject({ learning: 0, newCards: 15, total: 15, learningLater: 5 });
      expect([now.listed?.dueCount, now.opened.length]).toEqual([15, 15]);
      // Study itself says when they come back.
      expect((await cards.getDueCards({ deckId: 1, timezoneOffsetMinutes: PDT })).counts.learningLater).toBe(0);

      vi.setSystemTime(new Date(Date.now() + 11 * MIN));
      const later = await dueThreeWays(BIG);
      expect(later.counted).toMatchObject({ learning: 5, newCards: 15, total: 20, learningLater: 0 });
      expect([later.listed?.dueCount, later.opened.length]).toEqual([20, 20]);
    });

    it('a review backlog above the limit: today\'s 20, and the rest waiting after it', async () => {
      await inReview(big, -MIN);
      const { counted, listed, opened } = await dueThreeWays(BIG);
      expect(counted).toMatchObject({ reviews: 20, newCards: 0, total: 20, reviewsBeyondLimit: 5 });
      expect(listed).toMatchObject({ dueCount: 20, reviewsBeyondLimit: 5 });
      expect(opened).toHaveLength(20);
    });

    it('a reversible deck with the forward cards done: the reverse ones are new', async () => {
      await inReview(both, 3 * DAY);
      const { counted, listed, opened } = await dueThreeWays(BOTH);
      expect(counted).toMatchObject({ newCards: 5, total: 5 });
      expect([listed?.dueCount, opened.length]).toEqual([5, 5]);
      expect(opened.every((c) => c.direction === 1)).toBe(true);
    });

    it('a deck smaller than the limit, and a card state left in a direction the deck no longer has', async () => {
      // Unit 1 was reversible once: a reverse review due now is not in Study, nor in the count.
      await testDb.insert(schema.cardStates).values({ cardId: 10, userId: 1, direction: 1, state: 2, reps: 2, nextReview: new Date(Date.now() - MIN) });
      const { counted, listed, opened } = await dueThreeWays(1);
      expect([counted?.total, listed?.dueCount, opened.length]).toEqual([5, 5, 5]);
    });

    it('a mini-deck: its own cards, its limits counted within the selection', async () => {
      await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 5, reviewsPerDay: 20 });
      // The first eight cards of Unit 3 (100-107).
      await testDb.insert(schema.virtualDecks).values({ id: 9, name: 'First eight', userId: 1, sourceDeckId: BIG, cardSelection: '1-8' });
      const { dueTodayByDeck } = await load();
      const { mini, cards } = await callers();
      const selection = big.slice(0, 8);
      const threeWays = async () => [
        dueTodayByDeck(1, [BIG], PDT, new Date(), selection).get(BIG)?.total,
        (await mini.get({ id: 9, timezoneOffsetMinutes: PDT })).dueCount,
        (await mini.getDueCards({ virtualDeckId: 9, timezoneOffsetMinutes: PDT })).length,
      ];
      expect(await threeWays()).toEqual([5, 5, 5]);
      // Two of its cards rated today (Easy: straight to review), and one of the deck's outside it.
      const opened = await mini.getDueCards({ virtualDeckId: 9, timezoneOffsetMinutes: PDT });
      for (const card of opened.slice(0, 2)) await cards.review({ cardStateId: card.state.id, rating: 4, timeSpentMs: 2000 });
      const [outside] = await testDb.insert(schema.cardStates).values({ cardId: 124, userId: 1, state: 0 }).returning();
      await cards.review({ cardStateId: outside.id, rating: 4, timeSpentMs: 2000 });
      expect(await threeWays()).toEqual([3, 3, 3]);
      expect(dueTodayByDeck(1, [BIG], PDT, new Date(), []).get(BIG)?.total).toBe(0);
    });

    it('Your Progress counts each rating\'s time up to RATING_TIME_CAP_MS, and only cards started', async () => {
      const { RATING_TIME_CAP_MS } = await import('./flashcardDay.js');
      await testDb.insert(schema.cardStates).values([
        { cardId: 10, userId: 1, state: 2, reps: 2, nextReview: new Date(Date.now() + DAY) },
        { cardId: 11, userId: 1, state: 0 },
      ]);
      await testDb.insert(schema.reviewLogs).values([
        { ...rating(10, 0, new Date(Date.now() - DAY)), timeSpentMs: 6_000 },
        { ...rating(10, 1, new Date(Date.now() - DAY)), timeSpentMs: 5 * 60 * 60 * 1000 },
      ]);
      const { getUserStats } = await import('./fsrs.js');
      expect(await getUserStats(1, PDT)).toMatchObject({ totalCards: 1, totalTimeSpentMs: 6_000 + RATING_TIME_CAP_MS });
    });

    it('reads many decks at once, and leaves out a deck that does not exist', async () => {
      const { dueTodayByDeck } = await load();
      const all = dueTodayByDeck(1, [1, 2, BIG, BOTH, 99], PDT, NOW);
      expect([...all.keys()].sort()).toEqual([1, 2, BIG, BOTH]);
      expect([1, 2, BIG, BOTH].map((id) => all.get(id)?.total)).toEqual([5, 1, 20, 10]);
      expect(dueTodayByDeck(1, [], PDT, NOW).size).toBe(0);
    });

    it('reads only the deck\'s own card states, by card, not every state the student has (it runs at each review that could end the day)', async () => {
      const { dueTodayByDeck, inLearning } = await load();
      // The statements the two reads prepare, planned as SQLite would run them.
      const prepared: string[] = [];
      const prepare = sqlite.prepare.bind(sqlite);
      const spy = vi.spyOn(sqlite, 'prepare').mockImplementation(((text: string) => {
        prepared.push(text);
        return prepare(text);
      }) as typeof sqlite.prepare);
      try {
        inLearning(1, BIG);
        dueTodayByDeck(1, [BIG], PDT, NOW);
      } finally {
        spy.mockRestore();
      }
      const stateReads = prepared.filter((text) => /from "card_states"/.test(text));
      expect(stateReads).toHaveLength(2);
      for (const text of stateReads) {
        const params = Array((text.match(/\?/g) ?? []).length).fill(1);
        const plan = (prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params) as { detail: string }[]).map((row) => row.detail);
        expect(plan.find((step) => /card_states/.test(step))).toMatch(/user_id=\? AND card_id=\?/);
      }
    });
  });
});
