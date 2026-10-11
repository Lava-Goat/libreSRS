// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import { RECOMMENDED_ANTHROPIC_MODELS, RECOMMENDED_MODELS } from './ai/aiTemplates.js';
import { invalidateAiRuntimeConfigCache } from './ai/config.js';
import { assertNoKnownInsecureSecretInProduction } from '../utils/secrets.js';

const APP_SETTINGS_ROW_ID = 1;
const SECRET_PREFIX = 'enc:v1';
const DEFAULT_DEV_SECRET = 'dev-secret-change-in-production';

export const DEFAULT_APP_SETTINGS = {
  aiEnabled: false,
  aiProvider: 'openai',
  openaiBaseUrl: 'https://api.openai.com/v1',
  aiPronunciationEnabled: true,
  aiImageEnabled: true,
  aiMnemonicEnabled: true,
  aiMnemonicModel: RECOMMENDED_MODELS.mnemonic,
  aiImageModel: RECOMMENDED_MODELS.image,
  aiImageQuality: RECOMMENDED_MODELS.imageQuality,
  aiTtsModel: RECOMMENDED_MODELS.tts,
  aiTtsProvider: 'openai',
  aiTtsVoiceMap: '{}',
  aiTextProvider: 'openai',
  aiAnthropicMnemonicModel: RECOMMENDED_ANTHROPIC_MODELS.mnemonic,
} as const;

export type AppSettings = {
  googleClientId: string | null;
  googleClientSecret: string | null;
  cleverClientId: string | null;
  cleverClientSecret: string | null;
  aiEnabled: boolean;
  aiProvider: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  aiPronunciationEnabled: boolean;
  aiImageEnabled: boolean;
  aiMnemonicEnabled: boolean;
  aiMnemonicModel: string;
  aiImageModel: string;
  aiImageQuality: string;
  aiTtsModel: string;
  aiTtsProvider: string;
  elevenlabsApiKey: string | null;
  /** JSON object string mapping accent name -> ElevenLabs voice_id ('' = default voice). */
  aiTtsVoiceMap: string;
  /** ElevenLabs voice_id for the Vocabulómetro's default accent (null = the map's default). */
  vocabTtsVoiceId: string | null;
  /** Claude, for mnemonic suggestions only (stored encrypted). */
  anthropicApiKey: string | null;
  /** Who writes mnemonic suggestions: 'openai' | 'anthropic'. */
  aiTextProvider: string;
  /** The Claude model used while aiTextProvider is 'anthropic'. */
  aiAnthropicMnemonicModel: string;
};

export type AppSettingsUpdate = {
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  cleverClientId?: string | null;
  cleverClientSecret?: string | null;
  aiEnabled?: boolean;
  aiProvider?: string;
  openaiApiKey?: string | null;
  openaiBaseUrl?: string;
  aiPronunciationEnabled?: boolean;
  aiImageEnabled?: boolean;
  aiMnemonicEnabled?: boolean;
  aiMnemonicModel?: string;
  aiImageModel?: string;
  aiImageQuality?: string;
  aiTtsModel?: string;
  aiTtsProvider?: string;
  elevenlabsApiKey?: string | null;
  aiTtsVoiceMap?: string;
  vocabTtsVoiceId?: string | null;
  anthropicApiKey?: string | null;
  aiTextProvider?: string;
  aiAnthropicMnemonicModel?: string;
};

