// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { getAiRuntimeConfig, type AiRuntimeConfig } from './config.js';
import { generatePronunciation } from './pronunciationService.js';
import { generateImage } from './imageService.js';
import { logger } from '../../logger.js';

const activeScans = new Set<string>();

export interface ScanProgress {
  processed: number;
  total: number;
  status: 'scanning' | 'done' | 'failed';
}

const scanProgressMap = new Map<string, ScanProgress>();

function scanKey(deckId: number, userId: number): string {
  return `${deckId}:${userId}`;
}

export function getScanProgress(deckId: number, userId: number): ScanProgress | null {
  return scanProgressMap.get(scanKey(deckId, userId)) ?? null;
}

export interface ActiveScan {
  deckId: number;
  userId: number;
  progress: ScanProgress;
}

export function getAllScanProgress(): ActiveScan[] {
  return Array.from(scanProgressMap.entries()).map(([key, progress]) => {
    const [deckId, userId] = key.split(':').map(Number);
    return { deckId, userId, progress };
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function scanDeck(deckId: number, userId: number): Promise<{ status: string; totalCards: number }> {
  const aiConfig = await getAiRuntimeConfig();
  if (!aiConfig.aiEnabled) {
    return { status: 'ai_disabled', totalCards: 0 };
  }

  const key = scanKey(deckId, userId);
  if (activeScans.has(key)) {
    return { status: 'already_scanning', totalCards: 0 };
  }

  const cards = await db.query.cards.findMany({
    where: eq(schema.cards.deckId, deckId),
  });

  if (cards.length === 0) {
    return { status: 'no_cards', totalCards: 0 };
  }

  activeScans.add(key);
  scanProgressMap.set(key, { processed: 0, total: cards.length, status: 'scanning' });
  processScanInBackground(deckId, userId, cards, key, aiConfig).catch((err) => {
    logger.error({ err, deckId, userId }, 'Deck scan failed');
    scanProgressMap.set(key, { processed: scanProgressMap.get(key)?.processed ?? 0, total: cards.length, status: 'failed' });
  }).finally(() => {
    activeScans.delete(key);
  });

  return { status: 'scanning', totalCards: cards.length };
}

interface CardRow {
  id: number;
  deckId: number;
  front: string;
  back: string;
}

async function processScanInBackground(
  deckId: number,
  userId: number,
  cards: CardRow[],
  key: string,
  aiConfig: AiRuntimeConfig,
): Promise<void> {
  logger.info({ deckId, userId, cardCount: cards.length }, 'Deck scan started');

  const cardIds = cards.map(c => c.id);
  let processed = 0;

  const updateProgress = () => {
    scanProgressMap.set(key, { processed, total: cards.length, status: 'scanning' });
  };

  // Pronunciation: bulk-query existing ready audio, only process cards missing audio
  if (aiConfig.pronunciationEnabled) {
    const existingAudio = await db.query.aiAssets.findMany({
      where: and(
        inArray(schema.aiAssets.cardId, cardIds),
        eq(schema.aiAssets.assetType, 'audio'),
        eq(schema.aiAssets.status, 'ready'),
      ),
    });

    // Build set of cardIds that have both front and back audio
    const audioByCard = new Map<number, Set<string>>();
    for (const asset of existingAudio) {
      if (!audioByCard.has(asset.cardId)) audioByCard.set(asset.cardId, new Set());
      audioByCard.get(asset.cardId)!.add(asset.prompt);
    }

    for (const card of cards) {
      const frontText = card.front.replace(/<[^>]*>/g, '').trim();
      const backText = card.back.replace(/<[^>]*>/g, '').trim();
      const existingPrompts = audioByCard.get(card.id);

      for (const side of ['front', 'back'] as const) {
        const text = side === 'front' ? frontText : backText;
        if (existingPrompts?.has(text)) continue;

        await delay(100);
        try {
          await generatePronunciation(card.id, userId, side);
        } catch (err) {
          const cause = (err as { cause?: { appCode?: string } })?.cause;
          if (
            cause?.appCode === 'AI_FEATURE_DISABLED'
            || cause?.appCode === 'AI_PROVIDER_MISSING'
            || cause?.appCode === 'AI_PROVIDER_NOT_CONFIGURED'
          ) {
            logger.info({ deckId }, 'Pronunciation skipped: feature disabled or provider not configured');
            break;
          }
          logger.warn({ err, cardId: card.id, side }, 'Pronunciation generation failed for card');
        }
      }

      processed++;
      updateProgress();
    }
  }

  // Images: bulk-query existing ready images, only process cards missing images
  if (aiConfig.imageEnabled) {
    const existingImages = await db.query.aiAssets.findMany({
      where: and(
        inArray(schema.aiAssets.cardId, cardIds),
        eq(schema.aiAssets.assetType, 'image'),
        eq(schema.aiAssets.status, 'ready'),
      ),
    });

    const cardsWithImages = new Set(existingImages.map(a => a.cardId));
    const cardsNeedingImages = cards.filter(c => !cardsWithImages.has(c.id));

    for (const card of cardsNeedingImages) {
      await delay(100);
      try {
        await generateImage(card.id, userId);
      } catch (err) {
        const cause = (err as { cause?: { appCode?: string } })?.cause;
        if (
          cause?.appCode === 'AI_FEATURE_DISABLED'
          || cause?.appCode === 'AI_PROVIDER_MISSING'
          || cause?.appCode === 'AI_PROVIDER_NOT_CONFIGURED'
        ) {
          logger.info({ deckId }, 'Image generation skipped: feature disabled or provider not configured');
          break;
        }
        logger.warn({ err, cardId: card.id }, 'Image generation failed for card');
      }
    }
  }

  scanProgressMap.set(key, { processed: cards.length, total: cards.length, status: 'done' });
  logger.info({ deckId, userId, cardCount: cards.length }, 'Deck scan completed');
}
