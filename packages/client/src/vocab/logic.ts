// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Vocabulómetro core logic, ported from the standalone single-file build (an earlier
// version of tools/vocabulometro-offline/vocabulometro.html).
// Pure functions only — no DOM. Statistical method documented in doc comments below.
import rawData from './datasets/vocabData.json';
import listenFormA from './datasets/listenFormA.json';

export interface VocabBand {
  label: string;
  n: number;
  mass: number;
  words: string[];
}

export interface VocabData {
  totalTokens: number;
  bands: VocabBand[];
  glosses: Record<string, string>;
  masteryDomain: string[];
  pseudo: string[];
  masteryMeta: Record<string, [string, string]>;
  glosses2: Record<string, string>;
  masteryMeta2: Record<string, [string, string]>;
  pseudoX: string[];
  blocks: { censo: number; sondeo: number; pseudoPerSondeo: number };
}

export const DATA = rawData as unknown as VocabData;

/** Fixed 52-item listening form: [word, band (-1 = pseudo), 'real'|'pseudo'] */
export const FORM_A = listenFormA as [string, number, string][];

export type VocabMode = 'size' | 'mastery' | 'listen' | 'c500' | 'a500' | 's5000' | 'listen2' | 'dictado' | 'ctest' | 'ldt' | 'ei';

export interface VocabTestSettings {
  preset?: 'rapida' | 'precision';
  bandCounts?: number[];
  npseudo?: number;
  nmast?: number;
  seed?: number | null;
  stopSE?: number | null;
  blk?: number;
  form?: 'A' | 'B';
  planCode?: string | null;
  accent?: string;
  textIds?: number[];
  ngaps?: number;
  deadlineMs?: number;
  sentenceIds?: number[];
  nsent?: number;
}

// rápida's pseudoword dose raised 15→20 in v1.1: at small n_pseudo the
// false-alarm CI dominates the size-estimate error, so these items buy the
// most precision per second of testing time.
export const PRESETS: Record<string, number[]> = {
  rapida: [10, 10, 12, 10, 8, 20],
  precision: [40, 10, 15, 15, 28, 22],
};

export const MODE_LABELS: Record<VocabMode, string> = {
  size: 'Tamaño y cobertura',
  mastery: 'Dominio · Top 500',
  listen: 'Comprensión auditiva · Forma A',
  c500: 'Censo 500 · Pasivo',
  a500: 'Activo 500 · Forma A/B',
  s5000: 'Sondeo 5.000 · Semanal',
  listen2: 'Auditiva · banco TTS',
  dictado: 'Dictado · escritura al oído',
  ctest: 'C-test · textos de clase',
  ldt: 'Decisión léxica cronometrada',
  ei: 'Imitación provocada · habla',
};

/** Modes whose stimuli come from the TTS audio bank. */
export const AURAL_BANK_MODES: VocabMode[] = ['listen2', 'dictado'];

// ---------- utilities ----------

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function sample<T>(pool: T[], k: number, rnd: () => number): T[] {
  return shuffle(pool.slice(), rnd).slice(0, k);
}

export const fmt = (x: number, d = 0): string =>
  x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export const pct = (x: number, d = 1): string => (100 * x).toFixed(d) + '%';

// Coerces first: the SVG builders are handed occasion/name strings that may be
// null or numeric. `'` is escaped too, so the output is safe inside a
// single-quoted attribute as well as in element text.
export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Input lockout after a new item is rendered. React reuses the same answer
 * buttons across items, so without it the second half of a double-click, held
 * Enter, or key auto-repeat residue answers the NEXT item too. Speeded modes
 * (ldt) are exempt: there the response window is the measurement.
 */
export const ANSWER_LOCKOUT_MS = 250;

/** True while the current item is still inside its post-render input lockout. */
export function withinLockout(t0: number, now: number): boolean {
  return t0 > 0 && now - t0 < ANSWER_LOCKOUT_MS; // t0===0 is the "no item shown yet" sentinel
}

// ---------- items ----------

export interface YnItem { w: string; b: number; t: 'real' | 'pseudo'; clip?: number }
export interface McItem { w: string; b: number; t: 'mc'; opts: string[]; correct: string }
export type SimpleItem = YnItem | McItem;

/** `plays` is recorded on aural rows only: it qualifies the judgement (heard once vs. twice). */
export interface YnResponse { w: string; b: number; t: string; yes: boolean; ms: number; timedOut?: boolean; plays?: number }
export interface McResponse { w: string; b: number; t: 'mc'; pick: number; correct: boolean; omit: boolean; ms: number }

/**
 * Sample k words from pool, preferring words NOT in `exclude` (already seen in
 * a prior administration); tops up from seen words only when the fresh pool
 * runs short. Keeps repeat tests measuring vocabulary, not item memory.
 */
function sampleFresh(pool: string[], k: number, rnd: () => number, exclude?: Set<string>): string[] {
  if (!exclude || exclude.size === 0) return sample(pool, k, rnd);
  const fresh = pool.filter((w) => !exclude.has(w));
  const picked = sample(fresh, k, rnd);
  if (picked.length < k) {
    const seenPool = pool.filter((w) => exclude.has(w));
    picked.push(...sample(seenPool, k - picked.length, rnd));
  }
  return picked;
}

/** Sí/No size test: stratified band sample + jitter-placed pseudowords for false-alarm calibration. */
export function buildSizeItems(settings: VocabTestSettings, rnd: () => number, exclude?: Set<string>): YnItem[] {
  const counts = settings.bandCounts ?? PRESETS[settings.preset ?? 'rapida'].slice(0, 5);
  const npseudo = settings.npseudo ?? PRESETS[settings.preset ?? 'rapida'][5];
  const ns = [0, 1, 2, 3, 4].map((i) => Math.min(counts[i] ?? 0, DATA.bands[i].words.length));
  const real: YnItem[] = [];
  ns.forEach((k, b) => sampleFresh(DATA.bands[b].words, k, rnd, exclude).forEach((w) => real.push({ w, b, t: 'real' })));
  shuffle(real, rnd);
  // jittered systematic placement: pseudowords spread evenly through the test,
  // so the false-alarm calibration samples early, middle, and late responding alike
  // Pseudowords are sampled WITHOUT seen-word exclusion: the pool is only 48
  // strong, so exclusion would deplete it within ~3 administrations and force
  // systematically repeated (practice-affected) pseudo items — worse for the
  // false-alarm calibration than ordinary re-exposure.
  const ps: YnItem[] = sample(DATA.pseudo, Math.min(npseudo, DATA.pseudo.length), rnd)
    .map((w) => ({ w, b: -1, t: 'pseudo' }));
  const T = real.length + ps.length, step = T / ps.length;
  const slots = [...new Set(ps.map((_, j) => Math.min(T - 1, Math.floor(j * step + rnd() * step))))];
  while (slots.length < ps.length) {
    const s = Math.floor(rnd() * T);
    if (!slots.includes(s)) slots.push(s);
  }
  slots.sort((a, b) => a - b);
  const items: YnItem[] = [];
  let ri = 0, pi = 0;
  for (let k = 0; k < T; k++) items.push(slots.includes(k) ? ps[pi++] : real[ri++]);
  return items;
}

