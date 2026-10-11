import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { allowMicrophone, fakeMicrophone, rememberTrackEndings } from './support/microphone';
import { SPEAKING, scriptedMicrophone } from './support/scriptedMicrophone';
import { mockAdminTrpc, mockAuthenticatedTrpc, TrpcMockError } from './support/trpcMock';

// A fake microphone for every test here. Chromium's beeps briefly twice a second and Firefox's is a
// steady tone: against the take's own room (v1.16.0) both are "very little speaking", so their takes
// offer "Turn it in anyway", which a { name: 'Turn it in' } locator also finds. The tests about how
// much voice a take has use the scripted microphone or a silent file instead.
test.use({ launchOptions: fakeMicrophone });

const CUENTO = 'Había una vez una niña que vivía en un pueblo pequeño.';

/** Three seconds of digital silence as a 16-bit mono WAV, for Chromium to play as its microphone. */
function silentWav(seconds: number, sampleRate = 48_000): Buffer {
  const data = seconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  return wav;
}
// Written before any browser launches: the flag names a file that must already be there.
const SILENT_WAV = join(tmpdir(), `libresrs-e2e-silent-${process.pid}.wav`);
writeFileSync(SILENT_WAV, silentWav(3));

const QUIET_REVIEW = 'We could hardly hear you. Listen back, and record it again closer to the microphone if your voice is hard to hear.';
const QUIET_TURNED_IN = 'We could hardly hear you. Record it again, closer to the microphone.';

const listed = { id: 1, title: 'Cuento semana 3', targetSeconds: 60, submittedAt: null, attempts: 0, littleSpeech: false };
const task = {
  id: 1,
  title: 'Cuento semana 3',
  instructions: 'Recita el cuento de esta semana.',
  referenceText: CUENTO,
  recitesFromMemory: false,
  modelAudioUrl: null,
  targetSeconds: 60,
  attempts: 0,
  maxAttempts: 10,
  mySubmissions: [],
};

/** The Duration a WebM declares in its Info section, read the way a player reads it. */
function webmDurationMs(file: Buffer): number | null {
  const at = file.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  if (at < 0) return null;
  const durationAt = file.indexOf(Buffer.from([0x44, 0x89, 0x88]), at);
  if (durationAt < 0 || durationAt > at + 200) return null;
  return file.readDoubleBE(durationAt + 3);
}

/** What the browser does when the network comes back, so every stale query refreshes. */
async function reconnect(page: Page) {
  // The query client only reacts to a change, so go offline first.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
}

/** Keeps each microphone request and stream, so a test can check the constraints or pull the mic out. */
async function watchMicrophone(page: Page) {
  await rememberTrackEndings(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[]; __constraints: MediaStreamConstraints[] };
    w.__streams = [];
    w.__constraints = [];
    // On the prototype: WebKit gives the page another navigator.mediaDevices than the one this script sees.
    const original = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
      w.__constraints.push(constraints ?? {});
      const stream = await original.call(this, constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
}

type Upload = { headers: Record<string, string>; body: Buffer };

async function record(page: Page, ms: number) {
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByText(/^Recording ·/)).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
}

test.describe('student', () => {
  test('dashboard shows recordings still to do and links to them', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed, { ...listed, id: 2, title: 'Escalera oral, peldaño 4', submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1 }],
    });
    await page.goto('/');
    const card = page.getByRole('link', { name: /Speaking/ });
    await expect(card).toContainText('1 recording(s) to do');
    await card.click();
    await expect(page).toHaveURL(/\/speaking$/);
    await expect(page.getByText('Cuento semana 3')).toBeVisible();
    await expect(page.getByText('Not done yet')).toBeVisible();
    await expect(page.getByText(/^Turned in /)).toBeVisible();
  });

  test('a list that fails to load says so and can be retried, not that there is nothing to do', async ({ page }) => {
    let failing = true;
    await mockAuthenticatedTrpc(page, {
      queries: {
        'speaking.list': () => {
          if (failing) throw new TrpcMockError('Server unavailable', 'INTERNAL_SERVER_ERROR', 500);
          return [listed];
        },
      },
    });
    await page.goto('/speaking');
    await expect(page.getByRole('alert')).toContainText('Could not load your speaking tasks.');
    await expect(page.getByText('Nothing to record right now.')).toHaveCount(0);

    failing = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Cuento semana 3')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a very quiet take still counts as turned in; the list asks for a new one', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [{ ...listed, submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1, littleSpeech: true }],
    });
    await page.goto('/');
    const card = page.getByRole('link', { name: /Speaking/ });
    await expect(card).toContainText('All recordings turned in');
    await card.click();
    const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Cuento semana 3' }) });
    await expect(item).toContainText(/Turned in .+ · /);
    await expect(item).toContainText(QUIET_TURNED_IN);
    await expect(item.getByRole('button', { name: 'Open' })).toBeVisible();
  });

  test('dashboard has no speaking card when nothing is assigned', async ({ page }) => {
    await mockAuthenticatedTrpc(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Speaking/ })).toHaveCount(0);
  });
});

