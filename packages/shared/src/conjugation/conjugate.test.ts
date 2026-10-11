// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { conjugate, isKnownVerb, verbInfo, paradigm, personLabel, TENSES, PERSONS } from './index.js';
import type { Person, Tense } from './index.js';

/**
 * Expected paradigms, written by hand. Cells are separated by ", ", accepted
 * alternatives by "|" (canonical first). The helper derives the mechanical
 * tenses from the data given here, never from the engine:
 *   imperfect subjunctive -se forms from the -ra forms,
 *   present perfect / pluperfect from the participle(s),
 *   progressive from the gerund (reflexive verbs list it explicitly),
 *   negative commands from the present subjunctive.
 */
interface Paradigm {
  present: string;
  preterite: string;
  imperfect: string;
  future: string;
  conditional: string;
  presentSubjunctive: string;
  /** -ra forms only. */
  imperfectSubjunctive: string;
  /** tú, usted, nosotros, vosotros, ustedes */
  imperativeAffirmative: string;
  gerund: string;
  participle: string;
  /** Reflexive verbs: the six progressive cells in full. */
  progressive?: string;
  /** No progressive at all (estar: "estoy estando" is not taught as Spanish). */
  noProgressive?: boolean;
}

const SIX: Person[] = ['yo', 'tu', 'el', 'nosotros', 'vosotros', 'ellos'];
const FIVE: Person[] = ['tu', 'el', 'nosotros', 'vosotros', 'ellos'];
const PRON = ['me', 'te', 'se', 'nos', 'os', 'se'];
const HE = ['he', 'has', 'ha', 'hemos', 'habéis', 'han'];
const HABIA = ['había', 'habías', 'había', 'habíamos', 'habíais', 'habían'];
const ESTOY = ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'];

const F = (stem: string): string => ['é', 'ás', 'á', 'emos', 'éis', 'án'].map((e) => stem + e).join(', ');
const C = (stem: string): string => ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'].map((e) => stem + e).join(', ');
const cells = (s: string): string[][] => s.split(', ').map((c) => c.split('|'));

function seForm(ra: string): string {
  if (ra.endsWith('ramos')) return ra.slice(0, -5) + 'semos';
  if (ra.endsWith('rais')) return ra.slice(0, -4) + 'seis';
  if (ra.endsWith('ras')) return ra.slice(0, -3) + 'ses';
  if (ra.endsWith('ran')) return ra.slice(0, -3) + 'sen';
  if (ra.endsWith('ra')) return ra.slice(0, -2) + 'se';
  throw new Error(`not a -ra form: ${ra}`);
}

function expected(inf: string, p: Paradigm): Record<Tense, Partial<Record<Person, string[]>>> {
  const reflexive = inf.endsWith('se');
  const pron = (i: number, form: string): string => (reflexive ? `${PRON[i]} ${form}` : form);
  const six = (s: string): Partial<Record<Person, string[]>> =>
    Object.fromEntries(cells(s).map((alts, i) => [SIX[i], alts])) as Partial<Record<Person, string[]>>;
  const participles = p.participle.split('|');
  const gerunds = p.gerund.split('|');
  const subj = cells(p.presentSubjunctive);
  const ra = cells(p.imperfectSubjunctive);
  return {
    present: six(p.present),
    preterite: six(p.preterite),
    imperfect: six(p.imperfect),
    future: six(p.future),
    conditional: six(p.conditional),
    presentSubjunctive: six(p.presentSubjunctive),
    imperfectSubjunctive: Object.fromEntries(ra.map((alts, i) => [SIX[i], [...alts, ...alts.map(seForm)]])),
    imperativeAffirmative: Object.fromEntries(cells(p.imperativeAffirmative).map((alts, i) => [FIVE[i], alts])),
    imperativeNegative: Object.fromEntries(FIVE.map((person, i) => [person, subj[i + 1].map((f) => `no ${f}`)])),
    presentPerfect: Object.fromEntries(SIX.map((person, i) => [person, participles.map((pp) => pron(i, `${HE[i]} ${pp}`))])),
    pluperfect: Object.fromEntries(SIX.map((person, i) => [person, participles.map((pp) => pron(i, `${HABIA[i]} ${pp}`))])),
    presentProgressive: p.noProgressive
      ? {}
      : p.progressive
      ? six(p.progressive)
      : Object.fromEntries(SIX.map((person, i) => [person, gerunds.map((g) => `${ESTOY[i]} ${g}`)])),
  };
}

