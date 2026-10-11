// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Driver: better-sqlite3 (synchronous, in-process). Replaced @libsql/client
// after its native module (index.node) segfaulted repeatedly under concurrent
// class load in BOTH 0.5.22 and 0.5.29. The
// synchronous driver serializes all DB work on the main thread, which also
// eliminates in-process writer contention.
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { resolveDatabasePath } from './config.js';

const dbPath = resolveDatabasePath(process.env.DATABASE_URL);

const sqlite: DatabaseType = new Database(dbPath);
// Same tuning as before (v1.7.8): WAL + wait-for-lock + one-fsync-per-
// checkpoint + capped WAL file. journal_mode is persistent but harmless to
// re-assert; the rest are per-connection.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('journal_size_limit = 67108864');

export const db = drizzle(sqlite, { schema });

export { schema };
export { sqlite };
