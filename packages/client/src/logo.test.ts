// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The repo-root logo.svg (shown at the top of the README, and served at /logo.svg as a fallback
 * behind the built client) must be the same drawing as the app's packages/client/public/logo.svg:
 * v1.22.1 changed only the app's copy, and the README kept showing the old logo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO_VERSION } from './brand';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pub = resolve(repo, 'packages/client/public');

describe('logo.svg', () => {
  it('is the same file at the repo root and in the client', () => {
    expect(readFileSync(resolve(repo, 'logo.svg'), 'utf8')).toBe(readFileSync(resolve(repo, 'packages/client/public/logo.svg'), 'utf8'));
  });
});

// v1.22.3: /favicon.ico used to fall through to index.html. Browsers ask for it by themselves.
describe('favicon.ico', () => {
  it('is an ICO with 16, 32 and 48 px images', () => {
    const ico = readFileSync(resolve(pub, 'favicon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // reserved, type 1 = icon
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => [ico[6 + 16 * i], ico[7 + 16 * i]]);
    expect(sizes.sort((a, b) => a[0] - b[0])).toEqual([[16, 16], [32, 32], [48, 48]]);
  });
});

describe('site.webmanifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(pub, 'site.webmanifest'), 'utf8')) as {
    name: string; theme_color: string; icons: { src: string; sizes: string; type: string }[];
  };

  it('names the app in the logo’s colour', () => {
    expect(manifest.name).toBe('libreSRS');
    expect(manifest.theme_color).toBe('#312e81');
  });

  it('lists 192 and 512 px PNG icons that exist, of the size they say', () => {
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      // Stamped like index.html's links, or browsers keep the old icons for 4 h after a logo change.
      expect(icon.src.split('?')[1]).toBe(`v=${LOGO_VERSION}`);
      const file = resolve(pub, icon.src.split('?')[0].slice(1));
      expect(existsSync(file)).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
