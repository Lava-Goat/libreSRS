// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { LEGACY_SESSION_MAX_AGE_MS, MAX_LOG_LEAD_MS, pauseWindow, pauseWindowMs, type LabPause, type PauseAnswer } from '@libresrs/shared';
import {
  CONFLICTED_RESULT,
  MAX_RESULTS_PER_PAUSE,
  NOISY_HOLD_MIN_OUTSIDE_RATE,
  answeredMedianMs,
  logLeadMs,
  parseAnswers,
  pauseSoundFlags,
  pauseVoiceOutrunsTotal,
  resultBudget,
  scorePauses,
  sessionRule,
  shortAnswerRows,
  voiceOutsideThePauses,
  voiceRates,
  type ScoredEvent,
} from './labPauses.js';

/** The session's signed start (server clock). */
const T0 = 1_790_000_000_000;
/** Mic check and instructions before the audio starts, on the page's clock. */
const SETUP = 30_000;
/** Ten answer pauses, 4 s each, every 30 s from 0:20: windows of 3.6 s. */
const PAUSES: LabPause[] = Array.from({ length: 10 }, (_, i) => [20_000 + i * 30_000, 24_000 + i * 30_000]);
const WINDOW = pauseWindowMs(PAUSES[0]);
const END = 310_000;
const FLOOR = 250;

type Voice = (pause: LabPause, index: number) => number | null;

/**
 * An honest page: play at 0, a tick every 5 s, each on time (50 ms of
 * latency); each pause's result rides on the first tick after its window ends.
 */
function honest({
  from = 0,
  to = END,
  voice = () => 1000,
  clientStart = SETUP,
  delay = 50,
  pauses = PAUSES,
}: { from?: number; to?: number; voice?: Voice; clientStart?: number; delay?: number; pauses?: LabPause[] } = {}): ScoredEvent[] {
  const events: ScoredEvent[] = [];
  for (let p = from; p <= to; p += 5000) {
    const clientMs = clientStart + (p - from);
    const answers = pauses
      .map((pause, i) => ({ pause, i }))
      .filter(({ pause }) => pause[1] - 100 <= p && pause[1] - 100 > p - 5000)
      .map(({ pause, i }) => [pause[0], voice(pause, i)] as [number, number | null])
      .filter((a): a is [number, number] => a[1] !== null);
    events.push({
      kind: p === from ? 'play' : 'tick',
      positionMs: p,
      clientMs,
      at: T0 + clientMs + delay,
      answers: answers.length > 0 ? JSON.stringify(answers) : null,
    });
  }
  return events;
}

const score = (events: ScoredEvent[], pauses: LabPause[] = PAUSES, floorMs = FLOOR) =>
  scorePauses({ pauses, events, sessionStartedAt: T0, floorMs });

