// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How a verb behaves in one tense, for the student-facing grammar guide:
 * regular, a stem change (quiero, duermo, pidió), a spelling change that keeps
 * the sound (busqué, empiece, leyó), a written accent on the stem's i / u
 * (envío, continúo), a y added by -uir verbs (construyo), an irregular yo
 * (tengo, hago, veo), an irregular participle (hecho) or irregular outright
 * (soy, fui, pude, tendré).
 *
 * The engine's forms for yo, tú, él, nosotros and ellos are compared with the
 * forms a fully regular verb of the same family would have (never vos or
 * vosotros, whose quirks — dais, veis — would mislead). Each person that
 * differs is explained, when it can be, by the cheapest mix of: a spelling
 * change, a stem change of the stem's last e/o/u/i, an accent, a y. Whatever
 * is left unexplained makes the tense 'yo' (the yo form only, tengo; in the
 * present subjunctive, built on an irregular yo, tenga), 'participle'
 * (compound tenses) or 'irregular' (in the present subjunctive, only the six
 * that do not start from yo: dé, vaya, sea, haya, esté, sepa).
 *
 * No lookup tables: it conjugates at most five cells and tries a few dozen
 * candidate spellings per differing cell, so it runs in the browser as is.
 */
import { isVowelChar, stripAcute } from './accent.js';
import { conjugate, conjugatePlain, parseEntry, type ParsedEntry } from './conjugate.js';
import { ALIASES } from './lexicon.js';
import type { Person, Tense } from './types.js';

export type PatternTag =
  | 'regular'
  | 'spelling'
  | 'yo'
  | 'irregular'
  | 'participle'
  /** A stressed stem i / u written with an accent (envío, continúo, reúno, prohíbo). */
  | 'accent'
  /** An -uir verb's added y (construyo, construya). */
  | 'y'
  | 'stem:e>ie'
  | 'stem:o>ue'
  | 'stem:u>ue'
  | 'stem:e>i'
  | 'stem:o>u'
  | 'stem:i>ie';

type StemTag = Extract<PatternTag, `stem:${string}`>;
type Mark = Extract<PatternTag, 'accent' | 'y'>;

/** The stem changes, in output order: the last `from` of the stem becomes `to`. */
const STEM_CHANGES: { tag: StemTag; from: string; to: string }[] = [
  { tag: 'stem:e>ie', from: 'e', to: 'ie' },
  { tag: 'stem:o>ue', from: 'o', to: 'ue' },
  { tag: 'stem:u>ue', from: 'u', to: 'ue' },
  { tag: 'stem:e>i', from: 'e', to: 'i' },
  { tag: 'stem:o>u', from: 'o', to: 'u' },
  { tag: 'stem:i>ie', from: 'i', to: 'ie' },
];

/** The persons compared, in paradigm order (no vos, no vosotros). */
const PERSONS: Person[] = ['yo', 'tu', 'el', 'nosotros', 'ellos'];

type Family = 'ar' | 'er' | 'ir';
/** Endings for yo, tú, él, nosotros, ellos. */
type Five = readonly [string, string, string, string, string];

const PRESENT: Record<Family, Five> = {
  ar: ['o', 'as', 'a', 'amos', 'an'],
  er: ['o', 'es', 'e', 'emos', 'en'],
  ir: ['o', 'es', 'e', 'imos', 'en'],
};
const PRETERITE_AR: Five = ['é', 'aste', 'ó', 'amos', 'aron'];
const PRETERITE_ER_IR: Five = ['í', 'iste', 'ió', 'imos', 'ieron'];
const IMPERFECT_AR: Five = ['aba', 'abas', 'aba', 'ábamos', 'aban'];
const IMPERFECT_ER_IR: Five = ['ía', 'ías', 'ía', 'íamos', 'ían'];
const FUTURE: Five = ['é', 'ás', 'á', 'emos', 'án'];
const CONDITIONAL: Five = ['ía', 'ías', 'ía', 'íamos', 'ían'];
const SUBJ_AR: Five = ['e', 'es', 'e', 'emos', 'en'];
const SUBJ_ER_IR: Five = ['a', 'as', 'a', 'amos', 'an'];
const IMP_SUBJ_AR: Five[] = [
  ['ara', 'aras', 'ara', 'áramos', 'aran'],
  ['ase', 'ases', 'ase', 'ásemos', 'asen'],
];
const IMP_SUBJ_ER_IR: Five[] = [
  ['iera', 'ieras', 'iera', 'iéramos', 'ieran'],
  ['iese', 'ieses', 'iese', 'iésemos', 'iesen'],
];
const HABER_PRESENT: Five = ['he', 'has', 'ha', 'hemos', 'han'];
const HABER_IMPERFECT: Five = ['había', 'habías', 'había', 'habíamos', 'habían'];
const ESTAR_PRESENT: Five = ['estoy', 'estás', 'está', 'estamos', 'están'];

