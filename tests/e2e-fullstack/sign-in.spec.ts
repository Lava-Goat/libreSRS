// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Who gets in, decided by the real server: the email allowlist checked on
 * each sign-in, accounts made only for those let in, and sessions that end
 * on the server when a student signs out.
 */
import { test, expect } from '@playwright/test';
import { API_URL, CLIENT_URL, FAKE_CLIENT_ID, OAUTH_URL, STUDENT_EMAIL_PATTERN, type Person } from './env';
import { chooseNextUser, signIn, signInRefused } from './support/auth';
import { TeacherApi } from './support/seed';

/** A student on a personal Google account instead of the school one. */
const PERSONAL: Person = { email: 'dani.ortiz.99@gmail.test', name: 'Dani Ortiz' };
/** Matches the allowlist, and is on no roster. */
const CARLA: Person = { email: '34567@students.school.test', name: 'Carla Méndez' };
/** Also on the allowlist: the classmate who sends Carla a sign-in link of his own. */
const MATEO: Person = { email: '45678@students.school.test', name: 'Mateo Ruiz' };

test.beforeAll(async () => {
  // Also makes sure the teacher's account exists: before any user does, only ADMIN_EMAIL may sign in at all.
  const teacher = await TeacherApi.signIn();
  try {
    await teacher.allowEmails(STUDENT_EMAIL_PATTERN);
  } finally {
    await teacher.dispose();
  }
});

async function accountFor(email: string) {
  const teacher = await TeacherApi.signIn();
  try {
    return (await teacher.users()).find((u) => u.email === email);
  } finally {
    await teacher.dispose();
  }
}

test('a student whose address is not allowed cannot sign in, and gets no account', async ({ page }) => {
  await signInRefused(page, PERSONAL);
  // Not signed in: the app sends them back to the login page.
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`^${CLIENT_URL}/login`));
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(await accountFor(PERSONAL.email)).toBeUndefined();
});

test('a student the allowlist admits gets an account, and sees no decks until a teacher assigns one', async ({ page }) => {
  await signIn(page, CARLA);
  await expect(page.getByRole('heading', { name: 'No decks available' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin Dashboard' })).toHaveCount(0);
  // Not an admin, and not able to act as one on the server either.
  const adminCall = await page.request.get('/api/trpc/admin.getUsers');
  expect(adminCall.status()).toBe(403);
  expect(await accountFor(CARLA.email)).toMatchObject({ role: 'user', googleId: `fake-${CARLA.email}` });
});

test('signing out ends the session on the server, not just in the page', async ({ page, context }) => {
  await signIn(page, CARLA);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(new RegExp(`^${CLIENT_URL}/login`));

  // The browser still holds the session cookie; the server no longer knows it.
  expect((await context.cookies()).some((c) => c.name === 'connect.sid')).toBe(true);
  const me = await page.request.get('/api/trpc/auth.me');
  expect(await me.json()).toMatchObject({ result: { data: null } });
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`^${CLIENT_URL}/login`));
});

test('a sign-in link someone else started does not sign the student in', async ({ page }) => {
  // Mateo starts a Google sign-in in his own browser and stops before coming back: he holds a code for his account.
  await chooseNextUser(MATEO);
  const authorize = new URL(`${OAUTH_URL}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: FAKE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${API_URL}/auth/google/callback`,
  }).toString();
  const started = await fetch(authorize, { redirect: 'manual' });
  expect(started.status).toBe(302);
  const code = new URL(started.headers.get('location') ?? '').searchParams.get('code');
  expect(code).toBeTruthy();

  // Carla opens his callback link. Her session holds no OAuth state from a sign-in of her own, so the
  // server refuses it before trading the code, instead of signing her in as Mateo.
  await page.goto(`${API_URL}/auth/google/callback?code=${code}`);
  await expect(page).toHaveURL(`${CLIENT_URL}/login?error=auth_failed`);
  await expect(page.getByRole('alert')).toHaveText('Authentication failed. Please try again.');
  const me = await page.request.get('/api/trpc/auth.me');
  expect(await me.json()).toMatchObject({ result: { data: null } });
  expect(await accountFor(MATEO.email)).toBeUndefined();
});
