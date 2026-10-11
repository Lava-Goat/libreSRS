import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReview from './FlashcardReview';
import { CardDirection, State } from '@libresrs/shared';

// jsdom lacks ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const h = vi.hoisted(() => ({
  generateCalls: [] as { cardId: number; style?: string }[],
  isAdmin: true,
  /** ai.getConfig: which AI features the server offers. */
  aiConfig: { pronunciation: false, image: false, mnemonic: true },
  /** ai.getCardAssets' picture for the card, if any. */
  image: null as null | { url: string },
  /** What ai.getCardAiState answers; extra fields stand for an older server that still sent them. */
  aiStateData: {} as Record<string, unknown>,
  /** The deck's effective settings; extra fields likewise. */
  deckSettings: {} as Record<string, unknown>,
}));

/** What the server answers since v1.20.0: the card's mnemonic, nothing about cognates. */
const currentAiState = () => ({ acceptedMnemonic: null, pendingMnemonic: null });
const currentDeckSettings = () => ({ autoPlayAudio: false, autoPlayAudioFront: false, aiEnabled: true, mnemonicMode: 'manual' });

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));

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

// Same shape as FlashcardReview.test.tsx, but with mnemonics enabled and
// getCardAiState data available synchronously — in production the review
// screen pre-warms that query for the next two cards, so MnemonicPanel mounts
// with cached data. Before v1.20.0 that mount asked for a suggestion on its own
// (for a card whose cognate score was low); now only the teacher's press does.
vi.mock('../api/trpc', async () => {
  const React = await import('react');
  const inertMutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({
        ai: { getCardAiState: { setData: vi.fn(), invalidate: vi.fn(async () => {}) } },
      }),
      auth: {
        me: {
          useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
        },
        logout: {
          useMutation: inertMutation,
        },
      },
      cards: {
        review: {
          useMutation: () => ({
            mutateAsync: vi.fn().mockResolvedValue(mockReviewResult),
            isPending: false,
          }),
        },
        undoReview: {
          useMutation: inertMutation,
        },
      },
      ai: {
        getConfig: {
          useQuery: () => ({ data: h.aiConfig }),
        },
        getCardAiState: {
          useQuery: () => ({ data: h.aiStateData, refetch: vi.fn() }),
        },
        getCardAssets: {
          useQuery: () => ({ data: h.image ? { image: h.image } : null, refetch: vi.fn() }),
        },
        generateImage: { useMutation: inertMutation },
        removeImage: { useMutation: inertMutation },
        generateMnemonic: {
          // Fresh result object every render and an isPending re-render on
          // call, like React Query; the promise stays in flight for the test.
          useMutation: () => {
            const [isPending, setIsPending] = React.useState(false);
            return {
              isPending,
              mutateAsync: (input: { cardId: number; style?: string }) => {
                h.generateCalls.push({ cardId: input.cardId, style: input.style });
                setIsPending(true);
                return new Promise<never>(() => {});
              },
            };
          },
        },
        acceptMnemonic: { useMutation: inertMutation },
        rejectMnemonic: { useMutation: inertMutation },
        deleteMnemonic: { useMutation: inertMutation },
        regenerateCardAssets: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
        },
      },
      settings: {
        get: {
          useQuery: () => ({ data: h.deckSettings }),
        },
        getDeckSettings: {
          useQuery: () => ({ data: h.deckSettings }),
        },
      },
    },
  };
});

