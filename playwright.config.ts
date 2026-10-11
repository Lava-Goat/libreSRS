import { defineConfig, devices, type Project } from '@playwright/test';

const npmBin = process.env.NPM_BIN ?? 'npm';

/**
 * The accessibility scans (a11y.spec.ts) run in desktop Chrome and on the
 * iPhone only. axe reads the DOM and computed styles, which came out the same
 * in every engine; the width is what changes a result. In the other three
 * projects they were a third of the run and found nothing new.
 */
const a11yElsewhere = /a11y\.spec\.ts$/;

/**
 * LIBRESRS_EXTENSIONS=none runs core alone: the client is built without its
 * extensions, so their specs (tests/e2e/extensions/<id>/) are left out. A
 * project's own testIgnore replaces the top-level one, so every project lists it.
 * Run it with CI=1: otherwise a dev server already running with the
 * extensions on is reused.
 */
const extIgnore = process.env.LIBRESRS_EXTENSIONS === 'none' ? [/[\\/]extensions[\\/]/] : [];

/**
 * The browsers students commonly use: Chromebooks, desktops and phones,
 * where an iPhone means WebKit whatever the browser's name. 'chromium' stays first, as it was. Narrow a run with
 * Playwright's own flag: --project=chromium, or --project='mobile-*'.
 */
const allProjects: Project[] = [
  {
    name: 'chromium',
    testIgnore: extIgnore,
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'firefox',
    testIgnore: [a11yElsewhere, ...extIgnore],
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    testIgnore: [a11yElsewhere, ...extIgnore],
    use: { ...devices['Desktop Safari'] },
  },
  {
    name: 'mobile-chrome',
    testIgnore: [a11yElsewhere, ...extIgnore],
    use: { ...devices['Pixel 7'] },
  },
  {
    name: 'mobile-safari',
    testIgnore: extIgnore,
    use: { ...devices['iPhone 14'] },
  },
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `${npmBin} run dev -w @libresrs/client -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: allProjects,
});