test.describe('a speaking test (v1.21.0)', () => {
  const testListed = { ...listed, id: 7, title: 'Examen U3 · Expresión oral', examSet: 'U3' };
  const testTask = { ...task, id: 7, title: 'Examen U3 · Expresión oral', examSet: 'U3' };

  test('is listed on the Tests page, not the Speaking page, and opens the same runner there', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { speakingTasks: [{ ...listed, examSet: null }, testListed], queries: { 'speaking.get': testTask } });
    await page.goto('/');
    // The front page counts it as a test, and Speaking only the practice task.
    await expect(page.getByRole('link', { name: /^Tests/ })).toContainText('1 test(s) to take');
    await expect(page.getByRole('link', { name: /Speaking/ })).toContainText('1 recording(s) to do');

    await page.goto('/speaking');
    await expect(page.getByText('Cuento semana 3')).toBeVisible();
    await expect(page.getByText('Examen U3 · Expresión oral')).toHaveCount(0);
    await page.getByRole('link', { name: 'Go to Tests' }).click();

    await expect(page).toHaveURL(/\/tests$/);
    const set = page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Test U3' }) });
    await expect(set.getByRole('heading', { level: 3, name: 'Speaking' })).toBeVisible();
    await expect(set).toContainText('Not done yet');
    await expect(page.getByRole('main')).not.toContainText('Cuento semana 3');
    await set.getByRole('button', { name: 'Start: Examen U3 · Expresión oral' }).click();

    await expect(page).toHaveURL(/\/tests\?task=7$/);
    await expect(page.getByText('Test · U3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Examen U3 · Expresión oral' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(set).toBeVisible();
  });

  test('a direct link to it on the Speaking page opens the same runner, and goes back to the Tests page', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { speakingTasks: [testListed], queries: { 'speaking.get': testTask } });
    await page.goto('/speaking?task=7');
    await expect(page.getByText('Test · U3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to speaking' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Test U3' })).toBeVisible();
  });
});

