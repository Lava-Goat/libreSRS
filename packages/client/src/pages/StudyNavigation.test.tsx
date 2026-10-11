/**
 * Integration tests for Study page navigation.
 * Uses the REAL FlashcardReview component (no mock) to catch
 * regressions like keyboard-handler interception of Exit / Back to Dashboard.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Study from './Study';
import { CardDirection, State } from '@libresrs/shared';

const mockGetDueCards = vi.fn();
const mockGetDeckProgress = vi.fn();
const mockScanDeckMutate = vi.fn();
const mockReviewMutateAsync = vi.fn();
const mockUndoMutateAsync = vi.fn();

vi.mock('../api/trpc', () => ({
  trpc: {
    // The answer side's mnemonic panel.
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
      logStudyCompletion: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      getDueCards: {
        useQuery: (...args: unknown[]) => mockGetDueCards(...args),
      },
      getDeckProgress: {
        useQuery: (...args: unknown[]) => mockGetDeckProgress(...args),
      },
      review: {
        useMutation: () => ({
          mutateAsync: mockReviewMutateAsync,
          isPending: false,
        }),
      },
      undoReview: {
        useMutation: () => ({
          mutateAsync: mockUndoMutateAsync,
          isPending: false,
        }),
      },
    },
    ai: {
      scanDeck: {
        useMutation: () => ({
          mutate: mockScanDeckMutate,
          isPending: false,
        }),
      },
      getConfig: {
        useQuery: () => ({
          data: { pronunciation: false, image: false, mnemonic: false },
        }),
      },
      getCardAiState: {
        useQuery: () => ({ data: null }),
      },
      getCardAssets: {
        useQuery: () => ({ data: { audio: null, audioFront: null, audioBack: null, image: null } }),
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

// NOTE: FlashcardReview is NOT mocked — the real component renders.

const sampleCard = {
  card: { id: 1, deckId: 1, front: 'Front', back: 'Back' },
  state: { id: 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

function renderStudy(cards: unknown[] = [sampleCard]) {
  mockGetDueCards.mockReturnValue({
    data: {
      cards,
      counts: {
        remainingNewCardsToday: 1,
        remainingReviewsToday: 1,
        newCardsLimit: 20,
        reviewsLimit: 20,
      },
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  mockGetDeckProgress.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });

  const router = createMemoryRouter(
    [
      { path: '/study/:deckId', element: <Study /> },
      { path: '/', element: <div data-testid="dashboard">Dashboard</div> },
    ],
    { initialEntries: ['/study/1'] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

describe('Study page navigation (integration — real FlashcardReview)', () => {
  beforeEach(() => {
    mockGetDueCards.mockReset();
    mockGetDeckProgress.mockReset();
    mockScanDeckMutate.mockReset();
    mockReviewMutateAsync.mockReset();
    mockUndoMutateAsync.mockReset();
  });

  it('Exit button click navigates to dashboard', async () => {
    const user = userEvent.setup();
    renderStudy();

    await user.click(screen.getByRole('button', { name: /^exit$/i }));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('Exit button keyboard activation (Enter) navigates to dashboard', async () => {
    const user = userEvent.setup();
    renderStudy();

    const exitButton = screen.getByRole('button', { name: /^exit$/i });
    exitButton.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('Back to Dashboard link click navigates to dashboard', async () => {
    const user = userEvent.setup();
    renderStudy();

    await user.click(screen.getByText(/Back to Dashboard/));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('Back to Dashboard link keyboard activation (Enter) navigates to dashboard', async () => {
    const user = userEvent.setup();
    renderStudy();

    const backLink = screen.getByText(/Back to Dashboard/).closest('a')!;
    backLink.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('counts the cards left by state in the header, and the cards done under it, as the student rates', async () => {
    const user = userEvent.setup();
    const reviewCard = {
      ...sampleCard,
      card: { id: 2, deckId: 1, front: 'Otra', back: 'Another' },
      state: { ...sampleCard.state, id: 20, reps: 3, state: State.Review },
    };
    // The server: Again puts a card in learning, Good graduates it.
    mockReviewMutateAsync.mockImplementation(async ({ cardStateId, rating }: { cardStateId: number; rating: number }) => {
      const state = rating === 1 ? State.Learning : State.Review;
      return {
        reviewLogId: cardStateId + rating,
        nextReview: new Date(),
        newState: state,
        state: { id: cardStateId, stability: 1, difficulty: 2, reps: 1, lapses: 0, state },
        nextReviewOptions: sampleCard.nextReviewOptions,
      };
    });
    renderStudy([sampleCard, reviewCard]);
    const header = () => screen.getByTestId('session-counts');
    await waitFor(() => expect(header()).toHaveTextContent('1new0learning1review'));
    expect(screen.getByText('0 of 2 seen · 0 done')).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /again/i }));
    });
    await waitFor(() => expect(header()).toHaveTextContent('0new1learning1review'));
    expect(screen.getByText('1 of 2 seen · 0 done')).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /show answer/i }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /good/i }));
    });
    await waitFor(() => expect(header()).toHaveTextContent('0new1learning0review'));
    expect(screen.getByText('2 of 2 seen · 1 done')).toBeInTheDocument();
  });
});
