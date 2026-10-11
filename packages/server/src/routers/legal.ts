// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The legal pages, public (anyone may read them before signing in): the current versions, and any
 * prior version an extension keeps. services/legal/render.ts fills them, with this instance's AI
 * settings read afresh for every request (services/legal/aiDisclosure.ts), so a change of setting
 * shows on the next load; the answer is marked not to be stored by the browser either.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from './trpc.js';
import { ext } from '../extensions/registry.js';
import { getAppSettings } from '../services/appSettings.js';
import { isCleverAuthDisabled } from '../services/setupState.js';
import { isTranscriptionEnabled } from '../services/transcriptionSetting.js';
import { aiLegalStateFrom, type AiLegalState } from '../services/legal/aiDisclosure.js';
import {
  LEGAL_DOCUMENTS, renderLegalDocument, renderPriorLegalVersion, type RenderContext,
} from '../services/legal/render.js';
import { logger } from '../logger.js';

async function renderContext(): Promise<RenderContext> {
  let cleverConfigured = false;
  // Unreadable settings make no claim about AI (null), never "no student data is sent".
  let ai: AiLegalState | null = null;
  try {
    const settings = await getAppSettings();
    cleverConfigured = Boolean(settings.cleverClientId && settings.cleverClientSecret);
    ai = aiLegalStateFrom(settings, isTranscriptionEnabled());
  } catch (err) {
    logger.warn({ err, event: 'legal.settings_unreadable' }, 'Legal page: app settings unreadable; Clever counted as off, AI state unknown');
  }
  return { privacy: ext().privacy, cleverEnabled: !isCleverAuthDisabled() && cleverConfigured, ai };
}

/** The pages state live settings: a browser must not answer a later load from its cache. */
function noStore(res: unknown): void {
  const r = res as { setHeader?: (name: string, value: string) => void } | undefined;
  if (typeof r?.setHeader === 'function') r.setHeader('Cache-Control', 'no-store');
}

export const legalRouter = router({
  document: publicProcedure
    .input(z.object({ name: z.enum(LEGAL_DOCUMENTS) }))
    .query(async ({ ctx, input }) => {
      noStore(ctx.res);
      return renderLegalDocument(input.name, await renderContext());
    }),

  priorVersion: publicProcedure
    .input(z.object({ document: z.enum(['privacy', 'terms']), slug: z.string().regex(/^[a-z0-9-]{1,40}$/) }))
    .query(async ({ ctx, input }) => {
      noStore(ctx.res);
      const doc = renderPriorLegalVersion(input.document, input.slug, await renderContext());
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such version', cause: { appCode: 'LEGAL_VERSION_NOT_FOUND' } });
      return doc;
    }),
});
