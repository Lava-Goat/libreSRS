// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The conjugation generator.
 *
 * Every verb is built by one generator from a small spec: its ending class
 * (-ar/-er/-ir), its root, the consonant class of the root's last consonant
 * (which decides c/qu, z/c, g/gu, g/j, gu/g, gu/gü spellings), a stem-change
 * flag and, for irregular verbs, a patch of overridden cells. Compounds are
 * generated as their base verb with a prefix, then re-accented by the
 * syllabifier (tener ten → obtener obtén).
 *
 * The generator produces a "core" of simple forms (six-person cells of every
 * simple tense, plus tú/vosotros commands, gerund and participle, and the
 * three voseo cells that differ from tú's); compound tenses, the progressive,
 * negative commands and reflexive pronouns are then assembled from the core.
 *
 * Voseo (NGLE §4.7, DPD "voseo"): the present indicative and the voseante
 * present subjunctive are the vosotros forms without their i (habláis →
 * hablás, sois → sos, tengáis → tengás, durmáis → durmás), so they never take
 * the stressed-stem change (querés, podés, dormís, jugás); the affirmative
 * command is the vosotros one without its d, stressed on the last syllable
 * (hablad → hablá, decid → decí, oíd → oí, dad → da). haber (has), ser (sé)
 * and ir (andá) are patched. Every other vos cell is tú's (hablaste, hablabas,
 * hablarás, has hablado, estás hablando).
 */
import {
  attachEnclitic,
  hasAcute,
  isVowelChar,
  monosyllableVariants,
  prefixForm,
  stripAcute,
} from './accent.js';
import {
  COMPOUND_PATCHES,
  DATIVE_VERBS,
  DEFECTIVE,
  IMPERSONAL_BASES,
  IRREGULAR,
  LEXICON,
  REFLEXIVE_VERBS,
  WEATHER_VERBS,
  type LexiconEntry,
  type Patch,
  type StemChange,
} from './lexicon.js';
import {
  DATIVE_CLITICS,
  SLOT_PERSONS,
  isImperative,
  personApplies,
  slotIndex,
  type GNumber,
  type Person,
  type Tense,
  type VerbKind,
  type VosRegion,
} from './types.js';

type Conj = 'ar' | 'er' | 'ir';
/** Consonant class of the root's last consonant. */
type Cls = '' | 'K' | 'TH' | 'G' | 'J' | 'GW';
/** Six person cells, each a list of accepted forms (canonical first). */
type Cells = string[][];

export interface Core {
  present: Cells;
  preterite: Cells;
  imperfect: Cells;
  future: Cells;
  conditional: Cells;
  subj: Cells;
  impSubjRa: Cells;
  impSubjSe: Cells;
  impTu: string[];
  impVos: string[];
  impNos: string[];
  /** Voseo present indicative (hablás, sos, tenés). */
  vosPresent: string[];
  /** Voseante present subjunctive (hablés, tengás, durmás); the tuteo one is subj[1]. */
  vosSubj: string[];
  /** Voseo affirmative command (hablá, decí, andá). */
  impVoseo: string[];
  gerund: string[];
  participle: string[];
}

export interface Spec {
  /** Infinitive without -se, lowercase, with its written accent (oír). */
  inf: string;
  stem?: StemChange;
  zc?: boolean;
  uj?: boolean;
  patch?: Patch;
  participle?: string[];
  /** Distractor variants: apply the stressed-stem change in every person. */
  bootAll?: boolean;
  /** Distractor variants: skip the -ir preterite/gerund e>i, o>u change. */
  noPretChange?: boolean;
  /** Distractor variants: ignore the c/qu, g/gu, z/c ... spelling rules. */
  noSpelling?: boolean;
  /** Also accept the forms of this stem change, after the canonical ones (adecuo | adecúo). */
  altStem?: StemChange;
}

const BOOT = [true, true, true, false, false, true];

const END = {
  present: {
    ar: ['o', 'as', 'a', 'amos', 'áis', 'an'],
    er: ['o', 'es', 'e', 'emos', 'éis', 'en'],
    ir: ['o', 'es', 'e', 'imos', 'ís', 'en'],
  },
  subj: {
    ar: ['e', 'es', 'e', 'emos', 'éis', 'en'],
    er: ['a', 'as', 'a', 'amos', 'áis', 'an'],
    ir: ['a', 'as', 'a', 'amos', 'áis', 'an'],
  },
  imperfect: {
    ar: ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'],
    er: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    ir: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
  },
  pretAr: ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'],
  pretErIr: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
  pretVowel: ['í', 'íste', 'yó', 'ímos', 'ísteis', 'yeron'],
  pretUir: ['í', 'iste', 'yó', 'imos', 'isteis', 'yeron'],
  pretStrong: ['e', 'iste', 'o', 'imos', 'isteis', 'ieron'],
  future: ['é', 'ás', 'á', 'emos', 'éis', 'án'],
  conditional: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
};

