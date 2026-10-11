// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Which parts of the guide a student sees: a chapter is open when its
 * condition holds and at least one of its sections is; a section when its
 * own condition holds. Conditions read the deck's settings and verbs and the
 * rungs the student has answered at (GuideContext).
 */
import { patternTags, type Tense, type VerbKind } from '@libresrs/shared/conjugation';
import type { Chapter, Condition, GuideContext, Rung, Section, VerbPattern } from './types';

const RUNG_ORDER: readonly Rung[] = ['choice', 'typed-lenient', 'typed-strict'];

/** Whether a verb's tags in a tense include a pattern ("stem" is any stem change). */
function hasPattern(tags: readonly VerbPattern[] | undefined, pattern: VerbPattern): boolean {
  if (!tags) return false;
  return pattern === 'stem' ? tags.some((t) => t.startsWith('stem:')) : tags.includes(pattern);
}

/**
 * The deck's verbs that show a pattern in a tense (every verb with the tense when no pattern), optionally
 * of one kind. With no tense, every verb of the deck (of the kind): what it does in no tense in particular.
 */
export function verbsWith(ctx: GuideContext, tense: Tense | undefined, pattern?: VerbPattern, kind?: VerbKind): GuideContext['verbs'] {
  if (tense === undefined) return ctx.verbs.filter((v) => !kind || v.kind === kind);
  if (!ctx.tenses.includes(tense)) return [];
  return ctx.verbs.filter((v) => {
    if (kind && v.kind !== kind) return false;
    const tags = v.patterns[tense];
    if (!tags || tags.length === 0) return false;
    return pattern ? hasPattern(tags, pattern) : true;
  });
}

/**
 * A rung is reached when the deck's ladder goes that far (has it or a rung
 * above it: typing is typing whether accents count or not) and the student has
 * answered there or higher, or the ladder starts there or higher: a deck that
 * types from the first question needs no climbing.
 */
function reached(ctx: GuideContext, rung: Rung): boolean {
  const rank = RUNG_ORDER.indexOf(rung);
  const ranks = ctx.levels.map((l) => RUNG_ORDER.indexOf(l));
  if (ranks.length === 0 || Math.max(...ranks) < rank) return false;
  if (ranks[0] >= rank) return true;
  return ctx.reached.some((r) => RUNG_ORDER.indexOf(r) >= rank);
}

export function holds(c: Condition | undefined, ctx: GuideContext): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every((x) => holds(x, ctx));
  if ('any' in c) return c.any.some((x) => holds(x, ctx));
  if ('not' in c) return !holds(c.not, ctx);
  if ('pattern' in c) return verbsWith(ctx, c.tense, c.pattern).length > 0;
  if ('tense' in c) return ctx.tenses.includes(c.tense);
  // Only a verb the quiz asks counts: one with a form in some drilled tense (hay and gustarle have no command, hay no progressive).
  if ('kind' in c) return ctx.verbs.some((v) => v.kind === c.kind && Object.values(v.patterns).some((tags) => !!tags && tags.length > 0));
  if ('verb' in c) return ctx.verbs.some((v) => v.entry === c.verb);
  if ('vosotros' in c) return ctx.includeVosotros === c.vosotros;
  if ('vos' in c) return (ctx.vos !== null) === c.vos;
  if ('direction' in c) return ctx.directions === 'both' || ctx.directions === c.direction;
  if ('multipleTenses' in c) return (ctx.tenses.length > 1) === c.multipleTenses;
  if ('reached' in c) return reached(ctx, c.reached);
  if ('ladderHas' in c) return ctx.levels.includes(c.ladderHas);
  if ('accentsFromStart' in c) return (ctx.accentMode === 'required') === c.accentsFromStart;
  if ('sentenceSeen' in c) return !!ctx.sentenceSeen === c.sentenceSeen;
  return false;
}

export interface OpenChapter {
  chapter: Chapter;
  /** Its sections a student sees now. */
  sections: Section[];
  /** Its sections a student does not see now (for a teacher's "show everything"). */
  closed: Section[];
}

/** The chapters a student sees, in order, each with the sections open to them. With `everything`, every chapter, closed parts too. */
export function openChapters(chapters: readonly Chapter[], ctx: GuideContext, everything = false): OpenChapter[] {
  const out: OpenChapter[] = [];
  for (const chapter of chapters) {
    const chapterOpen = holds(chapter.when, ctx);
    const sections = chapterOpen ? chapter.sections.filter((s) => holds(s.when, ctx)) : [];
    const closed = chapter.sections.filter((s) => !sections.includes(s));
    if (sections.length > 0 || everything) out.push({ chapter, sections, closed });
  }
  return out;
}

/** The deck's verbs, tagged with how each behaves in each drilled tense. */
export function guideVerbs(verbs: readonly { entry: string; label: string; kind: VerbKind }[], tenses: readonly Tense[]): GuideContext['verbs'] {
  return verbs.map((v) => ({
    entry: v.entry,
    label: v.label,
    kind: v.kind,
    patterns: Object.fromEntries(tenses.map((t) => [t, patternTags(v.entry, t) as VerbPattern[]])),
  }));
}
