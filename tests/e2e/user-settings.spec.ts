import { test, expect } from '@playwright/test';
import { mockAuthenticatedTrpc, mockTrpc, defaultSetupStatus, defaultAuthUser } from './support/trpcMock';

const defaultSettings = {
  newCardsPerDay: 20,
  reviewsPerDay: 100,
  aiEnabled: true,
  autoPlayAudio: false,
  autoPlayAudioFront: false,
  mnemonicMode: 'manual',
  locale: null,
};

test.describe('user settings', () => {
  test('Default Settings heading is visible on dashboard', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Default Settings' })).toBeVisible();
  });

  test('Study Limits section is visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByText('Study Limits')).toBeVisible();
  });

  test('Save Settings button is visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Save Settings' })).toBeVisible();
  });

  test('Download Review History CSV button is visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: /Download Review History/i })).toBeVisible();
  });

  test('AI section is hidden when no AI features configured', async ({ page }) => {
    let isLoggedOut = false;

    await mockTrpc(page, {
      queries: {
        'auth.me': () => (isLoggedOut ? null : defaultAuthUser),
        'setup.getStatus': defaultSetupStatus,
        'cards.getMyDecks': [],
        'cards.getStats': {
          totalReviews: 0,
          totalCards: 0,
          cardsLearnedToday: 0,
          reviewsToday: 0,
          currentStreak: 0,
        },
        'virtualDecks.list': [],
        'settings.get': defaultSettings,
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

    await expect(page.getByText('AI & Audio')).not.toBeVisible();
  });

  test('AI section is visible when pronunciation is enabled', async ({ page }) => {
    let isLoggedOut = false;

    await mockTrpc(page, {
      queries: {
        'auth.me': () => (isLoggedOut ? null : defaultAuthUser),
        'setup.getStatus': defaultSetupStatus,
        'cards.getMyDecks': [],
        'cards.getStats': {
          totalReviews: 0,
          totalCards: 0,
          cardsLearnedToday: 0,
          reviewsToday: 0,
          currentStreak: 0,
        },
        'virtualDecks.list': [],
        'settings.get': defaultSettings,
        'ai.getConfig': { pronunciation: true, image: false, mnemonic: false },
      },
      mutations: {
        'auth.logout': () => {
          isLoggedOut = true;
          return { success: true };
        },
      },
    });

    await page.goto('/');

    await expect(page.getByText('AI & Audio')).toBeVisible();
  });

  test('mnemonic mode select offers Manual only and Disabled, with no cognate option or switch (v1.20.0)', async ({ page }) => {
    let isLoggedOut = false;

    await mockTrpc(page, {
      queries: {
        'auth.me': () => (isLoggedOut ? null : defaultAuthUser),
        'setup.getStatus': defaultSetupStatus,
        'cards.getMyDecks': [],
        'cards.getStats': {
          totalReviews: 0,
          totalCards: 0,
          cardsLearnedToday: 0,
          reviewsToday: 0,
          currentStreak: 0,
        },
        'virtualDecks.list': [],
        'settings.get': defaultSettings,
        'ai.getConfig': { pronunciation: false, image: false, mnemonic: true },
      },
      mutations: {
        'auth.logout': () => {
          isLoggedOut = true;
          return { success: true };
        },
      },
    });

    await page.goto('/');

    await expect(page.locator('#mnemonic-mode')).toHaveValue('manual');
    await expect(page.locator('#mnemonic-mode option')).toHaveText(['Manual only', 'Disabled']);
    await expect(page.locator('#mnemonic-mode option[value="auto-non-cognate"]')).toHaveCount(0);
    await expect(page.getByText(/cognate/i)).toHaveCount(0);
  });

  test('the reviews limit says what a review is', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByText('Reviews are cards that come back after you learned them (not new cards).')).toBeVisible();
    await expect(page.getByText('Reviews include learning and review cards (not new cards).')).toHaveCount(0);
  });

  test('limits the teacher set are disabled and say so; the other settings still save', async ({ page }) => {
    const saved: Record<string, unknown>[] = [];
    await mockAuthenticatedTrpc(page, {
      settings: { ...defaultSettings, newCardsPerDay: 20, reviewsPerDay: 20, limitsLocked: true, limitsAllowHigher: true, limitsAllowLower: false },
      queries: { 'ai.getConfig': { pronunciation: true, image: false, mnemonic: false } },
      mutations: { 'settings.update': (input: unknown) => { saved.push(input as Record<string, unknown>); return { success: true }; } },
    });

    await page.goto('/');

    const newCards = page.getByLabel('New cards per day');
    const reviews = page.getByLabel('Reviews per day');
    await expect(newCards).toBeDisabled();
    await expect(reviews).toBeDisabled();
    await expect(newCards).toHaveAccessibleDescription('Set by your teacher.');
    await expect(page.getByText('Set by your teacher.')).toBeVisible();

    // A setting that is the student's own still saves.
    await page.getByRole('switch').first().click();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect.poll(() => saved.length).toBe(1);
  });

  test('limits the teacher left open can be changed', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      settings: { ...defaultSettings, limitsLocked: false, limitsAllowHigher: true, limitsAllowLower: true },
    });

    await page.goto('/');

    await expect(page.getByLabel('New cards per day')).toBeEnabled();
    await expect(page.getByLabel('Reviews per day')).toBeEnabled();
    await expect(page.getByText('Set by your teacher.')).toHaveCount(0);
  });
});
