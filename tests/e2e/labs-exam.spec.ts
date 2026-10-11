// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0) in a real browser, with a mocked server: test audio as
 * its own thing. Students find tests on their own Tests page (v1.21.0), with
 * each set's speaking tests, through a "Tests" notice apart from the practice
 * labs; the Labs page only points there. A test has no microphone, shows its rules in
 * English and Spanish, gets its audio only from a start the server confirmed
 * (labs.startExam, once), and plays straight through: no Back or Pause, and
 * the headset, lock screen and keys cannot pause or move it. A lost connection
 * still pauses it, and Resume carries on from where it stopped. A used start
 * is refused with "Ask your teacher". The teacher makes a lab a test in its
 * Edit row and resets a student's one start from the set's list.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/axe';
import { serveAudio, wav } from './support/labWav';
import { TrpcMockError, mockAdminTrpc, mockAuthenticatedTrpc } from './support/trpcMock';

// No autoplay gate, as in the other lab specs.
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required'],
    firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
  },
});

/** A test's audio in miniature: the text read twice, 10 s in all. */
const EXAM_MS = 10_000;
const examWav = () => wav([[2, 0.5], [0.5, 0], [2, 0.4], [0.5, 0], [2, 0.5], [0.5, 0], [2, 0.4], [0.5, 0]]);

const STARTED_AT = Date.parse('2026-10-08T16:05:00Z');

/** A lab as labs.list({ exams: true }) sends it; `exam` only on a test. */
function listed(id: number, title: string, exam?: { set: string; start?: unknown; preview?: boolean }) {
  return {
    id, title, description: null, durationMs: EXAM_MS, requiredThroughMs: 9_000,
    status: 'todo', redoByTeacher: false, submittedAt: null, attempts: 0, pausesAnswered: null, pausesCounted: null, needed: null,
    ...(exam ? { exam: { set: exam.set, preview: exam.preview ?? false, start: exam.start ?? null } } : {}),
  };
}

const FORM_A = listed(41, 'Examen U3 · Escucha · Forma A', { set: 'U3' });
const FORM_B = listed(42, 'Examen U3 · Escucha · Forma B', { set: 'U3' });
const U2_START = { labId: 51, title: 'Examen U2 · Escucha · Forma A', startedAt: STARTED_AT, finished: true };
const U2_A = listed(51, 'Examen U2 · Escucha · Forma A', { set: 'U2', start: U2_START });
const PRACTICE = listed(1, 'ES1 Lab semana01');

/** Speaking tasks as speaking.list sends them (v1.21.0): `examSet` names a speaking test's set. */
const spoken = (id: number, title: string, examSet: string | null) => ({
  id, title, targetSeconds: 60, submittedAt: null, attempts: 0, littleSpeech: false, examSet,
});
const CUENTO = spoken(1, 'Cuento semana 3', null);
const U3_SPEAKING = spoken(7, 'Examen U3 · Expresión oral', 'U3');

/** What labs.begin sends for a test: no audio until the start, no pauses, no rule. */
const beginExam = {
  id: 41, title: FORM_A.title, description: null, audioUrl: null, durationMs: EXAM_MS, requiredThroughMs: 9_000,
  minimumVoicedMs: 0, startToken: '1790000000000.exam', pauses: null, minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6,
  needed: null, exam: 'U3', examPreview: false,
};

type Submit = Record<string, unknown> & { mic?: string; voicedMs?: number; answers?: unknown[] };

/**
 * Before the page loads: counts getUserMedia calls (a test must never ask) and
 * keeps the MediaSession handlers the page sets, so the test can press them as
 * a headset or the lock screen would.
 */
async function watchMedia(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __mics: number; __handlers: Record<string, (() => void) | null> };
    w.__mics = 0;
    w.__handlers = {};
    const devices = navigator.mediaDevices;
    if (devices) {
      devices.getUserMedia = async () => {
        w.__mics += 1;
        throw new DOMException('not in a test', 'NotAllowedError');
      };
    }
    const session = navigator.mediaSession;
    if (session) {
      const original = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => {
        w.__handlers[action] = handler as (() => void) | null;
        try { original(action, handler); } catch { /* not supported here */ }
      };
    }
  });
}