test.describe('recording a task in a real browser', () => {
  test('records with the browser’s voice processing off and turns in a seekable file', async ({ page }) => {
    await allowMicrophone(page);
    await watchMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    let upload: Upload | null = null;
    await page.route('**/api/speaking/1/submission', async (route, request) => {
      upload = { headers: request.headers(), body: request.postDataBuffer() ?? Buffer.alloc(0) };
      await route.fulfill({ json: { success: true, submissionId: 5 } });
    });

    await page.goto('/speaking?task=1');
    await expect(page.getByText(CUENTO)).toBeVisible();
    await expect(page.getByText('Aim for about 1:00.')).toBeVisible();
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    // The text stays up while the student reads it aloud.
    await expect(page.getByText(CUENTO)).toBeVisible();
    // What the browser applied, read while the microphone is live: Firefox reports none once it is released.
    const settings = await page.evaluate(() => {
      const w = window as unknown as { __streams: MediaStream[] };
      return w.__streams[0].getAudioTracks()[0].getSettings();
    });
    expect(settings.echoCancellation).toBe(false);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();

    const constraints = await page.evaluate(() => (window as unknown as { __constraints: MediaStreamConstraints[] }).__constraints);
    expect(constraints[0].audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });

    const sent = upload as Upload | null;
    expect(sent).not.toBeNull();
    expect(sent!.headers['x-csrf-token']).toBeDefined();
    expect(sent!.headers['x-submission-key']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    const durationMs = Number(sent!.headers['x-recording-duration-ms']);
    expect(durationMs).toBeGreaterThan(1200);
    expect(durationMs).toBeLessThan(4000);
    expect(Number(sent!.headers['x-recording-voiced-ms'])).toBeLessThanOrEqual(durationMs);
    expect(sent!.headers['content-type']).toMatch(/^audio\/webm/);
    // The bytes are the WebM the type says (an EBML header): the server reads a take by its bytes,
    // stores it as what they are, and refuses one that is none of the recorder's containers (415).
    expect(sent!.body.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
    expect(webmDurationMs(sent!.body)).toBe(durationMs);
    // What the browser applied goes with the take, for the teacher; never the device's id.
    const micSettings = JSON.parse(sent!.headers['x-mic-settings']) as Record<string, unknown>;
    expect(micSettings).toMatchObject({ echoCancellation: false });
    expect(micSettings).not.toHaveProperty('deviceId');
  });

  test('a failed upload keeps the take, and the retry carries the same submission key', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    const keys: string[] = [];
    await page.route('**/api/speaking/1/submission', async (route, request) => {
      keys.push(request.headers()['x-submission-key']);
      if (keys.length === 1) await route.fulfill({ status: 500, json: { error: 'Submission failed' } });
      else await route.fulfill({ json: { success: true, submissionId: 5 } });
    });

    await page.goto('/speaking?task=1');
    await record(page, 800);
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByRole('alert')).toContainText('Submission failed');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  test('recording again after a failed upload makes a new take with a new key', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    const keys: string[] = [];
    await page.route('**/api/speaking/1/submission', async (route, request) => {
      keys.push(request.headers()['x-submission-key']);
      if (keys.length === 1) await route.fulfill({ status: 500, json: { error: 'Submission failed' } });
      else await route.fulfill({ json: { success: true, submissionId: 5 } });
    });
    page.on('dialog', (d) => { void d.accept(); });

    await page.goto('/speaking?task=1');
    await record(page, 600);
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByRole('alert')).toContainText('Submission failed');
    await page.getByRole('button', { name: 'Record again' }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  test('a take far under the goal gets a warning to check it, and can still be turned in', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': { ...task, targetSeconds: 5 } } });
    await page.route('**/api/speaking/1/submission', (route) => route.fulfill({ json: { success: true, submissionId: 5 } }));

    await page.goto('/speaking?task=1');
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    // The clock shows the goal beside it.
    await expect(page.getByText(/^Recording · 0:0\d \/ 0:05$/)).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByText('This is much shorter than the 0:05 goal. Check that you did all of it.')).toBeVisible();
    // A hint, not an error: the page's alerts stay the upload's.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
  });

  test('with no goal set there is no length warning, and the clock stands alone', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': { ...task, targetSeconds: null } } });
    await page.goto('/speaking?task=1');
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByText(/^Recording · 0:0\d$/)).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByText(/much shorter than the/)).toHaveCount(0);
  });

  test('a recite-from-memory task hides the text', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: { 'speaking.get': { ...task, referenceText: null, recitesFromMemory: true } },
    });
    await page.goto('/speaking?task=1');
    await expect(page.getByText('Recite this from memory: the text is not shown here.')).toBeVisible();
    await expect(page.getByText(CUENTO)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Read this aloud' })).toHaveCount(0);
  });

  test('at the attempt limit there is no way to record', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: { 'speaking.get': { ...task, attempts: 10 } },
    });
    await page.goto('/speaking?task=1');
    await expect(page.getByText(/already turned this in 10 times/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
  });

  test('the browser Back button asks before throwing a take away', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    await page.goto('/speaking');
    await page.getByRole('button', { name: 'Start' }).click();
    await record(page, 500);
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });

    await page.evaluate(() => history.back());
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Leave this page?');
    await expect(page).toHaveURL(/task=1/);
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Study/ })).toHaveCount(0);
  });

  test('Back to speaking asks before throwing a take away', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    await page.goto('/speaking');
    await page.getByRole('button', { name: 'Start' }).click();
    await record(page, 500);
    const dialogs: string[] = [];
    const answers = [false, true];
    page.on('dialog', (d) => { dialogs.push(d.message()); void (answers.shift() ? d.accept() : d.dismiss()); });

    await page.getByRole('button', { name: 'Back to speaking' }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Leave this page?');
    await expect(page).toHaveURL(/task=1/);
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn it in' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to speaking' }).click();
    await expect(page).toHaveURL(/\/speaking$/);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Study/ })).toBeVisible();
    // Asked once: stepping back over the guard's history entry does not ask again.
    expect(dialogs).toHaveLength(2);
  });

  test('a failed refresh of the task keeps the page and the take', async ({ page }) => {
    await allowMicrophone(page);
    let failing = false;
    let loads = 0;
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: {
        'speaking.get': () => {
          loads += 1;
          if (failing) throw new TrpcMockError('Server unavailable', 'INTERNAL_SERVER_ERROR', 500);
          return task;
        },
      },
    });
    let uploads = 0;
    await page.route('**/api/speaking/1/submission', async (route) => {
      uploads += 1;
      if (uploads === 1) await route.fulfill({ status: 500, json: { error: 'Submission failed' } });
      else await route.fulfill({ json: { success: true, submissionId: 5 } });
    });

    await page.goto('/speaking?task=1');
    await expect(page.getByText(CUENTO)).toBeVisible();
    failing = true;

    // Before recording, a reconnect refreshes the task; that failing leaves the task up.
    const beforeReconnect = loads;
    await reconnect(page);
    await expect.poll(() => loads).toBeGreaterThanOrEqual(beforeReconnect + 2); // the refresh and its retry
    await page.waitForTimeout(300);
    await expect(page.getByText(CUENTO)).toBeVisible();
    await expect(page.getByText('Server unavailable')).toHaveCount(0);

    await record(page, 600);
    // Holding a take, a reconnect does not reload the task at all.
    const holding = loads;
    await reconnect(page);
    await page.waitForTimeout(500);
    expect(loads).toBe(holding);

    // A failed upload reloads it (the upload may have landed); that failing too must not cost the take.
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByRole('alert')).toContainText('Submission failed');
    await expect.poll(() => loads).toBeGreaterThanOrEqual(holding + 2);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByText('Server unavailable')).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
  });

  test('a refusal at the attempt limit says so in the student’s language and offers no retry', async ({ page }) => {
    await allowMicrophone(page);
    // Nine turned in when the page opened; the tenth landed from another tab meanwhile.
    let refused = false;
    let loads = 0;
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: {
        'speaking.get': () => {
          loads += 1;
          return { ...task, attempts: refused ? 10 : 9 };
        },
      },
    });
    await page.route('**/api/speaking/1/submission', async (route) => {
      refused = true;
      await route.fulfill({ status: 429, json: { error: 'You have already turned this in 10 times. Ask your teacher before recording it again.' } });
    });

    await page.goto('/speaking?task=1');
    await record(page, 500);
    const beforeUpload = loads;
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByRole('alert')).toHaveText('You have reached the limit of recordings for this task. Ask your teacher.');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Turn it in' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record again' })).toHaveCount(0);
    // The take stays playable, and the reloaded task shows the limit.
    await expect(page.locator('audio[src^="blob:"]')).toHaveCount(1);
    await expect.poll(() => loads).toBeGreaterThan(beforeUpload);
    await expect(page.getByText(/already turned this in 10 times/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
  });

  test('a 429 from the rate limiter (not the limit) keeps Try again, and the retry goes through', async ({ page }) => {
    await allowMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    const keys: string[] = [];
    await page.route('**/api/speaking/1/submission', async (route, request) => {
      keys.push(request.headers()['x-submission-key']);
      // express-rate-limit's answer: plain text, not the server's JSON refusal.
      if (keys.length === 1) await route.fulfill({ status: 429, contentType: 'text/plain', body: 'Too many requests, please try again later.' });
      else await route.fulfill({ json: { success: true, submissionId: 5 } });
    });

    await page.goto('/speaking?task=1');
    await record(page, 500);
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Too many uploads at once right now. Wait a minute, then press Try again.');
    await expect(page.getByRole('button', { name: 'Record again' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  test('when a lost reply turns out to have been the last allowed recording, there is no Record again', async ({ page }) => {
    await allowMicrophone(page);
    let landed = false;
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: { 'speaking.get': () => ({ ...task, attempts: landed ? 10 : 9 }) },
    });
    await page.route('**/api/speaking/1/submission', async (route) => {
      landed = true;
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
    });

    await page.goto('/speaking?task=1');
    await record(page, 500);
    await page.getByRole('button', { name: 'Turn it in' }).click();
    await expect(page.getByText(/already turned this in 10 times/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record again' })).toHaveCount(0);
  });

  test('a microphone dropout stops the recording and keeps what was recorded', async ({ page }) => {
    await allowMicrophone(page);
    await watchMicrophone(page);
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': task } });
    await page.goto('/speaking?task=1');
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const w = window as unknown as { __streams: MediaStream[]; __endTrack: (track: MediaStreamTrack) => void };
      w.__endTrack(w.__streams[w.__streams.length - 1].getAudioTracks()[0]);
    });
    await expect(page.getByText(/The microphone disconnected, so the recording stopped at/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn it in' })).toBeVisible();
  });

  test('shows the teacher’s grade and comment on what was turned in, and “Not graded yet.” on the newest without one', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: {
        'speaking.get': {
          ...task,
          attempts: 3,
          mySubmissions: [
            { id: 5, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000005.webm', durationMs: 30_000, submittedAt: '2026-09-26T15:12:00.000Z', score: null, feedback: null, gradedAt: null },
            { id: 4, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000004.webm', durationMs: 29_000, submittedAt: '2026-09-25T15:12:00.000Z', score: 84.5, feedback: 'Keep your e short.\nGood rhythm.', gradedAt: '2026-09-26T02:00:00.000Z' },
            { id: 3, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000003.webm', durationMs: 14_000, submittedAt: '2026-09-24T15:12:00.000Z', score: 0, feedback: null, gradedAt: '2026-09-25T02:00:00.000Z' },
          ],
        },
      },
    });
    await page.goto('/speaking?task=1');
    const card = page.locator('div', { has: page.getByRole('heading', { name: 'What you have turned in' }) }).last();
    const turnedIn = card.getByRole('listitem');
    await expect(turnedIn).toHaveCount(3);
    // The newest, not graded yet.
    await expect(turnedIn.nth(0)).toContainText('Not graded yet.');
    await expect(turnedIn.nth(0)).not.toContainText('Grade:');
    // A grade with the teacher's comment, kept as written.
    await expect(turnedIn.nth(1)).toContainText('Grade: 84.5 out of 100');
    await expect(turnedIn.nth(1)).toContainText("Your teacher's comment");
    await expect(turnedIn.nth(1).getByText('Keep your e short.')).toHaveCSS('white-space', 'pre-wrap');
    // A grade of 0 is a grade; "Not graded yet." is only ever on the newest.
    await expect(turnedIn.nth(2)).toContainText('Grade: 0 out of 100');
    await expect(turnedIn.nth(2)).not.toContainText("Your teacher's comment");
    await expect(page.getByText('Not graded yet.')).toHaveCount(1);
  });

  test('shows what the student already turned in, playable', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: {
        'speaking.get': {
          ...task,
          attempts: 1,
          mySubmissions: [{ id: 3, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000003.webm', durationMs: 61_000, submittedAt: '2026-09-25T15:12:00.000Z' }],
        },
      },
    });
    await page.goto('/speaking?task=1');
    await expect(page.getByRole('heading', { name: 'What you have turned in' })).toBeVisible();
    await expect(page.locator('audio[src="/api/recordings/00000000-0000-4000-8000-000000000003.webm"]')).toHaveCount(1);
    await expect(page.getByText(/1:01/)).toBeVisible();
  });
});

test.describe('how much of a take is voice (v1.16.0)', () => {
  test('a take with a voice in it offers Turn it in first, with no nudge', async ({ page }) => {
    // A quiet room (about −53 dBFS), and a voice in bursts well over it.
    const ROOM = 0.003;
    await scriptedMicrophone(page, { level: ROOM });
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': { ...task, targetSeconds: null } } });
    let upload: Upload | null = null;
    await page.route('**/api/speaking/1/submission', async (route, request) => {
      upload = { headers: request.headers(), body: request.postDataBuffer() ?? Buffer.alloc(0) };
      await route.fulfill({ json: { success: true, submissionId: 5 } });
    });

    await page.goto('/speaking?task=1');
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    // The check hears the room first.
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Start recording' }).click();
    // Speaks 400 ms, pauses 200 ms, for 3 s.
    await page.evaluate(({ speaking, room }) => new Promise<void>((resolve) => {
      const mic = (window as unknown as { __mic: (level: number) => void }).__mic;
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        mic(n % 3 === 0 ? room : speaking);
        if (n >= 15) { clearInterval(timer); mic(room); resolve(); }
      }, 200);
    }), { speaking: SPEAKING, room: ROOM });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Your recording' })).toBeVisible();

    await expect(page.getByText(QUIET_REVIEW)).toHaveCount(0);
    const turnIn = page.getByRole('button', { name: 'Turn it in', exact: true });
    await expect(turnIn).toHaveClass(/bg-blue-600/);
    await expect(page.getByRole('button', { name: 'Record again', exact: true })).toBeVisible();
    await turnIn.click();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
    const sent = upload as Upload | null;
    expect(Number(sent!.headers['x-recording-voiced-ms'])).toBeGreaterThan(1000);
    expect(Number(sent!.headers['x-recording-voiced-ms'])).toBeLessThanOrEqual(Number(sent!.headers['x-recording-duration-ms']));
  });

  test.describe('a silent microphone', () => {
    // Chromium plays this file as its microphone: nothing but zeros. Launch options can't be set for a
    // describe (Playwright refuses: they force a new worker), so the test launches that Chromium itself.
    const silentMicrophone = { ...fakeMicrophone, args: [...fakeMicrophone.args, `--use-file-for-fake-audio-capture=${SILENT_WAV}`] };

    test('gets "We could hardly hear you", Record it again first, and can still be turned in anyway', async ({ playwright, browserName }) => {
      test.skip(browserName !== 'chromium', 'Only Chromium plays a file as its fake microphone.');
      const browser = await playwright.chromium.launch(silentMicrophone);
      try {
        const page = await browser.newPage({ baseURL: test.info().project.use.baseURL });
        await allowMicrophone(page);
        await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': { ...task, targetSeconds: null } } });
        let upload: Upload | null = null;
        await page.route('**/api/speaking/1/submission', async (route, request) => {
          upload = { headers: request.headers(), body: request.postDataBuffer() ?? Buffer.alloc(0) };
          await route.fulfill({ json: { success: true, submissionId: 5 } });
        });

        await page.goto('/speaking?task=1');
        await record(page, 1500);
        await expect(page.getByText(QUIET_REVIEW)).toBeVisible();
        // A nudge, not an error.
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Turn it in', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Record it again' })).toHaveClass(/bg-blue-600/);
        const anyway = page.getByRole('button', { name: 'Turn it in anyway' });
        await expect(anyway).not.toHaveClass(/bg-blue-600/);
        await anyway.click();
        await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
        expect((upload as Upload | null)!.headers['x-recording-voiced-ms']).toBe('0');
      } finally {
        await browser.close();
      }
    });
  });
});

