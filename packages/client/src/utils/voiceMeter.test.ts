// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_STARTUP_FRAMES,
  DbMedian,
  FRAME_MS,
  FrameAnalyser,
  GATE_FLOOR_DB,
  LATE_TICK_MS,
  LOOK_AHEAD_FRAMES,
  VoiceMeter,
  analyserSize,
  frameSamples,
  type MeterFrame,
} from './voiceMeter';

// --- synthetic signals, seeded so every run hears the same thing -------------------------------

/** mulberry32: a small seeded generator in [0, 1). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbToAmp = (db: number) => 10 ** (db / 20);

/** A signal: `seconds` of silence at `rate`, to add sounds into. */
const silence = (rate: number, seconds: number) => new Float64Array(Math.round(rate * seconds));

/** Scales `x` in place so its RMS over [from, to) seconds is `db` dBFS. */
function scaleRms(x: Float64Array, rate: number, db: number, from = 0, to = x.length / rate) {
  const a = Math.round(from * rate);
  const b = Math.round(to * rate);
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / Math.max(1, b - a)) || 1;
  const k = dbToAmp(db) / rms;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** Scales `x` in place so its loudest frame (42.7 ms; 2048 samples at 48 kHz) is `db` dBFS (RMS). */
function scalePeak(x: Float64Array, rate: number, db: number) {
  const frame = frameSamples(rate);
  const hop = Math.round(rate / 200);
  let peak = 0;
  for (let end = frame; end <= x.length; end += hop) {
    let sum = 0;
    for (let i = end - frame; i < end; i++) sum += x[i] * x[i];
    peak = Math.max(peak, sum / frame);
  }
  const k = dbToAmp(db) / (Math.sqrt(peak) || 1);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** Adds `y` into `x` from `at` seconds. */
function mix(x: Float64Array, y: Float64Array, rate: number, at = 0) {
  const start = Math.round(at * rate);
  for (let i = 0; i < y.length && start + i < x.length; i++) x[start + i] += y[i];
  return x;
}

const sine = (rate: number, seconds: number, hz: number, amp = 1) => {
  const x = silence(rate, seconds);
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
};

/** One period of ten harmonics falling off as 1/h, looked up rather than summed per sample (the chatter needs millions). */
const VOWEL_TABLE = (() => {
  const table = new Float64Array(4096);
  for (let i = 0; i < table.length; i++) {
    for (let h = 1; h <= 10; h++) table[i] += Math.sin((2 * Math.PI * h * i) / table.length) / h;
  }
  return table;
})();

/** A sung vowel: ten harmonics of f0, a slow vibrato, 20 ms fades. */
function vowel(rate: number, seconds: number, f0: number, amp = 1) {
  const x = silence(rate, seconds);
  let phase = 0;
  const fade = 0.02 * rate;
  for (let i = 0; i < x.length; i++) {
    phase = (phase + (f0 * (1 + 0.01 * Math.sin((2 * Math.PI * 5 * i) / rate))) / rate) % 1;
    x[i] = amp * VOWEL_TABLE[Math.floor(phase * VOWEL_TABLE.length)] * Math.min(1, i / fade, (x.length - i) / fade);
  }
  return x;
}

const noise = (rate: number, seconds: number, seed: number, amp = 1) => {
  const next = random(seed);
  const x = silence(rate, seconds);
  for (let i = 0; i < x.length; i++) x[i] = amp * (next() * 2 - 1);
  return x;
};

/** A desk tap: a 180 Hz thump dying with `decayMs`, and a click of noise dying three times as fast. */
function tap(rate: number, decayMs: number, seed: number, hz = 180) {
  const next = random(seed);
  const x = silence(rate, (decayMs * 6) / 1000);
  const tau = decayMs / 1000;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    x[i] = 0.6 * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / tau) + 0.4 * (next() * 2 - 1) * Math.exp(-t / (tau / 3));
  }
  return x;
}

/** Taps every `everyMs` (±15%), from `from` to `to` seconds, each peaking at `amp`. */
function taps(x: Float64Array, rate: number, everyMs: number, from: number, to: number, seed: number, decayMs = 20, amp = 1) {
  const next = random(seed);
  for (let t = from; t < to; t += (everyMs / 1000) * (0.85 + 0.3 * next())) {
    const one = tap(rate, decayMs, Math.floor(next() * 1e6));
    for (let i = 0; i < one.length; i++) one[i] *= amp;
    mix(x, one, rate, t);
  }
  return x;
}