/** Presses a MediaSession action the way the OS would (when the browser supports it). */
const pressMediaAction = (page: Page, action: string) => page.evaluate((name) => {
  const handler = (window as unknown as { __handlers: Record<string, ((details: unknown) => void) | null> }).__handlers[name];
  handler?.({ action: name, seekOffset: 5, seekTime: 0 });
  return typeof handler === 'function';
}, action);

const audioState = (page: Page) => page.evaluate(() => {
  const audio = document.querySelector('audio')!;
  return { src: audio.getAttribute('src'), paused: audio.paused, time: audio.currentTime };
});

/** A student on a test's page, with a mocked server that keeps what it is sent. */
async function openTest(page: Page, options: { clock?: boolean; startExam?: (input: unknown) => unknown; begin?: (input: unknown) => unknown } = {}) {
  await watchMedia(page);
  if (options.clock) await page.clock.install();
  const run = {
    starts: [] as unknown[],
    reports: [] as { kind: string; positionMs: number }[],
    submits: [] as Submit[],
    dialogs: [] as string[],
    offline: false,
  };
  page.on('dialog', (d) => { run.dialogs.push(d.message()); void d.accept(); });
  await mockAuthenticatedTrpc(page, {
    labs: [FORM_A, FORM_B],
    mutations: {
      'labs.begin': options.begin ?? beginExam,
      'labs.startExam': (input: unknown) => {
        run.starts.push(input);
        if (options.startExam) return options.startExam(input);
        return { audioUrl: '/exam-u3-a.wav', examSet: 'U3', startId: 7, startedAt: Date.now(), preview: false };
      },
      'labs.heartbeat': (input: unknown) => {
        if (run.offline) throw new TrpcMockError('Service unavailable', 'INTERNAL_SERVER_ERROR', 503);
        run.reports.push(input as (typeof run.reports)[number]);
        return { recorded: true, nextInMs: 5000 };
      },
      'labs.submit': (input: unknown) => {
        run.submits.push(input as Submit);
        return { success: true, result: { submissionId: 9, credit: true, status: 'done', scored: false, pausesAnswered: null, pausesCounted: null, needed: null, mic: 'off' } };
      },
    },
  });
  const body = examWav();
  await page.route('**/exam-u3-a.wav', (route) => serveAudio(route, body));
  return run;
}

/** A set's card on the Tests page. */
const setCard = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

