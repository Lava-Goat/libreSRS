// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Sentences with a blank for the conjugator: built-in frames,
 * subjects from the deck's own nouns, the engine fills the blank, and one
 * deterministic checker for built-in, AI and teacher-edited sentences.
 * See README.md in this folder.
 */
export type {
  SentenceDeck,
  SentenceCell,
  SentenceCandidate,
  RenderedSentence,
  Validation,
  Problem,
  RuleCode,
  WarningCode,
  ParsedSubject,
  SubjectKind,
  Tag,
  Gender,
  EnPerson,
} from './types.js';
export { validate, validateText, splitSentence, sentenceVerb } from './validate.js';
export { renderCandidates, sentencePool, pickSentence, filledIn, coverage } from './render.js';
export { parseSubject, parseExperiencer, subjectBank, experiencerBank } from './subjects.js';
export type { BankSubject } from './subjects.js';
export { TIME_WORDS, findTimeWords, timeWordFits, chooseTimeWord } from './cues.js';
export type { TimeWord } from './cues.js';
export { FRAMES, FRAMES_BY_ENTRY, framedEntries } from './frames.js';
export type { Frame } from './frames.js';
export { deckContext, wordStatus, unknownWords, frontWords, lookupKeys } from './vocab.js';
export type { DeckContext } from './vocab.js';
export { CORE_WORDS, NAMES, CITIES } from './words.js';
export { tokenize, fold, tidy, capitalize } from './text.js';
export type { Token } from './text.js';
