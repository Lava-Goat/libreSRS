// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How a Spanish card front is said, for the mnemonic prompt (v1.20.0): an English-style respelling
 * (Latin American Spanish) with the stressed syllable in capitals.
 *
 *   tengo → TEHN-goh   hijo / hija → EE-hoh / EE-hah   se llama → seh YAH-mah   gente → HEHN-teh
 *
 * The model is given this line so its sound-alike keyword matches the word as it sounds (TEN GOats
 * for tengo), instead of guessing: language models judge sounds and stress poorly, and a spelled
 * line misleads them (HI-jo read as "hi, Joe", GEN-te as "gentle", LLA-ma as an English llama).
 * Spanish spelling fixes both by rule, so this needs no model and no dependency:
 *
 * - Syllables. ch, ll and rr are one consonant; qu, and gu before e or i, are one consonant with
 *   a silent u. One consonant between vowels starts the next syllable; of two or more, the next
 *   syllable takes the last two when they are a cluster that cannot be split (pl pr bl br cl cr
 *   dr tr fl fr gl gr kl kr), else the last one.
 * - Vowels. a, e, o are strong; i, u, ü are weak. A weak vowel next to any other vowel forms a
 *   diphthong (one syllable: QUIE-ro, ciu-DAD), unless it carries the accent (í, ú: DÍ-a, pa-ÍS).
 *   Two strong vowels are two syllables (cum-ple-A-ños, FE-o). y is a vowel at the end of a word
 *   (muy, estoy) or alone ("y" = and), and a consonant before a vowel (yo, ma-yo).
 * - Stress. The written accent; else the next-to-last syllable when the word ends in a vowel, n or
 *   s; else the last (final y counts as a consonant: es-TOY).
 * - Sounds (respellSpanishWord). Vowels are pure (a = ah, e = eh, i = ee, o = oh, u = oo) and a
 *   joined weak vowel is a glide (ie = yeh, ue = weh, ai = eye); h is silent; j, and g before e or
 *   i, are h; ll and consonant y are y; ñ is ny; qu is k; z, and c before e or i, are s; v is b;
 *   x is ks (h in México); rr, and r at the start of a word or after n, l or s, is trilled (rr).
 *
 * In a phrase, the little words Spanish never stresses (me, se, el, la, de, por, que, mi, …) stay
 * in lower case: meh YAH-moh, pohr fah-BOHR, pohr KEH. A word on its own is always stressed (EHL /
 * LAH). spanishSyllables gives the same syllables as spelled (HI-jo / HI-ja). Only for decks whose
 * front is Spanish (isSpanishLanguage).
 */

/** A deck language code (or name) that means Spanish: 'es', 'es-MX', 'es_419', 'Spanish'. */
export function isSpanishLanguage(language: string | null | undefined): boolean {
  const value = language?.trim().toLowerCase() ?? '';
  return /^es(?:[-_][a-z0-9]+)?$/.test(value) || value === 'spanish' || value === 'español';
}

/** One spelled sound: a consonant (ch, ll, rr, qu and gu count as one) or a vowel. */
interface Unit {
  text: string;
  vowel: boolean;
  /** a, e, o, and an accented í or ú (which never joins another vowel). */
  strong: boolean;
  /** Carries a written accent: á é í ó ú. */
  accented: boolean;
}

