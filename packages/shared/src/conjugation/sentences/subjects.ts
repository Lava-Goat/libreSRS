// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Subjects: the small Spanish noun-phrase parser that maps a subject (or a
 * gustar experiencer) to an engine person, and the bank of subjects the
 * renderer draws from (pronouns one at a time, names, the deck's nouns in the
 * singular and plural, and coordinations).
 *
 * | Subject              | Person                                            |
 * |----------------------|---------------------------------------------------|
 * | mi abuela, Ana, él   | el                                                |
 * | mis primos, Ana y Luis | ellos                                           |
 * | mi hermano y yo      | nosotros                                          |
 * | Ana y tú             | ellos with vosotros off; ambiguous (vosotros or ellos) with it on |
 * | A mi abuela          | el (le), for the dative entries                   |
 * | A mis primos         | ellos (les)                                       |
 *
 * Rejected: tu/tus (looks like tú), su/sus (vague), nuestro (invites
 * nosotros), collective nouns (mi familia, la gente), o / ni coordination,
 * con-phrases, uno de, la mayoría de, cada, indefinite pronouns (nadie,
 * alguien, todo el mundo), a bare "El" or "Tu" before the verb (él / tú without
 * the accent), and nouns the checker does not know.
 *
 * The bank is built by parsing its own Spanish, so the renderer and the
 * checker can never disagree about a subject's person.
 */
import type { Person } from '../types.js';
import { contract, slug, tokenize, words, type Token } from './text.js';
import type { DeckContext } from './vocab.js';
import { wordStatus } from './vocab.js';
import { ADJ_FORMS, kinKey, NAME_GENDER, NAMES, NOUN_FORMS, NOUNS, NUMBERS, type NounEntry } from './words.js';
import type { EnPerson, Gender, ParsedSubject, RuleCode, SubjectKind, Tag } from './types.js';

export type SubjectParse =
  | { ok: true; subject: ParsedSubject }
  | { ok: false; rule: RuleCode; message: string; words?: string[] };

interface Member {
  es: string;
  /** Engine person of the member alone. */
  person: Person;
  number: 'sg' | 'pl';
  gender: Gender;
  en: string;
  enPerson: EnPerson;
  tags: Tag[];
  lemmas: string[];
  refs: string[];
  kind: 'pronoun' | 'name' | 'np' | 'thing';
  pronounWord?: string;
}

/**
 * The speaker is a first-year student, so yo, tú, nosotros and the names are learners
 * (not "Yo enseño español", "Ana bebe café"); usted is an adult; the third-person
 * pronouns and ustedes can be either.
 */
const LEARNER_TAGS: Tag[] = ['person', 'learner'];
const ANY_PERSON_TAGS: Tag[] = ['person', 'adult', 'learner'];
const PRONOUN_TAGS: Record<string, Tag[]> = {
  yo: [...LEARNER_TAGS, 'family'],
  tú: LEARNER_TAGS,
  vos: LEARNER_TAGS,
  nosotros: [...LEARNER_TAGS, 'family'],
  nosotras: [...LEARNER_TAGS, 'family'],
  vosotros: LEARNER_TAGS,
  vosotras: LEARNER_TAGS,
  usted: ['person', 'adult'],
};

/**
 * Who a possessive person noun phrase names, as kin key + gender: "mi mamá" → padre:f,
 * "mis abuelos" → abuelo:m and abuelo:f (a masculine plural can include women).
 */
export function nounRefs(noun: NounEntry, number: 'sg' | 'pl', gender: Gender): string[] {
  const key = kinKey(noun);
  if (number === 'sg' && gender !== 'x') return [`${key}:${gender}`];
  if (number === 'pl' && gender === 'f') return [`${key}:f`];
  return [`${key}:m`, `${key}:f`];
}

interface PronounInfo {
  person: Person;
  number: 'sg' | 'pl';
  gender: Gender;
  en: string;
  enPerson: EnPerson;
}

