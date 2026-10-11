// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Scoring the answer pauses of a lab session against the server's own
 * listening log.
 *
 * The page reports, per pause, how long its microphone heard a voice in the
 * pause's window: `[pauseStartMs, voicedMs]`, riding on its listening reports
 * (and on the submit itself). Nothing is recorded, so the server cannot hear
 * the voice; what it checks is everything around it:
 *
 * 1. the pause is one of the session's own counted pauses (fixed at `begin`);
 * 2. the log shows that pause's window played through at normal speed, in one
 *    unbroken stretch of playback (a "run"), up to the report carrying it;
 * 3. the report came in that same playback, within 15 s of audio after the pause;
 * 4. the log was sent in real time: played audio never ran more than
 *    MAX_LOG_LEAD_MS ahead of the time the server saw pass. A log invented and
 *    sent after the fact in a burst is "late", and its pauses never count;
 * 5. the voice claimed fits inside the pause's window;
 * 6. the pause got one result in that playback. The page sends one result per
 *    pass through a pause (another only after Back 10 s, which starts a new
 *    playback), and sends a retried report again whole, which is stored once.
 *    Two or more for one pause in one playback are results the page could not
 *    have sent (a console script adding its own): all of them are rejected,
 *    and the pause keeps the best of its other playbacks, or −2. Only a jump
 *    shaped like the page's own Back 10 s, which the log after it bears out,
 *    starts a new playback: a script that fakes a seek or a skip between its
 *    result and the page's leaves both in one;
 * 7. no result comes after the page said it went on without a microphone (the
 *    `nomic` marker), in the page's order or in the order the server got
 *    them: the page sends none, so any is a script's.
 *
 * One sorted sweep over at most MAX_LISTEN_EVENTS rows, with a bounded number
 * of results examined per session.
 */
import {
  LEGACY_SESSION_MAX_AGE_MS,
  MAX_LOG_LEAD_MS,
  PAUSE_FINISH_SLACK_MS,
  parseLabRules,
  pauseWindow,
  pauseWindowMs,
  type LabPause,
  type PauseAnswer,
} from '@libresrs/shared';
import type { ListenEventKind } from './labMedia.js';

/** A listening-log entry as scoring reads it. `answers` is the stored JSON text, or the pairs themselves. */
export interface ScoredEvent {
  kind: ListenEventKind;
  positionMs: number;
  /** Page clock, ms since the session began. */
  clientMs: number;
  /** Server clock, epoch ms. */
  at: number;
  answers?: string | readonly (readonly number[])[] | null;
}

/** The page clock may lead the server's by this much (the same rule as summarizeListening). */
const CLOCK_SLACK_MS = 5000;
/** A seek back further than this starts a new run (Back 10 s; the page's own snap-back). */
const SEEK_BREAK_MS = 300;
/**
 * A seek forward further than this starts a new run. The honest page never
 * seeks forward (resuming after an error lands within a few ms of where it
 * was), so anything more is a jump, however small: a log could otherwise walk
 * through the audio in short seeks, covered but never "played".
 */
const SEEK_FORWARD_BREAK_MS = 50;
/** Going back further than this starts a new run. */
const BACKWARD_BREAK_MS = 300;
/** Audio running ahead of the page clock by more than this between entries is a skip, which starts a new run. */
const SKIP_SLACK_MS = 1500;
/**
 * ...and so is audio running that far ahead of the page clock over several
 * entries of one run, plus this share of the page time since (the audio's
 * clock and the page's drift apart by far less). Time paused is never banked:
 * the measure starts again from its lowest point. A log cannot walk through
 * the audio in steps that each fit the slack.
 */
const RUN_DRIFT_SHARE = 0.01;
/** Back 10 s: the page reports where playback reached, then seeks this far back (or to the start). */
const BACK_MS = 10_000;
/** How far from exactly 10 s before the report just before it a jump may land and still be the page's Back 10 s. */
const BACK_SHAPE_SLACK_MS = 250;
/** Within a run, a gap in what was played this small is bridged. */
const COVERAGE_BRIDGE_MS = 1000;
/** A result may claim this much more voice than its pause's window (then it is capped at the window). */
export const RESULT_FIT_SLACK_MS = 250;
/** A result may ride on a report this far before its window ends (timer jitter)... */
export const REPORT_EARLY_MS = 250;
/** ...and at most this far into the audio after the pause ends. */
export const REPORT_WITHIN_MS = 15_000;
/** Results examined per pause; more are rejected. */
export const MAX_RESULTS_PER_PAUSE = 4;
/** Results examined per session; more are rejected. */
export const resultBudget = (counted: number) => 4 * counted + 50;
/** A counted pause's stored result when its only results came two or more in one playback (none counted). */
export const CONFLICTED_RESULT = -2;

