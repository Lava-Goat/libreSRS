// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_FALLBACK_BETA,
  ANTHROPIC_MESSAGES_URL,
  AnthropicApiError,
  AnthropicPausedError,
  AnthropicProvider,
  MAX_IN_FLIGHT,
  __resetAnthropicGate,
  anthropicMessages,
} from './anthropicProvider.js';
import { buildMnemonicPrompt } from './aiTemplates.js';
import { __resetQuotaBreakers, noteAiOutcome } from './quotaBreaker.js';

const KEY = 'sk-ant-test-SECRET1234';
const MNEMONIC_CONTEXT = { front: 'la biblioteca', back: 'library', sourceLanguage: 'es', targetLanguage: 'en' };

type Block = { type: string; text?: string; thinking?: string; from?: unknown; to?: unknown };

function message(content: Block[], extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: 'end_turn',
    usage: { input_tokens: 321, output_tokens: 45 },
    ...extra,
  };
}

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_header', ...headers },
  });
}

function apiError(status: number, type: string, msg: string, extra: Record<string, unknown> = {}) {
  return reply({ type: 'error', error: { type, message: msg, ...extra }, request_id: 'req_body' }, status);
}

function text(t: string): Response {
  return reply(message([{ type: 'text', text: t }]));
}

function provider(models = { mnemonicModel: 'claude-opus-5-5' }) {
  return new AnthropicProvider(KEY, models);
}

