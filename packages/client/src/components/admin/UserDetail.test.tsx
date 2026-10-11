// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserDetail from './UserDetail';

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as { message: string } | null,
  inputs: [] as unknown[],
  /** admin.getGroups, as the Groups tab left it in the cache (undefined: not loaded). */
  groups: undefined as { id: number; name: string }[] | undefined,
  groupsAsked: [] as { enabled?: boolean }[],
}));

// The PIN panel is tested on its own (UserPinPanel.test.tsx).
vi.mock('./UserPinPanel', () => ({ default: () => null }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    admin: {
      userDetail: {
        useQuery: (input: unknown) => {
          h.inputs.push(input);
          return { data: h.data, error: h.error };
        },
      },
      getGroups: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          h.groupsAsked.push(options ?? {});
          return { data: options?.enabled === false ? undefined : h.groups };
        },
      },
    },
  },
}));

const DAYS = Array.from({ length: 14 }, (_, i) => `2026-09-${String(11 + i).padStart(2, '0')}`);

const detail = {
  user: {
    id: 2, name: 'Ana', email: '123456@students.school.test', picture: null, role: 'user' as const,
    createdAt: Date.parse('2026-08-12T16:00:00Z'), lastActiveAt: Date.parse('2026-09-24T19:00:00Z'),
    studentNumber: '123456', studentNumberSetByTeacher: false,
  },
  groups: [{ id: 5, name: 'Period 1' }, { id: 7, name: 'All' }],
  settings: { newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: false, limitRule: 'higher' as const },
  finishDays: DAYS,
  allDoneDays: ['2026-09-24'],
  flashcards: [{
    id: 1, name: 'Unit 1', cardCount: 120, learned: 45, dueToday: 12, newToday: 20, reviewsToday: 4, newLimit: 20, reviewLimit: 20,
    reviews: 300, correctReviews: 250, lastStudiedAt: Date.parse('2026-09-24T18:00:00Z'), finishedDays: ['2026-09-21', '2026-09-24'],
  }],
  conjugation: [{ deckId: 1, deckName: 'Unit 1', mastered: 12, total: 102, rounds: 4, lastPlayedAt: Date.parse('2026-09-23T18:00:00Z'), daysPractised: 3 }],
  labs: [
    { id: 1, title: 'Lab semana01', active: true, status: 'done', reason: null, attempts: 1, submittedAt: Date.parse('2026-09-22T18:00:00Z'), pausesAnswered: 90, pausesCounted: 100, needed: 75 },
    { id: 2, title: 'Lab semana02', active: true, status: 'redo', reason: null, attempts: 2, submittedAt: Date.parse('2026-09-23T18:00:00Z'), pausesAnswered: 40, pausesCounted: 100, needed: 75 },
    { id: 3, title: 'Lab semana03', active: true, status: 'check', reason: 'no-mic', attempts: 1, submittedAt: Date.parse('2026-09-24T18:00:00Z'), pausesAnswered: null, pausesCounted: null, needed: null },
    { id: 4, title: 'Lab semana04', active: true, status: 'todo', reason: null, attempts: 0, submittedAt: null, pausesAnswered: null, pausesCounted: null, needed: null },
  ],
  speaking: [
    { id: 1, title: 'Cuento', active: true, attempts: 2, lastSubmittedAt: Date.parse('2026-09-23T18:00:00Z'), durationMs: 29_000, score: 87.5, gradedBy: 'teacher', gradedAt: Date.parse('2026-09-24T01:00:00Z') },
    { id: 2, title: 'Escalera', active: true, attempts: 1, lastSubmittedAt: Date.parse('2026-09-24T18:00:00Z'), durationMs: 10_000, score: null, gradedBy: null, gradedAt: null },
    { id: 3, title: 'Presentación', active: true, attempts: 0, lastSubmittedAt: null, durationMs: null, score: null, gradedBy: null, gradedAt: null },
  ],
};

function ListProbe() {
  const location = useLocation();
  return <p>List {location.search} {JSON.stringify(location.state)}</p>;
}

function renderDetailView(entry: string, props: Partial<Parameters<typeof UserDetail>[0]> = {}) {
  const handlers = { onShowHistory: vi.fn(), onEditSettings: vi.fn(), onToggleRole: vi.fn() };
  const router = createMemoryRouter([
    { path: '/admin/users/:userId', element: <UserDetail userId={2} {...handlers} {...props} /> },
    { path: '/admin', element: <ListProbe /> },
  ], { initialEntries: [entry] });
  const view = render(<RouterProvider router={router} />);
  return { handlers, unmount: view.unmount };
}

