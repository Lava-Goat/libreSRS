// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * POST /auth/pin: "Sign in with a PIN" (v1.22.0). A JSON body {username, pin, returnTo?}; the rules are in
 * services/pinLogin.ts. index.ts mounts pinLoginBodyParser (2 KB) before the app's 10 MB JSON parser and the
 * app's double-submit CSRF check before this router. Every answer is JSON and never cached.
 */
import express, { type Request, type RequestHandler, type Response } from 'express';
import { logger } from '../logger.js';
import { hashForLog } from '../utils/logRedaction.js';
import { safeReturnTo } from '../services/returnTo.js';
import { googleSignInHealth as defaultHealth, type GoogleSignInHealth } from '../services/googleSignInHealth.js';
import {
  IpFailureLimiter,
  PIN_PATTERN,
  attemptPinSignIn,
  clientIp,
  getPinLoginMode,
  pinLoginAvailability,
} from '../services/pinLogin.js';
import type { PinLoginMode } from '../db/schema.js';

export type PinLoginError = 'BAD_REQUEST' | 'JSON_REQUIRED' | 'TOO_LARGE' | 'CROSS_ORIGIN' | 'PIN_DISABLED'
  | 'INVALID' | 'USE_FULL_EMAIL' | 'LOCKED' | 'TOO_MANY_ATTEMPTS' | 'SERVER_ERROR';

/** The JSON this route answers (the client mirrors it in api/pinLogin.ts). */
export type PinLoginResponse =
  | { ok: true; redirectTo: string }
  | { ok: false; error: PinLoginError; retryAfterMinutes?: number };

const MAX_USERNAME = 200;
const jsonParser = express.json({ limit: '2kb' });

function send(res: Response, status: number, body: PinLoginResponse): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** 2 KB JSON parser for /auth/pin, mounted before the app's 10 MB parser; answers 413/400 itself as JSON. */
export const pinLoginBodyParser: RequestHandler = (req, res, next) => {
  jsonParser(req, res, (err?: unknown) => {
    if (!err) return next();
    const tooLarge = (err as { status?: number } | null)?.status === 413;
    logger.warn({
      event: 'pin_login.failed',
      reason: tooLarge ? 'too_large' : 'bad_json',
      ip: clientIp(req.ip),
    }, 'PIN sign-in refused');
    send(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'TOO_LARGE' : 'BAD_REQUEST' });
  });
};

