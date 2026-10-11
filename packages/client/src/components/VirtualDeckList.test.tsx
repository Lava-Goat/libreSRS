import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VirtualDeckList from './VirtualDeckList';

const mockCreateMutate = vi.fn();
const mockValidateSelectionUseQuery = vi.fn();

vi.mock('../api/trpc', () => ({
  trpc: {
    virtualDecks: {
      list: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: vi.fn(),
        }),
      },
      create: {
        useMutation: () => ({
          mutate: mockCreateMutate,
          isPending: false,
        }),
      },
      validateSelection: {
        useQuery: (...args: unknown[]) => mockValidateSelectionUseQuery(...args),
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    cards: {
      getMyDecks: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              name: 'Spanish Core',
              cardCount: 250,
            },
          ],
        }),
      },
    },
  },
}));

describe('VirtualDeckList', () => {
  beforeEach(() => {
    mockCreateMutate.mockReset();
    mockValidateSelectionUseQuery.mockReset();
    mockValidateSelectionUseQuery.mockImplementation((_input, options?: { enabled?: boolean }) => {
      if (options?.enabled) {
        return {
          data: undefined,
          error: new Error('Not authenticated'),
        };
      }
      return {
        data: undefined,
        error: null,
      };
    });
  });

  it('allows create submit when validation request fails', async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(<VirtualDeckList />);
    });

    await user.click(screen.getByRole('button', { name: /create virtual deck/i }));

    await user.type(screen.getByPlaceholderText(/my subset/i), 'Subset A');
    await user.selectOptions(screen.getByRole('combobox'), '1');
    await user.type(screen.getByPlaceholderText(/1-100, 250, 550-557/i), '1-10');

    const createButton = screen.getByRole('button', { name: /^create$/i });
    expect(createButton).toBeEnabled();

    await user.click(createButton);

    expect(mockCreateMutate).toHaveBeenCalledWith({
      name: 'Subset A',
      sourceDeckId: 1,
      cardSelection: '1-10',
    });
  });
});
