// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { access } from 'fs/promises';
import { resolve } from 'path';
import {
  EXAM_APP_CODES,
  GATE_MARGIN_RANGE_DB,
  LAB_CLIENT,
  LAB_RULES_VERSION,
  MAX_ANSWERS_PER_REPORT,
  MAX_ANSWER_START_MS,
  MAX_ANSWER_VOICED_MS,
  MAX_LOG_LEAD_MS,
  MAX_PAUSES_PER_LAB,
  MAX_SUBMIT_ANSWERS,
  MAX_SUBMIT_REPORTS,
  MIN_ANSWERED_PCT_RANGE,
  PAUSE_SCAN_LIMITS,
  VOICE_PER_PAUSE_RANGE_MS,
  canonicalExamSet,
  countedPauses,
  neededPauses,
  parseLabMicStats,
  parseLabRules,
  parsePauseList,
  scanNeedsCheck,
  validateLabMicStats,
  validatePauseList,
  type LabPauseScan,
  type LabRules,
  type StoredLabPauseScan,
} from '@libresrs/shared';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { eq, and, asc, desc, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { logger } from '../logger.js';
import { getAssetsDir } from '../services/ai/assetStorage.js';
import {
  LISTEN_EVENT_KINDS,
  LISTEN_TICK_MS,
  MAX_ATTEMPTS_PER_LAB,
  MAX_LISTEN_EVENTS,
  MAX_OPENS_PER_DAY,
  RED_LAB_FLAGS,
  type LabSubmissionFlag,
  listeningProblem,
  minimumVoicedMs,
  signLabStart,
  submissionFlags,
  summarizeListening,
  verifyLabStart,
  type ListenEvent,
  type StoredLabSubmissionFlag,
} from '../services/labMedia.js';
import {
  NOISY_HOLD_MIN_OUTSIDE_RATE,
  logLeadMs,
  parseAnswers,
  pauseSoundFlags,
  pauseVoiceOutrunsTotal,
  scorePauses,
  sessionRule,
  shortAnswerRows,
  voiceOutsideThePauses,
  type PauseScore,
  type ScoredEvent,
} from '../services/labPauses.js';
import {
  automaticCredit,
  countingRow,
  decideCredit,
  effectiveCredit,
  neededForRow,
  newestFirst,
  parseHeldFor,
  rowStatus,
  studentLabStatus,
  type LabHoldReason,
} from '../services/labCredit.js';
import { getLabSettings, saveLabSettings } from '../services/labSettings.js';
import { ASSET_AUDIO_URL_RE } from '../services/recordings.js';
import * as exams from '../services/examLabs.js';

type Lab = typeof schema.labs.$inferSelect;
type Submission = typeof schema.labSubmissions.$inferSelect;
const E = schema.labListenEvents;
const S = schema.labSubmissions;

/** An old page (loaded before the pause rule) opening a lab. */
export const RELOAD_MESSAGE = 'libreSRS was updated. Reload this page to do the lab.';
/** A session opened before the pause rule, turned in more than 6 hours later. */
export const LEGACY_EXPIRED_MESSAGE = 'This lab session is from before an update. Open the lab again.';
export const PAUSE_LIST_MESSAGE = 'This pause list does not fit the lab. Find the pauses again.';
export const ASK_TEACHER_MESSAGE = "This lab can't be sent to your teacher.";
const SESSION_EXPIRED_MESSAGE = 'This lab session has expired. Open the lab again.';
/** Exam labs (v1.19.0). The page words each refusal itself, from its appCode (shared EXAM_APP_CODES). */
export const EXAM_USED_MESSAGE = 'You already started this test. Ask your teacher.';
export const EXAM_CHANGED_MESSAGE = 'This test was changed. Reload the page.';
export const EXAM_NOT_STARTED_MESSAGE = 'This test was not started. Ask your teacher.';
export const EXAM_SET_MESSAGE = 'Name the exam set (for example U3), in 40 characters or fewer.';
export const EXAM_ALREADY_RESET_MESSAGE = 'This start was already reset. Reload the list.';
const examUsed = () => new TRPCError({ code: 'CONFLICT', message: EXAM_USED_MESSAGE, cause: { appCode: EXAM_APP_CODES.used } });
const examSetInvalid = () => new TRPCError({ code: 'BAD_REQUEST', message: EXAM_SET_MESSAGE, cause: { appCode: EXAM_APP_CODES.setInvalid } });
const attemptsMessage = (n: number) =>
  `This lab has already been turned in ${n} times. Ask your teacher before trying again.`;
/** Another session's play/tick entries must span this much server time to count as "two at once". */
const OVERLAP_MIN_SPAN_MS = 30_000;

/** Natural order, so "semana 2" sorts before "semana 10". */
const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------------------
// Inputs

const positionMs = z.number().min(0).max(24 * 60 * 60 * 1000);
const clientMs = z.number().min(0).max(8 * 24 * 60 * 60 * 1000);
/** One pause result: the pause's start and the voice heard in its window. */
const answer = z.tuple([
  z.number().int().min(0).max(MAX_ANSWER_START_MS),
  z.number().int().min(0).max(MAX_ANSWER_VOICED_MS),
]);
/** A pause list as the teacher's browser found it; validatePauseList checks the rest. */
const pauseList = z.array(z.tuple([z.number(), z.number()])).max(MAX_PAUSES_PER_LAB * 2);
const range = (limits: readonly [number, number]) => z.number().min(limits[0]).max(limits[1]);
const intRange = (limits: readonly [number, number]) => z.number().int().min(limits[0]).max(limits[1]);
/** What the scan measured, within bounds (shared PAUSE_SCAN_LIMITS). */
const pauseScan = z.object({
  minPauseMs: intRange(PAUSE_SCAN_LIMITS.minPauseMs),
  thresholdDb: range(PAUSE_SCAN_LIMITS.thresholdDb),
  noiseDb: range(PAUSE_SCAN_LIMITS.noiseDb),
  shortestKeptMs: intRange(PAUSE_SCAN_LIMITS.shortestKeptMs).nullable(),
  longestLeftOutMs: intRange(PAUSE_SCAN_LIMITS.longestLeftOutMs).nullable(),
  closeCalls: intRange(PAUSE_SCAN_LIMITS.closeCalls),
});

// ---------------------------------------------------------------------------
// Groups and audience

async function groupIdsByLab(labIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (labIds.length === 0) return map;
  const rows = await db.select().from(schema.labGroups).where(inArray(schema.labGroups.labId, labIds));
  for (const row of rows) map.set(row.labId, [...(map.get(row.labId) ?? []), row.groupId]);
  return map;
}

async function userGroupIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ groupId: schema.userGroups.groupId })
    .from(schema.userGroups)
    .where(eq(schema.userGroups.userId, userId));
  return new Set(rows.map((r) => r.groupId));
}

/**
 * Whether a lab is for this student. A lab that is not for everyone and has no
 * groups left (its groups were deleted) is for nobody: it fails closed.
 */
function labIsForStudent(lab: Pick<Lab, 'forEveryone'>, labGroupIds: number[] | undefined, studentGroupIds: Set<number>): boolean {
  if (lab.forEveryone) return true;
  return (labGroupIds ?? []).some((id) => studentGroupIds.has(id));
}

/** Refuses group ids that do not exist, before anything is written. */
async function assertGroupsExist(groupIds: number[]) {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) return unique;
  const found = await db.select({ id: schema.groups.id }).from(schema.groups).where(inArray(schema.groups.id, unique));
  if (found.length !== unique.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'One of the chosen groups no longer exists. Reload and try again.' });
  }
  return unique;
}

/**
 * The lab, if this user may do it. Admins may open any lab, active or not, so
 * the teacher can try one before releasing it.
 */
export async function assertLabVisible(user: { id: number; role: string }, labId: number): Promise<Lab> {
  const lab = await db.query.labs.findFirst({ where: eq(schema.labs.id, labId) });
  if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
  if (user.role === 'admin') return lab;
  if (!lab.active) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });

  const labGroupIds = (await groupIdsByLab([lab.id])).get(lab.id);
  if (!labIsForStudent(lab, labGroupIds, await userGroupIds(user.id))) {
    logger.warn({ userId: user.id, labId }, 'Student attempted a lab outside their groups');
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This lab is not assigned to you' });
  }
  return lab;
}

/** Students who should turn a lab in. Admins never count as students. */
async function expectedStudents(lab: Pick<Lab, 'forEveryone'>, labGroupIds: number[]) {
  const columns = { id: schema.users.id, name: schema.users.name, email: schema.users.email };
  if (lab.forEveryone) {
    return db.select(columns).from(schema.users).where(ne(schema.users.role, 'admin'));
  }
  if (labGroupIds.length === 0) return [];
  return db.selectDistinct(columns)
    .from(schema.users)
    .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
    .where(and(inArray(schema.userGroups.groupId, labGroupIds), ne(schema.users.role, 'admin')));
}

/** The students an exam set is for: every student any of its labs is for, once each (never a teacher). */
async function setAudience(labs: readonly Pick<Lab, 'id' | 'forEveryone'>[]) {
  const labGroups = await groupIdsByLab(labs.map((l) => l.id));
  const students = new Map<number, { id: number; name: string; email: string }>();
  for (const lab of labs) {
    for (const student of await expectedStudents(lab, labGroups.get(lab.id) ?? [])) students.set(student.id, student);
  }
  return students;
}

const clampRequired = (requiredThroughMs: number, durationMs: number) =>
  Math.max(0, Math.min(Math.round(requiredThroughMs), Math.round(durationMs)));

// ---------------------------------------------------------------------------
// Pause lists

