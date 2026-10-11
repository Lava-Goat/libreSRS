// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Naming a wrong answer: what a wrong form most likely is, so the quiz can say
 * it in one line and link the guide section that explains the rule.
 *
 * Deterministic and engine-only (no AI): the verb's forms in the other persons
 * and tenses, the regularized variants the distractors offer, the other kinds
 * of the same verb (gusto / me gusto / me gusta), and the reverse index
 * (analyze). Learners' errors are systematic enough for this: the él form for
 * yo, singular for plural, irregular verbs made regular, "gusto" for "me
 * gusta" (Cuervo et al. 2021; Bruhn de Garavito 2003; Gascon 1998). When no
 * reading fits, it says 'unknown' rather than guess.
 *
 * Kinds, and the detail each one sets:
 *  - person: a form of another person of the same verb and tense (tiene for
 *    tengo) — detail.person, and detail.number for a gustar-type verb;
 *  - tense: the same verb in another tense — detail.tense (and detail.person
 *    when the person is off too);
 *  - regularized: an irregular, stem-changing or spelling-changing verb made
 *    regular — detail.change (yo: teno; stem: quero, sentió; stemEverywhere:
 *    piensamos; spelling: buscé; irregular: esto);
 *  - dativeSubject: a gustar-type verb conjugated for the person who likes
 *    (gusto, yo gusto, yo me gusta) — detail.person, detail.subjectPronoun;
 *  - dativeNumber: gusta / gustan, the number of the thing liked — detail.number (of the answer);
 *  - dativeSelf: me gusto ("I like myself") for me gusta;
 *  - pronounMissing: llamo for me llamo, gusta for me gusta — detail.pronoun (the missing one);
 *  - pronounExtra: a pronoun a plain verb does not take (me vivo) — detail.pronoun;
 *  - pronounWrong: the wrong reflexive pronoun (se llamo for me llamo) — detail.pronoun, detail.expectedPronoun;
 *  - impersonal: hay / llueve given a person (ha, han, habían, llueven) — detail.person, detail.tense;
 *  - infinitive: the dictionary form itself (tener);
 *  - otherVerb: a form of another verb (estoy for soy) — detail.entry, detail.tense, detail.person;
 *  - accent: right but for a written accent (the near miss);
 *  - unknown: none of these.
 */
import { foldAccents } from './accent.js';
import { analyze, analyzeIgnoringAccents, type Analysis } from './analyze.js';
import { conjugate, conjugatePlain, parseEntry } from './conjugate.js';
import { regularizedVariants, type RegularizedHow } from './distractors.js';
import { experiencerPerson, gradeTyped, normalizeAnswer, subjectPronounPerson } from './grade.js';
import { patternTags, type PatternTag } from './pattern.js';
import {
  DATIVE_CLITICS,
  NUMBER_IDS,
  PERSON_IDS,
  TENSE_IDS,
  isImperative,
  type GNumber,
  type Person,
  type Tense,
  type VosRegion,
} from './types.js';

export type MistakeKind =
  | 'person'
  | 'tense'
  | 'regularized'
  | 'dativeSubject'
  | 'dativeNumber'
  | 'dativeSelf'
  | 'pronounMissing'
  | 'pronounExtra'
  | 'pronounWrong'
  | 'impersonal'
  | 'infinitive'
  | 'otherVerb'
  | 'accent'
  | 'unknown';

export const MISTAKE_KINDS: readonly MistakeKind[] = [
  'person', 'tense', 'regularized', 'dativeSubject', 'dativeNumber', 'dativeSelf', 'pronounMissing',
  'pronounExtra', 'pronounWrong', 'impersonal', 'infinitive', 'otherVerb', 'accent', 'unknown',
];

/** What a regularized form left out. */
export type RegularizedChange = 'yo' | 'stem' | 'stemEverywhere' | 'spelling' | 'irregular';

