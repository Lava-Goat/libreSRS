// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const PERIOD_1 = 5;
const PERIOD_2 = 6;
const UNIT_2 = 10;
const UNIT_10 = 11;
const OTHER = 12;
const ADMIN = 1;
const ANA = 2;
const BETO = 3;
const CARLA = 4;

/** 2026-09-24 in Los Angeles (PDT, UTC-7) runs from 07:00Z that day to 07:00Z the next. */
const DAY = '2026-09-24';
const at = (iso: string) => new Date(iso);

async function load() {
  vi.resetModules();
  vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
  // The pace rule's numbers (studyPace.ts): the grid must say the same.
  const rule = await import('./studyPace.js');
  return { ...(await import('./flashcardDay.js')), rule };
}

const GOOD = 3;
const EASY = 4;

async function rating(userId: number, cardId: number, reviewedAt: string, previousState: number, timeSpentMs = 30_000, rated = GOOD) {
  await testDb.insert(schema.reviewLogs).values({
    userId, cardId, rating: rated, reviewedAt: at(reviewedAt), timeSpentMs, previousState, newState: 2,
  });
}

/** Unit 2's twenty more cards (200-219), for a day's worth of new cards. */
async function moreCards() {
  await testDb.insert(schema.cards).values(Array.from({ length: 20 }, (_, i) => ({
    id: 200 + i, deckId: UNIT_2, front: `palabra ${i}`, back: `word ${i}`,
  })));
}

/** A second from 16:00Z on the day, for ratings in order. */
const second = (n: number) => new Date(Date.parse('2026-09-24T16:00:00Z') + n * 1000).toISOString();

async function completion(userId: number, completedAt: string, fields: Partial<typeof schema.studyCompletions.$inferInsert>) {
  await testDb.insert(schema.studyCompletions).values({
    userId, reason: 'session_complete', completedAt: at(completedAt), ...fields,
  });
}

