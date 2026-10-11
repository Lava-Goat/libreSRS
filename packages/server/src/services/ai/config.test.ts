// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../appSettings.js', () => ({
  getAppSettings: vi.fn(),
}));

import { getAppSettings } from '../appSettings.js';
import {
  getAiRuntimeConfig,
  getImageModel,
  getImageQuality,
  getMnemonicModel,
  invalidateAiRuntimeConfigCache,
  isAiEnabled,
  isImageEnabled,
  isMnemonicEnabled,
  isPronunciationEnabled,
} from './config.js';

describe('AI config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAiRuntimeConfigCache();
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: null,
      googleClientSecret: null,
      aiEnabled: true,
      aiProvider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'http://model-host:11434/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-5.2',
      aiImageModel: 'gpt-image-1.5',
      aiImageQuality: 'low',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
  });

  it('maps app settings to runtime config', async () => {
    const config = await getAiRuntimeConfig();

    expect(config.aiEnabled).toBe(true);
    expect(config.provider).toBe('openai');
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.openaiBaseUrl).toBe('http://model-host:11434/v1');
    expect(config.pronunciationEnabled).toBe(true);
    expect(config.imageEnabled).toBe(true);
    expect(config.mnemonicEnabled).toBe(true);
    // v1.20.0 removed the cognate system: nothing in the runtime config is about cognates.
    expect(Object.keys(config).filter((key) => /cognate/i.test(key))).toEqual([]);
  });

  it('disables all sub-features when AI is disabled', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: null,
      googleClientSecret: null,
      aiEnabled: false,
      aiProvider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-5.2',
      aiImageModel: 'gpt-image-1.5',
      aiImageQuality: 'low',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(await isAiEnabled()).toBe(false);
    expect(await isPronunciationEnabled()).toBe(false);
    expect(await isImageEnabled()).toBe(false);
    expect(await isMnemonicEnabled()).toBe(false);
  });

  it('returns configured models and image quality', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: null,
      googleClientSecret: null,
      aiEnabled: true,
      aiProvider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-4.1',
      aiImageModel: 'gpt-image-1',
      aiImageQuality: 'high',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(await getMnemonicModel()).toBe('gpt-4.1');
    expect(await getImageModel()).toBe('gpt-image-1');
    expect(await getImageQuality()).toBe('high');
  });

  it('reads OpenAI as the text provider when the settings carry none', async () => {
    // The beforeEach mock predates v1.20.0: no aiTextProvider, no Anthropic fields.
    const config = await getAiRuntimeConfig();

    expect(config.textProvider).toBe('openai');
    expect(config.anthropicApiKey).toBeNull();
    expect(config.anthropicMnemonicModel).toBe('claude-opus-5-5');
    // The OpenAI column keeps its meaning.
    expect(config.mnemonicModel).toBe('gpt-5.2');
  });

  it('maps the Anthropic key and the Claude model when Anthropic is selected', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: null,
      googleClientSecret: null,
      aiEnabled: true,
      aiProvider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-5.6-luna',
      aiImageModel: 'gpt-image-1.5',
      aiImageQuality: 'low',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
      aiTextProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      aiAnthropicMnemonicModel: 'claude-sonnet-5-5',
    });

    const config = await getAiRuntimeConfig();

    expect(config.textProvider).toBe('anthropic');
    expect(config.anthropicApiKey).toBe('sk-ant-test');
    expect(config.anthropicMnemonicModel).toBe('claude-sonnet-5-5');
    expect(config.mnemonicModel).toBe('gpt-5.6-luna');
  });

  it('falls back to claude-opus-5-5 for an empty Claude model and to OpenAI for an unknown provider', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: null,
      googleClientSecret: null,
      aiEnabled: true,
      aiProvider: 'openai',
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-5.2',
      aiImageModel: 'gpt-image-1.5',
      aiImageQuality: 'low',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
      aiTextProvider: 'gemini',
      anthropicApiKey: null,
      aiAnthropicMnemonicModel: '',
    });

    const config = await getAiRuntimeConfig();

    expect(config.textProvider).toBe('openai');
    expect(config.anthropicMnemonicModel).toBe('claude-opus-5-5');
  });
});
