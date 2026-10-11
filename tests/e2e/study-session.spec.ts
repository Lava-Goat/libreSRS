import { test, expect, type Page } from '@playwright/test';
import { mockTrpc, TrpcMockError, mockMnemonicSuggestions, cardAssetsWithImage } from './support/trpcMock';

const baseAuthUser = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  picture: null,
};

const baseSetupStatus = {
  needsSetup: false,
  callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
  hasAdminEmail: true,
  cleverEnabled: false,
};

const futureDate = new Date(Date.now() + 86_400_000).toISOString();

const emptyCounts = {
  remainingNewCardsToday: 20,
  remainingReviewsToday: 100,
  newCardsLimit: 20,
  reviewsLimit: 100,
};

const sampleCard = {
  card: { id: 1, deckId: 1, front: 'Hello', back: 'Hola' },
  // state: 0 = New
  state: { id: 1, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
  direction: 0, // Forward
  nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
};

/**
 * Sets up tRPC mocks for a study session at /study/1.
 *
 * `initialCards` is returned on the first getDueCards fetch.  Subsequent
 * fetches (e.g. the refetch triggered after the last card is rated) return an
 * empty array, preventing the completion screen from being reset by incoming
 * data.
 */
async function mockStudySession(
  page: Page,
  initialCards: unknown[] = [sampleCard],
  mutations: Record<string, unknown> = {},
  queries: Record<string, unknown> = {},
): Promise<void> {
  let fetchCount = 0;

  await mockTrpc(page, {
    queries: {
      'auth.me': baseAuthUser,
      'setup.getStatus': baseSetupStatus,
      'cards.getDueCards': () => {
        const cards = fetchCount === 0 ? initialCards : [];
        fetchCount += 1;
        return { cards, counts: emptyCounts };
      },
      'cards.getDeckProgress': {
        totalCards: 50,
        learnedCards: 10,
        retentionRate: 0.85,
        totalTimeMs: 300_000,
      },
      // Deck settings: all null means fall back to user defaults
      'settings.getDeckSettings': {
        aiEnabled: null,
        autoPlayAudio: null,
        autoPlayAudioFront: null,
        mnemonicMode: null,
        locale: null,
      },
      // No AI features enabled — keeps the component surface minimal
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'ai.getCardAiState': null,
      'ai.getCardAssets': null,
      ...queries,
    },
    mutations: {
      'auth.logout': { success: true },
      // state: 2 = Review (not Learning/Relearning), so card is not requeued
      'cards.review': {
        state: { id: 1, stability: 1.0, difficulty: 0.3, reps: 1, lapses: 0, state: 2 },
        nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
        reviewLogId: 42,
      },
      'cards.undoReview': {
        state: { id: 1, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
        nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
      },
      ...mutations,
    },
  });
}

test.describe('study session', () => {
  test('a student sees the teacher’s mnemonic on the back, and no cognate score (v1.20.0)', async ({ page }) => {
    // The legacy fields stand for an older server, which still sent the score and the badge switch.
    await mockStudySession(page, [sampleCard], {}, {
      'ai.getCardAiState': {
        acceptedMnemonic: { text: 'OH-la: hola, hello', source: 'teacher' },
        pendingMnemonic: null,
        cognateScore: 0.93,
        isFalseFriend: true,
        falseFriendDismissed: false,
      },
      'settings.getDeckSettings': { aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null, showCognateScore: true, locale: null },
    });

    await page.goto('/study/1');
    await expect(page.getByText('Hello')).toBeVisible();
    await expect(page.getByText('OH-la: hola, hello')).toHaveCount(0);
    await page.getByRole('button', { name: /Show Answer/ }).click();

    await expect(page.getByText('Hola', { exact: true })).toBeVisible();
    await expect(page.getByText('OH-la: hola, hello')).toBeVisible();
    await expect(page.getByText('Chosen by your teacher')).toBeVisible();
    await expect(page.getByText(/cognate/i)).toHaveCount(0);
    await expect(page.getByText(/93\s*%/)).toHaveCount(0);
    await expect(page.getByText(/false friend/i)).toHaveCount(0);
  });

  test('shows All Done when no cards are due for the deck', async ({ page }) => {
    await mockStudySession(page, []);

    await page.goto('/study/1');

    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible();
  });

  test('shows card front and Show Answer button', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');

    await expect(page.getByText('Hello')).toBeVisible();
    await expect(page.getByRole('button', { name: /Show Answer/ })).toBeVisible();
  });

  test('clicking Show Answer reveals the card back and rating buttons', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();

    await expect(page.getByText('Hola')).toBeVisible();
    await expect(page.getByRole('button', { name: /Again/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hard/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Good/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Easy/ })).toBeVisible();
  });

  test('the Wiktionary links open at each side’s language: the deck’s front and back languages (v1.26.1)', async ({ page }) => {
    await mockStudySession(page, [sampleCard], {}, {
      'settings.getDeckSettings': {
        deckId: 1, aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null,
        sourceLanguage: 'en', targetLanguage: 'es',
      },
    });

    await page.goto('/study/1');
    await expect(page.getByTitle('Look up "Hello" on Wiktionary'))
      .toHaveAttribute('href', 'https://en.wiktionary.org/wiki/Hello#English');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await expect(page.getByTitle('Look up "Hola" on Wiktionary'))
      .toHaveAttribute('href', 'https://en.wiktionary.org/wiki/Hola#Spanish');
  });

  test('rating the last card with Good completes the session', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();

    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible();
  });

  test('Back to Dashboard link on completion screen navigates home', async ({ page }) => {
    await mockStudySession(page, []);

    await page.goto('/study/1');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to Dashboard' }).click();

    await expect(page).toHaveURL('/');
  });

  test('shows card count in session header', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');

    await expect(page.getByText('1 cards in session')).toBeVisible();
    await expect(page.getByText('0 of 1 seen · 0 done')).toBeVisible();
  });

  test('Exit button returns to dashboard mid-session', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');
    await page.getByRole('button', { name: 'Exit' }).click();

    await expect(page).toHaveURL('/');
  });

  test('Space key flips card to reveal the answer', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).waitFor();
    await page.keyboard.press('Space');

    await expect(page.getByText('Hola')).toBeVisible();
  });

  test("keyboard shortcut '3' rates Good after flip and completes session", async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).waitFor();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: /Good/ }).waitFor();
    await page.keyboard.press('3');

    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
  });

  test('Undo button is disabled initially', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');

    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('Undo button becomes enabled after rating a card', async ({ page }) => {
    const sampleCard2 = {
      card: { id: 2, deckId: 1, front: 'Goodbye', back: 'Adiós' },
      state: { id: 2, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
      direction: 0,
      nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
    };

    await mockStudySession(page, [sampleCard, sampleCard2]);

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();

    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  test('progress bar is present during a study session', async ({ page }) => {
    await mockStudySession(page);

    await page.goto('/study/1');

    await expect(page.locator('.bg-gray-200.rounded-full.h-2')).toBeVisible();
  });

  test('the counter counts cards seen and done: an Again keeps a card in the session, a graduation finishes it', async ({ page }) => {
    const hello2 = {
      card: { id: 2, deckId: 1, front: 'Goodbye', back: 'Adiós' },
      state: { id: 2, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
      direction: 0,
      nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
    };
    const completions: Record<string, unknown>[] = [];
    await mockStudySession(page, [sampleCard, hello2], {
      // Again leaves the card in learning (state 1), so it comes back this session; the rest graduate (state 2).
      'cards.review': (input: unknown) => {
        const { cardStateId, rating } = input as { cardStateId: number; rating: number };
        return {
          state: { id: cardStateId, stability: 1.0, difficulty: 0.3, reps: 1, lapses: 0, state: rating === 1 ? 1 : 2 },
          nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
          reviewLogId: 40 + cardStateId,
        };
      },
      // Undo puts the card back as it was: new.
      'cards.undoReview': (input: unknown) => ({
        state: { id: (input as { reviewLogId: number }).reviewLogId - 40, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
        nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
      }),
      'cards.logStudyCompletion': (input: unknown) => {
        completions.push(input as Record<string, unknown>);
        return { logged: true, deduped: false };
      },
    });

    await page.goto('/study/1');
    const counts = page.getByTestId('session-counts');
    const progress = page.getByRole('progressbar');
    await expect(page.getByText('0 of 2 seen · 0 done')).toBeVisible();
    await expect(progress).toHaveAttribute('aria-label', '0 of 2 seen · 0 done');
    await expect(counts).toHaveText(/2\s*new\s*0\s*learning\s*0\s*review/);

    // Again: the card is still to do, now learning.
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Again/ }).click();
    await expect(page.getByText('Goodbye')).toBeVisible();
    // Seen once, not done.
    await expect(page.getByText('1 of 2 seen · 0 done')).toBeVisible();
    await expect(counts).toHaveText(/1\s*new\s*1\s*learning\s*0\s*review/);

    // Good graduates the second card: one done.
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await expect(page.getByText('2 of 2 seen · 1 done')).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', '50');

    // Undo takes it back off both counts: that was its only answer.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('1 of 2 seen · 0 done')).toBeVisible();
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await expect(page.getByText('2 of 2 seen · 1 done')).toBeVisible();

    // The first card again, and Good: all done.
    await expect(page.getByText('Hello')).toBeVisible();
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();

    // The server counts the session itself: the page sends which deck and its time zone, no counts.
    await expect.poll(() => completions.length).toBe(1);
    expect(completions[0]).toMatchObject({ deckId: 1, reason: 'session_complete' });
    expect(typeof completions[0].timezoneOffsetMinutes).toBe('number');
    expect(completions[0]).not.toHaveProperty('newCardsDone');
    expect(completions[0]).not.toHaveProperty('reviewsDone');
  });

  test('opening a deck with nothing due logs it once, with no counts', async ({ page }) => {
    const completions: Record<string, unknown>[] = [];
    await mockStudySession(page, [], {
      'cards.logStudyCompletion': (input: unknown) => {
        completions.push(input as Record<string, unknown>);
        return { logged: true, deduped: false };
      },
    });
    await page.goto('/study/1');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ deckId: 1, reason: 'nothing_due' });
    expect(completions[0]).not.toHaveProperty('newCardsDone');
  });

  test('a finish report lost to the network is sent again, with "Saving your finish…" while it waits', async ({ page }) => {
    const attempts: Record<string, unknown>[] = [];
    await mockStudySession(page, [sampleCard], {
      'cards.logStudyCompletion': (input: unknown) => {
        attempts.push(input as Record<string, unknown>);
        // The school's Wi-Fi drops the first try; the server is reached on the next.
        if (attempts.length === 1) throw new TrpcMockError('Service Unavailable', 'INTERNAL_SERVER_ERROR', 503);
        return { logged: false, deduped: true };
      },
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Saving your finish… check your Wi-Fi.' })).toBeVisible();
    // Sent again a second later, and saved: the note goes.
    await expect.poll(() => attempts.length, { timeout: 10_000 }).toBe(2);
    await expect(page.getByText('Saving your finish… check your Wi-Fi.')).toHaveCount(0);
    expect(attempts.map((a) => a.reason)).toEqual(['session_complete', 'session_complete']);
  });

  test('a report the server refused is not sent again', async ({ page }) => {
    const attempts: unknown[] = [];
    await mockStudySession(page, [], {
      'cards.logStudyCompletion': (input: unknown) => {
        attempts.push(input);
        throw new TrpcMockError('Deck not found', 'FORBIDDEN', 403);
      },
    });
    await page.goto('/study/1');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await page.waitForTimeout(2_500);
    expect(attempts).toHaveLength(1);
    await expect(page.getByText('Saving your finish… check your Wi-Fi.')).toHaveCount(0);
  });

  test('says when the cards still in learning come back, when the deck opens to nothing due', async ({ page }) => {
    await mockTrpc(page, {
      queries: {
        'auth.me': baseAuthUser,
        'setup.getStatus': baseSetupStatus,
        'cards.getDueCards': { cards: [], counts: { ...emptyCounts, learningLater: 4, learningBackInMs: 7.2 * 60_000 } },
        'cards.getDeckProgress': { totalCards: 50, learnedCards: 10, retentionRate: 0.85, totalTimeMs: 300_000 },
      },
      mutations: {
        'cards.logStudyCompletion': { logged: true, deduped: false },
      },
    });
    await page.goto('/study/1');
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect(page.getByText('4 cards come back in about 8 min.')).toBeVisible();
  });

  test('Reverse badge shows when card direction is Reverse', async ({ page }) => {
    const reverseCard = { ...sampleCard, direction: 1 };

    await mockStudySession(page, [reverseCard]);

    await page.goto('/study/1');

    await expect(page.getByText('Reverse')).toBeVisible();
  });
});

/**
 * The teacher's mnemonic suggestions since v1.20.0: nothing is suggested on its own, a suggestion
 * is a keyword picture or an example sentence (switching between them turns nothing down, so the
 * teacher can compare and choose), a rejected one is kept (soft reject), and only the teacher may
 * take a card's picture away.
 */
test.describe('mnemonic suggestions and pictures (v1.20.0)', () => {
  const teacher = { ...baseAuthUser, name: 'Teacher', role: 'admin' };

  test('the teacher asks for a keyword, tries another, compares it with a sentence and uses the sentence', async ({ page }) => {
    const server = mockMnemonicSuggestions();
    await mockStudySession(page, [sampleCard], server.mutations, {
      'auth.me': teacher,
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: true },
      ...server.queries,
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    const suggest = page.getByRole('button', { name: 'Suggest a mnemonic' });
    await expect(suggest).toBeVisible();
    // Opening and flipping the card asked for nothing.
    expect(server.calls.generate).toEqual([]);

    await suggest.click();
    await expect(page.getByText('KEYWORD 1 for card 1')).toBeVisible();
    await expect(page.getByText('Keyword picture')).toBeVisible();
    expect(server.calls.generate).toEqual([{ cardId: 1, style: 'keyword' }]);

    // "Try another" keeps the style.
    await page.getByRole('button', { name: 'Try another' }).click();
    await expect(page.getByText('KEYWORD 2 for card 1')).toBeVisible();
    expect(server.calls.reject).toEqual([1]);
    expect(server.calls.generate.at(-1)).toEqual({ cardId: 1, style: 'keyword' });

    // "Try a sentence" switches it, and turns the keyword down: it still waits.
    await page.getByRole('button', { name: 'Try a sentence' }).click();
    await expect(page.getByText('Sentence 3 for card 1')).toBeVisible();
    await expect(page.getByText('Example sentence')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try a keyword' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try a sentence' })).toHaveCount(0);
    expect(server.calls.reject).toEqual([1]);
    expect(server.calls.generate.at(-1)).toEqual({ cardId: 1, style: 'sentence' });

    // "Try a keyword" shows the waiting keyword again, paying for nothing; and back to the sentence.
    await page.getByRole('button', { name: 'Try a keyword' }).click();
    await expect(page.getByText('KEYWORD 2 for card 1')).toBeVisible();
    await page.getByRole('button', { name: 'Try a sentence' }).click();
    await expect(page.getByText('Sentence 3 for card 1')).toBeVisible();
    expect(server.calls.generate).toHaveLength(3);
    // The rejected suggestion is kept, not deleted.
    expect(server.rows.map((r) => [r.id, r.style, r.rejectedAt !== null])).toEqual([
      [1, 'keyword', true],
      [2, 'keyword', false],
      [3, 'sentence', false],
    ]);

    await page.getByRole('button', { name: 'Use for everyone' }).click();
    await expect(page.getByText('Chosen by your teacher')).toBeVisible();
    await expect(page.getByText('Sentence 3 for card 1')).toBeVisible();
    expect(server.calls.accept).toEqual([3]);
    expect(server.calls.generate).toHaveLength(3);
  });

  test('“Suggest a sentence” asks for a sentence straight away', async ({ page }) => {
    const server = mockMnemonicSuggestions();
    await mockStudySession(page, [sampleCard], server.mutations, {
      'auth.me': teacher,
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: true },
      ...server.queries,
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: 'Suggest a sentence' }).click();
    await expect(page.getByText('Sentence 1 for card 1')).toBeVisible();
    await expect(page.getByText('Example sentence')).toBeVisible();
    expect(server.calls.generate).toEqual([{ cardId: 1, style: 'sentence' }]);
  });

  test('a suggestion the teacher left waiting comes back with its style, and is not paid for again', async ({ page }) => {
    const server = mockMnemonicSuggestions();
    server.rows.push({ id: 1, cardId: 1, text: 'Hola, ¿PERO quién eres?', style: 'sentence', accepted: false, rejectedAt: null });
    await mockStudySession(page, [sampleCard], server.mutations, {
      'auth.me': teacher,
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: true },
      ...server.queries,
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await expect(page.getByText('Hola, ¿PERO quién eres?')).toBeVisible();
    await expect(page.getByText('Example sentence')).toBeVisible();
    expect(server.calls.generate).toEqual([]);

    await page.getByRole('button', { name: 'Try another' }).click();
    await expect(page.getByText('Sentence 2 for card 1')).toBeVisible();
    expect(server.calls.reject).toEqual([1]);
    expect(server.calls.generate).toEqual([{ cardId: 1, style: 'sentence' }]);
  });

  test('a student sees the picture and the approved mnemonic, but no suggestion buttons and no Remove', async ({ page }) => {
    const server = mockMnemonicSuggestions({ teacher: false, approved: { 1: 'OH-la: hola, hello' } });
    await mockStudySession(page, [sampleCard], server.mutations, {
      'ai.getConfig': { pronunciation: false, image: true, mnemonic: true },
      'ai.getCardAssets': cardAssetsWithImage,
      ...server.queries,
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await expect(page.getByText('OH-la: hola, hello')).toBeVisible();
    await expect(page.getByRole('img', { name: 'AI-generated illustration' })).toBeVisible();
    for (const name of ['Remove', 'Suggest a mnemonic', 'Suggest a sentence', 'Try another', 'Try a sentence', 'Try a keyword', 'Use for everyone', 'Delete']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    expect(server.calls.generate).toEqual([]);
    expect(server.calls.removeImage).toEqual([]);
  });

  test('the teacher can remove a card’s picture', async ({ page }) => {
    const server = mockMnemonicSuggestions();
    await mockStudySession(page, [sampleCard], server.mutations, {
      'auth.me': teacher,
      'ai.getConfig': { pronunciation: false, image: true, mnemonic: true },
      'ai.getCardAssets': cardAssetsWithImage,
      ...server.queries,
    });

    await page.goto('/study/1');
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await expect(page.getByRole('img', { name: 'AI-generated illustration' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('img', { name: 'AI-generated illustration' })).toHaveCount(0);
    expect(server.calls.removeImage).toEqual([1]);
  });
});
