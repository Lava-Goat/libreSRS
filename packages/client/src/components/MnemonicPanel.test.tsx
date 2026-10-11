// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { StrictMode } from 'react';
import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MnemonicPanel from './MnemonicPanel';

type Style = 'keyword' | 'sentence';
type Pending = { id: number; text: string; style?: Style | null };
type AiState = {
  acceptedMnemonic: { text: string; source: 'teacher' | 'own'; style?: Style } | null;
  pendingMnemonic: Pending | null;
  /** The newest waiting suggestion of each style (v1.20.0); left out, the panel only has pendingMnemonic. */
  pendingByStyle?: { keyword: Pending | null; sentence: Pending | null };
};

// Shared with the trpc mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  generateCalls: [] as { cardId: number; style?: string }[],
  /** 'hang': ai.generateMnemonic stays in flight; 'resolve': it answers at once; 'manual': it answers on release(). */
  generateMode: 'hang' as 'hang' | 'resolve' | 'manual',
  release: [] as (() => void)[],
  nextId: 100,
  /** When set, ai.generateMnemonic fails with it (as a tRPC client error reaches the page). */
  generateError: null as unknown,
  rejectCalls: [] as number[],
  /** When set, ai.rejectMnemonic fails with it. */
  rejectError: null as unknown,
  acceptCalls: [] as number[],
  /** The cache writes the panel makes after a suggestion arrives: { cardId, pending id }. */
  setDataCalls: [] as { cardId: number; pendingId: number | undefined }[],
  /** The pendingByStyle each of those cache writes leaves. */
  setDataStyles: [] as unknown[],
  /** The card's state still has the suggestion after a reject (a read from before the reject). */
  keepPending: false,
  isAdmin: true,
  // When null the card's query is still loading (no cached data at mount).
  aiStateData: null as null | AiState,
}));

/** What ai.getCardAiState answers since v1.20.0: the card's mnemonic and nothing about cognates. */
const loadedAiState = (): AiState => ({
  acceptedMnemonic: null,
  pendingMnemonic: null,
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));

// Mirrors two React Query behaviors: every useMutation() render returns a fresh
// result object (unstable identity in MnemonicPanel's useCallback deps), and
// calling the mutation triggers an isPending re-render before the request
// resolves. Neither may ever turn into a generation the teacher did not ask for.
vi.mock('../api/trpc', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        ai: {
          getCardAiState: {
            setData: (input: { cardId: number }, updater: (d: unknown) => AiState | undefined) => {
              const next = updater({ acceptedMnemonic: null, pendingMnemonic: null, pendingByStyle: { keyword: null, sentence: null } });
              h.setDataCalls.push({ cardId: input.cardId, pendingId: next?.pendingMnemonic?.id });
              h.setDataStyles.push(next?.pendingByStyle);
            },
            invalidate: vi.fn(async () => {}),
          },
        },
      }),
      ai: {
        getCardAiState: {
          useQuery: () => ({ data: h.aiStateData, refetch: vi.fn() }),
        },
        generateMnemonic: {
          useMutation: () => {
            const [isPending, setIsPending] = React.useState(false);
            return {
              isPending,
              mutateAsync: (input: { cardId: number; style?: Style }) => {
                h.generateCalls.push({ cardId: input.cardId, style: input.style });
                if (h.generateError) return Promise.reject(h.generateError);
                setIsPending(true);
                // Stay unresolved: the duplicate fired while the first
                // request was still in flight.
                if (h.generateMode === 'hang') return new Promise<never>(() => {});
                return new Promise((resolve) => {
                  const id = h.nextId++;
                  const style = input.style ?? 'keyword';
                  const finish = () => {
                    setIsPending(false);
                    resolve({ id, cardId: input.cardId, text: `suggestion ${id} (${style})`, style, accepted: false });
                  };
                  if (h.generateMode === 'manual') h.release.push(finish);
                  else finish();
                });
              },
            };
          },
        },
        acceptMnemonic: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: async (input: { mnemonicId: number }) => {
              h.acceptCalls.push(input.mnemonicId);
              if (h.aiStateData) h.aiStateData = { acceptedMnemonic: { text: 'approved now', source: 'teacher' }, pendingMnemonic: null };
            },
          }),
        },
        rejectMnemonic: {
          useMutation: () => ({
            isPending: false,
            // A soft reject: the row stays on the server (so the model is told it was suggested),
            // but the card's state no longer offers it as pending.
            mutateAsync: async (input: { mnemonicId: number }) => {
              h.rejectCalls.push(input.mnemonicId);
              if (h.rejectError) throw h.rejectError;
              if (h.aiStateData && !h.keepPending) {
                const byStyle = h.aiStateData.pendingByStyle;
                const keep = (p: Pending | null) => (p?.id === input.mnemonicId ? null : p);
                h.aiStateData = {
                  ...h.aiStateData,
                  pendingMnemonic: null,
                  ...(byStyle ? { pendingByStyle: { keyword: keep(byStyle.keyword), sentence: keep(byStyle.sentence) } } : {}),
                };
              }
            },
          }),
        },
        deleteMnemonic: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
  };
});

