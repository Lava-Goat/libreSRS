// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Spanish orthographic syllabification and written-accent rules (RAE 2010).
 *
 * The conjugation engine never special-cases a verb to place an accent when a
 * word grows or shrinks: enclitic pronouns (levántate, vístanse, llamémonos,
 * estoy levantándome) and prefixed compounds (obtén, prevés, sonrió, rehúso)
 * are syllabified, the stressed syllable is carried over, and the written
 * accent is decided from the general rules:
 *
 *  - aguda (last syllable stressed): accent when the word ends in a vowel, n or s;
 *  - llana (second to last): accent when it ends in anything else (y counts as a consonant);
 *  - esdrújula or earlier: always;
 *  - a stressed i/u next to a/e/o (a hiatus) always carries the accent, even across h
 *    (reí, oído, prohíbe, rehúso, vestíos);
 *  - one-syllable words carry no accent (fue, dio, vio, rio, fie, hui) except the
 *    diacritic ones (dé, sé).
 *
 * Orthographic conventions: i/u with a/e/o (unaccented) or with each other form
 * a diphthong, so guion, rio, fiais and huis count as one syllable; a/e/o
 * together are in hiatus; qu/gu before e/i spell one consonant; ch, ll and rr
 * are single consonants; y is a consonant before a vowel and a vowel otherwise.
 */

const ACUTE_TO_PLAIN: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };
const PLAIN_TO_ACUTE: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü']);
const STRONG = new Set(['a', 'e', 'o', 'á', 'é', 'ó']);
const ACCENTED_WEAK = new Set(['í', 'ú']);
/** Monosyllables whose accent is diacritic and must stay (dé = give, sé = know / be). */
const DIACRITIC_MONOSYLLABLES = new Set(['dé', 'sé']);
/** Onset clusters that stay together at a syllable break (pr, bl, tr, ...). */
const ONSET_CLUSTERS = new Set([
  'pr', 'pl', 'br', 'bl', 'fr', 'fl', 'tr', 'dr', 'cr', 'cl', 'gr', 'gl', 'kr', 'kl',
]);

export interface Unit {
  /** The letters of this unit ("a", "ch", "qu", "rr", ...). */
  t: string;
  /** True when the unit is a vowel (part of a syllable nucleus). */
  v: boolean;
}

export type Syllable = Unit[];

export function isVowelChar(c: string | undefined): boolean {
  return c !== undefined && VOWELS.has(c);
}

/** Removes acute accents (á→a ...) but keeps ü and ñ. */
export function stripAcute(s: string): string {
  let out = '';
  for (const c of s) out += ACUTE_TO_PLAIN[c] ?? c;
  return out;
}

export function hasAcute(s: string): boolean {
  for (const c of s) if (c in ACUTE_TO_PLAIN) return true;
  return false;
}

/**
 * Folds accents for lenient comparison: á é í ó ú ü → a e i o u (either case).
 * ñ is a separate letter and is never folded (año ≠ ano).
 */
export function foldAccents(s: string): string {
  let out = '';
  for (const c of s) {
    const lower = c.toLowerCase();
    const plain = ACUTE_TO_PLAIN[lower] ?? (lower === 'ü' ? 'u' : undefined);
    if (plain === undefined) out += c;
    else out += c === lower ? plain : plain.toUpperCase();
  }
  return out;
}

/** Splits a lowercase word into letter units (vowels, consonants, digraphs). */
export function toUnits(word: string): Unit[] {
  const chars = [...word];
  const out: Unit[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const n = chars[i + 1];
    const n2 = chars[i + 2];
    if ((c === 'q' || c === 'g') && n === 'u' && n2 !== undefined && 'eéií'.includes(n2)) {
      out.push({ t: c + 'u', v: false });
      i++;
      continue;
    }
    if ((c === 'c' && n === 'h') || (c === 'l' && n === 'l') || (c === 'r' && n === 'r')) {
      out.push({ t: c + n, v: false });
      i++;
      continue;
    }
    if (c === 'y') {
      // y is a consonant before a vowel (yo, cayó), a vowel otherwise (hoy, estoy).
      out.push({ t: c, v: !isVowelChar(n) });
      continue;
    }
    out.push({ t: c, v: isVowelChar(c) });
  }
  return out;
}

function isStrongUnit(u: Unit | undefined): boolean {
  return !!u && u.v && STRONG.has(u.t);
}

function breaksNucleus(a: Unit, b: Unit): boolean {
  const sa = STRONG.has(a.t);
  const sb = STRONG.has(b.t);
  if (sa && sb) return true;
  if (ACCENTED_WEAK.has(a.t) && sb) return true;
  if (sa && ACCENTED_WEAK.has(b.t)) return true;
  return false;
}

/** Orthographic syllabification of a single lowercase word. */
export function syllabify(word: string): Syllable[] {
  const units = toUnits(word);
  // Nuclei as [start, end] (inclusive) unit ranges.
  const nuclei: [number, number][] = [];
  let i = 0;
  while (i < units.length) {
    if (!units[i].v) {
      i++;
      continue;
    }
    let start = i;
    while (i + 1 < units.length && units[i + 1].v) {
      if (breaksNucleus(units[i], units[i + 1])) {
        nuclei.push([start, i]);
        start = i + 1;
      }
      i++;
    }
    nuclei.push([start, i]);
    i++;
  }
  if (nuclei.length === 0) return [units];

  const syllables: Syllable[] = [];
  let cursor = 0;
  for (let k = 0; k < nuclei.length; k++) {
    const [, end] = nuclei[k];
    let boundary: number;
    if (k === nuclei.length - 1) {
      boundary = units.length;
    } else {
      const nextStart = nuclei[k + 1][0];
      const cons = units.slice(end + 1, nextStart);
      if (cons.length === 0) boundary = end + 1;
      else if (cons.length === 1) boundary = end + 1;
      else {
        const lastTwo = cons[cons.length - 2].t + cons[cons.length - 1].t;
        const keep = ONSET_CLUSTERS.has(lastTwo) ? 2 : 1;
        boundary = nextStart - keep;
      }
    }
    syllables.push(units.slice(cursor, boundary));
    cursor = boundary;
  }
  return syllables;
}

