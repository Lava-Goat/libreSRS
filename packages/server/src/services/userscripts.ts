// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Userscripts (/tools/<folder>/<name>.user.js) update themselves from libreSRS (@updateURL), and
 * are served from two places:
 * - the copies built into the app (packages/client/public/tools, in the image), and
 * - a folder on the host, data/tools (in the bind-mounted data dir), where
 *   `npm run userscripts:publish` puts a newer script without a rebuild or a restart.
 * The higher @version wins, so a copy left in the folder never shadows a newer release.
 * Extensions install an update only when @version goes up; the stamp script refuses a
 * changed script whose version did not.
 */
import { Router } from 'express';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const FOLDER = /^[a-z0-9][a-z0-9-]*$/;
const FILE = /^[a-z0-9][a-z0-9-]*\.user\.js$/;

/** The script's own @version line, or null. */
export const versionOf = (text: string): string | null => (/^\/\/ @version\s+(\S+)\s*$/m.exec(text) || [])[1] ?? null;

/** Whether dotted version a is above b ("1.10.0" > "1.9.3"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function readScript(dir: string, folder: string, file: string): Promise<{ text: string; version: string } | null> {
  try {
    const text = await readFile(resolve(dir, folder, file), 'utf8');
    const version = versionOf(text);
    return version ? { text, version } : null;
  } catch {
    return null;
  }
}

/**
 * GET /<folder>/<name>.user.js from whichever copy is newer; anything else falls through (to the
 * app's static files). Names are checked first, so no path leaves the two folders.
 */
export function userscriptsRouter(builtInDir: string, publishedDir: string): Router {
  const router = Router();
  router.get('/:folder/:file', async (req, res, next) => {
    const { folder, file } = req.params;
    if (!FOLDER.test(folder) || !FILE.test(file)) return next();
    const [builtIn, published] = await Promise.all([readScript(builtInDir, folder, file), readScript(publishedDir, folder, file)]);
    const pick = published && (!builtIn || isNewer(published.version, builtIn.version)) ? published : builtIn;
    if (!pick) return next();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Always ask again, so a new @version is seen at the extension's next check.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Userscript-Source', pick === published ? 'published' : 'built-in');
    res.send(pick.text);
  });
  return router;
}