/** The pause results an entry carries. Anything that is not a list of number pairs is none. */
export function parseAnswers(value: ScoredEvent['answers']): PauseAnswer[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const answers: PauseAnswer[] = [];
  for (const item of list) {
    if (Array.isArray(item) && item.length === 2 && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
      answers.push([item[0], item[1]]);
    }
  }
  return answers;
}

type Span = [number, number];

/** Adds [from, to] to a sorted list of disjoint spans, merging spans closer than the bridge. */
function addSpan(spans: Span[], from: number, to: number) {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][1] + COVERAGE_BRIDGE_MS < from) lo = mid + 1;
    else hi = mid;
  }
  let start = from;
  let end = to;
  let j = lo;
  while (j < spans.length && spans[j][0] <= end + COVERAGE_BRIDGE_MS) {
    start = Math.min(start, spans[j][0]);
    end = Math.max(end, spans[j][1]);
    j++;
  }
  spans.splice(lo, j - lo, [start, end]);
}

/** Whether one span holds all of [from, to]. */
function covers(spans: readonly Span[], from: number, to: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][0] <= from) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && spans[found][1] >= to;
}

interface Entry {
  event: ScoredEvent;
  order: number;
  /** Place in the page's order, markers and dropped entries included. */
  rank: number;
}

/** Page time less audio position: steady while the audio plays, higher after a pause or a jump back, lower after a skip. */
const offsetOf = (event: ScoredEvent) => event.clientMs - event.positionMs;

/**
 * The sweep both scoring and logLeadMs use. Entries are put in the page's
 * order (its clock, then the server's, then arrival); entries whose page clock
 * claims more time than the server saw pass are dropped. Then, entry by entry:
 *
 * - runs: a seek forward of more than 50 ms or back of more than 0.3 s,
 *   going back more than 0.3 s, or audio running 1.5 s ahead of the page clock
 *   (a skip, between two entries or over several of one run) starts a new
 *   run, whose coverage starts empty. Otherwise every step forward, a small
 *   seek's too, adds its span to the run's coverage and to the audio played:
 *   nothing is covered that was not also played, so the lead rule below
 *   bounds everything the log covers;
 * - playbacks: a new run is a new playback only when it starts with the
 *   page's Back 10 s (a jump landing 10 s before the report just before it,
 *   or at the start) and the log after it bears that out: the page's offset
 *   (page time less position) rose with the jump and never falls back more
 *   than half way. A script that fakes a jump back must bring the log back up
 *   to where the page's own reports are, and falls back. Any other new run
 *   (a skip, a small seek, a step back) stays in the playback it broke;
 * - lead: d = audio played − server time. For honest live reports d never
 *   rises (audio cannot play faster than time passes). An entry is late when
 *   d has risen by more than MAX_LOG_LEAD_MS from an earlier entry, or rises
 *   that much by a later one: either way the pair shows audio played faster
 *   than the server saw time pass, so part of the log arrived long after it
 *   happened. A page that pauses itself after 90 s without a confirmed report
 *   never gets there.
 *
 * A `nomic` marker stands still: it neither breaks a run nor covers anything.
 *
 * `visit` sees each kept entry with its run's coverage so far (up to and
 * including that entry), its playback's number (from 0, in the order they
 * start) and whether it comes after the session's first `nomic` marker (in the
 * page's order, or arriving after it).
 */
