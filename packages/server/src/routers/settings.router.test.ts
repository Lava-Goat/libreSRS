// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { Request, Response } from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const user = {
  id: 1,
  googleId: 'u1',
  email: 'user@example.com',
  name: 'User',
  picture: null,
  role: 'user' as const,
};

const mockGetOrCreateUserSettings = vi.fn();
const mockUpdateUserSettings = vi.fn();
const mockGetDeckUserSettings = vi.fn();
const mockUpdateDeckUserSettings = vi.fn();
const mockDeleteDeckUserSettings = vi.fn();
const mockAssertDeckAccess = vi.fn();
const mockGetDeckLanguages = vi.fn(() => ({ sourceLanguage: 'es', targetLanguage: 'en' }));

async function loadSettingsRouter() {
  vi.resetModules();
  vi.doMock('../services/userSettings.js', () => ({
    getOrCreateUserSettings: mockGetOrCreateUserSettings,
    updateUserSettings: mockUpdateUserSettings,
    getDeckUserSettings: mockGetDeckUserSettings,
    updateDeckUserSettings: mockUpdateDeckUserSettings,
    deleteDeckUserSettings: mockDeleteDeckUserSettings,
  }));
  vi.doMock('../services/deckAccess.js', () => ({
    assertDeckAccess: mockAssertDeckAccess,
  }));
  vi.doMock('../services/deckLanguages.js', () => ({
    getDeckLanguages: mockGetDeckLanguages,
  }));
  return (await import('./settings.js')).settingsRouter;
}

function createCaller(settingsRouter: Awaited<ReturnType<typeof loadSettingsRouter>>) {
  return settingsRouter.createCaller({
    req: { user } as Request,
    res: {} as Response,
    user,
    requestId: 'settings-test',
  });
}

