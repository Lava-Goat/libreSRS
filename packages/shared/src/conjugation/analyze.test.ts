// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { analyze, analyzeIgnoringAccents, conjugate, lexiconEntries, lexiconInfinitives, TENSES, warmUp } from './index.js';

describe('warmUp', () => {
  // First in the file on purpose: it pays the one-time build the other tests then reuse.
  it('builds the indexes once, up front, so later lookups cost nothing', ({ task }) => {
    // The suite's default timeout covers a first-in-file warm-up on a loaded CI runner (5 s did not).
    expect(task.timeout).toBeGreaterThanOrEqual(20_000);
    const forms = warmUp();
    expect(forms).toBeGreaterThan(60_000);
    const start = performance.now();
    expect(warmUp()).toBe(forms);
    expect(analyze('tengo')).toEqual([{ infinitive: 'tener', tense: 'present', person: 'yo' }]);
    expect(analyzeIgnoringAccents('comio')).toContainEqual({ infinitive: 'comer', tense: 'preterite', person: 'el' });
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('analyze', () => {
  it('finds a unique form', () => {
    expect(analyze('tengo')).toEqual([{ infinitive: 'tener', tense: 'present', person: 'yo' }]);
    expect(analyze('hablaríamos')).toEqual([{ infinitive: 'hablar', tense: 'conditional', person: 'nosotros' }]);
  });

  it('returns every reading of an ambiguous form', () => {
    const fue = analyze('fue');
    expect(fue).toContainEqual({ infinitive: 'ser', tense: 'preterite', person: 'el' });
    expect(fue).toContainEqual({ infinitive: 'ir', tense: 'preterite', person: 'el' });
    const habla = analyze('habla');
    expect(habla).toContainEqual({ infinitive: 'hablar', tense: 'present', person: 'el' });
    expect(habla).toContainEqual({ infinitive: 'hablar', tense: 'imperativeAffirmative', person: 'tu' });
  });

  it('resolves reflexive forms to the pronominal verb', () => {
    expect(analyze('me llamo')).toEqual([{ infinitive: 'llamarse', tense: 'present', person: 'yo' }]);
    expect(analyze('se llama')).toEqual([{ infinitive: 'llamarse', tense: 'present', person: 'el' }]);
    expect(analyze('se ve')).toEqual([{ infinitive: 'verse', tense: 'present', person: 'el' }]);
    expect(analyze('levántate')).toEqual([{ infinitive: 'levantarse', tense: 'imperativeAffirmative', person: 'tu' }]);
    // The tuteo negative command is also an accepted vos one in both regions.
    expect(analyze('no te levantes')).toEqual([
      { infinitive: 'levantarse', tense: 'imperativeNegative', person: 'tu' },
      { infinitive: 'levantarse', tense: 'imperativeNegative', person: 'vos', regions: ['rioplatense', 'centroamericano'] },
    ]);
    expect(analyze('estoy levantándome')).toEqual([{ infinitive: 'levantarse', tense: 'presentProgressive', person: 'yo' }]);
    expect(analyze('me he levantado')).toEqual([{ infinitive: 'levantarse', tense: 'presentPerfect', person: 'yo' }]);
    const vete = analyze('vete');
    expect(vete).toContainEqual({ infinitive: 'irse', tense: 'imperativeAffirmative', person: 'tu' });
    expect(vete).toContainEqual({ infinitive: 'verse', tense: 'imperativeAffirmative', person: 'tu' });
  });

  it('is case- and whitespace-insensitive but accent-exact', () => {
    expect(analyze('  ESTÁ ')).toContainEqual({ infinitive: 'estar', tense: 'present', person: 'el' });
    expect(analyze('Me   Llamo')).toEqual([{ infinitive: 'llamarse', tense: 'present', person: 'yo' }]);
    expect(analyze('esta')).toEqual([]);
    expect(analyze('este')).toEqual([]);
    expect(analyze('hablo')).toEqual([{ infinitive: 'hablar', tense: 'present', person: 'yo' }]);
    expect(analyze('habló')).toEqual([{ infinitive: 'hablar', tense: 'preterite', person: 'el' }]);
  });

  it('knows hay, compound tenses and accepted alternatives', () => {
    expect(analyze('hay')).toEqual([{ infinitive: 'haber-impersonal', tense: 'present', person: 'el' }]);
    expect(analyze('he hablado')).toEqual([{ infinitive: 'hablar', tense: 'presentPerfect', person: 'yo' }]);
    expect(analyze('rio')).toEqual([{ infinitive: 'reír', tense: 'preterite', person: 'el' }]);
    expect(analyze('rió')).toEqual([{ infinitive: 'reír', tense: 'preterite', person: 'el' }]);
    expect(analyze('hablase')).toContainEqual({ infinitive: 'hablar', tense: 'imperfectSubjunctive', person: 'yo' });
  });

  it('returns nothing for non-verbs', () => {
    for (const w of ['mesa', 'gato', 'el', 'y', 'mañana', '', 'cómo', 'más']) expect(analyze(w)).toEqual([]);
  });

  it('round-trips every form of a sample of verbs', () => {
    const verbs = lexiconInfinitives().filter((_v, i) => i % 23 === 0);
    for (const infinitive of verbs) {
      for (const t of TENSES) {
        for (const person of t.persons) {
          for (const form of conjugate(infinitive, t.id, person) ?? []) {
            expect(analyze(form)).toContainEqual(expect.objectContaining({ infinitive, tense: t.id, person }));
          }
        }
      }
    }
  });
});

describe('analyze, entry kinds', () => {
  it('reads each kind of gustar', () => {
    expect(analyze('gusto')).toEqual([{ infinitive: 'gustar', tense: 'present', person: 'yo' }]);
    expect(analyze('me gusto')).toEqual([{ infinitive: 'gustarse', tense: 'present', person: 'yo' }]);
    expect(analyze('me gusta')).toEqual([{ infinitive: 'gustarle', tense: 'present', person: 'yo', number: 'sg' }]);
    expect(analyze('le gustan')).toEqual([{ infinitive: 'gustarle', tense: 'present', person: 'el', number: 'pl' }]);
    expect(analyze('nos gusta')).toEqual([{ infinitive: 'gustarle', tense: 'present', person: 'nosotros', number: 'sg' }]);
    const nos = analyze('nos gustamos');
    expect(nos).toContainEqual({ infinitive: 'gustarse', tense: 'present', person: 'nosotros' });
    expect(nos.every((h) => h.infinitive === 'gustarse')).toBe(true);
    expect(analyze('me han gustado')).toEqual([
      { infinitive: 'gustarle', tense: 'presentPerfect', person: 'yo', number: 'pl' },
    ]);
    expect(analyze('les está gustando')).toEqual([
      { infinitive: 'gustarle', tense: 'presentProgressive', person: 'ellos', number: 'sg' },
    ]);
  });

  it('reads the dative of other gustar-type verbs', () => {
    expect(analyze('me duelen')).toEqual([{ infinitive: 'dolerle', tense: 'present', person: 'yo', number: 'pl' }]);
    expect(analyze('les parece')).toEqual([{ infinitive: 'parecerle', tense: 'present', person: 'ellos', number: 'sg' }]);
    expect(analyze('te queda')).toEqual([
      { infinitive: 'quedarle', tense: 'present', person: 'tu', number: 'sg' },
      { infinitive: 'quedarle', tense: 'present', person: 'vos', number: 'sg', regions: ['rioplatense', 'centroamericano'] },
    ]);
    expect(analyze('te quedas')).toEqual([{ infinitive: 'quedarse', tense: 'present', person: 'tu' }]);
    expect(analyze('me parezco')).toEqual([{ infinitive: 'parecerse', tense: 'present', person: 'yo' }]);
  });

  it('keeps hay apart from the auxiliary haber, and reads both where both exist', () => {
    expect(analyze('ha')).toEqual([{ infinitive: 'haber', tense: 'present', person: 'el' }]);
    const habia = analyze('había');
    expect(habia).toContainEqual({ infinitive: 'haber-impersonal', tense: 'imperfect', person: 'el' });
    expect(habia).toContainEqual({ infinitive: 'haber', tense: 'imperfect', person: 'yo' });
    expect(analyze('hubo')).toContainEqual({ infinitive: 'haber-impersonal', tense: 'preterite', person: 'el' });
    expect(analyze('ha habido')).toContainEqual({ infinitive: 'haber-impersonal', tense: 'presentPerfect', person: 'el' });
    expect(analyze('llueve')).toEqual([{ infinitive: 'llover', tense: 'present', person: 'el' }]);
    expect(analyze('está lloviendo')).toEqual([{ infinitive: 'llover', tense: 'presentProgressive', person: 'el' }]);
    expect(analyze('lluevo')).toEqual([]);
  });

  it('round-trips every form of the dative and impersonal entries', () => {
    const entries = lexiconEntries().filter((e) => e.endsWith('le') || e.endsWith('-impersonal'));
    expect(entries).toContain('gustarle');
    expect(entries).toContain('haber-impersonal');
    for (const infinitive of entries) {
      for (const t of TENSES) {
        for (const person of t.persons) {
          for (const number of ['sg', 'pl'] as const) {
            const forms = conjugate(infinitive, t.id, person, number) ?? [];
            const hit = infinitive.endsWith('le') ? { infinitive, tense: t.id, person, number } : { infinitive, tense: t.id, person };
            for (const form of forms) expect(analyze(form)).toContainEqual(expect.objectContaining(hit));
          }
        }
      }
    }
  });
});
