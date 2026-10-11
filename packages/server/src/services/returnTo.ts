// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Where to send someone after they sign in: the page they were trying to
 * open (a sign-up sheet link from Canvas, say), never another site.
 */

const ORIGIN = 'http://return-to.invalid';

/**
 * A path on this site — '/signups?sheet=3' — or null. Anything that could
 * leave the site (//evil.example, /\evil.example, https:…) is null, as are the
 * sign-in pages themselves, so a bad value falls back to the home page.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // Browsers read a backslash as a slash; control characters have no business here.
  if (hasUnsafeCharacter(value)) return null;
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can resolve '/.//evil.example' into '//evil.example': check what came out, too.
  if (path.startsWith('//')) return null;
  // Express matches routes without regard to case.
  const route = url.pathname.toLowerCase();
  if (route === '/login' || route.startsWith('/auth/') || route.startsWith('/api/')) return null;
  return path;
}

/** The login page with an error, keeping the page to return to for the retry. */
export function loginErrorPath(error: string, returnTo: string | null | undefined): string {
  const params = new URLSearchParams({ error });
  if (returnTo) params.set('returnTo', returnTo);
  return `/login?${params.toString()}`;
}

/** A backslash (browsers read it as a slash) or a control character. */
function hasUnsafeCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
