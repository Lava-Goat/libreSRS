// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Sign in with a PIN" (v1.22.0) against the real server, for when a school's Google Workspace
 * policy refuses every student account (admin_policy_enforced) while staff still get in. Here the
 * fake provider refuses students the same way, the server notices once six browsers on the school's
 * network (here loopback) are refused, and the login page offers the PIN chip; the teacher makes
 * PINs (for one student, and for a group from its admin page) and the
 * students sign in with them: a wrong PIN, a lock after five, the teacher's Unlock, a page to
 * return to. A student's Google sign-in then ends the outage and the chip goes away.
 *
 * The Google signal lives in the API server's memory and the specs share one server: this spec
 * leaves it cleared (and the mode on Auto, and no PINs), whatever happens.
 */
import { readFile } from 'node:fs/promises';
import { test, expect, request, type Browser, type Page } from '@playwright/test';
import { API_URL, CLIENT_URL, OAUTH_URL, TEACHER, type Person } from './env';
import { chooseNextUser, signIn } from './support/auth';
import { TeacherApi } from './support/seed';
import type { FakeRefusal } from './fakeOAuth';

test.describe.configure({ mode: 'serial' });

/** On the roster and nowhere else in the run. */
const ANA: Person = { email: '64001@students.school.test', name: 'Ana Pineda' };
const BETO: Person = { email: '64002@students.school.test', name: 'Beto Pineda' };
const CARLA: Person = { email: '64003@students.school.test', name: 'Carla Pineda' };
const GROUP = 'PIN period';
const AUTO_NOTE = "Google sign-in isn't letting students in right now. Use your PIN.";
const WRONG = 'Wrong student number, email or PIN.';

let teacher: TeacherApi;
let groupId: number;
const ids: Record<string, number> = {};
/** Ana's PIN, made in step 3 (a fresh random one each run). */
let anaPin = '';

const studentNumber = (person: Person) => person.email.split('@')[0];
/** A PIN that is not `pin` (the server only ever issues 1000-9999). */
const otherThan = (pin: string, n = 0) => {
  const candidates = ['5927', '6184', '7305', '8142', '9263', '4718'].filter((p) => p !== pin);
  return candidates[n % candidates.length];
};

const chip = (page: Page) => page.getByRole('button', { name: 'Sign in with a PIN' });
// exact: "Sign in" is also in "Sign in with Google" and "Sign in with a PIN".
const submit = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });
const pinField = (page: Page) => page.getByLabel('PIN', { exact: true });

/** Tells the fake provider to refuse the next Google sign-in, as Google does. */
async function refuseNextSignIn(person: Person, refuse: FakeRefusal): Promise<void> {
  const res = await fetch(`${OAUTH_URL}/next-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...person, refuse }),
  });
  if (!res.ok) throw new Error(`fake OAuth /next-user: ${res.status} ${await res.text()}`);
}

/** Opens the PIN form on the login page and fills it in (submitted by the caller). */
async function fillPinForm(page: Page, username: string, pin: string): Promise<void> {
  await expect(chip(page)).toBeVisible();
  if ((await chip(page).getAttribute('aria-expanded')) !== 'true') await chip(page).click();
  await page.getByLabel('Student number or school email').fill(username);
  await pinField(page).fill(pin);
}

/** Signs in with a PIN from /login (or `entry`) and waits for the dashboard to greet the student. */
async function signInWithPin(page: Page, person: Person, username: string, pin: string, entry = '/login'): Promise<void> {
  await page.goto(entry);
  await fillPinForm(page, username, pin);
  await submit(page).click();
  if (entry === '/login') {
    await expect(page).toHaveURL(`${CLIENT_URL}/`);
    await expect(page.getByText(person.name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(new RegExp(`^${CLIENT_URL}/login`));
}

/** The teacher in a browser of their own, signed in with Google (staff accounts still get through). */
async function teacherPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: CLIENT_URL });
  const page = await context.newPage();
  await signIn(page, TEACHER);
  return page;
}

/** A student's Google sign-in refused, without a browser: one more refused browser for the server. */
async function refusedGoogleSignIn(person: Person, refuse: FakeRefusal): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await refuseNextSignIn(person, refuse);
    const res = await ctx.get('/auth/google');
    if (!res.ok()) throw new Error(`${person.email}'s refused Google sign-in ended on ${res.url()} with ${res.status()}`);
  } finally {
    await ctx.dispose();
  }
}

