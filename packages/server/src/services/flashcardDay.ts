// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin → Groups → "Flashcards by day": who in a group reached "All Done!" in
 * each of the group's decks on one school day, and what they did there.
 *
 * - The day is a school day: a date in America/Los_Angeles, midnight to
 *   midnight there (services/conjugationQuiz.ts), so 11:30 pm is still that day.
 * - Finished means a `session_complete` row for the deck (never `nothing_due`,
 *   never a virtual deck's selection). From v1.15 the server stores one only
 *   when nothing was left under the student's limits; older rows were the
 *   page's word.
 * - The work is counted from review_logs when read, so any past day is right
 *   too: new cards (rated while New), reviews (rated while in Review), every
 *   rating (answers) and the time on the cards.
 * - How fast it went, by the pace rule (services/studyPace.ts):
 *   the median time of the day's first answers (each card's first rating that
 *   day; the learning steps after it are quick re-views for everyone) and how
 *   many new cards were rated Easy. `fast` and `allEasy` are the rule's two marks;
 *   the grid shows them whatever else uses the rule.
 * - The time a page reports is counted up to RATING_TIME_CAP_MS a rating: the
 *   server clamps new ratings to that since v1.16, and older rows could claim
 *   any time.
 * - The limit is the student's effective new-card limit for the deck (the same
 *   rule getDueCards uses); `lowLimit` marks one below the group's (its
 *   setting when its Override is on, otherwise the app's default).
 *
 * - "All flashcards" (v1.18.0): when the student first had nothing due in any
 *   deck of their groups that school day, after rating a card that day
 *   (flashcard_all_done, services/allFlashcards.ts).
 *
 * Only the group's students (never an admin) and the group's decks, by name.
 */
import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { Rating, State } from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { allFlashcardsDoneOn } from './allFlashcards.js';
import { schoolDay, startOfSchoolDay } from './conjugationQuiz.js';
import {
  ALL_EASY_MIN_NEW_CARDS,
  ALL_EASY_MIN_SHARE,
  FAST_FIRST_ANSWER_MEDIAN_MS,
  firstAnswerRows,
  medianMs,
  type FirstAnswerRow,
} from './studyPace.js';
import { computeEffectiveLimits, DEFAULT_USER_SETTINGS } from './userSettings.js';

const HOUR_MS = 60 * 60 * 1000;

/** The most time one rating counts for: a card left open over lunch is not two hours of study. */
export const RATING_TIME_CAP_MS = 120_000;

/** How a student's first answers in a deck went on one day. */
export interface FirstAnswerPace {
  /** The median time of the first answers (each card's first rating that day), or null with none. */
  medianFirstMs: number | null;
  /** New cards rated Easy the first time they were shown. */
  easyNew: number;
  /** New cards rated (each one's first answer). */
  newCards: number;
  /** Half of the first answers took less than the pace rule's minimum (FAST_FIRST_ANSWER_MEDIAN_MS). */
  fast: boolean;
  /** Easy on nearly every new card, by the pace rule (enough new cards, nearly all Easy). */
  allEasy: boolean;
}

export interface FlashcardDayCell extends FirstAnswerPace {
  deckId: number;
  /** The last "All Done!" in the deck that day (ms), or null. */
  finishedAt: number | null;
  /** How many times the student reached "All Done!" in the deck that day. */
  finishes: number;
  /** Cards rated while in review. */
  reviews: number;
  /** Every rating, learning steps included. */
  answers: number;
  /** Time on the cards, in whole minutes, each rating counted up to RATING_TIME_CAP_MS. */
  minutes: number;
  /** The student's new-card limit for this deck. */
  newLimit: number;
  /** The limit is below the group's. */
  lowLimit: boolean;
}

export interface FlashcardDayStudent {
  id: number;
  name: string;
  email: string;
  /** When the student first finished ALL their flashcards that day (ms), or null (v1.18.0). */
  allDone: number | null;
  cells: FlashcardDayCell[];
}