const PRONOUNS: Record<string, PronounInfo> = {
  yo: { person: 'yo', number: 'sg', gender: 'x', en: 'I', enPerson: '1sg' },
  tú: { person: 'tu', number: 'sg', gender: 'x', en: 'you', enPerson: '2' },
  vos: { person: 'vos', number: 'sg', gender: 'x', en: 'you', enPerson: '2' },
  él: { person: 'el', number: 'sg', gender: 'm', en: 'he', enPerson: '3sg' },
  ella: { person: 'el', number: 'sg', gender: 'f', en: 'she', enPerson: '3sg' },
  usted: { person: 'el', number: 'sg', gender: 'x', en: 'you (formal)', enPerson: '2' },
  nosotros: { person: 'nosotros', number: 'pl', gender: 'm', en: 'we', enPerson: '1pl' },
  nosotras: { person: 'nosotros', number: 'pl', gender: 'f', en: 'we', enPerson: '1pl' },
  vosotros: { person: 'vosotros', number: 'pl', gender: 'm', en: 'you all', enPerson: '2' },
  vosotras: { person: 'vosotros', number: 'pl', gender: 'f', en: 'you all', enPerson: '2' },
  ellos: { person: 'ellos', number: 'pl', gender: 'm', en: 'they', enPerson: '3pl' },
  ellas: { person: 'ellos', number: 'pl', gender: 'f', en: 'they', enPerson: '3pl' },
  ustedes: { person: 'ellos', number: 'pl', gender: 'x', en: 'you all', enPerson: '2' },
};

/** The pronouns after "a" in an experiencer (a mí, a ti); the rest are the subject pronouns. */
const OBLIQUE: Record<string, PronounInfo> = {
  ...Object.fromEntries(Object.entries(PRONOUNS).filter(([k]) => k !== 'yo' && k !== 'tú')),
  mí: PRONOUNS.yo,
  ti: PRONOUNS['tú'],
};

interface DetInfo {
  gender: Gender;
  number: 'sg' | 'pl';
  en: string;
}

const DETS: Record<string, DetInfo> = {
  el: { gender: 'm', number: 'sg', en: 'the' },
  la: { gender: 'f', number: 'sg', en: 'the' },
  los: { gender: 'm', number: 'pl', en: 'the' },
  las: { gender: 'f', number: 'pl', en: 'the' },
  un: { gender: 'm', number: 'sg', en: 'a' },
  una: { gender: 'f', number: 'sg', en: 'a' },
  unos: { gender: 'm', number: 'pl', en: 'some' },
  unas: { gender: 'f', number: 'pl', en: 'some' },
  mi: { gender: 'x', number: 'sg', en: 'my' },
  mis: { gender: 'x', number: 'pl', en: 'my' },
  este: { gender: 'm', number: 'sg', en: 'this' },
  esta: { gender: 'f', number: 'sg', en: 'this' },
  estos: { gender: 'm', number: 'pl', en: 'these' },
  estas: { gender: 'f', number: 'pl', en: 'these' },
  ese: { gender: 'm', number: 'sg', en: 'that' },
  esa: { gender: 'f', number: 'sg', en: 'that' },
  esos: { gender: 'm', number: 'pl', en: 'those' },
  esas: { gender: 'f', number: 'pl', en: 'those' },
  ...Object.fromEntries(
    NUMBERS.filter((n) => n.n >= 2).map((n) => [n.es, { gender: 'x' as Gender, number: 'pl' as const, en: n.en }]),
  ),
};