/**
 * Class chatter: `talkers` voices, each saying syllables of 120–300 ms with
 * short gaps, at its own pitch and loudness. The sum is diffuse: its level
 * wanders a few dB, and no one voice stands out.
 */
function chatter(rate: number, seconds: number, seed: number, talkers = 8) {
  const next = random(seed);
  const x = silence(rate, seconds);
  for (let k = 0; k < talkers; k++) {
    const f0 = 100 + 150 * next();
    const loudness = dbToAmp(-3 * next());
    for (let t = next() * 0.3; t < seconds; ) {
      const syllable = 0.12 + 0.18 * next();
      mix(x, vowel(rate, syllable, f0 * (0.9 + 0.2 * next()), loudness), rate, t);
      t += syllable + 0.03 + 0.12 * next();
    }
  }
  return x;
}

/** "Sí": 100 ms of hiss (the s), then a vowel of `vowelSeconds` (200 ms unless drawn out). */
function si(rate: number, seed: number, vowelSeconds = 0.2) {
  const x = silence(rate, 0.1 + vowelSeconds);
  mix(x, scaleRms(noise(rate, 0.1, seed), rate, -6), rate, 0);
  mix(x, scaleRms(vowel(rate, vowelSeconds, 210), rate, 0), rate, 0.1);
  return x;
}

/**
 * A spoken vowel as the throat makes it: a pulse train (every harmonic of f0
 * about as strong) through the three formants of an /a/ (700, 1200 and 2600
 * Hz, `widthsHz` wide), with a 2% vibrato, a 30 ms onset and a 60 ms fade. Its
 * energy bunches at each pulse, so a low voice is uneven over a few ms: that is
 * what kept it from counting when a frame was a fixed 2048 samples at 192 kHz.
 */
function spokenVowel(rate: number, seconds: number, f0: number, widthsHz: readonly [number, number, number]) {
  const table = new Float64Array(4096);
  // No harmonic past half the rate, even at the top of the vibrato: it would fold back as a false pitch.
  for (let h = 1; h <= 40 && h * f0 * 1.03 < rate / 2; h++) {
    const f = h * f0;
    const gain = 1 / (1 + ((f - 700) / widthsHz[0]) ** 2) + 0.6 / (1 + ((f - 1200) / widthsHz[1]) ** 2) + 0.2 / (1 + ((f - 2600) / widthsHz[2]) ** 2);
    for (let i = 0; i < table.length; i++) table[i] += gain * Math.sin((2 * Math.PI * h * i) / table.length);
  }
  const x = silence(rate, seconds);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    phase = (phase + (f0 * (1 + 0.02 * Math.sin((2 * Math.PI * 4 * i) / rate))) / rate) % 1;
    const t = i / rate;
    x[i] = table[Math.floor(phase * table.length)] * Math.min(1, t / 0.03, (seconds - t) / 0.06);
  }
  return x;
}
/** Formant bandwidths: broad (each pulse dies fast, the most uneven voice) and narrow (each pulse rings on). */
const BROAD_FORMANTS = [150, 200, 300] as const;
const NARROW_FORMANTS = [50, 60, 90] as const;

// --- the page's framing ---------------------------------------------------------------------------

/** One tick of the page's timer: when it fired (ms into the signal), and the time it credits (ms). */
interface Tick { t: number; ms: number }
/** A frame's decision, with the tick it was pushed on. */
interface Heard extends Tick { frame: MeterFrame<Tick> }

/** The most time the page credits one tick (LabRunner's MAX_FRAME_MS). */
const PAGE_MAX_TICK_MS = 200;

/**
 * Runs a signal through a meter the way the page does (LabRunner's
 * `sampleMeter`), and returns every frame's decision, in order. Each tick hands
 * over the whole analyser, `analyserSize(rate)` samples ending at the tick: two
 * frames of 42.7 ms at any rate. The meter judges the newest, and after a late
 * tick the one before it too. It also passes the tick's length, capped like the
 * page's. `step` is the page's timer: 50 ms, or the late ticks of a busy
 * Chromebook (a function, for ticks that vary). `samples` hands over fewer
 * samples than the page does, to show why the page must read the whole analyser.
 */