interface Syllable {
  onset: Unit[];
  nucleus: Unit[];
  coda: Unit[];
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü']);
const ACCENTED = new Set(['á', 'é', 'í', 'ó', 'ú']);
const WEAK = new Set(['i', 'u', 'ü']);
const FRONT_VOWELS = new Set(['e', 'i', 'é', 'í']);
/** Consonant pairs that always start a syllable together (ha-blar, ma-dre, o-tro). */
const ONSET_CLUSTERS = new Set(['pl', 'pr', 'bl', 'br', 'cl', 'cr', 'dr', 'tr', 'fl', 'fr', 'gl', 'gr', 'kl', 'kr']);

/**
 * Little words with no stress of their own inside a phrase: definite articles, object and
 * reflexive pronouns, short prepositions and conjunctions, unaccented que and si, and the
 * possessives before a noun. Accented forms (qué, él, tú, mí, sí) are different words and stressed.
 */
const UNSTRESSED_IN_PHRASE = new Set([
  'el', 'la', 'los', 'las', 'lo',
  'me', 'te', 'se', 'le', 'les', 'nos', 'os',
  'a', 'al', 'de', 'del', 'en', 'con', 'sin', 'por', 'para',
  'y', 'e', 'o', 'u', 'ni', 'que', 'si',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus',
]);

function vowelUnit(letter: string): Unit {
  const accented = ACCENTED.has(letter);
  return { text: letter, vowel: true, strong: accented || !WEAK.has(letter), accented };
}

function consonant(text: string): Unit {
  return { text, vowel: false, strong: false, accented: false };
}

/** A lower-case word as spelled sounds. */
function units(word: string): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const next = word[i + 1] ?? '';
    const after = word[i + 2] ?? '';
    if (VOWELS.has(c)) {
      out.push(vowelUnit(c));
    } else if (c === 'y') {
      // A consonant before a vowel (yo, ma-yo, re-yes); otherwise the vowel i (muy, hay, "y").
      out.push(VOWELS.has(next) ? consonant('y') : { text: 'y', vowel: true, strong: false, accented: false });
    } else if ((c === 'c' && next === 'h') || (c === 'l' && next === 'l') || (c === 'r' && next === 'r')) {
      out.push(consonant(c + next));
      i++;
    } else if (c === 'q' && next === 'u') {
      out.push(consonant('qu')); // the u is silent: QUIE-ro, POR-que
      i++;
    } else if (c === 'g' && next === 'u' && FRONT_VOWELS.has(after)) {
      out.push(consonant('gu')); // silent u before e or i: gui-TA-rra; gü keeps its sound
      i++;
    } else {
      out.push(consonant(c));
    }
  }
  return out;
}

/** Whether vowel `v` joins the vowel group `group` it directly follows (a diphthong or triphthong). */
function joins(group: Unit[], v: Unit): boolean {
  const last = group[group.length - 1];
  if (group.length >= 3) return false;
  // An accented í or ú stands alone (DÍ-a, pa-ÍS); two strong vowels are two syllables (FE-o).
  if ((last.accented && WEAK.has(last.text)) || (v.accented && WEAK.has(v.text))) return false;
  if (v.strong && group.some((u) => u.strong)) return false;
  // The same weak vowel twice (chi-i-ta) is two syllables.
  if (!v.strong && !last.strong && v.text === last.text) return false;
  return true;
}

function syllabify(word: string): Syllable[] {
  // Consonants and vowel groups, in order.
  const items: (Unit | Unit[])[] = [];
  for (const u of units(word)) {
    const prev = items[items.length - 1];
    if (u.vowel && Array.isArray(prev) && joins(prev, u)) {
      prev.push(u);
    } else {
      items.push(u.vowel ? [u] : u);
    }
  }

  const syllables: Syllable[] = [];
  let consonants: Unit[] = [];
  for (const item of items) {
    if (!Array.isArray(item)) {
      consonants.push(item);
      continue;
    }
    if (syllables.length === 0) {
      syllables.push({ onset: consonants, nucleus: item, coda: [] });
    } else {
      // Split the consonants between two vowels: the next syllable takes an unsplittable
      // cluster or the last consonant, the one before keeps the rest.
      const lastTwo = consonants.slice(-2).map((u) => u.text).join('');
      const onsetLength = consonants.length >= 2 && ONSET_CLUSTERS.has(lastTwo) ? 2 : Math.min(consonants.length, 1);
      syllables[syllables.length - 1].coda.push(...consonants.slice(0, consonants.length - onsetLength));
      syllables.push({ onset: consonants.slice(consonants.length - onsetLength), nucleus: item, coda: [] });
    }
    consonants = [];
  }
  if (syllables.length > 0) syllables[syllables.length - 1].coda.push(...consonants);
  return syllables;
}

