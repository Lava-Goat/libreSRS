// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from './trpc.js';
import { getUser } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    return getUser(ctx.req);
  }),

  logout: protectedProcedure.mutation(({ ctx }) => {
    return new Promise<{ success: boolean }>((resolve, reject) => {
      ctx.req.session.destroy((err) => {
        if (err) {
          logger.error({ err }, 'Session destroy error');
          return reject(new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to destroy session',
          }));
        }
        resolve({ success: true });
      });
    });
  }),
});