/** Top-500 mastery MC: same-class distractors, distinct concepts, block-randomized key positions. */
export function buildMasteryItems(settings: VocabTestSettings, rnd: () => number): McItem[] {
  const k = Math.min(settings.nmast ?? 50, DATA.masteryDomain.length);
  const posSeq: number[] = [];
  while (posSeq.length < k) posSeq.push(...shuffle([0, 1, 2, 3], rnd));
  const items: McItem[] = [];
  sample(DATA.masteryDomain, k, rnd).forEach((w, idx) => {
    const correct = DATA.glosses[w];
    const [bkt, con] = DATA.masteryMeta[w];
    let pool = shuffle(
      DATA.masteryDomain.filter((x) =>
        x !== w && DATA.masteryMeta[x][0] === bkt && DATA.masteryMeta[x][1] !== con && DATA.glosses[x] !== correct),
      rnd
    );
    const ds: string[] = [];
    const used = new Set([con]);
    for (const d of pool) {
      const [, dc] = DATA.masteryMeta[d];
      const g = DATA.glosses[d];
      if (!used.has(dc) && !ds.includes(g)) { ds.push(g); used.add(dc); if (ds.length === 3) break; }
    }
    if (ds.length < 3) { // fallback: widen beyond the bucket, concepts still distinct
      pool = shuffle(DATA.masteryDomain.filter((x) => x !== w && DATA.glosses[x] !== correct), rnd);
      for (const d of pool) {
        const [, dc] = DATA.masteryMeta[d];
        const g = DATA.glosses[d];
        if (!used.has(dc) && !ds.includes(g)) { ds.push(g); used.add(dc); if (ds.length === 3) break; }
      }
    }
    const opts = new Array<string>(4), rest = shuffle(ds, rnd);
    let ri = 0;
    for (let p = 0; p < 4; p++) opts[p] = p === posSeq[idx] ? correct : rest[ri++];
    items.push({ w, b: 0, t: 'mc', opts, correct });
  });
  return items;
}

export function buildListenItems(): YnItem[] {
  return FORM_A.map(([w, b, t], i) => ({ w, b, t: t as 'real' | 'pseudo', clip: i }));
}

/**
 * Aural Sí/No over the TTS bank: identical design to the written size test
 * (stratified band sample + jitter-placed pseudowords) but restricted to
 * words with a ready audio clip. Requested counts shrink to what the bank
 * can supply per band.
 */
/** A band only enters the aural sample when nearly all of it has audio —
 * sampling a hand-shaped subset while extrapolating to the full band would
 * bias the estimate. At ≥90% coverage the missing words are TTS failures,
 * which are as-good-as-random. */
export const LISTEN2_BAND_COVERAGE_MIN = 0.9;
/** Below this many pseudo clips the false-alarm correction is meaningless. */
export const LISTEN2_PSEUDO_MIN = 8;

export interface AuralBankReadiness {
  pseudoReady: number;
  coveredBands: number[];
  bandWordsReady: number;
}

/** How much of the dataset the ready audio bank can serve. */
export function auralBankReadiness(audioWords: string[]): AuralBankReadiness {
  const audio = new Set(audioWords);
  const coveredBands: number[] = [];
  let bandWordsReady = 0;
  DATA.bands.forEach((band, b) => {
    const ready = band.words.filter((w) => audio.has(w)).length;
    bandWordsReady += ready;
    if (ready / band.words.length >= LISTEN2_BAND_COVERAGE_MIN) coveredBands.push(b);
  });
  return {
    pseudoReady: DATA.pseudo.filter((w) => audio.has(w)).length,
    coveredBands,
    bandWordsReady,
  };
}

export function buildListen2Items(
  settings: VocabTestSettings,
  rnd: () => number,
  audio: Set<string>,
  exclude?: Set<string>
): YnItem[] {
  const counts = settings.bandCounts ?? PRESETS[settings.preset ?? 'rapida'].slice(0, 5);
  const npseudo = settings.npseudo ?? PRESETS[settings.preset ?? 'rapida'][5];
  const real: YnItem[] = [];
  [0, 1, 2, 3, 4].forEach((b) => {
    const pool = DATA.bands[b].words.filter((w) => audio.has(w));
    // Coverage gate: skip bands the bank cannot represent fairly (the results
    // table simply shows no row for unmeasured bands).
    if (pool.length / DATA.bands[b].words.length < LISTEN2_BAND_COVERAGE_MIN) return;
    const k = Math.min(counts[b] ?? 0, pool.length);
    if (k > 0) sampleFresh(pool, k, rnd, exclude).forEach((w) => real.push({ w, b, t: 'real' }));
  });
  shuffle(real, rnd);
  const pseudoPool = DATA.pseudo.filter((w) => audio.has(w));
  // Without a usable pseudoword dose the FA correction (and its variance term)
  // silently vanishes and the test becomes uncorrected self-report — refuse.
  if (pseudoPool.length < LISTEN2_PSEUDO_MIN) return [];
  const ps: YnItem[] = sample(pseudoPool, Math.min(npseudo, pseudoPool.length), rnd)
    .map((w) => ({ w, b: -1, t: 'pseudo' }));
  if (real.length === 0) return [];
  if (ps.length === 0) return real;
  const T = real.length + ps.length, step = T / ps.length;
  const slots = [...new Set(ps.map((_, j) => Math.min(T - 1, Math.floor(j * step + rnd() * step))))];
  while (slots.length < ps.length) {
    const s = Math.floor(rnd() * T);
    if (!slots.includes(s)) slots.push(s);
  }
  slots.sort((a, b) => a - b);
  const items: YnItem[] = [];
  let ri = 0, pi = 0;
  for (let k = 0; k < T; k++) items.push(slots.includes(k) ? ps[pi++] : real[ri++]);
  return items;
}

export interface DictadoItem { w: string; b: number; t: 'dict' }
export interface DictadoResponse { w: string; b: number; t: 'dict'; typed: string; ok: boolean; ms: number; plays?: number }

const DICTADO_DEFAULT_COUNTS = [6, 5, 4, 3, 2];

/** Dictation: hear a word from the TTS bank, type it. Real words only. */
export function buildDictadoItems(
  settings: VocabTestSettings,
  rnd: () => number,
  audio: Set<string>
): DictadoItem[] {
  const counts = settings.bandCounts ?? DICTADO_DEFAULT_COUNTS;
  const items: DictadoItem[] = [];
  [0, 1, 2, 3, 4].forEach((b) => {
    const pool = DATA.bands[b].words.filter((w) => audio.has(w));
    const k = Math.min(counts[b] ?? 0, pool.length);
    if (k > 0) sample(pool, k, rnd).forEach((w) => items.push({ w, b, t: 'dict' }));
  });
  return shuffle(items, rnd);
}

/** Accent-insensitive transcription check (ñ is preserved — see norm). */
export function acceptDictado(input: string, w: string): boolean {
  const t = norm(input);
  return t.length > 0 && t === norm(w);
}

// ---------- estimators ----------

export interface BandRow { band: string; n: number; h: number; k: number; N: number; M: number }
export interface YnEstimate {
  f: number; pseudoN: number; rows: BandRow[];
  size: number; seSize: number; cov: number; seCov: number;
  domainN: number; domainMass: number;
}

/**
 * Overclaiming-corrected size/coverage from band counts.
 * k̂ = (h − f)/(1 − f); size = Σ Nᵦk̂ᵦ, coverage = Σ Mᵦk̂ᵦ.
 * Variances use Agresti–Coull-stabilized band terms plus the shared
 * false-alarm term [Σwᵦ(1−hᵦ)]²·Var(f̂)/(1−f̂)⁴ (correlated across bands).
 */
