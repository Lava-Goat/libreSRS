// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  canonicalEntry,
  cellsFor,
  conjugate,
  cueFor,
  entryKind,
  entryLabel,
  paradigm,
  parseEntry,
  personLabelFor,
  shortPersonLabelFor,
  subjectGloss,
  subjectPerson,
  subjectsFor,
  TENSE_IDS,
  DATIVE_VERBS,
} from './index.js';
import { GENERIC_CUE_VERBS } from './entries.js';
import type { GNumber, Person, Tense } from './index.js';

const SIX: Person[] = ['yo', 'tu', 'el', 'nosotros', 'vosotros', 'ellos'];
const CLITIC = ['me', 'te', 'le', 'nos', 'os', 'les'];

/**
 * A dative paradigm written by hand as the verb's third person singular and
 * plural ("gusta|gustan"); the helper only adds the clitic, the auxiliary and
 * the -se forms of the imperfect subjunctive.
 */
interface Dative {
  present: string;
  preterite: string;
  imperfect: string;
  future: string;
  conditional: string;
  presentSubjunctive: string;
  /** -ra forms. */
  imperfectSubjunctive: string;
  participle: string;
  gerund: string;
}

const DATIVES: Record<string, Dative> = {
  gustarle: {
    present: 'gusta|gustan',
    preterite: 'gustó|gustaron',
    imperfect: 'gustaba|gustaban',
    future: 'gustará|gustarán',
    conditional: 'gustaría|gustarían',
    presentSubjunctive: 'guste|gusten',
    imperfectSubjunctive: 'gustara|gustaran',
    participle: 'gustado',
    gerund: 'gustando',
  },
  encantarle: {
    present: 'encanta|encantan',
    preterite: 'encantó|encantaron',
    imperfect: 'encantaba|encantaban',
    future: 'encantará|encantarán',
    conditional: 'encantaría|encantarían',
    presentSubjunctive: 'encante|encanten',
    imperfectSubjunctive: 'encantara|encantaran',
    participle: 'encantado',
    gerund: 'encantando',
  },
  dolerle: {
    present: 'duele|duelen',
    preterite: 'dolió|dolieron',
    imperfect: 'dolía|dolían',
    future: 'dolerá|dolerán',
    conditional: 'dolería|dolerían',
    presentSubjunctive: 'duela|duelan',
    imperfectSubjunctive: 'doliera|dolieran',
    participle: 'dolido',
    gerund: 'doliendo',
  },
  parecerle: {
    present: 'parece|parecen',
    preterite: 'pareció|parecieron',
    imperfect: 'parecía|parecían',
    future: 'parecerá|parecerán',
    conditional: 'parecería|parecerían',
    presentSubjunctive: 'parezca|parezcan',
    imperfectSubjunctive: 'pareciera|parecieran',
    participle: 'parecido',
    gerund: 'pareciendo',
  },
  quedarle: {
    present: 'queda|quedan',
    preterite: 'quedó|quedaron',
    imperfect: 'quedaba|quedaban',
    future: 'quedará|quedarán',
    conditional: 'quedaría|quedarían',
    presentSubjunctive: 'quede|queden',
    imperfectSubjunctive: 'quedara|quedaran',
    participle: 'quedado',
    gerund: 'quedando',
  },
  faltarle: {
    present: 'falta|faltan',
    preterite: 'faltó|faltaron',
    imperfect: 'faltaba|faltaban',
    future: 'faltará|faltarán',
    conditional: 'faltaría|faltarían',
    presentSubjunctive: 'falte|falten',
    imperfectSubjunctive: 'faltara|faltaran',
    participle: 'faltado',
    gerund: 'faltando',
  },
};

function expectedDative(d: Dative, number: GNumber): Record<Tense, Partial<Record<Person, string[]>>> {
  const n = number === 'sg' ? 0 : 1;
  const pick = (cell: string): string => cell.split('|')[n];
  const ra = pick(d.imperfectSubjunctive);
  const se = ra.replace(/ra(n?)$/, 'se$1');
  const simple = (forms: string[]): Partial<Record<Person, string[]>> =>
    Object.fromEntries(SIX.map((p, i) => [p, forms.map((f) => `${CLITIC[i]} ${f}`)]));
  return {
    present: simple([pick(d.present)]),
    presentProgressive: simple([`${number === 'sg' ? 'está' : 'están'} ${d.gerund}`]),
    preterite: simple([pick(d.preterite)]),
    imperfect: simple([pick(d.imperfect)]),
    imperativeAffirmative: {},
    imperativeNegative: {},
    future: simple([pick(d.future)]),
    conditional: simple([pick(d.conditional)]),
    presentPerfect: simple([`${number === 'sg' ? 'ha' : 'han'} ${d.participle}`]),
    pluperfect: simple([`${number === 'sg' ? 'había' : 'habían'} ${d.participle}`]),
    presentSubjunctive: simple([pick(d.presentSubjunctive)]),
    imperfectSubjunctive: simple([ra, se]),
  };
}

