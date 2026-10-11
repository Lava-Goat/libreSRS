// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { detectVerbs } from '../index.js';
import type { GNumber, Person, Tense } from '../types.js';
import { parseExperiencer, parseSubject, splitSentence, tokenize, validateText, type RuleCode, type SentenceDeck } from './index.js';
import { UNIT_CARDS, UNIT_IDS, unitDeck } from './testUnits.js';

const ALL_CARDS = UNIT_IDS.flatMap((u) => UNIT_CARDS[u]);
const ALL_ENTRIES = UNIT_IDS.flatMap((u) => detectVerbs(UNIT_CARDS[u]).map((v) => v.infinitive));

/** Units 1-4 together, present only (the vocabulary of a Unit 4 student). */
function deck(overrides: Partial<SentenceDeck> = {}): SentenceDeck {
  return { tenses: ['present'], vosotros: false, vos: null, entries: ALL_ENTRIES, cards: ALL_CARDS, ...overrides };
}
const BASE = deck();
const VOSOTROS = deck({ vosotros: true });
const VOS = deck({ vos: 'rioplatense' });
const MULTI = deck({ tenses: ['present', 'preterite'] });
const COMMANDS = deck({ tenses: ['present', 'imperativeNegative', 'imperativeAffirmative'] });
const U1 = unitDeck('U1', detectVerbs(UNIT_CARDS.U1).map((v) => v.infinitive));
const U2 = unitDeck('U2', detectVerbs(UNIT_CARDS.U2).map((v) => v.infinitive));

interface Bad {
  text: string;
  entry: string;
  person: Person;
  rule: RuleCode;
  tense?: Tense;
  number?: GNumber;
  deck?: SentenceDeck;
}

const p = (text: string, entry: string, person: Person, rule: RuleCode, extra: Partial<Bad> = {}): Bad => ({ text, entry, person, rule, ...extra });