describe('scorePauses', () => {
  it('answers every pause of an honest log, results on the next tick', () => {
    const result = score(honest());
    expect(result).toMatchObject({ answered: 10, rejected: 0, late: 0 });
    expect(result.results).toEqual(PAUSES.map(([s]) => [s, 1000]));
    expect(result.accepted).toEqual(Array(10).fill(1000));
    expect(result.leadMs).toBeLessThan(100);
  });

  it('reports -1 for a pause with no result, and 0 for one heard silent', () => {
    const result = score(honest({ voice: (_p, i) => (i === 0 ? null : i === 1 ? 0 : 900) }));
    expect(result.results.slice(0, 3)).toEqual([[PAUSES[0][0], -1], [PAUSES[1][0], 0], [PAUSES[2][0], 900]]);
    expect(result.answered).toBe(8);
    expect(result.accepted).toHaveLength(9);
  });

  it('accepts Pause and Resume inside a pause, with voice while paused', () => {
    // Plays to 0:21.5 (inside the first window), pauses for 8 s, resumes.
    const events: ScoredEvent[] = [
      { kind: 'play', positionMs: 0, clientMs: SETUP, at: T0 + SETUP + 50 },
      { kind: 'tick', positionMs: 5000, clientMs: SETUP + 5000, at: T0 + SETUP + 5050 },
      { kind: 'tick', positionMs: 10_000, clientMs: SETUP + 10_000, at: T0 + SETUP + 10_050 },
      { kind: 'tick', positionMs: 15_000, clientMs: SETUP + 15_000, at: T0 + SETUP + 15_050 },
      { kind: 'tick', positionMs: 20_000, clientMs: SETUP + 20_000, at: T0 + SETUP + 20_050 },
      { kind: 'pause', positionMs: 21_500, clientMs: SETUP + 21_500, at: T0 + SETUP + 21_550 },
      { kind: 'play', positionMs: 21_500, clientMs: SETUP + 29_500, at: T0 + SETUP + 29_550 },
      { kind: 'tick', positionMs: 26_500, clientMs: SETUP + 34_500, at: T0 + SETUP + 34_550, answers: [[20_000, WINDOW]] },
    ];
    expect(score(events)).toMatchObject({ answered: 1, rejected: 0, late: 0 });
    expect(score(events).results[0]).toEqual([20_000, WINDOW]);
  });

  it('accepts Back 10 s: the tick before the seek carries what was finished, the replay can improve it', () => {
    const at = (clientMs: number) => T0 + clientMs + 50;
    const events: ScoredEvent[] = [
      ...honest({ to: 25_000 }).map((e) => ({ ...e, answers: null })),
      // Back 10 s at 0:27: the pre-seek tick carries the first pause's result.
      { kind: 'tick', positionMs: 27_000, clientMs: SETUP + 27_000, at: at(SETUP + 27_000), answers: [[20_000, 400]] },
      { kind: 'seek', positionMs: 17_000, clientMs: SETUP + 27_100, at: at(SETUP + 27_100) },
      { kind: 'tick', positionMs: 22_000, clientMs: SETUP + 32_100, at: at(SETUP + 32_100) },
      { kind: 'tick', positionMs: 27_000, clientMs: SETUP + 37_100, at: at(SETUP + 37_100), answers: [[20_000, 1500]] },
    ];
    const result = score(events);
    expect(result).toMatchObject({ rejected: 0, late: 0, answered: 1 });
    expect(result.results[0]).toEqual([20_000, 1500]);
  });

  it('accepts a result on a play entry right after a resume in the same run, not on a seek that starts a run', () => {
    const base = honest({ to: 25_000 }).map((e) => ({ ...e, answers: null }));
    const resumed = [
      ...base,
      { kind: 'pause' as const, positionMs: 26_000, clientMs: SETUP + 26_000, at: T0 + SETUP + 26_050 },
      { kind: 'play' as const, positionMs: 26_000, clientMs: SETUP + 40_000, at: T0 + SETUP + 40_050, answers: [[20_000, 800]] },
    ];
    expect(score(resumed)).toMatchObject({ answered: 1, rejected: 0 });

    const seeked = [
      ...base,
      { kind: 'seek' as const, positionMs: 60_000, clientMs: SETUP + 26_000, at: T0 + SETUP + 26_050, answers: [[20_000, 800]] },
    ];
    expect(score(seeked)).toMatchObject({ answered: 0, rejected: 1 });
  });

  it('rejects voice over the window, and caps what fits at the window', () => {
    expect(score(honest({ voice: (_p, i) => (i === 0 ? WINDOW + 251 : 1000) }))).toMatchObject({ answered: 9, rejected: 1 });
    const fits = score(honest({ voice: (_p, i) => (i === 0 ? WINDOW + 250 : 1000) }));
    expect(fits).toMatchObject({ answered: 10, rejected: 0 });
    expect(fits.results[0]).toEqual([PAUSES[0][0], WINDOW]);
  });

  it('rejects a pause that was not played through: the log skips across it', () => {
    // Plays to 0:18, then 0:25 a second later (a skip), then on.
    const events = honest().filter((e) => e.positionMs <= 15_000 || e.positionMs >= 25_000);
    const skipped = [
      ...events.filter((e) => e.positionMs <= 15_000),
      { kind: 'tick' as const, positionMs: 18_000, clientMs: SETUP + 18_000, at: T0 + SETUP + 18_050 },
      ...events.filter((e) => e.positionMs >= 25_000).map((e) => ({ ...e, clientMs: e.clientMs - 6000, at: e.at - 6000 })),
    ];
    const result = score(skipped);
    expect(result.results[0]).toEqual([PAUSES[0][0], -1]);
    expect(result).toMatchObject({ answered: 9, rejected: 1 });
  });

  it('rejects a result reported 30 s of audio after its pause', () => {
    const withResultAt = (positionMs: number) => {
      const events = honest().map((e) => ({ ...e, answers: null as string | null }));
      events.find((e) => e.positionMs === positionMs)!.answers = JSON.stringify([[PAUSES[0][0], 1000]]);
      return score(events);
    };
    // The pause ends at 0:24: 0:55 is 31 s later; 0:35 is within the 15 s allowed.
    expect(withResultAt(55_000)).toMatchObject({ answered: 0, rejected: 1 });
    expect(withResultAt(35_000)).toMatchObject({ answered: 1, rejected: 0 });
    // A report before the window has ended cannot carry its result.
    expect(withResultAt(20_000)).toMatchObject({ answered: 0, rejected: 1 });
  });

  it('rejects the reverse-order replay: seeking back to each pause at the end', () => {
    // A silent full pass, then for each pause (last first) a seek to its start
    // and a report just after its end, sent a moment later.
    const events: ScoredEvent[] = honest().map((e) => ({ ...e, answers: null }));
    let clientMs = SETUP + END + 1000;
    for (const [s, e] of [...PAUSES].reverse()) {
      events.push({ kind: 'seek', positionMs: s, clientMs, at: T0 + clientMs + 50 });
      clientMs += 200;
      events.push({ kind: 'tick', positionMs: e + 500, clientMs, at: T0 + clientMs + 50, answers: [[s, 1500]] });
      clientMs += 200;
    }
    expect(score(events)).toMatchObject({ answered: 0, rejected: 10, late: 0 });
  });

  it('counts nothing from a log sent in one burst after the fact: every result is late', () => {
    // 15 minutes of ticks and results, all delivered at once 16 minutes after the session began.
    const pauses: LabPause[] = Array.from({ length: 30 }, (_, i) => [20_000 + i * 30_000, 24_000 + i * 30_000]);
    const burstAt = T0 + 16 * 60_000;
    const events = honest({ to: 900_000, pauses }).map((e, i) => ({ ...e, at: burstAt + i }));
    expect(events).toHaveLength(181);
    const result = score(events, pauses);
    expect(result).toMatchObject({ answered: 0, late: 30, rejected: 0 });
    expect(result.leadMs).toBeGreaterThan(850_000);
    expect(logLeadMs(events, T0)).toBe(result.leadMs);
  });

  it('counts nothing from a burst that walks forward in small seeks: a seek is played audio too, or a jump', () => {
    // Wait out the lab, then send it all at once: the first 2 minutes as ticks, then +300 ms seeks
    // with a 1 ms tick after every third, each pause's full-window result on the tick after it.
    const burstAt = T0 + SETUP + END + 5000;
    const walk = (seekMs: number, seeksPerStep: number) => {
      const events: ScoredEvent[] = [{ kind: 'play', positionMs: 0, clientMs: SETUP, at: burstAt }];
      const sent = new Set<number>();
      let pos = 0;
      let clientMs = SETUP;
      while (pos < END) {
        for (let k = 0; k < seeksPerStep; k++) {
          pos += seekMs;
          clientMs += 1;
          events.push({ kind: 'seek', positionMs: pos, clientMs, at: burstAt });
        }
        pos += pos < 120_000 ? 1500 : 1;
        clientMs += 1;
        const due = PAUSES.filter(([s, e]) => !sent.has(s) && e - 100 <= pos && pos <= e + 15_000);
        due.forEach(([s]) => sent.add(s));
        events.push({ kind: 'tick', positionMs: pos, clientMs, at: burstAt, answers: due.length > 0 ? due.map(([s]) => [s, WINDOW]) : null });
      }
      return events;
    };
    // Seeks past 50 ms start a new run each: nothing is played through.
    expect(score(walk(300, 3))).toMatchObject({ answered: 0, late: 0, rejected: 10 });
    // Smaller seeks stay in the run until they have run 1.5 s ahead of the page clock, and count as
    // audio played: the burst is late.
    const small = score(walk(50, 18));
    expect(small).toMatchObject({ answered: 0, late: 10, rejected: 0 });
    expect(small.leadMs).toBeGreaterThan(MAX_LOG_LEAD_MS);
  });

  it('keeps a pass through a Chromebook stall whole when the page waits for the position to catch up before its tick', () => {
    // Playback reaches 0:21 (inside the first window), the page freezes for 2.5 s while the audio
    // plays on, and its position reads late for a moment after. The page holds its next tick until
    // the position has caught up (LabRunner), so the log shows continuous playback.
    const events = honest().filter((e) => e.positionMs <= 20_000 || e.positionMs >= 30_000).map((e) => ({ ...e, answers: null as string | null }));
    events.push({ kind: 'tick', positionMs: 25_300, clientMs: SETUP + 25_300, at: T0 + SETUP + 25_350, answers: JSON.stringify([[PAUSES[0][0], 900]]) });
    expect(score(events)).toMatchObject({ answered: 1, rejected: 0, late: 0 });

    // A tick sent with the stale reading instead: the catch-up after it looks like a skip, so the
    // server splits the run and the pause is refused. That is why the page must never send one.
    const stale = [...events.filter((e) => e.positionMs !== 25_300),
      { kind: 'tick' as const, positionMs: 22_000, clientMs: SETUP + 25_000, at: T0 + SETUP + 25_050, answers: null },
      { kind: 'tick' as const, positionMs: 25_300, clientMs: SETUP + 25_300, at: T0 + SETUP + 25_350, answers: JSON.stringify([[PAUSES[0][0], 900]]) },
    ];
    expect(score(stale)).toMatchObject({ answered: 0, rejected: 1 });
  });

  it('never lets a walk cover a pause in steps that each fit the skip slack, even after time paused', () => {
    // Played to 0:15, then 1.5 s of audio a millisecond, up to past the first pause, with its result.
    const walk = (fromClientMs: number): ScoredEvent[] => Array.from({ length: 7 }, (_, k) => {
      const positionMs = 15_000 + 1499 * (k + 1);
      const clientMs = fromClientMs + k + 1;
      return { kind: 'tick', positionMs, clientMs, at: T0 + clientMs + 50, answers: k === 6 ? [[20_000, 1500]] : null };
    });
    const start = honest({ to: 15_000 }).map((e) => ({ ...e, answers: null }));
    expect(score([...start, ...walk(SETUP + 15_000)])).toMatchObject({ answered: 0, rejected: 1 });
    // A minute paused first is not time the audio can make up.
    const paused: ScoredEvent[] = [
      ...start,
      { kind: 'pause', positionMs: 15_000, clientMs: SETUP + 15_000, at: T0 + SETUP + 15_050 },
      { kind: 'play', positionMs: 15_000, clientMs: SETUP + 75_000, at: T0 + SETUP + 75_050 },
    ];
    expect(score([...paused, ...walk(SETUP + 75_000)])).toMatchObject({ answered: 0, rejected: 1 });
  });

  it('leaves out results for pauses that stopped counting mid-session, neither counted nor rejected', () => {
    // The session began with ten counted pauses; the teacher then moved must-hear-through to 3:10.
    const rule = sessionRule({
      rulesText: JSON.stringify({ v: 1, pauses: PAUSES, pct: 75, floor: FLOOR, requiredThroughMs: END }),
      requiredThroughMs: 190_000, startedAtMs: T0, nowMs: T0 + 400_000, current: { minAnsweredPct: 75, voicePerPauseMs: FLOOR },
    });
    if (rule.rule !== 'scored') throw new Error('expected a scored session');
    expect(rule.pauses).toHaveLength(6);
    const result = scorePauses({ pauses: rule.pauses, ignored: rule.dropped, events: honest(), sessionStartedAt: T0, floorMs: FLOOR });
    expect(result).toMatchObject({ answered: 6, rejected: 0, late: 0 });
    // Without being told, the page's honest results for the other four would look odd.
    expect(scorePauses({ pauses: rule.pauses, events: honest(), sessionStartedAt: T0, floorMs: FLOOR }).rejected).toBe(4);
  });

  it('accepts a 30 s outage whose queued reports arrive together', () => {
    const events = honest();
    // The reports for 1:40–2:10 are held and arrive at 2:12.
    const held = events.filter((e) => e.positionMs >= 100_000 && e.positionMs <= 130_000);
    const arrival = T0 + SETUP + 132_000;
    for (const e of held) e.at = arrival;
    expect(score(events)).toMatchObject({ answered: 10, rejected: 0, late: 0 });
  });

  it('accepts 90 s of offline playback delivered at once; 150 s makes results late', () => {
    const offline = (seconds: number) => {
      const pauses: LabPause[] = Array.from({ length: 20 }, (_, i) => [20_000 + i * 30_000, 24_000 + i * 30_000]);
      const events = honest({ to: 620_000, pauses });
      const from = 200_000;
      const to = from + seconds * 1000;
      // Played on while offline, then paused itself; the queue arrives 10 s after the last report.
      const arrival = T0 + SETUP + to + 10_000;
      for (const e of events) if (e.positionMs > from && e.positionMs <= to) e.at = arrival;
      // After the wait the student resumed: everything later is 10 s behind.
      for (const e of events) {
        if (e.positionMs > to) {
          e.clientMs += 10_000;
          e.at += 10_000;
        }
      }
      return score(events, pauses);
    };
    expect(offline(90)).toMatchObject({ answered: 20, late: 0, rejected: 0 });
    const tooLong = offline(150);
    expect(tooLong.late).toBeGreaterThan(0);
    expect(tooLong.answered).toBe(20 - tooLong.late);
    expect(tooLong.leadMs).toBeGreaterThan(120_000);
  });

  it('accepts a 20-minute gap in server time while paused (a laptop asleep)', () => {
    const events = honest();
    const sleep = 20 * 60_000;
    for (const e of events) {
      if (e.positionMs >= 150_000) {
        e.clientMs += sleep;
        e.at += sleep;
      }
    }
    const pauseAt = events.find((e) => e.positionMs === 145_000)!;
    events.push({ kind: 'pause', positionMs: 147_000, clientMs: pauseAt.clientMs + 2000, at: pauseAt.at + 2000 });
    events.push({ kind: 'play', positionMs: 147_000, clientMs: pauseAt.clientMs + 2000 + sleep, at: pauseAt.at + 2000 + sleep });
    expect(score(events)).toMatchObject({ answered: 10, rejected: 0, late: 0 });
  });

  it('rejects results on entries whose page clock ran ahead of the server, and unknown pause starts', () => {
    const events = honest();
    // The page claims more time than the server saw pass.
    const fast = events.find((e) => e.positionMs === PAUSES[0][1] + 1000)!;
    fast.at = T0 + fast.clientMs - 6000;
    const result = score(events);
    expect(result.results[0]).toEqual([PAUSES[0][0], -1]);
    expect(result).toMatchObject({ answered: 9, rejected: 1 });

    const unknown = honest();
    unknown[10].answers = JSON.stringify([[20_001, 1000], [99_000, 1000]]);
    expect(score(unknown)).toMatchObject({ rejected: 2, answered: 10 });
  });

  it('counts a pause at exactly the floor, not a millisecond under', () => {
    expect(score(honest({ voice: () => 400 }), PAUSES, 400).answered).toBe(10);
    expect(score(honest({ voice: () => 399 }), PAUSES, 400).answered).toBe(0);
  });

  it('examines at most four results per pause and 4 × counted + 50 per session', () => {
    // Four playbacks of the first pause (Back 10 s after each), one result each: all four examined, the best kept.
    const at = (clientMs: number) => T0 + clientMs + 50;
    const replays: ScoredEvent[] = honest({ to: 15_000 }).map((e) => ({ ...e, answers: null }));
    let clientMs = SETUP + 15_000;
    let pos = 15_000;
    for (let pass = 1; pass <= 6; pass++) {
      for (const next of [20_000, 25_000]) {
        clientMs += next - pos;
        pos = next;
        replays.push({ kind: 'tick', positionMs: pos, clientMs, at: at(clientMs), answers: next === 25_000 ? [[20_000, 100 * pass]] : null });
      }
      clientMs += 100;
      pos = 15_000;
      replays.push({ kind: 'seek', positionMs: pos, clientMs, at: at(clientMs) });
    }
    const perPause = score(replays);
    expect(perPause).toMatchObject({ rejected: 6 - MAX_RESULTS_PER_PAUSE, conflicts: 0 });
    // The best of the first four examined.
    expect(perPause.results[0]).toEqual([20_000, 400]);

    const flood = honest();
    // 100 unknown results before the real ones use up the budget of 90.
    flood[1].answers = JSON.stringify(Array.from({ length: 100 }, (_, i) => [1 + i, 100]));
    const capped = score(flood);
    expect(resultBudget(10)).toBe(90);
    expect(capped).toMatchObject({ answered: 0, rejected: 110, conflicts: 0 });
    expect(capped.results.every(([, v]) => v === -1)).toBe(true);
  });

  describe('two or more results for one pause in one playback', () => {
    /**
     * The sim's C1 script: the page hears silence and reports 0 for each pause;
     * a console script sends its own report of 1.5 s for the same pause, in the
     * same playback, with the page's session and a believable position and clock.
     */
    const forged = (offsetMs: number): ScoredEvent[] => PAUSES.map(([s, e]) => {
      const positionMs = e + offsetMs;
      const clientMs = SETUP + positionMs;
      return { kind: 'tick', positionMs, clientMs, at: T0 + clientMs + 80, answers: [[s, 1500]] };
    });

    it('rejects them all, whichever comes first: the console script gets nothing (C1)', () => {
      // The page's own report rides on the tick at the next 5 s (1 s after each pause ends).
      for (const offset of [500, 3000]) {
        const result = score([...honest({ voice: () => 0 }), ...forged(offset)]);
        expect(result).toMatchObject({ answered: 0, conflicts: 10, rejected: 20, late: 0 });
        expect(result.results).toEqual(PAUSES.map(([s]) => [s, CONFLICTED_RESULT]));
        expect(result.accepted).toEqual([]);
      }
    });

    it('rejects two equal results too, and a group that includes one past the caps', () => {
      expect(score([...honest({ voice: () => 1500 }), ...forged(500)])).toMatchObject({ answered: 0, conflicts: 10 });
      // 100 unknown results use up the budget first: the page's result and the forged one are
      // both past it, and still meet in their group, so a flood cannot hide the page's own report.
      const events = [...honest({ voice: () => 0 }), ...forged(3000)];
      events[1].answers = JSON.stringify(Array.from({ length: 100 }, (_, i) => [1 + i, 100]));
      expect(score(events)).toMatchObject({ answered: 0, conflicts: 10 });
    });

    it('keeps what another playback of the pause got: -2 only when nothing else counted', () => {
      // Pause 1 is answered on a first pass; a Back 10 s replays it, and the script adds a second result in the replay.
      const at = (clientMs: number) => T0 + clientMs + 50;
      const events: ScoredEvent[] = [
        ...honest({ to: 25_000 }).map((e) => ({ ...e, answers: e.positionMs === 25_000 ? [[20_000, 900]] : null })),
        { kind: 'seek', positionMs: 15_000, clientMs: SETUP + 25_100, at: at(SETUP + 25_100) },
        { kind: 'tick', positionMs: 20_000, clientMs: SETUP + 30_100, at: at(SETUP + 30_100) },
        { kind: 'tick', positionMs: 25_000, clientMs: SETUP + 35_100, at: at(SETUP + 35_100), answers: [[20_000, 1200]] },
        { kind: 'tick', positionMs: 25_500, clientMs: SETUP + 35_600, at: at(SETUP + 35_600), answers: [[20_000, 3000]] },
      ];
      const result = score(events);
      expect(result).toMatchObject({ answered: 1, conflicts: 1, rejected: 2 });
      expect(result.results[0]).toEqual([20_000, 900]);
    });

    /**
     * R1 from the v1.16 review: a silent student with the microphone on hears
     * each pause twice (Back 10 s just after it), and the script sends its own
     * result 0.3 s after the replayed window, in the replay's playback. The page
     * reports [start, 0] on the first pass; on the replay it sends `replay`
     * (null: nothing, as the page did when it sent only a result that beat the
     * best one).
     */
    const replayedEachPause = (replay: number | null, script: boolean): ScoredEvent[] => {
      const events: ScoredEvent[] = [];
      let pos = 0;
      let clientMs = SETUP;
      const push = (kind: ScoredEvent['kind'], answers: PauseAnswer[] | null = null, lateMs = 50) =>
        events.push({ kind, positionMs: pos, clientMs, at: T0 + clientMs + lateMs, answers });
      const playTo = (target: number, answers: PauseAnswer[] | null = null) => {
        while (pos < target) {
          const step = Math.min(5000, target - pos);
          pos += step;
          clientMs += step;
          push('tick', pos === target ? answers : null);
        }
      };
      push('play');
      for (const [s, e] of PAUSES) {
        // The first pass: Back 10 s reports where playback reached, with the pause's 0, then seeks.
        playTo(e + 1000, [[s, 0]]);
        pos -= 10_000;
        clientMs += 5;
        push('seek');
        playTo(e + 1000, replay === null ? null : [[s, replay]]);
        if (script) {
          pos += 300;
          clientMs += 300;
          push('tick', [[s, 1500]], 80);
        }
      }
      playTo(END);
      return events;
    };

    it('rejects the script’s result in a replay too: the page sends every pass, so the replay has the page’s own (R1)', () => {
      const result = score(replayedEachPause(0, true));
      expect(result).toMatchObject({ answered: 0, conflicts: 10, rejected: 20, late: 0 });
      // The first pass of each pause still stands, at 0.
      expect(result.results).toEqual(PAUSES.map(([s]) => [s, 0]));
      // Why the page must send a pass that does not beat the best: without it, the script's stood alone.
      expect(score(replayedEachPause(null, true))).toMatchObject({ answered: 10, conflicts: 0, rejected: 0 });
      // An honest student who answers on the replay: every pause, no conflict.
      expect(score(replayedEachPause(900, false))).toMatchObject({ answered: 10, conflicts: 0, rejected: 0 });
    });

    it('rejects it after a whole silent pass of the lab, rewound to the start and heard again (R1, “listen twice”)', () => {
      // The page plays the whole lab silent, then the audio is sent back to 0 from the console. The page
      // sends what it holds first, on a tick where it last sampled; the replay's results follow.
      const at = (clientMs: number) => T0 + clientMs + 50;
      const first = honest({ voice: () => 0 });
      const rewindAt = SETUP + END + 100;
      const second = honest({ voice: () => 0, clientStart: rewindAt + 50 }).map((e) => ({ ...e, kind: 'tick' as const }));
      const script = PAUSES.map(([s, e]): ScoredEvent => {
        const clientMs = rewindAt + 50 + e + 300;
        return { kind: 'tick', positionMs: e + 300, clientMs, at: T0 + clientMs + 80, answers: [[s, 1500]] };
      });
      const events: ScoredEvent[] = [
        ...first,
        { kind: 'seek', positionMs: 0, clientMs: rewindAt, at: at(rewindAt) },
        ...second,
        ...script,
      ];
      expect(score(events)).toMatchObject({ answered: 0, conflicts: 10, late: 0 });
    });

    it('never happens to an honest page: an answer while paused, Back 10 s, a retried report', () => {
      // Answered while paused inside the window (the sim's A8): one result, on the tick after.
      const paused: ScoredEvent[] = [
        ...honest({ to: 20_000 }).map((e) => ({ ...e, answers: null })),
        { kind: 'pause', positionMs: 21_500, clientMs: SETUP + 21_500, at: T0 + SETUP + 21_550 },
        { kind: 'play', positionMs: 21_500, clientMs: SETUP + 29_500, at: T0 + SETUP + 29_550 },
        { kind: 'tick', positionMs: 26_500, clientMs: SETUP + 34_500, at: T0 + SETUP + 34_550, answers: [[20_000, 1800]] },
      ];
      expect(score(paused)).toMatchObject({ answered: 1, conflicts: 0, rejected: 0 });
      // A report sent again after a lost response is stored once (heartbeat, submit): one result.
      expect(score(honest())).toMatchObject({ answered: 10, conflicts: 0 });
    });

    /**
     * The script's variants that split the page's result and its own into two
     * runs: a fake entry just after its own result, so the page's lands in
     * what looks like another playback. Only a Back 10 s the log bears out
     * starts one, so each leaves both results in one playback.
     */
    describe('a fake jump between the script’s result and the page’s', () => {
      /** The page's silent log (0 in every pause), plus, for each pause, what `fake` adds 0.1 s before the page's own report. */
      const faked = (fake: (s: number, e: number, clientMs: number) => ScoredEvent[]) => [
        ...honest({ voice: () => 0 }),
        ...PAUSES.flatMap(([s, e]) => fake(s, e, SETUP + e)),
      ];
      const scriptTick = (positionMs: number, clientMs: number, answers: [number, number][] | null = null): ScoredEvent =>
        ({ kind: 'tick', positionMs, clientMs, at: T0 + clientMs + 80, answers });
      const scriptSeek = (positionMs: number, clientMs: number): ScoredEvent =>
        ({ kind: 'seek', positionMs, clientMs, at: T0 + clientMs + 80 });

      const expectCaught = (events: ScoredEvent[]) => {
        const result = score(events);
        expect(result).toMatchObject({ answered: 0, conflicts: 10 });
        expect(result.results).toEqual(PAUSES.map(([s]) => [s, CONFLICTED_RESULT]));
      };

      it('a seek 0.5 s back (S1; the page reports a console seek the same way)', () => {
        expectCaught(faked((s, e, c) => [scriptTick(e, c, [[s, 1500]]), scriptSeek(e - 500, c + 1)]));
      });

      it('a seek back into the window, then a walk through it that fits the skip slack at every step (S2)', () => {
        expectCaught(faked((s, e, c) => [
          scriptTick(e, c, [[s, 1500]]), scriptSeek(s + 200, c + 1),
          scriptTick(s + 1699, c + 2), scriptTick(s + 3198, c + 3), scriptTick(e, c + 4),
        ]));
      });

      it('a tick 3 s ahead, with no seek at all: a skip, and the page’s next report steps back (T1)', () => {
        expectCaught(faked((s, e, c) => [scriptTick(e, c, [[s, 1500]]), scriptTick(e + 3000, c + 1)]));
      });

      it('a seek shaped like Back 10 s, which the page’s next report takes back up with a skip', () => {
        expectCaught(faked((s, e, c) => [scriptTick(e, c, [[s, 1500]]), scriptSeek(e - 10_000, c + 1)]));
      });

      it('a seek shaped like Back 10 s, then a walk back up to where the page is, 1.5 s a step', () => {
        expectCaught(faked((s, e, c) => [
          scriptTick(e, c, [[s, 1500]]), scriptSeek(e - 10_000, c + 1),
          ...Array.from({ length: 7 }, (_, k) => scriptTick(e - 10_000 + 1499 * (k + 1), c + 2 + k)),
        ]));
      });
    });

    it('keeps an honest replay apart when the page’s tick lands while its Back 10 s seek is under way', () => {
      // The tick fires between the report of where playback reached and the seek's own report.
      const at = (clientMs: number) => T0 + clientMs + 50;
      const events: ScoredEvent[] = [
        ...honest({ to: 25_000 }).map((e) => ({ ...e, answers: e.positionMs === 25_000 ? [[20_000, 300]] : null })),
        { kind: 'tick', positionMs: 26_000, clientMs: SETUP + 26_000, at: at(SETUP + 26_000) },
        { kind: 'tick', positionMs: 16_000, clientMs: SETUP + 26_020, at: at(SETUP + 26_020) },
        { kind: 'seek', positionMs: 16_000, clientMs: SETUP + 26_150, at: at(SETUP + 26_150) },
        { kind: 'tick', positionMs: 20_850, clientMs: SETUP + 31_000, at: at(SETUP + 31_000) },
        { kind: 'tick', positionMs: 25_850, clientMs: SETUP + 36_000, at: at(SETUP + 36_000), answers: [[20_000, 1200]] },
      ];
      const result = score(events);
      expect(result).toMatchObject({ answered: 1, conflicts: 0, rejected: 0 });
      expect(result.results[0]).toEqual([20_000, 1200]);
    });

    it('keeps an honest replay apart however soon its result follows the first: Back 10 s 5 s after the pause', () => {
      // The first pass's result rides on a tick 4.9 s after the window; Back 10 s right after it;
      // the replay's result rides on a pause the student makes just after the window, 5.25 s later.
      const at = (clientMs: number) => T0 + clientMs + 50;
      const entry = (kind: ScoredEvent['kind'], positionMs: number, clientMs: number, answers: [number, number][] | null = null): ScoredEvent =>
        ({ kind, positionMs, clientMs, at: at(clientMs), answers });
      const events: ScoredEvent[] = [
        entry('play', 0, SETUP),
        ...[3800, 8800, 13_800, 18_800, 23_800].map((p) => entry('tick', p, SETUP + p)),
        entry('tick', 28_800, SETUP + 28_800, [[20_000, 400]]),
        entry('tick', 28_850, SETUP + 28_850),
        entry('seek', 18_850, SETUP + 28_900),
        entry('tick', 23_750, SETUP + 33_800),
        entry('pause', 24_000, SETUP + 34_050, [[20_000, 1500]]),
        entry('play', 24_000, SETUP + 40_000),
        entry('tick', 25_800, SETUP + 41_800),
      ];
      const result = score(events);
      expect(result).toMatchObject({ answered: 1, conflicts: 0, rejected: 0 });
      expect(result.results[0]).toEqual([20_000, 1500]);
    });
  });

  describe('results after the page went on without a microphone', () => {
    const marker = (positionMs: number, clientMs: number, answers: [number, number][] | null = null): ScoredEvent =>
      ({ kind: 'nomic', positionMs, clientMs, at: T0 + clientMs + 50, answers });

    it('counts every result after the marker: "My mic doesn\'t work", and a script answers the pauses', () => {
      // The page sends no results; the script sends 1.5 s for each pause, 2 s after it, on its own reports.
      const events: ScoredEvent[] = [
        marker(0, SETUP - 5000),
        ...honest({ voice: () => null }),
        ...PAUSES.map(([s, e]): ScoredEvent => ({ kind: 'tick', positionMs: e + 2000, clientMs: SETUP + e + 2000, at: T0 + SETUP + e + 2080, answers: [[s, 1500]] })),
      ];
      // Scored as any other: they are single, and played through.
      expect(score(events)).toMatchObject({ answered: 10, afterNoMic: 10, conflicts: 0, rejected: 0 });
    });

    it('counts none of the page’s own, before the marker or on it, when the microphone stopped mid-lab', () => {
      // Six pauses answered; the microphone stops at 2:57 with the sixth's result still queued, which the marker carries.
      const before = honest({ to: 175_000, voice: (_p, i) => (i < 6 ? 1000 : null) })
        .map((e) => (e.positionMs === 175_000 ? { ...e, answers: null } : e));
      const events: ScoredEvent[] = [
        ...before,
        { kind: 'pause', positionMs: 177_000, clientMs: SETUP + 177_000, at: T0 + SETUP + 177_050 },
        marker(177_000, SETUP + 180_000, [[PAUSES[5][0], 1000]]),
        { kind: 'play', positionMs: 177_000, clientMs: SETUP + 185_000, at: T0 + SETUP + 185_050 },
        ...honest({ from: 180_000, clientStart: SETUP + 188_000, voice: () => null }).map((e) => ({ ...e, kind: 'tick' as const })),
      ];
      expect(score(events)).toMatchObject({ answered: 6, afterNoMic: 0, rejected: 0, conflicts: 0 });
      expect(score(honest())).toMatchObject({ afterNoMic: 0 });
    });

    it('counts a result sent after the marker but dated before it: a script cannot backdate its way in', () => {
      // The microphone stopped inside the sixth pause (2:52.5); the page dropped that pass and went on
      // without it at 3:05 (paused all the while). After the mark, the script sends a report dated
      // 3:00, where the paused audio stood, saying playback reached the window's end, with 1.5 s for it.
      const stop = 172_500;
      const before = honest({ to: 170_000, voice: (_p, i) => (i < 5 ? 1000 : null) });
      const events: ScoredEvent[] = [
        ...before,
        { kind: 'pause', positionMs: stop, clientMs: SETUP + stop, at: T0 + SETUP + stop + 50 },
        marker(stop, SETUP + 185_000),
        { kind: 'play', positionMs: stop, clientMs: SETUP + 190_000, at: T0 + SETUP + 190_050 },
        ...honest({ from: 175_000, clientStart: SETUP + 192_500, voice: () => null }).map((e) => ({ ...e, kind: 'tick' as const })),
      ];
      const backdated: ScoredEvent = {
        kind: 'tick', positionMs: PAUSES[5][1], clientMs: SETUP + 180_000, at: T0 + SETUP + 200_000, answers: [[PAUSES[5][0], 1500]],
      };
      // It would count: played through in its run, alone, and before the mark in the page's order.
      expect(score([...events, { ...backdated, at: T0 + SETUP + 180_050 }])).toMatchObject({ answered: 6, afterNoMic: 0 });
      // Sent after the mark, it is one the page could not have sent.
      expect(score([...events, backdated])).toMatchObject({ answered: 6, afterNoMic: 1 });
      // So is the submit's own result, whatever page time it names.
      const submitEntry: ScoredEvent = { ...backdated, kind: 'end', at: T0 + SETUP + END + 5000 };
      expect(score([...events, submitEntry])).toMatchObject({ afterNoMic: 1 });
      // The page's own entries before the mark, however late they were sent, arrived before it: none counts.
      expect(score(events)).toMatchObject({ answered: 5, afterNoMic: 0 });
    });

    it('stands still: a marker splits no run and covers nothing', () => {
      // One in the middle of the first pause's playback, at a position of its own.
      const events = [...honest(), marker(0, SETUP + 22_000)];
      expect(score(events)).toMatchObject({ answered: 10, rejected: 0, afterNoMic: 10 });
    });
  });

  it('never finds two results in one playback in 400 honest sessions (a model of the page)', () => {
    let conflicts = 0;
    let rejected = 0;
    let answered = 0;
    let replayed = 0;
    for (let i = 0; i < 400; i++) {
      const session = honestPage(9000 + i, i % 5 === 0 ? 40 : 12);
      const result = scorePauses({ pauses: session.pauses, events: session.events, sessionStartedAt: T0, floorMs: FLOOR });
      conflicts += result.conflicts;
      rejected += result.rejected;
      answered += result.answered;
      replayed += session.replayedPauses;
    }
    expect({ conflicts, rejected }).toEqual({ conflicts: 0, rejected: 0 });
    // The sessions did answer pauses, and replay some after Back 10 s.
    expect(answered).toBeGreaterThan(2000);
    expect(replayed).toBeGreaterThan(300);
  });

  it('scores 30,000 results in under 100 ms', () => {
    const pauses: LabPause[] = Array.from({ length: 100 }, (_, i) => [20_000 + i * 9000, 24_000 + i * 9000]);
    const events: ScoredEvent[] = Array.from({ length: 1500 }, (_, i) => ({
      kind: i === 0 ? 'play' : 'tick',
      positionMs: i * 600,
      clientMs: SETUP + i * 600,
      at: T0 + SETUP + i * 600 + 50,
      answers: JSON.stringify(Array.from({ length: 20 }, (_, j) => [pauses[(i + j) % 100][0], 900])),
    }));
    scorePauses({ pauses, events, sessionStartedAt: T0, floorMs: FLOOR }); // warm up
    const started = performance.now();
    const result = scorePauses({ pauses, events, sessionStartedAt: T0, floorMs: FLOOR });
    expect(performance.now() - started).toBeLessThan(100);
    expect(result.rejected + result.late + result.accepted.length).toBeGreaterThan(0);
  });

  it('ignores the server’s own open marker and bad answer text', () => {
    const events: ScoredEvent[] = [
      { kind: 'open', positionMs: 0, clientMs: 0, at: T0, answers: JSON.stringify([[20_000, 1000]]) },
      ...honest(),
    ];
    events[3].answers = 'not json';
    expect(score(events)).toMatchObject({ answered: 10, rejected: 0 });
  });
});

