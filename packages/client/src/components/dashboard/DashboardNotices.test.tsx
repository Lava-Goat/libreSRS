// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The dashboard's notice cards and their fold (v1.18.0): one button switches
 * between the full cards and a row of chips, this browser remembers which,
 * a chip keeps its count and stays a link, and a browser that refuses
 * localStorage still folds.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardNotices } from './DashboardNotices';
import { NOTICES_FOLDED_KEY } from './noticesFold';
import { useDashboardNotices } from './useDashboardNotices';

const h = vi.hoisted(() => ({
  vocab: undefined as unknown,
  labs: undefined as unknown,
  speaking: undefined as unknown,
  signups: undefined as unknown,
  signupsEnabled: vi.fn(),
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    vocab: { listOpenTests: { useQuery: () => ({ data: h.vocab }) } },
    labs: { list: { useQuery: () => ({ data: h.labs }) } },
    speaking: { list: { useQuery: () => ({ data: h.speaking }) } },
    signups: {
      list: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          h.signupsEnabled(options.enabled);
          return { data: options.enabled ? h.signups : undefined };
        },
      },
    },
  },
}));

const lab = (id: number, status: string | null, submittedAt: string | null = null) => ({ id, title: `Lab ${id}`, status, submittedAt });
const sheet = (id: number, title: string, myDates: string[], picksPerStudent = 1, open = true) => ({ id, title, open, picksPerStudent, myDates });

function Notices({ isAdmin = false }: { isAdmin?: boolean }) {
  return <DashboardNotices notices={useDashboardNotices(isAdmin)} />;
}
const renderNotices = (isAdmin = false) => render(<MemoryRouter><Notices isAdmin={isAdmin} /></MemoryRouter>);
const fold = () => screen.getByRole('button', { name: 'Details' });

