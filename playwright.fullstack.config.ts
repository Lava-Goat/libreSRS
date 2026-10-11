// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Full-stack e2e: the real API server, a fresh SQLite database, real sessions
 * and server-side grading, behind the client's Vite dev server. Nothing is
 * mocked except Google's sign-in, which a fake provider on this machine plays
 * (tests/e2e-fullstack/fakeOAuth.ts); the server only honours that with
 * NODE_ENV=test and an explicit opt-in (packages/server/src/services/oauthEndpoints.ts).
 *
 * The mocked suite (playwright.config.ts, tests/e2e) stays the fast, broad
 * one; this one checks that the pieces work together.
 *
 * Run: npm run test:e2e:fullstack (builds @libresrs/shared first: the server
 * imports its dist). E2E_FULLSTACK_SERVER_LOGS=1 shows the API's logs.
 */
import { defineConfig, devices } from '@playwright/test';
import { CLIENT_URL, PORTS } from './tests/e2e-fullstack/env';

/**
 * LIBRESRS_EXTENSIONS=none: the server and client run without extensions, so
 * their specs (tests/e2e-fullstack/extensions/<id>/) are left out. A project's
 * own testIgnore replaces the top-level one, so the project lists it.
 */
const extIgnore = process.env.LIBRESRS_EXTENSIONS === 'none' ? [/[\\/]extensions[\\/]/] : [];

const serverLogs = process.env.E2E_FULLSTACK_SERVER_LOGS === '1' ? 'pipe' : 'ignore';

export default defineConfig({
  testDir: './tests/e2e-fullstack',
  // One server, one database, one fake provider handing out "who signs in next": one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A retry would replay steps against a database the first attempt already changed; fix flakes instead.
  retries: 0,
  timeout: 120_000,
  // The dev server compiles pages on first use; a slow CI machine needs the slack.
  expect: { timeout: 15_000 },
  // Beside the specs, not under ./test-results: the mocked suite empties that folder when it starts,
  // which pulled the trace files out from under a full-stack run in progress. (Git ignores both names anywhere.)
  outputDir: './tests/e2e-fullstack/test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './tests/e2e-fullstack/playwright-report' }]],
  globalSetup: './tests/e2e-fullstack/globalSetup.ts',
  use: {
    baseURL: CLIENT_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      name: 'api',
      // tsx, not `tsx watch`: a restart would drop the in-memory sessions mid-run.
      command: 'node_modules/.bin/tsx tests/e2e-fullstack/startApi.ts',
      url: `http://127.0.0.1:${PORTS.api}/healthz`,
      // Never reuse: the run needs its own empty database.
      reuseExistingServer: false,
      // SIGTERM lets startApi.ts remove its temporary data directory.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: serverLogs,
      timeout: 60_000,
    },
    {
      name: 'client',
      command: 'node_modules/.bin/vite packages/client --config tests/e2e-fullstack/vite.config.ts',
      url: `http://127.0.0.1:${PORTS.client}/login`,
      reuseExistingServer: false,
      env: { BROWSERSLIST_IGNORE_OLD_DATA: '1' },
      stdout: serverLogs,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: extIgnore,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
