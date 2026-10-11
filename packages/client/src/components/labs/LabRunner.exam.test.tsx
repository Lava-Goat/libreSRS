// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * An exam lab in the lab page (v1.19.0): no microphone, the rules in English
 * and Spanish, one start the server must confirm before any audio, played once
 * straight through (nothing on the page, a headset, the lock screen or the
 * keyboard pauses or moves it), the automatic pause on a lost connection kept
 * (Resume carries on from where it stopped), and no way to start it again.
 * Its way back says Back to tests and tells the page it was a test (v1.21.0),
 * so the student lands on the Tests page, where it is listed.
 */
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { LOCALE_STORAGE_KEY, MESSAGES } from '../../i18n/messages';
import LabRunner from './LabRunner';
import { EXAM_BILINGUAL_TEXTS } from './ExamText';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  begin: vi.fn(),
  startExam: vi.fn(),
  heartbeat: vi.fn(),
  submit: vi.fn(),
  askTeacher: vi.fn(),
  invalidate: vi.fn(async () => {}),
  getUserMedia: vi.fn(),
  exit: vi.fn(),
  durationMs: 30_000,
}));

vi.mock('../../api/trpc', () => {
  // Stable, as trpc.useUtils() is: effects that depend on it must not restart every render.
  const utils = {
    client: {
      labs: {
        startExam: { mutate: (...args: unknown[]) => h.startExam(...args) },
        heartbeat: { mutate: (...args: unknown[]) => h.heartbeat(...args) },
        submit: { mutate: (...args: unknown[]) => h.submit(...args) },
      },
    },
    labs: { list: { invalidate: () => h.invalidate() } },
  };
  return {
    trpc: {
      useUtils: () => utils,
      labs: {
        begin: { useMutation: () => ({ mutateAsync: h.begin, data: undefined }) },
        askTeacher: { useMutation: () => ({ mutateAsync: h.askTeacher, isPending: false }) },
      },
    },
  };
});

const AUDIO = '/api/assets/examen-u3-a.mp3';

/** What labs.begin sends for an exam lab: no audio yet, no pauses, no rule. */
const session = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  title: 'Examen U3 · Escucha · Forma A',
  description: 'Unidad 3',
  audioUrl: null,
  durationMs: 30_000,
  requiredThroughMs: 29_000,
  minimumVoicedMs: 1000,
  startToken: 'tok-exam',
  pauses: null,
  minAnsweredPct: 0,
  voicePerPauseMs: 250,
  gateMarginDb: 6,
  needed: null,
  exam: 'U3',
  examPreview: false,
  ...overrides,
});

const started = (overrides: Record<string, unknown> = {}) => ({
  audioUrl: AUDIO, examSet: 'U3', startId: 7, startedAt: 1_790_000_000_000, preview: false, ...overrides,
});

/** A refusal as tRPC hands it to the page: the server's code on `data`. */
function refusal(appCode: string, message: string, code = 'CONFLICT') {
  return Object.assign(new Error(message), { data: { code, appCode } });
}

// --- the browser's media, as far as the page uses it ------------------------------------------

const media = new WeakMap<HTMLMediaElement, { timeMs: number; paused: boolean }>();
const stateOf = (el: HTMLMediaElement) => {
  let state = media.get(el);
  if (!state) {
    state = { timeMs: 0, paused: true };
    media.set(el, state);
  }
  return state;
};
let audioError: { code: number } | null = null;
const handlers = new Map<string, (() => void) | null>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  h.durationMs = 30_000;
  audioError = null;
  handlers.clear();
  h.begin.mockReset().mockResolvedValue(session());
  h.startExam.mockReset().mockResolvedValue(started());
  h.heartbeat.mockReset().mockResolvedValue({ recorded: true, nextInMs: 5000 });
  h.submit.mockReset().mockResolvedValue({
    success: true,
    result: { submissionId: 90, credit: true, status: 'done', scored: false, pausesAnswered: null, pausesCounted: null, needed: null, mic: 'off' },
  });
  h.askTeacher.mockReset();
  h.invalidate.mockClear();
  h.getUserMedia.mockReset();
  h.exit.mockReset();

  const proto = HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get(this: HTMLMediaElement) { return stateOf(this).timeMs / 1000; },
    set(this: HTMLMediaElement, seconds: number) { stateOf(this).timeMs = Math.round(seconds * 1000); },
  });
  Object.defineProperty(proto, 'paused', { configurable: true, get(this: HTMLMediaElement) { return stateOf(this).paused; } });
  Object.defineProperty(proto, 'duration', { configurable: true, get: () => h.durationMs / 1000 });
  Object.defineProperty(proto, 'ended', { configurable: true, get: () => false });
  Object.defineProperty(proto, 'seeking', { configurable: true, get: () => false });
  Object.defineProperty(proto, 'error', { configurable: true, get: () => audioError });
  proto.play = vi.fn(function (this: HTMLMediaElement) {
    stateOf(this).paused = false;
    return Promise.resolve();
  });
  proto.pause = vi.fn(function (this: HTMLMediaElement) {
    const state = stateOf(this);
    if (state.paused) return;
    state.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  // Reloading the file drops the position, as a browser does.
  proto.load = vi.fn(function (this: HTMLMediaElement) {
    stateOf(this).timeMs = 0;
    audioError = null;
  });

  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: h.getUserMedia } });
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      metadata: null,
      setActionHandler: (action: string, handler: (() => void) | null) => { handlers.set(action, handler); },
    },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- driving the page -------------------------------------------------------------------------

