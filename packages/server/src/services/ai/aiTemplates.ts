// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Canonical AI model recommendations and prompt templates.
 *
 * Edit this file to change which models are used and how prompts are worded.
 * Nothing else in the codebase should hardcode model names or prompt strings.
 */
import { TTS_LANGUAGE_MAP } from '@libresrs/shared';
import type { MnemonicStyle } from '../../db/schema.js';
import type { MnemonicContext } from './types.js';
import { isSpanishLanguage, spanishPronunciation } from './spanishPronunciation.js';

// ---------------------------------------------------------------------------
// Recommended OpenAI models for each feature
// ---------------------------------------------------------------------------

export const RECOMMENDED_MODELS = {
  /** Mnemonic generation — quality matters for memorability */
  mnemonic: 'gpt-4.1',
  /** Image generation */
  image: 'gpt-image-1',
  /** Image quality: 'low' | 'standard' | 'high' */
  imageQuality: 'low',
  /** Text-to-speech */
  tts: 'gpt-4o-mini-tts',
} as const;

/**
 * Available OpenAI models suitable for each AI task.
 * Used to populate model selection menus in the admin UI.
 * Listed with the best-value option first.
 */
// Static FALLBACK lists (curated 2026-08-21) — the admin dropdowns normally
// use the live catalog from the provider's /models endpoint (modelCatalog.ts);
// these appear only when that fetch is unavailable.
export const AVAILABLE_MODELS = {
  /** Text/chat models suitable for creative mnemonic generation */
  mnemonic: [
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-4o-mini',
    'gpt-4.1-mini',
  ],
  /** Image generation models */
  image: [
    'gpt-image-2',
    'gpt-image-1.5',
    'gpt-image-1',
    'gpt-image-1-mini',
  ],
  /** Image quality levels */
  imageQuality: [
    'low',
    'medium',
    'high',
    'auto',
  ],
  /** Text-to-speech models. Only the gpt-4o-mini-tts family honors the
   *  `instructions` accent/language steering; tts-1/hd ignore it. */
  tts: [
    'gpt-4o-mini-tts-2025-12-15',
    'gpt-4o-mini-tts-2025-03-20',
    'gpt-4o-mini-tts',
    'tts-1',
    'tts-1-hd',
  ],
};

// ---------------------------------------------------------------------------
// Claude (Anthropic) models, for mnemonic suggestions only
// ---------------------------------------------------------------------------

/** Claude models offered while mnemonic suggestions run on Anthropic. A static list (the field
 *  accepts any claude-* id); most capable first. Exact ids, never date-suffixed. */