// ---------------------------------------------------------------------------
// Infinitive parsing
// ---------------------------------------------------------------------------

const INFINITIVE_RE = /^[a-zñáéíóúü]*(ar|er|ir|ír)$/;

function looksLikeInfinitive(s: string): boolean {
  return INFINITIVE_RE.test(s) && s !== 'ar' && s !== 'er';
}

export interface ParsedInfinitive {
  /** Infinitive without the pronoun (levantar, oír). */
  base: string;
  reflexive: boolean;
}

/**
 * The only infinitives with a written accent are the -eír / -oír verbs (reír,
 * oír), and the accent is obligatory there (e-í, o-í are a hiatus). Typed
 * without it ("oir", "reirse"), they are still those verbs.
 */
function restoreAccent(base: string): string {
  return /[eo]ir$/.test(base) ? base.slice(0, -2) + 'ír' : base;
}

/** Normalises and splits an infinitive; null if it is not a Spanish infinitive. */
export function parseInfinitive(input: string): ParsedInfinitive | null {
  const s = input.normalize('NFC').trim().toLowerCase();
  if (looksLikeInfinitive(s)) return { base: restoreAccent(s), reflexive: false };
  if (s.endsWith('se')) {
    const base = s.slice(0, -2);
    if (looksLikeInfinitive(base)) return { base: restoreAccent(base), reflexive: true };
  }
  return null;
}

/** A verb entry: the infinitive and the way it is used (see VerbKind). */
export interface ParsedEntry {
  /** Canonical id: gustar, gustarse, gustarle, haber-impersonal, llover. */
  id: string;
  /** The infinitive without pronoun (gustar, haber, llover). */
  base: string;
  kind: VerbKind;
}

/**
 * Parses an entry id: an infinitive (plain; impersonal for the weather
 * verbs), infinitive + se (pronominal), infinitive + le (dative), or
 * "<verb>-impersonal" for haber and the daybreak verbs. The label
 * "haber (hay)" is read as haber-impersonal. Null if it is none of these.
 */
export function parseEntry(input: string): ParsedEntry | null {
  const s = input.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
  const imp = s.match(/^([a-zñáéíóúü]+)(?:-impersonal| \([a-zñáéíóúü ]+\))$/);
  if (imp) {
    const p = parseInfinitive(imp[1]);
    if (!p || p.reflexive) return null;
    if (WEATHER_VERBS.has(p.base)) return { id: p.base, base: p.base, kind: 'impersonal' };
    if (!IMPERSONAL_BASES.has(p.base)) return null;
    return { id: `${p.base}-impersonal`, base: p.base, kind: 'impersonal' };
  }
  const parsed = parseInfinitive(s);
  if (parsed) {
    if (parsed.reflexive) return { id: `${parsed.base}se`, base: parsed.base, kind: 'pronominal' };
    return { id: parsed.base, base: parsed.base, kind: WEATHER_VERBS.has(parsed.base) ? 'impersonal' : 'plain' };
  }
  if (s.endsWith('le')) {
    const p = parseInfinitive(s.slice(0, -2));
    if (p && !p.reflexive) return { id: `${p.base}le`, base: p.base, kind: 'dative' };
  }
  return null;
}

/** The canonical id of an entry ("GUSTARLE" → "gustarle", "haber (hay)" → "haber-impersonal"); null if not one. */
export function canonicalEntry(input: string): string | null {
  return parseEntry(input)?.id ?? null;
}

/** The dictionary spelling of an infinitive ("OIR" → "oír", "Reirse" → "reírse"); null if not one. */
export function canonicalInfinitive(input: string): string | null {
  const parsed = parseInfinitive(input);
  return parsed ? parsed.base + (parsed.reflexive ? 'se' : '') : null;
}

function conjOf(inf: string): Conj {
  return stripAcute(inf).slice(-2) as Conj;
}

function rootOf(inf: string): string {
  return stripAcute(inf).slice(0, -2);
}

function clsOf(conj: Conj, root: string): Cls {
  if (conj === 'ar') {
    if (root.endsWith('gu')) return 'GW';
    if (root.endsWith('c')) return 'K';
    if (root.endsWith('g')) return 'G';
    if (root.endsWith('z')) return 'TH';
    return '';
  }
  if (root.endsWith('gu')) return 'G';
  if (root.endsWith('qu')) return 'K';
  if (root.endsWith('c')) return 'TH';
  if (root.endsWith('g')) return 'J';
  return '';
}