const PARADIGMS: Record<string, Paradigm> = {
  hablar: {
    present: 'hablo, hablas, habla, hablamos, habláis, hablan',
    preterite: 'hablé, hablaste, habló, hablamos, hablasteis, hablaron',
    imperfect: 'hablaba, hablabas, hablaba, hablábamos, hablabais, hablaban',
    future: F('hablar'),
    conditional: C('hablar'),
    presentSubjunctive: 'hable, hables, hable, hablemos, habléis, hablen',
    imperfectSubjunctive: 'hablara, hablaras, hablara, habláramos, hablarais, hablaran',
    imperativeAffirmative: 'habla, hable, hablemos, hablad, hablen',
    gerund: 'hablando',
    participle: 'hablado',
  },
  comer: {
    present: 'como, comes, come, comemos, coméis, comen',
    preterite: 'comí, comiste, comió, comimos, comisteis, comieron',
    imperfect: 'comía, comías, comía, comíamos, comíais, comían',
    future: F('comer'),
    conditional: C('comer'),
    presentSubjunctive: 'coma, comas, coma, comamos, comáis, coman',
    imperfectSubjunctive: 'comiera, comieras, comiera, comiéramos, comierais, comieran',
    imperativeAffirmative: 'come, coma, comamos, comed, coman',
    gerund: 'comiendo',
    participle: 'comido',
  },
  vivir: {
    present: 'vivo, vives, vive, vivimos, vivís, viven',
    preterite: 'viví, viviste, vivió, vivimos, vivisteis, vivieron',
    imperfect: 'vivía, vivías, vivía, vivíamos, vivíais, vivían',
    future: F('vivir'),
    conditional: C('vivir'),
    presentSubjunctive: 'viva, vivas, viva, vivamos, viváis, vivan',
    imperfectSubjunctive: 'viviera, vivieras, viviera, viviéramos, vivierais, vivieran',
    imperativeAffirmative: 'vive, viva, vivamos, vivid, vivan',
    gerund: 'viviendo',
    participle: 'vivido',
  },
  ser: {
    present: 'soy, eres, es, somos, sois, son',
    preterite: 'fui, fuiste, fue, fuimos, fuisteis, fueron',
    imperfect: 'era, eras, era, éramos, erais, eran',
    future: F('ser'),
    conditional: C('ser'),
    presentSubjunctive: 'sea, seas, sea, seamos, seáis, sean',
    imperfectSubjunctive: 'fuera, fueras, fuera, fuéramos, fuerais, fueran',
    imperativeAffirmative: 'sé, sea, seamos, sed, sean',
    gerund: 'siendo',
    participle: 'sido',
  },
  estar: {
    present: 'estoy, estás, está, estamos, estáis, están',
    preterite: 'estuve, estuviste, estuvo, estuvimos, estuvisteis, estuvieron',
    imperfect: 'estaba, estabas, estaba, estábamos, estabais, estaban',
    future: F('estar'),
    conditional: C('estar'),
    presentSubjunctive: 'esté, estés, esté, estemos, estéis, estén',
    imperfectSubjunctive: 'estuviera, estuvieras, estuviera, estuviéramos, estuvierais, estuvieran',
    imperativeAffirmative: 'está, esté, estemos, estad, estén',
    gerund: 'estando',
    participle: 'estado',
    noProgressive: true,
  },
  ir: {
    present: 'voy, vas, va, vamos, vais, van',
    preterite: 'fui, fuiste, fue, fuimos, fuisteis, fueron',
    imperfect: 'iba, ibas, iba, íbamos, ibais, iban',
    future: F('ir'),
    conditional: C('ir'),
    presentSubjunctive: 'vaya, vayas, vaya, vayamos, vayáis, vayan',
    imperfectSubjunctive: 'fuera, fueras, fuera, fuéramos, fuerais, fueran',
    imperativeAffirmative: 've, vaya, vamos|vayamos, id, vayan',
    gerund: 'yendo',
    participle: 'ido',
  },
  haber: {
    // hay is the entry haber-impersonal, not the auxiliary.
    present: 'he, has, ha, hemos, habéis, han',
    preterite: 'hube, hubiste, hubo, hubimos, hubisteis, hubieron',
    imperfect: 'había, habías, había, habíamos, habíais, habían',
    future: F('habr'),
    conditional: C('habr'),
    presentSubjunctive: 'haya, hayas, haya, hayamos, hayáis, hayan',
    imperfectSubjunctive: 'hubiera, hubieras, hubiera, hubiéramos, hubierais, hubieran',
    imperativeAffirmative: 'he, haya, hayamos, habed, hayan',
    gerund: 'habiendo',
    participle: 'habido',
  },
  tener: {
    present: 'tengo, tienes, tiene, tenemos, tenéis, tienen',
    preterite: 'tuve, tuviste, tuvo, tuvimos, tuvisteis, tuvieron',
    imperfect: 'tenía, tenías, tenía, teníamos, teníais, tenían',
    future: F('tendr'),
    conditional: C('tendr'),
    presentSubjunctive: 'tenga, tengas, tenga, tengamos, tengáis, tengan',
    imperfectSubjunctive: 'tuviera, tuvieras, tuviera, tuviéramos, tuvierais, tuvieran',
    imperativeAffirmative: 'ten, tenga, tengamos, tened, tengan',
    gerund: 'teniendo',
    participle: 'tenido',
  },
  hacer: {
    present: 'hago, haces, hace, hacemos, hacéis, hacen',
    preterite: 'hice, hiciste, hizo, hicimos, hicisteis, hicieron',
    imperfect: 'hacía, hacías, hacía, hacíamos, hacíais, hacían',
    future: F('har'),
    conditional: C('har'),
    presentSubjunctive: 'haga, hagas, haga, hagamos, hagáis, hagan',
    imperfectSubjunctive: 'hiciera, hicieras, hiciera, hiciéramos, hicierais, hicieran',
    imperativeAffirmative: 'haz, haga, hagamos, haced, hagan',
    gerund: 'haciendo',
    participle: 'hecho',
  },
  decir: {
    present: 'digo, dices, dice, decimos, decís, dicen',
    preterite: 'dije, dijiste, dijo, dijimos, dijisteis, dijeron',
    imperfect: 'decía, decías, decía, decíamos, decíais, decían',
    future: F('dir'),
    conditional: C('dir'),
    presentSubjunctive: 'diga, digas, diga, digamos, digáis, digan',
    imperfectSubjunctive: 'dijera, dijeras, dijera, dijéramos, dijerais, dijeran',
    imperativeAffirmative: 'di, diga, digamos, decid, digan',
    gerund: 'diciendo',
    participle: 'dicho',
  },
  poner: {
    present: 'pongo, pones, pone, ponemos, ponéis, ponen',
    preterite: 'puse, pusiste, puso, pusimos, pusisteis, pusieron',
    imperfect: 'ponía, ponías, ponía, poníamos, poníais, ponían',
    future: F('pondr'),
    conditional: C('pondr'),
    presentSubjunctive: 'ponga, pongas, ponga, pongamos, pongáis, pongan',
    imperfectSubjunctive: 'pusiera, pusieras, pusiera, pusiéramos, pusierais, pusieran',
    imperativeAffirmative: 'pon, ponga, pongamos, poned, pongan',
    gerund: 'poniendo',
    participle: 'puesto',
  },
  venir: {
    present: 'vengo, vienes, viene, venimos, venís, vienen',
    preterite: 'vine, viniste, vino, vinimos, vinisteis, vinieron',
    imperfect: 'venía, venías, venía, veníamos, veníais, venían',
    future: F('vendr'),
    conditional: C('vendr'),
    presentSubjunctive: 'venga, vengas, venga, vengamos, vengáis, vengan',
    imperfectSubjunctive: 'viniera, vinieras, viniera, viniéramos, vinierais, vinieran',
    imperativeAffirmative: 'ven, venga, vengamos, venid, vengan',
    gerund: 'viniendo',
    participle: 'venido',
  },
  querer: {
    present: 'quiero, quieres, quiere, queremos, queréis, quieren',
    preterite: 'quise, quisiste, quiso, quisimos, quisisteis, quisieron',
    imperfect: 'quería, querías, quería, queríamos, queríais, querían',
    future: F('querr'),
    conditional: C('querr'),
    presentSubjunctive: 'quiera, quieras, quiera, queramos, queráis, quieran',
    imperfectSubjunctive: 'quisiera, quisieras, quisiera, quisiéramos, quisierais, quisieran',
    imperativeAffirmative: 'quiere, quiera, queramos, quered, quieran',
    gerund: 'queriendo',
    participle: 'querido',
  },
  poder: {
    present: 'puedo, puedes, puede, podemos, podéis, pueden',
    preterite: 'pude, pudiste, pudo, pudimos, pudisteis, pudieron',
    imperfect: 'podía, podías, podía, podíamos, podíais, podían',
    future: F('podr'),
    conditional: C('podr'),
    presentSubjunctive: 'pueda, puedas, pueda, podamos, podáis, puedan',
    imperfectSubjunctive: 'pudiera, pudieras, pudiera, pudiéramos, pudierais, pudieran',
    imperativeAffirmative: 'puede, pueda, podamos, poded, puedan',
    gerund: 'pudiendo',
    participle: 'podido',
  },
  saber: {
    present: 'sé, sabes, sabe, sabemos, sabéis, saben',
    preterite: 'supe, supiste, supo, supimos, supisteis, supieron',
    imperfect: 'sabía, sabías, sabía, sabíamos, sabíais, sabían',
    future: F('sabr'),
    conditional: C('sabr'),
    presentSubjunctive: 'sepa, sepas, sepa, sepamos, sepáis, sepan',
    imperfectSubjunctive: 'supiera, supieras, supiera, supiéramos, supierais, supieran',
    imperativeAffirmative: 'sabe, sepa, sepamos, sabed, sepan',
    gerund: 'sabiendo',
    participle: 'sabido',
  },
  caber: {
    present: 'quepo, cabes, cabe, cabemos, cabéis, caben',
    preterite: 'cupe, cupiste, cupo, cupimos, cupisteis, cupieron',
    imperfect: 'cabía, cabías, cabía, cabíamos, cabíais, cabían',
    future: F('cabr'),
    conditional: C('cabr'),
    presentSubjunctive: 'quepa, quepas, quepa, quepamos, quepáis, quepan',
    imperfectSubjunctive: 'cupiera, cupieras, cupiera, cupiéramos, cupierais, cupieran',
    imperativeAffirmative: 'cabe, quepa, quepamos, cabed, quepan',
    gerund: 'cabiendo',
    participle: 'cabido',
  },
  dar: {
    present: 'doy, das, da, damos, dais, dan',
    preterite: 'di, diste, dio, dimos, disteis, dieron',
    imperfect: 'daba, dabas, daba, dábamos, dabais, daban',
    future: F('dar'),
    conditional: C('dar'),
    presentSubjunctive: 'dé, des, dé, demos, deis, den',
    imperfectSubjunctive: 'diera, dieras, diera, diéramos, dierais, dieran',
    imperativeAffirmative: 'da, dé, demos, dad, den',
    gerund: 'dando',
    participle: 'dado',
  },
  ver: {
    present: 'veo, ves, ve, vemos, veis, ven',
    preterite: 'vi, viste, vio, vimos, visteis, vieron',
    imperfect: 'veía, veías, veía, veíamos, veíais, veían',
    future: F('ver'),
    conditional: C('ver'),
    presentSubjunctive: 'vea, veas, vea, veamos, veáis, vean',
    imperfectSubjunctive: 'viera, vieras, viera, viéramos, vierais, vieran',
    imperativeAffirmative: 've, vea, veamos, ved, vean',
    gerund: 'viendo',
    participle: 'visto',
  },
  oír: {
    present: 'oigo, oyes, oye, oímos, oís, oyen',
    preterite: 'oí, oíste, oyó, oímos, oísteis, oyeron',
    imperfect: 'oía, oías, oía, oíamos, oíais, oían',
    future: F('oir'),
    conditional: C('oir'),
    presentSubjunctive: 'oiga, oigas, oiga, oigamos, oigáis, oigan',
    imperfectSubjunctive: 'oyera, oyeras, oyera, oyéramos, oyerais, oyeran',
    imperativeAffirmative: 'oye, oiga, oigamos, oíd, oigan',
    gerund: 'oyendo',
    participle: 'oído',
  },
  caer: {
    present: 'caigo, caes, cae, caemos, caéis, caen',
    preterite: 'caí, caíste, cayó, caímos, caísteis, cayeron',
    imperfect: 'caía, caías, caía, caíamos, caíais, caían',
    future: F('caer'),
    conditional: C('caer'),
    presentSubjunctive: 'caiga, caigas, caiga, caigamos, caigáis, caigan',
    imperfectSubjunctive: 'cayera, cayeras, cayera, cayéramos, cayerais, cayeran',
    imperativeAffirmative: 'cae, caiga, caigamos, caed, caigan',
    gerund: 'cayendo',
    participle: 'caído',
  },
  traer: {
    present: 'traigo, traes, trae, traemos, traéis, traen',
    preterite: 'traje, trajiste, trajo, trajimos, trajisteis, trajeron',
    imperfect: 'traía, traías, traía, traíamos, traíais, traían',
    future: F('traer'),
    conditional: C('traer'),
    presentSubjunctive: 'traiga, traigas, traiga, traigamos, traigáis, traigan',
    imperfectSubjunctive: 'trajera, trajeras, trajera, trajéramos, trajerais, trajeran',
    imperativeAffirmative: 'trae, traiga, traigamos, traed, traigan',
    gerund: 'trayendo',
    participle: 'traído',
  },
  leer: {
    present: 'leo, lees, lee, leemos, leéis, leen',
    preterite: 'leí, leíste, leyó, leímos, leísteis, leyeron',
    imperfect: 'leía, leías, leía, leíamos, leíais, leían',
    future: F('leer'),
    conditional: C('leer'),
    presentSubjunctive: 'lea, leas, lea, leamos, leáis, lean',
    imperfectSubjunctive: 'leyera, leyeras, leyera, leyéramos, leyerais, leyeran',
    imperativeAffirmative: 'lee, lea, leamos, leed, lean',
    gerund: 'leyendo',
    participle: 'leído',
  },
  construir: {
    present: 'construyo, construyes, construye, construimos, construís, construyen',
    preterite: 'construí, construiste, construyó, construimos, construisteis, construyeron',
    imperfect: 'construía, construías, construía, construíamos, construíais, construían',
    future: F('construir'),
    conditional: C('construir'),
    presentSubjunctive: 'construya, construyas, construya, construyamos, construyáis, construyan',
    imperfectSubjunctive: 'construyera, construyeras, construyera, construyéramos, construyerais, construyeran',
    imperativeAffirmative: 'construye, construya, construyamos, construid, construyan',
    gerund: 'construyendo',
    participle: 'construido',
  },
  huir: {
    present: 'huyo, huyes, huye, huimos, huis|huís, huyen',
    preterite: 'hui|huí, huiste, huyó, huimos, huisteis, huyeron',
    imperfect: 'huía, huías, huía, huíamos, huíais, huían',
    future: F('huir'),
    conditional: C('huir'),
    presentSubjunctive: 'huya, huyas, huya, huyamos, huyáis, huyan',
    imperfectSubjunctive: 'huyera, huyeras, huyera, huyéramos, huyerais, huyeran',
    imperativeAffirmative: 'huye, huya, huyamos, huid, huyan',
    gerund: 'huyendo',
    participle: 'huido',
  },
  conducir: {
    present: 'conduzco, conduces, conduce, conducimos, conducís, conducen',
    preterite: 'conduje, condujiste, condujo, condujimos, condujisteis, condujeron',
    imperfect: 'conducía, conducías, conducía, conducíamos, conducíais, conducían',
    future: F('conducir'),
    conditional: C('conducir'),
    presentSubjunctive: 'conduzca, conduzcas, conduzca, conduzcamos, conduzcáis, conduzcan',
    imperfectSubjunctive: 'condujera, condujeras, condujera, condujéramos, condujerais, condujeran',
    imperativeAffirmative: 'conduce, conduzca, conduzcamos, conducid, conduzcan',
    gerund: 'conduciendo',
    participle: 'conducido',
  },
  conocer: {
    present: 'conozco, conoces, conoce, conocemos, conocéis, conocen',
    preterite: 'conocí, conociste, conoció, conocimos, conocisteis, conocieron',
    imperfect: 'conocía, conocías, conocía, conocíamos, conocíais, conocían',
    future: F('conocer'),
    conditional: C('conocer'),
    presentSubjunctive: 'conozca, conozcas, conozca, conozcamos, conozcáis, conozcan',
    imperfectSubjunctive: 'conociera, conocieras, conociera, conociéramos, conocierais, conocieran',
    imperativeAffirmative: 'conoce, conozca, conozcamos, conoced, conozcan',
    gerund: 'conociendo',
    participle: 'conocido',
  },
  pedir: {
    present: 'pido, pides, pide, pedimos, pedís, piden',
    preterite: 'pedí, pediste, pidió, pedimos, pedisteis, pidieron',
    imperfect: 'pedía, pedías, pedía, pedíamos, pedíais, pedían',
    future: F('pedir'),
    conditional: C('pedir'),
    presentSubjunctive: 'pida, pidas, pida, pidamos, pidáis, pidan',
    imperfectSubjunctive: 'pidiera, pidieras, pidiera, pidiéramos, pidierais, pidieran',
    imperativeAffirmative: 'pide, pida, pidamos, pedid, pidan',
    gerund: 'pidiendo',
    participle: 'pedido',
  },
  sentir: {
    present: 'siento, sientes, siente, sentimos, sentís, sienten',
    preterite: 'sentí, sentiste, sintió, sentimos, sentisteis, sintieron',
    imperfect: 'sentía, sentías, sentía, sentíamos, sentíais, sentían',
    future: F('sentir'),
    conditional: C('sentir'),
    presentSubjunctive: 'sienta, sientas, sienta, sintamos, sintáis, sientan',
    imperfectSubjunctive: 'sintiera, sintieras, sintiera, sintiéramos, sintierais, sintieran',
    imperativeAffirmative: 'siente, sienta, sintamos, sentid, sientan',
    gerund: 'sintiendo',
    participle: 'sentido',
  },
  dormir: {
    present: 'duermo, duermes, duerme, dormimos, dormís, duermen',
    preterite: 'dormí, dormiste, durmió, dormimos, dormisteis, durmieron',
    imperfect: 'dormía, dormías, dormía, dormíamos, dormíais, dormían',
    future: F('dormir'),
    conditional: C('dormir'),
    presentSubjunctive: 'duerma, duermas, duerma, durmamos, durmáis, duerman',
    imperfectSubjunctive: 'durmiera, durmieras, durmiera, durmiéramos, durmierais, durmieran',
    imperativeAffirmative: 'duerme, duerma, durmamos, dormid, duerman',
    gerund: 'durmiendo',
    participle: 'dormido',
  },
  morir: {
    present: 'muero, mueres, muere, morimos, morís, mueren',
    preterite: 'morí, moriste, murió, morimos, moristeis, murieron',
    imperfect: 'moría, morías, moría, moríamos, moríais, morían',
    future: F('morir'),
    conditional: C('morir'),
    presentSubjunctive: 'muera, mueras, muera, muramos, muráis, mueran',
    imperfectSubjunctive: 'muriera, murieras, muriera, muriéramos, murierais, murieran',
    imperativeAffirmative: 'muere, muera, muramos, morid, mueran',
    gerund: 'muriendo',
    participle: 'muerto',
  },
  jugar: {
    present: 'juego, juegas, juega, jugamos, jugáis, juegan',
    preterite: 'jugué, jugaste, jugó, jugamos, jugasteis, jugaron',
    imperfect: 'jugaba, jugabas, jugaba, jugábamos, jugabais, jugaban',
    future: F('jugar'),
    conditional: C('jugar'),
    presentSubjunctive: 'juegue, juegues, juegue, juguemos, juguéis, jueguen',
    imperfectSubjunctive: 'jugara, jugaras, jugara, jugáramos, jugarais, jugaran',
    imperativeAffirmative: 'juega, juegue, juguemos, jugad, jueguen',
    gerund: 'jugando',
    participle: 'jugado',
  },
  pensar: {
    present: 'pienso, piensas, piensa, pensamos, pensáis, piensan',
    preterite: 'pensé, pensaste, pensó, pensamos, pensasteis, pensaron',
    imperfect: 'pensaba, pensabas, pensaba, pensábamos, pensabais, pensaban',
    future: F('pensar'),
    conditional: C('pensar'),
    presentSubjunctive: 'piense, pienses, piense, pensemos, penséis, piensen',
    imperfectSubjunctive: 'pensara, pensaras, pensara, pensáramos, pensarais, pensaran',
    imperativeAffirmative: 'piensa, piense, pensemos, pensad, piensen',
    gerund: 'pensando',
    participle: 'pensado',
  },
  volver: {
    present: 'vuelvo, vuelves, vuelve, volvemos, volvéis, vuelven',
    preterite: 'volví, volviste, volvió, volvimos, volvisteis, volvieron',
    imperfect: 'volvía, volvías, volvía, volvíamos, volvíais, volvían',
    future: F('volver'),
    conditional: C('volver'),
    presentSubjunctive: 'vuelva, vuelvas, vuelva, volvamos, volváis, vuelvan',
    imperfectSubjunctive: 'volviera, volvieras, volviera, volviéramos, volvierais, volvieran',
    imperativeAffirmative: 'vuelve, vuelva, volvamos, volved, vuelvan',
    gerund: 'volviendo',
    participle: 'vuelto',
  },
  empezar: {
    present: 'empiezo, empiezas, empieza, empezamos, empezáis, empiezan',
    preterite: 'empecé, empezaste, empezó, empezamos, empezasteis, empezaron',
    imperfect: 'empezaba, empezabas, empezaba, empezábamos, empezabais, empezaban',
    future: F('empezar'),
    conditional: C('empezar'),
    presentSubjunctive: 'empiece, empieces, empiece, empecemos, empecéis, empiecen',
    imperfectSubjunctive: 'empezara, empezaras, empezara, empezáramos, empezarais, empezaran',
    imperativeAffirmative: 'empieza, empiece, empecemos, empezad, empiecen',
    gerund: 'empezando',
    participle: 'empezado',
  },
  buscar: {
    present: 'busco, buscas, busca, buscamos, buscáis, buscan',
    preterite: 'busqué, buscaste, buscó, buscamos, buscasteis, buscaron',
    imperfect: 'buscaba, buscabas, buscaba, buscábamos, buscabais, buscaban',
    future: F('buscar'),
    conditional: C('buscar'),
    presentSubjunctive: 'busque, busques, busque, busquemos, busquéis, busquen',
    imperfectSubjunctive: 'buscara, buscaras, buscara, buscáramos, buscarais, buscaran',
    imperativeAffirmative: 'busca, busque, busquemos, buscad, busquen',
    gerund: 'buscando',
    participle: 'buscado',
  },
  llegar: {
    present: 'llego, llegas, llega, llegamos, llegáis, llegan',
    preterite: 'llegué, llegaste, llegó, llegamos, llegasteis, llegaron',
    imperfect: 'llegaba, llegabas, llegaba, llegábamos, llegabais, llegaban',
    future: F('llegar'),
    conditional: C('llegar'),
    presentSubjunctive: 'llegue, llegues, llegue, lleguemos, lleguéis, lleguen',
    imperfectSubjunctive: 'llegara, llegaras, llegara, llegáramos, llegarais, llegaran',
    imperativeAffirmative: 'llega, llegue, lleguemos, llegad, lleguen',
    gerund: 'llegando',
    participle: 'llegado',
  },
  coger: {
    present: 'cojo, coges, coge, cogemos, cogéis, cogen',
    preterite: 'cogí, cogiste, cogió, cogimos, cogisteis, cogieron',
    imperfect: 'cogía, cogías, cogía, cogíamos, cogíais, cogían',
    future: F('coger'),
    conditional: C('coger'),
    presentSubjunctive: 'coja, cojas, coja, cojamos, cojáis, cojan',
    imperfectSubjunctive: 'cogiera, cogieras, cogiera, cogiéramos, cogierais, cogieran',
    imperativeAffirmative: 'coge, coja, cojamos, coged, cojan',
    gerund: 'cogiendo',
    participle: 'cogido',
  },
  seguir: {
    present: 'sigo, sigues, sigue, seguimos, seguís, siguen',
    preterite: 'seguí, seguiste, siguió, seguimos, seguisteis, siguieron',
    imperfect: 'seguía, seguías, seguía, seguíamos, seguíais, seguían',
    future: F('seguir'),
    conditional: C('seguir'),
    presentSubjunctive: 'siga, sigas, siga, sigamos, sigáis, sigan',
    imperfectSubjunctive: 'siguiera, siguieras, siguiera, siguiéramos, siguierais, siguieran',
    imperativeAffirmative: 'sigue, siga, sigamos, seguid, sigan',
    gerund: 'siguiendo',
    participle: 'seguido',
  },
  averiguar: {
    present: 'averiguo, averiguas, averigua, averiguamos, averiguáis, averiguan',
    preterite: 'averigüé, averiguaste, averiguó, averiguamos, averiguasteis, averiguaron',
    imperfect: 'averiguaba, averiguabas, averiguaba, averiguábamos, averiguabais, averiguaban',
    future: F('averiguar'),
    conditional: C('averiguar'),
    presentSubjunctive: 'averigüe, averigües, averigüe, averigüemos, averigüéis, averigüen',
    imperfectSubjunctive: 'averiguara, averiguaras, averiguara, averiguáramos, averiguarais, averiguaran',
    imperativeAffirmative: 'averigua, averigüe, averigüemos, averiguad, averigüen',
    gerund: 'averiguando',
    participle: 'averiguado',
  },
  enviar: {
    present: 'envío, envías, envía, enviamos, enviáis, envían',
    preterite: 'envié, enviaste, envió, enviamos, enviasteis, enviaron',
    imperfect: 'enviaba, enviabas, enviaba, enviábamos, enviabais, enviaban',
    future: F('enviar'),
    conditional: C('enviar'),
    presentSubjunctive: 'envíe, envíes, envíe, enviemos, enviéis, envíen',
    imperfectSubjunctive: 'enviara, enviaras, enviara, enviáramos, enviarais, enviaran',
    imperativeAffirmative: 'envía, envíe, enviemos, enviad, envíen',
    gerund: 'enviando',
    participle: 'enviado',
  },
  continuar: {
    present: 'continúo, continúas, continúa, continuamos, continuáis, continúan',
    preterite: 'continué, continuaste, continuó, continuamos, continuasteis, continuaron',
    imperfect: 'continuaba, continuabas, continuaba, continuábamos, continuabais, continuaban',
    future: F('continuar'),
    conditional: C('continuar'),
    presentSubjunctive: 'continúe, continúes, continúe, continuemos, continuéis, continúen',
    imperfectSubjunctive: 'continuara, continuaras, continuara, continuáramos, continuarais, continuaran',
    imperativeAffirmative: 'continúa, continúe, continuemos, continuad, continúen',
    gerund: 'continuando',
    participle: 'continuado',
  },
  reír: {
    present: 'río, ríes, ríe, reímos, reís, ríen',
    preterite: 'reí, reíste, rio|rió, reímos, reísteis, rieron',
    imperfect: 'reía, reías, reía, reíamos, reíais, reían',
    future: F('reir'),
    conditional: C('reir'),
    presentSubjunctive: 'ría, rías, ría, riamos, riais|riáis, rían',
    imperfectSubjunctive: 'riera, rieras, riera, riéramos, rierais, rieran',
    imperativeAffirmative: 'ríe, ría, riamos, reíd, rían',
    gerund: 'riendo',
    participle: 'reído',
  },
  freír: {
    present: 'frío, fríes, fríe, freímos, freís, fríen',
    preterite: 'freí, freíste, frio|frió, freímos, freísteis, frieron',
    imperfect: 'freía, freías, freía, freíamos, freíais, freían',
    future: F('freir'),
    conditional: C('freir'),
    presentSubjunctive: 'fría, frías, fría, friamos, friais|friáis, frían',
    imperfectSubjunctive: 'friera, frieras, friera, friéramos, frierais, frieran',
    imperativeAffirmative: 'fríe, fría, friamos, freíd, frían',
    gerund: 'friendo',
    participle: 'frito|freído',
  },
  sonreír: {
    present: 'sonrío, sonríes, sonríe, sonreímos, sonreís, sonríen',
    preterite: 'sonreí, sonreíste, sonrió, sonreímos, sonreísteis, sonrieron',
    imperfect: 'sonreía, sonreías, sonreía, sonreíamos, sonreíais, sonreían',
    future: F('sonreir'),
    conditional: C('sonreir'),
    presentSubjunctive: 'sonría, sonrías, sonría, sonriamos, sonriáis, sonrían',
    imperfectSubjunctive: 'sonriera, sonrieras, sonriera, sonriéramos, sonrierais, sonrieran',
    imperativeAffirmative: 'sonríe, sonría, sonriamos, sonreíd, sonrían',
    gerund: 'sonriendo',
    participle: 'sonreído',
  },
  obtener: {
    present: 'obtengo, obtienes, obtiene, obtenemos, obtenéis, obtienen',
    preterite: 'obtuve, obtuviste, obtuvo, obtuvimos, obtuvisteis, obtuvieron',
    imperfect: 'obtenía, obtenías, obtenía, obteníamos, obteníais, obtenían',
    future: F('obtendr'),
    conditional: C('obtendr'),
    presentSubjunctive: 'obtenga, obtengas, obtenga, obtengamos, obtengáis, obtengan',
    imperfectSubjunctive: 'obtuviera, obtuvieras, obtuviera, obtuviéramos, obtuvierais, obtuvieran',
    imperativeAffirmative: 'obtén, obtenga, obtengamos, obtened, obtengan',
    gerund: 'obteniendo',
    participle: 'obtenido',
  },
  prevenir: {
    present: 'prevengo, previenes, previene, prevenimos, prevenís, previenen',
    preterite: 'previne, previniste, previno, previnimos, previnisteis, previnieron',
    imperfect: 'prevenía, prevenías, prevenía, preveníamos, preveníais, prevenían',
    future: F('prevendr'),
    conditional: C('prevendr'),
    presentSubjunctive: 'prevenga, prevengas, prevenga, prevengamos, prevengáis, prevengan',
    imperfectSubjunctive: 'previniera, previnieras, previniera, previniéramos, previnierais, previnieran',
    imperativeAffirmative: 'prevén, prevenga, prevengamos, prevenid, prevengan',
    gerund: 'previniendo',
    participle: 'prevenido',
  },
  componer: {
    present: 'compongo, compones, compone, componemos, componéis, componen',
    preterite: 'compuse, compusiste, compuso, compusimos, compusisteis, compusieron',
    imperfect: 'componía, componías, componía, componíamos, componíais, componían',
    future: F('compondr'),
    conditional: C('compondr'),
    presentSubjunctive: 'componga, compongas, componga, compongamos, compongáis, compongan',
    imperfectSubjunctive: 'compusiera, compusieras, compusiera, compusiéramos, compusierais, compusieran',
    imperativeAffirmative: 'compón, componga, compongamos, componed, compongan',
    gerund: 'componiendo',
    participle: 'compuesto',
  },
  predecir: {
    present: 'predigo, predices, predice, predecimos, predecís, predicen',
    preterite: 'predije, predijiste, predijo, predijimos, predijisteis, predijeron',
    imperfect: 'predecía, predecías, predecía, predecíamos, predecíais, predecían',
    future: 'predeciré|prediré, predecirás|predirás, predecirá|predirá, predeciremos|prediremos, predeciréis|prediréis, predecirán|predirán',
    conditional: 'predeciría|prediría, predecirías|predirías, predeciría|prediría, predeciríamos|prediríamos, predeciríais|prediríais, predecirían|predirían',
    presentSubjunctive: 'prediga, predigas, prediga, predigamos, predigáis, predigan',
    imperfectSubjunctive: 'predijera, predijeras, predijera, predijéramos, predijerais, predijeran',
    imperativeAffirmative: 'predice, prediga, predigamos, predecid, predigan',
    gerund: 'prediciendo',
    participle: 'predicho',
  },
  bendecir: {
    present: 'bendigo, bendices, bendice, bendecimos, bendecís, bendicen',
    preterite: 'bendije, bendijiste, bendijo, bendijimos, bendijisteis, bendijeron',
    imperfect: 'bendecía, bendecías, bendecía, bendecíamos, bendecíais, bendecían',
    future: F('bendecir'),
    conditional: C('bendecir'),
    presentSubjunctive: 'bendiga, bendigas, bendiga, bendigamos, bendigáis, bendigan',
    imperfectSubjunctive: 'bendijera, bendijeras, bendijera, bendijéramos, bendijerais, bendijeran',
    imperativeAffirmative: 'bendice, bendiga, bendigamos, bendecid, bendigan',
    gerund: 'bendiciendo',
    participle: 'bendecido',
  },
  satisfacer: {
    present: 'satisfago, satisfaces, satisface, satisfacemos, satisfacéis, satisfacen',
    preterite: 'satisfice, satisficiste, satisfizo, satisficimos, satisficisteis, satisficieron',
    imperfect: 'satisfacía, satisfacías, satisfacía, satisfacíamos, satisfacíais, satisfacían',
    future: F('satisfar'),
    conditional: C('satisfar'),
    presentSubjunctive: 'satisfaga, satisfagas, satisfaga, satisfagamos, satisfagáis, satisfagan',
    imperfectSubjunctive: 'satisficiera, satisficieras, satisficiera, satisficiéramos, satisficierais, satisficieran',
    imperativeAffirmative: 'satisfaz|satisface, satisfaga, satisfagamos, satisfaced, satisfagan',
    gerund: 'satisfaciendo',
    participle: 'satisfecho',
  },
  prever: {
    present: 'preveo, prevés, prevé, prevemos, prevéis, prevén',
    preterite: 'preví, previste, previó, previmos, previsteis, previeron',
    imperfect: 'preveía, preveías, preveía, preveíamos, preveíais, preveían',
    future: F('prever'),
    conditional: C('prever'),
    presentSubjunctive: 'prevea, preveas, prevea, preveamos, preveáis, prevean',
    imperfectSubjunctive: 'previera, previeras, previera, previéramos, previerais, previeran',
    imperativeAffirmative: 'prevé, prevea, preveamos, preved, prevean',
    gerund: 'previendo',
    participle: 'previsto',
  },
  guiar: {
    present: 'guío, guías, guía, guiamos, guiais|guiáis, guían',
    preterite: 'guie|guié, guiaste, guio|guió, guiamos, guiasteis, guiaron',
    imperfect: 'guiaba, guiabas, guiaba, guiábamos, guiabais, guiaban',
    future: F('guiar'),
    conditional: C('guiar'),
    presentSubjunctive: 'guíe, guíes, guíe, guiemos, guieis|guiéis, guíen',
    imperfectSubjunctive: 'guiara, guiaras, guiara, guiáramos, guiarais, guiaran',
    imperativeAffirmative: 'guía, guíe, guiemos, guiad, guíen',
    gerund: 'guiando',
    participle: 'guiado',
  },
  adquirir: {
    present: 'adquiero, adquieres, adquiere, adquirimos, adquirís, adquieren',
    preterite: 'adquirí, adquiriste, adquirió, adquirimos, adquiristeis, adquirieron',
    imperfect: 'adquiría, adquirías, adquiría, adquiríamos, adquiríais, adquirían',
    future: F('adquirir'),
    conditional: C('adquirir'),
    presentSubjunctive: 'adquiera, adquieras, adquiera, adquiramos, adquiráis, adquieran',
    imperfectSubjunctive: 'adquiriera, adquirieras, adquiriera, adquiriéramos, adquirierais, adquirieran',
    imperativeAffirmative: 'adquiere, adquiera, adquiramos, adquirid, adquieran',
    gerund: 'adquiriendo',
    participle: 'adquirido',
  },
  oler: {
    present: 'huelo, hueles, huele, olemos, oléis, huelen',
    preterite: 'olí, oliste, olió, olimos, olisteis, olieron',
    imperfect: 'olía, olías, olía, olíamos, olíais, olían',
    future: F('oler'),
    conditional: C('oler'),
    presentSubjunctive: 'huela, huelas, huela, olamos, oláis, huelan',
    imperfectSubjunctive: 'oliera, olieras, oliera, oliéramos, olierais, olieran',
    imperativeAffirmative: 'huele, huela, olamos, oled, huelan',
    gerund: 'oliendo',
    participle: 'olido',
  },
  errar: {
    present: 'yerro|erro, yerras|erras, yerra|erra, erramos, erráis, yerran|erran',
    preterite: 'erré, erraste, erró, erramos, errasteis, erraron',
    imperfect: 'erraba, errabas, erraba, errábamos, errabais, erraban',
    future: F('errar'),
    conditional: C('errar'),
    presentSubjunctive: 'yerre|erre, yerres|erres, yerre|erre, erremos, erréis, yerren|erren',
    imperfectSubjunctive: 'errara, erraras, errara, erráramos, errarais, erraran',
    imperativeAffirmative: 'yerra|erra, yerre|erre, erremos, errad, yerren|erren',
    gerund: 'errando',
    participle: 'errado',
  },
  vencer: {
    present: 'venzo, vences, vence, vencemos, vencéis, vencen',
    preterite: 'vencí, venciste, venció, vencimos, vencisteis, vencieron',
    imperfect: 'vencía, vencías, vencía, vencíamos, vencíais, vencían',
    future: F('vencer'),
    conditional: C('vencer'),
    presentSubjunctive: 'venza, venzas, venza, venzamos, venzáis, venzan',
    imperfectSubjunctive: 'venciera, vencieras, venciera, venciéramos, vencierais, vencieran',
    imperativeAffirmative: 'vence, venza, venzamos, venced, venzan',
    gerund: 'venciendo',
    participle: 'vencido',
  },
  distinguir: {
    present: 'distingo, distingues, distingue, distinguimos, distinguís, distinguen',
    preterite: 'distinguí, distinguiste, distinguió, distinguimos, distinguisteis, distinguieron',
    imperfect: 'distinguía, distinguías, distinguía, distinguíamos, distinguíais, distinguían',
    future: F('distinguir'),
    conditional: C('distinguir'),
    presentSubjunctive: 'distinga, distingas, distinga, distingamos, distingáis, distingan',
    imperfectSubjunctive: 'distinguiera, distinguieras, distinguiera, distinguiéramos, distinguierais, distinguieran',
    imperativeAffirmative: 'distingue, distinga, distingamos, distinguid, distingan',
    gerund: 'distinguiendo',
    participle: 'distinguido',
  },
  elegir: {
    present: 'elijo, eliges, elige, elegimos, elegís, eligen',
    preterite: 'elegí, elegiste, eligió, elegimos, elegisteis, eligieron',
    imperfect: 'elegía, elegías, elegía, elegíamos, elegíais, elegían',
    future: F('elegir'),
    conditional: C('elegir'),
    presentSubjunctive: 'elija, elijas, elija, elijamos, elijáis, elijan',
    imperfectSubjunctive: 'eligiera, eligieras, eligiera, eligiéramos, eligierais, eligieran',
    imperativeAffirmative: 'elige, elija, elijamos, elegid, elijan',
    gerund: 'eligiendo',
    participle: 'elegido',
  },
  teñir: {
    present: 'tiño, tiñes, tiñe, teñimos, teñís, tiñen',
    preterite: 'teñí, teñiste, tiñó, teñimos, teñisteis, tiñeron',
    imperfect: 'teñía, teñías, teñía, teñíamos, teñíais, teñían',
    future: F('teñir'),
    conditional: C('teñir'),
    presentSubjunctive: 'tiña, tiñas, tiña, tiñamos, tiñáis, tiñan',
    imperfectSubjunctive: 'tiñera, tiñeras, tiñera, tiñéramos, tiñerais, tiñeran',
    imperativeAffirmative: 'tiñe, tiña, tiñamos, teñid, tiñan',
    gerund: 'tiñendo',
    participle: 'teñido',
  },
  almorzar: {
    present: 'almuerzo, almuerzas, almuerza, almorzamos, almorzáis, almuerzan',
    preterite: 'almorcé, almorzaste, almorzó, almorzamos, almorzasteis, almorzaron',
    imperfect: 'almorzaba, almorzabas, almorzaba, almorzábamos, almorzabais, almorzaban',
    future: F('almorzar'),
    conditional: C('almorzar'),
    presentSubjunctive: 'almuerce, almuerces, almuerce, almorcemos, almorcéis, almuercen',
    imperfectSubjunctive: 'almorzara, almorzaras, almorzara, almorzáramos, almorzarais, almorzaran',
    imperativeAffirmative: 'almuerza, almuerce, almorcemos, almorzad, almuercen',
    gerund: 'almorzando',
    participle: 'almorzado',
  },
  avergonzar: {
    present: 'avergüenzo, avergüenzas, avergüenza, avergonzamos, avergonzáis, avergüenzan',
    preterite: 'avergoncé, avergonzaste, avergonzó, avergonzamos, avergonzasteis, avergonzaron',
    imperfect: 'avergonzaba, avergonzabas, avergonzaba, avergonzábamos, avergonzabais, avergonzaban',
    future: F('avergonzar'),
    conditional: C('avergonzar'),
    presentSubjunctive: 'avergüence, avergüences, avergüence, avergoncemos, avergoncéis, avergüencen',
    imperfectSubjunctive: 'avergonzara, avergonzaras, avergonzara, avergonzáramos, avergonzarais, avergonzaran',
    imperativeAffirmative: 'avergüenza, avergüence, avergoncemos, avergonzad, avergüencen',
    gerund: 'avergonzando',
    participle: 'avergonzado',
  },
  cocer: {
    present: 'cuezo, cueces, cuece, cocemos, cocéis, cuecen',
    preterite: 'cocí, cociste, coció, cocimos, cocisteis, cocieron',
    imperfect: 'cocía, cocías, cocía, cocíamos, cocíais, cocían',
    future: F('cocer'),
    conditional: C('cocer'),
    presentSubjunctive: 'cueza, cuezas, cueza, cozamos, cozáis, cuezan',
    imperfectSubjunctive: 'cociera, cocieras, cociera, cociéramos, cocierais, cocieran',
    imperativeAffirmative: 'cuece, cueza, cozamos, coced, cuezan',
    gerund: 'cociendo',
    participle: 'cocido',
  },
  prohibir: {
    present: 'prohíbo, prohíbes, prohíbe, prohibimos, prohibís, prohíben',
    preterite: 'prohibí, prohibiste, prohibió, prohibimos, prohibisteis, prohibieron',
    imperfect: 'prohibía, prohibías, prohibía, prohibíamos, prohibíais, prohibían',
    future: F('prohibir'),
    conditional: C('prohibir'),
    presentSubjunctive: 'prohíba, prohíbas, prohíba, prohibamos, prohibáis, prohíban',
    imperfectSubjunctive: 'prohibiera, prohibieras, prohibiera, prohibiéramos, prohibierais, prohibieran',
    imperativeAffirmative: 'prohíbe, prohíba, prohibamos, prohibid, prohíban',
    gerund: 'prohibiendo',
    participle: 'prohibido',
  },
  reunir: {
    present: 'reúno, reúnes, reúne, reunimos, reunís, reúnen',
    preterite: 'reuní, reuniste, reunió, reunimos, reunisteis, reunieron',
    imperfect: 'reunía, reunías, reunía, reuníamos, reuníais, reunían',
    future: F('reunir'),
    conditional: C('reunir'),
    presentSubjunctive: 'reúna, reúnas, reúna, reunamos, reunáis, reúnan',
    imperfectSubjunctive: 'reuniera, reunieras, reuniera, reuniéramos, reunierais, reunieran',
    imperativeAffirmative: 'reúne, reúna, reunamos, reunid, reúnan',
    gerund: 'reuniendo',
    participle: 'reunido',
  },
  rehacer: {
    present: 'rehago, rehaces, rehace, rehacemos, rehacéis, rehacen',
    preterite: 'rehíce, rehiciste, rehízo, rehicimos, rehicisteis, rehicieron',
    imperfect: 'rehacía, rehacías, rehacía, rehacíamos, rehacíais, rehacían',
    future: F('rehar'),
    conditional: C('rehar'),
    presentSubjunctive: 'rehaga, rehagas, rehaga, rehagamos, rehagáis, rehagan',
    imperfectSubjunctive: 'rehiciera, rehicieras, rehiciera, rehiciéramos, rehicierais, rehicieran',
    imperativeAffirmative: 'rehaz, rehaga, rehagamos, rehaced, rehagan',
    gerund: 'rehaciendo',
    participle: 'rehecho',
  },
  rehuir: {
    present: 'rehúyo, rehúyes, rehúye, rehuimos, rehuís, rehúyen',
    preterite: 'rehuí, rehuiste, rehuyó, rehuimos, rehuisteis, rehuyeron',
    imperfect: 'rehuía, rehuías, rehuía, rehuíamos, rehuíais, rehuían',
    future: F('rehuir'),
    conditional: C('rehuir'),
    presentSubjunctive: 'rehúya, rehúyas, rehúya, rehuyamos, rehuyáis, rehúyan',
    imperfectSubjunctive: 'rehuyera, rehuyeras, rehuyera, rehuyéramos, rehuyerais, rehuyeran',
    imperativeAffirmative: 'rehúye, rehúya, rehuyamos, rehuid, rehúyan',
    gerund: 'rehuyendo',
    participle: 'rehuido',
  },
  llamarse: {
    present: 'me llamo, te llamas, se llama, nos llamamos, os llamáis, se llaman',
    preterite: 'me llamé, te llamaste, se llamó, nos llamamos, os llamasteis, se llamaron',
    imperfect: 'me llamaba, te llamabas, se llamaba, nos llamábamos, os llamabais, se llamaban',
    future: 'me llamaré, te llamarás, se llamará, nos llamaremos, os llamaréis, se llamarán',
    conditional: 'me llamaría, te llamarías, se llamaría, nos llamaríamos, os llamaríais, se llamarían',
    presentSubjunctive: 'me llame, te llames, se llame, nos llamemos, os llaméis, se llamen',
    imperfectSubjunctive: 'me llamara, te llamaras, se llamara, nos llamáramos, os llamarais, se llamaran',
    imperativeAffirmative: 'llámate, llámese, llamémonos, llamaos, llámense',
    gerund: 'llamando',
    participle: 'llamado',
    progressive:
      'me estoy llamando|estoy llamándome, te estás llamando|estás llamándote, se está llamando|está llamándose, ' +
      'nos estamos llamando|estamos llamándonos, os estáis llamando|estáis llamándoos, se están llamando|están llamándose',
  },
  levantarse: {
    present: 'me levanto, te levantas, se levanta, nos levantamos, os levantáis, se levantan',
    preterite: 'me levanté, te levantaste, se levantó, nos levantamos, os levantasteis, se levantaron',
    imperfect: 'me levantaba, te levantabas, se levantaba, nos levantábamos, os levantabais, se levantaban',
    future: 'me levantaré, te levantarás, se levantará, nos levantaremos, os levantaréis, se levantarán',
    conditional: 'me levantaría, te levantarías, se levantaría, nos levantaríamos, os levantaríais, se levantarían',
    presentSubjunctive: 'me levante, te levantes, se levante, nos levantemos, os levantéis, se levanten',
    imperfectSubjunctive: 'me levantara, te levantaras, se levantara, nos levantáramos, os levantarais, se levantaran',
    imperativeAffirmative: 'levántate, levántese, levantémonos, levantaos, levántense',
    gerund: 'levantando',
    participle: 'levantado',
    progressive:
      'me estoy levantando|estoy levantándome, te estás levantando|estás levantándote, se está levantando|está levantándose, ' +
      'nos estamos levantando|estamos levantándonos, os estáis levantando|estáis levantándoos, se están levantando|están levantándose',
  },
  irse: {
    present: 'me voy, te vas, se va, nos vamos, os vais, se van',
    preterite: 'me fui, te fuiste, se fue, nos fuimos, os fuisteis, se fueron',
    imperfect: 'me iba, te ibas, se iba, nos íbamos, os ibais, se iban',
    future: 'me iré, te irás, se irá, nos iremos, os iréis, se irán',
    conditional: 'me iría, te irías, se iría, nos iríamos, os iríais, se irían',
    presentSubjunctive: 'me vaya, te vayas, se vaya, nos vayamos, os vayáis, se vayan',
    imperfectSubjunctive: 'me fuera, te fueras, se fuera, nos fuéramos, os fuerais, se fueran',
    imperativeAffirmative: 'vete, váyase, vámonos|vayámonos, idos|iros, váyanse',
    gerund: 'yendo',
    participle: 'ido',
    progressive:
      'me estoy yendo|estoy yéndome, te estás yendo|estás yéndote, se está yendo|está yéndose, ' +
      'nos estamos yendo|estamos yéndonos, os estáis yendo|estáis yéndoos, se están yendo|están yéndose',
  },
  vestirse: {
    present: 'me visto, te vistes, se viste, nos vestimos, os vestís, se visten',
    preterite: 'me vestí, te vestiste, se vistió, nos vestimos, os vestisteis, se vistieron',
    imperfect: 'me vestía, te vestías, se vestía, nos vestíamos, os vestíais, se vestían',
    future: 'me vestiré, te vestirás, se vestirá, nos vestiremos, os vestiréis, se vestirán',
    conditional: 'me vestiría, te vestirías, se vestiría, nos vestiríamos, os vestiríais, se vestirían',
    presentSubjunctive: 'me vista, te vistas, se vista, nos vistamos, os vistáis, se vistan',
    imperfectSubjunctive: 'me vistiera, te vistieras, se vistiera, nos vistiéramos, os vistierais, se vistieran',
    imperativeAffirmative: 'vístete, vístase, vistámonos, vestíos, vístanse',
    gerund: 'vistiendo',
    participle: 'vestido',
    progressive:
      'me estoy vistiendo|estoy vistiéndome, te estás vistiendo|estás vistiéndote, se está vistiendo|está vistiéndose, ' +
      'nos estamos vistiendo|estamos vistiéndonos, os estáis vistiendo|estáis vistiéndoos, se están vistiendo|están vistiéndose',
  },
  reírse: {
    present: 'me río, te ríes, se ríe, nos reímos, os reís, se ríen',
    preterite: 'me reí, te reíste, se rio|se rió, nos reímos, os reísteis, se rieron',
    imperfect: 'me reía, te reías, se reía, nos reíamos, os reíais, se reían',
    future: 'me reiré, te reirás, se reirá, nos reiremos, os reiréis, se reirán',
    conditional: 'me reiría, te reirías, se reiría, nos reiríamos, os reiríais, se reirían',
    presentSubjunctive: 'me ría, te rías, se ría, nos riamos, os riais|os riáis, se rían',
    imperfectSubjunctive: 'me riera, te rieras, se riera, nos riéramos, os rierais, se rieran',
    imperativeAffirmative: 'ríete, ríase, riámonos, reíos, ríanse',
    gerund: 'riendo',
    participle: 'reído',
    progressive:
      'me estoy riendo|estoy riéndome, te estás riendo|estás riéndote, se está riendo|está riéndose, ' +
      'nos estamos riendo|estamos riéndonos, os estáis riendo|estáis riéndoos, se están riendo|están riéndose',
  },
  dormirse: {
    present: 'me duermo, te duermes, se duerme, nos dormimos, os dormís, se duermen',
    preterite: 'me dormí, te dormiste, se durmió, nos dormimos, os dormisteis, se durmieron',
    imperfect: 'me dormía, te dormías, se dormía, nos dormíamos, os dormíais, se dormían',
    future: 'me dormiré, te dormirás, se dormirá, nos dormiremos, os dormiréis, se dormirán',
    conditional: 'me dormiría, te dormirías, se dormiría, nos dormiríamos, os dormiríais, se dormirían',
    presentSubjunctive: 'me duerma, te duermas, se duerma, nos durmamos, os durmáis, se duerman',
    imperfectSubjunctive: 'me durmiera, te durmieras, se durmiera, nos durmiéramos, os durmierais, se durmieran',
    imperativeAffirmative: 'duérmete, duérmase, durmámonos, dormíos, duérmanse',
    gerund: 'durmiendo',
    participle: 'dormido',
    progressive:
      'me estoy durmiendo|estoy durmiéndome, te estás durmiendo|estás durmiéndote, se está durmiendo|está durmiéndose, ' +
      'nos estamos durmiendo|estamos durmiéndonos, os estáis durmiendo|estáis durmiéndoos, se están durmiendo|están durmiéndose',
  },
};

