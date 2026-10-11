// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { eq, and, inArray, isNotNull, desc, sql, type SQL } from 'drizzle-orm';
import {
  findServableClips, getVocabAudioProgress, getVocabVoiceRouting, startVocabAudioGeneration, startVocabSentenceAudioGeneration,
} from '../services/vocabAudio.js';
import { updateAppSettings } from '../services/appSettings.js';
import { scoreElicitedImitation, DEFAULT_EI_SENTENCES } from '../services/vocabEi.js';
import { getAiRuntimeConfig } from '../services/ai/config.js';
import { createAiProvider } from '../services/ai/providerFactory.js';
import { checkAiRateLimit } from '../services/ai/rateLimit.js';
import { isTranscriptionEnabled } from '../services/transcriptionSetting.js';
import { logger } from '../logger.js';

export const VOCAB_MODES = ['size', 'mastery', 'listen', 'c500', 'a500', 's5000', 'listen2', 'dictado', 'ctest', 'ldt', 'ei'] as const;
export type VocabMode = (typeof VOCAB_MODES)[number];

/** Modes whose items are TTS clips from the audio bank. */
const AURAL_BANK_MODES: VocabMode[] = ['listen2', 'dictado'];

/** Special accent value: mix accents (a different dialect per word). */
const RANDOM_ACCENT = 'random';

