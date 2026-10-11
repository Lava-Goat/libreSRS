import { test, expect } from '@playwright/test';
import { mockAuthenticatedTrpc, mockTrpc, defaultAuthUser, defaultSetupStatus } from './support/trpcMock';

const testDeck = {
  id: 1,
  name: 'Spanish Vocabulary',
  description: 'Core vocabulary deck',
  cardCount: 500,
  learnedCount: 120,
  dueCount: 15,
};

test.describe('dashboard', () => {
  test('shows user name in header', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByText('Test User')).toBeVisible();
  });

  test('shows Your Decks heading', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
  });

  test('shows deck card with Study Now button when cards are due', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [testDeck] });

    await page.goto('/');

    await expect(page.getByText('Spanish Vocabulary')).toBeVisible();
    await expect(page.getByText('15 due')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Study Now' })).toBeVisible();
  });

  test('shows No decks available when user has no decks', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [] });

    await page.goto('/');

    await expect(page.getByText('No decks available')).toBeVisible();
  });

  test('shows Admin Dashboard link for admin users', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      authMe: { ...defaultAuthUser, role: 'admin', name: 'Admin User' },
    });

    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Admin Dashboard' })).toBeVisible();
  });

  test('hides Admin Dashboard link for regular users', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Admin Dashboard' })).not.toBeVisible();
  });

  test('Study Now link navigates to the study session', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [testDeck] });

    await page.goto('/');
    await page.getByRole('link', { name: 'Study Now' }).click();

    await expect(page).toHaveURL(/\/study\/1$/);
  });

  test('shows Review button (not Study Now) when dueCount is 0', async ({ page }) => {
    const zeroDueDeck = { ...testDeck, dueCount: 0 };
    await mockAuthenticatedTrpc(page, { decks: [zeroDueDeck] });

    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Study Now' })).not.toBeVisible();
  });

  test('shows deck description when present', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [testDeck] });

    await page.goto('/');

    await expect(page.getByText('Core vocabulary deck')).toBeVisible();
  });

  test('shows card count and learned count on a deck card', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [testDeck] });

    await page.goto('/');

    await expect(page.getByText('500 cards')).toBeVisible();
    await expect(page.getByText('120 learned')).toBeVisible();
  });

  test('shows Virtual Decks section heading', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Virtual Decks', exact: true })).toBeVisible();
  });

  test('shows Create Virtual Deck button', async ({ page }) => {
    await mockAuthenticatedTrpc(page);

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Create Virtual Deck' })).toBeVisible();
  });

  test('shows No virtual decks yet when no virtual decks exist', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { virtualDecks: [] });

    await page.goto('/');

    await expect(page.getByText('No virtual decks yet')).toBeVisible();
  });

  test('shows a virtual deck in the list when one exists', async ({ page }) => {
    const virtualDeck = {
      id: 1,
      name: 'My Subset',
      sourceDeckId: 1,
      sourceDeckName: 'Spanish Vocabulary',
      cardSelection: '1-50',
      cardCount: 50,
    };
    await mockAuthenticatedTrpc(page, { virtualDecks: [virtualDeck] });

    await page.goto('/');

    await expect(page.getByText('My Subset')).toBeVisible();
  });

  test('shows Your Progress heading visible', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      stats: {
        totalReviews: 50,
        totalCards: 200,
        cardsLearnedToday: 10,
        reviewsToday: 25,
        currentStreak: 3,
      },
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Your Progress' })).toBeVisible();
  });

  test('the labs card counts labs never done and labs to redo, not those done or waiting for the teacher', async ({ page }) => {
    const lab = { id: 1, title: 'Lab', description: null, durationMs: 60_000, requiredThroughMs: 55_000, redoByTeacher: false, attempts: 1, pausesAnswered: null, pausesCounted: null, needed: null };
    await mockAuthenticatedTrpc(page, {
      labs: [
        { ...lab, id: 1, status: 'todo', attempts: 0, submittedAt: null },
        { ...lab, id: 2, status: 'redo', submittedAt: null, pausesAnswered: 2, pausesCounted: 20, needed: 15 },
        { ...lab, id: 3, status: 'redo', redoByTeacher: true, submittedAt: null },
        { ...lab, id: 4, status: 'check', submittedAt: null },
        { ...lab, id: 5, status: 'done', submittedAt: '2026-09-25T15:12:00.000Z' },
      ],
    });

    await page.goto('/');

    await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('3 lab(s) to do');
  });

  test('a labs list from before statuses still counts labs not turned in', async ({ page }) => {
    const lab = { title: 'Lab', description: null, durationMs: 60_000, requiredThroughMs: 55_000, attempts: 0 };
    await mockAuthenticatedTrpc(page, {
      labs: [{ ...lab, id: 1, submittedAt: null }, { ...lab, id: 2, submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1 }],
    });

    await page.goto('/');

    await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('1 lab(s) to do');
  });

  test('gear icon on deck card opens Deck Settings panel', async ({ page }) => {
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
        'settings.get': {
          newCardsPerDay: 20,
          reviewsPerDay: 100,
          aiEnabled: true,
          autoPlayAudio: false,
          autoPlayAudioFront: false,
          mnemonicMode: 'manual',
          locale: null,
        },
        'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
        'settings.getDeckSettings': {
          aiEnabled: null,
          autoPlayAudio: null,
          autoPlayAudioFront: null,
          mnemonicMode: null,
          locale: null,
          newCardsPerDay: null,
          reviewsPerDay: null,
        },
      },
      mutations: {
        'auth.logout': () => {
          isLoggedOut = true;
          return { success: true };
        },
      },
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Deck settings' }).click();

    await expect(page.getByText('Deck Settings')).toBeVisible();
  });
});
