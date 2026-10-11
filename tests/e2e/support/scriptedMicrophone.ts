// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A microphone the test speaks into, the same in every engine Playwright runs.
 *
 * getUserMedia is replaced before the page loads: it answers with a stream
 * from a small audio graph out of a MediaStreamAudioDestinationNode. The
 * page's own voice meter then hears exactly what the test decides, with no
 * browser fake device, no permission prompt and no system audio (WebKit on a
 * Mac, whose mock microphone goes through the system and can stop answering).
 *
 * What it can play, mixed:
 * - **a voice:** a 220 Hz tone, steady and pitched, which the page's meter
 *   (v1.16) counts as a voice when it stands out from the room;
 * - **taps:** short 180 Hz thumps dying in 8 ms, about every 150 ms (desk
 *   taps: loud, but never a voice);
 * - **noise:** a hiss (loud, never a voice);
 * - **babble:** eight synthetic talkers at once, class chatter that sits at
 *   the room's level (the old −45 dBFS meter took it for the student).
 *
 * The page's meter learns the room: a tone held for more than about 8 s
 * becomes the room's level and stops counting, just as a fan would. A voice
 * that must keep counting goes on and off (`setMicLevel(page, level,
 * { talking: true })`), and plans speak in spans.
 *
 * - `window.__mic(level, talking)` sets the base voice level, 0 (silence) to
 *   1; `talking` turns it on for 600 ms and off for 400 ms, over and over. It
 *   starts silent.
 * - `window.__micPlan = [[fromMs, toMs], ...]` makes a sound (the voice at the
 *   speaking level, unless `__micPlanSound` says 'taps' or 'noise') while the
 *   page's lab `<audio>` stands inside one of those spans, playing or paused.
 *   `null` turns it off.
 * - `window.__micBackground = { sound, level }` plays taps, noise or babble
 *   under everything, all the time; `null` stops it.
 * - `window.__micLose()` unplugs it: the page's 'ended' listeners on the last
 *   track handed out run, the way a browser runs them when a headset is pulled
 *   (Firefox does not deliver an 'ended' a script dispatches on a track).
 * - `window.__micOpened` counts getUserMedia calls.
 *
 * Each stream starts with 150 ms of silence, as a real microphone's does, so
 * the page's meter hears the room before anything the test plays. The levels
 * follow the test on a timer taken before any fake clock the test installs
 * (install this first), so page.clock cannot freeze the voice.
 */
import type { Page } from '@playwright/test';

/** Level while speaking: a sine at half scale, about −9 dBFS, far over any room the tests play. */
export const SPEAKING = 0.5;

/** What a plan span or the background plays besides the voice. */
export type MicSound = 'taps' | 'noise' | 'babble';

export interface ScriptedMicrophoneOptions {
  /** Base level before the test changes it (default 0, silence). */
  level?: number;
  /** Level inside the plan's spans (default SPEAKING). */
  speakingLevel?: number;
}

/** mulberry32, for the generators below: seeded, so every run hears the same sounds. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * The sound generators. They run inside the page (their source is copied
 * into the init script), so each one stands alone: no imports, nothing from
 * this module but what it is handed. Each returns a loopable buffer whose
 * level a gain sets: noise and babble have the RMS of a sine of amplitude 1,
 * so a level means the same loudness for the voice, the noise and the babble;
 * each tap peaks at 1.
 */

/** Desk taps: a 180 Hz thump dying in `decayMs` with a click of noise, about every `everyMs`. */
export function makeTaps(rate: number, seconds: number, random: () => number, everyMs = 150, decayMs = 8): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  const tau = decayMs / 1000;
  const length = Math.round(rate * tau * 6);
  for (let t = 0.02; t < seconds - tau * 6; t += (everyMs / 1000) * (0.85 + 0.3 * random())) {
    const at = Math.round(t * rate);
    const hz = 160 + 40 * random();
    for (let i = 0; i < length && at + i < out.length; i++) {
      const s = i / rate;
      out[at + i] += 0.6 * Math.sin(2 * Math.PI * hz * s) * Math.exp(-s / tau) + 0.4 * (random() * 2 - 1) * Math.exp(-s / (tau / 3));
    }
  }
  return out;
}

/** White noise: a hiss. */
export function makeNoise(rate: number, seconds: number, random: () => number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  // Uniform noise of RMS 1/√2, as a sine of amplitude 1.
  const amplitude = Math.sqrt(1.5);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * (random() * 2 - 1);
  return out;
}

/**
 * Class chatter: eight talkers, each saying syllables of 120–300 ms with
 * short gaps, at its own pitch and loudness. The sum is diffuse: its level
 * wanders a few dB and no one voice stands out, so the page's meter takes it
 * for the room.
 */
