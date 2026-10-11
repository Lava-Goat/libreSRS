// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import type { PauseAnswer } from '@libresrs/shared';
import { MAX_SENT_PER_PAUSE, PAUSED_CARRY_MS, PauseTracker, type PauseSample } from './pauseTracker';

/** Two pauses: windows [10300, 13900] (3.6 s) and [20300, 23400] (3.1 s). */
const PAUSES: [number, number][] = [[10_000, 14_000], [20_000, 23_500]];
const FLOOR = 250;
const STEP = 50;

type Voice = (positionMs: number) => boolean;
const silent: Voice = () => false;
const between = (from: number, to: number): Voice => (p) => p >= from && p < to;

/** Plays the lab through a tracker the way the page samples it: every 50 ms of audio and of wall time. */
class Player {
  pos = 0;
  wall = 1000;
  readonly tracker: PauseTracker;

  constructor(pauses: [number, number][] = PAUSES, floorMs = FLOOR) {
    this.tracker = new PauseTracker(pauses, { floorMs });
  }

  play(untilMs: number, voiced: Voice = silent) {
    while (this.pos < untilMs) {
      const step = Math.min(STEP, untilMs - this.pos);
      this.pos += step;
      this.wall += step;
      this.tracker.sample({ positionMs: this.pos, wallMs: this.wall, frameMs: step, voiced: voiced(this.pos), mode: 'playing' });
    }
    return this;
  }

  /** The student paused: the audio stands still, the microphone keeps listening. */
  pause(forMs: number, voiced = true) {
    for (let t = 0; t < forMs; t += STEP) {
      this.wall += STEP;
      this.tracker.sample({ positionMs: this.pos, wallMs: this.wall, frameMs: STEP, voiced, mode: 'paused' });
    }
    return this;
  }

  /** A seek: the next sample finds the audio somewhere else within one frame of wall time. */
  seek(toMs: number) {
    this.pos = toMs;
    return this;
  }
}

