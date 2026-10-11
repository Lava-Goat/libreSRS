// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb, sqlite } = createTestDb();

async function load() {
  return import('./examLabs.js');
}

let labCounter = 0;
async function lab(fields: Partial<typeof schema.labs.$inferInsert> = {}) {
  labCounter += 1;
  const [row] = await testDb.insert(schema.labs).values({
    title: `Forma ${labCounter}`,
    audioUrl: `/api/assets/00000000-0000-4000-8000-${String(labCounter).padStart(12, '0')}.mp3`,
    mimeType: 'audio/mpeg',
    durationMs: 100_000,
    requiredThroughMs: 95_000,
    forEveryone: true,
    active: true,
    createdBy: 1,
    ...fields,
  }).returning();
  return row;
}

type Kind = (typeof schema.labListenEvents.$inferInsert)['kind'];
const event = (labId: number, userId: number, session: number, kind: Kind, positionMs = 0) =>
  ({ labId, userId, sessionStartedAt: session, kind, positionMs, clientMs: positionMs + 1000, at: session + positionMs + 1100 });

const start = (fields: Partial<typeof schema.labExamStarts.$inferInsert> & { userId: number }) => ({
  examSet: 'U3', labId: null, labTitle: 'Forma A', sessionStartedAt: 1, startedAt: 1, ...fields,
});

/** Runs a helper that takes a transaction, as the router does. */
const inTx = <T>(work: (tx: Parameters<Parameters<typeof testDb.transaction>[0]>[0]) => T): T => testDb.transaction(work);