describe('full paradigms', () => {
  for (const [inf, data] of Object.entries(PARADIGMS)) {
    it(inf, () => {
      expect(paradigm(inf)).toEqual(expected(inf, data));
    });
  }
});

describe('the tense list', () => {
  it('has the twelve tense ids, with no yo in the imperatives', () => {
    expect(TENSES.map((t) => t.id).sort()).toEqual(
      [
        'present', 'preterite', 'imperfect', 'future', 'conditional', 'presentSubjunctive', 'imperfectSubjunctive',
        'imperativeAffirmative', 'imperativeNegative', 'presentPerfect', 'pluperfect', 'presentProgressive',
      ].sort(),
    );
    for (const t of TENSES) {
      expect(t.persons.includes('yo')).toBe(!t.id.startsWith('imperative'));
      expect(t.es.length).toBeGreaterThan(0);
      expect(t.en.length).toBeGreaterThan(0);
    }
    expect(TENSES.find((t) => t.id === 'present')?.es).toBe('presente');
    expect(TENSES.find((t) => t.id === 'present')?.en).toBe('present');
  });

  it('labels persons, naming usted/ustedes in commands', () => {
    expect(PERSONS.map((p) => p.es)).toEqual([
      'yo', 'tú', 'vos', 'él / ella / usted', 'nosotros / nosotras', 'vosotros / vosotras', 'ellos / ellas / ustedes',
    ]);
    expect(personLabel('present', 'el')).toBe('él / ella / usted');
    expect(personLabel('imperativeAffirmative', 'el')).toBe('usted');
    expect(personLabel('imperativeNegative', 'ellos')).toBe('ustedes');
    expect(personLabel('imperativeNegative', 'tu')).toBe('tú');
  });

  it('returns null for yo in the imperatives and for non-infinitives', () => {
    expect(conjugate('hablar', 'imperativeAffirmative', 'yo')).toBeNull();
    expect(conjugate('hablar', 'imperativeNegative', 'yo')).toBeNull();
    expect(conjugate('casa', 'present', 'yo')).toBeNull();
    expect(conjugate('', 'present', 'yo')).toBeNull();
  });
});

