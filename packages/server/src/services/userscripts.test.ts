// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isNewer, userscriptsRouter, versionOf } from './userscripts.js';

const script = (version: string, body = 'run()') => `// ==UserScript==\n// @name         Helper\n// @version      ${version}\n// ==/UserScript==\n${body}\n`;

let root: string;
let builtIn: string;
let published: string;
let server: Server | null = null;
let base: string;

/** The router as index.ts mounts it, with a static fallback behind it. */
async function start() {
  const app = express();
  app.use('/tools', userscriptsRouter(builtIn, published));
  app.use((_req, res) => { res.status(404).send('fallback'); });
  server = await new Promise<Server>((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tools`;
}
const put = (dir: string, path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'userscripts-'));
  builtIn = join(root, 'built-in');
  published = join(root, 'published');
  mkdirSync(builtIn);
  await start();
});
afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
  rmSync(root, { recursive: true, force: true });
});

describe('versions', () => {
  it('reads @version and compares dotted versions as numbers', () => {
    expect(versionOf(script('1.8.0'))).toBe('1.8.0');
    expect(versionOf('// no header')).toBeNull();
    expect(isNewer('1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('1.8.0', '1.8')).toBe(false);
    expect(isNewer('1.8.1', '1.8')).toBe(true);
    expect(isNewer('1.7.9', '1.8.0')).toBe(false);
  });
});

describe('serving /tools/<folder>/<name>.user.js', () => {
  it('serves the built-in copy when nothing was published, never cached without asking', async () => {
    put(builtIn, 'quick/quick.user.js', script('1.7.1'));
    const res = await fetch(`${base}/quick/quick.user.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(res.headers.get('x-userscript-source')).toBe('built-in');
    expect(versionOf(await res.text())).toBe('1.7.1');
  });

  it('serves a published copy with a higher @version, at once and without a restart', async () => {
    put(builtIn, 'quick/quick.user.js', script('1.7.1'));
    put(published, 'quick/quick.user.js', script('1.8.0', 'runBetter()'));
    const res = await fetch(`${base}/quick/quick.user.js`);
    expect(res.headers.get('x-userscript-source')).toBe('published');
    expect(await res.text()).toContain('runBetter()');
  });

  it('serves the built-in copy once a release ships a version above the published one', async () => {
    put(builtIn, 'quick/quick.user.js', script('1.9.0', 'released()'));
    put(published, 'quick/quick.user.js', script('1.8.0'));
    const res = await fetch(`${base}/quick/quick.user.js`);
    expect(res.headers.get('x-userscript-source')).toBe('built-in');
    expect(await res.text()).toContain('released()');
  });

  it('prefers the built-in copy at the same version, and ignores a published file without @version', async () => {
    put(builtIn, 'quick/quick.user.js', script('1.8.0', 'built()'));
    put(published, 'quick/quick.user.js', script('1.8.0', 'copy()'));
    expect(await (await fetch(`${base}/quick/quick.user.js`)).text()).toContain('built()');
    put(published, 'quick/quick.user.js', '// no header\nbroken()');
    expect(await (await fetch(`${base}/quick/quick.user.js`)).text()).toContain('built()');
  });

  it('serves a script only published (none built in), and passes anything else on', async () => {
    put(published, 'brand-new/brand-new.user.js', script('1.0.0'));
    expect((await fetch(`${base}/brand-new/brand-new.user.js`)).status).toBe(200);
    expect(await (await fetch(`${base}/missing/missing.user.js`)).text()).toBe('fallback');
    expect(await (await fetch(`${base}/quick/notes.txt`)).text()).toBe('fallback');
  });

  it('never reads outside the two folders', async () => {
    writeFileSync(join(root, 'secret.user.js'), script('9.9.9', 'secret()'));
    for (const path of ['/..%2Fsecret.user.js', '/quick/..%2F..%2Fsecret.user.js', '/%2E%2E/secret.user.js', '/Quick/x.user.js']) {
      const res = await fetch(`${base}${path}`);
      expect(await res.text()).not.toContain('secret()');
    }
  });
});
