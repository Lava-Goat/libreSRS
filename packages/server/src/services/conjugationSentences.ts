// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Sentences with a blank for the conjugation quiz (v1.25.0): the pure
 * logic. A "give the form" prompt can be shown as a sentence ("Mis primos ___
 * (vivir) en Lima.") instead of a person label, on every rung. It is the same
 * item, graded by cell as before; a cell with no sentence keeps the label.
 *
 *  - The pool of a cell: the engine's built-in sentences (renderCandidates,
 *    each checked by validate) less those the teacher hid, and/or the deck's
 *    approved written rows (checked again on every use), by the deck's mode.
 *    A sentence that fails the checker under the deck's settings is parked:
 *    never shown, listed for the teacher.
 *  - The pick: the sentence this student has seen least recently, the seed
 *    breaking ties (pickPromptSentence); a retry keeps the subject it missed.
 *  - The holdback: per student, half the verbs (a fixed hash
 *    of student and verb) show sentences and half the label; the first answer
 *    7 or more days after the item's first showing in the deck is the probe,
 *    shown either way 50/50. A form with no sentence is left out of it.
 *  - Grading: a typed answer that echoes the sentence ("mis primos viven en
 *    Lima") is trimmed to the blank first (withoutContext), never cutting a
 *    word of the answer (se, no, le).
 *
 * What reaches the browser is the sentence with its blank, never its answer,
 * and the English only with the answer's response (it gives person and tense
 * away). No database here: services/conjugationSentenceSource.ts loads a
 * deck's cards and rows, routers/conjugation.ts stores answers.
 */
import {
  deckContext,
  experiencerBank,
  filledIn,
  fold,
  frontWords,
  lookupKeys,
  NAMES,
  renderCandidates,
  splitSentence,
  subjectBank,
  tokenize,
  validate,
  validateText,
  type DeckContext,
  type ParsedSubject,
  type Problem,
  type RenderedSentence,
  type SentenceCell,
  type SentenceDeck,
  type SubjectKind,
  type WarningCode,
} from '@libresrs/shared/conjugation/sentences';
import { foldAccents, normalizeAnswer, parseEntry, type Grade, type Person } from '@libresrs/shared/conjugation';

// ---------------------------------------------------------------------------
// Settings

/** How a deck shows its "give the form" prompts. */
export const SENTENCE_MODES = ['off', 'builtIn', 'approved', 'both'] as const;
export type SentenceMode = (typeof SENTENCE_MODES)[number];
export const DEFAULT_SENTENCE_MODE: SentenceMode = 'off';

export const isSentenceMode = (value: unknown): value is SentenceMode => (SENTENCE_MODES as readonly unknown[]).includes(value);

/** Where a sentence comes from: the engine's frames, or a row written for the deck. */
export type SentenceSource = 'builtIn' | 'teacher' | 'ai';

// ---------------------------------------------------------------------------
// Shapes

/** Who a sentence's subject is: as written, the pronoun it stands for (null when it is one), the engine person. */
export interface SentenceSubject {
  /** As the feedback line writes it: "mis primos", "Ana y Luis", "a mi abuela". */
  es: string;
  /**
   * The pronoun the subject stands for ("ellos", "ella", "a ellas"; a thing too: "las mochilas" is ellas, as the
   * guide says); null for a pronoun subject or hay.
   */
  pronoun: string | null;
  person: Person;
  kind: SubjectKind;
}

/** A word of the sentence and its meaning, from the deck's cards (Word help). */
export interface Gloss {
  es: string;
  en: string;
}

/** A sentence as a built prompt keeps it (server side). The answers are the prompt's `accepted`. */
export interface PromptSentence {
  /** Stable: a built-in sentence's ref (tpl:…), or a written row's (row:…). conjugation_answers.sentence_ref. */
  ref: string;
  source: SentenceSource;
  before: string;
  after: string;
  /** What the parentheses show ("vivir", "gustar" for gustarle, "haber" for hay). */
  cue: string;
  /** For the feedback after the answer only; null when the tense has no English. */
  english: string | null;
  subject: SentenceSubject | null;
  /** The subject's id in the engine's bank (np:mis-primos), when it has one: a retry keeps it. */
  subjectId: string | null;
  glosses: Gloss[];
}