describe('PauseTracker: a pass through a pause', () => {
  it('counts voice only in the window, from 0.3 s after the pause starts to 0.1 s before it ends', () => {
    const outsideTheWindow = new Player().play(16_000, (p) => (p >= 10_000 && p < 10_300) || (p > 13_900 && p <= 14_000));
    expect(outsideTheWindow.tracker.takeResults(10)).toEqual([[10_000, 0]]);

    // Samples at 11000, 11050, ... 11950: twenty frames of 50 ms.
    const inside = new Player().play(16_000, between(11_000, 12_000));
    expect(inside.tracker.takeResults(10)).toEqual([[10_000, 1000]]);

    // Voice through the whole pause and beyond is capped at the window.
    const throughout = new Player().play(16_000, () => true);
    expect(throughout.tracker.takeResults(10)).toEqual([[10_000, 3600]]);
  });

  it('honours other lead and tail cuts', () => {
    const tracker = new PauseTracker([[10_000, 14_000]], { floorMs: FLOOR, leadMs: 1000, tailCutMs: 1000 });
    let wall = 0;
    for (let pos = 50; pos <= 15_000; pos += 50) {
      wall += 50;
      tracker.sample({ positionMs: pos, wallMs: wall, frameMs: 50, voiced: true, mode: 'playing' });
    }
    expect(tracker.takeResults(10)).toEqual([[10_000, 2000]]);
  });

  it('opens a pass only when playback enters the window from before it, and finishes it once playback passes the end', () => {
    const player = new Player().play(10_250);
    expect(player.tracker.current()).toBeNull();
    player.play(10_300);
    expect(player.tracker.current()).toEqual({ index: 0, inWindowMs: 50, voicedMs: 0 });
    player.play(13_900, between(12_000, 12_500));
    expect(player.tracker.current()).toMatchObject({ index: 0, voicedMs: 500 });
    expect(player.tracker.takeResults(10)).toEqual([]);
    player.play(13_950);
    expect(player.tracker.current()).toBeNull();
    expect(player.tracker.lastFinished()).toEqual({ index: 0, answered: true });
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 500]]);
  });

  it('drops a pass at a jump, and never reports one entered mid-window', () => {
    // Forward past the page's clock inside the window: dropped.
    const skipped = new Player().play(11_000, () => true).seek(12_000).play(16_000, () => true);
    expect(skipped.tracker.takeResults(10)).toEqual([]);
    expect(skipped.tracker.finishedCount()).toBe(0);

    // Back out of the window: dropped; the replay that enters from before counts.
    const back = new Player().play(12_000, () => true).seek(2_000);
    back.play(2_050);
    expect(back.tracker.current()).toBeNull();
    back.play(16_000, between(11_000, 11_500));
    expect(back.tracker.takeResults(10)).toEqual([[10_000, 500]]);

    // Arriving in the middle of a window by a seek: nothing that pause.
    const midway = new Player().play(5_000).seek(11_000).play(16_000, () => true);
    expect(midway.tracker.takeResults(10)).toEqual([]);

    // A few ms back is jitter, not a jump.
    const jitter = new Player().play(11_000, () => true);
    jitter.pos -= 200;
    jitter.play(16_000, () => true);
    expect(jitter.tracker.takeResults(10)).toEqual([[10_000, 3600]]);
  });

  it('keeps the pass through a 2 s stall inside the window, crediting at most 200 ms of voice for it', () => {
    const player = new Player().play(11_000);
    // The page's timer stalls for 2 s while the audio plays on.
    player.pos += 2000;
    player.wall += 2000;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 2000, voiced: true, mode: 'playing' });
    expect(player.tracker.current()).toMatchObject({ index: 0, voicedMs: 200 });
    player.play(16_000);
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 200]]);
  });

  it('keeps the pass when the position is read late after a stall (Firefox), and still drops a later jump', () => {
    const player = new Player().play(11_000, () => true);
    // The page stalls for 2 s while the audio plays on; the first sample after it reads the old position...
    player.wall += 2000;
    player.pos += 50;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 200, voiced: true, mode: 'playing' });
    // ...and the next one, 50 ms later, where the audio really is.
    player.pos += 1950;
    player.wall += 50;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 50, voiced: true, mode: 'playing' });
    expect(player.tracker.current()).toMatchObject({ index: 0 });
    player.play(16_000, () => true);
    const [[start, voiced]] = player.tracker.takeResults(10);
    expect(start).toBe(10_000);
    // The voice before the stall, its capped frames, and the rest of the window after it.
    expect(voiced).toBeGreaterThanOrEqual(700 + 200 + 50 + 850);

    // A leap forward long after a stall is a jump again.
    const later = new Player().play(10_500);
    later.wall += 3000;
    later.pos += 50;
    later.tracker.sample({ positionMs: later.pos, wallMs: later.wall, frameMs: 200, voiced: true, mode: 'playing' });
    later.play(11_600, () => true);
    later.seek(13_000).play(16_000, () => true);
    expect(later.tracker.takeResults(10)).toEqual([]);

    // And pausing is not falling behind: a leap forward after a pause is a jump.
    const paused = new Player().play(11_000, () => true).pause(3000, false);
    paused.seek(13_000).play(16_000, () => true);
    expect(paused.tracker.takeResults(10)).toEqual([]);
  });

  it('says when a position read now looks stale, so the page can hold its report until it catches up', () => {
    const player = new Player().play(11_000);
    expect(player.tracker.positionSuspect(11_050, player.wall + 50)).toBe(false);
    // The page froze for 2.5 s while the audio played on. Read before any sample after it: stale.
    expect(player.tracker.positionSuspect(11_050, player.wall + 2500)).toBe(true);
    expect(player.tracker.positionSuspect(13_500, player.wall + 2500)).toBe(false);
    // The sample after the freeze read the old position: suspect until it catches up.
    player.wall += 2500;
    player.pos += 50;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 200, voiced: false, mode: 'playing' });
    expect(player.tracker.positionSuspect(player.pos, player.wall + 50)).toBe(true);
    player.pos += 2500;
    player.wall += 50;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 50, voiced: false, mode: 'playing' });
    expect(player.tracker.positionSuspect(player.pos + 50, player.wall + 50)).toBe(false);
    expect(player.tracker.current()).toMatchObject({ index: 0 });
  });

  it('keeps the pass through buffering: the audio stands still while time passes', () => {
    const player = new Player().play(11_000);
    player.wall += 8000;
    player.play(16_000, between(12_000, 12_300));
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 300]]);
  });

  it('reports nothing for a window crossed without a sample inside it', () => {
    const player = new Player().play(10_000);
    player.pos = 14_500;
    player.wall += 4500;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: 200, voiced: true, mode: 'playing' });
    player.play(16_000);
    expect(player.tracker.takeResults(10)).toEqual([]);
  });
});

