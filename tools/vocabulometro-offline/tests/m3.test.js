// Milestone 3 regression tests: teacher dashboard & data interchange.
const H = require('./harness.js');
const { test, assert, eq, near } = global.__t;

const mkCode = obj => 'VNHS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const legitYN = { bands: [[10, 5], [10, 4], [10, 3], [10, 2], [10, 1]], ps: [15, 1] };
const ingest = text => H.run('ingestText(' + JSON.stringify(text) + ')');

// a clean panel: array, fingerprints and mirrored storage all empty
const reset = () => { H.run('DASH.length=0;SEEN.clear();dashLoaded=true;1'); H.localStorage.clear(); };
const dashHTML = () => { H.renderDash(); return H.run("$('#dashBody').innerHTML"); };
// download()'s revoke is deferred by 1000ms; tests must not wait a real second for it
const syncTimers = fn => {
  const real = global.setTimeout;
  global.setTimeout = f => { f(); return 0; };
  try { return fn(); } finally { global.setTimeout = real; }
};

// a size session spread over all five bands, so estRecord/estFromCounts see a full form
const sizeResp = yes => {
  const r = [];
  for (let b = 0; b < 5; b++) for (let j = 0; j < 10; j++) r.push({ w: 'w' + b + '_' + j, b, t: 'real', yes: j < yes[b], ms: 800 });
  for (let j = 0; j < 10; j++) r.push({ w: 'p' + j, b: -1, t: 'pseudo', yes: j < 1, ms: 700 });
  return r;
};
const seedSize = (name, date, occ, yes) => H.run('S=' + JSON.stringify({
  mode: 'size', seed: 1, name, date, occ, items: [], i: 0, t0: 0, resp: sizeResp(yes)
}) + ';1');

// ---------- (1) RFC-4180 quoting ----------
test('q quotes exactly the values RFC 4180 requires', () => {
  eq(H.q('Ana'), 'Ana', 'a plain value is left alone');
  eq(H.q('García, Ana'), '"García, Ana"');
  eq(H.q('Ana "La Jefa" Ruiz'), '"Ana ""La Jefa"" Ruiz"', 'inner quotes are doubled');
  eq(H.q('línea\nnueva'), '"línea\nnueva"');
  eq(H.q('501–1,000'), '"501–1,000"');
  eq(H.q(null), ''); eq(H.q(undefined), ''); eq(H.q(0), '0'); eq(H.q(false), 'false');
});

test('splitCSV round-trips everything q() produced', () => {
  const row = ['García, Ana', '2026-01-01', 'Ana "La Jefa" Ruiz', '501–1,000', '', 'si', '900'];
  eq(H.splitCSV(row.map(H.q).join(',')).join('␟'), row.join('␟'));
});

test('splitCSV parses unquoted legacy lines unchanged', () => {
  eq(H.splitCSV('Ana,2026-01-01,T1,size').join('|'), 'Ana|2026-01-01|T1|size');
  eq(H.splitCSV('a,,b').length, 3);
  eq(H.splitCSV('a,,b')[1], '', 'an empty field stays empty');
  eq(H.splitCSV('').length, 1, 'an empty line is one empty field');
  eq(H.splitCSV('"solo"')[0], 'solo');
  eq(H.splitCSV('x,"a,b",y')[1], 'a,b', 'a quoted comma is not a separator');
});

test('san is gone: no exporter strips commas out of a field any more', () => {
  for (const f of ['exportCSV', 'dashExportCSV']) {
    assert(H.run(f + '.toString()').indexOf('san(') < 0, f + ' must not use san()');
  }
  eq(H.run('typeof san'), 'undefined', 'san is retired');
});

