// Milestone 2 regression tests: input hardening & test-flow fixes.
const H = require('./harness.js');
const { test, assert, eq } = global.__t;

const FILE = require('fs')
  .readFileSync(process.env.VOCABULOMETRO_HTML || require('path').join(__dirname, '..', 'vocabulometro.html'), 'utf8');
// page markup only (everything before <script> — never touches the DATA/AUDIO blobs)
const HEAD = FILE.split('<script>')[0];

// a plain keydown event; t0 is pushed into the past so the 250ms lockout is never the reason a test passes
const ev = (key, extra) => Object.assign(
  { key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY' } }, extra);
const ready = () => H.run('S.t0=performance.now()-1000;1');

const seedProto = extra => {
  H.run('S=' + JSON.stringify(Object.assign({
    mode: 's5000', seed: 1, name: 'Ana', date: '2026-01-01', occ: '',
    blk: 1, form: '', i: 0, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
  }, extra)) + ';S.rnd=mulberry32(1);1');
  ready();
};
const seedClassic = (mode, items, extra) => {
  H.run('S=' + JSON.stringify(Object.assign({
    mode, seed: 1, name: 'Ana', date: '2026-01-01', occ: '', items, i: 0, resp: [], t0: 0, plays: 0
  }, extra)) + ';1');
  ready();
};

// ---------- (1) norm(): restore ñ before stripping combining marks ----------
test('norm keeps ñ instead of flattening it to n', () => {
  eq(H.norm('año'), 'año');
  eq(H.norm('ano'), 'ano');
  assert(H.norm('año') !== H.norm('ano'), 'año and ano must not normalise to the same string');
});

test('norm still strips ordinary accents', () => {
  eq(H.norm('sí'), 'si');
  eq(H.norm('llegó'), 'llego');
  eq(H.norm('  ESDRÚJULA '), 'esdrujula');
});

test('norm handles a precomposed and a decomposed ñ identically', () => {
  eq(H.norm('año'), H.norm('año'));
});

test('acceptActive no longer accepts the ñ-less spelling of a ñ word', () => {
  const w = H.DATA.bands[0].words.find(x => /ñ/.test(x));
  assert(w, 'corpus has at least one ñ word');
  assert(H.acceptActive(w, w), 'exact spelling accepted');
  assert(!H.acceptActive(w.replace(/ñ/g, 'n'), w), w.replace(/ñ/g, 'n') + ' must not pass for ' + w);
});

// ---------- (2) handleKey dispatch ----------
test('handleKey answers a protocol screen item with s / n', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
  H.handleKey(ev('s'));
  eq(H.run('S.state[9]'), 1, 's must claim the word');
  eq(H.run('S.i'), 1, 'and advance');

  seedProto({ queue: [{ w: H.ALLWORDS[11], idx: 11, ph: 'screen' }] });
  H.handleKey(ev('n'));
  eq(H.run('S.state[11]'), 0, 'n must record a tested-and-failed word');
  eq(H.run('S.i'), 1);
});

test('handleKey ignores auto-repeat (holding S must not answer a run of items)', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
  H.handleKey(ev('s', { repeat: true }));
  eq(H.run('S.i'), 0, 'no advance');
  eq(H.run('JSON.stringify(S.state)'), '{}', 'no state recorded');
});

test('handleKey ignores modified keys (Cmd+S is save, not sí)', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
    seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
    H.handleKey(ev('s', { [mod]: true }));
    eq(H.run('S.i'), 0, mod + ' must suppress the answer');
    eq(H.run('JSON.stringify(S.state)'), '{}', mod + ' must record nothing');
  }
});

test('handleKey ignores keystrokes typed into a form field', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    H.handleKey(ev('s', { target: { tagName } }));
    eq(H.run('S.i'), 0, tagName + ' must swallow the key');
  }
});

