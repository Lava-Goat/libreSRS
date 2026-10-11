// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { coreMigrationsFolder } from '../testUtils/migrationChecks.js';
import { parseArgs } from '../db/deleteUser.js';

const deleted: string[][] = [];
let sqlite: Database.Database;
let ledger: string;

async function load() {
  vi.resetModules();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: coreMigrationsFolder });
  vi.doMock('../db/index.js', () => ({ db, schema, sqlite }));
  vi.doMock('./recordings.js', () => ({ deleteRecordings: async (urls: string[]) => { deleted.push(urls); } }));
  sqlite.exec(`
    INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
      (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0),
      (2, 's2', '123456@students.school.test', 'Ana', 'user', 0),
      (3, 's3', '654321@students.school.test', 'Beto', 'user', 0);
    INSERT INTO groups (id, name, created_at) VALUES (1, 'Español 1', 0);
    INSERT INTO user_groups (user_id, group_id, joined_at) VALUES (2, 1, 0), (3, 1, 0);
    INSERT INTO speaking_tasks (id, title, created_by, created_at) VALUES (1, 'Cuento', 1, 0);
  `);
  for (const [id, user] of [[1, 2], [2, 2], [3, 3]]) {
    sqlite.prepare(`INSERT INTO speaking_submissions (id, task_id, user_id, client_key, audio_url, mime_type, submitted_at)
      VALUES (?, 1, ?, ?, ?, 'audio/webm', 0)`).run(id, user, `k${id}`, `/api/recordings/0000000${id}-0000-0000-0000-000000000000.webm`);
  }
  sqlite.prepare("INSERT INTO user_pins (user_id, pin_hash, pin_salt, created_at, updated_at) VALUES (2, 'h', 's', 0, 0)").run();
  return import('./userDeletion.js');
}

