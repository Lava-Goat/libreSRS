// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Speaking in the pauses (v1.15.0), on the student's page in a real browser:
 * the microphone check before Start, going on without a microphone, the
 * nudges in and after each pause, the per-pause results riding on the
 * listening reports, Back 10 s, the connection pause, what a submit carries,
 * and the end screens the server's result decides.
 *
 * v1.16.0's voice meter: a sound counts only when it stands out from the room
 * and is pitched, so desk taps and class babble answer nothing (the old
 * −45 dBFS meter answered every pause with them), while a voice over the
 * babble still does; the mic check passes on a loud room with a line asking
 * the student to speak up; the tally says how many are needed and how many
 * pauses are left, and when enough are answered; a microphone lost mid-lab
 * says what the pauses before it are worth, and the end screen offers a redo.
 *
 * The microphone is scripted (support/scriptedMicrophone.ts): the test decides
 * when the student speaks, and what else the room holds, by the lab audio's
 * own clock, in every engine. The lab is support/labWav.ts's pause lab: two
 * 3.6 s answer pauses in 10.7 s. The mocked server scores the pauses the way
 * the real one does (at least 0.25 s of voice answers a pause) from every
 * result it was sent, and tells a page older than this one to reload.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  SPEAKING, loseMicrophone, micLevelForDb, scriptedMicrophone, seenTexts, setMicBackground, setMicLevel, setMicPlan, watchTexts,
} from './support/scriptedMicrophone';
import { PAUSE_LAB_PAUSES, pauseLabMs, pauseLabWav, serveAudio } from './support/labWav';
import { TrpcMockError, mockAuthenticatedTrpc } from './support/trpcMock';

// No autoplay gate, so the lab and the scripted microphone's audio context start wherever the browser allows.
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required'],
    firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
  },
});

const LAB_MS = pauseLabMs();
const [PAUSE_1, PAUSE_2] = PAUSE_LAB_PAUSES;
const FLOOR_MS = 250;

const QUIET = "We can't hear you. Answer out loud.";
const SOUND = 'We hear sound, but not a voice. Answer out loud.';
const HEARD = 'Heard you.';
const MISSED = 'Missed that pause. Answer out loud in the next one.';
const CANT_COUNT = "This lab can't count now. You can start over.";
const ENOUGH = 'Pauses answered: 2 · That should be enough for the lab to count. Keep answering to the end.';
const LOST = 'Lost the connection. The lab is paused until it comes back.';
const BACK_ON = 'The connection is back. Press Resume to carry on.';
const TURNED_IN = 'Turned in. Your teacher will see that you finished it.';
const NO_MIC_END = 'Turned in without a microphone. Your teacher will check it.';
const REDO_HINT = 'If your microphone works again, you can do the lab again instead of waiting.';
const HEAR_YOU = 'We hear you. You can start.';
const HEAR_ROOM = 'We hear the room more than you. Speak up, or move closer to the microphone.';
const RELOAD = 'libreSRS was updated. Reload this page to do the lab.';
/** The page's version the server accepts (LAB_CLIENT in shared/labPauses.ts). */
const LAB_CLIENT = 3;
/** Class babble, loud enough that the old −45 dBFS meter took it for the student. */
const BABBLE_DB = -30;

const listed = {
  id: 1,
  title: 'ES1 Lab semana01',
  description: null,
  durationMs: LAB_MS,
  requiredThroughMs: LAB_MS,
  status: 'todo',
  redoByTeacher: false,
  submittedAt: null,
  attempts: 0,
  pausesAnswered: null,
  pausesCounted: null,
  needed: null,
};

