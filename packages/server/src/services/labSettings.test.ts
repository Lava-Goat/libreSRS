// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

async function load() {
  return import('./labSettings.js');
}

describe('lab settings', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
  });

  /** The margin and the hold, as a row saved before v1.16.0 reads them (0040's column defaults). */
  const meterDefaults = { gateMarginDb: 6, holdOutsideVoice: false };

  it('reads the defaults (75%, 0.25 s, 6 dB, no hold) when nothing was saved', async () => {
    const { getLabSettings } = await load();
    expect(getLabSettings()).toEqual({ minAnsweredPct: 75, voicePerPauseMs: 250, ...meterDefaults });
  });

  it('reads the seeded "watch first" row as 0%', async () => {
    await testDb.insert(schema.labSettings).values({ id: 1, minAnsweredPct: 0, voicePerPauseMs: 250, updatedAt: new Date(1790141639399) });
    const { getLabSettings } = await load();
    expect(getLabSettings()).toEqual({ minAnsweredPct: 0, voicePerPauseMs: 250, ...meterDefaults });
  });

  it('clamps stored values to the ranges: a floor under 0.2 s reads as 0.2 s', async () => {
    await testDb.insert(schema.labSettings).values({ id: 1, minAnsweredPct: 140, voicePerPauseMs: 100, gateMarginDb: 20, updatedAt: new Date() });
    const { getLabSettings } = await load();
    expect(getLabSettings()).toEqual({ minAnsweredPct: 100, voicePerPauseMs: 200, gateMarginDb: 12, holdOutsideVoice: false });
  });

  it('saves what is given and keeps the rest, in one row', async () => {
    const { getLabSettings, saveLabSettings } = await load();
    const when = new Date('2026-09-01T17:00:00Z');
    expect(saveLabSettings({ minAnsweredPct: 80 }, when)).toEqual({ minAnsweredPct: 80, voicePerPauseMs: 250, ...meterDefaults });
    expect(saveLabSettings({ voicePerPauseMs: 400 })).toEqual({ minAnsweredPct: 80, voicePerPauseMs: 400, ...meterDefaults });
    expect(getLabSettings()).toEqual({ minAnsweredPct: 80, voicePerPauseMs: 400, ...meterDefaults });
    const rows = await testDb.select().from(schema.labSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].updatedAt.getTime()).toBeGreaterThan(when.getTime());
  });

  it('saves the room margin and the hold, and keeps them when the share is saved', async () => {
    const { getLabSettings, saveLabSettings } = await load();
    expect(saveLabSettings({ gateMarginDb: 8, holdOutsideVoice: true }))
      .toEqual({ minAnsweredPct: 75, voicePerPauseMs: 250, gateMarginDb: 8, holdOutsideVoice: true });
    expect(saveLabSettings({ minAnsweredPct: 60, voicePerPauseMs: 200 }))
      .toEqual({ minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 8, holdOutsideVoice: true });
    expect(saveLabSettings({ holdOutsideVoice: false })).toMatchObject({ gateMarginDb: 8, holdOutsideVoice: false });
    expect(getLabSettings()).toEqual({ minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 8, holdOutsideVoice: false });
    expect(await testDb.select().from(schema.labSettings)).toEqual([
      expect.objectContaining({ id: 1, minAnsweredPct: 60, voicePerPauseMs: 200, gateMarginDb: 8, holdOutsideVoice: false }),
    ]);
  });

  it('clamps what it saves', async () => {
    const { saveLabSettings } = await load();
    expect(saveLabSettings({ minAnsweredPct: -5, voicePerPauseMs: 100, gateMarginDb: 2 }))
      .toEqual({ minAnsweredPct: 0, voicePerPauseMs: 200, gateMarginDb: 4, holdOutsideVoice: false });
    expect(saveLabSettings({ minAnsweredPct: 101, voicePerPauseMs: 5000, gateMarginDb: 13 }))
      .toEqual({ minAnsweredPct: 100, voicePerPauseMs: 2000, gateMarginDb: 12, holdOutsideVoice: false });
    expect(saveLabSettings({ minAnsweredPct: 72.6 })).toEqual({ minAnsweredPct: 73, voicePerPauseMs: 2000, gateMarginDb: 12, holdOutsideVoice: false });
  });
});
