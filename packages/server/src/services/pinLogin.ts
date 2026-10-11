// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Sign in with a PIN" (v1.22.0): for the days a school's Google Workspace policy refuses every student
 * account while staff still get through. Each student gets a random 4-digit PIN from the teacher, and signs
 * in with their student number (or school email) and that PIN.
 *
 * - PINs are 1000-9999 (a Google Sheet or a voice reading them aloud keeps every digit), never an easy one
 *   (1234, 2009, 1212...), drawn with crypto randomness. Stored only as a per-user salted scrypt hash; the
 *   plaintext exists only in the response of the admin procedure that made it.
 * - Students only (role 'user'): an admin account never signs in with a PIN.
 * - Five wrong PINs in a row lock that account's PIN sign-in for 15 minutes, doubling per further lock (at
 *   most 24 hours, and every lock after that is 24 hours too). Only a success, the teacher's Unlock or a
 *   new PIN starts the ladder again; a day with no wrong PIN forgets fewer than five. So a guesser gets
 *   about 40 tries per account in the first two days, then 5 a day.
 * - Each address may get 300 PINs wrong per 15 minutes (the whole school is one NAT address). Only
 *   PINs checked against a real student's PIN count: a name nobody has guesses nothing, and must not
 *   let one student use up the school's budget. A slot is taken before the hash, so attempts in flight
 *   at the same time cannot overshoot the cap.
 * - Unknown user, no PIN, wrong PIN and admin look the same from outside, and each computes one scrypt,
 *   so neither the answer nor its timing tells whether an account exists.
 * - The mode (app_settings.pin_login_mode): 'on' always, 'off' never, 'auto' only while Google sign-in
 *   looks blocked for students (services/googleSignInHealth.ts), plus 15 minutes after it clears.
 */
import { randomBytes, randomInt as cryptoRandomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { PIN_LOGIN_MODES, type PinLoginMode } from '../db/schema.js';
import { serializeUser, type AuthenticatedUser } from '../middleware/auth.js';
import { ensureAppSettings } from './appSettings.js';
import { normalizeUsername } from './username.js';
import { studentNumberFromEmail } from './studentNumbers.js';
import type { GoogleSignInStatus } from './googleSignInHealth.js';

type User = typeof schema.users.$inferSelect;
type UserPin = typeof schema.userPins.$inferSelect;

/** What the server accepts (a stored PIN never starts with 0, but one that did would still work). */
export const PIN_PATTERN = /^\d{4}$/;
export const MAX_FAILED_PINS = 5;
export const BASE_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 60 * 60_000;
/** No wrong PIN for 24 h: failed_count starts again from 0 (lock_level does not: see attemptPinSignIn). */
export const FAILURE_DECAY_MS = 24 * 60 * 60_000;
/** Failed PINs per IP per window (a whole school is one NAT address). */
export const IP_FAILURE_LIMIT = 300;
export const IP_FAILURE_WINDOW_MS = 15 * 60_000;
/** 'auto': PINs are still accepted this long after the Google signal clears (a classmate halfway through the form). */
export const AUTO_GRACE_MS = 15 * 60_000;
const MAX_LOCK_LEVEL = 10;
const IP_LIMITER_MAX_ENTRIES = 10_000;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
/** For the dummy hash only (timing parity); never a real PIN's salt. */
const DUMMY_SALT = randomBytes(16).toString('hex');

// ---------------------------------------------------------------------------
// PINs

/** The PINs nobody is given: repeats, runs, patterns, years, keypad lines and a few famous ones. */
const EXTRA_EASY_PINS = [
  '2580', '0852', '1470', '0741', '3690', '0963', '1478', '8741', '3698', '8963', '7410', '0147', '9630', '0369',
  '1357', '7531', '2468', '8642', '1379', '9731', '1397', '7931', '1004', '5683', '1590', '0951', '1337', '8008',
  '5150', '3141', '4200', '0420',
];

function buildEasyPins(): ReadonlySet<string> {
  const easy = new Set<string>();
  const digits = '0123456789';
  for (const a of digits) {
    // AAAA
    easy.add(a.repeat(4));
    for (const b of digits) {
      // ABAB, AABB, ABBA, AAAB, BAAA (A and B any digits)
      easy.add(`${a}${b}${a}${b}`);
      easy.add(`${a}${a}${b}${b}`);
      easy.add(`${a}${b}${b}${a}`);
      easy.add(`${a}${a}${a}${b}`);
      easy.add(`${b}${a}${a}${a}`);
    }
  }
  // Runs of 4 with step +1 or -1, wrapping: 0123 ... 7890, 8901, 9012 and 3210 ... 0987, 1098, 2109.
  for (let start = 0; start < 10; start++) {
    let up = '';
    let down = '';
    for (let i = 0; i < 4; i++) {
      up += String((start + i) % 10);
      down += String((start - i + 10) % 10);
    }
    easy.add(up);
    easy.add(down);
  }
  for (let year = 1950; year <= 2030; year++) easy.add(String(year));
  for (const pin of EXTRA_EASY_PINS) easy.add(pin);
  return easy;
}

const EASY_PINS = buildEasyPins();

export function easyPins(): ReadonlySet<string> {
  return EASY_PINS;
}

export function isEasyPin(pin: string): boolean {
  return EASY_PINS.has(pin);
}

/** A random 4-digit PIN from 1000-9999 that is not easy. */
export function generatePin(randomInt: (min: number, max: number) => number = cryptoRandomInt): string {
  for (;;) {
    const pin = String(randomInt(1000, 10000));
    if (/^[1-9]\d{3}$/.test(pin) && !isEasyPin(pin)) return pin;
  }
}

function scryptHex(pin: string, salt: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    scrypt(pin, salt, KEY_LENGTH, SCRYPT, (err, key) => (err ? rejectHash(err) : resolveHash(key.toString('hex'))));
  });
}

