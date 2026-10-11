// Zero-dependency test runner: requires every tests/*.test.js, reports, exits 1 on failure.
const fs = require('fs');
const path = require('path');

const results = [];
global.__t = {
  test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e && e.stack || String(e) }); }
  },
  assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); },
  eq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
  },
  near(a, b, tol, msg) {
    if (!(Math.abs(a - b) <= tol)) throw new Error((msg || 'not near') + ': got ' + a + ', want ' + b + ' ±' + tol);
  }
};

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const f of files) require(path.join(__dirname, f));

let failed = 0;
for (const r of results) {
  if (r.ok) console.log('  pass  ' + r.name);
  else { failed++; console.log('  FAIL  ' + r.name + '\n        ' + r.err.split('\n').join('\n        ')); }
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed' +
  (failed ? ' — ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