/** Index of the stressed syllable: the written accent, else by the word's last letter. */
function stressedIndex(word: string, syllables: Syllable[]): number {
  const marked = syllables.findIndex((s) => s.nucleus.some((u) => u.accented));
  if (marked >= 0) return marked;
  if (syllables.length < 2) return 0;
  return /[aeiouns]$/.test(word) ? syllables.length - 2 : syllables.length - 1;
}

/**
 * One word as syllables joined by "-", the stressed one in capitals (rápido → RÁ-pi-do). With
 * `unstressed`, all in lower case (a little word inside a phrase). A word with no vowel comes
 * back as it is, in lower case.
 */
export function syllabifySpanishWord(word: string, unstressed = false): string {
  const lower = word.normalize('NFC').toLowerCase();
  const syllables = syllabify(lower);
  if (syllables.length === 0) return lower;
  const stressed = unstressed ? -1 : stressedIndex(lower, syllables);
  return syllables
    .map((s, i) => {
      const text = [...s.onset, ...s.nucleus, ...s.coda].map((u) => u.text).join('');
      return i === stressed ? text.toUpperCase() : text;
    })
    .join('-');
}

/** A vowel's sound key: accents and the dieresis dropped, a vowel y read as i. */
function vowelKey(text: string): string {
  return ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', y: 'i' } as Record<string, string>)[text] ?? text;
}

/** How a syllable's vowels sound to an English reader: pure vowels, and glides for joined weak ones. */
const VOWEL_SOUNDS: Record<string, string> = {
  a: 'ah', e: 'eh', i: 'ee', o: 'oh', u: 'oo',
  ia: 'yah', ie: 'yeh', io: 'yoh', iu: 'yoo',
  ua: 'wah', ue: 'weh', uo: 'woh', ui: 'wee',
  ai: 'eye', ei: 'ay', oi: 'oy', au: 'ow', eu: 'ehoo', ou: 'ohoo',
};

function vowelSound(nucleus: Unit[], afterConsonant: boolean): string {
  const key = nucleus.map((u) => vowelKey(u.text)).join('');
  // ai after a consonant: BYE-leh, not BEYE-leh (hay stays EYE).
  const sound = (k: string) => (k === 'ai' && afterConsonant ? 'ye' : VOWEL_SOUNDS[k]);
  if (sound(key)) return sound(key);
  // A triphthong: a glide, then the diphthong (buey → BWAY, Uruguay → oo-roo-GWYE).
  if (key.length === 3 && sound(key.slice(1))) return (key[0] === 'i' ? 'y' : 'w') + sound(key.slice(1));
  return nucleus.map((u) => VOWEL_SOUNDS[vowelKey(u.text)] ?? u.text).join('');
}

/** A consonant's sound, given the unit after it in the word. */
function consonantSound(u: Unit, next: Unit | undefined, trilled: boolean, mexico: boolean): string {
  const beforeEorI = next !== undefined && next.vowel && (vowelKey(next.text) === 'e' || vowelKey(next.text) === 'i');
  switch (u.text) {
    case 'h': return '';
    case 'v': return 'b';
    case 'j': return 'h';
    case 'z': return 's';
    case 'll': return 'y';
    case 'ñ': return 'ny';
    case 'qu': return 'k';
    case 'gu': return 'g';
    case 'c': return beforeEorI ? 's' : 'k';
    case 'g': return beforeEorI ? 'h' : 'g';
    case 'x': return mexico ? 'h' : 'ks';
    case 'r': return trilled ? 'rr' : 'r';
    default: return u.text;
  }
}

/**
 * One word as it sounds, in English-style syllables joined by "-", the stressed one in capitals
 * (hijo → EE-hoh, gente → HEHN-teh). With `unstressed`, all in lower case (a little word inside a
 * phrase). A word with no vowel comes back as it is, in lower case.
 */