describe('models and irregular classes', () => {
  const cell = (inf: string, tense: Tense, person: Person) => conjugate(inf, tense, person);

  it('handles the orthographic changes', () => {
    expect(cell('tocar', 'preterite', 'yo')).toEqual(['toqué']);
    expect(cell('pagar', 'presentSubjunctive', 'nosotros')).toEqual(['paguemos']);
    expect(cell('cruzar', 'preterite', 'yo')).toEqual(['crucé']);
    expect(cell('dirigir', 'present', 'yo')).toEqual(['dirijo']);
    expect(cell('escoger', 'presentSubjunctive', 'tu')).toEqual(['escojas']);
    expect(cell('conseguir', 'present', 'yo')).toEqual(['consigo']);
    expect(cell('delinquir', 'present', 'yo')).toEqual(['delinco']);
    expect(cell('convencer', 'present', 'yo')).toEqual(['convenzo']);
    expect(cell('esparcir', 'presentSubjunctive', 'el')).toEqual(['esparza']);
    expect(cell('apaciguar', 'preterite', 'yo')).toEqual(['apacigüé']);
  });

  it('handles the stem-change combinations', () => {
    expect(cell('colgar', 'presentSubjunctive', 'yo')).toEqual(['cuelgue']);
    expect(cell('colgar', 'preterite', 'yo')).toEqual(['colgué']);
    expect(cell('forzar', 'present', 'yo')).toEqual(['fuerzo']);
    expect(cell('forzar', 'presentSubjunctive', 'yo')).toEqual(['fuerce']);
    expect(cell('torcer', 'present', 'yo')).toEqual(['tuerzo']);
    expect(cell('tropezar', 'presentSubjunctive', 'el')).toEqual(['tropiece']);
    expect(cell('fregar', 'presentSubjunctive', 'ellos')).toEqual(['frieguen']);
    expect(cell('corregir', 'present', 'yo')).toEqual(['corrijo']);
    expect(cell('corregir', 'preterite', 'ellos')).toEqual(['corrigieron']);
    expect(cell('divertir', 'preterite', 'el')).toEqual(['divirtió']);
    expect(cell('preferir', 'presentSubjunctive', 'nosotros')).toEqual(['prefiramos']);
    expect(cell('servir', 'presentProgressive', 'yo')).toEqual(['estoy sirviendo']);
    expect(cell('discernir', 'present', 'yo')).toEqual(['discierno']);
    expect(cell('discernir', 'preterite', 'el')).toEqual(['discernió']);
    expect(cell('encontrar', 'present', 'ellos')).toEqual(['encuentran']);
    expect(cell('recordar', 'present', 'yo')).toEqual(['recuerdo']);
    expect(cell('despertar', 'present', 'yo')).toEqual(['despierto']);
    expect(cell('entender', 'present', 'tu')).toEqual(['entiendes']);
  });

  it('stresses í/ú where the model says so, and only there', () => {
    expect(cell('esquiar', 'present', 'yo')).toEqual(['esquío']);
    expect(cell('graduar', 'present', 'el')).toEqual(['gradúa']);
    expect(cell('aislar', 'present', 'yo')).toEqual(['aíslo']);
    expect(cell('rehusar', 'present', 'yo')).toEqual(['rehúso']);
    expect(cell('estudiar', 'present', 'yo')).toEqual(['estudio']);
    expect(cell('cambiar', 'presentSubjunctive', 'el')).toEqual(['cambie']);
  });

  it('writes RAE 2010 monosyllables without accent, accepting the old spelling', () => {
    expect(cell('fiar', 'preterite', 'yo')).toEqual(['fie', 'fié']);
    expect(cell('fiar', 'preterite', 'el')).toEqual(['fio', 'fió']);
    expect(cell('criar', 'present', 'vosotros')).toEqual(['criais', 'criáis']);
    expect(cell('ser', 'preterite', 'el')).toEqual(['fue']);
    expect(cell('dar', 'preterite', 'el')).toEqual(['dio']);
    expect(cell('ver', 'preterite', 'yo')).toEqual(['vi']);
    expect(cell('dar', 'presentSubjunctive', 'el')).toEqual(['dé']);
    expect(cell('saber', 'present', 'yo')).toEqual(['sé']);
  });

  it('uses the irregular participles', () => {
    const pp = (inf: string) => conjugate(inf, 'presentPerfect', 'yo')?.map((f) => f.replace(/^he /, ''));
    expect(pp('abrir')).toEqual(['abierto']);
    expect(pp('cubrir')).toEqual(['cubierto']);
    expect(pp('descubrir')).toEqual(['descubierto']);
    expect(pp('escribir')).toEqual(['escrito']);
    expect(pp('describir')).toEqual(['descrito']);
    expect(pp('romper')).toEqual(['roto']);
    expect(pp('resolver')).toEqual(['resuelto']);
    expect(pp('devolver')).toEqual(['devuelto']);
    expect(pp('envolver')).toEqual(['envuelto']);
    expect(pp('imprimir')).toEqual(['impreso', 'imprimido']);
    expect(pp('proveer')).toEqual(['provisto', 'proveído']);
    expect(pp('freír')).toEqual(['frito', 'freído']);
    expect(pp('deshacer')).toEqual(['deshecho']);
    expect(pp('suponer')).toEqual(['supuesto']);
    expect(pp('maldecir')).toEqual(['maldecido']);
    expect(pp('contradecir')).toEqual(['contradicho']);
  });

  it('inherits irregular stems in compounds, with the accents the prefix requires', () => {
    expect(cell('mantener', 'imperativeAffirmative', 'tu')).toEqual(['mantén']);
    expect(cell('detener', 'preterite', 'yo')).toEqual(['detuve']);
    expect(cell('convenir', 'imperativeAffirmative', 'tu')).toEqual(['convén']);
    expect(cell('intervenir', 'future', 'yo')).toEqual(['intervendré']);
    expect(cell('suponer', 'imperativeAffirmative', 'tu')).toEqual(['supón']);
    expect(cell('proponer', 'preterite', 'el')).toEqual(['propuso']);
    expect(cell('deshacer', 'imperativeAffirmative', 'tu')).toEqual(['deshaz']);
    expect(cell('distraer', 'preterite', 'ellos')).toEqual(['distrajeron']);
    expect(cell('contraer', 'present', 'yo')).toEqual(['contraigo']);
    expect(cell('traducir', 'preterite', 'yo')).toEqual(['traduje']);
    expect(cell('producir', 'present', 'yo')).toEqual(['produzco']);
    expect(cell('introducir', 'imperfectSubjunctive', 'ellos')).toEqual(['introdujeran', 'introdujesen']);
    expect(cell('deducir', 'preterite', 'ellos')).toEqual(['dedujeron']);
    expect(cell('reducir', 'presentSubjunctive', 'nosotros')).toEqual(['reduzcamos']);
    expect(cell('contradecir', 'imperativeAffirmative', 'tu')).toEqual(['contradice']);
    expect(cell('maldecir', 'future', 'yo')).toEqual(['maldeciré']);
    // Answer-key audit: DPD prefers the regular predeciré/predeciría; prediré is the rare alternative.
    expect(cell('predecir', 'future', 'yo')).toEqual(['predeciré', 'prediré']);
    expect(cell('predecir', 'conditional', 'ellos')).toEqual(['predecirían', 'predirían']);
    // contradecir and desdecir keep the irregular form first.
    expect(cell('contradecir', 'future', 'yo')).toEqual(['contradiré', 'contradeciré']);
    expect(cell('desdecir', 'conditional', 'yo')).toEqual(['desdiría', 'desdeciría']);
    expect(cell('sostener', 'present', 'el')).toEqual(['sostiene']);
    expect(cell('contener', 'conditional', 'yo')).toEqual(['contendría']);
    expect(cell('disponer', 'future', 'nosotros')).toEqual(['dispondremos']);
    expect(cell('sobresalir', 'imperativeAffirmative', 'tu')).toEqual(['sobresal']);
    expect(cell('equivaler', 'present', 'yo')).toEqual(['equivalgo']);
    expect(cell('entrever', 'present', 'tu')).toEqual(['entrevés']);
  });

  it('conjugates unknown infinitives as regular verbs, with the spelling changes', () => {
    expect(isKnownVerb('twittear')).toBe(false);
    expect(cell('twittear', 'present', 'yo')).toEqual(['twitteo']);
    expect(cell('googlear', 'preterite', 'yo')).toEqual(['googleé']);
    expect(cell('chatear', 'present', 'nosotros')).toEqual(['chateamos']);
    expect(cell('textear', 'presentSubjunctive', 'el')).toEqual(['textee']);
    expect(cell('hackear', 'preterite', 'yo')).toEqual(['hackeé']);
    expect(cell('flipar', 'imperativeAffirmative', 'tu')).toEqual(['flipa']);
    expect(cell('esnifar', 'preterite', 'el')).toEqual(['esnifó']);
    expect(cell('blogar', 'preterite', 'yo')).toEqual(['blogué']);
    expect(cell('zarandearse', 'imperativeAffirmative', 'tu')).toEqual(['zarandéate']);
  });

  it('normalizes the infinitive (case, spaces)', () => {
    expect(conjugate('  Hablar ', 'present', 'yo')).toEqual(['hablo']);
    expect(conjugate('LLAMARSE', 'present', 'yo')).toEqual(['me llamo']);
  });
});

