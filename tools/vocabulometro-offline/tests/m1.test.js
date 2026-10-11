// Milestone 1 regression tests.
const H = require('./harness.js');
const { test, assert, eq, near } = global.__t;

const mkCode = obj => 'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const seedProto = extra => H.run('S=' + JSON.stringify(Object.assign({
  mode: 's5000', seed: 1, name: 'Ana', date: '2026-01-01', occ: 'T1',
  blk: 1, form: '', i: 0, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
}, extra)) + ';S.rnd=mulberry32(1);1');

// ---------- (a) state 0 is recorded for tested-and-failed words ----------
test('protoScreen(false) records state 0 for a real (non-pseudo) screen item', () => {
  const w = H.ALLWORDS[7];
  seedProto({ queue: [{ w, idx: 7, ph: 'screen' }] });
  H.run('protoScreen(false)');
  eq(H.run('S.state[7]'), 0, 'failed word must land in S.state');
  assert(H.run('payloadV2()').startsWith('VNHS1.'), 'payloadV2 still encodes');
  const res = JSON.parse(decodeURIComponent(escape(atob(H.run('payloadV2()').slice(6))))).res;
  assert(res.some(([i, s]) => i === 7 && s === 0), 'state 0 must reach the v2 payload');
});

test('protoScreen(true) still records state 1 (claimed, unverified)', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
  H.run('protoScreen(true)');
  eq(H.run('S.state[9]'), 1);
});

test('protoScreen(false) on a pseudoword records no state, only a false-alarm denominator', () => {
  seedProto({ queue: [{ w: 'blerfada', ph: 'screen', pseudo: true }] });
  H.run('protoScreen(false)');
  eq(H.run('JSON.stringify(S.state)'), '{}');
  eq(H.run('S.ps[0]'), 1);
});

test('protoTyped(\'\') on an a500 item records state 0', () => {
  const w = H.ALLWORDS[7];
  seedProto({ mode: 'a500', blk: 1, form: 'A', queue: [{ w, idx: 7, ph: 'typed' }] });
  H.run("protoTyped('')");
  eq(H.run('S.state[7]'), 0);
});

test('setState never downgrades a higher state', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'screen' }] });
  H.run('S.state[7]=3;setState(S.queue[0],0)');
  eq(H.run('S.state[7]'), 3);
});

test('protoMC failing a fromNo recovery probe records state 0', () => {
  seedProto({
    mode: 'c500',
    queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'mc', fromNo: true, mc: { opts: ['a', 'b', 'c', 'd'], correct: 'a' } }]
  });
  H.run('protoMC(1)');
  eq(H.run('S.state[7]'), 0);
});

test('protoMC failing a fromYes probe leaves state 1 (claimed-unverified, by design)', () => {
  seedProto({
    mode: 'c500',
    queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'mc', fromYes: true, mc: { opts: ['a', 'b', 'c', 'd'], correct: 'a' } }]
  });
  H.run('S.state[7]=1;protoMC(1)');
  eq(H.run('S.state[7]'), 1);
});

// ---------- (b) runningEstimate ----------
function stubLedger(psArr) {
  const pas = {};
  const ones = { 2: 10, 3: 6, 4: 4 };       // 20 "sí", 115 "no" across bands 3-5
  for (const b of [2, 3, 4]) {
    for (let j = 0; j < 45; j++) pas[H.BANDOFF[b] + j] = j < ones[b] ? 1 : 0;
  }
  return { name: 'Ana', pas, act: {}, pasDate: {}, actDate: {}, ps: psArr, events: [] };
}

test('runningEstimate: sparse "sí" pattern yields a size well under 1500', () => {
  const R = H.runningEstimate(stubLedger([20, 1]));
  assert(Number.isFinite(R.size), 'size finite');
  assert(R.size < 1500, 'size was ' + R.size + ', expected well under 1500');
  assert(R.size > 0, 'size positive');
  assert(Number.isFinite(R.se) && R.se > 0, 'se finite and positive, got ' + R.se);
});

