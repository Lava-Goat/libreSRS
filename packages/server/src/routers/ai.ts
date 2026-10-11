// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { TRPCError } from '@trpc/server';
import { assertDeckAccess } from '../services/deckAccess.js';
import { checkAiRateLimit } from '../services/ai/rateLimit.js';
import { getAiRuntimeConfig } from '../services/ai/config.js';
import { normalizeForSpeech } from '../services/ai/speechText.js';
import { clearQuotaBreaker, listQuotaBreakers, redactApiKeys } from '../services/ai/quotaBreaker.js';
import { generatePronunciation } from '../services/ai/pronunciationService.js';
import { generateImage } from '../services/ai/imageService.js';
import { scanDeck, getScanProgress, getAllScanProgress } from '../services/ai/scanService.js';
import {
  generateMnemonic as generateMnemonicService,
  acceptMnemonic as acceptMnemonicService,
  rejectMnemonic as rejectMnemonicService,
} from '../services/ai/mnemonicService.js';
import { db, schema } from '../db/index.js';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { MNEMONIC_STYLES, type MnemonicStyle } from '../db/schema.js';
import { ensureAppSettings, updateAppSettings } from '../services/appSettings.js';
import { getModelCatalog, resetModelCatalogCache } from '../services/ai/modelCatalog.js';
import { generateElevenLabsSpeech, listElevenLabsVoices } from '../services/ai/elevenLabsSpeech.js';
import { ANTHROPIC_TEXT_MODELS, isClaudeModel } from '../services/ai/aiTemplates.js';
import {
  testAnthropicKey as testAnthropicKeyService,
  type AnthropicKeyTestResult,
} from '../services/ai/anthropicKeyTest.js';
import { isSendableAnthropicKey } from '../services/ai/anthropicProvider.js';
import { logger } from '../logger.js';
import { isTranscriptionEnabled, setTranscriptionEnabled } from '../services/transcriptionSetting.js';

const openAiCompatibleBaseUrlSchema = z.string().trim().url().max(2_048).refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'AI base URL must use http or https');

/** Stored as a JSON string; a corrupt value must never break the admin panel. */
function parseStoredVoiceMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>;
    }
  } catch { /* fall through */ }
  return {};
}

async function getCardDeckId(cardId: number): Promise<number> {
  const card = await db.query.cards.findFirst({
    where: eq(schema.cards.id, cardId),
  });
  if (!card) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found', cause: { appCode: 'CARD_NOT_FOUND' } });
  }
  return card.deckId;
}

