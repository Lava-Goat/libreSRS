// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { GoogleSignInHealth, type GoogleSignInStatus } from './googleSignInHealth.js';

const { client, db: testDb, sqlite } = createTestDb();
vi.mock('../db/index.js', () => ({ db: testDb, schema }));

type Service = typeof import('./pinLogin.js');
let svc: Service;

const teacher = { id: 1, googleId: 'g1', email: 'teacher@school.test', name: 'Teacher Example', role: 'admin' as const };
const ana = { id: 2, googleId: 'g2', email: '123456@students.school.test', name: 'Ana Ruiz', role: 'user' as const };
const beto = { id: 3, googleId: 'g3', email: '654321@students.school.test', name: 'Beto Soto', role: 'user' as const };
const carla = { id: 4, googleId: 'g4', email: 'carla.vega@students.school.test', name: 'Carla Vega', role: 'user' as const };
const twinA = { id: 5, googleId: 'g5', email: 'twin@students.school.test', name: 'Twin A', role: 'user' as const };
const twinB = { id: 6, googleId: 'g6', email: 'twin@gmail.test', name: 'Twin B', role: 'user' as const };
const noPin = { id: 7, googleId: 'g7', email: '222333@students.school.test', name: 'Álvaro Paz', role: 'user' as const };
const USERS = [teacher, ana, beto, carla, twinA, twinB, noPin];

// Test PINs only (never a real one).
const PIN = '5927';
const OTHER = '6184';
const MIN = 60_000;
const NOW = Date.UTC(2026, 2, 2, 19, 0);

const pinRow = (userId: number) => testDb.select().from(schema.userPins).where(eq(schema.userPins.userId, userId)).get();

/** Gives a student a known PIN, as if made at `at`. */
async function setPin(userId: number, pin = PIN, at = NOW - 60 * MIN) {
  const { hash, salt } = await svc.newPinHash(pin);
  const date = new Date(at);
  testDb.insert(schema.userPins).values({ userId, pinHash: hash, pinSalt: salt, createdAt: date, updatedAt: date })
    .onConflictDoUpdate({ target: schema.userPins.userId, set: { pinHash: hash, pinSalt: salt, createdAt: date, updatedAt: date } })
    .run();
}

/** A verify/dummy pair that counts every scrypt. */
function counting() {
  const calls = { verify: 0, dummy: 0 };
  return {
    calls,
    verify: async (pin: string, hash: string, salt: string) => { calls.verify += 1; return svc.pinMatches(pin, hash, salt); },
    dummy: async (pin: string) => { calls.dummy += 1; await svc.dummyPinCheck(pin); },
  };
}

/** A fast stand-in for scrypt when the hashing is not what a test is about. */
const fastVerify = (right: string) => async (pin: string) => pin === right;
const fastDummy = async () => undefined;

const status = (over: Partial<GoogleSignInStatus> = {}): GoogleSignInStatus => ({
  looksBlocked: false, since: null, reason: null, unansweredBrowsers: 0, lastStudentSignInAt: null, clearedAt: null, watchingSince: 0, ...over,
});

beforeAll(async () => {
  svc = await import('./pinLogin.js');
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await setupFsrsSchema(client, { reset: true });
  testDb.insert(schema.users).values(USERS).run();
  testDb.insert(schema.studentNumberOverrides).values({ userId: carla.id, studentNumber: 'S-700123', updatedAt: new Date(NOW) }).run();
});

describe('easy PINs', () => {
  it('lists exactly 587 easy PINs, leaving exactly 8,468 to give out in 1000-9999', () => {
    expect(svc.easyPins().size).toBe(587);
    let issuable = 0;
    for (let n = 1000; n <= 9999; n++) if (!svc.isEasyPin(String(n))) issuable += 1;
    expect(issuable).toBe(8468);
    for (const pin of svc.easyPins()) expect(pin).toMatch(/^\d{4}$/);
  });

  it('includes repeats, runs, patterns, years and keypad lines, and not ordinary PINs', () => {
    for (const pin of ['0000', '1111', '1234', '4321', '0123', '9876', '7890', '1212', '6969', '1122', '1221', '2002',
      '1112', '2111', '1950', '2009', '2030', '2580', '1004', '8901', '2109', '0987', '8008']) {
      expect(svc.isEasyPin(pin), pin).toBe(true);
    }
    for (const pin of ['5927', '6184', '7305', '1949', '2031', '4817']) expect(svc.isEasyPin(pin), pin).toBe(false);
  });
});

