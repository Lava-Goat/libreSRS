// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Sign in with a PIN" (v1.22.0): POST /auth/pin (packages/server/src/routers/pinLogin.ts).
 *
 * The PIN travels in a JSON body, never in a URL. The route is a mutation, so it needs the
 * double-submit CSRF cookie that tRPC uses: the login page's own tRPC queries hand it out, and
 * a first POST that finds no cookie is refused with one set, so that refusal is retried once.
 */
import { getCsrfToken } from './trpc';

/** What the server answers when it refuses (routers/pinLogin.ts, PinLoginError). */
export type PinLoginError = 'BAD_REQUEST' | 'JSON_REQUIRED' | 'TOO_LARGE' | 'CROSS_ORIGIN' | 'PIN_DISABLED'
  | 'INVALID' | 'USE_FULL_EMAIL' | 'LOCKED' | 'TOO_MANY_ATTEMPTS' | 'SERVER_ERROR';

/** The server's PinLoginResponse, plus NETWORK when no answer came back at all. */
export type PinLoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: PinLoginError | 'NETWORK'; retryAfterMinutes?: number };

export interface PinSignInInput {
  username: string;
  pin: string;
  /** The page to open once signed in (the server checks it again). */
  returnTo?: string | null;
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set<PinLoginError>([
  'BAD_REQUEST', 'JSON_REQUIRED', 'TOO_LARGE', 'CROSS_ORIGIN', 'PIN_DISABLED',
  'INVALID', 'USE_FULL_EMAIL', 'LOCKED', 'TOO_MANY_ATTEMPTS', 'SERVER_ERROR',
]);

function post(body: string): Promise<Response> {
  return fetch('/auth/pin', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() },
    body,
  });
}

/** The body as JSON, or undefined when it is not JSON (express-rate-limit answers 429 in plain text). */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** The CSRF middleware's own refusal ({error: 'CSRF token required' | 'CSRF token mismatch'}). */
function isCsrfRefusal(status: number, data: unknown): boolean {
  const error = (data as { error?: unknown } | null | undefined)?.error;
  return status === 403 && typeof error === 'string' && error.startsWith('CSRF');
}

function toResult(status: number, data: unknown): PinLoginResult {
  const body = (data ?? null) as { ok?: unknown; redirectTo?: unknown; error?: unknown; retryAfterMinutes?: unknown } | null;
  if (body && typeof body === 'object') {
    if (body.ok === true && status >= 200 && status < 300 && typeof body.redirectTo === 'string') {
      return { ok: true, redirectTo: body.redirectTo };
    }
    if (body.ok === false && typeof body.error === 'string' && KNOWN_ERRORS.has(body.error)) {
      const minutes = body.retryAfterMinutes;
      return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
        ? { ok: false, error: body.error as PinLoginError, retryAfterMinutes: Math.ceil(minutes) }
        : { ok: false, error: body.error as PinLoginError };
    }
  }
  // Anything else: the /auth rate limit's text 429, a proxy's error page, a CSRF refusal that came back twice.
  return { ok: false, error: status === 429 ? 'TOO_MANY_ATTEMPTS' : 'SERVER_ERROR' };
}

/** Signs in with a student number (or school email) and a PIN. Never throws. */
export async function signInWithPin({ username, pin, returnTo }: PinSignInInput): Promise<PinLoginResult> {
  const body = JSON.stringify({ username: username.trim(), pin, returnTo: returnTo ?? undefined });
  try {
    let res = await post(body);
    let data = await readJson(res);
    if (isCsrfRefusal(res.status, data)) {
      // That refusal has just set the cookie: once more, now with it.
      res = await post(body);
      data = await readJson(res);
    }
    return toResult(res.status, data);
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
}