const baseCard = {
  card: { id: 1, deckId: 1, front: 'Front 1', back: 'Back 1' },
  state: { id: 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

const twoCards = () => [
  baseCard,
  { ...baseCard, card: { id: 2, deckId: 1, front: 'Front 2', back: 'Back 2' }, state: { ...baseCard.state, id: 11 } },
];

describe('FlashcardReview mnemonics: the teacher asks, nothing is suggested on its own', () => {
  beforeEach(() => {
    h.generateCalls.length = 0;
    h.isAdmin = true;
    h.aiConfig = { pronunciation: false, image: false, mnemonic: true };
    h.image = null;
    h.aiStateData = currentAiState();
    h.deckSettings = currentDeckSettings();
  });

  it('a student’s review never generates a mnemonic', async () => {
    h.isAdmin = false;
    const user = userEvent.setup();
    render(<FlashcardReview cards={twoCards()} onComplete={vi.fn()} onExit={vi.fn()} />);
    await act(async () => { await user.click(screen.getByText('Show Answer (Space)')); });
    await act(async () => { await user.click(screen.getByText('Good')); });
    await act(async () => { await user.click(screen.getByText('Show Answer (Space)')); });
    expect(h.generateCalls).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Suggest a mnemonic' })).toBeNull();
  });

  it('a teacher’s review generates only on the button, once per press, on any card', async () => {
    const user = userEvent.setup();
    render(<FlashcardReview cards={twoCards()} onComplete={vi.fn()} onExit={vi.fn()} />);

    // Neither the front nor the flip asks for one.
    expect(h.generateCalls).toEqual([]);
    await act(async () => {
      await user.click(screen.getByText('Show Answer (Space)'));
    });
    expect(h.generateCalls).toEqual([]);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Suggest a mnemonic' }));
    });
    // One keyword suggestion; the teacher may switch it to a sentence afterwards.
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);

    // Rating advances to card 2, and its flip asks for nothing either.
    await act(async () => {
      await user.click(screen.getByText('Good'));
    });
    expect(screen.getByText('Front 2')).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByText('Show Answer (Space)'));
    });
    expect(h.generateCalls).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Suggest a mnemonic' })).toBeInTheDocument();
  });

  it('an older server’s “auto-non-cognate” and low cognate score suggest nothing', async () => {
    // What v1.19.0 sent for a card the old gate would have asked about.
    h.aiStateData = { ...currentAiState(), aiState: { mnemonicEnabled: false }, cognateScore: 0.1, isFalseFriend: false, falseFriendDismissed: false };
    h.deckSettings = { ...currentDeckSettings(), mnemonicMode: 'auto-non-cognate', showCognateScore: true };
    const user = userEvent.setup();
    render(<FlashcardReview cards={twoCards()} onComplete={vi.fn()} onExit={vi.fn()} />);
    await act(async () => {
      await user.click(screen.getByText('Show Answer (Space)'));
    });
    expect(h.generateCalls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Suggest a mnemonic' })).toBeInTheDocument();
  });
});

describe('FlashcardReview shows students no cognate score', () => {
  beforeEach(() => {
    h.generateCalls.length = 0;
    h.isAdmin = false;
    h.aiConfig = { pronunciation: false, image: false, mnemonic: true };
    h.image = null;
  });

  it('on the back of the card, even where the card was scored and the old switch is on', async () => {
    // Everything that used to put "Cognate: 93%" and the false-friend warning under the answer.
    h.aiStateData = {
      acceptedMnemonic: { text: 'NATION sounds like nación', source: 'teacher' },
      pendingMnemonic: null,
      cognateScore: 0.93,
      isFalseFriend: true,
      falseFriendDismissed: false,
    };
    h.deckSettings = { ...currentDeckSettings(), showCognateScore: true };
    const user = userEvent.setup();
    render(<FlashcardReview cards={twoCards()} onComplete={vi.fn()} onExit={vi.fn()} />);
    await act(async () => {
      await user.click(screen.getByText('Show Answer (Space)'));
    });

    // The approved mnemonic is there, on the back…
    expect(screen.getByText('NATION sounds like nación')).toBeInTheDocument();
    // …and no badge, no percentage, no false-friend warning.
    expect(screen.queryByText(/cognate/i)).toBeNull();
    expect(screen.queryByText(/93\s*%/)).toBeNull();
    expect(screen.queryByText(/false friend/i)).toBeNull();
  });
});

describe('FlashcardReview: removing a card’s picture is the teacher’s (v1.20.0)', () => {
  beforeEach(() => {
    h.generateCalls.length = 0;
    h.aiConfig = { pronunciation: false, image: true, mnemonic: true };
    h.image = { url: 'data:image/png;base64,picture' };
    h.aiStateData = { acceptedMnemonic: { text: 'OH-la: hola', source: 'teacher' }, pendingMnemonic: null };
    h.deckSettings = currentDeckSettings();
  });

  const flip = async () => {
    const user = userEvent.setup();
    render(<FlashcardReview cards={twoCards()} onComplete={vi.fn()} onExit={vi.fn()} />);
    await act(async () => {
      await user.click(screen.getByText('Show Answer (Space)'));
    });
  };

  it('a student sees the picture and the approved mnemonic on the back, with no Remove and no suggestion buttons', async () => {
    h.isAdmin = false;
    await flip();
    expect(screen.getByRole('img', { name: 'AI-generated illustration' })).toBeInTheDocument();
    expect(screen.getByText('OH-la: hola')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    for (const name of ['Suggest a mnemonic', 'Try another', 'Try a sentence', 'Delete']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // One Regenerate: the picture's, which students keep as before (the mnemonic's is the teacher's).
    expect(screen.getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
    expect(h.generateCalls).toEqual([]);
  });

  it('the teacher sees Remove under the picture', async () => {
    h.isAdmin = true;
    await flip();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
