// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { cellsFor, conjugate, detectVerbs } from '../index.js';
import type { Tense } from '../types.js';
import {
  coverage,
  filledIn,
  FRAMES,
  pickSentence,
  renderCandidates,
  sentencePool,
  validate,
  type RenderedSentence,
  type SentenceDeck,
} from './index.js';
import { UNIT_CARDS, UNIT_IDS, unitDeck, type UnitId } from './testUnits.js';

/** What detectVerbs finds on each unit's cards. */
const EXPECTED_ENTRIES: Record<UnitId, string[]> = {
  U1: ['ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle'],
  U2: ['verse', 'vivir'],
  U3: [
    'estudiar', 'trabajar', 'hablar', 'escuchar', 'leer', 'escribir', 'aprender', 'enseñar', 'mirar', 'ver', 'oír',
    'decir', 'hacer', 'necesitar', 'poder', 'saber', 'conocer', 'entender', 'pensar', 'creer', 'empezar', 'llegar',
  ],
  U4: [
    'comer', 'beber', 'tomar', 'comprar', 'vender', 'pagar', 'costar', 'pedir', 'dar', 'poner', 'traer', 'llevar',
    'abrir', 'cerrar', 'preferir',
  ],
};

/** Cells with no built-in sentence, on purpose: nobody "costs" (the sample decks have only cuesta / cuestan). */
const EXPECTED_GAPS: Record<UnitId, string[]> = {
  U1: [],
  U2: [],
  U3: [],
  U4: ['costar|yo', 'costar|tu', 'costar|nosotros'],
};

function entriesOf(unit: UnitId): string[] {
  return detectVerbs(UNIT_CARDS[unit]).map((v) => v.infinitive);
}

function deckOf(unit: UnitId, overrides: Partial<SentenceDeck> = {}): SentenceDeck {
  return unitDeck(unit, entriesOf(unit), overrides);
}

interface Failure {
  sentence: string;
  reasons: string[];
}

/** Renders every frame × subject × tense of every drilled cell and checks each with validate(). */
function sweep(deck: SentenceDeck): { count: number; failures: Failure[]; byCell: Map<string, RenderedSentence[]> } {
  const failures: Failure[] = [];
  const byCell = new Map<string, RenderedSentence[]>();
  let count = 0;
  for (const entry of deck.entries) {
    for (const cell of cellsFor(entry, deck.tenses, { vosotros: deck.vosotros, vos: deck.vos })) {
      const list = renderCandidates(entry, cell, deck);
      byCell.set(`${entry}|${cell.tense}|${cell.person}|${cell.number ?? '-'}`, list);
      for (const r of list) {
        count++;
        const v = validate({ entry, cell, before: r.before, after: r.after, cue: r.infinitiveCue }, deck);
        const region = cell.person === 'vos' ? deck.vos ?? undefined : undefined;
        const engine = conjugate(entry, cell.tense, cell.person, cell.number ?? 'sg', region ? { vosRegion: region } : {});
        const problems = v.reasons.map((p) => `${p.rule}: ${p.message}`);
        if (JSON.stringify(r.answers) !== JSON.stringify(engine)) problems.push(`answers ${r.answers} ≠ engine ${engine}`);
        if (JSON.stringify(v.answers) !== JSON.stringify(engine)) problems.push(`checker answers ${v.answers} ≠ engine ${engine}`);
        if (problems.length) failures.push({ sentence: `${entry} ${cell.tense} ${cell.person}: ${r.before} ___ (${r.infinitiveCue}) ${r.after}`, reasons: problems });
      }
    }
  }
  return { count, failures, byCell };
}

describe('unit inventories', () => {
  for (const unit of UNIT_IDS) {
    it(`${unit}: detectVerbs finds the drilled entries the frames were written for`, () => {
      expect(entriesOf(unit)).toEqual(EXPECTED_ENTRIES[unit]);
    });
  }
});

