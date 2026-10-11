// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { authRouter } from './auth.js';

const user = {
  id: 1,
  googleId: 'user-1',
  email: 'user@example.com',
  name: 'User',
  picture: null,
  role: 'user' as const,
};

function createCaller(req: Partial<Request>) {
  return authRouter.createCaller({
    req: req as Request,
    res: {} as Response,
    user: (req.user as typeof user) ?? null,
    requestId: 'test-request',
  });
}

describe('authRouter', () => {
  it('me returns the authenticated user when present', async () => {
    const caller = createCaller({ user });
    await expect(caller.me()).resolves.toEqual(user);
  });

  it('logout resolves success when session destroy succeeds', async () => {
    const caller = createCaller({
      user,
      session: {
        destroy(callback: (error?: Error | null) => void) {
          callback(null);
        },
      } as Request['session'],
    });

    await expect(caller.logout()).resolves.toEqual({ success: true });
  });

  it('logout throws INTERNAL_SERVER_ERROR when session destroy fails', async () => {
    const caller = createCaller({
      user,
      session: {
        destroy(callback: (error?: Error | null) => void) {
          callback(new Error('session destroy failed'));
        },
      } as Request['session'],
    });

    let thrown: unknown;
    try {
      await caller.logout();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('INTERNAL_SERVER_ERROR');
  });
});

