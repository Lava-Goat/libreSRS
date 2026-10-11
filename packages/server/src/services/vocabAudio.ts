// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// TTS audio bank for the Vocabulómetro aural modes. Generates one opus clip
// per (word, accent, voice) through the same provider/asset pipeline the
// flashcard pronunciation feature uses, in a single background batch with
// progress. The same bank holds the elicited-imitation sentence clips.
//
// Voice rule: under ElevenLabs every clip records the voice that spoke it, and
// reads serve only clips from the voice currently responsible for the accent
// (the default accent '' → the Vocabulómetro voice, else the accent map). The
// clips from before the voice column (voice_id NULL) are never served under ElevenLabs. Rows and
// files are never deleted here: vocab_audio and ai_assets share the assets
// directory, and a switched-back voice finds its clips again.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAiRuntimeConfig, type AiRuntimeConfig } from './ai/config.js';
import { createAiProvider } from './ai/providerFactory.js';
import { writeAudioAsset } from './ai/assetStorage.js';
import { normalizeForSpeech, sentenceForSpeech } from './ai/speechText.js';
import { logger } from '../logger.js';
import { assertProviderHasQuota } from './ai/quotaBreaker.js';

export type ClipKind = 'word' | 'sentence';

export interface VocabAudioProgress {
  status: 'idle' | 'generating' | 'done' | 'failed';
  kind: ClipKind;
  accent: string;
  processed: number;
  total: number;
  failed: number;
  startedAt: number | null;
  lastError: string | null;
}

let progress: VocabAudioProgress = {
  status: 'idle', kind: 'word', accent: '', processed: 0, total: 0, failed: 0, startedAt: null, lastError: null,
};

// Synchronous single-flight lock: taken before the first await so two
// near-simultaneous calls cannot both pass the guard (check-then-act TOCTOU).
let batchLock = false;

/** Per-clip TTS timeout — a hung provider request must not pin the batch. */
const TTS_TIMEOUT_MS = 60_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function getVocabAudioProgress(): VocabAudioProgress {
  return { ...progress };
}

/** Delay between TTS calls, to stay clear of provider rate limits. */
const GENERATION_SPACING_MS = 150;

/** Sentinel accent meaning "assign a real Spanish accent per clip". It is a
 *  UI/selection value only and MUST NEVER be sent to the TTS provider. */
export const RANDOM_ACCENT = 'random';

/** Concrete Spanish accents used when randomizing. Mirrors the non-empty
 *  entries of SPANISH_ACCENTS in the client's VocabManager. */
export const REAL_SPANISH_ACCENTS = [
  'Mexican', 'Castilian', 'Argentine', 'Colombian', 'Chilean', 'Cuban', 'Puerto Rican',
];

/**
 * Resolve the concrete accent a single clip should be generated in.
 *
 * - Fixed accent: return it unchanged.
 * - Randomize: assign a REAL Spanish accent (never the literal 'random', which
 *   would make the TTS model try to "speak in a random accent"). If the word
 *   already has a clip, reuse that clip's accent so we update in place instead
 *   of creating a duplicate row; otherwise pick a random Spanish accent.
 */
