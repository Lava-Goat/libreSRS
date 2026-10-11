// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's Tests page (v1.21.0): one card per exam set, its listening
 * forms (with v1.19.0's one-start rule and "started" block) and its speaking
 * tests, never a practice item; each opens here in the same runner the Labs
 * and Speaking pages use, and comes back here.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Tests from './Tests';

const h = vi.hoisted(() => ({
  labs: [] as unknown[] | undefined,
  tasks: [] as unknown[] | undefined,
  labsError: null as Error | null,
  tasksError: null as Error | null,
  labsInput: vi.fn(),
  labsOptions: vi.fn(),
  refetchLabs: vi.fn(async () => {}),
  refetchTasks: vi.fn(async () => {}),
  invalidateLabs: vi.fn(async () => {}),
  invalidateTasks: vi.fn(async () => {}),
  labRunner: vi.fn(),
  speakingRunner: vi.fn(),
}));

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      labs: { list: { invalidate: h.invalidateLabs } },
      speaking: { list: { invalidate: h.invalidateTasks } },
    }),
    labs: {
      list: {
        useQuery: (input: unknown, options: unknown) => {
          h.labsInput(input);
          h.labsOptions(options);
          return { data: h.labs, isLoading: false, error: h.labsError, refetch: h.refetchLabs, isFetching: false };
        },
      },
    },
    speaking: {
      list: {
        useQuery: () => ({ data: h.tasks, isLoading: false, error: h.tasksError, refetch: h.refetchTasks, isFetching: false }),
      },
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Ana' }, isAdmin: false, logout: () => {} }),
}));
// The runners are the Labs and Speaking pages' own, tested there: here only what the page hands them.
vi.mock('../components/labs/LabRunner', () => ({ default: (props: unknown) => { h.labRunner(props); return null; } }));
vi.mock('../components/speaking/SpeakingRunner', () => ({ default: (props: unknown) => { h.speakingRunner(props); return null; } }));

const lab = (id: number, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
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
const exam = (set: string, start: unknown = null, preview = false) => ({ exam: { set, preview, start } });
const task = (id: number, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  targetSeconds: 60,
  submittedAt: null,
  attempts: 0,
  littleSpeech: false,
  examSet: null,
  ...overrides,
});

const STARTED_AT = new Date('2026-10-08T16:05:00Z').getTime();
const u2Start = { labId: 51, title: 'Examen U2 · Escucha · Forma A', startedAt: STARTED_AT, finished: true };
const TURNED_IN = new Date('2026-10-08T17:00:00Z');

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}
const renderAt = (url = '/tests') => render(<MemoryRouter initialEntries={[url]}><Tests /><Where /></MemoryRouter>);
const where = () => screen.getByTestId('where').textContent;
const setCard = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('li')!;
/** A set's Listening or Speaking part. */
const part = (card: HTMLElement, name: 'Listening' | 'Speaking') => within(card).getByRole('heading', { level: 3, name }).parentElement!;

beforeEach(() => {
  h.labsInput.mockClear();
  h.labsOptions.mockClear();
  h.refetchLabs.mockClear();
  h.refetchTasks.mockClear();
  h.invalidateLabs.mockClear();
  h.invalidateTasks.mockClear();
  h.labRunner.mockClear();
  h.speakingRunner.mockClear();
  h.labsError = null;
  h.tasksError = null;
  h.labs = [
    lab(1, 'ES1 Lab semana01'),
    lab(41, 'Examen U3 · Escucha · Forma A', exam('U3')),
    lab(42, 'Examen U3 · Escucha · Forma B', exam('U3')),
    lab(51, 'Examen U2 · Escucha · Forma A', exam('U2', u2Start)),
    lab(52, 'Examen U2 · Escucha · Forma B', exam('U2', u2Start)),
  ];
  h.tasks = [
    task(1, 'Cuento semana 3'),
    task(7, 'Examen U3 · Expresión oral', { examSet: 'U3' }),
    task(8, 'Examen U2 · Expresión oral', { examSet: 'U2', submittedAt: TURNED_IN, attempts: 1, littleSpeech: true }),
  ];
});

