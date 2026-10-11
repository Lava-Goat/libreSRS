import { act, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import VirtualStudy from './VirtualStudy';
import { CardDirection, State } from '@libresrs/shared';

const mockGetDueCards = vi.fn();
const mockGetVirtualDeck = vi.fn();
const mockLogCompletion = vi.fn();
// Shared with the mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  mutationOptions: null as null | { retry?: (n: number, e: unknown) => boolean; onError?: () => void },
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
    },
    virtualDecks: {
      get: { useQuery: (...args: unknown[]) => mockGetVirtualDeck(...args) },
      getDueCards: { useQuery: (...args: unknown[]) => mockGetDueCards(...args) },
    },
  },
}));

// What an extension shows on the "All Done!" screen is tested with it (src/extensions/*): here, core alone.

vi.mock('../components/FlashcardReview', () => ({
  default: ({ cards, onComplete }: { cards: unknown[]; onComplete: () => void }) => (
    <div>
      <div data-testid="flashcard-review">Cards: {cards.length}</div>
      <button onClick={onComplete}>Complete</button>
    </div>
  ),
}));

const sampleCard = {
  card: { id: 1, deckId: 1, front: 'Front', back: 'Back' },
  state: { id: 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
};

const deck = { id: 5, name: 'First two', sourceDeckId: 1, sourceDeckName: 'Unit 1', cardCount: 2, learnedCount: 1 };

function renderPage(cards: unknown[]) {
  const refetch = vi.fn();
  const refetchDeck = vi.fn();
  mockGetDueCards.mockReturnValue({ data: cards, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch });
  mockGetVirtualDeck.mockReturnValue({ data: deck, isFetching: false, refetch: refetchDeck });
  render(<RouterProvider router={createMemoryRouter([{ path: '/study/virtual/:virtualDeckId', element: <VirtualStudy /> }], { initialEntries: ['/study/virtual/5'] })} />);
  return { refetch, refetchDeck };
}

describe('Virtual deck study page', () => {
  beforeEach(() => {
    mockGetDueCards.mockReset();
    mockGetVirtualDeck.mockReset();
    mockLogCompletion.mockReset();
    h.mutationOptions = null;
    h.mutationState = { isPending: false, failureCount: 0, isPaused: false };
  });

  it('shows nothing a finish report\'s extension fields would (none without extensions)', async () => {
    mockLogCompletion.mockImplementation((_vars: unknown, options?: { onSuccess?: (r: unknown) => void }) => {
      options?.onSuccess?.({ logged: true, deduped: false, decksLeft: [] });
    });
    renderPage([sampleCard]);
    await userEvent.setup().click(screen.getByRole('button', { name: /complete/i }));
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sends a lost report again as the deck page does, and says it is still saving after a failure', () => {
    h.mutationState = { isPending: true, failureCount: 2, isPaused: false };
    renderPage([]);
    expect(h.mutationOptions?.retry?.(0, { message: 'Failed to fetch' })).toBe(true);
    expect(h.mutationOptions?.retry?.(0, { data: { httpStatus: 404 } })).toBe(false);
    expect(h.mutationOptions?.onError).toBeTypeOf('function');
    expect(screen.getByRole('status')).toHaveTextContent('Saving your finish… check your Wi-Fi.');
  });

  it('logs a finished session with the virtual deck and the page\'s timezone, no counts, and refreshes the deck\'s numbers', async () => {
    const { refetch, refetchDeck } = renderPage([sampleCard]);
    await userEvent.setup().click(screen.getByRole('button', { name: /complete/i }));

    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    expect(mockLogCompletion.mock.calls[0][0]).toEqual({ virtualDeckId: 5, reason: 'session_complete', timezoneOffsetMinutes: expect.any(Number) });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetchDeck).toHaveBeenCalledTimes(1);
  });

  it('keeps a session going when a refetch mid-session comes back empty, and logs nothing until its own "All Done!"', async () => {
    // A query whose answer the test changes, as a refetch would.
    let answer: unknown = { data: [sampleCard], isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() };
    const listeners = new Set<() => void>();
    mockGetDueCards.mockImplementation(() => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => answer));
    mockGetVirtualDeck.mockReturnValue({ data: deck, isFetching: false, refetch: vi.fn() });
    render(<RouterProvider router={createMemoryRouter([{ path: '/study/virtual/:virtualDeckId', element: <VirtualStudy /> }], { initialEntries: ['/study/virtual/5'] })} />);
    expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');

    // The connection comes back: nothing is due right now (the last card waits on a learning step).
    answer = { data: [], isLoading: false, isFetching: false, dataUpdatedAt: 2, refetch: vi.fn() };
    act(() => listeners.forEach((l) => l()));
    expect(screen.getByTestId('flashcard-review')).toHaveTextContent('Cards: 1');
    expect(screen.queryByText(/all done/i)).not.toBeInTheDocument();
    expect(mockLogCompletion).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: /complete/i }));
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(mockLogCompletion.mock.calls.map(([vars]) => (vars as { reason: string }).reason)).toEqual(['session_complete']);
  });

  it('logs an empty virtual deck once', () => {
    renderPage([]);
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(mockLogCompletion).toHaveBeenCalledTimes(1);
    expect(mockLogCompletion.mock.calls[0][0]).toEqual({ virtualDeckId: 5, reason: 'nothing_due', timezoneOffsetMinutes: expect.any(Number) });
  });

  it('shows the deck\'s numbers only while no fresh ones are on their way', () => {
    renderPage([]);
    expect(screen.getByText('Learned')).toBeInTheDocument();
  });

  it('hides the deck\'s numbers while they are fetched again', () => {
    mockGetDueCards.mockReturnValue({ data: [], isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() });
    mockGetVirtualDeck.mockReturnValue({ data: deck, isFetching: true, refetch: vi.fn() });
    render(<RouterProvider router={createMemoryRouter([{ path: '/study/virtual/:virtualDeckId', element: <VirtualStudy /> }], { initialEntries: ['/study/virtual/5'] })} />);
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
    expect(screen.queryByText('Learned')).not.toBeInTheDocument();
  });
});