function renderDetail(props: Partial<Parameters<typeof UserDetail>[0]> = {}, entry = '/admin/users/2?sort=active&dir=desc&q=an') {
  return renderDetailView(entry, props).handlers;
}

describe('UserDetail', () => {
  beforeEach(() => {
    h.data = detail;
    h.error = null;
    h.inputs = [];
    h.groups = undefined;
    h.groupsAsked = [];
  });

  it('opens on the user: focus on their name, who they are, and their limits', () => {
    renderDetail();
    const heading = screen.getByRole('heading', { level: 2, name: 'Ana' });
    expect(heading).toHaveFocus();
    expect(h.inputs[0]).toMatchObject({ userId: 2 });

    // The role in words the teacher reads (translated), not the database's 'user'.
    expect(screen.getByText('Student')).toBeInTheDocument();
    expect(screen.queryByText('user')).not.toBeInTheDocument();
    const facts = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(facts('Email')).toHaveTextContent('123456@students.school.test');
    expect(facts('School ID')).toHaveTextContent('123456');
    expect(facts('Groups')).toHaveTextContent('Period 1, All');
    expect(facts('Study Limits')).toHaveTextContent('20 new / 20 reviews');
    expect(facts('Study Limits')).toHaveTextContent('Override');
    expect(facts('Study Limits')).toHaveTextContent('User can set higher');
  });

  it('shows flashcards per deck with the last 14 days of "All Done!"', () => {
    renderDetail();
    const section = screen.getByRole('region', { name: 'Flashcards' });
    const row = within(section).getByRole('rowheader', { name: 'Unit 1' }).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('45 of 120');
    expect(cells[1]).toHaveTextContent('12');
    expect(cells[2]).toHaveTextContent('20/20 new, 4/20 reviews');
    // Two of fourteen squares are green; a screen reader gets the dates.
    expect(cells[4]).toHaveTextContent('2');
    expect(cells[4]).toHaveTextContent('9/21, 9/24');
    expect(within(section).getByRole('columnheader', { name: '“All Done!” in the last 14 days' })).toBeInTheDocument();
    // v1.18.0: the days nothing was left in any deck, under the decks.
    const all = within(section).getByRole('rowheader', { name: 'All flashcards' }).closest('tr')!;
    const allCells = within(all).getAllByRole('cell');
    expect(allCells[0]).toHaveTextContent('Days with nothing left in any deck');
    expect(allCells[1]).toHaveTextContent('1');
    expect(allCells[1]).toHaveTextContent('9/24');
  });

  it('shows conjugation, labs with their v1.15 status and speaking grades', () => {
    renderDetail();
    const quiz = within(screen.getByRole('region', { name: 'Conjugation' })).getByRole('rowheader', { name: 'Unit 1' }).closest('tr')!;
    expect(quiz).toHaveTextContent('12 of 102');
    expect(within(quiz).getAllByRole('cell')[2]).toHaveTextContent('3');

    const labs = screen.getByRole('region', { name: 'Labs' });
    const status = (title: string) => within(labs).getByRole('rowheader', { name: title }).closest('tr')!;
    expect(status('Lab semana01')).toHaveTextContent('Done');
    expect(status('Lab semana01')).toHaveTextContent('90 of 100');
    expect(status('Lab semana02')).toHaveTextContent('Needs redo');
    expect(status('Lab semana03')).toHaveTextContent('Check it · No microphone');
    expect(status('Lab semana03')).toHaveTextContent('—');
    expect(status('Lab semana04')).toHaveTextContent('Not done yet');

    const speaking = screen.getByRole('region', { name: 'Speaking' });
    const task = (title: string) => within(speaking).getByRole('rowheader', { name: title }).closest('tr')!;
    expect(task('Cuento')).toHaveTextContent('87.5 out of 100');
    expect(task('Escalera')).toHaveTextContent('Not graded yet.');
    expect(within(task('Presentación')).getAllByRole('cell')[2]).toHaveTextContent('—');

  });

  it('has core\'s sections only, and only the role chip, with no extension in this build', () => {
    renderDetail();
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'))).toEqual([
      'user-detail-flashcards', 'user-detail-conjugation', 'user-detail-labs', 'user-detail-speaking',
    ]);
    const role = screen.getByText('Student');
    expect(role.nextElementSibling).toBeNull();
  });

  it('keeps the Users tab actions', async () => {
    const user = userEvent.setup();
    const handlers = renderDetail();
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(handlers.onShowHistory).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handlers.onEditSettings).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Promote' }));
    expect(handlers.onToggleRole).toHaveBeenCalledWith({ id: 2, name: 'Ana', role: 'user' });
  });

  it('goes back to the Users list with its search and sort', async () => {
    const user = userEvent.setup();
    renderDetail();
    expect(screen.queryByRole('link', { name: /Back to dashboard/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Back to users/ }));
    // The admin page puts focus on the name (for the browser's Back too): the link carries no state for it.
    expect(screen.getByText(/^List/)).toHaveTextContent('List ?sort=active&dir=desc&q=an&tab=users null');
  });

  it('goes back to the Dashboard when opened from its User Activity, with that panel\'s search and page', async () => {
    const user = userEvent.setup();
    renderDetail({}, '/admin/users/2?from=dashboard&q=an&page=2');
    expect(screen.queryByRole('link', { name: /Back to users/ })).not.toBeInTheDocument();
    const back = screen.getByRole('link', { name: /Back to dashboard/ });
    // In the link itself, so a new tab (or a reload once back) finds the panel as it was.
    expect(back).toHaveAttribute('href', '/admin?tab=dashboard&q=an&page=2');
    await user.click(back);
    expect(screen.getByText(/^List/)).toHaveTextContent('List ?tab=dashboard&q=an&page=2 null');
  });

  it('goes back to the Dashboard alone when it had no search or page', () => {
    renderDetail({}, '/admin/users/2?from=dashboard');
    expect(screen.getByRole('link', { name: /Back to dashboard/ })).toHaveAttribute('href', '/admin?tab=dashboard');
  });

  it('goes back to the group it was opened from, by the group\'s name', async () => {
    h.groups = [{ id: 5, name: 'Period 1' }, { id: 9, name: 'Period 3' }];
    const user = userEvent.setup();
    renderDetail({}, '/admin/users/2?from=group&group=9');
    expect(screen.queryByRole('link', { name: /Back to users/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Back to dashboard/ })).not.toBeInTheDocument();
    // The Groups tab's list names it (Ana is not even in that group any more).
    const back = screen.getByRole('link', { name: '← Back to Period 3' });
    expect(back).toHaveAttribute('href', '/admin?tab=groups&group=9');
    await user.click(back);
    expect(screen.getByText(/^List/)).toHaveTextContent('List ?tab=groups&group=9 null');
  });

  it('names the group from the user\'s own groups when the list is not loaded, and says "group" until then', () => {
    renderDetail({}, '/admin/users/2?from=group&group=5');
    expect(screen.getByRole('link', { name: '← Back to Period 1' })).toHaveAttribute('href', '/admin?tab=groups&group=5');
    // The groups are asked for only when a group is where Back goes.
    expect(h.groupsAsked.at(-1)).toEqual({ enabled: true });
  });

  it('says "Back to group" while nothing names it, and goes to the Groups tab without a group it cannot read', () => {
    h.data = undefined;
    const first = renderDetailView('/admin/users/2?from=group&group=5');
    expect(screen.getByRole('link', { name: '← Back to group' })).toHaveAttribute('href', '/admin?tab=groups&group=5');
    first.unmount();
    renderDetailView('/admin/users/2?from=group&group=abc');
    expect(screen.getByRole('link', { name: '← Back to group' })).toHaveAttribute('href', '/admin?tab=groups');
  });

  it('does not ask for the groups when it was opened from elsewhere', () => {
    renderDetail();
    expect(h.groupsAsked.every((options) => options.enabled === false)).toBe(true);
  });

  it('says where Back goes while loading and on an error too', () => {
    h.data = undefined;
    renderDetail({}, '/admin/users/2?from=dashboard');
    expect(screen.getByRole('link', { name: /Back to dashboard/ })).toBeInTheDocument();
  });

  it('says so for a user with nothing yet', () => {
    h.data = {
      ...detail,
      user: { ...detail.user, studentNumber: null, lastActiveAt: null },
      groups: [], flashcards: [], conjugation: [], labs: [], speaking: [],
      settings: { ...detail.settings, isOverride: false, limitRule: 'free' },
    };
    renderDetail();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('No decks assigned yet')).toBeInTheDocument();
    expect(screen.getByText('No conjugation quiz is on for these decks.')).toBeInTheDocument();
    expect(screen.getByText('No labs for this user.')).toBeInTheDocument();
    expect(screen.getByText('No speaking tasks for this user.')).toBeInTheDocument();
    expect(screen.queryByText('Override')).not.toBeInTheDocument();
  });

  it('shows the error and a way back when the user is not found', () => {
    h.data = undefined;
    h.error = { message: 'User not found' };
    renderDetail();
    expect(screen.getByRole('alert')).toHaveTextContent('User not found');
    expect(screen.getByRole('link', { name: /Back to users/ })).toBeInTheDocument();
  });
});
