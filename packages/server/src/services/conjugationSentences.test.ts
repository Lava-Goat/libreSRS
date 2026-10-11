// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { detectVerbs, gradeTyped, type Person } from '@libresrs/shared/conjugation';
import { deckContext, parseSubject, tokenize, type SentenceDeck } from '@libresrs/shared/conjugation/sentences';
import { UNIT_CARDS, UNIT_IDS, unitDeck } from '@libresrs/shared/conjugation/sentences/testUnits';
import {
  PROBE_AFTER_MS,
  blankText,
  cellPool,
  cellSentences,
  clientSentence,
  holdbackArm,
  pickPromptSentence,
  planSentence,
  pronounOf,
  refKey,
  sentenceFeedback,
  sentenceGlosses,
  subjectTypeOf,
  subjectsMet,
  withoutContext,
  type PoolSentence,
  type SentenceSourceData,
} from './conjugationSentences.js';

/** A small family deck: the verbs of a first unit and the nouns of a second, as one deck (no earlier decks). */
const FAMILY_CARDS = (
  'es | he/she/it is (ser); soy | I am (ser); tiene | has; tengo | I have; se llama | is named; me llamo | my name is; ' +
  'le gusta | he/she likes; me gusta | I like; vive | lives; vivo | I live; hay | there is / there are; ' +
  'primo / prima | cousin; abuelo / abuela | grandfather / grandmother; perro | dog; gato | cat; mi | my; en | in, on, at; ' +
  'con | with; casa | house; y | and; escuela | school; hermano / hermana | brother / sister; madre / mamá | mother / mom'
).split('; ').map((pair, i) => {
  const [front, back] = pair.split(' | ');
  return { id: i + 1, front, back };
});

function familyDeck(overrides: Partial<SentenceDeck> = {}): SentenceDeck {
  return {
    tenses: ['present'],
    vosotros: false,
    vos: null,
    entries: detectVerbs(FAMILY_CARDS).map((v) => v.infinitive),
    cards: FAMILY_CARDS,
    earlierCards: [],
    approvedWords: [],
    ...overrides,
  };
}

const data = (deck = familyDeck(), more: Partial<SentenceSourceData> = {}): SentenceSourceData => ({
  deck, hidden: new Set(), rows: [], key: `test:${JSON.stringify(deck.tenses)}:${deck.vosotros}:${Math.random()}`, ...more,
});
const cell = (person: Person, number?: 'sg' | 'pl') => ({ tense: 'present' as const, person, ...(number ? { number } : {}) });
const subject = (es: string, vosotros = false) => {
  const r = parseSubject(tokenize(es), { vosotros });
  if (!r.ok) throw new Error(`no subject: ${es}`);
  return r.subject;
};

