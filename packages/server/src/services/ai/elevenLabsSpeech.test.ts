// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ELEVENLABS_TTS_MODELS,
  generateElevenLabsSpeech,
  listElevenLabsModels,
  listElevenLabsVoices,
  pickElevenLabsVoice,
} from './elevenLabsSpeech.js';

const CFG = {
  apiKey: 'xi-test-key',
  model: 'eleven_multilingual_v2',
  voiceMap: { '': 'voice-default', Mexican: 'voice-mx', Castilian: 'voice-es' },
};

function audioResponse(bytes = [1, 2, 3]): Response {
  return {
    ok: true,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

describe('pickElevenLabsVoice', () => {
  it('picks the accent voice, falling back to the default', () => {
    expect(pickElevenLabsVoice(CFG.voiceMap, 'Mexican')).toBe('voice-mx');
    expect(pickElevenLabsVoice(CFG.voiceMap, 'Cuban')).toBe('voice-default');
    // The trap behind "the reverse card is in a shitty English voice": an
    // unmapped English accent silently borrows the (Spanish) default voice.
    expect(pickElevenLabsVoice(CFG.voiceMap, 'American')).toBe('voice-default');
    expect(pickElevenLabsVoice(CFG.voiceMap, undefined)).toBe('voice-default');
    expect(pickElevenLabsVoice({}, 'Mexican')).toBeNull();
  });

  it('never resolves prototype members as voice ids', () => {
    for (const evil of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(pickElevenLabsVoice({ '': 'voice-default' }, evil)).toBe('voice-default');
      expect(pickElevenLabsVoice({}, evil)).toBeNull();
    }
  });
});

describe('generateElevenLabsSpeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the voice-specific endpoint requesting opus and returns the audio', async () => {
    fetchMock.mockResolvedValue(audioResponse());

    const result = await generateElevenLabsSpeech('ciudad', { accent: 'Mexican', language: 'Spanish' }, CFG);
    expect(result.mimeType).toBe('audio/ogg');
    expect(result.audioBuffer.length).toBe(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-mx?output_format=opus_48000_64');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi-test-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ text: 'ciudad', model_id: 'eleven_multilingual_v2' });
    // multilingual_v2 rejects language_code — it must NOT be sent
    expect(body).not.toHaveProperty('language_code');
  });

  it('sends language_code for flash/turbo models (Spanish → es)', async () => {
    fetchMock.mockResolvedValue(audioResponse());
    await generateElevenLabsSpeech('brela', { accent: 'Castilian', language: 'Spanish', pseudoword: true },
      { ...CFG, model: 'eleven_flash_v2_5' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.language_code).toBe('es');
  });

  it('strictAccent fails on an unmapped accent instead of falling back to the default voice', async () => {
    await expect(generateElevenLabsSpeech('ciudad', { accent: 'Cuban', strictAccent: true }, CFG))
      .rejects.toThrow('No ElevenLabs voice configured for accent "Cuban"');
    expect(fetchMock).not.toHaveBeenCalled();
    // Without strictAccent the same call falls back to the default voice.
    fetchMock.mockResolvedValue(audioResponse());
    await generateElevenLabsSpeech('ciudad', { accent: 'Cuban' }, CFG);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/text-to-speech/voice-default');
  });

  it('an explicit voice id wins over the accent map and is primed in Spanish, as a sentence when asked', async () => {
    fetchMock.mockResolvedValue(audioResponse());
    // The Vocabulómetro's teacher clone: an English-labelled professional clone
    // speaking Spanish through multilingual_v2, so the prime is what keeps it Spanish.
    await generateElevenLabsSpeech('Mi hermano vive en la ciudad.', {
      language: 'Spanish', strictAccent: true, elevenLabsVoiceId: 'voice-teacher', textKind: 'sentence',
    }, CFG);
    await generateElevenLabsSpeech('gente', {
      accent: 'Cuban', language: 'Spanish', strictAccent: true, elevenLabsVoiceId: 'voice-teacher',
    }, CFG);
    const [sentenceUrl, sentenceInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentenceUrl).toContain('/text-to-speech/voice-teacher?');
    expect(JSON.parse(String(sentenceInit.body)).previous_text).toMatch(/frase en español:$/);
    const [wordUrl, wordInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    // strictAccent does not refuse an unmapped accent when the voice is explicit.
    expect(wordUrl).toContain('/text-to-speech/voice-teacher?');
    expect(JSON.parse(String(wordInit.body)).previous_text).toMatch(/palabra en español es:$/);
  });

  it('throws a clear error when no voice is configured for the accent', async () => {
    await expect(generateElevenLabsSpeech('ciudad', { accent: 'Cuban' }, { ...CFG, voiceMap: {} }))
      .rejects.toThrow('No ElevenLabs voice configured for accent "Cuban"');
    await expect(generateElevenLabsSpeech('ciudad', {}, { ...CFG, voiceMap: {} }))
      .rejects.toThrow('No default ElevenLabs voice configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces provider errors and rejects empty audio', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => JSON.stringify({ detail: { status: 'invalid_api_key' } }),
    } as unknown as Response);
    await expect(generateElevenLabsSpeech('ciudad', {}, CFG)).rejects.toThrow('ElevenLabs speech generation failed');

    fetchMock.mockResolvedValueOnce(audioResponse([]));
    await expect(generateElevenLabsSpeech('ciudad', {}, CFG)).rejects.toThrow('empty audio');
  });
});

describe('listElevenLabsVoices', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists voices and follows pagination', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [{ voice_id: 'v1', name: 'Diego', labels: { accent: 'mexican' }, category: 'professional' }],
          has_more: true,
          next_page_token: 'tok',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [{ voice_id: 'v2', name: 'Lucía' }],
          has_more: false,
        }),
      } as unknown as Response);

    const voices = await listElevenLabsVoices('xi-key');
    expect(voices).toEqual([
      { voiceId: 'v1', name: 'Diego', labels: { accent: 'mexican' }, category: 'professional' },
      { voiceId: 'v2', name: 'Lucía', labels: {} },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('listElevenLabsModels', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns TTS-capable model ids from the API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ([
        { model_id: 'eleven_multilingual_v2', can_do_text_to_speech: true },
        { model_id: 'eleven_english_sts_v2', can_do_text_to_speech: false },
      ]),
    } as unknown as Response);
    expect(await listElevenLabsModels('xi-key')).toEqual(['eleven_multilingual_v2']);
  });

  it('falls back to the static list on failure', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await listElevenLabsModels('xi-key')).toEqual(ELEVENLABS_TTS_MODELS);
  });
});
