// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A lab that counts the answer pauses (v1.15.0), end to end on the real
 * server: the teacher uploads the audio (its pauses found in the teacher's
 * browser), releases it and turns the pause rule on; a student who stays
 * silent is told to do it again and the teacher gives the credit by hand; a
 * student who answers in the pauses gets it by themselves. The server scores
 * each pause from its own listening log and the rules the session began with.
 *
 * The students' microphones are scripted (tests/e2e/support/scriptedMicrophone.ts):
 * the test decides when they speak, by the lab audio's own clock. Nothing is
 * recorded, here as anywhere: the page reports how long it heard a voice in each pause.
 */
import { test, expect, type Page } from '@playwright/test';
import { STUDENT_EMAIL_PATTERN, TEACHER, type Person } from './env';
import { signIn } from './support/auth';
import { rosterCsv, TeacherApi } from './support/seed';
import { PAUSE_LAB_PAUSES, pauseLabWav } from '../e2e/support/labWav';
import { SPEAKING, scriptedMicrophone, setMicLevel, setMicPlan } from '../e2e/support/scriptedMicrophone';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

/** Silent in every pause. */
const LUCIA: Person = { email: '56781@students.school.test', name: 'Lucía Pérez' };
/** Answers out loud in every pause. */
const TOMAS: Person = { email: '67812@students.school.test', name: 'Tomás Vega' };
const GROUP = 'Period 6';
const TITLE = 'ES1 Lab semana01';
/**
 * The pause lab with a 2 s closing line: 11.7 s long, its last speech ends at
 * 11.5 s, so both pauses end before "must hear through − 1.5 s" and both count.
 */
const AUDIO = pauseLabWav(2);
const LAB_MS = 11_700;

let labId = 0;

