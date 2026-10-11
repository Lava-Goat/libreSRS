import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReview from './FlashcardReview';
import { CardDirection, State, Rating } from '@libresrs/shared';

// jsdom lacks ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/**
 * The Wiktionary links (v1.26.1): each side opens at its own language's section, the languages
 * being those of the card's own deck, as settings.getDeckSettings gives them for that deck.
 */
const h = vi.hoisted(() => ({
  /** Each deck's languages: front = source, back = target. */
  decks: new Map<number, { sourceLanguage: string | null; targetLanguage: string | null; aiEnabled?: boolean }>(),
  /** Answer every deck with this deck's settings (a query still holding another deck's data). */
  staleDeckId: null as number | null,
  /** The decks getDeckSettings was asked for. */
  askedFor: [] as number[],
}));

const mutateAsync = vi.fn(async ({ cardStateId, rating }: { cardStateId: number; rating: number }) => {
  const state = rating === Rating.Again ? State.Learning : State.Review;
  return {
    nextReview: new Date(),
    newState: state,
    state: { id: cardStateId, stability: 1, difficulty: 2, reps: 1, lapses: 0, state },
    reviewLogId: cardStateId + 100,
    nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
  };
});

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ai: { getCardAiState: { setData: vi.fn(), invalidate: vi.fn(async () => {}) } },
    }),
    auth: {
      me: { useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }) },
      logout: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    cards: {
      review: { useMutation: () => ({ mutateAsync, isPending: false }) },
      undoReview: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    ai: {
      // AI off on the server: no pronunciation, so getCardAssets never runs.
      getConfig: { useQuery: () => ({ data: { pronunciation: false, image: false, mnemonic: false } }) },
      getCardAiState: { useQuery: () => ({ data: null }) },
      getCardAssets: { useQuery: () => ({ data: null }) },
      generateImage: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      removeImage: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      generateMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      acceptMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      rejectMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      deleteMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      regenerateCardAssets: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
      },
    },
    settings: {
      get: {
        useQuery: () => ({ data: { autoPlayAudio: false, autoPlayAudioFront: false, aiEnabled: true, mnemonicMode: 'manual' } }),
      },
      getDeckSettings: {
        useQuery: ({ deckId }: { deckId: number }, opts?: { enabled?: boolean }) => {
          if (opts?.enabled === false) return { data: undefined };
          h.askedFor.push(deckId);
          const answeredFor = h.staleDeckId ?? deckId;
          const deck = h.decks.get(answeredFor);
          if (!deck) return { data: undefined };
          return {
            data: {
              deckId: answeredFor,
              autoPlayAudio: false,
              autoPlayAudioFront: false,
              aiEnabled: deck.aiEnabled ?? true,
              mnemonicMode: 'manual',
              sourceLanguage: deck.sourceLanguage,
              targetLanguage: deck.targetLanguage,
            },
          };
        },
      },
    },
  },
}));

function card(id: number, deckId: number, front: string, back: string, direction = CardDirection.Forward) {
  return {
    card: { id, deckId, front, back },
    state: { id: id + 10, stability: 1, difficulty: 2, reps: 0, lapses: 0, state: State.New },
    direction,
    nextReviewOptions: { 1: new Date(), 2: new Date(), 3: new Date(), 4: new Date() },
  };
}

const linkFor = (word: string) => screen.getByTitle(`Look up "${word}" on Wiktionary`).getAttribute('href');

async function showAnswer(user: ReturnType<typeof userEvent.setup>) {
  await act(async () => {
    await user.click(screen.getByRole('button', { name: /show answer/i }));
  });
}

async function rateGood(user: ReturnType<typeof userEvent.setup>) {
  await act(async () => {
    await user.click(screen.getByRole('button', { name: /good/i }));
  });
}

describe('FlashcardReview Wiktionary links', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    h.decks.clear();
    h.decks.set(1, { sourceLanguage: 'es', targetLanguage: 'en' });
    h.decks.set(2, { sourceLanguage: 'he', targetLanguage: 'en' });
    h.decks.set(3, { sourceLanguage: null, targetLanguage: null });
    h.staleDeckId = null;
    h.askedFor = [];
  });

  it('a Spanish to English card links the question to #Spanish and the answer to #English', async () => {
    const user = userEvent.setup();
    render(<FlashcardReview cards={[card(1, 1, '<b>la casa</b>', 'the house')]} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(linkFor('la casa')).toBe('https://en.wiktionary.org/wiki/la%20casa#Spanish');
    await showAnswer(user);
    expect(linkFor('the house')).toBe('https://en.wiktionary.org/wiki/the%20house#English');
  });

  it('a reverse card (back shown first) swaps them: the English question to #English, the Spanish answer to #Spanish', async () => {
    const user = userEvent.setup();
    render(
      <FlashcardReview cards={[card(1, 1, 'casa', 'house', CardDirection.Reverse)]} onComplete={vi.fn()} onExit={vi.fn()} />,
    );

    expect(linkFor('house')).toBe('https://en.wiktionary.org/wiki/house#English');
    await showAnswer(user);
    expect(linkFor('casa')).toBe('https://en.wiktionary.org/wiki/casa#Spanish');
  });

  it('a card from a second deck in the same session uses that deck\'s languages', async () => {
    const user = userEvent.setup();
    render(
      <FlashcardReview
        cards={[card(1, 1, 'casa', 'house'), card(2, 2, 'שלום', 'hello')]}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(linkFor('casa')).toBe('https://en.wiktionary.org/wiki/casa#Spanish');
    await showAnswer(user);
    await rateGood(user);

    expect(linkFor('שלום')).toBe(`https://en.wiktionary.org/wiki/${encodeURIComponent('שלום')}#Hebrew`);
    await showAnswer(user);
    expect(linkFor('hello')).toBe('https://en.wiktionary.org/wiki/hello#English');
    expect(h.askedFor).toContain(2);
  });

  it('settings still holding another deck\'s languages are not used for this card: no fragment', async () => {
    h.staleDeckId = 1;
    render(<FlashcardReview cards={[card(2, 2, 'שלום', 'hello')]} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(linkFor('שלום')).toBe(`https://en.wiktionary.org/wiki/${encodeURIComponent('שלום')}`);
  });

  it('a deck with no languages links to the top of the page, as before', async () => {
    const user = userEvent.setup();
    render(<FlashcardReview cards={[card(3, 3, 'casa', 'house')]} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(linkFor('casa')).toBe('https://en.wiktionary.org/wiki/casa');
    await showAnswer(user);
    expect(linkFor('house')).toBe('https://en.wiktionary.org/wiki/house');
  });

  it('settings not loaded yet: no fragment', async () => {
    h.decks.clear();
    render(<FlashcardReview cards={[card(1, 1, 'casa', 'house')]} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(linkFor('casa')).toBe('https://en.wiktionary.org/wiki/casa');
  });

  it('keeps working with AI off for the deck, and reads region variants (es-MX) by their language', async () => {
    const user = userEvent.setup();
    h.decks.set(1, { sourceLanguage: 'es-MX', targetLanguage: 'EN', aiEnabled: false });
    render(<FlashcardReview cards={[card(1, 1, 'casa', 'house')]} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(linkFor('casa')).toBe('https://en.wiktionary.org/wiki/casa#Spanish');
    await showAnswer(user);
    expect(linkFor('house')).toBe('https://en.wiktionary.org/wiki/house#English');
  });
});
