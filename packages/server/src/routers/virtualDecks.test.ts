// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('virtual deck deck-size validation', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'user-google-id',
      email: 'user@example.com',
      name: 'User',
      role: 'user',
    });

    await testDb.insert(schema.groups).values({
      id: 1,
      name: 'Learners',
      description: 'Test group',
    });

    await testDb.insert(schema.userGroups).values({
      userId: 1,
      groupId: 1,
    });

    await testDb.insert(schema.decks).values({
      id: 1,
      name: 'Deck A',
      createdBy: 1,
      reversible: false,
    });

    await testDb.insert(schema.deckGroups).values({
      deckId: 1,
      groupId: 1,
    });

    const cards = Array.from({ length: 34 }, (_, index) => ({
      deckId: 1,
      front: `Front ${index + 1}`,
      back: `Back ${index + 1}`,
    }));
    await testDb.insert(schema.cards).values(cards);
  });

  it('reports out-of-bounds indices instead of generic deck-size wording', async () => {
    const { virtualDecksRouter } = await import('./virtualDecks.js');

    const authedUser = {
      id: 1,
      googleId: 'user-google-id',
      email: 'user@example.com',
      name: 'User',
      picture: null,
      role: 'user' as const,
    };

    const caller = virtualDecksRouter.createCaller({
      req: { user: authedUser } as Request,
      res: {} as Response,
      user: authedUser,
    });

    const validation = await caller.validateSelection({
      sourceDeckId: 1,
      cardSelection: '11-35',
    });

    expect(validation.valid).toBe(false);
    expect(validation.totalCardsInDeck).toBe(34);
    expect(validation.invalidIndices).toEqual([35]);
    expect(validation.error).toContain('out of bounds');

    await expect(
      caller.create({
        name: 'Subset',
        sourceDeckId: 1,
        cardSelection: '11-35',
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('out of bounds'),
    });
  });
});
