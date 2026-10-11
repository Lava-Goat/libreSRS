import { test, expect } from '@playwright/test';
import { mockPublicTrpc } from './support/trpcMock';

test.describe('public navigation', () => {
  test('redirects unauthenticated root users to login', async ({ page }) => {
    await mockPublicTrpc(page, {
      authMe: null,
      setupStatus: {
        needsSetup: false,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: true,
        cleverEnabled: false,
      },
    });

    await page.goto('/');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('redirects login to setup when OAuth is not configured', async ({ page }) => {
    await mockPublicTrpc(page, {
      authMe: null,
      setupStatus: {
        needsSetup: true,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: false,
        cleverEnabled: false,
      },
    });

    await page.goto('/login');

    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'libreSRS' })).toBeVisible();
    await expect(page.getByText('Initial Setup')).toBeVisible();
  });

  test('allows navigating to the privacy summary, the policy and the rules from login', async ({ page }) => {
    await mockPublicTrpc(page);

    await page.goto('/login');
    // Students are not parties to the Terms: no "by signing in, you agree".
    await expect(page.getByText('Your school set up this site for your class. Read how we handle your information:')).toBeVisible();
    await expect(page.getByText(/you agree/i)).toHaveCount(0);

    await page.getByRole('link', { name: 'Rules for using the site' }).click();
    await expect(page).toHaveURL(/\/terms#aup$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rules for using the site' })).toBeInViewport();

    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole('link', { name: 'Privacy summary' }).click();
    await expect(page).toHaveURL(/\/privacy\/summary$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy summary' })).toBeVisible();

    await page.getByRole('link', { name: 'Full privacy policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    // An accessible table: its caption names it.
    await expect(page.getByRole('table', { name: 'Sample data table.' })).toBeVisible();
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
  });

  test('opens a legal page at the section its address names', async ({ page }) => {
    await mockPublicTrpc(page);
    await page.setViewportSize({ width: 800, height: 400 });
    await page.goto('/privacy#changes');
    await expect(page.getByRole('heading', { name: 'Changes' })).toBeInViewport();
  });

  test('renders README markdown from API', async ({ page }) => {
    await mockPublicTrpc(page, {
      readmeMarkdown: '# Playwright README\n\nRendered from mocked tRPC response.',
    });

    await page.goto('/readme');

    await expect(page.getByRole('heading', { name: 'Playwright README' })).toBeVisible();
    await expect(page.getByText('Rendered from mocked tRPC response.')).toBeVisible();
  });

  test('completes setup wizard after saving OAuth credentials', async ({ page }) => {
    await mockPublicTrpc(page, {
      setupStatus: {
        needsSetup: true,
        callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
        hasAdminEmail: false,
        cleverEnabled: false,
      },
      saveCredentialsResult: { success: true },
    });

    await page.goto('/setup');

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByPlaceholder('123456789-abc.apps.googleusercontent.com')
      .fill('123.apps.googleusercontent.com');
    await page.getByPlaceholder('GOCSPX-...').fill('test-secret');

    await page.getByRole('button', { name: 'Save & Activate' }).click();

    await expect(page.getByText('Setup Complete!')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });
});
