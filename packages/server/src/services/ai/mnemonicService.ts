// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq, and, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import type { MnemonicStyle } from '../../db/schema.js';
import { logger } from '../../logger.js';
import { type AiRuntimeConfig, getAiRuntimeConfig } from './config.js';
import { activeMnemonicModel, createTextProvider, usesClaude } from './textProvider.js';
import type { MnemonicContext } from './types.js';
import { AnthropicApiError } from './anthropicProvider.js';
import { logAiRequest } from './aiLogger.js';
import { checkModeration } from './moderation.js';
import { TRPCError } from '@trpc/server';
import { assertProviderHasQuota, getQuotaBreakerState, redactApiKeys } from './quotaBreaker.js';

/**
 * An error message with the saved API keys taken out, for a log line. fetch puts a refused
 * header's whole value in its error, and a saved key is only trimmed, so one pasted across two
 * lines keeps its line break: redactApiKeys alone would leave the part after it.
 */
function withoutSavedKeys(message: string, cfg: AiRuntimeConfig): string {
  let out = message;
  for (const key of [cfg.openaiApiKey, cfg.anthropicApiKey]) {
    const saved = key?.trim();
    if (saved && saved.length >= 8) out = out.split(saved).join('[REDACTED_KEY]');
  }
  return redactApiKeys(out);
}

/**
 * OpenAI moderation of a generated suggestion, when it can run: an OpenAI key is
 * saved and the 'openai' breaker is closed (Anthropic has no moderation endpoint).
 * A non-OK answer passes the text (inside checkModeration, as always). When the call
 * itself fails (network, DNS, a key fetch refuses to send):
 * - on a suggestion OpenAI wrote, the error goes up and nothing is stored, as before
 *   v1.20.0 (generateMnemonic answers AI_GENERATION_FAILED; the teacher tries again);
 * - on one Claude wrote, it is logged and the suggestion kept, since Claude has no
 *   moderation of its own to fall back on and the gate that matters is the teacher's:
 *   only admins generate, and only acceptMnemonic publishes a suggestion to students.
 * On the OpenAI path the breaker is never open here (assertProviderHasQuota threw
 * first), so the skip only affects Claude suggestions.
 */
async function isFlaggedByModeration(text: string, cfg: AiRuntimeConfig, writtenBy: string): Promise<boolean> {
  if (!cfg.openaiApiKey) {
    logger.debug({ event: 'ai.moderation_skipped', reason: 'no_openai_key' }, 'Moderation skipped');
    return false;
  }
  if (getQuotaBreakerState('openai').open) {
    logger.debug({ event: 'ai.moderation_skipped', reason: 'openai_paused' }, 'Moderation skipped');
    return false;
  }
  try {
    return (await checkModeration(text, cfg.openaiApiKey, cfg.openaiBaseUrl)).flagged;
  } catch (err) {
    if (writtenBy !== 'anthropic') throw err;
    logger.warn(
      { event: 'ai.moderation_unavailable', error: withoutSavedKeys(err instanceof Error ? err.message : 'unknown', cfg) },
      'Moderation check failed; continuing (the teacher approves every suggestion)',
    );
    return false;
  }
}

/** A Claude failure, in words the client can localize by appCode. Runs after
 *  logAiRequest, so the breaker has already seen the error. */
function anthropicTrpcError(err: AnthropicApiError): TRPCError {
  switch (err.kind) {
    case 'billing':
      return new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'The Anthropic account is out of credit or reached its spending limit.',
        cause: { appCode: 'AI_QUOTA_EXHAUSTED' },
      });
    case 'auth':
      return new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Anthropic rejected the saved API key.',
        cause: { appCode: 'AI_PROVIDER_AUTH' },
      });
    case 'model':
      return new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Anthropic does not offer the chosen model to this account.',
        cause: { appCode: 'AI_MODEL_NOT_FOUND' },
      });
    case 'rate_limit':
    case 'busy':
      return new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'Anthropic is busy right now. Try again in a minute.',
        cause: { appCode: 'AI_PROVIDER_BUSY' },
      });
    case 'refusal':
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Claude declined to write a suggestion for this card.',
        cause: { appCode: 'AI_REFUSED' },
      });
    default:
      return generationFailed();
  }
}

function generationFailed(): TRPCError {
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to generate mnemonic',
    cause: { appCode: 'AI_GENERATION_FAILED' },
  });
}

/**
 * How many earlier suggestions go back to the model in each style, newest first. "Try another"
 * adds one per click, and rows from before v1.8.0 (when every card view generated one) can be many.
 */
