import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Study from './Study';
import { CardDirection, State } from '@libresrs/shared';

const mockGetDueCards = vi.fn();
const mockGetDeckProgress = vi.fn();
/** The completion log: the server's report on this "All Done!". */
const mockLogCompletion = vi.fn();
// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  /** The options Study gives the completion log's useMutation (its retries and onError). */
  mutationOptions: null as null | { retry?: (n: number, e: unknown) => boolean; retryDelay?: (n: number) => number; onError?: () => void },
  /** The log's state as React Query reports it. */
  mutationState: { isPending: false, failureCount: 0, isPaused: false },
}));

vi.mock('../api/trpc', () => ({
  trpc: {
    cards: {
      logStudyCompletion: {
        useMutation: (options: typeof h.mutationOptions) => {
          h.mutationOptions = options;
          return { mutate: mockLogCompletion, ...h.mutationState };
        },
      },
      getDueCards: {
        useQuery: (...args: unknown[]) => mockGetDueCards(...args),
      },
      getDeckProgress: {
        useQuery: (...args: unknown[]) => mockGetDeckProgress(...args),
      },
    },
  },
}));

// What an extension shows on the "All Done!" screen is tested with it (src/extensions/*): here, core alone.
vi.mock('../components/FlashcardReview', () => ({
  default: ({ cards, onComplete, onExit }: { cards: unknown[]; onComplete: () => void; onExit: () => void }) => (
    <div>
      <div data-testid="flashcard-review">Cards: {cards.length}</div>
      <button onClick={onComplete}>Complete</button>
      <button onClick={onExit}>Exit</button>
    </div>
  ),
}));

