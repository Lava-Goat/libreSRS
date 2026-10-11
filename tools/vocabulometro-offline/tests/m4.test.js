// Milestone 4 regression tests: accessibility, i18n, offline, mobile.
const fs = require('fs');
const path = require('path');
const H = require('./harness.js');
const { test, assert, eq } = global.__t;

// raw source text — the same file harness.js loads, so VOCABULOMETRO_HTML overrides are honoured too
const APP = process.env.VOCABULOMETRO_HTML || path.join(__dirname, '..', 'vocabulometro.html');
const RAW = fs.readFileSync(APP, 'utf8');
// HTML head/CSS/markup that precedes the DATA blob — safe for any regex/indexOf
const HEAD = RAW.slice(0, RAW.indexOf('const DATA'));
// the full file with the two giant single-line DATA/AUDIO blobs excised, for source checks
// that live further down the <script> (e.g. inside finish()) — string surgery only, the
// blob content itself is never inspected, matching harness.js's own AUDIO-neutralising trick
const SAFE = (() => {
  const dStart = RAW.indexOf('const DATA'), dEnd = RAW.indexOf('\n', dStart);
  const aStart = RAW.indexOf('const AUDIO'), aEnd = RAW.indexOf('\n', aStart);
  return RAW.slice(0, dStart) + RAW.slice(dEnd, aStart) + RAW.slice(aEnd);
})();

const seedItems = (mode, i, n) => H.run('S=' + JSON.stringify({
  mode, seed: 1, name: 'Ana', date: '2026-01-01', occ: '',
  items: Array.from({ length: n }, (_, k) => ({ w: 'w' + k, b: 0, t: 'real' })),
  i, resp: [], t0: 0, plays: 0
}) + ';1');

// ---------- (1) offline fonts ----------
test('the Google Fonts @import is gone', () => {
  assert(RAW.indexOf('@import') < 0, '@import must not appear anywhere in the file');
  assert(RAW.indexOf('fonts.googleapis.com') < 0, 'no network font dependency remains');
});

test('the three font stacks degrade gracefully offline', () => {
  assert(/--disp:'Archivo','Avenir Next Condensed','Arial Narrow',system-ui,sans-serif/.test(HEAD), '--disp fallback chain');
  assert(/--body:'Public Sans',-apple-system,'Segoe UI',Roboto,sans-serif/.test(HEAD), '--body fallback chain');
  assert(/--mono:'Spline Sans Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace/.test(HEAD), '--mono fallback chain');
});

// ---------- (2) form labels ----------
test('every setup-grid and teacher-settings control has a label wired by for/id', () => {
  const ids = ['blkC', 'formAB', 'blkA', 'blkS', 'n0', 'n1', 'n2', 'n3', 'n4', 'npseudo', 'nmast', 'seed', 'stopS'];
  for (const id of ids) {
    assert(new RegExp('id="' + id + '"').test(HEAD), 'control #' + id + ' must exist');
    assert(new RegExp('for="' + id + '"').test(HEAD), 'label for="' + id + '" is missing');
  }
});

// ---------- (3) test-screen a11y: static markup ----------
test('#stim announces new content via aria-live', () => {
  assert(/id="stim"[^>]*aria-live="polite"/.test(HEAD), 'aria-live="polite" must sit on #stim');
});

test('the HUD rail exposes a progressbar role with min/max/label', () => {
  assert(/class="rail" role="progressbar" aria-valuemin="0" aria-valuemax="100"/.test(HEAD), 'progressbar attrs on .rail');
  assert(/aria-label="Progreso"/.test(HEAD));
});

test('the file-import control is a real button, not a label wrapping a hidden input', () => {
  assert(/<button type="button" class="ghost" id="csvBtn2">Importar archivos<\/button>/.test(HEAD),
    'csvBtn2 must be a focusable button');
  assert(!/<label[^>]*class="[^"]*filebtn/.test(RAW), 'the old label.filebtn wrapper must be gone');
  assert(/id="csvIn"[^>]*hidden/.test(HEAD), 'csvIn stays hidden');
});

