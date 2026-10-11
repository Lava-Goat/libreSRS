// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Setup from './Setup';
import { LOGO_SRC } from '../brand';

vi.mock('../api/trpc', () => ({
  trpc: {
    setup: {
      getStatus: { useQuery: () => ({ data: { needsSetup: true, callbackUrl: 'https://example.test/auth/google/callback', hasAdminEmail: true } }) },
      saveCredentials: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
    },
  },
}));

describe('Setup: logo', () => {
  it('shows the logo above the heading, as decoration (the heading says the name)', () => {
    const { container } = render(
      <MemoryRouter>
        <Setup />
      </MemoryRouter>,
    );
    const logo = container.querySelector(`img[src="${LOGO_SRC}"]`);
    const heading = screen.getByRole('heading', { level: 1, name: 'libreSRS' });
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', '');
    expect(logo!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Setup: copyright line', () => {
  it('names the business, Lava Goat Software, and not the corporation', () => {
    render(
      <MemoryRouter>
        <Setup />
      </MemoryRouter>,
    );
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Lava Goat Software$`))).toBeInTheDocument();
    expect(screen.queryByText(/Storm, Inc\./)).toBeNull();
  });
});
