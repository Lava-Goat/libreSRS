// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import {
  CONNECTION_WAIT_MS,
  DEFAULT_GATE_MARGIN_DB,
  DEFAULT_MIN_ANSWERED_PCT,
  DEFAULT_VOICE_PER_PAUSE_MS,
  GATE_MARGIN_RANGE_DB,
  LAB_CLIENT,
  LAB_METER_VERSION,
  LAB_MIC_STATS_LIMITS,
  LAB_RULES_VERSION,
  LEGACY_SESSION_MAX_AGE_MS,
  MAX_ANSWERS_PER_REPORT,
  MAX_LOG_LEAD_MS,
  MAX_PAUSES_PER_LAB,
  MAX_SUBMIT_ANSWERS,
  MAX_SUBMIT_REPORTS,
  MIC_CHECK_VOICE_MS,
  MIN_ANSWERED_PCT_RANGE,
  PAUSE_LEAD_MS,
  PAUSE_TAIL_CUT_MS,
  VOICE_PER_PAUSE_RANGE_MS,
  clampLabMicStats,
  clampLabSettings,
  countedPauses,
  neededPauses,
  parseLabMicStats,
  parseLabRules,
  parsePauseList,
  pauseWindow,
  pauseWindowMs,
  scanNeedsCheck,
  validateLabMicStats,
  validatePauseList,
  type LabMicStats,
  type LabPause,
  type LabPauseScan,
  type LabRules,
} from './index.js';

/** A run of `count` pauses 3.6 s long, one every 8 s from 10 s in. */
const pausesEvery8s = (count: number): LabPause[] =>
  Array.from({ length: count }, (_, i): LabPause => [10_000 + i * 8000, 13_600 + i * 8000]);

