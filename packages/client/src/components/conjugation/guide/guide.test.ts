// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The guide's content, checked as data: every text in both languages, stars
 * balanced, ids unique, conditions that name real tenses, kinds and verbs,
 * and every form an example teaches one the conjugation engine (and so the
 * quiz) accepts.
 */
import { describe, expect, it } from 'vitest';
import { TENSE_IDS, conjugate, isPerson, isTense, parseEntry, type Tense } from '@libresrs/shared/conjugation';
import { CHAPTERS, STRAY_CHAPTERS, WRITTEN_CHAPTERS } from './chapters';
import { CHAPTER_ORDER, type Block, type Condition, type Example, type L, type Section } from './types';

const KINDS = ['plain', 'pronominal', 'dative', 'impersonal'];
const PATTERNS = ['regular', 'spelling', 'yo', 'irregular', 'participle', 'accent', 'y', 'stem', 'stem:e>ie', 'stem:o>ue', 'stem:u>ue', 'stem:e>i', 'stem:o>u', 'stem:i>ie'];
const RUNGS = ['choice', 'typed-lenient', 'typed-strict'];

/** Every L in a block, with where it is. */
function textsOf(block: Block): L[] {
  switch (block.kind) {
    case 'p':
    case 'tip':
      return [block.text];
    case 'list':
      return block.items;
    case 'compare':
      return [...block.head, ...block.rows.flat()];
    case 'paradigm':
    case 'figure':
      return block.caption ? [block.caption] : [];
    case 'deckVerbs':
      return [block.text];
    case 'subjects':
      return block.caption ? [block.caption] : [];
    case 'examples':
      return [];
  }
}

function allSections(): { chapter: string; section: Section }[] {
  return WRITTEN_CHAPTERS.flatMap((chapter) => chapter.sections.map((section) => ({ chapter: chapter.id, section })));
}

function allTexts(): { where: string; text: L }[] {
  const out: { where: string; text: L }[] = [];
  for (const chapter of WRITTEN_CHAPTERS) {
    out.push({ where: `${chapter.id} title`, text: chapter.title }, { where: `${chapter.id} summary`, text: chapter.summary });
    for (const section of chapter.sections) {
      out.push({ where: `${section.id} title`, text: section.title });
      if (section.keyIdea) out.push({ where: `${section.id} keyIdea`, text: section.keyIdea });
      section.blocks.forEach((block, i) => {
        for (const text of textsOf(block)) out.push({ where: `${section.id} block ${i} (${block.kind})`, text });
      });
    }
  }
  return out;
}

function allExamples(): { where: string; example: Example }[] {
  return allSections().flatMap(({ section }) => section.blocks.flatMap((block, i) => (
    block.kind === 'examples' ? block.items.map((example) => ({ where: `${section.id} block ${i}`, example })) : []
  )));
}

/** The starred spans of a text, in order. */
const starred = (text: string): string[] => [...text.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]);

/** Problems with a condition; [] when it is sound. */
function conditionProblems(c: Condition, where: string): string[] {
  const out: string[] = [];
  const keys = Object.keys(c);
  if (keys.length === 0) return [`${where}: empty condition`];
  if ('all' in c) return c.all.flatMap((x) => conditionProblems(x, where));
  if ('any' in c) return c.any.flatMap((x) => conditionProblems(x, where));
  if ('not' in c) return conditionProblems(c.not, where);
  if ('pattern' in c) {
    if (!PATTERNS.includes(c.pattern)) out.push(`${where}: unknown pattern ${c.pattern}`);
    if (!isTense(c.tense)) out.push(`${where}: unknown tense ${String(c.tense)}`);
    return out;
  }
  if ('tense' in c && !isTense(c.tense)) out.push(`${where}: unknown tense ${String(c.tense)}`);
  if ('kind' in c && !KINDS.includes(c.kind)) out.push(`${where}: unknown kind ${String(c.kind)}`);
  if ('verb' in c && parseEntry(c.verb)?.id !== c.verb) out.push(`${where}: "${c.verb}" is not an engine entry id`);
  if ('reached' in c && !RUNGS.includes(c.reached)) out.push(`${where}: unknown rung ${String(c.reached)}`);
  if ('ladderHas' in c && !RUNGS.includes(c.ladderHas)) out.push(`${where}: unknown rung ${String(c.ladderHas)}`);
  if ('direction' in c && c.direction !== 'toForm' && c.direction !== 'fromForm') out.push(`${where}: unknown direction`);
  return out;
}

