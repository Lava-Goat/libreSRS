// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  playAudio, stopAudio, preloadAudio, getPlayingUrl, subscribe,
  __resetAudioPlayerForTests, __preloadedUrlsForTests,
} from './audioPlayer';

/** Every element ever constructed, so a test can prove how many are playing. */
const constructed: FakeAudio[] = [];

class FakeAudio {
  preload = '';
  paused = true;
  loadCalls = 0;
  private _src = '';

  /** Real elements restart loading when src changes, which pauses playback AND
   *  rejects any still-pending play() promise with AbortError. */
  get src() { return this._src; }
  set src(value: string) {
    if (this._src !== value) {
      this.paused = true;
      const pending = this.pendingPlayReject;
      if (pending) {
        this.pendingPlayReject = null;
        const err = new Error('interrupted by a new load request');
        err.name = 'AbortError';
        pending(err);
      }
    }
    this._src = value;
  }
  private pendingPlayReject: ((e: Error) => void) | null = null;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();
  private rejectNextPlay: string | null = null;

  constructor() { constructed.push(this); }

  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeAttribute(name: string) { if (name === 'src') this._src = ''; }
  load() { this.loadCalls++; this.paused = true; }
  dispatch(type: string) { this.listeners.get(type)?.forEach((fn) => fn()); }
  failNextPlayWith(name: string) { this.rejectNextPlay = name; }

  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    if (this.rejectNextPlay) {
      const err = new Error('blocked');
      err.name = this.rejectNextPlay;
      this.rejectNextPlay = null;
      this.paused = true;
      return Promise.reject(err);
    }
    // Stays pending like a real element until playback starts or a new load
    // aborts it, so the supersede path is genuinely exercised.
    return new Promise<void>((resolve, reject) => {
      this.pendingPlayReject = reject;
      queueMicrotask(() => {
        if (this.pendingPlayReject === reject) {
          this.pendingPlayReject = null;
          resolve();
        }
      });
    });
  }
  pause() { this.paused = true; }
}

beforeEach(() => {
  constructed.length = 0;
  __resetAudioPlayerForTests();
  vi.stubGlobal('Audio', FakeAudio);
});

/** The element the module plays through (preload elements are separate). */
function playerElement(): FakeAudio {
  const playing = constructed.filter((a) => a.playCalls > 0);
  return playing[0];
}

describe('audioPlayer — single element', () => {
  it('never has two elements playing the same clip (the reverb bug)', async () => {
    // Autoplay starts a clip, then the student presses play on the same clip.
    playAudio('/api/assets/hola.opus');
    playAudio('/api/assets/hola.opus');
    await Promise.resolve();

    const playedThrough = constructed.filter((a) => a.playCalls > 0);
    expect(playedThrough).toHaveLength(1);
    expect(playedThrough[0].playCalls).toBe(2);
    expect(playedThrough[0].paused).toBe(false);
  });

  it('starting a new clip stops the previous one', async () => {
    playAudio('/a.opus');
    playAudio('/b.opus');
    await Promise.resolve();

    expect(getPlayingUrl()).toBe('/b.opus');
    expect(playerElement().src).toBe('/b.opus');
  });

  it('a superseded handle cannot stop the newer clip', async () => {
    const first = playAudio('/a.opus');
    playAudio('/b.opus');

    first.stop(); // late effect cleanup from the previous card

    expect(getPlayingUrl()).toBe('/b.opus');
    expect(playerElement().paused).toBe(false);
  });

  it('its own handle does stop playback', () => {
    const handle = playAudio('/a.opus');
    handle.stop();
    expect(getPlayingUrl()).toBeNull();
    expect(playerElement().paused).toBe(true);
  });

  it('reports not-started and clears state when the browser blocks autoplay', async () => {
    const probe = playAudio('/warm.opus');
    await probe.started;
    const el = playerElement();
    el.failNextPlayWith('NotAllowedError');

    const started = await playAudio('/blocked.opus').started;

    expect(started).toBe(false);
    expect(getPlayingUrl()).toBeNull();
  });

  it('treats an AbortError from a superseding play as expected, not an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const probe = playAudio('/warm.opus');
    await probe.started;
    playerElement().failNextPlayWith('AbortError');

    await playAudio('/next.opus').started;

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('notifies subscribers when a clip ends so buttons can reset', async () => {
    const seen: (string | null)[] = [];
    subscribe(({ url }) => seen.push(url));

    playAudio('/a.opus');
    playerElement().dispatch('ended');

    expect(seen).toEqual(['/a.opus', null]);
    expect(getPlayingUrl()).toBeNull();
  });

  it('stopAudio halts playback outright', () => {
    playAudio('/a.opus');
    stopAudio();
    expect(getPlayingUrl()).toBeNull();
    expect(playerElement().paused).toBe(true);
  });
});

describe('audioPlayer — preload pool', () => {
  it('keeps in-flight downloads alive across repeated calls (the prefetch bug)', () => {
    preloadAudio(['/1.opus', '/2.opus']);
    const firstElements = [...constructed];

    // A background refetch re-runs the effect with the same urls.
    preloadAudio(['/1.opus', '/2.opus']);

    // No new elements, and nothing had its src cleared mid-download.
    expect(constructed).toHaveLength(firstElements.length);
    expect(constructed.every((a) => a.src !== '')).toBe(true);
    expect(__preloadedUrlsForTests()).toEqual(['/1.opus', '/2.opus']);
  });

  it('keeps a clip warm when the queue advances past it', () => {
    preloadAudio(['/next1.opus', '/next2.opus']);
    // Queue advances: next1 is now the current card, next3 appears.
    preloadAudio(['/next2.opus', '/next3.opus']);

    // next1 must still be cached — it is the clip about to be played.
    expect(__preloadedUrlsForTests()).toContain('/next1.opus');
    expect(constructed.find((a) => a.src === '/next1.opus')!.src).toBe('/next1.opus');
  });

  it('actually releases an evicted element (removing src alone does not)', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `/c${i}.opus`);
    preloadAudio(urls);

    // c0/c1 fell out of the cap; the media resource must be torn down, which
    // per spec requires load() — clearing the attribute by itself does not.
    const evicted = constructed.filter((a) => a.src === '');
    expect(evicted.length).toBeGreaterThan(0);
    expect(evicted.every((a) => a.loadCalls > 0)).toBe(true);
  });

  it('evicts only beyond the cap, oldest first', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `/c${i}.opus`);
    preloadAudio(urls);

    const pooled = __preloadedUrlsForTests();
    expect(pooled).toHaveLength(8);
    expect(pooled).not.toContain('/c0.opus');
    expect(pooled).toContain('/c9.opus');
  });
});
