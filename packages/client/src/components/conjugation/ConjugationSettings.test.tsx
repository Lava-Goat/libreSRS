// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTE_UNKNOWN } from '@libresrs/shared/conjugation';
import ConjugationSettings from './ConjugationSettings';

type View = Record<string, unknown> & { settings: Record<string, unknown> };

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  view: null as unknown,
  refetch: vi.fn(async () => ({})),
  save: vi.fn(async (_input: Record<string, unknown>): Promise<unknown> => ({})),
  setData: vi.fn(),
  invalidateMine: vi.fn(async () => {}),
  invalidateResults: vi.fn(async () => {}),
  preview: vi.fn(),
  invalidateSentences: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      conjugation: {
        settings: { setData: (key: unknown, value: unknown) => { h.setData(key, value); h.view = value; } },
        myQuizzes: { invalidate: h.invalidateMine },
        results: { invalidate: h.invalidateResults },
        sentences: { invalidate: h.invalidateSentences, panel: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      },
    }),
    conjugation: {
      settings: { useQuery: () => ({ data: h.view, isLoading: false, error: null, refetch: h.refetch }) },
      saveSettings: { useMutation: () => ({ mutateAsync: h.save }) },
      preview: {
        useQuery: (input: { entry: string; tenses: string[] }, opts: unknown) => {
          h.preview(input, opts);
          return {
            data: {
              entry: input.entry,
              label: input.entry,
              kind: 'plain',
              known: input.entry !== 'bloguear',
              // The server notes an unknown verb in its preview too.
              note: input.entry === 'bloguear' ? NOTE_UNKNOWN : null,
              cells: input.tenses.flatMap((tense) => [
                { tense, tenseLabel: tense === 'present' ? 'presente' : 'pretérito', person: 'yo', personLabel: 'yo', number: null, cue: null, forms: [tense === 'present' ? 'tengo' : 'tuve'] },
                { tense, tenseLabel: tense === 'present' ? 'presente' : 'pretérito', person: 'tu', personLabel: 'tú', number: null, cue: null, forms: [tense === 'present' ? 'tienes' : 'tuviste'] },
              ]),
            },
            isLoading: false,
            error: null,
          };
        },
      },
      results: {
        useQuery: () => ({
          data: { deckId: 7, deckName: 'Unidad 1', enabled: false, total: 60, students: [], mostMissed: [] },
          isLoading: false,
          error: null,
        }),
      },
      // v1.25.0: the Sentences panel (SentencesPanel.test.tsx tests it; here it only has to show).
      sentences: {
        panel: {
          useQuery: () => ({
            data: {
              deckId: 7, mode: 'off', countedMode: 'builtIn', holdback: false, sentencesSince: null, levels: ['choice'],
              coverage: { cells: 5, covered: 5, label: 0 }, verbs: [], parked: [], parkedCount: 0, reports: [], hard: [],
            },
            isLoading: false,
            error: null,
          }),
        },
        list: { useQuery: () => ({ data: undefined, isLoading: true, error: null }) },
        preview: { useQuery: () => ({ data: undefined, isLoading: true, error: null }) },
        hide: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
        resolveReports: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      },
    },
  },
}));

const card = (id: number, front: string, back: string) => ({ id, front, back });
const entry = (overrides: Record<string, unknown>) => ({
  entry: 'tener',
  label: 'tener',
  kind: 'plain',
  known: true,
  cards: [],
  note: null,
  excludedByDefault: false,
  included: true,
  extra: false,
  ...overrides,
});

const settings = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  tenses: ['present'],
  includeVosotros: false,
  vos: 'none',
  directions: 'both',
  answerMode: 'progressive',
  accentMode: 'progressive',
  roundLength: 20,
  excludedEntries: [],
  extraEntries: [],
  ...overrides,
});

function makeView(overrides: Partial<View> = {}): View {
  return {
    deckId: 7,
    deckName: 'Unidad 1',
    settings: settings(),
    effective: ['tener', 'llamarse', 'gustarle', 'haber-impersonal'],
    verbCount: 4,
    itemCount: 40,
    cardCount: 30,
    entries: [
      entry({ cards: [card(1, '<b>tengo</b>', 'I have'), card(2, 'tienes', 'you have'), card(3, 'tiene', 'has'), card(4, 'tenemos', 'we have')] }),
      entry({ entry: 'llamarse', label: 'llamarse', kind: 'pronominal', cards: [card(5, 'me llamo', 'my name is')] }),
      entry({ entry: 'gustarle', label: 'gustarle', kind: 'dative', note: 'used with me/te/le: practiced as "me gusta(n)"', cards: [card(6, 'me gusta', 'I like')] }),
      entry({ entry: 'haber-impersonal', label: 'haber (hay)', kind: 'impersonal', note: 'impersonal: practiced as hay / había / hubo…', cards: [card(7, 'hay', 'there is')] }),
      entry({ entry: 'serse', label: 'serse', kind: 'pronominal', excludedByDefault: true, included: false }),
    ],
    ...overrides,
  };
}

