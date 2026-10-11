// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Speaking in the pauses of a listening lab: the rules the teacher's scan, the
 * student's page and the server share.
 *
 * A lab is pause-and-respond: the narrator prompts, the student answers aloud
 * in the pause, the model voice confirms. The teacher's browser finds the
 * answer pauses when the lab is uploaded; the student's page reports, per
 * pause, how long its microphone heard a voice; the server checks each report
 * against its own listening log and the rules the session began with. Nothing
 * is recorded: a report is two integers, `[pauseStartMs, voicedMs]`.
 */
import { canonicalExamSet } from './examLabs.js';

/** An answer pause in the lab audio, `[startMs, endMs]`, from the teacher's scan. */
export type LabPause = [startMs: number, endMs: number];

/** One pause result the page reports: the pause's start and the voice heard in its window. */
export type PauseAnswer = [startMs: number, voicedMs: number];

/**
 * Voice in the first 0.3 s of a pause is the prompt's tail or its echo through
 * speakers (plus output latency and the decoder's offset), so it never counts.
 */
export const PAUSE_LEAD_MS = 300;
/**
 * Voice stops counting 0.1 s before the pause ends, so the model answer (which
 * starts at the pause's end) and the ~50 ms decoder offset never count.
 */
export const PAUSE_TAIL_CUT_MS = 100;
/** Voice the page must hear before "Start the lab" turns on. */
export const MIC_CHECK_VOICE_MS = 500;
/** Pause results one listening report (heartbeat) may carry. */
export const MAX_ANSWERS_PER_REPORT = 20;
/** Pause results a submit may carry itself. */
export const MAX_SUBMIT_ANSWERS = 200;
/** Unsent listening reports a submit may carry; equal to the page's MAX_PENDING_REPORTS. */
export const MAX_SUBMIT_REPORTS = 400;
/**
 * Played audio may run ahead of the server's clock by at most this much. A
 * report past it arrived long after it happened ("late"): its pauses never count.
 */
export const MAX_LOG_LEAD_MS = 120_000;
/** The page pauses the lab when its oldest unsent report is this old (page clock). */
export const CONNECTION_WAIT_MS = 90_000;
/** A session opened before the pause rule (no rules on its open row) keeps the old rule only this long. */
export const LEGACY_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/**
 * Sent by the page on `labs.begin`; an older page is told to reload. 3 is the
 * page with the room-relative voice meter (v1.16.0): a page still on the fixed
 * −45 dBFS gate would count taps and room noise as answers.
 */
export const LAB_CLIENT = 3;
/**
 * The version of `LabRules` the server writes on a session's open row. It stays
 * 1: `parseLabRules` refuses any other version, so a bump would leave sessions
 * already open without rules, and a server rolled back to v1.15 would judge
 * them unscored and give credit. New rule fields are optional on version 1.
 */
export const LAB_RULES_VERSION = 1;

/** Share of a lab's counted pauses a student must answer, when the teacher has saved none. */
export const DEFAULT_MIN_ANSWERED_PCT = 75;
/** Voice needed in a pause for it to count as answered, when the teacher has saved none. */
export const DEFAULT_VOICE_PER_PAUSE_MS = 250;
/** 0 turns the pause rule off: every lab counts. */
export const MIN_ANSWERED_PCT_RANGE = [0, 100] as const;
/**
 * The floor may go down to 0.2 s. The voice meter counts a sound only when it
 * is pitched and stands out from the room, and the pause's first 0.3 s never
 * counts, so speaker bleed no longer reaches the floor; a one-word "sí" in a
 * noisy room measures about 0.2 s. The default stays 0.25 s: the teacher lowers
 * it when raising the share.
 */
export const VOICE_PER_PAUSE_RANGE_MS = [200, 2000] as const;
/**
 * How far over the room level (dB) a sound must be for the lab page's meter to
 * count it as a voice. 6 dB is the measured knee: at +4 a silent student in
 * class chatter passes, at +8 an honest one 8 dB over the room fails.
 */
export const DEFAULT_GATE_MARGIN_DB = 6;
/** The room margin the teacher may set (Admin → Labs → Advanced). */
export const GATE_MARGIN_RANGE_DB = [4, 12] as const;

