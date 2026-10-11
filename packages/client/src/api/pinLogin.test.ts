// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { PinLoginError as ServerPinLoginError, PinLoginResponse } from '../../../server/src/routers/pinLogin.ts';
import { signInWithPin, type PinLoginError, type PinLoginResult } from './pinLogin';

/** A test PIN (never a real one). */
const PIN = '5927';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('signInWithPin', () => {
  it('mirrors what the server answers (checked by tsc: a new server error must be added here)', () => {
    expectTypeOf<PinLoginError>().toEqualTypeOf<ServerPinLoginError>();
    expectTypeOf<PinLoginResponse>().toExtend<PinLoginResult>();
  });

  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'libresrs_csrf=token-1; path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'libresrs_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('POSTs JSON with the CSRF header and the session cookie, and keeps the PIN out of the URL', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, redirectTo: '/signups?sheet=3' }));

    const result = await signInWithPin({ username: '  123456 ', pin: PIN, returnTo: '/signups?sheet=3' });

    expect(result).toEqual({ ok: true, redirectTo: '/signups?sheet=3' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/auth/pin');
    expect(String(url)).not.toContain(PIN);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'token-1' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({ username: '123456', pin: PIN, returnTo: '/signups?sheet=3' });
  });

  it('leaves returnTo out when there is none', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, redirectTo: '/' }));
    await signInWithPin({ username: '123456', pin: PIN, returnTo: null });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ username: '123456', pin: PIN });
  });

  it.each([
    [401, 'INVALID'],
    [401, 'USE_FULL_EMAIL'],
    [403, 'PIN_DISABLED'],
    [403, 'CROSS_ORIGIN'],
    [400, 'BAD_REQUEST'],
    [415, 'JSON_REQUIRED'],
    [413, 'TOO_LARGE'],
    [500, 'SERVER_ERROR'],
  ] as const)('maps %i %s to that error', async (status, error) => {
    fetchMock.mockResolvedValueOnce(json(status, { ok: false, error }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error });
  });

  it('passes on the minutes a lock has left, and the network limit', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { ok: false, error: 'LOCKED', retryAfterMinutes: 15 }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'LOCKED', retryAfterMinutes: 15 });

    fetchMock.mockResolvedValueOnce(json(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: 4 }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: 4 });
  });

  it('ignores minutes that are not a number', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { ok: false, error: 'LOCKED', retryAfterMinutes: 'soon' }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'LOCKED' });
  });

  it('retries once when the CSRF cookie was missing (that refusal sets it)', async () => {
    fetchMock
      .mockResolvedValueOnce(json(403, { error: 'CSRF token required' }))
      .mockResolvedValueOnce(json(200, { ok: true, redirectTo: '/' }));

    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: true, redirectTo: '/' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['CSRF token mismatch', 'CSRF token required'])('retries a CSRF refusal (%s) only once, not twice', async (error) => {
    // A new Response for every call (a body reads only once), as the server sends a fresh 403 each time.
    fetchMock.mockImplementation(async () => json(403, { error }));

    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'SERVER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refusal that is not about CSRF', async () => {
    fetchMock.mockResolvedValue(json(403, { ok: false, error: 'PIN_DISABLED' }));
    await signInWithPin({ username: '123456', pin: PIN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the /auth rate limit’s text 429 as too many tries, and other text as a server error', async () => {
    fetchMock.mockResolvedValueOnce(text(429, 'Too many requests, please try again later.'));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'TOO_MANY_ATTEMPTS' });

    fetchMock.mockResolvedValueOnce(text(502, 'Bad gateway'));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'SERVER_ERROR' });
  });

  it('never trusts an "ok" that is not a 2xx, nor an error it does not know', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { ok: true, redirectTo: '/' }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'SERVER_ERROR' });

    fetchMock.mockResolvedValueOnce(json(401, { ok: false, error: 'SOMETHING_NEW' }));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'SERVER_ERROR' });
  });

  it('answers NETWORK when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signInWithPin({ username: '123456', pin: PIN })).toEqual({ ok: false, error: 'NETWORK' });
  });
});
