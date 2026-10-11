// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A speaking take checked against the file itself (v1.16.0), end to end on
 * the real server. The page's own claims are rewritten on the way out, the
 * way a console script could: the server keeps the file's real length (and
 * the page's claim beside it), and the teacher's Review shows both. The same
 * take posted again under a new key is kept and flagged, and a format the
 * recorder never makes is refused.
 *
 * The student's microphone is Chromium's fake one (a beep twice a second),
 * so the take is "very little speaking" on the page; it is turned in anyway.
 */
import { test, expect, type Page } from '@playwright/test';
import { STUDENT_EMAIL_PATTERN, TEACHER, type Person } from './env';
import { signIn } from './support/auth';
import { rosterCsv, TeacherApi } from './support/seed';
import { allowMicrophone, fakeMicrophone } from '../e2e/support/microphone';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: fakeMicrophone });

const INES: Person = { email: '81001@students.school.test', name: 'Inés Castro' };
const GROUP = 'Period 8';
const TITLE = 'Escalera oral, peldaño 1';
const TEXT = 'Hola, me llamo Inés. Tengo catorce años y vivo en Madrid.';

let taskId = 0;
/** The take as the student's page sent it, to post again. */
let takeBody: Buffer | null = null;

interface ReviewRow {
  id: number;
  studentName: string;
  durationMs: number;
  voicedMs: number;
  clientDurationMs: number | null;
  clientVoicedMs: number | null;
  flags: string[];
  micSettings: Record<string, unknown> | null;
  sameFileAs: { submissionId: number; taskTitle: string } | null;
}

async function withTeacher<T>(work: (teacher: TeacherApi) => Promise<T>): Promise<T> {
  const teacher = await TeacherApi.signIn();
  try {
    return await work(teacher);
  } finally {
    await teacher.dispose();
  }
}

const reviewRows = () => withTeacher(async (teacher) =>
  (await teacher.query<{ submissions: ReviewRow[] }>('speaking.submissions', { taskId })).submissions);

/** The teacher's Review of the task, in a browser of the teacher's own. */
async function openReview(page: Page) {
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=speaking');
  await page.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
}

test.beforeAll(async () => {
  await withTeacher(async (teacher) => {
    await teacher.allowEmails(STUDENT_EMAIL_PATTERN);
    const { group } = await teacher.mutate<{ group: { id: number } }>(
      'admin.importGoogleClassroomGroup', { name: GROUP, csvContent: rosterCsv([INES]) },
    );
    const task = await teacher.mutate<{ id: number }>('speaking.create', {
      title: TITLE, instructions: null, referenceText: TEXT, showReference: true, targetSeconds: 10, active: true, groupIds: [group.id],
    });
    taskId = task.id;
  });
});

test('a page that claims 45 s for a short take: the server keeps the file’s length, and the teacher sees both', async ({ page, browser }) => {
  await allowMicrophone(page);
  await signIn(page, INES);
  // What a console script could do: rewrite the page's claims on the way out.
  await page.route('**/api/speaking/*/submission', async (route, request) => {
    takeBody = request.postDataBuffer();
    await route.continue({ headers: { ...request.headers(), 'x-recording-duration-ms': '45000', 'x-recording-voiced-ms': '45000' } });
  });

  await page.goto('/speaking');
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: TITLE }) });
  await item.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
  // The fake microphone's beeps are very little speaking: turned in anyway.
  await page.getByRole('button', { name: /^Turn it in/ }).click();
  await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
  expect(takeBody).not.toBeNull();

  const [row] = await reviewRows();
  expect(row).toMatchObject({ studentName: INES.name, clientDurationMs: 45_000, clientVoicedMs: 45_000 });
  // The file's own length: about the 2.5 s the page recorded, whatever it said.
  expect(row.durationMs).toBeGreaterThan(1500);
  expect(row.durationMs).toBeLessThan(5000);
  expect(row.voicedMs).toBeLessThanOrEqual(row.durationMs);
  expect(row.flags).toContain('length-mismatch');
  expect(row.micSettings).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });

  // Reopened, the task shows the take first, not the microphone.
  await page.goto('/speaking');
  await item.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText(/^You turned this in on /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);

  const teacherContext = await browser.newContext();
  try {
    const teacherPage = await teacherContext.newPage();
    await openReview(teacherPage);
    const ines = teacherPage.getByRole('row', { name: new RegExp(`^${INES.name}`) });
    await expect(ines.getByText(/^The page timed it at 0:45; the file is 0:0[1-4]$/)).toBeVisible();
    await expect(teacherPage.getByText('Spoke for is measured by the student’s page, capped at the file’s real length.')).toBeVisible();
    await ines.getByRole('button', { name: 'Listen' }).click();
    await expect(teacherPage.getByText(/^Microphone processing: Echo cancellation: Off/)).toBeVisible();
  } finally {
    await teacherContext.close();
  }
});

test('the same take posted again under a new key is kept and flagged; an mp3 is refused', async ({ page, browser }) => {
  expect(takeBody).not.toBeNull();
  await signIn(page, INES);
  const csrf = (await page.context().cookies()).find((c) => c.name === 'libresrs_csrf')?.value;
  expect(csrf).toBeTruthy();
  const post = (contentType: string, key: string) => page.request.post(`/api/speaking/${taskId}/submission`, {
    data: takeBody!,
    headers: {
      'content-type': contentType, 'x-csrf-token': csrf!, 'x-submission-key': key,
      'x-recording-duration-ms': '3000', 'x-recording-voiced-ms': '2000',
    },
  });

  const again = await post('audio/webm;codecs=opus', 'reposted-take-0001');
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ success: true });
  const mp3 = await post('audio/mpeg', 'reposted-take-0002');
  expect(mp3.status()).toBe(415);

  const rows = await reviewRows();
  expect(rows).toHaveLength(2);
  const [latest, first] = rows;
  expect(latest.flags).toEqual(['same-file']);
  expect(latest.sameFileAs).toMatchObject({ submissionId: first.id, taskTitle: TITLE });
  // Same audio, same length: the server measured both files.
  expect(latest.durationMs).toBe(first.durationMs);

  const teacherContext = await browser.newContext();
  try {
    const teacherPage = await teacherContext.newPage();
    await openReview(teacherPage);
    const ines = teacherPage.getByRole('row', { name: new RegExp(`^${INES.name}`) });
    await expect(ines).toContainText('2 attempts');
    await expect(ines.getByText(new RegExp(`^Same file as the recording for “${TITLE}” \\(.+\\)$`))).toBeVisible();
    // The earlier take's amber flag stays on its own row.
    await expect(ines.getByText(/The page timed it at/)).toHaveCount(0);
  } finally {
    await teacherContext.close();
  }
});