export function estFromCounts(bandCounts: [number, number][], psCounts: [number, number]): YnEstimate {
  const [psN, fa] = psCounts;
  const f = psN ? fa / psN : 0;
  const ft = psN ? (fa + 2) / (psN + 4) : 0.5; // Agresti–Coull shrinkage for variance only
  const vf = psN ? ft * (1 - ft) / psN : 0;
  const rows: BandRow[] = [];
  let size = 0, cov = 0, vSize = 0, vCov = 0, sumN1h = 0, sumM1h = 0, domainN = 0, domainMass = 0;
  bandCounts.forEach(([n, y], b) => {
    if (!n) return;
    const h = y / n, ht = (y + 2) / (n + 4), vh = ht * (1 - ht) / n; // stabilized: never collapses at h=0 or 1
    const k = f >= 1 ? 0 : Math.min(1, Math.max(0, (h - f) / (1 - f)));
    const N = DATA.bands[b].n, M = DATA.bands[b].mass;
    size += N * k; cov += M * k; vSize += N * N * vh; vCov += M * M * vh;
    sumN1h += N * (1 - h); sumM1h += M * (1 - h);
    domainN += N; domainMass += M;
    rows.push({ band: DATA.bands[b].label, n, h, k, N, M });
  });
  const g2 = Math.pow(1 - Math.min(f, 0.95), 2), g4 = g2 * g2;
  const varSize = vSize / g2 + sumN1h * sumN1h * vf / g4; // shared-f error is correlated across bands: squared sum
  const varCov = vCov / g2 + sumM1h * sumM1h * vf / g4;
  return {
    f, pseudoN: psN, rows, size, seSize: Math.sqrt(varSize),
    cov, seCov: Math.sqrt(varCov), domainN, domainMass,
  };
}

export interface YnCounts { bands: [number, number][]; ps: [number, number] }

export function ynCounts(resp: YnResponse[]): YnCounts {
  const bands = [0, 1, 2, 3, 4].map((b) => {
    const rs = resp.filter((r) => r.b === b);
    return [rs.length, rs.filter((r) => r.yes).length] as [number, number];
  });
  const ps = resp.filter((r) => r.t === 'pseudo');
  return { bands, ps: [ps.length, ps.filter((r) => r.yes).length] };
}

export function ynEstimates(resp: YnResponse[]): YnEstimate {
  const c = ynCounts(resp);
  return estFromCounts(c.bands, c.ps);
}

/** Responses a band needs before the adaptive stop may consider it measured. */
export const STOP_MIN_PER_BAND = 4;

/**
 * True when every band the form actually sampled has enough responses to be
 * estimated. The adaptive stop must not fire while a whole band is unanswered:
 * estFromCounts skips empty bands entirely, so size/CI/CEFR would be computed
 * over a silently truncated domain and reported as if the full 0–5.000 ladder
 * had been measured. Bands with no items in the form at all are ignored (a
 * 3-band form is a deliberate configuration, not a gap).
 */
export function bandsCovered(items: { b: number }[], resp: { b: number }[]): boolean {
  for (let b = 0; b < 5; b++) {
    const N = items.filter((x) => x.b === b).length;
    if (N === 0) continue;
    if (resp.filter((r) => r.b === b).length < Math.min(STOP_MIN_PER_BAND, N)) return false;
  }
  return true;
}

export function wilson(p: number, n: number): [number, number] {
  const z = 1.96;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

// ---------- CEFR (lexical proxy, X_Lex bands: Milton & Alexiou 2009, Romance data) ----------

export interface CefrBand { l: string; lo: number; hi: number; d: string }

export const CEFR: CefrBand[] = [
  { l: 'A1', lo: 0, hi: 1000, d: 'Léxico de supervivencia: frases muy frecuentes y ensayadas sobre uno mismo y necesidades inmediatas.' },
  { l: 'A2', lo: 1000, hi: 2000, d: 'Lenguaje transaccional cotidiano; sigue habla lenta y clara sobre temas familiares.' },
  { l: 'B1', lo: 2000, hi: 3000, d: 'Umbral independiente: capta las ideas principales de asuntos cotidianos con apoyo del contexto.' },
  { l: 'B2', lo: 3000, hi: 3500, d: 'Sigue discurso extendido y medios generalistas sobre temas concretos y abstractos; lee con autonomía.' },
  { l: 'C1', lo: 3500, hi: 4500, d: 'Rango léxico amplio, incluidas piezas poco frecuentes e idiomáticas; entiende textos exigentes e implícitos.' },
  { l: 'C2', lo: 4500, hi: 5000, d: 'Cobertura léxica casi nativa; matices finos de significado.' },
];

export const levelOf = (s: number): CefrBand => {
  const i = CEFR.findIndex((b) => s < b.hi);
  return CEFR[i < 0 ? CEFR.length - 1 : i];
};

export interface CefrEstimate { pt: CefrBand; range: string | null; lo: number; hi: number; size: number }

export function cefrEstimate(size: number, se: number): CefrEstimate {
  const clamp = (x: number) => Math.max(0, Math.min(5000, x));
  const pt = levelOf(clamp(size)), lo = levelOf(clamp(size - 1.96 * se)), hi = levelOf(clamp(size + 1.96 * se));
  return {
    pt,
    range: lo.l === hi.l ? null : lo.l + '–' + hi.l,
    lo: clamp(size - 1.96 * se),
    hi: clamp(size + 1.96 * se),
    size: clamp(size),
  };
}

// ---------- year-engine (censo / activo / sondeo) ----------

export const ALLWORDS: string[] = ([] as string[]).concat(...DATA.bands.map((b) => b.words));
export const BANDOFF: number[] = (() => {
  const o = [0];
  DATA.bands.forEach((b) => o.push(o[o.length - 1] + b.words.length));
  return o;
})();
export const bandOfIdx = (i: number): number => {
  for (let b = 4; b >= 0; b--) if (i >= BANDOFF[b]) return b;
  return 0;
};
export const glossOf = (w: string): string => DATA.glosses[w] || DATA.glosses2[w];
export const metaOf = (w: string): [string, string] => DATA.masteryMeta[w] || DATA.masteryMeta2[w];
// Accent-insensitive fold that PRESERVES \u00f1: NFD decomposes \u00f1 into n + U+0303,
// so the tilde is recomposed before the combining-mark strip. Restoring it
// afterwards is what keeps norm('a\u00f1o') !== norm('ano') \u2014 \u00f1 is a distinct letter
// in Spanish, not an accented n, and folding it made acceptActive treat "ano"
// as a correct production of "a\u00f1o".
export const norm = (s: string): string =>
  s.toLowerCase().trim().normalize('NFD').replace(/n\u0303/g, '\u00f1').replace(/[\u0300-\u036f]/g, '');

// word states: 0 unknown · 1 claimed (sí, unverified) · 2 verified passive · 3 productive

export interface McPair { opts: string[]; correct: string }

export function mcFor(w: string, domain: string[], rnd: () => number): McPair {
  const correct = glossOf(w), [bkt, con] = metaOf(w);
  const pool = shuffle(
    domain.filter((x) => x !== w && metaOf(x)[0] === bkt && metaOf(x)[1] !== con && glossOf(x) !== correct),
    rnd
  );
  const ds: string[] = [];
  const used = new Set([con]);
  for (const d of pool) {
    const dc = metaOf(d)[1], g = glossOf(d);
    if (!used.has(dc) && !ds.includes(g)) { ds.push(g); used.add(dc); if (ds.length === 3) break; }
  }
  while (ds.length < 3) {
    const d = domain[Math.floor(rnd() * domain.length)];
    const g = glossOf(d);
    if (g !== correct && !ds.includes(g)) ds.push(g);
  }
  const opts = new Array<string>(4), pos = Math.floor(rnd() * 4), rest = shuffle(ds, rnd);
  let ri = 0;
  for (let p = 0; p < 4; p++) opts[p] = p === pos ? correct : rest[ri++];
  return { opts, correct };
}

export function cueOf(w: string): string {
  return w[0] + ' ' + '_ '.repeat(w.length - 1).trim();
}

export function acceptActive(input: string, w: string): boolean {
  const t = norm(input);
  if (!t) return false;
  if (t === norm(w)) return true;
  // same-gloss homograph matching the cue (first letter + length)
  return DATA.bands[0].words.some((x) =>
    x !== w && glossOf(x) === glossOf(w) && x[0] === w[0] && x.length === w.length && t === norm(x));
}

export interface ProtocolItem {
  w: string;
  idx?: number;
  ph: 'screen' | 'mc' | 'typed';
  verify?: boolean;
  pseudo?: boolean;
  mc?: McPair;
  fromYes?: boolean;
  fromNo?: boolean;
  retest?: boolean;
}

export interface AdaptivePlan { v: 3; words: number[]; np?: number; poff?: number }

/** Max words an adaptive plan may schedule (buildPlan emits 60). */
export const PLAN_MAX_WORDS = 400;

const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/**
 * Decode a `VNHS1.` adaptive-plan code, validating every field the queue
 * builder will act on. The code is pasted in by hand (teacher panel → test
 * settings), so it is untrusted text: a plan with non-integer or out-of-range
 * word indices must be rejected outright rather than silently producing a
 * short, mis-banded, or empty sondeo.
 */
export function parsePlanCode(line: string): AdaptivePlan | null {
  line = String(line ?? '').trim();
  if (!line.startsWith('VNHS1.')) return null;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(line.slice(6)))));
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    if (p.v !== 3 || !Array.isArray(p.words)) return null;
    if (p.words.length > PLAN_MAX_WORDS) return null;
    for (const i of p.words) if (!isInt(i, 0, ALLWORDS.length - 1)) return null;
    if (p.np != null && !isInt(p.np, 0, 10000)) return null;
    if (p.poff != null && !isInt(p.poff, 0, 10 ** 9)) return null;
    return p as AdaptivePlan;
  } catch {
    return null;
  }
}

