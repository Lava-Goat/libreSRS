// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  analyze,
  cellsFor,
  conjugate,
  distractors,
  entryKind,
  foldAccents,
  gradeTyped,
  lexiconInfinitives,
  regularizedVariants,
  TENSES,
} from './index.js';
import type { Person, Tense } from './index.js';

const CORE = [
  'ser', 'estar', 'ir', 'haber', 'tener', 'hacer', 'decir', 'poner', 'venir', 'querer', 'poder', 'saber', 'dar',
  'ver', 'oír', 'caer', 'traer', 'leer', 'construir', 'conducir', 'pedir', 'sentir', 'dormir', 'morir', 'jugar',
  'pensar', 'volver', 'empezar', 'buscar', 'llegar', 'coger', 'seguir', 'averiguar', 'enviar', 'continuar', 'reír',
  'llamarse', 'levantarse', 'irse', 'vestirse', 'hablar', 'comer', 'vivir', 'freír', 'obtener', 'predecir', 'guiar',
  'soler', 'concernir', 'distinguir', 'delinquir', 'adecuar', 'consensuar', 'desleír', 'podrir', 'perecer', 'oir',
];

describe('distractors', () => {
  it('offers the regularized form right after the él/ella form for irregular verbs', () => {
    expect(distractors('tener', 'present', 'yo', 4).slice(0, 2)).toEqual(['tiene', 'teno']);
    expect(distractors('buscar', 'preterite', 'yo', 4)).toContain('buscé');
    expect(distractors('pensar', 'present', 'nosotros', 6)).toContain('piensamos');
    expect(distractors('sentir', 'preterite', 'el', 6)).toContain('sentió');
  });

  it('adds accent-drop variants only when accents are required', () => {
    expect(distractors('hablar', 'preterite', 'el', 8, { strictAccents: true })).toContain('hablo');
    expect(distractors('hablar', 'preterite', 'el', 8, { strictAccents: false })).not.toContain('hablo');
  });

  it('is deterministic for a seed and varies with the seed', () => {
    const a = distractors('tener', 'preterite', 'yo', 3, 7);
    expect(distractors('tener', 'preterite', 'yo', 3, 7)).toEqual(a);
    expect(distractors('tener', 'preterite', 'yo', 3, { seed: 7 })).toEqual(a);
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => distractors('tener', 'preterite', 'yo', 3, s).join()));
    expect(seeds.size).toBeGreaterThan(1);
    expect(distractors('tener', 'preterite', 'yo', 3)).toEqual(distractors('tener', 'preterite', 'yo', 3));
  });

  it('returns nothing for a missing person or a non-verb', () => {
    expect(distractors('hablar', 'imperativeAffirmative', 'yo', 3)).toEqual([]);
    expect(distractors('casa', 'present', 'yo', 3)).toEqual([]);
    expect(distractors('hablar', 'present', 'yo', 0)).toEqual([]);
  });

  it('keeps reflexive distractors reflexive-shaped', () => {
    for (const d of distractors('levantarse', 'present', 'yo', 4)) expect(d).toMatch(/^(me|te|se|nos|os) /);
  });

  it('never offers an accepted answer (property over many verbs and cells)', () => {
    const verbs = [...CORE, ...lexiconInfinitives().filter((_v, i) => i % 17 === 0)];
    for (const verb of verbs) {
      for (const t of TENSES) {
        for (const person of t.persons) {
          const cell = conjugate(verb, t.id, person);
          if (!cell) {
            // A defective verb's missing cell (soler's future) has no answer and no distractors.
            expect(distractors(verb, t.id, person, 5)).toEqual([]);
            continue;
          }
          const accepted = cell;
          for (const strictAccents of [false, true]) {
            const list = distractors(verb, t.id, person, 5, { strictAccents });
            expect(list.length).toBeGreaterThan(0);
            expect(list.length).toBeLessThanOrEqual(5);
            const keys = list.map((d) => (strictAccents ? d : foldAccents(d)));
            expect(new Set(keys).size).toBe(list.length);
            for (const d of list) {
              expect(d.trim()).not.toBe('');
              expect(accepted).not.toContain(d);
              expect(gradeTyped(accepted, d, strictAccents)).not.toBe('correct');
            }
          }
        }
      }
    }
  }, 60_000); // full sweep: seconds of CPU, and more on a loaded CI runner
});

