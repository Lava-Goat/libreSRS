// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Teacher Person', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: '100002@example.com', name: 'Ana Ruiz', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: '100003@example.com', name: 'Beto Soto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: '100004@example.com', name: 'Carla Vega', picture: null, role: 'user' as const };
const dani = { id: 5, googleId: 'pending:100005@example.com', email: '100005@example.com', name: '100005', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const STATS = 1;
const SPANISH = 2;
// Far from any real "today", so only the tests that set the clock care what day it is.
const DAY_1 = '2099-03-02';
const DAY_2 = '2099-03-03';
const DAY_3 = '2099-03-04';
const LONG_AGO = '2000-01-03';

async function load() {
  const { signupsRouter } = await import('./signups.js');
  const { adminRouter } = await import('./admin.js');
  const callerFor = (user: AnyUser) => signupsRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return {
    admin: callerFor(adminUser),
    ana: callerFor(ana),
    beto: callerFor(beto),
    carla: callerFor(carla),
    dani: callerFor(dani),
    adminApi: adminRouter.createCaller({
      req: { user: adminUser } as unknown as Request, res: {} as Response, user: adminUser, requestId: null,
    }),
  };
}

type Callers = Awaited<ReturnType<typeof load>>;
function createSheet(api: Callers, overrides: Partial<Parameters<Callers['admin']['create']>[0]> = {}) {
  return api.admin.create({
    title: 'Show and tell',
    description: 'Pick the days you present.',
    slotsPerDate: 2,
    picksPerStudent: 2,
    showNames: true,
    open: true,
    timeZone: 'America/Los_Angeles',
    active: true,
    groupIds: [STATS],
    dates: [
      { date: DAY_1, label: 'Day 31 · Rivers' },
      { date: DAY_2, label: 'Day 32 · Volcanoes' },
      { date: DAY_3, label: 'Day 33 · Experiments' },
      { date: LONG_AGO, label: 'Long ago' },
    ],
    ...overrides,
  });
}

async function dateId(sheetId: number, date: string) {
  const row = await testDb.query.signupDates.findFirst({ where: eq(schema.signupDates.date, date) });
  if (!row || row.sheetId !== sheetId) throw new Error(`no ${date} on sheet ${sheetId}`);
  return row.id;
}

const claimsOn = async (id: number) =>
  (await testDb.select().from(schema.signupClaims).where(eq(schema.signupClaims.dateId, id))).map((c) => c.userId).sort();

describe('sign-ups router', () => {
  afterAll(async () => {
    await client.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([adminUser, ana, beto, carla, dani].map(({ picture: _p, ...u }) => u));
    await testDb.insert(schema.groups).values([
      { id: STATS, name: 'Year 1 Theatre' },
      { id: SPANISH, name: 'Year 1 Spanish' },
    ]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: STATS },
      { userId: beto.id, groupId: STATS },
      { userId: carla.id, groupId: STATS },
      { userId: dani.id, groupId: STATS },
      { userId: carla.id, groupId: SPANISH },
      { userId: adminUser.id, groupId: STATS },
    ]);
  });

  describe('who sees a sheet', () => {
    it('lists active sheets for the student’s groups or for everyone', async () => {
      const api = await load();
      await createSheet(api, { title: 'Show and tell 2' });
      await createSheet(api, { title: 'Recitations', groupIds: [SPANISH] });
      await createSheet(api, { title: 'Open house', groupIds: [] });
      await createSheet(api, { title: 'Draft', active: false });

      expect((await api.ana.list()).map((s) => s.title)).toEqual(['Open house', 'Show and tell 2']);
      expect((await api.carla.list()).map((s) => s.title)).toEqual(['Open house', 'Recitations', 'Show and tell 2']);
    });

    it('refuses a sheet outside the student’s groups, and a hidden one', async () => {
      const api = await load();
      const spanish = await createSheet(api, { groupIds: [SPANISH] });
      const draft = await createSheet(api, { active: false });

      await expect(api.ana.get({ sheetId: spanish.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.claim({ dateId: await dateId(spanish.id, DAY_1) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.get({ sheetId: draft.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.ana.get({ sheetId: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // The teacher can open either one.
      expect((await api.admin.get({ sheetId: draft.id })).title).toBe('Show and tell');
    });

    it('shows a sheet to nobody once all its groups are deleted', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.adminApi.deleteGroup({ id: STATS });

      expect(await api.ana.list()).toEqual([]);
      await expect(api.ana.get({ sheetId: sheet.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await api.admin.adminGet({ sheetId: sheet.id })).roster).toEqual([]);
    });

    it('keeps the teacher from taking a student’s spot', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await expect(api.admin.claim({ dateId: await dateId(sheet.id, DAY_1) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('keeps the teacher’s procedures from students', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await expect(api.ana.adminGet({ sheetId: sheet.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.assign({ dateId: await dateId(sheet.id, DAY_1), userId: ana.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.create({
        title: 'x', slotsPerDate: 1, picksPerStudent: 1, showNames: true, open: true, timeZone: 'UTC', active: true,
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('picking days', () => {
    it('fills a day to its capacity and no further', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);

      await api.ana.claim({ dateId: day });
      await api.beto.claim({ dateId: day });
      await expect(api.carla.claim({ dateId: day })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await claimsOn(day)).toEqual([ana.id, beto.id]);
    });

    it('gives the last spot to exactly one of two students who ask at once', async () => {
      const api = await load();
      const sheet = await createSheet(api, { slotsPerDate: 1 });
      const day = await dateId(sheet.id, DAY_1);

      const results = await Promise.allSettled([api.ana.claim({ dateId: day }), api.beto.claim({ dateId: day })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await claimsOn(day)).toHaveLength(1);
    });

    it('honours a day’s own capacity over the sheet’s', async () => {
      const api = await load();
      const sheet = await createSheet(api, { dates: [{ date: DAY_1, capacity: 1 }, { date: DAY_2 }] });
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_1) });
      await expect(api.beto.claim({ dateId: await dateId(sheet.id, DAY_1) })).rejects.toMatchObject({ code: 'CONFLICT' });
      const view = await api.beto.get({ sheetId: sheet.id });
      expect(view.dates.map((d) => [d.date, d.capacity, d.taken])).toEqual([[DAY_1, 1, 1], [DAY_2, 2, 0]]);
    });

    it('stops at the student’s number of picks until they drop one', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_1) });
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_2) });
      await expect(api.ana.claim({ dateId: await dateId(sheet.id, DAY_3) }))
        .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('You already have 2 days') });

      await api.ana.release({ dateId: await dateId(sheet.id, DAY_1) });
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_3) });
      expect((await api.ana.list())[0].myDates).toEqual([DAY_2, DAY_3]);
    });

    it('treats picking a day twice as picking it once', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);
      await api.ana.claim({ dateId: day });
      await expect(api.ana.claim({ dateId: day })).resolves.toEqual({ success: true });
      await Promise.all([api.beto.claim({ dateId: day }), api.beto.claim({ dateId: day })]);
      expect(await claimsOn(day)).toEqual([ana.id, beto.id]);
    });

    it('locks days that have arrived, by the school’s clock', async () => {
      const api = await load();
      const sheet = await createSheet(api, { dates: [{ date: '2026-09-28' }, { date: '2026-09-29' }] });
      const monday = await dateId(sheet.id, '2026-09-28');
      const tuesday = await dateId(sheet.id, '2026-09-29');
      vi.useFakeTimers({ toFake: ['Date'] });

      // Sunday 11:30 pm in California (already Monday in UTC): Monday is still open.
      vi.setSystemTime(new Date('2026-09-28T06:30:00Z'));
      await api.ana.claim({ dateId: monday });
      await api.ana.claim({ dateId: tuesday });
      expect((await api.ana.get({ sheetId: sheet.id })).dates.map((d) => d.locked)).toEqual([false, false]);

      // Monday 12:30 am: Monday is locked — no dropping it, no joining it.
      vi.setSystemTime(new Date('2026-09-28T07:30:00Z'));
      await expect(api.ana.release({ dateId: monday })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.beto.claim({ dateId: monday })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const view = await api.ana.get({ sheetId: sheet.id });
      expect(view.today).toBe('2026-09-28');
      expect(view.dates.map((d) => d.locked)).toEqual([true, false]);
      await api.ana.release({ dateId: tuesday });
    });

    it('refuses a day long past', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await expect(api.ana.claim({ dateId: await dateId(sheet.id, LONG_AGO) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('keeps a closed sheet readable but not changeable', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_1) });
      await api.admin.update({ id: sheet.id, open: false });

      await expect(api.ana.release({ dateId: await dateId(sheet.id, DAY_1) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.beto.claim({ dateId: await dateId(sheet.id, DAY_2) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const view = await api.ana.get({ sheetId: sheet.id });
      expect(view.open).toBe(false);
      expect(view.myCount).toBe(1);
    });

    it('answers a removed day with NOT_FOUND', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);
      await api.admin.removeDate({ dateId: day });
      await expect(api.ana.claim({ dateId: day })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('what classmates see', () => {
    it('shows a first name and last initial, and never an email or a student number', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);
      await api.ana.claim({ dateId: day });
      await api.admin.assign({ dateId: day, userId: dani.id });

      const view = await api.beto.get({ sheetId: sheet.id });
      expect(view.dates.find((d) => d.date === DAY_1)!.people).toEqual([{ you: false, name: 'Ana R.' }, { you: false, name: null }]);
      const text = JSON.stringify(view);
      expect(text).not.toContain('@');
      expect(text).not.toContain('Ruiz');
      expect(text).not.toContain('100005');
      expect(text).not.toContain('userId');
    });

    it('shows only "taken" for an account whose name is its email', async () => {
      const api = await load();
      await testDb.update(schema.users).set({ name: carla.email }).where(eq(schema.users.id, carla.id));
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);
      await api.carla.claim({ dateId: day });

      const view = await api.beto.get({ sheetId: sheet.id });
      expect(view.dates.find((d) => d.date === DAY_1)!.people).toEqual([{ you: false, name: null }]);
      expect(JSON.stringify(view)).not.toContain('@');
    });

    it('hides classmates entirely when the teacher turns names off, but not the student’s own', async () => {
      const api = await load();
      const sheet = await createSheet(api, { showNames: false });
      const day = await dateId(sheet.id, DAY_1);
      await api.ana.claim({ dateId: day });
      await api.beto.claim({ dateId: day });

      const view = await api.beto.get({ sheetId: sheet.id });
      const day1 = view.dates.find((d) => d.date === DAY_1)!;
      expect(day1).toMatchObject({ taken: 2, mine: true });
      expect(day1.people).toEqual([{ you: false, name: null }, { you: true, name: 'Beto S.' }]);
    });
  });

  describe('the teacher', () => {
    it('can put a student anywhere, and the student cannot drop that day', async () => {
      const api = await load();
      const sheet = await createSheet(api, { slotsPerDate: 1, picksPerStudent: 1 });
      const day1 = await dateId(sheet.id, DAY_1);
      const day2 = await dateId(sheet.id, DAY_2);
      await api.ana.claim({ dateId: day1 });

      // Over capacity, over the student's limit, and a day long past.
      await api.admin.assign({ dateId: day1, userId: beto.id });
      await api.admin.assign({ dateId: day2, userId: beto.id });
      await api.admin.assign({ dateId: await dateId(sheet.id, LONG_AGO), userId: beto.id });
      await expect(api.admin.assign({ dateId: day1, userId: beto.id })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(api.admin.assign({ dateId: day1, userId: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const betoView = await api.beto.get({ sheetId: sheet.id });
      expect(betoView.dates.find((d) => d.date === DAY_1)).toMatchObject({ mine: true, assigned: true, taken: 2 });
      await expect(api.beto.release({ dateId: day2 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const full = await api.admin.adminGet({ sheetId: sheet.id });
      const claim = full.dates.find((d) => d.date === DAY_2)!.claims[0];
      expect(claim).toMatchObject({ userId: beto.id, name: 'Beto Soto', email: beto.email, assigned: true });
      await api.admin.unassign({ claimId: claim.id });
      expect(await claimsOn(day2)).toEqual([]);
    });

    it('sees the whole roster, with who still owes picks, and no admins in it', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_2) });
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_1) });
      await api.beto.claim({ dateId: await dateId(sheet.id, DAY_1) });

      const view = await api.admin.adminGet({ sheetId: sheet.id });
      expect(view.roster.map((s) => [s.name, s.dates])).toEqual([
        ['100005', []],
        ['Ana Ruiz', [DAY_1, DAY_2]],
        ['Beto Soto', [DAY_1]],
        ['Carla Vega', []],
      ]);
      expect(view.sheet.groupIds).toEqual([STATS]);
      expect(view.dates.map((d) => d.effectiveCapacity)).toEqual([2, 2, 2, 2]);

      const [listed] = await api.admin.adminList();
      expect(listed).toMatchObject({ dateCount: 4, slots: 8, claimCount: 3, firstDate: LONG_AGO, lastDate: DAY_3 });
    });

    it('adds and relabels days without dropping any, and refuses days that do not exist', async () => {
      const api = await load();
      const sheet = await createSheet(api, { dates: [{ date: DAY_1, label: 'old' }] });
      const result = await api.admin.saveDates({
        sheetId: sheet.id,
        dates: [{ date: DAY_1, label: 'Day 31', capacity: 3 }, { date: DAY_2, label: 'Day 32' }, { date: DAY_2, label: 'dupe' }],
      });
      expect(result).toEqual({ added: 1, updated: 1 });
      const view = await api.admin.adminGet({ sheetId: sheet.id });
      expect(view.dates.map((d) => [d.date, d.label, d.effectiveCapacity])).toEqual([[DAY_1, 'Day 31', 3], [DAY_2, 'Day 32', 2]]);

      // A bare date, or a line with no capacity, keeps what the day already has.
      expect(await api.admin.saveDates({ sheetId: sheet.id, dates: [{ date: DAY_1 }, { date: DAY_2, label: 'Day 32 · Volcanoes' }] }))
        .toEqual({ added: 0, updated: 1 });
      const again = await api.admin.adminGet({ sheetId: sheet.id });
      expect(again.dates.map((d) => [d.date, d.label, d.effectiveCapacity])).toEqual([[DAY_1, 'Day 31', 3], [DAY_2, 'Day 32 · Volcanoes', 2]]);

      await expect(api.admin.saveDates({ sheetId: sheet.id, dates: [{ date: '2099-02-30' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveDates({ sheetId: 999, dates: [{ date: DAY_3 }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('says how many picks a removed day took with it', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      const day = await dateId(sheet.id, DAY_1);
      await api.ana.claim({ dateId: day });
      await api.beto.claim({ dateId: day });
      expect(await api.admin.removeDate({ dateId: day })).toEqual({ removedClaims: 2 });
      expect(await claimsOn(day)).toEqual([]);
    });

    it('replaces groups on update, and refuses a time zone that does not exist', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.admin.update({ id: sheet.id, groupIds: [SPANISH] });
      expect(await api.ana.list()).toEqual([]);
      await api.admin.update({ id: sheet.id, groupIds: [] });
      expect((await api.ana.list()).map((s) => s.id)).toEqual([sheet.id]);

      await expect(api.admin.update({ id: sheet.id, timeZone: 'Mars/Olympus_Mons' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.update({ id: sheet.id, groupIds: [42] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.update({ id: 999, open: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('deletes a sheet with its days and picks', async () => {
      const api = await load();
      const sheet = await createSheet(api);
      await api.ana.claim({ dateId: await dateId(sheet.id, DAY_1) });
      await api.admin.remove({ id: sheet.id });
      expect(await testDb.select().from(schema.signupDates)).toEqual([]);
      expect(await testDb.select().from(schema.signupClaims)).toEqual([]);
      expect(await testDb.select().from(schema.signupSheetGroups)).toEqual([]);
    });
  });
});
