// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { LOGO_SRC } from '../brand';

const auth = vi.hoisted(() => ({
  value: { user: { id: 3, name: 'Ana', picture: null as string | null }, isAdmin: false, logout: () => {} },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('../api/trpc', () => ({
  trpc: { cards: { getStats: { useQuery: () => ({ data: undefined }) } } },
}));
// Only the header is under test: the page's sections are tested on their own.
vi.mock('../components/DeckList', () => ({ default: () => null }));
vi.mock('../components/VirtualDeckList', () => ({ default: () => null }));
vi.mock('../components/UserStats', () => ({ default: () => null }));
vi.mock('../components/UserSettings', () => ({ default: () => null }));
// An extension's dashboard slots render nothing here, with or without an extension in the tree.
vi.mock('../extensions', () => ({ ExtensionSlot: () => null }));
vi.mock('../components/studyAll/StudyAllFlashcardsButton', () => ({ StudyAllFlashcardsButton: () => null }));
vi.mock('../components/conjugation/StudyAllConjugationButton', () => ({ StudyAllConjugationButton: () => null }));
vi.mock('../components/dashboard/DashboardNotices', () => ({ DashboardNotices: () => null }));
vi.mock('../components/dashboard/useDashboardNotices', () => ({ useDashboardNotices: () => [] }));

describe('Dashboard: logo', () => {
  it('shows the logo in the header beside the heading, as decoration', () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'libreSRS' });
    const logo = container.querySelector(`header img[src="${LOGO_SRC}"]`);
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', '');
    expect(logo!.parentElement).toBe(heading.parentElement);
    expect(logo!.nextElementSibling).toBe(heading);
  });
});

describe('Dashboard: the Google profile picture', () => {
  const PICTURE = 'https://lh3.googleusercontent.com/a/example';

  it("never shows a student's own Google picture, so their browser never fetches it from Google", () => {
    auth.value = { user: { id: 3, name: 'Ana', picture: PICTURE }, isAdmin: false, logout: () => {} };
    const { container } = render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(container.querySelector(`img[src="${PICTURE}"]`)).toBeNull();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it("shows an administrator's own picture in the header", () => {
    auth.value = { user: { id: 1, name: 'Teacher', picture: PICTURE }, isAdmin: true, logout: () => {} };
    const { container } = render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(container.querySelector(`header img[src="${PICTURE}"]`)).not.toBeNull();
  });
});
