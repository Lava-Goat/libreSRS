import { test, expect } from '@playwright/test';
import { mockAuthenticatedTrpc, mockTrpc, defaultSetupStatus, defaultAuthUser } from './support/trpcMock';

const sampleVirtualDeck = {
  id: 1,
  name: 'My Subset',
  sourceDeckId: 1,
  sourceDeckName: 'Spanish Vocabulary',
  cardSelection: '1-50',
  cardCount: 50,
};

const sampleDeck = {
  id: 1,
  name: 'Spanish Vocabulary',
  description: 'Core vocabulary deck',
  cardCount: 500,
  learnedCount: 120,
  dueCount: 15,
};

test.describe('virtual decks', () => {
  test('Virtual Decks heading is visible on dashboard', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Virtual Decks', exact: true })).toBeVisible();
  });

  test('Create Virtual Deck button is visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Create Virtual Deck' })).toBeVisible();
  });

  test('No virtual decks yet empty state when no virtual decks', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { virtualDecks: [] });

    await page.goto('/');

    await expect(page.getByText('No virtual decks yet')).toBeVisible();
  });

  test('virtual deck appears in list when one exists', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { virtualDecks: [sampleVirtualDeck] });

    await page.goto('/');

    await expect(page.getByText('My Subset')).toBeVisible();
    await expect(page.getByText(/Spanish Vocabulary/)).toBeVisible();
  });

  test('Study link on virtual deck navigates to virtual study session', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { virtualDecks: [sampleVirtualDeck] });

    await page.goto('/');
    await page.getByRole('link', { name: 'Study' }).click();

    await expect(page).toHaveURL(/\/study\/virtual\/1$/);
  });

  test('clicking Create Virtual Deck opens the create form', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Create Virtual Deck' }).click();

    await expect(page.getByPlaceholder('My subset')).toBeVisible();
  });

  test('Cancel button closes the create form', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Create Virtual Deck' }).click();
    await expect(page.getByPlaceholder('My subset')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('My subset')).not.toBeVisible();
  });

  test('create form has Source Deck select', async ({ page }) => {
    let isLoggedOut = false;

    await mockTrpc(page, {
      queries: {
        'auth.me': () => (isLoggedOut ? null : defaultAuthUser),
        'setup.getStatus': defaultSetupStatus,
        'cards.getMyDecks': [sampleDeck],
        'cards.getStats': {
          totalReviews: 0,
          totalCards: 0,
          cardsLearnedToday: 0,
          reviewsToday: 0,
          currentStreak: 0,
        },
        'virtualDecks.list': [],
        'settings.get': {
          newCardsPerDay: 20,
          reviewsPerDay: 100,
          aiEnabled: false,
          autoPlayAudio: false,
          autoPlayAudioFront: false,
          mnemonicMode: 'manual',
          locale: null,
        },
        'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      },
      mutations: {
        'auth.logout': () => {
          isLoggedOut = true;
          return { success: true };
        },
      },
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Create Virtual Deck' }).click();

    await expect(page.getByRole('option', { name: 'Select a deck...' })).toBeAttached();
  });

  test('create form has Card Selection input', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Create Virtual Deck' }).click();

    await expect(page.getByPlaceholder('1-100, 250, 550-557')).toBeVisible();
  });
});
