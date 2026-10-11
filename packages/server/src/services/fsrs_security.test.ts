// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('reviewCard security', () => {
  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    // Do NOT mock userSettings — let it resolve from the real module

    await setupFsrsSchema(client, { reset: true });

    // Two users
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'user-1', email: 'user1@example.com', name: 'User One' },
      { id: 2, googleId: 'user-2', email: 'user2@example.com', name: 'User Two' },
    ]);

    // A deck and a card owned by user 1's group
    await testDb.insert(schema.decks).values({
      id: 1,
      name: 'Deck 1',
      createdBy: 1,
      reversible: false,
    });

    await testDb.insert(schema.cards).values({
      id: 1,
      deckId: 1,
      front: 'Front',
      back: 'Back',
    });

    // card_states row belonging to user 1
    await testDb.insert(schema.cardStates).values({
      id: 10,
      cardId: 1,
      userId: 1,
      direction: 0,
      stability: 2.5,
      difficulty: 5.0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 1,
      lapses: 0,
      state: 2, // Review
      lastReview: new Date(Date.now() - 24 * 60 * 60 * 1000),
      nextReview: new Date(Date.now() - 60 * 1000),
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('throws "Card state not found" when userId does not own the cardState', async () => {
    const { reviewCard } = await import('./fsrs.js');

    // user 2 tries to review a card state that belongs to user 1
    await expect(
      reviewCard(10, 2, 3, 500)
    ).rejects.toThrow('Card state not found');
  });

  it('succeeds when userId owns the cardState', async () => {
    const { reviewCard } = await import('./fsrs.js');

    // user 1 reviews their own card state — should not throw
    const result = await reviewCard(10, 1, 3, 500);
    expect(result).toHaveProperty('reviewLogId');
    expect(result.reviewLogId).toBeGreaterThan(0);
  });

  it('does not modify a card state row when userId does not match', async () => {
    const { reviewCard } = await import('./fsrs.js');

    const before = await testDb.query.cardStates.findFirst({
      where: eq(schema.cardStates.id, 10),
    });

    // Attempt by user 2 should throw — and must not have mutated the row
    await expect(reviewCard(10, 2, 3, 500)).rejects.toThrow('Card state not found');

    const after = await testDb.query.cardStates.findFirst({
      where: eq(schema.cardStates.id, 10),
    });

    expect(after).toEqual(before);
  });
});
