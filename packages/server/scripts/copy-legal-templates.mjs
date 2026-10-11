// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The build's copy of the legal page templates beside the compiled code (tsc copies no Markdown):
 * core's defaults (src/legal → dist/legal), and each extension's own legal/ folder, if it has one
 * (src/extensions/<id>/legal → dist/extensions/<id>/legal). Run from packages/server. The old
 * copies go first, so a template moved or removed in src never lingers in dist.
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

rmSync('dist/legal', { recursive: true, force: true });
for (const id of existsSync('dist/extensions') ? readdirSync('dist/extensions') : []) {
  rmSync(join('dist/extensions', id, 'legal'), { recursive: true, force: true });
}
cpSync('src/legal', 'dist/legal', { recursive: true });
const extensions = 'src/extensions';
for (const id of existsSync(extensions) ? readdirSync(extensions) : []) {
  const from = join(extensions, id, 'legal');
  if (existsSync(from) && statSync(from).isDirectory()) cpSync(from, join('dist/extensions', id, 'legal'), { recursive: true });
}
