// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { buildAppRouter, coreRouters, createContext } from './index.js';
import { createContext as createContextFromTrpc, publicProcedure, router } from './trpc.js';

describe('app router composition', () => {
  it('includes core procedures from each top-level router', () => {
    const paths = Object.keys(buildAppRouter({} as never)._def.procedures);

    expect(paths).toEqual(expect.arrayContaining([
      'auth.me',
      'admin.getUsers',
      'cards.getMyDecks',
      'settings.get',
      'virtualDecks.list',
      'public.getReadme',
      'ai.getConfig',
      'setup.getStatus',
      'signups.list',
      'signups.claim',
      'conjugation.start',
      'conjugation.answer',
      'pins.loginOptions',
      'pins.createForGroup',
    ]));
  });

  it('adds an extension\'s routers beside core\'s, at their own paths', () => {
    const sample = router({ ping: publicProcedure.query(() => 'pong') });
    const paths = Object.keys(buildAppRouter({ sampleExtension: sample } as never)._def.procedures);
    expect(paths).toContain('sampleExtension.ping');
    expect(paths).toContain('cards.review');
  });

  it('refuses an extension router whose key core uses', () => {
    const sample = router({ ping: publicProcedure.query(() => 'pong') });
    for (const key of Object.keys(coreRouters)) {
      expect(() => buildAppRouter({ [key]: sample } as never), key).toThrow(`Extension routers collide with core: ${key}`);
    }
  });

  it('re-exports createContext from trpc module', () => {
    expect(createContext).toBe(createContextFromTrpc);
  });
});
