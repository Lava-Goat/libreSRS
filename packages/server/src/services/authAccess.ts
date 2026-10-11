// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module authAccess
 *
 * Controls who may register or log in — email allowlist, admin designation,
 * and first-user bootstrap logic.
 *
 * Module invariants
 * -----------------
 * • All email comparisons are normalised to lowercase-trim before matching.
 * • ADMIN_EMAIL env var determines the hard-coded admin identity; it is re-read
 *   on every call (no caching), so changes require no restart in tests but DO
 *   require a restart in production because Node caches `process.env` at load.
 * • `checkEmailAllowed` is read-only — it never writes to the database.
 * • TOCTOU: the existingUser check and the userCount check are two separate
 *   queries.  A concurrent registration could slip between them.  The database's
 *   unique constraint on `users.email` is the authoritative guard; this module
 *   is advisory only.
 *
 * Function ledger
 * ---------------
 * isAdminEmail(email)
 *   Pure after env read.  Returns false if ADMIN_EMAIL is unset.
 *   Early-return: Returns false immediately — no state change.
 *
 * getNewUserRole(email)
 *   Pure.  Delegates to isAdminEmail.  No DB.
 *
 * checkEmailAllowed(email) → AllowedEmailDecision
 *   Requires:  DB is readable; users and allowedEmails tables exist.
 *   Restores:  Nothing — read-only.
 *   Early-return: Each branch returns a decision immediately; no partial write.
 *   Note: allowlist regex patterns are compiled via tryCompileSafeRegex — invalid
 *   patterns are silently skipped (not matched), preventing ReDoS.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { tryCompileSafeRegex } from '../utils/regex.js';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getConfiguredAdminEmail(): string | null {
  const configured = process.env.ADMIN_EMAIL?.trim();
  if (!configured) {
    return null;
  }

  return normalizeEmail(configured);
}

export function isAdminEmail(email: string): boolean {
  const configuredAdminEmail = getConfiguredAdminEmail();
  if (!configuredAdminEmail) {
    return false;
  }

  return normalizeEmail(email) === configuredAdminEmail;
}

export function getNewUserRole(email: string): 'admin' | 'user' {
  return isAdminEmail(email) ? 'admin' : 'user';
}

type AllowedEmailReason =
  | 'existing_user'
  | 'admin_email'
  | 'allowlist'
  | 'first_user_becomes_admin'
  | 'initial_admin_not_configured'
  | 'initial_admin_required'
  | 'not_allowed';

export type AllowedEmailDecision =
  | { allowed: true; reason: AllowedEmailReason }
  | { allowed: false; reason: AllowedEmailReason };

export async function checkEmailAllowed(email: string): Promise<AllowedEmailDecision> {
  const existingUser = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existingUser) {
    return { allowed: true, reason: 'existing_user' };
  }

  if (isAdminEmail(email)) {
    return { allowed: true, reason: 'admin_email' };
  }

  const userCount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.users);
  const hasUsers = userCount[0]?.count > 0;

  if (!hasUsers) {
    if (!getConfiguredAdminEmail()) {
      if (process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()) {
        return { allowed: true, reason: 'first_user_becomes_admin' };
      }
      return { allowed: false, reason: 'initial_admin_not_configured' };
    }
    return { allowed: false, reason: 'initial_admin_required' };
  }

  const allowedPatterns = await db.query.allowedEmails.findMany();
  for (const pattern of allowedPatterns) {
    if (pattern.isRegex) {
      const regex = tryCompileSafeRegex(pattern.pattern);
      if (regex && regex.test(email)) {
        return { allowed: true, reason: 'allowlist' };
      }
      continue;
    }

    if (pattern.pattern.toLowerCase() === email.toLowerCase()) {
      return { allowed: true, reason: 'allowlist' };
    }
  }

  return { allowed: false, reason: 'not_allowed' };
}