test('csvBtn2 click delegates to the hidden csvIn input, and the change handler survives untouched', () => {
  assert(/\$\('#csvBtn2'\)\.addEventListener\('click',\s*\(\)=>\$\('#csvIn'\)\.click\(\)\)/.test(RAW),
    'csvBtn2 must forward its click to csvIn.click()');
  assert(/\$\('#csvIn'\)\.addEventListener\('change',\s*async e=>\{/.test(RAW),
    'the original csvIn change handler must still be wired');
});

// ---------- (3) test-screen a11y: behavioral ----------
test('stepProtocol’s typed phase labels #typedIn for screen readers', () => {
  H.run('S=' + JSON.stringify({
    mode: 'a500', seed: 1, name: 'Ana', date: '2026-01-01', occ: '', blk: 1, form: 'A',
    queue: [{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }], i: 0, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
  }) + ';1');
  H.run('stepProtocol()');
  const html = H.run("$('#answerArea').innerHTML");
  assert(html.indexOf('id="typedIn"') >= 0, 'typedIn rendered');
  assert(html.indexOf('aria-label="Escribe la palabra en español"') >= 0, 'typedIn must carry the aria-label');
});

test('finishProtocol’s #codeOut carries the same aria-label as finish()’s', () => {
  H.run('S=' + JSON.stringify({
    mode: 'c500', seed: 1, name: 'Ana', date: '2026-01-01', occ: '', blk: 1, form: '',
    queue: [], i: 0, state: { 0: 2 }, ps: [0, 0], retest: [], t0: 0, resp: []
  }) + ';1');
  H.run('finishProtocol()');
  const html = H.run("$('#results').innerHTML");
  assert(html.indexOf('aria-label="Código de resultado"') >= 0, 'finishProtocol #codeOut needs the label too');
  assert(html.indexOf('id="resHead" tabindex="-1"') >= 0, 'the results eyebrow must be a focusable heading');
});

test('finish() gives its results eyebrow a focusable id, and codeOut keeps its label', () => {
  H.run('S=' + JSON.stringify({
    mode: 'mastery', seed: 1, name: 'Ana', date: '2026-01-01', occ: '',
    items: [{ w: 'casa', b: 0, t: 'mc', opts: ['a', 'b', 'c', 'd'], correct: 'a' }],
    i: 0, resp: [{ w: 'casa', b: 0, t: 'mc', pick: 0, correct: true, omit: false, ms: 500 }], t0: 0
  }) + ';1');
  H.run('finish()');
  const html = H.run("$('#results').innerHTML");
  assert(html.indexOf('id="resHead" tabindex="-1"') >= 0, 'the results eyebrow must be a focusable heading');
  assert(html.indexOf('aria-label="Código de resultado"') >= 0);
});

test('render() and stepProtocol() keep the progress rail’s aria-valuenow in sync with the fill width', () => {
  seedItems('mastery', 2, 4);
  H.run("S.items=S.items.map(x=>({...x,opts:['a','b','c','d'],correct:'a'}));1");
  H.run('render()');
  eq(H.run("$('.rail').getAttribute('aria-valuenow')"), '50', 'render(): item 3 of 4 is 50% through');

  H.run('S=' + JSON.stringify({
    mode: 'c500', seed: 1, name: 'Ana', date: '2026-01-01', occ: '', blk: 1, form: '',
    queue: [{ w: 'a', ph: 'screen' }, { w: 'b', ph: 'screen' }, { w: 'c', ph: 'screen' }, { w: 'd', ph: 'screen' }],
    i: 1, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
  }) + ';1');
  H.run('stepProtocol()');
  eq(H.run("$('.rail').getAttribute('aria-valuenow')"), '25', 'stepProtocol(): item 2 of 4 is 25% through');
});

// M5 reversed the M4 behaviour asserted here: focusing the first .ans/.opt armed Enter/Space as a
// "sí"/option-A key (UA activation = click), so autofocus now lands on the #stim prompt instead.
// The full anti-regression battery lives in m5.test.js; this keeps the guarded-call convention.
test('render() and stepProtocol() autofocus the prompt, never an answer control', () => {
  const src = H.run('render.toString()');
  assert(src.indexOf("aa.querySelector('.ans,.opt')") < 0, 'render() must not focus an answer control');
  assert(/\?\.focus\?\.\(\{preventScroll:true\}\)/.test(src), 'the focus call stays optional-chained');
  const stepSrc = H.run('stepProtocol.toString()');
  const screenBlock = stepSrc.slice(stepSrc.indexOf("ph==='screen'"), stepSrc.indexOf("ph==='mc'"));
  const mcBlock = stepSrc.slice(stepSrc.indexOf("ph==='mc'"), stepSrc.indexOf('}else{ // typed'));
  assert(/stim\?\.focus\?\.\(\{preventScroll:true\}\)/.test(screenBlock), 'screen phase focuses #stim');
  assert(/stim\?\.focus\?\.\(\{preventScroll:true\}\)/.test(mcBlock), 'mc phase focuses #stim');
  assert(/inp\?\.focus\?\.\(\{preventScroll:true\}\)/.test(stepSrc), 'the typed phase focus call is guarded too');
});

// ---------- (4) Spanish student-facing copy ----------
test('the header subtitle is in Spanish', () => {
  assert(HEAD.indexOf('Frequency-weighted vocabulary size') < 0, 'the English subtitle is gone');
  assert(/class="sub">Tamaño de vocabulario/.test(HEAD), 'a Spanish subtitle replaces it');
});

test('none of the six mode cards (or the size/coverage copy) leaks its old English text', () => {
  // one legitimate, untouched code comment says "660-word pool" (about pseudoword ring overlap,
  // see the m3 "pseudo ring overlap" test) — student-facing copy is everything else in the file
  const studentFacing = RAW.replace('660-word pool that sondeo', '');
  const sentinels = [
    'Written Sí/No', 'Meaning-based', 'Aural Sí/No', 'Two-gate',
    'Productive census', 'Rolling census', 'word pool', 'The top 5,000 words carry'
  ];
  for (const s of sentinels) assert(studentFacing.indexOf(s) < 0, 'leftover English sentinel found: ' + JSON.stringify(s));
});

test('sizeMeta and mastMeta build their meta strings in Spanish', () => {
  const srcSize = SAFE.slice(SAFE.indexOf("$('#sizeMeta')"), SAFE.indexOf("$('#mastMeta')"));
  assert(srcSize.indexOf('palabras') >= 0 && srcSize.indexOf('pseudopalabras') >= 0);
  assert(srcSize.indexOf('word pool') < 0 && srcSize.indexOf('pseudowords') < 0);
  const srcMast = SAFE.slice(SAFE.indexOf("$('#mastMeta')"), SAFE.indexOf("$('#mastMeta')") + 200);
  assert(srcMast.indexOf('domain') < 0 && srcMast.indexOf('distractors') < 0, 'mastMeta no longer says domain/distractors in English');
});

test('finish() renders the 5,000-word coverage note and both flags in Spanish', () => {
  const finishSrc = SAFE.slice(SAFE.indexOf('function finish('), SAFE.indexOf('function stat('));
  assert(finishSrc.indexOf('The top 5,000 words carry') < 0);
  assert(finishSrc.indexOf('5.000 palabras más frecuentes') >= 0, 'the coverage note is translated');
  assert(finishSrc.indexOf('Reading thresholds') < 0);
  assert(finishSrc.indexOf('Umbrales de lectura') >= 0);
  assert(finishSrc.indexOf('False-alarm rate above 30%') < 0);
  assert(finishSrc.indexOf('Tasa de falsa alarma superior al 30%') >= 0, 'the false-alarm flag is translated, addressed to the teacher');
  assert(finishSrc.indexOf('Fewer than 8 pseudowords') < 0);
  assert(finishSrc.indexOf('Menos de 8 pseudopalabras') >= 0);
});

test('the teacher/method footer and code comments were left alone', () => {
  assert(RAW.indexOf('<strong>Method.</strong> Items are stratified by corpus frequency') >= 0,
    'the method footer must remain in English, unedited');
});

// ---------- (5) mobile CSS ----------
test('the setup/block grids collapse to one column under 640px', () => {
  assert(/@media\(max-width:640px\)\{[\s\S]{0,40}\.tgrid\{grid-template-columns:1fr\s*!important\}/.test(HEAD),
    '.tgrid must be forced to a single column in the mobile breakpoint');
});

test('tables scroll horizontally instead of overflowing the viewport', () => {
  assert(/table\{width:100%;max-width:100%;border-collapse:collapse/.test(HEAD), 'table keeps max-width:100% unconditionally');
  assert(/@media\(max-width:640px\)\{[\s\S]*table\{display:block;overflow-x:auto;border-collapse:collapse\}/.test(HEAD),
    'the block/scroll treatment is scoped to the mobile breakpoint, not applied globally');
});

test('SVG meters stay legible on narrow screens', () => {
  assert(/\.meter\{margin:22px 0 6px;overflow-x:auto\}/.test(HEAD));
  assert(/\.meter svg\{width:100%;height:auto;display:block;min-width:560px\}/.test(HEAD));
});

// ---------- (6) nothing else regressed ----------
test('a fresh require of harness.js still loads cleanly (syntax sanity)', () => {
  const key = require.resolve('./harness.js');
  delete require.cache[key];
  const fresh = require('./harness.js');
  assert(typeof fresh.run === 'function', 'the harness re-loads and exposes run()');
  assert(typeof fresh.DATA === 'object' && fresh.DATA.bands.length === 5, 'DATA is intact after edits');
});