describe('verbInfo / isKnownVerb', () => {
  it('describes dictionary verbs and reflexives', () => {
    expect(isKnownVerb('hablar')).toBe(true);
    expect(isKnownVerb('levantarse')).toBe(true);
    expect(isKnownVerb('casa')).toBe(false);
    expect(verbInfo('levantarse')).toEqual({ known: true, reflexive: true, base: 'levantar', kind: 'pronominal', model: 'regular' });
    expect(verbInfo('pensar')).toMatchObject({ known: true, reflexive: false, base: 'pensar', model: 'e>ie' });
    expect(verbInfo('empezar').model).toBe('e>ie, z>c');
    expect(verbInfo('jugar').model).toBe('u>ue, g>gu');
    expect(verbInfo('conducir').model).toBe('c>zc, preterite -uj-');
    expect(verbInfo('obtener').model).toBe('tener');
    expect(verbInfo('tener').model).toBe('tener');
    expect(verbInfo('construir').model).toBe('-uir: i>y');
    expect(verbInfo('blogear')).toEqual({ known: false, reflexive: false, base: 'blogear', kind: 'plain' });
  });
});

describe('audit regressions', () => {
  const cell = (inf: string, tense: Tense, person: Person) => conjugate(inf, tense, person);

  it('reads -eir / -oir infinitives typed without the accent as the -eír / -oír verbs', () => {
    expect(verbInfo('oir')).toMatchObject({ known: true, base: 'oír' });
    expect(verbInfo('REIRSE')).toMatchObject({ known: true, reflexive: true, base: 'reír' });
    expect(cell('oir', 'present', 'yo')).toEqual(['oigo']);
    expect(cell('oir', 'preterite', 'el')).toEqual(['oyó']);
    expect(cell('reir', 'present', 'yo')).toEqual(['río']);
    expect(cell('reir', 'preterite', 'el')).toEqual(['rio', 'rió']);
    expect(cell('sonreir', 'present', 'yo')).toEqual(['sonrío']);
    expect(cell('sonreir', 'preterite', 'el')).toEqual(['sonrió']);
    expect(cell('freir', 'present', 'yo')).toEqual(['frío']);
    expect(cell('freir', 'preterite', 'el')).toEqual(['frio', 'frió']);
    expect(cell('desoir', 'present', 'yo')).toEqual(['desoigo']);
    expect(cell('reirse', 'present', 'yo')).toEqual(['me río']);
    expect(cell('reirse', 'preterite', 'el')).toEqual(['se rio', 'se rió']);
    // -uir keeps its spelling: construir has no accent.
    expect(verbInfo('construir').base).toBe('construir');
  });

  it('gives unknown vowel + -cer/-cir verbs c>zc, and -ducir the -uj- preterite', () => {
    expect(isKnownVerb('perecer')).toBe(false);
    expect(cell('perecer', 'present', 'yo')).toEqual(['perezco']);
    expect(cell('perecer', 'presentSubjunctive', 'el')).toEqual(['perezca']);
    expect(cell('perecer', 'imperativeAffirmative', 'ellos')).toEqual(['perezcan']);
    expect(cell('perecer', 'imperativeNegative', 'tu')).toEqual(['no perezcas']);
    for (const [inf, yo] of [
      ['reaparecer', 'reaparezco'], ['decrecer', 'decrezco'], ['esclarecer', 'esclarezco'], ['entorpecer', 'entorpezco'],
      ['adolecer', 'adolezco'], ['enaltecer', 'enaltezco'], ['engrandecer', 'engrandezco'], ['deslucir', 'desluzco'],
    ]) {
      expect(cell(inf, 'present', 'yo'), inf).toEqual([yo]);
    }
    expect(cell('reconducir', 'present', 'yo')).toEqual(['reconduzco']);
    expect(cell('reconducir', 'presentSubjunctive', 'yo')).toEqual(['reconduzca']);
    expect(cell('reconducir', 'preterite', 'el')).toEqual(['recondujo']);
    expect(cell('reconducir', 'preterite', 'ellos')).toEqual(['recondujeron']);
    // After a consonant, and for mecer, c>z stays.
    expect(cell('remecer', 'present', 'yo')).toEqual(['remezo']);
    expect(cell('mecer', 'present', 'yo')).toEqual(['mezo']);
    // Unknown compounds of irregular verbs keep the irregularity.
    expect(cell('contrahacer', 'preterite', 'el')).toEqual(['contrahízo']);
    expect(cell('entreoír', 'present', 'yo')).toEqual(['entreoigo']);
  });

  it('conjugates pudrir and podrir with u everywhere except the participle podrido (DPD)', () => {
    for (const inf of ['pudrir', 'podrir']) {
      expect(cell(inf, 'present', 'yo'), inf).toEqual(['pudro']);
      expect(cell(inf, 'present', 'tu'), inf).toEqual(['pudres']);
      expect(cell(inf, 'imperfect', 'yo'), inf).toEqual(['pudría']);
      expect(cell(inf, 'conditional', 'yo'), inf).toEqual(['pudriría']);
      expect(cell(inf, 'preterite', 'el'), inf).toEqual(['pudrió']);
      expect(cell(inf, 'presentSubjunctive', 'yo'), inf).toEqual(['pudra']);
      expect(cell(inf, 'presentProgressive', 'yo'), inf).toEqual(['estoy pudriendo']);
      expect(cell(inf, 'presentPerfect', 'yo'), inf).toEqual(['he podrido']);
      expect(cell(inf, 'pluperfect', 'ellos'), inf).toEqual(['habían podrido']);
    }
    expect(verbInfo('podrir').model).toBe('pudrir (participle podrido)');
  });

  it('knows the stem-changing verbs the dictionary lacked', () => {
    expect(cell('moler', 'present', 'yo')).toEqual(['muelo']);
    expect(cell('moler', 'present', 'el')).toEqual(['muele']);
    expect(cell('moler', 'presentSubjunctive', 'el')).toEqual(['muela']);
    expect(cell('demoler', 'present', 'yo')).toEqual(['demuelo']);
    expect(cell('soldar', 'present', 'yo')).toEqual(['sueldo']);
    expect(cell('soldar', 'presentSubjunctive', 'ellos')).toEqual(['suelden']);
    expect(cell('remorder', 'present', 'yo')).toEqual(['remuerdo']);
    expect(cell('escocer', 'present', 'yo')).toEqual(['escuezo']);
    expect(cell('escocer', 'present', 'el')).toEqual(['escuece']);
    expect(cell('adherir', 'present', 'yo')).toEqual(['adhiero']);
    expect(cell('adherir', 'presentSubjunctive', 'el')).toEqual(['adhiera']);
    expect(cell('adherir', 'preterite', 'el')).toEqual(['adhirió']);
    expect(cell('adherir', 'presentProgressive', 'yo')).toEqual(['estoy adhiriendo']);
    expect(cell('ingerir', 'present', 'yo')).toEqual(['ingiero']);
    expect(cell('ingerir', 'preterite', 'el')).toEqual(['ingirió']);
    expect(cell('malentender', 'present', 'yo')).toEqual(['malentiendo']);
    expect(cell('desatender', 'present', 'yo')).toEqual(['desatiendo']);
    expect(cell('colegir', 'present', 'yo')).toEqual(['colijo']);
    expect(cell('colegir', 'present', 'el')).toEqual(['colige']);
    expect(cell('colegir', 'preterite', 'el')).toEqual(['coligió']);
    expect(cell('constreñir', 'present', 'yo')).toEqual(['constriño']);
    expect(cell('constreñir', 'present', 'el')).toEqual(['constriñe']);
    expect(cell('constreñir', 'preterite', 'el')).toEqual(['constriñó']);
    for (const inf of ['moler', 'demoler', 'soldar', 'remorder', 'escocer', 'adherir', 'ingerir', 'malentender',
      'desatender', 'colegir', 'constreñir']) {
      expect(isKnownVerb(inf), inf).toBe(true);
    }
  });

  it('accepts both stress patterns of -cuar verbs, unaccented first', () => {
    expect(cell('adecuar', 'present', 'yo')).toEqual(['adecuo', 'adecúo']);
    expect(cell('adecuar', 'present', 'el')).toEqual(['adecua', 'adecúa']);
    expect(cell('adecuar', 'presentSubjunctive', 'el')).toEqual(['adecue', 'adecúe']);
    expect(cell('adecuar', 'present', 'nosotros')).toEqual(['adecuamos']);
    expect(cell('licuar', 'present', 'yo')).toEqual(['licuo', 'licúo']);
    expect(cell('evacuar', 'present', 'yo')).toEqual(['evacuo', 'evacúo']);
    expect(cell('evacuar', 'imperativeAffirmative', 'tu')).toEqual(['evacua', 'evacúa']);
    // -guar stays unaccented only.
    expect(cell('averiguar', 'present', 'yo')).toEqual(['averiguo']);
  });

  it('stresses ú in unknown -uar verbs not after c or g', () => {
    expect(cell('consensuar', 'present', 'yo')).toEqual(['consensúo']);
    expect(cell('consensuar', 'present', 'el')).toEqual(['consensúa']);
    expect(cell('consensuar', 'presentSubjunctive', 'el')).toEqual(['consensúe']);
    expect(cell('consensuar', 'present', 'nosotros')).toEqual(['consensuamos']);
    expect(cell('conceptuar', 'present', 'yo')).toEqual(['conceptúo']);
    expect(cell('desvirtuar', 'imperativeAffirmative', 'ellos')).toEqual(['desvirtúen']);
    expect(cell('reevaluar', 'present', 'ellos')).toEqual(['reevalúan']);
    expect(cell('menstruar', 'present', 'el')).toEqual(['menstrúa']);
    expect(cell('infatuar', 'present', 'yo')).toEqual(['infatúo']);
  });

  it('has no future, conditional or imperative for soler (DPD)', () => {
    for (const tense of ['future', 'conditional'] as Tense[]) {
      for (const person of SIX) expect(cell('soler', tense, person), `${tense} ${person}`).toBeNull();
    }
    for (const tense of ['imperativeAffirmative', 'imperativeNegative'] as Tense[]) {
      for (const person of FIVE) expect(cell('soler', tense, person), `${tense} ${person}`).toBeNull();
    }
    expect(cell('soler', 'present', 'yo')).toEqual(['suelo']);
    expect(cell('soler', 'imperfect', 'el')).toEqual(['solía']);
    expect(cell('soler', 'presentSubjunctive', 'el')).toEqual(['suela']);
    expect(paradigm('soler')?.future).toEqual({});
  });

  it('has no progressive of estar or estarse ("estoy estando" is not taught as Spanish)', () => {
    for (const entry of ['estar', 'estarse']) {
      for (const person of SIX) expect(cell(entry, 'presentProgressive', person), `${entry} ${person}`).toBeNull();
    }
    expect(paradigm('estar')?.presentProgressive).toEqual({});
    // Every other tense of estar is there, and so is the progressive of the verbs next to it.
    expect(cell('estar', 'present', 'yo')).toEqual(['estoy']);
    expect(cell('estar', 'presentPerfect', 'yo')).toEqual(['he estado']);
    expect(cell('estarse', 'present', 'yo')).toEqual(['me estoy']);
    expect(cell('ser', 'presentProgressive', 'yo')).toEqual(['estoy siendo']);
    expect(cell('ir', 'presentProgressive', 'yo')).toEqual(['estoy yendo']);
  });

  it('has only third persons and no imperative for concernir', () => {
    for (const person of ['yo', 'tu', 'nosotros', 'vosotros'] as Person[]) {
      for (const t of TENSES) expect(cell('concernir', t.id, person), `${t.id} ${person}`).toBeNull();
    }
    for (const person of FIVE) {
      expect(cell('concernir', 'imperativeAffirmative', person)).toBeNull();
      expect(cell('concernir', 'imperativeNegative', person)).toBeNull();
    }
    expect(cell('concernir', 'present', 'el')).toEqual(['concierne']);
    expect(cell('concernir', 'present', 'ellos')).toEqual(['conciernen']);
    expect(cell('concernir', 'imperfect', 'el')).toEqual(['concernía']);
    expect(cell('concernir', 'presentSubjunctive', 'el')).toEqual(['concierna']);
    expect(cell('concernir', 'presentProgressive', 'el')).toEqual(['está concerniendo']);
    expect(cell('concernir', 'presentPerfect', 'ellos')).toEqual(['han concernido']);
    expect(paradigm('concernir')?.present).toEqual({ el: ['concierne'], ellos: ['conciernen'] });
  });

  it('conjugates every -eír verb like reír', () => {
    expect(cell('engreír', 'present', 'yo')).toEqual(['engrío']);
    expect(cell('engreír', 'present', 'el')).toEqual(['engríe']);
    // Two syllables: an aguda ending in a vowel, so the accent is required (like sonrió).
    expect(cell('engreír', 'preterite', 'el')).toEqual(['engrió']);
    expect(cell('engreír', 'presentSubjunctive', 'el')).toEqual(['engría']);
    expect(cell('refreír', 'present', 'yo')).toEqual(['refrío']);
    expect(cell('refreír', 'presentPerfect', 'yo')).toEqual(['he refrito', 'he refreído']);
    expect(isKnownVerb('desleír')).toBe(false);
    expect(cell('desleír', 'present', 'yo')).toEqual(['deslío']);
    expect(cell('desleír', 'present', 'el')).toEqual(['deslíe']);
    expect(cell('desleír', 'preterite', 'el')).toEqual(['deslió']);
    expect(cell('desleír', 'preterite', 'yo')).toEqual(['desleí']);
    expect(cell('desleír', 'presentSubjunctive', 'nosotros')).toEqual(['desliamos']);
    expect(cell('desleír', 'presentProgressive', 'yo')).toEqual(['estoy desliendo']);
    expect(cell('desleír', 'presentPerfect', 'yo')).toEqual(['he desleído']);
    expect(cell('desleír', 'imperativeAffirmative', 'vosotros')).toEqual(['desleíd']);
    expect(cell('desleír', 'future', 'yo')).toEqual(['desleiré']);
  });
});
