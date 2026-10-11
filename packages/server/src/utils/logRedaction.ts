// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What the logs may keep of a request (doc/legal-documents.md, "Logs").
 *
 * - Sign-in addresses (/auth/*) are logged without their query string: Google's callback carries
 *   the single-use sign-in code, the anti-forgery state and the return address there.
 * - Any other URL whose query string holds an email address is logged with the query replaced.
 * - Usernames typed at PIN sign-in and teachers' emails are logged only as a keyed one-way hash
 *   (hashForLog), so a log line can still be matched to another without naming anyone.
 */
import { createHash, createHmac } from 'crypto';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
export const REDACTED_QUERY = '?[redacted]';

function decodedOrRaw(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** The request URL as the request log keeps it. */
export function urlForLog(originalUrl: string): string {
  const q = originalUrl.indexOf('?');
  if (q < 0) return originalUrl;
  const path = originalUrl.slice(0, q);
  if (path === '/auth' || path.startsWith('/auth/')) return path;
  const query = originalUrl.slice(q + 1);
  if (EMAIL_RE.test(query) || EMAIL_RE.test(decodedOrRaw(query))) return `${path}${REDACTED_QUERY}`;
  return originalUrl;
}

let cachedKey: { source: string; key: Buffer } | null = null;

/** The key: LOG_HASH_KEY, else derived from SESSION_SECRET (a fixed development key without either). */
function hashKey(): Buffer {
  const source = process.env.LOG_HASH_KEY?.trim() || process.env.SESSION_SECRET?.trim() || 'libresrs-dev-log-hash';
  if (cachedKey?.source !== source) {
    cachedKey = { source, key: createHash('sha256').update(`libresrs-log-hash:${source}`, 'utf8').digest() };
  }
  return cachedKey.key;
}

/**
 * A keyed one-way hash of a username or email for the logs: 16 hex characters of an HMAC-SHA256 of
 * the trimmed, lower-cased value. The same value gives the same hash while the key stays the same;
 * without the key a list of school emails cannot be matched against it.
 */
export function hashForLog(value: string): string {
  return createHmac('sha256', hashKey()).update(value.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}