/** Determiners and words that make a subject unclear, with the reason shown to the teacher. */
const BANNED: Record<string, string> = {
  tu: '"tu" (your) looks like "tú" (you); use mi or a name',
  tus: '"tus" (your) looks like "tú" (you); use mis or a name',
  su: '"su / sus" is vague (his, her, their, your)',
  sus: '"su / sus" is vague (his, her, their, your)',
  nuestro: '"nuestro" invites the nosotros form',
  nuestra: '"nuestra" invites the nosotros form',
  nuestros: '"nuestros" invites the nosotros form',
  nuestras: '"nuestras" invites the nosotros form',
  vuestro: '"vuestro" invites the vosotros form',
  vuestra: '"vuestra" invites the vosotros form',
  vuestros: '"vuestros" invites the vosotros form',
  vuestras: '"vuestras" invites the vosotros form',
  cada: '"cada" makes the number unclear',
  o: '"o" coordination makes the number unclear',
  u: '"u" coordination makes the number unclear',
  ni: '"ni" coordination makes the number unclear',
  con: 'a "con" phrase does not change the number (mi hermano con mis primos is singular)',
  nadie: 'indefinite pronouns are not used as subjects',
  alguien: 'indefinite pronouns are not used as subjects',
  nada: 'indefinite pronouns are not used as subjects',
  algo: 'indefinite pronouns are not used as subjects',
  alguno: 'indefinite pronouns are not used as subjects',
  alguna: 'indefinite pronouns are not used as subjects',
  ninguno: 'indefinite pronouns are not used as subjects',
  ninguna: 'indefinite pronouns are not used as subjects',
  mayoría: '"la mayoría de" makes the number unclear',
};

type Failure = { ok: false; rule: RuleCode; message: string; words?: string[] };

function fail(rule: RuleCode, message: string, w?: string[]): Failure {
  return { ok: false, rule, message, ...(w ? { words: w } : {}) };
}

function nounEnglish(noun: NounEntry, number: 'sg' | 'pl'): string {
  return number === 'sg' ? noun.en : noun.enPl;
}

function article(det: DetInfo, en: string): string {
  if (det.en === 'a' && /^[aeiou]/i.test(en)) return `an ${en}`;
  return `${det.en} ${en}`;
}

type MemberParse = { ok: true; member: Member; end: number } | Failure;

/** Checks a noun's agreement with its determiner; returns an error message or null. */
function detAgreement(det: DetInfo, detWord: string, noun: NounEntry, number: 'sg' | 'pl'): string | null {
  if (det.number !== number) return `"${detWord}" and "${number === 'sg' ? noun.sg : noun.pl}" do not agree in number`;
  if (det.gender === 'x' || noun.g === 'mf') return null;
  // el agua, el hambre: feminine nouns that take el / un in the singular
  if (noun.elArticle && number === 'sg' && (detWord === 'el' || detWord === 'un')) return null;
  if (noun.elArticle && number === 'sg' && (detWord === 'la' || detWord === 'una')) return `"${noun.sg}" takes "el" in the singular (el ${noun.sg})`;
  if (det.gender !== noun.g) return `"${detWord}" and "${number === 'sg' ? noun.sg : noun.pl}" do not agree in gender`;
  return null;
}

/**
 * One member of a subject: a pronoun, a name, or determiner + known noun
 * (+ agreeing adjectives). `oblique` reads the pronouns after "a" (mí, ti).
 */
