// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Sign in with a PIN" (v1.22.0; services/pinLogin.ts). loginOptions is public: the login page asks it
 * whether to show the chip, and learns nothing else. Everything else is the teacher's: the mode, a
 * student's PIN, and a group's PINs. A new PIN is in the response of the procedure that made it and
 * nowhere else (the tRPC log keeps input keys only, never output).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, adminProcedure } from './trpc.js';
import { logger } from '../logger.js';
import { PIN_LOGIN_MODES } from '../db/schema.js';
import { autoNetworkConfigured, googleSignInHealth } from '../services/googleSignInHealth.js';
import {
  createPinForUser,
  createPinsForGroup,
  getPinLoginMode,
  groupPinCounts,
  pinLoginAvailability,
  pinStatusFor,
  removePin,
  setPinLoginMode,
  unlockPin,
} from '../services/pinLogin.js';

export type PinSettings = {
  mode: 'auto' | 'on' | 'off';
  /** What the login page shows right now. */
  showing: boolean;
  /**
   * Whether Auto mode can see a browser on the school's network: false in production until
   * PIN_AUTO_SCHOOL_IPS is set (the panel then shows a hint while the mode is Auto).
   */
  autoNetworkConfigured: boolean;
  google: {
    looksBlocked: boolean;
    since: number | null;
    reason: 'no_returns' | 'google_error' | null;
    unansweredBrowsers: number;
    lastStudentSignInAt: number | null;
    /** When this server process started watching (ms). */
    watchingSince: number;
  };
};

function pinSettings(): PinSettings {
  const now = Date.now();
  const mode = getPinLoginMode();
  const status = googleSignInHealth.status(now);
  return {
    mode,
    showing: pinLoginAvailability(mode, status, now).pin,
    autoNetworkConfigured: autoNetworkConfigured(),
    google: {
      looksBlocked: status.looksBlocked,
      since: status.since,
      reason: status.reason,
      unansweredBrowsers: status.unansweredBrowsers,
      lastStudentSignInAt: status.lastStudentSignInAt,
      watchingSince: status.watchingSince,
    },
  };
}

const userNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'User not found', cause: { appCode: 'USER_NOT_FOUND' } });
const groupNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Group not found', cause: { appCode: 'GROUP_NOT_FOUND' } });

const userInput = z.object({ userId: z.number().int() });

export const pinsRouter = router({
  /** Whether the login page offers "Sign in with a PIN", and why. Exactly these two keys. */
  loginOptions: publicProcedure.query((): { pin: boolean; reason: 'on' | 'auto' | null } => {
    const now = Date.now();
    const { pin, reason } = pinLoginAvailability(getPinLoginMode(), googleSignInHealth.status(now), now);
    return { pin, reason };
  }),

  settings: adminProcedure.query(() => pinSettings()),

  setMode: adminProcedure
    .input(z.object({ mode: z.enum(PIN_LOGIN_MODES) }))
    .mutation(async ({ ctx, input }) => {
      const from = getPinLoginMode();
      await setPinLoginMode(input.mode);
      logger.info({ event: 'pin_login.mode_changed', from, to: input.mode, userId: ctx.user.id }, 'PIN sign-in mode changed');
      return pinSettings();
    }),

  forUser: adminProcedure.input(userInput).query(({ input }) => {
    const status = pinStatusFor(input.userId);
    if (!status) throw userNotFound();
    return status;
  }),

  createForUser: adminProcedure.input(userInput).mutation(async ({ ctx, input }) => {
    try {
      const { replaced, ...made } = await createPinForUser(input.userId);
      logger.info({ event: 'pins.created', scope: 'user', targetUserId: input.userId, replaced, userId: ctx.user.id }, 'Made a PIN');
      return { userId: made.userId, name: made.name, email: made.email, studentNumber: made.studentNumber, pin: made.pin };
    } catch (err) {
      if (err instanceof Error && err.message === 'not_found') throw userNotFound();
      if (err instanceof Error && err.message === 'not_student') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Admins sign in with Google only', cause: { appCode: 'PIN_NOT_FOR_ADMIN' } });
      }
      throw err;
    }
  }),

  remove: adminProcedure.input(userInput).mutation(({ ctx, input }) => {
    const removed = removePin(input.userId);
    logger.info({ event: 'pins.removed', targetUserId: input.userId, removed, userId: ctx.user.id }, 'Removed a PIN');
    return { removed };
  }),

  unlock: adminProcedure.input(userInput).mutation(({ ctx, input }) => {
    const unlocked = unlockPin(input.userId);
    logger.info({ event: 'pins.unlocked', targetUserId: input.userId, unlocked, userId: ctx.user.id }, 'Unlocked a PIN');
    return { unlocked };
  }),

  groupStatus: adminProcedure.input(z.object({ groupId: z.number().int() })).query(({ input }) => {
    const counts = groupPinCounts(input.groupId);
    if (!counts) throw groupNotFound();
    return counts;
  }),

  createForGroup: adminProcedure
    .input(z.object({ groupId: z.number().int(), onlyMissing: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await createPinsForGroup(input.groupId, input.onlyMissing);
      if (!result) throw groupNotFound();
      const { pins, skippedHavePin, skippedNotStudent, replaced } = result;
      logger.info({
        event: 'pins.created',
        scope: 'group',
        groupId: input.groupId,
        onlyMissing: input.onlyMissing,
        created: pins.length,
        replaced,
        skippedHavePin,
        skippedNotStudent,
        userId: ctx.user.id,
      }, 'Made PINs for a group');
      return { pins, skippedHavePin, skippedNotStudent };
    }),
});
