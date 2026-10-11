// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Claude (Anthropic) for mnemonic suggestions only — images, speech, transcription
 * and moderation never come here.
 *
 * Plain fetch, no SDK, so no new dependency. This module logs nothing itself; callers report through
 * logAiRequest / noteAiOutcome. Every error message is built from the response body
 * only (never from the request headers or options), redacted, and kept to 500
 * characters, so it is safe to log and to show the admin.
 *
 * Request settings, checked against the Claude API docs (2026-10-08):
 *  - output_config.effort 'low' (GA, no beta header): one-shot answers of a sentence
 *    or two. Opus 5.5 and Haiku 5.5 default to medium, Sonnet 5.5 to high.
 *  - No thinking, temperature, top_p, top_k, system or assistant prefill. Thinking
 *    'disabled' and budget_tokens 400 on current models, and sampling params 400 on
 *    Opus 5.5 (non-default values on Sonnet and Haiku 5.5). Omitting thinking runs
 *    adaptive thinking, which counts against max_tokens: hence the headroom below.
 *  - fallbacks: 'default' with the server-side-fallback-2026-07-01 beta, Opus, Sonnet
 *    and Fable ids only (Haiku 5.5 has no server-side fallback). A request one of
 *    Claude's safety classifiers declines is then re-run on Anthropic's recommended
 *    model for that category, in the same call; the top-level `model` names who served it.
 *  - An optional parameter a model rejects (effort on older models, an unknown beta)
 *    is stripped and the request resent once, like OpenAIProvider.chatCompletion does.
 */
import type {
  AiMnemonicResult,
  AiUsage,
  MnemonicContext,
  TextProvider,
} from './types.js';
import { ANTHROPIC_EFFORT, buildMnemonicPrompt } from './aiTemplates.js';
import { stripInlineMarkdown } from './textOutput.js';
import { getQuotaBreakerState } from './quotaBreaker.js';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const REQUEST_TIMEOUT_MS = 60_000;
/** At most this many Claude requests at once, so a burst never turns into 429s. */
export const MAX_IN_FLIGHT = 8;
// Thinking counts against max_tokens (only generated tokens are billed), so this
// leaves room for it before the one or two sentences that matter.
const MNEMONIC_MAX_TOKENS = 4_000;
export const KEY_TEST_MAX_TOKENS = 512;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_ERROR_LENGTH = 500;
/** Models with a server-side refusal fallback. */
const FALLBACK_MODEL = /^claude-(opus|sonnet|fable)-/i;

export type AnthropicOperation = 'mnemonic generation' | 'key test';

export type AnthropicErrorKind =
  'auth' | 'billing' | 'rate_limit' | 'busy' | 'model' | 'bad_request' | 'refusal' | 'empty';

export class AnthropicApiError extends Error {
  override readonly name: string = 'AnthropicApiError';
  constructor(
    message: string,
    readonly kind: AnthropicErrorKind,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

/** Thrown instead of sending while the 'anthropic' quota breaker is open. A call that
 *  queued behind the gate before an earlier answer emptied the balance checks the
 *  breaker again when it gets its slot. */
export class AnthropicPausedError extends AnthropicApiError {
  override readonly name: string = 'AnthropicPausedError';
  constructor(operation: AnthropicOperation) {
    super(`Anthropic ${operation} skipped: paused until the Anthropic account has credit`, 'billing');
  }
}

export interface AnthropicReply {
  text: string;
  stopReason: string | null;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
}

export interface AnthropicMessagesOptions {
  model: string;
  prompt: string;
  maxTokens: number;
  operation: AnthropicOperation;
  /** Ask for server-side refusal fallbacks; sent only for Opus, Sonnet and Fable ids. Default true. */
  fallbacks?: boolean;
  /** Skip, as a billing error, while the 'anthropic' breaker is open. The key test leaves
   *  this off: a test with the saved key is how the admin resumes a paused account. */
  respectBreaker?: boolean;
}

// ---------------------------------------------------------------------------
// The concurrency gate: every attempt (fetch plus body read) holds a slot. A
// finished attempt hands its slot straight to the next waiter, so the cap is
// never exceeded. Retry sleeps happen outside the slot.
// ---------------------------------------------------------------------------

let inFlight = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_IN_FLIGHT) inFlight++;
  else await new Promise<void>((resolve) => queue.push(resolve));
  try {
    return await fn();
  } finally {
    const next = queue.shift();
    if (next) next();
    else inFlight--;
  }
}

