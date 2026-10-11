// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Lab listening: the signed session start, the listening log, and the checks
 * a lab must pass to count. Labs are not recorded (speaking is recorded as a
 * separate task: routers/speaking.ts); the microphone only measures whether
 * and how long the student spoke in the pauses (services/labPauses.ts scores
 * that pause by pause).
 */
import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Start token
//
// Issued when a student opens a lab, returned with the submission. It is the
// one piece of evidence the browser cannot forge: the server signed the start
// time, so "submitted less than the lab's length after starting" is caught no
// matter what the client reports.
// ---------------------------------------------------------------------------

/** Tokens older than this are refused; far longer than any real session. */
const START_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function startTokenKey(): Buffer {
  const secret = process.env.SESSION_SECRET?.trim() || 'dev-secret-change-in-production';
  return createHmac('sha256', secret).update('libresrs-lab-start-v1').digest();
}

function startSignature(labId: number, userId: number, startedAtMs: number): string {
  return createHmac('sha256', startTokenKey())
    .update(`${labId}:${userId}:${startedAtMs}`)
    .digest('base64url');
}

export function signLabStart(labId: number, userId: number, startedAtMs: number): string {
  return `${startedAtMs}.${startSignature(labId, userId, startedAtMs)}`;
}

/** The server-signed start time, or null if the token is not valid for this lab and student. */
export function verifyLabStart(
  token: string | undefined,
  labId: number,
  userId: number,
  nowMs: number,
): number | null {
  if (!token) return null;
  const [startedPart, signature, extra] = token.split('.');
  if (extra !== undefined || !startedPart || !signature || !/^\d{1,15}$/.test(startedPart)) return null;
  const startedAtMs = Number(startedPart);

  const expected = Buffer.from(startSignature(labId, userId, startedAtMs));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  if (startedAtMs > nowMs || nowMs - startedAtMs > START_TOKEN_MAX_AGE_MS) return null;
  return startedAtMs;
}

// ---------------------------------------------------------------------------
// Submission checks and flags
// ---------------------------------------------------------------------------

/** Absorbs timer and event jitter between the browser's clock and ours. */
export const LISTEN_TOLERANCE_MS = 1500;

/**
 * Why a submission must be refused, or null if the listening requirement is met.
 *
 * `heardThroughMs` comes from the listening log (summarizeListening), not the
 * browser's say-so. `startedAtMs` is the signed start: hearing N ms of audio at
 * normal speed cannot take less than N ms, so a submission that arrives sooner
 * than that is refused whatever the log contains.
 */
export function listeningProblem(args: {
  heardThroughMs: number;
  requiredThroughMs: number;
  startedAtMs: number;
  nowMs: number;
}): string | null {
  if (args.heardThroughMs + LISTEN_TOLERANCE_MS < args.requiredThroughMs) {
    return 'Listen to the whole lab before submitting';
  }
  if (args.nowMs - args.startedAtMs + LISTEN_TOLERANCE_MS < args.requiredThroughMs) {
    return 'This lab was submitted faster than the audio can play';
  }
  return null;
}

/** Less speech than this across the whole lab is flagged for the teacher to check. */
export function minimumVoicedMs(requiredThroughMs: number): number {
  return Math.min(30_000, Math.round(requiredThroughMs * 0.05));
}

/**
 * What the teacher is told to look at. Flags never change credit by
 * themselves; while the pause rule is on, a few of the signals behind them
 * hold a lab for the teacher instead (labCredit `held`, set at submit).
 * - `skipped`: the log shows a jump forward that outran the clock.
 * - `little-speech`: under minimumVoicedMs of voice, on a lab that was not
 *   scored pause by pause (a scored lab shows its pause count instead).
 * - `odd-answers` ("Odd results"): pause results that don't add up: 3 or more
 *   did not match what the log shows was played, or (stored at submit) one
 *   pause got two or more results in one playback, results came after the
 *   page went on without a microphone, or a session without a microphone
 *   claims more pause voice than the page heard.
 * - `late`: part of the log reached the server long after it happened.
 * - `overlap`: another session of this student was playing a lab at the same time.
 * - `constant-sound`: sound through almost every pause, start to end.
 * - `noisy` ("Voice outside the pauses"): voice outside the pauses about as often as in them.
 * - `short-answers`: answers much shorter than the class's on the same lab
 *   (worked out when read, against the class: labPauses.shortAnswerRows).
 * - `no-mic`: done without a microphone.
 * A test (an exam lab) has no microphone by design: never `little-speech` or `no-mic`.
 */