/** Length of the spelled final consonant of a root in its class. */
function consLength(root: string, cls: Cls): number {
  switch (cls) {
    case 'K':
      return root.endsWith('qu') ? 2 : 1;
    case 'G':
      return root.endsWith('gu') ? 2 : 1;
    case 'GW':
      return 2;
    case 'TH':
    case 'J':
      return 1;
    default:
      return 0;
  }
}

/** Joins a root and an ending, respelling the root's last consonant for the ending's vowel. */
function join(root: string, cls: Cls, ending: string, zc = false): string {
  if (!cls) return root + ending;
  const soft = /^[eéií]/.test(ending);
  const base = root.slice(0, root.length - consLength(root, cls));
  let cons: string;
  switch (cls) {
    case 'K':
      cons = soft ? 'qu' : 'c';
      break;
    case 'TH':
      cons = soft ? 'c' : zc ? 'zc' : 'z';
      break;
    case 'G':
      cons = soft ? 'gu' : 'g';
      break;
    case 'J':
      cons = soft ? 'g' : 'j';
      break;
    case 'GW':
      cons = soft ? 'gü' : 'gu';
      break;
  }
  return base + cons + ending;
}

/** Applies a stem change to the last matching vowel of the root (before its final consonant). */
function changeStem(root: string, cls: Cls, kind: 'ie' | 'ue' | 'uue' | 'i' | 'u' | 'iie' | 'acc'): string {
  const n = consLength(root, cls);
  const core = root.slice(0, root.length - n);
  const tail = root.slice(root.length - n);
  let idx: number;
  let rep: string;
  switch (kind) {
    case 'acc': {
      idx = Math.max(core.lastIndexOf('i'), core.lastIndexOf('u'));
      rep = core[idx] === 'i' ? 'í' : 'ú';
      break;
    }
    case 'ie':
      idx = core.lastIndexOf('e');
      rep = idx === 0 ? 'ye' : 'ie';
      break;
    case 'ue':
      idx = core.lastIndexOf('o');
      rep = idx === 0 ? 'hue' : core[idx - 1] === 'g' ? 'üe' : 'ue';
      break;
    case 'uue':
      idx = core.lastIndexOf('u');
      rep = 'ue';
      break;
    case 'i':
      idx = core.lastIndexOf('e');
      rep = 'i';
      break;
    case 'u':
      idx = core.lastIndexOf('o');
      rep = 'u';
      break;
    case 'iie':
      idx = core.lastIndexOf('i');
      rep = 'ie';
      break;
  }
  if (idx < 0) throw new Error(`stem change ${kind} does not apply to ${root}`);
  return core.slice(0, idx) + rep + core.slice(idx + 1) + tail;
}

const BOOT_KIND: Record<StemChange, 'ie' | 'ue' | 'uue' | 'i' | 'iie' | 'acc'> = {
  ie: 'ie',
  ue: 'ue',
  uue: 'uue',
  i: 'i',
  iei: 'ie',
  ueu: 'ue',
  iie: 'iie',
  acc: 'acc',
};

/** A voseo form from its vosotros one: the i of the ending drops (habláis → hablás, sois → sos; vivís stays). */
function voseoFromVosotros(form: string): string {
  return form.replace(/([aeoáéó])is$/, '$1s');
}

const ACUTE: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

/**
 * The voseo command from the vosotros one: without the d and stressed on the
 * last syllable (hablad → hablá, oíd → oí). A single vowel takes no accent
 * (dad → da, ved → ve); i/u + vowel is written with it here (fiá, huí) and
 * reduced to the RAE 2010 spelling (fia, hui) by monosyllableVariants.
 */
function voseoCommand(vosotros: string): string {
  const stem = vosotros.endsWith('d') ? vosotros.slice(0, -1) : vosotros;
  if (hasAcute(stem)) return stem;
  if ([...stem].filter((c) => isVowelChar(c)).length < 2) return stem;
  const last = stem.slice(-1);
  return ACUTE[last] ? stem.slice(0, -1) + ACUTE[last] : stem;
}

function splitAlts(cell: string): string[] {
  return cell.split('|');
}

function uniq(list: string[]): string[] {
  return list.filter((v, i) => v !== '' && list.indexOf(v) === i);
}

// ---------------------------------------------------------------------------
// Core generation for simple (non-compound) verbs
// ---------------------------------------------------------------------------