type Answer = [number, number];
interface Report { labId: number; startToken: string; kind: string; positionMs: number; clientMs: number; answers?: Answer[] }
interface MicStats {
  meter: number; ambientDbP50: number | null; gateDbP50: number | null; voiceOverGateDbP50: number | null;
  levelOnlyAnswered: number | null; loudNotVoiceInPausesMs: number; unfocusedPlayedMs: number;
  micCheck: 'voice' | 'level' | null; processing: Record<string, unknown> | null;
}
interface Submit {
  labId: number; startToken: string; positionMs: number; clientMs: number; voicedMs: number; listenWallMs: number;
  mic?: 'on' | 'off'; answers?: Answer[]; reports?: Omit<Report, 'labId' | 'startToken'>[];
  outsideVoicedMs?: number; outsidePlayedMs?: number; micStats?: MicStats;
}

interface LabOptions {
  /** The share of pauses a lab needs (the session's snapshot). */
  pct?: number;
  /** Install page.clock (after the scripted microphone, whose voice must not freeze with it). */
  clock?: boolean;
  /** Replaces the begin answer's fields. */
  begin?: Record<string, unknown>;
  /** Replaces the mocked server's result. */
  result?: (sent: Submit) => Record<string, unknown>;
}

/**
 * The lab page with a scripted microphone and a mocked server that keeps
 * what it is sent: sessions opened, listening reports (in arrival order),
 * submits and "The mic didn't hear me". `offline` makes every report fail
 * like a dropped connection; they stay queued on the page.
 */
async function openPauseLab(page: Page, options: LabOptions = {}) {
  await scriptedMicrophone(page);
  await watchTexts(page, [QUIET, SOUND, HEARD, MISSED, CANT_COUNT, ENOUGH, LOST, BACK_ON, HEAR_YOU, HEAR_ROOM]);
  if (options.clock) await page.clock.install();
  const pct = options.pct ?? 75;
  const needed = Math.ceil((PAUSE_LAB_PAUSES.length * pct) / 100);
  const run = {
    begins: 0,
    beginInputs: [] as unknown[],
    reports: [] as Report[],
    submits: [] as Submit[],
    asked: [] as { submissionId: number }[],
    dialogs: [] as string[],
    offline: false,
  };
  page.on('dialog', (d) => { run.dialogs.push(d.message()); void d.accept(); });

  /** The server's rule: the best result per counted pause, from every report and the submit; 0.25 s answers it. */
  const serverResult = (sent: Submit) => {
    const best = new Map<number, number>();
    const all = [
      ...run.reports.filter((r) => r.startToken === sent.startToken).flatMap((r) => r.answers ?? []),
      ...(sent.reports ?? []).flatMap((r) => r.answers ?? []),
      ...(sent.answers ?? []),
    ];
    for (const [s, v] of all) best.set(s, Math.max(best.get(s) ?? -1, v));
    const answered = PAUSE_LAB_PAUSES.filter(([s]) => (best.get(s) ?? -1) >= FLOOR_MS).length;
    const mic = sent.mic ?? 'on';
    const credit = pct <= 0 || answered >= needed;
    return {
      submissionId: 100 + run.submits.indexOf(sent),
      credit,
      status: credit ? 'done' : mic === 'off' ? 'check' : 'redo',
      scored: true,
      pausesAnswered: answered,
      pausesCounted: PAUSE_LAB_PAUSES.length,
      needed,
      mic,
    };
  };

  await mockAuthenticatedTrpc(page, {
    labs: [listed],
    mutations: {
      'labs.begin': (input: unknown) => {
        run.beginInputs.push(input);
        // The server's rule: an older page, with the old meter, is told to reload.
        if (((input as { client?: number }).client ?? 0) < LAB_CLIENT) throw new TrpcMockError(RELOAD);
        run.begins += 1;
        return {
          ...listed,
          audioUrl: '/pause-lab.wav',
          minimumVoicedMs: 130,
          startToken: `${run.begins}.signature`,
          pauses: PAUSE_LAB_PAUSES,
          minAnsweredPct: pct,
          voicePerPauseMs: FLOOR_MS,
          gateMarginDb: 6,
          needed,
          ...options.begin,
        };
      },
      'labs.heartbeat': (input: unknown) => {
        if (run.offline) throw new TrpcMockError('Service unavailable', 'INTERNAL_SERVER_ERROR', 503);
        run.reports.push(input as Report);
        return { recorded: true, nextInMs: 5000 };
      },
      'labs.submit': (input: unknown) => {
        const sent = input as Submit;
        run.submits.push(sent);
        return { success: true, result: options.result ? options.result(sent) : serverResult(sent) };
      },
      'labs.askTeacher': (input: unknown) => {
        run.asked.push(input as { submissionId: number });
        return { status: 'check' };
      },
    },
  });
  const body = pauseLabWav();
  await page.route('**/pause-lab.wav', (route) => serveAudio(route, body));
  return run;
}