export interface ProtocolStart { queue: ProtocolItem[]; blk: number | 'P'; form: string }

/** Build the initial queue for censo/activo/sondeo, mirroring startProtocol() in the original. */
export function buildProtocolQueue(mode: VocabMode, settings: VocabTestSettings, rnd: () => number): ProtocolStart {
  let queue: ProtocolItem[] = [];
  let blk: number | 'P' = 1, form = '';
  // Every block/week selector is rounded before it is used: the slices are
  // `i % period === blk - 1`, so a fractional 2.5 would match nothing and hand
  // the student an empty test.
  if (mode === 'c500') {
    blk = Math.min(10, Math.max(1, Math.round(settings.blk ?? 1) || 1));
    const b = blk;
    const ws = DATA.bands[0].words.filter((_, i) => i % 10 === b - 1);
    queue = ws.map((w) => ({ w, idx: ALLWORDS.indexOf(w), ph: 'screen' as const, verify: true }));
    DATA.pseudoX.slice(600).filter((_, i) => i % 10 === b - 1).forEach((w) => queue.push({ w, ph: 'screen', pseudo: true }));
    queue = shuffle(queue, rnd);
  } else if (mode === 'a500') {
    form = settings.form ?? 'A';
    blk = Math.min(5, Math.max(1, Math.round(settings.blk ?? 1) || 1));
    const b = blk;
    const half = DATA.bands[0].words.filter((_, i) => i % 2 === (form === 'A' ? 0 : 1));
    queue = half.filter((_, i) => i % 5 === b - 1).map((w) => ({ w, idx: ALLWORDS.indexOf(w), ph: 'typed' as const }));
    // a500 too: unshuffled it runs in strict corpus-frequency order, so the
    // hardest items always land under the most fatigue.
    queue = shuffle(queue, rnd);
  } else { // s5000 — weekly slice, or adaptive plan if a plan code is configured
    const plan = settings.planCode ? parsePlanCode(settings.planCode) : null;
    if (plan) {
      blk = 'P';
      for (const i of plan.words) {
        const w = ALLWORDS[i];
        if (!w) continue;
        const b = bandOfIdx(i);
        queue.push(b < 2 ? { w, idx: i, ph: 'screen', verify: true } : { w, idx: i, ph: 'screen' });
      }
      const np = Math.min(30, Math.max(0, plan.np ?? 12)), off = (plan.poff ?? 0) % 660;
      for (let j = 0; j < np; j++) queue.push({ w: DATA.pseudoX[(off + j) % 660], ph: 'screen', pseudo: true });
      queue = shuffle(queue, rnd);
      return { queue, blk, form };
    }
    blk = Math.min(30, Math.max(1, Math.round(settings.blk ?? 1) || 1));
    const b = blk;
    DATA.bands[1].words.filter((_, i) => i % 30 === b - 1)
      .forEach((w) => queue.push({ w, idx: ALLWORDS.indexOf(w), ph: 'screen', verify: true }));
    for (const bandIdx of [2, 3, 4]) {
      DATA.bands[bandIdx].words.filter((_, i) => i % 30 === b - 1)
        .forEach((w) => queue.push({ w, idx: ALLWORDS.indexOf(w), ph: 'screen' }));
    }
    DATA.pseudoX.slice(0, 600).filter((_, i) => i % 30 === b - 1).forEach((w) => queue.push({ w, ph: 'screen', pseudo: true }));
    queue = shuffle(queue, rnd);
  }
  return { queue, blk, form };
}

// ---------- summaries (server payloads) ----------

export interface SummaryV1Yn { v: 1; yn: YnCounts }
export interface SummaryV1Mc { v: 1; mc: { n: number; c: number; w: number; o: number } }
export interface SummaryV2 { v: 2; res: [number, number][]; ps: [number, number] }
export type VocabSummary = SummaryV1Yn | SummaryV1Mc | SummaryV2 | SummaryCt | SummaryEi;

export function summaryFromYn(resp: YnResponse[]): SummaryV1Yn {
  return { v: 1, yn: ynCounts(resp) };
}

export function summaryFromMc(resp: McResponse[]): SummaryV1Mc {
  const n = resp.length, c = resp.filter((r) => r.correct).length, o = resp.filter((r) => r.omit).length;
  return { v: 1, mc: { n, c, w: n - c - o, o } };
}

export function summaryFromProtocol(state: Record<number, number>, ps: [number, number]): SummaryV2 {
  return { v: 2, res: Object.entries(state).map(([i, s]) => [+i, s] as [number, number]), ps };
}

// ---------- C-test (general proficiency from class texts) ----------

export interface CtestGap {
  /** token index in the passage token list */
  idx: number;
  word: string;      // full original word
  stem: string;      // visible first half
  gapLen: number;    // number of deleted characters
}

export interface CtestPassage {
  title: string;
  tokens: string[];        // words and separators, concatenable to the original
  gaps: CtestGap[];        // ordered by idx
}

const WORD_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/;

/**
 * Standard C-test construction: leave the first sentence intact, then delete
 * the second half (rounding up) of every 2nd eligible word (length ≥ 4),
 * up to ngaps gaps. Deterministic — no randomness, so every student gets the
 * identical form for a given text.
 */
