// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Renders built-in frames into sentences for one cell of a deck.
 *
 * A cell's candidates are every frame of the entry that works for the cell's
 * person and tense, crossed with every bank subject of that person that the
 * frame suits (or every thing of its pivot list). The complements are chosen
 * from the slot lists by a hash of frame, subject and tense, so a candidate
 * is stable and has a stable `sentenceRef`. The engine always writes the
 * form: `answers` come from conjugate(), never from a frame.
 *
 * renderCandidates() does not run the checker (the tests check that every
 * candidate passes); sentencePool() does, and is what a server should use.
 * pickSentence() chooses one candidate: the least recently seen, with the seed
 * breaking ties, so the same seed always gives the same sentence.
 */
import { conjugate, parseEntry } from '../conjugate.js';
import { hashString } from '../random.js';
import type { Tense } from '../types.js';
import { chooseTimeWord, findTimeWords, type TimeWord } from './cues.js';
import { englishNegative, englishPossessive, englishThere, englishVerb, subjectPossessive } from './english.js';
import { FILLERS, slotFills, type Fill } from './fillers.js';
import { FRAMES_BY_ENTRY, type Frame } from './frames.js';
import { experiencerBank, parseSubject, subjectBank, type BankSubject } from './subjects.js';
import { capitalize, contract, slug, tidy, tokenize, words } from './text.js';
import type { ParsedSubject, RenderedSentence, SentenceCell, SentenceDeck, Tag } from './types.js';
import { sentenceVerb, validate } from './validate.js';
import { deckContext, wordStatus, type DeckContext } from './vocab.js';
import { NAME_GENDER } from './words.js';

const SLOT_RE = /\{([A-Za-z]+)(?::(\d))?\}/g;
const SUBJECT_TOKENS = new Set(['S', 'E', 'T']);

function sameCell(a: SentenceCell, b: SentenceCell): boolean {
  return a.tense === b.tense && a.person === b.person && (a.number ?? 'sg') === (b.number ?? 'sg');
}

/** The fixed words of a frame (slots removed) are all known to the deck. */
function fixedWordsKnown(frame: Frame, ctx: DeckContext): boolean {
  const fixed = frame.es.replace(SLOT_RE, ' ').replace(/_+/g, ' ');
  return fixed
    .split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/)
    .filter(Boolean)
    .every((w) => wordStatus(w, ctx) === 'ok');
}

/** A frame's fixed time words fit the tense (a frame "todos los días" never renders in the preterite). */
function fixedTimeWordsFit(frame: Frame, tense: Tense): { fit: boolean; specific: boolean } {
  const fixed = frame.es.replace(SLOT_RE, ' ').replace(/_+/g, ' ');
  const found = findTimeWords(words(tokenize(fixed)));
  return {
    fit: found.every((f) => f.word.tenses === 'any' || f.word.tenses.includes(tense)),
    specific: found.some((f) => f.word.tenses !== 'any'),
  };
}

function suits(who: Tag[], s: ParsedSubject): boolean {
  return who.some((t) => s.tags.includes(t));
}

function pick<T extends { id: string }>(list: T[], key: string, avoid: string[] = []): T | null {
  const pool = list.filter((x) => !avoid.includes(x.id));
  if (!pool.length) return null;
  return pool[hashString(key) % pool.length];
}

/** English for the llamarse frames: "My name is Ana", "My cousins' names are…", "My brother and I are called…". */
function englishCalled(s: ParsedSubject, also: boolean): string {
  const coord = s.kind.startsWith('coord');
  if (coord) return `${s.en} are ${also ? 'also ' : ''}called`;
  const pos = englishPossessive(s.en);
  return s.number === 'sg' ? `${pos} name is${also ? ' also' : ''}` : `${pos} names are${also ? ' also' : ''}`;
}

interface Subjectish {
  id: string | null;
  es: string;
  subject: ParsedSubject | null;
  /** English in subject position (a pivot thing's own English). */
  en: string;
  /** A pivot fill (hay complement or thing subject). */
  pivotFill?: Fill;
}

