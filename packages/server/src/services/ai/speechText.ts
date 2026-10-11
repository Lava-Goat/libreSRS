// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Turns card text into something a TTS voice should actually say.
 *
 * Vocabulary cards carry editorial notation that is meant for the eye, not the
 * ear. Read literally, "profesor(a)" and "he/she/it is (ser)" come out as
 * "profesor paréntesis a" and a run-on with a stray lemma.
 *
 * IMPORTANT: this is also the asset lookup key. `ai_assets.prompt` stores the
 * normalized text and routers/ai.ts matches sides with the same function — the
 * two must never drift, or generated audio becomes unfindable.
 */

/** Tags out, line breaks to spaces so `a<br>b` does not become `ab`. */
function stripMarkup(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

export function normalizeForSpeech(raw: string): string {
  const stripped = stripMarkup(raw).trim();

  let text = stripped
    // "profesor(a)" → "profesor, profesora": an attached short parenthetical is
    // an inflection, so speak BOTH forms rather than dropping or spelling it.
    // Spanish writes the feminine two ways — appended after a consonant
    // (profesor → profesora) but REPLACING a final vowel (amigo(a) → amiga) —
    // so a naive concatenation would invent "amigoa".
    .replace(
      /(\p{L}[\p{L}\p{M}'’-]*)\(([\p{L}\p{M}]{1,3})\)/gu,
      (_m, stem: string, suffix: string) => {
        const stemEndsInVowel = /[aeiouáéíóú]$/i.test(stem);
        const suffixStartsWithVowel = /^[aeiouáéíóú]/i.test(suffix);
        const inflected = stemEndsInVowel && suffixStartsWithVowel
          ? stem.slice(0, -1) + suffix
          : stem + suffix;
        return `${stem}, ${inflected}`;
      },
    )
    // A detached parenthetical is a gloss for the reader — "(ser)", "(formal)",
    // "(location/feeling)" — and must not be spoken.
    .replace(/\s*\([^)]*\)/g, '')
    // Unclosed parenthesis: treat the rest as gloss rather than reading "(".
    .replace(/\s*\([^)]*$/g, '')
    // Alternatives: "el / la", "he/she/it" → comma pauses, so the voice reads
    // every form instead of saying "slash" or running them together.
    .replace(/\s*\/\s*/g, ', ');

  text = text
    .replace(/\s*,\s*(?=,)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();

  // Never hand back an empty string — a card that is nothing but a gloss should
  // still say something, so fall back to the plain stripped text.
  return text || stripped;
}

/**
 * An elicited-imitation sentence as it should be spoken: exactly as written,
 * less markup and stray whitespace. Not normalizeForSpeech — its flashcard
 * rules (drop "(gloss)", "a/b" → "a, b") would make the clip say something
 * other than the text the student's repetition is scored against.
 */
export function sentenceForSpeech(raw: string): string {
  return stripMarkup(raw).replace(/\s+/g, ' ').trim();
}

/**
 * Context that primes the voice into the right language without being spoken.
 *
 * ElevenLabs only accepts `language_code` on flash/turbo models, so on
 * multilingual_v2 an isolated word carries no language signal at all — and a
 * word spelled the same in both languages ("color", "animal", "hospital") gets
 * read in English. `previous_text` is not spoken but does condition the
 * generation, which is the only language lever that model offers.
 */
const LANGUAGE_PRIMES: Readonly<Record<string, string>> = {
  es: 'Estamos practicando el vocabulario en español. La siguiente palabra en español es:',
  en: 'We are practicing English vocabulary. The next English word is:',
  fr: 'Nous pratiquons le vocabulaire français. Le mot français suivant est :',
  de: 'Wir üben deutschen Wortschatz. Das nächste deutsche Wort ist:',
  it: 'Stiamo praticando il vocabolario italiano. La prossima parola italiana è:',
  pt: 'Estamos praticando o vocabulário português. A próxima palavra em português é:',
};

/** Primes for a whole sentence (elicited imitation); other languages fall back
 *  to the word prime, which still carries the language. */
const SENTENCE_PRIMES: Readonly<Record<string, string>> = {
  es: 'Estamos practicando el español. Escucha con atención la siguiente frase en español:',
  en: 'We are practicing English. Listen carefully to the next English sentence:',
};

export function speechLanguagePrime(iso?: string | null, kind: 'word' | 'sentence' = 'word'): string | undefined {
  if (!iso) return undefined;
  const lang = iso.toLowerCase().split('-')[0];
  return (kind === 'sentence' ? SENTENCE_PRIMES[lang] : undefined) ?? LANGUAGE_PRIMES[lang];
}
