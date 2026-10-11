// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  getAiRuntimeConfig: vi.fn(async () => ({
    aiEnabled: true,
    provider: 'openai',
    openaiApiKey: 'sk-test',
    pronunciationEnabled: true,
    imageEnabled: true,
    mnemonicEnabled: true,
    mnemonicModel: 'gpt-5.2',
    imageModel: 'gpt-image-1.5',
    imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
  })),
}));

vi.mock('./providerFactory.js', () => ({
  createAiProvider: vi.fn(),
}));

vi.mock('./aiLogger.js', () => ({
  logAiRequest: vi.fn(),
}));

vi.mock('./assetStorage.js', () => ({
  writeAudioAsset: vi.fn(async () => '/api/assets/test-uuid.opus'),
}));

// Mock the db module with schema re-exported from real schema
vi.mock('../../db/index.js', async () => {
  const realSchema = await vi.importActual('../../db/schema.js');
  return {
    db: {
      query: {
        aiAssets: { findMany: vi.fn(() => []) },
        cards: { findFirst: vi.fn() },
        decks: { findFirst: vi.fn() },
      },
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{ id: 1 }]) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    },
    schema: realSchema,
  };
});

import { getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { db } from '../../db/index.js';
import { generatePronunciation } from './pronunciationService.js';

describe('pronunciationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-test',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-5.2',
      imageModel: 'gpt-image-1.5',
      imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
  });

  it('should throw when pronunciation is disabled', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-test',
      pronunciationEnabled: false,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-5.2',
      imageModel: 'gpt-image-1.5',
      imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
    await expect(generatePronunciation(1, 1)).rejects.toThrow('Pronunciation generation is not enabled');
  });

  it('should return existing asset when one exists', async () => {
    vi.mocked(db.query.cards.findFirst).mockResolvedValue({
      id: 1, deckId: 1, front: 'hello', back: 'hola', createdAt: new Date(),
    } as any);
    vi.mocked(db.query.decks.findFirst).mockResolvedValue({
      id: 1, name: 'Test', sourceLanguage: 'English', targetLanguage: 'Spanish',
      speechAccent: null, createdBy: 1, createdAt: new Date(),
    } as any);
    vi.mocked(db.query.aiAssets.findMany).mockResolvedValue([{
      id: 1, cardId: 1, assetType: 'audio', provider: 'openai',
      prompt: 'hola', url: 'data:audio/mpeg;base64,test',
      status: 'ready', errorMessage: null, createdAt: new Date(),
    }] as any);

    const result = await generatePronunciation(1, 1);
    expect(result.status).toBe('ready');
    expect(result.audioUrl).toBe('data:audio/mpeg;base64,test');
    expect(createAiProvider).not.toHaveBeenCalled();
  });

  it('should throw when no provider is configured', async () => {
    vi.mocked(db.query.cards.findFirst).mockResolvedValue({
      id: 1, deckId: 1, front: 'hello', back: 'hola', createdAt: new Date(),
    } as any);
    vi.mocked(db.query.decks.findFirst).mockResolvedValue(undefined as any);
    vi.mocked(db.query.aiAssets.findMany).mockResolvedValue([]);
    vi.mocked(createAiProvider).mockResolvedValue(null);

    await expect(generatePronunciation(1, 1)).rejects.toThrow('AI provider not configured');
  });

  it('cache hits do NOT consume the AI rate limit; only real generation does', async () => {
    const { checkAiRateLimit, resetRateLimits } = await import('./rateLimit.js');
    resetRateLimits();
    const userId = 99;
    // Exhaust the user's entire per-minute budget.
    for (let i = 0; i < 20; i++) checkAiRateLimit(userId);
    expect(() => checkAiRateLimit(userId)).toThrow();

    vi.mocked(db.query.cards.findFirst).mockResolvedValue({
      id: 1, deckId: 1, front: 'hello', back: 'hola', createdAt: new Date(),
    } as any);
    vi.mocked(db.query.decks.findFirst).mockResolvedValue({
      id: 1, name: 'Test', sourceLanguage: 'English', targetLanguage: 'Spanish',
      speechAccent: null, createdBy: 1, createdAt: new Date(),
    } as any);
    // Cache hit: an existing ready asset for this exact text.
    vi.mocked(db.query.aiAssets.findMany).mockResolvedValue([{
      id: 1, cardId: 1, assetType: 'audio', provider: 'openai',
      prompt: 'hola', url: 'data:audio/mpeg;base64,test',
      status: 'ready', errorMessage: null, createdAt: new Date(),
    }] as any);

    // Even with the budget exhausted, replaying existing audio must succeed.
    const result = await generatePronunciation(1, userId);
    expect(result.status).toBe('ready');
    expect(createAiProvider).not.toHaveBeenCalled();

    // But a cache MISS (no matching asset) must hit the rate limit.
    vi.mocked(db.query.aiAssets.findMany).mockResolvedValue([]);
    await expect(generatePronunciation(1, userId)).rejects.toThrow('AI rate limit exceeded');
    expect(createAiProvider).not.toHaveBeenCalled();
    resetRateLimits();
  });
});
