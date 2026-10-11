// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Protocol-state-machine regressions for the Vocabulómetro runner, mirroring
// tests/m1 and tests/m2 of the standalone build in tools/vocabulometro-offline.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabTestRunner from './VocabTestRunner';
import { BANDOFF, DATA, type SummaryV2, type VocabTestSettings } from './logic';

const submitMutate = vi.fn();
let lastAudioWords: string[] = [];

vi.mock('../api/trpc', () => ({
  trpc: {
    vocab: {
      submitResult: {
        useMutation: () => ({
          mutate: submitMutate,
          isPending: false,
          isSuccess: false,
          isError: false,
          error: null,
        }),
      },
      getVocabAudioUrls: {
        useQuery: (input: { words: string[] }) => {
          lastAudioWords = input.words;
          return {
            data: { urls: Object.fromEntries(input.words.map((w) => [w, `blob:${w}`])) },
            isError: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
      getTestEiSentences: { useQuery: () => ({ data: null, isLoading: false, isError: false }) },
      transcribeEiRecording: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

// performance.now() drives both the response latency and the 250ms input
// lockout, so the tests own the clock: `tick()` puts the current item safely
// past its lockout, and NOT calling it reproduces a double-click.
let clock = 1000;
const tick = (ms = 1000) => { clock += ms; };

beforeEach(() => {
  clock = 1000;
  submitMutate.mockClear();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const planCode = (words: number[]) =>
  'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 3, words, np: 0, poff: 0 }))));

/** A sondeo driven by an adaptive plan: exactly `words`, no pseudowords. */
function renderPlan(words: number[]) {
  const settings: VocabTestSettings = { seed: 1, planCode: planCode(words) };
  render(
    <VocabTestRunner testId={1} mode="s5000" settings={settings} occasion="T1" onExit={() => {}} />
  );
}

const submittedSummary = (): SummaryV2 => {
  expect(submitMutate).toHaveBeenCalledTimes(1);
  return submitMutate.mock.calls[0][0].summary as SummaryV2;
};

const clickNo = () => { tick(); fireEvent.click(screen.getByRole('button', { name: /^No/ })); };
const clickYes = () => { tick(); fireEvent.click(screen.getByRole('button', { name: /Sí, la conozco/ })); };

// Two band-3 words: `bandOfIdx >= 2` means they are screened, never
// meaning-checked, so the queue is exactly two screen items.
const BAND3 = [BANDOFF[2], BANDOFF[2] + 1];

// C-test construction leaves the first sentence intact, then gaps every 2nd word of length ≥ 4.
const CTEST_TEXT = 'La casa es grande. Todos los años vamos juntos hasta la playa cercana con mucha '
  + 'ilusión porque siempre encontramos amigos nuevos durante aquellas semanas tranquilas.';

describe('protocol state 0 is recorded for tested-and-failed words', () => {
  it('a screened "no" lands in the submitted payload as state 0', () => {
    renderPlan(BAND3);
    clickNo();
    clickNo();
    const summary = submittedSummary();
    expect(summary.v).toBe(2);
    expect([...summary.res].sort((a, b) => a[0] - b[0])).toEqual([[BAND3[0], 0], [BAND3[1], 0]]);
  });

  it('successes and failures are both recorded, so the denominator is the tested set', () => {
    renderPlan(BAND3);
    clickYes();
    clickNo();
    const res = new Map(submittedSummary().res);
    expect(res.size).toBe(2);
    expect([...res.values()].sort()).toEqual([0, 1]);
  });

  // ~100 rendered items (49 + retest round) under jsdom: comfortably over the 5s
  // local default when suite workers contend, so it carries its own budget.
  it('an a500 block reports produced/tested, not produced/produced', { timeout: 30_000 }, () => {
    render(
      <VocabTestRunner
        testId={1}
        mode="a500"
        settings={{ seed: 3, blk: 1, form: 'A' }}
        onExit={() => {}}
      />
    );
    // "No lo sé" every item; a500 re-tests each failure once, then finishes.
    for (let guard = 0; guard < 400 && submitMutate.mock.calls.length === 0; guard++) {
      tick();
      const skip = screen.queryByRole('button', { name: 'No lo sé' });
      if (!skip) break;
      fireEvent.click(skip);
    }
    const summary = submittedSummary();
    const total = summary.res.length;
    expect(total).toBeGreaterThan(0);
    expect(summary.res.every(([, s]) => s === 0)).toBe(true);
    // the results view divides by the tested set, so 0 / N — never N / N
    expect(screen.getByText('producidas correctamente (activo)')).toBeInTheDocument();
    expect(screen.getByText(`/ ${total}`)).toBeInTheDocument();
  });
});

describe('answer lockout and key guards', () => {
  it('drops a second click that lands within 250ms of the next item appearing', () => {
    renderPlan(BAND3);
    clickYes();                                                  // item 1 answered
    // the double-click's second half: no tick, so it is inside item 2's lockout
    fireEvent.click(screen.getByRole('button', { name: /Sí, la conozco/ }));
    expect(submitMutate).not.toHaveBeenCalled();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    clickYes();                                                  // past the lockout
    expect(submitMutate).toHaveBeenCalledTimes(1);
  });

  it('ignores key auto-repeat and modified keys', () => {
    renderPlan(BAND3);
    tick();
    fireEvent.keyDown(document, { key: 's', repeat: true });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 's' });
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });
});

// The seven characters a US keyboard cannot produce. Accents are folded by norm(), but ñ is
// preserved — so on every typed surface the row is what makes the ñ words answerable at all.
describe('the special-character row reaches every typed surface', () => {
  const CHARS = ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'];
  const clickKey = (ch: string) => fireEvent.click(screen.getByRole('button', { name: `insertar ${ch}` }));

  const renderA500 = () =>
    render(<VocabTestRunner testId={1} mode="a500" settings={{ seed: 3, blk: 1, form: 'A' }} onExit={() => {}} />);

  it('the protocol typed phase shows all seven keys', () => {
    renderA500();
    for (const c of CHARS) expect(screen.getByRole('button', { name: `insertar ${c}` })).toBeEnabled();
  });

  it('a key inserts at the caret of the typed input, not at the end', () => {
    renderA500();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'maana' } });
    input.setSelectionRange(2, 2);
    clickKey('ñ');
    expect(input).toHaveValue('mañana');
    // the caret follows the character so typing continues in place
    expect(input.selectionStart).toBe(3);
    expect(document.activeElement).toBe(input);
  });

  it('a key replaces the selected range', () => {
    renderA500();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'manzana' } });
    input.setSelectionRange(2, 4);
    clickKey('ñ');
    expect(input).toHaveValue('mañana');
  });

  it('inserting is not answering: no item advance, no submitted result, lockout untouched', () => {
    renderA500();
    const before = screen.getByText(/^1 \//).textContent;
    // still inside the 250ms lockout — an answer here would be dropped, an insertion must not be
    CHARS.forEach(clickKey);
    expect(screen.getByRole('textbox')).toHaveValue(CHARS.join(''));
    expect(screen.getByText(/^1 \//).textContent).toBe(before);
    expect(submitMutate).not.toHaveBeenCalled();
  });

  it('a mousedown on a key is canceled, so the input never loses its caret', () => {
    renderA500();
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'insertar ñ' }))).toBe(false);
  });

  it('dictado gets the row, disabled until the clip has played', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    render(
      <VocabTestRunner
        testId={1}
        mode="dictado"
        settings={{ seed: 5 }}
        audioWords={[...DATA.bands.flatMap((b) => b.words), ...DATA.pseudo]}
        onExit={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'insertar ñ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Escuchar/ }));
    await screen.findByText(/1 reproducción disponible/);
    clickKey('ñ');
    expect(screen.getByRole('textbox')).toHaveValue('ñ');
  });

  it('the C-test row edits the most recently focused gap, at its caret', () => {
    render(
      <VocabTestRunner
        testId={1}
        mode="ctest"
        settings={{ seed: 1, ngaps: 6 }}
        texts={[{ id: 1, title: 'Texto', content: CTEST_TEXT }]}
        onExit={() => {}}
      />
    );
    const gaps = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(gaps.length).toBeGreaterThan(1);
    fireEvent.focus(gaps[1]);
    fireEvent.change(gaps[1], { target: { value: 'ao' } });
    gaps[1].setSelectionRange(1, 1);
    clickKey('ñ');
    expect(gaps[1]).toHaveValue('año');
    expect(gaps[0]).toHaveValue('');            // the unfocused gaps are untouched

    // moving focus moves the target
    fireEvent.focus(gaps[0]);
    clickKey('ú');
    expect(gaps[0]).toHaveValue('ú');
    expect(gaps[1]).toHaveValue('año');
  });
});

describe('aural items cannot be answered before the clip plays', () => {
  const auralWords = [...DATA.bands.flatMap((b) => b.words), ...DATA.pseudo];

  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();   // jsdom has no real media element
  });

  it('disables the yes/no buttons until the first play, then enables them', async () => {
    render(
      <VocabTestRunner
        testId={1}
        mode="listen2"
        settings={{ seed: 5 }}
        audioWords={auralWords}
        onExit={() => {}}
      />
    );
    expect(lastAudioWords.length).toBeGreaterThan(0);
    const yes = screen.getByRole('button', { name: /Sí, la conozco/ });
    expect(yes).toBeDisabled();
    expect(screen.getByText('Escucha el clip antes de responder.')).toBeInTheDocument();

    tick();
    fireEvent.keyDown(document, { key: 's' });   // the keyboard path is gated too
    expect(screen.getByText(/^1 \//)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Escuchar/ }));
    await screen.findByText(/1 reproducción disponible/);
    expect(screen.getByRole('button', { name: /Sí, la conozco/ })).toBeEnabled();
  });
});
