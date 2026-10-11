// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import {
  LITTLE_SPEECH_MS,
  MAX_LEVEL_SAMPLE_MS,
  SPEECH_LEVEL_DEFAULTS,
  isLittleSpeech,
  levelFloorDb,
  speechGateDb,
  voicedMsFromLevels,
  type LevelSample,
} from './speechLevels.js';

/** A seeded generator, so a "random" room sounds the same on every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Readings every `tickMs` for `ms`, each at the level `level(atMs)` gives. */
function take(ms: number, level: (atMs: number) => number, tickMs = 50): LevelSample[] {
  const out: LevelSample[] = [];
  for (let at = 0; at < ms; at += tickMs) out.push({ db: level(at), ms: tickMs });
  return out;
}

/** Class chatter: a level that wanders around `centre` by about ±`spread` dB, with no pauses. */
function chatter(centre: number, spread: number, seed = 1) {
  const random = seeded(seed);
  return () => centre + (random() + random() + random() - 1.5) * (spread / 0.75);
}

describe('levelFloorDb', () => {
  it('is a percentile weighted by time, not by the number of readings', () => {
    // One long quiet reading (a throttled second) outweighs ten short loud ones.
    const samples = [{ db: -60, ms: 1000 }, ...Array.from({ length: 10 }, () => ({ db: -20, ms: 50 }))];
    expect(levelFloorDb(samples, 0.1)).toBe(-60);
    expect(levelFloorDb(samples, 0.6)).toBe(-60);
    expect(levelFloorDb(samples, 0.7)).toBe(-20);
  });

  it('is null with no time to go by, and skips unreadable readings', () => {
    expect(levelFloorDb([], 0.1)).toBeNull();
    expect(levelFloorDb([{ db: -30, ms: 0 }, { db: NaN, ms: 50 }], 0.1)).toBeNull();
    expect(levelFloorDb([{ db: NaN, ms: 50 }, { db: -44, ms: 50 }, { db: -30, ms: Number.POSITIVE_INFINITY }], 0.1)).toBe(-44);
  });

  it('takes digital silence (−Infinity) as the quietest level there is', () => {
    expect(levelFloorDb([{ db: -Infinity, ms: 500 }, { db: -30, ms: 500 }], 0.1)).toBe(-Infinity);
  });
});

describe('speechGateDb', () => {
  it('is the floor plus the margin, never under −60 dBFS', () => {
    expect(speechGateDb(-40)).toBe(-30);
    expect(speechGateDb(-80)).toBe(-60);
    expect(speechGateDb(-Infinity)).toBe(-60);
    expect(speechGateDb(null)).toBe(-60);
    expect(speechGateDb(-40, { ...SPEECH_LEVEL_DEFAULTS, marginDb: 6 })).toBe(-34);
  });
});

describe('voicedMsFromLevels', () => {
  it('finds no voice in silence: digital, or a quiet room', () => {
    expect(voicedMsFromLevels(take(30_000, () => -Infinity))).toBe(0);
    expect(voicedMsFromLevels(take(30_000, () => -95))).toBe(0);
    expect(voicedMsFromLevels(take(30_000, chatter(-70, 3)))).toBe(0);
    expect(voicedMsFromLevels([])).toBe(0);
  });

  it('counts under 10% of a take of steady class chatter with the student silent', () => {
    for (const [centre, seed] of [[-42, 1], [-30, 2], [-50, 3]]) {
      const samples = take(30_000, chatter(centre, 4, seed));
      expect(voicedMsFromLevels(samples)).toBeLessThan(3000);
    }
  });

  it('counts a steady tone (a fan, a fake microphone) as the room, not a voice', () => {
    expect(voicedMsFromLevels(take(20_000, () => -12))).toBe(0);
  });

  it('counts a voice 15 dB over a quiet room, and a take like that is not little speech', () => {
    const room = chatter(-62, 1.5, 4);
    // Speaks 600 ms of every 1000 ms: syllables with gaps, at −47.
    const samples = take(30_000, (at) => (at % 1000 < 600 ? -47 : room()));
    const voiced = voicedMsFromLevels(samples);
    expect(voiced).toBe(18_000);
    expect(isLittleSpeech(voiced, 30_000)).toBe(false);
  });

  it('counts a normal voice over class chatter', () => {
    const room = chatter(-42, 3, 5);
    const samples = take(30_000, (at) => (at % 1000 < 500 ? -24 : room()));
    expect(voicedMsFromLevels(samples)).toBe(15_000);
  });

  it('weighs each reading by the time it stands for: a throttled hidden tab still adds up', () => {
    // 10 s in view (a reading every 50 ms), then 20 s hidden (about one a second).
    const quiet = -65;
    const inView = take(10_000, (at) => (at % 1000 < 500 ? -35 : quiet));
    const hidden = take(20_000, (at) => (at % 2000 < 1000 ? -35 : quiet), 1000);
    expect(voicedMsFromLevels([...inView, ...hidden])).toBe(5000 + 10_000);
    // Counted per reading (the old way) the hidden part would have added 10 × 50 ms.
  });

  it('uses the caller’s margin and floor', () => {
    const samples = take(10_000, (at) => (at % 1000 < 500 ? -52 : -60));
    expect(voicedMsFromLevels(samples)).toBe(0);
    expect(voicedMsFromLevels(samples, { ...SPEECH_LEVEL_DEFAULTS, marginDb: 6 })).toBe(5000);
  });

  it('caps nothing itself: the page caps each reading at MAX_LEVEL_SAMPLE_MS', () => {
    expect(MAX_LEVEL_SAMPLE_MS).toBe(1100);
    expect(voicedMsFromLevels([{ db: -70, ms: 9000 }, { db: -20, ms: 1000 }])).toBe(1000);
  });
});

describe('isLittleSpeech', () => {
  it('is under 5 s of voice, or under a third of a take shorter than 15 s', () => {
    expect(LITTLE_SPEECH_MS).toBe(5000);
    expect(isLittleSpeech(4999, 60_000)).toBe(true);
    expect(isLittleSpeech(5000, 60_000)).toBe(false);
    expect(isLittleSpeech(2999, 9000)).toBe(true);
    expect(isLittleSpeech(3000, 9000)).toBe(false);
    expect(isLittleSpeech(0, 31_000)).toBe(true);
  });

  it('never calls an empty take (no length at all) little speech', () => {
    expect(isLittleSpeech(0, 0)).toBe(false);
  });
});