export function buildCore(spec: Spec): Core {
  const { inf, patch = {} } = spec;
  const conj = conjOf(inf);
  const root = rootOf(inf);
  const cls: Cls = spec.noSpelling ? '' : clsOf(conj, root);
  const stem = spec.stem ?? patch.stem;
  const zc = !!spec.zc;
  const vowelRoot = conj !== 'ar' && cls === '' && /[aeo]$/.test(root);
  // -uir inserts y (construyo); in -guir/-quir the u is only spelling (sigo, delinco).
  // -güir (argüir, redargüir) is -uir with a sounded u: DLE/DPD "argüir" goes like
  // construir, and the diaeresis drops before the y (arguyo, arguyó, arguyendo,
  // arguyas) but stays before i (argüimos, argüís, argüí). See dropDiaeresis below.
  const uir = conj === 'ir' && cls === '' && /[uü]$/.test(root) && !/[gq]u$/.test(root);
  const nyRoot = conj !== 'ar' && /(ñ|ll)$/.test(root);

  const bootRoot = stem ? changeStem(root, cls, BOOT_KIND[stem]) : root;
  const weakKind = stem === 'i' || stem === 'iei' ? 'i' : stem === 'ueu' ? 'u' : null;
  const irWeak = conj === 'ir' && weakKind ? changeStem(root, cls, weakKind) : root;
  const pretWeak = spec.noPretChange ? root : irWeak;

  const withY = (r: string, ending: string): string => (uir && /^[aeoáéó]/.test(ending) ? r + 'y' + ending : join(r, cls, ending, zc));
  const pick = (p: number): string => (BOOT[p] || spec.bootAll ? bootRoot : root);

  // Present indicative
  let present: Cells;
  if (patch.present) present = patch.present.map(splitAlts);
  else {
    present = END.present[conj].map((e, p) => [withY(pick(p), e)]);
    if (patch.yo) present[0] = [patch.yo];
  }

  // Preterite
  let preterite: Cells;
  if (patch.pret) preterite = patch.pret.map(splitAlts);
  else if (patch.pretStem || spec.uj) {
    const ps = patch.pretStem ?? root.slice(0, -1) + 'j';
    const psCls: Cls = ps.endsWith('c') ? 'TH' : '';
    preterite = END.pretStrong.map((e, p) => {
      const ending = p === 5 && ps.endsWith('j') ? 'eron' : e;
      return [join(ps, psCls, ending)];
    });
  } else if (conj === 'ar') {
    preterite = END.pretAr.map((e) => [join(root, cls, e)]);
  } else {
    const endings = vowelRoot ? END.pretVowel : uir ? END.pretUir : END.pretErIr;
    preterite = endings.map((e, p) => {
      const third = p === 2 || p === 5;
      let ending = e;
      if (third && nyRoot) ending = p === 2 ? 'ó' : 'eron';
      return [join(third ? pretWeak : root, cls, ending)];
    });
  }

  // Imperfect
  const imperfect: Cells = patch.imperfect
    ? patch.imperfect.map(splitAlts)
    : END.imperfect[conj].map((e) => [join(root, cls, e)]);

  // Future and conditional
  const futStems = patch.fut ?? [stripAcute(inf)];
  const future: Cells = END.future.map((e) => futStems.map((s) => s + e));
  const conditional: Cells = END.conditional.map((e) => futStems.map((s) => s + e));

  // Present subjunctive
  let subj: Cells;
  const yoForm = patch.yo ?? patch.present?.[0];
  if (patch.subj) subj = patch.subj.map(splitAlts);
  else if (patch.subjStem || yoForm) {
    const s = patch.subjStem ?? splitAlts(yoForm as string)[0].slice(0, -1);
    subj = END.subj[conj].map((e) => [s + e]);
  } else {
    subj = END.subj[conj].map((e, p) => {
      const r = BOOT[p] || spec.bootAll ? bootRoot : irWeak;
      return [withY(r, e)];
    });
  }

  // Imperfect subjunctive, from the preterite ellos form
  const impSubjRa: Cells = SLOT_PERSONS.map(() => []);
  const impSubjSe: Cells = SLOT_PERSONS.map(() => []);
  for (const f of preterite[5]) {
    const s = f.slice(0, -3);
    const accented = s.slice(0, -1) + ({ a: 'á', e: 'é' } as Record<string, string>)[s.slice(-1)];
    ['ra', 'ras', 'ra', 'ramos', 'rais', 'ran'].forEach((e, p) => impSubjRa[p].push((p === 3 ? accented : s) + e));
    ['se', 'ses', 'se', 'semos', 'seis', 'sen'].forEach((e, p) => impSubjSe[p].push((p === 3 ? accented : s) + e));
  }

  const impTu = patch.impTu ?? present[2];
  const impVos = patch.impVos ?? [inf.slice(0, -1) + 'd'];
  const impNos = patch.impNos ?? subj[3];
  const vosPresent = patch.vosPresent ?? present[4].map(voseoFromVosotros);
  const vosSubj = subj[4].map(voseoFromVosotros);
  const impVoseo = patch.impVoseo ?? impVos.map(voseoCommand);

  let gerund: string[];
  if (patch.gerund) gerund = patch.gerund;
  else if (conj === 'ar') gerund = [join(root, cls, 'ando')];
  else if (vowelRoot || uir) gerund = [root + 'yendo'];
  else if (nyRoot) gerund = [pretWeak + 'endo'];
  else gerund = [join(pretWeak, cls, 'iendo')];

  let participle: string[];
  if (patch.participle) participle = patch.participle;
  else if (spec.participle) participle = spec.participle;
  else if (conj === 'ar') participle = [join(root, cls, 'ado')];
  else if (vowelRoot) participle = [root + 'ído'];
  else participle = [join(root, cls, 'ido')];

  const core: Core = {
    present,
    preterite,
    imperfect,
    future,
    conditional,
    subj,
    impSubjRa,
    impSubjSe,
    impTu,
    impVos,
    impNos,
    vosPresent,
    vosSubj,
    impVoseo,
    gerund,
    participle,
  };
  // ü only marks a sounded u before e/i; before the inserted y it is plain u (argüyo → arguyo).
  const dropDiaeresis = (f: string): string => (uir ? f.replace(/üy/g, 'uy') : f);
  const normalized = mapCore(core, (f) => monosyllableVariants(dropDiaeresis(f)));
  if (spec.altStem && !spec.bootAll) {
    return mergeCores(normalized, buildCore({ ...spec, stem: spec.altStem, altStem: undefined }));
  }
  if (patch.alsoRegular && !spec.bootAll) {
    const regular = buildCore({ inf, zc: spec.zc, uj: spec.uj, participle: spec.participle });
    return mergeCores(normalized, regular);
  }
  return normalized;
}

