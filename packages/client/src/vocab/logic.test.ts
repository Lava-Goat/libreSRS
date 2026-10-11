// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import {
  buildCtestPassage, buildCtestForm, ctestExact, ctestLenient, summaryFromCtest,
  summaryFromLdt, LDT_ANTICIPATION_FLOOR_MS, computeProfile, profileComposite,
  acceptActive, bandsCovered, buildPlan, buildProtocolQueue, esc, estRecord, ledger,
  mulberry32, norm, parsePlanCode, runningEstimate, summaryFromProtocol, withinLockout,
  ALLWORDS, BANDOFF, DATA, PLAN_MAX_WORDS,
  type DashRecord, type LedgerEntry, type YnResponse,
} from './logic';

describe('C-test construction', () => {
  const text = 'Había una vez una ciudad pequeña. Las personas caminaban despacio por las calles antiguas cada mañana soleada del invierno pasado.';

  it('leaves the first sentence intact and gaps every 2nd eligible word after it', () => {
    const p = buildCtestPassage('T', text, 50);
    // no gap may fall in the first sentence (before the first period token)
    const firstPeriod = p.tokens.findIndex((tk) => /[.!?…]/.test(tk));
    expect(p.gaps.every((g) => g.idx > firstPeriod)).toBe(true);
    // deterministic: same input → same gaps
    expect(buildCtestPassage('T', text, 50).gaps.map((g) => g.word)).toEqual(p.gaps.map((g) => g.word));
    // stems are the first half of each word
    for (const g of p.gaps) {
      expect(g.word.startsWith(g.stem)).toBe(true);
      expect(g.stem.length + g.gapLen).toBe(g.word.length);
    }
  });

  it('falls back to keeping ~8 words when the text has no sentence punctuation', () => {
    const noPunct = 'palabra otra tercera cuarta quinta sexta septima octava novena decima undecima duodecima';
    const p = buildCtestPassage('T', noPunct, 50);
    expect(p.gaps.length).toBeGreaterThan(0);
  });

  it('honors a global gap budget across passages without a per-text floor', () => {
    const texts = [{ title: 'a', content: text }, { title: 'b', content: text }, { title: 'c', content: text }];
    const passages = buildCtestForm(texts, 10);
    const total = passages.reduce((n, p) => n + p.gaps.length, 0);
    expect(total).toBeLessThanOrEqual(10);
  });
});

describe('C-test scoring', () => {
  const gap = { idx: 0, word: 'personas', stem: 'pers', gapLen: 4 };

  it('accepts the completion or the full word retyped', () => {
    expect(ctestExact('onas', gap)).toBe(true);       // completion
    expect(ctestExact('personas', gap)).toBe(true);   // full word
    expect(ctestExact('onos', gap)).toBe(false);
  });

  it('lenient tier tolerates accents but not a missing ñ', () => {
    const accented = { idx: 0, word: 'mañana', stem: 'ma', gapLen: 4 };
    expect(ctestExact('ñana', accented)).toBe(true);
    // ñ is a distinct letter, not an accent: norm() preserves it, so the
    // lenient tier forgives á/é/í/ó/ú but still requires the tilde.
    expect(ctestLenient('nana', accented)).toBe(false);
    expect(ctestLenient('ñana', accented)).toBe(true);
    const stressed = { idx: 0, word: 'llegó', stem: 'lle', gapLen: 2 };
    expect(ctestExact('go', stressed)).toBe(false);
    expect(ctestLenient('go', stressed)).toBe(true);
  });

  it('summaryFromCtest counts exact and lenient separately', () => {
    const s = summaryFromCtest([
      { exact: true, lenient: true },
      { exact: false, lenient: true },
      { exact: false, lenient: false },
    ]);
    expect(s.ct).toEqual({ n: 3, c: 1, cl: 2 });
  });
});

