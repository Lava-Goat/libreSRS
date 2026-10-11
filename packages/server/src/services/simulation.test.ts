// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as schema from '../db/schema.js';
import { eq, and, gte } from 'drizzle-orm';
import type { DueCardOptions, CardWithState } from './fsrs.js';
import type { SchedulingResult } from '@libresrs/shared';
import { CardDirection } from '@libresrs/shared';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('Simulation: User Session with Limits', () => {
  const userId = 1;
  const deckId = 1;
  const NEW_LIMIT = 5;
  const REVIEW_LIMIT = 10;
  
  let getDueCards: (userId: number, deckId: number, options: DueCardOptions) => Promise<CardWithState[]>;
  let reviewCard: (cardStateId: number, userId: number, rating: number, timeSpentMs: number) => Promise<{ result: SchedulingResult; reviewLogId: number }>;

  beforeEach(async () => {
    vi.resetModules();
    
    // Mock the db module
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema: schema,
    }));

    // Import services after mocking
    const fsrs = await import('./fsrs.js');
    getDueCards = fsrs.getDueCards;
    reviewCard = fsrs.reviewCard;

    await setupFsrsSchema(client, { reset: true });
    
    // Create User
    await testDb.insert(schema.users).values({ id: userId, googleId: 'u1', email: 'e1', name: 'n1' });
    
    // Create Deck
    await testDb.insert(schema.decks).values({ id: deckId, name: 'D1', createdBy: userId, reversible: false });
    
    // Create Settings
    await testDb.insert(schema.deckUserSettings).values({
      userId,
      deckId,
      newCardsPerDay: NEW_LIMIT,
      reviewsPerDay: REVIEW_LIMIT,
    });

    // Create 50 Cards (enough to exceed limits)
    for (let i = 1; i <= 50; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Front ${i}`,
        back: `Back ${i}`,
      });
    }
  });

  it('should stop showing new cards after the limit is reached', async () => {
    // Mimic the logic in cards.ts router
    const simulateGetDueCards = async () => {
      // 1. Get Settings
      const settings = await testDb.query.deckUserSettings.findFirst({
        where: and(eq(schema.deckUserSettings.userId, userId), eq(schema.deckUserSettings.deckId, deckId))
      });
      const newCardsPerDay = settings?.newCardsPerDay ?? 20;
      const reviewsPerDay = settings?.reviewsPerDay ?? 20;

      // 2. Count Reviews Today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      const allReviewsToday = await testDb.query.reviewLogs.findMany({
        where: and(
          eq(schema.reviewLogs.userId, userId),
          gte(schema.reviewLogs.reviewedAt, todayStart)
        )
      });
      
      // Filter for this deck
      const deckCards = await testDb.select().from(schema.cards).where(eq(schema.cards.deckId, deckId));
      const deckCardIds = new Set(deckCards.map(c => c.id));
      const deckReviewsToday = allReviewsToday.filter(r => deckCardIds.has(r.cardId));

      const newCardsToday = deckReviewsToday.filter(r => Number(r.previousState) === 0).length;
      const actualReviewsToday = deckReviewsToday.filter(r => Number(r.previousState) !== 0).length;

      const remainingNewCards = Math.max(0, newCardsPerDay - newCardsToday);
      const remainingReviews = Math.max(0, reviewsPerDay - actualReviewsToday);

      const sessionLimit = 10; // Request batches of 10

      // 3. Call Service
      const cards = await getDueCards(userId, deckId, {
        limit: sessionLimit,
        newLimit: remainingNewCards,
        reviewLimit: remainingReviews
      });

      return { cards, remainingNewCards, remainingReviews, newCardsToday };
    };

    // --- Step 1: First Batch ---
    // Should get 5 New Cards (since limit is 5 and we requested 10)
    let result = await simulateGetDueCards();
    
    expect(result.remainingNewCards).toBe(5);
    expect(result.cards.length).toBe(5); 
    // All should be new (state 0 implicit or explicit)
    expect(result.cards.every((c: CardWithState) => Number(c.state.state) === 0)).toBe(true);

    // --- Step 2: Review them all ---
    // User reviews the 5 cards.
    for (const card of result.cards) {
      await reviewCard(card.state.id, userId, 3, 1000); // Rating 3 (Good)
    }

    // --- Step 3: Second Batch ---
    // Logic: 
    // newCardsToday should be 5.
    // remainingNewCards should be 0.
    // Should return 0 NEW cards.
    
    result = await simulateGetDueCards();
    
    expect(result.newCardsToday).toBe(5);
    expect(result.remainingNewCards).toBe(0);
    
    const newCardsInBatch = result.cards.filter((c: CardWithState) => Number(c.state.state) === 0);
    expect(newCardsInBatch.length).toBe(0);

  });

  it('should reschedule reviewed cards and advance presentation within limits', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-04T10:00:00.000Z');
    vi.setSystemTime(now);

    // Seed 3 due review cards (state != New) and 5 new cards
    for (let i = 1; i <= 3; i++) {
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 2, // Review
        stability: 2.5,
        difficulty: 5,
        elapsedDays: 2,
        scheduledDays: 2,
        reps: 2,
        lapses: 0,
        lastReview: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        nextReview: new Date(now.getTime() - 60000),
      });
    }

    const simulateGetDueCards = async () => {
      const settings = await testDb.query.deckUserSettings.findFirst({
        where: and(eq(schema.deckUserSettings.userId, userId), eq(schema.deckUserSettings.deckId, deckId))
      });
      const newCardsPerDay = settings?.newCardsPerDay ?? 20;
      const reviewsPerDay = settings?.reviewsPerDay ?? 20;

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const allReviewsToday = await testDb.query.reviewLogs.findMany({
        where: and(
          eq(schema.reviewLogs.userId, userId),
          gte(schema.reviewLogs.reviewedAt, todayStart)
        )
      });

      const deckCards = await testDb.select().from(schema.cards).where(eq(schema.cards.deckId, deckId));
      const deckCardIds = new Set(deckCards.map(c => c.id));
      const deckReviewsToday = allReviewsToday.filter(r => deckCardIds.has(r.cardId));

      const newCardsToday = deckReviewsToday.filter(r => Number(r.previousState) === 0).length;
      const actualReviewsToday = deckReviewsToday.filter(r => Number(r.previousState) !== 0).length;

      const remainingNewCards = Math.max(0, newCardsPerDay - newCardsToday);
      const remainingReviews = Math.max(0, reviewsPerDay - actualReviewsToday);
      const sessionLimit = 10;

      const cards = await getDueCards(userId, deckId, {
        limit: sessionLimit,
        newLimit: remainingNewCards,
        reviewLimit: remainingReviews
      });

      return { cards, remainingNewCards, remainingReviews };
    };

    // First batch should include up to limits
    let result = await simulateGetDueCards();
    const firstNew = result.cards.filter((c: CardWithState) => Number(c.state.state) === 0);
    const firstReviews = result.cards.filter((c: CardWithState) => Number(c.state.state) !== 0);
    expect(firstNew.length).toBe(5);
    expect(firstReviews.length).toBe(3);

    // Review cards with different ratings
    for (const card of firstNew) {
      const res = await reviewCard(card.state.id, userId, 3, 1000); // Good
      expect(res.result.nextReview.getTime()).toBeGreaterThan(now.getTime());
    }
    for (const card of firstReviews) {
      const res = await reviewCard(card.state.id, userId, 4, 1000); // Easy
      expect(res.result.nextReview.getTime()).toBeGreaterThan(now.getTime());
    }

    // After using all new cards, next batch should have no new cards
    result = await simulateGetDueCards();
    const secondNew = result.cards.filter((c: CardWithState) => Number(c.state.state) === 0);
    expect(secondNew.length).toBe(0);

    vi.useRealTimers();
  });
});
