import { test, expect } from '@playwright/test';
import { mockTrpc, mockAuthenticatedTrpc, defaultAuthUser, defaultSetupStatus } from './support/trpcMock';

test.describe('authenticated routes', () => {
  test('authenticated user at / stays on dashboard', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'libreSRS' })).toBeVisible();
  });

  test('unauthenticated user at /study/:id redirects to login', async ({ page }) => {
    await mockTrpc(page, {
      queries: {
        'auth.me': null,
        'setup.getStatus': defaultSetupStatus,
      },
      mutations: { 'auth.logout': { success: true } },
    });

    await page.goto('/study/1');

    // The login page remembers where the student was going.
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fstudy%2F1$/);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('non-admin user at /admin is redirected to dashboard', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/admin');

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'libreSRS' })).toBeVisible();
  });

  test('admin user at /admin sees the admin panel', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      authMe: { ...defaultAuthUser, role: 'admin', name: 'Admin User' },
    });

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: /Admin/ })).toBeVisible();
  });

  test('sign out from dashboard redirects to login', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);
  });
});
