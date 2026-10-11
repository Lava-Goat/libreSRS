// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The lab checks from the v1.15 "tricks" simulation (v1.16.0), end to end on
 * the real server, with the pause rule at 75%:
 *
 * - the sim's C1 console script: a student stays silent and sends their own
 *   report of 1.5 s for each pause, with the page's session, clock and
 *   position. Two results for one pause in one playback are results the page
 *   could not have sent: none counts, the lab is a redo, flagged Odd results;
 * - the same script answering in a replay (Back 10 s after the pause): the
 *   page reports every pass through a pause, a replay's too, so the script's
 *   result meets the page's own in the replay's playback (R1);
 * - the same script after "My mic doesn't work", turning the lab in itself
 *   and saying the microphone was on: the page marked in the log where it
 *   went on without one, and results after that mark are ones it could not
 *   have sent, so the lab waits for the teacher (held);
 * - honest students are left alone: an answer given while paused (the sim's
 *   A8) and a Back 10 s replay that improves a pause both count, unflagged;
 * - one student, two windows, two different labs at once: the first turned
 *   in keeps its credit and its flag, the second waits for the teacher.
 *
 * The students' microphones are scripted (tests/e2e/support/scriptedMicrophone.ts).
 * The rule goes back to 0% at the end, as the next spec (labs-journey) expects.
 */
import { test, expect, type Page, type Request } from '@playwright/test';
import { STUDENT_EMAIL_PATTERN, TEACHER, type Person } from './env';
import { signIn } from './support/auth';
import { rosterCsv, TeacherApi } from './support/seed';
import { PAUSE_LAB_PAUSES, pauseLabWav, wav } from '../e2e/support/labWav';
import { SPEAKING, scriptedMicrophone, setMicLevel, setMicPlan } from '../e2e/support/scriptedMicrophone';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

const GROUP = 'Period 7';
/** The C1 script, with the microphone on and silent. */
const IKER: Person = { email: '71001@students.school.test', name: 'Iker Soto' };
/** The C1 script after "My mic doesn't work". */
const NORA: Person = { email: '71002@students.school.test', name: 'Nora Gil' };
/** Answers the first pause while the lab is paused. */
const PABLO: Person = { email: '71003@students.school.test', name: 'Pablo Ruiz' };
/** Stays silent in the first pause, presses Back 10 s and answers it the second time. */
const ROSA: Person = { email: '71004@students.school.test', name: 'Rosa Lara' };
/** Plays two labs at once, in two windows. */
const SARA: Person = { email: '71005@students.school.test', name: 'Sara Mora' };
/** The C1 script again, answering in a Back 10 s replay of a pause (R1). */
const TOMAS: Person = { email: '71006@students.school.test', name: 'Tomas Vega' };

/** The short lab: 11.7 s, two pauses (PAUSE_LAB_PAUSES), both counted. */
const SHORT = 'ES1 Lab integridad01';
const SHORT_MS = 11_700;
/**
 * Two longer labs for "two at once": ten 1 s prompts each followed by a 3.6 s
 * pause, then a 4 s closing line (50.5 s). The server counts another session
 * as "at once" only when its reports span 30 s or more.
 */
const LONG_A = 'ES1 Lab integridad02';
const LONG_B = 'ES1 Lab integridad03';
const LONG_PAUSES: [number, number][] = Array.from({ length: 10 }, (_, i) => [1000 + i * 4600, 4600 + i * 4600]);
const LONG_MS = 50_500;
const longLabWav = () => wav([...LONG_PAUSES.flatMap((): [number, number][] => [[1, 0.5], [3.6, 0]]), [4, 0.5], [0.5, 0]]);

const labIds: Record<string, number> = {};

interface Submission {
  id: number;
  studentEmail: string;
  credit: boolean;
  effectiveCredit: boolean;
  status: 'done' | 'redo' | 'check';
  statusReason: string | null;
  heldFor: string[] | null;
  flags: string[];
  mic: 'on' | 'off';
  pausesAnswered: number | null;
  pausesCounted: number | null;
  rejectedAnswers: number;
  pauseResults: [number, number][] | null;
}