export const aiRouter = router({
  getConfig: protectedProcedure.query(async () => {
    const config = await getAiRuntimeConfig();
    return {
      pronunciation: config.pronunciationEnabled,
      image: config.imageEnabled,
      mnemonic: config.mnemonicEnabled,
    };
  }),

  generatePronunciation: protectedProcedure
    .input(z.object({
      cardId: z.number(),
      side: z.enum(['front', 'back']).default('back'),
    }))
    .mutation(async ({ ctx, input }) => {
      const deckId = await getCardDeckId(input.cardId);
      await assertDeckAccess(ctx.user.id, deckId);
      // Rate limiting happens inside the service, AFTER its cache-hit check —
      // replaying existing audio must not spend the per-user AI budget.
      return generatePronunciation(input.cardId, ctx.user.id, input.side);
    }),

  generateImage: protectedProcedure
    .input(z.object({ cardId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deckId = await getCardDeckId(input.cardId);
      await assertDeckAccess(ctx.user.id, deckId);
      checkAiRateLimit(ctx.user.id);
      return generateImage(input.cardId, ctx.user.id);
    }),

  getCardAssets: protectedProcedure
    .input(z.object({ cardId: z.number() }))
    .query(async ({ ctx, input }) => {
      const card = await db.query.cards.findFirst({
        where: eq(schema.cards.id, input.cardId),
      });
      if (!card) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found', cause: { appCode: 'CARD_NOT_FOUND' } });
      }
      await assertDeckAccess(ctx.user.id, card.deckId);

      const assets = await db.query.aiAssets.findMany({
        where: and(
          eq(schema.aiAssets.cardId, input.cardId),
          eq(schema.aiAssets.status, 'ready'),
        ),
      });

      // Must match pronunciationService's key exactly, or generated audio
      // becomes unfindable. The legacy raw text is accepted as a fallback so
      // clips made before speech normalization still map to their side.
      const frontText = normalizeForSpeech(card.front);
      const backText = normalizeForSpeech(card.back);
      const legacyFront = card.front.replace(/<[^>]*>/g, '').trim();
      const legacyBack = card.back.replace(/<[^>]*>/g, '').trim();
      const audioAssets = assets.filter(a => a.assetType === 'audio');
      const pick = (text: string, legacy: string) =>
        audioAssets.find(a => a.prompt === text)
        ?? audioAssets.find(a => a.prompt === legacy)
        ?? null;

      // Per-side switches. Suppressing rather than deleting means turning a
      // side back on restores its existing clips instead of paying to redo them.
      const deck = await db.query.decks.findFirst({
        where: eq(schema.decks.id, card.deckId),
      });
      const audioFrontEnabled = deck?.audioFrontEnabled ?? true;
      const audioBackEnabled = deck?.audioBackEnabled ?? true;

      const front = audioFrontEnabled ? pick(frontText, legacyFront) : null;
      const back = audioBackEnabled ? pick(backText, legacyBack) : null;

      return {
        audio: back ?? front ?? null,
        audioFront: front,
        audioBack: back,
        audioFrontEnabled,
        audioBackEnabled,
        image: assets.find(a => a.assetType === 'image') ?? null,
      };
    }),

  /**
   * Removes the card's picture, for every student who studies it. Teacher only since v1.20.0:
   * before, any student with the deck could delete it for the whole class.
   */
  removeImage: adminProcedure
    .input(z.object({ cardId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deckId = await getCardDeckId(input.cardId);
      await assertDeckAccess(ctx.user.id, deckId);

      await db.delete(schema.aiAssets)
        .where(and(
          eq(schema.aiAssets.cardId, input.cardId),
          eq(schema.aiAssets.assetType, 'image'),
        ));

      return { success: true };
    }),

  /**
   * A mnemonic suggestion for a teacher to approve. Admin-only: students see
   * the card's approved mnemonic (a read) and never cause a generation. Before
   * v1.8.0 every student's card view generated one, two paid API calls each.
   *
   * v1.20.0: in one of two styles, a keyword picture (the default) or a short example
   * sentence. "Try another" rejects the pending suggestion and asks again in the same style;
   * "Suggest a sentence", and "Try a sentence" / "Try a keyword", ask in the other, turning
   * nothing down (the teacher compares the two and chooses). Never called on its own: the
   * teacher asks for each one.
   */
  generateMnemonic: adminProcedure
    .input(z.object({
      cardId: z.number(),
      style: z.enum(MNEMONIC_STYLES).default('keyword'),
    }))
    .mutation(async ({ ctx, input }) => {
      checkAiRateLimit(ctx.user.id);
      return generateMnemonicService(input.cardId, ctx.user.id, input.style);
    }),

  /** Approves a suggestion as the card's mnemonic, for every student. */
  acceptMnemonic: adminProcedure
    .input(z.object({ mnemonicId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return acceptMnemonicService(input.mnemonicId, ctx.user.id);
    }),

  /** Turns a suggestion down. It is kept (rejected_at), never pending again, and listed for the
   *  model the next time the teacher asks, so the next one really differs. */
  rejectMnemonic: adminProcedure
    .input(z.object({ mnemonicId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return rejectMnemonicService(input.mnemonicId, ctx.user.id);
    }),

  /**
   * An admin removes the card's mnemonic for everyone; a student can only
   * remove one they accepted for themselves before v1.8.0. Since v1.20.0 the
   * teacher's approved suggestions are kept as rejected rather than deleted,
   * so the next suggestion for the card is told about them too.
   */
  deleteMnemonic: protectedProcedure
    .input(z.object({ cardId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deckId = await getCardDeckId(input.cardId);
      await assertDeckAccess(ctx.user.id, deckId);

      const ownApproved = and(
        eq(schema.aiMnemonics.cardId, input.cardId),
        eq(schema.aiMnemonics.userId, ctx.user.id),
        eq(schema.aiMnemonics.accepted, true),
      );
      if (ctx.user.role === 'admin') {
        await db.update(schema.cards).set({ mnemonic: null }).where(eq(schema.cards.id, input.cardId));
        await db.update(schema.aiMnemonics)
          .set({ accepted: false, rejectedAt: new Date() })
          .where(ownApproved);
      } else {
        await db.delete(schema.aiMnemonics).where(ownApproved);
      }

      return { success: true };
    }),

  getCardAiState: protectedProcedure
    .input(z.object({ cardId: z.number() }))
    .query(async ({ ctx, input }) => {
      const card = await db.query.cards.findFirst({ where: eq(schema.cards.id, input.cardId) });
      if (!card) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found', cause: { appCode: 'CARD_NOT_FOUND' } });
      }
      await assertDeckAccess(ctx.user.id, card.deckId);

      const isAdmin = ctx.user.role === 'admin';
      const [ownAccepted, pendingRows, approvedRow] = await Promise.all([
        // One a student accepted for themselves before v1.8.0: still theirs,
        // shown only where the card has no teacher mnemonic.
        card.mnemonic ? null : db.query.aiMnemonics.findFirst({
          where: and(
            eq(schema.aiMnemonics.cardId, input.cardId),
            eq(schema.aiMnemonics.userId, ctx.user.id),
            eq(schema.aiMnemonics.accepted, true),
            isNull(schema.aiMnemonics.rejectedAt),
          ),
        }),
        // A teacher's stored, not-yet-reviewed suggestions: shown again instead
        // of asking for new ones. A rejected one never comes back.
        isAdmin && !card.mnemonic ? db.query.aiMnemonics.findMany({
          where: and(
            eq(schema.aiMnemonics.cardId, input.cardId),
            eq(schema.aiMnemonics.userId, ctx.user.id),
            eq(schema.aiMnemonics.accepted, false),
            isNull(schema.aiMnemonics.rejectedAt),
          ),
          orderBy: (m, { desc }) => [desc(m.createdAt), desc(m.id)],
          limit: 50,
        }) : [],
        // The suggestion the card's mnemonic came from, for its style (the teacher's Regenerate).
        isAdmin && card.mnemonic ? db.query.aiMnemonics.findFirst({
          where: and(
            eq(schema.aiMnemonics.cardId, input.cardId),
            eq(schema.aiMnemonics.accepted, true),
            eq(schema.aiMnemonics.text, card.mnemonic),
            // Plain names inside: the relational query renames every column object to its own table.
            sql`${schema.aiMnemonics.userId} IN (SELECT "id" FROM "users" WHERE "role" = 'admin')`,
          ),
          orderBy: (m, { desc }) => [desc(m.id)],
        }) : null,
      ]);
      const acceptedMnemonic: { text: string; source: 'teacher' | 'own'; style?: MnemonicStyle } | null = card.mnemonic
        // The teacher also gets its style, so Regenerate asks for the same kind; a mnemonic no
        // suggestion explains (a CSV import, or one from before v1.20.0) is a keyword.
        ? { text: card.mnemonic, source: 'teacher', ...(isAdmin ? { style: approvedRow?.style ?? 'keyword' } : {}) }
        : ownAccepted ? { text: ownAccepted.text, source: 'own' } : null;
      // Each with its style, so "Try another" asks for the same kind (a row from before v1.20.0 is a keyword).
      const pending = pendingRows.map((row) => ({ id: row.id, text: row.text, style: row.style ?? 'keyword' as MnemonicStyle }));
      const newestIn = (style: MnemonicStyle) => pending.find((row) => row.style === style) ?? null;

      // Only the card's mnemonic: v1.20.0 removed the cognate score, the false-friend warning
      // and the per-student card_ai_state row this used to return.
      return {
        acceptedMnemonic,
        pendingMnemonic: pending[0] ?? null,
        // The newest waiting suggestion of each style (v1.20.0): "Try a sentence" and "Try a
        // keyword" turn nothing down, so the teacher can go back to the other one without paying
        // for it again, and then choose.
        pendingByStyle: { keyword: newestIn('keyword'), sentence: newestIn('sentence') },
      };
    }),

  scanDeck: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeckAccess(ctx.user.id, input.deckId);
      return scanDeck(input.deckId, ctx.user.id);
    }),

  getScanProgress: protectedProcedure
    .input(z.object({ deckId: z.number() }))
    .query(({ ctx, input }) => {
      return getScanProgress(input.deckId, ctx.user.id);
    }),

  regenerateDeckAssets: adminProcedure
    .input(z.object({
      deckId: z.number(),
      cardId: z.number().optional(),
      // 'mnemonic' deletes nothing (approved mnemonics are the teacher's), and 'cognate' is what a
      // page loaded before v1.20.0 still sends: accepted, and ignored with the cognate system.
      assetTypes: z.array(z.enum(['audio', 'image', 'mnemonic', 'cognate'])).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Delete existing assets for the deck (or specific card)
      const cards = input.cardId
        ? await db.query.cards.findMany({ where: and(eq(schema.cards.id, input.cardId), eq(schema.cards.deckId, input.deckId)) })
        : await db.query.cards.findMany({ where: eq(schema.cards.deckId, input.deckId) });

      const cardIds = cards.map(c => c.id);
      if (cardIds.length === 0) return { status: 'no_cards', deleted: 0 };

      const types = input.assetTypes ?? ['audio', 'image'];
      const assetTypesToDelete = types.filter(
        (t): t is 'audio' | 'image' => t === 'audio' || t === 'image',
      );

      if (assetTypesToDelete.length > 0) {
        await db.delete(schema.aiAssets).where(
          and(
            inArray(schema.aiAssets.cardId, cardIds),
            inArray(schema.aiAssets.assetType, assetTypesToDelete),
          ),
        );
      }

      // Reclaim freed SQLite space after bulk deletion (deck-wide only; VACUUM is expensive)
      if (!input.cardId) {
        try {
          await db.run(sql`VACUUM`);
        } catch (err) {
          logger.warn({ err }, 'VACUUM after regeneration failed (non-fatal)');
        }
      }

      // Trigger a fresh scan
      const { scanDeck: scanDeckService } = await import('../services/ai/scanService.js');
      await scanDeckService(input.deckId, ctx.user.id);

      return { status: 'regenerating', cardCount: cardIds.length };
    }),

  // Synchronously delete and regenerate all AI assets for a single card.
  // Used by admins during study sessions so updated assets are available immediately.
  regenerateCardAssets: adminProcedure
    .input(z.object({
      cardId: z.number(),
      deckId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Delete all existing audio and image assets (any status) for this card
      await db.delete(schema.aiAssets)
        .where(and(
          eq(schema.aiAssets.cardId, input.cardId),
          inArray(schema.aiAssets.assetType, ['audio', 'image']),
        ));

      const aiConfig = await getAiRuntimeConfig();
      const results: { audioFront: string | null; audioBack: string | null; image: string | null } = {
        audioFront: null,
        audioBack: null,
        image: null,
      };
      let attempted = 0;
      let succeeded = 0;

      if (aiConfig.pronunciationEnabled) {
        attempted += 2;
        try {
          const r = await generatePronunciation(input.cardId, ctx.user.id, 'front');
          results.audioFront = r.audioUrl ?? null;
          if (results.audioFront) succeeded++;
        } catch { /* error already logged inside pronunciationService */ }
        try {
          const r = await generatePronunciation(input.cardId, ctx.user.id, 'back');
          results.audioBack = r.audioUrl ?? null;
          if (results.audioBack) succeeded++;
        } catch { /* error already logged inside pronunciationService */ }
      }

      if (aiConfig.imageEnabled) {
        attempted++;
        try {
          const r = await generateImage(input.cardId, ctx.user.id);
          results.image = r.imageUrl ?? null;
          if (results.image) succeeded++;
        } catch { /* error already logged inside imageService */ }
      }

      if (attempted > 0 && succeeded === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'All AI asset generation attempts failed',
        });
      }

      return { status: 'done', ...results };
    }),

  getAllScanProgress: adminProcedure.query(async () => {
    const scans = getAllScanProgress();
    const deckIds = [...new Set(scans.map(s => s.deckId))];
    const decks = deckIds.length > 0
      ? await db.query.decks.findMany({ where: inArray(schema.decks.id, deckIds), columns: { id: true, name: true } })
      : [];
    const deckMap = new Map(decks.map(d => [d.id, d.name]));
    return scans.map(s => ({ ...s, deckName: deckMap.get(s.deckId) ?? `Deck ${s.deckId}` }));
  }),

  getAdminConfig: adminProcedure.query(async () => {
    const appSettings = await ensureAppSettings();
    // Live-fetched (7-day cache) with a static fallback — see modelCatalog.
    const catalog = await getModelCatalog();
    return {
      // Providers currently paused because they reported an empty balance.
      pausedProviders: listQuotaBreakers().map((b) => ({
        provider: b.provider,
        since: b.since,
        reason: b.reason,
      })),
      aiEnabled: appSettings.aiEnabled,
      provider: appSettings.aiProvider,
      hasApiKey: Boolean(appSettings.openaiApiKey),
      baseUrl: appSettings.openaiBaseUrl,
      pronunciation: appSettings.aiPronunciationEnabled,
      image: appSettings.aiImageEnabled,
      mnemonic: appSettings.aiMnemonicEnabled,
      // The "repeat the sentence" test's transcription: its own switch (services/transcriptionSetting.ts).
      transcription: isTranscriptionEnabled(),
      mnemonicModel: appSettings.aiMnemonicModel,
      imageModel: appSettings.aiImageModel,
      imageQuality: appSettings.aiImageQuality,
      ttsModel: appSettings.aiTtsModel,
      ttsProvider: appSettings.aiTtsProvider,
      hasElevenLabsKey: Boolean(appSettings.elevenlabsApiKey),
      ttsVoiceMap: parseStoredVoiceMap(appSettings.aiTtsVoiceMap),
      // availableModels.cognate, like cognate and cognateModel below, only for an Admin page loaded
      // before v1.20.0 and left open across the deploy: its Save calls cognateModel.trim() and its
      // Model Settings maps availableModels.cognate, so without them a refetch white-screens it.
      // Inert values, never read from the deprecated columns; they go with them (drizzle/DEPRECATED.md).
      availableModels: { ...catalog.models, cognate: [] as string[] },
      modelsFetchedAt: catalog.fetchedAt,
      cognate: false,
      cognateModel: '',
      // Who writes mnemonic suggestions. The Anthropic key itself never leaves the server.
      textProvider: appSettings.aiTextProvider === 'anthropic' ? 'anthropic' : 'openai',
      hasAnthropicKey: Boolean(appSettings.anthropicApiKey),
      anthropicMnemonicModel: appSettings.aiAnthropicMnemonicModel,
      // Static suggestions for the Claude model field (it accepts any claude-* id).
      anthropicModels: [...ANTHROPIC_TEXT_MODELS],
    };
  }),

  /** Force-refresh the live model list (the panel's "Refresh model list" button). */
  refreshAvailableModels: adminProcedure.mutation(async () => {
    const catalog = await getModelCatalog(true);
    return { availableModels: catalog.models, modelsFetchedAt: catalog.fetchedAt };
  }),

  /** Short sample with a specific ElevenLabs voice — the mapping UI's per-accent
   *  test-play button, so a broken voice is caught before it reaches the bank. */
  previewTtsVoice: adminProcedure
    .input(z.object({ voiceId: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      checkAiRateLimit(ctx.user.id);
      const appSettings = await ensureAppSettings();
      if (!appSettings.elevenlabsApiKey) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No ElevenLabs API key is saved',
          cause: { appCode: 'ELEVENLABS_NOT_CONFIGURED' },
        });
      }
      const model = /^eleven/i.test(appSettings.aiTtsModel) ? appSettings.aiTtsModel : 'eleven_multilingual_v2';
      try {
        const speech = await generateElevenLabsSpeech(
          'Hola, ¿qué tal? Bienvenidos a la clase de español.',
          { language: 'Spanish' },
          { apiKey: appSettings.elevenlabsApiKey, model, voiceMap: { '': input.voiceId } },
        );
        return { audioBase64: speech.audioBuffer.toString('base64'), mimeType: speech.mimeType };
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: error instanceof Error ? error.message : 'Voice preview failed',
          cause: { appCode: 'ELEVENLABS_PREVIEW_FAILED' },
        });
      }
    }),

  /** Voices in the configured ElevenLabs account, for the accent→voice mapping UI. */
  listTtsVoices: adminProcedure.query(async () => {
    const appSettings = await ensureAppSettings();
    if (!appSettings.elevenlabsApiKey) {
      return { configured: false as const, voices: [] };
    }
    try {
      const voices = await listElevenLabsVoices(appSettings.elevenlabsApiKey);
      return { configured: true as const, voices };
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: error instanceof Error ? error.message : 'ElevenLabs voice listing failed',
        cause: { appCode: 'ELEVENLABS_VOICES_UNAVAILABLE' },
      });
    }
  }),

  saveAdminConfig: adminProcedure
    .input(z.object({
      aiEnabled: z.boolean(),
      openaiApiKey: z.string().optional(),
      baseUrl: openAiCompatibleBaseUrlSchema,
      pronunciation: z.boolean(),
      image: z.boolean(),
      mnemonic: z.boolean(),
      mnemonicModel: z.string().trim().min(1).max(120),
      imageModel: z.string().trim().min(1).max(120),
      imageQuality: z.string().trim().min(1).max(40),
      ttsModel: z.string().trim().min(1).max(120),
      ttsProvider: z.enum(['openai', 'elevenlabs']).optional(),
      elevenlabsApiKey: z.string().optional(),
      ttsVoiceMap: z.record(z.string().max(40), z.string().trim().max(120)).optional(),
      // v1.20.0, optional so older callers still validate: who writes mnemonic suggestions, the
      // Anthropic key (undefined keeps it, '' clears it) and the Claude model. The cognate fields
      // a page loaded before v1.20.0 still sends (cognate, cognateModel) are dropped unread.
      textProvider: z.enum(['openai', 'anthropic']).optional(),
      anthropicApiKey: z.string().max(500).optional(),
      anthropicMnemonicModel: z.string().trim().min(1).max(120).optional(),
      // Optional so an Admin page loaded before the switch existed still saves (and leaves it as it is).
      transcription: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      // A key pasted into a model field (the Anthropic key field sits just above them) would be
      // saved as a model id, logged and shown in the panel, or echoed by a mismatch error below,
      // which the tRPC error log writes out. Refuse it without repeating it.
      const modelFields = [
        input.mnemonicModel, input.imageModel, input.ttsModel, input.anthropicMnemonicModel,
      ];
      if (modelFields.some((model) => model !== undefined && redactApiKeys(model) !== model)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A model field holds what looks like an API key — paste keys only into the API key fields',
          cause: { appCode: 'API_KEY_IN_MODEL_FIELD' },
        });
      }

      // Reject a provider/model mismatch outright — a saved eleven_* model on
      // the OpenAI speech endpoint (or vice versa) silently breaks ALL audio.
      const current = await ensureAppSettings();
      const effectiveTtsProvider = input.ttsProvider
        ?? (current.aiTtsProvider === 'elevenlabs' ? 'elevenlabs' : 'openai');
      const isElevenModel = /^eleven/i.test(input.ttsModel);
      if (effectiveTtsProvider === 'elevenlabs' && !isElevenModel) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${input.ttsModel}" is not an ElevenLabs model id — pick an eleven_* model or switch the TTS provider back to OpenAI`,
          cause: { appCode: 'TTS_MODEL_PROVIDER_MISMATCH' },
        });
      }
      if (effectiveTtsProvider === 'openai' && isElevenModel) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${input.ttsModel}" is an ElevenLabs model id — pick an OpenAI speech model or switch the TTS provider to ElevenLabs`,
          cause: { appCode: 'TTS_MODEL_PROVIDER_MISMATCH' },
        });
      }

      // Claude needs a key (this also blocks clearing the key while Claude is selected), and each
      // provider's model field must hold that provider's ids: a gpt id sent to Anthropic, or a
      // claude id sent to api.openai.com, fails every mnemonic.
      const effectiveTextProvider = input.textProvider
        ?? (current.aiTextProvider === 'anthropic' ? 'anthropic' : 'openai');
      const effectiveAnthropicKey = input.anthropicApiKey === undefined
        ? current.anthropicApiKey
        : (input.anthropicApiKey.trim() || null);
      // A zero-width space, a line break or a "…" picked up when copying: fetch could never send
      // it, so every Claude call would fail as if Anthropic were unreachable.
      if (input.anthropicApiKey !== undefined && effectiveAnthropicKey && !isSendableAnthropicKey(effectiveAnthropicKey)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The Anthropic API key has a character no key has (a space, a line break or an invisible character from copying) — copy it again from the Claude Console',
          cause: { appCode: 'ANTHROPIC_KEY_INVALID' },
        });
      }
      if (effectiveTextProvider === 'anthropic' && !effectiveAnthropicKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Claude needs an Anthropic API key — paste one, or switch mnemonic suggestions back to OpenAI.',
          cause: { appCode: 'ANTHROPIC_KEY_MISSING' },
        });
      }
      const claudeMnemonicModel = input.anthropicMnemonicModel ?? current.aiAnthropicMnemonicModel;
      if (!isClaudeModel(claudeMnemonicModel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${claudeMnemonicModel}" is not a Claude model id — pick a claude-* model for mnemonics`,
          cause: { appCode: 'TEXT_MODEL_PROVIDER_MISMATCH' },
        });
      }
      // Only on OpenAI itself: a custom base URL (a LiteLLM proxy, say) may serve claude-* names.
      if (input.baseUrl.trim().startsWith('https://api.openai.com') && isClaudeModel(input.mnemonicModel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${input.mnemonicModel}" is a Claude model id — choose Anthropic (Claude) under “Mnemonic suggestions use”, or pick an OpenAI model`,
          cause: { appCode: 'TEXT_MODEL_PROVIDER_MISMATCH' },
        });
      }

      const updated = await updateAppSettings({
        aiEnabled: input.aiEnabled,
        openaiApiKey: input.openaiApiKey,
        openaiBaseUrl: input.baseUrl,
        aiPronunciationEnabled: input.pronunciation,
        aiImageEnabled: input.image,
        aiMnemonicEnabled: input.mnemonic,
        aiMnemonicModel: input.mnemonicModel,
        aiImageModel: input.imageModel,
        aiImageQuality: input.imageQuality,
        aiTtsModel: input.ttsModel,
        aiTtsProvider: input.ttsProvider,
        elevenlabsApiKey: input.elevenlabsApiKey,
        aiTtsVoiceMap: input.ttsVoiceMap !== undefined ? JSON.stringify(input.ttsVoiceMap) : undefined,
        aiTextProvider: input.textProvider,
        anthropicApiKey: input.anthropicApiKey,
        aiAnthropicMnemonicModel: input.anthropicMnemonicModel,
      });

      if (input.transcription !== undefined) {
        await setTranscriptionEnabled(input.transcription);
      }

      // A newly saved (or removed) key may be a new account: let the next Claude request through
      // at once. The OpenAI and ElevenLabs breakers are left alone.
      if (input.anthropicApiKey !== undefined) {
        clearQuotaBreaker('anthropic');
      }

      // Model lists depend on the saved keys/endpoints/TTS provider — drop the
      // 7-day catalog cache so the dropdowns reflect this config immediately
      // (also the recovery path for a cache captured under the old provider).
      resetModelCatalogCache();

      logger.info({
        aiEnabled: updated.aiEnabled,
        mnemonicModel: updated.aiMnemonicModel,
        imageModel: updated.aiImageModel,
        imageQuality: updated.aiImageQuality,
        ttsModel: updated.aiTtsModel,
        ttsProvider: updated.aiTtsProvider,
        textProvider: updated.aiTextProvider,
        anthropicMnemonicModel: updated.aiAnthropicMnemonicModel,
        hasAnthropicKey: Boolean(updated.anthropicApiKey),
        anthropicKeyChanged: input.anthropicApiKey !== undefined,
      }, 'AI configuration updated');

      return { success: true };
    }),

  /** Admin > AI's "Resume now" on a paused provider: the teacher has added credit, so let the
   *  next real request through at once instead of after the cooldown. If the account is still
   *  empty, that request trips the breaker again (one failed call, not a retry storm). */
  resumeProvider: adminProcedure
    .input(z.object({ provider: z.enum(['openai', 'anthropic', 'elevenlabs']) }))
    .mutation(({ ctx, input }) => {
      const cleared = clearQuotaBreaker(input.provider);
      logger.info({ event: 'ai.quota_breaker_resumed', provider: input.provider, userId: ctx.user.id, cleared },
        'A teacher resumed a paused AI provider');
      return { cleared };
    }),

  /** Admin > AI's "Test key": one tiny call to the Claude mnemonic model, with the key typed in
   *  the field (never saved or logged) or else the saved one. Only a saved key's outcome feeds the
   *  'anthropic' quota breaker, so a passing test resumes paused Claude suggestions at once. */
  testAnthropicKey: adminProcedure
    .input(z.object({
      apiKey: z.string().max(500).optional(),
      mnemonicModel: z.string().trim().min(1).max(120),
    }))
    .mutation(async ({ ctx, input }): Promise<AnthropicKeyTestResult> => {
      const typed = input.apiKey?.trim() || null;
      const apiKey = typed ?? (await ensureAppSettings()).anthropicApiKey;
      if (!apiKey) {
        return { ok: false, kind: 'no_key' };
      }
      // A typed gpt id is a model problem, found without a call.
      if (!isClaudeModel(input.mnemonicModel)) {
        return { ok: false, kind: 'model', model: input.mnemonicModel };
      }
      // The AI budget covers only real provider calls.
      checkAiRateLimit(ctx.user.id);
      return testAnthropicKeyService({ apiKey, models: [input.mnemonicModel], source: typed ? 'typed' : 'saved' });
    }),
});
