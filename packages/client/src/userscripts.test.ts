// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Every userscript in tools/<folder>/ is served from /tools/<folder>/ and updates itself from
 * there. An extension installs an update only when @version goes up, so a script changed without a
 * new version would never reach anyone: each folder's stamp.json records its scripts' versions and
 * content hashes (npm run userscripts:stamp, which refuses a change without a higher version). A
 * tree may have no userscripts at all.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Stamp = Record<string, { version: string; sha256: string }>;
const repo = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../..')}/`;
const folders = existsSync(`${repo}tools`)
  ? readdirSync(`${repo}tools`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : [];
const scriptsIn = (folder: string) => readdirSync(`${repo}tools/${folder}`).filter((f) => f.endsWith('.user.js')).sort();
const stampOf = (folder: string): Stamp | null => {
  const path = `${repo}tools/${folder}/stamp.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Stamp) : null;
};
const scripts = folders.flatMap((folder) => scriptsIn(folder).map((f) => `${folder}/${f}`));
const recordOf = (path: string) => {
  const [folder, file] = path.split('/');
  return stampOf(folder)?.[file];
};
const header = (text: string, key: string) => (new RegExp(`^// @${key}\\s+(\\S.*?)\\s*$`, 'm').exec(text) ?? [])[1] ?? null;

describe('userscripts in tools/', () => {
  it('has every script on record in its own folder\'s stamp.json, and no record without a script', () => {
    for (const folder of folders) {
      const files = scriptsIn(folder);
      const stamp = stampOf(folder);
      if (files.length === 0) {
        expect(stamp, `tools/${folder}/stamp.json has no scripts beside it: delete it`).toBeNull();
        continue;
      }
      expect(stamp, `tools/${folder} has scripts but no stamp.json: run npm run userscripts:stamp`).not.toBeNull();
      expect(Object.keys(stamp ?? {}).sort(), `tools/${folder}/stamp.json`).toEqual(files);
    }
  });

  it.each(scripts)('%s updates itself from its own served copy', (path) => {
    const text = readFileSync(`${repo}tools/${path}`, 'utf8');
    const updateUrl = header(text, 'updateURL') ?? '';
    expect(updateUrl.startsWith('https://') && updateUrl.endsWith(`/tools/${path}`), `${path} @updateURL`).toBe(true);
    expect(header(text, 'downloadURL')).toBe(updateUrl);
    const served = `${repo}packages/client/public/tools/${path}`;
    expect(existsSync(served), `${path} is not served: run npm run userscripts:stamp`).toBe(true);
    expect(readFileSync(served, 'utf8')).toBe(text);
  });

  it.each(scripts)('%s is stamped: a change came with a higher @version', (path) => {
    const text = readFileSync(`${repo}tools/${path}`, 'utf8');
    const record = recordOf(path);
    expect(record, `${path} is not in its folder's stamp.json: run npm run userscripts:stamp`).toBeDefined();
    if (!record) return;
    const sha256 = createHash('sha256').update(text).digest('hex');
    expect(header(text, 'version'), `${path}: raise @version and run npm run userscripts:stamp`).toBe(record.version);
    expect(sha256, `${path} changed since it was stamped: raise @version and run npm run userscripts:stamp`).toBe(record.sha256);
  });
});