/** The facts of a mistake; which ones are set depends on the kind (see the file comment). */
export interface MistakeDetail {
  person?: Person;
  number?: GNumber;
  tense?: Tense;
  change?: RegularizedChange;
  /** otherVerb: the entry the answer is a form of ("estar", "gustarse"). */
  entry?: string;
  /** pronounMissing: the pronoun left out; pronounExtra / pronounWrong: the one given. */
  pronoun?: string;
  /** pronounWrong: the pronoun the person takes. */
  expectedPronoun?: string;
  /** dativeSubject: a subject pronoun given with a gustar-type verb ("yo gusto"). */
  subjectPronoun?: string;
}

export interface Mistake {
  kind: MistakeKind;
  detail: MistakeDetail;
}

/** The cell a prompt asked for. */
export interface MistakeCell {
  entry: string;
  tense: Tense;
  person: Person;
  /** Dative entries: the number of the thing liked. */
  number?: GNumber;
}

export interface MistakeOptions {
  /** The deck's vos region, which decides the accepted vos forms. */
  vosRegion?: VosRegion | null;
  /** The tenses the deck drills: readings in them are preferred ("hablo" for habló is the present in a present + preterite deck). */
  tenses?: readonly Tense[];
  /** The deck's entries: another verb of the deck is named before any other. */
  entries?: readonly string[];
}

const REFLEXIVE: Record<Person, string> = { yo: 'me', tu: 'te', vos: 'te', el: 'se', nosotros: 'nos', vosotros: 'os', ellos: 'se' };
const REFLEXIVE_WORDS = new Set(['me', 'te', 'se', 'nos', 'os']);
/** The person a first- or second-person pronoun agrees with, when a verb agrees with it (me gusto: yo). */
const SELF_PERSON: Record<string, Person | undefined> = { me: 'yo', te: 'tu', nos: 'nosotros', os: 'vosotros' };
/** The singular person of a plural one. */
const SINGULAR_OF: Partial<Record<Person, Person>> = { nosotros: 'yo', vosotros: 'tu', ellos: 'el' };

const mistake = (kind: MistakeKind, detail: MistakeDetail = {}): Mistake => ({ kind, detail });
const unknown = (): Mistake => mistake('unknown');
const baseOf = (entry: string): string | undefined => parseEntry(entry)?.base;
const isStem = (tag: PatternTag): boolean => tag.startsWith('stem:');

/** Of several readings, the person a learner most likely meant: él first (the dominant error), then the singular of a plural. */
function likeliestPerson(readings: readonly Analysis[], target: Person): Analysis {
  const order: Person[] = ['el', ...(SINGULAR_OF[target] ? [SINGULAR_OF[target] as Person] : []), ...PERSON_IDS];
  return [...readings].sort((a, b) => order.indexOf(a.person) - order.indexOf(b.person))[0];
}

/** Of several readings, the one in a tense the deck drills, earliest in teaching order. */
function likeliestTense(readings: readonly Analysis[], drilled: readonly Tense[]): Analysis {
  const rank = (t: Tense) => (drilled.includes(t) ? drilled.indexOf(t) : drilled.length + TENSE_IDS.indexOf(t));
  return [...readings].sort((a, b) => rank(a.tense) - rank(b.tense))[0];
}

/** What a regularized variant left out, in terms of the rule the guide teaches for this cell. */
function changeOf(how: RegularizedHow, cell: MistakeCell): RegularizedChange {
  const tags = patternTags(cell.entry, cell.tense);
  if (how === 'stemEverywhere') return 'stemEverywhere';
  if (how === 'noPreteriteChange') return 'stem';
  if (how === 'noSpelling' && tags.includes('spelling')) return 'spelling';
  // The present subjunctive and the formal commands are built on the yo form (tenga, tengan).
  const onYo = cell.person === 'yo' || cell.tense === 'presentSubjunctive' || isImperative(cell.tense);
  if (tags.includes('yo') && onYo) return 'yo';
  if (tags.some(isStem)) return 'stem';
  if (tags.includes('irregular') || tags.includes('participle')) return 'irregular';
  if (tags.includes('yo')) return 'yo';
  if (tags.includes('spelling')) return 'spelling';
  return 'irregular';
}

