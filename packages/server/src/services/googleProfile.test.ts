// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it, vi } from 'vitest';
import type { Profile } from 'passport-google-oauth20';
import { loadGoogleProfile, profileFromIdToken } from './googleProfile.js';

const CLIENT = 'client-123.apps.googleusercontent.com';
const NOW = new Date('2026-10-08T20:40:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

/** An unsigned JWT with these claims (the signature is not read: the token comes from Google's token endpoint). */
function idToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`;
}
const good = {
  iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: '1098765', exp: nowSeconds + 3000,
  email: '100001@students.school.test', email_verified: true, name: 'Ana Ejemplo', picture: 'https://lh3.example/p.jpg',
};
const userinfoProfile = { provider: 'google', id: '1098765', displayName: 'Ana Ejemplo', emails: [{ value: '100001@students.school.test', verified: true }] } as unknown as Profile;
const invalidCredentials = Object.assign(new Error('Invalid Credentials'), { name: 'UserInfoError' });

describe('profileFromIdToken', () => {
  it('reads a Google ID token for this app into a passport-style profile', () => {
    const profile = profileFromIdToken(idToken(good), CLIENT, NOW)!;
    expect(profile.id).toBe('1098765');
    expect(profile.emails).toEqual([{ value: '100001@students.school.test', verified: true }]);
    expect(profile.displayName).toBe('Ana Ejemplo');
    expect(profile.photos).toEqual([{ value: 'https://lh3.example/p.jpg' }]);
  });

  it('accepts the issuer without https and a string "true" for the verified email', () => {
    expect(profileFromIdToken(idToken({ ...good, iss: 'accounts.google.com', email_verified: 'true' }), CLIENT, NOW)).not.toBeNull();
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['another app', { aud: 'other-client', azp: 'other-client' }],
    ['several audiences without this app as azp', { aud: [CLIENT, 'other'], azp: 'other' }],
    ['an expired token', { exp: nowSeconds - 120 }],
    ['no expiry', { exp: undefined }],
    ['an unverified email', { email_verified: false }],
    ['no email', { email: undefined }],
    ['no subject', { sub: undefined }],
  ])('refuses %s', (_label, change) => {
    expect(profileFromIdToken(idToken({ ...good, ...change }), CLIENT, NOW)).toBeNull();
  });

  it('refuses a missing or malformed token', () => {
    expect(profileFromIdToken(undefined, CLIENT, NOW)).toBeNull();
    expect(profileFromIdToken('not-a-jwt', CLIENT, NOW)).toBeNull();
    expect(profileFromIdToken('a.%%%.c', CLIENT, NOW)).toBeNull();
  });
});

describe('loadGoogleProfile', () => {
  const opts = { retryDelayMs: 0, now: () => NOW };

  it('uses userinfo when Google answers, asking once', async () => {
    const fetch = vi.fn().mockResolvedValue(userinfoProfile);
    const out = await loadGoogleProfile(fetch, 'token', idToken(good), CLIENT, opts);
    expect(out.source).toBe('userinfo');
    expect(out.profile).toBe(userinfoProfile);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks once more after an "Invalid Credentials", and uses that answer', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(invalidCredentials).mockResolvedValueOnce(userinfoProfile);
    const out = await loadGoogleProfile(fetch, 'token', undefined, CLIENT, opts);
    expect(out.source).toBe('userinfo-retry');
    expect(out.firstError).toBe(invalidCredentials);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the ID token when userinfo refuses twice', async () => {
    const fetch = vi.fn().mockRejectedValue(invalidCredentials);
    const out = await loadGoogleProfile(fetch, 'token', idToken(good), CLIENT, opts);
    expect(out.source).toBe('id-token');
    expect(out.profile.emails?.[0].value).toBe('100001@students.school.test');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails as before, with the userinfo error, when there is no usable ID token', async () => {
    const fetch = vi.fn().mockRejectedValue(invalidCredentials);
    await expect(loadGoogleProfile(fetch, 'token', undefined, CLIENT, opts)).rejects.toBe(invalidCredentials);
    await expect(loadGoogleProfile(fetch, 'token', idToken({ ...good, aud: 'other' }), CLIENT, opts)).rejects.toBe(invalidCredentials);
  });
});