describe('parseAnswers', () => {
  it('reads stored text and lists, and treats anything else as none', () => {
    expect(parseAnswers('[[1,2],[3,4]]')).toEqual([[1, 2], [3, 4]]);
    expect(parseAnswers([[1, 2]])).toEqual([[1, 2]]);
    for (const bad of [null, undefined, '', '{', '{"a":1}', '[[1]]', '[["a",1]]']) expect(parseAnswers(bad)).toEqual([]);
    expect(parseAnswers('[[1,2],[3],"x",[5,6]]')).toEqual([[1, 2], [5, 6]]);
  });
});

describe('logLeadMs', () => {
  it('is about zero for live reports, and the burst length for a burst', () => {
    expect(logLeadMs(honest(), T0)).toBeLessThan(100);
    const burst = honest().map((e) => ({ ...e, at: T0 + SETUP + END + 60_000 }));
    expect(logLeadMs(burst, T0)).toBe(END);
  });
});

describe('pauseSoundFlags', () => {
  const results = (value: (i: number) => number) => PAUSES.map(([s], i): [number, number] => [s, value(i)]);

  it('flags sound through almost every pause, not honest short answers', () => {
    expect(pauseSoundFlags({ pauses: PAUSES, results: results(() => WINDOW), outsideVoicedMs: 0, outsidePlayedMs: 0 }))
      .toEqual(['constant-sound']);
    // 8 of 10 at 90% of the window is enough; 7 is not.
    expect(pauseSoundFlags({ pauses: PAUSES, results: results((i) => (i < 8 ? Math.ceil(0.9 * WINDOW) : 500)), outsideVoicedMs: 0, outsidePlayedMs: 0 }))
      .toEqual(['constant-sound']);
    expect(pauseSoundFlags({ pauses: PAUSES, results: results((i) => (i < 7 ? WINDOW : 500)), outsideVoicedMs: 0, outsidePlayedMs: 0 }))
      .toEqual([]);
    expect(pauseSoundFlags({ pauses: PAUSES, results: results(() => 1000), outsideVoicedMs: 0, outsidePlayedMs: 0 })).toEqual([]);
    // Fewer than ten accepted results never count.
    const nine = results(() => WINDOW).map(([s, v], i): [number, number] => [s, i === 0 ? -1 : v]);
    expect(pauseSoundFlags({ pauses: PAUSES, results: nine, outsideVoicedMs: 0, outsidePlayedMs: 0 })).toEqual([]);
  });

  it('flags voice outside the pauses about as often as in them', () => {
    // Inside: 1000 of 3600 ms per pause (0.28). Outside: 0.30 of a minute.
    const honestResults = results(() => 1000);
    expect(pauseSoundFlags({ pauses: PAUSES, results: honestResults, outsideVoicedMs: 18_000, outsidePlayedMs: 60_000 }))
      .toEqual(['noisy']);
    // Less than a minute outside: no flag.
    expect(pauseSoundFlags({ pauses: PAUSES, results: honestResults, outsideVoicedMs: 17_700, outsidePlayedMs: 59_000 })).toEqual([]);
    // Much more voice in the pauses than outside: a student answering in a quiet room.
    expect(pauseSoundFlags({ pauses: PAUSES, results: results(() => 3000), outsideVoicedMs: 18_000, outsidePlayedMs: 60_000 })).toEqual([]);
    expect(pauseSoundFlags({ pauses: PAUSES, results: honestResults, outsideVoicedMs: null, outsidePlayedMs: null })).toEqual([]);
    // Pauses with no result (-1) or two in one playback (-2) add nothing inside.
    const conflicted = results((i) => (i % 2 === 0 ? CONFLICTED_RESULT : -1));
    expect(voiceRates({ pauses: PAUSES, results: conflicted, outsideVoicedMs: 6000, outsidePlayedMs: 60_000 })).toEqual({ inside: 0, outside: 0.1 });
  });

  it('flags from 10% of the time outside the pauses voiced, when the pauses have under 1.2 times as much', () => {
    // 360 s of windows; inside rate 0.2 (720 ms a pause).
    const inside = results(() => 720);
    const flags = (outsideVoicedMs: number) =>
      pauseSoundFlags({ pauses: PAUSES, results: inside, outsideVoicedMs, outsidePlayedMs: 100_000 });
    // Outside 0.10 against inside 0.2: 0.2 is not under 1.2 × 0.10. Outside 0.167 or more: it is.
    expect(flags(10_000)).toEqual([]);
    expect(flags(16_600)).toEqual([]);
    expect(flags(16_700)).toEqual(['noisy']);
    // At the rate floor: 0.10 with inside 0.1 flags, 0.0999 does not.
    const low = results(() => 360);
    expect(pauseSoundFlags({ pauses: PAUSES, results: low, outsideVoicedMs: 10_000, outsidePlayedMs: 100_000 })).toEqual(['noisy']);
    expect(pauseSoundFlags({ pauses: PAUSES, results: low, outsideVoicedMs: 9_990, outsidePlayedMs: 100_000 })).toEqual([]);
  });

  it('holds for voice outside the pauses only from 15% of the time outside', () => {
    const args = (outsideVoicedMs: number) => ({ pauses: PAUSES, results: results(() => 360), outsideVoicedMs, outsidePlayedMs: 100_000 });
    expect(NOISY_HOLD_MIN_OUTSIDE_RATE).toBe(0.15);
    expect(voiceOutsideThePauses(args(12_000))).toBe(true);
    expect(voiceOutsideThePauses(args(12_000), NOISY_HOLD_MIN_OUTSIDE_RATE)).toBe(false);
    expect(voiceOutsideThePauses(args(15_000), NOISY_HOLD_MIN_OUTSIDE_RATE)).toBe(true);
  });
});