describe('AnthropicProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAnthropicGate();
    __resetQuotaBreakers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function sentBody(call = 0): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[call][1].body as string);
  }

  function sentHeaders(call = 0): Record<string, string> {
    return fetchMock.mock.calls[call][1].headers as Record<string, string>;
  }

  describe('request shape', () => {
    it('POSTs a mnemonic request to the Messages API with the key, version and JSON headers', async () => {
      fetchMock.mockResolvedValue(text('Think of a library full of books.'));

      await provider().generateMnemonic(MNEMONIC_CONTEXT);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(ANTHROPIC_MESSAGES_URL);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(sentHeaders()).toMatchObject({
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      });
      expect(sentBody()).toEqual({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: buildMnemonicPrompt(MNEMONIC_CONTEXT) }],
        output_config: { effort: 'low' },
        fallbacks: 'default',
      });
    });

    it('sends the same prompt the OpenAI path does, style, how it sounds, earlier suggestions and other cards included (v1.20.0)', async () => {
      fetchMock.mockResolvedValue(text('Picture TEN GOats on leashes: I have ten goats!'));
      const context = {
        front: 'tengo', back: 'I have', sourceLanguage: 'es', targetLanguage: 'en',
        style: 'keyword' as const, alreadySuggested: ['TANGO: I have a tango lesson'],
        suggestedInOtherStyle: ['TENGO quince años = I’m 15'], otherCards: ['perro = dog: a PEAR walking a dog'],
      };

      await provider().generateMnemonic(context);

      const content = (sentBody().messages as { content: string }[])[0].content;
      expect(content).toBe(buildMnemonicPrompt(context));
      expect(content).toContain('Sounds like: TEHN-goh (English-style respelling; stressed syllable in capitals)');
      expect(content).toContain('Already suggested for this card in this style (write a different one, with a different keyword):\n- TANGO: I have a tango lesson');
      expect(content).toContain('- TENGO quince años = I’m 15');
      expect(content).toContain('- perro = dog: a PEAR walking a dog');
    });

    it('scores no cognates: v1.20.0 removed the cognate system', () => {
      expect('scoreCognate' in provider()).toBe(false);
    });

    it('never sends sampling, thinking or system parameters (each is a 400 on current models)', async () => {
      fetchMock.mockResolvedValue(text('A mnemonic.'));

      await provider().generateMnemonic(MNEMONIC_CONTEXT);

      const body = sentBody();
      for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'system', 'tools']) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it.each(['claude-opus-5-5', 'claude-sonnet-5-5'])('asks for server-side fallbacks on %s', async (model) => {
      fetchMock.mockResolvedValue(text('A mnemonic.'));

      await provider({ mnemonicModel: model }).generateMnemonic(MNEMONIC_CONTEXT);

      expect(sentBody().fallbacks).toBe('default');
      expect(sentHeaders()['anthropic-beta']).toBe(ANTHROPIC_FALLBACK_BETA);
      expect(ANTHROPIC_FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
    });

    it('never asks for fallbacks on Haiku, which has none', async () => {
      fetchMock.mockResolvedValue(text('A mnemonic.'));

      await provider({ mnemonicModel: 'claude-haiku-5-5' }).generateMnemonic(MNEMONIC_CONTEXT);

      expect(sentBody()).not.toHaveProperty('fallbacks');
      expect(sentHeaders()).not.toHaveProperty('anthropic-beta');
    });

    it('leaves fallbacks out when the caller opts out (the key test)', async () => {
      fetchMock.mockResolvedValue(text('OK'));

      await anthropicMessages(KEY, {
        model: 'claude-opus-5-5', prompt: 'Reply with the single word OK.', maxTokens: 512, operation: 'key test', fallbacks: false,
      });

      expect(sentBody()).not.toHaveProperty('fallbacks');
      expect(sentBody().max_tokens).toBe(512);
      expect(sentHeaders()).not.toHaveProperty('anthropic-beta');
    });
  });

  describe('reading the answer', () => {
    it('reads past an empty thinking block instead of content[0]', async () => {
      fetchMock.mockResolvedValue(reply(message([
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Picture a library.' },
      ])));

      const result = await provider().generateMnemonic(MNEMONIC_CONTEXT);

      expect(result.text).toBe('Picture a library.');
    });

    it('uses only the text after the last fallback block, and reports the model that served it', async () => {
      fetchMock.mockResolvedValue(reply(message([
        { type: 'text', text: 'Declined partial. ' },
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
        { type: 'text', text: 'The fallback answer.' },
      ], { model: 'claude-opus-4-8' })));

      const result = await provider().generateMnemonic(MNEMONIC_CONTEXT);

      expect(result.text).toBe('The fallback answer.');
      expect(result.usage?.model).toBe('claude-opus-4-8');
    });

    it('strips markdown from mnemonics', async () => {
      fetchMock.mockResolvedValue(text('**Biblioteca** sounds like `bibliography` — a *library* of books.'));

      const result = await provider().generateMnemonic(MNEMONIC_CONTEXT);

      expect(result.text).toBe('Biblioteca sounds like bibliography — a library of books.');
    });

    it('treats a refusal as kind refusal and returns nothing', async () => {
      fetchMock.mockResolvedValue(reply(message([], { stop_reason: 'refusal' })));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({
        name: 'AnthropicApiError', kind: 'refusal', requestId: 'req_header',
      });
    });

    it('never stores a mnemonic cut off by max_tokens', async () => {
      fetchMock.mockResolvedValue(reply(message([{ type: 'text', text: 'Picture a lib' }], { stop_reason: 'max_tokens' })));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind: 'empty' });
    });

    it('treats empty text as kind empty', async () => {
      fetchMock.mockImplementation(async () => reply(message([{ type: 'thinking', thinking: '' }])));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind: 'empty' });
    });

    it('is named anthropic and reports the served model, tokens and request id', async () => {
      fetchMock.mockResolvedValue(text('Picture a library.'));

      const p = provider();
      const result = await p.generateMnemonic(MNEMONIC_CONTEXT);

      expect(p.name).toBe('anthropic');
      expect(result.usage).toEqual({ model: 'claude-opus-5-5', inputTokens: 321, outputTokens: 45, requestId: 'req_header' });
    });
  });

  describe('strip retries', () => {
    it('resends once without output_config when a 400 names effort', async () => {
      fetchMock
        .mockResolvedValueOnce(apiError(400, 'invalid_request_error', 'output_config.effort: This model does not support the effort parameter.'))
        .mockResolvedValueOnce(text('A mnemonic.'));

      await provider({ mnemonicModel: 'claude-haiku-4-5' }).generateMnemonic(MNEMONIC_CONTEXT);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentBody(0)).toHaveProperty('output_config');
      expect(sentBody(1)).not.toHaveProperty('output_config');
    });

    it('resends once without fallbacks or the beta header when a 400 names the anthropic-beta header', async () => {
      fetchMock
        .mockResolvedValueOnce(apiError(400, 'invalid_request_error', 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.'))
        .mockResolvedValueOnce(text('A mnemonic.'));

      await provider().generateMnemonic(MNEMONIC_CONTEXT);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentHeaders(0)['anthropic-beta']).toBe(ANTHROPIC_FALLBACK_BETA);
      expect(sentBody(1)).not.toHaveProperty('fallbacks');
      expect(sentHeaders(1)).not.toHaveProperty('anthropic-beta');
      expect(sentBody(1)).toHaveProperty('output_config');
    });

    it('strips each parameter at most once', async () => {
      fetchMock.mockImplementation(async () => apiError(400, 'invalid_request_error', 'output_config.effort is not supported'));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry any other 400', async () => {
      fetchMock.mockResolvedValue(apiError(400, 'invalid_request_error', 'messages: text content blocks must be non-empty'));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind: 'bad_request' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('transient retries', () => {
    it('retries a 429 once after retry-after (clamped to 10 s), then reports rate_limit', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => {
        const res = apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit');
        res.headers.set('retry-after', '30');
        return res;
      });

      const pending = provider().generateMnemonic(MNEMONIC_CONTEXT);
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('waits at least 1 s when retry-after is 0, and recovers on the retry', async () => {
      vi.useFakeTimers();
      const limited = apiError(429, 'rate_limit_error', 'rate limited');
      limited.headers.set('retry-after', '0');
      fetchMock.mockResolvedValueOnce(limited).mockResolvedValueOnce(text('A mnemonic.'));

      const pending = provider().generateMnemonic(MNEMONIC_CONTEXT);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ text: 'A mnemonic.' });
    });

    it('retries a 529 once after 2 s, then reports busy', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => apiError(529, 'overloaded_error', 'Overloaded'));

      const pending = provider().generateMnemonic(MNEMONIC_CONTEXT);
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'busy', status: 529 });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports a 500 as busy', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => apiError(500, 'api_error', 'Internal server error'));

      const pending = provider().generateMnemonic(MNEMONIC_CONTEXT);
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'busy', status: 500 });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
    });

    it('retries a network failure once, then reports busy', async () => {
      vi.useFakeTimers();
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const pending = provider().generateMnemonic(MNEMONIC_CONTEXT);
      const assertion = expect(pending).rejects.toMatchObject({
        kind: 'busy', message: 'Anthropic mnemonic generation failed: could not reach api.anthropic.com',
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a timeout', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({
        kind: 'busy', message: 'Anthropic mnemonic generation failed: no answer within 60 s',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors that are never retried', () => {
    it.each([
      [401, 'authentication_error', 'invalid x-api-key', 'auth'],
      [403, 'permission_error', 'Your API key does not have permission to use the specified resource.', 'auth'],
      [402, 'billing_error', 'There is an issue with your billing or payment information.', 'billing'],
      [404, 'not_found_error', 'model: claude-opus-9', 'model'],
      [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', 'billing'],
      [400, 'invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', 'billing'],
    ])('%i %s gives %s after one call', async (status, type, msg, kind) => {
      fetchMock.mockResolvedValue(apiError(status, type, msg));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind, status, requestId: 'req_body' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // fetch refuses such a header before anything is sent (a TypeError, like a network failure):
    // it is the key that is wrong, so waiting a minute would never help.
    it.each([
      ['a zero-width space', 'sk-ant-api03-AAAAAAAA​BBBB'],
      ['a line break', 'sk-ant-api03-abc\ndef'],
      ['a typographic ellipsis', 'sk-ant-api03-abc…xyz'],
      ['a space', 'sk-ant-api03-abc def'],
    ])('reports a key with %s as auth, without sending or retrying', async (_what, key) => {
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        new Request(url, init); // header checks exactly as undici makes them
        return text('Think of a library.');
      });

      const err = await new AnthropicProvider(key, { mnemonicModel: 'claude-opus-5-5' })
        .generateMnemonic(MNEMONIC_CONTEXT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AnthropicApiError);
      expect(err).toMatchObject({ kind: 'auth', status: null });
      expect((err as Error).message).toBe(
        'Anthropic mnemonic generation failed: the API key has a character no key has (a space, a line break or an invisible character from copying)',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats the spend-cap 429 as billing, not a rate limit', async () => {
      fetchMock.mockResolvedValue(apiError(429, 'rate_limit_error',
        'You have reached your API usage limits: your organization has crossed its monthly API usage threshold.',
        { details: { error_code: 'enforced_spend_limit_reached' } }));

      const err = await provider().generateMnemonic(MNEMONIC_CONTEXT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AnthropicApiError);
      expect(err).toMatchObject({ kind: 'billing', status: 429 });
      expect((err as Error).message).toContain('(enforced_spend_limit_reached)');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('error messages', () => {
    it('carries status, type, code, message and request id, built from the body only', async () => {
      fetchMock.mockResolvedValue(apiError(402, 'billing_error', 'Add credit.', { details: { error_code: 'credit_needed' } }));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toThrow(
        'Anthropic mnemonic generation failed: 402 billing_error (credit_needed): Add credit. [req_body]',
      );
    });

    it('falls back to the raw text and the header request id when the body is not JSON', async () => {
      fetchMock.mockResolvedValue(reply('<html>Bad gateway</html>', 404));

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toThrow(
        'Anthropic mnemonic generation failed: 404: <html>Bad gateway</html> [req_header]',
      );
    });

    it('redacts a key the body echoes back, and stays within 500 characters', async () => {
      fetchMock.mockResolvedValue(apiError(401, 'authentication_error',
        `invalid x-api-key ${KEY} (also sk-ant-api03-OTHERKEY99) ${'x'.repeat(800)}`));

      const err = await provider().generateMnemonic(MNEMONIC_CONTEXT).catch((e: unknown) => e as Error);

      expect(err.message).toContain('[REDACTED_KEY]');
      expect(err.message).not.toContain('SECRET1234');
      expect(err.message).not.toContain('OTHERKEY99');
      expect(err.message.length).toBeLessThanOrEqual(500);
    });
  });

  describe('the concurrency gate', () => {
    it(`keeps at most ${MAX_IN_FLIGHT} requests in flight when 20 calls start together`, async () => {
      let inFlight = 0;
      let peak = 0;
      fetchMock.mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return text('A mnemonic.');
      });

      const p = provider();
      const results = await Promise.all(Array.from({ length: 20 }, () => p.generateMnemonic(MNEMONIC_CONTEXT)));

      expect(results).toHaveLength(20);
      expect(fetchMock).toHaveBeenCalledTimes(20);
      expect(peak).toBe(MAX_IN_FLIGHT);
      expect(MAX_IN_FLIGHT).toBe(8);
    });

    it('skips queued calls once the anthropic breaker opens, unless the caller ignores it', async () => {
      noteAiOutcome('anthropic', false, 'Anthropic mnemonic generation failed: 402 billing_error: no credit');

      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toBeInstanceOf(AnthropicPausedError);
      await expect(provider().generateMnemonic(MNEMONIC_CONTEXT)).rejects.toMatchObject({ kind: 'billing' });
      expect(fetchMock).not.toHaveBeenCalled();

      // The key test sends anyway: a pass is how the admin resumes.
      fetchMock.mockResolvedValue(text('OK'));
      await expect(anthropicMessages(KEY, {
        model: 'claude-opus-5-5', prompt: 'Reply with the single word OK.', maxTokens: 512, operation: 'key test', fallbacks: false,
      })).resolves.toMatchObject({ text: 'OK' });
    });
  });
});