/** A regular form split where changes happen: auxiliary ("he ", "no "), stem, ending. */
interface Template {
  prefix: string;
  stem: string;
  ending: string;
}

/** What made a form differ from the regular one; null stem when no stem change. */
interface Explanation {
  stem: StemTag | null;
  spelling: boolean;
  marks: Mark[];
}

/** A candidate stem: its stem change, if any, whether a spelling change came with it, and its accent or y. */
interface StemVariant {
  stem: string;
  tag: StemTag | null;
  spelling: boolean;
  marks: Mark[];
}

/** A candidate ending (and the stem it goes with), spelled for what precedes it. */
interface EndingVariant {
  stem: string;
  ending: string;
  spelling: boolean;
}

/** The regular forms of one person in one tense (two for the imperfect subjunctive: -ra and -se). */
function regularTemplates(inf: string, tense: Tense, i: number): Template[] {
  const family = inf.slice(-2) as Family;
  const stem = inf.slice(0, -2);
  const ar = family === 'ar';
  const subj = (ar ? SUBJ_AR : SUBJ_ER_IR)[i];
  const one = (ending: string, prefix = '', s = stem): Template[] => [{ prefix, stem: s, ending }];
  switch (tense) {
    case 'present':
      return one(PRESENT[family][i]);
    case 'preterite':
      return one((ar ? PRETERITE_AR : PRETERITE_ER_IR)[i]);
    case 'imperfect':
      return one((ar ? IMPERFECT_AR : IMPERFECT_ER_IR)[i]);
    case 'future':
      return one(FUTURE[i], '', inf);
    case 'conditional':
      return one(CONDITIONAL[i], '', inf);
    case 'presentSubjunctive':
      return one(subj);
    case 'imperfectSubjunctive':
      return (ar ? IMP_SUBJ_AR : IMP_SUBJ_ER_IR).map((set) => ({ prefix: '', stem, ending: set[i] }));
    case 'imperativeAffirmative':
      // tú is the regular él present (habla); usted, nosotros, ustedes the subjunctive.
      return one(i === 1 ? PRESENT[family][2] : subj);
    case 'imperativeNegative':
      return one(subj, 'no ');
    case 'presentPerfect':
      return one(ar ? 'ado' : 'ido', `${HABER_PRESENT[i]} `);
    case 'pluperfect':
      return one(ar ? 'ado' : 'ido', `${HABER_IMPERFECT[i]} `);
    case 'presentProgressive':
      return one(ar ? 'ando' : 'iendo', `${ESTAR_PRESENT[i]} `);
  }
}

/**
 * The stem as is and each stem change of it, with the spelled variants a
 * change can force: initial ie → ye (yerro), initial ue → hue (huelo),
 * g + ue → güe (avergüenzo). A changed stem ending in i takes the hiatus
 * accent before a vowel ending (reír: río), handled in endingVariants. Then
 * the stem's last vowel, when i or u, with an accent (envío, reúno, prohíbo)
 * and, for -uir verbs, the stem with a y (construyo; rehúyo has both;
 * arguyo drops the ü).
 */
function stemVariants(stem: string, changes: boolean, uir: boolean): StemVariant[] {
  const out: StemVariant[] = [{ stem, tag: null, spelling: false, marks: [] }];
  if (!changes) return out;
  for (const { tag, from, to } of STEM_CHANGES) {
    const at = stem.lastIndexOf(from);
    if (at < 0) continue;
    const before = stem.slice(0, at);
    const after = stem.slice(at + 1);
    out.push({ stem: before + to + after, tag, spelling: false, marks: [] });
    if (at === 0 && to === 'ie') out.push({ stem: 'ye' + after, tag, spelling: true, marks: [] });
    if (at === 0 && to === 'ue') out.push({ stem: 'hue' + after, tag, spelling: true, marks: [] });
    if (to === 'ue' && before.endsWith('g')) out.push({ stem: before + 'üe' + after, tag, spelling: true, marks: [] });
  }
  let v = -1;
  for (let k = 0; k < stem.length; k++) if (isVowelChar(stem[k])) v = k;
  const accented =
    stem[v] === 'i' || stem[v] === 'u' ? stem.slice(0, v) + (stem[v] === 'i' ? 'í' : 'ú') + stem.slice(v + 1) : null;
  if (accented) out.push({ stem: accented, tag: null, spelling: false, marks: ['accent'] });
  // The u of -guir / -quir is silent (sigo, delinco): no y there. The ü of -güir drops before it (arguyo).
  if (uir && /[^gq]u$/.test(stem)) {
    out.push({ stem: stem + 'y', tag: null, spelling: false, marks: ['y'] });
    if (accented) out.push({ stem: accented + 'y', tag: null, spelling: false, marks: ['accent', 'y'] });
  } else if (uir && stem.endsWith('gü')) {
    out.push({ stem: stem.slice(0, -1) + 'uy', tag: null, spelling: true, marks: ['y'] });
  }
  return out;
}