const sampleCard = {
  card: { id: 1, deckId: 1, front: 'Front', back: 'Back' },
  state: { id: 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

describe('Study page', () => {
  beforeEach(() => {
    mockGetDueCards.mockReset();
    mockGetDeckProgress.mockReset();
    mockLogCompletion.mockReset();
    h.mutationOptions = null;
    h.mutationState = { isPending: false, failureCount: 0, isPaused: false };
  });

  const doneFor = (decksLeft: unknown[] = [], decksWaiting: unknown[] = []) => {
    mockLogCompletion.mockImplementation((_vars: unknown, options?: { onSuccess?: (r: unknown) => void }) => {
      options?.onSuccess?.({ logged: true, deduped: false, decksLeft, decksWaiting });
    });
    mockGetDueCards.mockReturnValue({
      data: { cards: [], counts: { remainingNewCardsToday: 0, remainingReviewsToday: 0, newCardsLimit: 20, reviewsLimit: 20 } },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({ data: { totalCards: 10, learnedCards: 4, retentionRate: 0.75, totalTimeMs: 60000 }, isFetching: false, refetch: vi.fn() });
    render(<RouterProvider router={createMemoryRouter([{ path: '/study/:deckId', element: <Study /> }], { initialEntries: ['/study/1'] })} />);
  };

  it('reports an empty deck\'s "All Done!" once, with the page\'s timezone, and shows nothing an extension would add', async () => {
    doneFor();
    expect(await screen.findByText(/all done/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    const [vars] = mockLogCompletion.mock.calls[0];
    expect(vars).toEqual({ deckId: 1, reason: 'nothing_due', timezoneOffsetMinutes: expect.any(Number) });
  });

  it('names the other decks still due today and offers "Study all"; nothing when none is left', async () => {
    doneFor([
      { deckId: 3, deckName: 'Unit 3', total: 12 },
      // This deck itself (the server found a card left): not "another deck".
      { deckId: 1, deckName: 'Unit 1', total: 1 },
      { deckId: 2, deckName: 'Unit 2', total: 5 },
    ]);
    const left = await screen.findByTestId('decks-left');
    expect(left).toHaveTextContent('Still due today: Unit 3 (12), Unit 2 (5)');
    expect(screen.getByRole('link', { name: /Study all flashcards/ })).toHaveAttribute('href', '/study/all');
  });

  it('says when another deck\'s card waiting on a learning step comes back: the day is not done until then', async () => {
    doneFor([], [
      { deckId: 4, deckName: 'Unit 4', count: 1, backInMs: 7.5 * 60_000 },
      // This deck's own are told by its counts, not here.
      { deckId: 1, deckName: 'Unit 1', count: 2, backInMs: 60_000 },
      { deckId: 2, deckName: 'Unit 2', count: 3, backInMs: null },
    ]);
    const waiting = await screen.findByTestId('decks-waiting');
    expect(waiting).toHaveTextContent('Later today:');
    expect(within(waiting).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Unit 4: 1 card comes back in about 8 min.',
      'Unit 2: 3 cards come back in about 1 min.',
    ]);
    // Nothing to study in them now: no "Study all" for them.
    expect(screen.queryByTestId('decks-left')).toBeNull();
    expect(screen.queryByRole('link', { name: /Study all flashcards/ })).toBeNull();
  });

  it('shows no other decks when every deck is done', async () => {
    doneFor();
    await act(async () => {});
    expect(screen.queryByTestId('decks-left')).toBeNull();
    expect(screen.queryByTestId('decks-waiting')).toBeNull();
    expect(screen.queryByRole('link', { name: /Study all flashcards/ })).toBeNull();
  });

  it('says when the cards still in learning come back, when nothing is due now', () => {
    mockGetDueCards.mockReturnValue({
      data: { cards: [], counts: { remainingNewCardsToday: 0, remainingReviewsToday: 20, newCardsLimit: 20, reviewsLimit: 20, learningLater: 3, learningBackInMs: 9.5 * 60_000 } },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });
    render(<RouterProvider router={createMemoryRouter([{ path: '/study/:deckId', element: <Study /> }], { initialEntries: ['/study/1'] })} />);
    expect(screen.getByText('3 cards come back in about 10 min.')).toBeInTheDocument();
  });

  describe('a lost "All Done!" report', () => {
    const networkError = { message: 'Failed to fetch' };
    const httpError = (httpStatus: number) => ({ message: 'x', data: { httpStatus } });

    it('is sent again when the network or the server failed, with growing waits, and not when the server said no', () => {
      doneFor();
      const options = h.mutationOptions!;
      expect(options.retry!(0, networkError)).toBe(true);
      expect(options.retry!(0, httpError(503))).toBe(true);
      expect(options.retry!(0, httpError(429))).toBe(true);
      expect(options.retry!(5, networkError)).toBe(true);
      expect(options.retry!(6, networkError)).toBe(false);
      for (const status of [400, 401, 403, 404, 409]) expect(options.retry!(0, httpError(status))).toBe(false);
      expect([0, 1, 2, 3, 4, 5].map((n) => options.retryDelay!(n))).toEqual([1000, 3000, 10000, 30000, 60000, 60000]);
    });

    it('says it is still saving after the first failure, or while the Chromebook is offline', () => {
      h.mutationState = { isPending: true, failureCount: 1, isPaused: false };
      doneFor();
      expect(screen.getByRole('status')).toHaveTextContent('Saving your finish… check your Wi-Fi.');
    });

    it('says nothing while the first try is still on its way', () => {
      h.mutationState = { isPending: true, failureCount: 0, isPaused: false };
      doneFor();
      expect(screen.queryByText('Saving your finish… check your Wi-Fi.')).not.toBeInTheDocument();
    });

  });

  it('shows completion state when there are no cards', () => {
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [],
        counts: {
          remainingNewCardsToday: 0,
          remainingReviewsToday: 0,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({
      data: {
        totalCards: 10,
        learnedCards: 4,
        retentionRate: 0.75,
        totalTimeMs: 60000,
      },
      isFetching: false,
      refetch: vi.fn(),
    });

    const router = createMemoryRouter(
      [{ path: '/study/:deckId', element: <Study /> }],
      {
        initialEntries: ['/study/1'],
      }
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(screen.getByText(/back to dashboard/i)).toBeInTheDocument();
  });

  it('renders FlashcardReview and refetches on completion', async () => {
    const refetch = vi.fn();
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [sampleCard],
        counts: {
          remainingNewCardsToday: 1,
          remainingReviewsToday: 1,
          newCardsInBatch: 1,
          reviewCardsInBatch: 0,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch,
    });
    mockGetDeckProgress.mockReturnValue({
      data: {
        totalCards: 10,
        learnedCards: 4,
        retentionRate: 0.75,
        totalTimeMs: 60000,
      },
      isFetching: false,
      refetch: vi.fn(),
    });

    const router = createMemoryRouter(
      [{ path: '/study/:deckId', element: <Study /> }],
      {
        initialEntries: ['/study/1'],
      }
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /complete/i }));

    expect(refetch).toHaveBeenCalled();
  });

  it('shows completion screen immediately after onComplete fires (no blank flash)', async () => {
    const refetch = vi.fn(); // refetch does NOT update data — simulates network delay
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [sampleCard],
        counts: {
          remainingNewCardsToday: 1,
          remainingReviewsToday: 1,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch,
    });
    mockGetDeckProgress.mockReturnValue({
      data: {
        totalCards: 10,
        learnedCards: 4,
        retentionRate: 0.75,
        totalTimeMs: 60000,
      },
      isFetching: false,
      refetch: vi.fn(),
    });

    const router = createMemoryRouter(
      [{ path: '/study/:deckId', element: <Study /> }],
      { initialEntries: ['/study/1'] }
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /complete/i }));

    // Completion screen should appear immediately — not after refetch resolves
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
  });

  it('Back to Dashboard link navigates to / in study session header', () => {
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [sampleCard],
        counts: {
          remainingNewCardsToday: 1,
          remainingReviewsToday: 1,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });

    const router = createMemoryRouter(
      [
        { path: '/study/:deckId', element: <Study /> },
        { path: '/', element: <div data-testid="dashboard">Dashboard</div> },
      ],
      { initialEntries: ['/study/1'] }
    );

    render(<RouterProvider router={router} />);

    const backLink = screen.getByText(/Back to Dashboard/);
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest('a')).toHaveAttribute('href', '/');
  });

  it('Exit button in FlashcardReview navigates to /', async () => {
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [sampleCard],
        counts: {
          remainingNewCardsToday: 1,
          remainingReviewsToday: 1,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });

    const router = createMemoryRouter(
      [
        { path: '/study/:deckId', element: <Study /> },
        { path: '/', element: <div data-testid="dashboard">Dashboard</div> },
      ],
      { initialEntries: ['/study/1'] }
    );

    render(<RouterProvider router={router} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /exit/i }));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('Back to Dashboard link in completion view navigates to /', () => {
    mockGetDueCards.mockReturnValue({
      data: {
        cards: [],
        counts: {
          remainingNewCardsToday: 0,
          remainingReviewsToday: 0,
          newCardsLimit: 20,
          reviewsLimit: 20,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetDeckProgress.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });

    const router = createMemoryRouter(
      [
        { path: '/study/:deckId', element: <Study /> },
        { path: '/', element: <div data-testid="dashboard">Dashboard</div> },
      ],
      { initialEntries: ['/study/1'] }
    );

    render(<RouterProvider router={router} />);

    const backLink = screen.getByText(/Back to Dashboard/);
    expect(backLink.closest('a')).toHaveAttribute('href', '/');
  });

  describe('the "All Done!" log and its numbers', () => {
    /** A query whose answer the test changes, as a refetch would. */
    function queryStore<T>(initial: T) {
      let value = initial;
      const listeners = new Set<() => void>();
      return {
        set(next: T) {
          value = next;
          act(() => listeners.forEach((l) => l()));
        },
        use: () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => value),
      };
    }
    const countsOf = (remainingNew: number) => ({ remainingNewCardsToday: remainingNew, remainingReviewsToday: 20, newCardsLimit: 20, reviewsLimit: 20 });
    const stats = (learnedCards: number) => ({ totalCards: 30, learnedCards, retentionRate: 0.66, totalTimeMs: 300000 });

    function setUp(firstCards: unknown[]) {
      const refetch = vi.fn();
      const refetchProgress = vi.fn();
      let updatedAt = 1;
      const due = queryStore({ data: { cards: firstCards, counts: countsOf(20) }, isLoading: false, isFetching: false, dataUpdatedAt: updatedAt, refetch });
      const progress = queryStore({ data: stats(0), isFetching: false, refetch: refetchProgress });
      mockGetDueCards.mockImplementation(() => due.use());
      mockGetDeckProgress.mockImplementation(() => progress.use());
      mockLogCompletion.mockImplementation((_vars: unknown, options?: { onSuccess?: (r: unknown) => void }) => {
        options?.onSuccess?.({ logged: true, deduped: false });
      });
      render(<RouterProvider router={createMemoryRouter([{ path: '/study/:deckId', element: <Study /> }], { initialEntries: ['/study/1'] })} />);
      return {
        refetch,
        refetchProgress,
        /** The refetch after "All Done!" is on its way. */
        fetching: () => {
          due.set({ data: { cards: firstCards, counts: countsOf(20) }, isLoading: false, isFetching: true, dataUpdatedAt: updatedAt, refetch });
          progress.set({ data: stats(0), isFetching: true, refetch: refetchProgress });
        },
        /** The server's answer arrives. */
        answer: (cards: unknown[], remainingNew: number, learned: number) => {
          updatedAt += 1;
          due.set({ data: { cards, counts: countsOf(remainingNew) }, isLoading: false, isFetching: false, dataUpdatedAt: updatedAt, refetch });
          progress.set({ data: stats(learned), isFetching: false, refetch: refetchProgress });
        },
        /** The cached cards are dropped (the query was reset): nothing to show until they come again. */
        dropped: () => {
          due.set({ data: undefined as unknown as { cards: unknown[]; counts: ReturnType<typeof countsOf> }, isLoading: false, isFetching: true, dataUpdatedAt: updatedAt, refetch });
        },
      };
    }

    it('logs a finished session once, with the page\'s timezone and no counts (the server counts), and refreshes both sets of numbers', async () => {
      const page = setUp([sampleCard]);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /complete/i }));

      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
      expect(mockLogCompletion.mock.calls[0][0]).toEqual({ deckId: 1, reason: 'session_complete', timezoneOffsetMinutes: expect.any(Number) });
      expect(page.refetch).toHaveBeenCalledTimes(1);
      expect(page.refetchProgress).toHaveBeenCalledTimes(1);

      page.answer([], 0, 20);
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    });

    it('shows today\'s numbers and the deck\'s stats only once the fresh ones arrive, never the page-open "0 / 20"', async () => {
      const page = setUp([sampleCard]);
      const user = userEvent.setup();
      page.fetching();
      await user.click(screen.getByRole('button', { name: /complete/i }));
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
      expect(screen.queryByText("Today's Progress")).not.toBeInTheDocument();
      expect(screen.queryByText('Learned')).not.toBeInTheDocument();
      expect(screen.queryByText('0 / 20')).not.toBeInTheDocument();

      page.answer([], 0, 20);
      expect(screen.getByText("Today's Progress")).toBeInTheDocument();
      expect(screen.getByText('20 / 20')).toBeInTheDocument();
      expect(screen.getByText('Learned').nextElementSibling).toHaveTextContent('20');
    });

    it('logs a second session: cards after "All Done!" reopen it, and its own "All Done!" is logged again', async () => {
      const page = setUp([sampleCard]);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /complete/i }));
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);

      // The refetch finds one more card (the server said cards were due, or a step came due).
      page.answer([{ ...sampleCard, state: { ...sampleCard.state, id: 11 } }], 0, 19);
      expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');
      await user.click(screen.getByRole('button', { name: /complete/i }));

      expect(mockLogCompletion).toHaveBeenCalledTimes(2);
      expect(mockLogCompletion.mock.calls.map(([vars]) => (vars as { reason: string }).reason)).toEqual(['session_complete', 'session_complete']);
    });

    it('stays on "All Done!" when a fetch brings the same cards again (nothing new to study)', async () => {
      const page = setUp([sampleCard]);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /complete/i }));
      page.answer([{ ...sampleCard }], 0, 20);
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
      expect(screen.queryByTestId('flashcard-review')).not.toBeInTheDocument();
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    });

    it('keeps a session going when a refetch mid-session comes back empty (the last cards wait on a learning step), and logs nothing', async () => {
      const page = setUp([sampleCard]);
      expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');
      // The connection comes back and React Query refetches: nothing is due right now.
      page.answer([], 0, 1);
      expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');
      expect(screen.queryByText(/all done/i)).not.toBeInTheDocument();
      expect(mockLogCompletion).not.toHaveBeenCalled();

      // The session still ends the one way it can: its own "All Done!", logged as finished.
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /complete/i }));
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
      expect(mockLogCompletion.mock.calls.map(([vars]) => (vars as { reason: string }).reason)).toEqual(['session_complete']);
    });

    it('fetches again when the server still finds cards due, and says so when the page finds none', async () => {
      const page = setUp([sampleCard]);
      mockLogCompletion.mockImplementation((_vars: unknown, options?: { onSuccess?: (r: unknown) => void }) => {
        options?.onSuccess?.({ logged: false, deduped: false, reason: 'cards-due' });
      });
      page.refetch.mockResolvedValue({ data: { cards: [], counts: countsOf(0) } });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /complete/i }));
      // Once on completion, once more for the server's answer.
      expect(page.refetch).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('More cards are due. Reload the page to continue.')).toBeInTheDocument();

      // When the fetch finds them, the session reopens instead, and the note goes.
      page.answer([{ ...sampleCard, state: { ...sampleCard.state, id: 12 } }], 0, 19);
      expect(screen.getByTestId('flashcard-review')).toBeInTheDocument();
      expect(screen.queryByText('More cards are due. Reload the page to continue.')).not.toBeInTheDocument();
    });

    it('logs an empty deck once, however often it is fetched again', async () => {
      const page = setUp([]);
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
      expect(mockLogCompletion.mock.calls[0][0]).toEqual({ deckId: 1, reason: 'nothing_due', timezoneOffsetMinutes: expect.any(Number) });
      page.answer([], 0, 20);
      page.answer([], 0, 20);
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    });

    it('can report an empty deck again once its report failed for good (the screen\'s "logged" mark is cleared)', () => {
      const page = setUp([]);
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
      page.dropped();
      page.answer([], 0, 20);
      // Still the same report: nothing new to send.
      expect(mockLogCompletion).toHaveBeenCalledTimes(1);
      // Every retry failed: React Query calls the hook's onError, and the next look reports again.
      act(() => h.mutationOptions!.onError!());
      page.dropped();
      page.answer([], 0, 20);
      expect(mockLogCompletion).toHaveBeenCalledTimes(2);
    });

    it('logs nothing while the cards have not loaded', () => {
      mockGetDueCards.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, refetch: vi.fn() });
      mockGetDeckProgress.mockReturnValue({ data: undefined, isFetching: true, refetch: vi.fn() });
      render(<RouterProvider router={createMemoryRouter([{ path: '/study/:deckId', element: <Study /> }], { initialEntries: ['/study/1'] })} />);
      expect(mockLogCompletion).not.toHaveBeenCalled();
    });
  });
});