describe('distractors, audit regressions', () => {
  // Every option is a real form of some verb (a negative command may be built from another tense: "no va").
  const words = (list: string[]): boolean => list.every((d) => analyze(d.replace(/^no /, '')).length > 0);

  it('offers whole words, not bare endings, for ir, ser, ver, oír and irse', () => {
    const cells: [string, Tense, Person][] = [
      ['ir', 'present', 'yo'], ['ir', 'present', 'el'], ['ir', 'present', 'ellos'], ['ir', 'preterite', 'yo'],
      ['ir', 'imperfect', 'yo'], ['ir', 'presentSubjunctive', 'yo'], ['ir', 'imperativeNegative', 'el'],
      ['irse', 'present', 'yo'], ['irse', 'imperativeAffirmative', 'tu'], ['ser', 'present', 'yo'],
      ['ser', 'presentSubjunctive', 'yo'], ['oír', 'present', 'yo'], ['ver', 'present', 'yo'],
    ];
    for (const [verb, tense, person] of cells) {
      for (let seed = 1; seed <= 20; seed++) {
        const list = distractors(verb, tense, person, 3, seed);
        expect(list.length, `${verb} ${tense} ${person}`).toBe(3);
        expect(words(list), `${verb} ${tense} ${person}: ${list.join(', ')}`).toBe(true);
      }
    }
    expect(distractors('ir', 'present', 'yo', 5)).not.toContain('o');
  });

  it('never inserts the -uir y into -guir / -quir verbs', () => {
    for (const verb of ['seguir', 'conseguir', 'perseguir', 'proseguir', 'distinguir', 'extinguir', 'delinquir']) {
      for (const t of TENSES) {
        for (const person of t.persons) {
          for (const d of distractors(verb, t.id, person, 8)) expect(d, `${verb} ${t.id} ${person}`).not.toMatch(/[gq]uy/);
        }
      }
    }
    expect(distractors('distinguir', 'present', 'yo', 8)).toContain('distinguo');
    expect(distractors('delinquir', 'present', 'yo', 8)).toContain('delinquo');
  });
});