describe('generatePin', () => {
  it('draws again until the PIN is not easy', () => {
    const draws = [1234, 2009, 5927];
    const randomInt = vi.fn(() => draws.shift() as number);
    expect(svc.generatePin(randomInt)).toBe('5927');
    expect(randomInt).toHaveBeenCalledTimes(3);
    expect(randomInt).toHaveBeenCalledWith(1000, 10000);
  });

  it('gives 4 digits with no leading zero and never an easy PIN', () => {
    for (let i = 0; i < 2000; i++) {
      const pin = svc.generatePin();
      expect(pin).toMatch(/^[1-9]\d{3}$/);
      expect(svc.isEasyPin(pin)).toBe(false);
    }
  });
});

describe('hashing', () => {
  it('salts every hash, checks the right PIN only, and never keeps the PIN', async () => {
    const a = await svc.newPinHash(PIN);
    const b = await svc.newPinHash(PIN);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.hash).not.toBe(PIN);
    expect(await svc.pinMatches(PIN, a.hash, a.salt)).toBe(true);
    expect(await svc.pinMatches(OTHER, a.hash, a.salt)).toBe(false);
    expect(await svc.pinMatches(PIN, a.hash, b.salt)).toBe(false);
    expect(await svc.pinMatches(PIN, 'abcd', a.salt)).toBe(false);
  });

  it('locks for 15 minutes, doubling per level, at most 24 hours', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((level) => svc.lockDurationMs(level) / MIN))
      .toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440, 1440]);
  });
});

describe('findPinCandidate', () => {
  it('finds a student by number, by email in any case or spacing, and by a teacher-set number', async () => {
    await setPin(ana.id);
    await setPin(carla.id);
    for (const username of ['123456', ' 123456 ', '123456@students.school.test', '123456@STUDENTS.SCHOOL.TEST', '  123456@Students.school.test']) {
      expect(svc.findPinCandidate(username), username).toMatchObject({ kind: 'user', user: { id: ana.id } });
    }
    expect(svc.findPinCandidate('s-700123')).toMatchObject({ kind: 'user', user: { id: carla.id } });
    expect(svc.findPinCandidate('S-700123')).toMatchObject({ kind: 'user', user: { id: carla.id } });
    expect(svc.findPinCandidate('carla.vega')).toMatchObject({ kind: 'user', user: { id: carla.id } });
  });

  it('never lets % or _ wildcard someone else', async () => {
    await setPin(ana.id);
    for (const username of ['1234%', '12345_', '%', '_23456', '%@students.school.test', '12%@students.school.test']) {
      expect(svc.findPinCandidate(username), username).toEqual({ kind: 'none', why: 'unknown_user' });
    }
  });

  it('resolves a shared number to the one account with a PIN, else asks for the full email', async () => {
    expect(svc.findPinCandidate('twin')).toEqual({ kind: 'none', why: 'no_pin' });
    await setPin(twinB.id);
    expect(svc.findPinCandidate('twin')).toMatchObject({ kind: 'user', user: { id: twinB.id } });
    await setPin(twinA.id);
    expect(svc.findPinCandidate('twin')).toEqual({ kind: 'ambiguous' });
    // An email is exact.
    expect(svc.findPinCandidate('twin@students.school.test')).toMatchObject({ kind: 'user', user: { id: twinA.id } });
  });

  it('treats an email local part and an override naming two PIN holders as ambiguous', async () => {
    testDb.update(schema.studentNumberOverrides).set({ studentNumber: '123456' }).where(eq(schema.studentNumberOverrides.userId, carla.id)).run();
    await setPin(ana.id);
    expect(svc.findPinCandidate('123456')).toMatchObject({ kind: 'user', user: { id: ana.id } });
    await setPin(carla.id);
    expect(svc.findPinCandidate('123456')).toEqual({ kind: 'ambiguous' });
  });

  it('names an admin match as admin, a student without a PIN as no_pin, and nonsense as unknown', async () => {
    await setPin(teacher.id); // a row an admin could only have from before a promotion
    expect(svc.findPinCandidate('teacher')).toEqual({ kind: 'none', why: 'admin' });
    expect(svc.findPinCandidate('teacher@school.test')).toEqual({ kind: 'none', why: 'admin' });
    expect(svc.findPinCandidate('222333')).toEqual({ kind: 'none', why: 'no_pin' });
    for (const username of ['999999', '', '   ', 'a b', 'x@y@z', 42, null, undefined, { email: 'x' }, 'x'.repeat(201)]) {
      expect(svc.findPinCandidate(username)).toEqual({ kind: 'none', why: 'unknown_user' });
    }
  });
});

