// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from './Admin';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  decks: [{ id: 1, name: 'Unidad 1', description: null, cardCount: 30, reversible: false }],
  logout: vi.fn(async () => {}),
  mutation: {
    mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), reset: vi.fn(),
    isPending: false, isLoading: false, isError: false, error: null as unknown, data: undefined as unknown,
  },
  /** The options each mutation was last made with, by path ("ai.saveAdminConfig"): a test can run their onSuccess. */
  mutationOptions: {} as Record<string, { onSuccess?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => unknown } | undefined>,
  /** Every query's refetch(), so a test can see one asked for and say when it lands. */
  refetch: vi.fn(async () => ({})),
  /** Every utils invalidate() called, by path ("utils.vocab.transcriptionStatus"). */
  invalidated: [] as string[],
  /** What other queries answer, by path ("admin.getUsers"). */
  data: {} as Record<string, unknown>,
  /** The real Dashboard tab, for the tests of its User Activity; a stand-in otherwise. */
  realDashboard: false,
  /** The real Groups tab, for the tests of its lists' links; a stand-in otherwise. */
  realGroups: false,
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, name: 'Teacher', role: 'admin' }, logout: h.logout }) }));

// Every procedure the Decks tab touches: queries answer nothing but the deck list.
vi.mock('../api/trpc', () => {
  const at = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_target, key: string) => {
      if (key === 'useQuery') {
        return () => ({ data: path.join('.') === 'admin.getDecks' ? h.decks : h.data[path.join('.')], refetch: h.refetch, isLoading: false, error: null });
      }
      if (key === 'useMutation') {
        return (options?: { onSuccess?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => unknown }) => {
          h.mutationOptions[path.join('.')] = options;
          return h.mutation;
        };
      }
      if (key === 'useUtils') return () => at(['utils']);
      if (key === 'invalidate') return async () => { h.invalidated.push(path.join('.')); };
      return at([...path, key]);
    },
  });
  return { trpc: at([]) };
});

// The other tabs are not the point here (but the Dashboard's User Activity leads to a user's page).
vi.mock('../components/AdminDashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/AdminDashboard')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => (h.realDashboard ? <actual.default {...props} /> : <p>Dashboard tab</p>),
  };
});
vi.mock('../components/GroupManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/GroupManager')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => (h.realGroups ? <actual.default {...props} /> : <p>Groups tab</p>),
  };
});

// The real section is tested on its own; this stand-in only reports a draft.
vi.mock('../components/conjugation/ConjugationSettings', () => ({
  default: function ConjugationStandIn({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
    return <button type="button" onClick={() => onDirtyChange?.(true)}>Edit conjugation</button>;
  },
}));

const MESSAGE = 'Leave without saving? Your unsaved Conjugation changes will be lost.';

// The page keeps its tab for a reload in sessionStorage: no test may inherit another's.
beforeEach(() => { window.sessionStorage.clear(); h.invalidated.length = 0; });

function renderAdmin(tab = 'decks') {
  const router = createMemoryRouter([
    { path: '/admin', element: <Admin /> },
    { path: '/', element: <p>Study page</p> },
  ], { initialEntries: [`/admin?tab=${tab}`] });
  render(<RouterProvider router={router} />);
  return router;
}

/** Opens the deck and leaves an unsaved Conjugation draft in it. */
async function editConjugation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Unidad 1/ }));
  await user.click(await screen.findByRole('button', { name: 'Edit conjugation' }));
}

const fireBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('Admin: an unsaved Conjugation draft', () => {
  beforeEach(() => h.logout.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it('asks before another tab closes the Decks tab', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderAdmin();

    // Nothing edited: no question.
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Groups tab')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Decks' }));

    await editConjugation(user);
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByRole('button', { name: 'Edit conjugation' })).toBeInTheDocument();
    expect(screen.queryByText('Groups tab')).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(screen.getByText('Groups tab')).toBeInTheDocument();

    // The draft went with the tab: nothing is left to ask about.
    confirm.mockClear();
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before Back or a reload drops it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderAdmin();

    expect(fireBeforeUnload()).toBe(false);
    await editConjugation(user);
    expect(fireBeforeUnload()).toBe(true);

    // Back lands on the guard's entry first; the page asks before it goes.
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
  });

  it('asks before Back to Study leaves the page', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderAdmin();
    await editConjugation(user);

    await user.click(screen.getByRole('link', { name: /Back to Study/ }));
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(screen.queryByText('Study page')).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: /Back to Study/ }));
    expect(await screen.findByText('Study page')).toBeInTheDocument();
  });

  it('asks before Sign out drops it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderAdmin();
    await editConjugation(user);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(h.logout).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(h.logout).toHaveBeenCalled());
  });

  it('asks again on Back when Sign out fails', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.logout.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderAdmin();
    await editConjugation(user);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(h.logout).toHaveBeenCalled());
    // Still here, draft and all: the guard's entry stands again.
    await vi.waitFor(() => expect((window.history.state as { libresrsLeaveGuard?: boolean } | null)?.libresrsLeaveGuard).toBe(true));
    expect(screen.getByRole('button', { name: 'Edit conjugation' })).toBeInTheDocument();

    confirm.mockClear();
    confirm.mockReturnValue(false);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
  });
});

