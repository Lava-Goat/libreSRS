// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('admin today counts', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
    });

    await testDb.insert(schema.decks).values({
      id: 1,
      name: 'Deck',
      createdBy: 1,
      reversible: false,
    });

    await testDb.insert(schema.cards).values({
      id: 1,
      deckId: 1,
      front: 'Front',
      back: 'Back',
    });
  });

  it('counts only today reviews using millisecond timestamps', async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(todayStart.getTime() + 1000),
      timeSpentMs: 1000,
      previousState: 0,
      newState: 1,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(todayStart.getTime() + 2000),
      timeSpentMs: 1000,
      previousState: 2,
      newState: 2,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(todayStart.getTime() + 3000),
      timeSpentMs: 1000,
      previousState: 1,
      newState: 1,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(yesterday.getTime() + 1000),
      timeSpentMs: 1000,
      previousState: 0,
      newState: 1,
    });

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const result = await caller.getUserSettings({ userId: 1 });

    expect(result.newCardsDoneToday).toBe(1);
    expect(result.reviewsDoneToday).toBe(1);
  });

  it('respects timezone offset when counting today reviews', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-05T12:00:00.000Z');
    vi.setSystemTime(now);

    // UTC+10 local start is 2026-02-04T14:00:00Z
    const beforeLocalStart = new Date('2026-02-04T13:00:00.000Z');
    const afterLocalStart = new Date('2026-02-04T15:00:00.000Z');

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: beforeLocalStart,
      timeSpentMs: 1000,
      previousState: 0,
      newState: 1,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: afterLocalStart,
      timeSpentMs: 1000,
      previousState: 0,
      newState: 1,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(afterLocalStart.getTime() + 5 * 60 * 1000),
      timeSpentMs: 1000,
      previousState: 2,
      newState: 2,
    });

    await testDb.insert(schema.reviewLogs).values({
      cardId: 1,
      userId: 1,
      rating: 3,
      reviewedAt: new Date(afterLocalStart.getTime() + 10 * 60 * 1000),
      timeSpentMs: 1000,
      previousState: 3,
      newState: 3,
    });

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const result = await caller.getUserSettings({ userId: 1, timezoneOffsetMinutes: 600 });

    expect(result.newCardsDoneToday).toBe(1);
    expect(result.reviewsDoneToday).toBe(1);

    vi.useRealTimers();
  });

  it('returns decks assigned to a group with card counts', async () => {
    await testDb.insert(schema.groups).values({
      id: 1,
      name: 'Group A',
      description: 'Test group',
    });

    await testDb.insert(schema.deckGroups).values({
      deckId: 1,
      groupId: 1,
    });

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const result = await caller.getGroupDecks({ groupId: 1 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].name).toBe('Deck');
    expect(result[0].cardCount).toBe(1);
  });

  it('imports a Google Classroom roster into a new group', async () => {
    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const csv = `First Name,Last Name,Email Address,Role
Alice,Anderson,alice@example.com,Student
Tom,Teacher,tom@example.com,Teacher
Alice,Duplicate,ALICE@example.com,Student`;

    const result = await caller.importGoogleClassroomGroup({
      name: 'Period 2 - Spanish',
      description: 'Imported from Classroom',
      csvContent: csv,
    });

    expect(result.group.name).toBe('Period 2 - Spanish');
    expect(result.summary.studentsParsed).toBe(1);
    expect(result.summary.usersCreated).toBe(1);
    expect(result.summary.nonStudentRowsSkipped).toBe(1);
    expect(result.summary.duplicateEmailsSkipped).toBe(1);

    const users = await testDb.query.users.findMany({
      where: (users, { eq }) => eq(users.email, 'alice@example.com'),
    });
    expect(users).toHaveLength(1);
    expect(users[0]?.googleId).toBe('pending:alice@example.com');

    const memberships = await testDb.query.userGroups.findMany({
      where: (userGroups, { eq }) => eq(userGroups.userId, users[0]!.id),
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.groupId).toBe(result.group.id);
  });

  it('adds imported users to the All group when it exists', async () => {
    await testDb.insert(schema.groups).values({
      id: 99,
      name: 'All',
      description: 'All users',
    });

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const csv = `First Name,Last Name,Email Address,Role
Alice,Anderson,alice@example.com,Student`;

    const result = await caller.importGoogleClassroomGroup({
      name: 'Period 3 - Spanish',
      description: 'Imported from Classroom',
      csvContent: csv,
    });

    const users = await testDb.query.users.findMany({
      where: (users, { eq }) => eq(users.email, 'alice@example.com'),
    });
    expect(users).toHaveLength(1);

    const memberships = await testDb.query.userGroups.findMany({
      where: (userGroups, { eq }) => eq(userGroups.userId, users[0]!.id),
    });
    const membershipGroupIds = memberships.map((membership) => membership.groupId).sort((a, b) => a - b);

    expect(membershipGroupIds).toEqual([99, result.group.id].sort((a, b) => a - b));
  });

  it('prevents removing users from the All group', async () => {
    await testDb.insert(schema.groups).values({
      id: 100,
      name: 'All',
      description: 'All users',
    });
    await testDb.insert(schema.userGroups).values({
      userId: 1,
      groupId: 100,
    });

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    await expect(
      caller.removeUserFromGroup({ userId: 1, groupId: 100 })
    ).rejects.toHaveProperty('code', 'FORBIDDEN');

    const membership = await testDb.query.userGroups.findFirst({
      where: (userGroups, { and, eq }) => and(
        eq(userGroups.userId, 1),
        eq(userGroups.groupId, 100)
      ),
    });
    expect(membership).toBeTruthy();
  });

  it('requires a connected Google Classroom session for course imports', async () => {
    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser, session: {} } as unknown as Request,
      res: {} as Response,
      user: adminUser,
    });

    await expect(
      caller.importGoogleClassroomCourse({ courseId: 'course-1' })
    ).rejects.toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('creates a deck with source and target accent fields', async () => {
    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    // Regression: missing accent-related columns in DB caused deck creation to fail
    const deck = await caller.createDeck({
      name: 'New Test Deck',
      description: 'A test deck',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      sourceAccent: 'Costa Rican',
      targetAccent: 'Mexican',
    });

    expect(deck.id).toBeGreaterThan(0);
    expect(deck.name).toBe('New Test Deck');
    expect(deck.sourceAccent).toBe('Costa Rican');
    expect(deck.targetAccent).toBe('Mexican');

    const persistedDeck = await testDb.query.decks.findFirst({
      where: (decks, { eq }) => eq(decks.id, deck.id),
    });
    expect(persistedDeck?.sourceAccent).toBe('Costa Rican');
    expect(persistedDeck?.targetAccent).toBe('Mexican');

    // Also verify a minimal create (no optional fields) works
    const minimalDeck = await caller.createDeck({ name: 'Minimal Deck' });
    expect(minimalDeck.id).toBeGreaterThan(deck.id);
    expect(minimalDeck.name).toBe('Minimal Deck');
  });

  it('imports an Anki deck through uploadAnkiDeck and returns warnings', async () => {
    const parseAnkiApkgBase64InBatches = vi.fn().mockImplementation(async ({ onBatch }: {
      onBatch: (cards: Array<{ front: string; back: string }>) => Promise<void>;
    }) => {
      await onBatch([{ front: 'Imported front', back: 'Imported back' }]);
      return {
        cardsAdded: 1,
        errors: [],
        warnings: ['Unsupported Anki features were stripped.'],
      };
    });

    vi.doMock('../services/anki.js', () => ({
      parseAnkiApkgBase64InBatches,
      ANKI_APKG_MAX_BYTES: 25 * 1024 * 1024,
    }));

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const beforeCards = await testDb.query.cards.findMany({
      where: (cards, { eq }) => eq(cards.deckId, 1),
    });

    const result = await caller.uploadAnkiDeck({
      deckId: 1,
      apkgBase64: Buffer.from('fake').toString('base64'),
    });

    expect(parseAnkiApkgBase64InBatches).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.cardsAdded).toBe(1);
    expect(result.warnings).toContain('Unsupported Anki features were stripped.');

    const cards = await testDb.query.cards.findMany({
      where: (cards, { eq }) => eq(cards.deckId, 1),
    });
    expect(cards.some((card) => card.front === 'Imported front' && card.back === 'Imported back')).toBe(true);
    expect(cards.length).toBe(beforeCards.length + 1);
  });

  it('returns failure when batched Anki parse yields no cards', async () => {
    const parseAnkiApkgBase64InBatches = vi.fn().mockResolvedValue({
      cardsAdded: 0,
      errors: [],
      warnings: ['Unsupported Anki features were stripped.'],
    });

    vi.doMock('../services/anki.js', () => ({
      parseAnkiApkgBase64InBatches,
      ANKI_APKG_MAX_BYTES: 25 * 1024 * 1024,
    }));

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });

    const result = await caller.uploadAnkiDeck({
      deckId: 1,
      apkgBase64: Buffer.from('fake').toString('base64'),
    });

    expect(parseAnkiApkgBase64InBatches).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.cardsAdded).toBe(0);
    expect(result.warnings).toContain('Unsupported Anki features were stripped.');
  });

  it('imports a Google Classroom course roster into a new group via API', async () => {
    const fetchGoogleClassroomCourse = vi.fn().mockResolvedValue({
      id: 'course-1',
      name: 'Biology Period 3',
      section: 'Period 3',
      description: 'Imported course description',
    });

    const fetchGoogleClassroomStudents = vi.fn().mockResolvedValue([
      {
        email: 'alice@example.com',
        fullName: 'Alice Anderson',
        firstName: 'Alice',
        lastName: 'Anderson',
      },
      {
        email: 'bob@example.com',
        fullName: 'Bob Brown',
        firstName: 'Bob',
        lastName: 'Brown',
      },
    ]);

    vi.doMock('../services/googleClassroomApi.js', () => ({
      fetchGoogleClassroomCourse,
      fetchGoogleClassroomStudents,
    }));

    const { adminRouter } = await import('./admin.js');

    const adminUser = {
      id: 1,
      googleId: 'admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin' as const,
    };

    const caller = adminRouter.createCaller({
      req: {
        user: adminUser,
        session: {
          googleClassroomAccessToken: 'token',
          googleClassroomRefreshToken: 'refresh',
        },
      } as unknown as Request,
      res: {} as Response,
      user: adminUser,
    });

    const result = await caller.importGoogleClassroomCourse({ courseId: 'course-1' });

    expect(fetchGoogleClassroomCourse).toHaveBeenCalledTimes(1);
    expect(fetchGoogleClassroomStudents).toHaveBeenCalledTimes(1);
    expect(result.course.id).toBe('course-1');
    expect(result.group.name).toBe('Biology Period 3');
    expect(result.summary.studentsParsed).toBe(2);
    expect(result.summary.usersAssignedToGroup).toBe(2);

    const user = await testDb.query.users.findFirst({
      where: (users, { eq }) => eq(users.email, 'alice@example.com'),
    });
    expect(user?.googleId).toBe('pending:alice@example.com');
  });
});

