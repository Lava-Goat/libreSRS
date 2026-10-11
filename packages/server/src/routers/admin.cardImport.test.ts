// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Card imports and the deck export since v1.20.0, when the cognate system was removed: an import
 * asks no AI for anything (it used to score every card), ignores a cognate_score column, and
 * leaves cards.cognate_score (deprecated) empty; the export has no cognate_score column.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const admin = { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', picture: null, role: 'admin' as const };

async function adminCaller() {
  const { adminRouter } = await import('./admin.js');
  return adminRouter.createCaller({ req: { user: admin } as unknown as Request, res: {} as Response, user: admin, requestId: null });
}

const cognateScores = async () => (await client.execute('SELECT front, cognate_score FROM cards ORDER BY id')).rows;

describe('card imports call no AI for cognates', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    // The background scan for audio and images after an import is not what this is about.
    vi.doMock('../services/ai/scanService.js', () => ({ scanDeck: vi.fn(async () => ({ status: 'scanning', totalCards: 0 })) }));
    // Every AI feature on, and both text providers keyed: any AI call would show up as a fetch.
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
    await testDb.insert(schema.users).values({ id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', role: 'admin' });
    await testDb.insert(schema.decks).values({ id: 5, name: 'U1', createdBy: 1, sourceLanguage: 'es', targetLanguage: 'en' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await client.close();
  });

  it('imports a CSV, ignoring its cognate_score column, with no AI call', async () => {
    const caller = await adminCaller();
    const result = await caller.uploadCards({
      deckId: 5,
      // A file exported before v1.20.0 has this column.
      csvContent: 'front,back,cognate_score,mnemonic\nnación,nation,0.93,\ngato,cat,,"GAH-toh: a cat that ate a GATOR"\n',
    });

    expect(result).toMatchObject({ success: true, cardsAdded: 2, errors: [] });
    expect(await cognateScores()).toEqual([
      { front: 'nación', cognate_score: null },
      { front: 'gato', cognate_score: null },
    ]);
    expect((await testDb.query.cards.findMany()).find((c) => c.front === 'gato')?.mnemonic).toBe('GAH-toh: a cat that ate a GATOR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('imports an Anki deck with no AI call', async () => {
    vi.doMock('../services/anki.js', () => ({
      ANKI_APKG_MAX_BYTES: 25 * 1024 * 1024,
      parseAnkiApkgBase64InBatches: async ({ onBatch }: { onBatch: (cards: Array<{ front: string; back: string }>) => Promise<void> }) => {
        await onBatch([{ front: 'la familia', back: 'family' }, { front: 'el perro', back: 'dog' }]);
        return { cardsAdded: 2, errors: [], warnings: [] };
      },
    }));
    const caller = await adminCaller();
    const result = await caller.uploadAnkiDeck({ deckId: 5, apkgBase64: Buffer.from('fake').toString('base64') });

    expect(result).toMatchObject({ success: true, cardsAdded: 2 });
    expect(await cognateScores()).toEqual([
      { front: 'la familia', cognate_score: null },
      { front: 'el perro', cognate_score: null },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exports no cognate_score column, even for a card scored before v1.20.0', async () => {
    await testDb.insert(schema.cards).values({ deckId: 5, front: 'nación', back: 'nation', cognateScore: 0.93, mnemonic: 'NATION' });
    const caller = await adminCaller();
    const { csv } = await caller.exportDeckCards({ deckId: 5 });

    const [header, row] = csv.split('\n');
    expect(header).toBe('front,back,mnemonic,audio_front,audio_back,image_front,image_back');
    expect(row).toBe('"nación","nation","NATION","","","",""');
    expect(csv).not.toContain('0.93');
  });
});
