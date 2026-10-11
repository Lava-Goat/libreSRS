// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Is Google sign-in blocked for students right now? (v1.22.0, for "Sign in with a PIN" in 'auto'.)
 *
 * A school's Google Workspace policy can refuse every student account ("Access blocked - Error 400:
 * admin_policy_enforced"). Google shows its own error page and never sends the browser back, so all
 * libreSRS sees is /auth/google starts with no /auth/google/callback returns. Staff accounts may still get
 * through, so a teacher's sign-in proves nothing about students.
 *
 * Every signal here is a request anyone can make without signing in, and in 'auto' a trip opens PIN
 * sign-in (and so PIN guessing) for every student. So:
 * - Only browsers on the school's network count (PIN_AUTO_SCHOOL_IPS; loopback too outside production,
 *   for dev and e2e). From anywhere else nobody can switch the chip on, nor keep it on: an outage that
 *   matters is one a class at school runs into. A student's Google sign-in from
 *   anywhere still clears it. At home during an outage the teacher picks "On".
 * - Looks blocked when at least 6 different browsers (session ids; the whole school shares one IP and
 *   one Chromebook user agent) have a Google start that is 2-15 minutes old and never came back, and no
 *   student signed in with Google in the last 15 minutes. One student retrying stays one browser.
 * - A browser Google sends back with error=admin_policy_enforced (the school's policy) or access_denied
 *   (a student pressed Cancel) and that browser's own OAuth state counts at once, without the 2-minute
 *   grace, but only as that one browser: its own state is in the Google URL it was sent to, so one
 *   student can send it back by hand. Six such browsers trip it at once ('google_error' when any of them
 *   was the policy); six policy refusals do even within 15 minutes of a student's success. A callback
 *   with no state this browser holds counts nothing.
 * - Cleared when a student's Google sign-in succeeds (which also forgets the refusals before it), or
 *   after 60 minutes with no Google start from the school (a class that switched to PINs starts none,
 *   and the chip must not vanish mid-period).
 *
 * All of it is in memory: a restart forgets it.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { logger } from '../logger.js';

export interface GoogleSignInHealthOptions {
  /** How far back unanswered starts and student successes count (15 minutes). */
  windowMs?: number;
  /** How old an unanswered start must be before it counts (2 minutes: a normal round trip takes 5-60 s). */
  graceMs?: number;
  /** How many different browsers must be stuck (6: about a fifth of a 30-student class). */
  minBrowsers?: number;
  /** No Google start for this long clears the signal (60 minutes: longer than a 55-minute period). */
  idleClearMs?: number;
  /** At most this many browsers are remembered; the oldest go first. */
  maxTracked?: number;
  now?: () => number;
}

export interface GoogleSignInStatus {
  looksBlocked: boolean;
  since: number | null;
  reason: 'no_returns' | 'google_error' | null;
  /** Browsers whose unanswered start counts (2-15 minutes old, or refused). */
  unansweredBrowsers: number;
  lastStudentSignInAt: number | null;
  /** When the last block cleared (null before any did, or after a restart). */
  clearedAt: number | null;
  /** When this server process started watching. */
  watchingSince: number;
}

/** refused: Google sent it back with that error and its own state (counts at once, no grace). */
type Browser = { firstAt: number; lastAt: number; refused: false | 'admin_policy_enforced' | 'access_denied' };
type Block = { since: number; reason: 'no_returns' | 'google_error' };

export const GOOGLE_HEALTH_DEFAULTS = {
  windowMs: 15 * 60_000,
  graceMs: 2 * 60_000,
  minBrowsers: 6,
  idleClearMs: 60 * 60_000,
  maxTracked: 5000,
} as const;

export class GoogleSignInHealth {
  private readonly windowMs: number;
  private readonly graceMs: number;
  private readonly minBrowsers: number;
  private readonly idleClearMs: number;
  private readonly maxTracked: number;
  private readonly clock: () => number;
  /** Unanswered starts only, kept in order of their last start (oldest first). */
  private browsers = new Map<string, Browser>();
  private lastStartAt: number | null = null;
  private lastStudentSignInAt: number | null = null;
  private blocked: Block | null = null;
  private clearedAt: number | null = null;
  private watchingSince: number;

  constructor(options: GoogleSignInHealthOptions = {}) {
    this.windowMs = options.windowMs ?? GOOGLE_HEALTH_DEFAULTS.windowMs;
    this.graceMs = options.graceMs ?? GOOGLE_HEALTH_DEFAULTS.graceMs;
    this.minBrowsers = options.minBrowsers ?? GOOGLE_HEALTH_DEFAULTS.minBrowsers;
    this.idleClearMs = options.idleClearMs ?? GOOGLE_HEALTH_DEFAULTS.idleClearMs;
    this.maxTracked = options.maxTracked ?? GOOGLE_HEALTH_DEFAULTS.maxTracked;
    this.clock = options.now ?? Date.now;
    this.watchingSince = this.clock();
  }

  /** A browser was sent to Google (GET /auth/google). */
  noteStart(key: string | null, now = this.clock()): void {
    if (!key) return;
    this.lastStartAt = now;
    const existing = this.browsers.get(key);
    // Re-inserted, so the map stays in order of the last start; a retry keeps its first start and still ages.
    this.browsers.delete(key);
    this.browsers.set(key, existing ? { ...existing, lastAt: now } : { firstAt: now, lastAt: now, refused: false });
    this.evaluate(now);
  }

  /** Google sent a browser back to /auth/google/callback, with or without an error. */
  noteCallback(key: string | null, error: unknown, stateMatches: boolean, now = this.clock()): void {
    if (!key) return;
    if (typeof error === 'string' && error) {
      // A callback link from another browser (or another site) has no state this browser holds: ignored.
      if (!stateMatches) return;
      if (error === 'admin_policy_enforced' || error === 'access_denied') {
        // This browser counts at once, still under the 6-browser rule: its own state is no proof of an
        // outage (it is in the Google URL the browser was sent to, so a student can send it back by hand).
        const existing = this.browsers.get(key);
        if (existing) existing.refused = error;
        else this.browsers.set(key, { firstAt: now, lastAt: now, refused: error });
      } else {
        this.browsers.delete(key);
      }
    } else {
      // Google answered; whatever libreSRS then decides is not Google refusing.
      this.browsers.delete(key);
    }
    this.evaluate(now);
  }

  /** A Google sign-in finished: a student's proves Google lets students in; a teacher's proves nothing. */
  noteSignedIn(key: string | null, role: 'admin' | 'user', now = this.clock()): void {
    if (key) this.browsers.delete(key);
    if (role === 'user') {
      this.lastStudentSignInAt = now;
      // Refusals before it are over: they must not trip it again at once.
      for (const [other, browser] of this.browsers) {
        if (browser.refused !== false) this.browsers.delete(other);
      }
      if (this.blocked) this.clear(now, 'student_success');
    }
    this.evaluate(now);
  }

  status(now = this.clock()): GoogleSignInStatus {
    const counted = this.evaluate(now);
    return {
      looksBlocked: this.blocked !== null,
      since: this.blocked?.since ?? null,
      reason: this.blocked?.reason ?? null,
      unansweredBrowsers: counted.length,
      lastStudentSignInAt: this.lastStudentSignInAt,
      clearedAt: this.clearedAt,
      watchingSince: this.watchingSince,
    };
  }

  /** Forgets everything, as a restart does. */
  reset(): void {
    this.browsers.clear();
    this.lastStartAt = null;
    this.lastStudentSignInAt = null;
    this.blocked = null;
    this.clearedAt = null;
    this.watchingSince = this.clock();
  }

  /** Prunes, clears an idle block, trips a new one; returns the browsers that count. */
  private evaluate(now: number): Browser[] {
    const cutoff = now - this.windowMs;
    for (const [key, browser] of this.browsers) {
      if (browser.lastAt < cutoff) this.browsers.delete(key);
    }
    // The map is in order of the last start: the first entries are the oldest.
    while (this.browsers.size > this.maxTracked) {
      const oldest = this.browsers.keys().next().value as string;
      this.browsers.delete(oldest);
    }

    if (this.blocked) {
      const idleFrom = Math.max(this.lastStartAt ?? this.blocked.since, this.blocked.since);
      if (now - idleFrom >= this.idleClearMs) this.clear(idleFrom + this.idleClearMs, 'idle');
    }

    const counted = [...this.browsers.values()].filter((b) => b.refused !== false || now - b.firstAt >= this.graceMs);
    const refusedByPolicy = counted.filter((b) => b.refused === 'admin_policy_enforced').length;
    // A student's success in the last 15 minutes holds off starts that merely did not come back, not six
    // browsers Google refused by policy since then (a success drops the refusals before it).
    const heldOff = this.lastStudentSignInAt !== null && now - this.lastStudentSignInAt <= this.windowMs;
    if (!this.blocked
      && counted.length >= this.minBrowsers
      && (!heldOff || refusedByPolicy >= this.minBrowsers)) {
      const reason = refusedByPolicy > 0 ? 'google_error' : 'no_returns';
      this.trip({ since: Math.min(...counted.map((b) => b.firstAt)), reason }, counted.length);
    }
    return counted;
  }

  private trip(block: Block, browsers: number): void {
    this.blocked = block;
    logger.warn({
      event: 'google_signin_health.blocked',
      reason: block.reason,
      since: new Date(block.since).toISOString(),
      browsers,
    }, 'Google sign-in looks blocked for students');
  }

  private clear(at: number, reason: 'student_success' | 'idle'): void {
    const since = this.blocked?.since ?? null;
    this.blocked = null;
    this.clearedAt = at;
    logger.info({
      event: 'google_signin_health.cleared',
      reason,
      since: since === null ? null : new Date(since).toISOString(),
    }, 'Google sign-in no longer looks blocked for students');
  }
}

/** The server's one watcher (index.ts notes the Google starts and returns; the PIN routes read it). */
export const googleSignInHealth = new GoogleSignInHealth();

/**
 * The built-in school addresses: none. Set the school's public (NAT) addresses in PIN_AUTO_SCHOOL_IPS;
 * until then only loopback outside production counts, and Auto mode never switches on in production.
 */
export const SCHOOL_NETWORK_IPS: readonly string[] = [];

const LOOPBACK = new Set(['127.0.0.1', '::1']);

const normalizeIp = (ip: string) => ip.trim().replace(/^::ffff:/, '');

/** PIN_AUTO_SCHOOL_IPS (comma-separated) when set, else SCHOOL_NETWORK_IPS (none). Read every time. */
export function schoolNetworkIps(): string[] {
  const configured = (process.env.PIN_AUTO_SCHOOL_IPS ?? '').split(',').map(normalizeIp).filter(Boolean);
  return configured.length > 0 ? configured : [...SCHOOL_NETWORK_IPS];
}

/**
 * Can Auto mode see any browser as on the school's network? In production only with PIN_AUTO_SCHOOL_IPS
 * set; outside production loopback always counts (dev, e2e). The admin PIN panel shows a hint when not.
 */
export function autoNetworkConfigured(): boolean {
  return process.env.NODE_ENV !== 'production' || schoolNetworkIps().length > 0;
}

/** At boot (index.ts): one warning in production when no school network is set, so Auto can never switch on. */
export function warnIfNoSchoolNetwork(log: Pick<typeof logger, 'warn'> = logger): boolean {
  if (autoNetworkConfigured()) return false;
  log.warn(
    { event: 'pin_login.no_school_network' },
    'PIN_AUTO_SCHOOL_IPS is not set: PIN sign-in Auto mode cannot switch on until it lists the school network addresses',
  );
  return true;
}

/** A client address (req.ip) on the school's network; loopback counts too outside production (dev, e2e). */
export function fromSchoolNetwork(ip: string | undefined): boolean {
  const address = normalizeIp(ip ?? '');
  if (!address) return false;
  if (process.env.NODE_ENV !== 'production' && LOOPBACK.has(address)) return true;
  return schoolNetworkIps().includes(address);
}

/**
 * The browser a Google start or return counts as: sha256(req.sessionID) as 32 hex characters, or null
 * when it does not count (no session id, or not from the school's network). Never logged.
 */
export function googleSignInHealthKey(req: Request): string | null {
  const id = req.sessionID;
  if (typeof id !== 'string' || !id) return null;
  if (!fromSchoolNetwork(req.ip)) return null;
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}

/** The callback's ?state= is the OAuth state this browser's session holds (any `oauth2:*` session key). */
export function callbackStateMatches(req: Request): boolean {
  const state = req.query?.state;
  if (typeof state !== 'string' || !state) return false;
  const session = req.session as unknown as Record<string, unknown> | undefined;
  if (!session) return false;
  for (const [key, value] of Object.entries(session)) {
    if (!key.startsWith('oauth2:') || typeof value !== 'object' || value === null) continue;
    if ((value as { state?: unknown }).state === state) return true;
  }
  return false;
}
