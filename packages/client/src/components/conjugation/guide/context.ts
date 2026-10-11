// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What the guide reads of a quiz and a student (GuideContext), from a deck's
 * overview (conjugation.overview) or, since v1.18.0, "Study all"'s
 * (conjugation.studyAllOverview: every quiz's settings merged on the server,
 * every tense, vos and vosotros if any deck has them), plus the rungs reached
 * since it was fetched.
 */
import type { Tense, VosRegion } from '@libresrs/shared/conjugation';
import type { GuideContext, Rung, SubjectMet } from './types';

/** The fields of an overview the guide reads. */
export interface GuideSource {
  tenses: readonly { id: Tense }[];
  includeVosotros: boolean;
  vos: VosRegion | 'none';
  directions: GuideContext['directions'];
  accentMode: GuideContext['accentMode'];
  levels: readonly Rung[];
  reachedRungs: readonly Rung[];
  /** v1.25.0: the student has met a sentence prompt, and its subjects (absent from an older server). */
  sentenceSeen?: boolean;
  subjectsMet?: readonly SubjectMet[];
}

/** What the runner saw in this visit (v1.25.0): sentences answered since the overview was fetched, and their subjects. */
export interface LiveSentences {
  seen: boolean;
  subjects: readonly SubjectMet[];
}

/** The subjects met, newest first: this visit's, then the overview's, each once. */
export function mergeSubjects(live: readonly SubjectMet[], fetched: readonly SubjectMet[] = [], limit = 10): SubjectMet[] {
  const out: SubjectMet[] = [];
  for (const s of [...live, ...fetched]) {
    if (!out.some((x) => x.es.toLowerCase() === s.es.toLowerCase())) out.push({ es: s.es, pronoun: s.pronoun, person: s.person });
  }
  return out.slice(0, limit);
}

export function guideContext(overview: GuideSource, verbs: GuideContext['verbs'], rungs: readonly Rung[], live?: LiveSentences): GuideContext {
  return {
    tenses: overview.tenses.map((t) => t.id),
    includeVosotros: overview.includeVosotros,
    vos: overview.vos === 'none' ? null : overview.vos,
    directions: overview.directions,
    accentMode: overview.accentMode,
    levels: [...overview.levels],
    reached: [...new Set([...overview.reachedRungs, ...rungs])],
    verbs,
    sentenceSeen: !!overview.sentenceSeen || !!live?.seen,
    subjectsMet: mergeSubjects(live?.subjects ?? [], overview.subjectsMet ?? []),
  };
}
