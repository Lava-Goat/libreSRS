// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Wrong answers for multiple-choice conjugation prompts.
 *
 * Every set starts with the learners' most common wrong form, whenever it is
 * wrong for the cell: the él/ella form for any other person ("tiene" for yo),
 * and for a plural person also its singular ("hablo" for nosotros; for ellos
 * that is the él form). Then candidates, most plausible first:
 *  1. the verb treated as regular (tener → "teno", "tení"), without its
 *     spelling change ("buscé"), with the stem change in every person
 *     ("piensamos") or without the -ir preterite change ("sentió");
 *  2. with strict accents, the answer with its accents dropped ("hablo" for "habló");
 *  3. the same verb in the other persons of the tense;
 *  4. the same person in related tenses — with `tenses`, only those the deck
 *     drills (a present-only deck is never offered "quisiésemos" or "fuera").
 * Dative cells (me gusta) start with the él/ella experiencer (le gusta), then
 * offer, most plausible first: the wrong number (me gustan), the bare
 * conjugation by subject (gusto, yo gusto), another wrong clitic (te gusta),
 * the pronominal confusion (me gusto), a regularized stem (me dole), then
 * other tenses; a "le" cell starts from the wrong clitic (les gusta, te
 * gusta). Impersonal cells (hay, llueve) offer the
 * personal forms (ha, han, hubieron; llueven) and the regularized stem
 * (llove), then other tenses (había, hubo).
 * When `tenses` leaves too few candidates (an impersonal cell has few other
 * forms), the undrilled related tenses fill the last places, nearest first.
 * vos cells offer the tú form first (tienes for tenés, di for decí; hablas for
 * hablás with strict accents), then the él form, then the stem-changed voseo (tienés, quierés)
 * among the regularized forms. A tú form the region accepts (que hables) is
 * dropped like any accepted form.
 * A candidate is dropped when gradeTyped would accept it for this cell, so no
 * distractor can be a right answer (with accents forgiven, "hablo" is never
 * offered against "habló"), and neither is a word with two written accents
 * (the stressed-stem voseo of an acc verb, "envíás"), which is no Spanish.
 */
import { foldAccents, stripAcute } from './accent.js';
import { conjugate, conjugatePlain, conjugateSpec, entryFor, parseEntry, type Spec } from './conjugate.js';
import { gradeTyped, normalizeAnswer } from './grade.js';
import { IRREGULAR } from './lexicon.js';
import { hashString, mulberry32, shuffle } from './random.js';
import { DATIVE_CLITICS, PERSON_IDS, PERSONS, TENSES, type GNumber, type Person, type Tense, type VosRegion } from './types.js';

export interface DistractorOptions {
  /** Seed for the shuffle; the default is derived from the cell, so output is stable. */
  seed?: number;
  /** Whether typed/MC grading requires accents: only then are accent-drop variants wrong. */
  strictAccents?: boolean;
  /** Dative entries: the number of the thing liked (default sg). */
  number?: GNumber;
  /**
   * Whether the class uses vosotros (as in cellsFor). Without it, no vosotros
   * form (os gusta, habláis) is offered for another person's cell, since a
   * class that never sees them can rule them out on sight. Default: only
   * when the cell itself is vosotros.
   */
  vosotros?: boolean;
  /**
   * The deck's vos region (as cellsFor's opts.vos). For a vos cell it decides
   * which forms are accepted (default rioplatense); for another person's cell
   * it lets vos forms (hablás, tenés) be offered, which a class without vos
   * never sees. Default: vos forms only in a vos cell.
   */
  vosRegion?: VosRegion | null;
  /**
   * The tenses the deck drills. The "other tenses" tier then offers only
   * these (with one tense, none, so the regularized, other-person and
   * other-number forms fill the options); forms of undrilled tenses come
   * only after every other candidate, when the cell has too few. Default:
   * every related tense.
   */
  tenses?: readonly Tense[];
}