function mapCore(core: Core, fn: (form: string) => string[]): Core {
  const cells = (c: Cells): Cells => c.map((alts) => uniq(alts.flatMap(fn)));
  const list = (l: string[]): string[] => uniq(l.flatMap(fn));
  return {
    present: cells(core.present),
    preterite: cells(core.preterite),
    imperfect: cells(core.imperfect),
    future: cells(core.future),
    conditional: cells(core.conditional),
    subj: cells(core.subj),
    impSubjRa: cells(core.impSubjRa),
    impSubjSe: cells(core.impSubjSe),
    impTu: list(core.impTu),
    impVos: list(core.impVos),
    impNos: list(core.impNos),
    vosPresent: list(core.vosPresent),
    vosSubj: list(core.vosSubj),
    impVoseo: list(core.impVoseo),
    gerund: list(core.gerund),
    participle: list(core.participle),
  };
}

function mergeCores(a: Core, b: Core): Core {
  const cells = (x: Cells, y: Cells): Cells => x.map((alts, p) => uniq([...alts, ...y[p]]));
  return {
    present: cells(a.present, b.present),
    preterite: cells(a.preterite, b.preterite),
    imperfect: cells(a.imperfect, b.imperfect),
    future: cells(a.future, b.future),
    conditional: cells(a.conditional, b.conditional),
    subj: cells(a.subj, b.subj),
    impSubjRa: cells(a.impSubjRa, b.impSubjRa),
    impSubjSe: cells(a.impSubjSe, b.impSubjSe),
    impTu: uniq([...a.impTu, ...b.impTu]),
    impVos: uniq([...a.impVos, ...b.impVos]),
    impNos: uniq([...a.impNos, ...b.impNos]),
    vosPresent: uniq([...a.vosPresent, ...b.vosPresent]),
    vosSubj: uniq([...a.vosSubj, ...b.vosSubj]),
    impVoseo: uniq([...a.impVoseo, ...b.impVoseo]),
    gerund: uniq([...a.gerund, ...b.gerund]),
    participle: uniq([...a.participle, ...b.participle]),
  };
}

/** Applies the few cells a compound overrides (predice, prediré/predeciré, bendecido). */
function applyCompoundPatch(core: Core, patch: Patch): Core {
  const out = { ...core };
  if (patch.fut) {
    out.future = END.future.map((e) => patch.fut!.map((s) => s + e));
    out.conditional = END.conditional.map((e) => patch.fut!.map((s) => s + e));
  }
  if (patch.impTu) out.impTu = patch.impTu;
  if (patch.participle) out.participle = patch.participle;
  if (patch.gerund) out.gerund = patch.gerund;
  return out;
}

// ---------------------------------------------------------------------------
// Lexicon-backed core lookup
// ---------------------------------------------------------------------------

const coreCache = new Map<string, Core>();

/**
 * Irregular verbs whose compounds keep their irregularity (contrahacer,
 * entreoír, prevaler): an infinitive outside the dictionary that ends in one
 * of them is conjugated as that verb with a prefix.
 */
const INFERRED_BASES = ['hacer', 'poner', 'tener', 'venir', 'traer', 'valer', 'caer', 'cocer', 'oír'];

