// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConjugationRunner, { MasteryBar, blankFill, type ConjugationOverview, type StudyAllOverview } from './ConjugationRunner';

// Shared with the trpc mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  start: vi.fn(),
  startAll: vi.fn(),
  answer: vi.fn(),
  finish: vi.fn(),
  report: vi.fn(),
  current: vi.fn(),
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ client: { conjugation: { current: { query: h.current } } } }),
    conjugation: {
      start: { useMutation: () => ({ mutateAsync: h.start }) },
      startAll: { useMutation: () => ({ mutateAsync: h.startAll }) },
      answer: { useMutation: () => ({ mutateAsync: h.answer }) },
      finish: { useMutation: () => ({ mutateAsync: h.finish }) },
      reportSentence: { useMutation: () => ({ mutateAsync: h.report }) },
    },
  },
}));

type Prompt = ReturnType<typeof prompt>;

function prompt(overrides: Partial<{
  index: number; total: number; itemKey: string; kind: 'choice' | 'typed';
  level: 'choice' | 'typed-lenient' | 'typed-strict'; strictAccents: boolean; direction: 'toForm' | 'fromForm';
  retry: boolean; entryLabel: string | null; tense: string | null; tenseLabel: string | null; personLabel: string | null;
  cue: string | null; form: string | null; options: string[] | null; askTense: boolean; askPerson: boolean;
  personOptions: { id: string; label: string }[] | null; tenseOptions: { id: string; label: string }[] | null;
  entryHint: 'impersonal' | null; scheduledReview: boolean; fromDeck: { deckId: number; deckName: string } | null;
  personId: string | null; optionsVerb: string | null;
}> = {}) {
  return {
    index: 0,
    total: 3,
    itemKey: 'k0',
    kind: 'choice' as const,
    level: 'choice' as const,
    strictAccents: false,
    direction: 'toForm' as const,
    retry: false,
    entryLabel: 'tener',
    tense: 'present',
    tenseLabel: 'presente',
    personLabel: 'yo',
    cue: null,
    form: null,
    options: ['tengo', 'tiene', 'teno', 'tenemos'],
    askTense: false,
    askPerson: false,
    personOptions: null,
    tenseOptions: null,
    entryHint: null,
    scheduledReview: false,
    fromDeck: null,
    personId: null as string | null,
    optionsVerb: null as string | null,
    ...overrides,
  };
}

/** conjugation.answer's response (v1.13): by default a right answer that climbs a rung. */
function result(overrides: Record<string, unknown> = {}) {
  return {
    result: 'correct',
    counted: true,
    nearMiss: false,
    correctAnswer: 'tengo',
    alsoCorrect: [],
    mistake: null,
    levelBefore: 0,
    levelAfter: 1,
    levelKindAfter: 'typed-lenient',
    mastered: false,
    outcome: overrides.counted === false ? 'down' : 'up',
    masteredNow: false,
    masteryPending: false,
    review: false,
    nextReviewDays: null,
    requeued: false,
    total: 3,
    next: prompt({ index: 1, itemKey: 'k1' }),
    finished: false,
    summary: null,
    finishedSets: [],
    ...overrides,
  };
}

const overview = {
  deckId: 5,
  deckName: 'Unidad 1',
  enabled: true,
  tenses: [{ id: 'present', label: 'presente' }],
  includeVosotros: false,
  vos: 'none',
  directions: 'both',
  answerMode: 'progressive',
  accentMode: 'progressive',
  roundLength: 20,
  levels: ['choice', 'typed-lenient', 'typed-strict'],
  verbs: [
    { entry: 'tener', label: 'tener', kind: 'plain', mastered: 2, total: 12 },
    { entry: 'gustarle', label: 'gustarle', kind: 'dative', mastered: 0, total: 12 },
  ],
  mastered: 2,
  total: 24,
  rounds: 1,
  lastScore: 0.5,
  bestScore: 0.75,
  lastPlayed: null,
  openRound: null,
} as unknown as ConjugationOverview;

const openOverview = {
  ...overview,
  openRound: { roundId: 7, index: 4, total: 21, answers: 4, startedAt: new Date() },
} as unknown as ConjugationOverview;

/** conjugation.current's answer: the round as the server has it. */
function roundAt(p: Prompt, extra: Record<string, unknown> = {}) {
  return {
    roundId: 7, deckId: 5, deckName: 'Unidad 1', total: p.total, review: false, levels: [],
    index: p.index, answers: p.index, firstTryCorrect: 0, prompt: p, ...extra,
  };
}

/** An answer as the runner sends it: with how long the question took (measured, never shown). */
function sent(roundId: number, index: number, answer: Record<string, string>) {
  return { roundId, index, answer, ms: expect.any(Number) };
}

function trpcError(code: string, appCode?: string) {
  return Object.assign(new Error(code), { data: { code, appCode } });
}

function renderRunner(onRoundOver = vi.fn(), props: { overview?: ConjugationOverview; refreshing?: boolean } = {}) {
  render(
    <MemoryRouter>
      <ConjugationRunner deckId={5} overview={props.overview ?? overview} onRoundOver={onRoundOver} refreshing={props.refreshing} />
    </MemoryRouter>,
  );
  return onRoundOver;
}

async function startWith(first: Prompt, extra: Record<string, unknown> = {}) {
  h.start.mockResolvedValueOnce({ roundId: 9, deckName: 'Unidad 1', total: first.total, review: false, levels: [], prompt: first, ...extra });
  await userEvent.click(screen.getByRole('button', { name: 'Start a round' }));
}