function summarizeSettings(settings: AppSettings): Record<string, unknown> {
  return {
    aiEnabled: settings.aiEnabled,
    aiProvider: settings.aiProvider,
    openaiBaseUrl: settings.openaiBaseUrl,
    aiPronunciationEnabled: settings.aiPronunciationEnabled,
    aiImageEnabled: settings.aiImageEnabled,
    aiMnemonicEnabled: settings.aiMnemonicEnabled,
    aiMnemonicModel: settings.aiMnemonicModel,
    aiImageModel: settings.aiImageModel,
    aiImageQuality: settings.aiImageQuality,
    aiTtsModel: settings.aiTtsModel,
    aiTtsProvider: settings.aiTtsProvider,
    hasElevenLabsApiKey: Boolean(settings.elevenlabsApiKey),
    vocabTtsVoiceId: settings.vocabTtsVoiceId,
    aiTextProvider: settings.aiTextProvider,
    aiAnthropicMnemonicModel: settings.aiAnthropicMnemonicModel,
    hasAnthropicApiKey: Boolean(settings.anthropicApiKey),
    hasGoogleClientId: Boolean(settings.googleClientId),
    hasGoogleClientSecret: Boolean(settings.googleClientSecret),
    hasCleverClientId: Boolean(settings.cleverClientId),
    hasCleverClientSecret: Boolean(settings.cleverClientSecret),
    hasOpenAiApiKey: Boolean(settings.openaiApiKey),
  };
}