/** The stored scan (`labs.pause_scan`), or null when there is none or it cannot be read. */
function parseStoredScan(text: string | null): StoredLabPauseScan | null {
  if (text == null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scan = value as Record<string, unknown>;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    const numOrNull = (v: unknown) => v === null || num(v);
    if (!num(scan.minPauseMs) || !num(scan.thresholdDb) || !num(scan.noiseDb) || !num(scan.closeCalls)
        || !numOrNull(scan.shortestKeptMs) || !numOrNull(scan.longestLeftOutMs) || !num(scan.scannedAt)) return null;
    return {
      minPauseMs: scan.minPauseMs as number,
      thresholdDb: scan.thresholdDb as number,
      noiseDb: scan.noiseDb as number,
      shortestKeptMs: scan.shortestKeptMs as number | null,
      longestLeftOutMs: scan.longestLeftOutMs as number | null,
      closeCalls: scan.closeCalls as number,
      scannedAt: scan.scannedAt as number,
    };
  } catch {
    return null;
  }
}

/** The pause list to store, or BAD_REQUEST when it does not fit a lab this long. */
function checkedPauseList(pauses: unknown, durationMs: number): string {
  const verdict = validatePauseList(pauses, durationMs);
  if (!verdict.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: PAUSE_LIST_MESSAGE });
  return JSON.stringify(pauses);
}

const storedScan = (scan: LabPauseScan | null | undefined, nowMs: number): string | null =>
  scan ? JSON.stringify({ ...scan, scannedAt: nowMs } satisfies StoredLabPauseScan) : null;

/**
 * What the teacher's screens show about a lab's pauses. `pauseCount` is the
 * number that count now (after "don't count pauses after" and the
 * must-hear-through point), `pauseTotal` all the scan found; both are null
 * when the lab has not been scanned.
 */
function pauseSummary(lab: Pick<Lab, 'pauses' | 'pauseScan' | 'pauseCountUntilMs' | 'requiredThroughMs'>) {
  const list = parsePauseList(lab.pauses);
  const scan = parseStoredScan(lab.pauseScan);
  return {
    pauseCount: list === null ? null : countedPauses(list, lab.pauseCountUntilMs, lab.requiredThroughMs).length,
    pauseTotal: list === null ? null : list.length,
    pauseScan: scan,
    pauseCountUntilMs: lab.pauseCountUntilMs,
    needsCheck: list !== null && scanNeedsCheck(scan, list.length),
  };
}

// ---------------------------------------------------------------------------
// Listening log

/** The columns of a listening entry any reader may see: never the session's `rules`. */
const eventColumns = {
  id: E.id,
  labId: E.labId,
  userId: E.userId,
  sessionStartedAt: E.sessionStartedAt,
  kind: E.kind,
  positionMs: E.positionMs,
  clientMs: E.clientMs,
  at: E.at,
  answers: E.answers,
};
type EventRow = { [K in keyof typeof eventColumns]: (typeof E.$inferSelect)[K] };

/** A student's listening log for one lab, grouped into sessions (one per start token), newest first. */
function sessionsFrom(rows: EventRow[]) {
  const bySession = new Map<number, EventRow[]>();
  for (const row of rows) bySession.set(row.sessionStartedAt, [...(bySession.get(row.sessionStartedAt) ?? []), row]);
  return [...bySession.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([startedAt, events]) => ({
      startedAt,
      events,
      /** Whether playback ever began, as opposed to the lab only being opened. */
      started: events.some((e) => e.kind !== 'open' && e.kind !== 'nomic'),
      summary: summarizeListening(events as ListenEvent[], startedAt),
    }));
}

const thisSessionEvents = (labId: number, userId: number, sessionStartedAt: number) => and(
  eq(E.labId, labId),
  eq(E.userId, userId),
  eq(E.sessionStartedAt, sessionStartedAt),
);

/** One session's listening log, oldest first, without its rules. A session holds at most MAX_LISTEN_EVENTS rows. */
export function loadSession(labId: number, userId: number, sessionStartedAt: number): EventRow[] {
  return db.select(eventColumns).from(E)
    .where(thisSessionEvents(labId, userId, sessionStartedAt))
    .orderBy(asc(E.at), asc(E.id))
    .all();
}

/** The rules written on a session's first `open` row: undefined without one, null when it has none. */
function sessionRulesText(labId: number, userId: number, sessionStartedAt: number): string | null | undefined {
  const open = db.select({ rules: E.rules }).from(E)
    .where(and(thisSessionEvents(labId, userId, sessionStartedAt), eq(E.kind, 'open')))
    .orderBy(asc(E.at), asc(E.id))
    .limit(1)
    .get();
  return open ? open.rules : undefined;
}

/**
 * Each student's newest sessions on a lab, every row of each, plus what is
 * known about all of their sessions (how many, when last seen). Bounded per
 * student and by whole sessions — never a global row limit, which would let
 * one student's flood push a classmate's log out, or cut a session in half
 * and score it as a skip.
 */
async function loadRecentSessions(labId: number, userIds: number[], sessionsPerStudent: number) {
  const result = new Map<number, { rows: EventRow[]; lastSeenAt: number | null; sessionCount: number }>();
  if (userIds.length === 0) return result;
  const keys = await db
    .select({
      userId: E.userId,
      sessionStartedAt: E.sessionStartedAt,
      last: sql<number>`max(${E.at})`,
    })
    .from(E)
    .where(and(eq(E.labId, labId), inArray(E.userId, userIds)))
    .groupBy(E.userId, E.sessionStartedAt);

  for (const userId of userIds) {
    const own = keys.filter((k) => k.userId === userId).sort((a, b) => b.sessionStartedAt - a.sessionStartedAt);
    const recent = own.slice(0, sessionsPerStudent).map((k) => k.sessionStartedAt);
    const rows = recent.length === 0 ? [] : await db.select(eventColumns).from(E)
      .where(and(eq(E.labId, labId), eq(E.userId, userId), inArray(E.sessionStartedAt, recent)))
      .orderBy(asc(E.at));
    result.set(userId, {
      rows,
      lastSeenAt: own.length > 0 ? Math.max(...own.map((k) => k.last)) : null,
      sessionCount: own.length,
    });
  }
  return result;
}

/**
 * "Two at once": the other sessions of this student (any lab) with play or
 * tick entries between this session's first play and now, spanning at least
 * 30 s of server time. A late retry burst from an abandoned session spans
 * about 0 s and does not count. Uses the (user_id, at) index.
 */
function playedTwoAtOnce(
  userId: number, labId: number, startedAtMs: number, events: readonly ScoredEvent[], nowMs: number,
): { labId: number; sessionStartedAt: number }[] {
  const plays = events.filter((e) => e.kind === 'play');
  const from = Math.min(...(plays.length > 0 ? plays : events.filter((e) => e.kind === 'tick')).map((e) => e.at));
  if (!Number.isFinite(from)) return [];
  const others = db
    .select({ labId: E.labId, sessionStartedAt: E.sessionStartedAt, span: sql<number>`max(${E.at}) - min(${E.at})` })
    .from(E)
    .where(and(
      eq(E.userId, userId),
      gte(E.at, from),
      lte(E.at, nowMs),
      inArray(E.kind, ['play', 'tick']),
      or(ne(E.labId, labId), ne(E.sessionStartedAt, startedAtMs)),
    ))
    .groupBy(E.labId, E.sessionStartedAt)
    .all();
  return others.filter((o) => o.span >= OVERLAP_MIN_SPAN_MS).map(({ labId: l, sessionStartedAt }) => ({ labId: l, sessionStartedAt }));
}

/**
 * Whether one of these overlapping sessions is of another lab and was already
 * turned in: the lab now being turned in is the second of two played at once.
 * The first keeps its credit (and its flag); a second window on the same lab
 * gains the student nothing, and one abandoned is never turned in.
 */
function secondOfTwoLabs(userId: number, labId: number, overlapping: readonly { labId: number; sessionStartedAt: number }[]): boolean {
  const others = overlapping.filter((o) => o.labId !== labId);
  if (others.length === 0) return false;
  const turnedIn = db.select({ id: S.id }).from(S)
    .where(and(
      eq(S.userId, userId),
      or(...others.map((o) => and(eq(S.labId, o.labId), eq(S.startedAt, new Date(o.sessionStartedAt))))),
    ))
    .limit(1)
    .get();
  return turnedIn !== undefined;
}

// ---------------------------------------------------------------------------
// Submissions

/** What the page shows once a lab is turned in, and what a retry of the same session gets back. */
export function resultFromRow(row: Submission) {
  return {
    submissionId: row.id,
    credit: effectiveCredit(row),
    status: rowStatus(row).status,
    scored: row.pausesCounted != null,
    pausesAnswered: row.pausesAnswered,
    pausesCounted: row.pausesCounted,
    needed: neededForRow(row),
    mic: row.mic,
  };
}
export type LabSubmitResult = ReturnType<typeof resultFromRow>;

const flagsOf = (row: Pick<Submission,
  'voicedMs' | 'skipCount' | 'requiredThroughMs' | 'pausesCounted' | 'rejectedAnswers' | 'lateAnswers' | 'mic' | 'flags' | 'examSet'>,
shortAnswers = false) =>
  submissionFlags({
    voicedMs: row.voicedMs,
    skipCount: row.skipCount,
    requiredThroughMs: row.requiredThroughMs,
    pausesCounted: row.pausesCounted,
    rejectedAnswers: row.rejectedAnswers,
    lateAnswers: row.lateAnswers,
    mic: row.mic,
    stored: row.flags,
    shortAnswers,
    // A test has no microphone by design: never No microphone or Little speech.
    exam: row.examSet != null,
  });

const isRed = (flag: LabSubmissionFlag) => RED_LAB_FLAGS.includes(flag);

