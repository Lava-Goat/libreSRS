// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { logAiRequest } from './aiLogger.js';
import { checkModeration } from './moderation.js';
import { buildImagePrompt } from './aiTemplates.js';
import { TRPCError } from '@trpc/server';
import { assertProviderHasQuota } from './quotaBreaker.js';

export async function generateImage(cardId: number, userId: number) {
  const aiConfig = await getAiRuntimeConfig();
  if (!aiConfig.imageEnabled) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Image generation is not enabled',
      cause: { appCode: 'AI_FEATURE_DISABLED' },
    });
  }

  // Check for existing ready image asset
  const existing = await db.query.aiAssets.findFirst({
    where: and(
      eq(schema.aiAssets.cardId, cardId),
      eq(schema.aiAssets.assetType, 'image'),
      eq(schema.aiAssets.status, 'ready'),
    ),
  });

  if (existing) {
    return { imageUrl: existing.url, status: 'ready' as const };
  }

  const provider = await createAiProvider(aiConfig);
  if (!provider) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'AI provider not configured',
      cause: { appCode: 'AI_PROVIDER_MISSING' },
    });
  }
  // Fail fast if this provider's balance is exhausted, instead of spending
  // another request on a wall (see quotaBreaker).
  assertProviderHasQuota(provider.name);

  const card = await db.query.cards.findFirst({
    where: eq(schema.cards.id, cardId),
  });

  if (!card) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Card not found',
    });
  }

  const front = card.front.replace(/<[^>]*>/g, '').trim();
  const back = card.back.replace(/<[^>]*>/g, '').trim();
  const prompt = buildImagePrompt(front, back);

  // Run moderation check on the prompt
  const apiKey = aiConfig.openaiApiKey;
  if (apiKey) {
    const modResult = await checkModeration(prompt, apiKey, aiConfig.openaiBaseUrl);
    if (modResult.flagged) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Content flagged by moderation',
        cause: { appCode: 'AI_MODERATION_FLAGGED' },
      });
    }
  }

  const [asset] = await db.insert(schema.aiAssets).values({
    cardId,
    assetType: 'image',
    provider: provider.name,
    prompt,
    status: 'generating',
  }).returning();

  const startTime = Date.now();

  try {
    const result = await provider.generateImage(prompt);

    await db.update(schema.aiAssets)
      .set({ status: 'ready', url: result.url })
      .where(eq(schema.aiAssets.id, asset.id));

    logAiRequest({
      provider: provider.name,
      operation: 'generateImage',
      cardId,
      userId,
      prompt,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return { imageUrl: result.url, status: 'ready' as const };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await db.update(schema.aiAssets)
      .set({ status: 'failed', errorMessage })
      .where(eq(schema.aiAssets.id, asset.id));

    logAiRequest({
      provider: provider.name,
      operation: 'generateImage',
      cardId,
      userId,
      prompt,
      durationMs: Date.now() - startTime,
      success: false,
      error: errorMessage,
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to generate image',
      cause: { appCode: 'AI_GENERATION_FAILED' },
    });
  }
}
