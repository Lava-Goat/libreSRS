#!/usr/bin/env node
// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Userscripts in tools/<folder>/ are served at /tools/<folder>/<name>.user.js and update themselves
 * from there (@updateURL). Violentmonkey and Tampermonkey install an update only when @version goes
 * UP, so a script changed without a new version never reaches anyone. Each folder's stamp.json
 * records its scripts' versions and content hashes ({ "<name>.user.js": { version, sha256 } }); the
 * client test (userscripts.test.ts) fails when they drift.
 *
 *   node scripts/stamp-userscripts.mjs            copy each script to packages/client/public/tools/
 *                                                 and record it; refuses a changed script whose
 *                                                 @version did not go up
 *   node scripts/stamp-userscripts.mjs --publish  hand over to an optional publisher, if the tree has one
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--publish');
if (unknown.length > 0) {
  console.error(`unknown option ${unknown.join(' ')} (usage: stamp-userscripts.mjs [--publish])`);
  process.exit(1);
}

if (args.includes('--publish')) {
  // The publisher stamps first (this script, without --publish), so the two never call each other in a loop.
  const publisher = join(root, 'scripts/release/publish-userscripts.mjs');
  if (!existsSync(publisher)) {
    console.error('publishing is not part of this tree');
    process.exit(1);
  }
  await import(pathToFileURL(publisher).href);
} else {
  stamp();
}

function stamp() {
  const toolsDir = join(root, 'tools');
  const servedDir = join(root, 'packages/client/public/tools');
  const versionOf = (text) => (/^\/\/ @version\s+(\S+)\s*$/m.exec(text) || [])[1] || null;
  const newer = (a, b) => {
    const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };
  const sameFile = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));

  const folders = existsSync(toolsDir)
    ? readdirSync(toolsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  let failed = false;
  let scripts = 0;
  const writes = [];
  for (const dir of folders) {
    const stampPath = join(toolsDir, dir, 'stamp.json');
    const files = readdirSync(join(toolsDir, dir)).filter((f) => f.endsWith('.user.js')).sort();
    if (files.length === 0) {
      // A folder whose scripts are gone keeps no record of them.
      if (existsSync(stampPath)) writes.push(() => { rmSync(stampPath); console.log(`${dir}/stamp.json: no scripts beside it, removed`); });
      continue;
    }
    const record = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')) : {};
    const next = {};
    for (const file of files) {
      scripts++;
      const key = `${dir}/${file}`;
      const text = readFileSync(join(toolsDir, dir, file), 'utf8');
      const version = versionOf(text);
      const sha256 = createHash('sha256').update(text).digest('hex');
      const was = record[file];
      if (!version) {
        console.error(`${key}: no @version`);
        failed = true;
        continue;
      }
      if (was && was.sha256 !== sha256 && !newer(version, was.version)) {
        console.error(`${key}: changed, but @version ${version} is not above ${was.version}. Raise it, then run this again.`);
        failed = true;
        continue;
      }
      next[file] = { version, sha256 };
      const served = join(servedDir, dir, file);
      writes.push(() => {
        if (!sameFile(join(toolsDir, dir, file), served)) {
          mkdirSync(join(servedDir, dir), { recursive: true });
          copyFileSync(join(toolsDir, dir, file), served);
        }
        if (!was || was.sha256 !== sha256) console.log(`${key}: ${was ? `${was.version} → ` : ''}${version}, served at ${relative(root, served)}`);
      });
    }
    const text = JSON.stringify(next, null, 2) + '\n';
    if (!existsSync(stampPath) || readFileSync(stampPath, 'utf8') !== text) writes.push(() => writeFileSync(stampPath, text));
  }
  // Nothing is written unless every script passed, so a refusal leaves the tree as it was.
  if (failed) process.exit(1);
  for (const write of writes) write();
  if (scripts === 0) console.log('no userscripts');
}