test.describe('a task already turned in (v1.16.0)', () => {
  const turnedIn = (overrides: Record<string, unknown> = {}) => ({
    ...task,
    attempts: 1,
    mySubmissions: [{
      id: 3, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000003.webm', durationMs: 58_000,
      submittedAt: '2026-09-25T15:12:00.000Z', score: null, feedback: null, gradedAt: null, littleSpeech: false, ...overrides,
    }],
  });

  test('shows the turned-in take first, and the microphone only after Record it again', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': turnedIn() } });
    await page.goto('/speaking?task=1');
    await expect(page.getByText(/^You turned this in on /)).toBeVisible();
    await expect(page.getByText('Turned in. Your teacher can listen to it now.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);
    const again = page.getByRole('button', { name: 'Record it again' });
    await expect(again).not.toHaveClass(/bg-blue-600/);
    await again.click();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
    await expect(page.getByText(/^You turned this in on /)).toHaveCount(0);
  });

  test('asks before a new take replaces a graded one', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      speakingTasks: [listed],
      queries: { 'speaking.get': turnedIn({ score: 84.5, feedback: 'Bien.', gradedAt: '2026-09-26T02:00:00.000Z' }) },
    });
    const dialogs: string[] = [];
    const answers = [false, true];
    page.on('dialog', (d) => { dialogs.push(d.message()); void (answers.shift() ? d.accept() : d.dismiss()); });

    await page.goto('/speaking?task=1');
    await expect(page.getByText('Your teacher graded it: 84.5 out of 100.')).toBeVisible();
    await page.getByRole('button', { name: 'Record it again' }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe('Your teacher already graded this recording (84.5 out of 100). A new recording replaces it and will need a new grade. Record again?');
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Record it again' }).click();
    await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
  });

  test('asks for a new take of a quiet one, with Record it again first', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { speakingTasks: [listed], queries: { 'speaking.get': turnedIn({ littleSpeech: true }) } });
    await page.goto('/speaking?task=1');
    await expect(page.getByText(QUIET_TURNED_IN)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record it again' })).toHaveClass(/bg-blue-600/);
  });
});