test.describe('a student’s Tests page and front page', () => {
  test('tests have their own notice and page, apart from the practice labs and tasks', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { labs: [PRACTICE, FORM_A, FORM_B, U2_A], speakingTasks: [CUENTO, U3_SPEAKING] });
    await page.goto('/');
    // U3 not started and its speaking test not turned in; U2 started. The practice lab and task count on their own.
    const tests = page.getByRole('link', { name: /^Tests/ });
    await expect(tests).toContainText('2 test(s) to take');
    await expect(page.getByRole('link', { name: /Audio labs/ })).toContainText('1 lab(s) to do');
    await expect(page.getByRole('link', { name: /Speaking/ })).toContainText('1 recording(s) to do');
    await tests.click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tests' })).toBeVisible();

    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Test U2', 'Test U3']);
    const u3 = setCard(page, 'Test U3');
    await expect(u3).toContainText('Open only the form printed on your paper. You can start one form of each test, once.');
    await expect(u3.getByRole('button', { name: /^Start: Examen U3 · Escucha/ })).toHaveCount(2);
    // Its speaking test, under Speaking, opening the same runner as the Speaking page's tasks.
    await expect(u3.getByRole('heading', { level: 3, name: 'Speaking' })).toBeVisible();
    await expect(u3).toContainText('Not done yet');
    await expect(u3.getByRole('button', { name: 'Start: Examen U3 · Expresión oral' })).toBeVisible();

    const u2 = setCard(page, 'Test U2');
    await expect(u2).toContainText('You started Examen U2 · Escucha · Forma A on');
    await expect(u2).toContainText('Turned in.');
    await expect(u2).toContainText('To start again, ask your teacher.');
    await expect(u2.getByRole('button')).toHaveCount(0);
    // Never a practice item.
    await expect(page.getByRole('main')).not.toContainText('ES1 Lab semana01');
    await expect(page.getByRole('main')).not.toContainText('Cuento semana 3');

    // The Labs page lists the practice labs only, and points here.
    await page.goto('/labs');
    await expect(page.getByRole('heading', { name: 'ES1 Lab semana01' })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Examen');
    await page.getByRole('link', { name: 'Go to Tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(setCard(page, 'Test U3')).toBeVisible();
  });

  test('the Tests page passes the accessibility scan', async ({ page }, testInfo) => {
    test.skip(!['chromium', 'mobile-safari'].includes(testInfo.project.name), 'axe runs in chromium and mobile-safari only');
    await mockAuthenticatedTrpc(page, { labs: [PRACTICE, FORM_A, FORM_B, U2_A], speakingTasks: [CUENTO, U3_SPEAKING] });
    await page.goto('/tests');
    await expect(setCard(page, 'Test U3')).toBeVisible();
    await expectNoA11yViolations(page, { label: 'tests page' });
  });
});

test.describe('a test in a real browser', () => {
  test('no microphone, the rules in both languages, one confirmed start, then straight through and turned in', async ({ page }) => {
    const run = await openTest(page);
    // From the Tests page: the same runner, opened there.
    await page.goto('/tests');
    await page.getByRole('button', { name: 'Start: Examen U3 · Escucha · Forma A' }).click();
    await expect(page).toHaveURL(/\/tests\?lab=41$/);

    await expect(page.getByText('Headphones on.')).toBeVisible();
    await expect(page.getByText('Ponte los auriculares.')).toBeVisible();
    await expect(page.getByText("Don't close or reload this page. You can start this test only once.")).toBeVisible();
    await expect(page.getByText('No cierres ni recargues esta página. Solo puedes empezar este examen una vez.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
    // Fail closed: before the start the page has no audio at all.
    expect((await audioState(page)).src).toBeNull();

    await page.getByRole('button', { name: 'Start the test' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(run.dialogs).toEqual(['Start Examen U3 · Escucha · Forma A? You can start one form of this test, once. Check that it is the form on your paper.']);
    expect(run.starts).toEqual([{ labId: 41, startToken: '1790000000000.exam' }]);
    expect((await audioState(page)).src).toBe('/exam-u3-a.wav');

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    for (const name of ['Pause', 'Back 10 s', 'Start over']) await expect(page.getByRole('button', { name })).toHaveCount(0);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(1);

    // A headset or the lock screen: nothing pauses, stops or moves it.
    const before = (await audioState(page)).time;
    for (const action of ['pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) {
      await pressMediaAction(page, action);
    }
    // The keys: nothing either (the focus is on the page, not a button).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const key of ['ArrowLeft', 'ArrowRight', 'j', 'k', 'l', 'Space']) await page.keyboard.press(key);
    await page.evaluate(() => {
      for (const key of ['MediaPlayPause', 'MediaTrackPrevious']) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }
    });
    const after = await audioState(page);
    expect(after.paused).toBe(false);
    expect(after.time).toBeGreaterThanOrEqual(before);
    expect(after.time).toBeLessThan(before + 3);
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();

    // A move from a console is put back: well past the 1.5 s a seek may land off by, and read at once, after
    // the move has settled (polling would pass anyway, as the audio plays on from 0).
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(4);
    const reached = (await audioState(page)).time;
    const landed = await page.evaluate(() => new Promise<number>((resolve) => {
      const audio = document.querySelector('audio')!;
      audio.addEventListener('seeked', () => setTimeout(() => resolve(audio.currentTime), 100), { once: true });
      audio.currentTime = 0;
    }));
    expect(landed).toBeGreaterThan(reached - 0.5);

    await expect(page.getByText('Turned in. Your answers go on your paper.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Do it again' })).toHaveCount(0);
    expect(run.submits).toHaveLength(1);
    expect(run.submits[0]).toMatchObject({ labId: 41, startToken: '1790000000000.exam', mic: 'off', voicedMs: 0, answers: [] });
    expect(run.submits[0]).not.toHaveProperty('outsideVoicedMs');
    expect(run.reports.map((r) => r.kind)).toContain('end');
    expect(await page.evaluate(() => (window as unknown as { __mics: number }).__mics)).toBe(0);
    expect(run.starts).toHaveLength(1);

    // Back to the Tests page it came from.
    await page.getByRole('button', { name: 'Back to tests' }).last().click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(setCard(page, 'Test U3')).toBeVisible();
  });

  test('a lost connection pauses it; once it is back, Resume carries on from where it stopped', async ({ page }) => {
    const run = await openTest(page, { clock: true });
    await page.goto('/labs?lab=41');
    await page.getByRole('button', { name: 'Start the test' }).click();
    // The start is confirmed; from Play on, no report gets through.
    run.offline = true;
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.8);

    // Ninety seconds on the page's clock with the Play report still unconfirmed: the test waits for the
    // connection. (fastForward fires each due timer once, at the end, so the stuck report must already be queued.)
    await page.clock.fastForward(91_000);
    await expect(page.getByText('Lost the connection. The lab is paused until it comes back.')).toBeVisible();
    expect(run.reports).toEqual([]);
    const resume = page.getByRole('button', { name: 'Resume' });
    await expect(resume).toBeDisabled();
    const stopped = await audioState(page);
    expect(stopped.paused).toBe(true);
    expect(stopped.time).toBeGreaterThan(0.8);

    run.offline = false;
    await page.clock.fastForward(6_000);
    await expect(page.getByText('The connection is back. Press Resume to carry on.')).toBeVisible();
    await resume.click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    const resumed = await audioState(page);
    expect(resumed.paused).toBe(false);
    expect(resumed.time).toBeGreaterThanOrEqual(stopped.time - 0.25);
  });

  test('a used start: opening the test again is refused in both languages', async ({ page }) => {
    await openTest(page, {
      begin: () => { throw new TrpcMockError('You already started this test. Ask your teacher.', 'CONFLICT', 409, 'EXAM_USED'); },
    });
    // A direct link, as before v1.21.0: the same runner, and its way back goes to the Tests page.
    await page.goto('/labs?lab=41');
    await expect(page.getByRole('alert')).toContainText('You already started this test. Ask your teacher.');
    await expect(page.getByRole('alert')).toContainText('Ya empezaste este examen. Pregúntale a tu profesor.');
    await expect(page.locator('audio')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(setCard(page, 'Test U3')).toBeVisible();
  });

  test('a start another tab already used is refused at Start, and no audio comes', async ({ page }) => {
    const run = await openTest(page, {
      startExam: () => { throw new TrpcMockError('You already started this test. Ask your teacher.', 'CONFLICT', 409, 'EXAM_USED'); },
    });
    await page.goto('/labs?lab=41');
    await page.getByRole('button', { name: 'Start the test' }).click();
    await expect(page.getByRole('alert')).toContainText('Ya empezaste este examen. Pregúntale a tu profesor.');
    await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Start the test|Try again/ })).toHaveCount(0);
    expect((await audioState(page)).src).toBeNull();
    expect(run.starts).toHaveLength(1);
  });
});

test.describe('the teacher', () => {
  const scan = { minPauseMs: 3300, thresholdDb: -41.2, noiseDb: -200, shortestKeptMs: 3540, longestLeftOutMs: 2100, closeCalls: 0, scannedAt: Date.parse('2026-09-20T00:00:00Z') };
  const adminLab = (id: number, title: string, examSet: string | null) => ({
    id, title, description: null, audioUrl: `/api/assets/lab-${id}.mp3`, mimeType: 'audio/mpeg',
    durationMs: 100_000, requiredThroughMs: 95_000, active: true, createdBy: 1, createdAt: '2026-09-20T00:00:00.000Z',
    forEveryone: false, groupIds: [1],
    pauseCount: examSet ? null : 20, pauseTotal: examSet ? null : 20, pauseScan: examSet ? null : scan, pauseCountUntilMs: null, needsCheck: false,
    turnedInCount: 0, studentCount: 0, doneCount: 0, redoCount: 0, checkCount: 0, flaggedCount: 0, lookCount: 0, lastSubmittedAt: null,
    examSet,
  });
  const anaStart = {
    startId: 11, labId: 41, labTitle: 'Examen U3 · Forma A', source: 'start', startedAt: STARTED_AT,
    heardThroughMs: 47_000, durationMs: 100_000, requiredThroughMs: 95_000, finished: false,
    lastSeenAt: STARTED_AT + 60_000, resetAt: null, resetByName: null,
  };

  test('makes a lab a test, sees the set, and resets a student’s one start from the set’s list', async ({ page }) => {
    const updates: unknown[] = [];
    const resets: unknown[] = [];
    let anaReset = false;
    await mockAdminTrpc(page, {
      queries: {
        'labs.adminList': [adminLab(1, 'ES1 Lab semana01', null), adminLab(41, 'Examen U3 · Forma A', 'U3')],
        'labs.examSets': () => [{
          examSet: 'U3', labs: [{ id: 41, title: 'Examen U3 · Forma A', active: true }],
          studentCount: 2, startedCount: anaReset ? 0 : 1, finishedCount: 0, resetCount: anaReset ? 1 : 0,
        }],
        'labs.examRoster': () => ({
          examSet: 'U3',
          labs: [{ id: 41, title: 'Examen U3 · Forma A', active: true, durationMs: 100_000, requiredThroughMs: 95_000 }],
          students: [
            {
              userId: 2, name: 'Ana López', email: 'ana@students.school.test', assigned: true,
              current: anaReset ? null : anaStart,
              earlier: anaReset ? [{ ...anaStart, resetAt: STARTED_AT + 3_600_000, resetByName: 'Admin User' }] : [],
            },
            { userId: 3, name: 'Ben Ruiz', email: 'ben@students.school.test', assigned: true, current: null, earlier: [] },
          ],
        }),
      },
      mutations: {
        'labs.update': (input: unknown) => { updates.push(input); return { success: true, examSet: 'U2', pastStarts: 3 }; },
        'labs.resetExamStart': (input: unknown) => {
          resets.push(input);
          anaReset = true;
          return { startId: 11, userId: 2, examSet: 'U3', resetAt: STARTED_AT + 3_600_000 };
        },
      },
    });
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    await page.goto('/admin?tab=labs');

    const sets = page.getByRole('region', { name: 'Tests (exam sets)' });
    await expect(sets.getByRole('heading', { name: 'Exam set U3' })).toBeVisible();
    await expect(sets).toContainText('1 of 2 started · 0 turned in · 0 reset(s)');
    const row = (title: string) => page.getByRole('row', { name: new RegExp(title) });
    await expect(row('Forma A')).toContainText('Test · U3');

    // The Edit row's switch: a practice lab becomes a form of U2.
    await row('semana01').getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: 'Exam (test audio)' }).check();
    await expect(page.getByText(/The audio file is still a public link/)).toBeVisible();
    await page.getByRole('combobox', { name: 'Exam set' }).fill(' U2 ');
    await page.getByRole('table').last().getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('3 student(s) who already played this lab count as started in U2.')).toBeVisible();
    expect(updates).toEqual([expect.objectContaining({ id: 1, examSet: 'U2' })]);

    // The set's students: Reset asks, then gives Ana one more start; her earlier play stays listed.
    await sets.getByRole('button', { name: 'Students and resets: U3' }).click();
    await expect(page.getByRole('heading', { name: 'Exam set U3' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Ana López/ })).toContainText('0:47 of 1:40');
    await expect(page.getByRole('row', { name: /Ben Ruiz/ })).toContainText('Not started');
    await page.getByRole('button', { name: 'Reset: Ana López' }).click();
    await expect.poll(() => resets).toEqual([{ startId: 11 }]);
    expect(dialogs).toEqual(['Give Ana López one more start in U3? Their earlier play stays in the record.']);
    await expect(page.getByRole('button', { name: 'Reset: Ana López' })).toHaveCount(0);
    await expect(page.getByText(/Earlier: Examen U3 · Forma A · .* by Admin User/)).toBeVisible();

    await page.getByRole('button', { name: 'Back to labs' }).click();
    await expect(sets).toContainText('0 of 2 started · 0 turned in · 1 reset(s)');
  });
});
