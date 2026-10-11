// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
vi.mock('../db/index.js', () => ({ db: testDb, schema }));

let pace: typeof import('./studyPace.js');
const ANA = 2;
const BETO = 3;
const UNIT_1 = 10;
const UNIT_2 = 11;
const GOOD = 3;
const EASY = 4;
/** A second from 16:00Z on 2026-09-24, for ratings in order. */
const second = (n: number) => new Date(Date.parse('2026-09-24T16:00:00Z') + n * 1000);

function rating(userId: number, cardId: number, at: Date, previousState: number, timeSpentMs = 3_000, rated = GOOD, cardStateId: number | null = null) {
  testDb.insert(schema.reviewLogs).values({
    userId, cardId, cardStateId, rating: rated, reviewedAt: at, timeSpentMs, previousState, newState: 2,
    scheduledDays: 0, elapsedDays: 0, stability: 1, difficulty: 5,
  } as typeof schema.reviewLogs.$inferInsert).run();
}

beforeAll(async () => {
  pace = await import('./studyPace.js');
});

beforeEach(async () => {
  await setupFsrsSchema(client, { reset: true });
  testDb.insert(schema.users).values([
    { id: 1, googleId: 'a', email: 'teacher@example.com', name: 'Teacher', role: 'admin' },
    { id: ANA, googleId: 'b', email: 'ana@example.com', name: 'Ana', role: 'user' },
    { id: BETO, googleId: 'c', email: 'beto@example.com', name: 'Beto', role: 'user' },
  ]).run();
  testDb.insert(schema.decks).values([
    { id: UNIT_1, name: 'Unit 1', createdBy: 1 },
    { id: UNIT_2, name: 'Unit 2', createdBy: 1 },
  ]).run();
  testDb.insert(schema.cards).values([
    { id: 100, deckId: UNIT_1, front: 'hola', back: 'hello' },
    { id: 101, deckId: UNIT_1, front: 'adiós', back: 'bye' },
    { id: 102, deckId: UNIT_1, front: 'gato', back: 'cat' },
    { id: 200, deckId: UNIT_2, front: 'casa', back: 'house' },
  ]).run();
});

afterAll(async () => {
  await client.close();
});

describe('the pace rule', () => {
  it('pins the pace rule\'s numbers: 1.0 s median, 10 new cards, 90 % Easy', () => {
    expect(pace.FAST_FIRST_ANSWER_MEDIAN_MS).toBe(1000);
    expect(pace.ALL_EASY_MIN_NEW_CARDS).toBe(10);
    expect(pace.ALL_EASY_MIN_SHARE).toBe(0.9);
  });

  it('takes the median: the middle value, the mean of the middle two, none for nothing', () => {
    expect(pace.medianMs([])).toBeNull();
    expect(pace.medianMs([3, 1, 2])).toBe(2);
    expect(pace.medianMs([4, 1, 3, 2])).toBe(2.5);
    expect(pace.medianMs([5])).toBe(5);
  });

  it('reads each card\'s first rating in the span only, per student, in rating order', () => {
    rating(ANA, 100, second(0), 0, 4_000);
    rating(ANA, 100, second(1), 1, 200); // a learning step: not a first answer
    rating(ANA, 101, second(2), 2, 6_000); // a review
    rating(ANA, 200, second(3), 0, 5_000); // another deck
    rating(BETO, 100, second(4), 0, 9_000); // another student
    rating(ANA, 102, new Date('2026-09-23T16:00:00Z'), 0, 1_000); // the day before
    const rows = pace.firstAnswerRows([ANA], [UNIT_1], new Date('2026-09-24T07:00:00Z'), new Date('2026-09-25T07:00:00Z'));
    expect(rows).toEqual([
      { userId: ANA, deckId: UNIT_1, timeSpentMs: 4_000, previousState: 0, rating: GOOD },
      { userId: ANA, deckId: UNIT_1, timeSpentMs: 6_000, previousState: 2, rating: GOOD },
    ]);
    expect(pace.firstAnswerRows([ANA, BETO], [UNIT_1, UNIT_2], new Date('2026-09-24T07:00:00Z')).map((r) => [r.userId, r.deckId, r.timeSpentMs]))
      .toEqual([[ANA, UNIT_1, 4_000], [ANA, UNIT_1, 6_000], [ANA, UNIT_2, 5_000], [BETO, UNIT_1, 9_000]]);
    expect(pace.firstAnswerRows([], [UNIT_1], second(0))).toEqual([]);
    expect(pace.firstAnswerRows([ANA], [], second(0))).toEqual([]);
  });

  it('counts a card carried over in learning from an earlier day: its first rating that day is a first answer', () => {
    rating(ANA, 100, new Date('2026-09-23T16:00:00Z'), 0, 5_000, 1);
    rating(ANA, 100, second(0), 1, 300);
    rating(ANA, 100, second(1), 1, 200);
    const first = pace.firstAnswersSince(ANA, UNIT_1, new Date('2026-09-24T07:00:00Z'));
    expect(first).toEqual({ timesMs: [300], newCards: 0, easyNew: 0 });
  });

  it('sums a day\'s first answers over several decks: times, new cards and new cards rated Easy', () => {
    rating(ANA, 100, second(0), 0, 2_000, EASY);
    rating(ANA, 101, second(1), 0, -50, GOOD); // a negative time counts as 0
    rating(ANA, 102, second(2), 2, 7_000, EASY); // a review rated Easy is not a new card
    rating(ANA, 200, second(3), 0, 1_500, EASY);
    expect(pace.firstAnswersSince(ANA, [UNIT_1, UNIT_2], new Date('2026-09-24T07:00:00Z')))
      .toEqual({ timesMs: [2_000, 0, 7_000, 1_500], newCards: 3, easyNew: 2 });
  });
});
