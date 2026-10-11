// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Readme from './Readme';

vi.mock('../api/trpc', () => ({
  trpc: { public: { getReadme: { useQuery: () => ({ data: '# libreSRS', isLoading: false }) } } },
}));

describe('Readme: copyright line', () => {
  it('names the business, Lava Goat Software, and not the corporation', () => {
    render(
      <MemoryRouter>
        <Readme />
      </MemoryRouter>,
    );
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Lava Goat Software$`))).toBeInTheDocument();
    expect(screen.queryByText(/Storm, Inc\./)).toBeNull();
  });
});
