// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Time words and the tenses they agree with.
 *
 * The tense label on the prompt decides the tense; a time word adds meaning
 * and must never contradict it ("Ayer" with a present label is wrong). The
 * table is closed: the checker only knows these phrases. Phrases that fit any
 * tense (por la mañana, a las ocho, temprano) are listed so that the word
 * inside them (mañana) is not read as "tomorrow".
 *
 * The renderer adds a time word only when a deck drills more than one tense,
 * choosing one that agrees with the cell's tense and, where it can, rules out
 * the deck's other tenses. A deck with several tenses gets a warning for a
 * sentence without one (the label still decides).
 */
import type { Tense } from '../types.js';
import { NUMBER_WORDS } from './words.js';
import type { Token } from './text.js';
import type { Gender } from './types.js';

export interface TimeWord {
  /** Lowercase phrase. */
  es: string;
  /** The tenses it agrees with; 'any' for phrases that fit every tense. */
  tenses: Tense[] | 'any';
  /** English, for the feedback line. */
  en: string;
  /** Where the renderer puts it ('start': "Ayer mis primos…", 'end': "…todos los días."); unset: never rendered. */
  position?: 'start' | 'end';
  /** "de niño / de niña / de niños / de niñas" agree with the subject. */
  agrees?: { gender: 'm' | 'f'; number: 'sg' | 'pl' };
}

const PRESENTS: Tense[] = ['present', 'presentProgressive'];
const HABIT: Tense[] = ['present', 'imperfect'];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const TIME_WORDS: TimeWord[] = [
  { es: 'ahora mismo', tenses: PRESENTS, en: 'right now', position: 'start' },
  { es: 'ahora', tenses: PRESENTS, en: 'now', position: 'start' },
  { es: 'hoy', tenses: ['present', 'presentProgressive', 'preterite', 'presentPerfect', 'future'], en: 'today', position: 'start' },
  { es: 'esta noche', tenses: ['present', 'presentProgressive', 'future'], en: 'tonight', position: 'start' },
  { es: 'todos los días', tenses: ['present', 'imperfect', 'future', 'presentPerfect'], en: 'every day', position: 'end' },
  { es: 'siempre', tenses: ['present', 'imperfect', 'future', 'presentPerfect'], en: 'always' },
  { es: 'nunca', tenses: ['present', 'imperfect', 'future', 'presentPerfect', 'preterite'], en: 'never' },
  { es: 'a veces', tenses: HABIT, en: 'sometimes' },
  ...DAYS.map((d, i) => ({ es: `los ${d === 'sábado' || d === 'domingo' ? `${d}s` : d}`, tenses: HABIT, en: `on ${DAYS_EN[i]}s` })),
  ...DAYS.map((d, i) => ({ es: `el ${d}`, tenses: ['present', 'preterite', 'future'] as Tense[], en: `on ${DAYS_EN[i]}` })),
  { es: 'ayer', tenses: ['preterite'], en: 'yesterday', position: 'start' },
  { es: 'anoche', tenses: ['preterite'], en: 'last night', position: 'start' },
  { es: 'antes', tenses: ['imperfect'], en: 'before' },
  { es: 'de niño', tenses: ['imperfect'], en: 'as a child', position: 'start', agrees: { gender: 'm', number: 'sg' } },
  { es: 'de niña', tenses: ['imperfect'], en: 'as a child', position: 'start', agrees: { gender: 'f', number: 'sg' } },
  { es: 'de niños', tenses: ['imperfect'], en: 'as children', position: 'start', agrees: { gender: 'm', number: 'pl' } },
  { es: 'de niñas', tenses: ['imperfect'], en: 'as children', position: 'start', agrees: { gender: 'f', number: 'pl' } },
  { es: 'mañana', tenses: ['future', 'present'], en: 'tomorrow', position: 'start' },
  // any tense: listed so that "mañana" / "tarde" / "noche" inside them are not read on their own
  { es: 'por la mañana', tenses: 'any', en: 'in the morning' },
  { es: 'por la tarde', tenses: 'any', en: 'in the afternoon' },
  { es: 'por la noche', tenses: 'any', en: 'at night' },
  { es: 'en la mañana', tenses: 'any', en: 'in the morning' },
  { es: 'en la tarde', tenses: 'any', en: 'in the afternoon' },
  { es: 'en la noche', tenses: 'any', en: 'at night' },
  { es: 'temprano', tenses: 'any', en: 'early' },
  { es: 'tarde', tenses: 'any', en: 'late' },
  { es: 'a la una', tenses: 'any', en: 'at one' },
];

