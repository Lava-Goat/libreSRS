import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReview from './FlashcardReview';
import { CardDirection, State, Rating } from '@libresrs/shared';

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

const mutateAsync = vi.fn();
const undoMutateAsync = vi.fn();

/**
 * The server as the page sees it: a rating answers with the card's own state (Again puts it in
 * learning, anything else graduates it), and undo gives back the state from before the rating.
 */
function answerLikeTheServer() {
  const before = new Map<number, typeof mockReviewResult.state>();
  let nextLogId = 100;
  mutateAsync.mockImplementation(async ({ cardStateId, rating }: { cardStateId: number; rating: number }) => {
    const reviewLogId = nextLogId++;
    before.set(reviewLogId, { ...mockReviewResult.state, id: cardStateId, reps: 0, state: State.New });
    const state = rating === Rating.Again ? State.Learning : State.Review;
    return { ...mockReviewResult, reviewLogId, newState: state, state: { ...mockReviewResult.state, id: cardStateId, state } };
  });
  undoMutateAsync.mockImplementation(async ({ reviewLogId }: { reviewLogId: number }) => ({
    state: before.get(reviewLogId),
    nextReviewOptions: mockReviewResult.nextReviewOptions,
  }));
}

vi.mock('../api/trpc', () => ({
  trpc: {
      useUtils: () => ({
        ai: { getCardAiState: { setData: vi.fn(), invalidate: vi.fn(async () => {}) } },
      }),
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
          data: { pronunciation: false, image: false, mnemonic: false },
        }),
      },
      getCardAiState: {
        useQuery: () => ({ data: null }),
      },
      getCardAssets: {
        useQuery: () => ({ data: null }),
      },
      generateImage: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
        useQuery: () => ({ data: { autoPlayAudio: false, autoPlayAudioFront: false, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
      getDeckSettings: {
        useQuery: () => ({ data: { autoPlayAudio: false, autoPlayAudioFront: false, aiEnabled: true, mnemonicMode: 'manual' } }),
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

describe('FlashcardReview', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    undoMutateAsync.mockReset();
    answerLikeTheServer();
  });

  it('advances after rating and submits review', async () => {
    const user = userEvent.setup();
    render(
      <FlashcardReview
        cards={[
          baseCard,
          {
            ...baseCard,
            card: { id: 2, deckId: 1, front: 'Front 2', back: 'Back 2' },
            state: { ...baseCard.state, id: 11 },
          },
        ]}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /good/i }));
    });

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        cardStateId: 10,
        rating: Rating.Good,
        timeSpentMs: expect.any(Number),
      }));
    });
    await waitFor(() => {
      expect(screen.getByText('1 of 2 seen · 1 done')).toBeInTheDocument();
    });
  });

  it('still rates a card left open for more than an hour (a closed lid), or after the clock stepped back: the time is sent within the server\'s hour', async () => {
    let clock = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const user = userEvent.setup();
      render(
        <FlashcardReview
          cards={[baseCard, { ...baseCard, card: { id: 2, deckId: 1, front: 'Front 2', back: 'Back 2' }, state: { ...baseCard.state, id: 11 } }]}
          onComplete={vi.fn()}
          onExit={vi.fn()}
        />
      );
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /show answer/i }));
      });
      clock += 61 * 60 * 1000;
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /good/i }));
      });
      await waitFor(() => expect(screen.getByText('1 of 2 seen · 1 done')).toBeInTheDocument());
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /show answer/i }));
      });
      clock -= 10_000;
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /good/i }));
      });
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
      expect(mutateAsync.mock.calls.map(([vars]) => vars.timeSpentMs)).toEqual([3_600_000, 0]);
    } finally {
      now.mockRestore();
    }
  });

  it('calls onComplete after the last card is rated', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onExit = vi.fn();

    render(
      <FlashcardReview
        cards={[baseCard]}
        onComplete={onComplete}
        onExit={onExit}
      />
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /easy/i }));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('renders media HTML in card content', async () => {
    const user = userEvent.setup();
    const mediaCard = {
      ...baseCard,
      card: {
        id: 3,
        deckId: 1,
        front: '<img src="https://example.com/cat.jpg" alt="cat image">',
        back: '<audio controls src="https://example.com/pronunciation.mp3"></audio>',
      },
      state: { ...baseCard.state, id: 12 },
    };

    const { container } = render(
      <FlashcardReview
        cards={[mediaCard]}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: /cat image/i })).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute('src')).toBe('https://example.com/pronunciation.mp3');
  });

  it('lets the user adjust the card font size with the toolbar slider', async () => {
    const user = userEvent.setup();

    render(
      <FlashcardReview
        cards={[baseCard]}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />
    );

    const slider = screen.getByRole('slider', { name: /card font size/i });
    fireEvent.change(slider, { target: { value: '2' } });

    expect(screen.getByText('Front 1')).toHaveStyle({ fontSize: '2rem' });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });

    expect(screen.getByText('Back 1')).toHaveStyle({ fontSize: '2rem' });
  });

  it('calls onExit when Exit button is clicked', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();

    render(
      <FlashcardReview
        cards={[baseCard]}
        onComplete={vi.fn()}
        onExit={onExit}
      />
    );

    await user.click(screen.getByRole('button', { name: /^exit$/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('calls onExit when Exit button is activated via keyboard', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();

    render(
      <FlashcardReview
        cards={[baseCard]}
        onComplete={vi.fn()}
        onExit={onExit}
      />
    );

    const exitButton = screen.getByRole('button', { name: /^exit$/i });
    exitButton.focus();
    await user.keyboard('{Enter}');

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('renders reverse cards with back as question and front as answer', async () => {
    const user = userEvent.setup();
    const reverseCard = {
      ...baseCard,
      card: {
        id: 4,
        deckId: 1,
        front: '<audio controls src="https://example.com/front.mp3"></audio>',
        back: '<img src="https://example.com/back.jpg" alt="reverse image">',
      },
      direction: CardDirection.Reverse,
      state: { ...baseCard.state, id: 13 },
    };

    const { container } = render(
      <FlashcardReview
        cards={[reverseCard]}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByText(/reverse/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /reverse image/i })).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute('src')).toBe('https://example.com/front.mp3');
  });

  describe('the counter: how close "All Done!" is', () => {
    const card = (id: number, state: State = State.New) => ({
      ...baseCard,
      card: { id, deckId: 1, front: `Front ${id}`, back: `Back ${id}` },
      state: { ...baseCard.state, id: id * 10, state },
    });

    async function rate(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /show answer/i }));
      });
      await act(async () => {
        await user.click(screen.getByRole('button', { name }));
      });
    }

    /** "{{seen}} of {{total}} seen · {{done}} done", on the page and on the bar, whose value is the cards done. */
    function expectCounter(seen: number, total: number, done: number) {
      const text = `${seen} of ${total} seen · ${done} done`;
      expect(screen.getByText(text)).toBeInTheDocument();
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-label', text);
      expect(bar).toHaveAttribute('aria-valuenow', String(Math.round((done / total) * 100)));
      // Two tones: seen (light) and done (dark), each its share of the cards.
      expect(within(bar).getByTestId('progress-seen')).toHaveStyle({ width: `${(seen / total) * 100}%` });
      expect(within(bar).getByTestId('progress-done')).toHaveStyle({ width: `${(done / total) * 100}%` });
    }

    it('moves "seen" on every first answer, while "done" counts cards finished: Again is seen, not done', async () => {
      const user = userEvent.setup();
      render(<FlashcardReview cards={[card(1), card(2), card(3)]} onComplete={vi.fn()} onExit={vi.fn()} />);
      expectCounter(0, 3, 0);

      await rate(user, /again/i); // card 1 goes to learning, to the back of the queue
      await waitFor(() => expect(screen.getByText('Front 2')).toBeInTheDocument());
      expectCounter(1, 3, 0);

      await rate(user, /good/i); // card 2 graduates
      await waitFor(() => expectCounter(2, 3, 1));
      await rate(user, /good/i); // card 3
      await waitFor(() => expectCounter(3, 3, 2));
      expect(screen.getByText('Front 1')).toBeInTheDocument(); // card 1, still in learning

      await rate(user, /again/i); // card 1 again: a second answer is not a second card seen
      await waitFor(() => expectCounter(3, 3, 2));
    });

    it('reads "3 of 3 seen · 0 done" after a first pass that left every card in learning (the old counter sat at 0)', async () => {
      const user = userEvent.setup();
      render(<FlashcardReview cards={[card(1), card(2), card(3)]} onComplete={vi.fn()} onExit={vi.fn()} />);
      await rate(user, /again/i);
      await rate(user, /again/i);
      await rate(user, /again/i);
      await waitFor(() => expectCounter(3, 3, 0));
    });

    it('takes a card back off both counts when its only answer is undone, and an undone Again leaves it unseen', async () => {
      const user = userEvent.setup();
      render(<FlashcardReview cards={[card(1), card(2), card(3)]} onComplete={vi.fn()} onExit={vi.fn()} />);

      await rate(user, /good/i);
      await waitFor(() => expectCounter(1, 3, 1));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /undo/i }));
      });
      await waitFor(() => expectCounter(0, 3, 0));
      expect(screen.getByText('Front 1')).toBeInTheDocument();

      await rate(user, /again/i);
      await waitFor(() => expect(screen.getByText('Front 2')).toBeInTheDocument());
      expectCounter(1, 3, 0);
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /undo/i }));
      });
      await waitFor(() => expect(screen.getByText('Front 1')).toBeInTheDocument());
      expectCounter(0, 3, 0);
    });

    it('keeps a card seen when only its second answer is undone', async () => {
      const user = userEvent.setup();
      render(<FlashcardReview cards={[card(1)]} onComplete={vi.fn()} onExit={vi.fn()} />);
      await rate(user, /again/i); // alone in the session: it comes straight back
      await waitFor(() => expectCounter(1, 1, 0));
      await rate(user, /again/i);
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /undo/i }));
      });
      await waitFor(() => expect(undoMutateAsync).toHaveBeenCalledTimes(1));
      expectCounter(1, 1, 0);
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /undo/i }));
      });
      await waitFor(() => expect(undoMutateAsync).toHaveBeenCalledTimes(2));
      expectCounter(0, 1, 0);
    });

    it('times a lone card in learning from when it comes back, not from its first showing', async () => {
      let clock = 1_000_000;
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        const user = userEvent.setup();
        render(<FlashcardReview cards={[card(1)]} onComplete={vi.fn()} onExit={vi.fn()} />);
        await act(async () => {
          await user.click(screen.getByRole('button', { name: /show answer/i }));
        });
        clock += 3_000;
        await act(async () => {
          await user.click(screen.getByRole('button', { name: /again/i }));
        });
        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        // The same card is shown again at once (nothing else is left).
        await waitFor(() => expect(screen.getByRole('button', { name: /show answer/i })).toBeInTheDocument());
        clock += 2_000;
        await rate(user, /good/i);
        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
        expect(mutateAsync.mock.calls.map(([vars]) => vars.timeSpentMs)).toEqual([3_000, 2_000]);
      } finally {
        now.mockRestore();
      }
    });

    it('stays put when the cards prop is replaced mid-session: nothing finished comes back, nothing in learning is dropped', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      const { rerender } = render(<FlashcardReview cards={[card(1), card(2), card(3)]} onComplete={onComplete} onExit={vi.fn()} />);
      await rate(user, /good/i); // card 1 is done
      await rate(user, /again/i); // card 2 goes to learning
      await waitFor(() => expect(screen.getByText('Front 3')).toBeInTheDocument());
      expectCounter(2, 3, 1);

      // A refetch when the connection comes back: the page's first list again (card 1 as it was), new objects.
      rerender(<FlashcardReview cards={[card(1), card(2), card(3)]} onComplete={onComplete} onExit={vi.fn()} />);
      expectCounter(2, 3, 1);
      expect(screen.getByText('Front 3')).toBeInTheDocument();

      // What the server has now: card 3, and a review that came due. Card 2 (its step later today) is not in it.
      rerender(<FlashcardReview cards={[card(3), card(4, State.Review)]} onComplete={onComplete} onExit={vi.fn()} />);
      expectCounter(2, 4, 1);
      expect(screen.getByText('Front 3')).toBeInTheDocument();

      await rate(user, /good/i); // card 3
      await rate(user, /good/i); // card 2, out of learning
      await rate(user, /good/i); // card 4
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(mutateAsync.mock.calls.map(([vars]) => vars.cardStateId)).toEqual([10, 20, 30, 20, 40]);
    });

    it('reports the cards left by state: new, learning and review', async () => {
      const user = userEvent.setup();
      const onSessionCountsChange = vi.fn();
      render(
        <FlashcardReview
          cards={[card(1), card(2, State.Review), card(3, State.Relearning)]}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          onSessionCountsChange={onSessionCountsChange}
        />,
      );
      expect(onSessionCountsChange).toHaveBeenLastCalledWith({ newRemaining: 1, learningRemaining: 1, reviewRemaining: 1 });
      await rate(user, /again/i); // the new card goes to learning
      await waitFor(() => {
        expect(onSessionCountsChange).toHaveBeenLastCalledWith({ newRemaining: 0, learningRemaining: 2, reviewRemaining: 1 });
      });
    });
  });
});
