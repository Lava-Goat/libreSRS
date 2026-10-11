// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0): test audio as its own thing. One start per student per
 * exam set, claimed at "Start the test"; the teacher's Reset gives one more.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb, sqlite } = createTestDb();
const assetsDir = mkdtempSync(join(tmpdir(), 'libresrs-exam-assets-'));

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' as const };
const dani = { id: 5, googleId: 'g-dani', email: 'dani@example.com', name: 'Dani', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const PERIOD_1 = 1;
const PERIOD_2 = 2;
const DURATION = 100_000;
const REQUIRED = 95_000;
/** Instructions read before Play, on the page's clock. */
const SETUP_MS = 20_000;

async function load() {
  const { labsRouter } = await import('./labs.js');
  const callerFor = (user: AnyUser) => labsRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return { admin: callerFor(adminUser), ana: callerFor(ana), beto: callerFor(beto), carla: callerFor(carla), dani: callerFor(dani) };
}
type Callers = Awaited<ReturnType<typeof load>>;
type Caller = Callers['ana'];

let assetCounter = 0;
function uploadedAudio(): string {
  assetCounter += 1;
  const name = `00000000-0000-4000-8000-${String(assetCounter).padStart(12, '0')}.mp3`;
  writeFileSync(join(assetsDir, name), 'mp3');
  return `/api/assets/${name}`;
}

function createLab(api: Callers, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) {
  return api.admin.create({
    title: 'ES1 Lab semana01',
    audioUrl: uploadedAudio(),
    mimeType: 'audio/mpeg',
    durationMs: DURATION,
    requiredThroughMs: REQUIRED,
    active: true,
    ...overrides,
  });
}

/** A form of an exam set, for everyone unless told otherwise. */
const examForm = (api: Callers, set: string, form: string, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) =>
  createLab(api, { title: `Examen ${set} · Escucha · Forma ${form}`, examSet: set, ...overrides });

/** Opens a session as the page does, at a time in the past (the server's clock is set back for it). */
async function openAt(caller: Caller, labId: number, startedAt: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startedAt);
  try {
    return await caller.begin({ labId, client: 3 });
  } finally {
    vi.useRealTimers();
  }
}

let sessionClock = 0;
/** A start time long enough ago for the whole test to have been heard; each one different. */
const pastStart = () => Date.now() - (REQUIRED + 120_000) - (sessionClock += 1000);

/** An honest page's log: play at 0 and a tick every 5 s through `upTo`, each on time. */
async function playLog(labId: number, userId: number, startedAt: number, upTo = REQUIRED) {
  const rows: (typeof schema.labListenEvents.$inferInsert)[] = [];
  for (let p = 0; p <= upTo; p += 5000) {
    const clientMs = SETUP_MS + p;
    rows.push({ labId, userId, sessionStartedAt: startedAt, kind: p === 0 ? 'play' : 'tick', positionMs: p, clientMs, at: startedAt + clientMs + 50 });
  }
  await testDb.insert(schema.labListenEvents).values(rows);
}

/** Opens a form, starts the test, and plays it through `upTo`. */
async function startedSession(caller: Caller, userId: number, labId: number, upTo = REQUIRED) {
  const startedAt = pastStart();
  const session = await openAt(caller, labId, startedAt);
  const start = await caller.startExam({ labId, startToken: session.startToken });
  await playLog(labId, userId, startedAt, upTo);
  return { ...session, startedAt, start };
}

/** What the exam page sends when the student turns the test in. */
const turnIn = (labId: number, startToken: string, fields: Record<string, unknown> = {}) => ({
  labId,
  startToken,
  positionMs: REQUIRED + 5000,
  clientMs: SETUP_MS + REQUIRED + 5000,
  voicedMs: 0,
  pausedVoicedMs: 0,
  listenWallMs: REQUIRED + 5000,
  mic: 'off' as const,
  answers: [],
  ...fields,
});

const starts = () => testDb.select().from(schema.labExamStarts).orderBy(schema.labExamStarts.id).all();
const opens = () => testDb.select().from(schema.labListenEvents).where(eq(schema.labListenEvents.kind, 'open')).all();
const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** The refusal's tRPC code and appCode. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; cause?: { appCode?: string } };
    return { code: e.code, message: e.message, appCode: e.cause?.appCode };
  }
  throw new Error('expected a refusal');
}

