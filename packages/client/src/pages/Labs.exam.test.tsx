// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's Labs page with exam labs (v1.21.0): tests are listed on the
 * Tests page, not here. This page lists the practice labs as before v1.19.0,
 * points to the Tests page when there are tests, and sends a test opened here
 * by a direct link back there.
 */
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Labs from './Labs';

const h = vi.hoisted(() => ({ labs: [] as unknown[], listInput: vi.fn(), runner: vi.fn() }));

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ labs: { list: { invalidate: async () => {} } } }),
    labs: {
      list: {
        useQuery: (input: unknown) => {
          h.listInput(input);
          return { data: h.labs, isLoading: false };
        },
      },
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Ana' }, isAdmin: false, logout: () => {} }),
}));
vi.mock('../components/labs/LabRunner', () => ({ default: (props: unknown) => { h.runner(props); return null; } }));

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

const STARTED_AT = new Date('2026-10-08T16:05:00Z').getTime();

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}
const renderAt = (url = '/labs') => render(<MemoryRouter initialEntries={[url]}><Labs /><Where /></MemoryRouter>);
const where = () => screen.getByTestId('where').textContent;

describe('Labs: tests are not listed here', () => {
  beforeEach(() => {
    h.listInput.mockClear();
    h.runner.mockClear();
    h.labs = [
      lab(1, 'ES1 Lab semana01', { status: 'done', submittedAt: new Date('2026-09-20T17:00:00Z'), attempts: 1 }),
      lab(2, 'ES1 Lab semana02'),
      lab(41, 'Examen U3 · Escucha · Forma A', exam('U3')),
      lab(42, 'Examen U3 · Escucha · Forma B', exam('U3')),
      lab(51, 'Examen U2 · Escucha · Forma A', exam('U2', { labId: 51, title: 'Examen U2 · Escucha · Forma A', startedAt: STARTED_AT, finished: true })),
    ];
  });

  it('lists the practice labs as before, with no test and no Tests section', () => {
    renderAt();
    expect(h.listInput).toHaveBeenCalledWith({ exams: true });
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText(/Examen/)).toBeNull();
    expect(screen.queryByText(/Open only the form/)).toBeNull();
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Labs', 'ES1 Lab semana01', 'ES1 Lab semana02']);
    expect(screen.getByRole('heading', { name: 'ES1 Lab semana01' }).closest('li')).toHaveTextContent('Submitted');
    expect(screen.getByRole('heading', { name: 'ES1 Lab semana02' }).closest('li')).toHaveTextContent('Not done yet');
  });

  it('points to the Tests page when there are tests, above the list', () => {
    renderAt();
    const link = screen.getByRole('link', { name: 'Go to Tests' });
    expect(link).toHaveAttribute('href', '/tests');
    expect(link.closest('p')).toHaveTextContent('Looking for a test? Go to Tests');
    const list = screen.getByRole('heading', { name: 'ES1 Lab semana01' }).closest('ul')!;
    expect(link.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with only tests: the pointer, and that no lab is open', () => {
    h.labs = [lab(41, 'Examen U3 · Escucha · Forma A', exam('U3'))];
    renderAt();
    expect(screen.getByRole('link', { name: 'Go to Tests' })).toHaveAttribute('href', '/tests');
    expect(screen.getByText('No labs are open for you right now.')).toBeInTheDocument();
    expect(screen.queryByText(/Examen/)).toBeNull();
  });

  it('with no tests, no pointer: the practice list as it always was', () => {
    h.labs = [lab(2, 'ES1 Lab semana02')];
    renderAt();
    expect(screen.queryByRole('link', { name: 'Go to Tests' })).toBeNull();
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Labs', 'ES1 Lab semana02']);
  });

  it('says nothing is open when there are neither labs nor tests', () => {
    h.labs = [];
    renderAt();
    expect(screen.getByText('No labs are open for you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to Tests' })).toBeNull();
  });

  it('a test opened here by a direct link goes back to the Tests page', () => {
    renderAt('/labs?lab=41');
    const { onExit } = h.runner.mock.lastCall![0] as { onExit: (test: boolean) => void };
    act(() => onExit(true));
    expect(where()).toBe('/tests');
  });

  it('a practice lab goes back to the labs', () => {
    renderAt('/labs?lab=2');
    const props = h.runner.mock.lastCall![0] as { labId: number; fromTests?: boolean; onExit: (test: boolean) => void };
    expect(props.labId).toBe(2);
    expect(props.fromTests).toBeUndefined();
    act(() => props.onExit(false));
    expect(where()).toBe('/labs');
    expect(screen.getByRole('heading', { name: 'ES1 Lab semana02' })).toBeInTheDocument();
  });
});