function subjectsFor(frame: Frame, kind: string, ctx: DeckContext, cell: SentenceCell): Subjectish[] {
  const usesT = frame.es.includes('{T}');
  if (usesT || kind === 'impersonal') {
    if (!frame.pivot) return kind === 'impersonal' ? [{ id: null, es: '', subject: null, en: '' }] : [];
    const fills = slotFills(frame.pivot, ctx, null, cell);
    if (!usesT) return fills.map((f) => ({ id: null, es: '', subject: null, en: '', pivotFill: f }));
    const out: Subjectish[] = [];
    for (const f of fills) {
      const r = parseSubject(tokenize(f.es), { vosotros: ctx.deck.vosotros });
      if (!r.ok) continue;
      out.push({ id: `th:${slug(f.es)}`, es: f.es, subject: r.subject, en: f.en, pivotFill: f });
    }
    return out;
  }
  const bank: BankSubject[] = kind === 'dative' ? experiencerBank(ctx) : subjectBank(ctx);
  return bank.map((b) => ({ id: b.id, es: b.es, subject: b.subject, en: b.subject.en }));
}

function subjectFits(frame: Frame, s: Subjectish, kind: string, cell: SentenceCell): boolean {
  if (kind === 'impersonal') return true;
  if (!s.subject) return false;
  if (s.subject.persons.length !== 1 || s.subject.persons[0] !== cell.person) return false;
  if (frame.es.includes('{T}')) return true;
  if (kind !== 'dative' && !suits(frame.who ?? ['person'], s.subject)) return false;
  if (frame.notWho && suits(frame.notWho, s.subject)) return false;
  if (kind === 'dative' && s.subject.tags.includes('baby')) return false;
  if (frame.noFormal && (s.subject.pronounWord === 'usted' || s.subject.pronounWord === 'ustedes')) return false;
  // name frames take a pronoun or a noun phrase: "Ana se llama Ana" is silly, and in "Mi amigo y yo
  // nos llamamos Ana y Luis" the names cannot be matched to the people
  if (frame.avoidLemmas && s.subject.lemmas.some((l) => frame.avoidLemmas!.includes(l))) return false;
  if (frame.noNames && (s.subject.kind === 'name' || s.subject.kind.startsWith('coord') || s.subject.lemmas.some((l) => NAME_GENDER.has(l)))) return false;
  return true;
}

