// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Voice in the answer pauses of a lab, as the student's page measures it.
 *
 * The page samples its microphone every 50 ms. For each counted pause the
 * session began with, the tracker adds up the voice heard in the pause's
 * window (from 0.3 s after it starts to 0.1 s before it ends) during one pass
 * of playback through it, and turns each finished pass into a result,
 * `[pauseStartMs, voicedMs]`. Nothing is recorded: two integers per pause
 * leave the page, riding on the listening reports it already sends.
 *
 * The rules mirror the server's (services/labPauses.ts), so the page never
 * counts a pause the server would refuse:
 *
 * - a pass opens only when continuous playback enters the window from before
 *   it. Starting mid-window after a jump is never reported;
 * - continuity is judged against real (uncapped) wall time plus 0.75 s, as the
 *   page's own listening coverage is: a 2 s stall keeps the pass, a seek
 *   drops it unreported. Firefox reads the audio's old position just after a
 *   stall and the new one a sample later, so the time a position fell behind
 *   may be made up within a second;
 * - while the student has paused inside the window, voice still counts
 *   (pausing to answer is normal), up to half the window (or the floor, if
 *   higher): an answer given while paused counts, but sound heard all through
 *   a long pause never makes a pause look filled with sound. Voice heard while
 *   paused just before the window (the press landed a moment early) is carried
 *   into the pass that opens when playback resumes from there;
 * - the pass finishes when playback passes the window's end, and every
 *   finished pass sends its result, up to MAX_SENT_PER_PAUSE per pause, even
 *   one that does not beat the best. The server takes the best of the
 *   playbacks and rejects a pause's results in any playback that got two, so a
 *   replay the page sent nothing for would leave room for a result a console
 *   script adds. The page sends what the tracker holds before any seek
 *   (LabRunner), so a pass's result always rides in the pass's own playback.
 *
 * The page feeds it frames its voice meter (voiceMeter.ts) has decided, a few
 * frames late; each sample carries the position and wall time of its own
 * frame, so the results are the same as fed at once, as long as the page
 * flushes the meter before it settles the tracker. Sound the meter heard over
 * the room's level that was not a voice (taps, noise) is added up in the
 * windows too, for the "not a voice" nudge and the teacher's stats.
 *
 * Pure: the page feeds it samples, and it touches nothing else.
 */
import { PAUSE_LEAD_MS, PAUSE_TAIL_CUT_MS, type PauseAnswer } from '@libresrs/shared';

/** 'playing': the lab audio is playing. 'paused': the student paused it, and the page can hear them. */
export type SampleMode = 'playing' | 'paused';

export interface PauseSample {
  /** Where the lab audio is (ms). */
  positionMs: number;
  /** performance.now() when sampled. */
  wallMs: number;
  /** Time since the previous microphone sample (ms). */
  frameMs: number;
  /** Whether the microphone heard a voice in this frame. */
  voiced: boolean;
  /** Whether it heard a sound over the room's level, voice or not (default: `voiced`). */
  loud?: boolean;
  mode: SampleMode;
}

export interface PauseTrackerOptions {
  /** Voice counts from this long after a pause starts (default PAUSE_LEAD_MS). */
  leadMs?: number;
  /** ...until this long before it ends (default PAUSE_TAIL_CUT_MS). */
  tailCutMs?: number;
  /** Audio may run this far ahead of wall time between samples and still be continuous playback. */
  slackMs?: number;
  /** Voice in a pause for it to count as answered (the session's floor). */
  floorMs: number;
}

/**
 * What the page shows in and after a pause. 'sound': sound, but not a voice
 * (taps, noise, a whisper); 'quiet': hardly anything.
 */
export type PauseNudge = 'quiet' | 'sound' | 'heard' | 'missed' | null;

/** Where each counted pause stands: answered, finished under the floor, or not finished yet. */
export type PauseState = 'answered' | 'missed' | null;

/** Going back further than this between two samples is a jump (the server's rule too). */
const BACKWARD_JUMP_MS = 300;
/**
 * How long a position that fell behind the wall clock (read late: Firefox
 * gives the old position just after the page stalls) may take to catch up
 * before a leap forward counts as a jump again.
 */
const LATE_POSITION_GRACE_MS = 1000;
/** A frame's voice credit is capped: a stalled page must not claim seconds of voice from one sample. */
const MAX_FRAME_MS = 200;
/** "We can't hear you": this long in the window... */
export const QUIET_AFTER_MS = 2000;
/** ...with less voice than this. */
export const QUIET_BELOW_MS = 100;
/** "We hear sound, but not a voice": as "quiet", with at least this much sound that was not a voice. */
export const SOUND_AT_LEAST_MS = 400;
/**
 * The server examines at most this many results per pause; the page never
 * sends more. A student who replays one pause silently this many times and
 * answers only on the next replay loses that pause: raise this together with
 * the server's MAX_RESULTS_PER_PAUSE (and its result budget) if that matters.
 */
