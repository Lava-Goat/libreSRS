// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { loginErrorPath, safeReturnTo } from './returnTo.js';

describe('safeReturnTo', () => {
  it('keeps a path on this site, with its query and hash', () => {
    expect(safeReturnTo('/signups?sheet=3')).toBe('/signups?sheet=3');
    expect(safeReturnTo('/speaking?task=12#top')).toBe('/speaking?task=12#top');
    expect(safeReturnTo('/')).toBe('/');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      '//evil.example/x',
      '/\\evil.example',
      '/\\/evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'signups',
      '/sign\nups',
      '/sign\tups',
      '',
      '/'.padEnd(600, 'a'),
    ]) {
      expect(safeReturnTo(value), JSON.stringify(value)).toBeNull();
    }
    // Dot segments that resolve into a protocol-relative path.
    expect(safeReturnTo('/.//evil.example')).toBeNull();
    expect(safeReturnTo('/%2e%2e//evil.example/x')).toBeNull();
    expect(safeReturnTo('/a/..//evil.example')).toBeNull();
    // An encoded line break stays encoded: it is a path, not a header.
    expect(safeReturnTo('/%0d%0aSet-Cookie:x')).toBe('/%0d%0aSet-Cookie:x');
  });

  it('refuses the sign-in pages and the API, so login cannot loop', () => {
    expect(safeReturnTo('/login')).toBeNull();
    expect(safeReturnTo('/login?error=auth_failed')).toBeNull();
    expect(safeReturnTo('/auth/google')).toBeNull();
    expect(safeReturnTo('/api/trpc/auth.me')).toBeNull();
    // Express routes ignore case, so these must too.
    expect(safeReturnTo('/Auth/google/classroom')).toBeNull();
    expect(safeReturnTo('/API/trpc/x')).toBeNull();
    expect(safeReturnTo('/LOGIN')).toBeNull();
    expect(safeReturnTo('/loginhelp')).toBe('/loginhelp');
  });

  it('refuses what is not a string', () => {
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(['/signups'])).toBeNull();
    expect(safeReturnTo({ path: '/signups' })).toBeNull();
  });
});

describe('loginErrorPath', () => {
  it('keeps the page to return to on the error redirect', () => {
    expect(loginErrorPath('not_authorized', '/signups?sheet=3')).toBe('/login?error=not_authorized&returnTo=%2Fsignups%3Fsheet%3D3');
    expect(loginErrorPath('auth_failed', null)).toBe('/login?error=auth_failed');
  });
});