const submitInput = z.object({
  labId: z.number().int(),
  startToken: z.string().max(200),
  positionMs,
  clientMs,
  /** Voice the page heard while the audio played. */
  voicedMs: z.number().min(0).max(24 * 60 * 60 * 1000),
  /** Voice it heard while the student had paused the audio (an answer given while paused). Missing is 0. */
  pausedVoicedMs: z.number().min(0).max(24 * 60 * 60 * 1000).optional(),
  listenWallMs: z.number().min(0).max(24 * 60 * 60 * 1000),
  /** 'off': done without a microphone. Missing means 'on'. A `nomic` marker in the log makes it 'off' whatever this says. */
  mic: z.enum(['on', 'off']).optional(),
  /** Pause results not yet sent; they ride on the final entry. */
  answers: z.array(answer).max(MAX_SUBMIT_ANSWERS).optional(),
  /** This session's listening reports still queued on the page, whole. */
  reports: z.array(z.object({
    kind: z.enum(LISTEN_EVENT_KINDS),
    positionMs,
    clientMs,
    answers: z.array(answer).max(MAX_ANSWERS_PER_REPORT).optional(),
  })).max(MAX_SUBMIT_REPORTS).optional(),
  /** Played time outside every counted pause, and the voice heard in it. */
  outsideVoicedMs: z.number().min(0).max(24 * 60 * 60 * 1000).optional(),
  outsidePlayedMs: z.number().min(0).max(24 * 60 * 60 * 1000).optional(),
  /**
   * What the page's voice meter measured (shared LabMicStats), for the
   * teacher. Checked by validateLabMicStats, not here: stats that fail are
   * left out and logged, never a reason to refuse the lab.
   */
  micStats: z.unknown().optional(),
});
type SubmitInput = z.infer<typeof submitInput>;

/**
 * Submits of one session in progress. A copy that arrives while the first is
 * still being judged waits for it and gets its result: a batched request with
 * many copies of one submit costs one scoring.
 */
const submitsInFlight = new Map<string, Promise<{ duplicate: boolean; result: LabSubmitResult }>>();

const answersText = (answers: readonly (readonly number[])[] | undefined) =>
  answers && answers.length > 0 ? JSON.stringify(answers) : null;

/**
 * What makes two listening reports the same one: a retry resends the same
 * report whole, results and all. Another report at the same moment with other
 * results is a different one, and both are kept.
 */
const reportKey = (e: { kind: string; clientMs: number; positionMs: number; answers: string | null }) =>
  `${e.kind}:${e.clientMs}:${e.positionMs}:${e.answers ?? ''}`;

/** A play outside "Start the test" that counted as the student's start in the lab's set now (examPlay). */
function logPlayCounted(row: exams.ExamStartRow, opened: string | null, at: 'heartbeat' | 'submit') {
  logger.info({
    event: 'lab.exam_play_counted', labId: row.labId, userId: row.userId, examSet: row.examSet, opened, startId: row.id, at,
  }, 'A play outside the test counted as the start in its set');
}

/** A listening entry the page sent, about to be stored. */
interface NewEntry {
  kind: (typeof LISTEN_EVENT_KINDS)[number];
  positionMs: number;
  clientMs: number;
  at: number;
  answers: string | null;
}

/**
 * Judges and stores one session. Synchronous from the first read to the last
 * write, so nothing else runs in between.
 *
 * An exam session (its rules carry `exam`, v1.19.0) is a test: it must have
 * been counted as a start (the teacher's own preview needs none), it is
 * judged unscored with the rule off, so the listening check alone decides,
 * and it is stored without a microphone or voice, under its exam set. A
 * session turned in on a lab that is now in a set it was not opened for (a
 * practice page left open when the lab became a test) is judged by its own
 * rules, and counts as its player's start in that set (examPlay).
 */
function turnIn(lab: Lab, userId: number, startedAtMs: number, nowMs: number, input: SubmitInput, asTeacher = false): {
  duplicate: boolean;
  result: LabSubmitResult;
} {
  // A session is turned in once; a retry after a lost response is the same submission.
  const thisSession = and(eq(S.labId, lab.id), eq(S.userId, userId), eq(S.startedAt, new Date(startedAtMs)));
  const existing = db.select().from(S).where(thisSession).get();
  if (existing) return { duplicate: true, result: resultFromRow(existing) };

  // Before any scoring: attempts past the cap are refused whatever they hold.
  const attempts = db.select({ n: sql<number>`count(*)` }).from(S)
    .where(and(eq(S.labId, lab.id), eq(S.userId, userId))).get()!.n;
  if (attempts >= MAX_ATTEMPTS_PER_LAB) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: attemptsMessage(attempts) });
  }

  const logged = loadSession(lab.id, userId, startedAtMs);
  const rulesText = sessionRulesText(lab.id, userId, startedAtMs);
  const rule = sessionRule({
    rulesText,
    requiredThroughMs: lab.requiredThroughMs,
    startedAtMs,
    nowMs,
    current: getLabSettings(),
  });
  if (rule.rule === 'expired') {
    logger.warn({ event: 'lab.submission_legacy_expired', labId: lab.id, userId, startedAtMs }, 'Lab session from before the pause rule, too old');
    throw new TRPCError({ code: 'BAD_REQUEST', message: LEGACY_EXPIRED_MESSAGE });
  }
  const examSet = parseLabRules(rulesText)?.exam ?? null;
  // The lab's set now, when this session was not opened as a form of it: turning it in counts as having heard it.
  const countIn = !asTeacher && lab.examSet !== null && lab.examSet !== examSet ? lab.examSet : null;
  if (examSet !== null && !asTeacher && !exams.sessionHasStart(userId, lab.id, startedAtMs)) {
    logger.warn({ event: 'lab.exam_not_started', labId: lab.id, userId, examSet }, 'Exam session turned in without a start');
    throw new TRPCError({ code: 'BAD_REQUEST', message: EXAM_NOT_STARTED_MESSAGE, cause: { appCode: EXAM_APP_CODES.notStarted } });
  }

  const finalEntry: NewEntry = {
    kind: 'end',
    positionMs: Math.min(Math.round(input.positionMs), lab.durationMs),
    clientMs: Math.round(input.clientMs),
    at: nowMs,
    answers: answersText(input.answers),
  };

  // The page's unsent reports join the log as if they had just arrived:
  // skipped when already stored (a retried heartbeat) or after the final
  // entry, and never past the session's cap.
  const seen = new Set(logged.map((e) => reportKey(e)));
  const room = Math.max(0, MAX_LISTEN_EVENTS - logged.length);
  const carried: NewEntry[] = [];
  for (const report of input.reports ?? []) {
    if (carried.length >= room) break;
    const entry: NewEntry = {
      kind: report.kind,
      positionMs: Math.round(report.positionMs),
      clientMs: Math.round(report.clientMs),
      at: nowMs,
      answers: answersText(report.answers),
    };
    const key = reportKey(entry);
    if (entry.clientMs > finalEntry.clientMs || seen.has(key)) continue;
    seen.add(key);
    carried.push(entry);
  }
  const events: ScoredEvent[] = [...logged, ...carried, finalEntry];

  const listening = summarizeListening(events as ListenEvent[], startedAtMs);
  const problem = listeningProblem({
    heardThroughMs: listening.heardThroughMs, requiredThroughMs: lab.requiredThroughMs, startedAtMs, nowMs,
  });
  if (problem) {
    logger.warn({
      event: 'lab.submission_rejected', labId: lab.id, userId, problem,
      heardThroughMs: listening.heardThroughMs, skips: listening.skips, logEntries: logged.length, carried: carried.length,
      elapsedMs: nowMs - startedAtMs, requiredThroughMs: lab.requiredThroughMs,
    }, 'Lab submission failed the listening check');
    throw new TRPCError({ code: 'BAD_REQUEST', message: problem });
  }

  let score: PauseScore | null = null;
  if (rule.rule === 'scored') {
    score = scorePauses({ pauses: rule.pauses, ignored: rule.dropped, events, sessionStartedAt: startedAtMs, floorMs: rule.floor });
  }
  const leadMs = score ? score.leadMs : logLeadMs(events, startedAtMs);
  // Old pages send no mic; a session opened on a new page is judged by its own rules whatever it sends.
  // The page marks in the log where it went on without a microphone, and a submit (a script's own, say)
  // cannot take that back by saying 'on'.
  const markedNoMic = events.some((e) => e.kind === 'nomic');
  // A test is done without a microphone, whatever the page says.
  const mic = examSet !== null ? 'off' : rule.rule === 'legacy' ? 'on' : markedNoMic ? 'off' : input.mic ?? 'on';
  const pct = rule.rule === 'legacy' ? 0 : rule.pct;
  const counted = rule.rule === 'scored' ? rule.pauses.length : null;
  const needed = counted === null ? 0 : neededPauses(counted, pct);
  const meetsRule = decideCredit({ rule: rule.rule, pct, answered: score?.answered ?? 0, needed, mic });

  const elapsedMs = nowMs - startedAtMs;
  const exam = examSet !== null;
  const voicedMs = exam ? 0 : Math.min(Math.round(input.voicedMs), elapsedMs);
  const pausedVoicedMs = exam ? 0 : Math.min(Math.round(input.pausedVoicedMs ?? 0), elapsedMs);
  const outsidePlayedMs = exam || input.outsidePlayedMs === undefined ? null : Math.min(Math.round(input.outsidePlayedMs), elapsedMs);
  const outsideVoicedMs = exam || input.outsideVoicedMs === undefined ? null
    : Math.min(Math.round(input.outsideVoicedMs), outsidePlayedMs ?? 0);

  // Results the page could not have sent: two or more for one pause in one
  // playback, any after the page went on without a microphone, or, without a
  // microphone, more pause voice than the page heard (playing and paused).
  const conflicts = score?.conflicts ?? 0;
  const afterNoMic = score?.afterNoMic ?? 0;
  const voiceOutrun = score !== null && counted !== null && mic === 'off'
    && pauseVoiceOutrunsTotal({ results: score.results, outsideVoicedMs, voicedMs, pausedVoicedMs, counted });
  const oddResults = conflicts > 0 || afterNoMic > 0 || voiceOutrun;
  const overlapping = playedTwoAtOnce(userId, lab.id, startedAtMs, events, nowMs);
  const sound = score && rule.rule === 'scored'
    ? { pauses: rule.pauses, results: score.results, outsideVoicedMs, outsidePlayedMs }
    : null;

  const stored: StoredLabSubmissionFlag[] = [];
  if (oddResults) stored.push('odd-answers');
  if (leadMs > MAX_LOG_LEAD_MS) stored.push('late');
  if (overlapping.length > 0) stored.push('overlap');
  if (sound) stored.push(...pauseSoundFlags(sound));

  // While the rule is on, a lab that meets it waits for the teacher instead of
  // counting when it holds results the page could not have sent, when it is
  // the second of two different labs played at once, or (the teacher's
  // choice) for voice outside the pauses. Only these signals hold: never the
  // older "3 or more rejected" rule, which a lagging Chromebook can trip.
  // A lab that fails the rule by itself stays a redo.
  const held: LabHoldReason[] = [];
  if (rule.rule !== 'legacy' && pct > 0 && meetsRule) {
    if (oddResults) held.push('odd-answers');
    if (secondOfTwoLabs(userId, lab.id, overlapping)) held.push('overlap');
    if (rule.holdOutsideVoice && sound && voiceOutsideThePauses(sound, NOISY_HOLD_MIN_OUTSIDE_RATE)) held.push('noisy');
  }
  const credit = meetsRule && held.length === 0;

  let micStats: string | null = null;
  if (input.micStats != null) {
    const checked = validateLabMicStats(input.micStats);
    if (checked.ok) {
      micStats = JSON.stringify(checked.stats);
    } else {
      logger.warn({ event: 'lab.mic_stats_refused', labId: lab.id, userId, field: checked.field }, 'Lab mic stats out of bounds, not stored');
    }
  }

  // Cap check, row, carried reports and final entry together.
  type Outcome = { kind: 'stored'; row: Submission; counted: exams.ExamStartRow | null }
    | { kind: 'duplicate'; row: Submission } | { kind: 'capped'; n: number };
  const outcome = db.transaction((tx): Outcome => {
    const again = tx.select().from(S).where(thisSession).get();
    if (again) return { kind: 'duplicate', row: again };
    const turnedIn = tx.select({ n: sql<number>`count(*)` }).from(S)
      .where(and(eq(S.labId, lab.id), eq(S.userId, userId))).get()!.n;
    if (turnedIn >= MAX_ATTEMPTS_PER_LAB) return { kind: 'capped', n: turnedIn };
    const [row] = tx.insert(S).values({
      labId: lab.id,
      userId,
      requiredThroughMs: lab.requiredThroughMs,
      voicedMs,
      listenedCoveredMs: listening.heardThroughMs,
      skipCount: listening.skips,
      listenWallMs: Math.round(input.listenWallMs),
      startedAt: new Date(startedAtMs),
      submittedAt: new Date(nowMs),
      mic,
      pausesCounted: counted,
      pausesAnswered: score?.answered ?? null,
      pauseResults: score ? JSON.stringify(score.results) : null,
      rejectedAnswers: score?.rejected ?? 0,
      lateAnswers: score?.late ?? 0,
      minAnsweredPct: rule.rule === 'legacy' ? null : rule.pct,
      voicePerPauseMs: rule.rule === 'legacy' ? null : rule.floor,
      outsideVoicedMs,
      outsidePlayedMs,
      flags: JSON.stringify(stored),
      credit,
      heldFor: held.length > 0 ? JSON.stringify(held) : null,
      micStats,
      examSet,
    }).onConflictDoNothing().returning().all();
    if (!row) return { kind: 'duplicate', row: tx.select().from(S).where(thisSession).get()! };
    const stillRoom = Math.max(0, MAX_LISTEN_EVENTS - tx.select({ n: sql<number>`count(*)` }).from(E)
      .where(thisSessionEvents(lab.id, userId, startedAtMs)).get()!.n);
    const toStore = carried.slice(0, stillRoom);
    if (toStore.length > 0) {
      tx.insert(E).values(toStore.map((e) => ({ labId: lab.id, userId, sessionStartedAt: startedAtMs, ...e }))).run();
    }
    tx.insert(E).values({ labId: lab.id, userId, sessionStartedAt: startedAtMs, ...finalEntry }).run();
    // A practice session turned in after its lab became a test (its reports may never have got through).
    const play = countIn === null ? null
      : exams.examPlay(tx, { examSet: countIn, opened: examSet, userId, lab, sessionStartedAt: startedAtMs });
    return { kind: 'stored', row, counted: play?.kind === 'ok' ? play.counted : null };
  });
  if (outcome.kind === 'capped') throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: attemptsMessage(outcome.n) });
  if (outcome.kind === 'duplicate') return { duplicate: true, result: resultFromRow(outcome.row) };

  if (outcome.counted) logPlayCounted(outcome.counted, examSet, 'submit');
  const flags = flagsOf(outcome.row);
  logger.info({
    event: 'lab.submission_received', labId: lab.id, userId, rule: rule.rule, examSet, credit, mic,
    answered: score?.answered ?? null, counted, needed: counted === null ? null : needed,
    rejected: score?.rejected ?? 0, conflicts, afterNoMic, voiceOutrun, late: score?.late ?? 0, leadMs, carried: carried.length,
    voicedMs, pausedVoicedMs, flags,
    held: held.length > 0 ? held : null,
  }, 'Lab submission received');
  return { duplicate: false, result: resultFromRow(outcome.row) };
}

