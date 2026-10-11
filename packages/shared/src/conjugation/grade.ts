// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Grading of typed answers.
 */
import { foldAccents } from './accent.js';
import { analyze } from './analyze.js';
import { parseEntry } from './conjugate.js';
import type { Person, VerbKind } from './types.js';

export { foldAccents };

export type Grade = 'correct' | 'accent' | 'wrong';

/** Subject pronouns (dots removed) and the person each one is. */
const SUBJECT_PERSON: Record<string, Person> = {
  yo: 'yo',
  tú: 'tu',
  tu: 'tu',
  vos: 'vos',
  él: 'el',
  el: 'el',
  ella: 'el',
  usted: 'el',
  ud: 'el',
  vd: 'el',
  nosotros: 'nosotros',
  nosotras: 'nosotros',
  vosotros: 'vosotros',
  vosotras: 'vosotros',
  ellos: 'ellos',
  ellas: 'ellos',
  ustedes: 'ellos',
  uds: 'ellos',
  vds: 'ellos',
};

/** Lowercase, NFC, trimmed, single-spaced, without surrounding ¡!¿?. punctuation. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[¡¿"'“”]+|[!?.,;"'“”]+$/g, '')
    .trim();
}

function subjectOf(word: string): Person | undefined {
  return SUBJECT_PERSON[word.replace(/\.$/, '')];
}

/** The person a subject pronoun is ("ella" → el, "ustedes" → ellos), or undefined for any other word. */
export function subjectPronounPerson(word: string): Person | undefined {
  return subjectOf(normalizeAnswer(word));
}

/** The pronoun after "a" in an experiencer phrase (a mí, a ellas), with its accented spelling. */
const EXPERIENCER_PERSON: Record<string, { person: Person; spelled: string }> = {
  mí: { person: 'yo', spelled: 'mí' },
  mi: { person: 'yo', spelled: 'mí' },
  ti: { person: 'tu', spelled: 'ti' },
  tí: { person: 'tu', spelled: 'ti' },
  vos: { person: 'vos', spelled: 'vos' },
  él: { person: 'el', spelled: 'él' },
  el: { person: 'el', spelled: 'él' },
  ella: { person: 'el', spelled: 'ella' },
  usted: { person: 'el', spelled: 'usted' },
  ud: { person: 'el', spelled: 'ud' },
  vd: { person: 'el', spelled: 'vd' },
  nosotros: { person: 'nosotros', spelled: 'nosotros' },
  nosotras: { person: 'nosotros', spelled: 'nosotras' },
  vosotros: { person: 'vosotros', spelled: 'vosotros' },
  vosotras: { person: 'vosotros', spelled: 'vosotras' },
  ellos: { person: 'ellos', spelled: 'ellos' },
  ellas: { person: 'ellos', spelled: 'ellas' },
  ustedes: { person: 'ellos', spelled: 'ustedes' },
  uds: { person: 'ellos', spelled: 'uds' },
  vds: { person: 'ellos', spelled: 'vds' },
};

/** The person of the pronoun in an experiencer phrase ("mí" of "a mí" → yo), or undefined. */
export function experiencerPerson(word: string): Person | undefined {
  return EXPERIENCER_PERSON[normalizeAnswer(word).replace(/\.$/, '')]?.person;
}

/** The experiencers each dative clitic can have (te: a ti or a vos). */
const CLITIC_PERSONS: Record<string, Person[]> = {
  me: ['yo'],
  te: ['tu', 'vos'],
  le: ['el'],
  nos: ['nosotros'],
  os: ['vosotros'],
  les: ['ellos'],
};

/**
 * The kinds the accepted forms can be (me gusta → dative; hay → impersonal;
 * me gustaba → dative or pronominal, había → impersonal or plain). Empty when
 * the dictionary cannot place them.
 */
function kindsOf(accepted: string[]): VerbKind[] {
  return [...new Set(accepted.flatMap((a) => analyze(a).map((h) => parseEntry(h.infinitive)?.kind ?? 'plain')))];
}

const RANK: Record<Grade, number> = { wrong: 0, accent: 1, correct: 2 };

/**
 * Grades a typed answer against the accepted forms of a cell.
 *
 * - Case, surrounding spaces, repeated spaces and end punctuation are ignored.
 * - A subject pronoun before the verb ("yo tengo", "yo me llamo", "vos tenés")
 *   or after it, as commands place it ("hable usted", "siéntense ustedes",
 *   "vení vos"), is ignored when it fits the cell's person. The person is
 *   `person` when given, otherwise read from the accepted forms. A pronoun
 *   that does not fit ("yo tiene", "nosotros hablan", "tú tenés" for vos)
 *   makes the answer wrong.
 * - Dative cells (kind 'dative', or accepted forms that are only ever
 *   dative, like "me gusta"): no subject pronoun ("yo me gusta" is wrong);
 *   an experiencer phrase that agrees is optional, before the clitic or after
 *   the verb ("a mí me gusta", "a ellas les gustan", "me gusta a mí", "a vos
 *   te gusta"), one that does not is wrong ("a ti me gusta"; "a ti" for a vos
 *   cell and "a vos" for a tú one when `person` is given). The clitic is required: "gusta"
 *   for "me gusta" is wrong. "a mi" / "a tí" are accent slips.
 * - Impersonal cells (hay, llueve): exactly the form, no subject pronoun.
 * - Without `kind`, forms that more than one kind produces (me gustaba:
 *   gustarle yo and gustarse yo; había: haber-impersonal and haber él) are
 *   graded by every one of those kinds and the best grade wins: "a mí me
 *   gustaba" and "yo me gustaba" are both right for some cell with those
 *   forms. Pass `kind` (entryKind of the drilled entry) to grade one cell
 *   exactly: then "yo me gustaba" is wrong for gustarle and "él había" for
 *   haber-impersonal.
 * - An answer that matches only once accents are folded is 'accent' (a near
 *   miss) with strictAccents=true. With strictAccents=false it is 'correct',
 *   unless the typed word is itself another form of the same verb ("hablo"
 *   for "habló", "hable" for "hablé"): that is a conjugation error, so it is
 *   'accent'. ñ is never folded (mañana ≠ manana); a missing diaeresis
 *   (averigüe vs averigue) counts as an accent difference.
 */