/**
 * What a wrong answer to a "give the form" prompt most likely is, or null when
 * the answer is right. `given` is what the student typed or picked, with a
 * gustar-type prompt's cue already taken off (withoutCue).
 */
export function classifyMistake(cell: MistakeCell, given: string, opts: MistakeOptions = {}): Mistake | null {
  const parsed = parseEntry(cell.entry);
  const answer = normalizeAnswer(given);
  if (!parsed || !answer) return unknown();
  const { base, kind } = parsed;
  const region = opts.vosRegion ?? undefined;
  const number: GNumber = cell.number ?? 'sg';
  const accepted = (conjugate(cell.entry, cell.tense, cell.person, number, region ? { vosRegion: region } : {}) ?? []).map(normalizeAnswer);
  if (accepted.length === 0) return unknown();
  const grade = gradeTyped(accepted, answer, true, cell.person, kind);
  if (grade === 'correct') return null;
  const drilled: readonly Tense[] = opts.tenses && opts.tenses.length > 0 ? opts.tenses : [cell.tense];
  const fold = (s: string) => foldAccents(normalizeAnswer(s));

  // Peel off what surrounds the verb: a subject pronoun (yo tiene) and a gustar-type experiencer (a mí me gustan).
  let words = answer.split(' ');
  let subject: { word: string; person: Person } | undefined;
  const first = words.length > 1 ? subjectPronounPerson(words[0]) : undefined;
  if (first) {
    subject = { word: words[0], person: first };
    words = words.slice(1);
  }
  let experiencer: Person | undefined;
  if (kind === 'dative' && words.length > 2) {
    const before = words[0] === 'a' ? experiencerPerson(words[1]) : undefined;
    const after = !before && words[words.length - 2] === 'a' ? experiencerPerson(words[words.length - 1]) : undefined;
    experiencer = before ?? after;
    if (before) words = words.slice(2);
    else if (after) words = words.slice(0, -2);
  }
  const core = words.join(' ');
  if (!core) return unknown();

  // The dictionary form itself (tener, llamarse, gustar, gustarle).
  const names = new Set([base, cell.entry, `${base}se`, `${base}le`].map(fold));
  if (names.has(fold(core))) return mistake('infinitive');

  const exact = analyze(core);
  const own = exact.filter((r) => r.infinitive === cell.entry);
  const ownDrilled = own.filter((r) => drilled.includes(r.tense));

  /** A form of the verb itself in another cell: another person of the tense, or another tense. */
  const fromOwn = (readings: readonly Analysis[]): Mistake => {
    const sameTense = readings.filter((r) => r.tense === cell.tense);
    if (sameTense.length > 0) {
      const samePerson = sameTense.filter((r) => r.person === cell.person);
      if (kind === 'dative' && samePerson.length > 0) return mistake('dativeNumber', { number: samePerson[0].number ?? 'sg' });
      const r = likeliestPerson(sameTense, cell.person);
      return mistake('person', { person: r.person, ...(kind === 'dative' && r.number ? { number: r.number } : {}) });
    }
    const samePerson = readings.filter((r) => r.person === cell.person && (r.number ?? 'sg') === number);
    const r = likeliestTense(samePerson.length > 0 ? samePerson : readings, drilled);
    return mistake('tense', { tense: r.tense, ...(r.person !== cell.person ? { person: r.person } : {}) });
  };

  // The verb form is right; what is wrong is around it.
  if (accepted.includes(core)) {
    if (kind === 'dative' && subject) return mistake('dativeSubject', { person: subject.person, subjectPronoun: subject.word });
    if (kind === 'dative' && experiencer && experiencer !== cell.person) return mistake('person', { person: experiencer, number });
    // An accent slip in the experiencer ("a mi me gusta").
    if (grade === 'accent') return mistake('accent');
    return unknown();
  }

  // Right but for the accents — unless the letters typed are another form of the verb the deck drills ("hablo" for habló).
  if (grade === 'accent' || accepted.some((a) => foldAccents(a) === foldAccents(core))) {
    return ownDrilled.length > 0 ? fromOwn(ownDrilled) : mistake('accent');
  }

  if (kind === 'dative') {
    const clitic = DATIVE_CLITICS[cell.person];
    // "gusta" for "me gusta": the pronoun left out (in either number).
    for (const n of NUMBER_IDS) {
      const forms = (conjugate(cell.entry, cell.tense, cell.person, n) ?? []).map(normalizeAnswer);
      if (forms.some((f) => f.split(' ').slice(1).join(' ') === core)) {
        return mistake('pronounMissing', { pronoun: clitic, ...(n !== number ? { number: n } : {}) });
      }
    }
    // Conjugated for the person who likes: "gusto", "yo gusto", "gustas".
    const bySubject = exact.filter((r) => r.infinitive === base && r.tense === cell.tense);
    if (bySubject.length > 0) {
      const r = likeliestPerson(bySubject, cell.person);
      return mistake('dativeSubject', { person: r.person, ...(subject ? { subjectPronoun: subject.word } : {}) });
    }
    if (exact.some((r) => r.infinitive === `${base}se` && r.tense === cell.tense)) return mistake('dativeSelf');
    // The same by its shape, for verbs the dictionary has no -se entry of: "te encantas",
    // "nos dolemos" agree with the pronoun; "se duele" puts se where le belongs.
    const [pronoun, ...rest] = core.split(' ');
    const verb = rest.join(' ');
    const plainOf = (p: Person) => (conjugatePlain(base, cell.tense, p, false, region) ?? []).map(normalizeAnswer);
    if (verb && SELF_PERSON[pronoun] && plainOf(SELF_PERSON[pronoun] as Person).includes(verb)) return mistake('dativeSelf');
    if (verb && pronoun === 'se' && (['el', 'ellos'] as Person[]).some((p) => plainOf(p).includes(verb))) {
      return mistake('pronounWrong', { pronoun, expectedPronoun: clitic });
    }
  } else if (kind === 'pronominal') {
    const expected = REFLEXIVE[cell.person];
    const plain = (conjugatePlain(base, cell.tense, cell.person, false, region) ?? []).map(normalizeAnswer);
    if (plain.includes(core)) return mistake('pronounMissing', { pronoun: expected });
    const [pronoun, ...rest] = core.split(' ');
    if (REFLEXIVE_WORDS.has(pronoun) && pronoun !== expected && plain.includes(rest.join(' '))) {
      return mistake('pronounWrong', { pronoun, expectedPronoun: expected });
    }
  } else if (kind === 'plain') {
    const [pronoun, ...rest] = core.split(' ');
    if (REFLEXIVE_WORDS.has(pronoun) && rest.length > 0 && accepted.includes(rest.join(' '))) return mistake('pronounExtra', { pronoun });
  }

  if (ownDrilled.length > 0) return fromOwn(ownDrilled);

  // hay and the weather verbs have one form for everyone: ha, han, habían, llueven give them a person.
  // (había is hay's own imperfect: a tense, below.)
  if (kind === 'impersonal' && own.length === 0) {
    const tenses = [cell.tense, ...drilled.filter((t) => t !== cell.tense), ...TENSE_IDS.filter((t) => t !== cell.tense && !drilled.includes(t))];
    for (const tense of tenses) {
      for (const person of PERSON_IDS) {
        if ((conjugatePlain(base, tense, person, false) ?? []).map(normalizeAnswer).includes(core)) {
          return mistake('impersonal', { person, ...(tense !== cell.tense ? { tense } : {}) });
        }
      }
    }
  }

  // The verb made regular (teno, quero, piensamos, buscé, llove, me dole). Haber made regular is no word.
  if (!(kind === 'impersonal' && base === 'haber')) {
    const regPerson: Person = kind === 'dative' ? (number === 'pl' ? 'ellos' : 'el') : kind === 'impersonal' ? 'el' : cell.person;
    const prefix = kind === 'dative' ? `${DATIVE_CLITICS[cell.person]} ` : '';
    const hit = regularizedVariants(base, kind === 'pronominal', cell.tense, regPerson, region)
      .map((v) => ({ ...v, form: normalizeAnswer(prefix + v.form) }))
      .filter((v) => !accepted.includes(v.form))
      .find((v) => foldAccents(v.form) === foldAccents(core));
    if (hit) return mistake('regularized', { change: changeOf(hit.how, cell) });
  }

  if (own.length > 0) return fromOwn(own);

  // The same verb used another way (llama for me llamo, gustaba for me gustaba, me llamo for llamo).
  const sameBase = exact.filter((r) => r.infinitive !== cell.entry && baseOf(r.infinitive) === base);
  if (sameBase.length > 0) {
    const r = likeliestPerson(sameBase, cell.person);
    const readingKind = parseEntry(r.infinitive)?.kind;
    if (kind === 'dative') return readingKind === 'pronominal' ? mistake('dativeSelf') : mistake('dativeSubject', { person: r.person });
    if (kind === 'pronominal' && readingKind === 'plain') {
      return r.person === cell.person ? mistake('pronounMissing', { pronoun: REFLEXIVE[cell.person] }) : mistake('person', { person: r.person });
    }
    if (kind === 'plain' && readingKind === 'pronominal') return mistake('pronounExtra', { pronoun: core.split(' ')[0] });
  }

  const otherVerb = (readings: readonly Analysis[]): Mistake | null => {
    const others = readings.filter((r) => baseOf(r.infinitive) !== base);
    if (others.length === 0) return null;
    const score = (r: Analysis) => (opts.entries?.includes(r.infinitive) ? 0 : 4)
      + (r.tense === cell.tense ? 0 : 2) + (r.person === cell.person ? 0 : 1);
    const r = [...others].sort((a, b) => score(a) - score(b))[0];
    return mistake('otherVerb', { entry: r.infinitive, tense: r.tense, person: r.person });
  };
  const other = otherVerb(exact);
  if (other) return other;

  // Typed without its accents: read it as the letters allow ("tenia" is the imperfect).
  if (exact.length === 0) {
    const folded = analyzeIgnoringAccents(core);
    const foldedOwn = folded.filter((r) => r.infinitive === cell.entry);
    if (foldedOwn.length > 0) return fromOwn(foldedOwn);
    const foldedOther = otherVerb(folded);
    if (foldedOther) return foldedOther;
  }
  return unknown();
}