describe('sessionRule', () => {
  const current = { minAnsweredPct: 75, voicePerPauseMs: 250 };
  const rules = (fields: object) => JSON.stringify({ v: 1, pauses: PAUSES, pct: 80, floor: 300, requiredThroughMs: END, ...fields });
  const judge = (rulesText: string | null | undefined, { requiredThroughMs = END, age = 60_000 } = {}) =>
    sessionRule({ rulesText, requiredThroughMs, startedAtMs: T0, nowMs: T0 + age, current });

  it('keeps the old rule for a session opened before the pause rule, for six hours', () => {
    expect(judge(undefined)).toEqual({ rule: 'legacy' });
    expect(judge(null, { age: LEGACY_SESSION_MAX_AGE_MS })).toEqual({ rule: 'legacy' });
    expect(judge(null, { age: LEGACY_SESSION_MAX_AGE_MS + 1 })).toEqual({ rule: 'expired' });
  });

  it('scores against the session’s own pauses and settings', () => {
    expect(judge(rules({}))).toEqual({ rule: 'scored', pauses: PAUSES, dropped: [], pct: 80, floor: 300, holdOutsideVoice: false });
    // v1.16.0 rules carry the meter's margin and the hold; only a hold that is `true` holds.
    expect(judge(rules({ gateMarginDb: 8, holdOutsideVoice: true }))).toMatchObject({ rule: 'scored', holdOutsideVoice: true });
    expect(judge(rules({ holdOutsideVoice: 'yes' }))).toMatchObject({ rule: 'scored', holdOutsideVoice: false });
  });

  it('is unscored when the lab had no pause list when the session began, or none still count', () => {
    expect(judge(rules({ pauses: null }))).toEqual({ rule: 'unscored', pct: 80, floor: 300, holdOutsideVoice: false });
    // The teacher lowered must-hear-through below every pause mid-session.
    expect(judge(rules({}), { requiredThroughMs: 20_000 })).toEqual({ rule: 'unscored', pct: 80, floor: 300, holdOutsideVoice: false });
    // ...or below some: those after it (less 1.5 s) drop out.
    const cut = judge(rules({}), { requiredThroughMs: PAUSES[4][1] + 1500 });
    expect(cut).toMatchObject({ rule: 'scored', pauses: PAUSES.slice(0, 5), dropped: PAUSES.slice(5) });
  });

  it('never gives the legacy rule to a session that has rules it cannot read', () => {
    expect(judge('{"v":2}')).toEqual({ rule: 'unscored', pct: 75, floor: 250, holdOutsideVoice: false });
    expect(judge('nonsense')).toEqual({ rule: 'unscored', pct: 75, floor: 250, holdOutsideVoice: false });
  });
});

