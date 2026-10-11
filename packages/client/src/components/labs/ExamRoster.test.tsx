// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * An exam set's students and resets (v1.19.0): each student's one start (form,
 * when, how far, turned in, resets) with their earlier, reset plays kept under
 * them, and a Reset that asks first, gives exactly one more start and refreshes
 * the lists.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExamRoster from './ExamRoster';

const h = vi.hoisted(() => ({
  roster: undefined as unknown,
  rosterArgs: [] as unknown[][],
  reset: vi.fn(),
  invalidated: [] as string[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      labs: {
        examRoster: { invalidate: async () => { h.invalidated.push('examRoster'); } },
        examSets: { invalidate: async () => { h.invalidated.push('examSets'); } },
        adminList: { invalidate: async () => { h.invalidated.push('adminList'); } },
      },
    }),
    labs: {
      examRoster: {
        useQuery: (...args: unknown[]) => {
          h.rosterArgs.push(args);
          return { data: h.roster, isLoading: false, error: null };
        },
      },
      resetExamStart: { useMutation: () => ({ mutateAsync: h.reset, isPending: false }) },
    },
  },
}));

const T = (iso: string) => new Date(iso).getTime();
const view = (overrides: Record<string, unknown>) => ({
  startId: 1,
  labId: 41,
  labTitle: 'Examen U3 · Forma A',
  source: 'start',
  startedAt: T('2026-10-08T16:05:00Z'),
  heardThroughMs: 47_000,
  durationMs: 100_000,
  requiredThroughMs: 95_000,
  finished: false,
  lastSeenAt: T('2026-10-08T16:06:00Z'),
  resetAt: null,
  resetByName: null,
  ...overrides,
});

const student = (userId: number, name: string, overrides: Record<string, unknown> = {}) => ({
  userId, name, email: `${name.toLowerCase().replace(/ /g, '.')}@students.school.test`, assigned: true, current: null, earlier: [], ...overrides,
});

beforeEach(() => {
  h.rosterArgs.length = 0;
  h.invalidated.length = 0;
  h.reset.mockReset().mockResolvedValue({ startId: 11, userId: 2, examSet: 'U3', resetAt: T('2026-10-08T17:00:00Z') });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  h.roster = {
    examSet: 'U3',
    labs: [{ id: 41, title: 'Examen U3 · Forma A', active: true, durationMs: 100_000, requiredThroughMs: 95_000 }],
    students: [
      student(2, 'Ana López', {
        current: view({ startId: 11 }),
        earlier: [view({
          startId: 5, labTitle: 'Examen U3 · Forma B', labId: 42, heardThroughMs: 12_000,
          startedAt: T('2026-10-07T16:00:00Z'), resetAt: T('2026-10-07T16:30:00Z'), resetByName: 'Teacher Example',
        })],
      }),
      student(3, 'Ben Ruiz', { current: view({ startId: 12, finished: true, heardThroughMs: 100_000, source: 'past' }) }),
      student(4, 'Cris Vega'),
      student(5, 'Dani Paz', { assigned: false, current: view({ startId: 13, labId: null, labTitle: 'Examen U3 · Forma C', heardThroughMs: null, durationMs: null }) }),
    ],
  };
});

const rowOf = (name: string) => screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;
/** A student's row and, under it, their earlier plays. */
const bodyOf = (name: string) => rowOf(name).closest('tbody')!;

describe('ExamRoster', () => {
  it('lists each student’s start: form, when, how far, turned in and resets, with the earlier play kept', () => {
    render(<ExamRoster examSet="U3" onBack={() => {}} />);
    expect(h.rosterArgs[0]).toEqual([{ examSet: 'U3' }, { refetchInterval: 15_000 }]);
    expect(screen.getByRole('heading', { name: 'Exam set U3' })).toBeInTheDocument();
    expect(screen.getByText(/One start per student across this set's forms/)).toBeInTheDocument();

    const ana = rowOf('Ana López');
    const cells = within(ana).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('Examen U3 · Forma A');
    expect(cells[1]).toBe(new Date(T('2026-10-08T16:05:00Z')).toLocaleString());
    expect(cells[2]).toBe('0:47 of 1:40');
    expect(cells[3]).toBe('No');
    expect(cells[4]).toBe('1');
    expect(ana).not.toHaveTextContent('Earlier');
    expect(bodyOf('Ana López')).toHaveTextContent(
      `Earlier: Examen U3 · Forma B · ${new Date(T('2026-10-07T16:00:00Z')).toLocaleString()} · reached 0:12 · `
      + `reset ${new Date(T('2026-10-07T16:30:00Z')).toLocaleString()} by Teacher Example`,
    );

    const ben = rowOf('Ben Ruiz');
    expect(within(ben).getAllByRole('cell')[3]).toHaveTextContent('Yes');
    expect(ben).toHaveTextContent('counted from a practice play, or one in another set');

    expect(bodyOf('Ben Ruiz')).not.toHaveTextContent('Earlier');
    const cris = rowOf('Cris Vega');
    expect(cris).toHaveTextContent('Not started');
    expect(within(cris).queryByRole('button')).toBeNull();

    const dani = rowOf('Dani Paz');
    expect(dani).toHaveTextContent('lab deleted');
    expect(dani).toHaveTextContent("not in the set's groups now");
    expect(within(dani).getAllByRole('cell')[2]).toHaveTextContent('—');
  });

  it('offers Reset only for a student with a live start', () => {
    render(<ExamRoster examSet="U3" />);
    expect(screen.getAllByRole('button', { name: /^Reset: / }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Reset: Ana López', 'Reset: Ben Ruiz', 'Reset: Dani Paz']);
  });

  it('asks first, and does nothing when the teacher cancels', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ExamRoster examSet="U3" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset: Ana López' }));
    expect(window.confirm).toHaveBeenCalledWith('Give Ana López one more start in U3? Their earlier play stays in the record.');
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('resets that start once confirmed, and refreshes the set’s lists', async () => {
    render(<ExamRoster examSet="U3" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset: Ana López' }));
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset).toHaveBeenCalledWith({ startId: 11 });
    expect(h.invalidated).toEqual(expect.arrayContaining(['examRoster', 'examSets', 'adminList']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the start was already reset (a second click, or a list out of date)', async () => {
    h.reset.mockRejectedValue(Object.assign(new Error('This start was already reset. Reload the list.'), { data: { code: 'CONFLICT', appCode: 'EXAM_ALREADY_RESET' } }));
    render(<ExamRoster examSet="U3" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset: Ben Ruiz' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This start was already reset. Reload the list.');
    expect(h.invalidated).toContain('examRoster');
  });

  it('in a form’s Review page: only that form, with a link to the whole set', async () => {
    const onOpenSet = vi.fn();
    render(<ExamRoster examSet="U3" labId={41} onOpenSet={onOpenSet} />);
    expect(h.rosterArgs[0]).toEqual([{ examSet: 'U3', labId: 41 }, { refetchInterval: 15_000 }]);
    expect(screen.getByRole('heading', { name: 'Starts on this form' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to labs' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All students in U3' }));
    expect(onOpenSet).toHaveBeenCalledWith('U3');
  });

  it('says when nobody is in the set, or nobody started the form', () => {
    h.roster = { examSet: 'U3', labs: [], students: [] };
    const { unmount } = render(<ExamRoster examSet="U3" />);
    expect(screen.getByText('No students are assigned to this set.')).toBeInTheDocument();
    unmount();
    render(<ExamRoster examSet="U3" labId={41} />);
    expect(screen.getByText('Nobody has started this form yet.')).toBeInTheDocument();
  });
});
