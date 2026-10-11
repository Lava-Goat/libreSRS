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

vi.mock('./moderation.js', () => ({
  checkModeration: vi.fn(() => Promise.resolve({ flagged: false, categories: {} })),
}));

vi.mock('../../db/index.js', async () => {
  const realSchema = await vi.importActual('../../db/schema.js');
  return {
    db: {
      query: {
        aiAssets: { findFirst: vi.fn() },
        cards: { findFirst: vi.fn() },
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
import { generateImage } from './imageService.js';

describe('imageService', () => {
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

  it('should throw when image generation is disabled', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-test',
      pronunciationEnabled: true,
      imageEnabled: false,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-5.2',
      imageModel: 'gpt-image-1.5',
      imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
    await expect(generateImage(1, 1)).rejects.toThrow('Image generation is not enabled');
  });

  it('should return existing asset when one exists', async () => {
    vi.mocked(db.query.aiAssets.findFirst).mockResolvedValue({
      id: 1, cardId: 1, assetType: 'image', provider: 'openai',
      prompt: 'test', url: 'https://example.com/image.png',
      status: 'ready', errorMessage: null, createdAt: new Date(),
    } as any);

    const result = await generateImage(1, 1);
    expect(result.status).toBe('ready');
    expect(result.imageUrl).toBe('https://example.com/image.png');
  });

  it('should throw when no provider is configured', async () => {
    vi.mocked(db.query.aiAssets.findFirst).mockResolvedValue(undefined as any);
    vi.mocked(createAiProvider).mockResolvedValue(null);

    await expect(generateImage(1, 1)).rejects.toThrow('AI provider not configured');
  });
});
