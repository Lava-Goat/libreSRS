// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0): the one start per student per exam set, and the
 * teacher's Reset in the admin page.
 *
 * A lab with an exam set ("U3") is one form of that test. A student's start
 * is a row in `lab_exam_starts`; the live one (`reset_at` NULL) is unique per
 * set and student (a partial unique index), so two tabs racing cannot both
 * claim it, and every refusal ("Ask your teacher") reads that one row. Reset
 * stamps the live row, which gives exactly one more start; nothing is ever
 * deleted, and the listening log and the submissions are never touched.
 *
 * Plays made before a lab joined a set count too ("past" starts), so a
 * student who already heard the test cannot start it again; a make-up
 * student, who only ever opened it, can. So do plays reported afterwards by a
 * session opened before (a practice page left open when the lab became a
 * test), as they arrive (examPlay).
 *
 * Synchronous throughout (better-sqlite3): each write runs in one
 * transaction, from its first read to its last write. routers/labs.ts wires
 * the procedures and owns who a lab is for (this module must not import it).
 */
import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { canonicalExamSet } from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { summarizeListening, type ListenEvent } from './labMedia.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const X = schema.labExamStarts;
const E = schema.labListenEvents;
const S = schema.labSubmissions;

export type ExamStartRow = typeof X.$inferSelect;

/**
 * Listening entries that mean playback began, as opposed to the lab only being
 * opened (`open`) or the page going on without a microphone (`nomic`): the
 * same test as the teacher's "started" (routers/labs.ts `sessionsFrom`).
 */
export const PLAYBACK_KINDS = ['play', 'tick', 'pause', 'seek', 'end'] as const;

/** Two set names are the same set whatever the case. */
export const examSetKey = (name: string) => name.toLowerCase();

/**
 * The set name to store for what the teacher typed: canonical (shared
 * `canonicalExamSet`), in the spelling the set already has on a lab, a start
 * or a speaking test (v1.21.0), so "u3 " joins "U3" (and a set whose labs were
 * all deleted keeps its starts). Labs and starts are read first, so a lab's
 * spelling wins over a task's. Null when the name is empty or too long. Shared
 * by routers/labs.ts and routers/speaking.ts: one name space for both kinds of
 * test.
 */
export function resolveExamSet(tx: Tx, raw: string): string | null {
  const name = canonicalExamSet(raw);
  if (name === null) return null;
  const used = [
    ...tx.selectDistinct({ name: schema.labs.examSet }).from(schema.labs).where(isNotNull(schema.labs.examSet)).all(),
    ...tx.selectDistinct({ name: X.examSet }).from(X).all(),
    ...tx.selectDistinct({ name: schema.speakingTasks.examSet }).from(schema.speakingTasks)
      .where(isNotNull(schema.speakingTasks.examSet)).all(),
  ].map((r) => r.name).filter((n): n is string => n !== null);
  if (used.includes(name)) return name;
  return used.find((n) => examSetKey(n) === examSetKey(name)) ?? name;
}

/**
 * Counts past starts ("materialize"), in the transaction that moves a lab
 * into set `examSet`: every student (never a teacher) with a started session
 * on this lab — playback logged, or turned in — and no row at all in the set
 * gets a live start (`source` 'past'). The counted session is their newest
 * turned-in one, else their newest started one. A student the teacher already
 * reset in the set is not charged again. Returns how many were counted.
 */
export function countPastStarts(tx: Tx, lab: { id: number; title: string }, examSet: string): number {
  const admins = new Set(tx.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.role, 'admin')).all().map((u) => u.id));
  const inSet = new Set(tx.selectDistinct({ userId: X.userId }).from(X)
    .where(eq(X.examSet, examSet)).all().map((r) => r.userId));

  const counted = new Map<number, { session: number; turnedIn: boolean }>();
  const turnedIn = tx.select({ userId: S.userId, startedAt: S.startedAt }).from(S).where(eq(S.labId, lab.id)).all();
  for (const s of turnedIn) {
    const session = s.startedAt.getTime();
    const current = counted.get(s.userId);
    if (!current || session > current.session) counted.set(s.userId, { session, turnedIn: true });
  }
  const played = tx.selectDistinct({ userId: E.userId, session: E.sessionStartedAt }).from(E)
    .where(and(eq(E.labId, lab.id), inArray(E.kind, [...PLAYBACK_KINDS]))).all();
  for (const p of played) {
    const current = counted.get(p.userId);
    if (!current || (!current.turnedIn && p.session > current.session)) counted.set(p.userId, { session: p.session, turnedIn: false });
  }

  const rows = [...counted.entries()]
    .filter(([userId]) => !admins.has(userId) && !inSet.has(userId))
    .map(([userId, { session }]) => ({
      examSet, userId, labId: lab.id, labTitle: lab.title, sessionStartedAt: session, startedAt: session, source: 'past' as const,
    }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    inserted += tx.insert(X).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: X.id }).all().length;
  }
  return inserted;
}

