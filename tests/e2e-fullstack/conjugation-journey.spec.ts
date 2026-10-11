// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A class's first conjugation quiz, end to end on the real server: the
 * teacher sets it up in the Admin UI, a student plays a round the server
 * grades, and the teacher reads the results. One story, told in order.
 */
import { test, expect, type Page } from '@playwright/test';
import { STUDENT_EMAIL_PATTERN, TEACHER, type Person } from './env';
import { signIn } from './support/auth';
import { ConjugationStudent, describeAnswers, type Answered, type Drill } from './support/conjugation';
import { deckCsv, rosterCsv, TeacherApi } from './support/seed';

test.describe.configure({ mode: 'serial' });

const ANA: Person = { email: '12345@students.school.test', name: 'Ana López' };
const DECK = 'Unidad 1';
const GROUP = 'Period 3';

/** Unit 1's cards: conjugated forms, the way the course's decks hold verbs, and two nouns. */
const CARDS: [string, string][] = [
  ['tengo', 'I have'],
  ['tienes', 'you have'],
  ['hablo', 'I speak'],
  ['hablas', 'you speak'],
  ['vivo', 'I live'],
  ['soy', 'I am'],
  ['eres', 'you are'],
  ['me llamo', 'my name is'],
  ['el libro', 'the book'],
  ['la casa', 'the house'],
];

/** What the teacher's defaults drill from those cards: five verbs, the present, no vosotros or vos. */
const DRILL: Drill = {
  entries: ['tener', 'hablar', 'vivir', 'ser', 'llamarse'],
  tense: 'present',
  tenseLabel: 'presente',
  persons: ['yo', 'tu', 'el', 'nosotros', 'ellos'],
};
/** 5 verbs × 5 persons × 2 directions. */
const ITEMS = 50;
const ROUND = 6;

/** The first-try questions (from 0) the student misses on purpose in the first round. */
const MISS_AT = new Set([1, 3]);
let missed: Answered[] = [];

/** A regex matching exactly this text ("tiene", not "tienen"). */
const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Admin → Decks → the deck; its Conjugation section. */
async function openDeckInAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Decks', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${DECK}`) }).click();
  return page.getByRole('region', { name: 'Conjugation' });
}

/** Plays prompts until the round's results: misses the first-try questions in `missAt`, gets every retry right. */
async function playRest(
  page: Page,
  student: ConjugationStudent,
  opts: { missAt: Set<number>; firstTry: number; onFirstTry?: (n: number) => Promise<void> },
): Promise<Answered[]> {
  const answers: Answered[] = [];
  let firstTry = opts.firstTry;
  for (;;) {
    await expect(student.card()).toBeVisible();
    const retry = (await student.card().getByText('Second try').count()) > 0;
    if (!retry) await opts.onFirstTry?.(firstTry);
    const answered = await student.answer(retry || !opts.missAt.has(firstTry));
    answers.push(answered);
    if (!retry) firstTry += 1;
    if ((await student.next()) === 'results') return answers;
    // The verdict goes with the answered prompt: gone once the next one is up.
    await expect(page.getByRole('status').filter({ hasText: /Correct|Not quite|Almost/ })).toHaveCount(0);
  }
}