export const ANTHROPIC_TEXT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
/** Default of ai_anthropic_mnemonic_model (the migration's column default must match). */
export const RECOMMENDED_ANTHROPIC_MODELS = { mnemonic: 'claude-opus-5-5' } as const;
/** output_config.effort on every Claude call: one-shot answers of a sentence or two. */
export const ANTHROPIC_EFFORT = 'low';
export function isClaudeModel(model?: string | null): boolean {
  return /^claude-/i.test(model?.trim() ?? '');
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/** A deck language code as a name for the prompt ('es' → 'Spanish'); null when unknown. */
function languageName(code?: string | null): string | null {
  const value = code?.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  return TTS_LANGUAGE_MAP.get(lower)
    ?? TTS_LANGUAGE_MAP.get(lower.split(/[-_]/)[0])
    // A name typed in place of a code ("Spanish") is used as it is; an unknown code is not.
    ?? (value.length > 3 ? value : null);
}

/** A list of earlier cues for the prompt: one line each (a two-line cue joined with " / "), no repeats. */
function cueList(texts: string[] | undefined): string[] {
  const lines = (texts ?? []).map((text) => text.replace(/\s*\n\s*/g, ' / ').trim()).filter(Boolean);
  return [...new Set(lines)];
}

/** A titled block of earlier cues, or '' when there are none. */
function cueBlock(title: string, texts: string[] | undefined): string {
  const lines = cueList(texts);
  return lines.length ? `\n\n${title}:\n${lines.map((line) => `- ${line}`).join('\n')}` : '';
}

/** Whether a front holds two forms: "hermano / hermana", or an attached ending, "profesor(a)". */
function hasTwoForms(front: string): boolean {
  return front.includes('/') || /\p{L}\(\p{L}{1,3}\)/u.test(front);
}

/**
 * Prompt for one mnemonic suggestion (v1.20.0), in one of two styles the teacher chooses
 * between:
 * - 'keyword' (the default): the keyword method. One short English sound-alike for the start or
 *   the stressed syllable of the word as it is said (never a chain of three or more words), in one
 *   picture where it and the meaning act on each other, so the meaning is inside the scene.
 *   Interaction is what helps recall, and bizarreness adds nothing (Wollen, Weber & Lowry 1972;
 *   Kroll, Schepeler & Angin 1986), so the prompt no longer asks for weird. A word a student
 *   would guess on sight may get "Like English X" plus the one difference that matters.
 * - 'sentence': a very short beginner example sentence with the word in capitals and its
 *   translation, for words that are hard to picture (pero, porque, también, verb forms).
 * On a Spanish deck the model is given how the word sounds, respelled with the stress in capitals
 * (spanishPronunciation), and the Spanish sounds an English reader gets wrong, so the keyword
 * matches the sound and not the spelling. It is told what was already suggested for the card in
 * this style (rejected ones included) so a new one really differs, what was suggested in the
 * other style (for reference: a keyword may come back as a picture), and the approved mnemonics
 * of the deck's other cards, so one keyword does not serve two words (pero / perro).
 * The model should respond with only the cue text.
 */
export function buildMnemonicPrompt(context: MnemonicContext): string {
  const style: MnemonicStyle = context.style === 'sentence' ? 'sentence' : 'keyword';
  const spanish = isSpanishLanguage(context.sourceLanguage);
  const wordLanguage = spanish ? 'Spanish' : languageName(context.sourceLanguage);
  const learnerLanguage = languageName(context.targetLanguage) ?? 'English';
  const learner = `${/^[aeiou]/i.test(learnerLanguage) ? 'an' : 'a'} ${learnerLanguage}-speaking`;
  const theWord = wordLanguage ? `the ${wordLanguage} word` : 'the word';
  const fromSpanish = spanish ? '' : ' from Spanish';
  const languages = [...new Set([learnerLanguage, wordLanguage ?? learnerLanguage])].join(' or ');
  const safety = `School-appropriate: no word that could be read as rude slang or a double meaning in ${languages} (for example, hoe).`;
  const twoForms = hasTwoForms(context.front);

  const pronunciation = spanish ? spanishPronunciation(context.front) : '';
  const pronunciationLine = pronunciation
    ? `\nSounds like: ${pronunciation} (English-style respelling; stressed syllable in capitals)`
    : '';

  const opening = `Write a memory cue (mnemonic) that helps ${learner} high-school student learning ${wordLanguage ?? 'a new language'} remember this flashcard.
Word: ${context.front}
Meaning: ${context.back}${pronunciationLine}`;

  let instructions: string;
  if (style === 'sentence') {
    instructions = `Teach ${theWord} through one very short, natural ${wordLanguage ? `${wordLanguage} ` : ''}example sentence that ${spanish ? 'a Spanish 1' : `a first-year${wordLanguage ? ` ${wordLanguage}` : ''}`} student can understand, using only common beginner vocabulary. Write the word in CAPITALS in the sentence, then " = " and its ${learnerLanguage} translation (example${fromSpanish}: Voy PORQUE quiero = I go because I want to).
Add a sound hook after it (under 10 words) only if a strong one exists, matches how the word sounds, and does not also fit a similar-looking word (${spanish ? '' : 'Spanish '}pero / perro). Otherwise add none.${twoForms ? '\nThe card shows two forms: use one of them in the sentence, and do not explain the -o / -a ending.' : ''}

Under 25 words in total, at most two lines. ${safety} Spell the word exactly as on the card, with its accents, and never invent a wrong pronunciation or spelling.`;
  } else {
    const steps = [
      `Pick the keyword: one familiar, concrete ${learnerLanguage} word (two short words at most) that sounds like the start or the stressed syllable of ${theWord}. It does not need to cover the whole word; never chain three or more words.`,
      ...(spanish ? [
        'Match sounds, not spelling: h is silent; j, and g before e or i, sound like English h; ll and y sound like y; qu = k; z, and c before e or i, = s; v = b; ñ = ny; vowels are pure (a = ah, e = eh, i = ee, o = oh, u = oo). Prefer a keyword whose sound does not teach a wrong Spanish sound; if the best one does (llama said with an L), add a fix of 3-6 words (ll sounds like y).',
      ] : []),
      `Make one picture in which the keyword and the meaning act on each other, so the meaning is part of the scene. Example${fromSpanish}: tengo = I have: Picture yourself holding TEN GOats on leashes: I have ten goats!`,
      spanish
        ? `If a 14-year-old would guess the meaning on sight (familia, inteligente), you may instead write: Like ${learnerLanguage} X, then the one difference that matters for saying or spelling the Spanish (inteligente: one l, g said like h). Not for words that only share letters (mi is said MEE, not "my") or that mean something else (simpático is nice, not sympathetic). Example: rápido = fast: Like English rapid (river rapids = fast water); accent on RÁ.`
        : `If a 14-year-old would guess the meaning on sight, you may instead write: Like ${learnerLanguage} X, then the one difference that matters for saying or spelling ${theWord}. Not for words that only share letters or that mean something else. Example from Spanish: rápido = fast: Like English rapid (river rapids = fast water); accent on RÁ.`,
    ];
    instructions = `Use the keyword method:
${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}${twoForms ? '\nThe card shows two forms: use their shared sound, show both meanings where natural, and do not explain the -o / -a ending.' : ''}

Write one or two short sentences, under 35 words, with the keyword in CAPITALS. It does not need to be weird or silly; it needs the keyword and the meaning together in one clear picture. ${safety} Never invent a wrong pronunciation or spelling.`;
  }

  const earlier = cueBlock(
    `Already suggested for this card in this style (write a different one, with a different ${style === 'sentence' ? 'sentence' : 'keyword'})`,
    context.alreadySuggested,
  ) + cueBlock(
    `Suggested for this card in the other style (for reference only; you may reuse a keyword from these)`,
    context.suggestedInOtherStyle,
  ) + cueBlock(
    'Chosen for other cards in this deck (do not reuse their keywords, so the cards are not mixed up)',
    context.otherCards,
  );

  return `${opening}

${instructions}${earlier}

Respond with only the cue text: plain text, no markdown, no asterisks.`;
}

/**
 * Prompt sent to the image generation model for a flashcard illustration.
 * A school-safety suffix is appended by the provider before the API call.
 */
export function buildImagePrompt(front: string, back: string): string {
  return `Create a vivid, memorable mnemonic illustration for a flashcard. The word "${front}" means "${back}". Design a creative visual that links these two concepts through visual association, wordplay, or a scene that makes the connection unforgettable. Keep it simple, colorful, and suitable for learning.`;
}

/**
 * Instructions passed to the TTS model describing accent/language style.
 */
export function buildTtsInstructions(options: {
  accent?: string;
  language?: string;
  pseudoword?: boolean;
}): string {
  const { accent, language, pseudoword } = options;
  const who = accent && language ? `a native ${accent} ${language} speaker`
    : accent ? `a native speaker with a ${accent} accent`
      : language ? `a native ${language} speaker`
        : 'a native speaker';

  // Pseudowords (invented, plausible non-words) are where the model most often
  // slips into English phonology because it cannot recognize the token — so name
  // the language explicitly and command letter-by-letter phonetics.
  if (pseudoword && language) {
    return `Read the text aloud as ${who}. Pronounce it strictly by ${language} spelling-to-sound rules, `
      + `even though it is an invented, made-up, or nonsense word — apply ${language} phonetics letter by letter `
      + `and never use English or any other language's pronunciation. Speak naturally and clearly.`;
  }
  if (language) {
    return `Read the text aloud as ${who}. Pronounce every word using ${language} spelling-to-sound rules; `
      + `do not switch to English or any other language. Speak naturally and clearly.`;
  }
  if (accent) {
    return `Speak with a ${accent} accent. Speak naturally and clearly.`;
  }
  return 'Speak naturally and clearly.';
}
