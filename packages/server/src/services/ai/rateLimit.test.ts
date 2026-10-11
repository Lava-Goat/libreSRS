// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAiRateLimit, resetRateLimits } from './rateLimit.js';

describe('checkAiRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-27T10:00:00.000Z'));
    resetRateLimits();
  });

  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it('allows requests up to the configured per-minute maximum', () => {
    expect(() => checkAiRateLimit(1, 3)).not.toThrow();
    expect(() => checkAiRateLimit(1, 3)).not.toThrow();
    expect(() => checkAiRateLimit(1, 3)).not.toThrow();
  });

  it('throws TOO_MANY_REQUESTS when max per minute is exceeded', () => {
    checkAiRateLimit(1, 2);
    checkAiRateLimit(1, 2);

    let thrown: unknown;
    try {
      checkAiRateLimit(1, 2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('TOO_MANY_REQUESTS');
  });

  it('resets counters after the one-minute window elapses', () => {
    checkAiRateLimit(5, 1);
    expect(() => checkAiRateLimit(5, 1)).toThrow();

    vi.advanceTimersByTime(60_001);

    expect(() => checkAiRateLimit(5, 1)).not.toThrow();
  });
});

