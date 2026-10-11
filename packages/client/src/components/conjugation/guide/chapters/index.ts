// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** Every chapter of the guide, in CHAPTER_ORDER. Each file holds the chapters one author wrote. */
import { CHAPTER_ORDER, type Chapter } from '../types';
import basics from './basics';
import quiz from './quiz';
import present from './present';
import verbKinds from './verbKinds';
import progressivePast from './progressivePast';
import commandsFuture from './commandsFuture';
import perfectSubjunctive from './perfectSubjunctive';

const written: Chapter[] = [...basics, ...quiz, ...present, ...verbKinds, ...progressivePast, ...commandsFuture, ...perfectSubjunctive];

export const CHAPTERS: Chapter[] = CHAPTER_ORDER
  .map((id) => written.find((chapter) => chapter.id === id))
  .filter((chapter): chapter is Chapter => chapter !== undefined);

/** Chapters written but not in CHAPTER_ORDER (a typo in an id): the tests catch them. */
export const STRAY_CHAPTERS: Chapter[] = written.filter((chapter) => !(CHAPTER_ORDER as readonly string[]).includes(chapter.id));

/** Every chapter as written, duplicates included, for the tests. */
export const WRITTEN_CHAPTERS: readonly Chapter[] = written;
