// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Whether the lab page's microphone hears a voice, frame by frame (v1.16.0).
 *
 * Until v1.15 any frame louder than −45 dBFS counted as the student speaking,
 * so desk taps, a fan, music or the class talking around a silent student
 * answered pauses, while a soft voice in a quiet room did not. This meter
 * counts a sound as a voice only when it stands out from the room and sounds
 * like one:
 *
 * 1. **Level:** the frame's RMS, in dBFS.
 * 2. **Room level (ambient):** the 20th percentile of frame levels over the
 *    last 10 s, or over the last 2.5 s if that is lower (it recovers after the
 *    gain drops, and can only lower the gate). Every frame feeds it, whatever
 *    the lab is doing; until 2 s of frames exist it is the lowest level heard
 *    since the microphone opened (lenient: a stream starts with silence, so
 *    the gate starts at its floor). The student's own voice stays out of the
 *    percentile as long as it fills less than 80% of the window, so a tone
 *    held for about 8 s becomes the room.
 * 3. **Gate:** the room level plus a margin (6 dB unless the teacher changed
 *    it), never under −55 dBFS.
 * 4. **Steady and pitched:** the loudest and quietest of the frame's four
 *    blocks lie within 12 dB (a tap or a knock rises and dies inside one), and
 *    the frame, averaged down to about 12 kHz, has a normalised
 *    autocorrelation of at least 0.5 at a voice pitch (70–400 Hz lags; noise
 *    and whispers have none).
 * 5. **Voice runs:** consecutive frames over the gate, bridging one quieter
 *    frame, form a run. A run counts once it holds 2 steady, pitched frames in
 *    a row; then every over-gate frame in it counts, including an unvoiced
 *    lead-in such as the "s" of "sí".
 *
 * A frame is a span of time, not a number of samples: the most recent 42.7 ms
 * of what the page hands over (2048 samples at 48 kHz), whatever rate the
 * browser runs the audio at. Chrome takes that rate from the output device, so
 * it can be 16 kHz on a Bluetooth headset or 192 kHz on a studio sound card; a
 * fixed 2048 samples made the four steadiness blocks 2.7 ms long at 192 kHz
 * (shorter than one period of a low voice) and 32 ms at 16 kHz (longer than
 * the vowel of "sí"), and honest voices stopped counting. The page's analyser
 * holds two frames (`analyserSize`): when its timer fires late, the frame
 * before the newest stands in for the audio the tick skipped, so a short
 * answer on a busy Chromebook still gets its two steady, pitched frames in a
 * row.
 *
 * Frames are decided 4 frames (200 ms) late, so a run's lead-in can still be
 * counted once the run proves to be a voice; `flush()` decides what is pending
 * (before the page settles its pause tracker, or stops the microphone).
 *
 * Known limits: a whistle, a hum, a ringing bottle or a resonant knock is
 * pitched and sustained, so it counts; so does one nearby talker, since the
 * meter cannot tell whose voice it is. Diffuse room babble, noise and short
 * taps do not.
 *
 * Pure: the page feeds it the analyser's samples every 50 ms, and it touches
 * nothing else. About 0.05 ms per frame at 48 kHz.
 */
import { DEFAULT_GATE_MARGIN_DB } from '@libresrs/shared';

/** The gate never goes under this, however quiet the room (dBFS). */
export const GATE_FLOOR_DB = -55;
/** Steady: the frame's four blocks lie within this many dB of each other. */
export const STEADY_SPREAD_DB = 12;
/** Pitched: the peak normalised autocorrelation over voice-pitch lags reaches this. */
export const PERIODIC_MIN = 0.5;
/** The voice pitches the autocorrelation looks at (Hz). */
export const PITCH_RANGE_HZ = [70, 400] as const;
/** The rate the frame is averaged down to before the autocorrelation (Hz). */
const PITCH_RATE_HZ = 12_000;
/** A frame is this many samples at 48 kHz, and as long (42.7 ms) at any other rate. */
const FRAME_SAMPLES_AT_48K = 2048;
/** How long a frame lasts (ms), whatever the rate. */
export const FRAME_MS = (FRAME_SAMPLES_AT_48K / 48_000) * 1000;
/** What an AnalyserNode's size may be (a power of two in this range). */
const ANALYSER_SIZE_RANGE = [32, 32_768] as const;
/**
 * A tick at least this late (ms since the one before) skipped a frame's worth
 * of audio or more: the meter then judges the frame before the newest too.
 */
