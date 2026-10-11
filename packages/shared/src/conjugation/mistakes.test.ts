// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { cellsFor, conjugate, distractors } from './index.js';
import {
  allMistakeGuideSections,
  classifyMistake,
  classifyReading,
  mistakeGuideSections,
  mistakeKey,
  type MistakeCell,
} from './mistakes.js';
import type { GNumber, Person, Tense } from './types.js';

const cell = (entry: string, tense: Tense, person: Person, number?: GNumber): MistakeCell =>
  ({ entry, tense, person, ...(number ? { number } : {}) });
const presentOnly = { tenses: ['present'] as Tense[] };
const classify = (entry: string, person: Person, given: string, number?: GNumber) =>
  classifyMistake(cell(entry, 'present', person, number), given, presentOnly);

describe('classifyMistake', () => {
  it('names nothing for a right answer, with or without its subject pronoun', () => {
    expect(classify('tener', 'yo', 'tengo')).toBeNull();
    expect(classify('tener', 'yo', 'Yo tengo.')).toBeNull();
    expect(classify('gustarle', 'yo', 'a mí me gusta')).toBeNull();
    expect(classify('llamarse', 'el', 'se llama')).toBeNull();
    expect(classify('haber-impersonal', 'el', 'hay')).toBeNull();
  });

  it('names the person a form belongs to: the él form for yo, the singular for a plural', () => {
    expect(classify('tener', 'yo', 'tiene')).toEqual({ kind: 'person', detail: { person: 'el' } });
    expect(classify('tener', 'yo', 'yo tiene')).toEqual({ kind: 'person', detail: { person: 'el' } });
    expect(classify('ser', 'yo', 'es')).toEqual({ kind: 'person', detail: { person: 'el' } });
    expect(classify('vivir', 'nosotros', 'vivo')).toEqual({ kind: 'person', detail: { person: 'yo' } });
    expect(classify('hablar', 'ellos', 'habla')).toEqual({ kind: 'person', detail: { person: 'el' } });
    expect(classify('llamarse', 'yo', 'se llama')).toEqual({ kind: 'person', detail: { person: 'el' } });
    // A home variety's form is named as the person it is, not as wrong Spanish.
    expect(classify('tener', 'tu', 'tenés')).toEqual({ kind: 'person', detail: { person: 'vos' } });
  });

  it('names another tense of the verb, the drilled tenses first', () => {
    expect(classify('tener', 'yo', 'tenía')).toEqual({ kind: 'tense', detail: { tense: 'imperfect' } });
    // Typed without its accent, it is still read as the imperfect.
    expect(classify('tener', 'yo', 'tenia')).toEqual({ kind: 'tense', detail: { tense: 'imperfect' } });
    // "hablo" for hablé is the present; for habló, the present when the deck drills it, an accent slip when it does not.
    expect(classifyMistake(cell('hablar', 'preterite', 'yo'), 'hablo', { tenses: ['preterite'] })).toEqual({ kind: 'tense', detail: { tense: 'present' } });
    const habló = cell('hablar', 'preterite', 'el');
    expect(classifyMistake(habló, 'hablo', { tenses: ['present', 'preterite'] })).toEqual({ kind: 'tense', detail: { tense: 'present', person: 'yo' } });
    expect(classifyMistake(habló, 'hablo', { tenses: ['preterite'] })).toEqual({ kind: 'accent', detail: {} });
    // hay's own imperfect is a tense; habían gives it a person too.
    expect(classify('haber-impersonal', 'el', 'había')).toEqual({ kind: 'tense', detail: { tense: 'imperfect' } });
  });

  it('names a verb made regular, and which rule it skipped', () => {
    expect(classify('tener', 'yo', 'teno')).toEqual({ kind: 'regularized', detail: { change: 'yo' } });
    expect(classify('tener', 'yo', 'tieno')).toEqual({ kind: 'regularized', detail: { change: 'yo' } });
    expect(classify('tener', 'tu', 'tenes')).toEqual({ kind: 'regularized', detail: { change: 'stem' } });
    expect(classify('querer', 'yo', 'quero')).toEqual({ kind: 'regularized', detail: { change: 'stem' } });
    expect(classify('pensar', 'nosotros', 'piensamos')).toEqual({ kind: 'regularized', detail: { change: 'stemEverywhere' } });
    expect(classify('estar', 'yo', 'esto')).toEqual({ kind: 'regularized', detail: { change: 'irregular' } });
    expect(classify('llover', 'el', 'llove')).toEqual({ kind: 'regularized', detail: { change: 'stem' } });
    expect(classify('dolerle', 'yo', 'me dole')).toEqual({ kind: 'regularized', detail: { change: 'stem' } });
    expect(classifyMistake(cell('buscar', 'preterite', 'yo'), 'buscé', { tenses: ['preterite'] }))
      .toEqual({ kind: 'regularized', detail: { change: 'spelling' } });
    expect(classifyMistake(cell('sentir', 'preterite', 'el'), 'sentió', { tenses: ['preterite'] }))
      .toEqual({ kind: 'regularized', detail: { change: 'stem' } });
  });

  it('names the gustar-type mistakes: conjugated for the person, the number of the thing liked, "me gusto"', () => {
    expect(classify('gustarle', 'yo', 'gusto')).toEqual({ kind: 'dativeSubject', detail: { person: 'yo' } });
    expect(classify('gustarle', 'yo', 'yo gusto')).toEqual({ kind: 'dativeSubject', detail: { person: 'yo', subjectPronoun: 'yo' } });
    expect(classify('gustarle', 'yo', 'yo me gusta')).toEqual({ kind: 'dativeSubject', detail: { person: 'yo', subjectPronoun: 'yo' } });
    expect(classify('gustarle', 'tu', 'gustas')).toEqual({ kind: 'dativeSubject', detail: { person: 'tu' } });
    expect(classify('gustarle', 'yo', 'me gustan')).toEqual({ kind: 'dativeNumber', detail: { number: 'pl' } });
    expect(classify('gustarle', 'yo', 'me gusta', 'pl')).toEqual({ kind: 'dativeNumber', detail: { number: 'sg' } });
    expect(classify('gustarle', 'ellos', 'les gusta', 'pl')).toEqual({ kind: 'dativeNumber', detail: { number: 'sg' } });
    expect(classify('gustarle', 'yo', 'me gusto')).toEqual({ kind: 'dativeSelf', detail: {} });
    // Verbs with no -se entry in the dictionary are read by their shape.
    expect(classify('encantarle', 'tu', 'te encantas')).toEqual({ kind: 'dativeSelf', detail: {} });
    expect(classify('dolerle', 'el', 'se duele')).toEqual({ kind: 'pronounWrong', detail: { pronoun: 'se', expectedPronoun: 'le' } });
    // The wrong experiencer is another person.
    expect(classify('gustarle', 'yo', 'le gusta')).toEqual({ kind: 'person', detail: { person: 'el', number: 'sg' } });
    expect(classify('gustarle', 'yo', 'a ti me gusta')).toEqual({ kind: 'person', detail: { person: 'tu', number: 'sg' } });
    // "a mi" for "a mí" is an accent slip.
    expect(classify('gustarle', 'yo', 'a mi me gusta')).toEqual({ kind: 'accent', detail: {} });
  });

  it('names a pronoun left out, added or wrong', () => {
    expect(classify('llamarse', 'yo', 'llamo')).toEqual({ kind: 'pronounMissing', detail: { pronoun: 'me' } });
    expect(classify('gustarle', 'yo', 'gusta')).toEqual({ kind: 'pronounMissing', detail: { pronoun: 'me' } });
    expect(classify('gustarle', 'el', 'gusta')).toEqual({ kind: 'pronounMissing', detail: { pronoun: 'le' } });
    expect(classify('gustarle', 'yo', 'gustan')).toEqual({ kind: 'pronounMissing', detail: { pronoun: 'me', number: 'pl' } });
    expect(classify('llamarse', 'yo', 'se llamo')).toEqual({ kind: 'pronounWrong', detail: { pronoun: 'se', expectedPronoun: 'me' } });
    expect(classify('vivir', 'yo', 'me vivo')).toEqual({ kind: 'pronounExtra', detail: { pronoun: 'me' } });
    expect(classifyMistake(cell('levantarse', 'imperativeAffirmative', 'tu'), 'levanta', { tenses: ['imperativeAffirmative'] }))
      .toEqual({ kind: 'pronounMissing', detail: { pronoun: 'te' } });
  });

  it('names hay given a person, the dictionary form, another verb and an accent slip', () => {
    expect(classify('haber-impersonal', 'el', 'ha')).toEqual({ kind: 'impersonal', detail: { person: 'el' } });
    expect(classify('haber-impersonal', 'el', 'han')).toEqual({ kind: 'impersonal', detail: { person: 'ellos' } });
    expect(classify('haber-impersonal', 'el', 'habían')).toEqual({ kind: 'impersonal', detail: { person: 'ellos', tense: 'imperfect' } });
    expect(classify('llover', 'el', 'llueven')).toEqual({ kind: 'impersonal', detail: { person: 'ellos' } });
    expect(classify('tener', 'yo', 'tener')).toEqual({ kind: 'infinitive', detail: {} });
    expect(classify('llamarse', 'yo', 'llamarse')).toEqual({ kind: 'infinitive', detail: {} });
    expect(classify('gustarle', 'yo', 'gustar')).toEqual({ kind: 'infinitive', detail: {} });
    expect(classify('ser', 'yo', 'estoy')).toEqual({ kind: 'otherVerb', detail: { entry: 'estar', tense: 'present', person: 'yo' } });
    expect(classify('haber-impersonal', 'el', 'está')).toEqual({ kind: 'otherVerb', detail: { entry: 'estar', tense: 'present', person: 'el' } });
    expect(classify('estar', 'el', 'esta')).toEqual({ kind: 'accent', detail: {} });
  });

  it('prefers a verb of the deck when a form belongs to several', () => {
    // "fue" is ser and ir: the deck's verb is named.
    const fue = (entries: string[]) => classifyMistake(cell('estar', 'preterite', 'el'), 'fue', { tenses: ['preterite'], entries });
    expect(fue(['estar', 'ir'])?.detail.entry).toBe('ir');
    expect(fue(['estar', 'ser'])?.detail.entry).toBe('ser');
  });

  it('says unknown rather than guess, and for an empty answer', () => {
    expect(classify('tener', 'yo', 'tengp')).toEqual({ kind: 'unknown', detail: {} });
    expect(classify('tener', 'yo', '   ')).toEqual({ kind: 'unknown', detail: {} });
    expect(classify('ir', 'yo', 'vo')).toEqual({ kind: 'unknown', detail: {} });
    expect(classifyMistake(cell('blorfar', 'present', 'yo'), 'zzz')).toEqual({ kind: 'unknown', detail: {} });
  });

  it('names every distractor the quiz offers, and never one as right (Spanish 1 verbs)', () => {
    const verbs = [
      'ser', 'estar', 'tener', 'ir', 'hacer', 'querer', 'poder', 'llamarse', 'gustarle', 'haber-impersonal', 'vivir', 'hablar',
      'comer', 'jugar', 'pensar', 'dormir', 'pedir', 'verse', 'levantarse', 'salir', 'conocer', 'decir', 'venir', 'llover',
      'encantarle', 'dolerle',
    ];
    for (const tenses of [['present'], ['present', 'preterite'], ['imperfect']] as Tense[][]) {
      for (const verb of verbs) {
        for (const c of cellsFor(verb, tenses, { vosotros: false })) {
          for (const d of distractors(verb, c.tense, c.person, 8, { number: c.number, tenses })) {
            const m = classifyMistake({ entry: verb, ...c }, d, { tenses });
            const where = `${verb} ${c.tense} ${c.person} ${c.number ?? ''}: ${d}`;
            expect(m, where).not.toBeNull();
            expect(m?.kind, where).not.toBe('unknown');
          }
        }
      }
    }
  }, 60_000);

  it('never names a mistake in an accepted form (vos in its region too)', () => {
    for (const verb of ['tener', 'hablar', 'ser', 'gustarle', 'llamarse']) {
      for (const c of cellsFor(verb, ['present', 'preterite'], { vosotros: true, vos: 'centroamericano' })) {
        for (const form of conjugate(verb, c.tense, c.person, c.number, { vosRegion: 'centroamericano' }) ?? []) {
          expect(classifyMistake({ entry: verb, ...c }, form, { vosRegion: 'centroamericano' }), `${verb} ${c.person}: ${form}`).toBeNull();
        }
      }
    }
  });
});

