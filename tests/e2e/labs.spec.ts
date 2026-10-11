import { test, expect, type Page } from '@playwright/test';
import { SPEAKING, loseMicrophone, scriptedMicrophone, setMicLevel, setMicPlan } from './support/scriptedMicrophone';
import { PAUSE_LAB_PAUSES, pauseLabWav, serveAudio, wav, type WavPart } from './support/labWav';
import { TrpcMockError, mockAdminTrpc, mockAuthenticatedTrpc, sampleGroups } from './support/trpcMock';

/**
 * A small mono WAV standing in for a lab: tone (a voice), silence (a pause),
 * a quieter tone (the closing line), then trailing silence.
 */
function labWav(trailingSilence = 0.7): Buffer {
  return wav([[1.0, 0.5], [0.5, 0], [0.8, 0.2], [trailingSilence, 0]]);
}
const LAB_MS = 3000;
/** End of the quieter tone, 2.3 s in, plus the scanner's 0.3 s tail. */
const LAST_SPEECH_MS = 2600;

type Answer = [number, number];
type LabSubmit = {
  labId: number; startToken: string; positionMs: number; clientMs: number; voicedMs: number; listenWallMs: number;
  mic?: 'on' | 'off'; answers?: Answer[]; reports?: { kind: string; positionMs: number; clientMs: number; answers?: Answer[] }[];
  outsideVoicedMs?: number; outsidePlayedMs?: number;
};

/** Counts MediaRecorders the page creates, and every upload that is not a tRPC call. */
async function watchForRecording(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __recorders: number; MediaRecorder: typeof MediaRecorder };
    w.__recorders = 0;
    const Original = w.MediaRecorder;
    w.MediaRecorder = class extends Original {
      constructor(...args: ConstructorParameters<typeof MediaRecorder>) {
        super(...args);
        w.__recorders += 1;
      }
    };
  });
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && !request.url().includes('/api/trpc/')) uploads.push(request.url());
  });
  return {
    uploads,
    recorders: () => page.evaluate(() => (window as unknown as { __recorders: number }).__recorders),
  };
}

// No autoplay gate, for every test here. The microphone is scripted (support/scriptedMicrophone.ts).
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required'],
    firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
  },
});

/** A lab as labs.list sends it (v1.15: where the student stands). */
const lab = {
  id: 1,
  title: 'ES1 Lab semana01',
  description: null,
  durationMs: LAB_MS,
  requiredThroughMs: LAST_SPEECH_MS,
  status: 'todo',
  redoByTeacher: false,
  submittedAt: null,
  attempts: 0,
  pausesAnswered: null,
  pausesCounted: null,
  needed: null,
};

/**
 * Talking in bursts through the 3 s lab, 0.5 s on and 0.3 s off, as a student
 * does. The voice meter (v1.16.0) takes a sound held for about 8 s for the
 * room, so a test that wants its voice counted speaks in bursts.
 */
const BURSTS: [number, number][] = Array.from({ length: 4 }, (_, i) => [i * 800, i * 800 + 500]);

/** "Turn on the microphone", then a voice: the check before Start passes. The microphone keeps speaking. */
async function turnOnMicrophone(page: Page) {
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await setMicLevel(page, SPEAKING);
  await expect(page.getByRole('button', { name: 'Start the lab' })).toBeEnabled();
}

test.describe('student', () => {
  test('dashboard counts labs still to do, and the list says where each stands', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      labs: [
        lab,
        { ...lab, id: 2, title: 'Lab 2', status: 'done', submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1, pausesAnswered: 18, pausesCounted: 20, needed: 15 },
        { ...lab, id: 3, title: 'Lab 3', status: 'redo', attempts: 1, pausesAnswered: 3, pausesCounted: 20, needed: 15 },
        { ...lab, id: 4, title: 'Lab 4', status: 'redo', redoByTeacher: true, attempts: 1, pausesAnswered: 18, pausesCounted: 20, needed: 15 },
        { ...lab, id: 5, title: 'Lab 5', status: 'check', attempts: 1, pausesAnswered: 0, pausesCounted: 20, needed: 15 },
      ],
    });
    await page.goto('/');
    const card = page.getByRole('link', { name: /Audio labs/ });
    // Never done, and done without counting; not the one waiting for the teacher.
    await expect(card).toContainText('3 lab(s) to do');
    await card.click();
    await expect(page).toHaveURL(/\/labs$/);
    const item = (title: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(item('ES1 Lab semana01')).toContainText('Not done yet');
    await expect(item('ES1 Lab semana01').getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(item('Lab 2')).toContainText(/Submitted /);
    await expect(item('Lab 3')).toContainText("Didn't count: you answered 3 of 20 pauses (15 needed)");
    await expect(item('Lab 4')).toContainText('Your teacher asked you to do it again.');
    await expect(item('Lab 5')).toContainText('Waiting for your teacher to check it.');
    for (const title of ['Lab 2', 'Lab 3', 'Lab 4', 'Lab 5']) {
      await expect(item(title).getByRole('button', { name: 'Do it again' })).toBeVisible();
    }
  });

  test('dashboard has no labs card when there are no labs', async ({ page }) => {
    await mockAuthenticatedTrpc(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
    await expect(page.getByText('Audio labs')).toHaveCount(0);
  });
});

