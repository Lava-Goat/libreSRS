// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module auth (middleware)
 *
 * Session authentication helpers: extract the authenticated user from an Express
 * request and guard tRPC procedures.
 *
 * Module invariants
 * -----------------
 * • Passport session middleware MUST run before any function in this module.
 *   `req.user` is populated by Passport; without it, `getUser` always returns null.
 * • These functions are read-only with respect to session state — they never write
 *   to the session or the database.
 *
 * Function ledger
 * ---------------
 * getUser(req)
 *   Requires:  Session middleware has run.
 *   Restores:  Nothing — read-only.
 *   Early-return: Returns null if unauthenticated; no state change.
 *
 * requireAuth(req)
 *   Requires:  Session middleware has run.
 *   Restores:  Caller is guaranteed an AuthenticatedUser on success.
 *   Early-return: Throws TRPCError(UNAUTHORIZED) — interrupts caller, no partial state.
 *
 * requireAdmin(req)
 *   Requires:  requireAuth passes (user authenticated).
 *   Restores:  Caller is guaranteed role === 'admin' on success.
 *   Early-return: Throws TRPCError(FORBIDDEN) — interrupts caller, no partial state.
 *
 * serializeUser(user)
 *   Pure projection from DB User → AuthenticatedUser. No invariants.
 *
 * getSerializedUserId(serialized)
 *   Extracts the DB user id from Passport's current numeric format or legacy
 *   JSON session payloads. Does not trust role claims stored in the session.
 */
import { TRPCError } from '@trpc/server';
import type { Request } from 'express';
import type { User } from '@libresrs/shared';

export interface AuthenticatedUser {
  id: number;
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
  role: 'admin' | 'user';
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export function getUser(req: Request): AuthenticatedUser | null {
  return req.user ?? null;
}

export function requireAuth(req: Request): AuthenticatedUser {
  const user = getUser(req);
  if (!user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
      cause: { appCode: 'AUTH_REQUIRED' },
    });
  }
  return user;
}

export function requireAdmin(req: Request): AuthenticatedUser {
  const user = requireAuth(req);
  if (user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
      cause: { appCode: 'ADMIN_REQUIRED' },
    });
  }
  return user;
}

export function serializeUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    googleId: user.googleId,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
  };
}

export function getSerializedUserId(serialized: unknown): number | null {
  if (typeof serialized === 'number') {
    return Number.isFinite(serialized) ? serialized : null;
  }

  if (typeof serialized !== 'string') {
    return null;
  }

  const trimmed = serialized.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { id?: unknown };
      return typeof parsed.id === 'number' && Number.isFinite(parsed.id) ? parsed.id : null;
    } catch {
      return null;
    }
  }

  const userId = Number(trimmed);
  return Number.isFinite(userId) ? userId : null;
}
