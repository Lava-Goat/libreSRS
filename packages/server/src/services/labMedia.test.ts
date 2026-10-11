// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  LISTEN_TOLERANCE_MS,
  listeningProblem,
  minimumVoicedMs,
  parseStoredFlags,
  signLabStart,
  submissionFlags,
  summarizeListening,
  type ListenEvent,
  verifyLabStart,
} from './labMedia.js';

describe('start token', () => {
  const started = 1_790_000_000_000;

  it('round-trips for the same lab and student', () => {
    const token = signLabStart(7, 42, started);
    expect(verifyLabStart(token, 7, 42, started + 60_000)).toBe(started);
  });

  it('is bound to the lab and the student', () => {
    const token = signLabStart(7, 42, started);
    expect(verifyLabStart(token, 8, 42, started + 60_000)).toBeNull();
    expect(verifyLabStart(token, 7, 43, started + 60_000)).toBeNull();
  });

  it('cannot be backdated: changing the time breaks the signature', () => {
    const [, sig] = signLabStart(7, 42, started).split('.');
    expect(verifyLabStart(`${started - 3_600_000}.${sig}`, 7, 42, started + 60_000)).toBeNull();
  });

  it('refuses a start in the future and one older than a week', () => {
    expect(verifyLabStart(signLabStart(7, 42, started), 7, 42, started - 1)).toBeNull();
    expect(verifyLabStart(signLabStart(7, 42, started), 7, 42, started + 8 * 24 * 3_600_000)).toBeNull();
  });

  it('refuses malformed tokens without throwing', () => {
    for (const bad of [undefined, '', 'abc', `${started}`, `${started}.`, `x.${'a'.repeat(43)}`, `${started}.sig.extra`]) {
      expect(verifyLabStart(bad, 7, 42, started + 1)).toBeNull();
    }
  });
});

describe('listening check', () => {
  const requiredThroughMs = 600_000;
  const startedAtMs = 1_000_000;

  it('passes a student who heard it through and took at least as long as the audio', () => {
    expect(listeningProblem({
      heardThroughMs: requiredThroughMs, requiredThroughMs, startedAtMs, nowMs: startedAtMs + requiredThroughMs + 30_000,
    })).toBeNull();
  });

  it('refuses a student who stopped short of the last spoken part', () => {
    expect(listeningProblem({
      heardThroughMs: requiredThroughMs - LISTEN_TOLERANCE_MS - 1,
      requiredThroughMs, startedAtMs, nowMs: startedAtMs + requiredThroughMs * 2,
    })).toMatch(/whole lab/);
  });

  it('refuses a submission that arrives sooner than the audio could play, whatever the browser claims', () => {
    expect(listeningProblem({
      heardThroughMs: requiredThroughMs, requiredThroughMs, startedAtMs, nowMs: startedAtMs + 60_000,
    })).toMatch(/faster than the audio/);
  });

  it('allows the tolerance at both edges', () => {
    expect(listeningProblem({
      heardThroughMs: requiredThroughMs - LISTEN_TOLERANCE_MS,
      requiredThroughMs, startedAtMs, nowMs: startedAtMs + requiredThroughMs - LISTEN_TOLERANCE_MS,
    })).toBeNull();
  });
});

describe('teacher flags', () => {
  it('asks for 30 seconds of voice, or 5% of a short lab', () => {
    expect(minimumVoicedMs(900_000)).toBe(30_000);
    expect(minimumVoicedMs(120_000)).toBe(6_000);
  });

  it('flags a session with almost no speech — the student who only listened', () => {
    expect(submissionFlags({ voicedMs: 4_000, skipCount: 0, requiredThroughMs: 660_000 })).toEqual(['little-speech']);
  });

  it('draws the speech line exactly at the minimum', () => {
    expect(submissionFlags({ voicedMs: 29_999, skipCount: 0, requiredThroughMs: 660_000 })).toEqual(['little-speech']);
    expect(submissionFlags({ voicedMs: 30_000, skipCount: 0, requiredThroughMs: 660_000 })).toEqual([]);
  });

  it('judges speech against the lab’s length: 5 s is plenty for a 60 s lab', () => {
    expect(submissionFlags({ voicedMs: 5_000, skipCount: 0, requiredThroughMs: 60_000 })).toEqual([]);
    expect(submissionFlags({ voicedMs: 5_000, skipCount: 0, requiredThroughMs: 660_000 })).toEqual(['little-speech']);
  });

  it('flags a session whose log shows a skip, even if the student went back and finished', () => {
    expect(submissionFlags({ voicedMs: 90_000, skipCount: 1, requiredThroughMs: 660_000 })).toEqual(['skipped']);
  });

  it('can raise both, skip first', () => {
    expect(submissionFlags({ voicedMs: 0, skipCount: 2, requiredThroughMs: 660_000 })).toEqual(['skipped', 'little-speech']);
  });

  it('raises nothing for a lab with nothing to hear through', () => {
    expect(submissionFlags({ voicedMs: 0, skipCount: 0, requiredThroughMs: 0 })).toEqual([]);
  });
});

