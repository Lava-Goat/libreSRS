// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * One audio element for the whole app, plus a persistent preload pool.
 *
 * Flashcard review used to create a fresh `new Audio()` for autoplay while
 * PronunciationButton created its own for manual presses. Two elements playing
 * the same clip a few hundred milliseconds apart is what students heard as
 * "reverb". Routing every play through a single element makes overlap
 * structurally impossible: assigning `src` stops whatever was playing.
 *
 * This mirrors the pattern that already works in the Vocabulómetro runner.
 */

type PlayerState = { url: string | null; playing: boolean };
type Listener = (state: PlayerState) => void;

let player: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let playToken = 0;
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot: PlayerState = { url: currentUrl, playing: currentUrl !== null };
  for (const listener of listeners) listener(snapshot);
}

function getPlayer(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    const clear = () => {
      currentUrl = null;
      emit();
    };
    player.addEventListener('ended', clear);
    player.addEventListener('error', clear);
  }
  return player;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlayingUrl(): string | null {
  return currentUrl;
}

export interface PlayHandle {
  /** Resolves true once playback actually started. */
  started: Promise<boolean>;
  /** Stops playback, but only if this handle is still the active one. */
  stop(): void;
}

/**
 * Play `url`, stopping anything already playing. Callers hold a handle whose
 * `stop()` is a no-op once a newer play has superseded it — so a late effect
 * cleanup can never kill audio it did not start.
 */
export function playAudio(url: string): PlayHandle {
  const el = getPlayer();
  const token = ++playToken;
  currentUrl = url;
  emit();

  el.src = url;
  const result = el.play() as Promise<void> | undefined;

  const started: Promise<boolean> = result && typeof result.then === 'function'
    ? result.then(
      () => token === playToken,
      (err: unknown) => {
        // A newer play() aborting this one is expected, not a failure.
        if (token !== playToken) return false;
        currentUrl = null;
        emit();
        const name = err instanceof Error ? err.name : '';
        if (name !== 'AbortError') {
          console.warn('[audio] playback failed', err);
        }
        return false;
      },
    )
    // Browsers where HTMLMediaElement.play() returns undefined.
    : Promise.resolve(true);

  return {
    started,
    stop() {
      if (token !== playToken) return;
      playToken++;
      player?.pause();
      currentUrl = null;
      emit();
    },
  };
}

/** Stop playback unconditionally (leaving a session, unmounting a screen). */
export function stopAudio(): void {
  playToken++;
  player?.pause();
  currentUrl = null;
  emit();
}

const PRELOAD_CAP = 8;
const preloadPool = new Map<string, HTMLAudioElement>();

/**
 * Warm the media pipeline for `urls`, keeping elements alive across calls.
 *
 * The previous implementation rebuilt its whole preload set whenever any
 * dependency changed and cleared `src` on teardown — aborting the very
 * downloads it had just started, including the clip for the card that was
 * about to become current. Entries here are only evicted once they fall out of
 * the most recent PRELOAD_CAP urls.
 */
export function preloadAudio(urls: readonly string[]): void {
  for (const url of urls) {
    if (!url) continue;
    const existing = preloadPool.get(url);
    if (existing) {
      // Refresh LRU position without touching the in-flight load.
      preloadPool.delete(url);
      preloadPool.set(url, existing);
      continue;
    }
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    preloadPool.set(url, el);
  }

  while (preloadPool.size > PRELOAD_CAP) {
    const oldest = preloadPool.keys().next();
    if (oldest.done) break;
    const evicted = preloadPool.get(oldest.value);
    if (evicted) {
      // Removing the src attribute alone does NOT run the media load algorithm
      // (it runs only when src is set or changed), so the buffered resource
      // would stay alive. pause + remove + load() is the teardown that frees it.
      evicted.pause();
      evicted.removeAttribute('src');
      evicted.load();
    }
    preloadPool.delete(oldest.value);
  }
}

/** Test hook: drop all module state. */
export function __resetAudioPlayerForTests(): void {
  playToken++;
  player = null;
  currentUrl = null;
  listeners.clear();
  preloadPool.clear();
}

/** Test hook: inspect the preload pool. */
export function __preloadedUrlsForTests(): string[] {
  return [...preloadPool.keys()];
}