describe('groupFlashcardDay', () => {
  beforeEach(async () => {
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: ADMIN, googleId: 'a', email: 'teacher@example.com', name: 'Teacher', role: 'admin' },
      { id: ANA, googleId: 'b', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: BETO, googleId: 'c', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: CARLA, googleId: 'd', email: 'carla@example.com', name: 'Carla', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([{ id: PERIOD_1, name: 'Period 1' }, { id: PERIOD_2, name: 'Period 2' }]);
    await testDb.insert(schema.userGroups).values([
      { userId: ADMIN, groupId: PERIOD_1 },
      { userId: BETO, groupId: PERIOD_1 },
      { userId: ANA, groupId: PERIOD_1 },
      { userId: CARLA, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.decks).values([
      { id: UNIT_10, name: 'Unit 10', createdBy: ADMIN },
      { id: UNIT_2, name: 'Unit 2', createdBy: ADMIN },
      { id: OTHER, name: 'Other', createdBy: ADMIN },
    ]);
    await testDb.insert(schema.deckGroups).values([
      { deckId: UNIT_10, groupId: PERIOD_1 },
      { deckId: UNIT_2, groupId: PERIOD_1 },
      { deckId: OTHER, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.cards).values([
      { id: 100, deckId: UNIT_2, front: 'hola', back: 'hello' },
      { id: 101, deckId: UNIT_2, front: 'adiós', back: 'bye' },
      { id: 110, deckId: UNIT_10, front: 'casa', back: 'house' },
      { id: 120, deckId: OTHER, front: 'perro', back: 'dog' },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('marks who finished each deck that day, with their work, students only and by name', async () => {
    // Ana: two new cards, a learning step and a review in Unit 2, then "All Done!" twice that day.
    await rating(ANA, 100, '2026-09-24T16:00:00Z', 0);
    await rating(ANA, 101, '2026-09-24T16:01:00Z', 0);
    await rating(ANA, 100, '2026-09-24T16:02:00Z', 1);
    await rating(ANA, 101, '2026-09-24T16:03:00Z', 2);
    await completion(ANA, '2026-09-24T17:00:00Z', { deckId: UNIT_2 });
    await completion(ANA, '2026-09-24T20:00:00Z', { deckId: UNIT_2 });
    // Beto studied Unit 10 but never reached "All Done!".
    await rating(BETO, 110, '2026-09-24T18:00:00Z', 0);
    // The teacher's own sloth is not a student's.
    await rating(ADMIN, 100, '2026-09-24T18:00:00Z', 0);
    await completion(ADMIN, '2026-09-24T18:05:00Z', { deckId: UNIT_2 });

    const { groupFlashcardDay } = await load();
    const view = groupFlashcardDay(PERIOD_1, DAY);

    expect(view.day).toBe(DAY);
    expect(view.groupNewLimit).toBe(20);
    // Decks and students by name, numbers in order ("Unit 2" before "Unit 10"); never the teacher.
    expect(view.decks).toEqual([{ id: UNIT_2, name: 'Unit 2' }, { id: UNIT_10, name: 'Unit 10' }]);
    expect(view.students.map((s) => s.name)).toEqual(['Ana', 'Beto']);

    const [ana, beto] = view.students;
    expect(ana.cells[0]).toEqual({
      deckId: UNIT_2,
      finishedAt: Date.parse('2026-09-24T20:00:00Z'),
      finishes: 2,
      newCards: 2,
      reviews: 1,
      answers: 4,
      minutes: 2,
      // Two first answers (each card's first rating that day) at 30 s: not fast, and no Easy.
      medianFirstMs: 30_000,
      easyNew: 0,
      fast: false,
      allEasy: false,
      newLimit: 20,
      lowLimit: false,
    });
    expect(ana.cells[1]).toMatchObject({ deckId: UNIT_10, finishedAt: null, finishes: 0, answers: 0 });
    expect(beto.cells[0]).toMatchObject({ deckId: UNIT_2, finishedAt: null, answers: 0 });
    expect(beto.cells[1]).toMatchObject({ deckId: UNIT_10, finishedAt: null, finishes: 0, newCards: 1, answers: 1 });
  });

  it('ignores "nothing due" and a virtual deck, and another group\'s decks', async () => {
    const [virtual] = await testDb.insert(schema.virtualDecks).values({
      name: 'Hard ones', userId: ANA, sourceDeckId: UNIT_10, cardSelection: '1',
    }).returning();
    await completion(ANA, '2026-09-24T17:00:00Z', { deckId: UNIT_2, reason: 'nothing_due' });
    await completion(ANA, '2026-09-24T17:10:00Z', { deckId: null, virtualDeckId: virtual.id });
    // Even a virtual deck's row that names its deck is a selection, not the deck's day.
    await completion(ANA, '2026-09-24T17:20:00Z', { deckId: UNIT_10, virtualDeckId: virtual.id });
    // Carla's deck is not this group's, and she is not in it.
    await completion(CARLA, '2026-09-24T17:00:00Z', { deckId: OTHER });

    const { groupFlashcardDay } = await load();
    const view = groupFlashcardDay(PERIOD_1, DAY);
    expect(view.decks.map((d) => d.id)).not.toContain(OTHER);
    expect(view.students.map((s) => s.id)).not.toContain(CARLA);
    for (const cell of view.students[0].cells) {
      expect(cell).toMatchObject({ finishedAt: null, finishes: 0 });
    }
  });

  it('counts 11:30 pm in Los Angeles in that day, and 12:30 am in the next', async () => {
    await rating(ANA, 100, '2026-09-24T06:30:00Z', 0); // 11:30 pm on the 23rd
    await rating(ANA, 101, '2026-09-25T06:30:00Z', 0); // 11:30 pm on the 24th
    await completion(ANA, '2026-09-25T06:31:00Z', { deckId: UNIT_2 }); // 11:31 pm on the 24th
    await rating(ANA, 100, '2026-09-25T07:30:00Z', 2); // 12:30 am on the 25th
    await completion(ANA, '2026-09-25T07:31:00Z', { deckId: UNIT_2 }); // 12:31 am on the 25th

    const { groupFlashcardDay } = await load();
    const cell = groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0];
    expect(cell).toMatchObject({ finishedAt: Date.parse('2026-09-25T06:31:00Z'), newCards: 1, reviews: 0, answers: 1 });

    expect(cell.finishes).toBe(1);
    const next = groupFlashcardDay(PERIOD_1, '2026-09-25').students[0].cells[0];
    expect(next).toMatchObject({ finishedAt: Date.parse('2026-09-25T07:31:00Z'), finishes: 1, newCards: 0, reviews: 1, answers: 1 });

    // Without a day it is today at the school: 11:30 pm on the 24th there.
    expect(groupFlashcardDay(PERIOD_1, undefined, new Date('2026-09-25T06:45:00Z')).day).toBe(DAY);
  });

  it('flags a new-card limit below the group\'s', async () => {
    await testDb.insert(schema.groupSettings).values({ groupId: PERIOD_1, newCardsPerDay: 15, reviewsPerDay: 20, isOverride: true });
    // Beto's teacher locked him at 5 new cards.
    await testDb.insert(schema.userSettings).values({
      userId: BETO, newCardsPerDay: 5, reviewsPerDay: 20, isOverride: true, allowHigher: false, allowLower: false,
    });
    // Ana set 10 on Unit 10 herself (no lock), and 30 on Unit 2.
    await testDb.insert(schema.deckUserSettings).values([
      { userId: ANA, deckId: UNIT_10, newCardsPerDay: 10, reviewsPerDay: 20 },
      { userId: ANA, deckId: UNIT_2, newCardsPerDay: 30, reviewsPerDay: 20 },
    ]);

    const { groupFlashcardDay } = await load();
    const view = groupFlashcardDay(PERIOD_1, DAY);
    expect(view.groupNewLimit).toBe(15);
    const [ana, beto] = view.students;
    expect(ana.cells.map((c) => [c.newLimit, c.lowLimit])).toEqual([[30, false], [10, true]]);
    expect(beto.cells.map((c) => [c.newLimit, c.lowLimit])).toEqual([[5, true], [5, true]]);
  });

  it('compares with the app\'s default while the group\'s Override is off: its number was never applied', async () => {
    // The teacher set 30 in Group settings and left Override off; Ana has the default 20, Beto 10.
    await testDb.insert(schema.groupSettings).values({ groupId: PERIOD_1, newCardsPerDay: 30, reviewsPerDay: 20, isOverride: false });
    await testDb.insert(schema.userSettings).values({ userId: BETO, newCardsPerDay: 10, reviewsPerDay: 20 });
    const { groupFlashcardDay } = await load();
    const view = groupFlashcardDay(PERIOD_1, DAY);
    expect(view.groupNewLimit).toBe(20);
    const [ana, beto] = view.students;
    expect(ana.cells.every((c) => c.newLimit === 20 && !c.lowLimit)).toBe(true);
    expect(beto.cells.every((c) => c.newLimit === 10 && c.lowLimit)).toBe(true);
  });

  describe('how fast the cards went, by the pace rule', () => {
    it('marks a day of Easy on every new card at 0.4 s a card as fast and all Easy', async () => {
      await moreCards();
      for (let i = 0; i < 20; i += 1) await rating(ANA, 200 + i, second(i), 0, 400, EASY);
      await completion(ANA, second(30), { deckId: UNIT_2 });
      const { groupFlashcardDay } = await load();
      expect(groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0]).toMatchObject({
        newCards: 20, answers: 20, minutes: 0, medianFirstMs: 400, easyNew: 20, fast: true, allEasy: true,
      });
    });

    it('takes the median of first answers only: quick learning steps are re-views for everyone', async () => {
      await moreCards();
      // Four new cards read slowly, then six quick learning-step answers (Again, then again).
      for (let i = 0; i < 4; i += 1) await rating(BETO, 200 + i, second(i * 10), 0, 3_000);
      for (let i = 0; i < 6; i += 1) await rating(BETO, 200 + (i % 4), second(60 + i), 1, 200);
      const { groupFlashcardDay, rule } = await load();
      const cell = groupFlashcardDay(PERIOD_1, DAY).students[1].cells[0];
      expect(cell).toMatchObject({ newCards: 4, answers: 10, medianFirstMs: 3_000, fast: false });
      // Over every rating the median would be 200 ms: "fast" for an honest student.
      expect(200).toBeLessThan(rule.FAST_FIRST_ANSWER_MEDIAN_MS);
    });

    it('counts a card carried over in learning from an earlier day: its first rating that day is a first answer, its later steps are not', async () => {
      await moreCards();
      // The day before: six new cards rated Again and left in learning.
      for (let i = 0; i < 6; i += 1) await rating(ANA, 200 + i, `2026-09-23T16:00:0${i}Z`, 0, 5_000, 1);
      // That day: two new cards read slowly, the six carry-overs mashed through, then one more quick step each.
      await rating(ANA, 206, second(0), 0, 5_000);
      await rating(ANA, 207, second(1), 0, 5_000);
      for (let i = 0; i < 6; i += 1) await rating(ANA, 200 + i, second(10 + i), 1, 300);
      for (let i = 0; i < 6; i += 1) await rating(ANA, 200 + i, second(100 + i), 1, 200);
      const { groupFlashcardDay, rule } = await load();
      const cell = groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0];
      expect(cell).toMatchObject({ newCards: 2, answers: 14, medianFirstMs: 300, fast: 300 < rule.FAST_FIRST_ANSWER_MEDIAN_MS });
      // The same first answers the pace rule reads (studyPace.ts firstAnswersSince).
      const first = rule.firstAnswersSince(ANA, UNIT_2, new Date('2026-09-24T07:00:00Z'));
      expect(rule.medianMs(first.timesMs)).toBe(cell.medianFirstMs);
    });

    it('counts a review\'s first answer, and a few fast cards among slow ones do not make the day fast', async () => {
      await moreCards();
      for (let i = 0; i < 3; i += 1) await rating(ANA, 200 + i, second(i), 0, 300);
      for (let i = 3; i < 7; i += 1) await rating(ANA, 200 + i, second(i), 2, 5_000);
      const { groupFlashcardDay } = await load();
      expect(groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0]).toMatchObject({
        newCards: 3, reviews: 4, medianFirstMs: 5_000, fast: false, easyNew: 0, allEasy: false,
      });
    });

    it('counts a rating for at most 2 minutes, in the minutes and in the median', async () => {
      // A card left open over lunch, as an old row or a forged page could claim it.
      await rating(ANA, 100, second(0), 0, 3_600_000);
      await rating(ANA, 101, second(1), 0, 3_600_000);
      await rating(ANA, 100, second(2), 1, 60_000);
      const { groupFlashcardDay, RATING_TIME_CAP_MS } = await load();
      expect(RATING_TIME_CAP_MS).toBe(120_000);
      expect(groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0]).toMatchObject({
        answers: 3, minutes: 5, medianFirstMs: 120_000, fast: false,
      });
    });

    it('has no median and no marks for a student who did nothing', async () => {
      const { groupFlashcardDay } = await load();
      expect(groupFlashcardDay(PERIOD_1, DAY).students[0].cells[0]).toMatchObject({
        answers: 0, minutes: 0, medianFirstMs: null, easyNew: 0, newCards: 0, fast: false, allEasy: false,
      });
    });

    it('marks at the pace rule\'s numbers: under the minimum median is fast, at it is not', async () => {
      const { paceOf, rule } = await load();
      const T = rule.FAST_FIRST_ANSWER_MEDIAN_MS;
      expect(paceOf([T - 1], 0, 0).fast).toBe(true);
      expect(paceOf([T], 0, 0).fast).toBe(false);
      // An even count: the middle two's mean, as studyPace.ts medianMs takes it.
      expect(paceOf([T - 100, T + 100, 10, 1_000_000], 0, 0)).toMatchObject({ medianFirstMs: T, fast: false });
      expect(paceOf([T - 101, T + 100, 10, 1_000_000], 0, 0).fast).toBe(rule.medianMs([T - 101, T + 100, 10, 1_000_000])! < T);
      expect(paceOf([], 0, 0)).toEqual({ medianFirstMs: null, easyNew: 0, newCards: 0, fast: false, allEasy: false });
    });

    it('marks Easy on nearly every new card only with enough new cards, at the pace rule\'s share', async () => {
      const { paceOf, rule } = await load();
      const n = rule.ALL_EASY_MIN_NEW_CARDS;
      const enough = Math.ceil(rule.ALL_EASY_MIN_SHARE * n);
      expect(paceOf([5_000], enough, n).allEasy).toBe(true);
      expect(paceOf([5_000], enough - 1, n).allEasy).toBe(false);
      // Too few new cards to say.
      expect(paceOf([5_000], n - 1, n - 1).allEasy).toBe(false);
      // 18 of 20 is 90 %.
      expect(paceOf([5_000], 18, 20).allEasy).toBe(rule.ALL_EASY_MIN_SHARE <= 0.9 && 20 >= n);
    });
  });

  it('marks who finished ALL their flashcards that day (v1.18.0), students only, on the school\'s day', async () => {
    await testDb.insert(schema.flashcardAllDone).values([
      { userId: ANA, day: DAY, completedAt: at('2026-09-24T17:30:00Z'), deckIds: JSON.stringify([UNIT_10, UNIT_2]) },
      // Beto's was the day before; the teacher's is never a student's.
      { userId: BETO, day: '2026-09-23', completedAt: at('2026-09-23T17:30:00Z'), deckIds: JSON.stringify([UNIT_2]) },
      { userId: ADMIN, day: DAY, completedAt: at('2026-09-24T18:00:00Z'), deckIds: '[]' },
    ]);
    const { groupFlashcardDay } = await load();
    const view = groupFlashcardDay(PERIOD_1, DAY);
    expect(view.students.map((s) => [s.name, s.allDone])).toEqual([['Ana', Date.parse('2026-09-24T17:30:00Z')], ['Beto', null]]);
    expect(groupFlashcardDay(PERIOD_1, '2026-09-23').students.map((s) => s.allDone)).toEqual([null, Date.parse('2026-09-23T17:30:00Z')]);
  });

  it('answers an empty group and a group with no decks', async () => {
    await testDb.insert(schema.groups).values([{ id: 7, name: 'Empty' }, { id: 8, name: 'No decks' }]);
    await testDb.insert(schema.userGroups).values({ userId: ANA, groupId: 8 });
    const { groupFlashcardDay } = await load();
    expect(groupFlashcardDay(7, DAY)).toEqual({ day: DAY, groupNewLimit: 20, decks: [], students: [] });
    expect(groupFlashcardDay(8, DAY)).toMatchObject({ decks: [], students: [{ id: ANA, cells: [] }] });
  });
});

describe('school days', () => {
  it('reads only real dates written YYYY-MM-DD', async () => {
    const { isDayString } = await load();
    expect(isDayString('2026-09-24')).toBe(true);
    expect(isDayString('2026-02-30')).toBe(false);
    expect(isDayString('2026-9-24')).toBe(false);
    expect(isDayString('yesterday')).toBe(false);
  });

  it('spans Los Angeles midnight to midnight, 25 and 23 hours when the clocks change', async () => {
    const { schoolDayBounds } = await load();
    const hours = (day: string) => {
      const { start, end } = schoolDayBounds(day);
      return (end - start) / 3_600_000;
    };
    expect(schoolDayBounds(DAY)).toEqual({ start: Date.parse('2026-09-24T07:00:00Z'), end: Date.parse('2026-09-25T07:00:00Z') });
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2027-03-14')).toBe(23);
    expect(schoolDayBounds('2026-12-01').start).toBe(Date.parse('2026-12-01T08:00:00Z'));
  });
});
