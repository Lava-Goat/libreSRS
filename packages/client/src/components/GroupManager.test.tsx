import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import GroupManager from './GroupManager';

type MockUser = {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  role?: 'admin' | 'user';
  studentNumber?: string | null;
  lastActiveAt?: number | null;
  joinedAt?: string;
};

type MockGroup = { id: number; name: string; description: string | null; memberCount: number; deckCount: number };
type MockDeck = { id: number; name: string; cardCount: number; description?: string | null };

const groups: MockGroup[] = [
  {
    id: 1,
    name: 'Group One',
    description: 'Test group',
    memberCount: 1,
    deckCount: 1,
  },
];

const users: MockUser[] = [
  { id: 1, name: 'Alice', email: 'alice@example.com', picture: null },
  { id: 2, name: 'Bob', email: 'bob@example.com', picture: null },
];

const decks = [
  { id: 10, name: 'Deck Assigned', cardCount: 34 },
  { id: 11, name: 'Deck Unassigned', cardCount: 20 },
];

// What the queries answer; each test may change them (and bump the store, for a list that changes on screen).
let groupsData: MockGroup[] = groups;
let usersData: MockUser[] = users;
let groupMembers: MockUser[] = [];
let groupDecksData: MockDeck[] = [];
let gcCourses: unknown[] | undefined;
let gcStudents: { email: string; fullName: string }[] | undefined;

/** The members and decks queries re-read their data when this is bumped (a refetch, as far as the screen knows). */
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
    bump: () => {
      version += 1;
      listeners.forEach((listener) => listener());
    },
  };
});

const mockRefetchGroups = vi.fn(async () => undefined);
const mockRefetchGroupMembers = vi.fn(async () => {
  const bob = users.find((user) => user.id === 2);
  if (bob && !groupMembers.some((member) => member.id === bob.id)) {
    groupMembers = [...groupMembers, bob];
  }
});
const mockRefetchGroupDecks = vi.fn(async () => undefined);
const mockRemoveDeckFromGroupMutate = vi.fn();
const mockAssignDeckToGroupMutate = vi.fn();
const mockAddUserToGroupMutate = vi.fn();
const mockRemoveUserFromGroupMutate = vi.fn();
/** What addUsersToGroup reports as applied (the group's Override on). */
let settingsApplied = 0;
/** The Classroom import's onSuccess, to finish an import when a test says so. */
const imports = vi.hoisted(() => ({ onCourseImported: undefined as ((result: unknown) => void) | undefined }));

// "Make PINs…" is tested on its own (groups/GroupPinsButton.test.tsx).
vi.mock('./groups/GroupPinsButton', () => ({ default: () => null }));

vi.mock('../api/trpc', async () => {
  const { useSyncExternalStore } = await import('react');
  const useStore = () => useSyncExternalStore(store.subscribe, store.version);
  return {
    trpc: {
      setup: {
        getStatus: {
          useQuery: () => ({ data: undefined }),
        },
      },
      admin: {
        getGroups: {
          useQuery: () => {
            useStore();
            return { data: groupsData, refetch: mockRefetchGroups };
          },
        },
        getUsers: {
          useQuery: () => ({
            data: usersData,
          }),
        },
        getDecks: {
          useQuery: () => ({
            data: decks,
          }),
        },
        getGroupMembers: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
            useStore();
            return {
              data: options?.enabled ? groupMembers : undefined,
              refetch: mockRefetchGroupMembers,
            };
          },
        },
        getGroupDecks: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
            useStore();
            return {
              data: options?.enabled ? groupDecksData : undefined,
              refetch: mockRefetchGroupDecks,
            };
          },
        },
        createGroup: {
          useMutation: () => ({
            mutate: vi.fn(),
          }),
        },
        importGoogleClassroomGroup: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
          }),
        },
        importGoogleClassroomCourse: {
          useMutation: (options?: { onSuccess?: (result: unknown) => void }) => {
            imports.onCourseImported = options?.onSuccess;
            return { mutate: vi.fn(), isPending: false };
          },
        },
        listGoogleClassroomCourses: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
            data: options?.enabled ? gcCourses : undefined, isLoading: false, error: null,
          }),
        },
        previewGoogleClassroomStudents: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
            data: options?.enabled ? gcStudents : undefined, isLoading: false, error: null,
          }),
        },
        listCleverSections: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
        previewCleverStudents: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
        importCleverSection: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        deleteGroup: {
          useMutation: () => ({
            mutate: vi.fn(),
          }),
        },
        addUsersToGroup: {
          useMutation: (options?: {
            onSuccess?: (_result: { success: boolean; requested: number; added: number; settingsApplied: number }) => Promise<void> | void;
          }) => ({
            mutate: (variables: { groupId: number; userIds: number[] }) => {
              mockAddUserToGroupMutate(variables);
              void options?.onSuccess?.({
                success: true, requested: variables.userIds.length, added: variables.userIds.length, settingsApplied,
              });
            },
            isPending: false,
          }),
        },
        exportGroupData: {
          useQuery: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
        },
        removeUserFromGroup: {
          useMutation: () => ({
            mutate: mockRemoveUserFromGroupMutate,
          }),
        },
        assignDeckToGroup: {
          useMutation: () => ({
            mutate: mockAssignDeckToGroupMutate,
          }),
        },
        removeDeckFromGroup: {
          useMutation: () => ({
            mutate: mockRemoveDeckFromGroupMutate,
          }),
        },
        getGroupSettings: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
            data: options?.enabled
              ? {
                  groupId: 1,
                  newCardsPerDay: 20,
                  reviewsPerDay: 20,
                  isOverride: false,
                  allowHigher: true,
                  allowLower: true,
                  aiEnabled: true,
                  aiEnabledLocked: false,
                  autoPlayAudio: false,
                  autoPlayAudioLocked: false,
                  autoPlayAudioFront: false,
                  autoPlayAudioFrontLocked: false,
                  mnemonicMode: 'manual' as const,
                  mnemonicModeLocked: false,
                  locale: null,
                  localeLocked: false,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                }
              : undefined,
            refetch: vi.fn(),
          }),
        },
        updateGroupSettings: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
          }),
        },
        applyGroupSettingsToMembers: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
          }),
        },
        // "Flashcards by day" (tested in groups/GroupFlashcardsDay.test.tsx): still loading here.
        groupFlashcardDay: {
          useQuery: () => ({ data: undefined, error: null, isLoading: true }),
        },
      },
    },
  };
});