describe('settingsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get maps nullable values to client defaults', async () => {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const updatedAt = new Date('2026-02-02T00:00:00.000Z');
    mockGetOrCreateUserSettings.mockResolvedValue({
      userId: 1,
      newCardsPerDay: 25,
      reviewsPerDay: 35,
      aiEnabled: null,
      aiEnabledLocked: null,
      autoPlayAudio: null,
      autoPlayAudioLocked: null,
      autoPlayAudioFront: null,
      autoPlayAudioFrontLocked: null,
      mnemonicMode: null,
      mnemonicModeLocked: null,
      locale: null,
      localeLocked: null,
      createdAt,
      updatedAt,
    });

    const settingsRouter = await loadSettingsRouter();
    const caller = createCaller(settingsRouter);
    const result = await caller.get();

    expect(result).toMatchObject({
      userId: 1,
      newCardsPerDay: 25,
      reviewsPerDay: 35,
      aiEnabled: true,
      aiEnabledLocked: false,
      autoPlayAudio: false,
      autoPlayAudioLocked: false,
      autoPlayAudioFront: false,
      autoPlayAudioFrontLocked: false,
      mnemonicMode: 'manual',
      mnemonicModeLocked: false,
      locale: null,
      localeLocked: false,
      createdAt,
      updatedAt,
    });
  });

  it('get reads a stored \'auto-non-cognate\' (deprecated in v1.20.0) as \'manual\'', async () => {
    mockGetOrCreateUserSettings.mockResolvedValue({
      userId: 1, newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: 'auto-non-cognate',
    });
    const result = await createCaller(await loadSettingsRouter()).get();
    expect(result.mnemonicMode).toBe('manual');
    // The cognate switch is gone from the answer.
    expect(result).not.toHaveProperty('showCognateScore');
    expect(result).not.toHaveProperty('showCognateScoreLocked');
  });

  it('takes \'auto-non-cognate\' from a page loaded before v1.20.0 but saves \'manual\', and drops its showCognateScore', async () => {
    mockUpdateUserSettings.mockResolvedValue({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: 'manual' });
    mockUpdateDeckUserSettings.mockResolvedValue({ userId: 1, deckId: 7 });
    mockGetDeckUserSettings.mockResolvedValue({ userId: 1, deckId: 7 });
    const caller = createCaller(await loadSettingsRouter());

    const oldPage = { newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: 'auto-non-cognate' as const, showCognateScore: true };
    await caller.update(oldPage as Parameters<typeof caller.update>[0]);
    expect(mockUpdateUserSettings).toHaveBeenCalledWith(1, { newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: 'manual' });

    await caller.updateDeckSettings({ deckId: 7, ...oldPage } as Parameters<typeof caller.updateDeckSettings>[0]);
    expect(mockUpdateDeckUserSettings).toHaveBeenCalledWith(1, 7, expect.objectContaining({ mnemonicMode: 'manual' }));
    expect(mockUpdateDeckUserSettings.mock.calls[0][2]).not.toHaveProperty('showCognateScore');

    await expect(caller.update({ newCardsPerDay: 20, reviewsPerDay: 20, mnemonicMode: 'sometimes' as 'manual' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('get reports the teacher\'s lock on the daily limits', async () => {
    mockGetOrCreateUserSettings.mockResolvedValue({
      userId: 1,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      isOverride: true,
      allowHigher: true,
      allowLower: false,
    });

    const caller = createCaller(await loadSettingsRouter());
    expect(await caller.get()).toMatchObject({
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      limitsLocked: true,
      limitsAllowHigher: true,
      limitsAllowLower: false,
    });
  });

  it('get defaults the lock flags to unlocked when the row has none', async () => {
    mockGetOrCreateUserSettings.mockResolvedValue({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 20 });

    const caller = createCaller(await loadSettingsRouter());
    expect(await caller.get()).toMatchObject({
      limitsLocked: false,
      limitsAllowHigher: true,
      limitsAllowLower: true,
    });
  });

  it('update forwards payload to updateUserSettings and returns mapped result', async () => {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const updatedAt = new Date('2026-02-02T00:00:00.000Z');
    mockUpdateUserSettings.mockResolvedValue({
      userId: 1,
      newCardsPerDay: 10,
      reviewsPerDay: 20,
      aiEnabled: false,
      aiEnabledLocked: true,
      autoPlayAudio: true,
      autoPlayAudioLocked: true,
      autoPlayAudioFront: false,
      autoPlayAudioFrontLocked: true,
      mnemonicMode: 'manual',
      mnemonicModeLocked: true,
      locale: 'es',
      localeLocked: true,
      createdAt,
      updatedAt,
    });

    const settingsRouter = await loadSettingsRouter();
    const caller = createCaller(settingsRouter);

    const input = {
      newCardsPerDay: 10,
      reviewsPerDay: 20,
      aiEnabled: false,
      autoPlayAudio: true,
      autoPlayAudioFront: false,
      mnemonicMode: 'manual' as const,
      locale: 'es',
    };
    const result = await caller.update(input);

    expect(mockUpdateUserSettings).toHaveBeenCalledWith(1, input);
    expect(result.mnemonicMode).toBe('manual');
    expect(result.locale).toBe('es');
  });

  it('getDeckSettings asserts access before returning deck settings, with the deck\'s languages', async () => {
    mockGetDeckUserSettings.mockResolvedValue({ deckId: 5, userId: 1 });

    const settingsRouter = await loadSettingsRouter();
    const caller = createCaller(settingsRouter);
    const result = await caller.getDeckSettings({ deckId: 5 });

    expect(mockAssertDeckAccess).toHaveBeenCalledWith(1, 5);
    expect(mockGetDeckLanguages).toHaveBeenCalledWith(5);
    expect(result).toEqual({ deckId: 5, userId: 1, sourceLanguage: 'es', targetLanguage: 'en' });
  });

  it('updateDeckSettings normalizes nullish overrides and returns effective settings', async () => {
    mockUpdateDeckUserSettings.mockResolvedValue({ userId: 1, deckId: 7 });
    mockGetDeckUserSettings.mockResolvedValue({ userId: 1, deckId: 7, aiEnabled: true });

    const settingsRouter = await loadSettingsRouter();
    const caller = createCaller(settingsRouter);
    const result = await caller.updateDeckSettings({
      deckId: 7,
      newCardsPerDay: 11,
      reviewsPerDay: 22,
    });

    expect(mockAssertDeckAccess).toHaveBeenCalledWith(1, 7);
    expect(mockUpdateDeckUserSettings).toHaveBeenCalledWith(1, 7, {
      newCardsPerDay: 11,
      reviewsPerDay: 22,
      aiEnabled: null,
      autoPlayAudio: null,
      autoPlayAudioFront: null,
      mnemonicMode: null,
    });
    expect(result).toEqual({ userId: 1, deckId: 7, aiEnabled: true, sourceLanguage: 'es', targetLanguage: 'en' });
  });

  it('resetDeckSettings deletes override and returns fallback settings', async () => {
    mockGetDeckUserSettings.mockResolvedValue({
      userId: 1,
      deckId: 12,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
    });

    const settingsRouter = await loadSettingsRouter();
    const caller = createCaller(settingsRouter);
    const result = await caller.resetDeckSettings({ deckId: 12 });

    expect(mockAssertDeckAccess).toHaveBeenCalledWith(1, 12);
    expect(mockDeleteDeckUserSettings).toHaveBeenCalledWith(1, 12);
    expect(result).toEqual({
      userId: 1,
      deckId: 12,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      sourceLanguage: 'es',
      targetLanguage: 'en',
    });
  });
});

/** The real settings service on a test database: what a student's deck form is told. */
describe('settingsRouter limit rules (real service)', () => {
  const { client, db: testDb } = createTestDb();

  async function loadRealSettingsRouter() {
    vi.resetModules();
    vi.doUnmock('../services/userSettings.js');
    vi.doUnmock('../services/deckLanguages.js');
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/deckAccess.js', () => ({ assertDeckAccess: mockAssertDeckAccess }));
    return (await import('./settings.js')).settingsRouter;
  }

  async function teacherSets(lock: { isOverride: boolean; allowHigher: boolean; allowLower: boolean }) {
    await testDb.insert(schema.userSettings).values({ userId: 1, newCardsPerDay: 20, reviewsPerDay: 20, ...lock });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values({ id: 1, googleId: 'u1', email: 'user@example.com', name: 'User' });
    await testDb.insert(schema.decks).values({ id: 5, name: 'Deck 5', createdBy: 1 });
  });

  afterAll(async () => {
    await client.close();
  });

  it('a deck\'s settings carry its two languages (front, back), null when the deck has none, after a save and a reset too', async () => {
    await testDb.insert(schema.decks).values({ id: 6, name: 'Spanish', createdBy: 1, sourceLanguage: 'es', targetLanguage: 'en' });
    const caller = createCaller(await loadRealSettingsRouter());

    expect(await caller.getDeckSettings({ deckId: 6 })).toMatchObject({ deckId: 6, sourceLanguage: 'es', targetLanguage: 'en' });
    expect(await caller.getDeckSettings({ deckId: 5 })).toMatchObject({ deckId: 5, sourceLanguage: null, targetLanguage: null });
    expect(await caller.updateDeckSettings({ deckId: 6, newCardsPerDay: 3, reviewsPerDay: 90 })).toMatchObject({
      sourceLanguage: 'es', targetLanguage: 'en',
    });
    expect(await caller.resetDeckSettings({ deckId: 6 })).toMatchObject({ sourceLanguage: 'es', targetLanguage: 'en' });
  });

  it('no override: free, no teacher values, and the student\'s own limits save', async () => {
    const caller = createCaller(await loadRealSettingsRouter());
    expect(await caller.get()).toMatchObject({ limitsLocked: false });
    const saved = await caller.updateDeckSettings({ deckId: 5, newCardsPerDay: 3, reviewsPerDay: 90 });
    expect(saved).toMatchObject({
      newCardsPerDay: 3, reviewsPerDay: 90, limitRule: 'free', teacherNewCardsPerDay: null, teacherReviewsPerDay: null,
    });
  });

  it('higher-only: the deck can go above the teacher\'s 20, never below', async () => {
    await teacherSets({ isOverride: true, allowHigher: true, allowLower: false });
    const caller = createCaller(await loadRealSettingsRouter());

    expect(await caller.get()).toMatchObject({ limitsLocked: true, limitsAllowHigher: true, limitsAllowLower: false });
    expect(await caller.getDeckSettings({ deckId: 5 })).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 20, limitRule: 'higher', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 20,
    });
    expect(await caller.updateDeckSettings({ deckId: 5, newCardsPerDay: 35, reviewsPerDay: 5 })).toMatchObject({
      newCardsPerDay: 35, reviewsPerDay: 20, limitRule: 'higher',
    });
    // The global form cannot move the teacher's value either.
    expect(await caller.update({ newCardsPerDay: 1, reviewsPerDay: 1 })).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 20, limitsLocked: true,
    });
  });

  it('lower-only: the deck can go below the teacher\'s 20, never above', async () => {
    await teacherSets({ isOverride: true, allowHigher: false, allowLower: true });
    const caller = createCaller(await loadRealSettingsRouter());

    expect(await caller.updateDeckSettings({ deckId: 5, newCardsPerDay: 8, reviewsPerDay: 80 })).toMatchObject({
      newCardsPerDay: 8, reviewsPerDay: 20, limitRule: 'lower', teacherNewCardsPerDay: 20, teacherReviewsPerDay: 20,
    });
  });

  it('locked: the deck keeps the teacher\'s values whatever it sends; reset returns them', async () => {
    await teacherSets({ isOverride: true, allowHigher: false, allowLower: false });
    const caller = createCaller(await loadRealSettingsRouter());

    expect(await caller.updateDeckSettings({ deckId: 5, newCardsPerDay: 99, reviewsPerDay: 0, aiEnabled: false })).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 20, limitRule: 'locked', deckAiEnabled: false,
    });
    expect(await caller.resetDeckSettings({ deckId: 5 })).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 20, limitRule: 'locked', deckAiEnabled: null,
    });
  });
});
