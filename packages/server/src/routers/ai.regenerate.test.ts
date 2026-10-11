// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const originalEnv = process.env;

const adminUser = {
  id: 1,
  googleId: 'admin',
  email: 'admin@example.com',
  name: 'Admin',
  picture: null,
  role: 'admin' as const,
};

async function createAdminCaller() {
  const { aiRouter } = await import('./ai.js');
  return aiRouter.createCaller({
    req: { user: adminUser } as Request,
    res: {} as Response,
    user: adminUser,
  });
}

/**
 * "Regenerate All" since v1.20.0, when the cognate system was removed: it regenerates audio and
 * images only, and never touches cards.cognate_score (deprecated) or calls an AI for it.
 */
describe('ai router regenerateDeckAssets', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));
    vi.doMock('../services/ai/scanService.js', () => ({
      scanDeck: vi.fn(async () => ({ status: 'scanning', totalCards: 0 })),
    }));
    // Every AI feature on, both text providers keyed: any AI call would show up as a fetch.
    vi.doMock('../services/ai/config.js', () => ({
      getAiRuntimeConfig: async () => ({
        aiEnabled: true, pronunciationEnabled: true, imageEnabled: true, mnemonicEnabled: true,
        provider: 'openai', openaiApiKey: 'sk-test', openaiBaseUrl: 'https://api.openai.com/v1',
        mnemonicModel: 'gpt-5.6-luna', textProvider: 'anthropic', anthropicApiKey: 'sk-ant-test',
        anthropicMnemonicModel: 'claude-opus-5-5',
        // What v1.19.0 read to score cognates with an AI: on, and a real model, so the old code would call.
        cognateEnabled: true, cognateModel: 'gpt-5.6-luna', anthropicCognateModel: 'claude-opus-5-5',
      }),
      invalidateAiRuntimeConfigCache: () => {},
    }));
    fetchMock = vi.fn(async () => { throw new Error('no AI call expected'); });
    vi.stubGlobal('fetch', fetchMock);

    await setupFsrsSchema(client, { reset: true });
    process.env = { ...originalEnv };
    process.env.APP_SETTINGS_ENCRYPTION_KEY = 'router-ai-regenerate-test-key';

    await testDb.insert(schema.users).values({
      id: adminUser.id,
      googleId: adminUser.googleId,
      email: adminUser.email,
      name: adminUser.name,
      role: 'admin',
    });

    await testDb.insert(schema.decks).values({
      id: 101,
      name: 'Spanish',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      createdBy: adminUser.id,
    });

    // A score left over from before v1.20.0.
    await testDb.insert(schema.cards).values({
      id: 201,
      deckId: 101,
      front: '<b>nation</b>',
      back: 'nación',
      cognateScore: 0.12,
    });
    await testDb.insert(schema.aiAssets).values([
      { cardId: 201, assetType: 'audio', provider: 'openai', prompt: 'nation', url: '/a.ogg', status: 'ready' },
      { cardId: 201, assetType: 'image', provider: 'openai', prompt: 'nation', url: '/i.webp', status: 'ready' },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await client.close();
  });

  const cognateScore = async () => (await testDb.query.cards.findFirst({ where: eq(schema.cards.id, 201) }))?.cognateScore;
  const assetTypes = async () => (await testDb.query.aiAssets.findMany()).map((a) => a.assetType).sort();

  it('"Regenerate All" (no asset types) clears audio and images, and leaves cognate_score alone', async () => {
    const caller = await createAdminCaller();
    const result = await caller.regenerateDeckAssets({ deckId: 101 });

    expect(result).toEqual({ status: 'regenerating', cardCount: 1 });
    const { scanDeck } = await import('../services/ai/scanService.js');
    expect(vi.mocked(scanDeck)).toHaveBeenCalledWith(101, adminUser.id);
    expect(await assetTypes()).toEqual([]);
    expect(await cognateScore()).toBe(0.12);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes the \'cognate\' type a page loaded before v1.20.0 sends, and ignores it', async () => {
    const caller = await createAdminCaller();
    await caller.regenerateDeckAssets({ deckId: 101, assetTypes: ['audio', 'image', 'cognate'] });

    expect(await assetTypes()).toEqual([]);
    expect(await cognateScore()).toBe(0.12);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with \'cognate\' alone, changes nothing but still starts the scan', async () => {
    const caller = await createAdminCaller();
    await caller.regenerateDeckAssets({ deckId: 101, assetTypes: ['cognate'] });

    expect(await assetTypes()).toEqual(['audio', 'image']);
    expect(await cognateScore()).toBe(0.12);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes only the asset types asked for', async () => {
    const caller = await createAdminCaller();
    await caller.regenerateDeckAssets({ deckId: 101, assetTypes: ['audio'] });

    expect(await assetTypes()).toEqual(['image']);
    expect(await cognateScore()).toBe(0.12);
  });
});
