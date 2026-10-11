import { test, expect } from '@playwright/test';
import { mockAdminTrpc, sampleGroups, sampleUsers } from './support/trpcMock';

const sampleGroupSettings = {
  newCardsPerDay: 20,
  reviewsPerDay: 100,
  isOverride: false,
  allowHigher: false,
  allowLower: false,
  aiEnabled: false,
  aiEnabledLocked: false,
  autoPlayAudio: false,
  autoPlayAudioLocked: false,
  autoPlayAudioFront: false,
  autoPlayAudioFrontLocked: false,
  mnemonicMode: 'manual',
  mnemonicModeLocked: false,
  locale: null,
  localeLocked: false,
};

test.describe('admin panel — groups', () => {
  test('"Groups" heading is visible on groups tab', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  });

  test('group names from sampleGroups are visible', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await expect(page.getByText('All')).toBeVisible();
    await expect(page.getByText('Spanish Class')).toBeVisible();
  });

  test('"+ New Group" button is visible', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await expect(page.getByRole('button', { name: '+ New Group' })).toBeVisible();
  });

  test('"Import from Classroom" button is visible', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await expect(page.getByRole('button', { name: 'Import from Classroom' })).toBeVisible();
  });

  test('clicking "+ New Group" opens create form with Group name input', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: '+ New Group' }).click();

    await expect(page.getByPlaceholder('Group name')).toBeVisible();
  });

  test('create form has Description field', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: '+ New Group' }).click();

    await expect(page.getByPlaceholder('Description (optional)')).toBeVisible();
  });

  test('"Cancel" button in create form closes the form', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: '+ New Group' }).click();
    await expect(page.getByPlaceholder('Group name')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('Group name')).not.toBeVisible();
  });

  test('clicking a group selects it and shows "Members" section', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();

    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  });

  test('"No members yet" text shows when group has no members', async ({ page }) => {
    await mockAdminTrpc(page, { groupMembers: [] });
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();

    await expect(page.getByText('No members yet')).toBeVisible();
  });

  test('"No decks assigned yet" text shows when group has no decks', async ({ page }) => {
    await mockAdminTrpc(page, { groupDecks: [] });
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();

    await expect(page.getByText('No decks assigned yet')).toBeVisible();
  });

  test('"Settings" button is visible when a group is selected', async ({ page }) => {
    await mockAdminTrpc(page, { groupSettings: sampleGroupSettings });
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  });

  test('clicking "Settings" opens the group settings modal', async ({ page }) => {
    await mockAdminTrpc(page, { groupSettings: sampleGroupSettings });
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByText('Group Settings: Spanish Class')).toBeVisible();
  });

  test('"Close" button in settings modal closes it', async ({ page }) => {
    await mockAdminTrpc(page, { groupSettings: sampleGroupSettings });
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Group Settings: Spanish Class')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByText('Group Settings: Spanish Class')).not.toBeVisible();
  });

  test('"Delete Group" button is visible for "Spanish Class" group', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'Spanish Class' }).click();

    await expect(page.getByRole('button', { name: 'Delete Group' })).toBeVisible();
  });

  test('"Delete Group" button is NOT present for the "All" group', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');

    await page.getByRole('button', { name: 'All' }).click();

    await expect(page.getByRole('button', { name: 'Delete Group' })).not.toBeVisible();
  });
});