/** At least three hand-written bad sentences per rule. */
const BAD: Bad[] = [
  // blank
  p('Mis primos viven en Lima.', 'vivir', 'ellos', 'blank'),
  p('Mis primos ___ (vivir) en ___.', 'vivir', 'ellos', 'blank'),
  p('Mis primos ___ en Lima.', 'vivir', 'ellos', 'blank'),
  // cue
  p('Mis primos ___ (vive) en Lima.', 'vivir', 'ellos', 'cue'),
  p('A mi abuela ___ (gustarle) los gatos.', 'gustarle', 'el', 'cue', { number: 'pl' }),
  p('En la escuela ___ (hay) muchos chicos.', 'haber-impersonal', 'el', 'cue'),
  p('Mi prima ___ (llamar) Ana.', 'llamarse', 'el', 'cue'),
  // notDrilled
  p('Mis primos ___ (vivir) en Lima.', 'vivir', 'ellos', 'notDrilled', { tense: 'preterite' }),
  p('Vosotros ___ (vivir) en Madrid.', 'vivir', 'vosotros', 'notDrilled'),
  p('Vos ___ (tener) quince años.', 'tener', 'vos', 'notDrilled'),
  p('Mis primos ___ (nadar) mucho.', 'nadar', 'ellos', 'notDrilled'),
  // noSubject
  p('___ (vivir) en Lima.', 'vivir', 'ellos', 'noSubject'),
  p('Hoy ___ (llegar) mis primos.', 'llegar', 'ellos', 'noSubject'),
  p('En la foto, ___ (verse) muy jóvenes.', 'verse', 'ellos', 'noSubject'),
  p('Todos los días ___ (estudiar) español.', 'estudiar', 'yo', 'noSubject'),
  // unknownSubject
  p('Primos ___ (vivir) en Lima.', 'vivir', 'ellos', 'unknownSubject'),
  p('Mi abuela de Lima ___ (vivir) con mi primo.', 'vivir', 'el', 'unknownSubject'),
  p('Mi directora ___ (trabajar) en la escuela.', 'trabajar', 'el', 'unknownSubject'),
  p('Mis ___ (vivir) en Lima.', 'vivir', 'ellos', 'unknownSubject'),
  // bannedSubject
  p('Tu hermano ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Su abuela ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Nuestro primo ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Mi familia ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('La gente ___ (hablar) español.', 'hablar', 'el', 'bannedSubject'),
  p('Mi tío o mi tía ___ (vivir) en Lima.', 'vivir', 'ellos', 'bannedSubject'),
  p('Ni mi tío ni mi tía ___ (vivir) en Lima.', 'vivir', 'ellos', 'bannedSubject'),
  p('Mi hermano con mis primos ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Uno de mis primos ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Cada estudiante ___ (leer) un libro.', 'leer', 'el', 'bannedSubject'),
  p('Nadie ___ (vivir) en Lima.', 'vivir', 'el', 'bannedSubject'),
  p('Todo el mundo ___ (hablar) español.', 'hablar', 'el', 'bannedSubject'),
  p('La clase ___ (hablar) español.', 'hablar', 'el', 'bannedSubject'),
  // accent
  p('El ___ (vivir) en Lima.', 'vivir', 'el', 'accent'),
  p('Tu ___ (vivir) en Lima.', 'vivir', 'tu', 'accent'),
  p('A mi ___ (gustar) los perros.', 'gustarle', 'yo', 'accent', { number: 'pl' }),
  p('Él perro ___ (vivir) con mi abuela.', 'vivir', 'el', 'accent'),
  // agreement
  p('La perro ___ (vivir) con mi abuela.', 'vivir', 'el', 'agreement'),
  p('Mis primo ___ (vivir) en Lima.', 'vivir', 'ellos', 'agreement'),
  p('Mi abuela ___ (ser) alto.', 'ser', 'el', 'agreement'),
  p('Mis primos ___ (verse) joven.', 'verse', 'ellos', 'agreement'),
  p('La agua ___ (costar) dos dólares.', 'costar', 'el', 'agreement'),
  p('Mi abuela simpático ___ (vivir) en Lima.', 'vivir', 'el', 'agreement'),
  p('Mi abuela ___ (ser) profesor.', 'ser', 'el', 'agreement'),
  p('Mis primos ___ (ser) mi amigo.', 'ser', 'ellos', 'agreement'),
  // person
  p('Mis primos ___ (vivir) en Lima.', 'vivir', 'el', 'person'),
  p('Mi hermano y yo ___ (vivir) en Lima.', 'vivir', 'ellos', 'person'),
  p('Yo ___ (tener) quince años.', 'tener', 'tu', 'person'),
  p('Vos ___ (tener) quince años.', 'tener', 'tu', 'person'),
  p('A mis primos ___ (gustar) el perro.', 'gustarle', 'el', 'person', { number: 'sg' }),
  p('El café ___ (costar) dos dólares.', 'costar', 'ellos', 'person'),
  // ambiguous (vosotros on: "Ana y tú" is vosotros in Spain, ustedes elsewhere)
  p('Ana y tú ___ (vivir) en Madrid.', 'vivir', 'ellos', 'ambiguous', { deck: VOSOTROS }),
  p('Tú y mi primo ___ (hablar) español.', 'hablar', 'ellos', 'ambiguous', { deck: VOSOTROS }),
  p('Mi hermano y tú ___ (tener) quince años.', 'tener', 'vosotros', 'ambiguous', { deck: VOSOTROS }),
  p('A Ana y a ti ___ (gustar) la escuela.', 'gustarle', 'ellos', 'ambiguous', { deck: VOSOTROS, number: 'sg' }),
  // experiencer
  p('Mi abuela ___ (gustar) los gatos.', 'gustarle', 'el', 'experiencer', { number: 'pl' }),
  p('___ (gustar) la escuela.', 'gustarle', 'yo', 'experiencer', { number: 'sg' }),
  p('A mi abuela ___ (vivir) en Lima.', 'vivir', 'el', 'experiencer'),
  p('A mis primos ___ (comer) pollo.', 'comer', 'ellos', 'experiencer'),
  // thingLiked
  p('A mis primos ___ (gustar) el perro.', 'gustarle', 'ellos', 'thingLiked', { number: 'pl' }),
  p('A mi abuela ___ (gustar) los gatos.', 'gustarle', 'el', 'thingLiked', { number: 'sg' }),
  p('A mi abuela ___ (gustar) mucho.', 'gustarle', 'el', 'thingLiked', { number: 'sg' }),
  p('A mí ___ (gustar).', 'gustarle', 'yo', 'thingLiked', { number: 'sg' }),
  // clitic
  p('A mi abuela le ___ (gustar) los gatos.', 'gustarle', 'el', 'clitic', { number: 'pl' }),
  p('Mi prima se ___ (llamarse) Ana.', 'llamarse', 'el', 'clitic'),
  p('Mis primos se ___ (verse) jóvenes.', 'verse', 'ellos', 'clitic'),
  p('Yo lo ___ (comer) todos los días.', 'comer', 'yo', 'clitic'),
  // le / les doubling: only with an indirect-object verb, an "a + person" after the blank, and agreeing
  p('Yo le ___ (dar) las gracias a mis tías.', 'dar', 'yo', 'clitic'),
  p('Yo les ___ (dar) de comer al perro.', 'dar', 'yo', 'clitic'),
  p('Mi abuela le ___ (dar) el dinero.', 'dar', 'el', 'clitic'),
  p('Mi abuela le ___ (vivir) con mi primo.', 'vivir', 'el', 'clitic'),
  p('Yo le ___ (dar) el libro a la escuela.', 'dar', 'yo', 'clitic'),
  // sameReferent
  p('Mi papá ___ (vivir) con mi padre.', 'vivir', 'el', 'sameReferent'),
  p('Mi madre ___ (conocer) a mi mamá.', 'conocer', 'el', 'sameReferent'),
  p('Mis abuelos le ___ (dar) las gracias a mi abuela.', 'dar', 'ellos', 'sameReferent'),
  p('Mi madre ___ (vivir) con mis padres.', 'vivir', 'el', 'sameReferent'),
  p('Mi amigo ___ (hablar) con mi amigo.', 'hablar', 'el', 'sameReferent'),
  p('Nosotros ___ (ser) mis amigos.', 'ser', 'nosotros', 'sameReferent'),
  p('Yo ___ (ser) mi amiga.', 'ser', 'yo', 'sameReferent'),
  // possessive
  p('Nosotros ___ (vivir) con mi padre.', 'vivir', 'nosotros', 'possessive'),
  p('Mi hermano y yo ___ (vivir) con mi madre.', 'vivir', 'nosotros', 'possessive'),
  p('Nosotras ___ (vivir) con mi familia.', 'vivir', 'nosotros', 'possessive'),
  p('Ana y yo ___ (hablar) con mis abuelos.', 'hablar', 'nosotros', 'possessive'),
  // impersonalSubject
  p('Mi abuela ___ (haber) en la escuela.', 'haber-impersonal', 'el', 'impersonalSubject'),
  p('Los chicos ___ (haber) en la clase.', 'haber-impersonal', 'el', 'impersonalSubject'),
  p('Ella ___ (haber) muchos libros.', 'haber-impersonal', 'el', 'impersonalSubject'),
  // timeWord
  p('Ayer mis primos ___ (vivir) en Lima.', 'vivir', 'ellos', 'timeWord'),
  p('Mis primos ___ (comer) pollo ayer.', 'comer', 'ellos', 'timeWord'),
  p('De niña, mi abuela ___ (vivir) en Lima.', 'vivir', 'el', 'timeWord'),
  p('Ahora mis primos ___ (comer) pollo.', 'comer', 'ellos', 'timeWord', { tense: 'preterite', deck: MULTI }),
  p('Mañana mi abuela ___ (comer) pollo.', 'comer', 'el', 'timeWord', { tense: 'preterite', deck: MULTI }),
  // leak
  p('Yo vivo en Lima y mi hermano ___ (vivir) en Madrid.', 'vivir', 'el', 'leak'),
  p('Mi abuela ___ (tener) quince años y tiene un perro.', 'tener', 'el', 'leak'),
  p('Mis primos ___ (estudiar) para estudiar.', 'estudiar', 'ellos', 'leak'),
  p('A mí ___ (gustar) lo que te gusta.', 'gustarle', 'yo', 'leak', { number: 'sg' }),
  // secondVerb
  p('Mi abuela ___ (vivir) en Lima y trabaja mucho.', 'vivir', 'el', 'secondVerb'),
  p('Mis primos ___ (comer) pollo porque tienen hambre.', 'comer', 'ellos', 'secondVerb'),
  p('Mi prima ___ (llamarse) Ana y es de Lima.', 'llamarse', 'el', 'secondVerb'),
  p('Mi abuela ___ (estar) en la escuela y hay muchos chicos.', 'estar', 'el', 'secondVerb'),
  // vocabulary
  p('Mi abuela ___ (vivir) en Nueva York.', 'vivir', 'el', 'vocabulary'),
  p('Mi abuela ___ (comer) pizza.', 'comer', 'el', 'vocabulary'),
  p('Mis amigos ___ (ir) al mercado.', 'ir', 'ellos', 'vocabulary', { deck: U1 }),
  p('Mi abuela ___ (vivir) en la ciudad.', 'vivir', 'el', 'vocabulary', { deck: U2 }),
  // negativeCommand
  p('Ana, no ___ (comer) las verduras.', 'comer', 'tu', 'negativeCommand', { tense: 'imperativeNegative', deck: COMMANDS }),
  p('No ___ (comer) el pastel.', 'comer', 'el', 'negativeCommand', { tense: 'imperativeNegative', deck: COMMANDS }),
  p('Por favor, no ___ (hablar) en clase.', 'hablar', 'ellos', 'negativeCommand', { tense: 'imperativeNegative', deck: COMMANDS }),
];

describe('the checker rejects bad sentences with the right reason', () => {
  it('has at least 60 cases and at least 3 per rule', () => {
    expect(BAD.length).toBeGreaterThanOrEqual(60);
    const counts = new Map<RuleCode, number>();
    for (const b of BAD) counts.set(b.rule, (counts.get(b.rule) ?? 0) + 1);
    const rules: RuleCode[] = [
      'blank', 'cue', 'notDrilled', 'noSubject', 'unknownSubject', 'bannedSubject', 'accent', 'agreement', 'person',
      'ambiguous', 'experiencer', 'thingLiked', 'clitic', 'impersonalSubject', 'timeWord', 'leak', 'secondVerb',
      'vocabulary', 'negativeCommand', 'sameReferent', 'possessive',
    ];
    for (const r of rules) expect(counts.get(r) ?? 0, r).toBeGreaterThanOrEqual(3);
  });

  for (const b of BAD) {
    it(`${b.rule}: ${b.text}`, () => {
      const cell = { tense: b.tense ?? 'present', person: b.person, ...(b.number ? { number: b.number } : {}) };
      const v = validateText(b.text, b.entry, cell, b.deck ?? BASE);
      expect(v.ok).toBe(false);
      expect(v.reasons.map((r) => r.rule)).toContain(b.rule);
      for (const r of v.reasons) expect(r.message.length).toBeGreaterThan(10);
    });
  }
});

describe('good sentences pass (AI and teacher-written shapes)', () => {
  const good: [string, string, Person, GNumber | undefined, string][] = [
    ['Mis primos ___ (vivir) en Lima.', 'vivir', 'ellos', undefined, 'viven'],
    ['Ana y Luis ___ (vivir) en México.', 'vivir', 'ellos', undefined, 'viven'],
    ['Mi hermano y yo ___ (vivir) en Lima.', 'vivir', 'nosotros', undefined, 'vivimos'],
    ['Ana y yo ___ (estudiar) con mi profesora.', 'estudiar', 'nosotros', undefined, 'estudiamos'],
    ['Mi padre ___ (vivir) con mi madre.', 'vivir', 'el', undefined, 'vive'],
    ['Nosotros ___ (ser) amigos.', 'ser', 'nosotros', undefined, 'somos'],
    ['Yo les ___ (dar) las gracias a mis tías.', 'dar', 'yo', undefined, 'doy'],
    ['Mi madre le ___ (dar) de comer al perro.', 'dar', 'el', undefined, 'da'],
    ['El mesero le ___ (dar) el menú a mi papá.', 'dar', 'el', undefined, 'da'],
    ['Ana les ___ (enseñar) español a Luis y a Mateo.', 'enseñar', 'el', undefined, 'enseña'],
    ['Ana y tú ___ (vivir) en Madrid.', 'vivir', 'ellos', undefined, 'viven'],
    ['Ustedes ___ (hablar) español.', 'hablar', 'ellos', undefined, 'hablan'],
    ['Él ___ (vivir) en Lima.', 'vivir', 'el', undefined, 'vive'],
    ['El perro ___ (vivir) con mi abuela.', 'vivir', 'el', undefined, 'vive'],
    ['Mi prima ___ (llamarse) Ana.', 'llamarse', 'el', undefined, 'se llama'],
    ['En la escuela ___ (haber) muchos chicos.', 'haber-impersonal', 'el', undefined, 'hay'],
    ['Mi abuela no ___ (comer) carne.', 'comer', 'el', undefined, 'come'],
    ['Hola, yo ___ (llamarse) Sofía.', 'llamarse', 'yo', undefined, 'me llamo'],
    ['Todos los días mi abuela ___ (beber) mucha agua.', 'beber', 'el', undefined, 'bebe'],
    ['Mis primos siempre ___ (llegar) tarde a clase.', 'llegar', 'ellos', undefined, 'llegan'],
    ['El agua ___ (costar) dos dólares.', 'costar', 'el', undefined, 'cuesta'],
    ['Las papas ___ (costar) tres dólares.', 'costar', 'ellos', undefined, 'cuestan'],
    ['Mi abuela ___ (ser) muy simpática.', 'ser', 'el', undefined, 'es'],
    ['A mí ___ (gustar) ir a la escuela.', 'gustarle', 'yo', 'sg', 'me gusta'],
    ['Al perro ___ (gustar) el pollo.', 'gustarle', 'el', 'sg', 'le gusta'],
    ['A mi hermano y a mí ___ (gustar) los tacos.', 'gustarle', 'nosotros', 'pl', 'nos gustan'],
    ['Mi abuela, mi abuelo y yo ___ (vivir) en Lima.', 'vivir', 'nosotros', undefined, 'vivimos'],
    ['Mis primos ___ (ser) mis amigos.', 'ser', 'ellos', undefined, 'son'],
    ['La clase ___ (empezar) a las ocho.', 'empezar', 'el', undefined, 'empieza'],
    ['Mi abuela ___ (ser) profesora.', 'ser', 'el', undefined, 'es'],
  ];
  for (const [text, entry, person, number, form] of good) {
    it(text, () => {
      const v = validateText(text, entry, { tense: 'present', person, ...(number ? { number } : {}) }, BASE);
      expect(v.reasons).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.answers[0]).toBe(form);
    });
  }

  it('a negative command written right, with "no" inside the blank, passes', () => {
    const v = validateText('Ana, ___ (comer) las verduras.', 'comer', { tense: 'imperativeNegative', person: 'tu' }, COMMANDS);
    expect(v.reasons).toEqual([]);
    expect(v.answers).toEqual(['no comas']);
  });

  it('a word the teacher approved passes with a warning', () => {
    const d = deck({ approvedWords: ['pizza'] });
    const v = validateText('Mi abuela ___ (comer) pizza.', 'comer', { tense: 'present', person: 'el' }, d);
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.rule)).toEqual(['approvedWord']);
  });

  it('a multi-tense deck warns about a sentence without a time word, and accepts one with an agreeing one', () => {
    const plain = validateText('Mis primos ___ (comer) pollo.', 'comer', { tense: 'preterite', person: 'ellos' }, MULTI);
    expect(plain.ok).toBe(true);
    expect(plain.warnings.map((w) => w.rule)).toEqual(['noTimeWord']);
    const cued = validateText('Ayer mis primos ___ (comer) pollo.', 'comer', { tense: 'preterite', person: 'ellos' }, MULTI);
    expect(cued.ok).toBe(true);
    expect(cued.warnings).toEqual([]);
    expect(cued.answers).toEqual(['comieron']);
    expect(cued.timeWords).toEqual(['ayer']);
  });

  it('"por la mañana" fits any tense; "mañana" alone does not fit the preterite', () => {
    const cell = { tense: 'preterite' as const, person: 'ellos' as const };
    expect(validateText('Mis primos ___ (estudiar) por la mañana.', 'estudiar', cell, MULTI).ok).toBe(true);
    expect(validateText('Mis primos ___ (estudiar) mañana.', 'estudiar', cell, MULTI).reasons.map((r) => r.rule)).toEqual(['timeWord']);
  });
});

