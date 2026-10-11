// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// ElevenLabs text-to-speech. Unlike OpenAI (one synthetic voice steered by
// natural-language instructions), ElevenLabs models accents by VOICE: the admin
// maps each Spanish accent to a native-accent voice from their ElevenLabs
// account, and generateSpeech picks the voice for the clip's accent. Audio is
// requested as opus 48kHz/64kbps to match the app's stored clip format.
import { TTS_LANGUAGE_MAP } from '@libresrs/shared';
import { speechLanguagePrime } from './speechText.js';
import { logger } from '../../logger.js';
import type { AiSpeechResult, SpeechOptions } from './types.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'opus_48000_64';
const REQUEST_TIMEOUT_MS = 60_000;

/** Static fallback list — the live catalog fetches GET /v1/models when it can. */
export const ELEVENLABS_TTS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_turbo_v2_5',
  'eleven_flash_v2_5',
  'eleven_v3',
];

export interface ElevenLabsTtsConfig {
  apiKey: string;
  /** ElevenLabs model_id (e.g. eleven_multilingual_v2). */
  model: string;
  /** Accent name → voice_id; '' key = default voice. */
  voiceMap: Record<string, string>;
}

/** Reverse-resolve a display language name ("Spanish") to ISO 639-1 ("es"). */
function languageNameToIso(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const needle = language.trim().toLowerCase();
  for (const [code, name] of TTS_LANGUAGE_MAP.entries()) {
    if (name.toLowerCase() === needle) return code;
  }
  // Callers may already pass an ISO code.
  return /^[a-z]{2}$/i.test(language.trim()) ? language.trim().toLowerCase() : undefined;
}

export function pickElevenLabsVoice(
  voiceMap: Record<string, string>,
  accent: string | undefined,
): string | null {
  // Object.hasOwn guards: an accent like "constructor" must never resolve a
  // prototype member into the request URL.
  if (accent && Object.hasOwn(voiceMap, accent) && voiceMap[accent]) return voiceMap[accent];
  return Object.hasOwn(voiceMap, '') && voiceMap[''] ? voiceMap[''] : null;
}

export async function generateElevenLabsSpeech(
  text: string,
  options: SpeechOptions | undefined,
  config: ElevenLabsTtsConfig,
): Promise<AiSpeechResult> {
  // In strict mode a requested accent without a mapped voice is an error, not a
  // silent default-voice fallback — the Vocabulómetro stores clips keyed by
  // accent, and a default-voice clip labeled "Cuban" would be permanently
  // mislabeled measurement data. Flashcard pronunciation stays lenient.
  if (!options?.elevenLabsVoiceId && options?.strictAccent && options.accent && !Object.hasOwn(config.voiceMap, options.accent)) {
    throw new Error(`No ElevenLabs voice configured for accent "${options.accent}"`);
  }
  // An explicit voice wins: the caller already resolved it and records it.
  const voiceId = options?.elevenLabsVoiceId || pickElevenLabsVoice(config.voiceMap, options?.accent);
  // A lenient fallback to the default voice is silent by design, but if that
  // default belongs to another language the result is jarring — an English card
  // read by a Spanish voice. Say so in the log rather than leaving it invisible.
  if (!options?.elevenLabsVoiceId && options?.accent && !Object.hasOwn(config.voiceMap, options.accent)) {
    logger.warn(
      { accent: options.accent, language: options.language },
      'No ElevenLabs voice mapped for this accent — falling back to the default voice, which may be the wrong language',
    );
  }
  if (!voiceId) {
    throw new Error(
      options?.accent
        ? `No ElevenLabs voice configured for accent "${options.accent}" and no default voice set`
        : 'No default ElevenLabs voice configured'
    );
  }

  const body: Record<string, unknown> = {
    text,
    model_id: config.model,
  };
  // language_code enforces language during normalization on flash/turbo models;
  // multilingual_v2 rejects it, so only send where supported. For pseudowords
  // this is the closest analogue to OpenAI's "read by Spanish rules" steering.
  const iso = languageNameToIso(options?.language);
  if (iso && /(flash|turbo)/.test(config.model)) {
    body.language_code = iso;
  }

  // An isolated vocabulary word carries no language signal, so a cross-language
  // homograph gets read in the wrong one: "color" came out English, "gente"
  // came out Italian (JEN-teh instead of HEN-teh). previous_text is NOT spoken
  // but does condition the generation, and it is the only language lever
  // multilingual_v2 offers.
  // The same holds for a whole sentence read by a clone trained on English
  // speech: the prime keeps it in Spanish from the first syllable.
  const prime = speechLanguagePrime(iso, options?.textKind);
  if (prime) {
    body.previous_text = prime;
  }

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs speech generation failed: ${error.slice(0, 500)}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error('ElevenLabs returned an empty audio response');
  }
  return { audioBuffer, mimeType: 'audio/ogg' };
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  labels: Record<string, string>;
  /** 'professional' | 'cloned' | 'premade' | 'generated' — shown next to the name. */
  category?: string;
}

/** List the voices in the account (for the admin voice-mapping UI). */
export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const voices: ElevenLabsVoice[] = [];
  let pageToken: string | null = null;
  // The account's own voices are few; cap pagination defensively.
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${ELEVENLABS_BASE_URL}/v2/voices`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('next_page_token', pageToken);
    const response = await fetch(url, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs voice listing failed: ${(await response.text()).slice(0, 300)}`);
    }
    const data = await response.json() as {
      voices?: { voice_id: string; name: string; labels?: Record<string, string>; category?: string }[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    for (const v of data.voices ?? []) {
      voices.push({
        voiceId: v.voice_id, name: v.name, labels: v.labels ?? {},
        ...(typeof v.category === 'string' ? { category: v.category } : {}),
      });
    }
    if (!data.has_more || !data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return voices;
}

/** List available TTS model ids (for the model dropdown); static fallback on failure. */
export async function listElevenLabsModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/models`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { model_id?: string; can_do_text_to_speech?: boolean }[];
    const ids = (Array.isArray(data) ? data : [])
      .filter((m) => m.can_do_text_to_speech !== false && typeof m.model_id === 'string')
      .map((m) => m.model_id as string);
    return ids.length > 0 ? ids : ELEVENLABS_TTS_MODELS;
  } catch {
    return ELEVENLABS_TTS_MODELS;
  }
}