/** Where the lab audio is (ms). */
const audioMs = (page: Page) => page.evaluate(() => Math.round((document.querySelector('audio')?.currentTime ?? 0) * 1000));

/** Every pause result a report carried, in the order the server got them. */
const answersIn = (reports: { answers?: Answer[] }[]) => reports.flatMap((r) => r.answers ?? []);

/** The marks on the progress bar, one per counted pause. */
const pauseMarks = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-pause-mark]')].map((m) => m.getAttribute('data-pause-mark')).join(','));

/** "Turn on the microphone", then "hola": Start turns on. The microphone is left silent. */
async function passMicCheck(page: Page) {
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await setMicLevel(page, SPEAKING);
  await expect(page.getByText('We hear you. You can start.')).toBeVisible();
  await setMicLevel(page, 0);
}

async function startLab(page: Page) {
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
}

test.describe('before the lab starts', () => {
  test('a silent microphone keeps “Start the lab” off; a voice turns it on', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await expect(page.getByText('Do it in one sitting: about 1 minutes. The microphone checks for your voice in each pause; nothing is recorded.')).toBeVisible();
    await expect(page.getByText('Answer out loud in at least 2 of the 2 pauses for this lab to count.')).toBeVisible();

    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    const start = page.getByRole('button', { name: 'Start the lab' });
    await expect(page.getByText('Say “hola”. “Start the lab” turns on once we hear you.')).toBeVisible();
    // Longer than the check needs, in silence: still off.
    await page.waitForTimeout(1500);
    await expect(start).toBeDisabled();

    await setMicLevel(page, SPEAKING);
    await expect(page.getByText('We hear you. You can start.')).toBeVisible();
    await expect(start).toBeEnabled();
    // Heard once is enough: going quiet again does not turn it off.
    await setMicLevel(page, 0);
    await page.waitForTimeout(500);
    await expect(start).toBeEnabled();
    // The new page says so: an old one is told to reload.
    expect(run.beginInputs).toEqual([{ labId: 1, client: LAB_CLIENT }]);
  });

  test('an old page (client 2, the −45 dBFS meter) is told to reload instead of opening a session', async ({ page }) => {
    const run = await openPauseLab(page);
    // The page as v1.15 sent it: the same request, one version older.
    await page.route((url) => url.pathname.includes('labs.begin'), async (route) => {
      const body = route.request().postData() ?? '';
      await route.fallback({ postData: body.replace(`"client":${LAB_CLIENT}`, '"client":2') });
    });
    await page.goto('/labs?lab=1');
    await expect(page.getByText(RELOAD)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
    expect(run.beginInputs).toEqual([{ labId: 1, client: 2 }]);
    expect(run.begins).toBe(0);
  });

  test('exactly one session is opened each time a lab is opened', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
    // Room for development mode's second mount to open another (it must not).
    await page.waitForTimeout(700);
    expect(run.begins).toBe(1);

    await page.getByRole('button', { name: 'Back to labs' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
    await page.waitForTimeout(700);
    expect(run.begins).toBe(2);
  });
});

test.describe('without a microphone', () => {
  test('“My mic doesn’t work” plays the lab without one and turns it in for the teacher to check', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await page.getByRole('button', { name: "My mic doesn't work" }).click();
    expect(run.dialogs).toEqual(["Do the lab without a microphone? It won't count until your teacher checks it."]);
    await expect(page.getByText('No microphone. The lab will play without it.')).toBeVisible();

    await startLab(page);
    // No microphone: no tally and no nudges.
    await expect(page.getByText(/Pauses answered/)).toHaveCount(0);
    await expect(page.getByText(NO_MIC_END)).toBeVisible({ timeout: LAB_MS + 10_000 });
    // Waiting for the teacher, or a redo with a microphone that works.
    await expect(page.getByText(REDO_HINT)).toBeVisible();
    await expect(page.getByText(/before the microphone stopped/)).toHaveCount(0);

    expect(run.submits).toHaveLength(1);
    expect(run.submits[0].mic).toBe('off');
    // No microphone, so no levels and no old-meter count.
    expect(run.submits[0].micStats).toMatchObject({ meter: 2, ambientDbP50: null, levelOnlyAnswered: null, micCheck: null });
    // The page never asked for a microphone.
    expect(await page.evaluate(() => (window as unknown as { __micOpened: number }).__micOpened)).toBe(0);
    expect(answersIn(run.reports)).toEqual([]);

    await page.getByRole('button', { name: 'Do it again' }).click();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
    expect(run.begins).toBe(2);
  });

  test('a microphone lost mid-lab: “Go on without the microphone”, Resume, the pauses after it unheard, and it is turned in without one', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await startLab(page);
    await expect.poll(() => audioMs(page)).toBeGreaterThan(600);

    await loseMicrophone(page);
    await expect(page.getByText(/Your microphone disconnected at/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Go on without the microphone' }).click();
    // Mid-lab, it says where the pauses answered so far leave the lab.
    expect(run.dialogs).toEqual(["Go on without the microphone? You answered 0 of the 2 pauses needed, so the lab won't count until your teacher checks it."]);
    await expect(page.getByText('No microphone from here on. Press Resume to carry on.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn the microphone back on' })).toHaveCount(0);
    await expect(page.getByText('Pauses answered before the microphone stopped: 0 of the 2 needed. Your teacher will check this lab.')).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    // Both pauses play with no microphone: marked unheard once played (for the last 1.5 s of the lab).
    await expect.poll(() => pauseMarks(page), { timeout: LAB_MS, intervals: [100] }).toBe('unheard,unheard');

    const status = page.getByRole('status');
    await expect(status).toContainText(NO_MIC_END, { timeout: LAB_MS + 10_000 });
    await expect(status).toContainText('You answered 0 of 2 pauses before the microphone stopped.');
    await expect(status).toContainText('It needs 2 to count.');
    await expect(status).toContainText(REDO_HINT);
    await expect(page.getByRole('button', { name: 'Do it again' })).toBeVisible();
    expect(run.submits).toHaveLength(1);
    expect(run.submits[0].mic).toBe('off');
    expect(run.submits[0].positionMs).toBeGreaterThanOrEqual(LAB_MS - 100);
    // The microphone did work at the start.
    expect(run.submits[0].micStats).toMatchObject({ meter: 2, micCheck: 'voice', levelOnlyAnswered: 0 });
  });

  test('a microphone lost after enough pauses: it should still count, and does', async ({ page }) => {
    const run = await openPauseLab(page, { pct: 50 });
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await setMicPlan(page, [[PAUSE_1[0] + 400, PAUSE_1[0] + 2000]]);
    await startLab(page);
    // Between the two pauses, the first answered.
    await expect.poll(() => pauseMarks(page), { timeout: 10_000, intervals: [100] }).toBe('answered,ahead');
    await expect(page.getByText('Pauses answered: 1 · That should be enough for the lab to count. Keep answering to the end.')).toBeVisible();

    await loseMicrophone(page);
    await page.getByRole('button', { name: 'Go on without the microphone' }).click();
    expect(run.dialogs).toEqual(['Go on without the microphone? You already answered 1 pause. That should be enough for the lab to count.']);
    await expect(page.getByText('Pauses answered before the microphone stopped: 1. That should be enough for the lab to count.')).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText(TURNED_IN, { timeout: LAB_MS + 10_000 });
    await expect(status).toContainText('You answered 1 of 2 pauses before the microphone stopped.');
    await expect(page.getByRole('button', { name: 'Do it again' })).toHaveCount(0);
    expect(run.submits[0].mic).toBe('off');
  });
});

