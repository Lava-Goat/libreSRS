// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: { ...log, child: () => log },
}));

import { testAnthropicKey } from './anthropicKeyTest.js';
import { __resetAnthropicGate } from './anthropicProvider.js';
import { __resetQuotaBreakers, getQuotaBreakerState, noteAiOutcome } from './quotaBreaker.js';

const TYPED_KEY = 'sk-ant-api03-TYPEDKEY-0123456789';
const SAVED_KEY = 'sk-ant-api03-SAVEDKEY-9876543210';

function ok(model = 'claude-opus-5-5', extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model,
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 14, output_tokens: 30 },
    ...extra,
  }), { status: 200, headers: { 'request-id': 'req_ok' } });
}

function fail(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_fail' }), { status });
}

function everythingLogged(): string {
  return JSON.stringify([log.info.mock.calls, log.error.mock.calls, log.warn.mock.calls, log.debug.mock.calls]);
}

describe('testAnthropicKey', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAnthropicGate();
    __resetQuotaBreakers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls each model in turn with a tiny prompt, no fallbacks, and passes', async () => {
    fetchMock.mockImplementationOnce(async () => ok('claude-opus-5-5')).mockImplementationOnce(async () => ok('claude-haiku-5-5'));

    const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5', 'claude-haiku-5-5'], source: 'typed' });

    expect(result).toEqual({
      ok: true,
      checks: [
        { model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', seconds: expect.any(Number) },
        { model: 'claude-haiku-5-5', servedModel: 'claude-haiku-5-5', seconds: expect.any(Number) },
      ],
    });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string));
    expect(bodies.map((b) => b.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(bodies[0]).toMatchObject({
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    });
    expect(bodies[0]).not.toHaveProperty('fallbacks');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('anthropic-beta');
  });

  it('counts any 2xx as a pass, even a refusal or a max_tokens stop', async () => {
    fetchMock
      .mockImplementationOnce(async () => ok('claude-opus-5-5', { content: [], stop_reason: 'refusal' }))
      .mockImplementationOnce(async () => ok('claude-sonnet-5-5', { stop_reason: 'max_tokens' }));

    const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5', 'claude-sonnet-5-5'], source: 'typed' });

    expect(result.ok).toBe(true);
  });

  it('stops at the first failure and reports it', async () => {
    fetchMock.mockImplementationOnce(async () => ok()).mockImplementationOnce(async () =>
      fail(404, 'not_found_error', 'model: claude-haiku-9-9'));

    const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5', 'claude-haiku-9-9'], source: 'typed' });

    expect(result).toEqual({
      ok: false,
      kind: 'model',
      model: 'claude-haiku-9-9',
      status: 404,
      requestId: 'req_fail',
      detail: 'Anthropic key test failed: 404 not_found_error: model: claude-haiku-9-9 [req_fail]',
    });
  });

  it.each([
    [401, 'authentication_error', 'invalid x-api-key', 'auth'],
    [403, 'permission_error', 'not allowed', 'auth'],
    [402, 'billing_error', 'Add credit.', 'billing'],
    [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.', 'billing'],
    [400, 'invalid_request_error', 'messages: malformed', 'other'],
  ])('maps a %i %s to %s', async (status, type, message, kind) => {
    fetchMock.mockImplementation(async () => fail(status, type, message));

    const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5'], source: 'typed' });

    expect(result).toMatchObject({ ok: false, kind, model: 'claude-opus-5-5', status });
  });

  it('maps a rate limit or an overload (after its retry) to busy', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => fail(529, 'overloaded_error', 'Overloaded'));

    const pending = testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5'], source: 'typed' });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toMatchObject({ ok: false, kind: 'busy', status: 529 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('the breaker', () => {
    it('a pass with the saved key closes an open anthropic breaker at once', async () => {
      noteAiOutcome('anthropic', false, '402 billing_error');
      fetchMock.mockImplementation(async () => ok());

      const result = await testAnthropicKey({ apiKey: SAVED_KEY, models: ['claude-opus-5-5'], source: 'saved' });

      expect(result.ok).toBe(true);
      expect(getQuotaBreakerState('anthropic').open).toBe(false);
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', operation: 'testKey', success: true, model: 'claude-opus-5-5', requestId: 'req_ok' }),
        'AI request completed',
      );
    });

    it('a 402 with the saved key trips the anthropic breaker', async () => {
      fetchMock.mockImplementation(async () => fail(402, 'billing_error', 'Add credit.'));

      await testAnthropicKey({ apiKey: SAVED_KEY, models: ['claude-opus-5-5'], source: 'saved' });

      expect(getQuotaBreakerState('anthropic').open).toBe(true);
      expect(getQuotaBreakerState('openai').open).toBe(false);
    });

    it('a 402 with a typed key leaves the breaker alone (it may be another account)', async () => {
      fetchMock.mockImplementation(async () => fail(402, 'billing_error', 'Add credit.'));

      const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5'], source: 'typed' });

      expect(result).toMatchObject({ ok: false, kind: 'billing' });
      expect(getQuotaBreakerState('anthropic').open).toBe(false);
    });

    it('a pass with a typed key does not close an open breaker', async () => {
      noteAiOutcome('anthropic', false, '402 billing_error');
      fetchMock.mockImplementation(async () => ok());

      await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5'], source: 'typed' });

      expect(getQuotaBreakerState('anthropic').open).toBe(true);
    });

    it('runs even while the breaker is open (it is how the admin resumes)', async () => {
      noteAiOutcome('anthropic', false, '402 billing_error');
      fetchMock.mockImplementation(async () => ok());

      await testAnthropicKey({ apiKey: SAVED_KEY, models: ['claude-opus-5-5'], source: 'saved' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('logging', () => {
    it('logs a typed key test as one summary line and never the key, even when the API echoes it', async () => {
      fetchMock.mockImplementation(async () => fail(401, 'authentication_error', `invalid x-api-key ${TYPED_KEY}`));

      const result = await testAnthropicKey({ apiKey: TYPED_KEY, models: ['claude-opus-5-5'], source: 'typed' });

      expect(JSON.stringify(result)).not.toContain('TYPEDKEY');
      expect(everythingLogged()).not.toContain('TYPEDKEY');
      expect(log.error).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledWith({
        event: 'ai.anthropic_key_test',
        source: 'typed',
        ok: false,
        kind: 'auth',
        status: 401,
        requestId: 'req_fail',
        models: ['claude-opus-5-5'],
      }, 'Anthropic key test failed');
    });

    it('never logs the saved key either', async () => {
      fetchMock.mockImplementation(async () => fail(401, 'authentication_error', `invalid x-api-key ${SAVED_KEY}`));

      await testAnthropicKey({ apiKey: SAVED_KEY, models: ['claude-opus-5-5'], source: 'saved' });

      expect(everythingLogged()).not.toContain('SAVEDKEY');
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', operation: 'testKey', success: false, requestId: 'req_fail' }),
        'AI request failed',
      );
    });
  });
});
