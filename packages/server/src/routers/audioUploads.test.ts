// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { fileSha256, probeWebm } from '../services/recordingProbe.js';
import { recordingPathForFilename } from '../services/recordings.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { CHROMIUM_TAKE_PAGE_MS, SILENT_TAKE_PAGE_MS, recordingFixture } from '../testUtils/webm.js';

const { client, db: testDb, sqlite } = createTestDb();
const assetsDir = mkdtempSync(join(tmpdir(), 'libresrs-audio-assets-'));

let fileCounter = 0;
const nextRecordingUrl = (ext: string) => {
  fileCounter += 1;
  return `/api/recordings/00000000-0000-4000-8000-${String(fileCounter).padStart(12, '0')}.${ext}`;
};
const writeRecording = vi.fn(async (_buffer: Buffer, ext: string) => nextRecordingUrl(ext));
const deleteRecordings = vi.fn(async (_urls: string[]) => {});
const writeAudioAsset = vi.fn(async (_buffer: Buffer, ext: string) => `/api/assets/0f8fad5b-d9cb-469f-a165-70867728950e.${ext}`);

const admin = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' as const };

const PERIOD_1 = 1;
const PERIOD_2 = 2;
/** For Period 1, with a text to recite. */
const TASK = 10;
/** For every student. */
const OTHER_TASK = 11;
/** Not released yet. */
const HIDDEN_TASK = 12;
/** Its only group was deleted: for nobody. */
const ORPHAN_TASK = 13;
const REFERENCE = 'Había una vez una niña que vivía en el bosque.';

function fakeReq(user: unknown, headers: Record<string, string | undefined>, body?: unknown, params: Record<string, string> = { taskId: String(TASK) }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { user, params, body, get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    payload: undefined as unknown,
    ended: false,
    headersSent: false,
    sentFile: null as null | { path: string; options: { cacheControl?: boolean; headers: Record<string, string> } },
    /** Set to make sendFile fail the way it does when the file is missing. */
    sendFileError: null as Error | null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.payload = body; return this; },
    end() { this.ended = true; return this; },
    sendFile(path: string, options: { headers: Record<string, string> }, done?: (err?: Error) => void) {
      this.sentFile = { path, options };
      done?.(this.sendFileError ?? undefined);
    },
  };
  return res as typeof res & Response;
}

async function load() {
  return import('./audioUploads.js');
}

function recordingHeaders(key = 'rec-0001-abcdef', extra: Record<string, string | undefined> = {}) {
  return {
    'content-type': 'audio/webm;codecs=opus',
    'x-submission-key': key,
    'x-recording-duration-ms': '31400',
    'x-recording-voiced-ms': '24600',
    ...extra,
  };
}

/** A recording already stored, as an earlier upload left it. */
async function storedRecording(taskId: number, userId: number, clientKey: string, submittedAt = new Date('2026-09-01T00:00:00Z')) {
  const [row] = await testDb.insert(schema.speakingSubmissions).values({
    taskId, userId, clientKey, audioUrl: nextRecordingUrl('webm'), mimeType: 'audio/webm', submittedAt,
  }).returning();
  return row;
}

const submissions = () => testDb.query.speakingSubmissions.findMany();

/**
 * A body that begins as a WebM and is not one: the type check lets it through
 * and the probe cannot read it, so it keeps the page's numbers (flagged
 * 'unmeasured'). For the tests about everything but the file.
 */
const webmish = (text: string) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(text)]);