describe('dative entries (-le)', () => {
  for (const [entry, data] of Object.entries(DATIVES)) {
    for (const number of ['sg', 'pl'] as GNumber[]) {
      it(`${entry} (${number})`, () => {
        expect(paradigm(entry, number)).toEqual(expectedDative(data, number));
      });
    }
  }

  it('defaults to the singular and has no commands', () => {
    expect(conjugate('gustarle', 'present', 'yo')).toEqual(['me gusta']);
    expect(conjugate('gustarle', 'present', 'yo', 'pl')).toEqual(['me gustan']);
    expect(conjugate('gustarle', 'preterite', 'ellos', 'pl')).toEqual(['les gustaron']);
    expect(conjugate('gustarle', 'presentProgressive', 'yo', 'pl')).toEqual(['me están gustando']);
    for (const person of SIX) {
      expect(conjugate('gustarle', 'imperativeAffirmative', person)).toBeNull();
      expect(conjugate('gustarle', 'imperativeNegative', person, 'pl')).toBeNull();
    }
  });

  it('works for any verb, stem changes included', () => {
    expect(conjugate('interesarle', 'present', 'nosotros')).toEqual(['nos interesa']);
    expect(conjugate('importarle', 'present', 'ellos', 'pl')).toEqual(['les importan']);
    expect(conjugate('molestarle', 'imperfect', 'tu')).toEqual(['te molestaba']);
    expect(conjugate('aburrirle', 'present', 'vosotros', 'pl')).toEqual(['os aburren']);
    expect(conjugate('tocarle', 'preterite', 'el')).toEqual(['le tocó']);
    expect(conjugate('preocuparle', 'presentSubjunctive', 'yo', 'pl')).toEqual(['me preocupen']);
    expect(conjugate('fascinarle', 'future', 'tu')).toEqual(['te fascinará']);
    expect(conjugate('caerle', 'present', 'yo')).toEqual(['me cae']);
    expect(conjugate('caerle', 'preterite', 'yo', 'pl')).toEqual(['me cayeron']);
    expect(conjugate('reírle', 'present', 'yo')).toEqual(['me ríe']);
  });
});

describe('impersonal entries', () => {
  it('haber-impersonal: hay, hubo, había…, no progressive, no commands', () => {
    const expected: Record<Tense, string[] | null> = {
      present: ['hay'],
      presentProgressive: null,
      preterite: ['hubo'],
      imperfect: ['había'],
      imperativeAffirmative: null,
      imperativeNegative: null,
      future: ['habrá'],
      conditional: ['habría'],
      presentPerfect: ['ha habido'],
      pluperfect: ['había habido'],
      presentSubjunctive: ['haya'],
      imperfectSubjunctive: ['hubiera', 'hubiese'],
    };
    for (const tense of TENSE_IDS) {
      expect(conjugate('haber-impersonal', tense, 'el'), tense).toEqual(expected[tense]);
      for (const person of SIX.filter((p) => p !== 'el')) expect(conjugate('haber-impersonal', tense, person)).toBeNull();
    }
    // The auxiliary is a separate entry: "ha", never "hay".
    expect(conjugate('haber', 'present', 'el')).toEqual(['ha']);
  });

  it('weather verbs: third person singular only, progressive included', () => {
    const expected: Record<Tense, string[] | null> = {
      present: ['llueve'],
      presentProgressive: ['está lloviendo'],
      preterite: ['llovió'],
      imperfect: ['llovía'],
      imperativeAffirmative: null,
      imperativeNegative: null,
      future: ['lloverá'],
      conditional: ['llovería'],
      presentPerfect: ['ha llovido'],
      pluperfect: ['había llovido'],
      presentSubjunctive: ['llueva'],
      imperfectSubjunctive: ['lloviera', 'lloviese'],
    };
    for (const tense of TENSE_IDS) {
      expect(conjugate('llover', tense, 'el'), tense).toEqual(expected[tense]);
      for (const person of SIX.filter((p) => p !== 'el')) expect(conjugate('llover', tense, person)).toBeNull();
    }
    expect(conjugate('nevar', 'present', 'el')).toEqual(['nieva']);
    expect(conjugate('tronar', 'present', 'el')).toEqual(['truena']);
    expect(conjugate('granizar', 'preterite', 'el')).toEqual(['granizó']);
    expect(conjugate('lloviznar', 'presentProgressive', 'el')).toEqual(['está lloviznando']);
  });

  it('daybreak verbs have an impersonal entry beside the plain one', () => {
    expect(conjugate('amanecer-impersonal', 'present', 'el')).toEqual(['amanece']);
    expect(conjugate('amanecer-impersonal', 'present', 'yo')).toBeNull();
    expect(conjugate('amanecer', 'present', 'yo')).toEqual(['amanezco']);
  });
});