/**
 * The mistake of a "name the verb" pick: the reading the student chose
 * against the one the form has (another person of the verb, another tense,
 * another verb).
 */
export function classifyReading(cell: MistakeCell, chosen: MistakeCell): Mistake {
  if (chosen.entry !== cell.entry) {
    return mistake('otherVerb', { entry: chosen.entry, tense: chosen.tense, person: chosen.person });
  }
  if (chosen.tense !== cell.tense) {
    return mistake('tense', { tense: chosen.tense, ...(chosen.person !== cell.person ? { person: chosen.person } : {}) });
  }
  if (chosen.person !== cell.person) return mistake('person', { person: chosen.person });
  if ((chosen.number ?? 'sg') !== (cell.number ?? 'sg')) return mistake('dativeNumber', { number: chosen.number ?? 'sg' });
  return unknown();
}

/** A short stable key of a mistake, for counting like with like: "person:el", "regularized:yo", "accent". */
export function mistakeKey(m: Mistake): string {
  const d = m.detail;
  const sub = {
    person: d.person,
    tense: d.tense,
    regularized: d.change,
    otherVerb: d.entry,
    dativeNumber: d.number,
    dativeSubject: undefined,
    dativeSelf: undefined,
    impersonal: d.person,
    pronounMissing: d.pronoun,
    pronounExtra: d.pronoun,
    pronounWrong: d.pronoun,
    infinitive: undefined,
    accent: undefined,
    unknown: undefined,
  }[m.kind];
  return sub ? `${m.kind}:${sub}` : m.kind;
}