describe('attemptPinSignIn', () => {
  const IP = '203.0.113.10';
  let limiter: InstanceType<Service['IpFailureLimiter']>;
  beforeEach(() => {
    limiter = new svc.IpFailureLimiter();
  });
  const attempt = (username: unknown, pin: string, extra: Partial<Parameters<Service['attemptPinSignIn']>[0]> = {}) =>
    svc.attemptPinSignIn({ username, pin, ip: IP, now: NOW, limiter, ...extra });

  it('signs a student in, clearing the counters and noting when', async () => {
    await setPin(ana.id);
    testDb.update(schema.userPins).set({ failedCount: 3, lockLevel: 2 }).where(eq(schema.userPins.userId, ana.id)).run();
    const result = await attempt('123456', PIN);
    expect(result).toEqual({
      kind: 'success',
      user: { id: ana.id, googleId: 'g2', email: ana.email, name: ana.name, picture: null, role: 'user' },
    });
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null, lastUsedAt: new Date(NOW), updatedAt: new Date(NOW) });
  });

  it('lets four wrong PINs be followed by the right one', async () => {
    await setPin(ana.id);
    for (let i = 1; i <= 4; i++) {
      expect(await attempt('123456', OTHER, { now: NOW + i })).toEqual({ kind: 'invalid', reason: 'wrong_pin', userId: ana.id, failedCount: i });
    }
    expect(await attempt('123456', PIN, { now: NOW + 5 })).toMatchObject({ kind: 'success' });
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null });
  });

  it('locks after five wrong PINs for 15 minutes, refuses the right one while locked, and counts nothing then', async () => {
    await setPin(ana.id);
    for (let i = 0; i < 4; i++) await attempt('123456', OTHER);
    expect(await attempt('123456', OTHER)).toEqual({ kind: 'locked', userId: ana.id, retryAfterMs: 15 * MIN, started: true, lockLevel: 1 });
    const locked = pinRow(ana.id);
    expect(locked).toMatchObject({ failedCount: 0, lockLevel: 1, lockedUntil: new Date(NOW + 15 * MIN) });
    const counter = counting();
    expect(await attempt('123456', PIN, { now: NOW + 5 * MIN, ...counter }))
      .toEqual({ kind: 'locked', userId: ana.id, retryAfterMs: 10 * MIN, started: false, lockLevel: 1 });
    expect(counter.calls).toEqual({ verify: 0, dummy: 1 });
    expect(pinRow(ana.id)).toEqual(locked);
    // When the lock ends, the right PIN works.
    expect(await attempt('123456', PIN, { now: NOW + 15 * MIN })).toMatchObject({ kind: 'success' });
  });

  /** Five wrong PINs at `now` (fast hashes); returns the lock they start, in minutes. */
  const lockAt = async (now: number) => {
    let result;
    for (let i = 0; i < 5; i++) result = await attempt('123456', OTHER, { now, verify: fastVerify(PIN), dummy: fastDummy });
    expect(result).toMatchObject({ kind: 'locked', started: true });
    return (result as { retryAfterMs: number }).retryAfterMs / MIN;
  };

  it('doubles each further lock up to 24 hours, and a 24-hour lock that ends is followed by another', async () => {
    await setPin(ana.id);
    let now = NOW;
    const locks: number[] = [];
    // An attacker back 1 ms after each lock ends (a 24-hour lock is 24 hours with no wrong PIN).
    for (let lock = 0; lock < 12; lock++) {
      const minutes = await lockAt(now);
      locks.push(minutes);
      now += minutes * MIN + 1;
    }
    expect(locks).toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440, 1440, 1440, 1440]);
    expect(pinRow(ana.id)).toMatchObject({ lockLevel: 10 });
  });

  it('keeps the lock level through any quiet time; only a success, Unlock or a new PIN starts it again', async () => {
    await setPin(ana.id);
    expect(await lockAt(NOW)).toBe(15);
    expect(await lockAt(NOW + 15 * MIN)).toBe(30);
    // A month with no wrong PIN: the next five still lock for an hour.
    const month = NOW + 30 * 24 * 60 * MIN;
    expect(await lockAt(month)).toBe(60);
    expect(pinRow(ana.id)).toMatchObject({ lockLevel: 3 });

    // The right PIN once the lock ends: back to 15 minutes.
    expect(await attempt('123456', PIN, { now: month + 60 * MIN, verify: fastVerify(PIN), dummy: fastDummy })).toMatchObject({ kind: 'success' });
    expect(await lockAt(month + 61 * MIN)).toBe(15);
    expect(await lockAt(month + 76 * MIN)).toBe(30);
    // The teacher's Unlock.
    expect(svc.unlockPin(ana.id, month + 77 * MIN)).toBe(true);
    expect(await lockAt(month + 78 * MIN)).toBe(15);
    // A new PIN.
    expect(await lockAt(month + 93 * MIN)).toBe(30);
    await svc.createPinForUser(ana.id, month + 94 * MIN);
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null });
  });

  it('forgets a few wrong PINs after 24 hours with none (a lock level stays)', async () => {
    await setPin(ana.id);
    const options = { verify: fastVerify(PIN), dummy: fastDummy };
    expect(await lockAt(NOW)).toBe(15);
    expect(await lockAt(NOW + 15 * MIN)).toBe(30);
    expect(pinRow(ana.id)).toMatchObject({ lockLevel: 2 });
    for (let i = 0; i < 2; i++) await attempt('123456', OTHER, { now: NOW + 2 * 60 * MIN, ...options });
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 2, lockLevel: 2 });
    const later = NOW + 2 * 60 * MIN + 24 * 60 * MIN + 1;
    expect(await attempt('123456', OTHER, { now: later, ...options })).toMatchObject({ kind: 'invalid', failedCount: 1 });
    for (let i = 0; i < 3; i++) await attempt('123456', OTHER, { now: later, ...options });
    expect(await attempt('123456', OTHER, { now: later, ...options })).toMatchObject({ kind: 'locked', retryAfterMs: 60 * MIN, lockLevel: 3 });
  });

  it('refuses an admin, an unknown name, a student without a PIN and a deleted student alike, with one scrypt each', async () => {
    await setPin(teacher.id);
    await setPin(ana.id);
    const cases: [unknown, string][] = [['teacher@school.test', 'admin'], ['teacher', 'admin'], ['999999', 'unknown_user'], ['222333', 'no_pin'], [null, 'unknown_user']];
    for (const [username, reason] of cases) {
      const counter = counting();
      expect(await attempt(username, PIN, counter)).toEqual({ kind: 'invalid', reason });
      expect(counter.calls.verify + counter.calls.dummy, String(username)).toBe(1);
    }
    // Deleted while its PIN was being checked.
    const counter = counting();
    const deleting = async (pin: string, hash: string, salt: string) => {
      const ok = await counter.verify(pin, hash, salt);
      testDb.delete(schema.users).where(eq(schema.users.id, ana.id)).run();
      return ok;
    };
    expect(await attempt('123456', PIN, { verify: deleting, dummy: counter.dummy })).toEqual({ kind: 'invalid', reason: 'unknown_user', userId: ana.id });
    expect(counter.calls).toEqual({ verify: 1, dummy: 0 });
    expect(pinRow(ana.id)).toBeUndefined();
    // Nothing was counted against the teacher's row.
    expect(pinRow(teacher.id)).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null });
  });

  it('refuses a PIN replaced (or removed) while it was being checked', async () => {
    await setPin(ana.id);
    const replacing = async (pin: string, hash: string, salt: string) => {
      const ok = await svc.pinMatches(pin, hash, salt);
      await svc.createPinForUser(ana.id);
      return ok;
    };
    expect(await attempt('123456', PIN, { verify: replacing })).toEqual({ kind: 'invalid', reason: 'pin_changed', userId: ana.id });
    await setPin(ana.id);
    const removing = async (pin: string, hash: string, salt: string) => {
      const ok = await svc.pinMatches(pin, hash, salt);
      svc.removePin(ana.id);
      return ok;
    };
    expect(await attempt('123456', PIN, { verify: removing })).toEqual({ kind: 'invalid', reason: 'pin_changed', userId: ana.id });
  });

  it('refuses a student promoted to admin while the PIN was being checked', async () => {
    await setPin(ana.id);
    const promoting = async (pin: string, hash: string, salt: string) => {
      const ok = await svc.pinMatches(pin, hash, salt);
      testDb.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, ana.id)).run();
      return ok;
    };
    expect(await attempt('123456', PIN, { verify: promoting })).toEqual({ kind: 'invalid', reason: 'admin', userId: ana.id });
  });

  it('locks exactly once when six wrong PINs arrive at the same time', async () => {
    await setPin(ana.id);
    const results = await Promise.all(Array.from({ length: 6 }, () => attempt('123456', OTHER)));
    const kinds = results.map((r) => (r.kind === 'locked' ? `locked:${r.started ? 'start' : 'refused'}` : `${r.kind}:${'failedCount' in r ? r.failedCount : ''}`)).sort();
    expect(kinds).toEqual(['invalid:1', 'invalid:2', 'invalid:3', 'invalid:4', 'locked:refused', 'locked:start']);
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 0, lockLevel: 1, lockedUntil: new Date(NOW + 15 * MIN) });
  });

  it('answers ambiguous for a number two PIN holders share, after one scrypt', async () => {
    await setPin(twinA.id);
    await setPin(twinB.id);
    const counter = counting();
    expect(await attempt('twin', PIN, counter)).toEqual({ kind: 'ambiguous' });
    expect(counter.calls).toEqual({ verify: 0, dummy: 1 });
  });
});