describe('gustar: the experiencer and the thing liked are checked apart', () => {
  const cases: [string, Person, GNumber, string][] = [
    ['A mis primos ___ (gustar) el perro.', 'ellos', 'sg', 'les gusta'],
    ['A mi abuela ___ (gustar) los gatos.', 'el', 'pl', 'le gustan'],
    ['A mis primos ___ (gustar) los perros.', 'ellos', 'pl', 'les gustan'],
    ['A mi abuela ___ (gustar) el perro.', 'el', 'sg', 'le gusta'],
    ['A Ana y a Luis ___ (gustar) la escuela.', 'ellos', 'sg', 'les gusta'],
    ['A mí ___ (gustar) el pollo y el arroz.', 'yo', 'pl', 'me gustan'],
  ];
  for (const [text, person, number, form] of cases) {
    it(`${text} → ${form}`, () => {
      const v = validateText(text, 'gustarle', { tense: 'present', person, number }, BASE);
      expect(v.reasons).toEqual([]);
      expect(v.answers).toEqual([form]);
      expect(v.thingNumber).toBe(number);
    });
  }

  it('the plural experiencer does not make the verb plural (and the singular one does not stop gustan)', () => {
    expect(validateText('A mis primos ___ (gustar) el perro.', 'gustarle', { tense: 'present', person: 'ellos', number: 'pl' }, BASE).reasons.map((r) => r.rule)).toEqual(['thingLiked']);
    expect(validateText('A mi abuela ___ (gustar) los gatos.', 'gustarle', { tense: 'present', person: 'el', number: 'sg' }, BASE).reasons.map((r) => r.rule)).toEqual(['thingLiked']);
  });
});

