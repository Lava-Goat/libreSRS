import { test, expect, type Page } from '@playwright/test';
import { mockTrpc, defaultAuthUser, defaultSetupStatus } from './support/trpcMock';

const futureDate = new Date(Date.now() + 86_400_000).toISOString();

const baseVirtualDeck = {
  id: 1,
  name: 'My Subset',
  sourceDeckId: 1,
  sourceDeckName: 'Spanish Vocabulary',
  cardSelection: '1-50',
  cardCount: 50,
};

const emptyCounts = {
  remainingNewCardsToday: 20,
  remainingReviewsToday: 100,
  newCardsLimit: 20,
  reviewsLimit: 100,
};

const sampleCard = {
  card: { id: 1, deckId: 1, front: 'Hello', back: 'Hola' },
  state: { id: 1, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
  direction: 0,
  nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
};

async function mockVirtualStudy(page: Page, cards: unknown[] = []): Promise<void> {
  await mockTrpc(page, {
    queries: {
      'auth.me': defaultAuthUser,
      'setup.getStatus': defaultSetupStatus,
      'virtualDecks.get': baseVirtualDeck,
      'virtualDecks.getDueCards': cards,
      'settings.getDeckSettings': {
        aiEnabled: null,
        autoPlayAudio: null,
        autoPlayAudioFront: null,
        mnemonicMode: null,
        locale: null,
        newCardsPerDay: null,
        reviewsPerDay: null,
      },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'ai.getCardAiState': null,
      'ai.getCardAssets': null,
    },
    mutations: {
      'auth.logout': { success: true },
      'cards.review': {
        state: { id: 1, stability: 1.0, difficulty: 0.3, reps: 1, lapses: 0, state: 2 },
        nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
        reviewLogId: 42,
      },
      'cards.undoReview': {
        state: { id: 1, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
        nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
      },
    },
  });
}

test.describe('virtual study session', () => {
  test('shows All Done when no cards due for virtual deck', async ({ page }) => {
    await mockVirtualStudy(page, []);

    await page.goto('/study/virtual/1');

    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
  });

  test('shows Back to Dashboard link on completion screen', async ({ page }) => {
    await mockVirtualStudy(page, []);

    await page.goto('/study/virtual/1');

    await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible();
  });

  test('shows card front and Show Answer button', async ({ page }) => {
    await mockVirtualStudy(page, [sampleCard]);

    await page.goto('/study/virtual/1');

    await expect(page.getByText('Hello')).toBeVisible();
    await expect(page.getByRole('button', { name: /Show Answer/ })).toBeVisible();
  });

  test('Back to Dashboard link navigates home', async ({ page }) => {
    await mockVirtualStudy(page, []);

    await page.goto('/study/virtual/1');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to Dashboard' }).click();

    await expect(page).toHaveURL('/');
  });
});
