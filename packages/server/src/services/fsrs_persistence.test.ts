// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Regression tests for the better-sqlite3 sync-transaction conversion: drizzle
// sync builders are LAZY, so an un-.run() statement inside db.transaction
// silently does nothing. These tests verify PERSISTED state (re-read from the
// database), not just returned values — the gap that let the bug pass CI.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('review persistence (sync transactions actually write)', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values({
      id: 1, googleId: 'u1', email: 'u1@example.com', name: 'U1', role: 'user',
    });
    await testDb.insert(schema.decks).values({ id: 1, name: 'D', createdBy: 1, reversible: false });
    await testDb.insert(schema.cards).values({ id: 1, deckId: 1, front: 'hola', back: 'hello' });
    await testDb.insert(schema.cardStates).values({
      id: 10, cardId: 1, userId: 1, direction: 0,
      stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0,
      nextReview: new Date(),
    });
  });

  it('reviewCard persists the new FSRS state AND the review log', async () => {
    const fsrs = await import('./fsrs.js');
    const { reviewLogId } = await fsrs.reviewCard(10, 1, 3, 1200);
    expect(reviewLogId).toBeGreaterThan(0);

    // Re-read from the DB — the returned result alone cannot prove persistence.
    const persisted = await testDb.query.cardStates.findFirst({
      where: eq(schema.cardStates.id, 10),
    });
    expect(persisted).toBeTruthy();
    expect(persisted!.reps).toBe(1);
    expect(persisted!.stability).toBeGreaterThan(0);
    expect(persisted!.state).not.toBe(0);
    expect(persisted!.lastReview).not.toBeNull();

    const log = await testDb.query.reviewLogs.findFirst({
      where: eq(schema.reviewLogs.id, reviewLogId),
    });
    expect(log).toBeTruthy();
    expect(log!.rating).toBe(3);
  });

  it('undoReview restores the snapshotted card state and deletes the log', async () => {
    const fsrs = await import('./fsrs.js');
    const { reviewLogId } = await fsrs.reviewCard(10, 1, 3, 900);

    const afterReview = await testDb.query.cardStates.findFirst({
      where: eq(schema.cardStates.id, 10),
    });
    expect(afterReview!.reps).toBe(1);

    await fsrs.undoReview(reviewLogId, 1);

    const restored = await testDb.query.cardStates.findFirst({
      where: eq(schema.cardStates.id, 10),
    });
    // Back to the pre-review snapshot — the exact write the lazy-builder bug dropped.
    expect(restored!.reps).toBe(0);
    expect(restored!.stability).toBe(0);
    expect(restored!.state).toBe(0);

    const log = await testDb.query.reviewLogs.findFirst({
      where: eq(schema.reviewLogs.id, reviewLogId),
    });
    expect(log).toBeUndefined();
  });
});