export const LATE_TICK_MS = 90;
/** The page's tick, when the caller does not say how long it has been. */
const DEFAULT_TICK_MS = 50;
/** A run counts once it holds this many steady, pitched frames in a row. */
export const CONFIRM_FRAMES = 2;
/** How many frames later a frame is decided: 200 ms at the page's 50 ms tick. */
export const LOOK_AHEAD_FRAMES = 4;
/** One quieter frame between two over the gate keeps the run going. */
const BRIDGE_FRAMES = 1;
/** The room level windows, in frames of 50 ms: 10 s and 2.5 s. */
export const AMBIENT_LONG_FRAMES = 200;
export const AMBIENT_SHORT_FRAMES = 50;
/** The room level is this percentile of the frame levels. */
export const AMBIENT_PERCENTILE = 0.2;
/** Until this many frames (2 s), the room level is the lowest level heard since the microphone opened. */
export const AMBIENT_STARTUP_FRAMES = 40;
/** The room level histograms keep whole dB from here... */
const LEVEL_MIN_DB = -120;
/** ...to here; anything outside reads as the nearest end. */
const LEVEL_MAX_DB = 0;
/** Digital silence reads as this level rather than −Infinity. */
const SILENCE_DB = -180;
/**
 * The old meter's fixed threshold (v1.15 and before): any frame over it was a
 * voice. Kept for the teacher's comparison (how many pauses the old meter
 * would have answered) and for the mic check's level fallback.
 */
export const LEVEL_ONLY_DB = -45;

/** What one frame of samples measures. */
export interface FrameFeatures {
  /** RMS level (dBFS). */
  db: number;
  /** Loudest minus quietest of the frame's four blocks (dB). */
  spreadDb: number;
  /** Peak normalised autocorrelation over voice-pitch lags (0 to 1). */
  periodicity: number;
}

/** A frame the meter has decided, with what the page attached to it when it was pushed. */
export interface MeterFrame<T> {
  /** RMS level (dBFS). */
  db: number;
  /** The room level the frame was judged against (dBFS); null before any frame had been heard. */
  ambientDb: number | null;
  /** The level it had to pass to be a voice (dBFS). */
  gateDb: number;
  /** Over the gate: a sound that stands out from the room, voice or not. */
  loud: boolean;
  /** Counted as voice. */
  voiced: boolean;
  data: T;
}

export interface VoiceMeterOptions {
  /** The AnalyserNode's context rate (Hz). */
  sampleRate: number;
  /** How far over the room level a voice must be (dB; default DEFAULT_GATE_MARGIN_DB). */
  marginDb?: number;
  /** Frames between pushing a frame and deciding it (default LOOK_AHEAD_FRAMES). */
  lookAheadFrames?: number;
}

const levelDb = (sumSquares: number, n: number) => (sumSquares > 0 && n > 0 ? 10 * Math.log10(sumSquares / n) : SILENCE_DB);

/** A frame at this rate, in samples: 42.7 ms of audio (2048 samples at 48 kHz, 683 at 16 kHz, 8192 at 192 kHz). */
export function frameSamples(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return FRAME_SAMPLES_AT_48K;
  return Math.max(4, Math.round((sampleRate * FRAME_SAMPLES_AT_48K) / 48_000));
}