const BY_LENGTH = [...TIME_WORDS].sort((a, b) => b.es.split(' ').length - a.es.split(' ').length);

export interface FoundTimeWord {
  word: TimeWord;
  /** Index of the first token and the number of tokens. */
  start: number;
  length: number;
}

/**
 * The time words in a run of word tokens, longest match first, left to right.
 * "a las ocho" (a las + a number) is a clock time, any tense.
 */
export function findTimeWords(tokens: Token[]): FoundTimeWord[] {
  const out: FoundTimeWord[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].low === 'a' && tokens[i + 1]?.low === 'las' && tokens[i + 2] && NUMBER_WORDS.has(tokens[i + 2].low)) {
      out.push({ word: { es: `a las ${tokens[i + 2].low}`, tenses: 'any', en: 'at' }, start: i, length: 3 });
      i += 3;
      continue;
    }
    const hit = BY_LENGTH.find((w) => {
      const parts = w.es.split(' ');
      return parts.every((p, k) => tokens[i + k]?.low === p);
    });
    if (hit) {
      const length = hit.es.split(' ').length;
      out.push({ word: hit, start: i, length });
      i += length;
    } else i++;
  }
  return out;
}

/** Whether a time word agrees with a tense. */
export function timeWordFits(word: TimeWord, tense: Tense): boolean {
  return word.tenses === 'any' || word.tenses.includes(tense);
}

/** Preferred rendered time words per tense, in order. */
const PREFERRED: Partial<Record<Tense, string[]>> = {
  present: ['todos los días', 'hoy', 'ahora'],
  presentProgressive: ['ahora', 'ahora mismo'],
  preterite: ['ayer', 'anoche'],
  imperfect: ['de niño', 'de niña', 'de niños', 'de niñas'],
  future: ['mañana'],
  presentPerfect: ['hoy'],
};

/**
 * The time word the renderer adds to a sentence of a multi-tense deck: one
 * that agrees with `tense`, is in the deck's vocabulary (`known`), agrees with
 * the subject (de niña) and, preferably, rules out the deck's other tenses.
 * Null when none fits (the sentence then carries a "no time word" warning).
 */
export function chooseTimeWord(
  tense: Tense,
  deckTenses: Tense[],
  known: (phrase: string) => boolean,
  subject: { gender: Gender; number: 'sg' | 'pl'; person: boolean; lemmas: string[] } | null,
  habitual = true,
): TimeWord | null {
  // a one-off action reads better with "ahora" than with "todos los días" (Ahora mi abuelo compra un libro)
  const preferred = tense === 'present' && !habitual ? ['ahora', 'hoy'] : PREFERRED[tense] ?? [];
  const options = preferred
    .map((es) => TIME_WORDS.find((w) => w.es === es))
    .filter((w): w is TimeWord => !!w && !!w.position && known(w.es))
    .filter((w) => {
      if (!w.agrees) return true;
      // "de niño" only for people, and not for "los niños" themselves
      if (!subject || subject.gender === 'x' || !subject.person) return false;
      if (subject.lemmas.some((l) => l === 'niño' || l === 'niña' || l === 'bebé')) return false;
      return w.agrees.gender === subject.gender && w.agrees.number === subject.number;
    });
  const others = deckTenses.filter((t) => t !== tense);
  const exclusive = options.find((w) => others.every((t) => !timeWordFits(w, t)));
  return exclusive ?? options[0] ?? null;
}
