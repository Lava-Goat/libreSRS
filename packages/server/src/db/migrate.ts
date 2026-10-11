// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { resolveDatabasePath } from './config.js';
import { logger } from '../logger.js';
import { runMigrations } from './runMigrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const sqlite = new Database(resolveDatabasePath(process.env.DATABASE_URL));
const db = drizzle(sqlite);

const migrationsFolder = resolve(__dirname, '../../drizzle');

logger.info({ migrationsFolder }, 'Running migrations...');
try {
  // Core's, then each drizzle/extensions/<id>/ folder's with its own ledger (none: LIBRESRS_EXTENSIONS=none).
  const report = runMigrations(db, sqlite, migrationsFolder);
  logger.info({ extensions: report.extensions }, 'Migrations complete!');
  process.exit(0);
} catch (err) {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
}
