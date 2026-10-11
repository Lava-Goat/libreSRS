// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from './trpc.js';
import { isCleverAuthDisabled, isGoogleOAuthConfigured, isSetupComplete, registerGoogleStrategy } from '../services/setupState.js';
import { updateAppSettings, getAppSettings } from '../services/appSettings.js';
import { logger } from '../logger.js';

export const setupRouter = router({
  getStatus: publicProcedure.query(async ({ ctx }) => {
    const protocol = ctx.req.get('x-forwarded-proto') || ctx.req.protocol || 'https';
    const host = ctx.req.get('x-forwarded-host') || ctx.req.get('host') || '';
    const callbackUrl = `${protocol}://${host}/auth/google/callback`;
    const oauthConfigured = await isGoogleOAuthConfigured();
    const settings = await getAppSettings();

    return {
      needsSetup: !oauthConfigured,
      callbackUrl,
      hasAdminEmail: Boolean(process.env.ADMIN_EMAIL?.trim()),
      cleverEnabled: !isCleverAuthDisabled() && Boolean(settings.cleverClientId && settings.cleverClientSecret),
    };
  }),

  saveCredentials: publicProcedure
    .input(z.object({
      googleClientId: z.string().min(1).max(500),
      googleClientSecret: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      if (await isSetupComplete()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Setup has already been completed.',
        });
      }

      const clientId = input.googleClientId.trim();
      const clientSecret = input.googleClientSecret.trim();

      if (!clientId.includes('.apps.googleusercontent.com')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Google Client ID should end with .apps.googleusercontent.com',
        });
      }

      await updateAppSettings({
        googleClientId: clientId,
        googleClientSecret: clientSecret,
      });

      const registered = await registerGoogleStrategy();
      if (!registered) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to register OAuth strategy with provided credentials.',
        });
      }

      logger.info('Setup complete: Google OAuth credentials saved and strategy registered');

      return { success: true };
    }),
});
