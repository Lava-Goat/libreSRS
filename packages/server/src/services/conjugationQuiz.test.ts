// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { analyze, foldAccents, type DeckCard } from '@libresrs/shared/conjugation';
import {
  ACCENT_MODES,
  ANSWER_MODES,
  DEFAULT_SETTINGS,
  AnswerShapeError,
  advance,
  buildPrompt,
  canonicalEntryId,
  clampLevel,
  clientPrompt,
  countsCorrect,
  deckView,
  describeEntries,
  describeItem,
  detectDeckVerbs,
  dueCount,
  dueEntries,
  effectiveEntries,
  formsOf,
  gradeAnswer,
  isDue,
  isMastered,
  itemKey,
  itemLadder,
  itemsFor,
  ladder,
  nextLevel,
  parseItemKey,
  parseSettings,
  pickSubject,
  planAllRound,
  planRound,
  previewEntry,
  readingLabel,
  requeue,
  roundScore,
  responseMs,
  reviewThrough,
  schoolDay,
  schoolDaysUntil,
  seededRandom,
  settingsToRow,
  sharedByOf,
  turnsInRound,
  snapshotOf,
  STUDY_ALL_LENGTH,
  startLevel,
  startOfSchoolDay,
  startingState,
  warmConjugationEngine,
  withoutCue,
  type Item,
  type LevelKind,
  type PlanDeck,
  type ProgressState,
  type QueueEntry,
  type QuizSettings,
  type TwinRow,
  type SentenceTurn,
  sentenceModeOf,
} from './conjugationQuiz.js';
import { cellPool } from './conjugationSentences.js';

function deck(list: string): DeckCard[] {
  return list.split('; ').map((pair, i) => {
    const [front, back] = pair.split(' | ');
    return { id: i + 1, front, back };
  });
}

/** The verb cards of a sample "Unit 1" deck, with a few non-verbs. */
const UNIT1 = deck(
  'es | he/she/it is (ser); soy | I am (ser); eres | you are (ser); son | they are (ser); hay | there is / there are; ' +
    'está | is (location/feeling); estoy | I am (location/feeling); tiene | has; tengo | I have; tienes | you have; ' +
    'se llama | is named; me llamo | my name is; quiere | wants; quiero | I want; va | goes; voy | I go; ' +
    'le gusta | he/she likes; me gusta | I like; te gusta | you like; se ve | looks, appears; vive | lives; vivo | I live; ' +
    'bajo / baja | short (height); pelo | hair; nombre | name; escuela | school; hola | hello',
);
const UNIT1_ENTRIES = ['ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'];

const settingsWith = (over: Partial<QuizSettings> = {}): QuizSettings => ({ ...parseSettings(null), enabled: true, ...over });

const item = (entry: string, tense: Item['tense'], person: Item['person'], direction: Item['direction'], number?: 'sg' | 'pl'): Item => {
  const fields = { entry, tense, person, ...(number ? { number } : {}), direction };
  return { key: itemKey(fields), ...fields };
};

/**
 * A prompt built at a rung of the ladder, as the round would hold it. A "name
 * the verb" prompt at a typed rung no longer gets built (its ladder is
 * multiple choice only); a v1.12 round still open when v1.13 went live holds
 * one, and it is graded as before, so the tests build it the v1.12 way.
 */
function built(it: Item, settings: QuizSettings, levelKind: LevelKind, entries = [it.entry], seed = 1): { entry: QueueEntry; snap: ReturnType<typeof snapshotOf> } {
  const snap = snapshotOf(settings, entries);
  if (it.direction === 'from' && levelKind !== 'choice') {
    const level = snap.steps.indexOf(levelKind);
    expect(level).toBeGreaterThanOrEqual(0);
    const prompt = { ...buildPrompt(it, 0, snap, seededRandom(seed)), level, levelKind };
    delete prompt.options;
    delete prompt.correctOptions;
    return { entry: { ...it, built: prompt }, snap };
  }
  const level = itemLadder(settings, it.direction).indexOf(levelKind);
  expect(level).toBeGreaterThanOrEqual(0);
  return { entry: { ...it, built: buildPrompt(it, level, snap, seededRandom(seed)) }, snap };
}

describe('settings', () => {
  it('defaults to present only, no vosotros or vos, both directions, progressive answers and accents, 20 a round, off', () => {
    expect(parseSettings(null)).toEqual({
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
      // v1.25.0: the label, until the teacher turns sentences on; no holdback.
      sentences: 'off',
      sentenceHoldback: false,
    });
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a stored row back as it was saved', () => {
    const settings = settingsWith({
      tenses: ['present', 'preterite'], includeVosotros: true, vos: 'centroamericano', directions: 'fromForm',
      answerMode: 'typed', accentMode: 'required', roundLength: 30, excludedEntries: ['ir'], extraEntries: ['hablar', 'gustarle'],
    });
    expect(parseSettings(settingsToRow(settings))).toEqual(settings);
  });

  it('falls back to the defaults for anything it cannot read, and keeps tenses in teaching order', () => {
    const row = {
      ...settingsToRow(settingsWith()),
      tenses: '["imperfect","nonsense","present","present"]',
      vos: 'andaluz',
      directions: 'sideways',
      answerMode: 'oral',
      accentMode: 'maybe',
      roundLength: 500,
      excludedEntries: 'not json',
      extraEntries: '["Hablar","banana","haber (hay)",7]',
    };
    expect(parseSettings(row)).toMatchObject({
      tenses: ['present', 'imperfect'],
      vos: 'none',
      directions: 'both',
      answerMode: 'progressive',
      accentMode: 'progressive',
      roundLength: 60,
      excludedEntries: [],
      extraEntries: ['hablar', 'haber-impersonal'],
    });
    expect(parseSettings({ ...row, tenses: '[]', roundLength: 1 })).toMatchObject({ tenses: ['present'], roundLength: 5 });
  });

  it('accepts as entries only Spanish infinitives, with -se or -le, and the impersonal ones', () => {
    expect(canonicalEntryId('Gustarle')).toBe('gustarle');
    expect(canonicalEntryId('levantarse')).toBe('levantarse');
    expect(canonicalEntryId('haber (hay)')).toBe('haber-impersonal');
    expect(canonicalEntryId('llover')).toBe('llover');
    expect(canonicalEntryId('oir')).toBe('oír');
    expect(canonicalEntryId('banana')).toBeNull();
    expect(canonicalEntryId('hablo')).toBeNull();
    expect(canonicalEntryId('x'.repeat(59) + 'ar')).toBeNull();
  });
});

