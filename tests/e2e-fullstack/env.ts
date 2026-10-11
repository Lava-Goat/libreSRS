// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Where the pieces of the full-stack e2e run listen, and who signs in. Shared
 * by the Playwright config, the server launchers and the specs, so every
 * process agrees without passing anything around.
 *
 * Ports stay clear of the mocked suite (4173) and of `npm run dev` (5173,
 * 6767), so both can run beside this one; override them with the env vars.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const PORTS = {
  client: port('E2E_FULLSTACK_CLIENT_PORT', 14173),
  api: port('E2E_FULLSTACK_API_PORT', 16767),
  oauth: port('E2E_FULLSTACK_OAUTH_PORT', 16768),
};

/**
 * The page's origin. "localhost", not 127.0.0.1: the sign-in comes back to the
 * API's own port (Google's redirect_uri is built from the Host the Vite proxy
 * sends), and cookies are shared across ports of one host name only.
 */
export const CLIENT_URL = `http://localhost:${PORTS.client}`;
export const API_URL = `http://localhost:${PORTS.api}`;
export const OAUTH_URL = `http://127.0.0.1:${PORTS.oauth}`;

/** The fake provider's client; the server gets them the way it reads Google's (GOOGLE_CLIENT_ID/SECRET, seeded into app_settings). */
export const FAKE_CLIENT_ID = 'libresrs-e2e-client';
export const FAKE_CLIENT_SECRET = 'libresrs-e2e-secret';

export interface Person {
  email: string;
  name: string;
}

/** ADMIN_EMAIL: the teacher, admin from the first sign-in. */
export const TEACHER: Person = { email: 'teacher@school.test', name: 'Marta Rivera' };

/** Student ids the way a school issues them, matched by the allowlist pattern the teacher adds. */
export const STUDENT_EMAIL_PATTERN = '^[0-9]{4,6}@students\\.school\\.test$';

/**
 * Where the API server of this run says where its database is (startApi.ts writes it, and removes
 * it when it stops), for a spec that changes a row by hand, the way an operator would in SQL.
 */
export const RUN_INFO_FILE = join(tmpdir(), `libresrs-e2e-fullstack-${PORTS.api}.json`);

/** The operator values the run's legal pages show (the rest are unset: "[not yet stated]"). */
export const LEGAL_ENV = {
  LEGAL_OPERATOR_LEGAL_NAME: 'Example Learning, Inc.',
  LEGAL_OPERATOR_SHORT_NAME: 'Example Learning',
  LEGAL_SUPPORT_EMAIL: 'help@example.org',
  LEGAL_SECURITY_EMAIL: 'security@example.org',
} as const;
