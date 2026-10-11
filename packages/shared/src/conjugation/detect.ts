// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Finds the verbs in a deck.
 *
 * Decks hold Spanish on the front and English on the back, and mostly hold
 * conjugated forms ("tengo | I have") rather than infinitives. Many nouns and
 * adjectives are also real verb forms (bajo, pelo, nombre, uno), so a front
 * that analyses as a verb only counts when the English back reads like a verb
 * too: "to ...", a subject + verb ("I have", "he/she likes"), a bare
 * third-person verb ("lives", "has"), is/are/am ("is named", "my name is"),
 * "there is", a command ("Come!"), or a parenthetical infinitive ("(ser)"),
 * which also picks the verb when a form is ambiguous. Fronts may carry a
 * subject pronoun ("yo hablo"), an attached "(se)" ("levantar(se)"), or be a
 * phrase led by the verb ("escribir cuentos | to write stories", "¡Ven aquí!").
 * Voseo fronts (sos, tenés, vení, te llamás, vos hablás, a vos te gusta) map
 * to the same entries as the other persons.
 * Accents missing from a front ("comio | he ate") are tolerated when the
 * gloss is plainly a verb.
 *
 * Each verb is keyed to the way the deck uses it (see VerbKind):
 *  - a clitic agreeing with the verb (me llamo, se llama, se ve) → the
 *    pronominal entry (llamarse, verse);
 *  - me/te/le/nos/os/les on a third-person form whose subject is the thing,
 *    not the clitic's person (me gusta, les gustan, me duele, me queda | it
 *    fits me) → the dative entry (gustarle, dolerle, quedarle);
 *  - an object clitic on an ordinary verb (le escribo | I write to him, te
 *    llamo | I call you), or no clitic → the plain entry;
 *  - hay / había / hubo… glossed "there is / was…" → haber-impersonal;
 *    weather verbs → their impersonal entry (llover).
 */
import { analyze, analyzeIgnoringAccents, type Analysis } from './analyze.js';
import { canonicalEntry, conjugate, isKnownVerb, parseEntry } from './conjugate.js';
import { foldAccents, syllabify } from './accent.js';
import { DATIVE_VERBS, GUSTAR_TYPE, IMPERSONAL_BASES, WEATHER_VERBS } from './lexicon.js';
import type { Person, VerbKind } from './types.js';

export interface DeckCard {
  id?: number;
  front: string;
  back: string;
}

export interface DetectedVerb {
  infinitive: string;
  cards: DeckCard[];
  excludedByDefault: boolean;
  note?: string;
}

export const NOTE_UNKNOWN = 'not in the dictionary: conjugated as a regular verb — check the forms';
/** Kept for callers of the old API; nothing is excluded for being gustar-type any more (see dativeNote). */
export const NOTE_GUSTAR = 'gustar-type verb: not conjugated by subject';
export const NOTE_HAY = 'impersonal: practiced as hay / había / hubo…';
export const NOTE_WEATHER = 'impersonal: practiced only in the third person singular (llueve, nieva…)';

/**
 * The note of a dative entry: 'used with me/te/le: practiced as "me gusta(n)"',
 * or both forms when the plural is not the singular + n ("me es / me son").
 */
export function dativeNote(entry: string): string {
  const sg = conjugate(entry, 'present', 'yo', 'sg')?.[0] ?? entry;
  const pl = conjugate(entry, 'present', 'yo', 'pl')?.[0];
  const forms = !pl || pl === `${sg}n` ? `${sg}(n)` : `${sg} / ${pl}`;
  return `used with me/te/le: practiced as "${forms}"`;
}

/** The note of an impersonal entry: NOTE_HAY, NOTE_WEATHER, or its own forms (amanece / amaneció…). */
export function impersonalNote(entry: string): string {
  const parsed = parseEntry(entry);
  if (!parsed) return NOTE_WEATHER;
  if (parsed.id === 'haber-impersonal') return NOTE_HAY;
  if (WEATHER_VERBS.has(parsed.id)) return NOTE_WEATHER;
  const present = conjugate(parsed.id, 'present', 'el')?.[0];
  const preterite = conjugate(parsed.id, 'preterite', 'el')?.[0];
  return `impersonal: practiced as ${present} / ${preterite}…`;
}

const kindOf = (entry: string): VerbKind => parseEntry(entry)?.kind ?? 'plain';

// English verbs a Spanish gloss is likely to use. Deliberately leaves out
// words that are mostly nouns in glosses (name, number, eye, color, ...).
const ENGLISH_BASE = `
accept add admire allow answer appear arrive ask attend bathe become begin believe belong borrow break
bring brush build burn buy call can care carry catch celebrate change chat check choose clean climb
close comb come complain continue cook correct cost count cover create cross cry cut dance decide
defend deliver describe deserve design destroy die discover dive do draw dream dress drink drive
dry earn eat enjoy enter escape exercise exist explain fall feel fight fill find finish fit fix fly
follow forget forgive fry get give go graduate greet grow guess hang happen hate have hear help hide
hit hold hope hug hurry hurt imagine improve include invite jog join jump keep kick kill kiss know
laugh learn leave lend let lie like listen live look lose love make marry matter meet mention miss
move need obey offer open order organize own paint pass pay perform pick plan plant play practice
pray prefer prepare pretend print promise protect prove pull push put quit rain reach read receive
recognize recommend relax remember rent repeat rest return ride ring rise run save say scream search
see seem sell send serve set sew shave shine shop shout show shower sing sit skate ski sleep smell
smile snow solve speak spend stand start stay steal stop study succeed suggest surf swim take talk
taste teach tell thank think throw touch translate travel try turn understand use visit wait wake
walk want wash watch wear win wish work worry write yell
`
  .trim()
  .split(/\s+/);

