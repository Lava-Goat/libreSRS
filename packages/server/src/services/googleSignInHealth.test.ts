// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { logger } from '../logger.js';
import {
  GoogleSignInHealth, autoNetworkConfigured, callbackStateMatches, fromSchoolNetwork, googleSignInHealthKey, schoolNetworkIps,
  warnIfNoSchoolNetwork,
} from './googleSignInHealth.js';

/** 2026-03-02 at hh:mm:ss, in ms. */
const at = (hh: number, mm: number, ss = 0) => Date.UTC(2026, 2, 2, hh, mm, ss);

/** A watcher whose clock starts at `start` (status() without a time reads it). */
function watcher(start = at(7, 30)) {
  let clock = start;
  const health = new GoogleSignInHealth({ now: () => clock });
  return { health, setClock: (t: number) => { clock = t; } };
}

/** Starts `count` different browsers, `every` ms apart from `from`; returns their keys. */
function startBrowsers(health: GoogleSignInHealth, from: number, count: number, every = 10_000, prefix = 'b'): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${prefix}${i}`;
    health.noteStart(key, from + i * every);
    keys.push(key);
  }
  return keys;
}

/** The school's network in these tests (TEST-NET addresses), set as PIN_AUTO_SCHOOL_IPS. */
const SCHOOL_IPS = ['203.0.113.10', '198.51.100.20'];

beforeEach(() => {
  vi.stubEnv('PIN_AUTO_SCHOOL_IPS', SCHOOL_IPS.join(','));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Google sign-in health: the worked examples', () => {
  it('1: eight browsers stuck from 12:00:10 trip it once the sixth start is 2 minutes old, "since 12:00"', () => {
    const { health } = watcher();
    const starts = [at(12, 0, 10), at(12, 0, 30), at(12, 1), at(12, 1, 30), at(12, 2), at(12, 2, 30), at(12, 2, 45), at(12, 3)];
    starts.forEach((t, i) => health.noteStart(`b${i}`, t));
    expect(health.status(at(12, 4, 29))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 5 });
    const tripped = health.status(at(12, 4, 30));
    expect(tripped).toMatchObject({ looksBlocked: true, since: at(12, 0, 10), reason: 'no_returns', unansweredBrowsers: 6 });
    expect(health.status(at(12, 5))).toMatchObject({ looksBlocked: true, since: at(12, 0, 10), unansweredBrowsers: 8 });
  });

  it('2: thirty starts with twenty-eight students back in are not blocked (two abandoned)', () => {
    const { health } = watcher();
    const keys = startBrowsers(health, at(10, 0), 30, 2000);
    keys.slice(0, 28).forEach((key, i) => {
      health.noteCallback(key, undefined, true, at(10, 0, 30) + i * 1000);
      health.noteSignedIn(key, 'user', at(10, 0, 31) + i * 1000);
    });
    expect(health.status(at(10, 10))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 2 });
  });

  it('3: one student retrying ten times in twelve minutes is one browser, not an outage', () => {
    const { health } = watcher();
    for (let i = 0; i < 10; i++) health.noteStart('alone', at(10, 0) + i * 80_000);
    expect(health.status(at(10, 12))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 1 });
  });

  it('4: five browsers stuck for ten minutes are not enough; a sixth trips it 2 minutes later', () => {
    const { health } = watcher();
    startBrowsers(health, at(10, 0), 5);
    expect(health.status(at(10, 10))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 5 });
    health.noteStart('sixth', at(10, 10));
    expect(health.status(at(10, 11, 59)).looksBlocked).toBe(false);
    expect(health.status(at(10, 12))).toMatchObject({ looksBlocked: true, since: at(10, 0), unansweredBrowsers: 6 });
  });

  it('5: a student Google sign-in 5 minutes ago holds it off until that success is 15 minutes old', () => {
    const { health } = watcher();
    health.noteStart('ok', at(10, 0));
    health.noteCallback('ok', undefined, true, at(10, 0, 20));
    health.noteSignedIn('ok', 'user', at(10, 0, 20));
    startBrowsers(health, at(10, 1), 6, 20_000);
    expect(health.status(at(10, 5, 20))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 6, lastStudentSignInAt: at(10, 0, 20) });
    expect(health.status(at(10, 15, 20)).looksBlocked).toBe(false);
    expect(health.status(at(10, 15, 21))).toMatchObject({ looksBlocked: true, since: at(10, 1) });
  });

  it('6: a student Google sign-in at 12:40 clears it; it cannot trip again before 12:55', () => {
    const { health } = watcher();
    startBrowsers(health, at(12, 30), 6);
    expect(health.status(at(12, 33)).looksBlocked).toBe(true);
    health.noteStart('lucky', at(12, 39, 50));
    health.noteCallback('lucky', undefined, true, at(12, 40));
    health.noteSignedIn('lucky', 'user', at(12, 40));
    expect(health.status(at(12, 40))).toMatchObject({ looksBlocked: false, since: null, reason: null, clearedAt: at(12, 40) });
    // Six more stuck right after: still not blocked until the 12:40 success is 15 minutes old.
    startBrowsers(health, at(12, 41), 6, 10_000, 'late');
    expect(health.status(at(12, 50)).looksBlocked).toBe(false);
    expect(health.status(at(12, 55)).looksBlocked).toBe(false);
    expect(health.status(at(12, 55, 1))).toMatchObject({ looksBlocked: true, since: at(12, 41) });
  });

  it('7: the teacher signing in with Google proves nothing about students', () => {
    const { health } = watcher();
    startBrowsers(health, at(12, 0), 6);
    expect(health.status(at(12, 3)).looksBlocked).toBe(true);
    health.noteStart('teacher', at(12, 4));
    health.noteCallback('teacher', undefined, true, at(12, 4, 10));
    health.noteSignedIn('teacher', 'admin', at(12, 4, 10));
    expect(health.status(at(12, 5))).toMatchObject({ looksBlocked: true, since: at(12, 0), lastStudentSignInAt: null });
  });

  it('8: an hour with no Google start clears it (13:30 after a last start at 12:30); fresh stuck starts trip it again', () => {
    const { health } = watcher();
    startBrowsers(health, at(12, 0), 6);
    expect(health.status(at(12, 3)).looksBlocked).toBe(true);
    health.noteStart('last', at(12, 30));
    expect(health.status(at(13, 29, 59)).looksBlocked).toBe(true);
    expect(health.status(at(13, 30))).toMatchObject({ looksBlocked: false, clearedAt: at(13, 30), unansweredBrowsers: 0 });
    // Read late, it still says when it cleared.
    expect(health.status(at(14, 0)).clearedAt).toBe(at(13, 30));
    startBrowsers(health, at(13, 35), 6, 5000, 'again');
    expect(health.status(at(13, 37)).looksBlocked).toBe(false);
    expect(health.status(at(13, 37, 25))).toMatchObject({ looksBlocked: true, since: at(13, 35) });
  });

  it('9: Google sending six browsers back with admin_policy_enforced (their own state) blocks at once', () => {
    const { health } = watcher();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) {
      health.noteStart(`b${i}`, at(12, 0, i * 5));
      health.noteCallback(`b${i}`, 'admin_policy_enforced', true, at(12, 0, i * 5 + 3));
    }
    // One student's browser (even five) proves nothing: anyone can send their own browser's state back.
    expect(health.status(at(12, 0, 30))).toMatchObject({ looksBlocked: false, reason: null, unansweredBrowsers: 5 });
    health.noteStart('b5', at(12, 0, 40));
    health.noteCallback('b5', 'admin_policy_enforced', true, at(12, 0, 43));
    expect(health.status(at(12, 0, 43))).toMatchObject({ looksBlocked: true, since: at(12, 0), reason: 'google_error', unansweredBrowsers: 6 });
    expect(warn.mock.calls.filter(([fields]) => (fields as { event?: string }).event === 'google_signin_health.blocked')).toHaveLength(1);
  });

  it('9b: one browser sent back with admin_policy_enforced and its own state switches nothing on', () => {
    const { health } = watcher();
    health.noteStart('b', at(12, 0));
    health.noteCallback('b', 'admin_policy_enforced', true, at(12, 0, 15));
    // Counted at once (no 2-minute grace), and again for a retry: still one browser.
    health.noteStart('b', at(12, 1));
    health.noteCallback('b', 'admin_policy_enforced', true, at(12, 1, 5));
    expect(health.status(at(12, 10))).toMatchObject({ looksBlocked: false, reason: null, unansweredBrowsers: 1 });
  });

  it('9c: six policy refusals trip it even within 15 minutes of a student Google sign-in', () => {
    const { health } = watcher();
    health.noteStart('ok', at(11, 58));
    health.noteCallback('ok', undefined, true, at(11, 58, 10));
    health.noteSignedIn('ok', 'user', at(11, 58, 10));
    // Stuck starts are held off by that success...
    startBrowsers(health, at(12, 0), 6, 1000, 'stuck');
    expect(health.status(at(12, 5)).looksBlocked).toBe(false);
    // ...but Google saying no to six browsers is not ambiguous.
    for (let i = 0; i < 6; i++) health.noteCallback(`stuck${i}`, 'admin_policy_enforced', true, at(12, 5, i));
    expect(health.status(at(12, 5, 6))).toMatchObject({ looksBlocked: true, reason: 'google_error', since: at(12, 0) });
  });

  it('9d: a student Google sign-in after the trip clears it, and the refused browsers no longer count', () => {
    const { health } = watcher();
    for (let i = 0; i < 6; i++) {
      health.noteStart(`b${i}`, at(12, 0, i));
      health.noteCallback(`b${i}`, 'admin_policy_enforced', true, at(12, 0, i + 1));
    }
    expect(health.status(at(12, 1)).looksBlocked).toBe(true);
    health.noteSignedIn('lucky', 'user', at(12, 2));
    expect(health.status(at(12, 2))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 0, clearedAt: at(12, 2) });
    expect(health.status(at(12, 10)).looksBlocked).toBe(false);
    // Six new refusals after that success trip it again.
    for (let i = 0; i < 6; i++) {
      health.noteStart(`again${i}`, at(12, 11, i));
      health.noteCallback(`again${i}`, 'admin_policy_enforced', true, at(12, 11, i + 1));
    }
    expect(health.status(at(12, 12))).toMatchObject({ looksBlocked: true, reason: 'google_error' });
  });

  it('10: the same callback typed by hand (no matching state) changes nothing', () => {
    const { health } = watcher();
    health.noteStart('b', at(12, 0));
    health.noteCallback('b', 'admin_policy_enforced', false, at(12, 0, 15));
    health.noteCallback('other', 'admin_policy_enforced', false, at(12, 0, 15));
    expect(health.status(at(12, 0, 15))).toMatchObject({ looksBlocked: false, reason: null });
    // The real start is still waiting for Google.
    expect(health.status(at(12, 2)).unansweredBrowsers).toBe(1);
  });

  it('11: one student pressing Cancel (access_denied) counts that browser at once, and only that one', () => {
    const { health } = watcher();
    health.noteStart('cancel', at(10, 0));
    health.noteCallback('cancel', 'access_denied', true, at(10, 0, 5));
    expect(health.status(at(10, 0, 5))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 1 });
    // Four more stuck: five in all, still not blocked.
    startBrowsers(health, at(10, 0, 10), 4);
    expect(health.status(at(10, 5))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 5 });
    // A fifth other browser makes six.
    health.noteStart('sixth', at(10, 5));
    expect(health.status(at(10, 7))).toMatchObject({ looksBlocked: true, reason: 'no_returns', since: at(10, 0) });
  });

  it('12: a start with no session id is ignored', () => {
    const { health } = watcher();
    for (let i = 0; i < 10; i++) health.noteStart(null, at(10, 0) + i * 1000);
    health.noteCallback(null, 'admin_policy_enforced', true, at(10, 1));
    expect(health.status(at(10, 5))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 0 });
  });

  it('13: a restart forgets everything, and says since when it has been watching', () => {
    const { health, setClock } = watcher(at(9, 0));
    startBrowsers(health, at(12, 0), 6);
    expect(health.status(at(12, 3)).looksBlocked).toBe(true);
    setClock(at(12, 10));
    const restarted = new GoogleSignInHealth({ now: () => at(12, 10) });
    expect(restarted.status()).toEqual({
      looksBlocked: false, since: null, reason: null, unansweredBrowsers: 0, lastStudentSignInAt: null, clearedAt: null,
      watchingSince: at(12, 10),
    });
    // reset() is the same as a restart.
    health.reset();
    expect(health.status()).toEqual(restarted.status());
  });

  it('14: one student abandoning six private windows trips it; the next student Google sign-in clears it', () => {
    const { health } = watcher();
    startBrowsers(health, at(10, 0), 6, 15_000, 'incognito');
    expect(health.status(at(10, 4)).looksBlocked).toBe(true);
    health.noteStart('classmate', at(10, 6));
    health.noteCallback('classmate', undefined, true, at(10, 6, 20));
    health.noteSignedIn('classmate', 'user', at(10, 6, 20));
    expect(health.status(at(10, 6, 20))).toMatchObject({ looksBlocked: false, clearedAt: at(10, 6, 20) });
  });
});

describe('Google sign-in health: bookkeeping', () => {
  it('logs one "blocked" per trip, and one "cleared"', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const { health } = watcher();
    startBrowsers(health, at(12, 0), 8);
    for (let m = 3; m < 10; m++) health.status(at(12, m));
    const events = (spy: typeof warn, event: string) => spy.mock.calls.filter(([fields]) => (fields as { event?: string }).event === event);
    expect(events(warn, 'google_signin_health.blocked')).toHaveLength(1);
    expect(events(warn, 'google_signin_health.blocked')[0][0]).toEqual({
      // At 12:03 the starts from 12:00:00 to 12:01:00 are 2 minutes old: seven of the eight.
      event: 'google_signin_health.blocked', reason: 'no_returns', since: new Date(at(12, 0)).toISOString(), browsers: 7,
    });
    health.noteSignedIn('x', 'user', at(12, 10));
    expect(events(info, 'google_signin_health.cleared')).toHaveLength(1);
  });

  it('keeps at most maxTracked browsers, dropping the oldest start first', () => {
    const health = new GoogleSignInHealth({ maxTracked: 3, minBrowsers: 3, now: () => at(10, 0) });
    startBrowsers(health, at(10, 0), 5, 1000);
    expect(health.status(at(10, 4)).unansweredBrowsers).toBe(3);
    // The two oldest (10:00:00, 10:00:01) were dropped: the block starts at the third.
    expect(health.status(at(10, 4))).toMatchObject({ looksBlocked: true, since: at(10, 0, 2) });
  });

  it('forgets a browser once Google answers it, with or without another error', () => {
    const { health } = watcher();
    health.noteStart('a', at(10, 0));
    health.noteStart('b', at(10, 0));
    health.noteCallback('a', undefined, true, at(10, 0, 30));
    health.noteCallback('b', 'invalid_request', true, at(10, 0, 30));
    expect(health.status(at(10, 5)).unansweredBrowsers).toBe(0);
  });

  it('forgets stuck starts older than the window', () => {
    const { health } = watcher();
    startBrowsers(health, at(10, 0), 5);
    expect(health.status(at(10, 15)).unansweredBrowsers).toBe(5);
    expect(health.status(at(10, 16)).unansweredBrowsers).toBe(0);
    startBrowsers(health, at(10, 16), 1, 1000, 'new');
    expect(health.status(at(10, 20)).looksBlocked).toBe(false);
  });
});

describe('googleSignInHealthKey', () => {
  const SCHOOL = SCHOOL_IPS[0];

  it('hashes the session id and never returns it', () => {
    const sessionID = 'sess-abc-123';
    const key = googleSignInHealthKey({ sessionID, ip: SCHOOL } as unknown as Request);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toBe(createHash('sha256').update(sessionID).digest('hex').slice(0, 32));
    expect(key).not.toContain(sessionID);
    expect(googleSignInHealthKey({ ip: SCHOOL } as Request)).toBeNull();
    expect(googleSignInHealthKey({ sessionID: '', ip: SCHOOL } as unknown as Request)).toBeNull();
  });

  it('counts only browsers on the school\'s network (loopback too, outside production)', () => {
    const key = (ip: string | undefined) => googleSignInHealthKey({ sessionID: 's', ip } as unknown as Request);
    for (const ip of ['203.0.113.10', '198.51.100.20', '::ffff:203.0.113.10', '127.0.0.1', '::1']) expect(key(ip), ip).not.toBeNull();
    for (const ip of ['203.0.113.9', '203.0.113.11', '', undefined]) expect(key(ip), String(ip)).toBeNull();
  });

  it('takes the school\'s addresses from PIN_AUTO_SCHOOL_IPS (none built in), and no loopback in production', () => {
    vi.stubEnv('PIN_AUTO_SCHOOL_IPS', ' 198.51.100.7, 203.0.113.9 ');
    try {
      expect(schoolNetworkIps()).toEqual(['198.51.100.7', '203.0.113.9']);
      expect(fromSchoolNetwork('203.0.113.9')).toBe(true);
      expect(fromSchoolNetwork('203.0.113.10')).toBe(false);
      vi.stubEnv('PIN_AUTO_SCHOOL_IPS', '');
      expect(schoolNetworkIps()).toEqual([]);
      expect(fromSchoolNetwork('127.0.0.1')).toBe(true);
      vi.stubEnv('NODE_ENV', 'production');
      expect(fromSchoolNetwork('127.0.0.1')).toBe(false);
      expect(fromSchoolNetwork('::1')).toBe(false);
      // Unset in production: no address is the school's, so Auto never switches on.
      expect(fromSchoolNetwork('203.0.113.10')).toBe(false);
      vi.stubEnv('PIN_AUTO_SCHOOL_IPS', SCHOOL_IPS.join(','));
      expect(fromSchoolNetwork('203.0.113.10')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Google sign-in health: the boot warning about the school network', () => {
  it('warns once at boot in production when PIN_AUTO_SCHOOL_IPS is empty, and not otherwise', () => {
    const warn = vi.fn();
    vi.stubEnv('PIN_AUTO_SCHOOL_IPS', '');
    // Outside production loopback counts, so Auto works in dev and e2e: no warning.
    expect(autoNetworkConfigured()).toBe(true);
    expect(warnIfNoSchoolNetwork({ warn })).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv('NODE_ENV', 'production');
    expect(autoNetworkConfigured()).toBe(false);
    expect(warnIfNoSchoolNetwork({ warn })).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ event: 'pin_login.no_school_network' });
    expect(warn.mock.calls[0][1]).toMatch(/PIN_AUTO_SCHOOL_IPS.*Auto mode cannot switch on/);

    vi.stubEnv('PIN_AUTO_SCHOOL_IPS', ' , ');
    expect(warnIfNoSchoolNetwork({ warn })).toBe(true); // blanks are no addresses
    warn.mockClear();
    vi.stubEnv('PIN_AUTO_SCHOOL_IPS', SCHOOL_IPS.join(','));
    expect(autoNetworkConfigured()).toBe(true);
    expect(warnIfNoSchoolNetwork({ warn })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs through the server logger by default', () => {
    vi.stubEnv('PIN_AUTO_SCHOOL_IPS', '');
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(warnIfNoSchoolNetwork()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('Google sign-in health: what index.ts notes for a request', () => {
  /** A browser that starts a Google sign-in and comes back refused with its own session's OAuth state. */
  function refusedBrowser(health: GoogleSignInHealth, i: number, ip: string, now: number) {
    const state = `state-${i}`;
    const req = {
      sessionID: `session-${i}`,
      ip,
      query: { error: 'admin_policy_enforced', state },
      session: { 'oauth2:accounts.google.com': { state } },
    } as unknown as Request;
    health.noteStart(googleSignInHealthKey(req), now);
    health.noteCallback(googleSignInHealthKey(req), req.query.error, callbackStateMatches(req), now + 1000);
  }

  it('a start and a refused callback with the session\'s own state, from outside the school, trip nothing', () => {
    const { health } = watcher();
    for (let i = 0; i < 20; i++) refusedBrowser(health, i, '203.0.113.9', at(22, 0) + i * 1000);
    // Nor do cookieless starts left hanging, however long.
    for (let i = 0; i < 20; i++) health.noteStart(googleSignInHealthKey({ sessionID: `fresh-${i}`, ip: '203.0.113.9' } as unknown as Request), at(22, 1));
    expect(health.status(at(22, 30))).toMatchObject({ looksBlocked: false, unansweredBrowsers: 0 });
  });

  it('six refused browsers on the school\'s network trip it', () => {
    const { health } = watcher();
    for (let i = 0; i < 6; i++) refusedBrowser(health, i, SCHOOL_IPS[0], at(12, 0) + i * 1000);
    expect(health.status(at(12, 0, 10))).toMatchObject({ looksBlocked: true, reason: 'google_error' });
  });

  it('starts from outside the school do not keep a block open', () => {
    const { health } = watcher();
    for (let i = 0; i < 6; i++) refusedBrowser(health, i, SCHOOL_IPS[0], at(12, 0) + i * 1000);
    expect(health.status(at(12, 1)).looksBlocked).toBe(true);
    // One start every 59 minutes from home: the hour with no school start still ends it.
    for (let m = 59; m < 6 * 60; m += 59) {
      health.noteStart(googleSignInHealthKey({ sessionID: `home-${m}`, ip: '203.0.113.9' } as unknown as Request), at(12, 0) + m * 60_000);
    }
    expect(health.status(at(13, 1))).toMatchObject({ looksBlocked: false, clearedAt: at(13, 0, 5) });
  });
});

describe('callbackStateMatches', () => {
  const req = (state: unknown, session: Record<string, unknown> | undefined) =>
    ({ query: state === undefined ? {} : { state }, session } as unknown as Request);

  it('is true only when the session holds that OAuth state', () => {
    const session = { 'oauth2:accounts.google.com': { state: 'abc' } };
    expect(callbackStateMatches(req('abc', session))).toBe(true);
    expect(callbackStateMatches(req('abd', session))).toBe(false);
    expect(callbackStateMatches(req(undefined, session))).toBe(false);
    expect(callbackStateMatches(req(['abc'], session))).toBe(false);
    expect(callbackStateMatches(req('abc', undefined))).toBe(false);
    expect(callbackStateMatches(req('abc', { returnTo: { state: 'abc' } }))).toBe(false);
    expect(callbackStateMatches(req('abc', { 'oauth2:localhost': { state: 'abc' } }))).toBe(true);
  });
});
