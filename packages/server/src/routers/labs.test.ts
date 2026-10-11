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
const assetsDir = mkdtempSync(join(tmpdir(), 'libresrs-lab-assets-'));

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const PERIOD_1 = 1;
const PERIOD_2 = 2;

async function load() {
  const { labsRouter } = await import('./labs.js');
  const { adminRouter } = await import('./admin.js');
  const callerFor = (user: AnyUser) => labsRouter.createCaller({
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
/** A lab audio file that exists in the (temporary) asset store, as POST /api/media leaves it. */
function uploadedAudio(): string {
  assetCounter += 1;
  const name = `00000000-0000-4000-8000-${String(assetCounter).padStart(12, '0')}.mp3`;
  writeFileSync(join(assetsDir, name), 'mp3');
  return `/api/assets/${name}`;
}

type Callers = Awaited<ReturnType<typeof load>>;
function createLab(api: Callers, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) {
  return api.admin.create({
    title: 'ES1 Lab semana01',
    audioUrl: uploadedAudio(),
    mimeType: 'audio/mpeg',
    durationMs: 700_000,
    requiredThroughMs: 660_000,
    active: true,
    ...overrides,
  });
}

async function addSubmission(labId: number, userId: number, fields: Partial<typeof schema.labSubmissions.$inferInsert> = {}) {
  // One submission per session: unless told otherwise, each opened 12 minutes before it was turned in.
  const submittedAt = fields.submittedAt ?? new Date('2026-09-25T15:12:00Z');
  const [row] = await testDb.insert(schema.labSubmissions).values({
    labId,
    userId,
    requiredThroughMs: 660_000,
    voicedMs: 95_000,
    listenedCoveredMs: 660_000,
    listenWallMs: 661_000,
    startedAt: new Date(submittedAt.getTime() - 12 * 60_000),
    submittedAt,
    // Credited, as a v1.15 submit writes it: flags are always stored (a row without them is older
    // code's, and counts whatever its credit says: services/labCredit.automaticCredit).
    credit: true,
    flags: '[]',
    ...fields,
  }).returning();
  return row;
}

describe('labs router', () => {
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

  describe('create', () => {
    it('starts labs hidden unless asked, and clamps the listening point to the audio', async () => {
      const api = await load();
      const lab = await createLab(api, { active: undefined, requiredThroughMs: 999_999 });
      expect(lab.active).toBe(false);
      expect(lab.requiredThroughMs).toBe(700_000);
    });

    it('refuses audio that is not in the asset store', async () => {
      const api = await load();
      await expect(createLab(api, { audioUrl: 'https://example.com/lab.mp3' })).rejects.toThrow();
      await expect(createLab(api, { audioUrl: '/api/assets/00000000-0000-4000-8000-999999999999.mp3' }))
        .rejects.toThrow(/not found/);
    });

    it('is admin-only', async () => {
      const api = await load();
      await expect(api.ana.create({
        title: 'x', audioUrl: uploadedAudio(), mimeType: 'audio/mpeg', durationMs: 1000, requiredThroughMs: 500,
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('what students see', () => {
    it('shows active labs for their groups or for everyone, in natural order', async () => {
      const api = await load();
      await createLab(api, { title: 'ES1 Lab semana10', groupIds: [PERIOD_1] });
      await createLab(api, { title: 'ES1 Lab semana2' });
      await createLab(api, { title: 'ES1 Lab semana3', groupIds: [PERIOD_2] });
      await createLab(api, { title: 'ES1 Lab semana4 (hidden)', active: false });

      expect((await api.ana.list()).map((l) => l.title)).toEqual(['ES1 Lab semana2', 'ES1 Lab semana10']);
      expect((await api.carla.list()).map((l) => l.title)).toEqual(['ES1 Lab semana2', 'ES1 Lab semana3']);
    });

    it('lets the teacher see every active lab, whatever the groups', async () => {
      const api = await load();
      await createLab(api, { title: 'P2 only', groupIds: [PERIOD_2] });
      expect((await api.admin.list()).map((l) => l.title)).toEqual(['P2 only']);
    });

    it('reports the student’s own latest submission and attempt count, not anyone else’s', async () => {
      const api = await load();
      const lab = await createLab(api);
      await addSubmission(lab.id, ana.id, { submittedAt: new Date('2026-09-25T15:12:00Z') });
      await addSubmission(lab.id, ana.id, { submittedAt: new Date('2026-09-26T09:00:00Z') });

      const [forAna] = await api.ana.list();
      expect(forAna.attempts).toBe(2);
      expect(forAna.submittedAt).toEqual(new Date('2026-09-26T09:00:00Z'));
      const [forBeto] = await api.beto.list();
      expect(forBeto.attempts).toBe(0);
      expect(forBeto.submittedAt).toBeNull();
    });

    it('does not hand out the audio URL in the list — only when a session begins', async () => {
      const api = await load();
      await createLab(api);
      const [lab] = await api.ana.list();
      expect(lab).not.toHaveProperty('audioUrl');
    });
  });

  describe('begin', () => {
    it('returns the audio, the speech threshold, and a start token the server will accept', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { verifyLabStart } = await import('../services/labMedia.js');

      const before = Date.now();
      const session = await api.ana.begin({ labId: lab.id, client: 3 });
      expect(session.audioUrl).toBe(lab.audioUrl);
      expect(session.minimumVoicedMs).toBe(30_000);
      // Labs are not recorded any more, so there is no recording length to ask for.
      expect(session).not.toHaveProperty('minimumRecordingMs');
      const started = verifyLabStart(session.startToken, lab.id, ana.id, Date.now());
      expect(started).toBeGreaterThanOrEqual(before);
      expect(verifyLabStart(session.startToken, lab.id, beto.id, Date.now())).toBeNull();
    });

    it('refuses a student outside the lab’s groups, and hidden labs', async () => {
      const api = await load();
      const p2 = await createLab(api, { groupIds: [PERIOD_2] });
      const hidden = await createLab(api, { active: false });
      await expect(api.ana.begin({ labId: p2.id, client: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.begin({ labId: hidden.id, client: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lets the teacher try a hidden lab before releasing it', async () => {
      const api = await load();
      const hidden = await createLab(api, { active: false, groupIds: [PERIOD_2] });
      await expect(api.admin.begin({ labId: hidden.id, client: 3 })).resolves.toMatchObject({ id: hidden.id });
    });
  });

  describe('submit', () => {
    const REQUIRED = 660_000;
    /** Mic check and instructions before the audio starts, on the page's clock. */
    const SETUP_MS = 30_000;

    /** A session the server opened at `startedAt`, logged honestly from the start through `upTo`. */
    async function honestSession(labId: number, userId: number, { startedAt = Date.now() - (REQUIRED + 60_000), upTo = REQUIRED } = {}) {
      const { signLabStart } = await import('../services/labMedia.js');
      const rows = [];
      for (let p = 0; p <= upTo; p += 5000) {
        const clientMs = SETUP_MS + p;
        rows.push({
          labId, userId, sessionStartedAt: startedAt, kind: p === 0 ? 'play' as const : 'tick' as const,
          positionMs: p, clientMs, at: startedAt + clientMs + 50,
        });
      }
      await testDb.insert(schema.labListenEvents).values(rows);
      return { startedAt, startToken: signLabStart(labId, userId, startedAt) };
    }

    /** What the page sends when the student turns the lab in: where the audio got to, on its own clock. */
    const turnIn = (labId: number, startToken: string, fields: { positionMs?: number; clientMs?: number; voicedMs?: number } = {}) => ({
      labId,
      startToken,
      positionMs: REQUIRED + 5000,
      clientMs: SETUP_MS + REQUIRED + 5000,
      voicedMs: 95_000,
      listenWallMs: REQUIRED + 5000,
      ...fields,
    });

    const endEntries = () => testDb.query.labListenEvents.findMany({ where: eq(schema.labListenEvents.kind, 'end') });

    it('accepts a session heard through the must-hear point, and keeps the evidence', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      const { startedAt, startToken } = await honestSession(lab.id, ana.id);
      const before = Date.now();

      await expect(api.ana.submit(turnIn(lab.id, startToken))).resolves.toMatchObject({
        success: true,
        // Opened before the pause rule (no rules on an open row): it counts, as it did then.
        result: { credit: true, status: 'done', scored: false, pausesAnswered: null, pausesCounted: null, needed: null, mic: 'on' },
      });

      const rows = await testDb.query.labSubmissions.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        labId: lab.id, userId: ana.id, requiredThroughMs: REQUIRED, voicedMs: 95_000,
        listenedCoveredMs: REQUIRED + 5000, skipCount: 0, listenWallMs: REQUIRED + 5000,
      });
      expect(rows[0].startedAt.getTime()).toBe(startedAt);
      // submitted_at is stored to the second.
      expect(rows[0].submittedAt.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect((await api.ana.list())[0]).toMatchObject({ id: lab.id, attempts: 1 });
    });

    it('writes the page’s final position as the session’s last log entry, clamped to the audio', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startedAt, startToken } = await honestSession(lab.id, ana.id, { startedAt: Date.now() - (REQUIRED + 120_000) });
      const before = Date.now();

      // The page says 999 999 ms into a 700 000 ms file: only the end of the audio is believed.
      await api.ana.submit(turnIn(lab.id, startToken, { positionMs: 999_999, clientMs: SETUP_MS + 700_000 }));

      const ends = await endEntries();
      expect(ends).toHaveLength(1);
      expect(ends[0]).toMatchObject({ userId: ana.id, sessionStartedAt: startedAt, positionMs: 700_000, clientMs: SETUP_MS + 700_000 });
      expect(ends[0].at).toBeGreaterThanOrEqual(before);
      // Unclamped, the jump to 999 999 would have been scored as a skip.
      expect((await testDb.query.labSubmissions.findMany())[0]).toMatchObject({ skipCount: 0, listenedCoveredMs: 700_000 });
    });

    it('does not cost the student a last report lost on a bad connection', async () => {
      const api = await load();
      const lab = await createLab(api);
      // The log stops 10 s short; the final position carries the rest.
      const { startToken } = await honestSession(lab.id, ana.id, { upTo: REQUIRED - 10_000 });
      await expect(api.ana.submit(turnIn(lab.id, startToken))).resolves.toMatchObject({ success: true });
      expect((await testDb.query.labSubmissions.findMany())[0].listenedCoveredMs).toBe(REQUIRED + 5000);
    });

    it('refuses a student who stopped listening part-way, and writes nothing', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await honestSession(lab.id, ana.id, { upTo: 300_000 });

      await expect(api.ana.submit(turnIn(lab.id, startToken, { positionMs: 305_000, clientMs: SETUP_MS + 305_000 })))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/whole lab/) });
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
      expect(await endEntries()).toHaveLength(0);
    });

    it('refuses a page that claims the end when its log shows ten seconds', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await honestSession(lab.id, ana.id, { upTo: 10_000 });
      // The final position jumps from 10 s to the end in 5 s of page time.
      await expect(api.ana.submit(turnIn(lab.id, startToken, { clientMs: SETUP_MS + 15_000 })))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/whole lab/) });
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
      expect(await endEntries()).toHaveLength(0);
    });

    it('refuses a session whose log shows a skip past the middle of the lab', async () => {
      const api = await load();
      const lab = await createLab(api);
      const startedAt = Date.now() - (REQUIRED + 60_000);
      // Plays to 2:10, jumps to 7:40, plays to the end: the timing adds up, the audio does not.
      const rows = [];
      let clientMs = SETUP_MS;
      const push = (kind: 'play' | 'tick' | 'seek', positionMs: number) =>
        rows.push({ labId: lab.id, userId: ana.id, sessionStartedAt: startedAt, kind, positionMs, clientMs, at: startedAt + clientMs + 50 });
      push('play', 0);
      for (let p = 5000; p <= 130_000; p += 5000) { clientMs += 5000; push('tick', p); }
      clientMs += 300;
      push('seek', 460_000);
      for (let p = 465_000; p <= REQUIRED; p += 5000) { clientMs += 5000; push('tick', p); }
      await testDb.insert(schema.labListenEvents).values(rows);
      const { signLabStart } = await import('../services/labMedia.js');

      await expect(api.ana.submit(turnIn(lab.id, signLabStart(lab.id, ana.id, startedAt), { clientMs: clientMs + 5000 })))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/whole lab/) });
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
    });

    it('refuses a submission that arrives sooner than the audio could play, whatever the log says', async () => {
      const api = await load();
      const lab = await createLab(api);
      const startedAt = Date.now() - 60_000;
      const { signLabStart } = await import('../services/labMedia.js');
      // A log that claims the whole lab was heard, in a session opened a minute ago.
      await testDb.insert(schema.labListenEvents).values(Array.from({ length: REQUIRED / 5000 + 1 }, (_, i) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt: startedAt, kind: 'tick' as const,
        positionMs: i * 5000, clientMs: SETUP_MS + i * 5000, at: startedAt + SETUP_MS + i * 5000,
      })));

      await expect(api.ana.submit(turnIn(lab.id, signLabStart(lab.id, ana.id, startedAt))))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/faster than the audio/) });
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
    });

    it('refuses a forged, foreign, misdirected or expired session, and writes nothing', async () => {
      const api = await load();
      const lab = await createLab(api);
      const other = await createLab(api, { title: 'Another lab' });
      const { signLabStart } = await import('../services/labMedia.js');
      const { startedAt, startToken: betoToken } = await honestSession(lab.id, beto.id);
      const [, signature] = signLabStart(lab.id, ana.id, startedAt).split('.');
      const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      await honestSession(lab.id, ana.id, { startedAt: weekAgo });

      for (const startToken of [
        'nonsense',
        betoToken, // Beto's session, turned in by Ana
        signLabStart(other.id, ana.id, startedAt), // Ana's session, but on another lab
        `${startedAt - 3_600_000}.${signature}`, // backdated: the signature no longer matches
        signLabStart(lab.id, ana.id, weekAgo), // too old
        signLabStart(lab.id, ana.id, Date.now() + 60_000), // not started yet
      ]) {
        await expect(api.ana.submit(turnIn(lab.id, startToken)))
          .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/expired/) });
      }
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
      expect(await endEntries()).toHaveLength(0);
    });

    it('treats a retry of the same session as the same submission', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await honestSession(lab.id, ana.id);
      const first = await api.ana.submit(turnIn(lab.id, startToken));

      await expect(api.ana.submit(turnIn(lab.id, startToken, { voicedMs: 1 }))).resolves.toEqual({ success: true, duplicate: true, result: first.result });
      const rows = await testDb.query.labSubmissions.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].voicedMs).toBe(95_000);
      expect(await endEntries()).toHaveLength(1);
    });

    it('keeps one row when copies of the same submit arrive together', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await honestSession(lab.id, ana.id);

      const results = await Promise.all(Array.from({ length: 3 }, () => api.ana.submit(turnIn(lab.id, startToken))));
      expect(results.filter((r) => !('duplicate' in r))).toHaveLength(1);
      expect(results.every((r) => r.success)).toBe(true);
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(1);
      expect(await endEntries()).toHaveLength(1);
    });

    it('caps how many times one student can turn in a lab', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { MAX_ATTEMPTS_PER_LAB } = await import('../services/labMedia.js');
      for (let i = 0; i < MAX_ATTEMPTS_PER_LAB; i++) {
        await addSubmission(lab.id, ana.id, { submittedAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60 * 60_000) });
      }
      const { startToken } = await honestSession(lab.id, ana.id);

      await expect(api.ana.submit(turnIn(lab.id, startToken))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(MAX_ATTEMPTS_PER_LAB);
      expect(await endEntries()).toHaveLength(0);
      // The cap is per student.
      const { startToken: betoToken } = await honestSession(lab.id, beto.id);
      await expect(api.beto.submit(turnIn(lab.id, betoToken))).resolves.toMatchObject({ success: true });
    });

    it('holds the cap against sessions turned in together', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { MAX_ATTEMPTS_PER_LAB } = await import('../services/labMedia.js');
      for (let i = 0; i < MAX_ATTEMPTS_PER_LAB - 1; i++) {
        await addSubmission(lab.id, ana.id, { submittedAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60 * 60_000) });
      }
      const tokens = [];
      for (let i = 0; i < 5; i++) tokens.push((await honestSession(lab.id, ana.id, { startedAt: Date.now() - (REQUIRED + 60_000) - i * 1000 })).startToken);

      const results = await Promise.allSettled(tokens.map((token) => api.ana.submit(turnIn(lab.id, token))));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      }
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(MAX_ATTEMPTS_PER_LAB);
      expect(await endEntries()).toHaveLength(1);
    });

    it('answers a retry that races the last allowed attempt as the same submission, not as over the cap', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { MAX_ATTEMPTS_PER_LAB } = await import('../services/labMedia.js');
      for (let i = 0; i < MAX_ATTEMPTS_PER_LAB - 1; i++) {
        await addSubmission(lab.id, ana.id, { submittedAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60 * 60_000) });
      }
      const { startToken } = await honestSession(lab.id, ana.id);

      const results = await Promise.allSettled(Array.from({ length: 3 }, () => api.ana.submit(turnIn(lab.id, startToken))));
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(MAX_ATTEMPTS_PER_LAB);
    });

    it('never credits more speech than the time that has passed', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startedAt, startToken } = await honestSession(lab.id, ana.id);

      await api.ana.submit(turnIn(lab.id, startToken, { voicedMs: 24 * 60 * 60 * 1000 }));
      const after = Date.now();
      const [row] = await testDb.query.labSubmissions.findMany();
      expect(row.voicedMs).toBeGreaterThanOrEqual(REQUIRED + 60_000);
      expect(row.voicedMs).toBeLessThanOrEqual(after - startedAt);
    });

    it('shows the teacher the flags built from what was stored', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await honestSession(lab.id, ana.id);
      await api.ana.submit(turnIn(lab.id, startToken, { voicedMs: 2_000 }));

      const { submissions } = await api.admin.submissions({ labId: lab.id });
      expect(submissions.map((s) => [s.studentName, s.flags])).toEqual([['Ana', ['little-speech']]]);
    });

    it('refuses a lab that is not assigned to the student, or has been hidden', async () => {
      const api = await load();
      const p1 = await createLab(api, { groupIds: [PERIOD_1] });
      // Carla is in P2, with a genuine session of her own on the P1 lab.
      const { startToken: carlaToken } = await honestSession(p1.id, carla.id);
      await expect(api.carla.submit(turnIn(p1.id, carlaToken))).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const { startToken } = await honestSession(p1.id, ana.id);
      await api.admin.update({ id: p1.id, active: false });
      await expect(api.ana.submit(turnIn(p1.id, startToken))).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.ana.submit(turnIn(9999, startToken))).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await testDb.query.labSubmissions.findMany()).toHaveLength(0);
      expect(await endEntries()).toHaveLength(0);
    });

    it('lets the teacher turn in a hidden lab to try it', async () => {
      const api = await load();
      const lab = await createLab(api, { active: false, groupIds: [PERIOD_2] });
      const { startToken } = await honestSession(lab.id, adminUser.id);
      await expect(api.admin.submit(turnIn(lab.id, startToken))).resolves.toMatchObject({ success: true });
    });
  });

  describe('update and remove', () => {
    it('replaces groups, toggles visibility, and clamps a new listening point', async () => {
      const api = await load();
      const lab = await createLab(api, { active: false, groupIds: [PERIOD_1] });
      await api.admin.update({ id: lab.id, active: true, groupIds: [PERIOD_2], requiredThroughMs: 10_000_000 });

      const [row] = (await api.admin.adminList()).filter((l) => l.id === lab.id);
      expect(row.active).toBe(true);
      expect(row.groupIds).toEqual([PERIOD_2]);
      expect(row.requiredThroughMs).toBe(700_000);
      expect(await api.ana.list()).toHaveLength(0);
    });

    it('deletes the lab with its groups, submissions and listening log, and nothing of another lab’s', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      const other = await createLab(api, { groupIds: [PERIOD_1] });
      await addSubmission(lab.id, ana.id);
      await addSubmission(other.id, ana.id);
      await api.ana.begin({ labId: lab.id, client: 3 });

      await expect(api.admin.remove({ id: lab.id })).resolves.toEqual({ success: true });

      expect(await testDb.query.labs.findMany()).toMatchObject([{ id: other.id }]);
      expect(await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.labId, lab.id) })).toHaveLength(0);
      expect(await testDb.query.labGroups.findMany({ where: eq(schema.labGroups.labId, lab.id) })).toHaveLength(0);
      expect(await testDb.query.labListenEvents.findMany({ where: eq(schema.labListenEvents.labId, lab.id) })).toHaveLength(0);
      expect(await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.labId, other.id) })).toHaveLength(1);
    });

    it('is admin-only', async () => {
      const api = await load();
      const lab = await createLab(api);
      await expect(api.ana.remove({ id: lab.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await testDb.query.labs.findMany()).toHaveLength(1);
    });
  });

  describe('teacher review', () => {
    it('flags skips and sessions with little speech, per student, newest first', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      await addSubmission(lab.id, ana.id, { voicedMs: 5_000, submittedAt: new Date('2026-09-25T15:12:00Z') });
      await addSubmission(lab.id, ana.id, { voicedMs: 95_000, submittedAt: new Date('2026-09-26T09:00:00Z') });
      await addSubmission(lab.id, beto.id, { voicedMs: 3_000, skipCount: 2 });

      const { lab: info, submissions } = await api.admin.submissions({ labId: lab.id });
      expect(info.minimumVoicedMs).toBe(30_000);
      expect(info).not.toHaveProperty('minimumRecordingMs');
      expect(submissions.map((s) => [s.studentName, s.flags])).toEqual([
        ['Ana', []],
        ['Ana', ['little-speech']],
        ['Beto', ['skipped', 'little-speech']],
      ]);
      expect(submissions[2].skipCount).toBe(2);
      expect(submissions[0].attempts).toBe(2);
      expect(submissions[0]).toMatchObject({ voicedMs: 95_000, listenedCoveredMs: 660_000, listenWallMs: 661_000 });
    });

    it('has nothing to play back: labs keep no recording', async () => {
      const api = await load();
      const lab = await createLab(api);
      await addSubmission(lab.id, ana.id);
      const { submissions } = await api.admin.submissions({ labId: lab.id });
      for (const gone of ['audioUrl', 'durationMs', 'segments', 'mimeType']) expect(submissions[0]).not.toHaveProperty(gone);
    });

    it('computes elapsed time from the server-signed start', async () => {
      const api = await load();
      const lab = await createLab(api);
      await addSubmission(lab.id, ana.id, {
        startedAt: new Date('2026-09-25T15:00:00Z'), submittedAt: new Date('2026-09-25T15:12:30Z'),
      });
      const { submissions } = await api.admin.submissions({ labId: lab.id });
      expect(submissions[0].elapsedMs).toBe(12.5 * 60_000);
    });

    it('lists who is missing: the lab’s groups’ students, never the teacher', async () => {
      const api = await load();
      const p1 = await createLab(api, { groupIds: [PERIOD_1] });
      await addSubmission(p1.id, ana.id);
      expect((await api.admin.missing({ labId: p1.id })).map((u) => u.name)).toEqual(['Beto']);

      const everyone = await createLab(api);
      expect((await api.admin.missing({ labId: everyone.id })).map((u) => u.name)).toEqual(['Ana', 'Beto', 'Carla']);
    });
  });

  describe('listening log', () => {
    it('stamps each report with the server’s clock and ties it to the session', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
      const before = Date.now();
      await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'play', positionMs: 0, clientMs: 30_000 });
      await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 5_000, clientMs: 35_000 });

      const rows = await testDb.query.labListenEvents.findMany();
      expect(rows.map((r) => [r.userId, r.kind, r.positionMs, r.clientMs])).toEqual([
        [ana.id, 'open', 0, 0],
        [ana.id, 'play', 0, 30_000],
        [ana.id, 'tick', 5_000, 35_000],
      ]);
      expect(rows[1].at).toBeGreaterThanOrEqual(before);
      expect(new Set(rows.map((r) => r.sessionStartedAt))).toEqual(new Set([Number(startToken.split('.')[0])]));
    });

    it('refuses reports without a valid session, including another student’s', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
      await expect(api.beto.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 1, clientMs: 1 }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.ana.heartbeat({ labId: lab.id, startToken: 'nonsense', kind: 'tick', positionMs: 1, clientMs: 1 }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await testDb.query.labListenEvents.findMany()).map((e) => e.kind)).toEqual(['open']);
    });

    it('holds the per-session cap against a burst of concurrent reports', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
      const { MAX_LISTEN_EVENTS } = await import('../services/labMedia.js');
      await Promise.all(Array.from({ length: MAX_LISTEN_EVENTS + 200 }, (_, i) =>
        api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: i, clientMs: i })));
      // The session's 'open' row counts toward it too.
      expect(await testDb.query.labListenEvents.findMany()).toHaveLength(MAX_LISTEN_EVENTS);
    });

    it('stops storing a session’s reports at the cap', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
      const { MAX_LISTEN_EVENTS } = await import('../services/labMedia.js');
      const sessionStartedAt = Number(startToken.split('.')[0]);
      await testDb.insert(schema.labListenEvents).values(Array.from({ length: MAX_LISTEN_EVENTS }, (_, i) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt, kind: 'tick' as const, positionMs: i, clientMs: i, at: sessionStartedAt + i,
      })));
      await expect(api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: MAX_LISTEN_EVENTS, clientMs: MAX_LISTEN_EVENTS }))
        .resolves.toEqual({ recorded: false });
      // One already stored, sent again, is recorded.
      await expect(api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 1, clientMs: 1 }))
        .resolves.toMatchObject({ recorded: true });
      expect(await testDb.query.labListenEvents.findMany()).toHaveLength(MAX_LISTEN_EVENTS + 1);
    });

    it('shows the teacher how far a student got who never submitted', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      const sessionStartedAt = Date.parse('2026-09-25T15:00:00Z');
      await testDb.insert(schema.labListenEvents).values([0, 5000, 10_000, 15_000].map((p) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt, kind: p === 0 ? 'play' as const : 'tick' as const,
        positionMs: p, clientMs: 20_000 + p, at: sessionStartedAt + 20_000 + p + 100,
      })));

      const missing = await api.admin.missing({ labId: lab.id });
      expect(missing.map((m) => [m.name, m.heardThroughMs, m.lastSeenAt])).toEqual([
        ['Ana', 15_000, sessionStartedAt + 35_100],
        ['Beto', null, null],
      ]);
    });

    it('gives the teacher the full log, newest session first, marking the one that was submitted', async () => {
      const api = await load();
      const lab = await createLab(api);
      const first = Date.parse('2026-09-24T15:00:00Z');
      const second = Date.parse('2026-09-25T15:00:00Z');
      for (const sessionStartedAt of [first, second]) {
        await testDb.insert(schema.labListenEvents).values([0, 5000].map((p) => ({
          labId: lab.id, userId: ana.id, sessionStartedAt, kind: 'tick' as const, positionMs: p, clientMs: 1000 + p, at: sessionStartedAt + 1000 + p,
        })));
      }
      await addSubmission(lab.id, ana.id, { startedAt: new Date(second) });

      const log = await api.admin.listenLog({ labId: lab.id, userId: ana.id });
      expect(log.map((s) => [s.startedAt, s.submitted, s.events.length, s.summary.heardThroughMs])).toEqual([
        [second, true, 2, 5000],
        [first, false, 2, 5000],
      ]);
      expect(Object.keys(log[0].events[0]).sort()).toEqual(['answers', 'at', 'clientMs', 'kind', 'positionMs']);
    });
  });

  describe('audience', () => {
    it('keeps a lab from opening up to everyone when its only group is deleted', async () => {
      const api = await load();
      const lab = await createLab(api, { title: 'P2 only', groupIds: [PERIOD_2] });
      await api.adminApi.deleteGroup({ id: PERIOD_2 });

      expect(await api.ana.list()).toEqual([]);
      expect(await api.carla.list()).toEqual([]);
      await expect(api.ana.begin({ labId: lab.id, client: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await api.admin.missing({ labId: lab.id })).toEqual([]);
      const [row] = await api.admin.adminList();
      expect(row).toMatchObject({ forEveryone: false, groupIds: [] });
      const { rowCount } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'labs' });
      expect(rowCount).toBe(0);
    });

    it('makes a lab for everyone only when no group is chosen', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      expect((await api.carla.list())).toHaveLength(0);
      await api.admin.update({ id: lab.id, groupIds: [] });
      expect((await api.carla.list()).map((l) => l.id)).toEqual([lab.id]);
    });

    it('refuses a group that does not exist, and changes nothing', async () => {
      const api = await load();
      await expect(createLab(api, { groupIds: [PERIOD_1, 999] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await api.admin.adminList()).toHaveLength(0);

      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      await expect(api.admin.update({ id: lab.id, groupIds: [PERIOD_2, 999] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const [row] = await api.admin.adminList();
      expect(row.groupIds).toEqual([PERIOD_1]);
      expect(row.forEveryone).toBe(false);
    });
  });

  describe('the teacher’s own test runs', () => {
    it('are shown as the teacher’s but never counted as a student turning the lab in', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      await addSubmission(lab.id, adminUser.id);

      const [row] = await api.admin.adminList();
      expect(row.studentCount).toBe(0);
      const { submissions } = await api.admin.submissions({ labId: lab.id });
      expect(submissions.map((s) => [s.studentName, s.isTeacher])).toEqual([['Admin', true]]);
      await addSubmission(lab.id, ana.id);
      expect((await api.admin.adminList())[0].studentCount).toBe(1);
    });
  });

  describe('opening a lab', () => {
    it('is logged, so "never opened" and "never started" can be told apart', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      await api.ana.begin({ labId: lab.id, client: 3 });

      const missing = await api.admin.missing({ labId: lab.id });
      expect(missing.map((m) => [m.name, m.opened, m.started, m.heardThroughMs])).toEqual([
        ['Ana', true, false, null],
        ['Beto', false, false, null],
      ]);
      const log = await api.admin.listenLog({ labId: lab.id, userId: ana.id });
      expect(log).toHaveLength(1);
      expect(log[0].started).toBe(false);
      expect(log[0].events.map((e) => e.kind)).toEqual(['open']);
    });

    it('is capped per student per day', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { MAX_OPENS_PER_DAY } = await import('../services/labMedia.js');
      const now = Date.now();
      await testDb.insert(schema.labListenEvents).values(Array.from({ length: MAX_OPENS_PER_DAY }, (_, i) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt: now - i, kind: 'open' as const, positionMs: 0, clientMs: 0, at: now - i,
      })));
      await expect(api.ana.begin({ labId: lab.id, client: 3 })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      await expect(api.beto.begin({ labId: lab.id, client: 3 })).resolves.toMatchObject({ id: lab.id });
    });

    it('holds the daily cap against a burst of concurrent opens (a batched request runs them together)', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { MAX_OPENS_PER_DAY } = await import('../services/labMedia.js');
      const results = await Promise.allSettled(Array.from({ length: MAX_OPENS_PER_DAY + 20 }, () => api.ana.begin({ labId: lab.id, client: 3 })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_OPENS_PER_DAY);
      const opens = await testDb.query.labListenEvents.findMany({ where: eq(schema.labListenEvents.kind, 'open') });
      expect(opens).toHaveLength(MAX_OPENS_PER_DAY);
    });

    it('stops accepting reports for a lab the teacher has hidden', async () => {
      const api = await load();
      const lab = await createLab(api);
      const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
      await api.admin.update({ id: lab.id, active: false });
      await expect(api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 1, clientMs: 1 }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('does not let one student’s flood of sessions push a classmate’s log out', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      const anaStart = Date.parse('2026-09-23T15:00:00Z');
      await testDb.insert(schema.labListenEvents).values(Array.from({ length: 81 }, (_, i) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt: anaStart, kind: i === 0 ? 'play' as const : 'tick' as const,
        positionMs: i * 5000, clientMs: 20_000 + i * 5000, at: anaStart + 20_000 + i * 5000 + 100,
      })));
      // Beto: 60 later sessions of 1,000 rows each.
      const flood = [];
      for (let sIdx = 0; sIdx < 60; sIdx++) {
        const start = Date.parse('2026-09-25T15:00:00Z') + sIdx * 60_000_000;
        for (let i = 0; i < 1000; i++) {
          flood.push({ labId: lab.id, userId: beto.id, sessionStartedAt: start, kind: 'tick' as const, positionMs: i, clientMs: i, at: start + i });
        }
      }
      for (let i = 0; i < flood.length; i += 1000) await testDb.insert(schema.labListenEvents).values(flood.slice(i, i + 1000));

      const missing = await api.admin.missing({ labId: lab.id });
      expect(missing.find((m) => m.name === 'Ana')).toMatchObject({ opened: true, started: true, heardThroughMs: 400_000, skips: 0 });
    });

    it('reports the furthest any attempt got, not only the latest', async () => {
      const api = await load();
      const lab = await createLab(api, { groupIds: [PERIOD_1] });
      const yesterday = Date.parse('2026-09-24T15:00:00Z');
      const today = Date.parse('2026-09-25T15:00:00Z');
      const run = (sessionStartedAt: number, upTo: number) => Array.from({ length: upTo / 5000 + 1 }, (_, i) => ({
        labId: lab.id, userId: ana.id, sessionStartedAt, kind: i === 0 ? 'play' as const : 'tick' as const,
        positionMs: i * 5000, clientMs: 20_000 + i * 5000, at: sessionStartedAt + 20_000 + i * 5000 + 100,
      }));
      await testDb.insert(schema.labListenEvents).values([...run(yesterday, 400_000), ...run(today, 5000)]);
      const [anaRow] = await api.admin.missing({ labId: lab.id });
      expect(anaRow).toMatchObject({ name: 'Ana', started: true, heardThroughMs: 400_000 });
      expect(anaRow.lastSeenAt).toBe(today + 25_100);
    });
  });

  describe('sessions are told apart to the millisecond', () => {
    it('marks only the session that was actually submitted, even if another opened in the same second', async () => {
      const api = await load();
      const lab = await createLab(api);
      const second = Date.parse('2026-09-25T15:00:00Z');
      for (const start of [second + 100, second + 900]) {
        await testDb.insert(schema.labListenEvents).values({
          labId: lab.id, userId: ana.id, sessionStartedAt: start, kind: 'open', positionMs: 0, clientMs: 0, at: start,
        });
      }
      await addSubmission(lab.id, ana.id, { startedAt: new Date(second + 900) });
      const log = await api.admin.listenLog({ labId: lab.id, userId: ana.id });
      expect(log.map((s) => [s.startedAt - second, s.submitted])).toEqual([[900, true], [100, false]]);
    });
  });

  describe('a submission is judged by the threshold it was accepted under', () => {
    it('keeps its flags and export evidence when the teacher later edits the lab', async () => {
      const api = await load();
      // Accepted under a 200 s lab, where 20 s of speech is plenty (the minimum is 10 s)...
      const lab = await createLab(api, { groupIds: [PERIOD_1], requiredThroughMs: 200_000 });
      await addSubmission(lab.id, ana.id, { requiredThroughMs: 200_000, listenedCoveredMs: 200_000, voicedMs: 20_000 });
      // ...which would be too little under the lab as it is now (the minimum is 30 s).
      await api.admin.update({ id: lab.id, requiredThroughMs: 700_000 });

      const { submissions } = await api.admin.submissions({ labId: lab.id });
      expect(submissions[0].flags).toEqual([]);
      expect(submissions[0].requiredThroughMs).toBe(200_000);
      const { groupLabsCsv } = await import('../services/labExport.js');
      const { csv } = groupLabsCsv(PERIOD_1);
      expect(csv.split('\n')[1]).toMatch(/,done,.*,200,200,0,.*,20,10,,,,on,auto,"","",$/);
      // A missing student is measured against the lab as it is now.
      expect(csv.split('\n')[2]).toMatch(/^"Beto".*,missing,,0,,700,,,,,30,,,,,,,,$/);
    });
  });

  describe('group CSV export', () => {
    it('has a row per student per released lab, missing ones included, with the evidence and flags', async () => {
      const api = await load();
      const lab1 = await createLab(api, { title: 'ES1 Lab semana01', groupIds: [PERIOD_1] });
      await createLab(api, { title: 'ES1 Lab semana02 (not released)', active: false });
      await createLab(api, { title: 'P2 lab', groupIds: [PERIOD_2] });
      await addSubmission(lab1.id, ana.id, { voicedMs: 2_000 });

      // The labs dataset is built by services/labExport.ts (admin's exportGroupData calls it).
      const { groupLabsCsv } = await import('../services/labExport.js');
      const { csv, rowCount } = groupLabsCsv(PERIOD_1);
      const [header, ...rows] = csv.split('\n');
      expect(header).toBe('student_name,student_email,lab,status,submitted_at,attempts,heard_through_s,required_through_s,skips,started_at,elapsed_s,voice_s,min_voice_s,pauses_answered,pauses_counted,needed,mic,credit_by,flags,held_for,level_only_answered');
      expect(rowCount).toBe(2);
      // A row turned in before the pause rule: it kept its credit (the migration set it).
      expect(rows[0]).toBe('"Ana","ana@example.com","ES1 Lab semana01",done,"2026-09-25T15:12:00.000Z",1,660,660,0,"2026-09-25T15:00:00.000Z",720,2,30,,,,on,auto,"little-speech","",');
      expect(rows[1]).toBe('"Beto","beto@example.com","ES1 Lab semana01",missing,,0,,660,,,,,30,,,,,,,,');
      // Every row has a value (or a blank) for every column.
      for (const row of rows) expect(row.split(',')).toHaveLength(header.split(',').length);
    });

    it('keeps a hidden lab in the export once someone in the group has turned it in', async () => {
      const api = await load();
      const lab = await createLab(api, { active: false, groupIds: [PERIOD_1] });
      await addSubmission(lab.id, beto.id);
      const { rowCount } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'labs' });
      expect(rowCount).toBe(2);
    });

    /** A speaking task as speaking.create leaves it; `groupIds` empty means every student. */
    async function speakingTask(title: string, { active = true, groupIds = [] as number[] } = {}) {
      const [task] = await testDb.insert(schema.speakingTasks).values({
        title, active, forEveryone: groupIds.length === 0, createdBy: adminUser.id,
      }).returning();
      if (groupIds.length > 0) await testDb.insert(schema.speakingTaskGroups).values(groupIds.map((groupId) => ({ taskId: task.id, groupId })));
      return task;
    }

    let recordingCounter = 0;
    async function recording(taskId: number, userId: number, fields: Partial<typeof schema.speakingSubmissions.$inferInsert> = {}) {
      recordingCounter += 1;
      await testDb.insert(schema.speakingSubmissions).values({
        taskId, userId, clientKey: `key-${recordingCounter}-abcdef`,
        audioUrl: `/api/recordings/00000000-0000-4000-8000-${String(recordingCounter).padStart(12, '0')}.webm`,
        mimeType: 'audio/webm', durationMs: 20_000, voicedMs: 15_000, submittedAt: new Date('2026-09-25T15:12:00Z'),
        ...fields,
      });
    }

    it('has a speaking dataset: a row per student per released task, described by the latest recording', async () => {
      const api = await load();
      const cuento = await speakingTask('Cuento semana 2', { groupIds: [PERIOD_1] });
      await speakingTask('Cuento semana 10');
      const hidden = await speakingTask('Escalera (not released)', { active: false });
      const p2 = await speakingTask('P2 only', { groupIds: [PERIOD_2] });

      // Ana's latest recording was graded; the grade on her earlier one is history.
      await recording(cuento.id, ana.id, {
        submittedAt: new Date('2026-09-24T10:00:00Z'), gradeScore: 60, gradedBy: 'teacher', gradedAt: new Date('2026-09-24T12:00:00Z'),
      });
      await recording(cuento.id, ana.id, {
        submittedAt: new Date('2026-09-25T15:12:00Z'), durationMs: 31_400, voicedMs: 24_600,
        gradeScore: 87.5, gradedBy: 'vowel-agent v1', gradedAt: new Date('2026-09-26T08:00:00Z'), gradeFeedback: 'Las "e" muy bien',
      });
      // Beto's latest has not been graded yet, though an earlier one was.
      await recording(cuento.id, beto.id, { submittedAt: new Date('2026-09-24T10:00:00Z'), gradeScore: 70, gradedBy: 'teacher', gradedAt: new Date('2026-09-24T12:00:00Z') });
      await recording(cuento.id, beto.id, { submittedAt: new Date('2026-09-26T10:00:00Z') });
      // Neither the teacher's own try nor another period's work makes a row.
      await recording(cuento.id, adminUser.id);
      await recording(hidden.id, adminUser.id);
      await recording(p2.id, carla.id);

      const { csv, rowCount } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'speaking' });
      const [header, ...rows] = csv.split('\n');
      // v1.16.0 adds the upload's flags and the length the page claimed (routers/admin.ts).
      expect(header).toBe('student_name,student_email,task,status,submitted_at,attempts,duration_s,voice_s,grade_score,graded_by,graded_at,feedback,flags,page_length_s');
      expect(rows).toEqual([
        '"Ana","ana@example.com","Cuento semana 2",submitted,"2026-09-25T15:12:00.000Z",2,31,25,87.5,"vowel-agent v1","2026-09-26T08:00:00.000Z","Las ""e"" muy bien","",',
        '"Beto","beto@example.com","Cuento semana 2",submitted,"2026-09-26T10:00:00.000Z",2,20,15,,"","","","",',
        '"Ana","ana@example.com","Cuento semana 10",missing,,0,,,,,,,,',
        '"Beto","beto@example.com","Cuento semana 10",missing,,0,,,,,,,,',
      ]);
      expect(rowCount).toBe(4);
    });

    it('keeps a hidden speaking task in the export once someone in the group has recorded it', async () => {
      const api = await load();
      const task = await speakingTask('Escalera 1', { active: false, groupIds: [PERIOD_1] });
      await recording(task.id, beto.id);
      const { csv, rowCount } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'speaking' });
      expect(rowCount).toBe(2);
      expect(csv.split('\n').slice(1).map((r) => r.split(',')[3])).toEqual(['missing', 'submitted']);
    });

    it('exports no speaking rows for a task whose groups were all deleted', async () => {
      const api = await load();
      const task = await speakingTask('P2 only', { groupIds: [PERIOD_2] });
      await recording(task.id, carla.id);
      await api.adminApi.deleteGroup({ id: PERIOD_2 });
      for (const groupId of [PERIOD_1, PERIOD_2]) {
        expect((await api.adminApi.exportGroupData({ groupId, dataset: 'speaking' })).rowCount).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // v1.15.0: speaking in every pause

  describe('the pause rule', () => {
    const REQUIRED = 660_000;
    const SETUP_MS = 30_000;
    /** 21 answer pauses of 4 s every 30 s from 0:20 (the last ends at 10:24), plus one ending at must-hear-through, which never counts. */
    const COUNTED: [number, number][] = Array.from({ length: 21 }, (_, i) => [20_000 + i * 30_000, 24_000 + i * 30_000]);
    const PAUSES: [number, number][] = [...COUNTED, [656_000, 660_000]];
    const WINDOW = 3600;
    const SCAN = { minPauseMs: 3300, thresholdDb: -46.2, noiseDb: -78.5, shortestKeptMs: 4000, longestLeftOutMs: 2100, closeCalls: 0 };

    const scannedLab = (api: Callers, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) =>
      createLab(api, { pauses: PAUSES, scan: SCAN, ...overrides });

    /** Opens a session as the new page does, at a time in the past (the server's clock is set back for it). */
    async function openAt(caller: Callers['ana'], labId: number, startedAt: number) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(startedAt);
      try {
        return await caller.begin({ labId, client: 3 });
      } finally {
        vi.useRealTimers();
      }
    }

    type Row = typeof schema.labListenEvents.$inferInsert;
    /**
     * An honest page's log: play at 0 and a tick every 5 s, each on time; each
     * pause's result rides on the first tick after its window ends. `voice(i)`
     * is the voice heard in pause i (null: no result sent).
     */
    function pageLog(labId: number, userId: number, startedAt: number, {
      upTo = REQUIRED, voice = () => 1000,
    }: { upTo?: number; voice?: (i: number) => number | null } = {}): Row[] {
      const rows: Row[] = [];
      for (let p = 0; p <= upTo; p += 5000) {
        const clientMs = SETUP_MS + p;
        const answers = COUNTED
          .map((pause, i) => ({ pause, i }))
          .filter(({ pause }) => pause[1] - 100 <= p && pause[1] - 100 > p - 5000)
          .map(({ pause, i }) => [pause[0], voice(i)])
          .filter((a) => a[1] !== null);
        rows.push({
          labId, userId, sessionStartedAt: startedAt, kind: p === 0 ? 'play' : 'tick', positionMs: p, clientMs,
          at: startedAt + clientMs + 50, answers: answers.length > 0 ? JSON.stringify(answers) : null,
        });
      }
      return rows;
    }

    /** A session opened by begin (its rules on the open row) long enough ago to be heard through, and logged. */
    async function scoredSession(caller: Callers['ana'], userId: number, labId: number, {
      startedAt = Date.now() - (REQUIRED + 60_000), voice, upTo,
    }: { startedAt?: number; voice?: (i: number) => number | null; upTo?: number } = {}) {
      const session = await openAt(caller, labId, startedAt);
      await testDb.insert(schema.labListenEvents).values(pageLog(labId, userId, startedAt, { voice, upTo }));
      return { ...session, startedAt };
    }

    /** What the new page sends when the student turns the lab in (no microphone field unless given). */
    const turnIn = (labId: number, startToken: string, fields: Record<string, unknown> = {}) => ({
      labId,
      startToken,
      positionMs: REQUIRED + 5000,
      clientMs: SETUP_MS + REQUIRED + 5000,
      voicedMs: 20_000,
      listenWallMs: REQUIRED + 5000,
      ...fields,
    });

    const storedRow = async () => (await testDb.query.labSubmissions.findMany())[0];

    describe('begin', () => {
      it('tells a page from before the update to reload, and opens nothing', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { RELOAD_MESSAGE } = await import('./labs.js');
        for (const input of [{ labId: lab.id }, { labId: lab.id, client: 1 }, { labId: lab.id, client: 2 }]) {
          await expect(api.ana.begin(input)).rejects.toMatchObject({ code: 'BAD_REQUEST', message: RELOAD_MESSAGE });
        }
        expect(RELOAD_MESSAGE).toBe('libreSRS was updated. Reload this page to do the lab.');
        expect(await testDb.query.labListenEvents.findMany()).toHaveLength(0);
      });

      it('writes the session’s rules on its open row and returns the pauses and settings', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const session = await api.ana.begin({ labId: lab.id, client: 3 });
        expect(session).toMatchObject({ pauses: COUNTED, minAnsweredPct: 75, voicePerPauseMs: 250, gateMarginDb: 6, needed: 16, minimumVoicedMs: 30_000 });

        const [open] = await testDb.query.labListenEvents.findMany();
        expect(open.kind).toBe('open');
        expect(JSON.parse(open.rules!)).toEqual({
          v: 1, pauses: COUNTED, pct: 75, floor: 250, requiredThroughMs: REQUIRED, gateMarginDb: 6, holdOutsideVoice: false,
        });

        // The room margin and the hold as they are when a session begins: version 1 still, so a
        // server rolled back to v1.15 reads these rules (and ignores the two new fields).
        await api.admin.saveSettings({ gateMarginDb: 9, holdOutsideVoice: true });
        expect(await api.beto.begin({ labId: lab.id, client: 3 })).toMatchObject({ gateMarginDb: 9 });
        const betoOpen = (await testDb.query.labListenEvents.findMany()).find((e) => e.userId === beto.id)!;
        expect(JSON.parse(betoOpen.rules!)).toMatchObject({ v: 1, gateMarginDb: 9, holdOutsideVoice: true });
      });

      it('leaves out pauses after “don’t count pauses after” and after must-hear-through less 1.5 s', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await api.admin.update({ id: lab.id, pauseCountUntilMs: 200_000 });
        // The pauses starting at 0:20 … 2:50; the one at 3:20 starts at the cut-off.
        expect((await api.ana.begin({ labId: lab.id, client: 3 })).pauses).toEqual(COUNTED.slice(0, 6));

        await api.admin.update({ id: lab.id, pauseCountUntilMs: null, requiredThroughMs: 595_500 });
        // 9:50–9:54 ends 1.5 s before 9:55.5 and still counts; 10:20 does not.
        const session = await api.ana.begin({ labId: lab.id, client: 3 });
        expect(session.pauses).toEqual(COUNTED.slice(0, 20));
        expect(session.needed).toBe(15);
      });

      it('gives an unscanned lab no pauses, and says the rule is off at 0%', async () => {
        const api = await load();
        const unscanned = await createLab(api);
        expect(await api.ana.begin({ labId: unscanned.id, client: 3 })).toMatchObject({ pauses: null, needed: null });
        const open = await testDb.query.labListenEvents.findFirst();
        expect(JSON.parse(open!.rules!)).toMatchObject({ pauses: null, pct: 75 });

        await api.admin.saveSettings({ minAnsweredPct: 0 });
        const scanned = await scannedLab(api);
        expect(await api.ana.begin({ labId: scanned.id, client: 3 })).toMatchObject({ minAnsweredPct: 0, needed: 0 });
      });

      it('refuses to open a lab already turned in the maximum number of times', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { MAX_ATTEMPTS_PER_LAB } = await import('../services/labMedia.js');
        for (let i = 0; i < MAX_ATTEMPTS_PER_LAB; i++) {
          await addSubmission(lab.id, ana.id, { credit: false, submittedAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 3_600_000) });
        }
        await expect(api.ana.begin({ labId: lab.id, client: 3 })).rejects.toMatchObject({
          code: 'TOO_MANY_REQUESTS',
          message: 'This lab has already been turned in 10 times. Ask your teacher before trying again.',
        });
        expect(await testDb.query.labListenEvents.findMany()).toHaveLength(0);
        await expect(api.beto.begin({ labId: lab.id, client: 3 })).resolves.toMatchObject({ id: lab.id });
      });
    });

    describe('heartbeat', () => {
      it('stores the pause results a report carries on the same row', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
        await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'play', positionMs: 0, clientMs: 30_000 });
        await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 25_000, clientMs: 55_000, answers: [[20_000, 1200]] });
        await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 30_000, clientMs: 60_000, answers: [] });
        const rows = await testDb.query.labListenEvents.findMany();
        expect(rows.map((r) => [r.kind, r.answers, r.kind === 'open' ? 'rules' : r.rules])).toEqual([
          ['open', null, 'rules'],
          ['play', null, null],
          ['tick', '[[20000,1200]]', null],
          ['tick', null, null],
        ]);
      });

      it('stores a report the page sent again (its answer came late) once, with its results', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
        const report = { labId: lab.id, startToken, kind: 'tick' as const, positionMs: 25_000, clientMs: 55_000, answers: [[20_000, 1200]] as [number, number][] };
        expect(await api.ana.heartbeat(report)).toMatchObject({ recorded: true });
        expect(await api.ana.heartbeat(report)).toMatchObject({ recorded: true });
        // Another report at the same moment of another kind, or a moment later, is its own.
        await api.ana.heartbeat({ ...report, kind: 'pause', answers: undefined });
        await api.ana.heartbeat({ ...report, clientMs: 55_001, answers: undefined });
        const rows = (await testDb.query.labListenEvents.findMany()).filter((r) => r.kind !== 'open');
        expect(rows.map((r) => [r.kind, r.clientMs, r.answers])).toEqual([
          ['tick', 55_000, '[[20000,1200]]'], ['pause', 55_000, null], ['tick', 55_001, null],
        ]);
      });

      it('refuses more than 20 results, or results out of range, and stores nothing', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
        const report = { labId: lab.id, startToken, kind: 'tick' as const, positionMs: 25_000, clientMs: 55_000 };
        for (const answers of [
          Array.from({ length: 21 }, (_, i) => [20_000 + i, 100] as [number, number]),
          [[20_000, 120_001]] as [number, number][],
          [[-1, 100]] as [number, number][],
          [[86_400_001, 100]] as [number, number][],
          [[20_000, 10.5]] as [number, number][],
        ]) {
          await expect(api.ana.heartbeat({ ...report, answers })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        }
        expect((await testDb.query.labListenEvents.findMany()).map((r) => r.kind)).toEqual(['open']);
      });
    });

    describe('submit', () => {
      it('gives credit to an honest session and stores what it was judged by', async () => {
        const api = await load();
        const lab = await scannedLab(api, { groupIds: [PERIOD_1] });
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id);

        const { result } = await api.ana.submit(turnIn(lab.id, startToken, { mic: 'on', outsideVoicedMs: 30_000, outsidePlayedMs: 580_000 }));
        const row = await storedRow();
        expect(result).toEqual({
          submissionId: row.id, credit: true, status: 'done', scored: true,
          pausesAnswered: 21, pausesCounted: 21, needed: 16, mic: 'on',
        });
        expect(row).toMatchObject({
          credit: true, creditOverride: null, mic: 'on', pausesCounted: 21, pausesAnswered: 21,
          rejectedAnswers: 0, lateAnswers: 0, minAnsweredPct: 75, voicePerPauseMs: 250,
          outsideVoicedMs: 30_000, outsidePlayedMs: 580_000, flags: '[]',
        });
        expect(JSON.parse(row.pauseResults!)).toEqual(COUNTED.map(([s]) => [s, 1000]));
        expect((await api.ana.list())[0]).toMatchObject({
          status: 'done', redoByTeacher: false, attempts: 1, pausesAnswered: 21, pausesCounted: 21, needed: 16,
          submittedAt: row.submittedAt,
        });
      });

      it('stores no credit for a silent session: a redo, and still to do on the dashboard', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });

        const { result } = await api.ana.submit(turnIn(lab.id, startToken));
        expect(result).toMatchObject({ credit: false, status: 'redo', scored: true, pausesAnswered: 0, pausesCounted: 21, needed: 16, mic: 'on' });
        // Stored as 0 in the database, not left to a default.
        const { rows } = await client.execute('SELECT credit, credit_override FROM lab_submissions');
        expect(rows).toEqual([{ credit: 0, credit_override: null }]);
        expect(JSON.parse((await storedRow()).pauseResults!)).toEqual(COUNTED.map(([s]) => [s, 0]));
        expect((await api.ana.list())[0]).toMatchObject({
          status: 'redo', submittedAt: null, attempts: 1, pausesAnswered: 0, pausesCounted: 21, needed: 16,
        });
      });

      it('counts a pause at the floor and not a millisecond under, against the needed number', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // 16 of 21 needed: 15 at the floor and one just under is not enough.
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 15 ? 250 : i === 15 ? 249 : 0) });
        expect((await api.ana.submit(turnIn(lab.id, startToken))).result).toMatchObject({ credit: false, pausesAnswered: 15 });
        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, lab.id, { voice: (i) => (i < 16 ? 250 : 0) });
        expect((await api.beto.submit(turnIn(lab.id, betoToken))).result).toMatchObject({ credit: true, pausesAnswered: 16 });
      });

      it('sends a lab done without a microphone to the teacher, unless enough pauses were answered before it was lost', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => null });
        expect((await api.ana.submit(turnIn(lab.id, startToken, { mic: 'off' }))).result)
          .toMatchObject({ credit: false, status: 'check', mic: 'off', pausesAnswered: 0 });
        expect((await api.ana.list())[0].status).toBe('check');
        const { submissions } = await api.admin.submissions({ labId: lab.id });
        expect(submissions[0]).toMatchObject({ status: 'check', statusReason: 'no-mic', flags: ['no-mic'] });

        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, lab.id, { voice: (i) => (i < 17 ? 900 : null) });
        expect((await api.beto.submit(turnIn(lab.id, betoToken, { mic: 'off' }))).result)
          .toMatchObject({ credit: true, status: 'done', mic: 'off', pausesAnswered: 17 });
      });

      it('lets every lab count while the share is 0%, silent or without a microphone', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await api.admin.saveSettings({ minAnsweredPct: 0 });
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        expect((await api.ana.submit(turnIn(lab.id, startToken))).result)
          .toMatchObject({ credit: true, status: 'done', scored: true, pausesAnswered: 0, needed: 0 });
        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, lab.id, { voice: () => null });
        expect((await api.beto.submit(turnIn(lab.id, betoToken, { mic: 'off' }))).result).toMatchObject({ credit: true, status: 'done' });
        expect((await storedRow()).minAnsweredPct).toBe(0);
      });

      it('judges a session by the rules it began with, whatever the teacher changes during class', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id);
        // Mid-session: a new scan with every pause moved, the strictest settings, a new cut-off.
        await api.admin.setPauses({ id: lab.id, pauses: PAUSES.map(([s, e]) => [s + 2000, e + 2000]), scan: SCAN });
        await api.admin.saveSettings({ minAnsweredPct: 100, voicePerPauseMs: 2000 });
        await api.admin.update({ id: lab.id, pauseCountUntilMs: 100_000 });

        expect((await api.ana.submit(turnIn(lab.id, startToken))).result)
          .toMatchObject({ credit: true, pausesAnswered: 21, pausesCounted: 21, needed: 16 });
        expect(await storedRow()).toMatchObject({ minAnsweredPct: 75, voicePerPauseMs: 250 });
      });

      it('does not score a session opened before the lab was scanned', async () => {
        const api = await load();
        const lab = await createLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        await api.admin.setPauses({ id: lab.id, pauses: PAUSES, scan: SCAN });
        expect((await api.ana.submit(turnIn(lab.id, startToken))).result)
          .toMatchObject({ credit: true, status: 'done', scored: false, pausesCounted: null, needed: null });
        // Unscored and without a microphone, it waits for the teacher.
        const unscanned = await createLab(api, { title: 'Unscanned' });
        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, unscanned.id, { voice: () => null });
        expect((await api.beto.submit(turnIn(unscanned.id, betoToken, { mic: 'off' }))).result)
          .toMatchObject({ credit: false, status: 'check', scored: false, pausesCounted: null, mic: 'off' });
        // A scan that finds no pauses leaves sessions opened afterwards unscored too.
        await api.admin.setPauses({ id: unscanned.id, pauses: [], scan: SCAN });
        const { startToken: carlaToken } = await scoredSession(api.carla, carla.id, unscanned.id, { voice: () => 0 });
        expect((await api.carla.submit(turnIn(unscanned.id, carlaToken))).result).toMatchObject({ credit: true, scored: false });
      });

      it('leaves out the results of pauses that stopped counting when must-hear-through moved earlier mid-session', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id);
        // The teacher moves must-hear-through to 3:10: of the 21 pauses the session began with, 6 still count.
        await api.admin.update({ id: lab.id, requiredThroughMs: 190_000 });
        const { result } = await api.ana.submit(turnIn(lab.id, startToken));
        expect(result).toMatchObject({ credit: true, pausesCounted: 6, pausesAnswered: 6 });
        const row = await storedRow();
        // The page's honest results for the other 15 are neither counted nor odd.
        expect(row).toMatchObject({ rejectedAnswers: 0, lateAnswers: 0 });
        expect((await api.admin.submissions({ labId: lab.id })).submissions[0].flags).toEqual([]);
      });

      it('stores its flags on every row it writes, whatever the rule, so a row without them is known to be older', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const unscanned = await createLab(api, { title: 'Unscanned' });
        const { signLabStart } = await import('../services/labMedia.js');
        // Scored, unscored, and a session opened before the update (legacy).
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        await api.ana.submit(turnIn(lab.id, startToken));
        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, unscanned.id, { voice: () => null });
        await api.beto.submit(turnIn(unscanned.id, betoToken, { mic: 'off' }));
        const startedAt = Date.now() - (REQUIRED + 60_000);
        await testDb.insert(schema.labListenEvents).values({
          labId: lab.id, userId: carla.id, sessionStartedAt: startedAt, kind: 'open', positionMs: 0, clientMs: 0, at: startedAt,
        });
        await testDb.insert(schema.labListenEvents).values(pageLog(lab.id, carla.id, startedAt, { voice: () => null }));
        await api.carla.submit(turnIn(lab.id, signLabStart(lab.id, carla.id, startedAt)));

        const { rows } = await client.execute('SELECT credit, flags FROM lab_submissions ORDER BY id');
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => typeof r.flags === 'string')).toBe(true);
        // A silent scored row and an unscored one without a microphone stay without credit.
        expect(rows.map((r) => r.credit)).toEqual([0, 0, 1]);
        expect((await api.ana.list())[0].status).toBe('redo');
        expect((await api.beto.list()).find((l) => l.id === unscanned.id)?.status).toBe('check');
      });

      it('scores a new page’s session that leaves out the microphone field, as on', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        const input = turnIn(lab.id, startToken);
        expect(input).not.toHaveProperty('mic');
        expect((await api.ana.submit(input)).result).toMatchObject({ scored: true, credit: false, mic: 'on' });
      });

      it('keeps the old rule for a session opened before the update, for six hours only', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { signLabStart } = await import('../services/labMedia.js');
        const { LEGACY_EXPIRED_MESSAGE } = await import('./labs.js');
        const openedBefore = async (userId: number, startedAt: number) => {
          // The open row an older server wrote: no rules.
          await testDb.insert(schema.labListenEvents).values({
            labId: lab.id, userId, sessionStartedAt: startedAt, kind: 'open', positionMs: 0, clientMs: 0, at: startedAt,
          });
          await testDb.insert(schema.labListenEvents).values(pageLog(lab.id, userId, startedAt, { voice: () => null }));
          return signLabStart(lab.id, userId, startedAt);
        };

        const recent = await openedBefore(ana.id, Date.now() - (REQUIRED + 60_000));
        expect((await api.ana.submit(turnIn(lab.id, recent, { voicedMs: 95_000 }))).result)
          .toMatchObject({ credit: true, status: 'done', scored: false, mic: 'on' });
        expect(await storedRow()).toMatchObject({ credit: true, mic: 'on', pausesCounted: null, minAnsweredPct: null, voicePerPauseMs: null });

        const old = await openedBefore(beto.id, Date.now() - 7 * 60 * 60 * 1000);
        await expect(api.beto.submit(turnIn(lab.id, old))).rejects.toMatchObject({ code: 'BAD_REQUEST', message: LEGACY_EXPIRED_MESSAGE });
        expect(LEGACY_EXPIRED_MESSAGE).toBe('This lab session is from before an update. Open the lab again.');
        expect(await testDb.query.labSubmissions.findMany()).toHaveLength(1);
      });

      it('answers a retry with the stored result', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        const first = await api.ana.submit(turnIn(lab.id, startToken));
        const again = await api.ana.submit(turnIn(lab.id, startToken, { answers: COUNTED.map(([s]) => [s, 3000]) }));
        expect(again).toEqual({ success: true, duplicate: true, result: first.result });
        expect(await testDb.query.labSubmissions.findMany()).toHaveLength(1);
      });

      it('scores copies of one submit arriving together once, and gives each the same result', async () => {
        const actual = await vi.importActual<typeof import('../services/labPauses.js')>('../services/labPauses.js');
        const scorePauses = vi.fn(actual.scorePauses);
        vi.doMock('../services/labPauses.js', () => ({ ...actual, scorePauses }));
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id);

        const results = await Promise.all(Array.from({ length: 4 }, () => api.ana.submit(turnIn(lab.id, startToken))));
        expect(scorePauses).toHaveBeenCalledTimes(1);
        expect(results.filter((r) => 'duplicate' in r)).toHaveLength(3);
        expect(new Set(results.map((r) => JSON.stringify(r.result))).size).toBe(1);
        expect(await testDb.query.labSubmissions.findMany()).toHaveLength(1);
      });

      it('refuses a session over the attempt cap before scoring it', async () => {
        const actual = await vi.importActual<typeof import('../services/labPauses.js')>('../services/labPauses.js');
        const scorePauses = vi.fn(actual.scorePauses);
        vi.doMock('../services/labPauses.js', () => ({ ...actual, scorePauses }));
        const api = await load();
        const lab = await scannedLab(api);
        const { MAX_ATTEMPTS_PER_LAB } = await import('../services/labMedia.js');
        // Opened while there was room; the cap filled up before it was turned in.
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id);
        for (let i = 0; i < MAX_ATTEMPTS_PER_LAB; i++) {
          await addSubmission(lab.id, ana.id, { credit: false, submittedAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 3_600_000) });
        }
        await expect(api.ana.submit(turnIn(lab.id, startToken))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        expect(scorePauses).not.toHaveBeenCalled();
        expect(await testDb.query.labSubmissions.findMany()).toHaveLength(MAX_ATTEMPTS_PER_LAB);
      });

      it('adds the page’s unsent reports to the log and scores them: deduped, after-the-end ones left out', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const startedAt = Date.now() - (REQUIRED + 60_000);
        await openAt(api.ana, lab.id, startedAt);
        const { signLabStart } = await import('../services/labMedia.js');
        const full = pageLog(lab.id, ana.id, startedAt);
        // The last minute never arrived; the page still holds it.
        const delivered = full.filter((r) => r.positionMs <= 600_000);
        await testDb.insert(schema.labListenEvents).values(delivered);
        const queued = full.filter((r) => r.positionMs >= 595_000).map((r) => ({
          kind: r.kind as 'tick', positionMs: r.positionMs, clientMs: r.clientMs,
          ...(r.answers ? { answers: JSON.parse(r.answers as string) as [number, number][] } : {}),
        }));
        const before = Date.now();
        const { result } = await api.ana.submit(turnIn(lab.id, signLabStart(lab.id, ana.id, startedAt), {
          reports: [
            ...queued,
            { kind: 'tick', positionMs: 670_000, clientMs: SETUP_MS + REQUIRED + 10_000 }, // after the final entry
          ],
        }));
        expect(result).toMatchObject({ credit: true, pausesAnswered: 21 });

        const log = await testDb.query.labListenEvents.findMany({ orderBy: (e, { asc }) => [asc(e.id)] });
        // 595 000 and 600 000 were stored already: not twice.
        expect(log.filter((e) => e.positionMs === 595_000)).toHaveLength(1);
        expect(log.filter((e) => e.positionMs === 670_000)).toHaveLength(0);
        const carried = log.filter((e) => e.positionMs > 600_000 && e.kind === 'tick');
        expect(carried.map((e) => e.positionMs)).toEqual(Array.from({ length: 12 }, (_, i) => 605_000 + i * 5000));
        expect(carried.every((e) => e.at >= before)).toBe(true);
        expect(carried.find((e) => e.positionMs === 625_000)?.answers).toBe('[[620000,1000]]');
        expect(log[log.length - 1].kind).toBe('end');
      });

      it('stores carried reports only up to the session’s cap, and takes 400 reports of 20 results each', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { MAX_LISTEN_EVENTS, signLabStart } = await import('../services/labMedia.js');
        const startedAt = Date.now() - (REQUIRED + 60_000);
        await openAt(api.ana, lab.id, startedAt);
        await testDb.insert(schema.labListenEvents).values(pageLog(lab.id, ana.id, startedAt, { upTo: 460_000 }));
        const reports = Array.from({ length: 400 }, (_, i) => {
          const positionMs = 460_500 + i * 500;
          return {
            kind: 'tick' as const, positionMs, clientMs: SETUP_MS + positionMs,
            answers: Array.from({ length: 20 }, (_, j) => [COUNTED[(i + j) % 21][0], 500] as [number, number]),
          };
        });
        const body = JSON.stringify(turnIn(lab.id, signLabStart(lab.id, ana.id, startedAt), { reports }));
        // Well within the 10 MB JSON body limit (index.ts express.json).
        expect(body.length).toBeLessThan(250_000);
        const started = performance.now();
        await expect(api.ana.submit(JSON.parse(body))).resolves.toMatchObject({ success: true });
        expect(performance.now() - started).toBeLessThan(2000);
        const log = await testDb.query.labListenEvents.findMany();
        expect(log.filter((e) => e.positionMs > 460_000 && e.kind === 'tick')).toHaveLength(400);
        expect(log.length).toBeLessThan(MAX_LISTEN_EVENTS);

        // Beto's session is nearly full: three more fit, then the final entry.
        const betoStart = Date.now() - (REQUIRED + 70_000);
        await openAt(api.beto, lab.id, betoStart);
        const betoLog = pageLog(lab.id, beto.id, betoStart);
        const filler = Array.from({ length: MAX_LISTEN_EVENTS - 1 - betoLog.length - 3 }, (_, i) => ({
          labId: lab.id, userId: beto.id, sessionStartedAt: betoStart, kind: 'pause' as const, positionMs: 0, clientMs: 1 + i, at: betoStart + 1 + i,
        }));
        await testDb.insert(schema.labListenEvents).values(filler);
        await testDb.insert(schema.labListenEvents).values(betoLog);
        await api.beto.submit(turnIn(lab.id, signLabStart(lab.id, beto.id, betoStart), {
          reports: Array.from({ length: 10 }, (_, i) => ({ kind: 'pause' as const, positionMs: REQUIRED, clientMs: SETUP_MS + REQUIRED + 100 + i })),
        }));
        const betoRows = await testDb.query.labListenEvents.findMany({ where: eq(schema.labListenEvents.userId, beto.id) });
        expect(betoRows).toHaveLength(MAX_LISTEN_EVENTS + 1);
        expect(betoRows.filter((e) => e.kind === 'end')).toHaveLength(1);
      });

      it('counts nothing from a log sent in one burst long after it happened, and flags it', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const startedAt = Date.now() - 20 * 60_000;
        const { startToken } = await openAt(api.ana, lab.id, startedAt);
        const burst = Date.now() - 2000;
        await testDb.insert(schema.labListenEvents).values(pageLog(lab.id, ana.id, startedAt).map((r, i) => ({ ...r, at: burst + i })));
        const { result } = await api.ana.submit(turnIn(lab.id, startToken));
        expect(result).toMatchObject({ credit: false, pausesAnswered: 0 });
        const row = await storedRow();
        expect(row).toMatchObject({ lateAnswers: 21, rejectedAnswers: 0 });
        expect(JSON.parse(row.flags!)).toContain('late');
        expect((await api.admin.submissions({ labId: lab.id })).submissions[0].flags).toEqual(['late']);
      });

      it('flags another window playing a lab at the same time, not a late retry burst', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const other = await createLab(api, { title: 'Another lab' });
        const { startToken, startedAt } = await scoredSession(api.ana, ana.id, lab.id);
        // A second window on another lab, playing for two minutes during this session.
        const second = startedAt + 100_000;
        await testDb.insert(schema.labListenEvents).values(Array.from({ length: 25 }, (_, i) => ({
          labId: other.id, userId: ana.id, sessionStartedAt: second, kind: 'tick' as const,
          positionMs: i * 5000, clientMs: 1000 + i * 5000, at: second + 1000 + i * 5000,
        })));
        await api.ana.submit(turnIn(lab.id, startToken));
        expect(JSON.parse((await storedRow()).flags!)).toEqual(['overlap']);

        // Beto: an abandoned session's queue arriving all at once is not a second window.
        const { startToken: betoToken, startedAt: betoStart } = await scoredSession(api.beto, beto.id, lab.id);
        await testDb.insert(schema.labListenEvents).values(Array.from({ length: 25 }, (_, i) => ({
          labId: other.id, userId: beto.id, sessionStartedAt: betoStart - 3_600_000, kind: 'tick' as const,
          positionMs: i * 5000, clientMs: 1000 + i * 5000, at: betoStart + 200_000,
        })));
        await api.beto.submit(turnIn(lab.id, betoToken));
        const betoRow = (await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.userId, beto.id) }))[0];
        expect(JSON.parse(betoRow.flags!)).toEqual([]);
      });

      it('flags sound through every pause, and a mic that hears as much outside the pauses', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => WINDOW });
        expect((await api.ana.submit(turnIn(lab.id, startToken))).result.credit).toBe(true);
        expect(JSON.parse((await storedRow()).flags!)).toEqual(['constant-sound']);

        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, lab.id);
        await api.beto.submit(turnIn(lab.id, betoToken, { outsidePlayedMs: 400_000, outsideVoicedMs: 120_000 }));
        const betoRow = (await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.userId, beto.id) }))[0];
        expect(JSON.parse(betoRow.flags!)).toEqual(['noisy']);
      });

      it('never stores more outside time than has passed, or more voice than was played', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken, startedAt } = await scoredSession(api.ana, ana.id, lab.id);
        await api.ana.submit(turnIn(lab.id, startToken, { outsidePlayedMs: 24 * 60 * 60 * 1000, outsideVoicedMs: 24 * 60 * 60 * 1000 }));
        const row = await storedRow();
        expect(row.outsidePlayedMs).toBeLessThanOrEqual(Date.now() - startedAt);
        expect(row.outsideVoicedMs).toBe(row.outsidePlayedMs);
      });

      it('takes the last results with the submit itself, on the final entry', async () => {
        const api = await load();
        // Must hear through 10:39: the last pause (10:20–10:24) ends 15 s before it.
        const lab = await scannedLab(api, { requiredThroughMs: 639_000 });
        // The page's last result had not ridden on a tick yet when the student finished at 10:38.
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i === 20 ? null : 1000), upTo: 635_000 });
        const { result } = await api.ana.submit(turnIn(lab.id, startToken, {
          positionMs: 638_000, clientMs: SETUP_MS + 638_000, answers: [[620_000, 700]],
        }));
        expect(result.pausesAnswered).toBe(21);
        // The same result on a final entry far past the pause (40 s later) is not believed.
        const { startToken: betoToken } = await scoredSession(api.beto, beto.id, lab.id, { voice: (i) => (i === 20 ? null : 1000), upTo: 660_000 });
        const late = await api.beto.submit(turnIn(lab.id, betoToken, { positionMs: 665_000, answers: [[620_000, 700]] }));
        expect(late.result.pausesAnswered).toBe(20);
        const end = (await testDb.query.labListenEvents.findMany({ where: eq(schema.labListenEvents.kind, 'end') }))[0];
        expect(end.answers).toBe('[[620000,700]]');
      });
    });

    describe('“The mic didn’t hear me”', () => {
      it('sends a lab that did not count to the teacher to check', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        const { result } = await api.ana.submit(turnIn(lab.id, startToken));
        await expect(api.ana.askTeacher({ submissionId: result.submissionId })).resolves.toEqual({ status: 'check' });
        expect((await storedRow()).checkRequestedAt).toBeInstanceOf(Date);
        expect((await api.ana.list())[0].status).toBe('check');
        const { submissions, summary } = await api.admin.submissions({ labId: lab.id });
        expect(submissions[0]).toMatchObject({ status: 'check', statusReason: 'asked' });
        expect(summary.byStudent).toEqual([{ userId: ana.id, name: 'Ana', status: 'check', reason: 'asked', countingRowId: result.submissionId, answered: 0, counted: 21 }]);
      });

      it('refuses anything else: twice, someone else’s, credited, without a mic, or decided by the teacher', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { ASK_TEACHER_MESSAGE } = await import('./labs.js');
        const redo = await addSubmission(lab.id, ana.id, { credit: false, pausesCounted: 21, pausesAnswered: 2, minAnsweredPct: 75 });
        await api.ana.askTeacher({ submissionId: redo.id });
        const credited = await addSubmission(lab.id, ana.id, { credit: true, submittedAt: new Date('2026-09-26T10:00:00Z') });
        const noMic = await addSubmission(lab.id, ana.id, { credit: false, mic: 'off', submittedAt: new Date('2026-09-26T11:00:00Z') });
        const decided = await addSubmission(lab.id, ana.id, { credit: false, creditOverride: false, submittedAt: new Date('2026-09-26T12:00:00Z') });
        const betos = await addSubmission(lab.id, beto.id, { credit: false });
        for (const [caller, id] of [
          [api.ana, redo.id], [api.ana, credited.id], [api.ana, noMic.id], [api.ana, decided.id], [api.ana, betos.id], [api.beto, redo.id], [api.ana, 9999],
        ] as const) {
          await expect(caller.askTeacher({ submissionId: id })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: ASK_TEACHER_MESSAGE });
        }
        // A lab turned in under v1.14 during a rollback (no flags, credit left at 0) already counts.
        const rolledBack = await addSubmission(lab.id, carla.id, { credit: false, flags: null });
        await expect(api.carla.askTeacher({ submissionId: rolledBack.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect((await api.carla.list())[0]).toMatchObject({ status: 'done', submittedAt: rolledBack.submittedAt });
        expect(ASK_TEACHER_MESSAGE).toBe("This lab can't be sent to your teacher.");
        expect((await testDb.query.labSubmissions.findMany()).filter((r) => r.checkRequestedAt)).toHaveLength(1);
      });
    });

    describe('the teacher’s decision', () => {
      it('gives credit, takes it away and undoes, one row or many', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const anaRedo = await addSubmission(lab.id, ana.id, { credit: false, pausesCounted: 21, pausesAnswered: 3, minAnsweredPct: 75 });
        const betoCheck = await addSubmission(lab.id, beto.id, { credit: false, mic: 'off' });
        const carlaDone = await addSubmission(lab.id, carla.id, { credit: true, pausesCounted: 21, pausesAnswered: 20, minAnsweredPct: 75 });

        await expect(api.admin.setCredit({ submissionIds: [anaRedo.id], credit: true })).resolves.toEqual({
          updated: 1, rows: [{ id: anaRedo.id, effectiveCredit: true, status: 'done' }],
        });
        const given = (await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.id, anaRedo.id) }))[0];
        expect(given).toMatchObject({ credit: false, creditOverride: true, creditOverrideBy: adminUser.id });
        expect(given.creditOverrideAt).toBeInstanceOf(Date);
        expect((await api.ana.list())[0]).toMatchObject({ status: 'done', submittedAt: anaRedo.submittedAt });

        // Bulk, with an id that does not exist and one given twice.
        const bulk = await api.admin.setCredit({ submissionIds: [betoCheck.id, carlaDone.id, carlaDone.id, 9999], credit: true });
        expect(bulk.updated).toBe(2);

        await expect(api.admin.setCredit({ submissionIds: [carlaDone.id], credit: false })).resolves.toMatchObject({
          rows: [{ id: carlaDone.id, effectiveCredit: false, status: 'redo' }],
        });
        expect((await api.carla.list())[0]).toMatchObject({ status: 'redo', redoByTeacher: true, submittedAt: null });

        // Undo: back to the automatic result, with nothing of the decision left.
        await expect(api.admin.setCredit({ submissionIds: [carlaDone.id, betoCheck.id], credit: null })).resolves.toMatchObject({ updated: 2 });
        const undone = await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.id, carlaDone.id) });
        expect(undone[0]).toMatchObject({ creditOverride: null, creditOverrideAt: null, creditOverrideBy: null });
        expect((await api.carla.list())[0]).toMatchObject({ status: 'done', redoByTeacher: false });
        expect((await api.beto.list())[0].status).toBe('check');
      });

      it('takes 1–200 rows at a time', async () => {
        const api = await load();
        await expect(api.admin.setCredit({ submissionIds: [], credit: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(api.admin.setCredit({ submissionIds: Array.from({ length: 201 }, (_, i) => i + 1), credit: true }))
          .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      });
    });

    describe('the teacher’s screens', () => {
      it('counts each lab’s students by where they stand, and summarizes its pauses without sending them', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await addSubmission(lab.id, ana.id, { credit: false, submittedAt: new Date('2026-09-24T10:00:00Z') });
        await addSubmission(lab.id, ana.id, { credit: true, pausesCounted: 21, pausesAnswered: 21, minAnsweredPct: 75 });
        await addSubmission(lab.id, beto.id, { credit: false, pausesCounted: 21, pausesAnswered: 2, minAnsweredPct: 75, rejectedAnswers: 3 });
        await addSubmission(lab.id, carla.id, { credit: false, mic: 'off' });
        await addSubmission(lab.id, adminUser.id, { credit: false });

        const [row] = await api.admin.adminList();
        expect(row).toMatchObject({
          turnedInCount: 3, studentCount: 3, doneCount: 1, redoCount: 1, checkCount: 1,
          // Beto's odd results. Carla's missing microphone is an amber flag, but she already waits for the teacher.
          flaggedCount: 1, lookCount: 0,
          pauseCount: 21, pauseTotal: 22, pauseCountUntilMs: null, needsCheck: false,
        });
        expect(row.pauseScan).toMatchObject({ ...SCAN, scannedAt: expect.any(Number) });
        expect(row).not.toHaveProperty('pauses');
        expect(row.lastSubmittedAt).toEqual(new Date('2026-09-25T15:12:00Z'));
      });

      it('shows an unscanned lab as such, and asks for a check of a doubtful scan', async () => {
        const api = await load();
        await createLab(api, { title: 'A unscanned' });
        await scannedLab(api, { title: 'B doubtful', scan: { ...SCAN, closeCalls: 2 } });
        const [unscanned, doubtful] = await api.admin.adminList();
        expect(unscanned).toMatchObject({ pauseCount: null, pauseTotal: null, pauseScan: null, needsCheck: false });
        expect(doubtful).toMatchObject({ pauseCount: 21, needsCheck: true });
      });

      it('gives each submission its result and snapshot, and where each student stands', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await api.admin.saveSettings({ minAnsweredPct: 80 });
        const { startToken } = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 10 ? 900 : 0) });
        await api.ana.submit(turnIn(lab.id, startToken));
        const beto1 = await addSubmission(lab.id, beto.id, { credit: true, submittedAt: new Date('2026-09-20T10:00:00Z') });
        await addSubmission(lab.id, beto.id, { credit: false, pausesCounted: 21, pausesAnswered: 1, minAnsweredPct: 75 });
        await addSubmission(lab.id, adminUser.id, { credit: false });

        const { lab: info, submissions, summary } = await api.admin.submissions({ labId: lab.id });
        expect(info).toMatchObject({ pauseCount: 21, pauseTotal: 22, settings: { minAnsweredPct: 80, voicePerPauseMs: 250 }, needed: 17 });
        const anaRow = submissions.find((s) => s.studentName === 'Ana')!;
        expect(anaRow).toMatchObject({
          mic: 'on', pausesCounted: 21, pausesAnswered: 10, rejectedAnswers: 0, lateAnswers: 0,
          minAnsweredPct: 80, voicePerPauseMs: 250, credit: false, creditOverride: null, creditOverrideAt: null,
          checkRequestedAt: null, effectiveCredit: false, status: 'redo', statusReason: null, needed: 17, flags: [],
        });
        expect(anaRow.pauseResults).toEqual(COUNTED.map(([s], i) => [s, i < 10 ? 900 : 0]));
        expect(summary.byStudent).toEqual([
          { userId: ana.id, name: 'Ana', status: 'redo', reason: null, countingRowId: anaRow.id, answered: 10, counted: 21 },
          // Beto's earlier attempt counted: he is done, whatever came after.
          { userId: beto.id, name: 'Beto', status: 'done', reason: null, countingRowId: beto1.id, answered: null, counted: null },
        ]);
        expect(summary).toMatchObject({ done: 1, redo: 1, check: 0 });
      });

      it('shows the pause results each report carried in the log, and never the session’s rules', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const { startToken } = await api.ana.begin({ labId: lab.id, client: 3 });
        await api.ana.heartbeat({ labId: lab.id, startToken, kind: 'tick', positionMs: 25_000, clientMs: 55_000, answers: [[20_000, 1200]] });
        const [session] = await api.admin.listenLog({ labId: lab.id, userId: ana.id });
        expect(session.events.map((e) => [e.kind, e.answers])).toEqual([['open', null], ['tick', [[20_000, 1200]]]]);
        expect(JSON.stringify(session)).not.toContain('rules');
      });

      it('gives one lab’s whole pause list and what counts of it', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await api.admin.update({ id: lab.id, pauseCountUntilMs: 100_000 });
        await expect(api.admin.pauses({ id: lab.id })).resolves.toMatchObject({
          id: lab.id, pauses: PAUSES, counted: COUNTED.slice(0, 3), pauseCount: 3, pauseTotal: 22, pauseCountUntilMs: 100_000, needsCheck: false,
        });
        await expect(api.admin.pauses({ id: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });
    });

    describe('results the page could not have sent, and holds (v1.16.0)', () => {
      /** A report sent while the server's clock reads `at` (the session is in the past), through the real heartbeat. */
      async function heartbeatAt(caller: Callers['ana'], at: number, input: Parameters<Callers['ana']['heartbeat']>[0]) {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at);
        try {
          return await caller.heartbeat(input);
        } finally {
          vi.useRealTimers();
        }
      }

      /**
       * The sim's C1 console script: with the page's session, clock and position,
       * its own report of `value` ms for each of these pauses, 2 s after the pause
       * ends, sent live (80 ms after the moment it names).
       */
      async function inject(caller: Callers['ana'], labId: number, session: { startToken: string; startedAt: number },
        pauses: [number, number][] = COUNTED, value = 1500) {
        for (const [s, e] of pauses) {
          const positionMs = e + 2000;
          const clientMs = SETUP_MS + positionMs;
          await heartbeatAt(caller, session.startedAt + clientMs + 80, {
            labId, startToken: session.startToken, kind: 'tick', positionMs, clientMs, answers: [[s, value]],
          });
        }
      }

      const rowOf = async (userId: number) =>
        (await testDb.query.labSubmissions.findMany({ where: eq(schema.labSubmissions.userId, userId) }))[0];

      it('rejects every result of a pause that got two in one playback: the C1 script gets a redo at 75%, a red flag only at 0%', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // The page hears silence and says so (0 in each pause); the script says 1.5 s.
        const session = await scoredSession(api.ana, ana.id, lab.id, { voice: () => 0 });
        await inject(api.ana, lab.id, session);
        const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, { voicedMs: 0 }));
        expect(result).toMatchObject({ credit: false, status: 'redo', pausesAnswered: 0, needed: 16 });
        const row = await rowOf(ana.id);
        // It failed the rule by itself: a redo, never held.
        expect(row).toMatchObject({ credit: false, heldFor: null, rejectedAnswers: 42, lateAnswers: 0 });
        expect(JSON.parse(row.flags!)).toEqual(['odd-answers']);
        expect(JSON.parse(row.pauseResults!)).toEqual(COUNTED.map(([s]) => [s, -2]));
        const reviewed = (await api.admin.submissions({ labId: lab.id })).submissions[0];
        expect(reviewed).toMatchObject({ status: 'redo', statusReason: null, heldFor: null, flags: ['odd-answers'] });
        expect(reviewed.pauseResults).toEqual(COUNTED.map(([s]) => [s, -2]));

        // At 0% everything counts: the same trick gets credit, with the red flag to see.
        await api.admin.saveSettings({ minAnsweredPct: 0 });
        const betoSession = await scoredSession(api.beto, beto.id, lab.id, { voice: () => 0 });
        await inject(api.beto, lab.id, betoSession);
        expect((await api.beto.submit(turnIn(lab.id, betoSession.startToken, { voicedMs: 0 }))).result)
          .toMatchObject({ credit: true, status: 'done', pausesAnswered: 0 });
        const betoRow = await rowOf(beto.id);
        expect(betoRow).toMatchObject({ credit: true, heldFor: null });
        expect(JSON.parse(betoRow.flags!)).toEqual(['odd-answers']);
      });

      /**
       * The v1.16 review's variants of the C1 script (review/tricks), through
       * the real router at 75%: a silent page with the microphone on, and the
       * script's own results, split from the page's by a replay or a fake jump.
       */
      describe('the script’s ways around the rule, from the v1.16 review', () => {
        type Entry = { kind: 'play' | 'tick' | 'seek'; positionMs: number; clientMs: number; answers?: [number, number][]; script?: boolean };
        /** Stores a log for a session opened `ago` ms before now: the page's entries 50 ms after they happened, the script's 80 ms. */
        async function logged(api: Callers, labId: number, entries: Entry[], ago = REQUIRED + 120_000) {
          const startedAt = Date.now() - ago;
          const session = await openAt(api.ana, labId, startedAt);
          await testDb.insert(schema.labListenEvents).values(entries.map((e) => ({
            labId, userId: ana.id, sessionStartedAt: startedAt, kind: e.kind, positionMs: e.positionMs, clientMs: e.clientMs,
            at: startedAt + e.clientMs + (e.script ? 80 : 50), answers: e.answers ? JSON.stringify(e.answers) : null,
          })));
          return session;
        }
        const silentPage = (): Entry[] => pageLog(0, ana.id, 0, { voice: () => 0 })
          .map((r) => ({ kind: r.kind as Entry['kind'], positionMs: r.positionMs, clientMs: r.clientMs, answers: r.answers ? JSON.parse(r.answers) : undefined }));

        const expectRedo = async (result: { credit: boolean; status: string; pausesAnswered: number | null }) => {
          expect(result).toMatchObject({ credit: false, status: 'redo', pausesAnswered: 0 });
          const row = await rowOf(ana.id);
          expect(row).toMatchObject({ credit: false, heldFor: null });
          expect(JSON.parse(row.flags!)).toEqual(['odd-answers']);
          return row;
        };

        it('R1: Back 10 s after each pause, and the script answers in the replay, where the page now sends its own 0', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          const entries: Entry[] = [];
          let pos = 0;
          let clientMs = SETUP_MS;
          entries.push({ kind: 'play', positionMs: 0, clientMs });
          const playTo = (target: number, answers?: [number, number][]) => {
            while (pos < target) {
              const step = Math.min(5000, target - pos);
              pos += step;
              clientMs += step;
              entries.push({ kind: 'tick', positionMs: pos, clientMs, ...(pos === target && answers ? { answers } : {}) });
            }
          };
          for (const [s, e] of COUNTED) {
            // The first pass's 0 rides on Back 10 s's report of where playback reached; then the seek.
            playTo(e + 1000, [[s, 0]]);
            pos -= 10_000;
            clientMs += 5;
            entries.push({ kind: 'seek', positionMs: pos, clientMs });
            // The replay's 0 (the page sends every pass), and the script's report 0.3 s later.
            playTo(e + 1000, [[s, 0]]);
            pos += 300;
            clientMs += 300;
            entries.push({ kind: 'tick', positionMs: pos, clientMs, answers: [[s, 1500]], script: true });
          }
          playTo(REQUIRED + 5000);
          const session = await logged(api, lab.id, entries, clientMs + 120_000);
          const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, { positionMs: pos, clientMs: clientMs + 100, voicedMs: 0 }));
          const row = await expectRedo(result);
          // Each pause keeps its first pass's 0; the replay's two results were both refused.
          expect(JSON.parse(row.pauseResults!)).toEqual(COUNTED.map(([s]) => [s, 0]));
          expect(row.rejectedAnswers).toBe(42);
        });

        it('S1: a fake seek 0.5 s back right after the script’s result, to put the page’s 0 in another playback', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          const entries = silentPage();
          for (const [s, e] of COUNTED) {
            entries.push({ kind: 'tick', positionMs: e, clientMs: SETUP_MS + e, answers: [[s, 1500]], script: true });
            entries.push({ kind: 'seek', positionMs: e - 500, clientMs: SETUP_MS + e + 1, script: true });
          }
          const session = await logged(api, lab.id, entries);
          const row = await expectRedo((await api.ana.submit(turnIn(lab.id, session.startToken, { voicedMs: 0 }))).result);
          expect(JSON.parse(row.pauseResults!)).toEqual(COUNTED.map(([s]) => [s, -2]));
        });

        it('S2: the fake seek lands in the window, and fake ticks walk through it in 1.5 s steps, 1 ms of page time apart', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          const entries = silentPage();
          for (const [s, e] of COUNTED) {
            const c = SETUP_MS + e;
            entries.push(
              { kind: 'tick', positionMs: e, clientMs: c, answers: [[s, 1500]], script: true },
              { kind: 'seek', positionMs: s + 200, clientMs: c + 1, script: true },
              { kind: 'tick', positionMs: s + 1699, clientMs: c + 2, script: true },
              { kind: 'tick', positionMs: s + 3198, clientMs: c + 3, script: true },
              { kind: 'tick', positionMs: e, clientMs: c + 4, script: true },
            );
          }
          const session = await logged(api, lab.id, entries);
          const row = await expectRedo((await api.ana.submit(turnIn(lab.id, session.startToken, { voicedMs: 0 }))).result);
          expect(JSON.parse(row.pauseResults!)).toEqual(COUNTED.map(([s]) => [s, -2]));
        });
      });

      it('holds a lab that meets the rule but carries results the page could not have sent', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // 17 honest answers; the script adds its own to four of them.
        const session = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 17 ? 900 : 0) });
        await inject(api.ana, lab.id, session, COUNTED.slice(0, 4));
        // Only 13 answered pauses are left, under the 16 needed: a redo.
        expect((await api.ana.submit(turnIn(lab.id, session.startToken))).result).toMatchObject({ credit: false, status: 'redo', pausesAnswered: 13 });

        // 21 honest answers, the script on two: 19 answered, which meets the rule, so the lab waits.
        const betoSession = await scoredSession(api.beto, beto.id, lab.id);
        await inject(api.beto, lab.id, betoSession, COUNTED.slice(0, 2));
        const { result } = await api.beto.submit(turnIn(lab.id, betoSession.startToken));
        expect(result).toMatchObject({ credit: false, status: 'check', pausesAnswered: 19 });
        expect(await rowOf(beto.id)).toMatchObject({ credit: false, heldFor: '["odd-answers"]' });
        expect((await api.beto.list())[0].status).toBe('check');
        const { submissions, summary } = await api.admin.submissions({ labId: lab.id });
        expect(submissions.find((s) => s.userId === beto.id)).toMatchObject({
          status: 'check', statusReason: 'held', heldFor: ['odd-answers'], flags: ['odd-answers'],
        });
        expect(summary).toMatchObject({ check: 1, redo: 1 });
        expect((await api.admin.adminList())[0]).toMatchObject({ checkCount: 1, redoCount: 1, flaggedCount: 2 });

        // "The mic didn't hear me" cannot send a held lab again; the teacher decides it.
        const heldId = submissions.find((s) => s.userId === beto.id)!.id;
        await expect(api.beto.askTeacher({ submissionId: heldId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await api.admin.setCredit({ submissionIds: [heldId], credit: true });
        expect((await api.beto.list())[0].status).toBe('done');
        await api.admin.setCredit({ submissionIds: [heldId], credit: null });
        expect((await api.beto.list())[0].status).toBe('check');
      });

      it('holds a lab done without a microphone whose pauses were answered by a script', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // No marker in the log (the page's report of it never arrived): the page measures nothing and sends
        // no results, and the script sends 1.5 s for each pause. More pause voice than the page heard.
        const session = await scoredSession(api.ana, ana.id, lab.id, { voice: () => null });
        await inject(api.ana, lab.id, session);
        const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, { mic: 'off', voicedMs: 0, pausedVoicedMs: 0 }));
        expect(result).toMatchObject({ credit: false, status: 'check', mic: 'off', pausesAnswered: 21 });
        const row = await rowOf(ana.id);
        expect(row).toMatchObject({ heldFor: '["odd-answers"]', rejectedAnswers: 0 });
        expect((await api.admin.submissions({ labId: lab.id })).submissions[0]).toMatchObject({
          statusReason: 'held', heldFor: ['odd-answers'], flags: ['odd-answers', 'no-mic'],
        });
      });

      describe('the page’s mark where it went on without a microphone', () => {
        /** "My mic doesn't work" before Start: the page's `nomic` report, through the real heartbeat, 5 s before the audio starts. */
        async function markNoMic(caller: Callers['ana'], labId: number, session: { startToken: string; startedAt: number },
          positionMs = 0, clientMs = SETUP_MS - 5000, answers?: [number, number][]) {
          return heartbeatAt(caller, session.startedAt + clientMs + 50, {
            labId, startToken: session.startToken, kind: 'nomic', positionMs, clientMs, ...(answers ? { answers } : {}),
          });
        }

        it('holds the script’s results, whatever mic its own submit says (N1: "on"; N2: "off" with the voice to match)', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          for (const [caller, userId, fields] of [
            [api.ana, ana.id, { mic: 'on', voicedMs: 0 }],
            [api.beto, beto.id, { mic: 'off', voicedMs: 60_000 }],
          ] as const) {
            const session = await scoredSession(caller, userId, lab.id, { voice: () => null });
            expect(await markNoMic(caller, lab.id, session)).toMatchObject({ recorded: true });
            await inject(caller, lab.id, session);
            // The script turns it in itself, before the page does; the page's own submit then gets the stored row.
            const { result } = await caller.submit(turnIn(lab.id, session.startToken, fields));
            expect(result).toMatchObject({ credit: false, status: 'check', mic: 'off', pausesAnswered: 21 });
            expect(await rowOf(userId)).toMatchObject({ credit: false, mic: 'off', heldFor: '["odd-answers"]' });
            expect((await caller.submit(turnIn(lab.id, session.startToken, { mic: 'off', voicedMs: 0 }))).result)
              .toMatchObject({ credit: false, status: 'check' });
          }
          const { submissions } = await api.admin.submissions({ labId: lab.id });
          for (const row of submissions) {
            expect(row).toMatchObject({ status: 'check', statusReason: 'held', heldFor: ['odd-answers'], flags: ['odd-answers', 'no-mic'] });
          }
        });

        it('reads the mark carried by the submit when its report never arrived', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          // The page answered 20 pauses and went on without a microphone at 9:56; its report of that rides on
          // the submit. The script answers the last pause, after it.
          const session = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 20 ? 1000 : null) });
          await inject(api.ana, lab.id, session, [COUNTED[20]]);
          const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, {
            mic: 'on', voicedMs: 22_000, reports: [{ kind: 'nomic', positionMs: 596_000, clientMs: SETUP_MS + 596_001 }],
          }));
          expect(result).toMatchObject({ credit: false, status: 'check', mic: 'off', pausesAnswered: 21 });
          expect(await rowOf(ana.id)).toMatchObject({ mic: 'off', heldFor: '["odd-answers"]' });
        });

        it('holds a result the script sends after the mark but dates before it, for the pause the microphone stopped in', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          // 15 pauses answered and the 16th silent, one short of the 16 needed. The microphone stops inside
          // the 17th (8:22), whose pass the page drops, and the page goes on without it 4 s later.
          const startedAt = Date.now() - (REQUIRED + 90_000);
          const session = await openAt(api.ana, lab.id, startedAt);
          const stop = 502_000;
          const row = (kind: 'pause' | 'play', clientMs: number) =>
            ({ labId: lab.id, userId: ana.id, sessionStartedAt: startedAt, kind, positionMs: stop, clientMs, at: startedAt + clientMs + 50 });
          const after = pageLog(lab.id, ana.id, startedAt, { voice: () => null })
            .filter((r) => r.positionMs > stop)
            .map((r) => ({ ...r, clientMs: r.clientMs + 8000, at: r.at + 8000 }));
          await testDb.insert(schema.labListenEvents).values([
            ...pageLog(lab.id, ana.id, startedAt, { upTo: 500_000, voice: (i) => (i < 15 ? 900 : i === 15 ? 0 : null) }),
            row('pause', SETUP_MS + stop),
            row('play', SETUP_MS + stop + 8000),
            ...after,
          ]);
          await markNoMic(api.ana, lab.id, { ...session, startedAt }, stop, SETUP_MS + stop + 4000);
          // A second after the mark, the script's report dated 2 s after the stop (before the mark), saying
          // playback reached the window's end, with 1.5 s for that pause: in the page's order it sits before
          // the mark, and it would make 16.
          await heartbeatAt(api.ana, startedAt + SETUP_MS + stop + 5000, {
            labId: lab.id, startToken: session.startToken, kind: 'tick',
            positionMs: COUNTED[16][1], clientMs: SETUP_MS + stop + 2000, answers: [[COUNTED[16][0], 1500]],
          });
          const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, {
            mic: 'off', voicedMs: 15_000, pausedVoicedMs: 0, outsideVoicedMs: 0, outsidePlayedMs: 480_000,
            clientMs: SETUP_MS + REQUIRED + 13_000,
          }));
          // It arrived after the mark: a result the page could not have sent. Enough answered with it, so held.
          expect(result).toMatchObject({ credit: false, status: 'check', mic: 'off', pausesAnswered: 16 });
          expect(await rowOf(ana.id)).toMatchObject({ heldFor: '["odd-answers"]' });
          expect(JSON.parse((await rowOf(ana.id)).flags!)).toEqual(['odd-answers']);
        });

        it('leaves the page’s own results alone: those before the mark, and those the mark carries', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          // 16 pauses answered; the student paused just after the 17th, whose result was still queued, and the
          // microphone stopped: the page went on without it, and the mark carries that result.
          const startedAt = Date.now() - (REQUIRED + 90_000);
          const session = await openAt(api.ana, lab.id, startedAt);
          const stop = 504_300;
          const row = (kind: 'pause' | 'play', clientMs: number) =>
            ({ labId: lab.id, userId: ana.id, sessionStartedAt: startedAt, kind, positionMs: stop, clientMs, at: startedAt + clientMs + 50 });
          const after = pageLog(lab.id, ana.id, startedAt, { voice: () => null })
            .filter((r) => r.positionMs > stop)
            .map((r) => ({ ...r, clientMs: r.clientMs + 8000, at: r.at + 8000 }));
          await testDb.insert(schema.labListenEvents).values([
            ...pageLog(lab.id, ana.id, startedAt, { upTo: 500_000, voice: (i) => (i < 16 ? 900 : null) }),
            row('pause', SETUP_MS + stop),
            row('play', SETUP_MS + stop + 8000),
            ...after,
          ]);
          await markNoMic(api.ana, lab.id, { ...session, startedAt }, stop, SETUP_MS + stop + 4000, [[COUNTED[16][0], 900]]);
          const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, {
            mic: 'off', voicedMs: 16_000, pausedVoicedMs: 0, outsideVoicedMs: 500, outsidePlayedMs: 480_000,
            clientMs: SETUP_MS + REQUIRED + 13_000,
          }));
          expect(result).toMatchObject({ credit: true, status: 'done', mic: 'off', pausesAnswered: 17 });
          expect(await rowOf(ana.id)).toMatchObject({ heldFor: null, flags: '[]', rejectedAnswers: 0 });
        });
      });

      it('counts voice heard while paused: answers given while paused, then the microphone lost, get credit at 75%', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // 17 pauses answered: 15 while playing (0.9 s each: 13.5 s) and 2 while paused (1.5 s each: 3 s).
        const session = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 15 ? 900 : i < 17 ? 1500 : null) });
        const fields = { mic: 'off', voicedMs: 13_500, outsideVoicedMs: 500, outsidePlayedMs: 580_000 };
        const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, { ...fields, pausedVoicedMs: 3000 }));
        expect(result).toMatchObject({ credit: true, status: 'done', pausesAnswered: 17 });
        expect(await rowOf(ana.id)).toMatchObject({ heldFor: null, flags: '[]' });
        // Without the paused voice, 17 s in the pauses and outside is more than the 13.5 s heard playing.
        const betoSession = await scoredSession(api.beto, beto.id, lab.id, { voice: (i) => (i < 15 ? 900 : i < 17 ? 1500 : null) });
        expect((await api.beto.submit(turnIn(lab.id, betoSession.startToken, fields))).result)
          .toMatchObject({ credit: false, status: 'check' });
        expect(await rowOf(beto.id)).toMatchObject({ heldFor: '["odd-answers"]' });
      });

      it('keeps a report with other results at the same moment as the page’s: both count, and they conflict', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const startedAt = Date.now() - (REQUIRED + 60_000);
        const session = await openAt(api.ana, lab.id, startedAt);
        const log = pageLog(lab.id, ana.id, startedAt, { voice: () => 0 });
        await testDb.insert(schema.labListenEvents).values(log.filter((r) => r.positionMs !== 25_000));
        const report = log.find((r) => r.positionMs === 25_000)!;
        const input = { labId: lab.id, startToken: session.startToken, kind: 'tick' as const, positionMs: 25_000, clientMs: report.clientMs };
        // The script's copy of the page's next report, with its own result, sent first.
        await heartbeatAt(api.ana, report.at - 20, { ...input, answers: [[COUNTED[0][0], 1500]] });
        await heartbeatAt(api.ana, report.at, { ...input, answers: [[COUNTED[0][0], 0]] });
        await api.ana.submit(turnIn(lab.id, session.startToken, { voicedMs: 0 }));
        const row = await rowOf(ana.id);
        expect(JSON.parse(row.pauseResults!)[0]).toEqual([COUNTED[0][0], -2]);
        expect(JSON.parse(row.flags!)).toContain('odd-answers');
      });

      it('leaves an honest microphone loss alone: no flag, credit when enough was answered before it', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        // 17 pauses answered, 0.9 s each, then the microphone was lost; the page heard 16 s in all.
        const session = await scoredSession(api.ana, ana.id, lab.id, { voice: (i) => (i < 17 ? 900 : null) });
        const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, { mic: 'off', voicedMs: 16_000, outsideVoicedMs: 500, outsidePlayedMs: 580_000 }));
        expect(result).toMatchObject({ credit: true, status: 'done', pausesAnswered: 17 });
        expect(await rowOf(ana.id)).toMatchObject({ heldFor: null, flags: '[]' });
        // A mic-on session is never judged by the page's total: an honest answer given while paused is not in it.
        const betoSession = await scoredSession(api.beto, beto.id, lab.id, { voice: () => 1800 });
        expect((await api.beto.submit(turnIn(lab.id, betoSession.startToken, { voicedMs: 0 }))).result).toMatchObject({ credit: true, pausesAnswered: 21 });
        expect(await rowOf(beto.id)).toMatchObject({ heldFor: null, flags: '[]' });
      });

      it('stores a report sent again once, even when the submit carries it too: no odd results', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const startedAt = Date.now() - (REQUIRED + 60_000);
        const session = await openAt(api.ana, lab.id, startedAt);
        const log = pageLog(lab.id, ana.id, startedAt);
        await testDb.insert(schema.labListenEvents).values(log.filter((r) => r.positionMs !== 25_000));
        const report = log.find((r) => r.positionMs === 25_000)!;
        const input = {
          labId: lab.id, startToken: session.startToken, kind: 'tick' as const, positionMs: 25_000, clientMs: report.clientMs,
          answers: JSON.parse(report.answers as string) as [number, number][],
        };
        await heartbeatAt(api.ana, report.at, input);
        await heartbeatAt(api.ana, report.at + 3000, input);
        const { result } = await api.ana.submit(turnIn(lab.id, session.startToken, {
          reports: [{ kind: 'tick', positionMs: 25_000, clientMs: report.clientMs, answers: input.answers }],
        }));
        expect(result).toMatchObject({ credit: true, pausesAnswered: 21 });
        expect(await rowOf(ana.id)).toMatchObject({ rejectedAnswers: 0, flags: '[]', heldFor: null });
      });

      describe('two labs at once', () => {
        /** Sessions on two labs whose logs overlap for ten minutes. */
        async function twoAtOnce(caller: Callers['ana'], userId: number, firstLab: number, secondLab: number) {
          const first = await scoredSession(caller, userId, firstLab, { startedAt: Date.now() - (REQUIRED + 80_000) });
          const second = await scoredSession(caller, userId, secondLab, { startedAt: Date.now() - (REQUIRED + 60_000) });
          return { first, second };
        }

        it('holds the second different lab turned in, and leaves the first its credit and flag', async () => {
          const api = await load();
          const labA = await scannedLab(api, { title: 'Lab A' });
          const labB = await scannedLab(api, { title: 'Lab B' });
          const { first, second } = await twoAtOnce(api.ana, ana.id, labA.id, labB.id);

          expect((await api.ana.submit(turnIn(labA.id, first.startToken))).result).toMatchObject({ credit: true, status: 'done' });
          expect((await api.ana.submit(turnIn(labB.id, second.startToken))).result).toMatchObject({ credit: false, status: 'check' });
          const rows = await testDb.query.labSubmissions.findMany({ orderBy: (r, { asc }) => [asc(r.id)] });
          expect(rows.map((r) => [r.labId, r.credit, r.heldFor, r.flags])).toEqual([
            [labA.id, true, null, '["overlap"]'],
            [labB.id, false, '["overlap"]', '["overlap"]'],
          ]);

          // The other order: B first keeps its credit, and A waits.
          const beto2 = await twoAtOnce(api.beto, beto.id, labA.id, labB.id);
          expect((await api.beto.submit(turnIn(labB.id, beto2.second.startToken))).result).toMatchObject({ status: 'done' });
          expect((await api.beto.submit(turnIn(labA.id, beto2.first.startToken))).result).toMatchObject({ status: 'check' });
        });

        it('never holds two windows on the same lab, or a second lab that was never turned in', async () => {
          const api = await load();
          const lab = await scannedLab(api);
          const other = await scannedLab(api, { title: 'Another lab' });
          const { first, second } = await twoAtOnce(api.ana, ana.id, lab.id, lab.id);
          await api.ana.submit(turnIn(lab.id, first.startToken));
          expect((await api.ana.submit(turnIn(lab.id, second.startToken))).result).toMatchObject({ credit: true, status: 'done' });
          const rows = await testDb.query.labSubmissions.findMany();
          expect(rows.map((r) => [r.credit, r.heldFor, r.flags])).toEqual([[true, null, '["overlap"]'], [true, null, '["overlap"]']]);

          // Beto opened another lab in a second window and left it: nothing turned in there, nothing held here.
          const { second: betoSecond } = await twoAtOnce(api.beto, beto.id, other.id, lab.id);
          expect((await api.beto.submit(turnIn(lab.id, betoSecond.startToken))).result).toMatchObject({ credit: true });
          expect(await rowOf(beto.id)).toMatchObject({ heldFor: null, flags: '["overlap"]' });
        });

        it('holds nothing while the rule is off (0%): both count, both flagged', async () => {
          const api = await load();
          await api.admin.saveSettings({ minAnsweredPct: 0 });
          const labA = await scannedLab(api, { title: 'Lab A' });
          const labB = await scannedLab(api, { title: 'Lab B' });
          const { first, second } = await twoAtOnce(api.ana, ana.id, labA.id, labB.id);
          await api.ana.submit(turnIn(labA.id, first.startToken));
          expect((await api.ana.submit(turnIn(labB.id, second.startToken))).result).toMatchObject({ credit: true, status: 'done' });
          const rows = await testDb.query.labSubmissions.findMany();
          expect(rows.every((r) => r.heldFor === null && r.flags === '["overlap"]')).toBe(true);
        });
      });

      it('holds for voice outside the pauses only when the teacher chose to, from 15% of the time outside', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const noisy = { outsidePlayedMs: 400_000, outsideVoicedMs: 120_000 };
        // Off (the default): the flag only.
        const off = await scoredSession(api.ana, ana.id, lab.id);
        expect((await api.ana.submit(turnIn(lab.id, off.startToken, noisy))).result).toMatchObject({ credit: true });
        expect(await rowOf(ana.id)).toMatchObject({ heldFor: null, flags: '["noisy"]' });

        // On, for sessions that begin from now on.
        await api.admin.saveSettings({ holdOutsideVoice: true });
        const on = await scoredSession(api.beto, beto.id, lab.id);
        expect((await api.beto.submit(turnIn(lab.id, on.startToken, noisy))).result).toMatchObject({ credit: false, status: 'check' });
        expect(await rowOf(beto.id)).toMatchObject({ heldFor: '["noisy"]', flags: '["noisy"]' });
        // Shorter answers (0.4 s: 11% of the pauses), and 12% of the time outside: flagged (from 10%), not held (from 15%).
        const mild = await scoredSession(api.carla, carla.id, lab.id, { voice: () => 400 });
        expect((await api.carla.submit(turnIn(lab.id, mild.startToken, { outsidePlayedMs: 400_000, outsideVoicedMs: 48_000 }))).result)
          .toMatchObject({ credit: true });
        expect(await rowOf(carla.id)).toMatchObject({ heldFor: null, flags: '["noisy"]' });
      });

      it('judges a session opened before v1.16.0 (rules without the new fields) as before: never held for voice outside', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await api.admin.saveSettings({ holdOutsideVoice: true });
        const { signLabStart } = await import('../services/labMedia.js');
        const startedAt = Date.now() - (REQUIRED + 60_000);
        await testDb.insert(schema.labListenEvents).values({
          labId: lab.id, userId: ana.id, sessionStartedAt: startedAt, kind: 'open', positionMs: 0, clientMs: 0, at: startedAt,
          rules: JSON.stringify({ v: 1, pauses: COUNTED, pct: 75, floor: 250, requiredThroughMs: REQUIRED }),
        });
        await testDb.insert(schema.labListenEvents).values(pageLog(lab.id, ana.id, startedAt));
        const { result } = await api.ana.submit(turnIn(lab.id, signLabStart(lab.id, ana.id, startedAt), { outsidePlayedMs: 400_000, outsideVoicedMs: 120_000 }));
        expect(result).toMatchObject({ credit: true, pausesAnswered: 21, needed: 16 });
        expect(await rowOf(ana.id)).toMatchObject({ heldFor: null, flags: '["noisy"]', micStats: null });
      });

      it('stores the page’s mic stats within their bounds, and leaves out any that are not, without refusing the lab', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const stats = {
          meter: 2, ambientDbP50: -52.34, gateDbP50: -46.34, voiceOverGateDbP50: 9.06, levelOnlyAnswered: 19,
          loudNotVoiceInPausesMs: 1200.4, unfocusedPlayedMs: 75_000, micCheck: 'voice',
          processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000, deviceId: 'abc' },
        };
        const session = await scoredSession(api.ana, ana.id, lab.id);
        await api.ana.submit(turnIn(lab.id, session.startToken, { micStats: stats }));
        const stored = JSON.parse((await rowOf(ana.id)).micStats!);
        expect(stored).toEqual({
          meter: 2, ambientDbP50: -52.3, gateDbP50: -46.3, voiceOverGateDbP50: 9.1, levelOnlyAnswered: 19,
          loudNotVoiceInPausesMs: 1200, unfocusedPlayedMs: 75_000, micCheck: 'voice',
          processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000 },
        });
        expect((await api.admin.submissions({ labId: lab.id })).submissions[0].micStats).toEqual(stored);

        for (const [caller, userId, bad] of [
          [api.beto, beto.id, { ...stats, ambientDbP50: 21 }],
          [api.carla, carla.id, { ...stats, meter: 1 }],
        ] as const) {
          const s2 = await scoredSession(caller, userId, lab.id);
          await expect(caller.submit(turnIn(lab.id, s2.startToken, { micStats: bad }))).resolves.toMatchObject({ result: { credit: true } });
          expect((await rowOf(userId)).micStats).toBeNull();
        }
        expect((await api.admin.submissions({ labId: lab.id })).submissions.map((s) => s.micStats === null)).toEqual([false, true, true]);
      });
    });

    describe('what the Labs list counts', () => {
      it('counts a red flag on any attempt as flagged, and an amber one on the counting attempt as one to look at', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const scored = { pausesCounted: 21, pausesAnswered: 21, minAnsweredPct: 75 };
        // Ana: "Two at once" only, credited: one to look at.
        await addSubmission(lab.id, ana.id, { ...scored, flags: '["overlap"]' });
        // Beto: "Sent late" on an earlier attempt, then a clean credited one: still flagged.
        await addSubmission(lab.id, beto.id, { ...scored, credit: false, flags: '["late"]', submittedAt: new Date('2026-09-24T10:00:00Z') });
        await addSubmission(lab.id, beto.id, scored);
        // Carla: No microphone at 0%, credited: one to look at.
        await addSubmission(lab.id, carla.id, { ...scored, mic: 'off', minAnsweredPct: 0 });
        expect((await api.admin.adminList())[0]).toMatchObject({ doneCount: 3, checkCount: 0, flaggedCount: 1, lookCount: 2 });
      });

      it('does not count as one to look at a student who waits, or No microphone only on an earlier attempt', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const scored = { pausesCounted: 21, pausesAnswered: 21, minAnsweredPct: 75 };
        // Ana: No microphone at 75%, not enough before it was lost: waiting for the teacher.
        await addSubmission(lab.id, ana.id, { ...scored, pausesAnswered: 3, credit: false, mic: 'off' });
        // Beto: No microphone on an earlier attempt, then a clean one.
        await addSubmission(lab.id, beto.id, { ...scored, credit: false, mic: 'off', pausesAnswered: 2, submittedAt: new Date('2026-09-24T10:00:00Z') });
        await addSubmission(lab.id, beto.id, scored);
        // Carla: held for a second lab at once (waiting), with its amber flag.
        await addSubmission(lab.id, carla.id, { ...scored, credit: false, flags: '["overlap"]', heldFor: '["overlap"]' });
        expect((await api.admin.adminList())[0]).toMatchObject({ doneCount: 1, checkCount: 2, flaggedCount: 0, lookCount: 0 });

        // An amber flag other than No microphone on an earlier attempt is worth a look.
        await addSubmission(lab.id, beto.id, { ...scored, credit: false, flags: '["constant-sound"]', submittedAt: new Date('2026-09-23T10:00:00Z') });
        expect((await api.admin.adminList())[0]).toMatchObject({ flaggedCount: 0, lookCount: 1 });
      });
    });

    describe('“Short answers”', () => {
      const extra = [10, 11, 12, 13, 14, 15];
      async function classmates() {
        await testDb.insert(schema.users).values(extra.map((id) => ({ id, googleId: `g-${id}`, email: `s${id}@example.com`, name: `Student ${id}`, role: 'user' as const })));
      }
      /** A scored row whose answered pauses each took `ms` (12 of 12 pauses answered unless told). */
      const answeredRow = (labId: number, userId: number, ms: number, answered = 12) => addSubmission(labId, userId, {
        pausesCounted: 12, pausesAnswered: answered, minAnsweredPct: 75, voicePerPauseMs: 250,
        pauseResults: JSON.stringify(Array.from({ length: 12 }, (_, i) => [20_000 + i * 30_000, i < answered ? ms : 0])),
      });

      it('flags answers under half the class’s on the same lab, against at least five other students', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await classmates();
        await answeredRow(lab.id, ana.id, 499);
        await answeredRow(lab.id, beto.id, 500);
        for (const id of extra.slice(0, 4)) await answeredRow(lab.id, id, 1000);
        const flagsOf = async () => Object.fromEntries((await api.admin.submissions({ labId: lab.id })).submissions.map((s) => [s.userId, s.flags]));
        // Ana's class is Beto and four at 1 s: its median is 1 s, and 499 is under half. Beto's class has Ana: 1 s too.
        expect(await flagsOf()).toMatchObject({ [ana.id]: ['short-answers'], [beto.id]: [] });
        // It is never stored, never red, and never changes credit.
        expect((await testDb.query.labSubmissions.findMany()).every((r) => r.flags === '[]' && r.credit)).toBe(true);
        expect((await api.admin.adminList())[0]).toMatchObject({ flaggedCount: 0, lookCount: 0 });
      });

      it('needs ten answered pauses on the row and five other students with them', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        await classmates();
        await answeredRow(lab.id, ana.id, 300, 9);
        for (const id of extra.slice(0, 4)) await answeredRow(lab.id, id, 1000);
        // Beto answered only nine: he is not part of the class to compare with.
        await answeredRow(lab.id, beto.id, 1000, 9);
        let flags = (await api.admin.submissions({ labId: lab.id })).submissions.flatMap((s) => s.flags);
        expect(flags).not.toContain('short-answers');
        await answeredRow(lab.id, carla.id, 300, 10);
        flags = (await api.admin.submissions({ labId: lab.id })).submissions.flatMap((s) => s.flags);
        // Carla has ten; her class is four at 1 s and Ana's nine do not count: still under five.
        expect(flags).not.toContain('short-answers');
        await answeredRow(lab.id, extra[4], 1000);
        const carlaRow = (await api.admin.submissions({ labId: lab.id })).submissions.find((s) => s.userId === carla.id)!;
        expect(carlaRow.flags).toEqual(['short-answers']);
      });
    });

    describe('pause lists and settings', () => {
      it('stores the pauses and scan found at upload, with when they were found', async () => {
        const api = await load();
        const before = Date.now();
        const lab = await scannedLab(api);
        const row = (await testDb.query.labs.findMany())[0];
        expect(JSON.parse(row.pauses!)).toEqual(PAUSES);
        const scan = JSON.parse(row.pauseScan!);
        expect(scan).toMatchObject(SCAN);
        expect(scan.scannedAt).toBeGreaterThanOrEqual(before);
        expect(lab.id).toBe(row.id);
        // Without a scan, a lab is created as before: no pause list.
        await createLab(api, { title: 'No scan' });
        expect((await testDb.query.labs.findMany())[1]).toMatchObject({ pauses: null, pauseScan: null });
      });

      it('refuses a pause list that does not fit the lab, at upload and when saved again', async () => {
        const api = await load();
        const { PAUSE_LIST_MESSAGE } = await import('./labs.js');
        const bad: [number, number][][] = [
          [[30_000, 34_000], [20_000, 24_000]], // unsorted
          [[20_000, 24_000], [23_000, 27_000]], // overlapping
          [[698_000, 701_000]], // past the end of the audio
          [[20_000, 20_500]], // too short
          [[20_000, 90_000]], // too long
          Array.from({ length: 401 }, (_, i) => [i * 1500, i * 1500 + 1000] as [number, number]), // too many
          [[20_000.5, 24_000]], // not whole milliseconds
        ];
        for (const pauses of bad) {
          await expect(createLab(api, { pauses, scan: SCAN })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: PAUSE_LIST_MESSAGE });
        }
        expect(await testDb.query.labs.findMany()).toHaveLength(0);
        expect(PAUSE_LIST_MESSAGE).toBe('This pause list does not fit the lab. Find the pauses again.');

        const lab = await createLab(api);
        for (const pauses of bad) {
          await expect(api.admin.setPauses({ id: lab.id, pauses, scan: SCAN })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        }
        await expect(api.admin.setPauses({ id: lab.id, pauses: PAUSES, scan: { ...SCAN, closeCalls: 401 } }))
          .rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(api.admin.setPauses({ id: lab.id, pauses: PAUSES, scan: { ...SCAN, noiseDb: 5 } }))
          .rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(api.admin.setPauses({ id: 9999, pauses: PAUSES, scan: SCAN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect((await testDb.query.labs.findMany())[0].pauses).toBeNull();
      });

      it('saves a new pause list and keeps “don’t count pauses after”, which can be cleared', async () => {
        const api = await load();
        const lab = await createLab(api);
        await api.admin.update({ id: lab.id, pauseCountUntilMs: 100_000 });
        await expect(api.admin.setPauses({ id: lab.id, pauses: PAUSES, scan: SCAN })).resolves.toMatchObject({
          success: true, pauseCount: 3, pauseTotal: 22, pauseCountUntilMs: 100_000, needsCheck: false,
        });
        await expect(api.admin.setPauses({ id: lab.id, pauses: [], scan: SCAN })).resolves.toMatchObject({ pauseCount: 0, pauseTotal: 0 });
        await api.admin.update({ id: lab.id, pauseCountUntilMs: null });
        expect((await testDb.query.labs.findMany())[0]).toMatchObject({ pauses: '[]', pauseCountUntilMs: null });
      });

      it('reads and saves the pause rule, within its ranges', async () => {
        const api = await load();
        const meter = { gateMarginDb: 6, holdOutsideVoice: false };
        await expect(api.admin.settings()).resolves.toEqual({ minAnsweredPct: 75, voicePerPauseMs: 250, ...meter });
        await expect(api.admin.saveSettings({ minAnsweredPct: 60, voicePerPauseMs: 400 })).resolves.toEqual({ minAnsweredPct: 60, voicePerPauseMs: 400, ...meter });
        await expect(api.admin.saveSettings({ voicePerPauseMs: 500 })).resolves.toEqual({ minAnsweredPct: 60, voicePerPauseMs: 500, ...meter });
        // The floor goes down to 0.2 s; the room margin is 4–12 dB, in whole dB.
        await expect(api.admin.saveSettings({ voicePerPauseMs: 200, gateMarginDb: 12, holdOutsideVoice: true }))
          .resolves.toEqual({ minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 12, holdOutsideVoice: true });
        await expect(api.admin.saveSettings({ gateMarginDb: 4, holdOutsideVoice: false }))
          .resolves.toEqual({ minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 4, holdOutsideVoice: false });
        for (const input of [
          { minAnsweredPct: 101 }, { minAnsweredPct: -1 }, { voicePerPauseMs: 199 }, { voicePerPauseMs: 2001 }, { minAnsweredPct: 50.5 },
          { gateMarginDb: 3 }, { gateMarginDb: 13 }, { gateMarginDb: 6.5 }, { holdOutsideVoice: 'yes' },
        ]) {
          await expect(api.admin.saveSettings(input as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        }
        await expect(api.admin.settings()).resolves.toEqual({ minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 4, holdOutsideVoice: false });
      });

      it('keeps all of it for the teacher', async () => {
        const api = await load();
        const lab = await scannedLab(api);
        const row = await addSubmission(lab.id, ana.id);
        for (const call of [
          () => api.ana.setPauses({ id: lab.id, pauses: PAUSES, scan: SCAN }),
          () => api.ana.pauses({ id: lab.id }),
          () => api.ana.setCredit({ submissionIds: [row.id], credit: true }),
          () => api.ana.settings(),
          () => api.ana.saveSettings({ minAnsweredPct: 0 }),
        ]) {
          await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
        expect(await testDb.query.labSettings.findMany()).toHaveLength(0);
      });
    });
  });
});