function summarizeUpdates(updates: AppSettingsUpdate): Record<string, unknown> {
  const updateKeys = Object.entries(updates)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();

  return {
    updateKeys,
    touchesGoogleClientId: updates.googleClientId !== undefined,
    touchesGoogleClientSecret: updates.googleClientSecret !== undefined,
    touchesCleverClientId: updates.cleverClientId !== undefined,
    touchesCleverClientSecret: updates.cleverClientSecret !== undefined,
    touchesOpenAiApiKey: updates.openaiApiKey !== undefined,
    touchesElevenLabsApiKey: updates.elevenlabsApiKey !== undefined,
    touchesAnthropicApiKey: updates.anthropicApiKey !== undefined,
  };
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredString(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function getEncryptionKey(): Buffer {
  const appSettingsKey = process.env.APP_SETTINGS_ENCRYPTION_KEY?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  const source = appSettingsKey || sessionSecret || DEFAULT_DEV_SECRET;
  const sourceName = appSettingsKey
    ? 'APP_SETTINGS_ENCRYPTION_KEY'
    : (sessionSecret ? 'SESSION_SECRET' : 'APP_SETTINGS_ENCRYPTION_KEY/SESSION_SECRET');

  assertNoKnownInsecureSecretInProduction(sourceName, source);

  return createHash('sha256').update(source, 'utf8').digest();
}

function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${SECRET_PREFIX}:`);
}

function encryptSecret(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (isEncryptedSecret(value)) {
    return value;
  }

  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    SECRET_PREFIX,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function decryptSecret(value: string | null, fieldName: string): string | null {
  if (!value) {
    return null;
  }

  if (!isEncryptedSecret(value)) {
    return value;
  }

  const parts = value.split(':');
  if (parts.length !== 5) {
    throw new Error(`Invalid encrypted value format for ${fieldName}`);
  }

  const [, , ivPart, tagPart, payloadPart] = parts;
  const key = getEncryptionKey();

  const iv = Buffer.from(ivPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');
  const payload = Buffer.from(payloadPart, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Seals a secret for storing in the database as the app settings' own keys are (AES-256-GCM,
 * keyed from APP_SETTINGS_ENCRYPTION_KEY or SESSION_SECRET), and opens one again. A value already
 * sealed is returned as it is; an empty one is null. Rotating the key means re-entering (or
 * re-sealing) every value sealed with the old one, wherever it is stored.
 */
export const sealSecret = (value: string | null): string | null => encryptSecret(value);
export const openSecret = (value: string | null, fieldName: string): string | null => decryptSecret(value, fieldName);

function parseBooleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

function readAppSettingsFromEnv(): AppSettings {
  const settings = {
    googleClientId: normalizeOptionalString(process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: normalizeOptionalString(process.env.GOOGLE_CLIENT_SECRET),
    cleverClientId: normalizeOptionalString(process.env.CLEVER_CLIENT_ID),
    cleverClientSecret: normalizeOptionalString(process.env.CLEVER_CLIENT_SECRET),
    aiEnabled: parseBooleanFromEnv(process.env.AI_ENABLED, DEFAULT_APP_SETTINGS.aiEnabled),
    aiProvider: normalizeRequiredString(process.env.AI_PROVIDER, DEFAULT_APP_SETTINGS.aiProvider),
    openaiApiKey: normalizeOptionalString(process.env.OPENAI_API_KEY),
    openaiBaseUrl: normalizeRequiredString(process.env.OPENAI_BASE_URL, DEFAULT_APP_SETTINGS.openaiBaseUrl),
    aiPronunciationEnabled: parseBooleanFromEnv(
      process.env.AI_PRONUNCIATION_ENABLED,
      DEFAULT_APP_SETTINGS.aiPronunciationEnabled
    ),
    aiImageEnabled: parseBooleanFromEnv(
      process.env.AI_IMAGE_ENABLED,
      DEFAULT_APP_SETTINGS.aiImageEnabled
    ),
    aiMnemonicEnabled: parseBooleanFromEnv(
      process.env.AI_MNEMONIC_ENABLED,
      DEFAULT_APP_SETTINGS.aiMnemonicEnabled
    ),
    aiMnemonicModel: normalizeRequiredString(process.env.AI_MNEMONIC_MODEL, DEFAULT_APP_SETTINGS.aiMnemonicModel),
    aiImageModel: normalizeRequiredString(process.env.AI_IMAGE_MODEL, DEFAULT_APP_SETTINGS.aiImageModel),
    aiImageQuality: normalizeRequiredString(process.env.AI_IMAGE_QUALITY, DEFAULT_APP_SETTINGS.aiImageQuality),
    aiTtsModel: normalizeRequiredString(process.env.AI_TTS_MODEL, DEFAULT_APP_SETTINGS.aiTtsModel),
    aiTtsProvider: normalizeRequiredString(process.env.AI_TTS_PROVIDER, DEFAULT_APP_SETTINGS.aiTtsProvider),
    elevenlabsApiKey: normalizeOptionalString(process.env.ELEVENLABS_API_KEY),
    aiTtsVoiceMap: normalizeRequiredString(process.env.AI_TTS_VOICE_MAP, DEFAULT_APP_SETTINGS.aiTtsVoiceMap),
    // Seeds a fresh install only: once a settings row exists it wins, and the
    // voice comes from the admin picker.
    vocabTtsVoiceId: normalizeOptionalString(process.env.VOCAB_TTS_VOICE_ID),
    // Also a fresh install only (existing installs paste the key in Admin > AI). There is no
    // env var for the Claude model: the column default applies.
    anthropicApiKey: normalizeOptionalString(process.env.ANTHROPIC_API_KEY),
    aiTextProvider: normalizeRequiredString(process.env.AI_TEXT_PROVIDER, DEFAULT_APP_SETTINGS.aiTextProvider),
    aiAnthropicMnemonicModel: DEFAULT_APP_SETTINGS.aiAnthropicMnemonicModel,
  };

  logger.info({
    event: 'app_settings.read_from_env',
    ...summarizeSettings(settings),
  }, 'Read app settings from process environment');
  return settings;
}

function rowToSettings(row: typeof schema.appSettings.$inferSelect | null | undefined): AppSettings {
  if (!row) {
    return readAppSettingsFromEnv();
  }

  return {
    googleClientId: normalizeOptionalString(row.googleClientId),
    googleClientSecret: normalizeOptionalString(decryptSecret(row.googleClientSecret, 'google_client_secret')),
    cleverClientId: normalizeOptionalString(row.cleverClientId),
    cleverClientSecret: normalizeOptionalString(decryptSecret(row.cleverClientSecret, 'clever_client_secret')),
    aiEnabled: row.aiEnabled ?? DEFAULT_APP_SETTINGS.aiEnabled,
    aiProvider: normalizeRequiredString(row.aiProvider, DEFAULT_APP_SETTINGS.aiProvider),
    openaiApiKey: normalizeOptionalString(decryptSecret(row.openaiApiKey, 'openai_api_key')),
    openaiBaseUrl: normalizeRequiredString(row.openaiBaseUrl, DEFAULT_APP_SETTINGS.openaiBaseUrl),
    aiPronunciationEnabled: row.aiPronunciationEnabled ?? DEFAULT_APP_SETTINGS.aiPronunciationEnabled,
    aiImageEnabled: row.aiImageEnabled ?? DEFAULT_APP_SETTINGS.aiImageEnabled,
    aiMnemonicEnabled: row.aiMnemonicEnabled ?? DEFAULT_APP_SETTINGS.aiMnemonicEnabled,
    aiMnemonicModel: normalizeRequiredString(row.aiMnemonicModel, DEFAULT_APP_SETTINGS.aiMnemonicModel),
    aiImageModel: normalizeRequiredString(row.aiImageModel, DEFAULT_APP_SETTINGS.aiImageModel),
    aiImageQuality: normalizeRequiredString(row.aiImageQuality, DEFAULT_APP_SETTINGS.aiImageQuality),
    aiTtsModel: normalizeRequiredString(row.aiTtsModel, DEFAULT_APP_SETTINGS.aiTtsModel),
    aiTtsProvider: normalizeRequiredString(row.aiTtsProvider, DEFAULT_APP_SETTINGS.aiTtsProvider),
    elevenlabsApiKey: normalizeOptionalString(decryptSecret(row.elevenlabsApiKey, 'elevenlabs_api_key')),
    aiTtsVoiceMap: normalizeRequiredString(row.aiTtsVoiceMap, DEFAULT_APP_SETTINGS.aiTtsVoiceMap),
    vocabTtsVoiceId: normalizeOptionalString(row.vocabTtsVoiceId),
    anthropicApiKey: normalizeOptionalString(decryptSecret(row.anthropicApiKey, 'anthropic_api_key')),
    aiTextProvider: normalizeRequiredString(row.aiTextProvider, DEFAULT_APP_SETTINGS.aiTextProvider),
    aiAnthropicMnemonicModel: normalizeRequiredString(
      row.aiAnthropicMnemonicModel,
      DEFAULT_APP_SETTINGS.aiAnthropicMnemonicModel
    ),
  };
}

function toDbValues(settings: AppSettings) {
  return {
    googleClientId: settings.googleClientId,
    googleClientSecret: encryptSecret(settings.googleClientSecret),
    cleverClientId: settings.cleverClientId,
    cleverClientSecret: encryptSecret(settings.cleverClientSecret),
    aiEnabled: settings.aiEnabled,
    aiProvider: settings.aiProvider,
    openaiApiKey: encryptSecret(settings.openaiApiKey),
    openaiBaseUrl: settings.openaiBaseUrl,
    aiPronunciationEnabled: settings.aiPronunciationEnabled,
    aiImageEnabled: settings.aiImageEnabled,
    aiMnemonicEnabled: settings.aiMnemonicEnabled,
    aiMnemonicModel: settings.aiMnemonicModel,
    aiImageModel: settings.aiImageModel,
    aiImageQuality: settings.aiImageQuality,
    aiTtsModel: settings.aiTtsModel,
    aiTtsProvider: settings.aiTtsProvider,
    elevenlabsApiKey: encryptSecret(settings.elevenlabsApiKey),
    aiTtsVoiceMap: settings.aiTtsVoiceMap,
    vocabTtsVoiceId: settings.vocabTtsVoiceId,
    anthropicApiKey: encryptSecret(settings.anthropicApiKey),
    aiTextProvider: settings.aiTextProvider,
    aiAnthropicMnemonicModel: settings.aiAnthropicMnemonicModel,
  };
}

async function getStoredAppSettingsRow() {
  return db.query.appSettings.findFirst({
    where: eq(schema.appSettings.id, APP_SETTINGS_ROW_ID),
  });
}

async function upgradeLegacySecretsIfNeeded(row: typeof schema.appSettings.$inferSelect) {
  const needsGoogleSecretUpgrade = Boolean(row.googleClientSecret && !isEncryptedSecret(row.googleClientSecret));
  const needsOpenAiKeyUpgrade = Boolean(row.openaiApiKey && !isEncryptedSecret(row.openaiApiKey));
  const needsCleverSecretUpgrade = Boolean(row.cleverClientSecret && !isEncryptedSecret(row.cleverClientSecret));
  const needsElevenLabsKeyUpgrade = Boolean(row.elevenlabsApiKey && !isEncryptedSecret(row.elevenlabsApiKey));
  const needsAnthropicKeyUpgrade = Boolean(row.anthropicApiKey && !isEncryptedSecret(row.anthropicApiKey));

  if (
    !needsGoogleSecretUpgrade
    && !needsOpenAiKeyUpgrade
    && !needsCleverSecretUpgrade
    && !needsElevenLabsKeyUpgrade
    && !needsAnthropicKeyUpgrade
  ) {
    return row;
  }

  logger.warn({
    event: 'app_settings.upgrade_legacy_secrets.start',
    needsGoogleSecretUpgrade,
    needsOpenAiKeyUpgrade,
    needsCleverSecretUpgrade,
    needsElevenLabsKeyUpgrade,
    needsAnthropicKeyUpgrade,
  }, 'Upgrading legacy plaintext secrets in app settings');

  await db.update(schema.appSettings)
    .set({
      googleClientSecret: needsGoogleSecretUpgrade
        ? encryptSecret(row.googleClientSecret)
        : row.googleClientSecret,
      openaiApiKey: needsOpenAiKeyUpgrade
        ? encryptSecret(row.openaiApiKey)
        : row.openaiApiKey,
      cleverClientSecret: needsCleverSecretUpgrade
        ? encryptSecret(row.cleverClientSecret)
        : row.cleverClientSecret,
      elevenlabsApiKey: needsElevenLabsKeyUpgrade
        ? encryptSecret(row.elevenlabsApiKey)
        : row.elevenlabsApiKey,
      anthropicApiKey: needsAnthropicKeyUpgrade
        ? encryptSecret(row.anthropicApiKey)
        : row.anthropicApiKey,
      updatedAt: new Date(),
    })
    .where(eq(schema.appSettings.id, APP_SETTINGS_ROW_ID));

  const upgraded = await getStoredAppSettingsRow();
  logger.info({
    event: 'app_settings.upgrade_legacy_secrets.finish',
    upgradedGoogleSecret: needsGoogleSecretUpgrade,
    upgradedOpenAiKey: needsOpenAiKeyUpgrade,
    upgradedCleverSecret: needsCleverSecretUpgrade,
    upgradedElevenLabsKey: needsElevenLabsKeyUpgrade,
    upgradedAnthropicKey: needsAnthropicKeyUpgrade,
  }, 'Completed app settings secret upgrade');
  return upgraded ?? row;
}

export function applyAppSettingsToProcessEnv(settings: AppSettings): void {
  process.env.AI_ENABLED = settings.aiEnabled ? 'true' : 'false';
  process.env.AI_PROVIDER = settings.aiProvider;
  process.env.OPENAI_BASE_URL = settings.openaiBaseUrl;
  process.env.AI_PRONUNCIATION_ENABLED = settings.aiPronunciationEnabled ? 'true' : 'false';
  process.env.AI_IMAGE_ENABLED = settings.aiImageEnabled ? 'true' : 'false';
  process.env.AI_MNEMONIC_ENABLED = settings.aiMnemonicEnabled ? 'true' : 'false';
  process.env.AI_MNEMONIC_MODEL = settings.aiMnemonicModel;
  process.env.AI_IMAGE_MODEL = settings.aiImageModel;
  process.env.AI_IMAGE_QUALITY = settings.aiImageQuality;
  process.env.AI_TTS_MODEL = settings.aiTtsModel;

  if (settings.openaiApiKey) {
    process.env.OPENAI_API_KEY = settings.openaiApiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  process.env.AI_TTS_PROVIDER = settings.aiTtsProvider;
  process.env.AI_TTS_VOICE_MAP = settings.aiTtsVoiceMap;
  if (settings.vocabTtsVoiceId) {
    process.env.VOCAB_TTS_VOICE_ID = settings.vocabTtsVoiceId;
  } else {
    delete process.env.VOCAB_TTS_VOICE_ID;
  }
  if (settings.elevenlabsApiKey) {
    process.env.ELEVENLABS_API_KEY = settings.elevenlabsApiKey;
  } else {
    delete process.env.ELEVENLABS_API_KEY;
  }
  process.env.AI_TEXT_PROVIDER = settings.aiTextProvider;
  // The Anthropic key is never mirrored into process.env: nothing reads it there, and the child
  // processes services/anki.ts spawns would inherit it.

  if (settings.googleClientId) {
    process.env.GOOGLE_CLIENT_ID = settings.googleClientId;
  } else {
    delete process.env.GOOGLE_CLIENT_ID;
  }

  if (settings.googleClientSecret) {
    process.env.GOOGLE_CLIENT_SECRET = settings.googleClientSecret;
  } else {
    delete process.env.GOOGLE_CLIENT_SECRET;
  }

  if (settings.cleverClientId) {
    process.env.CLEVER_CLIENT_ID = settings.cleverClientId;
  } else {
    delete process.env.CLEVER_CLIENT_ID;
  }

  if (settings.cleverClientSecret) {
    process.env.CLEVER_CLIENT_SECRET = settings.cleverClientSecret;
  } else {
    delete process.env.CLEVER_CLIENT_SECRET;
  }

  logger.info({
    event: 'app_settings.apply_to_env',
    ...summarizeSettings(settings),
  }, 'Applied app settings to process environment');
}

export async function getAppSettings(): Promise<AppSettings> {
  const row = await getStoredAppSettingsRow();
  const normalizedRow = row ? await upgradeLegacySecretsIfNeeded(row) : null;
  const settings = rowToSettings(normalizedRow);
  logger.debug({
    event: 'app_settings.get',
    source: row ? 'database' : 'environment',
    ...summarizeSettings(settings),
  }, 'Loaded app settings');
  return settings;
}

export async function ensureAppSettings(): Promise<AppSettings> {
  const existing = await getStoredAppSettingsRow();
  if (existing) {
    const upgradedExisting = await upgradeLegacySecretsIfNeeded(existing);
    const settings = rowToSettings(upgradedExisting);
    logger.info({
      event: 'app_settings.ensure.existing',
      ...summarizeSettings(settings),
    }, 'Using existing app settings');
    return settings;
  }

  logger.info({
    event: 'app_settings.ensure.seeding',
  }, 'No app settings row found; seeding from environment');
  const seededFromEnv = readAppSettingsFromEnv();
  const now = new Date();

  await db.insert(schema.appSettings).values({
    id: APP_SETTINGS_ROW_ID,
    ...toDbValues(seededFromEnv),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  const inserted = await getStoredAppSettingsRow();
  const settings = rowToSettings(inserted ?? null);
  logger.info({
    event: 'app_settings.ensure.seeded',
    ...summarizeSettings(settings),
  }, 'Seeded app settings from environment');
  return settings;
}

export async function updateAppSettings(updates: AppSettingsUpdate): Promise<AppSettings> {
  logger.info({
    event: 'app_settings.update.start',
    ...summarizeUpdates(updates),
  }, 'Updating app settings');
  const current = await ensureAppSettings();

  const next: AppSettings = {
    googleClientId: updates.googleClientId === undefined
      ? current.googleClientId
      : normalizeOptionalString(updates.googleClientId),
    googleClientSecret: updates.googleClientSecret === undefined
      ? current.googleClientSecret
      : normalizeOptionalString(updates.googleClientSecret),
    cleverClientId: updates.cleverClientId === undefined
      ? current.cleverClientId
      : normalizeOptionalString(updates.cleverClientId),
    cleverClientSecret: updates.cleverClientSecret === undefined
      ? current.cleverClientSecret
      : normalizeOptionalString(updates.cleverClientSecret),
    aiEnabled: updates.aiEnabled ?? current.aiEnabled,
    aiProvider: updates.aiProvider === undefined
      ? current.aiProvider
      : normalizeRequiredString(updates.aiProvider, current.aiProvider),
    openaiApiKey: updates.openaiApiKey === undefined
      ? current.openaiApiKey
      : normalizeOptionalString(updates.openaiApiKey),
    openaiBaseUrl: updates.openaiBaseUrl === undefined
      ? current.openaiBaseUrl
      : normalizeRequiredString(updates.openaiBaseUrl, DEFAULT_APP_SETTINGS.openaiBaseUrl),
    aiPronunciationEnabled: updates.aiPronunciationEnabled ?? current.aiPronunciationEnabled,
    aiImageEnabled: updates.aiImageEnabled ?? current.aiImageEnabled,
    aiMnemonicEnabled: updates.aiMnemonicEnabled ?? current.aiMnemonicEnabled,
    aiMnemonicModel: updates.aiMnemonicModel === undefined
      ? current.aiMnemonicModel
      : normalizeRequiredString(updates.aiMnemonicModel, current.aiMnemonicModel),
    aiImageModel: updates.aiImageModel === undefined
      ? current.aiImageModel
      : normalizeRequiredString(updates.aiImageModel, current.aiImageModel),
    aiImageQuality: updates.aiImageQuality === undefined
      ? current.aiImageQuality
      : normalizeRequiredString(updates.aiImageQuality, current.aiImageQuality),
    aiTtsModel: updates.aiTtsModel === undefined
      ? current.aiTtsModel
      : normalizeRequiredString(updates.aiTtsModel, current.aiTtsModel),
    aiTtsProvider: updates.aiTtsProvider === undefined
      ? current.aiTtsProvider
      : normalizeRequiredString(updates.aiTtsProvider, current.aiTtsProvider),
    elevenlabsApiKey: updates.elevenlabsApiKey === undefined
      ? current.elevenlabsApiKey
      : normalizeOptionalString(updates.elevenlabsApiKey),
    aiTtsVoiceMap: updates.aiTtsVoiceMap === undefined
      ? current.aiTtsVoiceMap
      : normalizeRequiredString(updates.aiTtsVoiceMap, '{}'),
    vocabTtsVoiceId: updates.vocabTtsVoiceId === undefined
      ? current.vocabTtsVoiceId
      : normalizeOptionalString(updates.vocabTtsVoiceId),
    // undefined keeps the saved key; '' (or whitespace) clears it.
    anthropicApiKey: updates.anthropicApiKey === undefined
      ? current.anthropicApiKey
      : normalizeOptionalString(updates.anthropicApiKey),
    aiTextProvider: updates.aiTextProvider === undefined
      ? current.aiTextProvider
      : normalizeRequiredString(updates.aiTextProvider, current.aiTextProvider),
    aiAnthropicMnemonicModel: updates.aiAnthropicMnemonicModel === undefined
      ? current.aiAnthropicMnemonicModel
      : normalizeRequiredString(updates.aiAnthropicMnemonicModel, current.aiAnthropicMnemonicModel),
  };

  const now = new Date();
  await db.insert(schema.appSettings).values({
    id: APP_SETTINGS_ROW_ID,
    ...toDbValues(next),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: schema.appSettings.id,
    set: {
      ...toDbValues(next),
      updatedAt: now,
    },
  });

  invalidateAiRuntimeConfigCache();
  applyAppSettingsToProcessEnv(next);
  logger.info({
    event: 'app_settings.update.finish',
    ...summarizeUpdates(updates),
    ...summarizeSettings(next),
  }, 'Updated app settings');
  return next;
}

export async function loadAppSettingsIntoProcessEnv(): Promise<AppSettings> {
  const settings = await ensureAppSettings();
  applyAppSettingsToProcessEnv(settings);
  logger.info({
    event: 'app_settings.load_into_env',
    ...summarizeSettings(settings),
  }, 'Loaded app settings into process environment');
  return settings;
}