/** The lab's row in Admin → Labs (not the upload queue's). */
const labRow = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Visible to students: ${TITLE}` }) });

test.beforeAll(async () => {
  const teacher = await TeacherApi.signIn();
  try {
    await teacher.allowEmails(STUDENT_EMAIL_PATTERN);
    // The class, pre-registered by email, so the lab can be released to it alone.
    await teacher.mutate('admin.importGoogleClassroomGroup', { name: GROUP, csvContent: rosterCsv([LUCIA, TOMAS]) });
  } finally {
    await teacher.dispose();
  }
});

async function withTeacher<T>(work: (teacher: TeacherApi) => Promise<T>): Promise<T> {
  const teacher = await TeacherApi.signIn();
  try {
    return await work(teacher);
  } finally {
    await teacher.dispose();
  }
}

/** From the dashboard to the lab's microphone check, as a student does it. */
async function openTheLab(page: Page) {
  const card = page.getByRole('link', { name: /Audio labs/ });
  await expect(card).toContainText('1 lab(s) to do');
  await card.click();
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: TITLE }) });
  await expect(item).toContainText('Not done yet');
  await item.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Answer out loud in at least 2 of the 2 pauses for this lab to count.')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await expect(page.getByRole('button', { name: 'Start the lab' })).toBeDisabled();
  // "hola": the check before Start.
  await setMicLevel(page, SPEAKING);
  await expect(page.getByText('We hear you. You can start.')).toBeVisible();
  await setMicLevel(page, 0);
}

test('the teacher uploads a lab (its pauses found in the browser), releases it to the class and turns the pause rule on', async ({ page }) => {
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=labs');

  // The rule starts off (0%: every lab counts); the teacher sets 75%.
  const rule = page.getByRole('region', { name: 'Speaking in the pauses' });
  const pct = rule.getByLabel('Pauses a student must answer (%)');
  await expect(pct).toHaveValue('0');
  await pct.fill('75');
  await rule.getByRole('button', { name: 'Save' }).click();
  await expect(rule.getByRole('status')).toHaveText('Saved.');

  await page.getByLabel('Lab audio files').setInputFiles({ name: 'ES1_Lab_semana01.wav', mimeType: 'audio/wav', buffer: AUDIO });
  const queued = page.getByRole('row', { name: /ES1_Lab_semana01\.wav/ });
  await expect(queued).toContainText('Ready', { timeout: 15_000 });
  await expect(queued.getByRole('cell').nth(3)).toContainText('2');
  await page.getByRole('checkbox', { name: GROUP }).check();
  await page.getByRole('checkbox', { name: /Show to students now/ }).check();
  await page.getByRole('button', { name: 'Upload 1 lab(s)' }).click();
  await expect(queued).toContainText('Uploaded');

  const listed = labRow(page);
  await expect(listed.getByRole('checkbox')).toBeChecked();
  await expect(listed).toContainText(GROUP);
  await expect(listed).toContainText('0 turned in');
  await expect(page.getByText(/no pause list yet/)).toHaveCount(0);

  // What the server keeps: the pauses the browser found, both counted.
  await withTeacher(async (teacher) => {
    const labs = await teacher.query<{ id: number; title: string; pauseCount: number; pauseTotal: number; active: boolean }[]>('labs.adminList');
    const lab = labs.find((l) => l.title === TITLE)!;
    expect(lab).toMatchObject({ pauseCount: 2, pauseTotal: 2, active: true });
    labId = lab.id;
    const { pauses } = await teacher.query<{ pauses: [number, number][] }>('labs.pauses', { id: labId });
    pauses.forEach(([s, e], i) => {
      expect(Math.abs(s - PAUSE_LAB_PAUSES[i][0])).toBeLessThanOrEqual(40);
      expect(Math.abs(e - PAUSE_LAB_PAUSES[i][1])).toBeLessThanOrEqual(40);
    });
  });
});

test('a student who stays silent in the pauses is told the lab did not count', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, LUCIA);
  await openTheLab(page);
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
  await expect(page.getByText("We can't hear you. Answer out loud.")).toBeVisible({ timeout: 10_000 });

  // The server's decision, when the lab has played to its end.
  const status = page.getByRole('status').filter({ hasText: 'You answered' });
  await expect(status).toContainText('You answered 0 of 2 pauses.', { timeout: LAB_MS + 20_000 });
  await expect(status).toContainText('It needs 2 to count. Do it again.');
  await expect(page.getByRole('button', { name: 'Do it again' })).toBeVisible();
  await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to labs' }).last().click();
  await expect(page.getByText("Didn't count: you answered 0 of 2 pauses (2 needed)")).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('1 lab(s) to do');
});

test('the teacher sees “Needs redo”, with the pauses and the log behind it, and gives the credit', async ({ page }) => {
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=labs');
  await expect(labRow(page)).toContainText('1 turned in · 1 need a redo');
  await labRow(page).getByRole('button', { name: 'Review' }).click();

  await expect(page.getByText(/^Must hear through 0:1\d · labs started from now on count with 2 of 2 pauses answered$/)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(`^${LUCIA.name}`) });
  await expect(row).toContainText('Needs redo');
  const pausesCell = row.getByRole('cell').nth(3);
  await expect(pausesCell).toContainText('0 of 2');
  // Judged by today's rule: no line of its own.
  await expect(pausesCell).not.toContainText('needed');
  // The page's own report, kept with the attempt: the old meter (any sound over −45 dBFS) heard nothing either.
  await expect(pausesCell).toContainText('Old meter: 0 of 2 pauses');
  // Silent: nothing in the pauses, nothing while playing.
  await expect(row).toContainText('0:00 in the pauses');
  await expect(row).toContainText('0:00 while playing');
  await expect(page.getByText('Needs redo · 0 of 2 pauses (needed 2)')).toBeVisible();

  // Each pause was played through and reported, with no voice in it.
  await row.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByRole('img', { name: /^Pause 1 at 0:01: 0\.0 s of voice$/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Pause 2 at 0:0[56]: 0\.0 s of voice$/ })).toBeVisible();

  await row.getByRole('button', { name: 'Give credit' }).click();
  await expect(row).toContainText('Done');
  await expect(row).toContainText('You gave credit');
  // Tomás has not done it yet: he is all that is left.
  await expect(page.getByRole('heading', { name: 'Still to do (1)' })).toBeVisible();
  await expect(page.getByText('Needs redo · 0 of 2 pauses (needed 2)')).toHaveCount(0);

  // Stored as the teacher's decision over the automatic result, which stays as it was.
  await withTeacher(async (teacher) => {
    const { submissions } = await teacher.query<{ submissions: { studentEmail: string; credit: boolean; creditOverride: boolean | null; effectiveCredit: boolean; pausesAnswered: number; pausesCounted: number; mic: string }[] }>('labs.submissions', { labId });
    expect(submissions.find((s) => s.studentEmail === LUCIA.email)).toMatchObject({
      credit: false, creditOverride: true, effectiveCredit: true, pausesAnswered: 0, pausesCounted: 2, mic: 'on',
    });
  });
});

test('the silent student now sees the lab done', async ({ page }) => {
  await signIn(page, LUCIA);
  const card = page.getByRole('link', { name: /Audio labs/ });
  await expect(card).toContainText('All labs turned in');
  await card.click();
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: TITLE }) });
  await expect(item).toContainText(/Submitted /);
  await expect(item.getByRole('button', { name: 'Do it again' })).toBeVisible();
});

test('a student who answers out loud in the pauses gets the credit', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, TOMAS);
  await openTheLab(page);
  // 1.6 s of voice in each pause, from 0.4 s after it starts.
  await setMicPlan(page, PAUSE_LAB_PAUSES.map(([s]) => [s + 400, s + 2000] as [number, number]));
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await expect(page.getByText('Heard you.')).toBeVisible({ timeout: 10_000 });

  const status = page.getByRole('status').filter({ hasText: 'You answered' });
  await expect(status).toContainText('You answered 2 of 2 pauses.', { timeout: LAB_MS + 20_000 });
  await expect(status).toContainText('Turned in. Your teacher will see that you finished it.');
  await page.getByRole('button', { name: 'Back to labs' }).last().click();
  await expect(page.getByText(/Submitted /)).toBeVisible();

  await withTeacher(async (teacher) => {
    const { submissions, summary } = await teacher.query<{
      submissions: { studentEmail: string; credit: boolean; creditOverride: boolean | null; pausesAnswered: number; pauseResults: [number, number][]; flags: string[] }[];
      summary: { done: number; redo: number; check: number };
    }>('labs.submissions', { labId });
    const tomas = submissions.find((s) => s.studentEmail === TOMAS.email)!;
    expect(tomas).toMatchObject({ credit: true, creditOverride: null, pausesAnswered: 2, flags: [] });
    expect(tomas.pauseResults.every(([, voiced]) => voiced >= 250)).toBe(true);
    expect(summary).toMatchObject({ done: 2, redo: 0, check: 0 });
  });
});
