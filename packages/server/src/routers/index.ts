// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import '../types/session.js';
import { router, createContext } from './trpc.js';
import { authRouter } from './auth.js';
import { adminRouter } from './admin.js';
import { cardsRouter } from './cards.js';
import { settingsRouter } from './settings.js';
import { virtualDecksRouter } from './virtualDecks.js';
import { publicRouter } from './public.js';
import { aiRouter } from './ai.js';
import { setupRouter } from './setup.js';
import { vocabRouter } from './vocab.js';
import { labsRouter } from './labs.js';
import { speakingRouter } from './speaking.js';
import { signupsRouter } from './signups.js';
import { conjugationRouter } from './conjugation.js';
import { pinsRouter } from './pins.js';
import { legalRouter } from './legal.js';
import type { ExtensionRouters } from '../extensions/registry.js';

export { createContext };

/** Core's top-level routers. An extension adds its own beside them (buildAppRouter), never one of these keys. */
export const coreRouters = {
  auth: authRouter,
  admin: adminRouter,
  cards: cardsRouter,
  settings: settingsRouter,
  virtualDecks: virtualDecksRouter,
  public: publicRouter,
  ai: aiRouter,
  setup: setupRouter,
  vocab: vocabRouter,
  labs: labsRouter,
  speaking: speakingRouter,
  signups: signupsRouter,
  conjugation: conjugationRouter,
  pins: pinsRouter,
  legal: legalRouter,
};

/**
 * The app's router: core's, plus the loaded extensions' (ext().routers, read by index.ts after
 * loadExtensions()). An extension router whose key core uses is refused.
 */
export function buildAppRouter(extra: ExtensionRouters) {
  const clash = Object.keys(extra).filter((key) => key in coreRouters);
  if (clash.length > 0) throw new Error(`Extension routers collide with core: ${clash.join(', ')}`);
  return router({ ...coreRouters, ...extra });
}

/** The client's type: core routers, plus the extensions' in a tree that has them. */
export type AppRouter = ReturnType<typeof buildAppRouter>;
