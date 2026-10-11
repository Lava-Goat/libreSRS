// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  getAiRuntimeConfig: vi.fn(),
}));

vi.mock('./providerFactory.js', () => ({
  createAiProvider: vi.fn(),
}));

import type { AiRuntimeConfig } from './config.js';
import { getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { activeMnemonicModel, createTextProvider, usesClaude } from './textProvider.js';
import { __resetAnthropicGate } from './anthropicProvider.js';

const baseConfig: AiRuntimeConfig = {
  aiEnabled: true,
  provider: 'openai',
  openaiApiKey: 'sk-test',
  openaiBaseUrl: 'https://api.openai.com/v1',
  pronunciationEnabled: true,
  imageEnabled: true,
  mnemonicEnabled: true,
  mnemonicModel: 'gpt-5.6-luna',
  imageModel: 'gpt-image-1.5',
  imageQuality: 'low',
  ttsModel: 'gpt-4o-mini-tts',
  ttsProvider: 'openai',
  elevenlabsApiKey: null,
  ttsVoiceMap: {},
  vocabTtsVoiceId: null,
  textProvider: 'openai',
  anthropicApiKey: null,
  anthropicMnemonicModel: 'claude-opus-5-5',
};

const claudeConfig: AiRuntimeConfig = {
  ...baseConfig,
  textProvider: 'anthropic',
  anthropicApiKey: 'sk-ant-test',
};

describe('createTextProvider', () => {
  const openAiProvider = { name: 'openai', generateMnemonic: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAnthropicGate();
    vi.mocked(createAiProvider).mockResolvedValue(openAiProvider as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns exactly what createAiProvider returns while OpenAI is selected', async () => {
    await expect(createTextProvider(baseConfig)).resolves.toBe(openAiProvider);
    expect(createAiProvider).toHaveBeenCalledWith(baseConfig);
  });

  it('treats a config without textProvider (an older mock) as OpenAI', async () => {
    const legacy: Partial<AiRuntimeConfig> = { ...baseConfig };
    delete legacy.textProvider;

    await expect(createTextProvider(legacy as AiRuntimeConfig)).resolves.toBe(openAiProvider);
    expect(usesClaude(legacy as AiRuntimeConfig)).toBe(false);
  });

  it('keeps returning null from the OpenAI path when createAiProvider has nothing', async () => {
    vi.mocked(createAiProvider).mockResolvedValue(null);

    await expect(createTextProvider(baseConfig)).resolves.toBeNull();
  });

  it('builds a Claude provider with the Claude model, without the OpenAI factory or an OpenAI key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'A mnemonic.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await createTextProvider({ ...claudeConfig, openaiApiKey: null });

    expect(provider?.name).toBe('anthropic');
    expect(createAiProvider).not.toHaveBeenCalled();

    await provider!.generateMnemonic({ front: 'la biblioteca', back: 'library' });
    const models = fetchMock.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).model);
    expect(models).toEqual(['claude-opus-5-5']);
    // Mnemonic suggestions only: v1.20.0 removed the cognate system.
    expect(provider).not.toHaveProperty('scoreCognate');
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-api-key': 'sk-ant-test' });
  });

  it('returns null while Claude is selected but no Anthropic key is saved', async () => {
    await expect(createTextProvider({ ...claudeConfig, anthropicApiKey: null })).resolves.toBeNull();
    expect(createAiProvider).not.toHaveBeenCalled();
  });

  it('loads the runtime config when none is passed', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue(baseConfig);

    await expect(createTextProvider()).resolves.toBe(openAiProvider);
    expect(getAiRuntimeConfig).toHaveBeenCalled();
  });
});

describe('activeMnemonicModel', () => {
  it('reads the OpenAI column while OpenAI is selected', () => {
    expect(activeMnemonicModel({ ...baseConfig, mnemonicModel: 'gpt-5.5' })).toBe('gpt-5.5');
  });

  it('reads the Claude column while Claude is selected', () => {
    expect(activeMnemonicModel(claudeConfig)).toBe('claude-opus-5-5');
  });
});
