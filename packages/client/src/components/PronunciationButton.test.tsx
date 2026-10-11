// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PronunciationButton from './PronunciationButton';
import { playAudio, getPlayingUrl, __resetAudioPlayerForTests } from '../utils/audioPlayer';

const generateMutateAsync = vi.fn();

vi.mock('../api/trpc', () => ({
  trpc: {
    ai: {
      getCardAssets: {
        useQuery: () => ({ data: null, refetch: vi.fn() }),
      },
      generatePronunciation: {
        useMutation: () => ({ mutateAsync: generateMutateAsync, isPending: false }),
      },
    },
  },
}));

vi.mock('../i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }));

const elements: FakeAudio[] = [];
class FakeAudio {
  preload = '';
  paused = true;
  playCalls = 0;
  private _src = '';
  constructor() { elements.push(this); }
  get src() { return this._src; }
  set src(v: string) { if (this._src !== v) this.paused = true; this._src = v; }
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  dispatch(type: string) { this.listeners.get(type)?.forEach((fn) => fn()); }
  removeAttribute() { this._src = ''; }
  load() { this.paused = true; }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

beforeEach(() => {
  elements.length = 0;
  generateMutateAsync.mockReset();
  __resetAudioPlayerForTests();
  vi.stubGlobal('Audio', FakeAudio);
});

const button = () => screen.getByTitle('Play pronunciation');

describe('PronunciationButton', () => {
  it('stays enabled after its clip finishes, ready for a replay', async () => {
    render(<PronunciationButton cardId={1} side="front" audioUrl="/a.opus" />);

    await act(async () => { button().click(); });
    expect(button()).toBeDisabled();

    // The shared player reports the clip ended.
    await act(async () => {
      elements.find((e) => e.playCalls > 0)!.dispatch('ended');
    });

    await waitFor(() => expect(button()).not.toBeDisabled());
  });

  it('is not left disabled when another clip supersedes it', async () => {
    render(<PronunciationButton cardId={1} side="front" audioUrl="/a.opus" />);

    await act(async () => { button().click(); });
    expect(button()).toBeDisabled();

    // Autoplay for the next card takes over the shared player.
    await act(async () => { playAudio('/next.opus'); });

    await waitFor(() => expect(button()).not.toBeDisabled());
  });

  it('keeps the playing state after generating audio on demand', async () => {
    generateMutateAsync.mockResolvedValue({ audioUrl: '/generated.opus' });
    render(<PronunciationButton cardId={1} side="front" />);

    await act(async () => { button().click(); });

    // The generated clip is the one playing, and the button reflects it rather
    // than being reset by its own emit.
    expect(getPlayingUrl()).toBe('/generated.opus');
    expect(button()).toBeDisabled();
  });

  it('stops its own clip on unmount so audio does not bleed into the next card', async () => {
    const { unmount } = render(<PronunciationButton cardId={1} side="front" audioUrl="/a.opus" />);

    await act(async () => { button().click(); });
    expect(getPlayingUrl()).toBe('/a.opus');

    unmount();

    expect(getPlayingUrl()).toBeNull();
  });

  it('does not cut off a newer clip when it unmounts', async () => {
    const { unmount } = render(<PronunciationButton cardId={1} side="front" audioUrl="/a.opus" />);
    await act(async () => { button().click(); });

    // Something newer starts, then this button goes away.
    await act(async () => { playAudio('/newer.opus'); });
    unmount();

    expect(getPlayingUrl()).toBe('/newer.opus');
  });
});