test.describe('a lab session in a real browser', () => {
  test('logs the listening, counts speech with a live meter, and turns in without recording anything', async ({ page }) => {
    await scriptedMicrophone(page);
    const watch = await watchForRecording(page);
    const heartbeats: { kind: string; positionMs: number; clientMs: number; startToken: string }[] = [];
    const submitted: LabSubmit[] = [];
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        // A lab with no pause list yet: the old account of speaking.
        'labs.begin': {
          ...lab,
          audioUrl: '/test-lab.wav',
          minimumVoicedMs: 130,
          startToken: '1790000000000.signature',
          pauses: null,
          minAnsweredPct: 0,
          voicePerPauseMs: 250,
          needed: null,
        },
        'labs.heartbeat': (input: unknown) => {
          heartbeats.push(input as (typeof heartbeats)[number]);
          return { recorded: true };
        },
        'labs.submit': (input: unknown) => {
          submitted.push(input as LabSubmit);
          return { success: true, result: { submissionId: 1, credit: true, status: 'done', scored: false, pausesAnswered: null, pausesCounted: null, needed: null, mic: 'on' } };
        },
      },
    });
    await page.route('**/test-lab.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: labWav() }));

    await page.goto('/labs?lab=1');
    await expect(page.getByText('The microphone counts how long you speak; nothing is recorded.', { exact: false })).toBeVisible();
    await turnOnMicrophone(page);
    // From here the voice follows the lab: bursts, never one held tone.
    await setMicPlan(page, BURSTS);
    await setMicLevel(page, 0);
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    await expect(page.getByText(/You have spoken for/)).toBeVisible();
    // No pause list: no tally.
    await expect(page.getByText(/Pauses answered/)).toHaveCount(0);

    // The lab plays to its end and is turned in by itself.
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/You spoke for about/)).toBeVisible();

    expect(submitted).toHaveLength(1);
    const sent = submitted[0];
    expect(sent.labId).toBe(1);
    expect(sent.startToken).toBe('1790000000000.signature');
    expect(sent.positionMs).toBeGreaterThanOrEqual(LAB_MS - 100);
    expect(sent.listenWallMs).toBeGreaterThanOrEqual(LAB_MS - 500);
    expect(sent.voicedMs).toBeLessThanOrEqual(sent.listenWallMs + 250);
    // The microphone spoke in bursts: that is speech to the meter.
    expect(sent.voicedMs).toBeGreaterThan(0);
    // With no pauses to answer, everything played is "outside the pauses", and the voice in it is counted.
    expect(sent.mic).toBe('on');
    expect(sent.answers).toEqual([]);
    expect(sent.outsidePlayedMs).toBeGreaterThan(LAB_MS - 1000);
    expect(sent.outsideVoicedMs).toBeGreaterThan(0);
    expect(sent.outsideVoicedMs).toBeLessThanOrEqual(sent.outsidePlayedMs!);
    // Every report got through, so the submit carries none.
    expect(sent.reports).toEqual([]);

    // No recorder was ever made and nothing but tRPC calls left the page.
    expect(await watch.recorders()).toBe(0);
    expect(watch.uploads).toEqual([]);

    // The listening log: a start, and an end, all in this session.
    expect(heartbeats.map((h) => h.kind)).toContain('play');
    expect(heartbeats.map((h) => h.kind)).toContain('end');
    expect(heartbeats.every((h) => h.startToken === '1790000000000.signature')).toBe(true);
    const end = heartbeats.find((h) => h.kind === 'end')!;
    expect(end.positionMs).toBeGreaterThanOrEqual(LAB_MS - 100);
  });

  test('keeps the session when turning in fails, so the student can try again', async ({ page }) => {
    await scriptedMicrophone(page);
    let attempts = 0;
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        'labs.begin': { ...lab, audioUrl: '/test-lab.wav', minimumVoicedMs: 0, startToken: '1.x' },
        'labs.heartbeat': { recorded: true },
        'labs.submit': () => {
          attempts += 1;
          if (attempts === 1) throw new TrpcMockError('Submission failed', 'INTERNAL_SERVER_ERROR', 500);
          // A server from before the pause rule sends no result: the plain "Turned in".
          return { success: true };
        },
      },
    });
    await page.route('**/test-lab.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: labWav() }));

    await page.goto('/labs?lab=1');
    await turnOnMicrophone(page);
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await expect(page.getByRole('alert')).toContainText('Submission failed', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible();
    expect(attempts).toBe(2);
  });

  test('an old page is told to reload instead of opening a session', async ({ page }) => {
    await scriptedMicrophone(page);
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        'labs.begin': () => { throw new TrpcMockError('libreSRS was updated. Reload this page to do the lab.'); },
      },
    });
    await page.goto('/labs?lab=1');
    await expect(page.getByText('libreSRS was updated. Reload this page to do the lab.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to labs' }).click();
    await expect(page).toHaveURL(/\/labs$/);
  });
});