/** A lab's pause list holds at most this many pauses (the real labs have 91–105). */
export const MAX_PAUSES_PER_LAB = 400;
/** A pause is at least this long (the scan keeps silences of 3.3 s or more). */
export const MIN_PAUSE_LENGTH_MS = 1000;
/** A pause is at most this long. */
export const MAX_PAUSE_LENGTH_MS = 60_000;
/**
 * A student may Finish this far before the must-hear-through point (the
 * server's LISTEN_TOLERANCE_MS), so a pause ending later is never required.
 */
export const PAUSE_FINISH_SLACK_MS = 1500;
/** The largest pause start a result may name: 24 h of audio. */
export const MAX_ANSWER_START_MS = 86_400_000;
/** The largest voice a result may claim for one pause. */
export const MAX_ANSWER_VOICED_MS = 120_000;

/** "Check the count": the kept pauses and the longest silence left out are closer than this. */
export const CHECK_MIN_MARGIN_MS = 400;
/** "Check the count": the file's noise floor is above this (sound under the pauses). */
export const CHECK_NOISE_DB = -40;
/** "Check the count": a lab with fewer pauses than this is probably not pause-and-respond. */
export const CHECK_MIN_PAUSES = 10;

/**
 * What the teacher's browser measured when it found a lab's pauses
 * (`findAnswerPauses` in the client's labAudio.ts).
 */
export interface LabPauseScan {
  /** The cut-off: silences at least this long are answer pauses. */
  minPauseMs: number;
  /** The level below which a 10 ms window counts as silent. */
  thresholdDb: number;
  /** The file's noise floor (10th-percentile window level); −200 is digital silence. */
  noiseDb: number;
  /** The shortest silence kept as a pause, or null when none was kept. */
  shortestKeptMs: number | null;
  /** The longest inner silence left out, or null when none was. */
  longestLeftOutMs: number | null;
  /** Silences within the scan's close-call distance of the cut-off. */
  closeCalls: number;
}

/** A scan as stored on the lab (`labs.pause_scan`): the server adds when it was saved, in ms. */
export interface StoredLabPauseScan extends LabPauseScan {
  scannedAt: number;
}

/** The ranges the server accepts for each number of a `LabPauseScan` (both ends included). */
export const PAUSE_SCAN_LIMITS = {
  minPauseMs: [1000, 10_000],
  thresholdDb: [-120, 0],
  noiseDb: [-200, 0],
  shortestKeptMs: [0, 60_000],
  longestLeftOutMs: [0, 60_000],
  closeCalls: [0, 400],
} as const;

/**
 * The rules a lab session is judged by, written on its `open` listening entry
 * when it begins, so a rescan, an edit or a new setting during class changes
 * only sessions opened afterwards.
 *
 * `pauses` is the counted list (already cut by the lab's "don't count pauses
 * after" point and must-hear-through point), or null when the lab had not been
 * scanned. A session is scored when it is a non-empty list.
 */
export interface LabRules {
  v: 1;
  pauses: LabPause[] | null;
  /** Share of the counted pauses that must be answered (0 = the rule is off). */
  pct: number;
  /** Voice needed in a pause, in ms. */
  floor: number;
  /** The lab's must-hear-through point when the session began. */
  requiredThroughMs: number;
  /**
   * The room margin for the page's voice meter, in dB (v1.16.0). Missing on
   * sessions opened before it, and when unreadable: the page uses
   * DEFAULT_GATE_MARGIN_DB.
   */
  gateMarginDb?: number;
  /** Hold a lab with voice outside the pauses for the teacher (v1.16.0). Missing: no. */
  holdOutsideVoice?: boolean;
  /**
   * The exam set this session was opened under (v1.19.0, shared examLabs): the
   * session plays as a test, unscored, with no microphone. Missing: practice.
   */
  exam?: string;
}

/** The teacher's pause-rule settings (`lab_settings` row 1). */
export interface LabPauseSettings {
  minAnsweredPct: number;
  voicePerPauseMs: number;
  /** The voice meter's room margin, in dB. */
  gateMarginDb: number;
  /** Also hold labs with voice outside the pauses ("Voice outside the pauses") for the teacher. */
  holdOutsideVoice: boolean;
}

/**
 * The part of a pause where voice counts: from 0.3 s after it starts to 0.1 s
 * before it ends.
 */