describe('teacher flags on a lab scored pause by pause', () => {
  const base = { voicedMs: 0, skipCount: 0, requiredThroughMs: 660_000 };

  it('leaves out little speech when the pauses were counted: the pause count says it', () => {
    expect(submissionFlags({ ...base, pausesCounted: 101 })).toEqual([]);
    expect(submissionFlags({ ...base, pausesCounted: null })).toEqual(['little-speech']);
  });

  it('flags three or more pause results that did not match the log', () => {
    expect(submissionFlags({ ...base, pausesCounted: 101, rejectedAnswers: 2 })).toEqual([]);
    expect(submissionFlags({ ...base, pausesCounted: 101, rejectedAnswers: 3 })).toEqual(['odd-answers']);
  });

  it('flags results sent late, and a log stored as late', () => {
    expect(submissionFlags({ ...base, pausesCounted: 101, lateAnswers: 1 })).toEqual(['late']);
    expect(submissionFlags({ ...base, pausesCounted: null, voicedMs: 90_000, stored: '["late"]' })).toEqual(['late']);
  });

  it('flags no microphone, without calling it little speech', () => {
    expect(submissionFlags({ ...base, mic: 'off' })).toEqual(['no-mic']);
    expect(submissionFlags({ ...base, mic: 'on' })).toEqual(['little-speech']);
  });

  it('adds the flags stored at submit, in a fixed order, and ignores anything unknown', () => {
    expect(submissionFlags({
      ...base, skipCount: 1, pausesCounted: 101, rejectedAnswers: 4, mic: 'off',
      stored: JSON.stringify(['noisy', 'overlap', 'constant-sound', 'late', 'made-up', 'little-speech']),
    })).toEqual(['skipped', 'odd-answers', 'late', 'overlap', 'constant-sound', 'noisy', 'no-mic']);
    expect(submissionFlags({ ...base, voicedMs: 90_000, stored: 'not json' })).toEqual([]);
    expect(submissionFlags({ ...base, voicedMs: 90_000, stored: ['overlap'] })).toEqual(['overlap']);
    expect(parseStoredFlags('{"late":true}')).toEqual([]);
  });

  it('keeps "Odd results" stored at submit (v1.16.0), with no rejected results behind it, once', () => {
    expect(submissionFlags({ ...base, pausesCounted: 12, stored: '["odd-answers"]' })).toEqual(['odd-answers']);
    expect(submissionFlags({ ...base, pausesCounted: 12, rejectedAnswers: 24, stored: '["odd-answers"]' })).toEqual(['odd-answers']);
    expect(parseStoredFlags('["odd-answers","short-answers","no-mic"]')).toEqual(['odd-answers']);
  });

  it('adds "Short answers" only when the class comparison says so, before No microphone', () => {
    expect(submissionFlags({ ...base, pausesCounted: 12, stored: '["noisy"]', shortAnswers: true, mic: 'off' }))
      .toEqual(['noisy', 'short-answers', 'no-mic']);
    expect(submissionFlags({ ...base, pausesCounted: 12, shortAnswers: false })).toEqual([]);
  });
});

describe('teacher flags on a test (an exam lab, v1.19.0)', () => {
  const base = { voicedMs: 0, skipCount: 0, requiredThroughMs: 660_000, pausesCounted: null };

  it('never flags No microphone or Little speech: a test has no microphone by design', () => {
    expect(submissionFlags({ ...base, mic: 'off', exam: true })).toEqual([]);
    expect(submissionFlags({ ...base, mic: 'on', exam: true })).toEqual([]);
    // The same row as practice keeps them.
    expect(submissionFlags({ ...base, mic: 'off', exam: false })).toEqual(['no-mic']);
    expect(submissionFlags({ ...base, mic: 'off' })).toEqual(['no-mic']);
  });

  it('keeps every flag about the listening log', () => {
    expect(submissionFlags({ ...base, mic: 'off', exam: true, skipCount: 2, lateAnswers: 1, stored: '["overlap","late"]' }))
      .toEqual(['skipped', 'late', 'overlap']);
  });
});