describe('exam labs service', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'carla', role: 'user' },
    ]);
  });

  describe('resolveExamSet', () => {
    it('stores the canonical name, in the spelling a lab or a start already has', async () => {
      const { resolveExamSet } = await load();
      await lab({ examSet: 'U3' });
      await testDb.insert(schema.labExamStarts).values(start({ userId: 2, examSet: 'Final Ü9' }));
      expect(inTx((tx) => resolveExamSet(tx, ' u3 '))).toBe('U3');
      expect(inTx((tx) => resolveExamSet(tx, 'final   ü9'))).toBe('Final Ü9');
      expect(inTx((tx) => resolveExamSet(tx, 'U4'))).toBe('U4');
      for (const bad of ['', '  ', 'x'.repeat(41)]) expect(inTx((tx) => resolveExamSet(tx, bad))).toBeNull();
    });

    it('prefers the exact spelling when two are in use', async () => {
      const { resolveExamSet } = await load();
      await lab({ examSet: 'u3' });
      await lab({ examSet: 'U3' });
      expect(inTx((tx) => resolveExamSet(tx, 'U3'))).toBe('U3');
      expect(inTx((tx) => resolveExamSet(tx, 'u3'))).toBe('u3');
    });

    it('reuses the spelling of a speaking test, when no lab or start has the set (v1.21.0)', async () => {
      const { resolveExamSet } = await load();
      await testDb.insert(schema.speakingTasks).values([
        { title: 'Examen U2 · Expresión oral', createdBy: 1, examSet: 'U2' },
        { title: 'Cuento semana 2', createdBy: 1 },
      ]);
      expect(inTx((tx) => resolveExamSet(tx, ' u2 '))).toBe('U2');
      expect(inTx((tx) => resolveExamSet(tx, 'U4'))).toBe('U4');
    });

    it('gives a lab’s or a start’s spelling the win over a speaking test’s', async () => {
      const { resolveExamSet } = await load();
      // The task is written first, so the order of the rows is not what decides.
      await testDb.insert(schema.speakingTasks).values([
        { title: 'Oral A', createdBy: 1, examSet: 'final a' },
        { title: 'Oral B', createdBy: 1, examSet: 'FINAL b' },
      ]);
      await lab({ examSet: 'Final A' });
      await testDb.insert(schema.labExamStarts).values(start({ userId: 2, examSet: 'Final B' }));
      expect(inTx((tx) => resolveExamSet(tx, 'FINAL A'))).toBe('Final A');
      expect(inTx((tx) => resolveExamSet(tx, 'final B'))).toBe('Final B');
      // An exact spelling is still kept, whoever has it.
      expect(inTx((tx) => resolveExamSet(tx, 'final a'))).toBe('final a');
    });
  });

  describe('countPastStarts', () => {
    it('counts students who played or turned the lab in, with their newest turned-in session, else their newest played one', async () => {
      const { countPastStarts } = await load();
      const l = await lab({ title: 'U2 lab 4' });
      await testDb.insert(schema.labListenEvents).values([
        // Ana: an old play, a newer one.
        event(l.id, 2, 1000, 'open'), event(l.id, 2, 1000, 'play'), event(l.id, 2, 1000, 'tick', 5000),
        event(l.id, 2, 9000, 'open'), event(l.id, 2, 9000, 'seek', 2000),
        // Beto: turned in (below), and a newer play he abandoned.
        event(l.id, 3, 50_000, 'open'), event(l.id, 3, 50_000, 'pause', 3000),
        // Carla: opened, and went on without a microphone; never played.
        event(l.id, 4, 7000, 'open'), event(l.id, 4, 7000, 'nomic'),
        // The teacher played it.
        event(l.id, 1, 8000, 'play'),
      ]);
      for (const startedAt of [20_000, 30_000]) {
        await testDb.insert(schema.labSubmissions).values({
          labId: l.id, userId: 3, requiredThroughMs: 95_000, startedAt: new Date(startedAt), submittedAt: new Date(startedAt + 100_000),
        });
      }
      expect(inTx((tx) => countPastStarts(tx, l, 'U2'))).toBe(2);
      const rows = await testDb.select().from(schema.labExamStarts).orderBy(schema.labExamStarts.userId);
      expect(rows.map((r) => [r.userId, r.examSet, r.labId, r.labTitle, r.sessionStartedAt, r.startedAt, r.source, r.resetAt])).toEqual([
        [2, 'U2', l.id, 'U2 lab 4', 9000, 9000, 'past', null],
        [3, 'U2', l.id, 'U2 lab 4', 30_000, 30_000, 'past', null],
      ]);
      // Run again: everyone with a play already has a row in the set.
      expect(inTx((tx) => countPastStarts(tx, l, 'U2'))).toBe(0);
      // A play of the same lab counts separately in another set.
      expect(inTx((tx) => countPastStarts(tx, l, 'U2 make-up'))).toBe(2);
    });

    it('never charges a student with any row in the set, a reset one included', async () => {
      const { countPastStarts } = await load();
      const l = await lab();
      await testDb.insert(schema.labListenEvents).values([event(l.id, 2, 1000, 'play'), event(l.id, 3, 1000, 'end', 95_000)]);
      await testDb.insert(schema.labExamStarts).values(start({ userId: 2, resetAt: 5, resetBy: 1 }));
      expect(inTx((tx) => countPastStarts(tx, l, 'U3'))).toBe(1);
      expect((await testDb.select().from(schema.labExamStarts)).map((r) => [r.userId, r.resetAt === null])).toEqual([[2, false], [3, true]]);
    });

    it('counts a whole school at once', async () => {
      const { countPastStarts } = await load();
      const l = await lab();
      const students = Array.from({ length: 450 }, (_, i) => ({ id: 100 + i, googleId: `g${i}`, email: `s${i}@example.com`, name: `S${i}` }));
      await testDb.insert(schema.users).values(students);
      await testDb.insert(schema.labListenEvents).values(students.map((s) => event(l.id, s.id, 1000, 'tick', 5000)));
      expect(inTx((tx) => countPastStarts(tx, l, 'U3'))).toBe(450);
      expect((sqlite.prepare('SELECT count(*) AS n FROM lab_exam_starts').get() as { n: number }).n).toBe(450);
    });
  });

  describe('claimExamStart and resetExamStart', () => {
    it('claims once per set, answers the same session again with the same start, and refuses any other', async () => {
      const { claimExamStart, sessionHasStart } = await load();
      const a = await lab({ title: 'Forma A', examSet: 'U3' });
      const b = await lab({ title: 'Forma B', examSet: 'U3' });
      const other = await lab({ title: 'Forma A', examSet: 'U4' });
      const claim = (labId: number, sessionStartedAt: number, examSet = 'U3', title = 'Forma A') =>
        claimExamStart({ examSet, userId: 2, lab: { id: labId, title }, sessionStartedAt, nowMs: sessionStartedAt + 30_000 });

      const first = claim(a.id, 1000);
      expect(first).toMatchObject({ kind: 'claimed', row: { examSet: 'U3', userId: 2, labId: a.id, sessionStartedAt: 1000, startedAt: 31_000, source: 'start' } });
      expect(claim(a.id, 1000)).toEqual({ kind: 'again', row: (first as { row: unknown }).row });
      expect(claim(a.id, 2000)).toEqual({ kind: 'used' });
      expect(claim(b.id, 3000, 'U3', 'Forma B')).toEqual({ kind: 'used' });
      expect(claim(other.id, 4000, 'U4')).toMatchObject({ kind: 'claimed' });
      expect(sessionHasStart(2, a.id, 1000)).toBe(true);
      expect(sessionHasStart(2, a.id, 2000)).toBe(false);
      expect(sessionHasStart(3, a.id, 1000)).toBe(false);
    });

    it('resets a live start once: one more start, the old row kept', async () => {
      const { claimExamStart, resetExamStart, liveStart, liveStartsForUser } = await load();
      const a = await lab({ title: 'Forma A', examSet: 'U3' });
      const claimed = claimExamStart({ examSet: 'U3', userId: 2, lab: a, sessionStartedAt: 1000, nowMs: 2000 });
      if (claimed.kind !== 'claimed') throw new Error('not claimed');

      expect(resetExamStart(claimed.row.id, 1, 9000)).toEqual({ kind: 'reset', row: { ...claimed.row, resetAt: 9000, resetBy: 1 } });
      expect(resetExamStart(claimed.row.id, 1, 9500)).toEqual({ kind: 'already', row: { ...claimed.row, resetAt: 9000, resetBy: 1 } });
      expect(resetExamStart(12345, 1, 9500)).toEqual({ kind: 'missing' });
      expect(liveStart(2, 'U3')).toBeUndefined();
      // The reset session cannot claim again; a new one can, once.
      expect(claimExamStart({ examSet: 'U3', userId: 2, lab: a, sessionStartedAt: 1000, nowMs: 10_000 })).toEqual({ kind: 'used' });
      expect(claimExamStart({ examSet: 'U3', userId: 2, lab: a, sessionStartedAt: 11_000, nowMs: 12_000 })).toMatchObject({ kind: 'claimed' });
      expect(claimExamStart({ examSet: 'U3', userId: 2, lab: a, sessionStartedAt: 13_000, nowMs: 14_000 })).toEqual({ kind: 'used' });
      expect(liveStartsForUser(2).map((r) => r.sessionStartedAt)).toEqual([11_000]);
      expect((sqlite.prepare('SELECT count(*) AS n FROM lab_exam_starts').get() as { n: number }).n).toBe(2);
    });
  });

  describe('the teacher’s views', () => {
    it('builds a roster by name, with assigned students, starts by form, and history newest first', async () => {
      const { examRoster, examSetCounts, finishedStarts, startKey } = await load();
      const a = await lab({ title: 'Forma A', examSet: 'U3' });
      const b = await lab({ title: 'Forma B', examSet: 'U3' });
      await testDb.insert(schema.labExamStarts).values([
        start({ userId: 2, labId: a.id, sessionStartedAt: 1000, startedAt: 1000, resetAt: 2000, resetBy: 1 }),
        start({ userId: 2, labId: b.id, labTitle: 'Forma B', sessionStartedAt: 3000, startedAt: 3500, resetAt: 4000, resetBy: 1 }),
        start({ userId: 2, labId: a.id, sessionStartedAt: 5000, startedAt: 5500 }),
        // Carla is not assigned any more; the teacher never is listed.
        start({ userId: 4, labId: b.id, labTitle: 'Forma B', sessionStartedAt: 6000, startedAt: 6000, source: 'past' }),
        start({ userId: 1, labId: a.id, sessionStartedAt: 7000, startedAt: 7000 }),
      ]);
      await testDb.insert(schema.labListenEvents).values([event(a.id, 2, 5000, 'open'), event(a.id, 2, 5000, 'play'), event(a.id, 2, 5000, 'tick', 5000)]);
      await testDb.insert(schema.labSubmissions).values({
        labId: b.id, userId: 4, requiredThroughMs: 95_000, startedAt: new Date(6000), submittedAt: new Date(200_000),
      });

      const assigned = new Map([
        [3, { id: 3, name: 'Beto', email: 'beto@example.com' }],
        [2, { id: 2, name: 'Ana', email: 'ana@example.com' }],
      ]);
      const roster = examRoster('U3', assigned);
      expect(roster.map((s) => [s.name, s.assigned, s.current?.startedAt ?? null, s.earlier.map((e) => e.startedAt)])).toEqual([
        ['Ana', true, 5500, [3500, 1000]], ['Beto', true, null, []], ['carla', false, 6000, []],
      ]);
      expect(roster[0].current).toMatchObject({ labId: a.id, heardThroughMs: 5000, lastSeenAt: 5000 + 5000 + 1100, finished: false });
      expect(roster[0].earlier[0]).toMatchObject({ labTitle: 'Forma B', heardThroughMs: null, lastSeenAt: null, resetAt: 4000, resetByName: 'Admin' });
      expect(roster[2].current).toMatchObject({ source: 'past', finished: true, durationMs: 100_000, requiredThroughMs: 95_000 });

      // One form: students whose current or an earlier start is on it.
      expect(examRoster('U3', assigned, b.id).map((s) => s.name)).toEqual(['Ana', 'carla']);
      expect(examRoster('U3', assigned, a.id).map((s) => s.name)).toEqual(['Ana']);

      expect(examSetCounts('U3', new Set(assigned.keys()))).toEqual({ studentCount: 2, startedCount: 2, finishedCount: 1, resetCount: 2 });
      const live = await testDb.select().from(schema.labExamStarts);
      expect([...finishedStarts(live)]).toEqual([startKey({ labId: b.id, userId: 4, sessionStartedAt: 6000 })]);
      expect(examRoster('U9', new Map())).toEqual([]);
    });
  });
});
