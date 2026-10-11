// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GroupFlashcardsDay, { GROUP_FLASHCARDS_STORAGE_KEY } from './GroupFlashcardsDay';

type Input = { groupId: number; day?: string };
const h = vi.hoisted(() => ({
  calls: [] as Input[],
  data: undefined as unknown,
  error: null as { message: string } | null,
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    admin: {
      groupFlashcardDay: {
        useQuery: (input: Input) => {
          h.calls.push(input);
          return { data: h.data, error: h.error, isLoading: h.data === undefined && !h.error };
        },
      },
    },
  },
}));

const cell = (deckId: number, fields: Partial<Record<string, unknown>> = {}) => ({
  deckId, finishedAt: null, finishes: 0, newCards: 0, reviews: 0, answers: 0, minutes: 0,
  medianFirstMs: null, easyNew: 0, fast: false, allEasy: false, newLimit: 20, lowLimit: false, ...fields,
});

const day = {
  day: '2026-09-24',
  groupNewLimit: 20,
  decks: [{ id: 1, name: 'Unit 1' }, { id: 2, name: 'Unit 2' }],
  students: [
    {
      id: 2, name: 'Ana', email: 'ana@example.com', allDone: null,
      cells: [
        cell(1, { finishedAt: Date.parse('2026-09-24T17:05:00Z'), finishes: 1, newCards: 20, answers: 64, minutes: 12, medianFirstMs: 6_200 }),
        cell(2, { newCards: 3, answers: 9 }),
      ],
    },
    {
      id: 3, name: 'Beto', email: 'beto@example.com', allDone: null,
      cells: [cell(1, { newLimit: 5, lowLimit: true }), cell(2)],
    },
  ],
};

function UserPage() {
  const location = useLocation();
  return <p>User page {location.pathname}{location.search}</p>;
}

