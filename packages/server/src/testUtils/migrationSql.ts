// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Test databases from a migrations folder's real SQL: every journal entry's
 * file (or those through one tag), applied in journal order with no ledger,
 * as a database that got those tables some other way would hold them. Used
 * for test schemas (the SQL is what production has, never a second
 * hand-written copy) and for "this database already has the tables" cases.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as Sqlite } from 'better-sqlite3';

interface Journal { entries: { idx: number; when: number; tag: string }[] }

/** The journal entries of a migrations folder, in order. */
export function journalOf(folder: string): Journal['entries'] {
  return (JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal).entries;
}

/**
 * Applies the folder's SQL files, in journal order, in one transaction:
 * every entry, or those from `from` through `through` (tags, inclusive).
 * Returns the tags applied. Nothing is recorded in any ledger.
 */
export function applyMigrationFolder(
  sqlite: Sqlite,
  folder: string,
  { from, through }: { from?: string; through?: string } = {},
): string[] {
  const entries = journalOf(folder);
  const start = from === undefined ? 0 : entries.findIndex((e) => e.tag === from);
  const end = through === undefined ? entries.length - 1 : entries.findIndex((e) => e.tag === through);
  if (start < 0) throw new Error(`No migration ${from} in ${folder}`);
  if (end < 0) throw new Error(`No migration ${through} in ${folder}`);
  const picked = entries.slice(start, end + 1);
  sqlite.transaction(() => {
    // "--> statement-breakpoint" is an SQL comment: each file runs as written.
    for (const { tag } of picked) sqlite.exec(readFileSync(join(folder, `${tag}.sql`), 'utf8'));
  })();
  return picked.map((e) => e.tag);
}
