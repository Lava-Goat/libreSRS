// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { initTRPC, TRPCError } from '@trpc/server';
import type { Request, Response } from 'express';
import { getUser, requireAuth, requireAdmin, type AuthenticatedUser } from '../middleware/auth.js';
import { logger } from '../logger.js';

export interface Context {
  req: Request;
  res: Response;
  user: AuthenticatedUser | null;
  requestId: string | null;
}

function getRequestId(req: Request, res: Response): string | null {
  const localRequestId = res.locals?.requestId;
  if (typeof localRequestId === 'string') {
    const trimmed = localRequestId.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const headerRequestId = req.get('x-request-id');
  if (typeof headerRequestId === 'string') {
    const trimmed = headerRequestId.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function summarizeInput(input: unknown): Record<string, unknown> {
  if (input === null) {
    return { inputType: 'null' };
  }

  if (Array.isArray(input)) {
    return { inputType: 'array', inputSize: input.length };
  }

  if (typeof input === 'object') {
    return {
      inputType: 'object',
      inputKeys: Object.keys(input as Record<string, unknown>).sort(),
    };
  }

  return { inputType: typeof input };
}

export function createContext({ req, res }: { req: Request; res: Response }): Context {
  return {
    req,
    res,
    user: getUser(req),
    requestId: getRequestId(req, res),
  };
}

/** What a student sees instead of an unexpected error's own text (a database or programming error). */
export const UNEXPECTED_ERROR_MESSAGE = 'Something went wrong. Try again.';

/**
 * Whether an error is an unexpected throw that tRPC wrapped: a plain Error
 * (a SQLite constraint, a bug) turned into INTERNAL_SERVER_ERROR with the
 * same message. A TRPCError the code threw on purpose, with its own message
 * ("Round is damaged"), is not.
 */
function isUnexpected(error: TRPCError): boolean {
  const cause = error.cause;
  return error.code === 'INTERNAL_SERVER_ERROR'
    && cause instanceof Error && !(cause instanceof TRPCError)
    && error.message === cause.message;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error, ctx }) {
    const cause = error.cause as { appCode?: string } | undefined;
    // Never a stack in a response: tRPC adds one whenever NODE_ENV was not
    // 'production' when this module loaded, which is before index.ts reads .env.
    // The server's log keeps it.
    const data: typeof shape.data = { ...shape.data };
    delete data.stack;
    // An unexpected error's text is for the log and the teacher, not a student's page.
    const hide = isUnexpected(error) && ctx?.user?.role !== 'admin';
    return {
      ...shape,
      message: hide ? UNEXPECTED_ERROR_MESSAGE : shape.message,
      data: {
        ...data,
        appCode: cause?.appCode,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;

const requestLoggingMiddleware = middleware(async ({ ctx, path, type, input, next }) => {
  const startedAt = Date.now();
  const procedureLogger = logger.child({
    event: 'trpc.procedure',
    requestId: ctx.requestId,
    path,
    type,
    userId: ctx.user?.id ?? null,
  });

  procedureLogger.debug({
    stage: 'start',
    ...summarizeInput(input),
  }, 'tRPC procedure started');

  try {
    const result = await next();
    const durationMs = Date.now() - startedAt;

    if (result.ok) {
      procedureLogger.debug({
        stage: 'finish',
        ok: true,
        durationMs,
      }, 'tRPC procedure completed');
    } else {
      procedureLogger.warn({
        stage: 'finish',
        ok: false,
        durationMs,
      }, 'tRPC procedure completed with error');
    }

    return result;
  } catch (error) {
    procedureLogger.error({
      stage: 'exception',
      durationMs: Date.now() - startedAt,
      err: error,
    }, 'tRPC procedure threw');
    throw error;
  }
});

export const publicProcedure = t.procedure.use(requestLoggingMiddleware);

const authMiddleware = middleware(({ ctx, next }) => {
  try {
    const user = requireAuth(ctx.req);
    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  } catch (error) {
    logger.warn({
      event: 'trpc.auth.required',
      requestId: ctx.requestId,
      path: ctx.req.path,
      method: ctx.req.method,
      err: error,
    }, 'Unauthorized tRPC request');
    throw error;
  }
});

const adminMiddleware = middleware(({ ctx, next }) => {
  try {
    const user = requireAdmin(ctx.req);
    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  } catch (error) {
    logger.warn({
      event: 'trpc.admin.required',
      requestId: ctx.requestId,
      path: ctx.req.path,
      method: ctx.req.method,
      userId: ctx.user?.id ?? null,
      err: error,
    }, 'Admin permissions required for tRPC request');
    throw error;
  }
});

export const protectedProcedure = t.procedure.use(requestLoggingMiddleware).use(authMiddleware);
export const adminProcedure = t.procedure.use(requestLoggingMiddleware).use(adminMiddleware);
