// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptExisting, extensionLedger, runMigrations } from './runMigrations.js';
import { applyMigrationFolder } from '../testUtils/migrationSql.js';

type Sqlite = InstanceType<typeof Database>;
const realDrizzle = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const BREAK = '\n--> statement-breakpoint\n';

/** A migrations folder: files by tag, with a journal in drizzle's shape (when = base + 60000 * idx). */
function writeFolder(folder: string, files: [tag: string, sql: string][], base = 1_790_000_000_000) {
  mkdirSync(join(folder, 'meta'), { recursive: true });
  for (const [tag, text] of files) writeFileSync(join(folder, `${tag}.sql`), text);
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: files.map(([tag], idx) => ({ idx, version: '6', when: base + 60_000 * idx, tag, breakpoints: true })),
  }, null, 2));
}

/** A sample drizzle folder: a tiny core, and (unless left out) one extension with an adopt.json. Written fresh for each test. */
function sampleDrizzle({ extension = true, adopt = true }: { extension?: boolean; adopt?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'libresrs-run-migrations-'));
  writeFolder(dir, [
    ['0000_users', 'CREATE TABLE users (id integer PRIMARY KEY, name text NOT NULL);'],
    ['0001_users_email', 'ALTER TABLE users ADD email text;'],
  ]);
  const ext = join(dir, 'extensions', 'sample-ext');
  if (extension) {
    writeFolder(ext, [
      ['0000_items', `CREATE TABLE sample_items (id integer PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE);${BREAK}CREATE INDEX idx_sample_items_user ON sample_items (user_id);`],
      ['0001_items_note', `ALTER TABLE sample_items ADD note text;${BREAK}UPDATE sample_items SET note = 'old';`],
      ['0002_settings', `CREATE TABLE sample_settings (id integer PRIMARY KEY, on_off integer DEFAULT 0 NOT NULL);`],
    ], 1_790_100_000_000);
    if (adopt) {
      writeFileSync(join(ext, 'adopt.json'), JSON.stringify({ adopt: [
        { tag: '0000_items', table: 'sample_items' },
        { tag: '0001_items_note', table: 'sample_items', column: 'note' },
        { tag: '0002_settings', table: 'sample_settings' },
      ] }));
    }
  }
  return { dir, ext };
}

const opened: Sqlite[] = [];
function open() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  opened.push(sqlite);
  return { sqlite, db: drizzle(sqlite) };
}
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

