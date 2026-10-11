import { test, expect } from '@playwright/test';
import { mockAdminTrpc } from './support/trpcMock';

test.describe('admin panel — decks', () => {
  test('"Decks" heading is visible on decks tab', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(page.getByRole('heading', { name: 'Decks', exact: true })).toBeVisible();
  });

  test('deck names from sampleAdminDecks are visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(page.getByText('Spanish Vocabulary')).toBeVisible();
  });

  test('"+ New Deck" button is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(page.getByRole('button', { name: '+ New Deck' })).toBeVisible();
  });

  test('"Select a deck to manage cards and group assignments" message shown when no deck selected', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(
      page.getByText('Select a deck to manage cards and group assignments')
    ).toBeVisible();
  });

  test('clicking "+ New Deck" opens create form with "Deck name" placeholder input', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByRole('button', { name: '+ New Deck' }).click();

    await expect(page.getByPlaceholder('Deck name')).toBeVisible();
  });

  test('create form has Description field with placeholder "Description (optional)"', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByRole('button', { name: '+ New Deck' }).click();

    await expect(page.getByPlaceholder('Description (optional)')).toBeVisible();
  });

  test('"Cancel" in create form closes it', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByRole('button', { name: '+ New Deck' }).click();

    await expect(page.getByPlaceholder('Deck name')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('Deck name')).not.toBeVisible();
  });

  test('"No decks yet" empty state shown when decks list is empty', async ({ page }) => {
    await mockAdminTrpc(page, { decks: [] });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();

    await expect(page.getByText('No decks yet')).toBeVisible();
  });

  test('clicking on a deck in the list selects it and shows "Import Cards" section', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByText('Spanish Vocabulary').click();

    await expect(page.getByText('Import Cards')).toBeVisible();
  });

  test('"Not assigned to any groups" shown when deck has no groups', async ({ page }) => {
    await mockAdminTrpc(page, { deckGroups: [] });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByText('Spanish Vocabulary').click();

    await expect(page.getByText('Not assigned to any groups')).toBeVisible();
  });
});