export const ALREADY_SUGGESTED_LIMIT = 25;

/** How many of the deck's other approved mnemonics go to the model. A unit deck has about 65 cards. */
export const OTHER_CARDS_LIMIT = 60;

/**
 * Every earlier suggestion for the card, so the model writes a different one: pending, rejected
 * and approved, from any teacher (only admins generate; a student's own pick from before v1.8.0
 * is not a suggestion), plus the card's approved mnemonic. Split by style: the model must avoid
 * the ones in the style it is asked for, and sees the others for reference only (a keyword from a
 * sentence may come back as a picture). A row with no style, and an approved mnemonic no row
 * explains (a CSV import), is a keyword. Newest first, without repeats, at most
 * ALREADY_SUGGESTED_LIMIT in each.
 */
async function alreadySuggestedFor(
  cardId: number,
  approved: string | null,
  style: MnemonicStyle,
): Promise<{ sameStyle: string[]; otherStyle: string[] }> {
  const rows = await db.query.aiMnemonics.findMany({
    where: and(
      eq(schema.aiMnemonics.cardId, cardId),
      // Plain names inside: the relational query renames every column object to its own table.
      sql`${schema.aiMnemonics.userId} IN (SELECT "id" FROM "users" WHERE "role" = 'admin')`,
    ),
    orderBy: (m, { desc }) => [desc(m.createdAt), desc(m.id)],
    limit: ALREADY_SUGGESTED_LIMIT * 2,
  });
  const styleOf = (text: string) => rows.find((m) => m.text.trim() === text)?.style ?? 'keyword';
  const texts = [...new Set([approved, ...rows.map((m) => m.text)].map((text) => text?.trim() ?? '').filter(Boolean))];
  const inStyle = (want: boolean) => texts.filter((text) => (styleOf(text) === style) === want).slice(0, ALREADY_SUGGESTED_LIMIT);
  return { sameStyle: inStyle(true), otherStyle: inStyle(false) };
}

/**
 * The approved mnemonics of the deck's other cards, as "front = back: mnemonic", so the model does
 * not give two words one keyword (PEAR for both pero and perro, the confusion it feeds).
 */
async function otherCardsOf(cardId: number, deckId: number): Promise<string[]> {
  const cards = await db.query.cards.findMany({
    where: and(eq(schema.cards.deckId, deckId), ne(schema.cards.id, cardId), isNotNull(schema.cards.mnemonic)),
    columns: { front: true, back: true, mnemonic: true },
    orderBy: (c, { asc }) => [asc(c.id)],
    limit: OTHER_CARDS_LIMIT,
  });
  const plain = (text: string) => text.replace(/<[^>]*>/g, '').trim();
  return cards
    .filter((c) => c.mnemonic?.trim())
    .map((c) => `${plain(c.front)} = ${plain(c.back)}: ${c.mnemonic!.trim()}`);
}

/** A suggestion row as generateMnemonic has always returned it, plus its style. */
function suggestionOf(row: typeof schema.aiMnemonics.$inferSelect, fallback: MnemonicStyle) {
  const { id, cardId, userId, provider, text, sourcePrompt, accepted, acceptedAt, createdAt } = row;
  return { id, cardId, userId, provider, text, sourcePrompt, accepted, acceptedAt, createdAt, style: row.style ?? fallback };
}

/**
 * A new suggestion for the card, in the style the teacher asked for ('keyword' by default). It is
 * stored as the teacher's pending suggestion; only acceptMnemonic shows it to students.
 */
