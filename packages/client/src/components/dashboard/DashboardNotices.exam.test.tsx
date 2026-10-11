// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The front page's Tests notice (v1.21.0, replacing v1.19.0's "Listening
 * tests"): amber, before Audio labs, linking to the Tests page, counting each
 * set whose listening part is not started plus each speaking test not turned
 * in. Audio labs and Speaking count the practice labs and tasks only.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardNotices } from './DashboardNotices';
import { NOTICES_FOLDED_KEY } from './noticesFold';
import { useDashboardNotices } from './useDashboardNotices';

const h = vi.hoisted(() => ({ labs: undefined as unknown, tasks: undefined as unknown, listInput: vi.fn() }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    vocab: { listOpenTests: { useQuery: () => ({ data: [] }) } },
    labs: {
      list: {
        useQuery: (input: unknown) => {
          h.listInput(input);
          return { data: h.labs };
        },
      },
    },
    speaking: { list: { useQuery: () => ({ data: h.tasks }) } },
    signups: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

const lab = (id: number, status: string, extra: Record<string, unknown> = {}) => ({ id, title: `Lab ${id}`, status, submittedAt: null, ...extra });
const start = { labId: 51, title: 'Examen U2 · Forma A', startedAt: 1_790_000_000_000, finished: true };
const exam = (set: string, started = false) => ({ exam: { set, preview: false, start: started ? start : null } });
const task = (id: number, examSet: string | null, done = false) => ({
  id, title: `Tarea ${id}`, targetSeconds: null, submittedAt: done ? new Date('2026-10-08T16:00:00Z') : null, attempts: done ? 1 : 0, littleSpeech: false, examSet,
});

function Notices() {
  return <DashboardNotices notices={useDashboardNotices(false)} />;
}
const renderNotices = () => render(<MemoryRouter><Notices /></MemoryRouter>);

beforeEach(() => {
  window.localStorage.clear();
  h.listInput.mockClear();
  h.labs = [
    lab(1, 'todo'),
    lab(2, 'done'),
    // Two forms of U3, not started; U2 started (on both forms); U4 not started.
    lab(41, 'todo', exam('U3')),
    lab(42, 'todo', exam('U3')),
    lab(51, 'todo', exam('U2', true)),
    lab(52, 'todo', exam('U2', true)),
    lab(61, 'todo', exam('U4')),
  ];
  h.tasks = [
    task(1, null),
    task(2, null, true),
    // A speaking test of U2 not turned in, and one of U3 turned in.
    task(7, 'U2'),
    task(8, 'U3', true),
  ];
});

describe('the Tests notice', () => {
  it('asks for the exam labs, and shows Tests before Audio labs and Speaking, linking to the Tests page', () => {
    renderNotices();
    expect(h.listInput).toHaveBeenCalledWith({ exams: true });
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Tests', 'Audio labs', 'Speaking']);
    const tests = screen.getByRole('link', { name: /Tests/ });
    expect(tests).toHaveAttribute('href', '/tests');
    // U3 and U4 not started, and U2's speaking test not turned in.
    expect(tests).toHaveTextContent('3 test(s) to take');
    expect(tests).toHaveTextContent('Start');
    expect(tests).toHaveClass('border-amber-600');
    // Audio labs and Speaking count the practice ones only: one to do of two each.
    expect(screen.getByRole('link', { name: /Audio labs/ })).toHaveTextContent('1 lab(s) to do');
    expect(screen.getByRole('link', { name: /Speaking/ })).toHaveTextContent('1 recording(s) to do');
  });

  it('folded, its chip is amber, with the count of tests to take', () => {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, '1');
    renderNotices();
    const chips = screen.getByRole('list', { name: 'To do' });
    const links = within(chips).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Tests3', 'Audio labs1', 'Speaking1']);
    const chip = within(chips).getByRole('link', { name: 'Tests, 3 test(s) to take' });
    expect(chip).toHaveAttribute('href', '/tests');
    expect(chip).toHaveClass('border-amber-600');
    expect(within(chip).getByText('3')).toHaveClass('bg-amber-800');
  });

  it('says the tests are started once every set is and every speaking test is turned in, with a done mark when folded', () => {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, '1');
    h.labs = [lab(51, 'todo', exam('U2', true)), lab(52, 'todo', exam('U2', true))];
    h.tasks = [task(8, 'U2', true)];
    renderNotices();
    expect(screen.getByRole('link', { name: 'Tests, Tests started' })).toHaveTextContent('✓');
  });

  it('counts a set with only a speaking test', () => {
    h.labs = [];
    h.tasks = [task(7, 'U2')];
    renderNotices();
    expect(screen.getByRole('link', { name: /Tests/ })).toHaveTextContent('1 test(s) to take');
  });

  it('with only tests, shows no Audio labs and no Speaking notice', () => {
    h.labs = [lab(41, 'todo', exam('U3'))];
    h.tasks = [task(7, 'U3')];
    renderNotices();
    expect(screen.getByRole('link', { name: /Tests/ })).toHaveTextContent('2 test(s) to take');
    expect(screen.queryByRole('link', { name: /Audio labs/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Speaking/ })).toBeNull();
  });

  it('with no tests, shows no Tests notice, and Audio labs and Speaking as before', () => {
    h.labs = [lab(1, 'todo'), lab(2, 'redo'), lab(3, 'check')];
    // A list cached before v1.21.0 has no examSet: every task is practice.
    h.tasks = [{ ...task(1, null), examSet: undefined }, task(2, null)];
    renderNotices();
    expect(screen.queryByRole('link', { name: /Tests/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Audio labs/ })).toHaveTextContent('2 lab(s) to do');
    expect(screen.getByRole('link', { name: /Speaking/ })).toHaveTextContent('2 recording(s) to do');
  });
});
