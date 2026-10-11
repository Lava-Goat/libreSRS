import { test, expect } from '@playwright/test';
import { mockAdminTrpc, mockAuthenticatedTrpc, mockPublicTrpc, TrpcMockError } from './support/trpcMock';

// Far enough ahead that none of these days has arrived.
const listed = { id: 1, title: 'Show and tell', open: true, picksPerStudent: 2, myDates: [] as string[] };

function sheetView(mine: number[] = []) {
  const day = (id: number, date: string, label: string, others: (string | null)[], capacity = 2, locked = false) => ({
    id,
    date,
    label,
    capacity,
    taken: others.length + (mine.includes(id) ? 1 : 0),
    locked,
    mine: mine.includes(id),
    assigned: false,
    people: [
      ...others.map((name) => ({ you: false, name })),
      ...(mine.includes(id) ? [{ you: true, name: 'Test U.' }] : []),
    ],
  });
  return {
    id: 1,
    title: 'Show and tell',
    description: 'Pick two days to present something you found.',
    open: true,
    picksPerStudent: 2,
    showNames: true,
    today: '2099-03-01',
    myCount: mine.length,
    dates: [
      day(10, '2000-01-03', 'Long ago', ['Ana R.', 'Beto S.'], 2, true),
      day(11, '2099-03-02', 'Day 31 · Rivers', ['Ana R.']),
      day(12, '2099-03-03', 'Day 32 · Volcanoes', ['Ana R.', null]),
      day(13, '2099-04-06', 'Day 50 · Experiments', []),
    ],
  };
}

test.describe('signing in from a sign-up link', () => {
  test('the login page remembers the sheet and hands it to the server', async ({ page }) => {
    await mockPublicTrpc(page, { authMe: null });
    let authUrl: string | null = null;
    await page.route('**/auth/google**', async (route, request) => {
      authUrl = request.url();
      await route.fulfill({ status: 200, body: 'google' });
    });

    await page.goto('/signups?sheet=1');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fsignups%3Fsheet%3D1$/);
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await expect.poll(() => authUrl).toContain('/auth/google?returnTo=%2Fsignups%3Fsheet%3D1');
  });

  test('a student already signed in goes straight on to the sheet', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { signupSheets: [listed], queries: { 'signups.get': sheetView() } });
    await page.goto('/login?returnTo=%2Fsignups%3Fsheet%3D1');
    await expect(page).toHaveURL(/\/signups\?sheet=1$/);
    await expect(page.getByRole('heading', { name: 'Show and tell' })).toBeVisible();
  });

  test('a returnTo off the site is ignored', async ({ page }) => {
    await mockAuthenticatedTrpc(page);
    await page.goto('/login?returnTo=%2F%2Fevil.example%2Fx');
    await expect(page).toHaveURL(/127\.0\.0\.1:4173\/$/);
  });
});

