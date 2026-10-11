// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { guideContext, mergeSubjects } from './context';

const overview = {
  tenses: [{ id: 'present' as const }],
  includeVosotros: false,
  vos: 'none' as const,
  directions: 'both' as const,
  accentMode: 'progressive' as const,
  levels: ['choice' as const],
  reachedRungs: [],
};

describe('the guide\'s view of sentences (v1.25.0)', () => {
  it('opens "Who is the subject?" from the overview or from this visit, with this visit\'s subjects first', () => {
    expect(guideContext(overview, [], [])).toMatchObject({ sentenceSeen: false, subjectsMet: [] });
    const fetched = [{ es: 'mi abuela', pronoun: 'ella', person: 'el' as const }];
    expect(guideContext({ ...overview, sentenceSeen: true, subjectsMet: fetched }, [], [])).toMatchObject({ sentenceSeen: true, subjectsMet: fetched });
    const live = { seen: true, subjects: [{ es: 'mis primos', pronoun: 'ellos', person: 'ellos' as const }] };
    expect(guideContext({ ...overview, subjectsMet: fetched }, [], [], live).subjectsMet?.map((s) => s.es)).toEqual(['mis primos', 'mi abuela']);
  });

  it('lists each subject once, newest first, at most ten', () => {
    const s = (es: string) => ({ es, pronoun: null, person: 'ellos' as const });
    expect(mergeSubjects([s('Ustedes')], [s('ustedes'), s('mis primos')]).map((x) => x.es)).toEqual(['Ustedes', 'mis primos']);
    expect(mergeSubjects(Array.from({ length: 14 }, (_, i) => s(`s${i}`)))).toHaveLength(10);
  });
});