describe('speeded LDT summary', () => {
  const mk = (b: number, yes: boolean, ms: number, extra: Partial<YnResponse> = {}): YnResponse =>
    ({ w: `w${b}`, b, t: 'real', yes, ms, ...extra });

  it('counts timeouts as "no" in the band totals (no upward censoring)', () => {
    const resp: YnResponse[] = [
      mk(0, true, 500),
      mk(0, false, 800, { timedOut: true }), // timeout → counts as an answered "no"
    ];
    const s = summaryFromLdt(resp);
    expect(s.yn.bands[0]).toEqual([2, 1]); // n=2 (both counted), yes=1
    expect(s.rt.timeouts).toBe(1);
  });

  it('excludes timeouts and sub-floor anticipations from the automaticity median', () => {
    const resp: YnResponse[] = [
      mk(0, true, LDT_ANTICIPATION_FLOOR_MS - 50), // anticipation, dropped
      mk(0, true, 600),
      mk(1, true, 800),
      mk(0, false, 900, { timedOut: true }),       // timeout, dropped
    ];
    const s = summaryFromLdt(resp);
    // median of [600, 800] → 800 (upper-middle by the floor-index convention)
    expect(s.rt.med).toBe(800);
  });

  it('median is null when no qualifying yes responses exist', () => {
    const resp: YnResponse[] = [mk(3, true, 700), mk(4, false, 700)]; // b>1 excluded
    expect(summaryFromLdt(resp).rt.med).toBeNull();
  });
});

describe('multi-factor proficiency profile', () => {
  const rec = (mode: string, occ: string, date: string, summary: unknown, flagged = false) =>
    ({ userId: 1, name: 'S', date, occ, mode, summary, flagged } as import('./logic').ProfileRecord);

  const sizeSummary = (bandYes: number) => ({
    v: 1 as const,
    yn: { bands: [[10, bandYes], [10, bandYes], [10, bandYes], [10, bandYes], [10, bandYes]] as [number, number][], ps: [15, 1] as [number, number] },
  });

  it('classifies measures into distinct factors and normalizes to 0-100', () => {
    const series = computeProfileTest([
      rec('size', 'Otoño', '2026-09-01', sizeSummary(8)),
      rec('mastery', 'Otoño', '2026-09-01', { v: 1, mc: { n: 40, c: 34, w: 4, o: 2 } }),
      rec('ctest', 'Otoño', '2026-09-01', { v: 1, ct: { n: 20, c: 14, cl: 16 } }),
      rec('ldt', 'Otoño', '2026-09-01', { v: 1, yn: sizeSummary(8).yn, rt: { med: 800, timeouts: 2 } }),
    ]);
    const byKey = new Map(series.map((s) => [s.key, s]));
    expect(byKey.get('breadth')!.latest).not.toBeNull();
    expect(byKey.get('depth')!.latest).not.toBeNull();
    expect(byKey.get('integrated')!.latest).toBeCloseTo(70, 0); // 14/20
    expect(byKey.get('automaticity')!.latest).toBeCloseTo((100 * (2000 - 800)) / 1500, 0);
    for (const s of series) {
      if (s.latest != null) { expect(s.latest).toBeGreaterThanOrEqual(0); expect(s.latest).toBeLessThanOrEqual(100); }
    }
  });

  it('tracks per-occasion delta on a factor', () => {
    const series = computeProfileTest([
      rec('size', 'Otoño', '2026-09-01', sizeSummary(5)),
      rec('size', 'Primavera', '2027-03-01', sizeSummary(9)),
    ]);
    const breadth = series.find((s) => s.key === 'breadth')!;
    expect(breadth.points).toHaveLength(2);
    expect(breadth.delta).not.toBeNull();
    expect(breadth.delta!).toBeGreaterThan(0); // improved
  });

  it('excludes flagged (low-quality) attempts', () => {
    const series = computeProfileTest([
      rec('ctest', 'Otoño', '2026-09-01', { v: 1, ct: { n: 20, c: 2, cl: 2 } }, true),
    ]);
    expect(series.find((s) => s.key === 'integrated')!.latest).toBeNull();
  });

  it('maps a dictado attempt to productive only (no double-count into aural)', () => {
    const series = computeProfileTest([rec('dictado', 'Otoño', '2026-09-01', sizeSummary(6))]);
    expect(series.find((s) => s.key === 'productive')!.latest).not.toBeNull();
    expect(series.find((s) => s.key === 'aural')!.latest).toBeNull();
  });

  it('does not blend v2 census records into any factor trend', () => {
    const series = computeProfileTest([
      rec('mastery', 'Otoño', '2026-09-01', { v: 1, mc: { n: 40, c: 40, w: 0, o: 0 } }),
      rec('c500', 'Otoño', '2026-09-01', { v: 2, res: [[0, 2], [1, 1]], ps: [3, 0] }),
    ]);
    const depth = series.find((s) => s.key === 'depth')!;
    expect(depth.points).toHaveLength(1);      // only the v1 mastery point
    expect(depth.sources).toEqual(['mastery']); // census excluded
    expect(depth.latest).toBe(100);            // not diluted by the census
  });

  it('excludes the experimental oral (EI) factor from the composite', () => {
    const series = computeProfileTest([
      rec('size', 'Otoño', '2026-09-01', sizeSummary(8)),
      rec('mastery', 'Otoño', '2026-09-01', { v: 1, mc: { n: 40, c: 34, w: 4, o: 2 } }),
      rec('ei', 'Otoño', '2026-09-01', { v: 1, ei: { n: 6, sum: 5.4 } }),
    ]);
    // oral IS shown as a factor
    expect(series.find((s) => s.key === 'oral')!.latest).not.toBeNull();
    // but the composite only has 2 non-oral factors here → withheld
    expect(profileComposite(series)).toBeNull();
  });

  it('withholds the composite until at least MIN_COMPOSITE_FACTORS factors exist', () => {
    const two = computeProfileTest([
      rec('size', 'Otoño', '2026-09-01', sizeSummary(8)),
      rec('mastery', 'Otoño', '2026-09-01', { v: 1, mc: { n: 40, c: 34, w: 4, o: 2 } }),
    ]);
    expect(profileComposite(two)).toBeNull(); // only 2 factors
    const three = computeProfileTest([
      ...([
        rec('size', 'Otoño', '2026-09-01', sizeSummary(8)),
        rec('mastery', 'Otoño', '2026-09-01', { v: 1, mc: { n: 40, c: 34, w: 4, o: 2 } }),
        rec('ctest', 'Otoño', '2026-09-01', { v: 1, ct: { n: 20, c: 14, cl: 16 } }),
      ]),
    ]);
    expect(profileComposite(three)).not.toBeNull();
  });
});

