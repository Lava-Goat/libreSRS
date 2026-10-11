// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it, vi } from 'vitest';
import { decideGoogleOAuthEndpoints, googleOAuthEndpointOptions } from './oauthEndpoints.js';

const FAKE = {
  LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL: 'http://127.0.0.1:16768/authorize',
  LIBRESRS_E2E_GOOGLE_TOKEN_URL: 'http://127.0.0.1:16768/token',
  LIBRESRS_E2E_GOOGLE_USERINFO_URL: 'http://127.0.0.1:16768/userinfo',
};
const OPTED_IN = { NODE_ENV: 'test', LIBRESRS_E2E_FAKE_OAUTH: '1', ...FAKE };

const silentLog = () => ({ warn: vi.fn(), error: vi.fn() });

describe('decideGoogleOAuthEndpoints', () => {
  it('uses Google, quietly, when nothing asks for the fake provider', () => {
    expect(decideGoogleOAuthEndpoints({})).toEqual({ use: 'google' });
    expect(decideGoogleOAuthEndpoints({ NODE_ENV: 'production' })).toEqual({ use: 'google' });
  });

  it('uses the fake provider only with NODE_ENV=test, the opt-in, and all three URLs', () => {
    expect(decideGoogleOAuthEndpoints(OPTED_IN)).toEqual({
      use: 'fake',
      endpoints: {
        authorizationURL: FAKE.LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL,
        tokenURL: FAKE.LIBRESRS_E2E_GOOGLE_TOKEN_URL,
        userProfileURL: FAKE.LIBRESRS_E2E_GOOGLE_USERINFO_URL,
      },
    });
    expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, NODE_ENV: ' Test ' }).use).toBe('fake');
  });

  it('refuses the fake provider unless NODE_ENV is test, even fully opted in', () => {
    // A forgotten NODE_ENV (a hand-run server, `npm run dev` on a networked box) is not a test run.
    for (const NODE_ENV of [undefined, '', 'development', 'staging', 'prod']) {
      expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, NODE_ENV })).toMatchObject({ use: 'google', refused: 'not-test' });
    }
    for (const NODE_ENV of ['production', 'Production', ' production ']) {
      expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, NODE_ENV })).toMatchObject({ use: 'google', refused: 'not-test' });
    }
    // The opt-in alone, or the URLs alone, are refused in production as well.
    expect(decideGoogleOAuthEndpoints({ NODE_ENV: 'production', LIBRESRS_E2E_FAKE_OAUTH: '1' }))
      .toMatchObject({ use: 'google', refused: 'not-test' });
    expect(decideGoogleOAuthEndpoints({ NODE_ENV: 'production', ...FAKE }))
      .toMatchObject({ use: 'google', refused: 'not-test' });
  });

  it('refuses the URLs without the explicit opt-in', () => {
    expect(decideGoogleOAuthEndpoints({ NODE_ENV: 'test', ...FAKE })).toMatchObject({ use: 'google', refused: 'no-opt-in' });
    for (const optIn of ['true', 'yes', '0', 'on']) {
      expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_FAKE_OAUTH: optIn }))
        .toMatchObject({ use: 'google', refused: 'no-opt-in' });
    }
  });

  it('refuses a missing or malformed URL instead of mixing Google with the fake provider', () => {
    expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_GOOGLE_TOKEN_URL: undefined }))
      .toMatchObject({ use: 'google', refused: 'incomplete' });
    expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_GOOGLE_USERINFO_URL: 'not a url' }))
      .toMatchObject({ use: 'google', refused: 'incomplete' });
    expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL: 'file:///etc/passwd' }))
      .toMatchObject({ use: 'google', refused: 'incomplete' });
  });

  it('refuses a provider that is not on this machine', () => {
    expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_GOOGLE_TOKEN_URL: 'https://login.evil.example/token' }))
      .toMatchObject({ use: 'google', refused: 'not-loopback' });
    expect(decideGoogleOAuthEndpoints({
      ...OPTED_IN,
      LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL: 'http://localhost:1/authorize',
      LIBRESRS_E2E_GOOGLE_TOKEN_URL: 'http://[::1]:1/token',
    }).use).toBe('fake');
    // Look-alike hosts and userinfo tricks: the hostname has to be loopback exactly, not merely start with it.
    for (const url of [
      'http://127.0.0.1.evil.example/token',
      'http://localhost.evil.example/token',
      'http://127.0.0.1@evil.example/token',
      'http://evil.example#@127.0.0.1/token',
      'http://0.0.0.0:16768/token',
    ]) {
      expect(decideGoogleOAuthEndpoints({ ...OPTED_IN, LIBRESRS_E2E_GOOGLE_TOKEN_URL: url }))
        .toMatchObject({ use: 'google', refused: 'not-loopback' });
    }
  });
});

describe('googleOAuthEndpointOptions', () => {
  it('adds nothing to the strategy and logs nothing when not asked', () => {
    const log = silentLog();
    expect(googleOAuthEndpointOptions({ NODE_ENV: 'production' }, log)).toEqual({});
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('adds nothing in production and logs an error saying the settings were ignored', () => {
    const log = silentLog();
    expect(googleOAuthEndpointOptions({ ...OPTED_IN, NODE_ENV: 'production' }, log)).toEqual({});
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'not-test' }),
      expect.stringContaining('Ignoring'),
    );
  });

  it('adds nothing without the opt-in and logs an error', () => {
    const log = silentLog();
    expect(googleOAuthEndpointOptions({ NODE_ENV: 'test', ...FAKE }, log)).toEqual({});
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no-opt-in' }), expect.any(String));
  });

  it('points the strategy at the fake provider with a loud warning when allowed', () => {
    const log = silentLog();
    expect(googleOAuthEndpointOptions(OPTED_IN, log)).toEqual({
      authorizationURL: FAKE.LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL,
      tokenURL: FAKE.LIBRESRS_E2E_GOOGLE_TOKEN_URL,
      userProfileURL: FAKE.LIBRESRS_E2E_GOOGLE_USERINFO_URL,
    });
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('TEST SIGN-IN ACTIVE'));
    expect(log.error).not.toHaveBeenCalled();
  });
});
