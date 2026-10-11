// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The legal pages against the real server, whichever texts it serves (core's neutral defaults, or
 * an operator's own from an extension, whose own specs check their wording under
 * tests/e2e-fullstack/extensions/): each page reachable before signing in, filled from the run's
 * LEGAL_* values (env.ts) with no placeholder left, the addresses the app links to landed on, and
 * /.well-known/security.txt from the same values.
 */
import { expect, test } from '@playwright/test';
import { API_URL, LEGAL_ENV } from './env';

test.describe('legal pages', () => {
  test('the sign-in page leads to the summary, the policy and the rules, each filled for this site', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Privacy summary' }).click();
    await expect(page).toHaveURL(/\/privacy\/summary$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
    await expect(page.locator('article')).not.toContainText('{{');

    await page.goto('/login');
    await page.getByRole('link', { name: 'Full privacy policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    const article = page.locator('article');
    await expect(article).toContainText(LEGAL_ENV.LEGAL_OPERATOR_LEGAL_NAME);
    await expect(article).not.toContainText('{{');
    // Filled in: no "not filled in" notice.
    await expect(page.getByRole('note')).toHaveCount(0);

    await page.goto('/login');
    await page.getByRole('link', { name: 'Rules for using the site' }).click();
    await expect(page).toHaveURL(/\/terms#aup$/);
    await expect(page.locator('#aup')).toBeInViewport();
  });

  test('every legal page opens on its own address, and the addresses the app links to land on their sections', async ({ page }) => {
    for (const path of ['/privacy/coppa-notice', '/subprocessors', '/terms']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('article')).not.toContainText('{{');
    }
    await page.goto('/privacy#AI-Policy');
    await expect(page.locator('h2#AI-Policy')).toBeInViewport();
    // The AI table is read from the settings: the run has every AI switch off (startApi.ts), so
    // every feature's "Right now" reads Off.
    const rows = page.getByRole('table', { name: /AI features on this site right now/ }).locator('tbody tr');
    await expect(rows).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(rows.nth(i).locator('td').nth(1)).toHaveText(/^Off\b/);
    // The older address lands on the same heading.
    await page.goto('/terms');
    await page.goto('/privacy#ai');
    await expect(page.locator('h2#AI-Policy')).toBeInViewport();
    await expect(page.locator('h2#AI-Policy #ai')).toHaveCount(1);
  });

  test('a mistyped version address says there is no such page, not "try again later", and links the current one', async ({ page }) => {
    await page.goto('/terms/2');
    await expect(page.getByRole('alert')).toHaveText(/There is no such version of this page\./);
    await expect(page.getByText(/try again later/)).toHaveCount(0);
    await page.getByRole('link', { name: 'Read the current version' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('security.txt names the security contact, and the policy says the file exists', async ({ page, request }) => {
    const res = await request.get(`${API_URL}/.well-known/security.txt`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain(`Contact: mailto:${LEGAL_ENV.LEGAL_SECURITY_EMAIL}`);
    expect(text).toMatch(/^Expires: \d{4}-\d\d-\d\dT00:00:00Z$/m);
    await page.goto('/privacy#security');
    await expect(page.locator('h2#security')).toBeInViewport();
    await expect(page.locator('article')).toContainText(LEGAL_ENV.LEGAL_SECURITY_EMAIL);
    await expect(page.locator('article')).toContainText('A security.txt file at /.well-known/security.txt says the same.');
  });
});