export type PlayOutcome =
  | { kind: 'ok'; counted: ExamStartRow | null }
  /** A test session playing without a start: refused. */
  | { kind: 'not-started' };

/**
 * A student's playback (PLAYBACK_KINDS: a listening report, or the turn-in's
 * final entry) on a lab that is in set `examSet` now, in the transaction that
 * stores it. `opened` is the set the session was opened as a form of (its
 * rules' `exam`), null for a practice session.
 *
 * - A test session plays only once a start covers it ("Start the test"; a
 *   reset start still does): a page that holds the file from before cannot
 *   play the test unseen.
 * - A session opened as anything else (a practice page left open when the lab
 *   became a test, a test whose lab moved to another set mid-play) plays on
 *   and turns in by its own rules, but its player has heard this set's test:
 *   that counts as their start in the set (`source` 'past'), unless their
 *   one start there is used already, or this session was counted before (and
 *   maybe reset since, which must give exactly one more start).
 */
export function examPlay(tx: Tx, args: {
  examSet: string;
  opened: string | null;
  userId: number;
  lab: { id: number; title: string };
  sessionStartedAt: number;
}): PlayOutcome {
  const { examSet, opened, userId, lab, sessionStartedAt } = args;
  const forSession = and(eq(X.userId, userId), eq(X.labId, lab.id), eq(X.sessionStartedAt, sessionStartedAt));
  if (opened !== null && !tx.select({ id: X.id }).from(X).where(forSession).limit(1).get()) return { kind: 'not-started' };
  if (opened === examSet) return { kind: 'ok', counted: null };
  if (tx.select({ id: X.id }).from(X).where(and(forSession, eq(X.examSet, examSet))).limit(1).get()) return { kind: 'ok', counted: null };
  if (liveStartIn(tx, userId, examSet)) return { kind: 'ok', counted: null };
  const [row] = tx.insert(X).values({
    examSet, userId, labId: lab.id, labTitle: lab.title, sessionStartedAt, startedAt: sessionStartedAt, source: 'past',
  }).onConflictDoNothing().returning().all();
  return { kind: 'ok', counted: row ?? null };
}

export type ClaimOutcome =
  | { kind: 'claimed'; row: ExamStartRow }
  /** The same session claimed before (a retry after a lost response): the same start. */
  | { kind: 'again'; row: ExamStartRow }
  /** The student's one start in the set is used (or this session's start was reset). */
  | { kind: 'used' };

/**
 * Claims the student's one start in a set for this session ("Start the
 * test"). One transaction, and the partial unique index besides: of two tabs
 * racing, exactly one gets it.
 */
export function claimExamStart(args: {
  examSet: string;
  userId: number;
  lab: { id: number; title: string };
  sessionStartedAt: number;
  nowMs: number;
}): ClaimOutcome {
  return db.transaction((tx): ClaimOutcome => {
    const same = tx.select().from(X)
      .where(and(
        eq(X.userId, args.userId), eq(X.labId, args.lab.id), eq(X.sessionStartedAt, args.sessionStartedAt), eq(X.examSet, args.examSet),
      ))
      .orderBy(desc(X.id))
      .get();
    if (same) return same.resetAt === null ? { kind: 'again', row: same } : { kind: 'used' };
    if (liveStartIn(tx, args.userId, args.examSet)) return { kind: 'used' };
    const [row] = tx.insert(X).values({
      examSet: args.examSet,
      userId: args.userId,
      labId: args.lab.id,
      labTitle: args.lab.title,
      sessionStartedAt: args.sessionStartedAt,
      startedAt: args.nowMs,
      source: 'start',
    }).onConflictDoNothing().returning().all();
    return row ? { kind: 'claimed', row } : { kind: 'used' };
  });
}

export type ResetOutcome =
  | { kind: 'reset'; row: ExamStartRow }
  | { kind: 'already'; row: ExamStartRow }
  | { kind: 'missing' };

/**
 * The teacher's Reset: stamps a live start, which gives the student exactly
 * one more. A second Reset of the same start (a stale list, a double click)
 * changes nothing.
 */