/**
 * A console.error fails the test: React's "two children with the same key" once let another
 * group's "Add students" stay on screen (and add to that group) while every test passed.
 */
const consoleErrors: unknown[][] = [];
beforeEach(() => {
  consoleErrors.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args); });
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(consoleErrors).toEqual([]);
});

function resetData() {
  settingsApplied = 0;
  groupsData = groups;
  usersData = users;
  groupMembers = [{ id: 1, name: 'Alice', email: 'alice@example.com', picture: null }];
  groupDecksData = [{ id: 10, name: 'Deck Assigned', cardCount: 34 }];
  gcCourses = undefined;
  gcStudents = undefined;
  window.localStorage.clear();
  for (const mock of [
    mockRefetchGroups, mockRefetchGroupMembers, mockRefetchGroupDecks, mockRemoveDeckFromGroupMutate,
    mockAssignDeckToGroupMutate, mockAddUserToGroupMutate, mockRemoveUserFromGroupMutate,
  ]) mock.mockClear();
}

describe('GroupManager', () => {
  beforeEach(resetData);

  it('lets admins remove assigned decks directly from group settings', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <MemoryRouter>
          <GroupManager />
        </MemoryRouter>
      );
    });

    await user.click(screen.getByRole('button', { name: /group one/i }));

    const assigned = screen.getByRole('region', { name: 'Assigned Decks' });
    const row = within(assigned).getByRole('link', { name: 'Deck Assigned' }).closest('tr')!;
    expect(row).toHaveTextContent('34');
    // Named for its deck: there is a Remove on every member and every deck.
    await user.click(within(row).getByRole('button', { name: 'Remove Deck Assigned' }));

    expect(mockRemoveDeckFromGroupMutate).toHaveBeenCalledWith({
      deckId: 10,
      groupId: 1,
    });
  });

  it('shows language as a dropdown with all supported locales in group settings modal', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <MemoryRouter>
          <GroupManager />
        </MemoryRouter>
      );
    });

    await user.click(screen.getByRole('button', { name: /group one/i }));
    await user.click(screen.getByRole('button', { name: /settings/i }));

    // The language field should be a combobox (select), not a text input
    const localeSelect = screen.getByRole('combobox', { name: /interface language/i });
    expect(localeSelect).toBeInTheDocument();

    // It should contain options for each supported locale
    expect(screen.getByRole('option', { name: /english/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /español/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /中文/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /none/i })).toBeInTheDocument();

    // Admin can select a specific language
    await user.selectOptions(localeSelect, 'es');
    expect((localeSelect as HTMLSelectElement).value).toBe('es');

    // Admin can reset to "none" (null)
    await user.selectOptions(localeSelect, '');
    expect((localeSelect as HTMLSelectElement).value).toBe('');
  });

  it('offers a group Manual only or Disabled mnemonics, with no cognate setting (v1.20.0)', async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(
        <MemoryRouter>
          <GroupManager />
        </MemoryRouter>
      );
    });

    await user.click(screen.getByRole('button', { name: /group one/i }));
    await user.click(screen.getByRole('button', { name: /settings/i }));

    expect(screen.getByText('Mnemonic generation')).toBeInTheDocument();
    const mode = screen.getAllByRole('combobox').find((select) => (select as HTMLSelectElement).value === 'manual')!;
    expect([...mode.querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent]))
      .toEqual([['manual', 'Manual only'], ['disabled', 'Disabled']]);
    expect(screen.queryByText(/cognate/i)).toBeNull();
  });

  it('refreshes members and shows confirmation when adding a user to a group', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <MemoryRouter>
          <GroupManager />
        </MemoryRouter>
      );
    });

    await user.click(screen.getByRole('button', { name: /group one/i }));

    const add = screen.getByRole('group', { name: 'Add students' });
    await user.type(within(add).getByLabelText('Search users'), 'bob');
    await user.click(within(add).getByRole('checkbox', { name: /bob/i }));
    await user.click(within(add).getByRole('button', { name: 'Add selected' }));

    expect(mockAddUserToGroupMutate).toHaveBeenCalledWith({
      groupId: 1,
      userIds: [2],
    });
    expect(mockRefetchGroupMembers).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Added 1 user(s) to the group.')).toBeInTheDocument();
    // The search and the ticks are cleared for the next ones.
    expect(within(add).getByLabelText('Search users')).toHaveValue('');
    expect(within(add).getByText('0 selected')).toBeInTheDocument();
  });

  it('says when the group\'s settings reached the students who joined', async () => {
    settingsApplied = 1;
    const user = userEvent.setup();

    await act(async () => {
      render(
        <MemoryRouter>
          <GroupManager />
        </MemoryRouter>
      );
    });

    await user.click(screen.getByRole('button', { name: /group one/i }));
    const add = screen.getByRole('group', { name: 'Add students' });
    await user.type(within(add).getByLabelText('Search users'), 'bob');
    await user.click(within(add).getByRole('checkbox', { name: /bob/i }));
    await user.click(within(add).getByRole('button', { name: 'Add selected' }));

    expect(await screen.findByText("Added 1 user(s) to the group. The group's settings were applied to 1 of them.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The lists, a page at a time
// ---------------------------------------------------------------------------

const day = (n: number) => Date.UTC(2026, 8, 1, 15) + n * 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Thirty members: Student 01…30, emails 20001…@students.school.test (their school IDs), joined on day n and last
 * active on day 31 - n; every tenth never active. Student 07 has a typed school ID; Student 30 is a teacher.
 */
const classMembers: MockUser[] = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  return {
    id: 100 + n,
    name: `Student ${pad(n)}`,
    email: n === 7 ? 'seven@example.com' : `${20000 + n}@students.school.test`,
    picture: null,
    role: n === 30 ? 'admin' : 'user',
    studentNumber: n === 7 ? '77707' : String(20000 + n),
    lastActiveAt: n % 10 === 0 ? null : day(31 - n),
    joinedAt: new Date(day(n)).toISOString(),
  };
});

function UserPage() {
  const location = useLocation();
  return <p>User page {location.pathname}{location.search}</p>;
}

/** The Groups tab at a URL, with a user's page to open. */
function renderAt(url: string, props: Parameters<typeof GroupManager>[0] = {}) {
  const router = createMemoryRouter([
    { path: '/admin', element: <GroupManager {...props} /> },
    { path: '/admin/users/:userId', element: <UserPage /> },
  ], { initialEntries: [url] });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

const region = (name: string) => screen.getByRole('region', { name });
const members = () => region('Members');
const memberTable = () => within(members()).getByRole('table', { name: 'Members' });
const memberNames = () => within(memberTable()).queryAllByRole('link').map((link) => link.textContent);
const addBox = () => screen.getByRole('group', { name: 'Add students' });

describe('GroupManager: the group in the URL', () => {
  beforeEach(resetData);

  it('opens the group the URL names, and picking one puts it in the URL', async () => {
    groupsData = [...groups, { id: 2, name: 'Group Two', description: null, memberCount: 0, deckCount: 0 }];
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=2');
    expect(screen.getByRole('heading', { level: 2, name: 'Group Two' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group Two' })).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: 'Group One' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Group One' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    // Replaced, not pushed: picking a group is not history.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('leaves a student\'s page\'s URL alone while kept under it, and shows the group that URL returns to', async () => {
    groupsData = [...groups, { id: 2, name: 'Group Two', description: null, memberCount: 0, deckCount: 0 }];
    // As the admin page keeps it: mounted (hidden) under a student's page opened from group 1.
    const router = createMemoryRouter([
      { path: '/admin/*', element: <GroupManager /> },
    ], { initialEntries: ['/admin?tab=groups&group=1', '/admin/users/5?from=group&group=1'], initialIndex: 1 });
    render(<RouterProvider router={router} />);

    // A Classroom import started on the Groups tab finishes now: it picks its new group, not the URL.
    act(() => imports.onCourseImported?.({
      group: { id: 2, name: 'Group Two' }, course: { name: 'Spanish 1' }, summary: { usersAssignedToGroup: 3 },
    }));
    expect(router.state.location.pathname).toBe('/admin/users/5');
    expect(router.state.location.search).toBe('?from=group&group=1');

    // Back to the group the page came from: the screen shows what the URL says.
    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('?tab=groups&group=1');
    expect(screen.getByRole('heading', { level: 2, name: 'Group One' })).toBeInTheDocument();
  });

  it('gives up the focus it was asked to give back when the group is not there', () => {
    const onReturnFocusDone = vi.fn();
    renderAt('/admin?tab=groups&group=99', { returnFocusUserId: 2, onReturnFocusDone });
    expect(screen.getByText('Select a group to manage its members and decks')).toBeInTheDocument();
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });
});

describe('GroupManager: members, a page at a time', () => {
  beforeEach(() => {
    resetData();
    groupMembers = classMembers;
    usersData = classMembers;
  });

  it('lists 25 by name, with each one\'s email, last activity and join date', () => {
    renderAt('/admin?tab=groups&group=1');
    expect(memberNames()).toHaveLength(25);
    expect(memberNames()[0]).toBe('Student 01');
    expect(within(members()).getByText('1–25 of 30')).toBeInTheDocument();
    const header = (name: string) => within(memberTable()).getByRole('columnheader', { name });
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    for (const name of ['Email', 'Last Active', 'Joined']) expect(header(name)).not.toHaveAttribute('aria-sort');

    const row = within(memberTable()).getByRole('link', { name: 'Student 10' }).closest('tr')!;
    expect(row).toHaveTextContent('20010@students.school.test');
    expect(row).toHaveTextContent('Never');
    expect(within(memberTable()).getByRole('link', { name: 'Student 01' }).closest('tr')).toHaveTextContent(
      new Date(day(30)).toLocaleDateString('en'),
    );
    expect(within(memberTable()).getByRole('link', { name: 'Student 01' }).closest('tr')).not.toHaveTextContent('Admin');
  });

  it('tags a teacher among the members', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=1');
    await user.click(within(members()).getByRole('button', { name: 'Next' }));
    const row = within(memberTable()).getByRole('link', { name: 'Student 30' }).closest('tr')!;
    expect(within(row).getByText('Admin')).toBeInTheDocument();
  });

  it('searches names, emails and school IDs (typed ones too), from the first page', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=1');
    await user.click(within(members()).getByRole('button', { name: 'Next' }));
    const search = within(members()).getByLabelText('Search members');
    await user.type(search, 'student 2');
    expect(memberNames()).toEqual(['Student 20', 'Student 21', 'Student 22', 'Student 23', 'Student 24', 'Student 25', 'Student 26', 'Student 27', 'Student 28', 'Student 29']);
    expect(within(members()).getByText('1–10 of 10')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, '20015');
    expect(memberNames()).toEqual(['Student 15']);
    await user.clear(search);
    await user.type(search, '77707');
    expect(memberNames()).toEqual(['Student 07']);
    await user.clear(search);
    await user.type(search, 'nobody');
    expect(within(memberTable()).getByRole('cell', { name: 'No members match' })).toBeInTheDocument();
  });

  it('sorts by any column, never-active last either way, and remembers the sort and page size', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=groups&group=1');
    const sortBy = (name: string) => user.click(within(memberTable()).getByRole('button', { name }));
    const header = (name: string) => within(memberTable()).getByRole('columnheader', { name });

    await user.selectOptions(within(members()).getByRole('combobox', { name: 'Members Show per page' }), 'all');
    await sortBy('Last Active');
    expect(header('Last Active')).toHaveAttribute('aria-sort', 'descending');
    expect(memberNames().slice(0, 2)).toEqual(['Student 01', 'Student 02']);
    expect(memberNames().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);
    await sortBy('Last Active');
    expect(memberNames().slice(0, 2)).toEqual(['Student 29', 'Student 28']);
    expect(memberNames().slice(-3)).toEqual(['Student 10', 'Student 20', 'Student 30']);

    await sortBy('Joined');
    expect(header('Joined')).toHaveAttribute('aria-sort', 'descending');
    expect(memberNames()[0]).toBe('Student 30');
    await sortBy('Email');
    expect(header('Email')).toHaveAttribute('aria-sort', 'ascending');
    expect(memberNames().at(-1)).toBe('Student 07');
    await sortBy('Name');
    await sortBy('Name');
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending');
    expect(within(memberTable()).getAllByRole('columnheader').filter((th) => th.hasAttribute('aria-sort'))).toHaveLength(1);

    await user.selectOptions(within(members()).getByRole('combobox', { name: 'Members Show per page' }), '10');
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.groupMembers')!)).toEqual({ pageSize: 10, sort: 'name', dir: 'desc' });
    first.unmount();

    // Another visit: the same size and sort; the search starts empty.
    renderAt('/admin?tab=groups&group=1');
    expect(memberNames()).toHaveLength(10);
    expect(memberNames()[0]).toBe('Student 30');
    expect(within(members()).getByText('1–10 of 30')).toBeInTheDocument();
    expect(within(members()).getByLabelText('Search members')).toHaveValue('');
  });

  it('opens a member\'s page from their name (a real link) or their row, with the way back to this group', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    const link = within(memberTable()).getByRole('link', { name: 'Student 03' });
    expect(link).toHaveAttribute('href', '/admin/users/103?from=group&group=1');
    await user.click(link);
    expect(screen.getByText('User page /admin/users/103?from=group&group=1')).toBeInTheDocument();

    await act(() => router.navigate(-1));
    const row = within(memberTable()).getByRole('link', { name: 'Student 04' }).closest('tr')!;
    await user.click(within(row).getAllByRole('cell')[1]);
    expect(router.state.location.pathname).toBe('/admin/users/104');
  });

  it('focuses the member the teacher came back from, on the page that holds them', () => {
    const onReturnFocusDone = vi.fn();
    renderAt('/admin?tab=groups&group=1', { returnFocusUserId: 128, onReturnFocusDone });
    expect(within(members()).getByText('26–30 of 30')).toBeInTheDocument();
    expect(within(memberTable()).getByRole('link', { name: 'Student 28' })).toHaveFocus();
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });

  it('removes a member, and puts focus on the Remove that takes their place', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=1');
    await user.click(within(memberTable()).getByRole('button', { name: 'Remove Student 02' }));
    expect(mockRemoveUserFromGroupMutate).toHaveBeenCalledWith({ userId: 102, groupId: 1 });

    // The list comes back without them.
    groupMembers = classMembers.filter((member) => member.id !== 102);
    act(() => store.bump());
    expect(memberNames()[1]).toBe('Student 03');
    expect(within(memberTable()).getByRole('button', { name: 'Remove Student 03' })).toHaveFocus();
  });

  it('keeps everyone in the "All" group', () => {
    groupsData = [{ id: 1, name: 'All', description: null, memberCount: 30, deckCount: 0 }];
    renderAt('/admin?tab=groups&group=1');
    expect(screen.getByText('Members cannot be removed from the All group.')).toBeInTheDocument();
    expect(within(memberTable()).getByRole('button', { name: 'Remove Student 01' })).toBeDisabled();
  });
});

describe('GroupManager: "Add students", a page at a time', () => {
  /** Alice is in the group; Bob and Student 01…38 are not (39 to add). */
  const everyone: MockUser[] = [
    ...users,
    ...Array.from({ length: 38 }, (_, i) => ({
      id: 200 + i + 1, name: `Student ${pad(i + 1)}`, email: `${30000 + i + 1}@students.school.test`, picture: null,
      studentNumber: String(30000 + i + 1),
    })),
  ];
  const addNames = () => within(addBox()).getAllByRole('checkbox').map((box) => (box.closest('tr')!.querySelector('label')!.textContent));
  const selectedCount = () => within(addBox()).getByText(/^\d+ selected/).textContent;

  beforeEach(() => {
    resetData();
    usersData = everyone;
  });

  it('searches (school IDs too) and sorts by name or email, and remembers its own page size', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=groups&group=1');
    // Ten at first: it sits above the members.
    expect(addNames()).toHaveLength(10);
    expect(addNames()[0]).toBe('Bob');
    expect(within(addBox()).getByText('1–10 of 39')).toBeInTheDocument();
    const nameHeader = within(addBox()).getByRole('columnheader', { name: 'Name' });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(addBox()).getByRole('button', { name: 'Name' }));
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    expect(addNames()[0]).toBe('Student 38');

    await user.type(within(addBox()).getByLabelText('Search users'), '30012');
    expect(addNames()).toEqual(['Student 12']);
    await user.clear(within(addBox()).getByLabelText('Search users'));

    await user.selectOptions(within(addBox()).getByRole('combobox', { name: 'Add students Show per page' }), '50');
    expect(addNames()).toHaveLength(39);
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.groupAddStudents')!)).toMatchObject({ pageSize: 50 });
    // The Members list keeps its own.
    expect(window.localStorage.getItem('libresrs.admin.groupMembers')).toBeNull();
    first.unmount();
    renderAt('/admin?tab=groups&group=1');
    expect(addNames()).toHaveLength(39);
  });

  it('ticks this page or everyone matching, as its buttons say, and adds them all', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=1');
    expect(selectedCount()).toBe('0 selected');

    await user.click(within(addBox()).getByRole('button', { name: 'Select this page (10)' }));
    expect(selectedCount()).toBe('10 selected');
    // A page all ticked: the same button unticks it.
    await user.click(within(addBox()).getByRole('button', { name: 'Deselect this page (10)' }));
    expect(selectedCount()).toBe('0 selected');
    await user.click(within(addBox()).getByRole('button', { name: 'Select this page (10)' }));
    // The ticks outlast the page, and the count says they are out of sight.
    await user.click(within(addBox()).getByRole('button', { name: 'Next' }));
    expect(within(addBox()).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(0);
    expect(selectedCount()).toBe('10 selected (10 not shown)');
    // Clear keeps the keyboard's focus (it stays, unavailable, with nothing ticked).
    const clear = within(addBox()).getByRole('button', { name: 'Clear selection' });
    await user.click(clear);
    expect(selectedCount()).toBe('0 selected');
    expect(clear).toBeInTheDocument();
    expect(clear).toHaveFocus();
    expect(clear).toHaveAttribute('aria-disabled', 'true');

    // Ticks hidden by a search are counted too: "Add selected" adds them.
    await user.click(within(addBox()).getByRole('checkbox', { name: /Student 10/ }));
    await user.type(within(addBox()).getByLabelText('Search users'), 'bob');
    await user.click(within(addBox()).getByRole('checkbox', { name: /Bob/ }));
    expect(selectedCount()).toBe('2 selected (1 not shown)');
    await user.click(clear);
    await user.clear(within(addBox()).getByLabelText('Search users'));

    // A search: "all" is everyone it matched, on every page.
    await user.type(within(addBox()).getByLabelText('Search users'), 'student 3');
    await user.click(within(addBox()).getByRole('button', { name: 'Select all 9 matching' }));
    expect(selectedCount()).toBe('9 selected');
    expect(within(addBox()).getByRole('button', { name: 'Deselect all 9 matching' })).toBeInTheDocument();
    // One page of them: no separate "this page".
    expect(within(addBox()).queryByRole('button', { name: /Select this page/ })).not.toBeInTheDocument();
    await user.clear(within(addBox()).getByLabelText('Search users'));

    await user.click(within(addBox()).getByRole('button', { name: 'Select all 39' }));
    // Ten on this page; the count says where the rest are.
    expect(selectedCount()).toBe('39 selected (29 not shown)');
    await user.click(within(addBox()).getByRole('button', { name: 'Add selected' }));
    const added = mockAddUserToGroupMutate.mock.calls[0][0] as { groupId: number; userIds: number[] };
    expect(added.groupId).toBe(1);
    expect([...added.userIds].sort((a, b) => a - b)).toEqual(everyone.filter((u) => u.id !== 1).map((u) => u.id));
  });

  it('says so when everyone is in the group already', () => {
    usersData = users.slice(0, 1);
    renderAt('/admin?tab=groups&group=1');
    expect(within(addBox()).getByText('Everyone is in this group already.')).toBeInTheDocument();
    expect(within(addBox()).getByRole('button', { name: 'Add selected' })).toBeDisabled();
  });

  it('starts again for another group: one list, nothing ticked, and it adds to the group on screen', async () => {
    groupsData = [...groups, { id: 2, name: 'Group Two', description: null, memberCount: 1, deckCount: 0 }];
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=1');
    await user.type(within(addBox()).getByLabelText('Search users'), 'student 0');
    await user.click(within(addBox()).getByRole('checkbox', { name: /Student 01/ }));
    expect(selectedCount()).toBe('1 selected');

    await user.click(screen.getByRole('button', { name: 'Group Two' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Group Two' })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Add students' })).toHaveLength(1);
    expect(selectedCount()).toBe('0 selected');
    expect(within(addBox()).getByLabelText('Search users')).toHaveValue('');
    expect(within(addBox()).getByRole('button', { name: 'Add selected' })).toBeDisabled();

    await user.click(within(addBox()).getByRole('checkbox', { name: /Student 02/ }));
    await user.click(within(addBox()).getByRole('button', { name: 'Add selected' }));
    expect(mockAddUserToGroupMutate).toHaveBeenCalledTimes(1);
    expect(mockAddUserToGroupMutate).toHaveBeenCalledWith({ groupId: 2, userIds: [202] });
    // Each list of the group on screen, once.
    for (const name of ['Members', 'Assigned Decks']) expect(screen.getAllByRole('region', { name })).toHaveLength(1);
    expect(screen.getAllByRole('table', { name: 'Members' })).toHaveLength(1);
  });

  it('names each pager for its list, so no two controls share a name', () => {
    groupDecksData = Array.from({ length: 12 }, (_, i) => ({ id: 300 + i, name: `Unidad ${i}`, cardCount: 10 }));
    groupMembers = [{ id: 1, name: 'Alice', email: 'alice@example.com', picture: null }];
    renderAt('/admin?tab=groups&group=1');
    const sizes = screen.getAllByRole('combobox', { name: /Show per page$/ });
    expect(sizes.map((box) => box.getAttribute('aria-labelledby')?.split(' ')[0])).toEqual([
      'group-add-title-1', 'group-members-title', 'group-decks-title',
    ]);
    expect(screen.getByRole('combobox', { name: 'Add students Show per page' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Members Show per page' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assigned Decks Show per page' })).toBeInTheDocument();
    // Previous and Next sit in a group named for the list and the rows it shows.
    const decksPager = screen.getByRole('group', { name: 'Assigned Decks 1–12 of 12' });
    expect(within(decksPager).getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('group', { name: 'Members 1–1 of 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Add students 1–10 of 39' })).toBeInTheDocument();
  });
});

