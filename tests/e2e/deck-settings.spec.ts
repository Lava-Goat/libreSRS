import { test, expect, type Page } from '@playwright/test';
import { mockTrpc, defaultSetupStatus, defaultAuthUser } from './support/trpcMock';

const testDeck = {
  id: 1,
  name: 'Spanish Vocabulary',
  description: 'Core vocabulary deck',
  cardCount: 500,
  learnedCount: 120,
  dueCount: 15,
};

const defaultSettings = {
  newCardsPerDay: 20,
  reviewsPerDay: 100,
  aiEnabled: true,
  autoPlayAudio: false,
  autoPlayAudioFront: false,
  mnemonicMode: 'manual',
  locale: null,
};

const allNullDeckSettings = {
  aiEnabled: null,
  autoPlayAudio: null,
  autoPlayAudioFront: null,
  mnemonicMode: null,
  locale: null,
  newCardsPerDay: 20,
  reviewsPerDay: 100,
};

async function mockDashboardWithDeck(
  page: Page,
  deckSettingsOverride: Record<string, unknown> = allNullDeckSettings,
  updates: unknown[] = [],
): Promise<void> {
  let isLoggedOut = false;

  await mockTrpc(page, {
    queries: {
      'auth.me': () => (isLoggedOut ? null : defaultAuthUser),
      'setup.getStatus': defaultSetupStatus,
      'cards.getMyDecks': [testDeck],
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
      'settings.getDeckSettings': deckSettingsOverride,
    },
    mutations: {
      'auth.logout': () => {
        isLoggedOut = true;
        return { success: true };
      },
      'settings.updateDeckSettings': (input: unknown) => { updates.push(input); return { ...deckSettingsOverride, ...(input as object) }; },
      'settings.resetDeckSettings': { success: true },
    },
  });
}

test.describe('deck settings', () => {
  test('gear icon on deck card opens Deck Settings panel', async ({ page }) => {
    await mockDashboardWithDeck(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByText('Deck Settings')).toBeVisible();
  });

  test('Deck Settings heading is visible when open', async ({ page }) => {
    await mockDashboardWithDeck(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByRole('heading', { name: 'Deck Settings' })).toBeVisible();
  });

  test('Close button hides Deck Settings panel', async ({ page }) => {
    await mockDashboardWithDeck(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();
    await expect(page.getByRole('heading', { name: 'Deck Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('heading', { name: 'Deck Settings' })).not.toBeVisible();
  });

  test('Using global defaults text is visible with all-null settings', async ({ page }) => {
    await mockDashboardWithDeck(page, allNullDeckSettings);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByText('Using global defaults')).toBeVisible();
  });

  test('Save button is visible in deck settings panel', async ({ page }) => {
    await mockDashboardWithDeck(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  });

  test('Reset to Default button is NOT visible when using global defaults', async ({ page }) => {
    await mockDashboardWithDeck(page, allNullDeckSettings);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByRole('button', { name: 'Reset to Default' })).not.toBeVisible();
  });

  test('Reset to Default button IS visible when deck has overrides', async ({ page }) => {
    const overriddenDeckSettings = {
      aiEnabled: null,
      autoPlayAudio: null,
      autoPlayAudioFront: null,
      mnemonicMode: null,
      locale: null,
      newCardsPerDay: 10,
      reviewsPerDay: null,
    };

    await mockDashboardWithDeck(page, overriddenDeckSettings);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByRole('button', { name: 'Reset to Default' })).toBeVisible();
  });

  test('limits the teacher locked are shown, disabled, and say who set them', async ({ page }) => {
    await mockDashboardWithDeck(page, {
      ...allNullDeckSettings,
      newCardsPerDay: 15,
      reviewsPerDay: 60,
      limitRule: 'locked',
      teacherNewCardsPerDay: 15,
      teacherReviewsPerDay: 60,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    const newCards = page.getByLabel('New cards/day');
    const reviews = page.getByLabel('Reviews/day');
    await expect(newCards).toBeDisabled();
    await expect(reviews).toBeDisabled();
    await expect(newCards).toHaveValue('15');
    await expect(reviews).toHaveValue('60');
    await expect(page.getByText('Set by your teacher.')).toBeVisible();
    // Screen readers hear why they cannot change them.
    await expect(newCards).toHaveAccessibleDescription('Set by your teacher.');
    await expect(reviews).toHaveAccessibleDescription('Set by your teacher.');
  });

  test('“only higher”: the teacher’s number is the least a student can set, and a lower one is refused', async ({ page }) => {
    const updates: unknown[] = [];
    await mockDashboardWithDeck(page, {
      ...allNullDeckSettings,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      limitRule: 'higher',
      teacherNewCardsPerDay: 20,
      teacherReviewsPerDay: 20,
    }, updates);

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    const newCards = page.getByLabel('New cards/day');
    await expect(newCards).toBeEnabled();
    await expect(newCards).toHaveAttribute('min', '20');
    await expect(newCards).toHaveAccessibleDescription('Your teacher set 20. You can go higher.');
    await expect(page.getByLabel('Reviews/day')).toHaveAccessibleDescription('Your teacher set 20. You can go higher.');

    // Below the teacher's number: marked, and not saved.
    await newCards.fill('10');
    await expect(newCards).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    expect(updates).toEqual([]);

    // Higher is fine.
    await newCards.fill('30');
    await expect(newCards).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toMatchObject({ deckId: 1, newCardsPerDay: 30, reviewsPerDay: 20 });
  });

  test('“only lower”: the teacher’s number is the most a student can set', async ({ page }) => {
    await mockDashboardWithDeck(page, {
      ...allNullDeckSettings,
      newCardsPerDay: 20,
      reviewsPerDay: 100,
      limitRule: 'lower',
      teacherNewCardsPerDay: 20,
      teacherReviewsPerDay: 100,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    const newCards = page.getByLabel('New cards/day');
    await expect(newCards).toHaveAttribute('max', '20');
    await expect(newCards).toHaveAccessibleDescription('Your teacher set 20. You can go lower.');
    await newCards.fill('25');
    await expect(newCards).toHaveAttribute('aria-invalid', 'true');
    await newCards.fill('5');
    await expect(newCards).not.toHaveAttribute('aria-invalid', 'true');
  });
});
