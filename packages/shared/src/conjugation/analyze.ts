// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Reverse lookup: which dictionary entry, tense and person a written form is.
 * The index covers every entry of lexiconEntries(): the dictionary verbs
 * (weather verbs as impersonal entries), the pronominal verbs in
 * REFLEXIVE_VERBS, the dative entries of DATIVE_VERBS (me gusta → gustarle)
 * and haber-impersonal (hay), in all twelve tenses and every accepted
 * alternative. It is built lazily on first use and kept for the life of the
 * process.
 */
import { foldAccents } from './accent.js';
import { conjugate, lexiconEntries, parseEntry } from './conjugate.js';
import { NUMBER_IDS, TENSES, VOS_REGIONS, type GNumber, type Person, type Tense, type VosRegion } from './types.js';

export interface Analysis {
  /** The entry id: hablar, llamarse, gustarle, haber-impersonal. */
  infinitive: string;
  tense: Tense;
  /** The subject, or for a dative entry the experiencer (me gusta → yo). */
  person: Person;
  /** Dative entries only: the number of the thing liked (me gustan → pl). */
  number?: GNumber;
  /**
   * vos readings only: the regions whose vos cell accepts the form, canonical
   * or not (sos, hablás, hablés, hables: both; see VosRegion).
   */
  regions?: VosRegion[];
}

const same = (a: Analysis, b: Analysis): boolean =>
  a.infinitive === b.infinitive && a.tense === b.tense && a.person === b.person && a.number === b.number;

let index: Map<string, Analysis[]> | null = null;
let foldedIndex: Map<string, Analysis[]> | null = null;

/** Lowercase, trimmed, single-spaced; accents are kept (lookup is accent-exact). */
export function normalizeForm(s: string): string {
  return s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The accepted forms of a cell, each with the vos regions that accept it (vos only). */
function cellForms(
  infinitive: string,
  tense: Tense,
  person: Person,
  number: GNumber | undefined,
): { form: string; regions?: VosRegion[] }[] {
  if (person !== 'vos') return (conjugate(infinitive, tense, person, number) ?? []).map((form) => ({ form }));
  const byForm = new Map<string, VosRegion[]>();
  for (const { id } of VOS_REGIONS) {
    for (const form of conjugate(infinitive, tense, person, number, { vosRegion: id }) ?? []) {
      const regions = byForm.get(form) ?? [];
      if (!regions.includes(id)) regions.push(id);
      byForm.set(form, regions);
    }
  }
  return [...byForm].map(([form, regions]) => ({ form, regions }));
}

function buildIndex(): Map<string, Analysis[]> {
  const map = new Map<string, Analysis[]>();
  for (const infinitive of lexiconEntries()) {
    const dative = parseEntry(infinitive)?.kind === 'dative';
    for (const tense of TENSES) {
      for (const person of tense.persons) {
        for (const number of dative ? NUMBER_IDS : [undefined]) {
          for (const { form, regions } of cellForms(infinitive, tense.id, person, number)) {
            const hit: Analysis = { infinitive, tense: tense.id, person };
            if (number) hit.number = number;
            if (regions) hit.regions = regions;
            const key = normalizeForm(form);
            const list = map.get(key);
            if (!list) map.set(key, [hit]);
            else if (!list.some((h) => same(h, hit))) list.push(hit);
          }
        }
      }
    }
  }
  return map;
}

/**
 * Every (entry, tense, person[, number]) whose accepted forms include `form`;
 * vos readings say which regions accept it ("sos" → ser present vos, both;
 * "hablés" → hablar presentSubjunctive vos, both: canonical in Central
 * America, an accepted alternative in the Río de la Plata). A tú form that is
 * also vos's (hablabas, hablaste) reads as both persons.
 * Case- and whitespace-insensitive, accent-exact ("esta" is not "está").
 * Every kind that produces the form is returned: "gusto" → gustar,
 * "me gusto" → gustarse, "me gusta" → gustarle (yo, sg), "le gustan" →
 * gustarle (el, pl), "hay" → haber-impersonal (plain haber is "ha").
 */
export function analyze(form: string): Analysis[] {
  if (!index) index = buildIndex();
  return (index.get(normalizeForm(form)) ?? []).map(copy);
}

/**
 * Builds the reverse indexes now instead of on the first analyze (detection
 * reads both): about a second of synchronous CPU, which a server should pay at
 * boot rather than inside the first request after it. Idempotent: later calls
 * cost nothing. Returns the number of distinct forms indexed.
 */
export function warmUp(): number {
  analyzeIgnoringAccents('');
  return index?.size ?? 0;
}

function copy(a: Analysis): Analysis {
  return a.regions ? { ...a, regions: [...a.regions] } : { ...a };
}

/**
 * Like analyze, but ignoring accents ("comio" → comió, "estas" → estás), for
 * decks typed without them. Returns every reading of every form that folds
 * to the same letters, so callers must narrow it with other evidence.
 */
export function analyzeIgnoringAccents(form: string): Analysis[] {
  if (!index) index = buildIndex();
  if (!foldedIndex) {
    foldedIndex = new Map();
    for (const [key, hits] of index) {
      const folded = foldAccents(key);
      const list = foldedIndex.get(folded) ?? [];
      for (const h of hits) {
        const twin = list.find((x) => same(x, h));
        if (!twin) list.push({ ...h, ...(h.regions ? { regions: [...h.regions] } : {}) });
        else if (h.regions && twin.regions) {
          // "hablas" folds onto both hablas (tú) and hablás (vos): the regions of every form it stands for.
          twin.regions = VOS_REGIONS.map((r) => r.id).filter((r) => twin.regions?.includes(r) || h.regions?.includes(r));
        }
      }
      foldedIndex.set(folded, list);
    }
  }
  return (foldedIndex.get(foldAccents(normalizeForm(form))) ?? []).map(copy);
}
