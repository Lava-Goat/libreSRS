// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Labs from './Labs';
import Dashboard from './Dashboard';

const h = vi.hoisted(() => ({ labs: [] as unknown[] }));

vi.mock('../api/trpc', () => {
  const empty = { useQuery: () => ({ data: undefined, isLoading: false }) };
  return {
    trpc: {
      useUtils: () => ({ labs: { list: { invalidate: async () => {} } } }),
      labs: { list: { useQuery: () => ({ data: h.labs, isLoading: false }) } },
      cards: { getStats: empty },
      vocab: { listOpenTests: empty },
      speaking: { list: empty },
      signups: { list: empty },
    },
  };
});
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Ana' }, isAdmin: false, logout: () => {} }),
}));
vi.mock('../components/labs/LabRunner', () => ({ default: () => null }));
vi.mock('../components/DeckList', () => ({ default: () => null }));
vi.mock('../components/VirtualDeckList', () => ({ default: () => null }));
vi.mock('../components/UserStats', () => ({ default: () => null }));
vi.mock('../components/UserSettings', () => ({ default: () => null }));
// The "Study all" buttons beside Your Decks (v1.18.0) query on their own.
vi.mock('../components/conjugation/StudyAllConjugationButton', () => ({ StudyAllConjugationButton: () => null }));
vi.mock('../components/studyAll/StudyAllFlashcardsButton', () => ({ StudyAllFlashcardsButton: () => null }));

const lab = (id: number, overrides: Record<string, unknown>) => ({
  id,
  title: `Semana ${id}`,
  description: null,
  durationMs: 15 * 60_000,
  requiredThroughMs: 14 * 60_000,
  status: 'todo',
  redoByTeacher: false,
  submittedAt: null,
  attempts: 0,
  pausesAnswered: null,
  pausesCounted: null,
  needed: null,
  ...overrides,
});

const item = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!;

describe('Labs: where the student stands on each lab', () => {
  beforeEach(() => {
    h.labs = [
      lab(1, { status: 'done', submittedAt: new Date('2026-09-20T17:00:00Z'), attempts: 1 }),
      lab(2, { status: 'redo', attempts: 1, pausesAnswered: 40, pausesCounted: 100, needed: 75 }),
      lab(3, { status: 'redo', redoByTeacher: true, attempts: 1, pausesAnswered: 90, pausesCounted: 100, needed: 75 }),
      lab(4, { status: 'check', attempts: 1, pausesAnswered: 0, pausesCounted: 100, needed: 75 }),
      lab(5, {}),
    ];
  });

  it('shows done, redo, check and to-do with their own text, colour and button', () => {
    render(<MemoryRouter><Labs /></MemoryRouter>);

    const done = item('Semana 1');
    expect(done).toHaveClass('border-green-500');
    expect(done).toHaveTextContent('Submitted');
    expect(within(done).getByRole('button', { name: 'Do it again' })).not.toHaveClass('bg-blue-600');

    const redo = item('Semana 2');
    expect(redo).toHaveClass('border-amber-500');
    expect(redo).toHaveTextContent("Didn't count: you answered 40 of 100 pauses (75 needed)");
    expect(within(redo).getByRole('button', { name: 'Do it again' })).toHaveClass('bg-blue-600');

    const byTeacher = item('Semana 3');
    expect(byTeacher).toHaveClass('border-amber-500');
    expect(byTeacher).toHaveTextContent('Your teacher asked you to do it again.');
    expect(byTeacher).not.toHaveTextContent("Didn't count");
    expect(within(byTeacher).getByRole('button', { name: 'Do it again' })).toHaveClass('bg-blue-600');

    const check = item('Semana 4');
    expect(check).toHaveClass('border-amber-500');
    expect(check).toHaveTextContent('Waiting for your teacher to check it.');
    expect(within(check).getByRole('button', { name: 'Do it again' })).not.toHaveClass('bg-blue-600');

    const todo = item('Semana 5');
    expect(todo).toHaveClass('border-blue-500');
    expect(todo).toHaveTextContent('Not done yet');
    expect(within(todo).getByRole('button', { name: 'Start' })).toHaveClass('bg-blue-600');
  });

  it('says what the attempt needed, by the rule it was judged by', () => {
    // Judged at 50% while the rule is 75% now.
    h.labs = [lab(2, { status: 'redo', attempts: 1, pausesAnswered: 40, pausesCounted: 100, needed: 50 })];
    render(<MemoryRouter><Labs /></MemoryRouter>);
    expect(item('Semana 2')).toHaveTextContent("Didn't count: you answered 40 of 100 pauses (50 needed)");
  });

  it('reads a list without statuses (cached before this release) by whether it was turned in', () => {
    h.labs = [
      { ...lab(1, { submittedAt: new Date('2026-09-20T17:00:00Z') }), status: undefined },
      { ...lab(2, {}), status: undefined },
    ];
    render(<MemoryRouter><Labs /></MemoryRouter>);
    expect(item('Semana 1')).toHaveTextContent('Submitted');
    expect(item('Semana 2')).toHaveTextContent('Not done yet');
  });
});

describe('Dashboard: labs to do', () => {
  it('counts labs never turned in and labs to redo, not those done or waiting for the teacher', () => {
    h.labs = [
      lab(1, { status: 'done', submittedAt: new Date('2026-09-20T17:00:00Z') }),
      lab(2, { status: 'redo' }),
      lab(3, { status: 'check' }),
      lab(4, {}),
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('2 lab(s) to do')).toBeInTheDocument();
  });

  it('says all labs are turned in when none is to do or to redo', () => {
    h.labs = [lab(1, { status: 'done', submittedAt: new Date('2026-09-20T17:00:00Z') }), lab(3, { status: 'check' })];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('All labs turned in')).toBeInTheDocument();
  });
});
