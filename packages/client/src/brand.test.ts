// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * index.html's icon links carry the logo's ?v= stamp (brand.ts), all the same one, so a browser
 * that cached the old icons behind a caching proxy asks for the new ones; and each names a real file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO_SRC, LOGO_VERSION } from './brand';

const client = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(client, 'index.html'), 'utf8');
const links = [...html.matchAll(/<link\s[^>]*rel="(icon|apple-touch-icon|manifest)"[^>]*>/g)].map(([tag, rel]) => ({
  rel,
  href: /href="([^"]+)"/.exec(tag)?.[1] ?? '',
}));

describe('brand', () => {
  it('stamps the in-app logo', () => {
    expect(LOGO_SRC).toBe(`/logo.svg?v=${LOGO_VERSION}`);
    expect(existsSync(resolve(client, 'public/logo.svg'))).toBe(true);
  });

  it('links the favicon set, the touch icon and the manifest', () => {
    const paths = links.map(({ href }) => href.split('?')[0]);
    expect(paths).toEqual(expect.arrayContaining(['/favicon.ico', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/site.webmanifest']));
    expect(links.find(({ href }) => href.startsWith('/apple-touch-icon.png'))?.rel).toBe('apple-touch-icon');
    expect(links.find(({ href }) => href.startsWith('/site.webmanifest'))?.rel).toBe('manifest');
  });

  it.each(links)('$href carries the stamp and exists in public/', ({ href }) => {
    const [path, query] = href.split('?');
    expect(query).toBe(`v=${LOGO_VERSION}`);
    expect(existsSync(resolve(client, 'public', path.slice(1)))).toBe(true);
  });

  it('sets the theme colour to the tile’s indigo', () => {
    expect(html).toContain('<meta name="theme-color" content="#312e81" />');
  });
});