test.describe('admin', () => {
  const scan = { minPauseMs: 3300, thresholdDb: -41.2, noiseDb: -200, shortestKeptMs: 3540, longestLeftOutMs: 2100, closeCalls: 0, scannedAt: Date.parse('2026-09-20T00:00:00Z') };
  const adminLab = {
    id: 1, title: 'ES1 Lab semana01', description: null, audioUrl: '/api/assets/semana01.wav', mimeType: 'audio/wav',
    durationMs: 900_000, requiredThroughMs: 880_000, active: true, createdBy: 1, createdAt: '2026-09-20T00:00:00.000Z',
    forEveryone: false, groupIds: [1],
    pauseCount: 95, pauseTotal: 101, pauseScan: scan, pauseCountUntilMs: 846_000, needsCheck: false,
    turnedInCount: 5, studentCount: 5, doneCount: 2, redoCount: 1, checkCount: 2, flaggedCount: 1, lookCount: 1,
    lastSubmittedAt: '2026-09-25T15:12:00.000Z',
  };
  const unscannedLab = {
    ...adminLab, id: 2, title: 'ES1 Lab semana02', audioUrl: '/api/assets/semana02.wav',
    pauseCount: null, pauseTotal: null, pauseScan: null, pauseCountUntilMs: null, needsCheck: false,
    turnedInCount: 0, studentCount: 0, doneCount: 0, redoCount: 0, checkCount: 0, flaggedCount: 0, lookCount: 0, lastSubmittedAt: null,
  };
  /**
   * Labs with "write it down" pauses (11 s) among 3.6 s answer pauses: two in
   * the middle of the lab, or one after the answer pauses at the end.
   */
  const prompt: WavPart = [1, 0.5];
  const answer: WavPart = [3.6, 0];
  const writing: WavPart = [11, 0];
  const writingInsideWav = () => wav([prompt, answer, prompt, writing, prompt, writing, prompt, answer, prompt, answer, [2, 0.5], [0.5, 0]]);
  const writingAtEndWav = () => wav([prompt, answer, prompt, answer, prompt, writing, [2, 0.5], [0.5, 0]]);
  const doubtfulLab = {
    ...unscannedLab, id: 3, title: 'ES1 Lab semana03', audioUrl: '/api/assets/semana03.wav',
    pauseCount: 8, pauseTotal: 8, pauseScan: { ...scan, noiseDb: -35.4 }, needsCheck: true,
  };

  test('scans uploaded files for their answer pauses and the last speech, and creates hidden labs', async ({ page }) => {
    const created: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      mutations: {
        'labs.create': (input: unknown) => { created.push(input as Record<string, unknown>); return { id: 9 }; },
      },
    });
    let mediaType = '';
    await page.route('**/api/media', async (route, request) => {
      mediaType = request.headers()['content-type'];
      await route.fulfill({ json: { audioUrl: '/api/assets/00000000-0000-4000-8000-000000000001.wav', mimeType: 'audio/wav', sizeBytes: 1 } });
    });

    await page.goto('/admin?tab=labs');
    await expect(page.getByText('Choose one lab or a whole semester. Each file is scanned for its answer pauses and for where the last speech ends; students must hear through that point, and you can change it before uploading.')).toBeVisible();
    await page.getByLabel('Lab audio files').setInputFiles({ name: 'ES1_Lab_semana01.wav', mimeType: 'audio/wav', buffer: pauseLabWav() });
    const row = page.getByRole('row', { name: /ES1_Lab_semana01\.wav/ });
    await expect(row).toContainText('Ready', { timeout: 10_000 });
    await expect(row).toContainText(/last speech at 0:1[01]/);
    await expect(page.getByLabel('Title for ES1_Lab_semana01.wav')).toHaveValue('ES1 Lab semana01');
    // Two pauses found; so few that the teacher should compare with the transcript.
    await expect(row.getByRole('cell').nth(3)).toHaveText(/^2\s*Check the count$/);

    await page.getByRole('button', { name: 'Upload 1 lab(s)' }).click();
    await expect(page.getByText('Uploaded')).toBeVisible();

    expect(mediaType).toBe('audio/wav');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'ES1 Lab semana01', active: false, groupIds: [] });
    expect(Math.abs((created[0].durationMs as number) - 10_700)).toBeLessThan(20);
    // The exact scanned point (end of the closing line plus the 0.3 s tail), not the rounded one shown in the box.
    expect(Math.abs((created[0].requiredThroughMs as number) - 10_500)).toBeLessThan(120);
    // The answer pauses, found to within a few windows of where the silences are.
    const pauses = created[0].pauses as [number, number][];
    expect(pauses).toHaveLength(2);
    pauses.forEach(([s, e], i) => {
      expect(Math.abs(s - PAUSE_LAB_PAUSES[i][0])).toBeLessThanOrEqual(40);
      expect(Math.abs(e - PAUSE_LAB_PAUSES[i][1])).toBeLessThanOrEqual(40);
    });
    expect(created[0].scan).toMatchObject({ minPauseMs: 3300, closeCalls: 0 });
  });

  test('the Labs tab: the pause rule, each lab’s pauses, how its students stand, and Find pauses', async ({ page }) => {
    const saved: unknown[] = [];
    const scanned: { id: number; pauses: [number, number][] }[] = [];
    let settings = { minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false };
    await mockAdminTrpc(page, {
      queries: {
        'labs.adminList': () => [adminLab, scanned.length > 0 ? { ...unscannedLab, pauseCount: 2, pauseTotal: 2, pauseScan: scan } : unscannedLab, doubtfulLab],
        'labs.settings': () => settings,
      },
      mutations: {
        'labs.saveSettings': (input: unknown) => { saved.push(input); settings = { ...settings, ...(input as object) }; return settings; },
        'labs.setPauses': (input: unknown) => { scanned.push(input as (typeof scanned)[number]); return { success: true, pauseCount: 2, pauseTotal: 2 }; },
      },
    });
    const semana02 = pauseLabWav();
    await page.route('**/api/assets/semana02.wav', (route) => serveAudio(route, semana02));

    await page.goto('/admin?tab=labs');
    const rule = page.getByRole('region', { name: 'Speaking in the pauses' });
    await expect(rule).toContainText('The microphone hears whether there is a voice in a pause, not what is said.');
    await expect(rule).toContainText('0 turns this off: every lab counts.');
    await expect(rule).toContainText('Changes apply to labs started from now on.');
    const pct = rule.getByLabel('Pauses a student must answer (%)');
    await expect(pct).toHaveValue('0');
    await expect(rule.getByLabel('Voice needed in a pause (seconds)')).toHaveValue('0.25');
    await pct.fill('120');
    await rule.getByRole('button', { name: 'Save' }).click();
    await expect(rule).toContainText('Use a whole number from 0 to 100.');
    await expect(pct).toHaveAttribute('aria-invalid', 'true');
    expect(saved).toEqual([]);
    await pct.fill('75');
    await rule.getByRole('button', { name: 'Save' }).click();
    await expect(rule.getByRole('status')).toHaveText('Saved.');
    expect(saved).toEqual([{ minAnsweredPct: 75, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false }]);

    // The holds: two built in, one to choose; the room margin under Advanced.
    await expect(rule).toContainText('While the rule is on, two kinds of lab always wait for you instead of counting');
    const hold = rule.getByRole('checkbox', { name: 'Also hold labs with voice outside the pauses' });
    await expect(hold).not.toBeChecked();
    await rule.getByText('Advanced').click();
    const margin = rule.getByLabel('Room margin (dB)');
    await expect(margin).toHaveValue('6');
    await hold.check();
    await margin.fill('8');
    await rule.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1]).toEqual({ minAnsweredPct: 75, voicePerPauseMs: 250, gateMarginDb: 8, holdOutsideVoice: true });

    const row = (title: string) => page.getByRole('row', { name: new RegExp(title) });
    await expect(row('semana01')).toContainText('101 pauses · 95 count');
    await expect(row('semana01')).toContainText('5 turned in · 1 need a redo · 2 waiting for you · 1 flagged · 1 to look at');
    await expect(row('semana03')).toContainText('Check the count');
    await expect(row('semana02')).toContainText('Not scanned');
    await expect(row('semana02')).toContainText('0 turned in');
    await expect(page.getByText('1 lab(s) have no pause list yet, so they use the old rule.')).toBeVisible();

    // Labs uploaded before: their audio is fetched and scanned here, one at a time, and the list saved.
    await page.getByRole('button', { name: 'Find pauses in 1 lab(s)' }).click();
    await expect(page.getByText('1 lab(s) have no pause list yet, so they use the old rule.')).toHaveCount(0, { timeout: 10_000 });
    await expect(row('semana02')).not.toContainText('Not scanned');
    expect(scanned).toHaveLength(1);
    expect(scanned[0].id).toBe(2);
    expect(scanned[0].pauses.map(([s]) => Math.round(s / 100) * 100)).toEqual(PAUSE_LAB_PAUSES.map(([s]) => s));
  });

  test('an upload with “write it down” pauses among the answer pauses: leaving them out, and the count follows', async ({ page }) => {
    const created: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      mutations: {
        'labs.create': (input: unknown) => { created.push(input as Record<string, unknown>); return { id: 9 }; },
      },
    });
    await page.route('**/api/media', (route) => route.fulfill({ json: { audioUrl: '/api/assets/00000000-0000-4000-8000-000000000002.wav', mimeType: 'audio/wav', sizeBytes: 1 } }));

    await page.goto('/admin?tab=labs');
    await page.getByLabel('Lab audio files').setInputFiles({ name: 'ES1_Lab_semana08.wav', mimeType: 'audio/wav', buffer: writingInsideWav() });
    const row = page.getByRole('row', { name: /ES1_Lab_semana08\.wav/ });
    await expect(row).toContainText('Ready', { timeout: 10_000 });
    await expect(row.getByRole('cell').nth(3)).toHaveText(/^5/);
    await expect(page.getByText('2 pause(s) are 10 seconds or longer. In the generator labs these are the “write it down” pauses, where students write instead of speaking.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep them' })).toBeVisible();

    await page.getByRole('button', { name: "Don't count these 2" }).click();
    await expect(row.getByRole('cell').nth(3)).toHaveText(/^3/);
    await expect(page.getByText(/10 seconds or longer/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Upload 1 lab(s)' }).click();
    await expect(page.getByText('Uploaded')).toBeVisible();
    const pauses = created[0].pauses as [number, number][];
    expect(pauses).toHaveLength(3);
    // The answer pauses stay (at 1 s, 29.6 s and 34.2 s); the two 11 s ones are gone.
    expect(pauses.every(([s, e]) => e - s < 10_000)).toBe(true);
  });

  test('Find pauses again on a lab with its writing pauses at the end suggests stopping the count there', async ({ page }) => {
    const updates: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      labs: [{ ...adminLab, pauseCountUntilMs: null }],
      mutations: {
        'labs.update': (input: unknown) => { updates.push(input as Record<string, unknown>); return { success: true }; },
        'labs.setPauses': { success: true, pauseCount: 3, pauseTotal: 3 },
      },
    });
    const semana01 = writingAtEndWav();
    await page.route('**/api/assets/semana01.wav', (route) => serveAudio(route, semana01));

    await page.goto('/admin?tab=labs');
    await page.getByRole('button', { name: 'Edit' }).click();
    const pauses = page.getByRole('region', { name: 'Pauses', exact: true });
    await pauses.getByRole('button', { name: 'Find pauses again' }).click();
    await expect(pauses).toContainText('1 pause(s) are 10 seconds or longer.', { timeout: 10_000 });
    await expect(pauses.getByRole('button', { name: /^Don't count these/ })).toHaveCount(0);

    await pauses.getByRole('button', { name: 'Count pauses only until 0:10' }).click();
    await expect.poll(() => updates.length).toBe(1);
    // The start of the writing pause, found to within a few windows.
    expect(Math.abs((updates[0].pauseCountUntilMs as number) - 10_200)).toBeLessThanOrEqual(40);
    await expect(pauses.getByLabel("Don't count pauses after (m:ss)")).toHaveValue('0:10');
    await expect(pauses).not.toContainText('10 seconds or longer');
  });

  test('a lab’s Edit row: the pauses that count, “Don’t count pauses after”, and Find pauses again', async ({ page }) => {
    const updates: Record<string, unknown>[] = [];
    const rescans: { id: number; pauses: [number, number][] }[] = [];
    await mockAdminTrpc(page, {
      labs: [adminLab],
      mutations: {
        'labs.update': (input: unknown) => { updates.push(input as Record<string, unknown>); return { success: true }; },
        'labs.setPauses': (input: unknown) => { rescans.push(input as (typeof rescans)[number]); return { success: true, pauseCount: 2, pauseTotal: 2 }; },
      },
    });
    const semana01 = pauseLabWav();
    await page.route('**/api/assets/semana01.wav', (route) => serveAudio(route, semana01));

    await page.goto('/admin?tab=labs');
    await page.getByRole('button', { name: 'Edit' }).click();
    const pauses = page.getByRole('region', { name: 'Pauses', exact: true });
    await expect(pauses).toContainText('101 pauses · 95 count');
    await expect(pauses).toContainText('Shortest pause 3.54 s · longest other silence 2.10 s');
    const until = pauses.getByLabel("Don't count pauses after (m:ss)");
    await expect(until).toHaveValue('14:06');

    await until.fill('14 minutes');
    await pauses.getByRole('button', { name: 'Apply' }).click();
    await expect(pauses).toContainText('Type a time like 14:06, or leave it empty.');
    expect(updates).toEqual([]);
    await until.fill('14:00');
    await pauses.getByRole('button', { name: 'Apply' }).click();
    await expect(pauses.getByRole('status')).toHaveText('Saved.');
    await until.fill('');
    await pauses.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => updates.length).toBe(2);
    expect(updates).toEqual([{ id: 1, pauseCountUntilMs: 840_000 }, { id: 1, pauseCountUntilMs: null }]);

    await pauses.getByRole('button', { name: 'Find pauses again' }).click();
    await expect(pauses.getByRole('status')).toHaveText('Pauses saved.', { timeout: 10_000 });
    expect(rescans).toHaveLength(1);
    expect(rescans[0]).toMatchObject({ id: 1 });
    expect(rescans[0].pauses).toHaveLength(2);
  });

  test('reviews a lab: each result, the teacher’s credit, the bulk buttons, marks, holds, who still has to do it, and the log', async ({ page }) => {
    const credits: { submissionIds: number[]; credit: boolean | null }[] = [];
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const at = (iso: string) => `2026-09-25T${iso}:00.000Z`;
    const base = {
      isTeacher: false, requiredThroughMs: 880_000, listenedCoveredMs: 880_000, listenWallMs: 0, skipCount: 0,
      startedAt: at('15:00'), submittedAt: at('15:16'), elapsedMs: 960_000, attempts: 1,
      mic: 'on', pausesCounted: 20, pausesAnswered: 18, pauseResults: null, rejectedAnswers: 0, lateAnswers: 0,
      minAnsweredPct: 75, voicePerPauseMs: 250, outsideVoicedMs: 20_000, outsidePlayedMs: 600_000,
      credit: true, creditOverride: null, creditOverrideAt: null, checkRequestedAt: null,
      needed: 15, effectiveCredit: true, status: 'done', statusReason: null, flags: [] as string[],
      heldFor: null as string[] | null, micStats: null as Record<string, unknown> | null,
    };
    const submissions = [
      {
        ...base, id: 11, userId: 2, studentName: 'Ana', studentEmail: 'ana@example.com', voicedMs: 41_000, attempts: 2,
        micStats: {
          meter: 2, ambientDbP50: -51.6, gateDbP50: -45.6, voiceOverGateDbP50: 12, levelOnlyAnswered: 19,
          loudNotVoiceInPausesMs: 1_500, unfocusedPlayedMs: 95_000, micCheck: 'voice',
          processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        },
      },
      // Ana's other attempt, before the one that counts: a red and an amber flag.
      {
        ...base, id: 10, userId: 2, studentName: 'Ana', studentEmail: 'ana@example.com', voicedMs: 0, attempts: 2,
        submittedAt: at('14:00'), pausesAnswered: 20, credit: false, effectiveCredit: false, status: 'redo',
        rejectedAnswers: 12, flags: ['odd-answers', 'noisy'],
      },
      {
        ...base, id: 12, userId: 3, studentName: 'Beto', studentEmail: 'beto@example.com', voicedMs: 3_000, skipCount: 1,
        pausesAnswered: 3, credit: false, effectiveCredit: false, status: 'redo', rejectedAnswers: 4, flags: ['skipped', 'odd-answers'],
        pauseResults: [[5_000, 1_200], [15_000, -1], [25_000, 100]],
      },
      {
        ...base, id: 13, userId: 4, studentName: 'Carla', studentEmail: 'carla@example.com', voicedMs: 0, mic: 'off',
        pausesAnswered: 0, credit: false, effectiveCredit: false, status: 'check', statusReason: 'no-mic', flags: ['no-mic'],
      },
      // Started while the rule was 50%.
      {
        ...base, id: 14, userId: 5, studentName: 'Dani', studentEmail: 'dani@example.com', voicedMs: 2_000, minAnsweredPct: 50, needed: 10,
        pausesAnswered: 2, credit: false, effectiveCredit: false, status: 'check', statusReason: 'asked', checkRequestedAt: at('15:17'),
      },
      {
        ...base, id: 15, userId: 6, studentName: 'Eli', studentEmail: 'eli@example.com', voicedMs: 9_000,
        pausesAnswered: 10, credit: false, creditOverride: true, creditOverrideAt: at('16:00'), effectiveCredit: true, status: 'done',
      },
      {
        ...base, id: 16, userId: 7, studentName: 'Fer', studentEmail: 'fer@example.com', voicedMs: 8_000,
        pausesAnswered: 11, credit: false, creditOverride: false, creditOverrideAt: at('16:00'), effectiveCredit: false,
        status: 'redo', statusReason: 'teacher',
      },
      // Turned in before the pause rule: no pause count, and the old flag.
      {
        ...base, id: 17, userId: 8, studentName: 'Hugo', studentEmail: 'hugo@example.com', voicedMs: 4_000,
        pausesCounted: null, pausesAnswered: null, minAnsweredPct: null, voicePerPauseMs: null, needed: null, flags: ['little-speech'],
      },
      // Enough pauses, but played at the same time as another lab already turned in: held.
      {
        ...base, id: 18, userId: 11, studentName: 'Juan', studentEmail: 'juan@example.com', voicedMs: 20_000,
        credit: false, effectiveCredit: false, status: 'check', statusReason: 'held', heldFor: ['overlap'], flags: ['overlap'],
      },
    ];
    const standing = (s: (typeof submissions)[number]) => ({
      userId: s.userId, name: s.studentName, status: s.status, reason: s.statusReason, countingRowId: s.id,
      answered: s.pausesAnswered, counted: s.pausesCounted,
    });
    // As the server does: one standing per student, from the attempt that counts.
    const counting = submissions.filter((s) => s.id !== 10);
    await mockAdminTrpc(page, {
      labs: [adminLab],
      queries: {
        'labs.submissions': {
          lab: {
            id: 1, title: 'ES1 Lab semana01', durationMs: 900_000, requiredThroughMs: 880_000, minimumVoicedMs: 30_000,
            pauseCount: 20, pauseTotal: 20, pauseScan: scan, pauseCountUntilMs: null, needsCheck: false,
            settings: { minAnsweredPct: 75, voicePerPauseMs: 250 }, needed: 15,
          },
          submissions,
          summary: { byStudent: counting.map(standing), done: 3, redo: 2, check: 3 },
        },
        'labs.missing': [
          { id: 9, name: 'Gabi', email: 'g@example.com', opened: false, started: false, heardThroughMs: null, skips: 0, lastSeenAt: null },
          { id: 10, name: 'Iker', email: 'i@example.com', opened: true, started: true, heardThroughMs: 400_000, skips: 0, lastSeenAt: Date.parse('2026-09-25T15:07:00Z') },
        ],
        'labs.listenLog': [{
          startedAt: Date.parse('2026-09-25T15:00:00Z'),
          started: true,
          submitted: true,
          summary: { heardThroughMs: 880_000, skips: 1, lastPositionMs: 900_000, lastAt: 0 },
          events: [
            { kind: 'open', positionMs: 0, clientMs: 0, at: Date.parse('2026-09-25T15:00:00Z'), answers: null },
            { kind: 'play', positionMs: 0, clientMs: 30_000, at: Date.parse('2026-09-25T15:00:30Z'), answers: null },
            { kind: 'tick', positionMs: 10_000, clientMs: 40_000, at: Date.parse('2026-09-25T15:00:40Z'), answers: [[5_000, 1_200]] },
            { kind: 'tick', positionMs: 125_000, clientMs: 155_000, at: Date.parse('2026-09-25T15:02:35Z'), answers: null },
            { kind: 'seek', positionMs: 115_000, clientMs: 156_000, at: Date.parse('2026-09-25T15:02:36Z'), answers: null },
            { kind: 'seek', positionMs: 460_000, clientMs: 160_000, at: Date.parse('2026-09-25T15:02:40Z'), answers: null },
          ],
        }],
      },
      mutations: {
        'labs.setCredit': (input: unknown) => {
          credits.push(input as (typeof credits)[number]);
          return { updated: (input as { submissionIds: number[] }).submissionIds.length, rows: [] };
        },
      },
    });

    await page.goto('/admin?tab=labs');
    await expect(page.getByText(sampleGroups[1].name)).toBeVisible();
    await page.getByRole('button', { name: 'Review' }).click();

    await expect(page.getByText('Must hear through 14:40 · labs started from now on count with 15 of 20 pauses answered')).toBeVisible();
    await expect(page.getByText('3 done · 2 need a redo · 3 waiting for you')).toBeVisible();
    // Nothing to listen to: labs are not recorded.
    await expect(page.getByRole('button', { name: 'Listen' })).toHaveCount(0);
    for (const header of ['Pauses answered', 'Voice heard', 'Result']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }

    const row = (name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) });
    // One row per student, the attempt that counts, without ticking "Show all attempts".
    await expect(row('Ana')).toHaveCount(1);
    await expect(row('Ana')).toContainText('18 of 20');
    await expect(row('Ana')).toContainText('Done');
    // Marks for the flags on Ana's other attempt: the red one stays red.
    await expect(row('Ana').getByText('Odd results · on 1 other attempt(s)')).toBeVisible();
    await expect(row('Ana').getByText('Odd results · on 1 other attempt(s)')).toHaveClass(/bg-red-100/);
    await expect(row('Ana').getByText('Voice outside the pauses · on 1 other attempt(s)')).toBeVisible();
    // What the page's meter measured, next to the old meter's count.
    await expect(row('Ana')).toContainText('Old meter: 19 of 20 pauses');
    await expect(row('Ana')).toContainText('Room level −52 dB · a voice needed −46 dB');
    await expect(row('Ana')).toContainText('In the background for 1:35');
    await expect(row('Beto')).toContainText('3 of 20');
    await expect(row('Beto')).toContainText('Needs redo');
    // Voice in the counted pauses (1.2 + 0.1 s), and all the voice while playing.
    await expect(row('Beto')).toContainText('0:01 in the pauses');
    await expect(row('Beto')).toContainText('0:03 while playing');
    await expect(row('Beto').getByText('Skipped ahead')).toBeVisible();
    await expect(row('Beto').getByText('Odd results')).toHaveAttribute('title', "4 pause result(s) don't add up: two results for one pause in one playback, or answers the page could not have sent. They did not count. Check the log.");
    await expect(row('Carla')).toContainText('Check it');
    await expect(row('Carla').getByText('No microphone').first()).toBeVisible();
    await expect(row('Dani')).toContainText("Says the mic didn't hear them");
    // Judged by the rule it started with: only where that differs from today's.
    await expect(row('Dani').getByRole('cell').nth(3)).toContainText('needed 10');
    await expect(row('Ana').getByRole('cell').nth(3)).not.toContainText('needed');
    await expect(row('Juan')).toContainText('Check it');
    await expect(row('Juan')).toContainText('Held: Two at once');
    await expect(page.getByText('Held labs (1) are not in “Give credit to all”: look at each one.')).toBeVisible();
    await expect(row('Eli')).toContainText('Done');
    await expect(row('Eli')).toContainText('You gave credit');
    await expect(row('Fer')).toContainText('Needs redo');
    await expect(row('Fer')).toContainText('You asked for a redo');
    await expect(row('Hugo').getByRole('cell').nth(3)).toHaveText('—');
    await expect(row('Hugo').getByText('Little speech')).toBeVisible();

    // Who still has to do it: never turned in, need a redo, or wait for the teacher.
    const still = page.getByRole('heading', { name: 'Still to do (7)' });
    await expect(still).toBeVisible();
    await expect(page.getByText('Never opened it')).toBeVisible();
    await expect(page.getByText(/Reached 6:40 · last seen/)).toBeVisible();
    await expect(page.getByText('Needs redo · 3 of 20 pauses (needed 15)')).toBeVisible();
    await expect(page.getByText('Needs redo · you asked for it')).toBeVisible();
    await expect(page.getByText('Waiting for you · no microphone')).toBeVisible();
    await expect(page.getByText("Waiting for you · says the mic didn't hear them")).toBeVisible();
    await expect(page.getByText('Waiting for you · held: Two at once')).toBeVisible();
    await expect(page.getByText('Everyone is done.')).toHaveCount(0);

    // The teacher's say, row by row.
    await row('Beto').getByRole('button', { name: 'Give credit' }).click();
    await expect.poll(() => credits.length).toBe(1);
    await row('Ana').getByRole('button', { name: 'Take credit away' }).click();
    await expect.poll(() => credits.length).toBe(2);
    await row('Carla').getByRole('button', { name: 'Ask for a redo' }).click();
    await expect.poll(() => credits.length).toBe(3);
    await row('Eli').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => credits.length).toBe(4);
    expect(credits).toEqual([
      { submissionIds: [12], credit: true },
      { submissionIds: [11], credit: false },
      { submissionIds: [13], credit: false },
      { submissionIds: [15], credit: null },
    ]);

    // And in bulk, asked first. A redo the teacher asked for is not in "all who need a redo", nor a held lab in "all waiting".
    await page.getByRole('button', { name: 'Give credit to all 2 waiting for you' }).click();
    await expect.poll(() => credits.length).toBe(5);
    await page.getByRole('button', { name: 'Give credit to all 1 who need a redo' }).click();
    await expect.poll(() => credits.length).toBe(6);
    expect(dialogs).toEqual(['Give credit to 2 student(s)?', 'Give credit to 1 student(s)?']);
    expect(credits.slice(4)).toEqual([
      { submissionIds: [13, 14], credit: true },
      { submissionIds: [12], credit: true },
    ]);

    // The log: a square per counted pause, and the voice each report carried.
    await row('Beto').getByRole('button', { name: 'Log' }).click();
    await expect(page.getByRole('img', { name: 'Pause 1 at 0:05: 1.2 s of voice' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Pause 2 at 0:15: not reported' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Pause 3 at 0:25: 0.1 s of voice' })).toBeVisible();
    await expect(page.getByText(/voice in the pause at 0:05: 1\.2 s/)).toBeVisible();
    await expect(page.getByText('1 skip(s)').first()).toBeVisible();
    await expect(page.getByText(/Opened the lab/)).toBeVisible();
    // Going back is normal and not highlighted; the jump forward is.
    const back = page.getByText(/Went back to 1:55/);
    const jump = page.getByText(/Jumped to 7:40/);
    await expect(back).toBeVisible();
    await expect(back).not.toHaveClass(/text-red/);
    await expect(jump).toHaveClass(/text-red/);

    // Ana's log: the rest of what the meter measured. Her other attempt shows with the box.
    await row('Ana').getByRole('button', { name: 'Log' }).click();
    const mic = page.getByRole('list', { name: 'Microphone' });
    await expect(mic).toContainText('Non-voice sound in the pauses: 0:02');
    await expect(mic).toContainText('Mic processing: echo cancellation on, noise suppression on, auto gain on');
    await page.getByLabel('Show all attempts').check();
    await expect(row('Ana')).toHaveCount(2);
    await expect(row('Ana').nth(1)).toContainText('another attempt');
    // The chip, whose meaning follows its name for a screen reader (so not an exact match).
    await expect(row('Ana').nth(1).getByText('Odd results')).toHaveAttribute('title', /^12 pause result\(s\) don't add up/);
  });

  test('a review says which rule the lab is judged by when it has no pause list or the rule is off', async ({ page }) => {
    let pct = 0;
    let scanned = true;
    await mockAdminTrpc(page, {
      labs: [adminLab],
      queries: {
        'labs.submissions': () => ({
          lab: {
            id: 1, title: 'ES1 Lab semana01', durationMs: 900_000, requiredThroughMs: 880_000, minimumVoicedMs: 30_000,
            pauseCount: scanned ? 20 : null, pauseTotal: scanned ? 20 : null, pauseScan: null, pauseCountUntilMs: null, needsCheck: false,
            settings: { minAnsweredPct: pct, voicePerPauseMs: 250 }, needed: scanned ? Math.ceil(20 * pct / 100) : null,
          },
          submissions: [],
          summary: { byStudent: [], done: 0, redo: 0, check: 0 },
        }),
      },
    });
    await page.goto('/admin?tab=labs');
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByText('Must hear through 14:40 · the pause rule is off, so labs started from now on all count')).toBeVisible();
    await expect(page.getByText('Nobody has turned this lab in yet.')).toBeVisible();
    await expect(page.getByText('Everyone is done.')).toBeVisible();

    await page.getByRole('button', { name: 'Back to labs' }).click();
    scanned = false;
    pct = 75;
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByText('No pause list yet: this lab uses the old rule (speak for at least 0:30).')).toBeVisible();
  });

  test('group export offers the lab, speaking and study-session datasets', async ({ page }) => {
    await mockAdminTrpc(page);
    await page.goto('/admin?tab=groups');
    await page.getByText(sampleGroups[1].name).first().click();
    const select = page.locator('select').filter({ has: page.locator('option[value="labs"]') });
    await expect(select.locator('option[value="labs"]')).toHaveText('Audio labs');
    await expect(select.locator('option[value="speaking"]')).toHaveText('Speaking tasks');
    await expect(select.locator('option[value="completions"]')).toHaveText('Study sessions finished');
  });
});

