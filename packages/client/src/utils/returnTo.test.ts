// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { loginPathFor, safeReturnTo } from './returnTo';

describe('returnTo', () => {
  it('remembers a page on this site', () => {
    expect(loginPathFor('/signups?sheet=3')).toBe('/login?returnTo=%2Fsignups%3Fsheet%3D3');
    expect(safeReturnTo('/speaking?task=2')).toBe('/speaking?task=2');
  });

  it('forgets the home page, the login page and anything off the site', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/login?error=auth_failed')).toBe('/login');
    expect(loginPathFor('/Login')).toBe('/login');
    expect(safeReturnTo('/AUTH/google')).toBeNull();
    for (const value of ['//evil.example', '/\\evil.example', 'https://evil.example', '/auth/google', '/api/trpc', '', null, undefined]) {
      expect(safeReturnTo(value)).toBeNull();
    }
  });
});