function renderOne(
  frame: Frame,
  s: Subjectish,
  entry: string,
  kind: string,
  cell: SentenceCell,
  ctx: DeckContext,
  answers: string[],
): RenderedSentence | null {
  const tense = cell.tense;
  const key = `${frame.id}|${s.id ?? s.pivotFill?.id ?? '-'}|${tense}|${cell.number ?? ''}`;
  const fills = new Map<string, Fill>();
  const refParts: string[] = [];
  for (const m of frame.es.matchAll(SLOT_RE)) {
    const name = m[1];
    if (SUBJECT_TOKENS.has(name) || name === 'LE') continue;
    const token = m[2] ? `${name}:${m[2]}` : name;
    if (fills.has(token)) continue;
    if (name === frame.pivot && s.pivotFill && !frame.es.includes('{T}')) {
      fills.set(token, s.pivotFill);
      refParts.push(`${token}=${s.pivotFill.id}`);
      continue;
    }
    // a thing subject picks a list by its band: a juice is cheap, a backpack is not; a restaurant closes late
    const band = s.pivotFill?.band;
    const list = band && FILLERS[`${name}.${band}`] ? `${name}.${band}` : name;
    let options = slotFills(list, ctx, s.subject, cell);
    // the thing liked fixes gusta / gustan: only things of the cell's number
    if (kind === 'dative') options = options.filter((f) => !f.number || f.number === (cell.number ?? 'sg'));
    const avoid = m[2] ? [fills.get(name)?.id ?? ''] : [];
    // a second pick comes from the first one's set ("Luis, no Mateo", never "Luis, no Sofía")
    const firstSet = m[2] ? fills.get(name)?.set : undefined;
    if (firstSet) options = options.filter((f) => f.set === firstSet);
    const chosen = pick(options, `${key}|${token}`, avoid);
    if (!chosen) return null;
    fills.set(token, chosen);
    refParts.push(`${token}=${chosen.id}`);
  }

  // Spanish
  let es = frame.es.replace(SLOT_RE, (_all, name: string, n?: string) => {
    if (SUBJECT_TOKENS.has(name)) return s.es;
    if (name === 'LE') return fills.get(frame.io ?? '')?.number === 'pl' ? 'les' : 'le';
    return fills.get(n ? `${name}:${n}` : name)?.es ?? '';
  });
  // English
  const p = s.subject?.enPerson ?? '3sg';
  let en: string | null = frame.en;
  if (entry === 'llamarse' && s.subject) {
    const tail = frame.es.includes('también') ? 'also' : '';
    const called = englishCalled(s.subject, tail === 'also');
    const names = fills.get('names')?.en ?? '';
    const names2 = fills.get('names:2')?.en ?? '';
    if (frame.id === 'llamarse.not') en = `${called} ${names}, not ${names2}.`;
    else if (frame.id === 'llamarse.hola') en = `Hi, ${called} ${names}.`;
    else en = `${called} ${names}.`;
    if (tense !== 'present') en = null;
  } else if (en !== null) {
    const verb = englishVerb(frame.v, frame.enProgressive && tense === 'present' ? 'presentProgressive' : tense, p);
    const neg = en.includes('{Vneg}') ? englishNegative(frame.v, tense, p) : '';
    const thereNumber = s.pivotFill?.number ?? 'pl';
    const there = en.includes('{THERE}') ? englishThere(tense, thereNumber) : '';
    if (verb === null || neg === null || there === null) en = null;
    else {
      en = en.replace(SLOT_RE, (_all, name: string, n?: string) => {
        if (SUBJECT_TOKENS.has(name)) return s.en;
        if (name === 'V') return verb;
        if (name === 'Vneg') return neg ?? '';
        if (name === 'POSS') return s.subject ? subjectPossessive(s.subject) : '';
        if (name === 'THERE') return there ?? '';
        return fills.get(n ? `${name}:${n}` : name)?.en ?? '';
      });
    }
  }

  // a time word for a deck with several tenses, unless the frame already has a tense-specific one
  let timeWord: TimeWord | null = null;
  if (ctx.deck.tenses.length > 1 && !fixedTimeWordsFit(frame, tense).specific) {
    const startsWithSubject = /^\{[SET]\}/.test(frame.es);
    const tw = chooseTimeWord(
      tense,
      ctx.deck.tenses,
      (phrase) => phrase.split(' ').every((w) => wordStatus(w, ctx) === 'ok'),
      s.subject
        ? { gender: s.subject.gender, number: s.subject.number, person: s.subject.tags.includes('person'), lemmas: s.subject.lemmas }
        : null,
      (frame.tenses ?? []).includes('imperfect'),
    );
    if (tw && (tw.position === 'end' || startsWithSubject)) {
      timeWord = tw;
      if (tw.position === 'start') {
        const comma = tw.es.includes(' ') ? ',' : '';
        es = `${tw.es}${comma} ${es}`;
        if (en) en = `${tw.en}${comma} ${en}`;
      } else {
        es = es.replace(/\.$/, ` ${tw.es}.`);
        if (en) en = en.replace(/\.$/, ` ${tw.en}.`);
      }
    }
  }

  es = capitalize(tidy(contract(es)));
  if (en) en = capitalize(tidy(en));
  const at = es.indexOf('___');
  const before = es.slice(0, at).trim();
  const after = es.slice(at + 3).trim();
  const ref = ['tpl:' + frame.id, s.id ?? '-', refParts.join(',') || '-', tense + (cell.number ? `.${cell.number}` : '') + (timeWord ? `/t=${slug(timeWord.es)}` : '')].join('/');
  return {
    entry,
    cell: { ...cell },
    before,
    after,
    infinitiveCue: sentenceVerb(entry),
    answers,
    english: en,
    subjectId: s.id,
    subjectKind: s.subject ? s.subject.kind : null,
    sentenceRef: ref,
    frameId: frame.id,
    ...(timeWord ? { timeWord: timeWord.es } : {}),
  };
}

