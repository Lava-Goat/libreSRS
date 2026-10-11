// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: { ...log, child: () => log },
}));

import { logAiRequest } from './aiLogger.js';
import { __resetQuotaBreakers, getQuotaBreakerState, listQuotaBreakers } from './quotaBreaker.js';

const ANTHROPIC_KEY = 'sk-ant-api03-AbCdEf123456_SECRET-xyz';
const OPENAI_KEY = 'sk-proj-ABCDEFGHIJKLMNOP1234567890';

function everythingLogged(): string {
  return JSON.stringify([log.info.mock.calls, log.error.mock.calls, log.warn.mock.calls, log.debug.mock.calls]);
}

describe('logAiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetQuotaBreakers();
  });

  it('scrubs Anthropic and OpenAI keys (and emails) from the prompt and the error', () => {
    logAiRequest({
      provider: 'anthropic',
      operation: 'generateMnemonic',
      prompt: `teacher@school.test pasted ${ANTHROPIC_KEY} and ${OPENAI_KEY}`,
      success: false,
      error: `Anthropic mnemonic generation failed: 401 authentication_error: invalid x-api-key ${ANTHROPIC_KEY}; Bearer ${OPENAI_KEY}`,
    });

    const logged = everythingLogged();
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('ABCDEFGHIJKLMNOP');
    expect(logged).not.toContain('teacher@school.test');
    const entry = log.error.mock.calls[0][0] as { prompt: string; error: string };
    expect(entry.prompt).toBe('[REDACTED_EMAIL] pasted [REDACTED_KEY] and [REDACTED_KEY]');
    expect(entry.error).toContain('invalid x-api-key [REDACTED_KEY]; Bearer [REDACTED_KEY]');
  });

  it('leaves ordinary words with "sk-" inside them alone', () => {
    logAiRequest({ provider: 'openai', operation: 'generateMnemonic', success: false, error: 'task-scheduler-queue-overflowed-again' });

    expect((log.error.mock.calls[0][0] as { error: string }).error).toBe('task-scheduler-queue-overflowed-again');
  });

  it('still trips the breaker on an exhausted-credit error, with a scrubbed reason', () => {
    logAiRequest({
      provider: 'anthropic',
      operation: 'generateMnemonic',
      success: false,
      error: `Anthropic mnemonic generation failed: 402 billing_error: Your credit balance is too low (key ${ANTHROPIC_KEY})`,
    });

    expect(getQuotaBreakerState('anthropic').open).toBe(true);
    expect(getQuotaBreakerState('openai').open).toBe(false);
    const [paused] = listQuotaBreakers();
    expect(paused.reason).toContain('billing_error');
    expect(paused.reason).toContain('[REDACTED_KEY]');
    expect(paused.reason).not.toContain('SECRET');
  });

  it('closes the breaker on a success', () => {
    logAiRequest({ provider: 'anthropic', operation: 'testKey', success: false, error: '402 billing_error' });
    expect(getQuotaBreakerState('anthropic').open).toBe(true);

    logAiRequest({ provider: 'anthropic', operation: 'testKey', success: true });

    expect(getQuotaBreakerState('anthropic').open).toBe(false);
  });

  it('passes the model, request id and token counts through', () => {
    logAiRequest({
      provider: 'anthropic',
      operation: 'generateMnemonic',
      cardId: 7,
      userId: 1,
      durationMs: 1234,
      success: true,
      model: 'claude-opus-5-5',
      requestId: 'req_test_0001',
      inputTokens: 350,
      outputTokens: 120,
    });

    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      operation: 'generateMnemonic',
      model: 'claude-opus-5-5',
      requestId: 'req_test_0001',
      inputTokens: 350,
      outputTokens: 120,
      success: true,
    }), 'AI request completed');
  });
});
