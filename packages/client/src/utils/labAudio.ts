// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Browser-side audio work for listening labs: scanning an uploaded lab for its
 * answer pauses and its last spoken moment, and tracking how much of it a
 * student heard.
 */
import {
  MAX_PAUSE_LENGTH_MS,
  PAUSE_SCAN_LIMITS,
  type LabPause,
  type LabPauseScan,
} from '@libresrs/shared';

/** 754321 -> "12:34". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "12:34" or "754" -> 754000; null if unreadable. */
export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(\d+):([0-5]\d)$/.exec(trimmed) ?? /^()(\d+)$/.exec(trimmed);
  if (!match) return null;
  return ((Number(match[1] || 0) * 60) + Number(match[2])) * 1000;
}

/** "Lab_week01.mp3" -> "Lab week01". */
export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

/** Types the server stores (services/labMedia.ts); anything else is refused before scanning. */
const SERVER_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/webm',
]);

/**
 * A type the server will accept for this file, or null. Some systems hand
 * over files with no type or an unusual one; the extension decides then.
 */
export function audioMimeTypeFor(file: { name: string; type: string }): string | null {
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (SERVER_TYPES.has(type)) return type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Last speech
// ---------------------------------------------------------------------------

const SPEECH_WINDOW_MS = 50;
/** A window this far below the loudest one counts as silence. */
const SPEECH_RELATIVE_DB = -35;
/** ...and never anything quieter than this, whatever the file's peak. */
const SPEECH_FLOOR_DB = -60;
/** Slack after the last loud window, so the final syllable's tail is included. */
const SPEECH_TAIL_MS = 300;

const toDb = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -Infinity);

/**
 * Where the last speech ends, in ms. The course labs are synthesized speech
 * with silent pauses and no music bed, so "last window near the file's own
 * loudness" is a reliable end marker; the teacher can adjust it at upload.
 */
export function findLastSpeechMs(samples: Float32Array, sampleRate: number): number {
  const windowSize = Math.max(1, Math.round((sampleRate * SPEECH_WINDOW_MS) / 1000));
  const windows = Math.ceil(samples.length / windowSize);
  const levels = new Float64Array(windows);
  let peak = -Infinity;
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const start = w * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    const db = toDb(Math.sqrt(sum / Math.max(1, end - start)));
    levels[w] = db;
    if (db > peak) peak = db;
  }
  if (!Number.isFinite(peak)) return 0;

  const threshold = Math.max(peak + SPEECH_RELATIVE_DB, SPEECH_FLOOR_DB);
  const durationMs = (samples.length / sampleRate) * 1000;
  for (let w = windows - 1; w >= 0; w--) {
    if (levels[w] >= threshold) {
      const endMs = (Math.min(samples.length, (w + 1) * windowSize) / sampleRate) * 1000;
      return Math.round(Math.min(durationMs, endMs + SPEECH_TAIL_MS));
    }
  }
  return 0;
}

/** Average of all channels, so a stereo lab is judged by what reaches both ears. */
function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Answer pauses
// ---------------------------------------------------------------------------

/** Answer pauses are found on 10 ms windows. */
export const PAUSE_WINDOW_MS = 10;
/** The pause threshold stays at least this far above the file's own noise floor. */
export const PAUSE_NOISE_MARGIN_DB = 10;
/**
 * A burst of sound this short (a click) does not end a silence. Without this
 * bridging, pink noise under a lab splits its real pauses.
 */
export const MAX_BLIP_MS = 30;
/**
 * Silences at least this long are answer pauses; on a set of sample labs the
 * safe band is 3.07–3.54 s.
 */
export const DEFAULT_MIN_PAUSE_MS = 3300;
/** A silence this close to the cut-off (either side) is a close call: "Check the count". */
export const CLOSE_CALL_MS = 150;
/** The level of a window of digital silence (the log of zero). */
const SILENT_DB = -200;
/** The noise floor is this percentile of the window levels. */
const NOISE_PERCENTILE = 0.1;

/** Mean-square level in dB (the same number as 20·log10 of the RMS); digital silence reads −200. */
const meanSquareDb = (meanSquare: number) => (meanSquare > 0 ? 10 * Math.log10(meanSquare) : SILENT_DB);

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

export interface AnswerPauseOptions {
  /** The cut-off: silences at least this long are answer pauses (default 3.3 s). */
  minPauseMs?: number;
  /** A burst of sound up to this long does not end a silence (default 30 ms). */
  maxBlipMs?: number;
}

