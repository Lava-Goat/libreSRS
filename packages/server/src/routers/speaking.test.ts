// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const assetsDir = mkdtempSync(join(tmpdir(), 'libresrs-speaking-assets-'));
const deleteRecordings = vi.fn(async (_urls: string[]) => {});
const writeRecording = vi.fn(async (_buffer: Buffer, ext: string) => `/api/recordings/00000000-0000-4000-8000-00000000dead.${ext}`);

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const PERIOD_1 = 1;
const PERIOD_2 = 2;
const CUENTO = 'Había una vez una niña que vivía en el bosque.';

async function load() {
  const { speakingRouter } = await import('./speaking.js');
  const { adminRouter } = await import('./admin.js');
  const callerFor = (user: AnyUser) => speakingRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return {
    admin: callerFor(adminUser),
    ana: callerFor(ana),
    beto: callerFor(beto),
    carla: callerFor(carla),
    adminApi: adminRouter.createCaller({
      req: { user: adminUser } as unknown as Request, res: {} as Response, user: adminUser, requestId: null,
    }),
  };
}

let assetCounter = 0;
/** A model recording in the (temporary) asset store, as POST /api/media leaves it. */
function uploadedAudio(): string {
  assetCounter += 1;
  const name = `00000000-0000-4000-8000-${String(assetCounter).padStart(12, '0')}.mp3`;
  writeFileSync(join(assetsDir, name), 'mp3');
  return `/api/assets/${name}`;
}

type Callers = Awaited<ReturnType<typeof load>>;
function createTask(api: Callers, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) {
  return api.admin.create({
    title: 'Cuento semana 2',
    instructions: 'Lee el cuento en voz alta.',
    referenceText: CUENTO,
    showReference: true,
    active: true,
    ...overrides,
  });
}

let recordingCounter = 0;
/** A recording as the upload route stores it: the task's text is copied in. */
async function addRecording(taskId: number, userId: number, fields: Partial<typeof schema.speakingSubmissions.$inferInsert> = {}) {
  recordingCounter += 1;
  const [row] = await testDb.insert(schema.speakingSubmissions).values({
    taskId,
    userId,
    clientKey: `recording-${recordingCounter}`,
    audioUrl: `/api/recordings/00000000-0000-4000-8000-${String(recordingCounter).padStart(12, '0')}.webm`,
    mimeType: 'audio/webm',
    sizeBytes: 1000,
    durationMs: 30_000,
    voicedMs: 24_000,
    referenceText: CUENTO,
    submittedAt: new Date('2026-09-25T15:00:00Z'),
    ...fields,
  }).returning();
  return row;
}

const recordingRow = (id: number) => testDb.query.speakingSubmissions.findFirst({ where: eq(schema.speakingSubmissions.id, id) });

/** A recording through the real upload route, which copies in the task's text as it reads now. */
async function uploadRecording(user: AnyUser, taskId: number, submissionKey: string, expectedStatus = 200) {
  const { handleSpeakingSubmission } = await import('./audioUploads.js');
  const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
  await handleSpeakingSubmission({
    user,
    params: { taskId: String(taskId) },
    // It must begin as one of the recorder's containers (else 415); past that, the probe finding no audio keeps the page's length.
    body: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('voice')]),
    get: (name: string) => ({
      'content-type': 'audio/webm;codecs=opus', 'x-submission-key': submissionKey, 'x-recording-duration-ms': '30000',
    } as Record<string, string>)[name.toLowerCase()],
  } as unknown as Request, res as unknown as Response);
  expect(res.statusCode).toBe(expectedStatus);
}

/** How a refusal reads on the page: its code, message and appCode. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; cause?: { appCode?: string } };
    return { code: e.code, message: e.message, appCode: e.cause?.appCode };
  }
  throw new Error('expected a refusal');
}

/** A form of an exam set, written straight to the table: only its set name matters here. */
async function examLab(examSet: string, title = `Escucha ${examSet}`) {
  const [row] = await testDb.insert(schema.labs).values({
    title, audioUrl: '/api/assets/00000000-0000-4000-8000-0000000000aa.mp3', mimeType: 'audio/mpeg',
    durationMs: 100_000, requiredThroughMs: 95_000, forEveryone: true, active: true, createdBy: 1, examSet,
  }).returning();
  return row;
}