/** A student's Google sign-in, without a browser: what ends the outage as far as the server knows. */
async function studentGoogleSignIn(person: Person): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await chooseNextUser(person);
    const res = await ctx.get('/auth/google');
    if (!res.ok()) throw new Error(`${person.email}'s Google sign-in ended on ${res.url()} with ${res.status()}`);
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  teacher = await TeacherApi.signIn();
  groupId = await teacher.rosterGroup(GROUP, [ANA, BETO, CARLA]);
  for (const person of [ANA, BETO, CARLA]) ids[person.email] = await teacher.userId(person.email);
});

test.afterAll(async () => {
  if (!teacher) return;
  try {
    await teacher.pinMode('auto');
    for (const id of Object.values(ids)) await teacher.removePin(id);
    // Leave the Google signal cleared for the specs after this one, even if a step failed.
    if ((await teacher.pinSettings()).google.looksBlocked) await studentGoogleSignIn(CARLA);
    expect((await teacher.pinSettings()).google.looksBlocked).toBe(false);
  } finally {
    await teacher.dispose();
  }
});

test('1. mode Off: no chip, and the server refuses a PIN', async ({ page, context }) => {
  await teacher.pinMode('off');
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expect(page.getByText(AUTO_NOTE)).toHaveCount(0);

  // The page's tRPC queries handed out the CSRF cookie; the refusal is about the mode, not the token.
  const csrf = (await context.cookies()).find((c) => c.name === 'libresrs_csrf')?.value;
  expect(csrf).toBeTruthy();
  const res = await page.request.post('/auth/pin', {
    data: { username: studentNumber(ANA), pin: otherThan('') },
    headers: { 'x-csrf-token': csrf ?? '' },
  });
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ ok: false, error: 'PIN_DISABLED' });
});

test('2. mode Auto: Google refuses six browsers (admin_policy_enforced), and the chip appears', async ({ page, browser }) => {
  await teacher.pinMode('auto');
  // Five refused browsers are not enough: one student can send their own browser back refused.
  // Google starts that never came back already count once they are 2-15 minutes old: globalSetup's
  // probe of /auth/google, and any sign-in an earlier spec's failure left hanging. Nothing but 60 idle
  // minutes clears them, so this tops up to five rather than adding five.
  const already = (await teacher.pinSettings()).google.unansweredBrowsers;
  expect(already, 'browsers left unanswered by the specs before this one').toBeLessThan(5);
  for (let i = 0; i < 5 - already; i++) await refusedGoogleSignIn(i % 2 === 0 ? BETO : CARLA, 'admin_policy_enforced');
  expect((await teacher.pinSettings()).google).toMatchObject({ looksBlocked: false, unansweredBrowsers: 5 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(chip(page)).toHaveCount(0);

  // The sixth.
  await refuseNextSignIn(ANA, 'admin_policy_enforced');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page).toHaveURL(`${CLIENT_URL}/login?error=auth_failed`);
  await expect(page.getByRole('alert')).toHaveText('Authentication failed. Please try again.');
  await expect(chip(page)).toBeVisible();
  await expect(page.getByText(AUTO_NOTE)).toBeVisible();

  const settings = await teacher.pinSettings();
  expect(settings).toMatchObject({ mode: 'auto', showing: true, google: { looksBlocked: true, reason: 'google_error' } });

  // The teacher (staff: Google still lets them in) sees it on the Access tab, and their sign-in changes nothing.
  const admin = await teacherPage(browser);
  try {
    await admin.goto('/admin?tab=access');
    await expect(admin.getByRole('radio', { name: 'Auto' })).toBeChecked();
    await expect(admin.getByText(/Google sign-in looks blocked for students since/)).toBeVisible();
    await expect(admin.getByText('Students see “Sign in with a PIN” on the login page now.')).toBeVisible();
  } finally {
    await admin.context().close();
  }
  expect((await teacher.pinSettings()).google.looksBlocked).toBe(true);
});

test('3. a PIN from the teacher: a wrong one is refused, the right one signs in, and a page to return to is kept', async ({ page }) => {
  anaPin = await teacher.makePin(ids[ANA.email]);

  await page.goto('/login');
  await fillPinForm(page, studentNumber(ANA), otherThan(anaPin));
  await submit(page).click();
  await expect(page.getByRole('alert')).toHaveText(WRONG);
  await expect(pinField(page)).toHaveValue('');

  // A number nobody has reads the same as a wrong PIN.
  await fillPinForm(page, '64999', anaPin);
  await submit(page).click();
  await expect(page.getByRole('alert')).toHaveText(WRONG);

  await signInWithPin(page, ANA, studentNumber(ANA), anaPin);
  await signOut(page);

  await signInWithPin(page, ANA, studentNumber(ANA), anaPin, '/login?returnTo=%2Fsignups');
  await expect(page).toHaveURL(`${CLIENT_URL}/signups`);
  await signOut(page);
});

test('4. five wrong PINs lock the account; the teacher unlocks it', async ({ page }) => {
  await page.goto('/login');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fillPinForm(page, studentNumber(ANA), otherThan(anaPin, attempt));
    await submit(page).click();
    await expect(page.getByRole('alert')).toHaveText(WRONG);
  }
  await fillPinForm(page, studentNumber(ANA), otherThan(anaPin, 4));
  await submit(page).click();
  await expect(page.getByRole('alert')).toHaveText('Too many wrong PINs. Try again in 15 minutes.');

  // Locked: even the right PIN waits.
  await fillPinForm(page, studentNumber(ANA), anaPin);
  await submit(page).click();
  await expect(page.getByRole('alert')).toHaveText(/^Too many wrong PINs\. Try again in \d+ minutes?\.$/);

  await teacher.unlockPin(ids[ANA.email]);
  await signInWithPin(page, ANA, studentNumber(ANA), anaPin);
  await signOut(page);
});

