// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Voseo: the vos person in both regions a deck can pick (NGLE §4.7, DPD "voseo").
 * The paradigms below are written out by hand, not derived from the engine.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  analyzeIgnoringAccents,
  attachEnclitic,
  cellsFor,
  conjugate,
  detectVerbs,
  distractors,
  EXPERIENCER_LABELS,
  gradeTyped,
  isPerson,
  isVosRegion,
  lexiconInfinitives,
  paradigm,
  PERSON_IDS,
  PERSONS,
  personLabel,
  personLabelFor,
  TENSE_IDS,
  TENSES,
  VOS_REGIONS,
} from './index.js';
import type { Tense, VosRegion } from './index.js';

const REGIONS: VosRegion[] = ['rioplatense', 'centroamericano'];

/**
 * present / affirmative command / tuteo subjunctive / voseante subjunctive /
 * preterite / imperfect / future / conditional / -ra / -se / participle / gerund
 * ("-" for no progressive: estar has none of itself, no "estás estando").
 * Alternatives inside a field are separated by "|", canonical first.
 */
const PLAIN: Record<string, string> = {
  hablar: 'hablás / hablá / hables / hablés / hablaste / hablabas / hablarás / hablarías / hablaras / hablases / hablado / hablando',
  comer: 'comés / comé / comas / comás / comiste / comías / comerás / comerías / comieras / comieses / comido / comiendo',
  vivir: 'vivís / viví / vivas / vivás / viviste / vivías / vivirás / vivirías / vivieras / vivieses / vivido / viviendo',
  ser: 'sos / sé / seas / seás / fuiste / eras / serás / serías / fueras / fueses / sido / siendo',
  ir: 'vas / andá / vayas / vayás / fuiste / ibas / irás / irías / fueras / fueses / ido / yendo',
  estar: 'estás / está / estés / estés / estuviste / estabas / estarás / estarías / estuvieras / estuvieses / estado / -',
  dar: 'das / da / des / des / diste / dabas / darás / darías / dieras / dieses / dado / dando',
  ver: 'ves / ve / veas / veás / viste / veías / verás / verías / vieras / vieses / visto / viendo',
  haber: 'has / habé / hayas / hayás / hubiste / habías / habrás / habrías / hubieras / hubieses / habido / habiendo',
  tener: 'tenés / tené / tengas / tengás / tuviste / tenías / tendrás / tendrías / tuvieras / tuvieses / tenido / teniendo',
  venir: 'venís / vení / vengas / vengás / viniste / venías / vendrás / vendrías / vinieras / vinieses / venido / viniendo',
  decir: 'decís / decí / digas / digás / dijiste / decías / dirás / dirías / dijeras / dijeses / dicho / diciendo',
  hacer: 'hacés / hacé / hagas / hagás / hiciste / hacías / harás / harías / hicieras / hicieses / hecho / haciendo',
  poner: 'ponés / poné / pongas / pongás / pusiste / ponías / pondrás / pondrías / pusieras / pusieses / puesto / poniendo',
  salir: 'salís / salí / salgas / salgás / saliste / salías / saldrás / saldrías / salieras / salieses / salido / saliendo',
  traer: 'traés / traé / traigas / traigás / trajiste / traías / traerás / traerías / trajeras / trajeses / traído / trayendo',
  valer: 'valés / valé / valgas / valgás / valiste / valías / valdrás / valdrías / valieras / valieses / valido / valiendo',
  saber: 'sabés / sabé / sepas / sepás / supiste / sabías / sabrás / sabrías / supieras / supieses / sabido / sabiendo',
  caber: 'cabés / cabé / quepas / quepás / cupiste / cabías / cabrás / cabrías / cupieras / cupieses / cabido / cabiendo',
  oír: 'oís / oí / oigas / oigás / oíste / oías / oirás / oirías / oyeras / oyeses / oído / oyendo',
  reír: 'reís / reí / rías / rias|riás / reíste / reías / reirás / reirías / rieras / rieses / reído / riendo',
  querer: 'querés / queré / quieras / querás / quisiste / querías / querrás / querrías / quisieras / quisieses / querido / queriendo',
  poder: 'podés / podé / puedas / podás / pudiste / podías / podrás / podrías / pudieras / pudieses / podido / pudiendo',
  pensar: 'pensás / pensá / pienses / pensés / pensaste / pensabas / pensarás / pensarías / pensaras / pensases / pensado / pensando',
  contar: 'contás / contá / cuentes / contés / contaste / contabas / contarás / contarías / contaras / contases / contado / contando',
  jugar: 'jugás / jugá / juegues / jugués / jugaste / jugabas / jugarás / jugarías / jugaras / jugases / jugado / jugando',
  pedir: 'pedís / pedí / pidas / pidás / pediste / pedías / pedirás / pedirías / pidieras / pidieses / pedido / pidiendo',
  dormir: 'dormís / dormí / duermas / durmás / dormiste / dormías / dormirás / dormirías / durmieras / durmieses / dormido / durmiendo',
  sentir: 'sentís / sentí / sientas / sintás / sentiste / sentías / sentirás / sentirías / sintieras / sintieses / sentido / sintiendo',
  conocer: 'conocés / conocé / conozcas / conozcás / conociste / conocías / conocerás / conocerías / conocieras / conocieses / conocido / conociendo',
  conducir: 'conducís / conducí / conduzcas / conduzcás / condujiste / conducías / conducirás / conducirías / condujeras / condujeses / conducido / conduciendo',
  construir: 'construís / construí / construyas / construyás / construiste / construías / construirás / construirías / construyeras / construyeses / construido / construyendo',
  huir: 'huis|huís / hui|huí / huyas / huyás / huiste / huías / huirás / huirías / huyeras / huyeses / huido / huyendo',
  enviar: 'enviás / enviá / envíes / enviés / enviaste / enviabas / enviarás / enviarías / enviaras / enviases / enviado / enviando',
  continuar: 'continuás / continuá / continúes / continués / continuaste / continuabas / continuarás / continuarías / continuaras / continuases / continuado / continuando',
  prohibir: 'prohibís / prohibí / prohíbas / prohibás / prohibiste / prohibías / prohibirás / prohibirías / prohibieras / prohibieses / prohibido / prohibiendo',
  reunir: 'reunís / reuní / reúnas / reunás / reuniste / reunías / reunirás / reunirías / reunieras / reunieses / reunido / reuniendo',
  leer: 'leés / leé / leas / leás / leíste / leías / leerás / leerías / leyeras / leyeses / leído / leyendo',
  caer: 'caés / caé / caigas / caigás / caíste / caías / caerás / caerías / cayeras / cayeses / caído / cayendo',
  seguir: 'seguís / seguí / sigas / sigás / seguiste / seguías / seguirás / seguirías / siguieras / siguieses / seguido / siguiendo',
  elegir: 'elegís / elegí / elijas / elijás / elegiste / elegías / elegirás / elegirías / eligieras / eligieses / elegido / eligiendo',
  buscar: 'buscás / buscá / busques / busqués / buscaste / buscabas / buscarás / buscarías / buscaras / buscases / buscado / buscando',
  empezar: 'empezás / empezá / empieces / empecés / empezaste / empezabas / empezarás / empezarías / empezaras / empezases / empezado / empezando',
  obtener: 'obtenés / obtené / obtengas / obtengás / obtuviste / obtenías / obtendrás / obtendrías / obtuvieras / obtuvieses / obtenido / obteniendo',
  predecir: 'predecís / predecí / predigas / predigás / predijiste / predecías / predecirás|predirás / predecirías|predirías / predijeras / predijeses / predicho / prediciendo',
  prever: 'prevés / prevé / preveas / preveás / previste / preveías / preverás / preverías / previeras / previeses / previsto / previendo',
};