describe('Admin: the Users tab', () => {
  const users = [
    { id: 1, googleId: 'g1', name: 'Teacher', email: 'teacher@example.com', role: 'admin', picture: null, createdAt: '2026-08-01T16:00:00.000Z', lastActiveAt: null, studentNumber: null },
    { id: 2, googleId: 'g2', name: 'Ana', email: '123456@students.school.test', role: 'user', picture: null, createdAt: '2026-08-12T16:00:00.000Z', lastActiveAt: Date.parse('2026-09-24T19:00:00Z'), studentNumber: '123456' },
    { id: 3, googleId: 'g3', name: 'beto', email: 'beto@example.com', role: 'user', picture: null, createdAt: '2026-08-20T16:00:00.000Z', lastActiveAt: Date.parse('2026-09-20T19:00:00Z'), studentNumber: '98765' },
  ];
  const settings = (userId: number, today: { newCardsDoneToday: number; reviewsDoneToday: number; decksToday: number; studiedToday: number }) => ({
    userId, newCardsPerDay: 20, reviewsPerDay: 20, isOverride: false, allowHigher: true, allowLower: true,
    aiEnabled: true, aiEnabledLocked: false, autoPlayAudio: false, autoPlayAudioLocked: false, autoPlayAudioFront: false,
    autoPlayAudioFrontLocked: false, mnemonicMode: 'manual', mnemonicModeLocked: false,
    locale: null, localeLocked: false, ...today,
  });

  beforeEach(() => {
    h.data = {
      'admin.getUsers': users,
      'admin.getAllUserSettings': [
        settings(1, { newCardsDoneToday: 0, reviewsDoneToday: 0, decksToday: 0, studiedToday: 0 }),
        settings(2, { newCardsDoneToday: 20, reviewsDoneToday: 3, decksToday: 2, studiedToday: 43 }),
        settings(3, { newCardsDoneToday: 5, reviewsDoneToday: 0, decksToday: 1, studiedToday: 5 }),
      ],
    };
  });
  afterEach(() => {
    h.data = {};
  });

  function renderAt(url: string) {
    const router = createMemoryRouter([
      { path: '/admin/*', element: <Admin /> },
      { path: '/', element: <p>Study page</p> },
    ], { initialEntries: [url] });
    render(<RouterProvider router={router} />);
    return router;
  }
  const names = () => screen.getAllByRole('link').filter((link) => link.id.startsWith('user-link-')).map((link) => link.textContent);
  const header = (name: string) => screen.getByRole('button', { name }).closest('th')!;

  it('searches by name, email or school ID, keeping the search in the URL', async () => {
    const user = userEvent.setup();
    const router = renderAt('/admin?tab=users');
    expect(screen.getByText('3 of 3 users')).toBeInTheDocument();

    const search = screen.getByLabelText('Search users');
    await user.type(search, 'BETO');
    expect(names()).toEqual(['beto']);
    expect(screen.getByText('1 of 3 users')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?tab=users&q=BETO');

    await user.clear(search);
    await user.type(search, '98765');
    expect(names()).toEqual(['beto']);
    await user.clear(search);
    await user.type(search, 'school.test');
    expect(names()).toEqual(['Ana']);
    await user.clear(search);
    await user.type(search, 'nobody');
    expect(screen.getByText('No matching users.')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 users')).toBeInTheDocument();
  });

  it('finds a name whatever its accents, typed with or without them', async () => {
    h.data['admin.getUsers'] = [...users,
      { id: 4, googleId: 'g4', name: 'Ana López', email: 'lopez@example.com', role: 'user', picture: null, createdAt: '2026-08-21T16:00:00.000Z', lastActiveAt: null, studentNumber: null },
      { id: 5, googleId: 'g5', name: 'Carla Díaz', email: 'carla@example.com', role: 'user', picture: null, createdAt: '2026-08-22T16:00:00.000Z', lastActiveAt: null, studentNumber: null },
    ];
    const user = userEvent.setup();
    renderAt('/admin?tab=users');
    const search = screen.getByLabelText('Search users');
    await user.type(search, 'diaz');
    expect(names()).toEqual(['Carla Díaz']);
    await user.clear(search);
    await user.type(search, 'LÓPEZ');
    expect(names()).toEqual(['Ana López']);
  });

  it('sorts by a column header, with aria-sort and the sort in the URL', async () => {
    const user = userEvent.setup();
    const router = renderAt('/admin?tab=users');
    // Newest first, as it always was.
    expect(header('Joined')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['beto', 'Ana', 'Teacher']);

    await user.click(screen.getByRole('button', { name: 'User' }));
    expect(header('User')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Joined')).not.toHaveAttribute('aria-sort');
    expect(names()).toEqual(['Ana', 'beto', 'Teacher']);
    expect(router.state.location.search).toBe('?tab=users&sort=name&dir=asc');

    await user.click(screen.getByRole('button', { name: 'User' }));
    expect(header('User')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['Teacher', 'beto', 'Ana']);

    await user.click(screen.getByRole('button', { name: "Today's Progress" }));
    expect(names()).toEqual(['Ana', 'beto', 'Teacher']);

    await user.click(screen.getByRole('button', { name: 'Role' }));
    expect(names()).toEqual(['Teacher', 'Ana', 'beto']);

    // Never active comes last whichever way.
    await user.click(screen.getByRole('button', { name: 'Last Active' }));
    expect(names()).toEqual(['Ana', 'beto', 'Teacher']);
    await user.click(screen.getByRole('button', { name: 'Last Active' }));
    expect(header('Last Active')).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['beto', 'Ana', 'Teacher']);
  });

  it('opens with the search and sort the URL holds', () => {
    renderAt('/admin?tab=users&sort=active&dir=desc&q=example');
    expect(header('Last Active')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['beto', 'Teacher']);
  });

  it('says a count is the most in one deck when there were several', () => {
    renderAt('/admin?tab=users');
    const ana = screen.getByRole('link', { name: 'Ana' }).closest('tr')!;
    const suffix = within(ana).getByText(/in 2 deck\(s\)/);
    expect(suffix).toHaveAttribute('title', 'The most in any one deck. Limits are per deck.');
    expect(ana).toHaveTextContent('20/20 new, 3/20 reviews · in 2 deck(s)');
    const beto = screen.getByRole('link', { name: 'beto' }).closest('tr')!;
    expect(beto).not.toHaveTextContent('deck(s)');
    expect(screen.getByRole('link', { name: 'Teacher' }).closest('tr')).toHaveTextContent('Never');
  });

  it('opens a user from their name and comes back to the same list, focused on them', async () => {
    h.data['admin.userDetail'] = {
      user: { id: 2, name: 'Ana', email: '123456@students.school.test', picture: null, role: 'user', createdAt: 0, lastActiveAt: null, studentNumber: '123456', studentNumberSetByTeacher: false },
      groups: [], settings: { newCardsPerDay: 20, reviewsPerDay: 20, isOverride: false, allowHigher: true, allowLower: true, limitRule: 'free' },
      finishDays: [], flashcards: [], conjugation: [], labs: [], speaking: [],
    };
    const user = userEvent.setup();
    const router = renderAt('/admin?tab=users&sort=name&dir=asc&q=a');
    await user.click(screen.getByRole('link', { name: 'Ana' }));

    expect(router.state.location.pathname).toBe('/admin/users/2');
    expect(router.state.location.search).toBe('?sort=name&dir=asc&q=a');
    expect(screen.getByRole('heading', { level: 2, name: 'Ana' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: /Back to users/ }));
    expect(router.state.location.pathname).toBe('/admin');
    expect(screen.getByLabelText('Search users')).toHaveValue('a');
    expect(header('User')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveFocus();
  });

  it('opens a user\'s page on the Users tab when loaded directly, and leaves it by a tab', async () => {
    h.data['admin.userDetail'] = undefined;
    const user = userEvent.setup();
    const router = renderAt('/admin/users/3');
    expect(screen.getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Back to users/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(router.state.location.pathname).toBe('/admin');
    expect(screen.getByText('Groups tab')).toBeInTheDocument();
  });

  it('edits a student\'s mnemonic mode as Manual only or Disabled, with no cognate setting (v1.20.0)', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=users');
    const anaRow = screen.getByRole('link', { name: 'Ana' }).closest('tr')!;
    await user.click(within(anaRow).getByRole('button', { name: 'Settings' }));

    const dialog = screen.getByRole('dialog');
    const mode = within(dialog).getByLabelText('Mnemonic generation');
    expect(mode).toHaveValue('manual');
    expect([...mode.querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent]))
      .toEqual([['manual', 'Manual only'], ['disabled', 'Disabled']]);
    expect(within(dialog).queryByText(/cognate/i)).toBeNull();

    await user.selectOptions(mode, 'disabled');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const saved = h.mutation.mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved).toMatchObject({ userId: 2, mnemonicMode: 'disabled' });
    expect(saved).not.toHaveProperty('showCognateScore');
    expect(saved).not.toHaveProperty('showCognateScoreLocked');
  });
});

describe('Admin: long lists a page at a time', () => {
  const day = (n: number) => Date.UTC(2026, 8, 1, 15) + n * 86_400_000;
  /** Thirty students, joined and last active on day n; user 1 is the teacher. */
  const people = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    return {
      id: n, googleId: `g${n}`, name: n === 1 ? 'Teacher' : `Student ${String(n).padStart(2, '0')}`,
      email: n === 1 ? 'teacher@school.test' : `${20000 + n}@students.school.test`, role: n === 1 ? 'admin' : 'user', picture: null,
      createdAt: new Date(day(n)).toISOString(), lastActiveAt: day(n), studentNumber: n === 1 ? null : String(20000 + n),
    };
  });
  const stats = people.map((p) => ({
    userId: p.id, userName: p.name, email: p.email, role: p.role, totalReviews: p.id * 3, totalTimeMs: p.id * 60_000,
    correctReviews: p.id * 2, retentionRate: 2 / 3, lastActive: new Date(p.lastActiveAt).toISOString(), studentNumber: p.studentNumber,
  }));
  const detail = (id: number) => {
    const p = people[id - 1];
    return {
      user: { id, name: p.name, email: p.email, picture: null, role: p.role, createdAt: day(id), lastActiveAt: day(id), studentNumber: p.studentNumber, studentNumberSetByTeacher: false },
      groups: [], settings: { newCardsPerDay: 20, reviewsPerDay: 20, isOverride: false, allowHigher: true, allowLower: true, limitRule: 'free' },
      finishDays: [], flashcards: [], conjugation: [], labs: [], speaking: [],
    };
  };

  beforeEach(() => {
    window.localStorage.clear();
    h.data = { 'admin.getUsers': people, 'admin.getAllUserSettings': [], 'admin.getUserStats': stats, 'admin.getGroups': [] };
  });
  afterEach(() => {
    h.data = {};
    h.realDashboard = false;
  });

  function renderAt(url: string) {
    const router = createMemoryRouter([
      { path: '/admin/*', element: <Admin /> },
      { path: '/', element: <p>Study page</p> },
    ], { initialEntries: [url] });
    const view = render(<RouterProvider router={router} />);
    return { router, unmount: view.unmount };
  }
  const userLinks = () => screen.getAllByRole('link').filter((link) => link.id.startsWith('user-link-')).map((link) => link.textContent);
  const activityLinks = () => within(screen.getByRole('region', { name: 'User Activity' })).getAllByRole('link').map((link) => link.textContent);
  const pageSize = () => screen.getByRole('combobox', { name: 'Show per page' });
  const tab = (name: string) => screen.getByRole('button', { name });

  it('pages the Users tab 25 at a time, keeping its search and sort in the URL, and remembers the page size', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=users');
    expect(userLinks()).toHaveLength(25);
    expect(userLinks()[0]).toBe('Student 30');
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
    expect(screen.getByText('30 of 30 users')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(userLinks()).toEqual(['Student 05', 'Student 04', 'Student 03', 'Student 02', 'Teacher']);
    // A new page is announced: the count above does not change with it.
    expect(screen.getByText('26–30 of 30')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('30 of 30 users')).toBeInTheDocument();

    // A new sort starts from the first page, and the URL holds the sort as before.
    await user.click(screen.getByRole('button', { name: 'User' }));
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
    expect(userLinks()[0]).toBe('Student 02');
    expect(first.router.state.location.search).toBe('?tab=users&sort=name&dir=asc');

    // So does a search.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Search users'), '2001');
    expect(userLinks()).toEqual(['Student 10', 'Student 11', 'Student 12', 'Student 13', 'Student 14', 'Student 15', 'Student 16', 'Student 17', 'Student 18', 'Student 19']);
    expect(screen.getByText('1–10 of 10')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search users'));
    await user.selectOptions(pageSize(), '10');
    expect(userLinks()).toHaveLength(10);
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.users')!)).toEqual({ pageSize: 10 });
    first.unmount();

    renderAt('/admin?tab=users');
    expect(pageSize()).toHaveValue('10');
    expect(userLinks()).toHaveLength(10);
    expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
  });

  it('keeps the Users tab\'s page while a user\'s page is open, and focuses them on the way back', async () => {
    h.data['admin.userDetail'] = detail(3);
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=users');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('link', { name: 'Student 03' }));
    expect(router.state.location.pathname).toBe('/admin/users/3');
    expect(tab('Users')).toHaveAttribute('aria-current', 'page');

    // The browser's Back, the first time round (its entry holds nothing for this).
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/admin');
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 03' })).toHaveFocus();

    // The page's own Back link finds it the same way.
    await user.click(screen.getByRole('link', { name: 'Student 03' }));
    await user.click(screen.getByRole('link', { name: /Back to users/ }));
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 03' })).toHaveFocus();
  });

  it('shows the page that holds the user when their page was loaded on its own', async () => {
    h.data['admin.userDetail'] = detail(5);
    const user = userEvent.setup();
    // Newest first, Student 05 is on page 2; a reload of their page has forgotten which page it was.
    renderAt('/admin/users/5');
    await user.click(screen.getByRole('link', { name: /Back to users/ }));
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 05' })).toHaveFocus();
  });

  it('shows a user\'s page without waiting for the Users list', () => {
    h.data['admin.getUsers'] = undefined;
    h.data['admin.userDetail'] = detail(7);
    renderAt('/admin/users/7?from=dashboard');
    expect(screen.getByRole('heading', { level: 2, name: 'Student 07' })).toBeInTheDocument();
    expect(screen.queryByText('Loading users...')).not.toBeInTheDocument();
  });

  it('opens a user from the Dashboard\'s User Activity and comes back to it as it was', async () => {
    h.realDashboard = true;
    h.data['admin.userDetail'] = detail(12);
    const user = userEvent.setup();
    const { router } = renderAt('/admin');
    expect(activityLinks()).toHaveLength(25);

    await user.selectOptions(pageSize(), '10');
    await user.type(screen.getByLabelText('Search users'), 'student');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('11–20 of 29')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Student 12' }));
    expect(router.state.location.pathname).toBe('/admin/users/12');
    expect(router.state.location.search).toBe('?from=dashboard&q=student&page=2');
    // A user's page opened from the Dashboard marks the Dashboard tab, and goes back to it.
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(tab('Users')).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: /Back to users/ })).not.toBeInTheDocument();

    // The browser's Back, the first time round: the panel as it was, focused on the name.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/admin');
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    expect(pageSize()).toHaveValue('10');
    expect(screen.getByText('11–20 of 29')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 12' })).toHaveFocus();

    // And the page's own Back link, which brings the search and page in its URL.
    await user.click(screen.getByRole('link', { name: 'Student 12' }));
    await user.click(screen.getByRole('link', { name: /Back to dashboard/ }));
    expect(router.state.location.pathname).toBe('/admin');
    expect(router.state.location.search).toBe('?tab=dashboard&q=student&page=2');
    expect(screen.getByText('11–20 of 29')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 12' })).toHaveFocus();

    // Asked once: another tab and back leaves focus on the tab the teacher pressed.
    await user.click(tab('Groups'));
    await user.click(tab('Dashboard'));
    expect(tab('Dashboard')).toHaveFocus();
    // The Users tab does not take the Dashboard's search from the URL.
    await user.click(tab('Users'));
    expect(screen.getByLabelText('Search users')).toHaveValue('');
    // Its own page size, too.
    expect(userLinks()).toHaveLength(25);
    await user.click(tab('Dashboard'));

    // A new search is the panel's own: the URL lets the old one go.
    await user.type(screen.getByLabelText('Search users'), ' 1');
    expect(router.state.location.search).toBe('?tab=dashboard');
    expect(screen.getByText('1–10 of 10')).toBeInTheDocument();
  });

  it('leaves focus on a tab pressed on a user\'s page, even the tab it came from', async () => {
    h.realDashboard = true;
    h.data['admin.userDetail'] = detail(12);
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(screen.getByRole('link', { name: 'Student 12' }));
    await user.click(tab('Dashboard'));
    expect(screen.getByRole('region', { name: 'User Activity' })).toBeInTheDocument();
    expect(tab('Dashboard')).toHaveFocus();
  });

  it('brings the Dashboard\'s search and page from a page loaded on its own', async () => {
    h.realDashboard = true;
    h.data['admin.userDetail'] = detail(4);
    const user = userEvent.setup();
    const first = renderAt('/admin/users/4?from=dashboard&q=student&page=2');
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('link', { name: /Back to dashboard/ }));
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    expect(screen.getByText('26–29 of 29')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student 04' })).toHaveFocus();
    first.unmount();

    // The Dashboard that link leads to, opened in a new tab (or reloaded).
    renderAt('/admin?tab=dashboard&q=student&page=2');
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    expect(screen.getByText('26–29 of 29')).toBeInTheDocument();
  });

  it('keeps the Dashboard\'s search in its URL when a reload brings back another tab', async () => {
    h.realDashboard = true;
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=dashboard&q=student&page=2');
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    await user.click(tab('Groups'));
    first.unmount();

    // The reload brings Groups back; the Dashboard still finds its search.
    renderAt('/admin?tab=dashboard&q=student&page=2');
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    await user.click(tab('Dashboard'));
    expect(screen.getByLabelText('Search users')).toHaveValue('student');
    expect(screen.getByText('26–29 of 29')).toBeInTheDocument();
  });

  it('never takes another tab\'s ?q= as the Dashboard\'s search', async () => {
    h.realDashboard = true;
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=users&q=student');
    await user.click(tab('Dashboard'));
    first.unmount();

    renderAt('/admin?tab=users&q=student');
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Search users')).toHaveValue('');
  });
});

