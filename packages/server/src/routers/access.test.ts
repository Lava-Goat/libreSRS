// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const unauthorizedUser = {
  id: 1,
  googleId: 'user-1',
  email: 'user1@example.com',
  name: 'User One',
  picture: null,
  role: 'user' as const,
};

async function expectForbidden(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('Expected FORBIDDEN error');
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('FORBIDDEN');
  }
}

describe('deck access guards', () => {
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
    });

    await testDb.insert(schema.userGroups).values({
      userId: 2,
      groupId: 1,
    });

    await testDb.insert(schema.decks).values({
      id: 1,
      name: 'Restricted Deck',
      createdBy: 2,
      reversible: false,
    });

    await testDb.insert(schema.deckGroups).values({
      deckId: 1,
      groupId: 1,
    });

    await testDb.insert(schema.cards).values({
      id: 1,
      deckId: 1,
      front: 'Front',
      back: 'Back',
    });
  });

  it('blocks cards.getDueCards for inaccessible decks', async () => {
    const { cardsRouter } = await import('./cards.js');
    const caller = cardsRouter.createCaller({
      req: { user: unauthorizedUser } as Request,
      res: {} as Response,
      user: unauthorizedUser,
    });

    await expectForbidden(caller.getDueCards({ deckId: 1 }));
  });

  it('blocks cards.getDeckProgress for inaccessible decks', async () => {
    const { cardsRouter } = await import('./cards.js');
    const caller = cardsRouter.createCaller({
      req: { user: unauthorizedUser } as Request,
      res: {} as Response,
      user: unauthorizedUser,
    });

    await expectForbidden(caller.getDeckProgress({ deckId: 1 }));
  });

  it('blocks settings.getDeckSettings for inaccessible decks', async () => {
    const { settingsRouter } = await import('./settings.js');
    const caller = settingsRouter.createCaller({
      req: { user: unauthorizedUser } as Request,
      res: {} as Response,
      user: unauthorizedUser,
    });

    await expectForbidden(caller.getDeckSettings({ deckId: 1 }));
  });

  it('blocks virtualDecks.validateSelection for inaccessible decks', async () => {
    const { virtualDecksRouter } = await import('./virtualDecks.js');
    const caller = virtualDecksRouter.createCaller({
      req: { user: unauthorizedUser } as Request,
      res: {} as Response,
      user: unauthorizedUser,
    });

    await expectForbidden(
      caller.validateSelection({
        sourceDeckId: 1,
        cardSelection: '1-10',
      })
    );
  });

  it('blocks virtualDecks.getSourceDeckCards for inaccessible decks', async () => {
    const { virtualDecksRouter } = await import('./virtualDecks.js');
    const caller = virtualDecksRouter.createCaller({
      req: { user: unauthorizedUser } as Request,
      res: {} as Response,
      user: unauthorizedUser,
    });

    await expectForbidden(caller.getSourceDeckCards({ deckId: 1 }));
  });
});