test('exportCSV quotes a comma name and the band label instead of mangling them', () => {
  seedSize('García, Ana', '2026-01-01', 'T1', [9, 7, 5, 3, 1]);
  H.exportCSV();
  const lines = H.lastBlobText().trim().split('\n');
  const cells = H.splitCSV(lines[1]);
  eq(cells.length, lines[0].split(',').length, 'row width matches the header');
  eq(cells[0], 'García, Ana', 'the name survives verbatim');
  const band1 = H.splitCSV(lines.find(l => l.indexOf('w1_0') >= 0))[6];
  eq(band1, H.DATA.bands[1].label, 'the band label round-trips with its comma');
  assert(H.DATA.bands[1].label.indexOf(',') >= 0, 'the fixture label really does contain a comma');
});

// ---------- (2) export -> ingest round trip, and nameKey-consistent pairing ----------
test('a comma name survives export -> ingest and matches her code record in paired growth', () => {
  reset();
  seedSize('García, Ana', '2026-01-01', 'T1', [8, 6, 4, 2, 1]);
  H.exportCSV();
  const csv = H.lastBlobText();
  assert(csv.indexOf('"García, Ana"') >= 0, 'the export quoted her name');
  eq(ingest(csv).added, 1, 'the CSV ingests as one record');
  eq(H.run('DASH[0].name'), 'García, Ana', 'the comma is not lost on the way back in');
  eq(H.run('DASH[0].yn.bands[1][0]'), 10, 'band-2 rows found their band despite the quoted label');
  eq(H.run('DASH[0].yn.bands[1][1]'), 6);

  // the same student, later, arriving as a pasted result code with sloppy whitespace
  eq(ingest(mkCode({
    v: 1, name: '  García,   Ana ', date: '2026-06-01', occ: 'T3', mode: 'size',
    yn: { bands: [[10, 10], [10, 9], [10, 7], [10, 5], [10, 3]], ps: [10, 1] }
  })).added, 1);

  const html = dashHTML();
  const growth = html.slice(html.indexOf('Crecimiento pareado'));
  assert(html.indexOf('Crecimiento pareado') >= 0, 'the paired-growth block rendered');
  assert(growth.indexOf('n=1 parejas') >= 0, 'she is matched across the two occasions, not dropped');
  assert(growth.indexOf('García, Ana') >= 0, 'and named in the per-student table');
});

test('nameKey collapses trim / internal whitespace / case into one key', () => {
  eq(H.nameKey('  García,   Ana '), 'garcía, ana');
  eq(H.nameKey('GARCÍA, ANA'), H.nameKey('garcía, ana'));
  eq(H.nameKey('Ana\tMaría'), 'ana maría', 'tabs collapse too');
  eq(H.nameKey(null), ''); eq(H.nameKey(undefined), '');
});

test('ledger folds sloppy whitespace variants of a name into one student', () => {
  reset();
  H.run("DASH.push({v:2,name:'  García,  Ana ',date:'2026-01-01',occ:'',mode:'c500',blk:1,res:[[1,2]],ps:[4,0]},"
    + "{v:2,name:'García, Ana',date:'2026-01-02',occ:'',mode:'c500',blk:2,res:[[2,2]],ps:[4,0]})");
  const L = H.ledger();
  eq(Object.keys(L).length, 1, 'one student, not two');
  eq(Object.keys(L['garcía, ana'].pas).length, 2, 'both blocks land in the same ledger entry');
});

test('the paired-growth map and ledger use the same key helper', () => {
  for (const f of ['ledger', 'renderDash']) {
    const src = H.run(f + '.toString()');
    assert(src.indexOf('nameKey(') >= 0, f + ' must build its keys with nameKey');
    assert(!/name\.trim\(\)\.toLowerCase\(\)/.test(src), f + ' still has an ad-hoc key');
  }
});