describe('PauseTracker: pausing', () => {
  it('keeps counting voice while the student has paused inside the window, capped at the window', () => {
    const answered = new Player().play(11_000).pause(1000).play(16_000);
    expect(answered.tracker.takeResults(10)).toEqual([[10_000, 1000]]);

    const long = new Player().play(11_000).pause(10_000).play(16_000, () => true);
    expect(long.tracker.takeResults(10)).toEqual([[10_000, 3600]]);
  });

  it('counts at most half the window of voice heard while paused (or the floor, if more): a long answer never looks like sound through the pause', () => {
    // Ten seconds of talking while paused, then quiet: 1.8 s of the 3.6 s window.
    const talking = new Player().play(11_000).pause(10_000).play(16_000);
    expect(talking.tracker.takeResults(10)).toEqual([[10_000, 1800]]);
    // With a 2 s floor, what was said while paused can still reach it.
    const strict = new Player(PAUSES, 2000).play(11_000).pause(10_000).play(16_000);
    expect(strict.tracker.takeResults(10)).toEqual([[10_000, 2000]]);
    expect(strict.tracker.answeredCount()).toBe(1);
  });

  it('carries an answer given while paused just before the pause into it, when playback resumes from there', () => {
    // Pause pressed 0.2 s before the pause starts (0.5 s before its window); answered while paused.
    const early = new Player().play(9_800).pause(800).play(16_000);
    expect(early.tracker.takeResults(10)).toEqual([[10_000, 800]]);
    // ...or in its first 0.3 s, before voice counts while playing.
    const lead = new Player().play(10_100).pause(600);
    lead.play(10_400);
    expect(lead.tracker.nudge()).toBe('heard');
    lead.play(16_000);
    expect(lead.tracker.takeResults(10)).toEqual([[10_000, 600]]);
    // Paused well before the pause (mid-prompt): nothing is carried.
    const far = new Player().play(10_300 - PAUSED_CARRY_MS - 100).pause(800).play(16_000);
    expect(far.tracker.takeResults(10)).toEqual([[10_000, 0]]);
    // Nor across a jump.
    const jumped = new Player().play(9_800).pause(800);
    jumped.seek(2_000).play(16_000);
    expect(jumped.tracker.takeResults(10)).toEqual([[10_000, 0]]);
  });

  it('counts nothing while paused outside a window, and nothing towards the time played', () => {
    const player = new Player().play(5_000).pause(3000);
    expect(player.tracker.outside()).toEqual({ voicedMs: 0, playedMs: 5000 });
    player.play(16_000);
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 0]]);
  });

  it('adds nothing while the page is hidden (it is not sampled), and the pass survives the gap', () => {
    const player = new Player().play(11_000, between(10_500, 10_600));
    // Hidden for a minute: the page takes no samples, so the tracker hears nothing.
    player.wall += 60_000;
    player.pause(100, false).play(16_000);
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 100]]);
  });

  it('does not show the in-pause time as time in the window', () => {
    const player = new Player().play(10_500).pause(5000, false);
    expect(player.tracker.current()?.inWindowMs).toBe(250);
    expect(player.tracker.nudge()).toBeNull();
  });

  it('finishes a pass paused just past the window, once paused there', () => {
    const player = new Player().play(13_950 - STEP, between(11_000, 11_300));
    player.pos = 13_950; // stopped between two samples, past the window
    player.wall += STEP;
    player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: STEP, voiced: false, mode: 'paused' });
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 300]]);
  });
});

