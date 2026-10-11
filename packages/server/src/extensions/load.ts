// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Loads the extensions this build has: src/extensions/enabled.ts (dist:
 * enabled.js) when it exists, else none. Called only by the server's entry
 * (src/index.ts, awaited before anything reads ext()) and by tests, never at
 * the module scope of any other module: that keeps the import graph free of
 * top-level await.
 *
 * - LIBRESRS_EXTENSIONS=none loads none even when enabled.* exists (a recovery
 *   switch, and how CI runs core alone).
 * - LIBRESRS_REQUIRE_EXTENSIONS=a,b fails the boot unless every id listed was
 *   loaded (a host that must never run without them).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../logger.js';
import { combine, type Extensions, type FieldGroups, type RouterMap } from './api.js';
import { setExtensions } from './registry.js';

export interface LoadOptions {
  /** The folder that holds enabled.js / enabled.ts (default: this module's own). */
  dir?: string;
  env?: NodeJS.ProcessEnv;
}

export async function loadExtensions(opts: LoadOptions = {}): Promise<readonly string[]> {
  const env = opts.env ?? process.env;
  const dir = opts.dir ?? dirname(fileURLToPath(import.meta.url));
  let loaded: Extensions<FieldGroups, RouterMap> = combine();
  if (env.LIBRESRS_EXTENSIONS !== 'none') {
    // dist has enabled.js; tsx (dev, the full-stack e2e) runs enabled.ts.
    for (const file of ['enabled.js', 'enabled.ts']) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      // No catch: a build whose extension fails to import must fail the boot, loudly.
      const mod = (await import(pathToFileURL(path).href)) as { extensions?: Extensions<FieldGroups, RouterMap> };
      if (!mod.extensions || !Array.isArray(mod.extensions.ids)) {
        throw new Error(`${path} does not export \`extensions\` (combine(...))`);
      }
      loaded = mod.extensions;
      break;
    }
  }
  const required = (env.LIBRESRS_REQUIRE_EXTENSIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const missing = required.filter((id) => !loaded.ids.includes(id));
  if (missing.length > 0) throw new Error(`Required extensions not loaded: ${missing.join(', ')}`);
  setExtensions(loaded as never);
  logger.info({ extensions: loaded.ids }, 'Extensions loaded');
  return loaded.ids;
}
