// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeckList from './DeckList';

const h = vi.hoisted(() => ({
  decks: [] as unknown[],
  quizzes: null as unknown[] | null,
}));

vi.mock('../api/trpc', () => ({
  trpc: {
    cards: {
      getMyDecks: { useQuery: () => ({ data: h.decks, isLoading: false }) },
    },
    conjugation: {
      myQuizzes: { useQuery: () => ({ data: h.quizzes ?? undefined }) },
    },
  },
}));

vi.mock('./DeckSettings', () => ({ default: () => null }));

const deck = (id: number, name: string) => ({
  id, name, description: null, cardCount: 40, learnedCount: 10, dueCount: 3,
});

function renderList() {
  render(<MemoryRouter><DeckList /></MemoryRouter>);
}

describe('DeckList', () => {
  beforeEach(() => {
    h.decks = [deck(1, 'Unidad 1'), deck(2, 'Unidad 2')];
    h.quizzes = null;
  });

  it('lists the decks with their study links', () => {
    renderList();
    expect(screen.getByRole('heading', { name: 'Unidad 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Study Now' })[0]).toHaveAttribute('href', '/study/1');
    expect(screen.queryByText(/conjugation/)).not.toBeInTheDocument();
  });

  it('says how many reviews wait after today\'s limit, under a due number that is only today\'s', () => {
    h.decks = [{ ...deck(1, 'Unidad 1'), dueCount: 20, reviewsBeyondLimit: 25 }, { ...deck(2, 'Unidad 2'), reviewsBeyondLimit: 0 }];
    renderList();
    expect(screen.getByText('20 due')).toBeInTheDocument();
    expect(screen.getAllByTestId('due-beyond-limit')).toHaveLength(1);
    expect(screen.getByTestId('due-beyond-limit')).toHaveTextContent("+25 more waiting after today's limit");
  });

  it('links "[Deck] conjugation" under a deck with the quiz on, with its mastery', () => {
    h.quizzes = [{ deckId: 2, deckName: 'Unidad 2', mastered: 12, total: 60, lastScore: null }];
    renderList();
    const link = screen.getByRole('link', { name: /Unidad 2 conjugation/ });
    expect(link).toHaveAttribute('href', '/conjugation/2');
    expect(link).toHaveTextContent('12 / 60 mastered');
    expect(screen.queryByRole('link', { name: /Unidad 1 conjugation/ })).not.toBeInTheDocument();
  });

  it('says how many forms of a quiz are due for review, and nothing when none are', () => {
    h.quizzes = [
      { deckId: 1, deckName: 'Unidad 1', mastered: 30, total: 60, lastScore: null, due: 1 },
      { deckId: 2, deckName: 'Unidad 2', mastered: 12, total: 60, lastScore: null, due: 0 },
    ];
    renderList();
    expect(screen.getByRole('link', { name: /Unidad 1 conjugation/ })).toHaveTextContent('1 form due');
    expect(screen.getByRole('link', { name: /Unidad 2 conjugation/ })).not.toHaveTextContent(/due/);

    h.quizzes = [{ deckId: 1, deckName: 'Unidad 1', mastered: 30, total: 60, lastScore: null, due: 7 }];
    renderList();
    expect(screen.getAllByRole('link', { name: /Unidad 1 conjugation/ }).at(-1)).toHaveTextContent('7 forms due');
  });
});
