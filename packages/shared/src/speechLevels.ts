// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How long a speaking take has a voice in it, from the levels the page's
 * microphone meter read while recording (v1.16.0).
 *
 * The rule is relative to the take's own room: a moment counts as voice when
 * it is at least 10 dB over the take's quiet level (the level 10% of its time
 * is at or under), and never under −60 dBFS. The fixed −45 dBFS gate before
 * it failed both ways on a raw microphone: class chatter at −42 counted as
 * speech, and a soft voice in a quiet room did not.
 *
 * It cannot tell a soft voice in a noisy room from silence in one, least of
 * all on a short take, so a take it finds quiet only gets a nudge for the
 * student and an amber chip for the teacher, never a refusal.
 */

/** One reading of the microphone while recording: its level in dBFS, and the time in ms it stands for. */
export interface LevelSample {
  db: number;
  ms: number;
}

export interface SpeechLevelOptions {
  /** How far over the quiet level a moment must be to count as voice. */
  marginDb: number;
  /** Nothing quieter counts, however quiet the room: a digital-silence take has no floor to speak of. */
  minDb: number;
  /** The quiet level: this share of the take's time is at or under it (0.1: its 10th percentile, by time). */
  floorPct: number;
}

export const SPEECH_LEVEL_DEFAULTS: Readonly<SpeechLevelOptions> = { marginDb: 10, minDb: -60, floorPct: 0.1 };

/**
 * A reading stands for the time since the one before it, up to this. The page
 * reads every 50 ms, but a hidden tab or a covered window is throttled to
 * about once a second; counting each reading as 50 ms (or 200, before v1.16.0)
 * undercounted the voice there up to five times.
 */
export const MAX_LEVEL_SAMPLE_MS = 1100;

/** Readings that count: a real level (−Infinity is digital silence) over some time. */
const usable = (s: LevelSample) => !Number.isNaN(s.db) && Number.isFinite(s.ms) && s.ms > 0;

/**
 * The level at or under which `pct` (0–1) of the readings' time lies: a
 * percentile weighted by time, so a throttled second weighs twenty 50 ms
 * readings. Null when there is no time to go by.
 */
export function levelFloorDb(samples: readonly LevelSample[], pct: number): number | null {
  const sorted = samples.filter(usable).sort((a, b) => a.db - b.db);
  const total = sorted.reduce((sum, s) => sum + s.ms, 0);
  if (total <= 0) return null;
  const target = Math.min(1, Math.max(0, pct)) * total;
  let seen = 0;
  for (const s of sorted) {
    seen += s.ms;
    if (seen >= target) return s.db;
  }
  return sorted[sorted.length - 1].db;
}

/** The level a moment must pass to count as voice over this quiet level: floor + margin, never under minDb. */
export function speechGateDb(floorDb: number | null, options: Readonly<SpeechLevelOptions> = SPEECH_LEVEL_DEFAULTS): number {
  return floorDb === null ? options.minDb : Math.max(options.minDb, floorDb + options.marginDb);
}

/** The time, in whole ms, the readings were over the take's own voice gate. */
export function voicedMsFromLevels(samples: readonly LevelSample[], options: Readonly<SpeechLevelOptions> = SPEECH_LEVEL_DEFAULTS): number {
  const gate = speechGateDb(levelFloorDb(samples, options.floorPct), options);
  let voiced = 0;
  for (const s of samples) if (usable(s) && s.db > gate) voiced += s.ms;
  return Math.round(voiced);
}

/** A take with less voice than this is "little speech" whatever its length. */
export const LITTLE_SPEECH_MS = 5000;

/**
 * Too little voice for the take's length: under 5 s, or under a third of a
 * take shorter than 15 s. The page nudges the student (Record it again first,
 * Turn it in anyway second) and the server flags it 'little-speech'.
 */
export function isLittleSpeech(voicedMs: number, durationMs: number): boolean {
  return voicedMs < Math.min(LITTLE_SPEECH_MS, durationMs / 3);
}
