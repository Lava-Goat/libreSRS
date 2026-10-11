// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { logger } from '../../logger.js';
import { noteAiOutcome, redactApiKeys } from './quotaBreaker.js';

const aiLog = logger.child({ module: 'ai' });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function redactEmails(text: string): string {
  return text.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
}

/** Emails, then anything key-shaped: a second line of defence, since pino has no redact config. */
function redact(text: string): string {
  return redactApiKeys(redactEmails(text));
}

export interface AiLogEntry {
  provider: string;
  operation: string;
  cardId?: number;
  userId?: number;
  prompt?: string;
  durationMs?: number;
  success: boolean;
  error?: string;
  /** The model that served the request (a server-side fallback can differ from the one asked for). */
  model?: string;
  /** The provider's request id (Anthropic's request-id), for support tickets. */
  requestId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export function logAiRequest(entry: AiLogEntry): void {
  const prompt = entry.prompt ? redact(entry.prompt) : undefined;
  const error = entry.error ? redact(entry.error) : undefined;

  // Every AI service reports here on both paths, so this is the one place that
  // sees an exhausted-balance response no matter which operation hit it. The
  // breaker gets the scrubbed error: its reason is shown in the admin panel, and
  // the scrub leaves the provider's wording intact for the matcher.
  noteAiOutcome(entry.provider, entry.success, error);

  const safeEntry = { ...entry, prompt, error };

  if (entry.success) {
    aiLog.info(safeEntry, 'AI request completed');
  } else {
    aiLog.error(safeEntry, 'AI request failed');
  }
}
