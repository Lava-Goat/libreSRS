// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A stand-in for Google's sign-in, just enough of OAuth 2.0 for
 * passport-google-oauth20: the server under test is pointed here by the
 * LIBRESRS_E2E_* variables (packages/server/src/services/oauthEndpoints.ts).
 *
 * There is no login screen. A test says who signs in next (POST /next-user),
 * then clicks "Sign in with Google"; /authorize hands that person to the code
 * it issues, so each choice is good for one sign-in. Tests run one at a time
 * (workers: 1), so the handoff has no races.
 *
 *   GET  /health                 200 when up
 *   POST /next-user              {email, name, sub?, refuse?}: the next sign-in
 *   GET  /authorize              redirects to redirect_uri with a code (and the state), or with
 *                                ?error=<refuse> and the state and no code, as Google does when
 *                                a school's policy refuses a student (admin_policy_enforced)
 *                                or the student presses Cancel (access_denied)
 *   POST /token                  code → access token
 *   GET  /userinfo               access token → the OpenID profile Google would send
 *
 * Started by globalSetup.ts on PORTS.oauth (env.ts).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, PORTS, type Person } from './env';

/** How Google can refuse a sign-in instead of handing back a code. */
export const FAKE_REFUSALS = ['admin_policy_enforced', 'access_denied'] as const;
export type FakeRefusal = typeof FAKE_REFUSALS[number];

export interface FakeUser extends Person {
  /** Google's stable account id; derived from the email when left out. */
  sub?: string;
  /**
   * Refuse this sign-in the way Google does: back to redirect_uri with ?error= and the state, no
   * code. admin_policy_enforced is a school's Workspace policy refusing student accounts;
   * access_denied, a student pressing Cancel.
   */
  refuse?: FakeRefusal;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    ...headers,
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const token = () => randomBytes(16).toString('hex');

export function createFakeOAuthServer(): Server {
  let nextUser: FakeUser | null = null;
  const codes = new Map<string, FakeUser>();
  const accessTokens = new Map<string, FakeUser>();

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake-oauth.invalid');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok');

      if (req.method === 'POST' && url.pathname === '/next-user') {
        // JSON only: a web page in the developer's own browser could otherwise pick the next sign-in with a
        // text/plain no-cors POST. A JSON POST from a page needs a CORS preflight, which this server never allows.
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
          return send(res, 415, 'content-type must be application/json');
        }
        const user = JSON.parse(await readBody(req)) as FakeUser;
        if (!user.email || !user.name) return send(res, 400, { error: 'email and name are required' });
        if (user.refuse !== undefined && !(FAKE_REFUSALS as readonly string[]).includes(user.refuse)) {
          return send(res, 400, { error: `refuse must be one of ${FAKE_REFUSALS.join(', ')}` });
        }
        nextUser = user;
        return send(res, 204, '');
      }

      if (req.method === 'GET' && url.pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri');
        if (url.searchParams.get('client_id') !== FAKE_CLIENT_ID) return send(res, 400, 'unknown client_id');
        if (url.searchParams.get('response_type') !== 'code') return send(res, 400, 'response_type must be code');
        if (!redirectUri || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(redirectUri)) {
          return send(res, 400, `redirect_uri must be local, got ${redirectUri}`);
        }
        // A sign-in nobody asked for is a test bug: fail here rather than sign in someone stale.
        if (!nextUser) return send(res, 409, 'no next user: POST /next-user before signing in');
        const back = new URL(redirectUri);
        const state = url.searchParams.get('state');
        if (nextUser.refuse) {
          // Google's refusal: an error and the state, never a code.
          back.searchParams.set('error', nextUser.refuse);
          if (state) back.searchParams.set('state', state);
          nextUser = null;
          return send(res, 302, '', { location: back.toString() });
        }
        const code = token();
        codes.set(code, nextUser);
        nextUser = null;
        back.searchParams.set('code', code);
        if (state) back.searchParams.set('state', state);
        return send(res, 302, '', { location: back.toString() });
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams(await readBody(req));
        const user = codes.get(form.get('code') ?? '');
        if (form.get('grant_type') !== 'authorization_code' || !user) return send(res, 400, { error: 'invalid_grant' });
        if (form.get('client_id') !== FAKE_CLIENT_ID || form.get('client_secret') !== FAKE_CLIENT_SECRET) {
          return send(res, 401, { error: 'invalid_client' });
        }
        codes.delete(form.get('code') ?? '');
        const accessToken = token();
        accessTokens.set(accessToken, user);
        return send(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' });
      }

      if (req.method === 'GET' && url.pathname === '/userinfo') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        const user = accessTokens.get(bearer ?? url.searchParams.get('access_token') ?? '');
        if (!user) return send(res, 401, { error: 'invalid_token', error_description: 'unknown access token' });
        const [given, ...family] = user.name.split(' ');
        return send(res, 200, {
          sub: user.sub ?? `fake-${user.email}`,
          email: user.email,
          email_verified: true,
          name: user.name,
          given_name: given,
          family_name: family.join(' ') || undefined,
        });
      }

      return send(res, 404, 'not found');
    })().catch((err: unknown) => send(res, 500, String(err)));
  });
}

/** Starts the provider on its port (PORTS.oauth); resolves once it listens. */
export function startFakeOAuth(): Promise<Server> {
  const server = createFakeOAuthServer();
  return new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(PORTS.oauth, '127.0.0.1', () => resolveStarted(server));
  });
}
