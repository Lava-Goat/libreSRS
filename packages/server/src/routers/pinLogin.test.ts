// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import * as schema from '../db/schema.js';
import type { PinLoginMode } from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { GoogleSignInHealth } from '../services/googleSignInHealth.js';
import { logger } from '../logger.js';
import { hashForLog } from '../utils/logRedaction.js';
import type { AuthenticatedUser } from '../middleware/auth.js';
import type { IpFailureSlot } from '../services/pinLogin.js';

const { client, db: testDb } = createTestDb();
vi.mock('../db/index.js', () => ({ db: testDb, schema }));

type Service = typeof import('../services/pinLogin.js');
let svc: Service;

// Test PINs only (never a real one).
const ANA_PIN = '5927';
const CARLA_PIN = '6184';
const TWIN_PIN = '7305';
const WRONG = '4817';
const SCHOOL_IP = '203.0.113.10';

let mode: PinLoginMode;
let health: GoogleSignInHealth;
let limiter: InstanceType<Service['IpFailureLimiter']>;
let signedIn: AuthenticatedUser[];
let logInError: Error | null;
let server: Server;
let base: string;

async function setPin(userId: number, pin: string) {
  const { hash, salt } = await svc.newPinHash(pin);
  const now = new Date();
  testDb.insert(schema.userPins).values({ userId, pinHash: hash, pinSalt: salt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.userPins.userId, set: { pinHash: hash, pinSalt: salt, failedCount: 0, lockLevel: 0, lockedUntil: null } })
    .run();
}

