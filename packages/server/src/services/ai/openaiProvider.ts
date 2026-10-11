// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type {
  AiProvider,
  AiImageResult,
  AiSpeechResult,
  AiTranscriptionResult,
  AiMnemonicResult,
  MnemonicContext,
  SpeechOptions,
} from './types.js';
import { buildMnemonicPrompt, buildTtsInstructions } from './aiTemplates.js';
import { stripInlineMarkdown } from './textOutput.js';

type OpenAiProviderConfig = {
  baseUrl?: string;
  mnemonicModel: string;
  imageModel: string;
  imageQuality: string;
  ttsModel: string;
};

export class OpenAIProvider implements AiProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly mnemonicModel: string;
  private readonly imageModel: string;
  private readonly imageQuality: string;
  private readonly ttsModel: string;

  constructor(apiKey: string | null, config: OpenAiProviderConfig) {
    this.apiKey = apiKey ?? '';
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.mnemonicModel = config.mnemonicModel;
    this.imageModel = config.imageModel;
    this.imageQuality = config.imageQuality;
    this.ttsModel = config.ttsModel;
  }

  /**
   * POST to chat/completions. Reasoning-family models (gpt-5.x, o-series)
   * reject any non-default `temperature` with a 400 unsupported_value error —
   * in that case retry once with temperature omitted instead of failing the
   * whole operation (without the retry, switching to such a model silently
   * breaks mnemonics).
   */
  private async chatCompletion(
    body: Record<string, unknown>,
    operation: string,
  ): Promise<{ choices: { message: { content: string } }[] }> {
    const post = (payload: Record<string, unknown>) => fetch(this.endpoint('chat/completions'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });

    // Model families disagree on optional sampling/reasoning params:
    // reasoning models (gpt-5.x) reject non-default `temperature`, while
    // non-reasoning models (gpt-4o family) reject `reasoning_effort`. Strip
    // whichever param a 400 complains about and retry, up to once per param.
    const STRIPPABLE = ['temperature', 'reasoning_effort'];
    let payload = { ...body };
    let response = await post(payload);
    for (let attempt = 0; !response.ok && attempt < STRIPPABLE.length; attempt++) {
      const error = await response.text();
      const offender = STRIPPABLE.find((p) => p in payload && error.includes(p));
      if (response.status !== 400 || !offender) {
        throw new Error(`OpenAI ${operation} failed: ${error}`);
      }
      const rest = { ...payload };
      delete rest[offender];
      payload = rest;
      response = await post(payload);
    }
    if (!response.ok) {
      throw new Error(`OpenAI ${operation} failed: ${await response.text()}`);
    }
    return await response.json() as { choices: { message: { content: string } }[] };
  }

  /**
   * POST to images/generations. GPT image models (gpt-image-*) always answer in base64 and reject
   * `response_format` with a 400 unknown_parameter (sending it to gpt-image-2 fails every
   * image). DALL·E models need `response_format` to answer in base64 and may not know
   * `output_format`. So `response_format` goes only to other models, and any optional param a
   * 400 names is stripped, once each, and the request retried.
   */
  async generateImage(prompt: string): Promise<AiImageResult> {
    const schoolSafePrompt = `${prompt}\n\nIMPORTANT: The image must be school-appropriate and suitable for all ages.`;
    const post = (payload: Record<string, unknown>) => fetch(this.endpoint('images/generations'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });

    const STRIPPABLE = ['response_format', 'output_format', 'quality'];
    let payload: Record<string, unknown> = {
      model: this.imageModel,
      prompt: schoolSafePrompt,
      n: 1,
      quality: this.imageQuality,
      output_format: 'webp',
      ...(isGptImageModel(this.imageModel) ? {} : { response_format: 'b64_json' }),
    };
    let response = await post(payload);
    for (let attempt = 0; !response.ok && attempt < STRIPPABLE.length; attempt++) {
      const error = await response.text();
      const offender = STRIPPABLE.find((p) => p in payload && error.includes(p));
      if (response.status !== 400 || !offender) {
        throw new Error(`OpenAI image generation failed: ${error}`);
      }
      const rest = { ...payload };
      delete rest[offender];
      payload = rest;
      response = await post(payload);
    }
    if (!response.ok) {
      throw new Error(`OpenAI image generation failed: ${await response.text()}`);
    }

    const data = await response.json() as { data?: { b64_json?: string; url?: string }[] };
    const first = data.data?.[0];
    if (first?.b64_json) {
      return { url: `data:${imageMimeType(first.b64_json)};base64,${first.b64_json}` };
    }
    if (first?.url) {
      // A model that answered with a link (no response_format): keep the image itself, since
      // those links expire within the hour.
      const image = await fetch(first.url);
      if (!image.ok) throw new Error(`OpenAI image generation failed: could not download the image (${image.status})`);
      const b64 = Buffer.from(await image.arrayBuffer()).toString('base64');
      return { url: `data:${imageMimeType(b64)};base64,${b64}` };
    }
    throw new Error('OpenAI image generation returned no image');
  }

  async generateSpeech(text: string, options: SpeechOptions = {}): Promise<AiSpeechResult> {
    const voice = options.voice || 'alloy';
    const instructions = buildTtsInstructions(options);

    const body: Record<string, unknown> = {
      model: this.ttsModel,
      input: text,
      voice,
      instructions,
      response_format: 'opus',
    };

    const response = await fetch(this.endpoint('audio/speech'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI speech generation failed: ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return { audioBuffer: Buffer.from(arrayBuffer), mimeType: 'audio/ogg;codecs=opus' };
  }

  async generateTranscription(audioBuffer: Buffer, mimeType: string, language?: string): Promise<AiTranscriptionResult> {
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'wav';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    if (language) form.append('language', language);

    const response = await fetch(this.endpoint('audio/transcriptions'), {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI transcription failed: ${error}`);
    }
    const data = await response.json() as { text?: string };
    return { text: data.text ?? '' };
  }

  async generateMnemonic(context: MnemonicContext): Promise<AiMnemonicResult> {
    const prompt = buildMnemonicPrompt(context);

    const data = await this.chatCompletion({
      model: this.mnemonicModel,
      messages: [{ role: 'user', content: prompt }],
      // Reasoning models consume max_completion_tokens with internal reasoning
      // BEFORE emitting visible text — a tight cap yields an empty completion,
      // not an error. Keep effort low and leave generous headroom: 200 tokens
      // starves a reasoning model such as gpt-5.6-luna into empty completions.
      ...this.completionTokenLimit(2_000),
      temperature: 0.8,
      reasoning_effort: 'low',
    }, 'mnemonic generation');
    const text = stripInlineMarkdown(data.choices[0]?.message?.content?.trim() ?? '');
    if (!text) {
      // Never store a blank mnemonic: an empty completion means the model ran
      // out of tokens mid-reasoning or returned nothing usable.
      throw new Error('OpenAI mnemonic generation returned an empty completion');
    }
    return { text };
  }

  private endpoint(path: string): string {
    return `${this.baseUrl}/${path}`;
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {};
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }

  private completionTokenLimit(limit: number): Record<string, number> {
    return this.baseUrl === 'https://api.openai.com/v1'
      ? { max_completion_tokens: limit }
      : { max_tokens: limit };
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

/** GPT image models (gpt-image-1, gpt-image-2, …) always answer in base64 and refuse `response_format`. */
export function isGptImageModel(model: string): boolean {
  return /^gpt-image/i.test(model.trim());
}

/** The image's real type from its first bytes, so the data URL is right whatever format came back. */
export function imageMimeType(b64: string): string {
  const head = Buffer.from(b64.slice(0, 24), 'base64');
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return 'image/png';
}
