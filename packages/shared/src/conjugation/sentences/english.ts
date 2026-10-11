// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * English verb forms for the feedback translation. Only the tenses with a
 * plain English equivalent have one; subjunctives and commands return null
 * (no English is shown).
 */
import type { Tense } from '../types.js';
import type { EnPerson } from './types.js';

interface EnVerb {
  base: string;
  s: string;
  past: string;
  pp: string;
  ing: string;
  /** Stative verbs: the imperfect is the simple past ("lived"), not "used to". */
  state?: boolean;
}

const v = (base: string, s: string, past: string, pp: string, ing: string, state = false): EnVerb => ({
  base,
  s,
  past,
  pp,
  ing,
  state,
});

export const EN_VERBS: Record<string, EnVerb> = {
  be: v('be', 'is', 'was', 'been', 'being', true),
  have: v('have', 'has', 'had', 'had', 'having', true),
  go: v('go', 'goes', 'went', 'gone', 'going'),
  want: v('want', 'wants', 'wanted', 'wanted', 'wanting', true),
  like: v('like', 'likes', 'liked', 'liked', 'liking', true),
  look: v('look', 'looks', 'looked', 'looked', 'looking', true),
  live: v('live', 'lives', 'lived', 'lived', 'living', true),
  study: v('study', 'studies', 'studied', 'studied', 'studying'),
  work: v('work', 'works', 'worked', 'worked', 'working'),
  speak: v('speak', 'speaks', 'spoke', 'spoken', 'speaking'),
  talk: v('talk', 'talks', 'talked', 'talked', 'talking'),
  listen: v('listen', 'listens', 'listened', 'listened', 'listening'),
  read: v('read', 'reads', 'read', 'read', 'reading'),
  write: v('write', 'writes', 'wrote', 'written', 'writing'),
  learn: v('learn', 'learns', 'learned', 'learned', 'learning'),
  teach: v('teach', 'teaches', 'taught', 'taught', 'teaching'),
  watch: v('watch', 'watches', 'watched', 'watched', 'watching'),
  see: v('see', 'sees', 'saw', 'seen', 'seeing', true),
  hear: v('hear', 'hears', 'heard', 'heard', 'hearing', true),
  say: v('say', 'says', 'said', 'said', 'saying'),
  do: v('do', 'does', 'did', 'done', 'doing'),
  need: v('need', 'needs', 'needed', 'needed', 'needing', true),
  know: v('know', 'knows', 'knew', 'known', 'knowing', true),
  understand: v('understand', 'understands', 'understood', 'understood', 'understanding', true),
  think: v('think', 'thinks', 'thought', 'thought', 'thinking'),
  believe: v('believe', 'believes', 'believed', 'believed', 'believing', true),
  start: v('start', 'starts', 'started', 'started', 'starting'),
  arrive: v('arrive', 'arrives', 'arrived', 'arrived', 'arriving'),
  eat: v('eat', 'eats', 'ate', 'eaten', 'eating'),
  drink: v('drink', 'drinks', 'drank', 'drunk', 'drinking'),
  buy: v('buy', 'buys', 'bought', 'bought', 'buying'),
  sell: v('sell', 'sells', 'sold', 'sold', 'selling'),
  pay: v('pay', 'pays', 'paid', 'paid', 'paying'),
  cost: v('cost', 'costs', 'cost', 'cost', 'costing', true),
  order: v('order', 'orders', 'ordered', 'ordered', 'ordering'),
  ask: v('ask', 'asks', 'asked', 'asked', 'asking'),
  give: v('give', 'gives', 'gave', 'given', 'giving'),
  put: v('put', 'puts', 'put', 'put', 'putting'),
  set: v('set', 'sets', 'set', 'set', 'setting'),
  bring: v('bring', 'brings', 'brought', 'brought', 'bringing'),
  carry: v('carry', 'carries', 'carried', 'carried', 'carrying'),
  take: v('take', 'takes', 'took', 'taken', 'taking'),
  open: v('open', 'opens', 'opened', 'opened', 'opening'),
  close: v('close', 'closes', 'closed', 'closed', 'closing'),
  prefer: v('prefer', 'prefers', 'preferred', 'preferred', 'preferring', true),
  thank: v('thank', 'thanks', 'thanked', 'thanked', 'thanking'),
  feed: v('feed', 'feeds', 'fed', 'fed', 'feeding'),
  plan: v('plan', 'plans', 'planned', 'planned', 'planning'),
  // modal: handled apart
  can: v('can', 'can', 'could', 'been able to', 'being able to', true),
};