describe('every rendered sentence passes the checker and carries the engine form', () => {
  for (const unit of UNIT_IDS) {
    it(`${unit} (the sample decks' settings: present only, vosotros off, no vos)`, () => {
      const deck = deckOf(unit);
      const { count, failures, byCell } = sweep(deck);
      expect(failures).toEqual([]);
      expect(count).toBeGreaterThan(100);
      const gaps = [...byCell].filter(([, list]) => list.length === 0).map(([k]) => k.split('|').filter((_, i) => i === 0 || i === 2).join('|'));
      expect(gaps).toEqual(EXPECTED_GAPS[unit]);
      // Sentences take turns, so none can be learnt by heart: three or more for every cell that has any.
      const thin = [...byCell].filter(([, list]) => list.length > 0 && list.length < 3).map(([k, list]) => `${k}: ${list.length}`);
      expect(thin).toEqual([]);
      for (const [, list] of byCell) {
        for (const r of list) {
          expect(r.english, filledIn(r)).toBeTruthy();
          expect(filledIn(r)).toContain(r.answers[0]);
          expect(r.before.length).toBeGreaterThan(0);
        }
        // refs are unique within a cell
        expect(new Set(list.map((r) => r.sentenceRef)).size).toBe(list.length);
      }
    });

    it(`${unit}: every entry has at least three frames that render, and the pool equals the candidates`, () => {
      const deck = deckOf(unit);
      for (const entry of deck.entries) {
        const frames = new Set<string>();
        for (const cell of cellsFor(entry, deck.tenses, { vosotros: false })) {
          const cands = renderCandidates(entry, cell, deck);
          expect(sentencePool(entry, cell, deck).length).toBe(cands.length);
          for (const r of cands) frames.add(r.frameId);
        }
        expect(frames.size, entry).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('the coverage line counts the costar gaps only', () => {
    const cov = coverage(deckOf('U4'));
    const costar = cov.find((c) => c.entry === 'costar')!;
    expect(costar.covered).toBe(2);
    expect(costar.missing.map((c) => c.person)).toEqual(['yo', 'tu', 'nosotros']);
    expect(cov.filter((c) => c.entry !== 'costar').every((c) => c.covered === c.cells)).toBe(true);
  });

  it('every frame renders somewhere (a deck with the words and verbs of all four units)', () => {
    const all = UNIT_IDS.flatMap((u) => UNIT_CARDS[u]);
    const deck: SentenceDeck = { tenses: ['present'], vosotros: false, vos: null, entries: UNIT_IDS.flatMap(entriesOf), cards: all };
    const { failures, byCell } = sweep(deck);
    expect(failures).toEqual([]);
    const seen = new Set([...byCell.values()].flat().map((r) => r.frameId));
    const missing = FRAMES.filter((f) => (f.tenses ?? ['present']).includes('present') && !seen.has(f.id)).map((f) => f.id);
    expect(missing).toEqual([]);
  });
});

describe('decks with several tenses', () => {
  const TENSES: Tense[] = ['present', 'preterite', 'imperfect', 'future', 'presentProgressive'];
  for (const unit of UNIT_IDS) {
    it(`${unit} with ${TENSES.length} tenses: every sentence passes; time words agree; English exists`, () => {
      const deck = deckOf(unit, { tenses: TENSES });
      const { failures, byCell } = sweep(deck);
      expect(failures).toEqual([]);
      for (const list of byCell.values()) for (const r of list) expect(r.english, filledIn(r)).toBeTruthy();
    });
  }

  it('adds a time word that rules out the other tenses where the deck knows one', () => {
    const deck = deckOf('U3', { tenses: ['present', 'preterite'] });
    const pret = renderCandidates('estudiar', { tense: 'preterite', person: 'ellos' }, deck);
    expect(pret.length).toBeGreaterThan(0);
    expect(pret.every((r) => r.timeWord === 'ayer')).toBe(true);
    expect(pret[0].before.startsWith('Ayer ')).toBe(true);
    expect(pret[0].english?.startsWith('Yesterday ')).toBe(true);
    const pres = renderCandidates('estudiar', { tense: 'present', person: 'ellos' }, deck);
    // the habit frames get "todos los días"; a frame that already has one keeps only its own
    expect(pres.some((r) => r.timeWord === 'todos los días' && r.after.endsWith('todos los días.'))).toBe(true);
    expect(pres.filter((r) => r.frameId === 'estudiar.everyDay').every((r) => !r.timeWord)).toBe(true);
  });

  it('a Unit 1 deck with several tenses has no time words, so its sentences carry the warning', () => {
    const deck = deckOf('U1', { tenses: ['present', 'preterite'] });
    const r = renderCandidates('ir', { tense: 'preterite', person: 'el' }, deck)[0];
    const v = validate({ entry: 'ir', cell: { tense: 'preterite', person: 'el' }, before: r.before, after: r.after, cue: r.infinitiveCue }, deck);
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.rule)).toEqual(['noTimeWord']);
    expect(r.answers).toEqual(['fue']);
  });
});

describe('vosotros and vos in the renderer', () => {
  it('vosotros on: vosotros cells get sentences, "Ana y tú" leaves the bank, everything passes', () => {
    for (const unit of UNIT_IDS) {
      const deck = deckOf(unit, { vosotros: true });
      const { failures, byCell } = sweep(deck);
      expect(failures).toEqual([]);
      const all = [...byCell.values()].flat();
      expect(all.some((r) => r.cell.person === 'vosotros')).toBe(true);
      expect(all.some((r) => /Ana y tú/.test(r.before))).toBe(false);
    }
    const viv = renderCandidates('vivir', { tense: 'present', person: 'vosotros' }, deckOf('U2', { vosotros: true }));
    expect(viv[0].answers).toEqual(['vivís']);
    expect(viv.some((r) => r.before.startsWith('Vosotras'))).toBe(true);
  });

  it('vos on: vos cells get "Vos" sentences with the region\'s forms', () => {
    for (const unit of UNIT_IDS) {
      const { failures } = sweep(deckOf(unit, { vos: 'rioplatense' }));
      expect(failures).toEqual([]);
    }
    const ten = renderCandidates('tener', { tense: 'present', person: 'vos' }, deckOf('U1', { vos: 'rioplatense' }));
    expect(ten.length).toBeGreaterThan(0);
    expect(ten.every((r) => r.before.startsWith('Vos') && r.answers[0] === 'tenés')).toBe(true);
  });

  it('with vos off there are no vos cells and no "Vos" subjects', () => {
    const { byCell } = sweep(deckOf('U1'));
    expect([...byCell.values()].flat().some((r) => /^Vos\b/.test(r.before))).toBe(false);
  });
});

describe('determinism and rotation', () => {
  const cell = { tense: 'present' as const, person: 'ellos' as const };

  it('the same seed gives the same sentence, also from a fresh deck object', () => {
    const a = sentencePool('vivir', cell, deckOf('U2'));
    const b = sentencePool('vivir', cell, deckOf('U2'));
    expect(a.map((r) => r.sentenceRef)).toEqual(b.map((r) => r.sentenceRef));
    for (const seed of [0, 1, 42, 'student-7|round-3']) {
      expect(pickSentence(a, seed)?.sentenceRef).toBe(pickSentence(b, seed)?.sentenceRef);
    }
  });

  it('different seeds rotate the subjects and frames', () => {
    const pool = sentencePool('vivir', cell, deckOf('U2'));
    const subjects = new Set<string>();
    const frames = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const r = pickSentence(pool, seed)!;
      subjects.add(r.subjectId ?? '');
      frames.add(r.frameId);
    }
    expect(subjects.size).toBeGreaterThanOrEqual(10);
    expect(frames.size).toBeGreaterThanOrEqual(3);
    // the ellos slot's three meanings all come up in the pool: plural nouns, ellos/ellas, ustedes
    const kinds = new Set(pool.map((r) => r.subjectKind));
    expect([...kinds]).toEqual(expect.arrayContaining(['np_pl', 'pronoun', 'coord', 'coord_tu']));
    expect(pool.some((r) => r.before === 'Ustedes')).toBe(true);
  });

  it('the least recently seen sentence wins; unseen ones first', () => {
    const pool = sentencePool('tener', { tense: 'present', person: 'yo' }, deckOf('U1'));
    expect(pool.length).toBeGreaterThanOrEqual(3);
    const seen: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const r = pickSentence(pool, 7, seen)!;
      expect(seen).not.toContain(r.sentenceRef);
      seen.unshift(r.sentenceRef);
    }
    // all seen: the oldest comes back
    expect(pickSentence(pool, 7, seen)?.sentenceRef).toBe(seen[seen.length - 1]);
    expect(pickSentence([], 1)).toBeNull();
  });
});