function sweep(
  events: readonly ScoredEvent[],
  sessionStartedAt: number,
  visit?: (index: number, event: ScoredEvent, coverage: readonly Span[], playback: number, afterNoMic: boolean) => void,
) {
  const ordered: Entry[] = events
    .map((event, order) => ({ event, order, rank: 0 }))
    .filter(({ event }) => event.kind !== 'open')
    .sort((a, b) => a.event.clientMs - b.event.clientMs || a.event.at - b.event.at || a.order - b.order);
  ordered.forEach((entry, rank) => { entry.rank = rank; });
  const markerRank = ordered.findIndex(({ event }) => event.kind === 'nomic');
  const markerAt = markerRank >= 0 ? ordered[markerRank].event.at : Infinity;
  // After it in the page's order, or sent after it: the page sends its reports one at a time, in
  // order, so every report it queued before the mark reached the server no later than the mark
  // (with it, when a submit carries both). A later one dated before it is a script's backdating.
  const afterNoMic = (entry: Entry) => markerRank >= 0 && (entry.rank > markerRank || entry.event.at > markerAt);

  const kept: Entry[] = [];
  const dropped: Entry[] = [];
  for (const entry of ordered) {
    if (entry.event.clientMs > entry.event.at - sessionStartedAt + CLOCK_SLACK_MS) dropped.push(entry);
    else kept.push(entry);
  }

  // Where runs break, and which breaks are the page's Back 10 s.
  const moving = kept.map((_, i) => i).filter((i) => kept[i].event.kind !== 'nomic');
  const newRun = new Array<boolean>(kept.length).fill(false);
  const backFrom = new Array<ScoredEvent | null>(kept.length).fill(null);
  {
    let prev: ScoredEvent | null = null;
    // Audio played less page time passed, since the run began, and its lowest point.
    let ahead = 0;
    let low = 0;
    let lowAt = 0;
    for (const i of moving) {
      const event = kept[i].event;
      if (prev) {
        const advance = event.positionMs - prev.positionMs;
        const elapsed = event.clientMs - prev.clientMs;
        const next = ahead + advance - elapsed;
        const nextLow = Math.min(low, next);
        const nextLowAt = next < low ? event.clientMs : lowAt;
        const breaks = (event.kind === 'seek' && (advance > SEEK_FORWARD_BREAK_MS || advance < -SEEK_BREAK_MS))
          || advance < -BACKWARD_BREAK_MS
          || advance - elapsed > SKIP_SLACK_MS
          || next - nextLow > SKIP_SLACK_MS + RUN_DRIFT_SHARE * (event.clientMs - nextLowAt);
        if (breaks) {
          newRun[i] = true;
          ahead = 0;
          low = 0;
          lowAt = event.clientMs;
          // Any kind: a tick or a pause the page sent while its seek was under way lands there first.
          if (Math.abs(event.positionMs - Math.max(0, prev.positionMs - BACK_MS)) <= BACK_SHAPE_SLACK_MS) backFrom[i] = prev;
        } else {
          ahead = next;
          low = nextLow;
          lowAt = nextLowAt;
        }
      }
      prev = event;
    }
  }
  // The lowest offset from each entry on, to judge each Back 10 s by what came after it.
  const lowestFrom = new Array<number>(kept.length).fill(Infinity);
  let lowest = Infinity;
  for (let k = moving.length - 1; k >= 0; k--) {
    lowest = Math.min(lowest, offsetOf(kept[moving[k]].event));
    lowestFrom[moving[k]] = lowest;
  }

  const lead = new Array<number>(kept.length);
  let coverage: Span[] = [];
  let playback = 0;
  let played = 0;
  let prev: ScoredEvent | null = null;
  for (let i = 0; i < kept.length; i++) {
    const event = kept[i].event;
    if (event.kind !== 'nomic') {
      if (prev) {
        if (newRun[i]) {
          coverage = [];
          const from = backFrom[i];
          if (from) {
            const rise = offsetOf(event) - offsetOf(from);
            if (rise > 0 && lowestFrom[i] >= offsetOf(from) + rise / 2) playback += 1;
          }
        } else if (event.positionMs > prev.positionMs) {
          addSpan(coverage, prev.positionMs, event.positionMs);
          played += event.positionMs - prev.positionMs;
        }
      }
      prev = event;
    }
    lead[i] = played - event.at;
    visit?.(i, event, coverage, playback, afterNoMic(kept[i]));
  }

  const late = new Array<boolean>(kept.length).fill(false);
  let leadMs = 0;
  let lowestLead = Infinity;
  for (let i = 0; i < kept.length; i++) {
    lowestLead = Math.min(lowestLead, lead[i]);
    const ahead = lead[i] - lowestLead;
    leadMs = Math.max(leadMs, ahead);
    if (ahead > MAX_LOG_LEAD_MS) late[i] = true;
  }
  let highest = -Infinity;
  for (let i = kept.length - 1; i >= 0; i--) {
    highest = Math.max(highest, lead[i]);
    if (highest - lead[i] > MAX_LOG_LEAD_MS) late[i] = true;
  }
  return { kept, dropped, late, leadMs: Math.round(leadMs), afterNoMic };
}