const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
const audio = () => document.querySelector('audio')!;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const dispatch = (type: string) => act(() => { audio().dispatchEvent(new Event(type)); });
const submitted = (call = 0) => h.submit.mock.calls[call][0] as Record<string, unknown>;

async function openTest(overrides: Record<string, unknown> = {}, onBusyChange?: (busy: boolean) => void) {
  h.begin.mockResolvedValue(session(overrides));
  render(<StrictMode><LabRunner labId={41} onExit={h.exit} onBusyChange={onBusyChange} /></StrictMode>);
  await advance(0);
}

/** "Start the test" (confirmed), and the server's start arrives. */
async function claim() {
  fireEvent.click(button('Start the test'));
  await advance(0);
}

/** Open, start, Play: the audio plays. */
async function playTest(overrides: Record<string, unknown> = {}) {
  await openTest(overrides);
  await claim();
  fireEvent.click(button('Play'));
  dispatch('playing');
}

/** Plays on in 50 ms steps of audio and of time. */
async function playTo(ms: number) {
  const el = audio();
  while (stateOf(el).timeMs < ms) {
    stateOf(el).timeMs = Math.min(ms, stateOf(el).timeMs + 50);
    dispatch('timeupdate');
    await advance(50);
  }
}

async function endTest() {
  stateOf(audio()).timeMs = h.durationMs;
  dispatch('ended');
  await advance(0);
}

/** None of the ways to hear it again, or to answer out loud, anywhere on the page. */
function expectNoPracticeControls() {
  for (const name of [/^Pause$/, /^Back \d+ s$/, 'Start over', 'Do it again', 'Turn on the microphone', "My mic doesn't work", 'Start the lab']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.queryByText(/out loud/)).toBeNull();
  expect(screen.queryByText(/microphone/i)).toBeNull();
}

// --- tests -------------------------------------------------------------------------------------