describe('classifyReading', () => {
  const tienes = cell('tener', 'present', 'tu');
  it('names the reading a student picked for a "name the verb" form', () => {
    expect(classifyReading(tienes, cell('tener', 'present', 'el'))).toEqual({ kind: 'person', detail: { person: 'el' } });
    expect(classifyReading(tienes, cell('tener', 'preterite', 'tu'))).toEqual({ kind: 'tense', detail: { tense: 'preterite' } });
    expect(classifyReading(tienes, cell('tener', 'preterite', 'yo'))).toEqual({ kind: 'tense', detail: { tense: 'preterite', person: 'yo' } });
    expect(classifyReading(tienes, cell('venir', 'present', 'tu'))).toEqual({ kind: 'otherVerb', detail: { entry: 'venir', tense: 'present', person: 'tu' } });
    expect(classifyReading(tienes, tienes)).toEqual({ kind: 'unknown', detail: {} });
  });
});

describe('mistakeKey', () => {
  it('keys a mistake by its kind and its main fact', () => {
    expect(mistakeKey({ kind: 'person', detail: { person: 'el' } })).toBe('person:el');
    expect(mistakeKey({ kind: 'regularized', detail: { change: 'yo' } })).toBe('regularized:yo');
    expect(mistakeKey({ kind: 'otherVerb', detail: { entry: 'estar', tense: 'present', person: 'yo' } })).toBe('otherVerb:estar');
    expect(mistakeKey({ kind: 'dativeSubject', detail: { person: 'yo' } })).toBe('dativeSubject');
    expect(mistakeKey({ kind: 'accent', detail: {} })).toBe('accent');
  });
});