async function withTeacher<T>(work: (teacher: TeacherApi) => Promise<T>): Promise<T> {
  const teacher = await TeacherApi.signIn();
  try {
    return await work(teacher);
  } finally {
    await teacher.dispose();
  }
}

/**
 * Waits (the lab plays in real time) until the server has this student's
 * turned-in lab, and returns it as the teacher's Review page gets it. One
 * teacher sign-in for the whole wait: /auth is rate-limited.
 */
function turnedIn(title: string, person: Person, timeout: number): Promise<Submission> {
  return withTeacher(async (teacher) => {
    const mine = async () => (await teacher.query<{ submissions: Submission[] }>('labs.submissions', { labId: labIds[title] }))
      .submissions.filter((s) => s.studentEmail === person.email);
    await expect.poll(async () => (await mine()).length, { timeout, intervals: [1000] }).toBe(1);
    return (await mine())[0];
  });
}

test.beforeAll(async () => {
  await withTeacher(async (teacher) => {
    await teacher.allowEmails(STUDENT_EMAIL_PATTERN);
    await teacher.mutate('admin.importGoogleClassroomGroup', { name: GROUP, csvContent: rosterCsv([IKER, NORA, PABLO, ROSA, SARA, TOMAS]) });
    await teacher.mutate('labs.saveSettings', { minAnsweredPct: 75 });
  });
});

test.afterAll(async () => {
  // labs-journey starts from the rule as a new server has it: off.
  await withTeacher((teacher) => teacher.mutate('labs.saveSettings', { minAnsweredPct: 0 }));
});

/** What a console script can see of the page: what the session's begin returned, and the page's own reports. */
function watchSession(page: Page) {
  const reports: { kind: string; positionMs: number; clientMs: number }[] = [];
  page.on('request', (req: Request) => {
    if (!req.url().includes('labs.heartbeat') || req.method() !== 'POST') return;
    const body = req.postDataJSON() as Record<string, { kind: string; positionMs: number; clientMs: number }> | null;
    for (const input of Object.values(body ?? {})) if (input && typeof input.clientMs === 'number') reports.push(input);
  });
  type Begun = { id: number; startToken: string; pauses: [number, number][]; requiredThroughMs: number };
  const begun = page.waitForResponse((res) => res.url().includes('labs.begin')).then(async (res) => {
    const json = await res.json() as { result: { data: Begun } }[] | { result: { data: Begun } };
    return (Array.isArray(json) ? json[0] : json).result.data;
  });
  return { reports, begun };
}

/**
 * The sim's C1 script: once playback is past a counted pause (as begin listed
 * it), a report of its own for that pause, sent from the page with the page's
 * session, its CSRF cookie and a clock read off the page's last report of one
 * of `clockFrom`'s kinds, so it lands in the same playback. After a seek, the
 * seek's own report is the one that tells where the page's clock stands.
 */
async function injectAfter(page: Page, session: ReturnType<typeof watchSession>, index: number, voicedMs = 1500,
  clockFrom: string[] = ['tick', 'play']) {
  const { id: labId, startToken, pauses } = await session.begun;
  const [start, end] = pauses[index];
  await page.waitForFunction((after) => (document.querySelector('audio')?.currentTime ?? 0) * 1000 > after, end + 300);
  const last = [...session.reports].reverse().find((r) => clockFrom.includes(r.kind));
  if (!last) throw new Error('the page sent no report to copy the clock from');
  const status = await page.evaluate(async ({ labId, startToken, last, start, voicedMs }) => {
    const positionMs = Math.round((document.querySelector('audio')?.currentTime ?? 0) * 1000);
    const csrf = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('libresrs_csrf='))?.slice('libresrs_csrf='.length) ?? '';
    const res = await fetch('/api/trpc/labs.heartbeat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({
        labId, startToken, kind: 'tick', positionMs, clientMs: Math.round(last.clientMs + (positionMs - last.positionMs)),
        answers: [[start, voicedMs]],
      }),
    });
    return res.status;
  }, { labId, startToken, last, start, voicedMs });
  expect(status).toBe(200);
}