beforeAll(async () => {
  await setupFsrsSchema(client, { reset: true });
  svc = await import('../services/pinLogin.js');
  const { pinLoginBodyParser, pinLoginRouter } = await import('./pinLogin.js');
  const app = express();
  app.set('trust proxy', true);
  app.use((req, _res, next) => {
    req.logIn = ((user: AuthenticatedUser, done: (err?: unknown) => void) => {
      if (logInError) return done(logInError);
      signedIn.push(user);
      return done();
    }) as never;
    // The session's returnTo from an abandoned Google sign-in, when a test sends one.
    const sessionReturnTo = req.get('x-test-session-return-to');
    (req as unknown as { session: Record<string, unknown> }).session = sessionReturnTo ? { returnTo: sessionReturnTo } : {};
    next();
  });
  app.use('/auth/pin', pinLoginBodyParser);
  app.use(express.json({ limit: '10mb' }));
  app.use(pinLoginRouter({
    health: { status: (now?: number) => health.status(now) } as GoogleSignInHealth,
    limiter: {
      check: (ip: string, now?: number) => limiter.check(ip, now),
      noteFailure: (ip: string, now?: number) => limiter.noteFailure(ip, now),
      refund: (slot: IpFailureSlot) => limiter.refund(slot),
      reset: () => limiter.reset(),
    } as InstanceType<Service['IpFailureLimiter']>,
    getMode: () => mode,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  testDb.insert(schema.users).values([
    { id: 1, googleId: 'g1', email: 'teacher@school.test', name: 'Teacher', role: 'admin' },
    { id: 2, googleId: 'g2', email: '123456@students.school.test', name: 'Ana', role: 'user' },
    { id: 3, googleId: 'g3', email: '654321@students.school.test', name: 'Beto', role: 'user' },
    { id: 4, googleId: 'g4', email: '777777@students.school.test', name: 'Carla', role: 'user' },
    { id: 5, googleId: 'g5', email: 'twin@students.school.test', name: 'Twin A', role: 'user' },
    { id: 6, googleId: 'g6', email: 'twin@gmail.test', name: 'Twin B', role: 'user' },
  ]).run();
  await setPin(1, ANA_PIN); // an admin's row (from before a promotion) never signs in
  await setPin(2, ANA_PIN);
  await setPin(5, TWIN_PIN);
  await setPin(6, TWIN_PIN);
});
afterAll(async () => {
  server?.close();
  await client.close();
});
beforeEach(async () => {
  mode = 'on';
  health = new GoogleSignInHealth();
  limiter = new svc.IpFailureLimiter();
  signedIn = [];
  logInError = null;
  await setPin(4, CARLA_PIN);
});

const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/auth/pin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': SCHOOL_IP, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** The status and JSON of a response, checking it is never cached. */
async function answer(res: Response) {
  expect(res.headers.get('cache-control')).toBe('no-store');
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /auth/pin', () => {
  it('takes only JSON: 415 for a form, 413 over 2 KB, 400 for broken JSON', async () => {
    const form = await fetch(`${base}/auth/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': SCHOOL_IP },
      body: new URLSearchParams({ username: '123456', pin: ANA_PIN }).toString(),
    });
    expect(await answer(form)).toEqual({ status: 415, body: { ok: false, error: 'JSON_REQUIRED' } });
    expect(await answer(await post({ username: 'x'.repeat(3000), pin: ANA_PIN }))).toEqual({ status: 413, body: { ok: false, error: 'TOO_LARGE' } });
    expect(await answer(await post('{"username":'))).toEqual({ status: 400, body: { ok: false, error: 'BAD_REQUEST' } });
    expect(signedIn).toEqual([]);
  });

  it('refuses a sign-in posted from another site', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, { referer: 'https://evil.example/page' }, { origin: 'null' }]) {
      expect(await answer(await post({ username: '123456', pin: ANA_PIN }, headers))).toEqual({ status: 403, body: { ok: false, error: 'CROSS_ORIGIN' } });
    }
    expect(signedIn).toEqual([]);
  });

  it('accepts this site by hostname, whatever the port (the dev and e2e proxies), a forwarded host, and FRONTEND_URL', async () => {
    const ok = async (headers: Record<string, string>) => (await post({ username: '123456', pin: ANA_PIN }, headers)).status;
    expect(await ok({ origin: 'http://127.0.0.1:5173' })).toBe(200);
    expect(await ok({ origin: 'http://localhost:5173' })).toBe(200);
    expect(await ok({ referer: 'http://127.0.0.1:14173/login?returnTo=%2F' })).toBe(200);
    expect(await ok({ origin: 'https://learn.example.org', 'x-forwarded-host': 'learn.example.org' })).toBe(200);
    const saved = { frontend: process.env.FRONTEND_URL, env: process.env.NODE_ENV };
    try {
      process.env.FRONTEND_URL = 'https://learn.example.org';
      expect(await ok({ origin: 'https://learn.example.org' })).toBe(200);
      expect(await ok({ origin: 'https://dev.example.org' })).toBe(403);
      // In production a loopback Origin is not this site unless it is the Host.
      process.env.NODE_ENV = 'production';
      expect(await ok({ origin: 'http://localhost:5173' })).toBe(403);
      expect(await ok({ origin: 'http://127.0.0.1' })).toBe(200);
    } finally {
      if (saved.frontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = saved.frontend;
      process.env.NODE_ENV = saved.env;
    }
    expect(signedIn).toHaveLength(6);
  });

  it('is refused when PIN sign-in is off, and in auto while Google lets students in', async () => {
    mode = 'off';
    expect(await answer(await post({ username: '123456', pin: ANA_PIN }))).toEqual({ status: 403, body: { ok: false, error: 'PIN_DISABLED' } });
    mode = 'auto';
    expect(await answer(await post({ username: '123456', pin: ANA_PIN }))).toEqual({ status: 403, body: { ok: false, error: 'PIN_DISABLED' } });
    expect(signedIn).toEqual([]);
    // Google refused six students' browsers: auto takes PINs at once.
    for (let i = 0; i < 6; i++) health.noteCallback(`browser${i}`, 'admin_policy_enforced', true);
    expect((await answer(await post({ username: '123456', pin: ANA_PIN }))).status).toBe(200);
    expect(signedIn.map((u) => u.id)).toEqual([2]);
  });

  it('wants a PIN of exactly 4 digits', async () => {
    for (const pin of ['12a4', '592', '59271', 5927, null, undefined, ' 5927']) {
      expect(await answer(await post({ username: '123456', pin })), String(pin)).toEqual({ status: 400, body: { ok: false, error: 'BAD_REQUEST' } });
    }
    expect(await answer(await post({}))).toEqual({ status: 400, body: { ok: false, error: 'BAD_REQUEST' } });
    expect(signedIn).toEqual([]);
  });

  it('signs the student in and says where to go, keeping only a safe page to return to', async () => {
    expect(await answer(await post({ username: '123456', pin: ANA_PIN }))).toEqual({ status: 200, body: { ok: true, redirectTo: '/' } });
    expect(signedIn).toEqual([{ id: 2, googleId: 'g2', email: '123456@students.school.test', name: 'Ana', picture: null, role: 'user' }]);
    const redirect = async (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      (await answer(await post({ username: '123456@Students.School.test', pin: ANA_PIN, ...body }, headers))).body.redirectTo;
    expect(await redirect({ returnTo: '/signups?sheet=3' })).toBe('/signups?sheet=3');
    for (const returnTo of ['//evil.example', '/login', 'https://x', '/\\evil.example', '/auth/google', 42]) {
      expect(await redirect({ returnTo }), String(returnTo)).toBe('/');
    }
    // From the session, when the page sent none (an abandoned Google sign-in left it there).
    expect(await redirect({}, { 'x-test-session-return-to': '/labs' })).toBe('/labs');
    expect(await redirect({ returnTo: '/decks' }, { 'x-test-session-return-to': '/labs' })).toBe('/decks');
    expect(await redirect({}, { 'x-test-session-return-to': '//evil.example' })).toBe('/');
  });

  it('answers byte for byte the same for an unknown name, no PIN, a wrong PIN and an admin', async () => {
    const bodies: string[] = [];
    for (const [username, pin] of [['999999', ANA_PIN], ['654321', ANA_PIN], ['123456', WRONG], ['teacher@school.test', ANA_PIN], ['teacher', ANA_PIN]]) {
      const res = await post({ username, pin });
      expect(res.status, username).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      bodies.push(await res.text());
    }
    expect(new Set(bodies)).toEqual(new Set(['{"ok":false,"error":"INVALID"}']));
    expect(signedIn).toEqual([]);
  });

  it('asks for the full email when two accounts with a PIN share the name', async () => {
    expect(await answer(await post({ username: 'twin', pin: TWIN_PIN }))).toEqual({ status: 401, body: { ok: false, error: 'USE_FULL_EMAIL' } });
    expect((await post({ username: 'twin@gmail.test', pin: TWIN_PIN })).status).toBe(200);
    expect(signedIn.map((u) => u.id)).toEqual([6]);
  });

  it('locks the account after five wrong PINs and says for how long', async () => {
    for (let i = 0; i < 4; i++) expect((await post({ username: '777777', pin: WRONG })).status).toBe(401);
    const fifth = await post({ username: '777777', pin: WRONG });
    expect(fifth.headers.get('retry-after')).toBe('900');
    expect(await answer(fifth)).toEqual({ status: 429, body: { ok: false, error: 'LOCKED', retryAfterMinutes: 15 } });
    // The right PIN waits too.
    const right = await post({ username: '777777', pin: CARLA_PIN });
    expect(Number(right.headers.get('retry-after'))).toBeGreaterThan(890);
    expect(await answer(right)).toEqual({ status: 429, body: { ok: false, error: 'LOCKED', retryAfterMinutes: 15 } });
    expect(signedIn).toEqual([]);
    // Off does not reveal the lock.
    mode = 'off';
    expect((await answer(await post({ username: '777777', pin: CARLA_PIN }))).body).toEqual({ ok: false, error: 'PIN_DISABLED' });
    // The teacher unlocks it.
    mode = 'on';
    expect(svc.unlockPin(4)).toBe(true);
    expect((await post({ username: '777777', pin: CARLA_PIN })).status).toBe(200);
  });

  it('stops a network that gets too many PINs wrong, with no sign-in at all', async () => {
    limiter = new svc.IpFailureLimiter(3, 15 * 60_000);
    // Names nobody has check no PIN: they leave the school's budget alone.
    for (let i = 0; i < 10; i++) expect((await post({ username: `99999${i}`, pin: WRONG })).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await post({ username: '777777', pin: WRONG })).status).toBe(401);
    const limited = await post({ username: '123456', pin: ANA_PIN });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(890);
    expect(await answer(limited)).toEqual({ status: 429, body: { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: 15 } });
    // Another address is not.
    expect((await post({ username: '123456', pin: ANA_PIN }, { 'x-forwarded-for': '198.51.100.20' })).status).toBe(200);
    expect(signedIn.map((u) => u.id)).toEqual([2]);
  });

  it('answers 500 when the session cannot start', async () => {
    logInError = new Error('valkey is down');
    expect(await answer(await post({ username: '123456', pin: ANA_PIN }))).toEqual({ status: 500, body: { ok: false, error: 'SERVER_ERROR' } });
  });

  it('logs every attempt, and never a PIN (one typed in the username box neither) or a username', async () => {
    const calls: unknown[][] = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { calls.push(args); }) as never);
    }
    try {
      await post({ username: '123456', pin: ANA_PIN });
      await post({ username: '123456', pin: WRONG });
      await post({ username: '999999', pin: CARLA_PIN });
      await post({ username: 'twin', pin: TWIN_PIN });
      await post({ username: CARLA_PIN, pin: CARLA_PIN });
      for (let i = 0; i < 5; i++) await post({ username: '777777', pin: WRONG });
      await post({ username: '777777', pin: CARLA_PIN });
      await post({ username: '123456', pin: '12a4' });
      logInError = new Error('valkey is down');
      await post({ username: '123456', pin: ANA_PIN });
    } finally {
      vi.restoreAllMocks();
    }
    const serialized = calls.map((args) => JSON.stringify(args));
    for (const pin of [ANA_PIN, CARLA_PIN, TWIN_PIN, WRONG]) {
      for (const line of serialized) expect(line).not.toContain(pin);
    }
    // Only a keyed hash of the username: neither the student number nor the name typed is in any line.
    for (const typed of ['123456', '999999', 'twin', '777777']) {
      for (const line of serialized) expect(line).not.toContain(typed);
    }
    const events = calls.map(([fields]) => fields as { event?: string; reason?: string; stage?: string; username?: string; usernameHash?: string | null; usernameWasPin?: boolean });
    expect(events.map((e) => [e.event, e.reason ?? e.stage])).toEqual([
      ['pin_login.success', 'on'],
      ['pin_login.failed', 'wrong_pin'],
      ['pin_login.failed', 'unknown_user'],
      ['pin_login.failed', 'ambiguous'],
      ['pin_login.failed', 'unknown_user'],
      ['pin_login.failed', 'wrong_pin'],
      ['pin_login.failed', 'wrong_pin'],
      ['pin_login.failed', 'wrong_pin'],
      ['pin_login.failed', 'wrong_pin'],
      ['pin_login.locked', 'start'],
      ['pin_login.locked', 'refused'],
      ['pin_login.failed', 'bad_request'],
      ['pin_login.error', undefined],
    ]);
    expect(events[4]).toMatchObject({ usernameHash: null, usernameWasPin: true });
    expect(events.every((e) => !('username' in e))).toBe(true);
    // A line that names the account carries its ID and no hash (the hash would only repeat who it was).
    expect(events[0]).toMatchObject({ userId: 2, ip: SCHOOL_IP });
    expect(events[1]).toMatchObject({ userId: 2, failedCount: 1 });
    for (const i of [0, 1, 5, 6, 7, 8, 9, 10, 12]) {
      expect(events[i]).toHaveProperty('userId');
      expect(events[i]).not.toHaveProperty('usernameHash');
    }
    // Where no account matched, only the keyed hash of what was typed.
    expect(events[2]).toMatchObject({ reason: 'unknown_user', usernameHash: hashForLog('999999') });
    expect(events[2]).not.toHaveProperty('userId');
    expect(events[3].usernameHash).toBe(hashForLog('twin'));
  });
});
