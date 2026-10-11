import { test, expect, type Page } from '@playwright/test';
import { mockAdminTrpc, sampleGroups, sampleUserDetail } from './support/trpcMock';

/**
 * The Groups tab's lists, as the Dashboard's User Activity: search, sortable
 * headers, 10 / 25 / 50 / All a page (remembered on this device, one list at
 * a time), and each student's name a link to their page, whose Back returns
 * to the group as the teacher left it.
 */

const day = (n: number) => Date.UTC(2026, 8, 1, 15) + n * 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Spanish Class (group 1): Ana López (101) and Student 02…30 (102…130), school IDs in their
 * emails (except Student 03's, typed by the teacher); joined on day n, last active on day 31 - n,
 * every tenth never. Student 30 is the teacher.
 */
const members = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  return {
    id: 100 + n,
    googleId: `g${n}`,
    name: n === 1 ? 'Ana López' : `Student ${pad(n)}`,
    email: n === 3 ? 'student03@school.test' : `${20000 + n}@school.test`,
    role: n === 30 ? 'admin' : 'user',
    picture: null,
    createdAt: new Date(day(n)).toISOString(),
    joinedAt: new Date(day(n)).toISOString(),
    lastActiveAt: n % 10 === 0 ? null : day(31 - n),
    studentNumber: n === 3 ? '77703' : String(20000 + n),
  };
});

/** Everyone the "Add students" list can offer: the members, and twelve who are not in the group. */
const everyone = [
  ...members,
  ...Array.from({ length: 12 }, (_, i) => ({
    id: 200 + i + 1, googleId: `n${i + 1}`, name: `Newcomer ${pad(i + 1)}`, email: `${30000 + i + 1}@school.test`, role: 'user',
    picture: null, createdAt: new Date(day(40)).toISOString(), lastActiveAt: null, studentNumber: String(30000 + i + 1),
  })),
];

/** Twelve assigned decks: Unidad 01…12, with 10·n cards. */
const groupDecks = Array.from({ length: 12 }, (_, i) => ({
  id: 300 + i + 1, name: `Unidad ${pad(i + 1)}`, description: null, cardCount: (i + 1) * 10, reversible: false,
}));

const cell = (deckId: number, extra: Record<string, unknown> = {}) => ({
  deckId, finishedAt: null, finishes: 0, newCards: 0, reviews: 0, answers: 0, minutes: 0, newLimit: 20, lowLimit: false, ...extra,
});
/** "Flashcards by day" for the thirty: even ones finished Unidad 01 (the later ones with more answers). */
const flashcardDay = {
  day: '2026-09-25',
  groupNewLimit: 20,
  decks: [{ id: 301, name: 'Unidad 01' }, { id: 302, name: 'Unidad 02' }],
  students: members.map((m, i) => ({
    id: m.id, name: m.name, email: m.email,
    cells: [
      (i + 1) % 2 === 0
        ? cell(301, { finishedAt: Date.parse('2026-09-25T20:00:00Z') + i * 60_000, finishes: 1, newCards: 20, answers: 30 + i })
        : cell(301),
      cell(302),
    ],
  })),
};

async function mockGroup(page: Page, added: unknown[] = [], groups: unknown[] = sampleGroups) {
  await mockAdminTrpc(page, {
    groups,
    users: everyone,
    groupMembers: members,
    groupDecks,
    decks: groupDecks,
    flashcardDay,
    queries: {
      'admin.userDetail': (input: unknown) => {
        const userId = (input as { userId: number }).userId;
        const member = members.find((m) => m.id === userId)!;
        const detail = sampleUserDetail(2);
        return { ...detail, user: { ...detail.user, id: userId, name: member.name, email: member.email } };
      },
    },
    mutations: {
      'admin.addUsersToGroup': (input: unknown) => {
        added.push(input);
        const requested = (input as { userIds: number[] }).userIds.length;
        return { success: true, requested, added: requested, settingsApplied: 0 };
      },
    },
  });
}

const membersRegion = (page: Page) => page.getByRole('region', { name: 'Members' });
const memberTable = (page: Page) => membersRegion(page).getByRole('table', { name: 'Members' });
const memberNames = (page: Page) => memberTable(page).locator('tbody a').allTextContents();
/**
 * A list's page size and its Previous and Next, found by the list's name: several lists
 * share the Groups tab (the Members card holds "Add students" too), and each pager says
 * whose it is ("Members Show per page"; Next in the group "Members 1–25 of 30").
 */
const pageSize = (page: Page, list: string) => page.getByRole('combobox', { name: `${list} Show per page`, exact: true });
const pagerButton = (page: Page, list: string, name: 'Next' | 'Previous') => page
  .getByRole('group', { name: new RegExp(`^${list} (\\d|No )`) })
  .getByRole('button', { name, exact: true });
