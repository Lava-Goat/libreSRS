// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { router, protectedProcedure } from './trpc.js';
import {
  getOrCreateUserSettings,
  updateUserSettings,
  getDeckUserSettings,
  updateDeckUserSettings,
  deleteDeckUserSettings,
} from '../services/userSettings.js';
import { mnemonicModeInput, readMnemonicMode } from '../services/mnemonicMode.js';
import { assertDeckAccess } from '../services/deckAccess.js';
import { getDeckLanguages } from '../services/deckLanguages.js';

// A page loaded before v1.20.0 still sends showCognateScore: zod drops it unread.

const settingsInput = z.object({
  newCardsPerDay: z.number().int().min(0).max(500),
  reviewsPerDay: z.number().int().min(0).max(500),
  aiEnabled: z.boolean().optional(),
  autoPlayAudio: z.boolean().optional(),
  autoPlayAudioFront: z.boolean().optional(),
  mnemonicMode: mnemonicModeInput.optional(),
  locale: z.string().max(10).nullish(),
});

const deckSettingsInput = z.object({
  deckId: z.number(),
  newCardsPerDay: z.number().int().min(0).max(500),
  reviewsPerDay: z.number().int().min(0).max(500),
  // Nullable overrides: null clears the override and falls back to user default
  aiEnabled: z.boolean().nullish(),
  autoPlayAudio: z.boolean().nullish(),
  autoPlayAudioFront: z.boolean().nullish(),
  mnemonicMode: mnemonicModeInput.nullish(),
});

/**
 * A deck's effective settings with the deck's two languages, which the review
 * screen reads for its Wiktionary links (v1.26.1): the query it already makes
 * for each deck it shows, AI on or off.
 */
async function deckSettingsFor(userId: number, deckId: number) {
  const settings = await getDeckUserSettings(userId, deckId);
  return { ...settings, ...getDeckLanguages(deckId) };
}

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getOrCreateUserSettings(ctx.user.id);
    return {
      userId: settings.userId,
      newCardsPerDay: settings.newCardsPerDay,
      reviewsPerDay: settings.reviewsPerDay,
      /** The teacher set the daily limits: the student's form cannot change them (per deck, only as allowed). */
      limitsLocked: settings.isOverride ?? false,
      limitsAllowHigher: settings.allowHigher ?? true,
      limitsAllowLower: settings.allowLower ?? true,
      aiEnabled: settings.aiEnabled ?? true,
      aiEnabledLocked: settings.aiEnabledLocked ?? false,
      autoPlayAudio: settings.autoPlayAudio ?? false,
      autoPlayAudioLocked: settings.autoPlayAudioLocked ?? false,
      autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
      autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked ?? false,
      mnemonicMode: readMnemonicMode(settings.mnemonicMode),
      mnemonicModeLocked: settings.mnemonicModeLocked ?? false,
      locale: settings.locale ?? null,
      localeLocked: settings.localeLocked ?? false,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }),

  update: protectedProcedure
    .input(settingsInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await updateUserSettings(ctx.user.id, input);
      return {
        userId: settings.userId,
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        limitsLocked: settings.isOverride ?? false,
        limitsAllowHigher: settings.allowHigher ?? true,
        limitsAllowLower: settings.allowLower ?? true,
        aiEnabled: settings.aiEnabled ?? true,
        aiEnabledLocked: settings.aiEnabledLocked ?? false,
        autoPlayAudio: settings.autoPlayAudio ?? false,
        autoPlayAudioLocked: settings.autoPlayAudioLocked ?? false,
        autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
        autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked ?? false,
        mnemonicMode: readMnemonicMode(settings.mnemonicMode),
        mnemonicModeLocked: settings.mnemonicModeLocked ?? false,
        locale: settings.locale ?? null,
        localeLocked: settings.localeLocked ?? false,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
    }),

  getDeckSettings: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);
      return deckSettingsFor(ctx.user.id, input.deckId);
    }),

  updateDeckSettings: protectedProcedure
    .input(deckSettingsInput)
    .mutation(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);
      const raw = await updateDeckUserSettings(ctx.user.id, input.deckId, {
        newCardsPerDay: input.newCardsPerDay,
        reviewsPerDay: input.reviewsPerDay,
        aiEnabled: input.aiEnabled ?? null,
        autoPlayAudio: input.autoPlayAudio ?? null,
        autoPlayAudioFront: input.autoPlayAudioFront ?? null,
        mnemonicMode: input.mnemonicMode ?? null,
      });
      // Return the full effective settings
      return deckSettingsFor(ctx.user.id, raw.deckId);
    }),

  resetDeckSettings: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);
      await deleteDeckUserSettings(ctx.user.id, input.deckId);
      // Return the fallback (global) settings
      return deckSettingsFor(ctx.user.id, input.deckId);
    }),
});