/**
 * How far played audio ever ran ahead of the server's clock in a session's
 * log (ms). Over MAX_LOG_LEAD_MS, part of the log was sent long after it
 * happened. For sessions that are not scored.
 */
export function logLeadMs(events: readonly ScoredEvent[], sessionStartedAt: number): number {
  return sweep(events, sessionStartedAt).leadMs;
}

export interface PauseScore {
  /** Counted pauses whose best accepted result reaches the floor. */
  answered: number;
  /**
   * `[startMs, bestVoicedMs]` for each counted pause, in order. The value is
   * -1 when no result was accepted, and -2 (CONFLICTED_RESULT) when the only
   * results came two or more in one playback.
   */
  results: PauseAnswer[];
  /** Results that did not match what the log shows was played, or came two or more for one pause in one playback. */
  rejected: number;
  /** Pause playbacks that got two or more results: each is a set of results the page could not have sent. */
  conflicts: number;
  /**
   * Results on entries after the page said it went on without a microphone
   * (`nomic`), in the page's order or arriving after it (the submit's own
   * included): the page sends none, so each is one it could not have sent.
   * They are scored as any other.
   */
  afterNoMic: number;
  /** Results on entries that arrived long after they happened. */
  late: number;
  /** How far played audio ever ran ahead of the server's clock. */
  leadMs: number;
  /** The best accepted value of each pause that has one, in pause order. */
  accepted: number[];
}

/**
 * Scores a session's pause results against its log. Pure. `pauses` are the
 * counted pauses, sorted. `ignored` are pauses the session began with that no
 * longer count (the teacher moved "must hear through" earlier mid-session):
 * the page still reports them, honestly, so their results are left out,
 * neither counted nor rejected.
 */
