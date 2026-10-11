// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Flashcard "Study all" (v1.18.0): every deck with cards due, the newest
 * first, each as its own session (its own cards, its own "All Done!" report),
 * moving on by itself, then one "All Done!" screen. FlashcardReview has its
 * own tests, and what an extension adds to the screen is tested with it: here,
 * what the page asks and shows.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CardDirection, State } from '@libresrs/shared';
import StudyAll from './StudyAll';

type Overview = { decks: { deckId: number; deckName: string; total: number }[]; totalDue: number; learningLater: number; learningBackInMs: number | null };

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  overview: undefined as unknown,
  overviewError: null as unknown,
  /** What the server answers studyAll with at the end of each round, in turn. */
  nextOverviews: [] as unknown[],
  fetchOverview: vi.fn(),
  /** Each deck's due cards, as getDueCards answers them (absent: not fetched yet). */
  dueCards: new Map<number, unknown[]>(),
  dueError: null as unknown,
  dueInputs: [] as unknown[],
  /** Whether each list (studyAll's, a deck's cards) was fetched after the page or the deck's turn began. */
  fetchedAfterMount: true,
  overviewFresh: true,
  removed: [] as unknown[],
  version: 0,
  listeners: new Set<() => void>(),
  log: vi.fn(),
  logAnswer: { logged: true, deduped: false, decksLeft: [] } as unknown,
  mutationState: { isPending: false, failureCount: 0, isPaused: false },
  mutationOptions: null as unknown,
  reviewMounts: 0,
}));

/** A change the page's queries see, as a react-query cache update would show it. */
function bump() {
  h.version += 1;
  h.listeners.forEach((fn) => fn());
}

// The cache key of a deck's cards, as the page names it to drop it, and the cache it drops it from.
vi.mock('@trpc/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trpc/react-query')>()),
  getQueryKey: (_procedure: unknown, input: unknown, type: unknown) => ['cards.getDueCards', { input, type }],
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ removeQueries: (filters: { queryKey: unknown }) => h.removed.push(filters.queryKey) }),
}));

vi.mock('../api/trpc', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (fn: () => void) => { h.listeners.add(fn); return () => { h.listeners.delete(fn); }; };
  return {
    trpc: {
      useUtils: () => ({
        cards: {
          studyAll: {
            fetch: async (input: unknown) => {
              h.fetchOverview(input);
              return h.nextOverviews.shift() ?? { decks: [], totalDue: 0, learningLater: 0, learningBackInMs: null };
            },
          },
        },
      }),
      cards: {
        studyAll: {
          useQuery: () => {
            useSyncExternalStore(subscribe, () => h.version);
            const status = h.overview !== undefined ? 'success' : h.overviewError ? 'error' : 'pending';
            return { data: h.overview, error: h.overviewError, refetch: vi.fn(), status, dataUpdatedAt: h.overviewFresh ? Date.now() : 0 };
          },
        },
        getDueCards: {
          useQuery: (input: { deckId: number }, options: unknown) => {
            useSyncExternalStore(subscribe, () => h.version);
            h.dueInputs.push([input, options]);
            const cards = h.dueCards.get(input.deckId);
            const status = cards ? 'success' : h.dueError ? 'error' : 'pending';
            return {
              data: cards ? { cards } : undefined, status, dataUpdatedAt: h.fetchedAfterMount ? Date.now() : 0,
              error: h.dueError, refetch: vi.fn(), isFetching: false,
            };
          },
        },
        logStudyCompletion: {
          useMutation: (options: unknown) => {
            h.mutationOptions = options;
            return {
              mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
                h.log(vars);
                opts?.onSuccess?.(h.logAnswer);
              },
              ...h.mutationState,
            };
          },
        },
      },
    },
  };
});

vi.mock('../components/FlashcardReview', async () => {
  const { useEffect } = await import('react');
  return {
    default: function FakeReview({ cards, onComplete, onExit }: { cards: { card: { front: string } }[]; onComplete: () => void; onExit: () => void }) {
      useEffect(() => {
        h.reviewMounts += 1;
      }, []);
      return (
        <div>
          <div data-testid="review">{cards.map((c) => c.card.front).join(',')}</div>
          <button type="button" onClick={onComplete}>Complete</button>
          <button type="button" onClick={onExit}>Exit</button>
        </div>
      );
    },
  };
});