function reset(isAdmin: boolean) {
  h.generateCalls.length = 0;
  h.generateMode = 'hang';
  h.release.length = 0;
  h.nextId = 100;
  h.generateError = null;
  h.rejectCalls.length = 0;
  h.rejectError = null;
  h.acceptCalls.length = 0;
  h.setDataCalls.length = 0;
  h.setDataStyles.length = 0;
  h.keepPending = false;
  h.isAdmin = isAdmin;
  h.aiStateData = loadedAiState();
}

const button = (name: string) => screen.getByRole('button', { name });
const press = (name: string) => act(async () => { button(name).click(); });

/**
 * Since v1.20.0 (the cognate system's removal) nothing is suggested on its own: the panel used to
 * ask for one when a teacher opened a card whose cognate score was under 0.72. Now the teacher asks,
 * on any card, and each request pays for exactly one suggestion.
 */
describe('MnemonicPanel suggestions on request (teacher)', () => {
  beforeEach(() => reset(true));

  it('asks for nothing on its own: not at mount, not when the card loads, not when the card changes', async () => {
    h.aiStateData = null;
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<MnemonicPanel cardId={1} />));
    });
    h.aiStateData = loadedAiState();
    await act(async () => {
      rerender(<MnemonicPanel cardId={1} />);
    });
    await act(async () => {
      rerender(<MnemonicPanel cardId={2} />);
    });

    expect(h.generateCalls).toEqual([]);
    expect(button('Suggest a mnemonic')).toBeEnabled();
  });

  it('asks for nothing on its own under StrictMode’s double mount either', async () => {
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<StrictMode><MnemonicPanel cardId={1} /></StrictMode>));
    });
    await act(async () => {
      rerender(<StrictMode><MnemonicPanel cardId={2} /></StrictMode>);
    });
    expect(h.generateCalls).toEqual([]);
  });

  it('“Suggest a mnemonic” asks for one keyword suggestion, and is disabled while it is written', async () => {
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');

    // The isPending re-render (a fresh mutation object) fires nothing more.
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    expect(button('Generating...')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Suggest a mnemonic' })).toBeNull();

    // A press on the disabled button pays for nothing.
    await press('Generating...');
    expect(h.generateCalls).toHaveLength(1);
  });

  it('two presses before the page redraws still pay for one suggestion', async () => {
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await act(async () => {
      const suggest = button('Suggest a mnemonic');
      suggest.click();
      suggest.click();
    });
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
  });

  it('shows a new suggestion with its style, and the choices for it', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');

    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
    expect(screen.getByText('Keyword picture')).toBeInTheDocument();
    for (const name of ['Use for everyone', 'Try another', 'Try a sentence']) expect(button(name)).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Try a keyword' })).toBeNull();
    // The cache keeps it for this card, so coming back to the card shows it instead of paying again.
    expect(h.setDataCalls).toEqual([{ cardId: 1, pendingId: 100 }]);
    expect(h.setDataStyles).toEqual([{ keyword: { id: 100, text: 'suggestion 100 (keyword)', style: 'keyword' }, sentence: null }]);
  });

  it('“Try another” after a keyword suggestion rejects it and asks for another keyword', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');
    await press('Try another');

    expect(h.rejectCalls).toEqual([100]);
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }, { cardId: 1, style: 'keyword' }]);
    expect(screen.queryByText('suggestion 100 (keyword)')).toBeNull();
    expect(screen.getByText('suggestion 101 (keyword)')).toBeInTheDocument();
  });

  it('“Try a sentence” asks for a sentence and turns nothing down; “Try another” keeps the style', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');
    await press('Try a sentence');

    // The keyword still waits: the teacher chooses between the two.
    expect(h.rejectCalls).toEqual([]);
    expect(h.generateCalls.at(-1)).toEqual({ cardId: 1, style: 'sentence' });
    expect(screen.getByText('suggestion 101 (sentence)')).toBeInTheDocument();
    expect(screen.getByText('Example sentence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try a sentence' })).toBeNull();

    // Another sentence turns this one down.
    await press('Try another');
    expect(h.rejectCalls).toEqual([101]);
    expect(h.generateCalls.at(-1)).toEqual({ cardId: 1, style: 'sentence' });
    expect(screen.getByText('suggestion 102 (sentence)')).toBeInTheDocument();
    expect(h.generateCalls).toHaveLength(3);
  });

  it('“Try a keyword” brings the waiting keyword back without paying again, and the teacher picks one', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');
    await press('Try a sentence');
    expect(h.generateCalls).toHaveLength(2);

    await press('Try a keyword');
    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
    expect(screen.getByText('Keyword picture')).toBeInTheDocument();
    await press('Try a sentence');
    expect(screen.getByText('suggestion 101 (sentence)')).toBeInTheDocument();
    await press('Try a keyword');
    expect(h.generateCalls).toHaveLength(2);
    expect(h.rejectCalls).toEqual([]);

    await press('Use for everyone');
    expect(h.acceptCalls).toEqual([100]);
  });

  it('switches to a waiting suggestion of the other style the server kept, without paying again', async () => {
    h.generateMode = 'resolve';
    const keyword = { id: 8, text: 'TEN GOats on leashes', style: 'keyword' as const };
    const sentence = { id: 9, text: 'TENGO quince años = I’m 15', style: 'sentence' as const };
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: sentence, pendingByStyle: { keyword, sentence } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.getByText('TENGO quince años = I’m 15')).toBeInTheDocument();

    await press('Try a keyword');
    expect(screen.getByText('TEN GOats on leashes')).toBeInTheDocument();
    expect(h.generateCalls).toEqual([]);
    expect(h.rejectCalls).toEqual([]);

    // "Try another" on it turns it down and asks for another keyword.
    await press('Try another');
    expect(h.rejectCalls).toEqual([8]);
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
  });

  it('names the keyword style by what it makes: “Try a keyword”, never “Try a picture” (the card’s picture is a different control)', async () => {
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'Quiero, PERO no puedo.', style: 'sentence' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(button('Try a keyword')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /picture/i })).toBeNull();
  });

  it('“Suggest a sentence” asks for a sentence straight away, without paying for a keyword first', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(button('Suggest a mnemonic')).toBeEnabled();
    await press('Suggest a sentence');

    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'sentence' }]);
    expect(screen.getByText('suggestion 100 (sentence)')).toBeInTheDocument();
    expect(screen.getByText('Example sentence')).toBeInTheDocument();
  });

  it('a stored suggestion keeps its style: an older one (no style) is a keyword, a sentence stays a sentence', async () => {
    h.generateMode = 'resolve';
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    const view = await act(async () => render(<MnemonicPanel cardId={1} />));
    expect(screen.getByText('Keyword picture')).toBeInTheDocument();
    await press('Try another');
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    view.unmount();

    reset(true);
    h.generateMode = 'resolve';
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'Quiero, PERO no puedo.', style: 'sentence' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.getByText('Example sentence')).toBeInTheDocument();
    await press('Try another');
    expect(h.rejectCalls).toEqual([9]);
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'sentence' }]);
  });

  it('shows a two-line sentence on two lines (the server keeps the line break)', async () => {
    const text = 'Quiero ir, PERO no puedo. = I want to go, but I can’t.\nPERO sounds like a PEAR: no pears today, but maybe tomorrow.';
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text, style: 'sentence' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    const shown = screen.getByText((_, el) => el?.textContent === text && el.children.length === 0);
    expect(shown).toHaveClass('whitespace-pre-line');
  });

  it('shows a stored suggestion again instead of paying for a new one', async () => {
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });

    expect(h.generateCalls).toEqual([]);
    expect(screen.getByText('stored suggestion')).toBeInTheDocument();
    expect(button('Use for everyone')).toBeInTheDocument();
  });

  it('disables every choice while a request runs, and a second press pays for nothing', async () => {
    // The card's state still answers with the suggestion while the next one is written.
    h.keepPending = true;
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await act(async () => {
      const another = button('Try another');
      another.click();
      another.click();
    });

    expect(h.rejectCalls).toEqual([9]);
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    for (const name of ['Use for everyone', 'Try another', 'Try a sentence']) expect(button(name)).toBeDisabled();
    await press('Try a sentence');
    await press('Use for everyone');
    expect(h.generateCalls).toHaveLength(1);
    expect(h.acceptCalls).toEqual([]);
  });

  it('pays for nothing new when the reject fails, and says why', async () => {
    h.generateMode = 'resolve';
    h.rejectError = new Error('Mnemonic not found');
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Try another');

    expect(h.rejectCalls).toEqual([9]);
    expect(h.generateCalls).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('Mnemonic not found');
    expect(screen.getByText('stored suggestion')).toBeInTheDocument();
  });

  it('“Use for everyone” approves the suggestion shown', async () => {
    h.generateMode = 'resolve';
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Suggest a mnemonic');
    await press('Use for everyone');

    expect(h.acceptCalls).toEqual([100]);
    expect(h.rejectCalls).toEqual([]);
    expect(screen.getByText('approved now')).toBeInTheDocument();
  });

  it('a suggestion still being written for one card locks nothing on the next card', async () => {
    h.generateMode = 'manual';
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<MnemonicPanel cardId={1} />));
    });
    await press('Suggest a mnemonic');
    expect(button('Generating...')).toBeDisabled();

    // The teacher rates the card and moves on while card 1's suggestion is still written.
    await act(async () => {
      rerender(<MnemonicPanel cardId={2} />);
    });
    expect(screen.queryByText('Generating...')).toBeNull();
    expect(button('Suggest a mnemonic')).toBeEnabled();
    expect(button('Suggest a sentence')).toBeEnabled();

    // A stored suggestion on card 2 is not shown as being replaced, and its choices work.
    await act(async () => {
      rerender(<MnemonicPanel cardId={3} />);
    });
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'card 3’s suggestion' } };
    await act(async () => {
      rerender(<MnemonicPanel cardId={4} />);
    });
    expect(screen.queryByText('Generating...')).toBeNull();
    for (const name of ['Use for everyone', 'Try another', 'Try a sentence']) expect(button(name)).toBeEnabled();
    await press('Try a sentence');
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }, { cardId: 4, style: 'sentence' }]);

    // Back on card 1, its own request still runs: one at a time there.
    h.aiStateData = loadedAiState();
    await act(async () => {
      rerender(<MnemonicPanel cardId={1} />);
    });
    expect(button('Generating...')).toBeDisabled();
    await act(async () => {
      h.release.forEach((finish) => finish());
    });
    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
  });

  it('a suggestion that arrives after the teacher moved on is not shown on the next card', async () => {
    h.generateMode = 'manual';
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<MnemonicPanel cardId={1} />));
    });
    await press('Suggest a mnemonic');
    await act(async () => {
      rerender(<MnemonicPanel cardId={2} />);
    });
    await act(async () => {
      h.release.forEach((finish) => finish());
    });

    expect(screen.queryByText('suggestion 100 (keyword)')).toBeNull();
    expect(button('Suggest a mnemonic')).toBeEnabled();
    // It is still card 1's, in that card's cache.
    expect(h.setDataCalls).toEqual([{ cardId: 1, pendingId: 100 }]);
  });

  it('offers no button when generation is disallowed or the mode is Disabled', async () => {
    const view = await act(async () => render(<MnemonicPanel cardId={1} allowGenerate={false} />));
    expect(screen.queryByRole('button')).toBeNull();
    view.unmount();

    await act(async () => {
      render(<MnemonicPanel cardId={2} mnemonicMode="disabled" />);
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(h.generateCalls).toEqual([]);
  });

  it('under Disabled, a stored suggestion can be used or dismissed, and nothing new is asked for', async () => {
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} mnemonicMode="disabled" />);
    });
    expect(button('Use for everyone')).toBeInTheDocument();
    for (const name of ['Try another', 'Try a sentence', 'Try a keyword']) expect(screen.queryByRole('button', { name })).toBeNull();

    await press('Dismiss');
    expect(h.rejectCalls).toEqual([9]);
    expect(h.generateCalls).toEqual([]);
    expect(screen.queryByText('stored suggestion')).toBeNull();
  });

  it('keeps an approved mnemonic under Disabled, with Delete but no Regenerate', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'existing', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} mnemonicMode="disabled" />);
    });

    expect(screen.getByText('existing')).toBeInTheDocument();
    expect(button('Delete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(h.generateCalls).toEqual([]);
  });

  it('Regenerate on an approved mnemonic offers a keyword under it, with the same choices', async () => {
    h.generateMode = 'resolve';
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'existing', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Regenerate');

    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    expect(screen.getByText('existing')).toBeInTheDocument();
    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
    // While a suggestion waits, its own buttons ask for the next one.
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();

    await press('Try a sentence');
    expect(h.rejectCalls).toEqual([]);
    expect(h.generateCalls.at(-1)).toEqual({ cardId: 1, style: 'sentence' });
    expect(screen.getByText('suggestion 101 (sentence)')).toBeInTheDocument();
    // The keyword waits too: back to it for free.
    await press('Try a keyword');
    expect(screen.getByText('suggestion 100 (keyword)')).toBeInTheDocument();
    expect(h.generateCalls).toHaveLength(2);
  });

  it('Regenerate on an approved sentence asks for another sentence', async () => {
    h.generateMode = 'resolve';
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'Voy PORQUE quiero', source: 'teacher', style: 'sentence' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Regenerate');

    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'sentence' }]);
    expect(screen.getByText('suggestion 100 (sentence)')).toBeInTheDocument();
  });

  it('draws the small print of a suggestion dark enough to read (WCAG AA on the blue box)', async () => {
    h.generateMode = 'manual';
    h.keepPending = true;
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Try another');
    // gray-500 on blue-50 is 4.44:1, under 4.5:1 for 12px text; gray-600 is 6.94:1.
    for (const text of ['Keyword picture', 'Use it and every student sees it on this card.', 'Generating...']) {
      expect(screen.getByText(text)).toHaveClass('text-gray-600');
      expect(screen.getByText(text)).not.toHaveClass('text-gray-500');
    }
  });

  it('draws the approved mnemonic’s small print and buttons dark enough to read (WCAG AA on the yellow box)', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'existing', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    // yellow-500 is 1.85:1, yellow-600 2.83:1 and red-500 3.69:1 on yellow-50; these are 4.76:1 and 6.2:1.
    expect(screen.getByText('Chosen by your teacher')).toHaveClass('text-yellow-700');
    expect(button('Regenerate')).toHaveClass('text-yellow-700');
    expect(button('Delete')).toHaveClass('text-red-700');
  });

  it('shows no cognate score anywhere', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'NATION: a nation', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.queryByText(/cognate/i)).toBeNull();
  });
});