const memberPageSize = (page: Page) => pageSize(page, 'Members');
const memberNext = (page: Page) => pagerButton(page, 'Members', 'Next');

test.describe('admin groups — the members list', () => {
  test('searches, sorts and pages; the page size and sort outlast a reload, the search does not', async ({ page }) => {
    await mockGroup(page);
    await page.goto('/admin?tab=groups&group=1');
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();

    // 25 at a time, by name.
    await expect.poll(() => memberNames(page)).toHaveLength(25);
    await expect(membersRegion(page).getByText('1–25 of 30')).toBeVisible();
    await expect(memberTable(page).getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await memberNames(page)).slice(0, 2)).toEqual(['Ana López', 'Student 02']);

    // Names (accents or not), emails, school IDs (typed ones too).
    const search = membersRegion(page).getByLabel('Search members');
    await search.fill('lopez');
    await expect.poll(() => memberNames(page)).toEqual(['Ana López']);
    await search.fill('20017');
    await expect.poll(() => memberNames(page)).toEqual(['Student 17']);
    await search.fill('77703');
    await expect.poll(() => memberNames(page)).toEqual(['Student 03']);
    await search.fill('nobody');
    await expect(memberTable(page).getByRole('cell', { name: 'No members match' })).toBeVisible();
    await search.fill('');

    // The most recently active first; never active last, whichever way.
    const lastActive = memberTable(page).getByRole('button', { name: 'Last Active' });
    await lastActive.click();
    await expect(memberTable(page).getByRole('columnheader', { name: 'Last Active' })).toHaveAttribute('aria-sort', 'descending');
    await expect(memberTable(page).locator('th[aria-sort]')).toHaveCount(1);
    await expect.poll(async () => (await memberNames(page)).slice(0, 2)).toEqual(['Ana López', 'Student 02']);
    await memberPageSize(page).selectOption('all');
    await expect.poll(async () => (await memberNames(page)).slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
    // From the keyboard, the other way.
    await lastActive.focus();
    await page.keyboard.press('Enter');
    await expect(memberTable(page).getByRole('columnheader', { name: 'Last Active' })).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await memberNames(page))[0]).toBe('Student 29');
    await expect.poll(async () => (await memberNames(page)).slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
    // The teacher is marked as one.
    await expect(memberTable(page).getByRole('row', { name: /Student 30/ }).getByText('Admin', { exact: true })).toBeVisible();

    // Ten a page, by the pager's buttons.
    await memberPageSize(page).selectOption('10');
    await expect.poll(() => memberNames(page)).toHaveLength(10);
    await memberNext(page).click();
    await expect(membersRegion(page).getByText('11–20 of 30')).toBeVisible();

    await search.fill('student');
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();
    await expect(memberPageSize(page)).toHaveValue('10');
    await expect.poll(() => memberNames(page)).toHaveLength(10);
    await expect(memberTable(page).getByRole('columnheader', { name: 'Last Active' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(membersRegion(page).getByLabel('Search members')).toHaveValue('');
    await expect(membersRegion(page).getByText('1–10 of 30')).toBeVisible();
    // Each list keeps its own size: the decks still show 25 at a time.
    await expect(pageSize(page, 'Assigned Decks')).toHaveValue('25');
    // Every page-size box on the tab has a name of its own.
    const names = await page.getByRole('combobox', { name: /Show per page$/ }).evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-labelledby')!.split(' ')[0]));
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  test('a name opens the student’s page; Back returns to the group as it was, focused on the name', async ({ page }) => {
    await mockGroup(page);
    await page.goto('/admin?tab=groups&group=1');
    const search = membersRegion(page).getByLabel('Search members');
    await search.fill('student');
    await expect(membersRegion(page).getByText('1–25 of 29')).toBeVisible();
    await memberNext(page).click();
    await expect(membersRegion(page).getByText('26–29 of 29')).toBeVisible();

    const link = memberTable(page).getByRole('link', { name: 'Student 28' });
    await expect(link).toHaveAttribute('href', '/admin/users/128?from=group&group=1');
    // A real link, from the keyboard too.
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/users\/128\?from=group&group=1$/);
    await expect(page.getByRole('heading', { name: 'Student 28', level: 2 })).toBeFocused();
    // The page belongs to the Groups tab, and says which group Back goes to.
    await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to users/ })).toHaveCount(0);
    await expect(membersRegion(page)).toHaveCount(0);

    // The browser's Back.
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\?tab=groups&group=1$/);
    await expect(search).toHaveValue('student');
    await expect(membersRegion(page).getByText('26–29 of 29')).toBeVisible();
    await expect(memberTable(page).getByRole('link', { name: 'Student 28' })).toBeFocused();

    // The page's own Back link: the same.
    await memberTable(page).getByRole('link', { name: 'Student 28' }).click();
    await expect(page.getByRole('heading', { name: 'Student 28', level: 2 })).toBeVisible();
    await page.getByRole('link', { name: '← Back to Spanish Class' }).click();
    await expect(page).toHaveURL(/\/admin\?tab=groups&group=1$/);
    await expect(search).toHaveValue('student');
    await expect(membersRegion(page).getByText('26–29 of 29')).toBeVisible();
    await expect(memberTable(page).getByRole('link', { name: 'Student 28' })).toBeFocused();

    // A click anywhere on a row opens the page too.
    await memberTable(page).getByRole('row', { name: /Student 27/ }).getByRole('cell').nth(2).click();
    await expect(page).toHaveURL(/\/admin\/users\/127\?from=group&group=1$/);

    // Opened on its own (a new tab), the page still goes back to the group, to the page that holds the name.
    await page.goto('/admin/users/126?from=group&group=1');
    await expect(page.getByRole('heading', { name: 'Student 26', level: 2 })).toBeVisible();
    await page.getByRole('link', { name: '← Back to Spanish Class' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();
    await expect(membersRegion(page).getByText('26–30 of 30')).toBeVisible();
    await expect(memberTable(page).getByRole('link', { name: 'Student 26' })).toBeFocused();
  });

  test('"Add students" says how many its buttons tick, and adds them all', async ({ page }) => {
    const added: unknown[] = [];
    await mockGroup(page, added);
    await page.goto('/admin?tab=groups&group=1');
    const add = page.getByRole('group', { name: 'Add students', exact: true });
    // Ten at first (it sits above the members); "this page" and "all" say how many each ticks.
    await expect(add.getByRole('checkbox')).toHaveCount(10);
    await expect(add.getByText('1–10 of 12')).toBeVisible();
    await add.getByRole('button', { name: 'Select this page (10)' }).click();
    await expect(add.getByText('10 selected', { exact: true })).toBeVisible();
    // Ticks out of sight are counted as such.
    await pagerButton(page, 'Add students', 'Next').click();
    await expect(add.getByText('10 selected (10 not shown)')).toBeVisible();
    // Clear keeps the keyboard's focus.
    const clear = add.getByRole('button', { name: 'Clear selection' });
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(add.getByText('0 selected', { exact: true })).toBeVisible();
    await expect(clear).toBeFocused();
    await add.getByLabel('Search users').fill('newcomer 1');
    await add.getByRole('button', { name: 'Select all 3 matching' }).click();
    await expect(add.getByText('3 selected', { exact: true })).toBeVisible();
    await add.getByLabel('Search users').fill('');
    await add.getByRole('button', { name: 'Select all 12' }).click();
    await expect(add.getByText('12 selected (2 not shown)')).toBeVisible();
    await add.getByRole('button', { name: 'Add selected' }).click();
    await expect(page.getByText('Added 12 user(s) to the group.')).toBeVisible();
    expect(added).toHaveLength(1);
    expect(((added[0] as { userIds: number[] }).userIds).sort((a, b) => a - b)).toEqual(everyone.slice(30).map((u) => u.id));
  });

  test('another group starts "Add students" again: one list, nothing ticked, adding to the group on screen', async ({ page }) => {
    const added: unknown[] = [];
    await mockGroup(page, added, [...sampleGroups, { id: 2, name: 'Period 2', description: null, memberCount: 30, deckCount: 12 }]);
    await page.goto('/admin?tab=groups&group=1');
    const add = page.getByRole('group', { name: 'Add students', exact: true });
    await add.getByRole('checkbox', { name: /Newcomer 01/ }).check();
    await expect(add.getByText('1 selected', { exact: true })).toBeVisible();

    await page.getByRole('table', { name: 'Groups' }).getByRole('button', { name: 'Period 2' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Period 2' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\?tab=groups&group=2$/);
    await expect(add).toHaveCount(1);
    await expect(add.getByText('0 selected', { exact: true })).toBeVisible();
    await expect(add.getByRole('button', { name: 'Add selected' })).toBeDisabled();
    await expect(page.getByRole('table', { name: 'Members' })).toHaveCount(1);

    await add.getByRole('checkbox', { name: /Newcomer 02/ }).check();
    await add.getByRole('button', { name: 'Add selected' }).click();
    await expect(page.getByText('Added 1 user(s) to the group.')).toBeVisible();
    expect(added).toEqual([{ groupId: 2, userIds: [202] }]);
  });

  test('the Groups tab button on a student\'s page keeps the group in the URL, for a reload', async ({ page }) => {
    await mockGroup(page);
    await page.goto('/admin?tab=groups&group=1');
    await memberTable(page).getByRole('link', { name: 'Student 02' }).click();
    await expect(page.getByRole('heading', { name: 'Student 02', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?tab=groups&group=1$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();
  });
});

test.describe('admin groups — assigned decks and flashcards by day', () => {
  test('the decks: search, sort and page; a name opens the deck on the Decks tab, and Back returns to the group', async ({ page }) => {
    await mockGroup(page);
    await page.goto('/admin?tab=groups&group=1');
    const decks = page.getByRole('region', { name: 'Assigned Decks' });
    const names = () => decks.locator('tbody a').allTextContents();
    await expect.poll(names).toHaveLength(12);
    await expect(decks.getByRole('columnheader', { name: 'Deck' })).toHaveAttribute('aria-sort', 'ascending');

    await decks.getByRole('button', { name: 'Cards', exact: true }).click();
    await expect(decks.getByRole('columnheader', { name: 'Cards' })).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await names()).slice(0, 2)).toEqual(['Unidad 12', 'Unidad 11']);
    await decks.getByLabel('Search decks').fill('unidad 1');
    await expect.poll(names).toEqual(['Unidad 12', 'Unidad 11', 'Unidad 10']);
    await decks.getByLabel('Search decks').fill('');
    await pageSize(page, 'Assigned Decks').selectOption('10');
    await expect.poll(names).toHaveLength(10);
    await pagerButton(page, 'Assigned Decks', 'Next').click();
    await expect.poll(names).toEqual(['Unidad 02', 'Unidad 01']);

    const link = decks.getByRole('link', { name: 'Unidad 02' });
    await expect(link).toHaveAttribute('href', '/admin?tab=decks&deck=302');
    await link.click();
    await expect(page).toHaveURL(/\/admin\?tab=decks&deck=302$/);
    await expect(page.getByRole('button', { name: 'Decks', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: 'Unidad 02' })).toBeFocused();

    await page.goBack();
    await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: 'Spanish Class' })).toBeVisible();
    // Its own page size and sort, remembered; focus on the deck's name again, on the page that holds it.
    await expect(pageSize(page, 'Assigned Decks')).toHaveValue('10');
    await expect(decks.getByText('11–12 of 12')).toBeVisible();
    await expect(decks.getByRole('link', { name: 'Unidad 02' })).toBeFocused();
  });

  test('flashcards by day: search, sort by a deck, page; a name opens the student’s page and Back returns', async ({ page }) => {
    await mockGroup(page);
    await page.goto('/admin?tab=groups&group=1');
    const section = page.getByRole('region', { name: 'Flashcards by day' });
    const table = section.getByRole('table', { name: 'Flashcards by day' });
    const names = () => table.locator('tbody a').allTextContents();
    await expect.poll(names).toHaveLength(25);
    await expect(table.getByRole('columnheader', { name: /^Student/ })).toHaveAttribute('aria-sort', 'ascending');
    await expect(table.getByRole('columnheader', { name: /Unidad 01/ })).toContainText('15 of 30 finished');

    await section.getByLabel('Search students', { exact: true }).fill('student 2');
    await expect.poll(names).toHaveLength(10);
    await section.getByLabel('Search students', { exact: true }).fill('');

    // Finished first (the most answers first), the ones who did nothing last.
    await table.getByRole('button', { name: 'Unidad 01' }).click();
    await expect(table.getByRole('columnheader', { name: /Unidad 01/ })).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await names()).slice(0, 2)).toEqual(['Student 30', 'Student 28']);
    await pageSize(page, 'Flashcards by day').selectOption('10');
    await expect.poll(names).toHaveLength(10);
    await pagerButton(page, 'Flashcards by day', 'Next').click();
    await expect(section.getByText('11–20 of 30')).toBeVisible();

    const link = table.getByRole('link', { name: 'Student 10' });
    await expect(link).toHaveAttribute('href', '/admin/users/110?from=group&group=1');
    await link.click();
    await expect(page.getByRole('heading', { name: 'Student 10', level: 2 })).toBeFocused();
    await page.getByRole('link', { name: '← Back to Spanish Class' }).click();
    await expect(section.getByText('11–20 of 30')).toBeVisible();
    await expect(table.getByRole('link', { name: 'Student 10' })).toBeFocused();

    // The size and the sort outlast a reload.
    await page.reload();
    await expect(pageSize(page, 'Flashcards by day')).toHaveValue('10');
    await expect(table.getByRole('columnheader', { name: /Unidad 01/ })).toHaveAttribute('aria-sort', 'descending');
  });
});
