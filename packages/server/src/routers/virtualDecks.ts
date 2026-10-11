// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { eq, and, sql, inArray, asc, gte } from 'drizzle-orm';
import {
  MAX_CARD_SELECTION_LENGTH,
  createVirtualDeck,
  getUserVirtualDecks,
  getVirtualDeck,
  deleteVirtualDeck,
  updateVirtualDeck,
  getVirtualDeckCardIds,
  parseCardSelection,
  validateCardSelection,
} from '../services/virtualDecks.js';
import { getDueCards, getReviewOptions, getDueCount } from '../services/fsrs.js';
import { getDeckUserSettings } from '../services/userSettings.js';
import { State } from '@libresrs/shared';
import { startOfDayForOffset } from '../utils/time.js';
import { assertDeckAccess, getUserDeckIds } from '../services/deckAccess.js';

type DeckSelectionValidation = {
  valid: boolean;
  error?: string;
  cardCount: number;
  totalCardsInDeck: number;
  invalidIndices: number[];
};

async function validateSelectionForDeck(
  sourceDeckId: number,
  cardSelection: string
): Promise<DeckSelectionValidation> {
  const validation = validateCardSelection(cardSelection);
  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error,
      cardCount: 0,
      totalCardsInDeck: 0,
      invalidIndices: [],
    };
  }

  const deckCardCountResult = await db.select({ count: sql<number>`count(*)` })
    .from(schema.cards)
    .where(eq(schema.cards.deckId, sourceDeckId));
  const totalCardsInDeck = deckCardCountResult[0]?.count ?? 0;

  const indices = parseCardSelection(cardSelection);
  const invalidIndices = indices.filter((index) => index > totalCardsInDeck);

  if (invalidIndices.length > 0) {
    const invalidPreview = invalidIndices.slice(0, 10);
    const indexLabel = invalidPreview.length === 1 ? 'index' : 'indices';
    const verb = invalidPreview.length === 1 ? 'is' : 'are';

    return {
      valid: false,
      error: `Card ${indexLabel} ${invalidPreview.join(', ')} ${verb} out of bounds for deck size ${totalCardsInDeck}`,
      cardCount: 0,
      totalCardsInDeck,
      invalidIndices: invalidPreview,
    };
  }

  return {
    valid: true,
    error: undefined,
    cardCount: indices.length,
    totalCardsInDeck,
    invalidIndices: [],
  };
}