describe('Admin: a group\'s lists lead to a student\'s page, and back to the group', () => {
  const day = (n: number) => Date.UTC(2026, 8, 1, 15) + n * 86_400_000;
  /** Thirty students in Period 1 (id 101…130); Student 03 has a page to open. */
  const members = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    return {
      id: 100 + n, googleId: `g${n}`, name: `Student ${String(n).padStart(2, '0')}`, email: `${20000 + n}@students.school.test`,
      role: 'user', picture: null, createdAt: new Date(day(n)).toISOString(), joinedAt: new Date(day(n)).toISOString(),
      lastActiveAt: day(n), studentNumber: String(20000 + n),
    };
  });
  const detail = (id: number) => {
    const member = members.find((m) => m.id === id)!;
    return {
      user: { id, name: member.name, email: member.email, picture: null, role: 'user', createdAt: day(1), lastActiveAt: day(1), studentNumber: member.studentNumber, studentNumberSetByTeacher: false },
      groups: [{ id: 1, name: 'Period 1' }], settings: { newCardsPerDay: 20, reviewsPerDay: 20, isOverride: false, allowHigher: true, allowLower: true, limitRule: 'free' },
      finishDays: [], flashcards: [], conjugation: [], labs: [], speaking: [],
    };
  };

  beforeEach(() => {
    window.localStorage.clear();
    h.realGroups = true;
    h.data = {
      'admin.getGroups': [
        { id: 1, name: 'Period 1', description: null, memberCount: 30, deckCount: 1 },
        { id: 2, name: 'Period 2', description: null, memberCount: 0, deckCount: 0 },
      ],
      'admin.getGroupMembers': members,
      'admin.getUsers': members,
      'admin.getGroupDecks': [{ id: 1, name: 'Unidad 1', description: null, cardCount: 30 }],
      'admin.getAllUserSettings': [],
    };
  });
  afterEach(() => {
    h.data = {};
    h.realGroups = false;
  });

  function renderAt(url: string) {
    const router = createMemoryRouter([
      { path: '/admin/*', element: <Admin /> },
      { path: '/', element: <p>Study page</p> },
    ], { initialEntries: [url] });
    const view = render(<RouterProvider router={router} />);
    return { router, unmount: view.unmount };
  }
  const tab = (name: string) => screen.getByRole('button', { name });
  const memberList = () => within(screen.getByRole('region', { name: 'Members' }));

  it('opens a member\'s page under the Groups tab; "Back to Period 1" and the browser\'s Back find the list as it was', async () => {
    h.data['admin.userDetail'] = detail(128);
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    await user.type(memberList().getByLabelText('Search members'), 'student');
    await user.click(memberList().getByRole('button', { name: 'Next' }));
    expect(memberList().getByText('26–30 of 30')).toBeInTheDocument();

    await user.click(memberList().getByRole('link', { name: 'Student 28' }));
    expect(router.state.location.pathname).toBe('/admin/users/128');
    expect(router.state.location.search).toBe('?from=group&group=1');
    expect(screen.getByRole('heading', { level: 2, name: 'Student 28' })).toBeInTheDocument();
    // The page belongs to the Groups tab, and the group's lists are out of sight (and out of reach).
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    expect(tab('Users')).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('region', { name: 'Members' })).not.toBeInTheDocument();

    const back = screen.getByRole('link', { name: '← Back to Period 1' });
    expect(back).toHaveAttribute('href', '/admin?tab=groups&group=1');
    await user.click(back);
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    expect(memberList().getByLabelText('Search members')).toHaveValue('student');
    expect(memberList().getByText('26–30 of 30')).toBeInTheDocument();
    expect(memberList().getByRole('link', { name: 'Student 28' })).toHaveFocus();

    // The browser's Back from the page: the same.
    await user.click(memberList().getByRole('link', { name: 'Student 28' }));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/admin');
    expect(memberList().getByText('26–30 of 30')).toBeInTheDocument();
    expect(memberList().getByRole('link', { name: 'Student 28' })).toHaveFocus();
  });

  it('comes back to the group from a student\'s page loaded on its own, focused on the page that holds them', async () => {
    h.data['admin.userDetail'] = detail(127);
    const user = userEvent.setup();
    renderAt('/admin/users/127?from=group&group=1');
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('link', { name: '← Back to Period 1' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Period 1' })).toBeInTheDocument();
    expect(memberList().getByText('26–30 of 30')).toBeInTheDocument();
    expect(memberList().getByRole('link', { name: 'Student 27' })).toHaveFocus();
  });

  it('opens an assigned deck on the Decks tab, and Back returns to the group', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    const decks = within(screen.getByRole('region', { name: 'Assigned Decks' }));
    await user.click(decks.getByRole('link', { name: 'Unidad 1' }));
    expect(router.state.location.search).toBe('?tab=decks&deck=1');
    expect(tab('Decks')).toHaveAttribute('aria-current', 'page');
    // The deck is open, and its name has focus (the link it came from is gone).
    expect(await screen.findByRole('heading', { level: 2, name: 'Unidad 1' })).toHaveFocus();

    await act(() => router.navigate(-1));
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Period 1' })).toBeInTheDocument();
    // Focus is back on the deck's name, where the teacher left.
    expect(within(screen.getByRole('region', { name: 'Assigned Decks' })).getByRole('link', { name: 'Unidad 1' })).toHaveFocus();

    // The tab buttons leave the URL as it is: the Decks button, pressed later, opens no deck an older link named.
    await act(() => router.navigate(1));
    expect(await screen.findByRole('heading', { level: 2, name: 'Unidad 1' })).toBeInTheDocument();
    await user.click(tab('Groups'));
    await user.click(tab('Decks'));
    expect(router.state.location.search).toBe('?tab=decks&deck=1');
    expect(screen.queryByRole('heading', { level: 2, name: 'Unidad 1' })).not.toBeInTheDocument();
    expect(tab('Decks')).toHaveFocus();
  });

  it('leaves a student\'s page for its group by the Groups tab too: the URL keeps the group, for a reload or a deck\'s Back', async () => {
    h.data['admin.userDetail'] = detail(103);
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    await user.click(memberList().getByRole('link', { name: 'Student 03' }));
    expect(router.state.location.pathname).toBe('/admin/users/103');

    await user.click(tab('Groups'));
    expect(router.state.location.pathname).toBe('/admin');
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    expect(screen.getByRole('heading', { level: 2, name: 'Period 1' })).toBeInTheDocument();
    // The button keeps the focus (no name pulls it into the list).
    expect(tab('Groups')).toHaveFocus();

    // A deck opened from here, and Back: the group again.
    await user.click(within(screen.getByRole('region', { name: 'Assigned Decks' })).getByRole('link', { name: 'Unidad 1' }));
    expect(router.state.location.search).toBe('?tab=decks&deck=1');
    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    expect(screen.getByRole('heading', { level: 2, name: 'Period 1' })).toBeInTheDocument();
  });

  it('leaves a user\'s page from the Users tab on the Users tab, whatever group the URL named before', async () => {
    h.data['admin.userDetail'] = detail(128);
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    await user.click(tab('Users'));
    await user.click(screen.getAllByRole('link', { name: 'Student 28' }).find((link) => link.id === 'user-link-128')!);
    expect(router.state.location.pathname).toBe('/admin/users/128');
    // The Users list did not take the Groups tab's URL as its own.
    expect(router.state.location.search).toBe('');
    expect(tab('Users')).toHaveAttribute('aria-current', 'page');
    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    expect(tab('Users')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Student 28' })).toHaveFocus();
  });
});

