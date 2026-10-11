// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { useI18n } from '../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/**
 * What the teacher reads when a mnemonic suggestion fails, by the server's own code
 * (error.data.appCode). The server's message is English and names the provider; this one is in
 * the teacher's language and says what to do next.
 */
export function aiErrorMessage(err: unknown, t: Translate): string {
  switch ((err as { data?: { appCode?: string } } | null)?.data?.appCode) {
    case 'AI_QUOTA_EXHAUSTED':
      return t('AI is paused: the account behind mnemonic suggestions is out of credit. Add credit, then try again.');
    case 'AI_PROVIDER_AUTH':
      return t('The AI provider rejected the saved API key. Paste a new one in the AI settings.');
    case 'AI_MODEL_NOT_FOUND':
      return t('The AI provider doesn’t offer the chosen model. Pick another one in the AI settings.');
    case 'AI_PROVIDER_BUSY':
      return t('The AI service is busy or having a temporary problem. Try again in a minute.');
    case 'AI_REFUSED':
      return t('Claude declined to write a suggestion for this card. Try again.');
    case 'AI_PROVIDER_MISSING':
      return t('No AI provider is set up for mnemonic suggestions. Add a key in the AI settings.');
    case 'AI_MODERATION_FLAGGED':
      return t('The suggestion was held back by the safety check. Try again.');
    case 'AI_RATE_LIMIT':
      // 20 AI calls a minute per teacher, pictures and audio included: trying again at once fails too.
      return t('Too many AI requests in the last minute. Try again in a moment.');
    default:
      return t('Couldn’t get a suggestion. Try again.');
  }
}

/**
 * Why Admin > AI refused a save or a key test, in the admin's language, for the codes the
 * v1.20.0 settings added (the server's own message is English). Null for any other code: the
 * caller shows the server's message, as before.
 */
export function aiSettingsErrorMessage(err: unknown, t: Translate): string | null {
  switch ((err as { data?: { appCode?: string } | null } | null)?.data?.appCode) {
    case 'ANTHROPIC_KEY_MISSING':
      return t('Claude needs an Anthropic API key — paste one, or switch mnemonic suggestions back to OpenAI.');
    case 'ANTHROPIC_KEY_INVALID':
      return t('The Anthropic API key has a character no key has (a space, a line break or an invisible character from copying). Copy it again from the Claude Console.');
    case 'TEXT_MODEL_PROVIDER_MISMATCH':
      return t('A model under “Model Settings” is for the other provider: Claude takes claude-* models, and OpenAI its own.');
    case 'API_KEY_IN_MODEL_FIELD':
      return t('A model field holds what looks like an API key. Paste keys only into the API key fields.');
    case 'AI_RATE_LIMIT':
      return t('Too many AI requests in the last minute. Try again in a moment.');
    default:
      return null;
  }
}
