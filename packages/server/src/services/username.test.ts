// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { normalizeUsername } from './username.js';

describe('normalizeUsername', () => {
  it('takes a student number or a full email, trimmed and in any case', () => {
    expect(normalizeUsername(' 100001 ')).toEqual({ localPart: '100001' });
    expect(normalizeUsername('100001@Students.School.test')).toEqual({ email: '100001@students.school.test' });
    expect(normalizeUsername('')).toBeNull();
    expect(normalizeUsername('a b')).toBeNull();
    expect(normalizeUsername('a@b@c')).toBeNull();
    expect(normalizeUsername(42)).toBeNull();
  });
});