describe('Admin: a reload brings the tab back', () => {
  afterEach(() => vi.restoreAllMocks());

  function renderAt(url: string) {
    const router = createMemoryRouter([
      { path: '/admin/*', element: <Admin /> },
      { path: '/', element: <p>Study page</p> },
    ], { initialEntries: [url] });
    const view = render(<RouterProvider router={router} />);
    return { router, view };
  }
  const tab = (name: string) => screen.getByRole('button', { name });

  it('shows the ten core tabs in order (no extension in this build)', () => {
    renderAt('/admin');
    expect(within(screen.getByRole('navigation')).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Dashboard', 'Groups', 'Decks', 'Labs', 'Speaking', 'Sign-ups', 'Users', 'Access', 'AI', 'Vocabulómetro',
    ]);
  });

  it('opens the Dashboard for a tab only an extension would bring (?tab=some-extension), and for a saved one', () => {
    const first = renderAt('/admin?tab=some-extension');
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Dashboard tab')).toBeInTheDocument();
    first.view.unmount();

    window.sessionStorage.setItem('libresrs.admin.tab', JSON.stringify({ tab: 'some-extension', url: '/admin', key: 'default' }));
    renderAt('/admin');
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the tab the teacher was on, although the tab buttons leave the URL as it is', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin');
    await user.click(tab('Groups'));
    expect(screen.getByText('Groups tab')).toBeInTheDocument();
    expect(first.router.state.location.search).toBe('');
    first.view.unmount();

    // The same address again (what a reload loads): the Groups tab, not the Dashboard.
    renderAt('/admin');
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Groups tab')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard tab')).not.toBeInTheDocument();
  });

  it('shows the tab left last, over the tab the URL still names', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=decks');
    expect(tab('Decks')).toHaveAttribute('aria-current', 'page');
    await user.click(tab('Access'));
    first.view.unmount();

    renderAt('/admin?tab=decks');
    expect(tab('Access')).toHaveAttribute('aria-current', 'page');
  });

  it('lets a link to a tab (another address) show its own tab', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin');
    await user.click(tab('Groups'));
    first.view.unmount();

    renderAt('/admin?tab=decks');
    expect(tab('Decks')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Groups tab')).not.toBeInTheDocument();
  });

  it('follows a tab the URL opens later, and brings that one back on Back to its entry', async () => {
    const { router } = renderAt('/admin');
    await act(() => router.navigate('/admin?tab=groups'));
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    await act(() => router.navigate('/'));
    expect(screen.getByText('Study page')).toBeInTheDocument();

    await act(() => router.navigate(-1));
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
  });

  it('brings a tab back on Back to the entry it was left on, but not by a new visit to the same address', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([
      { path: '/admin/*', element: <Admin /> },
      { path: '/', element: <Link to="/admin">Admin Dashboard</Link> },
    ], { initialEntries: ['/admin'] });
    render(<RouterProvider router={router} />);
    await user.click(tab('Access'));
    await act(() => router.navigate('/'));

    // Back to the same history entry: the tab the teacher left.
    await act(() => router.navigate(-1));
    expect(tab('Access')).toHaveAttribute('aria-current', 'page');

    // The Study page's link to /admin is a new visit: the Dashboard, as before.
    await act(() => router.navigate('/'));
    await user.click(screen.getByRole('link', { name: 'Admin Dashboard' }));
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('ignores a saved value it cannot use, and a storage that refuses', async () => {
    window.sessionStorage.setItem('libresrs.admin.tab', '{not json');
    const first = renderAt('/admin?tab=groups');
    expect(tab('Groups')).toHaveAttribute('aria-current', 'page');
    first.view.unmount();

    window.sessionStorage.setItem('libresrs.admin.tab', JSON.stringify({ tab: 'nowhere', url: '/admin' }));
    const second = renderAt('/admin');
    expect(tab('Dashboard')).toHaveAttribute('aria-current', 'page');
    second.view.unmount();

    // The storage in use (jsdom's, or Node's own): spy on what the page calls.
    const storage = Object.getPrototypeOf(window.sessionStorage) as Storage;
    const read = vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const user = userEvent.setup();
    renderAt('/admin?tab=decks');
    expect(tab('Decks')).toHaveAttribute('aria-current', 'page');
    await user.click(tab('Groups'));
    expect(screen.getByText('Groups tab')).toBeInTheDocument();
    expect(read).toHaveBeenCalled();
    expect(write).toHaveBeenCalled();
  });
});

