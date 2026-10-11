// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { MnemonicStyle } from '../../db/schema.js';

export interface AiImageResult {
  url: string;
}

export interface AiSpeechResult {
  audioBuffer: Buffer;
  mimeType: string;
}

/** What a provider reports about one text call (Claude fills it; OpenAI leaves it out). */
export interface AiUsage {
  /** The model that served the request; a server-side fallback may differ from the one asked for. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
}

export interface AiMnemonicResult {
  text: string;
  usage?: AiUsage;
}

export interface MnemonicContext {
  front: string;
  back: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** 'keyword' (the default) or 'sentence'; see MNEMONIC_STYLES. */
  style?: MnemonicStyle;
  /** Every earlier suggestion for the card in this style (pending, rejected or approved), so the
   *  model writes a different one. */
  alreadySuggested?: string[];
  /** Earlier suggestions for the card in the other style, for reference only: a picture and a
   *  sentence are different cues, so the model may reuse a keyword from these. */
  suggestedInOtherStyle?: string[];
  /** The approved mnemonics of the deck's other cards ("perro = dog: …"), so one keyword is not
   *  used on two cards (PEAR for both pero and perro). */
  otherCards?: string[];
}

export interface SpeechOptions {
  voice?: string;
  language?: string;
  accent?: string;
  /** Invented/nonsense word — force strict language phonetics, never English. */
  pseudoword?: boolean;
  /** Fail instead of falling back to the default voice when the accent has no
   *  mapped voice (accent-labeled measurement clips must not be mislabeled). */
  strictAccent?: boolean;
  /** Speak with exactly this ElevenLabs voice_id, bypassing the accent map —
   *  the Vocabulómetro records which voice spoke each clip and serves by it. */
  elevenLabsVoiceId?: string;
  /** What the text is, so the language priming fits it. Default 'word'. */
  textKind?: 'word' | 'sentence';
}

export interface AiTranscriptionResult {
  text: string;
}

export interface AiProvider {
  readonly name: string;
  /** Set when speech is served by a different provider than `name` (e.g. an
   *  ElevenLabs TTS wrapper over OpenAI) so logs/assets attribute correctly. */
  readonly speechProviderName?: string;
  generateImage(prompt: string): Promise<AiImageResult>;
  generateSpeech(text: string, options?: SpeechOptions): Promise<AiSpeechResult>;
  generateMnemonic(context: MnemonicContext): Promise<AiMnemonicResult>;
  generateTranscription(audioBuffer: Buffer, mimeType: string, language?: string): Promise<AiTranscriptionResult>;
}

/** What mnemonic suggestions need; both AiProvider and AnthropicProvider satisfy it. */
export type TextProvider = Pick<AiProvider, 'name' | 'generateMnemonic'>;