// import shim so the block above stays readable
function computeProfileTest(records: import('./logic').ProfileRecord[]) {
  return computeProfile(records);
}

// ---------------------------------------------------------------------------
// Fixes ported from the standalone tools/vocabulometro-offline build. The
// assertions mirror its node suite (tests/m1–m3) so the two implementations
// cannot drift apart silently.
// ---------------------------------------------------------------------------

describe('norm() preserves ñ', () => {
  it('does not fold año onto ano', () => {
    expect(norm('año')).toBe('año');
    expect(norm('ano')).toBe('ano');
    expect(norm('año')).not.toBe(norm('ano'));
  });

  it('still strips ordinary accents and trims/lowercases', () => {
    expect(norm('sí')).toBe('si');
    expect(norm('llegó')).toBe('llego');
    expect(norm('  ESDRÚJULA ')).toBe('esdrujula');
  });

  it('treats a precomposed and a decomposed ñ identically', () => {
    expect(norm('año')).toBe(norm('año'));
  });

  it('acceptActive rejects the ñ-less spelling of a ñ word', () => {
    const w = DATA.bands[0].words.find((x) => /ñ/.test(x));
    expect(w).toBeDefined();
    expect(acceptActive(w!, w!)).toBe(true);
    expect(acceptActive(w!.replace(/ñ/g, 'n'), w!)).toBe(false);
    // accents are still forgiven
    const accented = DATA.bands[0].words.find((x) => /[áéíóú]/.test(x));
    if (accented) expect(acceptActive(accented.normalize('NFD').replace(/[̀-ͯ]/g, ''), accented)).toBe(true);
  });
});