describe('normalizeAggregatedDate', () => {
  it('normalizes second-based aggregated timestamps for last active', async () => {
    const { normalizeAggregatedDate } = await import('./admin.js');
    const secondsTimestamp = 1762051200;

    const normalized = normalizeAggregatedDate(secondsTimestamp);

    expect(normalized).not.toBeNull();
    expect(normalized?.getTime()).toBe(secondsTimestamp * 1000);
  });

  it('returns null for invalid aggregated timestamps', async () => {
    const { normalizeAggregatedDate } = await import('./admin.js');

    expect(normalizeAggregatedDate('not-a-date')).toBeNull();
    expect(normalizeAggregatedDate(Number.NaN)).toBeNull();
  });
});

describe('exportGroupData', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 's1', email: 'active@example.com', name: 'Active Student', role: 'user' },
      { id: 3, googleId: 's2', email: 'idle@example.com', name: 'Idle Student', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values({ id: 5, name: 'Period 1' });
    await testDb.insert(schema.userGroups).values([
      { userId: 2, groupId: 5 },
      { userId: 3, groupId: 5 },
    ]);
    await testDb.insert(schema.decks).values({ id: 1, name: 'Deck', createdBy: 1, reversible: false });
    await testDb.insert(schema.cards).values({ id: 1, deckId: 1, front: 'hello', back: 'hola' });
  });

  async function makeCaller() {
    const { adminRouter } = await import('./admin.js');
    const adminUser = {
      id: 1, googleId: 'admin', email: 'admin@example.com',
      name: 'Admin', picture: null, role: 'admin' as const,
    };
    return adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });
  }

  it('summary includes every member — even one with no activity — and counts ratings', async () => {
    const reviewedAt = new Date('2026-08-26T18:29:13.000Z');
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 2, rating: 1, reviewedAt, timeSpentMs: 900, previousState: 0, newState: 1 },
      { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 800, previousState: 1, newState: 2 },
    ]);

    const caller = await makeCaller();
    const result = await caller.exportGroupData({ groupId: 5, dataset: 'summary' });

    // One row per member, including the student with zero reviews.
    expect(result.rowCount).toBe(2);
    const lines = result.csv.split('\n');
    expect(lines[0]).toContain('student_name');
    expect(lines).toHaveLength(3);

    const active = lines.find((l) => l.includes('active@example.com'))!;
    const idle = lines.find((l) => l.includes('idle@example.com'))!;
    expect(active).toContain('"Active Student"');
    // cards_studied,total_reviews,again,hard,good,easy → 0,2,1,0,1,0 then 50.0% accuracy
    expect(active).toContain(',2,1,0,1,0,50.0,');
    // Timestamps must be real dates, not 1970 (raw SQL returns Unix SECONDS).
    expect(active).toContain('2026-08-26T18:29:13.000Z');
    expect(idle).toContain(',0,0,0,0,0,0,,');
  });

  it('summary counts cards started (never a New row opening a deck set up) and a deck\'s "All Done!" (never a mini-deck\'s)', async () => {
    await testDb.insert(schema.cards).values({ id: 2, deckId: 1, front: 'adiós', back: 'goodbye' });
    // Card 1 studied; card 2 only shown as new when the student opened the deck.
    await testDb.insert(schema.cardStates).values([
      { cardId: 1, userId: 2, state: 2, reps: 2 },
      { cardId: 2, userId: 2, state: 0 },
    ]);
    const [mini] = await testDb.insert(schema.virtualDecks).values({ name: 'Mine', userId: 2, sourceDeckId: 1, cardSelection: '1' }).returning();
    await testDb.insert(schema.studyCompletions).values([
      { userId: 2, deckId: 1, reason: 'session_complete', completedAt: new Date('2026-09-21T17:00:00Z') },
      { userId: 2, deckId: null, virtualDeckId: mini.id, reason: 'session_complete', completedAt: new Date('2026-09-22T17:00:00Z') },
      { userId: 2, deckId: 1, reason: 'nothing_due', completedAt: new Date('2026-09-23T17:00:00Z') },
    ]);

    const { csv } = await (await makeCaller()).exportGroupData({ groupId: 5, dataset: 'summary' });
    const [header, ...rows] = csv.split('\n');
    const columns = header.split(',');
    const active = rows.find((l) => l.includes('active@example.com'))!.split(',');
    const cell = (name: string) => active[columns.indexOf(name)];
    expect(cell('cards_studied')).toBe('1');
    expect(cell('sessions_finished')).toBe('1');
    expect(cell('last_finished')).toBe('"2026-09-21T17:00:00.000Z"');
  });

  it('completions name a mini-deck\'s own deck and the mini-deck, in a column added at the end', async () => {
    const [mini] = await testDb.insert(schema.virtualDecks).values({ name: 'Hard ones', userId: 2, sourceDeckId: 1, cardSelection: '1' }).returning();
    await testDb.insert(schema.studyCompletions).values([
      { userId: 2, deckId: 1, reason: 'session_complete', newCardsDone: 5, reviewsDone: 2, completedAt: new Date('2026-09-21T17:00:00Z') },
      { userId: 2, deckId: null, virtualDeckId: mini.id, reason: 'session_complete', newCardsDone: 1, reviewsDone: 0, completedAt: new Date('2026-09-22T17:00:00Z') },
    ]);
    const { csv, rowCount } = await (await makeCaller()).exportGroupData({ groupId: 5, dataset: 'completions' });
    expect(csv.split('\n')).toEqual([
      'student_name,student_email,deck,reason,new_cards_done,reviews_done,completed_at,mini_deck',
      '"Active Student","active@example.com","Deck","session_complete",5,2,"2026-09-21T17:00:00.000Z",""',
      '"Active Student","active@example.com","Deck","session_complete",1,0,"2026-09-22T17:00:00.000Z","Hard ones"',
    ]);
    expect(rowCount).toBe(2);
  });

  it('completions add a row for each day a student finished ALL their flashcards (v1.18.0), in time order', async () => {
    await testDb.insert(schema.studyCompletions).values([
      { userId: 2, deckId: 1, reason: 'session_complete', newCardsDone: 5, reviewsDone: 2, completedAt: new Date('2026-09-21T17:00:00Z') },
      { userId: 2, deckId: 1, reason: 'session_complete', newCardsDone: 1, reviewsDone: 0, completedAt: new Date('2026-09-22T17:00:00Z') },
    ]);
    await testDb.insert(schema.flashcardAllDone).values([
      { userId: 2, day: '2026-09-21', completedAt: new Date('2026-09-21T17:00:01Z'), deckIds: '[1]' },
      { userId: 1, day: '2026-09-21', completedAt: new Date('2026-09-21T18:00:00Z'), deckIds: '[1]' }, // the teacher: never
    ]);
    const { csv, rowCount } = await (await makeCaller()).exportGroupData({ groupId: 5, dataset: 'completions' });
    expect(csv.split('\n')).toEqual([
      'student_name,student_email,deck,reason,new_cards_done,reviews_done,completed_at,mini_deck',
      '"Active Student","active@example.com","Deck","session_complete",5,2,"2026-09-21T17:00:00.000Z",""',
      '"Active Student","active@example.com","All flashcards","all_flashcards",,,"2026-09-21T17:00:01.000Z",""',
      '"Active Student","active@example.com","Deck","session_complete",1,0,"2026-09-22T17:00:00.000Z",""',
    ]);
    expect(rowCount).toBe(3);
  });

  it('speaking lists the flags the server found in the latest recording and the length its page claimed', async () => {
    await testDb.insert(schema.speakingTasks).values({ id: 1, title: 'Cuento', forEveryone: true, active: true, createdBy: 1 });
    await testDb.insert(schema.speakingSubmissions).values([
      { taskId: 1, userId: 2, clientKey: 'a', audioUrl: '/s/a.webm', mimeType: 'audio/webm', durationMs: 3_000, voicedMs: 2_000,
        submittedAt: new Date('2026-09-22T18:00:00Z'), flags: '["length-mismatch","same-file"]', clientDurationMs: 45_000 },
      { taskId: 1, userId: 3, clientKey: 'b', audioUrl: '/s/b.webm', mimeType: 'audio/webm', durationMs: 20_000, voicedMs: 9_000,
        submittedAt: new Date('2026-09-22T18:00:00Z'), flags: 'not json' },
    ]);
    const { csv } = await (await makeCaller()).exportGroupData({ groupId: 5, dataset: 'speaking' });
    const [header, ...rows] = csv.split('\n');
    expect(header.endsWith(',feedback,flags,page_length_s')).toBe(true);
    expect(rows.find((r) => r.includes('active@example.com'))).toMatch(/,"length-mismatch same-file",45$/);
    // A row from before v1.16 (no flags, no page length), or one that cannot be read, has empty cells.
    expect(rows.find((r) => r.includes('idle@example.com'))).toMatch(/,"",$/);
  });

  it('reports zero rows for a dataset with no data (so the UI can avoid a blank file)', async () => {
    const caller = await makeCaller();
    const result = await caller.exportGroupData({ groupId: 5, dataset: 'vocab' });
    expect(result.rowCount).toBe(0);
    expect(result.csv.split('\n')).toHaveLength(1); // header only
  });

  it('review history exports one row per review for group members only', async () => {
    const reviewedAt = new Date('2026-08-26T18:00:00.000Z');
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 500, previousState: 0, newState: 1 },
      // user 1 (admin) is NOT in group 5 — must be excluded
      { cardId: 1, userId: 1, rating: 4, reviewedAt, timeSpentMs: 500, previousState: 0, newState: 1 },
    ]);

    const caller = await makeCaller();
    const result = await caller.exportGroupData({ groupId: 5, dataset: 'reviews' });

    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('active@example.com');
    expect(result.csv).not.toContain('admin@example.com');
    expect(result.csv).toContain('2026-08-26T18:00:00.000Z');
  });
});