export function buildCtestPassage(title: string, content: string, ngaps: number): CtestPassage {
  const tokens = content.trim().split(/(\s+)/);
  // Standard C-test leaves the first sentence intact. Find where it ends
  // (first sentence-final punctuation). If the passage has no such
  // punctuation, fall back to keeping the first ~8 word-tokens intact so a
  // punctuation-poor text still yields gaps instead of none.
  let startToken = -1;
  let wordSeen = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (/[.!?…]/.test(tokens[i])) { startToken = i; break; } // first sentence end wins
    if (WORD_RE.test(tokens[i])) wordSeen++;
    if (startToken < 0 && wordSeen >= 8) startToken = i; // tentative fallback, set once
  }
  const gaps: CtestGap[] = [];
  let eligibleCount = 0;
  for (let i = startToken + 1; i < tokens.length && gaps.length < ngaps; i++) {
    const token = tokens[i];
    const m = token.match(WORD_RE);
    if (!m || m[0].length < 4) continue;
    eligibleCount++;
    if (eligibleCount % 2 !== 0) continue; // every 2nd eligible word
    const word = m[0];
    const keep = Math.floor(word.length / 2);
    gaps.push({ idx: i, word, stem: word.slice(0, keep), gapLen: word.length - keep });
  }
  return { title, tokens, gaps };
}

/**
 * Distribute a global gap budget across passages: the sum of gaps is capped at
 * ngaps (no per-text floor inflating the total), longer texts absorb the
 * remainder. Deterministic — every student gets the identical form.
 */
export function buildCtestForm(
  texts: { title: string; content: string }[],
  ngaps: number
): CtestPassage[] {
  if (texts.length === 0) return [];
  const passages: CtestPassage[] = [];
  let remaining = ngaps;
  texts.forEach((t, idx) => {
    const textsLeft = texts.length - idx;
    const budget = Math.max(0, Math.ceil(remaining / textsLeft));
    const passage = buildCtestPassage(t.title, t.content, budget);
    passages.push(passage);
    remaining -= passage.gaps.length;
  });
  return passages;
}

/** Exact restoration check (case-insensitive; accents must match). */
export function ctestExact(input: string, gap: CtestGap): boolean {
  const t = input.trim().toLowerCase();
  const target = gap.word.toLowerCase();
  // accept either the completion (stem + rest) or the full word retyped
  return (gap.stem.toLowerCase() + t) === target || t === target;
}

/** Accent-lenient restoration check. */
export function ctestLenient(input: string, gap: CtestGap): boolean {
  const t = input.trim();
  return norm(gap.stem + t) === norm(gap.word) || norm(t) === norm(gap.word);
}

export interface SummaryCt { v: 1; ct: { n: number; c: number; cl: number } }
export interface SummaryEi { v: 1; ei: { n: number; sum: number } }

export function summaryFromCtest(entries: { exact: boolean; lenient: boolean }[]): SummaryCt {
  return {
    v: 1,
    ct: {
      n: entries.length,
      c: entries.filter((e) => e.exact).length,
      cl: entries.filter((e) => e.lenient).length,
    },
  };
}

// ---------- speeded lexical decision ----------

export const LDT_DEFAULT_DEADLINE_MS = 2500;

export interface LdtRt { med: number | null; timeouts: number }

/**
 * Speeded Sí/No summary: band counts over ANSWERED items only (timeouts are
 * recorded separately, not scored as "no" — a slow-but-known word is not an
 * error), plus the median RT of correct-context yeses as the automaticity
 * index.
 */
/** RTs below this are anticipations/mis-taps, not genuine lexical access. */
export const LDT_ANTICIPATION_FLOOR_MS = 200;

export function summaryFromLdt(resp: YnResponse[]): SummaryV1Yn & { rt: LdtRt } {
  // Timeouts are recorded as "no" (not recognized within the deadline) so they
  // are NOT censored out of the band counts — excluding them would bias the
  // hit rate upward (careful students time out on hard items). ynCounts already
  // treats yes=false as "no", and timeout rows are stored with yes=false.
  const yn = ynCounts(resp);
  const timeouts = resp.filter((r) => r.timedOut).length;
  const yesRts = resp
    .filter((r) => r.yes && !r.timedOut && r.t === 'real' && r.b <= 1 && r.ms >= LDT_ANTICIPATION_FLOOR_MS)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const med = yesRts.length ? yesRts[Math.floor(yesRts.length / 2)] : null;
  return { v: 1, yn, rt: { med, timeouts } };
}

/**
 * Dictation summary: band counts where "yes" = correctly transcribed. With
 * ps=[0,0] the estimators run with f=0 (k̂=h) — no overclaiming is possible
 * because the score is verified, not self-reported.
 */
export function summaryFromDictado(resp: DictadoResponse[]): SummaryV1Yn {
  const bands = [0, 1, 2, 3, 4].map((b) => {
    const rs = resp.filter((r) => r.b === b);
    return [rs.length, rs.filter((r) => r.ok).length] as [number, number];
  });
  return { v: 1, yn: { bands, ps: [0, 0] } };
}

// ---------- teacher analytics (ported dashboard estimators) ----------

/** two-sided 95% t critical value */
export function tcrit(df: number): number {
  const T = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09];
  return df < 1 ? 1.96 : (df <= 20 ? T[df - 1] : (df <= 30 ? 2.04 : 1.96));
}

export interface DashRecord {
  userId: number;
  name: string;
  date: string; // ISO date (yyyy-mm-dd)
  occ: string;
  mode: string;
  summary: VocabSummary;
  blk?: string | null;
  form?: string | null;
}

export const isV2 = (s: VocabSummary): s is SummaryV2 => s.v === 2;

export interface LedgerEntry {
  userId: number;
  name: string;
  pas: Record<number, number>;
  act: Record<number, number>;
  pasDate: Record<number, string>;
  actDate: Record<number, string>;
  ps: [number, number];
  events: { date: string; mode: string; blk?: string | null; n: number }[];
}

/** per student: cumulative word states + pseudo counts (latest state per word by date) */
export function ledger(records: DashRecord[]): Record<number, LedgerEntry> {
  const L: Record<number, LedgerEntry> = {};
  for (const r of records) {
    if (!isV2(r.summary)) continue;
    const st = (L[r.userId] = L[r.userId] || {
      userId: r.userId, name: r.name, pas: {}, act: {}, pasDate: {}, actDate: {}, ps: [0, 0] as [number, number], events: [],
    });
    st.ps[0] += r.summary.ps[0];
    st.ps[1] += r.summary.ps[1];
    // A strictly later date wins outright (downgrades included: a retest that
    // shows the word is gone is real information). Records from the SAME date
    // keep the maximum instead of letting arrival order decide — a sondeo that
    // only screened a word must not demote a censo that verified it that day.
    for (const [i, s] of r.summary.res) {
      if (r.mode === 'a500') {
        if (!(i in st.act) || r.date > st.actDate[i]) { st.act[i] = s; st.actDate[i] = r.date; }
        else if (r.date === st.actDate[i]) st.act[i] = Math.max(st.act[i], s);
      } else {
        if (!(i in st.pas) || r.date > st.pasDate[i]) { st.pas[i] = s; st.pasDate[i] = r.date; }
        else if (r.date === st.pasDate[i]) st.pas[i] = Math.max(st.pas[i], s);
      }
    }
    st.events.push({ date: r.date, mode: r.mode, blk: r.blk, n: r.summary.res.length });
  }
  return L;
}

