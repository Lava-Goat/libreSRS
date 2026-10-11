// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CSVUpload from './CSVUpload';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  decks: [
    { id: 1, name: 'Unidad 1', description: null, cardCount: 30, reversible: false },
    { id: 2, name: 'Unidad 2', description: null, cardCount: 40, reversible: false },
  ],
  /** How the stand-in Conjugation section behaves. */
  conjugation: 'editable' as 'editable' | 'broken',
  refetch: vi.fn(async () => ({})),
  mutation: { mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false, isLoading: false },
}));

// Every procedure the page touches: queries answer nothing but the deck list.
vi.mock('../api/trpc', () => {
  const at = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_target, key: string) => {
      if (key === 'useQuery') {
        return () => ({ data: path.join('.') === 'admin.getDecks' ? h.decks : undefined, refetch: h.refetch, isLoading: false });
      }
      if (key === 'useMutation') return () => h.mutation;
      return at([...path, key]);
    },
  });
  return { trpc: at([]) };
});

// The real section is tested on its own; this stand-in reports a draft, or fails the way a missing chunk does.
vi.mock('./conjugation/ConjugationSettings', () => ({
  default: function ConjugationStandIn({ deckId, onDirtyChange }: { deckId: number; onDirtyChange?: (dirty: boolean) => void }) {
    if (h.conjugation === 'broken') throw new Error('Failed to fetch dynamically imported module');
    return <button type="button" onClick={() => onDirtyChange?.(true)}>{`Edit conjugation ${deckId}`}</button>;
  },
}));

const openDeck = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

describe('CSVUpload: the deck’s Conjugation section', () => {
  beforeEach(() => {
    h.conjugation = 'editable';
  });

  afterEach(() => vi.restoreAllMocks());

  it('asks before switching decks drops an unsaved conjugation draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<CSVUpload />);

    await openDeck(user, 'Unidad 1');
    // Nothing edited: no question.
    await openDeck(user, 'Unidad 2');
    expect(confirm).not.toHaveBeenCalled();
    await openDeck(user, 'Unidad 1');

    await user.click(await screen.findByRole('button', { name: 'Edit conjugation 1' }));
    await openDeck(user, 'Unidad 2');
    expect(confirm).toHaveBeenCalledWith('Switch decks? Your unsaved Conjugation changes will be lost.');
    expect(screen.getByRole('heading', { name: 'Unidad 1' })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await openDeck(user, 'Unidad 2');
    expect(screen.getByRole('heading', { name: 'Unidad 2' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit conjugation 2' })).toBeInTheDocument();

    // The new deck's section starts clean: no question.
    confirm.mockClear();
    await openDeck(user, 'Unidad 1');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the rest of the deck page when the section cannot load', async () => {
    h.conjugation = 'broken';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<CSVUpload />);

    await openDeck(user, 'Unidad 1');
    expect(await screen.findByRole('alert')).toHaveTextContent('The Conjugation section could not load. Reload the page to see it.');
    expect(screen.getByRole('heading', { name: 'Unidad 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import Cards' })).toBeInTheDocument();
  });
});