describe('distractors, dative and impersonal entries', () => {
  it('offers the typical dative mistakes', () => {
    const list = distractors('gustarle', 'present', 'yo', 20);
    expect(list).toContain('te gusta'); // wrong clitic
    expect(list).toContain('me gustan'); // wrong number
    expect(list.some((d) => d === 'gusto' || d === 'yo gusto')).toBe(true); // bare conjugation
    expect(list).toContain('me gusto'); // pronominal confusion
    expect(list).not.toContain('me gusta');
    const pl = distractors('gustarle', 'present', 'ellos', 20, { number: 'pl' });
    expect(pl).toContain('les gusta');
    expect(pl).toContain('se gustan');
    expect(pl).not.toContain('les gustan');
    expect(distractors('dolerle', 'present', 'yo', 20)).toContain('me dole');
  });

  it('offers the personal haber and other tenses for hay, and only real words', () => {
    const hay = distractors('haber-impersonal', 'present', 'el', 20);
    expect(hay).toContain('ha');
    expect(hay).toContain('han');
    expect(hay).toContain('había');
    expect(hay).not.toContain('hay');
    for (const tense of ['present', 'preterite', 'imperfect', 'future', 'presentPerfect'] as Tense[]) {
      for (const d of distractors('haber-impersonal', tense, 'el', 20)) expect(analyze(d).length, d).toBeGreaterThan(0);
    }
    expect(distractors('haber-impersonal', 'preterite', 'el', 20)).toContain('hubieron');
    expect(distractors('haber-impersonal', 'presentPerfect', 'el', 20)).toContain('han habido');
    const llueve = distractors('llover', 'present', 'el', 20);
    expect(llueve).toContain('llueven');
    expect(llueve).toContain('llovía');
  });

  it('fills a compound impersonal cell with simple tenses once the compound ones run out', () => {
    // ha habido has only two compound neighbours (han habido, había habido); a 4-option
    // multiple choice still gets three real, wrong forms, compound ones first.
    for (const tense of ['presentPerfect', 'pluperfect'] as Tense[]) {
      const d = distractors('haber-impersonal', tense, 'el', 3);
      expect(d, tense).toHaveLength(3);
      expect(d.slice(0, 2).every((f) => f.endsWith(' habido')), tense).toBe(true);
      for (const f of d) expect(analyze(f).length, f).toBeGreaterThan(0);
    }
    expect(distractors('haber-impersonal', 'presentPerfect', 'el', 20)).toContain('hubo');
  });

  it('returns nothing for cells the entry lacks', () => {
    expect(distractors('gustarle', 'imperativeAffirmative', 'tu', 4)).toEqual([]);
    expect(distractors('haber-impersonal', 'present', 'yo', 4)).toEqual([]);
    expect(distractors('haber-impersonal', 'presentProgressive', 'el', 4)).toEqual([]);
    expect(distractors('llover', 'imperativeNegative', 'el', 4)).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = distractors('gustarle', 'preterite', 'tu', 4, { seed: 9, number: 'pl' });
    expect(distractors('gustarle', 'preterite', 'tu', 4, { seed: 9, number: 'pl' })).toEqual(a);
  });

  it('never offers an accepted answer (property over the new kinds)', () => {
    const entries = [
      'gustarle', 'encantarle', 'dolerle', 'parecerle', 'quedarle', 'faltarle', 'interesarle', 'importarle',
      'molestarle', 'aburrirle', 'tocarle', 'caerle', 'haber-impersonal', 'llover', 'nevar', 'tronar',
      'amanecer-impersonal', 'gustarse', 'gustar', 'hacer-impersonal', 'relampaguear', 'garuar', 'pasarle', 'asustarle',
      'serle',
    ];
    for (const entry of entries) {
      const kind = entryKind(entry);
      for (const cell of cellsFor(entry, [...TENSES.map((t) => t.id)], { vosotros: true })) {
        const accepted = conjugate(entry, cell.tense, cell.person, cell.number) ?? [];
        for (const strictAccents of [false, true]) {
          const list = distractors(entry, cell.tense, cell.person, 5, { strictAccents, number: cell.number });
          const where = `${entry} ${JSON.stringify(cell)} ${strictAccents}`;
          expect(list.length, where).toBeGreaterThan(0);
          expect(list.length, where).toBeLessThanOrEqual(5);
          const keys = list.map((d) => (strictAccents ? d : foldAccents(d)));
          expect(new Set(keys).size, where).toBe(list.length);
          for (const d of list) {
            expect(d.trim(), where).not.toBe('');
            expect(accepted, where).not.toContain(d);
            expect(gradeTyped(accepted, d, strictAccents, cell.person, kind), `${where}: ${d}`).not.toBe('correct');
            expect(gradeTyped(accepted, d, strictAccents), `${where}: ${d}`).not.toBe('correct');
          }
        }
      }
    }
  }, 60_000);
});

describe('distractors, usage audit regressions', () => {
  it('offers no vosotros form to a class without vosotros', () => {
    const noOs = (list: string[]): boolean => list.every((d) => !/^os /.test(d) && !/(áis|éis|ís|asteis|isteis)$/.test(d));
    for (let seed = 0; seed < 30; seed++) {
      expect(noOs(distractors('gustarle', 'presentSubjunctive', 'yo', 4, { seed, vosotros: false }))).toBe(true);
      expect(noOs(distractors('gustarle', 'preterite', 'yo', 4, { seed, number: 'pl', vosotros: false }))).toBe(true);
      expect(noOs(distractors('gustarle', 'present', 'tu', 4, { seed }))).toBe(true);
      expect(noOs(distractors('hablar', 'present', 'yo', 4, { seed }))).toBe(true);
    }
    expect(distractors('gustarle', 'present', 'yo', 20, { vosotros: true })).toContain('os gusta');
    expect(distractors('hablar', 'present', 'yo', 20, { vosotros: true })).toContain('habláis');
    // A vosotros cell is from a class that uses vosotros.
    expect(distractors('gustarle', 'present', 'vosotros', 20)).toContain('nos gusta');
  });
});