test('the teacher lets the class in, builds a deck from a CSV and turns on its conjugation quiz', async ({ page }) => {
  await signIn(page, TEACHER);
  await page.getByRole('link', { name: 'Admin Dashboard' }).click();

  // Access: a school's student addresses may sign in.
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await page.getByPlaceholder('user@example.com').fill(STUDENT_EMAIL_PATTERN);
  await page.getByRole('checkbox', { name: /Use as regular expression/i }).check();
  await page.getByRole('button', { name: 'Add Email/Pattern' }).click();
  await expect(page.getByText(STUDENT_EMAIL_PATTERN, { exact: true })).toBeVisible();

  // Groups: the class roster, imported from a Classroom CSV.
  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Classroom' }).click();
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await page.getByPlaceholder('Group name').fill(GROUP);
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({
    name: 'period-3.csv', mimeType: 'text/csv', buffer: Buffer.from(rosterCsv([ANA])),
  });
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText(`Created "${GROUP}". Parsed 1 students, assigned 1 users.`)).toBeVisible();
  await expect(page.getByText(ANA.email)).toBeVisible();

  // Decks: a new deck, its cards from a CSV, assigned to the class.
  await page.getByRole('button', { name: 'Decks', exact: true }).click();
  await page.getByRole('button', { name: '+ New Deck' }).click();
  await page.getByPlaceholder('Deck name').fill(DECK);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${DECK}`) }).click();
  await page.locator('#csv-upload').setInputFiles({
    name: 'unidad-1.csv', mimeType: 'text/csv', buffer: Buffer.from(deckCsv(CARDS)),
  });
  await expect(page.getByText(`Successfully added ${CARDS.length} cards`)).toBeVisible();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Assign to group...' }) })
    .selectOption({ label: GROUP });
  await expect(page.getByText('Not assigned to any groups')).toHaveCount(0);

  // Conjugation: the engine found the deck's verbs in its cards; the quiz goes on, six questions a round.
  const section = page.getByRole('region', { name: 'Conjugation' });
  await expect(section.getByText(`${DRILL.entries.length} verbs · ${ITEMS} items`)).toBeVisible();
  for (const verb of DRILL.entries) {
    await expect(section.getByRole('checkbox', { name: verb, exact: true })).toBeChecked();
  }
  const llamarse = section.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'llamarse', exact: true }) });
  await expect(llamarse.getByText('reflexive', { exact: true })).toBeVisible();
  await expect(llamarse).toContainText('me llamo — my name is');

  const toggle = section.getByRole('switch', { name: 'Students can practice it' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await section.getByLabel('Questions per round').fill(String(ROUND));
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  // Saved on the server: a fresh load shows it on.
  const reloaded = await openDeckInAdmin(page);
  await expect(reloaded.getByRole('switch', { name: 'Students can practice it' })).toHaveAttribute('aria-checked', 'true');
  await expect(reloaded.getByLabel('Questions per round')).toHaveValue(String(ROUND));
});

test('a student plays a round the server grades: right and wrong answers, the guide held then open, the score', async ({ page }) => {
  await signIn(page, ANA);

  const link = page.getByRole('link', { name: `${DECK} conjugation` });
  await expect(link).toContainText(`0 / ${ITEMS} mastered`);
  await link.click();
  await expect(page.getByRole('heading', { name: `${DECK} conjugation` })).toBeVisible();
  await expect(page.getByText(DRILL.tenseLabel, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start a round' }).click();

  const student = new ConjugationStudent(page, DRILL);
  await expect(student.card()).toBeVisible();
  await expect(page.getByText(`1 / ${ROUND}`)).toBeVisible();
  // A new student starts every verb on the first rung.
  await expect(student.card().getByText('Multiple choice')).toBeVisible();

  // While a question waits, the guide is held: pressing it says when it opens.
  const guideButton = page.getByRole('button', { name: 'Guide', exact: true }).first();
  await expect(guideButton).toHaveAttribute('aria-disabled', 'true');
  await guideButton.click({ force: true });
  await expect(page.getByText('You can open the guide once you answer this question.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const answers = [await student.answer(true)];

  // Answered: the guide opens at the tense asked, and closes back onto the round.
  await expect(page.getByText('You can open the guide once you answer this question.')).toHaveCount(0);
  await expect(guideButton).not.toHaveAttribute('aria-disabled', 'true');
  await student.card().getByRole('button', { name: new RegExp(DRILL.tenseLabel) }).click();
  const guide = page.getByRole('dialog', { name: 'Intro to conjugation' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { level: 3 })).toContainText(/present/i);
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(page.getByText(`1 / ${ROUND}`)).toBeVisible();
  await student.next();

  answers.push(...await playRest(page, student, {
    missAt: MISS_AT,
    firstTry: 1,
    // Mid-round, a reload: the server kept the round, and it continues at the same question.
    onFirstTry: async (n) => {
      if (n !== 2) return;
      const before = await student.title();
      await page.reload();
      await expect(page.getByText(/You have a round in progress: question 3 of \d+\./)).toBeVisible();
      await page.getByRole('button', { name: 'Continue the round' }).click();
      await expect(student.card()).toBeVisible();
      expect(await student.title()).toBe(before);
    },
  }));

  test.info().annotations.push({ type: 'round', description: describeAnswers(answers) });
  // Six questions, and the two misses asked again at the end.
  missed = answers.filter((a) => !a.correct);
  expect(answers).toHaveLength(ROUND + MISS_AT.size);
  expect(missed).toHaveLength(MISS_AT.size);
  expect(answers.filter((a) => a.retry).every((a) => a.correct)).toBe(true);

  // The score: the share right the first time.
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  const right = ROUND - MISS_AT.size;
  await expect(page.getByText(`${Math.round((right / ROUND) * 100)}%`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${right} of ${ROUND} right the first time`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Another round' })).toBeVisible();
});

