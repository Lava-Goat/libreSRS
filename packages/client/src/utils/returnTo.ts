// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The page to reopen after signing in. The server checks it again
 * (packages/server/src/services/returnTo.ts); this copy keeps the login page
 * from navigating anywhere odd on its own.
 */

/** A path on this site, or null. */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (hasUnsafeCharacter(value)) return null;
  const route = value.split(/[?#]/)[0].toLowerCase();
  if (route === '/' || route === '/login' || route.startsWith('/auth/') || route.startsWith('/api/')) return null;
  return value;
}

/** '/login', remembering `path` when there is somewhere worth coming back to. */
export function loginPathFor(path: string): string {
  const returnTo = safeReturnTo(path);
  return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login';
}

/** A backslash (browsers read it as a slash) or a control character. */
function hasUnsafeCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