test('5. the group’s “Make PINs…”: the list once, as a CSV for the Sheet, and the PINs work', async ({ page, browser }) => {
  const admin = await teacherPage(browser);
  let betoPin = '';
  try {
    await admin.goto(`/admin?tab=groups&group=${groupId}`);
    await expect(admin.getByRole('heading', { name: GROUP, exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Make PINs…' }).click();
    const dialog = admin.getByRole('dialog', { name: `Make PINs for ${GROUP}` });
    await expect(dialog.getByText('1 of 3 students have a PIN.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Make PINs', exact: true }).click();

    await expect(dialog.getByText('Made 2 PINs. This is the only time they are shown: download or copy them now.')).toBeVisible();
    await expect(dialog.getByText('Skipped 1 student who already has a PIN.')).toBeVisible();
    const betoRow = dialog.getByRole('row', { name: new RegExp(BETO.name) });
    betoPin = (await betoRow.getByRole('cell').nth(2).textContent())?.trim() ?? '';
    expect(betoPin).toMatch(/^[1-9]\d{3}$/);
    await expect(dialog.getByRole('rowheader', { name: ANA.name })).toHaveCount(0);

    const downloading = admin.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download CSV' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('PIN_period-pins.csv');
    const csv = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Email,Student number,PIN');
    expect(lines).toContain(`${BETO.name},${BETO.email},${studentNumber(BETO)},${betoPin}`);
    expect(lines.filter((line) => line.startsWith(CARLA.name))).toHaveLength(1);
    expect(lines).toHaveLength(3);

    // Downloaded: Close asks nothing, and the PINs are gone from the page.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(admin.getByText(betoPin, { exact: true })).toHaveCount(0);
  } finally {
    await admin.context().close();
  }

  // The full school email works as well as the number.
  await signInWithPin(page, BETO, BETO.email.toUpperCase(), betoPin);
  await signOut(page);
});

test('6. a student gets through Google again: the chip goes away', async ({ page }) => {
  await signIn(page, CARLA);
  const settings = await teacher.pinSettings();
  expect(settings.google.looksBlocked).toBe(false);
  expect(settings.google.lastStudentSignInAt).not.toBeNull();
  expect(settings.showing).toBe(false);

  await signOut(page);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expect(page.getByText(AUTO_NOTE)).toHaveCount(0);
});