/** Small deterministic string hash (djb2) — stable accent choice per student+word. */
function hash32(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

const modeSchema = z.enum(VOCAB_MODES);

// Mode-specific test configuration set by the admin. All fields optional; the
// client applies the same defaults the standalone Vocabulómetro used.
const settingsSchema = z.object({
  preset: z.enum(['rapida', 'precision']).optional(),
  bandCounts: z.array(z.number().int().min(0).max(40)).length(5).optional(),
  npseudo: z.number().int().min(6).max(30).optional(),
  nmast: z.number().int().min(20).max(120).optional(),
  seed: z.number().int().nonnegative().nullable().optional(),
  stopSE: z.number().int().min(150).nullable().optional(),
  blk: z.number().int().min(1).max(30).optional(),
  form: z.enum(['A', 'B']).optional(),
  planCode: z.string().max(20000).nullable().optional(),
  accent: z.string().max(40).optional(),
  textIds: z.array(z.number().int()).max(20).optional(),
  ngaps: z.number().int().min(5).max(60).optional(),
  deadlineMs: z.number().int().min(1000).max(10000).optional(),
  sentenceIds: z.array(z.number().int()).max(40).optional(),
  nsent: z.number().int().min(3).max(30).optional(),
}).strict();

export type VocabTestSettings = z.infer<typeof settingsSchema>;

// A [n, positives] pair: the second element can never exceed the first.
// Without that check a client could post [10, 9999] and drive h=y/n far above
// 1, which propagates into every size/coverage figure the teacher views and
// into the anuario running estimate.
const countPair = z.tuple([z.number().int().min(0).max(10000), z.number().int().min(0).max(10000)])
  .refine(([n, y]) => y <= n, { message: 'positives cannot exceed the item count' });

/** Highest word index the client dataset can produce (top-5.000 rank domain). */
const MAX_WORD_INDEX = 4999;

// Sufficient statistics of one attempt — same shapes as the standalone app's
// VNHS1 result codes (v1 for size/mastery/listen, v2 for censo/activo/sondeo).
// These arrive from the client and are stored verbatim, so every field the
// dashboard, profile, and anuario compute from is range-checked here: the
// client is the student's own browser and is not trusted.
const summarySchema = z.union([
  z.object({
    v: z.literal(1),
    yn: z.object({ bands: z.array(countPair).length(5), ps: countPair }),
    // speeded lexical decision: median RT of correct yeses + timeout count
    rt: z.object({
      med: z.number().int().min(0).max(60000).nullable(),
      timeouts: z.number().int().min(0).max(1000),
    }).optional(),
  }).strict(),
  z.object({
    v: z.literal(1),
    // C-test: gaps attempted, exact restorations, accent-lenient restorations
    ct: z.object({
      n: z.number().int().min(0).max(500),
      c: z.number().int().min(0).max(500),
      cl: z.number().int().min(0).max(500),
    }).refine((t) => t.c <= t.n && t.cl <= t.n, {
      message: 'ct restorations cannot exceed the gap count',
    }),
  }).strict(),
  z.object({
    v: z.literal(1),
    // elicited imitation: sentences attempted + summed 0–1 scores (sum ≤ n)
    ei: z.object({
      n: z.number().int().min(0).max(60),
      sum: z.number().min(0).max(60),
    }).refine((e) => e.sum <= e.n, { message: 'ei.sum cannot exceed ei.n' }),
  }).strict(),
  z.object({
    v: z.literal(1),
    // correct + wrong + omitted must partition the items, or the guessing
    // correction (c − w/3)/n is computed over an incoherent denominator
    mc: z.object({
      n: z.number().int().min(0).max(1000),
      c: z.number().int().min(0).max(1000),
      w: z.number().int().min(0).max(1000),
      o: z.number().int().min(0).max(1000),
    }).refine((m) => m.c + m.w + m.o === m.n, { message: 'mc requires c + w + o === n' }),
  }).strict(),
  z.object({
    v: z.literal(2),
    // [word index, state 0-3]; indices outside the rank domain would be dead
    // weight in the ledger and inflate the "censado" share
    res: z.array(z.tuple([
      z.number().int().min(0).max(MAX_WORD_INDEX),
      z.number().int().min(0).max(3),
    ])).max(6000),
    ps: countPair,
  }).strict(),
]);

const isoDate = z.string().datetime({ offset: true });

type SubmittedSummary = z.infer<typeof summarySchema>;

export interface VocabItemAgg {
  w: string;
  ynN: number; ynYes: number;         // distinct students' latest size-test Sí/No response
  ynMsSum: number; ynMsN: number;     // latency of those Sí/No decisions only
  mcN: number; mcOk: number;          // distinct students' latest meaning-check/typed response
}

/** Response-time threshold below which a "sí" is suspiciously fast (ms). */
const FAST_YES_MS = 700;

/** Median "sí" response time below which an attempt looks like yes-mashing (ms). */
const FAST_MEDIAN_YES_MS = 900;

/** Fewest timed "sí" answers the median-speed rule needs before it can flag. */
const MIN_YES_FOR_MEDIAN = 20;

/**
 * Censo/activo/sondeo: every "sí" is verified by a meaning check or a typed
 * retest, so speed says nothing about whether the result can be trusted.
 */
const CENSUS_MODES: readonly VocabMode[] = ['c500', 'a500', 's5000'];

/** Middle value of the non-negative `ms` fields (upper median), or null when none. */
function medianOfMs(responses: Record<string, unknown>[]): number | null {
  const times = responses
    .map((r) => (typeof r.ms === 'number' && r.ms >= 0 ? r.ms : null))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  return times.length ? times[Math.floor(times.length / 2)] : null;
}

/**
 * Attempt-quality metrics computed at submit time: false-alarm rate, latency
 * profile, and a fast-yes share that flags likely overclaiming or random
 * clicking. Stored alongside the result so the admin panel can qualify scores.
 *
 * Only a "sí" can inflate a vocabulary estimate, so the speed rules look at
 * "sí" answers alone: a beginner who quickly says "no" to the many words they
 * don't know is answering honestly, not rushing.
 */
function computeQuality(
  responses: Record<string, unknown>[] | undefined,
  summary: SubmittedSummary,
  mode: VocabMode,
): string | null {
  if (!responses || responses.length === 0) return null;
  const medianMs = medianOfMs(responses);

  const yesResponses = responses.filter((r) => r.yes === true);
  const timedYes = yesResponses.filter((r) => typeof r.ms === 'number' && r.ms >= 0);
  const medianYesMs = medianOfMs(timedYes);
  // A fast "sí" is only suspicious where a fluent student should hesitate:
  // pseudowords and low-frequency bands (b>=2). Fast yeses on high-frequency
  // real words are normal fluent behavior, not overclaiming. Responses that
  // carry no t/b metadata (protocol screens) fall back to counting all yeses.
  const classifiable = yesResponses.some((r) => typeof r.t === 'string' || typeof r.b === 'number');
  const suspectYes = classifiable
    ? yesResponses.filter((r) => r.t === 'pseudo' || (typeof r.b === 'number' && r.b >= 2))
    : yesResponses;
  const fastYesCount = suspectYes.filter((r) => typeof r.ms === 'number' && r.ms < FAST_YES_MS).length;
  const fastYesShare = suspectYes.length ? fastYesCount / suspectYes.length : null;

  let faRate: number | null = null;
  if ('yn' in summary) {
    faRate = summary.yn.ps[0] ? summary.yn.ps[1] / summary.yn.ps[0] : null;
  } else if ('ps' in summary) {
    faRate = summary.ps[0] ? summary.ps[1] / summary.ps[0] : null;
  }

  // A speeded lexical-decision attempt (rt present) is SUPPOSED to be fast, and
  // a census attempt verifies its "sí" answers with meaning checks and typed
  // retests, so neither is judged on speed: only the false-alarm rate applies.
  const isSpeeded = 'yn' in summary && 'rt' in summary && summary.rt != null;
  const speedRulesApply = !isSpeeded && !CENSUS_MODES.includes(mode);

  const flagged =
    (faRate !== null && faRate > 0.3) ||
    (speedRulesApply && medianYesMs !== null && timedYes.length >= MIN_YES_FOR_MEDIAN && medianYesMs < FAST_MEDIAN_YES_MS) ||
    (speedRulesApply && suspectYes.length >= 5 && fastYesShare !== null && fastYesShare > 0.5);

  return JSON.stringify({
    itemCount: responses.length,
    medianMs,
    medianYesMs,
    yesCount: yesResponses.length,
    fastYesCount,
    fastYesShare,
    faRate,
    flagged,
  });
}

/** Most recent attempts getItemStats parses; beyond it the result says `truncated`. */
export const ITEM_STATS_MAX_ATTEMPTS = 2000;

/** SQL predicate: the stored summary is a v2 (per-word census) summary. */
const isV2SummarySql = sql`(CASE WHEN json_valid(${schema.vocabResults.summaryJson}) THEN json_extract(${schema.vocabResults.summaryJson}, '$.v') END) = 2`;

const resultsFilterSchema = z.object({
  testId: z.number().int().optional(),
  groupId: z.number().int().optional(),
});

/** WHERE conditions for a teacher results query, or null when the group is empty. */
async function resultsFilterConditions(input: z.infer<typeof resultsFilterSchema>): Promise<SQL[] | null> {
  const conditions: SQL[] = [];
  if (input.testId !== undefined) {
    conditions.push(eq(schema.vocabResults.testId, input.testId));
  }
  if (input.groupId !== undefined) {
    const members = await db.select({ userId: schema.userGroups.userId })
      .from(schema.userGroups)
      .where(eq(schema.userGroups.groupId, input.groupId));
    const memberIds = members.map((m) => m.userId);
    if (memberIds.length === 0) return null;
    conditions.push(inArray(schema.vocabResults.userId, memberIds));
  }
  return conditions;
}

/** Rejects a window that closes before it opens: students would never see the test. */
function assertWindowOrder(opensAt: Date | null, closesAt: Date | null): void {
  if (opensAt && closesAt && closesAt.getTime() < opensAt.getTime()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The closing time must be after the opening time.',
      cause: { appCode: 'VOCAB_TEST_WINDOW_INVERTED' },
    });
  }
}