export function resetExamStart(startId: number, byUserId: number, nowMs: number): ResetOutcome {
  return db.transaction((tx): ResetOutcome => {
    const [row] = tx.update(X).set({ resetAt: nowMs, resetBy: byUserId })
      .where(and(eq(X.id, startId), isNull(X.resetAt)))
      .returning()
      .all();
    if (row) return { kind: 'reset', row };
    const existing = tx.select().from(X).where(eq(X.id, startId)).get();
    return existing ? { kind: 'already', row: existing } : { kind: 'missing' };
  });
}

function liveStartIn(tx: Tx, userId: number, examSet: string): ExamStartRow | undefined {
  return tx.select().from(X).where(and(eq(X.examSet, examSet), eq(X.userId, userId), isNull(X.resetAt))).get();
}

/** The student's live start in a set, if their one start is used. */
export function liveStart(userId: number, examSet: string): ExamStartRow | undefined {
  return db.select().from(X).where(and(eq(X.examSet, examSet), eq(X.userId, userId), isNull(X.resetAt))).get();
}

/** The student's live starts, one per set at most. */
export function liveStartsForUser(userId: number): ExamStartRow[] {
  return db.select().from(X).where(and(eq(X.userId, userId), isNull(X.resetAt))).all();
}

/** Whether this session was counted as a start (live or reset): an exam session may be turned in only then. */
export function sessionHasStart(userId: number, labId: number, sessionStartedAt: number): boolean {
  return db.select({ id: X.id }).from(X)
    .where(and(eq(X.userId, userId), eq(X.labId, labId), eq(X.sessionStartedAt, sessionStartedAt)))
    .limit(1)
    .get() !== undefined;
}

const sessionKey = (labId: number, userId: number, sessionStartedAt: number) => `${labId}:${userId}:${sessionStartedAt}`;

/** The starts whose session was turned in (a submission for it exists), by `startKey`. */
export function finishedStarts(rows: readonly Pick<ExamStartRow, 'labId' | 'userId' | 'sessionStartedAt'>[]): Set<string> {
  const withLab = rows.filter((r): r is typeof r & { labId: number } => r.labId !== null);
  if (withLab.length === 0) return new Set();
  const turnedIn = db.select({ labId: S.labId, userId: S.userId, startedAt: S.startedAt }).from(S)
    .where(and(
      inArray(S.labId, [...new Set(withLab.map((r) => r.labId))]),
      inArray(S.userId, [...new Set(withLab.map((r) => r.userId))]),
    ))
    .all();
  const keys = new Set(turnedIn.map((s) => sessionKey(s.labId, s.userId, s.startedAt.getTime())));
  return new Set(withLab.map(startKey).filter((k) => keys.has(k)));
}

/** A start's session, as `finishedStarts` keys it. */
export const startKey = (row: Pick<ExamStartRow, 'labId' | 'userId' | 'sessionStartedAt'>) =>
  sessionKey(row.labId ?? -1, row.userId, row.sessionStartedAt);

// ---------------------------------------------------------------------------
// The teacher's views: the Tests list and a set's students

/** A start as the teacher's roster shows it. */
export interface ExamStartView {
  startId: number;
  labId: number | null;
  labTitle: string;
  /** 'past': counted from a play outside "Start the test" (before the lab joined the set, or in a session opened before it did). */
  source: 'start' | 'past';
  /** ms */
  startedAt: number;
  /** How far the session was heard through (its listening log); null if it has no log (the lab was deleted). */
  heardThroughMs: number | null;
  /** Of that lab now; null if it was deleted. */
  durationMs: number | null;
  requiredThroughMs: number | null;
  /** The session was turned in. */
  finished: boolean;
  /** The newest server time in the session's log. */
  lastSeenAt: number | null;
  resetAt: number | null;
  resetByName: string | null;
}

/** Every start in a set (students only, never a teacher), with who each student is. */
export function startsInSet(examSet: string) {
  return db.select({ start: X, name: schema.users.name, email: schema.users.email })
    .from(X)
    .innerJoin(schema.users, eq(X.userId, schema.users.id))
    .where(and(eq(X.examSet, examSet), ne(schema.users.role, 'admin')))
    .all();
}