function listenAsPage(
  x: Float64Array,
  rate: number,
  step: number | (() => number) = 50,
  { meter = new VoiceMeter<Tick>({ sampleRate: rate }), phaseMs = 0, samples = analyserSize(rate) }: {
    meter?: VoiceMeter<Tick>;
    phaseMs?: number;
    samples?: number;
  } = {},
): Heard[] {
  const out: Heard[] = [];
  const buffer = new Float32Array(samples);
  const next = typeof step === 'number' ? () => step : step;
  let last = phaseMs;
  for (let t = phaseMs + next(); ; t += next()) {
    const end = Math.round((t / 1000) * rate);
    if (end > x.length) break;
    for (let i = 0; i < buffer.length; i++) {
      const j = end - buffer.length + i;
      buffer[i] = j >= 0 ? x[j] : 0;
    }
    const ms = Math.min(PAGE_MAX_TICK_MS, t - last);
    last = t;
    for (const f of meter.push(buffer, { t, ms }, ms)) out.push({ ...f.data, frame: f });
  }
  for (const f of meter.flush()) out.push({ ...f.data, frame: f });
  return out;
}

/** The page on time: a tick every 50 ms. */
const listen = (x: Float64Array, rate: number, meter?: VoiceMeter<Tick>, phaseMs = 0) => listenAsPage(x, rate, 50, { meter, phaseMs });

/** Voice counted (ms, as the page credits it) with ticks between `from` and `to` seconds. */
const voicedMs = (heard: Heard[], from = 0, to = Infinity) =>
  heard.filter((h) => h.t > from * 1000 && h.t <= to * 1000 && h.frame.voiced).reduce((sum, h) => sum + h.ms, 0);

const RATE = 48_000;
/** A quiet room: noise 65 dB down. */
const quietRoom = (seconds: number, seed = 1) => scaleRms(noise(RATE, seconds, seed), RATE, -65);

describe('VoiceMeter: what counts as a voice', () => {
  it('counts a sine and a sung vowel over a quiet room', () => {
    const tone = listen(mix(quietRoom(4), scaleRms(sine(RATE, 1, 220), RATE, -30), RATE, 2), RATE);
    expect(voicedMs(tone)).toBe(1000);
    const sung = listen(mix(quietRoom(4), scaleRms(vowel(RATE, 1, 150), RATE, -30), RATE, 2), RATE);
    expect(voicedMs(sung)).toBe(1000);
    // Nothing before or after it.
    expect(voicedMs(sung, 0, 2)).toBe(0);
    expect(voicedMs(sung, 3.05)).toBe(0);
  });

  it('counts a soft voice in a quiet room that the old −45 dBFS gate missed', () => {
    const soft = listen(mix(quietRoom(4), scaleRms(vowel(RATE, 1, 180), RATE, -50), RATE, 2), RATE);
    expect(voicedMs(soft)).toBe(1000);
  });

  it('never counts white noise, however loud (a whisper, a fan, a hiss)', () => {
    for (const db of [-40, -20]) {
      const heard = listen(mix(quietRoom(4), scaleRms(noise(RATE, 1, 5), RATE, db), RATE, 2), RATE);
      expect(heard.filter((h) => h.frame.loud).length).toBeGreaterThan(15);
      expect(voicedMs(heard)).toBe(0);
    }
  });

  it('never counts a desk tap (a 180 Hz thump dying in 20 ms), nor trains of the sim’s taps', () => {
    const single = listen(taps(quietRoom(6), RATE, 400, 2, 5, 3, 20, dbToAmp(-20)), RATE);
    expect(single.filter((h) => h.frame.loud).length).toBeGreaterThan(5);
    expect(voicedMs(single)).toBe(0);
    // The simulation's taps (6-15 ms decays), as a roll or a steady beat.
    for (const decayMs of [6, 10, 15]) {
      for (const everyMs of [50, 70, 100, 150]) {
        const roll = listen(taps(quietRoom(8), RATE, everyMs, 2, 7, everyMs + decayMs, decayMs, dbToAmp(-20)), RATE);
        expect(voicedMs(roll), `${decayMs} ms taps every ${everyMs} ms`).toBe(0);
      }
    }
  });

  it('does count a resonant knock, a whistle and a hum: sustained pitched sounds are its known limit', () => {
    const knock = listen(taps(quietRoom(6), RATE, 400, 2, 5, 3, 80, dbToAmp(-20)), RATE);
    expect(voicedMs(knock)).toBeGreaterThan(1000);
    const whistle = listen(mix(quietRoom(4), scaleRms(sine(RATE, 1, 1500), RATE, -30), RATE, 2), RATE);
    expect(voicedMs(whistle)).toBe(1000);
    const hum = listen(mix(quietRoom(4), scaleRms(sine(RATE, 1, 120), RATE, -30), RATE, 2), RATE);
    expect(voicedMs(hum)).toBe(1000);
  });

});