/**
 * Every built-in sentence for one cell of a deck (unchecked). Empty when the
 * deck does not drill the cell or no frame fits it.
 */
export function renderCandidates(entry: string, cell: SentenceCell, deckIn: SentenceDeck | DeckContext): RenderedSentence[] {
  const ctx = deckContext(deckIn);
  const parsed = parseEntry(entry);
  if (!parsed) return [];
  const drilled = ctx.cells.get(entry)?.some((c) => sameCell(c, cell));
  if (!drilled) return [];
  const vosRegion = cell.person === 'vos' ? ctx.deck.vos ?? undefined : undefined;
  const answers = conjugate(entry, cell.tense, cell.person, cell.number ?? 'sg', vosRegion ? { vosRegion } : {}) ?? [];
  if (!answers.length) return [];
  const out: RenderedSentence[] = [];
  for (const frame of FRAMES_BY_ENTRY.get(parsed.id) ?? []) {
    if (!(frame.tenses ?? ['present']).includes(cell.tense)) continue;
    if (frame.persons && !frame.persons.includes(cell.person)) continue;
    if (!fixedWordsKnown(frame, ctx)) continue;
    if (!fixedTimeWordsFit(frame, cell.tense).fit) continue;
    for (const s of subjectsFor(frame, parsed.kind, ctx, cell)) {
      if (!subjectFits(frame, s, parsed.kind, cell)) continue;
      const r = renderOne(frame, s, parsed.id, parsed.kind, cell, ctx, answers);
      if (r) out.push(r);
    }
  }
  return out;
}

/** The built-in sentences of a cell that pass the checker: the pool a server draws from. */
export function sentencePool(entry: string, cell: SentenceCell, deckIn: SentenceDeck | DeckContext): RenderedSentence[] {
  const ctx = deckContext(deckIn);
  return renderCandidates(entry, cell, ctx).filter(
    (r) => validate({ entry, cell, before: r.before, after: r.after, cue: r.infinitiveCue }, ctx).ok,
  );
}

/**
 * Picks one sentence: the one seen least recently (`recent` lists refs, most
 * recent first; unseen ones come first), ties broken by the seed. The same
 * pool, seed and history always give the same sentence. Null for an empty pool.
 */
export function pickSentence(pool: RenderedSentence[], seed: number | string, recent: string[] = []): RenderedSentence | null {
  if (!pool.length) return null;
  const age = (ref: string) => {
    const i = recent.indexOf(ref);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  let best: RenderedSentence | null = null;
  let bestKey: [number, number] = [-1, 0];
  for (const r of pool) {
    const key: [number, number] = [age(r.sentenceRef), hashString(`${seed}|${r.sentenceRef}`)];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = r;
      bestKey = key;
    }
  }
  return best;
}

/** The sentence filled in: "Mis primos viven en Lima." (form = answers[0] unless given). */
export function filledIn(r: Pick<RenderedSentence, 'before' | 'after' | 'answers'>, form = r.answers[0]): string {
  const s = tidy(`${r.before} ${form} ${r.after}`);
  return capitalize(s);
}

/** For the teacher's coverage line: how many drilled cells of each entry have at least one sentence. */
export function coverage(deckIn: SentenceDeck | DeckContext): { entry: string; cells: number; covered: number; missing: SentenceCell[] }[] {
  const ctx = deckContext(deckIn);
  return ctx.deck.entries.map((entry) => {
    const cells = ctx.cells.get(entry) ?? [];
    const missing = cells.filter((c) => sentencePool(entry, c, ctx).length === 0);
    return { entry, cells: cells.length, covered: cells.length - missing.length, missing };
  });
}