// ---------- (1b) legacy CSVs ----------
test('a legacy comma-stripped CSV still ingests', () => {
  reset();
  const legacy = H.DATA.bands[1].label.replace(/,/g, ' ');   // '501–1 000'
  eq(legacy.indexOf(','), -1, 'the legacy variant really is comma-free');
  const csv = 'student,date,occasion,mode,seed,item,band,type,response,correct,omit,latency_ms\n' +
    'Ana,2026-01-01,T1,size,1,casa,' + legacy + ',real,si,,,900\n' +
    'Ana,2026-01-01,T1,size,1,perro,' + legacy + ',real,no,,,800\n' +
    'Ana,2026-01-01,T1,size,1,blerfada,pseudo,pseudo,no,,,700\n';
  eq(ingest(csv).added, 1);
  eq(H.run('DASH[0].yn.bands[1][0]'), 2, 'both rows matched the legacy label');
  eq(H.run('DASH[0].yn.bands[1][1]'), 1);
  eq(H.run('DASH[0].yn.ps[0]'), 1);
});

// ---------- (3) regex code extraction ----------
test('ingestText finds a code buried in a Google-Form response row', () => {
  reset();
  const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  const sheet = 'Marca temporal,Nombre,Código\n2026-01-01 10:00:00,Ana,"' + code + '"\n';
  const r = ingest(sheet);
  eq(r.added, 1, 'the third-column code is picked up');
  eq(r.bad, 0);
  eq(H.run('DASH.length'), 1, 'and the Google-Form header did not also fire the student-CSV branch');
  eq(H.run('DASH[0].name'), 'Ana');
});

