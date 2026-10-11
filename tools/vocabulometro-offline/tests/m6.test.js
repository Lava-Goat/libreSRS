// Milestone 6: the on-screen special-character row for the typed phase.
// Students on US keyboards cannot type á é í ó ú ü ñ. norm() forgives the accents but PRESERVES
// ñ, so without this row "manana" can never be scored as a production of "mañana".
//   (1) the row is rendered in the typed phase — and only there
//   (2) every key is a real, labelled <button type="button"> (tabbable, Enter/Space activate it)
//   (3) insertChar splices at the caret / over the selection and leaves the caret after the char
//   (4) inserting a character is NOT an answer: no S.i advance, no S.resp row, no S.state write
const fs = require('fs');
const path = require('path');
const H = require('./harness.js');
const { test, assert, eq } = global.__t;

const APP = process.env.VOCABULOMETRO_HTML || path.join(__dirname, '..', 'vocabulometro.html');
const RAW = fs.readFileSync(APP, 'utf8');
// the two giant single-line DATA/AUDIO blobs excised — string surgery only, so no regex ever runs
// over 700KB of base64 (same trick harness.js, m4 and m5 use)
const SAFE = (() => {
  const dStart = RAW.indexOf('const DATA'), dEnd = RAW.indexOf('\n', dStart);
  const aStart = RAW.indexOf('const AUDIO'), aEnd = RAW.indexOf('\n', aStart);
  return RAW.slice(0, dStart) + RAW.slice(dEnd, aStart) + RAW.slice(aEnd);
})();

const KEYS = ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'];

const seedProto = q => H.run('S=' + JSON.stringify({
  mode: 'a500', seed: 1, name: 'Ana', date: '2026-01-01', occ: '', blk: 1, form: 'A',
  queue: q, i: 0, state: {}, ps: [0, 0], retest: [], t0: 0, resp: []
}) + ';S.rnd=mulberry32(1);1');

// the cached DOM stub is shared across tests: give #typedIn a known value + caret every time
const setInput = (value, a, b) => H.run(
  "(()=>{const e=$('#typedIn');e.value=" + JSON.stringify(value) +
  ';e.selectionStart=' + JSON.stringify(a) + ';e.selectionEnd=' + JSON.stringify(b === undefined ? a : b) + ';})();1'
);
const caret = () => [H.run("$('#typedIn').selectionStart"), H.run("$('#typedIn').selectionEnd")];

// ---------- (1) the row is rendered in the typed phase, and only there ----------
test('the typed phase renders all seven special-character keys', () => {
  seedProto([{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }]);
  H.run('stepProtocol()');
  const html = H.run("$('#answerArea').innerHTML");
  assert(html.indexOf('id="typedIn"') >= 0, 'the input is still there');
  for (const c of KEYS) {
    assert(html.indexOf('data-ch="' + c + '"') >= 0, 'missing key ' + c);
    assert(html.indexOf('aria-label="insertar ' + c + '"') >= 0, 'missing aria-label for ' + c);
  }
  eq((html.match(/class="ck"/g) || []).length, 7, 'exactly seven keys, no more');
});

test('the screen and mc phases render no character keys — nothing is typed there', () => {
  seedProto([{ w: 'casa', idx: 0, ph: 'screen' }]);
  H.run('stepProtocol()');
  eq(H.run("$('#answerArea').innerHTML").indexOf('class="ck"'), -1, 'screen phase');

  seedProto([{ w: 'casa', idx: 0, ph: 'mc', mc: { opts: ['a', 'b', 'c', 'd'], correct: 'a' } }]);
  H.run('stepProtocol()');
  eq(H.run("$('#answerArea').innerHTML").indexOf('class="ck"'), -1, 'mc phase');
});

test('CHARKEYS is exactly the seven characters a US layout cannot produce', () => {
  eq(H.CHARKEYS.join(''), KEYS.join(''));
});

// ---------- (2) every key is a real, keyboard-operable button ----------
test('each key is a <button type="button"> — never a submit, always tabbable', () => {
  const html = H.charKeysHTML();
  eq((html.match(/<button type="button"/g) || []).length, 7, 'all seven declare type="button"');
  assert(/role="group" aria-label="Caracteres especiales"/.test(html), 'the row is a labelled group');
});