/**
 * The model of an infinitive outside the dictionary, read from its ending:
 *  - a compound of an irregular verb above (contrahacer → hacer);
 *  - -eír: every such verb goes like reír (desleír → deslío, deslió);
 *  - vowel + -cer/-cir: c>zc (perecer → perezco), -ducir also preterite -uj-
 *    (reconducir → recondujo); the exceptions (hacer, cocer, decir, mecer) are
 *    compounds above, in the dictionary, or left out here;
 *  - -uar after anything but c/g: stressed ú (consensúo), as all -uar verbs;
 *  - -cuar: adecuo, with adecúo also accepted (DPD, NGLE).
 * Anything else is regular apart from the automatic spelling changes.
 */
function inferEntry(inf: string): LexiconEntry | undefined {
  for (const base of INFERRED_BASES) {
    if (inf.length > base.length && inf.endsWith(base)) return { inf, base, prefix: inf.slice(0, -base.length) };
  }
  if (inf.endsWith('eír')) return { inf, eirRoot: inf.slice(0, -3) };
  if (/[aeiouáéíóú]c(er|ir)$/.test(inf) && !/(^|re)mecer$|decir$/.test(inf)) {
    return { inf, zc: true, uj: inf.endsWith('ducir') };
  }
  if (/[^cg]uar$/.test(inf)) return { inf, stem: 'acc' };
  if (inf.endsWith('cuar')) return { inf, altStem: 'acc' };
  return undefined;
}

/** The dictionary entry of a base infinitive or, outside the dictionary, the model its ending implies. */
export function entryFor(inf: string): LexiconEntry | undefined {
  return LEXICON.get(inf) ?? inferEntry(inf);
}

function specFor(inf: string, entry: LexiconEntry | undefined): Spec {
  if (!entry) return { inf };
  return {
    inf,
    stem: entry.stem,
    altStem: entry.altStem,
    zc: entry.zc,
    uj: entry.uj,
    participle: entry.participle,
    patch: IRREGULAR[inf],
  };
}

/** The simple-form core of a verb (base infinitive, no -se). Unknown verbs are regular. */
export function getCore(inf: string): Core {
  const cached = coreCache.get(inf);
  if (cached) return cached;
  const entry = entryFor(inf);
  let core: Core;
  if (entry?.alias) {
    core = getCore(entry.alias);
  } else if (entry?.eirRoot !== undefined) {
    // Every reír form starts with its root r: swap in this verb's root and re-accent.
    const root = entry.eirRoot;
    core = mapCore(getCore('reír'), (f) => [prefixForm(root, f.slice(1))]);
  } else if (entry?.base && entry.prefix !== undefined) {
    const baseCore = getCore(entry.base);
    const prefix = entry.prefix;
    const swap = entry.swapH;
    core = mapCore(baseCore, (f) => [prefixForm(prefix, swap ? f.replace(/^h/, 'f') : f)]);
    if (entry.participle) core.participle = entry.participle;
    const patch = COMPOUND_PATCHES[inf];
    if (patch) core = applyCompoundPatch(core, patch);
  } else {
    core = buildCore(specFor(inf, entry));
  }
  coreCache.set(inf, core);
  return core;
}

// ---------------------------------------------------------------------------
// Assembly of the twelve tenses
// ---------------------------------------------------------------------------

const REFLEXIVE_PRONOUNS = ['me', 'te', 'se', 'nos', 'os', 'se'];
const HABER_PRESENT = ['he', 'has', 'ha', 'hemos', 'habéis', 'han'];
const HABER_IMPERFECT = ['había', 'habías', 'había', 'habíamos', 'habíais', 'habían'];
const ESTAR_PRESENT = ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'];

function withPronoun(forms: string[], p: number, reflexive: boolean): string[] {
  return reflexive ? forms.map((f) => `${REFLEXIVE_PRONOUNS[p]} ${f}`) : forms;
}

/**
 * The vos present subjunctive of a region, canonical first: Río de la Plata
 * takes the tuteo form as standard (que hables) and accepts the voseante one
 * (que hablés); Central America the other way round (NGLE §4.7, DPD "voseo").
 */
function vosSubjunctive(core: Core, region: VosRegion): string[] {
  return region === 'centroamericano' ? uniq([...core.vosSubj, ...core.subj[1]]) : uniq([...core.subj[1], ...core.vosSubj]);
}

