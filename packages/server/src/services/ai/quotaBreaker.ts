// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Stops hammering a provider that has told us it is out of credit.
 *
 * Once a provider reports an exhausted balance, every request fails until a
 * human adds credit, and retrying only burns each user's AI rate limit. So the
 * breaker fails fast for a cooldown, then lets one request through to probe
 * for recovery.
 *
 * Breakers are keyed by provider name ('openai', 'elevenlabs', 'anthropic'), so
 * an empty balance on one account never pauses another.
 */
import { TRPCError } from '@trpc/server';
import { logger } from '../../logger.js';

const COOLDOWN_MS = 15 * 60 * 1000;

type BreakerState = { trippedAt: number; reason: string };
const tripped = new Map<string, BreakerState>();

/**
 * Provider wording for "your balance is empty", across OpenAI, ElevenLabs and
 * Anthropic. Anthropic's: `billing_error` (402) and the spend-cap code
 * `enforced_spend_limit_reached` (429) are documented, as are the prefixes
 * "You have reached your specified API usage limits" (400, a limit the admin
 * set) and "You have reached your API usage limits" (the tier's monthly cap);
 * "Your credit balance is too low" (400) is community-reported. Never match
 * rate_limit_error, overloaded_error or api_error: those are a busy minute, and
 * matching them would pause AI for the whole cooldown.
 */
function looksLikeExhaustedQuota(error: string): boolean {
  const e = error.toLowerCase();
  return e.includes('insufficient_quota')
    || e.includes('credit_balance_exhausted')
    || e.includes('no credits remaining')
    || e.includes('exceeded your current quota')
    || e.includes('quota_exceeded')
    || (e.includes('detected_unusual_activity') && e.includes('free tier'))
    || e.includes('billing_error')
    || e.includes('credit balance is too low')
    || e.includes('enforced_spend_limit_reached')
    || e.includes('api usage limits');
}

const API_KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{8,}/g, /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g];

/** Scrubs anything shaped like an Anthropic or OpenAI key. pino has no redact
 *  config, so text that reaches a log line or the admin panel passes here. */
export function redactApiKeys(text: string): string {
  return API_KEY_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[REDACTED_KEY]'), text);
}

/** Fed by logAiRequest so every service participates without its own wiring. */
export function noteAiOutcome(provider: string, success: boolean, error?: string): void {
  if (success) {
    if (tripped.delete(provider)) {
      logger.info({ provider }, 'AI provider recovered — quota breaker closed');
    }
    return;
  }
  if (!error || !looksLikeExhaustedQuota(error)) return;
  if (tripped.has(provider)) return;

  // The reason is shown in the admin panel; callers already scrub, this is the backstop.
  tripped.set(provider, { trippedAt: Date.now(), reason: redactApiKeys(error).slice(0, 300) });
  logger.error(
    { provider, event: 'ai.quota_exhausted' },
    'AI provider reports an exhausted balance — pausing requests until credit is added',
  );
}

export function getQuotaBreakerState(provider: string): { open: boolean; since: Date | null; reason: string | null } {
  const state = tripped.get(provider);
  if (!state) return { open: false, since: null, reason: null };
  if (Date.now() - state.trippedAt >= COOLDOWN_MS) {
    // Cooldown elapsed: let the next real request through as the probe.
    tripped.delete(provider);
    return { open: false, since: null, reason: null };
  }
  return { open: true, since: new Date(state.trippedAt), reason: state.reason };
}

/** All providers currently paused — for the admin panel. */
export function listQuotaBreakers(): { provider: string; since: Date; reason: string }[] {
  const out: { provider: string; since: Date; reason: string }[] = [];
  for (const provider of [...tripped.keys()]) {
    const state = getQuotaBreakerState(provider);
    if (state.open && state.since) {
      out.push({ provider, since: state.since, reason: state.reason ?? '' });
    }
  }
  return out;
}

/**
 * Call before spending a request on `provider`. Throws a distinct appCode so
 * the client can stop auto-generating rather than retrying into a wall.
 */
export function assertProviderHasQuota(provider: string): void {
  const state = getQuotaBreakerState(provider);
  if (!state.open) return;
  throw new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: 'AI is paused: the provider account is out of credit. An administrator needs to add credit.',
    cause: { appCode: 'AI_QUOTA_EXHAUSTED' },
  });
}

/** A newly saved key may be a new account: let the next request through at once. */
export function clearQuotaBreaker(provider: string): boolean {
  const had = tripped.delete(provider);
  if (had) logger.info({ provider, event: 'ai.quota_breaker_cleared' }, 'AI quota breaker cleared');
  return had;
}

/** Test hook. */
export function __resetQuotaBreakers(): void {
  tripped.clear();
}
