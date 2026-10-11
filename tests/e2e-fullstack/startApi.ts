// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Runs the real API server (packages/server/src/index.ts, under tsx) for the
 * full-stack e2e run, in a fresh temporary directory: the SQLite database
 * (migrated at boot) and the data/assets and data/recordings folders the
 * server keeps under its working directory all start empty and are removed
 * when Playwright stops the server (SIGTERM, see gracefulShutdown in the
 * config). E2E_FULLSTACK_KEEP_DATA=1 keeps them for a look afterwards.
 *
 * The server reads the repo-root .env by absolute path (dotenv in index.ts),
 * so a different working directory does not keep it out. That is why every
 * variable the server reads is set here, to an empty string where unset is
 * meant: dotenv never overrides a key that is already set, so a developer's
 * .env (Redis required, real Google or OpenAI keys, AI features switched on)
 * cannot leak into the run. Only the build labels (GIT_TAG, GIT_COMMIT,
 * GITHUB_REF_*) are left alone: they name the version and change nothing.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CLIENT_URL, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, LEGAL_ENV, OAUTH_URL, PORTS, RUN_INFO_FILE, TEACHER } from './env';
import { envNameFor, OPERATOR_FIELDS } from '../../packages/server/src/services/legal/operatorConfig';

// Playwright starts this from the repo root (the config's directory).
const repo = process.cwd();