test('the teacher sees the student’s round in the conjugation Results', async ({ page }) => {
  expect(missed, 'the student’s round ran first').toHaveLength(MISS_AT.size);
  await signIn(page, TEACHER);
  const section = await openDeckInAdmin(page);
  await section.getByRole('button', { name: 'Results' }).click();

  const score = `${Math.round(((ROUND - MISS_AT.size) / ROUND) * 100)}%`;
  const row = section.getByRole('table').getByRole('row', { name: new RegExp(ANA.name) });
  await expect(row).toContainText(ANA.email);
  // Rounds, last score, best score, mastered, days practised (these two weeks, then in all),
  // delayed accuracy (none yet: nothing has come back for review), median answer time, last played.
  await expect(row.getByRole('cell')).toHaveText([
    /^1$/, score, score, new RegExp(`^\\d+ / ${ITEMS}`), /^11 in all$/, /^—$/, /^\d+(\.\d)? s choice$/, /\S/,
  ]);

  // What kind of mistake each miss was.
  await expect(section.getByRole('list', { name: 'Common mistakes' }).getByRole('listitem')).not.toHaveCount(0);

  // Each miss, once missed and once answered right on the second try.
  await expect(section.getByRole('heading', { name: 'Most missed' })).toBeVisible();
  const items = section.getByRole('list', { name: 'Most missed' }).getByRole('listitem');
  await expect(items).toHaveCount(missed.length);
  for (const miss of missed) {
    const item = items.filter({ has: page.locator('span[lang="es"]', { hasText: exactly(miss.form) }) });
    await expect(item).toContainText(miss.direction === 'toForm' ? 'infinitive → form' : 'form → verb');
    await expect(item).toContainText('missed 1 of 2');
  }
});

test('with typed answers on, the student types every form and the server grades what was typed', async ({ page }) => {
  const teacher = await TeacherApi.signIn();
  try {
    await teacher.mutate('conjugation.saveSettings', { deckId: await teacher.deckId(DECK), answerMode: 'typed' });
  } finally {
    await teacher.dispose();
  }

  await signIn(page, ANA);
  await page.getByRole('link', { name: `${DECK} conjugation` }).click();
  await expect(page.getByText(/Last round: \d+%/)).toBeVisible();
  await page.getByRole('button', { name: 'Start a round' }).click();

  const student = new ConjugationStudent(page, DRILL);
  const answers = await playRest(page, student, { missAt: new Set([0]), firstTry: 0 });
  test.info().annotations.push({ type: 'round', description: describeAnswers(answers) });
  // Naming the verb stays multiple choice (typing it trained recalling the infinitive): every typed question is a form.
  expect(answers.filter((a) => a.direction === 'toForm').every((a) => a.kind === 'typed')).toBe(true);
  expect(answers.filter((a) => a.direction === 'fromForm').every((a) => a.kind === 'choice')).toBe(true);
  expect(answers.some((a) => a.kind === 'typed')).toBe(true);
  expect(answers).toHaveLength(ROUND + 1);

  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await expect(page.getByText(`${ROUND - 1} of ${ROUND} right the first time`)).toBeVisible();
});

/** Answers of the round whose times were rewritten on the way to the server. */
let edited = 0;