/**
 * The script turns the lab in itself, before the page does, as soon as the
 * audio is past must-hear-through (less the server's 1.5 s of tolerance):
 * `fields` say what it likes about the microphone and the voice.
 */
async function scriptSubmit(page: Page, session: ReturnType<typeof watchSession>, fields: Record<string, unknown>) {
  const { id: labId, startToken, requiredThroughMs } = await session.begun;
  await page.waitForFunction((after) => (document.querySelector('audio')?.currentTime ?? 0) * 1000 > after, requiredThroughMs - 1000);
  const last = [...session.reports].reverse().find((r) => r.kind === 'tick' || r.kind === 'play');
  if (!last) throw new Error('the page sent no report to copy the clock from');
  const status = await page.evaluate(async ({ labId, startToken, last, fields }) => {
    const positionMs = Math.round((document.querySelector('audio')?.currentTime ?? 0) * 1000);
    const csrf = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('libresrs_csrf='))?.slice('libresrs_csrf='.length) ?? '';
    const res = await fetch('/api/trpc/labs.submit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({
        labId, startToken, positionMs, clientMs: Math.round(last.clientMs + (positionMs - last.positionMs)),
        listenWallMs: positionMs, ...fields,
      }),
    });
    return res.status;
  }, { labId, startToken, last, fields });
  expect(status).toBe(200);
}

/** From the Labs page to the lab's microphone check. */
async function openLab(page: Page, title: string) {
  await page.goto('/labs');
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });
  await item.getByRole('button', { name: /^(Start|Do it again)$/ }).click();
}

/** Turns the microphone on and says "hola" until "Start the lab" turns on, then goes quiet. */
async function micCheck(page: Page) {
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  const start = page.getByRole('button', { name: 'Start the lab' });
  await expect(start).toBeDisabled();
  await setMicLevel(page, SPEAKING);
  await expect(start).toBeEnabled();
  await setMicLevel(page, 0);
}

/** Answers out loud in every pause: 1.6 s from 0.4 s after each starts. */
const answerEvery = (pauses: [number, number][]) => pauses.map(([s]) => [s + 400, s + 2000] as [number, number]);

test('the teacher uploads three labs for the class (their pauses found in the browser)', async ({ page }) => {
  await signIn(page, TEACHER);
  await page.goto('/admin?tab=labs');
  await page.getByLabel('Lab audio files').setInputFiles([
    { name: 'ES1_Lab_integridad01.wav', mimeType: 'audio/wav', buffer: pauseLabWav(2) },
    { name: 'ES1_Lab_integridad02.wav', mimeType: 'audio/wav', buffer: longLabWav() },
    { name: 'ES1_Lab_integridad03.wav', mimeType: 'audio/wav', buffer: longLabWav() },
  ]);
  for (const file of ['ES1_Lab_integridad01', 'ES1_Lab_integridad02', 'ES1_Lab_integridad03']) {
    await expect(page.getByRole('row', { name: new RegExp(`${file}\\.wav`) })).toContainText('Ready', { timeout: 20_000 });
  }
  await page.getByRole('checkbox', { name: GROUP }).check();
  await page.getByRole('checkbox', { name: /Show to students now/ }).check();
  await page.getByRole('button', { name: 'Upload 3 lab(s)' }).click();
  await expect(page.getByRole('row', { name: /ES1_Lab_integridad03\.wav/ })).toContainText('Uploaded');

  await withTeacher(async (teacher) => {
    const labs = await teacher.query<{ id: number; title: string; pauseCount: number }[]>('labs.adminList');
    for (const [title, count] of [[SHORT, 2], [LONG_A, 10], [LONG_B, 10]] as const) {
      const lab = labs.find((l) => l.title === title)!;
      expect(lab.pauseCount).toBe(count);
      labIds[title] = lab.id;
    }
    await expect(teacher.query('labs.settings')).resolves.toMatchObject({ minAnsweredPct: 75 });
  });
});

