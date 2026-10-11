// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabRunner from './LabRunner';
import { PauseTracker } from '../../utils/pauseTracker';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  begin: vi.fn(),
  heartbeat: vi.fn(),
  submit: vi.fn(),
  askTeacher: vi.fn(),
  invalidate: vi.fn(async () => {}),
  /** The microphone's level (RMS): 0.1 is −20 dBFS, 0 digital silence. */
  level: 0,
  /** What it hears at that level: a voice (a pitched tone) or noise (a hiss, a fan: sound, but not a voice). */
  kind: 'voice' as 'voice' | 'noise',
  /** The room under it: noise at this RMS, all the time. */
  room: 0,
  durationMs: 30_000,
}));

vi.mock('../../api/trpc', () => {
  // Stable, as trpc.useUtils() is: effects that depend on it must not restart every render.
  const utils = {
    client: {
      labs: {
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

const VOICE = 0.1;
/** The page's room level and gate in a digitally silent room: the gate's floor. */
const SILENT_ROOM_GATE_DB = -55;

type Pause = [number, number];
const session = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  title: 'Semana 1',
  description: null,
  audioUrl: '/api/assets/lab.mp3',
  durationMs: 30_000,
  requiredThroughMs: 29_000,
  minimumVoicedMs: 1000,
  startToken: 'tok-1',
  pauses: [[10_000, 14_000], [20_000, 24_000]] as Pause[] | null,
  minAnsweredPct: 75,
  voicePerPauseMs: 250,
  gateMarginDb: 6,
  needed: 2 as number | null,
  ...overrides,
});

const result = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  result: {
    submissionId: 77,
    credit: true,
    status: 'done',
    scored: true,
    pausesAnswered: 2,
    pausesCounted: 2,
    needed: 2,
    mic: 'on',
    ...overrides,
  },
});

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
const trackEndings: (() => void)[] = [];
const track = {
  addEventListener: (type: string, listener: () => void) => { if (type === 'ended') trackEndings.push(listener); },
  stop: () => {},
  // What the browser reports it applies; the page must keep only the processing, never the device.
  getSettings: () => ({ deviceId: 'mic-1234', groupId: 'g', echoCancellation: true, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000 }),
};

/** A 200 Hz tone (a voice) or seeded noise, at RMS h.level, over the room's noise at RMS h.room. */
let noiseSeed = 1;
const nextNoise = () => {
  noiseSeed = (noiseSeed * 1103515245 + 12345) % 2147483648;
  return Math.sqrt(3) * ((noiseSeed / 2147483648) * 2 - 1);
};
function hear(samples: Float32Array) {
  for (let i = 0; i < samples.length; i++) {
    const sound = h.kind === 'voice' ? h.level * Math.SQRT2 * Math.sin((2 * Math.PI * 200 * i) / FakeAudioContext.rate) : h.level * nextNoise();
    samples[i] = sound + (h.room > 0 ? h.room * nextNoise() : 0);
  }
  return samples;
}

class FakeAudioContext {
  /** The rate the page's audio runs at: Chrome takes it from the output device, not from the microphone. */
  static rate = 48_000;
  /** Every analyser the page made, to see how it sized them. */
  static analysers: { fftSize: number }[] = [];
  destination = {};
  sampleRate = FakeAudioContext.rate;
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createAnalyser() {
    const analyser = { fftSize: 2048, getFloatTimeDomainData: hear, connect: (node: unknown) => node };
    FakeAudioContext.analysers.push(analyser);
    return analyser;
  }
  createGain() { return { gain: { value: 1 }, connect: (node: unknown) => node }; }
  createMediaStreamSource() { return { connect: (node: unknown) => node }; }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  h.level = 0;
  h.kind = 'voice';
  h.room = 0;
  h.durationMs = 30_000;
  FakeAudioContext.rate = 48_000;
  FakeAudioContext.analysers.length = 0;
  h.begin.mockReset().mockResolvedValue(session());
  h.heartbeat.mockReset().mockResolvedValue({ recorded: true, nextInMs: 5000 });
  h.submit.mockReset().mockResolvedValue(result());
  h.askTeacher.mockReset().mockResolvedValue({ status: 'check' });
  h.invalidate.mockClear();
  trackEndings.length = 0;

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
  Object.defineProperty(proto, 'error', { configurable: true, get: () => null });
  proto.play = function (this: HTMLMediaElement) {
    stateOf(this).paused = false;
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    const state = stateOf(this);
    if (state.paused) return;
    state.paused = true;
    this.dispatchEvent(new Event('pause'));
  };
  proto.load = () => {};

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
  });
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
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

async function openLab(overrides: Record<string, unknown> = {}) {
  h.begin.mockResolvedValue(session(overrides));
  render(<StrictMode><LabRunner labId={5} onExit={() => {}} /></StrictMode>);
  await advance(0);
}