test('runningEstimate: variance uses N*(N-n), not (N-n)^2', () => {
  const st = stubLedger([20, 1]);
  const f = 1 / 20, ft = 3 / 24, vf = ft * (1 - ft) / 20;
  const g2 = Math.pow(1 - Math.min(f, 0.95), 2);
  const ones = { 2: 10, 3: 6, 4: 4 };
  let want = 0, wantOld = 0, sumN1h = 0;
  for (const b of [2, 3, 4]) {
    const N = H.DATA.bands[b].n, n = 45, pos = ones[b], ht = (pos + 2) / (n + 4);
    want += N * (N - n) * ht * (1 - ht) / n / g2;
    wantOld += Math.pow(N - n, 2) * ht * (1 - ht) / n / g2;
    sumN1h += N * (1 - pos / n);
  }
  const tail = sumN1h * sumN1h * vf / (g2 * g2);
  want += tail; wantOld += tail;
  const R = H.runningEstimate(st);
  near(R.se, Math.sqrt(want), 1e-6, 'se must match the N*(N-n) prediction variance');
  assert(R.se > Math.sqrt(wantOld), 'new se must exceed the old under-estimating formula');
});

test('runningEstimate: f=1 (sí to every pseudoword) stays finite', () => {
  const R = H.runningEstimate(stubLedger([20, 20]));
  eq(R.f, 1);
  assert(Number.isFinite(R.size), 'size was ' + R.size);
  assert(Number.isFinite(R.se), 'se was ' + R.se);
  assert(!Number.isNaN(R.size) && !Number.isNaN(R.se), 'no NaN');
  assert(R.size >= 0, 'size non-negative, got ' + R.size);
});

test('buildPlan: f=1 does not produce NaN and still emits a plan code', () => {
  const code = H.buildPlan(stubLedger([20, 20]));
  assert(code.startsWith('VNHS1.'), 'plan code emitted');
  const p = JSON.parse(decodeURIComponent(escape(atob(code.slice(6)))));
  eq(p.v, 3);
  assert(Array.isArray(p.words), 'plan carries words');
  assert(Number.isFinite(p.np) && p.np >= 8, 'np finite, got ' + p.np);
});

// ---------- (c) parseCode validation ----------
const legitYN = { bands: [[10, 5], [10, 4], [10, 3], [10, 2], [10, 1]], ps: [15, 1] };

test('parseCode accepts a round-tripped legit v1 size code', () => {
  const p = H.parseCode(mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN }));
  assert(p, 'must parse');
  eq(p.mode, 'size'); eq(p.name, 'Ana'); eq(p.occ, 'T1');
  eq(p.yn.ps[0], 15);
});

test('parseCode rejects an injected mode', () => {
  eq(H.parseCode(mkCode({ v: 1, name: 'Ana', date: 'd', occ: '', mode: '<img src=x onerror=1>', yn: legitYN })), null);
});

test('parseCode rejects res with non-integer pairs', () => {
  eq(H.parseCode(mkCode({ v: 2, name: 'Ana', date: 'd', occ: '', mode: 'c500', blk: 1, res: [['a', 'b']], ps: [5, 0] })), null);
});

test('parseCode rejects out-of-range and malformed res entries', () => {
  const base = { v: 2, name: 'Ana', date: 'd', occ: '', mode: 'c500', blk: 1, ps: [5, 0] };
  eq(H.parseCode(mkCode({ ...base, res: [[0, 9]] })), null, 'state > 3');
  eq(H.parseCode(mkCode({ ...base, res: [[-1, 2]] })), null, 'negative index');
  eq(H.parseCode(mkCode({ ...base, res: [[0, 2, 7]] })), null, 'triple');
  eq(H.parseCode(mkCode({ ...base, res: 'nope' })), null, 'res not an array');
  eq(H.parseCode(mkCode({ ...base, res: new Array(6001).fill([0, 1]) })), null, 'res over the 6000 cap');
  assert(H.parseCode(mkCode({ ...base, res: [[0, 2], [17, 0]] })), 'valid res still accepted');
});

test('parseCode rejects a bad ps and a non-string name', () => {
  const base = { v: 2, name: 'Ana', date: 'd', occ: '', mode: 'c500', blk: 1, res: [[0, 2]] };
  eq(H.parseCode(mkCode({ ...base, ps: [1] })), null, 'ps wrong length');
  eq(H.parseCode(mkCode({ ...base, ps: ['a', 'b'] })), null, 'ps non-integer');
  eq(H.parseCode(mkCode({ ...base, ps: [5, 0], name: { toString: 1 } })), null, 'object name');
});