function isTestOpenNow(test: { isOpen: boolean; opensAt: Date | null; closesAt: Date | null }): boolean {
  if (!test.isOpen) return false;
  const now = Date.now();
  if (test.opensAt && now < test.opensAt.getTime()) return false;
  if (test.closesAt && now > test.closesAt.getTime()) return false;
  return true;
}

async function getUserGroupIds(userId: number): Promise<number[]> {
  const rows = await db.select({ groupId: schema.userGroups.groupId })
    .from(schema.userGroups)
    .where(eq(schema.userGroups.userId, userId));
  return rows.map((r) => r.groupId);
}

async function getAccessibleOpenTest(userId: number, testId: number) {
  const test = await db.query.vocabTests.findFirst({
    where: eq(schema.vocabTests.id, testId),
  });
  if (!test) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Vocabulary test not found',
      cause: { appCode: 'VOCAB_TEST_NOT_FOUND' },
    });
  }

  const groupIds = await getUserGroupIds(userId);
  const assigned = groupIds.length > 0
    ? await db.select({ testId: schema.vocabTestGroups.testId })
      .from(schema.vocabTestGroups)
      .where(and(
        eq(schema.vocabTestGroups.testId, testId),
        inArray(schema.vocabTestGroups.groupId, groupIds)
      ))
    : [];
  if (assigned.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This test is not available to your groups',
      cause: { appCode: 'VOCAB_TEST_NOT_ASSIGNED' },
    });
  }

  if (!isTestOpenNow(test)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This test is currently closed',
      cause: { appCode: 'VOCAB_TEST_CLOSED' },
    });
  }

  return test;
}