describe('the verbs of a deck', () => {
  it('warms the engine up front (as the server does at boot), so the first deck is not the one to pay for it', () => {
    // First in the file to touch the engine: this call builds its tables.
    const first = warmConjugationEngine();
    expect(first.forms).toBeGreaterThan(60_000);
    expect(first.ms).toBeGreaterThanOrEqual(0);
    expect(warmConjugationEngine()).toMatchObject({ forms: first.forms });
    expect(warmConjugationEngine().ms).toBeLessThan(100);
    const start = performance.now();
    expect(detectDeckVerbs(deck('vivo | I live; tienes | you have')).map((d) => d.infinitive)).toEqual(['vivir', 'tener']);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('finds the Unit 1 entries keyed to how the deck uses them: gustarle, llamarse, verse and haber (hay)', () => {
    const detected = detectDeckVerbs(UNIT1);
    expect(detected.map((d) => d.infinitive)).toEqual(UNIT1_ENTRIES);
    expect(effectiveEntries(detected, settingsWith())).toEqual(UNIT1_ENTRIES);
    // The same list is remembered, not detected again.
    expect(detectDeckVerbs(UNIT1.map((c) => ({ ...c })))).toBe(detected);
  });

  it('leaves out what the teacher excluded and adds the teacher’s own, once', () => {
    const detected = detectDeckVerbs(UNIT1);
    const settings = settingsWith({ excludedEntries: ['ir', 'verse'], extraEntries: ['hablar', 'ser', 'llover'] });
    expect(effectiveEntries(detected, settings)).toEqual([
      'ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'gustarle', 'vivir', 'hablar', 'llover',
    ]);
    const views = describeEntries(detected, settings);
    expect(views.find((v) => v.entry === 'ir')).toMatchObject({ included: false, extra: false, kind: 'plain' });
    expect(views.find((v) => v.entry === 'gustarle')).toMatchObject({ included: true, kind: 'dative', label: 'gustarle' });
    expect(views.find((v) => v.entry === 'haber-impersonal')).toMatchObject({ kind: 'impersonal', label: 'haber (hay)' });
    expect(views.find((v) => v.entry === 'llamarse')?.cards.map((c) => c.front)).toEqual(['se llama', 'me llamo']);
    expect(views.filter((v) => v.extra).map((v) => v.entry)).toEqual(['hablar', 'llover']);
  });

  it('drills every cell of every entry in each direction: vosotros and vos only when the deck has them', () => {
    const entries = UNIT1_ENTRIES;
    const items = itemsFor(entries, settingsWith());
    // 8 personal entries × 5 persons + haber (hay) × 1 + gustarle × 5 persons × 2 numbers, both ways.
    expect(items).toHaveLength((8 * 5 + 1 + 10) * 2);
    expect(items.some((i) => i.person === 'vosotros' || i.person === 'vos')).toBe(false);
    expect(itemsFor(entries, settingsWith({ includeVosotros: true }))).toHaveLength((8 * 6 + 1 + 12) * 2);
    expect(itemsFor(entries, settingsWith({ directions: 'toForm' })).every((i) => i.direction === 'to')).toBe(true);
    expect(itemsFor(entries, settingsWith({ directions: 'fromForm' }))).toHaveLength(51);
    expect(itemsFor(['haber-impersonal'], settingsWith({ tenses: ['present', 'preterite', 'imperfect'] })).map((i) => i.key)).toEqual([
      'haber-impersonal|present|el|-|to', 'haber-impersonal|present|el|-|from',
      'haber-impersonal|preterite|el|-|to', 'haber-impersonal|preterite|el|-|from',
      'haber-impersonal|imperfect|el|-|to', 'haber-impersonal|imperfect|el|-|from',
    ]);
  });

  it('drills no progressive of estar ("estoy estando"), only of the verbs next to it', () => {
    const settings = settingsWith({ tenses: ['present', 'presentProgressive'] });
    // estar: 5 present cells, no progressive ones, both ways.
    expect(itemsFor(['estar'], settings)).toHaveLength(5 * 2);
    expect(itemsFor(['ser'], settings)).toHaveLength(10 * 2);
    expect(previewEntry('estar', settings).flatMap((c) => c.forms).join(' ')).not.toContain('estando');
    expect(previewEntry('ser', settings).find((c) => c.tense === 'presentProgressive' && c.person === 'yo')?.forms).toEqual(['estoy siendo']);
  });

  it('keys an item as entry|tense|person|number|direction, and reads the key back', () => {
    const it = item('gustarle', 'present', 'yo', 'to', 'pl');
    expect(it.key).toBe('gustarle|present|yo|pl|to');
    expect(parseItemKey(it.key)).toEqual(it);
    expect(parseItemKey('tener|present|yo|-|from')).toEqual(item('tener', 'present', 'yo', 'from'));
    expect(parseItemKey('tener|someday|yo|-|to')).toBeNull();
    expect(parseItemKey('tener|present|yo|-|up')).toBeNull();
    // The page gets a random id per prompt, never one derived from the key.
    const settings = settingsWith();
    const a = built(item('tener', 'present', 'yo', 'from'), settings, 'choice', ['tener'], 1);
    const b = built(item('tener', 'present', 'yo', 'from'), settings, 'choice', ['tener'], 2);
    expect(clientPrompt(a.entry, 0, 1, a.snap).itemKey).not.toBe(clientPrompt(b.entry, 0, 1, b.snap).itemKey);
  });
});

describe('vos', () => {
  it('adds vos cells, with the region’s forms, only when the deck has vos', () => {
    const none = itemsFor(['tener'], settingsWith());
    const rio = itemsFor(['tener'], settingsWith({ vos: 'rioplatense' }));
    expect(none.some((i) => i.person === 'vos')).toBe(false);
    expect(rio.filter((i) => i.person === 'vos').map((i) => i.key)).toEqual(['tener|present|vos|-|to', 'tener|present|vos|-|from']);
    expect(previewEntry('tener', settingsWith({ vos: 'rioplatense' })).find((c) => c.person === 'vos')).toMatchObject({
      personLabel: 'vos', forms: ['tenés'],
    });
    expect(previewEntry('gustarle', settingsWith({ vos: 'centroamericano' })).find((c) => c.person === 'vos')).toMatchObject({
      personLabel: 'a vos', forms: ['te gusta'],
    });
    expect(previewEntry('tener', settingsWith()).some((c) => c.person === 'vos')).toBe(false);
  });

  it('grades a vos prompt against the vos form and offers vos among the persons of a fromForm answer', () => {
    const settings = settingsWith({ vos: 'rioplatense', answerMode: 'typed' });
    const to = built(item('tener', 'present', 'vos', 'to'), settings, 'typed-strict');
    expect(clientPrompt(to.entry, 0, 1, to.snap).personLabel).toBe('vos');
    expect(gradeAnswer(to.entry, { text: 'tenés' }, to.snap).result).toBe('correct');
    expect(gradeAnswer(to.entry, { text: 'tienes' }, to.snap).result).toBe('wrong');
    const from = built(item('tener', 'present', 'vos', 'from'), settings, 'typed-lenient');
    expect(clientPrompt(from.entry, 0, 1, from.snap).personOptions?.map((p) => p.id)).toEqual(['yo', 'tu', 'vos', 'el', 'nosotros', 'ellos']);
    expect(gradeAnswer(from.entry, { text: 'tener', person: 'vos' }, from.snap).result).toBe('correct');
  });
});

describe('the level ladder', () => {
  const expected: Record<string, LevelKind[]> = {
    'progressive/progressive': ['choice', 'typed-lenient', 'typed-strict'],
    'progressive/forgiven': ['choice', 'typed-lenient'],
    'progressive/required': ['choice', 'typed-strict'],
    'choice/progressive': ['choice'],
    'choice/forgiven': ['choice'],
    'choice/required': ['choice'],
    'typed/progressive': ['typed-lenient', 'typed-strict'],
    'typed/forgiven': ['typed-lenient'],
    'typed/required': ['typed-strict'],
  };
  const DAY = 24 * 60 * 60 * 1000;
  const friday = Date.UTC(2026, 9, 2, 18); // Fri 2 Oct 2026, 11:00 in Los Angeles
  const at = (days: number) => ({ today: schoolDay(friday + days * DAY), now: friday + days * DAY });

  for (const answerMode of ANSWER_MODES) {
    for (const accentMode of ACCENT_MODES) {
      it(`${answerMode} answers, ${accentMode} accents: climbs a rung per right answer, masters at the top on a second school day, drops one per miss`, () => {
        const steps = ladder({ answerMode, accentMode });
        expect(steps).toEqual(expected[`${answerMode}/${accentMode}`]);
        const top = steps.length - 1;
        let state: ProgressState | undefined;
        for (let i = 0; i < top; i++) {
          const step = advance(state, steps, true, at(0));
          expect(step).toMatchObject({ outcome: 'up', state: { level: i + 1, mastered: false } });
          state = step.state;
        }
        // Right at the top: not yet mastered, however often on the same day.
        let step = advance(state, steps, true, at(0));
        expect(step).toMatchObject({ outcome: 'pending', state: { level: top, mastered: false, firstTopDay: '2026-10-02' } });
        step = advance(step.state, steps, true, at(0.2));
        expect(step).toMatchObject({ outcome: 'pending', state: { firstTopDay: '2026-10-02' } });
        // Right again on a later school day: mastered, and back in a week, from midnight that day (Fri 16 Oct, PDT).
        step = advance(step.state, steps, true, at(7));
        expect(step).toMatchObject({ outcome: 'mastered', state: { level: top, mastered: true, firstTopDay: null, reviewStep: 0, dueAt: Date.UTC(2026, 9, 16, 7) } });
        expect(isMastered(step.state, steps)).toBe(true);
        // Right before it is due: nothing changes.
        expect(advance(step.state, steps, true, at(10))).toEqual({ outcome: 'early', state: step.state });
        // Due: 3 weeks (Fri 6 Nov, PST), then 8 (Fri 1 Jan), then 8 again (Sun 7 Mar, from Sun 10 Jan).
        step = advance(step.state, steps, true, at(14));
        expect(step).toMatchObject({ outcome: 'reviewed', state: { reviewStep: 1, dueAt: Date.UTC(2026, 10, 6, 8) } });
        step = advance(step.state, steps, true, at(35));
        expect(step).toMatchObject({ outcome: 'reviewed', state: { reviewStep: 2, dueAt: Date.UTC(2027, 0, 1, 8) } });
        step = advance(step.state, steps, true, at(100));
        expect(step).toMatchObject({ outcome: 'reviewed', state: { reviewStep: 2, dueAt: Date.UTC(2027, 2, 7, 8) } });
        // A miss loses mastery and a rung, and the intervals start over.
        const lapse = advance(step.state, steps, false, at(160));
        expect(lapse).toEqual({ outcome: 'lapse', state: { level: Math.max(0, top - 1), mastered: false, firstTopDay: null, dueAt: null, reviewStep: 0 } });
        expect(advance(undefined, steps, false, at(0)).state.level).toBe(0);
      });
    }
  }

  it('forgets the first top-rung day after a miss, so the two days must both be right', () => {
    const steps = ladder({ answerMode: 'progressive', accentMode: 'progressive' });
    const first = advance({ level: 2, mastered: false }, steps, true, at(0));
    const missed = advance(first.state, steps, false, at(7));
    expect(missed).toMatchObject({ outcome: 'down', state: { level: 1, firstTopDay: null } });
    const back = advance(missed.state, steps, true, at(7));
    expect(back).toMatchObject({ outcome: 'up', state: { level: 2, firstTopDay: null } });
    expect(advance(back.state, steps, true, at(7))).toMatchObject({ outcome: 'pending' });
  });

  it('counts school days in Los Angeles: 11 pm and 7 am the next morning are two days, two periods of one day are one', () => {
    expect(schoolDay(Date.UTC(2026, 9, 3, 6, 0))).toBe('2026-10-02'); // 11 pm Friday in California
    expect(schoolDay(Date.UTC(2026, 9, 3, 14, 0))).toBe('2026-10-03'); // 7 am Saturday
    const steps = ladder({ answerMode: 'choice', accentMode: 'progressive' });
    const night = advance(undefined, steps, true, { today: schoolDay(Date.UTC(2026, 9, 3, 6, 0)), now: Date.UTC(2026, 9, 3, 6, 0) });
    const morning = advance(night.state, steps, true, { today: schoolDay(Date.UTC(2026, 9, 3, 14, 0)), now: Date.UTC(2026, 9, 3, 14, 0) });
    expect(morning.outcome).toBe('mastered');
  });

  it('finds midnight in Los Angeles on any day, the days the clocks change too', () => {
    // Fri 2 Oct 2026 (PDT): midnight is 07:00 UTC.
    expect(startOfSchoolDay(Date.UTC(2026, 9, 2, 18, 8, 30, 250))).toBe(Date.UTC(2026, 9, 2, 7));
    expect(startOfSchoolDay(Date.UTC(2026, 9, 3, 6, 30))).toBe(Date.UTC(2026, 9, 2, 7)); // 23:30 Friday
    expect(startOfSchoolDay(Date.UTC(2026, 9, 2, 7))).toBe(Date.UTC(2026, 9, 2, 7));
    // Sun 14 Mar 2027, clocks forward at 2 am: that midnight was still PST. Sun 1 Nov 2026, clocks back: still PDT.
    expect(startOfSchoolDay(Date.UTC(2027, 2, 14, 17))).toBe(Date.UTC(2027, 2, 14, 8));
    expect(startOfSchoolDay(Date.UTC(2026, 10, 1, 18))).toBe(Date.UTC(2026, 10, 1, 7));
    // Days until a review, on the calendar: next Friday is 7 days away from a Friday afternoon, and across a clock change.
    expect(schoolDaysUntil(Date.UTC(2026, 9, 9, 7), Date.UTC(2026, 9, 2, 21))).toBe(7);
    expect(schoolDaysUntil(Date.UTC(2026, 10, 6, 8), Date.UTC(2026, 9, 30, 7, 30))).toBe(7);
    expect(schoolDaysUntil(Date.UTC(2026, 9, 1, 7), Date.UTC(2026, 9, 2, 21))).toBe(0);
  });

  it('makes a review due for the whole of its school day: a form mastered at 11:08 comes back to a round at 11:01 a week later', () => {
    const steps = ladder({ answerMode: 'progressive', accentMode: 'progressive' });
    const master = (now: number) => advance({ level: 2, mastered: false, firstTopDay: '2026-01-01' }, steps, true, { today: schoolDay(now), now });
    const masteredAt = Date.UTC(2026, 9, 2, 18, 8); // Fri 2 Oct 2026, 11:08
    const mastered = master(masteredAt);
    expect(mastered).toMatchObject({ outcome: 'mastered', state: { dueAt: Date.UTC(2026, 9, 9, 7) } });
    const nextFriday = Date.UTC(2026, 9, 9, 18, 1); // 11:01
    expect(isDue(mastered.state, steps, nextFriday)).toBe(true);
    expect(isDue(mastered.state, steps, Date.UTC(2026, 9, 9, 6, 59))).toBe(false); // 23:59 Thursday
    expect(advance(mastered.state, steps, true, { today: schoolDay(nextFriday), now: nextFriday }).outcome).toBe('reviewed');
    // Mastered Fri 12 Mar 2027 at 08:30 PST: due from midnight PDT on the 19th, so at 08:45 that morning.
    const march = master(Date.UTC(2027, 2, 12, 16, 30));
    expect(march.state.dueAt).toBe(Date.UTC(2027, 2, 19, 7));
    expect(isDue(march.state, steps, Date.UTC(2027, 2, 19, 15, 45))).toBe(true);
    // Mastered at 23:30 the night before the clocks go forward: still due the Friday after, not the Saturday.
    expect(master(Date.UTC(2027, 2, 13, 7, 30)).state.dueAt).toBe(Date.UTC(2027, 2, 19, 7));
  });

  it('starts a carried-over item at the top: one right answer re-masters it, on the source deck\'s schedule', () => {
    const steps = ladder({ answerMode: 'progressive', accentMode: 'progressive' });
    const waiting = { reviewStep: 1, dueAt: friday + 20 * DAY };
    expect(advance(undefined, steps, true, { ...at(0), carried: true, carriedFrom: waiting }))
      .toEqual({ outcome: 'mastered', state: { level: 2, mastered: true, firstTopDay: null, ...waiting } });
    // A source that is due counts as reviewed now.
    expect(advance(undefined, steps, true, { ...at(0), carried: true, carriedFrom: { reviewStep: 1, dueAt: friday - DAY } }).state)
      .toMatchObject({ reviewStep: 2, dueAt: Date.UTC(2026, 10, 27, 8) }); // 8 weeks on: Fri 27 Nov, PST
    expect(advance(undefined, steps, false, { ...at(0), carried: true }).state).toMatchObject({ level: 1, mastered: false });
    // Only a deck with no progress on the item starts from the top.
    expect(advance({ level: 0, mastered: false }, steps, true, { ...at(0), carried: true })).toMatchObject({ outcome: 'up' });
  });

  it('asks "name the verb" by multiple choice only, in every answer mode', () => {
    for (const answerMode of ANSWER_MODES) {
      expect(itemLadder({ answerMode, accentMode: 'progressive' }, 'from')).toEqual(['choice']);
      expect(itemLadder({ answerMode, accentMode: 'progressive' }, 'to')).toEqual(ladder({ answerMode, accentMode: 'progressive' }));
    }
    const typedDeck = settingsWith({ answerMode: 'typed' });
    const snap = snapshotOf(typedDeck, ['tener']);
    const prompt = buildPrompt(item('tener', 'present', 'yo', 'from'), 2, snap, seededRandom(1));
    expect(prompt).toMatchObject({ level: 0, levelKind: 'choice' });
    expect(prompt.options).toHaveLength(4);
  });

  it('reviews a due "name the verb" item through its form: right → the next interval, wrong → a week, still mastered', () => {
    const due: ProgressState = { level: 0, mastered: true, dueAt: friday, reviewStep: 1 };
    expect(reviewThrough(due, true, friday)).toMatchObject({ mastered: true, reviewStep: 2, dueAt: Date.UTC(2026, 10, 27, 8) });
    expect(reviewThrough(due, false, friday)).toMatchObject({ mastered: true, reviewStep: 0, dueAt: Date.UTC(2026, 9, 9, 7) });
    expect(reviewThrough({ ...due, dueAt: friday + DAY }, true, friday)).toBeNull();
    expect(reviewThrough({ level: 0, mastered: false }, true, friday)).toBeNull();
    expect(reviewThrough(undefined, true, friday)).toBeNull();
  });

  it('moves one rung per answer, and keeps a stored level on a shortened ladder', () => {
    const progressive = ladder({ answerMode: 'progressive', accentMode: 'progressive' });
    const choice = ladder({ answerMode: 'choice', accentMode: 'progressive' });
    expect(nextLevel(0, progressive, true)).toBe(1);
    expect(nextLevel(2, progressive, true)).toBe(2);
    expect(nextLevel(0, progressive, false)).toBe(0);
    expect(clampLevel(2, choice)).toBe(0);
    expect(clampLevel(-3, progressive)).toBe(0);
    expect(isMastered({ level: 2, mastered: true }, choice)).toBe(true);
    // Mastered by multiple choice alone is not mastered once typing is asked for.
    expect(isMastered({ level: 0, mastered: true }, progressive)).toBe(false);
  });

  it('forgives an accent slip on the lenient rung only', () => {
    expect(countsCorrect('correct', 'typed-strict')).toBe(true);
    expect(countsCorrect('accent', 'typed-lenient')).toBe(true);
    expect(countsCorrect('accent', 'typed-strict')).toBe(false);
    expect(countsCorrect('wrong', 'typed-lenient')).toBe(false);
  });

  it('keeps a response time the browser measured, capped at 10 minutes, and drops what is no duration', () => {
    expect(responseMs(2345.6)).toBe(2346);
    expect(responseMs(0)).toBe(0);
    expect(responseMs(3_600_000)).toBe(600_000);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1200', null, undefined, {}]) expect(responseMs(bad)).toBeNull();
  });
});

describe('prompts and grading', () => {
  it('toForm typed: accents forgiven but flagged on the lenient rung, a near miss that does not count on the strict one', () => {
    const settings = settingsWith();
    const it = item('estar', 'present', 'el', 'to');
    const lenient = built(it, settings, 'typed-lenient');
    const prompt = clientPrompt(lenient.entry, 3, 20, lenient.snap);
    expect(prompt).toMatchObject({
      index: 3, total: 20, kind: 'typed', level: 'typed-lenient', strictAccents: false, direction: 'toForm',
      entryLabel: 'estar', entryHint: null, tense: 'present', tenseLabel: 'presente', personLabel: lenient.entry.built?.subject, personId: 'el',
      cue: null, form: null, options: null, askPerson: false, askTense: false, optionsVerb: null,
    });
    // One real subject (v1.24.0), never the whole group.
    expect(['él', 'ella', 'usted']).toContain(prompt.personLabel);
    expect(JSON.stringify(prompt)).not.toContain('está');
    expect(gradeAnswer(lenient.entry, { text: 'Está' }, lenient.snap)).toMatchObject({ result: 'correct', counted: true, nearMiss: false });
    expect(gradeAnswer(lenient.entry, { text: 'esta' }, lenient.snap)).toMatchObject({
      result: 'accent', counted: true, nearMiss: true, correctAnswer: 'está',
    });
    expect(gradeAnswer(lenient.entry, { text: 'él está' }, lenient.snap).result).toBe('correct');
    expect(gradeAnswer(lenient.entry, { text: 'yo está' }, lenient.snap).result).toBe('wrong');
    expect(gradeAnswer(lenient.entry, { text: 'estoy' }, lenient.snap)).toMatchObject({ result: 'wrong', counted: false });

    const strict = built(it, settings, 'typed-strict');
    expect(clientPrompt(strict.entry, 0, 1, strict.snap).strictAccents).toBe(true);
    expect(gradeAnswer(strict.entry, { text: 'esta' }, strict.snap)).toMatchObject({ result: 'accent', counted: false, nearMiss: true });
    expect(gradeAnswer(strict.entry, { text: 'está' }, strict.snap)).toMatchObject({ result: 'correct', counted: true });
  });

  it('toForm choice: four options, one right, none of the others acceptable', () => {
    const settings = settingsWith();
    const { entry, snap } = built(item('tener', 'present', 'yo', 'to'), settings, 'choice');
    const prompt = clientPrompt(entry, 0, 1, snap);
    expect(prompt.kind).toBe('choice');
    expect(prompt.options).toHaveLength(4);
    expect(prompt.options).toContain('tengo');
    for (const option of prompt.options ?? []) {
      expect(gradeAnswer(entry, { choice: option }, snap).result).toBe(option === 'tengo' ? 'correct' : 'wrong');
    }
    expect(() => gradeAnswer(entry, { choice: 'tengo!' }, snap)).toThrow(AnswerShapeError);
    expect(() => gradeAnswer(entry, { text: 'tengo' }, snap)).toThrow(AnswerShapeError);
  });

  it('dative: the experiencer and a cue for the thing liked; "me gustan" must agree with it', () => {
    const settings = settingsWith();
    const typed = built(item('gustarle', 'present', 'yo', 'to', 'pl'), settings, 'typed-strict', ['gustarle'], 7);
    const prompt = clientPrompt(typed.entry, 0, 1, typed.snap);
    expect(prompt).toMatchObject({ entryLabel: 'gustarle', personLabel: 'a mí' });
    expect(['los perros', 'las películas', 'los deportes', 'las fresas', 'los videojuegos', 'los libros']).toContain(prompt.cue);
    expect(gradeAnswer(typed.entry, { text: 'me gustan' }, typed.snap).result).toBe('correct');
    expect(gradeAnswer(typed.entry, { text: 'a mí me gustan' }, typed.snap).result).toBe('correct');
    expect(gradeAnswer(typed.entry, { text: 'a mi me gustan' }, typed.snap).result).toBe('accent');
    expect(gradeAnswer(typed.entry, { text: 'me gusta' }, typed.snap).result).toBe('wrong');
    expect(gradeAnswer(typed.entry, { text: 'gustan' }, typed.snap).result).toBe('wrong');
    expect(gradeAnswer(typed.entry, { text: 'yo me gustan' }, typed.snap).result).toBe('wrong');

    const choice = built(item('gustarle', 'present', 'yo', 'to', 'sg'), settings, 'choice', ['gustarle'], 3);
    const options = clientPrompt(choice.entry, 0, 1, choice.snap).options ?? [];
    expect(options).toContain('me gusta');
    expect(options.filter((o) => gradeAnswer(choice.entry, { choice: o }, choice.snap).result === 'correct')).toEqual(['me gusta']);
  });

  it('dative fromForm: names the entry and the experiencer, not the number', () => {
    const settings = settingsWith({ answerMode: 'typed' });
    const { entry, snap } = built(item('gustarle', 'present', 'ellos', 'from', 'pl'), settings, 'typed-lenient', UNIT1_ENTRIES);
    const prompt = clientPrompt(entry, 0, 1, snap);
    expect(prompt).toMatchObject({ form: 'les gustan', entryLabel: null, personLabel: null, askPerson: true, askTense: false });
    expect(prompt.personOptions?.map((p) => p.label)).toContain('a ellos / a ellas / a ustedes');
    expect(gradeAnswer(entry, { text: 'gustar', person: 'ellos' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'gustarle', person: 'ellos' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'gustar', person: 'el' }, snap).result).toBe('wrong');
    expect(() => gradeAnswer(entry, { text: 'gustar' }, snap)).toThrow(AnswerShapeError);
  });

  it('impersonal: haber (hay) by tense, no person asked and no subject pronoun accepted', () => {
    const settings = settingsWith({ tenses: ['present', 'preterite'] });
    const to = built(item('haber-impersonal', 'preterite', 'el', 'to'), settings, 'typed-strict');
    const prompt = clientPrompt(to.entry, 0, 1, to.snap);
    expect(prompt).toMatchObject({ entryLabel: 'haber', entryHint: 'impersonal', personLabel: null, tenseLabel: 'pretérito', cue: null });
    expect(gradeAnswer(to.entry, { text: 'hubo' }, to.snap).result).toBe('correct');
    expect(gradeAnswer(to.entry, { text: 'él hubo' }, to.snap).result).toBe('wrong');
    expect(gradeAnswer(to.entry, { text: 'hay' }, to.snap).result).toBe('wrong');

    const from = built(item('haber-impersonal', 'present', 'el', 'from'), settings, 'typed-lenient', UNIT1_ENTRIES);
    const fromPrompt = clientPrompt(from.entry, 0, 1, from.snap);
    // The label "haber (hay)" would give the form away.
    expect(fromPrompt).toMatchObject({ form: 'hay', askPerson: false, personOptions: null, askTense: true, tense: null });
    expect(JSON.stringify(fromPrompt)).not.toContain('haber');
    expect(gradeAnswer(from.entry, { text: 'haber', tense: 'present' }, from.snap).result).toBe('correct');
    expect(gradeAnswer(from.entry, { text: 'haber', tense: 'preterite' }, from.snap).result).toBe('wrong');
    expect(gradeAnswer(from.entry, { text: 'ser', tense: 'present' }, from.snap).result).toBe('wrong');
    expect(() => gradeAnswer(from.entry, { text: 'haber' }, from.snap)).toThrow(AnswerShapeError);

    const choice = built(item('haber-impersonal', 'present', 'el', 'from'), settingsWith(), 'choice', UNIT1_ENTRIES);
    const options = clientPrompt(choice.entry, 0, 1, choice.snap).options ?? [];
    expect(options).toContain('haber');
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it('impersonal toForm: named by the infinitive with an "impersonal" hint, never by the form it asks for', () => {
    const settings = settingsWith({ answerMode: 'typed' });
    for (const [entry, answer] of [['haber-impersonal', 'hay'], ['hacer-impersonal', 'hace']] as const) {
      const to = built(item(entry, 'present', 'el', 'to'), settings, 'typed-strict', [entry]);
      const prompt = clientPrompt(to.entry, 0, 1, to.snap);
      expect(prompt).toMatchObject({ entryLabel: entry.replace('-impersonal', ''), entryHint: 'impersonal', personLabel: null });
      // "haber (hay)" asked for "hay": the prompt must not carry its answer.
      const shown = [prompt.entryLabel, prompt.entryHint, prompt.personLabel, prompt.cue, prompt.tenseLabel, prompt.form].join(' ');
      expect(shown.split(/[\s()·]+/)).not.toContain(answer);
      expect(gradeAnswer(to.entry, { text: answer }, to.snap).result).toBe('correct');
    }
    const personal = built(item('hacer', 'present', 'el', 'to'), settings, 'typed-strict', ['hacer']);
    expect(clientPrompt(personal.entry, 0, 1, personal.snap)).toMatchObject({ entryLabel: 'hacer', entryHint: null });
  });

  it('fromForm: an ambiguous form is right for every reading among the deck’s cells ("hablaba" is yo or él)', () => {
    const settings = settingsWith({ tenses: ['imperfect'], answerMode: 'typed' });
    const { entry, snap } = built(item('hablar', 'imperfect', 'yo', 'from'), settings, 'typed-lenient', ['hablar', 'vivir']);
    const prompt = clientPrompt(entry, 0, 1, snap);
    expect(prompt).toMatchObject({ form: 'hablaba', tense: 'imperfect', askTense: false, askPerson: true });
    expect(gradeAnswer(entry, { text: 'hablar', person: 'yo' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'hablar', person: 'el' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'hablar', person: 'tu' }, snap).result).toBe('wrong');
    expect(gradeAnswer(entry, { text: 'vivir', person: 'yo' }, snap).result).toBe('wrong');
    expect(gradeAnswer(entry, { text: 'hablar', person: 'yo' }, snap)).toMatchObject({
      correctAnswer: 'hablar · yo · imperfecto', alsoCorrect: ['hablar · él / ella / usted · imperfecto'],
    });

    // Multiple choice never offers the other right reading as a wrong one.
    const choiceSettings = settingsWith({ tenses: ['imperfect'] });
    for (let seed = 1; seed <= 20; seed++) {
      const choice = built(item('hablar', 'imperfect', 'el', 'from'), choiceSettings, 'choice', ['hablar', 'vivir'], seed);
      const shown = clientPrompt(choice.entry, 0, 1, choice.snap);
      const options = shown.options ?? [];
      // Every option is a form of hablar: the verb is in the question, each option names one subject (v1.24.0).
      expect(shown.optionsVerb).toBe('hablar');
      expect(options).toContain(choice.entry.built?.subject);
      expect(['él', 'ella', 'usted']).toContain(choice.entry.built?.subject);
      expect(options).not.toContain('yo');
      expect(options).toHaveLength(4);
      expect(new Set(options).size).toBe(4);
      expect(gradeAnswer(choice.entry, { choice: choice.entry.built?.subject as string }, choice.snap)).toMatchObject({
        result: 'correct', correctAnswer: `hablar · ${choice.entry.built?.subject} · imperfecto`, rightOptions: [choice.entry.built?.subject],
        alsoCorrect: ['hablar · yo · imperfecto'],
      });
    }
  });

  it('fromForm with several tenses asks for the tense too', () => {
    const settings = settingsWith({ tenses: ['present', 'preterite'], answerMode: 'typed' });
    const { entry, snap } = built(item('vivir', 'preterite', 'nosotros', 'from'), settings, 'typed-strict', ['vivir']);
    const prompt = clientPrompt(entry, 0, 1, snap);
    // vivimos is present and preterite: either tense is right.
    expect(prompt).toMatchObject({ form: 'vivimos', askTense: true, tense: null, tenseLabel: null });
    expect(prompt.tenseOptions?.map((t) => t.id)).toEqual(['present', 'preterite']);
    expect(gradeAnswer(entry, { text: 'vivir', person: 'nosotros', tense: 'present' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'vivir', person: 'nosotros', tense: 'preterite' }, snap).result).toBe('correct');
    expect(gradeAnswer(entry, { text: 'vivír', person: 'nosotros', tense: 'preterite' }, snap).result).toBe('accent');
    expect(() => gradeAnswer(entry, { text: 'vivir', person: 'nosotros', tense: 'future' }, snap)).toThrow(AnswerShapeError);

    const choice = built(item('vivir', 'present', 'yo', 'from'), settingsWith({ tenses: ['present', 'preterite'] }), 'choice', ['vivir', 'tener']);
    expect(clientPrompt(choice.entry, 0, 1, choice.snap)).toMatchObject({ optionsVerb: 'vivir' });
    expect(clientPrompt(choice.entry, 0, 1, choice.snap).options).toContain('yo · presente');
  });

  it('fromForm choice: the right option never stands out by what it shares with the wrong ones', () => {
    // What an option shows: entry (in the question when every option shares it), person ('' for an
    // impersonal verb), tense ('' when not asked).
    const fieldsOf = (option: string, askTense: boolean, verb: string | undefined) => {
      const parts = verb ? [verb, ...option.split(' · ')] : option.split(' · ');
      const hasPerson = parts.length === (askTense ? 3 : 2);
      return [parts[0], hasPerson ? parts[1] : '', askTense ? parts[parts.length - 1] : ''];
    };
    // The only most frequent value of a field gives the answer away; one every option shows does not.
    const onlyMostFrequent = (values: string[], value: string) => {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const max = Math.max(...counts.values());
      return counts.size > 1 && counts.get(value) === max && [...counts.values()].filter((c) => c === max).length === 1;
    };
    const entries = ['tener', 'hablar', 'vivir', 'gustarle', 'haber-impersonal'];
    const decks: QuizSettings['tenses'][] = [['present'], ['present', 'preterite'], ['present', 'preterite', 'imperfect'], ['present', 'preterite', 'imperfect', 'future']];
    let prompts = 0;
    for (const tenses of decks) {
      const settings = settingsWith({ tenses });
      const snap = snapshotOf(settings, entries);
      const askTense = tenses.length > 1;
      const fromItems = itemsFor(entries, settings).filter((it) => it.direction === 'from');
      for (const it of fromItems) {
        const form = formsOf(it.entry, it, settings)[0];
        // Every reading of the form among the deck's cells is right.
        const rightReadings = new Set(itemsFor(entries, settings)
          .filter((other) => other.direction === 'from' && formsOf(other.entry, other, settings).includes(form))
          .map((other) => readingLabel(other, askTense)));
        for (let seed = 0; seed < 5; seed++) {
          const entry: QueueEntry = { ...it, built: buildPrompt(it, 0, snap, seededRandom(seed)) };
          const options = entry.built!.options ?? [];
          const readings = entry.built!.optionReadings ?? [];
          const [correct] = entry.built!.correctOptions ?? [];
          const at = options.indexOf(correct);
          prompts++;
          expect(at).toBeGreaterThanOrEqual(0);
          expect(readingLabel(readings[at], askTense)).toBe(readingLabel(it, askTense));
          expect(new Set(options).size).toBe(options.length);
          expect(readings).toHaveLength(options.length);
          const impersonal = it.entry === 'haber-impersonal';
          expect(options).toHaveLength(4);
          options.forEach((option, i) => {
            if (option !== correct) expect(rightReadings.has(readingLabel(readings[i], askTense)), `${form}: ${option}`).toBe(false);
            const { result } = gradeAnswer(entry, { choice: option }, snap);
            expect(result).toBe(option === correct ? 'correct' : 'wrong');
          });
          const fields = options.map((o) => fieldsOf(o, askTense, entry.built!.optionsVerb));
          const shared = fields.map((a, i) => fields.reduce((sum, b, j) => (
            i === j ? sum : sum + a.filter((v, f) => v !== '' && v === b[f]).length
          ), 0));
          const top = Math.max(...shared);
          const context = `${form} (${tenses.join(', ')}): ${options.join(' | ')}`;
          expect(shared[at] === top && shared.filter((x) => x === top).length === 1, context).toBe(false);
          for (const f of [1, 2]) {
            if (fields[at][f] === '') continue;
            expect(onlyMostFrequent(fields.map((x) => x[f]), fields[at][f]), context).toBe(false);
          }
          // Nor by naming a person or not: "haber" is never the only option without one.
          const personless = fields.map((x) => x[1] === '');
          expect(personless.filter((p) => p === personless[at]).length, context).toBeGreaterThan(1);
          // The tense and the person are both tested: some wrong option names another one.
          if (askTense) expect(fields.some((x) => x[2] !== fields[at][2]), context).toBe(true);
          if (!impersonal) expect(fields.some((x) => x[1] !== fields[at][1]), context).toBe(true);
        }
      }
    }
    expect(prompts).toBeGreaterThan(1000);

    // vivimos is present and preterite: the other tense is right and never offered as wrong.
    const both = settingsWith({ tenses: ['present', 'preterite'] });
    for (let seed = 1; seed <= 30; seed++) {
      const choice = built(item('vivir', 'present', 'nosotros', 'from'), both, 'choice', ['vivir', 'tener'], seed);
      const options = clientPrompt(choice.entry, 0, 1, choice.snap).options ?? [];
      const subject = choice.entry.built?.subject as string;
      expect(['nosotros', 'nosotras']).toContain(subject);
      const correct = `${choice.entry.built?.optionsVerb ? '' : 'vivir · '}${subject} · presente`;
      expect(options).toContain(correct);
      expect(options.filter((o) => /(nosotros|nosotras) · pretérito$/.test(o) && o.startsWith(choice.entry.built?.optionsVerb ? 'nos' : 'vivir'))).toEqual([]);
      expect(options).toHaveLength(4);
      for (const option of options) {
        const { result } = gradeAnswer(choice.entry, { choice: option }, choice.snap);
        expect(result).toBe(option === correct ? 'correct' : 'wrong');
      }
    }
  });

  it('dative typed: the answer may echo the cue it was shown ("a mí me gusta el chocolate")', () => {
    const settings = settingsWith();
    for (const [number, form] of [['sg', 'me gusta'], ['pl', 'me gustan']] as const) {
      const other = number === 'sg' ? 'me gustan' : 'me gusta';
      for (let seed = 1; seed <= 12; seed++) {
        for (const level of ['typed-lenient', 'typed-strict'] as const) {
          const typed = built(item('gustarle', 'present', 'yo', 'to', number), settings, level, ['gustarle'], seed);
          const cue = typed.entry.built?.cue ?? '';
          expect(cue).not.toBe('');
          const grade = (text: string) => gradeAnswer(typed.entry, { text }, typed.snap);
          expect(grade(`${form} ${cue}`), cue).toMatchObject({ result: 'correct', counted: true, correctAnswer: form });
          expect(grade(`a mí ${form} ${cue}`).result, cue).toBe('correct');
          expect(grade(`${form} ${cue} a mí`).result, cue).toBe('correct');
          expect(grade(`¡A mí ${form} ${cue.toUpperCase()}!`).result, cue).toBe('correct');
          // What was typed is logged as typed.
          expect(grade(`${form} ${cue}`).given).toBe(`${form} ${cue}`);
          // A wrong verb form is still wrong with the cue after it, and the cue alone is no answer.
          expect(grade(`${other} ${cue}`).result, cue).toBe('wrong');
          expect(grade(`a mí ${other} ${cue}`).result, cue).toBe('wrong');
          expect(grade(`te ${form.split(' ')[1]} ${cue}`).result, cue).toBe('wrong');
          expect(grade(`a ti ${form} ${cue}`).result, cue).toBe('wrong');
          expect(grade(`yo ${form} ${cue}`).result, cue).toBe('wrong');
          expect(grade(cue).result, cue).toBe('wrong');
          // An accent slip in the verb is still seen; the cue's own accents are not graded.
          expect(grade(`a mi ${form} ${cue}`), cue).toMatchObject({ result: 'accent', counted: level === 'typed-lenient' });
          expect(grade(`${form} ${foldAccents(cue)}`).result, cue).toBe('correct');
        }
      }
    }
    expect(withoutCue('me gusta el futbol', 'el fútbol')).toBe('me gusta');
    expect(withoutCue('me gusta la clase de espanol', 'la clase de español')).toBe('me gusta');
    expect(withoutCue('me asustan las aranas', 'las arañas')).toBe('me asustan');
    expect(withoutCue('A mí me gusta el chocolate.', 'el chocolate')).toBe('a mí me gusta');
    expect(withoutCue('me gusta el chocolate a mí', 'el chocolate')).toBe('me gusta a mí');
    expect(withoutCue('me gusta la pizza', 'el chocolate')).toBe('me gusta la pizza');
    expect(withoutCue('el chocolate', 'el chocolate')).toBe('el chocolate');
    expect(withoutCue('me gusta', null)).toBe('me gusta');
  });

  it('impersonal fromForm choice: the right option is never the only one without a person (hay, llueve, nieva, hace)', () => {
    const UNIT23 = ['ser', 'estar', 'tener', 'hacer', 'ir', 'jugar', 'gustarle', 'llover', 'nevar', 'hacer-impersonal', 'haber-impersonal'];
    const WEATHER = ['llover', 'nevar', 'hacer-impersonal', 'haber-impersonal'];
    const impersonalNames = new Set(['llover', 'nevar', 'hacer', 'haber']);
    let prompts = 0;
    for (const entries of [UNIT1_ENTRIES, UNIT23, WEATHER]) {
      for (const tenses of [['present'], ['present', 'preterite']] as QuizSettings['tenses'][]) {
        const settings = settingsWith({ tenses });
        const snap = snapshotOf(settings, entries);
        const askTense = tenses.length > 1;
        const fromItems = itemsFor(entries, settings).filter((it) => it.direction === 'from' && WEATHER.includes(it.entry));
        for (const it of fromItems) {
          for (let seed = 0; seed < 10; seed++) {
            const entry: QueueEntry = { ...it, built: buildPrompt(it, 0, snap, seededRandom(seed)) };
            const options = entry.built?.options ?? [];
            const correct = readingLabel(it, askTense);
            const context = `${entry.built?.form} [${entries.join()}] (${tenses.join()}): ${options.join(' | ')}`;
            prompts++;
            expect(options, context).toHaveLength(4);
            expect(new Set(options).size, context).toBe(4);
            expect(options, context).toContain(correct);
            // No option names a person, so none stands out by having none.
            for (const option of options) {
              const parts = option.split(' · ');
              expect(parts, context).toHaveLength(askTense ? 2 : 1);
              expect(gradeAnswer(entry, { choice: option }, snap).result, context).toBe(option === correct ? 'correct' : 'wrong');
            }
            // Every verb shown once, or (with the tense asked) a grid: nothing is the only most frequent.
            const names = options.map((o) => o.split(' · ')[0]);
            const count = (list: string[], v: string) => list.filter((x) => x === v).length;
            expect(names.every((n) => count(names, n) === count(names, names[0])), context).toBe(true);
            if (askTense) {
              const shownTenses = options.map((o) => o.split(' · ')[1]);
              expect(new Set(shownTenses).size, context).toBe(2);
              expect(shownTenses.every((t) => count(shownTenses, t) === 2), context).toBe(true);
            }
            // A deck with enough impersonal verbs offers only them.
            if (entries === WEATHER) expect(names.every((n) => impersonalNames.has(n)), context).toBe(true);
          }
        }
      }
    }
    expect(prompts).toBeGreaterThan(100);
  });

  it('toForm choice: wrong forms come from the deck’s own tenses, never "quisiésemos" or "fuera" in a present-only deck', () => {
    for (const tenses of [['present'], ['present', 'preterite']] as QuizSettings['tenses'][]) {
      const settings = settingsWith({ tenses });
      const snap = snapshotOf(settings, UNIT1_ENTRIES);
      const toItems = itemsFor(UNIT1_ENTRIES, settings).filter((it) => it.direction === 'to');
      for (const it of toItems) {
        for (let seed = 0; seed < 5; seed++) {
          const options = buildPrompt(it, 0, snap, seededRandom(seed)).options ?? [];
          const context = `${it.key} (${tenses.join()}): ${options.join(' | ')}`;
          expect(options, context).toHaveLength(4);
          // hay has too few other forms (ha, han): it alone may fall back to the nearest other tense.
          if (it.entry === 'haber-impersonal') continue;
          for (const option of options) {
            const own = analyze(option).filter((h) => h.infinitive === it.entry).map((h) => h.tense);
            if (option === 'esté') continue; // estar made regular (estuve → esté), not a subjunctive on offer
            expect(own.length === 0 || own.some((t) => tenses.includes(t)), `${context}: ${option} is ${own.join('/')}`).toBe(true);
          }
        }
      }
    }
  });

  it('pronominal entries are practiced with their pronoun', () => {
    const settings = settingsWith({ answerMode: 'typed' });
    const to = built(item('llamarse', 'present', 'yo', 'to'), settings, 'typed-strict');
    expect(gradeAnswer(to.entry, { text: 'me llamo' }, to.snap).result).toBe('correct');
    expect(gradeAnswer(to.entry, { text: 'yo me llamo' }, to.snap).result).toBe('correct');
    expect(gradeAnswer(to.entry, { text: 'llamo' }, to.snap).result).toBe('wrong');
  });
});

describe('rounds', () => {
  const settings = settingsWith({ roundLength: 12 });
  const items = itemsFor(UNIT1_ENTRIES, settings);
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 9, 9, 18); // Fri 9 Oct 2026, 11:00 in Los Angeles
  const TODAY = schoolDay(NOW);
  const YESTERDAY = schoolDay(NOW - DAY);
  const deckOf = (deckId: number, list: readonly Item[], progress = new Map<string, ProgressState>(), over: Partial<QuizSettings> = {}): PlanDeck =>
    ({ deckId, settings: { ...settings, ...over }, items: list, progress });
  const plan = (current: PlanDeck, length: number, seed: number, others: PlanDeck[] = []) =>
    planRound({ current, others, length, today: TODAY, now: NOW, rand: seededRandom(seed) });
  const mastered = (dueAt: number | null = NOW + 10 * DAY): ProgressState => ({ level: 2, mastered: true, dueAt, reviewStep: 0 });
  const masteredFrom = (dueAt: number | null = NOW + 10 * DAY): ProgressState => ({ level: 0, mastered: true, dueAt, reviewStep: 0 });
  const done = (it: Item, dueAt?: number | null) => (it.direction === 'from' ? masteredFrom(dueAt) : mastered(dueAt));
  const cellOf = (it: Item) => it.key.replace(/\|(to|from)$/, '');

  it('is the same round for the same seed', () => {
    const a = plan(deckOf(1, items), 12, 42).items.map((i) => i.key);
    expect(plan(deckOf(1, items), 12, 42).items.map((i) => i.key)).toEqual(a);
    expect(plan(deckOf(1, items), 12, 43).items.map((i) => i.key)).not.toEqual(a);
  });

  it('spreads a round across the verbs', () => {
    const { items: round, review } = plan(deckOf(1, items), 12, 1);
    expect(review).toBe(false);
    expect(round).toHaveLength(12);
    expect(new Set(round.map((i) => i.key)).size).toBe(12);
    expect(new Set(round.map((i) => i.entry)).size).toBe(10);
    for (let i = 1; i < 10; i++) expect(round[i].entry).not.toBe(round[i - 1].entry);
    expect(round.every((i) => i.deckId === 1 && i.slot === 'own')).toBe(true);
  });

  it('starts a new deck with "give the form" questions for half the round, so typing comes in the second round', () => {
    const first = plan(deckOf(1, items), 20, 3).items;
    expect(first.filter((i) => i.direction === 'to').length).toBeGreaterThanOrEqual(10);
    // Everything right once: the next round types.
    const progress = new Map(first.map((i) => [i.key, { level: 1, mastered: false } as ProgressState]));
    const second = plan(deckOf(1, items, progress), 20, 4).items;
    const typed = second.filter((i) => i.direction === 'to' && progress.has(i.key));
    expect(typed.length).toBeGreaterThan(0);
  });

  it('orders a deck\'s own items: second-day checks, new forms, capped multiple choice, typing lowest rung first, today\'s top-rung items last', () => {
    const to = items.filter((i) => i.direction === 'to');
    const from = items.filter((i) => i.direction === 'from');
    const progress = new Map<string, ProgressState>();
    // 10 checks (right at the top yesterday), 10 right at the top today, 12 typed, the rest multiple choice.
    const checks = to.slice(0, 10);
    const today = to.slice(10, 20);
    const typedLow = to.slice(20, 26);
    const typedHigh = to.slice(26, 32);
    for (const it of checks) progress.set(it.key, { level: 2, mastered: false, firstTopDay: YESTERDAY });
    for (const it of today) progress.set(it.key, { level: 2, mastered: false, firstTopDay: TODAY });
    for (const it of typedLow) progress.set(it.key, { level: 1, mastered: false });
    for (const it of typedHigh) progress.set(it.key, { level: 2, mastered: false });
    for (const it of from.slice(0, 20)) progress.set(it.key, { level: 0, mastered: false });
    for (let seed = 0; seed < 10; seed++) {
      const round = plan(deckOf(1, items, progress), 20, seed).items;
      const count = (list: Item[]) => round.filter((i) => list.some((x) => x.key === i.key)).length;
      // ⌈20/3⌉ second-day checks, no more.
      expect(count(checks)).toBe(7);
      // Items right at the top today wait for another day while anything else is left.
      expect(count(today)).toBe(0);
      // Multiple choice ("name the verb" or new forms) is capped once typing exists: typing gets the rest.
      expect(count([...typedLow, ...typedHigh])).toBeGreaterThanOrEqual(20 - 7 - 7 - 7);
    }
    // Typed items: the lowest rung first.
    const noChecks = new Map([...progress].filter(([key]) => !checks.some((c) => c.key === key)));
    const round = plan(deckOf(1, to.filter((i) => noChecks.has(i.key)), noChecks), 3, 1).items;
    expect(round.every((i) => typedLow.some((x) => x.key === i.key))).toBe(true);
  });

  it('reserves a quarter of a round for due reviews of any deck, most overdue first, asked under their own deck', () => {
    const unit1 = itemsFor(['tener', 'ser'], settings);
    const unit3 = itemsFor(['hablar', 'comer', 'vivir'], settings);
    // Everything of Unit 1 mastered; 12 of its forms due, the oldest 30 days ago.
    const unit1Progress = new Map(unit1.map((it, i) => [it.key, done(it, i < 12 ? NOW - (30 - i) * DAY : NOW + DAY)]));
    const others = [deckOf(1, unit1, unit1Progress, { accentMode: 'forgiven' })];
    for (let seed = 0; seed < 10; seed++) {
      const round = plan(deckOf(3, unit3), 20, seed, others).items;
      const reviews = round.filter((i) => i.slot === 'review');
      expect(reviews).toHaveLength(5);
      expect(reviews.every((i) => i.deckId === 1)).toBe(true);
      expect(round.filter((i) => i.deckId === 3)).toHaveLength(15);
    }
    // Most overdue first: with one slot, the 30-day-old one.
    const one = plan(deckOf(3, unit3), 4, 1, others).items.filter((i) => i.slot === 'review');
    expect(one).toHaveLength(1);
    expect(cellOf(one[0])).toBe(cellOf(unit1[0]));
    // Nothing due: the round is the deck's own.
    const later = new Map(unit1.map((it) => [it.key, done(it)]));
    expect(plan(deckOf(3, unit3), 20, 1, [deckOf(1, unit1, later)]).items.every((i) => i.deckId === 3)).toBe(true);
  });

  it('reviews a due "name the verb" item by asking for the form, unless the form is mastered and rides along', () => {
    const tener = itemsFor(['tener'], settings);
    const fromYo = tener.find((i) => i.key === 'tener|present|yo|-|from') as Item;
    const toYo = tener.find((i) => i.key === 'tener|present|yo|-|to') as Item;
    const alone = new Map([[fromYo.key, masteredFrom(NOW - DAY)]]);
    expect(dueEntries(deckOf(1, tener, alone), NOW)).toEqual([{ item: toYo, deckId: 1, dueAt: NOW - DAY, via: fromYo.key }]);
    const round = plan(deckOf(2, itemsFor(['hablar'], settings)), 8, 1, [deckOf(1, tener, alone)]).items;
    expect(round.find((i) => i.deckId === 1)).toMatchObject({ key: toYo.key, via: fromYo.key, slot: 'review' });
    // Both mastered: the form comes due itself and the name-the-verb item follows its schedule.
    const both = new Map([[fromYo.key, masteredFrom(NOW - DAY)], [toYo.key, mastered(NOW + DAY)]]);
    expect(dueEntries(deckOf(1, tener, both), NOW)).toEqual([]);
    // A deck that asks only "name the verb" reviews it as such.
    const fromOnly = itemsFor(['tener'], settingsWith({ directions: 'fromForm' }));
    expect(dueEntries(deckOf(1, fromOnly, alone, { directions: 'fromForm' }), NOW)).toEqual([{ item: fromYo, deckId: 1, dueAt: NOW - DAY }]);
    expect(dueCount(deckOf(1, tener, alone), NOW)).toBe(1);
  });

  it('fills a small deck\'s round with more reviews, then its own mastered items', () => {
    const unit2 = itemsFor(['verse'], settings);
    const unit1 = itemsFor(['tener', 'ser', 'estar'], settings);
    const unit1Progress = new Map(unit1.map((it) => [it.key, done(it, NOW - DAY)]));
    const round = plan(deckOf(2, unit2), 20, 1, [deckOf(1, unit1, unit1Progress)]).items;
    // verse has 5 cells, so 5 prompts of its own; the rest are Unit 1 reviews beyond the quarter.
    expect(round.filter((i) => i.deckId === 2)).toHaveLength(5);
    expect(round.filter((i) => i.slot === 'review').length).toBe(15);
    // All mastered and nothing due: a review round of the deck itself.
    const all = new Map(items.map((it) => [it.key, done(it)]));
    const review = plan(deckOf(1, items, all), 12, 9);
    expect(review.review).toBe(true);
    expect(review.items).toHaveLength(12);
    expect(review.items.every((i) => i.slot === 'filler')).toBe(true);
  });

  it('never puts both directions of one cell in a round, reviews and top-up included, across decks too', () => {
    const distinct = (round: Item[]) => new Set(round.map(cellOf)).size;
    const cellCount = new Set(items.map(cellOf)).size;
    for (let seed = 0; seed < 10; seed++) {
      expect(distinct(plan(deckOf(1, items), 12, seed).items)).toBe(12);
      const long = plan(deckOf(1, items), 60, seed).items;
      expect(long).toHaveLength(cellCount);
      expect(distinct(long)).toBe(cellCount);
      // The same cells due in another deck: still one prompt per cell.
      const twin = deckOf(2, items, new Map(items.map((it) => [it.key, done(it, NOW - DAY)])));
      const both = plan(deckOf(1, items), 60, seed, [twin]).items;
      expect(distinct(both)).toBe(both.length);
    }
    // Every fromForm item open, every toForm one mastered: the top-up may not bring the other direction back.
    const half = new Map(items.map((it) => [it.key, it.direction === 'to' ? mastered() : { level: 0, mastered: false }]));
    const round = plan(deckOf(1, items, half), 60, 3).items;
    expect(round).toHaveLength(cellCount);
    expect(round.every((it) => it.direction === 'from')).toBe(true);
  });

  it('never shows in a fromForm prompt a form another prompt of the round asks for, reviews and top-up included', () => {
    // vivía is yo and él of the imperfect, tenía and hablaba too: a round may not show one and ask for the other.
    const deck = settingsWith({ tenses: ['present', 'imperfect'], roundLength: 20 });
    const deckItems = itemsFor(['vivir', 'tener', 'hablar'], deck);
    const deckForms = (it: Item) => formsOf(it.entry, it, deck);
    const leaks = (round: Item[]) => {
      const out: string[] = [];
      for (const from of round.filter((it) => it.direction === 'from')) {
        const shown = deckForms(from)[0];
        for (const to of round.filter((it) => it.direction === 'to')) {
          if (deckForms(to).includes(shown)) out.push(`${from.key} shows ${shown}, the answer of ${to.key}`);
        }
      }
      return out;
    };
    const view = (progress: Map<string, ProgressState>, id = 1): PlanDeck => ({ deckId: id, settings: deck, items: deckItems, progress });
    const run = (current: PlanDeck, length: number, seed: number, others: PlanDeck[] = []) =>
      planRound({ current, others, length, today: TODAY, now: NOW, rand: seededRandom(seed) });
    const allMastered = new Map(deckItems.map((it) => [it.key, done(it)]));
    const fromOpen = new Map(deckItems.map((it) => [it.key, it.direction === 'to' ? mastered() : { level: 0, mastered: false }]));
    const dueTwin = view(new Map(deckItems.map((it) => [it.key, done(it, NOW - DAY)])), 2);
    for (let seed = 0; seed < 50; seed++) {
      const round = run(view(new Map()), 20, seed);
      expect(round.items).toHaveLength(20);
      expect(leaks(round.items)).toEqual([]);
      expect(leaks(run(view(new Map()), 60, seed).items)).toEqual([]);
      const review = run(view(allMastered), 60, seed);
      expect(review.review).toBe(true);
      expect(leaks(review.items)).toEqual([]);
      expect(leaks(run(view(fromOpen), 60, seed).items)).toEqual([]);
      expect(leaks(run(view(new Map()), 20, seed, [dueTwin]).items)).toEqual([]);
    }
  });

  it('starts a round of a huge deck in linear time (600 verbs × 6 tenses, ~36k items)', () => {
    const big: Item[] = [];
    for (let v = 0; v < 600; v++) {
      for (let c = 0; c < 60; c++) {
        for (const direction of ['to', 'from'] as const) {
          big.push(item(`verbo${v}ar`, 'present', (['yo', 'tu', 'el', 'nosotros', 'ellos'] as const)[c % 5], direction));
        }
      }
    }
    // Keys must be distinct: one cell per (verb, c), and forms that differ.
    const unique = big.map((it, i) => ({ ...it, key: `${it.key}#${Math.floor(i / 2)}`, person: 'yo' as const, tense: 'present' as const, entry: `hablar` }))
      .map((it, i) => ({ ...it, entry: `v${Math.floor(i / 2)}ar` }));
    const start = performance.now();
    const { items: round } = planRound({ current: deckOf(1, unique), length: 20, today: TODAY, now: NOW, rand: seededRandom(1) });
    const ms = performance.now() - start;
    expect(round.length).toBeGreaterThan(0);
    // Linear: tens of ms even on a loaded runner; copying the level list on every item took seconds.
    expect(ms).toBeLessThan(1_500);
  });

  it('carries a mastered item over to a new deck at the same top rung, and a half-climbed one at the same ladder', () => {
    const progressive = settingsWith();
    const typedOnly = settingsWith({ answerMode: 'typed' });
    const choiceOnly = settingsWith({ answerMode: 'choice' });
    const settingsOf = (id: number) => (id === 1 ? progressive : id === 2 ? typedOnly : choiceOnly);
    const key = 'tener|present|yo|-|to';
    const masteredIn1: TwinRow = { deckId: 1, state: { level: 2, mastered: true, dueAt: NOW + 3 * DAY, reviewStep: 1 } };
    // Its own row, unless a deck on the same ladder is further along (rows kept per deck in v1.12): one form, one state.
    expect(startingState(4, progressive, 'to', [masteredIn1, { deckId: 4, state: { level: 1, mastered: false } }], settingsOf))
      .toEqual({ state: masteredIn1.state, carried: false, carriedFrom: null });
    const pending: ProgressState = { level: 2, mastered: false, firstTopDay: YESTERDAY };
    expect(startingState(4, progressive, 'to', [{ deckId: 1, state: { level: 2, mastered: false } }, { deckId: 4, state: pending }], settingsOf))
      .toEqual({ state: pending, carried: false, carriedFrom: null });
    expect(startingState(4, progressive, 'to', [{ deckId: 1, state: pending }, { deckId: 4, state: { level: 2, mastered: false } }], settingsOf))
      .toEqual({ state: pending, carried: false, carriedFrom: null });
    // A deck on another ladder is not the same form's state: its own row stays.
    expect(startingState(4, progressive, 'to', [{ deckId: 2, state: { level: 1, mastered: true } }, { deckId: 4, state: { level: 0, mastered: false } }], settingsOf))
      .toEqual({ state: { level: 0, mastered: false }, carried: false, carriedFrom: null });
    // typed-strict tops both ladders: carried, on Unit 1's schedule.
    expect(startingState(2, typedOnly, 'to', [masteredIn1], settingsOf))
      .toEqual({ carried: true, carriedFrom: { reviewStep: 1, dueAt: NOW + 3 * DAY } });
    // Mastered by multiple choice alone is not mastered in a deck that types.
    expect(startingState(1, progressive, 'to', [{ deckId: 3, state: { level: 0, mastered: true } }], settingsOf))
      .toEqual({ carried: false, carriedFrom: null });
    // Half-way up in a deck with the same ladder: it starts there (one form, one state).
    expect(startingState(5, progressive, 'to', [{ deckId: 1, state: { level: 1, mastered: false } }], settingsOf))
      .toEqual({ state: { level: 1, mastered: false }, carried: false, carriedFrom: null });
    // The deck's view: carried items are known, inherited states filled in, and the first prompt starts at the top.
    const tener = itemsFor(['tener'], progressive);
    const byKey = new Map([[key, [masteredIn1]], ['tener|present|tu|-|to', [{ deckId: 1, state: { level: 1, mastered: false } }]]]);
    const view = deckView(5, progressive, tener, byKey, settingsOf);
    expect([...(view.carried ?? [])]).toEqual([key]);
    expect(view.progress.get('tener|present|tu|-|to')).toEqual({ level: 1, mastered: false });
    expect(startLevel(view, tener.find((i) => i.key === key) as Item)).toBe(2);
    // Carried items are second-day checks, flagged for the answer.
    const round = planRound({ current: view, length: 20, today: TODAY, now: NOW, rand: seededRandom(1) }).items;
    expect(round.find((i) => i.key === key)).toMatchObject({ carried: true, slot: 'own' });
  });
  it('puts a missed item back once, at the end', () => {
    const queue: QueueEntry[] = items.slice(0, 3).map((it) => ({ ...it }));
    queue[0].built = buildPrompt(queue[0], 0, snapshotOf(settings, UNIT1_ENTRIES), seededRandom(1));
    const after = requeue(queue, 0, false);
    expect(after).toHaveLength(4);
    expect(after[3]).toEqual({ ...items[0], retry: true });
    expect(requeue(after, 3, false)).toHaveLength(4);
    expect(requeue(queue, 0, true)).toHaveLength(3);
  });

  it('scores the first tries over the prompts the round started with', () => {
    expect(roundScore(15, 20)).toBe(0.75);
    expect(roundScore(0, 0)).toBe(0);
  });

  describe('"Study all" (v1.18.0)', () => {
    const planAll = (decks: PlanDeck[], seed: number, length = STUDY_ALL_LENGTH) =>
      planAllRound({ decks, length, today: TODAY, now: NOW, rand: seededRandom(seed) });
    const unit1 = itemsFor(['tener', 'ser'], settings);
    const unit3 = itemsFor(['hablar', 'comer', 'vivir'], settings);
    const to = (list: readonly Item[]) => list.filter((i) => i.direction === 'to');

    it('is 20 questions, the same for the same seed', () => {
      expect(STUDY_ALL_LENGTH).toBe(20);
      const a = planAll([deckOf(3, unit3), deckOf(1, unit1)], 7).items.map((i) => `${i.deckId}:${i.key}`);
      expect(a).toHaveLength(20);
      expect(planAll([deckOf(3, unit3), deckOf(1, unit1)], 7).items.map((i) => `${i.deckId}:${i.key}`)).toEqual(a);
      expect(planAll([], 1)).toEqual({ items: [], review: false });
    });

    it('asks every due form first, of any deck, most overdue first, with no quarter cap', () => {
      // Everything of Unit 1 mastered; 12 of its forms due, the oldest 30 days ago.
      const progress = new Map(unit1.map((it, i) => [it.key, done(it, i < 12 ? NOW - (30 - i) * DAY : NOW + DAY)]));
      for (let seed = 0; seed < 10; seed++) {
        const round = planAll([deckOf(3, unit3), deckOf(1, unit1, progress)], seed).items;
        const reviews = round.filter((i) => i.slot === 'review');
        // A deck's own round would take 5 (a quarter); Study all takes every due form (each cell once).
        expect(reviews.length).toBeGreaterThan(5);
        expect(reviews.every((i) => i.deckId === 1)).toBe(true);
        expect(round.filter((i) => i.deckId === 3)).toHaveLength(20 - reviews.length);
      }
      // Most overdue first: with one slot, the 30-day-old one.
      const one = planAll([deckOf(3, unit3), deckOf(1, unit1, progress)], 1, 1).items;
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ deckId: 1, slot: 'review' });
      expect(cellOf(one[0])).toBe(cellOf(unit1[0]));
    });

    it('asks forms in progress before new ones: second-day checks first, then the lowest rung', () => {
      // Unit 1 half-way: 4 checks (right at the top yesterday), 6 typed, the rest never asked; Unit 3 new.
      const progress = new Map<string, ProgressState>();
      const checks = to(unit1).slice(0, 4);
      const typedLow = to(unit1).slice(4, 7);
      const typedHigh = to(unit1).slice(7, 10);
      for (const it of checks) progress.set(it.key, { level: 2, mastered: false, firstTopDay: YESTERDAY });
      for (const it of typedLow) progress.set(it.key, { level: 1, mastered: false });
      for (const it of typedHigh) progress.set(it.key, { level: 2, mastered: false });
      const decks = [deckOf(3, unit3), deckOf(1, unit1, progress)];
      for (let seed = 0; seed < 10; seed++) {
        const round = planAll(decks, seed).items;
        const has = (list: Item[]) => list.every((x) => round.some((i) => i.key === x.key && i.deckId === 1));
        expect(has([...checks, ...typedLow, ...typedHigh])).toBe(true);
        // The rest: new forms, the newest deck's first.
        expect(round.filter((i) => i.deckId === 3)).toHaveLength(10);
      }
      // Two slots: the checks; five: the checks, then the lowest rung.
      const two = planAll(decks, 3, 2).items;
      expect(two.every((i) => checks.some((c) => c.key === i.key))).toBe(true);
      const five = planAll(decks, 3, 5).items;
      expect(five.filter((i) => checks.some((c) => c.key === i.key))).toHaveLength(4);
      expect(five.filter((i) => typedLow.some((c) => c.key === i.key))).toHaveLength(1);
    });

    it('takes new forms newest deck first, "give the form" first, one cell once', () => {
      for (let seed = 0; seed < 10; seed++) {
        const round = planAll([deckOf(3, unit3), deckOf(1, unit1)], seed).items;
        // Unit 3's 15 cells, then Unit 1's: "give the form" for each, never both directions of a cell.
        expect(round.filter((i) => i.deckId === 3)).toHaveLength(15);
        expect(round.filter((i) => i.deckId === 1)).toHaveLength(5);
        expect(round.every((i) => i.direction === 'to' && i.slot === 'own')).toBe(true);
        expect(new Set(round.map(cellOf)).size).toBe(20);
      }
      // The same verb in two decks (Unit 1's tener in Unit 3 too): asked once, from the newest deck.
      const both = planAll([deckOf(3, unit1), deckOf(1, unit1)], 1, 60).items;
      expect(new Set(both.map(cellOf)).size).toBe(both.length);
      expect(both.every((i) => i.deckId === 3)).toBe(true);
    });

    it('fills with forms right at the top today, then mastered ones, only when nothing else is left; all mastered is a review round', () => {
      // Unit 1 asks for forms only, all of them right at the top today: they cannot move until another day.
      const todayTop = new Map(to(unit1).map((it) => [it.key, { level: 2, mastered: false, firstTopDay: TODAY } as ProgressState]));
      const unit1Today = deckOf(1, to(unit1), todayTop, { directions: 'toForm' });
      const short = planAll([deckOf(3, unit3), unit1Today], 1).items;
      expect(short.filter((i) => i.deckId === 3)).toHaveLength(15);
      expect(short.filter((i) => todayTop.has(i.key))).toHaveLength(5);
      // A longer round: all of Unit 3's new forms, then all of today's top-rung forms, then mastered ones.
      const mastered3 = new Map(to(unit3).slice(0, 3).map((it) => [it.key, done(it)]));
      const long = planAll([deckOf(3, to(unit3), mastered3, { directions: 'toForm' }), unit1Today], 1, 60).items;
      expect(long.filter((i) => i.slot === 'own' && i.deckId === 3)).toHaveLength(12);
      expect(long.filter((i) => todayTop.has(i.key))).toHaveLength(10);
      expect(long.filter((i) => i.slot === 'filler')).toHaveLength(3);
      expect(planAll([deckOf(3, to(unit3), mastered3, { directions: 'toForm' }), unit1Today], 1, 22).items.filter((i) => i.slot === 'filler')).toHaveLength(0);
      const all = new Map(unit1.map((it) => [it.key, done(it)]));
      const review = planAll([deckOf(1, unit1, all)], 2, 8);
      expect(review.review).toBe(true);
      expect(review.items).toHaveLength(8);
      expect(review.items.every((i) => i.slot === 'filler')).toBe(true);
      expect(planAll([deckOf(1, unit1, todayTop)], 2).review).toBe(false);
    });
  });

  it('describes an item for the teacher', () => {
    expect(describeItem('gustarle|present|yo|pl|to', settings)).toMatchObject({
      entryLabel: 'gustarle', tenseLabel: 'presente', personLabel: 'a mí', number: 'pl', direction: 'toForm', form: 'me gustan',
    });
    expect(describeItem('haber-impersonal|preterite|el|-|from', settings)).toMatchObject({ entryLabel: 'haber (hay)', form: 'hubo' });
    expect(describeItem('nonsense', settings)).toBeNull();
  });
});

describe('the short person cue (v1.24.0)', () => {
  it('picks the subject seen least recently, the seed breaking ties', () => {
    const three = ['ellos', 'ellas', 'ustedes'];
    expect(pickSubject(['yo'], undefined, [], 1)).toBe('yo');
    expect(pickSubject([], undefined, [], 1)).toBeUndefined();
    // Never seen beats seen; the oldest seen beats the newer.
    expect(pickSubject(three, { ellos: 5, ellas: 9 }, [], 1)).toBe('ustedes');
    expect(pickSubject(three, { ellos: 5, ellas: 9, ustedes: 7 }, [], 1)).toBe('ellos');
    // Shown in this round is more recent than anything stored.
    expect(pickSubject(three, { ellos: 5, ellas: 9, ustedes: 7 }, ['ellos'], 1)).toBe('ustedes');
    expect(pickSubject(three, undefined, ['ellas', 'ellos'], 1)).toBe('ustedes');
    expect(pickSubject(three, undefined, ['ellas', 'ellos', 'ustedes'], 1)).toBe('ellas');
    // Ties: the same seed gives the same subject, and the seeds spread over all three.
    const firsts = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const subject = pickSubject(three, undefined, [], seed);
      expect(pickSubject(three, undefined, [], seed)).toBe(subject);
      firsts.add(subject as string);
    }
    expect([...firsts].sort()).toEqual(['ellas', 'ellos', 'ustedes']);
  });

  it('builds the same subject for the same seed and history, and takes turns through a round snapshot', () => {
    const settings = settingsWith();
    const it = item('tener', 'present', 'ellos', 'to');
    const snap = snapshotOf(settings, ['tener']);
    expect(buildPrompt(it, 0, snap, seededRandom(4)).subject).toBe(buildPrompt(it, 0, snap, seededRandom(4)).subject);
    const seen: Record<string, number> = {};
    const shown: string[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const subject = buildPrompt(it, 1, { ...snap, subjectsSeen: { 'tener|present|ellos|-': { ...seen } } }, seededRandom(turn)).subject as string;
      expect(shown).not.toContain(subject);
      shown.push(subject);
      seen[subject] = 1000 + turn;
    }
    expect(shown.sort()).toEqual(['ellas', 'ellos', 'ustedes']);
    // The other direction of the cell counts too: the snapshot is by cell.
    const from = item('tener', 'present', 'ellos', 'from');
    expect(buildPrompt(from, 0, { ...snap, subjectsSeen: { 'tener|present|ellos|-': { ellos: 1, ellas: 2 } } }, seededRandom(9)).subject).toBe('ustedes');
    // Impersonal verbs name no one; commands keep their one label; a dative names one experiencer.
    expect(buildPrompt(item('haber-impersonal', 'present', 'el', 'to'), 0, snapshotOf(settings, ['haber-impersonal']), seededRandom(1)).subject).toBeUndefined();
    const commands = settingsWith({ tenses: ['imperativeAffirmative'] });
    expect(buildPrompt(item('hablar', 'imperativeAffirmative', 'ellos', 'to'), 0, snapshotOf(commands, ['hablar']), seededRandom(1)).subject).toBe('ustedes');
    expect(['a ellos', 'a ellas', 'a ustedes'])
      .toContain(buildPrompt(item('gustarle', 'present', 'ellos', 'to', 'pl'), 0, snapshotOf(settings, ['gustarle']), seededRandom(1)).subject);
  });

  it('takes turns within a round, and asks a retry again with the subject it missed', () => {
    const settings = settingsWith();
    const snap = snapshotOf(settings, ['tener']);
    const ellos = item('tener', 'present', 'ellos', 'to');
    const queue: QueueEntry[] = [
      { ...ellos, built: { ...buildPrompt(ellos, 0, snap, seededRandom(1)), subject: 'ellas' } },
      { ...item('tener', 'present', 'yo', 'to'), built: buildPrompt(item('tener', 'present', 'yo', 'to'), 0, snap, seededRandom(1)) },
      { ...item('tener', 'present', 'ellos', 'from'), built: { ...buildPrompt(item('tener', 'present', 'ellos', 'from'), 0, snap, seededRandom(1)), subject: 'ustedes' } },
      { ...ellos, retry: true },
    ];
    expect(turnsInRound(queue, 3, { ...ellos, retry: true })).toEqual({ shown: ['ellas', 'ustedes'], again: 'ellas', retryOf: {} });
    expect(turnsInRound(queue, 1, ellos)).toEqual({ shown: ['ellas'] });
    // A new prompt of the cell takes the next turn; the retry of the missed one asks with its subject again.
    expect(buildPrompt(ellos, 0, snap, seededRandom(2), { shown: ['ellas', 'ustedes'] }).subject).toBe('ellos');
    expect(buildPrompt(ellos, 0, snap, seededRandom(2), turnsInRound(queue, 3, { ...ellos, retry: true })).subject).toBe('ellas');
    // A subject the cell no longer has (settings changed) is not forced.
    expect(['ellos', 'ellas', 'ustedes']).toContain(buildPrompt(ellos, 0, snap, seededRandom(2), { again: 'usted' }).subject);
  });

  it('grades by the cell, not by the subject shown', () => {
    const settings = settingsWith();
    const typed = built(item('tener', 'present', 'ellos', 'to'), settings, 'typed-lenient');
    typed.entry.built!.subject = 'ustedes';
    expect(clientPrompt(typed.entry, 0, 1, typed.snap)).toMatchObject({ personLabel: 'ustedes', personId: 'ellos' });
    const grade = (text: string) => gradeAnswer(typed.entry, { text }, typed.snap);
    expect(grade('tienen').result).toBe('correct');
    expect(grade('ellos tienen').result).toBe('correct');
    expect(grade('ellas tienen').result).toBe('correct');
    expect(grade('Uds. tienen').result).toBe('correct');
    expect(grade('tú tienen').result).toBe('wrong');
    // The named mistake is the same as before: the person whose form it is, nothing about the subject.
    expect(grade('tienes')).toMatchObject({ result: 'wrong', mistake: { kind: 'person', detail: { person: 'tu' } } });
    expect(grade('tiene')).toMatchObject({ result: 'wrong', mistake: { kind: 'person', detail: { person: 'el' } }, sharedBy: { form: 'tienen', subjects: ['ellos', 'ellas', 'ustedes'] } });
  });

  it('lists everyone who shares the form, across persons (tenía = yo · él · ella · usted)', () => {
    const imperfect = settingsWith({ tenses: ['imperfect'] });
    expect(sharedByOf(item('tener', 'imperfect', 'el', 'to'), 'tenía', imperfect))
      .toEqual({ form: 'tenía', person: 'el', persons: ['yo', 'el'], subjects: ['yo', 'él', 'ella', 'usted'] });
    expect(sharedByOf(item('tener', 'imperfect', 'yo', 'from'), 'tenía', imperfect))
      .toEqual({ form: 'tenía', person: 'yo', persons: ['yo', 'el'], subjects: ['yo', 'él', 'ella', 'usted'] });
    const conditional = settingsWith({ tenses: ['conditional'] });
    expect(sharedByOf(item('tener', 'conditional', 'yo', 'to'), 'tendría', conditional)?.subjects).toEqual(['yo', 'él', 'ella', 'usted']);
    const subjunctive = settingsWith({ tenses: ['presentSubjunctive'] });
    expect(sharedByOf(item('tener', 'presentSubjunctive', 'el', 'to'), 'tenga', subjunctive)?.persons).toEqual(['yo', 'el']);
    // A form of one subject alone, in the present.
    const present = settingsWith();
    expect(sharedByOf(item('tener', 'present', 'yo', 'to'), 'tengo', present)).toBeNull();
    expect(sharedByOf(item('tener', 'present', 'ellos', 'to'), 'tienen', present))
      .toEqual({ form: 'tienen', person: 'ellos', persons: ['ellos'], subjects: ['ellos', 'ellas', 'ustedes'] });
  });

  it('counts tú and vos as sharing a form only when the deck has vos', () => {
    const without = settingsWith({ tenses: ['preterite'] });
    expect(sharedByOf(item('tener', 'preterite', 'tu', 'to'), 'tuviste', without)).toBeNull();
    const withVos = settingsWith({ tenses: ['preterite'], vos: 'rioplatense' });
    expect(sharedByOf(item('tener', 'preterite', 'tu', 'to'), 'tuviste', withVos))
      .toEqual({ form: 'tuviste', person: 'tu', persons: ['tu', 'vos'], subjects: ['tú', 'vos'] });
    expect(sharedByOf(item('tener', 'preterite', 'vos', 'to'), 'tuviste', withVos)?.subjects).toEqual(['tú', 'vos']);
    // The present differs: tienes, tenés.
    const presentVos = settingsWith({ vos: 'rioplatense' });
    expect(sharedByOf(item('tener', 'present', 'vos', 'to'), 'tenés', presentVos)).toBeNull();
    // A graded answer carries it too.
    const fromForm = built(item('tener', 'imperfect', 'el', 'from'), settingsWith({ tenses: ['imperfect'] }), 'choice');
    const right = fromForm.entry.built!.correctOptions![0];
    expect(gradeAnswer(fromForm.entry, { choice: right }, fromForm.snap).sharedBy?.subjects).toEqual(['yo', 'él', 'ella', 'usted']);
  });

  it('still grades a "name the verb" prompt built before v1.24.0, from its long labels (a round in progress at the deploy)', () => {
    const settings = settingsWith({ tenses: ['present', 'preterite'] });
    const fresh = built(item('tener', 'present', 'ellos', 'from'), settings, 'choice', ['tener', 'vivir'], 3);
    // What v1.23.0 stored: long option labels, no readings, no subject, no verb in the question.
    const long = (fresh.entry.built!.optionReadings ?? []).map((r) => readingLabel(r, true));
    const old: QueueEntry = {
      ...fresh.entry,
      built: { ...fresh.entry.built!, options: long, correctOptions: [readingLabel(fresh.entry, true)] },
    };
    delete old.built!.optionReadings;
    delete old.built!.subject;
    delete old.built!.optionsVerb;
    const prompt = clientPrompt(old, 0, 1, fresh.snap);
    expect(prompt).toMatchObject({ optionsVerb: null, options: long });
    expect(long).toContain('tener · ellos / ellas / ustedes · presente');
    for (const option of long) {
      const graded = gradeAnswer(old, { choice: option }, fresh.snap);
      if (option === 'tener · ellos / ellas / ustedes · presente') {
        expect(graded).toMatchObject({ result: 'correct', correctAnswer: 'tener · ellos / ellas / ustedes · presente', rightOptions: [option] });
      } else {
        expect(graded.result).toBe('wrong');
        // The mistake is still named from the long label: never "unknown".
        expect(graded.mistake?.kind, option).not.toBe('unknown');
        expect(['person', 'tense', 'otherVerb']).toContain(graded.mistake?.kind);
      }
    }
    // An old "give the form" prompt keeps the whole group on the page.
    const toForm = built(item('tener', 'present', 'ellos', 'to'), settings, 'choice');
    delete toForm.entry.built!.subject;
    expect(clientPrompt(toForm.entry, 0, 1, toForm.snap).personLabel).toBe('ellos / ellas / ustedes');
  });

  it('names the verb in the question when every option shares it, and keeps it in each option when they differ', () => {
    const settings = settingsWith();
    // "hay" in a one-tense deck: the options are other verbs, each named.
    const hay = built(item('haber-impersonal', 'present', 'el', 'from'), settings, 'choice', ['haber-impersonal', 'llover', 'ser', 'tener'], 2);
    expect(hay.entry.built!.optionsVerb).toBeUndefined();
    expect(hay.entry.built!.options).toContain('haber');
    expect(hay.entry.built!.correctOptions).toEqual(['haber']);
    // "fue" is ser and ir: ir is right too, so it is never a wrong option, and the rest are ser.
    const fue = built(item('ser', 'preterite', 'el', 'from'), settingsWith({ tenses: ['present', 'preterite'] }), 'choice', ['ser', 'ir'], 2);
    expect(fue.entry.built!.optionsVerb).toBe('ser');
    const tener = built(item('tener', 'present', 'ellos', 'from'), settings, 'choice', ['tener'], 2);
    expect(tener.entry.built).toMatchObject({ optionsVerb: 'tener' });
    for (const option of tener.entry.built!.options ?? []) expect(option.split(' · ')).toHaveLength(1);
  });

  it('shows the teacher the group, short', () => {
    expect(describeItem('tener|present|ellos|-|to', { vos: 'none' })).toMatchObject({ personLabel: 'ellos/ellas/Uds.', form: 'tienen' });
    expect(describeItem('gustarle|present|el|pl|to', { vos: 'none' })).toMatchObject({ personLabel: 'a él/ella/Ud.' });
    expect(previewEntry('tener', settingsWith()).map((c) => c.personLabel)).toEqual(['yo', 'tú', 'él/ella/Ud.', 'nosotros/as', 'ellos/ellas/Uds.']);
  });
});