describe('IpFailureLimiter', () => {
  const IP = '203.0.113.10';

  it('limits an address at its 300th failure in 15 minutes, until the window ends', () => {
    const limiter = new svc.IpFailureLimiter();
    for (let i = 0; i < 299; i++) limiter.noteFailure(IP, NOW + i);
    expect(limiter.check(IP, NOW + 300)).toEqual({ limited: false, retryAfterMs: 0 });
    limiter.noteFailure(IP, NOW + 300);
    expect(limiter.check(IP, NOW + 301)).toEqual({ limited: true, retryAfterMs: 15 * MIN - 301 });
    // Another address is not limited.
    expect(limiter.check('198.51.100.20', NOW + 301).limited).toBe(false);
    expect(limiter.check(IP, NOW + 15 * MIN).limited).toBe(false);
    limiter.noteFailure(IP, NOW + 15 * MIN);
    expect(limiter.check(IP, NOW + 15 * MIN + 1).limited).toBe(false);
    limiter.reset();
    expect(limiter.check(IP, NOW).limited).toBe(false);
  });

  it('counts only PINs checked against a student\'s PIN, and refuses at the limit without computing a hash', async () => {
    await setPin(ana.id);
    await setPin(beto.id);
    await setPin(teacher.id);
    await setPin(twinA.id);
    await setPin(twinB.id);
    const limiter = new svc.IpFailureLimiter(6, 15 * MIN);
    const go = (username: string, pin: string, extra: { verify?: Service['pinMatches']; dummy?: Service['dummyPinCheck'] } = {}) =>
      svc.attemptPinSignIn({ username, pin, ip: IP, now: NOW, limiter, verify: fastVerify(PIN), dummy: fastDummy, ...extra });
    // Five wrong PINs count, the fifth (which locks the account) too.
    for (let i = 0; i < 5; i++) await go('123456', OTHER);
    // A locked refusal checks no PIN; nor does a name nobody has, a student with no PIN, an admin or a shared number.
    for (let i = 0; i < 10; i++) expect(await go('123456', PIN)).toMatchObject({ kind: 'locked', started: false });
    for (let i = 0; i < 20; i++) {
      for (const username of ['999999', '222333', 'teacher', 'twin']) expect((await go(username, OTHER)).kind).not.toBe('ip_limited');
    }
    expect(limiter.check(IP, NOW).limited).toBe(false);
    // A success gives its slot back.
    expect(await go('654321', PIN)).toMatchObject({ kind: 'success' });
    expect(limiter.check(IP, NOW).limited).toBe(false);
    expect(await go('654321', OTHER)).toMatchObject({ kind: 'invalid', reason: 'wrong_pin' });
    expect(limiter.check(IP, NOW).limited).toBe(true);
    // At the limit nothing is hashed, whoever is named: the answer does not tell who exists.
    for (const username of ['654321', '999999']) {
      const counter = counting();
      expect(await go(username, PIN, counter)).toEqual({ kind: 'ip_limited', retryAfterMs: 15 * MIN });
      expect(counter.calls).toEqual({ verify: 0, dummy: 0 });
    }
  });

  it('lets one student fill no school budget with names nobody has: a classmate\'s right PIN still works', async () => {
    await setPin(ana.id);
    const limiter = new svc.IpFailureLimiter();
    const go = (username: string, pin: string) =>
      svc.attemptPinSignIn({ username, pin, ip: IP, now: NOW, limiter, verify: fastVerify(PIN), dummy: fastDummy });
    for (let i = 0; i < 400; i++) expect(await go(`nobody${i}`, OTHER)).toEqual({ kind: 'invalid', reason: 'unknown_user' });
    expect(await go('123456', PIN)).toMatchObject({ kind: 'success' });
  });

  it('takes the slot before the hash: attempts in flight together cannot pass the cap', async () => {
    await setPin(ana.id);
    await setPin(beto.id);
    await setPin(carla.id);
    const limiter = new svc.IpFailureLimiter(3, 15 * MIN);
    let checked = 0;
    // A slow hash, so every attempt is in flight before the first one finishes.
    const verify = async (pin: string) => {
      checked += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return pin === PIN;
    };
    const names = ['123456', '654321', 'S-700123'];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      svc.attemptPinSignIn({ username: names[i % 3], pin: OTHER, ip: IP, now: NOW, limiter, verify, dummy: fastDummy })));
    expect(checked).toBe(3);
    expect(results.filter((r) => r.kind === 'ip_limited')).toHaveLength(9);
    expect(results.filter((r) => r.kind === 'invalid')).toHaveLength(3);
  });

  it('normalizes IPv4-mapped addresses', () => {
    expect(svc.clientIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
    expect(svc.clientIp(undefined)).toBe('');
  });
});

