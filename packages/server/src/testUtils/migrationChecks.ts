// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Checks the migration tests share (core's db/init.test.ts and any extension's
 * own migration tests): a migrated table against the schema that declares it,
 * and a copy of a migrations folder that stops at a tag, to build the database
 * an earlier release left behind. Test code only: nothing at run time imports it.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as Sqlite } from 'better-sqlite3';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { expect } from 'vitest';

/** Core's migrations folder (packages/server/drizzle). */
export const coreMigrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** The columns of a table, sorted. */
export const columnsOf = (client: Sqlite, table: string): string[] =>
  (client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();

/** The indexes of a table declared with CREATE INDEX (not implied by a key), sorted. */
export const indexesOf = (client: Sqlite, table: string): string[] =>
  (client.prepare(`PRAGMA index_list(${table})`).all() as { name: string; origin: string }[])
    .filter((i) => i.origin === 'c')
    .map((i) => i.name).sort();

/** The migrated table has exactly the columns and indexes the schema declares. */
export function expectTableMatchesSchema(client: Sqlite, table: SQLiteTable): void {
  const config = getTableConfig(table);
  expect(columnsOf(client, config.name), config.name).toEqual(config.columns.map((c) => c.name).sort());
  expect(indexesOf(client, config.name), config.name).toEqual(config.indexes.map((i) => i.config.name).sort());
}

/**
 * A copy of a migrations folder (core's by default) that stops at `lastTag`:
 * its journal cut there and the files it names. Nothing else is copied, so a
 * copy of core's has no extensions/ folder.
 */
export function migrationsThrough(lastTag: string, folder: string = coreMigrationsFolder): string {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === lastTag);
  expect(last, `${lastTag} in ${folder}`).toBeGreaterThanOrEqual(0);
  const entries = journal.entries.slice(0, last + 1);
  const dir = mkdtempSync(join(tmpdir(), 'libresrs-migrations-'));
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) copyFileSync(join(folder, `${tag}.sql`), join(dir, `${tag}.sql`));
  return dir;
}
