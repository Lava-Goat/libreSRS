// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Spanish verb conjugation engine: conjugation, reverse analysis, deck verb
 * detection, grading and multiple-choice distractors. Imported via the
 * "@libresrs/shared/conjugation" subpath so the client bundle does not carry
 * the dictionary unless it needs it. The sentences with a blank (built-in
 * frames, the subject parser and the checker) are a subpath of their own,
 * "@libresrs/shared/conjugation/sentences" (./sentences/index.ts): only the
 * server renders and checks sentences, so no page carries their word lists.
 */
import { conjugate, parseEntry } from './conjugate.js';
import { TENSES, type GNumber, type Person, type Tense, type VosRegion } from './types.js';

export {
  TENSES,
  PERSONS,
  TENSE_IDS,
  PERSON_IDS,
  personLabel,
  personApplies,
  isTense,
  isPerson,
  isImperative,
  isNumber,
  NUMBER_IDS,
  EXPERIENCER_LABELS,
  DATIVE_CLITICS,
  VOS_REGIONS,
  isVosRegion,
  PERSON_SUBJECTS,
  SHORT_PERSON_LABELS,
  subjectGloss,
  subjectPerson,
  experiencerSubjects,
} from './types.js';
export type { Tense, Person, VerbKind, GNumber, VosRegion, SubjectGloss } from './types.js';
export {
  conjugate,
  isKnownVerb,
  verbInfo,
  parseInfinitive,
  canonicalInfinitive,
  parseEntry,
  canonicalEntry,
  lexiconInfinitives,
  lexiconEntries,
} from './conjugate.js';
export type { ParsedEntry } from './conjugate.js';
export { entryKind, entryLabel, cellsFor, personLabelFor, cueFor, subjectsFor, shortPersonLabelFor } from './entries.js';
export type { Cell } from './entries.js';
export { analyze, analyzeIgnoringAccents, warmUp } from './analyze.js';
export type { Analysis } from './analyze.js';
export {
  detectVerbs,
  dativeNote,
  impersonalNote,
  NOTE_GUSTAR,
  NOTE_HAY,
  NOTE_UNKNOWN,
  NOTE_WEATHER,
} from './detect.js';
export type { DeckCard, DetectedVerb } from './detect.js';
export { gradeTyped, foldAccents, normalizeAnswer, subjectPronounPerson, experiencerPerson } from './grade.js';
export type { Grade } from './grade.js';
export { distractors, regularizedVariants } from './distractors.js';
export type { DistractorOptions, RegularizedHow } from './distractors.js';
export {
  classifyMistake,
  classifyReading,
  mistakeGuideSections,
  mistakeKey,
  MISTAKE_KINDS,
} from './mistakes.js';
export type { Mistake, MistakeCell, MistakeDetail, MistakeKind, MistakeOptions, RegularizedChange } from './mistakes.js';
export { patternTags } from './pattern.js';
export type { PatternTag } from './pattern.js';
export { syllabify, attachEnclitic, prefixForm, stressIndex } from './accent.js';
export {
  LEXICON_INFINITIVES,
  REFLEXIVE_VERBS,
  GUSTAR_TYPE,
  DATIVE_VERBS,
  WEATHER_VERBS,
  IMPERSONAL_BASES,
} from './lexicon.js';

/** The conjugation models the dictionary uses, each with an example verb. */
export const MODELS: { id: string; example: string; description: string }[] = [
  { id: 'regular', example: 'hablar / comer / vivir', description: 'regular -ar, -er, -ir' },
  { id: 'c>qu', example: 'buscar', description: 'c becomes qu before e (busqué)' },
  { id: 'g>gu', example: 'llegar', description: 'g becomes gu before e (llegué)' },
  { id: 'z>c', example: 'empezar', description: 'z becomes c before e (empecé)' },
  { id: 'gu>gü', example: 'averiguar', description: 'gu becomes gü before e (averigüé)' },
  { id: 'c>z', example: 'vencer', description: 'c becomes z before a/o (venzo)' },
  { id: 'g>j', example: 'coger', description: 'g becomes j before a/o (cojo)' },
  { id: 'gu>g', example: 'distinguir', description: 'gu becomes g before a/o (distingo)' },
  { id: 'qu>c', example: 'delinquir', description: 'qu becomes c before a/o (delinco)' },
  { id: 'e>ie', example: 'pensar / entender', description: 'stressed e becomes ie (pienso); initial ye (yerro)' },
  { id: 'o>ue', example: 'contar / volver', description: 'stressed o becomes ue (cuento); initial hue (huelo); güe (avergüenzo)' },
  { id: 'u>ue', example: 'jugar', description: 'stressed u becomes ue (juego)' },
  { id: 'e>i', example: 'pedir', description: 'e becomes i (pido, pidió, pidiendo)' },
  { id: 'e>ie/i', example: 'sentir', description: 'e becomes ie when stressed, i in -ir weak forms (siento, sintió)' },
  { id: 'o>ue/u', example: 'dormir / morir', description: 'o becomes ue when stressed, u in -ir weak forms (duermo, durmió)' },
  { id: 'i>ie', example: 'adquirir', description: 'stressed i becomes ie (adquiero)' },
  { id: 'stressed í/ú', example: 'enviar / continuar / reunir / prohibir', description: 'the stem i/u carries the stress (envío, continúo, reúno, prohíbo)' },
  { id: 'c>zc', example: 'conocer / lucir', description: 'c becomes zc before a/o (conozco)' },
  { id: 'c>zc, preterite -uj-', example: 'conducir', description: 'conduzco, conduje, condujeron' },
  { id: '-uir: i>y', example: 'construir', description: 'y before a/e/o and in construyó, construyendo' },
  { id: 'vowel stem: i>y', example: 'leer / creer / poseer', description: 'leyó, leyeron, leyendo, leído, leíste' },
  { id: 'ñ/ll: -ió>-ó', example: 'gruñir / teñir', description: 'gruñó, gruñeron, gruñendo' },
  { id: 'irregular', example: 'ser, ir, estar, dar, ver, haber, saber, caber, tener, venir, poner, salir, hacer, decir, traer, caer, oír, valer, poder, querer, andar, reír, errar', description: 'own patch over the generator' },
  { id: 'compound', example: 'obtener (tener), prevenir (venir), predecir (decir), satisfacer (hacer), sonreír (reír)', description: 'base verb with a prefix, accents recomputed' },
];

/**
 * Every cell of an entry: tense → person → accepted forms (missing cells left
 * out). For a dative entry, `number` picks the singular (default) or plural
 * paradigm. vos cells only with `opts.vosRegion`, in that region's forms.
 */
export function paradigm(
  entry: string,
  number: GNumber = 'sg',
  opts: { vosRegion?: VosRegion | null } = {},
): Record<Tense, Partial<Record<Person, string[]>>> | null {
  if (!parseEntry(entry)) return null;
  const vosRegion = opts.vosRegion ?? undefined;
  const out = {} as Record<Tense, Partial<Record<Person, string[]>>>;
  for (const t of TENSES) {
    const row: Partial<Record<Person, string[]>> = {};
    for (const p of t.persons) {
      if (p === 'vos' && !vosRegion) continue;
      const forms = conjugate(entry, t.id, p, number, { vosRegion });
      if (forms) row[p] = forms;
    }
    out[t.id] = row;
  }
  return out;
}
