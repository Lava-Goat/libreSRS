// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The vocabulary rule's word lists, and the compiled view of a deck that the
 * renderer and the checker share (deck context). Everything is pure and
 * deterministic; a context is cached per settings object.
 */
import { analyze } from '../analyze.js';
import { parseEntry } from '../conjugate.js';
import { detectVerbs, type DeckCard } from '../detect.js';
import { cellsFor, type Cell } from '../entries.js';
import { CORE_WORDS } from './words.js';
import { fold } from './text.js';
import type { SentenceDeck } from './types.js';

export interface DeckContext {
  deck: SentenceDeck;
  /** Folded keys of every allowed word (cards, earlier cards, core list). */
  vocab: Set<string>;
  /** Folded keys allowed only because the teacher approved them. */
  approved: Set<string>;
  /** Infinitives (and their -se forms) of every verb on the cards. */
  infinitives: Set<string>;
  /** Lowercase words on the cards that are not verb cards (cuenta = bill), never read as verbs. */
  nonVerbCardWords: Set<string>;
  /** Drilled cells per entry, under the deck's tenses, vosotros and vos. */
  cells: Map<string, Cell[]>;
}

/** The words of a card front: "el (la) primo(a)" → el, la, primo, prima; "hambre (tiene hambre)" → hambre, tiene. */
export function frontWords(front: string): string[] {
  const out: string[] = [];
  const s = front.normalize('NFC').toLowerCase();
  // primo(a), amigo(a): both forms
  for (const m of s.matchAll(/([a-zñáéíóúü]+)o\(a\)/g)) out.push(`${m[1]}o`, `${m[1]}a`);
  for (const w of s.replace(/\(a\)/g, '').split(/[^a-zñáéíóúü]+/)) if (w) out.push(w);
  return out;
}

/**
 * Folded lookup keys a word may match on the list: itself, its singular and
 * its masculine (alta → alto, lápices → lápiz, jóvenes → joven, trabajadoras → trabajador).
 */
export function lookupKeys(word: string): string[] {
  const w = fold(word);
  const keys = new Set<string>([w]);
  const stems = new Set<string>([w]);
  if (w.endsWith('ces')) stems.add(`${w.slice(0, -3)}z`);
  if (w.endsWith('es')) stems.add(w.slice(0, -2));
  if (w.endsWith('s')) stems.add(w.slice(0, -1));
  for (const s of stems) {
    keys.add(s);
    if (s.endsWith('a')) keys.add(`${s.slice(0, -1)}o`);
    if (s.endsWith('ora')) keys.add(s.slice(0, -1));
  }
  return [...keys];
}

const cache = new WeakMap<SentenceDeck, DeckContext>();

/** The compiled view of a deck (cached per settings object). */
export function deckContext(deck: SentenceDeck | DeckContext): DeckContext {
  if ('vocab' in deck) return deck;
  const hit = cache.get(deck);
  if (hit) return hit;
  const cards: DeckCard[] = [...(deck.earlierCards ?? []), ...deck.cards];
  const vocab = new Set<string>(CORE_WORDS.map(fold));
  for (const c of cards) for (const w of frontWords(c.front)) vocab.add(fold(w));

  const infinitives = new Set<string>();
  const verbCards = new Set<DeckCard>();
  for (const v of detectVerbs(cards)) {
    const parsed = parseEntry(v.infinitive);
    if (!parsed) continue;
    infinitives.add(parsed.base);
    if (parsed.kind === 'pronominal') infinitives.add(parsed.id);
    for (const c of v.cards) verbCards.add(c);
  }
  for (const e of deck.entries) {
    const parsed = parseEntry(e);
    if (parsed) infinitives.add(parsed.base);
  }
  for (const inf of infinitives) vocab.add(fold(inf));

  const nonVerbCardWords = new Set<string>();
  // a non-verb card's own words, not its examples in parentheses ("hambre (tiene hambre)": hambre only)
  for (const c of cards) {
    if (verbCards.has(c)) continue;
    for (const w of frontWords(c.front.replace(/\((?!a\))[^)]*\)/g, ' '))) nonVerbCardWords.add(w);
  }

  const approved = new Set<string>((deck.approvedWords ?? []).map(fold));
  const cells = new Map<string, Cell[]>();
  for (const e of deck.entries) cells.set(e, cellsFor(e, deck.tenses, { vosotros: deck.vosotros, vos: deck.vos }));

  const ctx: DeckContext = { deck, vocab, approved, infinitives, nonVerbCardWords, cells };
  cache.set(deck, ctx);
  return ctx;
}

/**
 * Whether a word is allowed: on the list (by one of its lookup keys), or a
 * conjugated form of a verb on the cards (that is the second-verb rule's
 * business, not this one's). 'approved' when only the teacher's list has it.
 */
export function wordStatus(word: string, ctx: DeckContext): 'ok' | 'approved' | 'unknown' {
  if (/^\d+$/.test(word)) return 'ok';
  const keys = lookupKeys(word);
  if (keys.some((k) => ctx.vocab.has(k))) return 'ok';
  const readings = analyze(word.toLowerCase());
  if (readings.some((r) => ctx.infinitives.has(parseEntry(r.infinitive)?.base ?? ''))) return 'ok';
  if (keys.some((k) => ctx.approved.has(k))) return 'approved';
  return 'unknown';
}

/** Words of a text the deck does not know (folded duplicates removed, in order). */
export function unknownWords(text: string, ctx: DeckContext): string[] {
  const out: string[] = [];
  for (const w of text.normalize('NFC').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/)) {
    if (w && wordStatus(w, ctx) === 'unknown' && !out.includes(w)) out.push(w);
  }
  return out;
}