test.describe('guarding a session in a real browser', () => {
  async function startLab(page: Page, trailingSilence: number, options: {
    begin?: Record<string, unknown>;
    /** Answers labs.submit; turning in succeeds when left out. */
    submit?: (input: LabSubmit) => unknown;
    /** Install page.clock, after the scripted microphone (its voice must not stop with a paused clock). */
    clock?: boolean;
    /** The lab's audio (default: labWav with this much trailing silence). */
    audio?: Buffer;
  } = {}) {
    await scriptedMicrophone(page);
    if (options.clock) await page.clock.install();
    const heartbeats: { kind: string; positionMs: number; answers?: Answer[] }[] = [];
    const submitted: LabSubmit[] = [];
    /** Heartbeats ('heartbeat:<kind>') and submissions ('submit'), in the order the server got them. */
    const calls: string[] = [];
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        'labs.begin': { ...lab, audioUrl: '/test-lab.wav', minimumVoicedMs: 0, startToken: '1.x', ...options.begin },
        'labs.heartbeat': (input: unknown) => {
          const beat = input as (typeof heartbeats)[number];
          heartbeats.push(beat);
          calls.push(`heartbeat:${beat.kind}`);
          return { recorded: true };
        },
        'labs.submit': (input: unknown) => {
          submitted.push(input as LabSubmit);
          calls.push('submit');
          return options.submit ? options.submit(input as LabSubmit) : { success: true };
        },
      },
    });
    const audio = options.audio ?? labWav(trailingSilence);
    await page.route('**/test-lab.wav', (route) => serveAudio(route, audio));
    await page.goto('/labs?lab=1');
    await turnOnMicrophone(page);
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    return { heartbeats, submitted, calls };
  }

  test('the browser Back button asks before throwing a session away', async ({ page }) => {
    await startLab(page, 20);
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });

    await page.evaluate(() => history.back());
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Leave this lab?');
    // Still here, still going.
    await expect(page).toHaveURL(/lab=1/);
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Study/ })).toHaveCount(0);
  });

  test('audio started from outside the page (headset, lock screen) is stopped while paused, and a pause from outside is followed', async ({ page }) => {
    const { heartbeats } = await startLab(page, 20);

    await page.evaluate(() => document.querySelector('audio')!.pause());
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    // Followed, and logged: the teacher's log shows where it stopped.
    await expect.poll(() => heartbeats.filter((h) => h.kind === 'pause').length).toBe(1);
    await page.evaluate(() => document.querySelector('audio')!.play());
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.querySelector('audio')!.paused)).toBe(true);
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    // Stopping it is not another pause in the log (the count below raced it: phones sent that third pause first).
    expect(heartbeats.filter((h) => h.kind === 'pause')).toHaveLength(1);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();
    // The page's own Pause is logged too.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(() => heartbeats.filter((h) => h.kind === 'pause').length).toBe(2);
  });

  test('a jump forward is put back to where the student was, and going back is allowed', async ({ page }) => {
    const { heartbeats } = await startLab(page, 20);
    // Somewhere past the first second before the jump (Firefox can take a second to get the audio going).
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeGreaterThan(1);
    // The file supports seeking (byte ranges), so without the guard this jump would land at 15 s.
    expect(await page.evaluate(() => document.querySelector('audio')!.seekable.end(0))).toBeGreaterThan(15);
    await page.evaluate(() => { document.querySelector('audio')!.currentTime = 15; });
    // currentTime reads 15 from the moment it is set until the guard puts it back, however long the browser
    // takes to seek (Firefox under load: over half a second before 'seeking' even fires).
    const currentTime = () => page.evaluate(() => document.querySelector('audio')!.currentTime);
    await expect.poll(currentTime).toBeLessThan(3.5);
    const after = await currentTime();
    expect(after).toBeGreaterThan(0.8);
    expect(after).toBeLessThan(3.5);
    expect(heartbeats.some((h) => h.kind === 'seek' && h.positionMs > 5000)).toBe(false);

    await page.getByRole('button', { name: 'Back 10 s' }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeLessThan(1.5);
  });

  test('a stall longer than two seconds (a dialog, a slow Chromebook) leaves no hole in what was heard, nor loses the pause it happened in', async ({ page }) => {
    const [pause] = PAUSE_LAB_PAUSES;
    const { heartbeats } = await startLab(page, 0, {
      audio: pauseLabWav(),
      // A scored lab: its first pause counts; Finish opens 1.5 s before 7 s.
      begin: { durationMs: 10_700, requiredThroughMs: 7000, pauses: [pause], minAnsweredPct: 75, voicePerPauseMs: 250, needed: 1 },
    });
    // The student answers from 0.3 s into the pause, and is still answering when the page stalls.
    await setMicLevel(page, 0);
    await setMicPlan(page, [[pause[0] + 300, pause[1] - 100]]);
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeGreaterThan(1.8);
    // Block the page for 3 s while the audio plays on, through the rest of the pause.
    await page.evaluate(() => { const until = performance.now() + 3000; while (performance.now() < until) { /* busy */ } });
    // Heard through without a hole: Finish opens.
    await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled({ timeout: 6000 });
    // The pause the stall ran through still counts: the result rides on the next report.
    await expect.poll(() => heartbeats.flatMap((h) => h.answers ?? []).length, { timeout: 8000 }).toBe(1);
    const [[start, voiced]] = heartbeats.flatMap((h) => h.answers ?? []);
    expect(start).toBe(pause[0]);
    expect(voiced).toBeGreaterThanOrEqual(250);
  });

  test('after turning a lab in and going back to the list, the browser’s Back does not reopen the lab', async ({ page }) => {
    await scriptedMicrophone(page);
    let begins = 0;
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        'labs.begin': () => { begins += 1; return { ...lab, audioUrl: '/test-lab.wav', minimumVoicedMs: 0, startToken: `${begins}.x` }; },
        'labs.heartbeat': { recorded: true },
        'labs.submit': { success: true },
      },
    });
    const body = labWav(0.7);
    await page.route('**/test-lab.wav', (route) => serveAudio(route, body));
    await page.goto('/');
    await page.goto('/labs');
    await page.getByRole('button', { name: 'Start' }).click();
    await turnOnMicrophone(page);
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Back to labs' }).last().click();
    await expect(page).toHaveURL(/\/labs$/);

    await expect(page.getByRole('link', { name: /Back to Study/ })).toBeVisible();

    // One session for the one opening (development mode's second mount opens none).
    expect(begins).toBe(1);
    await page.evaluate(() => history.back());
    await page.waitForTimeout(500);
    expect(begins).toBe(1);
    await expect(page).toHaveURL(/\/labs$/);
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
  });

  test('after Start over, confirming Leave on the browser’s Back really leaves', async ({ page }) => {
    await scriptedMicrophone(page);
    await mockAuthenticatedTrpc(page, {
      labs: [lab],
      mutations: {
        'labs.begin': { ...lab, audioUrl: '/test-lab.wav', minimumVoicedMs: 0, startToken: '1.x' },
        'labs.heartbeat': { recorded: true },
        // Turning in fails, so the page offers Start over.
        'labs.submit': () => { throw new TrpcMockError('Submission failed', 'INTERNAL_SERVER_ERROR', 500); },
      },
    });
    const body = labWav(20);
    await page.route('**/test-lab.wav', (route) => serveAudio(route, body));
    page.on('dialog', (d) => { void d.accept(); });
    await page.goto('/labs');
    await page.getByRole('button', { name: 'Start' }).click();
    await turnOnMicrophone(page);
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('alert')).toContainText('Submission failed');
    await page.getByRole('button', { name: 'Start over' }).click();
    // A new session needs the microphone check again.
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await expect(page.getByRole('button', { name: 'Start the lab' })).toBeEnabled();
    await page.getByRole('button', { name: 'Start the lab' }).click();
    await expect(page.getByText('Playing', { exact: true })).toBeVisible();

    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/labs$/);
    await expect(page.getByText('Playing', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Back to Study/ })).toBeVisible();
  });

  test('a microphone dropout pauses the lab; reconnecting carries on and the session is turned in', async ({ page }) => {
    const { submitted } = await startLab(page, 0.7);

    await page.waitForTimeout(700);
    await loseMicrophone(page);
    await expect(page.getByText(/Your microphone disconnected at/)).toBeVisible();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Turn the microphone back on' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible({ timeout: 15_000 });

    expect(submitted).toHaveLength(1);
    expect(submitted[0].positionMs).toBeGreaterThanOrEqual(LAB_MS - 100);
    expect(submitted[0].mic).toBe('on');
    expect(await page.evaluate(() => (window as unknown as { __micOpened: number }).__micOpened)).toBe(2);
  });

  test('Finish pressed while the lab plays turns it in, and stopping the audio logs no pause after the submission', async ({ page }) => {
    // Twenty seconds of silence after the last prompt: Finish opens while the audio still plays.
    const { submitted, calls } = await startLab(page, 20);
    const finishButton = page.getByRole('button', { name: 'Finish' });
    await expect(finishButton).toBeEnabled();
    expect(await page.evaluate(() => document.querySelector('audio')!.paused)).toBe(false);

    await finishButton.click();
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible();
    // Room for the audio's late 'pause' event and any report it would send.
    await page.waitForTimeout(500);

    expect(submitted).toHaveLength(1);
    expect(calls).toContain('submit');
    // Nothing reaches the listening log after the submission's final entry...
    expect(calls.slice(calls.indexOf('submit') + 1)).toEqual([]);
    // ...and the student never paused, so no "Paused at" anywhere.
    expect(calls).not.toContain('heartbeat:pause');
  });

  test('turning in that never gets an answer gives up after a minute and offers Try again', async ({ page }) => {
    // A fake clock, so the minute passes at once; it runs at normal speed until then.
    let attempts = 0;
    const { submitted } = await startLab(page, 0.7, {
      clock: true,
      // The first attempt hangs like a connection that died without a word.
      submit: () => (++attempts === 1 ? new Promise(() => {}) : { success: true }),
    });

    await expect(page.getByText('Turning it in…')).toBeVisible({ timeout: 15_000 });
    await page.clock.fastForward(60_000);
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Turning it in took too long. Check your connection and press Try again.');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Turned in. Your teacher will see that you finished it.')).toBeVisible();
    expect(submitted).toHaveLength(2);
    // The same session both times: the server takes the retry as a duplicate.
    expect(submitted[1].startToken).toBe(submitted[0].startToken);
  });
});