test('parseCode rejects junk and input that is not a result code', () => {
  eq(H.parseCode('hello'), null);
  eq(H.parseCode('VNHS1.!!!notbase64!!!'), null);
  eq(H.parseCode(mkCode({ v: 1, name: 'Ana', date: 'd', occ: '', mode: 'size' })), null, 'no counts at all');
  eq(H.parseCode(null), null);
});

test('parseCode still passes v3 adaptive plans through', () => {
  const p = H.parseCode(mkCode({ v: 3, words: [1, 2, 3], np: 12, poff: 0 }));
  assert(p && p.v === 3 && p.words.length === 3, 'v3 plan preserved');
});

// ---------- (d) esc ----------
test('esc escapes &, <, >, " and \'', () => {
  eq(H.esc('\'<&"'), '&#39;&lt;&amp;&quot;');
  eq(H.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('esc coerces null/undefined/numbers instead of throwing', () => {
  eq(H.esc(null), ''); eq(H.esc(undefined), ''); eq(H.esc(7), '7');
});

// ---------- (e) gformHTML takes the code as a parameter ----------
test('gformHTML(code) embeds the code it was handed', () => {
  H.run("S={mode:'size',name:'Ana',date:'2026-01-01',occ:'',resp:[]}");
  H.run("GFORM.action='https://example.com/formResponse';GFORM.name='entry.1';GFORM.timestamp='entry.2';GFORM.code='entry.3'");
  try {
    const html = H.gformHTML('VNHS1.test');
    assert(html.indexOf('VNHS1.test') >= 0, 'hidden field must carry the passed code');
    assert(html.indexOf('name="entry.3"') >= 0, 'code entry id present');
    assert(html.indexOf('value="Ana"') >= 0, 'student name present');
  } finally { H.run("GFORM.action='';GFORM.name='';GFORM.timestamp='';GFORM.code=''"); }
});

test('gformHTML falls back to the note when GFORM is unconfigured', () => {
  assert(H.gformHTML('VNHS1.test').indexOf('<form') < 0, 'no form without GFORM.action');
});

test('gformHTML does not read #codeOut from the live DOM', () => {
  const src = H.gformHTML.toString();
  assert(src.indexOf('codeOut') < 0, 'gformHTML must not touch #codeOut');
});

// ---------- (f) dashExportCSV tolerates v2 records ----------
test('dashExportCSV does not throw when DASH holds a v2 word-state record', () => {
  H.run("DASH.length=0;DASH.push({v:2,name:'Ana',date:'2026-01-01',occ:'T1',mode:'c500',blk:1,res:[[0,2],[1,0]],ps:[5,0]})");
  H.run('dashExportCSV()');   // throws out of run() if estRecord is reached
  eq(H.run('DASH.length'), 1);
  H.run('DASH.length=0');
});

test('dashExportCSV still emits per-student rows for v1 records', () => {
  H.run("DASH.length=0;DASH.push(" + JSON.stringify({
    v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN
  }) + ",{v:2,name:'Bo',date:'2026-01-02',occ:'T1',mode:'c500',blk:1,res:[[0,2]],ps:[5,0]})");
  H.run('dashExportCSV()');
  const csv = H.lastBlobText();
  assert(csv.indexOf('student,size') >= 0, 'v1 student row present');
  assert(csv.indexOf('Bo') < 0, 'v2 record must not reach the CSV');
  H.run('DASH.length=0');
});

// ---------- ledger sanity: state 0 now reaches the estimator denominator ----------
test('ledger counts state-0 words in the tested denominator', () => {
  H.run("DASH.length=0;DASH.push({v:2,name:'Ana',date:'2026-01-01',occ:'',mode:'s5000',blk:1,res:[[0,2],[1,0],[2,0]],ps:[5,0]})");
  const L = H.ledger();
  const st = L['ana'];
  assert(st, 'student in ledger');
  eq(Object.keys(st.pas).length, 3, 'all three words tested, including the two failures');
  eq(st.pas[1], 0);
  H.run('DASH.length=0');
});
