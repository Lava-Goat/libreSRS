// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Deleting one student's data on request, and the written record of every such deletion that a
 * restore re-applies (a restored snapshot gets every deletion requested since it was taken).
 *
 * deleteUserData removes the account in one transaction (every row that points at it goes by its
 * foreign key's cascade, extension tables included), then the student's recording files, then
 * appends one line to the deletion ledger. replayDeletions reads the ledger after a restore and
 * deletes again every account it names that the restored database brought back.
 *
 * The ledger (DELETION_LEDGER, default data/deletions.jsonl beside the database) is JSON lines:
 * { v, kind, userId, emailHash, deletedAt, performedBy, requestRef, recordings, rows }. It keeps
 * no name and no email: emailHash is an HMAC-SHA-256 of the lower-cased email under the ledger's
 * own key, so a restored account can be recognised, and the deletion certificate can quote the
 * entry. Keyed, because a school email is often "<student number>@district": an unkeyed hash of
 * it is reversed by trying every number. The key is DELETION_LEDGER_KEY, or else a file beside the
 * ledger (<ledger>.key, made on the first deletion, mode 0600); it is never rotated (a new key
 * would stop the old entries from matching), it is kept apart from SESSION_SECRET, and it is
 * backed up with the ledger. An operator's privacy policy can disclose this record. Run it with
 * dist/db/deleteUser.js (doc/legal-documents.md, "Deleting a student's data").
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { deleteRecordings } from './recordings.js';
import { logger } from '../logger.js';

/** 2: emailHash is keyed (HMAC). 1 (unkeyed SHA-256) was never deployed; replay still reads it. */
export const LEDGER_VERSION = 2;

export function deletionLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DELETION_LEDGER?.trim() || resolve(process.cwd(), 'data', 'deletions.jsonl');
}

/** Where the ledger's key lives when DELETION_LEDGER_KEY is not set. */
export function ledgerKeyPath(ledgerPath: string): string {
  return `${ledgerPath}.key`;
}

/**
 * The ledger's HMAC key: DELETION_LEDGER_KEY, else the key file beside the ledger, made on first
 * use when `create` (a dry run creates nothing and gets null when there is no key yet).
 */