export const MAX_SENT_PER_PAUSE = 4;
/**
 * Voice heard while paused this close before a window's start is the answer
 * to that pause (a Pause pressed a moment before the pause, or in its first
 * 0.3 s), carried into its pass when playback resumes from there.
 */
export const PAUSED_CARRY_MS = 1000;

interface Window {
  start: number;
  from: number;
  to: number;
  ms: number;
}

interface Pass {
  index: number;
  /** Time played inside the window during this pass. */
  inWindowMs: number;
  /** Voice heard while the audio played in the window. */
  playingVoicedMs: number;
  /** Voice heard while the student had paused (in the window, or just before it). */
  pausedVoicedMs: number;
  /** What the pass counts: both, the paused part capped (pausedCap), the whole at the window. */
  voicedMs: number;
  /** Sound over the room's level that was not a voice, in the window (playing or paused). */
  soundMs: number;
}

export class PauseTracker {
  private readonly windows: Window[];
  private readonly slackMs: number;
  private readonly floorMs: number;

  private last: { positionMs: number; wallMs: number } | null = null;
  /** Wall time the audio's position fell behind at a stall, still to be caught up, and when (see LATE_POSITION_GRACE_MS). */
  private late: { ms: number; sinceWallMs: number } | null = null;
  private pass: Pass | null = null;
  /** Voice heard while paused just before a window (PAUSED_CARRY_MS), waiting for its pass to open. */
  private pausedBefore: { index: number; positionMs: number; voicedMs: number } | null = null;
  private finishedLast: { index: number; answered: boolean } | null = null;
  /** The best result sent (or queued to send) for each pause; null until one is. */
  private best: (number | null)[];
  private sent: number[];
  /** Results not yet taken by a report. */
  private queue: PauseAnswer[] = [];
  private outsideVoicedMs = 0;
  private outsidePlayedMs = 0;
  /** Sound that was not a voice in every pass's window, all passes together. */
  private windowSoundMs = 0;

  constructor(pauses: readonly (readonly [number, number])[], options: PauseTrackerOptions) {
    const lead = options.leadMs ?? PAUSE_LEAD_MS;
    const tail = options.tailCutMs ?? PAUSE_TAIL_CUT_MS;
    this.windows = [...pauses]
      .sort((a, b) => a[0] - b[0])
      .map(([s, e]) => ({ start: s, from: s + lead, to: e - tail, ms: Math.max(0, e - tail - (s + lead)) }));
    this.slackMs = options.slackMs ?? 750;
    this.floorMs = options.floorMs;
    this.best = this.windows.map(() => null);
    this.sent = this.windows.map(() => 0);
  }

  /** The counted pauses' starts, in order. */
  get starts(): number[] {
    return this.windows.map((w) => w.start);
  }

  /** How many counted pauses there are. */
  get count(): number {
    return this.windows.length;
  }