export const virtualDecksRouter = router({
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      sourceDeckId: z.number(),
      cardSelection: z.string().min(1).max(MAX_CARD_SELECTION_LENGTH),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.sourceDeckId);

      const validation = await validateSelectionForDeck(input.sourceDeckId, input.cardSelection);
      if (!validation.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: validation.error ?? 'Invalid card selection',
          cause: { appCode: 'INVALID_CARD_SELECTION' },
        });
      }

      return createVirtualDeck(ctx.user.id, input.sourceDeckId, input.name, input.cardSelection);
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const [virtualDecks, accessibleDeckIds] = await Promise.all([
      getUserVirtualDecks(ctx.user.id),
      getUserDeckIds(ctx.user.id),
    ]);

    if (accessibleDeckIds.length === 0) {
      return [];
    }

    const accessibleSet = new Set(accessibleDeckIds);
    return virtualDecks.filter((virtualDeck) => accessibleSet.has(virtualDeck.sourceDeckId));
  }),

  get: protectedProcedure
    .input(z.object({
      id: z.number(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const vd = await getVirtualDeck(input.id, ctx.user.id);
      if (!vd) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Virtual deck not found',
          cause: { appCode: 'VIRTUAL_DECK_NOT_FOUND' },
        });
      }

      await assertDeckAccess(ctx.user.id, vd.sourceDeckId);

      const sourceDeck = await db.query.decks.findFirst({
        where: eq(schema.decks.id, vd.sourceDeckId),
      });

      const cardIds = await getVirtualDeckCardIds(input.id, ctx.user.id);

      // Count learned cards
      const learnedCount = await db.select({ count: sql<number>`count(*)` })
        .from(schema.cardStates)
        .where(and(
          eq(schema.cardStates.userId, ctx.user.id),
          inArray(schema.cardStates.cardId, cardIds.length > 0 ? cardIds : [-1]),
          sql`${schema.cardStates.state} >= 2`
        ));

      // What Study would open this selection with now, its limits counted within it (as getDueCards below).
      const dueCount = await getDueCount(ctx.user.id, vd.sourceDeckId, cardIds, input.timezoneOffsetMinutes);

      return {
        ...vd,
        sourceDeckName: sourceDeck?.name ?? 'Unknown',
        sourceDeckReversible: sourceDeck?.reversible ?? false,
        cardCount: cardIds.length,
        learnedCount: learnedCount[0].count,
        dueCount,
      };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      cardSelection: z.string().min(1).max(MAX_CARD_SELECTION_LENGTH).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getVirtualDeck(input.id, ctx.user.id);
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Virtual deck not found',
          cause: { appCode: 'VIRTUAL_DECK_NOT_FOUND' },
        });
      }
      await assertDeckAccess(ctx.user.id, existing.sourceDeckId);

      if (input.cardSelection) {
        const validation = await validateSelectionForDeck(existing.sourceDeckId, input.cardSelection);
        if (!validation.valid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: validation.error ?? 'Invalid card selection',
            cause: { appCode: 'INVALID_CARD_SELECTION' },
          });
        }
      }

      const { id, ...updates } = input;
      return updateVirtualDeck(id, ctx.user.id, updates);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getVirtualDeck(input.id, ctx.user.id);
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Virtual deck not found',
          cause: { appCode: 'VIRTUAL_DECK_NOT_FOUND' },
        });
      }
      await assertDeckAccess(ctx.user.id, existing.sourceDeckId);

      await deleteVirtualDeck(input.id, ctx.user.id);
      return { success: true };
    }),

  validateSelection: protectedProcedure
    .input(z.object({
      sourceDeckId: z.number(),
      cardSelection: z.string().max(MAX_CARD_SELECTION_LENGTH),
    }))
    .query(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.sourceDeckId);

      return validateSelectionForDeck(input.sourceDeckId, input.cardSelection);
    }),

  getDueCards: protectedProcedure
    .input(z.object({
      virtualDeckId: z.number(),
      limit: z.number().min(1).max(500).optional(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const virtualDeck = await getVirtualDeck(input.virtualDeckId, ctx.user.id);
      if (!virtualDeck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Virtual deck not found',
          cause: { appCode: 'VIRTUAL_DECK_NOT_FOUND' },
        });
      }

      await assertDeckAccess(ctx.user.id, virtualDeck.sourceDeckId);

      const sourceDeck = await db.query.decks.findFirst({
        where: eq(schema.decks.id, virtualDeck.sourceDeckId),
      });

      if (!sourceDeck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Source deck not found',
          cause: { appCode: 'SOURCE_DECK_NOT_FOUND' },
        });
      }

      // Get settings for the SOURCE deck (since that's where the cards live)
      const settings = await getDeckUserSettings(ctx.user.id, virtualDeck.sourceDeckId);

      const todayStart = startOfDayForOffset(input.timezoneOffsetMinutes);

      // Get the card IDs that belong to this virtual deck
      const virtualDeckCardIds = await getVirtualDeckCardIds(input.virtualDeckId, ctx.user.id);

      if (virtualDeckCardIds.length === 0) {
        return [];
      }

      const newCardsToday = await db.select({ count: sql<number>`count(*)` })
        .from(schema.reviewLogs)
        .where(and(
          eq(schema.reviewLogs.userId, ctx.user.id),
          gte(schema.reviewLogs.reviewedAt, todayStart),
          inArray(schema.reviewLogs.cardId, virtualDeckCardIds),
          eq(schema.reviewLogs.previousState, State.New)
        ));

      const reviewCardsToday = await db.select({ count: sql<number>`count(*)` })
        .from(schema.reviewLogs)
        .where(and(
          eq(schema.reviewLogs.userId, ctx.user.id),
          gte(schema.reviewLogs.reviewedAt, todayStart),
          inArray(schema.reviewLogs.cardId, virtualDeckCardIds),
          eq(schema.reviewLogs.previousState, State.Review)
        ));

      const remainingNewCards = Math.max(0, settings.newCardsPerDay - newCardsToday[0].count);
      const remainingReviews = Math.max(0, settings.reviewsPerDay - reviewCardsToday[0].count);

      const sessionLimit = input.limit ?? 500;

      if (sessionLimit <= 0) {
        return [];
      }

      // Get due cards but filter to only those in the virtual deck
      const cards = await getDueCards(ctx.user.id, virtualDeck.sourceDeckId, {
        limit: sessionLimit,
        newLimit: remainingNewCards,
        reviewLimit: remainingReviews,
        cardFilter: virtualDeckCardIds,
      });
      return cards.map(({ card, state, direction }) => ({
        card,
        state: {
          id: state.id,
          stability: state.stability,
          difficulty: state.difficulty,
          reps: state.reps,
          lapses: state.lapses,
          state: state.state,
        },
        direction,
        nextReviewOptions: getReviewOptions(state),
      }));
    }),

  getSourceDeckCards: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);

      const cards = await db.query.cards.findMany({
        where: eq(schema.cards.deckId, input.deckId),
        orderBy: [asc(schema.cards.id)],
      });

      return cards.map((card, index) => ({
        index: index + 1, // 1-based index
        id: card.id,
        frontPreview: card.front.substring(0, 50) + (card.front.length > 50 ? '...' : ''),
      }));
    }),
});