describe('GroupManager: assigned decks, a page at a time', () => {
  /** Twelve decks: Unidad 01…12, with 10·n cards. */
  const unidades: MockDeck[] = Array.from({ length: 12 }, (_, i) => ({ id: 300 + i + 1, name: `Unidad ${pad(i + 1)}`, cardCount: (i + 1) * 10 }));
  const assigned = () => region('Assigned Decks');
  const deckNames = () => within(assigned()).queryAllByRole('link').map((link) => link.textContent);

  beforeEach(() => {
    resetData();
    groupDecksData = unidades;
  });

  it('searches by name, sorts by name or cards, pages, and remembers its own size and sort', async () => {
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=groups&group=1');
    expect(deckNames()).toHaveLength(12);
    expect(deckNames()[0]).toBe('Unidad 01');
    expect(within(assigned()).getByRole('columnheader', { name: 'Deck' })).toHaveAttribute('aria-sort', 'ascending');

    await user.click(within(assigned()).getByRole('button', { name: 'Cards' }));
    expect(within(assigned()).getByRole('columnheader', { name: 'Cards' })).toHaveAttribute('aria-sort', 'descending');
    expect(deckNames().slice(0, 2)).toEqual(['Unidad 12', 'Unidad 11']);

    await user.type(within(assigned()).getByLabelText('Search decks'), 'unidad 1');
    expect(deckNames()).toEqual(['Unidad 12', 'Unidad 11', 'Unidad 10']);
    await user.clear(within(assigned()).getByLabelText('Search decks'));
    await user.type(within(assigned()).getByLabelText('Search decks'), 'nada');
    expect(within(assigned()).getByRole('cell', { name: 'No decks match' })).toBeInTheDocument();
    await user.clear(within(assigned()).getByLabelText('Search decks'));

    await user.selectOptions(within(assigned()).getByRole('combobox', { name: 'Assigned Decks Show per page' }), '10');
    expect(deckNames()).toHaveLength(10);
    await user.click(within(assigned()).getByRole('button', { name: 'Next' }));
    expect(deckNames()).toEqual(['Unidad 02', 'Unidad 01']);
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.groupDecks')!)).toEqual({ pageSize: 10, sort: 'cards', dir: 'desc' });
    first.unmount();
    renderAt('/admin?tab=groups&group=1');
    expect(deckNames()).toHaveLength(10);
    expect(deckNames()[0]).toBe('Unidad 12');
  });

  it('links each deck to itself on the Decks tab, and removes one with focus on the next', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/admin?tab=groups&group=1');
    expect(within(assigned()).getByRole('link', { name: 'Unidad 03' })).toHaveAttribute('href', '/admin?tab=decks&deck=303');
    await user.click(within(assigned()).getByRole('button', { name: 'Remove Unidad 03' }));
    expect(mockRemoveDeckFromGroupMutate).toHaveBeenCalledWith({ deckId: 303, groupId: 1 });
    groupDecksData = unidades.filter((deck) => deck.id !== 303);
    act(() => store.bump());
    expect(within(assigned()).getByRole('button', { name: 'Remove Unidad 04' })).toHaveFocus();

    await user.click(within(assigned()).getByRole('link', { name: 'Unidad 05' }));
    expect(router.state.location.search).toBe('?tab=decks&deck=305');
  });

  it('says which deck it opens, and focuses that deck\'s name on the page that holds it when the teacher comes back', async () => {
    const onOpenDeck = vi.fn();
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=groups&group=1', { onOpenDeck });
    await user.selectOptions(within(assigned()).getByRole('combobox', { name: 'Assigned Decks Show per page' }), '10');
    await user.click(within(assigned()).getByRole('button', { name: 'Next' }));
    await user.click(within(assigned()).getByRole('link', { name: 'Unidad 11' }));
    expect(onOpenDeck).toHaveBeenCalledWith(311);
    expect(first.router.state.location.search).toBe('?tab=decks&deck=311');
    first.unmount();

    // Back from the Decks tab: the Groups tab afresh (page 1), asked to find the deck again.
    const onReturnFocusDone = vi.fn();
    renderAt('/admin?tab=groups&group=1', { returnFocusDeckId: 311, onReturnFocusDone });
    expect(within(assigned()).getByText('11–12 of 12')).toBeInTheDocument();
    expect(within(assigned()).getByRole('link', { name: 'Unidad 11' })).toHaveFocus();
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });
});

