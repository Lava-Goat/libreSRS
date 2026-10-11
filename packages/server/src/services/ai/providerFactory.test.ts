// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  getAiRuntimeConfig: vi.fn(),
}));

import { getAiRuntimeConfig } from './config.js';
import { OpenAIProvider } from './openaiProvider.js';
import { createAiProvider } from './providerFactory.js';

describe('createAiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when API key is missing', async () => {
    const provider = await createAiProvider({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: '',
      openaiBaseUrl: 'https://api.openai.com/v1',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'low',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(provider).toBeNull();
  });

  it('returns an OpenAIProvider for openai config with API key', async () => {
    const provider = await createAiProvider({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'medium',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider?.name).toBe('openai');
  });

  it('uses a custom OpenAI-compatible endpoint without requiring an API key', async () => {
    const provider = await createAiProvider({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: null,
      openaiBaseUrl: 'http://model-host:11434/v1',
      pronunciationEnabled: false,
      imageEnabled: false,
      mnemonicEnabled: true,
      mnemonicModel: 'qwen3:8b',
      imageModel: 'unused',
      imageQuality: 'low',
      ttsModel: 'unused',
    });

    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('returns null for unsupported provider names', async () => {
    const provider = await createAiProvider({
      aiEnabled: true,
      provider: 'unsupported' as 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'low',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(provider).toBeNull();
  });

  it('loads runtime config when no explicit config is passed', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-runtime',
      openaiBaseUrl: 'https://api.openai.com/v1',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: true,
      mnemonicModel: 'gpt-5.2',
      imageModel: 'gpt-image-1.5',
      imageQuality: 'high',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    const provider = await createAiProvider();
    expect(getAiRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });
});

describe('createAiProvider — ElevenLabs TTS wrapper', () => {
  const BASE = {
    aiEnabled: true,
    provider: 'openai',
    openaiApiKey: 'sk-test',
    openaiBaseUrl: 'https://api.openai.com/v1',
    pronunciationEnabled: true,
    imageEnabled: true,
    mnemonicEnabled: true,
    mnemonicModel: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
    imageQuality: 'low',
    ttsModel: 'eleven_multilingual_v2',
    ttsProvider: 'elevenlabs',
    elevenlabsApiKey: 'xi-key',
    ttsVoiceMap: { '': 'voice-default' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes generateSpeech to ElevenLabs and attributes speech to elevenlabs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = await createAiProvider({ ...BASE });
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('openai');
      expect(provider!.speechProviderName).toBe('elevenlabs');
      await provider!.generateSpeech('hola', { accent: 'Mexican' });
      expect(String(fetchMock.mock.calls[0][0])).toContain('api.elevenlabs.io');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails speech cleanly when ElevenLabs is selected without a key (no silent OpenAI fallback)', async () => {
    const provider = await createAiProvider({ ...BASE, elevenlabsApiKey: null });
    expect(provider).not.toBeNull();
    await expect(provider!.generateSpeech('hola')).rejects.toThrow(
      'ElevenLabs is selected as the TTS provider but no ElevenLabs API key is saved'
    );
  });

  it('keyless-OpenAI install: speech works, non-speech methods fail with a clean config error', async () => {
    const provider = await createAiProvider({ ...BASE, openaiApiKey: null });
    expect(provider).not.toBeNull();
    await expect(provider!.generateMnemonic({ front: 'a', back: 'b' })).rejects.toThrow(
      'AI provider is not configured for this feature'
    );
    await expect(provider!.generateTranscription(Buffer.from([1]), 'audio/webm')).rejects.toThrow(
      'AI provider is not configured for this feature'
    );
  });

  it('returns null when neither OpenAI nor ElevenLabs is usable', async () => {
    const provider = await createAiProvider({
      ...BASE, openaiApiKey: null, elevenlabsApiKey: null,
    });
    expect(provider).toBeNull();
  });
});