/** "Turn on the microphone", and the meter hears the (silent) room for a moment before anyone speaks. */
async function turnOnMic() {
  fireEvent.click(button('Turn on the microphone'));
  await advance(300);
}

/** "Hola" for 0.6 s; then the meter decides its last frames (it decides 0.2 s behind). */
async function sayHola() {
  h.level = VOICE;
  await advance(600);
  h.level = 0;
  await advance(250);
}

/** Microphone on, "hola", Start, and the audio begins to play. */
async function startLab(overrides: Record<string, unknown> = {}) {
  await openLab(overrides);
  await turnOnMic();
  await sayHola();
  fireEvent.click(button('Start the lab'));
  dispatch('playing');
}

/**
 * Plays on in 50 ms steps of audio and of time, the microphone hearing a
 * voice where `voiced` says. The voice meter decides each frame 4 frames
 * (200 ms) later, so the pause tracker, the tally and the nudges run 200 ms
 * behind the audio.
 */
async function playTo(ms: number, voiced: (positionMs: number) => boolean = () => false) {
  const el = audio();
  while (stateOf(el).timeMs < ms) {
    const next = Math.min(ms, stateOf(el).timeMs + 50);
    stateOf(el).timeMs = next;
    h.level = voiced(next) ? VOICE : 0;
    dispatch('timeupdate');
    await advance(50);
  }
  h.level = 0;
}
const between = (from: number, to: number) => (p: number) => p >= from && p < to;

async function endLab() {
  stateOf(audio()).timeMs = h.durationMs;
  dispatch('ended');
  await advance(0);
}

type Report = { kind: string; positionMs: number; clientMs: number; answers?: [number, number][] };
const marks = () => [...document.querySelectorAll('[data-pause-mark]')].map((el) => el.getAttribute('data-pause-mark'));
const reports = (): Report[] => h.heartbeat.mock.calls.map(([input]) => input as Report);
const submitted = (call = 0) => h.submit.mock.calls[call][0] as Record<string, unknown>;

// --- tests -------------------------------------------------------------------------------------

describe('LabRunner: opening a lab', () => {
  it('opens exactly one session, as the current page (client 3), even when React mounts it twice', async () => {
    await openLab();
    expect(h.begin).toHaveBeenCalledTimes(1);
    expect(h.begin).toHaveBeenCalledWith({ labId: 5, client: 3 });
    expect(button('Turn on the microphone')).toBeEnabled();
  });

  it('shows the server’s reason when the lab cannot be opened (an old page is told to reload)', async () => {
    h.begin.mockReset().mockRejectedValue(new Error('libreSRS was updated. Reload this page to do the lab.'));
    render(<LabRunner labId={5} onExit={() => {}} />);
    await advance(0);
    expect(screen.getByText('libreSRS was updated. Reload this page to do the lab.')).toBeInTheDocument();
  });

  it('tells a scored lab’s student that the microphone checks each pause, and how many must be answered', async () => {
    await openLab();
    expect(screen.getByText(/The microphone checks for your voice in each pause; nothing is recorded\./)).toBeInTheDocument();
    expect(screen.getByText('Answer out loud in at least 2 of the 2 pauses for this lab to count.')).toBeInTheDocument();
  });

  it('with the rule off, does not ask for a share of the pauses', async () => {
    await openLab({ minAnsweredPct: 0, needed: 0 });
    expect(screen.getByText(/checks for your voice in each pause/)).toBeInTheDocument();
    expect(screen.queryByText(/for this lab to count/)).toBeNull();
  });

  it('keeps the old text for a lab with no pause list', async () => {
    await openLab({ pauses: null, needed: null });
    expect(screen.getByText(/The microphone counts how long you speak; nothing is recorded\./)).toBeInTheDocument();
    expect(screen.queryByText(/for this lab to count/)).toBeNull();
  });
});

