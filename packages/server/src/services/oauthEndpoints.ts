// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Where the Google sign-in goes. Always Google, except in the full-stack e2e
 * tests (tests/e2e-fullstack), which sign people in through a fake provider
 * on this machine so the real server, database and sessions can be tested
 * without a Google account.
 *
 * A test login must never be possible on a real deployment, so the override
 * needs all of: NODE_ENV=test (not merely "not production": a hand-run server
 * or `npm run dev` on a networked box often has NODE_ENV unset), an explicit
 * opt-in (LIBRESRS_E2E_FAKE_OAUTH=1), and three endpoint URLs on a loopback
 * host. Anything less falls back to Google and says why.
 */
import { logger } from '../logger.js';

export const FAKE_OAUTH_OPT_IN = 'LIBRESRS_E2E_FAKE_OAUTH';

/** The env var of each endpoint, keyed by its passport-google-oauth20 option. */
export const FAKE_OAUTH_URL_VARS = {
  authorizationURL: 'LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL',
  tokenURL: 'LIBRESRS_E2E_GOOGLE_TOKEN_URL',
  userProfileURL: 'LIBRESRS_E2E_GOOGLE_USERINFO_URL',
} as const;

export type GoogleOAuthEndpoints = Record<keyof typeof FAKE_OAUTH_URL_VARS, string>;

export type GoogleOAuthEndpointDecision =
  /** Nothing asked for: Google, silently. */
  | { use: 'google' }
  /** Asked for but refused: Google, and the reason is logged. */
  | { use: 'google'; refused: 'not-test' | 'no-opt-in' | 'incomplete' | 'not-loopback'; detail: string }
  | { use: 'fake'; endpoints: GoogleOAuthEndpoints };

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const read = (env: Env, name: string) => env[name]?.trim() || '';

/** Only an explicit test run: unset, development or any other value keeps Google. Case and spaces forgiven. */
const isTest = (env: Env) => read(env, 'NODE_ENV').toLowerCase() === 'test';

/**
 * Whether the Google strategy may use the fake provider's endpoints. Pure: it
 * reads only the env it is given.
 */
export function decideGoogleOAuthEndpoints(env: Env): GoogleOAuthEndpointDecision {
  const optIn = read(env, FAKE_OAUTH_OPT_IN);
  const urls = Object.fromEntries(
    Object.entries(FAKE_OAUTH_URL_VARS).map(([option, name]) => [option, read(env, name)]),
  ) as GoogleOAuthEndpoints;
  const anyUrl = Object.values(urls).some(Boolean);
  if (!optIn && !anyUrl) return { use: 'google' };

  if (!isTest(env)) {
    return { use: 'google', refused: 'not-test', detail: `NODE_ENV is ${read(env, 'NODE_ENV') || 'unset'}, not test` };
  }
  if (optIn !== '1') {
    return { use: 'google', refused: 'no-opt-in', detail: `${FAKE_OAUTH_OPT_IN} is not 1` };
  }
  for (const [option, name] of Object.entries(FAKE_OAUTH_URL_VARS) as [keyof GoogleOAuthEndpoints, string][]) {
    let url: URL;
    try {
      url = new URL(urls[option]);
    } catch {
      return { use: 'google', refused: 'incomplete', detail: `${name} is missing or not a URL` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { use: 'google', refused: 'incomplete', detail: `${name} is not http(s)` };
    }
    // The fake provider runs beside the tests; a remote "provider" is someone else's login.
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return { use: 'google', refused: 'not-loopback', detail: `${name} is not on this machine (${url.hostname})` };
    }
  }
  return { use: 'fake', endpoints: urls };
}

/**
 * The endpoint options to spread into a GoogleStrategy: none for Google, the
 * fake provider's when allowed. Logged loudly either way something was asked
 * for, since a fake login on a real server would let anyone in as anyone.
 */
export function googleOAuthEndpointOptions(
  env: Env = process.env,
  log: Pick<typeof logger, 'warn' | 'error'> = logger,
): Partial<GoogleOAuthEndpoints> {
  const decision = decideGoogleOAuthEndpoints(env);
  if (decision.use === 'fake') {
    log.warn(
      { event: 'auth.google.fake_provider', ...decision.endpoints },
      'TEST SIGN-IN ACTIVE: Google sign-in goes to a fake provider that lets anyone in as anyone. For e2e tests only; never on a real server.',
    );
    return decision.endpoints;
  }
  if ('refused' in decision) {
    log.error(
      { event: 'auth.google.fake_provider_refused', reason: decision.refused, detail: decision.detail },
      'Ignoring the e2e fake sign-in settings: Google sign-in uses Google.',
    );
  }
  return {};
}
