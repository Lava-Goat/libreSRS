// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { getAppSettings } from '../appSettings.js';
import { RECOMMENDED_ANTHROPIC_MODELS } from './aiTemplates.js';

export type AiRuntimeConfig = {
  aiEnabled: boolean;
  provider: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  pronunciationEnabled: boolean;
  imageEnabled: boolean;
  mnemonicEnabled: boolean;
  mnemonicModel: string;
  imageModel: string;
  imageQuality: string;
  ttsModel: string;
  /** 'openai' | 'elevenlabs' — which provider serves generateSpeech. */
  ttsProvider: string;
  elevenlabsApiKey: string | null;
  /** Accent name → ElevenLabs voice_id; '' key is the default voice. */
  ttsVoiceMap: Record<string, string>;
  /** ElevenLabs voice for the Vocabulómetro's default accent; null = ttsVoiceMap['']. */
  vocabTtsVoiceId: string | null;
  /** 'openai' | 'anthropic': who writes mnemonic suggestions. Anything else reads 'openai'. */
  textProvider: 'openai' | 'anthropic';
  anthropicApiKey: string | null;
  /** The Claude model, used only while textProvider is 'anthropic'. */
  anthropicMnemonicModel: string;
};

function parseVoiceMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim()) map[k] = v.trim();
      }
      return map;
    }
  } catch {
    // fall through — a corrupt map must never break AI config loading
  }
  return {};
}

const CACHE_TTL_MS = 30_000;
let cachedConfig: AiRuntimeConfig | null = null;
let cacheExpiresAt = 0;

export function invalidateAiRuntimeConfigCache(): void {
  cachedConfig = null;
  cacheExpiresAt = 0;
}

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiresAt) return cachedConfig;
  const settings = await getAppSettings();
  cachedConfig = {
    aiEnabled: settings.aiEnabled,
    provider: settings.aiProvider,
    openaiApiKey: settings.openaiApiKey,
    openaiBaseUrl: settings.openaiBaseUrl,
    pronunciationEnabled: settings.aiEnabled && settings.aiPronunciationEnabled,
    imageEnabled: settings.aiEnabled && settings.aiImageEnabled,
    mnemonicEnabled: settings.aiEnabled && settings.aiMnemonicEnabled,
    mnemonicModel: settings.aiMnemonicModel,
    imageModel: settings.aiImageModel,
    imageQuality: settings.aiImageQuality,
    ttsModel: settings.aiTtsModel,
    ttsProvider: settings.aiTtsProvider,
    elevenlabsApiKey: settings.elevenlabsApiKey,
    ttsVoiceMap: parseVoiceMap(settings.aiTtsVoiceMap),
    vocabTtsVoiceId: settings.vocabTtsVoiceId,
    textProvider: settings.aiTextProvider === 'anthropic' ? 'anthropic' : 'openai',
    anthropicApiKey: settings.anthropicApiKey ?? null,
    anthropicMnemonicModel: settings.aiAnthropicMnemonicModel || RECOMMENDED_ANTHROPIC_MODELS.mnemonic,
  };
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedConfig;
}

export async function isAiEnabled(): Promise<boolean> {
  return (await getAiRuntimeConfig()).aiEnabled;
}

export async function isPronunciationEnabled(): Promise<boolean> {
  return (await getAiRuntimeConfig()).pronunciationEnabled;
}

export async function isImageEnabled(): Promise<boolean> {
  return (await getAiRuntimeConfig()).imageEnabled;
}

export async function isMnemonicEnabled(): Promise<boolean> {
  return (await getAiRuntimeConfig()).mnemonicEnabled;
}

export async function getMnemonicModel(): Promise<string> {
  return (await getAiRuntimeConfig()).mnemonicModel;
}

export async function getImageModel(): Promise<string> {
  return (await getAiRuntimeConfig()).imageModel;
}

export async function getImageQuality(): Promise<string> {
  return (await getAiRuntimeConfig()).imageQuality;
}