/**
 * The page's AnalyserNode size at this rate: two frames (the newest, and the
 * one before it for a late tick), rounded up to a power of two and kept to
 * what an AnalyserNode allows. 4096 at 44.1 and 48 kHz, 2048 at 16 kHz, 16384
 * at 192 kHz. The page reads all of it: a shorter read would drop the newest
 * samples, not the oldest.
 */
export function analyserSize(sampleRate: number): number {
  const want = 2 * frameSamples(sampleRate);
  let size = ANALYSER_SIZE_RANGE[0];
  while (size < want && size < ANALYSER_SIZE_RANGE[1]) size *= 2;
  return size;
}

/**
 * Measures frames of one sample rate. Each method judges the frame that ends
 * at `end` (by default the end of what it is given): the `frameSamples` before
 * it, or all of them when it is given fewer. Keeps its scratch buffers, so a
 * frame costs no allocation.
 */
export class FrameAnalyser {
  private readonly factor: number;
  private readonly rate: number;
  /** A frame's length at this rate (samples). */
  readonly frame: number;
  private decimated = new Float64Array(0);
  private energy = new Float64Array(0);

  constructor(sampleRate: number) {
    this.factor = Math.max(1, Math.round(sampleRate / PITCH_RATE_HZ));
    this.rate = sampleRate / this.factor;
    this.frame = frameSamples(sampleRate);
  }

  /** Where the frame ending at `end` starts. */
  private startOf(end: number): number {
    return Math.max(0, end - this.frame);
  }

  /** The frame's RMS level (dBFS). */
  level(samples: ArrayLike<number>, end = samples.length): number {
    const start = this.startOf(end);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return levelDb(sum, end - start);
  }

  /** Loudest minus quietest of the frame's four equal blocks (dB): 10.7 ms each at any rate. */
  spread(samples: ArrayLike<number>, end = samples.length): number {
    const start = this.startOf(end);
    const block = Math.floor((end - start) / 4);
    if (block === 0) return 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let b = 0; b < 4; b++) {
      let sum = 0;
      for (let i = start + b * block; i < start + (b + 1) * block; i++) sum += samples[i] * samples[i];
      const db = levelDb(sum, block);
      if (db < lo) lo = db;
      if (db > hi) hi = db;
    }
    return hi - lo;
  }

  /**
   * The peak normalised autocorrelation over 70–400 Hz lags, of the frame
   * averaged down to about 12 kHz (the factor follows the rate, so 44.1 kHz
   * works too). 0 for silence or a constant.
   */
  periodicity(samples: ArrayLike<number>, end = samples.length): number {
    const d = this.factor;
    const m = Math.floor((end - this.startOf(end)) / d);
    const lagMin = Math.max(1, Math.floor(this.rate / PITCH_RANGE_HZ[1]));
    const lagMax = Math.min(m - 1, Math.ceil(this.rate / PITCH_RANGE_HZ[0]));
    if (m < 2 || lagMin > lagMax) return 0;
    if (this.decimated.length < m) {
      this.decimated = new Float64Array(m);
      this.energy = new Float64Array(m + 1);
    }
    const y = this.decimated;
    const cum = this.energy;
    const offset = end - m * d;
    let mean = 0;
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let k = 0; k < d; k++) sum += samples[offset + i * d + k];
      y[i] = sum / d;
      mean += y[i];
    }
    mean /= m;
    cum[0] = 0;
    for (let i = 0; i < m; i++) {
      y[i] -= mean;
      cum[i + 1] = cum[i] + y[i] * y[i];
    }
    let best = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const n = m - lag;
      let c = 0;
      for (let i = 0; i < n; i++) c += y[i] * y[i + lag];
      const den = Math.sqrt(cum[n] * (cum[m] - cum[lag]));
      if (den > 0 && c / den > best) best = c / den;
    }
    return best;
  }

  /** Steady and pitched: what a voice is, over the gate. */
  voiceLike(samples: ArrayLike<number>, end = samples.length): boolean {
    return this.spread(samples, end) <= STEADY_SPREAD_DB && this.periodicity(samples, end) >= PERIODIC_MIN;
  }

  /** All three at once (the meter itself only looks at the last two for frames over the gate). */
  features(samples: ArrayLike<number>, end = samples.length): FrameFeatures {
    return { db: this.level(samples, end), spreadDb: this.spread(samples, end), periodicity: this.periodicity(samples, end) };
  }
}

