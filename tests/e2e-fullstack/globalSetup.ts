// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Starts the fake sign-in provider (it lives as long as the run), then checks
 * that the API server really sends "Sign in with Google" to it. Playwright
 * starts the webServers first, so the API is up by now. Without that check a
 * server that ignored the e2e settings would send every test to
 * accounts.google.com and fail somewhere confusing.
 */
import { startFakeOAuth } from './fakeOAuth';
import { OAUTH_URL, PORTS } from './env';

export default async function globalSetup() {
  const provider = await startFakeOAuth();

  const res = await fetch(`http://127.0.0.1:${PORTS.api}/auth/google`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (res.status !== 302 || !location.startsWith(`${OAUTH_URL}/authorize`)) {
    provider.close();
    throw new Error(
      `The API server does not use the fake sign-in provider: /auth/google answered ${res.status} → ${location || '(no redirect)'}. `
      + 'Run with E2E_FULLSTACK_SERVER_LOGS=1 and look for "Ignoring the e2e fake sign-in settings".',
    );
  }

  return async () => {
    // The API server's keep-alive connections would hold close() open for seconds.
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
  };
}