export async function generateMnemonic(cardId: number, userId: number, style: MnemonicStyle = 'keyword') {
  const aiConfig = await getAiRuntimeConfig();
  if (!aiConfig.mnemonicEnabled) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Mnemonic generation is not enabled',
      cause: { appCode: 'AI_FEATURE_DISABLED' },
    });
  }

  const provider = await createTextProvider(aiConfig);
  if (!provider) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: usesClaude(aiConfig)
        ? 'Mnemonics are set to use Claude, but no Anthropic API key is saved. Add one in Admin > AI.'
        : 'AI provider not configured',
      cause: { appCode: 'AI_PROVIDER_MISSING' },
    });
  }
  // Fail fast if this provider's balance is exhausted, instead of spending
  // another request on a wall (see quotaBreaker). Breakers are per provider, so
  // an empty OpenAI balance never blocks Claude suggestions.
  assertProviderHasQuota(provider.name);
  const model = activeMnemonicModel(aiConfig);

  // Get card + deck for language context
  const card = await db.query.cards.findFirst({
    where: eq(schema.cards.id, cardId),
  });

  if (!card) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
  }

  const deck = await db.query.decks.findFirst({
    where: eq(schema.decks.id, card.deckId),
  });

  const front = card.front.replace(/<[^>]*>/g, '').trim();
  const back = card.back.replace(/<[^>]*>/g, '').trim();

  const earlier = await alreadySuggestedFor(cardId, card.mnemonic ?? null, style);
  const context: MnemonicContext = {
    front,
    back,
    sourceLanguage: deck?.sourceLanguage ?? undefined,
    targetLanguage: deck?.targetLanguage ?? undefined,
    style,
    alreadySuggested: earlier.sameStyle,
    suggestedInOtherStyle: earlier.otherStyle,
    otherCards: await otherCardsOf(cardId, card.deckId),
  };

  const startTime = Date.now();

  try {
    const result = await provider.generateMnemonic(context);

    if (await isFlaggedByModeration(result.text, aiConfig, provider.name)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Generated content flagged by moderation',
        cause: { appCode: 'AI_MODERATION_FLAGGED' },
      });
    }

    const sourcePrompt = `${front} → ${back}`;

    const [row] = await db.insert(schema.aiMnemonics).values({
      cardId,
      userId,
      provider: provider.name,
      text: result.text,
      sourcePrompt,
      accepted: false,
      style,
    }).returning();

    logAiRequest({
      provider: provider.name,
      operation: 'generateMnemonic',
      cardId,
      userId,
      prompt: sourcePrompt,
      durationMs: Date.now() - startTime,
      success: true,
      model: result.usage?.model ?? model,
      requestId: result.usage?.requestId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });

    return suggestionOf(row, style);
  } catch (err) {
    if (err instanceof TRPCError) throw err;

    const errorMessage = withoutSavedKeys(err instanceof Error ? err.message : 'Unknown error', aiConfig);

    logAiRequest({
      provider: provider.name,
      operation: 'generateMnemonic',
      cardId,
      userId,
      durationMs: Date.now() - startTime,
      success: false,
      error: errorMessage,
      model,
      requestId: err instanceof AnthropicApiError ? err.requestId : undefined,
    });

    if (err instanceof AnthropicApiError) throw anthropicTrpcError(err);
    throw generationFailed();
  }
}

export async function acceptMnemonic(mnemonicId: number, userId: number) {
  const mnemonic = await db.query.aiMnemonics.findFirst({
    where: and(
      eq(schema.aiMnemonics.id, mnemonicId),
      eq(schema.aiMnemonics.userId, userId),
    ),
  });

  if (!mnemonic) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Mnemonic not found',
    });
  }

  // Only this row changes (if it was turned down earlier, it no longer is); other suggestions
  // for the card, rejected ones included, stay as they are.
  await db.update(schema.aiMnemonics)
    .set({ accepted: true, acceptedAt: new Date(), rejectedAt: null })
    .where(eq(schema.aiMnemonics.id, mnemonicId));

  // The approved mnemonic lives on the card, where every student reads it.
  await db.update(schema.cards)
    .set({ mnemonic: mnemonic.text })
    .where(eq(schema.cards.id, mnemonic.cardId));

  return { success: true };
}

/**
 * Turns a suggestion down ("Try another", "Dismiss"; "Try a sentence" / "Try a keyword" turn
 * nothing down, so the teacher can compare the two styles). The row is kept
 * with rejected_at set: it never shows as pending again, and the next generation for the card
 * lists it so the model writes a different one. Before v1.20.0 the row was deleted, so the
 * "previously rejected" list the model got held only the suggestions still waiting. Rejecting
 * twice keeps the first time.
 */
export async function rejectMnemonic(mnemonicId: number, userId: number) {
  const mnemonic = await db.query.aiMnemonics.findFirst({
    where: and(
      eq(schema.aiMnemonics.id, mnemonicId),
      eq(schema.aiMnemonics.userId, userId),
    ),
  });

  if (!mnemonic) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Mnemonic not found',
    });
  }

  if (!mnemonic.rejectedAt) {
    await db.update(schema.aiMnemonics)
      .set({ rejectedAt: new Date() })
      .where(and(eq(schema.aiMnemonics.id, mnemonicId), isNull(schema.aiMnemonics.rejectedAt)));
  }

  return { success: true };
}