/** Assembles one cell from a core. `region` only matters for vos (default rioplatense). */
export function assemble(
  core: Core,
  base: string,
  reflexive: boolean,
  tense: Tense,
  person: Person,
  region: VosRegion = 'rioplatense',
): string[] | null {
  if (!personApplies(tense, person)) return null;
  const p = slotIndex(person);
  const pron = REFLEXIVE_PRONOUNS[p];
  const vos = person === 'vos';
  const subj = vos ? vosSubjunctive(core, region) : core.subj[p];
  switch (tense) {
    case 'present':
      return withPronoun(vos ? core.vosPresent : core.present[p], p, reflexive);
    case 'preterite':
      return withPronoun(core.preterite[p], p, reflexive);
    case 'imperfect':
      return withPronoun(core.imperfect[p], p, reflexive);
    case 'future':
      return withPronoun(core.future[p], p, reflexive);
    case 'conditional':
      return withPronoun(core.conditional[p], p, reflexive);
    case 'presentSubjunctive':
      return withPronoun(subj, p, reflexive);
    case 'imperfectSubjunctive':
      return withPronoun(uniq([...core.impSubjRa[p], ...core.impSubjSe[p]]), p, reflexive);
    case 'presentPerfect':
      return withPronoun(core.participle.map((pp) => `${HABER_PRESENT[p]} ${pp}`), p, reflexive);
    case 'pluperfect':
      return withPronoun(core.participle.map((pp) => `${HABER_IMPERFECT[p]} ${pp}`), p, reflexive);
    case 'presentProgressive': {
      const plain = core.gerund.map((g) => `${ESTAR_PRESENT[p]} ${g}`);
      if (!reflexive) return plain;
      return uniq([
        ...plain.map((f) => `${pron} ${f}`),
        ...core.gerund.map((g) => `${ESTAR_PRESENT[p]} ${attachEnclitic(g, pron)}`),
      ]);
    }
    case 'imperativeNegative':
      return subj.map((f) => (reflexive ? `no ${pron} ${f}` : `no ${f}`));
    case 'imperativeAffirmative': {
      let forms: string[];
      if (person === 'tu') forms = core.impTu;
      else if (vos) forms = core.impVoseo;
      else if (person === 'nosotros') forms = core.impNos;
      else if (person === 'vosotros') forms = core.impVos;
      else forms = core.subj[p];
      if (!reflexive) return [...forms];
      if (person === 'vosotros' && base === 'ir') return ['idos', 'iros'];
      if (person === 'nosotros') return uniq(forms.map((f) => attachEnclitic(f, 'nos', f.endsWith('s') ? 's' : undefined)));
      if (person === 'vosotros') return uniq(forms.map((f) => attachEnclitic(f, 'os', f.endsWith('d') ? 'd' : undefined)));
      return uniq(forms.map((f) => attachEnclitic(f, pron)));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Accepted forms of an entry in a tense and person, canonical first; null
 * when the cell does not exist or the input is not an entry. Known verbs use
 * their dictionary model; any other -ar/-er/-ir infinitive is conjugated as a
 * regular verb (with the automatic spelling changes).
 *
 *  - plain (hablar) and pronominal (levantarse, with the pronoun): by subject;
 *    no yo in the imperatives. vos follows `opts.vosRegion` (default
 *    rioplatense), which only changes the present subjunctive and the
 *    negative command (see VosRegion).
 *  - dative (gustarle): `person` is the experiencer and `number` (default sg)
 *    the number of the thing liked: me gusta / me gustan, les gustó. Only the
 *    proclitic order (me está gustando); no imperatives.
 *  - impersonal (haber-impersonal, llover): only `el`; no imperatives, and
 *    haber has no progressive. hay, hubo, había, ha habido; llueve, está lloviendo.
 */
export function conjugate(
  entry: string,
  tense: Tense,
  person: Person,
  number: GNumber = 'sg',
  opts: { vosRegion?: VosRegion } = {},
): string[] | null {
  const parsed = parseEntry(entry);
  if (!parsed) return null;
  const { base, kind } = parsed;
  switch (kind) {
    case 'plain':
    case 'pronominal':
      if (!cellExists(base, tense, person)) return null;
      return assemble(getCore(base), base, kind === 'pronominal', tense, person, opts.vosRegion);
    case 'dative': {
      const third: Person = number === 'pl' ? 'ellos' : 'el';
      if (isImperative(tense) || !cellExists(base, tense, third)) return null;
      const clitic = DATIVE_CLITICS[person];
      if (!clitic) return null;
      return assemble(getCore(base), base, false, tense, third)?.map((f) => `${clitic} ${f}`) ?? null;
    }
    case 'impersonal':
      return conjugateImpersonal(base, tense, person);
  }
}

function conjugateImpersonal(base: string, tense: Tense, person: Person): string[] | null {
  if (person !== 'el' || isImperative(tense) || !cellExists(base, tense, 'el')) return null;
  if (base === 'haber') {
    if (tense === 'present') return ['hay'];
    if (tense === 'presentProgressive') return null;
  }
  return assemble(getCore(base), base, false, tense, 'el');
}

/**
 * The plain forms of a verb in any person, ignoring its kind (llover in the
 * first person, gustar by subject): the material of the "wrong kind" distractors.
 */
export function conjugatePlain(
  base: string,
  tense: Tense,
  person: Person,
  reflexive = false,
  region?: VosRegion,
): string[] | null {
  if (!cellExists(base, tense, person)) return null;
  return assemble(getCore(base), base, reflexive, tense, person, region);
}

/** False for the cells a defective verb lacks (soler has no future; concernir only third persons). */
function cellExists(base: string, tense: Tense, person: Person): boolean {
  const missing = DEFECTIVE[base];
  if (!missing) return true;
  if (missing.tenses?.includes(tense)) return false;
  return !missing.persons || missing.persons.includes(person);
}

/** Conjugation with a custom spec (used for regularized distractors). */
export function conjugateSpec(
  spec: Spec,
  reflexive: boolean,
  tense: Tense,
  person: Person,
  region?: VosRegion,
): string[] | null {
  return assemble(buildCore(spec), spec.inf, reflexive, tense, person, region);
}

/** Whether the entry's verb is in the dictionary (gustarle, haber-impersonal and levantarse count). */
export function isKnownVerb(entry: string): boolean {
  const parsed = parseEntry(entry);
  return !!parsed && LEXICON.has(parsed.base);
}

const MODEL_NAMES: Record<StemChange, string> = {
  ie: 'e>ie',
  ue: 'o>ue',
  uue: 'u>ue',
  i: 'e>i',
  iei: 'e>ie/i',
  ueu: 'o>ue/u',
  iie: 'i>ie',
  acc: 'stressed í/ú',
};

/** The model name of a dictionary verb (e.g. "e>ie, z>c", "tener", "regular"). */
function modelOf(inf: string): string {
  const entry = LEXICON.get(inf);
  if (!entry) return 'regular';
  if (entry.alias) return `${entry.alias} (${modelOf(entry.alias)})`;
  if (entry.base) {
    const root = entry.base;
    const baseEntry = LEXICON.get(root);
    return baseEntry?.irregular ? root : `${root} (${modelOf(root)})`;
  }
  if (entry.irregular) return inf;
  const conj = conjOf(inf);
  const root = rootOf(inf);
  const cls = clsOf(conj, root);
  const parts: string[] = [];
  if (entry.stem) parts.push(MODEL_NAMES[entry.stem]);
  if (entry.uj) parts.push('c>zc, preterite -uj-');
  else if (entry.zc) parts.push('c>zc');
  else if (cls === 'K') parts.push(conj === 'ar' ? 'c>qu' : 'qu>c');
  else if (cls === 'G') parts.push(conj === 'ar' ? 'g>gu' : 'gu>g');
  else if (cls === 'TH') parts.push(conj === 'ar' ? 'z>c' : 'c>z');
  else if (cls === 'J') parts.push('g>j');
  else if (cls === 'GW') parts.push('gu>gü');
  if (conj === 'ir' && cls === '' && root.endsWith('u')) parts.push('-uir: i>y');
  else if (conj !== 'ar' && cls === '' && /[aeo]$/.test(root)) parts.push('vowel stem: i>y');
  if (/(ñ|ll)$/.test(root) && conj !== 'ar') parts.push('ñ/ll: -ió>-ó');
  if (entry.participle) parts.push(`participle ${entry.participle.join('/')}`);
  return parts.length ? parts.join(', ') : 'regular';
}

export function verbInfo(entry: string): {
  known: boolean;
  reflexive: boolean;
  base: string;
  kind: VerbKind;
  model?: string;
} {
  const parsed = parseEntry(entry);
  if (!parsed) {
    const s = entry.trim().toLowerCase();
    return { known: false, reflexive: false, base: s, kind: 'plain' };
  }
  const known = LEXICON.has(parsed.base);
  return {
    known,
    reflexive: parsed.kind === 'pronominal',
    base: parsed.base,
    kind: parsed.kind,
    ...(known ? { model: modelOf(parsed.base) } : {}),
  };
}

/** Every dictionary infinitive, followed by the pronominal verbs courses teach. */
export function lexiconInfinitives(): string[] {
  return [...LEXICON.keys(), ...REFLEXIVE_VERBS];
}

/**
 * Every entry the reverse index knows: the dictionary infinitives (weather
 * verbs among them, as impersonal entries), the pronominal verbs courses
 * teach, the dative entries of DATIVE_VERBS and the -impersonal entries.
 */
export function lexiconEntries(): string[] {
  return [
    ...lexiconInfinitives(),
    ...DATIVE_VERBS.map((v) => `${v}le`),
    ...[...IMPERSONAL_BASES].map((v) => `${v}-impersonal`),
  ];
}
