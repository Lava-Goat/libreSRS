import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReview from './FlashcardReview';
import { CardDirection, State } from '@libresrs/shared';

// jsdom lacks ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const mockReviewResult = {
  nextReview: new Date(),
  newState: State.Review,
  state: {
    id: 10,
    stability: 1,
    difficulty: 2,
    reps: 1,
    lapses: 0,
    state: State.Review,
  },
  reviewLogId: 123,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

const mutateAsync = vi.fn().mockResolvedValue(mockReviewResult);
const undoMutateAsync = vi.fn().mockResolvedValue({
  state: mockReviewResult.state,
  nextReviewOptions: mockReviewResult.nextReviewOptions,
});

vi.mock('../api/trpc', () => ({
  trpc: {
    auth: {
      me: {
        useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
      },
      logout: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
    cards: {
      review: {
        useMutation: () => ({
          mutateAsync,
          isPending: false,
        }),
      },
      undoReview: {
        useMutation: () => ({
          mutateAsync: undoMutateAsync,
          isPending: false,
        }),
      },
    },
    ai: {
      getConfig: {
        useQuery: () => ({
          data: { pronunciation: true, image: false, mnemonic: false },
        }),
      },
      getCardAiState: {
        useQuery: () => ({ data: null }),
      },
      getCardAssets: {
        useQuery: () => ({
          data: {
            audioFront: { url: '/api/assets/front.opus' },
            audioBack: { url: '/api/assets/back.opus' },
            audio: null,
            image: null,
          },
          refetch: vi.fn(),
        }),
      },
      generateImage: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      generatePronunciation: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ audioUrl: '/api/assets/generated.opus' }),
          isPending: false,
        }),
      },
      removeImage: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      generateMnemonic: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      acceptMnemonic: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      rejectMnemonic: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteMnemonic: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      regenerateCardAssets: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
      },
    },
    settings: {
      get: {
        useQuery: () => ({ data: { autoPlayAudio: true, autoPlayAudioFront: true, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
      getDeckSettings: {
        useQuery: () => ({ data: { autoPlayAudio: true, autoPlayAudioFront: true, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
    },
  },
}));

const baseCard = {
  card: { id: 1, deckId: 1, front: 'Front 1', back: 'Back 1' },
  state: { id: 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};


// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Integration cover for the reported audio bugs: autoplay was untested (every
// other FlashcardReview test runs with autoPlayAudio false), and nothing proved
// that pressing play during autoplay does not start a SECOND element — which is
// what students heard as reverb.
import { __resetAudioPlayerForTests } from '../utils/audioPlayer';

const audioElements: FakeAudio[] = [];
class FakeAudio {
  preload = '';
  paused = true;
  playCalls = 0;
  private _src = '';
  constructor() { audioElements.push(this); }
  get src() { return this._src; }
  set src(v: string) { if (this._src !== v) this.paused = true; this._src = v; }
  addEventListener() {}
  removeAttribute() { this._src = ''; }
  load() { this.paused = true; }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

describe('FlashcardReview audio', () => {
  beforeEach(() => {
    audioElements.length = 0;
    __resetAudioPlayerForTests();
    vi.stubGlobal('Audio', FakeAudio);
  });

  /** Elements that actually produced sound (preload elements never play). */
  const played = () => audioElements.filter((a) => a.playCalls > 0);

  it('auto-plays the question side when the card appears', async () => {
    await act(async () => {
      render(<FlashcardReview cards={[baseCard]} onComplete={vi.fn()} onExit={vi.fn()} />);
    });

    await waitFor(() => expect(played()).toHaveLength(1));
    expect(played()[0].src).toBe('/api/assets/front.opus');
  });

  it('pressing play during autoplay does not start a second element (the reverb bug)', async () => {
    await act(async () => {
      render(<FlashcardReview cards={[baseCard]} onComplete={vi.fn()} onExit={vi.fn()} />);
    });
    await waitFor(() => expect(played()).toHaveLength(1));

    const playButton = screen.getAllByTitle(/play pronunciation/i)[0];
    await act(async () => {
      fireEvent.click(playButton);
    });

    // Still exactly one sounding element — the shared player reused it.
    expect(played()).toHaveLength(1);
    expect(played()[0].playCalls).toBeGreaterThanOrEqual(2);
  });
});