describe('GroupManager: the groups list', () => {
  /** Twelve periods, 20 + n members each; the "All" group has the most. */
  const periods: MockGroup[] = [
    { id: 1, name: 'All', description: 'Everyone', memberCount: 300, deckCount: 0 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 10 + i + 1, name: `Period ${i + 1}`, description: null, memberCount: 20 + i + 1, deckCount: 1 })),
  ];
  const groupTable = () => screen.getByRole('table', { name: 'Groups' });
  const groupNames = () => within(groupTable()).getAllByRole('button').filter((b) => !b.closest('thead')).map((b) => b.textContent);

  beforeEach(resetData);

  it('searches and sorts by name or by members, and pages only a long list', async () => {
    groupsData = periods;
    const user = userEvent.setup();
    const first = renderAt('/admin?tab=groups');
    // Names in their natural order ("Period 2" before "Period 10").
    expect(groupNames().slice(0, 4)).toEqual(['All', 'Period 1', 'Period 2', 'Period 3']);
    expect(groupNames()).toHaveLength(13);
    expect(screen.getByText('1–13 of 13')).toBeInTheDocument();

    await user.click(within(groupTable()).getByRole('button', { name: 'Members' }));
    expect(within(groupTable()).getByRole('columnheader', { name: 'Members' })).toHaveAttribute('aria-sort', 'descending');
    expect(groupNames().slice(0, 3)).toEqual(['All', 'Period 12', 'Period 11']);

    await user.type(screen.getByLabelText('Search groups'), 'period 1');
    expect(groupNames()).toEqual(['Period 12', 'Period 11', 'Period 10', 'Period 1']);
    await user.clear(screen.getByLabelText('Search groups'));
    // Not by the description, which the list does not show.
    await user.type(screen.getByLabelText('Search groups'), 'everyone');
    expect(within(groupTable()).getByRole('cell', { name: 'No groups match' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search groups'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Groups Show per page' }), '10');
    expect(groupNames()).toHaveLength(10);
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.groups')!)).toEqual({ pageSize: 10, sort: 'members', dir: 'desc' });
    first.unmount();

    // A short list: no pager.
    groupsData = periods.slice(0, 3);
    renderAt('/admin?tab=groups');
    expect(screen.queryByRole('combobox', { name: /Show per page/ })).not.toBeInTheDocument();
    expect(groupNames()).toEqual(['All', 'Period 2', 'Period 1']);
  });

  it('shows the group the URL picks on the page of the list that holds it, and then leaves the paging to the teacher', async () => {
    groupsData = periods;
    window.localStorage.setItem('libresrs.admin.groups', JSON.stringify({ pageSize: 10 }));
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&group=22');
    expect(screen.getByText('11–13 of 13')).toBeInTheDocument();
    expect(within(groupTable()).getByRole('button', { name: 'Period 12' })).toHaveAttribute('aria-current', 'true');
    await user.click(within(screen.getByRole('group', { name: 'Groups 11–13 of 13' })).getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1–10 of 13')).toBeInTheDocument();
    await user.click(within(groupTable()).getByRole('button', { name: 'Period 3' }));
    expect(screen.getByText('1–10 of 13')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Period 3' })).toBeInTheDocument();
  });
});

