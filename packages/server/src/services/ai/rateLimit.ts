// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { TRPCError } from '@trpc/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limits = new Map<number, RateLimitEntry>();

// Budget covers only REAL provider calls (cache hits must be checked by the
// caller first). 20/min tolerates auto-mnemonic study bursts while still
// capping per-student OpenAI spend.
export function checkAiRateLimit(userId: number, maxPerMinute = 20): void {
  const now = Date.now();
  const entry = limits.get(userId);

  if (!entry || now >= entry.resetAt) {
    // Prune expired entries when map grows large to prevent unbounded growth
    if (limits.size > 500) {
      for (const [k, e] of limits) {
        if (now >= e.resetAt) limits.delete(k);
      }
    }
    limits.set(userId, { count: 1, resetAt: now + 60_000 });
    return;
  }

  if (entry.count >= maxPerMinute) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'AI rate limit exceeded. Please try again in a moment.',
      cause: { appCode: 'AI_RATE_LIMIT' },
    });
  }

  entry.count += 1;
}

/** Reset rate limits (for testing) */
export function resetRateLimits(): void {
  limits.clear();
}