/** The roster's view of these starts: how far each session got, whether it was turned in, who reset it. */
export function startViews(rows: readonly ExamStartRow[]): ExamStartView[] {
  if (rows.length === 0) return [];
  const labIds = [...new Set(rows.map((r) => r.labId).filter((id): id is number => id !== null))];
  const labs = new Map((labIds.length === 0 ? [] : db.select({
    id: schema.labs.id, durationMs: schema.labs.durationMs, requiredThroughMs: schema.labs.requiredThroughMs,
  }).from(schema.labs).where(inArray(schema.labs.id, labIds)).all()).map((l) => [l.id, l]));
  const resetters = [...new Set(rows.map((r) => r.resetBy).filter((id): id is number => id !== null))];
  const names = new Map((resetters.length === 0 ? [] : db.select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users).where(inArray(schema.users.id, resetters)).all()).map((u) => [u.id, u.name]));
  const finished = finishedStarts(rows);

  return rows.map((row) => {
    const events: ListenEvent[] = row.labId === null ? [] : db.select({
      kind: E.kind, positionMs: E.positionMs, clientMs: E.clientMs, at: E.at,
    }).from(E)
      .where(and(eq(E.labId, row.labId), eq(E.userId, row.userId), eq(E.sessionStartedAt, row.sessionStartedAt)))
      .all();
    const lab = row.labId === null ? undefined : labs.get(row.labId);
    return {
      startId: row.id,
      labId: row.labId,
      labTitle: row.labTitle,
      source: row.source,
      startedAt: row.startedAt,
      heardThroughMs: events.length > 0 ? summarizeListening(events, row.sessionStartedAt).heardThroughMs : null,
      durationMs: lab?.durationMs ?? null,
      requiredThroughMs: lab?.requiredThroughMs ?? null,
      finished: finished.has(startKey(row)),
      lastSeenAt: events.length > 0 ? events.reduce((latest, e) => Math.max(latest, e.at), 0) : null,
      resetAt: row.resetAt,
      resetByName: row.resetBy === null ? null : names.get(row.resetBy) ?? null,
    };
  });
}

/** Newest first: by when it started, then by id. */
const newestStartFirst = (a: ExamStartRow, b: ExamStartRow) => b.startedAt - a.startedAt || b.id - a.id;

/** A student in a set's roster. */
export interface ExamRosterStudent {
  userId: number;
  name: string;
  email: string;
  /** false: has a start in this set but is in none of the set's audiences any more. */
  assigned: boolean;
  /** The live start (null: the student may start one form). */
  current: ExamStartView | null;
  /** Starts the teacher reset, newest first: the earlier plays, kept. */
  earlier: ExamStartView[];
}

/**
 * A set's roster: every student its labs are for (`assigned`), plus anyone
 * with a start in it, by name. With `labId`, only students whose current or
 * an earlier start is on that form.
 */
export function examRoster(
  examSet: string,
  assigned: ReadonlyMap<number, { id: number; name: string; email: string }>,
  labId?: number,
): ExamRosterStudent[] {
  const starts = startsInSet(examSet);
  const views = new Map(startViews(starts.map((s) => s.start)).map((v) => [v.startId, v]));
  const people = new Map<number, { name: string; email: string }>();
  for (const [id, student] of assigned) people.set(id, { name: student.name, email: student.email });
  for (const s of starts) if (!people.has(s.start.userId)) people.set(s.start.userId, { name: s.name, email: s.email });

  const students: ExamRosterStudent[] = [];
  for (const [userId, who] of people) {
    const own = starts.map((s) => s.start).filter((r) => r.userId === userId).sort(newestStartFirst);
    const live = own.find((r) => r.resetAt === null);
    const current = live ? views.get(live.id)! : null;
    const earlier = own.filter((r) => r.resetAt !== null).map((r) => views.get(r.id)!);
    if (labId !== undefined && current?.labId !== labId && !earlier.some((v) => v.labId === labId)) continue;
    students.push({ userId, name: who.name, email: who.email, assigned: assigned.has(userId), current, earlier });
  }
  return students.sort((a, b) => a.name.localeCompare(b.name) || a.userId - b.userId);
}

/** A set's counts for the Tests list. */
export function examSetCounts(examSet: string, assignedIds: ReadonlySet<number>) {
  const starts = startsInSet(examSet).map((s) => s.start);
  const live = starts.filter((r) => r.resetAt === null);
  const finished = finishedStarts(live);
  return {
    /** Students the set's labs are for (never a teacher). */
    studentCount: assignedIds.size,
    /** Students in the roster with a live start. */
    startedCount: new Set(live.map((r) => r.userId)).size,
    /** Of those, how many turned in the form they started. */
    finishedCount: live.filter((r) => finished.has(startKey(r))).length,
    /** Starts the teacher reset in this set. */
    resetCount: starts.filter((r) => r.resetAt !== null).length,
  };
}
