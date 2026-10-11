// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { test, expect, type Page, type Request } from '@playwright/test';
import {
  TrpcMockError,
  conjugationSentencesPanel,
  conjugationSettingsView,
  defaultAdminUser,
  mockAdminTrpc,
  mockAuthenticatedTrpc,
  sampleGroups,
} from './support/trpcMock';

// The server grades every answer; these mocks play its part, one scripted round at a time.

const unit1 = { id: 1, name: 'Unit 1', description: null, cardCount: 30, learnedCount: 10, dueCount: 4 };
const unit2 = { id: 2, name: 'Unit 2', description: null, cardCount: 25, learnedCount: 0, dueCount: 0 };

const overview = {
  deckId: 1,
  deckName: 'Unit 1',
  enabled: true,
  tenses: [{ id: 'present', label: 'presente' }, { id: 'preterite', label: 'pretérito' }],
  includeVosotros: false,
  vos: 'none',
  directions: 'both',
  answerMode: 'progressive',
  accentMode: 'progressive',
  roundLength: 6,
  levels: ['choice', 'typed-lenient', 'typed-strict'],
  reachedRungs: [] as string[],
  verbs: [
    { entry: 'tener', label: 'tener', kind: 'plain', mastered: 4, total: 12 },
    { entry: 'llamarse', label: 'llamarse', kind: 'pronominal', mastered: 2, total: 12 },
    { entry: 'gustarle', label: 'gustarle', kind: 'dative', mastered: 6, total: 24 },
    { entry: 'haber-impersonal', label: 'haber (hay)', kind: 'impersonal', mastered: 0, total: 12 },
  ],
  mastered: 12,
  total: 60,
  rounds: 0,
  lastScore: null,
  bestScore: null,
  lastPlayed: null,
};

/** The persons a typed fromForm prompt (from a round begun before v1.13) offers with vosotros and vos off. */
const PERSON_OPTIONS = [
  { id: 'yo', label: 'yo' },
  { id: 'tu', label: 'tú' },
  { id: 'el', label: 'él / ella / usted' },
  { id: 'nosotros', label: 'nosotros / nosotras' },
  { id: 'ellos', label: 'ellos / ellas / ustedes' },
];
const TENSE_OPTIONS = [{ id: 'present', label: 'presente' }, { id: 'preterite', label: 'pretérito' }];

type Prompt = Record<string, unknown>;

function toForm(index: number, total: number, level: string, fields: Prompt): Prompt {
  const choice = level === 'choice';
  return {
    index,
    total,
    itemKey: `tok${index}`,
    kind: choice ? 'choice' : 'typed',
    level,
    strictAccents: level === 'typed-strict',
    direction: 'toForm',
    retry: false,
    cue: null,
    form: null,
    options: null,
    askTense: false,
    askPerson: false,
    personOptions: null,
    tenseOptions: null,
    scheduledReview: false,
    fromDeck: null,
    ...fields,
  };
}

/** One answer's verdict, as conjugation.answer returns it. */
function verdict(fields: Prompt): Prompt {
  return {
    result: 'correct',
    counted: true,
    nearMiss: false,
    alsoCorrect: [],
    mistake: null,
    levelBefore: 0,
    levelAfter: 1,
    levelKindAfter: 'typed-lenient',
    mastered: false,
    outcome: fields.counted === false ? 'down' : 'up',
    masteredNow: false,
    masteryPending: false,
    review: false,
    nextReviewDays: null,
    requeued: false,
    next: null,
    finished: false,
    summary: null,
    finishedSets: [],
    ...fields,
  };
}

// A six-question round (two tenses, so fromForm asks the tense): two misses come back at the end.
const P0 = toForm(0, 6, 'choice', {
  entryLabel: 'tener', tense: 'present', tenseLabel: 'presente', personLabel: 'yo',
  options: ['tieno', 'tengo', 'tenemos', 'tiene'],
});
const P1 = toForm(1, 6, 'typed-lenient', { entryLabel: 'estar', tense: 'present', tenseLabel: 'presente', personLabel: 'tú' });
// v1.24.0: each prompt names one subject of its person, taking turns.
const P2 = toForm(2, 6, 'typed-strict', { entryLabel: 'vivir', tense: 'preterite', tenseLabel: 'pretérito', personLabel: 'ella', personId: 'el' });
const P3 = toForm(3, 7, 'choice', {
  entryLabel: 'ser', tense: 'present', tenseLabel: 'presente', personLabel: 'ustedes', personId: 'ellos',
  options: ['somos', 'es', 'son', 'eres'],
});
const P4 = toForm(4, 8, 'typed-lenient', {
  entryLabel: 'gustarle', tense: 'present', tenseLabel: 'presente', personLabel: 'a mí', cue: 'el chocolate',
});
// "Name the verb" is multiple choice on every ladder; with two tenses, the options name the tense. Every option
// is llamarse, so the question names it and the options name one subject each (v1.24.0).
const P5 = {
  ...toForm(5, 8, 'choice', {}),
  direction: 'fromForm',
  entryLabel: null, tense: null, tenseLabel: null, personLabel: null,
  form: 'nos llamamos',
  askTense: true,
  optionsVerb: 'llamarse',
  options: ['yo · presente', 'nosotras · presente', 'ustedes · presente', 'usted · presente'],
};
const P6 = { ...toForm(6, 8, 'typed-lenient', { entryLabel: 'vivir', tense: 'preterite', tenseLabel: 'pretérito', personLabel: 'usted', personId: 'el' }), retry: true };
const P7 = { ...toForm(7, 8, 'choice', { ...P3, index: 7, total: 8, itemKey: 'tok7', options: ['eres', 'somos', 'son', 'es'] }), retry: true };

const SUMMARY = { roundId: 41, score: 4 / 6, firstTryCorrect: 4, prompts: 6, answers: 8, abandoned: false, mastered: 14, almost: 3, climbing: 20, total: 60 };

/** The server's answer to each prompt of the round, by index. */
const VERDICTS: Record<number, Prompt> = {
  0: verdict({ correctAnswer: 'tengo', total: 6, next: P1 }),
  1: verdict({ correctAnswer: 'estás', levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict', total: 6, next: P2 }),
  2: verdict({
    result: 'accent', counted: false, nearMiss: true, correctAnswer: 'vivió',
    levelBefore: 2, levelAfter: 1, levelKindAfter: 'typed-lenient', requeued: true, total: 7, next: P3,
  }),
  3: verdict({
    result: 'wrong', counted: false, correctAnswer: 'son',
    levelBefore: 0, levelAfter: 0, levelKindAfter: 'choice', requeued: true, total: 8, next: P4,
    rightOptions: ['son'], sharedBy: { form: 'son', person: 'ellos', subjects: ['ellos', 'ellas', 'ustedes'] },
    // "es" for "son": the singular for the plural. This deck's guide has no "Verbs to memorize" (no ser in it).
    mistake: {
      kind: 'person', detail: { person: 'el' }, guideSection: 'present-irregular',
      guideSections: ['present-irregular', 'present-build', 'persons-glance'],
    },
  }),
  4: verdict({ correctAnswer: 'me gusta', levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict', total: 8, next: P5 }),
  5: verdict({
    correctAnswer: 'llamarse · nosotras · presente', rightOptions: ['nosotras · presente'],
    sharedBy: { form: 'nos llamamos', person: 'nosotros', subjects: ['nosotros', 'nosotras'] },
    levelBefore: 0, levelAfter: 0, levelKindAfter: 'choice', outcome: 'pending', masteryPending: true, total: 8, next: P6,
  }),
  6: verdict({ correctAnswer: 'vivió', levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict', total: 8, next: P7 }),
  7: verdict({
    correctAnswer: 'son', levelBefore: 0, levelAfter: 1, levelKindAfter: 'typed-lenient', total: 8,
    finished: true, summary: SUMMARY,
  }),
};

interface RoundCalls {
  starts: unknown[];
  /** ms: how long the question took, measured in the browser. */
  answers: { roundId: number; index: number; answer: Record<string, string>; ms?: unknown }[];
  finishes: unknown[];
  currents: unknown[];
}

/** The answers as sent, without the time each took; and each did carry one. */
function answersSent(calls: RoundCalls) {
  for (const a of calls.answers) {
    expect(typeof a.ms).toBe('number');
    expect(a.ms as number).toBeGreaterThanOrEqual(0);
  }
  return calls.answers.map(({ ms: _ms, ...rest }) => rest);
}

/** The prompt the scripted round waits on at an index. */
const promptAt = (index: number) => (index === 0 ? P0 : VERDICTS[index - 1].next as Prompt);

/**
 * A student on Unit 1's quiz, with a server that plays the scripted round. Like
 * the server, it keeps where the round is: the overview reports it as open and
 * conjugation.current gives its waiting prompt.
 */
async function mockRound(page: Page, answer?: (input: RoundCalls['answers'][number]) => unknown): Promise<RoundCalls> {
  const calls: RoundCalls = { starts: [], answers: [], finishes: [], currents: [] };
  let open: { roundId: number; index: number } | null = null;
  await mockAuthenticatedTrpc(page, {
    decks: [unit1],
    conjugationQuizzes: [{ deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: null }],
    queries: {
      'conjugation.overview': () => ({
        ...overview,
        openRound: open
          ? { roundId: open.roundId, index: open.index, total: promptAt(open.index).total, answers: open.index, startedAt: new Date().toISOString() }
          : null,
      }),
      'conjugation.current': (input: unknown) => {
        calls.currents.push(input);
        if (!open) throw new TrpcMockError('This round is over', 'BAD_REQUEST', 400, 'ROUND_FINISHED');
        const waiting = promptAt(open.index);
        return {
          roundId: open.roundId, deckId: 1, deckName: 'Unit 1', total: waiting.total, review: false, levels: overview.levels,
          index: open.index, answers: open.index, firstTryCorrect: open.index, prompt: waiting,
        };
      },
    },
    mutations: {
      'conjugation.start': (input: unknown) => {
        calls.starts.push(input);
        open = { roundId: 40 + calls.starts.length, index: 0 };
        return { roundId: open.roundId, deckName: 'Unit 1', total: 6, review: false, levels: overview.levels, prompt: P0 };
      },
      'conjugation.answer': (input: unknown) => {
        const sent = input as RoundCalls['answers'][number];
        calls.answers.push(sent);
        const reply = (answer ? answer(sent) : VERDICTS[sent.index]) as Prompt;
        if (open && sent.index === open.index) open = reply.finished ? null : { ...open, index: sent.index + 1 };
        return reply;
      },
      'conjugation.finish': (input: unknown) => {
        calls.finishes.push(input);
        return SUMMARY;
      },
    },
  });
  return calls;
}

test.describe('student dashboard', () => {
  test('shows "Unit 1 conjugation" only under a deck with the quiz on, and links to it', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      decks: [unit1, unit2],
      conjugationQuizzes: [{ deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: null }],
      queries: { 'conjugation.overview': overview },
    });
    await page.goto('/');

    const link = page.getByRole('link', { name: /Unit 1 conjugation/ });
    await expect(link).toBeVisible();
    await expect(link).toContainText('12 / 60 mastered');
    await expect(link).toHaveAttribute('href', '/conjugation/1');
    await expect(page.getByRole('link', { name: /Unit 2 conjugation/ })).toHaveCount(0);
    // The deck's own quiz, and "Study all" beside "Your Decks" (v1.18.0).
    await expect(page.getByRole('link', { name: /conjugation/ })).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Study all conjugation' })).toHaveAttribute('href', '/conjugation/all');

    await link.click();
    await expect(page).toHaveURL(/\/conjugation\/1$/);
    await expect(page.getByRole('heading', { name: 'Unit 1 conjugation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a round' })).toBeVisible();
  });

  test('has no conjugation link while the teacher has the quiz off', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [unit1, unit2] });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Unit 1' })).toBeVisible();
    await expect(page.getByRole('link', { name: /conjugation/ })).toHaveCount(0);
  });
});