describe('Admin: the AI tab', () => {
  /** ai.getAdminConfig as the server answers it: AI on, OpenAI writing mnemonics, no Anthropic key yet. */
  const aiConfig = (over: Record<string, unknown> = {}) => ({
    pausedProviders: [],
    aiEnabled: true,
    provider: 'openai',
    hasApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    pronunciation: true,
    image: true,
    mnemonic: true,
    mnemonicModel: 'gpt-5.6-luna',
    imageModel: 'gpt-image-1.5',
    imageQuality: 'low',
    ttsModel: 'gpt-4o-mini-tts',
    ttsProvider: 'openai',
    hasElevenLabsKey: false,
    ttsVoiceMap: {},
    availableModels: {
      mnemonic: ['gpt-5.6-luna', 'gpt-4.1'],
      image: ['gpt-image-1.5'],
      imageQuality: ['low', 'medium', 'high'],
      tts: ['gpt-4o-mini-tts'],
    },
    modelsFetchedAt: null,
    textProvider: 'openai',
    hasAnthropicKey: false,
    anthropicMnemonicModel: 'claude-opus-5-5',
    anthropicModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    ...over,
  });
  const CLAUDE_LIST = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  const NO_KEY_NOTE = 'Paste an Anthropic API key to use Claude — saving is refused without one.';

  const providerSelect = () => screen.getByLabelText('Mnemonic suggestions use');
  const keyField = () => screen.getByLabelText('Anthropic API Key');
  const save = () => screen.getByRole('button', { name: 'Save Configuration' });
  /** What the last mutate() sent (Save and Test key share the mock's mutation). */
  const sent = () => h.mutation.mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  const datalist = (id: string) => [...document.querySelectorAll(`#${id} option`)].map((o) => o.getAttribute('value'));

  const REMOVE_NOTE = 'The saved key will be removed when you save.';
  const configuredBadge = () => within(keyField().parentElement!).queryByText('Configured');
  const SINCE = Date.parse('2026-10-08T15:00:00Z');
  const ANTHROPIC_PAUSED = /^Anthropic \(Claude\) — paused since/;
  const KEEPS_WORKING = 'Mnemonic suggestions use Claude and keep working.';
  const KEY_TEST_PASSED = { ok: true, checks: [{ model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', seconds: 1.2 }] };

  beforeEach(() => {
    h.data = { 'ai.getAdminConfig': aiConfig() };
    h.mutation.mutate.mockClear();
    h.mutation.reset.mockClear();
    h.mutation.data = undefined;
    h.mutationOptions = {};
    h.refetch.mockReset();
    h.refetch.mockImplementation(async () => ({}));
  });
  afterEach(() => {
    h.data = {};
    h.mutation.data = undefined;
    h.mutation.isPending = false;
    h.mutation.isError = false;
    h.mutation.error = null;
  });

  it('shows the Anthropic key field once Claude is chosen, and names the OpenAI model that stays saved', async () => {
    const user = userEvent.setup();
    renderAdmin('ai');
    expect(providerSelect()).toHaveValue('openai');
    expect(screen.queryByLabelText('Anthropic API Key')).toBeNull();
    expect(screen.queryByText(/Your OpenAI model/)).toBeNull();

    await user.selectOptions(providerSelect(), 'anthropic');
    expect(keyField()).toHaveValue('');
    expect(keyField()).toHaveAttribute('placeholder', 'sk-ant-...');
    expect(screen.getByText('Your OpenAI model (gpt-5.6-luna) stays saved and comes back if you switch back.')).toBeInTheDocument();
    expect(screen.getByText(NO_KEY_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'platform.claude.com' })).toHaveAttribute('href', 'https://platform.claude.com/settings/keys');
    expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull();

    await user.type(keyField(), 'sk-ant-test');
    expect(screen.queryByText(NO_KEY_NOTE)).toBeNull();
    // Back to OpenAI with no key saved: nothing to remove, so no field, and nothing it held is saved.
    await user.selectOptions(providerSelect(), 'openai');
    expect(screen.queryByLabelText('Anthropic API Key')).toBeNull();
    await user.click(save());
    expect(sent()).toMatchObject({ textProvider: 'openai' });
    expect(sent()).not.toHaveProperty('anthropicApiKey', 'sk-ant-test');
    expect(sent().anthropicApiKey).toBeUndefined();

    // Choosing Claude again shows the key it still holds, and saves it.
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(keyField()).toHaveValue('sk-ant-test');
    await user.click(save());
    expect(sent()).toMatchObject({ textProvider: 'anthropic', anthropicApiKey: 'sk-ant-test' });
  });

  it('keeps the provider switch and the key field usable with AI off, so a saved key can be removed', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({ aiEnabled: false, textProvider: 'anthropic', hasAnthropicKey: true });
    const user = userEvent.setup();
    renderAdmin('ai');
    expect(providerSelect()).toBeEnabled();
    expect(providerSelect()).toHaveValue('anthropic');
    expect(keyField()).toBeEnabled();

    // Revoking a leaked key while AI is off: the server refuses Claude without one, so switch too.
    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(screen.getByText(NO_KEY_NOTE)).toBeInTheDocument();
    await user.selectOptions(providerSelect(), 'openai');
    await user.click(save());
    expect(sent()).toMatchObject({ aiEnabled: false, textProvider: 'openai', anthropicApiKey: '' });
  });

  it('saves the provider and the Claude model, with a key only when one was typed, and the OpenAI model untouched', async () => {
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.selectOptions(providerSelect(), 'anthropic');
    await user.click(save());
    expect(sent()).toMatchObject({
      textProvider: 'anthropic',
      anthropicMnemonicModel: 'claude-opus-5-5',
      mnemonicModel: 'gpt-5.6-luna',
    });
    expect(sent().anthropicApiKey).toBeUndefined();

    await user.type(keyField(), 'sk-ant-test');
    await user.click(save());
    expect(sent()).toMatchObject({ textProvider: 'anthropic', anthropicApiKey: 'sk-ant-test' });
  });

  it('shows a saved key as saved, and removes it on Save after “Remove key”', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({ hasApiKey: false, hasAnthropicKey: true });
    const user = userEvent.setup();
    renderAdmin('ai');
    // Saved, with OpenAI chosen: still shown, so it can be removed.
    expect(providerSelect()).toHaveValue('openai');
    expect(keyField()).toHaveValue('');
    expect(keyField()).toHaveAttribute('placeholder', '••••••••  (saved)');
    expect(within(keyField().parentElement!).getByText('Configured')).toBeInTheDocument();
    expect(screen.queryByText('The saved key will be removed when you save.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(screen.getByText('The saved key will be removed when you save.')).toBeInTheDocument();
    expect(within(keyField().parentElement!).queryByText('Configured')).toBeNull();
    await user.click(save());
    expect(sent()).toMatchObject({ textProvider: 'openai', anthropicApiKey: '' });

    // With Claude chosen, removing the key is a save the server refuses: say so before Save.
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.getByText(NO_KEY_NOTE)).toBeInTheDocument();
  });

  it('undoes “Remove key” with “Keep saved key”', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true });
    const user = userEvent.setup();
    renderAdmin('ai');

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(screen.getByText(REMOVE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(NO_KEY_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Keep saved key' }));
    expect(screen.queryByText(REMOVE_NOTE)).toBeNull();
    expect(screen.queryByText(NO_KEY_NOTE)).toBeNull();
    expect(configuredBadge()).toBeInTheDocument();
    expect(keyField()).toHaveAttribute('placeholder', '••••••••  (saved)');
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
    await user.click(save());
    expect(sent().anthropicApiKey).toBeUndefined();
  });

  it('keeps the saved key when the field is left empty or holds only spaces', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({ hasAnthropicKey: true });
    const user = userEvent.setup();
    renderAdmin('ai');

    // Typed, then erased: nothing to save, so the saved key stays (it is only removed by “Remove key”).
    await user.type(keyField(), 'x');
    await user.clear(keyField());
    expect(configuredBadge()).toBeInTheDocument();
    expect(screen.queryByText(REMOVE_NOTE)).toBeNull();
    await user.click(save());
    expect(sent().anthropicApiKey).toBeUndefined();

    // Only spaces (the server would read them as “remove”): kept too, with Claude chosen as well.
    await user.type(keyField(), '   ');
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.queryByText(REMOVE_NOTE)).toBeNull();
    expect(screen.queryByText(NO_KEY_NOTE)).toBeNull();
    await user.click(save());
    expect(sent()).toMatchObject({ textProvider: 'anthropic' });
    expect(sent().anthropicApiKey).toBeUndefined();
  });

  it('clears typed keys only when the save succeeds, even when the config comes back unchanged', async () => {
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.selectOptions(providerSelect(), 'anthropic');
    await user.type(keyField(), 'sk-ant-test');
    const openAiKey = screen.getByPlaceholderText('sk-••••••••••••••••');
    await user.type(openAiKey, 'sk-proj-new');

    // The mock's save never succeeds (it ignores onSuccess), like a save the server refused.
    await user.click(save());
    expect(keyField()).toHaveValue('sk-ant-test');
    expect(openAiKey).toHaveValue('sk-proj-new');

    // It succeeds, and the refetch answers the same object (React Query's structural sharing):
    // the load effect does not run again, so onSuccess must clear them itself.
    const onSuccess = h.mutationOptions['ai.saveAdminConfig']?.onSuccess;
    expect(onSuccess).toBeTypeOf('function');
    await act(async () => { await onSuccess?.(); });
    expect(h.refetch).toHaveBeenCalledTimes(1);
    // The test editor's transcription warning is read again (the switch may have just changed).
    expect(h.invalidated).toContain('utils.vocab.transcriptionStatus');
    expect(keyField()).toHaveValue('');
    expect(keyField()).toHaveAttribute('placeholder', 'sk-ant-...');
    expect(screen.getByPlaceholderText('sk-••••••••••••••••')).toHaveValue('');
  });

  it('keeps a just-saved key in the field until the refetch says it is saved', async () => {
    let landRefetch: () => void = () => {};
    h.refetch.mockImplementation(() => new Promise((resolve) => { landRefetch = () => resolve({}); }));
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.selectOptions(providerSelect(), 'anthropic');
    await user.type(keyField(), 'sk-ant-test');
    await user.click(save());

    // Saved; the fresh config is on its way. No "saving is refused" warning beside "Saved".
    let saved: unknown;
    act(() => { saved = h.mutationOptions['ai.saveAdminConfig']?.onSuccess?.(); });
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(keyField()).toHaveValue('sk-ant-test');
    expect(screen.queryByText(NO_KEY_NOTE)).toBeNull();

    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true });
    await act(async () => { landRefetch(); await saved; });
    expect(keyField()).toHaveValue('');
    expect(keyField()).toHaveAttribute('placeholder', '••••••••  (saved)');
    expect(configuredBadge()).toBeInTheDocument();
    expect(screen.queryByText(NO_KEY_NOTE)).toBeNull();
  });

  it('tests a typed key, or the saved one', async () => {
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.selectOptions(providerSelect(), 'anthropic');
    const testButton = screen.getByRole('button', { name: 'Test key' });
    // Nothing typed and nothing saved: nothing to test.
    expect(testButton).toBeDisabled();

    await user.type(keyField(), 'sk-ant-typed');
    expect(h.mutation.reset).toHaveBeenCalled();
    expect(testButton).toBeEnabled();
    await user.click(testButton);
    // Only the mnemonic model: the Claude cognate model went with the cognate system (v1.20.0).
    expect(h.mutation.mutate).toHaveBeenLastCalledWith({ apiKey: 'sk-ant-typed', mnemonicModel: 'claude-opus-5-5' });
    cleanup();

    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true, anthropicMnemonicModel: 'claude-haiku-5-5' });
    renderAdmin('ai');
    await user.click(screen.getByRole('button', { name: 'Test key' }));
    expect(h.mutation.mutate).toHaveBeenLastCalledWith({ apiKey: undefined, mnemonicModel: 'claude-haiku-5-5' });
  });

  it('shows a test in progress, and allows no second one meanwhile', () => {
    h.mutation.isPending = true;
    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true });
    renderAdmin('ai');
    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Test key' })).toBeNull();
  });

  it.each([
    {
      name: 'ok',
      result: { ok: true, checks: [{ model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', seconds: 1.2 }] },
      text: 'Key works. Claude answered with claude-opus-5-5.',
    },
    {
      name: 'auth',
      result: { ok: false, kind: 'auth', model: 'claude-opus-5-5', status: 401, requestId: null, detail: 'Anthropic key test failed: 401 authentication_error: invalid x-api-key' },
      text: 'Anthropic didn’t accept this key, or the key isn’t allowed to use this model. Copy it again from the Claude Console, or create a new one.',
    },
    {
      name: 'billing',
      result: { ok: false, kind: 'billing', model: 'claude-opus-5-5', status: 402, requestId: 'req_011', detail: 'Anthropic key test failed: 402 billing_error: Your credit balance is too low' },
      text: 'The key works, but the Anthropic account has no credit or reached its spending limit. Add credit or raise the limit in the Claude Console, then test again.',
    },
    {
      name: 'model',
      result: { ok: false, kind: 'model', model: 'claude-opus-9-9', status: 404, requestId: 'req_012', detail: 'Anthropic key test failed: 404 not_found_error: model: claude-opus-9-9' },
      text: 'This account can’t use the model claude-opus-9-9. Pick another one under “Model Settings”.',
    },
    { name: 'no_key', result: { ok: false, kind: 'no_key' }, text: 'Paste a key first, or save one.' },
    {
      name: 'busy',
      result: { ok: false, kind: 'busy', model: 'claude-opus-5-5', status: 529, requestId: null, detail: 'Anthropic key test failed: 529 overloaded_error: Overloaded' },
      text: 'Anthropic is busy or could not be reached. Test again in a minute.',
    },
    {
      name: 'other',
      result: { ok: false, kind: 'other', model: 'claude-opus-5-5', status: 400, requestId: null, detail: '400 invalid_request_error: bad' },
      text: 'Anthropic returned an error: 400 invalid_request_error: bad',
    },
  ])('says what the key test found: $name', ({ result, text }) => {
    h.mutation.data = result;
    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true });
    renderAdmin('ai');
    expect(screen.getByText(text)).toHaveAttribute('role', 'status');

    const failed = result as { ok: boolean; detail?: string; requestId?: string | null };
    if (failed.ok || (!failed.detail && !failed.requestId)) {
      expect(screen.queryByText('Technical details')).toBeNull();
      return;
    }
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    if (failed.detail) expect(screen.getAllByText(failed.detail, { exact: false }).length).toBeGreaterThan(0);
    if (failed.requestId) expect(screen.getByText(`Request ID: ${failed.requestId}`)).toBeInTheDocument();
  });

  it('shows the Claude model only while Claude is chosen, and the OpenAI one again on switching back', async () => {
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.click(screen.getByRole('button', { name: /Model Settings/ }));
    expect(screen.getByLabelText('Mnemonic model')).toHaveValue('gpt-5.6-luna');
    expect(screen.getByLabelText('Mnemonic model')).toHaveAttribute('list', 'ai-mnemonic-models');
    expect(datalist('ai-mnemonic-models')).toEqual(['gpt-5.6-luna', 'gpt-4.1']);
    expect(screen.queryByRole('heading', { name: 'Claude model' })).toBeNull();

    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.getByRole('heading', { name: 'Claude model' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mnemonic model')).toHaveValue('claude-opus-5-5');
    expect(screen.getByLabelText('Mnemonic model')).toHaveAttribute('list', 'ai-anthropic-mnemonic-models');
    expect(datalist('ai-anthropic-mnemonic-models')).toEqual(CLAUDE_LIST);
    await user.clear(screen.getByLabelText('Mnemonic model'));
    await user.type(screen.getByLabelText('Mnemonic model'), 'claude-haiku-5-5');

    // Switching back shows the OpenAI field as saved; switching again keeps the Claude edit.
    await user.selectOptions(providerSelect(), 'openai');
    expect(screen.queryByRole('heading', { name: 'Claude model' })).toBeNull();
    expect(screen.getByLabelText('Mnemonic model')).toHaveValue('gpt-5.6-luna');
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.getByLabelText('Mnemonic model')).toHaveValue('claude-haiku-5-5');

    await user.click(save());
    expect(sent()).toMatchObject({ anthropicMnemonicModel: 'claude-haiku-5-5', mnemonicModel: 'gpt-5.6-luna' });
  });

  it('has no cognate controls (v1.20.0), even when an older server still sends the cognate settings', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({
      // What v1.19.0 answered (the switch, its model and a model list for it), plus the Claude
      // cognate model an unreleased build of the Anthropic work sent.
      cognate: true,
      cognateModel: 'gpt-4o-mini',
      anthropicCognateModel: 'claude-haiku-5-5',
      availableModels: { ...aiConfig().availableModels, cognate: ['gpt-4o-mini'] },
    });
    const user = userEvent.setup();
    renderAdmin('ai');
    await user.click(screen.getByRole('button', { name: /Model Settings/ }));

    for (const provider of ['openai', 'anthropic']) {
      await user.selectOptions(providerSelect(), provider);
      expect(screen.queryByText(/cognate/i), provider).toBeNull();
      expect(screen.queryByLabelText(/cognate/i), provider).toBeNull();
      expect(document.querySelector('[id*="cognate"]'), provider).toBeNull();
    }
    expect(screen.getByLabelText('Mnemonic suggestions use')).toBeInTheDocument();
    expect([...providerSelect().querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['OpenAI (or the compatible endpoint above)', 'Anthropic (Claude)']);

    await user.selectOptions(providerSelect(), 'openai');
    await user.click(save());
    for (const key of ['cognate', 'cognateModel', 'anthropicCognateModel']) expect(sent()).not.toHaveProperty(key);
    expect(sent()).toMatchObject({ textProvider: 'openai', mnemonic: true, mnemonicModel: 'gpt-5.6-luna' });
  });

  it('opens on OpenAI, with the built-in Claude list, when an older server sends none of the Claude fields', async () => {
    const older: Record<string, unknown> = aiConfig();
    for (const key of ['textProvider', 'hasAnthropicKey', 'anthropicMnemonicModel', 'anthropicModels']) delete older[key];
    h.data['ai.getAdminConfig'] = older;
    const user = userEvent.setup();
    renderAdmin('ai');
    expect(providerSelect()).toHaveValue('openai');
    expect(screen.queryByLabelText('Anthropic API Key')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Model Settings/ }));
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.getByLabelText('Mnemonic model')).toHaveValue('claude-opus-5-5');
    expect(datalist('ai-anthropic-mnemonic-models')).toEqual(CLAUDE_LIST);
  });

  it('names paused providers as the teacher knows them, and says what still works', () => {
    const since = Date.parse('2026-10-08T15:00:00Z');
    h.data['ai.getAdminConfig'] = aiConfig({
      textProvider: 'anthropic',
      hasAnthropicKey: true,
      pausedProviders: [
        { provider: 'openai', since, reason: '429 insufficient_quota' },
        { provider: 'anthropic', since, reason: '402 billing_error' },
        { provider: 'elevenlabs', since, reason: 'quota_exceeded' },
      ],
    });
    renderAdmin('ai');
    expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    expect(screen.getByText(/^Anthropic \(Claude\) — paused since/)).toBeInTheDocument();
    expect(screen.getByText(/^ElevenLabs — paused since/)).toBeInTheDocument();
    expect(screen.getByText('Mnemonic suggestions are paused until the Anthropic account has credit. Add credit in the Claude Console, then press “Test key” to resume right away.')).toBeInTheDocument();
    // Claude is paused too: nothing promises it keeps working.
    expect(screen.queryByText(KEEPS_WORKING)).toBeNull();
  });

  it('says Claude keeps working while only OpenAI is paused and Claude is the saved provider', () => {
    h.data['ai.getAdminConfig'] = aiConfig({
      textProvider: 'anthropic',
      hasAnthropicKey: true,
      pausedProviders: [{ provider: 'openai', since: SINCE, reason: '429 insufficient_quota' }],
    });
    renderAdmin('ai');
    expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    expect(screen.getByText(KEEPS_WORKING)).toBeInTheDocument();
  });

  describe('"Resume now" on a paused provider', () => {
    const OPENAI_RESUMED = 'OpenAI resumed. If the account still has no credit, the next request pauses it again.';
    const pausedOpenAiAndElevenLabs = () => aiConfig({
      pausedProviders: [
        { provider: 'openai', since: SINCE, reason: '429 insufficient_quota' },
        { provider: 'elevenlabs', since: SINCE, reason: 'quota_exceeded' },
      ],
    });
    /** Answers the last resumeProvider call the way the server does when it cleared the pause. */
    const resumeSucceeds = (provider: string) => act(() => {
      const perCall = h.mutation.mutate.mock.calls.at(-1)?.[1] as { onSuccess?: () => void } | undefined;
      perCall?.onSuccess?.();
      h.mutationOptions['ai.resumeProvider']?.onSuccess?.({ cleared: true }, { provider });
    });

    it('offers it on each paused provider and resumes only the one pressed, without reloading the form', async () => {
      h.data['ai.getAdminConfig'] = pausedOpenAiAndElevenLabs();
      const user = userEvent.setup();
      renderAdmin('ai');
      expect(screen.getByRole('button', { name: 'Resume ElevenLabs now' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Resume OpenAI now' }));
      expect(h.mutation.mutate).toHaveBeenLastCalledWith({ provider: 'openai' }, expect.anything());

      resumeSucceeds('openai');
      expect(screen.queryByText(/^OpenAI — paused since/)).toBeNull();
      expect(screen.getByText(/^ElevenLabs — paused since/)).toBeInTheDocument();
      expect(screen.getByText(OPENAI_RESUMED)).toBeInTheDocument();
    });

    it('shows a newer pause of the same provider again: an account still without credit is not hidden', async () => {
      h.data['ai.getAdminConfig'] = pausedOpenAiAndElevenLabs();
      const user = userEvent.setup();
      renderAdmin('ai');
      await user.click(screen.getByRole('button', { name: 'Resume OpenAI now' }));
      // The next request found the account still empty: the server paused OpenAI again.
      h.data['ai.getAdminConfig'] = aiConfig({
        pausedProviders: [{ provider: 'openai', since: SINCE + 60_000, reason: '429 insufficient_quota' }],
      });
      resumeSucceeds('openai');
      expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    });

    it('says so when the resume did not go through, and keeps the pause showing', async () => {
      h.data['ai.getAdminConfig'] = pausedOpenAiAndElevenLabs();
      const user = userEvent.setup();
      renderAdmin('ai');
      await user.click(screen.getByRole('button', { name: 'Resume OpenAI now' }));
      act(() => { h.mutationOptions['ai.resumeProvider']?.onError?.(new Error('offline'), { provider: 'openai' }); });
      expect(screen.getByText('Could not resume OpenAI. Try again.')).toBeInTheDocument();
      expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    });

    it('tells the teacher the button exists in the banner', () => {
      h.data['ai.getAdminConfig'] = pausedOpenAiAndElevenLabs();
      renderAdmin('ai');
      expect(screen.getByText('Just added credit? Press “Resume now” to try again right away.')).toBeInTheDocument();
    });
  });

  it('drops the Anthropic pause once a test with the saved key passes, as the server does', () => {
    h.data['ai.getAdminConfig'] = aiConfig({
      textProvider: 'anthropic',
      hasAnthropicKey: true,
      pausedProviders: [
        { provider: 'openai', since: SINCE, reason: '429 insufficient_quota' },
        { provider: 'anthropic', since: SINCE, reason: '402 billing_error' },
      ],
    });
    renderAdmin('ai');
    const onTested = h.mutationOptions['ai.testAnthropicKey']?.onSuccess;
    expect(onTested).toBeTypeOf('function');
    const MODELS = { mnemonicModel: 'claude-opus-5-5' };

    // A typed key may be another account's, and a failed test proves nothing: the pause stays.
    act(() => { onTested?.(KEY_TEST_PASSED, { ...MODELS, apiKey: 'sk-ant-other-account' }); });
    act(() => { onTested?.({ ok: false, kind: 'billing', model: 'claude-opus-5-5', status: 402 }, { ...MODELS, apiKey: undefined }); });
    expect(screen.getByText(ANTHROPIC_PAUSED)).toBeInTheDocument();

    act(() => { onTested?.(KEY_TEST_PASSED, { ...MODELS, apiKey: undefined }); });
    expect(screen.queryByText(ANTHROPIC_PAUSED)).toBeNull();
    expect(screen.queryByText(/Add credit in the Claude Console, then press/)).toBeNull();
    expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    expect(screen.getByText(KEEPS_WORKING)).toBeInTheDocument();

    // Tested again and out of credit after all: the server paused it again, and so does the banner.
    act(() => { onTested?.({ ok: false, kind: 'billing', model: 'claude-opus-5-5', status: 402 }, { ...MODELS, apiKey: undefined }); });
    expect(screen.getByText(ANTHROPIC_PAUSED)).toBeInTheDocument();
    expect(screen.queryByText(KEEPS_WORKING)).toBeNull();
  });

  it('drops the whole banner when Claude was the only one paused', () => {
    h.data['ai.getAdminConfig'] = aiConfig({
      textProvider: 'anthropic',
      hasAnthropicKey: true,
      pausedProviders: [{ provider: 'anthropic', since: SINCE, reason: '402 billing_error' }],
    });
    renderAdmin('ai');
    expect(screen.getByText('AI is paused — the provider account is out of credit.')).toBeInTheDocument();
    act(() => {
      h.mutationOptions['ai.testAnthropicKey']?.onSuccess?.(KEY_TEST_PASSED, { mnemonicModel: 'claude-opus-5-5' });
    });
    expect(screen.queryByText('AI is paused — the provider account is out of credit.')).toBeNull();
  });

  it('says why a save or a key test was refused in the admin’s words, by the server’s code', () => {
    h.mutation.isError = true;
    h.mutation.error = Object.assign(new Error('server English'), { data: { code: 'BAD_REQUEST', appCode: 'ANTHROPIC_KEY_MISSING' } });
    renderAdmin('ai');
    expect(screen.getByText('Claude needs an Anthropic API key — paste one, or switch mnemonic suggestions back to OpenAI.')).toBeInTheDocument();
    expect(screen.queryByText('server English')).toBeNull();
    cleanup();

    // A code it does not know keeps the server's message.
    h.mutation.error = Object.assign(new Error('AI base URL must use http or https'), { data: { code: 'BAD_REQUEST', appCode: undefined } });
    renderAdmin('ai');
    expect(screen.getByText('AI base URL must use http or https')).toBeInTheDocument();
    cleanup();

    // Test key (the field is on screen): zod's issue list for a paste too long to be a key.
    h.data['ai.getAdminConfig'] = aiConfig({ textProvider: 'anthropic', hasAnthropicKey: true });
    h.mutation.error = Object.assign(new Error('[{"origin":"string","code":"too_big","maximum":500,"path":["apiKey"]}]'), { data: { code: 'BAD_REQUEST' } });
    renderAdmin('ai');
    expect(screen.getByRole('status')).toHaveTextContent('The key or a Claude model name is too long to be real. Check both, then test again.');
    expect(screen.getByRole('status')).not.toHaveTextContent('too_big');
    cleanup();

    h.mutation.error = Object.assign(new Error('AI rate limit exceeded. Please try again in a moment.'), { data: { code: 'TOO_MANY_REQUESTS', appCode: 'AI_RATE_LIMIT' } });
    renderAdmin('ai');
    expect(screen.getByRole('status')).toHaveTextContent('Too many AI requests in the last minute. Try again in a moment.');
  });

  it('does not promise Claude keeps working while OpenAI is the saved provider', async () => {
    h.data['ai.getAdminConfig'] = aiConfig({ pausedProviders: [{ provider: 'openai', since: Date.parse('2026-10-08T15:00:00Z'), reason: '429 insufficient_quota' }] });
    const user = userEvent.setup();
    renderAdmin('ai');
    // Choosing Claude here is not saved yet: the banner follows what the server runs.
    await user.selectOptions(providerSelect(), 'anthropic');
    expect(screen.getByText(/^OpenAI — paused since/)).toBeInTheDocument();
    expect(screen.queryByText(KEEPS_WORKING)).toBeNull();
  });
});