export function scorePauses(args: {
  pauses: readonly LabPause[];
  events: readonly ScoredEvent[];
  sessionStartedAt: number;
  floorMs: number;
  ignored?: readonly LabPause[];
}): PauseScore {
  const { pauses, floorMs } = args;
  const indexByStart = new Map<number, number>();
  pauses.forEach(([s], i) => indexByStart.set(s, i));
  const ignoredStarts = new Set((args.ignored ?? []).map(([s]) => s).filter((s) => !indexByStart.has(s)));
  const windows = pauses.map((p) => ({ ...pauseWindow(p), ms: pauseWindowMs(p), end: p[1] }));

  const budget = resultBudget(pauses.length);
  const perPause = new Array<number>(pauses.length).fill(0);
  /** Results per pause per playback (key `playback × pauses + pause`), every one of them, past the caps below too. */
  const perPlayback = new Map<number, number>();
  const keyOf = (playback: number, pause: number) => playback * pauses.length + pause;
  const candidates: { entry: number; pause: number; key: number; value: number; ok: boolean }[] = [];
  let examined = 0;
  let rejected = 0;
  let afterNoMic = 0;

  const swept = sweep(args.events, args.sessionStartedAt, (index, event, coverage, playback, noMic) => {
    const answers = parseAnswers(event.answers);
    if (noMic) afterNoMic += answers.length;
    for (const [start, value] of answers) {
      if (ignoredStarts.has(start)) continue;
      examined += 1;
      const pause = indexByStart.get(start);
      // Grouped before the caps: a flood of results cannot push the page's own
      // result out of the group its forged twin sits in.
      const key = pause === undefined ? -1 : keyOf(playback, pause);
      if (pause !== undefined) perPlayback.set(key, (perPlayback.get(key) ?? 0) + 1);
      if (examined > budget) {
        rejected += 1;
        continue;
      }
      if (pause === undefined) {
        rejected += 1;
        continue;
      }
      perPause[pause] += 1;
      if (perPause[pause] > MAX_RESULTS_PER_PAUSE) {
        rejected += 1;
        continue;
      }
      const w = windows[pause];
      const fits = value >= 0 && value <= w.ms + RESULT_FIT_SLACK_MS;
      const playedThrough = covers(coverage, w.from, w.to);
      const inThatPlayback = event.positionMs >= w.to - REPORT_EARLY_MS && event.positionMs <= w.end + REPORT_WITHIN_MS;
      candidates.push({ entry: index, pause, key, value, ok: fits && playedThrough && inThatPlayback });
    }
  });
  const { dropped, late: lateEntries, leadMs } = swept;
  // The page's clock ran ahead of the server's on these: nothing they carry counts.
  for (const entry of dropped) {
    const answers = parseAnswers(entry.event.answers);
    if (swept.afterNoMic(entry)) afterNoMic += answers.length;
    rejected += answers.filter(([start]) => !ignoredStarts.has(start)).length;
  }

  // Two or more results for one pause in one playback: none of them counts.
  let conflicts = 0;
  const conflicted = new Array<boolean>(pauses.length).fill(false);
  for (const [key, n] of perPlayback) {
    if (n < 2) continue;
    conflicts += 1;
    conflicted[key % pauses.length] = true;
  }

  const best = new Array<number | null>(pauses.length).fill(null);
  let late = 0;
  for (const c of candidates) {
    if (lateEntries[c.entry]) {
      late += 1;
    } else if (!c.ok || (perPlayback.get(c.key) ?? 0) >= 2) {
      rejected += 1;
    } else {
      // The best of the playbacks: an honest replay after Back 10 s may improve a pause.
      const value = Math.round(Math.min(c.value, windows[c.pause].ms));
      best[c.pause] = Math.max(best[c.pause] ?? -1, value);
    }
  }

  return {
    answered: best.filter((v) => v !== null && v >= floorMs).length,
    results: pauses.map(([s], i): PauseAnswer => [s, best[i] ?? (conflicted[i] ? CONFLICTED_RESULT : -1)]),
    rejected,
    conflicts,
    afterNoMic,
    late,
    leadMs,
    accepted: best.filter((v): v is number => v !== null),
  };
}

/**
 * Pause voice the page could not have heard, on a session turned in without a
 * microphone: the voice of its answered pauses plus the voice outside them is
 * more than all the voice the page heard, playing (`voicedMs`) and paused
 * (`pausedVoicedMs`), with slack of 0.25 s and 25 ms a pause. A page without
 * a microphone sends pause results only from before the microphone was lost,
 * and those are already in its totals; a console script that adds results to
 * a no-mic session is not. An answer given while paused is in the paused
 * total, which every page that can open a session sends: a missing one is 0,
 * never a reason to skip the check. Mic-on sessions are never judged by it.
 */
export function pauseVoiceOutrunsTotal(args: {
  results: readonly PauseAnswer[];
  outsideVoicedMs: number | null;
  voicedMs: number;
  pausedVoicedMs?: number | null;
  counted: number;
}): boolean {
  const inPauses = args.results.reduce((sum, [, v]) => sum + Math.max(0, v), 0);
  const heard = args.voicedMs + (args.pausedVoicedMs ?? 0);
  return inPauses + (args.outsideVoicedMs ?? 0) > heard + 250 + 25 * args.counted;
}

/** A share of accepted results this close to the whole window is "sound through the pause". */
const CONSTANT_SOUND_FILL = 0.9;
const CONSTANT_SOUND_SHARE = 0.8;
const CONSTANT_SOUND_MIN_RESULTS = 10;
/** Voice outside the pauses is judged only after at least a minute played outside them. */
const OUTSIDE_MIN_PLAYED_MS = 60_000;
/** "Voice outside the pauses" (`noisy`): voice in a tenth or more of the time played outside the pauses... */
export const NOISY_MIN_OUTSIDE_RATE = 0.1;
/**
 * ...and in the pauses less than 1.2 times as often as outside them. Guessed
 * from the sim's replays: a talking room sits at about 1.0, and at 1.5 an
 * honest one-word answerer next to a talker would be flagged too.
 */