test('an answer time rewritten on its way to the server is kept as the page sent it', async ({ page }) => {
  await signIn(page, ANA);
  // What a console script that edits requests does: every answer claims a minute.
  await page.route((url) => url.pathname.includes('conjugation.answer'), async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, Record<string, unknown> | undefined>;
    for (const slot of Object.values(body)) {
      const input = (slot && 'json' in slot ? slot.json : slot) as Record<string, unknown> | undefined;
      if (input && 'roundId' in input && 'answer' in input) {
        input.ms = 60_000;
        edited += 1;
      }
    }
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.getByRole('link', { name: `${DECK} conjugation` }).click();
  await page.getByRole('button', { name: 'Start a round' }).click();

  const student = new ConjugationStudent(page, DRILL);
  const answers = await playRest(page, student, { missAt: new Set(), firstTry: 0 });
  test.info().annotations.push({ type: 'round', description: describeAnswers(answers) });
  expect(answers).toHaveLength(ROUND);
  expect(edited).toBe(ROUND);
  // The student sees nothing of it: no clock, the round as always.
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await expect(page.getByText(`${ROUND} of ${ROUND} right the first time`)).toBeVisible();
});

test('the teacher sees the time that passed, not the minute each answer claimed, and how many did not match', async ({ page }) => {
  expect(edited, 'the rewritten round ran first').toBe(ROUND);
  await signIn(page, TEACHER);
  const section = await openDeckInAdmin(page);
  await section.getByRole('button', { name: 'Results' }).click();

  const row = section.getByRole('table').getByRole('row', { name: new RegExp(ANA.name) });
  // Rounds: the three played to their end.
  await expect(row.getByRole('cell').first()).toHaveText('3');
  // Median time: never more than the time that passed between answers (seconds here, not 60.0).
  const time = row.getByRole('cell').nth(6);
  await expect(time).toContainText(/\d+(\.\d)? s typed/);
  await expect(time).not.toContainText('60.0 s');
  // Honest answers never claim more time than passed: the count is exactly the rewritten round's.
  await expect(time).toContainText(`${ROUND} answer times didn’t match the time that passed`);
  await expect(section.getByText(/which only an edited request can do/)).toBeVisible();
});

// v1.18.0: "Study all", one round over every quiz the student may play (here the class's one deck).
let studyAllPrompts = 0;

test('a student plays a “Study all” round from the dashboard, each question naming its quiz', async ({ page }) => {
  await signIn(page, ANA);
  await page.getByRole('link', { name: 'Study all conjugation' }).click();
  await expect(page).toHaveURL(/\/conjugation\/all$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Study all conjugation' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: `${DECK} conjugation` })).toBeVisible();
  await page.getByRole('button', { name: 'Start a round' }).click();

  const student = new ConjugationStudent(page, DRILL);
  await expect(student.card().getByText(`${DECK} conjugation`, { exact: true })).toBeVisible();
  const answers = await playRest(page, student, { missAt: new Set(), firstTry: 0 });
  test.info().annotations.push({ type: 'round', description: describeAnswers(answers) });
  // Up to 20 questions, one direction per form: the deck has 25 forms.
  expect(answers.length).toBeGreaterThan(0);
  expect(answers.length).toBeLessThanOrEqual(20);
  studyAllPrompts = answers.length;
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await expect(page.getByText(`${answers.length} of ${answers.length} right the first time`)).toBeVisible();
  // The summary lists each quiz the round asked forms of.
  await expect(page.getByRole('heading', { level: 3, name: `${DECK} conjugation` })).toBeVisible();
});

test('the teacher sees the “Study all” round under the deck, apart from the deck’s own rounds', async ({ page }) => {
  expect(studyAllPrompts, 'the Study all round ran first').toBeGreaterThan(0);
  await signIn(page, TEACHER);
  const section = await openDeckInAdmin(page);
  await section.getByRole('button', { name: 'Results' }).click();
  const row = section.getByRole('table').getByRole('row', { name: new RegExp(ANA.name) });
  const rounds = row.getByRole('cell').first();
  await expect(rounds).toContainText('3');
  await expect(rounds).toContainText('+1 in Study all');
  await expect(section.getByText(/In Study all: rounds mixing all of the student’s quizzes/)).toBeVisible();
});

// v1.25.0: sentences with a blank. The deck still asks typed answers (set above).
let sentenceAnswers: Answered[] = [];

test('the teacher turns built-in sentences on in the Sentences panel, with the coverage of the deck', async ({ page }) => {
  await signIn(page, TEACHER);
  const section = await openDeckInAdmin(page);
  const panel = section.getByRole('region', { name: 'Sentences' });
  // Off: what Built-in would give, before it is on.
  await expect(panel).toContainText(/\d+ of 25 forms have a sentence; \d+ uses? the label\./);
  await expect(panel).toContainText('(with built-in sentences, once you turn them on)');
  await panel.getByLabel('How questions show who').selectOption('builtIn');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByText('Saved.')).toBeVisible();
  await expect(panel).toContainText(/On since/);
  // A verb's sentences, filled in, with their English.
  await panel.getByRole('button', { name: 'Show sentences: vivir' }).click();
  await expect(panel.locator('mark').first()).toBeVisible();
});

test('with sentences on, the student fills the blanks: echoes graded by the blank, the sentence filled in after, and a report', async ({ page }) => {
  await signIn(page, ANA);
  await page.getByRole('link', { name: `${DECK} conjugation` }).click();
  await page.getByRole('button', { name: 'Start a round' }).click();
  const student = new ConjugationStudent(page, DRILL);
  let reported = false;
  const answers: Answered[] = [];
  let firstTry = 0;
  for (;;) {
    await expect(student.card()).toBeVisible();
    const retry = (await student.card().getByText('Second try').count()) > 0;
    const answered = await student.answer(retry || firstTry !== 0);
    answers.push(answered);
    if (!retry) firstTry += 1;
    // The first sentence answered: the student says something is wrong with it (it only reaches the teacher).
    if (answered.sentence && !reported) {
      await student.card().getByRole('button', { name: 'Something’s wrong with this sentence' }).click();
      await expect(page.getByText('Thank you. Your teacher will look at this sentence.')).toBeVisible();
      reported = true;
    }
    if ((await student.next()) === 'results') break;
  }
  test.info().annotations.push({ type: 'round', description: describeAnswers(answers) });
  sentenceAnswers = answers;
  // Every "give the form" question the deck has a sentence for is one: the deck's verbs all have frames.
  expect(answers.filter((a) => a.direction === 'toForm').every((a) => !!a.sentence)).toBe(true);
  expect(reported).toBe(true);
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
});

test('the teacher sees the report in the Sentences panel, and the missed sentence in the Results', async ({ page }) => {
  expect(sentenceAnswers.length, 'the sentence round ran first').toBeGreaterThan(0);
  await signIn(page, TEACHER);
  const section = await openDeckInAdmin(page);
  const panel = section.getByRole('region', { name: 'Sentences' });
  const reports = panel.getByRole('heading', { name: 'Reported by students' }).locator('..');
  await expect(reports).toContainText('1 report');
  await expect(reports).toContainText('___');
  await reports.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByRole('heading', { name: 'Reported by students' })).toHaveCount(0);

  await section.getByRole('button', { name: 'Results' }).click();
  await expect(section).toContainText(/Sentences on since/);
  const missedSentence = sentenceAnswers.find((a) => !a.correct && !a.retry && a.sentence);
  if (missedSentence?.sentence) {
    // One form can be missed both ways (form → verb and infinitive → form), each its own item: the
    // sentence is on the one the "give the form" question missed.
    const item = section.getByRole('list', { name: 'Most missed' }).getByRole('listitem')
      .filter({ has: page.locator('span[lang="es"]', { hasText: exactly(missedSentence.form) }) })
      .filter({ hasText: `${missedSentence.sentence.before} ${missedSentence.form}` });
    await expect(item).toHaveCount(1);
  }
  if (sentenceAnswers.some((a) => a.sentence)) {
    await expect(section.getByRole('heading', { name: 'Person mistakes by subject' })).toBeVisible();
  }
});