// The libsql client is shared by every describe in this file — close it once,
// after all of them, not at the end of the first block.
afterAll(async () => {
  await client.close();
});

describe('resetDeckProgress', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 's1', email: 's1@example.com', name: 'Student One', role: 'user' },
      { id: 3, googleId: 's2', email: 's2@example.com', name: 'Student Two', role: 'user' },
    ]);
    await testDb.insert(schema.decks).values([
      { id: 1, name: 'Unit 1', createdBy: 1, reversible: false },
      { id: 2, name: 'Other', createdBy: 1, reversible: false },
    ]);
    await testDb.insert(schema.cards).values([
      { id: 1, deckId: 1, front: 'hola', back: 'hello' },
      { id: 2, deckId: 2, front: 'otro', back: 'other' },
    ]);
    for (const userId of [2, 3]) {
      await testDb.insert(schema.cardStates).values([
        { cardId: 1, userId, direction: 0, reps: 5, nextReview: new Date() },
        { cardId: 2, userId, direction: 0, reps: 5, nextReview: new Date() },
      ]);
      await testDb.insert(schema.reviewLogs).values([
        { cardId: 1, userId, rating: 3, reviewedAt: new Date(), timeSpentMs: 100, previousState: 0, newState: 1 },
        { cardId: 2, userId, rating: 3, reviewedAt: new Date(), timeSpentMs: 100, previousState: 0, newState: 1 },
      ]);
    }
  });

  async function caller() {
    const { adminRouter } = await import('./admin.js');
    const adminUser = {
      id: 1, googleId: 'admin', email: 'admin@example.com',
      name: 'Admin', picture: null, role: 'admin' as const,
    };
    return adminRouter.createCaller({
      req: { user: adminUser } as Request,
      res: {} as Response,
      user: adminUser,
    });
  }

  it('resets one student without touching the other, or other decks', async () => {
    const result = await (await caller()).resetDeckProgress({ deckId: 1, userId: 2 });

    expect(result.cardStatesCleared).toBe(1);
    expect(result.reviewLogsCleared).toBe(1);

    const states = await testDb.query.cardStates.findMany();
    // Student 2 lost only their deck-1 state; student 3 and deck 2 are intact.
    expect(states.filter((s) => s.userId === 2)).toHaveLength(1);
    expect(states.filter((s) => s.userId === 2)[0].cardId).toBe(2);
    expect(states.filter((s) => s.userId === 3)).toHaveLength(2);
  });

  it('resets every user when no student is named', async () => {
    const result = await (await caller()).resetDeckProgress({ deckId: 1 });

    expect(result.cardStatesCleared).toBe(2);
    expect(result.reviewLogsCleared).toBe(2);

    const states = await testDb.query.cardStates.findMany();
    // Only the other deck's states survive, for both students.
    expect(states).toHaveLength(2);
    expect(states.every((s) => s.cardId === 2)).toBe(true);
    const logs = await testDb.query.reviewLogs.findMany();
    expect(logs.every((l) => l.cardId === 2)).toBe(true);
  });

  it('is a no-op on a deck with no cards', async () => {
    await testDb.insert(schema.decks).values({ id: 9, name: 'Empty', createdBy: 1, reversible: false });
    const result = await (await caller()).resetDeckProgress({ deckId: 9 });
    expect(result).toEqual({ success: true, cardStatesCleared: 0, reviewLogsCleared: 0 });
  });
});