describe('entry ids, kinds and labels', () => {
  it('parses every kind of id', () => {
    expect(entryKind('gustar')).toBe('plain');
    expect(entryKind('gustarse')).toBe('pronominal');
    expect(entryKind('gustarle')).toBe('dative');
    expect(entryKind('haber-impersonal')).toBe('impersonal');
    expect(entryKind('haber')).toBe('plain');
    expect(entryKind('llover')).toBe('impersonal');
    expect(entryKind('amanecer')).toBe('plain');
    expect(entryKind('amanecer-impersonal')).toBe('impersonal');
    expect(parseEntry('gustarle')).toEqual({ id: 'gustarle', base: 'gustar', kind: 'dative' });
    expect(parseEntry('haber (hay)')).toEqual({ id: 'haber-impersonal', base: 'haber', kind: 'impersonal' });
    expect(parseEntry('llover-impersonal')).toEqual({ id: 'llover', base: 'llover', kind: 'impersonal' });
    expect(parseEntry('hablar-impersonal')).toBeNull();
    expect(parseEntry('casa')).toBeNull();
    expect(canonicalEntry(' GUSTARLE ')).toBe('gustarle');
    expect(canonicalEntry('reirle')).toBe('reírle');
  });

  it('labels entries', () => {
    expect(entryLabel('gustarle')).toBe('gustarle');
    expect(entryLabel('llamarse')).toBe('llamarse');
    expect(entryLabel('haber-impersonal')).toBe('haber (hay)');
    expect(entryLabel('amanecer-impersonal')).toBe('amanecer (amanece)');
    expect(entryLabel('llover')).toBe('llover');
    expect(entryLabel('gustar')).toBe('gustar');
  });

  it('labels persons by kind', () => {
    expect(SIX.map((p) => personLabelFor('gustarle', 'present', p))).toEqual([
      'a mí', 'a ti', 'a él / a ella / a usted', 'a nosotros / a nosotras', 'a vosotros / a vosotras',
      'a ellos / a ellas / a ustedes',
    ]);
    expect(personLabelFor('haber-impersonal', 'present', 'el')).toBe('');
    expect(personLabelFor('llover', 'preterite', 'el')).toBe('');
    expect(personLabelFor('hablar', 'present', 'el')).toBe('él / ella / usted');
    expect(personLabelFor('hablar', 'imperativeAffirmative', 'el')).toBe('usted');
    expect(personLabelFor('levantarse', 'imperativeNegative', 'ellos')).toBe('ustedes');
  });

  it('names one real subject at a time for a group, and keeps commands as they were (v1.24.0)', () => {
    expect(SIX.map((p) => subjectsFor('tener', 'present', p))).toEqual([
      ['yo'], ['tú'], ['él', 'ella', 'usted'], ['nosotros', 'nosotras'], ['vosotros', 'vosotras'], ['ellos', 'ellas', 'ustedes'],
    ]);
    expect(subjectsFor('tener', 'present', 'vos')).toEqual(['vos']);
    expect(SIX.map((p) => subjectsFor('gustarle', 'preterite', p))).toEqual([
      ['a mí'], ['a ti'], ['a él', 'a ella', 'a usted'], ['a nosotros', 'a nosotras'], ['a vosotros', 'a vosotras'],
      ['a ellos', 'a ellas', 'a ustedes'],
    ]);
    expect(subjectsFor('haber-impersonal', 'present', 'el')).toEqual([]);
    expect(subjectsFor('llover', 'present', 'el')).toEqual([]);
    // Commands already name who.
    expect(subjectsFor('hablar', 'imperativeAffirmative', 'el')).toEqual(['usted']);
    expect(subjectsFor('hablar', 'imperativeNegative', 'ellos')).toEqual(['ustedes']);
    expect(subjectsFor('hablar', 'imperativeAffirmative', 'nosotros')).toEqual(['nosotros / nosotras']);
  });

  it('labels a group short for the teacher (v1.24.0)', () => {
    expect(SIX.map((p) => shortPersonLabelFor('tener', 'present', p))).toEqual([
      'yo', 'tú', 'él/ella/Ud.', 'nosotros/as', 'vosotros/as', 'ellos/ellas/Uds.',
    ]);
    expect(shortPersonLabelFor('gustarle', 'present', 'ellos')).toBe('a ellos/ellas/Uds.');
    expect(shortPersonLabelFor('gustarle', 'present', 'yo')).toBe('a mí');
    expect(shortPersonLabelFor('hablar', 'imperativeAffirmative', 'ellos')).toBe('ustedes');
    expect(shortPersonLabelFor('haber-impersonal', 'present', 'el')).toBe('');
  });

  it('glosses usted, ustedes and vosotros only, and reads a subject back to its person', () => {
    expect(['usted', 'a usted', 'ustedes', 'a ustedes', 'vosotros', 'vosotras', 'ellos', 'ella', 'yo', 'ellos / ellas / ustedes', null]
      .map(subjectGloss)).toEqual(['youFormal', 'youFormal', 'youAll', 'youAll', 'youAllSpain', 'youAllSpain', null, null, null, null, null]);
    expect(['ustedes', 'ellas', 'a ella', 'a mí', 'a ti', 'nosotras', 'vos', 'a vos', 'ellos / ellas / ustedes', 'mis primos']
      .map(subjectPerson)).toEqual(['ellos', 'ellos', 'el', 'yo', 'tu', 'nosotros', 'vos', 'vos', undefined, undefined]);
  });
});