function parseMember(toks: Token[], i: number, oblique: boolean, impliedEl = false): MemberParse {
  const t = toks[i];
  if (!t) return fail('unknownSubject', 'the subject is incomplete');
  const next = toks[i + 1];
  const nounNext = !!next && NOUN_FORMS.has(next.low);

  if (!impliedEl) {
    // bare "el" / "tu" / "mi" where the pronoun (él, tú, mí) is meant
    if (t.low === 'el' && !nounNext) return fail('accent', '"El" with no noun after it must be "Él" (he), with the accent', [t.text]);
    if (t.low === 'tu' && !nounNext) return fail('accent', '"Tu" with no noun after it must be "Tú" (you), with the accent', [t.text]);
    if (oblique && t.low === 'mi' && !nounNext) return fail('accent', '"a mi" must be "a mí", with the accent', [t.text]);
    if (oblique && t.low === 'tí') return fail('accent', '"a tí" is written "a ti", without an accent', [t.text]);
    if ((t.low === 'él' || t.low === 'tú' || t.low === 'mí') && nounNext) {
      return fail('accent', `"${t.text}" before a noun is the determiner, written without the accent`, [t.text]);
    }

    const pron = (oblique ? OBLIQUE : PRONOUNS)[t.low];
    if (pron) {
      const word = t.low === 'mí' ? 'yo' : t.low === 'ti' ? 'tú' : t.low;
      return {
        ok: true,
        end: i + 1,
        member: {
          es: t.text,
          person: pron.person,
          number: pron.number,
          gender: pron.gender,
          en: pron.en,
          enPerson: pron.enPerson,
          tags: [...(PRONOUN_TAGS[word] ?? ANY_PERSON_TAGS)],
          lemmas: [word],
          refs: [],
          kind: 'pronoun',
          pronounWord: word,
        },
      };
    }
    if (!oblique && (t.low === 'mí' || t.low === 'ti')) return fail('unknownSubject', `"${t.text}" is not a subject pronoun`, [t.text]);

    const nameG = NAME_GENDER.get(t.low);
    if (nameG && t.cap) {
      return {
        ok: true,
        end: i + 1,
        member: {
          es: t.text,
          person: 'el',
          number: 'sg',
          gender: nameG,
          en: t.text,
          enPerson: '3sg',
          tags: [...LEARNER_TAGS],
          lemmas: [t.low],
          refs: [],
          kind: 'name',
        },
      };
    }
  }

  const detWord = impliedEl ? 'el' : t.low;
  const det = DETS[detWord];
  const ni = impliedEl ? i : i + 1;
  if (!det) {
    if (NOUN_FORMS.has(t.low)) return fail('unknownSubject', `"${t.text}" needs a determiner (mi, el, la, los…)`, [t.text]);
    return fail('unknownSubject', `the checker cannot read "${t.text}" as a subject`, [t.text]);
  }
  const nt = toks[ni];
  if (!nt) return fail('unknownSubject', `"${t.text}" has no noun after it`, [t.text]);
  const forms = NOUN_FORMS.get(nt.low);
  if (!forms) return fail('unknownSubject', `the checker does not know the noun "${nt.text}"`, [nt.text]);
  const hit = forms.find((f) => f.number === det.number) ?? forms[0];
  const { noun, number } = hit;
  if (noun.collective) {
    return fail('bannedSubject', `"${nt.text}" is a collective noun (singular verb, plural meaning)`, [nt.text]);
  }
  const agree = detAgreement(det, detWord, noun, number);
  if (agree) return fail('agreement', agree, [impliedEl ? 'al' : t.text, nt.text]);
  const gender: Gender = noun.g === 'mf' ? (det.gender === 'x' ? 'x' : det.gender) : noun.g;
  let end = ni + 1;
  const adjEn: string[] = [];
  while (toks[end] && ADJ_FORMS.has(toks[end].low)) {
    const a = ADJ_FORMS.get(toks[end].low)!;
    if (a.number !== number || (a.gender !== 'x' && gender !== 'x' && a.gender !== gender)) {
      return fail('agreement', `"${toks[end].text}" does not agree with "${nt.text}"`, [nt.text, toks[end].text]);
    }
    adjEn.push(a.adj.en);
    end++;
  }
  const head = [...adjEn, nounEnglish(noun, number)].join(' ');
  const thing = noun.tags.includes('thing');
  const esText = impliedEl ? `al ${toks.slice(ni, end).map((x) => x.text).join(' ')}` : toks.slice(i, end).map((x) => x.text).join(' ');
  return {
    ok: true,
    end,
    member: {
      es: esText,
      person: number === 'sg' ? 'el' : 'ellos',
      number,
      gender,
      en: article(det, head),
      enPerson: number === 'sg' ? '3sg' : '3pl',
      tags: [...noun.tags],
      lemmas: [...new Set([noun.sg, kinKey(noun)])],
      refs: (detWord === 'mi' || detWord === 'mis') && noun.tags.includes('person') ? nounRefs(noun, number, gender) : [],
      kind: thing ? 'thing' : 'np',
    },
  };
}