describe('exam labs', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/ai/assetStorage.js', () => ({ getAssetsDir: () => assetsDir }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', role: 'user' },
      { id: 5, googleId: 'g-dani', email: 'dani@example.com', name: 'Dani', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([
      { id: PERIOD_1, name: 'Español 1 — P1' },
      { id: PERIOD_2, name: 'Español 1 — P2' },
    ]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 },
      { userId: beto.id, groupId: PERIOD_1 },
      { userId: carla.id, groupId: PERIOD_2 },
      // Dani is in both periods.
      { userId: dani.id, groupId: PERIOD_1 },
      { userId: dani.id, groupId: PERIOD_2 },
      { userId: adminUser.id, groupId: PERIOD_1 },
    ]);
  });

  describe('the editor: an Exam switch and an exam-set name', () => {
    it('creates a lab as a form of a set, trimmed, in the spelling the set already has', async () => {
      const api = await load();
      expect((await createLab(api)).examSet).toBeNull();
      expect((await createLab(api, { examSet: null })).examSet).toBeNull();
      expect((await examForm(api, '  U3 ', 'A')).examSet).toBe('U3');
      expect((await examForm(api, 'u3', 'B')).examSet).toBe('U3');
      expect((await examForm(api, 'Unidad   3\tfinal', 'A', { title: 'Unidad 3 final A' })).examSet).toBe('Unidad 3 final');
      expect((await api.admin.adminList()).map((l) => l.examSet).sort()).toEqual(['U3', 'U3', 'Unidad 3 final', null, null]);
    });

    it('switches exam on and off, and reuses a set that only has starts left', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'Forma A' });
      await expect(api.admin.update({ id: lab.id, examSet: ' U3  ' })).resolves.toEqual({ success: true, examSet: 'U3', pastStarts: 0 });
      // The same set in another case is no change.
      await expect(api.admin.update({ id: lab.id, examSet: 'u3' })).resolves.toEqual({ success: true, examSet: 'U3', pastStarts: 0 });
      await expect(api.admin.update({ id: lab.id, examSet: null })).resolves.toEqual({ success: true, examSet: null, pastStarts: 0 });
      // A plain edit leaves it as it is.
      await expect(api.admin.update({ id: lab.id, title: 'Forma A (2)' })).resolves.toEqual({ success: true, examSet: null, pastStarts: 0 });

      // A set whose labs were all deleted still has its starts, and its spelling.
      await testDb.insert(schema.labExamStarts).values({
        examSet: 'Final U9', userId: carla.id, labId: null, labTitle: 'Old form', sessionStartedAt: 1, startedAt: 1,
      });
      await expect(api.admin.update({ id: lab.id, examSet: 'final   u9' })).resolves.toMatchObject({ examSet: 'Final U9' });
      expect((await testDb.query.labs.findFirst({ where: eq(schema.labs.id, lab.id) }))?.examSet).toBe('Final U9');
    });

    it('refuses an empty or too-long set name, and writes nothing', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'Forma A' });
      for (const examSet of ['', '   ', 'x'.repeat(41)]) {
        expect(await refusal(api.admin.update({ id: lab.id, examSet }))).toMatchObject({ code: 'BAD_REQUEST', appCode: 'EXAM_SET_INVALID' });
        expect(await refusal(examForm(api, examSet, 'B'))).toMatchObject({
          code: 'BAD_REQUEST', appCode: 'EXAM_SET_INVALID', message: 'Name the exam set (for example U3), in 40 characters or fewer.',
        });
      }
      expect((await api.admin.adminList()).map((l) => [l.title, l.examSet])).toEqual([['Forma A', null]]);
      expect((await examForm(api, 'x'.repeat(40), 'C')).examSet).toBe('x'.repeat(40));
    });

    it('touches neither the groups nor "for everyone" when only the exam set is sent; an empty group list still means everyone', async () => {
      const api = await load();
      const p1 = await createLab(api, { title: 'P1', groupIds: [PERIOD_1] });
      const all = await createLab(api, { title: 'All' });
      await api.admin.update({ id: p1.id, examSet: 'U3' });
      await api.admin.update({ id: all.id, examSet: 'U3' });
      const rows = await api.admin.adminList();
      expect(rows.map((l) => [l.title, l.forEveryone, l.groupIds, l.examSet])).toEqual([
        ['All', true, [], 'U3'], ['P1', false, [PERIOD_1], 'U3'],
      ]);
      await api.admin.update({ id: p1.id, groupIds: [] });
      expect((await api.admin.adminList()).find((l) => l.id === p1.id)).toMatchObject({ forEveryone: true, groupIds: [], examSet: 'U3' });
    });
  });

  describe('what students see: tests as their own thing', () => {
    it('keeps the practice list exactly as before: no input lists no exam lab', async () => {
      const api = await load();
      await createLab(api, { title: 'ES1 Lab semana02' });
      await createLab(api, { title: 'ES1 Lab semana10', groupIds: [PERIOD_1] });
      const before = await api.ana.list();
      await examForm(api, 'U3', 'A');
      await examForm(api, 'U3', 'B', { groupIds: [PERIOD_1] });
      expect(await api.ana.list()).toEqual(before);
      expect(await api.ana.list({})).toEqual(before);
      expect(await api.ana.list({ exams: false })).toEqual(before);
      expect(await api.admin.list()).toHaveLength(2);
      for (const item of before) expect(item).not.toHaveProperty('exam');
    });

    it('lists the exam labs with their set, and the student’s one start on every form', async () => {
      const api = await load();
      await createLab(api, { title: 'ES1 Lab semana02' });
      const a = await examForm(api, 'U3', 'A');
      const b = await examForm(api, 'U3', 'B');
      const other = await examForm(api, 'U4', 'A');
      await examForm(api, 'U3', 'C (P2)', { groupIds: [PERIOD_2] });
      await examForm(api, 'U3', 'D (hidden)', { active: false });

      const list = await api.ana.list({ exams: true });
      expect(list.map((l) => [l.title, l.exam?.set ?? null])).toEqual([
        ['ES1 Lab semana02', null],
        ['Examen U3 · Escucha · Forma A', 'U3'],
        ['Examen U3 · Escucha · Forma B', 'U3'],
        ['Examen U4 · Escucha · Forma A', 'U4'],
      ]);
      expect(list[0]).not.toHaveProperty('exam');
      for (const item of list) expect(item).not.toHaveProperty('audioUrl');
      expect(list[1].exam).toEqual({ set: 'U3', preview: false, start: null });
      // Today's fields too.
      expect(list[1]).toMatchObject({ id: a.id, status: 'todo', attempts: 0, durationMs: DURATION, requiredThroughMs: REQUIRED });

      const { startToken, start } = await startedSession(api.ana, ana.id, a.id);
      const started = await api.ana.list({ exams: true });
      const startView = { labId: a.id, title: 'Examen U3 · Escucha · Forma A', startedAt: start.startedAt, finished: false };
      expect(started.find((l) => l.id === a.id)?.exam).toEqual({ set: 'U3', preview: false, start: startView });
      expect(started.find((l) => l.id === b.id)?.exam).toEqual({ set: 'U3', preview: false, start: startView });
      expect(started.find((l) => l.id === other.id)?.exam).toEqual({ set: 'U4', preview: false, start: null });
      // Beto has not started.
      expect((await api.beto.list({ exams: true })).find((l) => l.id === b.id)?.exam?.start).toBeNull();

      await api.ana.submit(turnIn(a.id, startToken));
      const done = await api.ana.list({ exams: true });
      expect(done.find((l) => l.id === b.id)?.exam?.start).toEqual({ ...startView, finished: true });
      expect(done.find((l) => l.id === a.id)).toMatchObject({ status: 'done', attempts: 1 });
    });

    it('shows the teacher every exam lab as a preview, never with a start', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A', { groupIds: [PERIOD_2] });
      const session = await api.admin.begin({ labId: a.id, client: 3 });
      await api.admin.startExam({ labId: a.id, startToken: session.startToken });
      expect((await api.admin.list({ exams: true })).map((l) => l.exam)).toEqual([{ set: 'U3', preview: true, start: null }]);
    });
  });

  describe('begin: no audio until the start is claimed', () => {
    it('opens an exam session unscored, with no audio, and writes its set on the rules', async () => {
      const api = await load();
      await api.admin.saveSettings({ minAnsweredPct: 75, holdOutsideVoice: true });
      const a = await examForm(api, 'U3', 'A', { pauses: [[20_000, 24_000], [50_000, 54_000]] });
      const session = await api.ana.begin({ labId: a.id, client: 3 });
      expect(session).toMatchObject({
        id: a.id, audioUrl: null, exam: 'U3', examPreview: false, pauses: null, needed: null, minAnsweredPct: 0,
        durationMs: DURATION, requiredThroughMs: REQUIRED,
      });
      const [open] = opens();
      expect(JSON.parse(open.rules!)).toEqual({
        v: 1, pauses: null, pct: 0, floor: 250, requiredThroughMs: REQUIRED, gateMarginDb: 6, holdOutsideVoice: false, exam: 'U3',
      });
      // Nothing is counted yet: opening a form by mistake costs nothing.
      expect(starts()).toEqual([]);
    });

    it('opens practice labs as before, with their audio', async () => {
      const api = await load();
      const lab = await createLab(api);
      const session = await api.ana.begin({ labId: lab.id, client: 3 });
      expect(session).toMatchObject({ audioUrl: lab.audioUrl, exam: null, examPreview: false });
      expect(JSON.parse(opens()[0].rules!)).not.toHaveProperty('exam');
    });

    it('refuses a reload, the same form again, or another form once the start is used, and opens nothing', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const b = await examForm(api, 'U3', 'B');
      const other = await examForm(api, 'U4', 'A');
      const practice = await createLab(api);
      await startedSession(api.ana, ana.id, a.id);
      const opened = opens().length;

      for (const labId of [a.id, b.id]) {
        expect(await refusal(api.ana.begin({ labId, client: 3 }))).toEqual({
          code: 'CONFLICT', message: 'You already started this test. Ask your teacher.', appCode: 'EXAM_USED',
        });
      }
      expect(opens()).toHaveLength(opened);
      // Another set, a practice lab, another student and the teacher are not affected.
      await expect(api.ana.begin({ labId: other.id, client: 3 })).resolves.toMatchObject({ exam: 'U4' });
      await expect(api.ana.begin({ labId: practice.id, client: 3 })).resolves.toMatchObject({ exam: null });
      await expect(api.beto.begin({ labId: b.id, client: 3 })).resolves.toMatchObject({ exam: 'U3' });
      await expect(api.admin.begin({ labId: a.id, client: 3 })).resolves.toMatchObject({ exam: 'U3', examPreview: true, audioUrl: null });
    });
  });

  describe('startExam: the one start', () => {
    it('claims the start, hands out the audio, and records it', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const startedAt = pastStart();
      const session = await openAt(api.ana, a.id, startedAt);
      const before = Date.now();
      const start = await api.ana.startExam({ labId: a.id, startToken: session.startToken });
      expect(start).toMatchObject({ audioUrl: a.audioUrl, examSet: 'U3', preview: false });
      expect(start.startedAt).toBeGreaterThanOrEqual(before);
      expect(starts()).toEqual([{
        id: start.startId, examSet: 'U3', userId: ana.id, labId: a.id, labTitle: 'Examen U3 · Escucha · Forma A',
        sessionStartedAt: startedAt, startedAt: start.startedAt, source: 'start', resetAt: null, resetBy: null,
      }]);

      // A retry of the same session (a lost response) is the same start.
      const again = await api.ana.startExam({ labId: a.id, startToken: session.startToken });
      expect(again).toEqual(start);
      expect(starts()).toHaveLength(1);
    });

    it('refuses a second session, a second tab opened before the start included', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const b = await examForm(api, 'U3', 'B');
      const tab1 = await openAt(api.ana, a.id, pastStart());
      const tab2 = await openAt(api.ana, b.id, pastStart());
      await api.ana.startExam({ labId: a.id, startToken: tab1.startToken });
      expect(await refusal(api.ana.startExam({ labId: b.id, startToken: tab2.startToken })))
        .toEqual({ code: 'CONFLICT', message: 'You already started this test. Ask your teacher.', appCode: 'EXAM_USED' });
      expect(starts()).toHaveLength(1);
    });

    it('gives exactly one of two tabs racing the start', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const b = await examForm(api, 'U3', 'B');
      const tabs = [await openAt(api.ana, a.id, pastStart()), await openAt(api.ana, b.id, pastStart())];
      const results = await Promise.allSettled([
        api.ana.startExam({ labId: a.id, startToken: tabs[0].startToken }),
        api.ana.startExam({ labId: b.id, startToken: tabs[1].startToken }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [lost] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(lost.reason).toMatchObject({ code: 'CONFLICT' });
      expect(starts().filter((s) => s.resetAt === null)).toHaveLength(1);
    });

    it('refuses a session whose lab was changed since it was opened', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const changed = { code: 'BAD_REQUEST', message: 'This test was changed. Reload the page.', appCode: 'EXAM_CHANGED' };

      const moved = await openAt(api.ana, a.id, pastStart());
      await api.admin.update({ id: a.id, examSet: 'U4' });
      expect(await refusal(api.ana.startExam({ labId: a.id, startToken: moved.startToken }))).toEqual(changed);

      const off = await openAt(api.ana, a.id, pastStart());
      await api.admin.update({ id: a.id, examSet: null });
      expect(await refusal(api.ana.startExam({ labId: a.id, startToken: off.startToken }))).toEqual(changed);

      // A session opened as practice, the lab switched to exam afterwards.
      const practice = await openAt(api.ana, a.id, pastStart());
      await api.admin.update({ id: a.id, examSet: 'U3' });
      expect(await refusal(api.ana.startExam({ labId: a.id, startToken: practice.startToken }))).toEqual(changed);
      expect(starts()).toEqual([]);
    });

    it('refuses a bad token and a student outside the groups', async () => {
      const api = await load();
      const p2 = await examForm(api, 'U3', 'A', { groupIds: [PERIOD_2] });
      const carlaSession = await api.carla.begin({ labId: p2.id, client: 3 });
      expect(await refusal(api.carla.startExam({ labId: p2.id, startToken: 'nope' }))).toMatchObject({ code: 'BAD_REQUEST' });
      // Carla's token is not Ana's.
      expect(await refusal(api.ana.startExam({ labId: p2.id, startToken: carlaSession.startToken }))).toMatchObject({ code: 'BAD_REQUEST' });
      const { signLabStart } = await import('../services/labMedia.js');
      expect(await refusal(api.ana.startExam({ labId: p2.id, startToken: signLabStart(p2.id, ana.id, Date.now() - 1000) })))
        .toMatchObject({ code: 'FORBIDDEN' });
      expect(starts()).toEqual([]);
    });

    it('never limits or records the teacher’s preview', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A', { active: false });
      for (let i = 0; i < 2; i += 1) {
        const session = await api.admin.begin({ labId: a.id, client: 3 });
        await expect(api.admin.startExam({ labId: a.id, startToken: session.startToken }))
          .resolves.toMatchObject({ audioUrl: a.audioUrl, examSet: 'U3', startId: null, preview: true });
      }
      expect(starts()).toEqual([]);
    });
  });

  describe('turning a test in', () => {
    it('credits a test heard through, without a microphone or voice, under its set', async () => {
      const api = await load();
      await api.admin.saveSettings({ minAnsweredPct: 75 });
      const a = await examForm(api, 'U3', 'A');
      const { startToken } = await startedSession(api.ana, ana.id, a.id);
      const { result } = await api.ana.submit(turnIn(a.id, startToken, { voicedMs: 40_000, mic: 'on', outsideVoicedMs: 1, outsidePlayedMs: 2 }));
      expect(result).toMatchObject({ credit: true, status: 'done', scored: false, pausesCounted: null, needed: null, mic: 'off' });
      const [row] = await testDb.query.labSubmissions.findMany();
      expect(row).toMatchObject({
        examSet: 'U3', mic: 'off', voicedMs: 0, credit: true, pausesCounted: null, pausesAnswered: null, pauseResults: null,
        outsideVoicedMs: null, outsidePlayedMs: null, minAnsweredPct: 0, heldFor: null, flags: '[]',
      });
      // The teacher's flags leave out No microphone and Little speech.
      const review = await api.admin.submissions({ labId: a.id });
      expect(review.lab.examSet).toBe('U3');
      expect(review.submissions.map((s) => [s.examSet, s.flags, s.status])).toEqual([['U3', [], 'done']]);
      expect((await api.admin.adminList())[0]).toMatchObject({ examSet: 'U3', doneCount: 1, lookCount: 0, flaggedCount: 0 });
    });

    it('refuses a test turned in without a start, and one not heard through', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      // Opened, never started (no audio was handed out), yet a log arrives.
      const startedAt = pastStart();
      const unstarted = await openAt(api.ana, a.id, startedAt);
      await playLog(a.id, ana.id, startedAt);
      expect(await refusal(api.ana.submit(turnIn(a.id, unstarted.startToken)))).toEqual({
        code: 'BAD_REQUEST', message: 'This test was not started. Ask your teacher.', appCode: 'EXAM_NOT_STARTED',
      });

      const short = await startedSession(api.beto, beto.id, a.id, 40_000);
      expect(await refusal(api.beto.submit(turnIn(a.id, short.startToken, { positionMs: 40_000, clientMs: SETUP_MS + 45_000 }))))
        .toMatchObject({ code: 'BAD_REQUEST', message: 'Listen to the whole lab before submitting' });
      expect(count('lab_submissions')).toBe(0);
    });

    it('lets the teacher turn in a preview, and turns practice labs in as before', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const startedAt = pastStart();
      const preview = await openAt(api.admin, a.id, startedAt);
      await api.admin.startExam({ labId: a.id, startToken: preview.startToken });
      await playLog(a.id, adminUser.id, startedAt);
      await expect(api.admin.submit(turnIn(a.id, preview.startToken))).resolves.toMatchObject({ result: { credit: true, mic: 'off' } });

      const practice = await createLab(api);
      const practiceStart = pastStart();
      const session = await openAt(api.ana, practice.id, practiceStart);
      await playLog(practice.id, ana.id, practiceStart);
      await api.ana.submit(turnIn(practice.id, session.startToken, { mic: 'on', voicedMs: 40_000 }));
      expect(await testDb.query.labSubmissions.findFirst({ where: eq(schema.labSubmissions.userId, ana.id) }))
        .toMatchObject({ examSet: null, mic: 'on', voicedMs: 40_000 });
    });
  });

  describe('past plays count when a lab joins a set', () => {
    it('counts a play or a turned-in session, never only opening it, and never the teacher', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'U2 lab 4' });
      // Ana played it; Beto turned it in twice; Carla only opened it; Dani opened it and went on without a microphone.
      const anaStart = pastStart();
      await openAt(api.ana, lab.id, anaStart);
      await playLog(lab.id, ana.id, anaStart, 10_000);
      const betoOld = new Date('2026-09-20T15:00:00.000Z');
      const betoNew = new Date('2026-09-22T15:00:00.000Z');
      for (const startedAt of [betoOld, betoNew]) {
        await testDb.insert(schema.labSubmissions).values({
          labId: lab.id, userId: beto.id, requiredThroughMs: REQUIRED, startedAt, submittedAt: new Date(startedAt.getTime() + 200_000),
          credit: true, flags: '[]',
        });
      }
      // …and played a newer session he never turned in: the turned-in one is counted.
      const betoUnfinished = pastStart();
      await playLog(lab.id, beto.id, betoUnfinished, 5000);
      await openAt(api.carla, lab.id, pastStart());
      const daniStart = pastStart();
      await openAt(api.dani, lab.id, daniStart);
      await testDb.insert(schema.labListenEvents).values({
        labId: lab.id, userId: dani.id, sessionStartedAt: daniStart, kind: 'nomic', positionMs: 0, clientMs: 4000, at: daniStart + 4100,
      });
      const teacherStart = pastStart();
      await openAt(api.admin, lab.id, teacherStart);
      await playLog(lab.id, adminUser.id, teacherStart, 5000);

      await expect(api.admin.update({ id: lab.id, examSet: 'U2' })).resolves.toEqual({ success: true, examSet: 'U2', pastStarts: 2 });
      expect(starts().sort((x, y) => x.userId - y.userId).map((s) => [s.userId, s.sessionStartedAt, s.startedAt, s.source, s.labTitle, s.resetAt]))
        .toEqual([
          [ana.id, anaStart, anaStart, 'past', 'U2 lab 4', null],
          [beto.id, betoNew.getTime(), betoNew.getTime(), 'past', 'U2 lab 4', null],
        ]);

      // They cannot start it again; the make-up students can.
      for (const caller of [api.ana, api.beto]) {
        expect(await refusal(caller.begin({ labId: lab.id, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
      }
      await expect(api.carla.begin({ labId: lab.id, client: 3 })).resolves.toMatchObject({ exam: 'U2' });
      await expect(api.dani.begin({ labId: lab.id, client: 3 })).resolves.toMatchObject({ exam: 'U2' });
    });

    it('charges a student once per set, never again after a reset, and keeps the starts when exam is switched off', async () => {
      const api = await load();
      const lab4 = await createLab(api, { title: 'U2 lab 4' });
      const lab5 = await createLab(api, { title: 'U2 lab 5' });
      for (const lab of [lab4, lab5]) {
        const startedAt = pastStart();
        await openAt(api.ana, lab.id, startedAt);
        await playLog(lab.id, ana.id, startedAt, 5000);
      }
      const betoStart = pastStart();
      await openAt(api.beto, lab5.id, betoStart);
      await playLog(lab5.id, beto.id, betoStart, 5000);

      expect((await api.admin.update({ id: lab4.id, examSet: 'U2' })).pastStarts).toBe(1);
      // Ana already has her start in U2: the second lab adds only Beto.
      expect((await api.admin.update({ id: lab5.id, examSet: 'u2' })).pastStarts).toBe(1);
      expect(starts().map((s) => [s.userId, s.labId])).toEqual([[ana.id, lab4.id], [beto.id, lab5.id]]);

      // Switched off, the starts stay; switched back on, nothing is counted twice.
      await api.admin.update({ id: lab5.id, examSet: null });
      expect(starts()).toHaveLength(2);
      expect((await api.admin.update({ id: lab5.id, examSet: 'U2' })).pastStarts).toBe(0);

      // The teacher reset Beto in U2: a lab joining U2 later does not charge him again.
      await api.admin.resetExamStart({ startId: starts()[1].id });
      await api.admin.update({ id: lab5.id, examSet: null });
      expect((await api.admin.update({ id: lab5.id, examSet: 'U2' })).pastStarts).toBe(0);
      await expect(api.beto.begin({ labId: lab5.id, client: 3 })).resolves.toMatchObject({ exam: 'U2' });
      // Moving to another set charges its players there.
      expect((await api.admin.update({ id: lab5.id, examSet: 'U2 make-up' })).pastStarts).toBe(2);
    });
  });

  describe('plays reported after a lab joined a set count too', () => {
    /** A report from the page's listening log, as the heartbeat sends it. */
    const report = (labId: number, startToken: string, kind: 'play' | 'tick' | 'nomic', positionMs: number) =>
      ({ labId, startToken, kind, positionMs, clientMs: SETUP_MS + positionMs });

    it('a practice page left open when the lab became a test: its first play counts, and it still turns in as practice', async () => {
      const api = await load();
      const lab5 = await createLab(api, { title: 'U2 lab 5' });
      const lab6 = await createLab(api, { title: 'U2 lab 6', examSet: 'U2' });
      // Ana opened the practice lab before it was a test; Beto only opened it.
      const startedAt = pastStart();
      const practice = await openAt(api.ana, lab5.id, startedAt);
      expect(practice).toMatchObject({ exam: null, audioUrl: lab5.audioUrl });
      const betoPractice = await openAt(api.beto, lab5.id, pastStart());
      await expect(api.admin.update({ id: lab5.id, examSet: 'U2' })).resolves.toMatchObject({ pastStarts: 0 });

      // Opening it and going on without a microphone are not playing it.
      await api.beto.heartbeat(report(lab5.id, betoPractice.startToken, 'nomic', 0));
      expect(starts()).toEqual([]);
      // Her page plays it: she has heard the test, and that is her one start in U2.
      await expect(api.ana.heartbeat(report(lab5.id, practice.startToken, 'play', 0))).resolves.toMatchObject({ recorded: true });
      await api.ana.heartbeat(report(lab5.id, practice.startToken, 'tick', 5000));
      expect(starts().map((s) => [s.examSet, s.userId, s.labId, s.sessionStartedAt, s.startedAt, s.source, s.labTitle, s.resetAt]))
        .toEqual([['U2', ana.id, lab5.id, startedAt, startedAt, 'past', 'U2 lab 5', null]]);

      // The session plays on and turns in by its own rules, as practice.
      await playLog(lab5.id, ana.id, startedAt);
      const { result } = await api.ana.submit(turnIn(lab5.id, practice.startToken, { mic: 'on', voicedMs: 40_000 }));
      expect(result).toMatchObject({ credit: true, mic: 'on' });
      expect(await testDb.query.labSubmissions.findFirst()).toMatchObject({ examSet: null, mic: 'on' });
      expect(starts()).toHaveLength(1);

      // Neither form of U2 opens for her any more; Beto, who never played it, can start once.
      for (const labId of [lab5.id, lab6.id]) {
        expect(await refusal(api.ana.begin({ labId, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
      }
      expect((await api.ana.list({ exams: true })).find((l) => l.id === lab6.id)?.exam?.start)
        .toMatchObject({ labId: lab5.id, title: 'U2 lab 5', startedAt, finished: true });
      await expect(api.beto.begin({ labId: lab6.id, client: 3 })).resolves.toMatchObject({ exam: 'U2' });
    });

    it('counts a practice session turned in after its lab became a test, even when none of its reports got through', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'U2 lab 5' });
      const startedAt = pastStart();
      const practice = await openAt(api.ana, lab.id, startedAt);
      await api.admin.update({ id: lab.id, examSet: 'U2' });
      // The log arrives with the turn-in (here: stored directly, never through a heartbeat).
      await playLog(lab.id, ana.id, startedAt);
      await api.ana.submit(turnIn(lab.id, practice.startToken, { mic: 'on', voicedMs: 40_000 }));
      expect(starts().map((s) => [s.examSet, s.userId, s.sessionStartedAt, s.source])).toEqual([['U2', ana.id, startedAt, 'past']]);
      expect(await refusal(api.ana.begin({ labId: lab.id, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
    });

    it('a test whose lab moves to another set mid-play counts in the new set too', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const startedAt = pastStart();
      const session = await openAt(api.ana, a.id, startedAt);
      await api.ana.startExam({ labId: a.id, startToken: session.startToken });
      // The teacher moves the form to U4 while Ana's page waits on Play.
      await expect(api.admin.update({ id: a.id, examSet: 'U4' })).resolves.toMatchObject({ pastStarts: 0 });

      await api.ana.heartbeat(report(a.id, session.startToken, 'play', 0));
      await playLog(a.id, ana.id, startedAt);
      // Her start in U3 covers the turn-in; she has heard U4's form, so U4 counts it.
      await expect(api.ana.submit(turnIn(a.id, session.startToken))).resolves.toMatchObject({ result: { credit: true } });
      expect(starts().map((s) => [s.examSet, s.source, s.sessionStartedAt, s.resetAt])).toEqual([
        ['U3', 'start', startedAt, null],
        ['U4', 'past', startedAt, null],
      ]);
      expect(await refusal(api.ana.begin({ labId: a.id, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
    });

    it('never counts the teacher, never counts one session twice, and a reset of it gives one more start', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'U2 lab 5' });
      const teacherSession = await openAt(api.admin, lab.id, pastStart());
      const startedAt = pastStart();
      const practice = await openAt(api.ana, lab.id, startedAt);
      await api.admin.update({ id: lab.id, examSet: 'U2' });

      await api.admin.heartbeat(report(lab.id, teacherSession.startToken, 'play', 0));
      expect(starts()).toEqual([]);
      await api.ana.heartbeat(report(lab.id, practice.startToken, 'play', 0));
      const [counted] = starts();
      // The teacher resets it while the practice page plays on: its later reports are not counted again.
      await api.admin.resetExamStart({ startId: counted.id });
      await api.ana.heartbeat(report(lab.id, practice.startToken, 'tick', 5000));
      await playLog(lab.id, ana.id, startedAt);
      await api.ana.submit(turnIn(lab.id, practice.startToken, { mic: 'on', voicedMs: 40_000 }));
      expect(starts().map((s) => [s.id, s.resetAt === null])).toEqual([[counted.id, false]]);
      // Her one more start.
      const again = await startedSession(api.ana, ana.id, lab.id);
      expect(again.start.preview).toBe(false);
      expect(starts().filter((s) => s.resetAt === null).map((s) => s.source)).toEqual(['start']);
    });

    it('refuses the playback of a test session that was never started, and stores none of it', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      // A page that still holds the file (a page from before the update, say) plays an unstarted session.
      const session = await api.ana.begin({ labId: a.id, client: 3 });
      expect(session.audioUrl).toBeNull();
      const events = count('lab_listen_events');
      for (const [kind, positionMs] of [['play', 0], ['tick', 5000]] as const) {
        expect(await refusal(api.ana.heartbeat(report(a.id, session.startToken, kind, positionMs)))).toEqual({
          code: 'BAD_REQUEST', message: 'This test was not started. Ask your teacher.', appCode: 'EXAM_NOT_STARTED',
        });
      }
      expect(count('lab_listen_events')).toBe(events);
      expect(starts()).toEqual([]);

      // Once started, the same session's reports are taken.
      await api.ana.startExam({ labId: a.id, startToken: session.startToken });
      await expect(api.ana.heartbeat(report(a.id, session.startToken, 'play', 0))).resolves.toMatchObject({ recorded: true });
      // The teacher's preview needs no start.
      const preview = await api.admin.begin({ labId: a.id, client: 3 });
      await expect(api.admin.heartbeat(report(a.id, preview.startToken, 'play', 0))).resolves.toMatchObject({ recorded: true });
      expect(starts()).toHaveLength(1);
    });
  });

  describe('the teacher’s Reset', () => {
    it('gives exactly one more start, keeps the earlier one, and touches no listening data', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const b = await examForm(api, 'U3', 'B');
      const first = await startedSession(api.ana, ana.id, a.id, 45_000);
      const events = count('lab_listen_events');
      const submissions = count('lab_submissions');

      const before = Date.now();
      const reset = await api.admin.resetExamStart({ startId: first.start.startId! });
      expect(reset).toMatchObject({ startId: first.start.startId, userId: ana.id, examSet: 'U3' });
      expect(reset.resetAt).toBeGreaterThanOrEqual(before);
      expect(starts()).toEqual([expect.objectContaining({ id: first.start.startId, resetAt: reset.resetAt, resetBy: adminUser.id })]);
      expect([count('lab_listen_events'), count('lab_submissions')]).toEqual([events, submissions]);

      // One more start, on any form; then the rule holds again.
      const second = await startedSession(api.ana, ana.id, b.id);
      expect(second.start.startId).not.toBe(first.start.startId);
      expect(await refusal(api.ana.begin({ labId: a.id, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
      expect(starts().map((s) => [s.labId, s.resetAt === null])).toEqual([[a.id, false], [b.id, true]]);
      // The reset session's own retry does not get its start back.
      expect(await refusal(api.ana.startExam({ labId: a.id, startToken: first.startToken }))).toMatchObject({ appCode: 'EXAM_USED' });
    });

    it('refuses a second reset of the same start, an unknown one, and a student', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const { start } = await startedSession(api.ana, ana.id, a.id);
      await api.admin.resetExamStart({ startId: start.startId! });
      expect(await refusal(api.admin.resetExamStart({ startId: start.startId! }))).toEqual({
        code: 'CONFLICT', message: 'This start was already reset. Reload the list.', appCode: 'EXAM_ALREADY_RESET',
      });
      expect(await refusal(api.admin.resetExamStart({ startId: 999 }))).toMatchObject({ code: 'NOT_FOUND', message: 'Start not found' });
      const again = await startedSession(api.ana, ana.id, a.id);
      expect(await refusal(api.ana.resetExamStart({ startId: again.start.startId! }))).toMatchObject({ code: 'FORBIDDEN' });
      expect(starts().filter((s) => s.resetAt === null)).toHaveLength(1);
    });

    it('lets a session the teacher reset mid-play still be turned in', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A');
      const { start, startToken } = await startedSession(api.ana, ana.id, a.id);
      await api.admin.resetExamStart({ startId: start.startId! });
      await expect(api.ana.submit(turnIn(a.id, startToken))).resolves.toMatchObject({ result: { credit: true } });
    });
  });

  describe('the Tests list and a set’s students (Admin › Labs)', () => {
    it('lists each set with its forms and counts, and its roster with every assigned student once', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A', { groupIds: [PERIOD_1] });
      const b = await examForm(api, 'U3', 'B', { groupIds: [PERIOD_2], active: false });
      await examForm(api, 'U10', 'A', { groupIds: [PERIOD_2] });
      await createLab(api, { title: 'Practice' });

      const anaFirst = await startedSession(api.ana, ana.id, a.id, 45_000);
      await api.admin.resetExamStart({ startId: anaFirst.start.startId! });
      const anaSecond = await startedSession(api.ana, ana.id, a.id);
      await api.ana.submit(turnIn(a.id, anaSecond.startToken));
      // Dani (both periods) started form A and got to 0:30.
      await startedSession(api.dani, dani.id, a.id, 30_000);
      // The teacher's preview is never in a roster.
      const preview = await api.admin.begin({ labId: a.id, client: 3 });
      await api.admin.startExam({ labId: a.id, startToken: preview.startToken });

      expect(await api.admin.examSets()).toEqual([
        {
          examSet: 'U3',
          labs: [{ id: a.id, title: 'Examen U3 · Escucha · Forma A', active: true }, { id: b.id, title: 'Examen U3 · Escucha · Forma B', active: false }],
          studentCount: 4, startedCount: 2, finishedCount: 1, resetCount: 1,
        },
        expect.objectContaining({ examSet: 'U10', studentCount: 2, startedCount: 0, finishedCount: 0, resetCount: 0 }),
      ]);

      const roster = await api.admin.examRoster({ examSet: 'u3' });
      expect(roster.examSet).toBe('U3');
      expect(roster.labs).toEqual([
        { id: a.id, title: 'Examen U3 · Escucha · Forma A', active: true, durationMs: DURATION, requiredThroughMs: REQUIRED },
        { id: b.id, title: 'Examen U3 · Escucha · Forma B', active: false, durationMs: DURATION, requiredThroughMs: REQUIRED },
      ]);
      expect(roster.students.map((s) => [s.name, s.assigned, s.current === null, s.earlier.length])).toEqual([
        ['Ana', true, false, 1], ['Beto', true, true, 0], ['Carla', true, true, 0], ['Dani', true, false, 0],
      ]);
      const [anaRow, , , daniRow] = roster.students;
      expect(anaRow).toMatchObject({ userId: ana.id, email: 'ana@example.com' });
      expect(anaRow.current).toEqual({
        startId: anaSecond.start.startId, labId: a.id, labTitle: 'Examen U3 · Escucha · Forma A', source: 'start',
        startedAt: anaSecond.start.startedAt, heardThroughMs: REQUIRED + 5000, durationMs: DURATION, requiredThroughMs: REQUIRED,
        finished: true, lastSeenAt: expect.any(Number), resetAt: null, resetByName: null,
      });
      expect(anaRow.earlier).toEqual([expect.objectContaining({
        startId: anaFirst.start.startId, heardThroughMs: 45_000, finished: false, resetAt: expect.any(Number), resetByName: 'Admin',
        lastSeenAt: anaFirst.startedAt + SETUP_MS + 45_000 + 50,
      })]);
      expect(daniRow.current).toMatchObject({ heardThroughMs: 30_000, finished: false });
    });

    it('filters to one form, keeps a deleted form’s starts, and lists a student who left the groups', async () => {
      const api = await load();
      const a = await examForm(api, 'U3', 'A', { groupIds: [PERIOD_1] });
      const b = await examForm(api, 'U3', 'B', { groupIds: [PERIOD_1] });
      await startedSession(api.ana, ana.id, a.id);
      await startedSession(api.beto, beto.id, b.id);
      // Beto moves to period 2: no longer one of the set's students, but his start stays.
      await testDb.update(schema.userGroups).set({ groupId: PERIOD_2 }).where(eq(schema.userGroups.userId, beto.id));

      const formB = await api.admin.examRoster({ examSet: 'U3', labId: b.id });
      expect(formB.students.map((s) => [s.name, s.assigned, s.current?.labId])).toEqual([['Beto', false, b.id]]);

      // Form A is deleted: Ana's start keeps its title, still counts, and still blocks form B.
      await api.admin.remove({ id: a.id });
      const roster = await api.admin.examRoster({ examSet: 'U3' });
      expect(roster.students.find((s) => s.userId === ana.id)?.current).toMatchObject({
        labId: null, labTitle: 'Examen U3 · Escucha · Forma A', heardThroughMs: null, durationMs: null, requiredThroughMs: null,
        finished: false, lastSeenAt: null,
      });
      expect(await refusal(api.ana.begin({ labId: b.id, client: 3 }))).toMatchObject({ appCode: 'EXAM_USED' });
      expect((await api.ana.list({ exams: true })).find((l) => l.id === b.id)?.exam?.start).toMatchObject({ labId: null, finished: false });
      expect(roster.students.map((s) => s.name)).toEqual(['Ana', 'Beto', 'Dani']);
      expect((await api.admin.examSets())[0]).toMatchObject({ examSet: 'U3', studentCount: 2, startedCount: 2 });
    });

    it('answers an unknown set with no one, and refuses a name that is no set name', async () => {
      const api = await load();
      await expect(api.admin.examRoster({ examSet: '  Nope ' })).resolves.toEqual({ examSet: 'Nope', labs: [], students: [] });
      expect(await refusal(api.admin.examRoster({ examSet: '   ' }))).toMatchObject({ code: 'BAD_REQUEST', appCode: 'EXAM_SET_INVALID' });
      await expect(api.ana.examRoster({ examSet: 'U3' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.examSets()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.admin.examSets()).resolves.toEqual([]);
    });
  });
});