test('a console script that adds its own pause results gets nothing: two in one playback, none counts (C1)', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, IKER);
  const session = watchSession(page);
  await openLab(page, SHORT);
  await micCheck(page);
  // Silent in both pauses; the script says 1.5 s in each, just after each ends.
  await page.getByRole('button', { name: 'Start the lab' }).click();
  for (const index of [0, 1]) await injectAfter(page, session, index);

  const row = await turnedIn(SHORT, IKER, SHORT_MS + 30_000);
  expect(row).toMatchObject({ credit: false, status: 'redo', heldFor: null, pausesAnswered: 0, pausesCounted: 2 });
  expect(row.flags).toContain('odd-answers');
  // Each pause shows as "two results in one playback" (-2), and all four results were refused.
  expect(row.pauseResults!.map(([, v]) => v)).toEqual([-2, -2]);
  expect(row.rejectedAnswers).toBe(4);
});

test('the same script answering in a Back 10 s replay gets nothing: the page reports the replay too (R1)', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, TOMAS);
  const session = watchSession(page);
  await openLab(page, SHORT);
  await micCheck(page);
  const [first] = PAUSE_LAB_PAUSES;
  // Silent through the first pause, then Back 10 s (to the start) to hear it again, silent again.
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await page.waitForFunction((after) => (document.querySelector('audio')?.currentTime ?? 0) * 1000 > after, first[1] + 200);
  await page.getByRole('button', { name: 'Back 10 s' }).click();
  // The script's 1.5 s, 0.3 s after the replayed window, on the page's clock as its seek report gives it.
  await injectAfter(page, session, 0, 1500, ['tick', 'play', 'seek']);

  const row = await turnedIn(SHORT, TOMAS, SHORT_MS + 40_000);
  expect(row).toMatchObject({ credit: false, status: 'redo', heldFor: null, pausesAnswered: 0, pausesCounted: 2 });
  expect(row.flags).toContain('odd-answers');
  // The first pass's 0 stands; in the replay, the page's own 0 and the script's 1.5 s were both refused.
  expect(row.pauseResults!.map(([, v]) => v)).toEqual([0, 0]);
  expect(row.rejectedAnswers).toBe(2);
});

test('the same script after “My mic doesn’t work”, turning it in itself “with the mic on”, waits for the teacher', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, NORA);
  page.on('dialog', (dialog) => void dialog.accept());
  const session = watchSession(page);
  await openLab(page, SHORT);
  await page.getByRole('button', { name: "My mic doesn't work" }).click();
  await page.getByRole('button', { name: 'Start the lab' }).click();
  for (const index of [0, 1]) await injectAfter(page, session, index);
  // The page said where it went on without a microphone, before the audio started.
  expect(session.reports.findIndex((r) => r.kind === 'nomic')).toBeGreaterThanOrEqual(0);
  expect(session.reports.findIndex((r) => r.kind === 'nomic')).toBeLessThan(session.reports.findIndex((r) => r.kind === 'play'));
  await scriptSubmit(page, session, { mic: 'on', voicedMs: 0 });

  const row = await turnedIn(SHORT, NORA, SHORT_MS + 30_000);
  // Both "answered", which would meet the rule: held, not credited, and without a microphone whatever the script said.
  expect(row).toMatchObject({
    credit: false, status: 'check', statusReason: 'held', heldFor: ['odd-answers'], mic: 'off', pausesAnswered: 2,
  });
  expect(row.flags).toEqual(expect.arrayContaining(['odd-answers', 'no-mic']));
  // The page's own submit, when the audio ends, gets the same row back.
  await expect(page.getByRole('status')).toContainText('Turned in without a microphone. Your teacher will check it.', { timeout: 15_000 });
  await expect(page.getByRole('status')).not.toContainText('If your microphone works again');

  await page.goto('/labs');
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: SHORT }) });
  await expect(item).toContainText('Waiting for your teacher to check it.');
});

