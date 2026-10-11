// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Tense and person vocabulary for the Spanish conjugation engine.
 *
 * Person ids follow the six grammatical slots of a Spanish paradigm, plus
 * `vos`. `el` covers él / ella / usted and `ellos` covers ellos / ellas /
 * ustedes, so in the imperatives `el` is the usted command and `ellos` the
 * ustedes command.
 *
 * `vos` is the second person singular of the voseo (NGLE §4.7, DPD "voseo"):
 * it shares the tú slot of the paradigm (te, tu, hablaste, hablabas, has
 * hablado) except in the present indicative (hablás, sos), the affirmative
 * command (hablá, andá) and the present subjunctive / negative command, where
 * the two regions a deck can pick (VosRegion) differ in which form is
 * canonical (que hables | que hablés).
 */

export type Tense =
  | 'present'
  | 'preterite'
  | 'imperfect'
  | 'future'
  | 'conditional'
  | 'presentSubjunctive'
  | 'imperfectSubjunctive'
  | 'imperativeAffirmative'
  | 'imperativeNegative'
  | 'presentPerfect'
  | 'pluperfect'
  | 'presentProgressive';

export type Person = 'yo' | 'tu' | 'vos' | 'el' | 'nosotros' | 'vosotros' | 'ellos';

/** Every person in paradigm order, vos right after tú. */
export const PERSON_IDS: readonly Person[] = ['yo', 'tu', 'vos', 'el', 'nosotros', 'vosotros', 'ellos'];

/** The six slots of a paradigm (the conjugation tables); vos shares the tú slot. */
export const SLOT_PERSONS: readonly Person[] = ['yo', 'tu', 'el', 'nosotros', 'vosotros', 'ellos'];

/** The persons an imperative has (no yo). */
const IMPERATIVE_PERSONS: Person[] = ['tu', 'vos', 'el', 'nosotros', 'vosotros', 'ellos'];

export const PERSONS: { id: Person; es: string }[] = [
  { id: 'yo', es: 'yo' },
  { id: 'tu', es: 'tú' },
  { id: 'vos', es: 'vos' },
  { id: 'el', es: 'él / ella / usted' },
  { id: 'nosotros', es: 'nosotros / nosotras' },
  { id: 'vosotros', es: 'vosotros / vosotras' },
  { id: 'ellos', es: 'ellos / ellas / ustedes' },
];

/** Tenses in the order a US high-school sequence usually teaches them. */
export const TENSES: { id: Tense; es: string; en: string; persons: Person[] }[] = [
  { id: 'present', es: 'presente', en: 'present', persons: [...PERSON_IDS] },
  { id: 'presentProgressive', es: 'presente progresivo', en: 'present progressive', persons: [...PERSON_IDS] },
  { id: 'preterite', es: 'pretérito', en: 'preterite', persons: [...PERSON_IDS] },
  { id: 'imperfect', es: 'imperfecto', en: 'imperfect', persons: [...PERSON_IDS] },
  { id: 'imperativeAffirmative', es: 'imperativo afirmativo', en: 'affirmative command', persons: [...IMPERATIVE_PERSONS] },
  { id: 'imperativeNegative', es: 'imperativo negativo', en: 'negative command', persons: [...IMPERATIVE_PERSONS] },
  { id: 'future', es: 'futuro', en: 'future', persons: [...PERSON_IDS] },
  { id: 'conditional', es: 'condicional', en: 'conditional', persons: [...PERSON_IDS] },
  { id: 'presentPerfect', es: 'pretérito perfecto', en: 'present perfect', persons: [...PERSON_IDS] },
  { id: 'pluperfect', es: 'pluscuamperfecto', en: 'pluperfect', persons: [...PERSON_IDS] },
  { id: 'presentSubjunctive', es: 'presente de subjuntivo', en: 'present subjunctive', persons: [...PERSON_IDS] },
  { id: 'imperfectSubjunctive', es: 'imperfecto de subjuntivo', en: 'imperfect subjunctive', persons: [...PERSON_IDS] },
];

/**
 * The voseo a deck drills. Río de la Plata (Argentina, Uruguay): in the present
 * subjunctive and the negative command the tuteo form is the standard one
 * (que hables, no hables) and the voseante one (hablés) a widespread
 * colloquial alternative. Central America: the voseante form is general (que
 * hablés, no hablés), the tuteo one also accepted. Every other cell is the same
 * in both (NGLE §4.7; DPD "voseo").
 */
export type VosRegion = 'rioplatense' | 'centroamericano';

export const VOS_REGIONS: { id: VosRegion; es: string }[] = [
  { id: 'rioplatense', es: 'Río de la Plata' },
  { id: 'centroamericano', es: 'Centroamérica' },
];

export function isVosRegion(value: unknown): value is VosRegion {
  return value === 'rioplatense' || value === 'centroamericano';
}

export const TENSE_IDS: readonly Tense[] = TENSES.map((t) => t.id);

export function isTense(value: unknown): value is Tense {
  return typeof value === 'string' && (TENSE_IDS as readonly string[]).includes(value);
}

export function isPerson(value: unknown): value is Person {
  return typeof value === 'string' && (PERSON_IDS as readonly string[]).includes(value);
}

