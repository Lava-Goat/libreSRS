// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Flashcard "Study all" against a real react-query cache (StudyAll.test.tsx
 * fakes the queries): what a cached list may and may not do. TanStack keeps a
 * query's old data when a fetch fails, and counts the failure as "fetched after
 * mount", so a deck's cards cached from an earlier visit must never start its
 * session; a deck's list must not outlive its turn (its own Study page shares
 * the query and would open on cards just done); and the run is planned from a
 * studyAll answer fetched after the page opened, never the dashboard button's.
 * The server is a link answering from the handlers below; FlashcardReview is a
 * stand-in (it has its own tests).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { CardDirection, State } from '@libresrs/shared';
import type { AppRouter } from '../../../server/src/routers/index.ts';
import { trpc } from '../api/trpc';
import { getTimezoneOffsetMinutes } from '../utils/time';
import StudyAll from './StudyAll';

const h = vi.hoisted(() => ({ reviewMounts: 0 }));

vi.mock('../components/FlashcardReview', async () => {
  const { useEffect } = await import('react');
  return {
    default: function FakeReview({ cards, onComplete }: { cards: { card: { front: string } }[]; onComplete: () => void }) {
      useEffect(() => {
        h.reviewMounts += 1;
      }, []);
      return (
        <div>
          <div data-testid="review">{cards.map((c) => c.card.front).join(',')}</div>
          <button type="button" onClick={onComplete}>Complete</button>
        </div>
      );
    },
  };
});

type Handler = (input: unknown) => unknown;
/** The server: one handler per procedure path; a thrown error is a failed request. */
let handlers: Record<string, Handler>;
let calls: { path: string; input: unknown }[];

const serverLink: TRPCLink<AppRouter> = () => ({ op }) => observable((observer) => {
  calls.push({ path: op.path, input: op.input });
  Promise.resolve()
    .then(() => {
      const handler = handlers[op.path];
      if (!handler) throw new Error(`No handler for ${op.path}`);
      return handler(op.input);
    })
    .then(
      (data) => {
        observer.next({ result: { type: 'data', data } });
        observer.complete();
      },
      (err: Error) => observer.error(TRPCClientError.from(err)),
    );
  return () => {};
});

let nextId = 500;
const card = (deckId: number, front: string) => ({
  card: { id: nextId, deckId, front, back: `${front} (en)` },
  state: { id: nextId++, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: State.New },
  direction: CardDirection.Forward,
  nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
});
const counts = { remainingNewCardsToday: 20, remainingReviewsToday: 250, newCardsLimit: 20, reviewsLimit: 250, learningLater: 0, learningBackInMs: null };
const due = (deckId: number, ...fronts: string[]) => ({ cards: fronts.map((f) => card(deckId, f)), counts });
const view = (decks: [number, string][]) => ({
  decks: decks.map(([deckId, deckName]) => ({ deckId, deckName, learning: 0, reviews: 0, newCards: 1, total: 1 })),
  totalDue: decks.length,
  learningLater: 0,
  learningBackInMs: null,
});
const finished = { logged: true, deduped: false, decksLeft: [], decksWaiting: [] };
const failed = () => {
  throw new Error('Failed to fetch');
};

const offset = () => getTimezoneOffsetMinutes();
const dueKey = (deckId: number) => getQueryKey(trpc.cards.getDueCards, { deckId, timezoneOffsetMinutes: offset() }, 'query');
const studyAllKey = () => getQueryKey(trpc.cards.studyAll, { timezoneOffsetMinutes: offset() }, 'query');
/** Cached a minute ago, as an earlier visit (or the dashboard's button) left it. */
const MINUTE_AGO = () => Date.now() - 60_000;

let queryClient: QueryClient;

function renderPage() {
  const client = trpc.createClient({ links: [serverLink] });
  const router = createMemoryRouter([
    { path: '/study/all', element: <StudyAll /> },
    { path: '/', element: <p>Dashboard</p> },
  ], { initialEntries: ['/study/all'] });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return router;
}

