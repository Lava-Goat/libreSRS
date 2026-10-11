// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SentencesPanel from './SentencesPanel';

// Shared with the mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  panel: null as unknown,
  list: vi.fn(),
  preview: vi.fn(),
  hide: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ conjugation: { sentences: { panel: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    conjugation: {
      sentences: {
        panel: { useQuery: () => ({ data: h.panel, isLoading: false, error: null }) },
        list: {
          useQuery: (input: { entry: string }) => {
            h.list(input);
            return {
              data: {
                deckId: 7, entry: input.entry, label: input.entry, mode: 'builtIn',
                cells: [
                  {
                    tense: 'present', tenseLabel: 'presente', person: 'ellos', personLabel: 'ellos/ellas/Uds.', number: null, parked: [],
                    sentences: [
                      {
                        ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', source: 'builtIn', before: 'Mis primos', form: 'viven', after: 'en Lima.',
                        cue: 'vivir', english: 'My cousins live in Lima.', subjectKind: 'np_pl', warnings: [], hidden: false, status: null, used: true,
                      },
                      {
                        ref: 'tpl:vivir.city/pr:ellas/city=quito/present', source: 'builtIn', before: 'Ellas', form: 'viven', after: 'en Quito.',
                        cue: 'vivir', english: 'They live in Quito.', subjectKind: 'pronoun', warnings: [{ rule: 'noTimeWord', message: 'no time word', words: [] }],
                        hidden: true, status: null, used: false,
                      },
                      {
                        ref: 'tpl:vivir.city/pr:ellos/city=lima/present', source: 'builtIn', before: 'Ellos', form: 'viven', after: 'en Lima.',
                        cue: 'vivir', english: 'They live in Lima.', subjectKind: 'pronoun', warnings: [], hidden: false, status: null, used: false,
                      },
                    ],
                  },
                  { tense: 'present', tenseLabel: 'presente', person: 'yo', personLabel: 'yo', number: null, parked: [], sentences: [] },
                ],
              },
              isLoading: false,
              error: null,
            };
          },
        },
        preview: {
          useQuery: (input: { level: string }) => {
            h.preview(input);
            const choice = input.level === 'choice';
            return {
              data: {
                levels: ['choice', 'typed-lenient', 'typed-strict'],
                prompt: {
                  index: 0, total: 1, itemKey: 'x', kind: choice ? 'choice' : 'typed', level: input.level, strictAccents: input.level === 'typed-strict',
                  direction: 'toForm', retry: false, entryLabel: 'vivir', entryHint: null, tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null,
                  cue: null, form: null, optionsVerb: null, options: choice ? ['vive', 'viven', 'vivimos', 'vives'] : null, askTense: false, askPerson: false,
                  personOptions: null, tenseOptions: null, scheduledReview: false, fromDeck: null,
                  sentence: { before: 'Mis primos', after: 'en Lima.', cue: 'vivir', hint: choice ? 'ellos' : null, glosses: [] },
                },
                answer: 'viven', filled: 'Mis primos viven en Lima.', english: 'My cousins live in Lima.', hint: 'ellos',
              },
              isLoading: false,
              error: null,
            };
          },
        },
        hide: { useMutation: () => ({ mutate: h.hide, isPending: false, error: null }) },
        resolveReports: { useMutation: () => ({ mutate: h.resolve, isPending: false, error: null }) },
      },
    },
  },
}));

