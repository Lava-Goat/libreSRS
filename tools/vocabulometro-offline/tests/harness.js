// Loads the app's <script> block into a Node closure with a permissive DOM stub.
// Zero dependencies. `require('./harness.js')` returns the app's functions plus
// `run(src)` — a direct-eval escape hatch that sees every closure binding (S, DASH, GFORM...).
const fs = require('fs');
const path = require('path');

// VOCABULOMETRO_HTML lets a regression check point the harness at a mutated copy of the app.
const APP = process.env.VOCABULOMETRO_HTML || path.join(__dirname, '..', 'vocabulometro.html');
const HTML = fs.readFileSync(APP, 'utf8');

// ---- extract the script body ----
const open = HTML.indexOf('<script>');
const close = HTML.lastIndexOf('</script>');
if (open < 0 || close < 0) throw new Error('harness: could not locate <script> block');
let SRC = HTML.slice(open + '<script>'.length, close);

// ---- neutralise the 587KB base64 AUDIO blob (string surgery, never a regex over the blob) ----
let aStart = SRC.indexOf('const AUDIO=');
if (aStart < 0) aStart = SRC.indexOf('const AUDIO ');
if (aStart < 0) throw new Error('harness: could not locate const AUDIO declaration');
const aEnd = SRC.indexOf('\n', aStart);
SRC = SRC.slice(0, aStart) + 'const AUDIO={};' + SRC.slice(aEnd < 0 ? SRC.length : aEnd);

// ---- recursive DOM stub ----
function makeFake() {
  const store = { value: '', textContent: '', innerHTML: '', disabled: false, files: [], checked: false };
  const noop = () => {};
  const target = () => {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in store) return store[prop];
      if (prop === 'style') return (store.style = store.style || {});
      if (prop === 'dataset') return (store.dataset = store.dataset || {});
      if (prop === 'classList') return (store.classList = store.classList || {
        add: noop, remove: noop, toggle: noop, contains: () => false
      });
      if (prop === 'querySelectorAll') return () => [];
      // recorded so m4 a11y tests can assert on aria-* attributes set imperatively (e.g. aria-valuenow)
      if (prop === 'setAttribute') return (name, v) => { (store.attrs = store.attrs || {})[name] = String(v); };
      if (prop === 'getAttribute') return name => (store.attrs && name in store.attrs) ? store.attrs[name] : null;
      // caret API: absent until a test assigns selectionStart/End (insertChar then splices instead
      // of appending), and setSelectionRange writes both back so the caret can be asserted on
      if (prop === 'setSelectionRange') return (a, b) => { store.selectionStart = a; store.selectionEnd = b; };
      if (prop === 'addEventListener' || prop === 'removeEventListener' ||
          prop === 'select' || prop === 'focus' || prop === 'blur' || prop === 'click') return noop;
      if (prop === 'then') return undefined;           // never look thenable
      if (prop === 'toString') return () => '';
      if (prop === Symbol.toPrimitive) return () => '';
      if (typeof prop === 'symbol') return undefined;
      return makeFake();                                // every other property is another fake
    },
    set(t, prop, v) { store[prop] = v; return true; },
    apply() { return makeFake(); },
    has() { return true; }
  });
}

const cache = new Map();
const bySelector = sel => {
  const k = String(sel);
  if (!cache.has(k)) cache.set(k, makeFake());
  return cache.get(k);
};

const documentStub = {
  querySelector: bySelector,
  getElementById: bySelector,
  querySelectorAll: () => [],
  createElement: () => makeFake(),
  addEventListener: () => {},
  body: makeFake()
};
// confirm/prompt are overridable per test (H.window.confirm = () => false)
const windowStub = {
  scrollTo: () => {}, addEventListener: () => {},
  confirm: () => true,
  prompt: (msg, val) => { windowStub.lastPrompt = [msg, val]; return val; }
};
const navigatorStub = {};
// Map-backed so keys like 'constructor' or '__proto__' behave like real storage
const localStorageStub = {
  _d: new Map(),
  getItem(k) { return this._d.has(String(k)) ? this._d.get(String(k)) : null; },
  setItem(k, v) { this._d.set(String(k), String(v)); },
  removeItem(k) { this._d.delete(String(k)); },
  clear() { this._d.clear(); },
  get length() { return this._d.size; }
};
class BlobStub {
  constructor(parts, opts) { this.parts = parts; this.options = opts; BlobStub.last = this; }
}
// records both sides so tests can prove every object URL is eventually revoked
const URLStub = {
  created: [], revoked: [],
  createObjectURL() { const u = 'blob:fake' + this.created.length; this.created.push(u); return u; },
  revokeObjectURL(u) { this.revoked.push(u); }
};
// the app calls .play().catch() and pauses the previous clip, so the stub needs both
class AudioStub {
  constructor(src) { this.src = src; this.currentTime = 0; AudioStub.made = (AudioStub.made || 0) + 1; }
  play() { this.playCount = (this.playCount || 0) + 1; AudioStub.playing = this; return Promise.resolve(); }
  pause() { this.paused = true; }
}

const EXPORTS = '{esc,norm,today,acceptActive,estFromCounts,ynCounts,ynEstimates,wilson,parseCode,' +
  'runningEstimate,buildPlan,gformHTML,payloadV2,payloadFromSession,estRecord,ledger,isV2,' +
  'codeFromRec,dashExportCSV,setState,handleKey,tooSoon,bandsCovered,exportCSV,' +
  'q,splitCSV,nameKey,ingestText,ingestCSV,ingestMsg,openDash,renderDash,saveDash,loadDash,' +
  'dashDelete,dashClearAll,planClick,download,insertChar,charKeysHTML,CHARKEYS,' +
  'DATA,FORM_A,ALLWORDS,BANDOFF,GFORM,DASH,SEEN,DASHKEY,' +
  'run:s=>eval(s)}';

const factory = new Function(
  'document', 'window', 'navigator', 'Blob', 'URL', 'Audio', 'localStorage',
  SRC + '\n;return ' + EXPORTS + ';'
);

module.exports = factory(
  documentStub, windowStub, navigatorStub, BlobStub, URLStub, AudioStub, localStorageStub
);
// text of the most recent Blob the app built (CSV / code exports)
module.exports.lastBlobText = () => (BlobStub.last ? BlobStub.last.parts.join('') : '');
module.exports.AudioStub = AudioStub;
module.exports.window = windowStub;
module.exports.navigator = navigatorStub;
module.exports.localStorage = localStorageStub;
module.exports.URLStub = URLStub;