describe('GroupManager: a Google Classroom roster to import', () => {
  const roster = Array.from({ length: 32 }, (_, i) => ({ email: `${40000 + i + 1}@students.school.test`, fullName: `Alumno ${pad(i + 1)}` }));
  /** "Students to import (32 of 32 selected)", as the line reads. */
  const rosterCount = () => screen.getByText(/ of \d+ selected\)$/).textContent;

  beforeEach(() => {
    resetData();
    gcCourses = [{ id: 'c1', name: 'Spanish 1', section: 'Period 3', description: null }];
    gcStudents = roster;
  });
  afterEach(() => vi.restoreAllMocks());

  it('pages a long roster, and "Select all 32" means all 32, not the page', async () => {
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&classroom=connected');
    await user.click(await screen.findByRole('button', { name: /Spanish 1/ }));

    // All ticked at first; ten at a time (the form sits in the narrow column).
    expect(rosterCount()).toBe('Students to import (32 of 32 selected)');
    expect(screen.getByRole('button', { name: 'Import 32 students' })).toBeEnabled();
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    expect(screen.getByText('1–10 of 32')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Students to import Show per page' })).toHaveValue('10');

    await user.click(screen.getByRole('button', { name: 'Deselect all 32' }));
    expect(rosterCount()).toBe('Students to import (0 of 32 selected)');
    await user.click(screen.getByRole('button', { name: 'Select all 32' }));
    expect(rosterCount()).toBe('Students to import (32 of 32 selected)');

    // A search: its button ticks (or unticks) only the students it matched.
    await user.type(screen.getByLabelText('Search students to import'), 'alumno 1');
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Deselect all 10 matching' }));
    expect(rosterCount()).toBe('Students to import (22 of 32 selected)');
    expect(screen.getByRole('button', { name: 'Import 22 students' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search students to import'), '9');
    await user.click(screen.getByRole('checkbox', { name: /Alumno 19/ }));
    expect(rosterCount()).toBe('Students to import (23 of 32 selected)');

    // The page size is its own, and remembered.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Students to import Show per page' }), '50');
    expect(JSON.parse(window.localStorage.getItem('libresrs.admin.classroomImport')!)).toEqual({ pageSize: 50 });
  });

  it('shows a short roster whole, with no search or pager', async () => {
    gcStudents = roster.slice(0, 8);
    const user = userEvent.setup();
    renderAt('/admin?tab=groups&classroom=connected');
    await user.click(await screen.findByRole('button', { name: /Spanish 1/ }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.queryByLabelText('Search students to import')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Show per page/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect all 8' })).toBeInTheDocument();
  });
});
