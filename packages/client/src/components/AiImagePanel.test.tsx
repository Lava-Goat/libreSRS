// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AiImagePanel from './AiImagePanel';

const h = vi.hoisted(() => ({
  isAdmin: false,
  image: null as null | { url: string },
  removeCalls: [] as number[],
  generateCalls: [] as number[],
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));

vi.mock('../api/trpc', () => ({
  trpc: {
    ai: {
      getCardAssets: {
        useQuery: () => ({ data: { image: h.image }, refetch: vi.fn() }),
      },
      generateImage: {
        useMutation: () => ({
          isPending: false,
          isError: false,
          mutateAsync: async (input: { cardId: number }) => {
            h.generateCalls.push(input.cardId);
            return { imageUrl: 'data:image/png;base64,new' };
          },
        }),
      },
      removeImage: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: { cardId: number }) => {
            h.removeCalls.push(input.cardId);
            return { success: true };
          },
        }),
      },
    },
  },
}));

const IMAGE = { url: 'data:image/png;base64,old' };

/**
 * Removing a card's picture takes it away from every student, so since v1.20.0 only the teacher
 * has that control. Making and seeing pictures stay as they were.
 */
describe('AiImagePanel', () => {
  beforeEach(() => {
    h.isAdmin = false;
    h.image = null;
    h.removeCalls.length = 0;
    h.generateCalls.length = 0;
  });

  it('shows a student the picture and Regenerate, but no Remove', async () => {
    h.image = IMAGE;
    await act(async () => {
      render(<AiImagePanel cardId={1} />);
    });
    expect(screen.getByRole('img', { name: 'AI-generated illustration' })).toHaveAttribute('src', IMAGE.url);
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('shows a student the picture alone where pictures cannot be made', async () => {
    h.image = IMAGE;
    await act(async () => {
      render(<AiImagePanel cardId={1} allowGenerate={false} />);
    });
    expect(screen.getByRole('img', { name: 'AI-generated illustration' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still lets a student make a picture for a card without one', async () => {
    await act(async () => {
      render(<AiImagePanel cardId={1} />);
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Generate Image' }).click();
    });
    expect(h.generateCalls).toEqual([1]);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('lets the teacher remove the picture, even where pictures cannot be made', async () => {
    h.isAdmin = true;
    h.image = IMAGE;
    await act(async () => {
      render(<AiImagePanel cardId={7} allowGenerate={false} />);
    });
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    await act(async () => {
      screen.getByRole('button', { name: 'Remove' }).click();
    });
    expect(h.removeCalls).toEqual([7]);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('gives the teacher both Regenerate and Remove where pictures can be made', async () => {
    h.isAdmin = true;
    h.image = IMAGE;
    await act(async () => {
      render(<AiImagePanel cardId={1} />);
    });
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