let nextStateId = 100;
const card = (deckId: number, front: string) => ({
  card: { id: nextStateId, deckId, front, back: `${front} (en)` },
  state: { id: nextStateId++, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
});

const overview = (decks: [number, string, number][], later = 0): Overview => ({
  decks: decks.map(([deckId, deckName, total]) => ({ deckId, deckName, total })),
  totalDue: decks.reduce((sum, [, , total]) => sum + total, 0),
  learningLater: later,
  learningBackInMs: later > 0 ? 4 * 60_000 : null,
});

function renderPage() {
  const router = createMemoryRouter([
    { path: '/study/all', element: <StudyAll /> },
    { path: '/', element: <p>Dashboard</p> },
  ], { initialEntries: ['/study/all'] });
  render(<RouterProvider router={router} />);
  return router;
}

const deckLine = () => screen.getByTestId('study-all-deck');
const review = () => screen.getByTestId('review');

describe('Study all flashcards', () => {
  beforeEach(() => {
    h.overview = overview([[3, 'Unit 3', 2], [2, 'Unit 2', 1], [1, 'Unit 1', 1]]);
    h.overviewError = null;
    h.nextOverviews = [];
    h.fetchOverview.mockReset();
    h.dueCards = new Map<number, unknown[]>([
      [3, [card(3, 'nuevo'), card(3, 'también')]],
      [2, [card(2, 'casa')]],
      [1, [card(1, 'hola')]],
    ]);
    h.dueError = null;
    h.dueInputs = [];
    h.fetchedAfterMount = true;
    h.overviewFresh = true;
    h.removed = [];
    h.log.mockReset();
    h.logAnswer = { logged: true, deduped: false, decksLeft: [] };
    h.mutationState = { isPending: false, failureCount: 0, isPaused: false };
    h.mutationOptions = null;
    h.reviewMounts = 0;
  });

  it('studies each deck in the server\'s order (newest first) as its own session, reports each deck\'s own finish, then one "All Done!"', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(deckLine()).toHaveTextContent('Deck 1 of 3: Unit 3');
    expect(review()).toHaveTextContent('nuevo,también');
    // Each deck's cards are its own Study session's: its own getDueCards, fetched afresh.
    expect(h.dueInputs.at(-1)).toEqual([{ deckId: 3, timezoneOffsetMinutes: expect.any(Number) }, { refetchOnMount: 'always' }]);

    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(h.log).toHaveBeenLastCalledWith({ deckId: 3, reason: 'session_complete', timezoneOffsetMinutes: expect.any(Number) });
    expect(deckLine()).toHaveTextContent('Deck 2 of 3: Unit 2');
    expect(review()).toHaveTextContent('casa');

    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(h.log).toHaveBeenLastCalledWith({ deckId: 2, reason: 'session_complete', timezoneOffsetMinutes: expect.any(Number) });
    expect(deckLine()).toHaveTextContent('Deck 3 of 3: Unit 1');

    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toHaveFocus();
    expect(h.log).toHaveBeenCalledTimes(3);
    // Asked again after the round: nothing came due meanwhile.
    expect(h.fetchOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("You've studied every deck with cards due today. Come back later for more!")).toBeInTheDocument();
    const studied = screen.getByRole('heading', { name: 'Decks studied' }).parentElement!;
    expect(studied).toHaveTextContent('Unit 3');
    expect(studied).toHaveTextContent('Unit 1');
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/');
  });

  it('drops each deck\'s cached cards as its turn ends (its own Study page would open on cards just done), skipped ones too', async () => {
    const user = userEvent.setup();
    h.dueCards.set(1, []);
    renderPage();
    expect(h.removed).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(h.removed).toEqual([['cards.getDueCards', { input: { deckId: 3 }, type: 'query' }]]);
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    // Unit 1 has nothing now: skipped, and dropped too.
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toBeInTheDocument();
    expect(h.removed.map((key) => (key as [string, { input: { deckId: number } }])[1].input.deckId)).toEqual([3, 2, 1]);
  });

  it('plans the run only from a list of decks fetched after the page opened', async () => {
    // The dashboard button's cached answer: wait for the fresh one.
    h.overviewFresh = false;
    renderPage();
    expect(screen.queryByTestId('study-all-deck')).toBeNull();
    expect(screen.queryByTestId('review')).toBeNull();
    h.overview = overview([[2, 'Unit 2', 1]]);
    h.overviewFresh = true;
    await act(async () => bump());
    expect(deckLine()).toHaveTextContent('Deck 1 of 1: Unit 2');
  });

  it('skips a deck with nothing to study now, without reporting a finish for it', async () => {
    const user = userEvent.setup();
    h.dueCards.set(2, []);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    // Unit 2 is done already (in another tab, or on its own page): straight on to Unit 1.
    expect(deckLine()).toHaveTextContent('Deck 3 of 3: Unit 1');
    expect(h.log.mock.calls.map(([vars]) => (vars as { deckId: number }).deckId)).toEqual([3]);
  });

  it('starts another round, newest first, with what came due meanwhile', async () => {
    const user = userEvent.setup();
    h.overview = overview([[3, 'Unit 3', 2], [1, 'Unit 1', 1]]);
    // A card of Unit 3 back from a learning step after the round.
    h.nextOverviews = [overview([[3, 'Unit 3', 1]]), overview([], 1)];
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText('Deck 1 of 1: Unit 3')).toBeInTheDocument();
    // A new session of Unit 3: FlashcardReview starts afresh.
    expect(h.reviewMounts).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toBeInTheDocument();
    expect(h.log.mock.calls.map(([vars]) => (vars as { deckId: number }).deckId)).toEqual([3, 1, 3]);
    // A card still waits on a learning step: when it comes back.
    expect(screen.getByTestId('learning-later')).toHaveTextContent('1 card comes back in about 4 min.');
  });

  it('ends a round that rated nothing even if the server still lists decks: it never loops', async () => {
    h.overview = overview([[2, 'Unit 2', 1]]);
    h.dueCards.set(2, []);
    h.nextOverviews = [overview([[2, 'Unit 2', 1]])];
    renderPage();
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toBeInTheDocument();
    expect(screen.getByText('More cards are due. Reload the page to continue.')).toBeInTheDocument();
    // Never "nothing is due" (nor "every deck studied") beside it.
    expect(screen.queryByText(/Nothing is due in any of your decks/)).toBeNull();
    expect(screen.queryByText(/You've studied every deck/)).toBeNull();
    expect(h.log).not.toHaveBeenCalled();
  });

  it('keeps the session when the deck\'s cards are fetched again: new cards join, nothing starts over', async () => {
    renderPage();
    expect(review()).toHaveTextContent('nuevo,también');
    // The connection came back: Unit 3's cards fetched again, one more came due.
    h.dueCards.set(3, [...h.dueCards.get(3)!, card(3, 'otra')]);
    await act(async () => bump());
    expect(review()).toHaveTextContent('nuevo,también,otra');
    expect(h.reviewMounts).toBe(1);
    expect(deckLine()).toHaveTextContent('Deck 1 of 3: Unit 3');
    // An empty fetch mid-session (the last cards wait on a learning step) does not end it.
    h.dueCards.set(3, []);
    await act(async () => bump());
    expect(review()).toHaveTextContent('nuevo,también,otra');
    expect(h.log).not.toHaveBeenCalled();
  });

  it('never starts a session from cards cached before the deck\'s turn', async () => {
    h.fetchedAfterMount = false;
    renderPage();
    expect(screen.queryByTestId('review')).toBeNull();
    h.fetchedAfterMount = true;
    await act(async () => bump());
    expect(review()).toHaveTextContent('nuevo,también');
  });

  it('opens on "All Done!" when nothing is due anywhere, reporting nothing', async () => {
    h.overview = overview([], 2);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toBeInTheDocument();
    expect(screen.getByText('Nothing is due in any of your decks right now. Come back later for more!')).toBeInTheDocument();
    expect(screen.getByTestId('learning-later')).toHaveTextContent('2 cards come back in about 4 min.');
    expect(screen.queryByRole('heading', { name: 'Decks studied' })).toBeNull();
    expect(h.log).not.toHaveBeenCalled();
  });

  it('sends a lost report again as a deck\'s page does, and says it is still saving', () => {
    h.mutationState = { isPending: true, failureCount: 1, isPaused: false };
    renderPage();
    const options = h.mutationOptions as { retry: (n: number, e: unknown) => boolean };
    expect(options.retry(0, { message: 'Failed to fetch' })).toBe(true);
    expect(options.retry(0, { message: 'x', data: { httpStatus: 403 } })).toBe(false);
    expect(screen.getByText('Saving your finish… check your Wi-Fi.')).toBeInTheDocument();
  });

  it('offers to try again, or to skip, a deck whose cards would not load', async () => {
    const user = userEvent.setup();
    h.dueError = { message: 'Failed to fetch' };
    h.dueCards = new Map();
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the cards of Unit 3.');
    await user.click(screen.getByRole('button', { name: 'Skip this deck' }));
    expect(deckLine()).toHaveTextContent('Deck 2 of 3: Unit 2');
    expect(h.log).not.toHaveBeenCalled();
  });

  it('says so when the decks cannot be loaded', () => {
    h.overview = undefined;
    h.overviewError = { message: 'Failed to fetch' };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your decks.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('goes back to the dashboard from a session', async () => {
    const user = userEvent.setup();
    const router = renderPage();
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(router.state.location.pathname).toBe('/');
  });
});