describe('cellsFor', () => {
  const all = [...TENSE_IDS];

  it('counts the cells of each kind', () => {
    // 10 non-command tenses × persons × 2 numbers.
    expect(cellsFor('gustarle', all, { vosotros: false })).toHaveLength(100);
    expect(cellsFor('gustarle', all, { vosotros: true })).toHaveLength(120);
    // 12 tenses less the two commands and the progressive.
    expect(cellsFor('haber-impersonal', all, { vosotros: true })).toHaveLength(9);
    expect(cellsFor('llover', all, { vosotros: false })).toHaveLength(10);
    // 10 tenses × 5 or 6 persons, plus 2 command tenses × 4 or 5.
    expect(cellsFor('hablar', all, { vosotros: false })).toHaveLength(58);
    expect(cellsFor('hablar', all, { vosotros: true })).toHaveLength(70);
    expect(cellsFor('llamarse', all, { vosotros: true })).toHaveLength(70);
    // soler lacks the future, conditional and commands.
    expect(cellsFor('soler', all, { vosotros: true })).toHaveLength(48);
    // estar and estarse have no progressive of themselves (no "estoy estando"): 70 − 6.
    expect(cellsFor('estar', all, { vosotros: true })).toHaveLength(64);
    expect(cellsFor('estarse', all, { vosotros: true })).toHaveLength(64);
    expect(cellsFor('estar', ['present', 'presentProgressive'], { vosotros: false })).toHaveLength(5);
    expect(cellsFor('casa', all, { vosotros: true })).toEqual([]);
  });

  it('orders cells by tense, person, then number', () => {
    expect(cellsFor('gustarle', ['present', 'imperativeAffirmative'], { vosotros: false }).slice(0, 4)).toEqual([
      { tense: 'present', person: 'yo', number: 'sg' },
      { tense: 'present', person: 'yo', number: 'pl' },
      { tense: 'present', person: 'tu', number: 'sg' },
      { tense: 'present', person: 'tu', number: 'pl' },
    ]);
    expect(cellsFor('haber-impersonal', ['present', 'preterite', 'presentProgressive'], { vosotros: false })).toEqual([
      { tense: 'present', person: 'el' },
      { tense: 'preterite', person: 'el' },
    ]);
    expect(cellsFor('hablar', ['imperativeAffirmative'], { vosotros: false }).map((c) => c.person)).toEqual([
      'tu', 'el', 'nosotros', 'ellos',
    ]);
    expect(cellsFor('hablar', ['present'], { vosotros: true }).every((c) => c.number === undefined)).toBe(true);
  });

  it('gives only cells that have an answer', () => {
    for (const entry of ['gustarle', 'dolerle', 'haber-impersonal', 'llover', 'hablar', 'levantarse', 'soler']) {
      for (const cell of cellsFor(entry, all, { vosotros: true })) {
        expect(conjugate(entry, cell.tense, cell.person, cell.number), `${entry} ${JSON.stringify(cell)}`).not.toBeNull();
      }
    }
  });
});