export const NOISY_INSIDE_RATIO = 1.2;
/** The teacher's optional hold on it ("Also hold labs with voice outside the pauses") asks for voice in 15% of the time outside. */
export const NOISY_HOLD_MIN_OUTSIDE_RATE = 0.15;

/**
 * How often the microphone heard a voice in the pauses (accepted voice over
 * the counted windows) and outside them (voice over the time played outside
 * every counted pause): null with less than a minute played outside.
 */
export function voiceRates(args: {
  pauses: readonly LabPause[];
  results: readonly PauseAnswer[];
  outsideVoicedMs: number | null;
  outsidePlayedMs: number | null;
}): { inside: number; outside: number } | null {
  const outsidePlayed = args.outsidePlayedMs ?? 0;
  if (outsidePlayed < OUTSIDE_MIN_PLAYED_MS) return null;
  const windows = args.pauses.map((p) => pauseWindowMs(p));
  const totalWindow = windows.reduce((sum, w) => sum + w, 0);
  let voiced = 0;
  args.results.forEach(([, value], i) => {
    if (value >= 0 && i < windows.length) voiced += value;
  });
  return { inside: totalWindow > 0 ? voiced / totalWindow : 0, outside: (args.outsideVoicedMs ?? 0) / outsidePlayed };
}

/**
 * Voice outside the pauses about as often as in them: at least `minOutsideRate`
 * of the time outside (the flag's 10% by default, the hold's 15%), and in the
 * pauses less than 1.2 times as often. A phone or a video, a talking
 * neighbour, or the lab through speakers instead of headphones.
 */
export function voiceOutsideThePauses(
  args: Parameters<typeof voiceRates>[0],
  minOutsideRate = NOISY_MIN_OUTSIDE_RATE,
): boolean {
  const rates = voiceRates(args);
  return rates !== null && rates.outside >= minOutsideRate && rates.inside < NOISY_INSIDE_RATIO * rates.outside;
}

/**
 * Flags about the sound in a scored session (a teacher's hold aside, they
 * never change credit):
 * - `constant-sound`: at least 10 accepted results, 80% or more of them with
 *   voice through 90% or more of the window. Honest answers are short (about
 *   1 s in windows of 3 s or more); sound through every pause is music, a
 *   video or a second window.
 * - `noisy` ("Voice outside the pauses"): voiceOutsideThePauses, after at
 *   least a minute played outside the pauses.
 */
export function pauseSoundFlags(args: {
  pauses: readonly LabPause[];
  results: readonly PauseAnswer[];
  outsideVoicedMs: number | null;
  outsidePlayedMs: number | null;
}): ('constant-sound' | 'noisy')[] {
  const flags: ('constant-sound' | 'noisy')[] = [];
  const windows = args.pauses.map((p) => pauseWindowMs(p));
  const accepted: { value: number; window: number }[] = [];
  args.results.forEach(([, value], i) => {
    if (value >= 0 && i < windows.length) accepted.push({ value, window: windows[i] });
  });

  const full = accepted.filter((a) => a.value >= CONSTANT_SOUND_FILL * a.window).length;
  if (accepted.length >= CONSTANT_SOUND_MIN_RESULTS && full >= CONSTANT_SOUND_SHARE * accepted.length) {
    flags.push('constant-sound');
  }
  if (voiceOutsideThePauses(args)) flags.push('noisy');
  return flags;
}

/** "Short answers" needs at least this many answered pauses on the row... */
export const SHORT_ANSWERS_MIN_ANSWERED = 10;
/** ...and this many other students on the lab to compare it with... */
export const SHORT_ANSWERS_MIN_CLASS = 5;
/** ...whose typical answer is more than twice as long. */
export const SHORT_ANSWERS_SHARE = 0.5;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median voice of a row's answered pauses (at or over its floor): null with fewer than 10 answered. */
export function answeredMedianMs(results: readonly PauseAnswer[] | null, floorMs: number | null): number | null {
  if (!results || floorMs === null) return null;
  const answered = results.map(([, v]) => v).filter((v) => v >= floorMs);
  return answered.length >= SHORT_ANSWERS_MIN_ANSWERED ? median(answered) : null;
}