describe('the teacher making PINs', () => {
  beforeEach(() => {
    testDb.insert(schema.groups).values([{ id: 7, name: 'Year 1 Spanish' }, { id: 8, name: 'Period 3' }]).run();
    testDb.insert(schema.userGroups).values([teacher, ana, beto, carla, twinA].map((u) => ({ userId: u.id, groupId: 7 }))).run();
    testDb.insert(schema.userGroups).values([ana, noPin].map((u) => ({ userId: u.id, groupId: 8 }))).run();
  });

  /** No column of a stored PIN row is the PIN itself. */
  const expectNoPlaintext = (userId: number, pin: string) => {
    const raw = sqlite.prepare('SELECT * FROM user_pins WHERE user_id = ?').get(userId) as Record<string, unknown>;
    expect(raw).toBeDefined();
    for (const value of Object.values(raw)) expect(String(value)).not.toBe(pin);
    expect(raw.pin_hash).toMatch(/^[0-9a-f]{64}$/);
  };

  it('makes PINs for the students without one, skipping admins, sorted by name', async () => {
    await setPin(beto.id);
    const oldBeto = pinRow(beto.id);
    expect(svc.groupPinCounts(7)).toEqual({ students: 4, withPin: 1 });
    const result = await svc.createPinsForGroup(7, true, NOW);
    expect(result).toMatchObject({ skippedHavePin: 1, skippedNotStudent: 1, replaced: 0 });
    expect(result!.pins.map((p) => [p.userId, p.name, p.email, p.studentNumber])).toEqual([
      [ana.id, 'Ana Ruiz', ana.email, '123456'],
      [carla.id, 'Carla Vega', carla.email, 'S-700123'],
      [twinA.id, 'Twin A', twinA.email, null],
    ]);
    for (const made of result!.pins) {
      expect(made.pin).toMatch(/^[1-9]\d{3}$/);
      expect(svc.isEasyPin(made.pin)).toBe(false);
      const row = pinRow(made.userId)!;
      expect(await svc.pinMatches(made.pin, row.pinHash, row.pinSalt)).toBe(true);
      expect(row).toMatchObject({ createdAt: new Date(NOW), failedCount: 0, lockLevel: 0, lockedUntil: null, lastUsedAt: null });
      expectNoPlaintext(made.userId, made.pin);
    }
    expect(pinRow(beto.id)).toEqual(oldBeto);
    expect(pinRow(teacher.id)).toBeUndefined();
    expect(svc.groupPinCounts(7)).toEqual({ students: 4, withPin: 4 });
  });

  it('replaces every student\'s PIN when asked, and the old one stops working', async () => {
    await setPin(beto.id);
    testDb.update(schema.userPins).set({ failedCount: 4, lockLevel: 3, lockedUntil: new Date(NOW + MIN) }).where(eq(schema.userPins.userId, beto.id)).run();
    const result = await svc.createPinsForGroup(7, false, NOW);
    expect(result).toMatchObject({ skippedHavePin: 0, skippedNotStudent: 1, replaced: 1 });
    expect(result!.pins).toHaveLength(4);
    const row = pinRow(beto.id)!;
    expect(await svc.pinMatches(PIN, row.pinHash, row.pinSalt)).toBe(false);
    const newPin = result!.pins.find((p) => p.userId === beto.id)!.pin;
    expect(await svc.pinMatches(newPin, row.pinHash, row.pinSalt)).toBe(true);
    // A new PIN also ends a lock.
    expect(row).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null });
  });

  it('gives a student in two groups one PIN: the second group skips them', async () => {
    await svc.createPinsForGroup(7, true, NOW);
    const second = await svc.createPinsForGroup(8, true, NOW);
    expect(second).toMatchObject({ skippedHavePin: 1, skippedNotStudent: 0 });
    expect(second!.pins.map((p) => p.userId)).toEqual([noPin.id]);
    const again = await svc.createPinsForGroup(8, true, NOW);
    expect(again).toMatchObject({ pins: [], skippedHavePin: 2 });
  });

  it('answers null for a missing group', async () => {
    expect(await svc.createPinsForGroup(999, true)).toBeNull();
    expect(svc.groupPinCounts(999)).toBeNull();
    expect(svc.groupPinCounts(8)).toEqual({ students: 2, withPin: 0 });
  });

  it('makes one student\'s PIN, refusing an admin and a missing user', async () => {
    const made = await svc.createPinForUser(carla.id, NOW);
    expect(made).toMatchObject({ userId: carla.id, name: 'Carla Vega', email: carla.email, studentNumber: 'S-700123', replaced: false });
    expectNoPlaintext(carla.id, made.pin);
    const again = await svc.createPinForUser(carla.id, NOW + 1);
    expect(again.replaced).toBe(true);
    const row = pinRow(carla.id)!;
    expect(await svc.pinMatches(again.pin, row.pinHash, row.pinSalt)).toBe(true);
    await expect(svc.createPinForUser(teacher.id)).rejects.toThrow('not_student');
    await expect(svc.createPinForUser(999)).rejects.toThrow('not_found');
    expect(pinRow(teacher.id)).toBeUndefined();
  });

  it('removes and unlocks a PIN, saying whether there was one', async () => {
    expect(svc.removePin(ana.id)).toBe(false);
    expect(svc.unlockPin(ana.id)).toBe(false);
    await setPin(ana.id);
    testDb.update(schema.userPins).set({ failedCount: 2, lockLevel: 3, lockedUntil: new Date(NOW + 60 * MIN) }).where(eq(schema.userPins.userId, ana.id)).run();
    expect(svc.pinStatusFor(ana.id, NOW)).toMatchObject({ hasPin: true, lockedUntil: NOW + 60 * MIN, failedCount: 2 });
    expect(svc.unlockPin(ana.id, NOW)).toBe(true);
    expect(pinRow(ana.id)).toMatchObject({ failedCount: 0, lockLevel: 0, lockedUntil: null, updatedAt: new Date(NOW) });
    expect(svc.removePin(ana.id)).toBe(true);
    expect(pinRow(ana.id)).toBeUndefined();
  });

  it('reports a PIN\'s status, hiding a lock that has ended', async () => {
    expect(svc.pinStatusFor(999)).toBeNull();
    expect(svc.pinStatusFor(teacher.id, NOW)).toEqual({
      userId: teacher.id, eligible: false, hasPin: false, createdAt: null, lastUsedAt: null, lockedUntil: null, failedCount: 0,
    });
    await setPin(ana.id, PIN, NOW - MIN);
    testDb.update(schema.userPins).set({ lockedUntil: new Date(NOW - 1), lastUsedAt: new Date(NOW - 2) }).where(eq(schema.userPins.userId, ana.id)).run();
    expect(svc.pinStatusFor(ana.id, NOW)).toEqual({
      userId: ana.id, eligible: true, hasPin: true, createdAt: NOW - MIN, lastUsedAt: NOW - 2, lockedUntil: null, failedCount: 0,
    });
  });

  it('deletes a PIN with its student', async () => {
    await setPin(ana.id);
    testDb.delete(schema.users).where(eq(schema.users.id, ana.id)).run();
    expect(pinRow(ana.id)).toBeUndefined();
  });
});