export interface FlashcardDayView {
  /** YYYY-MM-DD in America/Los_Angeles. */
  day: string;
  /** The group's new cards per day (its settings, or the app's default). */
  groupNewLimit: number;
  decks: { id: number; name: string }[];
  students: FlashcardDayStudent[];
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written YYYY-MM-DD. */
export function isDayString(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const at = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
}

/**
 * The school day's span in ms, [start, end): Los Angeles midnight to the next
 * one (23 or 25 hours on the days the clocks change).
 */
export function schoolDayBounds(day: string): { start: number; end: number } {
  const start = startOfSchoolDay(Date.parse(`${day}T12:00:00Z`));
  return { start, end: startOfSchoolDay(start + 36 * HOUR_MS) };
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Seconds (drizzle `timestamp` columns read raw by max()) to ms. */
const secondsToMs = (value: unknown): number | null => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n * 1000;
};

/**
 * The pace of a set of first answers, judged by the pace rule's numbers
 * (services/studyPace.ts). Both marks are worked out on their own: the grid
 * is for the teacher to see, not a hold.
 */
export function paceOf(firstAnswerMs: readonly number[], easyNew: number, newCards: number): FirstAnswerPace {
  const medianFirstMs = medianMs(firstAnswerMs);
  return {
    medianFirstMs,
    easyNew,
    newCards,
    fast: medianFirstMs !== null && medianFirstMs < FAST_FIRST_ANSWER_MEDIAN_MS,
    allEasy: newCards >= ALL_EASY_MIN_NEW_CARDS && easyNew >= ALL_EASY_MIN_SHARE * newCards,
  };
}

export const pairKey = (userId: number, deckId: number | null) => `${userId}:${deckId}`;

/**
 * First answers grouped by a key (a student and deck, or a student), as a
 * pace for each key that has any.
 */
export function pacesBy(rows: readonly FirstAnswerRow[], keyOf: (row: FirstAnswerRow) => string | null): Map<string, FirstAnswerPace> {
  const byKey = new Map<string, { times: number[]; easyNew: number; newCards: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    let pair = byKey.get(key);
    if (!pair) byKey.set(key, pair = { times: [], easyNew: 0, newCards: 0 });
    pair.times.push(Math.min(Math.max(0, row.timeSpentMs), RATING_TIME_CAP_MS));
    if (row.previousState === State.New) {
      pair.newCards += 1;
      if (row.rating === Rating.Easy) pair.easyNew += 1;
    }
  }
  return new Map([...byKey].map(([key, pair]) => [key, paceOf(pair.times, pair.easyNew, pair.newCards)]));
}

/**
 * The first answers of these students in these decks in [start, end), as a
 * pace for each student and deck that has any ("userId:deckId"). One read for
 * the lot: a class's day is a few thousand ratings at most.
 */
export function firstAnswerPaces(userIds: readonly number[], deckIds: readonly number[], start: Date, end: Date): Map<string, FirstAnswerPace> {
  // The pace rule's own first answers (services/studyPace.ts firstAnswerRows).
  return pacesBy(firstAnswerRows(userIds, deckIds, start, end), (row) => pairKey(row.userId, row.deckId));
}

export const NO_PACE: FirstAnswerPace = paceOf([], 0, 0);

/** The "Flashcards by day" grid of a group on a school day (default: today at the school). */
export function groupFlashcardDay(groupId: number, day?: string, now = new Date()): FlashcardDayView {
  const theDay = day ?? schoolDay(now);
  const { start, end } = schoolDayBounds(theDay);

  const decks = db.select({ id: schema.decks.id, name: schema.decks.name })
    .from(schema.deckGroups)
    .innerJoin(schema.decks, eq(schema.deckGroups.deckId, schema.decks.id))
    .where(eq(schema.deckGroups.groupId, groupId))
    .all()
    .sort(byName);
  const students = db.selectDistinct({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
    .where(and(eq(schema.userGroups.groupId, groupId), ne(schema.users.role, 'admin')))
    .all()
    .sort(byName);
  // The group's own limit only when its Override is on: otherwise it was never applied to its
  // members, and the app's default is what they are expected to have.
  const groupSetting = db.select({ newCardsPerDay: schema.groupSettings.newCardsPerDay, isOverride: schema.groupSettings.isOverride })
    .from(schema.groupSettings)
    .where(eq(schema.groupSettings.groupId, groupId))
    .get();
  const groupNewLimit = groupSetting?.isOverride ? groupSetting.newCardsPerDay : DEFAULT_USER_SETTINGS.newCardsPerDay;

  const deckIds = decks.map((d) => d.id);
  const studentIds = students.map((s) => s.id);
  const empty = deckIds.length === 0 || studentIds.length === 0;
  const startDate = new Date(start);
  const endDate = new Date(end);

  const C = schema.studyCompletions;
  const finishes = new Map((empty ? [] : db.select({
    userId: C.userId,
    deckId: C.deckId,
    count: sql<number>`count(*)`,
    lastAt: sql<number>`max(${C.completedAt})`,
  })
    .from(C)
    .where(and(
      inArray(C.userId, studentIds),
      inArray(C.deckId, deckIds),
      isNull(C.virtualDeckId),
      eq(C.reason, 'session_complete'),
      gte(C.completedAt, startDate),
      lt(C.completedAt, endDate),
    ))
    .groupBy(C.userId, C.deckId)
    .all()).map((row) => [pairKey(row.userId, row.deckId), row]));

  const R = schema.reviewLogs;
  const work = new Map((empty ? [] : db.select({
    userId: R.userId,
    deckId: schema.cards.deckId,
    reviews: sql<number>`coalesce(sum(case when ${R.previousState} = ${State.Review} then 1 else 0 end), 0)`,
    answers: sql<number>`count(*)`,
    timeMs: sql<number>`coalesce(sum(min(max(${R.timeSpentMs}, 0), ${RATING_TIME_CAP_MS})), 0)`,
  })
    .from(R)
    .innerJoin(schema.cards, eq(R.cardId, schema.cards.id))
    .where(and(
      inArray(R.userId, studentIds),
      inArray(schema.cards.deckId, deckIds),
      gte(R.reviewedAt, startDate),
      lt(R.reviewedAt, endDate),
    ))
    .groupBy(R.userId, schema.cards.deckId)
    .all()).map((row) => [pairKey(row.userId, row.deckId), row]));
  const paces = empty ? new Map<string, FirstAnswerPace>() : firstAnswerPaces(studentIds, deckIds, startDate, endDate);
  // The day's "finished all flashcards" (every deck of the student's groups, not only this group's).
  const allDone = allFlashcardsDoneOn(studentIds, theDay);

  const userSettings = new Map((studentIds.length === 0 ? [] : db.select().from(schema.userSettings)
    .where(inArray(schema.userSettings.userId, studentIds)).all()).map((row) => [row.userId, row]));
  const deckSettings = new Map((empty ? [] : db.select().from(schema.deckUserSettings)
    .where(and(inArray(schema.deckUserSettings.userId, studentIds), inArray(schema.deckUserSettings.deckId, deckIds)))
    .all()).map((row) => [pairKey(row.userId, row.deckId), row]));

  return {
    day: theDay,
    groupNewLimit,
    decks,
    students: students.map((student) => ({
      ...student,
      allDone: allDone.get(student.id)?.getTime() ?? null,
      cells: decks.map((deck): FlashcardDayCell => {
        const finished = finishes.get(pairKey(student.id, deck.id));
        const done = work.get(pairKey(student.id, deck.id));
        const newLimit = computeEffectiveLimits(
          userSettings.get(student.id) ?? null,
          deckSettings.get(pairKey(student.id, deck.id)) ?? null,
        ).newCardsPerDay;
        return {
          deckId: deck.id,
          finishedAt: finished ? secondsToMs(finished.lastAt) : null,
          finishes: Number(finished?.count ?? 0),
          ...(paces.get(pairKey(student.id, deck.id)) ?? NO_PACE),
          reviews: Number(done?.reviews ?? 0),
          answers: Number(done?.answers ?? 0),
          minutes: Math.round(Number(done?.timeMs ?? 0) / 60_000),
          newLimit,
          lowLimit: newLimit < groupNewLimit,
        };
      }),
    })),
  };
}