/** A settings view after a save of `input` (the counts are not the point). */
function viewAfter(input: Record<string, unknown>): View {
  const base = makeView();
  const fields = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'deckId'));
  return { ...base, settings: { ...base.settings, ...fields } };
}

const renderSettings = (props: { cardCount?: number; onDirtyChange?: (dirty: boolean) => void } = {}) => render(
  <MemoryRouter><ConjugationSettings deckId={7} {...props} /></MemoryRouter>,
);
const verbRow = (label: string) => screen.getByRole('checkbox', { name: label }).closest('li')!;

describe('ConjugationSettings', () => {
  beforeEach(() => {
    h.view = makeView();
    h.refetch.mockClear();
    h.save.mockReset();
    h.save.mockImplementation(async (input) => viewAfter(input));
    h.setData.mockClear();
    h.invalidateMine.mockClear();
    h.invalidateResults.mockClear();
    h.preview.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the saved settings, the verbs found and the summary', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Conjugation' })).toBeInTheDocument();
    expect(screen.getByText(/Students see it as “Unidad 1 conjugation”/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Students can practice it' })).toHaveAttribute('aria-checked', 'false');

    // Every tense, in the engine's order, with present checked.
    const tenses = within(screen.getByRole('group', { name: 'Tenses' })).getAllByRole('checkbox');
    expect(tenses).toHaveLength(12);
    expect(tenses[0]).toBeChecked();
    expect(tenses[0].closest('label')).toHaveTextContent('presente (present)');
    expect(tenses.slice(1).every((c) => !(c as HTMLInputElement).checked)).toBe(true);

    expect(screen.getByLabelText('Include vosotros')).not.toBeChecked();
    expect(screen.getByLabelText('vos')).toHaveValue('none');
    expect(screen.getByLabelText('Directions')).toHaveValue('both');
    expect(screen.getByLabelText('Answers')).toHaveValue('progressive');
    expect(screen.getByLabelText('Accents')).toHaveValue('progressive');
    expect(screen.getByLabelText('Questions per round')).toHaveValue('20');

    // Kinds, source cards (HTML stripped, the rest counted) and notes.
    expect(verbRow('tener')).toHaveTextContent('From: tengo — I have; tienes — you have; tiene — has and 1 more');
    expect(within(verbRow('llamarse')).getByText('reflexive')).toBeInTheDocument();
    expect(within(verbRow('gustarle')).getByText('“me gusta” type')).toBeInTheDocument();
    expect(verbRow('gustarle')).toHaveTextContent('Used with me/te/le: practiced as “me gusta(n)”');
    expect(within(verbRow('haber (hay)')).getByText('impersonal')).toBeInTheDocument();
    expect(verbRow('haber (hay)')).toHaveTextContent('Impersonal: practiced as hay / había / hubo…');
    expect(screen.getByRole('checkbox', { name: 'serse' })).not.toBeChecked();
    expect(verbRow('serse')).toHaveTextContent('left out by default');

    expect(screen.getByText('4 verbs · 40 items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('opens Try it in a new tab', () => {
    renderSettings();
    const link = screen.getByRole('link', { name: 'Try it' });
    expect(link).toHaveAttribute('href', '/conjugation/7');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('saves every setting of the draft', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('switch', { name: 'Students can practice it' }));
    await user.click(screen.getByLabelText('pretérito (preterite)'));
    await user.click(screen.getByLabelText('Include vosotros'));
    await user.selectOptions(screen.getByLabelText('vos'), 'rioplatense');
    await user.selectOptions(screen.getByLabelText('Directions'), 'toForm');
    await user.selectOptions(screen.getByLabelText('Accents'), 'required');
    await user.clear(screen.getByLabelText('Questions per round'));
    await user.type(screen.getByLabelText('Questions per round'), '10');
    await user.click(screen.getByRole('checkbox', { name: 'llamarse' }));
    // Left out by the detector: it can only join as an added verb.
    await user.click(screen.getByRole('checkbox', { name: 'serse' }));
    await user.type(screen.getByLabelText('Add a verb'), ' Bailar {Enter}');
    expect(screen.getByRole('checkbox', { name: 'bailar' })).toBeChecked();
    expect(verbRow('bailar')).toHaveTextContent('added — saved when you press Save');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(screen.getByText('(as saved)')).toBeInTheDocument();

    // v1.25.0: sentences with a blank, and the holdback, are part of the draft.
    await user.selectOptions(screen.getByLabelText('How questions show who'), 'builtIn');
    expect(screen.getByText('Saved when you press Save.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Measure it (holdback)' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.save).toHaveBeenCalledWith({
      deckId: 7,
      enabled: true,
      tenses: ['present', 'preterite'],
      includeVosotros: true,
      vos: 'rioplatense',
      directions: 'toForm',
      answerMode: 'progressive',
      accentMode: 'required',
      roundLength: 10,
      excludedEntries: ['llamarse'],
      extraEntries: ['serse', 'bailar'],
      sentences: 'builtIn',
      sentenceHoldback: true,
    });
    expect(h.invalidateSentences).toHaveBeenCalled();
    expect(h.setData).toHaveBeenCalledWith({ deckId: 7 }, expect.objectContaining({ deckId: 7 }));
    expect(h.invalidateMine).toHaveBeenCalled();
    expect(h.invalidateResults).toHaveBeenCalledWith({ deckId: 7 });
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByRole('switch', { name: 'Students can practice it' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('puts a left-out verb back and drops an added one', async () => {
    h.view = makeView({ settings: settings({ excludedEntries: ['tener'], extraEntries: ['bailar'] }) });
    h.view = { ...(h.view as View), entries: [...(h.view as View).entries as unknown[], entry({ entry: 'bailar', label: 'bailar', extra: true })] };
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByRole('checkbox', { name: 'tener' })).not.toBeChecked();
    expect(verbRow('bailar')).toHaveTextContent('added by you');
    await user.click(screen.getByRole('checkbox', { name: 'tener' }));
    await user.click(screen.getByRole('checkbox', { name: 'bailar' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ excludedEntries: [], extraEntries: [] }));
  });

  it('checks the draft before saving', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('presente (present)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one tense.');

    await user.click(screen.getByLabelText('presente (present)'));
    await user.clear(screen.getByLabelText('Questions per round'));
    await user.type(screen.getByLabelText('Questions per round'), '70');
    expect(screen.getByLabelText('Questions per round')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The round length must be a whole number from 5 to 60.');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('refuses a verb it cannot read, and one already listed', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Add a verb'), 'perro{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('“perro” is not a Spanish verb.');
    expect(screen.getByLabelText('Add a verb')).toHaveAttribute('aria-invalid', 'true');

    await user.clear(screen.getByLabelText('Add a verb'));
    await user.type(screen.getByLabelText('Add a verb'), 'Tener');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tener is already in the list.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the server’s refusal', async () => {
    h.save.mockRejectedValueOnce(new Error('Added: not a Spanish verb: xyz'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('switch', { name: 'Students can practice it' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Added: not a Spanish verb: xyz');
    // The draft is kept for another try.
    expect(screen.getByRole('switch', { name: 'Students can practice it' })).toHaveAttribute('aria-checked', 'true');
  });

  it('discards the draft', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('Include vosotros'));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Include vosotros')).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
  });

  it('previews the forms of a verb for the tenses picked in the draft', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('pretérito (preterite)'));
    await user.click(screen.getByLabelText('Include vosotros'));
    const button = within(verbRow('tener')).getByRole('button', { name: 'Preview forms of tener' });
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(h.preview).toHaveBeenLastCalledWith(
      { entry: 'tener', tenses: ['present', 'preterite'], vosotros: true, vos: 'none' },
      { enabled: true },
    );
    const preview = document.getElementById(button.getAttribute('aria-controls')!)!;
    const preterite = within(preview).getByRole('table', { name: 'pretérito' });
    expect(within(preterite).getByRole('row', { name: 'tú tuviste' })).toBeInTheDocument();

    await user.click(within(verbRow('tener')).getByRole('button', { name: 'Hide forms of tener' }));
    expect(screen.queryByRole('table', { name: 'pretérito' })).not.toBeInTheDocument();
  });

  it('says naming the verb is always multiple choice while the quiz asks it', async () => {
    const user = userEvent.setup();
    renderSettings();
    const hint = 'Naming the verb is always multiple choice: every typed answer is a conjugated form.';
    expect(screen.getByLabelText('Directions')).toHaveAccessibleDescription(hint);

    await user.selectOptions(screen.getByLabelText('Directions'), 'toForm');
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Directions'), 'fromForm');
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('only lets the accents be picked when answers are typed', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.selectOptions(screen.getByLabelText('Answers'), 'choice');
    expect(screen.getByLabelText('Accents')).toBeDisabled();
    expect(screen.getByText('Accents only matter in typed answers.')).toBeInTheDocument();
  });

  it('warns when the quiz is on with no verbs', async () => {
    h.view = makeView({ entries: [], verbCount: 0, itemCount: 0 });
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByText(/No verbs found in this deck’s cards/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Students can practice it' }));
    expect(screen.getByText('Students see no quiz until at least one verb is included.')).toBeInTheDocument();
  });

  it('reads the verbs again when cards were imported', () => {
    const { rerender } = renderSettings({ cardCount: 30 });
    expect(h.refetch).not.toHaveBeenCalled();
    rerender(<MemoryRouter><ConjugationSettings deckId={7} cardCount={35} /></MemoryRouter>);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('switches to the results and back without losing the draft', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('Include vosotros'));
    const toggle = screen.getByRole('button', { name: 'Results' });
    await user.click(toggle);
    expect(screen.getByRole('heading', { name: 'Most missed' })).toBeInTheDocument();
    // The label says where it goes; a pressed state on top would contradict it.
    expect(toggle).toHaveAccessibleName('Back to settings');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(screen.getByLabelText('Include vosotros')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(screen.getByLabelText('Include vosotros')).toBeChecked();
  });

  it('clears a Save complaint once the draft is edited', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('presente (present)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one tense.');

    await user.click(screen.getByLabelText('pretérito (preterite)'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the server’s refusal once the draft is edited', async () => {
    h.save.mockRejectedValueOnce(new Error('Added: not a Spanish verb: xyz'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText('Include vosotros'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Added: not a Spanish verb: xyz');
    await user.selectOptions(screen.getByLabelText('Directions'), 'toForm');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a just-added verb listed, and focused, when it is unticked', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Add a verb'), 'bailar{Enter}');
    const bailar = screen.getByRole('checkbox', { name: 'bailar' });
    await user.click(bailar);

    expect(bailar).toBeInTheDocument();
    expect(bailar).not.toBeChecked();
    expect(bailar).toHaveFocus();
    expect(verbRow('bailar')).not.toHaveTextContent('added — saved when you press Save');

    // Ticked again, it is added again.
    await user.click(bailar);
    expect(bailar).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ extraEntries: ['bailar'] }));
  });

  it('keeps the rows in place when one of several just-added verbs is unticked', async () => {
    const user = userEvent.setup();
    renderSettings();
    const labels = () => screen.getAllByRole('checkbox')
      .map((box) => box.closest('li')?.querySelector('[lang="es"]')?.textContent)
      .filter(Boolean);

    await user.type(screen.getByLabelText('Add a verb'), 'bailar{Enter}');
    await user.type(screen.getByLabelText('Add a verb'), 'cantar{Enter}');
    const before = labels();
    expect(before.slice(-2)).toEqual(['bailar', 'cantar']);

    await user.click(screen.getByRole('checkbox', { name: 'bailar' }));
    expect(screen.getByRole('checkbox', { name: 'bailar' })).not.toBeChecked();
    expect(labels()).toEqual(before);
  });

  it('drops an unticked just-added verb on Discard', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Add a verb'), 'bailar{Enter}');
    await user.click(screen.getByLabelText('Include vosotros'));
    await user.click(screen.getByRole('checkbox', { name: 'bailar' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('checkbox', { name: 'bailar' })).not.toBeInTheDocument();
  });

  it('warns when the included verbs have no forms in the tenses picked', async () => {
    h.view = makeView({
      settings: settings({ enabled: true, tenses: ['imperativeAffirmative'] }),
      entries: [
        entry({ entry: 'gustarle', label: 'gustarle', kind: 'dative' }),
        entry({ entry: 'haber-impersonal', label: 'haber (hay)', kind: 'impersonal' }),
        entry({ entry: 'llover', label: 'llover', kind: 'impersonal' }),
      ],
      verbCount: 3,
      itemCount: 0,
    });
    const user = userEvent.setup();
    renderSettings();

    const warning = 'Students see no quiz: these verbs have no forms in the tenses picked.';
    expect(screen.getByText(warning)).toBeInTheDocument();
    // Worked out from the draft: a tense with forms clears it before Save.
    await user.click(screen.getByLabelText('presente (present)'));
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it('shows an unknown verb’s note once when its forms are previewed', async () => {
    h.view = makeView({ entries: [entry({ entry: 'bloguear', label: 'bloguear', known: false, note: NOTE_UNKNOWN })] });
    const user = userEvent.setup();
    renderSettings();

    const note = 'Not in the dictionary: conjugated as a regular verb. Check the forms.';
    expect(within(verbRow('bloguear')).getAllByText(note)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Preview forms of bloguear' }));
    expect(screen.getByRole('table', { name: 'presente' })).toBeInTheDocument();
    expect(within(verbRow('bloguear')).getAllByText(note)).toHaveLength(1);
  });

  it('shows card text with its HTML entities decoded', () => {
    h.view = makeView({ entries: [entry({ cards: [card(1, 'Tom &amp; Jerry <i>tienen</i>', 'they&#39;ve &quot;got&quot;')] })] });
    renderSettings();
    expect(verbRow('tener')).toHaveTextContent('From: Tom & Jerry tienen — they\'ve "got"');
  });

  it('tells the page when the draft has unsaved changes', async () => {
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderSettings({ onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByLabelText('Include vosotros'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByLabelText('Include vosotros'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
