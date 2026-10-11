// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0), end to end on the real server: the teacher uploads two
 * forms of a listening test and a practice lab, and puts the two forms in exam
 * set "U3" from their Edit rows. A student starts form A; a reload is refused
 * ("Ask your teacher"), and so is form B: one start per student across the
 * set's forms. The teacher resets the student's one start from Admin › Labs ›
 * Tests › U3 › Students and resets; the student starts again, once, and is
 * refused after that. A practice lab still plays as before, with Back 10 s.
 * The student finds the forms on the Tests page (v1.21.0), not the Labs page,
 * and a speaking task the teacher puts in set "u3" joins them there as "U3".
 *
 * The students' microphones are scripted (tests/e2e/support/scriptedMicrophone.ts),
 * for the practice lab; a test never asks for one.
 */
import { test, expect, type Page } from '@playwright/test';
import { STUDENT_EMAIL_PATTERN, TEACHER, type Person } from './env';
import { signIn } from './support/auth';
import { rosterCsv, TeacherApi } from './support/seed';
import { pauseLabWav, wav } from '../e2e/support/labWav';
import { SPEAKING, scriptedMicrophone, setMicLevel } from '../e2e/support/scriptedMicrophone';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

// Every spec shares one database and one server: this class and its students are this spec's own
// (speaking-integrity has Period 8 and 81001).
const GROUP = 'Period 9';
/** Starts form A, is refused, is reset, and starts form B. */
const ELENA: Person = { email: '82001@students.school.test', name: 'Elena Cruz' };
/** In the class, never starts the test. */
const RAUL: Person = { email: '82002@students.school.test', name: 'Raúl Ortiz' };

const FORM_A = 'Examen U3 Forma A';
const FORM_B = 'Examen U3 Forma B';
const PRACTICE = 'ES1 Lab practica01';
const SPEAKING_TEST = 'Examen U3 Expresión oral';
/** A test form in miniature: the text read twice, 8 s in all. */
const examWav = () => wav([[3, 0.5], [1, 0], [3, 0.4], [1, 0]]);
const EXAM_MS = 8_000;

const labIds: Record<string, number> = {};

test.beforeAll(async () => {
  const teacher = await TeacherApi.signIn();
  try {
    await teacher.allowEmails(STUDENT_EMAIL_PATTERN);
    await teacher.mutate('admin.importGoogleClassroomGroup', { name: GROUP, csvContent: rosterCsv([ELENA, RAUL]) });
  } finally {
    await teacher.dispose();
  }
});

/** Accepts every question the page asks (confirm, and the leave warning on a reload). */
function acceptDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (d) => { seen.push(d.message()); void d.accept(); });
  return seen;
}