export interface RunningEstimate { size: number; se: number; f: number; psN: number; cens: number }

/**
 * verified bands 1-2 + screened 3-5 with cumulative false-alarm rate.
 *
 * The census counts a FINITE population: the n words already tested in a band
 * are known, only the remaining N−n are predicted. The prediction variance of
 * the band total is therefore N(N−n)·p̂(1−p̂)/n, not (N−n)²·p̂(1−p̂)/n — the
 * latter drops the finite-population factor N/(N−n) and understates the CI
 * (badly early on, when n is a handful of words out of 2,000). Mirrors
 * estFromCounts: f is clamped at 0.95 before it divides, so a student who says
 * "sí" to every pseudoword yields a wide interval instead of Infinity/NaN.
 */
export function runningEstimate(st: LedgerEntry): RunningEstimate {
  const f = st.ps[0] ? st.ps[1] / st.ps[0] : 0.10;
  const ft = st.ps[0] ? (st.ps[1] + 2) / (st.ps[0] + 4) : 0.5, vf = st.ps[0] ? ft * (1 - ft) / st.ps[0] : 0.01;
  const g2 = Math.pow(1 - Math.min(f, 0.95), 2); // clamped: f=1 would blow the correction up to Infinity
  let size = 0, varS = 0, sumN1h = 0, testedTot = 0;
  for (let b = 0; b < 5; b++) {
    const N = DATA.bands[b].n, lo = BANDOFF[b], hi = BANDOFF[b + 1];
    let n = 0, pos = 0;
    for (let i = lo; i < hi; i++) if (i in st.pas) { n++; if (b < 2 ? st.pas[i] >= 2 : st.pas[i] >= 1) pos++; }
    testedTot += n;
    if (!n) continue; // untested band contributes nothing yet (its mass is reported via `cens`)
    const h = pos / n, ht = (pos + 2) / (n + 4);
    if (b < 2) { // verified classification: no f-term, sampling only
      size += N * h;
      varS += N * (N - n) * ht * (1 - ht) / n;
    } else {
      const k = f >= 1 ? 0 : Math.min(1, Math.max(0, (h - f) / (1 - f)));
      size += N * k;
      varS += N * (N - n) * ht * (1 - ht) / n / g2;
      sumN1h += N * (1 - h);
    }
  }
  varS += sumN1h * sumN1h * vf / (g2 * g2);
  const cens = testedTot / ALLWORDS.length;
  return { size, se: Math.sqrt(varS), f, psN: st.ps[0], cens };
}

export interface RecordEstimate {
  mast?: number; seM?: number;
  cov?: number; size?: number; seC?: number; seS?: number; f?: number;
  ctExact?: number; ctLenient?: number; ctN?: number;
  rtMed?: number | null; timeouts?: number;
  eiMean?: number; eiN?: number;
}

export function estRecord(summary: VocabSummary): RecordEstimate {
  if (summary.v === 1 && 'mc' in summary) {
    // UNCLAMPED: a negative guessing-corrected score is a legitimate draw, and
    // clamping each student before averaging biases the class occasion mean
    // upward. Single-student displays clamp at render time instead.
    const { n, c, w } = summary.mc;
    const qt = (c + 2) / (n + 4);
    return { mast: (c - w / 3) / n, seM: (4 / 3) * Math.sqrt(qt * (1 - qt) / n) };
  }
  if (summary.v === 1 && 'ct' in summary) {
    const { n, c, cl } = summary.ct;
    return { ctExact: n ? c / n : 0, ctLenient: n ? cl / n : 0, ctN: n };
  }
  if (summary.v === 1 && 'ei' in summary) {
    const { n, sum } = summary.ei;
    return { eiMean: n ? sum / n : 0, eiN: n };
  }
  if (summary.v === 1 && 'yn' in summary) {
    const E = estFromCounts(summary.yn.bands, summary.yn.ps);
    const rt = (summary as SummaryV1Yn & { rt?: LdtRt }).rt;
    return { cov: E.cov, size: E.size, seC: E.seCov, seS: E.seSize, f: E.f, rtMed: rt?.med ?? undefined, timeouts: rt?.timeouts };
  }
  return {};
}

export interface MeanSE { m: number; se: number; n: number }

/** class mean: observed dispersion; single record: its measurement SE */
export function meanSE(vals: number[], fallbackSE: number[]): MeanSE {
  const n = vals.length, m = vals.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { m, se: fallbackSE[0] || 0, n };
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) * (v - m), 0) / (n - 1));
  return { m, se: sd / Math.sqrt(n), n };
}

/**
 * Adaptive sondeo plan for one student: previously-unknown words nearest the
 * knowledge frontier plus a pseudo dose sized so the f-term alone allows SE ≤ 35.
 */
export function buildPlan(st: LedgerEntry): string {
  // frontier: rank where running k crosses 0.5 (piecewise from band estimates)
  const f = st.ps[0] ? st.ps[1] / st.ps[0] : 0.10;
  const mids = [250, 750, 1500, 2500, 4000];
  let frontier = 5000;
  for (let b = 0; b < 5; b++) {
    const lo = BANDOFF[b], hi = BANDOFF[b + 1];
    let n = 0, pos = 0;
    for (let i = lo; i < hi; i++) if (i in st.pas) { n++; if (b < 2 ? st.pas[i] >= 2 : st.pas[i] >= 1) pos++; }
    if (!n) continue;
    // f>=1 would make (h−f)/(1−f) divide by zero and hand the frontier search a
    // NaN, which compares false against 0.5 and silently pins the frontier at 5000
    const h = pos / n, k = b < 2 ? h : (f >= 1 ? 0 : Math.min(1, Math.max(0, (h - f) / (1 - f))));
    if (k < 0.5) { frontier = mids[b]; break; }
  }
  // candidates: previously-unknown anywhere + claimed-unverified in bands 1-2; nearest the frontier first
  const cand: number[] = [];
  for (const i in st.pas) {
    const idx = +i, b = bandOfIdx(idx), s = st.pas[idx];
    if (s === 0 || (b < 2 && s === 1)) cand.push(idx);
  }
  cand.sort((a, b) => Math.abs(Math.log(a + 1) - Math.log(frontier)) - Math.abs(Math.log(b + 1) - Math.log(frontier)));
  const words = cand.slice(0, 60);
  // pseudo dosing: cumulative n_p needed so the f-term alone allows SE_size <= 35
  const ft = st.ps[0] ? (st.ps[1] + 2) / (st.ps[0] + 4) : 0.5;
  let sumN1h = 0;
  for (let b = 2; b < 5; b++) {
    const lo = BANDOFF[b], hi = BANDOFF[b + 1];
    let n = 0, pos = 0;
    for (let i = lo; i < hi; i++) if (i in st.pas) { n++; if (st.pas[i] >= 1) pos++; }
    sumN1h += DATA.bands[b].n * (1 - (n ? pos / n : 0.3));
  }
  const need = Math.ceil(ft * (1 - ft) * Math.pow(sumN1h, 2) / (Math.pow(1 - Math.min(f, 0.5), 4) * 35 * 35));
  const np = Math.min(30, Math.max(8, need - st.ps[0]));
  return 'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 3, words, np, poff: st.ps[0] % 660 }))));
}

// ---------- SVG builders (HTML strings, numeric/escaped inputs only) ----------