describe('runningEstimate (anuario)', () => {
  /** 45 words tested per band in 3-5, of which `ones[b]` were claimed. */
  const stubLedger = (ps: [number, number]): LedgerEntry => {
    const pas: Record<number, number> = {};
    const ones: Record<number, number> = { 2: 10, 3: 6, 4: 4 };
    for (const b of [2, 3, 4]) {
      for (let j = 0; j < 45; j++) pas[BANDOFF[b] + j] = j < ones[b] ? 1 : 0;
    }
    return { userId: 1, name: 'Ana', pas, act: {}, pasDate: {}, actDate: {}, ps, events: [] };
  };

  it('puts a weak student far below 1.500 words, not near the full band mass', () => {
    const R = runningEstimate(stubLedger([20, 1]));
    expect(Number.isFinite(R.size)).toBe(true);
    expect(R.size).toBeGreaterThan(0);
    expect(R.size).toBeLessThan(1500);
    expect(R.se).toBeGreaterThan(0);
    expect(Number.isFinite(R.se)).toBe(true);
  });

  it('uses the finite-population factor N*(N-n), not (N-n)^2', () => {
    const st = stubLedger([20, 1]);
    const f = 1 / 20, ft = 3 / 24, vf = (ft * (1 - ft)) / 20;
    const g2 = Math.pow(1 - Math.min(f, 0.95), 2);
    const ones: Record<number, number> = { 2: 10, 3: 6, 4: 4 };
    let want = 0, wantOld = 0, sumN1h = 0;
    for (const b of [2, 3, 4]) {
      const N = DATA.bands[b].n, n = 45, pos = ones[b], ht = (pos + 2) / (n + 4);
      want += (N * (N - n) * ht * (1 - ht)) / n / g2;
      wantOld += (Math.pow(N - n, 2) * ht * (1 - ht)) / n / g2;
      sumN1h += N * (1 - pos / n);
    }
    const tail = (sumN1h * sumN1h * vf) / (g2 * g2);
    const R = runningEstimate(st);
    expect(R.se).toBeCloseTo(Math.sqrt(want + tail), 6);
    expect(R.se).toBeGreaterThan(Math.sqrt(wantOld + tail)); // the old formula understated it
  });

  it('stays finite when the student said sí to every pseudoword (f=1)', () => {
    const R = runningEstimate(stubLedger([20, 20]));
    expect(R.f).toBe(1);
    expect(Number.isFinite(R.size)).toBe(true);
    expect(Number.isFinite(R.se)).toBe(true);
    expect(R.size).toBeGreaterThanOrEqual(0);
  });

  it('leaves untested bands out of both the point estimate and the variance', () => {
    const only3 = runningEstimate({
      userId: 1, name: 'Ana', pas: { [BANDOFF[2]]: 1 }, act: {}, pasDate: {}, actDate: {},
      ps: [10, 1], events: [],
    });
    // band 3 alone can contribute at most its own N; bands 1,2,4,5 add nothing
    expect(only3.size).toBeLessThanOrEqual(DATA.bands[2].n);
    expect(only3.cens).toBeCloseTo(1 / ALLWORDS.length, 10);
  });

  it('f=1 does not make buildPlan emit NaN', () => {
    const code = buildPlan(stubLedger([20, 20]));
    expect(code.startsWith('VNHS1.')).toBe(true);
    const p = parsePlanCode(code);
    expect(p).not.toBeNull();
    expect(p!.v).toBe(3);
    expect(Number.isFinite(p!.np)).toBe(true);
    expect(p!.np!).toBeGreaterThanOrEqual(8);
  });
});

describe('state-0 recording reaches the estimator denominator', () => {
  const rec = (res: [number, number][]): DashRecord => ({
    userId: 1, name: 'Ana', date: '2026-01-01', occ: '', mode: 's5000',
    summary: { v: 2, res, ps: [20, 1] },
  });
  // 135 words tested across bands 3-5; only 20 of them were claimed
  const claimed: [number, number][] = [];
  const failed: [number, number][] = [];
  for (const [b, ones] of [[2, 10], [3, 6], [4, 4]] as [number, number][]) {
    for (let j = 0; j < 45; j++) (j < ones ? claimed : failed).push([BANDOFF[b] + j, j < ones ? 1 : 0]);
  }

  it('a payload with only the successes inflates the size to nearly the whole domain', () => {
    const R = runningEstimate(ledger([rec(claimed)])[1]);
    expect(R.size).toBeGreaterThan(3000); // h ≡ 1 in every tested band
  });

  it('recording the failures too brings it back to the real estimate', () => {
    const R = runningEstimate(ledger([rec([...claimed, ...failed])])[1]);
    expect(R.size).toBeLessThan(1500);
  });

  it('summaryFromProtocol carries state-0 entries into the payload', () => {
    const s = summaryFromProtocol({ 7: 0, 9: 1, 11: 2 }, [5, 0]);
    expect(s.res).toContainEqual([7, 0]);
    expect(s.res).toHaveLength(3);
  });
});