/**
 * The regular ending and its spelled variants. After a stem ending in a vowel,
 * an unstressed i between vowels becomes y (leyó, leyeron, leyendo, leyera)
 * and, after a/e/o, a stressed i before a consonant takes the hiatus accent
 * (leíste, leímos, leído); after a changed stem ending in i, a vowel ending
 * leaves that i stressed and accented (ri + o → río). After ñ, ll or i the
 * unstressed i before a vowel is not written (gruñó, bulleron, tiñendo; ri +
 * ió → rio, ri + iendo → riendo).
 */
function endingVariants(stem: string, ending: string, changed: boolean): EndingVariant[] {
  const out: EndingVariant[] = [{ stem, ending, spelling: false }];
  const last = stem.slice(-1);
  if (/(ñ|ll|i)$/.test(stem) && ending.startsWith('i') && isVowelChar(ending[1])) {
    out.push({ stem, ending: ending.slice(1), spelling: true });
  }
  if (!isVowelChar(last)) return out;
  if (ending.startsWith('i') && isVowelChar(ending[1])) {
    out.push({ stem, ending: 'y' + ending.slice(1), spelling: true });
  } else if (ending.startsWith('i') && /[aeo]/.test(last)) {
    out.push({ stem, ending: 'í' + ending.slice(1), spelling: true });
  }
  if (changed && last === 'i' && /^[aeo]/.test(ending)) {
    out.push({ stem: stem.slice(0, -1) + 'í', ending, spelling: true });
  }
  return out;
}

/**
 * The stem respelled for the ending's first vowel, keeping its sound: c→qu,
 * g→gu, z→c, gu→gü before e/i; c→z, g→j, gu→g, qu→c before a/o. Null when
 * nothing applies.
 */
function respell(stem: string, ending: string): string | null {
  if (/^[eéií]/.test(ending)) {
    if (stem.endsWith('gu')) return stem.slice(0, -2) + 'gü';
    if (stem.endsWith('c')) return stem.slice(0, -1) + 'qu';
    if (stem.endsWith('g')) return stem.slice(0, -1) + 'gu';
    if (stem.endsWith('z')) return stem.slice(0, -1) + 'c';
  } else if (/^[aáoó]/.test(ending)) {
    if (stem.endsWith('gu')) return stem.slice(0, -2) + 'g';
    if (stem.endsWith('qu')) return stem.slice(0, -2) + 'c';
    if (stem.endsWith('c')) return stem.slice(0, -1) + 'z';
    if (stem.endsWith('g')) return stem.slice(0, -1) + 'j';
  }
  return null;
}

/**
 * The cheapest way to get one of `forms` from the regular templates (a stem
 * change, a spelling change, an accent and a y cost one each; the plain
 * regular form costs nothing); null when none does.
 */
function explain(forms: string[], templates: Template[], changes: boolean, uir: boolean): Explanation | null {
  const accepted = new Set(forms);
  let best: Explanation | null = null;
  let bestCost = Infinity;
  for (const t of templates) {
    for (const sv of stemVariants(t.stem, changes, uir)) {
      for (const ev of endingVariants(sv.stem, t.ending, sv.tag !== null)) {
        const respelled = respell(ev.stem, ev.ending);
        const candidates: [string, boolean][] = [[ev.stem, false]];
        if (respelled) candidates.push([respelled, true]);
        for (const [stem, respelledHere] of candidates) {
          if (!accepted.has(t.prefix + stem + ev.ending)) continue;
          const spelling = sv.spelling || ev.spelling || respelledHere;
          const cost = (sv.tag ? 1 : 0) + (spelling ? 1 : 0) + sv.marks.length;
          if (cost < bestCost) {
            best = { stem: sv.tag, spelling, marks: sv.marks };
            bestCost = cost;
          }
          if (cost === 0) return best;
        }
      }
    }
  }
  return best;
}

/** The persons an entry is classified by: él only for impersonal entries, él and ellos for dative ones. */
function personsOf(parsed: ParsedEntry): Person[] {
  if (parsed.kind === 'impersonal') return ['el'];
  if (parsed.kind === 'dative') return ['el', 'ellos'];
  return PERSONS;
}

/**
 * The forms of the entry's verb in one person, without pronouns (llamarse →
 * llamo, gustarle → gusta / gustan); impersonal entries keep their own forms
 * (hay). Null when the entry has no such cell.
 */
