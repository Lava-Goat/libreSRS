import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReview from './FlashcardReview';
import { CardDirection, State } from '@libresrs/shared';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const mockReviewResult = {
  nextReview: new Date(),
  newState: State.Review,
  state: { id: 10, stability: 1, difficulty: 2, reps: 1, lapses: 0, state: State.Review },
  reviewLogId: 123,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

const mutateAsync = vi.fn().mockResolvedValue(mockReviewResult);

vi.mock('../api/trpc', () => ({
  trpc: {
      useUtils: () => ({
        ai: { getCardAiState: { setData: vi.fn(), invalidate: vi.fn(async () => {}) } },
      }),
    auth: {
      me: { useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }) },
      logout: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    cards: {
      review: { useMutation: () => ({ mutateAsync, isPending: false }) },
      undoReview: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    ai: {
      getConfig: {
        useQuery: () => ({ data: { pronunciation: true, image: false, mnemonic: false } }),
      },
      getCardAiState: { useQuery: () => ({ data: null }) },
      getCardAssets: {
        useQuery: (input: { cardId: number }) => ({
          // Per-card urls, like the real API.
          data: input.cardId
            ? {
              audioFront: { url: `/api/assets/front${input.cardId}.opus` },
              audioBack: { url: `/api/assets/back${input.cardId}.opus` },
              audio: null,
              image: null,
            }
            : undefined,
          refetch: vi.fn(),
        }),
      },
      generatePronunciation: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      generateImage: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      removeImage: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      generateMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      acceptMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      rejectMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      deleteMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      regenerateCardAssets: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
      },
    },
    settings: {
      // Front autoplay ON, back autoplay OFF — the teacher's setting.
      get: {
        useQuery: () => ({ data: { autoPlayAudio: false, autoPlayAudioFront: true, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
      getDeckSettings: {
        useQuery: () => ({ data: { autoPlayAudio: false, autoPlayAudioFront: true, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
    },
  },
}));

import { __resetAudioPlayerForTests } from '../utils/audioPlayer';

const audioElements: FakeAudio[] = [];
class FakeAudio {
  preload = '';
  paused = true;
  playCalls = 0;
  private _src = '';
  private listeners = new Map<string, Set<() => void>>();
  constructor() { audioElements.push(this); }
  get src() { return this._src; }
  set src(v: string) { if (this._src !== v) this.paused = true; this._src = v; }
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

const card = (id: number) => ({
  card: { id, deckId: 1, front: `Front ${id}`, back: `Back ${id}` },
  state: { id: 10 + id, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
});

describe('stuck disabled button repro', () => {
  beforeEach(() => {
    audioElements.length = 0;
    __resetAudioPlayerForTests();
    vi.stubGlobal('Audio', FakeAudio);
  });

  const played = () => audioElements.filter((a) => a.playCalls > 0);

  it('question button on the NEXT card is disabled although never clicked', async () => {
    await act(async () => {
      render(<FlashcardReview cards={[card(1), card(2)]} onComplete={vi.fn()} onExit={vi.fn()} />);
    });

    // 1. Autoplay of card 1 question side.
    await waitFor(() => expect(played()).toHaveLength(1));
    expect(played()[0].src).toBe('/api/assets/front1.opus');

    // 2. Student presses the speaker button on the question.
    const btn = () => screen.getAllByTitle(/play pronunciation/i)[0];
    expect(btn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(btn()); });
    expect(btn()).toBeDisabled();

    // 3. Flip (Space), then rate Good — clip is still playing (no `ended`).
    await act(async () => { fireEvent.keyDown(window, { code: 'Space' }); });
    await waitFor(() => screen.getByText('Back 1'));
    await act(async () => { fireEvent.click(screen.getByText(/^Good$/)); });

    // 4. Card 2 is now showing, and autoplay started its clip.
    await waitFor(() => screen.getByText('Front 2'));
    await waitFor(() => expect(played()[0].src).toBe('/api/assets/front2.opus'));

    // Does card 2's speaker button work?
    // eslint-disable-next-line no-console
    console.log('card2 question button disabled =', (btn() as HTMLButtonElement).disabled);
    expect(btn()).not.toBeDisabled();
  });

  it('recovers once the current clip ends', async () => {
    await act(async () => {
      render(<FlashcardReview cards={[card(1), card(2)]} onComplete={vi.fn()} onExit={vi.fn()} />);
    });
    await waitFor(() => expect(played()).toHaveLength(1));
    const btn = () => screen.getAllByTitle(/play pronunciation/i)[0];
    await act(async () => { fireEvent.click(btn()); });
    await act(async () => { fireEvent.keyDown(window, { code: 'Space' }); });
    await waitFor(() => screen.getByText('Back 1'));
    await act(async () => { fireEvent.click(screen.getByText(/^Good$/)); });
    await waitFor(() => screen.getByText('Front 2'));
    await waitFor(() => expect(played()[0].src).toBe('/api/assets/front2.opus'));
    await act(async () => { played()[0].dispatch('ended'); });
    expect(btn()).not.toBeDisabled();
  });
});
