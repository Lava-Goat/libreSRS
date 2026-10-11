// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('userSettings service', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });

    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'u1',
      email: 'user@example.com',
      name: 'User',
    });

    await testDb.insert(schema.decks).values({
      id: 10,
      name: 'Deck 10',
      createdBy: 1,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('computeEffectiveLimits uses deck limits when not in override mode', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    const result = computeEffectiveLimits(
      { newCardsPerDay: 20, reviewsPerDay: 30, isOverride: false },
      { newCardsPerDay: 5, reviewsPerDay: 7 }
    );

    expect(result).toEqual({ newCardsPerDay: 5, reviewsPerDay: 7 });
  });

  it('computeEffectiveLimits honors allowHigher-only override mode', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    const result = computeEffectiveLimits(
      {
        newCardsPerDay: 20,
        reviewsPerDay: 30,
        isOverride: true,
        allowHigher: true,
        allowLower: false,
      },
      { newCardsPerDay: 10, reviewsPerDay: 40 }
    );

    expect(result).toEqual({ newCardsPerDay: 20, reviewsPerDay: 40 });
  });

  it('computeEffectiveLimits falls back to base limits when override disallows both directions', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    const result = computeEffectiveLimits(
      {
        newCardsPerDay: 12,
        reviewsPerDay: 14,
        isOverride: true,
        allowHigher: false,
        allowLower: false,
      },
      { newCardsPerDay: 99, reviewsPerDay: 99 }
    );

    expect(result).toEqual({ newCardsPerDay: 12, reviewsPerDay: 14 });
  });

  it('computeEffectiveLimits honors lower-only override mode', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    const result = computeEffectiveLimits(
      { newCardsPerDay: 20, reviewsPerDay: 30, isOverride: true, allowHigher: false, allowLower: true },
      { newCardsPerDay: 10, reviewsPerDay: 40 }
    );

    expect(result).toEqual({ newCardsPerDay: 10, reviewsPerDay: 30 });
  });

  it('computeEffectiveLimits lets the deck decide when the override allows both directions', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    const result = computeEffectiveLimits(
      { newCardsPerDay: 20, reviewsPerDay: 30, isOverride: true, allowHigher: true, allowLower: true },
      { newCardsPerDay: 3, reviewsPerDay: 90 }
    );

    expect(result).toEqual({ newCardsPerDay: 3, reviewsPerDay: 90 });
  });

  it('computeEffectiveLimits uses the teacher\'s values when the deck has no row', async () => {
    const { computeEffectiveLimits } = await import('./userSettings.js');

    for (const lock of [
      { isOverride: true, allowHigher: true, allowLower: false },
      { isOverride: true, allowHigher: false, allowLower: true },
      { isOverride: true, allowHigher: false, allowLower: false },
      { isOverride: false },
    ]) {
      expect(computeEffectiveLimits({ newCardsPerDay: 20, reviewsPerDay: 30, ...lock }, null))
        .toEqual({ newCardsPerDay: 20, reviewsPerDay: 30 });
    }
    expect(computeEffectiveLimits(null, null)).toEqual({ newCardsPerDay: 20, reviewsPerDay: 20 });
  });

  it('limitRuleFor names the rule computeEffectiveLimits applies', async () => {
    const { limitRuleFor } = await import('./userSettings.js');

    expect(limitRuleFor(null)).toBe('free');
    expect(limitRuleFor({ isOverride: false, allowHigher: false, allowLower: false })).toBe('free');
    expect(limitRuleFor({ isOverride: true, allowHigher: true, allowLower: true })).toBe('free');
    expect(limitRuleFor({ isOverride: true, allowHigher: true, allowLower: false })).toBe('higher');
    expect(limitRuleFor({ isOverride: true, allowHigher: false, allowLower: true })).toBe('lower');
    expect(limitRuleFor({ isOverride: true, allowHigher: false, allowLower: false })).toBe('locked');
    // Missing flags default to allowed, as in computeEffectiveLimits.
    expect(limitRuleFor({ isOverride: true, allowHigher: null, allowLower: null })).toBe('free');
  });

  it('updateUserSettings respects admin-locked fields', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      aiEnabled: true,
      aiEnabledLocked: true,
      autoPlayAudio: false,
      autoPlayAudioLocked: true,
      autoPlayAudioFront: false,
      autoPlayAudioFrontLocked: true,
      mnemonicMode: 'disabled',
      mnemonicModeLocked: true,
      locale: 'en',
      localeLocked: true,
    });

    const { updateUserSettings } = await import('./userSettings.js');
    const updated = await updateUserSettings(1, {
      newCardsPerDay: 50,
      reviewsPerDay: 60,
      aiEnabled: false,
      autoPlayAudio: true,
      autoPlayAudioFront: true,
      mnemonicMode: 'manual',
      locale: 'es',
    });

    expect(updated.newCardsPerDay).toBe(50);
    expect(updated.reviewsPerDay).toBe(60);
    expect(updated.aiEnabled).toBe(true);
    expect(updated.autoPlayAudio).toBe(false);
    expect(updated.autoPlayAudioFront).toBe(false);
    expect(updated.mnemonicMode).toBe('disabled');
    expect(updated.locale).toBe('en');
  });

  it('updateUserSettings leaves a teacher\'s daily limits alone: the student\'s own form cannot lower (or raise) them', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 15, reviewsPerDay: 30, isOverride: true, allowHigher: true, allowLower: false,
    });
    const { updateUserSettings, getDeckUserSettings } = await import('./userSettings.js');
    const updated = await updateUserSettings(1, { newCardsPerDay: 1, reviewsPerDay: 1 });
    expect(updated).toMatchObject({ newCardsPerDay: 15, reviewsPerDay: 30 });
    // Per deck, only as allowed: higher, never lower.
    expect(await getDeckUserSettings(1, 1)).toMatchObject({ newCardsPerDay: 15, reviewsPerDay: 30 });
  });

  it('updateUserSettings under an override keeps the limits but saves the other fields', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: false,
      aiEnabled: true, autoPlayAudio: false, mnemonicMode: 'manual', locale: 'en',
    });
    const { updateUserSettings } = await import('./userSettings.js');
    const updated = await updateUserSettings(1, {
      newCardsPerDay: 5, reviewsPerDay: 5, aiEnabled: false, autoPlayAudio: true, mnemonicMode: 'disabled', locale: 'es',
    });
    expect(updated).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 20, isOverride: true, allowHigher: true, allowLower: false,
      aiEnabled: false, autoPlayAudio: true, mnemonicMode: 'disabled', locale: 'es',
    });
  });

  it('getDeckUserSettings: no override is free, with no teacher values', async () => {
    await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 20 });
    await testDb.insert(schema.deckUserSettings).values({ userId: 1, deckId: 10, newCardsPerDay: 4, reviewsPerDay: 50 });
    const { getDeckUserSettings } = await import('./userSettings.js');
    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 4, reviewsPerDay: 50, limitRule: 'free', teacherNewCardsPerDay: null, teacherReviewsPerDay: null,
    });
  });

  it('getDeckUserSettings: higher-only keeps the teacher\'s value as the floor', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 25, isOverride: true, allowHigher: true, allowLower: false,
    });
    const { getDeckUserSettings, updateDeckUserSettings } = await import('./userSettings.js');

    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 25, limitRule: 'higher', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 25,
    });

    // Higher counts; lower (sent past the form) does not.
    await updateDeckUserSettings(1, 10, { newCardsPerDay: 30, reviewsPerDay: 5 });
    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 30, reviewsPerDay: 25, limitRule: 'higher',
    });
  });

  it('getDeckUserSettings: lower-only keeps the teacher\'s value as the ceiling', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 25, isOverride: true, allowHigher: false, allowLower: true,
    });
    const { getDeckUserSettings, updateDeckUserSettings } = await import('./userSettings.js');

    await updateDeckUserSettings(1, 10, { newCardsPerDay: 10, reviewsPerDay: 100 });
    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 10, reviewsPerDay: 25, limitRule: 'lower', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 25,
    });
  });

  it('getDeckUserSettings: locked ignores the deck\'s limits', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 25, isOverride: true, allowHigher: false, allowLower: false,
    });
    await testDb.insert(schema.deckUserSettings).values({ userId: 1, deckId: 10, newCardsPerDay: 99, reviewsPerDay: 1 });
    const { getDeckUserSettings } = await import('./userSettings.js');
    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 25, limitRule: 'locked', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 25,
    });
  });

  it('getDeckUserSettings: an override allowing both ways is free but still names the teacher\'s values', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 25, isOverride: true, allowHigher: true, allowLower: true,
    });
    await testDb.insert(schema.deckUserSettings).values({ userId: 1, deckId: 10, newCardsPerDay: 2, reviewsPerDay: 60 });
    const { getDeckUserSettings } = await import('./userSettings.js');
    expect(await getDeckUserSettings(1, 10)).toMatchObject({
      newCardsPerDay: 2, reviewsPerDay: 60, limitRule: 'free', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 25,
    });
  });

  it('getDeckUserSettings merges deck overrides with user defaults', async () => {
    await testDb.insert(schema.userSettings).values({
      userId: 1,
      newCardsPerDay: 30,
      reviewsPerDay: 40,
      isOverride: false,
      aiEnabled: false,
      autoPlayAudio: false,
      autoPlayAudioFront: true,
      mnemonicMode: 'manual',
      locale: 'en',
    });

    await testDb.insert(schema.deckUserSettings).values({
      userId: 1,
      deckId: 10,
      newCardsPerDay: 6,
      reviewsPerDay: 8,
      aiEnabled: null,
      autoPlayAudio: true,
      autoPlayAudioFront: null,
      mnemonicMode: null,
    });

    const { getDeckUserSettings } = await import('./userSettings.js');
    const settings = await getDeckUserSettings(1, 10);

    expect(settings.newCardsPerDay).toBe(6);
    expect(settings.reviewsPerDay).toBe(8);
    expect(settings.aiEnabled).toBe(false);
    expect(settings.autoPlayAudio).toBe(true);
    expect(settings.autoPlayAudioFront).toBe(true);
    expect(settings.mnemonicMode).toBe('manual');
    expect(settings.deckAiEnabled).toBeNull();
    expect(settings.deckAutoPlayAudio).toBe(true);
  });

  it('updateDeckUserSettings upserts and deleteDeckUserSettings removes override rows', async () => {
    const { updateDeckUserSettings, deleteDeckUserSettings } = await import('./userSettings.js');

    await updateDeckUserSettings(1, 10, {
      newCardsPerDay: 4,
      reviewsPerDay: 9,
      aiEnabled: true,
      autoPlayAudio: false,
      autoPlayAudioFront: true,
      mnemonicMode: 'disabled',
    });

    const created = await testDb.query.deckUserSettings.findFirst({
      where: and(eq(schema.deckUserSettings.userId, 1), eq(schema.deckUserSettings.deckId, 10)),
    });
    expect(created).toBeTruthy();
    expect(created?.newCardsPerDay).toBe(4);

    await deleteDeckUserSettings(1, 10);
    const deleted = await testDb.query.deckUserSettings.findFirst({
      where: and(eq(schema.deckUserSettings.userId, 1), eq(schema.deckUserSettings.deckId, 10)),
    });
    expect(deleted).toBeUndefined();
  });

  describe('the deprecated mnemonic mode \'auto-non-cognate\' (v1.20.0)', () => {
    const storedModes = async () => ({
      user: (await client.execute('SELECT mnemonic_mode FROM user_settings WHERE user_id = 1')).rows[0]?.mnemonic_mode,
      deck: (await client.execute('SELECT mnemonic_mode FROM deck_user_settings WHERE user_id = 1')).rows[0]?.mnemonic_mode,
    });

    it('reads as \'manual\', for the student and for a deck override', async () => {
      // Rows as an upgraded install has them: the user's from the SQL default, the deck's saved before v1.20.0.
      await client.execute('INSERT INTO user_settings (user_id) VALUES (1)');
      await client.execute(`INSERT INTO deck_user_settings (user_id, deck_id, mnemonic_mode) VALUES (1, 10, 'auto-non-cognate')`);
      expect(await storedModes()).toEqual({ user: 'auto-non-cognate', deck: 'auto-non-cognate' });

      const { getDeckUserSettings } = await import('./userSettings.js');
      const settings = await getDeckUserSettings(1, 10);
      expect(settings.mnemonicMode).toBe('manual');
      expect(settings.deckMnemonicMode).toBe('manual');
      // The cognate switch is gone from the answer.
      expect(settings).not.toHaveProperty('showCognateScore');
      expect(settings).not.toHaveProperty('deckShowCognateScore');

      await client.execute('DELETE FROM deck_user_settings');
      expect((await getDeckUserSettings(1, 10)).mnemonicMode).toBe('manual');
      expect((await getDeckUserSettings(1, 10)).deckMnemonicMode).toBeNull();
    });

    it('is never written: a new student\'s row gets \'manual\' though the table\'s SQL default is still the legacy value', async () => {
      const { getOrCreateUserSettings, updateUserSettings, updateDeckUserSettings, updateUserSettingsAdmin } = await import('./userSettings.js');
      expect((await getOrCreateUserSettings(1)).mnemonicMode).toBe('manual');
      expect(await storedModes()).toEqual({ user: 'manual', deck: undefined });

      await client.execute('DELETE FROM user_settings');
      await updateUserSettings(1, { newCardsPerDay: 20, reviewsPerDay: 20 });
      await updateDeckUserSettings(1, 10, { newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: null });
      expect(await storedModes()).toEqual({ user: 'manual', deck: null });

      await client.execute('DELETE FROM user_settings');
      const { DEFAULT_GROUP_SETTINGS } = await import('./groupSettings.js');
      await updateUserSettingsAdmin(1, DEFAULT_GROUP_SETTINGS);
      expect((await storedModes()).user).toBe('manual');
    });
  });
});