describe('pauseVoiceOutrunsTotal', () => {
  const results = (value: number) => PAUSES.map(([s]): PauseAnswer => [s, value]);

  it('is pause voice plus voice outside over all the page heard, with 0.25 s and 25 ms a pause of slack', () => {
    // 10 × 900 = 9000 in the pauses, 1000 outside: 10 000, against 9000 + 250 + 250.
    expect(pauseVoiceOutrunsTotal({ results: results(900), outsideVoicedMs: 1000, voicedMs: 9500, counted: 10 })).toBe(false);
    expect(pauseVoiceOutrunsTotal({ results: results(900), outsideVoicedMs: 1000, voicedMs: 9499, counted: 10 })).toBe(true);
    // The no-mic script: 1.5 s in every pause and a page that heard nothing.
    expect(pauseVoiceOutrunsTotal({ results: results(1500), outsideVoicedMs: 0, voicedMs: 0, counted: 10 })).toBe(true);
    // Pauses with no result, or conflicted, add nothing.
    expect(pauseVoiceOutrunsTotal({ results: results(CONFLICTED_RESULT), outsideVoicedMs: null, voicedMs: 0, counted: 10 })).toBe(false);
  });

  it('counts voice heard while paused: two answers given while paused, then the microphone lost', () => {
    // 60 pauses; 48 answered while playing (1.2 s each), 2 while paused (1.5 s each), then the microphone
    // stopped. The page heard 57.6 s while playing and 3 s while paused.
    const answers = (): PauseAnswer[] => Array.from({ length: 60 }, (_, i): PauseAnswer => [i * 10_000, i < 48 ? 1200 : i < 50 ? 1500 : -1]);
    const args = { results: answers(), outsideVoicedMs: 0, voicedMs: 57_600, counted: 60 };
    expect(pauseVoiceOutrunsTotal({ ...args, pausedVoicedMs: 3000 })).toBe(false);
    // Without the paused voice, 60.6 s in the pauses is more than 57.6 s + 1.75 s: every page sends it, so missing is 0.
    expect(pauseVoiceOutrunsTotal(args)).toBe(true);
    expect(pauseVoiceOutrunsTotal({ ...args, pausedVoicedMs: 0 })).toBe(true);
    expect(pauseVoiceOutrunsTotal({ ...args, pausedVoicedMs: null })).toBe(true);
  });
});

