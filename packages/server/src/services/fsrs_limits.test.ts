// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as schema from '../db/schema.js';
import type { CardWithState, DueCardOptions } from './fsrs.js';
import { CardDirection } from '@libresrs/shared';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

// Create test DB instance
const { client, db: testDb } = createTestDb();

describe('getDueCards Limit Handling', () => {
  const userId = 1;
  const deckId = 1;
  let getDueCards: (userId: number, deckId: number, options: DueCardOptions) => Promise<CardWithState[]>;

  beforeEach(async () => {
    vi.resetModules();
    
    // Mock the db module
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema: schema,
    }));

    // Import the function under test
    const fsrs = await import('./fsrs.js');
    getDueCards = fsrs.getDueCards;

    await setupFsrsSchema(client, { reset: true });

    // Create a test user
    await testDb.insert(schema.users).values({
      googleId: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
    });

    // Create a test deck
    await testDb.insert(schema.decks).values({
      name: 'Test Deck',
      createdBy: userId,
      reversible: false,
    });
  });

  it('should respect reviewLimit when fetching due cards', async () => {
    // Create 10 cards that are reviewed and due (state != New)
    for (let i = 1; i <= 10; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Review ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 2, // Review (State.Review = 2)
        nextReview: new Date(Date.now() - 10000), // Due in the past
      });
    }

    // Call getDueCards with reviewLimit=5
    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 10,
      reviewLimit: 5
    });

    // Should return only 5 cards
    expect(result.length).toBe(5);
    // All should be review cards
    expect(result.every((c: CardWithState) => Number(c.state.state) === 2)).toBe(true);
  });

  it('should respect newLimit when fetching implicit new cards', async () => {
    // Create 10 fresh cards (no state)
    for (let i = 1; i <= 10; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `New ${i}`,
        back: `Back ${i}`,
      });
    }

    // Call getDueCards with newLimit=5
    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 5,
      reviewLimit: 100
    });

    expect(result.length).toBe(5);
    // All should be new cards
    expect(result.every((c: CardWithState) => Number(c.state.state) === 0)).toBe(true);
  });

  it('should not limit learning cards by reviewLimit', async () => {
    // Create 10 learning cards due
    for (let i = 1; i <= 10; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Learning ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 1, // Learning
        nextReview: new Date(Date.now() - 10000),
      });
    }

    // Call getDueCards with reviewLimit=5, but limit=100
    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 10,
      reviewLimit: 5
    });

    // Should return ALL 10 cards because Learning cards ignore reviewLimit
    expect(result.length).toBe(10);
    expect(result.every((c: CardWithState) => Number(c.state.state) === 1)).toBe(true);
  });

  it('should respect both limits simultaneously', async () => {
    // Create 10 reviews due
    for (let i = 1; i <= 10; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Review ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 2, // Review (State 2)
        nextReview: new Date(Date.now() - 10000),
      });
    }

    // Create 10 new cards
    for (let i = 11; i <= 20; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `New ${i}`,
        back: `Back ${i}`,
      });
    }

    // Limit reviews to 3, new to 4. Total limit high.
    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 4,
      reviewLimit: 3
    });

    const reviews = result.filter((c: CardWithState) => Number(c.state.state) !== 0);
    const newCards = result.filter((c: CardWithState) => Number(c.state.state) === 0);

    expect(reviews.length).toBe(3);
    expect(newCards.length).toBe(4);
    expect(result.length).toBe(7);
  });

  it('should respect total limit even if sub-limits are higher', async () => {
    // 5 reviews due
    for (let i = 1; i <= 5; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Review ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 1,
        nextReview: new Date(Date.now() - 10000),
      });
    }
    // 5 new cards
    for (let i = 6; i <= 10; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `New ${i}`,
        back: `Back ${i}`,
      });
    }
    
    // limit=3
    const result = await getDueCards(userId, deckId, {
      limit: 3,
      newLimit: 10,
      reviewLimit: 10
    });

    expect(result.length).toBe(3);
    const reviews = result.filter((c: CardWithState) => Number(c.state.state) !== 0);
    // Since review loop runs first, it should pick reviews
    expect(reviews.length).toBe(3);
  });

  it('should return pre-initialized new cards (state=New with existing card_states row)', async () => {
    // This is a regression test: cards that already have a card_states row
    // with state=0 (New) were previously invisible — getNewCards only looked
    // for cards with NO card_states row, and getReviewCards excluded state=New.
    for (let i = 1; i <= 5; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `PreInit ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 0, // State.New
        nextReview: new Date(Date.now() - 10000), // Due
      });
    }

    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 10,
      reviewLimit: 100,
    });

    expect(result.length).toBe(5);
    expect(result.every((c: CardWithState) => Number(c.state.state) === 0)).toBe(true);
  });

  it('should return mix of pre-initialized new cards and truly unseen cards', async () => {
    // 3 pre-initialized new cards (have card_states with state=New)
    for (let i = 1; i <= 3; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `PreInit ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 0,
        nextReview: new Date(Date.now() - 10000),
      });
    }

    // 3 truly unseen cards (no card_states row)
    for (let i = 4; i <= 6; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Unseen ${i}`,
        back: `Back ${i}`,
      });
    }

    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 10,
      reviewLimit: 100,
    });

    expect(result.length).toBe(6);
    expect(result.every((c: CardWithState) => Number(c.state.state) === 0)).toBe(true);
  });

  it('should prioritize learning cards over review cards when limited', async () => {
    // Create 2 learning cards due
    for (let i = 1; i <= 2; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Learning ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 1, // Learning
        nextReview: new Date(Date.now() - 10000),
      });
    }

    // Create 2 review cards due
    for (let i = 3; i <= 4; i++) {
      await testDb.insert(schema.cards).values({
        deckId,
        front: `Review ${i}`,
        back: `Back ${i}`,
      });
      await testDb.insert(schema.cardStates).values({
        cardId: i,
        userId,
        direction: CardDirection.Forward,
        state: 2, // Review
        nextReview: new Date(Date.now() - 10000),
      });
    }

    const result = await getDueCards(userId, deckId, {
      limit: 2,
      newLimit: 10,
      reviewLimit: 10,
    });

    expect(result.length).toBe(2);
    expect(result.every((c: CardWithState) => Number(c.state.state) === 1)).toBe(true);
  });

  it('should use consistent timestamp units between writes and queries', async () => {
    // Regression test: Drizzle mode:'timestamp' stores as Unix seconds.
    // Verify that dates written via Drizzle can be correctly queried back
    // with Date comparisons (gte/lte).
    const now = new Date();
    const pastDate = new Date(now.getTime() - 3600_000); // 1 hour ago

    // Insert a card with a review log at a known time
    await testDb.insert(schema.cards).values({
      deckId,
      front: 'Timestamp Test',
      back: 'Back',
    });
    await testDb.insert(schema.cardStates).values({
      cardId: 1,
      userId,
      direction: CardDirection.Forward,
      state: 2,
      nextReview: pastDate,
    });
    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      cardStateId: 1,
      userId,
      rating: 3,
      reviewedAt: now,
      timeSpentMs: 5000,
      previousState: 0,
      newState: 2,
    });

    // Read back the raw value from SQLite and confirm it's in seconds
    const rawRows = await client.execute('SELECT reviewed_at FROM review_logs WHERE id = 1');
    const rawValue = Number(rawRows.rows[0].reviewed_at);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    // The stored value should be close to Unix seconds (not milliseconds)
    expect(rawValue).toBeGreaterThan(1_000_000_000); // > year 2001 in seconds
    expect(rawValue).toBeLessThan(100_000_000_000); // < year 5000 in seconds (not ms)
    expect(Math.abs(rawValue - nowSeconds)).toBeLessThanOrEqual(1);

    // Verify next_review is also in seconds
    const rawStates = await client.execute('SELECT next_review FROM card_states WHERE id = 1');
    const rawNextReview = Number(rawStates.rows[0].next_review);
    const pastSeconds = Math.floor(pastDate.getTime() / 1000);
    expect(Math.abs(rawNextReview - pastSeconds)).toBeLessThanOrEqual(1);

    // Now verify that getDueCards can find the card using Date-based queries
    const result = await getDueCards(userId, deckId, {
      limit: 100,
      newLimit: 10,
      reviewLimit: 100,
    });
    expect(result.length).toBe(1);
    expect(result[0].card.front).toBe('Timestamp Test');
  });
});
