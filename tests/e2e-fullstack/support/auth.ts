// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Signing in the way a student does: "Sign in with Google" on the login page,
 * through the server's real OAuth routes and session, with the fake provider
 * standing in for Google's account picker.
 */
import { expect, type Page } from '@playwright/test';
import { CLIENT_URL, OAUTH_URL, type Person } from '../env';

/** Tells the fake provider who signs in next (good for one sign-in). */
export async function chooseNextUser(person: Person): Promise<void> {
  const res = await fetch(`${OAUTH_URL}/next-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(person),
  });
  if (!res.ok) throw new Error(`fake OAuth /next-user: ${res.status} ${await res.text()}`);
}

/** Clicks "Sign in with Google" as this person and waits to be sent back to the app. */
async function pressSignIn(page: Page, person: Person): Promise<void> {
  await chooseNextUser(person);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  // Out to the provider, back through the API's callback, and home to the client.
  await page.waitForURL((url) => url.origin === CLIENT_URL && !url.pathname.startsWith('/auth/'));
}

/** Signs in and waits for the dashboard to greet this person. */
export async function signIn(page: Page, person: Person): Promise<void> {
  await pressSignIn(page, person);
  await expect(page).toHaveURL(`${CLIENT_URL}/`);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByText(person.name, { exact: true })).toBeVisible();
}

/** Tries to sign in and expects the login page to refuse, with the server's reason. */
export async function signInRefused(page: Page, person: Person): Promise<void> {
  await pressSignIn(page, person);
  await expect(page).toHaveURL(`${CLIENT_URL}/login?error=not_authorized`);
  await expect(page.getByRole('alert')).toHaveText(
    'Your email is not authorized to access this application. Please contact an administrator.',
  );
}