export const LAB_SUBMISSION_FLAGS = [
  'skipped', 'little-speech', 'odd-answers', 'late', 'overlap', 'constant-sound', 'noisy', 'short-answers', 'no-mic',
] as const;
export type LabSubmissionFlag = (typeof LAB_SUBMISSION_FLAGS)[number];

/**
 * The flags that say the log or the results do not add up (shown in red, and
 * counted as "flagged" on the Labs list). The others (amber) point at the room,
 * the microphone or the setup.
 */
export const RED_LAB_FLAGS: readonly LabSubmissionFlag[] = ['skipped', 'odd-answers', 'late'];

/** The flags decided at submit are stored; these are the ones that can be. */
export type StoredLabSubmissionFlag = Extract<LabSubmissionFlag, 'odd-answers' | 'late' | 'overlap' | 'constant-sound' | 'noisy'>;
const STORED_FLAGS: readonly LabSubmissionFlag[] = ['odd-answers', 'late', 'overlap', 'constant-sound', 'noisy'];

/** Rejected pause results from this many on are "odd". */
export const ODD_ANSWERS_MIN = 3;

/** The stored flags (`lab_submissions.flags`, a JSON array); anything unknown or unreadable is left out. */
export function parseStoredFlags(value: string | readonly string[] | null | undefined): StoredLabSubmissionFlag[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((f): f is StoredLabSubmissionFlag => STORED_FLAGS.includes(f as LabSubmissionFlag));
}

/**
 * A submission's flags, worked out when read from what was stored. The pause
 * fields are optional so rows and callers from before the pause rule still work:
 * `pausesCounted` null or missing means the lab was not scored.
 */
export function submissionFlags(args: {
  voicedMs: number;
  skipCount: number;
  requiredThroughMs: number;
  pausesCounted?: number | null;
  rejectedAnswers?: number | null;
  lateAnswers?: number | null;
  mic?: 'on' | 'off' | null;
  /** The flags stored at submit (JSON text or a list). */
  stored?: string | readonly string[] | null;
  /** "Short answers", worked out against the class (labPauses.shortAnswerRows); only the teacher's review knows it. */
  shortAnswers?: boolean;
  /**
   * A test (an exam lab, v1.19.0: the row's `exam_set`): done without a
   * microphone by design, so neither "No microphone" nor "Little speech".
   */
  exam?: boolean;
}): LabSubmissionFlag[] {
  const flags = new Set<LabSubmissionFlag>(parseStoredFlags(args.stored));
  if (args.shortAnswers) flags.add('short-answers');
  if (args.skipCount > 0) flags.add('skipped');
  // Without a microphone no speech was measured: "No microphone" says so.
  if (!args.exam && args.pausesCounted == null && args.mic !== 'off' && args.voicedMs < minimumVoicedMs(args.requiredThroughMs)) {
    flags.add('little-speech');
  }
  if ((args.rejectedAnswers ?? 0) >= ODD_ANSWERS_MIN) flags.add('odd-answers');
  if ((args.lateAnswers ?? 0) >= 1) flags.add('late');
  if (!args.exam && args.mic === 'off') flags.add('no-mic');
  return LAB_SUBMISSION_FLAGS.filter((f) => flags.has(f));
}

// ---------------------------------------------------------------------------
// Listening log
//
// While the lab plays, the page reports where the audio is every few seconds
// and at each pause, jump and end. Each entry carries two clocks: the page's
// own (precise between entries, so a request delayed on school Wi-Fi does not
// look like a skip) and the server's (so the page's clock cannot be run fast:
// it may never get ahead of the time the server has seen pass).
//
// From that, "heard through" is the furthest point reached by continuous
// playback that never outran the clock. A jump forward earns nothing and is
// counted; a seek forward past what was heard earns nothing either. What no log can prove is that sound reached the student's ears;
// what it does prove is that nobody got credit faster than the audio plays.
// ---------------------------------------------------------------------------