const ENGLISH_IRREGULAR = `
is am are was were has had does did goes went said got made knew thought took saw came gave told felt
became left put meant kept let began brought wrote sat stood lost paid met set led understood spoke
read grew won bought built fell cut sent drew chose caught taught sang swam slept woke drank wore drove
rode flew threw fought forgot hid hung heard ran ate broke found held sold spent lay laid dove shone
`
  .trim()
  .split(/\s+/);

function thirdPerson(v: string): string {
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + 'es';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ies';
  return v + 's';
}

function pastTense(v: string): string {
  if (v.endsWith('e')) return v + 'd';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ied';
  return v + 'ed';
}

const ENGLISH_FINITE = new Set<string>([
  ...ENGLISH_IRREGULAR,
  ...ENGLISH_BASE.map(thirdPerson),
  ...ENGLISH_BASE.map(pastTense),
]);
const ENGLISH_ANY = new Set<string>([
  ...ENGLISH_FINITE,
  ...ENGLISH_BASE,
  "'m", "'re", "'s", 'will', 'would', 'could', 'should', 'must', 'may', 'might', 'do', "don't", "doesn't",
]);

const ENGLISH_BASE_SET = new Set<string>([...ENGLISH_BASE, 'be']);

/**
 * English verbs that gloss the gustar construction with the thing as subject
 * ("it fits me", "they hurt", "it seems to me"), in every form. An ordinary
 * verb with an object clitic ("me muerde | it bites me", "me escriben | they
 * write to me") is glossed with some other verb.
 */
const DATIVE_ENGLISH = new Set<string>(
  `please appeal suit fit hurt ache seem bore worry interest bother annoy fascinate matter suffice remain lack
  delight disgust displease excite surprise scare frighten tempt thrill amaze upset attract enchant charm bug
  concern happen belong itch sting cost`
    .trim()
    .split(/\s+/)
    .flatMap((v) => [v, thirdPerson(v), pastTense(v)])
    .concat(['fitted', 'left', 'enough', 'missing', 'turn', "turn's"]),
);

/**
 * English that marks the dative sense of a verb that is also pronominal, when
 * a form is both (me gustaría: gustarle yo, gustarse yo; me caía: caerle,
 * caerse). Verbs of GUSTAR_TYPE take the dative sense unless the gloss is
 * reflexive; the others (me preocupaba | I was worried) take the pronominal
 * one unless the gloss says otherwise.
 */
const DATIVE_SENSE: Record<string, string[]> = {
  gustar: ['like', 'likes', 'liked', 'please', 'pleases', 'pleased'],
  caer: ['like', 'likes', 'liked', 'dislike', 'dislikes', 'disliked'],
  parecer: ['seem', 'seems', 'seemed', 'think', 'thinks', 'thought', 'opinion'],
  quedar: ['fit', 'fits', 'fitted', 'suit', 'suits', 'suited', 'left'],
  pasar: ['happen', 'happens', 'happened'],
};

/** The weather, for hacer-impersonal (hace frío | it's cold, ¿qué tiempo hace? | what's the weather like?). */
const WEATHER_GLOSS = /\b(weather|cold|hot|warm|cool|chilly|sunny|windy|cloudy|humid|degrees|nice out|bad out)\b/;

/** Words that can follow a subject pronoun in a gloss without being a verb. */
const NOT_VERBS = new Set([
  'and', 'or', 'all', 'both', 'too', 'also', 'the', 'a', 'an', 'formal', 'informal', 'plural', 'singular', 'guys',
  'two', 'yourself', 'myself', 'himself', 'herself', 'itself', 'ourselves', 'themselves', 'yourselves', 'not',
  'only', 'alone', 'here', 'there', 'please', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'very', 'so', 'later',
  'soon', 'again', 'much', 'more', 'well', 'today', 'tomorrow', 'now', 'that', 'who',
]);

const PRONOUN_PERSONS: Record<string, Person[]> = {
  i: ['yo'],
  you: ['tu', 'vos', 'el', 'vosotros', 'ellos'],
  "y'all": ['vosotros', 'ellos'],
  usted: ['el'],
  ustedes: ['ellos'],
  he: ['el'],
  she: ['el'],
  it: ['el'],
  we: ['nosotros'],
  they: ['ellos'],
};

const SUBJECTS = "i|you|he|she|it|we|they|y'all|usted|ustedes";
// Subject + verb: "i have", "he/she/it is", "you (all) like", "you guys speak".
const SUBJECT_VERB = new RegExp(
  `\\b(${SUBJECTS})((?:\\s*/\\s*(?:${SUBJECTS}))*)(?:\\s+(?:all|guys|two|both))?\\s+([a-z']+)`,
  'g',
);