test('handleKey on a typed-phase item does nothing and does not throw', () => {
  seedProto({ mode: 'a500', form: 'A', queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'typed' }] });
  H.handleKey(ev('s'));            // used to reach answerYN → S.items undefined → TypeError
  H.handleKey(ev('n'));
  H.handleKey(ev('a'));
  eq(H.run('S.i'), 0, 'typed items are answered by the input\'s own Enter listener');
  eq(H.run('S.resp.length'), 0);
});

test('handleKey maps a-d to protoMC on a protocol mc item', () => {
  seedProto({
    mode: 'c500',
    queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'mc', fromYes: true, mc: { opts: ['a', 'b', 'c', 'd'], correct: 'c' } }]
  });
  H.handleKey(ev('c'));
  eq(H.run('S.state[7]'), 2, 'correct option verifies the word');
  eq(H.run('S.i'), 1);
});

test('handleKey survives a protocol queue that has run past its end', () => {
  seedProto({ queue: [] });
  H.handleKey(ev('s'));
  eq(H.run('S.i'), 0);
});

test('handleKey answers classic mastery with a-d and 0/x, guarding the option count', () => {
  const opts = ['uno', 'dos', 'tres', 'cuatro'];
  seedClassic('mastery', [{ w: 'casa', b: 0, t: 'mc', opts, correct: 'tres' },
                          { w: 'perro', b: 0, t: 'mc', opts, correct: 'uno' }]);
  H.handleKey(ev('c'));
  eq(H.run('S.resp[0].correct'), true);
  eq(H.run('S.i'), 1);
  ready();
  H.handleKey(ev('x'));
  eq(H.run('S.resp[1].omit'), true, '0/x is a neutral omit');
});

test('handleKey answers classic size items with s / n', () => {
  seedClassic('size', [{ w: 'casa', b: 0, t: 'real' }, { w: 'perro', b: 0, t: 'real' }]);
  H.handleKey(ev('s'));
  eq(H.run('S.resp[0].yes'), true);
  eq(H.run('S.i'), 1);
});

test('handleKey refuses to answer a listen item that has not been played', () => {
  seedClassic('listen', [{ w: 'casa', b: 0, t: 'real', clip: 0 }, { w: 'perro', b: 0, t: 'real', clip: 1 }]);
  H.handleKey(ev('s'));
  eq(H.run('S.resp.length'), 0, 'zero plays → no answer');
  H.run('S.plays=1');
  H.handleKey(ev('s'));
  eq(H.run('S.resp.length'), 1, 'after a play the key works');
});

test('handleKey is a no-op with no session', () => {
  H.run('S=null');
  H.handleKey(ev('s'));       // must not throw
  seedClassic('size', [{ w: 'casa', b: 0, t: 'real' }]);
});

// ---------- (3) 250ms answer lockout ----------
test('answerYN ignores anything within 250ms of the item appearing', () => {
  seedClassic('size', [{ w: 'casa', b: 0, t: 'real' }, { w: 'perro', b: 0, t: 'real' }]);
  H.run('S.t0=performance.now()');
  H.run('answerYN(true)');
  eq(H.run('S.resp.length'), 0, 'answer inside the lockout is dropped');
  eq(H.run('S.i'), 0, 'and the item is not advanced');
  H.run('S.t0=performance.now()-1000;answerYN(true)');
  eq(H.run('S.resp.length'), 1, 'answer after the lockout is recorded');
});

test('answerMC ignores anything within the lockout', () => {
  const opts = ['uno', 'dos', 'tres', 'cuatro'];
  seedClassic('mastery', [{ w: 'casa', b: 0, t: 'mc', opts, correct: 'uno' },
                          { w: 'perro', b: 0, t: 'mc', opts, correct: 'uno' }]);
  H.run('S.t0=performance.now()');
  H.run('answerMC(0)');
  eq(H.run('S.resp.length'), 0);
  H.run('S.t0=performance.now()-1000;answerMC(0)');
  eq(H.run('S.resp.length'), 1);
});

