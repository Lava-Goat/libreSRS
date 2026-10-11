// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What a deck's sentences are drawn from (v1.25.0), read from the database:
 * the deck's cards, the cards of the decks before it in the same groups (the
 * vocabulary a sentence may use, with the core list), the deck's hidden
 * built-in sentences and its written rows (conjugation_sentences). Read
 * synchronously, so a prompt can be built inside the answer's transaction.
 *
 * The SentenceDeck object is kept for as long as the data is the same (its
 * key), so the engine's own caches (deckContext, the cell pools) are hit
 * from one answer to the next.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { SentenceDeck } from '@libresrs/shared/conjugation/sentences';
import { db, schema } from '../db/index.js';
import { ALL_GROUP_NAME } from './allGroup.js';
import { hash32, type SentenceSourceData, type WrittenRow } from './conjugationSentences.js';
import type { QuizSettings } from './conjugationQuiz.js';

/** A database handle or a transaction: anything that can select. */
type Reader = Pick<typeof db, 'select' | 'selectDistinct'>;

const decksCache = new Map<string, SentenceDeck>();
const CACHE_MAX = 60;

interface CardRow { id: number; front: string; back: string }

/**
 * The decks before a deck in its groups (the "All" group aside, which holds every student): created earlier,
 * or at the same time with a smaller id. Oldest first.
 */
export function earlierDeckIds(r: Reader, deckId: number): number[] {
  const D = schema.decks;
  const G = schema.deckGroups;
  const me = r.select({ createdAt: D.createdAt }).from(D).where(eq(D.id, deckId)).get();
  if (!me) return [];
  const groups = r.select({ groupId: G.groupId }).from(G)
    .innerJoin(schema.groups, eq(schema.groups.id, G.groupId))
    .where(and(eq(G.deckId, deckId), ne(schema.groups.name, ALL_GROUP_NAME)))
    .all()
    .map((g) => g.groupId);
  if (groups.length === 0) return [];
  const rows = r.selectDistinct({ id: D.id, createdAt: D.createdAt }).from(D)
    .innerJoin(G, eq(G.deckId, D.id))
    .where(and(inArray(G.groupId, groups), ne(D.id, deckId)))
    .all();
  const mine = me.createdAt.getTime();
  return rows
    .filter((d) => d.createdAt.getTime() < mine || (d.createdAt.getTime() === mine && d.id < deckId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
    .map((d) => d.id);
}

function cardsOf(r: Reader, deckIds: readonly number[]): CardRow[] {
  if (deckIds.length === 0) return [];
  const C = schema.cards;
  const rows = r.select({ id: C.id, deckId: C.deckId, front: C.front, back: C.back }).from(C)
    .where(inArray(C.deckId, [...deckIds]))
    .orderBy(asc(C.id))
    .all();
  // In the decks' order, then by card.
  const order = new Map(deckIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.deckId) ?? 0) - (order.get(b.deckId) ?? 0) || a.id - b.id);
}

/** A deck's written rows and hidden built-ins. */
export function sentenceRowsOf(r: Reader, deckId: number) {
  return r.select().from(schema.conjugationSentences).where(eq(schema.conjugationSentences.deckId, deckId)).all();
}

const fingerprint = (cards: readonly CardRow[]) => hash32(cards.map((c) => `${c.id}\u0001${c.front}\u0001${c.back}`).join('\u0002')).toString(36);

/**
 * A deck's sentence data under some settings and drilled entries (a round's snapshot of its deck, or the
 * deck as it is now): cards, earlier cards, hidden refs and written rows.
 */
export function loadSentenceSource(
  r: Reader,
  deckId: number,
  settings: Pick<QuizSettings, 'tenses' | 'includeVosotros' | 'vos'>,
  entries: readonly string[],
): SentenceSourceData {
  const own = cardsOf(r, [deckId]);
  const earlier = cardsOf(r, earlierDeckIds(r, deckId));
  const rows = sentenceRowsOf(r, deckId);
  const hidden = new Set(rows.filter((x) => x.source === 'builtIn' && x.status === 'hidden').map((x) => x.ref));
  const written: WrittenRow[] = rows
    .filter((x) => x.source !== 'builtIn' && x.text && x.entry && x.tense && x.person)
    .map((x) => ({
      ref: x.ref,
      source: x.source as WrittenRow['source'],
      status: x.status,
      entry: x.entry as string,
      tense: x.tense as string,
      person: x.person as string,
      number: x.number,
      text: x.text as string,
      english: x.english,
    }));
  const deckKey = JSON.stringify([deckId, fingerprint(own), fingerprint(earlier), settings.tenses, !!settings.includeVosotros, settings.vos, entries]);
  let deck = decksCache.get(deckKey);
  if (deck) {
    decksCache.delete(deckKey);
  } else {
    deck = {
      tenses: [...settings.tenses],
      vosotros: !!settings.includeVosotros,
      vos: settings.vos === 'none' ? null : settings.vos,
      entries: [...entries],
      cards: own.map((c) => ({ id: c.id, front: c.front, back: c.back })),
      earlierCards: earlier.map((c) => ({ id: c.id, front: c.front, back: c.back })),
      approvedWords: [],
    };
  }
  decksCache.set(deckKey, deck);
  if (decksCache.size > CACHE_MAX) decksCache.delete(decksCache.keys().next().value as string);
  const rowsKey = hash32(JSON.stringify([[...hidden].sort(), written.map((w) => [w.ref, w.status, w.text, w.english])])).toString(36);
  return { deck, hidden, rows: written, key: `${hash32(deckKey).toString(36)}:${rowsKey}` };
}