async function getEiSentencesForTest(settings: VocabTestSettings) {
  const rows = await db.select({
    id: schema.vocabEiSentences.id,
    text: schema.vocabEiSentences.text,
    difficulty: schema.vocabEiSentences.difficulty,
  })
    .from(schema.vocabEiSentences)
    .orderBy(schema.vocabEiSentences.difficulty);
  const ids = settings.sentenceIds;
  const pool = ids && ids.length > 0 ? rows.filter((r) => ids.includes(r.id)) : rows;
  const n = Math.min(settings.nsent ?? 10, pool.length);
  // Spread across the difficulty-sorted pool so the test probes the full range
  // (not the N easiest) and stays comparable across configurations.
  return pool.length <= n
    ? pool
    : Array.from({ length: n }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
}

/** Current-voice sentence clip URL per sentence id (the clip key is the trimmed text). */
async function sentenceClipUrls(sentences: { id: number; text: string }[]): Promise<Record<number, string>> {
  if (sentences.length === 0) return {};
  const clips = await findServableClips({ kind: 'sentence', accent: '', words: [...new Set(sentences.map((s) => s.text.trim()))] });
  const byText = new Map(clips.filter((c) => c.url).map((c) => [c.word, c.url as string]));
  const urls: Record<number, string> = {};
  for (const sentence of sentences) {
    const url = byText.get(sentence.text.trim());
    if (url) urls[sentence.id] = url;
  }
  return urls;
}

async function getTestGroups(testIds: number[]) {
  if (testIds.length === 0) return [];
  return db.select({
    testId: schema.vocabTestGroups.testId,
    groupId: schema.vocabTestGroups.groupId,
    groupName: schema.groups.name,
  })
    .from(schema.vocabTestGroups)
    .innerJoin(schema.groups, eq(schema.vocabTestGroups.groupId, schema.groups.id))
    .where(inArray(schema.vocabTestGroups.testId, testIds));
}

export const vocabRouter = router({
  // ---------- student ----------

  listOpenTests: protectedProcedure.query(async ({ ctx }) => {
    const groupIds = await getUserGroupIds(ctx.user.id);
    if (groupIds.length === 0) return [];

    const assignments = await db.select({ testId: schema.vocabTestGroups.testId })
      .from(schema.vocabTestGroups)
      .where(inArray(schema.vocabTestGroups.groupId, groupIds));
    const testIds = [...new Set(assignments.map((a) => a.testId))];
    if (testIds.length === 0) return [];

    const tests = await db.query.vocabTests.findMany({
      where: inArray(schema.vocabTests.id, testIds),
    });

    const open = tests.filter(isTestOpenNow);
    if (open.length === 0) return [];

    const attempts = await db.select({
      testId: schema.vocabResults.testId,
      count: sql<number>`count(*)`,
    })
      .from(schema.vocabResults)
      .where(and(
        eq(schema.vocabResults.userId, ctx.user.id),
        inArray(schema.vocabResults.testId, open.map((t) => t.id))
      ))
      .groupBy(schema.vocabResults.testId);
    const attemptsByTest = new Map(attempts.map((a) => [a.testId, a.count]));

    return open.map((test) => ({
      id: test.id,
      name: test.name,
      mode: test.mode,
      occasion: test.occasion,
      settings: settingsSchema.parse(JSON.parse(test.settingsJson)),
      closesAt: test.closesAt,
      myAttempts: attemptsByTest.get(test.id) ?? 0,
    }));
  }),

  submitResult: protectedProcedure
    .input(z.object({
      testId: z.number().int(),
      seed: z.number().int().nonnegative(),
      blk: z.string().max(10).optional(),
      form: z.string().max(2).optional(),
      summary: summarySchema,
      responses: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
      startedAt: isoDate.optional(),
      durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);

      const responsesJson = input.responses ? JSON.stringify(input.responses) : null;
      if (responsesJson && responsesJson.length > 1_000_000) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Response detail too large',
          cause: { appCode: 'VOCAB_RESPONSES_TOO_LARGE' },
        });
      }

      const inserted = await db.insert(schema.vocabResults).values({
        testId: test.id,
        userId: ctx.user.id,
        mode: test.mode,
        seed: input.seed,
        blk: input.blk ?? null,
        form: input.form ?? null,
        occasion: test.occasion,
        summaryJson: JSON.stringify(input.summary),
        responsesJson,
        qualityJson: computeQuality(input.responses, input.summary, test.mode),
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        completedAt: new Date(),
        durationMs: input.durationMs ?? null,
      }).returning();

      return { id: inserted[0].id };
    }),

  /**
   * Words this student has already been shown in prior UNSEEDED size attempts,
   * so repeat administrations can sample unseen items (avoids practice effects
   * inflating longitudinal gains). Fixed forms are deliberately excluded from
   * the frame: the listening form and teacher-seeded common forms are
   * hand-picked word sets, and removing them from every student's future
   * sampling frame would bias class means in a shared direction.
   */
  getMySeenWords: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.select({
      responsesJson: schema.vocabResults.responsesJson,
      settingsJson: schema.vocabTests.settingsJson,
    })
      .from(schema.vocabResults)
      .innerJoin(schema.vocabTests, eq(schema.vocabResults.testId, schema.vocabTests.id))
      .where(and(
        eq(schema.vocabResults.userId, ctx.user.id),
        eq(schema.vocabResults.mode, 'size')
      ))
      .orderBy(desc(schema.vocabResults.completedAt))
      .limit(50);

    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.responsesJson) continue;
      try {
        const settings = settingsSchema.parse(JSON.parse(row.settingsJson));
        if (settings.seed != null) continue; // seeded common form: not part of the random frame
        const items = JSON.parse(row.responsesJson) as { w?: unknown }[];
        for (const item of items) {
          if (typeof item.w === 'string') seen.add(item.w);
        }
      } catch {
        continue;
      }
      if (seen.size > 4000) break;
    }
    return { words: [...seen] };
  }),

  getMyResults: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.select({
      id: schema.vocabResults.id,
      testId: schema.vocabResults.testId,
      testName: schema.vocabTests.name,
      mode: schema.vocabResults.mode,
      blk: schema.vocabResults.blk,
      form: schema.vocabResults.form,
      occasion: schema.vocabResults.occasion,
      summaryJson: schema.vocabResults.summaryJson,
      qualityJson: schema.vocabResults.qualityJson,
      completedAt: schema.vocabResults.completedAt,
    })
      .from(schema.vocabResults)
      .innerJoin(schema.vocabTests, eq(schema.vocabResults.testId, schema.vocabTests.id))
      .where(eq(schema.vocabResults.userId, ctx.user.id))
      .orderBy(desc(schema.vocabResults.completedAt));
    return rows;
  }),

  // ---------- elicited imitation (speech) ----------

  /**
   * Sentences for an EI test the student is taking (open-test gated), and whether a recording can
   * be transcribed: the transcription switch AND AI as a whole, the two things transcribeEiRecording
   * checks first. Either off, the runner says so before the student records anything.
   */
  getTestEiSentences: protectedProcedure
    .input(z.object({ testId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);
      const settings = settingsSchema.parse(JSON.parse(test.settingsJson));
      const transcriptionEnabled = isTranscriptionEnabled() && (await getAiRuntimeConfig()).aiEnabled;
      return { sentences: await getEiSentencesForTest(settings), transcriptionEnabled };
    }),

  /** Whether the "repeat the sentence" transcription switch is on (Admin > AI), for the test editor. */
  transcriptionStatus: adminProcedure.query(async () => {
    const ai = await getAiRuntimeConfig();
    return { enabled: isTranscriptionEnabled(), aiEnabled: ai.aiEnabled };
  }),

  /**
   * Clip URLs (by sentence id) for an EI test's sentences, in the current
   * Vocabulómetro voice. A sentence without a clip is absent — the runner then
   * falls back to the browser's speech synthesis for it.
   */
  getTestEiAudio: protectedProcedure
    .input(z.object({ testId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);
      if (test.mode !== 'ei') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an elicited-imitation test', cause: { appCode: 'VOCAB_TEST_NOT_EI' } });
      }
      const settings = settingsSchema.parse(JSON.parse(test.settingsJson));
      return { urls: await sentenceClipUrls(await getEiSentencesForTest(settings)) };
    }),

  /**
   * Transcribe a student's recorded repetition and score it against the target
   * sentence. The audio is sent to the AI provider (OpenAI whisper-1) with no
   * identifier, transcribed in memory and never written to disk; only the
   * transcript and score are returned (the runner saves them in the result it
   * submits). The score is computed server-side (never trusted from the client).
   * Needs the transcription switch (services/transcriptionSetting.ts) and AI on.
   * Each call that reaches the provider leaves one 'ai.transcription' log line
   * (user, test, duration, outcome; no audio, no transcript): all the log keeps of it.
   */
  transcribeEiRecording: protectedProcedure
    .input(z.object({
      testId: z.number().int(),
      sentenceId: z.number().int(),
      // base64 kept comfortably under the 10mb express body limit
      audioBase64: z.string().max(8_000_000),
      mimeType: z.string().max(60),
    }))
    .mutation(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);
      if (test.mode !== 'ei') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an elicited-imitation test', cause: { appCode: 'VOCAB_TEST_NOT_EI' } });
      }
      // The sentence must belong to THIS test's configured set — otherwise a
      // student could score against any (e.g. easiest) sentence in the bank.
      const settings = settingsSchema.parse(JSON.parse(test.settingsJson));
      const allowedIds = new Set((await getEiSentencesForTest(settings)).map((r) => r.id));
      if (!allowedIds.has(input.sentenceId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sentence not part of this test', cause: { appCode: 'VOCAB_EI_SENTENCE_NOT_IN_TEST' } });
      }
      const sentence = await db.query.vocabEiSentences.findFirst({
        where: eq(schema.vocabEiSentences.id, input.sentenceId),
      });
      if (!sentence) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sentence not found', cause: { appCode: 'VOCAB_EI_SENTENCE_NOT_FOUND' } });
      }

      if (!isTranscriptionEnabled()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Speech transcription is switched off for this site', cause: { appCode: 'VOCAB_EI_TRANSCRIPTION_OFF' } });
      }
      const aiConfig = await getAiRuntimeConfig();
      if (!aiConfig.aiEnabled) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Speech transcription requires AI to be enabled', cause: { appCode: 'VOCAB_EI_AI_DISABLED' } });
      }
      checkAiRateLimit(ctx.user.id, 20);

      const provider = await createAiProvider(aiConfig);
      if (!provider) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'AI provider not configured', cause: { appCode: 'VOCAB_EI_AI_DISABLED' } });
      }

      const buffer = Buffer.from(input.audioBase64, 'base64');
      if (buffer.length < 200) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Recording too short or empty', cause: { appCode: 'VOCAB_EI_EMPTY' } });
      }

      // Privacy: the student's voice recording is transcribed in-memory and
      // NOT persisted — only the transcript and score are kept. (Minors' voice
      // audio must not sit at a public asset URL.)
      let transcript = '';
      const startedAt = Date.now();
      const logTranscription = (outcome: 'ok' | 'empty' | 'failed') => logger.info({
        event: 'ai.transcription', userId: ctx.user.id, testId: input.testId, durationMs: Date.now() - startedAt, outcome,
      }, 'Speech transcription');
      try {
        const result = await provider.generateTranscription(buffer, input.mimeType, 'es');
        transcript = result.text;
        logTranscription(transcript.trim().length === 0 ? 'empty' : 'ok');
      } catch (error) {
        logTranscription('failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Transcription failed',
          cause: { appCode: 'VOCAB_EI_TRANSCRIBE_FAILED' },
        });
      }

      // No-speech guard: an empty/near-empty transcript scores 0 (the F1 would
      // anyway, but be explicit so silence is never rewarded).
      const scored = transcript.trim().length === 0
        ? { score: 0 }
        : scoreElicitedImitation(sentence.text, transcript);
      return { transcript, score: scored.score, target: sentence.text };
    }),

  listEiSentences: adminProcedure.query(async () => {
    return db.select({
      id: schema.vocabEiSentences.id,
      text: schema.vocabEiSentences.text,
      difficulty: schema.vocabEiSentences.difficulty,
    })
      .from(schema.vocabEiSentences)
      .orderBy(schema.vocabEiSentences.difficulty);
  }),

  createEiSentence: adminProcedure
    .input(z.object({ text: z.string().min(3).max(300), difficulty: z.number().int().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(schema.vocabEiSentences).values({
        text: input.text, difficulty: input.difficulty, createdBy: ctx.user.id,
      }).returning();
      return inserted[0];
    }),

  deleteEiSentence: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.vocabEiSentences).where(eq(schema.vocabEiSentences.id, input.id));
      return { success: true };
    }),

  /** Seed the default graded sentence bank if it is empty. */
  seedEiSentences: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await db.select({ id: schema.vocabEiSentences.id }).from(schema.vocabEiSentences).limit(1);
    if (existing.length > 0) return { seeded: 0 };
    await db.insert(schema.vocabEiSentences).values(
      DEFAULT_EI_SENTENCES.map((sen) => ({ text: sen.text, difficulty: sen.difficulty, createdBy: ctx.user.id }))
    );
    return { seeded: DEFAULT_EI_SENTENCES.length };
  }),

  // ---------- source texts (C-test / generated measures) ----------

  /** Passages for a text-based test the student is about to take. */
  getTestTexts: protectedProcedure
    .input(z.object({ testId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);
      const settings = settingsSchema.parse(JSON.parse(test.settingsJson));
      const ids = settings.textIds ?? [];
      if (ids.length === 0) return { texts: [] };
      const rows = await db.select({
        id: schema.vocabTexts.id,
        title: schema.vocabTexts.title,
        content: schema.vocabTexts.content,
      })
        .from(schema.vocabTexts)
        .where(inArray(schema.vocabTexts.id, ids));
      // preserve the order the teacher selected the texts in
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is typeof rows[number] => r != null);
      return { texts: ordered };
    }),

  listTexts: adminProcedure.query(async () => {
    const rows = await db.select({
      id: schema.vocabTexts.id,
      title: schema.vocabTexts.title,
      content: schema.vocabTexts.content,
      createdAt: schema.vocabTexts.createdAt,
    })
      .from(schema.vocabTexts)
      .orderBy(desc(schema.vocabTexts.createdAt));
    return rows;
  }),

  createText: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(50).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(schema.vocabTexts).values({
        title: input.title,
        content: input.content,
        createdBy: ctx.user.id,
      }).returning();
      return inserted[0];
    }),

  deleteText: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      // Block deletion while a test still references the text — otherwise its
      // C-test form would silently lose gaps (or break) mid-window.
      const tests = await db.select({
        name: schema.vocabTests.name,
        settingsJson: schema.vocabTests.settingsJson,
      }).from(schema.vocabTests);
      const referencing = tests.filter((t) => {
        try {
          return (settingsSchema.parse(JSON.parse(t.settingsJson)).textIds ?? []).includes(input.id);
        } catch {
          return false;
        }
      });
      if (referencing.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `In use by ${referencing.length} test(s): ${referencing.map((t) => t.name).join(', ')}. Remove it from those tests first.`,
          cause: { appCode: 'VOCAB_TEXT_IN_USE' },
        });
      }
      await db.delete(schema.vocabTexts).where(eq(schema.vocabTexts.id, input.id));
      return { success: true };
    }),

  // ---------- audio bank ----------

  /**
   * Ready audio-bank words for an accent. Students may query only when an
   * open aural test is available to one of their groups (the word list
   * reveals nothing sensitive, but there is no reason to serve it otherwise).
   */
  getAudioBankWords: protectedProcedure
    .input(z.object({ accent: z.string().max(40).default('') }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        const groupIds = await getUserGroupIds(ctx.user.id);
        if (groupIds.length === 0) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No aural test available' });
        }
        const assignments = await db.select({ testId: schema.vocabTestGroups.testId })
          .from(schema.vocabTestGroups)
          .where(inArray(schema.vocabTestGroups.groupId, groupIds));
        const testIds = [...new Set(assignments.map((a) => a.testId))];
        const tests = testIds.length > 0
          ? await db.query.vocabTests.findMany({ where: inArray(schema.vocabTests.id, testIds) })
          : [];
        const hasAural = tests.some((t) => AURAL_BANK_MODES.includes(t.mode as VocabMode) && isTestOpenNow(t));
        if (!hasAural) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No aural test available' });
        }
      }
      // Only clips in the accent's current voice count (never sentence clips);
      // random accent: a word counts if ANY accent in the random pool has one.
      const rows = await findServableClips({ kind: 'word', accent: input.accent });
      return { words: [...new Set(rows.map((r) => r.word))] };
    }),

  /** Opus clip URLs for the words an aural test session sampled. */
  getVocabAudioUrls: protectedProcedure
    .input(z.object({
      testId: z.number().int(),
      words: z.array(z.string().min(1).max(60)).min(1).max(400),
    }))
    .query(async ({ ctx, input }) => {
      const test = await getAccessibleOpenTest(ctx.user.id, input.testId);
      if (!AURAL_BANK_MODES.includes(test.mode as VocabMode)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This test has no audio bank',
          cause: { appCode: 'VOCAB_TEST_NOT_AURAL' },
        });
      }
      const settings = settingsSchema.parse(JSON.parse(test.settingsJson));
      const accent = settings.accent ?? '';

      if (accent === RANDOM_ACCENT) {
        // Gather every servable clip across the random pool's accents for the
        // requested words, then pick one accent per word deterministically
        // (stable per student+word), so one test presents a mix of dialects.
        const rows = await findServableClips({ kind: 'word', accent, words: input.words });
        const byWord = new Map<string, { accent: string; url: string }[]>();
        for (const row of rows) {
          if (!row.url) continue;
          (byWord.get(row.word) ?? byWord.set(row.word, []).get(row.word)!).push({ accent: row.accent, url: row.url });
        }
        const urls: Record<string, string> = {};
        for (const [word, clips] of byWord) {
          clips.sort((a, b) => a.accent.localeCompare(b.accent)); // stable ordering
          const idx = hash32(`${ctx.user.id}:${word}`) % clips.length;
          urls[word] = clips[idx].url;
        }
        return { urls };
      }

      const rows = await findServableClips({ kind: 'word', accent, words: input.words });
      const urls: Record<string, string> = {};
      for (const row of rows) {
        if (row.url) urls[row.word] = row.url;
      }
      return { urls };
    }),

  generateAudioBank: adminProcedure
    .input(z.object({
      words: z.array(z.string().min(1).max(60)).min(1).max(6000),
      accent: z.string().max(40).default(''),
      pseudoWords: z.array(z.string().min(1).max(60)).max(2000).optional(),
      force: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await startVocabAudioGeneration(input.words, input.accent, {
          pseudoWords: input.pseudoWords,
          force: input.force,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error instanceof Error ? error.message : 'Audio generation unavailable',
          cause: { appCode: 'VOCAB_AUDIO_UNAVAILABLE' },
        });
      }
    }),

  getAudioBankProgress: adminProcedure.query(() => getVocabAudioProgress()),

  // ---------- Vocabulómetro voice + sentence audio ----------

  /**
   * Who speaks the Vocabulómetro. The default accent uses the Vocabulómetro
   * voice (falling back to the AI voice map's default); other accents use the
   * voice map. The flashcard TTS never reads vocabVoiceId.
   */
  getVocabVoice: adminProcedure.query(async () => {
    const config = await getAiRuntimeConfig();
    const routing = await getVocabVoiceRouting();
    return {
      ttsProvider: config.ttsProvider === 'elevenlabs' ? 'elevenlabs' as const : 'openai' as const,
      hasElevenLabsKey: Boolean(config.elevenlabsApiKey),
      vocabVoiceId: config.vocabTtsVoiceId,
      defaultVoiceId: (Object.hasOwn(config.ttsVoiceMap ?? {}, '') && config.ttsVoiceMap[''])
        ? config.ttsVoiceMap[''] : null,
      /** The voice now speaking the default accent (null under OpenAI or when unset). */
      effectiveVoiceId: routing.elevenLabs ? (routing.voiceFor('') ?? null) : null,
    };
  }),

  setVocabVoice: adminProcedure
    .input(z.object({
      // ElevenLabs voice ids are short alphanumeric tokens; null clears it.
      voiceId: z.string().trim().regex(/^[A-Za-z0-9]{8,64}$/, 'Not an ElevenLabs voice id').nullable(),
    }))
    .mutation(async ({ input }) => {
      const updated = await updateAppSettings({ vocabTtsVoiceId: input.voiceId });
      return { vocabVoiceId: updated.vocabTtsVoiceId };
    }),

  /** Sentence clips in the current Vocabulómetro voice, per sentence id. */
  getEiSentenceAudioStatus: adminProcedure.query(async () => {
    const sentences = await db.select({ id: schema.vocabEiSentences.id, text: schema.vocabEiSentences.text })
      .from(schema.vocabEiSentences);
    const urls = await sentenceClipUrls(sentences);
    return {
      total: sentences.length,
      ready: Object.keys(urls).length,
      readyIds: Object.keys(urls).map(Number),
    };
  }),

  generateEiSentenceAudio: adminProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      const sentences = await db.select({ text: schema.vocabEiSentences.text }).from(schema.vocabEiSentences);
      if (sentences.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No sentences to generate', cause: { appCode: 'VOCAB_EI_NO_SENTENCES' } });
      }
      try {
        return await startVocabSentenceAudioGeneration(sentences.map((r) => r.text), { force: input?.force });
      } catch (error) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error instanceof Error ? error.message : 'Audio generation unavailable',
          cause: { appCode: 'VOCAB_AUDIO_UNAVAILABLE' },
        });
      }
    }),

  // ---------- admin ----------

  listTests: adminProcedure.query(async () => {
    const tests = await db.query.vocabTests.findMany({
      orderBy: [desc(schema.vocabTests.createdAt)],
    });

    const testIds = tests.map((t) => t.id);
    const groupRows = await getTestGroups(testIds);

    const counts = testIds.length > 0
      ? await db.select({
        testId: schema.vocabResults.testId,
        count: sql<number>`count(*)`,
      })
        .from(schema.vocabResults)
        .where(inArray(schema.vocabResults.testId, testIds))
        .groupBy(schema.vocabResults.testId)
      : [];
    const countByTest = new Map(counts.map((c) => [c.testId, c.count]));

    return tests.map((test) => ({
      ...test,
      settings: settingsSchema.parse(JSON.parse(test.settingsJson)),
      groups: groupRows
        .filter((g) => g.testId === test.id)
        .map((g) => ({ id: g.groupId, name: g.groupName })),
      resultCount: countByTest.get(test.id) ?? 0,
    }));
  }),

  createTest: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      mode: modeSchema,
      occasion: z.string().max(100).optional(),
      settings: settingsSchema.optional(),
      groupIds: z.array(z.number().int()).max(500),
      isOpen: z.boolean().optional(),
      opensAt: isoDate.nullable().optional(),
      closesAt: isoDate.nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.mode === 'ei' && !isTranscriptionEnabled()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The "repeat the sentence" test needs speech transcription, which is switched off. Turn it on in Admin > AI first (only if your school has agreed to it).',
          cause: { appCode: 'VOCAB_EI_TRANSCRIPTION_OFF' },
        });
      }
      assertWindowOrder(
        input.opensAt ? new Date(input.opensAt) : null,
        input.closesAt ? new Date(input.closesAt) : null,
      );
      const inserted = await db.insert(schema.vocabTests).values({
        name: input.name,
        mode: input.mode,
        occasion: input.occasion ?? null,
        settingsJson: JSON.stringify(input.settings ?? {}),
        isOpen: input.isOpen ?? false,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        createdBy: ctx.user.id,
      }).returning();
      const test = inserted[0];

      if (input.groupIds.length > 0) {
        await db.insert(schema.vocabTestGroups).values(
          input.groupIds.map((groupId) => ({ testId: test.id, groupId }))
        );
      }

      return test;
    }),

  updateTest: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(200).optional(),
      occasion: z.string().max(100).nullable().optional(),
      settings: settingsSchema.optional(),
      groupIds: z.array(z.number().int()).max(500).optional(),
      isOpen: z.boolean().optional(),
      opensAt: isoDate.nullable().optional(),
      closesAt: isoDate.nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.query.vocabTests.findFirst({
        where: eq(schema.vocabTests.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Vocabulary test not found',
          cause: { appCode: 'VOCAB_TEST_NOT_FOUND' },
        });
      }

      const updates: Partial<typeof schema.vocabTests.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.occasion !== undefined) updates.occasion = input.occasion;
      if (input.settings !== undefined) updates.settingsJson = JSON.stringify(input.settings);
      if (input.isOpen !== undefined) updates.isOpen = input.isOpen;
      if (input.opensAt !== undefined) updates.opensAt = input.opensAt ? new Date(input.opensAt) : null;
      if (input.closesAt !== undefined) updates.closesAt = input.closesAt ? new Date(input.closesAt) : null;
      // Check the merged window only when this call moves it, so an isOpen
      // toggle on an older inverted row can still close it.
      if (input.opensAt !== undefined || input.closesAt !== undefined) {
        assertWindowOrder(
          updates.opensAt !== undefined ? updates.opensAt : existing.opensAt,
          updates.closesAt !== undefined ? updates.closesAt : existing.closesAt,
        );
      }

      if (Object.keys(updates).length > 0) {
        await db.update(schema.vocabTests).set(updates).where(eq(schema.vocabTests.id, input.id));
      }

      if (input.groupIds !== undefined) {
        await db.delete(schema.vocabTestGroups).where(eq(schema.vocabTestGroups.testId, input.id));
        if (input.groupIds.length > 0) {
          await db.insert(schema.vocabTestGroups).values(
            input.groupIds.map((groupId) => ({ testId: input.id, groupId }))
          );
        }
      }

      return { success: true };
    }),

  deleteTest: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.vocabTests).where(eq(schema.vocabTests.id, input.id));
      return { success: true };
    }),

  /**
   * Every stored attempt, newest first, in a SUMMARY shape for the teacher's
   * class tables, paired growth, per-student profiles, records table and CSV.
   * No row cap: a year of monthly testing must keep its baseline occasion.
   * To keep the payload proportional to what those views read, v2 census
   * summaries (censo/activo/sondeo) arrive with their per-word `res` array
   * emptied (`[]`) and its length in `censusItems`; the Anuario, the only view
   * that reads the word states, fetches them from getCensusResults.
   */
  getResults: adminProcedure
    .input(resultsFilterSchema)
    .query(async ({ input }) => {
      const conditions = await resultsFilterConditions(input);
      if (!conditions) return [];

      const summary = schema.vocabResults.summaryJson;
      const rows = await db.select({
        id: schema.vocabResults.id,
        testId: schema.vocabResults.testId,
        testName: schema.vocabTests.name,
        userId: schema.vocabResults.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        mode: schema.vocabResults.mode,
        seed: schema.vocabResults.seed,
        blk: schema.vocabResults.blk,
        form: schema.vocabResults.form,
        occasion: schema.vocabResults.occasion,
        // `res` is emptied, never removed: a teacher tab still running the
        // previous client builds its Anuario from these rows and iterates it.
        summaryJson: sql<string>`CASE WHEN ${isV2SummarySql} THEN json_set(${summary}, '$.res', json('[]')) ELSE ${summary} END`,
        censusItems: sql<number | null>`CASE WHEN ${isV2SummarySql} THEN json_array_length(${summary}, '$.res') END`,
        qualityJson: schema.vocabResults.qualityJson,
        completedAt: schema.vocabResults.completedAt,
        durationMs: schema.vocabResults.durationMs,
      })
        .from(schema.vocabResults)
        .innerJoin(schema.vocabTests, eq(schema.vocabResults.testId, schema.vocabTests.id))
        .innerJoin(schema.users, eq(schema.vocabResults.userId, schema.users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.vocabResults.completedAt), desc(schema.vocabResults.id));
      return rows;
    }),

  /**
   * The v2 census attempts (censo/activo/sondeo) with their full per-word
   * states, uncapped, for the Anuario ledger. Same filter as getResults.
   */
  getCensusResults: adminProcedure
    .input(resultsFilterSchema)
    .query(async ({ input }) => {
      const conditions = await resultsFilterConditions(input);
      if (!conditions) return [];
      conditions.push(isV2SummarySql);

      return db.select({
        id: schema.vocabResults.id,
        userId: schema.vocabResults.userId,
        userName: schema.users.name,
        mode: schema.vocabResults.mode,
        blk: schema.vocabResults.blk,
        form: schema.vocabResults.form,
        occasion: schema.vocabResults.occasion,
        summaryJson: schema.vocabResults.summaryJson,
        qualityJson: schema.vocabResults.qualityJson,
        completedAt: schema.vocabResults.completedAt,
      })
        .from(schema.vocabResults)
        .innerJoin(schema.users, eq(schema.vocabResults.userId, schema.users.id))
        .where(and(...conditions))
        .orderBy(desc(schema.vocabResults.completedAt), desc(schema.vocabResults.id));
    }),

  /**
   * Per-word response aggregates over stored attempts, for empirical item
   * analysis (difficulty vs. frequency rank, per-pseudoword false-alarm
   * outliers). The client classifies words into bands/pseudowords — the
   * server only aggregates counts.
   *
   * Validity constraints: Sí/No stats are drawn from SIZE attempts only
   * (listen latencies include audio playback and measure a different
   * construct), and each (student, word) contributes a single observation —
   * the latest — so repeat test-takers cannot dominate item difficulty or
   * pseudo false-alarm rates.
   */
  getItemStats: adminProcedure
    .input(z.object({ testId: z.number().int().optional() }))
    .query(async ({ input }) => {
      // Parsing every stored response set is bounded: the newest
      // ITEM_STATS_MAX_ATTEMPTS attempts that carry responses. One extra row is
      // read so the client can say, visibly, when older attempts were left out.
      const fetched = await db.select({
        userId: schema.vocabResults.userId,
        mode: schema.vocabResults.mode,
        responsesJson: schema.vocabResults.responsesJson,
      })
        .from(schema.vocabResults)
        .where(and(
          isNotNull(schema.vocabResults.responsesJson),
          input.testId !== undefined ? eq(schema.vocabResults.testId, input.testId) : undefined,
        ))
        .orderBy(desc(schema.vocabResults.completedAt), desc(schema.vocabResults.id))
        .limit(ITEM_STATS_MAX_ATTEMPTS + 1);
      const truncated = fetched.length > ITEM_STATS_MAX_ATTEMPTS;
      const rows = truncated ? fetched.slice(0, ITEM_STATS_MAX_ATTEMPTS) : fetched;

      const agg = new Map<string, VocabItemAgg>();
      const seenYn = new Set<string>();
      const seenMc = new Set<string>();
      let attempts = 0;
      for (const row of rows) {
        if (!row.responsesJson) continue;
        let items: Record<string, unknown>[];
        try {
          const parsed = JSON.parse(row.responsesJson);
          if (!Array.isArray(parsed)) continue;
          items = parsed as Record<string, unknown>[];
        } catch {
          continue;
        }
        attempts++;
        for (const item of items) {
          if (typeof item.w !== 'string') continue;
          let rec = agg.get(item.w);
          if (!rec) {
            rec = { w: item.w, ynN: 0, ynYes: 0, ynMsSum: 0, ynMsN: 0, mcN: 0, mcOk: 0 };
            agg.set(item.w, rec);
          }
          // rows iterate newest→oldest, so first occurrence per (user, word) is the latest
          if (typeof item.yes === 'boolean' && row.mode === 'size') {
            const key = `${row.userId}|${item.w}`;
            if (seenYn.has(key)) continue;
            seenYn.add(key);
            rec.ynN++;
            if (item.yes) rec.ynYes++;
            if (typeof item.ms === 'number' && item.ms >= 0) {
              rec.ynMsSum += item.ms;
              rec.ynMsN++;
            }
          } else if ((typeof item.correct === 'boolean' || typeof item.ok === 'boolean') && item.t !== 'dict') {
            // dictation (t:'dict') is transcription, not a meaning check — keep it
            // out of the MC accuracy stats
            const key = `${row.userId}|${item.w}`;
            if (seenMc.has(key)) continue;
            seenMc.add(key);
            rec.mcN++;
            if (item.correct === true || item.ok === true) rec.mcOk++;
          }
        }
      }
      return { attempts, items: [...agg.values()], truncated, maxAttempts: ITEM_STATS_MAX_ATTEMPTS };
    }),

  getResultDetail: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const result = await db.query.vocabResults.findFirst({
        where: eq(schema.vocabResults.id, input.id),
      });
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Result not found',
          cause: { appCode: 'VOCAB_RESULT_NOT_FOUND' },
        });
      }
      return result;
    }),

  deleteResult: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.vocabResults).where(eq(schema.vocabResults.id, input.id));
      return { success: true };
    }),
});