/**
 * "Short answers", worked out when read, against the class on the same lab:
 * the rows whose answered pauses (10 or more) have a median voice under half
 * the class's, the class being the median of at least 5 other students' own
 * medians (each student's newest row with 10 answered pauses; never the
 * teacher's test runs). Often one sound in each pause: one syllable, a tap
 * that rings, a whistle. An honest student who answers every pause with one
 * word shows it too, which the teacher would want to know. Amber: never
 * evidence, and it never changes credit.
 */
export function shortAnswerRows(rows: readonly {
  id: number;
  userId: number;
  /** A student's row, not the teacher's own test run. */
  student: boolean;
  submittedAt: Date;
  results: readonly PauseAnswer[] | null;
  floorMs: number | null;
}[]): Set<number> {
  const medians = rows.map((row) => ({ row, median: answeredMedianMs(row.results, row.floorMs) }));
  const byStudent = new Map<number, { at: number; id: number; median: number }>();
  for (const { row, median: m } of medians) {
    if (!row.student || m === null) continue;
    const seen = byStudent.get(row.userId);
    const at = row.submittedAt.getTime();
    if (!seen || at > seen.at || (at === seen.at && row.id > seen.id)) byStudent.set(row.userId, { at, id: row.id, median: m });
  }
  const short = new Set<number>();
  for (const { row, median: m } of medians) {
    if (m === null) continue;
    const others = [...byStudent.entries()].filter(([userId]) => userId !== row.userId).map(([, s]) => s.median);
    if (others.length < SHORT_ANSWERS_MIN_CLASS) continue;
    const typical = median(others)!;
    if (m < SHORT_ANSWERS_SHARE * typical) short.add(row.id);
  }
  return short;
}

/**
 * The rule a submit judges a session by, from the rules written on its first
 * `open` row when it began (`rulesText`; undefined when there is no open row).
 *
 * - No rules (opened before the pause rule): `legacy`, the old rule, but only
 *   for LEGACY_SESSION_MAX_AGE_MS after the session began; after that, `expired`.
 * - Rules without a pause list (the lab was not scanned when it began), or
 *   whose counted pauses all end after the lab's must-hear-through point as it
 *   is now (less the finishing slack): `unscored`.
 * - Otherwise `scored` against those pauses, with the session's % and floor.
 *
 * Rules that are there but cannot be read (written by a newer version) are
 * `unscored` with the current settings: never the legacy rule. Such a session
 * is never held for voice outside the pauses.
 */
export type SessionRule =
  | { rule: 'legacy' }
  | { rule: 'expired' }
  /** `holdOutsideVoice`: the teacher's "Also hold labs with voice outside the pauses", as the session began (false when not written). */
  | { rule: 'unscored'; pct: number; floor: number; holdOutsideVoice: boolean }
  /** `dropped`: pauses the session began with that no longer count (scorePauses's `ignored`). */
  | { rule: 'scored'; pauses: LabPause[]; dropped: LabPause[]; pct: number; floor: number; holdOutsideVoice: boolean };

export function sessionRule(args: {
  rulesText: string | null | undefined;
  requiredThroughMs: number;
  startedAtMs: number;
  nowMs: number;
  current: { minAnsweredPct: number; voicePerPauseMs: number };
}): SessionRule {
  if (args.rulesText == null) {
    return args.nowMs - args.startedAtMs <= LEGACY_SESSION_MAX_AGE_MS ? { rule: 'legacy' } : { rule: 'expired' };
  }
  const rules = parseLabRules(args.rulesText);
  if (!rules) {
    return { rule: 'unscored', pct: args.current.minAnsweredPct, floor: args.current.voicePerPauseMs, holdOutsideVoice: false };
  }
  const holdOutsideVoice = rules.holdOutsideVoice === true;
  const lastEnd = args.requiredThroughMs - PAUSE_FINISH_SLACK_MS;
  const counted = (rules.pauses ?? []).filter(([, e]) => e <= lastEnd);
  if (counted.length === 0) return { rule: 'unscored', pct: rules.pct, floor: rules.floor, holdOutsideVoice };
  const dropped = (rules.pauses ?? []).filter(([, e]) => e > lastEnd);
  return { rule: 'scored', pauses: counted, dropped, pct: rules.pct, floor: rules.floor, holdOutsideVoice };
}