/** Pronominal verbs: the fields without "te"; the command with its enclitic; then the gerund with "te" attached. */
const PRONOMINAL: Record<string, string> = {
  llamarse: 'llamás / llamate / llames / llamés / llamaste / llamabas / llamarás / llamarías / llamaras / llamases / llamado / llamando / llamándote',
  levantarse: 'levantás / levantate / levantes / levantés / levantaste / levantabas / levantarás / levantarías / levantaras / levantases / levantado / levantando / levantándote',
  irse: 'vas / andate / vayas / vayás / fuiste / ibas / irás / irías / fueras / fueses / ido / yendo / yéndote',
  vestirse: 'vestís / vestite / vistas / vistás / vestiste / vestías / vestirás / vestirías / vistieras / vistieses / vestido / vistiendo / vistiéndote',
  acostarse: 'acostás / acostate / acuestes / acostés / acostaste / acostabas / acostarás / acostarías / acostaras / acostases / acostado / acostando / acostándote',
  sentarse: 'sentás / sentate / sientes / sentés / sentaste / sentabas / sentarás / sentarías / sentaras / sentases / sentado / sentando / sentándote',
  dormirse: 'dormís / dormite / duermas / durmás / dormiste / dormías / dormirás / dormirías / durmieras / durmieses / dormido / durmiendo / durmiéndote',
  ponerse: 'ponés / ponete / pongas / pongás / pusiste / ponías / pondrás / pondrías / pusieras / pusieses / puesto / poniendo / poniéndote',
};

const uniq = (list: string[]): string[] => list.filter((v, i) => list.indexOf(v) === i);

function expected(data: string, region: VosRegion, reflexive: boolean): Record<Tense, string[] | null> {
  const [pres, imp, subjTu, subjVos, pret, impf, fut, cond, ra, se, pp, ger, gerTe] = data.split(' / ').map((f) => f.split('|'));
  const te = (list: string[]): string[] => (reflexive ? list.map((f) => `te ${f}`) : list);
  const subj = region === 'centroamericano' ? uniq([...subjVos, ...subjTu]) : uniq([...subjTu, ...subjVos]);
  return {
    present: te(pres),
    imperativeAffirmative: imp,
    presentSubjunctive: te(subj),
    imperativeNegative: subj.map((f) => (reflexive ? `no te ${f}` : `no ${f}`)),
    preterite: te(pret),
    imperfect: te(impf),
    future: te(fut),
    conditional: te(cond),
    imperfectSubjunctive: te([...ra, ...se]),
    presentPerfect: te(pp.map((p) => `has ${p}`)),
    pluperfect: te(pp.map((p) => `habías ${p}`)),
    presentProgressive: ger[0] === '-'
      ? null
      : reflexive
      ? [...ger.map((g) => `te estás ${g}`), ...gerTe.map((g) => `estás ${g}`)]
      : ger.map((g) => `estás ${g}`),
  };
}