/** The singular person of a plural one: what "singular for plural" puts in its place. */
const SINGULAR_OF: Partial<Record<Person, Person>> = { nosotros: 'yo', vosotros: 'tu', ellos: 'el' };

const SIMPLE: Tense[] = ['present', 'preterite', 'imperfect', 'future', 'conditional', 'presentSubjunctive', 'imperfectSubjunctive'];
const COMPOUND: Tense[] = ['presentPerfect', 'pluperfect', 'presentProgressive'];

function relatedTenses(tense: Tense): Tense[] {
  if (tense === 'imperativeAffirmative') return ['present', 'presentSubjunctive'];
  if (tense === 'imperativeNegative') return ['present', 'imperativeAffirmative'];
  if (COMPOUND.includes(tense)) return COMPOUND.filter((t) => t !== tense);
  return SIMPLE.filter((t) => t !== tense);
}

function safe(fn: () => string[] | null): string[] {
  try {
    return fn() ?? [];
  } catch {
    return [];
  }
}

/** A verb word a learner could write: two letters or more, at least one of them a consonant. */
function wordLike(form: string): boolean {
  const word = form.split(' ').pop() ?? '';
  return word.length >= 2 && /[^aeiouáéíóúü]/.test(word);
}

/**
 * Whether some word of the form carries two written accents ("envíás",
 * "prohíbís", "continúéis"): the stressed-stem variant of an acc verb on an
 * ending that has its own accent. A word has at most one tilde (RAE
 * Ortografía 2010; only -mente adverbs, never verb forms, keep two), so such
 * a string is ruled out on sight and is never offered.
 */
function doubleAccent(form: string): boolean {
  return form.split(' ').some((w) => (w.match(/[áéíóú]/g) ?? []).length > 1);
}

/**
 * How a regularized variant departs from the verb:
 *  - regular: every irregularity dropped (teno, quero, esto);
 *  - noSpelling: also without the spelling rules (buscé for busqué);
 *  - stemOnly: the stem change kept, the rest regular (tieno: the boot, not the -go yo);
 *  - stemEverywhere: the stem change in every person (piensamos);
 *  - noPreteriteChange: without the -ir preterite / gerund e>i, o>u (sentió).
 */
export type RegularizedHow = 'regular' | 'noSpelling' | 'stemOnly' | 'stemEverywhere' | 'noPreteriteChange';

/**
 * Regularized and over/under-applied variants of the verb for this cell, each
 * with how it departs from the verb (the mistake classifier names it). Word-like
 * forms only, possibly equal to an accepted form (the caller filters). None for
 * verbs whose root is a single letter or empty (ir, ser, ver, dar, oír, reír):
 * regular endings on it give fragments ("o", "ía", "so"), not plausible mistakes.
 */
export function regularizedVariants(
  base: string,
  reflexive: boolean,
  tense: Tense,
  person: Person,
  region?: VosRegion,
): { form: string; how: RegularizedHow }[] {
  if (stripAcute(base).length - 2 < 2) return [];
  const entry = entryFor(base);
  const patch = IRREGULAR[base];
  const specs: [Spec, RegularizedHow][] = [[{ inf: base }, 'regular'], [{ inf: base, noSpelling: true }, 'noSpelling']];
  const stem = entry?.stem ?? patch?.stem;
  if (stem) {
    specs.push([{ inf: base, stem }, 'stemOnly']);
    const full: Spec = { inf: base, stem, zc: entry?.zc, uj: entry?.uj, participle: entry?.participle, patch };
    specs.push([{ ...full, bootAll: true }, 'stemEverywhere'], [{ ...full, noPretChange: true }, 'noPreteriteChange']);
  }
  return specs.flatMap(([spec, how]) => safe(() => conjugateSpec(spec, reflexive, tense, person, region))
    .filter(wordLike)
    .map((form) => ({ form, how })));
}

function regularizedForms(base: string, reflexive: boolean, tense: Tense, person: Person, region?: VosRegion): string[] {
  return regularizedVariants(base, reflexive, tense, person, region).map((v) => v.form);
}

