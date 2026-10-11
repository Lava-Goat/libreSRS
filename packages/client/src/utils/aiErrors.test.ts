// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/messages';
import { aiErrorMessage, aiSettingsErrorMessage } from './aiErrors';

/** A tRPC client error as the panel catches it: the server's code sits on error.data. */
const trpcError = (appCode?: string) => Object.assign(new Error('Server says something in English'), { data: { code: 'INTERNAL_SERVER_ERROR', appCode } });
const english = (message: string) => message;
const spanish = (message: string) => MESSAGES.es[message] ?? message;

describe('aiErrorMessage', () => {
  it.each([
    ['AI_QUOTA_EXHAUSTED', 'AI is paused: the account behind mnemonic suggestions is out of credit. Add credit, then try again.'],
    ['AI_PROVIDER_AUTH', 'The AI provider rejected the saved API key. Paste a new one in the AI settings.'],
    ['AI_MODEL_NOT_FOUND', 'The AI provider doesn’t offer the chosen model. Pick another one in the AI settings.'],
    ['AI_PROVIDER_BUSY', 'The AI service is busy or having a temporary problem. Try again in a minute.'],
    ['AI_REFUSED', 'Claude declined to write a suggestion for this card. Try again.'],
    ['AI_PROVIDER_MISSING', 'No AI provider is set up for mnemonic suggestions. Add a key in the AI settings.'],
    ['AI_MODERATION_FLAGGED', 'The suggestion was held back by the safety check. Try again.'],
    // 20 AI calls a minute per teacher, shared with pictures and audio: "Try again" at once fails the same way.
    ['AI_RATE_LIMIT', 'Too many AI requests in the last minute. Try again in a moment.'],
  ])('says what %s means, not the server’s English', (appCode, text) => {
    expect(aiErrorMessage(trpcError(appCode), english)).toBe(text);
  });

  it('says the rate limit in the teacher’s language', () => {
    expect(aiErrorMessage(trpcError('AI_RATE_LIMIT'), spanish)).toBe('Demasiadas solicitudes de IA en el último minuto. Vuelve a intentarlo en un momento.');
  });

  it('falls back to a plain retry line for anything else', () => {
    const fallback = 'Couldn’t get a suggestion. Try again.';
    expect(aiErrorMessage(trpcError('AI_GENERATION_FAILED'), english)).toBe(fallback);
    expect(aiErrorMessage(trpcError(), english)).toBe(fallback);
    expect(aiErrorMessage(new Error('offline'), english)).toBe(fallback);
    expect(aiErrorMessage(null, english)).toBe(fallback);
    expect(aiErrorMessage(undefined, english)).toBe(fallback);
    expect(aiErrorMessage('a string', english)).toBe(fallback);
  });

  it('speaks the teacher’s language', () => {
    expect(aiErrorMessage(trpcError('AI_PROVIDER_AUTH'), spanish))
      .toBe('El proveedor de IA rechazó la clave API guardada. Pega una nueva en la configuración de IA.');
    expect(aiErrorMessage(trpcError('AI_SOMETHING_NEW'), spanish)).toBe('No se pudo obtener una sugerencia. Vuelve a intentarlo.');
  });
});

describe('aiSettingsErrorMessage', () => {
  /** A refused save or key test as Admin > AI gets it. */
  const refused = (appCode?: string, code = 'BAD_REQUEST') => Object.assign(new Error('Server says something in English'), { data: { code, appCode } });

  it.each([
    ['ANTHROPIC_KEY_MISSING', 'Claude needs an Anthropic API key — paste one, or switch mnemonic suggestions back to OpenAI.'],
    ['ANTHROPIC_KEY_INVALID', 'The Anthropic API key has a character no key has (a space, a line break or an invisible character from copying). Copy it again from the Claude Console.'],
    ['TEXT_MODEL_PROVIDER_MISMATCH', 'A model under “Model Settings” is for the other provider: Claude takes claude-* models, and OpenAI its own.'],
    ['API_KEY_IN_MODEL_FIELD', 'A model field holds what looks like an API key. Paste keys only into the API key fields.'],
    ['AI_RATE_LIMIT', 'Too many AI requests in the last minute. Try again in a moment.'],
  ])('says what %s means, not the server’s English', (appCode, text) => {
    expect(aiSettingsErrorMessage(refused(appCode), english)).toBe(text);
  });

  it('leaves any other refusal to the server’s own message', () => {
    expect(aiSettingsErrorMessage(refused('TTS_MODEL_PROVIDER_MISMATCH'), english)).toBeNull();
    expect(aiSettingsErrorMessage(refused(), english)).toBeNull();
    expect(aiSettingsErrorMessage(new Error('offline'), english)).toBeNull();
    expect(aiSettingsErrorMessage(null, english)).toBeNull();
  });

  it('speaks the admin’s language, naming “Model Settings” as the page does', () => {
    for (const appCode of ['ANTHROPIC_KEY_MISSING', 'ANTHROPIC_KEY_INVALID', 'TEXT_MODEL_PROVIDER_MISMATCH', 'API_KEY_IN_MODEL_FIELD', 'AI_RATE_LIMIT']) {
      const text = aiSettingsErrorMessage(refused(appCode), english)!;
      expect(MESSAGES.es[text], appCode).toBeDefined();
    }
    expect(aiSettingsErrorMessage(refused('TEXT_MODEL_PROVIDER_MISMATCH'), spanish)).toContain('“Configuración del modelo”');
  });
});
