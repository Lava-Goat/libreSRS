// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openaiProvider.js';
import { buildMnemonicPrompt } from './aiTemplates.js';

function createProvider() {
  return new OpenAIProvider('sk-test', {
    mnemonicModel: 'gpt-5.2',
    imageModel: 'gpt-image-1.5',
    imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
  });
}

function mockChatResponse(content: string, ok = true): Response {
  return {
    ok,
    json: async () => ({
      choices: [
        {
          message: { content },
        },
      ],
    }),
    text: async () => content,
  } as unknown as Response;
}

describe('OpenAIProvider generateMnemonic', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scores no cognates: v1.20.0 removed the cognate system', () => {
    expect('scoreCognate' in createProvider()).toBe(false);
  });

  it('sends buildMnemonicPrompt as the one user message, in the style asked for (v1.20.0)', async () => {
    fetchMock.mockResolvedValue(mockChatResponse('Quiero, PERO no puedo = I want to, but I can\'t'));
    const context = {
      front: 'pero', back: 'but', sourceLanguage: 'es', targetLanguage: 'en',
      style: 'sentence' as const, alreadySuggested: ['PEAR-oh: a pear, but no apple'],
    };

    await createProvider().generateMnemonic(context);

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { messages: unknown };
    expect(body.messages).toEqual([{ role: 'user', content: buildMnemonicPrompt(context) }]);
    expect(buildMnemonicPrompt(context)).toContain('Sounds like: PEH-roh (English-style respelling; stressed syllable in capitals)');
  });

  it('uses a remote OpenAI-compatible endpoint without an authorization header', async () => {
    fetchMock.mockResolvedValue(mockChatResponse('A NATION of lions.'));
    const provider = new OpenAIProvider(null, {
      baseUrl: 'http://model-host:11434/v1/',
      mnemonicModel: 'qwen3:8b',
      imageModel: 'unused',
      imageQuality: 'low',
      ttsModel: 'unused',
    });

    await provider.generateMnemonic({ front: 'nation', back: 'nación' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://model-host:11434/v1/chat/completions',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'qwen3:8b', max_tokens: 2_000 });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('retries without temperature when the model rejects it (gpt-5.x / o-series)', async () => {
    // First call: a reasoning model's 400.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: {
        message: "Unsupported value: 'temperature' does not support 0.8 with this model. Only the default (1) value is supported.",
        type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value',
      } }),
    } as unknown as Response);
    // Retry (no temperature): succeeds.
    fetchMock.mockResolvedValueOnce(mockChatResponse('Piensa en "hola" como "hello" con o.'));

    const provider = createProvider();
    const result = await provider.generateMnemonic({ front: 'hello', back: 'hola' });
    expect(result.text).toContain('hola');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const second = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(first).toHaveProperty('temperature');
    expect(second).not.toHaveProperty('temperature');
    expect(second).toMatchObject({ model: 'gpt-5.2' });
  });

  it('does not retry non-temperature 400s', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'context length exceeded', code: 'context_length_exceeded' } }),
    } as unknown as Response);

    const provider = createProvider();
    await expect(provider.generateMnemonic({ front: 'x', back: 'y' })).rejects.toThrow('mnemonic generation failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('strips reasoning_effort for models that reject it (gpt-4o family)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: {
        message: "Unrecognized request argument supplied: reasoning_effort",
        param: 'reasoning_effort', code: 'unknown_parameter',
      } }),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce(mockChatResponse('A NATION of lions.'));

    const provider = createProvider();
    const result = await provider.generateMnemonic({ front: 'nation', back: 'nación' });
    expect(result.text).toBe('A NATION of lions.');
    const second = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(second).not.toHaveProperty('reasoning_effort');
    expect(second).toHaveProperty('temperature');
  });

  it('strips markdown emphasis from mnemonic text', async () => {
    fetchMock.mockResolvedValue(mockChatResponse('In the **library**, a *bee* says `biblioteca` — _remember_ it!'));
    const provider = createProvider();
    const result = await provider.generateMnemonic({ front: 'library', back: 'biblioteca' });
    expect(result.text).toBe('In the library, a bee says biblioteca — remember it!');
  });

  it('throws on an empty mnemonic completion instead of returning blank text', async () => {
    fetchMock.mockResolvedValue(mockChatResponse('   '));
    const provider = createProvider();
    await expect(provider.generateMnemonic({ front: 'hello', back: 'hola' }))
      .rejects.toThrow('empty completion');
  });
});

describe('OpenAIProvider generateImage', () => {
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]).toString('base64');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]).toString('base64');
  let fetchMock: ReturnType<typeof vi.fn>;

  function providerWith(imageModel: string) {
    return new OpenAIProvider('sk-test', { mnemonicModel: 'gpt-5.2', imageModel, imageQuality: 'high', ttsModel: 'tts' });
  }
  const answer = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as Response;
  const unknownParameter = (param: string) => answer(400, {
    error: { message: `Unknown parameter: '${param}'.`, type: 'invalid_request_error', param, code: 'unknown_parameter' },
  });
  const sentBody = (call: number) => JSON.parse(String(fetchMock.mock.calls[call][1]?.body)) as Record<string, unknown>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never sends response_format to a GPT image model (gpt-image-2 refuses it)', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { data: [{ b64_json: WEBP }] }));
    const result = await providerWith('gpt-image-2').generateImage('a red apple');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0)).not.toHaveProperty('response_format');
    expect(sentBody(0)).toMatchObject({ model: 'gpt-image-2', output_format: 'webp', quality: 'high', n: 1 });
    expect(result.url).toBe(`data:image/webp;base64,${WEBP}`);
  });

  it('strips any optional param a 400 names and retries, once each, so a new model cannot break images this way', async () => {
    fetchMock
      .mockResolvedValueOnce(unknownParameter('response_format'))
      .mockResolvedValueOnce(unknownParameter('output_format'))
      .mockResolvedValueOnce(answer(200, { data: [{ b64_json: PNG }] }));
    const result = await providerWith('some-image-model').generateImage('a red apple');
    expect(sentBody(0)).toMatchObject({ response_format: 'b64_json', output_format: 'webp' });
    expect(sentBody(1)).not.toHaveProperty('response_format');
    expect(sentBody(2)).not.toHaveProperty('output_format');
    expect(sentBody(2)).toMatchObject({ quality: 'high' });
    // The real type, not the webp that was asked for.
    expect(result.url).toBe(`data:image/png;base64,${PNG}`);
  });

  it('does not retry an error that is not about an optional param', async () => {
    fetchMock.mockResolvedValueOnce(answer(429, { error: { message: 'You have no credits remaining.', code: 'insufficient_quota' } }));
    await expect(providerWith('gpt-image-2').generateImage('x')).rejects.toThrow(/OpenAI image generation failed: .*insufficient_quota/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads an image that came back as a link, since those links expire', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, { data: [{ url: 'https://images.example/abc.png' }] }))
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(PNG, 'base64') } as unknown as Response);
    const result = await providerWith('dall-e-3').generateImage('x');
    expect(fetchMock.mock.calls[1][0]).toBe('https://images.example/abc.png');
    expect(result.url).toBe(`data:image/png;base64,${PNG}`);
  });

  it('fails clearly when the answer holds no image', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { data: [] }));
    await expect(providerWith('gpt-image-2').generateImage('x')).rejects.toThrow('OpenAI image generation returned no image');
  });
});