describe('pools', () => {
  it('draws a cell\'s built-in sentences, each passing the checker, with no answer in the text', () => {
    const d = data();
    const pool = cellPool(d, 'builtIn', 'vivir', cell('ellos'));
    expect(pool.length).toBeGreaterThan(10);
    for (const s of pool) {
      expect(s.cue).toBe('vivir');
      expect(`${s.before} ${s.after}`).not.toMatch(/\bviven\b/i);
      expect(s.ref).toMatch(/^tpl:vivir\./);
      expect(s.subject?.person).toBe('ellos');
    }
    // "Mis primos" stands for ellos, and its words have their glosses from the cards.
    const primos = pool.find((s) => s.before === 'Mis primos');
    expect(primos?.subject).toMatchObject({ es: 'mis primos', pronoun: 'ellos', kind: 'np_pl' });
    expect(primos?.glosses).toEqual(expect.arrayContaining([{ es: 'primos', en: 'cousin' }, { es: 'mis', en: 'my' }]));
  });

  it('is empty when sentences are off, and leaves out a hidden built-in', () => {
    const d = data();
    expect(cellPool(d, 'off', 'vivir', cell('ellos'))).toEqual([]);
    const first = cellPool(d, 'builtIn', 'vivir', cell('ellos'))[0];
    const hid = data(d.deck, { hidden: new Set([first.ref]) });
    expect(cellPool(hid, 'builtIn', 'vivir', cell('ellos')).map((s) => s.ref)).not.toContain(first.ref);
    expect(cellSentences(hid, 'vivir', cell('ellos')).builtIn.find((s) => s.ref === first.ref)?.hidden).toBe(true);
    // Approved rows only: none written yet.
    expect(cellPool(d, 'approved', 'vivir', cell('ellos'))).toEqual([]);
  });

  it('shows an approved written row in "approved" and "both", never a pending one, and parks one the checker rejects', () => {
    const rows = [
      { ref: 'row:1', source: 'teacher' as const, status: 'approved' as const, entry: 'vivir', tense: 'present', person: 'ellos', number: null, text: 'Mis primos ___ (vivir) en Lima.', english: 'My cousins live in Lima.' },
      { ref: 'row:2', source: 'ai' as const, status: 'pending' as const, entry: 'vivir', tense: 'present', person: 'ellos', number: null, text: 'Mis abuelos ___ (vivir) en Madrid.', english: null },
      // "Mi primo" is singular: the cell is ellos.
      { ref: 'row:3', source: 'teacher' as const, status: 'approved' as const, entry: 'vivir', tense: 'present', person: 'ellos', number: null, text: 'Mi primo ___ (vivir) en Lima.', english: null },
    ];
    const d = data(familyDeck(), { rows });
    expect(cellPool(d, 'approved', 'vivir', cell('ellos')).map((s) => s.ref)).toEqual(['row:1']);
    const both = cellPool(d, 'both', 'vivir', cell('ellos'));
    expect(both.map((s) => s.ref)).toContain('row:1');
    expect(both.some((s) => s.ref.startsWith('tpl:'))).toBe(true);
    const parked = cellSentences(d, 'vivir', cell('ellos')).parked;
    expect(parked.map((p) => p.ref)).toContain('row:3');
    expect(parked.find((p) => p.ref === 'row:3')?.reasons[0].rule).toBe('person');
  });

  it('parks a built-in sentence a settings change makes ambiguous (vosotros on: "Ana y tú")', () => {
    const off = cellSentences(data(), 'tener', cell('ellos'));
    expect(off.builtIn.some((s) => s.subject?.es === 'Ana y tú')).toBe(true);
    const on = cellSentences(data(familyDeck({ vosotros: true })), 'tener', cell('ellos'));
    // The bank leaves an ambiguous subject out, so it is not rendered at all, let alone shown.
    expect(on.builtIn.some((s) => s.subject?.es === 'Ana y tú')).toBe(false);
  });

  it('keeps le / les inside the blank: a gustar sentence names the experiencer and the thing liked', () => {
    const pool = cellPool(data(), 'builtIn', 'gustarle', cell('ellos', 'sg'));
    expect(pool.length).toBeGreaterThan(0);
    for (const s of pool) {
      expect(s.cue).toBe('gustar');
      expect(s.before).toMatch(/^A /);
      expect(s.before).not.toMatch(/\bles?$/);
    }
    const mis = pool.find((s) => /^A mis /.test(s.before));
    expect(mis?.subject?.pronoun).toMatch(/^a (ellos|ellas)$/);
  });
});

