// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('deckAccess service', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'user-1',
      email: 'user1@example.com',
      name: 'User One',
    });

    await testDb.insert(schema.users).values({
      id: 2,
      googleId: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
    });

    await testDb.insert(schema.groups).values([
      { id: 1, name: 'Group A' },
      { id: 2, name: 'Group B' },
    ]);

    await testDb.insert(schema.userGroups).values([
      { userId: 1, groupId: 1 },
      { userId: 1, groupId: 2 },
    ]);

    await testDb.insert(schema.decks).values([
      { id: 1, name: 'Deck One', createdBy: 1 },
      { id: 2, name: 'Deck Two', createdBy: 1 },
    ]);

    await testDb.insert(schema.deckGroups).values([
      { groupId: 1, deckId: 1 },
      { groupId: 2, deckId: 1 },
      { groupId: 2, deckId: 2 },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('getUserDeckIds returns distinct deck ids across all user groups', async () => {
    const { getUserDeckIds } = await import('./deckAccess.js');
    const deckIds = await getUserDeckIds(1);

    expect(deckIds.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('hasDeckAccess returns true only when user has a linked group/deck mapping', async () => {
    const { hasDeckAccess } = await import('./deckAccess.js');

    await expect(hasDeckAccess(1, 1)).resolves.toBe(true);
    await expect(hasDeckAccess(1, 2)).resolves.toBe(true);
    await expect(hasDeckAccess(2, 1)).resolves.toBe(false);
  });

  it('assertDeckAccess throws FORBIDDEN with appCode when access is denied', async () => {
    const { assertDeckAccess } = await import('./deckAccess.js');

    let thrown: unknown;
    try {
      await assertDeckAccess(2, 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('FORBIDDEN');
    expect((thrown as TRPCError).cause).toMatchObject({ appCode: 'DECK_ACCESS_DENIED' });
  });

  it('userDecksNewestFirst lists each deck of the user\'s groups once, newest unit first (Study all\'s order)', async () => {
    const { userDecksNewestFirst } = await import('./deckAccess.js');
    // Unit 3 imported after Units 1 and 2; Deck 4 in the same second as Unit 3 (the id breaks the tie); Deck 5 not theirs.
    await testDb.insert(schema.decks).values([
      { id: 3, name: 'Unit 3', createdBy: 1, createdAt: new Date('2026-10-08T16:00:00Z') },
      { id: 4, name: 'Unit 3b', createdBy: 1, createdAt: new Date('2026-10-08T16:00:00Z') },
      { id: 5, name: 'Other', createdBy: 1, createdAt: new Date('2026-10-09T16:00:00Z') },
    ]);
    await testDb.update(schema.decks).set({ createdAt: new Date('2026-08-12T16:00:00Z') }).where(eq(schema.decks.id, 1));
    await testDb.update(schema.decks).set({ createdAt: new Date('2026-09-10T16:00:00Z') }).where(eq(schema.decks.id, 2));
    await testDb.insert(schema.deckGroups).values([{ groupId: 1, deckId: 3 }, { groupId: 2, deckId: 3 }, { groupId: 2, deckId: 4 }]);

    expect(userDecksNewestFirst(1).map((d) => d.id)).toEqual([4, 3, 2, 1]);
    expect(userDecksNewestFirst(1)[1]).toEqual({ id: 3, name: 'Unit 3', createdAt: new Date('2026-10-08T16:00:00Z') });
    expect(userDecksNewestFirst(2)).toEqual([]);
  });
});

