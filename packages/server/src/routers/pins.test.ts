// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { logger } from '../logger.js';

const { client, db: testDb, sqlite } = createTestDb();
vi.mock('../db/index.js', () => ({ db: testDb, schema }));

const teacher = { id: 1, googleId: 'g1', email: 'teacher@school.test', name: 'Teacher Example', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g2', email: '123456@students.school.test', name: 'Ana Ruiz', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g3', email: '654321@students.school.test', name: 'Beto Soto', picture: null, role: 'user' as const };
type AnyUser = typeof teacher | typeof ana;
const MIN = 60_000;

let api: Awaited<ReturnType<typeof load>>;

async function load() {
  const { pinsRouter } = await import('./pins.js');
  const health = await import('../services/googleSignInHealth.js');
  const svc = await import('../services/pinLogin.js');
  const callerFor = (user: AnyUser | null) => pinsRouter.createCaller({
    req: { user: user ?? undefined } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return { teacher: callerFor(teacher), ana: callerFor(ana), nobody: callerFor(null), health: health.googleSignInHealth, svc };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; cause?: { appCode?: string } };
    return { code: e.code, appCode: e.cause?.appCode };
  }
  throw new Error('expected a refusal');
}

const pinRows = () => sqlite.prepare('SELECT * FROM user_pins ORDER BY user_id').all() as Record<string, unknown>[];