const BE_PRESENT: Record<EnPerson, string> = { '1sg': 'am', '2': 'are', '3sg': 'is', '1pl': 'are', '3pl': 'are' };
const BE_PAST: Record<EnPerson, string> = { '1sg': 'was', '2': 'were', '3sg': 'was', '1pl': 'were', '3pl': 'were' };

function present(verb: EnVerb, p: EnPerson): string {
  if (verb.base === 'be') return BE_PRESENT[p];
  if (verb.base === 'can') return 'can';
  return p === '3sg' ? verb.s : verb.base;
}

/**
 * The English verb phrase for a tense and person: "lives", "lived", "used to
 * live", "will live", "has lived", "is living"; null for the tenses without an
 * English template (subjunctives, commands).
 */
export function englishVerb(key: string, tense: Tense, p: EnPerson): string | null {
  const verb = EN_VERBS[key];
  if (!verb) return null;
  const modal = verb.base === 'can';
  switch (tense) {
    case 'present':
      return present(verb, p);
    case 'preterite':
      return verb.base === 'be' ? BE_PAST[p] : verb.past;
    case 'imperfect':
      if (verb.base === 'be') return BE_PAST[p];
      return verb.state || modal ? verb.past : `used to ${verb.base}`;
    case 'future':
      return modal ? 'will be able to' : `will ${verb.base}`;
    case 'conditional':
      return modal ? 'could' : `would ${verb.base}`;
    case 'presentPerfect':
      return `${p === '3sg' ? 'has' : 'have'} ${verb.pp}`;
    case 'pluperfect':
      return `had ${verb.pp}`;
    case 'presentProgressive':
      return modal ? null : `${BE_PRESENT[p]} ${verb.ing}`;
    default:
      return null;
  }
}

/** The negative present, contracted as people say it ("doesn't like", "aren't", "am not"); null outside the present. */
export function englishNegative(key: string, tense: Tense, p: EnPerson): string | null {
  const verb = EN_VERBS[key];
  if (!verb || tense !== 'present') return null;
  if (verb.base === 'be') return p === '1sg' ? 'am not' : p === '3sg' ? "isn't" : "aren't";
  if (verb.base === 'can') return "can't";
  return `${p === '3sg' ? "doesn't" : "don't"} ${verb.base}`;
}

/** "There is / there are / there was…" for hay sentences. */
export function englishThere(tense: Tense, number: 'sg' | 'pl'): string | null {
  const p: EnPerson = number === 'sg' ? '3sg' : '3pl';
  const be = englishVerb('be', tense, p);
  return be === null ? null : `there ${be}`;
}

const POSSESSIVE: Record<string, string> = {
  i: 'my',
  you: 'your',
  'you all': 'your',
  'you (formal)': 'your',
  he: 'his',
  she: 'her',
  we: 'our',
  they: 'their',
};

/**
 * The possessive determiner that refers back to the subject ("I do my homework",
 * "Ana does her homework", "my cousins do their homework").
 */
export function subjectPossessive(s: { enPerson: EnPerson; gender: 'm' | 'f' | 'x'; en: string }): string {
  if (s.enPerson === '1sg') return 'my';
  if (s.enPerson === '2') return 'your';
  if (s.enPerson === '1pl') return 'our';
  if (s.enPerson === '3pl') return 'their';
  return s.gender === 'm' ? 'his' : s.gender === 'f' ? 'her' : 'their';
}

/** "my", "your", "my cousin's", "my cousins'". */
export function englishPossessive(subjectEn: string): string {
  const low = subjectEn.toLowerCase();
  if (POSSESSIVE[low]) return POSSESSIVE[low];
  return subjectEn.endsWith('s') && !/^[A-Z]/.test(subjectEn) ? `${subjectEn}'` : `${subjectEn}'s`;
}