type AnyUser = { id: number; googleId: string; email: string; name: string; picture: null; role: 'admin' | 'user' };
const teacher: AnyUser = { id: 1, googleId: 'admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' };
const student: AnyUser = { id: 2, googleId: 's1', email: '123456@students.school.test', name: 'Ana', picture: null, role: 'user' };

async function callerAs(user: AnyUser) {
  const { adminRouter } = await import('./admin.js');
  return adminRouter.createCaller({ req: { user } as unknown as Request, res: {} as Response, user, requestId: null });
}

describe('v1.15 teacher reports', () => {
  const PERIOD = 5;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 's1', email: '123456@students.school.test', name: 'Ana', role: 'user' },
      { id: 3, googleId: 's2', email: 'beto@example.com', name: '=Beto', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values({ id: PERIOD, name: 'Period 1' });
    // The teacher is in the group too, as teachers often are.
    await testDb.insert(schema.userGroups).values([
      { userId: 1, groupId: PERIOD }, { userId: 2, groupId: PERIOD }, { userId: 3, groupId: PERIOD },
    ]);
    await testDb.insert(schema.decks).values([
      { id: 1, name: 'Unit 1', createdBy: 1, reversible: false },
      { id: 2, name: 'Unit 2', createdBy: 1, reversible: false },
    ]);
    await testDb.insert(schema.cards).values([
      { id: 1, deckId: 1, front: 'hola', back: 'hello' },
      { id: 2, deckId: 2, front: 'casa', back: 'house' },
    ]);
  });

  describe('exports', () => {
    beforeEach(async () => {
      const reviewedAt = new Date('2026-09-24T18:00:00.000Z');
      await testDb.insert(schema.reviewLogs).values([
        { cardId: 1, userId: 1, rating: 3, reviewedAt, timeSpentMs: 500, previousState: 0, newState: 1 },
        { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 500, previousState: 0, newState: 1 },
      ]);
      await testDb.insert(schema.studyCompletions).values([
        { userId: 1, deckId: 1, reason: 'session_complete', completedAt: reviewedAt },
        { userId: 2, deckId: 1, reason: 'session_complete', completedAt: reviewedAt },
      ]);
    });

    it('leave the teacher out of the vocab results too', async () => {
      const [test] = await testDb.insert(schema.vocabTests).values({ name: 'Vocabulómetro', mode: 'size', createdBy: 1 }).returning();
      await testDb.insert(schema.vocabResults).values([
        { testId: test.id, userId: 1, mode: 'size', seed: 1, summaryJson: '{}' },
        { testId: test.id, userId: 2, mode: 'size', seed: 2, summaryJson: '{}' },
      ]);
      const { csv, rowCount } = await (await callerAs(teacher)).exportGroupData({ groupId: PERIOD, dataset: 'vocab' });
      expect(csv).not.toContain('admin@example.com');
      expect(csv).toContain('123456@students.school.test');
      expect(rowCount).toBe(1);
    });

    it('leave the teacher out of the summary, reviews and completions', async () => {
      const api = await callerAs(teacher);
      for (const dataset of ['summary', 'reviews', 'completions'] as const) {
        const { csv, rowCount } = await api.exportGroupData({ groupId: PERIOD, dataset });
        expect(csv, dataset).not.toContain('admin@example.com');
        expect(csv, dataset).toContain('123456@students.school.test');
        expect(rowCount, dataset).toBe(dataset === 'summary' ? 2 : 1);
      }
    });

    it('neutralise a cell that would start a spreadsheet formula', async () => {
      const { csv } = await (await callerAs(teacher)).exportGroupData({ groupId: PERIOD, dataset: 'summary' });
      expect(csv).toContain(`"'=Beto"`);
      expect(csv).not.toContain('"=Beto"');
    });

    it('builds the labs CSV with services/labExport (v1.15 columns and statuses)', async () => {
      await testDb.insert(schema.labs).values({
        id: 1, title: 'Lab semana01', audioUrl: '/api/assets/x.mp3', mimeType: 'audio/mpeg', durationMs: 700_000,
        requiredThroughMs: 660_000, forEveryone: true, active: true, createdBy: 1,
      });
      await testDb.insert(schema.labSubmissions).values({
        labId: 1, userId: 2, requiredThroughMs: 660_000, voicedMs: 90_000, listenedCoveredMs: 660_000, listenWallMs: 661_000,
        startedAt: new Date('2026-09-25T15:00:00Z'), submittedAt: new Date('2026-09-25T15:12:00Z'),
        pausesCounted: 10, pausesAnswered: 4, minAnsweredPct: 75, credit: false, flags: '[]',
      });
      const { csv, rowCount } = await (await callerAs(teacher)).exportGroupData({ groupId: PERIOD, dataset: 'labs' });
      const [header, ...rows] = csv.split('\n');
      expect(header).toBe('student_name,student_email,lab,status,submitted_at,attempts,heard_through_s,required_through_s,skips,started_at,elapsed_s,voice_s,min_voice_s,pauses_answered,pauses_counted,needed,mic,credit_by,flags,held_for,level_only_answered');
      expect(rowCount).toBe(2);
      expect(rows.map((r) => r.split(',')[3])).toEqual(['missing', 'redo']);
    });
  });

  it('getUserStats gives each user their role and correct reviews', async () => {
    const reviewedAt = new Date('2026-09-24T18:00:00.000Z');
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 500, previousState: 0, newState: 1 },
      { cardId: 1, userId: 2, rating: 1, reviewedAt, timeSpentMs: 500, previousState: 1, newState: 1 },
      { cardId: 1, userId: 2, rating: 4, reviewedAt, timeSpentMs: 500, previousState: 1, newState: 2 },
    ]);
    const stats = await (await callerAs(teacher)).getUserStats();
    expect(stats.find((s) => s.userId === 2)).toMatchObject({ role: 'user', totalReviews: 3, correctReviews: 2 });
    expect(stats.find((s) => s.userId === 1)).toMatchObject({ role: 'admin', totalReviews: 0, correctReviews: 0 });
  });

  it('getUserStats and getGroupStats count each rating\'s time up to RATING_TIME_CAP_MS (an old row could claim any time)', async () => {
    const { RATING_TIME_CAP_MS } = await import('../services/flashcardDay.js');
    const reviewedAt = new Date('2026-09-24T18:00:00.000Z');
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 4_000, previousState: 0, newState: 1 },
      { cardId: 1, userId: 2, rating: 3, reviewedAt, timeSpentMs: 7_200_000, previousState: 1, newState: 2 },
    ]);
    const api = await callerAs(teacher);
    expect((await api.getUserStats()).find((s) => s.userId === 2)?.totalTimeMs).toBe(4_000 + RATING_TIME_CAP_MS);
    expect((await api.getGroupStats({ groupId: PERIOD })).totalTimeMs).toBe(4_000 + RATING_TIME_CAP_MS);
  });

  it('getUserStats says when each user was last active at anything, as the Users tab does, and their school ID', async () => {
    await testDb.insert(schema.studentNumberOverrides).values({ userId: 3, studentNumber: '98765' });
    await testDb.insert(schema.reviewLogs).values({
      cardId: 1, userId: 2, rating: 3, reviewedAt: new Date('2026-09-20T18:00:00Z'), timeSpentMs: 500, previousState: 0, newState: 1,
    });
    // Ana's later conjugation answer (stored in ms) is the latest thing she did.
    const [round] = await testDb.insert(schema.conjugationRounds).values({
      userId: 2, deckId: 1, queue: '[]', prompts: 1, settingsSnapshot: '{}', startedAt: new Date('2026-09-22T18:00:00Z'),
    }).returning();
    await testDb.insert(schema.conjugationAnswers).values({
      roundId: round.id, userId: 2, deckId: 1, itemKey: 'k', levelKind: 'choice', given: 'x', result: 'correct',
      at: new Date('2026-09-22T18:05:00Z'),
    });
    // Beto never rated a card, but finished a deck ("All Done!", stored in seconds).
    await testDb.insert(schema.studyCompletions).values({
      userId: 3, deckId: 1, reason: 'nothing_due', completedAt: new Date('2026-09-21T09:00:00Z'),
    });
    const stats = await (await callerAs(teacher)).getUserStats();
    const users = await (await callerAs(teacher)).getUsers();
    for (const id of [1, 2, 3]) {
      const stat = stats.find((s) => s.userId === id)!;
      const listed = users.find((u) => u.id === id)!;
      expect(stat.lastActive?.getTime() ?? null).toBe(listed.lastActiveAt);
      expect(stat.studentNumber).toBe(listed.studentNumber);
    }
    expect(stats.find((s) => s.userId === 2)).toMatchObject({ lastActive: new Date('2026-09-22T18:05:00Z'), studentNumber: '123456', totalReviews: 1 });
    expect(stats.find((s) => s.userId === 3)).toMatchObject({ lastActive: new Date('2026-09-21T09:00:00Z'), studentNumber: '98765', totalReviews: 0 });
    expect(stats.find((s) => s.userId === 1)).toMatchObject({ lastActive: null, studentNumber: null });
  });

  it('getGroupMembers gives each member their last activity, as the Users tab has it, and their school ID', async () => {
    // Someone outside the group, active later than anyone in it: not a member, and not read.
    await testDb.insert(schema.users).values({ id: 4, googleId: 's3', email: '555555@students.school.test', name: 'Cata', role: 'user' });
    await testDb.insert(schema.studentNumberOverrides).values({ userId: 3, studentNumber: '98765' });
    await testDb.insert(schema.reviewLogs).values([
      { cardId: 1, userId: 2, rating: 3, reviewedAt: new Date('2026-09-20T18:00:00Z'), timeSpentMs: 500, previousState: 0, newState: 1 },
      { cardId: 1, userId: 4, rating: 3, reviewedAt: new Date('2026-09-25T18:00:00Z'), timeSpentMs: 500, previousState: 0, newState: 1 },
    ]);
    await testDb.insert(schema.studyCompletions).values({
      userId: 3, deckId: 1, reason: 'nothing_due', completedAt: new Date('2026-09-21T09:00:00Z'),
    });
    const api = await callerAs(teacher);
    const members = await api.getGroupMembers({ groupId: PERIOD });
    const users = await api.getUsers();
    expect(members.map((m) => m.id).sort()).toEqual([1, 2, 3]);
    for (const member of members) {
      const listed = users.find((u) => u.id === member.id)!;
      expect(member.lastActiveAt).toBe(listed.lastActiveAt);
      expect(member.studentNumber).toBe(listed.studentNumber);
    }
    expect(members.find((m) => m.id === 2)).toMatchObject({ lastActiveAt: Date.parse('2026-09-20T18:00:00Z'), studentNumber: '123456' });
    expect(members.find((m) => m.id === 3)).toMatchObject({ lastActiveAt: Date.parse('2026-09-21T09:00:00Z'), studentNumber: '98765' });
    expect(members.find((m) => m.id === 1)).toMatchObject({ lastActiveAt: null, studentNumber: null });
    expect(members.every((m) => m.joinedAt instanceof Date)).toBe(true);
  });

  it('getAllUserSettings counts today per deck: the most in one deck, how many decks, and the total', async () => {
    const today = new Date();
    const add = (cardId: number, previousState: number) => testDb.insert(schema.reviewLogs).values({
      cardId, userId: 2, rating: 3, reviewedAt: today, timeSpentMs: 500, previousState, newState: 2,
    });
    // 3 new + 1 review in Unit 1, 2 new + 2 reviews in Unit 2, and a learning step (neither).
    for (const [cardId, state] of [[1, 0], [1, 0], [1, 0], [1, 2], [2, 0], [2, 0], [2, 2], [2, 2], [2, 1]]) await add(cardId, state);
    const rows = await (await callerAs(teacher)).getAllUserSettings({ timezoneOffsetMinutes: -new Date().getTimezoneOffset() });
    expect(rows.find((r) => r.userId === 2)).toMatchObject({
      newCardsDoneToday: 3, reviewsDoneToday: 2, decksToday: 2, studiedToday: 8,
    });
    expect(rows.find((r) => r.userId === 3)).toMatchObject({ newCardsDoneToday: 0, reviewsDoneToday: 0, decksToday: 0, studiedToday: 0 });
  });

  it('getUsers adds when each user was last active and their school ID', async () => {
    await testDb.insert(schema.studentNumberOverrides).values({ userId: 3, studentNumber: '98765' });
    await testDb.insert(schema.reviewLogs).values({
      cardId: 1, userId: 2, rating: 3, reviewedAt: new Date('2026-09-20T18:00:00Z'), timeSpentMs: 500, previousState: 0, newState: 1,
    });
    // A later conjugation answer (stored in ms) is the latest thing Ana did.
    const [round] = await testDb.insert(schema.conjugationRounds).values({
      userId: 2, deckId: 1, queue: '[]', prompts: 1, settingsSnapshot: '{}', startedAt: new Date('2026-09-22T18:00:00Z'),
    }).returning();
    await testDb.insert(schema.conjugationAnswers).values({
      roundId: round.id, userId: 2, deckId: 1, itemKey: 'k', levelKind: 'choice', given: 'x', result: 'correct',
      at: new Date('2026-09-22T18:05:00Z'),
    });
    // Beto's last "All Done!" (stored in seconds).
    await testDb.insert(schema.studyCompletions).values({
      userId: 3, deckId: 1, reason: 'nothing_due', completedAt: new Date('2026-09-21T09:00:00Z'),
    });
    const users = await (await callerAs(teacher)).getUsers();
    expect(users.find((u) => u.id === 2)).toMatchObject({ lastActiveAt: Date.parse('2026-09-22T18:05:00Z'), studentNumber: '123456' });
    expect(users.find((u) => u.id === 3)).toMatchObject({ lastActiveAt: Date.parse('2026-09-21T09:00:00Z'), studentNumber: '98765' });
    expect(users.find((u) => u.id === 1)).toMatchObject({ lastActiveAt: null, studentNumber: null });
  });

  it('keeps the new reports and the user detail for admins', async () => {
    const api = await callerAs(student);
    await expect(api.groupFlashcardDay({ groupId: PERIOD })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.userDetail({ userId: 2 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.getUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('groupFlashcardDay answers a group\'s day and refuses a day that is not a date', async () => {
    await testDb.insert(schema.deckGroups).values({ deckId: 1, groupId: PERIOD });
    await testDb.insert(schema.studyCompletions).values({
      userId: 2, deckId: 1, reason: 'session_complete', completedAt: new Date('2026-09-24T17:00:00Z'),
    });
    const api = await callerAs(teacher);
    const view = await api.groupFlashcardDay({ groupId: PERIOD, day: '2026-09-24' });
    expect(view.students.map((s) => s.name)).toEqual(['=Beto', 'Ana'].sort((a, b) => a.localeCompare(b)));
    expect(view.students.find((s) => s.id === 2)?.cells[0].finishedAt).toBe(Date.parse('2026-09-24T17:00:00Z'));
    await expect(api.groupFlashcardDay({ groupId: PERIOD, day: '2026-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  describe('a student added to a group later gets its settings', () => {
    const LATER = 9;
    const groupRow = {
      groupId: LATER, newCardsPerDay: 25, reviewsPerDay: 30, isOverride: true, allowHigher: true, allowLower: false,
      aiEnabled: false, aiEnabledLocked: true, locale: 'es', localeLocked: true,
    };
    beforeEach(async () => {
      await testDb.insert(schema.groups).values({ id: LATER, name: 'Year 1 Spanish' });
    });

    it('with the group\'s Override on, one student and several', async () => {
      await testDb.insert(schema.groupSettings).values(groupRow);
      const api = await callerAs(teacher);
      expect(await api.addUserToGroup({ userId: 2, groupId: LATER })).toEqual({ success: true, settingsApplied: true });
      expect(await testDb.query.userSettings.findFirst({ where: (s, { eq }) => eq(s.userId, 2) })).toMatchObject({
        newCardsPerDay: 25, reviewsPerDay: 30, isOverride: true, allowHigher: true, allowLower: false, aiEnabled: false, locale: 'es',
      });

      // The batch: Ana is already in (nothing changes for her), Beto joins.
      await testDb.update(schema.userSettings).set({ newCardsPerDay: 40 }).run();
      expect(await api.addUsersToGroup({ groupId: LATER, userIds: [2, 3] }))
        .toEqual({ success: true, requested: 2, added: 1, settingsApplied: 1 });
      const rows = await testDb.query.userSettings.findMany();
      // What the teacher set for Ana alone since she joined stays.
      expect(rows.find((r) => r.userId === 2)?.newCardsPerDay).toBe(40);
      expect(rows.find((r) => r.userId === 3)).toMatchObject({ newCardsPerDay: 25, isOverride: true, locale: 'es' });
    });

    it('never with the Override off or no group settings', async () => {
      await testDb.insert(schema.groupSettings).values({ ...groupRow, isOverride: false });
      const api = await callerAs(teacher);
      expect(await api.addUserToGroup({ userId: 2, groupId: LATER })).toEqual({ success: true, settingsApplied: false });
      expect(await api.addUsersToGroup({ groupId: PERIOD, userIds: [3] })).toMatchObject({ added: 0, settingsApplied: 0 });
      await testDb.insert(schema.groups).values({ id: 10, name: 'No settings' });
      expect(await api.addUsersToGroup({ groupId: 10, userIds: [2, 3] })).toMatchObject({ added: 2, settingsApplied: 0 });
      expect(await testDb.query.userSettings.findMany()).toEqual([]);
      expect(await testDb.query.groupSettings.findFirst({ where: (g, { eq }) => eq(g.groupId, 10) })).toBeUndefined();
    });

    it('never from a Classroom import', async () => {
      const applyOne = vi.fn(async () => true);
      const applyMany = vi.fn(async () => 1);
      vi.doMock('../services/groupSettings.js', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../services/groupSettings.js')>()),
        applyGroupSettingsToUser: applyOne,
        applyGroupSettingsToUsers: applyMany,
      }));
      const api = await callerAs(teacher);
      await api.importGoogleClassroomGroup({
        name: 'Period 3', csvContent: 'First Name,Last Name,Email Address,Role\nCarla,C,carla@example.com,Student',
      });
      expect(applyOne).not.toHaveBeenCalled();
      expect(applyMany).not.toHaveBeenCalled();
      // The same mock does see a join, so the check above means something.
      await api.addUserToGroup({ userId: 2, groupId: LATER });
      expect(applyOne).toHaveBeenCalledWith(LATER, 2);
    });
  });
});