export function syllableText(syl: Syllable): string {
  return syl.map((u) => u.t).join('');
}

/** Index (from the start) of the stressed syllable, from written accents or the default rules. */
export function stressIndex(syllables: Syllable[]): number {
  for (let k = 0; k < syllables.length; k++) {
    if (syllables[k].some((u) => u.v && hasAcute(u.t))) return k;
  }
  if (syllables.length < 2) return 0;
  const lastSyl = syllables[syllables.length - 1];
  const lastUnit = lastSyl[lastSyl.length - 1];
  const last = lastUnit.t[lastUnit.t.length - 1];
  const endsVowelNS = (lastUnit.v && last !== 'y') || last === 'n' || last === 's';
  return endsVowelNS ? syllables.length - 2 : syllables.length - 1;
}

function stressedHiatus(syllables: Syllable[], k: number): boolean {
  const syl = syllables[k];
  const vowelIdx = syl.map((u, i) => (u.v ? i : -1)).filter((i) => i >= 0);
  if (vowelIdx.length === 0 || vowelIdx.some((i) => isStrongUnit(syl[i]))) return false;
  // Only closed vowels: the stressed one is the last (hu-í-a, construí).
  const vi = vowelIdx[vowelIdx.length - 1];
  const base = stripAcute(syl[vi].t);
  if (base !== 'i' && base !== 'u') return false;
  const onset = syl.slice(0, vi);
  const coda = syl.slice(vi + 1);
  if (k > 0 && vowelIdx.length === 1 && onset.every((u) => u.t === 'h')) {
    const prev = syllables[k - 1];
    if (isStrongUnit(prev[prev.length - 1])) return true;
  }
  if (coda.length === 0 && k + 1 < syllables.length) {
    const next = syllables[k + 1];
    const first = next[0]?.t === 'h' ? next[1] : next[0];
    if (isStrongUnit(first)) return true;
  }
  return false;
}

/**
 * Writes a word from its syllables with the stress on syllable `stress`,
 * adding or removing the written accent as the rules require.
 */
export function accentuate(syllables: Syllable[], stress: number): string {
  const syls: Syllable[] = syllables.map((s) => s.map((u) => ({ t: u.v ? stripAcute(u.t) : u.t, v: u.v })));
  const n = syls.length;
  let need: boolean;
  if (stressedHiatus(syls, stress)) need = true;
  else if (n === 1) need = false;
  else {
    const fromEnd = n - 1 - stress;
    const lastSyl = syls[n - 1];
    const lastUnit = lastSyl[lastSyl.length - 1];
    const last = lastUnit.t[lastUnit.t.length - 1];
    const endsVowelNS = (lastUnit.v && last !== 'y') || last === 'n' || last === 's';
    if (fromEnd === 0) need = endsVowelNS;
    else if (fromEnd === 1) need = !endsVowelNS;
    else need = true;
  }
  if (need) {
    const syl = syls[stress];
    const vowels = syl.filter((u) => u.v && u.t !== 'y' && u.t !== 'ü');
    const target = vowels.find((u) => STRONG.has(u.t)) ?? vowels[vowels.length - 1];
    if (target) target.t = PLAIN_TO_ACUTE[target.t] ?? target.t;
  }
  return syls.map(syllableText).join('');
}

/**
 * Attaches an enclitic pronoun to a verb form, keeping its stress:
 * levanta+te → levántate, llamemos+nos (drop s) → llamémonos,
 * llamad+os (drop d) → llamaos, vestid+os → vestíos.
 */
export function attachEnclitic(form: string, pronoun: string, drop?: 's' | 'd'): string {
  const syls = syllabify(form);
  const stress = stressIndex(syls);
  if (drop) {
    const last = syls[syls.length - 1];
    const tail = last[last.length - 1];
    if (tail.t !== drop) throw new Error(`cannot drop "${drop}" from "${form}"`);
    last.pop();
  }
  return accentuate([...syls, ...syllabify(pronoun)], stress);
}

/**
 * Prefixes a conjugated form and re-applies the accent rules:
 * ob+ten → obtén, pre+ves → prevés, son+rio → sonrió, re+huyo → rehúyo.
 * A prefix with no vowel (f+río → frío) joins the first syllable and keeps
 * the base's own spelling.
 */
export function prefixForm(prefix: string, form: string): string {
  if (!prefix) return form;
  const syls = syllabify(form);
  const stress = stressIndex(syls);
  const pre = syllabify(prefix);
  if (!pre.some((s) => s.some((u) => u.v))) return prefix + form;
  return accentuate([...pre, ...syls], stress + pre.length);
}

/**
 * RAE 2010: one-syllable words take no accent (rio, frio, hui, fie, guio,
 * fiais), apart from the diacritic dé and sé. Returns the canonical spelling
 * first and, when it differs, the pre-2010 accented spelling as an accepted
 * alternative.
 */
export function monosyllableVariants(word: string): string[] {
  if (!hasAcute(word) || DIACRITIC_MONOSYLLABLES.has(word)) return [word];
  if (syllabify(word).length !== 1) return [word];
  return [stripAcute(word), word];
}
