// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Speaking from './Speaking';
import Dashboard from './Dashboard';

const h = vi.hoisted(() => ({ tasks: [] as unknown[], runner: vi.fn() }));

vi.mock('../api/trpc', () => {
  const empty = { useQuery: () => ({ data: undefined, isLoading: false }) };
  return {
    trpc: {
      useUtils: () => ({ speaking: { list: { invalidate: async () => {} } } }),
      speaking: { list: { useQuery: () => ({ data: h.tasks, isLoading: false, error: null, refetch: async () => {}, isFetching: false }) } },
      cards: { getStats: empty },
      vocab: { listOpenTests: empty },
      labs: { list: empty },
      signups: { list: empty },
    },
  };
});
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Ana' }, isAdmin: false, logout: () => {} }),
}));
vi.mock('../components/speaking/SpeakingRunner', () => ({ default: (props: unknown) => { h.runner(props); return null; } }));
vi.mock('../components/DeckList', () => ({ default: () => null }));
vi.mock('../components/VirtualDeckList', () => ({ default: () => null }));
vi.mock('../components/UserStats', () => ({ default: () => null }));
vi.mock('../components/UserSettings', () => ({ default: () => null }));
// The "Study all" buttons beside Your Decks (v1.18.0) query on their own.
vi.mock('../components/conjugation/StudyAllConjugationButton', () => ({ StudyAllConjugationButton: () => null }));
vi.mock('../components/studyAll/StudyAllFlashcardsButton', () => ({ StudyAllFlashcardsButton: () => null }));

const task = (id: number, overrides: Record<string, unknown>) => ({
  id,
  title: `Cuento ${id}`,
  targetSeconds: 30,
  submittedAt: null,
  attempts: 0,
  littleSpeech: false,
  ...overrides,
});

const item = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!;
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}
const quietNote = 'We could hardly hear you. Record it again, closer to the microphone.';

describe('Speaking: the list of tasks', () => {
  beforeEach(() => {
    h.tasks = [
      task(1, { submittedAt: new Date('2026-09-25T15:00:00Z'), attempts: 1 }),
      task(2, { submittedAt: new Date('2026-09-26T15:00:00Z'), attempts: 1, littleSpeech: true }),
      task(3, {}),
    ];
  });

  it('asks for a new take of a very quiet one, which still reads as turned in', () => {
    render(<MemoryRouter><Speaking /></MemoryRouter>);

    const quiet = item('Cuento 2');
    expect(quiet).toHaveTextContent(/^Cuento 2Turned in .+ · We could hardly hear you\. Record it again, closer to the microphone\.Open$/);
    expect(quiet).toHaveClass('border-amber-500');
    expect(within(quiet).getByRole('button', { name: 'Open' })).toBeInTheDocument();

    const done = item('Cuento 1');
    expect(done).toHaveClass('border-green-500');
    expect(done).not.toHaveTextContent(quietNote);

    const todo = item('Cuento 3');
    expect(todo).toHaveClass('border-blue-500');
    expect(todo).toHaveTextContent('Not done yet');
    expect(todo).not.toHaveTextContent(quietNote);
  });

  it('reads a list cached before v1.16.0 (no littleSpeech) as it did', () => {
    h.tasks = [{ ...task(1, { submittedAt: new Date('2026-09-25T15:00:00Z'), attempts: 1 }), littleSpeech: undefined }];
    render(<MemoryRouter><Speaking /></MemoryRouter>);
    expect(item('Cuento 1')).toHaveClass('border-green-500');
    expect(item('Cuento 1')).not.toHaveTextContent(quietNote);
  });
});

describe('Speaking: speaking tests are listed on the Tests page (v1.21.0)', () => {
  beforeEach(() => {
    h.runner.mockClear();
    h.tasks = [
      task(3, {}),
      task(7, { title: 'Examen U2 · Expresión oral', examSet: 'U2' }),
    ];
  });

  it('leaves a speaking test out, and points to the Tests page', () => {
    render(<MemoryRouter><Speaking /></MemoryRouter>);
    expect(screen.queryByText('Examen U2 · Expresión oral')).toBeNull();
    expect(item('Cuento 3')).toHaveTextContent('Not done yet');
    const link = screen.getByRole('link', { name: 'Go to Tests' });
    expect(link).toHaveAttribute('href', '/tests');
    expect(link.closest('p')).toHaveTextContent('Looking for a test? Go to Tests');
  });

  it('with only tests: the pointer, and nothing to record here', () => {
    h.tasks = [task(7, { title: 'Examen U2 · Expresión oral', examSet: 'U2' })];
    render(<MemoryRouter><Speaking /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Go to Tests' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to record right now.')).toBeInTheDocument();
  });

  it('no pointer without tests (a list from before v1.21.0 has no examSet)', () => {
    h.tasks = [task(3, {})];
    render(<MemoryRouter><Speaking /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Go to Tests' })).toBeNull();
    expect(item('Cuento 3')).toBeInTheDocument();
  });

  it('a speaking test opened here by a direct link goes back to the Tests page; a practice task back here', () => {
    const view = render(<MemoryRouter initialEntries={['/speaking?task=7']}><Speaking /><Where /></MemoryRouter>);
    const test = h.runner.mock.lastCall![0] as { taskId: number; fromTests?: boolean; onExit: (test: boolean) => void };
    expect(test.taskId).toBe(7);
    expect(test.fromTests).toBeUndefined();
    act(() => test.onExit(true));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/tests$/);
    view.unmount();

    render(<MemoryRouter initialEntries={['/speaking?task=3']}><Speaking /><Where /></MemoryRouter>);
    const practice = h.runner.mock.lastCall![0] as { onExit: (test: boolean) => void };
    act(() => practice.onExit(false));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/speaking$/);
  });
});

describe('Dashboard: recordings to do', () => {
  it('counts a very quiet take as turned in', () => {
    h.tasks = [
      task(1, { submittedAt: new Date('2026-09-25T15:00:00Z'), attempts: 1, littleSpeech: true }),
      task(2, { submittedAt: new Date('2026-09-26T15:00:00Z'), attempts: 1 }),
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('All recordings turned in')).toBeInTheDocument();
  });
});
