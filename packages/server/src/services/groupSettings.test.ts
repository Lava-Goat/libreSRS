// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const customGroupSettings = {
  newCardsPerDay: 7,
  reviewsPerDay: 9,
  isOverride: true,
  allowHigher: false,
  allowLower: true,
  aiEnabled: false,
  aiEnabledLocked: true,
  autoPlayAudio: true,
  autoPlayAudioLocked: true,
  autoPlayAudioFront: true,
  autoPlayAudioFrontLocked: true,
  mnemonicMode: 'manual' as const,
  mnemonicModeLocked: true,
  locale: 'es',
  localeLocked: true,
};

describe('groupSettings service', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS group_settings (
        group_id INTEGER PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        new_cards_per_day INTEGER NOT NULL DEFAULT 20,
        reviews_per_day INTEGER NOT NULL DEFAULT 20,
        is_override INTEGER NOT NULL DEFAULT 0,
        allow_higher INTEGER NOT NULL DEFAULT 1,
        allow_lower INTEGER NOT NULL DEFAULT 1,
        ai_enabled INTEGER NOT NULL DEFAULT 1,
        ai_enabled_locked INTEGER NOT NULL DEFAULT 0,
        auto_play_audio INTEGER NOT NULL DEFAULT 0,
        auto_play_audio_locked INTEGER NOT NULL DEFAULT 0,
        auto_play_audio_front INTEGER NOT NULL DEFAULT 0,
        auto_play_audio_front_locked INTEGER NOT NULL DEFAULT 0,
        mnemonic_mode TEXT NOT NULL DEFAULT 'auto-non-cognate',
        mnemonic_mode_locked INTEGER NOT NULL DEFAULT 0,
        show_cognate_score INTEGER NOT NULL DEFAULT 1,
        show_cognate_score_locked INTEGER NOT NULL DEFAULT 0,
        locale TEXT,
        locale_locked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )
    `);

    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'u1', email: 'u1@example.com', name: 'User 1' },
      { id: 2, googleId: 'u2', email: 'u2@example.com', name: 'User 2' },
    ]);

    await testDb.insert(schema.groups).values({
      id: 1,
      name: 'Group A',
      description: 'Test',
    });

    await testDb.insert(schema.userGroups).values([
      { userId: 1, groupId: 1 },
      { userId: 2, groupId: 1 },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('creates default group settings on first access and is idempotent', async () => {
    const { getOrCreateGroupSettings, DEFAULT_GROUP_SETTINGS } = await import('./groupSettings.js');

    const first = await getOrCreateGroupSettings(1);
    const second = await getOrCreateGroupSettings(1);

    expect(first.groupId).toBe(1);
    expect(first.newCardsPerDay).toBe(DEFAULT_GROUP_SETTINGS.newCardsPerDay);
    expect(first.reviewsPerDay).toBe(DEFAULT_GROUP_SETTINGS.reviewsPerDay);
    expect(second.groupId).toBe(1);
  });

  it('updates existing group settings', async () => {
    const { getOrCreateGroupSettings, updateGroupSettings } = await import('./groupSettings.js');
    await getOrCreateGroupSettings(1);

    const updated = await updateGroupSettings(1, customGroupSettings);
    expect(updated.newCardsPerDay).toBe(7);
    expect(updated.reviewsPerDay).toBe(9);
    expect(updated.mnemonicMode).toBe('manual');
    expect(updated.locale).toBe('es');
  });

  it('applies group settings to all group members', async () => {
    const {
      getOrCreateGroupSettings,
      updateGroupSettings,
      applyGroupSettingsToMembers,
    } = await import('./groupSettings.js');

    await getOrCreateGroupSettings(1);
    await updateGroupSettings(1, customGroupSettings);

    const updatedCount = await applyGroupSettingsToMembers(1);
    expect(updatedCount).toBe(2);

    const settingsUser1 = await testDb.query.userSettings.findFirst({
      where: eq(schema.userSettings.userId, 1),
    });
    const settingsUser2 = await testDb.query.userSettings.findFirst({
      where: eq(schema.userSettings.userId, 2),
    });

    expect(settingsUser1).toBeTruthy();
    expect(settingsUser2).toBeTruthy();
    expect(settingsUser1?.newCardsPerDay).toBe(7);
    expect(settingsUser1?.reviewsPerDay).toBe(9);
    expect(settingsUser1?.aiEnabled).toBe(false);
    expect(settingsUser1?.aiEnabledLocked).toBe(true);
    expect(settingsUser1?.mnemonicMode).toBe('manual');
    expect(settingsUser1?.locale).toBe('es');
  });

  it('writes \'manual\', never the deprecated \'auto-non-cognate\', from a group saved before v1.20.0', async () => {
    const { getOrCreateGroupSettings, applyGroupSettingsToMembers, DEFAULT_GROUP_SETTINGS } = await import('./groupSettings.js');
    expect(DEFAULT_GROUP_SETTINGS.mnemonicMode).toBe('manual');
    expect((await getOrCreateGroupSettings(1)).mnemonicMode).toBe('manual');
    // A row from before v1.20.0 (the table's SQL default is still the legacy value).
    await client.execute(`UPDATE group_settings SET mnemonic_mode = 'auto-non-cognate' WHERE group_id = 1`);

    await applyGroupSettingsToMembers(1);
    const rows = await client.execute('SELECT mnemonic_mode FROM user_settings ORDER BY user_id');
    expect(rows.rows.map((r) => r.mnemonic_mode)).toEqual(['manual', 'manual']);
  });

  describe('applyGroupSettingsToUser (a student added later)', () => {
    const userRow = (userId: number) => testDb.query.userSettings.findFirst({
      where: eq(schema.userSettings.userId, userId),
    });

    beforeEach(async () => {
      await testDb.insert(schema.users).values({ id: 3, googleId: 'u3', email: 'u3@example.com', name: 'User 3' });
      // User 3 had their own settings before joining.
      await testDb.insert(schema.userSettings).values({
        userId: 3, newCardsPerDay: 50, reviewsPerDay: 60, aiEnabled: true, locale: 'en',
      });
    });

    it('does nothing when the group has no settings row, and creates none', async () => {
      const { applyGroupSettingsToUser } = await import('./groupSettings.js');
      await testDb.insert(schema.userGroups).values({ userId: 3, groupId: 1 });

      expect(await applyGroupSettingsToUser(1, 3)).toBe(false);
      expect(await testDb.query.groupSettings.findFirst({ where: eq(schema.groupSettings.groupId, 1) })).toBeUndefined();
      expect(await userRow(3)).toMatchObject({ newCardsPerDay: 50, reviewsPerDay: 60, isOverride: false, locale: 'en' });
    });

    it('does nothing when the group\'s Override is off', async () => {
      const { updateGroupSettings, applyGroupSettingsToUser } = await import('./groupSettings.js');
      await updateGroupSettings(1, { ...customGroupSettings, isOverride: false });
      await testDb.insert(schema.userGroups).values({ userId: 3, groupId: 1 });

      expect(await applyGroupSettingsToUser(1, 3)).toBe(false);
      expect(await userRow(3)).toMatchObject({ newCardsPerDay: 50, reviewsPerDay: 60, aiEnabled: true, locale: 'en' });
    });

    it('on join with the Override on, writes every group setting to that student only', async () => {
      const { updateGroupSettings, applyGroupSettingsToUser } = await import('./groupSettings.js');
      await updateGroupSettings(1, customGroupSettings);
      await testDb.insert(schema.userGroups).values({ userId: 3, groupId: 1 });

      expect(await applyGroupSettingsToUser(1, 3)).toBe(true);
      expect(await userRow(3)).toMatchObject({
        newCardsPerDay: 7,
        reviewsPerDay: 9,
        isOverride: true,
        allowHigher: false,
        allowLower: true,
        aiEnabled: false,
        aiEnabledLocked: true,
        autoPlayAudio: true,
        autoPlayAudioLocked: true,
        autoPlayAudioFront: true,
        autoPlayAudioFrontLocked: true,
        mnemonicMode: 'manual',
        mnemonicModeLocked: true,
        locale: 'es',
        localeLocked: true,
      });
      // The members already in the group are not touched (no settings rows were written for them).
      expect(await userRow(1)).toBeUndefined();
      expect(await userRow(2)).toBeUndefined();
    });

    it('creates the student\'s settings row when they had none', async () => {
      const { updateGroupSettings, applyGroupSettingsToUser } = await import('./groupSettings.js');
      await updateGroupSettings(1, { ...customGroupSettings, newCardsPerDay: 20, reviewsPerDay: 20, allowHigher: true, allowLower: false });

      expect(await applyGroupSettingsToUser(1, 2)).toBe(true);
      expect(await userRow(2)).toMatchObject({ newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: false });
    });

    it('does nothing for someone who is not in the group', async () => {
      const { updateGroupSettings, applyGroupSettingsToUser } = await import('./groupSettings.js');
      await updateGroupSettings(1, customGroupSettings);

      expect(await applyGroupSettingsToUser(1, 3)).toBe(false);
      expect(await userRow(3)).toMatchObject({ newCardsPerDay: 50, reviewsPerDay: 60, isOverride: false });
    });

    it('applyGroupSettingsToUsers applies to the listed members once each and skips the rest', async () => {
      const { updateGroupSettings, applyGroupSettingsToUsers } = await import('./groupSettings.js');
      await updateGroupSettings(1, customGroupSettings);
      await testDb.insert(schema.userGroups).values({ userId: 3, groupId: 1 });

      expect(await applyGroupSettingsToUsers(1, [3, 3, 99])).toBe(1);
      expect(await applyGroupSettingsToUsers(1, [])).toBe(0);
      expect(await userRow(3)).toMatchObject({ newCardsPerDay: 7, reviewsPerDay: 9, isOverride: true });
      expect(await userRow(1)).toBeUndefined();
    });

    it('the last group applied wins for a student in two groups', async () => {
      const { updateGroupSettings, applyGroupSettingsToUser } = await import('./groupSettings.js');
      await testDb.insert(schema.groups).values({ id: 2, name: 'Group B', description: 'Test' });
      await updateGroupSettings(1, customGroupSettings);
      await updateGroupSettings(2, { ...customGroupSettings, newCardsPerDay: 30, reviewsPerDay: 40 });
      await testDb.insert(schema.userGroups).values([{ userId: 3, groupId: 1 }, { userId: 3, groupId: 2 }]);

      await applyGroupSettingsToUser(1, 3);
      await applyGroupSettingsToUser(2, 3);
      expect(await userRow(3)).toMatchObject({ newCardsPerDay: 30, reviewsPerDay: 40 });
    });
  });
});