// ---------------------------------------------------------------------------
// Procedures

/** A lab in the student's list (`labs.list`). */
export interface LabListItem {
  id: number;
  title: string;
  description: string | null;
  durationMs: number;
  requiredThroughMs: number;
  status: ReturnType<typeof studentLabStatus>['status'];
  redoByTeacher: boolean;
  submittedAt: Date | null;
  attempts: number;
  pausesAnswered: number | null;
  pausesCounted: number | null;
  needed: number | null;
  /** Only on an exam lab (v1.19.0), and only when asked for (`exams: true`); a practice lab has none. */
  exam?: {
    set: string;
    /** True for the teacher: previews are never limited (start is then always null). */
    preview: boolean;
    /** This student's live start in the set (any form), or null: they may start one form. */
    start: null | {
      /** Null when that lab was deleted. */
      labId: number | null;
      /** The form, as titled when the start was counted. */
      title: string;
      /** ms */
      startedAt: number;
      /** That session was turned in. */
      finished: boolean;
    };
  };
}

/** A lab's columns for the teacher's screens: everything but the raw pause list and scan. */
const labColumns = {
  id: schema.labs.id,
  title: schema.labs.title,
  description: schema.labs.description,
  audioUrl: schema.labs.audioUrl,
  mimeType: schema.labs.mimeType,
  durationMs: schema.labs.durationMs,
  requiredThroughMs: schema.labs.requiredThroughMs,
  forEveryone: schema.labs.forEveryone,
  active: schema.labs.active,
  createdBy: schema.labs.createdBy,
  createdAt: schema.labs.createdAt,
  pauseCountUntilMs: schema.labs.pauseCountUntilMs,
  /** v1.19.0: the exam set the lab is a form of; null: a practice lab. */
  examSet: schema.labs.examSet,
};