export function respellSpanishWord(word: string, unstressed = false): string {
  const lower = word.normalize('NFC').toLowerCase();
  const syllables = syllabify(lower);
  if (syllables.length === 0) return lower;
  const stressed = unstressed ? -1 : stressedIndex(lower, syllables);
  const sequence = syllables.flatMap((s) => [...s.onset, ...s.nucleus, ...s.coda]);
  const mexico = /^m[eé]xic/.test(lower);
  let position = 0;
  return syllables
    .map((s, i) => {
      const previousCoda = i > 0 ? syllables[i - 1].coda : [];
      const sayConsonant = (u: Unit, first: boolean) => {
        const next = sequence[position + 1];
        // A single r is trilled at the start of a word and after n, l or s (Enrique, alrededor).
        const trilled = u.text === 'r' && first
          && (i === 0 || ['n', 'l', 's'].includes(previousCoda[previousCoda.length - 1]?.text ?? ''));
        position++;
        return consonantSound(u, next, trilled, mexico);
      };
      const onset = s.onset.map((u, k) => sayConsonant(u, k === 0)).join('');
      position += s.nucleus.length;
      let vowels = vowelSound(s.nucleus, onset !== '');
      // A hard g before an e or i sound is written gh, so it is not read as the g of "gem".
      if (onset.endsWith('g') && /^[eiy]/.test(vowels)) vowels = `h${vowels}`;
      const coda = s.coda.map((u) => sayConsonant(u, false)).join('');
      const text = onset + vowels + coda;
      return i === stressed ? text.toUpperCase() : text;
    })
    .join('-');
}

const WORD = /[\p{L}]+/gu;

/** One form of a front ("hijo", "me llamo", "uno, dos, tres…"), punctuation dropped but commas kept. */
function pronounceForm(form: string, sayWord: (word: string, unstressed: boolean) => string): string {
  // Everything but letters, digits and commas goes: ¿ ¡ ? !, quotes, brackets, ellipses, and a
  // hyphen, which would read as a syllable break.
  const cleaned = form.replace(/[^\p{L}\p{M}\p{N}\s,]/gu, ' ');
  const words = cleaned.match(WORD) ?? [];
  if (words.length === 0) return '';
  const isPhrase = words.length > 1;
  // A phrase made only of little words ("de la") keeps their stress rather than showing none.
  const allLittle = words.every((w) => UNSTRESSED_IN_PHRASE.has(w.toLowerCase()));
  return cleaned
    .replace(WORD, (w) => sayWord(w, isPhrase && !allLittle && UNSTRESSED_IN_PHRASE.has(w.toLowerCase())))
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^,\s*|,$/g, '')
    .trim();
}

/**
 * Card notation that is not said, as speechText reads it: markup and entities go, an attached
 * short ending is a second form ("profesor(a)" → "profesor / profesora", "amigo(a)" → "amigo /
 * amiga"), and a detached parenthesis is a gloss for the reader ("es (ser)", "usted (formal)").
 */
function sayableText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/(\p{L}+)\((\p{L}{1,3})\)/gu, (_m, stem: string, ending: string) => {
      // Spanish adds the feminine after a consonant but replaces a final vowel with it.
      const replacesVowel = /[aeiouáéíóú]$/i.test(stem) && /^[aeiouáéíóú]/i.test(ending);
      return `${stem} / ${replacesVowel ? stem.slice(0, -1) : stem}${ending}`;
    })
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s*\([^)]*$/, ' ');
}

/** A card's text, form by form ("hijo / hija"), each word said by `sayWord`. */
function sayCardText(text: string, sayWord: (word: string, unstressed: boolean) => string): string {
  return sayableText(text)
    .split('/')
    .map((form) => pronounceForm(form, sayWord))
    .filter(Boolean)
    .join(' / ');
}

/**
 * A card's Spanish text as it is spelled, in syllables with the stressed one in capitals: the forms
 * of a slash card kept apart ("hijo / hija" → "HI-jo / HI-ja"), punctuation and glosses dropped.
 * '' when the text has no word to say.
 */
export function spanishSyllables(text: string): string {
  return sayCardText(text, syllabifySpanishWord);
}

/**
 * A card's Spanish text as it sounds, for the mnemonic prompt: the same syllables and stress as
 * spanishSyllables, respelled for an English reader ("hijo / hija" → "EE-hoh / EE-hah", "¿Cómo se
 * llama?" → "KOH-moh seh YAH-mah"). '' when the text has no word to say.
 */
export function spanishPronunciation(text: string): string {
  return sayCardText(text, respellSpanishWord);
}