describe('gustar number agreement in rendered sentences', () => {
  it('the thing liked decides gusta / gustan, whatever the experiencer', () => {
    const deck = deckOf('U1');
    for (const person of ['yo', 'tu', 'el', 'nosotros', 'ellos'] as const) {
      for (const number of ['sg', 'pl'] as const) {
        const cell = { tense: 'present' as const, person, number };
        const pool = sentencePool('gustarle', cell, deck);
        expect(pool.length).toBeGreaterThan(0);
        for (const r of pool) {
          const v = validate({ entry: 'gustarle', cell, before: r.before, after: r.after, cue: r.infinitiveCue }, deck);
          expect(v.thingNumber).toBe(number);
          expect(r.answers[0].endsWith(number === 'sg' ? 'gusta' : 'gustan')).toBe(true);
          expect(r.infinitiveCue).toBe('gustar');
          expect(r.before.startsWith('A')).toBe(true);
        }
      }
    }
    // a plural experiencer with a singular thing: les gusta
    const les = sentencePool('gustarle', { tense: 'present', person: 'ellos', number: 'sg' }, deck);
    expect(les.some((r) => r.before.startsWith('A mis') && r.answers[0] === 'les gusta')).toBe(true);
  });
});

describe('English and complements', () => {
  it('llamarse: "My name is…", "My cousin\'s name is…", "My cousins\' names are…", "Our names are…"', () => {
    const deck = deckOf('U2', { entries: ['llamarse'] });
    const yo = renderCandidates('llamarse', { tense: 'present', person: 'yo' }, deckOf('U1'));
    expect(yo.find((r) => r.frameId === 'llamarse.name')?.english).toMatch(/^My name is [A-ZÁÉÍÓÚ]/);
    const el = renderCandidates('llamarse', { tense: 'present', person: 'el' }, deck);
    expect(el.some((r) => /^My (cousin|grandmother|friend)'s name is /.test(r.english ?? ''))).toBe(true);
    const ellos = renderCandidates('llamarse', { tense: 'present', person: 'ellos' }, deck);
    expect(ellos.some((r) => /^My cousins' names are /.test(r.english ?? ''))).toBe(true);
    const nos = renderCandidates('llamarse', { tense: 'present', person: 'nosotros' }, deck);
    expect(nos.every((r) => /^(Hi, our|Our) names are /.test(r.english ?? ''))).toBe(true);
    // the names follow the subject's gender: mis primas → two girls' names
    const primas = ellos.filter((r) => r.before === 'Mis primas');
    expect(primas.length).toBeGreaterThan(0);
    for (const r of primas) expect(r.after).toMatch(/^(Ana y Sofía|Elena y Rosa|Lucía y Marta)\b/);
  });

  it('costar: a price that suits the thing (a backpack is not two dollars)', () => {
    const deck = deckOf('U4');
    for (const person of ['el', 'ellos'] as const) {
      for (const r of renderCandidates('costar', { tense: 'present', person }, deck)) {
        const n = /(\w+) dólares/.exec(r.after)?.[1];
        if (!n) continue;
        if (/libro|mochila/.test(r.before)) expect(['doce', 'quince', 'veinte', 'veinticinco', 'treinta']).toContain(n);
        if (/café|jugo|helado|manzanas|huevos/.test(r.before)) expect(['dos', 'tres', 'cuatro', 'cinco']).toContain(n);
      }
    }
  });

  it('contractions: a + el → al, de + el → del', () => {
    const deck = deckOf('U4');
    const all = deck.entries.flatMap((e) => cellsFor(e, ['present'], { vosotros: false }).flatMap((c) => renderCandidates(e, c, deck)));
    expect(all.some((r) => /\bal (mesero|chico|perro)\b/i.test(`${r.before} ${r.after}`))).toBe(true);
    const L = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
    const bad = new RegExp(`(^|[^${L}])([Aa]|[Dd]e) el(?![${L}])`);
    expect(all.filter((r) => bad.test(r.before) || bad.test(r.after)).map((r) => `${r.before} ___ ${r.after}`)).toEqual([]);
  });
});


describe('content rules (one test per rule group)', () => {
  const all = UNIT_IDS.flatMap((u) => UNIT_CARDS[u]);
  const deck: SentenceDeck = { tenses: ['present'], vosotros: false, vos: null, entries: UNIT_IDS.flatMap(entriesOf), cards: all };
  const every = deck.entries.flatMap((e) => cellsFor(e, ['present'], { vosotros: false }).flatMap((c) => renderCandidates(e, c, deck)));
  const of = (...ids: string[]) => every.filter((r) => ids.includes(r.frameId));
  const show = (list: RenderedSentence[]) => list.map((r) => filledIn(r));

  it('a complement never names the subject again, in other words or the other gender', () => {
    const groups = [/\b(padres?|papá|madre|mamá)\b/i, /\babuel[oa]s?\b/i, /\bt[íi][oa]s?\b/i, /\bprim[oa]s?\b/i, /\bherman[oa]s?\b/i, /\bamig[oa]s?\b/i, /\bprofesor(a|es|as)?\b/i, /\bmeser[oa]s?\b/i, /\bestudiantes?\b/i];
    const skip = new Set(['tener.friends', 'tener.friendCity']);
    const bad = every.filter((r) => !skip.has(r.frameId) && groups.some((g) => g.test(r.before) && g.test(r.after)));
    expect(show(bad)).toEqual([]);
  });

  it('a "we" subject has no "mi / mis" person after the verb (a native says nuestro)', () => {
    const bad = every.filter((r) => r.cell.person === 'nosotros' && /\b(con|a|al)\s+mis?\s/.test(` ${r.after}`));
    expect(show(bad)).toEqual([]);
    expect(show(every.filter((r) => r.cell.person === 'nosotros' && /mi familia/.test(r.after)))).toEqual([]);
    // and nobody is "my friend" of themselves
    expect(show(every.filter((r) => r.entry === 'ser' && /^(Yo|Nosotr[oa]s|.* y yo)$/.test(r.before) && /^mis? /.test(r.after)))).toEqual([]);
  });

  it('vivir con: parents and grandparents only, never with a teacher, a server, a friend or a name', () => {
    const list = of('vivir.with', 'vivir.cityWith');
    expect(list.length).toBeGreaterThan(20);
    for (const r of list) {
      expect(r.after, filledIn(r)).toMatch(/con mis? (padre|padres|papá|madre|mamá|abuelo|abuela|abuelos)\./);
      expect(r.before, filledIn(r)).not.toMatch(/profesor|meser|amig|chic|Ana|Luis|Sofía|Mateo|Elena|Usted|Tú/);
    }
    // parents and siblings are the family
    expect(show(of('vivir.family').filter((r) => /padre|madre|papá|mamá|herman/.test(r.before)))).toEqual([]);
  });

  it('dar + a person: le / les before the blank agrees with the person; the money goes to one server', () => {
    for (const r of of('dar.thanks', 'dar.money', 'dar.menu', 'dar.feed')) {
      const les = / les$/.test(r.before);
      expect(/ les?$/.test(r.before), filledIn(r)).toBe(true);
      const io = /\b(?:a|al) (.*)\.$/.exec(r.after)![1];
      expect(les, filledIn(r)).toBe(/^(mis|los|las) |^\w+ y /.test(io) || / y a /.test(io));
    }
    for (const r of of('dar.money')) expect(r.after).toMatch(/el dinero (al mesero|a la mesera)\./);
    expect(of('dar.menu').every((r) => !/profesor|meser/.test(r.after))).toBe(true);
  });

  it('food suits the place and the meal', () => {
    expect(show(of('comprar.market', 'comprar.store').filter((r) => /sopa|ensalada|tacos|helado|pollo con arroz/.test(r.after)))).toEqual([]);
    expect(show(of('pedir.food', 'pedir.restaurant').filter((r) => /manzanas|plátanos|huevos|\bpan\b|frijoles|tortillas|queso|pastel/.test(r.after)))).toEqual([]);
    expect(show(of('comer.breakfast').filter((r) => /helado|sopa|tacos|carne/.test(r.after)))).toEqual([]);
    expect(show(of('comer.meal').filter((r) => /desayuno/.test(r.after)))).toEqual([]);
    expect(show(of('beber.breakfast', 'tomar.breakfast').filter((r) => /refresco/.test(r.after)))).toEqual([]);
    expect(show(of('costar.much').filter((r) => !/libro|mochila/.test(r.before)))).toEqual([]);
    expect(show(of('costar.market').filter((r) => /libro|mochila|café/.test(r.before)))).toEqual([]);
    expect(show(of('costar.pesos').filter((r) => /almuerzo|ensalada|pastel|sopa/.test(r.before)))).toEqual([]);
    for (const r of of('cerrar.store').filter((r) => /restaurante/.test(r.before))) expect(r.after).toMatch(/a las (diez|once)\./);
    for (const r of of('cerrar.store').filter((r) => /escuela/.test(r.before))) expect(r.after).toMatch(/a las (cuatro|cinco)\./);
  });

  it('school-safe subjects: no teacher looks or trips, no child pays or works, no adult-only frame for a student', () => {
    const teacher = /profesor|meser/;
    expect(show(every.filter((r) => teacher.test(r.before) && /guap/.test(r.after)))).toEqual([]);
    expect(show(of('querer.cityWith', 'ir.with', 'estudiar.with', 'hacer.with').filter((r) => teacher.test(`${r.before} ${r.after}`)))).toEqual([]);
    expect(show(of('pagar.bill', 'pagar.meal', 'pagar.food', 'pedir.bill', 'trabajar.much', 'dar.money').filter((r) => /niñ/.test(r.before)))).toEqual([]);
    const adultOnly = of('enseñar.spanish', 'enseñar.school', 'enseñar.englishCity', 'tomar.coffee', 'trabajar.school', 'trabajar.city');
    expect(show(adultOnly.filter((r) => /^(Yo|Tú|Nosotr[oa]s|Ana|Luis|Sofía|Mateo|Mi amig|Mi herman|Mi prim|.* y yo$)/.test(r.before)))).toEqual([]);
    expect(show(every.filter((r) => ['beber', 'tomar', 'preferir', 'pedir'].includes(r.entry) && /café/.test(r.after) && /^(Yo|Tú|Ana|Luis|Sofía|Mateo|Mis? amig|Mis? prim|Mis? herman|El chico|La chica|Los chicos|Las chicas)\b/.test(r.before)))).toEqual([]);
    expect(show(of('saber.readWrite').filter((r) => !/niñ/.test(r.before)))).toEqual([]);
    expect(show(of('verse.adj', 'verse.muy', 'verse.photo', 'verse.photoMuy').filter((r) => /jóvenes|joven/.test(r.after) && /chic|niñ|amig|herman|prim|^Yo|^Tú|^Ana|^Luis/.test(r.before)))).toEqual([]);
    expect(show(of('gustarle.no').filter((r) => /profesor/.test(r.before) && /escuela/.test(r.after)))).toEqual([]);
    expect(show(of('hablar.class', 'llegar.late').filter((r) => /^Usted/.test(r.before)))).toEqual([]);
  });

  it('one-off frames are gone or rewritten; schedules have no progressive', () => {
    const ids = new Set(FRAMES.map((f) => f.id));
    for (const gone of ['pensar.person', 'vender.tacos', 'beber.food', 'pagar.price', 'preferir.chicken']) expect(ids.has(gone), gone).toBe(false);
    for (const id of ['empezar.classAt', 'empezar.teacher', 'llegar.early', 'llegar.at', 'comer.breakfast', 'comer.meal', 'hacer.night', 'estudiar.night', 'beber.breakfast', 'tomar.breakfast', 'dar.feed']) {
      expect(FRAMES.find((f) => f.id === id)?.tenses, id).not.toContain('presentProgressive');
    }
    expect(FRAMES.find((f) => f.id === 'tomar.photos')?.es).toBe('{S} ___ muchas fotos.');
  });

  it('a second name or food is of the same kind as the first', () => {
    const female = new Set(['Ana', 'Sofía', 'Elena', 'Lucía', 'Valentina', 'Marta', 'Rosa', 'Gloria', 'Lola']);
    for (const r of of('llamarse.not').filter((r) => r.cell.person === 'yo' || r.cell.person === 'tu')) {
      const [a, b] = /^(\S+), no (\S+)\.$/.exec(r.after)!.slice(1);
      expect(female.has(a), filledIn(r)).toBe(female.has(b));
    }
    expect(show(of('llamarse.also').filter((r) => r.cell.person === 'ellos' || r.cell.person === 'nosotros'))).toEqual([]);
    const dessert = /helado|pastel|fruta/;
    for (const r of of('preferir.notThat')) {
      const [a, b] = r.after.split(', no ');
      expect(dessert.test(a), filledIn(r)).toBe(dessert.test(b));
    }
  });

  it('English: contractions, handsome / pretty, usted is "you (formal)", aunt and uncle, my homework', () => {
    expect(every.filter((r) => /\b(do|does) not\b/.test(r.english ?? '')).map((r) => r.english)).toEqual([]);
    expect(of('creer.no').every((r) => /n't think so\.$/.test(r.english ?? ''))).toBe(true);
    expect(every.filter((r) => /looks? good\b|looks? good-looking/.test(r.english ?? '')).map((r) => r.english)).toEqual([]);
    expect(every.filter((r) => r.before === 'Usted' && r.entry !== 'llamarse').every((r) => /^You \(formal\)/.test(r.english ?? ''))).toBe(true);
    expect(every.some((r) => /^My aunt and uncle /.test(r.english ?? ''))).toBe(true);
    expect(every.some((r) => /^My brothers and sisters /.test(r.english ?? ''))).toBe(true);
    expect(of('hacer.homework').every((r) => /\b(my|your|his|her|our|their) homework\./.test(r.english ?? ''))).toBe(true);
    expect(of('ir.city').filter((r) => r.before === 'Yo').every((r) => /^I am going to /.test(r.english ?? ''))).toBe(true);
    expect(of('conocer.city').every((r) => /very well\.$/.test(r.english ?? ''))).toBe(true);
  });

  it('a plural subject gets one each, not one shared pen', () => {
    for (const r of of('necesitar.thing', 'comprar.thing').filter((r) => r.cell.person === 'ellos' || r.cell.person === 'nosotros')) {
      expect(r.after, filledIn(r)).not.toMatch(/^(un|una) /);
    }
    for (const r of of('llevar.backpack').filter((r) => r.cell.person === 'ellos')) expect(r.after).toBe('las mochilas.');
  });
});
