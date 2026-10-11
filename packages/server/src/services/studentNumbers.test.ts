// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
vi.mock('../db/index.js', () => ({ db: testDb, schema }));

let svc: typeof import('./studentNumbers.js');

beforeAll(async () => {
  svc = await import('./studentNumbers.js');
});

beforeEach(async () => {
  await setupFsrsSchema(client, { reset: true });
  testDb.insert(schema.users).values([
    { id: 1, googleId: 'g1', email: '123456@students.school.test', name: 'Ana', role: 'user' },
    { id: 2, googleId: 'g2', email: 'carla.vega@students.school.test', name: 'Carla', role: 'user' },
    { id: 3, googleId: 'g3', email: '654321@students.school.test', name: 'Beto', role: 'user' },
  ]).run();
});

describe('student numbers', () => {
  it('takes a school ID only from an all-digit email, and accepts only a one-line ID from the teacher', () => {
    const { studentNumberFromEmail, normalizeStudentNumber } = svc;
    expect(studentNumberFromEmail('123456@students.school.test')).toBe('123456');
    expect(studentNumberFromEmail('1234@students.school.test')).toBe('1234');
    expect(studentNumberFromEmail('carla.vega@students.school.test')).toBeNull();
    expect(studentNumberFromEmail('12345a@students.school.test')).toBeNull();
    expect(normalizeStudentNumber(' 654321 ')).toBe('654321');
    expect(normalizeStudentNumber('S-1022')).toBe('S-1022');
    for (const bad of ['', '12 34', '123\n456', 'a'.repeat(33), '12,34']) expect(normalizeStudentNumber(bad), bad).toBeNull();
  });

  it('reads the teacher\'s override first, else the email\'s digits, inside a transaction or out', () => {
    testDb.insert(schema.studentNumberOverrides).values([
      { userId: 2, studentNumber: 'S-1022' },
      { userId: 3, studentNumber: '777777' },
    ]).run();
    expect(svc.studentNumberOf(testDb, 1, '123456@students.school.test')).toBe('123456');
    expect(svc.studentNumberOf(testDb, 2, 'carla.vega@students.school.test')).toBe('S-1022');
    expect(testDb.transaction((tx) => svc.studentNumberOf(tx, 3, '654321@students.school.test'))).toBe('777777');
    expect(svc.studentNumberOf(testDb, 4, 'not-digits@school.test')).toBeNull();
  });

  it('lists every override by user id', () => {
    expect(svc.studentNumberOverrideMap()).toEqual(new Map());
    testDb.insert(schema.studentNumberOverrides).values([
      { userId: 2, studentNumber: 'S-1022' },
      { userId: 3, studentNumber: '777777' },
    ]).run();
    expect(svc.studentNumberOverrideMap()).toEqual(new Map([[2, 'S-1022'], [3, '777777']]));
  });
});
