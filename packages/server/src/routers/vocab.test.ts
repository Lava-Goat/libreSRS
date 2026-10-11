// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const adminUser = {
  id: 1,
  googleId: 'admin-google-id',
  email: 'admin@example.com',
  name: 'Admin',
  picture: null,
  role: 'admin' as const,
};

const studentUser = {
  id: 2,
  googleId: 'student-google-id',
  email: 'student@example.com',
  name: 'Student',
  picture: null,
  role: 'user' as const,
};

const outsiderUser = {
  id: 3,
  googleId: 'outsider-google-id',
  email: 'outsider@example.com',
  name: 'Outsider',
  picture: null,
  role: 'user' as const,
};

type AnyUser = typeof adminUser | typeof studentUser | typeof outsiderUser;

async function loadCallers() {
  const { vocabRouter } = await import('./vocab.js');
  const callerFor = (user: AnyUser) => vocabRouter.createCaller({
    req: { user } as unknown as Request,
    res: {} as Response,
    user,
    requestId: null,
  });
  return {
    admin: callerFor(adminUser),
    student: callerFor(studentUser),
    outsider: callerFor(outsiderUser),
  };
}

const SIZE_SUMMARY = {
  v: 1 as const,
  yn: {
    bands: [[10, 9], [10, 7], [12, 6], [10, 3], [8, 1]] as [number, number][],
    ps: [15, 1] as [number, number],
  },
};

/** The "repeat the sentence" transcription switch (Admin > AI), as migration 0049 or the page sets it. */
async function setTranscriptionSwitch(on: boolean) {
  await client.execute(`INSERT INTO app_settings (id, ai_transcription_enabled) VALUES (1, ${on ? 1 : 0})
    ON CONFLICT(id) DO UPDATE SET ai_transcription_enabled = excluded.ai_transcription_enabled`);
}