const panel = (overrides: Record<string, unknown> = {}) => ({
  deckId: 7, mode: 'builtIn', countedMode: 'builtIn', holdback: false, sentencesSince: '2026-10-12T15:00:00.000Z',
  levels: ['choice', 'typed-lenient', 'typed-strict'],
  coverage: { cells: 15, covered: 12, label: 3 },
  verbs: [{ entry: 'vivir', label: 'vivir', kind: 'plain', cells: 5, covered: 4, sentences: 40, hidden: 1 }],
  parked: [{
    ref: 'tpl:tener.class/co:ana-y-tu/-/present', source: 'builtIn', text: 'Ana y tú ___ (tener) clase.', entry: 'tener', label: 'tener',
    tenseLabel: 'presente', personLabel: 'ellos/ellas/Uds.', reasons: [{ rule: 'ambiguous', message: 'Ana y tú also fits vosotros' }],
  }],
  parkedCount: 1,
  reports: [{ ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', sentence: 'Mis primos ___ (vivir) en Lima.', itemKey: 'vivir|present|ellos|-|to', count: 2, lastAt: '2026-10-13T15:00:00.000Z' }],
  hard: [{ ref: 'tpl:ser.from/np:mis-tios/city=lima/present', itemKey: 'ser|present|ellos|-|to', label: 'ser · ellos/ellas/Uds. · presente', sentence: 'Mis tíos ___ (ser) de Lima.', answers: 20, misses: 12, otherAnswers: 40, otherMisses: 6 }],
  ...overrides,
});

function renderPanel(props: Partial<Parameters<typeof SentencesPanel>[0]> = {}) {
  const onMode = vi.fn();
  const onHoldback = vi.fn();
  render(<SentencesPanel deckId={7} mode="builtIn" holdback={false} saved="builtIn" saving={false} onMode={onMode} onHoldback={onHoldback} {...props} />);
  return { onMode, onHoldback };
}

describe('SentencesPanel (v1.25.0)', () => {
  beforeEach(() => {
    h.panel = panel();
    h.list.mockClear();
    h.preview.mockClear();
    h.hide.mockClear();
    h.resolve.mockClear();
  });

  it('puts the mode and the holdback in the draft, and says what they do', async () => {
    const { onMode, onHoldback } = renderPanel();
    expect(screen.getByRole('heading', { name: 'Sentences' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('How questions show who'), 'off');
    expect(onMode).toHaveBeenCalledWith('off');
    await userEvent.click(screen.getByRole('switch', { name: 'Measure it (holdback)' }));
    expect(onHoldback).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Measure it (holdback)' })).toHaveAccessibleDescription(/half the verbs show sentences and half the label/);
  });

  it('shows the coverage line, since when, and what Built-in would give while sentences are off', () => {
    renderPanel();
    expect(screen.getByText(/^12 of 15 forms have a sentence; 3 use the label\./)).toHaveTextContent('On since');
    h.panel = panel({ mode: 'off', sentencesSince: null });
    renderPanel({ mode: 'off', saved: 'off' });
    expect(screen.getByText('(with built-in sentences, once you turn them on)')).toBeInTheDocument();
  });

  it('says one form or one sentence in the singular', () => {
    h.panel = panel({
      coverage: { cells: 5, covered: 4, label: 1 },
      verbs: [{ entry: 'vivir', label: 'vivir', kind: 'plain', cells: 5, covered: 1, sentences: 1, hidden: 0 }],
    });
    renderPanel();
    expect(screen.getByText(/^4 of 5 forms have a sentence; 1 uses the label\./)).toBeInTheDocument();
    expect(screen.getByText('1 of 5 forms · 1 sentence')).toBeInTheDocument();
  });

  it('warns that the holdback needs sentences on, and that a changed mode waits for Save', () => {
    renderPanel({ mode: 'off', holdback: true });
    expect(screen.getByText('It needs sentences on: with Off, every question shows the label.')).toBeInTheDocument();
    expect(screen.getByText('Saved when you press Save.')).toBeInTheDocument();
  });

  it('lists a verb\'s sentences filled in with their English, hides one, and previews it as a student at each rung', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show sentences: vivir' }));
    expect(h.list).toHaveBeenCalledWith({ deckId: 7, entry: 'vivir' });
    const first = screen.getByText('My cousins live in Lima.').closest('li')!;
    expect(within(first).getByText('viven').tagName).toBe('MARK');
    expect(screen.getByText('no sentence: the label', { exact: false })).toBeInTheDocument();
    const hidden = screen.getByText('They live in Quito.').closest('li')!;
    expect(hidden).toHaveTextContent('hidden');
    expect(hidden).toHaveTextContent('No time word: only the tense label tells the tense.');

    await userEvent.click(within(first).getByRole('button', { name: 'Hide' }));
    expect(h.hide).toHaveBeenCalledWith({ deckId: 7, ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', hidden: true });
    await userEvent.click(within(hidden).getByRole('button', { name: 'Show again' }));
    expect(h.hide).toHaveBeenCalledWith({ deckId: 7, ref: 'tpl:vivir.city/pr:ellas/city=quito/present', hidden: false });

    await userEvent.click(within(first).getByRole('button', { name: 'Preview as a student' }));
    const preview = within(first).getByRole('group', { name: 'Preview as a student' }).parentElement!;
    expect(within(preview).getByText('(ellos)')).toBeInTheDocument();
    expect(within(preview).getByRole('list', { name: 'Options' })).toHaveTextContent('viven');
    expect(preview).toHaveTextContent('Answer: viven · Mis primos viven en Lima. · My cousins live in Lima.');
    await userEvent.click(within(preview).getByRole('button', { name: 'Typed · accents count' }));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'typed-strict', ref: 'tpl:vivir.city/np:mis-primos/city=lima/present' }));
    expect(within(preview).queryByText('(ellos)')).not.toBeInTheDocument();
    expect(preview).toHaveTextContent('The student types the form; accents count.');
  });

  it('names each row\'s buttons by their sentence, marks one the mode does not show, and closes from the end too', async () => {
    renderPanel();
    const toggle = screen.getByRole('button', { name: 'Show sentences: vivir' });
    expect(toggle).toHaveTextContent('Show sentences');
    await userEvent.click(toggle);
    const first = screen.getByText('My cousins live in Lima.').closest('li')!;
    expect(within(first).getByRole('button', { name: 'Hide' })).toHaveAccessibleDescription('Mis primos viven en Lima.');
    expect(within(first).getByRole('button', { name: 'Preview as a student' })).toHaveAccessibleDescription('Mis primos viven en Lima.');
    expect(first).not.toHaveTextContent('not shown in this mode');
    const unused = screen.getByText('They live in Lima.').closest('li')!;
    expect(unused).toHaveTextContent('not shown in this mode');
    // "hidden" says it already: a hidden row does not say both.
    expect(screen.getByText('They live in Quito.').closest('li')!).not.toHaveTextContent('not shown in this mode');

    const ends = screen.getAllByRole('button', { name: 'Hide sentences: vivir' });
    expect(ends).toHaveLength(2);
    await userEvent.click(ends[1]);
    expect(screen.queryByText('My cousins live in Lima.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show sentences: vivir' })).toHaveFocus());
  });

  it('shows the chosen rung of a preview in its own colours, not layered over the others', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show sentences: vivir' }));
    const first = screen.getByText('My cousins live in Lima.').closest('li')!;
    await userEvent.click(within(first).getByRole('button', { name: 'Preview as a student' }));
    const chosen = within(first).getByRole('button', { name: 'Multiple choice' });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    expect(chosen.className).toMatch(/\bbg-blue-600\b/);
    expect(chosen.className).toMatch(/\btext-white\b/);
    expect(chosen.className).not.toMatch(/\bbg-gray-100\b|\btext-gray-800\b|dark:bg-gray-700/);
    const other = within(first).getByRole('button', { name: 'Typed · accents count' });
    expect(other.className).not.toMatch(/\bbg-blue-600\b/);
  });

  it('keeps the focus in the reports when Done removes a row', async () => {
    const two = [
      { ref: 'tpl:a', sentence: 'Mis primos ___ (vivir) en Lima.', itemKey: 'vivir|present|ellos|-|to', count: 2, lastAt: '2026-10-13T15:00:00.000Z' },
      { ref: 'tpl:b', sentence: 'Mi abuela ___ (vivir) en Quito.', itemKey: 'vivir|present|el|-|to', count: 1, lastAt: '2026-10-13T15:00:00.000Z' },
    ];
    h.panel = panel({ reports: two });
    const props = { deckId: 7, mode: 'builtIn' as const, holdback: false, saved: 'builtIn' as const, saving: false, onMode: vi.fn(), onHoldback: vi.fn() };
    const { rerender } = render(<SentencesPanel {...props} />);
    const dones = screen.getAllByRole('button', { name: 'Done' });
    expect(dones[0]).toHaveAccessibleDescription('Mis primos ___ (vivir) en Lima.');
    await userEvent.click(dones[0]);
    h.panel = panel({ reports: [two[1]] });
    rerender(<SentencesPanel {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    h.panel = panel({ reports: [] });
    rerender(<SentencesPanel {...props} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sentences' })).toHaveFocus());
  });

  it('lists the students\' reports (Hide, Done), the hard sentences and the parked ones with why', async () => {
    renderPanel();
    const reports = screen.getByRole('heading', { name: 'Reported by students' }).parentElement!;
    expect(reports).toHaveTextContent('Mis primos ___ (vivir) en Lima.');
    expect(reports).toHaveTextContent('2 reports');
    await userEvent.click(within(reports).getByRole('button', { name: 'Done' }));
    expect(h.resolve).toHaveBeenCalledWith({ deckId: 7, ref: 'tpl:vivir.city/np:mis-primos/city=lima/present' });
    await userEvent.click(within(reports).getByRole('button', { name: 'Hide' }));
    expect(h.hide).toHaveBeenCalledWith({ deckId: 7, ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', hidden: true });

    const hard = screen.getByRole('heading', { name: 'Hard sentences' }).parentElement!;
    expect(hard).toHaveTextContent('Mis tíos ___ (ser) de Lima.missed 12 of 20 · otherwise 6 of 40');
    const parked = screen.getByRole('heading', { name: 'Parked sentences' }).parentElement!;
    expect(parked).toHaveTextContent('Ana y tú ___ (tener) clase.');
    expect(parked).toHaveTextContent('Ana y tú also fits vosotros');
  });
});