test.describe('in the pauses', () => {
  test('a silent student: “We can’t hear you”, then “Missed that pause”, [start, 0] on the reports, and “can’t count now”', async ({ page }) => {
    const run = await openPauseLab(page, { result: () => ({ submissionId: 77, credit: false, status: 'redo', scored: true, pausesAnswered: 0, pausesCounted: 2, needed: 2, mic: 'on' }) });
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await startLab(page);
    await expect(page.getByText('Pauses answered: 0 of the 2 needed · 2 pauses left')).toBeVisible();

    // Past the first pause: missed, and with both needed this attempt can no longer count.
    await expect(page.getByText(CANT_COUNT)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Pauses answered: 0 of the 2 needed · 1 pause left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
    await expect(page.locator('[data-pause-mark]').first()).toHaveAttribute('data-pause-mark', 'missed');

    await expect(page.getByText('You answered 0 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 10_000 });
    const seen = await seenTexts(page);
    const inPause = (text: string, [s, e]: [number, number]) =>
      seen.some((x) => x.text === text && x.atMs >= s + 2000 && x.atMs <= e + 300);
    // Two seconds into each pause's window without a voice...
    expect(inPause(QUIET, PAUSE_1), JSON.stringify(seen)).toBe(true);
    expect(inPause(QUIET, PAUSE_2), JSON.stringify(seen)).toBe(true);
    // ...and missed once it is over (the meter decides 0.2 s behind), until the next pause opens.
    expect(seen.some((x) => x.text === MISSED && x.atMs >= PAUSE_1[1] - 200 && x.atMs < PAUSE_2[0] + 600), JSON.stringify(seen)).toBe(true);
    expect(seen.some((x) => x.text === HEARD || x.text === SOUND)).toBe(false);

    // Each pause's result went out on a listening report, with no voice.
    expect(answersIn(run.reports)).toEqual([[PAUSE_1[0], 0], [PAUSE_2[0], 0]]);
    expect(run.reports.filter((r) => r.answers).every((r) => ['tick', 'pause', 'end'].includes(r.kind))).toBe(true);
    expect(run.submits[0]).toMatchObject({ mic: 'on', answers: [] });
  });

  test('the server says it did not count: “Do it again”, or “The mic didn’t hear me” for the teacher; a new attempt starts clean', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await startLab(page);

    // What the server decided, in a status region the screen reader reads.
    const status = page.getByRole('status');
    await expect(status).toContainText('You answered 0 of 2 pauses.', { timeout: LAB_MS + 10_000 });
    await expect(status).toContainText('It needs 2 to count. Do it again.');
    await expect(status).toContainText('Did you answer out loud? Press “The mic didn\'t hear me” and your teacher will check it.');
    await expect(page.getByText(TURNED_IN)).toHaveCount(0);
    const mine = run.submits[0];
    expect(mine.mic).toBe('on');

    await page.getByRole('button', { name: "The mic didn't hear me" }).click();
    await expect(status).toContainText('Your teacher will check it.');
    await expect(page.getByRole('button', { name: "The mic didn't hear me" })).toHaveCount(0);
    expect(run.asked).toEqual([{ submissionId: 100 }]);

    // Do it again: a new session, and its log starts from the top with no jump in it.
    await page.getByRole('button', { name: 'Do it again' }).click();
    await passMicCheck(page);
    expect(run.begins).toBe(2);
    await setMicPlan(page, [[1400, 3000]]);
    await startLab(page);
    await expect.poll(() => run.reports.filter((r) => r.startToken === '2.signature' && r.kind === 'tick').length, { timeout: 8000 }).toBeGreaterThan(0);
    const second = run.reports.filter((r) => r.startToken === '2.signature');
    expect(second[0].kind).toBe('play');
    expect(second[0].positionMs).toBeLessThan(500);
    expect(second.some((r) => r.kind === 'seek')).toBe(false);
    // Nothing from the first attempt carried over: its first pause is judged afresh.
    expect(answersIn(second)).toEqual([[PAUSE_1[0], expect.any(Number)]]);
    expect(answersIn(second)[0][1]).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  test('a student who answers: “Heard you.”, voice on each result, the tally, and the credit', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    // 1.6 s of voice in each pause, from 0.4 s after it starts.
    await setMicPlan(page, [[PAUSE_1[0] + 400, PAUSE_1[0] + 2000], [PAUSE_2[0] + 400, PAUSE_2[0] + 2000]]);
    await startLab(page);

    // After the first pause: answered, the second still ahead.
    await expect.poll(async () => page.evaluate(() => {
      const t = (document.querySelector('audio')?.currentTime ?? 0) * 1000;
      const marks = [...document.querySelectorAll('[data-pause-mark]')].map((m) => m.getAttribute('data-pause-mark'));
      return t > 4700 && t < 9000 ? marks.join(',') : null;
    }), { timeout: 10_000 }).toBe('answered,ahead');
    await expect(page.getByText('Pauses answered: 1 of the 2 needed · 1 pause left')).toBeVisible();

    await expect(page.getByText('You answered 2 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 10_000 });
    await expect(page.getByText(TURNED_IN)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Do it again' })).toHaveCount(0);

    const seen = await seenTexts(page);
    expect(seen.filter((x) => x.text === HEARD).length, JSON.stringify(seen)).toBe(2);
    expect(seen.some((x) => x.text === QUIET || x.text === SOUND || x.text === MISSED || x.text === CANT_COUNT), JSON.stringify(seen)).toBe(false);
    // Once both were answered, before the end: it should count, keep going.
    expect(seen.some((x) => x.text === ENOUGH && x.atMs >= PAUSE_2[1]), JSON.stringify(seen)).toBe(true);

    const answers = answersIn(run.reports);
    expect(answers.map(([s]) => s)).toEqual([PAUSE_1[0], PAUSE_2[0]]);
    for (const [, voiced] of answers) {
      expect(voiced).toBeGreaterThanOrEqual(FLOOR_MS);
      // Never more than the window: 0.3 s after the start to 0.1 s before the end.
      expect(voiced).toBeLessThanOrEqual(3600 - 400);
    }
    const sent = run.submits[0];
    expect(sent.mic).toBe('on');
    // The voice outside the pauses is counted apart; here there was none.
    expect(sent.outsidePlayedMs).toBeGreaterThan(2000);
    expect(sent.outsideVoicedMs).toBeLessThan(300);
    // The meter's stats: a silent room (the gate at its −55 dBFS floor), the voice far over it, both meters agreeing.
    expect(sent.micStats).toMatchObject({ meter: 2, gateDbP50: -55, levelOnlyAnswered: 2, micCheck: 'voice' });
    expect(sent.micStats!.voiceOverGateDbP50).toBeGreaterThan(30);
    expect(sent.micStats!.loudNotVoiceInPausesMs).toBeLessThan(200);
  });

  test('Back 10 s sends where playback reached, with the pause just finished, before it jumps', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await setMicPlan(page, [[PAUSE_1[0] + 400, PAUSE_1[0] + 2000]]);
    await startLab(page);

    // Pause inside the first pause (answering while paused is normal), then carry on: the next tick is 5 s away.
    await expect.poll(() => audioMs(page)).toBeGreaterThan(3000);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    // Past the pause, before that tick: its result waits on the page.
    await expect.poll(() => audioMs(page)).toBeGreaterThan(PAUSE_1[1] + 300);
    expect(answersIn(run.reports)).toEqual([]);

    await page.getByRole('button', { name: 'Back 10 s' }).click();
    await expect.poll(() => run.reports.some((r) => r.kind === 'seek')).toBe(true);
    const seek = run.reports.findIndex((r) => r.kind === 'seek');
    const before = run.reports[seek - 1];
    expect(before.kind).toBe('tick');
    expect(before.positionMs).toBeGreaterThan(PAUSE_1[1]);
    expect(before.answers).toEqual([[PAUSE_1[0], expect.any(Number)]]);
    expect(before.answers![0][1]).toBeGreaterThanOrEqual(FLOOR_MS);
    expect(run.reports[seek].positionMs).toBeLessThan(PAUSE_1[0]);
  });
});

test.describe('the voice meter: sound that is not a voice (v1.16.0)', () => {
  test('desk taps: never a voice, so the check asks the student to speak up, and no pause is answered', async ({ page }) => {
    // The mocked server scores what the page sends.
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    // Loud taps all through: the old −45 dBFS meter took them for a voice.
    await setMicBackground(page, 'taps', SPEAKING);
    // A second of loud sound shows the microphone works: Start turns on, with a line to speak up.
    await expect(page.getByText(HEAR_ROOM)).toBeVisible({ timeout: 8000 });
    await startLab(page);

    await expect(page.getByText('You answered 0 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 10_000 });
    const seen = await seenTexts(page);
    expect(seen.some((x) => x.text === HEAR_YOU || x.text === HEARD), JSON.stringify(seen)).toBe(false);
    // In each pause the student is told why: sound, but not a voice.
    const inPause = ([s, e]: [number, number]) => seen.some((x) => x.text === SOUND && x.atMs >= s + 2000 && x.atMs <= e + 300);
    expect(inPause(PAUSE_1) && inPause(PAUSE_2), JSON.stringify(seen)).toBe(true);

    const results = [...answersIn(run.reports), ...answersIn(run.submits[0].reports ?? []), ...(run.submits[0].answers ?? [])];
    expect(results.every(([, voiced]) => voiced < FLOOR_MS), JSON.stringify(results)).toBe(true);
    const stats = run.submits[0].micStats!;
    expect(stats.micCheck).toBe('level');
    // The old meter would have answered both; the teacher sees the difference.
    expect(stats.levelOnlyAnswered).toBe(2);
    expect(stats.loudNotVoiceInPausesMs).toBeGreaterThan(1000);
  });

  test('class babble with a silent student: the room, not an answer', async ({ page }) => {
    // The mocked server scores what the page sends.
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await setMicBackground(page, 'babble', micLevelForDb(BABBLE_DB));
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    // The page learns the room for a couple of seconds, then the student says "hola" over it.
    await page.waitForTimeout(2500);
    await setMicLevel(page, SPEAKING);
    await expect(page.getByText(HEAR_YOU)).toBeVisible();
    await setMicLevel(page, 0);
    await startLab(page);

    await expect(page.getByText('You answered 0 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 10_000 });
    const results = [...answersIn(run.reports), ...answersIn(run.submits[0].reports ?? []), ...(run.submits[0].answers ?? [])];
    expect(results.map(([s]) => s).sort((a, b) => a - b)).toEqual([PAUSE_1[0], PAUSE_2[0]]);
    expect(results.every(([, voiced]) => voiced < FLOOR_MS), JSON.stringify(results)).toBe(true);
    const seen = await seenTexts(page);
    expect(seen.some((x) => x.text === HEARD), JSON.stringify(seen)).toBe(false);
    const stats = run.submits[0].micStats!;
    // The room level is the babble's, and the old meter would have answered both pauses with it.
    expect(stats.ambientDbP50).toBeGreaterThan(BABBLE_DB - 10);
    expect(stats.levelOnlyAnswered).toBe(2);
  });

  test('a voice over the babble still answers every pause', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await setMicBackground(page, 'babble', micLevelForDb(BABBLE_DB));
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.waitForTimeout(2500);
    await setMicLevel(page, SPEAKING);
    await expect(page.getByText(HEAR_YOU)).toBeVisible();
    await setMicLevel(page, 0);
    await setMicPlan(page, [[PAUSE_1[0] + 400, PAUSE_1[0] + 2000], [PAUSE_2[0] + 400, PAUSE_2[0] + 2000]]);
    await startLab(page);

    await expect(page.getByText('You answered 2 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 10_000 });
    await expect(page.getByText(TURNED_IN)).toBeVisible();
    const answers = answersIn(run.reports);
    expect(answers.map(([s]) => s)).toEqual([PAUSE_1[0], PAUSE_2[0]]);
    // 1.6 s of voice in each; the meter keeps all but its edges.
    for (const [, voiced] of answers) expect(voiced).toBeGreaterThanOrEqual(1200);
    expect(run.submits[0].micStats).toMatchObject({ micCheck: 'voice', levelOnlyAnswered: 2 });
  });
});

test.describe('the connection and turning in', () => {
  test('reports stuck for 90 s pause the lab until the connection is back; Resume waits for it', async ({ page }) => {
    const run = await openPauseLab(page, { clock: true });
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    run.offline = true;
    await startLab(page);
    await expect.poll(() => audioMs(page)).toBeGreaterThan(800);

    // Ninety seconds on the page's clock with nothing confirmed.
    await page.clock.fastForward(91_000);
    await expect(page.getByText(LOST)).toBeVisible();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    const resume = page.getByRole('button', { name: 'Resume' });
    await expect(resume).toBeDisabled();
    expect(run.reports).toEqual([]);

    // The connection comes back: the next try delivers the queue, with its original times.
    run.offline = false;
    await page.clock.fastForward(6_000);
    await expect(page.getByText(BACK_ON)).toBeVisible();
    await expect(resume).toBeEnabled();
    expect(run.reports[0]).toMatchObject({ kind: 'play', startToken: '1.signature' });
    expect(run.reports[0].clientMs).toBeLessThan(5000);
    await resume.click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
  });

  test('turning in carries the reports that never got through, pause results and all', async ({ page }) => {
    const run = await openPauseLab(page);
    await page.goto('/labs?lab=1');
    await passMicCheck(page);
    await setMicPlan(page, [[PAUSE_1[0] + 400, PAUSE_1[0] + 2000], [PAUSE_2[0] + 400, PAUSE_2[0] + 2000]]);
    run.offline = true;
    await startLab(page);

    // The server scores what the submit carried.
    await expect(page.getByText('You answered 2 of 2 pauses.')).toBeVisible({ timeout: LAB_MS + 15_000 });
    await expect(page.getByText(TURNED_IN)).toBeVisible();
    expect(run.reports).toEqual([]);
    const sent = run.submits[0];
    const carried = sent.reports ?? [];
    expect(carried[0]).toMatchObject({ kind: 'play' });
    expect(carried.map((r) => r.kind)).toContain('end');
    // In the order they happened, each with the page's own time.
    const times = carried.map((r) => r.clientMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(answersIn(carried).map(([s]) => s)).toEqual([PAUSE_1[0], PAUSE_2[0]]);
    expect(answersIn(carried).every(([, v]) => v >= FLOOR_MS)).toBe(true);
    // Each result goes once: the submit's own list has nothing left over.
    expect(sent.answers).toEqual([]);
    const seen = await seenTexts(page);
    expect(seen.some((x) => x.text === LOST)).toBe(false);
  });
});