describe('PauseTracker: results', () => {
  it('sends every pass through a pause, a replay that does not beat the best too; the tally keeps the best', () => {
    const player = new Player().play(16_000, between(11_000, 11_500));
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 500]]);

    // A silent replay after Back 10 s goes as well: with the page's own result in that
    // playback, one a console script adds there makes two, and the server rejects both.
    player.seek(8_000).play(16_000);
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 0]]);
    expect(player.tracker.lastFinished()).toEqual({ index: 0, answered: false });
    expect(player.tracker.states()).toEqual(['answered', null]);
    expect(player.tracker.answeredCount()).toBe(1);

    player.seek(8_000).play(16_000, between(11_000, 11_500));
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 500]]);

    player.seek(8_000).play(16_000, between(11_000, 12_000));
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 1000]]);
    expect(player.tracker.answeredCount()).toBe(1);
  });

  it('keeps one result per pause waiting: a replay finished before the last was taken joins it, as the better of the two', () => {
    // The page takes what the tracker holds before every jump; only a full report queue leaves one behind.
    const better = new Player().play(16_000, between(11_000, 11_100));
    better.seek(8_000).play(16_000, between(11_000, 11_600));
    expect(better.tracker.takeResults(10)).toEqual([[10_000, 600]]);
    const worse = new Player().play(16_000, between(11_000, 11_600));
    worse.seek(8_000).play(16_000);
    expect(worse.tracker.takeResults(10)).toEqual([[10_000, 600]]);
    expect(worse.tracker.answeredCount()).toBe(1);
  });

  it(`counts silent replays against the ${MAX_SENT_PER_PAUSE} results a pause may send`, () => {
    const player = new Player().play(16_000, between(11_000, 11_500));
    const sent: PauseAnswer[] = player.tracker.takeResults(10);
    for (let i = 0; i < MAX_SENT_PER_PAUSE; i += 1) {
      player.seek(8_000).play(16_000);
      sent.push(...player.tracker.takeResults(10));
    }
    // The fifth pass sends nothing: the server would refuse it.
    expect(sent).toEqual([[10_000, 500], [10_000, 0], [10_000, 0], [10_000, 0]]);
    expect(player.tracker.states()).toEqual(['answered', null]);
  });

  it('says how many results wait to go, and where it last sampled the audio', () => {
    const player = new Player();
    expect(player.tracker.lastPositionMs).toBeNull();
    expect(player.tracker.unsent).toBe(0);
    player.play(16_000, between(11_000, 11_500));
    expect(player.tracker.unsent).toBe(1);
    expect(player.tracker.lastPositionMs).toBe(16_000);
    player.pause(500);
    expect(player.tracker.lastPositionMs).toBe(16_000);
    player.tracker.takeResults(10);
    expect(player.tracker.unsent).toBe(0);
  });

  it(`never sends more than ${MAX_SENT_PER_PAUSE} results for one pause, and counts only what it sent`, () => {
    const sent: number[] = [];
    const player = new Player();
    // Each replay has 100 ms more voice than the one before (100 … 600 ms); each is taken before the next.
    for (let i = 1; i <= MAX_SENT_PER_PAUSE + 2; i += 1) {
      player.seek(8_000).play(16_000, between(11_000, 11_000 + i * 100));
      sent.push(...player.tracker.takeResults(10).map(([, v]) => v));
    }
    expect(sent).toEqual([100, 200, 300, 400]);
    // The better passes after the fourth were not sent, so they do not count on the page either.
    expect(player.tracker.states()).toEqual(['answered', null]);
    expect(player.tracker.finishedCount()).toBe(1);
    expect(player.tracker.lastFinished()).toEqual({ index: 0, answered: true });
  });

  it('settle finishes a pass playback has just passed, and drops one still open', () => {
    const passed = new Player().play(13_880, between(11_000, 11_400));
    passed.tracker.settle(13_920, passed.wall + 40);
    expect(passed.tracker.takeResults(10)).toEqual([[10_000, 400]]);

    const open = new Player().play(12_000, between(11_000, 11_400));
    open.tracker.settle(12_000, open.wall + 5);
    expect(open.tracker.current()).toBeNull();
    // Playing on from inside the window is not entering it from before.
    open.play(16_000, () => true);
    expect(open.tracker.takeResults(10)).toEqual([]);
    expect(open.tracker.finishedCount()).toBe(0);
  });

  it('takes at most the number of results asked for, oldest first', () => {
    const pauses: [number, number][] = [[5_000, 9_000], [10_000, 14_000], [20_000, 23_500]];
    const player = new Player(pauses).play(25_000, () => true);
    expect(player.tracker.takeResults(2)).toEqual([[5_000, 3600], [10_000, 3600]]);
    expect(player.tracker.takeResults(2)).toEqual([[20_000, 3100]]);
    expect(player.tracker.takeResults(2)).toEqual([]);
  });

  it('counts pauses answered and finished, and each pause’s state', () => {
    const player = new Player().play(16_000, between(11_000, 11_300));
    expect(player.tracker.states()).toEqual(['answered', null]);
    player.play(25_000, between(21_000, 21_200));
    expect(player.tracker.finishedCount()).toBe(2);
    expect(player.tracker.answeredCount()).toBe(1);
    expect(player.tracker.states()).toEqual(['answered', 'missed']);
    expect(player.tracker.starts).toEqual([10_000, 20_000]);
    expect(player.tracker.count).toBe(2);
  });

  it('counts a result exactly at the floor as answered, and one under it as missed', () => {
    const atFloor = new Player().play(16_000, between(11_000, 11_250));
    expect(atFloor.tracker.answeredCount()).toBe(1);
    const under = new Player().play(16_000, between(11_000, 11_200));
    expect(under.tracker.answeredCount()).toBe(0);
    expect(under.tracker.finishedCount()).toBe(1);
  });

  it('adds up the time played outside every window, and the voice in it', () => {
    const player = new Player().play(5_000, between(1_000, 2_000));
    expect(player.tracker.outside()).toEqual({ voicedMs: 1000, playedMs: 5000 });
    // Inside the window is not outside; the pause's first 0.3 s is.
    player.play(16_000, () => true);
    const window = 13_900 - 10_300 + STEP; // samples from 10300 to 13900 inclusive
    expect(player.tracker.outside().playedMs).toBe(16_000 - window);
    expect(player.tracker.outside().voicedMs).toBe(1000 + (16_000 - 5_000) - window);
  });

  it('starts again from nothing on reset', () => {
    const player = new Player().play(16_000, () => true);
    player.tracker.reset();
    expect(player.tracker.takeResults(10)).toEqual([]);
    expect(player.tracker.finishedCount()).toBe(0);
    expect(player.tracker.outside()).toEqual({ voicedMs: 0, playedMs: 0 });
    expect(player.tracker.lastFinished()).toBeNull();
  });
});