describe('vosotros and vos settings flip the right cases', () => {
  const at = (person: Person) => ({ tense: 'present' as const, person });
  it('"Ana y tú": ustedes with vosotros off, ambiguous with it on', () => {
    expect(validateText('Ana y tú ___ (vivir) en Madrid.', 'vivir', at('ellos'), BASE).ok).toBe(true);
    expect(validateText('Ana y tú ___ (vivir) en Madrid.', 'vivir', at('ellos'), VOSOTROS).reasons.map((r) => r.rule)).toEqual(['ambiguous']);
  });
  it('"Vosotros": not drilled with vosotros off, the vosotros form with it on', () => {
    expect(validateText('Vosotros ___ (vivir) en Madrid.', 'vivir', at('vosotros'), BASE).reasons.map((r) => r.rule)).toContain('notDrilled');
    const on = validateText('Vosotros ___ (vivir) en Madrid.', 'vivir', at('vosotros'), VOSOTROS);
    expect(on.ok).toBe(true);
    expect(on.answers).toEqual(['vivís']);
  });
  it('"Ustedes" stays ellos either way', () => {
    expect(validateText('Ustedes ___ (vivir) en Madrid.', 'vivir', at('ellos'), BASE).ok).toBe(true);
    expect(validateText('Ustedes ___ (vivir) en Madrid.', 'vivir', at('ellos'), VOSOTROS).ok).toBe(true);
  });
  it('"Vos": not drilled with vos off; the voseo form with vos on; never the tú cell', () => {
    expect(validateText('Vos ___ (tener) quince años.', 'tener', at('vos'), BASE).reasons.map((r) => r.rule)).toContain('notDrilled');
    const on = validateText('Vos ___ (tener) quince años.', 'tener', at('vos'), VOS);
    expect(on.ok).toBe(true);
    expect(on.answers).toEqual(['tenés']);
    expect(validateText('Vos ___ (tener) quince años.', 'tener', at('tu'), VOS).reasons.map((r) => r.rule)).toEqual(['person']);
    expect(validateText('Tú ___ (tener) quince años.', 'tener', at('tu'), VOS).answers).toEqual(['tienes']);
    expect(validateText('Tú ___ (tener) quince años.', 'tener', at('vos'), VOS).reasons.map((r) => r.rule)).toEqual(['person']);
  });
  it('"Ana y vos" is ustedes when vos is on and vosotros off', () => {
    expect(validateText('Ana y vos ___ (vivir) en Lima.', 'vivir', at('ellos'), VOS).ok).toBe(true);
  });
});

