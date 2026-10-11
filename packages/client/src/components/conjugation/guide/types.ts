// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The "Intro to conjugation" guide: chapters of short sections that open up
 * as they become relevant to a student. What a deck drills (its tenses, the
 * kinds of verb it has, vosotros and vos, the verbs themselves) decides which
 * grammar a student sees; how far the student has climbed the answer ladder
 * decides which parts about typing and accents they see.
 *
 * Content is data: every chapter lives in ./chapters as a Chapter, in English
 * and Spanish. Forms in examples are checked against the conjugation engine
 * (guide.test.ts), and tables are drawn by the engine itself, so neither can
 * teach a form the quiz would mark wrong.
 */
import type { GNumber, Person, Tense, VerbKind, VosRegion } from '@libresrs/shared/conjugation';

/**
 * Text in English and Spanish. Other locales read the English.
 *
 * Markup, the only markup: `*…*` marks Spanish words inside the text (shown
 * bold, with lang="es"). Only Spanish goes in stars; English glosses go in
 * quotes: "the dictionary form (*hablar*) means “to speak”". In the Spanish
 * text, star only the forms being taught. A literal asterisk cannot be
 * written. Paragraph breaks are separate blocks.
 */
export interface L {
  en: string;
  es: string;
}

/**
 * A form an example teaches, checked by guide.test.ts: the starred text of the
 * example, lowercased, must be one of conjugate(entry, tense, person, number,
 * { vosRegion }). Forms are whole cells as the engine gives them: "me llamo",
 * "me gusta", "he hablado", "estoy hablando", "no hables", "siéntate", "hay".
 */
export interface FormCheck {
  /** Engine entry id: "hablar", "llamarse", "gustarle", "haber-impersonal", "llover". */
  entry: string;
  tense: Tense;
  /** "el" is él / ella / usted, "ellos" is ellos / ellas / ustedes. Impersonal entries: "el". */
  person: Person;
  /** Dative entries only: the number of the thing liked (me gusta = sg, me gustan = pl). */
  number?: GNumber;
  /** vos forms only. */
  vosRegion?: VosRegion;
}

export interface Example {
  /** The Spanish sentence, with each taught form in stars: "Yo *hablo* inglés." */
  es: string;
  /** Its English meaning, shown under it in every locale. */
  en: string;
  /** One check per starred span, in order. Omit only for an example with no starred span. */
  check?: FormCheck[];
}

/**
 * How a verb behaves in one tense, as the engine sees it (patternTags in
 * @libresrs/shared/conjugation): regular; only spelling changes (busqué);
 * a stem change (quiero: "stem:e>ie"); an irregular yo form only (tengo,
 * veo); irregular beyond that (soy, eres; voy, vas; estoy, estás). A verb
 * can have several: tener in the present is "stem:e>ie" and "yo".
 */
export type VerbPattern =
  | 'regular'
  | 'spelling'
  | 'yo'
  | 'irregular'
  /** A compound tense whose past participle is irregular (hecho, visto, escrito). */
  | 'participle'
  /** A stressed stem i / u written with an accent (envío, continúo, reúno). */
  | 'accent'
  /** An -uir verb's added y (construyo). */
  | 'y'
  | 'stem'
  | 'stem:e>ie'
  | 'stem:o>ue'
  | 'stem:u>ue'
  | 'stem:e>i'
  | 'stem:o>u'
  | 'stem:i>ie';

/** A rung of the answer ladder a student can reach. */
export type Rung = 'choice' | 'typed-lenient' | 'typed-strict';

/**
 * When a chapter or section applies. A chapter with no `when` is always
 * there; a section with no `when` is there whenever its chapter is.
 */