describe('guide content', () => {
  it('writes only chapters of CHAPTER_ORDER, each once', () => {
    expect(STRAY_CHAPTERS.map((c) => c.id)).toEqual([]);
    const ids = WRITTEN_CHAPTERS.map((c) => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(CHAPTERS.map((c) => c.id)).toEqual(CHAPTER_ORDER.filter((id) => ids.includes(id)));
  });

  it('gives every section a unique kebab-case id', () => {
    const ids = allSections().map(({ section }) => section.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
  });

  it('gives every chapter at least one section and every section at least one block', () => {
    expect(WRITTEN_CHAPTERS.filter((c) => c.sections.length === 0).map((c) => c.id)).toEqual([]);
    expect(allSections().filter(({ section }) => section.blocks.length === 0).map(({ section }) => section.id)).toEqual([]);
  });

  it('writes every text in English and Spanish, with balanced stars and no leftover markup', () => {
    const problems: string[] = [];
    for (const { where, text } of allTexts()) {
      for (const lang of ['en', 'es'] as const) {
        const s = text[lang];
        if (typeof s !== 'string' || s.trim() === '') problems.push(`${where}: empty ${lang}`);
        else {
          if ((s.match(/\*/g) ?? []).length % 2 !== 0) problems.push(`${where}: unbalanced * in ${lang}`);
          if (/\*\*/.test(s) || starred(s).some((span) => span !== span.trim())) problems.push(`${where}: empty or padded star span in ${lang}`);
          if (/<[a-z/][^>]*>|\[[^\]]*\]\(|__|`/i.test(s)) problems.push(`${where}: HTML or markdown in ${lang}: ${s}`);
          if (s !== s.trim()) problems.push(`${where}: stray whitespace in ${lang}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('checks every starred form of every example against the engine', () => {
    const problems: string[] = [];
    for (const { where, example } of allExamples()) {
      const spans = starred(example.es);
      const checks = example.check ?? [];
      if (!example.en.trim()) problems.push(`${where}: "${example.es}" has no English`);
      if ((example.es.match(/\*/g) ?? []).length % 2 !== 0) problems.push(`${where}: unbalanced * in "${example.es}"`);
      if (spans.length !== checks.length) {
        problems.push(`${where}: "${example.es}" has ${spans.length} starred span(s) and ${checks.length} check(s)`);
        continue;
      }
      spans.forEach((span, i) => {
        const c = checks[i];
        if (!isTense(c.tense) || !isPerson(c.person) || !parseEntry(c.entry)) {
          problems.push(`${where}: bad check ${JSON.stringify(c)}`);
          return;
        }
        const forms = conjugate(c.entry, c.tense, c.person, c.number, c.vosRegion ? { vosRegion: c.vosRegion } : undefined) ?? [];
        const given = span.normalize('NFC').toLowerCase().replace(/^[¡¿]+|[!?.,;:]+$/g, '').trim();
        if (!forms.map((f) => f.normalize('NFC').toLowerCase()).includes(given)) {
          problems.push(`${where}: "${span}" is not ${c.entry} · ${c.tense} · ${c.person}${c.number ? ` · ${c.number}` : ''} (engine: ${forms.join(' / ') || 'none'})`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('draws tables only of entries the engine can conjugate in that tense', () => {
    const problems: string[] = [];
    for (const { section } of allSections()) {
      for (const block of section.blocks) {
        if (block.kind === 'paradigm') {
          if (!isTense(block.tense)) problems.push(`${section.id}: unknown tense ${String(block.tense)}`);
          if (block.entries.length === 0 || block.entries.length > 4) problems.push(`${section.id}: a table has 1–4 columns`);
          for (const entry of block.entries) {
            if (parseEntry(entry)?.id !== entry) problems.push(`${section.id}: "${entry}" is not an engine entry id`);
            else if (!conjugate(entry, block.tense, block.tense.startsWith('imperative') ? 'tu' : 'el')) {
              problems.push(`${section.id}: ${entry} has no ${block.tense}`);
            }
          }
        }
        if (block.kind === 'deckVerbs') {
          if (block.tense !== undefined && !isTense(block.tense)) problems.push(`${section.id}: unknown tense ${String(block.tense)}`);
          if ((block.pattern || block.withTables) && block.tense === undefined) problems.push(`${section.id}: a pattern or tables need a tense`);
          if (block.pattern && !PATTERNS.includes(block.pattern)) problems.push(`${section.id}: unknown pattern ${block.pattern}`);
          if (block.verbKind && !KINDS.includes(block.verbKind)) problems.push(`${section.id}: unknown kind ${block.verbKind}`);
        }
        if (block.kind === 'figure' && !['formIt', 'nameIt', 'ladder', 'verdicts'].includes(block.figure)) {
          problems.push(`${section.id}: unknown figure ${String(block.figure)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('writes conditions that name real tenses, kinds, verbs, patterns and rungs', () => {
    const problems: string[] = [];
    for (const chapter of WRITTEN_CHAPTERS) {
      if (chapter.when) problems.push(...conditionProblems(chapter.when, chapter.id));
      for (const section of chapter.sections) {
        if (section.when) problems.push(...conditionProblems(section.when, section.id));
      }
    }
    expect(problems).toEqual([]);
  });

  it('teaches with gustar that the person picks its pronoun (me, te, le, nos, les), not only le or les', () => {
    const gustar = allSections().find((x) => x.section.id === 'persons-who-subject-gustar')!.section;
    const text = gustar.blocks.flatMap(textsOf).map((l) => l.en).join(' ') + gustar.keyIdea!.en;
    for (const pronoun of ['me', 'te', 'le', 'nos', 'les']) expect(text).toContain(`*${pronoun}*`);
    // "A mi amigo y a mí": more than one person, and nos, not les.
    const examples = gustar.blocks.flatMap((b) => (b.kind === 'examples' ? b.items : []));
    expect(examples.some((e) => e.check?.some((c) => c.person === 'nosotros'))).toBe(true);
  });

  it('knows every tense the engine has', () => {
    // A tense added to the engine needs a chapter that teaches it (and a `when` naming it).
    const taught = new Set<Tense>();
    const visit = (c: Condition | undefined) => {
      if (!c) return;
      if ('all' in c) c.all.forEach(visit);
      else if ('any' in c) c.any.forEach(visit);
      else if ('tense' in c && !('pattern' in c)) taught.add(c.tense);
    };
    WRITTEN_CHAPTERS.forEach((chapter) => visit(chapter.when));
    const missing = TENSE_IDS.filter((t) => !taught.has(t));
    // Only enforced once every chapter is written (see "every chapter is written").
    if (CHAPTERS.length === CHAPTER_ORDER.length) expect(missing).toEqual([]);
  });
});