/** The grid on the Groups tab, with a user's page to open. */
function renderGrid(props: Partial<ComponentProps<typeof GroupFlashcardsDay>> = {}) {
  const router = createMemoryRouter([
    { path: '/admin', element: <GroupFlashcardsDay groupId={5} {...props} /> },
    { path: '/admin/users/:userId', element: <UserPage /> },
  ], { initialEntries: ['/admin?tab=groups&group=5'] });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

describe('GroupFlashcardsDay', () => {
  beforeEach(() => {
    h.calls = [];
    h.data = day;
    h.error = null;
    window.localStorage.clear();
  });

  it('shows who finished each deck, what they did, and a low limit', () => {
    renderGrid();

    expect(screen.getByRole('heading', { name: 'Flashcards by day' })).toBeInTheDocument();
    expect(screen.getByText(/^A check means the student reached “All Done!” in that deck that day\./))
      .toHaveTextContent('“All flashcards” means nothing was left in any of the student’s decks.');
    // The server's day fills the date input.
    expect(screen.getByLabelText('Day')).toHaveValue('2026-09-24');

    const table = screen.getByRole('table', { name: 'Flashcards by day' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers[1]).toHaveTextContent('All flashcards');
    expect(headers[1]).toHaveTextContent('0 of 2 finished');
    expect(headers[2]).toHaveTextContent('Unit 1');
    expect(headers[2]).toHaveTextContent('1 of 2 finished');
    expect(headers[3]).toHaveTextContent('0 of 2 finished');

    const ana = within(table).getByRole('rowheader', { name: 'Ana' }).closest('tr')!;
    const [all, finished, studied] = within(ana).getAllByRole('cell');
    // Unit 1 done, Unit 2 not: not all her flashcards.
    expect(all).toHaveTextContent('—');
    const at = new Date(Date.parse('2026-09-24T17:05:00Z')).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    expect(finished).toHaveTextContent(`Finished ${at}`);
    expect(finished).toHaveTextContent('20 new · 64 answers · 12 min');
    expect(studied).toHaveTextContent('Not finished');
    // Nine quick answers are still some time: never "0 min".
    expect(studied).toHaveTextContent('3 new · 9 answers · <1 min');
    // An honest pace has no marks.
    expect(within(finished).queryByText(/Fast|Easy on/)).not.toBeInTheDocument();

    const beto = within(table).getByRole('rowheader', { name: 'Beto' }).closest('tr')!;
    const [, low, nothing] = within(beto).getAllByRole('cell');
    expect(low).toHaveTextContent('—');
    const chip = within(low).getByText('limit 5', { exact: false, selector: 'span[title]' });
    const why = "This student's new-card limit for this deck is 5, below the group's 20.";
    expect(chip).toHaveAttribute('title', why);
    // Said to a screen reader too.
    expect(within(chip).getByText(`: ${why}`)).toHaveClass('sr-only');
    expect(nothing).toHaveTextContent('—');
    expect(within(nothing).queryByText(/limit/)).not.toBeInTheDocument();
  });

  it('marks a day whose cards went by too fast, or nearly all Easy, as the pace rule does', () => {
    h.data = {
      ...day,
      students: [
        {
          id: 2, name: 'Ana', email: 'ana@example.com', allDone: null,
          cells: [
            cell(1, {
              finishedAt: Date.parse('2026-09-24T17:05:00Z'), finishes: 1, newCards: 20, answers: 20, minutes: 0,
              medianFirstMs: 374, easyNew: 20, fast: true, allEasy: true,
            }),
            // Quick, but not by the rule (the server decides): no marks.
            cell(2, { newCards: 12, answers: 12, medianFirstMs: 1_600, easyNew: 3 }),
          ],
        },
      ],
    };
    renderGrid();
    const table = screen.getByRole('table', { name: 'Flashcards by day' });
    const ana = within(table).getByRole('rowheader', { name: 'Ana' }).closest('tr')!;
    const [, masher, quick] = within(ana).getAllByRole('cell');
    expect(masher).toHaveTextContent('20 new · 20 answers · <1 min');

    // 374 ms is shown rounded up: never faster than the student was.
    const fast = within(masher).getByText('Fast: 0.4 s a card', { exact: false, selector: 'span[title]' });
    const why = "Half of today's first answers in this deck took less than 0.4 s.";
    expect(fast).toHaveAttribute('title', why);
    expect(within(fast).getByText(`: ${why}`)).toHaveClass('sr-only');
    expect(within(masher).getByText('Easy on 20 of 20 new cards')).toBeInTheDocument();

    expect(within(quick).queryByText(/Fast|Easy on/)).not.toBeInTheDocument();
  });

  it('marks who finished ALL their flashcards that day, with the time (v1.18.0)', () => {
    h.data = {
      ...day,
      students: [
        { ...day.students[0], allDone: Date.parse('2026-09-24T18:10:00Z') },
        day.students[1],
      ],
    };
    renderGrid();
    const table = screen.getByRole('table', { name: 'Flashcards by day' });
    expect(within(table).getByRole('columnheader', { name: /All flashcards/ })).toHaveTextContent('1 of 2 finished');
    const ana = within(table).getByRole('rowheader', { name: 'Ana' }).closest('tr')!;
    const at = new Date(Date.parse('2026-09-24T18:10:00Z')).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    expect(within(ana).getAllByRole('cell')[0]).toHaveTextContent(`Finished ${at}`);
    const beto = within(table).getByRole('rowheader', { name: 'Beto' }).closest('tr')!;
    expect(within(beto).getAllByRole('cell')[0]).toHaveTextContent('—');
  });

  it('asks for today first, then for the day picked, and today again when cleared', () => {
    renderGrid();
    expect(h.calls.at(-1)).toEqual({ groupId: 5, day: undefined });

    const input = screen.getByLabelText('Day');
    fireEvent.change(input, { target: { value: '2026-09-23' } });
    expect(h.calls.at(-1)).toEqual({ groupId: 5, day: '2026-09-23' });
    expect(input).toHaveValue('2026-09-23');

    fireEvent.change(input, { target: { value: '' } });
    expect(h.calls.at(-1)).toEqual({ groupId: 5, day: undefined });
  });

  it('says so when the group has no decks or no students', () => {
    h.data = { ...day, decks: [], students: [] };
    const { unmount } = renderGrid();
    expect(screen.getByText('No decks are assigned to this group.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    unmount();

    h.data = { ...day, students: [] };
    renderGrid();
    expect(screen.getByText('No members yet')).toBeInTheDocument();
  });

  it('waits while loading', () => {
    h.data = undefined;
    renderGrid();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('says why it cannot load, and gives up the focus it was asked to give back', () => {
    h.data = undefined;
    h.error = { message: 'Group not found' };
    const onReturnFocusDone = vi.fn();
    renderGrid({ returnFocusUserId: 2, onReturnFocusDone });
    expect(screen.getByRole('alert')).toHaveTextContent('Group not found');
    // Not left waiting: a later grid (another group's) must not take focus when it loads.
    expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
  });

  describe('a page of students at a time', () => {
    /** Thirty students: Student 01…30. Even ones finished Unit 1 (the higher, the later and the more answers); every third studied Unit 2. */
    const many = {
      ...day,
      students: Array.from({ length: 30 }, (_, i) => {
        const n = i + 1;
        return {
          id: 100 + n,
          name: `Student ${String(n).padStart(2, '0')}`,
          email: `${20000 + n}@students.school.test`,
          // Every fourth finished all their flashcards (the higher, the earlier).
          allDone: n % 4 === 0 ? Date.parse('2026-09-24T19:00:00Z') - n * 60_000 : null,
          cells: [
            n % 2 === 0
              ? cell(1, { finishedAt: Date.parse('2026-09-24T17:00:00Z') + n * 60_000, finishes: 1, newCards: 20, answers: 30 + n })
              : cell(1),
            n % 3 === 0 ? cell(2, { newCards: 2, answers: n }) : cell(2),
          ],
        };
      }),
    };
    const table = () => screen.getByRole('table', { name: 'Flashcards by day' });
    const names = () => within(table()).queryAllByRole('link').map((link) => link.textContent);
    const header = (name: RegExp | string) => within(table()).getByRole('columnheader', { name });

    beforeEach(() => {
      h.data = many;
    });

    it('shows 25 by name, then pages; a new page size is remembered on this device', async () => {
      const user = userEvent.setup();
      const first = renderGrid();
      expect(names()).toHaveLength(25);
      expect(names()[0]).toBe('Student 01');
      expect(header(/^Student/)).toHaveAttribute('aria-sort', 'ascending');
      expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(names()).toEqual(['Student 26', 'Student 27', 'Student 28', 'Student 29', 'Student 30']);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Flashcards by day Show per page' }), '10');
      expect(names()).toHaveLength(10);
      expect(JSON.parse(window.localStorage.getItem(GROUP_FLASHCARDS_STORAGE_KEY)!)).toEqual({ pageSize: 10 });
      first.unmount();

      renderGrid();
      expect(names()).toHaveLength(10);
      expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
    });

    it('searches students by name or email (a school ID in it), from the first page', async () => {
      const user = userEvent.setup();
      renderGrid();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      const search = screen.getByLabelText('Search students');
      await user.type(search, 'student 1');
      expect(names()).toEqual(['Student 10', 'Student 11', 'Student 12', 'Student 13', 'Student 14', 'Student 15', 'Student 16', 'Student 17', 'Student 18', 'Student 19']);
      await user.clear(search);
      await user.type(search, '20027');
      expect(names()).toEqual(['Student 27']);
      await user.clear(search);
      await user.type(search, 'nobody');
      expect(within(table()).getByRole('cell', { name: 'No students match' })).toBeInTheDocument();
      // The deck headers still count the whole group.
      expect(header(/Unit 1/)).toHaveTextContent('15 of 30 finished');
    });

    it('sorts by a deck: finished first (the most work first), then studied, and nothing last either way', async () => {
      const user = userEvent.setup();
      renderGrid();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Flashcards by day Show per page' }), 'all');
      await user.click(within(table()).getByRole('button', { name: 'Unit 1' }));
      expect(header(/Unit 1/)).toHaveAttribute('aria-sort', 'descending');
      expect(header(/^Student/)).not.toHaveAttribute('aria-sort');
      expect(names().slice(0, 3)).toEqual(['Student 30', 'Student 28', 'Student 26']);
      // The fifteen who did nothing in it, by name, last.
      expect(names().slice(15, 18)).toEqual(['Student 01', 'Student 03', 'Student 05']);
      await user.click(within(table()).getByRole('button', { name: 'Unit 1' }));
      expect(header(/Unit 1/)).toHaveAttribute('aria-sort', 'ascending');
      expect(names().slice(0, 2)).toEqual(['Student 02', 'Student 04']);
      expect(names().slice(15, 17)).toEqual(['Student 01', 'Student 03']);

      // Unit 2: studied, not finished; the most answers first.
      await user.click(within(table()).getByRole('button', { name: 'Unit 2' }));
      expect(names().slice(0, 3)).toEqual(['Student 30', 'Student 27', 'Student 24']);
      expect(JSON.parse(window.localStorage.getItem(GROUP_FLASHCARDS_STORAGE_KEY)!)).toMatchObject({ sort: 'deck-2', dir: 'desc' });

      // By student, Z to A.
      await user.click(within(table()).getByRole('button', { name: 'Student' }));
      await user.click(within(table()).getByRole('button', { name: 'Student' }));
      expect(header(/^Student/)).toHaveAttribute('aria-sort', 'descending');
      expect(names()[0]).toBe('Student 30');

      // All flashcards: those who finished all first, the earliest on top; the rest by name.
      await user.click(within(table()).getByRole('button', { name: 'All flashcards' }));
      expect(header(/All flashcards/)).toHaveAttribute('aria-sort', 'descending');
      expect(names().slice(0, 3)).toEqual(['Student 28', 'Student 24', 'Student 20']);
      expect(names().slice(7, 9)).toEqual(['Student 01', 'Student 02']);
    });

    it('opens a student\'s page from their name, saying so first; Back to the group finds the name on its page', async () => {
      const onOpenUser = vi.fn();
      const user = userEvent.setup();
      const { router, unmount } = renderGrid({ onOpenUser });
      await user.click(screen.getByRole('button', { name: 'Next' }));
      const link = screen.getByRole('link', { name: 'Student 27' });
      expect(link).toHaveAttribute('href', '/admin/users/127?from=group&group=5');
      await user.click(link);
      expect(onOpenUser).toHaveBeenCalledTimes(1);
      expect(router.state.location.pathname).toBe('/admin/users/127');
      expect(router.state.location.search).toBe('?from=group&group=5');
      unmount();

      // Back, on a grid shown afresh (page 1): the page that holds the name, then the name.
      const onReturnFocusDone = vi.fn();
      renderGrid({ returnFocusUserId: 127, onReturnFocusDone });
      expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Student 27' })).toHaveFocus();
      expect(onReturnFocusDone).toHaveBeenCalledTimes(1);
    });

    it('opens a student\'s page from anywhere on the row', async () => {
      const user = userEvent.setup();
      const { router } = renderGrid();
      const row = within(table()).getByRole('rowheader', { name: 'Student 04' }).closest('tr')!;
      await user.click(within(row).getAllByRole('cell')[1]);
      expect(router.state.location.pathname).toBe('/admin/users/104');
    });
  });
});