// ---------------------------------------------------------------------------
// The guide section that explains a mistake

const BUILD: Partial<Record<Tense, string>> = {
  present: 'present-build',
  presentProgressive: 'progressive-build',
  preterite: 'preterite-build',
  imperfect: 'imperfect-build',
  future: 'future-build',
  conditional: 'conditional-build',
  presentPerfect: 'perfect-present',
  pluperfect: 'perfect-pluperfect',
  presentSubjunctive: 'subjunctive-present',
  imperfectSubjunctive: 'subjunctive-imperfect',
  imperativeAffirmative: 'commands-tu',
  imperativeNegative: 'commands-negative',
};
const STEM: Partial<Record<Tense, string>> = {
  present: 'present-stem',
  presentProgressive: 'progressive-stem',
  preterite: 'preterite-stem',
  presentSubjunctive: 'subjunctive-stem',
  imperativeAffirmative: 'commands-stem',
  imperativeNegative: 'commands-stem',
};
const PRESENT_STEM: Partial<Record<PatternTag, string>> = {
  'stem:e>ie': 'present-stem-e-ie',
  'stem:o>ue': 'present-stem-o-ue',
  'stem:u>ue': 'present-stem-u-ue',
  'stem:e>i': 'present-stem-e-i',
};
const SPELLING: Partial<Record<Tense, string>> = {
  present: 'present-spelling',
  presentProgressive: 'progressive-spelling',
  preterite: 'preterite-spelling',
  presentSubjunctive: 'subjunctive-spelling',
  imperativeAffirmative: 'commands-spelling',
  imperativeNegative: 'commands-spelling',
};
const IRREGULAR: Partial<Record<Tense, string>> = {
  preterite: 'preterite-irregular',
  imperfect: 'imperfect-irregular',
  future: 'future-irregular',
  conditional: 'conditional-irregular',
  imperativeAffirmative: 'commands-irregular-tu',
  presentPerfect: 'perfect-participle',
  pluperfect: 'perfect-participle',
};
const YO: Partial<Record<Tense, string>> = { present: 'present-yo', presentSubjunctive: 'subjunctive-yo' };
const ACCENTS: Partial<Record<Tense, string>> = {
  present: 'present-accents',
  preterite: 'preterite-accents',
  imperfect: 'imperfect-accents',
  imperativeAffirmative: 'commands-accents',
  imperativeNegative: 'commands-accents',
};
/** The verbs "Verbs to memorize" (present-irregular) covers. */
const MEMORIZE = new Set(['ser', 'estar', 'ir', 'irse']);

