// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import type { Tense, VerbKind } from '@libresrs/shared/conjugation';
import { guideVerbs, holds, openChapters, verbsWith } from './unlock';
import type { Chapter, GuideContext, Rung } from './types';

const UNIT_1: { entry: string; label: string; kind: VerbKind }[] = [
  { entry: 'ser', label: 'ser', kind: 'plain' },
  { entry: 'haber-impersonal', label: 'haber', kind: 'impersonal' },
  { entry: 'estar', label: 'estar', kind: 'plain' },
  { entry: 'tener', label: 'tener', kind: 'plain' },
  { entry: 'llamarse', label: 'llamarse', kind: 'pronominal' },
  { entry: 'querer', label: 'querer', kind: 'plain' },
  { entry: 'ir', label: 'ir', kind: 'plain' },
  { entry: 'gustarle', label: 'gustarle', kind: 'dative' },
];

function ctx(over: Partial<GuideContext> = {}, verbs = UNIT_1): GuideContext {
  const tenses: Tense[] = over.tenses ?? ['present'];
  return {
    tenses,
    includeVosotros: false,
    vos: null,
    directions: 'both',
    accentMode: 'progressive',
    levels: ['choice', 'typed-lenient', 'typed-strict'],
    reached: [],
    verbs: guideVerbs(verbs, tenses),
    ...over,
  };
}

describe('what the deck drills', () => {
  it('opens tense, kind and verb parts only for what the deck has', () => {
    const unit1 = ctx();
    expect(holds({ tense: 'present' }, unit1)).toBe(true);
    expect(holds({ tense: 'preterite' }, unit1)).toBe(false);
    expect(holds({ kind: 'dative' }, unit1)).toBe(true);
    expect(holds({ kind: 'impersonal' }, unit1)).toBe(true);
    expect(holds({ verb: 'ser' }, unit1)).toBe(true);
    expect(holds({ verb: 'vivir' }, unit1)).toBe(false);
    expect(holds({ all: [{ verb: 'ser' }, { verb: 'estar' }] }, unit1)).toBe(true);
    expect(holds({ any: [{ verb: 'vivir' }, { verb: 'ir' }] }, unit1)).toBe(true);
    expect(holds({ not: { vosotros: true } }, unit1)).toBe(true);
    expect(holds({ multipleTenses: false }, unit1)).toBe(true);
    expect(holds({ multipleTenses: true }, ctx({ tenses: ['present', 'preterite'] }))).toBe(true);
  });

  it('knows the patterns of the deck’s verbs, tense by tense', () => {
    const unit1 = ctx();
    // tener and querer change their stem vowel (e>ie); ser, estar, ir are irregular; tener's yo is its own.
    expect(verbsWith(unit1, 'present', 'stem').map((v) => v.entry).sort()).toEqual(['querer', 'tener']);
    expect(verbsWith(unit1, 'present', 'stem:e>ie').map((v) => v.entry).sort()).toEqual(['querer', 'tener']);
    expect(holds({ pattern: 'stem:o>ue', tense: 'present' }, unit1)).toBe(false);
    expect(holds({ pattern: 'yo', tense: 'present' }, unit1)).toBe(true);
    expect(verbsWith(unit1, 'present', 'irregular').map((v) => v.entry)).toEqual(expect.arrayContaining(['ser', 'estar', 'ir']));
    // A tense the deck does not drill has no verbs, whatever they would do in it.
    expect(holds({ pattern: 'irregular', tense: 'preterite' }, unit1)).toBe(false);
    expect(verbsWith(unit1, 'present', undefined, 'pronominal').map((v) => v.entry)).toEqual(['llamarse']);
    const unit2 = ctx({}, [{ entry: 'verse', label: 'verse', kind: 'pronominal' }, { entry: 'vivir', label: 'vivir', kind: 'plain' }]);
    expect(verbsWith(unit2, 'present', 'regular').map((v) => v.entry)).toEqual(['vivir']);
    expect(verbsWith(unit2, 'present', 'yo').map((v) => v.entry)).toEqual(['verse']);
  });

  it('reads the deck’s persons and directions', () => {
    expect(holds({ vos: true }, ctx({ vos: 'rioplatense' }))).toBe(true);
    expect(holds({ vos: false }, ctx())).toBe(true);
    expect(holds({ vosotros: true }, ctx({ includeVosotros: true }))).toBe(true);
    expect(holds({ direction: 'toForm' }, ctx())).toBe(true);
    expect(holds({ direction: 'fromForm' }, ctx())).toBe(true);
    expect(holds({ direction: 'fromForm' }, ctx({ directions: 'toForm' }))).toBe(false);
  });
});

