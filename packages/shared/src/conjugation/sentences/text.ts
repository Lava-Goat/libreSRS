// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** Tokenising and spelling helpers for the sentence engine. */
import { foldAccents } from '../accent.js';

export interface Token {
  /** As written (NFC). */
  text: string;
  /** Lowercase, accents kept: what agreement and person rules read (él ≠ el). */
  low: string;
  /** Lowercase, accents folded: what the vocabulary lookup reads. */
  fold: string;
  /** Starts with a capital letter. */
  cap: boolean;
  /** A punctuation mark (, . ; : ¡ ! ¿ ?) rather than a word. */
  punct: boolean;
}

const WORD_OR_PUNCT = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+(?:['’][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)?|[,.;:¡!¿?]/g;

/** Splits a stretch of Spanish into word and punctuation tokens. */
export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  for (const m of s.normalize('NFC').matchAll(WORD_OR_PUNCT)) {
    const text = m[0];
    const punct = /^[,.;:¡!¿?]$/.test(text);
    const low = text.toLowerCase();
    out.push({ text, low, fold: foldAccents(low), cap: !punct && text[0] !== low[0], punct });
  }
  return out;
}

/** The word tokens only. */
export function words(tokens: Token[]): Token[] {
  return tokens.filter((t) => !t.punct);
}

/** Folds case and accents (for keys and vocabulary). */
export function fold(s: string): string {
  return foldAccents(s.normalize('NFC').toLowerCase());
}

/** a + el → al, de + el → del (never before él, which keeps its accent). */
export function contract(s: string): string {
  // JavaScript's \b does not know accented letters ("Sofía el" is not "a el"), so spell the boundaries out
  return s
    .replace(/(^|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ])([Aa]) el(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1$2l')
    .replace(/(^|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ])([Dd])e el(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1$2el');
}

/** First letter upper-case. */
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A slug for refs: lowercase, folded, dashes. */
export function slug(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9ñ]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Collapses spaces and fixes the space before punctuation. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
