// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_DB_PATH = './data/flashcards.db';
const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function ensureDirectory(filePath: string) {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function resolveDatabaseUrl(envUrl?: string) {
  const raw = envUrl || DEFAULT_DB_PATH;
  const hasScheme = SCHEME_REGEX.test(raw);
  const url = hasScheme ? raw : `file:${raw}`;
  const isFile = url.startsWith('file:');

  if (isFile) {
    const filePath = url.replace(/^file:/, '');
    const normalizedPath = filePath.replace(/^\/+/, '/');
    if (
      normalizedPath &&
      normalizedPath !== ':memory:' &&
      normalizedPath !== '::memory:'
    ) {
      ensureDirectory(normalizedPath);
    }
  }

  return { url, isFile };
}

/** better-sqlite3 wants a filesystem path (or ':memory:'), not a file: URL.
 *  Remote schemes (libsql://, https://) were only valid for the old network
 *  driver — fail loudly instead of opening a garbage relative path. */
export function resolveDatabasePath(envUrl?: string): string {
  const { url } = resolveDatabaseUrl(envUrl);
  if (!url.startsWith('file:')) {
    throw new Error(
      `DATABASE_URL "${envUrl}" uses a scheme the embedded SQLite driver cannot open — use a filesystem path`
    );
  }
  const path = url.replace(/^file:\/\//, '').replace(/^file:/, '').replace(/^\/+/, '/');
  return path === '::memory:' || path === ':memory:' ? ':memory:' : path;
}

