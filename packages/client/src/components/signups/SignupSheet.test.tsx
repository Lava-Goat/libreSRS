// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupSheet from './SignupSheet';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  sheet: null as unknown,
  error: null as unknown,
  claim: vi.fn(),
  release: vi.fn(),
  invalidate: vi.fn(async () => {}),
  isAdmin: false,
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ signups: { get: { invalidate: h.invalidate }, list: { invalidate: h.invalidate } } }),
    signups: {
      get: { useQuery: () => ({ data: h.sheet, isLoading: false, error: h.error, refetch: vi.fn(), isFetching: false }) },
      claim: { useMutation: () => ({ mutate: h.claim, isPending: false }) },
      release: { useMutation: () => ({ mutate: h.release, isPending: false }) },
    },
  },
}));

type Day = {
  id: number; date: string; label: string | null; capacity: number; taken: number; locked: boolean;
  mine: boolean; assigned: boolean; people: { you: boolean; name: string | null }[];
};
const day = (overrides: Partial<Day> & { id: number; date: string }): Day => ({
  label: null, capacity: 2, taken: 0, locked: false, mine: false, assigned: false, people: [], ...overrides,
});
const sheet = (dates: Day[], overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Show and tell',
  description: 'Pick two days.',
  open: true,
  picksPerStudent: 2,
  showNames: true,
  today: '2099-03-01',
  myCount: dates.filter((d) => d.mine).length,
  dates,
  ...overrides,
});
const rowFor = (label: string) => screen.getByText(new RegExp(label)).closest('li')!;

describe('SignupSheet', () => {
  beforeEach(() => {
    h.isAdmin = false;
    h.error = null;
    h.claim.mockClear();
    h.release.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers open days, shows who has the full ones, and picks a day', async () => {
    h.sheet = sheet([
      day({ id: 1, date: '2099-03-02', label: 'Day 31', taken: 1, people: [{ you: false, name: 'Ana R.' }] }),
      day({ id: 2, date: '2099-03-03', label: 'Day 32', taken: 2, people: [{ you: false, name: 'Ana R.' }, { you: false, name: null }] }),
    ]);
    render(<SignupSheet sheetId={1} onBack={() => {}} />);

    expect(screen.getByText('You have picked 0 of 2 day(s).')).toBeInTheDocument();
    expect(within(rowFor('Day 31')).getByText(/1 of 2 spot\(s\) open/)).toBeInTheDocument();
    expect(within(rowFor('Day 32')).getByText(/Full/).textContent).toBe('Full · Ana R., Taken');
    expect(within(rowFor('Day 32')).queryByRole('button')).toBeNull();

    await userEvent.click(within(rowFor('Day 31')).getByRole('button', { name: /Pick Monday, March 2, 2099/ }));
    expect(h.claim).toHaveBeenCalledWith({ dateId: 1 });
  });

  it('stops offering days once the student has all theirs, and lets them drop one', async () => {
    h.sheet = sheet([
      day({ id: 1, date: '2099-03-02', label: 'Day 31', mine: true, taken: 1, people: [{ you: true, name: 'Beto S.' }] }),
      day({ id: 2, date: '2099-03-03', label: 'Day 32', mine: true, taken: 1, assigned: true, people: [{ you: true, name: 'Beto S.' }] }),
      day({ id: 3, date: '2099-03-04', label: 'Day 33' }),
    ]);
    render(<SignupSheet sheetId={1} onBack={() => {}} />);

    expect(screen.getByText('You have picked 2 of 2 day(s).')).toBeInTheDocument();
    expect(within(rowFor('Day 33')).queryByRole('button')).toBeNull();
    // A day the teacher placed them on is the teacher's to change.
    expect(within(rowFor('Day 32')).queryByRole('button')).toBeNull();
    expect(within(rowFor('Day 32')).getByText('Your teacher put you on this day.')).toBeInTheDocument();

    await userEvent.click(within(rowFor('Day 31')).getByRole('button', { name: /Drop Monday, March 2, 2099/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledWith({ dateId: 1 });
  });

  it('keeps past days out of the way until asked, and a closed sheet read-only', async () => {
    h.sheet = sheet([
      day({ id: 1, date: '2000-01-03', label: 'Long ago', locked: true }),
      day({ id: 2, date: '2099-03-03', label: 'Day 32' }),
    ], { open: false });
    render(<SignupSheet sheetId={1} onBack={() => {}} />);

    expect(screen.queryByText(/Long ago/)).toBeNull();
    expect(screen.getByText('This sign-up sheet is closed. Ask your teacher to change your day.')).toBeInTheDocument();
    expect(within(rowFor('Day 32')).queryByRole('button')).toBeNull();

    await userEvent.click(screen.getByLabelText('Show past days (1)'));
    expect(within(rowFor('Long ago')).getByText(/Closed/)).toBeInTheDocument();
  });

  it('shows the teacher the student view without letting them take a spot', () => {
    h.isAdmin = true;
    h.sheet = sheet([day({ id: 1, date: '2099-03-02', label: 'Day 31' })]);
    render(<SignupSheet sheetId={1} onBack={() => {}} />);
    expect(screen.getByText(/This is the student view/)).toBeInTheDocument();
    expect(within(rowFor('Day 31')).queryByRole('button')).toBeNull();
  });

  it('says plainly when the sheet is for another class', () => {
    h.sheet = undefined;
    h.error = { data: { code: 'FORBIDDEN' } };
    render(<SignupSheet sheetId={9} onBack={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This sign-up sheet is not for your class.');
  });
});