describe('listening log', () => {
  const START = 1_790_000_000_000;
  /** Mic check and instructions before the audio starts. */
  const SETUP_MS = 40_000;
  const LAB_MS = 660_000;

  /**
   * An honest session: play from 0, a tick every 5 s, end. Each report reaches
   * the server `latency(i)` ms after the page sent it.
   */
  function honest(latency: (i: number) => number = () => 120): ListenEvent[] {
    const events: ListenEvent[] = [];
    const push = (kind: ListenEvent['kind'], positionMs: number) => {
      const clientMs = SETUP_MS + positionMs;
      events.push({ kind, positionMs, clientMs, at: START + clientMs + latency(events.length) });
    };
    push('play', 0);
    for (let p = 5000; p < LAB_MS; p += 5000) push('tick', p);
    push('end', LAB_MS);
    return events;
  }

  it('credits a full, honest session', () => {
    expect(summarizeListening(honest(), START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0, lastPositionMs: LAB_MS });
  });

  it('is not fooled by school Wi-Fi: late, reordered and lost reports cost nothing', () => {
    // Every seventh report is 3 s late (arriving after the next one), every
    // eleventh is lost, and the very first never arrives.
    const events = honest((i) => (i % 7 === 3 ? 3_000 : 150)).filter((_, i) => i !== 0 && i % 11 !== 5);
    const shuffled = [...events].sort((a, b) => a.at - b.at);
    expect(summarizeListening(shuffled, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
  });

  it('survives a long pause', () => {
    const events: ListenEvent[] = [];
    let clientMs = SETUP_MS;
    const push = (kind: ListenEvent['kind'], positionMs: number) => events.push({ kind, positionMs, clientMs, at: START + clientMs + 100 });
    push('play', 0);
    for (let p = 5000; p <= 200_000; p += 5000) { clientMs += 5000; push('tick', p); }
    push('pause', 200_000);
    clientMs += 5 * 60_000; // five minutes away
    push('play', 200_000);
    for (let p = 205_000; p <= LAB_MS; p += 5000) { clientMs += 5000; push('tick', p); }
    expect(summarizeListening(events, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
  });

  it('allows going back to hear a part again', () => {
    const events = honest();
    const at120 = events.findIndex((e) => e.positionMs === 120_000);
    const e = events[at120];
    // Back 10 s, then play on; everything after shifts 10 s later in time.
    events.splice(at120 + 1, 0, { kind: 'seek', positionMs: 110_000, clientMs: e.clientMs + 200, at: e.at + 200 });
    for (const later of events.slice(at120 + 2)) { later.clientMs += 10_200; later.at += 10_200; }
    expect(summarizeListening(events, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
  });

  it('catches a skip made from the console: no credit past it, and it is counted', () => {
    // At 2:10 the student sets currentTime to 7:40 and plays on to the end.
    const events: ListenEvent[] = [];
    let clientMs = SETUP_MS;
    const push = (kind: ListenEvent['kind'], positionMs: number) => events.push({ kind, positionMs, clientMs, at: START + clientMs + 100 });
    push('play', 0);
    for (let p = 5000; p <= 130_000; p += 5000) { clientMs += 5000; push('tick', p); }
    clientMs += 300;
    push('seek', 460_000);
    for (let p = 465_000; p <= LAB_MS; p += 5000) { clientMs += 5000; push('tick', p); }

    const summary = summarizeListening(events, START);
    expect(summary.skips).toBe(1);
    expect(summary.heardThroughMs).toBe(130_000);
  });

  it('catches a skip even when the page does not report it as one', () => {
    const events = honest().filter((e) => e.positionMs <= 100_000 || e.positionMs >= 400_000);
    // Positions resume at 400 s only 5 s after 100 s.
    let clientMs = SETUP_MS + 100_000;
    for (const e of events.filter((ev) => ev.positionMs >= 400_000)) { clientMs += 5000; e.clientMs = clientMs; e.at = START + clientMs + 100; }
    const summary = summarizeListening(events, START);
    expect(summary.skips).toBeGreaterThanOrEqual(1);
    expect(summary.heardThroughMs).toBe(100_000);
  });

  it('gives credit if the student skipped but then went back and listened properly', () => {
    const events: ListenEvent[] = [];
    let clientMs = SETUP_MS;
    const push = (kind: ListenEvent['kind'], positionMs: number) => events.push({ kind, positionMs, clientMs, at: START + clientMs + 100 });
    push('play', 0);
    for (let p = 5000; p <= 130_000; p += 5000) { clientMs += 5000; push('tick', p); }
    clientMs += 300; push('seek', 460_000);
    clientMs += 300; push('seek', 130_000);
    for (let p = 135_000; p <= LAB_MS; p += 5000) { clientMs += 5000; push('tick', p); }
    expect(summarizeListening(events, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 1 });
  });

  it('carries "heard through" across no seek forward past it, however small the steps', () => {
    // Plays to 2:00, then walks on in 300 ms seeks with a 1 ms tick after every third.
    const events: ListenEvent[] = [];
    let clientMs = SETUP_MS;
    const push = (kind: ListenEvent['kind'], positionMs: number) => events.push({ kind, positionMs, clientMs, at: START + clientMs + 100 });
    push('play', 0);
    for (let p = 5000; p <= 120_000; p += 5000) { clientMs += 5000; push('tick', p); }
    let pos = 120_000;
    while (pos < LAB_MS) {
      for (let k = 0; k < 3; k++) { pos += 300; clientMs += 1; push('seek', pos); }
      pos += 1; clientMs += 1; push('tick', pos);
    }
    expect(summarizeListening(events, START).heardThroughMs).toBe(120_000);
  });

  it('carries on after a seek that lands where playback was (resuming after an error)', () => {
    const events = honest();
    const at = events.findIndex((e) => e.positionMs === 300_000);
    const e = events[at];
    // Paused at 5:00 by the error, reloaded and put back 20 ms on.
    events.splice(at + 1, 0, { kind: 'pause', positionMs: 300_000, clientMs: e.clientMs + 100, at: e.at + 100 },
      { kind: 'seek', positionMs: 300_020, clientMs: e.clientMs + 9000, at: e.at + 9000 });
    for (const later of events.slice(at + 3)) { later.clientMs += 9000; later.at += 9000; }
    expect(summarizeListening(events, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
  });

  it('catches playback sped up to 2x', () => {
    const events: ListenEvent[] = [];
    let clientMs = SETUP_MS;
    for (let p = 0; p <= LAB_MS; p += 10_000) {
      events.push({ kind: p === 0 ? 'play' : 'tick', positionMs: p, clientMs, at: START + clientMs + 100 });
      clientMs += 5000;
    }
    const summary = summarizeListening(events, START);
    expect(summary.heardThroughMs).toBeLessThan(15_000);
    expect(summary.skips).toBeGreaterThan(50);
  });

  it('catches a page whose clock was run fast to cover a skip', () => {
    // Consistent with itself (position == page clock), but the page claims
    // eleven minutes passed when the server saw one.
    const events: ListenEvent[] = [];
    for (let p = 0; p <= LAB_MS; p += 5000) {
      events.push({ kind: p === 0 ? 'play' : 'tick', positionMs: p, clientMs: p, at: START + p / 11 });
    }
    const summary = summarizeListening(events, START);
    expect(summary.heardThroughMs).toBeLessThan(10_000);
    expect(summary.skips).toBeGreaterThan(100);
  });

  it('gives nothing for a log that starts in the middle, however long the student waited first', () => {
    const events: ListenEvent[] = [];
    for (let p = 300_000; p <= LAB_MS; p += 5000) {
      const clientMs = SETUP_MS + p;
      events.push({ kind: 'tick', positionMs: p, clientMs, at: START + clientMs });
    }
    const summary = summarizeListening(events, START);
    expect(summary.heardThroughMs).toBe(0);
    expect(summary.skips).toBe(1);
  });

  it('bridges the first tick or two if they never arrived, but no more', () => {
    const lostTwo = honest().filter((e) => e.positionMs >= 10_000);
    expect(summarizeListening(lostTwo, START).heardThroughMs).toBe(LAB_MS);
    const lostAMinute = honest().filter((e) => e.positionMs >= 60_000);
    expect(summarizeListening(lostAMinute, START).heardThroughMs).toBe(0);
  });

  it('ignores the server’s own "opened" marker', () => {
    const withOpen: ListenEvent[] = [{ kind: 'open', positionMs: 0, clientMs: 0, at: START }, ...honest()];
    expect(summarizeListening(withOpen, START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
    expect(summarizeListening([{ kind: 'open', positionMs: 0, clientMs: 0, at: START }], START).lastAt).toBeNull();
  });

  it('reads the page’s "no microphone from here" mark as nothing played: no skip, no credit, wherever it stands', () => {
    // "My mic doesn't work" before Start (at 0), and a stray mark far ahead mid-lab.
    const marks: ListenEvent[] = [
      { kind: 'nomic', positionMs: 0, clientMs: SETUP_MS - 5000, at: START + SETUP_MS - 4900 },
      { kind: 'nomic', positionMs: 600_000, clientMs: SETUP_MS + 100_000, at: START + SETUP_MS + 100_100 },
    ];
    expect(summarizeListening([...marks, ...honest()], START)).toMatchObject({ heardThroughMs: LAB_MS, skips: 0 });
    expect(summarizeListening(marks, START)).toMatchObject({ heardThroughMs: 0, skips: 0, lastAt: null });
  });

  it('gives nothing for an empty log', () => {
    expect(summarizeListening([], START)).toEqual({ heardThroughMs: 0, skips: 0, lastPositionMs: null, lastAt: null });
  });
});
