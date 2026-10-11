import { test, expect, type Page } from '@playwright/test';
import { mockAdminTrpc, sampleUserDetail } from './support/trpcMock';

/**
 * The Dashboard's User Activity, a page at a time: search, sortable headers,
 * 10 / 25 / 50 / All a page (remembered on this device), and each name a link
 * to the user's page, whose Back returns to the Dashboard as it was.
 */

const day = (n: number) => new Date(Date.UTC(2026, 8, 1, 15) + n * 86_400_000).toISOString();

interface Stat {
  userId: number; userName: string; email: string; role: 'admin' | 'user';
  totalReviews: number; totalTimeMs: number; correctReviews: number; retentionRate: number; lastActive: string | null;
  studentNumber: string | null;
}

/**
 * Forty users: the teacher (1), Ana López (2), and Student 03…40; every tenth
 * has never studied. Student 03's email has no digits: the teacher typed their school ID.
 */
const classStats: Stat[] = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1;
  const never = n % 10 === 0;
  const reviews = never ? 0 : n * 3;
  const correct = never ? 0 : n * 2;
  return {
    userId: n,
    userName: n === 1 ? 'Teacher' : n === 2 ? 'Ana López' : `Student ${String(n).padStart(2, '0')}`,
    email: n === 1 ? 'teacher@school.test' : n === 3 ? 'student03@school.test' : `${30000 + n}@school.test`,
    role: n === 1 ? 'admin' : 'user',
    totalReviews: reviews,
    totalTimeMs: reviews * 20_000,
    correctReviews: correct,
    retentionRate: reviews > 0 ? correct / reviews : 0,
    lastActive: never ? null : day(n),
    studentNumber: n === 1 ? null : n === 3 ? '77703' : String(30000 + n),
  };
});

/** The Users tab's list for the same forty. */
const classUsers = classStats.map((s) => ({
  id: s.userId, name: s.userName, email: s.email, role: s.role, picture: null,
  createdAt: day(s.userId), lastActiveAt: s.lastActive === null ? null : Date.parse(s.lastActive),
  studentNumber: s.studentNumber,
}));

async function mockClass(page: Page) {
  await mockAdminTrpc(page, {
    userStats: classStats,
    users: classUsers,
    userSettings: [],
    queries: {
      'admin.userDetail': (input: unknown) => {
        const userId = (input as { userId: number }).userId;
        const stat = classStats.find((s) => s.userId === userId)!;
        const detail = sampleUserDetail(2);
        return { ...detail, user: { ...detail.user, id: userId, name: stat.userName, email: stat.email, role: stat.role } };
      },
    },
  });
}

const panel = (page: Page) => page.getByRole('region', { name: 'User Activity' });
/** The names in User Activity, top to bottom. */
const names = (page: Page) => panel(page).locator('tbody a').allTextContents();
const header = (page: Page, name: string) => panel(page).getByRole('columnheader', { name });
/** The page-size select, named by the words on both sides of it ("Show [25] per page"). */
const pageSize = (page: Page) => page.getByRole('combobox', { name: 'Show per page' });

