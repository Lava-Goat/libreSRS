// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
        aiMnemonics: {
          findFirst: vi.fn(),
          findMany: vi.fn(() => []),
        },
        cards: { findFirst: vi.fn(), findMany: vi.fn(() => []) },
        decks: { findFirst: vi.fn() },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 1 }]),
          onConflictDoNothing: vi.fn(),
          onConflictDoUpdate: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      delete: vi.fn(() => ({ where: vi.fn() })),
    },
    schema: realSchema,
  };
});

import { getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { logAiRequest } from './aiLogger.js';
import { checkModeration } from './moderation.js';
import { db } from '../../db/index.js';
import { generateMnemonic, acceptMnemonic, rejectMnemonic } from './mnemonicService.js';
import { __resetQuotaBreakers, noteAiOutcome } from './quotaBreaker.js';
import { __resetAnthropicGate } from './anthropicProvider.js';
import { buildMnemonicPrompt } from './aiTemplates.js';
import { logger } from '../../logger.js';

describe('mnemonicService', () => {
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

  it('should throw when mnemonics are disabled', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true,
      provider: 'openai',
      openaiApiKey: 'sk-test',
      pronunciationEnabled: true,
      imageEnabled: true,
      mnemonicEnabled: false,
      mnemonicModel: 'gpt-5.2',
      imageModel: 'gpt-image-1.5',
      imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
    await expect(generateMnemonic(1, 1)).rejects.toThrow('Mnemonic generation is not enabled');
  });

  it('should throw when no provider is configured', async () => {
    vi.mocked(createAiProvider).mockResolvedValue(null);
    await expect(generateMnemonic(1, 1)).rejects.toThrow('AI provider not configured');
  });

  it('should throw when accepting non-existent mnemonic', async () => {
    vi.mocked(db.query.aiMnemonics.findFirst).mockResolvedValue(undefined as any);
    await expect(acceptMnemonic(999, 1)).rejects.toThrow('Mnemonic not found');
  });

  it('should throw when rejecting non-existent mnemonic', async () => {
    vi.mocked(db.query.aiMnemonics.findFirst).mockResolvedValue(undefined as any);
    await expect(rejectMnemonic(999, 1)).rejects.toThrow('Mnemonic not found');
  });

  it('rejects by marking the suggestion, never by deleting it', async () => {
    vi.mocked(db.query.aiMnemonics.findFirst).mockResolvedValue({ id: 5, userId: 1, cardId: 1, text: 't', rejectedAt: null } as never);

    await expect(rejectMnemonic(5, 1)).resolves.toEqual({ success: true });

    expect(db.delete).not.toHaveBeenCalled();
    const set = vi.mocked(db.update).mock.results[0].value.set;
    expect(set).toHaveBeenCalledWith({ rejectedAt: expect.any(Date) });
  });
});

// The payload OpenAI returns when an account's balance is exhausted.
const REAL_ERROR = 'OpenAI mnemonic generation failed: {"error":{"message":"You have no credits '
  + 'remaining.","type":"insufficient_quota","param":null,"code":"credit_balance_exhausted"}}';