describe('what the student has reached', () => {
  const at = (levels: Rung[], reached: Rung[], rung: Rung) => holds({ reached: rung }, ctx({ levels, reached }));
  const full: Rung[] = ['choice', 'typed-lenient', 'typed-strict'];

  it('opens typing, then accents, as the student climbs the default ladder', () => {
    expect(at(full, [], 'choice')).toBe(true);
    expect(at(full, [], 'typed-lenient')).toBe(false);
    expect(at(full, ['choice'], 'typed-lenient')).toBe(false);
    expect(at(full, ['choice', 'typed-lenient'], 'typed-lenient')).toBe(true);
    expect(at(full, ['choice', 'typed-lenient'], 'typed-strict')).toBe(false);
    expect(at(full, ['typed-strict'], 'typed-strict')).toBe(true);
  });

  it('needs no climbing for a ladder that starts there, and never opens a rung the deck leaves out', () => {
    expect(at(['typed-lenient', 'typed-strict'], [], 'typed-lenient')).toBe(true);
    expect(at(['typed-strict'], [], 'typed-strict')).toBe(true);
    // Multiple choice only: typing never comes, whatever the student did in another deck.
    expect(at(['choice'], ['typed-strict'], 'typed-lenient')).toBe(false);
    // Accents forgiven: accents never count.
    expect(at(['choice', 'typed-lenient'], ['typed-strict'], 'typed-strict')).toBe(false);
  });

  it('counts typing with accents as typing, on a ladder without the forgiving rung', () => {
    expect(at(['choice', 'typed-strict'], [], 'typed-lenient')).toBe(false);
    expect(at(['choice', 'typed-strict'], ['typed-strict'], 'typed-lenient')).toBe(true);
  });

  it('tells a ladder’s rungs and accents from the start', () => {
    expect(holds({ ladderHas: 'choice' }, ctx({ levels: ['typed-lenient', 'typed-strict'] }))).toBe(false);
    expect(holds({ accentsFromStart: true }, ctx({ accentMode: 'required' }))).toBe(true);
    expect(holds({ accentsFromStart: true }, ctx())).toBe(false);
  });
});

describe('openChapters', () => {
  const L = (s: string) => ({ en: s, es: s });
  const chapters: Chapter[] = [
    { id: 'basics', title: L('Basics'), summary: L('b'), sections: [{ id: 'b-1', title: L('b1'), blocks: [] }] },
    {
      id: 'present', title: L('Present'), summary: L('p'), when: { tense: 'present' }, sections: [
        { id: 'p-1', title: L('p1'), blocks: [] },
        { id: 'p-stem-o-ue', title: L('o>ue'), when: { pattern: 'stem:o>ue', tense: 'present' }, blocks: [] },
      ],
    },
    { id: 'preterite', title: L('Preterite'), summary: L('t'), when: { tense: 'preterite' }, sections: [{ id: 't-1', title: L('t1'), blocks: [] }] },
    { id: 'quiz', title: L('Quiz'), summary: L('q'), sections: [{ id: 'q-typing', title: L('typing'), when: { reached: 'typed-lenient' }, blocks: [] }] },
  ];

  it('gives the chapters and sections open now, in order', () => {
    const open = openChapters(chapters, ctx());
    expect(open.map((o) => o.chapter.id)).toEqual(['basics', 'present']);
    expect(open[1].sections.map((s) => s.id)).toEqual(['p-1']);
    expect(open[1].closed.map((s) => s.id)).toEqual(['p-stem-o-ue']);
  });

  it('grows as the deck and the student do', () => {
    const later = openChapters(chapters, ctx({ tenses: ['present', 'preterite'], reached: ['choice', 'typed-lenient'] }));
    expect(later.map((o) => o.chapter.id)).toEqual(['basics', 'present', 'preterite', 'quiz']);
  });

  it('shows a teacher everything, with what students do not see marked closed', () => {
    const all = openChapters(chapters, ctx(), true);
    expect(all.map((o) => o.chapter.id)).toEqual(['basics', 'present', 'preterite', 'quiz']);
    expect(all.find((o) => o.chapter.id === 'preterite')).toMatchObject({ sections: [], closed: [{ id: 't-1' }] });
  });
});

describe('sentences (v1.25.0)', () => {
  it('opens a part once the student has met a sentence', () => {
    expect(holds({ sentenceSeen: true }, ctx())).toBe(false);
    expect(holds({ sentenceSeen: true }, ctx({ sentenceSeen: true }))).toBe(true);
    expect(holds({ sentenceSeen: false }, ctx())).toBe(true);
  });
});
