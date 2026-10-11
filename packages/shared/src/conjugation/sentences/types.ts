// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Shared types of the sentence engine: the deck settings it reads, the
 * subject and sentence shapes it produces, and the checker's verdicts.
 */
import type { DeckCard } from '../detect.js';
import type { GNumber, Person, Tense, VosRegion } from '../types.js';

/**
 * What the engine needs to know about a deck. `entries` are the drilled
 * entries (detected, minus excluded, plus extra), canonical ids. `cards` are
 * the deck's own cards, `earlierCards` those of the decks before it in the
 * same groups: together with the core list they are the vocabulary.
 * `approvedWords` are words the teacher allowed by hand (they get a gloss).
 */
export interface SentenceDeck {
  tenses: Tense[];
  vosotros: boolean;
  vos: VosRegion | null;
  entries: string[];
  cards: DeckCard[];
  earlierCards?: DeckCard[];
  approvedWords?: string[];
}

/** One drillable cell (same shape as entries.ts Cell). */
export interface SentenceCell {
  tense: Tense;
  person: Person;
  number?: GNumber;
}

/** Subject tags: which frames a subject suits (a baby does not work, a dog does not read). */
export type Tag =
  | 'person'
  | 'adult'
  | 'learner'
  | 'kid'
  | 'baby'
  | 'elder'
  | 'teacher'
  | 'server'
  | 'family'
  /** Parents and siblings: the speaker's own household ("Mi madre vive con mi familia" is odd). */
  | 'household'
  | 'animal'
  | 'thing';

/** Grammatical gender of a subject; 'x' when Spanish does not show it (yo, tú, usted, ustedes). */
export type Gender = 'm' | 'f' | 'x';

/** English person and number, which differ from the Spanish ones for usted / ustedes (you). */
export type EnPerson = '1sg' | '2' | '3sg' | '1pl' | '3pl';

/** How a subject was built, for the teacher's breakdown of person mistakes. */
export type SubjectKind =
  | 'pronoun'
  | 'name'
  | 'np_sg'
  | 'np_pl'
  | 'coord_yo'
  | 'coord_tu'
  | 'coord'
  | 'thing'
  | 'experiencer';

/** A parsed subject (or gustar experiencer, or thing subject). */
export interface ParsedSubject {
  /** The Spanish as written. */
  es: string;
  /** Every engine person the subject can be under the deck's settings (one, unless ambiguous). */
  persons: Person[];
  number: GNumber;
  gender: Gender;
  kind: SubjectKind;
  /** English noun phrase in subject position ("my cousins", "I", "Ana and you"). */
  en: string;
  enPerson: EnPerson;
  /** Union of the frames the subject suits; a coordination keeps only tags all members share. */
  tags: Tag[];
  /**
   * Noun lemmas, their kin keys (abuela → abuelo, mamá → padre) and names in it, so complements
   * do not repeat it ("Mi abuela vive con mi abuela", "Mi papá vive con mi padre").
   */
  lemmas: string[];
  /**
   * Who a possessive person noun phrase refers to, as kin key + gender ("mi mamá" → padre:f,
   * "mis abuelos" → abuelo:m and abuelo:f, since a masculine plural can include women). The
   * checker's sameReferent rule compares them with the complements'.
   */
  refs?: string[];
  /** True for a single pronoun. */
  pronoun?: boolean;
  /** The pronoun itself (yo, usted…), when `pronoun`. */
  pronounWord?: string;
}

/** The checker's rules. Each rejection names one. */
export type RuleCode =
  | 'blank'
  | 'cue'
  | 'notDrilled'
  | 'noSubject'
  | 'unknownSubject'
  | 'bannedSubject'
  | 'accent'
  | 'agreement'
  | 'person'
  | 'ambiguous'
  | 'experiencer'
  | 'thingLiked'
  | 'clitic'
  | 'impersonalSubject'
  | 'timeWord'
  | 'leak'
  | 'secondVerb'
  | 'vocabulary'
  | 'negativeCommand'
  | 'sameReferent'
  | 'possessive';

/** Warnings do not reject a sentence; the teacher sees them. */
export type WarningCode = 'noTimeWord' | 'approvedWord';

export interface Problem<C extends string = RuleCode> {
  rule: C;
  /** Plain English for the teacher. */
  message: string;
  /** The words concerned, when there are some. */
  words?: string[];
}

/** A candidate sentence: text around one blank, for one cell of one entry. */
export interface SentenceCandidate {
  entry: string;
  cell: SentenceCell;
  /** Text before the blank ("Mis primos"). */
  before: string;
  /** Text after the parentheses ("en Lima."). */
  after: string;
  /** What the parentheses show ("vivir"). Defaults to the entry's sentence verb. */
  cue?: string;
}

export interface Validation {
  ok: boolean;
  reasons: Problem[];
  warnings: Problem<WarningCode>[];
  /** The subject (or experiencer) the checker read, when it read one. */
  subject?: ParsedSubject;
  /** For dative entries: the number of the thing liked, when it read one. */
  thingNumber?: GNumber;
  /** The time words it found. */
  timeWords: string[];
  /** The engine's accepted forms for the cell (empty if the cell does not exist). */
  answers: string[];
}

/** A rendered built-in sentence. */
export interface RenderedSentence {
  entry: string;
  cell: SentenceCell;
  before: string;
  after: string;
  /** The parentheses ("vivir", "gustar", "llamarse", "haber"). */
  infinitiveCue: string;
  /** The engine's accepted forms; answers[0] is the one the feedback shows. */
  answers: string[];
  /** English for the feedback after the answer; null when the tense has no English template. */
  english: string | null;
  /** The subject's stable id (pr:yo, np:mis-primos, co:ana-y-luis, ex:a-mi-abuela, th:el-cafe), or null (hay). */
  subjectId: string | null;
  subjectKind: SubjectKind | null;
  /** Stable id for frame + subject + complements + tense: tpl:vivir.city/np:mis-primos/city=lima/present */
  sentenceRef: string;
  /** Frame id (vivir.city). */
  frameId: string;
  /** The time word added for a multi-tense deck, if any. */
  timeWord?: string;
}