describe('the mode', () => {
  it('is auto with no settings row, and with a value it does not know', () => {
    expect(svc.getPinLoginMode()).toBe('auto');
    sqlite.prepare("INSERT INTO app_settings (id, pin_login_mode) VALUES (1, 'bogus')").run();
    expect(svc.getPinLoginMode()).toBe('auto');
  });

  it('saves the mode, and saving the AI settings later leaves it as it was', async () => {
    expect(await svc.setPinLoginMode('on')).toBe('on');
    expect(svc.getPinLoginMode()).toBe('on');
    const { updateAppSettings } = await import('./appSettings.js');
    await updateAppSettings({ aiEnabled: true });
    expect(svc.getPinLoginMode()).toBe('on');
    expect(sqlite.prepare('SELECT ai_enabled, pin_login_mode FROM app_settings').get()).toEqual({ ai_enabled: 1, pin_login_mode: 'on' });
    expect(await svc.setPinLoginMode('off')).toBe('off');
    expect(svc.getPinLoginMode()).toBe('off');
  });

  it('decides what the login page shows and what POST /auth/pin accepts', () => {
    const blocked = status({ looksBlocked: true, since: NOW - 10 * MIN, reason: 'no_returns' });
    const ok = status();
    const justCleared = status({ clearedAt: NOW - 15 * MIN });
    const longCleared = status({ clearedAt: NOW - 15 * MIN - 1 });
    expect(svc.pinLoginAvailability('on', ok, NOW)).toEqual({ pin: true, reason: 'on', acceptsPins: true });
    expect(svc.pinLoginAvailability('on', blocked, NOW)).toEqual({ pin: true, reason: 'on', acceptsPins: true });
    expect(svc.pinLoginAvailability('off', ok, NOW)).toEqual({ pin: false, reason: null, acceptsPins: false });
    expect(svc.pinLoginAvailability('off', blocked, NOW)).toEqual({ pin: false, reason: null, acceptsPins: false });
    expect(svc.pinLoginAvailability('auto', blocked, NOW)).toEqual({ pin: true, reason: 'auto', acceptsPins: true });
    expect(svc.pinLoginAvailability('auto', ok, NOW)).toEqual({ pin: false, reason: null, acceptsPins: false });
    expect(svc.pinLoginAvailability('auto', justCleared, NOW)).toEqual({ pin: false, reason: null, acceptsPins: true });
    expect(svc.pinLoginAvailability('auto', longCleared, NOW)).toEqual({ pin: false, reason: null, acceptsPins: false });
  });

  it('in auto, still takes PINs for 15 minutes after a student\'s Google sign-in clears the signal (example 6)', () => {
    const at = (hh: number, mm: number, ss = 0) => Date.UTC(2026, 2, 2, hh, mm, ss);
    const health = new GoogleSignInHealth({ now: () => at(12, 0) });
    for (let i = 0; i < 6; i++) health.noteStart(`b${i}`, at(12, 30) + i * 1000);
    expect(svc.pinLoginAvailability('auto', health.status(at(12, 33)), at(12, 33))).toEqual({ pin: true, reason: 'auto', acceptsPins: true });
    health.noteSignedIn('lucky', 'user', at(12, 40));
    expect(svc.pinLoginAvailability('auto', health.status(at(12, 41)), at(12, 41))).toEqual({ pin: false, reason: null, acceptsPins: true });
    expect(svc.pinLoginAvailability('auto', health.status(at(12, 55)), at(12, 55)).acceptsPins).toBe(true);
    expect(svc.pinLoginAvailability('auto', health.status(at(12, 55, 1)), at(12, 55, 1)).acceptsPins).toBe(false);
  });
});