describe('subjects', () => {
  it('stands a subject for its pronoun (a thing too), and none for a pronoun or usted', () => {
    expect(pronounOf(subject('mis primos'))).toBe('ellos');
    expect(pronounOf(subject('mis primas'))).toBe('ellas');
    expect(pronounOf(subject('mi abuela'))).toBe('ella');
    expect(pronounOf(subject('Luis'))).toBe('él');
    // The speaker's gender is not known: "mi hermana y yo" may be a boy speaking.
    expect(pronounOf(subject('mi hermana y yo'))).toBe('nosotros');
    expect(pronounOf(subject('Ana y Sofía'))).toBe('ellas');
    expect(pronounOf(subject('mi hermano y yo'))).toBe('nosotros');
    expect(pronounOf(subject('Ana y tú'))).toBe('ustedes');
    // A thing is él / ella, ellos / ellas too, as the guide says: "Las mochilas is plural" reads by it.
    expect(pronounOf(subject('las mochilas'))).toBe('ellas');
    expect(pronounOf(subject('el almuerzo'))).toBe('él');
    expect(pronounOf(subject('ustedes'))).toBeNull();
    expect(pronounOf(subject('yo'))).toBeNull();
  });

  it('sorts a sentence\'s subject for the teacher\'s split of person mistakes', () => {
    expect(subjectTypeOf(null)).toBe('label');
    expect(subjectTypeOf('tpl:vivir.city/pr:ustedes/city=lima/present')).toBe('ustedes');
    expect(subjectTypeOf('tpl:vivir.city/pr:usted/city=lima/present')).toBe('usted');
    expect(subjectTypeOf('tpl:vivir.city/pr:ellos/city=lima/present')).toBe('pronoun');
    expect(subjectTypeOf('tpl:vivir.city/np:mis-primos/city=lima/present')).toBe('np_pl');
    expect(subjectTypeOf('tpl:vivir.city/np:mi-abuela/city=lima/present')).toBe('np_sg');
    expect(subjectTypeOf('tpl:vivir.city/name:ana/city=lima/present')).toBe('name');
    expect(subjectTypeOf('tpl:tener.class/co:ana-y-yo/-/present')).toBe('coord_yo');
    expect(subjectTypeOf('tpl:tener.class/co:ana-y-tu/-/present')).toBe('ustedes');
    expect(subjectTypeOf('tpl:tener.class/co:ana-y-luis/-/present')).toBe('coord');
    expect(subjectTypeOf('tpl:gustarle.like/ex:a-ella/like=los-perros/present.pl')).toBe('experiencer');
    expect(subjectTypeOf('tpl:haber-impersonal.city/-/city=lima/present')).toBe('none');
  });

  it('lists the subjects a student met, once each, most recent first, for the guide', () => {
    const met = subjectsMet([
      'tpl:vivir.city/np:mis-primos/city=lima/present',
      'tpl:ser.from/np:mis-primos/city=texas/present',
      'tpl:vivir.city/np:mi-abuela/city=lima/present',
      'tpl:vivir.city/pr:ustedes/city=lima/present',
      'tpl:gustarle.like/ex:a-ella/like=los-perros/present.pl',
      'tpl:haber-impersonal.city/-/city=lima/present',
      'tpl:vivir.city/np:somebody-unknown/city=lima/present',
    ], familyDeck());
    expect(met.map((s) => [s.es, s.pronoun, s.person])).toEqual([
      ['mis primos', 'ellos', 'ellos'],
      ['mi abuela', 'ella', 'el'],
      ['ustedes', null, 'ellos'],
    ]);
  });
});

describe('picking', () => {
  const pool = (): PoolSentence[] => cellPool(data(), 'builtIn', 'vivir', cell('ellos'));

  it('shows the sentence seen least recently, the seed breaking ties, the same every time', () => {
    const list = pool();
    const a = pickPromptSentence(list, 7);
    expect(pickPromptSentence(list, 7)?.ref).toBe(a?.ref);
    // Seen just now: another one comes first.
    const b = pickPromptSentence(list, 7, [refKey(a!.ref)]);
    expect(b?.ref).not.toBe(a?.ref);
    // Every sentence seen: the oldest of them.
    const all = list.map((s) => refKey(s.ref));
    expect(pickPromptSentence(list, 7, all)?.ref).toBe(list[list.length - 1].ref);
    expect(pickPromptSentence([], 1)).toBeNull();
  });

  it('asks a retry with another sentence of the same subject, when the pool has one', () => {
    const list = pool();
    const missed = list.find((s) => s.subjectId === 'np:mis-primos')!;
    const again = pickPromptSentence(list, 3, [refKey(missed.ref)], missed);
    expect(again?.subjectId).toBe('np:mis-primos');
    expect(again?.ref).not.toBe(missed.ref);
  });
});