describe('short answers', () => {
  const T = new Date('2026-10-01T15:00:00Z');
  /** A row whose answered pauses all took `ms`, over 12 pauses (`answered` of them answered). */
  const row = (id: number, userId: number, ms: number, { answered = 12, student = true, at = T } = {}) => ({
    id, userId, student, submittedAt: at, floorMs: 250,
    results: Array.from({ length: 12 }, (_, i): PauseAnswer => [i * 10_000, i < answered ? ms : 0]),
  });
  const classOf = (n: number, ms = 1000) => Array.from({ length: n }, (_, i) => row(100 + i, 100 + i, ms));

  it('flags a row whose answers are under half the class’s typical answer', () => {
    expect([...shortAnswerRows([row(1, 1, 499), ...classOf(5)])]).toEqual([1]);
    expect([...shortAnswerRows([row(1, 1, 500), ...classOf(5)])]).toEqual([]);
  });

  it('needs 10 answered pauses on the row and 5 other students to compare with', () => {
    expect(answeredMedianMs(row(1, 1, 300, { answered: 9 }).results, 250)).toBeNull();
    expect(answeredMedianMs(row(1, 1, 300, { answered: 10 }).results, 250)).toBe(300);
    expect(shortAnswerRows([row(1, 1, 300, { answered: 9 }), ...classOf(5)]).size).toBe(0);
    expect(shortAnswerRows([row(1, 1, 300), ...classOf(4)]).size).toBe(0);
    // The teacher's own runs are not the class, and a student's other attempts are not the class either.
    expect(shortAnswerRows([row(1, 1, 300), ...classOf(4), row(50, 999, 1000, { student: false })]).size).toBe(0);
    expect(shortAnswerRows([row(1, 1, 300), row(2, 1, 1000), ...classOf(4)]).size).toBe(0);
  });

  it('takes each other student’s newest row with 10 answered pauses, and the median of those', () => {
    const others = [
      ...classOf(4, 1000),
      // Student 7: an old attempt at 300 ms, then a newer one at 1000 ms.
      row(70, 7, 300, { at: new Date('2026-09-30T15:00:00Z') }),
      row(71, 7, 1000),
    ];
    expect([...shortAnswerRows([row(1, 1, 450), ...others])]).toEqual([1, 70]);
  });
});