test('ingestText finds codes indented or wrapped by a chat app', () => {
  reset();
  const a = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  const b = mkCode({ v: 1, name: 'Bo', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  eq(ingest('    ' + a + '\n> Bo escribió: ' + b + ' — ¡listo!').added, 2);
  eq(H.run("DASH.map(r=>r.name).join('|')"), 'Ana|Bo');
});

test('ingestText no longer keys off a line-leading VNHS1 prefix', () => {
  assert(H.run('ingestText.toString()').indexOf("startsWith('VNHS1.')") < 0, 'the prefix filter is gone');
});

// ---------- (4) duplicate detection & bad-code counting ----------
test('ingestText skips duplicates, including ones repeated inside one paste', () => {
  reset();
  const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  const r = ingest(code + '\n' + code + '\n' + code);
  eq(r.added, 1); eq(r.dups, 2); eq(r.bad, 0);
  eq(H.run('DASH.length'), 1);
  const r2 = ingest(code);
  eq(r2.added, 0); eq(r2.dups, 1, 'a later paste of the same code is still a duplicate');
});

test('ingestText counts a truncated code as unreadable rather than silently dropping it', () => {
  reset();
  const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  const r = ingest(code.slice(0, code.length - 12) + '\n' + code);
  eq(r.added, 1); eq(r.bad, 1, 'the wrapped/truncated half-code is reported'); eq(r.dups, 0);
});

test('a v3 plan code in the paste is neither imported nor reported as broken', () => {
  reset();
  const r = ingest(mkCode({ v: 3, words: [1, 2, 3], np: 12, poff: 0 }));
  eq(r.added, 0); eq(r.dups, 0); eq(r.bad, 0);
  eq(H.run('DASH.length'), 0);
});

test('CSV-derived records dedupe on their canonical fingerprint', () => {
  reset();
  const csv = 'student,date,occasion,mode,seed,item,band,type,response,correct,omit,latency_ms\n' +
    'Ana,2026-01-01,T1,size,1,casa,' + H.DATA.bands[0].label + ',real,si,,,900\n';
  eq(ingest(csv).added, 1);
  const again = ingest(csv);
  eq(again.added, 0); eq(again.dups, 1, 'the same file imported twice adds nothing');
  eq(H.run('DASH.length'), 1);
});

// M5 widened `bad` to cover CSV row-groups parseCode would reject, so the wording is generic
// ("registro ilegible") instead of assuming a truncated code.
test('ingestMsg composes the message and omits the zero parts', () => {
  eq(H.ingestMsg({ added: 3, dups: 2, bad: 1 }),
    '3 añadidos · 2 duplicados omitidos · 1 registro ilegible omitido (código truncado o fila sin estudiante/modo válido)');
  eq(H.ingestMsg({ added: 1, dups: 0, bad: 0 }), '1 añadido');
  eq(H.ingestMsg({ added: 0, dups: 1, bad: 0 }), '1 duplicado omitido');
  eq(H.ingestMsg({ added: 0, dups: 0, bad: 2 }),
    '2 registros ilegibles omitidos (código truncado o fila sin estudiante/modo válido)');
  eq(H.ingestMsg({ added: 0, dups: 0, bad: 0 }), 'Nada que importar.');
});

test('deleting a record forgets its fingerprint so it can be re-ingested', () => {
  reset();
  const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  eq(ingest(code).added, 1);
  eq(ingest(code).dups, 1, 'still deduped while it is in the panel');
  H.dashDelete(0);
  eq(H.run('DASH.length'), 0);
  eq(ingest(code).added, 1, 're-ingest after a delete must work');
  eq(H.run('DASH.length'), 1);
});

test('the delete handler goes through dashDelete', () => {
  const src = H.run('renderDash.toString()');
  assert(/rec-del[\s\S]{0,140}dashDelete\(/.test(src), 'the × button must call dashDelete');
});

// ---------- (5) dash persistence ----------
test('every ingest mirrors the panel to localStorage', () => {
  reset();
  const code = mkCode({ v: 1, name: 'García, Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  eq(ingest(code).added, 1);
  const saved = H.localStorage.getItem(H.DASHKEY);
  assert(saved && saved.indexOf('VNHS1.') === 0, 'the panel is stored as newline-joined codes, got ' + saved);
  eq(saved.split('\n').length, 1);
  H.dashDelete(0);
  eq(H.localStorage.getItem(H.DASHKEY), '', 'the delete is persisted too');
});

test('openDash restores the stored panel exactly once', () => {
  reset();
  const code = mkCode({ v: 1, name: 'García, Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  eq(ingest(code).added, 1);
  // a fresh tab: the array and fingerprints are gone, the storage entry is not
  H.run('DASH.length=0;SEEN.clear();dashLoaded=false;1');
  H.openDash();
  eq(H.run('DASH.length'), 1, 'openDash restored the record');
  eq(H.run('DASH[0].name'), 'García, Ana', 'through the same parseCode path');
  H.openDash();
  eq(H.run('DASH.length'), 1, 'a second openDash must not duplicate it');
});

test('Vaciar panel clears the array, the fingerprints and the storage key', () => {
  reset();
  const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
  ingest(code);
  H.window.confirm = () => false;
  H.dashClearAll();
  eq(H.run('DASH.length'), 1, 'a declined confirm changes nothing');
  H.window.confirm = () => true;
  H.dashClearAll();
  eq(H.run('DASH.length'), 0);
  eq(H.localStorage.getItem(H.DASHKEY), null, 'the storage key is removed');
  eq(ingest(code).added, 1, 'the fingerprint set was cleared too');
});

test('a throwing localStorage leaves the panel behaving exactly as before', () => {
  reset();
  const boom = () => { throw new Error('SecurityError: file:// origin'); };
  const real = ['getItem', 'setItem', 'removeItem'].map(k => [k, H.localStorage[k]]);
  for (const [k] of real) H.localStorage[k] = boom;
  try {
    H.run('dashLoaded=false;1');
    H.openDash();                                        // loadDash must swallow the throw
    const code = mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN });
    eq(ingest(code).added, 1, 'ingest still works without storage');   // saveDash must swallow it
    H.dashDelete(0);
    eq(H.run('DASH.length'), 0);
    H.dashClearAll();                                    // removeItem must swallow it
  } finally { for (const [k, v] of real) H.localStorage[k] = v; }
});

test('the panel note no longer claims the dashboard dies with the tab', () => {
  reset();
  ingest(mkCode({ v: 1, name: 'Ana', date: '2026-01-01', occ: 'T1', mode: 'size', yn: legitYN }));
  const html = dashHTML();
  assert(html.indexOf('Vaciar panel') >= 0, 'the Vaciar panel button is rendered');
  assert(html.indexOf('vive solo en memoria') < 0, 'the memory-only claim is gone');
  assert(html.indexOf('se guarda localmente en este navegador') >= 0, 'the note says it is saved locally');
});

// ---------- (6) ledger same-date tie ----------
const twoRecs = (a, b) => {
  reset();
  H.run('DASH.push(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')');
  return H.ledger()['ana'];
};
const rec = (date, mode, i, s) => ({ v: 2, name: 'Ana', date, occ: '', mode, blk: 1, res: [[i, s]], ps: [0, 0] });

test('a same-day claimed record cannot demote a verified word', () => {
  eq(twoRecs(rec('2026-01-01', 'c500', 5, 2), rec('2026-01-01', 's5000', 5, 1)).pas[5], 2, 'verified first');
  eq(twoRecs(rec('2026-01-01', 's5000', 5, 1), rec('2026-01-01', 'c500', 5, 2)).pas[5], 2, 'verified second');
});

test('a strictly later date still wins, downgrades included', () => {
  const st = twoRecs(rec('2026-01-01', 'c500', 5, 2), rec('2026-06-01', 'c500', 5, 0));
  eq(st.pas[5], 0, 'a later retest showing the word is gone must win');
  eq(st.pasDate[5], '2026-06-01');
  const back = twoRecs(rec('2026-06-01', 'c500', 5, 0), rec('2026-01-01', 'c500', 5, 2));
  eq(back.pas[5], 0, 'and paste order does not change that');
  eq(back.pasDate[5], '2026-06-01');
});

test('the a500 branch follows the same date rules', () => {
  eq(twoRecs(rec('2026-01-01', 'a500', 5, 3), rec('2026-01-01', 'a500', 5, 0)).act[5], 3, 'same day keeps the max');
  const st = twoRecs(rec('2026-01-01', 'a500', 5, 3), rec('2026-06-01', 'a500', 5, 0));
  eq(st.act[5], 0, 'later date downgrades');
  eq(st.actDate[5], '2026-06-01');
});

test('ledger no longer uses the >= comparison that let paste order decide', () => {
  assert(H.run('ledger.toString()').indexOf('>=st.pasDate') < 0, 'the >= tie-break is gone');
  assert(H.run('ledger.toString()').indexOf('>=st.actDate') < 0);
});

// ---------- (7) mastery occasion order ----------
test('the mastery occasion table is ordered by date, not alphabetically', () => {
  reset();
  // alphabetical order (Abril, Zafra) is the opposite of chronological order (Zafra, Abril)
  H.run("DASH.push({v:1,name:'Ana',date:'2026-04-20',occ:'Abril',mode:'mastery',mc:{n:20,c:18,w:2,o:0}},"
    + "{v:1,name:'Ana',date:'2026-01-15',occ:'Zafra',mode:'mastery',mc:{n:20,c:10,w:10,o:0}})");
  const html = dashHTML();
  const sec = html.slice(html.indexOf('Dominio Top 500 · por ocasión'));
  assert(sec.indexOf('Zafra') >= 0 && sec.indexOf('Abril') >= 0, 'both occasions rendered');
  assert(sec.indexOf('Zafra') < sec.indexOf('Abril'), 'the January occasion must come first');
});

// ---------- (8) plan button hardening ----------
const emptySt = { name: 'Ana', pas: {}, act: {}, pasDate: {}, actDate: {}, ps: [0, 0], events: [] };
const realSt = () => {
  const pas = {}; const ones = { 2: 10, 3: 6, 4: 4 };
  for (const b of [2, 3, 4]) for (let j = 0; j < 45; j++) pas[H.BANDOFF[b] + j] = j < ones[b] ? 1 : 0;
  return { name: 'Ana', pas, act: {}, pasDate: {}, actDate: {}, ps: [20, 1], events: [] };
};
const withClipboard = (impl, fn) => {
  const had = 'clipboard' in H.navigator, old = H.navigator.clipboard;
  H.navigator.clipboard = impl;
  H.window.lastPrompt = null;
  try { return fn(); } finally { if (had) H.navigator.clipboard = old; else delete H.navigator.clipboard; }
};

test('buildPlan returns null for a student with no passive data', () => {
  eq(H.buildPlan(emptySt), null);
  eq(H.buildPlan(undefined), null, 'a missing ledger entry is not a crash');
  assert(H.buildPlan(realSt()).startsWith('VNHS1.'), 'a real ledger still yields a plan');
});

test('the Plan button says "Sin datos pasivos" instead of emitting a meaningless plan', () => {
  const b = { textContent: 'Plan' };
  withClipboard({ writeText: () => { throw new Error('must not be reached'); } }, () => syncTimers(() => H.planClick(b, emptySt)));
  assert(H.window.lastPrompt === null, 'no clipboard work at all');
});

test('the Plan button only claims "copiado" once writeText resolves', () => {
  const st = realSt();
  const pending = { textContent: 'Plan' };
  withClipboard({ writeText: () => ({ then() { /* never settles */ } }) }, () => H.planClick(pending, st));
  eq(pending.textContent, 'Plan', 'an unsettled write must not show ✓');

  const okBtn = { textContent: 'Plan' };
  withClipboard({ writeText: () => ({ then: ok => ok() }) }, () => syncTimers(() => H.planClick(okBtn, st)));
  eq(okBtn.textContent, 'Plan', 'the reset timer fired; the ✓ was shown on resolve');
  assert(H.window.lastPrompt === null, 'a successful copy needs no prompt');
});

test('a rejected or absent clipboard falls back to window.prompt', () => {
  const st = realSt(), code = H.buildPlan(st);

  const rejBtn = { textContent: 'Plan' };
  withClipboard({ writeText: () => ({ then: (ok, no) => no(new Error('NotAllowedError')) }) },
    () => syncTimers(() => H.planClick(rejBtn, st)));
  eq(H.window.lastPrompt[1], code, 'the rejected write prompts with the plan code');
  assert(rejBtn.textContent.indexOf('✓') < 0, 'and never claims success');

  const noneBtn = { textContent: 'Plan' };
  withClipboard(undefined, () => syncTimers(() => H.planClick(noneBtn, st)));
  eq(H.window.lastPrompt[1], code, 'no clipboard API at all still prompts');
  assert(noneBtn.textContent.indexOf('✓') < 0);

  const oddBtn = { textContent: 'Plan' };
  withClipboard({ writeText: () => undefined }, () => syncTimers(() => H.planClick(oddBtn, st)));
  eq(H.window.lastPrompt[1], code, 'a non-thenable writeText prompts too');
});

// ---------- (9) #planIn is cleared once a plan is consumed ----------
test('a plan-driven sondeo clears #planIn so the next student cannot inherit it', () => {
  const plan = H.buildPlan(realSt());
  H.run("$('#planIn').value=" + JSON.stringify(plan));
  try {
    H.run("startProtocol('s5000',{name:'Ana',date:'2026-01-01',occ:'',seed:3})");
    eq(H.run('S.blk'), 'P', 'the plan really was consumed');
    eq(H.run("$('#planIn').value"), '', 'the field is emptied');
  } finally { H.run("$('#planIn').value=''"); }
});

// ---------- (10) blob URL revocation ----------
test('exportCSV and dashExportCSV revoke the object URLs they create', () => {
  reset();
  H.run("DASH.push({v:1,name:'Ana',date:'2026-01-01',occ:'T1',mode:'size',yn:" + JSON.stringify(legitYN) + '})');
  const c0 = H.URLStub.created.length, r0 = H.URLStub.revoked.length;
  syncTimers(() => { seedSize('Ana', '2026-01-01', 'T1', [8, 6, 4, 2, 1]); H.exportCSV(); H.dashExportCSV(); });
  eq(H.URLStub.created.length - c0, 2, 'two object URLs created');
  eq(H.URLStub.revoked.length - r0, 2, 'both revoked');
  eq(H.URLStub.revoked.slice(-2).join('|'), H.URLStub.created.slice(-2).join('|'), 'the URLs revoked are the ones created');
});

test('no exporter builds an object URL outside the revoking helper', () => {
  for (const f of ['exportCSV', 'dashExportCSV', 'renderDash']) {
    assert(H.run(f + '.toString()').indexOf('createObjectURL') < 0, f + ' must go through download()');
  }
  assert(H.run('download.toString()').indexOf('revokeObjectURL') >= 0, 'download() revokes');
  assert(/dashCodes[\s\S]{0,120}download\(/.test(H.run('renderDash.toString()')), 'the codes backup uses download() too');
});

// ---------- (11) mastery clamp bias ----------
test('estRecord returns a below-chance corrected mastery unclamped', () => {
  const e = H.estRecord({ mode: 'mastery', mc: { n: 20, c: 4, w: 16, o: 0 } });
  near(e.mast, (4 - 16 / 3) / 20, 1e-12, 'the raw corrected proportion');
  assert(e.mast < 0, 'a below-chance draw stays negative, got ' + e.mast);
  assert(Number.isFinite(e.seM) && e.seM > 0, 'seM unchanged');
});

test('the records table clamps a single student, so nobody reads a negative percentage', () => {
  reset();
  H.run("DASH.push({v:1,name:'Ana',date:'2026-01-01',occ:'T1',mode:'mastery',mc:{n:20,c:4,w:16,o:0}})");
  const html = dashHTML();
  assert(html.indexOf('0% dominio') >= 0, 'the individual summary is clamped to 0%');
  assert(html.indexOf('-7% dominio') < 0, 'and never shows the raw negative');
});

test('the class occasion mean and dashExportCSV aggregate the unclamped values', () => {
  reset();
  H.run("DASH.push({v:1,name:'Ana',date:'2026-01-01',occ:'T1',mode:'mastery',mc:{n:20,c:4,w:16,o:0}},"
    + "{v:1,name:'Bo',date:'2026-01-01',occ:'T1',mode:'mastery',mc:{n:20,c:20,w:0,o:0}})");
  const want = (((4 - 16 / 3) / 20) + 1) / 2;
  H.dashExportCSV();
  const row = H.lastBlobText().split('\n').find(l => l.indexOf('occasion_mean,mastery') === 0);
  assert(row, 'the occasion_mean row is emitted');
  near(+H.splitCSV(row)[8], want, 1e-4, 'the mean uses the unclamped values');
  assert(want < (0 + 1) / 2, 'clamping first would have biased this mean upward');

  const ana = H.lastBlobText().split('\n').find(l => l.indexOf('Ana') >= 0);
  assert(+H.splitCSV(ana)[8] < 0, 'the per-student CSV row is unclamped too');
});

// ---------- (12) pseudo ring overlap is documented, not silently changed ----------
test('buildPlan still rings poff over 660 and says why', () => {
  const src = H.run('buildPlan.toString()');
  assert(src.indexOf('poff:st.ps[0]%660') >= 0, 'the arithmetic is unchanged');
  assert(/660[\s\S]{0,200}pseudo/i.test(src.slice(src.indexOf('// poff'))), 'a comment explains the accepted overlap');
  assert(src.indexOf('f-bias is accepted') >= 0, 'and names the accepted bias');
});