export function makeBabble(rate: number, seconds: number, random: () => number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  // One period of ten harmonics falling off as 1/h: a vowel.
  const table = new Float32Array(2048);
  for (let i = 0; i < table.length; i++) {
    for (let h = 1; h <= 10; h++) table[i] += Math.sin((2 * Math.PI * h * i) / table.length) / h;
  }
  const fade = Math.round(0.02 * rate);
  for (let talker = 0; talker < 8; talker++) {
    const f0 = 100 + 150 * random();
    const gain = 10 ** ((-3 * random()) / 20);
    let at = Math.round(random() * 0.3 * rate);
    while (at < out.length) {
      const length = Math.round((0.12 + 0.18 * random()) * rate);
      const hz = f0 * (0.9 + 0.2 * random());
      let phase = random();
      for (let i = 0; i < length && at + i < out.length; i++) {
        phase = (phase + hz / rate) % 1;
        out[at + i] += gain * Math.min(1, i / fade, (length - i) / fade) * table[Math.floor(phase * table.length)];
      }
      at += length + Math.round((0.03 + 0.12 * random()) * rate);
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
  const scale = Math.SQRT1_2 / (Math.sqrt(sum / out.length) || 1);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

type Generator = (rate: number, seconds: number, random: () => number) => Float32Array;

interface InstallOptions {
  level: number;
  speakingLevel: number;
}

/** Runs in the page, before its own scripts. */
function install(
  { level, speakingLevel }: InstallOptions,
  makeRandom: (seed: number) => () => number,
  generators: Record<'taps' | 'noise' | 'babble', Generator>,
) {
  if (window.top !== window) return;
  type Span = [number, number];
  type Sound = 'taps' | 'noise' | 'babble';
  const w = window as unknown as {
    __mic: (level: number, talking?: boolean) => void;
    __micPlan: Span[] | null;
    __micPlanSound: 'voice' | Sound;
    __micBackground: { sound: Sound; level: number } | null;
    __micLose: () => void;
    __micOpened: number;
    __micLevel: () => number;
    webkitAudioContext?: typeof AudioContext;
  };
  // Taken now, before page.clock can replace them: the sounds must keep following the audio under a fake clock.
  const realSetInterval = window.setInterval.bind(window);
  const realNow = performance.now.bind(performance);

  let base = level;
  let talking = false;
  let graph: { context: AudioContext; gains: Record<'voice' | Sound, GainNode>; out: GainNode } | null = null;
  const handedOut: MediaStreamTrack[] = [];
  /** A real microphone's stream starts silent for a moment; so does this one. */
  let silentUntil = 0;
  const endedListeners = new WeakMap<MediaStreamTrack, EventListenerOrEventListenerObject[]>();

  w.__mic = (next: number, talk = false) => { base = next; talking = talk; };
  w.__micPlan = null;
  w.__micPlanSound = 'voice';
  w.__micBackground = null;
  w.__micOpened = 0;

  const inPlan = (): boolean => {
    const plan = w.__micPlan;
    if (!plan || plan.length === 0) return false;
    const audio = document.querySelector('audio');
    if (!audio) return false;
    const ms = audio.currentTime * 1000;
    return plan.some(([from, to]) => ms >= from && ms < to);
  };

  /** The level of each sound now. */
  const levels = (): Record<'voice' | Sound, number> => {
    const now = { voice: 0, taps: 0, noise: 0, babble: 0 };
    if (realNow() < silentUntil) return now;
    // On for 600 ms, off for 400 ms: a voice that keeps talking never becomes the room.
    now.voice = talking && realNow() % 1000 >= 600 ? 0 : base;
    const background = w.__micBackground;
    if (background) now[background.sound] += background.level;
    if (inPlan()) {
      const sound = w.__micPlanSound;
      if (sound === 'voice') now.voice = speakingLevel;
      else now[sound] += speakingLevel;
    }
    return now;
  };
  w.__micLevel = () => levels().voice;

  const ensureGraph = () => {
    if (graph) return graph;
    const Context = window.AudioContext ?? w.webkitAudioContext!;
    const context = new Context();
    const out = context.createGain();
    const gains = {} as Record<'voice' | Sound, GainNode>;
    const start = levels();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 220;
    gains.voice = context.createGain();
    gains.voice.gain.value = start.voice;
    oscillator.connect(gains.voice).connect(out);
    oscillator.start();
    (['taps', 'noise', 'babble'] as const).forEach((sound, i) => {
      // Built once, in the context's own rate, and looped: 8 s of each.
      const samples = generators[sound](context.sampleRate, 8, makeRandom(11 + i));
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      gains[sound] = context.createGain();
      gains[sound].gain.value = start[sound];
      source.connect(gains[sound]).connect(out);
      source.start();
    });
    graph = { context, gains, out };
    return graph;
  };

  realSetInterval(() => {
    if (!graph) return;
    if (graph.context.state === 'suspended') void graph.context.resume().catch(() => {});
    const now = levels();
    for (const sound of ['voice', 'taps', 'noise', 'babble'] as const) graph.gains[sound].gain.value = now[sound];
  }, 10);
  // Any gesture may start an audio context that the browser left suspended.
  for (const type of ['pointerdown', 'click', 'keydown']) {
    window.addEventListener(type, () => { if (graph?.context.state === 'suspended') void graph.context.resume().catch(() => {}); }, true);
  }

  // The page's 'ended' listeners on our tracks, so __micLose can run them as a browser would.
  const proto = MediaStreamTrack.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: MediaStreamTrack, type: string, listener: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    if (type === 'ended' && listener && handedOut.includes(this)) endedListeners.set(this, [...(endedListeners.get(this) ?? []), listener]);
    add.call(this, type, listener as EventListenerOrEventListenerObject, opts);
  };
  proto.removeEventListener = function (this: MediaStreamTrack, type: string, listener: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    if (type === 'ended' && listener) endedListeners.set(this, (endedListeners.get(this) ?? []).filter((l) => l !== listener));
    remove.call(this, type, listener as EventListenerOrEventListenerObject, opts);
  };
  w.__micLose = () => {
    const track = handedOut[handedOut.length - 1];
    if (!track) throw new Error('No microphone was opened');
    const event = new Event('ended');
    for (const listener of endedListeners.get(track) ?? []) {
      if (typeof listener === 'function') listener.call(track, event);
      else listener.handleEvent(event);
    }
  };

  // On the prototype: WebKit gives the page another navigator.mediaDevices than the one this script sees.
  MediaDevices.prototype.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
    if (!constraints?.audio) throw new DOMException('The scripted microphone has no camera', 'NotFoundError');
    const { context, gains, out } = ensureGraph();
    void context.resume().catch(() => {});
    silentUntil = realNow() + 150;
    for (const gain of Object.values(gains)) gain.gain.value = 0;
    const destination = context.createMediaStreamDestination();
    out.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    handedOut.push(track);
    w.__micOpened += 1;
    return destination.stream;
  };
}

/** Before the page loads: every getUserMedia gets the scripted microphone. */
export async function scriptedMicrophone(page: Page, options: ScriptedMicrophoneOptions = {}): Promise<void> {
  const settings: InstallOptions = { level: options.level ?? 0, speakingLevel: options.speakingLevel ?? SPEAKING };
  // The generators' own source goes in with the installer: the page cannot import them.
  await page.addInitScript({
    content: `(${install.toString()})(${JSON.stringify(settings)}, ${seeded.toString()}, {
      taps: ${makeTaps.toString()},
      noise: ${makeNoise.toString()},
      babble: ${makeBabble.toString()},
    });`,
  });
}

/**
 * Sets the base voice level (0 silence, SPEAKING for a voice). With
 * `talking`, the voice goes on and off (600 ms on, 400 ms off), as speech
 * does: a tone held for more than about 8 s becomes the room's level on the
 * page and stops counting.
 */
export async function setMicLevel(page: Page, level: number, options: { talking?: boolean } = {}): Promise<void> {
  await page.evaluate(([l, talking]) => (window as unknown as { __mic: (level: number, talking: boolean) => void }).__mic(l, talking), [level, options.talking ?? false] as const);
}

/**
 * Makes a sound while the lab audio is inside these spans (ms): the voice at
 * the speaking level, or taps or noise at that level; null stops.
 */
export async function setMicPlan(page: Page, plan: [number, number][] | null, options: { sound?: 'voice' | 'taps' | 'noise' } = {}): Promise<void> {
  await page.evaluate(([p, sound]) => {
    const w = window as unknown as { __micPlan: [number, number][] | null; __micPlanSound: string };
    w.__micPlan = p;
    w.__micPlanSound = sound;
  }, [plan, options.sound ?? 'voice'] as const);
}

/** Plays taps, noise or babble under everything, all the time (the room); null stops it. */
export async function setMicBackground(page: Page, sound: MicSound | null, level = 0): Promise<void> {
  await page.evaluate(([s, l]) => {
    (window as unknown as { __micBackground: { sound: string; level: number } | null }).__micBackground = s ? { sound: s, level: l } : null;
  }, [sound, level] as const);
}

/** A level (0 to 1) for a sound this many dBFS RMS: the voice, the noise and the babble alike. */
export const micLevelForDb = (db: number) => Math.SQRT2 * 10 ** (db / 20);

/** Unplugs the microphone: the page hears its track end. */
export async function loseMicrophone(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __micLose: () => void }).__micLose());
}

/**
 * Remembers, before the page loads, each time one of these texts appears on
 * the page, with where the lab audio was. A nudge can be up for a second:
 * polling from the test could miss it, a MutationObserver cannot.
 */
export async function watchTexts(page: Page, texts: string[]): Promise<void> {
  await page.addInitScript((watched) => {
    if (window.top !== window) return;
    const w = window as unknown as { __seen: { text: string; atMs: number }[] };
    w.__seen = [];
    const showing = new Set<string>();
    const check = () => {
      const body = document.body?.textContent ?? '';
      for (const text of watched) {
        const now = body.includes(text);
        if (now && !showing.has(text)) {
          const audio = document.querySelector('audio');
          w.__seen.push({ text, atMs: Math.round((audio?.currentTime ?? 0) * 1000) });
        }
        if (now) showing.add(text);
        else showing.delete(text);
      }
    };
    const start = () => {
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
      check();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }, texts);
}

/** The watched texts that appeared, in order, with the audio position at the time. */
export async function seenTexts(page: Page): Promise<{ text: string; atMs: number }[]> {
  return page.evaluate(() => (window as unknown as { __seen: { text: string; atMs: number }[] }).__seen);
}