/** Words before "is/are" that make it part of a relative clause ("a story that is told"), not the gloss's verb. */
const RELATIVE = new Set(['that', 'which', 'who', 'where', 'what', 'when', 'one']);

/** Parenthesised labels that happen to be verbs: "(regular)" describes the card, it does not name regular. */
const PAREN_LABELS = new Set(['regular']);

/** Spanish subject pronouns a front may start with ("yo hablo", "Ud. habla"); dots are already gone. */
const SPANISH_SUBJECTS: Record<string, Person> = {
  yo: 'yo',
  tú: 'tu',
  tu: 'tu',
  vos: 'vos',
  él: 'el',
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

/**
 * English words that tell apart verbs sharing forms: creo (crear / creer),
 * vendo (vendar / vender), fui (ser / ir), siento (sentar / sentir), miento
 * (mentar / mentir), fundo (fundar / fundir), ve (ir / ver), di (dar / decir),
 * ven (venir / ver).
 */
const GLOSS_HINTS: Record<string, string[]> = Object.fromEntries(
  Object.entries({
    crear: 'create creates created creating',
    creer: 'believe believes believed believing think thinks thought',
    vendar: 'bandage bandages bandaged bandaging',
    vender: 'sell sells sold selling',
    ser: 'be am is are was were been being',
    ir: 'go goes went going gone',
    // vos andá is both ir's command (NGLE §4.7) and andar's; "walk!" is andar's.
    andar: 'walk walks walked walking',
    ver: 'see sees saw seen seeing watch watches watched watching look looks looked',
    sentar: 'sit sits sat sitting seat seats seated',
    sentir: 'feel feels felt feeling sorry regret regrets regretted',
    mentar: 'mention mentions mentioned',
    mentir: 'lie lies lied lying',
    fundar: 'found founds founded founding',
    fundir: 'melt melts melted melting',
    dar: 'give gives gave given giving',
    decir: 'say says said saying tell tells told telling',
    venir: 'come comes came coming',
  }).map(([verb, words]) => [verb, words.split(' ')]),
);

interface Gloss {
  evidence: boolean;
  persons: Set<Person>;
  isInfinitive: boolean;
  /** Starts with an English base verb: "eat", "Get up", "Listen (pl.)". */
  bareVerb: boolean;
  imperative: boolean;
  /** "there is / was / will be ...": impersonal haber. */
  there: boolean;
  /** "dawn breaks", "it gets dark": the impersonal daybreak verbs (amanece, anochece). */
  daybreak: boolean;
  /** "it bores me", "they fit me", "it's his turn": the gustar construction. */
  itSubject: boolean;
  /** A gustar-type English verb ("fits", "hurt", "seems") or "it … for me": see DATIVE_ENGLISH. */
  dativeEnglish: boolean;
  /** "myself", "each other": a reflexive or reciprocal gloss (me gusto | I like myself). */
  reflexive: boolean;
  /** "it's cold", "the weather is nice": weather hacer (hace frío). */
  weather: boolean;
  /** "to him", "for you": an indirect object, so "se lo" is the dative se (se lo doy | I give it to him). */
  toSomeone: boolean;
  words: Set<string>;
  paren: string[];
  /** The gloss without its parenthesised notes, lowercase. */
  text: string;
}

function readGloss(back: string): Gloss {
  const b = back.normalize('NFC').toLowerCase().trim().replace(/^\(to\)\s*/, 'to ');
  // Parenthesised notes ("you (formal) speak", "they/you (pl.) speak") are read apart.
  const plain = b.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const persons = new Set<Person>();
  let evidence = false;

  const paren = [...b.matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(/\s*[/,;]\s*/))
    .map((s) => s.trim())
    .filter((s) => !PAREN_LABELS.has(s) && isKnownVerb(s))
    .map((s) => canonicalEntry(s) as string);
  if (paren.length) evidence = true;

  const isInfinitive = /^to\s+[a-z]/.test(b);
  if (isInfinitive) evidence = true;

  for (const m of plain.matchAll(SUBJECT_VERB)) {
    const verb = m[3];
    // After a subject pronoun almost any word is a verb ("I peel", "you iron"); skip the few that are
    // not. He/she/it take a finite verb, so there the word must look like one ("irons", "went").
    // "please" after "you" is politeness ("thank you please"); after I/he/we it is the verb ("gusto | I please").
    if (NOT_VERBS.has(verb) && !(verb === 'please' && m[1] !== 'you')) continue;
    if (/^(he|she|it)$/.test(m[1]) && !ENGLISH_ANY.has(verb) && !/(s|ed)$/.test(verb)) continue;
    evidence = true;
    const pronouns = [m[1], ...m[2].split('/').map((s) => s.trim()).filter(Boolean)];
    for (const p of pronouns) for (const person of PRONOUN_PERSONS[p] ?? []) persons.add(person);
  }
  // Contractions: "i'm", "you're", "he's", "they're".
  for (const m of plain.matchAll(/\b(i|you|he|she|it|we|they)'(m|re|s)\b/g)) {
    evidence = true;
    for (const person of PRONOUN_PERSONS[m[1]] ?? []) persons.add(person);
  }

  const words = plain.split(/[^a-z']+/).filter(Boolean);
  const firstWord = plain.match(/^[a-z']+/)?.[0] ?? '';
  const there =
    /^there(?:'s|'re| is| isn't| are| aren't| was| wasn't| were| weren't| will be| won't be| would be| wouldn't be| has been| have been| had been| used to be)(?![a-z'])/.test(
      plain,
    );
  if (there) {
    evidence = true;
    persons.add('el');
  }
  if (firstWord === 'is' || firstWord === 'was' || firstWord === 'has') {
    evidence = true;
    persons.add('el');
  } else if (firstWord === 'am') {
    evidence = true;
    persons.add('yo');
  } else if (firstWord === 'are' || firstWord === 'were') {
    evidence = true;
    for (const p of ['tu', 'vos', 'nosotros', 'vosotros', 'ellos'] as Person[]) persons.add(p);
  } else if (firstWord && ENGLISH_FINITE.has(firstWord) && firstWord !== 'read' && firstWord !== 'put') {
    evidence = true;
    if (/s$/.test(firstWord) && !/ed$/.test(firstWord)) persons.add('el');
  }
  // "my name is": is/are near the start, not inside a relative clause ("a story that is told").
  words.slice(0, 3).forEach((w, i) => {
    if (/^(am|is|are)$/.test(w) && !(i > 0 && RELATIVE.has(words[i - 1]))) evidence = true;
  });
  if (/^my\b/.test(plain)) persons.add('yo');
  if (/^(his|her|its)\b/.test(plain)) persons.add('el');
  const daybreak = /\b(dawn|dawns|daybreak|day breaks|gets? (light|dark)|getting (light|dark)|night falls|dusk)\b/.test(plain);
  if (daybreak) {
    evidence = true;
    persons.add('el');
  }
  const imperative = /^(don't|do not|let's|let us)\b/.test(b) || /!\s*$/.test(b);
  if (imperative) evidence = true;
  const weather = WEATHER_GLOSS.test(plain);
  if (weather && /\bweather\b/.test(plain)) {
    evidence = true;
    persons.add('el');
  }
  const itSubject = /^(it|it's|they|this|that|these|those)\b/.test(plain);
  const dativeEnglish =
    itSubject &&
    (words.some((w) => DATIVE_ENGLISH.has(w)) ||
      (/^(it|it's|this|that)\b/.test(plain) && /\bfor (me|you|him|her|us|them)\b/.test(plain)));

  return {
    evidence,
    persons,
    isInfinitive,
    bareVerb: !isInfinitive && ENGLISH_BASE_SET.has(firstWord),
    imperative,
    there,
    daybreak,
    itSubject,
    dativeEnglish,
    reflexive: /\b(myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself|each other|one another)\b/.test(plain),
    weather,
    toSomeone: /\b(to|for) (him|her|them|you)\b/.test(plain),
    words: new Set(words),
    paren,
    text: plain,
  };
}

/** Splits a front into its alternatives ("el / la", "uno, dos, tres…") and cleans each. */
function alternatives(front: string): string[] {
  return front
    .normalize('NFC')
    .replace(/([a-zñáéíóúü])\(se\)/gi, '$1se') // levantar(se) → levantarse
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*[/,;]\s*/)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[¡¿!?.…"“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

interface Match {
  /** The entry id: hablar, llamarse, gustarle, haber-impersonal. */
  infinitive: string;
  alt: string;
  /** Other entries the form could also be, for the tie-break pass. */
  options: string[];
}

/** A clitic before the verb: reflexive (me llamo), dative (me gusta) or object (te llamo, lo tengo). */
const OBJECT_CLITIC = /^(me|te|le|lo|la|nos|os|les|los|las)\s+(.+)$/;
const ANY_CLITIC = /^(me|te|se|le|nos|os|les)\s/;
const REFLEXIVE_CLITIC = /^(me|te|se|nos|os)\s+(.+)$/;
/** The experiencer each indirect-object clitic names. */
const DATIVE_PERSON: Record<string, Person> = { me: 'yo', te: 'tu', le: 'el', nos: 'nosotros', os: 'vosotros', les: 'ellos' };
/** A leading experiencer phrase on a front: "a mí me gusta", "a ellos les encanta". */
const EXPERIENCER_PHRASE =
  /^a (?:mí|mi|ti|tí|vos|él|ella|usted|ud|vd|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes|uds|vds) (.+)$/;
const CLITIC_PERSONS: Record<string, Person[]> = {
  me: ['yo'],
  te: ['tu', 'vos'],
  se: ['el', 'ellos'],
  nos: ['nosotros'],
  os: ['vosotros'],
};

const isCommand = (h: Analysis): boolean => h.tense.startsWith('imperative');

function uniqueInfinitives(hits: Analysis[]): string[] {
  return hits.map((h) => h.infinitive).filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Any dictionary verb used pronominally: "me arreglo", "nos abrazamos" are
 * arreglarse, abrazarse when the pronoun and the verb agree in person.
 */
function reflexiveReadings(alt: string): Analysis[] {
  const m = alt.match(REFLEXIVE_CLITIC);
  if (!m) return [];
  return analyze(m[2])
    .filter((h) => !isCommand(h) && CLITIC_PERSONS[m[1]].includes(h.person) && kindOf(h.infinitive) === 'plain')
    .map((h) => ({ ...h, infinitive: `${h.infinitive}se` }));
}

/**
 * Whether a dative reading (the experiencer `person` likes the thing) fits
 * the gloss: "I like" (the English subject is the experiencer), "it fits me"
 * (the thing is the subject), or no subject at all. "he touches me" is an
 * ordinary verb with an object clitic, and so is "they touch me": a plural
 * "they" is mostly people, so it counts as the thing only with a gustar-type
 * English verb ("they fit me", "they hurt").
 */
function dativeFits(person: Person, gloss: Gloss): boolean {
  if (gloss.persons.size === 0 || gloss.persons.has(person)) return true;
  return gloss.itSubject && (gloss.dativeEnglish || !/^(they|these|those)\b/.test(gloss.text));
}

/**
 * Whether a form that is both a dative and a pronominal reading of `base`
 * (the yo form equals the third person in the imperfect, conditional,
 * subjunctives and pluperfect: me gustaría, me parecía, me había gustado) is
 * the dative one: never with a reflexive gloss ("myself", "each other");
 * always with the thing as subject ("it seemed to me", "it fit me") or the
 * verb's dative meaning (DATIVE_SENSE: "I liked him" for me caía bien);
 * otherwise for gustar-type verbs only ("I would like", "I would be interested").
 */
function prefersDative(base: string, gloss: Gloss): boolean {
  if (gloss.reflexive) return false;
  if (gloss.itSubject) return true;
  if ((DATIVE_SENSE[base] ?? []).some((w) => gloss.words.has(w))) return true;
  return GUSTAR_TYPE.has(base);
}

/** Whether the gloss asks for the impersonal entry of `entry` (hay | there is, hace frío | it's cold, amanece | dawn breaks). */
function wantsImpersonal(entry: string, gloss: Gloss): boolean {
  const base = parseEntry(entry)?.base;
  if (base === 'haber') return gloss.there;
  if (base === 'hacer') return gloss.weather;
  return gloss.daybreak;
}

/**
 * The entry a reading keeps: dative readings the gloss contradicts are
 * dropped; a form both dative and pronominal (me gustaría) keeps one of the
 * two (see prefersDative); and between a verb and its -impersonal entry
 * (había: had / there was; hace: does / it's cold) the gloss decides.
 */
function fitReadings(hits: Analysis[], gloss: Gloss): Analysis[] {
  let kept = hits.filter((h) => kindOf(h.infinitive) !== 'dative' || dativeFits(h.person, gloss));
  const baseOf = (h: Analysis): string => parseEntry(h.infinitive)?.base ?? h.infinitive;
  const dativeBases = new Set(kept.filter((h) => kindOf(h.infinitive) === 'dative').map(baseOf));
  const both = new Set(kept.filter((h) => kindOf(h.infinitive) === 'pronominal' && dativeBases.has(baseOf(h))).map(baseOf));
  if (both.size) {
    kept = kept.filter((h) => {
      const kind = kindOf(h.infinitive);
      if (!both.has(baseOf(h)) || (kind !== 'dative' && kind !== 'pronominal')) return true;
      return (kind === 'dative') === prefersDative(baseOf(h), gloss);
    });
  }
  const impersonal = kept.filter((h) => h.infinitive.endsWith('-impersonal'));
  if (!impersonal.length || impersonal.length === kept.length) return kept;
  const wantImpersonal = impersonal.some((h) => wantsImpersonal(h.infinitive, gloss));
  return wantImpersonal ? impersonal : kept.filter((h) => !h.infinitive.endsWith('-impersonal'));
}

/**
 * Narrows the readings of a front by the gloss; null when the gloss does not
 * support reading it as a verb. `strict` (a verb leading a longer phrase)
 * needs a person or a command in the gloss, not just a verb somewhere in it.
 */
function pickReadings(
  hits: Analysis[],
  gloss: Gloss,
  subject: Person | undefined,
  reflexive: boolean,
  strict: boolean,
): Analysis[] | null {
  if (subject) {
    hits = hits.filter((h) => h.person === subject && !isCommand(h) && kindOf(h.infinitive) !== 'dative');
    if (!hits.length) return null;
  }
  const named = hits.filter((h) => gloss.paren.includes(h.infinitive));
  if (named.length) return named;
  const namedBase = hits.filter((h) => gloss.paren.includes(parseEntry(h.infinitive)?.base ?? h.infinitive));
  if (namedBase.length) return namedBase;
  const commands = hits.filter(isCommand);
  if (gloss.imperative && commands.length) return commands;
  if (!gloss.evidence && !reflexive && !subject) {
    // A bare English verb ("Get up", "Listen (pl.)") reads as a command when the front can only be
    // one: an imperative with its pronoun attached, or a plural command. A singular usted form is
    // too often also a noun (baile | dance, ataque | attack) to count without "!" or a person.
    const onlyCommand =
      commands.length > 0 &&
      hits.every((h) => isCommand(h) || h.tense === 'presentSubjunctive') &&
      (commands.length === hits.length || commands.some((h) => h.person !== 'el'));
    return gloss.bareVerb && onlyCommand ? commands : null;
  }
  if (gloss.persons.size) {
    // Dative readings already agree with the gloss (fitReadings): "it fits me" is me queda (yo).
    const agreeing = hits.filter((h) => kindOf(h.infinitive) === 'dative' || gloss.persons.has(h.person));
    if (agreeing.length) return agreeing;
    // A clitic does not excuse a person the gloss contradicts: "me llamaba | he used to call me" is
    // not llamarse yo but llamar with an object clitic (the fallback in matchForm).
    if (strict || !subject) return null;
  } else if (strict && !subject) {
    return null;
  }
  return hits;
}

/**
 * Forms of a rare dictionary verb that on a card are almost always another,
 * everyday word: así is the adverb far more than asir's vos command ("así se
 * dice | that's how you say it", "así me gusta"). They count as that verb only
 * when the gloss names it ("así (asir) | grab!"). Keyed without accents, so
 * "asi" typed bare is covered too.
 */
const RARE_HOMOGRAPHS: Record<string, string> = { asi: 'asir' };

function withoutRareHomographs(alt: string, hits: Analysis[], gloss: Gloss): Analysis[] {
  const verb = RARE_HOMOGRAPHS[foldAccents(alt)];
  if (!verb || gloss.paren.includes(verb)) return hits;
  return hits.filter((h) => (parseEntry(h.infinitive)?.base ?? h.infinitive) !== verb);
}

/** A conjugated form (the whole alternative, or a phrase's leading words). */
function matchForm(alt: string, gloss: Gloss, subject: Person | undefined, strict: boolean): Match | null {
  const reflexive = ANY_CLITIC.test(alt);
  const plainly = gloss.evidence || !!subject;
  // Exact readings first, then any verb used pronominally, then the form with its accents forgiven.
  // A written accent on a one-syllable word is diacritic: "de" and "se" are other words than dé and sé,
  // so a missing one is not forgiven there ("de nada | you're welcome" is no form of dar).
  const foldable = plainly && (!!subject || alt.includes(' ') || syllabify(alt).length > 1);
  const sources = [
    () => analyze(alt),
    () => (plainly ? reflexiveReadings(alt) : []),
    () => (foldable ? analyzeIgnoringAccents(alt) : []),
  ];
  for (const source of sources) {
    const hits = fitReadings(withoutRareHomographs(alt, source(), gloss), gloss);
    if (!hits.length) continue;
    const picked = pickReadings(hits, gloss, subject, reflexive, strict);
    if (picked) {
      const options = uniqueInfinitives(picked);
      return { infinitive: options[0], alt, options };
    }
  }

  // A clitic the dictionary's dative entries do not cover: a verb outside DATIVE_VERBS in the gustar
  // construction ("me apasiona | I'm passionate about it", "les sirve | it works for them"), or an object
  // clitic on an ordinary verb ("le escribo | I write to him", "te llamo | I call you", "lo tengo | I
  // have it", "me escriben | they write to me", "me muerde | it bites me"). The gloss tells them apart:
  // the thing as subject with a gustar-type English verb ("it works for me", "they fit me"), or the
  // clitic's person as the English subject ("I'm passionate about it").
  const m = alt.match(OBJECT_CLITIC);
  if (m && (gloss.evidence || subject)) {
    const hits = analyze(m[2]).filter((h) => kindOf(h.infinitive) === 'plain' && !isCommand(h));
    const experiencer = DATIVE_PERSON[m[1]];
    const third = hits.filter((h) => h.person === 'el' || h.person === 'ellos');
    const dative =
      !subject &&
      experiencer &&
      third.length > 0 &&
      (gloss.dativeEnglish || (DATIVE_PERSON[m[1]] !== 'el' && m[1] !== 'les' && gloss.persons.has(experiencer)));
    if (dative) {
      const options = uniqueInfinitives(third).map((v) => `${v}le`);
      return { infinitive: options[0], alt, options };
    }
    // A gustar-type verb liking a first or second person: "me gustas | I like you", "le gusto | he likes me".
    const liked = hits.filter(
      (h) =>
        !CLITIC_PERSONS[m[1]]?.includes(h.person) &&
        h.person !== experiencer &&
        (GUSTAR_TYPE.has(h.infinitive) || DATIVE_VERBS.includes(h.infinitive)) &&
        !subject &&
        experiencer &&
        gloss.persons.has(experiencer),
    );
    if (liked.length) {
      const options = uniqueInfinitives(liked).map((v) => `${v}le`);
      return { infinitive: options[0], alt, options };
    }
    const picked = hits.length ? pickReadings(hits, gloss, subject, false, strict) : null;
    if (picked) {
      const options = uniqueInfinitives(picked);
      return { infinitive: options[0], alt, options };
    }
  }
  return null;
}

/**
 * An infinitive written on a card as the entry the deck drills: gustar-type
 * verbs as their dative entry ("encantar | to love (things)" → encantarle,
 * except importar glossed "to import"), -le spellings only for verbs used in
 * the gustar construction, everything else as written.
 */
function infinitiveEntry(word: string, gloss: Gloss, rest: string[]): string | null {
  const parsed = parseEntry(word);
  if (!parsed || parsed.id.endsWith('-impersonal')) return null;
  if (parsed.kind === 'dative') {
    return GUSTAR_TYPE.has(parsed.base) || DATIVE_VERBS.includes(parsed.base) ? parsed.id : parsed.base;
  }
  if (parsed.kind === 'plain' && IMPERSONAL_BASES.has(parsed.base) && wantsImpersonal(`${parsed.base}-impersonal`, gloss)) {
    // "amanecer | to dawn", "anochecer | to get dark", "hacer frío | to be cold (weather)".
    return `${parsed.base}-impersonal`;
  }
  if (parsed.kind === 'plain' && GUSTAR_TYPE.has(parsed.base) && !plainSense(parsed.base, gloss, rest)) {
    return `${parsed.base}le`;
  }
  return parsed.id;
}

/**
 * A gustar-type infinitive in its plain sense: importar glossed "to import",
 * faltar with a place or duty (faltar a clase | to miss class, faltar al
 * trabajo) or glossed "to be absent / to skip".
 */
function plainSense(base: string, gloss: Gloss, rest: string[]): boolean {
  if (base === 'importar') return gloss.words.has('import');
  if (base === 'faltar') return rest[0] === 'a' || rest[0] === 'al' || gloss.words.has('absent') || gloss.words.has('skip');
  return false;
}

/** A direct-object clitic after another clitic: "se lo doy", "me lo pongo", "te la compro". */
const CLITIC_CLUSTER = /^(me|te|se|le|nos|os|les) (?:lo|la|los|las) (.+)$/;

/**
 * Reads a clitic cluster as its first clitic: "me lo pongo" as "me pongo"
 * (ponerse), "me lo das" as "me das" (dar with an object clitic). "se" before
 * lo/la is the dative se (le) when the verb is not third person ("se lo doy")
 * or the gloss names who receives it ("se lo da | he gives it to her");
 * otherwise it is reflexive ("se lo pone | he puts it on").
 */
function unclusterClitics(alt: string, gloss: Gloss): string {
  const m = alt.match(CLITIC_CLUSTER);
  if (!m) return alt;
  if (m[1] !== 'se') return `${m[1]} ${m[2]}`;
  const verb = m[2].split(' ')[0];
  const personal = analyze(verb).some((h) => kindOf(h.infinitive) === 'plain' && h.person !== 'el' && h.person !== 'ellos');
  return `${personal || gloss.toSomeone ? 'le' : 'se'} ${m[2]}`;
}

function matchAlternative(rawAlt: string, gloss: Gloss): Match | null {
  let alt = rawAlt;
  let subject: Person | undefined;
  const sm = rawAlt.match(/^(\S+) (.+)$/);
  const em = rawAlt.match(EXPERIENCER_PHRASE);
  if (em && OBJECT_CLITIC.test(em[1])) {
    alt = em[1];
  } else if (sm && SPANISH_SUBJECTS[sm[1]]) {
    alt = sm[2];
    subject = SPANISH_SUBJECTS[sm[1]];
  }
  // "se me olvidó | I forgot" (the accidental se): a pronominal verb with a dative, which no
  // entry drills as written, so the card is left out rather than keyed to the wrong entry.
  if (/^se (me|te|le|nos|os|les) /.test(alt)) return null;
  // "hay que estudiar | one has to study", "había que…": impersonal haber whatever the gloss.
  const hq = alt.match(/^(\S+) que(?: |$)/);
  if (hq && analyze(hq[1]).some((h) => h.infinitive === 'haber-impersonal')) {
    return { infinitive: 'haber-impersonal', alt: rawAlt, options: ['haber-impersonal'] };
  }
  alt = unclusterClitics(alt, gloss);
  const words = alt.split(' ');

  // 1. An infinitive with a "to ..." gloss, alone or leading a phrase ("escribir cuentos |
  //    to write stories"); alone, also with a bare English verb ("comer | eat") or named in
  //    parentheses.
  const inf = subject ? null : infinitiveEntry(words[0], gloss, words.slice(1));
  if (inf) {
    const alone = words.length === 1;
    const base = parseEntry(inf)?.base ?? inf;
    if (gloss.isInfinitive || (alone && (gloss.paren.includes(base) || (gloss.bareVerb && isKnownVerb(inf))))) {
      return { infinitive: inf, alt: rawAlt, options: [inf] };
    }
  }

  // 2. A conjugated form.
  const whole = matchForm(alt, gloss, subject, false);
  if (whole) return whole;

  // 3. A phrase led by a conjugated form: "ven aquí | come here!", "me llamo Ana | my name is Ana".
  for (let k = words.length - 1; k >= 1; k--) {
    const lead = matchForm(words.slice(0, k).join(' '), gloss, subject, true);
    if (lead) return lead;
  }

  // 4. Not a form we know, but the back names a dictionary verb.
  const named = gloss.paren.find((p) => isKnownVerb(p));
  if (named && gloss.evidence) return { infinitive: named, alt: rawAlt, options: [named] };
  return null;
}

/** Question words a front may start with ("¿Cómo te llamas?"); the ones in QUESTION_NOUN may take a noun ("¿Qué tiempo hace?"). */
const QUESTION_WORDS = new Set([
  'qué', 'cómo', 'cuándo', 'dónde', 'adónde', 'quién', 'quiénes', 'cuál', 'cuáles', 'cuánto', 'cuánta', 'cuántos', 'cuántas',
]);
const QUESTION_NOUN = new Set(['qué', 'cuál', 'cuáles', 'cuánto', 'cuánta', 'cuántos', 'cuántas']);
const QUESTION_PREPOSITIONS = new Set(['a', 'de', 'por', 'para', 'con', 'en', 'desde', 'hasta']);

/**
 * The front with a leading question word ("¿Qué te duele?" → "te duele",
 * "¿Qué tiempo hace?" → "hace") or a negation ("no me gusta", "yo no hablo")
 * taken off, for fronts whose verb is not first. Accented question words
 * only: "como" and "que" are also a verb form and a conjunction.
 */
function reducedFronts(alt: string): string[] {
  const words = alt.split(' ');
  const heads: string[][] = [];
  const q = QUESTION_PREPOSITIONS.has(words[0]) && QUESTION_WORDS.has(words[1]) ? 2 : QUESTION_WORDS.has(words[0]) ? 1 : 0;
  if (q) {
    const rest = words.slice(q);
    if (rest.length) heads.push(rest);
    if (QUESTION_NOUN.has(words[q - 1]) && rest.length >= 2) heads.push(rest.slice(1));
  } else {
    heads.push(words);
  }
  const out: string[] = [];
  for (const h of heads) {
    if (h[0] === 'no' && h.length > 1) out.push(h.slice(1).join(' '));
    else if (SPANISH_SUBJECTS[h[0]] && h[1] === 'no' && h.length > 2) out.push([h[0], ...h.slice(2)].join(' '));
    else if (q) out.push(h.join(' '));
  }
  return out.filter((v) => v && v !== alt);
}

/** The entry of one alternative of a front: as written, else without a leading question word or "no". */
function matchFront(alt: string, gloss: Gloss): Match | null {
  const direct = matchAlternative(alt, gloss);
  if (direct) return direct;
  for (const reduced of reducedFronts(alt)) {
    const match = matchAlternative(reduced, gloss);
    if (match) return { ...match, alt };
  }
  return null;
}

/** The options whose English meaning the gloss uses ("believe" → creer, "went" → ir). */
function hintedOptions(options: string[], gloss: Gloss): string[] {
  return options.filter((o) => (GLOSS_HINTS[parseEntry(o)?.base ?? o] ?? []).some((w) => gloss.words.has(w)));
}

/**
 * Detects the verbs of a deck, grouped by entry (see the file comment): the
 * same verb used two ways is two entries (gustar and gustarle, llamar and
 * llamarse). Entries come in deck order. Dative and impersonal entries are
 * included, with a note on how they are practiced; unknown infinitives are
 * kept and flagged. `excludedByDefault` stays in the result for callers but
 * nothing is excluded by kind any more.
 */
export function detectVerbs(cards: DeckCard[]): DetectedVerb[] {
  const perCard: { card: DeckCard; matches: Match[]; gloss: Gloss }[] = [];
  for (const card of cards) {
    const gloss = readGloss(card.back ?? '');
    const matches: Match[] = [];
    for (const alt of alternatives(card.front ?? '')) {
      const match = matchFront(alt, gloss);
      if (match) matches.push(match);
    }
    perCard.push({ card, matches, gloss });
  }

  // Tie-break ambiguous forms (fue: ser / ir): first by the English gloss ("went" is ir, "was" is ser),
  // then toward verbs the deck already has, then by dictionary order.
  const chosen = new Set<string>();
  for (const { matches, gloss } of perCard) {
    for (const m of matches) {
      if (m.options.length > 1) {
        const hinted = hintedOptions(m.options, gloss);
        if (hinted.length) m.options = hinted;
      }
      if (m.options.length === 1) {
        m.infinitive = m.options[0];
        chosen.add(m.infinitive);
      }
    }
  }
  for (const { matches } of perCard) {
    for (const m of matches) {
      if (m.options.length > 1) m.infinitive = m.options.find((o) => chosen.has(o)) ?? m.options[0];
    }
  }

  const groups = new Map<string, DeckCard[]>();
  for (const { card, matches } of perCard) {
    for (const m of matches) {
      const list = groups.get(m.infinitive) ?? [];
      if (!list.includes(card)) list.push(card);
      groups.set(m.infinitive, list);
    }
  }

  const out: DetectedVerb[] = [];
  for (const [infinitive, cards] of groups) {
    const kind = kindOf(infinitive);
    let note: string | undefined;
    if (kind === 'dative') note = dativeNote(infinitive);
    else if (kind === 'impersonal') note = impersonalNote(infinitive);
    else if (!isKnownVerb(infinitive)) note = NOTE_UNKNOWN;
    const result: DetectedVerb = { infinitive, cards, excludedByDefault: false };
    if (note) result.note = note;
    out.push(result);
  }
  return out;
}