export function pauseWindow([startMs, endMs]: readonly [number, number]): { from: number; to: number } {
  return { from: startMs + PAUSE_LEAD_MS, to: endMs - PAUSE_TAIL_CUT_MS };
}

/** How long the counting window of a pause is: its length less 0.4 s (never below 0). */
export function pauseWindowMs(pause: readonly [number, number]): number {
  const { from, to } = pauseWindow(pause);
  return Math.max(0, to - from);
}

export type PauseListProblem =
  | 'not-a-list'
  | 'too-many'
  | 'not-a-pair'
  | 'not-integers'
  | 'out-of-range'
  | 'too-short'
  | 'too-long'
  | 'unsorted'
  | 'overlap';

/**
 * Whether a pause list fits a lab `durationMs` long: at most 400 pauses, each
 * a pair of integers with 0 ≤ start < end ≤ durationMs and a length of 1–60 s,
 * sorted by start with no overlap. An empty list is valid (scanned, none found).
 * `index` names the first pause that fails.
 */
export function validatePauseList(
  list: unknown,
  durationMs: number,
): { ok: true } | { ok: false; reason: PauseListProblem; index?: number } {
  if (!Array.isArray(list)) return { ok: false, reason: 'not-a-list' };
  if (list.length > MAX_PAUSES_PER_LAB) return { ok: false, reason: 'too-many' };
  let previous: readonly [number, number] | null = null;
  for (let index = 0; index < list.length; index++) {
    const pause: unknown = list[index];
    if (!Array.isArray(pause) || pause.length !== 2) return { ok: false, reason: 'not-a-pair', index };
    const [startMs, endMs] = pause as unknown[];
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) return { ok: false, reason: 'not-integers', index };
    const s = startMs as number;
    const e = endMs as number;
    if (s < 0 || s >= e || e > durationMs) return { ok: false, reason: 'out-of-range', index };
    if (e - s < MIN_PAUSE_LENGTH_MS) return { ok: false, reason: 'too-short', index };
    if (e - s > MAX_PAUSE_LENGTH_MS) return { ok: false, reason: 'too-long', index };
    if (previous) {
      if (s < previous[0]) return { ok: false, reason: 'unsorted', index };
      if (s < previous[1]) return { ok: false, reason: 'overlap', index };
    }
    previous = [s, e];
  }
  return { ok: true };
}

/**
 * The pauses a session counts: those that start before the lab's "don't count
 * pauses after" point (null: no such point), and end at least 1.5 s before its
 * must-hear-through point, since a student may Finish there.
 */
export function countedPauses(
  all: readonly (readonly [number, number])[],
  countUntilMs: number | null | undefined,
  requiredThroughMs: number,
): LabPause[] {
  const lastEnd = requiredThroughMs - PAUSE_FINISH_SLACK_MS;
  return all
    .filter(([s, e]) => (countUntilMs == null || s < countUntilMs) && e <= lastEnd)
    .map(([s, e]): LabPause => [s, e]);
}

/** How many of `counted` pauses must be answered at `pct` percent (rounded up; 0 when the rule is off). */
export function neededPauses(counted: number, pct: number): number {
  if (!(counted > 0) || !(pct > 0)) return 0;
  // counted and pct are integers, so counted * pct / 100 is either whole or at least 0.01 over.
  return Math.min(counted, Math.ceil((counted * Math.min(pct, 100)) / 100 - 1e-9));
}

/**
 * "Check the count": the scan found pauses, but some silences sit close to the
 * cut-off, the kept pauses and the longest silence left out are less than
 * 0.4 s apart, there is sound under the pauses (noise floor above −40 dBFS),
 * or there are too few pauses for a pause-and-respond lab. The teacher should
 * compare the count with the lab's transcript. `pauseCount` is the number of
 * pauses the scan found.
 */
export function scanNeedsCheck(scan: LabPauseScan | null | undefined, pauseCount: number): boolean {
  if (!scan || !(pauseCount > 0)) return false;
  if (scan.closeCalls > 0) return true;
  if (scan.shortestKeptMs != null && scan.longestLeftOutMs != null
      && scan.shortestKeptMs - scan.longestLeftOutMs < CHECK_MIN_MARGIN_MS) return true;
  if (scan.noiseDb > CHECK_NOISE_DB) return true;
  return pauseCount < CHECK_MIN_PAUSES;
}

