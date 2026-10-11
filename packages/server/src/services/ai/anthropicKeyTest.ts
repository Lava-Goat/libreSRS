// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The admin's "Test key" button: one tiny Claude call per chosen model, so a bad
 * key, an empty balance or a retired model shows up before a student card does.
 * At most two calls of ~20 input and ≤512 output tokens: under $0.01 on Opus 5.5.
 *
 * Saved key: each outcome goes through logAiRequest, so an empty balance trips the
 * 'anthropic' breaker and a pass closes it at once ("Test key to resume").
 * Typed key: it may belong to another account, so it never touches the breaker and
 * is only summarized in one log line. The key itself is never stored or logged.
 */
import { logger } from '../../logger.js';
import { logAiRequest } from './aiLogger.js';
import {
  AnthropicApiError,
  KEY_TEST_MAX_TOKENS,
  anthropicMessages,
  redactAnthropicKey,
  type AnthropicErrorKind,
} from './anthropicProvider.js';

const KEY_TEST_PROMPT = 'Reply with the single word OK.';

export type AnthropicKeyTestKind = 'no_key' | 'auth' | 'billing' | 'model' | 'busy' | 'other';

export interface AnthropicKeyCheck {
  model: string;
  /** The model that answered (the test sends no fallbacks, so normally the same). */
  servedModel: string;
  seconds: number;
}

export type AnthropicKeyTestResult =
  | { ok: true; checks: AnthropicKeyCheck[] }
  | {
      ok: false;
      kind: AnthropicKeyTestKind;
      /** The model that failed. */
      model?: string;
      status?: number | null;
      requestId?: string | null;
      /** The API's own error text, key-free. */
      detail?: string;
    };

export interface AnthropicKeyTestInput {
  apiKey: string;
  /** Distinct claude-* ids, called in turn; the first failure stops the test. */
  models: string[];
  source: 'typed' | 'saved';
}

function toTestKind(kind: AnthropicErrorKind): AnthropicKeyTestKind {
  switch (kind) {
    case 'auth':
    case 'billing':
    case 'model':
      return kind;
    case 'rate_limit':
    case 'busy':
      return 'busy';
    default:
      return 'other';
  }
}

/** Any 2xx is a pass: even a refusal or a max_tokens stop proves the key and the credit. */
export async function testAnthropicKey(input: AnthropicKeyTestInput): Promise<AnthropicKeyTestResult> {
  const { apiKey, models, source } = input;
  const checks: AnthropicKeyCheck[] = [];

  for (const model of models) {
    const startTime = Date.now();
    try {
      const reply = await anthropicMessages(apiKey, {
        model,
        prompt: KEY_TEST_PROMPT,
        maxTokens: KEY_TEST_MAX_TOKENS,
        operation: 'key test',
        fallbacks: false,
      });
      const durationMs = Date.now() - startTime;
      if (source === 'saved') {
        logAiRequest({ provider: 'anthropic', operation: 'testKey', model, durationMs, success: true, requestId: reply.requestId });
      }
      checks.push({ model, servedModel: reply.servedModel, seconds: Math.round(durationMs / 100) / 10 });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof AnthropicApiError
        ? err
        : new AnthropicApiError(
          redactAnthropicKey(`Anthropic key test failed: ${err instanceof Error ? err.message : 'unknown error'}`, apiKey).slice(0, 500),
          'bad_request',
        );
      if (source === 'saved') {
        logAiRequest({
          provider: 'anthropic', operation: 'testKey', model, durationMs, success: false,
          error: error.message, requestId: error.requestId,
        });
      }
      const kind = toTestKind(error.kind);
      logger.info({
        event: 'ai.anthropic_key_test', source, ok: false, kind, status: error.status, requestId: error.requestId, models,
      }, 'Anthropic key test failed');
      return { ok: false, kind, model, status: error.status, requestId: error.requestId, detail: error.message };
    }
  }

  logger.info({ event: 'ai.anthropic_key_test', source, ok: true, models }, 'Anthropic key test passed');
  return { ok: true, checks };
}