describe('mistakeGuideSections', () => {
  const sections = (entry: string, tense: Tense, person: Person, given: string, number?: GNumber) => {
    const c = cell(entry, tense, person, number);
    const m = classifyMistake(c, given, { tenses: [tense] });
    return m ? mistakeGuideSections(m, c) : [];
  };

  it('links the section that teaches the rule, most specific first', () => {
    expect(sections('tener', 'present', 'yo', 'tiene')).toEqual(['present-yo', 'present-build', 'persons-glance']);
    expect(sections('tener', 'present', 'yo', 'teno')).toEqual(['present-yo', 'present-build']);
    expect(sections('querer', 'present', 'yo', 'quero')).toEqual(['present-stem-e-ie', 'present-stem', 'present-build']);
    expect(sections('ser', 'present', 'yo', 'es')[0]).toBe('present-irregular');
    expect(sections('gustarle', 'present', 'yo', 'gusto')).toEqual(['dative-how', 'basics-le-verbs']);
    expect(sections('gustarle', 'present', 'yo', 'me gustan')).toEqual(['dative-agree', 'dative-how']);
    expect(sections('gustarle', 'present', 'yo', 'me gusto')[0]).toBe('dative-gustarse');
    expect(sections('llamarse', 'present', 'yo', 'llamo')[0]).toBe('pronominal-present');
    expect(sections('haber-impersonal', 'present', 'el', 'han')[0]).toBe('impersonal-hay');
    expect(sections('haber-impersonal', 'present', 'el', 'está')).toEqual(['impersonal-hay-estar']);
    expect(sections('ser', 'present', 'yo', 'estoy')).toEqual(['present-ser-estar']);
    expect(sections('tener', 'present', 'yo', 'tener')[0]).toBe('basics-dictionary-form');
    expect(sections('hablar', 'preterite', 'el', 'hablo')).toEqual(['preterite-accents', 'quiz-accents']);
    expect(sections('hablar', 'imperativeAffirmative', 'el', 'habla')).toContain('commands-formal');
    // Nothing to explain: no link.
    expect(sections('tener', 'present', 'yo', 'tengp')).toEqual([]);
  });

  it('names only sections the guide has', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const chapters = join(here, '../../../client/src/components/conjugation/guide/chapters');
    // The shared package alone (a published build) has no client next to it.
    if (!existsSync(chapters)) return;
    const ids = new Set<string>();
    for (const file of readdirSync(chapters).filter((f) => f.endsWith('.ts'))) {
      for (const match of readFileSync(join(chapters, file), 'utf8').matchAll(/\bid: '([a-z0-9-]+)'/g)) ids.add(match[1]);
    }
    expect(ids.size).toBeGreaterThan(100);
    expect(allMistakeGuideSections().filter((id) => !ids.has(id))).toEqual([]);
  });
});
