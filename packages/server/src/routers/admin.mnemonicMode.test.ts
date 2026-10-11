// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The teacher's settings pages since v1.20.0, when the cognate system was removed: a student's or
 * a group's stored 'auto-non-cognate' (the old default, still the SQL default of both tables)
 * reads as 'manual'; a page loaded before v1.20.0 may still send it, with the show-cognate-score
 * switch, and is saved as 'manual' with the deprecated columns left alone.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb, sqlite } = createTestDb();

const admin = { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', picture: null, role: 'admin' as const };

async function adminCaller() {
  const { adminRouter } = await import('./admin.js');
  return adminRouter.createCaller({ req: { user: admin } as unknown as Request, res: {} as Response, user: admin, requestId: null });
}

/** What a page loaded before v1.20.0 sends with Save, for a student or a group. */
const OLD_PAGE_SETTINGS = {
  newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: true,
  aiEnabled: true, aiEnabledLocked: false, autoPlayAudio: false, autoPlayAudioLocked: false,
  autoPlayAudioFront: false, autoPlayAudioFrontLocked: false,
  mnemonicMode: 'auto-non-cognate', mnemonicModeLocked: true,
  showCognateScore: false, showCognateScoreLocked: true,
  locale: null, localeLocked: false,
};

const stored = (table: 'user_settings' | 'group_settings', key: 'user_id' | 'group_id', id: number) =>
  sqlite.prepare(`SELECT mnemonic_mode, show_cognate_score, show_cognate_score_locked FROM ${table} WHERE ${key} = ?`).get(id);

describe('the teacher\'s settings pages and the deprecated mode \'auto-non-cognate\'', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: '123456@students.school.test', name: 'Ana', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values({ id: 3, name: 'Period 1' });
    // Rows as an upgraded install has them: written by the SQL defaults, before v1.20.0.
    await client.execute('INSERT INTO user_settings (user_id) VALUES (2)');
    await client.execute('INSERT INTO group_settings (group_id) VALUES (3)');
  });

  afterAll(async () => {
    await client.close();
  });

  it('reads it as \'manual\' for a student, the student list and a group, with no cognate switch in any answer', async () => {
    expect(stored('user_settings', 'user_id', 2)).toMatchObject({ mnemonic_mode: 'auto-non-cognate' });
    expect(stored('group_settings', 'group_id', 3)).toMatchObject({ mnemonic_mode: 'auto-non-cognate' });
    const caller = await adminCaller();

    const all = await caller.getAllUserSettings();
    const ana = all.find((row) => row.userId === 2)!;
    expect(ana.mnemonicMode).toBe('manual');
    // A teacher with no row yet gets the default, which is 'manual' too.
    expect(all.find((row) => row.userId === 1)!.mnemonicMode).toBe('manual');
    for (const row of all) expect(Object.keys(row).filter((key) => /cognate/i.test(key))).toEqual([]);

    const group = await caller.getGroupSettings({ groupId: 3 });
    expect(group.mnemonicMode).toBe('manual');
    expect(Object.keys(group).filter((key) => /cognate/i.test(key))).toEqual([]);
  });

  it('saves an older page\'s \'auto-non-cognate\' as \'manual\', and leaves the deprecated switch as it was', async () => {
    const caller = await adminCaller();

    const student = await caller.updateUserSettings({ userId: 2, ...OLD_PAGE_SETTINGS } as Parameters<typeof caller.updateUserSettings>[0]);
    expect(student.mnemonicMode).toBe('manual');
    expect(student).not.toHaveProperty('showCognateScore');
    expect(stored('user_settings', 'user_id', 2)).toEqual({ mnemonic_mode: 'manual', show_cognate_score: 1, show_cognate_score_locked: 0 });

    const group = await caller.updateGroupSettings({ groupId: 3, ...OLD_PAGE_SETTINGS } as Parameters<typeof caller.updateGroupSettings>[0]);
    expect(group.mnemonicMode).toBe('manual');
    expect(stored('group_settings', 'group_id', 3)).toEqual({ mnemonic_mode: 'manual', show_cognate_score: 1, show_cognate_score_locked: 0 });

    // 'disabled' is still a mode of its own, and anything else is refused.
    await caller.updateUserSettings({ userId: 2, ...OLD_PAGE_SETTINGS, mnemonicMode: 'disabled' } as Parameters<typeof caller.updateUserSettings>[0]);
    expect(stored('user_settings', 'user_id', 2)).toMatchObject({ mnemonic_mode: 'disabled' });
    await expect(caller.updateUserSettings({ userId: 2, ...OLD_PAGE_SETTINGS, mnemonicMode: 'auto' } as Parameters<typeof caller.updateUserSettings>[0]))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
