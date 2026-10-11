// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { test as base, expect as baseExpect } from '@playwright/test';
import { expectNoA11yViolations } from './support/axe';
import { mockAuthenticatedTrpc } from './support/trpcMock';

// The dashboard's notice cards (vocabulary tests, audio labs, speaking, sign-ups) fold into one
// row of chips (v1.18.0, components/dashboard/DashboardNotices.tsx), remembered by this browser.

const test = base;
/** Room for the dev server's first compile while five browsers run at once. */
const expect = baseExpect.configure({ timeout: 10_000 });

const FOLDED_KEY = 'libresrs.dashboard.noticesFolded';

const openTest = {
  id: 1, name: 'Tamaño y cobertura · Otoño', mode: 'size', occasion: 'Otoño 2026',
  settings: { bandCounts: [4, 4, 4, 4, 4], npseudo: 6, seed: 42 }, closesAt: null, myAttempts: 0,
};
const lab = {
  id: 1, title: 'ES1 Lab semana01', description: null, durationMs: 3000, requiredThroughMs: 2600, status: 'todo', redoByTeacher: false,
  submittedAt: null, attempts: 0, pausesAnswered: null, pausesCounted: null, needed: null,
};
const speaking = { id: 1, title: 'Cuento semana 3', description: null, submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1 };
const sheet = { id: 4, title: 'Show and tell', open: true, picksPerStudent: 2, myDates: [] as string[] };

/** A student with a card of every kind: 1 test open, 2 labs to do (and 1 done), speaking all turned in, 1 sheet to pick from. */
async function busyStudent(page: import('@playwright/test').Page) {
  await mockAuthenticatedTrpc(page, {
    decks: [{ id: 1, name: 'Unit 1', description: null, cardCount: 30, learnedCount: 10, dueCount: 4 }],
    vocabOpenTests: [openTest],
    labs: [lab, { ...lab, id: 2, status: 'redo' }, { ...lab, id: 3, status: 'done', submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1 }],
    speakingTasks: [speaking],
    signupSheets: [sheet],
  });
}

const details = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Details' });
const chips = (page: import('@playwright/test').Page) => page.getByRole('list', { name: 'To do' });

test.describe('the dashboard’s notice cards', () => {
  test('fold into chips that keep their counts, stay folded on the next visit, and unfold again', async ({ page }) => {
    await busyStudent(page);
    await page.goto('/');

    // Unfolded until this browser says otherwise: the full cards, as before.
    await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('2 lab(s) to do');
    await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
    const cardsId = await details(page).getAttribute('aria-controls');
    await expect(page.locator(`[id="${cardsId}"]`)).toContainText('Pick your days: Show and tell');

    await details(page).click();
    await expect(details(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: 'Audio labs' })).toHaveCount(0);
    await expect(chips(page).getByRole('link')).toHaveCount(4);
    await expect(details(page)).toHaveAttribute('aria-controls', (await chips(page).getAttribute('id'))!);
    // Each chip: its name, what is left to do (or a done mark), and the card's line read with it.
    await expect(chips(page).getByRole('link', { name: 'Vocabulómetro, 1 vocabulary test(s) open for you' })).toContainText('1');
    await expect(chips(page).getByRole('link', { name: 'Audio labs, 2 lab(s) to do' })).toContainText('2');
    await expect(chips(page).getByRole('link', { name: 'Speaking, All recordings turned in' })).toContainText('✓');
    await expect(chips(page).getByRole('link', { name: 'Sign-ups, Pick your days: Show and tell' })).toHaveAttribute('href', '/signups?sheet=4');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), FOLDED_KEY)).toBe('1');
    // The decks are where they were, now higher on the page.
    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();

    // Remembered: the next visit opens folded.
    await page.reload();
    await expect(chips(page).getByRole('link', { name: 'Audio labs, 2 lab(s) to do' })).toBeVisible();
    await expect(details(page)).toHaveAttribute('aria-expanded', 'false');

    // A chip is the card's link.
    await chips(page).getByRole('link', { name: 'Audio labs, 2 lab(s) to do' }).click();
    await expect(page).toHaveURL(/\/labs$/);
    await page.goBack();

    await details(page).click();
    await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Audio labs' })).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), FOLDED_KEY)).toBe('0');
  });

  test('fold and unfold from the keyboard, the focus staying on the button', async ({ page, browserName }) => {
    // Desktop Safari does not Tab to links and buttons by default (Option-Tab does); the click test covers it.
    test.skip(browserName === 'webkit', 'Safari’s Tab skips buttons unless “Press Tab to highlight each item” is on');
    await busyStudent(page);
    await page.goto('/');
    await expect(details(page)).toBeVisible();
    await details(page).focus();
    await page.keyboard.press('Enter');
    await expect(details(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(details(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(details(page)).toBeFocused();
    // Unfolded, the next stop is the first card, below the button.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /Vocabulómetro/ })).toBeFocused();
  });

  test('folded, the chips fit a phone’s width, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((key) => window.localStorage.setItem(key, '1'), FOLDED_KEY);
    await busyStudent(page);
    await page.goto('/');
    await expect(chips(page).getByRole('link')).toHaveCount(4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await chips(page).getByRole('link', { name: /Sign-ups/ }).boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(360);
    // Every chip and the button are big enough to tap (WCAG 2.2 target size, 24 px).
    for (const target of [...await chips(page).getByRole('link').all(), details(page)]) {
      const size = await target.boundingBox();
      expect(size?.height ?? 0).toBeGreaterThanOrEqual(24);
    }
  });

  test('shows no fold with no notices', async ({ page }) => {
    await mockAuthenticatedTrpc(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
    await expect(details(page)).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`passes the accessibility scan folded and unfolded (${theme})`, async ({ page }, testInfo) => {
      // As a11y.spec.ts: axe reads the DOM, so desktop Chrome and the iPhone are enough.
      test.skip(!['chromium', 'mobile-safari'].includes(testInfo.project.name), 'axe runs in chromium and mobile-safari only');
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((value) => window.localStorage.setItem('libresrs.theme', value), theme);
      await busyStudent(page);
      await page.goto('/');
      await expect(page.getByRole('link', { name: /Audio labs/ })).toBeVisible();
      await page.mouse.move(0, 0);
      await expectNoA11yViolations(page, { label: `dashboard notices unfolded (${theme})` });
      await details(page).click();
      await expect(chips(page).getByRole('link')).toHaveCount(4);
      await page.mouse.move(0, 0);
      await expectNoA11yViolations(page, { label: `dashboard notices folded (${theme})` });
    });
  }
});