export interface AnswerPauses {
  /** The answer pauses, `[startMs, endMs]`, sorted: what `labs.create` and `labs.setPauses` take. */
  pauses: LabPause[];
  /** What the scan measured, within the bounds the server accepts. */
  scan: LabPauseScan;
}

/**
 * The answer pauses in a lab's 10 ms window levels (dB): the core of
 * `findAnswerPauses`, separate so it can be checked against measured levels.
 *
 * 1. The threshold is the loudest of: the peak (on 50 ms windows) − 35 dB, the
 *    noise floor (10th-percentile window) + 10 dB, and −60 dBFS. Never a fixed
 *    level: on a quiet lab that would eat the margin between pause and speech.
 * 2. Quiet runs are windows below it; a burst of 30 ms or less does not end one.
 * 3. Silences touching the start or end of the file are lead-in and run-out.
 * 4. Silences of 3.3 s up to a minute are answer pauses. A longer one is not
 *    (nobody answers for a minute) and is reported as left out, so the
 *    teacher is told to check the count.
 */
export function findAnswerPausesInLevels(
  levels: ArrayLike<number>,
  windowMs: number,
  durationMs: number,
  opts: AnswerPauseOptions = {},
): AnswerPauses {
  const minPauseMs = Math.round(clamp(opts.minPauseMs ?? DEFAULT_MIN_PAUSE_MS, PAUSE_SCAN_LIMITS.minPauseMs));
  const count = levels.length;

  // Peak on 50 ms windows, as findLastSpeechMs measures it.
  const per50 = Math.max(1, Math.round(SPEECH_WINDOW_MS / windowMs));
  let peak = -Infinity;
  for (let w = 0; w + per50 <= count; w += per50) {
    let power = 0;
    for (let k = 0; k < per50; k++) power += 10 ** (levels[w + k] / 10);
    peak = Math.max(peak, meanSquareDb(power / per50));
  }

  const sorted = Float64Array.from(levels).sort();
  const noiseDb = count > 0 ? sorted[Math.floor(count * NOISE_PERCENTILE)] : SILENT_DB;
  const scanOf = (thresholdDb: number, kept: number[], leftOut: number[]): LabPauseScan => {
    // Loops, not Math.min(...list): a long file can have thousands of short silences.
    let shortestKept = Infinity;
    let longestLeftOut = -Infinity;
    let closeCalls = 0;
    for (const length of kept) shortestKept = Math.min(shortestKept, length);
    for (const length of leftOut) longestLeftOut = Math.max(longestLeftOut, length);
    for (const length of [kept, leftOut].flat()) if (Math.abs(length - minPauseMs) <= CLOSE_CALL_MS) closeCalls += 1;
    return {
      minPauseMs,
      thresholdDb: oneDecimal(clamp(thresholdDb, PAUSE_SCAN_LIMITS.thresholdDb)),
      noiseDb: oneDecimal(clamp(noiseDb, PAUSE_SCAN_LIMITS.noiseDb)),
      shortestKeptMs: kept.length > 0 ? Math.round(clamp(shortestKept, PAUSE_SCAN_LIMITS.shortestKeptMs)) : null,
      longestLeftOutMs: leftOut.length > 0 ? Math.round(clamp(longestLeftOut, PAUSE_SCAN_LIMITS.longestLeftOutMs)) : null,
      closeCalls: clamp(closeCalls, PAUSE_SCAN_LIMITS.closeCalls),
    };
  };
  // Empty, or digital silence throughout: nothing to find.
  if (!(peak > SILENT_DB)) return { pauses: [], scan: scanOf(SPEECH_FLOOR_DB, [], []) };

  const thresholdDb = Math.max(peak + SPEECH_RELATIVE_DB, noiseDb + PAUSE_NOISE_MARGIN_DB, SPEECH_FLOOR_DB);
  const blip = Math.max(0, Math.round((opts.maxBlipMs ?? MAX_BLIP_MS) / windowMs));

  // Runs of quiet windows. A run still open at the end of the file (after at
  // most a blip) is the run-out; one that starts within a blip of the start is
  // the lead-in.
  const inner: [number, number][] = [];
  let start = -1;
  let lastQuiet = -1;
  let loudRun = 0;
  for (let w = 0; w <= count; w++) {
    const quiet = w < count && levels[w] < thresholdDb;
    if (quiet) {
      if (start < 0) start = w;
      lastQuiet = w;
      loudRun = 0;
      continue;
    }
    if (start < 0) continue;
    loudRun += 1;
    if (loudRun <= blip && w < count) continue;
    const s = start * windowMs;
    const e = Math.min(durationMs, (lastQuiet + 1) * windowMs);
    const touchesStart = start <= blip || s <= 0;
    const touchesEnd = w === count || e >= durationMs - windowMs;
    if (!touchesStart && !touchesEnd) inner.push([s, e]);
    start = -1;
    loudRun = 0;
  }

  const pauses: LabPause[] = [];
  const kept: number[] = [];
  const leftOut: number[] = [];
  for (const [s, e] of inner) {
    const length = e - s;
    if (length >= minPauseMs && length <= MAX_PAUSE_LENGTH_MS) {
      pauses.push([Math.round(s), Math.round(e)]);
      kept.push(length);
    } else {
      leftOut.push(length);
    }
  }
  return { pauses, scan: scanOf(thresholdDb, kept, leftOut) };
}