/** The lab's row in Admin → Labs (not the upload queue's). */
const labRow = (page: Page, title: string) =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Visible to students: ${title}` }) });

/** A set's card on the Tests page (v1.21.0). */
const testSet = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name }) });

/** A test form opened from the Tests page. */
async function startForm(page: Page, title: string) {
  await page.goto('/tests');
  await testSet(page, 'Test U3').getByRole('button', { name: `Start: ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/tests\\?lab=${labIds[title]}$`));
  await expect(page.getByText('Headphones on.')).toBeVisible();
  await expect(page.getByText('Ponte los auriculares.')).toBeVisible();
  await page.getByRole('button', { name: 'Start the test' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
  for (const name of ['Pause', 'Back 10 s', 'Start over']) await expect(page.getByRole('button', { name })).toHaveCount(0);
}

const refused = async (page: Page) => {
  await expect(page.getByRole('alert')).toContainText('You already started this test. Ask your teacher.');
  await expect(page.getByRole('alert')).toContainText('Ya empezaste este examen. Pregúntale a tu profesor.');
  await expect(page.locator('audio')).toHaveCount(0);
};

test('the teacher uploads two test forms and a practice lab, and puts the forms in exam set U3', async ({ page }) => {
  acceptDialogs(page);
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=labs');
  await page.getByLabel('Lab audio files').setInputFiles([
    { name: 'Examen_U3_Forma_A.wav', mimeType: 'audio/wav', buffer: examWav() },
    { name: 'Examen_U3_Forma_B.wav', mimeType: 'audio/wav', buffer: examWav() },
    { name: 'ES1_Lab_practica01.wav', mimeType: 'audio/wav', buffer: pauseLabWav(2) },
  ]);
  for (const file of ['Examen_U3_Forma_A', 'Examen_U3_Forma_B', 'ES1_Lab_practica01']) {
    await expect(page.getByRole('row', { name: new RegExp(`${file}\\.wav`) })).toContainText('Ready', { timeout: 20_000 });
  }
  await page.getByRole('checkbox', { name: GROUP }).check();
  await page.getByRole('checkbox', { name: /Show to students now/ }).check();
  await page.getByRole('button', { name: 'Upload 3 lab(s)' }).click();
  await expect(page.getByRole('row', { name: /ES1_Lab_practica01\.wav/ })).toContainText('Uploaded');

  // No tests yet: no Tests section.
  await expect(page.getByRole('region', { name: 'Tests (exam sets)' })).toHaveCount(0);
  for (const [title, typed] of [[FORM_A, ' U3 '], [FORM_B, 'u3']] as const) {
    await labRow(page, title).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: 'Exam (test audio)' }).check();
    await page.getByRole('combobox', { name: 'Exam set' }).fill(typed);
    await page.getByRole('table').last().getByRole('button', { name: 'Save' }).click();
    await expect(labRow(page, title)).toContainText('Test · U3');
  }
  const sets = page.getByRole('region', { name: 'Tests (exam sets)' });
  await expect(sets.getByRole('heading', { name: 'Exam set U3' })).toBeVisible();
  await expect(sets).toContainText(`${FORM_A} · Visible`);
  await expect(sets).toContainText(`${FORM_B} · Visible`);
  await expect(sets).toContainText('0 of 2 started · 0 turned in · 0 reset(s)');
  await expect(labRow(page, PRACTICE)).not.toContainText('Test ·');

  const teacher = await TeacherApi.signIn();
  try {
    const labs = await teacher.query<{ id: number; title: string; examSet: string | null }[]>('labs.adminList');
    for (const title of [FORM_A, FORM_B, PRACTICE]) labIds[title] = labs.find((l) => l.title === title)!.id;
    // "u3" joined "U3": one set.
    expect(labs.filter((l) => l.examSet !== null).map((l) => l.examSet)).toEqual(['U3', 'U3']);
  } finally {
    await teacher.dispose();
  }
});

test('a student starts form A; a reload, and form B, are refused', async ({ page }) => {
  test.slow();
  const dialogs = acceptDialogs(page);
  await signIn(page, ELENA);
  const notice = page.getByRole('link', { name: /^Tests/ });
  await expect(notice).toContainText('1 test(s) to take');
  await expect(notice).toHaveAttribute('href', '/tests');
  await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('1 lab(s) to do');

  await startForm(page, FORM_A);
  expect(dialogs).toContain(`Start ${FORM_A}? You can start one form of this test, once. Check that it is the form on your paper.`);
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeGreaterThan(0.5);

  // A reload mid-test: the start is used.
  await page.reload();
  await refused(page);

  // The same set's other form: refused too.
  await page.goto(`/labs?lab=${labIds[FORM_B]}`);
  await refused(page);

  await page.goto('/tests');
  const set = testSet(page, 'Test U3');
  await expect(set).toContainText(`You started ${FORM_A} on`);
  await expect(set).toContainText('To start again, ask your teacher.');
  await expect(set.getByRole('button')).toHaveCount(0);
  // Not on the Labs page, which only points to the Tests page.
  await page.goto('/labs');
  await expect(page.getByRole('heading', { name: PRACTICE })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(FORM_A);
  await expect(page.getByRole('link', { name: 'Go to Tests' })).toHaveAttribute('href', '/tests');
  await page.goto('/');
  await expect(page.getByRole('link', { name: /^Tests/ })).toContainText('Tests started');
});

test('the teacher resets the student’s one start from Admin › Labs › Tests › U3 › Students and resets', async ({ page }) => {
  const dialogs = acceptDialogs(page);
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=labs');
  const sets = page.getByRole('region', { name: 'Tests (exam sets)' });
  await expect(sets).toContainText('1 of 2 started · 0 turned in · 0 reset(s)');
  await sets.getByRole('button', { name: 'Students and resets: U3' }).click();

  const elena = page.getByRole('row', { name: new RegExp(ELENA.name) });
  await expect(elena).toContainText(FORM_A);
  await expect(page.getByRole('row', { name: new RegExp(RAUL.name) })).toContainText('Not started');
  await page.getByRole('button', { name: `Reset: ${ELENA.name}` }).click();
  expect(dialogs).toEqual([`Give ${ELENA.name} one more start in U3? Their earlier play stays in the record.`]);
  await expect(page.getByRole('button', { name: `Reset: ${ELENA.name}` })).toHaveCount(0);
  await expect(elena).toContainText('Not started');
  // The earlier play stays in the record, with who reset it.
  await expect(page.getByText(new RegExp(`Earlier: ${FORM_A} · .* by ${TEACHER.name}`))).toBeVisible();

  await page.getByRole('button', { name: 'Back to labs' }).click();
  await expect(sets).toContainText('0 of 2 started · 0 turned in · 1 reset(s)');
});

test('the student starts again, once (form B this time), turns it in, and is refused after that', async ({ page }) => {
  test.slow();
  acceptDialogs(page);
  await signIn(page, ELENA);
  await startForm(page, FORM_B);
  await expect(page.getByText('Turned in. Your answers go on your paper.')).toBeVisible({ timeout: EXAM_MS + 20_000 });
  await expect(page.getByRole('button', { name: 'Do it again' })).toHaveCount(0);

  // Back to the Tests page it came from.
  await page.getByRole('button', { name: 'Back to tests' }).last().click();
  await expect(page).toHaveURL(/\/tests$/);
  const set = testSet(page, 'Test U3');
  await expect(set).toContainText(`You started ${FORM_B} on`);
  await expect(set).toContainText('Turned in.');

  // A direct link to the other form: the same refusal, and its way back goes to the Tests page.
  await page.goto(`/labs?lab=${labIds[FORM_A]}`);
  await refused(page);
  await page.getByRole('button', { name: 'Back to tests' }).click();
  await expect(page).toHaveURL(/\/tests$/);

  const teacher = await TeacherApi.signIn();
  try {
    const review = await teacher.query<{ submissions: { studentEmail: string; mic: string; flags: string[]; examSet: string | null }[] }>(
      'labs.submissions', { labId: labIds[FORM_B] },
    );
    const mine = review.submissions.filter((s) => s.studentEmail === ELENA.email);
    expect(mine).toHaveLength(1);
    // A test has no microphone by design: never flagged for it.
    expect(mine[0]).toMatchObject({ mic: 'off', examSet: 'U3' });
    expect(mine[0].flags).not.toContain('no-mic');
  } finally {
    await teacher.dispose();
  }
});

test('a practice lab still plays as before, with the microphone, Pause and Back 10 s', async ({ page }) => {
  acceptDialogs(page);
  await scriptedMicrophone(page);
  await signIn(page, ELENA);
  await page.goto('/labs');
  const practice = page.getByRole('main');
  await practice.getByRole('listitem').filter({ has: page.getByRole('heading', { name: PRACTICE }) }).getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await setMicLevel(page, SPEAKING);
  await expect(page.getByRole('button', { name: 'Start the lab' })).toBeEnabled();
  await setMicLevel(page, 0);
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeGreaterThan(1.5);
  await page.getByRole('button', { name: 'Back 10 s' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeLessThan(1.5);
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
});

test('the teacher makes a speaking task a test of set "u3"; the student finds it on the Tests page with the forms, not on Speaking', async ({ page, browser }) => {
  acceptDialogs(page);
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=speaking');
  await page.getByRole('button', { name: 'New speaking task' }).click();
  await page.getByLabel('Title').fill(SPEAKING_TEST);
  await page.getByLabel('Exam set').fill('u3');
  await page.getByRole('checkbox', { name: GROUP }).check();
  await page.getByLabel(/^Released to students/).check();
  await page.getByRole('button', { name: 'Create task' }).click();
  // Stored in the set's spelling, the labs' "U3".
  await expect(page.getByRole('row', { name: new RegExp(SPEAKING_TEST) })).toContainText('Test · U3');

  const teacher = await TeacherApi.signIn();
  try {
    const tasks = await teacher.query<{ title: string; examSet: string | null }[]>('speaking.adminList');
    expect(tasks.find((t) => t.title === SPEAKING_TEST)).toMatchObject({ examSet: 'U3' });
  } finally {
    await teacher.dispose();
  }

  const context = await browser.newContext();
  const student = await context.newPage();
  try {
    await signIn(student, ELENA);
    // The listening part is turned in; the speaking test is still to do.
    await expect(student.getByRole('link', { name: /^Tests/ })).toContainText('1 test(s) to take');
    await expect(student.getByRole('link', { name: /Speaking/ })).toHaveCount(0);

    await student.goto('/tests');
    const set = testSet(student, 'Test U3');
    await expect(set).toContainText(FORM_A);
    await expect(set).toContainText(FORM_B);
    await expect(set.getByRole('heading', { level: 3, name: 'Speaking' })).toBeVisible();
    await expect(set).toContainText(SPEAKING_TEST);
    await expect(set.getByRole('button', { name: `Start: ${SPEAKING_TEST}` })).toBeVisible();
    await expect(student.getByRole('heading', { level: 2 })).toHaveCount(1);

    await student.goto('/speaking');
    await expect(student.getByText('Nothing to record right now.')).toBeVisible();
    await expect(student.getByRole('main')).not.toContainText(SPEAKING_TEST);
    await expect(student.getByRole('link', { name: 'Go to Tests' })).toHaveAttribute('href', '/tests');
  } finally {
    await context.close();
  }
});