/** The LEGAL_* names this shell or the repo's .env sets (the server's dotenv reads that .env). */
function legalNamesElsewhere(): string[] {
  let dotenv = '';
  try {
    dotenv = readFileSync(resolve(repo, '.env'), 'utf8');
  } catch {
    // No .env: nothing to hide.
  }
  const fromFile = [...dotenv.matchAll(/^\s*(?:export\s+)?(LEGAL_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
  return [...Object.keys(process.env).filter((name) => name.startsWith('LEGAL_')), ...fromFile];
}
const runDir = mkdtempSync(join(tmpdir(), 'libresrs-e2e-'));
const keep = process.env.E2E_FULLSTACK_KEEP_DATA === '1';

let cleaned = false;
function cleanUp() {
  if (cleaned) return;
  cleaned = true;
  rmSync(RUN_INFO_FILE, { force: true });
  if (keep) {
    process.stderr.write(`[e2e-fullstack] kept the server's data in ${runDir}\n`);
    return;
  }
  rmSync(runDir, { recursive: true, force: true });
}
process.on('exit', cleanUp);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => process.exit(0));
}

Object.assign(process.env, {
  // Not production: the fake sign-in is refused there (services/oauthEndpoints.ts).
  NODE_ENV: 'test',
  PORT: String(PORTS.api),
  DATABASE_URL: join(runDir, 'data', 'flashcards.db'),
  // Random per run, and never one of the placeholders the boot check refuses.
  SESSION_SECRET: randomBytes(32).toString('hex'),
  APP_SETTINGS_ENCRYPTION_KEY: '',
  ADMIN_EMAIL: TEACHER.email,
  // Seeded into app_settings on the first boot of the empty database, as /setup would save them.
  GOOGLE_CLIENT_ID: FAKE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  LIBRESRS_E2E_FAKE_OAUTH: '1',
  LIBRESRS_E2E_GOOGLE_AUTHORIZATION_URL: `${OAUTH_URL}/authorize`,
  LIBRESRS_E2E_GOOGLE_TOKEN_URL: `${OAUTH_URL}/token`,
  LIBRESRS_E2E_GOOGLE_USERINFO_URL: `${OAUTH_URL}/userinfo`,
  // Where the server sends the browser after signing in: the Vite dev server of this run.
  FRONTEND_URL: CLIENT_URL,
  FRONTEND_PORT: '',
  ALLOWED_REDIRECT_HOSTS: '',
  // In-memory sessions, as in development.
  REQUIRE_REDIS: 'false',
  REDIS_URL: '',
  TRUST_PROXY: 'false',
  SESSION_COOKIE_SECURE: 'false',
  SESSION_COOKIE_SAMESITE: 'lax',
  CLEVER_AUTH_DISABLED: 'true',
  CLEVER_CLIENT_ID: '',
  CLEVER_CLIENT_SECRET: '',
  CLEVER_REDIRECT_URI: '',
  CLEVER_ROSTER_REDIRECT_URI: '',
  // No AI provider: nothing in the run may reach OpenAI, ElevenLabs or Anthropic. The rest are
  // seeded into app_settings on the empty database, so each is pinned to its default (empty) or
  // off; a developer's exported ANTHROPIC_API_KEY must not reach the run's database.
  AI_ENABLED: 'false',
  OPENAI_API_KEY: '',
  ELEVENLABS_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  AI_TEXT_PROVIDER: '',
  AI_PROVIDER: '',
  OPENAI_BASE_URL: '',
  AI_PRONUNCIATION_ENABLED: 'false',
  AI_IMAGE_ENABLED: 'false',
  AI_MNEMONIC_ENABLED: 'false',
  AI_MNEMONIC_MODEL: '',
  AI_IMAGE_MODEL: '',
  AI_IMAGE_QUALITY: '',
  AI_TTS_MODEL: '',
  AI_TTS_PROVIDER: '',
  AI_TTS_VOICE_MAP: '',
  VOCAB_TTS_VOICE_ID: '',
  // Empty reads as unset (on), as on a fresh install; a .env's 'false' cannot switch it off.
  ENABLE_LEGACY_MIGRATION_BACKFILL: '',
  LOG_LEVEL: process.env.E2E_FULLSTACK_LOG_LEVEL ?? 'warn',
  // Extensions' timers are off under NODE_ENV=test; here they run every 2 s, so a
  // spec sees in seconds what they do in production (extensions/timers.ts).
  LIBRESRS_E2E_TIMERS_EVERY_MS: '2000',
  LOG_HASH_KEY: '',
  DELETION_LEDGER: '',
  // The legal pages: every LEGAL_* value empty (a .env's own cannot leak in, nor one of the fields an
  // operator's own documents declare), but the few the specs read.
  ...Object.fromEntries([...OPERATOR_FIELDS.map((field) => envNameFor(field.key)), ...legalNamesElsewhere()].map((name) => [name, ''])),
  ...LEGAL_ENV,
});

// For a spec that changes a row by hand (env.ts RUN_INFO_FILE).
writeFileSync(RUN_INFO_FILE, JSON.stringify({ runDir, database: process.env.DATABASE_URL }));

/**
 * The values an extension's own specs need the server to boot with: each
 * tests/e2e-fullstack/extensions/<id>/env.ts may export EXTENSION_ENV, set over the above.
 * None with LIBRESRS_EXTENSIONS=none, where those specs are left out.
 */
async function extensionEnv(): Promise<Record<string, string>> {
  if (process.env.LIBRESRS_EXTENSIONS === 'none') return {};
  const root = resolve(repo, 'tests/e2e-fullstack/extensions');
  const files = (existsSync(root) ? readdirSync(root) : []).map((id) => join(root, id, 'env.ts')).filter((file) => existsSync(file));
  const mods = await Promise.all(files.map((file) => import(pathToFileURL(file).href) as Promise<{ EXTENSION_ENV?: Record<string, string> }>));
  return Object.assign({}, ...mods.map((mod) => mod.EXTENSION_ENV ?? {}));
}

// data/assets and data/recordings are resolved against the working directory.
process.chdir(runDir);
extensionEnv().then((env) => {
  Object.assign(process.env, env);
  return import(pathToFileURL(resolve(repo, 'packages/server/src/index.ts')).href);
}).catch((err: unknown) => {
  console.error('[e2e-fullstack] the API server failed to load', err);
  process.exit(1);
});
