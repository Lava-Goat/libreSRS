import { test, expect } from '@playwright/test';
import { mockAdminTrpc } from './support/trpcMock';

test.describe('admin panel — access control', () => {
  test('"Add Allowed Email" heading is visible on access tab', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByText('Add Allowed Email')).toBeVisible();
  });

  test('"Email or Pattern" label is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByText('Email or Pattern')).toBeVisible();
  });

  test('"Add Email/Pattern" button is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByRole('button', { name: 'Add Email/Pattern' })).toBeVisible();
  });

  test('"Allowed Emails & Patterns" heading is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByText('Allowed Emails & Patterns')).toBeVisible();
  });

  test('existing pattern ".*@school\\.edu$" is shown in the table', async ({ page }) => {
    // Use the `pattern` field which is what the component renders (entry.pattern)
    await mockAdminTrpc(page, {
      allowedEmails: [{ id: 1, pattern: '.*@school\\.edu$', isRegex: true }],
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByText('.*@school\\.edu$')).toBeVisible();
  });

  test('"Regex" indicator is visible next to the regex pattern', async ({ page }) => {
    await mockAdminTrpc(page, {
      allowedEmails: [{ id: 1, pattern: '.*@school\\.edu$', isRegex: true }],
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByText('Regex')).toBeVisible();
  });

  test('"Remove" button is visible next to each pattern', async ({ page }) => {
    await mockAdminTrpc(page, {
      allowedEmails: [{ id: 1, pattern: '.*@school\\.edu$', isRegex: true }],
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible();
  });

  test('empty state is shown when allowedEmails is empty', async ({ page }) => {
    await mockAdminTrpc(page, { allowedEmails: [] });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(
      page.getByText('No email patterns configured. Add patterns above to control who can sign in.')
    ).toBeVisible();
  });

  test('"Test Email (optional)" field is visible after typing a pattern', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    // The test email field only renders once a pattern has been entered
    const patternInput = page.getByPlaceholder('user@example.com');
    await patternInput.fill('.*@example.com$');

    await expect(page.getByText('Test Email (optional)')).toBeVisible();
  });

  test('"Use as regular expression" checkbox is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Access' }).click();

    await expect(
      page.getByRole('checkbox', { name: /Use as regular expression/i })
    ).toBeVisible();
  });
});