describe('the holdback', () => {
  it('puts each verb of a student in a fixed half, about half of them each way', () => {
    expect(holdbackArm(12, 'vivir')).toBe(holdbackArm(12, 'vivir'));
    const arms = Array.from({ length: 400 }, (_, i) => holdbackArm(i, 'comer'));
    const sentence = arms.filter((a) => a === 'sentence').length;
    expect(sentence).toBeGreaterThan(160);
    expect(sentence).toBeLessThan(240);
  });

  it('shows the verb\'s half in practice, and the probe either way 50/50 (the first answer 7 days after the first showing)', () => {
    const base = { mode: 'builtIn' as const, holdback: true, direction: 'to' as const, now: 1_000 * PROBE_AFTER_MS, coin: 0.9 };
    const user = Array.from({ length: 50 }, (_, i) => i).find((u) => holdbackArm(u, 'vivir') === 'sentence')!;
    const other = Array.from({ length: 50 }, (_, i) => i).find((u) => holdbackArm(u, 'vivir') === 'label')!;
    expect(planSentence({ ...base, userId: user, entry: 'vivir', firstShownAt: null })).toEqual({ show: true, holdback: { arm: 'sentence', probe: false } });
    expect(planSentence({ ...base, userId: other, entry: 'vivir', firstShownAt: null })).toEqual({ show: false, holdback: { arm: 'label', probe: false } });
    // Six days after the first showing: still practice.
    expect(planSentence({ ...base, userId: other, entry: 'vivir', firstShownAt: base.now - PROBE_AFTER_MS + 1 }).holdback?.probe).toBe(false);
    // Seven: a probe, shown by the coin in either half.
    expect(planSentence({ ...base, userId: other, entry: 'vivir', firstShownAt: base.now - PROBE_AFTER_MS, coin: 0.2 }))
      .toEqual({ show: true, holdback: { arm: 'label', probe: true } });
    expect(planSentence({ ...base, userId: user, entry: 'vivir', firstShownAt: base.now - PROBE_AFTER_MS, coin: 0.7 }))
      .toEqual({ show: false, holdback: { arm: 'sentence', probe: true } });
    // Only the first answer that late is the probe: after it, the verb's half again, whatever the coin.
    for (const coin of [0.2, 0.7]) {
      expect(planSentence({ ...base, userId: other, entry: 'vivir', firstShownAt: base.now - 3 * PROBE_AFTER_MS, probed: true, coin }))
        .toEqual({ show: false, holdback: { arm: 'label', probe: false } });
      expect(planSentence({ ...base, userId: user, entry: 'vivir', firstShownAt: base.now - 3 * PROBE_AFTER_MS, probed: true, coin }))
        .toEqual({ show: true, holdback: { arm: 'sentence', probe: false } });
    }
  });

  it('does nothing when sentences are off, for "name the verb", or without the holdback', () => {
    const base = { holdback: true, userId: 1, entry: 'vivir', firstShownAt: null, now: 0, coin: 0 };
    expect(planSentence({ ...base, mode: 'off', direction: 'to' })).toEqual({ show: false, holdback: null });
    expect(planSentence({ ...base, mode: 'both', direction: 'from' })).toEqual({ show: false, holdback: null });
    expect(planSentence({ ...base, holdback: false, mode: 'builtIn', direction: 'to' })).toEqual({ show: true, holdback: null });
  });
});

describe('withoutContext', () => {
  const trim = (text: string, before: string, after: string, accepted: string[], person: Person = 'ellos', kind: 'regular' | 'pronominal' | 'dative' = 'regular') =>
    withoutContext(text, { before, after }, accepted, (t) => gradeTyped(accepted, t, true, person, kind));

  it('trims a whole or partial echo of the sentence to the blank, accents and capitals forgiven', () => {
    expect(trim('mis primos viven en Lima', 'Mis primos', 'en Lima.', ['viven'])).toBe('viven');
    expect(trim('Mis primos viven', 'Mis primos', 'en Lima.', ['viven'])).toBe('viven');
    expect(trim('viven en lima.', 'Mis primos', 'en Lima.', ['viven'])).toBe('viven');
    expect(trim('primos viven', 'Mis primos', 'en Lima.', ['viven'])).toBe('viven');
    expect(trim('viven en Bogota', 'Ana y Luis', 'en Bogotá.', ['viven'])).toBe('viven');
    expect(trim('ayer mis tios comieron', 'Ayer, mis tíos', 'en un restaurante.', ['comieron'])).toBe('comieron');
  });

  it('never trims a word of the answer: se, no, le', () => {
    expect(trim('mi prima se llama Ana', 'Mi prima', 'Ana.', ['se llama'], 'el', 'pronominal')).toBe('se llama');
    expect(trim('se llama', 'Mi prima', 'Ana.', ['se llama'], 'el', 'pronominal')).toBe('se llama');
    expect(trim('a mi abuela le gustan los gatos', 'A mi abuela', 'los gatos.', ['le gustan'], 'el', 'dative')).toBe('le gustan');
    expect(trim('le gustan los gatos', 'A mi abuela', 'los gatos.', ['le gustan'], 'el', 'dative')).toBe('le gustan');
    // A sentence whose text ends in a word the answer starts with keeps it in the answer.
    expect(trim('no hables en clase', 'Pablo, no', 'en clase.', ['no hables'], 'tu')).toBe('no hables');
  });

  it('keeps a wrong answer\'s verb for the named mistake, and leaves anything else as typed', () => {
    expect(trim('mis primos vive en Lima', 'Mis primos', 'en Lima.', ['viven'])).toBe('vive');
    expect(trim('mi prima llama Ana', 'Mi prima', 'Ana.', ['se llama'], 'el', 'pronominal')).toBe('llama');
    expect(trim('viven', 'Mis primos', 'en Lima.', ['viven'])).toBe('viven');
    expect(trim('ellos viven', 'Mis primos', 'en Lima.', ['viven'])).toBe('ellos viven');
    expect(trim('en Lima', 'Mis primos', 'en Lima.', ['viven'])).toBe('en Lima');
  });
});