describe('vos paradigms, both regions', () => {
  it('covers at least thirty verbs', () => {
    expect(Object.keys(PLAIN).length + Object.keys(PRONOMINAL).length).toBeGreaterThanOrEqual(30);
  });
  for (const [table, reflexive] of [[PLAIN, false], [PRONOMINAL, true]] as const) {
    for (const [verb, data] of Object.entries(table)) {
      for (const region of REGIONS) {
        it(`${verb} (${region})`, () => {
          const want = expected(data, region, reflexive);
          for (const tense of TENSE_IDS) {
            expect([tense, conjugate(verb, tense, 'vos', 'sg', { vosRegion: region })]).toEqual([tense, want[tense]]);
          }
        });
      }
    }
  }
});

describe('vos grammar points', () => {
  const vos = (verb: string, tense: Tense, region: VosRegion = 'rioplatense') =>
    conjugate(verb, tense, 'vos', 'sg', { vosRegion: region });

  it('defaults to the Río de la Plata region', () => {
    for (const tense of TENSE_IDS) expect(conjugate('tener', tense, 'vos')).toEqual(vos('tener', tense, 'rioplatense'));
  });

  it('puts the tuteo subjunctive first in the Río de la Plata and the voseante one first in Central America, accepting both', () => {
    expect(vos('hablar', 'presentSubjunctive', 'rioplatense')).toEqual(['hables', 'hablés']);
    expect(vos('hablar', 'presentSubjunctive', 'centroamericano')).toEqual(['hablés', 'hables']);
    expect(vos('hablar', 'imperativeNegative', 'rioplatense')).toEqual(['no hables', 'no hablés']);
    expect(vos('hablar', 'imperativeNegative', 'centroamericano')).toEqual(['no hablés', 'no hables']);
    expect(vos('irse', 'imperativeNegative', 'centroamericano')).toEqual(['no te vayás', 'no te vayas']);
    expect(vos('comer', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('comás');
    expect(vos('vivir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('vivás');
    expect(vos('decir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('digás');
    expect(vos('tener', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('tengás');
  });

  it('differs between the regions only in the present subjunctive and the negative command', () => {
    const verbs = [...Object.keys(PLAIN), ...Object.keys(PRONOMINAL), ...lexiconInfinitives().filter((_v, i) => i % 29 === 0)];
    for (const verb of verbs) {
      for (const tense of TENSE_IDS) {
        const rp = vos(verb, tense, 'rioplatense');
        const ca = vos(verb, tense, 'centroamericano');
        if (tense === 'presentSubjunctive' || tense === 'imperativeNegative') {
          expect([verb, tense, [...(rp ?? [])].sort()]).toEqual([verb, tense, [...(ca ?? [])].sort()]);
        } else {
          expect([verb, tense, rp]).toEqual([verb, tense, ca]);
        }
      }
    }
  }, 60_000); // property sweep: seconds of CPU on a loaded CI runner

  it('is tú outside the present, the commands and the present subjunctive', () => {
    const same: Tense[] = ['preterite', 'imperfect', 'future', 'conditional', 'imperfectSubjunctive', 'presentPerfect', 'pluperfect', 'presentProgressive'];
    for (const verb of lexiconInfinitives().filter((_v, i) => i % 13 === 0)) {
      for (const tense of same) expect([verb, tense, vos(verb, tense)]).toEqual([verb, tense, conjugate(verb, tense, 'tu')]);
    }
  });

  it('never stem-changes the present or the voseante subjunctive (the vosotros form without its i)', () => {
    for (const verb of lexiconInfinitives().filter((v, i) => i % 7 === 0 && !v.endsWith('se'))) {
      const strip = (f: string): string => f.replace(/([aeoáéó])is$/, '$1s');
      const vosotros = (conjugate(verb, 'present', 'vosotros') ?? []).map(strip);
      if (verb === 'haber') continue;
      for (const f of vos(verb, 'present') ?? []) {
        // RAE 2010 respells the monosyllables (fiais → fias), so compare without accents on those.
        expect([verb, vosotros.some((v) => v === f || v.normalize('NFD').replace(/́/g, '') === f)]).toEqual([verb, true]);
      }
    }
    expect(vos('querer', 'present')).toEqual(['querés']);
    expect(vos('poder', 'present')).toEqual(['podés']);
    expect(vos('jugar', 'present')).toEqual(['jugás']);
    expect(vos('pensar', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('pensés');
    expect(vos('querer', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('querás');
  });

  it('keeps the -ir weak-stem change in the voseante subjunctive (durmás, pidás, sintás)', () => {
    expect(vos('dormir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('durmás');
    expect(vos('pedir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('pidás');
    expect(vos('sentir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('sintás');
    expect(vos('morir', 'presentSubjunctive', 'centroamericano')?.[0]).toBe('murás');
  });

  // Regression (vos key adjudication): erguir was missing from the lexicon and
  // conjugated as a regular verb (ergas / ergás, ergue, ergó). DPD "erguir":
  // yergo | irgo where the stem is stressed, i before a / ió / ie elsewhere.
  it('conjugates erguir with its two stressed series and the closed weak stem', () => {
    expect(conjugate('erguir', 'present', 'yo')).toEqual(['yergo', 'irgo']);
    expect(conjugate('erguir', 'present', 'tu')).toEqual(['yergues', 'irgues']);
    expect(conjugate('erguir', 'preterite', 'el')).toEqual(['irguió']);
    expect(conjugate('erguir', 'presentSubjunctive', 'nosotros')).toEqual(['irgamos']);
    expect(conjugate('erguir', 'imperativeAffirmative', 'tu')).toEqual(['yergue', 'irgue']);
    expect(conjugate('erguir', 'presentProgressive', 'el')).toEqual(['está irguiendo']);
    expect(vos('erguir', 'present')).toEqual(['erguís']);
    expect(vos('erguir', 'imperativeAffirmative')).toEqual(['erguí']);
    expect(vos('erguir', 'presentSubjunctive', 'centroamericano')).toEqual(['irgás', 'yergas', 'irgas']);
    expect(vos('erguir', 'presentSubjunctive', 'rioplatense')).toEqual(['yergas', 'irgas', 'irgás']);
    expect(vos('erguirse', 'imperativeAffirmative')).toEqual(['erguite']);
  });

  it('writes monosyllables without an accent, apart from the diacritic sé', () => {
    expect(vos('dar', 'imperativeAffirmative')).toEqual(['da']);
    expect(vos('ver', 'imperativeAffirmative')).toEqual(['ve']);
    expect(vos('ser', 'imperativeAffirmative')).toEqual(['sé']);
    expect(vos('dar', 'presentSubjunctive')).toEqual(['des']);
    expect(vos('fiar', 'present')).toEqual(['fias', 'fiás']);
    expect(vos('guiar', 'imperativeAffirmative')).toEqual(['guia', 'guiá']);
  });

  it('places enclitics by the stress rules', () => {
    expect(vos('estarse', 'imperativeAffirmative')).toEqual(['estate']);
    expect(vos('darse', 'imperativeAffirmative')).toEqual(['date']);
    expect(vos('reírse', 'imperativeAffirmative')).toEqual(['reíte']);
    expect(attachEnclitic('decí', 'me')).toBe('decime');
    expect(attachEnclitic('contá', 'me')).toBe('contame');
    expect(attachEnclitic(attachEnclitic('da', 'me'), 'lo')).toBe('dámelo');
    expect(attachEnclitic(attachEnclitic('decí', 'me'), 'lo')).toBe('decímelo');
  });

  it('conjugates -güir like construir, dropping the diaeresis before y (argüir)', () => {
    // DLE/DPD "argüir": arguyo, arguyes, arguyó, arguyendo; argüimos, argüís, argüí keep ü.
    for (const v of ['argüir', 'redargüir']) {
      const p = v.slice(0, -6);
      const vos = (t: Tense, r: VosRegion): string[] | null => conjugate(v, t, 'vos', 'sg', { vosRegion: r });
      expect(vos('present', 'rioplatense')).toEqual([`${p}argüís`]);
      expect(vos('imperativeAffirmative', 'rioplatense')).toEqual([`${p}argüí`]);
      expect(vos('presentSubjunctive', 'centroamericano')).toEqual([`${p}arguyás`, `${p}arguyas`]);
      expect(vos('presentSubjunctive', 'rioplatense')).toEqual([`${p}arguyas`, `${p}arguyás`]);
      expect(vos('imperativeNegative', 'centroamericano')).toEqual([`no ${p}arguyás`, `no ${p}arguyas`]);
      expect(vos('presentProgressive', 'rioplatense')).toEqual([`estás ${p}arguyendo`]);
      expect(vos('imperfectSubjunctive', 'rioplatense')).toEqual([`${p}arguyeras`, `${p}arguyeses`]);
      expect(vos('preterite', 'rioplatense')).toEqual([`${p}argüiste`]);
      expect(conjugate(v, 'present', 'yo')).toEqual([`${p}arguyo`]);
      expect(conjugate(v, 'present', 'tu')).toEqual([`${p}arguyes`]);
      expect(conjugate(v, 'present', 'nosotros')).toEqual([`${p}argüimos`]);
      expect(conjugate(v, 'imperativeAffirmative', 'tu')).toEqual([`${p}arguye`]);
      expect(conjugate(v, 'preterite', 'yo')).toEqual([`${p}argüí`]);
      expect(conjugate(v, 'preterite', 'el')).toEqual([`${p}arguyó`]);
      expect(conjugate(v, 'imperfect', 'el')).toEqual([`${p}argüía`]);
      expect(conjugate(v, 'presentPerfect', 'el')).toEqual([`ha ${p}argüido`]);
    }
  });

  it('knows the stressed-í/ú, güe and irregular verbs whose tuteo form Río de la Plata puts first', () => {
    // DLE models: maullar/aunar/ahijar/enraizar like aullar (maúllo), degollar o>güe,
    // rever like ver, raer raigo|rayo, asir asgo.
    const rp = (v: string, t: Tense): string[] | null => conjugate(v, t, 'vos', 'sg', { vosRegion: 'rioplatense' });
    const ca = (v: string, t: Tense): string[] | null => conjugate(v, t, 'vos', 'sg', { vosRegion: 'centroamericano' });
    const want: Record<string, [string, string[], string[], string]> = {
      // present vos / RP subjunctive / CA subjunctive / tú command
      maullar: ['maullás', ['maúlles', 'maullés'], ['maullés', 'maúlles'], 'maúlla'],
      aunar: ['aunás', ['aúnes', 'aunés'], ['aunés', 'aúnes'], 'aúna'],
      ahijar: ['ahijás', ['ahíjes', 'ahijés'], ['ahijés', 'ahíjes'], 'ahíja'],
      enraizar: ['enraizás', ['enraíces', 'enraicés'], ['enraicés', 'enraíces'], 'enraíza'],
      degollar: ['degollás', ['degüelles', 'degollés'], ['degollés', 'degüelles'], 'degüella'],
      rever: ['revés', ['reveas', 'reveás'], ['reveás', 'reveas'], 'revé'],
      raer: ['raés', ['raigas', 'rayas', 'raigás', 'rayás'], ['raigás', 'rayás', 'raigas', 'rayas'], 'rae'],
      asir: ['asís', ['asgas', 'asgás'], ['asgás', 'asgas'], 'ase'],
    };
    for (const [v, [present, rpSubj, caSubj, tuCmd]] of Object.entries(want)) {
      expect([v, rp(v, 'present')]).toEqual([v, [present]]);
      expect([v, rp(v, 'presentSubjunctive')]).toEqual([v, rpSubj]);
      expect([v, ca(v, 'presentSubjunctive')]).toEqual([v, caSubj]);
      expect([v, ca(v, 'imperativeNegative')]).toEqual([v, caSubj.map((f) => `no ${f}`)]);
      expect([v, conjugate(v, 'imperativeAffirmative', 'tu')]).toEqual([v, [tuCmd]]);
    }
    expect(conjugate('raer', 'present', 'yo')).toEqual(['raigo', 'rayo']);
    expect(conjugate('raer', 'preterite', 'el')).toEqual(['rayó']);
    expect(conjugate('asir', 'present', 'yo')).toEqual(['asgo']);
    expect(conjugate('rever', 'present', 'yo')).toEqual(['reveo']);
    expect(conjugate('rever', 'preterite', 'yo')).toEqual(['reví']);
    expect(conjugate('rever', 'presentPerfect', 'yo')).toEqual(['he revisto']);
  });

  it('does not accept the colloquial -stes preterite', () => {
    expect(vos('hablar', 'preterite')).toEqual(['hablaste']);
    expect(vos('decir', 'preterite')).toEqual(['dijiste']);
  });

  it('builds compounds of irregular verbs', () => {
    expect(vos('satisfacer', 'present')).toEqual(['satisfacés']);
    expect(vos('satisfacer', 'imperativeAffirmative')).toEqual(['satisfacé']);
    expect(vos('sonreír', 'imperativeAffirmative')).toEqual(['sonreí']);
    expect(vos('mantener', 'imperativeAffirmative')).toEqual(['mantené']);
  });

  it('conjugates dative entries with te, like tú', () => {
    expect(conjugate('gustarle', 'present', 'vos')).toEqual(['te gusta']);
    expect(conjugate('gustarle', 'present', 'vos', 'pl')).toEqual(['te gustan']);
    expect(conjugate('dolerle', 'preterite', 'vos', 'sg', { vosRegion: 'centroamericano' })).toEqual(['te dolió']);
    expect(conjugate('gustarle', 'presentSubjunctive', 'vos')).toEqual(['te guste']);
    expect(conjugate('gustarle', 'imperativeAffirmative', 'vos')).toBeNull();
  });

  it('has no vos cell in impersonal entries or where a defective verb lacks one', () => {
    expect(conjugate('haber-impersonal', 'present', 'vos')).toBeNull();
    expect(conjugate('llover', 'present', 'vos')).toBeNull();
    expect(conjugate('concernir', 'present', 'vos')).toBeNull();
    expect(conjugate('soler', 'present', 'vos')).toEqual(['solés']);
    expect(conjugate('soler', 'future', 'vos')).toBeNull();
  });
});

describe('vos in the person lists, labels and cells', () => {
  it('lists vos right after tú', () => {
    expect(PERSON_IDS).toEqual(['yo', 'tu', 'vos', 'el', 'nosotros', 'vosotros', 'ellos']);
    expect(PERSONS[2]).toEqual({ id: 'vos', es: 'vos' });
    for (const t of TENSES) expect(t.persons.indexOf('vos')).toBe(t.persons.indexOf('tu') + 1);
    expect(isPerson('vos')).toBe(true);
    expect(VOS_REGIONS).toEqual([
      { id: 'rioplatense', es: 'Río de la Plata' },
      { id: 'centroamericano', es: 'Centroamérica' },
    ]);
    expect(isVosRegion('rioplatense')).toBe(true);
    expect(isVosRegion('chileno')).toBe(false);
  });

  it('labels vos, and "a vos" as a dative experiencer', () => {
    expect(personLabel('present', 'vos')).toBe('vos');
    expect(personLabel('imperativeAffirmative', 'vos')).toBe('vos');
    expect(personLabelFor('hablar', 'imperativeNegative', 'vos')).toBe('vos');
    expect(personLabelFor('gustarle', 'present', 'vos')).toBe('a vos');
    expect(EXPERIENCER_LABELS.vos).toBe('a vos');
    expect(personLabelFor('llover', 'present', 'vos')).toBe('');
  });

  it('adds vos cells after tú only when the deck picks a region', () => {
    const all = TENSES.map((t) => t.id);
    expect(cellsFor('hablar', all, { vosotros: false })).toHaveLength(58);
    expect(cellsFor('hablar', all, { vosotros: false, vos: null })).toHaveLength(58);
    expect(cellsFor('hablar', all, { vosotros: false, vos: 'rioplatense' })).toHaveLength(70);
    expect(cellsFor('hablar', all, { vosotros: true, vos: 'centroamericano' })).toHaveLength(82);
    expect(cellsFor('gustarle', all, { vosotros: false, vos: 'rioplatense' })).toHaveLength(120);
    expect(cellsFor('haber-impersonal', all, { vosotros: true, vos: 'rioplatense' })).toHaveLength(9);
    expect(cellsFor('concernir', all, { vosotros: true, vos: 'rioplatense' }).some((c) => c.person === 'vos')).toBe(false);
    expect(cellsFor('hablar', ['imperativeAffirmative'], { vosotros: false, vos: 'centroamericano' })).toEqual([
      { tense: 'imperativeAffirmative', person: 'tu' },
      { tense: 'imperativeAffirmative', person: 'vos' },
      { tense: 'imperativeAffirmative', person: 'el' },
      { tense: 'imperativeAffirmative', person: 'nosotros' },
      { tense: 'imperativeAffirmative', person: 'ellos' },
    ]);
  });

  it('gives paradigm vos cells only with a region', () => {
    expect(paradigm('hablar')?.present.vos).toBeUndefined();
    expect(paradigm('hablar', 'sg', { vosRegion: 'centroamericano' })?.presentSubjunctive.vos).toEqual(['hablés', 'hables']);
    expect(paradigm('gustarle', 'pl', { vosRegion: 'rioplatense' })?.present.vos).toEqual(['te gustan']);
  });
});

describe('analyze, vos readings', () => {
  const both = ['rioplatense', 'centroamericano'];

  it('reads voseo forms with the regions that accept them', () => {
    expect(analyze('sos')).toEqual([{ infinitive: 'ser', tense: 'present', person: 'vos', regions: both }]);
    expect(analyze('hablás')).toEqual([{ infinitive: 'hablar', tense: 'present', person: 'vos', regions: both }]);
    expect(analyze('hablés')).toEqual([{ infinitive: 'hablar', tense: 'presentSubjunctive', person: 'vos', regions: both }]);
    expect(analyze('no hablés')).toEqual([{ infinitive: 'hablar', tense: 'imperativeNegative', person: 'vos', regions: both }]);
    expect(analyze('hablá')).toEqual([{ infinitive: 'hablar', tense: 'imperativeAffirmative', person: 'vos', regions: both }]);
    expect(analyze('te llamás')).toEqual([{ infinitive: 'llamarse', tense: 'present', person: 'vos', regions: both }]);
    expect(analyze('andate')).toEqual([{ infinitive: 'irse', tense: 'imperativeAffirmative', person: 'vos', regions: both }]);
    expect(analyze('durmás')).toEqual([{ infinitive: 'dormir', tense: 'presentSubjunctive', person: 'vos', regions: both }]);
    const anda = analyze('andá');
    expect(anda).toContainEqual({ infinitive: 'ir', tense: 'imperativeAffirmative', person: 'vos', regions: both });
    expect(anda).toContainEqual({ infinitive: 'andar', tense: 'imperativeAffirmative', person: 'vos', regions: both });
  });

  it('reads a tú form that vos shares as both persons', () => {
    expect(analyze('hables')).toEqual([
      { infinitive: 'hablar', tense: 'presentSubjunctive', person: 'tu' },
      { infinitive: 'hablar', tense: 'presentSubjunctive', person: 'vos', regions: both },
    ]);
    expect(analyze('hablaste')).toContainEqual({ infinitive: 'hablar', tense: 'preterite', person: 'vos', regions: both });
    expect(analyze('has hablado')).toContainEqual({ infinitive: 'hablar', tense: 'presentPerfect', person: 'vos', regions: both });
    // The tú present is not a vos form.
    expect(analyze('hablas')).toEqual([{ infinitive: 'hablar', tense: 'present', person: 'tu' }]);
    expect(analyze('hablastes')).toEqual([]);
  });

  it('forgives accents on vos forms too', () => {
    const hits = analyzeIgnoringAccents('tenes');
    expect(hits).toContainEqual({ infinitive: 'tener', tense: 'present', person: 'vos', regions: both });
  });

  it('round-trips every vos form of a sample of verbs in both regions', () => {
    for (const infinitive of lexiconInfinitives().filter((_v, i) => i % 31 === 0)) {
      for (const t of TENSES) {
        for (const region of REGIONS) {
          for (const form of conjugate(infinitive, t.id, 'vos', 'sg', { vosRegion: region }) ?? []) {
            const hit = analyze(form).find((h) => h.infinitive === infinitive && h.tense === t.id && h.person === 'vos');
            expect([form, hit?.regions]).toEqual([form, both]);
          }
        }
      }
    }
  }, 60_000); // property sweep: seconds of CPU on a loaded CI runner
});

describe('gradeTyped, vos', () => {
  const cell = (verb: string, tense: Tense, region: VosRegion = 'rioplatense') =>
    conjugate(verb, tense, 'vos', 'sg', { vosRegion: region }) ?? [];

  it('accepts a leading vos, and a trailing one after a command', () => {
    expect(gradeTyped(cell('tener', 'present'), 'vos tenés', true, 'vos')).toBe('correct');
    expect(gradeTyped(cell('tener', 'present'), 'vos tenés', true)).toBe('correct');
    expect(gradeTyped(cell('ser', 'present'), 'Vos sos', true, 'vos')).toBe('correct');
    expect(gradeTyped(cell('llamarse', 'present'), 'vos te llamás', true, 'vos')).toBe('correct');
    expect(gradeTyped(cell('venir', 'imperativeAffirmative'), '¡Vení vos!', true, 'vos')).toBe('correct');
    expect(gradeTyped(cell('hablar', 'imperativeNegative'), 'no hablés vos', true, 'vos')).toBe('correct');
    expect(gradeTyped(cell('hablar', 'imperfect'), 'vos hablabas', true, 'vos')).toBe('correct');
  });

  it('marks a leading tú wrong for vos, and vos wrong for tú', () => {
    expect(gradeTyped(cell('tener', 'present'), 'tú tenés', true, 'vos')).toBe('wrong');
    expect(gradeTyped(cell('tener', 'present'), 'tú tenés', true)).toBe('wrong');
    expect(gradeTyped(cell('hablar', 'imperfect'), 'tú hablabas', true, 'vos')).toBe('wrong');
    expect(gradeTyped(conjugate('tener', 'present', 'tu') ?? [], 'vos tienes', true, 'tu')).toBe('wrong');
  });

  it('accepts both subjunctives in both regions', () => {
    for (const region of REGIONS) {
      expect(gradeTyped(cell('hablar', 'imperativeNegative', region), 'no hables', true, 'vos')).toBe('correct');
      expect(gradeTyped(cell('hablar', 'imperativeNegative', region), 'no hablés', true, 'vos')).toBe('correct');
      expect(gradeTyped(cell('tener', 'presentSubjunctive', region), 'tengás', true, 'vos')).toBe('correct');
    }
  });

  it('treats the tú form as a conjugation error in a vos cell, not an accent slip', () => {
    expect(gradeTyped(cell('hablar', 'present'), 'hablas', false, 'vos')).toBe('accent');
    expect(gradeTyped(cell('tener', 'present'), 'tienes', false, 'vos')).toBe('wrong');
    expect(gradeTyped(cell('decir', 'imperativeAffirmative'), 'di', false, 'vos')).toBe('wrong');
    expect(gradeTyped(cell('hablar', 'preterite'), 'hablastes', false, 'vos')).toBe('wrong');
    // A class drilling tú still has "levantate" forgiven as a missing accent.
    expect(gradeTyped(['levántate'], 'levantate', false)).toBe('correct');
    expect(gradeTyped(['levántate'], 'levantate', false, 'tu')).toBe('correct');
  });

  it('accepts "a vos" with a dative vos cell', () => {
    const g = conjugate('gustarle', 'present', 'vos') ?? [];
    expect(gradeTyped(g, 'a vos te gusta', true, 'vos', 'dative')).toBe('correct');
    expect(gradeTyped(g, 'te gusta a vos', true, 'vos', 'dative')).toBe('correct');
    expect(gradeTyped(g, 'A vos te gusta', true)).toBe('correct');
    expect(gradeTyped(g, 'a ti te gusta', true, 'vos', 'dative')).toBe('wrong');
    expect(gradeTyped(g, 'vos te gusta', true, 'vos', 'dative')).toBe('wrong');
    expect(gradeTyped(conjugate('gustarle', 'present', 'tu') ?? [], 'a vos te gusta', true, 'tu', 'dative')).toBe('wrong');
  });
});

describe('distractors, vos', () => {
  const CORE = [
    'ser', 'estar', 'ir', 'haber', 'tener', 'hacer', 'decir', 'poner', 'venir', 'querer', 'poder', 'saber', 'dar', 'ver',
    'oír', 'caer', 'traer', 'leer', 'construir', 'conducir', 'pedir', 'sentir', 'dormir', 'jugar', 'pensar', 'volver',
    'empezar', 'buscar', 'enviar', 'continuar', 'reír', 'llamarse', 'levantarse', 'irse', 'vestirse', 'sentarse',
    'hablar', 'comer', 'vivir', 'prohibir', 'reunir', 'gustarle',
  ];

  it('never offers a form the region accepts', () => {
    for (const verb of CORE) {
      for (const t of TENSES) {
        for (const region of REGIONS) {
          for (const strictAccents of [true, false]) {
            const accepted = conjugate(verb, t.id, 'vos', 'sg', { vosRegion: region });
            if (!accepted) continue;
            for (const d of distractors(verb, t.id, 'vos', 6, { vosRegion: region, strictAccents })) {
              expect([verb, t.id, region, d, gradeTyped(accepted, d, strictAccents, 'vos')]).not.toEqual([
                verb, t.id, region, d, 'correct',
              ]);
              // Nor the other region's forms: both regions accept both subjunctives.
              for (const other of REGIONS) {
                const theirs = conjugate(verb, t.id, 'vos', 'sg', { vosRegion: other }) ?? [];
                expect(theirs).not.toContain(d);
              }
            }
          }
        }
      }
    }
  }, 60_000); // property sweep: seconds of CPU on a loaded CI runner

  it('offers the tú form first where it is wrong for vos', () => {
    expect(distractors('tener', 'present', 'vos', 4)[0]).toBe('tienes');
    expect(distractors('ser', 'present', 'vos', 4)[0]).toBe('eres');
    expect(distractors('decir', 'imperativeAffirmative', 'vos', 4, { vosRegion: 'centroamericano' })[0]).toBe('di');
    expect(distractors('ir', 'imperativeAffirmative', 'vos', 4)[0]).toBe('ve');
    expect(distractors('hablar', 'present', 'vos', 4, { strictAccents: true })[0]).toBe('hablas');
    expect(distractors('llamarse', 'present', 'vos', 4, { strictAccents: true })[0]).toBe('te llamas');
  });

  it('never offers the tuteo subjunctive, which both regions accept', () => {
    for (const region of REGIONS) {
      expect(distractors('hablar', 'presentSubjunctive', 'vos', 8, { vosRegion: region, strictAccents: true })).not.toContain('hables');
      expect(distractors('tener', 'imperativeNegative', 'vos', 8, { vosRegion: region })).not.toContain('no tengas');
      expect(distractors('irse', 'imperativeNegative', 'vos', 8, { vosRegion: region })).not.toContain('no te vayas');
    }
  });

  it('offers the stem-changed voseo as a regularization', () => {
    expect(distractors('tener', 'present', 'vos', 8, { strictAccents: true })).toContain('tienés');
    // With accents forgiven, quierés is the same answer as the tú slip quieres, offered first.
    expect(distractors('querer', 'present', 'vos', 8, { strictAccents: true })).toContain('quierés');
    expect(distractors('querer', 'present', 'vos', 8)).toContain('quieres');
  });

  it('never offers a word with two written accents (envíás, prohíbís, no reúnás)', () => {
    const ACC = ['enviar', 'continuar', 'graduarse', 'reunirse', 'esquiar', 'prohibir', 'actuar', 'confiar', 'fiar', 'guiar',
      'criar', 'vaciar', 'evaluar', 'aislar', 'rehusar'];
    const cells: Tense[] = ['present', 'presentSubjunctive', 'imperativeNegative', 'imperativeAffirmative'];
    for (const verb of ACC) {
      for (const tense of cells) {
        for (const region of REGIONS) {
          for (const person of ['vos', 'vosotros'] as const) {
            for (let seed = 1; seed <= 5; seed++) {
              for (const d of distractors(verb, tense, person, 8, { vosRegion: region, strictAccents: true, vosotros: true, seed })) {
                expect([verb, tense, d, d.split(' ').some((w) => (w.match(/[áéíóú]/g) ?? []).length > 1)]).toEqual([verb, tense, d, false]);
              }
            }
          }
        }
      }
    }
    // The stem-stressed slip is still offered as the tú form.
    expect(distractors('enviar', 'present', 'vos', 3, { vosRegion: 'rioplatense', strictAccents: true, seed: 1 })).toContain('envías');
  });

  it('offers vos forms for other persons only in a vos class', () => {
    const plain = distractors('hablar', 'present', 'tu', 12, { strictAccents: true });
    expect(plain).not.toContain('hablás');
    const inClass = distractors('hablar', 'present', 'tu', 12, { strictAccents: true, vosRegion: 'rioplatense' });
    expect(inClass).toContain('hablás');
    expect(distractors('tener', 'present', 'yo', 12)).not.toContain('tenés');
  });
});

describe('detectVerbs, voseo cards', () => {
  const detect = (front: string, back: string): string[] => detectVerbs([{ front, back }]).map((d) => d.infinitive);

  it('maps voseo fronts to the same entries as the other persons', () => {
    expect(detect('sos', 'you are')).toEqual(['ser']);
    expect(detect('tenés', 'you have')).toEqual(['tener']);
    expect(detect('hablás', 'you speak')).toEqual(['hablar']);
    expect(detect('vos hablás', 'you speak')).toEqual(['hablar']);
    expect(detect('vení', 'come!')).toEqual(['venir']);
    expect(detect('¡Vení acá!', 'come here!')).toEqual(['venir']);
    expect(detect('te llamás', 'your name is')).toEqual(['llamarse']);
    expect(detect('¿Cómo te llamás?', 'what is your name?')).toEqual(['llamarse']);
    expect(detect('a vos te gusta', 'you like')).toEqual(['gustarle']);
    expect(detect('querés', 'you want')).toEqual(['querer']);
    expect(detect('sentate', 'sit down!')).toEqual(['sentarse']);
    expect(detect('andá', 'go!')).toEqual(['ir']);
    expect(detect('no te vayás', "don't leave!")).toEqual(['irse']);
  });

  it('reads andá as andar when the gloss says walk, as ir when it says go', () => {
    // andá is both ir's suppletive vos command and andar's regular one.
    expect(detect('andá', 'walk!')).toEqual(['andar']);
    expect(detect('andá despacio', 'walk slowly!')).toEqual(['andar']);
    expect(detect('andá (andar)', 'walk!')).toEqual(['andar']);
    expect(detect('andá a casa', 'go home!')).toEqual(['ir']);
  });

  it('does not read the adverb así as asir\'s vos command unless the gloss names asir', () => {
    expect(detect('así se dice', "that's how you say it")).toEqual([]);
    expect(detect('así me gusta', 'I like it like that')).toEqual([]);
    expect(detect('así', 'grab! (asir)')).toEqual(['asir']);
  });

  it('groups a deck mixing tú and vos cards by entry', () => {
    const found = detectVerbs([
      { front: 'tienes', back: 'you have' },
      { front: 'tenés', back: 'you have' },
      { front: 'eres', back: 'you are' },
      { front: 'sos', back: 'you are' },
    ]);
    expect(found.map((d) => [d.infinitive, d.cards.length])).toEqual([
      ['tener', 2],
      ['ser', 2],
    ]);
  });
});