export function deletionLedgerKey(ledgerPath: string, options: { create: boolean; env?: NodeJS.ProcessEnv }): string | null {
  const fromEnv = (options.env ?? process.env).DELETION_LEDGER_KEY?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) throw new DeletionError('DELETION_LEDGER_KEY must be at least 32 characters');
    return fromEnv;
  }
  const file = ledgerKeyPath(ledgerPath);
  if (existsSync(file)) {
    const key = readFileSync(file, 'utf8').trim();
    if (key.length < 32) throw new DeletionError(`The deletion ledger key in ${file} is too short`);
    return key;
  }
  if (!options.create) return null;
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(32).toString('hex');
  writeFileSync(file, `${key}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return key;
}

const normalEmail = (email: string) => email.trim().toLowerCase();

/** HMAC-SHA-256 of the trimmed, lower-cased email under the ledger's key (hex). */
export function ledgerEmailHash(email: string, key: string): string {
  return createHmac('sha256', key).update(normalEmail(email), 'utf8').digest('hex');
}

/** What a ledger entry of `version` holds for this email. */
function entryHashFor(email: string, version: number, key: string | null): string | null {
  if (version === 1) return createHash('sha256').update(normalEmail(email), 'utf8').digest('hex');
  return key ? ledgerEmailHash(email, key) : null;
}

export interface DeletionRequest {
  /** Exactly one of the two. */
  email?: string;
  userId?: number;
  /** Who carried it out (a name or role, for the certificate). */
  performedBy: string;
  /** The school's request: its date, sender or reference. */
  requestRef: string;
  /** Count only; change nothing. */
  dryRun?: boolean;
  /** Refuse an admin unless set (a teacher account is deleted only when the school says so). */
  allowAdmin?: boolean;
}

export interface LedgerEntry {
  v: number;
  kind: 'deleted' | 'replayed';
  userId: number;
  emailHash: string;
  deletedAt: string;
  performedBy: string;
  requestRef: string;
  recordings: number;
  /** Rows removed, table by table (the account's own row is "users"). */
  rows: Record<string, number>;
}

export interface DeletionReceipt extends LedgerEntry {
  dryRun: boolean;
  ledger: string | null;
}

export class DeletionError extends Error {}

/** Every table with a foreign key to users.id, and the column(s) that hold it, read from the database. */
function tablesPointingAtUsers(): { table: string; column: string; onDelete: string }[] {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all() as { name: string }[];
  const out: { table: string; column: string; onDelete: string }[] = [];
  for (const { name } of tables) {
    const keys = sqlite.prepare('SELECT "table" AS target, "from" AS col, on_delete AS onDelete FROM pragma_foreign_key_list(?)').all(name) as { target: string; col: string; onDelete: string }[];
    for (const key of keys) if (key.target === 'users') out.push({ table: name, column: key.col, onDelete: key.onDelete.toUpperCase() });
  }
  return out;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/** The rows that go with the user (cascade) and those that would block the delete (no action / restrict). */
function countRows(userId: number): { rows: Record<string, number>; blocking: Record<string, number> } {
  const rows: Record<string, number> = { users: 1 };
  const blocking: Record<string, number> = {};
  for (const { table, column, onDelete } of tablesPointingAtUsers()) {
    const n = (sqlite.prepare(`SELECT count(*) AS n FROM ${quote(table)} WHERE ${quote(column)} = ?`).get(userId) as { n: number }).n;
    if (n === 0) continue;
    if (onDelete === 'CASCADE') rows[table] = (rows[table] ?? 0) + n;
    else if (onDelete !== 'SET NULL' && onDelete !== 'SET DEFAULT') blocking[`${table}.${column}`] = n;
  }
  return { rows, blocking };
}

function findUser(request: Pick<DeletionRequest, 'email' | 'userId'>) {
  if ((request.email === undefined) === (request.userId === undefined)) {
    throw new DeletionError('Give exactly one of an email or a user id');
  }
  const user = request.email !== undefined
    ? db.select().from(schema.users).where(eq(schema.users.email, request.email.trim().toLowerCase())).get()
    : db.select().from(schema.users).where(eq(schema.users.id, request.userId as number)).get();
  if (!user) throw new DeletionError('No such account');
  return user;
}

export function appendLedger(entry: LedgerEntry, path = deletionLedgerPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readLedger(path = deletionLedgerPath()): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((line, i) => {
    try {
      return JSON.parse(line) as LedgerEntry;
    } catch {
      throw new DeletionError(`Deletion ledger line ${i + 1} is not JSON`);
    }
  });
}

/** One account and everything that goes with it. Throws DeletionError (nothing changed) when it cannot. */
export async function deleteUserData(request: DeletionRequest, options: { ledgerPath?: string; kind?: LedgerEntry['kind']; now?: Date } = {}): Promise<DeletionReceipt> {
  if (!request.performedBy.trim() || !request.requestRef.trim()) {
    throw new DeletionError('Say who performs the deletion and which request it answers');
  }
  const user = findUser(request);
  if (user.role === 'admin' && !request.allowAdmin) {
    throw new DeletionError('This is an administrator account; delete it only at the school\'s request, with --allow-admin');
  }
  const ledgerPath = options.ledgerPath ?? deletionLedgerPath();
  const at = options.now ?? new Date();
  const key = deletionLedgerKey(ledgerPath, { create: !request.dryRun });

  const recordingUrls = db.select({ url: schema.speakingSubmissions.audioUrl }).from(schema.speakingSubmissions)
    .where(eq(schema.speakingSubmissions.userId, user.id)).all().map((r) => r.url);
  const { rows, blocking } = countRows(user.id);
  if (Object.keys(blocking).length > 0) {
    throw new DeletionError(`Rows that do not go with the account would block it (${Object.entries(blocking).map(([k, n]) => `${k}: ${n}`).join(', ')}); it made content others use`);
  }
  const entry: LedgerEntry = {
    v: LEDGER_VERSION,
    kind: options.kind ?? 'deleted',
    userId: user.id,
    // A dry run before the first deletion has no key yet, and makes none.
    emailHash: key ? ledgerEmailHash(user.email, key) : '',
    deletedAt: at.toISOString(),
    performedBy: request.performedBy.trim(),
    requestRef: request.requestRef.trim(),
    recordings: recordingUrls.length,
    rows,
  };
  if (request.dryRun) return { ...entry, dryRun: true, ledger: null };

  // Read the files and delete the rows together, so a recording landing in between cannot lose its
  // row to the cascade while its file stays on disk (as speaking.remove does).
  const urls = db.transaction((tx) => {
    const current = tx.select({ url: schema.speakingSubmissions.audioUrl }).from(schema.speakingSubmissions)
      .where(eq(schema.speakingSubmissions.userId, user.id)).all().map((r) => r.url);
    tx.delete(schema.users).where(eq(schema.users.id, user.id)).run();
    return current;
  });
  await deleteRecordings(urls);
  entry.recordings = urls.length;
  appendLedger(entry, ledgerPath);
  // The user ID is enough to find the ledger entry; nothing derived from the email goes to the logs.
  logger.info({ event: 'admin.user_deleted', userId: user.id, recordings: urls.length, kind: entry.kind }, 'Deleted an account and its data');
  return { ...entry, dryRun: false, ledger: ledgerPath };
}

/**
 * After restoring a snapshot: every account the ledger says was deleted, and that the restored
 * database has again (matched by its email hash, or its id with the same email hash), is deleted
 * again and recorded as "replayed". Returns what was found and done.
 */
export async function replayDeletions(options: { ledgerPath?: string; performedBy: string; dryRun?: boolean; now?: Date }): Promise<DeletionReceipt[]> {
  const ledgerPath = options.ledgerPath ?? deletionLedgerPath();
  const wanted = new Map<string, LedgerEntry>();
  for (const entry of readLedger(ledgerPath)) if (entry.kind === 'deleted' && entry.emailHash) wanted.set(`${entry.v}:${entry.emailHash}`, entry);
  if (wanted.size === 0) return [];
  const versions = [...new Set([...wanted.values()].map((e) => e.v))];
  const key = deletionLedgerKey(ledgerPath, { create: false });
  if (!key && versions.some((v) => v !== 1)) {
    throw new DeletionError(`The deletion ledger's key is missing (DELETION_LEDGER_KEY or ${ledgerKeyPath(ledgerPath)}): restore it with the ledger`);
  }
  const users = db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).all();
  const done: DeletionReceipt[] = [];
  for (const user of users) {
    const entry = versions
      .map((v) => wanted.get(`${v}:${entryHashFor(user.email, v, key)}`))
      .find((e): e is LedgerEntry => e !== undefined);
    if (!entry) continue;
    done.push(await deleteUserData(
      { userId: user.id, performedBy: options.performedBy, requestRef: `replay of ${entry.deletedAt} (${entry.requestRef})`, dryRun: options.dryRun, allowAdmin: true },
      { ledgerPath, kind: 'replayed', now: options.now },
    ));
  }
  return done;
}