describe('views', () => {
  const s = cellPool(data(), 'builtIn', 'vivir', cell('ellos')).find((x) => x.before === 'Mis primos')!;

  it('sends the page the sentence with its blank, the pronoun hint at multiple choice only, and never the answer or the English', () => {
    const choice = clientSentence(s, true);
    expect(choice).toEqual({ before: 'Mis primos', after: s.after, cue: 'vivir', hint: 'ellos', glosses: s.glosses });
    expect(clientSentence(s, false).hint).toBeNull();
    const json = JSON.stringify(choice);
    expect(json).not.toMatch(/viven|live/i);
  });

  it('fills the sentence in after the answer, with its English and "mis primos = ellos → viven"', () => {
    const fb = sentenceFeedback(s, ['viven']);
    expect(fb.filled).toBe(`Mis primos viven ${s.after}`);
    expect(fb.english).toMatch(/^My cousins live /);
    expect(fb.subject).toMatchObject({ es: 'mis primos', pronoun: 'ellos', person: 'ellos', form: 'viven' });
    expect(blankText(s)).toBe(`Mis primos ___ (vivir) ${s.after}`);
    // A pronoun subject is there too (the mistake lines read it), with no pronoun of its own.
    const ustedes = cellPool(data(), 'builtIn', 'vivir', cell('ellos')).find((x) => x.subject?.es === 'ustedes')!;
    expect(sentenceFeedback(ustedes, ['viven']).subject).toMatchObject({ es: 'ustedes', pronoun: null, person: 'ellos' });
  });

  it('glosses only words some card has, from non-verb cards', () => {
    const ctx = deckContext(familyDeck());
    const glosses = sentenceGlosses(ctx, 'Mi abuela', 'en la casa con mi perro.');
    expect(glosses).toEqual(expect.arrayContaining([
      { es: 'mi', en: 'my' }, { es: 'abuela', en: 'grandmother' }, { es: 'casa', en: 'house' }, { es: 'perro', en: 'dog' },
    ]));
    // No card for "la": no gloss; a verb card never glosses.
    expect(glosses.find((g) => g.es === 'la')).toBeUndefined();
    expect(sentenceGlosses(ctx, 'Ella', 'vive.').find((g) => g.es === 'vive')).toBeUndefined();
  });

  it('glosses each word by its own spelling, a phrase card as a whole, in every Unit 1-4 sentence', () => {
    const met = new Map<string, Set<string>>();
    let sentences = 0;
    for (const unit of UNIT_IDS) {
      const deck = unitDeck(unit, detectVerbs(UNIT_CARDS[unit]).map((v) => v.infinitive));
      const d = data(deck);
      for (const [entry, cells] of deckContext(deck).cells) {
        for (const c of cells) {
          for (const s of cellPool(d, 'builtIn', entry, c)) {
            sentences++;
            for (const g of s.glosses) met.set(g.es, (met.get(g.es) ?? new Set()).add(g.en));
          }
        }
      }
    }
    expect(sentences).toBeGreaterThan(5000);
    // él is "he" (its own card), never "the" (el / la); ustedes is "you all", never usted's "you (formal)".
    expect([...met.get('él')!]).toEqual(['he']);
    expect([...met.get('ustedes')!]).toEqual(['you all']);
    expect([...met.get('usted') ?? []]).toEqual(['you (formal)']);
    // "a" is its own card ("to, at"), never the "a" of "a veces"; that phrase and "todos los días" gloss whole.
    expect([...met.get('a')!]).toEqual(['to, at']);
    expect([...met.get('todos los días')!]).toEqual(['every day']);
    expect(met.get('los') ?? new Set()).not.toContain('every day');
    // Two-letter words keep their own meaning: ya is not yo, mí is not mi.
    expect(met.get('ya') ?? new Set()).not.toContain('I');
    expect(met.get('mí') ?? new Set()).not.toContain('my');
    expect([...met.get('mi')!]).toEqual(['my']);
    // A slash card's back, part by part: abuela is grandmother.
    for (const [es, ens] of met) {
      if (es.split(' ').length === 1) expect(ens.size, `${es}: ${[...ens].join(' | ')}`).toBe(1);
    }
  });
});
