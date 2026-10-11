// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Every migration a database needs: core's (drizzle/, ledger
 * __drizzle_migrations, unchanged), then each extension's folder
 * (drizzle/extensions/<id>/, by name), each with its own journal and its own
 * ledger table __ext_<id>_migrations. The folders are data: no extension code
 * runs here, so `db:migrate` and a migration rehearsal work in every tree.
 *
 * drizzle's migrator (0.45) runs every journal entry whose `when` is newer
 * than the newest created_at in its ledger, in one transaction; it records each
 * file's sha256 but never compares it. So each ledger is an independent
 * watermark, and two folders can never collide.
 *
 * Adoption: a database may already hold an extension's tables (made before the
 * extension had its own folder). The folder's adopt.json lists, step by step,
 * the evidence that a step was applied (a table, or a column of one); on the
 * first run only (empty ledger) the steps whose evidence is present, up to the
 * first that is missing, are recorded as applied without running them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as Sqlite } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export interface MigrationReport {
  extensions: { id: string; adopted: string[]; applied: number }[];
}

interface Journal { entries: { idx: number; when: number; tag: string }[] }
interface AdoptRule { tag: string; table: string; column?: string }

const ID_RE = /^[a-z0-9-]+$/;

/** The ledger table of an extension's migrations. */
export const extensionLedger = (id: string): string => `__ext_${id.replace(/-/g, '_')}_migrations`;

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
}

function ledgerRows(sqlite: Sqlite, table: string): number {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return 0;
  return (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

function hasEvidence(sqlite: Sqlite, rule: AdoptRule): boolean {
  if (rule.column === undefined) {
    return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(rule.table);
  }
  return !!sqlite.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(rule.table, rule.column);
}

/**
 * Records the steps of `folder` the database already has (adopt.json) in the
 * ledger `table`, once: only while the ledger is empty. Returns the adopted tags.
 */
export function adoptExisting(sqlite: Sqlite, folder: string, table: string): string[] {
  const adoptPath = join(folder, 'adopt.json');
  if (!existsSync(adoptPath)) return [];
  // drizzle's own DDL for a ledger, so its migrator reads this one as its own.
  sqlite.prepare(`CREATE TABLE IF NOT EXISTS "${table}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`).run();
  if (ledgerRows(sqlite, table) > 0) return [];

  const { adopt: rules } = JSON.parse(readFileSync(adoptPath, 'utf8')) as { adopt?: AdoptRule[] };
  if (!Array.isArray(rules)) throw new Error(`${adoptPath}: "adopt" must be a list`);
  const journal = readJournal(folder);
  rules.forEach((rule, i) => {
    const entry = journal.entries[i];
    if (!entry || rule.tag !== entry.tag) {
      throw new Error(`${adoptPath}: rule ${i} (${rule.tag}) is not journal entry ${i} (${entry?.tag ?? 'none'}): the rules must be a prefix of the journal, in order`);
    }
    if (typeof rule.table !== 'string' || rule.table === '') throw new Error(`${adoptPath}: rule ${i} names no table`);
  });

  const adopted: string[] = [];
  const insert = sqlite.prepare(`INSERT INTO "${table}" ("hash", "created_at") VALUES (?, ?)`);
  sqlite.transaction(() => {
    for (const [i, rule] of rules.entries()) {
      // Each step ran in one transaction, so one table or column proves the whole step.
      if (!hasEvidence(sqlite, rule)) break;
      const entry = journal.entries[i];
      const text = readFileSync(join(folder, `${entry.tag}.sql`)).toString();
      insert.run(createHash('sha256').update(text).digest('hex'), entry.when);
      adopted.push(entry.tag);
    }
  })();
  return adopted;
}

/**
 * Core's migrations, then each extension folder's (unless `extensions` is
 * false: LIBRESRS_EXTENSIONS=none). Throws on the first failure, as drizzle's
 * migrate does; each folder's run is its own transaction.
 */
export function runMigrations<TSchema extends Record<string, unknown>>(
  db: BetterSQLite3Database<TSchema>,
  sqlite: Sqlite,
  drizzleDir: string,
  { extensions = process.env.LIBRESRS_EXTENSIONS !== 'none' }: { extensions?: boolean } = {},
): MigrationReport {
  migrate(db, { migrationsFolder: drizzleDir });
  const report: MigrationReport = { extensions: [] };
  const root = join(drizzleDir, 'extensions');
  if (!extensions || !existsSync(root)) return report;
  for (const id of readdirSync(root).filter((name) => ID_RE.test(name)).sort()) {
    const folder = join(root, id);
    if (!existsSync(join(folder, 'meta', '_journal.json'))) continue;
    const table = extensionLedger(id);
    const adopted = adoptExisting(sqlite, folder, table);
    const before = ledgerRows(sqlite, table);
    migrate(db, { migrationsFolder: folder, migrationsTable: table });
    report.extensions.push({ id, adopted, applied: ledgerRows(sqlite, table) - before });
  }
  return report;
}