describe('ledger date handling', () => {
  const rec = (date: string, mode: string, i: number, s: number): DashRecord => ({
    userId: 1, name: 'Ana', date, occ: '', mode, blk: '1',
    summary: { v: 2, res: [[i, s]], ps: [0, 0] },
  });

  it('a same-day claimed record cannot demote a verified word', () => {
    expect(ledger([rec('2026-01-01', 'c500', 5, 2), rec('2026-01-01', 's5000', 5, 1)])[1].pas[5]).toBe(2);
    expect(ledger([rec('2026-01-01', 's5000', 5, 1), rec('2026-01-01', 'c500', 5, 2)])[1].pas[5]).toBe(2);
  });

  it('a strictly later date still wins, downgrades included, whatever the order', () => {
    const fwd = ledger([rec('2026-01-01', 'c500', 5, 2), rec('2026-06-01', 'c500', 5, 0)])[1];
    expect(fwd.pas[5]).toBe(0);
    expect(fwd.pasDate[5]).toBe('2026-06-01');
    const back = ledger([rec('2026-06-01', 'c500', 5, 0), rec('2026-01-01', 'c500', 5, 2)])[1];
    expect(back.pas[5]).toBe(0);
    expect(back.pasDate[5]).toBe('2026-06-01');
  });

  it('the a500 branch follows the same rules', () => {
    expect(ledger([rec('2026-01-01', 'a500', 5, 3), rec('2026-01-01', 'a500', 5, 0)])[1].act[5]).toBe(3);
    const later = ledger([rec('2026-01-01', 'a500', 5, 3), rec('2026-06-01', 'a500', 5, 0)])[1];
    expect(later.act[5]).toBe(0);
    expect(later.actDate[5]).toBe('2026-06-01');
  });
});

describe('estRecord mastery is unclamped for aggregation', () => {
  it('returns a below-chance corrected score as the raw negative', () => {
    const e = estRecord({ v: 1, mc: { n: 20, c: 4, w: 16, o: 0 } });
    expect(e.mast).toBeCloseTo((4 - 16 / 3) / 20, 12);
    expect(e.mast!).toBeLessThan(0);
    expect(Number.isFinite(e.seM!)).toBe(true);
    expect(e.seM!).toBeGreaterThan(0);
  });

  it('clamping before averaging would bias a class mean upward', () => {
    const weak = estRecord({ v: 1, mc: { n: 20, c: 4, w: 16, o: 0 } }).mast!;
    const strong = estRecord({ v: 1, mc: { n: 20, c: 20, w: 0, o: 0 } }).mast!;
    expect((weak + strong) / 2).toBeLessThan((Math.max(0, weak) + strong) / 2);
  });
});

describe('buildProtocolQueue', () => {
  it('shuffles the a500 queue out of strict corpus-frequency order', () => {
    const got = buildProtocolQueue('a500', { form: 'A', blk: 1 }, mulberry32(7)).queue.map((q) => q.w);
    const strict = DATA.bands[0].words.filter((_, i) => i % 2 === 0).filter((_, i) => i % 5 === 0);
    expect(got).toHaveLength(strict.length);
    expect([...got].sort()).toEqual([...strict].sort());
    expect(got.join('|')).not.toBe(strict.join('|'));
  });

  it('is deterministic per seed', () => {
    const a = buildProtocolQueue('a500', { form: 'A', blk: 1 }, mulberry32(7)).queue.map((q) => q.w);
    const same = buildProtocolQueue('a500', { form: 'A', blk: 1 }, mulberry32(7)).queue.map((q) => q.w);
    const other = buildProtocolQueue('a500', { form: 'A', blk: 1 }, mulberry32(8)).queue.map((q) => q.w);
    expect(same.join('|')).toBe(a.join('|'));
    expect(other.join('|')).not.toBe(a.join('|'));
  });

  it('rounds a fractional block instead of selecting nothing', () => {
    const q = buildProtocolQueue('c500', { blk: 2.5 }, mulberry32(1));
    expect(q.blk).toBe(3);
    expect(q.queue.length).toBeGreaterThan(0);
    for (const mode of ['a500', 's5000'] as const) {
      const r = buildProtocolQueue(mode, { blk: 2.5, form: 'A' }, mulberry32(1));
      expect(Number.isInteger(r.blk as number)).toBe(true);
      expect(r.queue.length).toBeGreaterThan(0);
    }
  });
});

