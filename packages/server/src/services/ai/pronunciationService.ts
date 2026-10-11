// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { logAiRequest } from './aiLogger.js';
import { writeAudioAsset } from './assetStorage.js';
import { normalizeForSpeech } from './speechText.js';
import { checkAiRateLimit } from './rateLimit.js';
import { TRPCError } from '@trpc/server';
import { TTS_LANGUAGE_MAP } from '@libresrs/shared';
import { assertProviderHasQuota } from './quotaBreaker.js';

export type CardSide = 'front' | 'back';

export async function generatePronunciation(cardId: number, userId: number, side: CardSide = 'back') {
  const aiConfig = await getAiRuntimeConfig();
  if (!aiConfig.pronunciationEnabled) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Pronunciation generation is not enabled',
      cause: { appCode: 'AI_FEATURE_DISABLED' },
    });
  }

  // Get card + deck for language context
  const card = await db.query.cards.findFirst({
    where: eq(schema.cards.id, cardId),
  });

  if (!card) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Card not found',
    });
  }

  const deck = await db.query.decks.findFirst({
    where: eq(schema.decks.id, card.deckId),
  });

  // A deck can switch off audio per side (a Spanish class usually wants the
  // Spanish side only). Enforced here so the on-demand generation path cannot
  // create a clip the teacher turned off.
  const sideEnabled = side === 'front'
    ? deck?.audioFrontEnabled ?? true
    : deck?.audioBackEnabled ?? true;
  if (!sideEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Audio is turned off for the ${side} side of this deck`,
      cause: { appCode: 'AUDIO_SIDE_DISABLED' },
    });
  }

  // Editorial notation ("profesor(a)", "he/she/it is (ser)") is for the eye,
  // not the ear. This is also the asset cache key — routers/ai.ts matches sides
  // with the same function, so the two must stay in lockstep.
  const text = normalizeForSpeech(side === 'front' ? card.front : card.back);

  // Check for existing ready audio asset matching this exact text
  const existingAssets = await db.query.aiAssets.findMany({
    where: and(
      eq(schema.aiAssets.cardId, cardId),
      eq(schema.aiAssets.assetType, 'audio'),
      eq(schema.aiAssets.status, 'ready'),
    ),
  });

  const existing = existingAssets.find(a => a.prompt === text);
  if (existing) {
    return { audioUrl: existing.url, status: 'ready' as const, side };
  }

  // Rate-limit only actual TTS generation. Cache hits above are free — students
  // replaying already-generated audio during study must never consume the AI
  // budget (a whole class behind one NAT burned it in minutes and audio "broke").
  checkAiRateLimit(userId);

  // Only create provider when we actually need to generate
  const provider = await createAiProvider(aiConfig);
  if (!provider) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'AI provider not configured',
      cause: { appCode: 'AI_PROVIDER_MISSING' },
    });
  }
  assertProviderHasQuota(provider.speechProviderName ?? provider.name);

  // Determine language and accent from deck metadata (per-side)
  // Resolve language codes (e.g. "en") to display names (e.g. "English") for TTS instructions
  const rawLanguage = side === 'front' ? deck?.sourceLanguage : deck?.targetLanguage;
  const language = rawLanguage ? (TTS_LANGUAGE_MAP.get(rawLanguage) ?? rawLanguage) : undefined;
  const accent = side === 'front'
    ? (deck?.sourceAccent ?? deck?.speechAccent)
    : (deck?.targetAccent ?? deck?.speechAccent);

  // Insert generating row
  const [asset] = await db.insert(schema.aiAssets).values({
    cardId,
    assetType: 'audio',
    provider: provider.speechProviderName ?? provider.name,
    prompt: text,
    status: 'generating',
  }).returning();

  const startTime = Date.now();

  try {
    const result = await provider.generateSpeech(text, {
      language: language,
      accent: accent ?? undefined,
    });

    const url = await writeAudioAsset(result.audioBuffer, 'opus');

    await db.update(schema.aiAssets)
      .set({ status: 'ready', url })
      .where(eq(schema.aiAssets.id, asset.id));

    logAiRequest({
      provider: provider.speechProviderName ?? provider.name,
      operation: 'generateSpeech',
      cardId,
      userId,
      prompt: text,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return { audioUrl: url, status: 'ready' as const, side };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await db.update(schema.aiAssets)
      .set({ status: 'failed', errorMessage })
      .where(eq(schema.aiAssets.id, asset.id));

    logAiRequest({
      provider: provider.speechProviderName ?? provider.name,
      operation: 'generateSpeech',
      cardId,
      userId,
      prompt: text,
      durationMs: Date.now() - startTime,
      success: false,
      error: errorMessage,
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to generate pronunciation',
      cause: { appCode: 'AI_GENERATION_FAILED' },
    });
  }
}
