// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const imageCalls: { cardId: number; userId: number }[] = [];

const admin = { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
/** A student in no group that has the deck. */
const otro = { id: 3, googleId: 'g-otro', email: 'otro@example.com', name: 'Otro', picture: null, role: 'user' as const };
type AnyUser = typeof admin | typeof ana;

const CARD = 10;

async function load() {
  const { aiRouter } = await import('./ai.js');
  const callerFor = (user: AnyUser) => aiRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return { teacher: callerFor(admin), ana: callerFor(ana), otro: callerFor(otro) };
}

const imageRows = () => testDb.query.aiAssets.findMany({ where: (a, { eq }) => eq(a.assetType, 'image') });

describe('card pictures: removing one is the teacher’s, making one is unchanged (v1.20.0)', () => {
  afterAll(async () => { await client.close(); });

  beforeEach(async () => {
    vi.resetModules();
    imageCalls.length = 0;
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/ai/imageService.js', () => ({
      generateImage: async (cardId: number, userId: number) => {
        imageCalls.push({ cardId, userId });
        return { imageUrl: '/api/assets/new.png', status: 'ready' as const };
      },
    }));
    vi.doMock('../services/ai/pronunciationService.js', () => ({
      generatePronunciation: async (cardId: number, userId: number) => {
        imageCalls.push({ cardId, userId });
        return { audioUrl: '/api/assets/new.mp3', status: 'ready' as const };
      },
    }));
    vi.doMock('../services/ai/scanService.js', () => ({
      scanDeck: async (deckId: number, userId: number) => {
        imageCalls.push({ cardId: -deckId, userId });
      },
      getScanProgress: () => null,
    }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-otro', email: 'otro@example.com', name: 'Otro', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([{ id: 1, name: 'P1' }, { id: 2, name: 'P2' }]);
    await testDb.insert(schema.userGroups).values([{ userId: 1, groupId: 1 }, { userId: 2, groupId: 1 }, { userId: 3, groupId: 2 }]);
    await testDb.insert(schema.decks).values({ id: 5, name: 'U1', createdBy: 1 });
    await testDb.insert(schema.deckGroups).values({ deckId: 5, groupId: 1 });
    await testDb.insert(schema.cards).values({ id: CARD, deckId: 5, front: 'perro', back: 'dog' });
    await testDb.insert(schema.aiAssets).values({
      cardId: CARD, assetType: 'image', provider: 'openai', prompt: 'dog', url: '/api/assets/dog.png', status: 'ready',
    });
  });

  it('refuses a student who studies the deck, and the picture stays for the class', async () => {
    const api = await load();

    await expect(api.ana.removeImage({ cardId: CARD })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await imageRows()).toHaveLength(1);
    expect((await api.ana.getCardAssets({ cardId: CARD })).image?.url).toBe('/api/assets/dog.png');
  });

  it('refuses a student without the deck too', async () => {
    const api = await load();
    await expect(api.otro.removeImage({ cardId: CARD })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await imageRows()).toHaveLength(1);
  });

  it('lets the teacher remove it, for every student', async () => {
    const api = await load();

    await expect(api.teacher.removeImage({ cardId: CARD })).resolves.toEqual({ success: true });

    expect(await imageRows()).toEqual([]);
    expect((await api.ana.getCardAssets({ cardId: CARD })).image).toBeNull();
  });

  it('removes only pictures: the card’s audio stays', async () => {
    const api = await load();
    await testDb.insert(schema.aiAssets).values({
      cardId: CARD, assetType: 'audio', provider: 'openai', prompt: 'perro', url: '/api/assets/perro.opus', status: 'ready',
    });

    await api.teacher.removeImage({ cardId: CARD });

    expect((await testDb.query.aiAssets.findMany()).map((a) => a.assetType)).toEqual(['audio']);
  });

  it('answers NOT_FOUND for a card that does not exist', async () => {
    const api = await load();
    await expect(api.teacher.removeImage({ cardId: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still lets a student with the deck make a picture, as before', async () => {
    const api = await load();

    await expect(api.ana.generateImage({ cardId: CARD })).resolves.toEqual({ imageUrl: '/api/assets/new.png', status: 'ready' });

    expect(imageCalls).toEqual([{ cardId: CARD, userId: ana.id }]);
  });

  it('still refuses a picture to a student without the deck', async () => {
    const api = await load();
    await expect(api.otro.generateImage({ cardId: CARD })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(imageCalls).toEqual([]);
  });

  // Pronunciation audio, pictures and the whole-deck scan are for any signed-in user with access
  // to the deck. The router checks the deck before the service runs.
  it('refuses pronunciation audio and a whole-deck scan to a student without the deck', async () => {
    const api = await load();
    await expect(api.otro.generatePronunciation({ cardId: CARD, side: 'back' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.otro.scanDeck({ deckId: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(imageCalls).toEqual([]);
    await expect(api.ana.generatePronunciation({ cardId: CARD, side: 'back' })).resolves.toMatchObject({ audioUrl: '/api/assets/new.mp3' });
    await api.ana.scanDeck({ deckId: 5 });
    expect(imageCalls).toEqual([{ cardId: CARD, userId: ana.id }, { cardId: -5, userId: ana.id }]);
  });
});