  /** One microphone sample. Called every 50 ms while the lab plays, or is paused with the page in view. */
  sample({ positionMs, wallMs, frameMs, voiced, loud = voiced, mode }: PauseSample): void {
    const frame = Math.max(0, Math.min(MAX_FRAME_MS, Number.isFinite(frameMs) ? frameMs : 0));
    const sound = loud && !voiced ? frame : 0;
    const prev = this.last;
    this.last = { positionMs, wallMs };
    if (prev) {
      const advance = positionMs - prev.positionMs;
      // Uncapped wall time: a page held up for seconds while the audio plays on is still continuous.
      const elapsed = Math.max(0, wallMs - prev.wallMs);
      const owed = this.late && wallMs - this.late.sinceWallMs <= LATE_POSITION_GRACE_MS ? this.late.ms : 0;
      if (advance < -BACKWARD_JUMP_MS || advance > elapsed + this.slackMs + owed) {
        // A seek: the pass in progress is dropped, never reported.
        this.pass = null;
        this.pausedBefore = null;
        this.late = null;
        return;
      }
      // Playing, a position far behind the time passed may be a late read of it: its catching up is not a jump.
      const behind = elapsed - advance;
      if (mode === 'playing' && behind > this.slackMs) this.late = { ms: owed + behind, sinceWallMs: wallMs };
      else if (mode === 'playing' && owed > 0 && owed + Math.min(0, behind) > 0) this.late = { ms: owed + Math.min(0, behind), sinceWallMs: this.late!.sinceWallMs };
      else this.late = null;
    }

    if (mode === 'paused') {
      // Answering while paused is normal: voice counts while the audio stands inside the open pass's window.
      const pass = this.pass;
      if (!pass) {
        this.holdPausedVoice(positionMs, frame, voiced);
        return;
      }
      const w = this.windows[pass.index];
      // Stopped just after the window's end: playback did pass it.
      if (positionMs > w.to) this.finishPass();
      else if (positionMs >= w.from) {
        if (voiced) this.addVoice(pass, 0, frame);
        this.addSound(pass, sound);
      }
      return;
    }

    if (this.pass) {
      const w = this.windows[this.pass.index];
      if (positionMs <= w.to) {
        // A few ms back before the window's start counts for nothing, and changes nothing.
        if (positionMs >= w.from) {
          this.pass.inWindowMs += frame;
          if (voiced) this.addVoice(this.pass, frame, 0);
          this.addSound(this.pass, sound);
        }
        return;
      }
      this.finishPass();
    }

    const inside = this.windowAt(positionMs);
    if (inside !== null) {
      const w = this.windows[inside];
      // Only entered from before its start: a pass that begins mid-window is never reported.
      if (prev && prev.positionMs < w.from) {
        const pass: Pass = { index: inside, inWindowMs: frame, playingVoicedMs: 0, pausedVoicedMs: 0, voicedMs: 0, soundMs: 0 };
        // An answer given while paused just before this window, playback having resumed from there.
        const carried = this.pausedBefore?.index === inside ? this.pausedBefore.voicedMs : 0;
        this.addVoice(pass, voiced ? frame : 0, carried);
        this.addSound(pass, sound);
        this.pass = pass;
        this.pausedBefore = null;
        this.finishedLast = null;
      }
      return;
    }

    this.outsidePlayedMs += frame;
    if (voiced) this.outsideVoicedMs += frame;
  }

  /**
   * Whether a position read now looks stale: the tracker saw the audio fall
   * behind the wall clock (a Chromebook stall; Firefox reads the old position
   * just after one) and it has not caught up yet, or the reading lags the last
   * sample by more than the audio could have stood still for. A report sent
   * with such a position would show the catch-up after it as a skip, and the
   * server would split the pass the page counts, so the page holds its tick a
   * moment (LabRunner).
   */
  positionSuspect(positionMs: number, wallMs: number): boolean {
    if (this.late && wallMs - this.late.sinceWallMs <= LATE_POSITION_GRACE_MS) return true;
    const last = this.last;
    if (!last) return false;
    return (wallMs - last.wallMs) - (positionMs - last.positionMs) > this.slackMs;
  }

  /**
   * Brings the tracker to where the audio is before the page changes it (a
   * jump back, the end): one voiceless sample there, so a pass whose window
   * playback has just passed finishes; a pass still open after it is dropped.
   */
  settle(positionMs: number, wallMs: number): void {
    this.sample({ positionMs, wallMs, frameMs: 0, voiced: false, mode: 'playing' });
    this.pass = null;
  }

  /** Takes up to `max` results not yet sent, oldest first. */
  takeResults(max: number): PauseAnswer[] {
    return this.queue.splice(0, Math.max(0, max));
  }

  /** How many results wait to be taken by a report. */
  get unsent(): number {
    return this.queue.length;
  }

  /** Where the audio was at the last sample (ms), or null before any. */
  get lastPositionMs(): number | null {
    return this.last?.positionMs ?? null;
  }

  /** The pass in progress, if any. */
  current(): { index: number; inWindowMs: number; voicedMs: number } | null {
    return this.pass ? { index: this.pass.index, inWindowMs: this.pass.inWindowMs, voicedMs: this.pass.voicedMs } : null;
  }

  /** The last pass that finished, and whether its voice reached the floor (cleared when the next pause opens). */
  lastFinished(): { index: number; answered: boolean } | null {
    return this.finishedLast ? { ...this.finishedLast } : null;
  }

  /** Pauses whose best result reaches the floor. */
  answeredCount(): number {
    return this.best.filter((v) => v !== null && v >= this.floorMs).length;
  }

  /** Pauses with a result. */
  finishedCount(): number {
    return this.best.filter((v) => v !== null).length;
  }

  /** Each counted pause: answered, missed (finished under the floor) or null (not finished). */
  states(): PauseState[] {
    return this.best.map((v) => (v === null ? null : v >= this.floorMs ? 'answered' : 'missed'));
  }