/**
 * The answer pauses of a pause-and-respond lab: the silences where the
 * student answers aloud, from the decoded samples (16 kHz mono in practice).
 * See `findAnswerPausesInLevels` for the rules.
 */
export function findAnswerPauses(samples: Float32Array, sampleRate: number, opts: AnswerPauseOptions = {}): AnswerPauses {
  const size = Math.max(1, Math.round((sampleRate * PAUSE_WINDOW_MS) / 1000));
  const windows = Math.ceil(samples.length / size);
  const levels = new Float64Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const start = w * size;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    levels[w] = meanSquareDb(sum / Math.max(1, end - start));
  }
  return findAnswerPausesInLevels(levels, (size / sampleRate) * 1000, (samples.length / sampleRate) * 1000, opts);
}

// ---------------------------------------------------------------------------
// Scanning a lab file
// ---------------------------------------------------------------------------

export interface LabFileScan extends AnswerPauses {
  durationMs: number;
  lastSpeechMs: number;
}

/**
 * Decodes a lab file and measures it: its length, where the last speech ends
 * and its answer pauses. Decoding at 16 kHz keeps a fifteen-minute lab to
 * ~60MB of samples instead of ~300MB at 48 kHz stereo.
 */
export async function scanLabFile(file: Blob): Promise<LabFileScan> {
  const bytes = await file.arrayBuffer();
  let context: OfflineAudioContext;
  try {
    context = new OfflineAudioContext(1, 1, 16000);
  } catch {
    context = new OfflineAudioContext(1, 1, 44100);
  }
  const buffer = await context.decodeAudioData(bytes);
  const samples = downmix(buffer);
  const { pauses, scan } = findAnswerPauses(samples, buffer.sampleRate);
  return {
    durationMs: Math.round(buffer.duration * 1000),
    lastSpeechMs: findLastSpeechMs(samples, buffer.sampleRate),
    pauses,
    scan,
  };
}

/**
 * Scans a lab already uploaded ("Find pauses"). The file is fetched from this
 * site (`/api/assets/...`, allowed by the CSP's connect-src 'self'); nothing
 * from elsewhere is fetched.
 */
export async function scanLabUrl(url: string): Promise<LabFileScan> {
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Only this site\'s lab files can be scanned');
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`The lab audio could not be fetched (${response.status})`);
  return scanLabFile(await response.blob());
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Stretches of the lab the student actually played, in ms. */
export class ListeningCoverage {
  private spans: [number, number][] = [];

  add(fromMs: number, toMs: number): void {
    if (!(toMs > fromMs) || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return;
    const merged: [number, number][] = [];
    let [start, end] = [fromMs, toMs];
    for (const [s, e] of this.spans) {
      if (e < start || s > end) merged.push([s, e]);
      else { start = Math.min(start, s); end = Math.max(end, e); }
    }
    merged.push([start, end]);
    this.spans = merged.sort((a, b) => a[0] - b[0]);
  }

  /**
   * How far from the start the student heard without a real gap. Gaps up to
   * `toleranceMs` are bridged: playback events arrive a few times a second,
   * and a pause/resume can leave a sliver between spans.
   */
  heardThroughMs(toleranceMs = 1000): number {
    let reached = 0;
    for (const [s, e] of this.spans) {
      if (s > reached + toleranceMs) break;
      reached = Math.max(reached, e);
    }
    return reached;
  }

  reset(): void {
    this.spans = [];
  }
}
