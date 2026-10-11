import { test, expect, type Page, type Request } from '@playwright/test';
import { mockPublicTrpc } from './support/trpcMock';

test.describe('login page', () => {
  test('Clever button hidden when cleverEnabled is false', async ({ page }) => {
    await mockPublicTrpc(page, {
      setupStatus: {
        needsSetup: false,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: true,
        cleverEnabled: false,
      },
    });

    await page.goto('/login');

    await expect(page.getByRole('button', { name: /Sign in with Clever/i })).not.toBeVisible();
  });

  test('Clever button visible when cleverEnabled is true', async ({ page }) => {
    await mockPublicTrpc(page, {
      setupStatus: {
        needsSetup: false,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: true,
        cleverEnabled: true,
      },
    });

    await page.goto('/login');

    await expect(page.getByRole('button', { name: /Sign in with Clever/i })).toBeVisible();
  });

  test('Sign in with Google button always visible when cleverEnabled is false', async ({ page }) => {
    await mockPublicTrpc(page, {
      setupStatus: {
        needsSetup: false,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: true,
        cleverEnabled: false,
      },
    });

    await page.goto('/login');

    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
  });

  test('Sign in with Google button always visible when cleverEnabled is true', async ({ page }) => {
    await mockPublicTrpc(page, {
      setupStatus: {
        needsSetup: false,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: true,
        cleverEnabled: true,
      },
    });

    await page.goto('/login');

    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
  });

  test('asks for nothing that needs a signed-in user (the server would log an error every visit)', async ({ page }) => {
    await mockPublicTrpc(page);
    const procedures: string[] = [];
    page.on('request', (request) => {
      const match = /\/api\/trpc\/([^?]+)/.exec(request.url());
      if (match) procedures.push(...decodeURIComponent(match[1]).split(','));
    });

    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByText('Español').click();

    expect(procedures).toContain('auth.me');
    expect(procedures.filter((p) => p.startsWith('settings.'))).toEqual([]);
  });
});

/**
 * "Sign in with a PIN" (v1.22.0): the chip under the Google button, and its form. The server is
 * mocked here (page.route on /auth/pin); tests/e2e-fullstack/pin-sign-in.spec.ts signs in for real.
 */
test.describe('login page: sign in with a PIN', () => {
  /** A test PIN (never a real one). */
  const PIN = '5927';
  const AUTO_NOTE = "Google sign-in isn't letting students in right now. Use your PIN.";
  const chip = (page: Page) => page.getByRole('button', { name: 'Sign in with a PIN' });
  // exact: "Sign in" is also in "Sign in with Google" and "Sign in with a PIN".
  const submit = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });

  /** Answers POST /auth/pin with `status` and `body`, and keeps what was sent. */
  async function mockPinRoute(page: Page, status: number, body: unknown): Promise<Request[]> {
    const sent: Request[] = [];
    await page.route('**/auth/pin', async (route, request) => {
      sent.push(request);
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    return sent;
  }

  async function fillForm(page: Page, username: string, pin: string) {
    await chip(page).click();
    await expect(page.getByLabel('Student number or school email')).toBeFocused();
    await page.getByLabel('Student number or school email').fill(username);
    await page.getByLabel('PIN', { exact: true }).fill(pin);
  }

  test('no chip while the server does not offer PIN sign-in', async ({ page }) => {
    await mockPublicTrpc(page);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByText(AUTO_NOTE)).toHaveCount(0);
  });

  test('the chip and the note while Google refuses students (auto)', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'auto' } });
    await page.goto('/login');
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(AUTO_NOTE)).toBeVisible();
    // The Google button stays, above the chip.
    const google = await page.getByRole('button', { name: 'Sign in with Google' }).boundingBox();
    const pinChip = await chip(page).boundingBox();
    expect(google && pinChip && google.y < pinChip.y).toBe(true);
  });

  test('the chip without the note when the teacher switched it on', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'on' } });
    await page.goto('/login');
    await expect(chip(page)).toBeVisible();
    await expect(page.getByText(AUTO_NOTE)).toHaveCount(0);
  });

  test('signs in and opens the page the student came for', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'on' } });
    const sent = await mockPinRoute(page, 200, { ok: true, redirectTo: '/privacy' });
    // The double-submit cookie the real server hands out with the page's first tRPC answer.
    await page.context().addCookies([{ name: 'libresrs_csrf', value: 'csrf-e2e', url: 'http://127.0.0.1:4173' }]);
    await page.goto('/login?returnTo=%2Fprivacy');
    await fillForm(page, '123456', PIN);
    await submit(page).click();

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].method()).toBe('POST');
    expect(sent[0].url()).not.toContain(PIN);
    expect(sent[0].headers()['content-type']).toBe('application/json');
    expect(sent[0].headers()['x-csrf-token']).toBe('csrf-e2e');
    expect(sent[0].postDataJSON()).toEqual({ username: '123456', pin: PIN, returnTo: '/privacy' });
  });

  test('a wrong PIN gets the same answer as any wrong answer, and the PIN is cleared', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'auto' } });
    await mockPinRoute(page, 401, { ok: false, error: 'INVALID' });
    await page.goto('/login');
    await fillForm(page, '123456', PIN);
    await submit(page).click();

    await expect(page.getByRole('alert')).toHaveText('Wrong student number, email or PIN.');
    await expect(page.getByLabel('PIN', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('PIN', { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a locked account says how long to wait', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'on' } });
    await mockPinRoute(page, 429, { ok: false, error: 'LOCKED', retryAfterMinutes: 15 });
    await page.goto('/login');
    await fillForm(page, '123456', PIN);
    await submit(page).click();
    await expect(page.getByRole('alert')).toHaveText('Too many wrong PINs. Try again in 15 minutes.');
  });

  test('checks the fields before sending anything', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'on' } });
    const sent = await mockPinRoute(page, 500, { ok: false, error: 'SERVER_ERROR' });
    await page.goto('/login');
    await chip(page).click();
    await submit(page).click();
    await expect(page.getByRole('alert')).toHaveText('Type your student number or school email.');
    await page.getByLabel('Student number or school email').fill('123456');
    // Letters never reach the field: the PIN is digits only.
    await page.getByLabel('PIN', { exact: true }).pressSequentially('59ab');
    await expect(page.getByLabel('PIN', { exact: true })).toHaveValue('59');
    await submit(page).click();
    await expect(page.getByRole('alert')).toHaveText('Your PIN has 4 digits.');
    expect(sent).toHaveLength(0);
  });

  test('reads in Spanish', async ({ page }) => {
    await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'auto' } });
    await page.addInitScript(() => {
      try { window.localStorage.setItem('libresrs.locale', 'es'); } catch { /* storage off: English */ }
    });
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Entrar con un PIN' })).toBeVisible();
    await expect(page.getByText('Google no está dejando entrar a los estudiantes ahora mismo. Usa tu PIN.')).toBeVisible();
  });
});