test.describe('admin dashboard — User Activity', () => {
  test('searches, sorts and pages; the page size and sort are kept after a reload, the search is not', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'User Activity' })).toBeVisible();

    // 25 at a time, the most recently active first.
    await expect.poll(() => names(page)).toHaveLength(25);
    await expect(panel(page).getByText('1–25 of 40')).toBeVisible();
    await expect(header(page, 'Last Active')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await names(page)).slice(0, 2)).toEqual(['Student 39', 'Student 38']);

    // One box: names (accents or not), emails, school IDs.
    const search = panel(page).getByLabel('Search users');
    await search.fill('lopez');
    await expect.poll(() => names(page)).toEqual(['Ana López']);
    await expect(panel(page).getByText('1–1 of 1')).toBeVisible();
    await search.fill('30017');
    await expect.poll(() => names(page)).toEqual(['Student 17']);
    // A school ID the teacher typed, for an email without digits.
    await search.fill('77703');
    await expect.poll(() => names(page)).toEqual(['Student 03']);
    await search.fill('nobody');
    // Said where the rows would be (the pager only announces it).
    await expect(panel(page).getByRole('table', { name: 'User Activity' }).getByRole('cell', { name: 'No users match' })).toBeVisible();
    await search.fill('');

    // Sort by name, then the other way from the keyboard.
    const byName = panel(page).getByRole('button', { name: 'User', exact: true });
    await byName.click();
    await expect(header(page, 'User')).toHaveAttribute('aria-sort', 'ascending');
    await expect(panel(page).locator('th[aria-sort]')).toHaveCount(1);
    await expect.poll(async () => (await names(page))[0]).toBe('Ana López');
    await byName.focus();
    await page.keyboard.press('Enter');
    await expect(header(page, 'User')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await names(page))[0]).toBe('Teacher');
    // The teacher is marked as one.
    await expect(panel(page).getByRole('row', { name: /Teacher/ }).getByText('Admin', { exact: true })).toBeVisible();

    // No reviews is no retention: last whichever way.
    await panel(page).getByRole('button', { name: 'Retention', exact: true }).click();
    await pageSize(page).selectOption('all');
    await expect.poll(async () => (await names(page)).slice(-4)).toEqual(['Student 10', 'Student 20', 'Student 30', 'Student 40']);
    await panel(page).getByRole('button', { name: 'Retention', exact: true }).click();
    await expect(header(page, 'Retention')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await names(page)).slice(-4)).toEqual(['Student 10', 'Student 20', 'Student 30', 'Student 40']);

    // Pages, by the pager's buttons.
    await pageSize(page).selectOption('10');
    await expect.poll(() => names(page)).toHaveLength(10);
    const next = panel(page).getByRole('button', { name: 'Next', exact: true });
    const previous = panel(page).getByRole('button', { name: 'Previous', exact: true });
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await next.click();
    await expect(panel(page).getByText('11–20 of 40')).toBeVisible();
    await next.click();
    await next.click();
    await expect(panel(page).getByText('31–40 of 40')).toBeVisible();
    // On the last page the button stays, and keeps the keyboard's place: pressing it does nothing.
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    // (Safari does not focus a clicked button: focus it as a keyboard would have.)
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).getByText('31–40 of 40')).toBeVisible();
    await expect(next).toBeFocused();
    await previous.click();
    await expect(panel(page).getByText('21–30 of 40')).toBeVisible();

    await search.fill('student');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'User Activity' })).toBeVisible();
    await expect(pageSize(page)).toHaveValue('10');
    await expect.poll(() => names(page)).toHaveLength(10);
    await expect(header(page, 'Retention')).toHaveAttribute('aria-sort', 'ascending');
    await expect(panel(page).getByLabel('Search users')).toHaveValue('');
    await expect(panel(page).getByText('1–10 of 40')).toBeVisible();
  });

  test('a name opens the user’s page; Back returns to the Dashboard as it was, focused on the name', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin');
    const search = panel(page).getByLabel('Search users');
    await search.fill('student');
    await expect(panel(page).getByText('1–25 of 38')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();

    const link = panel(page).getByRole('link', { name: 'Student 07' });
    await expect(link).toHaveAttribute('href', '/admin/users/7?from=dashboard&q=student&page=2');
    // A real link, from the keyboard too.
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/users\/7\?from=dashboard&q=student&page=2$/);
    await expect(page.getByRole('heading', { name: 'Student 07', level: 2 })).toBeFocused();
    for (const section of ['Flashcards', 'Conjugation', 'Labs', 'Speaking']) {
      await expect(page.getByRole('region', { name: section, exact: true })).toBeVisible();
    }
    // The page belongs to the tab it came from.
    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Users' })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to users/ })).toHaveCount(0);

    // The browser's Back, the first time round (its history entry holds nothing for this).
    await page.goBack();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(search).toHaveValue('student');
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'Student 07' })).toBeFocused();

    // The page's own Back link: the same, with the search and page in its URL.
    await panel(page).getByRole('link', { name: 'Student 07' }).click();
    await expect(page.getByRole('heading', { name: 'Student 07', level: 2 })).toBeVisible();
    await page.getByRole('link', { name: /Back to dashboard/ }).click();
    await expect(page).toHaveURL(/\/admin\?tab=dashboard&q=student&page=2$/);
    await expect(search).toHaveValue('student');
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'Student 07' })).toBeFocused();

    // Focus is given back once: another tab and back leaves it on the tab pressed.
    await page.getByRole('button', { name: 'Groups' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Dashboard' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeFocused();

    // A reload keeps what the Back link brought; a new search is the panel's own, and leaves the URL.
    await page.reload();
    await expect(search).toHaveValue('student');
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();
    await search.fill('student 1');
    await expect(page).toHaveURL(/\/admin\?tab=dashboard$/);
    await expect(panel(page).getByText('1–10 of 10')).toBeVisible();

    // Opened on its own (a new tab), the page still goes back to the Dashboard as the link left it.
    await page.goto('/admin/users/7?from=dashboard&q=student&page=2');
    await expect(page.getByRole('heading', { name: 'Student 07', level: 2 })).toBeVisible();
    await page.getByRole('link', { name: /Back to dashboard/ }).click();
    await expect(search).toHaveValue('student');
    await expect(panel(page).getByText('26–38 of 38')).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'Student 07' })).toBeFocused();
  });

  test('a click anywhere on a row opens that user’s page too', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin');
    const row = panel(page).getByRole('row', { name: /Student 39/ });
    await row.getByRole('cell').nth(2).click();
    await expect(page).toHaveURL(/\/admin\/users\/39\?from=dashboard$/);
    await expect(page.getByRole('heading', { name: 'Student 39', level: 2 })).toBeVisible();
  });
});

test.describe('admin users — a page at a time', () => {
  test('the Users tab pages too, and keeps its own page size', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin?tab=users&sort=name&dir=asc');
    const listed = () => page.locator('tbody a[id^="user-link-"]').allTextContents();
    await expect.poll(listed).toHaveLength(25);
    await expect(page.getByText('1–25 of 40')).toBeVisible();
    await expect(page.getByText('40 of 40 users')).toBeVisible();

    const status = page.getByText('26–40 of 40');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(status).toBeVisible();
    // A new page is announced (the count above does not change with it).
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect.poll(async () => (await listed()).at(-1)).toBe('Teacher');

    await pageSize(page).selectOption('50');
    await expect.poll(listed).toHaveLength(40);
    await page.reload();
    await expect(pageSize(page)).toHaveValue('50');
    // The URL still holds the sort.
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveAttribute('aria-sort', 'ascending');

    // The Dashboard keeps its own size.
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(pageSize(page)).toHaveValue('25');
  });

  test('Back from a user’s page loaded on its own finds their name on the page that holds it', async ({ page }) => {
    await mockClass(page);
    // Newest first, Student 05 is on page 2 of 25; a reload of their page has forgotten which page it was.
    await page.goto('/admin/users/5');
    await expect(page.getByRole('heading', { name: 'Student 05', level: 2 })).toBeVisible();
    await page.getByRole('link', { name: /Back to users/ }).click();
    await expect(page.getByText('26–40 of 40')).toBeVisible();
    await expect(page.locator('#user-link-5')).toBeFocused();
  });
});