describe('lab pause rules', () => {
  it('pins the constants the page, the server and the teacher screens share', () => {
    expect([PAUSE_LEAD_MS, PAUSE_TAIL_CUT_MS, MIC_CHECK_VOICE_MS]).toEqual([300, 100, 500]);
    expect([MAX_ANSWERS_PER_REPORT, MAX_SUBMIT_ANSWERS, MAX_SUBMIT_REPORTS]).toEqual([20, 200, 400]);
    expect([MAX_LOG_LEAD_MS, CONNECTION_WAIT_MS, LEGACY_SESSION_MAX_AGE_MS]).toEqual([120_000, 90_000, 21_600_000]);
    // 3: the page with the room-relative voice meter; older pages are told to reload.
    expect(LAB_CLIENT).toBe(3);
    // The rules keep version 1, so sessions already open (and a rolled-back server) still read them.
    expect(LAB_RULES_VERSION).toBe(1);
    expect(LAB_METER_VERSION).toBe(2);
    expect([DEFAULT_MIN_ANSWERED_PCT, DEFAULT_VOICE_PER_PAUSE_MS]).toEqual([75, 250]);
    expect(MIN_ANSWERED_PCT_RANGE).toEqual([0, 100]);
    // The floor may go down to 0.2 s (a one-word answer in a noisy room); the default stays 0.25 s.
    expect(VOICE_PER_PAUSE_RANGE_MS).toEqual([200, 2000]);
    expect(DEFAULT_VOICE_PER_PAUSE_MS).toBeGreaterThan(VOICE_PER_PAUSE_RANGE_MS[0]);
    // The room margin: 6 dB is the measured knee, and the teacher may set 4–12.
    expect(DEFAULT_GATE_MARGIN_DB).toBe(6);
    expect(GATE_MARGIN_RANGE_DB).toEqual([4, 12]);
    // The page pauses itself well before its reports could count as late.
    expect(CONNECTION_WAIT_MS).toBeLessThan(MAX_LOG_LEAD_MS);
  });

  describe('pauseWindow', () => {
    it('counts voice from 0.3 s after the pause starts to 0.1 s before it ends', () => {
      expect(pauseWindow([10_000, 13_600])).toEqual({ from: 10_300, to: 13_500 });
      expect(pauseWindowMs([10_000, 13_600])).toBe(3200);
    });

    it('gives the shortest real pause (3.54 s) a window of 3.14 s', () => {
      expect(pauseWindowMs([0, 3540])).toBe(3140);
    });

    it('is never negative for a pause shorter than the lead and the tail cut', () => {
      expect(pauseWindowMs([1000, 1300])).toBe(0);
    });
  });

  describe('validatePauseList', () => {
    const duration = 900_000;

    it('accepts a sorted list of pauses inside the lab, and an empty one', () => {
      expect(validatePauseList(pausesEvery8s(100), duration)).toEqual({ ok: true });
      expect(validatePauseList([], duration)).toEqual({ ok: true });
      // Touching pauses do not overlap; a pause may end exactly at the end of the audio.
      expect(validatePauseList([[1000, 5000], [5000, 9000], [duration - 4000, duration]], duration)).toEqual({ ok: true });
      // The length limits are inclusive.
      expect(validatePauseList([[0, 1000], [2000, 62_000]], duration)).toEqual({ ok: true });
    });

    it('refuses anything that is not a list of integer pairs', () => {
      expect(validatePauseList(null, duration)).toMatchObject({ ok: false, reason: 'not-a-list' });
      expect(validatePauseList({ 0: [1000, 5000] }, duration)).toMatchObject({ ok: false, reason: 'not-a-list' });
      expect(validatePauseList([[1000, 5000, 6000]], duration)).toMatchObject({ ok: false, reason: 'not-a-pair', index: 0 });
      expect(validatePauseList([[1000, 5000], 7000], duration)).toMatchObject({ ok: false, reason: 'not-a-pair', index: 1 });
      expect(validatePauseList([[1000.5, 5000]], duration)).toMatchObject({ ok: false, reason: 'not-integers', index: 0 });
      expect(validatePauseList([['1000', 5000]], duration)).toMatchObject({ ok: false, reason: 'not-integers' });
      expect(validatePauseList([[1000, Number.NaN]], duration)).toMatchObject({ ok: false, reason: 'not-integers' });
      expect(validatePauseList([[1000, Infinity]], duration)).toMatchObject({ ok: false, reason: 'not-integers' });
    });

    it('refuses pauses outside the audio or backwards', () => {
      expect(validatePauseList([[-1, 4000]], duration)).toMatchObject({ ok: false, reason: 'out-of-range' });
      expect(validatePauseList([[duration - 3000, duration + 1]], duration)).toMatchObject({ ok: false, reason: 'out-of-range' });
      expect(validatePauseList([[5000, 5000]], duration)).toMatchObject({ ok: false, reason: 'out-of-range' });
      expect(validatePauseList([[5000, 1000]], duration)).toMatchObject({ ok: false, reason: 'out-of-range' });
    });

    it('refuses pauses under 1 s or over 60 s', () => {
      expect(validatePauseList([[1000, 1999]], duration)).toMatchObject({ ok: false, reason: 'too-short' });
      expect(validatePauseList([[1000, 61_001]], duration)).toMatchObject({ ok: false, reason: 'too-long' });
    });

    it('refuses an unsorted list and overlapping pauses', () => {
      expect(validatePauseList([[10_000, 14_000], [1000, 5000]], duration)).toMatchObject({ ok: false, reason: 'unsorted', index: 1 });
      expect(validatePauseList([[1000, 5000], [4999, 9000]], duration)).toMatchObject({ ok: false, reason: 'overlap', index: 1 });
      expect(validatePauseList([[1000, 5000], [1000, 5000]], duration)).toMatchObject({ ok: false, reason: 'overlap', index: 1 });
    });

    it('holds at most 400 pauses', () => {
      const list = Array.from({ length: MAX_PAUSES_PER_LAB + 1 }, (_, i): LabPause => [i * 2000, i * 2000 + 1500]);
      expect(validatePauseList(list, 10_000_000)).toMatchObject({ ok: false, reason: 'too-many' });
      expect(validatePauseList(list.slice(0, MAX_PAUSES_PER_LAB), 10_000_000)).toEqual({ ok: true });
    });
  });

  describe('countedPauses', () => {
    const all: LabPause[] = [[10_000, 13_600], [20_000, 23_600], [30_000, 33_600], [40_000, 43_600]];

    it('counts every pause that ends 1.5 s before the must-hear-through point', () => {
      expect(countedPauses(all, null, 45_100)).toEqual(all);
      expect(countedPauses(all, undefined, 45_100)).toEqual(all);
      // A student may Finish at 43.6 s here, so the last pause can't be required.
      expect(countedPauses(all, null, 45_099)).toEqual(all.slice(0, 3));
    });

    it('leaves out pauses that start at or after "don\'t count pauses after" (dictation)', () => {
      expect(countedPauses(all, 30_000, 45_100)).toEqual(all.slice(0, 2));
      expect(countedPauses(all, 30_001, 45_100)).toEqual(all.slice(0, 3));
      expect(countedPauses(all, 0, 45_100)).toEqual([]);
    });

    it('returns copies, not the lab\'s own pairs', () => {
      const counted = countedPauses(all, null, 45_100);
      counted[0][0] = 1;
      expect(all[0]).toEqual([10_000, 13_600]);
    });
  });

  describe('neededPauses', () => {
    it('rounds the share of the counted pauses up', () => {
      expect(neededPauses(101, 75)).toBe(76);
      expect(neededPauses(100, 75)).toBe(75);
      expect(neededPauses(3, 75)).toBe(3);
      expect(neededPauses(4, 75)).toBe(3);
      expect(neededPauses(100, 7)).toBe(7);
      expect(neededPauses(1, 1)).toBe(1);
      expect(neededPauses(97, 100)).toBe(97);
    });

    it('is 0 when the rule is off or nothing counts', () => {
      expect(neededPauses(101, 0)).toBe(0);
      expect(neededPauses(0, 75)).toBe(0);
      expect(neededPauses(-3, 75)).toBe(0);
    });

    it('never needs more than all of them', () => {
      expect(neededPauses(10, 250)).toBe(10);
    });
  });

  describe('scanNeedsCheck', () => {
    // Numbers the scan gives the real labs (±150 ms close calls: none on any of the 34).
    const semana01: LabPauseScan = { minPauseMs: 3300, thresholdDb: -46.2, noiseDb: -200, shortestKeptMs: 3570, longestLeftOutMs: 2940, closeCalls: 0 };
    // The tightest of the 34: 3.60 s kept against 3.07 s left out.
    const semana10: LabPauseScan = { minPauseMs: 3300, thresholdDb: -44.5, noiseDb: -200, shortestKeptMs: 3600, longestLeftOutMs: 3070, closeCalls: 0 };
    // A lossy copy: codec noise, far below −40 dBFS.
    const opus: LabPauseScan = { ...semana01, noiseDb: -100.1 };

    it('does not warn on the real labs', () => {
      expect(scanNeedsCheck(semana01, 97)).toBe(false);
      expect(scanNeedsCheck(semana10, 103)).toBe(false);
      expect(scanNeedsCheck(opus, 97)).toBe(false);
      expect(scanNeedsCheck({ ...semana01, noiseDb: -40 }, 97)).toBe(false);
    });

    it('warns on the three degraded copies with noise under the pauses (pad −30 dB)', () => {
      expect(scanNeedsCheck({ minPauseMs: 3300, thresholdDb: -25.4, noiseDb: -35.4, shortestKeptMs: 3310, longestLeftOutMs: 2910, closeCalls: 0 }, 101)).toBe(true);
      expect(scanNeedsCheck({ minPauseMs: 3300, thresholdDb: -25.4, noiseDb: -35.4, shortestKeptMs: 3360, longestLeftOutMs: 3280, closeCalls: 0 }, 101)).toBe(true);
      expect(scanNeedsCheck({ minPauseMs: 3300, thresholdDb: -25.4, noiseDb: -35.4, shortestKeptMs: 3680, longestLeftOutMs: 3140, closeCalls: 0 }, 103)).toBe(true);
    });

    it('warns on each reason by itself', () => {
      expect(scanNeedsCheck({ ...semana01, closeCalls: 1 }, 97)).toBe(true);
      expect(scanNeedsCheck({ ...semana01, shortestKeptMs: 3339, longestLeftOutMs: 2940 }, 97)).toBe(true);
      expect(scanNeedsCheck({ ...semana01, shortestKeptMs: 3340, longestLeftOutMs: 2940 }, 97)).toBe(false);
      expect(scanNeedsCheck({ ...semana01, noiseDb: -39.9 }, 97)).toBe(true);
      expect(scanNeedsCheck(semana01, 9)).toBe(true);
      expect(scanNeedsCheck(semana01, 10)).toBe(false);
    });

    it('skips the margin when a side is unknown', () => {
      expect(scanNeedsCheck({ ...semana01, longestLeftOutMs: null }, 97)).toBe(false);
      expect(scanNeedsCheck({ ...semana01, shortestKeptMs: null }, 97)).toBe(false);
    });

    it('never warns when nothing was found or nothing was scanned', () => {
      expect(scanNeedsCheck({ ...semana01, closeCalls: 3, noiseDb: -20 }, 0)).toBe(false);
      expect(scanNeedsCheck(null, 97)).toBe(false);
      expect(scanNeedsCheck(undefined, 97)).toBe(false);
    });
  });

  describe('clampLabSettings', () => {
    const defaults = { minAnsweredPct: 75, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false };

    it('reads missing settings as the defaults', () => {
      expect(clampLabSettings(null)).toEqual(defaults);
      expect(clampLabSettings({})).toEqual(defaults);
      expect(clampLabSettings({ minAnsweredPct: null, voicePerPauseMs: Number.NaN, gateMarginDb: null, holdOutsideVoice: null }))
        .toEqual(defaults);
      // A v1.15 row: no margin and no hold.
      expect(clampLabSettings({ minAnsweredPct: 0, voicePerPauseMs: 250 })).toEqual({ ...defaults, minAnsweredPct: 0 });
    });

    it('keeps 0% (the rule off) and clamps the rest into range', () => {
      expect(clampLabSettings({ minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: true }))
        .toEqual({ minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: true });
      expect(clampLabSettings({ minAnsweredPct: -5, voicePerPauseMs: 100, gateMarginDb: 1 }))
        .toEqual({ ...defaults, minAnsweredPct: 0, voicePerPauseMs: 200, gateMarginDb: 4 });
      expect(clampLabSettings({ minAnsweredPct: 140, voicePerPauseMs: 9000, gateMarginDb: 30 }))
        .toEqual({ ...defaults, minAnsweredPct: 100, voicePerPauseMs: 2000, gateMarginDb: 12 });
      expect(clampLabSettings({ minAnsweredPct: 72.6, voicePerPauseMs: 333.3, gateMarginDb: 7.5 }))
        .toEqual({ ...defaults, minAnsweredPct: 73, voicePerPauseMs: 333, gateMarginDb: 8 });
    });

    it('takes the widened floor range: 0.2 s is allowed, anything shorter reads as 0.2 s', () => {
      expect(clampLabSettings({ voicePerPauseMs: 200 }).voicePerPauseMs).toBe(200);
      expect(clampLabSettings({ voicePerPauseMs: 199 }).voicePerPauseMs).toBe(200);
      expect(clampLabSettings({ voicePerPauseMs: 249 }).voicePerPauseMs).toBe(249);
    });

    it('holds labs with voice outside the pauses only when told to', () => {
      expect(clampLabSettings({ holdOutsideVoice: true }).holdOutsideVoice).toBe(true);
      expect(clampLabSettings({ holdOutsideVoice: false }).holdOutsideVoice).toBe(false);
      // SQLite's 1 is read by drizzle as true before it gets here; anything else is off.
      expect(clampLabSettings({ holdOutsideVoice: 1 as unknown as boolean }).holdOutsideVoice).toBe(false);
    });
  });

  describe('parsePauseList and parseLabRules', () => {
    const rules: LabRules = { v: 1, pauses: [[10_000, 13_600], [20_000, 23_600]], pct: 75, floor: 250, requiredThroughMs: 660_000 };

    it('reads a stored pause list, and null for none or something else', () => {
      expect(parsePauseList('[[10000,13600],[20000,23600]]')).toEqual([[10_000, 13_600], [20_000, 23_600]]);
      expect(parsePauseList('[]')).toEqual([]);
      expect(parsePauseList(null)).toBeNull();
      expect(parsePauseList(undefined)).toBeNull();
      expect(parsePauseList('not json')).toBeNull();
      expect(parsePauseList('{"a":1}')).toBeNull();
      expect(parsePauseList('[[1,2,3]]')).toBeNull();
      expect(parsePauseList('[["1",2]]')).toBeNull();
    });

    it('reads the rules a session began with', () => {
      expect(parseLabRules(JSON.stringify(rules))).toEqual(rules);
      const unscanned = { ...rules, pauses: null };
      expect(parseLabRules(JSON.stringify(unscanned))).toEqual(unscanned);
    });

    it('reads the optional v1.16.0 fields when they are there, still as version 1', () => {
      const withMeter: LabRules = { ...rules, gateMarginDb: 8, holdOutsideVoice: true };
      expect(parseLabRules(JSON.stringify(withMeter))).toEqual(withMeter);
      expect(parseLabRules(JSON.stringify({ ...rules, gateMarginDb: 4, holdOutsideVoice: false })))
        .toEqual({ ...rules, gateMarginDb: 4, holdOutsideVoice: false });
      expect(parseLabRules(JSON.stringify({ ...rules, gateMarginDb: 12 }))).toEqual({ ...rules, gateMarginDb: 12 });
      // Rules written before v1.16.0 have neither, and read without them (the page uses the default margin).
      const old = parseLabRules(JSON.stringify(rules))!;
      expect(old).not.toHaveProperty('gateMarginDb');
      expect(old).not.toHaveProperty('holdOutsideVoice');
    });

    it('ignores unreadable optional fields instead of dropping the rules', () => {
      for (const gateMarginDb of [3.9, 12.1, -6, '6', null, true, [6]]) {
        const read = parseLabRules(JSON.stringify({ ...rules, gateMarginDb, holdOutsideVoice: true }));
        expect(read).toEqual({ ...rules, holdOutsideVoice: true });
        expect(read).not.toHaveProperty('gateMarginDb');
      }
      for (const holdOutsideVoice of [1, 0, 'true', null, {}]) {
        const read = parseLabRules(JSON.stringify({ ...rules, gateMarginDb: 6, holdOutsideVoice }));
        expect(read).toEqual({ ...rules, gateMarginDb: 6 });
        expect(read).not.toHaveProperty('holdOutsideVoice');
      }
      // Unscanned sessions keep them too.
      expect(parseLabRules(JSON.stringify({ ...rules, pauses: null, gateMarginDb: 10 })))
        .toEqual({ ...rules, pauses: null, gateMarginDb: 10 });
    });

    it('reads the exam set an exam session was opened under (v1.19.0), and drops one that is not a stored set name', () => {
      const exam: LabRules = { ...rules, pauses: null, pct: 0, gateMarginDb: 6, holdOutsideVoice: false, exam: 'U3' };
      expect(parseLabRules(JSON.stringify(exam))).toEqual(exam);
      expect(parseLabRules(JSON.stringify({ ...rules, exam: 'Unidad 3 final' }))).toEqual({ ...rules, exam: 'Unidad 3 final' });
      for (const bad of ['', ' U3', 'U3 ', 'U  3', 'x'.repeat(41), 3, null, true, ['U3'], { set: 'U3' }]) {
        const read = parseLabRules(JSON.stringify({ ...rules, exam: bad }));
        // Never a reason for null: the session reads as practice.
        expect(read).toEqual(rules);
        expect(read).not.toHaveProperty('exam');
      }
      // Rules written before v1.19.0 have none, and read exactly as before.
      expect(parseLabRules(JSON.stringify(rules))).not.toHaveProperty('exam');
      // An exam set never rescues rules of another version.
      expect(parseLabRules(JSON.stringify({ ...exam, v: 2 }))).toBeNull();
    });

    it('reads no rules (null) for a session opened before them, or anything that is not version-1 rules', () => {
      expect(parseLabRules(null)).toBeNull();
      expect(parseLabRules('')).toBeNull();
      expect(parseLabRules('null')).toBeNull();
      expect(parseLabRules('[]')).toBeNull();
      expect(parseLabRules(JSON.stringify({ ...rules, v: 2 }))).toBeNull();
      expect(parseLabRules(JSON.stringify({ ...rules, pct: '75' }))).toBeNull();
      expect(parseLabRules(JSON.stringify({ ...rules, pauses: undefined }))).toBeNull();
      expect(parseLabRules(JSON.stringify({ ...rules, pauses: [[1, 'x']] }))).toBeNull();
      expect(parseLabRules(JSON.stringify({ v: 1, pauses: null, pct: 75, floor: 250 }))).toBeNull();
      // The new fields never rescue rules of another version.
      expect(parseLabRules(JSON.stringify({ ...rules, v: 2, gateMarginDb: 6, holdOutsideVoice: false }))).toBeNull();
    });

    it('keeps a session\'s rules small enough for its open row (about 1.6 KB for 100 pauses)', () => {
      const text = JSON.stringify({ ...rules, pauses: pausesEvery8s(100).map(([s, e]) => [s + 123_456, e + 123_456]) });
      expect(text.length).toBeLessThan(2000);
    });
  });

  describe('lab mic stats', () => {
    const stats: LabMicStats = {
      meter: 2,
      ambientDbP50: -52.3,
      gateDbP50: -46.3,
      voiceOverGateDbP50: 14.2,
      levelOnlyAnswered: 87,
      loudNotVoiceInPausesMs: 1250,
      unfocusedPlayedMs: 130_000,
      micCheck: 'voice',
      processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48_000 },
    };

    it('accepts what the page sends and rebuilds it from the known fields', () => {
      expect(validateLabMicStats(stats)).toEqual({ ok: true, stats });
      // Unknown fields, at the top or in processing (a device id), are not kept.
      const extra = { ...stats, note: 'x'.repeat(10_000), processing: { ...stats.processing, deviceId: 'abc', groupId: 'def', channelCount: 1 } };
      expect(validateLabMicStats(extra)).toEqual({ ok: true, stats });
      // Nulls where the type allows them: nothing measured, no pause list, no voice, no mic check, no settings.
      const empty: LabMicStats = {
        meter: 2, ambientDbP50: null, gateDbP50: null, voiceOverGateDbP50: null, levelOnlyAnswered: null,
        loudNotVoiceInPausesMs: 0, unfocusedPlayedMs: 0, micCheck: null, processing: null,
      };
      expect(validateLabMicStats(empty)).toEqual({ ok: true, stats: empty });
      expect(validateLabMicStats({ ...stats, micCheck: 'level', processing: {} })).toEqual({ ok: true, stats: { ...stats, micCheck: 'level', processing: {} } });
    });

    it('rounds levels to 0.1 dB and counts and times to whole numbers', () => {
      const result = validateLabMicStats({
        ...stats, ambientDbP50: -52.349, gateDbP50: -0.04, voiceOverGateDbP50: 14.25, levelOnlyAnswered: 86.6,
        loudNotVoiceInPausesMs: 1250.4, unfocusedPlayedMs: 0.3, processing: { sampleRate: 44_100.2 },
      });
      expect(result).toEqual({ ok: true, stats: {
        ...stats, ambientDbP50: -52.3, gateDbP50: 0, voiceOverGateDbP50: 14.3, levelOnlyAnswered: 87,
        loudNotVoiceInPausesMs: 1250, unfocusedPlayedMs: 0, processing: { sampleRate: 44_100 },
      } });
      // Never a negative zero in the stored JSON.
      expect(Object.is((result as { stats: LabMicStats }).stats.gateDbP50, 0)).toBe(true);
    });

    it('takes every limit, both ends included', () => {
      const numbers = Object.keys(LAB_MIC_STATS_LIMITS).filter((f) => f !== 'sampleRate') as (keyof typeof LAB_MIC_STATS_LIMITS)[];
      for (const field of numbers) {
        const [min, max] = LAB_MIC_STATS_LIMITS[field];
        expect(validateLabMicStats({ ...stats, [field]: min })).toMatchObject({ ok: true, stats: { [field]: min } });
        expect(validateLabMicStats({ ...stats, [field]: max })).toMatchObject({ ok: true, stats: { [field]: max } });
      }
      expect(LAB_MIC_STATS_LIMITS.levelOnlyAnswered).toEqual([0, MAX_PAUSES_PER_LAB]);
      expect(LAB_MIC_STATS_LIMITS.unfocusedPlayedMs).toEqual([0, 86_400_000]);
    });

    it('refuses a number out of bounds, not finite, of the wrong type or missing, and names it', () => {
      const cases: [keyof LabMicStats, unknown][] = [
        ['ambientDbP50', -200.1], ['ambientDbP50', 20.1], ['gateDbP50', 40.5], ['gateDbP50', -1e9],
        ['voiceOverGateDbP50', 100.1], ['voiceOverGateDbP50', -101],
        ['levelOnlyAnswered', -1], ['levelOnlyAnswered', MAX_PAUSES_PER_LAB + 1], ['levelOnlyAnswered', '87'],
        ['loudNotVoiceInPausesMs', -0.1], ['loudNotVoiceInPausesMs', 86_400_001], ['loudNotVoiceInPausesMs', null],
        ['unfocusedPlayedMs', Number.POSITIVE_INFINITY], ['unfocusedPlayedMs', Number.NaN], ['unfocusedPlayedMs', undefined],
        ['ambientDbP50', undefined], ['ambientDbP50', Number.NEGATIVE_INFINITY], ['gateDbP50', true],
      ];
      for (const [field, value] of cases) {
        expect(validateLabMicStats({ ...stats, [field]: value })).toEqual({ ok: false, field });
      }
      const withoutCount: Partial<LabMicStats> = { ...stats };
      delete withoutCount.levelOnlyAnswered;
      expect(validateLabMicStats(withoutCount)).toEqual({ ok: false, field: 'levelOnlyAnswered' });
    });

    it('refuses another meter, an unknown mic check and processing that is not an object', () => {
      for (const meter of [1, 3, '2', undefined]) expect(validateLabMicStats({ ...stats, meter })).toEqual({ ok: false, field: 'meter' });
      for (const micCheck of ['loud', '', undefined, 1]) expect(validateLabMicStats({ ...stats, micCheck })).toEqual({ ok: false, field: 'micCheck' });
      for (const processing of ['on', [true], undefined, 1]) expect(validateLabMicStats({ ...stats, processing })).toEqual({ ok: false, field: 'processing' });
      for (const value of [null, undefined, 'stats', 2, [stats]]) expect(validateLabMicStats(value)).toEqual({ ok: false, field: null });
    });

    it('leaves out processing entries of an unexpected type, since they are the browser\'s own report', () => {
      expect(validateLabMicStats({
        ...stats,
        processing: { echoCancellation: 'all', noiseSuppression: 1, autoGainControl: false, voiceIsolation: true, sampleRate: 1_000_000 },
      })).toEqual({ ok: true, stats: { ...stats, processing: { autoGainControl: false, voiceIsolation: true } } });
      expect(validateLabMicStats({ ...stats, processing: { sampleRate: 2999 } })).toEqual({ ok: true, stats: { ...stats, processing: {} } });
    });

    it('reads stored stats back, and null for none or anything unreadable', () => {
      expect(parseLabMicStats(JSON.stringify(stats))).toEqual(stats);
      expect(parseLabMicStats(null)).toBeNull();
      expect(parseLabMicStats(undefined)).toBeNull();
      expect(parseLabMicStats('')).toBeNull();
      expect(parseLabMicStats('not json')).toBeNull();
      expect(parseLabMicStats(JSON.stringify({ ...stats, meter: 3 }))).toBeNull();
      expect(parseLabMicStats(JSON.stringify({ ...stats, unfocusedPlayedMs: -5 }))).toBeNull();
    });

    it('keeps a row\'s stats small (under 400 bytes)', () => {
      const widest = clampLabMicStats({
        ambientDbP50: -123.45, gateDbP50: -117.45, voiceOverGateDbP50: -99.99, levelOnlyAnswered: 400,
        loudNotVoiceInPausesMs: 86_400_000, unfocusedPlayedMs: 86_400_000, micCheck: 'level',
        processing: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, voiceIsolation: false, sampleRate: 768_000 },
      });
      expect(JSON.stringify(widest).length).toBeLessThan(400);
    });

    describe('clampLabMicStats', () => {
      it('passes good measurements through, and its output always validates', () => {
        expect(clampLabMicStats(stats)).toEqual(stats);
        const odd = clampLabMicStats({
          ambientDbP50: Number.NEGATIVE_INFINITY, gateDbP50: 55, voiceOverGateDbP50: Number.NaN, levelOnlyAnswered: 9999,
          loudNotVoiceInPausesMs: -40, unfocusedPlayedMs: Number.POSITIVE_INFINITY, micCheck: 'loud' as never,
          processing: { echoCancellation: 'remote-only', sampleRate: 48_000.4, deviceId: 'abc' } as never,
        });
        expect(odd).toEqual({
          meter: 2, ambientDbP50: -200, gateDbP50: 40, voiceOverGateDbP50: null, levelOnlyAnswered: MAX_PAUSES_PER_LAB,
          loudNotVoiceInPausesMs: 0, unfocusedPlayedMs: 86_400_000, micCheck: null, processing: { sampleRate: 48_000 },
        });
        expect(validateLabMicStats(odd)).toEqual({ ok: true, stats: odd });
      });

      it('reads missing values as null, or 0 where null is not allowed', () => {
        const empty = clampLabMicStats({});
        expect(empty).toEqual({
          meter: 2, ambientDbP50: null, gateDbP50: null, voiceOverGateDbP50: null, levelOnlyAnswered: null,
          loudNotVoiceInPausesMs: 0, unfocusedPlayedMs: 0, micCheck: null, processing: null,
        });
        expect(validateLabMicStats(empty)).toEqual({ ok: true, stats: empty });
        expect(clampLabMicStats({ loudNotVoiceInPausesMs: null, unfocusedPlayedMs: Number.NaN })).toMatchObject({ loudNotVoiceInPausesMs: 0, unfocusedPlayedMs: 0 });
      });

      it('reads echo cancellation reported as \'all\' as on', () => {
        expect(clampLabMicStats({ processing: { echoCancellation: 'all', autoGainControl: true } }).processing)
          .toEqual({ echoCancellation: true, autoGainControl: true });
      });
    });
  });
});
