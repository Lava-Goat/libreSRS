// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Smoke test of flashcard study on the real server: the cards come from the
 * database, each rating goes through FSRS on the server, and what it
 * scheduled is still there after a reload. Then the day's numbers (v1.16):
 * a deck opened and left still shows what Study opens with, and the server
 * records the "All Done!" at the last card, so a report the network lost
 * still reaches the teacher, whose "Flashcards by day" shows it. (With an
 * extension that adds to the finish, its own specs check that part:
 * tests/e2e-fullstack/extensions/.)
 */
import { test, expect } from '@playwright/test';
import type { Person } from './env';
import { signIn } from './support/auth';
import { TeacherApi } from './support/seed';

const BETO: Person = { email: '23456@students.school.test', name: 'Beto Ruiz' };
const CARLA: Person = { email: '34567@students.school.test', name: 'Carla Vega' };
const COLORS = 'Colores';
const COLOR_CARDS: [string, string][] = [
  ['rojo', 'red'],
  ['azul', 'blue'],
  ['verde', 'green'],
  ['amarillo', 'yellow'],
];
/** Carla's class and deck, for the teacher's look at the day. */
let colors: { deckId: number; groupId: number };
const DECK = 'Saludos';
const CARDS: [string, string][] = [
  ['hola', 'hello'],
  ['adiós', 'goodbye'],
  ['gracias', 'thank you'],
  ['por favor', 'please'],
];

test.beforeAll(async () => {
  const teacher = await TeacherApi.signIn();
  try {
    await teacher.deckForClass({ deck: DECK, cards: CARDS, group: 'Period 5', students: [BETO] });
    // Every spec shares one database: each class name is its own (labs-journey has Period 6).
    colors = await teacher.deckForClass({ deck: COLORS, cards: COLOR_CARDS, group: 'Period 4', students: [CARLA] });
  } finally {
    await teacher.dispose();
  }
});

test('a student studies a new deck: every card shown and rated, and the progress kept', async ({ page }) => {
  await signIn(page, BETO);
  const deck = page.locator('div.rounded-lg', { has: page.getByRole('heading', { name: DECK, exact: true }) }).first();
  await expect(deck).toContainText(`${CARDS.length} cards`);
  await expect(deck).toContainText('0 learned');
  await deck.getByRole('link', { name: 'Study Now' }).click();
  await expect(page.getByText(`${CARDS.length} cards in session`)).toBeVisible();

  // The question side, then the answer side under it (FlashcardReview's card-content blocks).
  const sides = page.locator('.card-content');
  const seen: string[] = [];
  for (let i = 0; i < CARDS.length; i++) {
    const showAnswer = page.getByRole('button', { name: /Show Answer/ });
    await expect(showAnswer).toBeVisible();
    // A card of this deck, not shown before in this session.
    const front = (await sides.first().innerText()).trim();
    const card = CARDS.find(([f]) => f === front);
    expect(card, `"${front}" is one of the deck's cards`).toBeDefined();
    expect(seen).not.toContain(front);
    seen.push(front);
    // Half the cards by keyboard, the way students go fast.
    if (i % 2 === 0) await showAnswer.click();
    else await page.keyboard.press('Space');
    await expect(sides.nth(1)).toHaveText(card?.[1] ?? '');
    // Easy: a new card graduates straight to review, so it is not asked again today.
    if (i % 2 === 0) await page.getByRole('button', { name: /Easy/ }).click();
    else await page.keyboard.press('4');
    if (i < CARDS.length - 1) await expect(sides.first()).not.toHaveText(front);
  }
  expect([...seen].sort()).toEqual(CARDS.map(([f]) => f).sort());

  await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
  await expect(page.getByText(`${CARDS.length} / 20`)).toBeVisible();

  // The server scheduled every card: after a reload nothing is due.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Dashboard' }).click();
  await expect(deck).toContainText(`${CARDS.length} learned`);
  await expect(deck.getByRole('link', { name: 'Review' })).toBeVisible();
});

test.describe('the day\'s numbers and its "All Done!"', () => {
  test('a deck opened and left still shows what Study opens with; the finish reaches the teacher though its report was lost', async ({ page }) => {
    await signIn(page, CARLA);
    const deck = page.locator('div.rounded-lg', { has: page.getByRole('heading', { name: COLORS, exact: true }) }).first();
    await expect(deck).toContainText(`${COLOR_CARDS.length} due`);

    // Open the deck and leave at once: the page set up the cards' states, and they are still 4 due, not 8.
    await deck.getByRole('link', { name: 'Study Now' }).click();
    await expect(page.getByText(`${COLOR_CARDS.length} cards in session`)).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(deck).toContainText(`${COLOR_CARDS.length} due`);
    await expect(deck).not.toContainText(`${COLOR_CARDS.length * 2} due`);

    // Study every card, a couple of seconds each (the way a student reads it, not a glance),
    // and the Wi-Fi drops the page's "All Done!" report, every time it is tried.
    await deck.getByRole('link', { name: 'Study Now' }).click();
    const lost: string[] = [];
    await page.route(/\/api\/trpc\/[^?]*cards\.logStudyCompletion/, (route) => {
      lost.push(route.request().url());
      return route.abort('internetdisconnected');
    });
    const sides = page.locator('.card-content');
    for (let i = 0; i < COLOR_CARDS.length; i++) {
      const showAnswer = page.getByRole('button', { name: /Show Answer/ });
      await expect(showAnswer).toBeVisible();
      const front = (await sides.first().innerText()).trim();
      await page.waitForTimeout(2_000);
      await showAnswer.click();
      // Easy: a new card goes straight to review, so the session ends after one pass.
      await page.getByRole('button', { name: /Easy/ }).click();
      if (i < COLOR_CARDS.length - 1) await expect(sides.first()).not.toHaveText(front);
    }
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await expect.poll(() => lost.length).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: 'Saving your finish… check your Wi-Fi.' })).toBeVisible();

    // A reload (the report still cannot get through): nothing due, the server recorded the finish at the last card.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
    await page.unroute(/\/api\/trpc\/[^?]*cards\.logStudyCompletion/);
    await page.getByRole('link', { name: 'Back to Dashboard' }).click();
    await expect(deck).toContainText(`${COLOR_CARDS.length} learned`);

    // The teacher's "Flashcards by day" shows Carla finished, her only deck and so all her flashcards.
    const teacher = await TeacherApi.signIn();
    try {
      const day = await teacher.query<{ students: { email: string; allDone: number | null; cells: { deckId: number; finishedAt: number | null; finishes: number }[] }[] }>(
        'admin.groupFlashcardDay', { groupId: colors.groupId },
      );
      const carla = day.students.find((s) => s.email === CARLA.email);
      expect(carla?.cells.find((c) => c.deckId === colors.deckId)).toMatchObject({ finishedAt: expect.any(Number), finishes: 1 });
      expect(carla?.allDone).toEqual(expect.any(Number));
    } finally {
      await teacher.dispose();
    }
  });
});
