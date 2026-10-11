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

vi.mock('./pronunciationService.js', () => ({
  generatePronunciation: vi.fn(async () => ({})),
}));

vi.mock('./imageService.js', () => ({
  generateImage: vi.fn(async () => ({})),
}));

vi.mock('../../db/index.js', async () => {
  const realSchema = await vi.importActual('../../db/schema.js');
  return {
    db: {
      query: {
        cards: { findMany: vi.fn(() => [{ id: 1, deckId: 1, front: 'test', back: 'test' }]) },
        aiAssets: { findMany: vi.fn(() => []) },
      },
    },
    schema: realSchema,
  };
});

import { scanDeck } from './scanService.js';
import { generatePronunciation } from './pronunciationService.js';
import { generateImage } from './imageService.js';

describe('scanService regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should use delay between AI asset generations to prevent resource exhaustion', async () => {
    const scanPromise = scanDeck(1, 1);
    await scanPromise;

    // Advance through all delays (pronunciation front + back + image = 3 × 100ms)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(generatePronunciation).toHaveBeenCalled();
    expect(generateImage).toHaveBeenCalled();
  });
});