test('an answer given while the lab is paused counts, with no flag (the sim’s A8)', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, PABLO);
  await openLab(page, SHORT);
  await micCheck(page);
  const [first, second] = PAUSE_LAB_PAUSES;
  // The voice follows the audio's position: around 2 s into the lab, where Pablo pauses, and in the second pause.
  await setMicPlan(page, [[first[0] + 800, first[0] + 1600], [second[0] + 400, second[0] + 2000]]);
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await page.waitForFunction((at) => (document.querySelector('audio')?.currentTime ?? 0) * 1000 > at, first[0] + 1000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // Answering while paused, for a second and a half.
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Resume' }).click();

  const row = await turnedIn(SHORT, PABLO, SHORT_MS + 30_000);
  expect(row).toMatchObject({ credit: true, status: 'done', heldFor: null, pausesAnswered: 2, rejectedAnswers: 0 });
  expect(row.flags).toEqual([]);
  expect(row.pauseResults![0][1]).toBeGreaterThanOrEqual(250);
});

test('a Back 10 s replay that improves a pause counts, with no flag', async ({ page }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, ROSA);
  await openLab(page, SHORT);
  await micCheck(page);
  const [first] = PAUSE_LAB_PAUSES;
  // Silent through the first pause...
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await page.waitForFunction((after) => (document.querySelector('audio')?.currentTime ?? 0) * 1000 > after, first[1] + 200);
  // ...then back to the start, answering this time.
  await setMicPlan(page, answerEvery(PAUSE_LAB_PAUSES));
  await page.getByRole('button', { name: 'Back 10 s' }).click();

  const row = await turnedIn(SHORT, ROSA, SHORT_MS + 40_000);
  expect(row).toMatchObject({ credit: true, status: 'done', heldFor: null, pausesAnswered: 2, rejectedAnswers: 0 });
  expect(row.flags).toEqual([]);
  expect(row.pauseResults![0][1]).toBeGreaterThanOrEqual(250);

  // The log shows the first pause reported on both passes: two playbacks, one result each.
  const results = await withTeacher(async (teacher) => {
    const users = await teacher.query<{ id: number; email: string }[]>('admin.getUsers');
    const rosa = users.find((u) => u.email === ROSA.email)!;
    const sessions = await teacher.query<{ submitted: boolean; events: { kind: string; answers: [number, number][] | null }[] }[]>(
      'labs.listenLog', { labId: labIds[SHORT], userId: rosa.id },
    );
    return sessions.find((s) => s.submitted)!.events.flatMap((e) => e.answers ?? []).filter(([s]) => s === row.pauseResults![0][0]);
  });
  expect(results.length).toBeGreaterThanOrEqual(2);
  expect(results[0][1]).toBeLessThan(250);
});

test('two different labs played at once: the first turned in counts, the second waits for the teacher', async ({ page, context }) => {
  test.slow();
  await scriptedMicrophone(page);
  await signIn(page, SARA);
  // Window one: lab A.
  await openLab(page, LONG_A);
  await micCheck(page);
  await setMicPlan(page, answerEvery(LONG_PAUSES));
  await page.getByRole('button', { name: 'Start the lab' }).click();

  // Window two, same browser and sign-in: lab B, a few seconds later.
  const second = await context.newPage();
  await scriptedMicrophone(second);
  await openLab(second, LONG_B);
  await micCheck(second);
  await setMicPlan(second, answerEvery(LONG_PAUSES));
  await second.getByRole('button', { name: 'Start the lab' }).click();

  const first = await turnedIn(LONG_A, SARA, LONG_MS + 60_000);
  const next = await turnedIn(LONG_B, SARA, LONG_MS + 60_000);
  // Both answered enough, and both were playing at once.
  expect(first).toMatchObject({ credit: true, status: 'done', heldFor: null });
  expect(first.flags).toContain('overlap');
  expect(next).toMatchObject({ credit: false, status: 'check', statusReason: 'held', heldFor: ['overlap'] });
  expect(next.flags).toContain('overlap');
  expect(next.pausesAnswered).toBeGreaterThanOrEqual(8);

  // The teacher's Labs list counts the held one as waiting.
  await withTeacher(async (teacher) => {
    const labs = await teacher.query<{ title: string; checkCount: number; doneCount: number }[]>('labs.adminList');
    expect(labs.find((l) => l.title === LONG_B)).toMatchObject({ checkCount: 1, doneCount: 0 });
    expect(labs.find((l) => l.title === LONG_A)).toMatchObject({ doneCount: 1 });
  });
});
