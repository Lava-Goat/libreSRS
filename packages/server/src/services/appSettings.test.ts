// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const originalEnv = process.env;

describe('app settings persistence', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock('../logger.js');
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
    process.env = { ...originalEnv };

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AI_ENABLED;
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.AI_PRONUNCIATION_ENABLED;
    delete process.env.AI_IMAGE_ENABLED;
    delete process.env.AI_MNEMONIC_ENABLED;
    delete process.env.AI_COGNATE_ENABLED;
    delete process.env.AI_COGNATE_MODEL;
    delete process.env.AI_MNEMONIC_MODEL;
    delete process.env.AI_IMAGE_MODEL;
    delete process.env.AI_IMAGE_QUALITY;
    delete process.env.AI_TTS_MODEL;
    // A developer's shell may export ANTHROPIC_API_KEY; it would seed the key.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TEXT_PROVIDER;
    delete process.env.ELEVENLABS_API_KEY;
    process.env.APP_SETTINGS_ENCRYPTION_KEY = 'test-app-settings-key';
  });

  afterAll(async () => {
    process.env = originalEnv;
    await client.close();
  });

  it('seeds persisted app settings from environment values on first load', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-seeded';
    process.env.OPENAI_BASE_URL = 'http://model-host:11434/v1';
    process.env.AI_PRONUNCIATION_ENABLED = 'false';
    process.env.AI_IMAGE_ENABLED = 'true';
    process.env.AI_MNEMONIC_ENABLED = 'false';
    // Read before v1.20.0; the cognate system is gone, so these seed nothing now.
    process.env.AI_COGNATE_ENABLED = 'false';
    process.env.AI_COGNATE_MODEL = 'gpt-4.1';
    process.env.AI_MNEMONIC_MODEL = 'gpt-4.1';
    process.env.AI_IMAGE_MODEL = 'gpt-image-1';
    process.env.AI_IMAGE_QUALITY = 'high';

    const { ensureAppSettings } = await import('./appSettings.js');
    const settings = await ensureAppSettings();

    expect(settings.googleClientId).toBe('google-client-id');
    expect(settings.googleClientSecret).toBe('google-client-secret');
    expect(settings.aiEnabled).toBe(true);
    expect(settings.openaiApiKey).toBe('sk-seeded');
    expect(settings.openaiBaseUrl).toBe('http://model-host:11434/v1');
    expect(settings.aiPronunciationEnabled).toBe(false);
    expect(settings.aiMnemonicEnabled).toBe(false);
    expect(Object.keys(settings).filter((key) => /cognate/i.test(key))).toEqual([]);
    expect(settings.aiMnemonicModel).toBe('gpt-4.1');
    expect(settings.aiImageModel).toBe('gpt-image-1');
    expect(settings.aiImageQuality).toBe('high');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    expect(row).toBeTruthy();
    expect(row?.openaiApiKey).not.toBe('sk-seeded');
    expect(row?.openaiApiKey?.startsWith('enc:v1:')).toBe(true);
    // The deprecated columns get their defaults, never the old env vars.
    expect(row?.aiCognateEnabled).toBe(true);
    expect(row?.aiCognateModel).toBe('heuristic-v1');
    expect(row?.aiMnemonicModel).toBe('gpt-4.1');
    expect(row?.aiImageModel).toBe('gpt-image-1');
  });

  it('updates persisted settings and keeps runtime env in sync', async () => {
    const { ensureAppSettings, updateAppSettings } = await import('./appSettings.js');
    await ensureAppSettings();

    const updated = await updateAppSettings({
      aiEnabled: true,
      openaiApiKey: 'sk-updated',
      openaiBaseUrl: 'http://inference.internal:8000/v1',
      aiPronunciationEnabled: false,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-4o',
      aiImageModel: 'gpt-image-1',
      aiImageQuality: 'medium',
    });

    expect(updated.aiEnabled).toBe(true);
    expect(updated.openaiApiKey).toBe('sk-updated');
    expect(updated.openaiBaseUrl).toBe('http://inference.internal:8000/v1');
    expect(updated.aiPronunciationEnabled).toBe(false);
    expect(updated.aiMnemonicModel).toBe('gpt-4o');
    expect(updated.aiImageModel).toBe('gpt-image-1');
    expect(updated.aiImageQuality).toBe('medium');

    expect(process.env.AI_ENABLED).toBe('true');
    expect(process.env.OPENAI_API_KEY).toBe('sk-updated');
    expect(process.env.OPENAI_BASE_URL).toBe('http://inference.internal:8000/v1');
    expect(process.env.AI_PRONUNCIATION_ENABLED).toBe('false');
    // No longer mirrored: nothing reads them.
    expect(process.env.AI_COGNATE_ENABLED).toBeUndefined();
    expect(process.env.AI_COGNATE_MODEL).toBeUndefined();
    expect(process.env.AI_MNEMONIC_MODEL).toBe('gpt-4o');
    expect(process.env.AI_IMAGE_MODEL).toBe('gpt-image-1');
    expect(process.env.AI_IMAGE_QUALITY).toBe('medium');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    expect(row?.openaiApiKey).not.toBe('sk-updated');
    expect(row?.openaiApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(row?.aiPronunciationEnabled).toBe(false);
    expect(row?.aiMnemonicModel).toBe('gpt-4o');
    expect(row?.aiImageModel).toBe('gpt-image-1');
    expect(row?.aiImageQuality).toBe('medium');
  });

  it('clears optional secrets when saved as empty values', async () => {
    const { ensureAppSettings, updateAppSettings } = await import('./appSettings.js');
    await ensureAppSettings();

    await updateAppSettings({ openaiApiKey: 'sk-temporary' });
    await updateAppSettings({ openaiApiKey: '' });

    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.openaiApiKey).toBeNull();
  });

  it('upgrades legacy plaintext secrets to encrypted storage', async () => {
    await testDb.insert(schema.appSettings).values({
      id: 1,
      googleClientId: 'legacy-client-id',
      googleClientSecret: 'legacy-google-secret',
      aiEnabled: true,
      aiProvider: 'openai',
      openaiApiKey: 'legacy-openai-key',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiPronunciationEnabled: true,
      aiImageEnabled: true,
      aiMnemonicEnabled: true,
      aiMnemonicModel: 'gpt-5.2',
      aiImageModel: 'gpt-image-1.5',
      aiImageQuality: 'low',
      aiTtsModel: 'gpt-4o-mini-tts-2025-12-15',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { getAppSettings } = await import('./appSettings.js');
    const loaded = await getAppSettings();

    expect(loaded.googleClientSecret).toBe('legacy-google-secret');
    expect(loaded.openaiApiKey).toBe('legacy-openai-key');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    expect(row?.googleClientSecret?.startsWith('enc:v1:')).toBe(true);
    expect(row?.openaiApiKey?.startsWith('enc:v1:')).toBe(true);
  });

  it('seeds a fresh database with the Anthropic key (encrypted) and the text provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-seeded-0123456789';
    process.env.AI_TEXT_PROVIDER = 'anthropic';

    const { ensureAppSettings } = await import('./appSettings.js');
    const settings = await ensureAppSettings();

    expect(settings.anthropicApiKey).toBe('sk-ant-seeded-0123456789');
    expect(settings.aiTextProvider).toBe('anthropic');
    expect(settings.aiAnthropicMnemonicModel).toBe('claude-opus-5-5');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.anthropicApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(row?.anthropicApiKey).not.toContain('sk-ant-seeded');
    expect(row?.aiTextProvider).toBe('anthropic');
  });

  it('seeds OpenAI as the text provider, with no Anthropic key, when the env has neither', async () => {
    const { ensureAppSettings } = await import('./appSettings.js');
    const settings = await ensureAppSettings();

    expect(settings.anthropicApiKey).toBeNull();
    expect(settings.aiTextProvider).toBe('openai');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.anthropicApiKey).toBeNull();
    expect(row?.aiTextProvider).toBe('openai');
    expect(row?.aiAnthropicMnemonicModel).toBe('claude-opus-5-5');
  });

  it('round-trips the Anthropic key, the text provider and both Claude models', async () => {
    const { ensureAppSettings, getAppSettings, updateAppSettings } = await import('./appSettings.js');
    await ensureAppSettings();

    const updated = await updateAppSettings({
      anthropicApiKey: '  sk-ant-roundtrip-0123456789  ',
      aiTextProvider: 'anthropic',
      aiAnthropicMnemonicModel: 'claude-sonnet-5-5',
    });

    expect(updated.anthropicApiKey).toBe('sk-ant-roundtrip-0123456789');
    expect(updated.aiTextProvider).toBe('anthropic');
    expect(updated.aiAnthropicMnemonicModel).toBe('claude-sonnet-5-5');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.anthropicApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(row?.anthropicApiKey).not.toContain('sk-ant-roundtrip');
    expect(row?.aiTextProvider).toBe('anthropic');
    expect(row?.aiAnthropicMnemonicModel).toBe('claude-sonnet-5-5');

    const reloaded = await getAppSettings();
    expect(reloaded.anthropicApiKey).toBe('sk-ant-roundtrip-0123456789');
    expect(reloaded.aiTextProvider).toBe('anthropic');
    expect(reloaded.aiAnthropicMnemonicModel).toBe('claude-sonnet-5-5');

    // AI_TEXT_PROVIDER is mirrored for parity; the key itself never reaches process.env.
    expect(process.env.AI_TEXT_PROVIDER).toBe('anthropic');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('keeps the Anthropic key when an update leaves it out, and clears it on an empty value', async () => {
    const { ensureAppSettings, updateAppSettings } = await import('./appSettings.js');
    await ensureAppSettings();

    await updateAppSettings({ anthropicApiKey: 'sk-ant-keep-0123456789' });
    const kept = await updateAppSettings({ aiMnemonicModel: 'gpt-5.6-luna' });
    expect(kept.anthropicApiKey).toBe('sk-ant-keep-0123456789');

    const cleared = await updateAppSettings({ anthropicApiKey: '   ' });
    expect(cleared.anthropicApiKey).toBeNull();

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.anthropicApiKey).toBeNull();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('keeps the three Anthropic fields through a Google-only update (setup.saveCredentials)', async () => {
    const { ensureAppSettings, updateAppSettings } = await import('./appSettings.js');
    await ensureAppSettings();
    await updateAppSettings({
      anthropicApiKey: 'sk-ant-google-0123456789',
      aiTextProvider: 'anthropic',
      aiAnthropicMnemonicModel: 'claude-sonnet-5-5',
    });

    const next = await updateAppSettings({
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-client-secret',
    });

    expect(next.anthropicApiKey).toBe('sk-ant-google-0123456789');
    expect(next.aiTextProvider).toBe('anthropic');
    expect(next.aiAnthropicMnemonicModel).toBe('claude-sonnet-5-5');
  });

  it('upgrades a legacy plaintext anthropic_api_key to encrypted storage', async () => {
    await testDb.insert(schema.appSettings).values({
      id: 1,
      aiEnabled: true,
      aiProvider: 'openai',
      openaiBaseUrl: 'https://api.openai.com/v1',
      anthropicApiKey: 'sk-ant-legacy-0123456789',
      aiTextProvider: 'anthropic',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { getAppSettings } = await import('./appSettings.js');
    const loaded = await getAppSettings();
    expect(loaded.anthropicApiKey).toBe('sk-ant-legacy-0123456789');
    expect(loaded.aiTextProvider).toBe('anthropic');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.anthropicApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(row?.anthropicApiKey).not.toContain('sk-ant-legacy');
  });

  it('never logs the plaintext Anthropic key', async () => {
    const calls: unknown[][] = [];
    const capture = (...args: unknown[]) => { calls.push(args); };
    vi.doMock('../logger.js', () => ({
      logger: { info: capture, warn: capture, debug: capture, error: capture },
    }));
    const secret = 'sk-ant-never-logged-0123456789';
    process.env.ANTHROPIC_API_KEY = secret;

    const { ensureAppSettings, getAppSettings, loadAppSettingsIntoProcessEnv, updateAppSettings } =
      await import('./appSettings.js');
    await ensureAppSettings();
    await updateAppSettings({ anthropicApiKey: secret, aiTextProvider: 'anthropic' });
    await getAppSettings();
    await loadAppSettingsIntoProcessEnv();
    // A legacy plaintext row goes through the upgrade path's logs too.
    await testDb.update(schema.appSettings).set({ anthropicApiKey: secret }).run();
    await getAppSettings();

    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain(secret);
    expect(JSON.stringify(calls)).toContain('"hasAnthropicApiKey":true');
  });

  it('rejects a known SESSION_SECRET as the encryption source in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_SETTINGS_ENCRYPTION_KEY;
    process.env.SESSION_SECRET = 'change-me-in-production';

    const { updateAppSettings } = await import('./appSettings.js');

    await expect(updateAppSettings({ openaiApiKey: 'sk-prod' }))
      .rejects
      .toThrow(/SESSION_SECRET/);
  });

  it('rejects a known APP_SETTINGS_ENCRYPTION_KEY in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_SETTINGS_ENCRYPTION_KEY = 'dev-secret-change-in-production';
    process.env.SESSION_SECRET = 'strong-session-secret';

    const { updateAppSettings } = await import('./appSettings.js');

    await expect(updateAppSettings({ openaiApiKey: 'sk-prod' }))
      .rejects
      .toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);
  });
});