  /**
   * What to tell the student: in a pause, "heard" once the voice reaches the
   * floor; after 2 s in the window with less than 0.1 s of voice, "sound" when
   * the microphone heard at least 0.4 s of sound that was not a voice, else
   * "quiet"; after a pause that finished under the floor, "missed", until the
   * next opens.
   */
  nudge(): PauseNudge {
    if (this.pass) {
      if (this.pass.voicedMs >= this.floorMs) return 'heard';
      if (this.pass.inWindowMs >= QUIET_AFTER_MS && this.pass.voicedMs < QUIET_BELOW_MS) {
        return this.pass.soundMs >= SOUND_AT_LEAST_MS ? 'sound' : 'quiet';
      }
      return null;
    }
    return this.finishedLast && !this.finishedLast.answered ? 'missed' : null;
  }

  /** Played time outside every counted window, and the voice heard in it. */
  outside(): { voicedMs: number; playedMs: number } {
    return { voicedMs: this.outsideVoicedMs, playedMs: this.outsidePlayedMs };
  }

  /** Sound over the room's level that was not a voice, in the counted windows (every pass, playing or paused). */
  soundInPausesMs(): number {
    return this.windowSoundMs;
  }

  reset(): void {
    this.last = null;
    this.late = null;
    this.pass = null;
    this.pausedBefore = null;
    this.finishedLast = null;
    this.best = this.windows.map(() => null);
    this.sent = this.windows.map(() => 0);
    this.queue = [];
    this.outsideVoicedMs = 0;
    this.outsidePlayedMs = 0;
    this.windowSoundMs = 0;
  }

  /** Most voice heard while paused that a pass counts: half the window, or the floor if that is more. */
  private pausedCap(w: Window): number {
    // Deliberately under the server's cap (the whole window): room sound heard all through a long pause must not fill it.
    return Math.min(w.ms, Math.max(this.floorMs, Math.round(w.ms / 2)));
  }

  /** Adds voice heard while playing and while paused to a pass. */
  private addVoice(pass: Pass, playingMs: number, pausedMs: number) {
    const w = this.windows[pass.index];
    pass.playingVoicedMs = Math.min(w.ms, pass.playingVoicedMs + playingMs);
    pass.pausedVoicedMs = Math.min(this.pausedCap(w), pass.pausedVoicedMs + pausedMs);
    pass.voicedMs = Math.min(w.ms, pass.playingVoicedMs + pass.pausedVoicedMs);
  }

  private addSound(pass: Pass, ms: number) {
    if (ms <= 0) return;
    pass.soundMs += ms;
    this.windowSoundMs += ms;
  }

  /** Paused with no pass open: voice just before a window is kept for the pass that opens when playback resumes. */
  private holdPausedVoice(positionMs: number, frame: number, voiced: boolean) {
    const next = this.windowAfter(positionMs);
    if (next === null || this.windows[next].from - positionMs > PAUSED_CARRY_MS) {
      this.pausedBefore = null;
      return;
    }
    if (this.pausedBefore?.index !== next || Math.abs(this.pausedBefore.positionMs - positionMs) > BACKWARD_JUMP_MS) {
      this.pausedBefore = { index: next, positionMs, voicedMs: 0 };
    }
    if (voiced) this.pausedBefore.voicedMs = Math.min(this.pausedCap(this.windows[next]), this.pausedBefore.voicedMs + frame);
  }

  /** The first counted window starting after this position (it is before that window's `from`), if any. */
  private windowAfter(positionMs: number): number | null {
    let lo = 0;
    let hi = this.windows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.windows[mid].from <= positionMs) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.windows.length ? lo : null;
  }

  private finishPass() {
    const pass = this.pass;
    this.pass = null;
    if (!pass) return;
    const w = this.windows[pass.index];
    const value = Math.round(Math.min(pass.voicedMs, w.ms));
    this.finishedLast = { index: pass.index, answered: value >= this.floorMs };
    // Every pass goes, a replay that does not beat the best too (see the top of this file).
    // A result of this pause still waiting to go is from an earlier playback the page could
    // not report before the jump (its report queue was full): both would now ride in this
    // playback, where two are rejected, so they go as one, the better. Past what the server
    // examines per pause nothing more goes (it would be refused).
    const waiting = this.queue.find(([start]) => start === w.start);
    if (waiting) waiting[1] = Math.max(waiting[1], value);
    else if (this.sent[pass.index] >= MAX_SENT_PER_PAUSE) return;
    else {
      this.sent[pass.index] += 1;
      this.queue.push([w.start, value]);
    }
    // The tally and the marks go by the best result sent.
    const best = this.best[pass.index];
    if (best === null || value > best) this.best[pass.index] = value;
  }

  /** The counted window holding this position, if any (windows are sorted and never overlap). */
  private windowAt(positionMs: number): number | null {
    let lo = 0;
    let hi = this.windows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = this.windows[mid];
      if (positionMs < w.from) hi = mid - 1;
      else if (positionMs > w.to) lo = mid + 1;
      else return mid;
    }
    return null;
  }
}
