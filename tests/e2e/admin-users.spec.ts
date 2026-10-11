import { test, expect, type Page } from '@playwright/test';
import { TrpcMockError, mockAdminTrpc, sampleUserDetail } from './support/trpcMock';

test.describe('admin panel — users', () => {
  test('users table header "User" is visible on users tab', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
  });

  test('users table header "Role" is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();
  });

  test('users table header "Actions" is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible();
  });

  test('user names from sampleUsers are visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByText('Jane Doe')).toBeVisible();
    await expect(page.getByText('Bob Smith')).toBeVisible();
  });

  test('"Promote" button is visible for non-admin user (Jane Doe)', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    // Jane Doe (id:2) has role 'user' so her row shows Promote
    const janeRow = page.locator('tr').filter({ hasText: 'Jane Doe' });
    await expect(janeRow.getByRole('button', { name: 'Promote' })).toBeVisible();
  });

  test('"Demote" button is visible for admin user (Bob Smith)', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    // Bob Smith (id:3) has role 'admin' so his row shows Demote
    const bobRow = page.locator('tr').filter({ hasText: 'Bob Smith' });
    await expect(bobRow.getByRole('button', { name: 'Demote' })).toBeVisible();
  });

  test('"History" button is visible in users list', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByRole('button', { name: 'History' }).first()).toBeVisible();
  });

  test('"Settings" button is visible in users list', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    await expect(page.getByRole('button', { name: 'Settings' }).first()).toBeVisible();
  });

  test('clicking Promote triggers a confirm dialog', async ({ page }) => {
    await mockAdminTrpc(page);

    let dialogMessage = '';
    page.on('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.accept();
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    // Jane Doe has role 'user' — her Promote button triggers the confirm dialog
    const janeRow = page.locator('tr').filter({ hasText: 'Jane Doe' });
    await janeRow.getByRole('button', { name: 'Promote' }).click();

    expect(dialogMessage).toContain('Jane Doe');
    expect(dialogMessage).toContain('admin');
  });

  test('after confirming Promote, the UI remains functional without errors', async ({ page }) => {
    await mockAdminTrpc(page);

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Users' }).click();

    const janeRow = page.locator('tr').filter({ hasText: 'Jane Doe' });
    await janeRow.getByRole('button', { name: 'Promote' }).click();

    // After accepting the dialog the page should still show the users table
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// v1.15.0: search, sort, and a page per user
// ---------------------------------------------------------------------------

const day = (iso: string) => Date.parse(`${iso}T15:00:00.000Z`);
const classUsers = [
  { id: 2, name: 'Ana López', email: '12345@students.school.test', role: 'user', picture: null, createdAt: '2026-08-10T00:00:00.000Z', lastActiveAt: day('2026-09-26'), studentNumber: '12345' },
  // The teacher set Beto's school ID by hand: it is not the one in the email.
  { id: 3, name: 'Beto Ruiz', email: '23456@students.school.test', role: 'user', picture: null, createdAt: '2026-08-20T00:00:00.000Z', lastActiveAt: day('2026-09-20'), studentNumber: '99999' },
  { id: 4, name: 'Carla Díaz', email: 'carla@school.test', role: 'admin', picture: null, createdAt: '2026-08-01T00:00:00.000Z', lastActiveAt: null, studentNumber: null },
];
const limitsFor = (userId: number, studiedToday: number) => ({
  userId, userName: classUsers.find((u) => u.id === userId)!.name, email: classUsers.find((u) => u.id === userId)!.email,
  newCardsPerDay: 20, reviewsPerDay: 100, isOverride: userId === 2, allowHigher: true, allowLower: false,
  aiEnabled: true, aiEnabledLocked: false, autoPlayAudio: false, autoPlayAudioLocked: false,
  autoPlayAudioFront: false, autoPlayAudioFrontLocked: false, mnemonicMode: 'manual', mnemonicModeLocked: false,
  locale: null, localeLocked: false,
  newCardsDoneToday: Math.min(20, studiedToday), reviewsDoneToday: Math.max(0, studiedToday - 20),
  decksToday: studiedToday > 20 ? 2 : studiedToday > 0 ? 1 : 0, studiedToday,
});
const classSettings = [limitsFor(2, 45), limitsFor(3, 5), limitsFor(4, 0)];

async function mockClass(page: Page) {
  await mockAdminTrpc(page, {
    users: classUsers,
    userSettings: classSettings,
    queries: {
      'admin.userDetail': (input: unknown) => {
        const userId = (input as { userId: number }).userId;
        const user = classUsers.find((u) => u.id === userId)!;
        const detail = sampleUserDetail(2);
        return { ...detail, user: { ...detail.user, ...user, createdAt: Date.parse(user.createdAt) } };
      },
      'admin.getUserReviewHistory': { reviews: [], total: 0 },
    },
  });
}

/** The header the list is sorted by (hidden columns included: a phone shows fewer). */
const sortedBy = (page: Page) => page.locator('thead th[aria-sort]');

/** The names in the Users table, top to bottom. */
const listedNames = (page: Page) => page.locator('tbody a[id^="user-link-"]').allTextContents();

test.describe('admin panel — users: search, sort and a page per user', () => {
  test('one box searches names, emails and school IDs, and says how many match', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin?tab=users');
    const search = page.getByLabel('Search users');
    await expect(page.getByText('3 of 3 users')).toBeVisible();

    await search.fill('ana');
    await expect(page.getByText('1 of 3 users')).toBeVisible();
    await expect.poll(() => listedNames(page)).toEqual(['Ana López']);
    await expect(page).toHaveURL(/[?&]q=ana(&|$)/);

    // The school ID the teacher set, not only the email's digits.
    await search.fill('99999');
    await expect.poll(() => listedNames(page)).toEqual(['Beto Ruiz']);
    await search.fill('carla@school');
    await expect.poll(() => listedNames(page)).toEqual(['Carla Díaz']);
    await search.fill('nobody');
    await expect(page.getByText('0 of 3 users')).toBeVisible();
    await expect(page.getByText('No matching users.')).toBeVisible();

    await search.fill('');
    await expect(page.getByText('3 of 3 users')).toBeVisible();
  });

  test('the search box keeps every key typed quickly, and an edit in the middle, while the URL follows', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin?tab=users');
    const search = page.getByLabel('Search users');
    await search.click();
    // Key by key, faster than a teacher types; the URL updates in a transition behind the box.
    await search.pressSequentially('carla di', { delay: 20 });
    await expect(search).toHaveValue('carla di');
    await expect(page).toHaveURL(/[?&]q=carla(\+|%20)di(&|$)/);
    // Accents are not needed: "di" finds Díaz.
    await expect.poll(() => listedNames(page)).toEqual(['Carla Díaz']);

    // Fix a typo in the middle: the cursor stays where it is.
    await search.fill('abcdef');
    await search.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await search.pressSequentially('XY', { delay: 20 });
    await expect(search).toHaveValue('abXYcdef');
    await expect(page).toHaveURL(/[?&]q=abXYcdef(&|$)/);
  });

  test('column headers sort the list, say how with aria-sort, work from the keyboard, and keep the order in the URL', async ({ page }) => {
    await mockClass(page);
    await page.goto('/admin?tab=users');
    // Newest first, as always.
    await expect(sortedBy(page)).toHaveCount(1);
    await expect(sortedBy(page)).toHaveText(/Joined/);
    await expect(sortedBy(page)).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => listedNames(page)).toEqual(['Beto Ruiz', 'Ana López', 'Carla Díaz']);

    const byName = page.getByRole('button', { name: 'User', exact: true });
    await byName.click();
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(sortedBy(page)).toHaveCount(1);
    await expect.poll(() => listedNames(page)).toEqual(['Ana López', 'Beto Ruiz', 'Carla Díaz']);
    await expect(page).toHaveURL(/sort=name&dir=asc/);

    // Again, from the keyboard: the other way.
    await byName.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => listedNames(page)).toEqual(['Carla Díaz', 'Beto Ruiz', 'Ana López']);

    await page.getByRole('button', { name: 'Role', exact: true }).click();
    await expect.poll(() => listedNames(page)).toEqual(['Carla Díaz', 'Ana López', 'Beto Ruiz']);

    // The URL holds it: last active (never active last), and what was studied today (most first).
    await page.goto('/admin?tab=users&sort=active&dir=desc');
    await expect.poll(() => listedNames(page)).toEqual(['Ana López', 'Beto Ruiz', 'Carla Díaz']);
    await expect(sortedBy(page)).toHaveText(/Last Active/);
    await expect(sortedBy(page)).toHaveAttribute('aria-sort', 'descending');
    await page.goto('/admin?tab=users&sort=today&dir=asc');
    await expect.poll(() => listedNames(page)).toEqual(['Carla Díaz', 'Beto Ruiz', 'Ana López']);
  });

  test('today’s progress is the most in one deck, and says how many decks', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 1024, "Today's Progress is shown from a laptop's width up");
    await mockClass(page);
    await page.goto('/admin?tab=users');
    const ana = page.getByRole('row', { name: /Ana López/ });
    await expect(ana).toContainText('20/20 new, 25/100 reviews · in 2 deck(s)');
    await expect(ana.getByText('in 2 deck(s)', { exact: false })).toHaveAttribute('title', 'The most in any one deck. Limits are per deck.');
    await expect(page.getByRole('row', { name: /Beto Ruiz/ })).not.toContainText('deck(s)');
  });

  test('a name opens the user’s page; Back keeps the search and sort and returns focus to the name', async ({ page }) => {
    await mockClass(page);
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto('/admin?tab=users&sort=name&dir=asc&q=l');
    await expect.poll(() => listedNames(page)).toEqual(['Ana López', 'Beto Ruiz', 'Carla Díaz']);

    await page.getByRole('link', { name: 'Ana López' }).click();
    await expect(page).toHaveURL(/\/admin\/users\/2\?sort=name&dir=asc&q=l$/);
    const name = page.getByRole('heading', { name: 'Ana López', level: 2 });
    await expect(name).toBeFocused();
    // Wide tables scroll in their own boxes: the page itself never scrolls sideways, even on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Who they are.
    await expect(page.getByText('12345@students.school.test')).toBeVisible();
    await expect(page.getByText('School ID')).toBeVisible();
    await expect(page.getByText('Spanish Class')).toBeVisible();
    await expect(page.getByText('User can set higher')).toBeVisible();
    // Their work, one section each.
    for (const section of ['Flashcards', 'Conjugation', 'Labs', 'Speaking']) {
      await expect(page.getByRole('region', { name: section, exact: true })).toBeVisible();
    }
    const flashcards = page.getByRole('region', { name: 'Flashcards', exact: true });
    await expect(flashcards.getByRole('rowheader', { name: 'Spanish Vocabulary' })).toBeVisible();
    await expect(flashcards).toContainText('120 of 500');
    await expect(flashcards).toContainText('5/20 new, 30/100 reviews');
    const labs = page.getByRole('region', { name: 'Labs', exact: true });
    await expect(labs.getByRole('row', { name: /semana01/ })).toContainText('Done');
    await expect(labs.getByRole('row', { name: /semana01/ })).toContainText('18 of 20');
    await expect(labs.getByRole('row', { name: /semana02/ })).toContainText('Check it · No microphone');
    await expect(page.getByRole('region', { name: 'Speaking', exact: true })).toContainText('84 out of 100');

    // The list's actions work from here too.
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('Review History for Ana López')).toBeVisible();
    await page.getByRole('button', { name: '×' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Settings for Ana López' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Promote' }).click();
    expect(dialogs).toEqual(['Are you sure you want to promote Ana López to admin?']);

    await page.getByRole('link', { name: /Back to users/ }).click();
    await expect(page).toHaveURL(/\/admin\?.*sort=name&dir=asc&q=l/);
    await expect(page.getByLabel('Search users')).toHaveValue('l');
    await expect(page.locator('#user-link-2')).toBeFocused();
  });

  test('a user who does not exist says so, with the way back', async ({ page }) => {
    await mockAdminTrpc(page, {
      queries: { 'admin.userDetail': () => { throw new TrpcMockError('User not found', 'NOT_FOUND', 404); } },
    });
    await page.goto('/admin/users/999');
    await expect(page.getByRole('alert')).toHaveText('User not found');
    await page.getByRole('link', { name: /Back to users/ }).click();
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
  });
});
