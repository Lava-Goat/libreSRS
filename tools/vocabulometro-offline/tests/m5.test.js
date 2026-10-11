// Milestone 5 regression tests: hardening pass over the adversarial findings.
//   (1) parseCode must validate yn/mc shape, or one crafted code bricks the persisted panel
//   (2) autofocus must never land on an answer control (Enter/Space would record a 'sí')
//   (3) handleKey must ignore an empty e.key ('abcd'.indexOf('') === 0)
//   (4) ingestCSV and parseCode must agree: everything in DASH survives the storage round-trip
//   (5) splitCSV must treat a mid-field quote as a literal character (RFC 4180)
//   (6) the last student-facing English strings are translated
const fs = require('fs');
const path = require('path');
const H = require('./harness.js');
const { test, assert, eq } = global.__t;

const APP = process.env.VOCABULOMETRO_HTML || path.join(__dirname, '..', 'vocabulometro.html');
const RAW = fs.readFileSync(APP, 'utf8');
// the file with the two giant single-line DATA/AUDIO blobs excised — string surgery only,
// so no regex ever runs over 700KB of base64 (same trick harness.js and m4 use)
const SAFE = (() => {
  const dStart = RAW.indexOf('const DATA'), dEnd = RAW.indexOf('\n', dStart);
  const aStart = RAW.indexOf('const AUDIO'), aEnd = RAW.indexOf('\n', aStart);
  return RAW.slice(0, dStart) + RAW.slice(dEnd, aStart) + RAW.slice(aEnd);
})();