/** Zipf coverage meter with comprehension thresholds. */
export function meterSVG(cov: number, opts: { thresholds?: boolean } = {}): string {
  const showThresholds = opts.thresholds !== false;
  const W = 760, H = 86, x0 = 6, x1 = W - 6, y = 46;
  const X = (p: number) => x0 + (x1 - x0) * p;
  let acc = 0;
  const ticks = DATA.bands.map((b) => { acc += b.mass; return { p: acc, l: b.label.split('–')[1] || b.label }; });
  const fillW = X(Math.min(cov, 1)) - x0;
  return '<div class="meter"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Estimated coverage ' + pct(cov) + '">'
    + '<rect x="' + x0 + '" y="' + (y - 16) + '" width="' + (x1 - x0) + '" height="16" rx="3" fill="var(--vm-silver-soft)"/>'
    + '<rect x="' + x0 + '" y="' + (y - 16) + '" width="' + fillW + '" height="16" rx="3" fill="var(--vm-cardinal)"/>'
    + ticks.map((t) => '<line x1="' + X(t.p) + '" y1="' + (y - 20) + '" x2="' + X(t.p) + '" y2="' + y + '" stroke="var(--vm-paper)" stroke-width="2"/><text x="' + X(t.p) + '" y="' + (y + 14) + '" font-size="9.5" fill="var(--vm-muted)" text-anchor="middle" font-family="monospace">' + t.l + '</text>').join('')
    + (showThresholds ? [[0.95, '95% adecuado'], [0.98, '98% cómodo']].map(([p, l]) => '<line x1="' + X(p as number) + '" y1="' + (y - 26) + '" x2="' + X(p as number) + '" y2="' + y + '" stroke="var(--vm-ink)" stroke-dasharray="3 3" stroke-width="1.5"/><text x="' + X(p as number) + '" y="' + (y - 30) + '" font-size="9.5" fill="var(--vm-ink)" text-anchor="end" font-family="monospace">' + l + '</text>').join('') : '')
    + '<text x="' + Math.max(x0 + 34, fillW + x0) + '" y="' + (y - 22) + '" font-size="13" font-weight="700" fill="var(--vm-cardinal)" text-anchor="' + (cov > 0.12 ? 'end' : 'start') + '" font-family="sans-serif">' + pct(cov) + '</text>'
    + '</svg><div class="cap"><span>rango 1</span><span>cobertura acumulada del habla (corpus hablado, 413M tokens)</span><span>rango 5.000 → ' + pct(DATA.bands.reduce((a, b) => a + b.mass, 0)) + '</span></div></div>';
}

export function cefrLadderSVG(c: CefrEstimate): string {
  const W = 760, H = 64, x0 = 6, x1 = W - 6, y = 18, h = 22;
  const X = (v: number) => x0 + (x1 - x0) * (v / 5000);
  return '<div class="meter"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="CEFR lexical estimate ' + c.pt.l + '">'
    + CEFR.map((b) => '<rect x="' + X(b.lo) + '" y="' + y + '" width="' + (X(b.hi) - X(b.lo) - 2) + '" height="' + h + '" rx="3" fill="' + (b.l === c.pt.l ? 'var(--vm-cardinal)' : 'var(--vm-silver-soft)') + '"/>'
      + '<text x="' + ((X(b.lo) + X(b.hi)) / 2) + '" y="' + (y + h / 2 + 4) + '" font-size="12" font-weight="700" text-anchor="middle" fill="' + (b.l === c.pt.l ? '#fff' : 'var(--vm-muted)') + '" font-family="sans-serif">' + b.l + '</text>').join('')
    + '<rect x="' + X(c.lo) + '" y="' + (y - 5) + '" width="' + Math.max(2, X(c.hi) - X(c.lo)) + '" height="' + (h + 10) + '" fill="var(--vm-cardinal)" opacity="0.14" rx="3"/>'
    + '<line x1="' + X(c.size) + '" y1="' + (y - 8) + '" x2="' + X(c.size) + '" y2="' + (y + h + 8) + '" stroke="var(--vm-cardinal-ink)" stroke-width="2.5"/>'
    + '<text x="' + X(c.size) + '" y="' + (y + h + 22) + '" font-size="10" fill="var(--vm-muted)" text-anchor="middle" font-family="monospace">' + fmt(c.size) + ' palabras (sombra = IC 95%)</text>'
    + '</svg></div>';
}

export interface OccasionGroup { o: string; C: MeanSE; Sz: MeanSE; fbar: number }

export function dashChartSVG(groups: OccasionGroup[]): string {
  const W = 760, H = 210, padL = 44, padR = 14, padT = 16, padB = 34;
  const X = (i: number) => padL + (W - padL - padR) * (groups.length === 1 ? 0.5 : i / (groups.length - 1));
  const Y = (c: number) => padT + (H - padT - padB) * (1 - c);
  let s = '<div class="meter"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progreso de la clase">';
  ([[0, '0%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']] as [number, string][]).forEach(([v, l]) => {
    s += '<line x1="' + padL + '" y1="' + Y(v) + '" x2="' + (W - padR) + '" y2="' + Y(v) + '" stroke="var(--vm-line)" stroke-width="1"/>'
      + '<text x="' + (padL - 6) + '" y="' + (Y(v) + 3) + '" font-size="9.5" fill="var(--vm-muted)" text-anchor="end" font-family="monospace">' + l + '</text>';
  });
  ([[0.95, '95%'], [0.98, '98%']] as [number, string][]).forEach(([v, l]) => {
    s += '<line x1="' + padL + '" y1="' + Y(v) + '" x2="' + (W - padR) + '" y2="' + Y(v) + '" stroke="var(--vm-ink)" stroke-dasharray="3 3" stroke-width="1"/>'
      + '<text x="' + (W - padR) + '" y="' + (Y(v) - 3) + '" font-size="9" fill="var(--vm-ink)" text-anchor="end" font-family="monospace">' + l + '</text>';
  });
  const pts = groups.map((g, i) => [X(i), Y(Math.max(0, Math.min(1, g.C.m)))]);
  if (pts.length > 1) s += '<polyline points="' + pts.map((p) => p.join(',')).join(' ') + '" fill="none" stroke="var(--vm-cardinal)" stroke-width="2.5"/>';
  groups.forEach((g, i) => {
    const t = tcrit(g.C.n - 1), lo = Y(Math.max(0, g.C.m - t * g.C.se)), hi = Y(Math.min(1, g.C.m + t * g.C.se));
    s += '<line x1="' + X(i) + '" y1="' + lo + '" x2="' + X(i) + '" y2="' + hi + '" stroke="var(--vm-cardinal)" stroke-width="2" opacity=".45"/>'
      + '<circle cx="' + X(i) + '" cy="' + Y(g.C.m) + '" r="5.5" fill="var(--vm-cardinal)" stroke="var(--vm-paper)" stroke-width="2"/>'
      + '<text x="' + X(i) + '" y="' + (H - padB + 16) + '" font-size="10" fill="var(--vm-muted)" text-anchor="middle" font-family="monospace">' + esc(String(g.o).slice(0, 16)) + '</text>'
      + '<text x="' + X(i) + '" y="' + (Y(g.C.m) - 11) + '" font-size="11" font-weight="700" fill="var(--vm-cardinal)" text-anchor="middle" font-family="sans-serif">' + pct(g.C.m, 0) + '</text>';
  });
  return s + '</svg><div class="cap"><span>cobertura media de la clase</span><span>bigotes = IC 95% de la media (t)</span></div></div>';
}