test('protoScreen / protoMC / protoTyped all honour the lockout', () => {
  seedProto({ queue: [{ w: H.ALLWORDS[9], idx: 9, ph: 'screen' }] });
  H.run('S.t0=performance.now();protoScreen(true)');
  eq(H.run('S.i'), 0);
  eq(H.run('JSON.stringify(S.state)'), '{}');

  seedProto({ mode: 'c500', queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'mc', fromYes: true, mc: { opts: ['a', 'b', 'c', 'd'], correct: 'a' } }] });
  H.run('S.t0=performance.now();protoMC(0)');
  eq(H.run('S.i'), 0);

  seedProto({ mode: 'a500', form: 'A', queue: [{ w: H.ALLWORDS[7], idx: 7, ph: 'typed' }] });
  H.run("S.t0=performance.now();protoTyped('')");
  eq(H.run('S.i'), 0);
  eq(H.run('S.resp.length'), 0);
});

test('the typed-input Enter listener drops auto-repeat', () => {
  const src = H.run('stepProtocol.toString()');
  assert(/Enter'\s*&&\s*!e\.repeat/.test(src), 'Enter handler must guard e.repeat, got: ' + src.slice(src.indexOf('Enter') - 40, src.indexOf('Enter') + 60));
});

// ---------- (4) listen mode ----------
test('playClip caches one Audio per clip instead of building a new one per play', () => {
  H.run('for(const k in CLIPS)delete CLIPS[k];playing=null;1');
  H.run('playClip(3)');
  const a = H.run('CLIPS[3]');
  H.run('playClip(3)');
  assert(H.run('CLIPS[3]') === a, 'same clip index must reuse the same Audio object');
  eq(a.playCount, 2, 'both plays went through the one cached Audio');
});

test('playClip pauses and rewinds the clip that was already playing', () => {
  H.run('for(const k in CLIPS)delete CLIPS[k];playing=null;1');
  H.run('playClip(3)');
  const a = H.run('CLIPS[3]');
  a.currentTime = 5;
  H.run('playClip(4)');
  assert(a.paused, 'previous clip paused');
  eq(a.currentTime, 0, 'previous clip rewound');
  assert(H.run('CLIPS[4]') !== a, 'a different index gets its own Audio');
  assert(H.run('playing') === H.run('CLIPS[4]'), 'playing tracks the current clip');
});

test('playClip swallows an autoplay rejection instead of raising', () => {
  H.run('for(const k in CLIPS)delete CLIPS[k];playing=null;1');
  H.run('playClip(1);CLIPS[1].play=()=>Promise.reject(new Error("NotAllowedError"))');
  H.run('playClip(1)');   // .catch(()=>{}) — an unhandled rejection here would fail the run
});

test('answerYN stops the clip when it advances to the next item', () => {
  H.run('for(const k in CLIPS)delete CLIPS[k];playing=null;1');
  seedClassic('listen', [{ w: 'casa', b: 0, t: 'real', clip: 0 }, { w: 'perro', b: 0, t: 'real', clip: 1 }], { plays: 1 });
  H.run('playClip(0)');
  H.run('answerYN(true)');
  assert(H.run('playing') === null, 'advancing must silence the previous clip');
});

test('answerYN records the play count on listen rows only', () => {
  seedClassic('listen', [{ w: 'casa', b: 0, t: 'real', clip: 0 }, { w: 'perro', b: 0, t: 'real', clip: 1 }], { plays: 2 });
  H.run('answerYN(true)');
  eq(H.run('S.resp[0].plays'), 2);
  seedClassic('size', [{ w: 'casa', b: 0, t: 'real' }, { w: 'perro', b: 0, t: 'real' }]);
  H.run('answerYN(true)');
  eq(H.run("'plays' in S.resp[0]"), false, 'non-listen rows carry no plays field');
});

test('render disables the yes/no buttons on a listen item until the first play', () => {
  // the DOM stub cannot observe a live button's disabled flag, so assert on the source instead
  const src = H.run('render.toString()');
  const listen = src.slice(src.indexOf("S.mode==='listen'"), src.indexOf("S.mode==='mastery'"));
  assert(/ynOn\(false\)/.test(listen), 'buttons start disabled');
  assert(/ynOn\(true\)/.test(listen), 'and are enabled inside the play click handler');
  assert(listen.indexOf('ynOn(false)') < listen.indexOf("addEventListener('click'"), 'disabled before the handler is wired');
  assert(!/new Audio\(/.test(listen), 'the play handler must go through the clip cache');
});

test('exportCSV appends a trailing plays column, filled only for listen rows', () => {
  H.run("S={mode:'listen',seed:1,name:'Ana',date:'2026-01-01',occ:'T1',items:[],i:0,t0:0,plays:0,resp:[" +
    "{w:'casa',b:0,t:'real',yes:true,ms:900,plays:2}," +
    "{w:'blerfada',b:-1,t:'pseudo',yes:false,ms:700,plays:1}]}");
  H.exportCSV();
  const lines = H.lastBlobText().trim().split('\n');
  const head = lines[0].split(',');
  eq(head[head.length - 1], 'plays', 'plays is the LAST header column');
  eq(lines[1].split(',').pop(), '2');
  eq(lines[2].split(',').pop(), '1');
  eq(head.length, lines[1].split(',').length, 'row width matches the header');
});

test('exportCSV leaves plays empty for non-listen and mc rows', () => {
  H.run("S={mode:'mastery',seed:1,name:'Ana',date:'2026-01-01',occ:'',items:[],i:0,t0:0,plays:0,resp:[" +
    "{w:'casa',b:0,t:'mc',pick:1,correct:false,omit:false,ms:900}]}");
  H.exportCSV();
  const lines = H.lastBlobText().trim().split('\n');
  eq(lines[1].split(',').pop(), '', 'mc rows get an empty plays cell');
  eq(lines[0].split(',').length, lines[1].split(',').length);
});

test('ingestCSV still reads a header that carries the extra plays column', () => {
  H.run('DASH.length=0');
  const label = H.DATA.bands[0].label.replace(/,/g, ' ');
  const csv = 'student,date,occasion,mode,seed,item,band,type,response,correct,omit,latency_ms,plays\n' +
    'Ana,2026-01-01,T1,size,1,casa,' + label + ',real,si,,,900,\n' +
    'Ana,2026-01-01,T1,size,1,perro,' + label + ',real,no,,,800,\n' +
    'Ana,2026-01-01,T1,size,1,blerfada,pseudo,pseudo,no,,,700,\n';
  // M3 changed ingestText's return type from a count to {added,dups,bad}
  eq(H.run('ingestText(' + JSON.stringify(csv) + ').added'), 1, 'one student record ingested');
  eq(H.run('DASH[0].yn.bands[0][0]'), 2, 'both band-1 items counted');
  eq(H.run('DASH[0].yn.bands[0][1]'), 1, 'one "sí"');
  eq(H.run('DASH[0].yn.ps[0]'), 1, 'pseudoword counted');
  H.run('DASH.length=0');
});

// ---------- (5) seed parsing ----------
const startSize = seedText => {
  H.run("$('#seed').value=" + JSON.stringify(seedText));
  try { H.run("start('size')"); } finally { H.run("$('#seed').value=''"); }
  return H.run('S.seed');
};

test("start() reads '1e5' as 100000, not parseInt's 1", () => {
  eq(startSize('1e5'), 100000);
});

test('start() rounds a decimal seed and takes the magnitude of a negative one', () => {
  eq(startSize('7.9'), 8);
  eq(startSize('-42'), 42);
});

test('start() falls back to a random seed when the field is blank or unparseable', () => {
  const a = startSize('');
  const b = startSize('not a number');
  for (const s of [a, b]) assert(Number.isInteger(s) && s >= 0, 'usable random seed, got ' + s);
});

// ---------- (6) non-integer block / week ----------
test('a fractional block number rounds instead of selecting zero words', () => {
  H.run("$('#blkC').value='2.5'");
  try {
    H.run("startProtocol('c500',{name:'Ana',date:'2026-01-01',occ:'',seed:1})");
    eq(H.run('S.blk'), 3, '2.5 rounds to block 3');
    assert(H.run('S.queue.length') > 0, 'a rounded block must still select words');
  } finally { H.run("$('#blkC').value=''"); }
});

test('startProtocol rounds every block/week field', () => {
  const src = H.run('startProtocol.toString()');
  for (const id of ['#blkC', '#blkA', '#blkS']) {
    const i = src.indexOf(id);
    assert(i >= 0, id + ' read present');
    assert(src.slice(Math.max(0, i - 60), i).indexOf('Math.round') >= 0, id + ' must be wrapped in Math.round');
  }
});

// ---------- (7) local calendar date ----------
test('today() returns the local calendar date, not the UTC one', () => {
  const d = new Date();
  eq(H.today(), d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
});

test('no UTC-date stamping is left at either call site', () => {
  // asserting on source, not on today()'s value: local and UTC dates agree for most of the day,
  // so a value comparison would pass against the old code in many timezones and hours
  eq(FILE.split('toISOString().slice(0,10)').length - 1, 0, 'both date call sites must use today()');
  assert(FILE.indexOf("$('#sdate').value=today();") >= 0, '#sdate initialised from today()');
  assert(H.run('start.toString()').indexOf('toISOString') < 0, 'start() fallback uses today()');
  assert(H.run('gformHTML.toString()').indexOf('toISOString()') >= 0, 'the gform ISO timestamp is left alone');
  eq(H.run("$('#sdate').value"), H.today());
});

// ---------- (8) adaptive stop must not fire over unsampled bands ----------
const stopItems = () => {
  const it = [];
  for (let b = 0; b < 4; b++) for (let j = 0; j < 8; j++) it.push({ w: 'w' + b + '_' + j, b, t: 'real' });
  for (let j = 0; j < 5; j++) it.push({ w: 'z' + j, b: 4, t: 'real' });   // band 4 present in the form...
  for (let j = 0; j < 10; j++) it.push({ w: 'p' + j, b: -1, t: 'pseudo' });
  return it;
};
const stopResp = () => {
  const r = [];
  for (let b = 0; b < 4; b++) for (let j = 0; j < 6; j++) r.push({ w: 'w' + b + '_' + j, b, t: 'real', yes: j < 3, ms: 800 });
  for (let j = 0; j < 8; j++) r.push({ w: 'p' + j, b: -1, t: 'pseudo', yes: false, ms: 800 });
  return r;                                                              // ...but never answered
};
const band4Resp = () => [0, 1, 2, 3].map(j => ({ w: 'z' + j, b: 4, t: 'real', yes: false, ms: 800 }));

test('bandsCovered is false while a band has items but too few responses', () => {
  seedClassic('size', stopItems(), { resp: stopResp() });
  eq(H.bandsCovered(), false, 'band 4 has 5 items and 0 responses');
  H.run('S.resp=S.resp.concat(' + JSON.stringify(band4Resp().slice(0, 3)) + ')');
  eq(H.bandsCovered(), false, '3 responses is still under min(4, 5)');
  H.run('S.resp=S.resp.concat(' + JSON.stringify(band4Resp().slice(3)) + ')');
  eq(H.bandsCovered(), true, '4 responses clears the gate');
});

test('bandsCovered ignores bands the form never sampled at all', () => {
  seedClassic('size', [{ w: 'a', b: 0, t: 'real' }, { w: 'b', b: 0, t: 'real' }],
    { resp: [{ w: 'a', b: 0, t: 'real', yes: true, ms: 500 }, { w: 'b', b: 0, t: 'real', yes: false, ms: 500 }] });
  eq(H.bandsCovered(), true, 'min(4, 2) === 2 for band 0; bands 1-4 have no items');
});

test('the adaptive stop does not fire while a whole band is unsampled', () => {
  H.run("$('#stopS').value='5000'");   // a target so loose the CI clears it immediately
  try {
    seedClassic('size', stopItems(), { resp: stopResp() });
    H.run('answerYN(true)');
    eq(H.run('S.stopped'), undefined, 'stop must be gated by band coverage');
    assert(H.run('S.i') < H.run('S.items.length'), 'the session keeps going');

    seedClassic('size', stopItems(), { resp: stopResp().concat(band4Resp()) });
    H.run('answerYN(true)');
    assert(H.run('S.stopped') > 0, 'with every band sampled the stop fires normally');
  } finally { H.run("$('#stopS').value=''"); }
});

// ---------- (9) s5000 results label ----------
test('the s5000 first stat is labelled for band 2 only', () => {
  seedProto({ mode: 's5000', queue: [], state: { 700: 2, 3000: 1 } });
  H.run('finishProtocol()');
  const html = H.run("$('#results').innerHTML");
  assert(html.indexOf('verificadas (501–1.000)') >= 0, 'label names the band-2 rank range');
  assert(html.indexOf('banda 2) + sí') < 0, 'the misleading "+ sí (bandas 3–5)" claim is gone');
  assert(html.indexOf('"sí" en bandas 3–5') >= 0, 'the bands 3-5 sí count is still its own stat');
});

test('c500 keeps the plain "verificadas" label', () => {
  seedProto({ mode: 'c500', queue: [], state: { 7: 2 } });
  H.run('finishProtocol()');
  const html = H.run("$('#results').innerHTML");
  assert(/>verificadas</.test(html), 'c500 label unqualified, got: ' + html.slice(0, 400));
  assert(html.indexOf('501–1.000') < 0);
});

// ---------- (10) guessing-penalty copy matches the (c - w/3)/n formula ----------
test('the mastery results line quotes a ⅓ penalty', () => {
  const src = H.run('finish.toString()');
  assert(src.indexOf('(c-w/3)/n') >= 0, 'formula is still the 4-option ⅓ correction');
  assert(src.indexOf('−⅓ por error') >= 0, 'copy says ⅓');
  assert(src.indexOf('¼') < 0 && src.indexOf('1/4') < 0, 'no ¼ left in finish()');
});

test('the method footer quotes a ⅓ penalty', () => {
  assert(HEAD.indexOf('penalized ⅓') >= 0, 'footer says ⅓');
  assert(HEAD.indexOf('¼') < 0 && HEAD.indexOf('1/4') < 0, 'no ¼ left in the page markup');
});

// ---------- (11) a500 queue is shuffled ----------
test('the a500 queue is shuffled out of strict corpus-frequency order', () => {
  H.run("$('#formAB').value='A';$('#blkA').value='1'");
  try {
    H.run("startProtocol('a500',{name:'Ana',date:'2026-01-01',occ:'',seed:7})");
    const got = H.run('S.queue.map(q=>q.w)');
    const strict = H.DATA.bands[0].words.filter((_, i) => i % 2 === 0).filter((_, i) => i % 5 === 0);
    eq(got.length, strict.length, 'same number of items');
    eq(got.slice().sort().join('|'), strict.slice().sort().join('|'), 'same word set');
    assert(got.join('|') !== strict.join('|'), 'order must differ from corpus-frequency order');

    H.run("startProtocol('a500',{name:'Ana',date:'2026-01-01',occ:'',seed:7})");
    eq(H.run('S.queue.map(q=>q.w)').join('|'), got.join('|'), 'same seed → identical form');
    H.run("startProtocol('a500',{name:'Ana',date:'2026-01-01',occ:'',seed:8})");
    assert(H.run('S.queue.map(q=>q.w)').join('|') !== got.join('|'), 'a different seed reorders');
  } finally { H.run("$('#formAB').value='';$('#blkA').value=''"); }
});