describe('Study all flashcards, with a real query cache', () => {
  beforeEach(() => {
    h.reviewMounts = 0;
    calls = [];
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    handlers = {
      'cards.studyAll': () => view([[3, 'Unit 3']]),
      'cards.getDueCards': (input) => due((input as { deckId: number }).deckId, 'nuevo'),
      'cards.logStudyCompletion': () => finished,
    };
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('never starts a deck\'s session from cards cached before its turn, even when the fresh fetch fails', async () => {
    // Unit 3 opened on its own page a minute ago: its list (cards rated since) is still cached.
    queryClient.setQueryData(dueKey(3), due(3, 'done already'), { updatedAt: MINUTE_AGO() });
    handlers['cards.getDueCards'] = failed;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the cards of Unit 3.');
    expect(screen.queryByTestId('review')).toBeNull();
    expect(h.reviewMounts).toBe(0);
    // Trying again once the connection is back: the fresh list, never the cached one.
    handlers['cards.getDueCards'] = (input) => due((input as { deckId: number }).deckId, 'nuevo');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('review')).toHaveTextContent('nuevo');
  });

  it('waits for a fresh list rather than show the cached one first', async () => {
    queryClient.setQueryData(dueKey(3), due(3, 'done already'), { updatedAt: MINUTE_AGO() });
    renderPage();
    expect(await screen.findByTestId('review')).toHaveTextContent('nuevo');
    expect(screen.queryByText(/done already/)).toBeNull();
    expect(h.reviewMounts).toBe(1);
  });

  it('drops a deck\'s cached cards when its turn ends, so its own Study page fetches them afresh', async () => {
    const user = userEvent.setup();
    handlers['cards.studyAll'] = vi.fn()
      .mockReturnValueOnce(view([[3, 'Unit 3'], [2, 'Unit 2']]))
      .mockReturnValue(view([]));
    renderPage();
    expect(await screen.findByTestId('review')).toHaveTextContent('nuevo');
    expect(queryClient.getQueryData(dueKey(3))).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(screen.getByTestId('study-all-deck')).toHaveTextContent('Deck 2 of 2: Unit 2'));
    expect(queryClient.getQueryData(dueKey(3))).toBeUndefined();
    await screen.findByTestId('review');
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByRole('heading', { name: 'All Done!' })).toBeInTheDocument();
    expect(queryClient.getQueryData(dueKey(2))).toBeUndefined();
    expect(queryClient.getQueryCache().findAll({ queryKey: getQueryKey(trpc.cards.getDueCards) })).toEqual([]);
  });

  it('plans the run from the decks due now, not from the dashboard\'s cached answer', async () => {
    // The dashboard listed Unit 3 and Unit 2; Unit 3 was finished on its own page since.
    queryClient.setQueryData(studyAllKey(), view([[3, 'Unit 3'], [2, 'Unit 2']]), { updatedAt: MINUTE_AGO() });
    handlers['cards.studyAll'] = () => view([[2, 'Unit 2']]);
    renderPage();
    expect(await screen.findByTestId('study-all-deck')).toHaveTextContent('Deck 1 of 1: Unit 2');
    expect(await screen.findByTestId('review')).toHaveTextContent('nuevo');
    expect(calls.filter((c) => c.path === 'cards.getDueCards').map((c) => (c.input as { deckId: number }).deckId)).toEqual([2]);
  });

  it('says it cannot load the decks rather than plan from a cached answer when the fresh one fails', async () => {
    queryClient.setQueryData(studyAllKey(), view([[3, 'Unit 3']]), { updatedAt: MINUTE_AGO() });
    handlers['cards.studyAll'] = failed;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your decks.');
    expect(screen.queryByTestId('study-all-deck')).toBeNull();
    expect(calls.map((c) => c.path)).not.toContain('cards.getDueCards');
  });
});
