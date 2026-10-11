// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  noteAiOutcome, assertProviderHasQuota, getQuotaBreakerState,
  listQuotaBreakers, clearQuotaBreaker, __resetQuotaBreakers,
} from './quotaBreaker.js';

// The payload OpenAI returns when an account's balance is exhausted.
const REAL_ERROR = 'OpenAI mnemonic generation failed: {"error":{"message":"You have no credits '
  + 'remaining. Add credits to continue using the API at https://platform.openai.com/settings/'
  + 'organization/billing/.","type":"insufficient_quota","param":null,"code":"credit_balance_exhausted"}}';

beforeEach(() => __resetQuotaBreakers());
afterEach(() => vi.useRealTimers());

describe('quotaBreaker', () => {
  it('opens on the real exhausted-credit payload and then fails fast', () => {
    expect(() => assertProviderHasQuota('openai')).not.toThrow();

    noteAiOutcome('openai', false, REAL_ERROR);

    expect(getQuotaBreakerState('openai').open).toBe(true);
    expect(() => assertProviderHasQuota('openai')).toThrowError(/out of credit/i);
  });

  it('does not trip on ordinary failures', () => {
    noteAiOutcome('openai', false, 'OpenAI mnemonic generation failed: 500 internal server error');
    noteAiOutcome('openai', false, 'network timeout');
    expect(getQuotaBreakerState('openai').open).toBe(false);
  });

  it('is per provider, so an empty OpenAI balance never blocks ElevenLabs', () => {
    noteAiOutcome('openai', false, REAL_ERROR);

    expect(() => assertProviderHasQuota('openai')).toThrow();
    expect(() => assertProviderHasQuota('elevenlabs')).not.toThrow();
  });

  it('recognises other providers\' wording too', () => {
    noteAiOutcome('elevenlabs', false, 'quota_exceeded: not enough characters remaining');
    expect(getQuotaBreakerState('elevenlabs').open).toBe(true);
  });

  it('closes as soon as a request succeeds again', () => {
    noteAiOutcome('openai', false, REAL_ERROR);
    expect(getQuotaBreakerState('openai').open).toBe(true);

    noteAiOutcome('openai', true);

    expect(getQuotaBreakerState('openai').open).toBe(false);
    expect(() => assertProviderHasQuota('openai')).not.toThrow();
  });

  it('lets one request through to probe after the cooldown', () => {
    vi.useFakeTimers();
    noteAiOutcome('openai', false, REAL_ERROR);
    expect(getQuotaBreakerState('openai').open).toBe(true);

    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(getQuotaBreakerState('openai').open).toBe(true);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getQuotaBreakerState('openai').open).toBe(false);
  });

  it('carries the appCode the client needs to stop auto-generating', () => {
    noteAiOutcome('openai', false, REAL_ERROR);
    try {
      assertProviderHasQuota('openai');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { cause?: { appCode?: string } }).cause?.appCode).toBe('AI_QUOTA_EXHAUSTED');
    }
  });

  it('reports paused providers for the admin panel', () => {
    noteAiOutcome('openai', false, REAL_ERROR);
    const paused = listQuotaBreakers();
    expect(paused).toHaveLength(1);
    expect(paused[0].provider).toBe('openai');
    expect(paused[0].reason).toContain('credit');
  });

  describe('Anthropic', () => {
    // Shaped like AnthropicApiError messages: "Anthropic <op> failed: <status> <type>[ (<code>)]: <message> [<request_id>]".
    it.each([
      'Anthropic mnemonic generation failed: 400 invalid_request_error: Your credit balance is too low to access the '
        + 'Anthropic API. Please go to Plans & Billing to upgrade or purchase credits. [req_011]',
      'Anthropic mnemonic generation failed: 402 billing_error: There is an issue with your billing. [req_011]',
      'Anthropic mnemonic generation failed: 429 rate_limit_error (enforced_spend_limit_reached): You have reached your '
        + 'API usage limits: your organization has crossed its monthly API usage threshold. [req_011]',
      'Anthropic mnemonic generation failed: 400 invalid_request_error: You have reached your specified API usage '
        + 'limits. You will regain access on 2026-11-01 at 00:00 UTC. [req_011]',
      'Anthropic mnemonic generation failed: 400 invalid_request_error: You have reached your specified workspace API '
        + 'usage limits. [req_011]',
    ])('trips anthropic, and only anthropic, on %s', (error) => {
      noteAiOutcome('anthropic', false, error);

      expect(getQuotaBreakerState('anthropic').open).toBe(true);
      expect(getQuotaBreakerState('openai').open).toBe(false);
      expect(() => assertProviderHasQuota('openai')).not.toThrow();
    });

    it.each([
      'Anthropic mnemonic generation failed: 429 rate_limit_error: Number of request tokens has exceeded your per-minute rate limit [req_011]',
      'Anthropic mnemonic generation failed: 529 overloaded_error: Overloaded [req_011]',
      'Anthropic mnemonic generation failed: 500 api_error: Internal server error [req_011]',
      'Anthropic mnemonic generation failed: no answer within 60 s',
      'Anthropic mnemonic generation failed: could not reach api.anthropic.com',
    ])('does not trip on a busy minute: %s', (error) => {
      noteAiOutcome('anthropic', false, error);
      expect(getQuotaBreakerState('anthropic').open).toBe(false);
    });

    it('scrubs a key out of the reason the admin panel shows', () => {
      noteAiOutcome('anthropic', false, '402 billing_error: key sk-ant-api03-SECRETSECRET was declined');

      expect(listQuotaBreakers()[0].reason).toBe('402 billing_error: key [REDACTED_KEY] was declined');
    });
  });

  describe('clearQuotaBreaker', () => {
    it('closes an open breaker at once and leaves the others alone', () => {
      noteAiOutcome('anthropic', false, '402 billing_error');
      noteAiOutcome('openai', false, REAL_ERROR);

      expect(clearQuotaBreaker('anthropic')).toBe(true);

      expect(getQuotaBreakerState('anthropic').open).toBe(false);
      expect(() => assertProviderHasQuota('anthropic')).not.toThrow();
      expect(getQuotaBreakerState('openai').open).toBe(true);
    });

    it('returns false when nothing was open', () => {
      expect(clearQuotaBreaker('anthropic')).toBe(false);
    });
  });
});
