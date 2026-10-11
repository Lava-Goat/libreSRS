// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A microphone for the recording specs (labs, speaking) in every engine Playwright runs.
 *
 * Chromium and Firefox fake one through launch settings, a steady tone the level meters count as speech;
 * WebKit's mock microphone is on by itself. Only Chromium knows the 'microphone' permission.
 */
import { test, type Page } from '@playwright/test';

/** Launch settings for a fake microphone with no prompt. Each engine ignores the other's. */
export const fakeMicrophone = {
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } as Record<string, boolean | number>,
};

const MIC_CHECK_MS = 5000;
/** One check per worker (a worker runs one project): null when the microphone opens, else why not. */
let micCheck: Promise<string | null> | undefined;

/**
 * Opens and closes the microphone on a blank page of the app's origin (a secure context), within a few seconds.
 * The page is in a context of its own: a test's page made by browser.newPage() (the silent microphone's own
 * Chromium) owns its context, which refuses a second page, so a worker whose first check came from that test
 * failed it.
 */
async function checkMicrophone(page: Page): Promise<string | null> {
  const browser = page.context().browser();
  const context = browser ? await browser.newContext() : page.context();
  if (browser?.browserType().name() === 'chromium') await context.grantPermissions(['microphone']);
  const probe = await context.newPage();
  try {
    await probe.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Microphone check</title>' }));
    await probe.goto(new URL('/microphone-check', test.info().project.use.baseURL).href);
    return await probe.evaluate(async (ms) => {
      const opened = navigator.mediaDevices.getUserMedia({ audio: true }).then(
        (stream) => { stream.getTracks().forEach((track) => track.stop()); return null; },
        (err: unknown) => `getUserMedia failed: ${String(err)}`,
      );
      const late = new Promise<string>((resolve) => setTimeout(() => resolve(`getUserMedia gave no answer within ${ms / 1000} s`), ms));
      return Promise.race([opened, late]);
    }, MIC_CHECK_MS);
  } finally {
    await (context === page.context() ? probe.close() : context.close());
  }
}

/**
 * Lets the page use the microphone, before it asks. The check opens the microphone the plainest way, with
 * none of the app's code, so a dead microphone fails once with a clear reason instead of a thirty-second
 * timeout in every recording test. One gap is skipped, saying so: Playwright's WebKit on a Mac goes through
 * the system's audio capture, and on a Mac getUserMedia can stop answering mid-session. Anywhere
 * else (CI included) it fails: a skip would hide the recordings students hand in behind a green run.
 */
export async function allowMicrophone(page: Page): Promise<void> {
  const browser = page.context().browser()?.browserType().name();
  if (browser === 'chromium') await page.context().grantPermissions(['microphone']);
  micCheck ??= checkMicrophone(page);
  const problem = await micCheck;
  // Only Playwright's WebKit on a Mac is known to lose its microphone; anywhere else a dead microphone is a failure.
  const knownLocalGap = browser === 'webkit' && process.platform === 'darwin' && !process.env.CI;
  if (problem !== null && !knownLocalGap) {
    throw new Error(`${browser} cannot open its fake microphone (${problem}); the recording tests need one.`);
  }
  test.skip(problem !== null, `${browser} cannot open its fake microphone on this machine (${problem}); the recording tests need one.`);
}

/**
 * Before the page loads: keeps the page's own 'ended' listeners on each microphone track, and gives the test
 * window.__endTrack(track) to pull that microphone out. Firefox does not deliver an 'ended' that a script
 * dispatches on a track, so the listeners are called as the browser would call them.
 */
export async function rememberTrackEndings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new WeakMap<MediaStreamTrack, EventListenerOrEventListenerObject[]>();
    const proto = MediaStreamTrack.prototype;
    const add = proto.addEventListener;
    const remove = proto.removeEventListener;
    proto.addEventListener = function (this: MediaStreamTrack, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type === 'ended' && listener) listeners.set(this, [...(listeners.get(this) ?? []), listener]);
      add.call(this, type, listener, options);
    };
    proto.removeEventListener = function (this: MediaStreamTrack, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
      if (type === 'ended') listeners.set(this, (listeners.get(this) ?? []).filter((l) => l !== listener));
      remove.call(this, type, listener, options);
    };
    (window as unknown as { __endTrack: (track: MediaStreamTrack) => void }).__endTrack = (track) => {
      const event = new Event('ended');
      for (const listener of listeners.get(track) ?? []) {
        if (typeof listener === 'function') listener.call(track, event);
        else listener.handleEvent(event);
      }
    };
  });
}