/** A pool entry: a sentence a student may be shown, with the checker's warnings for the teacher. */
export interface PoolSentence extends PromptSentence {
  warnings: Problem<WarningCode>[];
}

/** A sentence the checker rejects under the deck's settings: never shown, listed for the teacher. */
export interface ParkedSentence {
  ref: string;
  source: SentenceSource;
  text: string;
  reasons: Problem[];
}

/** A row written for the deck (conjugation_sentences with a text). */
export interface WrittenRow {
  ref: string;
  source: 'teacher' | 'ai';
  status: 'pending' | 'approved' | 'rejected' | 'hidden';
  entry: string;
  tense: string;
  person: string;
  number: string | null;
  text: string;
  english: string | null;
}

/** What a deck's sentences are drawn from: the engine's view of the deck, its hidden built-ins, its written rows. */
export interface SentenceSourceData {
  deck: SentenceDeck;
  hidden: ReadonlySet<string>;
  rows: readonly WrittenRow[];
  /** Identifies the data, for the caches: the same key is the same pools. */
  key: string;
}

/** The sentence part of a prompt as the student sees it: the blank and the parentheses, never the answer. */
export interface ClientSentence {
  before: string;
  after: string;
  cue: string;
  /** Multiple choice only: the pronoun the subject stands for, "(ellos)" after "Mis primos". */
  hint: string | null;
  glosses: Gloss[];
}

/** The sentence after the answer: filled in, its English, and its subject for "mis primos = ellos → viven". */
export interface SentenceFeedback {
  filled: string;
  english: string | null;
  subject: (SentenceSubject & { form: string }) | null;
}

// ---------------------------------------------------------------------------
// Subjects

const NAME_SET = new Set(NAMES.map((n) => n.es.toLowerCase()));