test('the keys never steal the caret: mousedown is prevented, and click only calls insertChar', () => {
  const src = H.run('stepProtocol.toString()');
  const wiring = src.slice(src.indexOf(".querySelectorAll('.ck')"));
  assert(/mousedown['"],\s*e\s*=>\s*e\.preventDefault\(\)/.test(wiring),
    'mousedown must be prevented or the input loses focus/caret before click fires');
  assert(/click['"],\s*\(\)\s*=>\s*insertChar\(/.test(wiring), 'click inserts and does nothing else');
});

test('insertChar cannot answer: it never reaches protoTyped, tooSoon or logResp', () => {
  const src = H.run('insertChar.toString()');
  for (const banned of ['protoTyped', 'tooSoon', 'logResp', 'stepProtocol', 'setState']) {
    eq(src.indexOf(banned), -1, 'insertChar must not call ' + banned);
  }
});

test('the .ck chips are styled in the stylesheet, matching the .key hint chips', () => {
  assert(/button\.ck\{[^}]*var\(--mono\)/.test(SAFE), 'button.ck uses the app mono face');
  assert(/button\.ck:focus-visible\{[^}]*outline/.test(SAFE), 'the chips have a visible focus ring');
  assert(SAFE.indexOf('.ckrow{') >= 0, 'the row itself has a layout rule');
});

// ---------- (3) insertion is caret-aware ----------
test('insertChar splices at the caret, not at the end', () => {
  setInput('maana', 2);
  eq(H.insertChar('ñ'), 'mañana');
  eq(H.run("$('#typedIn').value"), 'mañana');
});

test('the caret lands immediately AFTER the inserted character, so typing continues in place', () => {
  setInput('maana', 2);
  H.insertChar('ñ');
  eq(caret().join(','), '3,3');
  H.insertChar('a');                                     // the next insert follows the first
  eq(H.run("$('#typedIn').value"), 'mañaana');
});

test('insertChar replaces the current selection', () => {
  setInput('manzana', 2, 4);                             // 'nz' selected
  eq(H.insertChar('ñ'), 'mañana');
  eq(caret().join(','), '3,3');
});

test('inserting into an empty box, and at the very start and end', () => {
  setInput('', 0);
  eq(H.insertChar('ñ'), 'ñ');
  setInput('gua', 0);
  eq(H.insertChar('a'), 'agua');
  setInput('mani', 4);
  eq(H.insertChar('í'), 'manií');
});

test('a missing or nonsensical caret degrades to appending, never to throwing', () => {
  setInput('man', null, null);                           // some IMEs/inputs report no selection
  eq(H.insertChar('ú'), 'manú');
  setInput('man', 99, 99);                               // out of range
  eq(H.insertChar('ú'), 'manú');
  setInput('man', 2, 1);                                 // end before start
  eq(H.insertChar('ú'), 'manú');
});

// ---------- (4) inserting is not answering ----------
test('insertChar advances nothing: no S.i, no S.resp row, no S.state write', () => {
  seedProto([{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }, { w: H.ALLWORDS[1], idx: 1, ph: 'typed' }]);
  H.run('stepProtocol()');
  setInput('nino', 2);
  KEYS.forEach(c => H.insertChar(c));
  eq(H.run('S.i'), 0, 'still on the same item');
  eq(H.run('S.resp.length'), 0, 'no response was logged');
  eq(H.run('Object.keys(S.state).length'), 0, 'no word state was written');
});

test('insertChar works while the 250ms lockout is still armed — it is not an answer', () => {
  seedProto([{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }]);
  H.run('S.t0=performance.now()');                       // tooSoon() is true right now
  assert(H.tooSoon(), 'precondition: the lockout is armed');
  setInput('ao', 1);
  eq(H.insertChar('ñ'), 'año', 'the character still goes in');
  eq(H.run('S.i'), 0);
  eq(H.run('S.resp.length'), 0);
});

test('a keystroke aimed at a focused character key still cannot answer the typed item', () => {
  seedProto([{ w: H.ALLWORDS[0], idx: 0, ph: 'typed' }]);
  H.run('S.t0=0');
  // handleKey's PROTO branch handles 'screen' and 'mc' only, then returns: the typed phase is
  // answered by the input's own Enter listener, so 's'/'n'/'a'-'d' are inert here regardless of
  // which control (including a .ck chip) has focus.
  ['s', 'n', 'a', 'd'].forEach(k => H.handleKey({ key: k, target: { tagName: 'BUTTON' } }));
  eq(H.run('S.i'), 0, 'no item was answered');
  eq(H.run('S.resp.length'), 0, 'nothing was logged');
});

// ---------- the payoff ----------
test('ñ is the character that actually changes a score — accents are already forgiven', () => {
  const enye = H.ALLWORDS.find(w => w.indexOf('ñ') >= 0);
  assert(enye, 'the corpus contains at least one ñ word');
  eq(H.acceptActive(enye.replace(/ñ/g, 'n'), enye), false, 'dropping the tilde is a wrong answer');
  eq(H.acceptActive(enye, enye), true, 'typing it correctly — what the row makes possible — passes');

  const acc = H.ALLWORDS.find(w => /[áéíóú]/.test(w));
  assert(acc, 'the corpus contains at least one accented word');
  eq(H.acceptActive(H.norm(acc), acc), true, 'accents are folded away, so those keys are convenience only');
});