describe('LabRunner: the microphone check before Start', () => {
  it('keeps Start off until it hears half a second of voice', async () => {
    await openLab();
    await turnOnMic();
    expect(screen.getByText('Say “hola”. “Start the lab” turns on once we hear you.')).toBeInTheDocument();
    await advance(2000);
    expect(button('Start the lab')).toBeDisabled();

    h.level = VOICE;
    await advance(300);
    expect(button('Start the lab')).toBeDisabled();
    // Half a second heard; the meter decides it 0.2 s later.
    await advance(300);
    expect(button('Start the lab')).toBeDisabled();
    await advance(250);
    expect(button('Start the lab')).toBeEnabled();
    expect(screen.getByText('We hear you. You can start.')).toBeInTheDocument();
  });

  it('never takes noise for a voice; a second of loud sound still turns Start on, asking the student to speak up', async () => {
    await openLab();
    await turnOnMic();
    h.kind = 'noise';
    h.level = VOICE;
    await advance(900);
    expect(button('Start the lab')).toBeDisabled();
    await advance(400);
    expect(button('Start the lab')).toBeEnabled();
    expect(screen.getByText('We hear the room more than you. Speak up, or move closer to the microphone.')).toBeInTheDocument();
    expect(screen.queryByText('We hear you. You can start.')).toBeNull();

    // A voice after all, louder than that noise: the usual line.
    h.kind = 'voice';
    h.level = 0.5;
    await advance(800);
    expect(screen.getByText('We hear you. You can start.')).toBeInTheDocument();
  });

  it('judges a voice against the room with the margin the session began with', async () => {
    // A room at −40 dBFS and a voice about 9 dB over it: enough with the usual 6 dB, not with 12.
    for (const [gateMarginDb, line] of [[6, 'We hear you. You can start.'], [12, 'We hear the room more than you. Speak up, or move closer to the microphone.']] as const) {
      h.room = 0.01;
      await openLab({ gateMarginDb });
      await turnOnMic();
      await advance(2500);
      h.level = 0.028;
      await advance(1500);
      expect(screen.getByText(line)).toBeInTheDocument();
      h.level = 0;
      cleanup();
    }
  });

  it('shows the level a voice must reach as a tick on the level bar, and greens the bar on a voice', async () => {
    await openLab();
    await turnOnMic();
    const tick = document.querySelector<HTMLElement>('[data-gate-tick]');
    // −55 dBFS on the bar's −60 to −10 scale.
    expect(tick?.style.left).toBe(`${Math.round(((SILENT_ROOM_GATE_DB + 60) / 50) * 100)}%`);
    expect(document.querySelector('.bg-green-500')).toBeNull();
    h.level = VOICE;
    await advance(600);
    expect(document.querySelector('.bg-green-500')).not.toBeNull();
  });

  it('"My mic doesn\'t work" plays the lab without one, and turns it in with mic off', async () => {
    await openLab({ minAnsweredPct: 0, needed: 0 });
    fireEvent.click(button("My mic doesn't work"));
    await advance(0);
    expect(window.confirm).toHaveBeenCalledWith('Do the lab without a microphone? Your teacher will see that you did.');
    expect(screen.getByText('No microphone. The lab will play without it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "My mic doesn't work" })).toBeNull();

    fireEvent.click(button('Start the lab'));
    dispatch('playing');
    expect(screen.queryByText(/Pauses answered/)).toBeNull();
    await endLab();
    expect(submitted()).toMatchObject({ mic: 'off' });
    // The server's log is told before the audio starts, once: no pause result can follow it.
    const kinds = reports().map((r) => r.kind);
    expect(kinds.filter((k) => k === 'nomic')).toHaveLength(1);
    expect(kinds.indexOf('nomic')).toBeLessThan(kinds.indexOf('play'));
    expect(reports().find((r) => r.kind === 'nomic')).toMatchObject({ positionMs: 0 });
    expect(reports().filter((r) => r.answers)).toEqual([]);
  });

  it('warns that a lab without a microphone waits for the teacher when the rule is on, and says so at the end', async () => {
    h.submit.mockResolvedValue(result({ credit: false, status: 'check', mic: 'off', pausesAnswered: 0 }));
    await openLab();
    await turnOnMic();
    fireEvent.click(button("My mic doesn't work"));
    await advance(0);
    expect(window.confirm).toHaveBeenCalledWith("Do the lab without a microphone? It won't count until your teacher checks it.");
    fireEvent.click(button('Start the lab'));
    dispatch('playing');
    await endLab();
    expect(submitted()).toMatchObject({ mic: 'off' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Turned in without a microphone. Your teacher will check it.');
    expect(status).toHaveTextContent('If your microphone works again, you can do the lab again instead of waiting.');
    // The microphone never stopped mid-lab: nothing about before it stopped.
    expect(status).not.toHaveTextContent(/before the microphone stopped|It needs/);
    expect(button('Do it again')).toBeInTheDocument();
  });

  it('asking and then declining leaves the microphone check in place', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await openLab();
    await turnOnMic();
    fireEvent.click(button("My mic doesn't work"));
    await advance(0);
    expect(button('Start the lab')).toBeDisabled();
    expect(screen.queryByText('No microphone. The lab will play without it.')).toBeNull();
  });
});

describe('LabRunner: speaking in the pauses', () => {
  it('nudges in a silent pause, marks it missed, and sends its result on the next tick', async () => {
    await startLab();
    await playTo(12_400);
    expect(screen.queryByText("We can't hear you. Answer out loud.")).toBeNull();
    await playTo(12_600);
    expect(screen.getByText("We can't hear you. Answer out loud.")).toBeInTheDocument();
    expect(screen.getByText('Pauses answered: 0 of the 2 needed · 2 pauses left')).toBeInTheDocument();

    await playTo(14_200);
    expect(screen.getByText('Missed that pause. Answer out loud in the next one.')).toBeInTheDocument();
    expect(screen.getByText('Pauses answered: 0 of the 2 needed · 1 pause left')).toBeInTheDocument();
    // Both pauses are needed and one is gone.
    expect(screen.getByText("This lab can't count now. You can start over.")).toBeInTheDocument();
    // Results ride on ticks, never a request of their own.
    expect(reports().filter((r) => r.answers)).toEqual([]);

    await playTo(15_200);
    const withAnswers = reports().filter((r) => r.answers);
    expect(withAnswers).toHaveLength(1);
    expect(withAnswers[0]).toMatchObject({ kind: 'tick', answers: [[10_000, 0]] });
    expect(withAnswers[0].positionMs).toBeGreaterThanOrEqual(13_900);

    await playTo(22_000, between(21_000, 21_400));
    expect(screen.getByText('Heard you.')).toBeInTheDocument();
    await playTo(24_200);
    // None left to play: the banner says the rest.
    expect(screen.getByText('Pauses answered: 1 of the 2 needed')).toBeInTheDocument();
    expect(marks()).toEqual(['missed', 'answered']);
  });

  it('once enough pauses are answered, says the lab should count, and to keep answering', async () => {
    await startLab();
    await playTo(14_200, between(11_000, 11_500));
    expect(screen.getByText('Pauses answered: 1 of the 2 needed · 1 pause left')).toBeInTheDocument();
    await playTo(24_200, between(21_000, 21_500));
    const line = screen.getByText('Pauses answered: 2 · That should be enough for the lab to count. Keep answering to the end.');
    expect(line).toHaveClass('text-green-700');
    expect(screen.queryByText(/of the 2 needed/)).toBeNull();
  });

  it('with the rule off, shows the tally without a needed count and never says it cannot count', async () => {
    await startLab({ minAnsweredPct: 0, needed: 0 });
    await playTo(14_200);
    expect(screen.getByText('Pauses answered: 0 of 1')).toBeInTheDocument();
    expect(screen.queryByText(/can't count now/)).toBeNull();
    expect(screen.queryByText(/should be enough/)).toBeNull();
  });

  it('says "sound, but not a voice" when taps or noise fill a pause, and does not count it', async () => {
    await startLab();
    await playTo(10_500);
    h.kind = 'noise';
    await playTo(12_600, () => true);
    expect(screen.getByText('We hear sound, but not a voice. Answer out loud.')).toBeInTheDocument();
    expect(screen.queryByText("We can't hear you. Answer out loud.")).toBeNull();
    await playTo(14_200, () => true);
    expect(marks()).toEqual(['missed', 'ahead']);
  });

  it('keeps the old speaking count on a lab with no pause list', async () => {
    await startLab({ pauses: null, needed: null });
    await playTo(3_000, between(1_000, 2_000));
    expect(screen.getByText('You have spoken for 0:01.')).toBeInTheDocument();
    expect(screen.queryByText(/Pauses answered/)).toBeNull();
    expect(document.querySelectorAll('[data-pause-mark]')).toHaveLength(0);
  });

  it('Back 10 s first reports where playback reached, carrying the pause just finished, then jumps', async () => {
    await startLab();
    await playTo(14_500, between(11_000, 11_500));
    const before = reports().length;
    fireEvent.click(button('Back 10 s'));
    const sent = reports().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'tick', positionMs: 14_500, answers: [[10_000, 500]] });
    expect(audio().currentTime).toBe(4.5);
  });

  it('Back 10 s finishes a pause playback has passed since the last microphone sample, and sends it before the jump', async () => {
    await startLab();
    await playTo(13_900, between(11_000, 11_400));
    // The audio moved past the window's end; the meter has not sampled it yet.
    stateOf(audio()).timeMs = 13_950;
    const before = reports().length;
    fireEvent.click(button('Back 10 s'));
    expect(reports().slice(before)).toEqual([
      expect.objectContaining({ kind: 'tick', positionMs: 13_950, answers: [[10_000, 400]] }),
    ]);
  });

  it('a seek it did not start (a console `audio.currentTime = …`) first sends the results it holds, from where it last sampled', async () => {
    await startLab();
    await playTo(14_500, between(11_000, 11_500));
    // The first pause is finished; its result waits for the tick at 15 s. The console sends the audio back 3 s.
    const before = reports().length;
    stateOf(audio()).timeMs = 11_500;
    dispatch('seeking');
    dispatch('seeked');
    // Reports go one at a time: let the first get its answer.
    await advance(0);
    // Its own playback: on a tick where the tracker last sampled, not where the seek landed. Then the seek.
    expect(reports().slice(before)).toEqual([
      expect.objectContaining({ kind: 'tick', positionMs: 14_500, answers: [[10_000, 500]] }),
      expect.objectContaining({ kind: 'seek', positionMs: 11_500 }),
    ]);
    expect(reports().slice(before)[1].answers).toBeUndefined();

    // With nothing waiting, a seek is only a seek.
    await playTo(12_000);
    const again = reports().length;
    stateOf(audio()).timeMs = 11_000;
    dispatch('seeking');
    dispatch('seeked');
    await advance(0);
    expect(reports().slice(again).map((r) => r.kind)).toEqual(['seek']);
  });

  it('holds a tick while the audio position reads stale (just after a freeze), and sends it once caught up, or after 1.25 s', async () => {
    const suspect = vi.spyOn(PauseTracker.prototype, 'positionSuspect').mockReturnValue(false);
    await startLab();
    await playTo(4_900);
    const before = reports().length;
    const ticks = () => reports().slice(before).filter((r) => r.kind === 'tick');

    // The tick falls due at 5 s while the position reads stale: it waits.
    suspect.mockReturnValue(true);
    await playTo(5_400);
    expect(ticks()).toEqual([]);
    // Caught up: it goes, with where the audio really is.
    suspect.mockReturnValue(false);
    await playTo(5_600);
    expect(ticks()).toHaveLength(1);
    expect(ticks()[0].positionMs).toBeGreaterThan(5_000);

    // A reading that never looks right does not hold the log up for long.
    suspect.mockReturnValue(true);
    await playTo(11_300);
    expect(ticks()).toHaveLength(2);
    expect(ticks()[1].positionMs).toBeGreaterThanOrEqual(11_000);
  });

  it('never puts results on a play report: they wait for the next tick', async () => {
    await startLab();
    await playTo(14_100, between(11_000, 11_300));
    // Buffering, then playing again: a 'play' report while a result waits.
    dispatch('waiting');
    dispatch('playing');
    const play = reports().filter((r) => r.kind === 'play');
    expect(play).toHaveLength(2);
    expect(play.every((r) => r.answers === undefined)).toBe(true);
    await playTo(15_200);
    expect(reports().filter((r) => r.answers)).toEqual([
      expect.objectContaining({ kind: 'tick', answers: [[10_000, 300]] }),
    ]);
  });

  it('pauses itself when its reports have not reached the server for 90 s, and lets the student resume once they do', async () => {
    h.heartbeat.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    await startLab();
    await advance(85_000);
    expect(button('Pause')).toBeInTheDocument();
    await advance(10_000);
    expect(screen.getByText('Lost the connection. The lab is paused until it comes back.')).toBeInTheDocument();
    expect(button('Resume')).toBeDisabled();

    h.heartbeat.mockReset().mockResolvedValue({ recorded: true });
    await advance(5000);
    expect(screen.getByText('The connection is back. Press Resume to carry on.')).toBeInTheDocument();
    expect(button('Resume')).toBeEnabled();
    fireEvent.click(button('Resume'));
    expect(button('Pause')).toBeInTheDocument();
  });

  it('can go on without a microphone that disconnected, and turns the lab in with mic off', async () => {
    await startLab();
    act(() => trackEndings.forEach((ended) => ended()));
    expect(button('Turn the microphone back on')).toBeInTheDocument();
    fireEvent.click(button('Go on without the microphone'));
    expect(window.confirm).toHaveBeenCalledWith("Go on without the microphone? You answered 0 of the 2 pauses needed, so the lab won't count until your teacher checks it.");
    expect(screen.getByText('No microphone from here on. Press Resume to carry on.')).toBeInTheDocument();
    fireEvent.click(button('Resume'));
    expect(button('Pause')).toBeInTheDocument();
    await endLab();
    expect(submitted()).toMatchObject({ mic: 'off' });
  });
});

describe('LabRunner: the microphone stops mid-lab', () => {
  /** Answers the first pause, plays on to 15 s, loses the microphone and goes on without it. */
  async function loseMicAfterFirstPause(overrides: Record<string, unknown> = {}) {
    await startLab(overrides);
    await playTo(15_000, between(11_000, 11_500));
    act(() => trackEndings.forEach((ended) => ended()));
    fireEvent.click(button('Go on without the microphone'));
    fireEvent.click(button('Resume'));
  }

  it('says what the pauses answered before it stopped are worth, marks the pauses after it unheard, and offers a redo at the end', async () => {
    h.submit.mockResolvedValue(result({ credit: false, status: 'check', mic: 'off', pausesAnswered: 1, pausesCounted: 2, needed: 2 }));
    await loseMicAfterFirstPause();
    expect(window.confirm).toHaveBeenCalledWith("Go on without the microphone? You answered 1 of the 2 pauses needed, so the lab won't count until your teacher checks it.");
    expect(screen.getByText('Pauses answered before the microphone stopped: 1 of the 2 needed. Your teacher will check this lab.')).toBeInTheDocument();
    expect(screen.queryByText(/Pauses answered: /)).toBeNull();

    // Not yet played: still ahead. Played with no microphone: unheard.
    await playTo(19_000);
    expect(marks()).toEqual(['answered', 'ahead']);
    await playTo(24_200);
    expect(marks()).toEqual(['answered', 'unheard']);

    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You answered 1 of 2 pauses before the microphone stopped.');
    expect(status).toHaveTextContent('It needs 2 to count.');
    expect(status).toHaveTextContent('Turned in without a microphone. Your teacher will check it.');
    expect(status).toHaveTextContent('If your microphone works again, you can do the lab again instead of waiting.');
    expect(status).not.toHaveTextContent('Do it again.');
    // Waiting for the teacher is the main way on; a redo the second.
    expect(screen.getAllByRole('button', { name: 'Back to labs' }).at(-1)).toHaveClass('bg-blue-600');
    expect(button('Do it again')).not.toHaveClass('bg-blue-600');
    fireEvent.click(button('Do it again'));
    await advance(0);
    expect(h.begin).toHaveBeenCalledTimes(2);
    expect(button('Turn on the microphone')).toBeInTheDocument();
    expect(screen.queryByText(/before the microphone stopped/)).toBeNull();
  });

  it('with enough pauses answered before it stopped, says the lab should still count, and shows the credit', async () => {
    h.submit.mockResolvedValue(result({ credit: true, status: 'done', mic: 'off', pausesAnswered: 1, pausesCounted: 2, needed: 1 }));
    await loseMicAfterFirstPause({ minAnsweredPct: 50, needed: 1 });
    expect(window.confirm).toHaveBeenCalledWith('Go on without the microphone? You already answered 1 pause. That should be enough for the lab to count.');
    expect(screen.getByText('Pauses answered before the microphone stopped: 1. That should be enough for the lab to count.')).toBeInTheDocument();
    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You answered 1 of 2 pauses before the microphone stopped.');
    expect(status).toHaveTextContent('Turned in. Your teacher will see that you finished it.');
    expect(status).not.toHaveTextContent('Your teacher will check it.');
    expect(screen.queryByRole('button', { name: 'Do it again' })).toBeNull();
  });

  it('says "pauses" when more than one was answered before it stopped', async () => {
    await startLab();
    await playTo(24_200, (p) => between(11_000, 11_500)(p) || between(21_000, 21_500)(p));
    act(() => trackEndings.forEach((ended) => ended()));
    fireEvent.click(button('Go on without the microphone'));
    expect(window.confirm).toHaveBeenLastCalledWith('Go on without the microphone? You already answered 2 pauses. That should be enough for the lab to count.');
  });

  it('with a rule that needs a single pause and none answered yet, says "the 1 pause needed"', async () => {
    await startLab({ minAnsweredPct: 50, needed: 1 });
    act(() => trackEndings.forEach((ended) => ended()));
    fireEvent.click(button('Go on without the microphone'));
    expect(window.confirm).toHaveBeenLastCalledWith("Go on without the microphone? You answered 0 of the 1 pause needed, so the lab won't count until your teacher checks it.");
  });

  it('with the rule off, only says the teacher will see it, and tallies what was heard', async () => {
    h.submit.mockResolvedValue(result({ credit: true, status: 'done', mic: 'off', pausesAnswered: 1, pausesCounted: 2, needed: 0 }));
    await loseMicAfterFirstPause({ minAnsweredPct: 0, needed: 0 });
    expect(window.confirm).toHaveBeenCalledWith('Go on without the microphone? Your teacher will see that you did.');
    expect(screen.getByText('Pauses answered before the microphone stopped: 1 of 1')).toBeInTheDocument();
  });

  it('a pause answered just before the loss still counts: the meter’s last frames are decided when it stops', async () => {
    await startLab();
    // The answer ends a moment before the window does, and the microphone goes as the window ends.
    await playTo(13_950, between(13_500, 13_900));
    act(() => trackEndings.forEach((ended) => ended()));
    fireEvent.click(button('Go on without the microphone'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('You answered 1 of the 2 pauses needed'));
  });

  it('tells the server where it went on without one, with the last result it has, and sends no result after that', async () => {
    await startLab();
    // The microphone goes inside the first window, just after the answer: that pass is dropped. The second
    // pause is still ahead.
    await playTo(13_000, between(11_000, 11_500));
    act(() => trackEndings.forEach((ended) => ended()));
    await advance(0);
    const before = reports().length;
    fireEvent.click(button('Go on without the microphone'));
    await advance(0);
    const mark = reports().slice(before).find((r) => r.kind === 'nomic');
    expect(mark).toMatchObject({ positionMs: 13_000 });
    expect(mark?.answers).toBeUndefined();

    fireEvent.click(button('Resume'));
    dispatch('playing');
    await playTo(26_000);
    await endLab();
    const after = reports().slice(reports().indexOf(mark!) + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((r) => r.answers)).toEqual([]);
    expect(submitted()).toMatchObject({ mic: 'off', answers: [] });
  });

  it('a result the meter decided as the microphone went is sent before the mark, never after it', async () => {
    await startLab();
    await playTo(13_950, between(13_500, 13_900));
    act(() => trackEndings.forEach((ended) => ended()));
    await advance(0);
    // The pause report as the lab stopped itself took it, or the mark does: either way before the mark.
    fireEvent.click(button('Go on without the microphone'));
    await advance(0);
    const all = reports();
    const markAt = all.findIndex((r) => r.kind === 'nomic');
    expect(markAt).toBeGreaterThanOrEqual(0);
    expect(all.slice(0, markAt + 1).flatMap((r) => r.answers ?? [])).toEqual([[10_000, expect.any(Number)]]);
  });

  it('a lab held with enough answered before the microphone stopped: the teacher checks it, and no redo is offered', async () => {
    h.submit.mockResolvedValue(result({ credit: false, status: 'check', mic: 'off', pausesAnswered: 1, pausesCounted: 2, needed: 1 }));
    await loseMicAfterFirstPause({ minAnsweredPct: 50, needed: 1 });
    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You answered 1 of 2 pauses before the microphone stopped.');
    expect(status).toHaveTextContent('Your teacher will check it.');
    expect(status).not.toHaveTextContent('It needs');
    expect(status).not.toHaveTextContent('If your microphone works again');
    expect(screen.queryByRole('button', { name: 'Do it again' })).toBeNull();
  });
});

describe('LabRunner: turning it in', () => {
  it('sends the voice heard while paused apart from the voice heard while playing: an answer given while paused', async () => {
    await startLab();
    await playTo(11_000);
    fireEvent.click(button('Pause'));
    h.level = VOICE;
    await advance(1200);
    h.level = 0;
    await advance(300);
    fireEvent.click(button('Resume'));
    dispatch('playing');
    await playTo(15_000);
    await endLab();
    const sent = submitted();
    expect(sent.pausedVoicedMs).toBeGreaterThanOrEqual(900);
    expect(sent.pausedVoicedMs).toBeLessThanOrEqual(1500);
    // Voice while playing is its own count ("while playing" on the teacher's review): the answer is not in it.
    expect(sent.voicedMs).toBeLessThan(300);
    // And the pause it answered counts.
    expect(sent.answers).toEqual([]);
    expect(reports().flatMap((r) => r.answers ?? [])).toContainEqual([10_000, expect.any(Number)]);
    const [, value] = reports().flatMap((r) => r.answers ?? []).find(([start]) => start === 10_000)!;
    expect(value).toBeGreaterThanOrEqual(900);
  });

  it('carries the pause results, the unsent reports whole and the outside counts, and resends the same set on Try again', async () => {
    h.durationMs = 8000;
    h.heartbeat.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    h.submit.mockReset()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(result({ pausesAnswered: 1, pausesCounted: 1, needed: 1 }));
    await openLab({ durationMs: 8000, requiredThroughMs: 7000, pauses: [[1_000, 4_000]], needed: 1 });
    await turnOnMic();
    await sayHola();
    fireEvent.click(button('Start the lab'));
    // The audio takes 3 s to start, so the first tick lands before the pause.
    await advance(3000);
    dispatch('playing');
    await playTo(5_600, between(2_000, 2_500));
    fireEvent.click(button('Finish'));
    await advance(0);

    expect(h.submit).toHaveBeenCalledTimes(1);
    const first = submitted(0);
    expect(first).toMatchObject({ mic: 'on', answers: [[1_000, 500]], outsideVoicedMs: 0 });
    expect(first.reports).toEqual([
      { kind: 'play', positionMs: 0, clientMs: expect.any(Number) },
      { kind: 'tick', positionMs: 2_000, clientMs: expect.any(Number) },
    ]);
    expect(first.outsidePlayedMs).toBeGreaterThanOrEqual(2_900);
    expect(first.outsidePlayedMs).toBeLessThanOrEqual(3_000);

    fireEvent.click(button('Try again'));
    await advance(0);
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(submitted(1).answers).toEqual(first.answers);
    expect(submitted(1).reports).toEqual(first.reports);
    expect(screen.getByRole('status')).toHaveTextContent('You answered 1 of 1 pauses.');
  });

  it('shows the server’s count when the lab counted', async () => {
    await startLab();
    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You answered 2 of 2 pauses.');
    expect(status).toHaveTextContent('Turned in. Your teacher will see that you finished it.');
  });

  it('asks for a redo when too few pauses were answered, and "The mic didn\'t hear me" sends it to the teacher', async () => {
    h.submit.mockResolvedValue(result({ credit: false, status: 'redo', pausesAnswered: 0 }));
    await startLab();
    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You answered 0 of 2 pauses.');
    expect(status).toHaveTextContent('It needs 2 to count. Do it again.');
    expect(status).toHaveTextContent('Did you answer out loud? Press “The mic didn\'t hear me” and your teacher will check it.');
    expect(screen.queryByText(/Turned in\. Your teacher will see/)).toBeNull();

    fireEvent.click(button("The mic didn't hear me"));
    await advance(0);
    expect(h.askTeacher).toHaveBeenCalledWith({ submissionId: 77 });
    expect(screen.getByRole('status')).toHaveTextContent('Your teacher will check it.');
    expect(screen.queryByRole('button', { name: "The mic didn't hear me" })).toBeNull();
  });

  it('"Do it again" opens a new session', async () => {
    h.submit.mockResolvedValue(result({ credit: false, status: 'redo', pausesAnswered: 0 }));
    await startLab();
    await endLab();
    fireEvent.click(button('Do it again'));
    await advance(0);
    expect(h.begin).toHaveBeenCalledTimes(2);
    expect(h.begin).toHaveBeenLastCalledWith({ labId: 5, client: 3 });
    expect(button('Turn on the microphone')).toBeInTheDocument();
  });

  it('keeps the old end screen for a lab with no pause list', async () => {
    h.submit.mockResolvedValue(result({ scored: false, pausesAnswered: null, pausesCounted: null, needed: null }));
    await startLab({ pauses: null, needed: null });
    await endLab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You spoke for about 0:00.');
    expect(status).toHaveTextContent('We heard very little speaking.');
    expect(status).toHaveTextContent('Turned in. Your teacher will see that you finished it.');
    expect(status).not.toHaveTextContent(/You answered/);
  });
});

describe('LabRunner: the meter’s stats for the teacher (micStats)', () => {
  it('sends the room level, the gate, the old meter’s count, the check and the browser’s processing, and nothing of the device', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await startLab();
    // A voice in the first pause; in the second, noise the old −45 dBFS meter would have taken for an answer.
    await playTo(14_200, between(11_000, 11_500));
    h.kind = 'noise';
    await playTo(24_200, between(21_000, 22_000));
    await endLab();
    const stats = submitted().micStats as Record<string, unknown>;
    expect(stats).toEqual({
      meter: 2,
      // The fake room is digital silence: the lowest level kept, and the gate at its floor.
      ambientDbP50: -120,
      gateDbP50: SILENT_ROOM_GATE_DB,
      voiceOverGateDbP50: 35,
      levelOnlyAnswered: 2,
      loudNotVoiceInPausesMs: 1000,
      unfocusedPlayedMs: 0,
      micCheck: 'voice',
      processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000 },
    });
    expect(JSON.stringify(submitted())).not.toContain('mic-1234');
  });

  it.each([
    [44_100, 4096],
    [16_000, 2048],
    [192_000, 16_384],
  ])('at a %i Hz context, sizes the analyser to two 42.7 ms frames (%i samples), hears the voice, and reports the context’s rate', async (rate, size) => {
    // The microphone says 48 kHz (the fake track's settings); the meter runs at the context's rate.
    FakeAudioContext.rate = rate;
    await startLab();
    await playTo(14_200, between(11_000, 11_500));
    expect(marks()).toEqual(['answered', 'ahead']);
    await endLab();
    expect(FakeAudioContext.analysers.length).toBeGreaterThan(0);
    for (const analyser of FakeAudioContext.analysers) expect(analyser.fftSize).toBe(size);
    expect(submitted().micStats).toMatchObject({ micCheck: 'voice', processing: { sampleRate: rate } });
    expect(submitted().voicedMs).toBe(500);
  });

  it('counts the time the lab played while the page did not have focus (split screen)', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await startLab();
    await playTo(5_000);
    focus.mockReturnValue(false);
    await playTo(9_000);
    focus.mockReturnValue(true);
    await playTo(12_000);
    await endLab();
    const { unfocusedPlayedMs } = submitted().micStats as { unfocusedPlayedMs: number };
    expect(unfocusedPlayedMs).toBeGreaterThanOrEqual(3_800);
    expect(unfocusedPlayedMs).toBeLessThanOrEqual(4_200);
  });

  it('says the check passed on the room’s level only', async () => {
    await openLab();
    await turnOnMic();
    h.kind = 'noise';
    h.level = VOICE;
    await advance(1300);
    h.level = 0;
    fireEvent.click(button('Start the lab'));
    dispatch('playing');
    await endLab();
    expect(submitted().micStats).toMatchObject({ micCheck: 'level' });
  });

  it('without a microphone from the start, sends no levels and no old-meter count', async () => {
    await openLab();
    fireEvent.click(button("My mic doesn't work"));
    await advance(0);
    fireEvent.click(button('Start the lab'));
    dispatch('playing');
    await endLab();
    expect(submitted().micStats).toMatchObject({
      meter: 2, ambientDbP50: null, gateDbP50: null, voiceOverGateDbP50: null, levelOnlyAnswered: null, micCheck: null, processing: null,
    });
  });

  it('a lab with no pause list has no old-meter count', async () => {
    await startLab({ pauses: null, needed: null });
    await playTo(3_000, between(1_000, 2_000));
    await endLab();
    expect(submitted().micStats).toMatchObject({ levelOnlyAnswered: null, micCheck: 'voice' });
    expect(submitted().voicedMs).toBe(1000);
  });
});