/** "Mis primos" → "mis primos"; a name keeps its capital ("Ana y Luis"). */
function asInLine(s: ParsedSubject): string {
  const text = s.es.trim();
  const first = tokenize(text)[0];
  if (first && NAME_SET.has(first.low)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The pronoun a subject stands for ("mis primos" → ellos, "mi abuela" → ella, "A mis tías" → a ellas, "las
 * mochilas" → ellas), or null for a pronoun or an ambiguous subject.
 */
export function pronounOf(s: ParsedSubject): string | null {
  if (s.pronoun || s.persons.length !== 1) return null;
  const experiencer = s.kind === 'experiencer';
  const f = s.gender === 'f';
  let p: string | null;
  switch (s.persons[0]) {
    case 'el': p = s.enPerson === '2' ? 'usted' : f ? 'ella' : 'él'; break;
    case 'ellos': p = s.enPerson === '2' || s.kind === 'coord_tu' ? 'ustedes' : f ? 'ellas' : 'ellos'; break;
    case 'nosotros': p = f ? 'nosotras' : 'nosotros'; break;
    case 'vosotros': p = f ? 'vosotras' : 'vosotros'; break;
    default: p = null;
  }
  return p && experiencer ? `a ${p}` : p;
}

export function subjectOf(s: ParsedSubject | undefined): SentenceSubject | null {
  if (!s || s.persons.length !== 1) return null;
  return { es: asInLine(s), pronoun: pronounOf(s), person: s.persons[0], kind: s.kind };
}

// ---------------------------------------------------------------------------
// Glosses

/** Words a card front may lead with that are not its meaning ("la clase", "el (la) primo(a)"). */
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);
/** Subject pronouns: never read as a stem of another word (ustedes is not "usted" + es). */
const PRONOUNS = new Set(['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'vos', 'ellos', 'ellas', 'ustedes']);
/**
 * What a subject pronoun means when no card of the deck has it, as the label prompts gloss it (ustedes is
 * "you all", never "you (formal)": the confusion sentences are meant to clear up).
 */
const PRONOUN_GLOSSES: Record<string, string> = {
  yo: 'I', tú: 'you', él: 'he', ella: 'she', usted: 'you (formal)', nosotros: 'we', nosotras: 'we',
  vosotros: 'you all (Spain)', vosotras: 'you all (Spain)', ellos: 'they', ellas: 'they', ustedes: 'you all',
};

interface GlossIndex {
  /** Lowercase word, accents kept → meaning: "él" and "el" are two words. */
  exact: Map<string, string>;
  /** Folded word → meaning, for words of 4 letters or more only (jóvenes → joven). */
  folded: Map<string, string>;
  /** A phrase card's words (lowercase) → its meaning: "a veces" glosses as a whole, never its "a". */
  phrases: { words: string[]; en: string }[];
}

const glossCache = new WeakMap<DeckContext, GlossIndex>();

/** Card text without HTML or extra spaces. */
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The shortest length a word must have to be matched with its accents folded (el / él, tu / tú, mi / mí, si / sí). */
const FOLD_MIN = 4;

/**
 * The deck's glosses, from its non-verb cards and the earlier decks' (a verb card's back would name a form).
 * Each slash part of a front is its own entry ("abuelo / abuela" = "grandfather / grandmother": abuela is
 * grandmother when the back has as many parts); a part of one word (after an article) glosses that word and its
 * o(a) forms, a part of more words is a phrase ("a veces", "todos los días") and glosses only as a whole. The
 * first card that has a word wins.
 */
function glossIndex(ctx: DeckContext): GlossIndex {
  const hit = glossCache.get(ctx);
  if (hit) return hit;
  const index: GlossIndex = { exact: new Map(), folded: new Map(), phrases: [] };
  for (const card of [...ctx.deck.cards, ...(ctx.deck.earlierCards ?? [])]) {
    const front = card.front.replace(/\((?!a\))[^)]*\)/g, ' ');
    const own = frontWords(front);
    if (own.length === 0 || !own.every((w) => ctx.nonVerbCardWords.has(w))) continue;
    const back = plainText(card.back);
    if (!back) continue;
    const parts = front.split('/');
    const backs = back.split(/\s*\/\s*/);
    parts.forEach((part, i) => {
      const en = backs.length === parts.length ? backs[i] : back;
      const tokens = part.normalize('NFC').toLowerCase().replace(/\(a\)/g, '').split(/[^a-zñáéíóúü]+/).filter(Boolean);
      if (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens.shift();
      if (tokens.length === 0) return;
      if (tokens.length > 1) {
        index.phrases.push({ words: tokens, en });
        return;
      }
      const forms = frontWords(part).filter((w) => w === tokens[0] || !ARTICLES.has(w));
      for (const w of forms) {
        if (!index.exact.has(w)) index.exact.set(w, en);
        if (w.length >= FOLD_MIN && !index.folded.has(fold(w))) index.folded.set(fold(w), en);
      }
    });
  }
  // The longest phrase first: "todos los días" before a shorter phrase it starts with.
  index.phrases.sort((a, b) => b.words.length - a.words.length);
  glossCache.set(ctx, index);
  return index;
}

/**
 * The keys a sentence's word may be found by, accents kept: itself, then its singular and masculine (primas →
 * prima → primo, lápices → lápiz). A pronoun is only itself, and a two-letter word is never made masculine
 * (ya is not yo).
 */
function exactKeys(low: string): string[] {
  if (PRONOUNS.has(low)) return [low];
  const keys = [low];
  const stems = [low];
  if (low.endsWith('ces')) stems.push(`${low.slice(0, -3)}z`);
  if (low.endsWith('es') && low.length > 3) stems.push(low.slice(0, -2));
  if (low.endsWith('s') && low.length > 2) stems.push(low.slice(0, -1));
  for (const s of stems) {
    if (!keys.includes(s)) keys.push(s);
    if (s.length > 2 && s.endsWith('a')) keys.push(`${s.slice(0, -1)}o`);
    if (s.endsWith('ora')) keys.push(s.slice(0, -1));
  }
  return keys;
}

/** A word's meaning: by its own spelling first, then a pronoun's own gloss, then (long words only) accents folded. */
function glossOf(index: GlossIndex, low: string): string | undefined {
  for (const k of exactKeys(low)) {
    const en = index.exact.get(k);
    if (en) return en;
  }
  if (PRONOUNS.has(low)) return PRONOUN_GLOSSES[low];
  if (low.length < FOLD_MIN) return undefined;
  for (const k of lookupKeys(low)) {
    const en = index.folded.get(k);
    if (en) return en;
  }
  return undefined;
}

/**
 * The glosses of a sentence's words, in order, each once (Word help): a phrase card's words as one ("a veces"),
 * each other word by its own spelling ("Él" is he, never "the"); words no card has are left out.
 */
export function sentenceGlosses(ctx: DeckContext, before: string, after: string): Gloss[] {
  const index = glossIndex(ctx);
  const out: Gloss[] = [];
  const seen = new Set<string>();
  const tokens = tokenize(`${before} ${after}`).filter((t) => !t.punct);
  for (let i = 0; i < tokens.length; i++) {
    const phrase = index.phrases.find((p) => p.words.every((w, j) => tokens[i + j]?.low === w));
    if (phrase) {
      const es = phrase.words.join(' ');
      if (!seen.has(es)) out.push({ es, en: phrase.en });
      seen.add(es);
      i += phrase.words.length - 1;
      continue;
    }
    const low = tokens[i].low;
    if (seen.has(low)) continue;
    seen.add(low);
    const en = glossOf(index, low);
    if (en) out.push({ es: low, en });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pools

const sameCell = (a: SentenceCell, b: { tense: string; person: string; number?: string | null }) =>
  a.tense === b.tense && a.person === b.person && (a.number ?? 'sg') === (b.number ?? 'sg');

export interface CellSentences {
  /** Every built-in sentence that passes the checker, hidden ones included (`hidden`). */
  builtIn: (PoolSentence & { hidden: boolean })[];
  /** The deck's written rows for the cell that pass the checker, with their status. */
  written: (PoolSentence & { status: WrittenRow['status'] })[];
  parked: ParkedSentence[];
}

const cellCache = new Map<string, CellSentences>();
const CELL_CACHE_MAX = 600;

function poolEntry(
  r: { ref: string; source: SentenceSource; before: string; after: string; cue: string; english: string | null; subjectId: string | null },
  v: { subject?: ParsedSubject; warnings: Problem<WarningCode>[] },
  ctx: DeckContext,
): PoolSentence {
  return {
    ref: r.ref,
    source: r.source,
    before: r.before,
    after: r.after,
    cue: r.cue,
    english: r.english,
    subject: subjectOf(v.subject),
    subjectId: r.subjectId,
    glosses: sentenceGlosses(ctx, r.before, r.after),
    warnings: v.warnings,
  };
}

/** A cell's sentences under a deck's data: built-in (checked), written (checked), and the parked ones. */
export function cellSentences(data: SentenceSourceData, entry: string, cell: SentenceCell): CellSentences {
  const key = `${data.key}|${entry}|${cell.tense}|${cell.person}|${cell.number ?? '-'}`;
  const hit = cellCache.get(key);
  if (hit) {
    cellCache.delete(key);
    cellCache.set(key, hit);
    return hit;
  }
  const ctx = deckContext(data.deck);
  const out: CellSentences = { builtIn: [], written: [], parked: [] };
  for (const r of renderCandidates(entry, cell, ctx)) {
    const v = validate({ entry, cell, before: r.before, after: r.after, cue: r.infinitiveCue }, ctx);
    const text = `${r.before} ___ (${r.infinitiveCue}) ${r.after}`.trim();
    if (!v.ok) {
      out.parked.push({ ref: r.sentenceRef, source: 'builtIn', text, reasons: v.reasons });
      continue;
    }
    out.builtIn.push({
      ...poolEntry({ ref: r.sentenceRef, source: 'builtIn', before: r.before, after: r.after, cue: r.infinitiveCue, english: r.english, subjectId: r.subjectId }, v, ctx),
      hidden: data.hidden.has(r.sentenceRef),
    });
  }
  const id = parseEntry(entry)?.id ?? entry;
  for (const row of data.rows) {
    if ((parseEntry(row.entry)?.id ?? row.entry) !== id || !sameCell(cell, row)) continue;
    const parts = splitSentence(row.text);
    const v = validateText(row.text, entry, cell, ctx);
    if (!v.ok || !parts) {
      if (row.status === 'approved') out.parked.push({ ref: row.ref, source: row.source, text: row.text, reasons: v.reasons });
      continue;
    }
    out.written.push({
      ...poolEntry({ ref: row.ref, source: row.source, before: parts.before, after: parts.after, cue: parts.cue, english: row.english, subjectId: null }, v, ctx),
      status: row.status,
    });
  }
  cellCache.set(key, out);
  if (cellCache.size > CELL_CACHE_MAX) cellCache.delete(cellCache.keys().next().value as string);
  return out;
}

/** The sentences a student may be shown for a cell under a mode: empty for 'off' (the label). */
export function cellPool(data: SentenceSourceData, mode: SentenceMode, entry: string, cell: SentenceCell): PoolSentence[] {
  if (mode === 'off') return [];
  const all = cellSentences(data, entry, cell);
  const out: PoolSentence[] = [];
  if (mode === 'builtIn' || mode === 'both') out.push(...all.builtIn.filter((s) => !s.hidden).map(({ hidden: _h, ...s }) => s));
  if (mode === 'approved' || mode === 'both') out.push(...all.written.filter((s) => s.status === 'approved').map(({ status: _s, ...s }) => s));
  return out;
}

// ---------------------------------------------------------------------------
// Picking

/** FNV-1a, as the engine's hashString. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The short key a round's snapshot keeps for a ref (refs run to 70 characters; a cell has a few dozen). */
export const refKey = (ref: string): string => hash32(ref).toString(36);

/** The most recent sentence keys a snapshot keeps per cell. */
export const SEEN_PER_CELL = 24;

/**
 * The sentence a prompt shows: of the pool, the one seen least recently
 * (`recent`: ref keys, most recent first; one never seen comes first), the
 * seed breaking ties, so the same inputs always give the same sentence. A
 * retry (`again`) keeps the subject it missed with when the pool has another
 * sentence of it. Null for an empty pool.
 */
export function pickPromptSentence<T extends Pick<PromptSentence, 'ref' | 'subjectId' | 'subject'>>(
  pool: readonly T[],
  seed: number,
  recent: readonly string[] = [],
  again?: Pick<PromptSentence, 'ref' | 'subjectId' | 'subject'>,
): T | null {
  if (pool.length === 0) return null;
  let list = pool;
  if (again) {
    const same = pool.filter((s) => s.ref !== again.ref && (again.subjectId ? s.subjectId === again.subjectId : s.subject?.es === again.subject?.es));
    if (same.length > 0) list = same;
  }
  const age = (ref: string) => {
    const i = recent.indexOf(refKey(ref));
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  let best = list[0];
  let bestKey: [number, number] = [age(best.ref), hash32(`${seed}|${best.ref}`)];
  for (const s of list.slice(1)) {
    const key: [number, number] = [age(s.ref), hash32(`${seed}|${s.ref}`)];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = s;
      bestKey = key;
    }
  }
  return best;
}

/** A pool entry as a built prompt keeps it: without the teacher's warnings. */
export const promptSentenceOf = ({ warnings: _warnings, ...sentence }: PoolSentence): PromptSentence => sentence;

// ---------------------------------------------------------------------------
// The holdback

/** An answer this long after an item's first showing is a probe. */
export const PROBE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type HoldbackArm = 'sentence' | 'label';

/** The half a verb is in for a student: a fixed hash of the two, 50/50 (the same in every deck and round). */
export function holdbackArm(userId: number, entry: string): HoldbackArm {
  const id = parseEntry(entry)?.id ?? entry;
  return hash32(`holdback|${userId}|${id}`) % 2 === 0 ? 'sentence' : 'label';
}

export interface SentencePlan {
  /** Show a sentence (when the cell has one), or the label. */
  show: boolean;
  /** Under the holdback: the verb's half and whether this is a probe; null without one. */
  holdback: { arm: HoldbackArm; probe: boolean } | null;
}

/**
 * Whether a prompt shows a sentence. Off, or a "name the verb" prompt: never.
 * Without the holdback: always (a cell with no sentence still falls back to
 * the label). With it: the verb's half decides, except for
 * the probe, the item's first answer 7 or more days after its first showing
 * in the deck, which `coin` (0..1) shows as a sentence or a label, 50/50, in
 * either half. Every later answer is in the verb's half again (`probed`: the
 * student has answered the item's probe already).
 */
export function planSentence(args: {
  mode: SentenceMode;
  holdback: boolean;
  userId: number;
  entry: string;
  direction: 'to' | 'from';
  /** When the student first answered this item in this deck (ms), or null for never. */
  firstShownAt: number | null;
  /** Whether the student has answered this item's probe in this deck. */
  probed?: boolean;
  now: number;
  coin: number;
}): SentencePlan {
  if (args.direction !== 'to' || args.mode === 'off') return { show: false, holdback: null };
  if (!args.holdback) return { show: true, holdback: null };
  const arm = holdbackArm(args.userId, args.entry);
  const probe = !args.probed && args.firstShownAt !== null && args.now - args.firstShownAt >= PROBE_AFTER_MS;
  return { show: probe ? args.coin < 0.5 : arm === 'sentence', holdback: { arm, probe } };
}

// ---------------------------------------------------------------------------
// Grading

const RANK: Record<Grade, number> = { wrong: 0, accent: 1, correct: 2 };
/** Loose: case, accents, ñ and punctuation do not matter in the echoed part (it is given, not graded). */
const loose = (w: string) => foldAccents(w.toLowerCase()).replace(/ñ/g, 'n').replace(/[¡!¿?.,;:"“”«»]/g, '');
const wordsOf = (s: string) => s.split(/\s+/).map((w) => w.replace(/^[¡¿"“«]+|[!?.,;:"”»]+$/g, '')).filter(Boolean);

/**
 * A typed answer without the parts of the sentence it echoes, as
 * withoutCue does for the gustar cue: "mis primos viven en Lima", "mis primos
 * viven" and "viven en Lima" are graded as "viven". The echo may be partial
 * (the end of the text before the blank, the start of the text after it) and
 * its accents are forgiven. Of the possible trims the best graded one wins, so
 * a word of the answer is never cut (the se of "se llama", the no of "no
 * comas", the le of "le gustan"); between equals, the most trimmed one, unless
 * it cut a word an accepted form starts with. Anything else is returned as typed.
 */
export function withoutContext(
  text: string,
  sentence: Pick<PromptSentence, 'before' | 'after'>,
  accepted: readonly string[],
  grade: (answer: string) => Grade,
): string {
  const typed = wordsOf(normalizeAnswer(text));
  const n = typed.length;
  if (n < 2) return text;
  const before = tokenize(sentence.before).filter((t) => !t.punct).map((t) => loose(t.text));
  const after = tokenize(sentence.after).filter((t) => !t.punct).map((t) => loose(t.text));
  const t = typed.map(loose);
  const leads = [0];
  for (let k = 1; k <= Math.min(before.length, n - 1); k++) {
    if (t.slice(0, k).every((w, i) => w === before[before.length - k + i])) leads.push(k);
  }
  const trails = [0];
  for (let j = 1; j <= Math.min(after.length, n - 1); j++) {
    if (t.slice(n - j).every((w, i) => w === after[i])) trails.push(j);
  }
  if (leads.length === 1 && trails.length === 1) return text;
  const starts = new Set(accepted.map((a) => loose(normalizeAnswer(a).split(' ')[0] ?? '')));
  let best: { text: string; rank: number; cut: number; size: number } | null = null;
  for (const k of leads) {
    for (const j of trails) {
      if (k + j >= n) continue;
      const kept = typed.slice(k, n - j).join(' ');
      const rank = RANK[grade(kept)];
      // A stripped last word that an accepted form starts with ("se" before "llama").
      const cut = k > 0 && starts.has(t[k - 1]) ? 1 : 0;
      const size = k + j;
      if (!best || rank > best.rank || (rank === best.rank && (cut < best.cut || (cut === best.cut && size > best.size)))) {
        best = { text: kept, rank, cut, size };
      }
    }
  }
  return best && best.size > 0 ? best.text : text;
}

// ---------------------------------------------------------------------------
// Views

/** The prompt's sentence as the student sees it: the pronoun hint only at multiple choice. */
export function clientSentence(s: PromptSentence, choice: boolean): ClientSentence {
  return {
    before: s.before,
    after: s.after,
    cue: s.cue,
    hint: choice ? s.subject?.pronoun ?? null : null,
    glosses: s.glosses.map((g) => ({ ...g })),
  };
}

/** The sentence after the answer: filled in with the first accepted form, the English, the subject line. */
export function sentenceFeedback(s: PromptSentence, accepted: readonly string[]): SentenceFeedback {
  const form = accepted[0] ?? '';
  return {
    filled: filledIn({ before: s.before, after: s.after, answers: [form] }),
    english: s.english,
    // Always the subject (the mistake lines are worded from it); the page writes "= ellos" only when it has a pronoun.
    subject: s.subject ? { ...s.subject, form } : null,
  };
}

/** The sentence with its blank, as a student saw it ("Mis primos ___ (vivir) en Lima."). */
export const blankText = (s: Pick<PromptSentence, 'before' | 'after' | 'cue'>): string =>
  `${s.before} ___ (${s.cue}) ${s.after}`.replace(/\s+/g, ' ').trim();

/**
 * The kind of subject an answer's prompt showed, for the teacher's split of
 * person mistakes: from the sentence's ref (its subject id), or
 * 'label' for a label prompt. usted and ustedes apart.
 */
export const SUBJECT_TYPES = ['label', 'pronoun', 'usted', 'ustedes', 'name', 'np_sg', 'np_pl', 'coord_yo', 'coord', 'experiencer', 'thing', 'none'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export function subjectTypeOf(sentenceRef: string | null): SubjectType {
  if (!sentenceRef) return 'label';
  const id = sentenceRef.split('/')[1] ?? '-';
  if (id === '-' || id === '') return 'none';
  const [prefix, rest = ''] = id.split(':');
  switch (prefix) {
    case 'pr': return rest === 'usted' ? 'usted' : rest === 'ustedes' ? 'ustedes' : 'pronoun';
    case 'name': return 'name';
    case 'np': return /^(mis|los|las)-/.test(rest) ? 'np_pl' : 'np_sg';
    case 'co': return rest.endsWith('-y-yo') ? 'coord_yo' : rest.endsWith('-y-tu') ? 'ustedes' : 'coord';
    case 'ex': return 'experiencer';
    case 'th': return 'thing';
    default: return 'none';
  }
}

/**
 * The subjects of a student's sentences, for the guide's "Who is the subject?" table: each subject id of the
 * refs (most recent first) that the deck's bank knows, once, with the pronoun it stands for. Pronoun subjects
 * (ustedes) are kept: the table says "ustedes (you all)" too. At most `limit`.
 */
export function subjectsMet(refs: readonly string[], deck: SentenceDeck, limit = 10): SentenceSubject[] {
  const ctx = deckContext(deck);
  const bank = new Map([...subjectBank(ctx), ...experiencerBank(ctx)].map((b) => [b.id, b]));
  const out: SentenceSubject[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const id = ref.split('/')[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const found = bank.get(id);
    const subject = found ? subjectOf(found.subject) : null;
    if (!subject || subject.kind === 'experiencer') continue;
    out.push(subject);
    if (out.length >= limit) break;
  }
  return out;
}

/** Plain helper for tests and views: a rendered built-in sentence in the pool's shape (unchecked). */
export function fromRendered(r: RenderedSentence, ctx: DeckContext, subject: ParsedSubject | undefined): PoolSentence {
  return poolEntry({ ref: r.sentenceRef, source: 'builtIn', before: r.before, after: r.after, cue: r.infinitiveCue, english: r.english, subjectId: r.subjectId }, { subject, warnings: [] }, ctx);
}
