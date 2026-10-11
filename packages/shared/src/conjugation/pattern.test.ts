// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { lexiconEntries, lexiconInfinitives, patternTags, TENSE_IDS, verbInfo } from './index.js';
import type { PatternTag, Tense } from './index.js';

type Case = [entry: string, tense: Tense, tags: PatternTag[]];

const ORDER: PatternTag[] = [
  'stem:e>ie',
  'stem:o>ue',
  'stem:u>ue',
  'stem:e>i',
  'stem:o>u',
  'stem:i>ie',
  'spelling',
  'accent',
  'y',
  'yo',
  'participle',
  'irregular',
  'regular',
];

describe('patternTags', () => {
  it.each(['hablar', 'comer', 'vivir'])('%s is regular in every tense', (verb) => {
    for (const tense of TENSE_IDS) expect([tense, patternTags(verb, tense)]).toEqual([tense, ['regular']]);
  });

  const expected: Case[] = [
    // Stem changes.
    ['querer', 'present', ['stem:e>ie']],
    ['poder', 'present', ['stem:o>ue']],
    ['jugar', 'present', ['stem:u>ue']],
    ['pedir', 'present', ['stem:e>i']],
    ['pedir', 'preterite', ['stem:e>i']],
    ['dormir', 'preterite', ['stem:o>u']],
    ['dormir', 'presentProgressive', ['stem:o>u']],
    // Stem change plus an irregular yo.
    ['tener', 'present', ['stem:e>ie', 'yo']],
    ['decir', 'present', ['stem:e>i', 'yo']],
    // Only yo.
    ['ver', 'present', ['yo']],
    ['hacer', 'present', ['yo']],
    ['conocer', 'present', ['yo']],
    // Irregular outright (estar: estás, está, están carry an accent the regular forms lack).
    ['ser', 'present', ['irregular']],
    ['ir', 'present', ['irregular']],
    ['estar', 'present', ['irregular']],
    // Spelling changes.
    ['buscar', 'preterite', ['spelling']],
    ['leer', 'preterite', ['spelling']],
    ['empezar', 'present', ['stem:e>ie']],
    ['empezar', 'preterite', ['spelling']],
    // Other tenses.
    ['tener', 'future', ['irregular']],
    ['hacer', 'presentPerfect', ['participle']],
    // vi, vio: monosyllables lose the accent the regular ví, vió would have.
    ['ver', 'preterite', ['irregular']],
    ['ser', 'imperfect', ['irregular']],
    // Entry kinds.
    ['llamarse', 'present', ['regular']],
    ['verse', 'present', ['yo']],
    ['gustarle', 'present', ['regular']],
    ['haber-impersonal', 'present', ['irregular']],
    ['llover', 'present', ['stem:o>ue']],
    // No forms at all.
    ['estar', 'presentProgressive', []],
    ['xyzzy', 'present', []],
  ];

  it.each(expected)('%s %s → %j', (entry, tense, tags) => {
    expect(patternTags(entry, tense)).toEqual(tags);
  });

  const more: Case[] = [
    // A stem change with a spelling change on the same form (sigo, elijo, juegue, empiece, almuerce).
    ['seguir', 'present', ['stem:e>i', 'spelling']],
    ['elegir', 'present', ['stem:e>i', 'spelling']],
    ['jugar', 'presentSubjunctive', ['stem:u>ue', 'spelling']],
    ['empezar', 'presentSubjunctive', ['stem:e>ie', 'spelling']],
    ['almorzar', 'presentSubjunctive', ['stem:o>ue', 'spelling']],
    ['jugar', 'preterite', ['spelling']],
    // -ir boot verbs: both changes of the subjunctive (duerma, durmamos; sienta, sintamos).
    ['dormir', 'presentSubjunctive', ['stem:o>ue', 'stem:o>u']],
    ['sentir', 'presentSubjunctive', ['stem:e>ie', 'stem:e>i']],
    ['sentir', 'present', ['stem:e>ie']],
    ['sentir', 'preterite', ['stem:e>i']],
    ['dormir', 'imperfectSubjunctive', ['stem:o>u']],
    ['pedir', 'presentProgressive', ['stem:e>i']],
    ['decir', 'presentProgressive', ['stem:e>i']],
    ['adquirir', 'present', ['stem:i>ie']],
    ['volver', 'present', ['stem:o>ue']],
    ['almorzar', 'present', ['stem:o>ue']],
    ['pensar', 'present', ['stem:e>ie']],
    ['servir', 'present', ['stem:e>i']],
    ['preferir', 'preterite', ['stem:e>i']],
    ['conseguir', 'preterite', ['stem:e>i']],
    ['morir', 'preterite', ['stem:o>u']],
    // A strong preterite's gerund still has the -ir boot change (pudiendo, viniendo).
    ['poder', 'presentProgressive', ['stem:o>u']],
    ['venir', 'presentProgressive', ['stem:e>i']],
    // Spelled stem changes: huelo (initial ue → hue).
    ['oler', 'present', ['stem:o>ue', 'spelling']],
    // Spelling only: venzo, cojo, distingo, averigüé, busque.
    ['vencer', 'present', ['spelling']],
    ['coger', 'present', ['spelling']],
    ['distinguir', 'present', ['spelling']],
    ['averiguar', 'preterite', ['spelling']],
    ['buscar', 'presentSubjunctive', ['spelling']],
    ['buscar', 'imperativeAffirmative', ['spelling']],
    ['buscar', 'imperativeNegative', ['spelling']],
    // i → y and the hiatus accents: leyera, leído, leyendo, oíste / oyó.
    ['leer', 'imperfectSubjunctive', ['spelling']],
    ['leer', 'presentPerfect', ['spelling']],
    ['leer', 'pluperfect', ['spelling']],
    ['caer', 'preterite', ['spelling']],
    ['llegar', 'preterite', ['spelling']],
    ['almorzar', 'preterite', ['spelling']],
    ['pagar', 'presentSubjunctive', ['spelling']],
    ['dirigir', 'present', ['spelling']],
    ['leer', 'presentProgressive', ['spelling']],
    ['oír', 'preterite', ['spelling']],
    ['construir', 'preterite', ['spelling']],
    // After ñ, ll or i the unstressed i is not written (gruñó, bulló, riñó, rio, riendo).
    ['gruñir', 'preterite', ['spelling']],
    ['bullir', 'presentProgressive', ['spelling']],
    ['reñir', 'preterite', ['stem:e>i', 'spelling']],
    // reír goes like pedir with hiatus accents: río, reímos, rio, riendo.
    ['reír', 'present', ['stem:e>i', 'spelling']],
    ['reír', 'preterite', ['stem:e>i', 'spelling']],
    ['sonreír', 'presentProgressive', ['stem:e>i', 'spelling']],
    // Only yo: doy, sé, salgo, pongo.
    ['dar', 'present', ['yo']],
    ['saber', 'present', ['yo']],
    ['salir', 'present', ['yo']],
    ['poner', 'present', ['yo']],
    ['traer', 'present', ['yo']],
    ['caer', 'present', ['yo']],
    ['conducir', 'present', ['yo']],
    ['venir', 'present', ['stem:e>ie', 'yo']],
    // Irregular participles; the regular tenses around them stay regular.
    ['escribir', 'presentPerfect', ['participle']],
    ['volver', 'pluperfect', ['participle']],
    ['ver', 'presentPerfect', ['participle']],
    ['morir', 'presentPerfect', ['participle']],
    ['romper', 'presentPerfect', ['participle']],
    ['decir', 'presentPerfect', ['participle']],
    // Two participles: the preferred one counts (he frito, he impreso, he provisto).
    ['freír', 'presentPerfect', ['participle']],
    ['imprimir', 'pluperfect', ['participle']],
    ['proveer', 'presentPerfect', ['participle']],
    ['tener', 'presentPerfect', ['regular']],
    ['ir', 'presentPerfect', ['regular']],
    ['ir', 'future', ['regular']],
    // Irregular elsewhere.
    ['ir', 'presentProgressive', ['irregular']],
    ['ir', 'imperfect', ['irregular']],
    // A strong preterite is a stem of its own, not a boot change: pude, pudiste like tuve, tuviste
    // (pudiste, pudimos alone would pass for o → u), and so is its imperfect subjunctive (pudiera).
    ['poder', 'preterite', ['irregular']],
    ['venir', 'preterite', ['irregular']],
    ['tener', 'preterite', ['irregular']],
    ['andar', 'preterite', ['irregular']],
    ['conducir', 'preterite', ['irregular']],
    ['dar', 'preterite', ['irregular']],
    ['poder', 'imperfectSubjunctive', ['irregular']],
    ['venir', 'imperfectSubjunctive', ['irregular']],
    ['tener', 'imperfectSubjunctive', ['irregular']],
    ['poner', 'future', ['irregular']],
    ['salir', 'imperativeAffirmative', ['irregular']],
    // oímos's hiatus accent is not listed apart from oigo, oyes: the tense is learned whole.
    ['oír', 'present', ['irregular']],
    ['hacer', 'imperativeAffirmative', ['irregular']],
    ['tener', 'imperativeAffirmative', ['irregular']],
    ['estar', 'presentSubjunctive', ['irregular']],
    ['estar', 'imperfect', ['regular']],
    // A stressed í / ú (envío, reúno) and the y of -uir verbs (construyo) are patterns of their
    // own, not spelling changes (the sound changes) and not irregular.
    ['enviar', 'present', ['accent']],
    ['esquiar', 'present', ['accent']],
    ['continuar', 'present', ['accent']],
    ['prohibir', 'present', ['accent']],
    ['reunirse', 'present', ['accent']],
    ['graduarse', 'present', ['accent']],
    ['esquiar', 'imperativeAffirmative', ['accent']],
    ['esquiar', 'preterite', ['regular']],
    ['enraizar', 'presentSubjunctive', ['spelling', 'accent']],
    ['construir', 'present', ['y']],
    ['huir', 'present', ['y']],
    ['huir', 'presentSubjunctive', ['y']],
    ['construir', 'imperativeNegative', ['y']],
    ['rehuir', 'present', ['accent', 'y']],
    ['argüir', 'present', ['spelling', 'y']],
    ['construir', 'presentProgressive', ['spelling']],
    // Pronominal entries by their base verb (me acuesto, me visto; levántate is levanta).
    ['acostarse', 'present', ['stem:o>ue']],
    ['vestirse', 'present', ['stem:e>i']],
    ['levantarse', 'imperativeAffirmative', ['regular']],
    ['levantarse', 'presentProgressive', ['regular']],
    ['irse', 'present', ['irregular']],
    ['estarse', 'presentProgressive', []],
    // Dative entries by él / ellos (duele, duelen); no commands.
    ['dolerle', 'present', ['stem:o>ue']],
    ['gustarle', 'preterite', ['regular']],
    ['gustarle', 'imperativeAffirmative', []],
    ['gustarle', 'imperativeNegative', []],
    // Impersonal entries by their él form (hace, hizo, nieva, ha habido, hubo).
    ['hacer-impersonal', 'present', ['regular']],
    ['hacer-impersonal', 'preterite', ['irregular']],
    ['nevar', 'present', ['stem:e>ie']],
    ['haber-impersonal', 'presentPerfect', ['regular']],
    ['haber-impersonal', 'imperfect', ['regular']],
    ['haber-impersonal', 'preterite', ['irregular']],
    ['haber-impersonal', 'presentProgressive', []],
    ['llover', 'imperativeAffirmative', []],
    // Entry spellings the parser accepts.
    ['  Querer ', 'present', ['stem:e>ie']],
    ['haber (hay)', 'present', ['irregular']],
    ['oir', 'preterite', ['spelling']],
    // An alias goes by the verb the engine conjugates: podrir as pudrir (pudría, pudriré; podrido).
    ['podrir', 'imperfect', ['regular']],
    ['podrir', 'future', ['regular']],
    ['podrir', 'presentPerfect', ['participle']],
  ];

  it.each(more)('%s %s → %j', (entry, tense, tags) => {
    expect(patternTags(entry, tense)).toEqual(tags);
  });

  it('keeps its output well-formed for every entry and tense', () => {
    for (const entry of lexiconEntries()) {
      for (const tense of TENSE_IDS) {
        const tags = patternTags(entry, tense);
        const where = `${entry} ${tense}: ${tags.join(', ')}`;
        const ranks = tags.map((t) => ORDER.indexOf(t));
        expect(ranks, where).toEqual([...new Set(ranks)].sort((a, b) => a - b));
        if (tags.includes('regular')) expect(tags, where).toEqual(['regular']);
        expect(tags.includes('yo') && tags.includes('irregular'), where).toBe(false);
        if (tags.includes('irregular')) {
          expect(tags.some((t) => t === 'spelling' || t === 'accent' || t === 'y'), where).toBe(false);
        }
        if (tags.includes('accent') || tags.includes('y')) {
          expect(['present', 'presentSubjunctive', 'imperativeAffirmative', 'imperativeNegative'], where).toContain(tense);
        }
        if (tags.includes('participle')) expect(['presentPerfect', 'pluperfect'], where).toContain(tense);
        if (tense === 'presentPerfect' || tense === 'pluperfect') {
          expect(tags.some((t) => t.startsWith('stem:') || t === 'yo' || t === 'irregular'), where).toBe(false);
        }
      }
    }
  });

  it('tags every verb of the regular model regular wherever it has forms', () => {
    for (const verb of lexiconInfinitives()) {
      if (verbInfo(verb).model !== 'regular') continue;
      for (const tense of TENSE_IDS) {
        const tags = patternTags(verb, tense);
        if (tags.length > 0) expect(tags, `${verb} ${tense}`).toEqual(['regular']);
      }
    }
  });

  it('finds the model’s stem change in the present of every boot verb', () => {
    const TAG: Record<string, PatternTag> = {
      'e>ie': 'stem:e>ie',
      'e>ie/i': 'stem:e>ie',
      'o>ue': 'stem:o>ue',
      'o>ue/u': 'stem:o>ue',
      'u>ue': 'stem:u>ue',
      'e>i': 'stem:e>i',
      'i>ie': 'stem:i>ie',
    };
    let seen = 0;
    for (const verb of lexiconInfinitives()) {
      // "e>ie, g>gu", "mover (o>ue)", "volver (o>ue, participle vuelto)" → the first change.
      const model = (verbInfo(verb).model ?? '').replace(/^.*\(|\)$/g, '').split(', ')[0];
      if (!TAG[model]) continue;
      seen++;
      expect(patternTags(verb, 'present'), verb).toContain(TAG[model]);
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('gives the accent and -uir models their own tags, never irregular, in the present', () => {
    let seen = 0;
    for (const verb of lexiconInfinitives()) {
      const model = verbInfo(verb).model ?? '';
      const tag = model.startsWith('stressed í/ú') ? 'accent' : model.includes('-uir: i>y') ? 'y' : null;
      if (!tag) continue;
      seen++;
      const tags = patternTags(verb, 'present');
      expect(tags, verb).toContain(tag);
      expect(tags, verb).not.toContain('irregular');
    }
    expect(seen).toBeGreaterThan(70);
  });

  it('is deterministic and hands back a fresh array', () => {
    const a = patternTags('tener', 'present');
    a.push('regular');
    expect(patternTags('tener', 'present')).toEqual(['stem:e>ie', 'yo']);
  });
});