/** Rates Chrome can run the page's audio at: it takes them from the output device. */
const RATES = [8_000, 16_000, 44_100, 48_000, 96_000, 192_000];

describe('VoiceMeter: at whatever rate the browser runs the audio', () => {
  it('a frame lasts 42.7 ms at any rate, and the page’s analyser holds two', () => {
    expect([16_000, 48_000, 192_000].map(frameSamples)).toEqual([683, 2048, 8192]);
    expect(RATES.map(analyserSize)).toEqual([1024, 2048, 4096, 4096, 8192, 16_384]);
    for (const rate of RATES) {
      expect((frameSamples(rate) / rate) * 1000, `${rate} Hz frame`).toBeCloseTo(FRAME_MS, 0);
      expect(analyserSize(rate), `${rate} Hz analyser`).toBeGreaterThanOrEqual(2 * frameSamples(rate));
    }
    // A rate the browser did not report: 48 kHz's frame.
    expect(frameSamples(0)).toBe(2048);
  });

  it('counts a low or middle voice in full at 8, 16, 44.1, 48, 96 and 192 kHz, and never noise', () => {
    for (const rate of RATES) {
      const room = () => scaleRms(noise(rate, 4, 1), rate, -65);
      for (const f0 of [95, 110, 130]) {
        for (const widths of [BROAD_FORMANTS, NARROW_FORMANTS]) {
          const spoken = listenAsPage(mix(room(), scaleRms(spokenVowel(rate, 1, f0, widths), rate, -30), rate, 2), rate);
          expect(voicedMs(spoken), `${rate} Hz, f0 ${f0} Hz, formants ${widths[0]} Hz wide`).toBe(1000);
        }
      }
      const sung = listenAsPage(mix(room(), scaleRms(vowel(rate, 1, 150), rate, -30), rate, 2), rate);
      expect(voicedMs(sung), `${rate} Hz sung vowel`).toBe(1000);
      const hiss = listenAsPage(mix(room(), scaleRms(noise(rate, 1, 9), rate, -30), rate, 2), rate);
      expect(hiss.filter((h) => h.frame.loud).length, `${rate} Hz noise`).toBeGreaterThan(15);
      expect(voicedMs(hiss), `${rate} Hz noise`).toBe(0);
    }
  });

  it('counts a one-word “sí” at 16 kHz (a Bluetooth headset) for at least 0.2 s, wherever the ticks fall', () => {
    const rate = 16_000;
    for (let phaseMs = 0; phaseMs < 50; phaseMs += 5) {
      const x = scaleRms(noise(rate, 6, 4), rate, -65);
      mix(x, scalePeak(si(rate, phaseMs + 1), rate, -30), rate, 3);
      const heard = listenAsPage(x, rate, 50, { phaseMs });
      expect(voicedMs(heard, 3, 3.6), `ticks ${phaseMs} ms in`).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('VoiceMeter: late ticks (a busy Chromebook)', () => {
  /** "Sí" at −30 dBFS, starting at 3 s over a quiet room. */
  const siAt3s = (vowelSeconds = 0.2) => mix(quietRoom(5, 4), scalePeak(si(RATE, 7, vowelSeconds), RATE, -30), RATE, 3);
  /**
   * The share of tick phases (every 2 ms across one tick) at which the page,
   * its timer firing every `stepMs`, counts at least 0.2 s of the answer.
   */
  const shareCounted = (x: Float64Array, stepMs: number, samples?: number) => {
    let counted = 0;
    let phases = 0;
    for (let phaseMs = 0; phaseMs < stepMs; phaseMs += 2) {
      const heard = listenAsPage(x, RATE, stepMs, { phaseMs, samples });
      if (voicedMs(heard, 3, 4.5) >= 200) counted += 1;
      phases += 1;
    }
    return counted / phases;
  };

  it('counts a one-word “sí” for at least 0.2 s with the timer firing every 100 ms, and mostly every 150 or 200 ms', () => {
    const x = siAt3s();
    // The frame before the newest stands in for the audio a late tick skipped.
    expect(shareCounted(x, 100)).toBe(1);
    // Measured: 96% of phases at 150 ms, 72% at 200 ms (the old −45 dBFS gate credited every one).
    expect(shareCounted(x, 150)).toBeGreaterThanOrEqual(0.9);
    expect(shareCounted(x, 200)).toBeGreaterThanOrEqual(0.65);
    // The known limit: a tick hears only its last 85 ms, so with ticks far apart a 200 ms vowel can fall
    // between two looks. Drawn out to 300 ms, the answer counts wherever the ticks fall.
    expect(shareCounted(siAt3s(0.3), 150)).toBe(1);
    expect(shareCounted(siAt3s(0.3), 200)).toBe(1);
  });

  it('needs the frame before the newest for that: handed only the newest frame, a late tick confirms “sí” far less often', () => {
    const x = siAt3s();
    // Measured: 24% of phases, against 96% with the whole analyser.
    expect(shareCounted(x, 150, frameSamples(RATE))).toBeLessThan(0.5);
    expect(shareCounted(x, 150, frameSamples(RATE))).toBeLessThan(shareCounted(x, 150));
  });

  it(`never counts taps, however late the ticks (the frame before is judged from ${LATE_TICK_MS} ms on)`, () => {
    const single = taps(quietRoom(6), RATE, 400, 2, 5, 3, 20, dbToAmp(-20));
    const rolls = [6, 10, 15].flatMap((decayMs) => [50, 70, 100, 150].map((everyMs) => ({
      label: `${decayMs} ms taps every ${everyMs} ms`,
      x: taps(quietRoom(8), RATE, everyMs, 2, 7, everyMs + decayMs, decayMs, dbToAmp(-20)),
    })));
    // Steady late ticks, and a timer that wanders between on time and very late.
    const timers: [string, () => number | (() => number)][] = [
      ['every 100 ms', () => 100],
      ['every 150 ms', () => 150],
      ['every 200 ms', () => 200],
      ['every 50 to 200 ms', () => {
        const next = random(11);
        return () => 50 + 150 * next();
      }],
    ];
    for (const [timer, step] of timers) {
      const heard = listenAsPage(single, RATE, step());
      expect(heard.some((h) => h.frame.loud), `single taps, a tick ${timer}`).toBe(true);
      expect(voicedMs(heard), `single taps, a tick ${timer}`).toBe(0);
      for (const { label, x } of rolls) {
        const roll = listenAsPage(x, RATE, step());
        expect(roll.some((h) => h.frame.loud), `${label}, a tick ${timer}`).toBe(true);
        expect(voicedMs(roll), `${label}, a tick ${timer}`).toBe(0);
      }
    }
  });

  it('never counts chatter once the room level is known, with a tick every 150 ms', () => {
    // The room level's startup rule counts frames, not time: 40 frames last 6 s at 150 ms.
    const known = (AMBIENT_STARTUP_FRAMES * 150) / 1000 + 0.5;
    for (let seed = 1; seed <= 6; seed++) {
      const heard = listenAsPage(scaleRms(chatter(RATE, 20, seed), RATE, -44), RATE, 150);
      expect(voicedMs(heard, known), `seed ${seed}`).toBe(0);
      // The old −45 dBFS gate would have counted it.
      expect(heard.filter((h) => h.t > known * 1000 && h.frame.db > -45).length, `seed ${seed}`).toBeGreaterThan(10);
    }
  });
});

describe('VoiceMeter: an honest one-word answer, at any rate and on a slow machine', () => {
  /** "Sí" at −30 dBFS over a quiet room at `rate`, its vowel `vowelSeconds` long, from 3 s. */
  const siAt = (rate: number, vowelSeconds: number) =>
    mix(scaleRms(noise(rate, 5, 4), rate, -65), scalePeak(si(rate, 7, vowelSeconds), rate, -30), rate, 3);
  /** The share of tick phases (every 2 ms across one tick) at which the page counts at least 0.2 s of it. */
  const shareCounted = (rate: number, x: Float64Array, stepMs: number) => {
    let counted = 0;
    let phases = 0;
    for (let phaseMs = 0; phaseMs < stepMs; phaseMs += 2) {
      if (voicedMs(listenAsPage(x, rate, stepMs, { phaseMs }), 3, 4.5) >= 200) counted += 1;
      phases += 1;
    }
    return counted / phases;
  };

  it('counts a “sí” with a vowel of only 150 ms for at least 0.2 s, wherever the ticks fall, at every rate', () => {
    for (const rate of RATES) {
      expect(shareCounted(rate, siAt(rate, 0.15), 50), `${rate} Hz`).toBe(1);
    }
  });

  it('at 16, 44.1 and 48 kHz with the timer late (100 or 150 ms a tick): a 200 ms vowel nearly always, a 150 ms one mostly', () => {
    for (const rate of [16_000, 44_100, 48_000]) {
      // Measured: every phase at 100 ms, 93-96% at 150 ms.
      expect(shareCounted(rate, siAt(rate, 0.2), 100), `${rate} Hz, 200 ms vowel, 100 ms ticks`).toBe(1);
      expect(shareCounted(rate, siAt(rate, 0.2), 150), `${rate} Hz, 200 ms vowel, 150 ms ticks`).toBeGreaterThanOrEqual(0.9);
      // Measured: 92-96% at 100 ms. A tick hears only its last 85 ms, so a 150 ms vowel can fall between two looks.
      expect(shareCounted(rate, siAt(rate, 0.15), 100), `${rate} Hz, 150 ms vowel, 100 ms ticks`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('still never counts the simulation’s tap rolls at 16 and 44.1 kHz, however late the ticks', () => {
    for (const rate of [16_000, 44_100]) {
      for (const decayMs of [6, 10, 15]) {
        for (const everyMs of [50, 70, 100, 150]) {
          const x = taps(scaleRms(noise(rate, 8, 1), rate, -65), rate, everyMs, 2, 7, everyMs + decayMs, decayMs, dbToAmp(-20));
          for (const step of [50, 100, 150]) {
            const heard = listenAsPage(x, rate, step);
            expect(heard.some((h) => h.frame.loud), `${rate} Hz, ${decayMs} ms taps every ${everyMs} ms, a tick every ${step} ms`).toBe(true);
            expect(voicedMs(heard), `${rate} Hz, ${decayMs} ms taps every ${everyMs} ms, a tick every ${step} ms`).toBe(0);
          }
        }
      }
    }
  });
});

describe('VoiceMeter: the room level and the gate', () => {
  it('a tone held for about 8 s becomes the room, and stops counting', () => {
    const heard = listen(mix(quietRoom(20), scaleRms(sine(RATE, 16, 220), RATE, -30), RATE, 3), RATE);
    const voiced = heard.filter((h) => h.frame.voiced).map((h) => h.t);
    expect(Math.min(...voiced)).toBe(3050);
    // 80% of the 10 s window: 8 s.
    expect(Math.max(...voiced)).toBeGreaterThanOrEqual(10_500);
    expect(Math.max(...voiced)).toBeLessThanOrEqual(11_500);
    expect(heard.find((h) => h.t === 15_000)!.frame.ambientDb).toBe(-30);
  });

  it('follows the room within 2.5 s after the gain drops (a laugh, a shout, the browser’s auto gain)', () => {
    // A loud room (chatter at −30 dBFS) for 12 s, then everything 20 dB down, with a voice 10 dB over the new room.
    const x = scaleRms(chatter(RATE, 24, 3), RATE, -30);
    for (let i = Math.round(12 * RATE); i < x.length; i++) x[i] *= dbToAmp(-20);
    const voices = [12.5, 14.5, 16.5, 18.5, 20.5];
    for (const at of voices) mix(x, scalePeak(vowel(RATE, 0.8, 200), RATE, -38), RATE, at);
    const heard = listen(x, RATE);
    const gateAt = (ms: number) => heard.find((h) => h.t === ms)!.frame.gateDb;
    expect(gateAt(11_000)).toBeGreaterThan(-30);
    // Under a second after the drop, the 2.5 s window has lowered the gate; the 10 s one alone would take 2 s.
    expect(gateAt(12_750)).toBeLessThan(-40);
    for (const at of voices) expect(voicedMs(heard, at, at + 0.8), `voice at ${at} s`).toBeGreaterThanOrEqual(700);
  });

  it(`never puts the gate under ${GATE_FLOOR_DB} dBFS, however quiet the room`, () => {
    const digitalSilence = silence(RATE, 6);
    mix(digitalSilence, scaleRms(sine(RATE, 1, 220), RATE, -58), RATE, 3);
    mix(digitalSilence, scaleRms(sine(RATE, 1, 220), RATE, -52), RATE, 4.5);
    const heard = listen(digitalSilence, RATE);
    expect(heard.every((h) => h.frame.gateDb >= GATE_FLOOR_DB)).toBe(true);
    expect(voicedMs(heard, 2.9, 4.1)).toBe(0);
    expect(voicedMs(heard, 4.4, 5.6)).toBe(1000);
  });

  it(`uses the lowest level heard for the first ${AMBIENT_STARTUP_FRAMES} frames, then the 20th percentile`, () => {
    const meter = new VoiceMeter<number>({ sampleRate: RATE, lookAheadFrames: 0 });
    const frame = (db: number) => {
      const f = new Float32Array(2048);
      for (let i = 0; i < f.length; i++) f[i] = db === -Infinity ? 0 : dbToAmp(db) * Math.SQRT2 * Math.sin((2 * Math.PI * 220 * i) / RATE);
      return f;
    };
    expect(meter.ambientDb).toBeNull();
    expect(meter.gateDb).toBe(GATE_FLOOR_DB);
    meter.push(frame(-40), 0);
    expect(meter.ambientDb).toBeCloseTo(-40, 1);
    meter.push(frame(-50), 1);
    meter.push(frame(-35), 2);
    expect(meter.ambientDb).toBeCloseTo(-50, 1);
    expect(meter.gateDb).toBeCloseTo(-44, 1);
    // A stream that starts with zeros: the gate sits at its floor until the percentile takes over.
    meter.push(frame(-Infinity), 3);
    expect(meter.ambientDb).toBe(-120);
    expect(meter.gateDb).toBe(GATE_FLOOR_DB);
    // After 2 s of frames: the 20th percentile, in whole dB.
    for (let i = 4; i < AMBIENT_STARTUP_FRAMES; i++) meter.push(frame(-30), i);
    expect(meter.ambientDb).toBe(-30);
  });

  it('takes the room margin it is given', () => {
    const x = mix(scaleRms(noise(RATE, 6, 2), RATE, -50), scalePeak(vowel(RATE, 1, 200), RATE, -45), RATE, 4);
    // The room reads about −52 dB; the voice sits about 7 dB over it.
    expect(voicedMs(listen(x, RATE, new VoiceMeter<Tick>({ sampleRate: RATE, marginDb: 4 })))).toBeGreaterThan(500);
    expect(voicedMs(listen(x, RATE, new VoiceMeter<Tick>({ sampleRate: RATE, marginDb: 12 })))).toBe(0);
  });
});

describe('VoiceMeter: in a noisy class', () => {
  it('counts a one-word “sí” at −30 dBFS over chatter at −44: at least 0.2 s each time', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const x = scaleRms(chatter(RATE, 12, seed), RATE, -44);
      for (let at = 4; at < 11; at += 1.5) mix(x, scalePeak(si(RATE, seed * 10 + at), RATE, -30), RATE, at);
      const heard = listen(x, RATE);
      for (let at = 4; at < 11; at += 1.5) expect(voicedMs(heard, at, at + 0.6), `seed ${seed} at ${at} s`).toBeGreaterThanOrEqual(200);
    }
  });

  it('the “s” before the vowel counts too, thanks to the look-ahead', () => {
    const x = scaleRms(noise(RATE, 6, 4), RATE, -65);
    mix(x, scalePeak(si(RATE, 1), RATE, -30), RATE, 3);
    const withLookAhead = voicedMs(listen(x, RATE));
    const without = voicedMs(listen(x, RATE, new VoiceMeter<Tick>({ sampleRate: RATE, lookAheadFrames: 0 })));
    expect(withLookAhead).toBeGreaterThan(without);
  });

  it('chatter alone counts nothing once the room level is known', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const heard = listen(scaleRms(chatter(RATE, 20, seed), RATE, -44), RATE);
      expect(voicedMs(heard, 2.5), `seed ${seed}`).toBe(0);
      // The old −45 dBFS gate would have counted it.
      expect(heard.filter((h) => h.t > 2500 && h.frame.db > -45).length, `seed ${seed}`).toBeGreaterThan(20);
    }
  });
});

describe('VoiceMeter: deciding frames', () => {
  it(`decides each frame once, in order, ${LOOK_AHEAD_FRAMES} frames later; flush decides the rest`, () => {
    const meter = new VoiceMeter<number>({ sampleRate: RATE });
    const x = mix(quietRoom(3), scaleRms(vowel(RATE, 0.5, 150), RATE, -30), RATE, 1);
    const decided: number[] = [];
    const frame = new Float32Array(2048);
    let pushed = 0;
    for (let k = 1; k <= 40; k++) {
      const end = Math.round(0.05 * k * RATE);
      frame.set(Array.from(x.subarray(end - 2048, end), Number));
      const out = meter.push(frame, k);
      pushed += 1;
      expect(out.length).toBe(k <= LOOK_AHEAD_FRAMES ? 0 : 1);
      decided.push(...out.map((f) => f.data));
      expect(meter.undecided).toBe(Math.min(pushed, LOOK_AHEAD_FRAMES));
    }
    decided.push(...meter.flush().map((f) => f.data));
    expect(decided).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(meter.flush()).toEqual([]);
    expect(meter.undecided).toBe(0);
  });

  it('flushing mid-word decides what it can: a run already confirmed counts, one not yet does not', () => {
    const x = mix(quietRoom(3), scaleRms(vowel(RATE, 1, 150), RATE, -30), RATE, 1);
    const run = (stopMs: number) => {
      const meter = new VoiceMeter<number>({ sampleRate: RATE });
      const out: MeterFrame<number>[] = [];
      const frame = new Float32Array(2048);
      for (let ms = 50; ms <= stopMs; ms += 50) {
        const end = Math.round((ms / 1000) * RATE);
        frame.set(Array.from(x.subarray(end - 2048, end), Number));
        out.push(...meter.push(frame, ms));
      }
      return [...out, ...meter.flush()].filter((f) => f.voiced).length;
    };
    // Two frames into the vowel: confirmed, both count.
    expect(run(1100)).toBe(2);
    // One frame in: not a voice yet.
    expect(run(1050)).toBe(0);
  });

  it('reports the level, room level and gate each frame was judged against', () => {
    const heard = listen(mix(quietRoom(4), scaleRms(sine(RATE, 1, 220), RATE, -30), RATE, 2), RATE);
    const inTone = heard.find((h) => h.t === 2500)!.frame;
    expect(inTone.db).toBeCloseTo(-30, 0);
    expect(inTone.ambientDb).toBe(-65);
    expect(inTone.gateDb).toBe(-55);
    expect(inTone).toMatchObject({ loud: true, voiced: true });
  });
});

describe('FrameAnalyser', () => {
  it('measures level, steadiness and pitch', () => {
    const analyser = new FrameAnalyser(RATE);
    const tone = new Float32Array(Array.from(sine(RATE, 0.05, 200, 0.1).subarray(0, 2048), Number));
    const f = analyser.features(tone);
    expect(f.db).toBeCloseTo(-23, 0);
    expect(f.spreadDb).toBeLessThan(1);
    expect(f.periodicity).toBeGreaterThan(0.9);
    const hiss = new Float32Array(Array.from(noise(RATE, 0.05, 3, 0.1).subarray(0, 2048), Number));
    expect(analyser.periodicity(hiss)).toBeLessThan(0.5);
    // Silence and a constant have no pitch.
    expect(analyser.features(new Float32Array(2048))).toEqual({ db: -180, spreadDb: 0, periodicity: 0 });
    expect(analyser.periodicity(new Float32Array(2048).fill(0.1))).toBe(0);
  });
});

describe('DbMedian', () => {
  it('gives the median to 0.1 dB, clamps to its range, and null when empty', () => {
    const m = new DbMedian(-120, 20);
    expect(m.median()).toBeNull();
    for (const v of [-50, -40.04, -30, -45.27, NaN]) m.add(v);
    expect(m.count).toBe(4);
    expect(m.median()).toBe(-45.3);
    m.add(-500);
    m.add(-Infinity);
    expect(m.median()).toBe(-50);
    const high = new DbMedian(0, 10);
    high.add(99);
    expect(high.median()).toBe(10);
  });
});
