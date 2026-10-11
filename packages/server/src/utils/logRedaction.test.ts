// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, describe, expect, it } from 'vitest';
import { hashForLog, REDACTED_QUERY, urlForLog } from './logRedaction.js';

describe('urlForLog', () => {
  it('drops the query string of every sign-in address', () => {
    expect(urlForLog('/auth/google/callback?code=4%2F0Abc&state=xyz&scope=email')).toBe('/auth/google/callback');
    expect(urlForLog('/auth/google?returnTo=%2Fstudy%2F3')).toBe('/auth/google');
    expect(urlForLog('/auth/google/classroom/callback?code=abc')).toBe('/auth/google/classroom/callback');
    expect(urlForLog('/auth?x=1')).toBe('/auth');
  });

  it('keeps other URLs, unless their query holds an email address (plain or URL-encoded)', () => {
    expect(urlForLog('/api/trpc/cards.getDue?batch=1&input=%7B%220%22%3A%7B%22deckId%22%3A3%7D%7D'))
      .toBe('/api/trpc/cards.getDue?batch=1&input=%7B%220%22%3A%7B%22deckId%22%3A3%7D%7D');
    expect(urlForLog('/api/trpc/admin.users?input=%7B%22q%22%3A%22123456%40school.test%22%7D'))
      .toBe(`/api/trpc/admin.users${REDACTED_QUERY}`);
    expect(urlForLog('/x?email=a.b@school.test')).toBe(`/x${REDACTED_QUERY}`);
    expect(urlForLog('/study/3')).toBe('/study/3');
    // A malformed escape is checked as typed.
    expect(urlForLog('/x?q=%E0%A4%A&e=a@b.test')).toBe(`/x${REDACTED_QUERY}`);
  });

  it('does not treat a path that merely starts with "auth" as a sign-in address', () => {
    expect(urlForLog('/authors?page=2')).toBe('/authors?page=2');
  });
});

describe('hashForLog', () => {
  const saved = { LOG_HASH_KEY: process.env.LOG_HASH_KEY, SESSION_SECRET: process.env.SESSION_SECRET };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('is 16 hex characters, the same for the same value, and ignores case and spaces', () => {
    process.env.LOG_HASH_KEY = 'k1';
    const a = hashForLog('Teacher@School.test ');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashForLog('teacher@school.test')).toBe(a);
    expect(hashForLog('other@school.test')).not.toBe(a);
    expect(a).not.toContain('teacher');
  });

  it('depends on the key, so a guessed email cannot be checked without it', () => {
    process.env.LOG_HASH_KEY = 'k1';
    const one = hashForLog('123456');
    process.env.LOG_HASH_KEY = 'k2';
    expect(hashForLog('123456')).not.toBe(one);
    delete process.env.LOG_HASH_KEY;
    process.env.SESSION_SECRET = 's';
    expect(hashForLog('123456')).toMatch(/^[0-9a-f]{16}$/);
  });
});
