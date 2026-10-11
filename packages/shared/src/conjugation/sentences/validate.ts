// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The one checker for every sentence a student can see: built-in, AI-written
 * and teacher-edited alike. It is pure and deterministic, and it
 * runs again whenever a deck's settings change (a sentence that fails then
 * is parked and its cell falls back to the label).
 *
 * A sentence is rejected when:
 *  - blank / cue: there is not exactly one blank followed by the entry's
 *    verb in parentheses (gustar for the gustarle entries, haber for hay);
 *  - notDrilled: the deck does not drill the cell;
 *  - noSubject / unknownSubject / bannedSubject / accent / agreement: the
 *    subject before the blank is missing, unreadable, of a banned kind (tu, su,
 *    nuestro, mi familia, o / ni, con, uno de, cada, nadie…), a bare "El" /
 *    "Tu" for él / tú, or does not agree (la perro, mi abuela es alto);
 *  - person: the subject's person is not the cell's;
 *  - ambiguous: another drilled cell of the same tense also fits (cells, not
 *    strings: "Ana y tú" with vosotros on fits vosotros and ustedes);
 *  - experiencer / thingLiked: a gustar sentence lacks "A …" before the blank,
 *    or the thing liked after it, or the thing's number is not the cell's
 *    (A mis primos ___ el perro is singular: les gusta); an "A …" phrase on a
 *    verb that takes a subject;
 *  - clitic: a pronoun the blank already holds (me, te, se, le, les…) is
 *    written before the blank. The one exception is the le / les that doubles
 *    an indirect object ("Yo les ___ (dar) las gracias a mis tías"): allowed
 *    only with a verb that takes one (dar, decir, enseñar…), never with a
 *    gustar or pronominal entry, and only when "a + person" follows the blank
 *    and agrees with it (le for one person, les for more);
 *  - sameReferent: a complement names the subject again: the same person in
 *    other words ("Mi papá vive con mi padre"), a member of a plural subject
 *    ("Mis abuelos hablan con mi abuela"), or, after ser, the speaker as their
 *    own relative or friend ("Nosotros somos mis amigos");
 *  - possessive: a "we" subject with "mi / mis" + a relative ("Nosotros
 *    vivimos con mi padre", "Mi hermano y yo vivimos con mi familia"): a
 *    native says nuestro, which the course keeps out because it gives the
 *    nosotros form away;
 *  - impersonalSubject: hay or a weather verb has a subject;
 *  - timeWord: a time word clashes with the tense (ayer with a present label);
 *  - leak: another form of the same verb is in the sentence;
 *  - secondVerb: another conjugated verb is in the sentence;
 *  - vocabulary: a word is not on the deck's cards, an earlier deck's cards or
 *    the core list;
 *  - negativeCommand: "no" is written before the blank of a negative command
 *    (the engine's form already holds it: no comas).
 * Warnings: no time word in a deck with several tenses; a word allowed only
 * by the teacher's approval.
 */
import { analyze } from '../analyze.js';
import { conjugate, parseEntry } from '../conjugate.js';
import { isImperative, type Person } from '../types.js';
import { findTimeWords, timeWordFits, TIME_WORDS } from './cues.js';
import { nounRefs, parseExperiencer, parseSubject, thingNumber } from './subjects.js';
import { tokenize, words, type Token } from './text.js';
import type { Gender, ParsedSubject, Problem, SentenceCandidate, SentenceDeck, Validation, WarningCode } from './types.js';
import { deckContext, wordStatus, type DeckContext } from './vocab.js';
import { ADJ_FORMS, NON_VERBS, NOUN_FORMS, type NounEntry } from './words.js';

/** What the parentheses show for an entry: gustar for gustarle, haber for hay, the id otherwise. */
export function sentenceVerb(entry: string): string {
  const parsed = parseEntry(entry);
  if (!parsed) return entry.trim();
  if (parsed.kind === 'dative' || parsed.kind === 'impersonal') return parsed.base;
  return parsed.id;
}

const PREVERBAL = new Set(['no', 'también', 'siempre', 'nunca', 'ya', 'todavía']);
const INTERJECTIONS = new Set(['hola', 'sí', 'no', 'bueno', 'pues']);
const LEAD_PREPS = new Set(['en', 'por', 'para', 'con', 'de', 'desde', 'durante']);
const CLITICS = new Set(['me', 'te', 'se', 'nos', 'os', 'le', 'les', 'lo', 'la', 'los', 'las']);
const PREPOSITIONS = new Set(['en', 'a', 'al', 'de', 'del', 'con', 'por', 'para', 'sin', 'desde']);
const COPULAS = new Set(['ser', 'estar', 'verse', 'parecer']);
/** Verbs whose subject "la clase" is the lesson, not the group (La clase empieza a las ocho). */
const CLASS_EVENT_VERBS = new Set(['empezar', 'terminar', 'comenzar', 'ser', 'costar', 'abrir', 'cerrar']);
const PERSON_NAME: Record<Person, string> = {
  yo: 'yo',
  tu: 'tú',
  vos: 'vos',
  el: 'él / ella / usted',
  nosotros: 'nosotros',
  vosotros: 'vosotros',
  ellos: 'ellos / ellas / ustedes',
};
const SINGLE_TIME_WORDS = TIME_WORDS.map((w) => w.es.split(' '));
/** Verbs that take an indirect object, so a le / les may double "a + person" before the blank. */
const IO_VERBS = new Set([
  'dar', 'decir', 'enseñar', 'pedir', 'traer', 'llevar', 'comprar', 'vender', 'pagar', 'escribir', 'leer',
  'preguntar', 'contestar', 'explicar', 'mostrar', 'servir', 'mandar', 'regalar', 'prestar',
]);

/** "a + person" after the blank (a mis tías, al mesero, a Ana y a Luis): the indirect object a le / les doubles. */
function indirectObject(after: Token[], opts: { vosotros: boolean }): ParsedSubject | null {
  const toks = after.filter((t) => !t.punct || t.text === ',');
  while (toks.length && toks[toks.length - 1].punct) toks.pop();
  let end = toks.length;
  for (let t = timePhraseEndingAt(toks, end); t && end - t > 0; t = timePhraseEndingAt(toks, end)) end -= t;
  for (let k = 0; k < end; k++) {
    if (toks[k].low !== 'a' && toks[k].low !== 'al') continue;
    const r = parseExperiencer(toks.slice(k, end), opts);
    if (r.ok && (r.subject.tags.includes('person') || r.subject.tags.includes('animal'))) return r.subject;
  }
  return null;
}

/** "mi / mis + noun" phrases after the blank (people, and "mi familia"). */
function possessiveNouns(after: Token[]): { noun: NounEntry; number: 'sg' | 'pl'; gender: Gender; text: string; index: number }[] {
  const out: { noun: NounEntry; number: 'sg' | 'pl'; gender: Gender; text: string; index: number }[] = [];
  for (let i = 0; i + 1 < after.length; i++) {
    const det = after[i].low;
    if (det !== 'mi' && det !== 'mis') continue;
    const number = det === 'mi' ? 'sg' : 'pl';
    const hit = NOUN_FORMS.get(after[i + 1].low)?.find((f) => f.number === number);
    if (!hit) continue;
    if (!hit.noun.tags.includes('person') && hit.noun.sg !== 'familia') continue;
    const gender: Gender = hit.noun.g === 'mf' ? 'x' : hit.noun.g;
    out.push({ noun: hit.noun, number, gender, text: `${after[i].text} ${after[i + 1].text}`, index: i });
  }
  return out;
}

function timePhraseAt(tokens: Token[], i: number): number {
  let best = 0;
  if (tokens[i]?.low === 'a' && tokens[i + 1]?.low === 'las' && tokens[i + 2] && !tokens[i + 2].punct) {
    const found = findTimeWords(tokens.slice(i, i + 3));
    if (found[0]?.start === 0 && found[0].length === 3) best = 3;
  }
  for (const parts of SINGLE_TIME_WORDS) {
    if (parts.length > best && parts.every((p, k) => tokens[i + k]?.low === p)) best = parts.length;
  }
  return best;
}

function timePhraseEndingAt(tokens: Token[], end: number): number {
  for (const len of [3, 2, 1]) {
    const start = end - len;
    if (start < 0) continue;
    if (timePhraseAt(tokens, start) === len) return len;
  }
  return 0;
}

interface Region {
  /** The subject (or experiencer) tokens left after stripping. */
  core: Token[];
  /** "no" right before the blank. */
  noBeforeBlank: boolean;
  /** A clitic right before the blank (after the adverbs). */
  clitic?: string;
  /** The region ended in a comma (a vocative: "Ana, ___"). */
  vocative: boolean;
}

/** Strips time words, interjections, comma-closed leading phrases, pre-verbal adverbs and a stray clitic. */
function subjectRegion(before: Token[]): Region {
  let i = 0;
  let end = before.length;
  for (;;) {
    while (before[i] && before[i].punct && before[i].text !== ',') i++;
    const t = timePhraseAt(before, i);
    if (t) {
      i += t;
      if (before[i]?.text === ',') i++;
      continue;
    }
    if (before[i] && INTERJECTIONS.has(before[i].low) && before[i + 1]?.text === ',') {
      i += 2;
      continue;
    }
    if (before[i] && LEAD_PREPS.has(before[i].low)) {
      const comma = before.findIndex((x, k) => k > i && x.text === ',');
      if (comma > i) {
        i = comma + 1;
        continue;
      }
    }
    break;
  }
  while (end > i && before[end - 1].punct && before[end - 1].text !== ',') end--;
  let vocative = false;
  if (end > i && before[end - 1].text === ',') {
    vocative = true;
    end--;
  }
  let noBeforeBlank = false;
  let first = true;
  for (;;) {
    const last = before[end - 1];
    if (end <= i || !last) break;
    if (PREVERBAL.has(last.low)) {
      if (first && last.low === 'no') noBeforeBlank = true;
      end--;
      first = false;
      continue;
    }
    const t = timePhraseEndingAt(before.slice(0, end), end);
    if (t && end - t >= i) {
      end -= t;
      first = false;
      continue;
    }
    break;
  }
  let clitic: string | undefined;
  if (end > i && CLITICS.has(before[end - 1].low)) {
    // a clitic directly before the blank: the blank already holds it (se llama, le gusta) or it changes the entry
    const prev = before[end - 2];
    // "las" / "los" / "la" closing a noun phrase cannot happen (a noun follows an article), so it is a clitic
    clitic = before[end - 1].text;
    end--;
    // "no" before the clitic still counts for the negative-command rule
    if (prev && prev.low === 'no') {
      noBeforeBlank = true;
      end--;
    }
  }
  return { core: before.slice(i, end), noBeforeBlank, clitic, vocative };
}

/** Lowercase forms that are this verb (any tense, person, number), its infinitive, gerund or participle. */
function sameVerbForms(base: string): Set<string> {
  const out = new Set<string>([base, `${base}se`]);
  const prog = conjugate(base, 'presentProgressive', 'el')?.[0];
  const perf = conjugate(base, 'presentPerfect', 'el')?.[0];
  for (const f of [prog, perf]) {
    const last = f?.split(' ').pop();
    if (last) out.add(last);
  }
  return out;
}

function isNonVerb(low: string, ctx: DeckContext): boolean {
  return NON_VERBS.has(low) || ctx.nonVerbCardWords.has(low);
}

function push(list: Problem[], rule: Problem['rule'], message: string, w?: string[]): void {
  if (list.some((p) => p.rule === rule && p.message === message)) return;
  list.push({ rule, message, ...(w && w.length ? { words: w } : {}) });
}

/**
 * Checks one candidate sentence against a deck. Returns every reason it
 * fails (not only the first), the warnings, and what it read.
 */
export function validate(candidate: SentenceCandidate, deckIn: SentenceDeck | DeckContext): Validation {
  const ctx = deckContext(deckIn);
  const { deck } = ctx;
  const reasons: Problem[] = [];
  const warnings: Problem<WarningCode>[] = [];
  const { entry, cell } = candidate;
  const parsed = parseEntry(entry);
  const kind = parsed?.kind ?? 'plain';
  const base = parsed?.base ?? entry;

  // format and parentheses
  if (/_{2,}|[()]/.test(candidate.before) || /_{2,}|[()]/.test(candidate.after)) {
    push(reasons, 'blank', 'the sentence must have exactly one blank, with the verb in parentheses right after it');
  }
  const expectedCue = sentenceVerb(entry);
  if (candidate.cue !== undefined && candidate.cue.normalize('NFC').trim().toLowerCase() !== expectedCue) {
    push(reasons, 'cue', `the parentheses must show "${expectedCue}", the verb this item drills`, [candidate.cue]);
  }

  // the cell
  const drilledCells = ctx.cells.get(entry);
  const vosRegion = cell.person === 'vos' ? deck.vos ?? undefined : undefined;
  const answers = parsed ? conjugate(entry, cell.tense, cell.person, cell.number ?? 'sg', vosRegion ? { vosRegion } : {}) ?? [] : [];
  const isDrilled =
    !!parsed &&
    !!drilledCells?.some((c) => c.tense === cell.tense && c.person === cell.person && (c.number ?? 'sg') === (cell.number ?? 'sg'));
  if (!isDrilled) push(reasons, 'notDrilled', 'this deck does not drill this verb form (check its tenses, vosotros and vos)');

  const beforeToks = tokenize(candidate.before);
  const afterToks = tokenize(candidate.after);
  const beforeWords = words(beforeToks);
  const afterWords = words(afterToks);

  // time words
  const found = [...findTimeWords(beforeWords), ...findTimeWords(afterWords)];
  const timeWords = found.map((f) => f.word.es);
  for (const f of found) {
    if (!timeWordFits(f.word, cell.tense)) {
      push(reasons, 'timeWord', `"${f.word.es}" does not go with the ${cell.tense} tense`, [f.word.es]);
    }
  }
  if (deck.tenses.length > 1 && !found.some((f) => f.word.tenses !== 'any')) {
    warnings.push({ rule: 'noTimeWord', message: 'no time word: the tense label alone tells the student the tense' });
  }

  // subject
  const region = subjectRegion(beforeToks);
  const core = region.core;
  const opts = { vosotros: deck.vosotros };
  let subject: Validation['subject'];
  let thingNum: Validation['thingNumber'];

  if (region.clitic) {
    const low = region.clitic.toLowerCase();
    const doubling = kind === 'plain' && IO_VERBS.has(base) && (low === 'le' || low === 'les');
    if (!doubling) {
      push(reasons, 'clitic', `"${region.clitic}" before the blank: the blank holds the whole form (se llama, le gusta), so write nothing between the subject and the blank`, [region.clitic]);
    } else {
      const io = indirectObject(afterToks, opts);
      if (!io) {
        push(reasons, 'clitic', `"${region.clitic}" before the blank needs the person it stands for after the verb ("Yo les ___ (dar) las gracias a mis tías")`, [region.clitic]);
      } else if ((low === 'le') !== (io.number === 'sg')) {
        push(reasons, 'clitic', `"${region.clitic}" does not agree with "${io.es}": use ${io.number === 'sg' ? 'le' : 'les'}`, [region.clitic, io.es]);
      }
    }
  }

  if (isImperative(cell.tense)) {
    if (cell.tense === 'imperativeNegative' && region.noBeforeBlank) {
      push(reasons, 'negativeCommand', 'a negative command keeps "no" inside the blank (no comas): do not write it before the blank', ['no']);
    }
    if (core.length && !region.vocative) {
      push(reasons, 'unknownSubject', 'a command has no subject before the blank; to name the person, use a name and a comma ("Ana, ___")', core.map((t) => t.text));
    }
  } else if (kind === 'impersonal') {
    if (core.length && !PREPOSITIONS.has(core[0].low)) {
      push(reasons, 'impersonalSubject', `"${sentenceVerb(entry)}" has no subject here: start with a place or a time ("En la escuela ___…")`, core.map((t) => t.text));
    }
  } else if (kind === 'dative') {
    if (!core.length) {
      push(reasons, 'experiencer', 'a gustar sentence needs the person who likes before the blank: "A mi abuela ___ (gustar)…"');
    } else {
      const r = parseExperiencer(core, opts);
      if (r.ok) subject = r.subject;
      else push(reasons, r.rule, r.message, r.words);
    }
    const n = thingNumber(afterToks, { isInfinitive: (w) => ctx.infinitives.has(w) || isKnownInfinitive(w) });
    if (!n) {
      push(reasons, 'thingLiked', 'name the thing liked right after the blank ("…___ (gustar) los perros"): it decides gusta or gustan');
    } else {
      thingNum = n;
      if ((cell.number ?? 'sg') !== n) {
        push(
          reasons,
          'thingLiked',
          `the thing liked is ${n === 'sg' ? 'singular' : 'plural'}, so the verb is ${n === 'sg' ? 'gusta' : 'gustan'}; this item asks for the ${n === 'sg' ? 'plural' : 'singular'} form`,
        );
      }
    }
  } else if (!core.length) {
    push(reasons, 'noSubject', 'write the subject before the blank ("Mis primos ___…"); without it, or with it after the verb, the person is open');
  } else if (core[0].low === 'a' || core[0].low === 'al') {
    const asExp = parseExperiencer(core, opts);
    if (asExp.ok) push(reasons, 'experiencer', '"A …" before the blank is for gustar-type verbs; this verb needs a subject ("Mi abuela ___…")', [core[0].text]);
    else push(reasons, 'unknownSubject', 'the checker cannot read the subject', core.map((t) => t.text));
  } else {
    const r = parseSubject(core, opts);
    if (r.ok) subject = r.subject;
    else push(reasons, r.rule, r.message, r.words);
  }

  // which drilled cells fit
  if (subject && isDrilled && !isImperative(cell.tense) && kind !== 'impersonal') {
    const fits = (drilledCells ?? []).filter(
      (c) =>
        c.tense === cell.tense &&
        subject!.persons.includes(c.person) &&
        (kind !== 'dative' || !thingNum || (c.number ?? 'sg') === thingNum),
    );
    if (!subject.persons.includes(cell.person)) {
      const undrilled = subject.persons.filter((p) => !(drilledCells ?? []).some((c) => c.person === p));
      if (undrilled.length) {
        push(reasons, 'person', `"${subject.es}" is ${undrilled.map((p) => PERSON_NAME[p]).join(' or ')}, which this deck does not drill`, [subject.es]);
      } else {
        push(reasons, 'person', `"${subject.es}" takes the ${subject.persons.map((p) => PERSON_NAME[p]).join(' / ')} form, not the ${PERSON_NAME[cell.person]} form`, [subject.es]);
      }
    } else if (new Set(fits.map((c) => c.person)).size > 1) {
      push(
        reasons,
        'ambiguous',
        `"${subject.es}" fits more than one drilled form (${[...new Set(fits.map((c) => PERSON_NAME[c.person]))].join(', ')})`,
        [subject.es],
      );
    }
  }

  // a complement that names the subject again, and "mi" + a relative with a "we" subject
  if (subject && kind !== 'impersonal') {
    const owned = possessiveNouns(afterWords);
    const subjectRefs = new Set(subject.refs ?? []);
    for (const o of owned) {
      if (!o.noun.tags.includes('person')) continue;
      if (nounRefs(o.noun, o.number, o.gender).some((r) => subjectRefs.has(r))) {
        push(reasons, 'sameReferent', `"${o.text}" is (or includes) "${subject.es}" again: use a different person`, [subject.es, o.text]);
      }
    }
    const speaker = subject.persons.includes('yo') || subject.persons.includes('nosotros');
    if (entry === 'ser' && speaker && owned.some((o) => o.index === 0 && o.noun.tags.includes('person'))) {
      push(reasons, 'sameReferent', `"${subject.es}" includes the speaker, who cannot be "${owned[0].text}": say "${subject.persons.includes('yo') ? 'Yo soy amigo de Ana' : 'Somos amigos'}"`, [owned[0].text]);
    }
    if (subject.persons.includes('nosotros')) {
      const kin = owned.filter((o) => o.noun.tags.includes('family') || o.noun.sg === 'familia');
      if (kin.length) {
        push(
          reasons,
          'possessive',
          `with a "we" subject, "${kin[0].text}" reads as a mistake (a native says nuestro / nuestra, which gives the nosotros form away): use a person who is not a shared relative`,
          kin.map((o) => o.text),
        );
      }
    }
  }

  // "la clase" as a subject is a group of students (collective) except as the lesson that begins or ends
  if (subject && subject.lemmas.includes('clase') && !CLASS_EVENT_VERBS.has(base)) {
    push(reasons, 'bannedSubject', '"la clase" as a subject is a collective noun (singular verb, plural meaning); use "los estudiantes"', ['clase']);
  }

  // a predicate noun after ser agrees with the subject (Mi abuela es profesora, not profesor)
  if (subject && entry === 'ser' && subject.kind !== 'experiencer') {
    let k = 0;
    while (afterWords[k] && ['muy', 'mi', 'mis', 'un', 'una', 'el', 'la', 'los', 'las'].includes(afterWords[k].low)) k++;
    const hit = afterWords[k] ? NOUN_FORMS.get(afterWords[k].low)?.find((f) => f.noun.tags.includes('person')) : undefined;
    if (hit) {
      const g = hit.noun.g;
      const numberOff = hit.number !== subject.number;
      const genderOff = g !== 'mf' && subject.gender !== 'x' && g !== subject.gender;
      if (numberOff || genderOff) push(reasons, 'agreement', `"${afterWords[k].text}" does not agree with "${subject.es}"`, [afterWords[k].text]);
    }
  }

  // agreement of a predicate adjective (ser, estar, verse)
  if (subject && COPULAS.has(entry) && subject.kind !== 'experiencer') {
    let k = 0;
    while (afterWords[k] && ['muy', 'tan', 'más', 'menos', 'también'].includes(afterWords[k].low)) k++;
    const a = afterWords[k] ? ADJ_FORMS.get(afterWords[k].low) : undefined;
    if (a) {
      const numberOff = a.number !== subject.number;
      const genderOff = a.gender !== 'x' && subject.gender !== 'x' && a.gender !== subject.gender;
      if (numberOff || genderOff) push(reasons, 'agreement', `"${afterWords[k].text}" does not agree with "${subject.es}"`, [afterWords[k].text]);
    }
  }

  // leak and second verb
  const same = sameVerbForms(base);
  const leaks: string[] = [];
  const others: string[] = [];
  for (const t of [...beforeWords, ...afterWords]) {
    if (isNonVerb(t.low, ctx)) continue;
    if (same.has(t.low)) {
      leaks.push(t.text);
      continue;
    }
    const readings = analyze(t.low);
    if (!readings.length) continue;
    if (readings.some((r) => parseEntry(r.infinitive)?.base === base)) leaks.push(t.text);
    else others.push(t.text);
  }
  if (leaks.length) push(reasons, 'leak', 'another form of the same verb is in the sentence, which gives the answer away', leaks);
  if (others.length) push(reasons, 'secondVerb', 'keep one conjugated verb (the blank): this sentence has another', others);

  // vocabulary
  const unknown: string[] = [];
  const approved: string[] = [];
  for (const t of [...beforeWords, ...afterWords]) {
    const s = wordStatus(t.text, ctx);
    if (s === 'unknown' && !unknown.includes(t.text)) unknown.push(t.text);
    if (s === 'approved' && !approved.includes(t.text)) approved.push(t.text);
  }
  if (unknown.length) push(reasons, 'vocabulary', 'words outside the deck\'s vocabulary (its cards, earlier decks and the core list)', unknown);
  if (approved.length) warnings.push({ rule: 'approvedWord', message: 'words allowed by the teacher: they get a gloss', words: approved });

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    ...(subject ? { subject } : {}),
    ...(thingNum ? { thingNumber: thingNum } : {}),
    timeWords,
    answers,
  };
}

function isKnownInfinitive(w: string): boolean {
  const p = parseEntry(w);
  return !!p && p.kind !== 'dative' && /(ar|er|ir|ír)$/.test(w) && !!conjugate(p.id, 'present', 'yo');
}

/**
 * Splits a sentence written with a blank and the verb in parentheses
 * ("Mis primos ___ (vivir) en Lima.") into a candidate. Null when it does not
 * have exactly one blank followed by parentheses.
 */
export function splitSentence(text: string): { before: string; cue: string; after: string } | null {
  const s = text.normalize('NFC');
  const blanks = s.match(/_{3,}/g) ?? [];
  if (blanks.length !== 1) return null;
  const m = s.match(/^(.*?)_{3,}\s*\(([^()]+)\)(.*)$/s);
  if (!m) return null;
  return { before: m[1].trim(), cue: m[2].trim(), after: m[3].trim() };
}

/** validate() for a sentence written as text with a blank ("A mis primos ___ (gustar) el perro."). */
export function validateText(
  text: string,
  entry: string,
  cell: SentenceCandidate['cell'],
  deck: SentenceDeck | DeckContext,
): Validation {
  const parts = splitSentence(text);
  if (!parts) {
    return {
      ok: false,
      reasons: [{ rule: 'blank', message: 'the sentence must have exactly one blank (___), with the verb in parentheses right after it' }],
      warnings: [],
      timeWords: [],
      answers: [],
    };
  }
  return validate({ entry, cell, ...parts }, deck);
}
