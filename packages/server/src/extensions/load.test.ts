// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExtensions } from './load.js';
import { ext, resetExtensions } from './registry.js';
import { logger } from '../logger.js';

/** A folder like dist/extensions: an enabled.js (or .ts) of a sample extension, written for this test only. */
function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'libresrs-ext-load-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
/** What combine(sample) gives, as plain JS (the loader only takes the module's `extensions`). */
const enabledJs = (ids: string[]) => `
  export const extensions = {
    ids: ${JSON.stringify(ids)},
    routers: {},
    defaults: { review: {}, studyFinish: {}, answer: {}, answerGraded: {}, roundSummary: {}, studyAllOverview: {}, userDetail: { user: {}, detail: {} } },
    async run(hook) { return hook === 'userDetail' ? { user: {}, detail: { loadedFrom: 'js' } } : { loadedFrom: 'js' }; },
    beforeSession: [],
  };
`;
const now = new Date();

afterEach(() => {
  vi.restoreAllMocks();
  resetExtensions();
});

describe('loadExtensions', () => {
  it('loads none from a folder without enabled.*, and says so', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    expect(await loadExtensions({ dir: folderWith({}), env: {} })).toEqual([]);
    expect(ext().ids).toEqual([]);
    expect(info).toHaveBeenCalledWith({ extensions: [] }, 'Extensions loaded');
  });

  it('loads enabled.js and fills the registry', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    expect(await loadExtensions({ dir: folderWith({ 'enabled.js': enabledJs(['sample']) }), env: {} })).toEqual(['sample']);
    expect(ext().ids).toEqual(['sample']);
    expect(await ext().run('review', { user: { id: 1, role: 'user' }, reviewLogId: 1, now })).toEqual({ loadedFrom: 'js' });
    expect(info).toHaveBeenCalledWith({ extensions: ['sample'] }, 'Extensions loaded');
  });

  it('loads enabled.ts when there is no enabled.js (tsx, dev), and prefers enabled.js (dist) when both exist', async () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    const ts = enabledJs(['from-ts']).replace('export const extensions =', 'export const extensions: Record<string, unknown> =');
    expect(await loadExtensions({ dir: folderWith({ 'enabled.ts': ts }), env: {} })).toEqual(['from-ts']);
    expect(await loadExtensions({ dir: folderWith({ 'enabled.ts': ts, 'enabled.js': enabledJs(['from-js']) }), env: {} })).toEqual(['from-js']);
  });

  it('loads none with LIBRESRS_EXTENSIONS=none, even when enabled.js exists', async () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    const dir = folderWith({ 'enabled.js': enabledJs(['sample']) });
    expect(await loadExtensions({ dir, env: { LIBRESRS_EXTENSIONS: 'none' } })).toEqual([]);
    expect(ext().ids).toEqual([]);
  });

  it('fails when LIBRESRS_REQUIRE_EXTENSIONS names one that did not load, and leaves the registry empty', async () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    await expect(loadExtensions({ dir: folderWith({}), env: { LIBRESRS_REQUIRE_EXTENSIONS: 'sample' } }))
      .rejects.toThrow('Required extensions not loaded: sample');
    await expect(loadExtensions({
      dir: folderWith({ 'enabled.js': enabledJs(['sample']) }),
      env: { LIBRESRS_EXTENSIONS: 'none', LIBRESRS_REQUIRE_EXTENSIONS: 'sample' },
    })).rejects.toThrow('Required extensions not loaded: sample');
    await expect(loadExtensions({
      dir: folderWith({ 'enabled.js': enabledJs(['sample']) }),
      env: { LIBRESRS_REQUIRE_EXTENSIONS: ' sample , other ' },
    })).rejects.toThrow('Required extensions not loaded: other');
    expect(ext().ids).toEqual([]);
  });

  it('passes when every required extension loaded', async () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    const dir = folderWith({ 'enabled.js': enabledJs(['sample', 'other']) });
    expect(await loadExtensions({ dir, env: { LIBRESRS_REQUIRE_EXTENSIONS: 'other,sample' } })).toEqual(['sample', 'other']);
  });

  it('fails loudly when enabled.js fails to import or exports no extensions', async () => {
    await expect(loadExtensions({ dir: folderWith({ 'enabled.js': 'throw new Error("broken extension");' }), env: {} }))
      .rejects.toThrow('broken extension');
    await expect(loadExtensions({ dir: folderWith({ 'enabled.js': 'export const other = 1;' }), env: {} }))
      .rejects.toThrow(/does not export `extensions`/);
    expect(ext().ids).toEqual([]);
  });
});