export const labsRouter = router({
  /**
   * Labs this student can do, each with where the student stands:
   * `status` todo, done (a turned-in lab counts), redo or check (waiting for
   * the teacher); `submittedAt` is when the credited attempt was turned in
   * (null until one counts); the pause counts are the latest attempt's.
   *
   * Practice labs only, exactly as before v1.19.0, unless asked for the exam
   * labs too (`exams: true`, the page's Tests section): each of those carries
   * `exam` (its set, and the student's one start in it, on every form).
   */
  list: protectedProcedure
    .input(z.object({ exams: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }): Promise<LabListItem[]> => {
      const active = (await db.query.labs.findMany({ where: eq(schema.labs.active, true) }))
        .filter((lab) => input?.exams === true || lab.examSet === null);
      let visible = active;
      if (ctx.user.role !== 'admin') {
        const labGroups = await groupIdsByLab(active.map((l) => l.id));
        const mine = await userGroupIds(ctx.user.id);
        visible = active.filter((lab) => labIsForStudent(lab, labGroups.get(lab.id), mine));
      }
      if (visible.length === 0) return [];

      const submissions = db.select({
        id: S.id,
        labId: S.labId,
        submittedAt: S.submittedAt,
        credit: S.credit,
        creditOverride: S.creditOverride,
        mic: S.mic,
        checkRequestedAt: S.checkRequestedAt,
        pausesAnswered: S.pausesAnswered,
        pausesCounted: S.pausesCounted,
        minAnsweredPct: S.minAnsweredPct,
        flags: S.flags,
        heldFor: S.heldFor,
      }).from(S)
        .where(and(eq(S.userId, ctx.user.id), inArray(S.labId, visible.map((l) => l.id))))
        .all();

      // The teacher's previews are never limited, so the teacher has no start to show.
      const preview = ctx.user.role === 'admin';
      const starts = new Map(!preview && visible.some((lab) => lab.examSet !== null)
        ? exams.liveStartsForUser(ctx.user.id).map((row) => [row.examSet, row])
        : []);
      const finished = exams.finishedStarts([...starts.values()]);

      return visible.sort(byTitle).map((lab) => {
        const own = newestFirst(submissions.filter((s) => s.labId === lab.id));
        const latest = own[0];
        const credited = own.find((s) => effectiveCredit(s));
        const item: LabListItem = {
          id: lab.id,
          title: lab.title,
          description: lab.description,
          durationMs: lab.durationMs,
          requiredThroughMs: lab.requiredThroughMs,
          status: studentLabStatus(own).status,
          /** The latest attempt was sent back by the teacher ("Ask for a redo" or "Take credit away"). */
          redoByTeacher: latest?.creditOverride === false,
          submittedAt: credited?.submittedAt ?? null,
          attempts: own.length,
          pausesAnswered: latest?.pausesAnswered ?? null,
          pausesCounted: latest?.pausesCounted ?? null,
          needed: latest ? neededForRow(latest) : null,
        };
        if (lab.examSet === null) return item;
        const start = starts.get(lab.examSet);
        item.exam = {
          set: lab.examSet,
          preview,
          start: start ? {
            labId: start.labId,
            title: start.labTitle,
            startedAt: start.startedAt,
            finished: finished.has(exams.startKey(start)),
          } : null,
        };
        return item;
      });
    }),

  /**
   * Opens a session: the lab's details plus a signed start time, which the
   * listening log and the submission must carry back. The opening itself is
   * logged, with the rules the session will be judged by (the counted pauses
   * and the teacher's settings as they are now), so a new scan, an edit or a
   * new setting during class changes only sessions opened afterwards.
   */
  begin: protectedProcedure
    .input(z.object({
      labId: z.number().int(),
      /** The page's version (shared LAB_CLIENT); an older page is told to reload. */
      client: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if ((input.client ?? 0) < LAB_CLIENT) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: RELOAD_MESSAGE });
      }
      const lab = await assertLabVisible(ctx.user, input.labId);
      const examSet = lab.examSet;
      const asTeacher = ctx.user.role === 'admin';
      // A reload, a second tab, the same form again or another form of the set: the one start is used.
      if (examSet !== null && !asTeacher && exams.liveStart(ctx.user.id, examSet)) {
        logger.warn({ event: 'lab.exam_refused', labId: lab.id, userId: ctx.user.id, examSet, at: 'begin' }, 'Exam lab refused: the start in this set is used');
        throw examUsed();
      }
      const now = Date.now();
      const settings = getLabSettings();
      const list = parsePauseList(lab.pauses);
      // A test is unscored with the rule off: the listening check alone decides, and there is no microphone.
      const rules: LabRules = examSet !== null ? {
        v: LAB_RULES_VERSION,
        pauses: null,
        pct: 0,
        floor: settings.voicePerPauseMs,
        requiredThroughMs: lab.requiredThroughMs,
        gateMarginDb: settings.gateMarginDb,
        holdOutsideVoice: false,
        exam: examSet,
      } : {
        v: LAB_RULES_VERSION,
        pauses: list === null ? null : countedPauses(list, lab.pauseCountUntilMs, lab.requiredThroughMs),
        pct: settings.minAnsweredPct,
        floor: settings.voicePerPauseMs,
        requiredThroughMs: lab.requiredThroughMs,
        gateMarginDb: settings.gateMarginDb,
        holdOutsideVoice: settings.holdOutsideVoice,
      };

      // Count and write in one synchronous transaction: calls batched into one
      // request run concurrently, and a separate count would let them all through.
      type Opened = { kind: 'opened' } | { kind: 'capped'; n: number } | { kind: 'too-many-opens' };
      const opened = db.transaction((tx): Opened => {
        const turnedIn = tx.select({ n: sql<number>`count(*)` }).from(S)
          .where(and(eq(S.labId, lab.id), eq(S.userId, ctx.user.id))).get()!.n;
        if (turnedIn >= MAX_ATTEMPTS_PER_LAB) return { kind: 'capped', n: turnedIn };
        const { opens } = tx.select({ opens: sql<number>`count(*)` })
          .from(E)
          .where(and(
            eq(E.labId, lab.id),
            eq(E.userId, ctx.user.id),
            eq(E.kind, 'open'),
            gte(E.at, now - 24 * 60 * 60 * 1000),
          ))
          .get()!;
        if (opens >= MAX_OPENS_PER_DAY) return { kind: 'too-many-opens' };
        tx.insert(E).values({
          labId: lab.id, userId: ctx.user.id, sessionStartedAt: now, kind: 'open', positionMs: 0, clientMs: 0, at: now,
          rules: JSON.stringify(rules),
        }).run();
        return { kind: 'opened' };
      });
      if (opened.kind === 'capped') {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: attemptsMessage(opened.n) });
      }
      if (opened.kind === 'too-many-opens') {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'This lab has been opened too many times today. Try again tomorrow.' });
      }

      const scored = rules.pauses !== null && rules.pauses.length > 0;
      return {
        id: lab.id,
        title: lab.title,
        description: lab.description,
        /**
         * The audio. Null for an exam lab: only a confirmed start (startExam)
         * hands it out, so without one nothing plays.
         */
        audioUrl: examSet === null ? lab.audioUrl : null,
        durationMs: lab.durationMs,
        requiredThroughMs: lab.requiredThroughMs,
        minimumVoicedMs: minimumVoicedMs(lab.requiredThroughMs),
        startToken: signLabStart(lab.id, ctx.user.id, now),
        /** The counted pauses this session is scored on; null when the lab has no pause list. */
        pauses: rules.pauses,
        minAnsweredPct: rules.pct,
        voicePerPauseMs: rules.floor,
        /** How far over the room level (dB) the page's voice meter needs a sound to be, from the mic check on. */
        gateMarginDb: settings.gateMarginDb,
        /** Pauses to answer for the lab to count: null when not scored, 0 when the rule is off. */
        needed: scored ? neededPauses(rules.pauses!.length, rules.pct) : null,
        /** The exam set this session plays as a test (v1.19.0); null: practice. */
        exam: examSet,
        /** The teacher trying an exam lab: their starts are never limited or recorded. */
        examPreview: examSet !== null && asTeacher,
      };
    }),

  /**
   * "Start the test" (v1.19.0): claims the student's one start in the exam set
   * for the session `begin` opened, and only then hands out the audio. One
   * transaction and a unique index: of two tabs racing, one gets it. The same
   * session asking again (a lost response) gets the same start. The teacher's
   * preview is never limited and writes nothing.
   */
  startExam: protectedProcedure
    .input(z.object({ labId: z.number().int(), startToken: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const sessionStartedAt = verifyLabStart(input.startToken, input.labId, ctx.user.id, now);
      if (sessionStartedAt === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: SESSION_EXPIRED_MESSAGE });
      }
      const lab = await assertLabVisible(ctx.user, input.labId);
      // The session must have been opened as a form of the set the lab is in now.
      const opened = parseLabRules(sessionRulesText(lab.id, ctx.user.id, sessionStartedAt))?.exam;
      const examSet = lab.examSet;
      if (opened === undefined || examSet === null || opened !== examSet) {
        logger.warn({ event: 'lab.exam_refused', labId: lab.id, userId: ctx.user.id, examSet, opened: opened ?? null, at: 'start' }, 'Exam start refused: the test was changed');
        throw new TRPCError({ code: 'BAD_REQUEST', message: EXAM_CHANGED_MESSAGE, cause: { appCode: EXAM_APP_CODES.changed } });
      }
      if (ctx.user.role === 'admin') {
        return { audioUrl: lab.audioUrl, examSet, startId: null, startedAt: now, preview: true };
      }

      const outcome = exams.claimExamStart({ examSet, userId: ctx.user.id, lab, sessionStartedAt, nowMs: now });
      if (outcome.kind === 'used') {
        logger.warn({ event: 'lab.exam_refused', labId: lab.id, userId: ctx.user.id, examSet, at: 'start' }, 'Exam start refused: the start in this set is used');
        throw examUsed();
      }
      if (outcome.kind === 'claimed') {
        logger.info({ event: 'lab.exam_started', labId: lab.id, userId: ctx.user.id, examSet, startId: outcome.row.id }, 'Exam started');
      }
      return { audioUrl: lab.audioUrl, examSet, startId: outcome.row.id, startedAt: outcome.row.startedAt, preview: false };
    }),

  /**
   * The listening log. The page reports where the audio is every few seconds
   * while it plays and at each pause, jump back and end, and once where it
   * went on without a microphone (`nomic`); the server stamps each report with
   * its own clock. See summarizeListening for what is made of it. A report may
   * carry the pause results finished since the last one.
   *
   * On a lab in an exam set (v1.19.0), a student's playback is checked first
   * (services/examLabs.ts examPlay): a test session without a start is
   * refused, and a session opened as anything else (a practice page left open
   * when the lab became a test) counts as the student's start in the set.
   */
  heartbeat: protectedProcedure
    .input(z.object({
      labId: z.number().int(),
      startToken: z.string().max(200),
      kind: z.enum(LISTEN_EVENT_KINDS),
      positionMs,
      clientMs,
      answers: z.array(answer).max(MAX_ANSWERS_PER_REPORT).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const sessionStartedAt = verifyLabStart(input.startToken, input.labId, ctx.user.id, now);
      if (sessionStartedAt === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: SESSION_EXPIRED_MESSAGE });
      }
      const lab = await assertLabVisible(ctx.user, input.labId);

      const kind = input.kind;
      const positionMs = Math.round(input.positionMs);
      const clientMs = Math.round(input.clientMs);
      const examSet = lab.examSet;
      const examPlayback = ctx.user.role !== 'admin' && (exams.PLAYBACK_KINDS as readonly string[]).includes(kind);
      // Count and write together, for the same reason as in begin.
      type Heard = { kind: 'heard'; recorded: boolean; counted: exams.ExamStartRow | null; opened: string | null }
        | { kind: 'not-started'; opened: string };
      const heard = db.transaction((tx): Heard => {
        let counted: exams.ExamStartRow | null = null;
        let opened: string | null = null;
        if (examSet !== null && examPlayback) {
          opened = parseLabRules(sessionRulesText(lab.id, ctx.user.id, sessionStartedAt))?.exam ?? null;
          const play = exams.examPlay(tx, { examSet, opened, userId: ctx.user.id, lab, sessionStartedAt });
          if (play.kind === 'not-started') return { kind: 'not-started', opened: opened! };
          counted = play.counted;
        }
        const session = thisSessionEvents(input.labId, ctx.user.id, sessionStartedAt);
        // The page resends a report whose answer came late: stored once, as submit's carried reports are,
        // so its pause results are examined once. Only the same report, results and all (reportKey):
        // one with other results is not dropped for arriving second.
        const answers = answersText(input.answers);
        const already = tx.select({ id: E.id }).from(E)
          .where(and(
            session, eq(E.kind, kind), eq(E.clientMs, clientMs), eq(E.positionMs, positionMs),
            answers === null ? isNull(E.answers) : eq(E.answers, answers),
          ))
          .limit(1)
          .get();
        if (already) return { kind: 'heard', recorded: true, counted, opened };
        const { count } = tx.select({ count: sql<number>`count(*)` })
          .from(E)
          .where(session)
          .get()!;
        if (count >= MAX_LISTEN_EVENTS) return { kind: 'heard', recorded: false, counted, opened };
        tx.insert(E).values({
          labId: input.labId,
          userId: ctx.user.id,
          sessionStartedAt,
          kind,
          positionMs,
          clientMs,
          at: now,
          answers,
        }).run();
        return { kind: 'heard', recorded: true, counted, opened };
      });
      if (heard.kind === 'not-started') {
        logger.warn({ event: 'lab.exam_not_started', labId: lab.id, userId: ctx.user.id, examSet: heard.opened, kind, at: 'heartbeat' }, 'Exam session played without a start');
        throw new TRPCError({ code: 'BAD_REQUEST', message: EXAM_NOT_STARTED_MESSAGE, cause: { appCode: EXAM_APP_CODES.notStarted } });
      }
      if (heard.counted) logPlayCounted(heard.counted, heard.opened, 'heartbeat');
      return heard.recorded ? { recorded: true, nextInMs: LISTEN_TICK_MS } : { recorded: false };
    }),

  /**
   * Turns a lab in. Nothing is uploaded: the evidence is the server's own
   * listening log for the session (plus the page's reports still queued, and
   * its final position as one last entry, so a report lost on a bad
   * connection does not cost the student), the pause results riding on it,
   * and the rules the session began with.
   *
   * The session must pass the listening check; then it is judged by its rule:
   * legacy (opened before the pause rule: counts, for 6 hours), unscored (no
   * pause list: counts with a microphone) or scored (enough pauses answered).
   * With the teacher's share at 0% every lab counts. The result is stored,
   * with the snapshot it was judged by, and returned; a copy of the same
   * submit gets the stored result.
   */
  submit: protectedProcedure
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const lab = await assertLabVisible(ctx.user, input.labId);
      const nowMs = Date.now();
      const startedAtMs = verifyLabStart(input.startToken, lab.id, ctx.user.id, nowMs);
      if (startedAtMs === null) {
        logger.warn({ event: 'lab.submission_bad_token', labId: lab.id, userId: ctx.user.id }, 'Lab submission without a valid start token');
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This lab session has expired. Open the lab again to start over.' });
      }

      const key = `${lab.id}:${ctx.user.id}:${startedAtMs}`;
      const running = submitsInFlight.get(key);
      if (running) return { success: true as const, duplicate: true as const, result: (await running).result };

      // Registered before the work starts, so every copy that arrives meanwhile finds it.
      const job = Promise.resolve().then(() => turnIn(lab, ctx.user.id, startedAtMs, nowMs, input, ctx.user.role === 'admin'));
      submitsInFlight.set(key, job);
      try {
        const { duplicate, result } = await job;
        return duplicate
          ? { success: true as const, duplicate: true as const, result }
          : { success: true as const, result };
      } finally {
        if (submitsInFlight.get(key) === job) submitsInFlight.delete(key);
      }
    }),

  /**
   * "The mic didn't hear me": a turned-in lab that did not count waits for the
   * teacher to check it instead of needing a redo. Only the student's own row,
   * with no credit, no teacher decision, a microphone, not held (it already
   * waits) and not asked before.
   */
  askTeacher: protectedProcedure
    .input(z.object({ submissionId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const updated = db.update(S)
        .set({ checkRequestedAt: new Date() })
        .where(and(
          eq(S.id, input.submissionId),
          eq(S.userId, ctx.user.id),
          // No automatic credit (a row from before v1.15, with no flags, counts: labCredit.automaticCredit).
          eq(S.credit, false),
          isNotNull(S.flags),
          isNull(S.creditOverride),
          eq(S.mic, 'on'),
          isNull(S.heldFor),
          isNull(S.checkRequestedAt),
        ))
        .returning({ id: S.id, labId: S.labId })
        .all();
      if (updated.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: ASK_TEACHER_MESSAGE });
      logger.info({ event: 'lab.check_requested', submissionId: input.submissionId, labId: updated[0].labId, userId: ctx.user.id }, 'Student asked the teacher to check a lab');
      return { status: 'check' as const };
    }),

  /**
   * Creates a lab from audio already uploaded to POST /api/media. No group means
   * every student. `pauses` and `scan` come from the teacher's browser, which
   * found the answer pauses when it scanned the file.
   */
  create: adminProcedure
    .input(z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(2000).nullish(),
      audioUrl: z.string().regex(ASSET_AUDIO_URL_RE, 'Not an uploaded lab file'),
      mimeType: z.string().min(1).max(100),
      durationMs: z.number().int().positive(),
      requiredThroughMs: z.number().int().min(0),
      groupIds: z.array(z.number().int()).default([]),
      active: z.boolean().default(false),
      pauses: pauseList.nullish(),
      scan: pauseScan.nullish(),
      /** v1.19.0: a name ("U3") makes the lab a form of that exam set; missing or null: a practice lab. */
      examSet: z.string().max(200).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const pauses = input.pauses == null ? null : checkedPauseList(input.pauses, input.durationMs);
      if (input.examSet != null && canonicalExamSet(input.examSet) === null) throw examSetInvalid();
      const filename = input.audioUrl.slice('/api/assets/'.length);
      try {
        await access(resolve(getAssetsDir(), filename));
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The uploaded audio file was not found' });
      }
      const groupIds = await assertGroupsExist(input.groupIds);

      // One transaction: a lab never exists without the groups it was meant to have.
      const lab = db.transaction((tx) => {
        const [row] = tx.insert(schema.labs).values({
          title: input.title,
          description: input.description ?? null,
          audioUrl: input.audioUrl,
          mimeType: input.mimeType,
          durationMs: input.durationMs,
          requiredThroughMs: clampRequired(input.requiredThroughMs, input.durationMs),
          forEveryone: groupIds.length === 0,
          active: input.active,
          createdBy: ctx.user.id,
          pauses,
          pauseScan: pauses === null ? null : storedScan(input.scan, Date.now()),
          // A new lab has no plays: no past starts to count.
          examSet: input.examSet == null ? null : exams.resolveExamSet(tx, input.examSet),
        }).returning().all();
        if (groupIds.length > 0) {
          tx.insert(schema.labGroups).values(groupIds.map((groupId) => ({ labId: row.id, groupId }))).run();
        }
        return row;
      });

      logger.info({
        event: 'lab.created', labId: lab.id, durationMs: lab.durationMs,
        pauses: pauses === null ? null : (input.pauses?.length ?? 0), examSet: lab.examSet,
      }, 'Lab created');
      return lab;
    }),

  /**
   * Every lab, with its pause list summarized (never the list itself) and how
   * its students stand: turned in (any attempt), done, need a redo, waiting
   * for the teacher (held labs included), flagged (a red flag on any attempt:
   * skipped ahead, odd results or sent late, so a failed trick followed by a
   * clean attempt stays in sight) and to look at (not flagged and not
   * waiting, with an amber flag on the counting attempt, No microphone
   * included, or an amber flag other than No microphone on another attempt:
   * the Review page's marks). Students only.
   */
  adminList: adminProcedure.query(async () => {
    const rows = db.select({ ...labColumns, pauses: schema.labs.pauses, pauseScan: schema.labs.pauseScan })
      .from(schema.labs).all();
    const labGroups = await groupIdsByLab(rows.map((l) => l.id));
    // Students only: a teacher's own test run is not a class submission.
    const submissions = db
      .select({
        id: S.id,
        labId: S.labId,
        userId: S.userId,
        submittedAt: S.submittedAt,
        credit: S.credit,
        creditOverride: S.creditOverride,
        mic: S.mic,
        checkRequestedAt: S.checkRequestedAt,
        voicedMs: S.voicedMs,
        skipCount: S.skipCount,
        requiredThroughMs: S.requiredThroughMs,
        pausesCounted: S.pausesCounted,
        rejectedAnswers: S.rejectedAnswers,
        lateAnswers: S.lateAnswers,
        flags: S.flags,
        heldFor: S.heldFor,
        examSet: S.examSet,
      })
      .from(S)
      .innerJoin(schema.users, eq(S.userId, schema.users.id))
      .where(ne(schema.users.role, 'admin'))
      .all();

    return rows.sort(byTitle).map(({ pauses, pauseScan: scanText, ...lab }) => {
      const forLab = submissions.filter((s) => s.labId === lab.id);
      const byStudent = new Map<number, typeof forLab>();
      for (const s of forLab) byStudent.set(s.userId, [...(byStudent.get(s.userId) ?? []), s]);
      const counts = { done: 0, redo: 0, check: 0, flagged: 0, look: 0 };
      for (const own of byStudent.values()) {
        const row = countingRow(own)!;
        const status = rowStatus(row).status;
        counts[status] += 1;
        const attempts = own.map((attempt) => ({ counting: attempt === row, flags: flagsOf(attempt) }));
        if (attempts.some((a) => a.flags.some(isRed))) {
          counts.flagged += 1;
          continue;
        }
        // No red flag anywhere, so every flag left is amber. No microphone on an
        // earlier attempt is not worth a look; on the counting one it is.
        const amber = attempts.some((a) => a.flags.some((flag) => a.counting || flag !== 'no-mic'));
        if (status !== 'check' && amber) counts.look += 1;
      }
      return {
        ...lab,
        ...pauseSummary({ ...lab, pauses, pauseScan: scanText }),
        groupIds: labGroups.get(lab.id) ?? [],
        turnedInCount: byStudent.size,
        /** The same as turnedInCount: students with any attempt. */
        studentCount: byStudent.size,
        doneCount: counts.done,
        redoCount: counts.redo,
        checkCount: counts.check,
        flaggedCount: counts.flagged,
        /** Students not flagged and not waiting, with an amber flag to look at. */
        lookCount: counts.look,
        lastSubmittedAt: forLab.reduce<Date | null>(
          (latest, s) => (!latest || s.submittedAt > latest ? s.submittedAt : latest), null),
      };
    });
  }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).nullish(),
      requiredThroughMs: z.number().int().min(0).optional(),
      /** Replaces the lab's groups; an empty list means every student. */
      groupIds: z.array(z.number().int()).optional(),
      active: z.boolean().optional(),
      /** "Don't count pauses after": pauses starting at or after it don't count (dictation). null: they all count. */
      pauseCountUntilMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
      /**
       * v1.19.0: the exam set ("U3", trimmed, in the spelling the set already has); null switches exam off
       * (the starts stay). Missing: unchanged. Moving the lab into a set counts its past plays as starts.
       */
      examSet: z.string().max(200).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const lab = await db.query.labs.findFirst({ where: eq(schema.labs.id, input.id) });
      if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });

      const { id, groupIds, requiredThroughMs, examSet: examInput, ...rest } = input;
      if (typeof examInput === 'string' && canonicalExamSet(examInput) === null) throw examSetInvalid();
      const groups = groupIds === undefined ? undefined : await assertGroupsExist(groupIds);
      const data: Partial<typeof schema.labs.$inferInsert> = { ...rest };
      if (requiredThroughMs !== undefined) data.requiredThroughMs = clampRequired(requiredThroughMs, lab.durationMs);
      if (groups !== undefined) data.forEveryone = groups.length === 0;

      const exam = db.transaction((tx) => {
        if (Object.keys(data).length > 0) tx.update(schema.labs).set(data).where(eq(schema.labs.id, id)).run();
        if (groups !== undefined) {
          tx.delete(schema.labGroups).where(eq(schema.labGroups.labId, id)).run();
          if (groups.length > 0) tx.insert(schema.labGroups).values(groups.map((groupId) => ({ labId: id, groupId }))).run();
        }
        const now = tx.select({ title: schema.labs.title, examSet: schema.labs.examSet }).from(schema.labs)
          .where(eq(schema.labs.id, id)).get()!;
        const next = examInput === undefined ? now.examSet : examInput === null ? null : exams.resolveExamSet(tx, examInput);
        if (next === now.examSet) return { examSet: next, pastStarts: 0, from: null as string | null, changed: false };
        tx.update(schema.labs).set({ examSet: next }).where(eq(schema.labs.id, id)).run();
        // Students who already played it count as started in the set: they cannot start it, or another form, again.
        const pastStarts = next === null ? 0 : exams.countPastStarts(tx, { id, title: now.title }, next);
        return { examSet: next, pastStarts, from: now.examSet, changed: true };
      });
      if (exam.changed) {
        logger.info({ event: 'lab.exam_set_changed', labId: id, from: exam.from, to: exam.examSet, pastStarts: exam.pastStarts }, 'Lab exam set changed');
        if (exam.examSet !== null) {
          logger.info({ event: 'lab.exam_past_starts', labId: id, examSet: exam.examSet, counted: exam.pastStarts }, 'Past plays counted as exam starts');
        }
      }
      return { success: true, examSet: exam.examSet, pastStarts: exam.pastStarts };
    }),

  /** A lab's whole pause list, what counts of it now, and the scan behind it. */
  pauses: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => {
      const lab = db.select({
        id: schema.labs.id,
        durationMs: schema.labs.durationMs,
        requiredThroughMs: schema.labs.requiredThroughMs,
        pauses: schema.labs.pauses,
        pauseScan: schema.labs.pauseScan,
        pauseCountUntilMs: schema.labs.pauseCountUntilMs,
      }).from(schema.labs).where(eq(schema.labs.id, input.id)).get();
      if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      const list = parsePauseList(lab.pauses);
      return {
        id: lab.id,
        durationMs: lab.durationMs,
        requiredThroughMs: lab.requiredThroughMs,
        /** Every pause the scan found; null when the lab has not been scanned. */
        pauses: list,
        /** The pauses that count now. */
        counted: list === null ? null : countedPauses(list, lab.pauseCountUntilMs, lab.requiredThroughMs),
        ...pauseSummary(lab),
      };
    }),

  /**
   * Saves a lab's pause list ("Find pauses", or "Find pauses again"), keeping
   * its "don't count pauses after" point. Safe during class: sessions keep the
   * rules they began with.
   */
  setPauses: adminProcedure
    .input(z.object({ id: z.number().int(), pauses: pauseList, scan: pauseScan.nullish() }))
    .mutation(({ input }) => {
      const lab = db.select({
        id: schema.labs.id,
        durationMs: schema.labs.durationMs,
        requiredThroughMs: schema.labs.requiredThroughMs,
        pauseCountUntilMs: schema.labs.pauseCountUntilMs,
      }).from(schema.labs).where(eq(schema.labs.id, input.id)).get();
      if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      const pauses = checkedPauseList(input.pauses, lab.durationMs);
      const scanText = storedScan(input.scan, Date.now());
      db.update(schema.labs).set({ pauses, pauseScan: scanText }).where(eq(schema.labs.id, lab.id)).run();
      const summary = pauseSummary({ ...lab, pauses, pauseScan: scanText });
      logger.info({ event: 'lab.pauses_saved', labId: lab.id, pauses: summary.pauseTotal, counted: summary.pauseCount }, 'Lab pause list saved');
      return { success: true, ...summary };
    }),

  /**
   * The pause rule: the share of pauses a student must answer (0 = off), the
   * voice that answers one, the voice meter's room margin, and whether voice
   * outside the pauses also holds a lab.
   */
  settings: adminProcedure.query(() => getLabSettings()),

  saveSettings: adminProcedure
    .input(z.object({
      minAnsweredPct: z.number().int().min(MIN_ANSWERED_PCT_RANGE[0]).max(MIN_ANSWERED_PCT_RANGE[1]).optional(),
      voicePerPauseMs: z.number().int().min(VOICE_PER_PAUSE_RANGE_MS[0]).max(VOICE_PER_PAUSE_RANGE_MS[1]).optional(),
      /** The voice meter's room margin (dB), Advanced. */
      gateMarginDb: z.number().int().min(GATE_MARGIN_RANGE_DB[0]).max(GATE_MARGIN_RANGE_DB[1]).optional(),
      /** "Also hold labs with voice outside the pauses". */
      holdOutsideVoice: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const saved = saveLabSettings(input);
      logger.info({ event: 'lab.settings_saved', userId: ctx.user.id, ...saved }, 'Lab pause rule saved');
      return saved;
    }),

  /**
   * The teacher's decision on turned-in labs: true gives credit, false takes
   * it away (or asks for a redo), null goes back to the automatic result.
   */
  setCredit: adminProcedure
    .input(z.object({
      submissionIds: z.array(z.number().int()).min(1).max(200),
      credit: z.boolean().nullable(),
    }))
    .mutation(({ ctx, input }) => {
      const ids = [...new Set(input.submissionIds)];
      const values = input.credit === null
        ? { creditOverride: null, creditOverrideAt: null, creditOverrideBy: null }
        : { creditOverride: input.credit, creditOverrideAt: new Date(), creditOverrideBy: ctx.user.id };
      const rows = db.update(S).set(values).where(inArray(S.id, ids)).returning().all();
      logger.info({ event: 'lab.credit_set', userId: ctx.user.id, credit: input.credit, requested: ids.length, updated: rows.length }, 'Lab credit set by the teacher');
      return {
        updated: rows.length,
        rows: rows.map((r) => ({ id: r.id, effectiveCredit: effectiveCredit(r), status: rowStatus(r).status })),
      };
    }),

  /** Deletes the lab with its submissions and listening log. */
  remove: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.labs).where(eq(schema.labs.id, input.id));
      logger.info({ event: 'lab.removed', labId: input.id }, 'Lab removed');
      return { success: true };
    }),

  /**
   * Every submission for a lab, newest first per student, each with its
   * result, the snapshot it was judged by and the teacher's flags; plus where
   * each student stands (`summary.byStudent`, students only).
   */
  submissions: adminProcedure
    .input(z.object({ labId: z.number().int() }))
    .query(async ({ input }) => {
      const lab = await db.query.labs.findFirst({ where: eq(schema.labs.id, input.labId) });
      if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });

      const rows = db
        .select({
          id: S.id,
          userId: schema.users.id,
          studentName: schema.users.name,
          studentEmail: schema.users.email,
          role: schema.users.role,
          requiredThroughMs: S.requiredThroughMs,
          voicedMs: S.voicedMs,
          listenedCoveredMs: S.listenedCoveredMs,
          listenWallMs: S.listenWallMs,
          skipCount: S.skipCount,
          startedAt: S.startedAt,
          submittedAt: S.submittedAt,
          mic: S.mic,
          pausesCounted: S.pausesCounted,
          pausesAnswered: S.pausesAnswered,
          pauseResults: S.pauseResults,
          rejectedAnswers: S.rejectedAnswers,
          lateAnswers: S.lateAnswers,
          minAnsweredPct: S.minAnsweredPct,
          voicePerPauseMs: S.voicePerPauseMs,
          outsideVoicedMs: S.outsideVoicedMs,
          outsidePlayedMs: S.outsidePlayedMs,
          storedFlags: S.flags,
          credit: S.credit,
          creditOverride: S.creditOverride,
          creditOverrideAt: S.creditOverrideAt,
          checkRequestedAt: S.checkRequestedAt,
          storedHeldFor: S.heldFor,
          storedMicStats: S.micStats,
          /** v1.19.0: the exam set a test was turned in under; null: practice. */
          examSet: S.examSet,
        })
        .from(S)
        .innerJoin(schema.users, eq(S.userId, schema.users.id))
        .where(eq(S.labId, input.labId))
        .orderBy(schema.users.name, desc(S.submittedAt), desc(S.id))
        .all();

      const attempts = new Map<number, number>();
      for (const r of rows) attempts.set(r.userId, (attempts.get(r.userId) ?? 0) + 1);

      const settings = getLabSettings();
      const pauses = pauseSummary(lab);
      const parsed = rows.map(({ pauseResults, ...r }) => ({ ...r, pauseResults: pauseResults === null ? null : parseAnswers(pauseResults) }));
      // "Short answers" is judged against the class on this lab, so only here.
      const short = shortAnswerRows(parsed.map((r) => ({
        id: r.id, userId: r.userId, student: r.role !== 'admin', submittedAt: r.submittedAt,
        results: r.pauseResults, floorMs: r.voicePerPauseMs,
      })));
      const submissions = parsed.map(({ role, storedFlags, storedHeldFor, storedMicStats, ...r }) => {
        const stored = { ...r, flags: storedFlags, heldFor: storedHeldFor };
        const { status, reason } = rowStatus(stored);
        return {
          ...r,
          /** The automatic result (a row from before v1.15 counts: labCredit.automaticCredit). */
          credit: automaticCredit(stored),
          /** The teacher's own test run: shown, but never counted as a student. */
          isTeacher: role === 'admin',
          elapsedMs: r.submittedAt.getTime() - r.startedAt.getTime(),
          attempts: attempts.get(r.userId) ?? 1,
          /** `[startMs, bestVoicedMs]` per counted pause (-1: none accepted; -2: two or more in one playback); null when not scored. */
          pauseResults: r.pauseResults,
          needed: neededForRow(r),
          effectiveCredit: effectiveCredit(stored),
          status,
          statusReason: reason,
          /** Why the row waits for the teacher although it met the rule ('odd-answers', 'overlap', 'noisy'); null when not held. */
          heldFor: parseHeldFor(storedHeldFor),
          /** What the page's voice meter measured (information, never evidence); null before v1.16.0. */
          micStats: parseLabMicStats(storedMicStats),
          // Judged against what the submission was accepted under.
          flags: flagsOf(stored, short.has(r.id)),
        };
      });

      const byStudent: {
        userId: number;
        name: string;
        status: ReturnType<typeof rowStatus>['status'];
        reason: ReturnType<typeof rowStatus>['reason'];
        countingRowId: number;
        answered: number | null;
        counted: number | null;
      }[] = [];
      const students = new Map<number, typeof submissions>();
      for (const s of submissions) {
        if (!s.isTeacher) students.set(s.userId, [...(students.get(s.userId) ?? []), s]);
      }
      for (const [userId, own] of students) {
        // The counting row: the newest that counts (with a teacher's decision, or from before v1.15), else the newest.
        const ordered = newestFirst(own);
        const row = ordered.find((s) => s.effectiveCredit) ?? ordered[0];
        byStudent.push({
          userId, name: row.studentName, status: row.status, reason: row.statusReason, countingRowId: row.id,
          answered: row.pausesAnswered, counted: row.pausesCounted,
        });
      }

      return {
        lab: {
          id: lab.id,
          title: lab.title,
          durationMs: lab.durationMs,
          requiredThroughMs: lab.requiredThroughMs,
          minimumVoicedMs: minimumVoicedMs(lab.requiredThroughMs),
          /** v1.19.0: the exam set this lab is a form of; null: a practice lab. */
          examSet: lab.examSet,
          ...pauses,
          /** The teacher's settings now (sessions opened from now on use them). */
          settings,
          /** Pauses to answer at the current settings: null when not scanned. */
          needed: pauses.pauseCount === null ? null : neededPauses(pauses.pauseCount, settings.minAnsweredPct),
        },
        submissions,
        summary: {
          byStudent,
          done: byStudent.filter((s) => s.status === 'done').length,
          redo: byStudent.filter((s) => s.status === 'redo').length,
          check: byStudent.filter((s) => s.status === 'check').length,
        },
      };
    }),

  /** Students this lab is for who have not turned it in, with how far each got. */
  missing: adminProcedure
    .input(z.object({ labId: z.number().int() }))
    .query(async ({ input }) => {
      const lab = await db.query.labs.findFirst({ where: eq(schema.labs.id, input.labId) });
      if (!lab) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });

      const expected = await expectedStudents(lab, (await groupIdsByLab([lab.id])).get(lab.id) ?? []);
      const submitted = new Set(
        (await db.query.labSubmissions.findMany({
          where: eq(S.labId, input.labId),
          columns: { userId: true },
        })).map((s) => s.userId),
      );
      const missing = expected.filter((u) => !submitted.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));

      // "Never opened it", "opened it but never started" and "got to 6:40" are different conversations.
      const logs = await loadRecentSessions(lab.id, missing.map((u) => u.id), 10);
      return missing.map((u) => {
        const log = logs.get(u.id);
        const played = sessionsFrom(log?.rows ?? []).filter((s) => s.started);
        return {
          ...u,
          opened: (log?.sessionCount ?? 0) > 0,
          started: played.length > 0,
          /** The furthest any recent attempt got, not only the latest. */
          heardThroughMs: played.length > 0 ? Math.max(...played.map((s) => s.summary.heardThroughMs)) : null,
          skips: played.reduce((n, s) => n + s.summary.skips, 0),
          lastSeenAt: log?.lastSeenAt ?? null,
        };
      });
    }),

  /**
   * One student's full listening log for a lab, newest session first — the
   * evidence behind the numbers — with the pause results each report carried.
   * Never the session's rules.
   */
  listenLog: adminProcedure
    .input(z.object({ labId: z.number().int(), userId: z.number().int() }))
    .query(async ({ input }) => {
      const submissions = await db.query.labSubmissions.findMany({
        where: and(eq(S.labId, input.labId), eq(S.userId, input.userId)),
        columns: { startedAt: true },
      });
      const submittedSessions = new Set(submissions.map((s) => s.startedAt.getTime()));
      const log = (await loadRecentSessions(input.labId, [input.userId], 20)).get(input.userId);
      return sessionsFrom(log?.rows ?? []).map((session) => ({
        startedAt: session.startedAt,
        started: session.started,
        summary: session.summary,
        submitted: submittedSessions.has(session.startedAt),
        events: [...session.events]
          .sort((a, b) => a.clientMs - b.clientMs || a.at - b.at)
          .map(({ kind, positionMs, clientMs, at, answers }) => {
            const parsed = parseAnswers(answers);
            return { kind, positionMs, clientMs, at, answers: parsed.length > 0 ? parsed : null };
          }),
      }));
    }),

  /**
   * The Tests list (Admin › Labs, v1.19.0): each exam set with its forms and
   * how its students stand, in natural order of the set's name.
   */
  examSets: adminProcedure.query(async () => {
    const rows = db.select({
      id: schema.labs.id, title: schema.labs.title, active: schema.labs.active, forEveryone: schema.labs.forEveryone,
      examSet: schema.labs.examSet,
    }).from(schema.labs).where(isNotNull(schema.labs.examSet)).all();
    const bySet = new Map<string, typeof rows>();
    for (const lab of rows) bySet.set(lab.examSet!, [...(bySet.get(lab.examSet!) ?? []), lab]);

    const sets = [];
    for (const [examSet, labs] of bySet) {
      const assigned = await setAudience(labs);
      sets.push({
        examSet,
        labs: [...labs].sort(byTitle).map(({ id, title, active }) => ({ id, title, active })),
        ...exams.examSetCounts(examSet, new Set(assigned.keys())),
      });
    }
    return sets.sort((a, b) => a.examSet.localeCompare(b.examSet, undefined, { numeric: true, sensitivity: 'base' }));
  }),

  /**
   * A set's students and their starts (v1.19.0): every student its forms are
   * for, plus anyone with a start in it; with `labId`, only those who started
   * that form. Where the teacher's Reset lives.
   */
  examRoster: adminProcedure
    .input(z.object({ examSet: z.string().min(1).max(200), labId: z.number().int().optional() }))
    .query(async ({ input }) => {
      if (canonicalExamSet(input.examSet) === null) throw examSetInvalid();
      const examSet = db.transaction((tx) => exams.resolveExamSet(tx, input.examSet))!;
      const labs = db.select({
        id: schema.labs.id, title: schema.labs.title, active: schema.labs.active, forEveryone: schema.labs.forEveryone,
        durationMs: schema.labs.durationMs, requiredThroughMs: schema.labs.requiredThroughMs,
      }).from(schema.labs).where(eq(schema.labs.examSet, examSet)).all().sort(byTitle);
      const assigned = await setAudience(labs);
      return {
        examSet,
        labs: labs.map(({ id, title, active, durationMs, requiredThroughMs }) => ({ id, title, active, durationMs, requiredThroughMs })),
        students: exams.examRoster(examSet, assigned, input.labId),
      };
    }),

  /**
   * The teacher's Reset (v1.19.0): gives the student exactly one more start in
   * the set. The earlier start stays as history, and nothing of the student's
   * listening log or submissions is touched.
   */
  resetExamStart: adminProcedure
    .input(z.object({ startId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const outcome = exams.resetExamStart(input.startId, ctx.user.id, Date.now());
      if (outcome.kind === 'missing') throw new TRPCError({ code: 'NOT_FOUND', message: 'Start not found' });
      if (outcome.kind === 'already') {
        throw new TRPCError({ code: 'CONFLICT', message: EXAM_ALREADY_RESET_MESSAGE, cause: { appCode: EXAM_APP_CODES.alreadyReset } });
      }
      const { row } = outcome;
      logger.info({
        event: 'lab.exam_start_reset', startId: row.id, userId: row.userId, examSet: row.examSet, labId: row.labId, by: ctx.user.id,
      }, 'Exam start reset by the teacher');
      return { startId: row.id, userId: row.userId, examSet: row.examSet, resetAt: row.resetAt! };
    }),
});