/**
 * The p-th percentile of the last `size` levels, in whole dB, from a
 * histogram kept alongside a ring buffer: adding a level is O(1), reading the
 * percentile at most one pass over 121 bins.
 */
class LevelWindow {
  private readonly ring: Uint8Array;
  private readonly bins = new Int32Array(LEVEL_MAX_DB - LEVEL_MIN_DB + 1);
  private at = 0;
  private n = 0;

  constructor(private readonly size: number) {
    this.ring = new Uint8Array(size);
  }

  get count(): number {
    return this.n;
  }

  add(db: number) {
    const bin = Math.max(0, Math.min(this.bins.length - 1, Math.round(db) - LEVEL_MIN_DB));
    if (this.n === this.size) this.bins[this.ring[this.at]] -= 1;
    else this.n += 1;
    this.ring[this.at] = bin;
    this.bins[bin] += 1;
    this.at = (this.at + 1) % this.size;
  }

  percentile(p: number): number | null {
    if (this.n === 0) return null;
    const need = Math.max(1, Math.ceil(this.n * p));
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i];
      if (seen >= need) return LEVEL_MIN_DB + i;
    }
    return LEVEL_MAX_DB;
  }
}

interface Run {
  /** The run has held CONFIRM_FRAMES steady, pitched frames in a row: its over-gate frames are voice. */
  confirmed: boolean;
}

interface Pending<T> {
  db: number;
  ambientDb: number | null;
  gateDb: number;
  loud: boolean;
  run: Run | null;
  data: T;
}

/**
 * The lab page's voice meter. One per microphone opening: its room level
 * carries over from the mic check into the lab, and starts afresh when the
 * microphone is opened again.
 */
export class VoiceMeter<T = undefined> {
  private readonly analyser: FrameAnalyser;
  private readonly marginDb: number;
  private readonly lookAhead: number;
  private readonly long = new LevelWindow(AMBIENT_LONG_FRAMES);
  private readonly short = new LevelWindow(AMBIENT_SHORT_FRAMES);
  private lowestDb = Infinity;
  private frames = 0;
  private pending: Pending<T>[] = [];
  private run: Run | null = null;
  /** Frames under the gate since the run's last frame over it. */
  private quietFrames = 0;
  /** Steady, pitched, over-gate frames in a row. */
  private streak = 0;
  private lastDb = SILENCE_DB;

  constructor(options: VoiceMeterOptions) {
    this.analyser = new FrameAnalyser(options.sampleRate);
    this.marginDb = options.marginDb ?? DEFAULT_GATE_MARGIN_DB;
    this.lookAhead = Math.max(0, options.lookAheadFrames ?? LOOK_AHEAD_FRAMES);
  }

  /** The room level now (dBFS): null before any frame. */
  get ambientDb(): number | null {
    if (this.frames === 0) return null;
    if (this.frames < AMBIENT_STARTUP_FRAMES) return Math.max(LEVEL_MIN_DB, Math.min(LEVEL_MAX_DB, this.lowestDb));
    return Math.min(this.long.percentile(AMBIENT_PERCENTILE)!, this.short.percentile(AMBIENT_PERCENTILE)!);
  }

  /** The level a frame pushed now would have to pass (dBFS). */
  get gateDb(): number {
    const ambient = this.ambientDb;
    return ambient === null ? GATE_FLOOR_DB : Math.max(GATE_FLOOR_DB, ambient + this.marginDb);
  }

