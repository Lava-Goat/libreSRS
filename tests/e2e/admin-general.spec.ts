import { test, expect } from '@playwright/test';
import { mockAdminTrpc } from './support/trpcMock';

test.describe('admin panel — general', () => {
  test('all 6 tab buttons are visible', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Groups' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI' })).toBeVisible();
  });

  test('clicking Groups tab shows groups-related content', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Groups' }).click();

    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  });

  test('clicking Decks tab shows decks-related content', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('clicking Users tab shows users-related content', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Users' }).click();

    // The header is a sort button now (v1.15.0), with its arrow beside the word.
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
  });

  test('clicking Access tab shows access-related content', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByRole('heading', { name: 'Add Allowed Email' })).toBeVisible();
  });

  test('clicking AI tab shows AI configuration content', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByRole('heading', { name: 'AI Configuration' })).toBeVisible();
  });

  test('URL ?tab=groups opens Groups tab directly', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  });

  test('a reload comes back to the tab the teacher was on', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Access' }).click();
    await expect(page.getByRole('heading', { name: 'Add Allowed Email' })).toBeVisible();
    await page.reload();

    await expect(page.getByRole('button', { name: 'Access' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Add Allowed Email' })).toBeVisible();

    // Over a URL that still names another tab, too.
    await page.goto('/admin?tab=groups');
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
    await page.getByRole('button', { name: 'AI' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'AI' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'AI Configuration' })).toBeVisible();
  });

  test('"Back to Study" link navigates to /', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('link', { name: /Back to Study/i }).click();

    await expect(page).toHaveURL('/');
  });

  test('Sign out from admin panel redirects to login', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('admin user name is shown in header', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin');

    await expect(page.getByText('Admin User')).toBeVisible();
  });
});