/**
 * What the page may report. `nomic` marks where the student went on without a
 * microphone ("My mic doesn't work" before Start, or "Go on without the
 * microphone" after it stopped): the page sends it once, carrying the last
 * pause results it has, and never a result after it. It marks the session,
 * not playback: the listening log reads it as standing still.
 */
export const LISTEN_EVENT_KINDS = ['play', 'tick', 'pause', 'seek', 'end', 'nomic'] as const;
/** 'open' is written by the server when a session begins; it marks the attempt, not playback. */
export type ListenEventKind = (typeof LISTEN_EVENT_KINDS)[number] | 'open';

export interface ListenEvent {
  kind: ListenEventKind;
  positionMs: number;
  /** Page clock, ms since the session began. */
  clientMs: number;
  /** Server clock, epoch ms. */
  at: number;
}

export interface ListeningSummary {
  heardThroughMs: number;
  /** Entries where the audio got ahead of the clock: a skip, or a page that was tampered with. */
  skips: number;
  lastPositionMs: number | null;
  lastAt: number | null;
}

/** How often the page reports while playing. */
export const LISTEN_TICK_MS = 5000;
/** Most entries kept per session: a fifteen-minute lab needs ~200. */
export const MAX_LISTEN_EVENTS = 1500;
/** Sessions a student may open on one lab in a day; nobody honest needs this many. */
export const MAX_OPENS_PER_DAY = 30;
/**
 * Times one student may turn a lab in, credited or not; beyond this, ask the
 * teacher. Checked when a session opens (so nobody listens for 15 minutes
 * only to be refused) and again when it is turned in.
 */
export const MAX_ATTEMPTS_PER_LAB = 10;
/** Audio may lead the page clock by this much between entries (event timing, decoder start-up). */
const LOG_SLACK_MS = 1500;
/** A gap this small at the edge of what was heard is bridged. */
const LOG_GAP_MS = 1000;
/**
 * ...but after a seek, only this much: a seek is not playback, so one that
 * lands past what was heard never carries "heard through" across the gap.
 * The honest page seeks back (Back 10 s, its snap-back) or to within a few ms
 * of where it was (resuming after an error).
 */
const SEEK_GAP_MS = 50;
/** The page clock may lead the server's by this much (clock start-up, request latency). */
const CLOCK_SLACK_MS = 5000;
/**
 * If the log's first entry is this close to the start, the stretch before it
 * counts — the page resends reports that fail, so only a report that never
 * arrived at all is missing, and at most a tick or two of it. A log that
 * begins any later began mid-lab, and earns nothing for what came before.
 */
const INITIAL_BRIDGE_MS = 2 * LISTEN_TICK_MS + LOG_SLACK_MS;

export function summarizeListening(events: ListenEvent[], sessionStartedAt: number): ListeningSummary {
  let prev: ListenEvent | null = null;
  let heard = 0;
  let skips = 0;
  // The page's clock orders entries: requests can arrive out of order, the
  // moments they describe cannot.
  const ordered = events
    .filter((e) => e.kind !== 'open' && e.kind !== 'nomic')
    .sort((a, b) => a.clientMs - b.clientMs || a.at - b.at);

  for (const e of ordered) {
    if (e.clientMs > e.at - sessionStartedAt + CLOCK_SLACK_MS) {
      skips += 1; // the page claims more time than has passed
      continue;
    }
    if (prev === null) {
      if (e.positionMs > INITIAL_BRIDGE_MS) skips += 1;
      else if (e.kind !== 'seek') heard = e.positionMs;
      prev = e;
      continue;
    }
    const advance = e.positionMs - prev.positionMs;
    const elapsed = e.clientMs - prev.clientMs;
    if (advance - elapsed > LOG_SLACK_MS) {
      skips += 1;
    } else if (e.kind !== 'seek' && advance > 0 && prev.positionMs <= heard + (prev.kind === 'seek' ? SEEK_GAP_MS : LOG_GAP_MS)) {
      heard = Math.max(heard, e.positionMs);
    }
    prev = e;
  }

  const last = ordered[ordered.length - 1];
  return {
    heardThroughMs: Math.round(heard),
    skips,
    lastPositionMs: last?.positionMs ?? null,
    lastAt: last ? Math.max(...ordered.map((e) => e.at)) : null,
  };
}
