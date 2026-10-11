// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ getAiRuntimeConfig: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getAiRuntimeConfig } from './config.js';
import { getModelCatalog, groupModelIds, resetModelCatalogCache } from './modelCatalog.js';
import { AVAILABLE_MODELS } from './aiTemplates.js';

const LIVE_IDS = [
  'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.5-2026-04-23', 'gpt-5.5-pro',
  'gpt-5.2-codex', 'gpt-5-search-api', 'gpt-4o-mini', 'gpt-4o-2024-11-20',
  'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'gpt-4o-mini-tts-2025-03-20',
  'tts-1', 'tts-1-1106', 'tts-1-hd',
  'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-1-mini',
  'whisper-1', 'gpt-4o-realtime-preview', 'gpt-4o-audio-preview',
];

function mockModelsResponse(ids: string[]): Response {
  return {
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  } as unknown as Response;
}

describe('groupModelIds', () => {
  it('keeps chat-capable models and excludes codex/search/pro/audio/dated ids', () => {
    const g = groupModelIds(LIVE_IDS);
    expect(g.mnemonic).toContain('gpt-5.6-luna');
    expect(g.mnemonic).toContain('gpt-5.5');
    expect(g.mnemonic).toContain('gpt-4o-mini');
    expect(g.mnemonic).not.toContain('gpt-5.2-codex');
    expect(g.mnemonic).not.toContain('gpt-5-search-api');
    expect(g.mnemonic).not.toContain('gpt-5.5-pro');
    expect(g.mnemonic).not.toContain('gpt-5.5-2026-04-23');
    expect(g.mnemonic).not.toContain('gpt-4o-realtime-preview');
    expect(g.mnemonic).not.toContain('gpt-4o-audio-preview');
    // v1.20.0 removed the cognate system, and its model list with it.
    expect(Object.keys(g).sort()).toEqual(['image', 'mnemonic', 'tts']);
  });

  it('keeps the tts family with dated snapshots, drops -1106 legacies', () => {
    const g = groupModelIds(LIVE_IDS);
    expect(g.tts).toContain('gpt-4o-mini-tts-2025-12-15');
    expect(g.tts).toContain('gpt-4o-mini-tts-2025-03-20');
    expect(g.tts).toContain('tts-1');
    expect(g.tts).not.toContain('tts-1-1106');
  });

  it('keeps undated image models', () => {
    const g = groupModelIds(LIVE_IDS);
    expect(g.image).toContain('gpt-image-2');
    expect(g.image).toContain('gpt-image-1-mini');
    expect(g.image).not.toContain('gpt-image-2-2026-04-21');
  });

  it('sorts newest-first', () => {
    const g = groupModelIds(LIVE_IDS);
    expect(g.mnemonic.indexOf('gpt-5.6-luna')).toBeLessThan(g.mnemonic.indexOf('gpt-5.5'));
    expect(g.mnemonic.indexOf('gpt-5.5')).toBeLessThan(g.mnemonic.indexOf('gpt-4o-mini'));
  });
});

describe('getModelCatalog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetModelCatalogCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
    } as Awaited<ReturnType<typeof getAiRuntimeConfig>>);
  });

  afterEach(() => {
    resetModelCatalogCache();
    vi.unstubAllGlobals();
  });

  it('fetches live models and reports fetchedAt', async () => {
    fetchMock.mockResolvedValue(mockModelsResponse(LIVE_IDS));
    const catalog = await getModelCatalog();
    expect(catalog.fetchedAt).not.toBeNull();
    expect(catalog.models.mnemonic).toContain('gpt-5.6-luna');
    expect(catalog.models.imageQuality).toEqual(AVAILABLE_MODELS.imageQuality);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } })
    );
  });

  it('serves from cache within the TTL and refetches on force', async () => {
    fetchMock.mockResolvedValue(mockModelsResponse(LIVE_IDS));
    await getModelCatalog();
    await getModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getModelCatalog(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the static list when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const catalog = await getModelCatalog();
    expect(catalog.fetchedAt).toBeNull();
    expect(catalog.models.mnemonic).toEqual(AVAILABLE_MODELS.mnemonic);
    expect(catalog.models.tts).toEqual(AVAILABLE_MODELS.tts);
    expect(catalog.models).not.toHaveProperty('cognate');
  });

  it('keeps a stale successful catalog over the static list when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(mockModelsResponse(LIVE_IDS));
    const first = await getModelCatalog();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const second = await getModelCatalog(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.models.mnemonic).toContain('gpt-5.6-luna');
  });

  it('skips the network entirely when api.openai.com has no key', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      openaiApiKey: null,
      openaiBaseUrl: 'https://api.openai.com/v1',
    } as Awaited<ReturnType<typeof getAiRuntimeConfig>>);
    const catalog = await getModelCatalog();
    expect(catalog.fetchedAt).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still queries key-less OpenAI-compatible endpoints', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      openaiApiKey: null,
      openaiBaseUrl: 'http://model-host:11434/v1',
    } as Awaited<ReturnType<typeof getAiRuntimeConfig>>);
    fetchMock.mockResolvedValue(mockModelsResponse(['qwen3:8b', 'gpt-4o-mini']));
    const catalog = await getModelCatalog();
    expect(catalog.fetchedAt).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://model-host:11434/v1/models',
      expect.objectContaining({ headers: {} })
    );
    // qwen3:8b does not match the gpt families → falls back per family
    expect(catalog.models.mnemonic).toContain('gpt-4o-mini');
    expect(catalog.models).not.toHaveProperty('cognate');
  });
});