/** The persons of a coordination: yo → nosotros; tú/vos → ustedes, or ambiguous with vosotros on. */
function coordinationPersons(members: Member[], vosotros: boolean): Person[] {
  const ps = members.map((m) => m.person);
  if (ps.includes('yo') || ps.includes('nosotros')) return ['nosotros'];
  if (ps.includes('vosotros')) return ['vosotros'];
  if (ps.includes('tu') || ps.includes('vos')) return vosotros ? ['vosotros', 'ellos'] : ['ellos'];
  return ['ellos'];
}

function joinEnglish(parts: string[]): string {
  // "you" goes first and "I" last: "you and Ana", "my brother and I"
  const you = parts.filter((p) => p === 'you' || p === 'you all');
  const rest = parts.filter((p) => p !== 'I' && p !== 'you' && p !== 'you all');
  const sorted = [...you, ...rest, ...parts.filter((p) => p === 'I')];
  return sorted.length <= 2 ? sorted.join(' and ') : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/** The order English uses for a pair ("my aunt and uncle", not "my uncle and my aunt"). */
const EN_PAIRS: Record<string, string> = {
  'my uncle and my aunt': 'my aunt and uncle',
  'my aunt and my uncle': 'my aunt and uncle',
  'my father and my mother': 'my mother and father',
  'my dad and my mom': 'my mom and dad',
  'my grandfather and my grandmother': 'my grandparents',
};

function combine(members: Member[], vosotros: boolean, experiencer: boolean, es: string): ParsedSubject {
  if (members.length === 1) {
    const m = members[0];
    const kind: SubjectKind = experiencer
      ? 'experiencer'
      : m.kind === 'pronoun'
        ? 'pronoun'
        : m.kind === 'name'
          ? 'name'
          : m.kind === 'thing'
            ? 'thing'
            : m.number === 'sg'
              ? 'np_sg'
              : 'np_pl';
    return {
      es,
      persons: [m.person],
      number: m.number,
      gender: m.gender,
      kind,
      en: m.en,
      enPerson: m.enPerson,
      tags: m.tags,
      lemmas: m.lemmas,
      ...(m.refs.length ? { refs: m.refs } : {}),
      ...(m.kind === 'pronoun' ? { pronoun: true, pronounWord: m.pronounWord } : {}),
    };
  }
  const persons = coordinationPersons(members, vosotros);
  const hasFirst = persons[0] === 'nosotros';
  const hasSecond = members.some((m) => m.enPerson === '2');
  const gender: Gender = members.some((m) => m.gender === 'm')
    ? 'm'
    : members.some((m) => m.gender === 'x')
      ? 'x'
      : 'f';
  const tags = members.reduce<Tag[]>((acc, m) => acc.filter((t) => m.tags.includes(t)), [...members[0].tags]);
  return {
    es,
    persons,
    number: 'pl',
    gender,
    kind: experiencer ? 'experiencer' : hasFirst ? 'coord_yo' : hasSecond ? 'coord_tu' : 'coord',
    en: EN_PAIRS[joinEnglish(members.map((m) => m.en))] ?? joinEnglish(members.map((m) => m.en)),
    enPerson: hasFirst ? '1pl' : hasSecond ? '2' : '3pl',
    tags,
    lemmas: members.flatMap((m) => m.lemmas),
    ...(members.some((m) => m.refs.length) ? { refs: members.flatMap((m) => m.refs) } : {}),
  };
}

function checkBanned(toks: Token[]): SubjectParse | null {
  for (let i = 0; i < toks.length; i++) {
    const low = toks[i].low;
    if (low === 'uno' || low === 'una' || low === 'unos' || low === 'unas') {
      if (toks[i + 1]?.low === 'de') return fail('bannedSubject', '"uno de…" makes the head noun unclear', [toks[i].text, 'de']);
    }
    if (low === 'todo' && toks[i + 1]?.low === 'el' && toks[i + 2]?.low === 'mundo') {
      return fail('bannedSubject', 'indefinite pronouns ("todo el mundo") are not used as subjects', ['todo el mundo']);
    }
    // a bare "tu" (no noun after it) is the accent rule's business; "tu hermano" is banned
    if (low === 'tu' && !(toks[i + 1] && NOUN_FORMS.has(toks[i + 1].low))) continue;
    if (BANNED[low]) return fail('bannedSubject', BANNED[low], [toks[i].text]);
  }
  return null;
}

/** Words plus the commas of a list ("mi abuela, mi abuelo y yo"); other punctuation dropped. */
function listTokens(tokens: Token[]): Token[] {
  const out = tokens.filter((t) => !t.punct || t.text === ',');
  while (out.length && out[out.length - 1].punct) out.pop();
  while (out.length && out[0].punct) out.shift();
  return out;
}

function joinText(toks: Token[]): string {
  return toks.map((t) => t.text).join(' ').replace(/ ,/g, ',');
}

function isSeparator(t: Token): boolean {
  return t.low === 'y' || t.low === 'e' || t.text === ',';
}

/**
 * Parses the words before the blank as a subject (time words, interjections,
 * leading phrases and pre-verbal adverbs already removed). Coordinations
 * use "y" (or "e").
 */
export function parseSubject(tokens: Token[], opts: { vosotros: boolean }): SubjectParse {
  const toks = listTokens(tokens);
  if (!toks.length) return fail('noSubject', 'there is no subject before the blank');
  const banned = checkBanned(toks);
  if (banned) return banned;
  const members: Member[] = [];
  let i = 0;
  for (;;) {
    const m = parseMember(toks, i, false);
    if (!m.ok) return m;
    members.push(m.member);
    i = m.end;
    if (i >= toks.length) break;
    if (isSeparator(toks[i])) {
      i++;
      continue;
    }
    return fail('unknownSubject', `the checker cannot read "${toks.slice(i).map((t) => t.text).join(' ')}" in the subject`, toks.slice(i).map((t) => t.text));
  }
  return { ok: true, subject: combine(members, opts.vosotros, false, joinText(toks)) };
}

/** Parses "A mi abuela", "A mis primos", "A mí", "Al perro", "A Ana y a Luis", "A mi hermano y a mí". */
export function parseExperiencer(tokens: Token[], opts: { vosotros: boolean }): SubjectParse {
  const toks = listTokens(tokens);
  if (!toks.length || (toks[0].low !== 'a' && toks[0].low !== 'al')) {
    return fail('experiencer', 'a gustar sentence needs the person who likes before the blank: "A mi abuela ___ (gustar)…"');
  }
  const banned = checkBanned(toks);
  if (banned) return banned;
  const members: Member[] = [];
  let i = 0;
  for (;;) {
    const lead = toks[i]?.low;
    if (lead !== 'a' && lead !== 'al') {
      return fail('experiencer', 'each person who likes needs "a": "A Ana y a Luis"', toks.slice(i).map((t) => t.text));
    }
    const m = parseMember(toks, i + 1, true, lead === 'al');
    if (!m.ok) return m;
    if (m.member.kind === 'thing') return fail('experiencer', `"${m.member.es}" is a thing, not a person who likes`, [m.member.es]);
    members.push(m.member);
    i = m.end;
    if (i >= toks.length) break;
    if (isSeparator(toks[i])) {
      i++;
      continue;
    }
    return fail('unknownSubject', `the checker cannot read "${toks.slice(i).map((t) => t.text).join(' ')}" after the person who likes`, toks.slice(i).map((t) => t.text));
  }
  return { ok: true, subject: combine(members, opts.vosotros, true, joinText(toks)) };
}

/**
 * Reads a thing (the thing liked, or a thing subject): determiner + known
 * noun (+ adjectives), "X y Y" (plural), a name or a place (singular), or an
 * infinitive phrase (singular). Returns its number, or null.
 */
export function thingNumber(tokens: Token[], ctx: { isInfinitive: (w: string) => boolean }): 'sg' | 'pl' | null {
  const toks = words(tokens);
  let i = 0;
  while (toks[i] && (toks[i].low === 'mucho' || toks[i].low === 'también' || toks[i].low === 'más' || toks[i].low === 'muchísimo')) i++;
  const first = toks[i];
  if (!first) return null;
  if (ctx.isInfinitive(first.low)) return 'sg';
  if (first.cap && (NAME_GENDER.has(first.low) || ['lima', 'madrid', 'méxico', 'texas', 'bogotá', 'guatemala'].includes(first.low))) {
    return toks[i + 1]?.low === 'y' ? 'pl' : 'sg';
  }
  let count = 0;
  let number: 'sg' | 'pl' | null = null;
  for (;;) {
    const m = parseMember(toks, i, false);
    if (!m.ok || m.member.kind === 'pronoun') return null;
    count++;
    number = m.member.number;
    i = m.end;
    while (toks[i] && toks[i].low === 'de' && toks[i + 1] && (NOUN_FORMS.has(toks[i + 1].low) || toks[i + 1].low === 'español')) i += 2;
    if (toks[i] && (toks[i].low === 'y' || toks[i].low === 'e') && toks[i + 1] && DETS[toks[i + 1].low]) {
      i++;
      continue;
    }
    break;
  }
  return count > 1 ? 'pl' : number;
}

// ---------------------------------------------------------------------------
// The bank

export interface BankSubject {
  id: string;
  es: string;
  subject: ParsedSubject;
}

const BANK_NAMES = ['Ana', 'Luis', 'Sofía', 'Mateo'];

function known(es: string, ctx: DeckContext): boolean {
  return es.split(/\s+/).every((w) => wordStatus(w, ctx) === 'ok');
}

function nounPhrase(n: NounEntry, number: 'sg' | 'pl'): string | null {
  const form = number === 'sg' ? n.sg : n.pl;
  if (!form || (number === 'sg' && n.plOnly)) return null;
  if (n.det === 'mi') return `${number === 'sg' ? 'mi' : 'mis'} ${form}`;
  const g = n.g === 'mf' ? (number === 'sg' ? 'f' : 'm') : n.g;
  const art = number === 'sg' ? (g === 'f' ? 'la' : 'el') : g === 'f' ? 'las' : 'los';
  return `${art} ${form}`;
}

/** Noun phrases from the deck's nouns, singular and plural: "mi abuela", "mis primos", "el chico", "los estudiantes". */
export function deckNounPhrases(ctx: DeckContext): { es: string; noun: NounEntry; number: 'sg' | 'pl' }[] {
  const out: { es: string; noun: NounEntry; number: 'sg' | 'pl' }[] = [];
  for (const n of NOUNS) {
    if (!n.subject || n.collective) continue;
    for (const number of ['sg', 'pl'] as const) {
      const es = nounPhrase(n, number);
      if (es && known(es, ctx)) out.push({ es, noun: n, number });
    }
  }
  return out;
}

function parsed(es: string, ctx: DeckContext, experiencer = false): ParsedSubject | null {
  const toks = tokenize(contract(es));
  const r = experiencer ? parseExperiencer(toks, { vosotros: ctx.deck.vosotros }) : parseSubject(toks, { vosotros: ctx.deck.vosotros });
  return r.ok ? r.subject : null;
}

function bankEntry(prefix: string, es: string, ctx: DeckContext, experiencer = false): BankSubject | null {
  const text = contract(es);
  if (!known(text, ctx)) return null;
  const subject = parsed(text, ctx, experiencer);
  if (!subject) return null;
  // a subject that is ambiguous under the deck's settings (Ana y tú with vosotros on) is left out
  if (subject.persons.length !== 1) return null;
  return { id: `${prefix}:${slug(text)}`, es: text, subject };
}

/** The pronouns a deck's settings allow, one at a time. */
function pronounList(ctx: DeckContext): string[] {
  const list = ['yo', 'tú'];
  if (ctx.deck.vos) list.push('vos');
  list.push('él', 'ella', 'usted', 'nosotros', 'nosotras');
  if (ctx.deck.vosotros) list.push('vosotros', 'vosotras');
  list.push('ellos', 'ellas', 'ustedes');
  return list;
}

/** Two coordinations of nouns the deck knows, plus fixed ones with names and pronouns. */
function coordinations(ctx: DeckContext, nps: { es: string; noun: NounEntry; number: 'sg' | 'pl' }[]): string[] {
  const sg = (lemma: string) => nps.find((p) => p.noun.sg === lemma && p.number === 'sg')?.es;
  const out = ['Ana y Luis', 'Sofía y Elena', 'Ana y yo', 'tú y yo'];
  const mine = sg('hermano') ?? sg('amigo');
  if (mine) out.push(`${mine} y yo`);
  const herMine = sg('hermana') ?? sg('amiga');
  if (herMine) out.push(`${herMine} y yo`);
  if (!ctx.deck.vosotros) out.push('Ana y tú');
  const pair = sg('tío') && sg('tía') ? `${sg('tío')} y ${sg('tía')}` : sg('chico') && sg('chica') ? `${sg('chico')} y ${sg('chica')}` : null;
  if (pair) out.push(pair);
  return out;
}

/** Every subject the renderer may use for a deck (each parsed by the checker's own parser). */
export function subjectBank(ctx: DeckContext): BankSubject[] {
  const nps = deckNounPhrases(ctx);
  const out: (BankSubject | null)[] = [
    ...pronounList(ctx).map((p) => bankEntry('pr', p, ctx)),
    ...BANK_NAMES.map((n) => bankEntry('name', n, ctx)),
    ...nps.map((p) => bankEntry('np', p.es, ctx)),
    ...coordinations(ctx, nps).map((c) => bankEntry('co', c, ctx)),
  ];
  return out.filter((b): b is BankSubject => !!b);
}

/** Every experiencer for the gustar entries ("A mí", "A mi abuela", "A Ana y a Luis"). */
export function experiencerBank(ctx: DeckContext): BankSubject[] {
  const pron = pronounList(ctx).map((p) => (p === 'yo' ? 'mí' : p === 'tú' ? 'ti' : p));
  const nps = deckNounPhrases(ctx).filter((p) => !p.noun.tags.includes('baby'));
  const sg = (lemma: string) => nps.find((p) => p.noun.sg === lemma && p.number === 'sg')?.es;
  const coords = ['Ana y a Luis', 'ti y a mí'];
  const mine = sg('hermano') ?? sg('amigo');
  if (mine) coords.push(`${mine} y a mí`);
  const out: (BankSubject | null)[] = [
    ...pron.map((p) => bankEntry('ex', `a ${p}`, ctx, true)),
    ...BANK_NAMES.slice(0, 2).map((n) => bankEntry('ex', `a ${n}`, ctx, true)),
    ...nps.map((p) => bankEntry('ex', `a ${p.es}`, ctx, true)),
    ...coords.map((c) => bankEntry('ex', `a ${c}`, ctx, true)),
  ];
  return out.filter((b): b is BankSubject => !!b);
}

export { NAMES };
