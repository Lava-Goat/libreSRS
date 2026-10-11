// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as renderUi, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry, type RouteProps } from 'react-router-dom';
import AdminDashboard, { USER_ACTIVITY_STORAGE_KEY } from './AdminDashboard';

const h = vi.hoisted(() => ({ userStats: [] as unknown[] }));

// Mock trpc
vi.mock('../api/trpc', () => ({
  trpc: {
    admin: {
      getUserStats: { useQuery: () => ({ data: h.userStats }) },
      getGroups: { useQuery: () => ({ data: [] }) },
      getDecks: { useQuery: () => ({ data: [] }) },
      exportUserProgress: { useQuery: () => ({ data: null, isFetching: false, refetch: vi.fn() }) },
    },
  },
}));

// Mock i18n
vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/{{(\w+)}}/g, (_, name: string) => String(params?.[name] ?? '')),
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
}));

// Mock env utils
vi.mock('../utils/env', () => ({
  isDev: vi.fn(),
}));

import { isDev } from '../utils/env';

/** Where a user's name leads, as a page that says where it is. */
function UserPageProbe() {
  const location = useLocation();
  return <p>User page {location.pathname}{location.search}</p>;
}

/** The dashboard in a router (its names are links), at /admin unless told otherwise. */
function render(ui: RouteProps['element'], entry: InitialEntry = '/admin') {
  return renderUi(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={ui} />
        <Route path="/admin/users/:userId" element={<UserPageProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminDashboard Version Display', () => {
  beforeEach(() => {
    // Reset globals before each test
    (globalThis as any).__BUILD_VERSION__ = 'v0.10.0';
    (globalThis as any).__BUILD_COMMIT__ = 'abcdef1';
    vi.mocked(isDev).mockReset();
  });

  it('displays Git build hash in development mode', () => {
    // Mock DEV = true
    vi.mocked(isDev).mockReturnValue(true);
    
    render(<AdminDashboard />);
    
    expect(screen.getByText('Git build:')).toBeInTheDocument();
    expect(screen.getByText('abcdef1')).toBeInTheDocument();
    expect(screen.queryByText('Version:')).not.toBeInTheDocument();
  });

  it('displays Version in production mode', () => {
    // Mock DEV = false
    vi.mocked(isDev).mockReturnValue(false);

    render(<AdminDashboard />);
    
    expect(screen.getByText('Version:')).toBeInTheDocument();
    expect(screen.getByText('v0.10.0')).toBeInTheDocument();
    expect(screen.queryByText('Git build:')).not.toBeInTheDocument();
  });
});

describe('AdminDashboard retention', () => {
  beforeEach(() => {
    vi.mocked(isDev).mockReturnValue(true);
  });

  const stat = (userId: number, role: 'admin' | 'user', totalReviews: number, correctReviews: number) => ({
    userId, userName: `User ${userId}`, email: `u${userId}@example.com`, role, totalReviews, correctReviews,
    totalTimeMs: 0, retentionRate: totalReviews > 0 ? correctReviews / totalReviews : 0, lastActive: null,
  });

  it('pools right answers over students with reviews, leaving out the teacher', () => {
    // A mean of rates would say (100% + 50% + 0% + 90%) / 4 = 60%; pooled over students it is 72%.
    h.userStats = [
      stat(1, 'admin', 2, 2),
      stat(2, 'user', 100, 50),
      stat(3, 'user', 0, 0),
      stat(4, 'user', 150, 130),
    ];
    render(<AdminDashboard />);
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Students with reviews')).toBeInTheDocument();
  });

  it('shows a dash, not 0%, for a user with no reviews and when no student has any', () => {
    h.userStats = [stat(1, 'admin', 10, 10), stat(3, 'user', 0, 0)];
    render(<AdminDashboard />);
    const row = screen.getByText('User 3').closest('tr')!;
    expect(row).toHaveTextContent('—');
    expect(row).not.toHaveTextContent('0%');
    // The teacher's 100% is not the class's retention.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('reads an older server without correctReviews from its rate', () => {
    h.userStats = [{ ...stat(2, 'user', 10, 0), correctReviews: undefined, retentionRate: 0.8 }];
    render(<AdminDashboard />);
    expect(screen.getAllByText('80%')).toHaveLength(2);
  });
});

describe('AdminDashboard User Activity: search, sort, pages and a way to each user', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 15)).toISOString();
  /** Student n: n reviews, n minutes, last active on day n; every tenth never studied; user 1 is the teacher. */
  const student = (n: number) => ({
    userId: n,
    userName: n === 1 ? 'Teacher' : `Student ${String(n).padStart(2, '0')}`,
    email: n === 1 ? 'teacher@school.test' : `${20000 + n}@students.school.test`,
    role: n === 1 ? 'admin' : 'user',
    totalReviews: n % 10 === 0 ? 0 : n,
    totalTimeMs: n % 10 === 0 ? 0 : n * 60_000,
    correctReviews: n % 10 === 0 ? 0 : Math.floor(n / 2),
    retentionRate: n % 10 === 0 ? 0 : Math.floor(n / 2) / n,
    lastActive: n % 10 === 0 ? null : day(n),
  });

  beforeEach(() => {
    vi.mocked(isDev).mockReturnValue(true);
    window.localStorage.clear();
    h.userStats = Array.from({ length: 30 }, (_, i) => student(i + 1));
  });

  const table = () => screen.getByRole('region', { name: 'User Activity' });
  const names = () => within(table()).getAllByRole('link').map((link) => link.textContent);
  const header = (name: string) => within(table()).getByRole('button', { name }).closest('th')!;
  /** The page-size select, named by the words on both sides of it. */
  const pageSize = () => screen.getByRole('combobox', { name: 'Show per page' });

  it('shows 25 at a time, newest activity first, never-active last', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);
    expect(header('Last Active')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toHaveLength(25);
    expect(names()[0]).toBe('Student 29');
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
    // The three who never studied, by name.
    expect(names().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
    expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  it('searches names, emails and school IDs, from the first page', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const search = screen.getByLabelText('Search users');
    await user.type(search, 'student 1');
    expect(names()).toEqual(['Student 19', 'Student 18', 'Student 17', 'Student 16', 'Student 15', 'Student 14', 'Student 13', 'Student 12', 'Student 11', 'Student 10']);
    expect(screen.getByText('1–10 of 10')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '20007');
    expect(names()).toEqual(['Student 07']);
    await user.clear(search);
    await user.type(search, 'TEACHER@');
    expect(names()).toEqual(['Teacher']);
    await user.clear(search);
    await user.type(search, 'nobody');
    expect(within(table()).queryAllByRole('link')).toEqual([]);
    // Said in the table, where the rows would be; and announced by the pager.
    expect(within(screen.getByRole('table', { name: 'User Activity' })).getByRole('cell', { name: 'No users match' })).toHaveAttribute('colspan', '5');
    const status = screen.getAllByText('No users match').find((el) => el.tagName === 'P')!;
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('sr-only');
  });

  it('finds a school ID the teacher typed, for a student whose email has no digits', async () => {
    h.userStats = [
      { ...student(2), userName: 'Beto', email: 'beto@example.com', studentNumber: '98765' },
      { ...student(3), studentNumber: '20003' },
    ];
    const user = userEvent.setup();
    render(<AdminDashboard />);
    await user.type(screen.getByLabelText('Search users'), '9876');
    expect(names()).toEqual(['Beto']);
  });

  it('says there are no users yet, rather than that none match, when there are none', () => {
    h.userStats = [];
    render(<AdminDashboard />);
    expect(within(screen.getByRole('table', { name: 'User Activity' })).getByRole('cell', { name: 'No users yet' })).toBeInTheDocument();
    expect(screen.queryByText('No users match')).not.toBeInTheDocument();
  });

  it('sorts by each column header, saying so with aria-sort', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);
    await user.selectOptions(pageSize(), 'all');

    await user.click(screen.getByRole('button', { name: 'User' }));
    expect(header('User')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Last Active')).not.toHaveAttribute('aria-sort');
    expect(names()[0]).toBe('Student 02');
    expect(names()[29]).toBe('Teacher');
    await user.click(screen.getByRole('button', { name: 'User' }));
    expect(header('User')).toHaveAttribute('aria-sort', 'descending');
    expect(names()[0]).toBe('Teacher');

    await user.click(screen.getByRole('button', { name: 'Reviews' }));
    expect(header('Reviews')).toHaveAttribute('aria-sort', 'descending');
    expect(names()[0]).toBe('Student 29');

    await user.click(screen.getByRole('button', { name: 'Time' }));
    expect(names()[0]).toBe('Student 29');
    await user.click(screen.getByRole('button', { name: 'Time' }));
    expect(header('Time')).toHaveAttribute('aria-sort', 'ascending');
    // No time is 0 minutes: it sorts first going up.
    expect(names().slice(0, 3)).toEqual(['Student 10', 'Student 20', 'Student 30']);

    // No reviews is no retention: last whichever way.
    await user.click(screen.getByRole('button', { name: 'Retention' }));
    expect(header('Retention')).toHaveAttribute('aria-sort', 'descending');
    expect(names().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
    await user.click(screen.getByRole('button', { name: 'Retention' }));
    expect(header('Retention')).toHaveAttribute('aria-sort', 'ascending');
    expect(names()[0]).toBe('Teacher');
    expect(names().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);

    await user.click(screen.getByRole('button', { name: 'Last Active' }));
    await user.click(screen.getByRole('button', { name: 'Last Active' }));
    expect(header('Last Active')).toHaveAttribute('aria-sort', 'ascending');
    expect(names()[0]).toBe('Teacher');
    expect(names().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
  });

  it('shows 10 a page when asked, and remembers the size and sort after it is closed', async () => {
    const user = userEvent.setup();
    const first = render(<AdminDashboard />);
    await user.selectOptions(pageSize(), '10');
    expect(names()).toHaveLength(10);
    expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'User' }));
    await user.type(screen.getByLabelText('Search users'), 'student');
    expect(JSON.parse(window.localStorage.getItem(USER_ACTIVITY_STORAGE_KEY)!)).toEqual({ pageSize: 10, sort: 'name', dir: 'asc' });
    first.unmount();

    render(<AdminDashboard />);
    expect(pageSize()).toHaveValue('10');
    expect(names()).toHaveLength(10);
    expect(header('User')).toHaveAttribute('aria-sort', 'ascending');
    // The search is not remembered.
    expect(screen.getByLabelText('Search users')).toHaveValue('');
    expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
  });

  it('opens a user\'s page from their name, a real link that says where the teacher came from', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);
    const link = screen.getByRole('link', { name: 'Student 29' });
    expect(link).toHaveAttribute('href', '/admin/users/29?from=dashboard');
    expect(within(link.closest('tr')!).queryByText('Admin')).not.toBeInTheDocument();

    // The search and page go along, for Back.
    await user.type(screen.getByLabelText('Search users'), 'school');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The teacher is marked as one, as on the Users tab.
    expect(within(screen.getByRole('link', { name: 'Teacher' }).closest('tr')!).getByText('Admin')).toBeInTheDocument();
    const last = screen.getByRole('link', { name: 'Student 30' });
    expect(last).toHaveAttribute('href', '/admin/users/30?from=dashboard&q=school&page=2');
    await user.click(last);
    expect(screen.getByText('User page /admin/users/30?from=dashboard&q=school&page=2')).toBeInTheDocument();
  });

  it('opens a user\'s page from anywhere on their row, but not a click meant for a new tab', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard />);
    const row = screen.getByRole('link', { name: 'Student 28' }).closest('tr')!;
    await user.keyboard('{Control>}');
    await user.click(within(row).getByText('28m'));
    await user.keyboard('{/Control}');
    expect(screen.queryByText(/^User page/)).not.toBeInTheDocument();
    await user.click(within(row).getByText('28m'));
    expect(screen.getByText('User page /admin/users/28?from=dashboard')).toBeInTheDocument();
  });

  it('puts focus back on the name the teacher came back from, once', () => {
    const onReturnFocusDone = vi.fn();
    render(<AdminDashboard returnFocusUserId={7} onReturnFocusDone={onReturnFocusDone} />);
    expect(screen.getByRole('link', { name: 'Student 07' })).toHaveFocus();
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });

  it('shows the page that holds that name first, when the list has moved it', () => {
    const onReturnFocusDone = vi.fn();
    // At 10 a page, newest first, Student 03 is on page 3; the panel opens on page 1 (a reload, say).
    window.localStorage.setItem(USER_ACTIVITY_STORAGE_KEY, JSON.stringify({ pageSize: 10 }));
    render(<AdminDashboard returnFocusUserId={3} onReturnFocusDone={onReturnFocusDone} />);
    expect(screen.getByText('21–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 03' })).toHaveFocus();
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });

  it('leaves focus alone without a name to return to', () => {
    render(<AdminDashboard />);
    expect(document.body).toHaveFocus();
  });

  it('keeps the search and page where the admin page asks', async () => {
    const user = userEvent.setup();
    const onActivityViewChange = vi.fn();
    render(<AdminDashboard activityView={{ search: 'student', page: 2 }} onActivityViewChange={onActivityViewChange} />);
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    expect(screen.getByText('26–29 of 29')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onActivityViewChange).toHaveBeenLastCalledWith({ search: 'student', page: 1 });
  });
});