describe('audio upload routes', () => {
  afterAll(async () => { await client.close(); });

  beforeEach(async () => {
    vi.resetModules();
    writeRecording.mockReset();
    writeRecording.mockImplementation(async (_buffer: Buffer, ext: string) => nextRecordingUrl(ext));
    deleteRecordings.mockClear();
    writeAudioAsset.mockClear();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/ai/assetStorage.js', () => ({ writeAudioAsset, getAssetsDir: () => assetsDir }));
    vi.doMock('../services/recordings.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../services/recordings.js')>()),
      writeRecording,
      deleteRecordings,
    }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([{ id: PERIOD_1, name: 'P1' }, { id: PERIOD_2, name: 'P2' }]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 },
      { userId: beto.id, groupId: PERIOD_1 },
      { userId: carla.id, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.speakingTasks).values([
      { id: TASK, title: 'Cuento semana 2', referenceText: REFERENCE, forEveryone: false, active: true, createdBy: 1 },
      { id: OTHER_TASK, title: 'Escalera 1', referenceText: null, forEveryone: true, active: true, createdBy: 1 },
      { id: HIDDEN_TASK, title: 'Escalera 2', forEveryone: true, active: false, createdBy: 1 },
      { id: ORPHAN_TASK, title: 'Deleted period', forEveryone: false, active: true, createdBy: 1 },
    ]);
    await testDb.insert(schema.speakingTaskGroups).values({ taskId: TASK, groupId: PERIOD_1 });
  });

  describe('acceptAudioUpload: refused before the body is read', () => {
    it('refuses anonymous, non-admin (for course audio), non-audio and declared-oversized uploads', async () => {
      const { acceptAudioUpload } = await load();
      const media = acceptAudioUpload({ adminOnly: true, maxBytes: 1000 });
      const cases: [unknown, Record<string, string>, number][] = [
        [undefined, { 'content-type': 'audio/mpeg' }, 401],
        [ana, { 'content-type': 'audio/mpeg' }, 403],
        [admin, { 'content-type': 'text/html' }, 415],
        [admin, {}, 415],
        [admin, { 'content-type': 'audio/mpeg', 'content-length': '1001' }, 413],
      ];
      for (const [user, headers, status] of cases) {
        const next = vi.fn();
        const res = fakeRes();
        media(fakeReq(user, headers), res, next);
        expect(res.statusCode).toBe(status);
        expect(res.payload).toHaveProperty('error');
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('lets through what it cannot refuse yet: the size limit on the body parser takes over', async () => {
      const { acceptAudioUpload } = await load();
      const media = acceptAudioUpload({ adminOnly: true, maxBytes: 1000 });
      for (const headers of [
        { 'content-type': 'audio/mpeg', 'content-length': '1000' },
        { 'content-type': 'audio/mpeg' }, // chunked: no declared length
      ]) {
        const next = vi.fn();
        media(fakeReq(admin, headers), fakeRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
      }
    });

    it('lets a student upload where admin is not required', async () => {
      const { acceptAudioUpload } = await load();
      const next = vi.fn();
      const res = fakeRes();
      acceptAudioUpload({ adminOnly: false, maxBytes: 1000 })(fakeReq(ana, { 'content-type': 'audio/webm;codecs=opus', 'content-length': '10' }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('handleMediaUpload', () => {
    it('puts course audio in the public asset store, not with the students’ recordings', async () => {
      const { handleMediaUpload } = await load();
      const res = fakeRes();
      await handleMediaUpload(fakeReq(admin, { 'content-type': 'audio/mpeg' }, Buffer.from('mp3')), res);

      expect(writeAudioAsset).toHaveBeenCalledWith(Buffer.from('mp3'), 'mp3');
      expect(writeRecording).not.toHaveBeenCalled();
      expect(res.payload).toEqual({ audioUrl: '/api/assets/0f8fad5b-d9cb-469f-a165-70867728950e.mp3', mimeType: 'audio/mpeg', sizeBytes: 3 });
    });

    it('stores the base type, without codec parameters', async () => {
      const { handleMediaUpload } = await load();
      const res = fakeRes();
      await handleMediaUpload(fakeReq(admin, { 'content-type': 'audio/ogg; codecs=opus' }, Buffer.from('ogg!')), res);
      expect(writeAudioAsset).toHaveBeenCalledWith(Buffer.from('ogg!'), 'ogg');
      expect(res.payload).toMatchObject({ mimeType: 'audio/ogg', sizeBytes: 4 });
    });

    it('refuses a non-audio type and an empty or unparsed body', async () => {
      const { handleMediaUpload } = await load();
      const cases: [Record<string, string>, unknown, number][] = [
        [{ 'content-type': 'text/plain' }, Buffer.from('x'), 415],
        [{ 'content-type': 'audio/mpeg' }, Buffer.alloc(0), 400],
        [{ 'content-type': 'audio/mpeg' }, undefined, 400],
        [{ 'content-type': 'audio/mpeg' }, { not: 'a buffer' }, 400],
      ];
      for (const [headers, body, status] of cases) {
        const res = fakeRes();
        await handleMediaUpload(fakeReq(admin, headers, body), res);
        expect(res.statusCode).toBe(status);
      }
      expect(writeAudioAsset).not.toHaveBeenCalled();
    });

    it('answers 500 when the file cannot be written', async () => {
      const { handleMediaUpload } = await load();
      writeAudioAsset.mockRejectedValueOnce(new Error('ENOSPC'));
      const res = fakeRes();
      await handleMediaUpload(fakeReq(admin, { 'content-type': 'audio/mpeg' }, Buffer.from('mp3')), res);
      expect(res.statusCode).toBe(500);
      expect(res.payload).toEqual({ error: 'Upload failed' });
    });
  });

  describe('handleSpeakingSubmission', () => {
    it('stores the recording privately, with the task’s reference text as it read at the time', async () => {
      const { handleSpeakingSubmission } = await load();
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('voice')), res);

      const rows = await submissions();
      expect(rows).toHaveLength(1);
      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({ success: true, submissionId: rows[0].id });
      expect(writeRecording).toHaveBeenCalledWith(webmish('voice'), 'webm');
      const stored = await (writeRecording.mock.results[0].value as Promise<string>);
      expect(rows[0]).toMatchObject({
        taskId: TASK, userId: ana.id, clientKey: 'rec-0001-abcdef', audioUrl: stored, mimeType: 'audio/webm',
        sizeBytes: 9, durationMs: 31_400, voicedMs: 24_600, referenceText: REFERENCE,
        gradeScore: null, gradeDetails: null, gradeFeedback: null, gradedBy: null, gradedAt: null,
      });
      expect(rows[0].audioUrl).toMatch(/^\/api\/recordings\//);
      expect(deleteRecordings).not.toHaveBeenCalled();

      // Editing the task later leaves what this recording is graded against alone.
      await testDb.update(schema.speakingTasks).set({ referenceText: 'Otro texto.' }).where(eq(schema.speakingTasks.id, TASK));
      expect((await submissions())[0].referenceText).toBe(REFERENCE);
    });

    it('stores no reference text for a task without one', async () => {
      const { handleSpeakingSubmission } = await load();
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(carla, recordingHeaders(), webmish('voice'), { taskId: String(OTHER_TASK) }), res);
      expect(res.statusCode).toBe(200);
      expect((await submissions())[0]).toMatchObject({ taskId: OTHER_TASK, userId: carla.id, referenceText: null });
    });

    it('refuses a missing or malformed submission key before writing anything', async () => {
      const { handleSpeakingSubmission } = await load();
      for (const key of [undefined, '', 'short', 'has spaces in it', 'semi;colon-key', `${'x'.repeat(65)}`, '../../../etc']) {
        const res = fakeRes();
        await handleSpeakingSubmission(fakeReq(ana, recordingHeaders('placeholder', { 'x-submission-key': key }), Buffer.from('v')), res);
        expect(res.statusCode).toBe(400);
        expect(res.payload).toEqual({ error: 'Missing submission key' });
      }
      expect(writeRecording).not.toHaveBeenCalled();
      expect(await submissions()).toHaveLength(0);
    });

    it('refuses a bad task id, a non-audio type and an empty body', async () => {
      const { handleSpeakingSubmission } = await load();
      const cases: [Request, number][] = [
        [fakeReq(ana, recordingHeaders(), Buffer.from('v'), { taskId: 'abc' }), 400],
        [fakeReq(ana, recordingHeaders('rec-0001-abcdef', { 'content-type': 'text/plain' }), Buffer.from('v')), 415],
        [fakeReq(ana, recordingHeaders(), Buffer.alloc(0)), 400],
        [fakeReq(ana, recordingHeaders(), undefined), 400],
      ];
      for (const [req, status] of cases) {
        const res = fakeRes();
        await handleSpeakingSubmission(req, res);
        expect(res.statusCode).toBe(status);
      }
      expect(writeRecording).not.toHaveBeenCalled();
    });

    it('refuses a task that is not the student’s (403) and one that is hidden or gone (404)', async () => {
      const { handleSpeakingSubmission } = await load();
      const cases: [typeof ana, number, number][] = [
        [carla, TASK, 403], // another period's task
        [ana, ORPHAN_TASK, 403], // its group was deleted: for nobody
        [ana, HIDDEN_TASK, 404],
        [ana, 9999, 404],
      ];
      for (const [user, taskId, status] of cases) {
        const res = fakeRes();
        await handleSpeakingSubmission(fakeReq(user, recordingHeaders(), Buffer.from('v'), { taskId: String(taskId) }), res);
        expect([taskId, res.statusCode]).toEqual([taskId, status]);
      }
      expect(writeRecording).not.toHaveBeenCalled();
      expect(await submissions()).toHaveLength(0);
    });

    it('lets the teacher record a hidden task to try it', async () => {
      const { handleSpeakingSubmission } = await load();
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(admin, recordingHeaders(), webmish('v'), { taskId: String(HIDDEN_TASK) }), res);
      expect(res.statusCode).toBe(200);
    });

    it('treats a retry with the same key as the same recording, and keeps no second file', async () => {
      const { handleSpeakingSubmission } = await load();
      const first = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('voice')), first);
      const retry = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('voice')), retry);

      const rows = await submissions();
      expect(rows).toHaveLength(1);
      expect(retry.payload).toEqual({ success: true, duplicate: true, submissionId: rows[0].id });
      expect(writeRecording).toHaveBeenCalledTimes(1);
    });

    it('refuses a key already used for another task', async () => {
      const { handleSpeakingSubmission } = await load();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('voice')), fakeRes());
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('voice'), { taskId: String(OTHER_TASK) }), res);

      expect(res.statusCode).toBe(409);
      expect(writeRecording).toHaveBeenCalledTimes(1);
      expect((await submissions()).map((s) => s.taskId)).toEqual([TASK]);
    });

    it('keeps keys per student: two students may happen to choose the same one', async () => {
      const { handleSpeakingSubmission } = await load();
      const a = fakeRes();
      const b = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('ana')), a);
      await handleSpeakingSubmission(fakeReq(beto, recordingHeaders(), webmish('beto')), b);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect((await submissions()).map((s) => s.userId).sort()).toEqual([ana.id, beto.id]);
    });

    it('refuses a recording over the attempt cap without writing it', async () => {
      const { handleSpeakingSubmission } = await load();
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      for (let i = 0; i < MAX_SPEAKING_ATTEMPTS; i++) await storedRecording(TASK, ana.id, `earlier-${i}-key`);

      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(429);
      expect(res.payload).toEqual({ error: expect.stringContaining(`${MAX_SPEAKING_ATTEMPTS} times`) });
      expect(writeRecording).not.toHaveBeenCalled();
      expect(deleteRecordings).not.toHaveBeenCalled();

      // The cap is per task and per student.
      const other = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders('rec-0002-abcdef'), webmish('v'), { taskId: String(OTHER_TASK) }), other);
      const classmate = fakeRes();
      await handleSpeakingSubmission(fakeReq(beto, recordingHeaders(), webmish('v')), classmate);
      expect([other.statusCode, classmate.statusCode]).toEqual([200, 200]);
    });

    it('checks the cap again with the insert, and deletes the file it wrote when the cap was reached meanwhile', async () => {
      const { handleSpeakingSubmission } = await load();
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      for (let i = 0; i < MAX_SPEAKING_ATTEMPTS - 1; i++) await storedRecording(TASK, ana.id, `earlier-${i}-key`);
      // While this recording is written to disk, another one lands and uses the last attempt.
      writeRecording.mockImplementationOnce(async (_buffer: Buffer, ext: string) => {
        await storedRecording(TASK, ana.id, 'the-other-recording');
        return `/api/recordings/00000000-0000-4000-8000-00000000abcd.${ext}`;
      });

      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(429);
      expect(deleteRecordings).toHaveBeenCalledWith(['/api/recordings/00000000-0000-4000-8000-00000000abcd.webm']);
      expect(await submissions()).toHaveLength(MAX_SPEAKING_ATTEMPTS);
    });

    it('holds the cap against recordings turned in together, keeping no file for the refused ones', async () => {
      const { handleSpeakingSubmission } = await load();
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      for (let i = 0; i < MAX_SPEAKING_ATTEMPTS - 1; i++) await storedRecording(TASK, ana.id, `earlier-${i}-key`);
      // Each write yields to the event loop, as a real disk write does.
      writeRecording.mockImplementation(async (_buffer: Buffer, ext: string) => {
        await new Promise((r) => setTimeout(r, 5));
        return nextRecordingUrl(ext);
      });

      const responses = Array.from({ length: 5 }, () => fakeRes());
      await Promise.all(responses.map((res, i) =>
        handleSpeakingSubmission(fakeReq(ana, recordingHeaders(`concurrent-${i}-key`), webmish('v')), res)));

      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 429, 429, 429, 429]);
      const rows = await submissions();
      expect(rows).toHaveLength(MAX_SPEAKING_ATTEMPTS);
      expect(deleteRecordings).toHaveBeenCalledTimes(4);
      const deleted = deleteRecordings.mock.calls.flatMap(([urls]) => urls);
      expect(deleted.filter((url) => rows.some((r) => r.audioUrl === url))).toEqual([]);
    });

    it('keeps no file when a copy of the same upload wins the race to the database', async () => {
      const { handleSpeakingSubmission } = await load();
      let winner: { id: number } | undefined;
      // While this copy writes its file, the other copy's row lands.
      writeRecording.mockImplementationOnce(async (_buffer: Buffer, ext: string) => {
        winner = await storedRecording(TASK, ana.id, 'rec-0001-abcdef');
        return `/api/recordings/00000000-0000-4000-8000-00000000beef.${ext}`;
      });

      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({ success: true, duplicate: true, submissionId: winner!.id });
      expect(deleteRecordings).toHaveBeenCalledWith(['/api/recordings/00000000-0000-4000-8000-00000000beef.webm']);
      expect(await submissions()).toHaveLength(1);
    });

    it('answers a racing copy that used the last attempt as a duplicate, not as over the cap', async () => {
      const { handleSpeakingSubmission } = await load();
      const { MAX_SPEAKING_ATTEMPTS } = await import('./speaking.js');
      for (let i = 0; i < MAX_SPEAKING_ATTEMPTS - 1; i++) await storedRecording(TASK, ana.id, `earlier-${i}-key`);
      writeRecording.mockImplementationOnce(async (_buffer: Buffer, ext: string) => {
        await storedRecording(TASK, ana.id, 'rec-0001-abcdef');
        return `/api/recordings/00000000-0000-4000-8000-00000000cafe.${ext}`;
      });

      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(200);
      expect(res.payload).toMatchObject({ success: true, duplicate: true });
      expect(deleteRecordings).toHaveBeenCalledWith(['/api/recordings/00000000-0000-4000-8000-00000000cafe.webm']);
      expect(await submissions()).toHaveLength(MAX_SPEAKING_ATTEMPTS);
    });

    it('refuses a racing copy of the key that was sent for another task', async () => {
      const { handleSpeakingSubmission } = await load();
      writeRecording.mockImplementationOnce(async (_buffer: Buffer, ext: string) => {
        await storedRecording(OTHER_TASK, ana.id, 'rec-0001-abcdef');
        return `/api/recordings/00000000-0000-4000-8000-00000000f00d.${ext}`;
      });

      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(409);
      expect(deleteRecordings).toHaveBeenCalledWith(['/api/recordings/00000000-0000-4000-8000-00000000f00d.webm']);
      expect((await submissions()).map((s) => s.taskId)).toEqual([OTHER_TASK]);
    });

    it('never credits more voice than the recording is long', async () => {
      const { handleSpeakingSubmission } = await load();
      const cases: [Record<string, string | undefined>, number, number][] = [
        [{ 'x-recording-duration-ms': '30000', 'x-recording-voiced-ms': '90000' }, 30_000, 30_000],
        [{ 'x-recording-duration-ms': undefined, 'x-recording-voiced-ms': '5000' }, 0, 0],
        [{ 'x-recording-duration-ms': 'junk', 'x-recording-voiced-ms': '-1' }, 0, 0],
        [{ 'x-recording-duration-ms': '20000.4', 'x-recording-voiced-ms': '12000.6' }, 20_000, 12_001],
      ];
      for (const [i, [headers, durationMs, voicedMs]] of cases.entries()) {
        const res = fakeRes();
        await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(`clamp-case-${i}`, headers), webmish('v')), res);
        expect(res.statusCode).toBe(200);
        const row = await testDb.query.speakingSubmissions.findFirst({ where: eq(schema.speakingSubmissions.clientKey, `clamp-case-${i}`) });
        expect([row!.durationMs, row!.voicedMs]).toEqual([durationMs, voicedMs]);
      }
    });

    it('answers 500 and keeps no row when the file cannot be written', async () => {
      const { handleSpeakingSubmission } = await load();
      writeRecording.mockRejectedValueOnce(new Error('ENOSPC'));
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      expect(res.statusCode).toBe(500);
      expect(await submissions()).toHaveLength(0);
      // writeRecording cleans up its own partial file; there is nothing here to delete.
      expect(deleteRecordings).not.toHaveBeenCalled();
    });

    it('deletes the file it wrote when the database refuses the row', async () => {
      const { handleSpeakingSubmission } = await load();
      sqlite.exec(`CREATE TRIGGER refuse_recordings BEFORE INSERT ON speaking_submissions BEGIN SELECT RAISE(ABORT, 'database is broken'); END;`);
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(ana, recordingHeaders(), webmish('v')), res);
      sqlite.exec('DROP TRIGGER refuse_recordings');

      expect(res.statusCode).toBe(500);
      expect(res.payload).toEqual({ error: 'Submission failed' });
      expect(deleteRecordings).toHaveBeenCalledWith([await (writeRecording.mock.results[0].value as Promise<string>)]);
    });
  });

  describe('handleSpeakingSubmission: what the file really holds (v1.16.0)', () => {
    const take = recordingFixture('chromium-fake-mic-3s.webm');
    const takeMs = probeWebm(take)!.durationMs;
    const silent = recordingFixture('silent-31s.webm');
    /** The same take's Opus packets in an Ogg, as Firefox can record. */
    const ogg = recordingFixture('chromium-fake-mic-3s.ogg');
    /** AAC in a fragmented MP4 that states no length, the way Safari records. */
    const fragmentedMp4 = recordingFixture('ffmpeg-aac-fragmented-3s.m4a');
    /** AAC in a plain MP4 whose header states 3 s. */
    const plainMp4 = recordingFixture('ffmpeg-aac-3s.m4a');
    const mp3Model = Buffer.from('ID3\x04\x00\x00 an mp3 model, not a recording', 'latin1');
    const rowFor = (clientKey: string) => testDb.query.speakingSubmissions.findFirst({ where: eq(schema.speakingSubmissions.clientKey, clientKey) });
    const flagsOf = async (clientKey: string) => JSON.parse((await rowFor(clientKey))!.flags!) as string[];

    async function upload(user: typeof ana, key: string, body: Buffer, headers: Record<string, string | undefined> = {}, taskId = TASK) {
      const { handleSpeakingSubmission } = await load();
      const res = fakeRes();
      await handleSpeakingSubmission(fakeReq(user, recordingHeaders(key, {
        'x-recording-duration-ms': String(CHROMIUM_TAKE_PAGE_MS), 'x-recording-voiced-ms': '1500', ...headers,
      }), body, { taskId: String(taskId) }), res);
      return res;
    }

    /** The task's model recording: a file in the (temporary) asset store. */
    async function giveModel(taskId: number, bytes: Buffer, ext: string) {
      const name = `00000000-0000-4000-8000-${String(taskId).padStart(8, '0')}${ext === 'mp3' ? '0001' : '0002'}.${ext}`;
      writeFileSync(join(assetsDir, name), bytes);
      await testDb.update(schema.speakingTasks).set({ modelAudioUrl: `/api/assets/${name}` }).where(eq(schema.speakingTasks.id, taskId));
    }

    it('stores the file’s real length, keeps the page’s claims beside it, and flags a claim far longer', async () => {
      const res = await upload(ana, 'long-claim-key', take, { 'x-recording-duration-ms': '45000', 'x-recording-voiced-ms': '45000' });
      expect(res.statusCode).toBe(200);
      expect(Math.abs(takeMs - 3000)).toBeLessThanOrEqual(100);
      expect(await rowFor('long-claim-key')).toMatchObject({
        durationMs: takeMs, voicedMs: takeMs, clientDurationMs: 45_000, clientVoicedMs: 45_000,
        contentSha256: probeWebm(take)!.payloadSha256, flags: '["length-mismatch"]',
      });
    });

    it('flags nothing on an honest take, and says it checked ("[]")', async () => {
      await upload(ana, 'honest-take-key', take);
      expect(await rowFor('honest-take-key')).toMatchObject({
        durationMs: takeMs, voicedMs: 1500, clientDurationMs: CHROMIUM_TAKE_PAGE_MS, clientVoicedMs: 1500, flags: '[]',
      });
    });

    it('flags the same audio posted again: by the student (any task, edited or not) and by a classmate', async () => {
      await upload(ana, 'first-take-key', take);
      // A byte added to the end changes the file, not the audio in it.
      await upload(ana, 'again-other-task', Buffer.concat([take, Buffer.from([7])]), {}, OTHER_TASK);
      await upload(beto, 'betos-copy-key', take);
      await upload(carla, 'carlas-copy-key', take, {}, OTHER_TASK);

      expect(await flagsOf('first-take-key')).toEqual([]);
      expect(await flagsOf('again-other-task')).toEqual(['same-file']);
      expect(await flagsOf('betos-copy-key')).toEqual(['copied']);
      expect(await flagsOf('carlas-copy-key')).toEqual(['copied']);
      // Accepted and stored every time: the teacher sees the attempt.
      expect(await submissions()).toHaveLength(4);
      const rows = await submissions();
      expect(new Set(rows.map((r) => r.contentSha256))).toEqual(new Set([probeWebm(take)!.payloadSha256]));
    });

    it('flags a take that is both the student’s own again and a classmate’s', async () => {
      await upload(beto, 'betos-take-key', take);
      await upload(ana, 'anas-copy-key', take);
      await upload(ana, 'anas-second-copy', take);
      expect(await flagsOf('anas-second-copy')).toEqual(['same-file', 'copied']);
    });

    it('flags the task’s model recording posted as a take: a WebM model, its audio remuxed into Ogg, an MP4 model', async () => {
      await giveModel(TASK, take, 'webm');
      await upload(ana, 'model-webm-key', take);
      expect(await flagsOf('model-webm-key')).toEqual(['model']);
      // The same Opus packets in another container are the same audio (and Ana's take too).
      await upload(beto, 'model-ogg-key', ogg, { 'content-type': 'audio/ogg;codecs=opus' });
      expect(await flagsOf('model-ogg-key')).toEqual(['copied', 'model']);

      await giveModel(OTHER_TASK, plainMp4, 'm4a');
      await upload(carla, 'model-mp4-key', plainMp4, { 'content-type': 'audio/mp4' }, OTHER_TASK);
      expect(await flagsOf('model-mp4-key')).toEqual(['model']);
      expect((await rowFor('model-mp4-key'))!.contentSha256).toBe(fileSha256(plainMp4));
    });

    it('refuses a body that is not a recording, whatever type it is sent as: the task’s mp3 model too, exact or edited', async () => {
      await giveModel(OTHER_TASK, mp3Model, 'mp3');
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(64)]);
      const cases: [string, Buffer, string][] = [
        ['a byte as MP4', Buffer.from('v'), 'audio/mp4'],
        ['junk as Ogg', Buffer.from('OggS not really'), 'audio/ogg'],
        ['a byte as WebM', Buffer.from('v'), 'audio/webm;codecs=opus'],
        ['the mp3 model as MP4', mp3Model, 'audio/mp4'],
        ['the mp3 model and a byte as MP4', Buffer.concat([mp3Model, Buffer.from([0])]), 'audio/mp4'],
        ['the mp3 model as WebM', mp3Model, 'audio/webm'],
        ['the mp3 model as Ogg', mp3Model, 'audio/ogg'],
        ['a wav as WebM', wav, 'video/webm'],
      ];
      for (const [i, [label, body, type]] of cases.entries()) {
        const res = await upload(carla, `refused-body-${i}`, body, {
          'content-type': type, 'x-recording-duration-ms': '30000', 'x-recording-voiced-ms': '28000',
        }, OTHER_TASK);
        expect([label, res.statusCode, res.payload]).toEqual([label, 415, { error: 'Unsupported recording type' }]);
      }
      expect(writeRecording).not.toHaveBeenCalled();
      expect(await submissions()).toHaveLength(0);
    });

    it('reads a WebM sent as audio/ogg or audio/mp4 as the WebM it is: measured, flagged, stored and served as WebM', async () => {
      const longClaim = { 'x-recording-duration-ms': '45000', 'x-recording-voiced-ms': '45000' };
      await upload(ana, 'honest-first-key', take);
      await upload(ana, 'webm-as-ogg-key', take, { 'content-type': 'audio/ogg;codecs=opus', ...longClaim });
      await upload(beto, 'webm-as-mp4-key', take, { 'content-type': 'audio/mp4', ...longClaim });
      const measured = { mimeType: 'audio/webm', durationMs: takeMs, voicedMs: takeMs, clientDurationMs: 45_000, contentSha256: probeWebm(take)!.payloadSha256 };
      expect(await rowFor('webm-as-ogg-key')).toMatchObject({ ...measured, flags: '["same-file","length-mismatch"]' });
      expect(await rowFor('webm-as-mp4-key')).toMatchObject({ ...measured, flags: '["copied","length-mismatch"]' });
      expect(writeRecording.mock.calls.map(([, ext]) => ext)).toEqual(['webm', 'webm', 'webm']);
      expect((await rowFor('webm-as-ogg-key'))!.audioUrl).toMatch(/\.webm$/);
    });

    it('reads every recording by its bytes, whichever of the recorder’s types it came as', async () => {
      const cases: [string, Buffer, string, string, string][] = [
        // key, body, type sent, type stored, extension written
        ['ogg-as-webm-key', ogg, 'audio/webm', 'audio/ogg', 'ogg'],
        ['mp4-as-webm-key', fragmentedMp4, 'video/webm', 'audio/mp4', 'm4a'],
        ['mp4-as-ogg-key', plainMp4, 'audio/ogg', 'audio/mp4', 'm4a'],
        ['webm-as-video-key', take, 'video/webm', 'video/webm', 'webm'],
      ];
      for (const [key, body, type] of cases) {
        expect([key, (await upload(carla, key, body, { 'content-type': type }, OTHER_TASK)).statusCode]).toEqual([key, 200]);
      }
      for (const [key, , , stored] of cases) expect([key, (await rowFor(key))!.mimeType]).toEqual([key, stored]);
      expect(writeRecording.mock.calls.map(([, ext]) => ext)).toEqual(cases.map(([, , , , ext]) => ext));
      // The Ogg's packets were read: its real length, and the WebM take's audio.
      expect(await rowFor('ogg-as-webm-key')).toMatchObject({ durationMs: 3000, contentSha256: probeWebm(take)!.payloadSha256 });
      expect(await rowFor('mp4-as-ogg-key')).toMatchObject({ durationMs: 3000, flags: '[]' });
      expect(await flagsOf('webm-as-video-key')).toEqual(['same-file']);
    });

    it('stores an mp3 behind a made-up ftyp box, flagged unmeasured, with the page’s numbers', async () => {
      await giveModel(OTHER_TASK, mp3Model, 'mp3');
      // The real MP4's first box, then the model: an MP4 by its first bytes, and nothing after them adds up.
      const disguised = Buffer.concat([plainMp4.subarray(0, plainMp4.readUInt32BE(0)), mp3Model]);
      const res = await upload(carla, 'disguised-mp3-key', disguised, {
        'content-type': 'audio/mp4', 'x-recording-duration-ms': '30000', 'x-recording-voiced-ms': '28000',
      }, OTHER_TASK);
      expect(res.statusCode).toBe(200);
      expect(await rowFor('disguised-mp3-key')).toMatchObject({
        mimeType: 'audio/mp4', durationMs: 30_000, voicedMs: 28_000, flags: '["unmeasured"]', contentSha256: fileSha256(disguised),
      });
    });

    it('measures an Ogg by its packets and an MP4 by its header, and flags a page that timed either far longer', async () => {
      const claim = { 'x-recording-duration-ms': '45000', 'x-recording-voiced-ms': '45000' };
      await upload(ana, 'ogg-long-claim', ogg, { 'content-type': 'audio/ogg;codecs=opus', ...claim });
      await upload(beto, 'mp4-long-claim', plainMp4, { 'content-type': 'audio/mp4', ...claim });
      expect(await rowFor('ogg-long-claim')).toMatchObject({
        mimeType: 'audio/ogg', durationMs: 3000, voicedMs: 3000, clientDurationMs: 45_000,
        contentSha256: probeWebm(take)!.payloadSha256, flags: '["length-mismatch"]',
      });
      expect(await rowFor('mp4-long-claim')).toMatchObject({
        mimeType: 'audio/mp4', durationMs: 3000, voicedMs: 3000, clientDurationMs: 45_000, flags: '["length-mismatch"]',
      });
    });

    it('finds an exact copy of an MP4 it cannot read inside', async () => {
      await upload(ana, 'safari-take-key', fragmentedMp4, { 'content-type': 'audio/mp4' });
      await upload(ana, 'safari-again-key', fragmentedMp4, { 'content-type': 'audio/mp4' }, OTHER_TASK);
      expect(await flagsOf('safari-take-key')).toEqual([]);
      expect(await flagsOf('safari-again-key')).toEqual(['same-file']);
    });

    it('stores a take whose model cannot be read, unflagged', async () => {
      await testDb.update(schema.speakingTasks)
        .set({ modelAudioUrl: '/api/assets/00000000-0000-4000-8000-00000000ffff.webm' })
        .where(eq(schema.speakingTasks.id, TASK));
      const res = await upload(ana, 'model-missing-key', take);
      expect(res.statusCode).toBe(200);
      expect(await flagsOf('model-missing-key')).toEqual([]);
    });

    it('refuses what the recorder never makes (mp3, wav, aac) with 415, and takes its WebM, Ogg and MP4', async () => {
      for (const [type, status, body] of [
        ['audio/mpeg', 415, take], ['audio/wav', 415, take], ['audio/x-m4a', 415, fragmentedMp4], ['audio/aac', 415, fragmentedMp4],
        ['audio/opus', 415, ogg], ['video/webm', 200, take], ['audio/ogg;codecs=opus', 200, ogg], ['audio/mp4', 200, fragmentedMp4],
      ] as const) {
        const res = await upload(ana, `type-${type.replace(/[^a-z0-9]/g, '-')}`, body, { 'content-type': type });
        expect([type, res.statusCode]).toEqual([type, status]);
      }
      expect(writeRecording.mock.calls.map(([, ext]) => ext)).toEqual(['webm', 'ogg', 'm4a']);
    });

    it('keeps the page’s numbers where the file gives none: grey "unmeasured" when it cannot be read, nothing for Safari’s MP4', async () => {
      const numbers = { 'x-recording-duration-ms': '31400', 'x-recording-voiced-ms': '24600' };
      const oggPlusOne = Buffer.concat([ogg, Buffer.from([0])]);
      const mp4PlusOne = Buffer.concat([plainMp4, Buffer.from([0])]);
      await upload(ana, 'unreadable-webm', webmish('v'), numbers);
      await upload(ana, 'unreadable-ogg-key', oggPlusOne, { 'content-type': 'audio/ogg', ...numbers });
      await upload(ana, 'unreadable-mp4-key', mp4PlusOne, { 'content-type': 'audio/mp4', ...numbers });
      await upload(ana, 'unprobed-mp4-key', fragmentedMp4, {
        'content-type': 'audio/mp4', 'x-recording-duration-ms': '20000', 'x-recording-voiced-ms': '15000',
      });
      const unmeasured = { durationMs: 31_400, voicedMs: 24_600, clientDurationMs: 31_400, flags: '["unmeasured"]' };
      expect(await rowFor('unreadable-webm')).toMatchObject({ ...unmeasured, contentSha256: fileSha256(webmish('v')) });
      // A byte added: the whole file's fingerprint, so it is no longer the same audio as the take.
      expect(await rowFor('unreadable-ogg-key')).toMatchObject({ ...unmeasured, contentSha256: fileSha256(oggPlusOne) });
      expect(await rowFor('unreadable-mp4-key')).toMatchObject({ ...unmeasured, contentSha256: fileSha256(mp4PlusOne) });
      expect(await rowFor('unprobed-mp4-key')).toMatchObject({ durationMs: 20_000, voicedMs: 15_000, flags: '[]', contentSha256: fileSha256(fragmentedMp4) });
    });

    it('stores no voice for a take of digital silence, flags it little speech, and never matches it as a copy', async () => {
      await upload(ana, 'silent-take-key', silent, { 'x-recording-duration-ms': String(SILENT_TAKE_PAGE_MS), 'x-recording-voiced-ms': '28000' });
      const row = await rowFor('silent-take-key');
      expect(row).toMatchObject({ voicedMs: 0, clientVoicedMs: 28_000, flags: '["little-speech"]' });
      expect(Math.abs(row!.durationMs - SILENT_TAKE_PAGE_MS)).toBeLessThanOrEqual(100);

      // Two muted microphones can make the very same packets: not a copy.
      await upload(ana, 'silent-again-key', silent);
      await upload(beto, 'betos-silence-key', silent);
      expect(await flagsOf('silent-again-key')).toEqual(['little-speech']);
      expect(await flagsOf('betos-silence-key')).toEqual(['little-speech']);
    });

    it('flags little speech by the page’s voice, capped at the file', async () => {
      await upload(ana, 'quiet-take-key', take, { 'x-recording-voiced-ms': '900' });
      await upload(ana, 'fine-take-key', take, { 'x-recording-voiced-ms': '1000' });
      expect(await flagsOf('quiet-take-key')).toEqual(['little-speech']);
      // A third of 3 s: enough.
      expect(await flagsOf('fine-take-key')).toContain('same-file');
      expect(await flagsOf('fine-take-key')).not.toContain('little-speech');
    });

    it('keeps the microphone’s processing the page reports, and nothing else from that header', async () => {
      await upload(ana, 'mic-settings-key', take, {
        'x-mic-settings': JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000, deviceId: 'abc123' }),
      });
      expect(JSON.parse((await rowFor('mic-settings-key'))!.micSettings!)).toEqual({
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000,
      });
      for (const [i, header] of ['not json', '{"deviceId":"x"}', JSON.stringify({ echoCancellation: false, pad: 'x'.repeat(1000) }), undefined].entries()) {
        await upload(beto, `mic-junk-${i}-key`, webmish(`v${i}`), { 'x-mic-settings': header });
        expect((await rowFor(`mic-junk-${i}-key`))!.micSettings).toBeNull();
      }
    });

    it('still answers a retry of the same key as the same recording, with no flag and no second row', async () => {
      await upload(ana, 'retried-take-key', take);
      const retry = await upload(ana, 'retried-take-key', take);
      expect(retry.payload).toMatchObject({ duplicate: true });
      expect(await submissions()).toHaveLength(1);
      expect(await flagsOf('retried-take-key')).toEqual([]);
    });
  });

  describe('handleRecording', () => {
    const file = '00000000-0000-4000-8000-000000000001.ogg';

    beforeEach(async () => {
      await testDb.insert(schema.speakingSubmissions).values({
        taskId: TASK, userId: ana.id, clientKey: 'served-recording', audioUrl: `/api/recordings/${file}`, mimeType: 'audio/ogg',
      });
    });

    it('serves a recording to the student who made it and to the teacher, never cached', async () => {
      const { handleRecording } = await load();
      for (const user of [ana, admin]) {
        const res = fakeRes();
        await handleRecording(fakeReq(user, {}, undefined, { filename: file }), res);
        expect(res.sentFile?.path).toBe(recordingPathForFilename(file));
        expect(res.sentFile?.options.cacheControl).toBe(false);
        expect(res.sentFile?.options.headers).toEqual({ 'Cache-Control': 'private, no-store', 'Content-Type': 'audio/ogg' });
        expect(res.statusCode).toBe(200);
      }
    });

    it('does not reveal another student’s recording, even to a classmate in the same period', async () => {
      const { handleRecording } = await load();
      for (const user of [beto, carla]) {
        const res = fakeRes();
        await handleRecording(fakeReq(user, {}, undefined, { filename: file }), res);
        expect([res.statusCode, res.ended, res.sentFile]).toEqual([404, true, null]);
      }
    });

    it('answers 404 for a name it never issued or has no row for, even to the teacher', async () => {
      const { handleRecording } = await load();
      for (const filename of ['../flashcards.db', `${file}/..`, file.toUpperCase(), '00000000-0000-4000-8000-000000000002.ogg']) {
        const res = fakeRes();
        await handleRecording(fakeReq(admin, {}, undefined, { filename }), res);
        expect([filename, res.statusCode, res.sentFile]).toEqual([filename, 404, null]);
      }
    });

    it('answers 404 when the row is there but the file is gone', async () => {
      const { handleRecording } = await load();
      const res = fakeRes();
      res.sendFileError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      await handleRecording(fakeReq(ana, {}, undefined, { filename: file }), res);
      expect(res.statusCode).toBe(404);
    });

    it('requires a signed-in user', async () => {
      const { handleRecording } = await load();
      const res = fakeRes();
      await handleRecording(fakeReq(undefined, {}, undefined, { filename: file }), res);
      expect(res.statusCode).toBe(401);
      expect(res.sentFile).toBeNull();
    });
  });
});