/** A new salt and the PIN's hash (async: a class signing in at the bell must not block the event loop). */
export async function newPinHash(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  return { hash: await scryptHex(pin, salt), salt };
}

export async function pinMatches(pin: string, hash: string, salt: string): Promise<boolean> {
  const actual = Buffer.from(await scryptHex(pin, salt), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** One scrypt that checks nothing, so a refusal takes as long as a real check. */
export async function dummyPinCheck(pin: string): Promise<void> {
  await scryptHex(pin, DUMMY_SALT);
}

/** 15m, 30m, 1h, 2h, 4h, 8h, 16h, then 24h from level 7 on. */
export function lockDurationMs(level: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(0, level), MAX_LOCK_MS);
}

// ---------------------------------------------------------------------------
// The mode

const APP_SETTINGS_ROW_ID = 1;

export function isPinLoginMode(value: unknown): value is PinLoginMode {
  return typeof value === 'string' && (PIN_LOGIN_MODES as readonly string[]).includes(value);
}

/** The saved mode; 'auto' with no settings row or a value it does not know. */
export function getPinLoginMode(): PinLoginMode {
  const row = db.select({ mode: schema.appSettings.pinLoginMode }).from(schema.appSettings)
    .where(eq(schema.appSettings.id, APP_SETTINGS_ROW_ID)).get();
  return isPinLoginMode(row?.mode) ? row.mode : 'auto';
}

export async function setPinLoginMode(mode: PinLoginMode): Promise<PinLoginMode> {
  // Seeds the row from the environment exactly as the settings page does when there is none yet.
  await ensureAppSettings();
  db.update(schema.appSettings).set({ pinLoginMode: mode, updatedAt: new Date() })
    .where(eq(schema.appSettings.id, APP_SETTINGS_ROW_ID)).run();
  return mode;
}

export type PinLoginAvailability = { pin: boolean; reason: 'on' | 'auto' | null; acceptsPins: boolean };

/** What the login page shows (pin, reason) and whether POST /auth/pin takes a PIN now (acceptsPins). */
export function pinLoginAvailability(mode: PinLoginMode, status: GoogleSignInStatus, now: number): PinLoginAvailability {
  if (mode === 'on') return { pin: true, reason: 'on', acceptsPins: true };
  if (mode === 'off') return { pin: false, reason: null, acceptsPins: false };
  const graced = status.clearedAt !== null && now - status.clearedAt <= AUTO_GRACE_MS;
  return {
    pin: status.looksBlocked,
    reason: status.looksBlocked ? 'auto' : null,
    acceptsPins: status.looksBlocked || graced,
  };
}

// ---------------------------------------------------------------------------
// Who a username names

export type PinCandidate =
  | { kind: 'user'; user: User; pin: UserPin }
  | { kind: 'none'; why: 'unknown_user' | 'no_pin' | 'admin' }
  | { kind: 'ambiguous' };

const MAX_MATCHES = 10;

/**
 * "123456", "123456@school.example" or a teacher-set student number (any case, spaces trimmed) → the one student
 * with a PIN it names. A number several accounts share names the only one of them that has a PIN.
 */
export function findPinCandidate(username: unknown): PinCandidate {
  const wanted = normalizeUsername(username);
  if (!wanted) return { kind: 'none', why: 'unknown_user' };
  const U = schema.users;
  const P = schema.userPins;
  const O = schema.studentNumberOverrides;

  let rows: { user: User; pin: UserPin | null }[];
  if ('email' in wanted) {
    rows = db.select({ user: U, pin: P }).from(U).leftJoin(P, eq(P.userId, U.id))
      .where(eq(sql`lower(${U.email})`, wanted.email)).limit(MAX_MATCHES).all();
  } else {
    const pattern = `${wanted.localPart.replace(/[%_\\]/g, '\\$&')}@%`;
    const byEmail = db.select({ user: U, pin: P }).from(U).leftJoin(P, eq(P.userId, U.id))
      .where(sql`lower(${U.email}) like ${pattern} escape '\\'`).limit(MAX_MATCHES).all();
    const byOverride = db.select({ user: U, pin: P }).from(U)
      .innerJoin(O, eq(O.userId, U.id))
      .leftJoin(P, eq(P.userId, U.id))
      .where(eq(sql`lower(${O.studentNumber})`, wanted.localPart)).limit(MAX_MATCHES).all();
    const seen = new Set<number>();
    rows = [];
    for (const row of [...byEmail, ...byOverride]) {
      if (seen.has(row.user.id) || rows.length >= MAX_MATCHES) continue;
      seen.add(row.user.id);
      rows.push(row);
    }
  }

  if (rows.length === 0) return { kind: 'none', why: 'unknown_user' };
  const kept = rows.filter((row): row is { user: User; pin: UserPin } => row.user.role === 'user' && row.pin !== null);
  if (kept.length === 1) return { kind: 'user', user: kept[0].user, pin: kept[0].pin };
  if (kept.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none', why: rows.every((row) => row.user.role === 'admin') ? 'admin' : 'no_pin' };
}

// ---------------------------------------------------------------------------
// The per-address cap

/** A slot noteFailure took; refund() gives it back. */
export type IpFailureSlot = { ip: string; resetAt: number };

/**
 * Failed PINs per client address in a fixed window from its first failure. In memory: a restart clears it
 * (the per-account locks are in the database and survive). attemptPinSignIn takes a slot (noteFailure) in
 * the same synchronous step as check(), before the hash, and gives it back when the PIN was right.
 */
export class IpFailureLimiter {
  private entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = IP_FAILURE_LIMIT,
    private readonly windowMs = IP_FAILURE_WINDOW_MS,
  ) {}

  check(ip: string, now = Date.now()): { limited: boolean; retryAfterMs: number } {
    const entry = this.entries.get(ip);
    if (!entry || entry.resetAt <= now) return { limited: false, retryAfterMs: 0 };
    return entry.count >= this.limit
      ? { limited: true, retryAfterMs: entry.resetAt - now }
      : { limited: false, retryAfterMs: 0 };
  }

  noteFailure(ip: string, now = Date.now()): IpFailureSlot {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    const entry = this.entries.get(ip);
    if (entry) {
      entry.count += 1;
      return { ip, resetAt: entry.resetAt };
    }
    // Insertion order is the order of the first failure: the first entries are the oldest.
    while (this.entries.size >= IP_LIMITER_MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    const resetAt = now + this.windowMs;
    this.entries.set(ip, { count: 1, resetAt });
    return { ip, resetAt };
  }

  /** Gives a slot back; not to a window that started after it (that window owes it nothing). */
  refund(slot: IpFailureSlot): void {
    const entry = this.entries.get(slot.ip);
    if (entry && entry.resetAt === slot.resetAt && entry.count > 0) entry.count -= 1;
  }

  reset(): void {
    this.entries.clear();
  }
}

/** The client address as the limiter and the logs key it. */
export function clientIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}

// ---------------------------------------------------------------------------
// One sign-in attempt

export type PinAttempt =
  | { kind: 'success'; user: AuthenticatedUser }
  | { kind: 'invalid'; reason: 'unknown_user' | 'no_pin' | 'admin' | 'wrong_pin' | 'pin_changed'; userId?: number; failedCount?: number }
  | { kind: 'ambiguous' }
  | { kind: 'locked'; userId: number; retryAfterMs: number; started: boolean; lockLevel: number }
  | { kind: 'ip_limited'; retryAfterMs: number };

const ms = (date: Date | null | undefined) => (date ? date.getTime() : null);

/**
 * Checks one PIN (the router has already checked its format and the mode). Every path but ip_limited
 * computes exactly one scrypt. Counters change only inside one synchronous transaction, so concurrent
 * attempts never lose a count and five failures lock exactly once.
 *
 * The address's cap counts only PINs checked against a student's PIN (wrong, or replaced meanwhile, and
 * the fifth that locks): its slot is taken in the same synchronous step as the check, before the hash, and
 * given back on a success or when another attempt locked the account meanwhile. A name nobody has, a
 * student with no PIN, an admin, a shared number and a locked account check no PIN and count nothing
 * (the /auth rate limit, 600 per 15 minutes, still bounds them).
 */
export async function attemptPinSignIn(input: {
  username: unknown;
  pin: string;
  ip: string;
  now?: number;
  limiter: IpFailureLimiter;
  verify?: typeof pinMatches;
  dummy?: typeof dummyPinCheck;
}): Promise<PinAttempt> {
  const now = input.now ?? Date.now();
  const verify = input.verify ?? pinMatches;
  const dummy = input.dummy ?? dummyPinCheck;
  const { limiter, ip, pin } = input;

  const ipCheck = limiter.check(ip, now);
  if (ipCheck.limited) return { kind: 'ip_limited', retryAfterMs: ipCheck.retryAfterMs };

  const candidate = findPinCandidate(input.username);
  if (candidate.kind === 'none') {
    await dummy(pin);
    return { kind: 'invalid', reason: candidate.why };
  }
  if (candidate.kind === 'ambiguous') {
    await dummy(pin);
    return { kind: 'ambiguous' };
  }

  const { user, pin: row } = candidate;
  const lockedUntil = ms(row.lockedUntil);
  if (lockedUntil !== null && lockedUntil > now) {
    await dummy(pin);
    return { kind: 'locked', userId: user.id, retryAfterMs: lockedUntil - now, started: false, lockLevel: row.lockLevel };
  }

  // Still the same synchronous step as limiter.check(): attempts in flight together cannot pass the cap.
  const slot = limiter.noteFailure(ip, now);
  const matches = await verify(pin, row.pinHash, row.pinSalt);

  const P = schema.userPins;
  const result = db.transaction((tx): PinAttempt => {
    const current = tx.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    if (!current) return { kind: 'invalid', reason: 'unknown_user', userId: user.id };
    if (current.role !== 'user') return { kind: 'invalid', reason: 'admin', userId: user.id };
    const pinRow = tx.select().from(P).where(eq(P.userId, user.id)).get();
    if (!pinRow || pinRow.pinHash !== row.pinHash) return { kind: 'invalid', reason: 'pin_changed', userId: user.id };
    const currentLock = ms(pinRow.lockedUntil);
    if (currentLock !== null && currentLock > now) {
      return { kind: 'locked', userId: user.id, retryAfterMs: currentLock - now, started: false, lockLevel: pinRow.lockLevel };
    }

    const at = new Date(now);
    if (matches) {
      tx.update(P).set({ failedCount: 0, lockLevel: 0, lockedUntil: null, lastUsedAt: at, updatedAt: at })
        .where(eq(P.userId, user.id)).run();
      return { kind: 'success', user: serializeUser(current) };
    }

    // A day with no wrong PIN forgets a few typos. Never the lock level: a 24-hour lock is itself 24
    // quiet hours, so letting time lower it would restart the ladder at 15 minutes after every one.
    const quiet = now - pinRow.updatedAt.getTime() > FAILURE_DECAY_MS;
    const level = pinRow.lockLevel;
    const failed = (quiet ? 0 : pinRow.failedCount) + 1;
    if (failed >= MAX_FAILED_PINS) {
      const retryAfterMs = lockDurationMs(level);
      const nextLevel = Math.min(level + 1, MAX_LOCK_LEVEL);
      tx.update(P).set({ failedCount: 0, lockLevel: nextLevel, lockedUntil: new Date(now + retryAfterMs), updatedAt: at })
        .where(eq(P.userId, user.id)).run();
      return { kind: 'locked', userId: user.id, retryAfterMs, started: true, lockLevel: nextLevel };
    }
    tx.update(P).set({ failedCount: failed, lockLevel: level, updatedAt: at }).where(eq(P.userId, user.id)).run();
    return { kind: 'invalid', reason: 'wrong_pin', userId: user.id, failedCount: failed };
  });

  if (result.kind === 'success' || (result.kind === 'locked' && !result.started)) limiter.refund(slot);
  return result;
}

// ---------------------------------------------------------------------------
// The teacher's side

export type PinStatus = {
  userId: number;
  /** role === 'user': only students get a PIN. */
  eligible: boolean;
  hasPin: boolean;
  createdAt: number | null;
  lastUsedAt: number | null;
  /** Only while the lock lasts. */
  lockedUntil: number | null;
  failedCount: number;
};

export function pinStatusFor(userId: number, now = Date.now()): PinStatus | null {
  const row = db.select({ id: schema.users.id, role: schema.users.role, pin: schema.userPins })
    .from(schema.users)
    .leftJoin(schema.userPins, eq(schema.userPins.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .get();
  if (!row) return null;
  const lockedUntil = ms(row.pin?.lockedUntil);
  return {
    userId: row.id,
    eligible: row.role === 'user',
    hasPin: row.pin !== null,
    createdAt: ms(row.pin?.createdAt),
    lastUsedAt: ms(row.pin?.lastUsedAt),
    lockedUntil: lockedUntil !== null && lockedUntil > now ? lockedUntil : null,
    failedCount: row.pin?.failedCount ?? 0,
  };
}

export type NewPin = { userId: number; name: string; email: string; studentNumber: string | null; pin: string };

/** The columns a new PIN writes, on insert and on replace alike. */
function freshPinValues(hash: { hash: string; salt: string }, at: Date) {
  return {
    pinHash: hash.hash,
    pinSalt: hash.salt,
    createdAt: at,
    updatedAt: at,
    failedCount: 0,
    lockedUntil: null,
    lockLevel: 0,
    lastUsedAt: null,
  };
}

/**
 * A new PIN for one student (replacing theirs, which also clears a lock). Throws 'not_found' or
 * 'not_student'. `replaced` is for the log only.
 */
export async function createPinForUser(userId: number, now = Date.now()): Promise<NewPin & { replaced: boolean }> {
  const before = db.select({ user: schema.users, override: schema.studentNumberOverrides.studentNumber })
    .from(schema.users)
    .leftJoin(schema.studentNumberOverrides, eq(schema.studentNumberOverrides.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .get();
  if (!before) throw new Error('not_found');
  if (before.user.role !== 'user') throw new Error('not_student');

  const pin = generatePin();
  const hash = await newPinHash(pin);
  const at = new Date(now);
  const replaced = db.transaction((tx) => {
    const current = tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!current) throw new Error('not_found');
    if (current.role !== 'user') throw new Error('not_student');
    const had = tx.select({ userId: schema.userPins.userId }).from(schema.userPins).where(eq(schema.userPins.userId, userId)).get();
    const values = freshPinValues(hash, at);
    tx.insert(schema.userPins).values({ userId, ...values })
      .onConflictDoUpdate({ target: schema.userPins.userId, set: values })
      .run();
    return had !== undefined;
  });

  return {
    userId,
    name: before.user.name,
    email: before.user.email,
    studentNumber: before.override ?? studentNumberFromEmail(before.user.email),
    pin,
    replaced,
  };
}

export function removePin(userId: number): boolean {
  return db.delete(schema.userPins).where(eq(schema.userPins.userId, userId)).run().changes > 0;
}

export function unlockPin(userId: number, now = Date.now()): boolean {
  return db.update(schema.userPins)
    .set({ failedCount: 0, lockLevel: 0, lockedUntil: null, updatedAt: new Date(now) })
    .where(eq(schema.userPins.userId, userId))
    .run().changes > 0;
}

function groupExists(groupId: number): boolean {
  return db.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.id, groupId)).get() !== undefined;
}

/** How many of a group's students (role 'user') have a PIN. Null for a missing group. */
export function groupPinCounts(groupId: number): { students: number; withPin: number } | null {
  if (!groupExists(groupId)) return null;
  const row = db.select({
    students: sql<number>`count(*)`,
    withPin: sql<number>`count(${schema.userPins.userId})`,
  })
    .from(schema.userGroups)
    .innerJoin(schema.users, eq(schema.users.id, schema.userGroups.userId))
    .leftJoin(schema.userPins, eq(schema.userPins.userId, schema.users.id))
    .where(and(eq(schema.userGroups.groupId, groupId), eq(schema.users.role, 'user')))
    .get();
  return { students: Number(row?.students ?? 0), withPin: Number(row?.withPin ?? 0) };
}

export type GroupPins = {
  pins: NewPin[];
  skippedHavePin: number;
  skippedNotStudent: number;
  /** For the log only: students whose old PIN this replaced. */
  replaced: number;
};

/**
 * PINs for every student of a group: with onlyMissing, only those who have none. Admins are skipped and
 * counted. Null for a missing group. The PINs are in this result only, sorted by name.
 */
export async function createPinsForGroup(groupId: number, onlyMissing: boolean, now = Date.now()): Promise<GroupPins | null> {
  if (!groupExists(groupId)) return null;
  const members = db.select({
    userId: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    role: schema.users.role,
    hasPin: schema.userPins.userId,
    override: schema.studentNumberOverrides.studentNumber,
  })
    .from(schema.userGroups)
    .innerJoin(schema.users, eq(schema.users.id, schema.userGroups.userId))
    .leftJoin(schema.userPins, eq(schema.userPins.userId, schema.users.id))
    .leftJoin(schema.studentNumberOverrides, eq(schema.studentNumberOverrides.userId, schema.users.id))
    .where(eq(schema.userGroups.groupId, groupId))
    .all();

  let skippedNotStudent = 0;
  let skippedHavePin = 0;
  const targets: (typeof members[number])[] = [];
  for (const member of members) {
    if (member.role !== 'user') skippedNotStudent += 1;
    else if (onlyMissing && member.hasPin !== null) skippedHavePin += 1;
    else targets.push(member);
  }

  const made = targets.map((member) => ({ member, pin: generatePin() }));
  const hashes = await Promise.all(made.map(({ pin }) => newPinHash(pin)));
  const at = new Date(now);

  const written = db.transaction((tx) => {
    const ids = made.map(({ member }) => member.userId);
    const roles = new Map(ids.length === 0 ? [] : tx.select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users).where(inArray(schema.users.id, ids)).all().map((u) => [u.id, u.role] as const));
    const had = new Set(ids.length === 0 ? [] : tx.select({ userId: schema.userPins.userId })
      .from(schema.userPins).where(inArray(schema.userPins.userId, ids)).all().map((p) => p.userId));
    const kept: NewPin[] = [];
    let replaced = 0;
    let notStudent = 0;
    let havePin = 0;
    made.forEach(({ member, pin }, i) => {
      // Changed since the read above: promoted to admin or deleted, or given a PIN meanwhile.
      if (roles.get(member.userId) !== 'user') { notStudent += 1; return; }
      if (onlyMissing && had.has(member.userId)) { havePin += 1; return; }
      const values = freshPinValues(hashes[i], at);
      tx.insert(schema.userPins).values({ userId: member.userId, ...values })
        .onConflictDoUpdate({ target: schema.userPins.userId, set: values })
        .run();
      if (had.has(member.userId)) replaced += 1;
      kept.push({
        userId: member.userId,
        name: member.name,
        email: member.email,
        studentNumber: member.override ?? studentNumberFromEmail(member.email),
        pin,
      });
    });
    return { kept, replaced, notStudent, havePin };
  });

  const pins = written.kept.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.userId - b.userId);
  return {
    pins,
    skippedHavePin: skippedHavePin + written.havePin,
    skippedNotStudent: skippedNotStudent + written.notStudent,
    replaced: written.replaced,
  };
}
