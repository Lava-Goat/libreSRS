// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The lint guard of README.md's rules (eslint.config.cjs): core never imports an extension folder,
 * an aggregator or an extension's shared code, in any form a bundler or Node resolves (a bare folder,
 * a file in it, export … from, import()); the mechanism files import only their siblings. Probes are
 * linted as text at paths that do not exist, with a sample extension name, so nothing ships for them.
 */
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const eslint = new ESLint({ cwd: root });

/** The rules that fire for `code` at `file` (relative to the repo root). */
async function rulesFor(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}
const IMPORTS = '@typescript-eslint/no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';

describe('core never imports an extension', () => {
  it.each([
    ['packages/client/src/pages/Probe.tsx', "import x from '../extensions/sample-ext'; export const y = x;", IMPORTS],
    ['packages/client/src/pages/Probe.tsx', "import x from '../extensions/sample-ext/index'; export const y = x;", IMPORTS],
    ['packages/client/src/components/admin/Probe.tsx', "import { a } from '../../extensions/sample-ext/Part'; export const y = a;", IMPORTS],
    ['packages/client/src/pages/Probe.tsx', "import { clientExtensions } from '../extensions/enabled'; export const y = clientExtensions;", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "import { a } from '../extensions/sample-ext/index.js'; export const y = a;", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "import { extensions } from '../extensions/enabled.js'; export const y = extensions;", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "export * from '../extensions/sample-ext';", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "export { a } from '../extensions/sample-ext/index.js';", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "import { a } from '@libresrs/shared/extensions/sample-ext'; export const y = a;", IMPORTS],
    ['packages/server/src/routers/Probe.ts', "export const m = () => import('../extensions/sample-ext/index.js');", SYNTAX],
    ['packages/server/src/routers/Probe.ts', "export const m = () => import('../extensions/enabled.js');", SYNTAX],
    ['packages/client/src/pages/Probe.tsx', "export const m = () => import('../extensions/sample-ext');", SYNTAX],
    ['packages/server/src/routers/Probe.ts', "export const m = () => import('@libresrs/shared/extensions/sample-ext');", SYNTAX],
  ])('%s: %s', async (file, code, rule) => {
    expect(await rulesFor(file, code)).toEqual([rule]);
  });

  it('lets core import the mechanism: the client helpers, api, registry, load, none, timers', async () => {
    for (const [file, code] of [
      ['packages/client/src/pages/Probe.tsx', "import { ExtensionSlot } from '../extensions'; export const y = ExtensionSlot;"],
      ['packages/client/src/pages/Probe.tsx', "import type { SlotProps } from '../extensions/api'; export type Y = SlotProps;"],
      ['packages/server/src/routers/Probe.ts', "import { ext } from '../extensions/registry.js'; import { fieldsBeside } from '../extensions/api.js'; export const y = [ext, fieldsBeside];"],
      ['packages/server/src/Probe.ts', "import { loadExtensions } from './extensions/load.js'; export const y = loadExtensions;"],
      ['packages/server/src/Probe.ts', "import { startTimers } from './extensions/timers.js'; export const y = startTimers;"],
      ['packages/server/src/routers/Probe.ts', "export const m = () => import('../extensions/registry.js');"],
      ['packages/server/src/routers/Probe.ts', "import type { Fields } from '@libresrs/server-extensions'; export type Y = Fields;"],
    ]) {
      expect(await rulesFor(file, code), code).toEqual([]);
    }
  });
});

describe('the mechanism files import only their siblings', () => {
  it.each([
    ['packages/client/src/extensions/Probe.tsx', "import x from './sample-ext'; export const y = x;", IMPORTS],
    ['packages/client/src/extensions/Probe.tsx', "import x from './sample-ext/index'; export const y = x;", IMPORTS],
    ['packages/client/src/extensions/Probe.tsx', "import { clientExtensions } from './enabled'; export const y = clientExtensions;", IMPORTS],
    ['packages/server/src/extensions/Probe.ts', "import { a } from './sample-ext/index.js'; export const y = a;", IMPORTS],
    ['packages/server/src/extensions/Probe.ts', "export const m = () => import('./sample-ext/index.js');", SYNTAX],
    ['packages/server/src/extensions/Probe.ts', "export const m = () => import('./enabled.js');", SYNTAX],
  ])('%s: %s', async (file, code, rule) => {
    expect(await rulesFor(file, code)).toEqual([rule]);
  });

  it('lets them import api, registry, none, timers and each other', async () => {
    expect(await rulesFor('packages/server/src/extensions/Probe.ts',
      "import { combine } from './api.js'; import { ext } from './registry.js'; import { extensions } from './none.js'; export const y = [combine, ext, extensions];")).toEqual([]);
    expect(await rulesFor('packages/client/src/extensions/Probe.tsx',
      "import { combineClient } from './api'; export const y = combineClient;")).toEqual([]);
    expect(await rulesFor('packages/server/src/extensions/Probe.ts', "export const m = () => import('./registry.js');")).toEqual([]);
    expect(await rulesFor('packages/server/src/extensions/Probe.ts', "import { timerRunner } from './timers.js'; export const y = timerRunner;")).toEqual([]);
  });

  it('leaves the aggregators free to list the extensions', async () => {
    expect(await rulesFor('packages/server/src/extensions/enabled.ts',
      "import mine from './sample-ext/index.js'; export const y = mine;")).toEqual([]);
    expect(await rulesFor('packages/client/src/extensions/enabled.tsx',
      "import mine from './sample-ext'; export const y = mine;")).toEqual([]);
  });
});