describe('speaking router', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    deleteRecordings.mockClear();
    writeRecording.mockClear();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/ai/assetStorage.js', () => ({ getAssetsDir: () => assetsDir }));
    vi.doMock('../services/recordings.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../services/recordings.js')>()),
      deleteRecordings,
      writeRecording,
    }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([
      { id: PERIOD_1, name: 'Español 1 — P1' },
      { id: PERIOD_2, name: 'Español 1 — P2' },
    ]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 },
      { userId: beto.id, groupId: PERIOD_1 },
      { userId: carla.id, groupId: PERIOD_2 },
      { userId: adminUser.id, groupId: PERIOD_1 },
    ]);
  });

  describe('who sees a task', () => {
    it('shows a student the active tasks for their groups or for everyone, in natural order', async () => {
      const api = await load();
      await createTask(api, { title: 'Cuento semana 10', groupIds: [PERIOD_1] });
      await createTask(api, { title: 'Cuento semana 2' });
      await createTask(api, { title: 'Escalera P2', groupIds: [PERIOD_2] });
      await createTask(api, { title: 'Cuento semana 3 (hidden)', active: false });

      expect((await api.ana.list()).map((t) => t.title)).toEqual(['Cuento semana 2', 'Cuento semana 10']);
      expect((await api.carla.list()).map((t) => t.title)).toEqual(['Cuento semana 2', 'Escalera P2']);
    });

    it('refuses a task outside the student’s groups, and one that does not exist', async () => {
      const api = await load();
      const p2 = await createTask(api, { groupIds: [PERIOD_2] });
      await expect(api.ana.get({ taskId: p2.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.carla.get({ taskId: p2.id })).resolves.toMatchObject({ id: p2.id });
      await expect(api.ana.get({ taskId: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('keeps a task from opening up to everyone when its only group is deleted', async () => {
      const api = await load();
      const task = await createTask(api, { title: 'P2 only', groupIds: [PERIOD_2] });
      await api.adminApi.deleteGroup({ id: PERIOD_2 });

      expect(await api.ana.list()).toEqual([]);
      expect(await api.carla.list()).toEqual([]);
      await expect(api.carla.get({ taskId: task.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await api.admin.missing({ taskId: task.id })).toEqual([]);
      const [row] = await api.admin.adminList();
      expect(row).toMatchObject({ forEveryone: false, groupIds: [] });
    });

    it('hides an inactive task from students as if it did not exist', async () => {
      const api = await load();
      const hidden = await createTask(api, { active: false });
      expect(await api.ana.list()).toEqual([]);
      await expect(api.ana.get({ taskId: hidden.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lets the teacher see everything: every group’s tasks, and hidden ones to try', async () => {
      const api = await load();
      const p2 = await createTask(api, { title: 'P2 only', groupIds: [PERIOD_2] });
      const hidden = await createTask(api, { title: 'Hidden', active: false, groupIds: [PERIOD_2] });

      expect((await api.admin.list()).map((t) => t.id)).toEqual([p2.id]);
      await expect(api.admin.get({ taskId: p2.id })).resolves.toMatchObject({ id: p2.id });
      await expect(api.admin.get({ taskId: hidden.id })).resolves.toMatchObject({ id: hidden.id });
      expect((await api.admin.adminList()).map((t) => t.title)).toEqual(['Hidden', 'P2 only']);
    });

    it('reports the student’s own latest recording and attempt count, not anyone else’s', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T15:00:00Z') });
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-26T09:00:00Z') });

      expect(await api.ana.list()).toEqual([{
        id: task.id, title: task.title, targetSeconds: null, submittedAt: new Date('2026-09-26T09:00:00Z'), attempts: 2, littleSpeech: false,
        examSet: null,
      }]);
      expect((await api.beto.list())[0]).toMatchObject({ attempts: 0, submittedAt: null });
    });
  });

  describe('get', () => {
    it('does not send the text to the page when the task is recited from memory', async () => {
      const api = await load();
      const task = await createTask(api, { showReference: false });
      const shown = await api.ana.get({ taskId: task.id });
      expect(shown).toMatchObject({ referenceText: null, recitesFromMemory: true });
      expect(JSON.stringify(shown)).not.toContain('bosque');
      // The teacher's view of the task still has it.
      expect((await api.admin.submissions({ taskId: task.id })).task.referenceText).toBe(CUENTO);
    });

    it('shows the text when the task is read aloud', async () => {
      const api = await load();
      const task = await createTask(api, { showReference: true });
      expect(await api.ana.get({ taskId: task.id })).toMatchObject({ referenceText: CUENTO, recitesFromMemory: false });
    });

    it('does not call a task with no text "from memory"', async () => {
      const api = await load();
      const task = await createTask(api, { showReference: false, referenceText: null });
      expect(await api.ana.get({ taskId: task.id })).toMatchObject({ referenceText: null, recitesFromMemory: false });
    });

    it('returns what the page needs to record', async () => {
      const api = await load();
      const modelAudioUrl = uploadedAudio();
      const task = await createTask(api, { modelAudioUrl, targetSeconds: 45 });
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      expect(await api.ana.get({ taskId: task.id })).toEqual({
        id: task.id,
        title: 'Cuento semana 2',
        instructions: 'Lee el cuento en voz alta.',
        referenceText: CUENTO,
        recitesFromMemory: false,
        modelAudioUrl,
        targetSeconds: 45,
        attempts: 0,
        maxAttempts: MAX_SPEAKING_ATTEMPTS,
        mySubmissions: [],
        examSet: null,
      });
    });

    it('lists the student’s five newest recordings but counts every attempt', async () => {
      const api = await load();
      const task = await createTask(api);
      for (let day = 1; day <= 7; day++) {
        await addRecording(task.id, ana.id, { submittedAt: new Date(`2026-09-0${day}T10:00:00Z`) });
      }
      await addRecording(task.id, beto.id, { submittedAt: new Date('2026-09-20T10:00:00Z') });

      const shown = await api.ana.get({ taskId: task.id });
      expect(shown.attempts).toBe(7);
      expect(shown.mySubmissions.map((s) => s.submittedAt.toISOString().slice(0, 10))).toEqual([
        '2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03',
      ]);
      expect(Object.keys(shown.mySubmissions[0]).sort()).toEqual([
        'audioUrl', 'durationMs', 'feedback', 'gradedAt', 'id', 'littleSpeech', 'score', 'submittedAt',
      ]);
    });
  });

  describe('grades on the student’s own recordings', () => {
    const gradedAt = new Date('2026-09-26T12:00:00Z');

    it('shows the student the teacher’s grade and comment, and never the grader or the details', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, {
        gradeScore: 87.5, gradeFeedback: 'Las "e" muy bien.\nOtra vez la "o".', gradeDetails: '{"vowels":{"e":0.95}}',
        gradedBy: 'teacher', gradedAt,
      });

      const [mine] = (await api.ana.get({ taskId: task.id })).mySubmissions;
      expect(mine).toMatchObject({ score: 87.5, feedback: 'Las "e" muy bien.\nOtra vez la "o".', gradedAt });
      expect(mine).not.toHaveProperty('gradedBy');
      expect(mine).not.toHaveProperty('gradeDetails');
      expect(JSON.stringify(mine)).not.toContain('vowels');
    });

    it('shows a comment the teacher saved before grades reached students', async () => {
      const api = await load();
      const task = await createTask(api);
      // As v1.13 stored it: the teacher's grade and comment, straight in the row.
      await addRecording(task.id, ana.id, { gradeScore: 70, gradeFeedback: 'Más despacio.', gradedBy: 'teacher', gradedAt });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 70, feedback: 'Más despacio.' });
    });

    it('hides an agent’s grade, and a grade with no grader, until the teacher saves one', async () => {
      const api = await load();
      const task = await createTask(api);
      const byAgent = await addRecording(task.id, ana.id, {
        submittedAt: new Date('2026-09-25T15:00:00Z'), gradeScore: 92, gradeFeedback: 'Muy bien', gradeDetails: '{"x":1}',
        gradedBy: 'vowel-agent v1', gradedAt,
      });
      // Only raw SQL can leave the grader empty; it never reaches the student.
      await addRecording(task.id, ana.id, {
        submittedAt: new Date('2026-09-24T15:00:00Z'), gradeScore: 60, gradeFeedback: 'Hmm', gradedBy: null, gradedAt,
      });
      // A teacher's name without a date (half-written by hand) is not a grade either.
      await addRecording(task.id, ana.id, {
        submittedAt: new Date('2026-09-23T15:00:00Z'), gradeScore: 50, gradeFeedback: 'Half', gradedBy: 'teacher', gradedAt: null,
      });

      const hidden = (await api.ana.get({ taskId: task.id })).mySubmissions;
      expect(hidden.map((s) => [s.score, s.feedback, s.gradedAt])).toEqual([
        [null, null, null], [null, null, null], [null, null, null],
      ]);
      expect(JSON.stringify(hidden)).not.toMatch(/vowel-agent|Muy bien|Hmm|Half/);

      // The teacher reviews the agent's grade and saves it as their own.
      await api.admin.grade({ submissionId: byAgent.id, score: 92, feedback: 'Muy bien', gradedBy: 'teacher' });
      const [shown] = (await api.ana.get({ taskId: task.id })).mySubmissions;
      expect(shown).toMatchObject({ id: byAgent.id, score: 92, feedback: 'Muy bien' });
      expect(shown.gradedAt).toBeInstanceOf(Date);
    });

    it('gives nulls once the grade is cleared', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 80, feedback: 'Bien', gradedBy: 'teacher' });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 80, feedback: 'Bien' });

      await api.admin.grade({ submissionId: sub.id, score: null });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: null, feedback: null, gradedAt: null });
    });

    it('shows a grade of 0, and a grade with no comment', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { gradeScore: 0, gradedBy: 'teacher', gradedAt });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 0, feedback: null, gradedAt });
    });

    it('shows each student only their own grades', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1] });
      await addRecording(task.id, ana.id, { gradeScore: 95, gradeFeedback: 'Para Ana', gradedBy: 'teacher', gradedAt });
      const betos = await addRecording(task.id, beto.id);

      const seen = await api.beto.get({ taskId: task.id });
      expect(seen.mySubmissions.map((s) => [s.id, s.score])).toEqual([[betos.id, null]]);
      expect(JSON.stringify(seen)).not.toContain('Para Ana');
    });

    it('leaves the task list as it was: no grades there', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { gradeScore: 95, gradedBy: 'teacher', gradedAt });
      expect(Object.keys((await api.ana.list())[0]).sort())
        .toEqual(['attempts', 'examSet', 'id', 'littleSpeech', 'submittedAt', 'targetSeconds', 'title']);
    });
  });

  describe('a very quiet take (v1.16.0)', () => {
    const quiet = JSON.stringify(['little-speech']);

    it('asks the student, on the list and the task, to record it again; it still counts as turned in', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T15:00:00Z') });
      const latest = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-26T15:00:00Z'), voicedMs: 0, flags: quiet });

      expect((await api.ana.list())[0]).toMatchObject({ submittedAt: latest.submittedAt, attempts: 2, littleSpeech: true });
      const { mySubmissions } = await api.ana.get({ taskId: task.id });
      expect(mySubmissions.map((s) => [s.id, s.littleSpeech])).toEqual([[latest.id, true], [expect.any(Number), false]]);
      // Nobody is missing it: a quiet take is turned in.
      expect(await api.admin.missing({ taskId: task.id })).not.toContainEqual(expect.objectContaining({ id: ana.id }));
    });

    it('asks nothing once a newer take is not quiet, or once the teacher has graded it', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T15:00:00Z'), flags: quiet });
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-26T15:00:00Z'), flags: '[]' });
      expect((await api.ana.list())[0].littleSpeech).toBe(false);

      const betos = await addRecording(task.id, beto.id, { flags: quiet });
      expect((await api.beto.list())[0].littleSpeech).toBe(true);
      // An agent's grade is not the teacher's: the student still hears nothing from it.
      await api.admin.grade({ submissionId: betos.id, score: 40, gradedBy: 'vowel-agent v1' });
      expect((await api.beto.list())[0].littleSpeech).toBe(true);
      await api.admin.grade({ submissionId: betos.id, score: 40, gradedBy: 'teacher' });
      expect((await api.beto.list())[0].littleSpeech).toBe(false);
      expect((await api.beto.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 40, littleSpeech: false });
    });

    it('never tells the student about the teacher’s other checks', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { flags: JSON.stringify(['same-file', 'copied', 'model', 'length-mismatch', 'unmeasured']) });
      const shown = JSON.stringify([await api.ana.list(), await api.ana.get({ taskId: task.id })]);
      expect(shown).not.toMatch(/"(same-file|copied|model|length-mismatch|unmeasured|flags)"/);
      expect((await api.ana.list())[0].littleSpeech).toBe(false);
    });
  });

  describe('create and update', () => {
    it('creates a task for the chosen groups, trimming its text; no group means every student', async () => {
      const api = await load();
      const forP1 = await createTask(api, {
        groupIds: [PERIOD_1, PERIOD_1], instructions: '  Lee en voz alta.  ', referenceText: `  ${CUENTO}\n`,
      });
      expect(forP1).toMatchObject({ forEveryone: false, instructions: 'Lee en voz alta.', referenceText: CUENTO, createdBy: adminUser.id });
      const forAll = await createTask(api, { title: 'Escalera 1', instructions: '   ', referenceText: '' });
      expect(forAll).toMatchObject({ forEveryone: true, instructions: null, referenceText: null });

      const rows = await api.admin.adminList();
      expect(rows.map((t) => [t.title, t.groupIds])).toEqual([['Cuento semana 2', [PERIOD_1]], ['Escalera 1', []]]);
      expect((await api.carla.list()).map((t) => t.title)).toEqual(['Escalera 1']);
    });

    it('refuses a group that does not exist, and writes nothing', async () => {
      const api = await load();
      await expect(createTask(api, { groupIds: [PERIOD_1, 999] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await api.admin.adminList()).toHaveLength(0);

      const task = await createTask(api, { groupIds: [PERIOD_1] });
      await expect(api.admin.update({ id: task.id, groupIds: [PERIOD_2, 999], title: 'Renamed' }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const [row] = await api.admin.adminList();
      expect(row).toMatchObject({ title: 'Cuento semana 2', groupIds: [PERIOD_1], forEveryone: false });
    });

    it('takes model audio only from the asset store, and only a file that is there', async () => {
      const api = await load();
      const missing = '/api/assets/00000000-0000-4000-8000-999999999999.mp3';
      await expect(createTask(api, { modelAudioUrl: 'https://example.com/model.mp3' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(createTask(api, { modelAudioUrl: '/api/recordings/00000000-0000-4000-8000-000000000001.webm' }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(createTask(api, { modelAudioUrl: missing })).rejects.toThrow(/not found/);
      expect(await api.admin.adminList()).toHaveLength(0);

      const task = await createTask(api, { modelAudioUrl: uploadedAudio() });
      await expect(api.admin.update({ id: task.id, modelAudioUrl: missing })).rejects.toThrow(/not found/);
      const replacement = uploadedAudio();
      await api.admin.update({ id: task.id, modelAudioUrl: replacement });
      expect((await api.admin.adminList())[0].modelAudioUrl).toBe(replacement);
      await api.admin.update({ id: task.id, modelAudioUrl: null });
      expect((await api.admin.adminList())[0].modelAudioUrl).toBeNull();
    });

    it('replaces the groups, and toggles between some groups and everyone', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1] });
      expect(await api.carla.list()).toHaveLength(0);

      await api.admin.update({ id: task.id, groupIds: [] });
      expect((await api.admin.adminList())[0]).toMatchObject({ forEveryone: true, groupIds: [] });
      expect((await api.carla.list()).map((t) => t.id)).toEqual([task.id]);

      await api.admin.update({ id: task.id, groupIds: [PERIOD_2] });
      expect((await api.admin.adminList())[0]).toMatchObject({ forEveryone: false, groupIds: [PERIOD_2] });
      expect(await api.ana.list()).toHaveLength(0);
      expect((await api.carla.list()).map((t) => t.id)).toEqual([task.id]);
    });

    it('changes only what it is given', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1], targetSeconds: 60 });

      await api.admin.update({ id: task.id, active: false });
      const [hidden] = await api.admin.adminList();
      expect(hidden).toMatchObject({
        active: false, title: task.title, referenceText: CUENTO, instructions: task.instructions, targetSeconds: 60,
        showReference: true, forEveryone: false, groupIds: [PERIOD_1],
      });

      await api.admin.update({ id: task.id, referenceText: null, instructions: '', showReference: false, targetSeconds: null, title: 'Escalera 1' });
      const [edited] = await api.admin.adminList();
      expect(edited).toMatchObject({ title: 'Escalera 1', referenceText: null, instructions: null, showReference: false, targetSeconds: null, active: false });
    });

    it('refuses to update a task that does not exist', async () => {
      const api = await load();
      await expect(api.admin.update({ id: 9999, active: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('is the teacher’s alone', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await expect(createTask({ ...api, admin: api.ana })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (const call of [
        () => api.ana.update({ id: task.id, active: false }),
        () => api.ana.remove({ id: task.id }),
        () => api.ana.adminList(),
        () => api.ana.submissions({ taskId: task.id }),
        () => api.ana.missing({ taskId: task.id }),
        () => api.ana.grade({ submissionId: sub.id, score: 100 }),
        () => api.ana.forGrading(),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      expect((await api.admin.adminList())[0].active).toBe(true);
      expect((await recordingRow(sub.id))!.gradeScore).toBeNull();
    });
  });

  describe('speaking tests: exam sets (v1.21.0)', () => {
    const stored = async (id: number) =>
      (await testDb.query.speakingTasks.findFirst({ where: eq(schema.speakingTasks.id, id) }))!.examSet;

    it('stores a test in the spelling its set already has, and a task with no set as practice', async () => {
      const api = await load();
      await examLab('U2');
      const test = await createTask(api, { title: 'Examen U2 · Expresión oral', examSet: ' u2 ' });
      expect(test.examSet).toBe('U2');
      expect(await stored(test.id)).toBe('U2');

      const practice = await createTask(api, { title: 'Cuento semana 2' });
      expect(practice.examSet).toBeNull();
      expect((await createTask(api, { title: 'Cuento semana 3', examSet: null })).examSet).toBeNull();
      // A new set is stored as typed, canonical; the next task joins it.
      expect((await createTask(api, { title: 'Oral U3', examSet: 'Final   U3' })).examSet).toBe('Final U3');
      expect((await createTask(api, { title: 'Oral U3 B', examSet: 'final u3' })).examSet).toBe('Final U3');
      expect((await createTask(api, { title: 'Oral 40', examSet: 'x'.repeat(40) })).examSet).toBe('x'.repeat(40));
    });

    it('refuses an empty or too long set name, on create and on update, and writes nothing', async () => {
      const api = await load();
      const task = await createTask(api, { title: 'Oral', examSet: 'U2' });
      for (const examSet of ['', '   ', 'x'.repeat(41)]) {
        expect(await refusal(createTask(api, { title: 'Nope', examSet }))).toEqual({
          code: 'BAD_REQUEST', appCode: 'EXAM_SET_INVALID', message: 'Name the exam set (for example U3), in 40 characters or fewer.',
        });
        expect(await refusal(api.admin.update({ id: task.id, examSet, title: 'Renamed', groupIds: [PERIOD_2] })))
          .toMatchObject({ code: 'BAD_REQUEST', appCode: 'EXAM_SET_INVALID' });
      }
      expect((await api.admin.adminList()).map((t) => [t.title, t.examSet, t.groupIds])).toEqual([['Oral', 'U2', []]]);
    });

    it('sets, changes and clears the set on update, leaving everything else as it was', async () => {
      const api = await load();
      await examLab('U3');
      const task = await createTask(api, { title: 'Oral', groupIds: [PERIOD_1], targetSeconds: 60 });
      const { logger } = await import('../logger.js');
      const info = vi.spyOn(logger, 'info');
      const changes = () => info.mock.calls.map(([fields]) => fields as unknown as { event?: string })
        .filter((fields) => fields.event === 'speaking.exam_set_changed');

      await api.admin.update({ id: task.id, examSet: 'U2' });
      expect(await stored(task.id)).toBe('U2');
      await api.admin.update({ id: task.id, examSet: ' u3' });
      expect(await stored(task.id)).toBe('U3');
      // Missing leaves it; the same name again changes nothing and logs nothing.
      await api.admin.update({ id: task.id, title: 'Oral U3' });
      await api.admin.update({ id: task.id, examSet: 'u3' });
      expect(await stored(task.id)).toBe('U3');
      // null makes it a practice task again.
      await api.admin.update({ id: task.id, examSet: null });
      expect(await stored(task.id)).toBeNull();
      await api.admin.update({ id: task.id, examSet: null });

      expect(changes()).toEqual([
        { event: 'speaking.exam_set_changed', taskId: task.id, from: null, to: 'U2' },
        { event: 'speaking.exam_set_changed', taskId: task.id, from: 'U2', to: 'U3' },
        { event: 'speaking.exam_set_changed', taskId: task.id, from: 'U3', to: null },
      ]);
      info.mockRestore();
      const [row] = await api.admin.adminList();
      expect(row).toMatchObject({
        title: 'Oral U3', targetSeconds: 60, active: true, forEveryone: false, groupIds: [PERIOD_1], examSet: null,
      });

      // Set together with other fields; an empty group list still means every student.
      await api.admin.update({ id: task.id, examSet: 'U2', groupIds: [], active: false });
      expect((await api.admin.adminList())[0]).toMatchObject({ examSet: 'U2', forEveryone: true, groupIds: [], active: false });
    });

    it('lists tests with practice tasks, each with its set, under the same rules for who sees them', async () => {
      const api = await load();
      const practice = await createTask(api, { title: 'Cuento semana 2' });
      const forAll = await createTask(api, { title: 'Examen U2 · Expresión oral', examSet: 'U2' });
      const forP2 = await createTask(api, { title: 'Examen U3 · P2', examSet: 'U3', groupIds: [PERIOD_2] });
      const forBoth = await createTask(api, { title: 'Examen U3 · P1 y P2', examSet: 'U3', groupIds: [PERIOD_1, PERIOD_2] });
      await createTask(api, { title: 'Examen U4 (hidden)', examSet: 'U4', active: false });
      // Its only group is deleted: for nobody, not for everyone.
      await testDb.insert(schema.groups).values({ id: 3, name: 'P3' });
      const orphan = await createTask(api, { title: 'Examen U5 · P3', examSet: 'U5', groupIds: [3] });
      await api.adminApi.deleteGroup({ id: 3 });

      const rows = (list: Awaited<ReturnType<Callers['ana']['list']>>) => list.map((t) => [t.title, t.examSet]);
      expect(rows(await api.ana.list())).toEqual([
        ['Cuento semana 2', null], ['Examen U2 · Expresión oral', 'U2'], ['Examen U3 · P1 y P2', 'U3'],
      ]);
      expect(rows(await api.carla.list())).toEqual([
        ['Cuento semana 2', null], ['Examen U2 · Expresión oral', 'U2'], ['Examen U3 · P1 y P2', 'U3'], ['Examen U3 · P2', 'U3'],
      ]);
      // A student in both groups sees each test once.
      await testDb.insert(schema.userGroups).values({ userId: ana.id, groupId: PERIOD_2 });
      expect((await api.ana.list()).map((t) => t.id)).toEqual([practice.id, forAll.id, forBoth.id, forP2.id]);
      // The teacher sees every active one, whatever its groups (the orphan included); never a hidden one.
      expect((await api.admin.list()).map((t) => t.title)).toEqual([
        'Cuento semana 2', 'Examen U2 · Expresión oral', 'Examen U3 · P1 y P2', 'Examen U3 · P2', 'Examen U5 · P3',
      ]);
      // The same refusals as a practice task.
      await expect(api.beto.get({ taskId: forP2.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.carla.get({ taskId: orphan.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('opens a test like any task, and takes recordings up to the same cap', async () => {
      const api = await load();
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      const test = await createTask(api, { title: 'Examen U2 · Expresión oral', examSet: 'U2', groupIds: [PERIOD_1] });
      expect(await api.ana.get({ taskId: test.id })).toMatchObject({
        id: test.id, examSet: 'U2', referenceText: CUENTO, attempts: 0, maxAttempts: MAX_SPEAKING_ATTEMPTS,
      });
      await uploadRecording(ana, test.id, 'exam-take-0001');
      expect((await api.ana.list())[0]).toMatchObject({ id: test.id, examSet: 'U2', attempts: 1, submittedAt: expect.any(Date) });
      for (let i = 1; i < MAX_SPEAKING_ATTEMPTS - 1; i++) await addRecording(test.id, ana.id);
      await uploadRecording(ana, test.id, 'exam-take-last');
      // One over the cap is refused, exactly as on a practice task.
      await uploadRecording(ana, test.id, 'exam-take-over', 429);
      expect((await api.ana.get({ taskId: test.id })).attempts).toBe(MAX_SPEAKING_ATTEMPTS);
      // The teacher reviews it as before.
      expect((await api.admin.submissions({ taskId: test.id })).submissions).toHaveLength(MAX_SPEAKING_ATTEMPTS);
      expect((await api.admin.adminList())[0]).toMatchObject({ examSet: 'U2', studentCount: 1, ungraded: 1 });
    });

    it('is the teacher’s alone to set', async () => {
      const api = await load();
      const task = await createTask(api);
      await expect(createTask({ ...api, admin: api.ana }, { examSet: 'U2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.update({ id: task.id, examSet: 'U2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await stored(task.id)).toBeNull();
      expect((await api.admin.adminList()).map((t) => t.title)).toEqual([task.title]);
    });
  });

  describe('remove', () => {
    it('deletes the task, its groups and recordings, and the recordings’ files — and nothing of another task’s', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1] });
      const other = await createTask(api, { title: 'Escalera 1' });
      const anas = await addRecording(task.id, ana.id);
      const teachers = await addRecording(task.id, adminUser.id);
      const kept = await addRecording(other.id, ana.id);

      await expect(api.admin.remove({ id: task.id })).resolves.toEqual({ success: true });

      expect((await testDb.query.speakingTasks.findMany()).map((t) => t.id)).toEqual([other.id]);
      expect(await testDb.query.speakingTaskGroups.findMany({ where: eq(schema.speakingTaskGroups.taskId, task.id) })).toHaveLength(0);
      expect((await testDb.query.speakingSubmissions.findMany()).map((s) => s.id)).toEqual([kept.id]);
      expect(deleteRecordings).toHaveBeenCalledTimes(1);
      expect([...deleteRecordings.mock.calls[0][0]].sort()).toEqual([anas.audioUrl, teachers.audioUrl].sort());
    });

    it('succeeds for a task with no recordings', async () => {
      const api = await load();
      const task = await createTask(api);
      await expect(api.admin.remove({ id: task.id })).resolves.toEqual({ success: true });
      expect(await testDb.query.speakingTasks.findMany()).toHaveLength(0);
      expect(deleteRecordings).toHaveBeenCalledWith([]);
    });
  });

  describe('teacher review', () => {
    it('counts students, ungraded recordings and the latest one per task — never the teacher’s own', async () => {
      const api = await load();
      const task = await createTask(api, { title: 'Cuento semana 10', groupIds: [PERIOD_1] });
      const quiet = await createTask(api, { title: 'Cuento semana 2', active: false });
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-24T10:00:00Z'), gradeScore: 80, gradedBy: 'teacher', gradedAt: new Date('2026-09-24T12:00:00Z') });
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T10:00:00Z') });
      await addRecording(task.id, beto.id, { submittedAt: new Date('2026-09-25T11:00:00Z') });
      await addRecording(task.id, adminUser.id, { submittedAt: new Date('2026-09-28T10:00:00Z') });

      const rows = await api.admin.adminList();
      expect(rows.map((t) => [t.title, t.studentCount, t.ungraded, t.lastSubmittedAt])).toEqual([
        ['Cuento semana 2', 0, 0, null],
        ['Cuento semana 10', 2, 2, new Date('2026-09-25T11:00:00Z')],
      ]);
      expect(rows[0].id).toBe(quiet.id);
      expect(rows[1].groupIds).toEqual([PERIOD_1]);
    });

    it('counts as ungraded only each student’s latest recording, the one the review shows', async () => {
      const api = await load();
      const task = await createTask(api);
      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-24T10:00:00Z') });
      const latest = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T10:00:00Z') });
      await api.admin.grade({ submissionId: latest.id, score: 90, gradedBy: 'teacher' });

      // The earlier attempt was never graded, and does not need to be.
      expect((await api.admin.adminList())[0]).toMatchObject({ studentCount: 1, ungraded: 0 });

      await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-26T10:00:00Z') });
      expect((await api.admin.adminList())[0]).toMatchObject({
        studentCount: 1, ungraded: 1, lastSubmittedAt: new Date('2026-09-26T10:00:00Z'),
      });
    });

    it('breaks a tie in time by the newer row, as the review does', async () => {
      const api = await load();
      const task = await createTask(api);
      // Times are stored to the second, so two quick attempts can share one.
      const at = new Date('2026-09-25T10:00:00Z');
      const first = await addRecording(task.id, beto.id, { submittedAt: at });
      const second = await addRecording(task.id, beto.id, { submittedAt: at });

      await api.admin.grade({ submissionId: first.id, score: 70, gradedBy: 'teacher' });
      expect((await api.admin.adminList())[0].ungraded).toBe(1);
      await api.admin.grade({ submissionId: second.id, score: 75, gradedBy: 'teacher' });
      expect((await api.admin.adminList())[0].ungraded).toBe(0);
      expect((await api.admin.submissions({ taskId: task.id })).submissions[0].id).toBe(second.id);
    });

    it('gives each recording the text it was made against, even after the teacher edits the task', async () => {
      const api = await load();
      const task = await createTask(api);
      await uploadRecording(ana, task.id, 'before-the-edit');
      const revised = 'Érase una vez un niño que vivía junto al mar.';
      await api.admin.update({ id: task.id, referenceText: revised });
      await uploadRecording(beto, task.id, 'after-the-edit');

      const { task: info, submissions } = await api.admin.submissions({ taskId: task.id });
      expect(info.referenceText).toBe(revised);
      expect(submissions.map((s) => [s.studentName, s.referenceText])).toEqual([['Ana', CUENTO], ['Beto', revised]]);
    });

    it('lists every recording, by student then newest first, with attempts and grades', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1], targetSeconds: 30 });
      const older = await addRecording(task.id, beto.id, { submittedAt: new Date('2026-09-24T10:00:00Z') });
      const newer = await addRecording(task.id, beto.id, {
        submittedAt: new Date('2026-09-25T10:00:00Z'), gradeScore: 92, gradeDetails: '{"vowels":{"e":0.95}}',
        gradeFeedback: 'Muy bien', gradedBy: 'vowel-agent v1', gradedAt: new Date('2026-09-25T12:00:00Z'),
      });
      const anas = await addRecording(task.id, ana.id);
      const teachers = await addRecording(task.id, adminUser.id);

      const { task: info, submissions } = await api.admin.submissions({ taskId: task.id });
      expect(info).toEqual({ id: task.id, title: task.title, targetSeconds: 30, referenceText: CUENTO, modelAudioUrl: null });
      expect(submissions.map((s) => [s.id, s.studentName, s.attempts, s.isTeacher])).toEqual([
        [teachers.id, 'Admin', 1, true],
        [anas.id, 'Ana', 1, false],
        [newer.id, 'Beto', 2, false],
        [older.id, 'Beto', 2, false],
      ]);
      expect(submissions[2]).toMatchObject({
        audioUrl: newer.audioUrl, durationMs: 30_000, voicedMs: 24_000, studentEmail: 'beto@example.com', referenceText: CUENTO,
        gradeScore: 92, gradeDetails: '{"vowels":{"e":0.95}}', gradeFeedback: 'Muy bien', gradedBy: 'vowel-agent v1',
      });
      expect(submissions[2]).not.toHaveProperty('role');
      await expect(api.admin.submissions({ taskId: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('gives each recording its checks, what the page claimed, and the microphone’s processing', async () => {
      const api = await load();
      const task = await createTask(api);
      const checked = await addRecording(task.id, ana.id, {
        durationMs: 3000, voicedMs: 3000, clientDurationMs: 45_000, clientVoicedMs: 45_000,
        flags: JSON.stringify(['length-mismatch', 'made-up']),
        micSettings: JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000 }),
        contentSha256: 'a'.repeat(64),
      });
      // Recorded before v1.16.0: no checks at all.
      await addRecording(task.id, beto.id);

      const { submissions } = await api.admin.submissions({ taskId: task.id });
      const [anas, betos] = submissions;
      expect(anas).toMatchObject({
        id: checked.id, durationMs: 3000, voicedMs: 3000, clientDurationMs: 45_000, clientVoicedMs: 45_000,
        flags: ['length-mismatch'],
        micSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000 },
        sameFileAs: null, copiedFrom: null,
      });
      // The fingerprint itself stays on the server.
      expect(anas).not.toHaveProperty('contentSha256');
      expect(betos).toMatchObject({ flags: [], clientDurationMs: null, clientVoicedMs: null, micSettings: null, sameFileAs: null, copiedFrom: null });
    });

    it('names the take a copied one matches: the student’s own first, on any task, and another student’s', async () => {
      const api = await load();
      const task = await createTask(api, { title: 'Cuento semana 3' });
      const older = await createTask(api, { title: 'Cuento semana 2' });
      const sha = 'b'.repeat(64);
      const original = await addRecording(older.id, ana.id, { contentSha256: sha, flags: '[]', submittedAt: new Date('2026-09-20T10:00:00Z') });
      const again = await addRecording(task.id, ana.id, { contentSha256: sha, flags: '["same-file"]', submittedAt: new Date('2026-09-25T10:00:00Z') });
      const betos = await addRecording(task.id, beto.id, { contentSha256: sha, flags: '["copied"]', submittedAt: new Date('2026-09-26T10:00:00Z') });
      // Other audio: never named as a match.
      await addRecording(task.id, carla.id, { contentSha256: 'c'.repeat(64), flags: '[]' });

      const { submissions } = await api.admin.submissions({ taskId: task.id });
      const byId = new Map(submissions.map((s) => [s.id, s]));
      expect(byId.get(again.id)).toMatchObject({
        sameFileAs: { submissionId: original.id, taskId: older.id, taskTitle: 'Cuento semana 2', studentName: 'Ana', submittedAt: original.submittedAt },
        copiedFrom: null,
      });
      expect(byId.get(betos.id)).toMatchObject({
        sameFileAs: null,
        copiedFrom: { submissionId: original.id, taskTitle: 'Cuento semana 2', studentName: 'Ana' },
      });

      // The take it matched is gone (its task deleted): the flag stays, unnamed.
      await api.admin.remove({ id: older.id });
      const after = new Map((await api.admin.submissions({ taskId: task.id })).submissions.map((s) => [s.id, s]));
      expect(after.get(again.id)).toMatchObject({ flags: ['same-file'], sameFileAs: null });
      // Beto's copy now matches Ana's second take, still before his.
      expect(after.get(betos.id)).toMatchObject({ copiedFrom: { submissionId: again.id, studentName: 'Ana', taskTitle: 'Cuento semana 3' } });
    });

    it('lists who is missing: the task’s groups’ students, or every student, never the teacher', async () => {
      const api = await load();
      const p1 = await createTask(api, { groupIds: [PERIOD_1] });
      await addRecording(p1.id, ana.id);
      expect(await api.admin.missing({ taskId: p1.id })).toEqual([{ id: beto.id, name: 'Beto', email: 'beto@example.com' }]);

      const everyone = await createTask(api, { title: 'Escalera 1' });
      await addRecording(everyone.id, carla.id);
      expect((await api.admin.missing({ taskId: everyone.id })).map((u) => u.name)).toEqual(['Ana', 'Beto']);
      await expect(api.admin.missing({ taskId: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('grade', () => {
    it('records a grade from the teacher, and one from an agent', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      const before = Math.floor(Date.now() / 1000) * 1000;

      await expect(api.admin.grade({ submissionId: sub.id, score: 87.5, feedback: '  Las "e" muy bien.  ', gradedBy: 'teacher' }))
        .resolves.toEqual({ success: true });
      const byTeacher = (await recordingRow(sub.id))!;
      expect(byTeacher).toMatchObject({ gradeScore: 87.5, gradeDetails: null, gradeFeedback: 'Las "e" muy bien.', gradedBy: 'teacher' });
      expect(byTeacher.gradedAt!.getTime()).toBeGreaterThanOrEqual(before);

      const details = JSON.stringify({ vowels: { a: 0.98, e: 0.91, i: 0.88, o: 0.95, u: 0.7 } });
      await api.admin.grade({ submissionId: sub.id, score: 90, details, gradedBy: 'vowel-agent v1' });
      expect(await recordingRow(sub.id)).toMatchObject({ gradeScore: 90, gradeDetails: details, gradeFeedback: null, gradedBy: 'vowel-agent v1' });
    });

    it('keeps an agent\'s details, and its name, when the teacher saves its grade for the student', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      const vowels = { vowels: { a: 0.98, e: 0.91 } };
      await api.admin.grade({ submissionId: sub.id, score: 88, details: JSON.stringify(vowels), gradedBy: 'vowel-grader v1' });

      // The review page's Save: a score, a comment, and no details.
      await api.admin.grade({ submissionId: sub.id, score: 90, feedback: 'Muy bien', gradedBy: 'teacher' });
      const released = (await recordingRow(sub.id))!;
      expect(released).toMatchObject({ gradeScore: 90, gradeFeedback: 'Muy bien', gradedBy: 'teacher' });
      expect(JSON.parse(released.gradeDetails!)).toEqual({ ...vowels, gradedByAgent: 'vowel-grader v1' });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 90, feedback: 'Muy bien' });

      // Saved again by the teacher: the details stay as they are.
      await api.admin.grade({ submissionId: sub.id, score: 91, gradedBy: 'teacher' });
      expect((await recordingRow(sub.id))!.gradeDetails).toBe(released.gradeDetails);
      // A list of details, or none, keeps the agent's name beside them.
      const other = await addRecording(task.id, beto.id);
      await api.admin.grade({ submissionId: other.id, score: 60, details: '[0.5,0.7]', gradedBy: 'vowel-grader v1' });
      await api.admin.grade({ submissionId: other.id, score: 60, gradedBy: 'teacher' });
      expect(JSON.parse((await recordingRow(other.id))!.gradeDetails!)).toEqual({ gradedByAgent: 'vowel-grader v1', details: [0.5, 0.7] });
      // Details sent as null or '' clear them.
      await api.admin.grade({ submissionId: other.id, score: 60, details: null, gradedBy: 'teacher' });
      expect((await recordingRow(other.id))!.gradeDetails).toBeNull();
    });

    it('clears a grade completely', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 50, details: '{"x":1}', feedback: 'Otra vez', gradedBy: 'agent' });

      await api.admin.grade({ submissionId: sub.id, score: null, details: '{"ignored":true}', feedback: 'ignored' });
      expect(await recordingRow(sub.id)).toMatchObject({ gradeScore: null, gradeDetails: null, gradeFeedback: null, gradedBy: null, gradedAt: null });
      expect((await api.admin.forGrading()).map((r) => r.submissionId)).toEqual([sub.id]);
    });

    it('refuses details that are not JSON, and changes nothing', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 70, gradedBy: 'teacher' });

      for (const details of ['not json', '{"open": ', "{'single': 1}"]) {
        await expect(api.admin.grade({ submissionId: sub.id, score: 95, details, gradedBy: 'vowel-agent v1' }))
          .rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Grade details must be JSON' });
      }
      expect(await recordingRow(sub.id)).toMatchObject({ gradeScore: 70, gradeDetails: null });
    });

    it('stores empty details as no details, so every stored value parses', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 70, details: '', gradedBy: 'vowel-agent v1' });
      expect((await recordingRow(sub.id))!.gradeDetails).toBeNull();
    });

    it('refuses a score outside 0–100, and an empty grader name', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      for (const input of [{ score: 101, gradedBy: 'teacher' }, { score: -1, gradedBy: 'teacher' }, { score: 50, gradedBy: '   ' }]) {
        await expect(api.admin.grade({ submissionId: sub.id, ...input })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect((await recordingRow(sub.id))!.gradeScore).toBeNull();
    });

    it('answers NOT_FOUND for a recording that does not exist', async () => {
      const api = await load();
      await expect(api.admin.grade({ submissionId: 9999, score: 80, gradedBy: 'teacher' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses a score from a grader that does not say who it is, and changes nothing', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 70, feedback: 'Bien', gradedBy: 'teacher' });

      // No default any more: an agent that leaves out its name cannot pass as the teacher.
      await expect(api.admin.grade({ submissionId: sub.id, score: 99, feedback: 'Perfecto' }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Say who graded it (gradedBy).' });
      expect(await recordingRow(sub.id)).toMatchObject({ gradeScore: 70, gradeFeedback: 'Bien', gradedBy: 'teacher' });
      expect((await api.ana.get({ taskId: task.id })).mySubmissions[0]).toMatchObject({ score: 70, feedback: 'Bien' });
    });

    it('clears a grade without a grader name', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await api.admin.grade({ submissionId: sub.id, score: 70, gradedBy: 'vowel-agent v1' });

      await expect(api.admin.grade({ submissionId: sub.id, score: null })).resolves.toEqual({ success: true });
      expect(await recordingRow(sub.id)).toMatchObject({ gradeScore: null, gradedBy: null, gradedAt: null });
    });

    it('does not let a student grade anything, their own recording included', async () => {
      const api = await load();
      const task = await createTask(api);
      const sub = await addRecording(task.id, ana.id);
      await expect(api.ana.grade({ submissionId: sub.id, score: 100 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await recordingRow(sub.id))!.gradeScore).toBeNull();
    });
  });

  describe('forGrading', () => {
    it('hands a grader the ungraded students’ recordings, oldest first, with the text each should match', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1] });
      const later = await addRecording(task.id, beto.id, { submittedAt: new Date('2026-09-25T11:00:00Z') });
      const earlier = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-25T10:00:00Z') });
      const graded = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-24T10:00:00Z') });
      await api.admin.grade({ submissionId: graded.id, score: 80, gradedBy: 'teacher' });
      await addRecording(task.id, adminUser.id, { submittedAt: new Date('2026-09-20T10:00:00Z') });

      const rows = await api.admin.forGrading();
      expect(rows.map((r) => r.submissionId)).toEqual([earlier.id, later.id]);
      expect(rows[0]).toEqual({
        submissionId: earlier.id,
        taskId: task.id,
        taskTitle: task.title,
        studentName: 'Ana',
        studentEmail: 'ana@example.com',
        audioUrl: earlier.audioUrl,
        mimeType: 'audio/webm',
        durationMs: 30_000,
        referenceText: CUENTO,
        submittedAt: new Date('2026-09-25T10:00:00Z'),
        gradeScore: null,
        gradedBy: null,
      });
    });

    it('includes graded recordings when asked, still never the teacher’s', async () => {
      const api = await load();
      const task = await createTask(api);
      const graded = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-24T10:00:00Z') });
      const ungraded = await addRecording(task.id, beto.id);
      await addRecording(task.id, adminUser.id);
      await api.admin.grade({ submissionId: graded.id, score: 80, gradedBy: 'vowel-agent v1' });

      const rows = await api.admin.forGrading({ includeGraded: true });
      expect(rows.map((r) => [r.submissionId, r.gradeScore, r.gradedBy])).toEqual([
        [graded.id, 80, 'vowel-agent v1'],
        [ungraded.id, null, null],
      ]);
    });

    it('narrows to one task, and to a limit', async () => {
      const api = await load();
      const task = await createTask(api);
      const other = await createTask(api, { title: 'Escalera 1' });
      const first = await addRecording(task.id, ana.id, { submittedAt: new Date('2026-09-24T10:00:00Z') });
      await addRecording(task.id, beto.id, { submittedAt: new Date('2026-09-25T10:00:00Z') });
      const elsewhere = await addRecording(other.id, ana.id);

      expect((await api.admin.forGrading({ taskId: other.id })).map((r) => r.submissionId)).toEqual([elsewhere.id]);
      expect((await api.admin.forGrading({ taskId: task.id, limit: 1 })).map((r) => r.submissionId)).toEqual([first.id]);
      expect(await api.admin.forGrading({ taskId: 9999 })).toEqual([]);
    });

    it('grades against the text as it was when the student recorded, even after the teacher edits the task', async () => {
      const api = await load();
      const task = await createTask(api, { groupIds: [PERIOD_1] });
      await uploadRecording(ana, task.id, 'before-the-edit');

      const revised = 'Érase una vez un niño que vivía junto al mar.';
      await api.admin.update({ id: task.id, referenceText: revised });

      const [row] = await api.admin.forGrading();
      expect(row.referenceText).toBe(CUENTO);
      expect((await api.admin.submissions({ taskId: task.id })).task.referenceText).toBe(revised);
      expect((await api.ana.get({ taskId: task.id })).referenceText).toBe(revised);
    });
  });
});