/** Test hook. */
export function __resetAnthropicGate(): void {
  inFlight = 0;
  queue.length = 0;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a key can go in the x-api-key header at all: printable ASCII with no space, like every
 * Anthropic key. A zero-width space, a typographic "…" or a line break picked up when copying
 * makes fetch refuse the header before sending, and a space is never part of a key.
 */
export function isSendableAnthropicKey(apiKey: string): boolean {
  return /^[\x21-\x7E]+$/.test(apiKey);
}

/** Replaces the exact key and anything shaped like an Anthropic key. */
export function redactAnthropicKey(text: string, apiKey: string): string {
  const key = apiKey.trim();
  const withoutKey = key.length >= 8 ? text.split(key).join('[REDACTED_KEY]') : text;
  return withoutKey.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]');
}

type ApiError = { type: string | null; message: string; code: string | null; requestId: string | null };

function parseErrorBody(raw: string): ApiError {
  try {
    const body = JSON.parse(raw) as {
      error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } | null };
      request_id?: unknown;
    };
    const error = body?.error;
    if (error && typeof error === 'object') {
      return {
        type: typeof error.type === 'string' ? error.type : null,
        message: typeof error.message === 'string' ? error.message : '',
        code: typeof error.details?.error_code === 'string' ? error.details.error_code : null,
        requestId: typeof body.request_id === 'string' ? body.request_id : null,
      };
    }
  } catch {
    // Not JSON (a proxy's HTML page, say): fall through to the raw text.
  }
  return { type: null, message: raw.slice(0, 300), code: null, requestId: null };
}

/** First match wins. */
function classifyError(status: number, error: ApiError): AnthropicErrorKind {
  const m = error.message.toLowerCase();
  // Out of credit or at a spend limit: a human has to act, so it is never retried.
  // The tier spend cap is a 429 rate_limit_error told apart by its error_code.
  if (status === 402 || error.type === 'billing_error' || m.includes('credit balance is too low')
    || error.code === 'enforced_spend_limit_reached' || m.includes('api usage limits')) {
    return 'billing';
  }
  if (status === 401 || status === 403 || error.type === 'authentication_error' || error.type === 'permission_error') {
    return 'auth';
  }
  // An unknown or retired model, or one this account may not use, is the same 404.
  if (status === 404 || error.type === 'not_found_error') return 'model';
  if (status === 429 || error.type === 'rate_limit_error') return 'rate_limit';
  if (status >= 500 || error.type === 'overloaded_error' || error.type === 'api_error' || error.type === 'timeout_error') {
    return 'busy';
  }
  return 'bad_request';
}

/** retry-after is in seconds; clamped to 1-10 s, 2 s when absent. */
function retryDelayMs(retryAfter: string | null): number {
  const seconds = retryAfter == null ? NaN : Number(retryAfter);
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(10, Math.max(1, seconds)) * 1000;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function readReply(raw: string, requestedModel: string, requestId: string | null, operation: AnthropicOperation, status: number): AnthropicReply {
  let data: {
    content?: { type?: string; text?: string }[];
    stop_reason?: string | null;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AnthropicApiError(`Anthropic ${operation} failed: the response was not JSON`, 'empty', status, requestId);
  }
  const blocks = Array.isArray(data?.content) ? data.content : [];
  // Never read content[0]: on thinking models a thinking block (empty text by
  // default) comes first, and after a fallback only what follows the last
  // fallback block is the served answer.
  let start = 0;
  blocks.forEach((block, i) => { if (block?.type === 'fallback') start = i + 1; });
  const text = blocks.slice(start)
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  const tokens = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    text,
    stopReason: data?.stop_reason ?? null,
    servedModel: typeof data?.model === 'string' && data.model ? data.model : requestedModel,
    inputTokens: tokens(data?.usage?.input_tokens),
    outputTokens: tokens(data?.usage?.output_tokens),
    requestId,
  };
}

/**
 * One Messages API call with the gate, one strip retry per optional parameter and
 * one transient retry (429, 5xx/529 or a network failure). Returns any 2xx reply
 * without judging stop_reason; throws AnthropicApiError otherwise.
 */