describe('mnemonicService with Claude selected', () => {
  const claudeConfig = {
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
    ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    textProvider: 'anthropic' as const,
    anthropicApiKey: 'sk-ant-test',
    anthropicMnemonicModel: 'claude-opus-5-5',
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  function claudeMnemonic(text = 'Biblioteca sounds like bibliography: a room full of books.'): Response {
    return new Response(JSON.stringify({
      model: 'claude-opus-5-5',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 350, output_tokens: 120 },
    }), { status: 200, headers: { 'request-id': 'req_ok' } });
  }

  function claudeError(status: number, type: string, message: string): Response {
    return new Response(JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_err' }), { status });
  }

  async function failure(): Promise<{ code?: string; message?: string; cause?: { appCode?: string } }> {
    return generateMnemonic(1, 1).then(
      () => { throw new Error('expected generateMnemonic to fail'); },
      (err: unknown) => err as { code?: string; cause?: { appCode?: string } },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetQuotaBreakers();
    __resetAnthropicGate();
    vi.mocked(getAiRuntimeConfig).mockResolvedValue(claudeConfig as never);
    vi.mocked(db.query.cards.findFirst).mockResolvedValue({ id: 1, deckId: 2, front: 'la biblioteca', back: 'library' } as never);
    vi.mocked(db.query.decks.findFirst).mockResolvedValue({ id: 2, sourceLanguage: 'es', targetLanguage: 'en' } as never);
    vi.mocked(checkModeration).mockResolvedValue({ flagged: false, categories: {} });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('records and logs the suggestion as anthropic, with the model, request id and tokens', async () => {
    fetchMock.mockImplementation(async () => claudeMnemonic());

    await generateMnemonic(1, 1);

    expect(createAiProvider).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const insertedSuggestion = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedSuggestion).toMatchObject({
      provider: 'anthropic',
      text: 'Biblioteca sounds like bibliography: a room full of books.',
      accepted: false,
    });
    expect(logAiRequest).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      operation: 'generateMnemonic',
      success: true,
      model: 'claude-opus-5-5',
      requestId: 'req_ok',
      inputTokens: 350,
      outputTokens: 120,
    }));
  });

  it('sends Claude the same prompt as OpenAI would get: the style, how it sounds, what was already suggested and the deck’s other cards', async () => {
    fetchMock.mockImplementation(async () => claudeMnemonic('Busco un libro en la BIBLIOTECA = I look for a book in the library'));
    vi.mocked(db.query.cards.findFirst).mockResolvedValue({
      id: 1, deckId: 2, front: 'la biblioteca', back: 'library', mnemonic: 'BIBLE: a library full of bibles',
    } as never);
    vi.mocked(db.query.aiMnemonics.findMany).mockResolvedValue([
      { id: 8, text: 'Leo en la BIBLIOTECA = I read in the library', style: 'sentence' },
      { id: 7, text: 'BEE-BLEE-oh: bees reading in a library' },
      { id: 6, text: 'BIBLE: a library full of bibles', style: 'keyword' },
    ] as never);
    vi.mocked(db.query.cards.findMany).mockResolvedValueOnce([
      { front: '<b>el libro</b>', back: 'book', mnemonic: 'Picture a LEE-BRO reading a book' },
    ] as never);

    await expect(generateMnemonic(1, 1, 'sentence')).resolves.toMatchObject({ id: 1, style: 'sentence' });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { messages: { content: string }[] };
    const prompt = sent.messages[0].content;
    expect(prompt).toBe(buildMnemonicPrompt({
      front: 'la biblioteca',
      back: 'library',
      sourceLanguage: 'es',
      targetLanguage: 'en',
      style: 'sentence',
      alreadySuggested: ['Leo en la BIBLIOTECA = I read in the library'],
      // The approved one and the row with no style are keywords: listed for reference only.
      suggestedInOtherStyle: ['BIBLE: a library full of bibles', 'BEE-BLEE-oh: bees reading in a library'],
      otherCards: ['el libro = book: Picture a LEE-BRO reading a book'],
    }));
    expect(prompt).toContain('Sounds like: lah bee-blyoh-TEH-kah (English-style respelling; stressed syllable in capitals)');
    expect(prompt).toContain('example sentence');
    const insertedSuggestion = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedSuggestion).toMatchObject({ provider: 'anthropic', style: 'sentence', accepted: false });
  });

  it('is not blocked by an open openai breaker', async () => {
    noteAiOutcome('openai', false, REAL_ERROR);
    fetchMock.mockImplementation(async () => claudeMnemonic());

    await expect(generateMnemonic(1, 1)).resolves.toEqual({ id: 1, style: 'keyword' });
  });

  it('fails fast with AI_QUOTA_EXHAUSTED while the anthropic breaker is open', async () => {
    noteAiOutcome('anthropic', false, 'Anthropic mnemonic generation failed: 402 billing_error: no credit');

    const err = await failure();

    expect(err.code).toBe('TOO_MANY_REQUESTS');
    expect(err.cause?.appCode).toBe('AI_QUOTA_EXHAUSTED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [402, 'billing_error', 'Add credit.', 'TOO_MANY_REQUESTS', 'AI_QUOTA_EXHAUSTED'],
    [401, 'authentication_error', 'invalid x-api-key', 'PRECONDITION_FAILED', 'AI_PROVIDER_AUTH'],
    [404, 'not_found_error', 'model: claude-opus-9-9', 'PRECONDITION_FAILED', 'AI_MODEL_NOT_FOUND'],
    [400, 'invalid_request_error', 'messages: something is malformed', 'INTERNAL_SERVER_ERROR', 'AI_GENERATION_FAILED'],
  ])('maps a %i %s to %s / %s, after logging the failure', async (status, type, message, code, appCode) => {
    fetchMock.mockImplementation(async () => claudeError(status, type, message));

    const err = await failure();

    expect(err.code).toBe(code);
    expect(err.cause?.appCode).toBe(appCode);
    expect(logAiRequest).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      success: false,
      model: 'claude-opus-5-5',
      requestId: 'req_err',
      error: expect.stringContaining(`${status} ${type}`),
    }));
  });

  it('maps a refusal to AI_REFUSED', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', usage: { input_tokens: 300, output_tokens: 0 },
    }), { status: 200 }));

    const err = await failure();

    expect(err.code).toBe('BAD_REQUEST');
    expect(err.cause?.appCode).toBe('AI_REFUSED');
  });

  it('maps a 529 to AI_PROVIDER_BUSY after its one retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => claudeError(529, 'overloaded_error', 'Overloaded'));

    const pending = failure();
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.code).toBe('BAD_GATEWAY');
    expect(err.cause?.appCode).toBe('AI_PROVIDER_BUSY');
  });

  it('still moderates through OpenAI when a key is saved and OpenAI is not paused', async () => {
    fetchMock.mockImplementation(async () => claudeMnemonic());
    vi.mocked(checkModeration).mockResolvedValue({ flagged: true, categories: { violence: true } });

    const err = await failure();

    expect(checkModeration).toHaveBeenCalledWith(
      'Biblioteca sounds like bibliography: a room full of books.', 'sk-test', 'https://api.openai.com/v1',
    );
    expect(err.cause?.appCode).toBe('AI_MODERATION_FLAGGED');
  });

  it('skips moderation when no OpenAI key is saved', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({ ...claudeConfig, openaiApiKey: null } as never);
    fetchMock.mockImplementation(async () => claudeMnemonic());

    await expect(generateMnemonic(1, 1)).resolves.toEqual({ id: 1, style: 'keyword' });
    expect(checkModeration).not.toHaveBeenCalled();
  });

  it('skips moderation while the openai breaker is open', async () => {
    noteAiOutcome('openai', false, REAL_ERROR);
    fetchMock.mockImplementation(async () => claudeMnemonic());

    await expect(generateMnemonic(1, 1)).resolves.toEqual({ id: 1, style: 'keyword' });
    expect(checkModeration).not.toHaveBeenCalled();
  });

  it('keeps going when the moderation call itself fails', async () => {
    fetchMock.mockImplementation(async () => claudeMnemonic());
    vi.mocked(checkModeration).mockRejectedValue(new TypeError('fetch failed'));

    await expect(generateMnemonic(1, 1)).resolves.toEqual({ id: 1, style: 'keyword' });
    expect(logAiRequest).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', success: true }));
  });

  it('logs a failed moderation call without the saved OpenAI key, even one pasted across two lines', async () => {
    // fetch puts the whole header value in its error, and a saved key is only trimmed.
    const key = 'sk-proj-FAKEFAKEFAKEFAKE1234\nFAKETAIL5678';
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({ ...claudeConfig, openaiApiKey: key } as never);
    fetchMock.mockImplementation(async () => claudeMnemonic());
    vi.mocked(checkModeration).mockRejectedValue(new TypeError(`Headers.append: "Bearer ${key}" is an invalid header value.`));
    const warn = vi.spyOn(logger, 'warn');

    await expect(generateMnemonic(1, 1)).resolves.toEqual({ id: 1, style: 'keyword' });

    const logged = JSON.stringify(warn.mock.calls);
    warn.mockRestore();
    expect(logged).toContain('ai.moderation_unavailable');
    expect(logged).toContain('[REDACTED_KEY]');
    expect(logged).not.toContain('FAKEFAKE');
    expect(logged).not.toContain('FAKETAIL');
  });

  it('throws AI_PROVIDER_MISSING with the Claude wording when no Anthropic key is saved', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({ ...claudeConfig, anthropicApiKey: null } as never);

    const err = await failure();

    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(err.cause?.appCode).toBe('AI_PROVIDER_MISSING');
    expect(err.message).toBe('Mnemonics are set to use Claude, but no Anthropic API key is saved. Add one in Admin > AI.');
    expect(createAiProvider).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mnemonicService on the OpenAI path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetQuotaBreakers();
    vi.mocked(db.query.cards.findFirst).mockResolvedValue({ id: 1, deckId: 2, front: 'la biblioteca', back: 'library' } as never);
    vi.mocked(checkModeration).mockResolvedValue({ flagged: false, categories: {} });
  });

  it('logs the OpenAI mnemonic model and keeps the generic failure for OpenAI errors', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true, provider: 'openai', openaiApiKey: 'sk-test', mnemonicEnabled: true, mnemonicModel: 'gpt-5.6-luna',
    } as never);
    vi.mocked(createAiProvider).mockResolvedValue({
      name: 'openai', generateMnemonic: vi.fn().mockRejectedValue(new Error('OpenAI mnemonic generation failed: 500')),
    } as never);

    const err = await generateMnemonic(1, 1).catch((e: unknown) => e as { code?: string; cause?: { appCode?: string } });

    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(err.cause?.appCode).toBe('AI_GENERATION_FAILED');
    expect(logAiRequest).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai', success: false, model: 'gpt-5.6-luna', requestId: undefined,
    }));
  });

  it('stores nothing when moderation fails on a suggestion OpenAI wrote (fails closed, as before v1.20.0)', async () => {
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true, provider: 'openai', openaiApiKey: 'sk-test', mnemonicEnabled: true, mnemonicModel: 'gpt-5.6-luna',
    } as never);
    vi.mocked(createAiProvider).mockResolvedValue({
      name: 'openai', generateMnemonic: vi.fn().mockResolvedValue({ text: 'Picture a PEAR walking a dog' }),
    } as never);
    vi.mocked(checkModeration).mockRejectedValue(new TypeError('fetch failed'));

    const err = await generateMnemonic(1, 1).catch((e: unknown) => e as { code?: string; cause?: { appCode?: string } });

    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(err.cause?.appCode).toBe('AI_GENERATION_FAILED');
    expect(db.insert).not.toHaveBeenCalled();
    expect(logAiRequest).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', success: false, error: 'fetch failed' }));
  });

  it('logs that failure without the saved key, even one pasted across two lines', async () => {
    const key = 'sk-proj-FAKEFAKEFAKEFAKE1234\nFAKETAIL5678';
    vi.mocked(getAiRuntimeConfig).mockResolvedValue({
      aiEnabled: true, provider: 'openai', openaiApiKey: key, mnemonicEnabled: true, mnemonicModel: 'gpt-5.6-luna',
    } as never);
    vi.mocked(createAiProvider).mockResolvedValue({
      name: 'openai', generateMnemonic: vi.fn().mockResolvedValue({ text: 'Picture a PEAR walking a dog' }),
    } as never);
    vi.mocked(checkModeration).mockRejectedValue(new TypeError(`Headers.append: "Bearer ${key}" is an invalid header value.`));

    await expect(generateMnemonic(1, 1)).rejects.toMatchObject({ cause: { appCode: 'AI_GENERATION_FAILED' } });

    const logged = JSON.stringify(vi.mocked(logAiRequest).mock.calls);
    expect(logged).toContain('[REDACTED_KEY]');
    expect(logged).not.toContain('FAKEFAKE');
    expect(logged).not.toContain('FAKETAIL');
  });
});