export type Condition =
  /** The deck drills this tense. */
  | { tense: Tense }
  /** The deck has a verb of this kind (pronominal: -se verbs; dative: gustarle; impersonal: hay, llueve). */
  | { kind: VerbKind }
  /** The deck has this entry, by engine id ("ser", "gustarle", "haber-impersonal"). */
  | { verb: string }
  /** A verb of the deck shows this pattern in this tense ("stem" matches every stem change). */
  | { pattern: VerbPattern; tense: Tense }
  /** The deck drills vosotros (true) or leaves it out (false). */
  | { vosotros: boolean }
  /** The deck drills vos (true) or leaves it out (false). */
  | { vos: boolean }
  /** The deck asks this way: toForm (give the form: "yo (tener)" → tengo) or fromForm (name it: tengo → tener · yo). */
  | { direction: 'toForm' | 'fromForm' }
  /** The deck drills more than one tense, so naming a form also asks its tense. */
  | { multipleTenses: boolean }
  /**
   * The deck's ladder goes this far (has this rung or one above it), and the student has answered
   * there or higher (in any deck), or the ladder starts there or higher. So "typed-lenient" means
   * "types answers", accents forgiven or not; "typed-strict" means "accents count".
   */
  | { reached: Rung }
  /** The deck's ladder has this rung (whether or not the student has got there). */
  | { ladderHas: Rung }
  /** The deck's accents count from the first question (accent mode "required"). */
  | { accentsFromStart: boolean }
  /** The student has met a question shown as a sentence with a blank (v1.25.0), in any deck. */
  | { sentenceSeen: boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** A table the engine fills in. */
export interface ParadigmBlock {
  kind: 'paradigm';
  tense: Tense;
  /** Engine entry ids, one column each: ["hablar", "comer", "vivir"]. */
  entries: string[];
  /**
   * What to shade: "ending" shades what changes (the ending of a simple tense,
   * the helping verb of a compound one, the whole form of an irregular one);
   * "none" shades nothing. Default "ending".
   */
  shade?: 'ending' | 'none';
  caption?: L;
}

/** The deck's own verbs that show a pattern in a tense: "In this deck: querer, tener." Hidden when there are none. */
export interface DeckVerbsBlock {
  kind: 'deckVerbs';
  /** The tense the verbs are listed (and drawn) in. Omit to list the deck's verbs of a kind whatever it drills (no pattern, no tables then). */
  tense?: Tense;
  /** Omit for every verb of the deck that has this tense (kind still filters). Needs a tense. */
  pattern?: VerbPattern;
  /** Only verbs of this kind. */
  verbKind?: VerbKind;
  /** The lead-in, before the list: "In this deck:". */
  text: L;
  /** Also draw the listed verbs' tables in this tense (three verbs to a table, so it fits a phone). */
  withTables?: boolean;
}

/** A drawing of part of the quiz screen, with numbered labels; the guide draws it to match the deck's settings. */
export interface FigureBlock {
  kind: 'figure';
  /**
   * formIt: a "give the form" question (tense, who, dictionary form, the cue of a gustar-type verb);
   * nameIt: a "name the verb" question, always multiple choice (the form, options naming the verb and who,
   *   and the tense in each when the deck drills more than one);
   * ladder: the rungs this deck uses, in order;
   * verdicts: the four kinds of answer message.
   */
  figure: 'formIt' | 'nameIt' | 'ladder' | 'verdicts';
  caption?: L;
}

/**
 * The subjects of the student's own sentences (v1.25.0) and who each one is: "mis primos → ellos →
 * viven". Built from GuideContext.subjectsMet; a teacher's "show everything" with none met shows examples.
 */
export interface SubjectsBlock {
  kind: 'subjects';
  /** The verb whose present-tense form the third column shows ("vivir"). */
  verb: string;
  caption?: L;
}

export type Block =
  | { kind: 'p'; text: L }
  /** A bulleted list. */
  | { kind: 'list'; items: L[] }
  /** A highlighted aside: a tip, a trap, a memory trick. */
  | { kind: 'tip'; text: L }
  | { kind: 'examples'; items: Example[] }
  /** A two-column comparison (preterite vs imperfect, ser vs estar): each row is a pair of cells. */
  | { kind: 'compare'; head: [L, L]; rows: [L, L][] }
  | ParadigmBlock
  | DeckVerbsBlock
  | FigureBlock
  | SubjectsBlock;

export interface Section {
  /** Unique across the whole guide, kebab-case: "present-regular", "dative-cue". Seen-state is kept by id. */
  id: string;
  title: L;
  when?: Condition;
  blocks: Block[];
  /** Kept to a sentence or two: the part a student should not skip. */
  keyIdea?: L;
}

export interface Chapter {
  /** One of CHAPTER_ORDER. */
  id: ChapterId;
  title: L;
  /** One line, for the table of contents. */
  summary: L;
  /** Tense chapters: the tense(s) they teach; the chapter is there when the deck drills any of them. */
  when?: Condition;
  sections: Section[];
}

/** Every chapter, in the order a student meets them. */
export const CHAPTER_ORDER = [
  'basics',
  'persons',
  'quiz',
  'present',
  'pronominal',
  'dative',
  'impersonal',
  'presentProgressive',
  'preterite',
  'imperfect',
  'commands',
  'future',
  'conditional',
  'perfect',
  'subjunctive',
] as const;

export type ChapterId = (typeof CHAPTER_ORDER)[number];

/** Where a deck's settings and a student's progress stand, for deciding what the guide shows. */
export interface GuideContext {
  tenses: Tense[];
  includeVosotros: boolean;
  vos: VosRegion | null;
  directions: 'toForm' | 'fromForm' | 'both';
  accentMode: 'progressive' | 'forgiven' | 'required';
  /** The deck's ladder, in order. */
  levels: Rung[];
  /** The rungs the student has answered at, in any deck. */
  reached: Rung[];
  /** The deck's verbs: engine entry id, kind, and each drilled tense's pattern tags. */
  verbs: { entry: string; label: string; kind: VerbKind; patterns: Partial<Record<Tense, VerbPattern[]>> }[];
  /** The student has met a question shown as a sentence (v1.25.0); absent: not yet. */
  sentenceSeen?: boolean;
  /** The subjects of the student's sentences, most recent first (v1.25.0), for the "subjects" block. */
  subjectsMet?: SubjectMet[];
}

/** A subject the student met in a sentence (v1.25.0): as written, the pronoun it stands for, its person. */
export interface SubjectMet {
  es: string;
  /** "ellos" for "mis primos"; null for a subject that is a pronoun itself ("ustedes"). */
  pronoun: string | null;
  person: Person;
}

/** The chapter that teaches a tense. */
export function chapterForTense(tense: Tense): ChapterId {
  switch (tense) {
    case 'imperativeAffirmative':
    case 'imperativeNegative':
      return 'commands';
    case 'presentPerfect':
    case 'pluperfect':
      return 'perfect';
    case 'presentSubjunctive':
    case 'imperfectSubjunctive':
      return 'subjunctive';
    default:
      return tense;
  }
}