describe('parsePlanCode validation', () => {
  const mk = (obj: unknown) => 'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));

  it('accepts a well-formed v3 plan', () => {
    const p = parsePlanCode(mk({ v: 3, words: [1, 2, 3], np: 12, poff: 0 }));
    expect(p).not.toBeNull();
    expect(p!.words).toEqual([1, 2, 3]);
  });

  it('round-trips a real buildPlan code', () => {
    const st: LedgerEntry = {
      userId: 1, name: 'Ana', pas: { 0: 0, 1: 0, 2: 1 }, act: {}, pasDate: {}, actDate: {},
      ps: [20, 1], events: [],
    };
    expect(parsePlanCode(buildPlan(st))).not.toBeNull();
  });

  it('rejects malformed word lists', () => {
    expect(parsePlanCode(mk({ v: 3, words: ['a'] }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: [1.5] }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: [-1] }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: [ALLWORDS.length] }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: new Array(PLAN_MAX_WORDS + 1).fill(0) }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: 'nope' }))).toBeNull();
  });

  it('rejects bad np/poff and non-plan payloads', () => {
    expect(parsePlanCode(mk({ v: 3, words: [1], np: 'x' }))).toBeNull();
    expect(parsePlanCode(mk({ v: 3, words: [1], poff: -1 }))).toBeNull();
    expect(parsePlanCode(mk({ v: 2, res: [[0, 2]], ps: [5, 0] }))).toBeNull();
    expect(parsePlanCode(mk([1, 2, 3]))).toBeNull();
    expect(parsePlanCode('hello')).toBeNull();
    expect(parsePlanCode('VNHS1.!!!notbase64!!!')).toBeNull();
    expect(parsePlanCode('')).toBeNull();
  });

  it('a rejected plan leaves the sondeo on its weekly slice instead of running an empty queue', () => {
    const bad = buildProtocolQueue('s5000', { planCode: mk({ v: 3, words: ['a'] }), blk: 1 }, mulberry32(1));
    expect(bad.blk).toBe(1); // not 'P'
    expect(bad.queue.length).toBeGreaterThan(0);
  });
});

describe('adaptive-stop band coverage gate', () => {
  const items = () => {
    const it: { b: number }[] = [];
    for (let b = 0; b < 4; b++) for (let j = 0; j < 8; j++) it.push({ b });
    for (let j = 0; j < 5; j++) it.push({ b: 4 });
    for (let j = 0; j < 10; j++) it.push({ b: -1 });
    return it;
  };
  const resp = () => {
    const r: { b: number }[] = [];
    for (let b = 0; b < 4; b++) for (let j = 0; j < 6; j++) r.push({ b });
    for (let j = 0; j < 8; j++) r.push({ b: -1 });
    return r;
  };

  it('is false while a sampled band has too few responses', () => {
    expect(bandsCovered(items(), resp())).toBe(false);
    expect(bandsCovered(items(), [...resp(), { b: 4 }, { b: 4 }, { b: 4 }])).toBe(false);
    expect(bandsCovered(items(), [...resp(), { b: 4 }, { b: 4 }, { b: 4 }, { b: 4 }])).toBe(true);
  });

  it('ignores bands the form never sampled at all', () => {
    expect(bandsCovered([{ b: 0 }, { b: 0 }], [{ b: 0 }, { b: 0 }])).toBe(true);
  });
});

describe('input hardening helpers', () => {
  it('withinLockout ignores the pre-first-item sentinel', () => {
    expect(withinLockout(0, 10)).toBe(false);      // t0===0: no item on screen yet
    expect(withinLockout(1000, 1100)).toBe(true);  // 100ms after onset
    expect(withinLockout(1000, 1400)).toBe(false); // well past the lockout
  });

  it('esc escapes quotes and coerces null/undefined/numbers', () => {
    expect(esc('\'<&"')).toBe('&#39;&lt;&amp;&quot;');
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(7)).toBe('7');
  });
});