describe('PauseTracker: what the student is told', () => {
  it('says nothing for the first 2 s in a pause, then "quiet" while there is no voice', () => {
    const player = new Player().play(12_200);
    expect(player.tracker.nudge()).toBeNull();
    player.play(12_300);
    expect(player.tracker.current()?.inWindowMs).toBe(2050);
    expect(player.tracker.nudge()).toBe('quiet');
  });

  it('says "heard" once the voice reaches the floor, and nothing after an answered pause', () => {
    const player = new Player().play(10_500, between(10_300, 10_450));
    expect(player.tracker.nudge()).toBeNull();
    player.play(10_600, () => true);
    expect(player.tracker.nudge()).toBe('heard');
    player.play(16_000);
    expect(player.tracker.nudge()).toBeNull();
  });

  it('a little voice is not "quiet", nor "heard"', () => {
    const player = new Player().play(13_000, between(10_400, 10_550));
    expect(player.tracker.current()?.voicedMs).toBe(150);
    expect(player.tracker.nudge()).toBeNull();
  });

  it('says "missed" after a pause that finished under the floor, until the next one opens', () => {
    const player = new Player().play(16_000);
    expect(player.tracker.nudge()).toBe('missed');
    player.play(20_250);
    expect(player.tracker.nudge()).toBe('missed');
    player.play(20_300);
    expect(player.tracker.nudge()).toBeNull();
    expect(player.tracker.lastFinished()).toBeNull();
  });
});

