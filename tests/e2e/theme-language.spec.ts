import { test, expect } from '@playwright/test';
import { mockAuthenticatedTrpc } from './support/trpcMock';

test.describe('theme and language', () => {
  test('theme toggle button has correct initial aria-label', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  });

  test('clicking theme toggle switches to dark mode', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    expect(isDark).toBe(true);
  });

  test('clicking theme toggle again switches back to light mode', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.getByRole('button', { name: 'Switch to light mode' }).click();

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    expect(isDark).toBe(false);
  });

  test('language selector button is visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Language' })).toBeVisible();
  });

  test('clicking language selector opens dropdown', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Language' }).click();

    // Scope to the language dropdown container (parent of the Language button)
    const langContainer = page.getByRole('button', { name: 'Language' }).locator('..');
    await expect(langContainer.locator('button').filter({ hasText: 'English' })).toBeVisible();
  });

  test('language selector shows all supported languages', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Language' }).click();

    const langContainer = page.getByRole('button', { name: 'Language' }).locator('..');
    await expect(langContainer.locator('button').filter({ hasText: 'Español' })).toBeVisible();
  });

  test('clicking a language option in selector closes the dropdown', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Language' }).click();

    const langContainer = page.getByRole('button', { name: 'Language' }).locator('..');
    await expect(langContainer.locator('button').filter({ hasText: 'Español' })).toBeVisible();

    langContainer.locator('button').filter({ hasText: 'English' }).click();

    await expect(langContainer.locator('button').filter({ hasText: 'Español' })).not.toBeVisible();
  });
});