test.describe('admin', () => {
  const adminTask = {
    id: 1, title: 'Cuento semana 3', instructions: null, referenceText: CUENTO, showReference: true,
    modelAudioUrl: null, targetSeconds: 60, forEveryone: true, active: true, createdBy: 1,
    createdAt: '2026-09-20T00:00:00.000Z', groupIds: [], studentCount: 2, ungraded: 1,
    lastSubmittedAt: '2026-09-25T15:12:00.000Z', examSet: null as string | null,
  };

  test('creates a recite-from-memory task with a model recording', async ({ page }) => {
    const created: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      mutations: { 'speaking.create': (input: unknown) => { created.push(input as Record<string, unknown>); return { id: 9 }; } },
    });
    let mediaType = '';
    await page.route('**/api/media', async (route, request) => {
      mediaType = request.headers()['content-type'];
      await route.fulfill({ json: { audioUrl: '/api/assets/00000000-0000-4000-8000-000000000001.mp3', mimeType: 'audio/mpeg', sizeBytes: 3 } });
    });

    await page.goto('/admin?tab=speaking');
    await page.getByRole('button', { name: 'New speaking task' }).click();
    await page.getByLabel('Title').fill('Cuento U1 A');
    await page.getByLabel('Reference text (optional)').fill(CUENTO);
    await page.getByLabel('Students see the text while recording').uncheck();
    await page.getByLabel('Upload an audio file').setInputFiles({ name: 'U1_cuento_A.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from([1, 2, 3]) });
    await expect(page.getByLabel('Model recording')).toHaveAttribute('src', '/api/assets/00000000-0000-4000-8000-000000000001.mp3');
    await page.getByLabel(/^Released to students/).check();
    await page.getByRole('button', { name: 'Create task' }).click();

    await expect.poll(() => created.length).toBe(1);
    expect(mediaType).toBe('audio/mpeg');
    expect(created[0]).toMatchObject({
      title: 'Cuento U1 A',
      referenceText: CUENTO,
      showReference: false,
      modelAudioUrl: '/api/assets/00000000-0000-4000-8000-000000000001.mp3',
      active: true,
      examSet: null,
      groupIds: [],
    });
  });

  test('shows a speaking test’s set, and makes a task a test from its editor (v1.21.0)', async ({ page }) => {
    const updates: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      speakingTasks: [adminTask, { ...adminTask, id: 7, title: 'Examen U3 · Expresión oral', examSet: 'U3' }],
      mutations: { 'speaking.update': (input: unknown) => { updates.push(input as Record<string, unknown>); return { success: true }; } },
    });
    await page.goto('/admin?tab=speaking');
    await expect(page.getByRole('row', { name: /Examen U3/ })).toContainText('Test · U3');
    await expect(page.getByRole('row', { name: /Cuento semana 3/ })).not.toContainText('Test ·');

    await page.getByRole('row', { name: /Cuento semana 3/ }).getByRole('button', { name: 'Edit' }).click();
    const field = page.getByLabel('Exam set');
    await expect(field).toHaveValue('');
    await expect(page.getByText(/Leave it empty for a practice task\./)).toBeVisible();
    await field.fill(' u3 ');
    await page.getByRole('button', { name: 'Save' }).click();
    // Trimmed here; the server stores it in the set's spelling ("U3").
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toMatchObject({ id: 1, examSet: 'u3' });
  });

  test('reviews recordings, shows an agent’s grade, and records the teacher’s', async ({ page }) => {
    const grades: Record<string, unknown>[] = [];
    const details = JSON.stringify({ version: 1, vowels: { e: { n: 33, ok: 27 } } });
    await mockAdminTrpc(page, {
      speakingTasks: [adminTask],
      queries: {
        'speaking.submissions': {
          task: { id: 1, title: 'Cuento semana 3', targetSeconds: 60, referenceText: CUENTO, modelAudioUrl: null },
          submissions: [
            { id: 21, referenceText: CUENTO, userId: 2, studentName: 'Ana', studentEmail: 'ana@example.com', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000021.webm', durationMs: 58_000, voicedMs: 44_000, submittedAt: '2026-09-25T15:12:00.000Z', gradeScore: 84, gradeDetails: details, gradeFeedback: 'Keep your e short.', gradedBy: 'vowel-grader v1', gradedAt: '2026-09-26T02:00:00.000Z', isTeacher: false, attempts: 1 },
            { id: 23, referenceText: CUENTO, userId: 3, studentName: 'Beto', studentEmail: 'beto@example.com', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000023.webm', durationMs: 61_000, voicedMs: 40_000, submittedAt: '2026-09-25T16:00:00.000Z', gradeScore: null, gradeDetails: null, gradeFeedback: null, gradedBy: null, gradedAt: null, isTeacher: false, attempts: 2 },
            { id: 22, referenceText: CUENTO, userId: 3, studentName: 'Beto', studentEmail: 'beto@example.com', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000022.webm', durationMs: 20_000, voicedMs: 9_000, submittedAt: '2026-09-25T15:30:00.000Z', gradeScore: null, gradeDetails: null, gradeFeedback: null, gradedBy: null, gradedAt: null, isTeacher: false, attempts: 2 },
          ],
        },
        'speaking.missing': [{ id: 4, name: 'Carla', email: 'c@example.com' }],
      },
      mutations: { 'speaking.grade': (input: unknown) => { grades.push(input as Record<string, unknown>); return { success: true }; } },
    });

    await page.goto('/admin?tab=speaking');
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByText('Carla')).toBeVisible();
    // Latest per student only, until earlier attempts are asked for.
    await expect(page.getByRole('row', { name: /Beto/ })).toHaveCount(1);
    await page.getByLabel('Show earlier attempts').check();
    await expect(page.getByRole('row', { name: /Beto/ })).toHaveCount(2);
    await page.getByLabel('Show earlier attempts').uncheck();

    await page.getByRole('row', { name: /Ana/ }).getByRole('button', { name: 'Listen' }).click();
    await expect(page.locator('audio[src="/api/recordings/00000000-0000-4000-8000-000000000021.webm"]')).toHaveCount(1);
    // Recorded against the text the task still has: no note about a changed text.
    await expect(page.getByText('Text this recording was made against')).toHaveCount(0);
    await expect(page.getByText(/reference text has changed|recorded before the task had a reference text/)).toHaveCount(0);
    await expect(page.getByText(/graded by vowel-grader v1/)).toBeVisible();
    await page.getByText('Grader details').click();
    await expect(page.getByText('"version": 1')).toBeVisible();

    await page.getByRole('row', { name: /Beto/ }).getByRole('button', { name: 'Listen' }).click();
    await page.getByLabel('Score (0–100)').fill('91');
    // The teacher is told the student reads the comment.
    await page.getByLabel('Comment for the student (they will see it)').fill('¡Muy bien!');
    await page.getByRole('button', { name: 'Save grade' }).click();
    await expect.poll(() => grades.length).toBe(1);
    expect(grades[0]).toMatchObject({ submissionId: 23, score: 91, feedback: '¡Muy bien!', gradedBy: 'teacher' });
  });

  test('shows what the server found in each take: copies in red, a mistimed or quiet take in amber (v1.16.0)', async ({ page }) => {
    const base = {
      referenceText: CUENTO, studentEmail: 'x@example.com', gradeScore: null, gradeDetails: null, gradeFeedback: null,
      gradedBy: null, gradedAt: null, isTeacher: false, clientVoicedMs: null, micSettings: null, sameFileAs: null, copiedFrom: null,
    };
    const anasEarlier = { submissionId: 20, taskId: 1, taskTitle: 'Cuento semana 3', studentName: 'Ana', submittedAt: '2026-09-24T15:12:00.000Z' };
    await mockAdminTrpc(page, {
      speakingTasks: [adminTask],
      queries: {
        'speaking.submissions': {
          task: { id: 1, title: 'Cuento semana 3', targetSeconds: 60, referenceText: CUENTO, modelAudioUrl: null },
          submissions: [
            { ...base, id: 21, userId: 2, studentName: 'Ana', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000021.webm', durationMs: 3_000, voicedMs: 3_000, clientDurationMs: 45_000, submittedAt: '2026-09-25T15:12:00.000Z', attempts: 2, flags: ['length-mismatch'] },
            { ...base, id: 20, userId: 2, studentName: 'Ana', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000020.webm', durationMs: 30_000, voicedMs: 20_000, clientDurationMs: 30_050, submittedAt: '2026-09-24T15:12:00.000Z', attempts: 2, flags: [] },
            { ...base, id: 23, userId: 3, studentName: 'Beto', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000023.webm', durationMs: 30_000, voicedMs: 0, clientDurationMs: 30_040, submittedAt: '2026-09-25T16:00:00.000Z', attempts: 2, flags: ['little-speech'] },
            { ...base, id: 22, userId: 3, studentName: 'Beto', audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000022.webm', durationMs: 30_000, voicedMs: 20_000, clientDurationMs: 30_050, submittedAt: '2026-09-24T16:00:00.000Z', attempts: 2, flags: ['copied'], copiedFrom: anasEarlier },
          ],
        },
        'speaking.missing': [],
      },
    });

    await page.goto('/admin?tab=speaking');
    await page.getByRole('button', { name: 'Review' }).click();
    // By the start of the row: Beto's row names Ana's recording.
    const ana = page.getByRole('row', { name: /^Ana/ });
    await expect(ana.getByText('The page timed it at 0:45; the file is 0:03')).toBeVisible();
    const beto = page.getByRole('row', { name: /^Beto/ });
    await expect(beto.getByText('Very little speaking')).toBeVisible();
    // Beto's earlier take was Ana's file: carried up to the take that counts.
    await expect(beto.getByText('Same file as Ana’s recording · earlier attempt')).toBeVisible();
    await expect(page.getByText('Spoke for is measured by the student’s page, capped at the file’s real length.')).toBeVisible();

    await page.getByLabel('Show earlier attempts').check();
    await expect(page.getByRole('row', { name: /Beto · earlier/ }).getByText('Same file as Ana’s recording')).toBeVisible();
  });
});