beforeEach(() => {
  window.localStorage.clear();
  h.vocab = [{ id: 1 }, { id: 2 }];
  // Two to do (never done; to redo), one waiting for the teacher, one done.
  h.labs = [lab(1, 'todo'), lab(2, 'redo'), lab(3, 'check'), lab(4, 'done', '2026-10-01T15:00:00.000Z')];
  h.speaking = [{ id: 1, submittedAt: '2026-10-01T15:00:00.000Z' }];
  h.signups = [sheet(5, 'Show and tell', [])];
  h.signupsEnabled.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('the notices, unfolded (as before v1.18, and with nothing remembered)', () => {
  it('shows every full card, and a Details button that says they are shown', () => {
    renderNotices();
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    const cards = document.getElementById(fold().getAttribute('aria-controls')!)!;
    expect(within(cards).getByRole('link', { name: /Vocabulómetro/ })).toHaveTextContent('2 vocabulary test(s) open for you');
    expect(within(cards).getByRole('link', { name: /Audio labs/ })).toHaveTextContent('2 lab(s) to do');
    expect(within(cards).getByRole('link', { name: /Speaking/ })).toHaveTextContent('All recordings turned in');
    // One sheet: straight to it.
    expect(within(cards).getByRole('link', { name: /Sign-ups/ })).toHaveAttribute('href', '/signups?sheet=5');
    expect(within(cards).getByRole('link', { name: /Sign-ups/ })).toHaveTextContent('Pick your days: Show and tell');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Vocabulómetro', 'Audio labs', 'Speaking', 'Sign-ups']);
  });

  it('shows nothing, not even the button, with nothing to show', () => {
    h.vocab = [];
    h.labs = [];
    h.speaking = [];
    h.signups = [];
    renderNotices();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('folding the notices', () => {
  it('folds them into one row of chips that keep their counts, stay links, and say what the count is', async () => {
    const user = userEvent.setup();
    renderNotices();
    await user.click(fold());

    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Audio labs' })).toBeNull();
    const chips = screen.getByRole('list', { name: 'To do' });
    expect(fold()).toHaveAttribute('aria-controls', chips.id);
    const links = within(chips).getAllByRole('link');
    // What shows: the name and the count (or a done mark).
    expect(links.map((link) => link.textContent)).toEqual(['Vocabulómetro2', 'Audio labs2', 'Speaking✓', 'Sign-ups1']);
    // The name says what the number counts (the number and mark themselves are not read).
    expect(within(chips).getByRole('link', { name: 'Audio labs, 2 lab(s) to do' })).toHaveAttribute('href', '/labs');
    expect(within(chips).getByRole('link', { name: 'Audio labs, 2 lab(s) to do' })).not.toHaveAttribute('title');
    expect(within(chips).getByRole('link', { name: 'Speaking, All recordings turned in' })).toHaveAttribute('href', '/speaking');
    expect(within(chips).getByRole('link', { name: 'Vocabulómetro, 2 vocabulary test(s) open for you' })).toHaveAttribute('href', '/vocabulometro');
    expect(within(chips).getByRole('link', { name: 'Sign-ups, Pick your days: Show and tell' })).toHaveAttribute('href', '/signups?sheet=5');
    // Remembered for this browser.
    expect(window.localStorage.getItem(NOTICES_FOLDED_KEY)).toBe('1');
  });

  it('keeps the focus on the button both ways, and unfolds back to the full cards', async () => {
    const user = userEvent.setup();
    renderNotices();
    const button = fold();
    await user.click(button);
    expect(fold()).toBe(button);
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(fold()).toBe(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Audio labs' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'To do' })).toBeNull();
    expect(window.localStorage.getItem(NOTICES_FOLDED_KEY)).toBe('0');
  });

  it('opens folded when this browser remembers it folded', () => {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, '1');
    renderNotices();
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('list', { name: 'To do' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Speaking' })).toBeNull();
  });

  it('still folds and unfolds when the browser refuses localStorage (a private window)', async () => {
    // Spy where getItem lives: on jsdom's Storage (Node 24) that is the prototype, and a spy set on
    // the instance is only stored as an item named "getItem"; on Node 25 the test setup's memory
    // storage owns its methods.
    const storage = (Object.prototype.hasOwnProperty.call(window.localStorage, 'getItem')
      ? window.localStorage
      : Object.getPrototypeOf(window.localStorage)) as Storage;
    const getItem = vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const user = userEvent.setup();
    renderNotices();
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    await user.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('list', { name: 'To do' })).toBeInTheDocument();
    await user.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(getItem).toHaveBeenCalledWith(NOTICES_FOLDED_KEY);
    expect(setItem.mock.calls.filter(([key]) => key === NOTICES_FOLDED_KEY)).toHaveLength(2);
  });
});

describe('what each notice counts', () => {
  it('a done mark once everything of a kind is done, and a count again once something new comes', async () => {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, '1');
    h.labs = [lab(4, 'done', '2026-10-01T15:00:00.000Z'), lab(3, 'check')];
    h.signups = [sheet(5, 'Show and tell', ['2026-10-20']), sheet(6, 'Closed', [], 1, false)];
    const { rerender } = renderNotices();
    expect(screen.getByRole('link', { name: 'Audio labs, All labs turned in' })).toHaveTextContent('✓');
    // Two sheets: the list of them; picked, or closed, is done.
    expect(screen.getByRole('link', { name: 'Sign-ups, Your days are picked' })).toHaveAttribute('href', '/signups');

    h.labs = [...(h.labs as unknown[]), lab(7, null)];
    rerender(<MemoryRouter><Notices /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Audio labs, 1 lab(s) to do' })).toHaveTextContent(/^Audio labs1/);
  });

  it('a lab from before statuses counts until it is turned in', () => {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, '1');
    h.labs = [lab(1, null), lab(2, null, '2026-10-01T15:00:00.000Z')];
    renderNotices();
    expect(screen.getByRole('link', { name: 'Audio labs, 1 lab(s) to do' })).toBeInTheDocument();
  });

  it('shows a teacher no sign-ups (their sheets live under Admin) and does not ask for them', () => {
    renderNotices(true);
    expect(h.signupsEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('link', { name: /Sign-ups/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Audio labs/ })).toBeInTheDocument();
  });
});