beforeAll(async () => {
  api = await load();
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await setupFsrsSchema(client, { reset: true });
  testDb.insert(schema.users).values([teacher, ana, beto].map(({ picture: _p, ...u }) => u)).run();
  testDb.insert(schema.groups).values({ id: 7, name: 'Year 1 Spanish' }).run();
  testDb.insert(schema.userGroups).values([teacher, ana, beto].map((u) => ({ userId: u.id, groupId: 7 }))).run();
  api.health.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pins router', () => {
  it('tells anyone whether the login page shows the chip, and nothing else', async () => {
    const options = () => api.nobody.loginOptions();
    expect(await options()).toEqual({ pin: false, reason: null }); // auto, Google fine
    expect(Object.keys(await options()).sort()).toEqual(['pin', 'reason']);
    await api.teacher.setMode({ mode: 'on' });
    expect(await options()).toEqual({ pin: true, reason: 'on' });
    await api.teacher.setMode({ mode: 'off' });
    expect(await options()).toEqual({ pin: false, reason: null });
    await api.teacher.setMode({ mode: 'auto' });
    // Six browsers on the school's network sent back refused by a school's policy.
    for (let i = 0; i < 6; i++) api.health.noteCallback(`browser${i}`, 'admin_policy_enforced', true);
    const blocked = await options();
    expect(blocked).toEqual({ pin: true, reason: 'auto' });
    expect(Object.keys(blocked).sort()).toEqual(['pin', 'reason']);
    // A signed-in student sees the same.
    expect(await api.ana.loginOptions()).toEqual({ pin: true, reason: 'auto' });
  });

  it('keeps everything else to the teacher', async () => {
    const teacherOnly: [string, (caller: typeof api.ana) => Promise<unknown>][] = [
      ['settings', (c) => c.settings()],
      ['setMode', (c) => c.setMode({ mode: 'on' })],
      ['forUser', (c) => c.forUser({ userId: ana.id })],
      ['createForUser', (c) => c.createForUser({ userId: ana.id })],
      ['remove', (c) => c.remove({ userId: ana.id })],
      ['unlock', (c) => c.unlock({ userId: ana.id })],
      ['groupStatus', (c) => c.groupStatus({ groupId: 7 })],
      ['createForGroup', (c) => c.createForGroup({ groupId: 7, onlyMissing: false })],
    ];
    for (const [name, call] of teacherOnly) {
      expect(await refusal(call(api.ana)), name).toEqual({ code: 'FORBIDDEN', appCode: 'ADMIN_REQUIRED' });
      expect(await refusal(call(api.nobody)), name).toEqual({ code: 'UNAUTHORIZED', appCode: 'AUTH_REQUIRED' });
    }
    expect(pinRows()).toEqual([]);
    expect(sqlite.prepare('SELECT count(*) AS n FROM app_settings').get()).toEqual({ n: 0 });
  });

  it('makes a group\'s PINs: the plaintext is in the answer once, the database keeps hashes, the log keeps counts', async () => {
    const info = vi.spyOn(logger, 'info');
    expect(await api.teacher.groupStatus({ groupId: 7 })).toEqual({ students: 2, withPin: 0 });
    const made = await api.teacher.createForGroup({ groupId: 7, onlyMissing: true });
    expect(Object.keys(made).sort()).toEqual(['pins', 'skippedHavePin', 'skippedNotStudent']);
    expect(made).toMatchObject({ skippedHavePin: 0, skippedNotStudent: 1 });
    expect(made.pins.map(({ pin: _pin, ...row }) => row)).toEqual([
      { userId: ana.id, name: 'Ana Ruiz', email: ana.email, studentNumber: '123456' },
      { userId: beto.id, name: 'Beto Soto', email: beto.email, studentNumber: '654321' },
    ]);
    const plain = made.pins.map((p) => p.pin);
    for (const pin of plain) expect(pin).toMatch(/^[1-9]\d{3}$/);
    for (const row of pinRows()) {
      for (const value of Object.values(row)) expect(plain).not.toContain(String(value));
    }
    for (const made1 of made.pins) {
      const row = testDb.select().from(schema.userPins).where(eq(schema.userPins.userId, made1.userId)).get()!;
      expect(await api.svc.pinMatches(made1.pin, row.pinHash, row.pinSalt)).toBe(true);
    }
    const created = info.mock.calls.map(([fields]) => fields as { event?: string }).filter((f) => f.event === 'pins.created');
    expect(created).toEqual([{
      event: 'pins.created', scope: 'group', groupId: 7, onlyMissing: true, created: 2, replaced: 0, skippedHavePin: 0, skippedNotStudent: 1,
      userId: teacher.id,
    }]);
    for (const args of info.mock.calls) for (const pin of plain) expect(JSON.stringify(args)).not.toContain(`"${pin}"`);
    expect(await api.teacher.groupStatus({ groupId: 7 })).toEqual({ students: 2, withPin: 2 });

    // Again, only missing: nobody needs one.
    expect(await api.teacher.createForGroup({ groupId: 7, onlyMissing: true })).toEqual({ pins: [], skippedHavePin: 2, skippedNotStudent: 1 });
    // Replace all: new PINs, logged as replaced.
    const replaced = await api.teacher.createForGroup({ groupId: 7, onlyMissing: false });
    expect(replaced.pins).toHaveLength(2);
    expect(info.mock.calls.map(([f]) => f as { event?: string; replaced?: number }).filter((f) => f.event === 'pins.created').at(-1))
      .toMatchObject({ created: 2, replaced: 2, onlyMissing: false });
  });

  it('makes, shows, unlocks and removes one student\'s PIN', async () => {
    expect(await api.teacher.forUser({ userId: ana.id })).toEqual({
      userId: ana.id, eligible: true, hasPin: false, createdAt: null, lastUsedAt: null, lockedUntil: null, failedCount: 0,
    });
    const made = await api.teacher.createForUser({ userId: ana.id });
    expect(Object.keys(made).sort()).toEqual(['email', 'name', 'pin', 'studentNumber', 'userId']);
    expect(made).toMatchObject({ userId: ana.id, name: 'Ana Ruiz', email: ana.email, studentNumber: '123456' });
    expect(await api.teacher.forUser({ userId: ana.id })).toMatchObject({ hasPin: true, lockedUntil: null });

    // A lock that has ended is not shown; one that lasts is, until Unlock.
    testDb.update(schema.userPins).set({ lockedUntil: new Date(Date.now() - MIN) }).where(eq(schema.userPins.userId, ana.id)).run();
    expect((await api.teacher.forUser({ userId: ana.id })).lockedUntil).toBeNull();
    const until = Date.now() + 15 * MIN;
    testDb.update(schema.userPins).set({ lockedUntil: new Date(until), lockLevel: 1 }).where(eq(schema.userPins.userId, ana.id)).run();
    expect((await api.teacher.forUser({ userId: ana.id })).lockedUntil).toBe(until);
    expect(await api.teacher.unlock({ userId: ana.id })).toEqual({ unlocked: true });
    expect((await api.teacher.forUser({ userId: ana.id })).lockedUntil).toBeNull();

    expect(await api.teacher.remove({ userId: ana.id })).toEqual({ removed: true });
    expect(await api.teacher.remove({ userId: ana.id })).toEqual({ removed: false });
    expect(await api.teacher.unlock({ userId: ana.id })).toEqual({ unlocked: false });
    expect(await api.teacher.forUser({ userId: ana.id })).toMatchObject({ hasPin: false });
  });

  it('never makes an admin a PIN, and says when a user or group is missing', async () => {
    expect(await refusal(api.teacher.createForUser({ userId: teacher.id }))).toEqual({ code: 'BAD_REQUEST', appCode: 'PIN_NOT_FOR_ADMIN' });
    expect(await api.teacher.forUser({ userId: teacher.id })).toMatchObject({ eligible: false, hasPin: false });
    expect(await refusal(api.teacher.createForUser({ userId: 999 }))).toEqual({ code: 'NOT_FOUND', appCode: 'USER_NOT_FOUND' });
    expect(await refusal(api.teacher.forUser({ userId: 999 }))).toEqual({ code: 'NOT_FOUND', appCode: 'USER_NOT_FOUND' });
    expect(await refusal(api.teacher.groupStatus({ groupId: 999 }))).toEqual({ code: 'NOT_FOUND', appCode: 'GROUP_NOT_FOUND' });
    expect(await refusal(api.teacher.createForGroup({ groupId: 999, onlyMissing: true }))).toEqual({ code: 'NOT_FOUND', appCode: 'GROUP_NOT_FOUND' });
    expect(pinRows()).toEqual([]);
  });

  it('saves the mode, checking it is one it knows, and answers the settings', async () => {
    const info = vi.spyOn(logger, 'info');
    const settings = await api.teacher.setMode({ mode: 'on' });
    expect(settings).toEqual({
      mode: 'on',
      showing: true,
      autoNetworkConfigured: true,
      google: {
        looksBlocked: false, since: null, reason: null, unansweredBrowsers: 0, lastStudentSignInAt: null,
        watchingSince: expect.any(Number),
      },
    });
    expect(info.mock.calls.map(([f]) => f as { event?: string }).filter((f) => f.event === 'pin_login.mode_changed'))
      .toEqual([{ event: 'pin_login.mode_changed', from: 'auto', to: 'on', userId: teacher.id }]);
    expect(await refusal(api.teacher.setMode({ mode: 'always' as never }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await api.teacher.settings()).toMatchObject({ mode: 'on' });

    await api.teacher.setMode({ mode: 'auto' });
    expect(await api.teacher.settings()).toMatchObject({ mode: 'auto', showing: false });
    const now = Date.now();
    for (let i = 0; i < 6; i++) api.health.noteStart(`b${i}`, now - 5 * MIN + i * 1000);
    expect(await api.teacher.settings()).toEqual({
      mode: 'auto',
      showing: true,
      autoNetworkConfigured: true,
      google: {
        looksBlocked: true, since: now - 5 * MIN, reason: 'no_returns', unansweredBrowsers: 6, lastStudentSignInAt: null,
        watchingSince: expect.any(Number),
      },
    });
  });

  it('says whether Auto can see the school network: in production only with PIN_AUTO_SCHOOL_IPS set', async () => {
    try {
      vi.stubEnv('PIN_AUTO_SCHOOL_IPS', '');
      expect(await api.teacher.settings()).toMatchObject({ autoNetworkConfigured: true }); // loopback counts outside production
      vi.stubEnv('NODE_ENV', 'production');
      expect(await api.teacher.settings()).toMatchObject({ autoNetworkConfigured: false });
      expect(await api.teacher.setMode({ mode: 'auto' })).toMatchObject({ mode: 'auto', autoNetworkConfigured: false });
      vi.stubEnv('PIN_AUTO_SCHOOL_IPS', '203.0.113.10');
      expect(await api.teacher.settings()).toMatchObject({ autoNetworkConfigured: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
