// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConjugationResults from './ConjugationResults';

// Shared with the mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  result: { data: null as unknown, isLoading: false, error: null as { message: string } | null },
  query: vi.fn(),
}));

// The viewer: Ms. Example (userId 9).
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 9, role: 'admin' } }) }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    conjugation: {
      results: {
        useQuery: (input: unknown) => {
          h.query(input);
          return h.result;
        },
      },
    },
  },
}));

const student = (overrides: Record<string, unknown>) => ({
  userId: 1,
  name: 'Ana',
  email: 'ana@school.test',
  isTeacher: false,
  rounds: 0,
  lastScore: null,
  bestScore: null,
  lastPlayed: null,
  mastered: 0,
  total: 60,
  due: 0,
  daysPractised: 0,
  daysPractised14: 0,
  delayedAnswers: 0,
  delayedAccuracy: null,
  medianTypedMs: null,
  medianChoiceMs: null,
  ...overrides,
});

const results = (overrides: Record<string, unknown> = {}) => ({
  deckId: 7,
  deckName: 'Unidad 1',
  enabled: true,
  total: 60,
  students: [
    student({
      userId: 1, name: 'Ana', rounds: 3, lastScore: 0.75, bestScore: 0.9, lastPlayed: '2026-09-21T15:00:00.000Z', mastered: 12,
      due: 4, daysPractised: 9, daysPractised14: 3, delayedAnswers: 20, delayedAccuracy: 0.85, medianTypedMs: 4230, medianChoiceMs: 2050,
    }),
    student({ userId: 2, name: 'Beto', email: 'beto@school.test' }),
    student({ userId: 9, name: 'Ms. Example', email: 'teacher@school.test', isTeacher: true, rounds: 1, lastScore: 1, bestScore: 1, lastPlayed: '2026-09-22T15:00:00.000Z', mastered: 20 }),
  ],
  mostMissed: [
    {
      itemKey: 'tener|present|yo|-|to', entry: 'tener', entryLabel: 'tener', tense: 'present', tenseLabel: 'presente',
      person: 'yo', personLabel: 'yo', number: null, direction: 'toForm', form: 'tengo', misses: 5, attempts: 12,
    },
    {
      itemKey: 'gustarle|present|yo|pl|from', entry: 'gustarle', entryLabel: 'gustarle', tense: 'present', tenseLabel: 'presente',
      person: 'yo', personLabel: 'a mí', number: 'pl', direction: 'fromForm', form: 'me gustan', misses: 2, attempts: 3,
    },
    {
      itemKey: 'tener|present|ellos|-|to', entry: 'tener', entryLabel: 'tener', tense: 'present', tenseLabel: 'presente',
      person: 'ellos', personLabel: 'ellos/ellas/Uds.', number: null, direction: 'toForm', form: 'tienen', misses: 4, attempts: 10,
      bySubject: [{ subject: 'ustedes', misses: 3, attempts: 4 }, { subject: 'ellos', misses: 1, attempts: 3 }, { subject: 'ellas', misses: 0, attempts: 3 }],
    },
  ],
  topMistakes: [
    {
      key: 'person:el', kind: 'person', detail: { person: 'el' }, count: 34,
      example: { given: 'tiene', itemKey: 'tener|present|yo|-|to', expected: 'tengo', prompt: 'tener · yo · presente' },
    },
    { key: 'regularized:yo', kind: 'regularized', detail: { change: 'yo' }, count: 12, example: null },
  ],
  ...overrides,
});

const rowOf = (name: string) => screen.getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('tr')!;
/** The cell of `row` under the column headed `heading`. */
const cellIn = (row: HTMLElement, heading: string) => {
  const column = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === heading);
  return within(row).getAllByRole(column === 0 ? 'rowheader' : 'cell')[column === 0 ? 0 : column - 1];
};