test.describe('student', () => {
  test('the dashboard card opens the sheet, and a day can be picked', async ({ page }) => {
    let mine: number[] = [];
    const claims: unknown[] = [];
    await mockAuthenticatedTrpc(page, {
      signupSheets: [listed],
      queries: { 'signups.get': () => sheetView(mine) },
      mutations: {
        'signups.claim': (input) => {
          claims.push(input);
          mine = [...mine, (input as { dateId: number }).dateId];
          return { success: true };
        },
      },
    });

    await page.goto('/');
    const card = page.getByRole('link', { name: /Sign-ups/ });
    await expect(card).toContainText('Pick your days: Show and tell');
    await card.click();
    await expect(page).toHaveURL(/\/signups\?sheet=1$/);
    await expect(page.getByText('You have picked 0 of 2 day(s).')).toBeVisible();
    // The long-past day is tucked away; a day with a hidden classmate says only that it is taken.
    await expect(page.getByText('Long ago')).toHaveCount(0);
    await expect(page.getByText(/Full · Ana R\., Taken/)).toBeVisible();

    await page.getByRole('button', { name: /^Pick .*March 2, 2099/ }).click();
    await expect(page.getByText('You have picked 1 of 2 day(s).')).toBeVisible();
    await expect(page.getByText(/Your days:/)).toContainText('Mon, Mar 2');
    expect(claims).toEqual([{ dateId: 11 }]);
    await expect(page.getByRole('button', { name: /^Drop .*March 2, 2099/ })).toBeVisible();

    await page.getByLabel('Show past days (1)').check();
    await expect(page.getByText('Long ago')).toBeVisible();
  });

  test('a day taken a moment ago says so and refreshes', async ({ page }) => {
    let takenByOthers = false;
    await mockAuthenticatedTrpc(page, {
      signupSheets: [listed],
      queries: {
        'signups.get': () => {
          const view = sheetView();
          if (takenByOthers) {
            const day = view.dates.find((d) => d.id === 11)!;
            Object.assign(day, { taken: 2, people: [{ you: false, name: 'Ana R.' }, { you: false, name: 'Beto S.' }] });
          }
          return view;
        },
      },
      mutations: {
        'signups.claim': () => {
          takenByOthers = true;
          throw new TrpcMockError('Someone just took the last spot on that day. Pick another one.', 'CONFLICT', 409);
        },
      },
    });
    await page.goto('/signups?sheet=1');
    await page.getByRole('button', { name: /^Pick .*March 2, 2099/ }).click();
    await expect(page.getByRole('alert')).toContainText('Someone just took the last spot');
    // The sheet reloads: that day now shows as full, with no button.
    await expect(page.getByText(/Full · Ana R\., Beto S\./)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pick .*March 2, 2099/ })).toHaveCount(0);
  });

  test('a sheet for another class says so', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      queries: {
        'signups.get': () => {
          throw new TrpcMockError('This sign-up sheet is not for your class', 'FORBIDDEN', 403);
        },
      },
    });
    await page.goto('/signups?sheet=9');
    await expect(page.getByRole('alert')).toContainText('This sign-up sheet is not for your class.');
  });

  test('no card on the dashboard when there is no sheet', async ({ page }) => {
    await mockAuthenticatedTrpc(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign-ups/ })).toHaveCount(0);
  });
});

test.describe('teacher', () => {
  test('creates a sheet from pasted calendar days', async ({ page }) => {
    const created: unknown[] = [];
    await mockAdminTrpc(page, {
      mutations: {
        'signups.create': (input) => { created.push(input); return { id: 7 }; },
      },
      queries: {
        'signups.adminGet': {
          sheet: {
            id: 7, title: 'Show and tell', description: null, slotsPerDate: 2, picksPerStudent: 2, showNames: true, open: true,
            timeZone: 'America/Los_Angeles', forEveryone: false, active: true, createdBy: 1, createdAt: '2026-09-25T00:00:00.000Z', groupIds: [1],
          },
          today: '2026-09-25',
          dates: [],
          roster: [],
        },
      },
    });
    await page.goto('/admin?tab=signups');
    await page.getByRole('button', { name: 'New sign-up sheet' }).click();
    await page.getByLabel('Title').fill('Show and tell');
    await page.getByLabel('Days per student').fill('2');
    await page.getByLabel('Days', { exact: true }).fill('date,label\n2026-09-29\tDay 32 · Volcanoes\n9/28/2026, Day 31 · Rivers\n');
    await expect(page.getByText(/^2 day\(s\): Mon, Sep 28 to Tue, Sep 29/)).toBeVisible();
    await page.getByRole('button', { name: 'Create sheet' }).click();

    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({
      title: 'Show and tell',
      slotsPerDate: 2,
      picksPerStudent: 2,
      showNames: true,
      open: true,
      dates: [
        { date: '2026-09-28', label: 'Day 31 · Rivers' },
        { date: '2026-09-29', label: 'Day 32 · Volcanoes' },
      ],
    });
    // Straight on to the new sheet's roster.
    await expect(page.getByRole('heading', { name: 'Show and tell' })).toBeVisible();
    await expect(page.getByText('No days on this sheet yet.')).toBeVisible();
  });
});