export function isImperative(tense: Tense): boolean {
  return tense === 'imperativeAffirmative' || tense === 'imperativeNegative';
}

/** Whether a person slot exists in a tense (imperatives have no yo). */
export function personApplies(tense: Tense, person: Person): boolean {
  return !(isImperative(tense) && person === 'yo');
}

/**
 * The label a student sees for a person in a tense. Commands name the formal
 * addressee directly: `usted` for el and `ustedes` for ellos.
 */
export function personLabel(tense: Tense, person: Person): string {
  if (isImperative(tense)) {
    if (person === 'el') return 'usted';
    if (person === 'ellos') return 'ustedes';
  }
  return PERSONS.find((p) => p.id === person)?.es ?? person;
}

/**
 * The real subjects a person stands for (v1.24.0, the short person cue): a
 * "give the form" prompt names one of them at a time, taking turns ("ustedes
 * (tener)", then "ellas (tener)"), never the whole group. They all share every
 * form, so the item, its progress and its grading stay one per person.
 */
export const PERSON_SUBJECTS: Record<Person, readonly string[]> = {
  yo: ['yo'],
  tu: ['tú'],
  vos: ['vos'],
  el: ['él', 'ella', 'usted'],
  nosotros: ['nosotros', 'nosotras'],
  vosotros: ['vosotros', 'vosotras'],
  ellos: ['ellos', 'ellas', 'ustedes'],
};

/**
 * A person as the teacher's views name the whole group, short (v1.24.0):
 * "ellos/ellas/Uds." where the student's prompt names one subject.
 */
export const SHORT_PERSON_LABELS: Record<Person, string> = {
  yo: 'yo',
  tu: 'tú',
  vos: 'vos',
  el: 'él/ella/Ud.',
  nosotros: 'nosotros/as',
  vosotros: 'vosotros/as',
  ellos: 'ellos/ellas/Uds.',
};

/** What a subject means, for the grey line under it at multiple choice: usted, ustedes and vosotros are the ones read wrong. */
export type SubjectGloss = 'youFormal' | 'youAll' | 'youAllSpain';

/**
 * The gloss of a subject ("ustedes", "a usted", "vosotras"), or null for one
 * that needs none (yo, ellas) and for a whole group label.
 */
export function subjectGloss(subject: string | null | undefined): SubjectGloss | null {
  const bare = (subject ?? '').trim().replace(/^a /, '');
  if (bare === 'usted') return 'youFormal';
  if (bare === 'ustedes') return 'youAll';
  if (bare === 'vosotros' || bare === 'vosotras') return 'youAllSpain';
  return null;
}

/**
 * The person of one real subject ("ustedes" → ellos, "a ella" → el, "a mí" →
 * yo), or undefined for anything else (a group label, a noun).
 */
export function subjectPerson(subject: string | null | undefined): Person | undefined {
  const text = (subject ?? '').trim();
  for (const person of PERSON_IDS) {
    if (PERSON_SUBJECTS[person].includes(text) || experiencerSubjects(person).includes(text)) return person;
  }
  return undefined;
}

/** The experiencer phrases of a person, one subject each ("a él", "a ella", "a usted"; "a mí"). */
export function experiencerSubjects(person: Person): string[] {
  if (person === 'yo') return ['a mí'];
  if (person === 'tu') return ['a ti'];
  return PERSON_SUBJECTS[person].map((s) => `a ${s}`);
}

export function personIndex(person: Person): number {
  return PERSON_IDS.indexOf(person);
}

/** The paradigm slot (0–5) of a person: vos takes the tú slot (1). */
export function slotIndex(person: Person): number {
  return person === 'vos' ? 1 : SLOT_PERSONS.indexOf(person);
}

/**
 * How a verb entry is used, and so how it is conjugated:
 *  - plain: by subject (gusto, gustas, gusta);
 *  - pronominal: with the reflexive / reciprocal pronoun (me gusto, nos gustamos) — id ends in -se;
 *  - dative: the gustar construction, by experiencer and the number of the thing
 *    (me gusta, les gustan) — id ends in -le;
 *  - impersonal: third person singular only (hay, llueve) — haber-impersonal and the weather verbs.
 */
export type VerbKind = 'plain' | 'pronominal' | 'dative' | 'impersonal';

/** Grammatical number: in a dative cell, the number of the thing liked, which the verb agrees with. */
export type GNumber = 'sg' | 'pl';

export const NUMBER_IDS: readonly GNumber[] = ['sg', 'pl'];

/** The experiencer phrase of a dative cell ("a mí me gusta"). */
export const EXPERIENCER_LABELS: Record<Person, string> = {
  yo: 'a mí',
  tu: 'a ti',
  vos: 'a vos',
  el: 'a él / a ella / a usted',
  nosotros: 'a nosotros / a nosotras',
  vosotros: 'a vosotros / a vosotras',
  ellos: 'a ellos / a ellas / a ustedes',
};

/** The indirect-object clitic of each person (me gusta, les gusta). */
export const DATIVE_CLITICS: Record<Person, string> = {
  yo: 'me',
  tu: 'te',
  vos: 'te',
  el: 'le',
  nosotros: 'nos',
  vosotros: 'os',
  ellos: 'les',
};

export function isNumber(value: unknown): value is GNumber {
  return value === 'sg' || value === 'pl';
}