test.describe('admin panel — a group’s flashcards by day', () => {
  const at = (iso: string) => Date.parse(iso);
  const cell = (deckId: number, extra: Record<string, unknown> = {}) => ({
    deckId, finishedAt: null, finishes: 0, newCards: 0, reviews: 0, answers: 0, minutes: 0, newLimit: 20, lowLimit: false, ...extra,
  });
  const grid = (day: string) => ({
    day,
    groupNewLimit: 20,
    decks: [{ id: 1, name: 'Unidad 1' }, { id: 2, name: 'Unidad 2' }],
    students: [
      {
        id: 2, name: 'Ana López', email: '12345@students.school.test',
        // Unidad 2 not finished: not all her flashcards (v1.18.0).
        allDone: null,
        cells: [
          cell(1, { finishedAt: at(`${day}T22:15:00Z`), finishes: 1, newCards: 20, answers: 34, minutes: 12 }),
          cell(2, { newCards: 5, answers: 9, minutes: 3, newLimit: 10, lowLimit: true }),
        ],
      },
      { id: 3, name: 'Beto Ruiz', email: '23456@students.school.test', allDone: null, cells: [cell(1), cell(2)] },
      {
        id: 4, name: 'Carla Díaz', email: '34567@students.school.test',
        allDone: at(`${day}T23:05:00Z`),
        cells: [
          cell(1, { finishedAt: at(`${day}T22:40:00Z`), finishes: 1, newCards: 20, answers: 30, minutes: 10 }),
          cell(2, { finishedAt: at(`${day}T23:05:00Z`), finishes: 1, newCards: 10, answers: 16, minutes: 5 }),
        ],
      },
    ],
  });

  test('who reached “All Done!” in each deck that day, what they did, and a limit below the group’s', async ({ page }) => {
    const asked: unknown[] = [];
    await mockAdminTrpc(page, {
      queries: {
        'admin.groupFlashcardDay': (input: unknown) => {
          asked.push(input);
          return grid((input as { day?: string }).day ?? '2026-09-25');
        },
      },
    });
    await page.goto('/admin?tab=groups');
    await page.getByRole('button', { name: 'Spanish Class' }).click();

    const section = page.getByRole('region', { name: 'Flashcards by day' });
    await expect(section).toContainText('A check means the student reached “All Done!” in that deck that day.');
    // Between the members and the decks.
    const headings = await page.getByRole('heading', { level: 3 }).allTextContents();
    expect(headings.indexOf('Members')).toBeLessThan(headings.indexOf('Flashcards by day'));
    expect(headings.indexOf('Flashcards by day')).toBeLessThan(headings.indexOf('Assigned Decks'));

    const table = section.getByRole('table', { name: 'Flashcards by day' });
    // "All flashcards" (v1.18.0) first, then the decks.
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    await expect(table.getByRole('columnheader').nth(1)).toContainText('All flashcards');
    await expect(table.getByRole('columnheader', { name: /All flashcards/ })).toContainText('1 of 3 finished');
    await expect(table.getByRole('columnheader', { name: /Unidad 1/ })).toContainText('2 of 3 finished');
    await expect(table.getByRole('columnheader', { name: /Unidad 2/ })).toContainText('1 of 3 finished');
    const ana = table.getByRole('row', { name: /Ana López/ });
    await expect(ana.getByRole('cell').nth(0)).toHaveText('—');
    await expect(ana.getByRole('cell').nth(1)).toContainText(/Finished \d{1,2}:\d{2}/);
    await expect(ana.getByRole('cell').nth(1)).toContainText('20 new · 34 answers');
    await expect(ana.getByRole('cell').nth(2)).toContainText('Not finished');
    await expect(ana.getByRole('cell').nth(2)).toContainText('5 new · 9 answers');
    await expect(ana.getByText('limit 10')).toHaveAttribute('title', "This student's new-card limit for this deck is 10, below the group's 20.");
    await expect(table.getByRole('row', { name: /Beto Ruiz/ }).getByRole('cell')).toHaveText(['—', '—', '—']);
    const carla = table.getByRole('row', { name: /Carla Díaz/ });
    await expect(carla.getByTestId('all-flashcards-cell')).toContainText(/Finished \d{1,2}:\d{2}/);
    await expect(carla.getByRole('cell')).toHaveCount(3);

    // Another day: one query for it.
    const dayInput = section.getByLabel('Day', { exact: true });
    await expect(dayInput).toHaveValue('2026-09-25');
    await dayInput.fill('2026-09-24');
    await expect.poll(() => asked.some((a) => (a as { day?: string }).day === '2026-09-24')).toBe(true);
    await expect(dayInput).toHaveValue('2026-09-24');
    expect(asked[0]).toEqual({ groupId: 1 });
  });

  test('a group with no decks says so', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');
    await page.getByRole('button', { name: 'Spanish Class' }).click();
    await expect(page.getByRole('region', { name: 'Flashcards by day' })).toContainText('No decks are assigned to this group.');
  });

  test('adding students to a group with its Override on says its settings were applied to them', async ({ page }) => {
    const added: unknown[] = [];
    await mockAdminTrpc(page, {
      mutations: {
        'admin.addUsersToGroup': (input: unknown) => {
          added.push(input);
          const requested = (input as { userIds: number[] }).userIds.length;
          return { success: true, requested, added: requested, settingsApplied: requested };
        },
      },
    });
    await page.goto('/admin?tab=groups');
    await page.getByRole('button', { name: 'Spanish Class' }).click();
    await page.getByRole('checkbox', { name: new RegExp(sampleUsers[0].name) }).check();
    await page.getByRole('button', { name: 'Add selected' }).click();
    await expect(page.getByText("Added 1 user(s) to the group. The group's settings were applied to 1 of them.")).toBeVisible();
    expect(added).toEqual([{ groupId: 1, userIds: [sampleUsers[0].id] }]);
  });
});
