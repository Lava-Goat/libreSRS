// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { AiProvider, AiSpeechResult, SpeechOptions } from './types.js';
import { OpenAIProvider } from './openaiProvider.js';
import { generateElevenLabsSpeech, type ElevenLabsTtsConfig } from './elevenLabsSpeech.js';
import { type AiRuntimeConfig, getAiRuntimeConfig } from './config.js';

/** Delegates everything to the inner provider except speech, which ElevenLabs serves. */
class ElevenLabsTtsWrapper implements AiProvider {
  readonly name: string;
  readonly speechProviderName = 'elevenlabs';

  constructor(
    private readonly inner: AiProvider,
    private readonly ttsConfig: ElevenLabsTtsConfig,
    /** False when the inner (OpenAI-side) provider has no usable credentials —
     *  non-speech calls then fail with a clean config error instead of firing
     *  unauthenticated requests at api.openai.com and leaking raw 401 bodies. */
    private readonly innerUsable: boolean,
  ) {
    this.name = inner.name;
  }

  private assertInnerUsable(): void {
    if (!this.innerUsable) {
      throw new Error('AI provider is not configured for this feature (only ElevenLabs speech is set up)');
    }
  }

  generateSpeech(text: string, options?: SpeechOptions): Promise<AiSpeechResult> {
    return generateElevenLabsSpeech(text, options, this.ttsConfig);
  }

  // async so a failed guard is a rejection, never a sync throw from a
  // promise-returning method.
  async generateImage(prompt: string) { this.assertInnerUsable(); return this.inner.generateImage(prompt); }
  async generateMnemonic(context: Parameters<AiProvider['generateMnemonic']>[0]) { this.assertInnerUsable(); return this.inner.generateMnemonic(context); }
  async generateTranscription(audioBuffer: Buffer, mimeType: string, language?: string) {
    this.assertInnerUsable();
    return this.inner.generateTranscription(audioBuffer, mimeType, language);
  }
}

export async function createAiProvider(config?: AiRuntimeConfig): Promise<AiProvider | null> {
  const runtimeConfig = config ?? await getAiRuntimeConfig();
  const providerName = runtimeConfig.provider;
  const apiKey = runtimeConfig.openaiApiKey;
  const baseUrl = runtimeConfig.openaiBaseUrl.replace(/\/+$/, '');
  const elevenLabsSelected = runtimeConfig.ttsProvider === 'elevenlabs';
  const elevenLabsTts = elevenLabsSelected && runtimeConfig.elevenlabsApiKey
    ? {
        apiKey: runtimeConfig.elevenlabsApiKey,
        model: runtimeConfig.ttsModel,
        voiceMap: runtimeConfig.ttsVoiceMap,
      }
    : null;
  const innerUsable = Boolean(apiKey) || baseUrl !== 'https://api.openai.com/v1';

  // Without an OpenAI-side key the base provider is unusable — but a configured
  // ElevenLabs TTS provider must still work (speech is the only method the
  // Vocabulómetro audio bank needs). The wrapper fails non-speech calls with a
  // clean config error in that case.
  if (!innerUsable && !elevenLabsTts) {
    return null;
  }

  switch (providerName) {
    case 'openai': {
      const openai = new OpenAIProvider(apiKey, {
        baseUrl,
        mnemonicModel: runtimeConfig.mnemonicModel,
        imageModel: runtimeConfig.imageModel,
        imageQuality: runtimeConfig.imageQuality,
        // With ElevenLabs serving TTS, ttsModel holds an ElevenLabs model id —
        // the inner OpenAI ttsModel is never used for speech in that case.
        ttsModel: runtimeConfig.ttsModel,
      });
      if (elevenLabsTts) {
        return new ElevenLabsTtsWrapper(openai, elevenLabsTts, innerUsable);
      }
      if (elevenLabsSelected) {
        // ElevenLabs is SELECTED but has no key: speech must fail with a clear
        // message, never silently fall through to OpenAI with an ElevenLabs
        // model id (which would 404 confusingly or, worse, "work" on the wrong
        // provider).
        return new Proxy(openai, {
          get(target, prop, receiver) {
            if (prop === 'generateSpeech') {
              return () => Promise.reject(new Error(
                'ElevenLabs is selected as the TTS provider but no ElevenLabs API key is saved'
              ));
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return openai;
    }
    default:
      return null;
  }
}