const mkCode = obj => 'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const legitYN = { bands: [[10, 5], [10, 4], [10, 3], [10, 2], [10, 1]], ps: [15, 1] };
const v1 = extra => Object.assign({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size' }, extra);
const reset = () => { H.run('DASH.length=0;SEEN.clear();dashLoaded=true;1'); H.localStorage.clear(); };
const dashHTML = () => { H.renderDash(); return H.run("$('#dashBody').innerHTML"); };
// download() defers its revoke by 1000ms; tests must not leave a real timer pending
const syncTimers = fn => {
  const real = global.setTimeout;
  global.setTimeout = f => { f(); return 0; };
  try { return fn(); } finally { global.setTimeout = real; }
};

// ---------- (1) parseCode validates the yn/mc shapes estRecord destructures ----------
test('parseCode rejects yn:{} — the code that used to brick the persisted dashboard', () => {
  // the original repro: saveDash writes this to localStorage BEFORE renderDash throws inside
  // estFromCounts, and loadDash re-ingests it on every open, so the panel never comes back
  eq(H.parseCode(mkCode({ v: 1, mode: 'size', name: 'X', yn: {} })), null);
});

test('parseCode rejects a yn missing ps, or with a malformed ps', () => {
  eq(H.parseCode(mkCode(v1({ yn: { bands: legitYN.bands } }))), null, 'ps absent');
  eq(H.parseCode(mkCode(v1({ yn: { bands: legitYN.bands, ps: [15] } }))), null, 'ps wrong length');
  eq(H.parseCode(mkCode(v1({ yn: { bands: legitYN.bands, ps: ['a', 'b'] } }))), null, 'ps non-integer');
  eq(H.parseCode(mkCode(v1({ yn: { bands: legitYN.bands, ps: [-1, 0] } }))), null, 'negative pseudo n');
  eq(H.parseCode(mkCode(v1({ yn: { bands: legitYN.bands, ps: [5, 9] } }))), null, 'false alarms exceed n');
});

test('parseCode rejects malformed yn.bands', () => {
  const withBands = b => H.parseCode(mkCode(v1({ yn: { bands: b, ps: [15, 1] } })));
  eq(withBands('nope'), null, 'bands not an array');
  eq(withBands([[10, 5], [10, 4], [10, 3], [10, 2], [10, 1], [10, 0]]), null, 'more than five bands');
  eq(withBands([[10]]), null, 'a pair of length 1');
  eq(withBands([[10, 5, 2]]), null, 'a triple');
  eq(withBands([[10, 11]]), null, 'more yes answers than items');
  eq(withBands([[-1, 0]]), null, 'negative n');
  eq(withBands([[10, 2.5]]), null, 'non-integer count');
  assert(withBands([[10, 5]]), 'a short-but-valid bands array is still accepted');
});

test('parseCode rejects an mc whose parts do not add up, or that is absurdly large', () => {
  const mc = m => H.parseCode(mkCode(v1({ mode: 'mastery', mc: m })));
  eq(mc({ n: 10, c: 5, w: 2, o: 2 }), null, 'c+w+o !== n');
  eq(mc({ n: 10, c: 5, w: 5, o: 1 }), null, 'c+w+o overshoots n');
  eq(mc({ n: 10 }), null, 'c/w/o missing');
  eq(mc({ n: 10, c: '5', w: 3, o: 2 }), null, 'a string count');
  eq(mc({ n: 10, c: -1, w: 9, o: 2 }), null, 'a negative count');
  eq(mc({ n: 501, c: 501, w: 0, o: 0 }), null, 'n over the 500-item cap');
  eq(H.parseCode(mkCode(v1({ mode: 'mastery', mc: [10, 5, 3, 2] }))), null, 'mc as an array');
});

test('parseCode still accepts valid v1 yn and mc codes unchanged', () => {
  const yn = H.parseCode(mkCode(v1({ yn: legitYN })));
  assert(yn, 'a legit yn code survives');
  eq(yn.yn.bands[0][1], 5); eq(yn.yn.ps[1], 1); eq(yn.mode, 'size');
  const mc = H.parseCode(mkCode(v1({ mode: 'mastery', mc: { n: 10, c: 6, w: 3, o: 1 } })));
  assert(mc, 'a legit mc code survives');
  eq(mc.mc.c, 6); eq(mc.mc.n, 10);
  // a perfect and a zero score are boundary-valid, not malformed
  assert(H.parseCode(mkCode(v1({ mode: 'mastery', mc: { n: 10, c: 10, w: 0, o: 0 } }))), 'all correct');
  assert(H.parseCode(mkCode(v1({ mode: 'mastery', mc: { n: 10, c: 0, w: 0, o: 10 } }))), 'all omitted');
  assert(H.parseCode(mkCode(v1({ yn: { bands: [[10, 0]], ps: [10, 0] } }))), 'all-no is valid');
  assert(H.parseCode(mkCode(v1({ yn: { bands: [[10, 10]], ps: [10, 10] } }))), 'all-yes is valid');
});

test('a payload built by the app itself always survives parseCode', () => {
  // the yn path
  H.run("S={mode:'size',seed:1,name:'Ana',date:'2026-01-01',occ:'T1',items:[],i:0,t0:0,resp:[" +
    "{w:'casa',b:0,t:'real',yes:true,ms:900},{w:'perro',b:1,t:'real',yes:false,ms:800}," +
    "{w:'blerfada',b:-1,t:'pseudo',yes:false,ms:700}]};1");
  assert(H.parseCode(H.payloadFromSession()), 'payloadFromSession (yn) round-trips');
  // the mc path
  H.run("S={mode:'mastery',seed:1,name:'Ana',date:'2026-01-01',occ:'T1',items:[],i:0,t0:0,resp:[" +
    "{w:'casa',b:0,t:'mc',pick:0,correct:true,omit:false,ms:900}," +
    "{w:'perro',b:0,t:'mc',pick:-1,correct:false,omit:true,ms:800}]};1");
  assert(H.parseCode(H.payloadFromSession()), 'payloadFromSession (mc) round-trips');
});

// ---------- (1b) one unreadable record must not take the whole panel down ----------
test('renderDash survives a hand-injected malformed record and still renders the others', () => {
  reset();
  // pushed straight into DASH, bypassing parseCode — this is what a hand-edited localStorage,
  // or a record written by an older/newer build, looks like from renderDash's point of view
  H.run("DASH.push({v:1,name:'Mala',date:'2026-01-01',occ:'T1',mode:'size',yn:{}});1");
  H.run("DASH.push(" + JSON.stringify(v1({ name: 'Ana', yn: legitYN })) + ");1");
  H.run("DASH.push({v:2,name:'SinRes',date:'2026-01-02',occ:'T1',mode:'c500',blk:1});1");
  const html = dashHTML();
  assert(html.indexOf('⚠ registro ilegible') >= 0, 'the unreadable records degrade to a warning row');
  assert(html.indexOf('>Ana<') >= 0, 'the healthy record still renders');
  assert(html.indexOf('Tamaño y cobertura (escrito)') >= 0, 'the size section still renders');
  assert(html.indexOf('id="dashClear"') >= 0, 'the «Vaciar panel» escape hatch is reachable');
  assert(/data-i="0"/.test(html), 'the bad record keeps a delete button so the teacher can remove it');
  reset();
});

test('dashExportCSV skips a malformed record instead of aborting the export', () => {
  reset();
  H.run("DASH.push({v:1,name:'Mala',date:'2026-01-01',occ:'T1',mode:'size',yn:{}});1");
  H.run("DASH.push(" + JSON.stringify(v1({ name: 'Ana', yn: legitYN })) + ");1");
  syncTimers(() => H.dashExportCSV());
  const csv = H.lastBlobText();
  assert(csv.indexOf('Ana') >= 0, 'the healthy record is exported');
  assert(csv.indexOf('Mala') < 0, 'the malformed record is skipped, not exported as NaN');
  reset();
});

// ---------- (2) autofocus must never arm Enter/Space as an answer key ----------
// The DOM stub cannot dispatch a real activation, but it CAN observe focus: makeFake's set trap
// stores the assigned property and the get trap returns it, so overwriting .focus on the cached
// element for a selector spies on exactly the call render()/stepProtocol() make.
const focusSpy = () => {
  H.window.__focused = [];
  H.run("['#stim','#playBtn','#typedIn'].forEach(s=>{$(s).focus=()=>window.__focused.push(s)});1");
  return H.window.__focused;
};

test('render() focuses the #stim prompt, never the “Sí, la conozco” button', () => {
  const seen = focusSpy();
  H.run("S={mode:'size',seed:1,name:'Ana',date:'d',occ:'',items:[{w:'a',b:0,t:'real'},{w:'b',b:0,t:'real'}],i:0,resp:[],t0:0,plays:0};1");
  H.run('render()');
  eq(seen.join(','), '#stim', 'the y/n modes land on the prompt');
  seen.length = 0;
  H.run("S={mode:'mastery',seed:1,name:'Ana',date:'d',occ:'',items:[{w:'a',b:0,opts:['a','b','c','d'],correct:'a'},{w:'b',b:0,opts:['a','b','c','d'],correct:'a'}],i:0,resp:[],t0:0,plays:0};1");
  H.run('render()');
  eq(seen.join(','), '#stim', 'mastery lands on the prompt, not option A');
});

test('render() focuses the play button in listen mode — the only safe first action', () => {
  const seen = focusSpy();
  H.run("S={mode:'listen',seed:1,name:'Ana',date:'d',occ:'',items:[{w:'a',b:0,t:'real',clip:1},{w:'b',b:0,t:'real',clip:2}],i:0,resp:[],t0:0,plays:0};1");
  H.run('render()');
  eq(seen.join(','), '#playBtn', 'listen mode focuses ▶ Escuchar, which cannot record an answer');
});

test('the play button is focusable when it is rendered (not disabled until two plays are spent)', () => {
  const renderSrc = H.run('render.toString()');
  const listen = renderSrc.slice(renderSrc.indexOf("S.mode==='listen'"), renderSrc.indexOf("S.mode==='mastery'"));
  assert(/<button class="play" id="playBtn">/.test(listen), 'playBtn is a real button');
  assert(listen.indexOf('id="playBtn" disabled') < 0, 'it is not born disabled — focus would silently fail');
  assert(/if\(S\.plays>=2\)\{btn\.disabled=true;\}/.test(listen), 'it only becomes disabled after the 2nd play');
});

test('stepProtocol() focuses #stim in the screen and mc phases, and the input in the typed phase', () => {
  const seen = focusSpy();
  const seedProto = q => H.run('S=' + JSON.stringify({
    mode: 'c500', seed: 1, name: 'Ana', date: '2026-01-01', occ: '', blk: 1, form: '',
    queue: q, i: 0, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
  }) + ';S.rnd=mulberry32(1);1');

  seedProto([{ w: 'casa', idx: 0, ph: 'screen' }]);
  H.run('stepProtocol()');
  eq(seen.join(','), '#stim', 'screen phase');

  seen.length = 0;
  seedProto([{ w: 'casa', idx: 0, ph: 'mc', mc: { opts: ['a', 'b', 'c', 'd'], correct: 'a' } }]);
  H.run('stepProtocol()');
  eq(seen.join(','), '#stim', 'mc phase — never option A');

  seen.length = 0;
  seedProto([{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }]);
  H.run('stepProtocol()');
  eq(seen.join(','), '#typedIn', 'the typed phase still focuses its input — typing is the answer there');
});

test('no render path queries an answer control in order to focus it', () => {
  for (const fn of ['render', 'stepProtocol']) {
    const src = H.run(fn + '.toString()');
    assert(src.indexOf("querySelector('.ans,.opt')") < 0, fn + ' must not focus the first .ans/.opt');
  }
});

// ---------- (3) an empty e.key is not an answer ----------
const press = key => H.handleKey({ key, target: { tagName: 'DIV' } });

test("handleKey ignores e.key === '' in the mastery branch ('abcd'.indexOf('') === 0)", () => {
  const seedMastery = () => H.run("S={mode:'mastery',seed:1,name:'Ana',date:'d',occ:'',items:[" +
    "{w:'a',b:0,opts:['a','b','c','d'],correct:'a'},{w:'b',b:0,opts:['a','b','c','d'],correct:'a'}]," +
    "i:0,resp:[],t0:0,plays:0};1");
  seedMastery();
  press('');
  eq(H.run('S.resp.length'), 0, "an empty key must not answer option A");
  press('Enter');
  eq(H.run('S.resp.length'), 0, 'a named key is not an answer either');
  press('a');                                       // positive control: the guard is not a blanket return
  eq(H.run('S.resp.length'), 1, "'a' still answers option A");
  eq(H.run('S.resp[0].pick'), 0);
});

test("handleKey ignores e.key === '' in a protocol mc phase", () => {
  H.run("S={mode:'c500',seed:1,name:'Ana',date:'d',occ:'',blk:1,form:''," +
    "queue:[{w:'casa',idx:0,ph:'mc',mc:{opts:['a','b','c','d'],correct:'a'},fromYes:true}," +
    "{w:'perro',idx:1,ph:'screen'}],i:0,state:{},ps:[0,0],retest:[],t0:0,resp:[]};S.rnd=mulberry32(1);1");
  press('');
  eq(H.run('S.resp.length'), 0, 'an empty key must not answer option A');
  eq(H.run('S.i'), 0, 'the queue must not advance');
  press('a');                                       // positive control
  eq(H.run('S.resp.length'), 1, "'a' still answers");
  eq(H.run('S.state[0]'), 2, 'a correct fromYes probe still verifies the word');
});

test("handleKey ignores e.key === '' in a protocol screen phase and in the y/n modes", () => {
  H.run("S={mode:'c500',seed:1,name:'Ana',date:'d',occ:'',blk:1,form:''," +
    "queue:[{w:'casa',idx:0,ph:'screen'},{w:'perro',idx:1,ph:'screen'}]," +
    "i:0,state:{},ps:[0,0],retest:[],t0:0,resp:[]};S.rnd=mulberry32(1);1");
  press('');
  eq(H.run('S.resp.length'), 0);
  H.run("S={mode:'size',seed:1,name:'Ana',date:'d',occ:'',items:[{w:'a',b:0,t:'real'},{w:'b',b:0,t:'real'}],i:0,resp:[],t0:0,plays:0};1");
  press('');
  eq(H.run('S.resp.length'), 0, 'no sí/no is recorded from an empty key');
  press('s');
  eq(H.run('S.resp.length'), 1, "'s' still records a sí");
});

test('handleKey rejects every non-single-character key up front', () => {
  const src = H.run('handleKey.toString()');
  assert(/if\(k\.length!==1\)return;/.test(src), 'the length guard sits before either answer branch');
  assert(src.indexOf('const k=') < src.indexOf('if(k.length!==1)return;'), 'k is derived first, then guarded');
  assert(src.indexOf('if(k.length!==1)return;') < src.indexOf("PROTO[S.mode]"), 'the guard precedes the protocol branch');
});

// ---------- (4) the DASH invariant: import and reload must agree ----------
const B0 = H.DATA.bands[0].label;   // '1–500' — no comma, so it needs no CSV quoting
// deliberately raw/unquoted, the way pre-M3 exports wrote their rows
const csvRow = (name, mode, item, resp) =>
  [name, '2026-01-01', 'T1', mode, '1', item, B0, 'real', resp, '', '', '900'].join(',');
// the M3-era quoted form, for names that actually need it
const csvRowQ = (name, mode, item, resp) =>
  [name, '2026-01-01', 'T1', mode, '1', item, B0, 'real', resp, '', '', '900'].map(H.q).join(',');
const CSVHEAD = 'student,date,occasion,mode,seed,item,band,type,response,correct,omit,latency_ms';

test('ingestCSV skips a row-group with a blank student name and reports it', () => {
  reset();
  const csv = [CSVHEAD,
    csvRow('Ana', 'size', 'casa', 'si'),
    csvRow('Ana', 'size', 'perro', 'no'),
    csvRow('   ', 'size', 'casa', 'si'),        // whitespace-only name: parseCode would reject it
    csvRow('', 'size', 'perro', 'no')           // and so would an empty one
  ].join('\n') + '\n';
  const r = H.run('ingestText(' + JSON.stringify(csv) + ')');
  eq(r.added, 1, 'only the named student is imported');
  eq(r.bad, 2, 'both nameless groups are counted as unreadable');
  eq(H.run('DASH.length'), 1);
  eq(H.run('DASH[0].name'), 'Ana');
  assert(H.ingestMsg(r).indexOf('ilegible') >= 0, 'the diagnostics message surfaces the skipped groups');
  reset();
});

test('ingestCSV skips a row-group whose mode is not one of the six MODES', () => {
  reset();
  const csv = [CSVHEAD,
    csvRow('Ana', 'size', 'casa', 'si'),
    csvRow('Beto', 'modo-inventado', 'casa', 'si'),
    csvRow('Caro', '<img src=x onerror=1>', 'casa', 'si'),
    csvRow('Dani', '', 'casa', 'si')
  ].join('\n') + '\n';
  const r = H.run('ingestText(' + JSON.stringify(csv) + ')');
  eq(r.added, 1, 'only the valid mode is imported');
  eq(r.bad, 3, 'the three junk modes are counted');
  eq(H.run("DASH.map(r=>r.name).join(',')"), 'Ana');
  reset();
});

test('INVARIANT: every record that enters DASH survives codeFromRec → parseCode', () => {
  reset();
  const csv = [CSVHEAD,
    csvRow('Ana', 'size', 'casa', 'si'),
    csvRow('Ana', 'size', 'perro', 'no'),
    csvRow('  ', 'size', 'casa', 'si'),
    csvRow('Beto', 'basura', 'casa', 'si'),
    csvRow('Caro', 'mastery', 'casa', 'si'),
    csvRowQ('García, Ana', 'listen', 'casa', 'si')   // a quoted name must clear the invariant too
  ].join('\n') + '\n';
  H.run('ingestText(' + JSON.stringify(csv) + ')');
  eq(H.run('DASH.length'), 3, 'the three valid groups imported; the nameless and junk-mode ones did not');
  eq(H.run("DASH.map(r=>r.name).sort().join('|')"), 'Ana|Caro|García, Ana');
  eq(H.run('DASH.every(r=>parseCode(codeFromRec(r))!==null)'), true,
    'a record that cannot be re-read would silently vanish on the next openDash()');
  reset();
});

test('ingestCSV refuses a group parseCode would reject for a reason no field check catches', () => {
  // name and mode are both fine here; it is the derived mc.n (501 > the 500-item cap) that
  // parseCode rejects. Only the codeFromRec→parseCode round-trip guard catches this class.
  reset();
  const rows = [CSVHEAD];
  for (let i = 0; i < 501; i++) rows.push(csvRow('Ana', 'mastery', 'w' + i, 'si'));
  const r = H.run('ingestText(' + JSON.stringify(rows.join('\n') + '\n') + ')');
  eq(r.added, 0, 'the oversized group is not imported');
  eq(r.bad, 1, 'it is reported as unreadable');
  eq(H.run('DASH.length'), 0);
  // and the boundary case one row smaller is still accepted
  reset();
  const ok = [CSVHEAD];
  for (let i = 0; i < 500; i++) ok.push(csvRow('Ana', 'mastery', 'w' + i, 'si'));
  eq(H.run('ingestText(' + JSON.stringify(ok.join('\n') + '\n') + ').added'), 1, '500 items is still valid');
  eq(H.run('DASH.every(r=>parseCode(codeFromRec(r))!==null)'), true);
  reset();
});

test('a record imported from CSV is still there after the localStorage reload round-trip', () => {
  // this is the user-visible symptom the invariant protects against: the record renders all
  // session, then disappears on reopen because loadDash re-ingests it through parseCode
  reset();
  const csv = [CSVHEAD, csvRow('Ana', 'size', 'casa', 'si'), csvRow('Ana', 'size', 'perro', 'no')].join('\n') + '\n';
  H.run('ingestText(' + JSON.stringify(csv) + ')');
  eq(H.run('DASH.length'), 1);
  const stored = H.localStorage.getItem(H.DASHKEY);
  assert(stored && stored.indexOf('VNHS1.') === 0, 'saveDash mirrored it into storage');
  // simulate a fresh page load: empty in-memory panel, same storage
  H.run('DASH.length=0;SEEN.clear();dashLoaded=false;1');
  H.loadDash();
  eq(H.run('DASH.length'), 1, 'the record came back');
  eq(H.run('DASH[0].name'), 'Ana');
  reset();
});

test('a code parseCode rejects never reaches storage in the first place', () => {
  reset();
  const r = H.run('ingestText(' + JSON.stringify(mkCode({ v: 1, mode: 'size', name: 'X', yn: {} })) + ')');
  eq(r.added, 0); eq(r.bad, 1, 'counted as unreadable, not ingested');
  eq(H.run('DASH.length'), 0);
  eq(H.localStorage.getItem(H.DASHKEY), '', 'nothing poisonous was written');
  reset();
});

test('ingestCSV returns a bad count even when the header is unusable', () => {
  // the early-return shape must match the normal one, or ingestText adds undefined to its total
  eq(H.run("JSON.stringify(ingestCSV(['student,date,mode']))"), '{"added":0,"dups":0,"bad":0}');
});

// ---------- (5) splitCSV is RFC-strict about where a quoted field may start ----------
test('splitCSV treats a mid-field quote as a literal character', () => {
  const f = H.splitCSV('a,O"Hara,b');
  eq(f.length, 3, 'the unpaired quote must not swallow the rest of the line');
  eq(f[0], 'a'); eq(f[1], 'O"Hara'); eq(f[2], 'b');
});

test('splitCSV keeps a legacy pre-quoting row with literal quotes intact', () => {
  // exports predating M3 wrote names raw; 'Ana "La Jefa" Ruiz' had no doubling and no wrapper
  const f = H.splitCSV('Ana "La Jefa" Ruiz,2026-01-01,T1,size,1,casa,1–500,real,si,,,900');
  eq(f.length, 12, 'every column is still found');
  eq(f[0], 'Ana "La Jefa" Ruiz', 'the literal quotes survive verbatim');
  eq(f[3], 'size'); eq(f[11], '900');
});

test('splitCSV still parses quoted fields with doubled quotes (M3-era exports)', () => {
  eq(H.splitCSV('"Ana ""La Jefa"" Ruiz",x')[0], 'Ana "La Jefa" Ruiz');
  eq(H.splitCSV('x,"a,b",y')[1], 'a,b', 'a quoted comma is still not a separator');
  eq(H.splitCSV('"solo"')[0], 'solo');
  eq(H.splitCSV('"a""b"')[0], 'a"b');
  const row = ['García, Ana', 'Ana "La Jefa" Ruiz', '501–1,000', '', 'si'];
  eq(H.splitCSV(row.map(H.q).join(',')).join('␟'), row.join('␟'), 'q() → splitCSV still round-trips');
});

test('splitCSV leaves unquoted legacy lines and empty fields alone', () => {
  eq(H.splitCSV('Ana,2026-01-01,T1,size').join('|'), 'Ana|2026-01-01|T1|size');
  eq(H.splitCSV('a,,b').length, 3);
  eq(H.splitCSV('a,,b')[1], '');
  eq(H.splitCSV('').length, 1);
  eq(H.splitCSV(',')[0], ''); eq(H.splitCSV(',').length, 2);
});

test('a CSV whose student name carries a literal quote imports as one group, not a mangled one', () => {
  reset();
  const csv = [CSVHEAD, csvRow('Ana O"Hara', 'size', 'casa', 'si'), csvRow('Ana O"Hara', 'size', 'perro', 'no')].join('\n') + '\n';
  const r = H.run('ingestText(' + JSON.stringify(csv) + ')');
  eq(r.added, 1, 'both rows landed in the same group');
  eq(H.run('DASH[0].name'), 'Ana O"Hara');
  eq(H.run('DASH[0].mode'), 'size', 'the mode column was not swallowed by the quote');
  eq(H.run('DASH[0].yn.bands[0][0]'), 2, 'both items were counted');
  reset();
});

// ---------- (6) the last student-facing English strings ----------
test('the page title is in Spanish', () => {
  assert(RAW.indexOf('Spanish Vocabulary Size &amp; Coverage') < 0, 'the English title is gone');
  assert(RAW.indexOf('<title>Vocabulómetro — Tamaño y cobertura del vocabulario</title>') >= 0);
});

test('the masthead carries no school branding until MASTHEAD names one', () => {
  eq(H.run('MASTHEAD.school'), '', 'no school name by default');
  eq(H.run('MASTHEAD.badge'), '', 'no badge by default');
  assert(RAW.indexOf('id="mastBadge" style="display:none"') >= 0, 'the empty badge starts hidden');
});

test('the two SVG aria-labels are in Spanish', () => {
  assert(SAFE.indexOf('Estimated coverage') < 0, 'meterSVG no longer says "Estimated coverage"');
  assert(SAFE.indexOf('aria-label="Cobertura estimada ') >= 0, 'meterSVG announces coverage in Spanish');
  assert(SAFE.indexOf('CEFR lexical estimate') < 0, 'cefrLadderSVG no longer says "CEFR lexical estimate"');
  assert(SAFE.indexOf('aria-label="Estimación léxica CEFR ') >= 0, 'the CEFR ladder announces in Spanish');
  // the labels are still interpolated, not hard-coded
  assert(/aria-label="Cobertura estimada '\+pct\(cov\)\+'"/.test(SAFE), 'coverage value still interpolated');
  assert(/aria-label="Estimación léxica CEFR '\+c\.pt\.l\+'"/.test(SAFE), 'CEFR level still interpolated');
});

test('#stim is a focusable, live-announced prompt in the static markup', () => {
  assert(/<div class="stimulus" id="stim" aria-live="polite" tabindex="-1"><\/div>/.test(RAW),
    '#stim needs tabindex="-1" to accept the programmatic focus, and keeps its aria-live');
});