describe('cueFor', () => {
  const PLURAL = /^(los|las|mis|tus) /;

  it('fixes the number with a noun phrase, verb-specific where it matters', () => {
    const cue = (entry: string, number: GNumber, seed?: number): string | null =>
      cueFor(entry, { tense: 'present', person: 'yo', number }, seed);
    const headSg = ['la cabeza', 'el estómago', 'la espalda', 'la garganta', 'el brazo'];
    const feetPl = ['los pies', 'las piernas', 'los ojos', 'los dientes', 'las manos'];
    for (let seed = 0; seed < 20; seed++) {
      expect(headSg).toContain(cue('dolerle', 'sg', seed));
      expect(feetPl).toContain(cue('dolerle', 'pl', seed));
      expect(cue('quedarle', 'pl', seed)).toMatch(PLURAL);
      expect(cue('faltarle', 'sg', seed)).not.toMatch(PLURAL);
      expect(cue('gustarle', 'sg', seed)).not.toMatch(PLURAL);
      expect(cue('gustarle', 'pl', seed)).toMatch(PLURAL);
      expect(cue('chiflarle', 'pl', seed)).toMatch(PLURAL);
    }
    expect(['el chocolate', 'la música', 'el fútbol', 'la pizza', 'bailar', 'la clase de español']).toContain(
      cue('gustarle', 'sg'),
    );
  });

  it('is deterministic for a seed and varies with it', () => {
    const cell = { tense: 'present' as Tense, person: 'tu' as Person, number: 'pl' as GNumber };
    expect(cueFor('gustarle', cell, 3)).toBe(cueFor('gustarle', cell, 3));
    expect(cueFor('gustarle', cell)).toBe(cueFor('gustarle', cell));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => cueFor('gustarle', cell, s))).size).toBeGreaterThan(1);
  });

  it('is null for other kinds', () => {
    expect(cueFor('gustar', { tense: 'present', person: 'yo' })).toBeNull();
    expect(cueFor('gustarse', { tense: 'present', person: 'yo' })).toBeNull();
    expect(cueFor('haber-impersonal', { tense: 'present', person: 'el' })).toBeNull();
    expect(cueFor('casa', { tense: 'present', person: 'el' })).toBeNull();
  });
});

describe('cueFor, usage audit regressions', () => {
  it('has verb-appropriate cues for every dative verb the dictionary knows', () => {
    for (const verb of DATIVE_VERBS) {
      const sg = cueFor(`${verb}le`, { tense: 'present', person: 'yo', number: 'sg' });
      if (GENERIC_CUE_VERBS.includes(verb)) continue;
      expect(['el chocolate', 'la música', 'el fútbol', 'la pizza', 'bailar', 'la clase de español'], verb).not.toContain(sg);
    }
    expect(['algo', 'algo raro', 'lo mismo', 'un accidente', 'eso']).toContain(cueFor('pasarle', { tense: 'present', person: 'yo', number: 'sg' }));
    expect(['las arañas', 'los fantasmas', 'las serpientes', 'los truenos', 'los payasos']).toContain(
      cueFor('asustarle', { tense: 'present', person: 'yo', number: 'pl' }),
    );
  });

  it('labels hacer-impersonal with its weather form', () => {
    expect(entryLabel('hacer-impersonal')).toBe('hacer (hace)');
    expect(entryKind('hacer-impersonal')).toBe('impersonal');
    expect(cellsFor('hacer-impersonal', ['present', 'preterite', 'presentProgressive', 'imperativeAffirmative'], { vosotros: true }))
      .toEqual([
        { tense: 'present', person: 'el' },
        { tense: 'preterite', person: 'el' },
        { tense: 'presentProgressive', person: 'el' },
      ]);
    expect(conjugate('hacer-impersonal', 'preterite', 'el')).toEqual(['hizo']);
    expect(conjugate('hacer-impersonal', 'presentProgressive', 'el')).toEqual(['está haciendo']);
    expect(conjugate('hacer-impersonal', 'present', 'yo')).toBeNull();
  });
});
