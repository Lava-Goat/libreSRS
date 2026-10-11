// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Flashcard "Study all" on the real server (v1.18.0): a student with two
 * units presses one button on the dashboard and studies the newest unit
 * first, then the older one, each as its own session under its own limits,
 * and ends on one "All Done!"; the teacher sees each unit finished and "All
 * flashcards" on the day's grid. (What an extension adds to the finish has
 * its own specs: tests/e2e-fullstack/extensions/.)
 */
import { test, expect, type Page } from '@playwright/test';
import type { Person } from './env';
import { signIn } from './support/auth';
import { deckCsv, TeacherApi } from './support/seed';

const DIEGO: Person = { email: '91001@students.school.test', name: 'Diego Paz' };
const OLD_UNIT = 'Unidad A';
const NEW_UNIT = 'Unidad B';
const OLD_CARDS: [string, string][] = [['el perro', 'the dog'], ['el gato', 'the cat']];
const NEW_CARDS: [string, string][] = [['estudiar', 'to study'], ['trabajar', 'to work'], ['hablar', 'to speak']];
let groupId = 0;

test.beforeAll(async () => {
  const teacher = await TeacherApi.signIn();
  try {
    // The older unit first, then the newer one, both for Diego's class.
    ({ groupId } = await teacher.deckForClass({ deck: OLD_UNIT, cards: OLD_CARDS, group: 'Period 2', students: [DIEGO] }));
    const newer = await teacher.mutate<{ id: number }>('admin.createDeck', { name: NEW_UNIT });
    await teacher.mutate('admin.uploadCards', { deckId: newer.id, csvContent: deckCsv(NEW_CARDS) });
    await teacher.mutate('admin.assignDeckToGroup', { deckId: newer.id, groupId });
  } finally {
    await teacher.dispose();
  }
});

/** Rates the card shown Easy (a new card graduates at once) after reading it a moment, and returns its front. */
async function rateShownCard(page: Page): Promise<string> {
  const sides = page.locator('.card-content');
  const showAnswer = page.getByRole('button', { name: /Show Answer/ });
  await expect(showAnswer).toBeVisible();
  const front = (await sides.first().innerText()).trim();
  // A moment on each card, the way a student reads it, not a glance.
  await page.waitForTimeout(1_500);
  await showAnswer.click();
  await page.getByRole('button', { name: /Easy/ }).click();
  return front;
}

test('Study all runs the newest unit first, then the older one, and the teacher sees the day\'s "All flashcards"', async ({ page }) => {
  await signIn(page, DIEGO);
  const button = page.getByRole('link', { name: `Study all flashcards (${OLD_CARDS.length + NEW_CARDS.length})` });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page).toHaveURL(/\/study\/all$/);

  const deckLine = page.getByTestId('study-all-deck');
  await expect(deckLine).toHaveText(`Deck 1 of 2: ${NEW_UNIT}`);
  const newFronts: string[] = [];
  for (let i = 0; i < NEW_CARDS.length; i++) newFronts.push(await rateShownCard(page));
  expect(newFronts.sort()).toEqual(NEW_CARDS.map(([front]) => front).sort());

  // On to the older unit by itself, without a stop at the newer unit's own "All Done!".
  await expect(deckLine).toHaveText(`Deck 2 of 2: ${OLD_UNIT}`);
  const oldFronts: string[] = [];
  for (let i = 0; i < OLD_CARDS.length; i++) oldFronts.push(await rateShownCard(page));
  expect(oldFronts.sort()).toEqual(OLD_CARDS.map(([front]) => front).sort());

  await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
  await expect(page.getByText("You've studied every deck with cards due today. Come back later for more!")).toBeVisible();

  // Back on the dashboard: nothing left to study.
  await page.getByRole('link', { name: 'Back to Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('link', { name: /Study all flashcards/ })).toHaveCount(0);

  const teacher = await TeacherApi.signIn();
  try {
    // The day's grid: each unit finished, and "All flashcards".
    const day = await teacher.query<{ day: string; students: { email: string; allDone: number | null; cells: { finishedAt: number | null }[] }[] }>(
      'admin.groupFlashcardDay', { groupId },
    );
    const diego = day.students.find((s) => s.email === DIEGO.email);
    expect(diego?.allDone).toEqual(expect.any(Number));
    expect(diego?.cells.map((c) => c.finishedAt !== null)).toEqual([true, true]);
  } finally {
    await teacher.dispose();
  }
});