/** A failed generation as the panel catches it: the server's own code sits on error.data. */
const trpcError = (appCode: string) => Object.assign(new Error('The Anthropic account is out of credit or reached its spending limit.'), {
  data: { code: 'TOO_MANY_REQUESTS', appCode },
});
const OUT_OF_CREDIT = 'AI is paused: the account behind mnemonic suggestions is out of credit. Add credit, then try again.';
const BAD_KEY = 'The AI provider rejected the saved API key. Paste a new one in the AI settings.';

describe('MnemonicPanel when a suggestion fails (teacher)', () => {
  beforeEach(() => reset(true));

  it('says why under the button, once, and keeps the button to try again', async () => {
    h.generateError = trpcError('AI_QUOTA_EXHAUSTED');
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await press('Suggest a mnemonic');

    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    expect(screen.getByRole('alert')).toHaveTextContent(OUT_OF_CREDIT);
    // Never the server's English, which names the provider.
    expect(screen.queryByText(/Anthropic account/)).toBeNull();
    expect(button('Suggest a mnemonic')).toBeEnabled();

    // A try that works clears it.
    h.generateError = null;
    await press('Suggest a mnemonic');
    expect(h.generateCalls).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why under Regenerate on an approved mnemonic', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'approved', source: 'teacher' } };
    h.generateError = trpcError('AI_PROVIDER_AUTH');
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.queryByRole('alert')).toBeNull();

    await press('Regenerate');
    expect(screen.getByRole('alert')).toHaveTextContent(BAD_KEY);
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('says why when “Try another” fails, with or without the old suggestion still showing', async () => {
    const BUSY = 'The AI service is busy or having a temporary problem. Try again in a minute.';
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    h.generateError = trpcError('AI_PROVIDER_BUSY');
    const view = await act(async () => render(<MnemonicPanel cardId={1} />));
    await press('Try another');
    expect(h.generateCalls).toEqual([{ cardId: 1, style: 'keyword' }]);
    expect(screen.getByRole('alert')).toHaveTextContent(BUSY);
    expect(button('Suggest a mnemonic')).toBeEnabled();
    view.unmount();

    // The card's state still answers with the suggestion: the alert sits under it.
    h.keepPending = true;
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'stored suggestion' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    await press('Try a sentence');
    expect(h.generateCalls.at(-1)).toEqual({ cardId: 1, style: 'sentence' });
    expect(screen.getByText('stored suggestion')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(BUSY);
  });

  it('forgets the failure when the card changes, even where nothing generates for the next card', async () => {
    h.generateError = trpcError('AI_QUOTA_EXHAUSTED');
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<MnemonicPanel cardId={1} />));
    });
    await press('Suggest a mnemonic');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Nothing generates for card 2 on its own, so this pins the reset on the card change itself.
    await act(async () => {
      rerender(<MnemonicPanel cardId={2} />);
    });
    expect(h.generateCalls).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button('Suggest a mnemonic')).toBeInTheDocument();
  });
});