test.describe('a round in the browser', () => {
  test('plays a full round: choice, typed with accent keys, near miss, wrong answer, "me gusta", form → verb, summary', async ({ page }) => {
    const calls = await mockRound(page);
    await page.goto('/conjugation/1');

    // Before a round: where the student stands.
    await expect(page.getByRole('heading', { name: 'Unit 1 conjugation' })).toBeVisible();
    await expect(page.getByText('12 / 60 mastered')).toBeVisible();
    await expect(page.getByText('presente, pretérito')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'haber (hay)' })).toContainText('0/12');
    await page.getByRole('button', { name: 'Start a round' }).click();

    // 1. Multiple choice, answered with the keyboard.
    const card = page.getByRole('group', { name: /yo \(tener\)/ });
    await expect(card).toBeVisible();
    expect(calls.starts).toEqual([{ deckId: 1 }]);
    await expect(page.getByText('1 / 6')).toBeVisible();
    await expect(page.getByText('Multiple choice')).toBeVisible();
    await expect(page.getByText('Pick the right form.')).toBeVisible();
    await page.keyboard.press('2');
    const feedback = page.getByRole('status').filter({ hasText: /Correct|Not quite|Almost/ });
    await expect(feedback).toContainText('✓ Correct!');
    await expect(feedback).toContainText('Next time, you type it.');
    await expect(page.getByRole('button', { name: 'tengo' })).toHaveClass(/border-green-500/);
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.press('Enter');

    // 2. Typed, accents forgiven, the accent from the on-screen keys.
    await expect(page.getByRole('group', { name: /tú \(estar\)/ })).toBeVisible();
    await expect(page.getByText('Typed · accents forgiven')).toBeVisible();
    const answer = page.getByLabel('Your answer', { exact: true });
    await expect(answer).toBeFocused();
    await answer.pressSequentially('est');
    await page.getByRole('button', { name: 'insertar á' }).click();
    await expect(answer).toBeFocused();
    await page.keyboard.type('s');
    await expect(answer).toHaveValue('estás');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('✓ Correct!');
    await expect(feedback).toContainText('Next time, the accents count.');
    await page.getByRole('button', { name: 'Next' }).click();

    // 3. Typed with accents counting: a missing accent is a near miss that comes back.
    await expect(page.getByRole('group', { name: /^ella \(vivir\)/ })).toBeVisible();
    await expect(page.getByText('Typed · accents count')).toBeVisible();
    await expect(page.getByText('pretérito', { exact: true })).toBeVisible();
    await page.getByLabel('Your answer (accents count)').fill('vivio');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(feedback).toContainText('Almost — check the accent: vivió');
    await expect(feedback).toContainText('You answered: vivio');
    await expect(feedback).toContainText('This one comes back at the end of the round.');
    await expect(feedback).not.toContainText('✓');
    // Back in the (now read-only) answer box to look at the accent: Enter there still moves on.
    await page.getByLabel('Your answer (accents count)').click();
    await expect(page.getByLabel('Your answer (accents count)')).toBeFocused();
    await page.keyboard.press('Enter');

    // 4. A wrong pick: the right answer is shown and marked. The round grew by the one that came back.
    await expect(page.getByRole('group', { name: /^ustedes \(ser\)/ })).toBeVisible();
    // At multiple choice, what ustedes means (v1.24.0).
    await expect(page.getByText('you all', { exact: true })).toBeVisible();
    await expect(page.getByText('4 / 7')).toBeVisible();
    await page.getByRole('button', { name: 'es', exact: true }).click();
    await expect(feedback).toContainText('✗ Not quite. The answer: son');
    await expect(feedback).toContainText('You answered: es');
    await expect(page.getByRole('button', { name: 'son', exact: true })).toHaveClass(/border-green-500/);
    await expect(page.getByRole('button', { name: 'es', exact: true })).toHaveClass(/border-red-500/);
    await expect(page.getByRole('button', { name: 'somos' })).toBeDisabled();
    // The mistake, named in one line, with the part of this deck's guide that explains it.
    await expect(feedback).toContainText('Ustedes is plural, so the verb needs its -n form.');
    // Who shares the form, once, after the answer.
    await expect(feedback).toContainText('son = ellos · ellas · ustedes (they / you all)');
    await page.getByRole('button', { name: 'Why? See the guide.' }).click();
    const guide = page.getByRole('dialog', { name: 'Intro to conjugation' });
    await expect(guide.locator('#guide-present-build-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.press('Enter');

    // 5. A "me gusta" prompt: the experiencer and the thing liked.
    await expect(page.getByRole('group', { name: /a mí \(gustarle\)/ })).toBeVisible();
    await expect(page.getByText('+ el chocolate')).toBeVisible();
    await expect(page.getByText('5 / 8')).toBeVisible();
    await page.getByLabel('Your answer', { exact: true }).fill('me gusta');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('✓ Correct!');
    await page.keyboard.press('Enter');

    // 6. Form → verb: always multiple choice, the options naming who and the tense. Right on the
    //    top rung for the first time: mastered only on another day.
    await expect(page.getByRole('group', { name: 'nos llamamos' })).toBeVisible();
    await expect(page.getByText('Which form of llamarse is this?')).toBeVisible();
    // The verb in a Spanish voice, inside the English question.
    await expect(page.getByText('Which form of llamarse is this?').locator('span[lang="es"]')).toHaveText('llamarse');
    await expect(page.getByRole('button', { name: /^ustedes · presente/ })).toContainText('you all');
    await expect(page.getByLabel('The verb, in its dictionary form (infinitive)')).toHaveCount(0);
    await page.keyboard.press('2');
    await expect(feedback).toContainText('✓ Correct!');
    await expect(feedback).toContainText('Right on the top rung! Get it right again on another day to master it.');
    await expect(feedback).not.toContainText('Mastered!');
    await page.keyboard.press('Enter');

    // 7. The near miss comes back, now with accents forgiven.
    await expect(page.getByText('Second try')).toBeVisible();
    const again = page.getByLabel('Your answer', { exact: true });
    await again.pressSequentially('vivi');
    await page.getByRole('button', { name: 'insertar ó' }).click();
    await expect(again).toHaveValue('vivió');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('✓ Correct!');
    await page.keyboard.press('Enter');

    // 8. The wrong pick comes back; the last answer ends the round.
    await expect(page.getByText('8 / 8')).toBeVisible();
    await expect(page.getByText('Second try')).toBeVisible();
    await page.keyboard.press('3');
    await expect(feedback).toContainText('✓ Correct!');
    await page.getByRole('button', { name: 'See results' }).click();

    await expect(page.getByRole('heading', { name: 'Round complete' })).toBeFocused();
    await expect(page.getByText('67%')).toBeVisible();
    await expect(page.getByText('4 of 6 right the first time')).toBeVisible();
    await expect(page.getByText('14 / 60 mastered')).toBeVisible();
    // Not mastered yet is not nothing: what needs one more day, and what climbed (v1.16).
    await expect(page.getByText('3 need one more day')).toBeVisible();
    await expect(page.getByText('20 on the way up')).toBeVisible();
    await expect(page.getByText('A form is mastered when you get it right at the last step on two different days.')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Mastered' }))
      .toHaveAttribute('aria-valuetext', '14 / 60 mastered · 3 need one more day · 20 on the way up');
    await expect(page.getByRole('button', { name: 'Another round' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Study' }).last()).toHaveAttribute('href', '/');

    // Every answer went to the server as typed or picked, once each, in order, with the time it took.
    expect(answersSent(calls)).toEqual([
      { roundId: 41, index: 0, answer: { choice: 'tengo' } },
      { roundId: 41, index: 1, answer: { text: 'estás' } },
      { roundId: 41, index: 2, answer: { text: 'vivio' } },
      { roundId: 41, index: 3, answer: { choice: 'es' } },
      { roundId: 41, index: 4, answer: { text: 'me gusta' } },
      { roundId: 41, index: 5, answer: { choice: 'nosotras · presente' } },
      { roundId: 41, index: 6, answer: { text: 'vivió' } },
      { roundId: 41, index: 7, answer: { choice: 'son' } },
    ]);
    // The last answer carried the score: no separate finish call.
    expect(calls.finishes).toEqual([]);
  });

  test('an expired round says so and starts a new one', async ({ page }) => {
    const calls = await mockRound(page, (sent) => {
      if (calls.starts.length === 1) {
        throw new TrpcMockError('This round has expired', 'BAD_REQUEST', 400, 'ROUND_EXPIRED');
      }
      return VERDICTS[sent.index];
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await page.getByRole('button', { name: 'tengo' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This round expired. Start a new round.');
    await alert.getByRole('button', { name: 'Start a new round' }).click();
    await expect.poll(() => calls.starts.length).toBe(2);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // The new round takes answers again.
    await page.getByRole('button', { name: 'tengo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    expect(calls.answers.map((a) => a.roundId)).toEqual([41, 42]);
  });

  test('a quiz turned off mid-round says so, with nothing to send again', async ({ page }) => {
    const calls = await mockRound(page, () => {
      throw new TrpcMockError('This deck has no conjugation quiz', 'NOT_FOUND', 404, 'CONJUGATION_OFF');
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await page.getByRole('button', { name: 'tengo' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This deck has no conjugation practice right now.');
    await expect(alert).not.toContainText('connection');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue the round' })).toHaveCount(0);
    // The round is left: its question is gone, so nothing sends the answer again.
    await expect(page.getByRole('button', { name: 'tengo' })).toHaveCount(0);
    await page.keyboard.press('Enter');
    expect(calls.answers).toHaveLength(1);
  });

  test('a held Enter shows the verdict and stays on it', async ({ page }) => {
    const calls = await mockRound(page);
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await expect(page.getByRole('group', { name: /yo \(tener\)/ })).toBeVisible();
    await page.keyboard.press('2');
    await page.getByRole('button', { name: 'Next' }).click();

    // The student types the answer and holds Enter: the first keydown checks it, the repeats land on Next.
    await page.getByLabel('Your answer', { exact: true }).fill('estás');
    await page.keyboard.down('Enter');
    const feedback = page.getByRole('status').filter({ hasText: 'Correct!' });
    await expect(feedback).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(feedback).toBeVisible();
    await expect(page.getByText('2 / 6')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // A fresh press moves on; held, its repeats land in the next prompt's input and must not submit it empty.
    await page.keyboard.down('Enter');
    await expect(page.getByRole('group', { name: /^ella \(vivir\)/ })).toBeVisible();
    await expect(page.getByLabel('Your answer (accents count)')).toBeFocused();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Type your answer first.')).toHaveCount(0);
    expect(calls.answers.map((a) => a.index)).toEqual([0, 1]);
  });

  test('an answer lost on the network is sent again, the same, for the same question', async ({ page }) => {
    const calls = await mockRound(page);
    // The first answer never arrives; the second arrives but its response is lost.
    let lost = 0;
    await page.route((url) => url.pathname.endsWith('/conjugation.answer'), async (route, request: Request) => {
      lost += 1;
      if (lost === 1) return route.abort('failed');
      if (lost === 2) {
        const raw = JSON.parse(request.postData() ?? '{}') as Record<string, { json?: unknown } | undefined>;
        const slot = raw['0'];
        calls.answers.push((slot && 'json' in slot ? slot.json : slot) as RoundCalls['answers'][number]);
        return route.abort('connectionreset');
      }
      return route.fallback();
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await expect(page.getByRole('group', { name: /yo \(tener\)/ })).toBeVisible();
    await page.keyboard.press('2');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Could not send your answer.');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeFocused();
    // Nothing else can be picked meanwhile.
    await expect(page.getByRole('button', { name: 'tenemos' })).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect.poll(() => lost).toBe(2);
    await expect(alert).toContainText('Could not send your answer.');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeFocused();
    await page.keyboard.press('Enter');

    const feedback = page.getByRole('status').filter({ hasText: 'Correct!' });
    await expect(feedback).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // The server saw the same answer twice (it gives a repeat its first response); nothing asked it to start over.
    expect(answersSent(calls)).toEqual([
      { roundId: 41, index: 0, answer: { choice: 'tengo' } },
      { roundId: 41, index: 0, answer: { choice: 'tengo' } },
    ]);
    // With the time the question took, not the wait for Try again.
    expect(calls.answers[1].ms).toBe(calls.answers[0].ms);
    expect(calls.starts).toHaveLength(1);
  });

  test('a reload mid-round offers to continue it where it was', async ({ page }) => {
    const calls = await mockRound(page);
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await expect(page.getByRole('group', { name: /yo \(tener\)/ })).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: /tú \(estar\)/ })).toBeVisible();

    await page.reload();
    await expect(page.getByText('You have a round in progress: question 2 of 6.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue the round' }).click();
    await expect(page.getByRole('group', { name: /tú \(estar\)/ })).toBeVisible();
    await expect(page.getByText('2 / 6')).toBeVisible();
    expect(calls.currents).toEqual([{ roundId: 41 }]);

    await page.getByLabel('Your answer', { exact: true }).fill('estás');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    expect(calls.starts).toHaveLength(1);
    expect(calls.answers.map((a) => [a.roundId, a.index])).toEqual([[41, 0], [41, 1]]);
  });

  test('a double click sends one answer', async ({ page }) => {
    const calls = await mockRound(page);
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();
    await page.getByRole('button', { name: 'tengo' }).dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    expect(calls.answers).toHaveLength(1);
  });

  test('forms due come back: counted on the card and before a round, a review from an earlier unit, mastery on a second day', async ({ page }) => {
    const R0 = toForm(0, 2, 'typed-strict', {
      entryLabel: 'ser', tense: 'present', tenseLabel: 'presente', personLabel: 'tú',
      scheduledReview: true, fromDeck: { deckId: 9, deckName: 'Unit 0' },
    });
    const R1 = toForm(1, 2, 'choice', {
      entryLabel: 'tener', tense: 'present', tenseLabel: 'presente', personLabel: 'yo', options: ['tiene', 'tengo', 'teno', 'tenemos'],
    });
    const answers: RoundCalls['answers'] = [];
    await mockAuthenticatedTrpc(page, {
      decks: [unit1],
      conjugationQuizzes: [{ deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: null, due: 3 }],
      queries: { 'conjugation.overview': { ...overview, due: 3, openRound: null } },
      mutations: {
        'conjugation.start': { roundId: 50, deckId: 1, deckName: 'Unit 1', total: 2, review: false, reviews: 1, levels: overview.levels, prompt: R0 },
        'conjugation.answer': (input: unknown) => {
          const sent = input as RoundCalls['answers'][number];
          answers.push(sent);
          return sent.index === 0
            ? verdict({ correctAnswer: 'eres', levelBefore: 2, levelAfter: 2, levelKindAfter: 'typed-strict', mastered: true, outcome: 'reviewed', review: true, nextReviewDays: 21, total: 2, next: R1 })
            : verdict({
              correctAnswer: 'tengo', levelBefore: 0, levelAfter: 0, levelKindAfter: 'choice', mastered: true, outcome: 'mastered', masteredNow: true,
              nextReviewDays: 7, total: 2, finished: true, summary: { ...SUMMARY, roundId: 50, prompts: 2, answers: 2, firstTryCorrect: 2, score: 1 },
            });
        },
      },
    });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Unit 1 conjugation/ })).toContainText('3 forms due');
    await page.getByRole('link', { name: /Unit 1 conjugation/ }).click();
    await expect(page.getByText('3 forms due')).toBeVisible();
    await expect(page.getByText(/Mastered forms come back for review, to stay mastered\./)).toBeVisible();
    await page.getByRole('button', { name: 'Start a round' }).click();

    // A form mastered in an earlier unit's quiz, back for review and graded there.
    await expect(page.getByRole('group', { name: /tú \(ser\)/ })).toBeVisible();
    await expect(page.getByText('Back for review · Unit 0')).toBeVisible();
    await page.getByLabel('Your answer (accents count)').fill('eres');
    await page.keyboard.press('Enter');
    const feedback = page.getByRole('status').filter({ hasText: /Correct|Not quite|Almost/ });
    await expect(feedback).toContainText('Still mastered.');
    await expect(feedback).toContainText('It comes back for review in 3 weeks.');
    await page.keyboard.press('Enter');

    // Right on the top rung again, on another day: mastered, and when it comes back.
    await expect(page.getByText(/Back for review/)).toHaveCount(0);
    await page.keyboard.press('2');
    await expect(feedback).toContainText('Mastered!');
    await expect(feedback).toContainText('It comes back for review in a week.');
    // The time each took went to the server; nothing on the page counts it.
    expect(answers.every((a) => typeof a.ms === 'number')).toBe(true);
    await expect(page.getByText(/\bseconds?\b|\d+\s?s\b/)).toHaveCount(0);
  });

  test('a round begun before v1.13 still takes its typed "name the verb" question', async ({ page }) => {
    const legacy = {
      ...toForm(3, 6, 'typed-lenient', {}),
      direction: 'fromForm',
      entryLabel: null, tense: null, tenseLabel: null, personLabel: null,
      form: 'nos llamamos',
      askTense: true,
      askPerson: true,
      personOptions: PERSON_OPTIONS,
      tenseOptions: TENSE_OPTIONS,
    };
    delete (legacy as Prompt).scheduledReview;
    delete (legacy as Prompt).fromDeck;
    const answers: RoundCalls['answers'] = [];
    await mockAuthenticatedTrpc(page, {
      decks: [unit1],
      queries: {
        'conjugation.overview': { ...overview, openRound: { roundId: 30, index: 3, total: 6, answers: 3, startedAt: new Date().toISOString() } },
        'conjugation.current': { roundId: 30, deckId: 1, deckName: 'Unit 1', total: 6, review: false, levels: overview.levels, index: 3, answers: 3, firstTryCorrect: 3, prompt: legacy },
      },
      mutations: {
        // A response as the server gave it before v1.13: no outcome, no mistake.
        'conjugation.answer': (input: unknown) => {
          answers.push(input as RoundCalls['answers'][number]);
          return {
            result: 'correct', counted: true, nearMiss: false, correctAnswer: 'llamarse · nosotros / nosotras · presente', alsoCorrect: [],
            levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict', mastered: false, requeued: false, total: 6, next: null, finished: false, summary: null,
          };
        },
      },
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Continue the round' }).click();
    await expect(page.getByText('Which verb is this? Type its dictionary form (infinitive).')).toBeVisible();
    const verb = page.getByLabel('The verb, in its dictionary form (infinitive)');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('alert')).toHaveText('Type the verb first.');
    await verb.fill('llamarse');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('alert')).toHaveText('Pick who.');
    const who = page.getByRole('group', { name: 'Who?' });
    await expect(who.getByRole('radio')).toHaveCount(5);
    await who.getByText('nosotros / nosotras').click();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('alert')).toHaveText('Pick the tense.');
    await page.getByRole('group', { name: 'Which tense?' }).getByText('presente').click();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toContainText('Next time, the accents count.');
    expect(answers.map(({ ms: _ms, ...rest }) => rest)).toEqual([
      { roundId: 30, index: 3, answer: { text: 'llamarse', person: 'nosotros', tense: 'present' } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Teacher

const card = (id: number, front: string, back: string) => ({ id, front, back });
const entry = (fields: { entry: string; label: string } & Record<string, unknown>) => ({
  kind: 'plain', known: true, cards: [], note: null, excludedByDefault: false, included: true, extra: false, ...fields,
});

/** Unit 1's detected verbs, the way the engine reads its cards. */
const UNIT1_ENTRIES = [
  entry({ entry: 'ser', label: 'ser', cards: [card(1, 'soy', 'I am'), card(2, 'eres', 'you are')] }),
  entry({ entry: 'haber-impersonal', label: 'haber (hay)', kind: 'impersonal', note: 'impersonal: practiced as hay / había / hubo…', cards: [card(3, 'hay', 'there is / there are')] }),
  entry({ entry: 'estar', label: 'estar', cards: [card(4, 'estoy', 'I am')] }),
  entry({ entry: 'tener', label: 'tener', cards: [card(5, '<b>tengo</b>', 'I have'), card(6, 'tienes', 'you have')] }),
  entry({ entry: 'llamarse', label: 'llamarse', kind: 'pronominal', cards: [card(7, 'me llamo', 'my name is')] }),
  entry({ entry: 'querer', label: 'querer', cards: [card(8, 'quiero', 'I want')] }),
  entry({ entry: 'ir', label: 'ir', cards: [card(9, 'voy', 'I go')] }),
  entry({ entry: 'gustarle', label: 'gustarle', kind: 'dative', note: 'used with me/te/le: practiced as "me gusta(n)"', cards: [card(10, 'me gusta', 'I like')] }),
  entry({ entry: 'verse', label: 'verse', kind: 'pronominal', cards: [card(11, 'nos vemos', 'see you')] }),
  entry({ entry: 'vivir', label: 'vivir', cards: [card(12, 'vivo', 'I live')] }),
];

/** tener's forms per tense, for the preview. */
const TENER: Record<string, { label: string; forms: Record<string, string> }> = {
  present: { label: 'presente', forms: { yo: 'tengo', tu: 'tienes', vos: 'tenés', el: 'tiene', nosotros: 'tenemos', vosotros: 'tenéis', ellos: 'tienen' } },
  preterite: { label: 'pretérito', forms: { yo: 'tuve', tu: 'tuviste', vos: 'tuviste', el: 'tuvo', nosotros: 'tuvimos', vosotros: 'tuvisteis', ellos: 'tuvieron' } },
};
/** The teacher's views name the group short (v1.24.0). */
const PERSON_LABELS: Record<string, string> = {
  yo: 'yo', tu: 'tú', vos: 'vos', el: 'él/ella/Ud.', nosotros: 'nosotros/as', vosotros: 'vosotros/as', ellos: 'ellos/ellas/Uds.',
};

function tenerPreview(input: { tenses: string[]; vosotros?: boolean; vos?: string }) {
  const persons = ['yo', 'tu', ...(input.vos && input.vos !== 'none' ? ['vos'] : []), 'el', 'nosotros', ...(input.vosotros ? ['vosotros'] : []), 'ellos'];
  return {
    entry: 'tener', label: 'tener', kind: 'plain', known: true, note: null,
    cells: input.tenses.flatMap((tense) => persons.map((person) => ({
      tense, tenseLabel: TENER[tense].label, person, personLabel: PERSON_LABELS[person], number: null, cue: null, forms: [TENER[tense].forms[person]],
    }))),
  };
}

const RESULTS = {
  deckId: 1,
  deckName: 'Unit 1',
  enabled: true,
  total: 60,
  students: [
    {
      userId: 2, name: 'Ana López', email: 'ana@school.test', isTeacher: false, rounds: 3, lastScore: 0.8, bestScore: 0.9, lastPlayed: '2026-09-24T18:00:00.000Z', mastered: 22, total: 60,
      due: 5, daysPractised: 11, daysPractised14: 4, delayedAnswers: 25, delayedAccuracy: 0.72, medianTypedMs: 5120, medianChoiceMs: 2300,
      timeMismatches: 2, veryFast: false,
    },
    {
      userId: 5, name: 'Carla Díaz', email: 'carla@school.test', isTeacher: false, rounds: 4, lastScore: 1, bestScore: 1, lastPlayed: '2026-09-24T18:30:00.000Z', mastered: 30, total: 60,
      due: 0, daysPractised: 2, daysPractised14: 2, delayedAnswers: 0, delayedAccuracy: null, medianTypedMs: null, medianChoiceMs: 420,
      timeMismatches: 0, veryFast: true,
    },
    {
      userId: 4, name: 'Beto Ruiz', email: 'beto@school.test', isTeacher: false, rounds: 0, lastScore: null, bestScore: null, lastPlayed: null, mastered: 0, total: 60,
      due: 0, daysPractised: 0, daysPractised14: 0, delayedAnswers: 0, delayedAccuracy: null, medianTypedMs: null, medianChoiceMs: null,
    },
    {
      userId: 1, name: 'Admin User', email: 'admin@example.com', isTeacher: true, rounds: 1, lastScore: 0.5, bestScore: 0.5, lastPlayed: '2026-09-25T08:00:00.000Z', mastered: 3, total: 60,
      due: 0, daysPractised: 1, daysPractised14: 1, delayedAnswers: 0, delayedAccuracy: null, medianTypedMs: 3000, medianChoiceMs: null,
    },
  ],
  veryFastLine: { typedMs: 1000, choiceMs: 600, minTries: 10 },
  mostMissed: [
    { itemKey: 'ir|preterite|yo|-|to', entry: 'ir', entryLabel: 'ir', tense: 'preterite', tenseLabel: 'pretérito', person: 'yo', personLabel: 'yo', number: null, direction: 'toForm', form: 'fui', misses: 5, attempts: 9 },
    { itemKey: 'gustarle|present|el|pl|from', entry: 'gustarle', entryLabel: 'gustarle', tense: 'present', tenseLabel: 'presente', person: 'el', personLabel: 'a él/ella/Ud.', number: 'pl', direction: 'fromForm', form: 'le gustan', misses: 3, attempts: 7, bySubject: [] },
    {
      itemKey: 'tener|present|ellos|-|to', entry: 'tener', entryLabel: 'tener', tense: 'present', tenseLabel: 'presente', person: 'ellos', personLabel: 'ellos/ellas/Uds.',
      number: null, direction: 'toForm', form: 'tienen', misses: 4, attempts: 10,
      bySubject: [{ subject: 'ustedes', misses: 3, attempts: 4 }, { subject: 'ellos', misses: 1, attempts: 3 }, { subject: 'ellas', misses: 0, attempts: 3 }],
    },
  ],
  topMistakes: [
    {
      key: 'person:el', kind: 'person', detail: { person: 'el' }, count: 34,
      example: { given: 'tiene', itemKey: 'tener|present|yo|-|to', expected: 'tengo', prompt: 'tener · yo · presente' },
    },
    { key: 'dativeSubject', kind: 'dativeSubject', detail: {}, count: 9, example: null },
  ],
};

test.describe('"Study all" (v1.18.0)', () => {
  const allOverview = {
    scope: 'all',
    deckId: 2,
    deckName: 'Unit 2',
    roundLength: 20,
    decks: [
      { deckId: 2, deckName: 'Unit 2', mastered: 0, almost: 0, climbing: 0, total: 20, due: 0 },
      { deckId: 1, deckName: 'Unit 1', mastered: 12, almost: 0, climbing: 6, total: 60, due: 1 },
    ],
    mastered: 12, almost: 0, climbing: 6, total: 80, due: 1,
    tenses: [{ id: 'present', label: 'presente' }],
    includeVosotros: false, vos: 'none', directions: 'both', accentMode: 'progressive',
    levels: ['choice', 'typed-lenient', 'typed-strict'], reachedRungs: ['choice'],
    verbs: [
      { entry: 'hablar', label: 'hablar', kind: 'plain', mastered: 0, total: 10 },
      { entry: 'tener', label: 'tener', kind: 'plain', mastered: 4, total: 12 },
    ],
    rounds: 0, lastScore: null, bestScore: null, lastPlayed: null,
  };
  const A0 = toForm(0, 2, 'choice', {
    entryLabel: 'hablar', tense: 'present', tenseLabel: 'presente', personLabel: 'yo',
    options: ['hablo', 'habla', 'hablas', 'hablamos'], fromDeck: { deckId: 2, deckName: 'Unit 2' },
  });
  const A1 = toForm(1, 2, 'choice', {
    entryLabel: 'tener', tense: 'present', tenseLabel: 'presente', personLabel: 'usted', personId: 'el',
    options: ['tengo', 'tiene', 'tienes', 'tenemos'], scheduledReview: true, fromDeck: { deckId: 1, deckName: 'Unit 1' },
  });
  const ALL_SUMMARY = {
    roundId: 70, scope: 'all', score: 1, firstTryCorrect: 2, prompts: 2, answers: 2, abandoned: false,
    mastered: 12, almost: 0, climbing: 7, total: 80,
    decks: [
      { deckId: 2, deckName: 'Unit 2', mastered: 0, almost: 0, climbing: 1, total: 20 },
      { deckId: 1, deckName: 'Unit 1', mastered: 12, almost: 0, climbing: 6, total: 60 },
    ],
  };

  /** A student with Units 1 and 2, both quizzes on; the server plays a two-question Study all round. */
  async function mockStudyAll(page: Page) {
    const calls = { startAll: [] as unknown[], answers: [] as { index: number; answer: Record<string, string> }[] };
    let open: { index: number } | null = null;
    let played = false;
    await mockAuthenticatedTrpc(page, {
      decks: [unit1, unit2],
      conjugationQuizzes: [
        { deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: null, due: 1 },
        { deckId: 2, deckName: 'Unit 2', mastered: 0, total: 20, lastScore: null, due: 0 },
      ],
      queries: {
        'conjugation.studyAllOverview': () => ({
          ...allOverview,
          ...(played ? { rounds: 1, lastScore: 1, bestScore: 1 } : {}),
          openRound: open ? { roundId: 70, index: open.index, total: 2, answers: open.index, startedAt: new Date().toISOString() } : null,
        }),
      },
      mutations: {
        'conjugation.startAll': (input: unknown) => {
          calls.startAll.push(input);
          open = { index: 0 };
          return { roundId: 70, scope: 'all', deckId: 2, deckName: 'Unit 2', total: 2, review: false, reviews: 1, levels: allOverview.levels, index: 0, answers: 0, firstTryCorrect: 0, prompt: A0 };
        },
        'conjugation.answer': (input: unknown) => {
          const sent = input as { index: number; answer: Record<string, string> };
          calls.answers.push({ index: sent.index, answer: sent.answer });
          if (sent.index === 0) {
            open = { index: 1 };
            return verdict({ correctAnswer: 'hablo', total: 2, next: A1 });
          }
          open = null;
          played = true;
          return verdict({ correctAnswer: 'tiene', review: true, outcome: 'reviewed', mastered: true, levelBefore: 2, levelAfter: 2, levelKindAfter: 'typed-strict', total: 2, finished: true, summary: ALL_SUMMARY });
        },
      },
    });
    return calls;
  }

  test('from the dashboard: every quiz, newest first; each question names its quiz; the summary lists each, and the overview keeps the score', async ({ page }) => {
    const calls = await mockStudyAll(page);
    await page.goto('/');
    await page.getByRole('link', { name: 'Study all conjugation' }).click();
    await expect(page).toHaveURL(/\/conjugation\/all$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Study all conjugation' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Unit 2 conjugation', 'Unit 1 conjugation']);
    await expect(page.getByText('1 form due').first()).toBeVisible();

    await page.getByRole('button', { name: 'Start a round' }).click();
    const first = page.getByRole('group', { name: /yo \(hablar\)/ });
    await expect(first).toBeVisible();
    expect(calls.startAll).toHaveLength(1);
    await expect(first.getByText('Unit 2 conjugation')).toBeVisible();
    await expect(first.getByText('Back for review')).toHaveCount(0);
    await page.keyboard.press('1');
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await page.keyboard.press('Enter');

    // A mastered form of Unit 1 back for review.
    const second = page.getByRole('group', { name: /\(tener\)/ });
    await expect(second.getByText('Unit 1 conjugation')).toBeVisible();
    await expect(second.getByText('Back for review')).toBeVisible();
    await page.keyboard.press('2');
    await page.getByRole('button', { name: 'See results' }).click();

    await expect(page.getByRole('heading', { name: 'Round complete' })).toBeFocused();
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Unit 2 conjugation', 'Unit 1 conjugation']);
    await expect(page.getByText('12 / 60 mastered')).toBeVisible();
    expect(calls.answers).toEqual([{ index: 0, answer: { choice: 'hablo' } }, { index: 1, answer: { choice: 'tiene' } }]);

    // Back on the overview: the round is counted.
    await page.goto('/conjugation/all');
    await expect(page.getByText('Last round: 100%')).toBeVisible();
  });

  test('a reload mid-round offers to continue the Study all round', async ({ page }) => {
    await mockStudyAll(page);
    await page.goto('/conjugation/all');
    await page.getByRole('button', { name: 'Start a round' }).click();
    // The key goes to the question, so wait for it: pressed sooner, it is lost.
    await expect(page.getByRole('group', { name: /yo \(hablar\)/ })).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('You have a round in progress: question 2 of 2.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue the round' })).toBeVisible();
  });

  test('a deck’s page offers Study all between rounds', async ({ page }) => {
    await mockRound(page);
    await page.goto('/conjugation/1');
    await expect(page.getByRole('heading', { name: 'Unit 1 conjugation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Study all conjugation' })).toHaveAttribute('href', '/conjugation/all');
  });

  test('says so when the student has no quiz to play', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      decks: [unit1],
      queries: {
        'conjugation.studyAllOverview': {
          ...allOverview, decks: [], deckId: null, deckName: '', total: 0, mastered: 0, climbing: 0, due: 0, verbs: [], openRound: null,
        },
      },
    });
    await page.goto('/conjugation/all');
    await expect(page.getByText('You have no conjugation practice right now.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a round' })).toHaveCount(0);
  });
});

test.describe('the guide: "Intro to conjugation"', () => {
  test('starts a newcomer at the beginning, and opens over the page without leaving it', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { decks: [unit1], queries: { 'conjugation.overview': overview } });
    await page.goto('/conjugation/1');

    await expect(page.getByRole('heading', { name: 'Intro to conjugation' })).toBeVisible();
    const startHere = page.getByRole('button', { name: 'Start here' });
    await startHere.click();
    const dialog = page.getByRole('dialog', { name: 'Intro to conjugation' });
    await expect(dialog).toBeVisible();
    // The first chapter, and one per tense the deck drills (present and preterite here).
    await expect(dialog.getByRole('heading', { level: 3 })).toBeFocused();
    await expect(dialog.locator('#guide-basics-dictionary-form')).toBeVisible();
    const contents = dialog.getByRole('navigation', { name: 'Contents' });
    // Wide screens list the chapters as buttons; a phone (below md, 768px) gets one select in their place.
    const narrow = page.viewportSize()!.width < 768;
    const picker = contents.getByRole('combobox');
    const chapter = (name: RegExp) => (narrow ? picker.getByRole('option', { name }) : contents.getByRole('button', { name }));
    if (narrow) await expect(picker).toBeVisible();
    for (const name of [/present/i, /preterite/i]) {
      // An option is listed, not laid out, until the select opens.
      if (narrow) await expect(chapter(name)).toHaveCount(1);
      else await expect(chapter(name)).toBeVisible();
    }
    await expect(chapter(/imperfect/i)).toHaveCount(0);
    // Nothing about typing before the student types.
    if (narrow) await picker.selectOption((await chapter(/How this practice works/).getAttribute('value'))!);
    else await chapter(/How this practice works/).click();
    await expect(dialog.locator('#guide-quiz-rounds')).toBeVisible();
    await expect(dialog.locator('#guide-quiz-typing')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus is back on the card's button, which no longer says "Start here": the guide has been opened.
    await expect(page.getByRole('button', { name: 'Open the guide' })).toBeFocused();
  });

  test('grows as the student climbs, and says what is new', async ({ page }) => {
    let reached: string[] = [];
    await mockAuthenticatedTrpc(page, {
      decks: [unit1],
      queries: { 'conjugation.overview': () => ({ ...overview, reachedRungs: reached }) },
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start here' }).click();
    await page.keyboard.press('Escape');

    // Later: the student has typed answers.
    reached = ['choice', 'typed-lenient'];
    await page.reload();
    await expect(page.getByRole('button', { name: /Guide/ })).toContainText('New');
    await expect(page.getByText(/New in your guide:/)).toBeVisible();
    await page.getByRole('button', { name: 'Read what’s new' }).click();
    const dialog = page.getByRole('dialog', { name: 'Intro to conjugation' });
    await expect(dialog.locator('#guide-quiz-typing-title')).toBeFocused();
    await expect(dialog.locator('#guide-quiz-typing-title')).toContainText('New');
    await page.keyboard.press('Escape');
    // Seen: nothing new now.
    await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open the guide' })).toBeVisible();
  });

  test('opens only between questions: after the answer, on the tense asked, with the page’s keys waiting', async ({ page }) => {
    const calls = await mockRound(page);
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();

    // A question waits: the tense is only a label, and the guide says when it opens.
    await expect(page.getByRole('button', { name: /presente/ })).toHaveCount(0);
    // Held (aria-disabled), not disabled: a student can still press it, and hears why nothing opens.
    const held = page.getByRole('button', { name: 'Guide', exact: true }).first();
    await expect(held).toHaveAttribute('aria-disabled', 'true');
    await held.click({ force: true });
    await expect(page.getByText('You can open the guide once you answer this question.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.keyboard.press('2');
    await expect(page.getByText(/Correct!/)).toBeVisible();
    expect(answersSent(calls)).toEqual([{ roundId: 41, index: 0, answer: { choice: 'tengo' } }]);
    await expect(page.getByText('You can open the guide once you answer this question.')).toHaveCount(0);

    // Answered: the tense leads to its chapter; Enter inside the guide does not move the round on.
    await page.getByRole('button', { name: /presente/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Intro to conjugation' });
    await expect(dialog.getByRole('heading', { level: 3 })).toContainText(/present/i);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('1 / 6')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('2 / 6')).toBeVisible();
  });
});

test.describe('teacher', () => {
  test('turns the quiz on, reviews the verbs, previews forms, saves and sees the results', async ({ page }) => {
    const unit1Admin = { id: 1, name: 'Unit 1', description: null, cardCount: 30, reversible: false };
    let view: Record<string, unknown> = { ...conjugationSettingsView(1, 'Unit 1', 30), effective: UNIT1_ENTRIES.map((e) => e.entry), verbCount: 10, itemCount: 120, entries: UNIT1_ENTRIES };
    const previews: Record<string, unknown>[] = [];
    const saves: Record<string, unknown>[] = [];
    await mockAdminTrpc(page, {
      decks: [unit1Admin],
      queries: {
        'conjugation.settings': () => view,
        'conjugation.preview': (input: unknown) => {
          previews.push(input as Record<string, unknown>);
          return tenerPreview(input as { tenses: string[] });
        },
        'conjugation.results': RESULTS,
      },
      mutations: {
        'conjugation.saveSettings': (input: unknown) => {
          const settings = { ...(input as Record<string, unknown>) };
          delete settings.deckId;
          saves.push(input as Record<string, unknown>);
          view = {
            ...view,
            settings: { ...(view.settings as object), ...settings },
            verbCount: 10,
            itemCount: 342,
            entries: [
              ...UNIT1_ENTRIES.map((e) => (e.entry === 'verse' ? { ...e, included: false } : e)),
              entry({ entry: 'bailar', label: 'bailar', extra: true }),
            ],
          };
          return view;
        },
      },
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByText('Unit 1', { exact: true }).click();

    const section = page.getByRole('region', { name: 'Conjugation' });
    await expect(section).toBeVisible();
    await expect(section).toContainText('Students see it as “Unit 1 conjugation”.');
    await expect(section.getByRole('link', { name: 'Try it' })).toHaveAttribute('href', '/conjugation/1');
    await expect(section.getByRole('link', { name: 'Try it' })).toHaveAttribute('target', '_blank');

    // Off by default; switching it on is a draft until Save.
    const toggle = section.getByRole('switch', { name: 'Students can practice it' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByText('Unsaved changes. Students play the saved settings.')).toBeVisible();

    // The detected verbs, each with its kind and the cards it came from.
    const rows = section.getByRole('listitem');
    await expect(rows).toHaveCount(10);
    const row = (label: string) => rows.filter({ has: page.getByRole('checkbox', { name: label, exact: true }) });
    await expect(row('llamarse').getByText('reflexive', { exact: true })).toBeVisible();
    await expect(row('verse').getByText('reflexive', { exact: true })).toBeVisible();
    await expect(row('gustarle').getByText('“me gusta” type')).toBeVisible();
    await expect(row('gustarle')).toContainText('Used with me/te/le: practiced as “me gusta(n)”');
    await expect(row('haber (hay)').getByText('impersonal', { exact: true })).toBeVisible();
    await expect(row('tener')).toContainText('From: tengo — I have; tienes — you have');
    await expect(row('tener').getByText(/reflexive|type|impersonal/)).toHaveCount(0);
    await expect(section.getByText('10 verbs · 120 items')).toBeVisible();

    // Tenses, vosotros and vos.
    await expect(section.getByRole('checkbox', { name: 'presente (present)', exact: true })).toBeChecked();
    await section.getByRole('checkbox', { name: 'pretérito (preterite)', exact: true }).check();
    await section.getByRole('checkbox', { name: 'Include vosotros' }).check();
    const vos = section.locator('select').filter({ has: page.locator('option[value="rioplatense"]') });
    await expect(vos).toHaveValue('none');
    await vos.selectOption({ label: 'Río de la Plata' });
    await section.getByLabel('Questions per round').fill('15');

    // Leave one verb out and add one by hand.
    await row('verse').getByRole('checkbox').uncheck();
    await section.getByLabel('Add a verb').fill('bailar');
    await section.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(row('bailar')).toContainText('added — saved when you press Save');
    await section.getByLabel('Add a verb').fill('tener');
    await section.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(section.getByRole('alert')).toHaveText('tener is already in the list.');

    // Preview tener's forms with the draft's tenses and persons.
    await row('tener').getByRole('button', { name: 'Preview forms' }).click();
    const preview = row('tener').locator('table');
    await expect(preview).toHaveCount(2);
    const present = preview.filter({ hasText: 'presente' });
    await expect(present.getByRole('row', { name: /^vos\b/ })).toContainText('tenés');
    await expect(present.getByRole('row', { name: /^vosotros/ })).toContainText('tenéis');
    await expect(preview.filter({ hasText: 'pretérito' }).getByRole('row', { name: /^él/ })).toContainText('tuvo');
    expect(previews.at(-1)).toEqual({ entry: 'tener', tenses: ['present', 'preterite'], vosotros: true, vos: 'rioplatense' });
    await row('tener').getByRole('button', { name: 'Hide forms' }).click();
    await expect(preview).toHaveCount(0);

    // Save sends the whole draft.
    await expect(section.getByText('(as saved)')).toBeVisible();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Saved.')).toBeVisible();
    expect(saves).toEqual([{
      deckId: 1,
      enabled: true,
      tenses: ['present', 'preterite'],
      includeVosotros: true,
      vos: 'rioplatense',
      directions: 'both',
      answerMode: 'progressive',
      accentMode: 'progressive',
      roundLength: 15,
      excludedEntries: ['verse'],
      extraEntries: ['bailar'],
      // v1.25.0: the label until the teacher turns sentences on.
      sentences: 'off',
      sentenceHoldback: false,
    }]);
    await expect(section.getByText('10 verbs · 342 items')).toBeVisible();
    await expect(section.getByText('(as saved)')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(row('verse').getByRole('checkbox')).not.toBeChecked();
    await expect(row('bailar')).toContainText('added by you');
    await expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Results: per student, the teacher's own run marked, and the most missed items.
    await section.getByRole('button', { name: 'Results' }).click();
    const table = section.getByRole('table');
    const ana = table.getByRole('row', { name: /Ana López/ });
    await expect(ana).toContainText('80%');
    await expect(ana).toContainText('90%');
    await expect(ana).toContainText('22 / 60');
    await expect(table.getByRole('row', { name: /Beto Ruiz/ })).toContainText('not played');
    const mine = table.getByRole('row', { name: /Admin User/ });
    await expect(mine).toContainText('your test run');
    await expect(mine).not.toContainText('admin@example.com');
    // The numbers that predict a test.
    await expect(ana).toContainText('5 due');
    await expect(ana).toContainText('11 in all');
    await expect(ana).toContainText('72%');
    await expect(ana).toContainText('5.1 s typed');
    await expect(ana).toContainText('2.3 s choice');
    // Times the page could not have measured, in red; a median too fast to have read the question, in amber (v1.16).
    await expect(ana).toContainText('2 answer times didn’t match the time that passed');
    const carla = table.getByRole('row', { name: /Carla Díaz/ });
    await expect(carla).toContainText('0.4 s choice');
    await expect(carla.getByText('Very fast', { exact: true })).toBeVisible();
    await expect(ana.getByText('Very fast', { exact: true })).toHaveCount(0);
    await expect(section.getByText('Very fast: a median under 1.0 s typed or 0.6 s multiple choice, over 10 or more first tries.')).toBeVisible();
    await expect(section.getByText(/never more than the time that passed between answers/)).toBeVisible();
    const common = section.getByRole('list', { name: 'Common mistakes' });
    await expect(common.getByRole('listitem').first()).toContainText('The él/ella/Ud. form for another person');
    await expect(common.getByRole('listitem').first()).toContainText('e.g. tiene → tengo (tener · yo · presente)');
    await expect(common.getByRole('listitem').first()).toContainText('34×');
    await expect(common.getByRole('listitem').nth(1)).toContainText('“gustar” type conjugated for the person (gusto)');
    await expect(section.getByRole('heading', { name: 'Most missed' })).toBeVisible();
    const missed = section.getByRole('listitem').filter({ hasText: 'fui' });
    await expect(missed).toContainText('ir · yo · pretérito');
    await expect(missed).toContainText('infinitive → form');
    await expect(missed).toContainText('missed 5 of 9');
    await expect(section.getByRole('listitem').filter({ hasText: 'le gustan' })).toContainText('form → verb');
    // v1.24.0: the group short, and the misses by the subject the prompt showed.
    const tienen = section.getByRole('listitem').filter({ hasText: 'tienen' });
    await expect(tienen).toContainText('tener · ellos/ellas/Uds. · presente');
    await expect(tienen).toContainText('shown as ustedes missed 3 of 4 · ellos missed 1 of 3 · ellas missed 0 of 3');

    await section.getByRole('button', { name: 'Back to settings' }).click();
    await expect(section.getByRole('switch', { name: 'Students can practice it' })).toBeVisible();
  });

  test('"Try it" on a deck with the quiz off tells the teacher students cannot see it', async ({ page }) => {
    await mockAuthenticatedTrpc(page, {
      authMe: defaultAdminUser,
      queries: { 'conjugation.overview': { ...overview, enabled: false } },
    });
    await page.goto('/conjugation/1');
    await expect(page.getByText('Conjugation practice is off for this deck: students cannot see it. You are trying it as a teacher.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a round' })).toBeVisible();
  });

  test('the group export offers the Conjugation dataset', async ({ page }) => {
    const exports: unknown[] = [];
    await mockAdminTrpc(page, {
      queries: {
        'admin.exportGroupData': (input: unknown) => {
          exports.push(input);
          return {
            csv: 'student_name,student_email,deck,status,rounds,last_score,best_score,mastered,items_total,mastery_pct,last_played\r\n'
              + 'Ana López,ana@school.test,Unit 1,played,3,80.0,90.0,22,60,36.7,2026-09-24T18:00:00.000Z\r\n',
            rowCount: 1,
          };
        },
      },
    });
    await page.goto('/admin?tab=groups');
    await page.getByText(sampleGroups[1].name).first().click();

    const select = page.locator('select').filter({ has: page.locator('option[value="conjugation"]') });
    await expect(select.locator('option[value="conjugation"]')).toHaveText('Conjugation');
    await select.selectOption('conjugation');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data (CSV)' }).click();
    expect((await download).suggestedFilename()).toBe('Spanish_Class-conjugation.csv');
    await expect(page.getByText('Exported 1 row(s).')).toBeVisible();
    expect(exports).toEqual([{ groupId: sampleGroups[1].id, dataset: 'conjugation' }]);
  });
});

test.describe('teacher: an unsaved Conjugation draft and the browser history', () => {
  type Hist = { length: number; path: string; guard: boolean };
  const hist = (page: Page) => page.evaluate((): Hist => ({
    length: history.length,
    path: location.pathname + location.search + location.hash,
    guard: (history.state as { libresrsLeaveGuard?: boolean } | null)?.libresrsLeaveGuard === true,
  }));

  /** From the student dashboard into Admin, the way a teacher gets there, then one unsaved change. */
  async function editDraft(page: Page, mutations: Record<string, (input: unknown) => unknown> = {}) {
    const view = { ...conjugationSettingsView(1, 'Unit 1', 30), effective: ['tener'], verbCount: 1, itemCount: 12,
      entries: [entry({ entry: 'tener', label: 'tener' })] };
    await mockAdminTrpc(page, {
      decks: [{ id: 1, name: 'Unit 1', description: null, cardCount: 30, reversible: false }],
      queries: { 'conjugation.settings': () => view, 'conjugation.results': { ...RESULTS, enabled: false, students: [], mostMissed: [], topMistakes: [] } },
      mutations,
    });
    const dialogs: string[] = [];
    let answer = false;
    page.on('dialog', (d) => { dialogs.push(d.message()); void (answer ? d.accept() : d.dismiss()); });
    await page.goto('/');
    await page.getByRole('link', { name: 'Admin Dashboard' }).click();
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByText('Unit 1', { exact: true }).click();
    const section = page.getByRole('region', { name: 'Conjugation' });
    await section.getByRole('checkbox', { name: 'Include vosotros' }).check();
    await expect(section.getByText('Unsaved changes. Students play the saved settings.')).toBeVisible();
    // The guard's entry stands in front of the page.
    await expect.poll(async () => (await hist(page)).guard).toBe(true);
    return { section, dialogs, answer: (yes: boolean) => { answer = yes; } };
  }

  const LEAVE = 'Leave without saving? Your unsaved Conjugation changes will be lost.';

  test('Back to Study steps over the guard entry: Back returns to Admin, then to the page before it', async ({ page }) => {
    const { dialogs, answer } = await editDraft(page);
    const inAdmin = await hist(page);
    answer(true);
    await page.getByRole('link', { name: /Back to Study/ }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(dialogs).toEqual([LEAVE]);
    // The guard's entry was taken off before the study page was pushed in its place.
    expect((await hist(page)).length).toBe(inAdmin.length);

    await page.goBack();
    await expect(page).toHaveURL(/\/admin$/);
    expect(await hist(page)).toMatchObject({ path: '/admin', guard: false });
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Admin Dashboard' })).toBeVisible();
    expect(dialogs).toEqual([LEAVE]);
  });

  test('the skip link moves focus to the page without a history entry, so the draft is not questioned', async ({ page }) => {
    const { dialogs } = await editDraft(page);
    const before = await hist(page);
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await hist(page)).toEqual(before);
    expect(dialogs).toEqual([]);

    // Back still asks, once.
    await page.goBack({ timeout: 2000 }).catch(() => {});
    await expect.poll(() => dialogs).toEqual([LEAVE]);
    await expect(page.getByRole('region', { name: 'Conjugation' })).toBeVisible();
  });

  test('a failed Sign out keeps the page guarded: Back asks again', async ({ page }) => {
    const { section, dialogs, answer } = await editDraft(page, {
      'auth.logout': () => { throw new TrpcMockError('Server unavailable', 'INTERNAL_SERVER_ERROR', 500); },
    });
    answer(true);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => dialogs).toEqual([LEAVE]);
    // Still in Admin with the draft, and the guard's entry stands again.
    await expect.poll(async () => (await hist(page)).guard).toBe(true);
    await expect(section.getByText('Unsaved changes. Students play the saved settings.')).toBeVisible();

    answer(false);
    await page.goBack({ timeout: 2000 }).catch(() => {});
    await expect.poll(() => dialogs).toEqual([LEAVE, LEAVE]);
    await expect(section.getByText('Unsaved changes. Students play the saved settings.')).toBeVisible();
    expect(await hist(page)).toMatchObject({ path: '/admin', guard: true });
  });
});

test.describe('sentences with a blank (v1.25.0)', () => {
  const sentence = (before: string, after: string, cue: string, hint: string | null, glosses: { es: string; en: string }[] = []) => ({ before, after, cue, hint, glosses });
  // Multiple choice, with the pronoun hint; then typed, with none.
  const S0 = toForm(0, 2, 'choice', {
    entryLabel: 'vivir', tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null,
    options: ['vive', 'viven', 'vivimos', 'vives'],
    sentence: sentence('Mis primos', 'en Lima.', 'vivir', 'ellos', [{ es: 'mis', en: 'my' }, { es: 'primos', en: 'cousin' }]),
  });
  const S1 = toForm(1, 2, 'typed-lenient', {
    entryLabel: 'llamarse', tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null,
    sentence: sentence('Mi prima', 'Ana.', 'llamarse', null, [{ es: 'mi', en: 'my' }, { es: 'prima', en: 'cousin' }]),
  });
  const FEEDBACK = {
    0: verdict({
      result: 'wrong', counted: false, correctAnswer: 'viven', rightOptions: ['viven'], levelKindAfter: 'choice', levelAfter: 0, total: 2, next: S1,
      mistake: { kind: 'person', detail: { person: 'el' }, guideSection: 'persons-glance', guideSections: ['persons-glance'] },
      sharedBy: { form: 'viven', person: 'ellos', persons: ['ellos'], subjects: ['ellos', 'ellas', 'ustedes'] },
      sentence: {
        filled: 'Mis primos viven en Lima.', english: 'My cousins live in Lima.',
        subject: { es: 'mis primos', pronoun: 'ellos', person: 'ellos', kind: 'np_pl', form: 'viven' },
      },
    }),
    1: verdict({
      correctAnswer: 'se llama', levelBefore: 1, levelAfter: 2, levelKindAfter: 'typed-strict', total: 2, finished: true, summary: SUMMARY,
      sentence: {
        filled: 'Mi prima se llama Ana.', english: 'My cousin’s name is Ana.',
        subject: { es: 'mi prima', pronoun: 'ella', person: 'el', kind: 'np_sg', form: 'se llama' },
      },
    }),
  } as Record<number, Prompt>;

  test('a student fills the blank: the hint at multiple choice, live fill-in, Word help, the sentence and its English after, a report, and the guide on who', async ({ page }) => {
    const reports: unknown[] = [];
    const answers: { index: number; answer: Record<string, string> }[] = [];
    await mockAuthenticatedTrpc(page, {
      decks: [unit1],
      conjugationQuizzes: [{ deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: null }],
      queries: { 'conjugation.overview': { ...overview, openRound: null, sentenceSeen: false, subjectsMet: [] } },
      mutations: {
        'conjugation.start': () => ({ roundId: 50, deckName: 'Unit 1', total: 2, review: false, levels: overview.levels, prompt: S0 }),
        'conjugation.answer': (input: unknown) => {
          const sent = input as { index: number; answer: Record<string, string> };
          answers.push({ index: sent.index, answer: sent.answer });
          return FEEDBACK[sent.index];
        },
        'conjugation.reportSentence': (input: unknown) => {
          reports.push(input);
          return { reported: true };
        },
        'conjugation.finish': () => SUMMARY,
      },
    });
    await page.goto('/conjugation/1');
    await page.getByRole('button', { name: 'Start a round' }).click();

    // The sentence, read with "blank" for its blank; the hint in grey at multiple choice.
    const card = page.getByRole('group', { name: 'Mis primos (ellos) blank (vivir) en Lima.' });
    await expect(card).toBeVisible();
    await expect(page.getByText('Pick the verb that fills the blank.')).toBeVisible();
    await expect(card.locator('#conj-prompt-0')).toHaveAttribute('lang', 'es');
    // Word help: one button, the meanings from the cards.
    await page.getByRole('button', { name: 'Word help' }).click();
    await expect(page.getByText('cousin')).toBeVisible();

    await page.keyboard.press('1');
    const feedback = page.getByRole('status').filter({ hasText: /Correct|Not quite/ });
    await expect(feedback).toContainText('Not quite. The answer: viven');
    await expect(feedback).toContainText('Mis primos viven en Lima.');
    await expect(feedback).toContainText('My cousins live in Lima.');
    await expect(feedback).toContainText('mis primos = ellos → viven');
    await expect(feedback).toContainText('Mis primos is plural, so the verb needs its -n form.');
    expect(answers).toEqual([{ index: 0, answer: { choice: 'vive' } }]);

    await page.getByRole('button', { name: 'Something’s wrong with this sentence' }).click();
    await expect(page.getByText('Thank you. Your teacher will look at this sentence.')).toBeVisible();
    await expect.poll(() => reports).toEqual([{ roundId: 50, index: 0 }]);

    // Answered: a mistake about who leads to "Who is the subject?", open now, with the subject just met.
    await feedback.getByRole('button', { name: 'Why? See the guide.' }).click();
    const dialog = page.getByRole('dialog', { name: 'Intro to conjugation' });
    await expect(dialog.getByRole('heading', { level: 4, name: /Who is the subject\?/ })).toBeFocused();
    await expect(dialog.getByRole('rowheader', { name: 'mis primos' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Typed: no hint, the blank fills in as the student types, and the box keeps its name.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Type the verb that fills the blank.')).toBeVisible();
    const box = page.getByRole('textbox', { name: 'Your answer Mi prima blank (llamarse) Ana.' });
    await expect(box).toBeFocused();
    await box.pressSequentially('se llama');
    await expect(page.locator('#conj-prompt-1 [aria-hidden="true"]')).toHaveText('se llama');
    await expect(page.getByRole('textbox', { name: 'Your answer Mi prima blank (llamarse) Ana.' })).toHaveValue('se llama');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('✓ Correct!');
    await expect(feedback).toContainText('Mi prima se llama Ana.');
    expect(answers.at(-1)).toEqual({ index: 1, answer: { text: 'se llama' } });
  });

  test('a teacher turns sentences on, sees the coverage, hides one and previews it at each rung', async ({ page }) => {
    const unit1Admin = { id: 1, name: 'Unit 1', description: null, cardCount: 30, reversible: false };
    let view: Record<string, unknown> = { ...conjugationSettingsView(1, 'Unit 1', 30), effective: ['vivir'], verbCount: 1, itemCount: 10, entries: [] };
    const saves: Record<string, unknown>[] = [];
    const hides: unknown[] = [];
    const previews: Record<string, unknown>[] = [];
    let hidden = false;
    const row = (ref: string, before: string, after: string, english: string) => ({
      ref, source: 'builtIn', before, form: 'viven', after, cue: 'vivir', english, subjectKind: 'np_pl', warnings: [], status: null,
    });
    await mockAdminTrpc(page, {
      decks: [unit1Admin],
      queries: {
        'conjugation.settings': () => view,
        'conjugation.sentences.panel': () => conjugationSentencesPanel(1, {
          mode: (view.settings as { sentences: string }).sentences,
          coverage: { cells: 5, covered: 4, label: 1 },
          verbs: [{ entry: 'vivir', label: 'vivir', kind: 'plain', cells: 5, covered: 4, sentences: 30, hidden: hidden ? 1 : 0 }],
        }),
        'conjugation.sentences.list': () => ({
          deckId: 1, entry: 'vivir', label: 'vivir', mode: 'builtIn',
          cells: [{
            tense: 'present', tenseLabel: 'presente', person: 'ellos', personLabel: 'ellos/ellas/Uds.', number: null, parked: [],
            sentences: [{ ...row('tpl:a', 'Mis primos', 'en Lima.', 'My cousins live in Lima.'), hidden, used: !hidden }],
          }],
        }),
        'conjugation.sentences.preview': (input: unknown) => {
          previews.push(input as Record<string, unknown>);
          const level = (input as { level: string }).level;
          return {
            levels: ['choice', 'typed-lenient', 'typed-strict'],
            prompt: toForm(0, 1, level, {
              entryLabel: 'vivir', tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null, entryHint: null, optionsVerb: null,
              options: level === 'choice' ? ['vive', 'viven', 'vivimos', 'vives'] : null,
              sentence: sentence('Mis primos', 'en Lima.', 'vivir', level === 'choice' ? 'ellos' : null),
            }),
            answer: 'viven', filled: 'Mis primos viven en Lima.', english: 'My cousins live in Lima.', hint: 'ellos',
          };
        },
      },
      mutations: {
        'conjugation.saveSettings': (input: unknown) => {
          const settings = { ...(input as Record<string, unknown>) };
          delete settings.deckId;
          saves.push(input as Record<string, unknown>);
          view = { ...view, settings: { ...(view.settings as object), ...settings }, sentencesSince: new Date().toISOString() };
          return view;
        },
        'conjugation.sentences.hide': (input: unknown) => {
          hides.push(input);
          hidden = (input as { hidden: boolean }).hidden;
          return input;
        },
      },
    });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Decks' }).click();
    await page.getByText('Unit 1', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Sentences' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('4 of 5 forms have a sentence; 1 uses the label.');
    await expect(panel).toContainText('(with built-in sentences, once you turn them on)');

    await panel.getByLabel('How questions show who').selectOption('builtIn');
    await expect(panel.getByText('Saved when you press Save.')).toBeVisible();
    await page.getByRole('region', { name: 'Conjugation' }).getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saves.at(-1)).toMatchObject({ deckId: 1, sentences: 'builtIn', sentenceHoldback: false });
    await expect(panel.getByText('(with built-in sentences, once you turn them on)')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Show sentences: vivir' }).click();
    const item = panel.getByRole('listitem').filter({ hasText: 'My cousins live in Lima.' }).last();
    await expect(item.locator('mark')).toHaveText('viven');
    await item.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect.poll(() => hides).toEqual([{ deckId: 1, ref: 'tpl:a', hidden: true }]);
    await expect(item).toContainText('hidden');
    await expect(item.getByRole('button', { name: 'Show again' })).toBeVisible();

    await item.getByRole('button', { name: 'Preview as a student' }).click();
    await expect(item.getByText('(ellos)')).toBeVisible();
    await expect(item.getByRole('list', { name: 'Options' })).toContainText('viven');
    await item.getByRole('button', { name: 'Typed · accents count' }).click();
    await expect(item.getByText('The student types the form; accents count.')).toBeVisible();
    await expect(item.getByText('(ellos)')).toHaveCount(0);
    await expect.poll(() => previews.at(-1)).toMatchObject({ deckId: 1, entry: 'vivir', tense: 'present', person: 'ellos', ref: 'tpl:a', level: 'typed-strict' });
  });
});
