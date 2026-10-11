/**
 * Flashcard "Study all" (v1.18.0): one button on the dashboard runs every deck
 * with cards due today, the newest deck first, each as its own session, and
 * ends on one "All Done!" screen. The server's answers are mocked: the
 * server's own rules have their tests in packages/server.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockAuthenticatedTrpc, mockTrpc } from './support/trpcMock';

const authUser = { id: 1, name: 'Test User', email: '100008@students.school.test', role: 'user', picture: null };
const setupStatus = { needsSetup: false, callbackUrl: 'http://127.0.0.1:4173/auth/google/callback', hasAdminEmail: true, cleverEnabled: false };
const futureDate = new Date(Date.now() + 86_400_000).toISOString();
const counts = { remainingNewCardsToday: 20, remainingReviewsToday: 250, newCardsLimit: 20, reviewsLimit: 250 };

let nextId = 1;
const newCard = (deckId: number, front: string, back: string) => {
  const id = nextId++;
  return {
    card: { id, deckId, front, back },
    state: { id, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
    direction: 0,
    nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
  };
};

const overview = (decks: [number, string, number][]) => ({
  decks: decks.map(([deckId, deckName, total]) => ({ deckId, deckName, learning: 0, reviews: 0, newCards: total, total })),
  totalDue: decks.reduce((sum, [, , total]) => sum + total, 0),
  learningLater: 0,
  learningBackInMs: null,
});

/**
 * Unit 3 (the newest, two new cards) and Unit 2 (one card) are due. Each deck
 * hands out its cards once; the run asks studyAll again at its end and finds
 * nothing.
 */
async function mockStudyAll(page: Page) {
  const served = new Set<number>();
  const cardsOf: Record<number, unknown[]> = {
    3: [newCard(3, 'estudiar', 'to study'), newCard(3, 'trabajar', 'to work')],
    2: [newCard(2, 'la casa', 'the house')],
  };
  let studyAllCalls = 0;
  const reports: { deckId: number; reason: string }[] = [];
  await mockTrpc(page, {
    queries: {
      'auth.me': authUser,
      'setup.getStatus': setupStatus,
      'cards.studyAll': () => {
        studyAllCalls += 1;
        return studyAllCalls === 1 ? overview([[3, 'Unit 3', 2], [2, 'Unit 2', 1]]) : overview([]);
      },
      'cards.getDueCards': (input: unknown) => {
        const { deckId } = input as { deckId: number };
        const cards = served.has(deckId) ? [] : (cardsOf[deckId] ?? []);
        served.add(deckId);
        return { cards, counts };
      },
      'settings.getDeckSettings': { aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null, locale: null },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'ai.getCardAiState': null,
      'ai.getCardAssets': null,
    },
    mutations: {
      'auth.logout': { success: true },
      'cards.review': (input: unknown) => {
        const { cardStateId } = input as { cardStateId: number };
        return {
          state: { id: cardStateId, stability: 3, difficulty: 0.3, reps: 1, lapses: 0, state: 2 },
          nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
          reviewLogId: 500 + cardStateId,
        };
      },
      'cards.logStudyCompletion': (input: unknown) => {
        const report = input as { deckId: number; reason: string };
        reports.push(report);
        const last = report.deckId === 2;
        return {
          logged: true,
          deduped: false,
          decksLeft: last ? [] : [{ deckId: 2, deckName: 'Unit 2', total: 1 }],
        };
      },
    },
  });
  return { reports };
}

async function rateGood(page: Page) {
  await page.getByRole('button', { name: /Show Answer/ }).click();
  await page.getByRole('button', { name: /Good/ }).click();
}

test.describe('Study all flashcards', () => {
  test('the dashboard offers it with every deck\'s due cards added up', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      decks: [{ id: 3, name: 'Unit 3', cardCount: 65, learnedCount: 0, dueCount: 2 }, { id: 2, name: 'Unit 2', cardCount: 65, learnedCount: 40, dueCount: 1 }],
      queries: { 'cards.studyAll': overview([[3, 'Unit 3', 2], [2, 'Unit 2', 1]]) },
    });
    await page.goto('/');
    const button = page.getByRole('link', { name: 'Study all flashcards (3)' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('href', '/study/all');
  });

  test('runs the newest deck first, then the next by itself, each with its own report, then one "All Done!"', async ({ page }) => {
    const { reports } = await mockStudyAll(page);
    await page.goto('/study/all');

    const deckLine = page.getByTestId('study-all-deck');
    await expect(deckLine).toHaveText('Deck 1 of 2: Unit 3');
    await expect(page.getByText('estudiar')).toBeVisible();
    await rateGood(page);
    await expect(page.getByText('trabajar')).toBeVisible();
    await rateGood(page);

    // Unit 3's own "All Done!" is reported, and Unit 2 starts without a stop.
    await expect(deckLine).toHaveText('Deck 2 of 2: Unit 2');
    await expect(page.getByText('la casa')).toBeVisible();
    await rateGood(page);

    const heading = page.getByRole('heading', { name: 'All Done!' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText("You've studied every deck with cards due today. Come back later for more!")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Decks studied' })).toBeVisible();
    expect(reports.map((r) => [r.deckId, r.reason])).toEqual([[3, 'session_complete'], [2, 'session_complete']]);

    await page.getByRole('link', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  test('a deck\'s own "All Done!" names the decks still due and offers Study all', async ({ page }) => {
    const reports: unknown[] = [];
    await mockTrpc(page, {
      queries: {
        'auth.me': authUser,
        'setup.getStatus': setupStatus,
        'cards.getDueCards': { cards: [], counts },
        'cards.getDeckProgress': { totalCards: 65, learnedCards: 65, retentionRate: 0.9, totalTimeMs: 600_000 },
      },
      mutations: {
        'cards.logStudyCompletion': (input: unknown) => {
          reports.push(input);
          return { logged: true, deduped: false, decksLeft: [{ deckId: 2, deckName: 'Unit 2', total: 12 }, { deckId: 1, deckName: 'Unit 1', total: 5 }] };
        },
      },
    });
    await page.goto('/study/3');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect(page.getByTestId('decks-left')).toContainText('Still due today: Unit 2 (12), Unit 1 (5)');
    await page.getByRole('link', { name: /Study all flashcards/ }).click();
    await expect(page).toHaveURL('/study/all');
  });
});