/**
 * A model of an honest lab page (LabRunner and its PauseTracker): one result
 * per pass through a pause (at most four), a replay's
 * too; results ride on ticks (every 5 s), pause reports and the end; Back 10 s
 * reports where playback reached (with any pause just finished), then the
 * seek, pressed in or just after a pause or up to 7 s after it (to hear it
 * again); answers while playing and while paused; reports sent one at a
 * time, 30 ms to 20 s late, some twice (the server keeps one).
 */
function honestPage(seed: number, pauseCount: number) {
  let state = seed;
  const rnd = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const between = (a: number, b: number) => a + rnd() * (b - a);

  const pauses: LabPause[] = [];
  let t = 1000;
  for (let i = 0; i < pauseCount; i++) {
    t += Math.round(between(1500, 4000));
    const length = Math.round(rnd() < 0.08 ? between(9000, 11_000) : between(3300, 5000));
    pauses.push([t, t + length]);
    t += length;
  }
  const durationMs = t + 3000;
  const windows = pauses.map((p) => ({ ...pauseWindow(p), start: p[0] }));

  const events: ScoredEvent[] = [];
  const stored = new Set<string>();
  let netFree = 0;
  let now = SETUP;
  let pos = 0;
  const queue: PauseAnswer[] = [];
  const best = new Array<number | null>(pauses.length).fill(null);
  const passes = new Array<number>(pauses.length).fill(0);
  let pass: { index: number; voiced: number } | null = null;
  let prevPos = 0;

  const send = (kind: ScoredEvent['kind'], carry: boolean) => {
    const answers = carry ? queue.splice(0, 20) : [];
    const report: ScoredEvent = { kind, positionMs: Math.round(pos), clientMs: Math.round(now), at: 0, answers: answers.length > 0 ? answers : null };
    const copies = rnd() < 0.03 ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      netFree = Math.max(netFree, now) + (rnd() < 0.05 ? between(2000, 20_000) : between(30, 400));
      const key = `${report.kind}:${report.clientMs}:${report.positionMs}`;
      if (stored.has(key)) continue;
      stored.add(key);
      events.push({ ...report, at: T0 + Math.round(netFree) });
    }
  };
  const finishPass = () => {
    if (!pass) return;
    const w = windows[pass.index];
    const value = Math.round(Math.min(pass.voiced, w.to - w.from));
    const i = pass.index;
    pass = null;
    const waiting = queue.find(([s]) => s === w.start);
    if (waiting) waiting[1] = Math.max(waiting[1], value);
    else if (passes[i] < MAX_RESULTS_PER_PAUSE) {
      passes[i] += 1;
      queue.push([w.start, value]);
    } else return;
    if (best[i] === null || value > best[i]!) best[i] = value;
  };
  /** The tracker's view of one step of playback (or of standing still, paused). */
  const sample = (frame: number, paused: boolean) => {
    const voiced = rnd() < 0.3;
    if (pass) {
      const w = windows[pass.index];
      if (pos > w.to) finishPass();
      else if (voiced && pos >= w.from) pass.voiced += frame * (paused ? 0.5 : 1);
    }
    if (!pass && !paused) {
      const inside = windows.findIndex((w) => pos >= w.from && pos <= w.to);
      if (inside >= 0 && prevPos < windows[inside].from) pass = { index: inside, voiced: 0 };
    }
    prevPos = pos;
  };

  send('play', false);
  let lastTick = now;
  const backs = new Array<number>(pauses.length).fill(0);
  while (pos < durationMs) {
    const step = between(40, 70);
    now += step;
    pos += step;
    sample(step, false);
    const near = windows.findIndex((w) => pos >= w.from - 800 && pos <= w.to + 1500);
    // Pause for a moment (inside a window or just before it), answering or not.
    if (near >= 0 && rnd() < 0.004) {
      send('pause', true);
      const until = now + between(800, 4000);
      while (now < until) {
        now += 50;
        sample(50, true);
      }
      if (rnd() < 0.1 && backs[near] < 2) {
        // Back 10 s while paused: a pass whose window playback has passed finishes; one still open is dropped.
        backs[near] += 1;
        if (pass && pos > windows[pass.index].to) finishPass();
        pass = null;
        send('tick', true);
        now += between(20, 80);
        pos = Math.max(0, pos - 10_000);
        prevPos = pos;
        send('seek', false);
      }
      send('play', false);
    }
    // Back 10 s, right after a pause or inside one, or a few seconds after it to hear it again:
    // the replay's result then comes as little as 4 s of page time after the first.
    const again = near >= 0 ? near : windows.findIndex((w) => pos > w.to + 1500 && pos <= w.to + 7000);
    if (again >= 0 && backs[again] < 2 && rnd() < (near >= 0 ? 0.006 : 0.003)) {
      backs[again] += 1;
      if (pass && pos > windows[pass.index].to) finishPass();
      pass = null;
      send('tick', true);
      now += between(20, 80);
      pos = Math.max(0, pos - 10_000);
      prevPos = pos;
      // Now and then the page's own tick fires while the seek is under way, at where it lands.
      if (rnd() < 0.2) send('tick', true);
      now += between(1, 30);
      send('seek', false);
      // The page's ticks keep their own beat (setInterval), whatever the student presses.
    }
    if (now - lastTick >= 5000) {
      lastTick = now;
      send('tick', true);
    }
  }
  pos = durationMs;
  finishPass();
  send('end', true);
  // What is still queued rides on the submit's final entry.
  now += 5;
  events.push({ kind: 'end', positionMs: durationMs, clientMs: Math.round(now), at: T0 + Math.round(Math.max(netFree, now)) + 300, answers: queue.length > 0 ? [...queue] : null });
  return { pauses, events, replayedPauses: passes.filter((n) => n > 1).length + backs.filter((n) => n > 0).length };
}