  /** The level of the last frame pushed (dBFS), for a live level bar. */
  get levelDb(): number {
    return this.lastDb;
  }

  /** Frames pushed and not decided yet. */
  get undecided(): number {
    return this.pending.length;
  }

  /**
   * The analyser's samples (the newest frame is their last `frameSamples`),
   * with whatever the caller wants back when the frame is decided, and how
   * long it has been since the last push (ms). Returns the frames this one
   * decides: none while the look-ahead fills, then the frame pushed
   * `lookAheadFrames` before.
   */
  push(samples: ArrayLike<number>, data: T, tickMs = DEFAULT_TICK_MS): MeterFrame<T>[] {
    const end = samples.length;
    const db = this.analyser.level(samples, end);
    this.lastDb = db;
    // Judged against the room as heard before this frame; then the frame joins it.
    const ambientDb = this.ambientDb;
    const gateDb = this.gateDb;
    this.frames += 1;
    if (db < this.lowestDb) this.lowestDb = db;
    this.long.add(db);
    this.short.add(db);

    const loud = db > gateDb;
    let run: Run | null = null;
    if (loud) {
      if (!this.run || this.quietFrames > BRIDGE_FRAMES) this.run = { confirmed: false };
      this.quietFrames = 0;
      run = this.run;
      // A late tick skipped audio: the frame just before this one stands in for
      // it, so the streak still counts frames that follow each other. Confirming
      // on fewer frames instead (by time) lets rolls of short taps through.
      const before = end - this.analyser.frame;
      if (tickMs >= LATE_TICK_MS && before >= this.analyser.frame) {
        const beforeLike = this.analyser.level(samples, before) > gateDb && this.analyser.voiceLike(samples, before);
        this.streak = beforeLike ? this.streak + 1 : 0;
      }
      // Only frames over the gate can be voice, so only they pay for the pitch test.
      this.streak = this.analyser.voiceLike(samples, end) ? this.streak + 1 : 0;
      if (this.streak >= CONFIRM_FRAMES) run.confirmed = true;
    } else {
      this.quietFrames += 1;
      this.streak = 0;
      if (this.quietFrames > BRIDGE_FRAMES) this.run = null;
    }

    this.pending.push({ db, ambientDb, gateDb, loud, run, data });
    return this.pending.length > this.lookAhead ? [this.decide(this.pending.shift()!)] : [];
  }

  /** Decides every frame still pending, in order, with what is known now. */
  flush(): MeterFrame<T>[] {
    const out = this.pending.map((p) => this.decide(p));
    this.pending = [];
    return out;
  }

  private decide(p: Pending<T>): MeterFrame<T> {
    return {
      db: p.db,
      ambientDb: p.ambientDb,
      gateDb: p.gateDb,
      loud: p.loud,
      voiced: p.loud && !!p.run?.confirmed,
      data: p.data,
    };
  }
}

/**
 * The median of many levels (dB), from a histogram of 0.1 dB steps between
 * `min` and `max` (outside values read as the nearest end). For the session's
 * mic stats: O(1) to add, one pass to read.
 */
export class DbMedian {
  private readonly bins: Int32Array;
  private n = 0;

  constructor(private readonly min: number, private readonly max: number) {
    this.bins = new Int32Array(Math.round((max - min) * 10) + 1);
  }

  add(db: number) {
    if (Number.isNaN(db)) return;
    const bin = Math.max(0, Math.min(this.bins.length - 1, Math.round((db - this.min) * 10)));
    this.bins[bin] += 1;
    this.n += 1;
  }

  get count(): number {
    return this.n;
  }

  /** The median (dB), or null with nothing added. */
  median(): number | null {
    if (this.n === 0) return null;
    const need = Math.ceil(this.n / 2);
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i];
      if (seen >= need) return Math.round((this.min + i / 10) * 10) / 10;
    }
    return this.max;
  }
}