// ---------- multi-factor proficiency profile ----------
// Turns the separate instruments into one progress signal: each measure feeds
// a construct-defined factor, normalized to 0–100, tracked across occasions.

export type ProficiencyFactorKey =
  | 'breadth' | 'depth' | 'automaticity' | 'aural' | 'productive' | 'integrated' | 'oral';

export interface ProficiencyFactorMeta {
  key: ProficiencyFactorKey;
  label: string;
  blurb: string;
}

export const PROFICIENCY_FACTORS: ProficiencyFactorMeta[] = [
  { key: 'breadth', label: 'Amplitud receptiva', blurb: 'Cuántas palabras reconoce (tamaño de vocabulario).' },
  { key: 'depth', label: 'Profundidad de significado', blurb: 'Significado confirmado, no solo reconocido (dominio Top 500).' },
  { key: 'automaticity', label: 'Automaticidad', blurb: 'Velocidad de acceso léxico bajo presión temporal (decisión cronometrada).' },
  { key: 'aural', label: 'Léxico auditivo', blurb: 'Reconocimiento a partir del oído (pruebas auditivas).' },
  { key: 'productive', label: 'Producción', blurb: 'Evocar y escribir la palabra al oído (dictado).' },
  { key: 'integrated', label: 'Competencia integrada', blurb: 'Léxico + gramática + ortografía en contexto (C-test).' },
  { key: 'oral', label: 'Producción oral (experimental)', blurb: 'Repetir frases al oído (imitación provocada, puntuación automática por IA). Orientativo, fuera del índice compuesto.' },
];

export interface FactorPoint { occ: string; date: string; score: number; n: number }
export interface FactorSeries {
  key: ProficiencyFactorKey;
  label: string;
  blurb: string;
  latest: number | null;
  first: number | null;
  delta: number | null;
  points: FactorPoint[];
  sources: string[];
}

export interface ProfileRecord extends DashRecord {
  flagged?: boolean;
}

const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** Automaticity: invert median RT onto 0–100 (2000ms → 0, 500ms → 100). */
export function automaticityScore(medMs: number): number {
  return clamp100((100 * (2000 - medMs)) / (2000 - 500));
}

interface RawPoint { key: ProficiencyFactorKey; occ: string; date: string; score: number; source: string }

/**
 * Build the per-factor proficiency profile for one student. v1 measures give
 * per-occasion points; v2 censo/activo/sondeo (cumulative by design) contribute
 * a single latest point via the running ledger. Flagged (low-quality) attempts
 * are excluded.
 */
// Each factor is fed by exactly ONE per-occasion instrument on a single
// consistent scale — never a mix of instruments (the v1 written test and the
// v2 word-by-word census are incommensurable, so pooling them into one trend
// fabricates deltas). The cumulative censo/activo/sondeo measures keep their
// natural home in the word-by-word anuario, not this normalized profile.
const FACTOR_SOURCE: Partial<Record<string, ProficiencyFactorKey>> = {
  size: 'breadth',
  mastery: 'depth',
  ldt: 'automaticity',
  listen: 'aural',
  listen2: 'aural',
  dictado: 'productive',
  ctest: 'integrated',
  ei: 'oral',
};

/** Composite requires at least this many measured factors to be meaningful. */
export const MIN_COMPOSITE_FACTORS = 3;

export function computeProfile(records: ProfileRecord[]): FactorSeries[] {
  const clean = records.filter((r) => !r.flagged);
  const raw: RawPoint[] = [];

  for (const r of clean) {
    if (isV2(r.summary)) continue; // census measures live in the anuario, not here
    const key = FACTOR_SOURCE[r.mode];
    if (!key) continue;
    const occ = r.occ || r.date || '—';
    const e = estRecord(r.summary);
    let score: number | null = null;
    if (r.mode === 'size') score = e.size != null ? (e.size / 5000) * 100 : null;
    else if (r.mode === 'listen' || r.mode === 'listen2') score = e.size != null ? (e.size / 5000) * 100 : null;
    else if (r.mode === 'dictado') score = e.cov != null ? e.cov * 100 : null;
    else if (r.mode === 'mastery') score = e.mast != null ? e.mast * 100 : null;
    else if (r.mode === 'ctest') score = e.ctExact != null ? e.ctExact * 100 : null;
    else if (r.mode === 'ldt') score = e.rtMed != null ? automaticityScore(e.rtMed) : null;
    else if (r.mode === 'ei') score = e.eiMean != null ? e.eiMean * 100 : null;
    if (score == null) continue;
    raw.push({ key, occ, date: r.date, score: clamp100(score), source: r.mode });
  }

  return PROFICIENCY_FACTORS.map((meta) => {
    const pts = raw.filter((p) => p.key === meta.key);
    // Aggregate repeated same-instrument attempts within one occasion (mean).
    const byOcc = new Map<string, { date: string; scores: number[] }>();
    for (const p of pts) {
      const slot = byOcc.get(p.occ) ?? { date: p.date, scores: [] };
      slot.scores.push(p.score);
      if (!slot.date || (p.date && p.date < slot.date)) slot.date = p.date || slot.date;
      byOcc.set(p.occ, slot);
    }
    const points: FactorPoint[] = [...byOcc.entries()]
      .map(([occ, v]) => ({ occ, date: v.date, score: v.scores.reduce((a, b) => a + b, 0) / v.scores.length, n: v.scores.length }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.occ < b.occ ? -1 : 1));
    const latest = points.length ? points[points.length - 1].score : null;
    const first = points.length ? points[0].score : null;
    return {
      key: meta.key,
      label: meta.label,
      blurb: meta.blurb,
      latest,
      first,
      delta: latest != null && first != null && points.length > 1 ? latest - first : null,
      points,
      sources: [...new Set(pts.map((p) => p.source))],
    };
  });
}

/**
 * Overall composite: unweighted mean of measured factor latests (0–100).
 * Null until MIN_COMPOSITE_FACTORS factors exist — a mean over one or two
 * factors is not a proficiency estimate and is not comparable across students.
 */
export function profileComposite(series: FactorSeries[]): number | null {
  // 'oral' (elicited imitation) is excluded: its automatic ASR scoring and
  // device-dependent stimulus make it a screening indicator, not a component
  // of the headline index. It is still shown as its own factor.
  const vals = series
    .filter((s) => s.key !== 'oral')
    .map((s) => s.latest)
    .filter((v): v is number => v != null);
  return vals.length >= MIN_COMPOSITE_FACTORS
    ? vals.reduce((a, b) => a + b, 0) / vals.length
    : null;
}

export interface QualitySplit<T> { used: T[]; flagged: number; excluded: number }

/**
 * Class statistics apply the same attempt-quality rule as computeProfile:
 * flagged (low-quality) attempts are left out unless the teacher explicitly
 * includes them. `flagged` counts them either way, `excluded` only when they
 * were actually left out, so every table can say what it omitted.
 */
export function splitByQuality<T extends { flagged?: boolean }>(records: T[], includeFlagged: boolean): QualitySplit<T> {
  const flagged = records.filter((r) => r.flagged).length;
  return includeFlagged
    ? { used: records, flagged, excluded: 0 }
    : { used: records.filter((r) => !r.flagged), flagged, excluded: flagged };
}

/** True when a stored attempt's qualityJson marks it as low quality (flagged). */
export function isFlaggedQuality(qualityJson: string | null | undefined): boolean {
  if (!qualityJson) return false;
  try { return (JSON.parse(qualityJson) as { flagged?: unknown }).flagged === true; } catch { return false; }
}
