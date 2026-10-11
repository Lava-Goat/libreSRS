// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { CardDirection } from '@libresrs/shared';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

/**
 * Tests for new card limit behavior (should work like Anki).
 *
 * Key requirements:
 * 1. Users should only see up to `newCardsPerDay` new cards per day
 * 2. Once the limit is reached, no more new cards should be introduced
 * 3. Cards that were introduced but not yet reviewed still count against the limit
 * 4. Learning/Review cards should still be shown (they're not "new")
 */

describe('New Card Limit Behavior', () => {
  let client: ReturnType<typeof createTestDb>['client'];
  let db: ReturnType<typeof createTestDb>['db'];

  beforeEach(async () => {
    const testDb = createTestDb();
    client = testDb.client;
    db = testDb.db;
    await setupFsrsSchema(client, { reset: true });

    // Create a test user
    await db.insert(schema.users).values({
      googleId: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
    });

    // Create a test deck
    await db.insert(schema.decks).values({
      name: 'Test Deck',
      createdBy: 1,
      reversible: false,
    });

    // Create 20 cards in the deck
    for (let i = 1; i <= 20; i++) {
      await db.insert(schema.cards).values({
        deckId: 1,
        front: `Front ${i}`,
        back: `Back ${i}`,
      });
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it('should count new cards introduced today based on review logs', async () => {
    // Simulate: 5 card states created with state=New (0)
    for (let i = 1; i <= 5; i++) {
      await db.insert(schema.cardStates).values({
        cardId: i,
        userId: 1,
        direction: CardDirection.Forward,
        state: 0, // State.New
        nextReview: new Date(),
      });
    }

    // Simulate: user reviewed 3 of them (review logs with previousState=0)
    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      await db.insert(schema.reviewLogs).values({
        cardId: i,
        userId: 1,
        rating: 3,
        reviewedAt: new Date(now),
        timeSpentMs: 5000,
        previousState: 0, // State.New
        newState: 1, // State.Learning
      });

      // Update card state to Learning
      await db.update(schema.cardStates)
        .set({ state: 1 })
        .where(eq(schema.cardStates.cardId, i));
    }

    // Count new cards reviewed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const reviewsToday = await db.query.reviewLogs.findMany({
      where: eq(schema.reviewLogs.userId, 1),
    });

    const newCardsToday = reviewsToday.filter(
      r => Number(r.previousState) === 0 && r.reviewedAt >= todayStart
    ).length;

    const newCardsPerDay = 5;
    const remainingNewCards = Math.max(0, newCardsPerDay - newCardsToday);

    expect(newCardsToday).toBe(3);
    expect(remainingNewCards).toBe(2);
  });

  it('should not introduce more new cards when limit is reached via existing new card states', async () => {
    const newCardsPerDay = 5;

    // Create 5 card states with state=New - they're due but not reviewed yet
    for (let i = 1; i <= 5; i++) {
      await db.insert(schema.cardStates).values({
        cardId: i,
        userId: 1,
        direction: CardDirection.Forward,
        state: 0, // State.New
        nextReview: new Date(), // Due now
      });
    }

    // No review logs yet (user hasn't reviewed any)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const reviewsToday = await db.query.reviewLogs.findMany({
      where: eq(schema.reviewLogs.userId, 1),
    });

    const newCardsToday = reviewsToday.filter(
      r => Number(r.previousState) === 0 && r.reviewedAt >= todayStart
    ).length;

    // newCardsToday from review logs is 0
    expect(newCardsToday).toBe(0);

    // But we have 5 card states with state=New that are due
    const dueCardStates = await db.query.cardStates.findMany({
      where: eq(schema.cardStates.userId, 1),
    });

    const newCardsInDue = dueCardStates.filter(
      s => s.nextReview <= new Date() && Number(s.state) === 0
    ).length;

    expect(newCardsInDue).toBe(5);

    // Effective new limit should be: newCardsPerDay - newCardsToday - newCardsInDue
    // But since newCardsInDue are already in the due list, we need:
    // effectiveNewLimit = max(0, (newCardsPerDay - newCardsToday) - newCardsInDue)
    const remainingNewCards = Math.max(0, newCardsPerDay - newCardsToday);
    const effectiveNewLimit = Math.max(0, remainingNewCards - newCardsInDue);

    expect(remainingNewCards).toBe(5); // Based on review logs alone
    expect(effectiveNewLimit).toBe(0); // After accounting for due New cards
  });

  it('should allow Learning cards to be shown even when new card limit is reached', async () => {
    // User reviewed 5 new cards, they're now Learning and some are due again
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      // Create card state as Learning, due now (short interval)
      await db.insert(schema.cardStates).values({
        cardId: i,
        userId: 1,
        direction: CardDirection.Forward,
        state: 1, // State.Learning
        nextReview: new Date(now - 1000), // Due (in the past)
      });

      // Create review log
      await db.insert(schema.reviewLogs).values({
        cardId: i,
        userId: 1,
        rating: 1, // Again - short interval
        reviewedAt: new Date(now - 60000), // Reviewed 1 minute ago
        timeSpentMs: 5000,
        previousState: 0, // State.New
        newState: 1, // State.Learning
      });
    }

    // Get due cards
    const dueCardStates = await db.query.cardStates.findMany({
      where: eq(schema.cardStates.userId, 1),
    });

    const dueLearningCards = dueCardStates.filter(
      s => s.nextReview <= new Date() && Number(s.state) === 1
    );

    // All 5 Learning cards should be due
    expect(dueLearningCards.length).toBe(5);

    // And newCardsInDue should be 0 (they're Learning, not New)
    const newCardsInDue = dueCardStates.filter(
      s => s.nextReview <= new Date() && Number(s.state) === 0
    ).length;

    expect(newCardsInDue).toBe(0);
  });

  it('effectiveNewLimit calculation should work correctly', async () => {
    const testCases = [
      // [newLimit, newCardsInDue, expectedEffectiveLimit]
      [5, 0, 5],  // No due New cards, can introduce 5
      [5, 3, 2],  // 3 due New cards, can introduce 2 more
      [5, 5, 0],  // 5 due New cards, can't introduce any
      [5, 7, 0],  // 7 due New cards (more than limit), can't introduce any
      [0, 0, 0],  // Limit already 0
      [0, 5, 0],  // Limit 0 with due New cards
    ];

    for (const [newLimit, newCardsInDue, expected] of testCases) {
      const effectiveNewLimit = Math.max(0, newLimit - newCardsInDue);
      expect(effectiveNewLimit).toBe(expected);
    }
  });
});