/** The hostname of a Host or X-Forwarded-Host value ("learn.example.org:443" → "learn.example.org"), or null. */
function hostnameOf(host: string | undefined): string | null {
  const value = host?.split(',')[0]?.trim();
  if (!value) return null;
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A POST from another site cannot sign a browser in (login CSRF). Hostnames, not ports: the Vite proxies
 * (dev 5173 → 6767, full-stack e2e 14173 → 16767) rewrite Host. No Origin or Referer passes: such a
 * client is still JSON-only and CSRF-checked.
 */
function originAllowed(req: Request): boolean {
  const header = req.get('origin') ?? req.get('referer');
  if (!header) return true;
  let hostname: string;
  try {
    hostname = new URL(header).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  const allowed = [hostnameOf(req.get('host')), hostnameOf(req.get('x-forwarded-host'))];
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (frontendUrl) {
    try {
      allowed.push(new URL(frontendUrl).hostname);
    } catch { /* not a URL: ignored */ }
  }
  if (allowed.includes(hostname)) return true;
  return process.env.NODE_ENV !== 'production' && LOOPBACK.has(hostname);
}

/**
 * What the logs keep of the username: only a keyed one-way hash of it (hashForLog), never the
 * username itself, and nothing at all of a value that is
 * a PIN (a student who typed their PIN in the wrong box). A line that names the account (its
 * numeric user ID: success, wrong PIN, lock, session error) carries no hash at all: beside the ID
 * the hash would only say again who it was. So the hash is kept only where no account matched.
 */
function loggedUsername(raw: unknown): { usernameHash: string | null; usernameWasPin?: true } {
  if (typeof raw !== 'string') return { usernameHash: null };
  const value = raw.trim().toLowerCase().slice(0, MAX_USERNAME);
  if (PIN_PATTERN.test(value)) return { usernameHash: null, usernameWasPin: true };
  return { usernameHash: value ? hashForLog(value) : null };
}

export function pinLoginRouter(options: {
  health?: GoogleSignInHealth;
  limiter?: IpFailureLimiter;
  getMode?: () => PinLoginMode;
  now?: () => number;
} = {}): express.Router {
  const health = options.health ?? defaultHealth;
  const limiter = options.limiter ?? new IpFailureLimiter();
  const getMode = options.getMode ?? getPinLoginMode;
  const clock = options.now ?? Date.now;
  const router = express.Router();

  router.post('/auth/pin', async (req, res) => {
    const ip = clientIp(req.ip);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.slice(0, MAX_USERNAME) : body.username;
    const logged = { ip, ...loggedUsername(username) };
    /** For a line that names the account: its ID, and nothing of the username. */
    const forAccount = (userId: number | undefined) => (userId === undefined ? logged : { ip, userId });
    const refuse = (status: number, error: PinLoginError, reason: string, extra: Record<string, unknown> = {}) => {
      const { userId, ...rest } = extra as { userId?: number };
      logger.warn({ event: 'pin_login.failed', reason, ...forAccount(userId), ...rest }, 'PIN sign-in refused');
      send(res, status, { ok: false, error });
    };

    try {
      if (!req.is('application/json')) return refuse(415, 'JSON_REQUIRED', 'json_required');
      if (!originAllowed(req)) return refuse(403, 'CROSS_ORIGIN', 'cross_origin');

      const now = clock();
      const mode = getMode();
      const availability = pinLoginAvailability(mode, health.status(now), now);
      if (!availability.acceptsPins) return refuse(403, 'PIN_DISABLED', 'disabled', { mode });

      const pin = body.pin;
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return refuse(400, 'BAD_REQUEST', 'bad_request');

      const attempt = await attemptPinSignIn({ username, pin, ip, now, limiter });
      switch (attempt.kind) {
        case 'ip_limited':
          logger.warn({ event: 'pin_login.failed', reason: 'ip_limit', ...logged }, 'PIN sign-in refused');
          res.set('Retry-After', String(Math.ceil(attempt.retryAfterMs / 1000)));
          return send(res, 429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: minutes(attempt.retryAfterMs) });
        case 'invalid':
          // The same body for every reason: nobody learns which accounts exist or have a PIN.
          return refuse(401, 'INVALID', attempt.reason, { userId: attempt.userId, failedCount: attempt.failedCount });
        case 'ambiguous':
          return refuse(401, 'USE_FULL_EMAIL', 'ambiguous');
        case 'locked':
          logger.warn({
            event: 'pin_login.locked',
            stage: attempt.started ? 'start' : 'refused',
            ...forAccount(attempt.userId),
            lockLevel: attempt.lockLevel,
            lockedUntil: new Date(now + attempt.retryAfterMs).toISOString(),
          }, attempt.started ? 'PIN sign-in locked after too many wrong PINs' : 'PIN sign-in refused: locked');
          res.set('Retry-After', String(Math.ceil(attempt.retryAfterMs / 1000)));
          return send(res, 429, { ok: false, error: 'LOCKED', retryAfterMinutes: minutes(attempt.retryAfterMs) });
        case 'success': {
          // Read before logging in: req.logIn starts a new session, and this goes with the old one.
          const redirectTo = safeReturnTo(body.returnTo) ?? safeReturnTo(req.session?.returnTo) ?? '/';
          const user = attempt.user;
          return req.logIn(user, (err) => {
            if (err) {
              logger.error({ err, event: 'pin_login.error', ...forAccount(user.id) }, 'PIN sign-in could not start the session');
              return send(res, 500, { ok: false, error: 'SERVER_ERROR' });
            }
            logger.info({
              event: 'pin_login.success',
              ...forAccount(user.id),
              reason: mode === 'on' ? 'on' : 'auto',
            }, 'Signed a student in with a PIN');
            return send(res, 200, { ok: true, redirectTo });
          });
        }
      }
    } catch (err) {
      logger.error({ err, event: 'pin_login.error', ...logged }, 'PIN sign-in failed');
      if (!res.headersSent) send(res, 500, { ok: false, error: 'SERVER_ERROR' });
    }
  });

  return router;
}