describe('PauseTracker: sound that is not a voice', () => {
  /** Plays with the meter's two answers per frame: `loud` (over the room's level) and `voiced`. */
  function playHeard(player: Player, untilMs: number, loud: Voice, voiced: Voice = silent) {
    while (player.pos < untilMs) {
      player.pos += STEP;
      player.wall += STEP;
      player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: STEP, voiced: voiced(player.pos), loud: loud(player.pos), mode: 'playing' });
    }
  }

  it('says "sound" instead of "quiet" when taps or noise fill the pause but no voice does', () => {
    const player = new Player();
    playHeard(player, 12_300, between(10_300, 12_300));
    expect(player.tracker.current()?.inWindowMs).toBe(2050);
    expect(player.tracker.nudge()).toBe('sound');
    // It is not an answer.
    playHeard(player, 16_000, () => true);
    expect(player.tracker.takeResults(10)).toEqual([[10_000, 0]]);
    expect(player.tracker.nudge()).toBe('missed');
  });

  it('needs 0.4 s of such sound; less is still "quiet", and a voice is "heard" whatever else there was', () => {
    const little = new Player();
    playHeard(little, 12_300, between(11_000, 11_350));
    expect(little.tracker.nudge()).toBe('quiet');
    const enough = new Player();
    playHeard(enough, 12_300, between(11_000, 11_400));
    expect(enough.tracker.nudge()).toBe('sound');
    const answered = new Player();
    playHeard(answered, 12_300, between(10_300, 12_300), between(12_000, 12_300));
    expect(answered.tracker.nudge()).toBe('heard');
  });

  it('adds up such sound in the counted windows only, over every pass, playing or paused; reset clears it', () => {
    const player = new Player();
    // 1 s outside the pauses, 0.5 s in the first window, 0.2 s while paused in it, a replay with 0.3 s more.
    playHeard(player, 11_500, (p) => (p > 5_000 && p <= 6_000) || (p > 11_000 && p <= 11_500));
    for (let t = 0; t < 200; t += STEP) {
      player.wall += STEP;
      player.tracker.sample({ positionMs: player.pos, wallMs: player.wall, frameMs: STEP, voiced: false, loud: true, mode: 'paused' });
    }
    playHeard(player, 16_000, silent);
    player.seek(8_000);
    playHeard(player, 16_000, between(12_000, 12_300));
    expect(player.tracker.soundInPausesMs()).toBe(500 + 200 + 300);
    // Voice is not counted as sound.
    playHeard(player, 25_000, () => true, () => true);
    expect(player.tracker.soundInPausesMs()).toBe(1000);
    player.tracker.reset();
    expect(player.tracker.soundInPausesMs()).toBe(0);
  });

  it('without `loud`, a frame is as loud as it is voiced (old callers count no such sound)', () => {
    const player = new Player().play(16_000, () => true);
    expect(player.tracker.soundInPausesMs()).toBe(0);
  });
});

describe('PauseTracker: fed late, as the voice meter decides frames', () => {
  /**
   * The same session fed twice: at once, and through a 4-frame delay line
   * (the meter's look-ahead) that is flushed before each settle. Each sample
   * carries its own frame's position and wall time, so nothing may differ.
   */
  it('gives the same results, states, nudges and counts', () => {
    type Step = { sample: PauseSample } | { settle: [number, number] };
    const steps: Step[] = [];
    let pos = 0;
    let wall = 1000;
    const play = (until: number, voiced: Voice, loud: Voice = voiced) => {
      while (pos < until) {
        pos += STEP;
        wall += STEP;
        steps.push({ sample: { positionMs: pos, wallMs: wall, frameMs: STEP, voiced: voiced(pos), loud: loud(pos), mode: 'playing' } });
      }
    };
    const pause = (ms: number, voiced: boolean) => {
      for (let t = 0; t < ms; t += STEP) {
        wall += STEP;
        steps.push({ sample: { positionMs: pos, wallMs: wall, frameMs: STEP, voiced, mode: 'paused' } });
      }
    };
    play(11_000, between(10_500, 11_000));
    pause(600, true);
    play(13_950, silent, between(12_000, 13_000));
    // Back 10 s just after the window: settle, then the jump.
    steps.push({ settle: [13_950, wall] });
    pos = 3_950;
    play(16_000, between(11_000, 12_000));
    play(22_500, between(20_500, 20_550), between(21_000, 22_000));
    // A stall inside the second window (the page froze while the audio played on), and the end.
    wall += 600;
    pos += 600;
    steps.push({ sample: { positionMs: pos, wallMs: wall, frameMs: 600, voiced: false, loud: true, mode: 'playing' } });
    play(23_450, silent);
    steps.push({ settle: [23_450, wall] });

    const observe = (tracker: PauseTracker) => ({
      results: tracker.takeResults(100),
      states: tracker.states(),
      answered: tracker.answeredCount(),
      finished: tracker.finishedCount(),
      outside: tracker.outside(),
      sound: tracker.soundInPausesMs(),
      last: tracker.lastFinished(),
    });

    const atOnce = new PauseTracker(PAUSES, { floorMs: FLOOR });
    const late = new PauseTracker(PAUSES, { floorMs: FLOOR });
    const delay: PauseSample[] = [];
    const nudgesAtOnce: (string | null)[] = [];
    const nudgesLate: (string | null)[] = [];
    const feedLate = (sample: PauseSample) => {
      late.sample(sample);
      nudgesLate.push(late.nudge());
    };
    for (const step of steps) {
      if ('settle' in step) {
        atOnce.settle(...step.settle);
        // The page's flushAndSettle: what the meter holds goes in first.
        for (const held of delay.splice(0)) feedLate(held);
        late.settle(...step.settle);
        continue;
      }
      atOnce.sample(step.sample);
      nudgesAtOnce.push(atOnce.nudge());
      delay.push(step.sample);
      if (delay.length > 4) feedLate(delay.shift()!);
    }
    // Each sample leaves the same nudge behind, only later.
    expect(nudgesLate).toEqual(nudgesAtOnce);
    expect(nudgesAtOnce).toEqual(expect.arrayContaining(['heard', 'sound', 'missed']));
    expect(late.nudge()).toBe('missed');
    expect(atOnce.nudge()).toBe('missed');
    const [lateSeen, atOnceSeen] = [observe(late), observe(atOnce)];
    expect(lateSeen).toEqual(atOnceSeen);
    expect(atOnceSeen.results).toEqual([[10_000, 1100], [20_000, 50]]);
    expect(atOnceSeen.states).toEqual(['answered', 'missed']);
  });
});

