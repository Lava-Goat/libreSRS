// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** The dashboard's flashcard "Study all" button (v1.18.0). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudyAllFlashcardsButton } from './StudyAllFlashcardsButton';

const h = vi.hoisted(() => ({ data: undefined as unknown, inputs: [] as unknown[] }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    cards: {
      studyAll: {
        useQuery: (input: unknown) => {
          h.inputs.push(input);
          return { data: h.data };
        },
      },
    },
  },
}));

const view = (totalDue: number) => ({ decks: totalDue > 0 ? [{ deckId: 3, deckName: 'Unit 3', learning: 0, reviews: 0, newCards: totalDue, total: totalDue }] : [], totalDue, learningLater: 0, learningBackInMs: null });

describe('StudyAllFlashcardsButton', () => {
  beforeEach(() => {
    h.data = undefined;
    h.inputs = [];
  });

  it('links to Study all with every deck\'s due cards added up, on the page\'s clock', () => {
    h.data = view(42);
    render(<MemoryRouter><StudyAllFlashcardsButton /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Study all flashcards (42)' });
    expect(link).toHaveAttribute('href', '/study/all');
    expect(link).toHaveAttribute('title', 'Every deck with cards due today, the newest first');
    expect(h.inputs.at(-1)).toEqual({ timezoneOffsetMinutes: expect.any(Number) });
  });

  it('shows nothing while loading, or when nothing is due anywhere', () => {
    const { container, rerender } = render(<MemoryRouter><StudyAllFlashcardsButton /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    h.data = view(0);
    rerender(<MemoryRouter><StudyAllFlashcardsButton /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