describe('the subject parser', () => {
  const opts = { vosotros: false };
  const read = (s: string) => {
    const r = parseSubject(tokenize(s), opts);
    return r.ok ? { persons: r.subject.persons, number: r.subject.number, gender: r.subject.gender, en: r.subject.en, kind: r.subject.kind } : r.rule;
  };
  it('maps subjects to engine persons', () => {
    expect(read('mis primos')).toMatchObject({ persons: ['ellos'], number: 'pl', gender: 'm', en: 'my cousins', kind: 'np_pl' });
    expect(read('Ana y Luis')).toMatchObject({ persons: ['ellos'], kind: 'coord' });
    expect(read('mi hermano y yo')).toMatchObject({ persons: ['nosotros'], en: 'my brother and I', kind: 'coord_yo' });
    expect(read('Ana y tú')).toMatchObject({ persons: ['ellos'], en: 'you and Ana', kind: 'coord_tu' });
    expect(read('usted')).toMatchObject({ persons: ['el'], gender: 'x', en: 'you (formal)' });
    expect(read('mi tío y mi tía')).toMatchObject({ persons: ['ellos'], en: 'my aunt and uncle' });
    expect(read('la estudiante')).toMatchObject({ persons: ['el'], gender: 'f' });
    expect(read('el agua')).toMatchObject({ persons: ['el'], kind: 'thing' });
    expect(read('dos estudiantes')).toMatchObject({ persons: ['ellos'] });
  });
  it('reads el / él by the accent', () => {
    expect(read('El perro')).toMatchObject({ persons: ['el'], en: 'the dog' });
    expect(read('Él')).toMatchObject({ persons: ['el'], en: 'he' });
    expect(read('El')).toBe('accent');
  });
  it('reads experiencers to their clitic person', () => {
    const exp = (s: string) => {
      const r = parseExperiencer(tokenize(s), opts);
      return r.ok ? r.subject.persons : r.rule;
    };
    expect(exp('A mi abuela')).toEqual(['el']);
    expect(exp('A mis primos')).toEqual(['ellos']);
    expect(exp('A mí')).toEqual(['yo']);
    expect(exp('Al perro')).toEqual(['el']);
    expect(exp('A mi hermano y a mí')).toEqual(['nosotros']);
    expect(exp('A ti y a Ana')).toEqual(['ellos']);
    expect(exp('A mi')).toBe('accent');
  });
});

describe('splitSentence', () => {
  it('splits a sentence written with a blank and the verb in parentheses', () => {
    expect(splitSentence('Mis primos ___ (vivir) en Lima.')).toEqual({ before: 'Mis primos', cue: 'vivir', after: 'en Lima.' });
    expect(splitSentence('_____ (haber) dos perros.')).toEqual({ before: '', cue: 'haber', after: 'dos perros.' });
    expect(splitSentence('Mis primos viven en Lima.')).toBeNull();
    expect(splitSentence('Mis primos ___ en Lima.')).toBeNull();
  });
});

describe('purity', () => {
  it('validates the same input to the same verdict, with no state carried between calls', () => {
    const text = 'Ana y tú ___ (vivir) en Madrid.';
    const a = validateText(text, 'vivir', { tense: 'present', person: 'ellos' }, VOSOTROS);
    const b = validateText(text, 'vivir', { tense: 'present', person: 'ellos' }, BASE);
    const c = validateText(text, 'vivir', { tense: 'present', person: 'ellos' }, VOSOTROS);
    expect(a).toEqual(c);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
});