function formsOf(parsed: ParsedEntry, tense: Tense, person: Person): string[] | null {
  if (parsed.kind === 'impersonal') return conjugate(parsed.id, tense, 'el');
  const exists =
    parsed.kind === 'dative'
      ? conjugate(parsed.id, tense, 'el', person === 'el' ? 'sg' : 'pl')
      : conjugate(parsed.id, tense, person);
  return exists ? conjugatePlain(parsed.base, tense, person) : null;
}

/**
 * Whether a present-subjunctive person is a present yo form minus -o plus the
 * subjunctive ending (tengo → tenga, conozco → conozcamos, veo → vea). Never
 * for doy, voy, soy, he, estoy, sé, which do not end in -o.
 */
function carriesYo(parsed: ParsedEntry, inf: string, person: Person): boolean {
  const ending = (inf.endsWith('ar') ? SUBJ_AR : SUBJ_ER_IR)[PERSONS.indexOf(person)];
  const forms = formsOf(parsed, 'presentSubjunctive', person) ?? [];
  return (conjugatePlain(parsed.base, 'present', 'yo') ?? []).some(
    (yo) => yo.endsWith('o') && forms.includes(yo.slice(0, -1) + ending),
  );
}

/**
 * How an entry behaves in a tense: its stem changes, then 'spelling',
 * 'accent' and 'y', then 'yo' (only yo is irregular; in the present
 * subjunctive, what is irregular comes from an irregular yo: tenga, vea),
 * 'participle' (compound tenses) or 'irregular'; ['regular'] when none applies; [] when the entry
 * does not parse or has no forms in the tense (estar presentProgressive).
 * Pronominal entries go by their base verb, dative ones by its él and ellos
 * forms, impersonal ones by their él form (hay, llueve). A person matches
 * when any of its forms does (hablara / hablase), except in the compound
 * tenses, which go by the preferred participle (he frito, he impreso), the
 * one a student learns.
 */
export function patternTags(entry: string, tense: Tense): PatternTag[] {
  const parsed = parseEntry(entry);
  if (!parsed) return [];
  // An alias is compared as the verb the engine conjugates (podrir as pudrir: pudro, pudría).
  const inf = stripAcute(ALIASES[parsed.base] ?? parsed.base);
  const uir = /[uü]ir$/.test(inf);
  const compound = tense === 'presentPerfect' || tense === 'pluperfect';
  // The future and conditional build on the whole infinitive, and a participle never changes its stem.
  const changes = !compound && tense !== 'future' && tense !== 'conditional';
  const stems = new Set<StemTag>();
  const marks = new Set<Mark>();
  let spelling = false;
  let found = false;
  const unexplained: Person[] = [];
  for (const person of personsOf(parsed)) {
    const forms = formsOf(parsed, tense, person);
    if (!forms?.length) continue;
    found = true;
    const how = explain(compound ? forms.slice(0, 1) : forms, regularTemplates(inf, tense, PERSONS.indexOf(person)), changes, uir);
    if (!how) {
      unexplained.push(person);
      continue;
    }
    if (how.stem) stems.add(how.stem);
    if (how.spelling) spelling = true;
    for (const mark of how.marks) marks.add(mark);
  }
  if (!found) return [];
  // A strong preterite (pude, vine) has a stem of its own, not a boot change, and its
  // -ra / -se forms come from it (pudiera, viniera): irregular, like tuve / tuviera.
  const strong =
    stems.size > 0 &&
    (tense === 'preterite'
      ? unexplained.length > 0
      : tense === 'imperfectSubjunctive' && patternTags(entry, 'preterite').includes('irregular'));
  // The present subjunctive is built on the present yo form: what yo's stem explains (tenga,
  // conozca, vea) carries an irregular yo ('yo'); only dé, vaya, sea, haya, esté, sepa stay 'irregular'.
  const fromYo =
    tense === 'presentSubjunctive' && unexplained.length > 0 && unexplained.every((p) => carriesYo(parsed, inf, p));
  const onlyYo = fromYo || (unexplained.length === 1 && unexplained[0] === 'yo');
  const irregular = strong || (!compound && unexplained.length > 0 && !onlyYo);
  const out: PatternTag[] = strong ? [] : STEM_CHANGES.filter((c) => stems.has(c.tag)).map((c) => c.tag);
  // An irregular tense is learned whole (oigo, oyes, oímos): its spellings and accents are not listed apart.
  if (!irregular) {
    if (spelling) out.push('spelling');
    if (marks.has('accent')) out.push('accent');
    if (marks.has('y')) out.push('y');
  }
  if (compound && unexplained.length > 0) out.push('participle');
  else if (irregular) out.push('irregular');
  else if (onlyYo) out.push('yo');
  return out.length > 0 ? out : ['regular'];
}
