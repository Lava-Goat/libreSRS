// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Who writes mnemonic suggestions: the OpenAI-side provider (exactly as before) or
 * Claude, by the admin's "Mnemonic suggestions use" switch. Images, speech,
 * transcription and moderation always stay on createAiProvider.
 *
 * Its own module on purpose: the vi.mock('./providerFactory.js') factories in the
 * existing tests keep intercepting the OpenAI path unchanged.
 */
import type { TextProvider } from './types.js';
import { type AiRuntimeConfig, getAiRuntimeConfig } from './config.js';
import { createAiProvider } from './providerFactory.js';
import { AnthropicProvider } from './anthropicProvider.js';

/** Anything but 'anthropic' is OpenAI, so a config without the field (an older test mock) stays on OpenAI. */
export function usesClaude(cfg: Pick<AiRuntimeConfig, 'textProvider'>): boolean {
  return cfg.textProvider === 'anthropic';
}

/** The model that writes mnemonic suggestions right now. */
export function activeMnemonicModel(cfg: AiRuntimeConfig): string {
  return usesClaude(cfg) ? cfg.anthropicMnemonicModel : cfg.mnemonicModel;
}

export async function createTextProvider(config?: AiRuntimeConfig): Promise<TextProvider | null> {
  const cfg = config ?? await getAiRuntimeConfig();
  if (!usesClaude(cfg)) return createAiProvider(cfg); // exactly today's path
  if (!cfg.anthropicApiKey) return null;
  return new AnthropicProvider(cfg.anthropicApiKey, {
    mnemonicModel: cfg.anthropicMnemonicModel,
  });
}
