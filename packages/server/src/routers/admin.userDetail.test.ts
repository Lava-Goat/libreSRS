// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

type AnyUser = { id: number; googleId: string; email: string; name: string; picture: null; role: 'admin' | 'user' };
const teacher: AnyUser = { id: 1, googleId: 'g1', email: 'teacher@example.com', name: 'Teacher', picture: null, role: 'admin' };
const ana: AnyUser = { id: 2, googleId: 'g2', email: '123456@students.school.test', name: 'Ana', picture: null, role: 'user' };
const beto: AnyUser = { id: 3, googleId: 'g3', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' };
const carla: AnyUser = { id: 4, googleId: 'g4', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' };

const PERIOD_1 = 5;
const PERIOD_2 = 6;
const UNIT_1 = 1;
const UNIT_2 = 2;
const OTHER = 3;
/** Thursday 2026-09-24, 1 pm in Los Angeles (PDT). */
const NOW = new Date('2026-09-24T20:00:00Z');
const PDT = -420;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function callerAs(user: AnyUser) {
  vi.resetModules();
  vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
  const { adminRouter } = await import('./admin.js');
  return adminRouter.createCaller({ req: { user } as unknown as Request, res: {} as Response, user, requestId: null });
}

describe('admin.userDetail', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([teacher, ana, beto, carla].map(({ picture: _p, ...u }) => ({
      ...u, createdAt: new Date('2026-08-12T16:00:00Z'),
    })));
    await testDb.insert(schema.groups).values([{ id: PERIOD_1, name: 'Period 1' }, { id: PERIOD_2, name: 'Period 2' }]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 },
      { userId: carla.id, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.decks).values([
      { id: UNIT_1, name: 'Unit 1', createdBy: teacher.id },
      { id: UNIT_2, name: 'Unit 2', createdBy: teacher.id, reversible: true },
      { id: OTHER, name: 'Other', createdBy: teacher.id },
    ]);
    await testDb.insert(schema.deckGroups).values([
      { deckId: UNIT_1, groupId: PERIOD_1 },
      { deckId: UNIT_2, groupId: PERIOD_1 },
      { deckId: OTHER, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.cards).values([
      { id: 11, deckId: UNIT_1, front: 'hablo | I speak', back: 'I speak' },
      { id: 12, deckId: UNIT_1, front: 'casa', back: 'house' },
      { id: 13, deckId: UNIT_1, front: 'perro', back: 'dog' },
      { id: 21, deckId: UNIT_2, front: 'gato', back: 'cat' },
      { id: 22, deckId: UNIT_2, front: 'mesa', back: 'table' },
      { id: 31, deckId: OTHER, front: 'sol', back: 'sun' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await client.close();
  });

  it('is for admins only, and says when there is no such user', async () => {
    await expect((await callerAs(ana)).userDetail({ userId: ana.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect((await callerAs(teacher)).userDetail({ userId: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('shows a user with no data, and creates nothing', async () => {
    const detail = await (await callerAs(teacher)).userDetail({ userId: beto.id, timezoneOffsetMinutes: PDT });

    expect(detail.user).toEqual({
      id: beto.id, name: 'Beto', email: 'beto@example.com', picture: null, role: 'user',
      createdAt: Date.parse('2026-08-12T16:00:00Z'), lastActiveAt: null,
      studentNumber: null, studentNumberSetByTeacher: false,
    });
    expect(detail.groups).toEqual([]);
    expect(detail.flashcards).toEqual([]);
    expect(detail.conjugation).toEqual([]);
    expect(detail.labs).toEqual([]);
    expect(detail.speaking).toEqual([]);
    // No extension loaded: nothing beyond core's fields.
    expect(Object.keys(detail).sort()).toEqual(['allDoneDays', 'conjugation', 'finishDays', 'flashcards', 'groups', 'labs', 'settings', 'speaking', 'user']);
    expect(detail.settings).toEqual({
      newCardsPerDay: 20, reviewsPerDay: 20, isOverride: false, allowHigher: true, allowLower: true, limitRule: 'free',
    });
    expect(detail.finishDays).toHaveLength(14);
    expect(detail.finishDays[0]).toBe('2026-09-11');
    expect(detail.finishDays[13]).toBe('2026-09-24');
    expect(detail.allDoneDays).toEqual([]);
    // A read: no settings row appears for Beto.
    expect(await testDb.query.userSettings.findMany()).toEqual([]);
  });

  it('gathers flashcards, conjugation, labs, speaking and limits', async () => {
    const api = await callerAs(teacher);

    // Limits: the teacher's 20/20 with "only higher", and Ana's own 25 on Unit 1.
    await testDb.insert(schema.userSettings).values({
      userId: ana.id, newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: false,
    });
    await testDb.insert(schema.deckUserSettings).values({ userId: ana.id, deckId: UNIT_1, newCardsPerDay: 25, reviewsPerDay: 20 });

    // Unit 1: card 11 in review and due, card 12 in review later, card 13 never seen.
    // Unit 2 (both ways): 21 learned forward and back (one learned card), 22 forward in learning and due.
    await testDb.insert(schema.cardStates).values([
      { cardId: 11, userId: ana.id, direction: 0, state: 2, reps: 3, nextReview: hoursAgo(2) },
      { cardId: 12, userId: ana.id, direction: 0, state: 2, reps: 3, nextReview: hoursAgo(-48) },
      { cardId: 21, userId: ana.id, direction: 0, state: 2, reps: 3, nextReview: hoursAgo(-48) },
      { cardId: 21, userId: ana.id, direction: 1, state: 2, reps: 3, nextReview: hoursAgo(-48) },
      { cardId: 22, userId: ana.id, direction: 0, state: 1, reps: 1, nextReview: hoursAgo(1) },
    ]);
    const rate = (cardId: number, reviewedAt: Date, previousState: number, rating = 3) => testDb.insert(schema.reviewLogs).values({
      cardId, userId: ana.id, rating, reviewedAt, timeSpentMs: 4_000, previousState, newState: 2,
    });
    await rate(11, hoursAgo(3), 0);
    await rate(12, hoursAgo(3), 0);
    await rate(11, hoursAgo(2), 2, 1);
    await rate(21, hoursAgo(1), 2);
    await rate(21, new Date('2026-09-20T18:00:00Z'), 0);
    // "All Done!" in Unit 1 today and on Monday; nothing_due, a virtual deck and a day long gone never count.
    const [virtual] = await testDb.insert(schema.virtualDecks).values({
      name: 'Mine', userId: ana.id, sourceDeckId: UNIT_1, cardSelection: '1',
    }).returning();
    await testDb.insert(schema.flashcardAllDone).values([
      { userId: ana.id, day: '2026-09-22', completedAt: new Date('2026-09-22T17:00:00Z'), deckIds: '[2,1]' },
      { userId: ana.id, day: '2026-09-01', completedAt: new Date('2026-09-01T17:00:00Z'), deckIds: '[2,1]' },
      { userId: carla.id, day: '2026-09-23', completedAt: new Date('2026-09-23T17:00:00Z'), deckIds: '[3]' },
    ]);
    await testDb.insert(schema.studyCompletions).values([
      { userId: ana.id, deckId: UNIT_1, reason: 'session_complete', completedAt: hoursAgo(1) },
      { userId: ana.id, deckId: UNIT_1, reason: 'session_complete', completedAt: new Date('2026-09-21T17:00:00Z') },
      { userId: ana.id, deckId: UNIT_2, reason: 'nothing_due', completedAt: new Date('2026-09-23T17:00:00Z') },
      { userId: ana.id, deckId: null, virtualDeckId: virtual.id, reason: 'session_complete', completedAt: new Date('2026-09-22T17:00:00Z') },
      { userId: ana.id, deckId: UNIT_1, reason: 'session_complete', completedAt: new Date('2026-09-01T17:00:00Z') },
    ]);

    // Conjugation on Unit 1: one form mastered, rounds played to the end on two days, one abandoned.
    await testDb.insert(schema.deckConjugation).values({ deckId: UNIT_1, enabled: true });
    await testDb.insert(schema.deckConjugation).values({ deckId: UNIT_2, enabled: false });
    const { deckQuizState } = await import('./conjugation.js');
    const quiz = await deckQuizState(UNIT_1);
    expect(quiz.items.length).toBeGreaterThan(1);
    await testDb.insert(schema.conjugationProgress).values({
      userId: ana.id, deckId: UNIT_1, itemKey: quiz.items[0].key, level: 10, mastered: true, lastAt: new Date('2026-09-22T18:00:00Z'),
    });
    const round = (startedAt: string, finishedAt: string | null, fields: Partial<typeof schema.conjugationRounds.$inferInsert> = {}) => ({
      userId: ana.id, deckId: UNIT_1, queue: '[]', prompts: 5, firstTryCorrect: 5, position: 5, settingsSnapshot: '{}',
      startedAt: new Date(startedAt), finishedAt: finishedAt ? new Date(finishedAt) : null, ...fields,
    });
    await testDb.insert(schema.conjugationRounds).values([
      round('2026-09-21T18:00:00Z', '2026-09-21T18:05:00Z'),
      round('2026-09-21T19:00:00Z', '2026-09-21T19:05:00Z'),
      round('2026-09-23T18:00:00Z', '2026-09-23T18:05:00Z'),
      round('2026-09-24T17:00:00Z', '2026-09-24T17:10:00Z', { abandoned: true }),
    ]);

    // Labs: one needs a redo, one waits for the teacher (no microphone), one is still to do;
    // another period's lab and an unreleased one nobody did are not hers.
    await testDb.insert(schema.labs).values([
      { id: 1, title: 'Lab semana01', audioUrl: '/a/1.mp3', mimeType: 'audio/mpeg', durationMs: 700_000, requiredThroughMs: 660_000, forEveryone: true, active: true, createdBy: 1 },
      { id: 2, title: 'Lab semana10', audioUrl: '/a/2.mp3', mimeType: 'audio/mpeg', durationMs: 700_000, requiredThroughMs: 660_000, forEveryone: true, active: false, createdBy: 1 },
      { id: 3, title: 'Lab semana02', audioUrl: '/a/3.mp3', mimeType: 'audio/mpeg', durationMs: 700_000, requiredThroughMs: 660_000, forEveryone: false, active: true, createdBy: 1 },
      { id: 4, title: 'Period 2 lab', audioUrl: '/a/4.mp3', mimeType: 'audio/mpeg', durationMs: 700_000, requiredThroughMs: 660_000, forEveryone: false, active: true, createdBy: 1 },
      { id: 5, title: 'Lab semana11', audioUrl: '/a/5.mp3', mimeType: 'audio/mpeg', durationMs: 700_000, requiredThroughMs: 660_000, forEveryone: true, active: false, createdBy: 1 },
    ]);
    await testDb.insert(schema.labGroups).values([{ labId: 3, groupId: PERIOD_1 }, { labId: 4, groupId: PERIOD_2 }]);
    const submission = (labId: number, submittedAt: string, fields: Partial<typeof schema.labSubmissions.$inferInsert>) => ({
      labId, userId: ana.id, requiredThroughMs: 660_000, voicedMs: 60_000, listenedCoveredMs: 660_000, listenWallMs: 661_000,
      startedAt: new Date(Date.parse(submittedAt) - 720_000), submittedAt: new Date(submittedAt), flags: '[]', ...fields,
    });
    await testDb.insert(schema.labSubmissions).values([
      submission(1, '2026-09-22T18:00:00Z', { pausesCounted: 10, pausesAnswered: 4, minAnsweredPct: 75, credit: false }),
      submission(1, '2026-09-23T18:00:00Z', { pausesCounted: 10, pausesAnswered: 5, minAnsweredPct: 75, credit: false }),
      submission(2, '2026-09-23T19:00:00Z', { mic: 'off', credit: false }),
    ]);

    // Speaking: two recordings of one task, the latest graded by the teacher; another period's task is not hers.
    await testDb.insert(schema.speakingTasks).values([
      { id: 1, title: 'Cuento', forEveryone: true, active: true, createdBy: 1 },
      { id: 2, title: 'P2 task', forEveryone: false, active: true, createdBy: 1 },
    ]);
    await testDb.insert(schema.speakingTaskGroups).values({ taskId: 2, groupId: PERIOD_2 });
    await testDb.insert(schema.speakingSubmissions).values([
      { taskId: 1, userId: ana.id, clientKey: 'a', audioUrl: '/s/a.webm', mimeType: 'audio/webm', durationMs: 20_000, submittedAt: new Date('2026-09-22T18:00:00Z') },
      { taskId: 1, userId: ana.id, clientKey: 'b', audioUrl: '/s/b.webm', mimeType: 'audio/webm', durationMs: 29_000, submittedAt: new Date('2026-09-23T18:00:00Z'), gradeScore: 85, gradedBy: 'teacher', gradedAt: new Date('2026-09-24T01:00:00Z') },
    ]);

    const detail = await api.userDetail({ userId: ana.id, timezoneOffsetMinutes: PDT });

    expect(detail.user).toMatchObject({
      name: 'Ana', role: 'user', studentNumber: '123456', studentNumberSetByTeacher: false,
      lastActiveAt: hoursAgo(1).getTime(),
    });
    expect(detail.groups).toEqual([{ id: PERIOD_1, name: 'Period 1' }]);
    expect(detail.settings).toMatchObject({ isOverride: true, allowHigher: true, allowLower: false, limitRule: 'higher' });

    expect(detail.flashcards.map((d) => d.name)).toEqual(['Unit 1', 'Unit 2']);
    const [unit1, unit2] = detail.flashcards;
    expect(unit1).toEqual({
      id: UNIT_1, name: 'Unit 1', cardCount: 3, learned: 2,
      // Card 11 is due, and card 13 is the one new card left under today's 25.
      dueToday: 2, newToday: 2, reviewsToday: 1, newLimit: 25, reviewLimit: 20,
      reviews: 3, correctReviews: 2, lastStudiedAt: hoursAgo(2).getTime(),
      finishedDays: ['2026-09-21', '2026-09-24'],
    });
    expect(unit2).toMatchObject({
      cardCount: 2, learned: 1, dueToday: 2, newToday: 0, reviewsToday: 1, newLimit: 20,
      lastStudiedAt: hoursAgo(1).getTime(), finishedDays: [],
    });
    // "Finished all flashcards" days (v1.18.0) among the days shown: Monday's, not one long gone, and never Carla's.
    expect(detail.allDoneDays).toEqual(['2026-09-22']);

    expect(detail.conjugation).toEqual([{
      deckId: UNIT_1, deckName: 'Unit 1', mastered: 1, total: quiz.items.length, rounds: 3,
      lastPlayedAt: Date.parse('2026-09-24T17:10:00Z'), daysPractised: 2,
    }]);

    expect(detail.labs.map((l) => [l.title, l.status, l.reason, l.attempts])).toEqual([
      ['Lab semana01', 'redo', null, 2],
      ['Lab semana02', 'todo', null, 0],
      ['Lab semana10', 'check', 'no-mic', 1],
    ]);
    expect(detail.labs[0]).toMatchObject({ pausesAnswered: 5, pausesCounted: 10, needed: 8, submittedAt: Date.parse('2026-09-23T18:00:00Z') });

    expect(detail.speaking).toEqual([{
      id: 1, title: 'Cuento', active: true, attempts: 2, lastSubmittedAt: Date.parse('2026-09-23T18:00:00Z'),
      durationMs: 29_000, score: 85, gradedBy: 'teacher', gradedAt: Date.parse('2026-09-24T01:00:00Z'),
    }]);

    expect(detail.user).not.toHaveProperty('notStudent');
  });

  it('shows each deck\'s due number as the student\'s own deck list does: what Study opens with, a New row counted once', async () => {
    // Ana opened Unit 1 and left (Study set up New rows for its three cards); in Unit 2 one review is due.
    await testDb.insert(schema.cardStates).values([
      ...[11, 12, 13].map((cardId) => ({ cardId, userId: ana.id, direction: 0, state: 0, nextReview: hoursAgo(1) })),
      { cardId: 21, userId: ana.id, direction: 0, state: 2, reps: 3, nextReview: hoursAgo(2) },
    ]);
    const detail = await (await callerAs(teacher)).userDetail({ userId: ana.id, timezoneOffsetMinutes: PDT });
    const { cardsRouter } = await import('./cards.js');
    const own = await cardsRouter.createCaller({ req: { user: ana } as unknown as Request, res: {} as Response, user: ana, requestId: null })
      .getMyDecks({ timezoneOffsetMinutes: PDT });
    const byId = (rows: { id: number; due: number }[]) => [...rows].sort((a, b) => a.id - b.id);
    expect(byId(detail.flashcards.map((d) => ({ id: d.id, due: d.dueToday })))).toEqual(byId(own.map((d) => ({ id: d.id, due: d.dueCount }))));
    // Unit 1: its three new cards once, not six. Unit 2: the review, and the other three card-directions still new.
    expect(detail.flashcards.map((d) => d.dueToday)).toEqual([3, 4]);
    // Both only read: no settings row, no new card state.
    expect(await testDb.query.userSettings.findMany()).toEqual([]);
    expect(await testDb.query.cardStates.findMany()).toHaveLength(4);
  });

  it('shows the school ID the teacher typed', async () => {
    await testDb.insert(schema.studentNumberOverrides).values({ userId: carla.id, studentNumber: '4321' });
    const detail = await (await callerAs(teacher)).userDetail({ userId: carla.id });
    expect(detail.user).toMatchObject({ studentNumber: '4321', studentNumberSetByTeacher: true });
    expect(detail.groups).toEqual([{ id: PERIOD_2, name: 'Period 2' }]);
    expect(detail.flashcards.map((d) => d.name)).toEqual(['Other']);
  });
});