const clampInt = (value: unknown, [min, max]: readonly [number, number], fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * The teacher's settings as the rules use them: missing or unreadable values
 * are the defaults, and the rest are whole numbers within the ranges (a floor
 * under 0.2 s reads as 0.2 s). The hold is on only when it is `true`.
 */
export function clampLabSettings(
  raw: {
    minAnsweredPct?: number | null;
    voicePerPauseMs?: number | null;
    gateMarginDb?: number | null;
    holdOutsideVoice?: boolean | null;
  } | null | undefined,
): LabPauseSettings {
  return {
    minAnsweredPct: clampInt(raw?.minAnsweredPct, MIN_ANSWERED_PCT_RANGE, DEFAULT_MIN_ANSWERED_PCT),
    voicePerPauseMs: clampInt(raw?.voicePerPauseMs, VOICE_PER_PAUSE_RANGE_MS, DEFAULT_VOICE_PER_PAUSE_MS),
    gateMarginDb: clampInt(raw?.gateMarginDb, GATE_MARGIN_RANGE_DB, DEFAULT_GATE_MARGIN_DB),
    holdOutsideVoice: raw?.holdOutsideVoice === true,
  };
}

function parseJson(text: string | null | undefined): unknown {
  if (text == null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toPauseList(value: unknown): LabPause[] | null {
  if (!Array.isArray(value)) return null;
  const pauses: LabPause[] = [];
  for (const pause of value) {
    if (!Array.isArray(pause) || pause.length !== 2
        || typeof pause[0] !== 'number' || typeof pause[1] !== 'number') return null;
    pauses.push([pause[0], pause[1]]);
  }
  return pauses;
}

/**
 * A lab's stored pause list (`labs.pauses`): null when the lab was never
 * scanned, or when the text is not a list of `[startMs, endMs]` number pairs.
 */
export function parsePauseList(text: string | null | undefined): LabPause[] | null {
  return toPauseList(parseJson(text));
}

/**
 * A session's rules as stored on its open row (`lab_listen_events.rules`):
 * null when there are none (a session opened before the pause rule) or the
 * text is not version-1 rules. The caller decides what null means.
 *
 * The optional fields are left out when missing or unreadable, never a reason
 * for null: a room margin outside 4–12 dB, a hold that is not a boolean, or an
 * exam set that is not a stored set name, reads as not set.
 */
export function parseLabRules(text: string | null | undefined): LabRules | null {
  const value = parseJson(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { v, pauses, pct, floor, requiredThroughMs, gateMarginDb, holdOutsideVoice, exam } = value as Record<string, unknown>;
  if (v !== LAB_RULES_VERSION) return null;
  if (typeof pct !== 'number' || typeof floor !== 'number' || typeof requiredThroughMs !== 'number') return null;
  const list = pauses === null ? null : toPauseList(pauses);
  if (pauses !== null && !list) return null;
  const rules: LabRules = { v: 1, pauses: list, pct, floor, requiredThroughMs };
  if (typeof gateMarginDb === 'number' && gateMarginDb >= GATE_MARGIN_RANGE_DB[0] && gateMarginDb <= GATE_MARGIN_RANGE_DB[1]) {
    rules.gateMarginDb = gateMarginDb;
  }
  if (typeof holdOutsideVoice === 'boolean') rules.holdOutsideVoice = holdOutsideVoice;
  // Only a set name as the server stores it; anything else reads as practice.
  if (typeof exam === 'string' && canonicalExamSet(exam) === exam) rules.exam = exam;
  return rules;
}

/** The voice meter a lab page measures with: 2 is v1.16.0's room-relative meter (1 was the fixed −45 dBFS gate). */
export const LAB_METER_VERSION = 2;

/**
 * The microphone processing the lab page's browser reports (`track.getSettings()`).
 * It shows what the browser says it applies, not whether ChromeOS or Chrome does
 * the work. Any entry may be missing; nothing else is kept (never a device id).
 */
export interface LabMicProcessing {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  voiceIsolation?: boolean;
  sampleRate?: number;
}

/**
 * What the lab page's voice meter measured over a session, sent on submit and
 * kept on the row (`lab_submissions.mic_stats`) for the teacher's Review page:
 * the new meter's room level and gate next to the old meter's count, so the
 * teacher can compare them before raising the rule. The page reports it, so a
 * console script can forge it: it is information, never evidence, and never
 * changes credit. Levels are dBFS.
 */
export interface LabMicStats {
  meter: typeof LAB_METER_VERSION;
  /** The room level (the meter's ambient estimate), median over the session; null when never measured. */
  ambientDbP50: number | null;
  /** The level a voice had to pass (room level plus the margin, never under −55), median; null when never measured. */
  gateDbP50: number | null;
  /** How far the frames counted as voice were over the gate, median, in dB; null when none were. */
  voiceOverGateDbP50: number | null;
  /** Pauses the old meter (any sound over −45 dBFS) would have answered; null when the session had no pause list. */
  levelOnlyAnswered: number | null;
  /** Sound over the gate in the pause windows that was not a voice (taps, noise), in ms. */
  loudNotVoiceInPausesMs: number;
  /** Time the lab played while the page did not have focus (split screen, a window on top), in ms. */
  unfocusedPlayedMs: number;
  /** How the mic check passed: on 0.5 s of voice, on level only (1 s over −45 dBFS), or null (not passed, or skipped). */
  micCheck: 'voice' | 'level' | null;
  /** The browser's microphone processing, or null when the page could not read it. */
  processing: LabMicProcessing | null;
}

/** The ranges the numbers of `LabMicStats` may take (both ends included). */
export const LAB_MIC_STATS_LIMITS = {
  ambientDbP50: [-200, 20],
  gateDbP50: [-200, 40],
  voiceOverGateDbP50: [-100, 100],
  levelOnlyAnswered: [0, MAX_PAUSES_PER_LAB],
  loudNotVoiceInPausesMs: [0, MAX_ANSWER_START_MS],
  unfocusedPlayedMs: [0, MAX_ANSWER_START_MS],
  sampleRate: [3000, 768_000],
} as const;

type MicStatsNumber = Exclude<keyof typeof LAB_MIC_STATS_LIMITS, 'sampleRate'>;
const MIC_STATS_DB: readonly MicStatsNumber[] = ['ambientDbP50', 'gateDbP50', 'voiceOverGateDbP50'];
const MIC_STATS_NULLABLE: readonly MicStatsNumber[] = [...MIC_STATS_DB, 'levelOnlyAnswered'];
const MIC_STATS_WHOLE: readonly MicStatsNumber[] = ['levelOnlyAnswered', 'loudNotVoiceInPausesMs', 'unfocusedPlayedMs'];
const MIC_PROCESSING_SWITCHES = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation'] as const;

/** Levels keep one decimal, counts and times are whole: the stored JSON stays small. */
const roundMicStat = (field: MicStatsNumber, value: number): number =>
  (MIC_STATS_WHOLE.includes(field) ? Math.round(value) : Math.round(value * 10) / 10) || 0;

const inRange = (value: unknown, [min, max]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The processing entries that are what they should be; the rest are left out. */
function pickProcessing(raw: Record<string, unknown>): LabMicProcessing {
  const processing: LabMicProcessing = {};
  for (const key of MIC_PROCESSING_SWITCHES) {
    if (typeof raw[key] === 'boolean') processing[key] = raw[key];
  }
  if (inRange(raw.sampleRate, LAB_MIC_STATS_LIMITS.sampleRate)) processing.sampleRate = Math.round(raw.sampleRate);
  return processing;
}

/**
 * Whether `value` is a page's `LabMicStats`: meter 2, every field present, each
 * number finite and within LAB_MIC_STATS_LIMITS (null only where the type
 * allows it). `field` names the first that fails. The stats come back rebuilt
 * from the known fields only, rounded (levels to 0.1 dB, counts and times to
 * whole numbers). Processing entries are the browser's own report, so one of
 * an unexpected type is left out rather than failing the stats. A page that
 * sends `clampLabMicStats(...)` always passes.
 */
export function validateLabMicStats(
  value: unknown,
): { ok: true; stats: LabMicStats } | { ok: false; field: keyof LabMicStats | null } {
  if (!isPlainObject(value)) return { ok: false, field: null };
  if (value.meter !== LAB_METER_VERSION) return { ok: false, field: 'meter' };
  const numbers = {} as Record<MicStatsNumber, number | null>;
  for (const field of Object.keys(LAB_MIC_STATS_LIMITS) as (keyof typeof LAB_MIC_STATS_LIMITS)[]) {
    if (field === 'sampleRate') continue;
    const raw = value[field];
    if (raw === null && MIC_STATS_NULLABLE.includes(field)) {
      numbers[field] = null;
    } else if (inRange(raw, LAB_MIC_STATS_LIMITS[field])) {
      numbers[field] = roundMicStat(field, raw);
    } else {
      return { ok: false, field };
    }
  }
  const { micCheck, processing } = value;
  if (micCheck !== 'voice' && micCheck !== 'level' && micCheck !== null) return { ok: false, field: 'micCheck' };
  if (processing !== null && !isPlainObject(processing)) return { ok: false, field: 'processing' };
  return {
    ok: true,
    stats: {
      meter: LAB_METER_VERSION,
      ambientDbP50: numbers.ambientDbP50,
      gateDbP50: numbers.gateDbP50,
      voiceOverGateDbP50: numbers.voiceOverGateDbP50,
      levelOnlyAnswered: numbers.levelOnlyAnswered,
      loudNotVoiceInPausesMs: numbers.loudNotVoiceInPausesMs ?? 0,
      unfocusedPlayedMs: numbers.unfocusedPlayedMs ?? 0,
      micCheck,
      processing: processing === null ? null : pickProcessing(processing),
    },
  };
}

/** A row's stored mic stats (`lab_submissions.mic_stats`): null when there are none or they are unreadable. */
export function parseLabMicStats(text: string | null | undefined): LabMicStats | null {
  const result = validateLabMicStats(parseJson(text));
  return result.ok ? result.stats : null;
}

/** What the page has measured, before `clampLabMicStats` makes it sendable. */
export interface LabMicStatsInput {
  ambientDbP50?: number | null;
  gateDbP50?: number | null;
  voiceOverGateDbP50?: number | null;
  levelOnlyAnswered?: number | null;
  loudNotVoiceInPausesMs?: number | null;
  unfocusedPlayedMs?: number | null;
  micCheck?: 'voice' | 'level' | null;
  /** `track.getSettings()` as the browser returns it. */
  processing?: {
    echoCancellation?: unknown;
    noiseSuppression?: unknown;
    autoGainControl?: unknown;
    voiceIsolation?: unknown;
    sampleRate?: unknown;
  } | null;
}

/**
 * The page's measurements as stats the server accepts: numbers clamped into
 * LAB_MIC_STATS_LIMITS and rounded, −Infinity (digital silence) at the bottom
 * of its range, and a missing or NaN value as null, or 0 where null is not
 * allowed. Echo cancellation reported as the newer 'all' reads as on; any other
 * unexpected processing entry is left out.
 */
export function clampLabMicStats(raw: LabMicStatsInput): LabMicStats {
  const number = (field: MicStatsNumber): number | null => {
    const value = raw[field];
    if (typeof value !== 'number' || Number.isNaN(value)) return MIC_STATS_NULLABLE.includes(field) ? null : 0;
    const [min, max] = LAB_MIC_STATS_LIMITS[field];
    return roundMicStat(field, Math.min(max, Math.max(min, value)));
  };
  let processing: LabMicProcessing | null = null;
  if (isPlainObject(raw.processing)) {
    const reported: Record<string, unknown> = { ...raw.processing };
    if (reported.echoCancellation === 'all') reported.echoCancellation = true;
    processing = pickProcessing(reported);
  }
  return {
    meter: LAB_METER_VERSION,
    ambientDbP50: number('ambientDbP50'),
    gateDbP50: number('gateDbP50'),
    voiceOverGateDbP50: number('voiceOverGateDbP50'),
    levelOnlyAnswered: number('levelOnlyAnswered'),
    loudNotVoiceInPausesMs: number('loudNotVoiceInPausesMs') ?? 0,
    unfocusedPlayedMs: number('unfocusedPlayedMs') ?? 0,
    micCheck: raw.micCheck === 'voice' || raw.micCheck === 'level' ? raw.micCheck : null,
    processing,
  };
}