describe('distractors, only the tenses the deck drills', () => {
  // Unit 1–3 verbs of the Spanish 1 decks, every kind among them.
  const UNIT = ['ser', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir', 'hacer', 'haber-impersonal', 'llover', 'nevar', 'hacer-impersonal'];
  /** The option's readings as a form of the entry itself, in any tense. */
  const ownTenses = (entry: string, form: string): Tense[] =>
    analyze(form).filter((h) => h.infinitive === entry).map((h) => h.tense);

  it('offers no form of an undrilled tense (quisiésemos, fuera) to a present-only deck, and still fills the options', () => {
    for (const tenses of [['present'], ['present', 'preterite']] as Tense[][]) {
      for (const entry of UNIT) {
        for (const cell of cellsFor(entry, tenses, { vosotros: false })) {
          for (let seed = 0; seed < 10; seed++) {
            const list = distractors(entry, cell.tense, cell.person, 3, { seed, number: cell.number, tenses });
            const where = `${entry} ${cell.tense} ${cell.person} ${cell.number ?? ''} [${tenses.join()}]: ${list.join(', ')}`;
            expect(list, where).toHaveLength(3);
            for (const d of list) {
              const own = ownTenses(entry, d);
              // A form of the verb itself is one of a drilled tense; an impersonal cell (hay, llueve) has too
              // few others (ha, han; llueven, llove), so it alone falls back to the nearest undrilled tense.
              // "esté" for estuve is estar made regular (like hablé), which happens to spell a subjunctive.
              if (d === 'esté' && cell.tense === 'preterite') continue;
              if (own.length > 0 && !own.some((t) => tenses.includes(t)) && entryKind(entry) !== 'impersonal') {
                throw new Error(`${where}: ${d} is only ${own.join('/')}`);
              }
            }
          }
        }
      }
    }
    expect(distractors('querer', 'present', 'nosotros', 4, { tenses: ['present'] })).not.toContain('quisiésemos');
    expect(distractors('ser', 'present', 'el', 4, { tenses: ['present'] })).not.toContain('fuera');
    expect(distractors('ser', 'present', 'el', 20, { tenses: ['present', 'preterite'] })).toContain('fue');
    // Without the deck's tenses, every related tense, as before.
    expect(distractors('ser', 'present', 'el', 40)).toContain('fuera');
  });

  it('takes an undrilled tense only when nothing else is left, nearest first', () => {
    // hay in a present-only deck: ha, han, then the preterite before any subjunctive.
    expect(distractors('haber-impersonal', 'present', 'el', 3, { tenses: ['present'] })).toEqual(
      expect.arrayContaining(['ha', 'han', 'hubo']),
    );
    const llueve = distractors('llover', 'present', 'el', 3, { tenses: ['present'] });
    expect(llueve).toHaveLength(3);
    expect(llueve.slice(0, 2).sort()).toEqual(['llove', 'llueven']);
    expect(llueve[2]).toBe('llovió');
  });

  it('never offers an accepted answer with the deck’s tenses either', () => {
    const verbs = [...CORE, 'gustarle', 'dolerle', 'haber-impersonal', 'llover', 'hacer-impersonal'];
    for (const verb of verbs) {
      for (const t of TENSES) {
        for (const tenses of [[t.id], ['present', 'preterite', t.id]] as Tense[][]) {
          for (const cell of cellsFor(verb, [t.id], { vosotros: true })) {
            const accepted = conjugate(verb, cell.tense, cell.person, cell.number) ?? [];
            const list = distractors(verb, cell.tense, cell.person, 4, { number: cell.number, tenses, vosotros: true });
            expect(list.length, `${verb} ${t.id} ${cell.person}`).toBeGreaterThan(0);
            for (const d of list) {
              expect(accepted).not.toContain(d);
              expect(gradeTyped(accepted, d, false, cell.person, entryKind(verb)), `${verb} ${t.id} ${cell.person}: ${d}`).not.toBe('correct');
              expect(gradeTyped(accepted, d, false), `${verb} ${t.id} ${cell.person}: ${d}`).not.toBe('correct');
            }
          }
        }
      }
    }
  }, 60_000); // property sweep: seconds of CPU on a loaded CI runner
});

describe('distractors, the most common wrong form first', () => {
  const sets = (entry: string, tense: Tense, person: Person, opts: Parameters<typeof distractors>[4] & object = {}) =>
    Array.from({ length: 200 }, (_v, seed) => distractors(entry, tense, person, 3, { seed, tenses: [tense], ...opts }));
  const share = (list: string[][], form: string) => list.filter((set) => set.includes(form)).length;

  it('always offers the él/ella form to a yo or tú question ("tiene" for tengo), and one regularized form after it', () => {
    // Before v1.13 "tiene" was in 45 of 200 tener · yo sets.
    expect(share(sets('tener', 'present', 'yo'), 'tiene')).toBe(200);
    expect(sets('tener', 'present', 'yo').every((set) => set.some((d) => d === 'teno' || d === 'tieno'))).toBe(true);
    expect(share(sets('tener', 'present', 'tu'), 'tiene')).toBe(200);
    expect(share(sets('hablar', 'present', 'yo'), 'habla')).toBe(200);
    expect(share(sets('ser', 'present', 'yo'), 'es')).toBe(200);
    expect(share(sets('ir', 'present', 'yo'), 'va')).toBe(200);
    expect(share(sets('llamarse', 'present', 'yo'), 'se llama')).toBe(200);
    expect(share(sets('hablar', 'preterite', 'yo'), 'habló')).toBe(200);
    expect(share(sets('hablar', 'presentPerfect', 'nosotros'), 'ha hablado')).toBe(200);
  });

  it('offers a plural question its singular too ("hablo" for hablamos; "tiene" for tienen)', () => {
    const nosotros = sets('hablar', 'present', 'nosotros');
    expect(share(nosotros, 'habla')).toBe(200);
    expect(share(nosotros, 'hablo')).toBe(200);
    expect(share(sets('tener', 'present', 'nosotros'), 'tengo')).toBe(200);
    expect(share(sets('llamarse', 'present', 'nosotros'), 'me llamo')).toBe(200);
    expect(share(sets('tener', 'present', 'ellos'), 'tiene')).toBe(200);
    // With vosotros, its singular is tú.
    expect(share(sets('hablar', 'present', 'vosotros', { vosotros: true }), 'hablas')).toBe(200);
  });

  it('offers the tú form, then the él form, to a vos question', () => {
    for (const set of sets('tener', 'present', 'vos', { vosRegion: 'rioplatense' })) {
      expect(set.slice(0, 2)).toEqual(['tienes', 'tiene']);
    }
  });

  it('leaves the él form out where it is right or the same as the answer (tenía is yo and él)', () => {
    for (const set of sets('tener', 'imperfect', 'yo')) {
      expect(set).not.toContain('tenía');
      expect(set).toHaveLength(3);
    }
    // An él question has no él form to add, and keeps its variety.
    expect(sets('tener', 'present', 'el').every((set) => set.length === 3 && !set.includes('tiene'))).toBe(true);
    // Commands have no yo: an ustedes command gets the usted one, a nosotros command no yo form.
    expect(share(sets('hablar', 'imperativeAffirmative', 'ellos'), 'hable')).toBe(200);
    expect(sets('hablar', 'imperativeAffirmative', 'nosotros').every((set) => set.length === 3)).toBe(true);
  });

  it('gives a gustar-type question the él/ella experiencer, the other number and the subject conjugation', () => {
    for (const set of sets('gustarle', 'present', 'yo')) {
      expect(set).toContain('le gusta');
      expect(set).toContain('me gustan');
      expect(set.some((d) => d === 'gusto' || d === 'yo gusto')).toBe(true);
    }
    for (const set of sets('gustarle', 'present', 'ellos', { number: 'pl' })) {
      expect(set).toEqual(expect.arrayContaining(['le gustan', 'les gusta']));
    }
    // A le question keeps its wrong experiencers.
    expect(sets('gustarle', 'present', 'el').every((set) => set.includes('le gustan') && set.length === 3)).toBe(true);
  });
});

describe('regularizedVariants', () => {
  it('says how each variant departs from the verb', () => {
    const tener = regularizedVariants('tener', false, 'present', 'yo');
    expect(tener).toEqual(expect.arrayContaining([{ form: 'teno', how: 'regular' }, { form: 'tieno', how: 'stemOnly' }]));
    expect(regularizedVariants('pensar', false, 'present', 'nosotros')).toContainEqual({ form: 'piensamos', how: 'stemEverywhere' });
    expect(regularizedVariants('buscar', false, 'preterite', 'yo')).toContainEqual({ form: 'buscé', how: 'noSpelling' });
    expect(regularizedVariants('sentir', false, 'preterite', 'el')).toContainEqual({ form: 'sentió', how: 'noPreteriteChange' });
    expect(regularizedVariants('llamar', true, 'present', 'yo')).toContainEqual({ form: 'me llamo', how: 'regular' });
    // A one-letter root gives fragments, not mistakes.
    expect(regularizedVariants('ir', false, 'present', 'yo')).toEqual([]);
  });
});