export async function anthropicMessages(apiKey: string, options: AnthropicMessagesOptions): Promise<AnthropicReply> {
  const { model, prompt, maxTokens, operation } = options;
  // fetch would reject such a key as a TypeError, which reads as a network failure ("busy"):
  // say what is wrong instead, without the key, and without a pointless retry.
  if (!isSendableAnthropicKey(apiKey)) {
    throw new AnthropicApiError(
      `Anthropic ${operation} failed: the API key has a character no key has (a space, a line break or an invisible character from copying)`,
      'auth',
    );
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: ANTHROPIC_EFFORT },
  };
  if (options.fallbacks !== false && FALLBACK_MODEL.test(model.trim())) {
    body.fallbacks = 'default';
  }

  let transientRetried = false;
  for (;;) {
    let res: Response;
    let raw: string;
    try {
      ({ res, raw } = await withSlot(async () => {
        if (options.respectBreaker && getQuotaBreakerState('anthropic').open) {
          throw new AnthropicPausedError(operation);
        }
        const response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
            // The beta header travels only with the parameter it gates.
            ...('fallbacks' in body ? { 'anthropic-beta': ANTHROPIC_FALLBACK_BETA } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return { res: response, raw: await response.text() };
      }));
    } catch (err) {
      if (err instanceof AnthropicApiError) throw err;
      // A timeout already waited a full minute: retrying would double the wait.
      if (isTimeout(err)) {
        throw new AnthropicApiError(`Anthropic ${operation} failed: no answer within 60 s`, 'busy');
      }
      if (!transientRetried) {
        transientRetried = true;
        await sleep(DEFAULT_RETRY_DELAY_MS);
        continue;
      }
      throw new AnthropicApiError(`Anthropic ${operation} failed: could not reach api.anthropic.com`, 'busy');
    }

    const headerRequestId = res.headers.get('request-id');
    if (res.ok) return readReply(raw, model, headerRequestId, operation, res.status);

    const error = parseErrorBody(raw);
    if (res.status === 400) {
      // Haiku 4.5 and Sonnet 4.5 reject effort; an unknown or retired beta reads
      // "Unexpected value(s) `…` for the `anthropic-beta` header." Drop the offender
      // and resend, once per parameter.
      if ('output_config' in body && /effort|output_config/i.test(error.message)) {
        delete body.output_config;
        continue;
      }
      if ('fallbacks' in body && /fallback|anthropic-beta/i.test(error.message)) {
        delete body.fallbacks;
        continue;
      }
    }

    const kind = classifyError(res.status, error);
    if ((kind === 'rate_limit' || kind === 'busy') && !transientRetried) {
      transientRetried = true;
      await sleep(retryDelayMs(res.headers.get('retry-after')));
      continue;
    }

    const requestId = error.requestId ?? headerRequestId;
    const message = `Anthropic ${operation} failed: ${res.status}${error.type ? ` ${error.type}` : ''}`
      + `${error.code ? ` (${error.code})` : ''}: ${error.message}${requestId ? ` [${requestId}]` : ''}`;
    throw new AnthropicApiError(
      redactAnthropicKey(message, apiKey).slice(0, MAX_ERROR_LENGTH),
      kind,
      res.status,
      requestId,
    );
  }
}

function usageOf(reply: AnthropicReply): AiUsage {
  return {
    model: reply.servedModel,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    requestId: reply.requestId,
  };
}

/** A refusal or a max_tokens stop is never stored: a truncated mnemonic is worse than none. */
function assertAnswered(reply: AnthropicReply, operation: AnthropicOperation): void {
  if (reply.stopReason === 'refusal') {
    throw new AnthropicApiError(`Anthropic ${operation} was declined by the model (refusal)`, 'refusal', null, reply.requestId);
  }
  if (reply.stopReason === 'max_tokens') {
    throw new AnthropicApiError(`Anthropic ${operation} ran out of tokens before answering`, 'empty', null, reply.requestId);
  }
  if (!reply.text) {
    throw new AnthropicApiError(`Anthropic ${operation} returned an empty completion`, 'empty', null, reply.requestId);
  }
}

export class AnthropicProvider implements TextProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly models: { mnemonicModel: string },
  ) {}

  async generateMnemonic(context: MnemonicContext): Promise<AiMnemonicResult> {
    const reply = await anthropicMessages(this.apiKey, {
      model: this.models.mnemonicModel,
      prompt: buildMnemonicPrompt(context),
      maxTokens: MNEMONIC_MAX_TOKENS,
      operation: 'mnemonic generation',
      respectBreaker: true,
    });
    assertAnswered(reply, 'mnemonic generation');
    const text = stripInlineMarkdown(reply.text);
    if (!text) {
      throw new AnthropicApiError('Anthropic mnemonic generation returned an empty completion', 'empty', null, reply.requestId);
    }
    return { text, usage: usageOf(reply) };
  }
}
