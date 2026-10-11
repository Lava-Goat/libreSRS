// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudyAllConjugationButton } from './StudyAllConjugationButton';

const h = vi.hoisted(() => ({ quizzes: undefined as unknown }));

vi.mock('../../api/trpc', () => ({
  trpc: { conjugation: { myQuizzes: { useQuery: () => ({ data: h.quizzes }) } } },
}));

function renderButton() {
  return render(
    <MemoryRouter>
      <StudyAllConjugationButton />
    </MemoryRouter>,
  );
}

describe('StudyAllConjugationButton (v1.18.0)', () => {
  beforeEach(() => {
    h.quizzes = undefined;
  });

  it('links to Study all once the student has a quiz to play', () => {
    h.quizzes = [{ deckId: 13, deckName: 'Unit 1', mastered: 3, total: 102, lastScore: null, due: 0 }];
    renderButton();
    expect(screen.getByRole('link', { name: 'Study all conjugation' })).toHaveAttribute('href', '/conjugation/all');
  });

  it('is not there while loading or with no quiz', () => {
    const { container, unmount } = renderButton();
    expect(container).toBeEmptyDOMElement();
    unmount();
    h.quizzes = [];
    expect(renderButton().container).toBeEmptyDOMElement();
  });
});