describe('MnemonicPanel for students', () => {
  beforeEach(() => reset(false));

  it('never generates, even for a card with no mnemonic, and never sees a button', async () => {
    let rerender: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<MnemonicPanel cardId={1} />));
    });
    await act(async () => {
      rerender(<MnemonicPanel cardId={2} mnemonicMode="manual" />);
    });

    expect(h.generateCalls).toEqual([]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the teacher’s mnemonic, read-only', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'el perro hace “purr”… no', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });

    expect(screen.getByText('el perro hace “purr”… no')).toBeInTheDocument();
    expect(screen.getByText('Chosen by your teacher')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(h.generateCalls).toEqual([]);
  });

  it('shows an approved two-line sentence on two lines', async () => {
    const text = 'Voy PORQUE quiero. = I go because I want to.\nPORQUE: POUR the KAY-ak in, because you want to.';
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text, source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    const shown = screen.getByText((_, el) => el?.textContent === text && el.children.length === 0);
    expect(shown).toHaveClass('whitespace-pre-line');
  });

  it('shows the teacher’s mnemonic even where mnemonic generation is disabled', async () => {
    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'approved', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} mnemonicMode="disabled" />);
    });
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('never shows a failure, and never causes one', async () => {
    h.generateError = trpcError('AI_QUOTA_EXHAUSTED');
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(h.generateCalls).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();

    h.aiStateData = { ...loadedAiState(), acceptedMnemonic: { text: 'approved', source: 'teacher' } };
    await act(async () => {
      render(<MnemonicPanel cardId={2} />);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(OUT_OF_CREDIT)).toBeNull();
  });

  it('never shows a teacher’s unapproved suggestion, its style or its buttons', async () => {
    h.aiStateData = { ...loadedAiState(), pendingMnemonic: { id: 9, text: 'draft', style: 'sentence' } };
    await act(async () => {
      render(<MnemonicPanel cardId={1} />);
    });
    expect(screen.queryByText('draft')).toBeNull();
    expect(screen.queryByText('Example sentence')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(h.generateCalls).toEqual([]);
  });
});