describe('Tests: the list', () => {
  it('asks for the exam labs, and lists one card per set in natural order', () => {
    renderAt();
    expect(h.labsInput).toHaveBeenCalledWith({ exams: true });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tests');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Test U2', 'Test U3']);
  });

  it('never shows a practice lab or task', () => {
    renderAt();
    expect(screen.queryByText('ES1 Lab semana01')).toBeNull();
    expect(screen.queryByText('Cuento semana 3')).toBeNull();
  });

  it('a set not started has the rule and Start on each form', () => {
    renderAt();
    const listening = part(setCard('Test U3'), 'Listening');
    expect(listening).toHaveTextContent('Open only the form printed on your paper. You can start one form of each test, once.');
    expect(within(listening).getByRole('button', { name: 'Start: Examen U3 · Escucha · Forma A' })).toBeInTheDocument();
    expect(within(listening).getByRole('button', { name: 'Start: Examen U3 · Escucha · Forma B' })).toBeInTheDocument();
    expect(listening).not.toHaveTextContent('You started');
  });

  it('a started set says which form and when, that it was turned in, and to ask the teacher, with no Start', () => {
    renderAt();
    const listening = part(setCard('Test U2'), 'Listening');
    expect(listening).toHaveTextContent(`You started Examen U2 · Escucha · Forma A on ${new Date(STARTED_AT).toLocaleDateString('en')}.`);
    expect(listening).toHaveTextContent('Turned in.');
    expect(listening).toHaveTextContent('To start again, ask your teacher.');
    expect(within(listening).queryByRole('button')).toBeNull();
    // Both forms are still listed, so the student sees the set.
    expect(listening).toHaveTextContent('Examen U2 · Escucha · Forma B');
  });

  it('a start not turned in does not say "Turned in."', () => {
    h.labs = [lab(41, 'Examen U3 · Escucha · Forma A', exam('U3', { ...u2Start, labId: 41, title: 'Examen U3 · Escucha · Forma A', finished: false }))];
    renderAt();
    const listening = part(setCard('Test U3'), 'Listening');
    expect(listening).toHaveTextContent('You started Examen U3 · Escucha · Forma A');
    expect(listening).not.toHaveTextContent('Turned in.');
    expect(listening).toHaveTextContent('To start again, ask your teacher.');
  });

  it('the teacher always has Start (previews are not limited)', () => {
    h.labs = [lab(41, 'Examen U3 · Escucha · Forma A', exam('U3', null, true))];
    renderAt();
    expect(screen.getByRole('button', { name: 'Start: Examen U3 · Escucha · Forma A' })).toBeInTheDocument();
  });

  it('lists the speaking tests as the Speaking page does: to do with Start, turned in with Open and the quiet nudge', () => {
    renderAt();
    const todo = part(setCard('Test U3'), 'Speaking');
    expect(todo).toHaveTextContent('Examen U3 · Expresión oral');
    expect(todo).toHaveTextContent('Not done yet');
    expect(within(todo).getByRole('button', { name: 'Start: Examen U3 · Expresión oral' })).toHaveClass('bg-blue-600');

    const done = part(setCard('Test U2'), 'Speaking');
    expect(done).toHaveTextContent(`Turned in ${TURNED_IN.toLocaleDateString('en')}`);
    expect(done).toHaveTextContent('· We could hardly hear you. Record it again, closer to the microphone.');
    expect(within(done).getByRole('button', { name: 'Open: Examen U2 · Expresión oral' })).toHaveClass('bg-gray-100');
  });

  it('a set with only a speaking test has no listening part, and one with only forms no speaking part', () => {
    h.labs = [lab(41, 'Examen U3 · Escucha · Forma A', exam('U3'))];
    h.tasks = [task(7, 'Examen U2 · Expresión oral', { examSet: 'U2' })];
    renderAt();
    const u2 = setCard('Test U2');
    expect(within(u2).queryByRole('heading', { name: 'Listening' })).toBeNull();
    expect(u2).not.toHaveTextContent('Open only the form');
    expect(within(u2).getByRole('heading', { name: 'Speaking' })).toBeInTheDocument();
    expect(within(setCard('Test U3')).queryByRole('heading', { name: 'Speaking' })).toBeNull();
  });

  it('groups a set whatever the case of its name, under a lab’s spelling', () => {
    h.tasks = [task(7, 'Examen U3 · Expresión oral', { examSet: 'u3' })];
    renderAt();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Test U2', 'Test U3']);
    expect(part(setCard('Test U3'), 'Speaking')).toHaveTextContent('Examen U3 · Expresión oral');
  });

  it('says nothing is open when there are only practice items', () => {
    h.labs = [lab(1, 'ES1 Lab semana01')];
    h.tasks = [task(1, 'Cuento semana 3')];
    renderAt();
    expect(screen.getByText('No tests are open for you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('a list that could not load says so, with Retry, instead of saying there are no tests', () => {
    h.tasks = undefined;
    h.tasksError = new Error('Failed to fetch');
    renderAt();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your tests. Check your connection and try again.');
    expect(screen.queryByText('No tests are open for you right now.')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(h.refetchLabs).toHaveBeenCalled();
    expect(h.refetchTasks).toHaveBeenCalled();
  });
});

describe('Tests: opening an item in its own runner', () => {
  it('Start on a form opens the lab runner here, from the Tests page, and its way back comes back here', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Start: Examen U3 · Escucha · Forma A' }));
    expect(where()).toBe('/tests?lab=41');
    const props = h.labRunner.mock.lastCall![0] as { labId: number; fromTests: boolean; onExit: (test: boolean) => void };
    expect(props).toMatchObject({ labId: 41, fromTests: true });
    expect(h.speakingRunner).not.toHaveBeenCalled();
    // The lists wait while a runner is open.
    expect(h.labsOptions).toHaveBeenLastCalledWith({ enabled: false });

    act(() => props.onExit(true));
    expect(where()).toBe('/tests');
    expect(h.invalidateLabs).toHaveBeenCalled();
    expect(h.invalidateTasks).toHaveBeenCalled();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Test U2', 'Test U3']);
  });

  it('Start on a speaking test opens the speaking runner here, and its way back comes back here', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Start: Examen U3 · Expresión oral' }));
    expect(where()).toBe('/tests?task=7');
    const props = h.speakingRunner.mock.lastCall![0] as { taskId: number; fromTests: boolean; onExit: (test: boolean) => void };
    expect(props).toMatchObject({ taskId: 7, fromTests: true });
    expect(h.labRunner).not.toHaveBeenCalled();

    act(() => props.onExit(true));
    expect(where()).toBe('/tests');
  });

  it('comes back here even for an item that turned practice meanwhile', () => {
    renderAt('/tests?task=1');
    const props = h.speakingRunner.mock.lastCall![0] as { onExit: (test: boolean) => void };
    act(() => props.onExit(false));
    expect(where()).toBe('/tests');
  });

  it('a direct link opens the same runner', () => {
    renderAt('/tests?lab=42');
    expect(h.labRunner.mock.lastCall![0]).toMatchObject({ labId: 42, fromTests: true });
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});