describe('vocab router', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'admin-google-id', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'student-google-id', email: 'student@example.com', name: 'Student', role: 'user' },
      { id: 3, googleId: 'outsider-google-id', email: 'outsider@example.com', name: 'Outsider', role: 'user' },
    ]);

    await testDb.insert(schema.groups).values([
      { id: 1, name: 'Español 2' },
      { id: 2, name: 'Español 3' },
    ]);

    await testDb.insert(schema.userGroups).values([
      { userId: 2, groupId: 1 },
      { userId: 3, groupId: 2 },
    ]);
  });

  it('admin can create a test assigned to groups and students in those groups see it when open', async () => {
    const { admin, student, outsider } = await loadCallers();

    const test = await admin.createTest({
      name: 'Sondeo semana 1',
      mode: 's5000',
      occasion: 'Otoño 2026',
      settings: { blk: 1 },
      groupIds: [1],
      isOpen: true,
    });
    expect(test.id).toBeDefined();

    const forStudent = await student.listOpenTests();
    expect(forStudent).toHaveLength(1);
    expect(forStudent[0].name).toBe('Sondeo semana 1');
    expect(forStudent[0].settings.blk).toBe(1);
    expect(forStudent[0].myAttempts).toBe(0);

    const forOutsider = await outsider.listOpenTests();
    expect(forOutsider).toHaveLength(0);
  });

  it('closed tests and out-of-window tests are hidden and reject submissions', async () => {
    const { admin, student } = await loadCallers();

    const closed = await admin.createTest({
      name: 'Cerrada', mode: 'size', groupIds: [1], isOpen: false,
    });
    const expired = await admin.createTest({
      name: 'Expirada', mode: 'size', groupIds: [1], isOpen: true,
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await student.listOpenTests()).toHaveLength(0);

    for (const testId of [closed.id, expired.id]) {
      await expect(student.submitResult({
        testId,
        seed: 42,
        summary: SIZE_SUMMARY,
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('records a submission under the logged-in student and blocks students outside assigned groups', async () => {
    const { admin, student, outsider } = await loadCallers();

    const test = await admin.createTest({
      name: 'Tamaño y cobertura', mode: 'size', occasion: 'Otoño 2026', groupIds: [1], isOpen: true,
    });

    const submitted = await student.submitResult({
      testId: test.id,
      seed: 123,
      summary: SIZE_SUMMARY,
      responses: [{ w: 'de', b: 0, t: 'real', yes: true, ms: 800 }],
      durationMs: 360_000,
    });
    expect(submitted.id).toBeDefined();

    await expect(outsider.submitResult({
      testId: test.id,
      seed: 5,
      summary: SIZE_SUMMARY,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const mine = await student.getMyResults();
    expect(mine).toHaveLength(1);
    expect(mine[0].mode).toBe('size');
    expect(mine[0].occasion).toBe('Otoño 2026');
    expect(JSON.parse(mine[0].summaryJson)).toEqual(SIZE_SUMMARY);

    const adminView = await admin.getResults({ testId: test.id });
    expect(adminView).toHaveLength(1);
    expect(adminView[0].userId).toBe(2);
    expect(adminView[0].userName).toBe('Student');

    const open = await student.listOpenTests();
    expect(open[0].myAttempts).toBe(1);
  });

  it('accepts v2 protocol summaries and stores block/form metadata', async () => {
    const { admin, student } = await loadCallers();

    const test = await admin.createTest({
      name: 'Censo bloque 3', mode: 'c500', settings: { blk: 3 }, groupIds: [1], isOpen: true,
    });

    await student.submitResult({
      testId: test.id,
      seed: 7,
      blk: '3',
      summary: { v: 2, res: [[0, 2], [10, 1], [42, 2]], ps: [5, 0] },
    });

    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    expect(results[0].blk).toBe('3');
    expect(results[0].mode).toBe('c500');
  });

  it('updateTest can reassign groups and toggle open state', async () => {
    const { admin, student, outsider } = await loadCallers();

    const test = await admin.createTest({
      name: 'Dominio', mode: 'mastery', groupIds: [1], isOpen: true,
    });

    expect(await student.listOpenTests()).toHaveLength(1);
    expect(await outsider.listOpenTests()).toHaveLength(0);

    await admin.updateTest({ id: test.id, groupIds: [2] });
    expect(await student.listOpenTests()).toHaveLength(0);
    expect(await outsider.listOpenTests()).toHaveLength(1);

    await admin.updateTest({ id: test.id, isOpen: false });
    expect(await outsider.listOpenTests()).toHaveLength(0);

    const tests = await admin.listTests();
    expect(tests).toHaveLength(1);
    expect(tests[0].groups.map((g) => g.id)).toEqual([2]);
    expect(tests[0].isOpen).toBe(false);
  });

  it('rejects a window that closes before it opens, on create and on update', async () => {
    const { admin } = await loadCallers();
    const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 3_600_000;

    await expect(admin.createTest({
      name: 'Al revés', mode: 'size', groupIds: [1], isOpen: true,
      opensAt: at(2 * HOUR), closesAt: at(HOUR),
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await admin.listTests()).toHaveLength(0);

    const test = await admin.createTest({
      name: 'Ventana', mode: 'size', groupIds: [1], isOpen: true,
      opensAt: at(HOUR), closesAt: at(3 * HOUR),
    });
    // Moving only one end is checked against the stored other end.
    await expect(admin.updateTest({ id: test.id, closesAt: at(30 * 60_000) }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(admin.updateTest({ id: test.id, opensAt: at(4 * HOUR) }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Toggling isOpen alone never trips the check; clearing an end is fine.
    await admin.updateTest({ id: test.id, isOpen: false });
    await admin.updateTest({ id: test.id, opensAt: null, closesAt: at(30 * 60_000) });
    const [stored] = await admin.listTests();
    expect(stored.opensAt).toBeNull();
    expect(stored.isOpen).toBe(false);
  });

  it('rejects malformed summaries and non-admin access to admin procedures', async () => {
    const { admin, student } = await loadCallers();

    const test = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });

    await expect(student.submitResult({
      testId: test.id,
      seed: 1,
      // wrong band count: only 2 bands
      summary: { v: 1, yn: { bands: [[10, 9], [10, 7]] as [number, number][], ps: [15, 1] as [number, number] } },
    })).rejects.toBeInstanceOf(TRPCError);

    await expect(student.listTests()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // The summary is a sufficient statistic the student's own browser computes,
  // so every field the dashboard/profile/anuario later divides by is
  // range-checked here. Garbage that gets stored renders as garbage for the
  // teacher, permanently.
  it('rejects internally inconsistent summaries from a hostile client', async () => {
    const { admin, student } = await loadCallers();

    const sizeTest = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });
    const submit = (summary: unknown) => student.submitResult({
      testId: sizeTest.id,
      seed: 1,
      summary: summary as Parameters<typeof student.submitResult>[0]['summary'],
    });

    // more "sí" than items → h > 1 → an inflated size for every viewer
    await expect(submit({
      v: 1,
      yn: { bands: [[10, 99], [10, 7], [10, 6], [10, 3], [10, 1]], ps: [15, 1] },
    })).rejects.toBeInstanceOf(TRPCError);

    // more false alarms than pseudowords
    await expect(submit({
      v: 1,
      yn: { bands: [[10, 9], [10, 7], [10, 6], [10, 3], [10, 1]], ps: [15, 99] },
    })).rejects.toBeInstanceOf(TRPCError);

    // c + w + o must partition n, or (c − w/3)/n is nonsense
    await expect(submit({ v: 1, mc: { n: 20, c: 20, w: 20, o: 20 } })).rejects.toBeInstanceOf(TRPCError);

    // C-test restorations cannot exceed the gaps attempted
    await expect(submit({ v: 1, ct: { n: 10, c: 99, cl: 99 } })).rejects.toBeInstanceOf(TRPCError);

    // word indices outside the top-5.000 rank domain
    await expect(submit({ v: 2, res: [[99999, 2]], ps: [5, 0] })).rejects.toBeInstanceOf(TRPCError);
    // and states outside 0-3
    await expect(submit({ v: 2, res: [[10, 9]], ps: [5, 0] })).rejects.toBeInstanceOf(TRPCError);

    // the well-formed equivalents still go through
    await submit({ v: 1, mc: { n: 20, c: 12, w: 6, o: 2 } });
    await submit({ v: 1, ct: { n: 10, c: 7, cl: 8 } });
    await submit({ v: 2, res: [[10, 0], [11, 3]], ps: [5, 0] });
    const stored = await admin.getResults({ testId: sizeTest.id });
    expect(stored).toHaveLength(3);
  });

  it('computes attempt quality metrics at submit and returns them to admins', async () => {
    const { admin, student } = await loadCallers();

    const test = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });

    // High false-alarm summary + fast yes responses → flagged attempt
    await student.submitResult({
      testId: test.id,
      seed: 1,
      summary: {
        v: 1,
        yn: { bands: [[10, 10], [10, 10], [12, 12], [10, 10], [8, 8]] as [number, number][], ps: [15, 7] as [number, number] },
      },
      responses: Array.from({ length: 65 }, (_, i) => ({
        w: `w${i}`, b: i % 5, t: i < 50 ? 'real' : 'pseudo', yes: true, ms: 300,
      })),
    });

    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    const quality = JSON.parse(results[0].qualityJson as string);
    expect(quality.flagged).toBe(true);
    expect(quality.faRate).toBeCloseTo(7 / 15, 5);
    expect(quality.medianMs).toBe(300);
    expect(quality.fastYesShare).toBe(1);
  });

  describe('attempt-quality flags for Spanish 1 beginners', () => {
    type Summary = Parameters<Awaited<ReturnType<typeof loadCallers>>['student']['submitResult']>[0]['summary'];

    /** Submit one attempt to a fresh open test and return its stored qualityJson. */
    async function qualityOf(mode: 'size' | 'ldt' | 'c500' | 'a500' | 's5000', summary: Summary, responses: Record<string, unknown>[]) {
      const { admin, student } = await loadCallers();
      const test = await admin.createTest({ name: `Prueba ${mode}`, mode, groupIds: [1], isOpen: true });
      await student.submitResult({ testId: test.id, seed: 1, summary, responses });
      const [row] = await admin.getResults({ testId: test.id });
      return JSON.parse(row.qualityJson as string) as { flagged: boolean; medianMs: number | null; medianYesMs: number | null; faRate: number | null };
    }

    const cleanSize = (yes: number) => ({
      v: 1 as const,
      yn: { bands: [[20, yes], [20, 0], [20, 0], [20, 0], [5, 0]] as [number, number][], ps: [10, 0] as [number, number] },
    });
    const noAnswers = (n: number, ms: number) => Array.from({ length: n }, (_, i) => ({
      w: `no${i}`, b: i % 5, t: i % 6 === 0 ? 'pseudo' : 'real', yes: false, ms,
    }));
    /** "sí" on top-1000 real words: the fast-yes rule (pseudo/b>=2 only) cannot see them. */
    const easyYes = (n: number, ms: number) => Array.from({ length: n }, (_, i) => ({
      w: `si${i}`, b: i % 2, t: 'real', yes: true, ms,
    }));

    it('does not flag an honest beginner who quickly says "no" to the words they do not know', async () => {
      const q = await qualityOf('size', cleanSize(5), [...noAnswers(60, 750), ...easyYes(5, 1400)]);
      expect(q.medianMs).toBe(750); // the overall median is fast…
      expect(q.medianYesMs).toBe(1400); // …but the "sí" answers are not
      expect(q.faRate).toBe(0);
      expect(q.flagged).toBe(false);
    });

    it('flags a yes-masher on the median "sí" time, even when slow "no" answers hide it in the overall median', async () => {
      const q = await qualityOf('size', cleanSize(20), [...easyYes(40, 650), ...noAnswers(45, 1500)]);
      expect(q.medianMs).toBe(1500);
      expect(q.medianYesMs).toBe(650);
      expect(q.flagged).toBe(true);
    });

    it('needs at least 20 "sí" answers before the median "sí" time can flag', async () => {
      expect((await qualityOf('size', cleanSize(19), [...easyYes(19, 650), ...noAnswers(45, 1500)])).flagged).toBe(false);
      expect((await qualityOf('size', cleanSize(20), [...easyYes(20, 650), ...noAnswers(45, 1500)])).flagged).toBe(true);
    });

    it('keeps the other rules: f > 30 % flags, five or more fast suspect "sí" flag, and the timed LDT is exempt from speed', async () => {
      expect((await qualityOf('size', { v: 1, yn: { ...cleanSize(5).yn, ps: [10, 4] } }, [...noAnswers(30, 1500), ...easyYes(5, 1400)])).flagged).toBe(true);
      const fastPseudoYes = Array.from({ length: 5 }, (_, i) => ({ w: `ps${i}`, b: -1, t: 'pseudo', yes: true, ms: 500 }));
      expect((await qualityOf('size', cleanSize(5), [...noAnswers(30, 1500), ...fastPseudoYes])).flagged).toBe(true);
      const ldt = { ...cleanSize(20), rt: { med: 650, timeouts: 0 } };
      expect((await qualityOf('ldt', ldt, [...easyYes(40, 650), ...noAnswers(45, 1500), ...fastPseudoYes])).flagged).toBe(false);
    });

    // Census answers are logged as {w, ph, ms, yes|ok} with no t/b fields, and
    // every "sí" is verified by a meaning check or a typed retest.
    it('does not flag a fluent censo block whose meaning checks all passed with 0/6 false alarms', async () => {
      const words = Array.from({ length: 30 }, (_, i) => i);
      const responses = [
        ...words.flatMap((i) => [
          { w: `palabra${i}`, ph: 'screen', ms: 450, yes: true },
          { w: `palabra${i}`, ph: 'mc', ms: 800, ok: true },
        ]),
        ...Array.from({ length: 6 }, (_, i) => ({ w: `falsa${i}`, ph: 'screen', ms: 500, yes: false })),
      ];
      const q = await qualityOf('c500', { v: 2, res: words.map((i) => [i, 2] as [number, number]), ps: [6, 0] }, responses);
      expect(q.faRate).toBe(0);
      expect(q.flagged).toBe(false);
    });

    it('does not flag an honest sondeo block of quick "no" answers', async () => {
      const responses = [
        ...Array.from({ length: 40 }, (_, i) => ({ w: `rara${i}`, ph: 'screen', ms: 600, yes: false })),
        ...Array.from({ length: 4 }, (_, i) => ({ w: `sabe${i}`, ph: 'screen', ms: 1300, yes: true })),
        ...Array.from({ length: 8 }, (_, i) => ({ w: `falsa${i}`, ph: 'screen', ms: 650, yes: false })),
      ];
      const res = Array.from({ length: 44 }, (_, i) => [600 + i, i < 40 ? 0 : 1] as [number, number]);
      const q = await qualityOf('s5000', { v: 2, res, ps: [8, 0] }, responses);
      expect(q.flagged).toBe(false);
    });

    it('still flags a census block on its false-alarm rate alone', async () => {
      const responses = Array.from({ length: 30 }, (_, i) => ({ w: `w${i}`, ph: 'screen', ms: 1500, yes: true }));
      const q = await qualityOf('a500', { v: 2, res: [[1, 3], [2, 0]], ps: [6, 2] }, responses);
      expect(q.faRate).toBeCloseTo(2 / 6, 5);
      expect(q.flagged).toBe(true);
    });
  });

  it('getMySeenWords returns words from unseeded size attempts only', async () => {
    const { admin, student } = await loadCallers();

    const sizeTest = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });
    const seededTest = await admin.createTest({
      name: 'Tamaño común', mode: 'size', settings: { seed: 42 }, groupIds: [1], isOpen: true,
    });
    const censoTest = await admin.createTest({
      name: 'Censo', mode: 'c500', groupIds: [1], isOpen: true,
    });

    await student.submitResult({
      testId: sizeTest.id,
      seed: 1,
      summary: SIZE_SUMMARY,
      responses: [
        { w: 'ciudad', b: 0, t: 'real', yes: true, ms: 900 },
        { w: 'blerfada', b: -1, t: 'pseudo', yes: false, ms: 1100 },
      ],
    });
    await student.submitResult({
      testId: seededTest.id,
      seed: 42,
      summary: SIZE_SUMMARY,
      responses: [{ w: 'mano', b: 0, t: 'real', yes: true, ms: 800 }],
    });
    await student.submitResult({
      testId: censoTest.id,
      seed: 2,
      summary: { v: 2, res: [[0, 2]], ps: [3, 0] },
      responses: [{ w: 'razón', ph: 'screen', yes: true, ms: 700 }],
    });

    const seen = await student.getMySeenWords();
    expect(seen.words).toContain('ciudad');
    expect(seen.words).toContain('blerfada');
    expect(seen.words).not.toContain('mano'); // seeded common form: fixed frame, not excluded
    expect(seen.words).not.toContain('razón'); // censo words are re-tested by design
  });

  it('getItemStats aggregates per-word counts, one observation per student and word', async () => {
    const { admin, student, outsider } = await loadCallers();
    await testDb.insert(schema.userGroups).values({ userId: 3, groupId: 1 });

    const test = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });

    await student.submitResult({
      testId: test.id,
      seed: 1,
      summary: SIZE_SUMMARY,
      responses: [
        { w: 'ciudad', b: 0, t: 'real', yes: true, ms: 800 },
        { w: 'manbor', b: -1, t: 'pseudo', yes: true, ms: 400 },
        { w: 'razón', b: 0, t: 'mc', pick: 1, correct: true, omit: false, ms: 2000 },
        { w: 'excusa', ph: 'mc', ok: false, ms: 1500 },
      ],
    });
    // Same student repeats: still one observation for 'ciudad'
    await student.submitResult({
      testId: test.id,
      seed: 2,
      summary: SIZE_SUMMARY,
      responses: [
        { w: 'ciudad', b: 0, t: 'real', yes: false, ms: 1200 },
      ],
    });
    // A second student adds an independent observation
    await outsider.submitResult({
      testId: test.id,
      seed: 3,
      summary: SIZE_SUMMARY,
      responses: [
        { w: 'ciudad', b: 0, t: 'real', yes: true, ms: 600 },
      ],
    });

    const stats = await admin.getItemStats({ testId: test.id });
    expect(stats.attempts).toBe(3);
    const byWord = new Map(stats.items.map((i) => [i.w, i]));
    expect(byWord.get('ciudad')?.ynN).toBe(2); // deduped per student, not per attempt
    expect(byWord.get('manbor')).toMatchObject({ ynN: 1, ynYes: 1, ynMsSum: 400, ynMsN: 1 });
    expect(byWord.get('razón')).toMatchObject({ mcN: 1, mcOk: 1 });
    expect(byWord.get('excusa')).toMatchObject({ mcN: 1, mcOk: 0 });
  });

  it('aural modes: audio bank words gated by open aural test, URLs scoped to test accent', async () => {
    const { admin, student, outsider } = await loadCallers();

    await testDb.insert(schema.vocabAudio).values([
      { word: 'ciudad', accent: '', status: 'ready', url: '/api/assets/a.opus' },
      { word: 'razón', accent: '', status: 'ready', url: '/api/assets/b.opus' },
      { word: 'ciudad', accent: 'Mexican', status: 'ready', url: '/api/assets/c.opus' },
      { word: 'mano', accent: '', status: 'pending', url: null },
    ]);

    // No aural test open yet: students are refused, admins are not
    await expect(student.getAudioBankWords({ accent: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const adminBank = await admin.getAudioBankWords({ accent: '' });
    expect(adminBank.words.sort()).toEqual(['ciudad', 'razón']);

    const test = await admin.createTest({
      name: 'Auditiva TTS', mode: 'listen2', settings: { accent: '' }, groupIds: [1], isOpen: true,
    });

    const bank = await student.getAudioBankWords({ accent: '' });
    expect(bank.words).toContain('ciudad');
    expect(bank.words).not.toContain('mano'); // pending, not ready

    const urls = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad', 'razón', 'mano'] });
    expect(urls.urls).toEqual({ ciudad: '/api/assets/a.opus', 'razón': '/api/assets/b.opus' });

    // Outsider's group has no aural test
    await expect(outsider.getAudioBankWords({ accent: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.getVocabAudioUrls({ testId: test.id, words: ['ciudad'] }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Accent scoping: a Mexican-accent test resolves the Mexican clip
    const mxTest = await admin.createTest({
      name: 'Auditiva MX', mode: 'listen2', settings: { accent: 'Mexican' }, groupIds: [1], isOpen: true,
    });
    const mxUrls = await student.getVocabAudioUrls({ testId: mxTest.id, words: ['ciudad', 'razón'] });
    expect(mxUrls.urls).toEqual({ ciudad: '/api/assets/c.opus' });

    // Non-aural tests have no audio bank
    const sizeTest = await admin.createTest({
      name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true,
    });
    await expect(student.getVocabAudioUrls({ testId: sizeTest.id, words: ['ciudad'] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('random accent: any-accent availability + per-word dialect pick', async () => {
    const { admin, student } = await loadCallers();

    await testDb.insert(schema.vocabAudio).values([
      { word: 'ciudad', accent: 'Mexican', status: 'ready', url: '/api/assets/mx-ciudad.opus' },
      { word: 'ciudad', accent: 'Castilian', status: 'ready', url: '/api/assets/es-ciudad.opus' },
      { word: 'razón', accent: 'Argentine', status: 'ready', url: '/api/assets/ar-razon.opus' },
      { word: 'mano', accent: 'Mexican', status: 'pending', url: null },
    ]);

    const test = await admin.createTest({
      name: 'Auditiva aleatoria', mode: 'listen2', settings: { accent: 'random' }, groupIds: [1], isOpen: true,
    });

    // words available in ANY accent (deduped), pending excluded
    const bank = await student.getAudioBankWords({ accent: 'random' });
    expect(bank.words.sort()).toEqual(['ciudad', 'razón']);

    // each word resolves to one of its available-accent clips
    const urls = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad', 'razón', 'mano'] });
    expect(['/api/assets/mx-ciudad.opus', '/api/assets/es-ciudad.opus']).toContain(urls.urls['ciudad']);
    expect(urls.urls['razón']).toBe('/api/assets/ar-razon.opus');
    expect(urls.urls['mano']).toBeUndefined();

    // the per-word choice is deterministic for a given student
    const again = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad'] });
    expect(again.urls['ciudad']).toBe(urls.urls['ciudad']);
  });

  it('generateAudioBank fails cleanly when AI pronunciation is disabled', async () => {
    const { admin } = await loadCallers();
    await expect(admin.generateAudioBank({ words: ['ciudad'], accent: '' }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('generateAudioBank with random accent assigns real Spanish accents, never the sentinel', async () => {
    const REAL = ['Mexican', 'Castilian', 'Argentine', 'Colombian', 'Chilean', 'Cuban', 'Puerto Rican'];
    const sentToTts: (string | undefined)[] = [];

    // Enable AI + stub the provider/asset pipeline so generation runs end to end.
    vi.doMock('../services/ai/config.js', () => ({
      getAiRuntimeConfig: async () => ({ pronunciationEnabled: true }),
    }));
    vi.doMock('../services/ai/providerFactory.js', () => ({
      createAiProvider: async () => ({
        name: 'fake',
        generateSpeech: async (_word: string, opts?: { accent?: string }) => {
          sentToTts.push(opts?.accent);
          return { audioBuffer: Buffer.from([1, 2, 3]), mimeType: 'audio/ogg' };
        },
      }),
    }));
    vi.doMock('../services/ai/assetStorage.js', () => ({
      writeAudioAsset: async () => '/api/assets/fake.opus',
    }));

    const { admin } = await loadCallers();
    const words = ['ciudad', 'razón', 'mano'];
    const res = await admin.generateAudioBank({ words, accent: 'random' });
    expect(res.queued).toBe(3);

    // Wait for the background batch to finish (writes rows one by one).
    const deadline = Date.now() + 5000;
    let rows: { word: string; accent: string; status: string }[] = [];
    while (Date.now() < deadline) {
      const all = await testDb.select({
        word: schema.vocabAudio.word,
        accent: schema.vocabAudio.accent,
        status: schema.vocabAudio.status,
      }).from(schema.vocabAudio);
      rows = all.filter((r) => words.includes(r.word));
      if (rows.length === 3 && rows.every((r) => r.status === 'ready' || r.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 40));
    }

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe('ready');
      expect(r.accent).not.toBe('random');
      expect(REAL).toContain(r.accent);
    }
    // The literal 'random' sentinel must never reach the TTS provider.
    expect(sentToTts).toHaveLength(3);
    for (const a of sentToTts) {
      expect(a).not.toBe('random');
      expect(REAL).toContain(a);
    }
  });

  describe('Vocabulómetro voice (ElevenLabs)', () => {
    const MAP = { '': 'voiceMe0001', Mexican: 'voiceMx0001' };
    let aiConfig: Record<string, unknown>;
    let spoken: { text: string; opts: Record<string, unknown> }[];

    afterEach(() => {
      // doMock registrations outlive resetModules; later tests need the real modules.
      vi.doUnmock('../services/ai/config.js');
      vi.doUnmock('../services/ai/providerFactory.js');
      vi.doUnmock('../services/ai/assetStorage.js');
    });

    function mockElevenLabs(overrides: Record<string, unknown> = {}) {
      aiConfig = {
        pronunciationEnabled: true,
        ttsProvider: 'elevenlabs',
        elevenlabsApiKey: 'xi-test',
        ttsVoiceMap: MAP,
        vocabTtsVoiceId: 'voiceTeacher1',
        ...overrides,
      };
      spoken = [];
      vi.doMock('../services/ai/config.js', () => ({
        getAiRuntimeConfig: async () => aiConfig,
        invalidateAiRuntimeConfigCache: () => undefined,
      }));
      vi.doMock('../services/ai/providerFactory.js', () => ({
        createAiProvider: async () => ({
          name: 'openai',
          speechProviderName: 'elevenlabs',
          generateSpeech: async (text: string, opts: Record<string, unknown>) => {
            spoken.push({ text, opts });
            return { audioBuffer: Buffer.from([1, 2, 3]), mimeType: 'audio/ogg' };
          },
        }),
      }));
      let n = 0;
      vi.doMock('../services/ai/assetStorage.js', () => ({
        writeAudioAsset: async () => `/api/assets/new-${++n}.opus`,
      }));
    }

    async function waitForBatch(admin: Awaited<ReturnType<typeof loadCallers>>['admin']) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const p = await admin.getAudioBankProgress();
        if (p.status !== 'generating') return p;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error('batch did not finish');
    }

    it('serves the default accent from the Vocabulómetro voice, never legacy or other-voice clips', async () => {
      mockElevenLabs();
      const { admin, student } = await loadCallers();
      await testDb.insert(schema.vocabAudio).values([
        // clips from before the voice column (voice_id NULL)
        { word: 'ciudad', accent: '', status: 'ready', url: '/api/assets/legacy-ciudad.opus' },
        { word: 'ciudad', accent: 'Mexican', status: 'ready', url: '/api/assets/legacy-mx.opus' },
        // the old default ("Me") voice and the teacher's voice
        { word: 'ciudad', accent: '', voiceId: 'voiceMe0001', status: 'ready', url: '/api/assets/me-ciudad.opus' },
        { word: 'razón', accent: '', voiceId: 'voiceTeacher1', status: 'ready', url: '/api/assets/teacher-razon.opus' },
        { word: 'mano', accent: 'Mexican', voiceId: 'voiceMx0001', status: 'ready', url: '/api/assets/mx-mano.opus' },
        // a sentence clip in the same voice is never a word
        { word: 'Hola, ¿qué tal?', accent: '', kind: 'sentence', voiceId: 'voiceTeacher1', status: 'ready', url: '/api/assets/s.opus' },
      ]);

      expect((await admin.getAudioBankWords({ accent: '' })).words).toEqual(['razón']);
      expect((await admin.getAudioBankWords({ accent: 'Mexican' })).words).toEqual(['mano']);
      // Castilian has no voice: nothing is servable, not even legacy clips.
      expect((await admin.getAudioBankWords({ accent: 'Castilian' })).words).toEqual([]);

      const test = await admin.createTest({ name: 'Auditiva', mode: 'listen2', settings: { accent: '' }, groupIds: [1], isOpen: true });
      const urls = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad', 'razón', 'Hola, ¿qué tal?'] });
      expect(urls.urls).toEqual({ 'razón': '/api/assets/teacher-razon.opus' });

      // Fallback: with no Vocabulómetro voice the default accent is the voice map's default.
      aiConfig.vocabTtsVoiceId = null;
      expect((await admin.getAudioBankWords({ accent: '' })).words).toEqual(['ciudad']);
      const fallback = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad', 'razón'] });
      expect(fallback.urls).toEqual({ ciudad: '/api/assets/me-ciudad.opus' });
    });

    it('random accent draws only from accents that have a voice, in that voice', async () => {
      mockElevenLabs();
      const { admin, student } = await loadCallers();
      await testDb.insert(schema.vocabAudio).values([
        { word: 'ciudad', accent: 'Mexican', voiceId: 'voiceMx0001', status: 'ready', url: '/api/assets/mx-ciudad.opus' },
        { word: 'ciudad', accent: 'Castilian', status: 'ready', url: '/api/assets/legacy-es-ciudad.opus' },
        { word: 'razón', accent: 'Argentine', status: 'ready', url: '/api/assets/legacy-ar-razon.opus' },
        { word: 'mano', accent: 'Cuban', voiceId: 'voiceMx0001', status: 'ready', url: '/api/assets/mislabeled.opus' },
        // A voiced accent's clip from before the voice column and an old-voice clip: the pool admits
        // Mexican, so only the voice check keeps these out.
        { word: 'razón', accent: 'Mexican', voiceId: null, status: 'ready', url: '/api/assets/legacy-mx-razon.opus' },
        { word: 'mano', accent: 'Mexican', voiceId: 'voiceOld0001', status: 'ready', url: '/api/assets/old-mx-mano.opus' },
      ]);
      expect((await admin.getAudioBankWords({ accent: 'random' })).words).toEqual(['ciudad']);
      const test = await admin.createTest({ name: 'Mezcla', mode: 'dictado', settings: { accent: 'random' }, groupIds: [1], isOpen: true });
      const urls = await student.getVocabAudioUrls({ testId: test.id, words: ['ciudad', 'razón', 'mano'] });
      expect(urls.urls).toEqual({ ciudad: '/api/assets/mx-ciudad.opus' });
    });

    it('generation records the voice and does not skip words that only have legacy or other-voice clips', async () => {
      mockElevenLabs();
      const { admin } = await loadCallers();
      await testDb.insert(schema.vocabAudio).values([
        { word: 'ciudad', accent: '', status: 'ready', url: '/api/assets/legacy-ciudad.opus' },
        { word: 'razón', accent: '', voiceId: 'voiceMe0001', status: 'ready', url: '/api/assets/me-razon.opus' },
      ]);

      expect(await admin.generateAudioBank({ words: ['ciudad', 'razón'], accent: '' })).toEqual({ queued: 2 });
      await waitForBatch(admin);

      const rows = await testDb.select().from(schema.vocabAudio);
      const teacherVoice = rows.filter((r) => r.voiceId === 'voiceTeacher1');
      expect(teacherVoice.map((r) => [r.word, r.accent, r.kind, r.status]).sort()).toEqual([
        ['ciudad', '', 'word', 'ready'], ['razón', '', 'word', 'ready'],
      ]);
      // Legacy and old-voice rows stay as they were (their files may be shared).
      expect(rows.find((r) => r.url === '/api/assets/legacy-ciudad.opus')).toMatchObject({ voiceId: null, status: 'ready' });
      expect(rows.find((r) => r.url === '/api/assets/me-razon.opus')).toMatchObject({ voiceId: 'voiceMe0001' });
      // The provider was told exactly which voice speaks, with Spanish priming.
      expect(spoken.map((s) => s.opts.elevenLabsVoiceId)).toEqual(['voiceTeacher1', 'voiceTeacher1']);
      expect(spoken.every((s) => s.opts.language === 'Spanish' && s.opts.textKind === 'word')).toBe(true);
      expect((await admin.getAudioBankWords({ accent: '' })).words.sort()).toEqual(['ciudad', 'razón']);

      // Now every word has a current-voice clip: nothing to do.
      expect(await admin.generateAudioBank({ words: ['ciudad', 'razón'], accent: '' })).toEqual({ queued: 0 });
      // A mapped accent uses its own voice.
      expect(await admin.generateAudioBank({ words: ['ciudad'], accent: 'Mexican' })).toEqual({ queued: 1 });
      await waitForBatch(admin);
      expect(spoken.at(-1)?.opts).toMatchObject({ accent: 'Mexican', elevenLabsVoiceId: 'voiceMx0001', strictAccent: true });
      // An accent with no voice is refused up front.
      await expect(admin.generateAudioBank({ words: ['ciudad'], accent: 'Cuban' }))
        .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('sentence audio: generated in the Vocabulómetro voice, gated per test, excluded from the word bank', async () => {
      mockElevenLabs();
      const { admin, student, outsider } = await loadCallers();
      const a = await admin.createEiSentence({ text: 'Mi hermano vive en la ciudad.', difficulty: 2 });
      const b = await admin.createEiSentence({ text: 'Ayer fuimos al mercado temprano.', difficulty: 3 });
      const c = await admin.createEiSentence({ text: 'Voy a la tienda (el supermercado) con él/ella.', difficulty: 4 });
      expect(await admin.getEiSentenceAudioStatus()).toMatchObject({ total: 3, ready: 0 });

      expect(await admin.generateEiSentenceAudio()).toEqual({ queued: 3 });
      const done = await waitForBatch(admin);
      expect(done).toMatchObject({ kind: 'sentence', failed: 0 });
      expect(spoken).toHaveLength(3);
      // Spoken as written — EI scores the repetition against the raw text, so
      // the flashcard notation rules (drop "(gloss)", "a/b" → "a, b") must not apply.
      expect(spoken.map((s) => s.text)).toContain('Voy a la tienda (el supermercado) con él/ella.');
      for (const { opts } of spoken) {
        expect(opts).toMatchObject({ elevenLabsVoiceId: 'voiceTeacher1', textKind: 'sentence', language: 'Spanish' });
      }
      const status = await admin.getEiSentenceAudioStatus();
      expect(status).toMatchObject({ total: 3, ready: 3 });
      expect(status.readyIds.sort()).toEqual([a.id, b.id, c.id].sort());
      expect((await admin.getAudioBankWords({ accent: '' })).words).toEqual([]);

      await setTranscriptionSwitch(true);
      const test = await admin.createTest({ name: 'EI', mode: 'ei', settings: { nsent: 3 }, groupIds: [1], isOpen: true });
      const audio = await student.getTestEiAudio({ testId: test.id });
      expect(Object.keys(audio.urls).map(Number).sort()).toEqual([a.id, b.id, c.id].sort());
      await expect(outsider.getTestEiAudio({ testId: test.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const listen = await admin.createTest({ name: 'Aural', mode: 'listen2', groupIds: [1], isOpen: true });
      await expect(student.getTestEiAudio({ testId: listen.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await admin.updateTest({ id: test.id, isOpen: false });
      await expect(student.getTestEiAudio({ testId: test.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // A different voice has no sentence clips yet: the runner falls back to browser speech.
      aiConfig.vocabTtsVoiceId = 'voiceOther01';
      expect(await admin.getEiSentenceAudioStatus()).toMatchObject({ total: 3, ready: 0 });
      // Students cannot generate.
      await expect(student.generateEiSentenceAudio()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('setVocabVoice saves a voice id (admin only) and getVocabVoice reports it', async () => {
    const { admin, student } = await loadCallers();
    expect((await admin.getVocabVoice()).vocabVoiceId).toBeNull();
    await admin.setVocabVoice({ voiceId: 'voiceTeacherA' });
    expect((await admin.getVocabVoice()).vocabVoiceId).toBe('voiceTeacherA');
    await expect(admin.setVocabVoice({ voiceId: '../../etc' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(student.setVocabVoice({ voiceId: 'voiceTeacherA' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await admin.setVocabVoice({ voiceId: null });
    expect((await admin.getVocabVoice()).vocabVoiceId).toBeNull();
  });

  it('dictado submissions accept v1 yn summaries with zero pseudowords', async () => {
    const { admin, student } = await loadCallers();
    const test = await admin.createTest({
      name: 'Dictado', mode: 'dictado', settings: { accent: '' }, groupIds: [1], isOpen: true,
    });
    await student.submitResult({
      testId: test.id,
      seed: 11,
      summary: { v: 1, yn: { bands: [[6, 5], [5, 4], [4, 2], [3, 1], [2, 0]] as [number, number][], ps: [0, 0] as [number, number] } },
      responses: [{ w: 'ciudad', b: 0, t: 'dict', typed: 'ciudad', ok: true, ms: 2400 }],
    });
    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe('dictado');
  });

  it('source texts: admin CRUD, student access gated through an open ctest test', async () => {
    const { admin, student, outsider } = await loadCallers();

    const text = await admin.createText({
      title: 'La ciudad',
      content: 'Había una vez una ciudad pequeña. Las personas caminaban despacio por las calles antiguas cada mañana soleada del verano.',
    });
    expect(text.id).toBeDefined();
    expect(await admin.listTexts()).toHaveLength(1);

    const test = await admin.createTest({
      name: 'C-test otoño', mode: 'ctest', settings: { textIds: [text.id], ngaps: 10 }, groupIds: [1], isOpen: true,
    });

    const forStudent = await student.getTestTexts({ testId: test.id });
    expect(forStudent.texts).toHaveLength(1);
    expect(forStudent.texts[0].content).toContain('ciudad');

    await expect(outsider.getTestTexts({ testId: test.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await student.submitResult({
      testId: test.id,
      seed: 3,
      summary: { v: 1, ct: { n: 10, c: 7, cl: 8 } },
      responses: [{ w: 'personas', t: 'ct', typed: 'sonas', exact: true, lenient: true }],
    });
    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].summaryJson).ct.c).toBe(7);

    // cannot delete while a test still references it
    await expect(admin.deleteText({ id: text.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    // remove the reference, then deletion succeeds
    await admin.updateTest({ id: test.id, settings: { textIds: [], ngaps: 10 } });
    await admin.deleteText({ id: text.id });
    expect(await admin.listTexts()).toHaveLength(0);
  });

  it('speeded LDT submissions accept yn summaries with rt metadata', async () => {
    const { admin, student } = await loadCallers();
    const test = await admin.createTest({
      name: 'LDT', mode: 'ldt', settings: { deadlineMs: 2000 }, groupIds: [1], isOpen: true,
    });
    await student.submitResult({
      testId: test.id,
      seed: 21,
      summary: {
        v: 1,
        yn: { bands: [[9, 8], [10, 7], [11, 5], [9, 2], [8, 1]] as [number, number][], ps: [18, 2] as [number, number] },
        rt: { med: 840, timeouts: 3 },
      },
      responses: [
        { w: 'de', b: 0, t: 'real', yes: true, ms: 620 },
        { w: 'estatua', b: 3, t: 'real', timeout: true, ms: 2000 },
      ],
    });
    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    const summary = JSON.parse(results[0].summaryJson);
    expect(summary.rt).toEqual({ med: 840, timeouts: 3 });
  });

  it('elicited imitation: sentence bank CRUD, seed, gated student access, EI submission', async () => {
    const { admin, student, outsider } = await loadCallers();

    expect(await admin.listEiSentences()).toHaveLength(0);
    const seeded = await admin.seedEiSentences();
    expect(seeded.seeded).toBeGreaterThan(0);
    expect(await admin.seedEiSentences()).toEqual({ seeded: 0 }); // idempotent
    const all = await admin.listEiSentences();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0].difficulty).toBeLessThanOrEqual(all[all.length - 1].difficulty); // ordered

    const custom = await admin.createEiSentence({ text: 'Una frase de prueba nueva.', difficulty: 3 });
    expect(custom.id).toBeDefined();

    await setTranscriptionSwitch(true);
    const test = await admin.createTest({
      name: 'EI otoño', mode: 'ei', settings: { nsent: 5 }, groupIds: [1], isOpen: true,
    });

    const forStudent = await student.getTestEiSentences({ testId: test.id });
    expect(forStudent.sentences).toHaveLength(5);
    // The switch is on but AI is off in tests: the runner says so before any recording.
    expect(forStudent.transcriptionEnabled).toBe(false);
    await expect(outsider.getTestEiSentences({ testId: test.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // transcription requires AI — disabled in tests → PRECONDITION_FAILED
    await expect(student.transcribeEiRecording({
      testId: test.id, sentenceId: forStudent.sentences[0].id,
      audioBase64: Buffer.from('x'.repeat(500)).toString('base64'), mimeType: 'audio/webm',
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    // a sentence not in this test's set is rejected before the AI gate
    await expect(student.transcribeEiRecording({
      testId: test.id, sentenceId: 999999,
      audioBase64: Buffer.from('x'.repeat(500)).toString('base64'), mimeType: 'audio/webm',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // a fabricated sum greater than n is rejected by the summary schema
    await expect(student.submitResult({
      testId: test.id, seed: 0,
      summary: { v: 1, ei: { n: 5, sum: 5.5 } },
    })).rejects.toBeInstanceOf(TRPCError);

    // the EI attempt itself submits like any other result (scores computed client-collected)
    await student.submitResult({
      testId: test.id,
      seed: 0,
      summary: { v: 1, ei: { n: 5, sum: 3.6 } },
      responses: [{ sentenceId: forStudent.sentences[0].id, transcript: 'hola', score: 0.8, audioUrl: '/api/assets/x.webm' }],
    });
    const results = await admin.getResults({ testId: test.id });
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].summaryJson).ei).toEqual({ n: 5, sum: 3.6 });

    await admin.deleteEiSentence({ id: custom.id });
    expect((await admin.listEiSentences()).find((s) => s.id === custom.id)).toBeUndefined();
  });

  describe('the "repeat the sentence" transcription switch', () => {
    const audio = { audioBase64: Buffer.from('x'.repeat(500)).toString('base64'), mimeType: 'audio/webm' };

    it('is off on a fresh install: no "ei" test can be made and none transcribes', async () => {
      const { admin, student } = await loadCallers();
      expect(await admin.transcriptionStatus()).toEqual({ enabled: false, aiEnabled: false });
      await expect(student.transcriptionStatus()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(admin.createTest({ name: 'EI', mode: 'ei', groupIds: [1], isOpen: true }))
        .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', cause: { appCode: 'VOCAB_EI_TRANSCRIPTION_OFF' } });
      // Other modes are not affected.
      await expect(admin.createTest({ name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true })).resolves.toBeDefined();

      // An "ei" test made while it was on (or before the switch existed) refuses once it is off.
      await setTranscriptionSwitch(true);
      await admin.seedEiSentences();
      const test = await admin.createTest({ name: 'EI', mode: 'ei', settings: { nsent: 3 }, groupIds: [1], isOpen: true });
      expect(await admin.transcriptionStatus()).toEqual({ enabled: true, aiEnabled: false });
      await setTranscriptionSwitch(false);
      const { sentences, transcriptionEnabled } = await student.getTestEiSentences({ testId: test.id });
      expect(transcriptionEnabled).toBe(false);
      await expect(student.transcribeEiRecording({ testId: test.id, sentenceId: sentences[0].id, ...audio }))
        .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', cause: { appCode: 'VOCAB_EI_TRANSCRIPTION_OFF' } });
    });

    it('logs each transcription with user, test, duration and outcome, and never the audio or the transcript', async () => {
      const sent: Buffer[] = [];
      vi.doMock('../services/ai/config.js', () => ({ getAiRuntimeConfig: async () => ({ aiEnabled: true }) }));
      vi.doMock('../services/ai/providerFactory.js', () => ({
        createAiProvider: async () => ({
          name: 'fake',
          generateTranscription: async (buffer: Buffer) => { sent.push(buffer); return { text: 'Mi hermano vive en la ciudad' }; },
        }),
      }));
      const { logger } = await import('../logger.js');
      const lines: unknown[][] = [];
      vi.spyOn(logger, 'info').mockImplementation(((...args: unknown[]) => { lines.push(args); }) as never);
      try {
        await setTranscriptionSwitch(true);
        const { admin, student } = await loadCallers();
        const sentence = await admin.createEiSentence({ text: 'Mi hermano vive en la ciudad.', difficulty: 2 });
        const test = await admin.createTest({ name: 'EI', mode: 'ei', settings: { nsent: 3 }, groupIds: [1], isOpen: true });
        // Switch on and AI on: the runner lets the student record.
        expect((await student.getTestEiSentences({ testId: test.id })).transcriptionEnabled).toBe(true);
        const result = await student.transcribeEiRecording({ testId: test.id, sentenceId: sentence.id, ...audio });
        expect(result.transcript).toBe('Mi hermano vive en la ciudad');
        expect(sent).toHaveLength(1);
        const events = lines.filter(([fields]) => (fields as { event?: string }).event === 'ai.transcription');
        expect(events).toHaveLength(1);
        const [fields] = events[0] as [Record<string, unknown>];
        expect(Object.keys(fields).sort()).toEqual(['durationMs', 'event', 'outcome', 'testId', 'userId']);
        expect(fields).toMatchObject({ userId: 2, testId: test.id, outcome: 'ok' });
        const serialized = JSON.stringify(lines);
        expect(serialized).not.toContain('hermano');
        expect(serialized).not.toContain(audio.audioBase64.slice(0, 40));
      } finally {
        vi.restoreAllMocks();
        vi.doUnmock('../services/ai/config.js');
        vi.doUnmock('../services/ai/providerFactory.js');
      }
    });
  });

  it('deleting a test cascades to its results', async () => {
    const { admin, student } = await loadCallers();

    const test = await admin.createTest({
      name: 'Auditiva', mode: 'listen', groupIds: [1], isOpen: true,
    });
    await student.submitResult({ testId: test.id, seed: 9, summary: SIZE_SUMMARY });
    expect(await admin.getResults({})).toHaveLength(1);

    await admin.deleteTest({ id: test.id });
    expect(await admin.getResults({})).toHaveLength(0);
    expect(await admin.listTests()).toHaveLength(0);
  });

  describe('teacher results at school scale', () => {
    /** Insert `count` stored attempts directly, oldest first (one per minute). */
    async function seedResults(testId: number, count: number, make: (i: number) => Partial<typeof schema.vocabResults.$inferInsert> = () => ({})) {
      const base = Date.UTC(2026, 7, 1);
      const rows = Array.from({ length: count }, (_, i) => ({
        testId,
        userId: 2,
        mode: 'size' as const,
        seed: i,
        occasion: i < 100 ? '2026-08 base' : '2027-05',
        summaryJson: JSON.stringify(SIZE_SUMMARY),
        completedAt: new Date(base + i * 60_000),
        ...make(i),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await testDb.insert(schema.vocabResults).values(rows.slice(i, i + 500));
      }
    }

    it('getResults returns every attempt past 5,000 rows, so the baseline occasion is never dropped', async () => {
      const { admin } = await loadCallers();
      const test = await admin.createTest({ name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true });
      await seedResults(test.id, 5300);

      const all = await admin.getResults({});
      expect(all).toHaveLength(5300);
      // newest first, and the oldest (baseline) attempts are still there
      expect(all[0].seed).toBe(5299);
      expect(all[all.length - 1].seed).toBe(0);
      expect(all.filter((r) => r.occasion === '2026-08 base')).toHaveLength(100);
      expect(await admin.getResults({ testId: test.id })).toHaveLength(5300);
      expect(await admin.getResults({ groupId: 1 })).toHaveLength(5300);
    });

    it('getResults ships census summaries with their per-word states emptied; getCensusResults carries them', async () => {
      const { admin, student } = await loadCallers();
      const censo = await admin.createTest({ name: 'Censo', mode: 'c500', settings: { blk: 1 }, groupIds: [1], isOpen: true });
      const size = await admin.createTest({ name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true });
      const res: [number, number][] = [[0, 2], [1, 3], [42, 1]];
      await student.submitResult({ testId: censo.id, seed: 1, blk: '1', summary: { v: 2, res, ps: [5, 1] } });
      await student.submitResult({ testId: size.id, seed: 2, summary: SIZE_SUMMARY });

      const rows = await admin.getResults({});
      const censusRow = rows.find((r) => r.mode === 'c500');
      const sizeRow = rows.find((r) => r.mode === 'size');
      expect(censusRow?.censusItems).toBe(3);
      // `res` stays, as an empty array: a teacher tab still on the previous
      // client iterates summary.res for its Anuario and must not throw
      const stripped = JSON.parse(censusRow!.summaryJson);
      expect(stripped).toEqual({ v: 2, res: [], ps: [5, 1] });
      expect(Array.isArray(stripped.res)).toBe(true);
      expect(sizeRow?.censusItems).toBeNull();
      expect(JSON.parse(sizeRow!.summaryJson)).toEqual(SIZE_SUMMARY);

      const census = await admin.getCensusResults({});
      expect(census).toHaveLength(1);
      expect(JSON.parse(census[0].summaryJson)).toEqual({ v: 2, res, ps: [5, 1] });
      expect(census[0]).toMatchObject({ userId: 2, userName: 'Student', mode: 'c500', blk: '1' });
      expect(await admin.getCensusResults({ testId: size.id })).toHaveLength(0);
      expect(await admin.getCensusResults({ groupId: 2 })).toHaveLength(0);
    });

    it('getCensusResults is for teachers only', async () => {
      const { admin, student } = await loadCallers();
      const censo = await admin.createTest({ name: 'Censo', mode: 'c500', groupIds: [1], isOpen: true });
      await student.submitResult({ testId: censo.id, seed: 1, summary: { v: 2, res: [[0, 2]], ps: [5, 0] } });
      await expect(student.getCensusResults({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('getCensusResults is uncapped too', async () => {
      const { admin } = await loadCallers();
      const test = await admin.createTest({ name: 'Sondeo', mode: 's5000', groupIds: [1], isOpen: true });
      await seedResults(test.id, 5100, () => ({ mode: 's5000', summaryJson: JSON.stringify({ v: 2, res: [[600, 1]], ps: [1, 0] }) }));
      expect(await admin.getCensusResults({})).toHaveLength(5100);
    });

    it('getItemStats says when it had to leave older attempts out', async () => {
      const { admin } = await loadCallers();
      const test = await admin.createTest({ name: 'Tamaño', mode: 'size', groupIds: [1], isOpen: true });
      const responses = JSON.stringify([{ w: 'ciudad', b: 0, t: 'real', yes: true, ms: 900 }]);
      /** A September completion time, after every seeded August attempt. */
      const september = (day: number, i: number) => new Date(Date.UTC(2026, 8, day) + i * 60_000);
      // exactly the cap of attempts with responses (August)…
      await seedResults(test.id, 2000, () => ({ responsesJson: responses }));
      // …then the NEWEST attempts carry no item responses: they must not use up the cap
      await seedResults(test.id, 5, (i) => ({ completedAt: september(1, i), responsesJson: null }));
      expect(await admin.getItemStats({})).toMatchObject({ attempts: 2000, truncated: false, maxAttempts: 2000 });

      // one more attempt with responses: now an older one is left out, and it says so
      await seedResults(test.id, 1, (i) => ({ completedAt: september(2, i), responsesJson: responses }));
      expect(await admin.getItemStats({})).toMatchObject({ attempts: 2000, truncated: true, maxAttempts: 2000 });
    });
  });
});