/** The section of the command chapter for a person. */
function commandSection(tense: Tense, person: Person): string {
  if (tense === 'imperativeNegative') return person === 'vos' ? 'commands-vos-negative' : person === 'vosotros' ? 'commands-vosotros-negative' : 'commands-negative';
  if (person === 'vos') return 'commands-vos';
  if (person === 'vosotros') return 'commands-vosotros';
  return person === 'tu' ? 'commands-tu' : 'commands-formal';
}

/**
 * The guide sections that explain a mistake on a cell, most specific first
 * (ids of the "Intro to conjugation" guide). The guide shows a section only
 * when the deck makes it relevant, so the page opens the first one it shows;
 * none (an empty list) means no link. The ids are checked against the guide's
 * chapters by mistakes.test.ts.
 */
export function mistakeGuideSections(m: Mistake, cell: MistakeCell): string[] {
  const kind = parseEntry(cell.entry)?.kind ?? 'plain';
  const { tense, person } = cell;
  const build = isImperative(tense) ? commandSection(tense, person) : BUILD[tense];
  const tags = patternTags(cell.entry, tense);
  const out: (string | undefined)[] = [];
  switch (m.kind) {
    case 'person':
      if (kind === 'dative') out.push('dative-a-mi', 'dative-how');
      else {
        if (m.detail.person === 'vos') out.push(tense === 'present' ? 'present-vos' : undefined, 'persons-vos');
        if (kind === 'pronominal' && tense === 'present') out.push('pronominal-present');
        if (tense === 'present' && MEMORIZE.has(cell.entry)) out.push('present-irregular');
        if (person === 'yo' && tags.includes('yo')) out.push(YO[tense]);
        out.push(build, 'persons-glance');
      }
      break;
    case 'tense':
      out.push(build);
      if ((tense === 'preterite' && m.detail.tense === 'imperfect') || (tense === 'imperfect' && m.detail.tense === 'preterite')) {
        out.push('preterite-vs-imperfect');
      }
      out.push('basics-what');
      break;
    case 'regularized':
      switch (m.detail.change) {
        case 'yo':
          out.push(YO[tense]);
          break;
        case 'stem':
        case 'stemEverywhere':
          if (tense === 'present') out.push(...tags.map((t) => PRESENT_STEM[t]));
          out.push(STEM[tense]);
          break;
        case 'spelling':
          out.push(SPELLING[tense]);
          break;
        default:
          out.push(tense === 'present' ? (MEMORIZE.has(cell.entry) ? 'present-irregular' : undefined) : IRREGULAR[tense]);
      }
      out.push(build);
      break;
    case 'dativeSubject':
      out.push('dative-how', 'basics-le-verbs');
      break;
    case 'dativeNumber':
      out.push('dative-agree', 'dative-how');
      break;
    case 'dativeSelf':
      out.push('dative-gustarse', 'dative-how');
      break;
    case 'pronounMissing':
      if (kind === 'dative') out.push('dative-how', 'basics-le-verbs');
      else out.push(tense === 'present' ? 'pronominal-present' : undefined, 'pronominal-what', 'basics-se-verbs');
      break;
    case 'pronounWrong':
      out.push(tense === 'present' ? 'pronominal-present' : undefined, 'pronominal-what', 'basics-se-verbs');
      break;
    case 'pronounExtra':
      out.push('pronominal-what', 'basics-se-verbs', build);
      break;
    case 'impersonal':
      out.push(cell.entry === 'haber-impersonal' ? 'impersonal-hay' : 'impersonal-weather', 'basics-impersonal');
      break;
    case 'infinitive':
      out.push('basics-dictionary-form', 'basics-stem-ending', 'basics-what');
      break;
    case 'otherVerb': {
      const pair = new Set([cell.entry, m.detail.entry]);
      if (pair.has('ser') && pair.has('estar')) out.push('present-ser-estar');
      if (pair.has('haber-impersonal') && pair.has('estar')) out.push('impersonal-hay-estar');
      break;
    }
    case 'accent':
      // A gustar-type verb's slip is in "a mí" or in the verb.
      if (kind === 'dative') out.push('dative-a-mi');
      out.push(ACCENTS[tense], 'quiz-accents');
      break;
    case 'unknown':
      break;
  }
  return [...new Set(out.filter((id): id is string => !!id))];
}

/** Every section id mistakeGuideSections can name, for the tests. */
export function allMistakeGuideSections(): string[] {
  const fixed = [
    'persons-glance', 'present-irregular', 'pronominal-present', 'pronominal-what', 'basics-se-verbs', 'basics-le-verbs',
    'basics-what', 'basics-dictionary-form', 'basics-stem-ending', 'basics-impersonal', 'preterite-vs-imperfect',
    'preterite-stem', 'dative-a-mi', 'dative-how', 'dative-agree', 'dative-gustarse', 'impersonal-hay', 'impersonal-weather',
    'present-ser-estar', 'impersonal-hay-estar', 'quiz-accents', 'present-vos', 'persons-vos', 'commands-tu', 'commands-formal', 'commands-negative',
    'commands-vos', 'commands-vos-negative', 'commands-vosotros', 'commands-vosotros-negative',
  ];
  const maps = [BUILD, STEM, PRESENT_STEM, SPELLING, IRREGULAR, YO, ACCENTS];
  return [...new Set([...fixed, ...maps.flatMap((m) => Object.values(m) as string[])])];
}