export function gradeTyped(
  accepted: string[],
  given: string,
  strictAccents: boolean,
  person?: Person,
  kind?: VerbKind,
): Grade {
  const acc = accepted.map(normalizeAnswer).filter((a) => a.length > 0);
  const answer = normalizeAnswer(given);
  if (!answer || acc.length === 0) return 'wrong';
  if (kind) return gradeAs(kind, acc, answer, strictAccents, person);
  const kinds = kindsOf(acc);
  if (kinds.length <= 1) return gradeAs(kinds[0] ?? 'plain', acc, answer, strictAccents, person);
  let best: Grade = 'wrong';
  for (const k of kinds) {
    const grade = gradeAs(k, acc, answer, strictAccents, person);
    if (RANK[grade] > RANK[best]) best = grade;
  }
  return best;
}

/** An experiencer phrase ("a mí", "a ellas") at `i`, `i + 1` of the words. */
function experiencerAt(words: string[], i: number): { person: Person; spelled: string } | undefined {
  return words[i] === 'a' ? EXPERIENCER_PERSON[(words[i + 1] ?? '').replace(/\.$/, '')] : undefined;
}

function gradeAs(kind: VerbKind, acc: string[], answer: string, strictAccents: boolean, person?: Person): Grade {
  if (kind === 'dative') {
    const words = answer.split(' ');
    const n = words.length;
    // Before the clitic ("a mí me gusta") or after the verb ("me gusta a mí").
    const before = n > 2 ? experiencerAt(words, 0) : undefined;
    const after = !before && n > 2 ? experiencerAt(words, n - 2) : undefined;
    if (!before && !after && (words[0] === 'a' || words[n - 2] === 'a') && n > 2) return 'wrong';
    const experiencer = before ?? after;
    let slip = false;
    let rest = answer;
    if (experiencer) {
      const targets = person ? [person] : CLITIC_PERSONS[acc[0].split(' ')[0]];
      if (targets && !targets.includes(experiencer.person)) return 'wrong';
      const at = before ? 1 : n - 1;
      slip = words[at].replace(/\.$/, '') !== experiencer.spelled;
      rest = (before ? words.slice(2) : words.slice(0, -2)).join(' ');
    }
    const grade = compare(acc, [rest], strictAccents, false);
    return grade === 'correct' && slip && strictAccents ? 'accent' : grade;
  }
  if (kind === 'impersonal') return compare(acc, [answer], strictAccents, false);

  let persons: Set<Person> | null = null;
  const fits = (p: Person): boolean => {
    if (person) return p === person;
    persons ??= new Set(acc.flatMap((a) => analyze(a).map((h) => h.person)));
    // A form the dictionary cannot place (an unknown verb) is not checked.
    return persons.size === 0 || persons.has(p);
  };
  const foldedWords = (i: number): Set<string> =>
    new Set(acc.map((a) => a.split(' ')).map((w) => foldAccents(w[i < 0 ? w.length + i : i] ?? '')));

  const candidates = [answer];
  const words = answer.split(' ');
  if (words.length > 1) {
    const first = subjectOf(words[0]);
    const last = subjectOf(words[words.length - 1]);
    const leading = first && !foldedWords(0).has(foldAccents(words[0]));
    const trailing = last && !foldedWords(-1).has(foldAccents(words[words.length - 1]));
    if (leading && fits(first)) candidates.push(words.slice(1).join(' '));
    else if (trailing && fits(last)) candidates.push(words.slice(0, -1).join(' '));
  }

  return compare(acc, candidates, strictAccents, isVosCell(acc, person));
}

/**
 * Whether the cell is a vos one: `person` when given, else accepted forms that
 * read as vos and not as tú (hablás, levantate; not hablabas, which is both).
 */
function isVosCell(acc: string[], person?: Person): boolean {
  if (person) return person === 'vos';
  const persons = new Set(acc.flatMap((a) => analyze(a).map((h) => h.person)));
  return persons.has('vos') && !persons.has('tu');
}

/**
 * Grades normalized candidate answers against normalized accepted forms (see
 * gradeTyped on accents). A voseo form only counts as "another form of the
 * verb" in a vos cell: "levantate" for "levántate" is an accent slip in a class
 * that drills tú, but "hablas" for "hablás" is the tú form in a vos cell.
 */
function compare(acc: string[], candidates: string[], strictAccents: boolean, vosCell: boolean): Grade {
  if (candidates.some((c) => acc.includes(c))) return 'correct';
  const folded = new Set(acc.map(foldAccents));
  const near = candidates.filter((c) => folded.has(foldAccents(c)));
  if (!near.length) return 'wrong';
  if (strictAccents) return 'accent';
  const verbs = new Set(acc.flatMap((a) => analyze(a).map((h) => h.infinitive)));
  const otherForm = near.some((c) => analyze(c).some((h) => verbs.has(h.infinitive) && (vosCell || h.person !== 'vos')));
  return otherForm ? 'accent' : 'correct';
}