describe('ConjugationResults', () => {
  beforeEach(() => {
    h.result = { data: results(), isLoading: false, error: null };
    h.query.mockClear();
  });

  it('lists each student’s rounds, scores, mastery and last play', () => {
    render(<ConjugationResults deckId={7} />);
    expect(h.query).toHaveBeenCalledWith({ deckId: 7 });

    const ana = rowOf('Ana');
    expect(ana).toHaveTextContent('ana@school.test');
    expect(cellIn(ana, 'Rounds')).toHaveTextContent(/^3$/);
    expect(cellIn(ana, 'Last score')).toHaveTextContent(/^75%$/);
    expect(cellIn(ana, 'Best score')).toHaveTextContent(/^90%$/);
    expect(cellIn(ana, 'Quiz mastery')).toHaveTextContent(/^12 \/ 604 due$/);
    expect(cellIn(ana, 'Last played')).not.toHaveTextContent('not played');

    const beto = rowOf('Beto');
    expect(cellIn(beto, 'Last score')).toHaveTextContent(/^—$/);
    expect(cellIn(beto, 'Last played')).toHaveTextContent('not played');

    const teacher = rowOf('Ms. Example');
    expect(teacher).toHaveTextContent('your test run');
    expect(teacher).not.toHaveTextContent('teacher@school.test');
    expect(screen.queryByText(/The quiz is off/)).not.toBeInTheDocument();
  });

  it('counts Study all rounds that asked this deck’s forms apart from its own rounds (v1.18.0)', () => {
    render(<ConjugationResults deckId={7} />);
    // None: no note, no legend line.
    expect(cellIn(rowOf('Ana'), 'Rounds')).toHaveTextContent(/^3$/);
    expect(screen.queryByText(/In Study all:/)).not.toBeInTheDocument();
  });

  it('shows Study all rounds under a student’s own rounds, with the legend', () => {
    h.result = {
      data: results({
        students: [student({ userId: 1, name: 'Ana', rounds: 3, studyAllRounds: 2 }), student({ userId: 2, name: 'Beto', email: 'beto@school.test', studyAllRounds: 0 })],
      }),
      isLoading: false,
      error: null,
    };
    render(<ConjugationResults deckId={7} />);
    expect(cellIn(rowOf('Ana'), 'Rounds')).toHaveTextContent(/^3\+2 in Study all$/);
    expect(cellIn(rowOf('Beto'), 'Rounds')).toHaveTextContent(/^0$/);
    expect(screen.getByText(/In Study all: rounds mixing all of the student’s quizzes/)).toBeInTheDocument();
  });

  it('lists the most missed items with how often they were missed', () => {
    render(<ConjugationResults deckId={7} />);

    const items = within(screen.getByRole('list', { name: 'Most missed' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('tengo');
    expect(items[0]).toHaveTextContent('tener · yo · presente');
    expect(items[0]).toHaveTextContent('infinitive → form');
    expect(items[0]).toHaveTextContent('missed 5 of 12');
    expect(items[1]).toHaveTextContent('me gustan');
    expect(items[1]).toHaveTextContent('gustarle · a mí · presente');
    expect(items[1]).toHaveTextContent('form → verb');
    expect(items[1]).not.toHaveTextContent('shown as');
    // v1.24.0: the group short, and the misses by the subject the prompt showed.
    expect(items[2]).toHaveTextContent('tener · ellos/ellas/Uds. · presente');
    expect(items[2]).toHaveTextContent('shown as ustedes missed 3 of 4 · ellos missed 1 of 3 · ellas missed 0 of 3');
    expect(items[2]).not.toHaveTextContent('since the quiz began');
  });

  it('says the split by subject covers only the answers since it began, when older ones recorded none', () => {
    const base = results().mostMissed[2];
    h.result = { data: results({ mostMissed: [{ ...base, misses: 9, attempts: 25 }] }), isLoading: false, error: null };
    render(<ConjugationResults deckId={7} />);
    const [item] = within(screen.getByRole('list', { name: 'Most missed' })).getAllByRole('listitem');
    expect(item).toHaveTextContent('missed 9 of 25');
    expect(item).toHaveTextContent('since the quiz began naming one subject (10 of 25 answers), shown as ustedes missed 3 of 4');
  });

  it('says so when there is nothing yet, and when the quiz is off', () => {
    h.result = { data: results({ enabled: false, students: [], mostMissed: [], topMistakes: [] }), isLoading: false, error: null };
    render(<ConjugationResults deckId={7} />);

    expect(screen.getByText(/The quiz is off/)).toBeInTheDocument();
    expect(screen.getByText(/No students have this deck yet/)).toBeInTheDocument();
    expect(screen.getByText('No misses yet.')).toBeInTheDocument();
    expect(screen.getByText('No named mistakes yet.')).toBeInTheDocument();
  });

  it('shows a load error as an alert', () => {
    h.result = { data: undefined, isLoading: false, error: { message: 'Deck not found' } };
    render(<ConjugationResults deckId={7} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deck not found');
  });

  it('marks only the viewer’s own row as their test run; another teacher’s row says teacher', () => {
    h.result = {
      data: results({
        students: [
          student({ userId: 1, name: 'Ana' }),
          student({ userId: 5, name: 'Mr. Ruiz', email: 'ruiz@school.test', isTeacher: true, rounds: 2 }),
          student({ userId: 9, name: 'Ms. Example', email: 'teacher@school.test', isTeacher: true, rounds: 1 }),
        ],
      }),
      isLoading: false,
      error: null,
    };
    render(<ConjugationResults deckId={7} />);

    const other = rowOf('Mr. Ruiz');
    expect(other).not.toHaveTextContent('your test run');
    expect(within(other).getByText('teacher')).toBeInTheDocument();
    expect(other).toHaveTextContent('ruiz@school.test');

    const mine = rowOf('Ms. Example');
    expect(mine).toHaveTextContent('your test run');
    expect(mine).not.toHaveTextContent('teacher@school.test');
    expect(within(rowOf('Ana')).queryByText('teacher')).not.toBeInTheDocument();
  });

  it('shows the numbers that predict a test: days practised, delayed accuracy and median time', () => {
    render(<ConjugationResults deckId={7} />);

    const ana = rowOf('Ana');
    expect(cellIn(ana, 'Days practised')).toHaveTextContent(/^39 in all$/);
    expect(cellIn(ana, 'Delayed accuracy')).toHaveTextContent(/^85%of 20 answers$/);
    expect(cellIn(ana, 'Median time')).toHaveTextContent(/^4\.2 s typed2\.1 s choice$/);

    // Nothing measured yet: dashes, not zeros that look like results.
    const beto = rowOf('Beto');
    expect(cellIn(beto, 'Delayed accuracy')).toHaveTextContent(/^—$/);
    expect(cellIn(beto, 'Median time')).toHaveTextContent(/^—$/);
    expect(cellIn(beto, 'Quiz mastery')).toHaveTextContent(/^0 \/ 60$/);
    expect(screen.getByText(/Delayed accuracy: answers right on forms the student had not seen for a week or more/)).toBeInTheDocument();
  });

  it('notes answer times that did not match the time that passed, in red, and "Very fast" in amber (v1.16)', () => {
    h.result = {
      data: results({
        veryFastLine: { typedMs: 1000, choiceMs: 600, minTries: 10 },
        students: [
          student({ userId: 1, name: 'Ana', medianChoiceMs: 272, timeMismatches: 6, veryFast: true }),
          student({ userId: 2, name: 'Beto', email: 'beto@school.test', medianTypedMs: 3100, timeMismatches: 1 }),
          student({ userId: 3, name: 'Carla', email: 'carla@school.test', medianTypedMs: 4200, timeMismatches: 0, veryFast: false }),
        ],
      }),
      isLoading: false,
      error: null,
    };
    render(<ConjugationResults deckId={7} />);

    const ana = cellIn(rowOf('Ana'), 'Median time');
    expect(ana).toHaveTextContent(/^0\.3 s choice6 answer times didn’t match the time that passedVery fast$/);
    expect(within(ana).getByText('6 answer times didn’t match the time that passed')).toHaveClass('text-red-700');
    expect(within(ana).getByText('Very fast')).toHaveClass('text-amber-800');
    expect(cellIn(rowOf('Beto'), 'Median time')).toHaveTextContent(/^3\.1 s typed1 answer time didn’t match the time that passed$/);
    expect(cellIn(rowOf('Carla'), 'Median time')).toHaveTextContent(/^4\.2 s typed$/);
    expect(screen.getByText(/never more than the time that passed between answers/)).toBeInTheDocument();
    expect(screen.getByText(/which only an edited request can do/)).toBeInTheDocument();
    expect(screen.getByText('Very fast: a median under 1.0 s typed or 0.6 s multiple choice, over 10 or more first tries.')).toBeInTheDocument();
  });

  it('explains the notes only when a student has one', () => {
    render(<ConjugationResults deckId={7} />);
    expect(screen.queryByText(/didn’t match|Very fast/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Rounds: rounds played to the end\./)).toBeInTheDocument();
  });

  it('lists the class’s commonest mistakes, worded for the teacher, with an example', () => {
    render(<ConjugationResults deckId={7} />);

    const items = within(screen.getByRole('list', { name: 'Common mistakes' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('The él/ella/Ud. form for another person');
    expect(items[0]).toHaveTextContent('e.g. tiene → tengo (tener · yo · presente)');
    expect(items[0]).toHaveTextContent('34×');
    expect(items[1]).toHaveTextContent('Irregular yo form made regular');
    expect(items[1]).not.toHaveTextContent('e.g.');
  });

  it('reads results from a server without the new numbers', () => {
    const old = results({ students: [{ userId: 1, name: 'Ana', email: 'ana@school.test', isTeacher: false, rounds: 1, lastScore: 1, bestScore: 1, lastPlayed: null, mastered: 1, total: 60 }] });
    delete (old as Record<string, unknown>).topMistakes;
    h.result = { data: old, isLoading: false, error: null };
    render(<ConjugationResults deckId={7} />);
    expect(cellIn(rowOf('Ana'), 'Days practised')).toHaveTextContent(/^00 in all$/);
    expect(screen.getByText('No named mistakes yet.')).toBeInTheDocument();
  });

  it('shows the sentences a missed form was shown in, person mistakes by subject, and since when sentences are on (v1.25.0)', () => {
    const base = results();
    h.result = {
      data: {
        ...base,
        sentences: 'builtIn',
        sentencesSince: '2026-10-12T15:00:00.000Z',
        mostMissed: [{
          ...base.mostMissed[2],
          bySentence: [
            { ref: 'tpl:a', sentence: 'Mis primos tienen un perro.', attempts: 3, misses: 2 },
            { ref: 'tpl:b', sentence: null, attempts: 1, misses: 1 },
          ],
        }],
        personBySubject: [
          { type: 'label', answers: 40, personMistakes: 4 },
          { type: 'np_pl', answers: 10, personMistakes: 3 },
          { type: 'ustedes', answers: 8, personMistakes: 2 },
        ],
      },
      isLoading: false,
      error: null,
    };
    render(<ConjugationResults deckId={7} />);
    expect(screen.getByText(/^Sentences on since/)).toHaveTextContent('Expect a short dip in delayed accuracy');
    const missed = screen.getByRole('list', { name: 'Most missed' });
    expect(within(missed).getByText('Mis primos tienen un perro.')).toHaveAttribute('lang', 'es');
    expect(missed).toHaveTextContent('Mis primos tienen un perro. missed 2 of 3');
    expect(missed).toHaveTextContent('a sentence no longer in the deck missed 1 of 1');
    const table = screen.getByRole('heading', { name: 'Person mistakes by subject' }).parentElement!;
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['Person label404 (10%)', 'More than one (mis primos)103 (30%)', 'ustedes (or someone and tú)82 (25%)']);
  });

  it('shows no subject split and no date while sentences are off', () => {
    render(<ConjugationResults deckId={7} />);
    expect(screen.queryByRole('heading', { name: 'Person mistakes by subject' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sentences on since/)).not.toBeInTheDocument();
  });
});