/**
 * Plausible wrong forms for a multiple-choice prompt, never equal to an
 * accepted form of the cell. Deterministic for a given seed (default: derived
 * from the cell). A number as the fifth argument is taken as the seed.
 */
export function distractors(
  infinitive: string,
  tense: Tense,
  person: Person,
  count: number,
  options: DistractorOptions | number = {},
): string[] {
  const opts: DistractorOptions = typeof options === 'number' ? { seed: options } : options;
  const strict = !!opts.strictAccents;
  const number: GNumber = opts.number ?? 'sg';
  const region: VosRegion = opts.vosRegion ?? 'rioplatense';
  const inRegion = { vosRegion: region };
  const parsed = parseEntry(infinitive);
  const accepted = conjugate(infinitive, tense, person, number, inRegion);
  if (!accepted || !parsed || count <= 0) return [];
  const { base, kind } = parsed;
  const vosotros = opts.vosotros ?? person === 'vosotros';
  const vos = !!opts.vosRegion || person === 'vos';
  const others = (list: readonly Person[]): Person[] =>
    list.filter((p) => p !== person && (vosotros || p !== 'vosotros') && (vos || p !== 'vos'));

  const accentDrops = strict ? accepted.map(foldAccents) : [];
  // The related tenses the deck drills, and (a last resort) the ones it does not, in teaching order.
  const related = relatedTenses(tense);
  const drilled = opts.tenses ? related.filter((t) => opts.tenses?.includes(t)) : related;
  const undrilled = related.filter((t) => !drilled.includes(t));
  let tiers: string[][];
  let lastResort: string[] = [];
  // Offered before every tier, in order, whenever they are wrong for the cell.
  let first: string[] = [];
  if (kind === 'dative') {
    const other: GNumber = number === 'sg' ? 'pl' : 'sg';
    const third: Person = number === 'sg' ? 'el' : 'ellos';
    // The él/ella clitic (le gusta) is the wrong experiencer offered every time. The singular-for-
    // plural slip of plain verbs has its dative counterpart in the number tier (me gustan).
    const elClitic = person === 'el' ? [] : safe(() => conjugate(infinitive, tense, 'el', number));
    first = elClitic.slice(0, 1);
    const wrongClitic = others(PERSON_IDS).flatMap((p) => safe(() => conjugate(infinitive, tense, p, number)));
    const wrongNumber = safe(() => conjugate(infinitive, tense, person, other));
    const subject = PERSONS.find((p) => p.id === person)?.es.split(' / ')[0] ?? '';
    const bare = safe(() => conjugatePlain(base, tense, person, false, region));
    const bareForms = [...bare, ...bare.map((f) => `${subject} ${f}`)];
    const pronominal = safe(() => conjugatePlain(base, tense, person, true, region));
    const regular = regularizedForms(base, false, tense, third).map((f) => `${DATIVE_CLITICS[person]} ${f}`);
    const inTense = (t: Tense) => safe(() => conjugate(infinitive, t, person, number));
    // Without the él clitic, a wrong experiencer still leads (te gusta for le gusta).
    tiers = person === 'el'
      ? [wrongClitic, wrongNumber, bareForms, pronominal, regular, accentDrops, drilled.flatMap(inTense)]
      : [wrongNumber, bareForms, wrongClitic, pronominal, regular, accentDrops, drilled.flatMap(inTense)];
    lastResort = undrilled.flatMap(inTense);
  } else if (kind === 'impersonal') {
    const personal = (['el', 'ellos'] as Person[]).flatMap((p) => safe(() => conjugatePlain(base, tense, p)));
    // Regularized haber (habe, habió) is no word; a regularized weather verb (llove) is the classic slip.
    const regular = base === 'haber' ? [] : regularizedForms(base, false, tense, 'el');
    const inTense = (t: Tense) => safe(() => conjugate(infinitive, t, person));
    // An impersonal entry has one cell per tense, so a compound tense has few compound
    // neighbours (ha habido: only había habido); the simple tenses (hubo, hay) fill in after them.
    const simple = COMPOUND.includes(tense) ? SIMPLE : [];
    const drilledSimple = opts.tenses ? simple.filter((t) => opts.tenses?.includes(t)) : simple;
    tiers = [personal, regular, accentDrops, drilled.flatMap(inTense), drilledSimple.flatMap(inTense)];
    lastResort = [...undrilled, ...simple.filter((t) => !drilledSimple.includes(t))].flatMap(inTense);
  } else {
    const reflexive = kind === 'pronominal';
    const regular = regularizedForms(base, reflexive, tense, person, region);
    const tenseDef = TENSES.find((t) => t.id === tense);
    const otherPersons = others(tenseDef?.persons ?? []).flatMap((p) => safe(() => conjugate(infinitive, tense, p, 'sg', inRegion)));
    const inTense = (t: Tense) => {
      const forms = safe(() => conjugate(infinitive, t, person, 'sg', inRegion));
      return tense === 'imperativeNegative' ? forms.map((f) => (f.startsWith('no ') ? f : `no ${f}`)) : forms;
    };
    // The classic voseo slip is the tú form (tienes for tenés); valid() drops it where the region accepts it.
    const tuForms = person === 'vos' ? safe(() => conjugate(infinitive, tense, 'tu')) : [];
    // The dominant real errors come first, every time: the él/ella form for any other person
    // ("yo tiene"), and for a plural person its singular ("nosotros hablo"). Learners' own
    // errors: Bruhn de Garavito 2003, Cuervo et al. 2021.
    const counterparts: Person[] = [];
    if (person !== 'el') counterparts.push('el');
    const singular = SINGULAR_OF[person];
    if (singular && !counterparts.includes(singular)) counterparts.push(singular);
    const persons = tenseDef?.persons ?? [];
    first = [
      ...tuForms.slice(0, 1),
      ...counterparts.filter((p) => persons.includes(p)).flatMap((p) => safe(() => conjugate(infinitive, tense, p, 'sg', inRegion)).slice(0, 1)),
    ];
    tiers = [tuForms.slice(1), regular, accentDrops, otherPersons, drilled.flatMap(inTense)];
    lastResort = undrilled.flatMap(inTense);
  }

  // With accents forgiven, two candidates that differ only in accents are the same answer,
  // and one that differs from an accepted form only in accents is not offered at all.
  const seen = new Set<string>(strict ? [] : accepted.map((a) => foldAccents(normalizeAnswer(a))));
  const valid = (c: string): boolean => {
    const norm = normalizeAnswer(c);
    const key = strict ? norm : foldAccents(norm);
    if (!norm || seen.has(key) || doubleAccent(norm)) return false;
    if (gradeTyped(accepted, c, strict, person, kind) === 'correct') return false;
    // Without a person given, grading would also accept a plain form that happens to be spelled the same.
    if (gradeTyped(accepted, c, strict) === 'correct') return false;
    seen.add(key);
    return true;
  };

  const rand = mulberry32(opts.seed ?? hashString(`${parsed.id}|${tense}|${person}${kind === 'dative' ? `|${number}` : ''}`));
  tiers = tiers.map((tier) => shuffle(tier, rand));
  const out: string[] = [];
  for (const c of first) {
    if (out.length >= count) break;
    if (valid(c)) out.push(c);
  }
  let progressed = true;
  while (out.length < count && progressed) {
    progressed = false;
    for (const tier of tiers) {
      while (tier.length) {
        const c = tier.shift() as string;
        if (valid(c)) {
          out.push(c);
          progressed = true;
          break;
        }
      }
      if (out.length >= count) break;
    }
  }
  // Only when every other candidate is used up: the undrilled tenses, nearest (preterite, imperfect) first.
  for (const c of lastResort) {
    if (out.length >= count) break;
    if (valid(c)) out.push(c);
  }
  return out;
}