const count = (table: string, where = '1') => (sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const now = new Date('2026-11-02T18:00:00Z');

beforeEach(() => {
  deleted.length = 0;
  ledger = join(mkdtempSync(join(tmpdir(), 'deletions-')), 'deletions.jsonl');
});
afterEach(() => {
  vi.doUnmock('../db/index.js');
  vi.doUnmock('./recordings.js');
  sqlite?.close();
});

describe('deleteUserData', () => {
  it('deletes the account and everything that goes with it, then its recordings, and records it in the ledger', async () => {
    const { deleteUserData, readLedger, ledgerEmailHash, deletionLedgerKey } = await load();
    const receipt = await deleteUserData(
      { email: ' 123456@Students.School.test ', performedBy: 'Operator', requestRef: 'School request of 2026-11-01' },
      { ledgerPath: ledger, now },
    );
    expect(receipt).toMatchObject({
      dryRun: false, ledger, kind: 'deleted', userId: 2, deletedAt: '2026-11-02T18:00:00.000Z', recordings: 2,
      emailHash: ledgerEmailHash('123456@students.school.test', deletionLedgerKey(ledger, { create: false })!),
      rows: { users: 1, user_groups: 1, speaking_submissions: 2, user_pins: 1 },
    });
    expect(count('users', 'id = 2')).toBe(0);
    expect(count('user_groups', 'user_id = 2')).toBe(0);
    expect(count('speaking_submissions', 'user_id = 2')).toBe(0);
    expect(count('user_pins')).toBe(0);
    // The others are untouched.
    expect(count('users')).toBe(2);
    expect(count('speaking_submissions', 'user_id = 3')).toBe(1);
    expect(deleted).toEqual([[
      '/api/recordings/00000001-0000-0000-0000-000000000000.webm', '/api/recordings/00000002-0000-0000-0000-000000000000.webm',
    ]]);
    // The ledger names nobody: no email, no name.
    const text = readFileSync(ledger, 'utf8');
    expect(text).not.toMatch(/123456|Ana|students\.school/);
    const [entry] = readLedger(ledger);
    expect(entry).toEqual({
      v: 2, kind: 'deleted', userId: 2, emailHash: receipt.emailHash, deletedAt: receipt.deletedAt, performedBy: 'Operator',
      requestRef: 'School request of 2026-11-01', recordings: 2, rows: receipt.rows,
    });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keys the email hash, so trying every student number does not reverse it, and logs nothing of the email', async () => {
    const { deleteUserData, ledgerKeyPath } = await load();
    const { logger } = await import('../logger.js');
    const info = vi.spyOn(logger, 'info');
    const receipt = await deleteUserData({ userId: 2, performedBy: 'Operator', requestRef: 'R' }, { ledgerPath: ledger, now });
    // Not the plain SHA-256 of the email: that one is found by hashing 000000..999999.
    const { createHash } = await import('crypto');
    expect(receipt.emailHash).not.toBe(createHash('sha256').update('123456@students.school.test').digest('hex'));
    expect(receipt.emailHash).toMatch(/^[0-9a-f]{64}$/);
    // The key was made beside the ledger, readable by its owner only.
    const { statSync } = await import('fs');
    expect(statSync(ledgerKeyPath(ledger)).mode & 0o777).toBe(0o600);
    expect(readFileSync(ledgerKeyPath(ledger), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    const line = info.mock.calls.map((c) => c[0] as Record<string, unknown>).find((o) => o.event === 'admin.user_deleted');
    expect(line).toEqual({ event: 'admin.user_deleted', userId: 2, recordings: 2, kind: 'deleted' });
    info.mockRestore();
  });

  it('uses DELETION_LEDGER_KEY when it is set, and refuses a short one', async () => {
    const { deletionLedgerKey, ledgerEmailHash } = await load();
    const key = 'k'.repeat(40);
    expect(deletionLedgerKey(ledger, { create: true, env: { DELETION_LEDGER_KEY: key } })).toBe(key);
    expect(() => readFileSync(`${ledger}.key`)).toThrow();
    expect(() => deletionLedgerKey(ledger, { create: true, env: { DELETION_LEDGER_KEY: 'short' } })).toThrow(/32/);
    expect(ledgerEmailHash(' A@B.test ', key)).toBe(ledgerEmailHash('a@b.test', key));
    expect(ledgerEmailHash('a@b.test', key)).not.toBe(ledgerEmailHash('a@b.test', 'j'.repeat(40)));
  });

  it('counts only in a dry run', async () => {
    const { deleteUserData } = await load();
    const receipt = await deleteUserData({ userId: 2, performedBy: 'Operator', requestRef: 'x', dryRun: true }, { ledgerPath: ledger, now });
    expect(receipt).toMatchObject({ dryRun: true, ledger: null, recordings: 2, rows: { users: 1, speaking_submissions: 2 } });
    expect(count('users', 'id = 2')).toBe(1);
    expect(deleted).toEqual([]);
    expect(() => readFileSync(ledger)).toThrow();
    // Nor does it make the ledger's key.
    expect(() => readFileSync(`${ledger}.key`)).toThrow();
  });

  it('refuses without a request and a performer, an unknown account, both or neither key, and an admin unless allowed', async () => {
    const { deleteUserData, DeletionError } = await load();
    const ok = { performedBy: 'Operator', requestRef: 'ref' };
    await expect(deleteUserData({ userId: 2, performedBy: ' ', requestRef: 'ref' }, { ledgerPath: ledger })).rejects.toBeInstanceOf(DeletionError);
    await expect(deleteUserData({ userId: 99, ...ok }, { ledgerPath: ledger })).rejects.toThrow('No such account');
    await expect(deleteUserData({ ...ok }, { ledgerPath: ledger })).rejects.toThrow('exactly one');
    await expect(deleteUserData({ userId: 2, email: 'x@y.z', ...ok }, { ledgerPath: ledger })).rejects.toThrow('exactly one');
    // The teacher made the speaking task (no cascade): refused as an admin first, and nothing changes.
    await expect(deleteUserData({ userId: 1, ...ok }, { ledgerPath: ledger })).rejects.toThrow(/administrator/);
    await expect(deleteUserData({ userId: 1, ...ok, allowAdmin: true }, { ledgerPath: ledger })).rejects.toThrow(/speaking_tasks\.created_by: 1/);
    expect(count('users')).toBe(3);
  });
});

describe('replayDeletions (after a restore)', () => {
  it('deletes again every account the ledger names that the restored database has, and records the replay', async () => {
    const { deleteUserData, replayDeletions, readLedger } = await load();
    await deleteUserData({ userId: 2, performedBy: 'Operator', requestRef: 'School request of 2026-11-01' }, { ledgerPath: ledger, now });
    // A snapshot from before the deletion comes back: the student is there again (under a new id, even).
    sqlite.prepare("INSERT INTO users (id, google_id, email, name, role, created_at) VALUES (7, 's2', '123456@students.school.test', 'Ana', 'user', 0)").run();
    sqlite.prepare("INSERT INTO user_groups (user_id, group_id, joined_at) VALUES (7, 1, 0)").run();

    expect(await replayDeletions({ ledgerPath: ledger, performedBy: 'Operator', dryRun: true, now })).toHaveLength(1);
    expect(count('users', 'id = 7')).toBe(1);

    const done = await replayDeletions({ ledgerPath: ledger, performedBy: 'Operator', now });
    expect(done).toEqual([expect.objectContaining({ kind: 'replayed', userId: 7, requestRef: 'replay of 2026-11-02T18:00:00.000Z (School request of 2026-11-01)' })]);
    expect(count('users', 'id = 7')).toBe(0);
    expect(count('users')).toBe(2);
    expect(readLedger(ledger).map((e) => e.kind)).toEqual(['deleted', 'replayed']);
    // Nothing left to replay.
    expect(await replayDeletions({ ledgerPath: ledger, performedBy: 'Operator', now })).toEqual([]);
  });

  it('refuses to replay without the ledger key, rather than silently matching nothing', async () => {
    const { deleteUserData, replayDeletions, ledgerKeyPath } = await load();
    await deleteUserData({ userId: 2, performedBy: 'Operator', requestRef: 'R' }, { ledgerPath: ledger, now });
    const { rmSync } = await import('fs');
    rmSync(ledgerKeyPath(ledger));
    await expect(replayDeletions({ ledgerPath: ledger, performedBy: 'Operator', now })).rejects.toThrow(/key is missing/);
  });

  it('still reads a version 1 (unkeyed) entry', async () => {
    const { replayDeletions, appendLedger } = await load();
    const { createHash } = await import('crypto');
    appendLedger({
      v: 1, kind: 'deleted', userId: 3, emailHash: createHash('sha256').update('654321@students.school.test').digest('hex'),
      deletedAt: '2026-10-01T00:00:00.000Z', performedBy: 'Operator', requestRef: 'old', recordings: 0, rows: { users: 1 },
    }, ledger);
    const done = await replayDeletions({ ledgerPath: ledger, performedBy: 'Operator', now });
    expect(done.map((d) => d.userId)).toEqual([3]);
    expect(count('users', 'id = 3')).toBe(0);
  });
});

describe('the deleteUser command line', () => {
  it('reads its options', () => {
    expect(parseArgs(['--email', 'a@b.c', '--request', 'R', '--by', 'Op', '--dry-run'])).toEqual({
      email: 'a@b.c', request: 'R', by: 'Op', dryRun: true, allowAdmin: false, replay: false,
    });
    expect(parseArgs(['--user-id', '4', '--allow-admin']).userId).toBe(4);
    expect(parseArgs(['--replay', '--by', 'Op']).replay).toBe(true);
    expect(() => parseArgs(['--user-id', 'x'])).toThrow();
    expect(() => parseArgs(['--email'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
  });
});
