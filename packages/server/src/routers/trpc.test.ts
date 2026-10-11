// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it } from 'vitest';
import {
  UNEXPECTED_ERROR_MESSAGE,
  adminProcedure,
  createContext,
  protectedProcedure,
  publicProcedure,
  router,
  type Context,
} from './trpc.js';

const authedUser = {
  id: 1,
  googleId: 'u1',
  email: 'u1@example.com',
  name: 'User',
  picture: null,
  role: 'user' as const,
};

const adminUser = {
  ...authedUser,
  role: 'admin' as const,
};

function createReq(user: Request['user'], requestIdHeader?: string): Request {
  return {
    user,
    path: '/api/trpc/test',
    method: 'POST',
    get(name: string) {
      if (name.toLowerCase() === 'x-request-id') {
        return requestIdHeader;
      }
      return undefined;
    },
  } as Request;
}

const testRouter = router({
  echoRequestId: publicProcedure.query(({ ctx }) => ctx.requestId),
  whoAmI: protectedProcedure.query(({ ctx }) => ctx.user),
  adminRole: adminProcedure.query(({ ctx }) => ctx.user.role),
});

describe('trpc context and procedures', () => {
  it('createContext prefers res.locals.requestId over x-request-id header', () => {
    const req = createReq(authedUser, 'header-id');
    const res = { locals: { requestId: 'local-id' } } as Response;

    const ctx = createContext({ req, res });
    expect(ctx.requestId).toBe('local-id');
  });

  it('createContext falls back to x-request-id header when local id is absent', () => {
    const req = createReq(authedUser, 'header-only-id');
    const res = { locals: {} } as Response;

    const ctx = createContext({ req, res });
    expect(ctx.requestId).toBe('header-only-id');
  });

  it('protectedProcedure rejects unauthenticated callers', async () => {
    const caller = testRouter.createCaller({
      req: createReq(undefined),
      res: {} as Response,
      user: null,
      requestId: null,
    });

    let thrown: unknown;
    try {
      await caller.whoAmI();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('UNAUTHORIZED');
  });

  it('protectedProcedure passes authenticated user through context', async () => {
    const req = createReq(authedUser);
    const caller = testRouter.createCaller({
      req,
      res: {} as Response,
      user: authedUser,
      requestId: 'req-1',
    });

    await expect(caller.whoAmI()).resolves.toEqual(authedUser);
  });

  it('adminProcedure rejects non-admin users', async () => {
    const req = createReq(authedUser);
    const caller = testRouter.createCaller({
      req,
      res: {} as Response,
      user: authedUser,
      requestId: 'req-2',
    });

    let thrown: unknown;
    try {
      await caller.adminRole();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('FORBIDDEN');
  });

  it('adminProcedure allows admin users', async () => {
    const req = createReq(adminUser);
    const caller = testRouter.createCaller({
      req,
      res: {} as Response,
      user: adminUser,
      requestId: 'req-3',
    });

    await expect(caller.adminRole()).resolves.toBe('admin');
  });
});


describe('error bodies', () => {
  const failing = router({
    /** A database error nobody caught, as tRPC wraps it. */
    crash: protectedProcedure.query((): never => {
      throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: lab_submissions.user_id');
    }),
    /** An internal error the code throws on purpose, with its own words. */
    damaged: protectedProcedure.query((): never => {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Round is damaged' });
    }),
    /** A refusal with an app code for the page. */
    missing: protectedProcedure.query((): never => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found', cause: { appCode: 'DECK_NOT_FOUND' } });
    }),
    needsNumber: publicProcedure.input((v: unknown) => {
      if (typeof v !== 'number') throw new Error('Expected a number');
      return v;
    }).query(({ input }) => input),
  });

  /** What the browser gets back: the procedure called over HTTP (the fetch adapter), as this user. */
  async function body(path: string, user: Request['user'] | null, input?: unknown) {
    const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetchRequestHandler({
      endpoint: '/api/trpc',
      req: new Request(`http://localhost/api/trpc/${path}${search}`),
      router: failing,
      createContext: (): Context => ({ req: createReq(user ?? undefined), res: {} as Response, user: user ?? null, requestId: null }),
    });
    return (await res.json()) as { error: { message: string; data: Record<string, unknown> } };
  }

  it('never carries a stack, whatever NODE_ENV (vitest runs with "test")', async () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    for (const [path, user] of [['crash', authedUser], ['crash', adminUser], ['damaged', authedUser], ['missing', authedUser], ['crash', null]] as const) {
      const { error } = await body(path, user);
      expect(error.data).not.toHaveProperty('stack');
    }
  });

  it('tells a student “Something went wrong” instead of an unexpected error’s text, and the teacher the text', async () => {
    const student = await body('crash', authedUser);
    expect(student.error.message).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(UNEXPECTED_ERROR_MESSAGE).toBe('Something went wrong. Try again.');
    expect(student.error.data).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 });
    expect(JSON.stringify(student)).not.toContain('SQLITE');

    const teacher = await body('crash', adminUser);
    expect(teacher.error.message).toBe('SQLITE_CONSTRAINT: UNIQUE constraint failed: lab_submissions.user_id');
  });

  it('keeps the messages the code chose, and their app codes', async () => {
    expect((await body('damaged', authedUser)).error.message).toBe('Round is damaged');
    const missing = await body('missing', authedUser);
    expect(missing.error).toMatchObject({ message: 'Deck not found', data: { code: 'NOT_FOUND', appCode: 'DECK_NOT_FOUND' } });
    const signedOut = await body('crash', null);
    expect(signedOut.error).toMatchObject({ message: 'Not authenticated', data: { code: 'UNAUTHORIZED', appCode: 'AUTH_REQUIRED' } });
    // Input that fails validation is a refusal, not an unexpected error: its text stays.
    expect((await body('needsNumber', authedUser, 'x')).error).toMatchObject({ message: 'Expected a number', data: { code: 'BAD_REQUEST' } });
  });
});
