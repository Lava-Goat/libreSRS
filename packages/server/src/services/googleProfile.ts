// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The Google profile of a student signing in. Google hands libreSRS an access token, and the
 * profile comes from Google's userinfo endpoint. Now and then that endpoint answers "Invalid
 * Credentials" for one student's sign-in while classmates' go through (once about ten
 * tries in a row for one student, then it worked), and the student lands back on the login page.
 * So: ask once more after a moment; if Google still says no, use the identity in the ID token
 * Google returned with the access token. That token came straight from Google's token endpoint
 * over TLS, which OpenID Connect accepts in place of checking its signature (Core 1.0,
 * §3.1.3.7), but it must still be Google's, for this app, not expired, with a verified email.
 */
import type { Profile } from 'passport-google-oauth20';

/** How a profile was found: the first userinfo answer, the second, or the ID token. */
export type GoogleProfileSource = 'userinfo' | 'userinfo-retry' | 'id-token';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Clock slack for the ID token's expiry (Google's clock and this server's). */
const EXPIRY_SLACK_SECONDS = 60;

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

/**
 * The profile in a Google ID token, shaped like passport-google-oauth20's (OpenID format), or
 * null when the token is not one this sign-in may trust.
 */
export function profileFromIdToken(idToken: string | undefined, clientId: string, now = new Date()): Profile | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let claims: IdTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    return null;
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (!audiences.includes(clientId)) return null;
  if (audiences.length > 1 && claims.azp !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp + EXPIRY_SLACK_SECONDS < now.getTime() / 1000) return null;
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.sub || !claims.email || !verified) return null;
  return {
    provider: 'google',
    id: claims.sub,
    displayName: claims.name ?? '',
    emails: [{ value: claims.email, verified: true }],
    photos: claims.picture ? [{ value: claims.picture }] : [],
    profileUrl: '',
    _raw: '',
    _json: claims as unknown as Profile['_json'],
  };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * The student's Google profile: userinfo, then userinfo once more, then the ID token. Throws the
 * userinfo error when none of the three gives a profile (the sign-in fails as before).
 */
export async function loadGoogleProfile(
  fetchProfile: (accessToken: string) => Promise<Profile>,
  accessToken: string,
  idToken: string | undefined,
  clientId: string,
  options: { retryDelayMs?: number; now?: () => Date } = {},
): Promise<{ profile: Profile; source: GoogleProfileSource; firstError?: Error }> {
  let firstError: Error;
  try {
    return { profile: await fetchProfile(accessToken), source: 'userinfo' };
  } catch (err) {
    firstError = err as Error;
  }
  await wait(options.retryDelayMs ?? 400);
  try {
    return { profile: await fetchProfile(accessToken), source: 'userinfo-retry', firstError };
  } catch {
    // Fall through to the ID token.
  }
  const fromToken = profileFromIdToken(idToken, clientId, options.now?.() ?? new Date());
  if (fromToken) return { profile: fromToken, source: 'id-token', firstError };
  throw firstError;
}
