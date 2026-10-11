// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import {
  RED_SPEAKING_FLAGS,
  SPEAKING_FLAGS,
  isLengthMismatch,
  parseSpeakingFlags,
  pickMicSettings,
} from './speakingChecks.js';

describe('speaking flags', () => {
  it('names the six flags, three of them red', () => {
    expect(SPEAKING_FLAGS).toEqual(['same-file', 'copied', 'model', 'length-mismatch', 'little-speech', 'unmeasured']);
    expect(RED_SPEAKING_FLAGS).toEqual(['same-file', 'copied', 'model']);
  });

  it('reads stored flags back in their own order, leaving out anything else', () => {
    expect(parseSpeakingFlags('["little-speech","same-file"]')).toEqual(['same-file', 'little-speech']);
    expect(parseSpeakingFlags('["model","made-up",3,null]')).toEqual(['model']);
    for (const stored of [null, undefined, '', 'not json', '{"flags":["model"]}', '"model"']) {
      expect(parseSpeakingFlags(stored)).toEqual([]);
    }
  });
});

describe('isLengthMismatch', () => {
  it('flags a page that timed the take more than 3 s, or 20%, longer than the file', () => {
    // The sim's trick: a 45 s claim on a 3 s file.
    expect(isLengthMismatch(45_000, 3000)).toBe(true);
    // Short files: 3 s of slack.
    expect(isLengthMismatch(6000, 3000)).toBe(false);
    expect(isLengthMismatch(6001, 3000)).toBe(true);
    // Long files: 20%.
    expect(isLengthMismatch(36_000, 30_000)).toBe(false);
    expect(isLengthMismatch(36_001, 30_000)).toBe(true);
  });

  it('never flags an honest page (35–70 ms long), or one that timed it short', () => {
    expect(isLengthMismatch(16_630, 16_562)).toBe(false);
    expect(isLengthMismatch(10_000, 60_000)).toBe(false);
  });
});

describe('pickMicSettings', () => {
  it('keeps the four switches and the sample rate, never a device id', () => {
    expect(pickMicSettings({
      deviceId: 'a1b2c3', groupId: 'g', label: 'Built-in mic',
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false,
      sampleRate: 48_000, channelCount: 1, latency: 0.01,
    })).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false, sampleRate: 48_000 });
  });

  it('reads echo cancellation reported as "all" as on, and leaves out other odd entries', () => {
    expect(pickMicSettings({ echoCancellation: 'all', noiseSuppression: 'yes', autoGainControl: true, sampleRate: 44_100.4 }))
      .toEqual({ echoCancellation: true, autoGainControl: true, sampleRate: 44_100 });
    expect(pickMicSettings({ echoCancellation: 'remote-only', sampleRate: 100 })).toBeNull();
    expect(pickMicSettings({ sampleRate: Number.NaN })).toBeNull();
  });

  it('is null for anything but a settings object', () => {
    for (const raw of [null, undefined, 'echo', 3, [], [true], {}]) expect(pickMicSettings(raw)).toBeNull();
  });
});