describe('ConjugationRunner', () => {
  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
    h.finish.mockReset();
    h.current.mockReset();
  });

  it('shows where the student stands before a round', () => {
    renderRunner();
    expect(screen.getByRole('progressbar', { name: 'Mastered' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('2 / 24 mastered')).toBeInTheDocument();
    expect(screen.getByText('presente')).toBeInTheDocument();
    expect(screen.getByText('gustarle')).toBeInTheDocument();
    expect(screen.getByText(/Last round: 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Best: 75%/)).toBeInTheDocument();
  });

  it('answers a multiple-choice prompt with the number keys and moves on with Enter', async () => {
    renderRunner();
    await startWith(prompt());
    expect(h.start).toHaveBeenCalledWith({ deckId: 5 });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('yo')).toBeInTheDocument();
    expect(screen.getByText('(tener)')).toBeInTheDocument();

    h.answer.mockResolvedValueOnce(result({
      result: 'wrong', counted: false, levelAfter: 0, levelKindAfter: 'choice', requeued: true, total: 4,
    }));
    await userEvent.keyboard('2');
    expect(h.answer).toHaveBeenCalledWith(sent(9, 0, { choice: 'tiene' }));
    expect(await screen.findByText(/Not quite. The answer:/)).toBeInTheDocument();
    expect(screen.getByText('You answered:')).toBeInTheDocument();
    expect(screen.getByText('This one comes back at the end of the round.')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    // The options are locked once answered.
    expect(screen.getByRole('button', { name: /tengo/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.queryByText(/Not quite/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tengo/ })).toBeEnabled();
  });

  it('does not send a second answer while the first is on its way', async () => {
    renderRunner();
    await startWith(prompt());
    let resolve: (v: unknown) => void = () => {};
    h.answer.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const option = screen.getByRole('button', { name: /tengo/ });
    fireEvent.click(option);
    fireEvent.click(option);
    fireEvent.keyDown(document, { key: '3' });
    expect(h.answer).toHaveBeenCalledTimes(1);
    resolve(result());
    expect(await screen.findByText(/Correct!/)).toBeInTheDocument();
    expect(screen.getByText('Next time, you type it.')).toBeInTheDocument();
  });

  it('ignores a held Enter so it cannot skip a prompt', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toHaveFocus();
    // The repeat lands on the focused Next button: its default (a click) must be stopped, not just ignored.
    expect(fireEvent.keyDown(nextButton, { key: 'Enter', repeat: true })).toBe(false);
    expect(screen.getByText(/Correct!/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.queryByText(/Correct!/)).not.toBeInTheDocument();
  });

  it('does not let a held Enter submit the next typed prompt empty', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result({ next: prompt({ index: 1, itemKey: 'k1', kind: 'typed', level: 'typed-lenient', options: null }) }));
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    fireEvent.keyDown(document, { key: 'Enter' });
    const input = await screen.findByLabelText('Your answer');
    expect(input).toHaveFocus();
    // The same Enter, still held, repeats into the new input: the form must not take it as a submit.
    expect(fireEvent.keyDown(input, { key: 'Enter', repeat: true })).toBe(false);
    // A fresh press still checks (not stopped here: the browser submits the form).
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('types a form with the accent keys and flags an accent slip', async () => {
    renderRunner();
    await startWith(prompt({
      kind: 'typed', level: 'typed-strict', strictAccents: true, options: null,
      entryLabel: 'estar', personLabel: 'tú', tenseLabel: 'presente',
    }));
    const input = screen.getByLabelText('Your answer (accents count)');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'est');
    await userEvent.click(screen.getByRole('button', { name: 'insertar á' }));
    await userEvent.type(input, 's');
    expect(input).toHaveValue('estás');

    h.answer.mockResolvedValueOnce(result({
      result: 'accent', counted: false, nearMiss: true, correctAnswer: 'estás', levelAfter: 1, levelKindAfter: 'typed-lenient',
    }));
    await userEvent.type(input, '{Enter}');
    expect(h.answer).toHaveBeenCalledWith(sent(9, 0, { text: 'estás' }));
    expect(await screen.findByText(/Almost — check the accent:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
  });

  it('moves on with Enter from the answered prompt\'s own answer box, but not on a held Enter', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-strict', strictAccents: true, options: null, entryLabel: 'vivir', personLabel: 'él' }));
    const input = screen.getByLabelText('Your answer (accents count)');
    h.answer.mockResolvedValueOnce(result({
      result: 'accent', counted: false, nearMiss: true, correctAnswer: 'vivió', levelAfter: 1, levelKindAfter: 'typed-lenient',
    }));
    await userEvent.type(input, 'vivio{Enter}');
    await screen.findByText(/Almost — check the accent:/);
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();

    // The student clicks back into the (read-only) box to look at the accent, then presses Enter.
    await userEvent.click(input);
    expect(input).toHaveFocus();
    // A repeat (still held from the check) does not skip, and its implicit submit is stopped.
    expect(fireEvent.keyDown(input, { key: 'Enter', repeat: true })).toBe(false);
    expect(screen.getByText(/Almost — check the accent:/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText(/Almost — check the accent:/)).not.toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(h.answer).toHaveBeenCalledTimes(1);
  });

  it('moves on with Enter from the answered identify prompt\'s verb box', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', kind: 'typed', level: 'typed-lenient', options: null, entryLabel: null, personLabel: null,
      tense: null, tenseLabel: null, form: 'tuvimos',
    }));
    const verb = screen.getByLabelText('The verb, in its dictionary form (infinitive)');
    h.answer.mockResolvedValueOnce(result({ correctAnswer: 'tener' }));
    await userEvent.type(verb, 'tener{Enter}');
    await screen.findByText(/Correct!/);
    await userEvent.click(verb);
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText(/Correct!/)).not.toBeInTheDocument();
    expect(h.answer).toHaveBeenCalledTimes(1);
  });

  it('asks for something typed before checking', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', options: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type your answer first.');
    expect(h.answer).not.toHaveBeenCalled();
  });

  it('counts an accent slip on the lenient rung but says so', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', options: null }));
    h.answer.mockResolvedValueOnce(result({
      result: 'accent', counted: true, nearMiss: true, correctAnswer: 'tengo', levelKindAfter: 'typed-strict',
    }));
    await userEvent.type(screen.getByLabelText('Your answer'), 'tengo{Enter}');
    expect(await screen.findByText(/Correct, but watch the accent:/)).toBeInTheDocument();
    expect(screen.getByText('Next time, the accents count.')).toBeInTheDocument();
  });

  it('shows a "me gusta" prompt with who and the thing liked, and an impersonal one by tense', async () => {
    renderRunner();
    await startWith(prompt({
      entryLabel: 'gustarle', personLabel: 'a mí', cue: 'los perros', options: ['me gustan', 'me gusta', 'te gustan', 'le gustan'],
    }));
    expect(screen.getByText('a mí')).toBeInTheDocument();
    expect(screen.getByText('(gustarle)')).toBeInTheDocument();
    expect(screen.getByText('+ los perros')).toBeInTheDocument();

    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'me gustan',
      next: prompt({ index: 1, itemKey: 'k1', entryLabel: 'haber (hay)', personLabel: null, tenseLabel: 'pretérito', options: ['hubo', 'hay', 'había', 'habrá'] }),
    }));
    await userEvent.click(screen.getByRole('button', { name: /me gustan/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getByText('haber (hay)')).toBeInTheDocument();
    expect(screen.getByText('pretérito')).toBeInTheDocument();
  });

  it('identifies a form: marks every option that fits it', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', entryLabel: null, personLabel: null, form: 'fue',
      options: ['ser · él / ella / usted', 'ir · él / ella / usted', 'ser · yo', 'tener · él / ella / usted'],
    }));
    expect(screen.getByText('fue')).toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'ser · él / ella / usted · presente',
      alsoCorrect: ['ir · él / ella / usted · presente'],
    }));
    await userEvent.keyboard('2');
    await screen.findByText(/Correct!/);
    expect(screen.getByText(/Also correct:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ser · él/ }).className).toMatch(/green/);
    expect(screen.getByRole('button', { name: /ir · él/ }).className).toMatch(/green/);
    expect(screen.getByRole('button', { name: /ser · yo/ }).className).not.toMatch(/green|red/);
  });

  it('names one subject, with what usted and ustedes mean at multiple choice only (v1.24.0)', async () => {
    renderRunner();
    await startWith(prompt({ personLabel: 'ustedes', options: ['tienen', 'tiene', 'tienes', 'tenemos'] }));
    expect(screen.getByText('ustedes')).toBeInTheDocument();
    expect(screen.getByText('you all')).toBeInTheDocument();
    // Read with the card when focus lands on it, outside its name.
    expect(screen.getByRole('group', { name: /^ustedes/ })).toHaveAccessibleDescription('you all');
    expect(screen.queryByText(/ellos \/ ellas/)).not.toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'tienen', rightOptions: ['tienen'], sharedBy: { form: 'tienen', person: 'ellos', subjects: ['ellos', 'ellas', 'ustedes'] },
      next: prompt({ index: 1, itemKey: 'k1', kind: 'typed', level: 'typed-lenient', options: null, personLabel: 'usted' }),
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    // Who shares the form, once, after the answer.
    expect(screen.getByRole('status')).toHaveTextContent('tienen = ellos · ellas · ustedes (they / you all)');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Typed: no gloss.
    expect(await screen.findByText('usted')).toBeInTheDocument();
    expect(screen.queryByText('you (formal)')).not.toBeInTheDocument();
  });

  it('asks which form of a verb when every option is that verb, glossing usted and ustedes under the options (v1.24.0)', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', entryLabel: null, personLabel: null, form: 'tienen', tenseLabel: null, tense: null, askTense: true,
      optionsVerb: 'tener', options: ['ustedes · presente', 'usted · presente', 'ustedes · pretérito', 'nosotros · presente'],
    }));
    // The verb, in a Spanish voice inside the English question.
    const verb = screen.getByText('tener', { selector: 'span' });
    expect(verb).toHaveAttribute('lang', 'es');
    expect(verb.parentElement).toHaveTextContent(/^Which form of tener is this\?$/);
    const ustedes = screen.getByRole('button', { name: /^ustedes · presente/ });
    expect(ustedes).toHaveTextContent('ustedes · presenteyou all');
    expect(screen.getByRole('button', { name: /^usted · presente/ })).toHaveTextContent('usted · presenteyou (formal)');
    expect(screen.getByRole('button', { name: /^nosotros · presente/ })).toHaveTextContent(/^4nosotros · presente$/);
    h.answer.mockResolvedValueOnce(result({
      result: 'wrong', counted: false, correctAnswer: 'tener · ustedes · presente', rightOptions: ['ustedes · presente'],
      mistake: { kind: 'person', detail: { person: 'el' }, guideSection: null, guideSections: [] },
    }));
    await userEvent.keyboard('2');
    await screen.findByText(/Not quite/);
    expect(ustedes.className).toMatch(/green/);
    expect(screen.getByRole('button', { name: /^usted · presente/ }).className).toMatch(/red/);
  });

  it('lists every person who shares a form, with what they mean together (tenía = yo · él · ella · usted)', async () => {
    renderRunner();
    await startWith(prompt({ entryLabel: 'tener', personLabel: 'yo', personId: 'yo', tense: 'imperfect', tenseLabel: 'imperfecto', options: ['tenía', 'tenías', 'teníamos', 'tenían'] }));
    // yo needs no gloss, so the card has no description.
    expect(screen.getByRole('group', { name: /^yo/ })).not.toHaveAttribute('aria-describedby');
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'tenía', rightOptions: ['tenía'],
      sharedBy: { form: 'tenía', person: 'yo', persons: ['yo', 'el'], subjects: ['yo', 'él', 'ella', 'usted'] },
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    expect(screen.getByRole('status')).toHaveTextContent('tenía = yo · él · ella · usted (I / he / she / you, formal)');
  });

  it('gives tú and vos one meaning when they share a form', async () => {
    renderRunner();
    await startWith(prompt({ entryLabel: 'tener', personLabel: 'vos', personId: 'vos', tense: 'preterite', tenseLabel: 'pretérito', options: ['tuviste', 'tuvo', 'tuvimos', 'tuvieron'] }));
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'tuviste', rightOptions: ['tuviste'],
      sharedBy: { form: 'tuviste', person: 'vos', persons: ['tu', 'vos'], subjects: ['tú', 'vos'] },
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    expect(screen.getByRole('status')).toHaveTextContent('tuviste = tú · vos (you)');
  });

  it('says a plural subject needs its -n form, from the subject shown (v1.24.0)', async () => {
    renderRunner();
    await startWith(prompt({ entryLabel: 'vivir', personLabel: 'ellas', personId: 'ellos', options: ['vive', 'viven', 'vivimos', 'vives'] }));
    h.answer.mockResolvedValueOnce(result({
      result: 'wrong', counted: false, correctAnswer: 'viven', rightOptions: ['viven'],
      mistake: { kind: 'person', detail: { person: 'el' }, guideSection: null, guideSections: [] },
      sharedBy: { form: 'viven', person: 'ellos', subjects: ['ellos', 'ellas', 'ustedes'] },
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Not quite/);
    expect(screen.getByText('Ellas is plural, so the verb needs its -n form.')).toBeInTheDocument();
  });

  it('fits the accent keys on a 375 px phone: 38 px keys, 5 px apart', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', options: null }));
    const keys = screen.getByRole('group', { name: 'Caracteres especiales' }).parentElement as HTMLElement;
    expect(keys.className).toContain('[&_button.ck]:min-w-[38px]');
    expect(keys.className).toContain('[&_.vocab-charkeys]:gap-[5px]');
    expect(keys.className).not.toContain('min-w-10');
  });

  it('shows the item\'s own reading, not the student\'s, when they gave another right one', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', kind: 'typed', level: 'typed-lenient', options: null, entryLabel: null, personLabel: null,
      tense: 'imperfect', tenseLabel: 'imperfecto', form: 'tenía', askTense: false, askPerson: true,
      personOptions: [{ id: 'yo', label: 'yo' }, { id: 'el', label: 'él / ella / usted' }],
    }));
    await userEvent.type(screen.getByLabelText('The verb, in its dictionary form (infinitive)'), 'Tener');
    await userEvent.click(screen.getByRole('radio', { name: 'él / ella / usted' }));
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'tener · yo · imperfecto', alsoCorrect: ['tener · él / ella / usted · imperfecto'],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText(/Correct!/);
    expect(screen.getByText('tener · yo · imperfecto')).toBeInTheDocument();
    expect(screen.queryByText('tener · él / ella / usted · imperfecto')).not.toBeInTheDocument();
  });

  it('does not list the student\'s own reading as "also correct" after a counted accent slip', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', kind: 'typed', level: 'typed-lenient', options: null, entryLabel: null, personLabel: null,
      tense: 'imperfect', tenseLabel: 'imperfecto', form: 'reía', askTense: false, askPerson: true,
      personOptions: [{ id: 'yo', label: 'yo' }, { id: 'el', label: 'él / ella / usted' }],
    }));
    await userEvent.type(screen.getByLabelText('The verb, in its dictionary form (infinitive)'), 'reir');
    await userEvent.click(screen.getByRole('radio', { name: 'él / ella / usted' }));
    h.answer.mockResolvedValueOnce(result({
      result: 'accent', counted: true, nearMiss: true,
      correctAnswer: 'reír · yo · imperfecto', alsoCorrect: ['reír · él / ella / usted · imperfecto', 'reír · ellos / ellas / ustedes · imperfecto'],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Correct, but watch the accent:/)).toBeInTheDocument();
    expect(screen.getByText('reír · ellos / ellas / ustedes · imperfecto')).toBeInTheDocument();
    expect(screen.queryByText(/reír · él \/ ella \/ usted/)).not.toBeInTheDocument();
  });

  it('knows the student\'s reading of a command, where "usted" is the chip "él / ella / usted"', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', kind: 'typed', level: 'typed-lenient', options: null, entryLabel: null, personLabel: null,
      tense: null, tenseLabel: null, form: 'hable', askTense: true, askPerson: true,
      personOptions: [{ id: 'yo', label: 'yo' }, { id: 'el', label: 'él / ella / usted' }],
      tenseOptions: [
        { id: 'imperativeAffirmative', label: 'imperativo afirmativo' },
        { id: 'presentSubjunctive', label: 'presente de subjuntivo' },
      ],
    }));
    await userEvent.type(screen.getByLabelText('The verb, in its dictionary form (infinitive)'), 'hablar');
    await userEvent.click(screen.getByRole('radio', { name: 'él / ella / usted' }));
    await userEvent.click(screen.getByRole('radio', { name: 'imperativo afirmativo' }));
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'hablar · yo · presente de subjuntivo',
      alsoCorrect: ['hablar · él / ella / usted · presente de subjuntivo', 'hablar · usted · imperativo afirmativo'],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText(/Correct!/);
    expect(screen.getByText('hablar · yo · presente de subjuntivo; hablar · él / ella / usted · presente de subjuntivo')).toBeInTheDocument();
    expect(screen.queryByText(/usted · imperativo afirmativo/)).not.toBeInTheDocument();
  });

  it('marks the other reading "also correct" when a choice picks another one of a "me gusta" verb', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', entryLabel: null, personLabel: null, form: 'le gusta', tenseLabel: 'presente',
      options: ['gustarle · a él / a ella / a usted', 'gustarle · a ellos / a ellas / a ustedes', 'gustarle · a mí', 'gustarle · a ti'],
    }));
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'gustarle · a ellos / a ellas / a ustedes · presente',
      alsoCorrect: ['gustarle · a él / a ella / a usted · presente'],
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    expect(screen.getByText('gustarle · a ellos / a ellas / a ustedes · presente')).toBeInTheDocument();
    expect(screen.queryByText('gustarle · a él / a ella / a usted · presente')).not.toBeInTheDocument();
  });

  it('says typing and accents both start next time when the ladder skips the lenient rung', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result({ levelKindAfter: 'typed-strict' }));
    await userEvent.keyboard('1');
    expect(await screen.findByText('Next time, you type it, and the accents count.')).toBeInTheDocument();
    expect(screen.queryByText('Next time, the accents count.')).not.toBeInTheDocument();
  });

  it('identifies a form by typing the verb and picking who and when', async () => {
    renderRunner();
    await startWith(prompt({
      direction: 'fromForm', kind: 'typed', level: 'typed-lenient', options: null, entryLabel: null, personLabel: null,
      tense: null, tenseLabel: null, form: 'tuvimos', askTense: true, askPerson: true,
      personOptions: [{ id: 'yo', label: 'yo' }, { id: 'nosotros', label: 'nosotros' }],
      tenseOptions: [{ id: 'present', label: 'presente' }, { id: 'preterite', label: 'pretérito' }],
    }));
    const verb = screen.getByLabelText('The verb, in its dictionary form (infinitive)');
    await userEvent.type(verb, 'tener{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick who.');
    await userEvent.click(screen.getByRole('radio', { name: 'nosotros' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick the tense.');
    await userEvent.click(screen.getByRole('radio', { name: 'pretérito' }));

    h.answer.mockResolvedValueOnce(result({ result: 'wrong', counted: false, correctAnswer: 'tener · yo · pretérito' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(h.answer).toHaveBeenCalledWith(sent(9, 0, { text: 'tener', person: 'nosotros', tense: 'preterite' }));
    expect(await screen.findByText('tener · yo · pretérito')).toBeInTheDocument();
    // What the student gave, as they gave it.
    expect(screen.getByText('tener · nosotros · pretérito')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'nosotros' })).toBeDisabled();
  });

  it('offers a new round when the round expired', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockRejectedValueOnce(trpcError('BAD_REQUEST', 'ROUND_EXPIRED'));
    await userEvent.keyboard('1');
    expect(await screen.findByRole('alert')).toHaveTextContent('This round expired. Start a new round.');

    h.start.mockResolvedValueOnce({ roundId: 10, deckName: 'Unidad 1', total: 3, review: false, levels: [], prompt: prompt({ itemKey: 'n0' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Start a new round' }));
    expect(h.start).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    expect(h.answer).toHaveBeenLastCalledWith(sent(10, 0, { choice: 'tengo' }));
  });

  it('after a network failure sends the same answer again, for the same prompt', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', options: null }));
    h.answer.mockRejectedValueOnce(new Error('Failed to fetch'));
    const input = screen.getByLabelText('Your answer');
    await userEvent.type(input, 'tengo{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send your answer.');
    expect(screen.queryByRole('button', { name: 'Start a new round' })).not.toBeInTheDocument();
    // The answer may have arrived: it stays as sent, and Enter sends it again.
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveFocus();
    expect(input).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    await userEvent.type(input, 'x');
    expect(input).toHaveValue('tengo');

    h.answer.mockResolvedValueOnce(result());
    await userEvent.click(retry);
    expect(h.answer).toHaveBeenCalledTimes(2);
    expect(h.answer).toHaveBeenLastCalledWith(sent(9, 0, { text: 'tengo' }));
    // The same answer, with the time it took then: the wait for the retry is not the student's.
    expect(h.answer.mock.calls[1][0].ms).toBe(h.answer.mock.calls[0][0].ms);
    expect(await screen.findByText(/Correct!/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the picked option through a failed send and cannot pick another before it goes again', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { data: { code: 'INTERNAL_SERVER_ERROR' } }));
    await userEvent.keyboard('2');
    await screen.findByRole('button', { name: 'Try again' });
    await userEvent.keyboard('3');
    expect(screen.getByRole('button', { name: /teno/ })).toBeDisabled();
    expect(h.answer).toHaveBeenCalledTimes(1);
    h.answer.mockResolvedValueOnce(result({ result: 'wrong', counted: false }));
    await userEvent.keyboard('{Enter}');
    expect(h.answer).toHaveBeenLastCalledWith(sent(9, 0, { choice: 'tiene' }));
    expect(await screen.findByText(/Not quite/)).toBeInTheDocument();
  });

  it('carries on from where the round is when another tab answered first', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockRejectedValueOnce(trpcError('CONFLICT', 'ROUND_OUT_OF_SYNC'));
    h.current.mockResolvedValueOnce(roundAt(prompt({ index: 2, total: 4, itemKey: 'k2', entryLabel: 'ser', options: ['soy', 'es', 'son', 'eres'] }), { roundId: 9 }));
    await userEvent.keyboard('1');
    expect(await screen.findByText('This round moved on in another tab or window. Here is where it is now.')).toBeInTheDocument();
    expect(h.current).toHaveBeenCalledWith({ roundId: 9 });
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    expect(screen.getByText('(ser)')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    expect(h.answer).toHaveBeenLastCalledWith(sent(9, 2, { choice: 'soy' }));
  });

  it('keeps the round when it cannot catch up with another tab, and tries again', async () => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockRejectedValueOnce(trpcError('CONFLICT', 'ROUND_OUT_OF_SYNC'));
    h.current.mockRejectedValueOnce(new Error('Failed to fetch'));
    await userEvent.keyboard('1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your round. Check your connection and try again.');
    expect(screen.queryByText(/moved on in another tab/)).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveFocus();

    h.current.mockResolvedValueOnce(roundAt(prompt({ index: 2, total: 4, itemKey: 'k2', entryLabel: 'ser', options: ['soy', 'es', 'son', 'eres'] }), { roundId: 9 }));
    await userEvent.click(retry);
    expect(h.current).toHaveBeenLastCalledWith({ roundId: 9 });
    expect(await screen.findByText('3 / 4')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('offers to continue a round left open, and picks it up where it was', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    expect(screen.getByText('You have a round in progress: question 5 of 21.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a round' })).not.toBeInTheDocument();
    h.current.mockResolvedValueOnce(roundAt(prompt({ index: 4, total: 21, itemKey: 'k4' })));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(h.current).toHaveBeenCalledWith({ roundId: 7 });
    expect(h.start).not.toHaveBeenCalled();
    expect(await screen.findByText('5 / 21')).toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result({ total: 21 }));
    await userEvent.keyboard('1');
    expect(h.answer).toHaveBeenCalledWith(sent(7, 4, { choice: 'tengo' }));
  });

  it('can start over instead of continuing', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.start.mockResolvedValueOnce({ roundId: 9, deckName: 'Unidad 1', total: 3, review: false, levels: [], prompt: prompt() });
    await userEvent.click(screen.getByRole('button', { name: 'Start a new round' }));
    expect(h.start).toHaveBeenCalledWith({ deckId: 5 });
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('says so when the round left open has expired', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.current.mockRejectedValueOnce(trpcError('BAD_REQUEST', 'ROUND_EXPIRED'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This round expired. Start a new round.');
    expect(screen.queryByRole('button', { name: 'Continue the round' })).not.toBeInTheDocument();
  });

  it('still offers the round left open when loading it fails on the network', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.current.mockRejectedValueOnce(new Error('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your round. Check your connection and try again.');
    // Continue is the retry: no second button for it.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a round' })).not.toBeInTheDocument();

    h.current.mockResolvedValueOnce(roundAt(prompt({ index: 4, total: 21, itemKey: 'k4' })));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(await screen.findByText('5 / 21')).toBeInTheDocument();
    expect(h.current).toHaveBeenCalledTimes(2);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('labels only the button whose call is out, and holds both', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    let started: (v: unknown) => void = () => {};
    h.start.mockReturnValueOnce(new Promise((r) => { started = r; }));
    await userEvent.click(screen.getByRole('button', { name: 'Start a new round' }));
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue the round' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Loading...' })).not.toBeInTheDocument();
    started(roundAt(prompt(), { roundId: 9 }));
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('says "Loading..." on Continue only, while it loads', async () => {
    renderRunner(vi.fn(), { overview: openOverview });
    let loaded: (v: unknown) => void = () => {};
    h.current.mockReturnValueOnce(new Promise((r) => { loaded = r; }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start a new round' })).toBeDisabled();
    loaded(roundAt(prompt({ index: 4, total: 21, itemKey: 'k4' })));
    expect(await screen.findByText('5 / 21')).toBeInTheDocument();
  });

  it('shows the score of a round that was finished in another tab', async () => {
    const onRoundOver = renderRunner(vi.fn(), { overview: openOverview });
    h.current.mockRejectedValueOnce(trpcError('BAD_REQUEST', 'ROUND_FINISHED'));
    h.finish.mockResolvedValueOnce({ roundId: 7, score: 0.5, firstTryCorrect: 10, prompts: 20, answers: 24, abandoned: false, mastered: 3, total: 24 });
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    expect(await screen.findByRole('heading', { name: 'Round complete' })).toBeInTheDocument();
    expect(h.finish).toHaveBeenCalledWith({ roundId: 7 });
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(onRoundOver).toHaveBeenCalledTimes(1);
  });

  const closedCases = [
    { why: 'the quiz was turned off', error: () => trpcError('NOT_FOUND', 'CONJUGATION_OFF'), message: 'This deck has no conjugation practice right now.' },
    { why: 'the student lost access to the deck', error: () => trpcError('FORBIDDEN', 'DECK_ACCESS_DENIED'), message: 'You do not have access to this deck.' },
  ];

  it.each(closedCases)('a new round refused because $why also stops offering the open round', async ({ error, message }) => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.start.mockRejectedValueOnce(error());
    await userEvent.click(screen.getByRole('button', { name: 'Start a new round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Continue the round' })).not.toBeInTheDocument();
  });

  /** Nothing is left to retry or pick up: no Try again, no Continue, no prompt, no new round on offer in the alert. */
  function expectClosed(message: string) {
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(/connection/);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue the round' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a new round' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See results' })).not.toBeInTheDocument();
  }

  it.each(closedCases)('leaves the round when an answer is refused because $why', async ({ error, message }) => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.current.mockResolvedValueOnce(roundAt(prompt({ index: 4, total: 21, itemKey: 'k4', kind: 'typed', level: 'typed-lenient', options: null })));
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    h.answer.mockRejectedValueOnce(error());
    await userEvent.type(await screen.findByLabelText('Your answer'), 'tengo{Enter}');
    await screen.findByRole('alert');
    expectClosed(message);
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
    // The answer is not held to be sent again: Enter does nothing more.
    await userEvent.keyboard('{Enter}');
    expect(h.answer).toHaveBeenCalledTimes(1);
  });

  it.each(closedCases)('does not offer the round left open again when loading it is refused because $why', async ({ error, message }) => {
    renderRunner(vi.fn(), { overview: openOverview });
    h.current.mockRejectedValueOnce(error());
    await userEvent.click(screen.getByRole('button', { name: 'Continue the round' }));
    await screen.findByRole('alert');
    expectClosed(message);
    expect(h.current).toHaveBeenCalledTimes(1);
  });

  it.each(closedCases)('leaves the round when its score is refused because $why', async ({ error, message }) => {
    renderRunner();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({ next: null, finished: true, summary: null, total: 1 }));
    h.finish.mockRejectedValueOnce(error());
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    await screen.findByRole('alert');
    expectClosed(message);
    expect(screen.queryByRole('heading', { name: 'Round complete' })).not.toBeInTheDocument();
    expect(h.finish).toHaveBeenCalledTimes(1);
  });

  it('tells the impersonal verb apart from the plain one of the same name', () => {
    renderRunner(vi.fn(), {
      overview: {
        ...overview,
        verbs: [
          { entry: 'hacer', label: 'hacer', kind: 'plain', mastered: 1, total: 6 },
          { entry: 'hacer-impersonal', label: 'hacer', kind: 'impersonal', mastered: 0, total: 1 },
        ],
      } as unknown as ConjugationOverview,
    });
    const chips = screen.getAllByRole('listitem');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent(/^hacer1\/6$/);
    expect(chips[1]).toHaveTextContent(/^hacerimpersonal0\/1$/);
  });

  it('lists a reading with a person as "also correct" when the prompt asked no person', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', direction: 'fromForm', entryLabel: null, personLabel: null, form: 'hace', options: null }));
    await userEvent.type(screen.getByLabelText('The verb, in its dictionary form (infinitive)'), 'hacer');
    h.answer.mockResolvedValueOnce(result({
      correctAnswer: 'hacer · presente', alsoCorrect: ['hacer · él / ella / usted · presente'], levelAfter: 2, levelKindAfter: 'typed-strict',
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Correct!/)).toBeInTheDocument();
    expect(h.answer).toHaveBeenCalledWith(sent(9, 0, { text: 'hacer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Also correct: hacer · él / ella / usted · presente');
  });

  it('holds "Start a round" while the overview is fetched again', () => {
    renderRunner(vi.fn(), { refreshing: true });
    expect(screen.getByRole('button', { name: 'Start a round' })).toBeDisabled();
  });

  it('names an impersonal verb as such', async () => {
    renderRunner();
    await startWith(prompt({ entryLabel: 'haber', personLabel: null, tenseLabel: 'pretérito', entryHint: 'impersonal', options: ['hubo', 'hay', 'había', 'habrá'] }));
    expect(screen.getByText('haber')).toBeInTheDocument();
    expect(screen.getByText('impersonal')).toBeInTheDocument();
  });

  it('says why a round cannot start', async () => {
    renderRunner();
    h.start.mockRejectedValueOnce(trpcError('BAD_REQUEST', 'CONJUGATION_EMPTY'));
    await userEvent.click(screen.getByRole('button', { name: 'Start a round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This deck has no verbs to practice yet.');
  });

  it('ends with the score and mastery, and starts another round', async () => {
    const onRoundOver = renderRunner();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({
      mastered: true, outcome: 'mastered', masteredNow: true, nextReviewDays: 7, levelAfter: 2, total: 1, next: null, finished: true,
      summary: { roundId: 9, score: 0.8, firstTryCorrect: 16, prompts: 20, answers: 23, abandoned: false, mastered: 30, total: 60 },
    }));
    await userEvent.keyboard('1');
    expect(await screen.findByText('Mastered!')).toBeInTheDocument();
    expect(screen.getByText('It comes back for review in a week.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See results' }));

    expect(screen.getByRole('heading', { name: 'Round complete' })).toHaveFocus();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('16 of 20 right the first time')).toBeInTheDocument();
    expect(screen.getByText('30 / 60 mastered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Study' })).toHaveAttribute('href', '/');
    expect(onRoundOver).toHaveBeenCalledTimes(1);

    h.start.mockResolvedValueOnce({ roundId: 11, deckName: 'Unidad 1', total: 3, review: true, levels: [], prompt: prompt({ itemKey: 'r0' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Another round' }));
    expect(await screen.findByText('You have mastered every item. This round is review.')).toBeInTheDocument();
  });

  it('ends a first perfect round with what is on its way, not a bare "0 / 50 mastered" (v1.16)', async () => {
    renderRunner();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({
      total: 1, next: null, finished: true,
      summary: { roundId: 9, score: 1, firstTryCorrect: 20, prompts: 20, answers: 20, abandoned: false, mastered: 0, almost: 12, climbing: 30, total: 50 },
    }));
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('0 / 50 mastered')).toBeInTheDocument();
    expect(screen.getByText('12 need one more day')).toBeInTheDocument();
    expect(screen.getByText('30 on the way up')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Mastered' }))
      .toHaveAttribute('aria-valuetext', '0 / 50 mastered · 12 need one more day · 30 on the way up');
    expect(screen.getByText('A form is mastered when you get it right at the last step on two different days.')).toBeInTheDocument();
  });

  it('says "1 needs one more day", leaves out counts of none, and reads a summary from before v1.16', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <ConjugationRunner deckId={5} overview={{ ...overview, mastered: 2, almost: 1, climbing: 0 } as ConjugationOverview} />
      </MemoryRouter>,
    );
    expect(screen.getByText('1 needs one more day')).toBeInTheDocument();
    expect(screen.queryByText(/on the way up/)).not.toBeInTheDocument();
    expect(screen.getByText(/A form is mastered when/)).toBeInTheDocument();
    unmount();

    // Nothing started yet, or a response stored before v1.16 (no counts): the bar alone, no help line.
    renderRunner(vi.fn(), { overview: { ...overview, almost: 0, climbing: 0 } as ConjugationOverview });
    expect(screen.getByText('2 / 24 mastered')).toBeInTheDocument();
    expect(screen.queryByText(/one more day|on the way up|A form is mastered when/)).not.toBeInTheDocument();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({
      total: 1, next: null, finished: true,
      summary: { roundId: 9, score: 1, firstTryCorrect: 1, prompts: 1, answers: 1, abandoned: false, mastered: 3, total: 24 },
    }));
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(screen.getByText('3 / 24 mastered')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Mastered' })).toHaveAttribute('aria-valuetext', '3 / 24 mastered');
  });

  it('says "1 on the way up" for one form climbing, on the bar and to a screen reader', () => {
    render(<MasteryBar mastered={4} total={24} climbing={1} />);
    expect(screen.getByText('1 on the way up')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Mastered' })).toHaveAttribute('aria-valuetext', '4 / 24 mastered · 1 on the way up');
    expect(screen.getByText(/A form is mastered when/)).toBeInTheDocument();
  });

  it('asks the server for the score when the last answer did not carry it', async () => {
    renderRunner();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({ next: null, finished: true, summary: null, total: 1 }));
    h.finish.mockResolvedValueOnce({ roundId: 9, score: 1, firstTryCorrect: 1, prompts: 1, answers: 1, abandoned: false, mastered: 1, total: 24 });
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(h.finish).toHaveBeenCalledWith({ roundId: 9 });
    expect(await screen.findByText('100%')).toBeInTheDocument();
  });
});

describe('ConjugationRunner hands each round summary it shows to the page (onRoundFinished)', () => {
  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
    h.finish.mockReset();
    h.current.mockReset();
  });

  const summary = (extra: Record<string, unknown> = {}) => ({
    roundId: 9, score: 1, firstTryCorrect: 5, prompts: 5, answers: 5, abandoned: false, mastered: 0, almost: 0, climbing: 5, total: 24, ...extra,
  });

  function renderWithPage() {
    const onRoundFinished = vi.fn();
    render(
      <MemoryRouter>
        <ConjugationRunner deckId={5} overview={overview} onRoundFinished={onRoundFinished} />
      </MemoryRouter>,
    );
    return onRoundFinished;
  }

  async function finishRound(done: Record<string, unknown>) {
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({ total: 1, next: null, finished: true, summary: done }));
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(screen.getByRole('heading', { name: 'Round complete' })).toHaveFocus();
  }

  it('passes the summary as the server gave it, with the deck\'s id, once, and shows only core\'s results', async () => {
    const onRoundFinished = renderWithPage();
    const done = summary({ fromAnExtension: { anything: true } });
    await finishRound(done);
    expect(onRoundFinished).toHaveBeenCalledTimes(1);
    expect(onRoundFinished).toHaveBeenCalledWith(done, 5);
    // Nothing on the summary but core's: no extension in this build.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('passes every summary it shows: each round played to its end, one after another', async () => {
    const onRoundFinished = renderWithPage();
    await finishRound(summary());
    h.start.mockResolvedValueOnce({ roundId: 11, deckName: 'Unidad 1', total: 1, review: false, levels: [], prompt: prompt({ total: 1 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Another round' }));
    h.answer.mockResolvedValueOnce(result({ total: 1, next: null, finished: true, summary: summary({ roundId: 11 }) }));
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(await screen.findByRole('heading', { name: 'Round complete' })).toBeInTheDocument();
    expect(onRoundFinished.mock.calls.map(([done, deckId]) => [(done as { roundId: number }).roundId, deckId])).toEqual([[9, 5], [11, 5]]);
  });

  it('passes a summary the server gave when the last answer did not carry one', async () => {
    const onRoundFinished = renderWithPage();
    await startWith(prompt({ total: 1 }));
    h.answer.mockResolvedValueOnce(result({ next: null, finished: true, summary: null, total: 1 }));
    const done = summary();
    h.finish.mockResolvedValueOnce(done);
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(await screen.findByRole('heading', { name: 'Round complete' })).toBeInTheDocument();
    expect(onRoundFinished).toHaveBeenCalledTimes(1);
    expect(onRoundFinished).toHaveBeenCalledWith(done, 5);
  });
});

describe('ConjugationRunner and the guide', () => {
  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
    h.finish.mockReset();
    h.current.mockReset();
  });

  function renderWithGuide(props: { paused?: boolean; guideAsked?: number; openSections?: ReadonlySet<string> } = {}) {
    const onOpenGuide = vi.fn();
    const onRung = vi.fn();
    const onWaiting = vi.fn();
    const ui = (asked = props.guideAsked ?? 0) => (
      <MemoryRouter>
        <ConjugationRunner
          deckId={5}
          overview={overview}
          guideCard={<p>The guide’s card</p>}
          onOpenGuide={onOpenGuide}
          paused={props.paused}
          onRung={onRung}
          onWaiting={onWaiting}
          guideAsked={asked}
          openSections={props.openSections}
        />
      </MemoryRouter>
    );
    const view = render(ui());
    return { onOpenGuide, onRung, onWaiting, view, askAgain: (asked: number) => view.rerender(ui(asked)) };
  }

  /** Answers the waiting multiple-choice prompt with its first option. */
  async function answerFirst(extra: Record<string, unknown> = {}) {
    h.answer.mockResolvedValueOnce(result(extra));
    await userEvent.keyboard('1');
    await screen.findByRole('button', { name: 'Next' });
  }

  it('shows the guide’s card between rounds', () => {
    renderWithGuide();
    expect(screen.getByText('The guide’s card')).toBeInTheDocument();
  });

  it('opens the guide on the prompt’s tense once it is answered, from the round’s Guide button and from the tense itself', async () => {
    const { onOpenGuide } = renderWithGuide();
    await startWith(prompt({ tense: 'preterite', tenseLabel: 'pretérito' }));
    expect(screen.queryByText('The guide’s card')).not.toBeInTheDocument();
    // Waiting for its answer: the tense is only a label, and the Guide button is held.
    expect(screen.queryByRole('button', { name: /pretérito/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guide' })).toHaveAttribute('aria-disabled', 'true');
    await answerFirst();
    expect(screen.getByRole('button', { name: 'Guide' })).not.toHaveAttribute('aria-disabled');
    await userEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ chapter: 'preterite' });
    await userEvent.click(screen.getByRole('button', { name: /pretérito/ }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ chapter: 'preterite' });
  });

  it('holds the guide while a round is starting, before its first question shows', async () => {
    const { onWaiting } = renderWithGuide();
    let resolve: (v: unknown) => void = () => {};
    h.start.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await userEvent.click(screen.getByRole('button', { name: 'Start a round' }));
    expect(onWaiting).toHaveBeenLastCalledWith(true);
    resolve({ roundId: 9, deckName: 'Unidad 1', total: 3, review: false, levels: [], prompt: prompt() });
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(onWaiting).toHaveBeenLastCalledWith(true);
  });

  it('says the guide opens after the answer when it is asked for mid-question', async () => {
    const { onWaiting, askAgain } = renderWithGuide();
    expect(onWaiting).toHaveBeenLastCalledWith(false);
    await startWith(prompt());
    expect(onWaiting).toHaveBeenLastCalledWith(true);
    // The page counts a request it holds back; the runner says why.
    askAgain(1);
    expect(screen.getByText('You can open the guide once you answer this question.').closest('[aria-live]')).toBeInTheDocument();
    await answerFirst();
    expect(onWaiting).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('You can open the guide once you answer this question.')).not.toBeInTheDocument();
  });

  it('opens the chapter on commands from a command prompt', async () => {
    const { onOpenGuide } = renderWithGuide();
    await startWith(prompt({ tense: 'imperativeNegative', tenseLabel: 'imperativo negativo' }));
    await answerFirst();
    await userEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ chapter: 'commands' });
  });

  it('opens the chapter on hay from the impersonal tag', async () => {
    const { onOpenGuide } = renderWithGuide();
    await startWith(prompt({ entryLabel: 'haber', entryHint: 'impersonal', personLabel: null, options: ['hay', 'ha', 'han', 'había'] }));
    expect(screen.queryByRole('button', { name: /impersonal/ })).not.toBeInTheDocument();
    await answerFirst({ correctAnswer: 'hay' });
    await userEvent.click(screen.getByRole('button', { name: /impersonal/ }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ chapter: 'impersonal' });
    await userEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ chapter: 'impersonal' });
  });

  it('does not name the tense when a "name the verb" prompt asks it', async () => {
    const { onOpenGuide } = renderWithGuide();
    await startWith(prompt({ direction: 'fromForm', form: 'tuve', tense: null, tenseLabel: null, askTense: true, entryLabel: null, personLabel: null, options: ['tener · yo · pretérito', 'tener · él / ella / usted · pretérito', 'estar · yo · pretérito', 'tener · yo · presente'] }));
    await answerFirst({ correctAnswer: 'tener · yo · pretérito' });
    await userEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith(undefined);
  });

  it('leaves Enter to the guide while it is open over a verdict', async () => {
    let paused = false;
    const ui = () => (
      <MemoryRouter>
        <ConjugationRunner deckId={5} overview={overview} onOpenGuide={vi.fn()} paused={paused} />
      </MemoryRouter>
    );
    const view = render(ui());
    await startWith(prompt());
    await answerFirst();
    paused = true;
    view.rerender(ui());
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    // Something else had focus while the guide was open; closing it gives Next the focus back.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    paused = false;
    view.rerender(ui());
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('never takes a key pressed inside a dialog as an answer', async () => {
    renderWithGuide();
    await startWith(prompt());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    fireEvent.keyDown(inside, { key: '2' });
    expect(h.answer).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('reports the rung answered at and the one climbed to, and points to what changes', async () => {
    const { onRung, onOpenGuide } = renderWithGuide();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    expect(await screen.findByText(/Next time, you type it\./)).toBeInTheDocument();
    expect(onRung).toHaveBeenCalledWith('choice');
    expect(onRung).toHaveBeenCalledWith('typed-lenient');
    // Enter still moves on: the link does not take the focus from Next.
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'What changes? See the guide.' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ section: 'quiz-typing' });
  });

  it('points to the part on accents when they start to count', async () => {
    const { onOpenGuide } = renderWithGuide();
    await startWith(prompt({ kind: 'typed', level: 'typed-lenient', options: null }));
    h.answer.mockResolvedValueOnce(result({ levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict' }));
    await userEvent.type(screen.getByLabelText('Your answer'), 'tengo{Enter}');
    expect(await screen.findByText(/Next time, the accents count\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'What changes? See the guide.' }));
    expect(onOpenGuide).toHaveBeenLastCalledWith({ section: 'quiz-accents' });
  });

  it('names the mistake in one line and links the first of its guide sections this deck shows', async () => {
    const { onOpenGuide } = renderWithGuide({ openSections: new Set(['present-yo', 'persons-glance']) });
    await startWith(prompt());
    await answerFirst({
      result: 'wrong', counted: false, requeued: true,
      mistake: {
        kind: 'person', detail: { person: 'el' }, guideSection: 'present-irregular',
        guideSections: ['present-irregular', 'present-yo', 'present-build', 'persons-glance'],
      },
    });
    const verdict = screen.getByRole('status');
    expect(verdict).toHaveTextContent('That’s the él / ella / usted form, not the yo form.');
    // Enter still moves on: the link does not take the focus from Next.
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Why? See the guide.' }));
    // "present-irregular" is not in this deck's guide: the next one that is.
    expect(onOpenGuide).toHaveBeenLastCalledWith({ section: 'present-yo' });
  });

  it('names a mistake without a link when the deck’s guide shows none of its sections', async () => {
    renderWithGuide({ openSections: new Set(['quiz-rounds']) });
    await startWith(prompt({ options: ['tengo', 'teno', 'tiene', 'tenemos'] }));
    await answerFirst({
      result: 'wrong', counted: false,
      mistake: { kind: 'regularized', detail: { change: 'yo' }, guideSection: 'present-yo', guideSections: ['present-yo', 'present-build'] },
    });
    expect(screen.getByRole('status')).toHaveTextContent('This verb’s yo form is irregular, so the regular pattern doesn’t work here.');
    expect(screen.queryByRole('button', { name: 'Why? See the guide.' })).not.toBeInTheDocument();
  });

  it('says nothing more when a mistake cannot be named, or is only an accent', async () => {
    renderWithGuide({ openSections: new Set(['quiz-accents']) });
    await startWith(prompt());
    await answerFirst({
      result: 'wrong', counted: false,
      mistake: { kind: 'unknown', detail: {}, guideSection: null, guideSections: [] },
      next: prompt({ index: 1, itemKey: 'k1', kind: 'typed', level: 'typed-strict', strictAccents: true, options: null }),
    });
    const verdict = screen.getByRole('status');
    expect(verdict.querySelectorAll('p')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Why? See the guide.' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');

    h.answer.mockResolvedValueOnce(result({
      result: 'accent', counted: false, nearMiss: true, correctAnswer: 'tengo',
      mistake: { kind: 'accent', detail: {}, guideSection: 'quiz-accents', guideSections: ['quiz-accents'] },
    }));
    await userEvent.type(screen.getByLabelText('Your answer (accents count)'), 'tengó{Enter}');
    expect(await screen.findByText(/Almost — check the accent:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Why? See the guide.' })).not.toBeInTheDocument();
  });
});

describe('ConjugationRunner: mastery on two days, reviews and response time', () => {
  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
    h.finish.mockReset();
    h.current.mockReset();
  });

  it('says a right answer on the top rung needs another day before it is mastered', async () => {
    renderRunner();
    await startWith(prompt({ kind: 'typed', level: 'typed-strict', strictAccents: true, options: null }));
    h.answer.mockResolvedValueOnce(result({ levelBefore: 2, levelAfter: 2, levelKindAfter: 'typed-strict', outcome: 'pending', masteryPending: true }));
    await userEvent.type(screen.getByLabelText('Your answer (accents count)'), 'tengo{Enter}');
    expect(await screen.findByText('Right on the top rung! Get it right again on another day to master it.')).toBeInTheDocument();
    expect(screen.queryByText('Mastered!')).not.toBeInTheDocument();
    expect(screen.queryByText(/Next time/)).not.toBeInTheDocument();
  });

  it('marks a form back for review from another deck, and says when it comes back', async () => {
    renderRunner();
    await startWith(prompt({ scheduledReview: true, fromDeck: { deckId: 2, deckName: 'Unidad 0' } }));
    expect(screen.getByText('Back for review · Unidad 0')).toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result({
      mastered: true, levelAfter: 2, levelKindAfter: 'typed-strict', outcome: 'reviewed', review: true, nextReviewDays: 21,
      next: prompt({ index: 1, itemKey: 'k1', scheduledReview: true }),
    }));
    await userEvent.keyboard('1');
    expect(await screen.findByText('Still mastered.')).toBeInTheDocument();
    expect(screen.getByText('It comes back for review in 3 weeks.')).toBeInTheDocument();
    expect(screen.queryByText('Mastered!')).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');

    // A review of this deck's own form has no deck named.
    expect(screen.getByText('Back for review')).toBeInTheDocument();
    h.answer.mockResolvedValueOnce(result({
      result: 'wrong', counted: false, mastered: false, levelAfter: 1, levelKindAfter: 'typed-lenient', outcome: 'lapse', review: true, requeued: true,
    }));
    await userEvent.keyboard('2');
    expect(await screen.findByText('No longer mastered: it goes back to practice.')).toBeInTheDocument();
    expect(screen.queryByText(/comes back for review/)).not.toBeInTheDocument();
  });

  it.each([
    [1, 'It comes back for review tomorrow.'],
    [3, 'It comes back for review in 3 days.'],
    [7, 'It comes back for review in a week.'],
    [56, 'It comes back for review in 8 weeks.'],
  ])('says a form mastered now comes back in %i days as "%s"', async (days, text) => {
    renderRunner();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result({ mastered: true, levelAfter: 0, levelKindAfter: 'choice', outcome: 'mastered', masteredNow: true, nextReviewDays: days }));
    await userEvent.keyboard('1');
    expect(await screen.findByText('Mastered!')).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('still says "Mastered!" for an answer taken before v1.13, replayed without the new fields', async () => {
    renderRunner();
    await startWith(prompt());
    const old: Record<string, unknown> = result({ mastered: true, levelAfter: 0, levelKindAfter: 'choice' });
    for (const field of ['mistake', 'outcome', 'masteredNow', 'masteryPending', 'review', 'nextReviewDays', 'finishedSets']) delete old[field];
    h.answer.mockResolvedValueOnce(old);
    await userEvent.keyboard('1');
    expect(await screen.findByText('Mastered!')).toBeInTheDocument();
    expect(screen.queryByText(/comes back for review/)).not.toBeInTheDocument();
  });

  it('shows the forms due before a round', () => {
    const { unmount } = render(
      <MemoryRouter><ConjugationRunner deckId={5} overview={{ ...overview, due: 3 } as ConjugationOverview} /></MemoryRouter>,
    );
    expect(screen.getByText('3 forms due')).toBeInTheDocument();
    expect(screen.getByText(/Mastered forms come back for review/)).toBeInTheDocument();
    unmount();
    render(<MemoryRouter><ConjugationRunner deckId={5} overview={{ ...overview, due: 1 } as ConjugationOverview} /></MemoryRouter>);
    expect(screen.getByText('1 form due')).toBeInTheDocument();
  });

  it('shows no forms due when none are', () => {
    renderRunner(vi.fn(), { overview: { ...overview, due: 0 } as ConjugationOverview });
    expect(screen.queryByText(/forms? due/)).not.toBeInTheDocument();
  });

  it('tells the page which conjugation sets an answer finished', async () => {
    const onSetsFinished = vi.fn();
    render(<MemoryRouter><ConjugationRunner deckId={5} overview={overview} onSetsFinished={onSetsFinished} /></MemoryRouter>);
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    expect(onSetsFinished).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    h.answer.mockResolvedValueOnce(result({ finishedSets: [{ deckId: 5, deckName: 'Unidad 1' }] }));
    await userEvent.keyboard('1');
    await waitFor(() => expect(onSetsFinished).toHaveBeenCalledWith([{ deckId: 5, deckName: 'Unidad 1' }]));
  });

  describe('response time', () => {
    let offset = 0;
    let hidden = false;
    beforeEach(() => {
      offset = 0;
      hidden = false;
      const real = performance.now.bind(performance);
      vi.spyOn(performance, 'now').mockImplementation(() => real() + offset);
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'));
    });
    afterEach(() => vi.restoreAllMocks());

    it('sends the time from when the question showed to when it was answered, and shows no clock', async () => {
      renderRunner();
      await startWith(prompt());
      offset = 4000;
      h.answer.mockResolvedValueOnce(result());
      await userEvent.keyboard('1');
      await screen.findByText(/Correct!/);
      const { ms } = h.answer.mock.calls[0][0] as { ms: number };
      expect(ms).toBeGreaterThanOrEqual(4000);
      expect(ms).toBeLessThan(9000);
      expect(screen.queryByText(/\d\s?s\b|seconds?/)).not.toBeInTheDocument();
    });

    it('starts again with each question', async () => {
      renderRunner();
      await startWith(prompt());
      offset = 30_000;
      h.answer.mockResolvedValueOnce(result());
      await userEvent.keyboard('1');
      await userEvent.keyboard('{Enter}');
      h.answer.mockResolvedValueOnce(result());
      await userEvent.keyboard('1');
      await screen.findByText(/Correct!/);
      expect((h.answer.mock.calls[1][0] as { ms: number }).ms).toBeLessThan(5000);
    });

    it('leaves out the time the page was hidden', async () => {
      renderRunner();
      await startWith(prompt());
      hidden = true;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      offset = 60_000;
      hidden = false;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      h.answer.mockResolvedValueOnce(result());
      await userEvent.keyboard('1');
      await screen.findByText(/Correct!/);
      expect((h.answer.mock.calls[0][0] as { ms: number }).ms).toBeLessThan(5000);
    });
  });
});

describe('ConjugationRunner: "Study all" (v1.18.0)', () => {
  beforeEach(() => {
    h.start.mockReset();
    h.startAll.mockReset();
    h.answer.mockReset();
    h.finish.mockReset();
    h.current.mockReset();
  });

  const allOverview = {
    scope: 'all',
    deckId: 14,
    deckName: 'Unit 3',
    roundLength: 20,
    decks: [
      { deckId: 14, deckName: 'Unit 3', mastered: 0, almost: 0, climbing: 4, total: 50, due: 0 },
      { deckId: 13, deckName: 'Unit 1', mastered: 30, almost: 2, climbing: 10, total: 102, due: 3 },
    ],
    mastered: 30, almost: 2, climbing: 14, total: 152, due: 3,
    tenses: [{ id: 'present', label: 'presente' }],
    includeVosotros: false, vos: 'none', directions: 'both', accentMode: 'progressive',
    levels: ['choice', 'typed-lenient', 'typed-strict'], reachedRungs: ['choice'],
    verbs: [],
    rounds: 0, lastScore: null, bestScore: null, lastPlayed: null,
    openRound: null,
  } as unknown as StudyAllOverview;

  function renderAll(over: Record<string, unknown> = {}, onRoundFinished = vi.fn()) {
    const result = render(
      <MemoryRouter>
        <ConjugationRunner scope="all" overview={{ ...allOverview, ...over } as StudyAllOverview} onRoundFinished={onRoundFinished} />
      </MemoryRouter>,
    );
    return { onRoundFinished, unmount: result.unmount };
  }

  it('shows every quiz, newest first, with its mastery and forms due', () => {
    renderAll();
    expect(screen.getByText(/forms due for review first, then forms you are learning, then new ones/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)).toEqual(['Unit 3 conjugation', 'Unit 1 conjugation']);
    expect(screen.getAllByRole('progressbar', { name: 'Mastered' }).map((el) => el.getAttribute('aria-valuenow'))).toEqual(['0', '30']);
    expect(screen.getAllByText('3 forms due')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Start a round' })).toBeEnabled();
  });

  it('says when there is no quiz to play', () => {
    renderAll({ decks: [], deckId: null, total: 0 });
    expect(screen.getByText('You have no conjugation practice right now.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a round' })).not.toBeInTheDocument();
  });

  it('starts a Study all round, names each question’s quiz, and lists every quiz in the summary', async () => {
    const { onRoundFinished } = renderAll();
    const first = prompt({ total: 1, fromDeck: { deckId: 13, deckName: 'Unit 1' }, scheduledReview: true });
    h.startAll.mockResolvedValueOnce({ roundId: 9, scope: 'all', deckId: 14, deckName: 'Unit 3', total: 1, review: false, levels: [], prompt: first });
    await userEvent.click(screen.getByRole('button', { name: 'Start a round' }));
    expect(h.startAll).toHaveBeenCalledTimes(1);
    expect(h.start).not.toHaveBeenCalled();
    // The quiz it counts in, and that it is back for review (not "Back for review · Unit 1" as in a deck's round).
    expect(screen.getByText('Unit 1 conjugation')).toBeInTheDocument();
    expect(screen.getByText('Back for review')).toBeInTheDocument();

    h.answer.mockResolvedValueOnce(result({
      total: 1, next: null, finished: true,
      summary: {
        roundId: 9, scope: 'all', score: 1, firstTryCorrect: 1, prompts: 1, answers: 1, abandoned: false,
        mastered: 31, almost: 0, climbing: 14, total: 152,
        decks: [{ deckId: 13, deckName: 'Unit 1', mastered: 31, almost: 0, climbing: 10, total: 102 }],
      },
    }));
    await userEvent.keyboard('1');
    await userEvent.click(await screen.findByRole('button', { name: 'See results' }));
    expect(await screen.findByRole('heading', { name: 'Round complete' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Unit 1 conjugation' })).toBeInTheDocument();
    expect(screen.getByText('31 / 102 mastered')).toBeInTheDocument();
    expect(screen.queryByText('You have mastered every item in this deck!')).not.toBeInTheDocument();
    // The page hears of the summary, with the round's lead deck.
    expect(onRoundFinished).toHaveBeenCalledTimes(1);
    expect(onRoundFinished).toHaveBeenCalledWith(expect.objectContaining({ roundId: 9, scope: 'all' }), 14);

    // Another round is another Study all round.
    h.startAll.mockResolvedValueOnce({
      roundId: 10, scope: 'all', deckId: 14, deckName: 'Unit 3', total: 1, review: false, levels: [],
      prompt: prompt({ itemKey: 'k9', fromDeck: { deckId: 14, deckName: 'Unit 3' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Another round' }));
    expect(h.startAll).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Unit 3 conjugation')).toBeInTheDocument();
    expect(screen.queryByText('Back for review')).not.toBeInTheDocument();
  });

  it('says there is nothing to practice when no quiz is left to play', async () => {
    renderAll();
    h.startAll.mockRejectedValueOnce(trpcError('NOT_FOUND', 'CONJUGATION_NONE'));
    await userEvent.click(screen.getByRole('button', { name: 'Start a round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have no conjugation practice right now.');
  });

  it('shows the page’s way to Study all between rounds of a deck', () => {
    render(
      <MemoryRouter>
        <ConjugationRunner deckId={5} overview={overview} between={<a href="/conjugation/all">Study all conjugation</a>} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Study all conjugation' })).toBeInTheDocument();
  });
});

describe('sentences with a blank (v1.25.0)', () => {
  const sentence = (overrides: Record<string, unknown> = {}) => ({
    before: 'Mis primos', after: 'en Lima.', cue: 'vivir', hint: 'ellos' as string | null,
    glosses: [{ es: 'mis', en: 'my' }, { es: 'primos', en: 'cousin' }],
    ...overrides,
  });
  const sentencePrompt = (overrides: Record<string, unknown> = {}) => ({
    ...prompt({ entryLabel: 'vivir', personLabel: null, personId: null, options: ['vive', 'viven', 'vivimos', 'vives'] }),
    sentence: sentence(),
    ...overrides,
  }) as unknown as Prompt;
  const feedback = {
    filled: 'Mis primos viven en Lima.', english: 'My cousins live in Lima.',
    subject: { es: 'mis primos', pronoun: 'ellos', person: 'ellos', kind: 'np_pl', form: 'viven' },
  };

  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
    h.report.mockReset();
  });

  function renderWith(props: Record<string, unknown> = {}) {
    render(
      <MemoryRouter>
        <ConjugationRunner deckId={5} overview={overview} {...props} />
      </MemoryRouter>,
    );
  }

  it('shows the sentence with its blank and, at multiple choice, the pronoun hint; the blank is read as "blank"', async () => {
    renderWith();
    await startWith(sentencePrompt());
    expect(screen.getByText('Pick the verb that fills the blank.')).toBeInTheDocument();
    const card = screen.getByRole('group', { name: 'Mis primos (ellos) blank (vivir) en Lima.' });
    expect(card).toBeInTheDocument();
    const line = card.querySelector('#conj-prompt-0') as HTMLElement;
    expect(line).toHaveAttribute('lang', 'es');
    expect(line).toHaveTextContent('Mis primos (ellos) blank______ (vivir) en Lima.');
    expect(line.querySelector('[aria-hidden="true"]')).toHaveTextContent('______');
    // No person label of its own.
    expect(screen.queryByText('(vivir)', { selector: 'span.text-gray-600.font-semibold' })).not.toBeInTheDocument();
  });

  it('fills the blank in as the student types, while the box keeps one name; no hint once typed', async () => {
    renderWith();
    await startWith(sentencePrompt({ kind: 'typed', level: 'typed-lenient', options: null, sentence: sentence({ hint: null }) }));
    expect(screen.getByText('Type the verb that fills the blank.')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Your answer Mis primos blank (vivir) en Lima.' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'viven');
    const line = screen.getByRole('group', { name: 'Mis primos blank (vivir) en Lima.' }).querySelector('#conj-prompt-0') as HTMLElement;
    expect(line.querySelector('[aria-hidden="true"]')).toHaveTextContent('viven');
    // The name is the same with every key.
    expect(screen.getByRole('textbox', { name: 'Your answer Mis primos blank (vivir) en Lima.' })).toBe(box);
    expect(screen.queryByText('(ellos)')).not.toBeInTheDocument();
  });

  it('shows only the blank’s part of a typed answer that repeats the sentence', async () => {
    renderWith();
    await startWith(sentencePrompt({ kind: 'typed', level: 'typed-lenient', options: null, sentence: sentence({ hint: null }) }));
    const box = screen.getByRole('textbox', { name: 'Your answer Mis primos blank (vivir) en Lima.' });
    await userEvent.type(box, 'Mis primos viven en Lima.');
    const line = screen.getByRole('group', { name: 'Mis primos blank (vivir) en Lima.' }).querySelector('#conj-prompt-0') as HTMLElement;
    expect(line.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^viven$/);
    // The box keeps what was typed: the server trims and grades it.
    expect(box).toHaveValue('Mis primos viven en Lima.');
  });

  it('blankFill trims the echoed sentence, accents and case aside, and never empties the blank', () => {
    const s = { before: 'Mi prima', after: 'Ana.' };
    expect(blankFill('mi prima se llama Ana', s)).toBe('se llama');
    expect(blankFill('Mí prima se llama', s)).toBe('se llama');
    expect(blankFill('se llama ana.', s)).toBe('se llama');
    expect(blankFill('se llama', s)).toBe('se llama');
    expect(blankFill('mi prima', s)).toBe('mi prima');
    expect(blankFill('Mi prima Ana', s)).toBe('Ana');
    expect(blankFill('A ustedes también les gusta Lima.', { before: 'A ustedes también', after: 'Lima.' })).toBe('les gusta');
    expect(blankFill('  viven ', { before: 'Mis primos', after: 'en Lima.' })).toBe('viven');
  });

  it('opens Word help with the meanings from the deck\'s cards, one button for them all', async () => {
    renderWith();
    await startWith(sentencePrompt());
    const help = screen.getByRole('button', { name: 'Word help' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('cousin')).not.toBeVisible();
    await userEvent.click(help);
    expect(screen.getByRole('button', { name: 'Hide word help' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('cousin')).toBeVisible();
    expect(screen.getByText('primos')).toHaveAttribute('lang', 'es');
  });

  it('shows the sentence filled in, its English and who the subject is after the answer, words the mistake by it, and lets the student report it', async () => {
    const onSentence = vi.fn();
    const onOpenGuide = vi.fn();
    renderWith({ onSentence, onOpenGuide, openSections: new Set(['persons-who-subject', 'persons-glance']) });
    await startWith(sentencePrompt());
    h.answer.mockResolvedValueOnce(result({
      result: 'wrong', counted: false, correctAnswer: 'viven', rightOptions: ['viven'],
      mistake: { kind: 'person', detail: { person: 'el' }, guideSection: 'persons-glance', guideSections: ['persons-glance'] },
      sentence: feedback,
    }));
    await userEvent.keyboard('1');
    await screen.findByText(/Not quite/);
    // The big sentence's blank holds the right form now, not the wrong pick.
    const line = document.querySelector('#conj-prompt-0') as HTMLElement;
    expect(line.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^viven$/);
    expect(line.querySelector('[aria-hidden="true"]')!.className).toMatch(/text-green-800/);
    expect(screen.getByText('Mis primos viven en Lima.')).toHaveAttribute('lang', 'es');
    expect(screen.getByText('My cousins live in Lima.')).toHaveAttribute('lang', 'en');
    expect(screen.getByText(/mis primos = ellos →/)).toBeInTheDocument();
    expect(screen.getByText('Mis primos is plural, so the verb needs its -n form.')).toBeInTheDocument();
    expect(onSentence).toHaveBeenCalledWith(feedback.subject);
    // The mistake is about who: the guide's "Who is the subject?" first.
    await userEvent.click(screen.getByRole('button', { name: 'Why? See the guide.' }));
    expect(onOpenGuide).toHaveBeenCalledWith({ section: 'persons-who-subject' });

    h.report.mockResolvedValueOnce({ reported: true });
    // The live region is there, empty, before the report: one inserted with its text is often not read out.
    const status = within(screen.getByRole('button', { name: 'Something’s wrong with this sentence' }).parentElement!).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'Something’s wrong with this sentence' }));
    expect(h.report).toHaveBeenCalledWith({ roundId: 9, index: 0 });
    expect(await screen.findByText('Thank you. Your teacher will look at this sentence.')).toBe(status);
    // The button is gone: the focus moves on to Next, not to the top of the page.
    expect(screen.queryByRole('button', { name: 'Something’s wrong with this sentence' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Next|See results)$/ })).toHaveFocus();
  });

  it('offers no report for a label prompt', async () => {
    renderWith();
    await startWith(prompt());
    h.answer.mockResolvedValueOnce(result());
    await userEvent.keyboard('1');
    await screen.findByText(/Correct!/);
    expect(screen.queryByRole('button', { name: 'Something’s wrong with this sentence' })).not.toBeInTheDocument();
  });

  it('says when a report could not be sent, and lets the student try again', async () => {
    renderWith();
    await startWith(sentencePrompt());
    h.answer.mockResolvedValueOnce(result({ sentence: feedback }));
    await userEvent.keyboard('2');
    await screen.findByText(/Correct!/);
    h.report.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Something’s wrong with this sentence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send it. Try again.');
    expect(screen.getByRole('button', { name: 'Something’s wrong with this sentence' })).toBeEnabled();
  });
});

describe('the runner’s extension slots, with no extension (the core project)', () => {
  const sentencePrompt = () => ({
    ...prompt({ entryLabel: 'vivir', personLabel: null, personId: null, options: ['vive', 'viven', 'vivimos', 'vives'] }),
    sentence: { before: 'Mis primos', after: 'en Lima.', cue: 'vivir', hint: 'ellos', glosses: [] },
  }) as unknown as Prompt;
  // A field an extension's server hook could add to the answer: core shows none of it.
  const extra = { sampleField: { label: 'Sample note', count: 5 } };

  beforeEach(() => {
    h.start.mockReset();
    h.answer.mockReset();
  });

  it.each([
    ['a label prompt', () => prompt(), {}],
    ['a sentence prompt', sentencePrompt, { correctAnswer: 'viven', sentence: { filled: 'Mis primos viven en Lima.', english: null, subject: null } }],
  ])('renders nothing in the header or the verdict for %s', async (_name, first, fields) => {
    renderRunner();
    await startWith(first());
    const header = screen.getByText('Round').parentElement!;
    expect(header).toHaveTextContent(/^Round$/);
    h.answer.mockResolvedValueOnce(result({ ...fields, ...extra, levelKindAfter: 'choice', levelAfter: 0 }));
    await userEvent.keyboard('2');
    const verdict = (await screen.findByText(/Correct!/)).closest('[role="status"]') as HTMLElement;
    // The headline, then (a sentence) the sentence filled in: nothing from the slot between or after.
    expect(verdict.firstElementChild).toHaveTextContent(/^✓ Correct!$/);
    expect(verdict).not.toHaveTextContent(/Sample note|\b5\b/);
    expect(header).toHaveTextContent(/^Round$/);
    // Kept after Next, the last answer still shows nothing.
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Round').parentElement).toHaveTextContent(/^Round$/);
    expect(document.body).not.toHaveTextContent(/Sample note/);
  });
});