describe('LabRunner, a test: before it starts', () => {
  it('shows the rules in English with the Spanish under each, never asks for the microphone, and has no audio yet', async () => {
    await openTest();
    expect(h.begin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Examen U3 · Escucha · Forma A' })).toBeInTheDocument();
    expect(screen.getByText('Test · U3')).toBeInTheDocument();
    for (const [english, spanish] of [
      ['Headphones on.', 'Ponte los auriculares.'],
      ['Your answers go on your paper, not here.', 'Tus respuestas van en el papel, no aquí.'],
      ['The audio says the text twice. You hear it once, straight through: no pause, no going back.',
        'El audio dice el texto dos veces. Lo escuchas una vez, de principio a fin: sin pausa y sin volver atrás.'],
      ["Don't close or reload this page. You can start this test only once.",
        'No cierres ni recargues esta página. Solo puedes empezar este examen una vez.'],
    ]) {
      expect(screen.getByText(english)).toBeInTheDocument();
      expect(screen.getByText(spanish)).toHaveAttribute('lang', 'es');
    }
    expect(button('Start the test')).toBeEnabled();
    expectNoPracticeControls();
    expect(h.getUserMedia).not.toHaveBeenCalled();
    // Fail closed: no start, no audio.
    expect(audio()).not.toHaveAttribute('src');
    expect(h.startExam).not.toHaveBeenCalled();
  });

  it('every line it shows in both languages has its Spanish', () => {
    for (const text of EXAM_BILINGUAL_TEXTS) expect(MESSAGES.es[text], text).toBeTruthy();
  });

  it('asks first, then claims the start once, with this session, and only then takes the audio', async () => {
    let answer: (value: unknown) => void = () => {};
    h.startExam.mockReset().mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await openTest();
    fireEvent.click(button('Start the test'));
    expect(window.confirm).toHaveBeenCalledWith('Start Examen U3 · Escucha · Forma A? You can start one form of this test, once. Check that it is the form on your paper.');
    await advance(0);
    expect(h.startExam).toHaveBeenCalledTimes(1);
    expect(h.startExam.mock.calls[0][0]).toEqual({ labId: 41, startToken: 'tok-exam' });
    // Waiting for the server: no audio, and the button cannot be pressed twice.
    expect(button('Starting…')).toBeDisabled();
    expect(audio()).not.toHaveAttribute('src');
    fireEvent.click(button('Starting…'));
    expect(h.startExam).toHaveBeenCalledTimes(1);

    await act(async () => { answer(started()); });
    expect(audio()).toHaveAttribute('src', AUDIO);
    expect(screen.getByText('When you are ready, press Play. The audio plays once, straight through.')).toBeInTheDocument();
    expectNoPracticeControls();
    fireEvent.click(button('Play'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(stateOf(audio()).paused).toBe(false);
    expect(h.getUserMedia).not.toHaveBeenCalled();
  });

  it('does nothing when the student cancels the question', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await openTest();
    fireEvent.click(button('Start the test'));
    await advance(0);
    expect(h.startExam).not.toHaveBeenCalled();
    expect(button('Start the test')).toBeEnabled();
  });

  it('keeps the audio away when the start fails, and Try again sends the same session without asking again', async () => {
    h.startExam.mockReset().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(started());
    await openTest();
    await claim();
    expect(screen.getByRole('alert')).toHaveTextContent('The test could not start. Check your connection and try again.');
    expect(audio()).not.toHaveAttribute('src');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();

    fireEvent.click(button('Try again'));
    await advance(0);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(h.startExam).toHaveBeenCalledTimes(2);
    expect(h.startExam.mock.calls[1][0]).toEqual({ labId: 41, startToken: 'tok-exam' });
    expect(audio()).toHaveAttribute('src', AUDIO);
    expect(button('Play')).toBeInTheDocument();
  });

  it('gives up waiting for the server after 15 s, with no audio', async () => {
    h.startExam.mockReset().mockReturnValue(new Promise(() => {}));
    await openTest();
    await claim();
    await advance(14_000);
    expect(button('Starting…')).toBeDisabled();
    await advance(1_500);
    expect(screen.getByRole('alert')).toHaveTextContent('The test could not start.');
    expect(button('Try again')).toBeEnabled();
    expect(audio()).not.toHaveAttribute('src');
  });

  it('a used start is refused in both languages, with no retry', async () => {
    h.startExam.mockReset().mockRejectedValue(refusal('EXAM_USED', 'You already started this test. Ask your teacher.'));
    await openTest();
    await claim();
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('You already started this test. Ask your teacher.');
    expect(box).toHaveTextContent('Ya empezaste este examen. Pregúntale a tu profesor.');
    expect(screen.queryByRole('button', { name: /Start the test|Try again/ })).toBeNull();
    expect(audio()).not.toHaveAttribute('src');
  });

  it('a test the teacher changed since the page opened it asks for a reload', async () => {
    h.startExam.mockReset().mockRejectedValue(refusal('EXAM_CHANGED', 'This test was changed. Reload the page.', 'BAD_REQUEST'));
    await openTest();
    await claim();
    expect(screen.getByRole('alert')).toHaveTextContent('This test was changed. Reload the page.');
    expect(screen.getByRole('alert')).toHaveTextContent('Este examen cambió. Recarga la página.');
    expect(screen.queryByRole('button', { name: /Start the test|Try again/ })).toBeNull();
  });

  it('a reload, a second tab or another form after the start: opening it is refused in both languages', async () => {
    h.begin.mockReset().mockRejectedValue(refusal('EXAM_USED', 'You already started this test. Ask your teacher.'));
    render(<LabRunner labId={41} onExit={h.exit} />);
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent('You already started this test. Ask your teacher.');
    expect(screen.getByRole('alert')).toHaveTextContent('Ya empezaste este examen. Pregúntale a tu profesor.');
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    // Known to be a test by its refusal: back to the Tests page (never the click event as `test`).
    fireEvent.click(button('Back to tests'));
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(true);
  });

  it('a lab that fails to load for another reason goes back where it was opened from', async () => {
    h.begin.mockReset().mockRejectedValue(new Error('Lab not found'));
    render(<LabRunner labId={41} onExit={h.exit} />);
    await advance(0);
    fireEvent.click(button('Back to labs'));
    expect(h.exit).toHaveBeenCalledWith(false);
  });

  it('a practice lab left open for hours that became a test meanwhile asks for a reload, and never plays as a test', async () => {
    await openTest({ exam: null, examPreview: false, audioUrl: '/api/assets/practica.mp3' });
    // Hours later the teacher has made the lab a test; the page renews its session before the lab starts.
    h.begin.mockResolvedValue(session());
    await advance(6 * 60 * 60 * 1000 + 1);
    const opened = h.begin.mock.calls.length;
    fireEvent.click(button("My mic doesn't work"));
    await advance(0);
    expect(h.begin).toHaveBeenCalledTimes(opened + 1);
    expect(screen.getByRole('alert')).toHaveTextContent('This test was changed. Reload the page.');
    // Still the practice page, as it was: nothing of the test, and no Play.
    expect(button('Turn on the microphone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start the test|^Play$/ })).toBeNull();
    expect(audio()).toHaveAttribute('src', '/api/assets/practica.mp3');
    expect(h.heartbeat).not.toHaveBeenCalled();
  });

  it('the teacher’s preview says it is not limited or recorded', async () => {
    await openTest({ examPreview: true });
    expect(screen.getByText('Teacher preview: your starts are not limited or recorded.')).toBeInTheDocument();
    h.startExam.mockResolvedValue(started({ startId: null, preview: true }));
    await claim();
    expect(audio()).toHaveAttribute('src', AUDIO);
  });

  it('in Spanish, its badge says Examen, as every other line of the test does', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    try {
      render(<I18nProvider><LabRunner labId={41} onExit={() => {}} /></I18nProvider>);
      await advance(0);
      expect(screen.getByText('Examen · U3')).toBeInTheDocument();
      expect(screen.queryByText(/Prueba/)).toBeNull();
      expect(button('Empezar el examen')).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('guards leaving from "Start the test" on: while it waits for the server, and after it failed', async () => {
    let fail: (error: unknown) => void = () => {};
    h.startExam.mockReset().mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const busy = vi.fn();
    const exit = vi.fn();
    h.begin.mockResolvedValue(session());
    render(<LabRunner labId={41} onExit={exit} onBusyChange={busy} />);
    await advance(0);
    expect(busy).toHaveBeenLastCalledWith(false);

    fireEvent.click(button('Start the test'));
    await advance(0);
    // The start may reach the server: leaving now could cost it, and there is no way out on the page.
    expect(button('Starting…')).toBeDisabled();
    expect(busy).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Back to tests' })).toBeNull();

    // It failed here, but may have been recorded there: still guarded, and Back to tests asks first.
    await act(async () => { fail(new TypeError('Failed to fetch')); });
    expect(button('Try again')).toBeEnabled();
    expect(busy).toHaveBeenLastCalledWith(true);
    vi.mocked(window.confirm).mockClear().mockReturnValue(false);
    fireEvent.click(button('Back to tests'));
    expect(window.confirm).toHaveBeenCalledWith('Leave this test? You can start it only once.');
    expect(exit).not.toHaveBeenCalled();
    expect(button('Try again')).toBeInTheDocument();
  });

  it('guards leaving once the start is claimed: the start would be lost', async () => {
    const busy = vi.fn();
    await openTest({}, busy);
    expect(busy).toHaveBeenLastCalledWith(false);
    await claim();
    expect(busy).toHaveBeenLastCalledWith(true);
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(button('Back to tests'));
    expect(window.confirm).toHaveBeenLastCalledWith('Leave this test? You can start it only once.');
    expect(button('Play')).toBeInTheDocument();
    expect(h.exit).not.toHaveBeenCalled();
  });
});

describe('LabRunner, a test: playing straight through', () => {
  it('has no Pause, Back or Start over, only Finish once the end is heard', async () => {
    await playTest();
    expect(screen.getByText('Playing')).toBeInTheDocument();
    expectNoPracticeControls();
    expect(button('Finish')).toBeDisabled();
    await playTo(28_000);
    expect(button('Finish')).toBeEnabled();
  });

  it('a headset, the lock screen and the browser’s media keys cannot pause, stop or move it', async () => {
    await playTest();
    await playTo(5_000);
    for (const action of ['pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) {
      const handler = handlers.get(action);
      expect(handler, action).toBeTypeOf('function');
      act(() => handler!());
    }
    expect(stateOf(audio()).paused).toBe(false);
    expect(stateOf(audio()).timeMs).toBe(5_000);
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('key presses (arrows, j/k/l, Space, media keys) neither pause nor move it', async () => {
    await playTest();
    await playTo(5_000);
    for (const key of ['ArrowLeft', 'ArrowRight', 'j', 'k', 'l', ' ', 'MediaPlayPause', 'MediaTrackPrevious']) {
      fireEvent.keyDown(document.body, { key });
      fireEvent.keyUp(document.body, { key });
    }
    expect(stateOf(audio()).paused).toBe(false);
    expect(stateOf(audio()).timeMs).toBe(5_000);
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('plays on when the student leaves the page', async () => {
    await playTest();
    await playTo(5_000);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(stateOf(audio()).paused).toBe(false);
    expect(screen.getByText('Playing')).toBeInTheDocument();
    hidden.mockRestore();
  });

  it('puts any move, back or forward, back where it was', async () => {
    await playTest();
    await playTo(10_000);
    for (const target of [2_000, 25_000]) {
      stateOf(audio()).timeMs = target;
      dispatch('seeking');
      dispatch('seeked');
      expect(stateOf(audio()).timeMs).toBe(10_000);
      // The page's own seek back lands where it was, and is kept.
      dispatch('seeking');
      dispatch('seeked');
      expect(stateOf(audio()).timeMs).toBe(10_000);
    }
  });

  it('pauses itself when the connection is lost, and Resume carries on from the same place once it is back', async () => {
    await playTest();
    await playTo(12_000);
    h.heartbeat.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    // The first report that fails is the next tick's; 90 s after it, the test waits for the connection.
    await advance(100_000);
    expect(screen.getByText('Lost the connection. The lab is paused until it comes back.')).toBeInTheDocument();
    expect(stateOf(audio()).paused).toBe(true);
    expect(button('Resume')).toBeDisabled();
    expectNoPracticeControls();

    h.heartbeat.mockReset().mockResolvedValue({ recorded: true });
    await advance(5000);
    expect(screen.getByText('The connection is back. Press Resume to carry on.')).toBeInTheDocument();
    fireEvent.click(button('Resume'));
    expect(stateOf(audio()).paused).toBe(false);
    expect(stateOf(audio()).timeMs).toBe(12_000);
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });

  it('when something outside the page stops the audio, Resume carries on from where it stopped', async () => {
    await playTest();
    await playTo(8_000);
    act(() => { audio().pause(); });
    expect(screen.getByText('The audio stopped. Press Resume to carry on from where it stopped.')).toBeInTheDocument();
    fireEvent.click(button('Resume'));
    expect(stateOf(audio()).timeMs).toBe(8_000);
    expect(stateOf(audio()).paused).toBe(false);
  });

  it('after an audio error, Resume reloads the file and goes on from where it stopped, never from the start', async () => {
    await playTest();
    await playTo(9_000);
    audioError = { code: 2 };
    dispatch('error');
    expect(screen.getByText('The lab audio stopped loading. Check your connection and press Resume.')).toBeInTheDocument();
    fireEvent.click(button('Resume'));
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(stateOf(audio()).timeMs).toBe(9_000);
    // The browser drops it again while the file reloads; once the file knows its length, it is set back.
    stateOf(audio()).timeMs = 0;
    dispatch('loadedmetadata');
    expect(stateOf(audio()).timeMs).toBe(9_000);
  });

  it('a headset Play resumes only what stopped by itself', async () => {
    await playTest();
    await playTo(6_000);
    act(() => { audio().pause(); });
    act(() => handlers.get('play')!());
    expect(stateOf(audio()).paused).toBe(false);
    expect(stateOf(audio()).timeMs).toBe(6_000);
  });
});

describe('LabRunner, a test: turning it in', () => {
  it('turns in with no microphone, no voice and no pause results, and offers only Back to tests', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await playTest();
    await playTo(5_000);
    focus.mockReturnValue(false);
    await playTo(9_000);
    focus.mockReturnValue(true);
    await playTo(29_000);
    await endTest();

    expect(h.submit).toHaveBeenCalledTimes(1);
    const sent = submitted();
    expect(sent).toMatchObject({ labId: 41, startToken: 'tok-exam', mic: 'off', voicedMs: 0, pausedVoicedMs: 0, answers: [] });
    expect(sent).not.toHaveProperty('outsideVoicedMs');
    expect(sent).not.toHaveProperty('outsidePlayedMs');
    expect(sent.micStats).toMatchObject({
      ambientDbP50: null, gateDbP50: null, voiceOverGateDbP50: null, levelOnlyAnswered: null, micCheck: null, processing: null,
      loudNotVoiceInPausesMs: 0,
    });
    const { unfocusedPlayedMs } = sent.micStats as { unfocusedPlayedMs: number };
    expect(unfocusedPlayedMs).toBeGreaterThanOrEqual(3_800);
    expect(unfocusedPlayedMs).toBeLessThanOrEqual(4_200);
    // No microphone ever, and no tick ever carried a pause result.
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.heartbeat.mock.calls.every(([report]) => (report as { answers?: unknown }).answers === undefined)).toBe(true);

    expect(screen.getByText('Turned in. Your answers go on your paper.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Back to tests', 'Back to tests']);
    expectNoPracticeControls();
    expect(screen.queryByText(/You spoke for/)).toBeNull();

    // Once the guard's history entry is off (the browser's own Back, after the turn-in).
    fireEvent.click(screen.getAllByRole('button', { name: 'Back to tests' })[1]);
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(true));
  });

  it('when turning in fails, offers Try again and never Start over', async () => {
    h.submit.mockReset().mockRejectedValueOnce(new Error('Could not reach the server'));
    await playTest();
    await playTo(29_000);
    await endTest();
    expect(screen.getByText('Could not reach the server')).toBeInTheDocument();
    expect(button('Try again')).toBeInTheDocument();
    expectNoPracticeControls();
  });

  it('a session the server stopped accepting says to ask the teacher, with no Start over, and lets the student go back', async () => {
    const busy = vi.fn();
    await openTest({}, busy);
    await claim();
    fireEvent.click(button('Play'));
    dispatch('playing');
    await playTo(4_000);
    expect(busy).toHaveBeenLastCalledWith(true);
    h.heartbeat.mockReset().mockRejectedValue(refusal('', 'Lab not found', 'NOT_FOUND'));
    await playTo(10_000);
    await advance(0);
    expect(screen.getByText('This test can no longer be saved. Ask your teacher.')).toBeInTheDocument();
    expectNoPracticeControls();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    // Staying cannot help any more: no leave warning, and a way back to the tests.
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(button('Back to tests')).toBeEnabled();
    fireEvent.click(button('Back to tests'));
    await advance(0);
    expect(h.exit).toHaveBeenCalledWith(true);
  });
});

describe('LabRunner opened from the Tests page (v1.21.0)', () => {
  it('a lab that is practice by then says Back to tests, and tells the page it was not a test', async () => {
    h.begin.mockResolvedValue(session({ exam: null, examPreview: false, audioUrl: '/api/assets/practica.mp3' }));
    render(<LabRunner labId={41} fromTests onExit={h.exit} />);
    await advance(0);
    expect(button('Turn on the microphone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to labs' })).toBeNull();
    fireEvent.click(button('Back to tests'));
    await advance(0);
    expect(h.exit).toHaveBeenCalledWith(false);
  });

  it('a test says Back to tests either way', async () => {
    h.begin.mockResolvedValue(session());
    render(<LabRunner labId={41} fromTests onExit={h.exit} />);
    await advance(0);
    fireEvent.click(button('Back to tests'));
    await advance(0);
    expect(h.exit).toHaveBeenCalledWith(true);
  });
});