export function chooseClipAccent(opts: {
  randomize: boolean;
  fixedAccent: string;
  existingAccents: string[];
  /** Accents eligible for the random pick (e.g. only voice-mapped accents when
   *  ElevenLabs serves TTS). Defaults to all real Spanish accents. */
  pool?: string[];
}): string {
  if (!opts.randomize) return opts.fixedAccent;
  const pool = opts.pool ?? REAL_SPANISH_ACCENTS;
  if (pool.length === 0) return '';
  // Reuse the word's existing accent only if it is still eligible — otherwise a
  // regeneration could request an accent the TTS provider cannot honor.
  const reuse = opts.existingAccents.find((a) => a && a !== RANDOM_ACCENT && pool.includes(a));
  if (reuse) return reuse;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- voice routing ----------

export interface VocabVoiceRouting {
  /** ElevenLabs serves TTS: clips are chosen by the voice that spoke them. */
  elevenLabs: boolean;
  /**
   * The voice_id an accent's clips must carry to be served: a voice id under
   * ElevenLabs, null under OpenAI (its clips carry none), undefined when the
   * accent has no voice at all (nothing is servable or generatable).
   */
  voiceFor(accent: string): string | null | undefined;
  /** Accents the random mix draws from; null = any accent (OpenAI behaviour). */
  randomPool: string[] | null;
}

type RoutingConfig = Partial<Pick<AiRuntimeConfig, 'ttsProvider' | 'ttsVoiceMap' | 'vocabTtsVoiceId'>>;

export function vocabVoiceRouting(config: RoutingConfig): VocabVoiceRouting {
  if (config.ttsProvider !== 'elevenlabs') {
    return { elevenLabs: false, voiceFor: () => null, randomPool: null };
  }
  const map = config.ttsVoiceMap ?? {};
  // Object.hasOwn: an accent like "constructor" must never resolve a prototype member.
  const mapped = (accent: string) => (Object.hasOwn(map, accent) && map[accent] ? map[accent] : undefined);
  const voiceFor = (accent: string) => (accent === '' ? (config.vocabTtsVoiceId || mapped('')) : mapped(accent));
  const voiced = REAL_SPANISH_ACCENTS.filter((a) => voiceFor(a));
  // With no mapped accents the mix degrades to the default voice, labeled ''
  // (the same fallback generation uses), so every stored label stays honest.
  const randomPool = voiced.length > 0 ? voiced : (voiceFor('') ? [''] : []);
  return { elevenLabs: true, voiceFor, randomPool };
}

export async function getVocabVoiceRouting(): Promise<VocabVoiceRouting> {
  return vocabVoiceRouting(await getAiRuntimeConfig());
}

/** Whether a stored clip was spoken by the voice now responsible for its accent. */
export function isCurrentVoiceClip(routing: VocabVoiceRouting, row: { accent: string; voiceId: string | null }): boolean {
  const required = routing.voiceFor(row.accent);
  return required !== undefined && (row.voiceId ?? null) === required;
}

export interface ServableClip { word: string; accent: string; url: string | null }

/**
 * Ready clips the current voice routing may serve. `accent` RANDOM_ACCENT
 * returns clips across the random pool (callers pick one per word).
 */
export async function findServableClips(opts: {
  kind: ClipKind;
  accent: string;
  words?: string[];
  routing?: VocabVoiceRouting;
}): Promise<ServableClip[]> {
  const routing = opts.routing ?? await getVocabVoiceRouting();
  if (opts.words && opts.words.length === 0) return [];
  const base = [
    eq(schema.vocabAudio.kind, opts.kind),
    eq(schema.vocabAudio.status, 'ready'),
    ...(opts.words ? [inArray(schema.vocabAudio.word, opts.words)] : []),
  ];
  const columns = {
    word: schema.vocabAudio.word,
    accent: schema.vocabAudio.accent,
    url: schema.vocabAudio.url,
    voiceId: schema.vocabAudio.voiceId,
  };

  if (opts.accent === RANDOM_ACCENT) {
    const rows = await db.select(columns).from(schema.vocabAudio).where(and(...base));
    const pool = routing.randomPool;
    return rows.filter((r) => (pool === null || pool.includes(r.accent)) && isCurrentVoiceClip(routing, r));
  }

  const voice = routing.voiceFor(opts.accent);
  if (voice === undefined) return [];
  return db.select(columns).from(schema.vocabAudio).where(and(
    ...base,
    eq(schema.vocabAudio.accent, opts.accent),
    voice === null ? isNull(schema.vocabAudio.voiceId) : eq(schema.vocabAudio.voiceId, voice),
  ));
}

// ---------- generation ----------

export interface VocabAudioGenOptions {
  /** Subset of `words` that are pseudowords — forces strict Spanish phonetics. */
  pseudoWords?: string[];
  /** Regenerate even words that already have a ready clip (overwrite). */
  force?: boolean;
}

/**
 * Queue generation for every word in `words` that does not already have a
 * ready clip for `accent` in the accent's current voice (or ALL of them when
 * `force`). Runs in the background; only one batch at a time. Returns the
 * number of words queued.
 */
export async function startVocabAudioGeneration(
  words: string[],
  accent: string,
  opts: VocabAudioGenOptions = {}
): Promise<{ queued: number }> {
  return startBatch('word', words, accent, opts);
}

/**
 * Elicited-imitation sentence clips: spoken by the Vocabulómetro voice (the
 * default accent), keyed by the sentence text.
 */
export async function startVocabSentenceAudioGeneration(
  sentences: string[],
  opts: { force?: boolean } = {}
): Promise<{ queued: number }> {
  return startBatch('sentence', sentences, '', { force: opts.force });
}

async function startBatch(kind: ClipKind, words: string[], accent: string, opts: VocabAudioGenOptions): Promise<{ queued: number }> {
  if (batchLock || progress.status === 'generating') {
    throw new Error('An audio bank generation batch is already running');
  }
  batchLock = true;
  try {
    return await startLocked(kind, words, accent, opts);
  } catch (error) {
    batchLock = false;
    throw error;
  }
}

interface ClipJob { word: string; accent: string; voiceId: string | null; rowId: number }

async function startLocked(kind: ClipKind, words: string[], accent: string, opts: VocabAudioGenOptions): Promise<{ queued: number }> {
  const aiConfig = await getAiRuntimeConfig();
  if (!aiConfig.pronunciationEnabled) {
    throw new Error('Pronunciation generation is not enabled');
  }
  const provider = await createAiProvider(aiConfig);
  if (!provider) {
    throw new Error('AI provider is not configured');
  }
  assertProviderHasQuota(provider.speechProviderName ?? provider.name);

  const unique = [...new Set(words.map((w) => w.trim()).filter(Boolean))];
  const randomize = kind === 'word' && accent === RANDOM_ACCENT;
  const routing = vocabVoiceRouting(aiConfig);

  // ElevenLabs preflight: fail the whole batch up front with a clear message
  // instead of queueing thousands of clips that each fail on a missing voice.
  let accentPool: string[] | undefined;
  if (routing.elevenLabs) {
    if (!aiConfig.elevenlabsApiKey) {
      throw new Error('ElevenLabs is selected as the TTS provider but no ElevenLabs API key is saved');
    }
    if (randomize) {
      accentPool = routing.randomPool ?? [];
      if (accentPool.length === 0) {
        throw new Error('No ElevenLabs voices configured — assign voices in Admin → AI before generating');
      }
    } else if (routing.voiceFor(accent) === undefined) {
      throw new Error(accent
        ? `No ElevenLabs voice mapped for accent "${accent}" — assign one in Admin → AI or pick a mapped accent`
        : 'No Vocabulómetro voice or default ElevenLabs voice configured — pick a voice in the Vocabulómetro audio bank or Admin → AI');
    }
  }

  // Every clip these words already have, in any accent or voice: only the
  // current voice's clips count as done, but reusing their rows keeps one row
  // per (kind, word, accent, voice).
  const existing = unique.length > 0
    ? await db.select({
        id: schema.vocabAudio.id,
        word: schema.vocabAudio.word,
        accent: schema.vocabAudio.accent,
        voiceId: schema.vocabAudio.voiceId,
        status: schema.vocabAudio.status,
      })
      .from(schema.vocabAudio)
      .where(and(eq(schema.vocabAudio.kind, kind), inArray(schema.vocabAudio.word, unique)))
    : [];
  const byWord = new Map<string, typeof existing>();
  for (const row of existing) {
    const list = byWord.get(row.word) ?? [];
    list.push(row);
    byWord.set(row.word, list);
  }

  const pseudoSet = new Set((opts.pseudoWords ?? []).map((w) => w.trim()));
  const plans: { word: string; accent: string; voiceId: string | null; rowId: number | null }[] = [];
  for (const word of unique) {
    const rows = byWord.get(word) ?? [];
    // A legacy (OpenAI) or other-voice clip does not satisfy the word.
    const current = rows.filter((r) => isCurrentVoiceClip(routing, r)
      && (!randomize || !accentPool || accentPool.includes(r.accent)));
    const chosen = chooseClipAccent({
      randomize,
      fixedAccent: accent,
      existingAccents: current.map((r) => r.accent),
      pool: accentPool,
    });
    const isReady = randomize
      ? current.some((r) => r.status === 'ready')
      : current.some((r) => r.accent === accent && r.status === 'ready');
    if (isReady && !opts.force) continue;
    const voiceId = routing.voiceFor(chosen) ?? null;
    const row = rows.find((r) => r.accent === chosen && (r.voiceId ?? null) === voiceId);
    plans.push({ word, accent: chosen, voiceId, rowId: row?.id ?? null });
  }

  if (plans.length === 0) {
    batchLock = false;
    return { queued: 0 };
  }

  const jobs: ClipJob[] = [];
  const fresh = plans.filter((p) => p.rowId === null);
  // Chunked: a full 6,000-word bank at six bound values per row would pass
  // SQLite's 32,766-variable limit in one statement.
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    const inserted = await db.insert(schema.vocabAudio).values(
      chunk.map((p) => ({ word: p.word, accent: p.accent, voiceId: p.voiceId, kind, status: 'pending' as const }))
    ).returning({ id: schema.vocabAudio.id, word: schema.vocabAudio.word });
    const idByWord = new Map(inserted.map((r) => [r.word, r.id]));
    for (const p of chunk) jobs.push({ word: p.word, accent: p.accent, voiceId: p.voiceId, rowId: idByWord.get(p.word)! });
  }
  // failed/pending leftovers (or force-regenerated clips) are retried in place.
  const retry = plans.filter((p) => p.rowId !== null);
  if (retry.length > 0) {
    await db.update(schema.vocabAudio)
      .set({ status: 'pending', errorMessage: null })
      .where(inArray(schema.vocabAudio.id, retry.map((p) => p.rowId!)));
    for (const p of retry) jobs.push({ word: p.word, accent: p.accent, voiceId: p.voiceId, rowId: p.rowId! });
  }

  progress = {
    status: 'generating', kind, accent, processed: 0, total: jobs.length, failed: 0,
    startedAt: Date.now(), lastError: null,
  };

  void (async () => {
    for (const job of jobs) {
      const rowWhere = eq(schema.vocabAudio.id, job.rowId);
      try {
        await db.update(schema.vocabAudio).set({ status: 'generating' }).where(rowWhere);
        const speech = await withTimeout(
          // The row key stays the raw text; a word is spoken the way the
          // flashcard path speaks it, a sentence exactly as EI scores it.
          provider.generateSpeech(kind === 'sentence' ? sentenceForSpeech(job.word) : normalizeForSpeech(job.word), {
            accent: job.accent || undefined,
            language: 'Spanish',
            pseudoword: pseudoSet.has(job.word),
            // Accent-labeled measurement clips must never silently use the
            // wrong voice (ElevenLabs falls back to the default voice otherwise).
            strictAccent: routing.elevenLabs,
            // The voice recorded on the row is the voice that speaks.
            elevenLabsVoiceId: job.voiceId ?? undefined,
            textKind: kind,
          }),
          TTS_TIMEOUT_MS,
          `TTS for "${job.word.slice(0, 60)}"`
        );
        const url = await writeAudioAsset(speech.audioBuffer, 'opus');
        await db.update(schema.vocabAudio)
          .set({ status: 'ready', url, errorMessage: null })
          .where(rowWhere);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.failed++;
        progress.lastError = message;
        logger.warn({ event: 'vocab_audio.generation_failed', kind, word: job.word, accent: job.accent, err: error }, 'Vocab audio generation failed');
        await db.update(schema.vocabAudio)
          .set({ status: 'failed', errorMessage: message.slice(0, 500) })
          .where(rowWhere)
          .catch(() => undefined);
      }
      progress.processed++;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, GENERATION_SPACING_MS));
    }
    progress.status = progress.failed === progress.total ? 'failed' : 'done';
    batchLock = false;
    logger.info({
      event: 'vocab_audio.batch_complete',
      kind,
      accent,
      total: progress.total,
      failed: progress.failed,
    }, 'Vocab audio batch complete');
  })();

  return { queued: jobs.length };
}