const tables = (sqlite: Sqlite) =>
  (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const schemaDump = (sqlite: Sqlite) =>
  sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY type, name").all();
const ledger = (sqlite: Sqlite, table: string) =>
  (sqlite.prepare(`SELECT created_at FROM "${table}" ORDER BY created_at`).all() as { created_at: number }[]).map((r) => Number(r.created_at));
const LEDGER = extensionLedger('sample-ext');

describe('runMigrations', () => {
  it('names each extension\'s ledger after its id', () => {
    expect(LEDGER).toBe('__ext_sample_ext_migrations');
  });

  it('runs core alone when there is no extensions folder, and creates no extension ledger (the real drizzle folder)', () => {
    const { sqlite, db } = open();
    const report = runMigrations(db, sqlite, sampleDrizzle({ extension: false }).dir, { extensions: true });
    expect(report).toEqual({ extensions: [] });
    expect(tables(sqlite)).toEqual(['__drizzle_migrations', 'users']);

    const real = open();
    const before = real.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master").get() as { n: number };
    expect(before.n).toBe(0);
    const realReport = runMigrations(real.db, real.sqlite, realDrizzle, { extensions: false });
    expect(realReport.extensions).toEqual([]);
    expect(tables(real.sqlite).filter((n) => n.startsWith('__ext_'))).toEqual([]);
    expect(tables(real.sqlite)).toContain('__drizzle_migrations');
  });

  it('runs a fresh extension folder after core, with its own ledger', () => {
    const { sqlite, db } = open();
    const report = runMigrations(db, sqlite, sampleDrizzle().dir, { extensions: true });
    expect(report).toEqual({ extensions: [{ id: 'sample-ext', adopted: [], applied: 3 }] });
    expect(tables(sqlite)).toEqual(['__drizzle_migrations', LEDGER, 'sample_items', 'sample_settings', 'users']);
    expect(ledger(sqlite, '__drizzle_migrations')).toHaveLength(2);
    expect(ledger(sqlite, LEDGER)).toEqual([1_790_100_000_000, 1_790_100_060_000, 1_790_100_120_000]);
  });

  it('adopts the steps a database already has (tables made without the ledger) and runs none of them', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: false });
    applyMigrationFolder(sqlite, ext);
    sqlite.prepare("INSERT INTO users (id, name) VALUES (1, 'Ana')").run();
    sqlite.prepare("INSERT INTO sample_items (id, user_id, note) VALUES (5, 1, 'kept')").run();
    const before = schemaDump(sqlite);

    const report = runMigrations(db, sqlite, dir, { extensions: true });
    expect(report).toEqual({ extensions: [{ id: 'sample-ext', adopted: ['0000_items', '0001_items_note', '0002_settings'], applied: 0 }] });
    // Nothing ran: the schema is as it was (bar the ledger) and the rows are intact (0001's UPDATE did not run again).
    expect(schemaDump(sqlite)).toEqual(before);
    expect(sqlite.prepare('SELECT id, user_id, note FROM sample_items').all()).toEqual([{ id: 5, user_id: 1, note: 'kept' }]);
    expect(ledger(sqlite, LEDGER)).toEqual([1_790_100_000_000, 1_790_100_060_000, 1_790_100_120_000]);

    // A second run adopts nothing and applies nothing.
    expect(runMigrations(db, sqlite, dir, { extensions: true })).toEqual({ extensions: [{ id: 'sample-ext', adopted: [], applied: 0 }] });
    expect(ledger(sqlite, LEDGER)).toHaveLength(3);
  });

  it('adopts up to the first step whose evidence is missing, then runs the rest', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: false });
    applyMigrationFolder(sqlite, ext, { through: '0000_items' });
    sqlite.prepare("INSERT INTO users (id, name) VALUES (1, 'Ana')").run();
    sqlite.prepare('INSERT INTO sample_items (id, user_id) VALUES (5, 1)').run();

    const report = runMigrations(db, sqlite, dir, { extensions: true });
    expect(report).toEqual({ extensions: [{ id: 'sample-ext', adopted: ['0000_items'], applied: 2 }] });
    // 0001 ran: its column is there and its UPDATE reached the old row.
    expect(sqlite.prepare('SELECT note FROM sample_items').get()).toEqual({ note: 'old' });
    expect(tables(sqlite)).toContain('sample_settings');
  });

  it('stops adopting at a missing step even when a later one looks present', () => {
    const { sqlite, db } = open();
    const { dir } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: false });
    // Step 0's table, step 2's table, but not step 1's column.
    sqlite.exec('CREATE TABLE sample_items (id integer PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE); CREATE INDEX idx_sample_items_user ON sample_items (user_id); CREATE TABLE sample_settings (id integer PRIMARY KEY, on_off integer DEFAULT 0 NOT NULL);');
    expect(() => runMigrations(db, sqlite, dir, { extensions: true })).toThrow(/CREATE TABLE sample_settings/);
    // The adoption itself was kept (its own transaction); the failed run recorded nothing more.
    expect(ledger(sqlite, LEDGER)).toEqual([1_790_100_000_000]);
  });

  it('adopts only on the first run: a ledger with rows is left to drizzle', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: false });
    applyMigrationFolder(sqlite, ext, { through: '0000_items' });
    expect(adoptExisting(sqlite, ext, LEDGER)).toEqual(['0000_items']);
    // Now the column appears (by hand): a later call adopts nothing, the ledger has a row.
    sqlite.exec('ALTER TABLE sample_items ADD note text');
    expect(adoptExisting(sqlite, ext, LEDGER)).toEqual([]);
    expect(ledger(sqlite, LEDGER)).toEqual([1_790_100_000_000]);
  });

  it('runs a folder without adopt.json as drizzle would', () => {
    const { sqlite, db } = open();
    const report = runMigrations(db, sqlite, sampleDrizzle({ adopt: false }).dir, { extensions: true });
    expect(report).toEqual({ extensions: [{ id: 'sample-ext', adopted: [], applied: 3 }] });
  });

  it('refuses adopt rules that are not a prefix of the journal, in order', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    writeFileSync(join(ext, 'adopt.json'), JSON.stringify({ adopt: [{ tag: '0001_items_note', table: 'sample_items', column: 'note' }] }));
    expect(() => runMigrations(db, sqlite, dir, { extensions: true })).toThrow(/must be a prefix of the journal/);
    writeFileSync(join(ext, 'adopt.json'), JSON.stringify({ adopt: [
      { tag: '0000_items', table: 'sample_items' }, { tag: '0001_items_note', table: 'sample_items', column: 'note' },
      { tag: '0002_settings', table: 'sample_settings' }, { tag: '0003_more', table: 'x' },
    ] }));
    expect(() => runMigrations(db, sqlite, dir, { extensions: true })).toThrow(/must be a prefix of the journal/);
  });

  it('skips extension folders when extensions are off (LIBRESRS_EXTENSIONS=none by default)', () => {
    const { sqlite, db } = open();
    const { dir } = sampleDrizzle();
    expect(runMigrations(db, sqlite, dir, { extensions: false })).toEqual({ extensions: [] });
    expect(tables(sqlite)).toEqual(['__drizzle_migrations', 'users']);

    const saved = process.env.LIBRESRS_EXTENSIONS;
    process.env.LIBRESRS_EXTENSIONS = 'none';
    try {
      const other = open();
      expect(runMigrations(other.db, other.sqlite, dir)).toEqual({ extensions: [] });
      expect(tables(other.sqlite)).toEqual(['__drizzle_migrations', 'users']);
    } finally {
      if (saved === undefined) delete process.env.LIBRESRS_EXTENSIONS; else process.env.LIBRESRS_EXTENSIONS = saved;
    }
  });

  it('does not re-run an applied file that changed (the watermark is the `when`, never the hash)', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: true });
    appendFileSync(join(ext, '0002_settings.sql'), `${BREAK}CREATE TABLE sample_never (id integer PRIMARY KEY);`);
    appendFileSync(join(dir, '0001_users_email.sql'), `${BREAK}CREATE TABLE core_never (id integer PRIMARY KEY);`);
    expect(runMigrations(db, sqlite, dir, { extensions: true })).toEqual({ extensions: [{ id: 'sample-ext', adopted: [], applied: 0 }] });
    expect(tables(sqlite)).not.toContain('sample_never');
    expect(tables(sqlite)).not.toContain('core_never');
  });

  it('runs a newer step added to an extension\'s journal, and nothing else', () => {
    const { sqlite, db } = open();
    const { dir, ext } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: true });
    writeFolder(ext, [
      ['0000_items', 'SELECT 1;'], ['0001_items_note', 'SELECT 1;'], ['0002_settings', 'SELECT 1;'],
      ['0003_flag', 'ALTER TABLE sample_settings ADD flag integer;'],
    ], 1_790_100_000_000);
    expect(runMigrations(db, sqlite, dir, { extensions: true })).toEqual({ extensions: [{ id: 'sample-ext', adopted: [], applied: 1 }] });
    expect((sqlite.prepare('SELECT name FROM pragma_table_info(?)').all('sample_settings') as { name: string }[]).map((c) => c.name))
      .toEqual(['id', 'on_off', 'flag']);
  });

  it('runs several extensions by name, ignores names that are not ids and folders without a journal', () => {
    const { sqlite, db } = open();
    const { dir } = sampleDrizzle();
    writeFolder(join(dir, 'extensions', 'another'), [['0000_another', 'CREATE TABLE another_rows (id integer PRIMARY KEY);']]);
    writeFolder(join(dir, 'extensions', 'Not_An_Id'), [['0000_x', 'CREATE TABLE never_made (id integer PRIMARY KEY);']]);
    mkdirSync(join(dir, 'extensions', 'empty-one'));
    writeFileSync(join(dir, 'extensions', 'README.md'), 'not a folder');
    const report = runMigrations(db, sqlite, dir, { extensions: true });
    expect(report.extensions.map((e) => [e.id, e.applied])).toEqual([['another', 1], ['sample-ext', 3]]);
    expect(tables(sqlite)).toContain('__ext_another_migrations');
    expect(tables(sqlite)).not.toContain('never_made');
  });

  it('runs core first: an extension may reference a core table that core creates in the same run', () => {
    const { sqlite, db } = open();
    const { dir } = sampleDrizzle();
    runMigrations(db, sqlite, dir, { extensions: true });
    sqlite.prepare("INSERT INTO users (id, name) VALUES (1, 'Ana')").run();
    sqlite.prepare('INSERT INTO sample_items (id, user_id) VALUES (1, 1)').run();
    sqlite.prepare('DELETE FROM users WHERE id = 1').run();
    expect(sqlite.prepare('SELECT count(*) AS n FROM sample_items').get()).toEqual({ n: 0 });
  });
});

describe('applyMigrationFolder', () => {
  it('applies a journal\'s SQL in order, all of it or a range, with no ledger', () => {
    const { sqlite } = open();
    const { dir, ext } = sampleDrizzle();
    expect(applyMigrationFolder(sqlite, dir)).toEqual(['0000_users', '0001_users_email']);
    expect(applyMigrationFolder(sqlite, ext, { through: '0001_items_note' })).toEqual(['0000_items', '0001_items_note']);
    expect(applyMigrationFolder(sqlite, ext, { from: '0002_settings' })).toEqual(['0002_settings']);
    expect(tables(sqlite)).toEqual(['sample_items', 'sample_settings', 'users']);
    expect(() => applyMigrationFolder(sqlite, ext, { through: 'nope' })).toThrow(/No migration nope/);
  });
});