describe('PauseTracker: one result per pause in each playback', () => {
  /**
   * The page's side of the server's rule that two results for one pause in
   * one playback are a script's, and are all rejected. Random honest sessions:
   * voice here and there (or none), pausing, Back 10 s (settled first) and seeks back
   * from elsewhere (not settled), with the results taken on a tick every 5 s
   * and before every jump, as LabRunner takes them. Each result must be the
   * only one for its pause in its playback, and that playback must have played
   * the pause's window through from before it.
   */
  it('never sends two for one pause in one playback, and each rides in the playback that played it', () => {
    const windows = PAUSES.map(([s, e]) => ({ start: s, from: s + 300, to: e - 100 }));
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let results = 0;
    let replayed = 0;
    let unanswered = 0;
    for (let session = 0; session < 150; session += 1) {
      const player = new Player();
      let playback = 0;
      let startedAt = 0;
      let seeks = 0;
      let lastTick = player.wall;
      const perPlayback = new Map<string, number>();
      const misplaced: string[] = [];
      const take = () => {
        for (const [start, value] of player.tracker.takeResults(20)) {
          const key = `${playback}:${start}`;
          perPlayback.set(key, (perPlayback.get(key) ?? 0) + 1);
          const w = windows.find((x) => x.start === start)!;
          if (!(startedAt < w.from && player.pos >= w.to)) misplaced.push(`${key} from ${startedAt} at ${player.pos}`);
          results += 1;
          if (value < FLOOR) unanswered += 1;
        }
      };
      // Every third student stays silent.
      const talk = session % 3 === 0 ? 0 : 0.3;
      while (player.pos < 26_000) {
        const voiced = rnd() < talk;
        player.play(player.pos + STEP, () => voiced);
        if (player.wall - lastTick >= 5000) {
          lastTick = player.wall;
          take();
        }
        const r = rnd();
        if (r < 0.01) {
          player.pause(STEP * Math.floor(rnd() * 40), rnd() < 0.5);
        } else if (r < 0.015 && player.pos > 3000 && seeks < 4) {
          seeks += 1;
          const back10 = rnd() < 0.5;
          if (back10) player.tracker.settle(player.pos, player.wall);
          take();
          const to = Math.max(0, player.pos - (back10 ? 10_000 : 1000 + Math.round(rnd() * 14_000)));
          player.seek(Math.round(to / STEP) * STEP);
          playback += 1;
          startedAt = player.pos;
        }
      }
      player.tracker.settle(player.pos, player.wall);
      take();
      expect(misplaced).toEqual([]);
      expect([...perPlayback].filter(([, n]) => n > 1)).toEqual([]);
      replayed += [...perPlayback.keys()].filter((key) => !key.startsWith('0:')).length;
    }
    // The sessions did finish passes, replay pauses, and send results that were not answered.
    expect(results).toBeGreaterThan(250);
    expect(replayed).toBeGreaterThan(150);
    expect(unanswered).toBeGreaterThan(20);
  });
});