describe('sentences with a blank (v1.25.0)', () => {
  const settings = settingsWith({ sentences: 'builtIn' });
  const snap = snapshotOf(settings, UNIT1_ENTRIES);
  const deckData = {
    deck: { tenses: settings.tenses, vosotros: false, vos: null, entries: UNIT1_ENTRIES, cards: UNIT1, earlierCards: [] },
    hidden: new Set<string>(),
    rows: [],
    key: 'quiz-test',
  };
  const poolFor = (it: Item) => cellPool(deckData, 'builtIn', it.entry, { tense: it.tense, person: it.person as 'yo', ...(it.number ? { number: it.number } : {}) });
  const buildWith = (it: Item, level: number, extra: Partial<SentenceTurn> = {}) =>
    buildPrompt(it, level, snap, seededRandom(4), { sentence: { pool: poolFor(it), recent: [], holdback: null, ...extra } });

  it('keeps settings from before v1.25.0 on the label', () => {
    const old: Partial<QuizSettings> = { ...settings };
    delete old.sentences;
    delete old.sentenceHoldback;
    expect(sentenceModeOf(old)).toBe('off');
    expect(parseSettings(settingsToRow(settings))).toMatchObject({ sentences: 'builtIn', sentenceHoldback: false });
    expect(parseSettings({ ...settingsToRow(settings), sentences: 'often' })).toMatchObject({ sentences: 'off' });
  });

  it('builds the sentence into the prompt, which then names no subject, and shows the page no answer', () => {
    const vivir = item('vivir', 'present', 'ellos', 'to');
    const choice = buildWith(vivir, 0);
    expect(choice.sentence).toBeDefined();
    expect(choice.subject).toBeUndefined();
    const page = clientPrompt({ ...vivir, built: choice }, 0, 1, snap);
    expect(page).toMatchObject({ personId: null, cue: null, sentence: { cue: 'vivir', hint: choice.sentence!.subject?.pronoun ?? null } });
    // For a page from before v1.25.0, which shows only `personLabel` (verb with no subject otherwise): the
    // sentence's own subject, nothing it does not show already.
    expect(page.personLabel).toBe(choice.sentence!.subject!.es);
    expect(`${choice.sentence!.before} ${choice.sentence!.after}`.toLowerCase()).toContain(page.personLabel!.toLowerCase());
    expect(page.options).toContain('viven');
    const typed = buildWith(vivir, 1);
    const typedPage = clientPrompt({ ...vivir, built: typed }, 0, 1, snap);
    expect(typedPage.sentence?.hint).toBeNull();
    expect(JSON.stringify(typedPage)).not.toMatch(/viven|english/);
    // An empty pool, or no sentence turn: the label as before.
    expect(buildWith(vivir, 0, { pool: [] }).sentence).toBeUndefined();
    expect(buildPrompt(vivir, 0, snap, seededRandom(4)).subject).toBeDefined();
  });

  it('grades a typed sentence by its blank, echo and all, and gives the filled sentence back', () => {
    const llamarse = item('llamarse', 'present', 'el', 'to');
    const prompt = buildWith(llamarse, 1);
    const s = prompt.sentence!;
    const entry = { ...llamarse, built: prompt };
    const echo = gradeAnswer(entry, { text: `${s.before} se llama ${s.after}` }, snap);
    expect(echo).toMatchObject({ result: 'correct', counted: true });
    expect(echo.sentence).toMatchObject({ filled: expect.stringContaining('se llama'), english: s.english });
    const missing = gradeAnswer(entry, { text: `${s.before} llama ${s.after}` }, snap);
    expect(missing.result).toBe('wrong');
    expect(missing.mistake?.kind).toBe('pronounMissing');
    // A label prompt's answer has no sentence.
    const label = { ...llamarse, built: buildPrompt(llamarse, 1, snap, seededRandom(4)) };
    expect(gradeAnswer(label, { text: 'se llama' }, snap).sentence).toBeNull();
  });

  it('keeps what a retry showed: its sentence (another of its subject) and its holdback', () => {
    const vivir = item('vivir', 'present', 'ellos', 'to');
    const first = buildWith(vivir, 0, { holdback: { arm: 'sentence', probe: false } });
    expect(first.holdback).toEqual({ arm: 'sentence', probe: false });
    const queue: QueueEntry[] = [{ ...vivir, built: first }, { ...vivir, retry: true }];
    const turns = turnsInRound(queue, 1, queue[1]);
    expect(turns.sentencesShown).toEqual([first.sentence!.ref]);
    expect(turns.retryOf).toEqual({ sentence: first.sentence, holdback: first.holdback });
  });
});
