// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Hand-written frames for a first-year course's verbs (the sample Units 1-4).
 *
 * A frame is a Spanish template with the subject slot before the blank and
 * complement slots after it, the English for the after-answer feedback, the
 * English verb, and what it works for (subjects, persons, tenses). The engine
 * always writes the verb form; a frame never contains it.
 *
 * Spanish template tokens:
 *   {S}  a subject from the bank (pronoun, name, deck noun, coordination)
 *   {E}  a gustar experiencer (A mí, A mi abuela, A mis primos)
 *   {T}  a thing subject from the frame's `pivot` list (El café ___ (costar)…)
 *   ___  the blank (the parentheses are added by the renderer)
 *   {slot} / {slot:2}  a complement from fillers.ts (":2" = a second, different one)
 *   {LE}  "le" or "les", agreeing with the frame's `io` slot: the indirect-object pronoun
 *         that doubles "a + person" ("Yo les ___ (dar) las gracias a mis tías"). It is not
 *         part of the answer; the checker allows it only with a verb that takes an
 *         indirect object and a matching "a + person" after the blank.
 * English template tokens: {S} {E} {T} (the subject's English), {V} (the verb
 * phrase for the tense and person: lives, lived, will live), {Vneg} (does
 * not like), {POSS} (my / your / his / their: the subject's), {THERE} (there is / there
 * are, for hay) and the same {slot}s.
 *
 * Without `tenses` a frame is for the present only: every other tense must be
 * listed by hand, because "Ayer mi abuela vivió en Lima" is not natural even
 * though it is grammatical. Subjunctives and commands have no frames (those
 * cells fall back to the short label).
 */
import type { Person, Tense } from '../types.js';
import type { Tag } from './types.js';

export interface Frame {
  /** Unique id, `${entry}.${name}`. */
  id: string;
  entry: string;
  es: string;
  /** English template, or null when no plain English exists. */
  en: string | null;
  /** English verb key (english.ts). */
  v: string;
  /** Subject tags it suits (any in common); default ['person']. Not used with {T}. */
  who?: Tag[];
  /** Subject tags it does not suit (a server does not ask for the check). */
  notWho?: Tag[];
  /** Only these persons. */
  persons?: Person[];
  /** Tenses it is natural in; default present only. */
  tenses?: Tense[];
  /** The list a {T} thing subject or a subjectless frame's main slot is drawn from (enumerated, like the bank). */
  pivot?: string;
  /** Skip usted / ustedes (an age for a formal "you" is odd). */
  noFormal?: boolean;
  /** Only pronouns and noun phrases as subjects: no names, no coordinations ("Ana se llama Ana"). */
  noNames?: boolean;
  /** The person slot a {LE} agrees with. */
  io?: string;
  /** Subjects with these lemmas are skipped ("Los estudiantes conocen a muchos estudiantes"). */
  avoidLemmas?: string[];
  /** The English present is progressive ("Voy a México" → "I am going to Mexico"). */
  enProgressive?: boolean;
}

const PRES: Tense[] = ['present'];
const ACT: Tense[] = ['present', 'preterite', 'imperfect', 'future', 'presentProgressive'];
const EVENT: Tense[] = ['present', 'preterite', 'future', 'presentProgressive'];
const HABIT: Tense[] = ['present', 'imperfect'];
/** ir: no progressive ("está yendo" is not what a Spanish I sentence wants). */
const MOVE: Tense[] = ['present', 'preterite', 'future'];
/** A clock time or a schedule: no progressive ("La clase está empezando a las diez"). */
const TIMED: Tense[] = ['present', 'preterite', 'future'];
/** An action with a meal or a time of day: no progressive ("Estoy comiendo huevos en el desayuno"). */
const ROUTINE: Tense[] = ['present', 'preterite', 'imperfect', 'future'];

const PEOPLE_AND_ANIMALS: Tag[] = ['person', 'animal'];

type Spec = Omit<Frame, 'id' | 'entry'>;

function group(entry: string, specs: Record<string, Spec>): Frame[] {
  return Object.entries(specs).map(([name, spec]) => ({ id: `${entry}.${name}`, entry, ...spec, tenses: spec.tenses ?? PRES }));
}

export const FRAMES: Frame[] = [
  // ---------------------------------------------------------------- Unit 1
  ...group('ser', {
    from: { es: '{S} ___ de {city}.', en: '{S} {V} from {city}.', v: 'be' },
    fromAlso: { es: '{S} también ___ de {city}.', en: '{S} {V} also from {city}.', v: 'be' },
    fromNot: { es: '{S} ___ de {city}, no de {city:2}.', en: '{S} {V} from {city}, not from {city:2}.', v: 'be' },
    name: { es: '{S} ___ {names}.', en: '{S} {V} {names}.', v: 'be', noNames: true, who: ['person'] },
    pred: { es: '{S} ___ {predSer}.', en: '{S} {V} {predSer}.', v: 'be' },
    adj: { es: '{S} ___ {adjSer}.', en: '{S} {V} {adjSer}.', v: 'be', who: PEOPLE_AND_ANIMALS, tenses: HABIT },
    muy: { es: '{S} ___ muy {adjSer}.', en: '{S} {V} very {adjSer}.', v: 'be', who: PEOPLE_AND_ANIMALS, tenses: HABIT },
  }),
  ...group('haber-impersonal', {
    school: { es: 'En la escuela ___ {haySchool}.', en: '{THERE} {haySchool} at the school.', v: 'be', pivot: 'haySchool', tenses: HABIT },
    class: { es: 'En la clase ___ {hayClass}.', en: '{THERE} {hayClass} in the class.', v: 'be', pivot: 'hayClass', tenses: HABIT },
    count: { es: 'En mi clase ___ {hayCount}.', en: '{THERE} {hayCount} in my class.', v: 'be', pivot: 'hayCount', tenses: HABIT },
    city: { es: 'En {city} ___ muchas escuelas.', en: 'There are many schools in {city}.', v: 'be', pivot: 'city' },
    table: { es: 'En la mesa ___ {hayTable}.', en: '{THERE} {hayTable} on the table.', v: 'be', pivot: 'hayTable' },
    market: { es: 'En el mercado ___ {hayMarket}.', en: '{THERE} {hayMarket} at the market.', v: 'be', pivot: 'hayMarket', tenses: HABIT },
    restaurant: { es: 'En el restaurante ___ {hayRestaurant}.', en: '{THERE} {hayRestaurant} at the restaurant.', v: 'be', pivot: 'hayRestaurant' },
  }),
  ...group('estar', {
    school: { es: '{S} ___ en la escuela.', en: '{S} {V} at school.', v: 'be', who: ['person'], tenses: ['present', 'preterite', 'future'] },
    class: { es: '{S} ___ en clase.', en: '{S} {V} in class.', v: 'be', who: ['learner', 'teacher'] },
    city: { es: '{S} ___ en {city}.', en: '{S} {V} in {city}.', v: 'be' },
    with: { es: '{S} ___ con {personObj}.', en: '{S} {V} with {personObj}.', v: 'be', who: [...PEOPLE_AND_ANIMALS, 'baby'] },
    bien: { es: '{S} ___ bien.', en: '{S} {V} fine.', v: 'be', who: [...PEOPLE_AND_ANIMALS, 'baby'] },
    shop: { es: '{S} ___ en el restaurante.', en: '{S} {V} at the restaurant.', v: 'be' },
    market: { es: '{S} ___ en el mercado.', en: '{S} {V} at the market.', v: 'be' },
  }),
  ...group('tener', {
    age: { es: '{S} ___ {age}.', en: '{S} {V} {age}.', v: 'be', who: PEOPLE_AND_ANIMALS, noFormal: true },
    class: { es: '{S} ___ clase de español.', en: '{S} {V} Spanish class.', v: 'have', who: ['learner', 'teacher'] },
    friends: { es: '{S} ___ muchos amigos.', en: '{S} {V} a lot of friends.', v: 'have' },
    friendCity: { es: '{S} ___ un amigo en {city}.', en: '{S} {V} a friend in {city}.', v: 'have' },
    pet: { es: '{S} ___ {pet}.', en: '{S} {V} {pet}.', v: 'have' },
    eyes: { es: '{S} ___ los ojos {eyes}.', en: '{S} {V} {eyes} eyes.', v: 'have', who: PEOPLE_AND_ANIMALS },
    hair: { es: '{S} ___ el pelo {hair}.', en: '{S} {V} {hair} hair.', v: 'have' },
    test: { es: '{S} ___ un examen el lunes.', en: '{S} {V} a test on Monday.', v: 'have', who: ['learner'] },
    homework: { es: '{S} ___ mucha tarea.', en: '{S} {V} a lot of homework.', v: 'have', who: ['learner'] },
    hungry: { es: '{S} ___ hambre.', en: '{S} {V} hungry.', v: 'be', who: [...PEOPLE_AND_ANIMALS, 'baby'] },
    thirsty: { es: '{S} ___ mucha sed.', en: '{S} {V} very thirsty.', v: 'be', who: PEOPLE_AND_ANIMALS },
  }),
  ...group('llamarse', {
    name: { es: '{S} ___ {names}.', en: null, v: 'be', who: PEOPLE_AND_ANIMALS, noNames: true },
    not: { es: '{S} ___ {names}, no {names:2}.', en: null, v: 'be', who: PEOPLE_AND_ANIMALS, noNames: true },
    hola: { es: 'Hola, {S} ___ {names}.', en: null, v: 'be', persons: ['yo', 'nosotros'], noNames: true },
    // singular only: "Mis profesoras también se llaman Ana y Sofía" presupposes another pair with the same names
    also: { es: '{S} también ___ {names}.', en: null, v: 'be', who: ['person'], noNames: true, persons: ['yo', 'tu', 'vos', 'el'] },
  }),
  ...group('querer', {
    school: { es: '{S} ___ ir a la escuela.', en: '{S} {V} to go to school.', v: 'want', who: ['learner', 'teacher'] },
    city: { es: '{S} ___ ir a {city}.', en: '{S} {V} to go to {city}.', v: 'want' },
    class: { es: '{S} ___ ir a clase.', en: '{S} {V} to go to class.', v: 'want', who: ['learner', 'teacher'] },
    // family and friends only: never a teacher or a server on either side of a trip
    cityWith: { es: '{S} ___ ir a {city} con {companionObj}.', en: '{S} {V} to go to {city} with {companionObj}.', v: 'want', notWho: ['teacher', 'server'] },
    be: { es: '{S} ___ ser {predWant}.', en: '{S} {V} to be {predWant}.', v: 'want' },
    pet: { es: '{S} ___ {pet}.', en: '{S} {V} {pet}.', v: 'want' },
    speak: { es: '{S} ___ hablar español.', en: '{S} {V} to speak Spanish.', v: 'want' },
    food: { es: '{S} ___ {food}.', en: '{S} {V} {food}.', v: 'want' },
  }),
  ...group('ir', {
    school: { es: '{S} ___ a la escuela.', en: '{S} {V} to school.', v: 'go', tenses: MOVE },
    class: { es: '{S} ___ a clase.', en: '{S} {V} to class.', v: 'go', who: ['learner', 'teacher'], tenses: MOVE },
    city: { es: '{S} ___ a {city}.', en: '{S} {V} to {city}.', v: 'go', tenses: MOVE, enProgressive: true },
    with: { es: '{S} ___ a la escuela con {peerObj}.', en: '{S} {V} to school with {peerObj}.', v: 'go', who: ['learner'], tenses: MOVE },
    restaurant: { es: '{S} ___ al restaurante.', en: '{S} {V} to the restaurant.', v: 'go', tenses: MOVE },
    market: { es: '{S} ___ al mercado.', en: '{S} {V} to the market.', v: 'go', tenses: MOVE },
    store: { es: '{S} ___ a la tienda.', en: '{S} {V} to the store.', v: 'go', tenses: MOVE },
  }),
  ...group('gustarle', {
    like: { es: '{E} ___ {like}.', en: '{E} {V} {like}.', v: 'like', tenses: HABIT },
    much: { es: '{E} ___ mucho {like}.', en: '{E} {V} {like} a lot.', v: 'like', tenses: HABIT },
    also: { es: '{E} también ___ {like}.', en: '{E} also {V} {like}.', v: 'like' },
    no: { es: '{E} no ___ {likeNo}.', en: '{E} {Vneg} {likeNo}.', v: 'like' },
  }),

  // ---------------------------------------------------------------- Unit 2
  ...group('verse', {
    adj: { es: '{S} ___ {adjLook}.', en: '{S} {V} {adjLook}.', v: 'look', who: PEOPLE_AND_ANIMALS },
    muy: { es: '{S} ___ muy {adjLook}.', en: '{S} {V} very {adjLook}.', v: 'look', who: PEOPLE_AND_ANIMALS },
    photo: { es: 'En la foto, {S} ___ {adjLook}.', en: 'In the photo, {S} {V} {adjLook}.', v: 'look', who: PEOPLE_AND_ANIMALS },
    photoMuy: { es: 'En la foto, {S} ___ muy {adjLook}.', en: 'In the photo, {S} {V} very {adjLook}.', v: 'look', who: PEOPLE_AND_ANIMALS },
  }),
  ...group('vivir', {
    city: { es: '{S} ___ en {city}.', en: '{S} {V} in {city}.', v: 'live', tenses: HABIT },
    // the speaker, relatives and pets live with parents or grandparents; nobody else (that reads as moving in together)
    with: { es: '{S} ___ con {familyObj}.', en: '{S} {V} with {familyObj}.', v: 'live', who: ['family'], tenses: HABIT },
    cityWith: { es: '{S} ___ en {city} con {familyObj}.', en: '{S} {V} in {city} with {familyObj}.', v: 'live', who: ['family'], tenses: HABIT },
    // parents and siblings are the family; "nosotros" would say nuestra familia
    family: { es: '{S} ___ con mi familia.', en: '{S} {V} with my family.', v: 'live', who: ['family'], notWho: ['household'], persons: ['yo', 'el', 'ellos'], tenses: HABIT },
    // tú lives with tu familia (a tú cell had one sentence: none could be learnt by heart)
    familyTu: { es: '{S} ___ con tu familia.', en: '{S} {V} with your family.', v: 'live', persons: ['tu'], tenses: HABIT },
    alsoCity: { es: '{S} también ___ en {city}.', en: '{S} {V} in {city} too.', v: 'live', tenses: HABIT },
  }),

  // ---------------------------------------------------------------- Unit 3
  ...group('estudiar', {
    spanish: { es: '{S} ___ español.', en: '{S} {V} Spanish.', v: 'study', who: ['learner', 'adult'], tenses: ACT },
    test: { es: '{S} ___ para el examen.', en: '{S} {V} for the test.', v: 'study', who: ['learner'], tenses: ACT },
    with: { es: '{S} ___ con {peerObj}.', en: '{S} {V} with {peerObj}.', v: 'study', who: ['learner'], tenses: ACT },
    everyDay: { es: '{S} ___ todos los días.', en: '{S} {V} every day.', v: 'study', who: ['learner'], tenses: HABIT },
    night: { es: '{S} ___ por la noche.', en: '{S} {V} at night.', v: 'study', who: ['learner'], tenses: ROUTINE },
  }),
  ...group('trabajar', {
    school: { es: '{S} ___ en la escuela.', en: '{S} {V} at the school.', v: 'work', who: ['adult'], tenses: HABIT },
    much: { es: '{S} ___ mucho.', en: '{S} {V} a lot.', v: 'work', who: ['adult', 'learner'], notWho: ['kid'], tenses: ACT },
    saturdays: { es: '{S} ___ los sábados.', en: '{S} {V} on Saturdays.', v: 'work', who: ['adult'], tenses: HABIT },
    city: { es: '{S} ___ en {city}.', en: '{S} {V} in {city}.', v: 'work', who: ['adult'], tenses: HABIT },
    restaurant: { es: '{S} ___ en el restaurante.', en: '{S} {V} at the restaurant.', v: 'work', who: ['adult'], tenses: HABIT },
    store: { es: '{S} ___ en la tienda.', en: '{S} {V} at the store.', v: 'work', who: ['adult'], tenses: HABIT },
    // a student works too: in class, on homework, with a classmate
    class: { es: '{S} ___ mucho en clase.', en: '{S} {V} hard in class.', v: 'work', who: ['learner'], noFormal: true, tenses: HABIT },
    homework: { es: '{S} ___ en la tarea.', en: '{S} {V} on the homework.', v: 'work', who: ['learner'], tenses: EVENT },
    withPeer: { es: '{S} ___ con {peerObj}.', en: '{S} {V} with {peerObj}.', v: 'work', who: ['learner'], tenses: HABIT },
  }),
  ...group('hablar', {
    spanish: { es: '{S} ___ español.', en: '{S} {V} Spanish.', v: 'speak', tenses: HABIT },
    two: { es: '{S} ___ inglés y español.', en: '{S} {V} English and Spanish.', v: 'speak', tenses: HABIT },
    with: { es: '{S} ___ con {personObj}.', en: '{S} {V} with {personObj}.', v: 'talk', tenses: ACT },
    class: { es: '{S} ___ mucho en clase.', en: '{S} {V} a lot in class.', v: 'talk', who: ['learner'], noFormal: true, tenses: ACT },
  }),
  ...group('escuchar', {
    music: { es: '{S} ___ música.', en: '{S} {V} to music.', v: 'listen', tenses: ACT },
    person: { es: '{S} ___ a {personObj}.', en: '{S} {V} to {personObj}.', v: 'listen', tenses: ACT },
    question: { es: '{S} ___ la pregunta.', en: '{S} {V} to the question.', v: 'listen', tenses: EVENT },
    class: { es: '{S} ___ en clase.', en: '{S} {V} in class.', v: 'listen', who: ['learner'], tenses: HABIT },
  }),
  ...group('leer', {
    book: { es: '{S} ___ un libro.', en: '{S} {V} a book.', v: 'read', tenses: ACT },
    question: { es: '{S} ___ la pregunta.', en: '{S} {V} the question.', v: 'read', tenses: EVENT },
    class: { es: '{S} ___ en clase.', en: '{S} {V} in class.', v: 'read', who: ['learner', 'teacher'], tenses: HABIT },
    words: { es: '{S} ___ las palabras en español.', en: '{S} {V} the words in Spanish.', v: 'read', tenses: EVENT },
    everyDay: { es: '{S} ___ todos los días.', en: '{S} {V} every day.', v: 'read', tenses: HABIT },
  }),
  ...group('escribir', {
    answer: { es: '{S} ___ la respuesta.', en: '{S} {V} the answer.', v: 'write', tenses: EVENT },
    words: { es: '{S} ___ las palabras.', en: '{S} {V} the words.', v: 'write', tenses: EVENT },
    tool: { es: '{S} ___ con {writeTool}.', en: '{S} {V} with {writeTool}.', v: 'write', tenses: HABIT },
    spanish: { es: '{S} ___ en español.', en: '{S} {V} in Spanish.', v: 'write', tenses: HABIT },
  }),
  ...group('aprender', {
    spanish: { es: '{S} ___ español.', en: '{S} {V} Spanish.', v: 'learn', tenses: HABIT },
    class: { es: '{S} ___ mucho en clase.', en: '{S} {V} a lot in class.', v: 'learn', who: ['learner'], tenses: ACT },
    newWords: { es: '{S} ___ palabras nuevas.', en: '{S} {V} new words.', v: 'learn', tenses: ACT },
    english: { es: '{S} ___ inglés.', en: '{S} {V} English.', v: 'learn', tenses: HABIT },
    words: { es: '{S} ___ las palabras.', en: '{S} {V} the words.', v: 'learn', tenses: EVENT },
  }),
  ...group('enseñar', {
    spanish: { es: '{S} ___ español.', en: '{S} {V} Spanish.', v: 'teach', who: ['adult'], notWho: ['elder', 'server'], tenses: HABIT },
    school: { es: '{S} ___ en la escuela.', en: '{S} {V} at the school.', v: 'teach', who: ['adult'], notWho: ['elder', 'server'], tenses: HABIT },
    englishCity: { es: '{S} ___ inglés en {city}.', en: '{S} {V} English in {city}.', v: 'teach', who: ['adult'], notWho: ['elder', 'server'], tenses: HABIT },
    words: { es: '{S} ___ las palabras nuevas.', en: '{S} {V} the new words.', v: 'teach', who: ['teacher'], tenses: EVENT },
    // a student can teach too: to a sibling, a cousin or a friend
    toPeer: { es: '{S} {LE} ___ español a {peerObj}.', en: '{S} {V} {peerObj} Spanish.', v: 'teach', io: 'peerObj', tenses: HABIT },
    englishToPeer: { es: '{S} {LE} ___ inglés a {peerObj}.', en: '{S} {V} {peerObj} English.', v: 'teach', io: 'peerObj', tenses: HABIT },
    wordsToPeer: { es: '{S} {LE} ___ las palabras a {peerObj}.', en: '{S} {V} {peerObj} the words.', v: 'teach', io: 'peerObj', tenses: EVENT },
  }),
  ...group('mirar', {
    tv: { es: '{S} ___ la televisión.', en: '{S} {V} TV.', v: 'watch', tenses: ACT },
    window: { es: '{S} ___ por la ventana.', en: '{S} {V} out the window.', v: 'look', who: PEOPLE_AND_ANIMALS, tenses: ACT },
    book: { es: '{S} ___ el libro.', en: '{S} {V} at the book.', v: 'look', tenses: EVENT },
    photos: { es: '{S} ___ las fotos.', en: '{S} {V} at the photos.', v: 'look', tenses: EVENT },
  }),
  ...group('ver', {
    person: { es: '{S} ___ a {personObj}.', en: '{S} {V} {personObj}.', v: 'see', tenses: EVENT },
    tv: { es: '{S} ___ la televisión.', en: '{S} {V} TV.', v: 'watch', tenses: ACT },
    book: { es: '{S} ___ el libro en la mesa.', en: '{S} {V} the book on the table.', v: 'see', tenses: EVENT },
    well: { es: '{S} ___ muy bien.', en: '{S} {V} very well.', v: 'see', who: PEOPLE_AND_ANIMALS },
  }),
  ...group('oír', {
    question: { es: '{S} ___ la pregunta.', en: '{S} {V} the question.', v: 'hear', tenses: EVENT },
    music: { es: '{S} ___ la música.', en: '{S} {V} the music.', v: 'hear', who: PEOPLE_AND_ANIMALS, tenses: EVENT },
    // "Oigo a mi primo" with no context is odd; "No oigo a mi profesora" is what people say
    person: { es: '{S} no ___ a {personObj}.', en: '{S} {Vneg} {personObj}.', v: 'hear' },
    well: { es: '{S} ___ muy bien.', en: '{S} {V} very well.', v: 'hear', who: PEOPLE_AND_ANIMALS },
  }),
  ...group('decir', {
    hola: { es: '{S} ___ hola.', en: '{S} {V} hello.', v: 'say', tenses: EVENT },
    answer: { es: '{S} ___ la respuesta.', en: '{S} {V} the answer.', v: 'say', tenses: EVENT },
    yes: { es: '{S} ___ que sí.', en: '{S} {V} yes.', v: 'say', tenses: EVENT },
    no: { es: '{S} ___ que no.', en: '{S} {V} no.', v: 'say', tenses: EVENT },
    thanks: { es: '{S} ___ gracias.', en: '{S} {V} thank you.', v: 'say', tenses: EVENT },
    bye: { es: '{S} ___ adiós.', en: '{S} {V} goodbye.', v: 'say', tenses: EVENT },
  }),
  ...group('hacer', {
    homework: { es: '{S} ___ la tarea.', en: '{S} {V} {POSS} homework.', v: 'do', who: ['learner'], tenses: ACT },
    night: { es: '{S} ___ la tarea por la noche.', en: '{S} {V} {POSS} homework at night.', v: 'do', who: ['learner'], tenses: ROUTINE },
    questions: { es: '{S} ___ muchas preguntas.', en: '{S} {V} a lot of questions.', v: 'ask', tenses: ACT },
    with: { es: '{S} ___ la tarea con {peerObj}.', en: '{S} {V} {POSS} homework with {peerObj}.', v: 'do', who: ['learner'], tenses: ACT },
  }),
  ...group('necesitar', {
    thing: { es: '{S} ___ {schoolThing}.', en: '{S} {V} {schoolThing}.', v: 'need', who: ['learner', 'teacher'] },
    study: { es: '{S} ___ estudiar.', en: '{S} {V} to study.', v: 'need', who: ['learner'] },
    homework: { es: '{S} ___ hacer la tarea.', en: '{S} {V} to do {POSS} homework.', v: 'need', who: ['learner'] },
    bookClass: { es: '{S} ___ un libro para la clase.', en: '{S} {V} a book for the class.', v: 'need', who: ['learner', 'teacher'] },
    money: { es: '{S} ___ dinero.', en: '{S} {V} money.', v: 'need' },
    water: { es: '{S} ___ agua.', en: '{S} {V} water.', v: 'need', who: PEOPLE_AND_ANIMALS },
  }),
  ...group('poder', {
    speak: { es: '{S} ___ hablar español.', en: '{S} {V} speak Spanish.', v: 'can', tenses: HABIT },
    read: { es: '{S} ___ leer el libro.', en: '{S} {V} read the book.', v: 'can' },
    write: { es: '{S} ___ escribir en español.', en: '{S} {V} write in Spanish.', v: 'can', tenses: HABIT },
    go: { es: '{S} ___ ir a la escuela hoy.', en: '{S} {V} go to school today.', v: 'can' },
  }),
  ...group('saber', {
    answer: { es: '{S} ___ la respuesta.', en: '{S} {V} the answer.', v: 'know' },
    speak: { es: '{S} ___ hablar español.', en: '{S} {V} how to speak Spanish.', v: 'know', tenses: HABIT },
    words: { es: '{S} ___ las palabras.', en: '{S} {V} the words.', v: 'know' },
    much: { es: '{S} ___ mucho.', en: '{S} {V} a lot.', v: 'know' },
    // a child who has just learned (said of an adult it sounds like doubt)
    readWrite: { es: '{S} ya ___ leer y escribir.', en: '{S} already {V} how to read and write.', v: 'know', who: ['kid'], tenses: HABIT },
  }),
  ...group('conocer', {
    person: { es: '{S} ___ a {knowObj}.', en: '{S} {V} {knowObj}.', v: 'know', who: PEOPLE_AND_ANIMALS },
    // "conozco Bogotá" means having been there; "muy bien" makes the English plain
    city: { es: '{S} ___ {city} muy bien.', en: '{S} {V} {city} very well.', v: 'know' },
    students: { es: '{S} ___ a muchos estudiantes.', en: '{S} {V} a lot of students.', v: 'know', who: ['teacher', 'learner'], notWho: ['kid'], avoidLemmas: ['estudiante'] },
    well: { es: '{S} ___ bien a {knowObj}.', en: '{S} {V} {knowObj} well.', v: 'know' },
  }),
  ...group('entender', {
    question: { es: '{S} ___ la pregunta.', en: '{S} {V} the question.', v: 'understand' },
    spanish: { es: '{S} ___ español.', en: '{S} {V} Spanish.', v: 'understand', tenses: HABIT },
    well: { es: '{S} ___ muy bien.', en: '{S} {V} very well.', v: 'understand' },
    homework: { es: '{S} ___ la tarea.', en: '{S} {V} the homework.', v: 'understand', who: ['learner'] },
    words: { es: '{S} ___ las palabras.', en: '{S} {V} the words.', v: 'understand' },
  }),
  ...group('pensar', {
    much: { es: '{S} ___ mucho.', en: '{S} {V} a lot.', v: 'think' },
    test: { es: '{S} ___ en el examen.', en: '{S} {V} about the test.', v: 'think', who: ['learner', 'teacher'] },
    // pensar + infinitive: to plan to (and "creo que sí" is the natural "I think so")
    plan: { es: '{S} ___ ir a {city}.', en: '{S} {V} to go to {city}.', v: 'plan' },
    homework: { es: '{S} ___ en la tarea.', en: '{S} {V} about {POSS} homework.', v: 'think', who: ['learner'] },
  }),
  ...group('creer', {
    yes: { es: '{S} ___ que sí.', en: '{S} {V} so.', v: 'think' },
    no: { es: '{S} ___ que no.', en: '{S} {Vneg} so.', v: 'think' },
    also: { es: '{S} también ___ que sí.', en: '{S} also {V} so.', v: 'think' },
  }),
  ...group('empezar', {
    homework: { es: '{S} ___ la tarea.', en: '{S} {V} {POSS} homework.', v: 'start', who: ['learner'], tenses: EVENT },
    study: { es: '{S} ___ a estudiar.', en: '{S} {V} to study.', v: 'start', who: ['learner'], tenses: EVENT },
    test: { es: '{S} ___ el examen.', en: '{S} {V} the test.', v: 'start', who: ['learner'], tenses: EVENT },
    classAt: { es: '{T} ___ {hourClass}.', en: '{T} {V} {hourClass}.', v: 'start', pivot: 'classThing', tenses: TIMED },
    teacher: { es: '{S} ___ {classOwn} {hourClass}.', en: '{S} {V} {POSS} {classOwn} {hourClass}.', v: 'start', who: ['teacher'], tenses: TIMED },
  }),
  ...group('llegar', {
    early: { es: '{S} ___ a la escuela temprano.', en: '{S} {V} at school early.', v: 'arrive', who: ['learner', 'teacher'], tenses: TIMED },
    late: { es: '{S} ___ tarde a clase.', en: '{S} {V} late to class.', v: 'arrive', who: ['learner', 'teacher'], noFormal: true, tenses: EVENT },
    at: { es: '{S} ___ {hourClass}.', en: '{S} {V} {hourClass}.', v: 'arrive', tenses: TIMED },
    city: { es: '{S} ___ a {city} el lunes.', en: '{S} {V} in {city} on Monday.', v: 'arrive', tenses: ['present', 'preterite', 'future'] },
  }),

  // ---------------------------------------------------------------- Unit 4
  ...group('comer', {
    food: { es: '{S} ___ {food}.', en: '{S} {V} {food}.', v: 'eat', tenses: ACT },
    restaurant: { es: '{S} ___ en el restaurante.', en: '{S} {V} at the restaurant.', v: 'eat', tenses: ACT },
    // the food suits the meal (no ice cream for breakfast)
    breakfast: { es: '{S} ___ {foodBreakfast} en el desayuno.', en: '{S} {V} {foodBreakfast} for breakfast.', v: 'eat', tenses: ROUTINE },
    meal: { es: '{S} ___ {foodMain} en {mealMain}.', en: '{S} {V} {foodMain} for {mealMain}.', v: 'eat', tenses: ROUTINE },
    much: { es: '{S} ___ mucho.', en: '{S} {V} a lot.', v: 'eat', who: PEOPLE_AND_ANIMALS, tenses: ACT },
  }),
  ...group('beber', {
    drink: { es: '{S} ___ {drink}.', en: '{S} {V} {drink}.', v: 'drink', tenses: ACT },
    water: { es: '{S} ___ mucha agua.', en: '{S} {V} a lot of water.', v: 'drink', who: PEOPLE_AND_ANIMALS, tenses: ACT },
    breakfast: { es: '{S} ___ {drinkBreakfast} en el desayuno.', en: '{S} {V} {drinkBreakfast} with breakfast.', v: 'drink', tenses: ROUTINE },
    meal: { es: '{S} ___ {drinkMain} en {mealMain}.', en: '{S} {V} {drinkMain} with {mealMain}.', v: 'drink', tenses: ROUTINE },
  }),
  ...group('tomar', {
    drink: { es: '{S} ___ {drink}.', en: '{S} {V} {drink}.', v: 'drink', tenses: ACT },
    breakfast: { es: '{S} ___ {drinkBreakfast} en el desayuno.', en: '{S} {V} {drinkBreakfast} with breakfast.', v: 'drink', tenses: ROUTINE },
    meal: { es: '{S} ___ {drinkMain} en {mealMain}.', en: '{S} {V} {drinkMain} with {mealMain}.', v: 'drink', tenses: ROUTINE },
    coffee: { es: '{S} ___ café con leche.', en: '{S} {V} coffee with milk.', v: 'drink', who: ['adult'], tenses: ACT },
    // "tomar el desayuno" sounds like Spain or a textbook; tomar fotos is everyday Spanish
    photos: { es: '{S} ___ muchas fotos.', en: '{S} {V} a lot of photos.', v: 'take', tenses: ACT },
  }),
  ...group('comprar', {
    // food you can buy there (fruit, bread), not dishes (soup, salad)
    market: { es: '{S} ___ {foodBuy} en el mercado.', en: '{S} {V} {foodBuy} at the market.', v: 'buy', tenses: ACT },
    store: { es: '{S} ___ {foodBuy} en la tienda.', en: '{S} {V} {foodBuy} at the store.', v: 'buy', tenses: ACT },
    thing: { es: '{S} ___ {schoolThing}.', en: '{S} {V} {schoolThing}.', v: 'buy', who: ['learner', 'teacher', 'family'], notWho: ['elder', 'server', 'animal'], tenses: EVENT },
    dinner: { es: '{S} ___ la comida para la cena.', en: '{S} {V} the food for dinner.', v: 'buy', who: ['family'], notWho: ['learner', 'animal'], tenses: ACT },
  }),
  ...group('vender', {
    market: { es: '{S} ___ {foodSell} en el mercado.', en: '{S} {V} {foodSell} at the market.', v: 'sell', who: ['adult'], notWho: ['teacher'], tenses: HABIT },
    store: { es: '{S} ___ {sellThing} en la tienda.', en: '{S} {V} {sellThing} at the store.', v: 'sell', who: ['adult'], notWho: ['teacher'], tenses: HABIT },
    city: { es: '{S} ___ comida en {city}.', en: '{S} {V} food in {city}.', v: 'sell', who: ['adult'], notWho: ['teacher'], tenses: HABIT },
    // a student sells too: food at a school sale
    school: { es: '{S} ___ comida en la escuela.', en: '{S} {V} food at school.', v: 'sell', who: ['learner', 'teacher'], tenses: HABIT },
    schoolThing: { es: '{S} ___ {sellThing} en la escuela.', en: '{S} {V} {sellThing} at school.', v: 'sell', who: ['learner', 'teacher'], tenses: HABIT },
    schoolSale: { es: '{S} ___ pasteles en la escuela.', en: '{S} {V} cakes at school.', v: 'sell', who: ['learner', 'teacher'], tenses: HABIT },
  }),
  ...group('pagar', {
    bill: { es: '{S} ___ la cuenta.', en: '{S} {V} the check.', v: 'pay', who: ['adult', 'learner'], notWho: ['server', 'kid'], tenses: EVENT },
    meal: { es: '{S} ___ {priceMeal} por {meal}.', en: '{S} {V} {priceMeal} for {meal}.', v: 'pay', who: ['adult', 'learner'], notWho: ['server', 'kid'], tenses: EVENT },
    food: { es: '{S} ___ la comida.', en: '{S} {V} for the food.', v: 'pay', who: ['adult', 'learner'], notWho: ['server', 'kid'], tenses: EVENT },
  }),
  // costar: only a thing costs, so only él / ellos cells have sentences (yo, tú, nosotros use the label)
  ...group('costar', {
    price: { es: '{T} ___ {price}.', en: '{T} {V} {price}.', v: 'cost', pivot: 'costThing', persons: ['el', 'ellos'] },
    market: { es: 'En el mercado, {T} ___ {price}.', en: 'At the market, {T} {V} {price}.', v: 'cost', pivot: 'costMarket', persons: ['el', 'ellos'] },
    pesos: { es: 'En México, {T} ___ {pricePesos}.', en: 'In Mexico, {T} {V} {pricePesos}.', v: 'cost', pivot: 'costPesos', persons: ['el', 'ellos'] },
    much: { es: '{T} ___ mucho dinero.', en: '{T} {V} a lot of money.', v: 'cost', pivot: 'costItem', persons: ['el', 'ellos'] },
  }),
  ...group('pedir', {
    // dishes from the menu, not groceries
    food: { es: '{S} ___ {foodOrder}.', en: '{S} {V} {foodOrder}.', v: 'order', notWho: ['server'], tenses: EVENT },
    bill: { es: '{S} ___ la cuenta.', en: '{S} {V} for the check.', v: 'ask', who: ['adult', 'learner'], notWho: ['server', 'kid'], tenses: EVENT },
    menu: { es: '{S} ___ el menú.', en: '{S} {V} for the menu.', v: 'ask', notWho: ['server'], tenses: EVENT },
    water: { es: '{S} ___ agua.', en: '{S} {V} for water.', v: 'ask', notWho: ['server'], tenses: EVENT },
    restaurant: { es: '{S} ___ {foodOrder} en el restaurante.', en: '{S} {V} {foodOrder} at the restaurant.', v: 'order', notWho: ['server'], tenses: EVENT },
  }),
  ...group('dar', {
    // dar + a person: the le / les that natives always add sits before the blank, outside the answer
    thanks: { es: '{S} {LE} ___ las gracias a {personObj}.', en: '{S} {V} {personObj}.', v: 'thank', io: 'personObj', tenses: EVENT },
    // the money goes to the server (handing "the money" to someone else's child reads badly)
    money: { es: '{S} {LE} ___ el dinero a {serverObj}.', en: '{S} {V} the money to {serverObj}.', v: 'give', io: 'serverObj', who: ['adult', 'learner'], notWho: ['server', 'kid'], tenses: EVENT },
    feed: { es: '{S} le ___ de comer al perro.', en: '{S} {V} the dog.', v: 'feed', tenses: ROUTINE },
    menu: { es: '{S} {LE} ___ el menú a {customerObj}.', en: '{S} {V} the menu to {customerObj}.', v: 'give', io: 'customerObj', who: ['server'], tenses: EVENT },
  }),
  ...group('poner', {
    book: { es: '{S} ___ el libro en la mesa.', en: '{S} {V} the book on the table.', v: 'put', notWho: ['server'], tenses: EVENT },
    backpack: { es: '{S} ___ la mochila en la silla.', en: '{S} {V} the backpack on the chair.', v: 'put', notWho: ['server'], tenses: EVENT },
    // a chore at home or a server's job, not a teacher's
    table: { es: '{S} ___ la mesa.', en: '{S} {V} the table.', v: 'set', who: ['family', 'server'], notWho: ['animal'], tenses: ACT },
    food: { es: '{S} ___ la comida en la mesa.', en: '{S} {V} the food on the table.', v: 'put', tenses: EVENT },
    papers: { es: '{S} ___ los papeles en el escritorio.', en: '{S} {V} the papers on the desk.', v: 'put', notWho: ['server'], tenses: EVENT },
  }),
  ...group('traer', {
    food: { es: '{S} ___ {foodThe} a la mesa.', en: '{S} {V} {foodThe} to the table.', v: 'bring', who: ['adult', 'learner'], tenses: EVENT },
    menu: { es: '{S} ___ el menú.', en: '{S} {V} the menu.', v: 'bring', who: ['server'], tenses: EVENT },
    homework: { es: '{S} ___ la tarea a clase.', en: '{S} {V} {POSS} homework to class.', v: 'bring', who: ['learner'], tenses: EVENT },
    book: { es: '{S} ___ un libro a la escuela.', en: '{S} {V} a book to school.', v: 'bring', who: ['learner', 'teacher'], tenses: EVENT },
    bill: { es: '{S} ___ la cuenta.', en: '{S} {V} the check.', v: 'bring', who: ['server'], tenses: EVENT },
  }),
  ...group('llevar', {
    backpack: { es: '{S} ___ {backpack}.', en: '{S} {V} {POSS} {backpack}.', v: 'carry', who: ['learner', 'adult'], notWho: ['server'], tenses: ACT },
    books: { es: '{S} ___ los libros a la escuela.', en: '{S} {V} the books to school.', v: 'take', who: ['learner', 'teacher'], tenses: EVENT },
    food: { es: '{S} ___ comida a la escuela.', en: '{S} {V} food to school.', v: 'take', who: ['learner', 'teacher'], tenses: EVENT },
    money: { es: '{S} ___ dinero.', en: '{S} {V} money.', v: 'carry', who: ['adult', 'learner'], tenses: ACT },
  }),
  ...group('abrir', {
    door: { es: '{S} ___ la puerta.', en: '{S} {V} the door.', v: 'open', tenses: EVENT },
    window: { es: '{S} ___ la ventana.', en: '{S} {V} the window.', v: 'open', tenses: EVENT },
    book: { es: '{S} ___ el libro.', en: '{S} {V} the book.', v: 'open', notWho: ['server'], tenses: EVENT },
    backpack: { es: '{S} ___ la mochila.', en: '{S} {V} the backpack.', v: 'open', notWho: ['server'], tenses: EVENT },
    store: { es: '{T} ___ {hourOpen}.', en: '{T} {V} {hourOpen}.', v: 'open', pivot: 'openThing', tenses: HABIT },
  }),
  ...group('cerrar', {
    door: { es: '{S} ___ la puerta.', en: '{S} {V} the door.', v: 'close', tenses: EVENT },
    window: { es: '{S} ___ la ventana.', en: '{S} {V} the window.', v: 'close', tenses: EVENT },
    book: { es: '{S} ___ el libro.', en: '{S} {V} the book.', v: 'close', notWho: ['server'], tenses: EVENT },
    backpack: { es: '{S} ___ la mochila.', en: '{S} {V} the backpack.', v: 'close', notWho: ['server'], tenses: EVENT },
    store: { es: '{T} ___ {hourClose}.', en: '{T} {V} {hourClose}.', v: 'close', pivot: 'openThing', tenses: HABIT },
  }),
  ...group('preferir', {
    food: { es: '{S} ___ {foodPrefer}.', en: '{S} {V} {foodPrefer}.', v: 'prefer' },
    restaurant: { es: '{S} ___ comer en el restaurante.', en: '{S} {V} to eat at the restaurant.', v: 'prefer' },
    drink: { es: '{S} ___ {drinkPrefer}.', en: '{S} {V} {drinkPrefer}.', v: 'prefer' },
    // a preference with its alternative ("Prefiero la sopa, no la ensalada")
    notThat: { es: '{S} ___ {foodPrefer}, no {foodPrefer:2}.', en: '{S} {V} {foodPrefer}, not {foodPrefer:2}.', v: 'prefer' },
  }),
];

/** Frames by entry id. */
export const FRAMES_BY_ENTRY: Map<string, Frame[]> = (() => {
  const map = new Map<string, Frame[]>();
  for (const f of FRAMES) {
    const list = map.get(f.entry) ?? [];
    list.push(f);
    map.set(f.entry, list);
  }
  return map;
})();

/** Entries the built-in frames cover. */
export function framedEntries(): string[] {
  return [...FRAMES_BY_ENTRY.keys()];
}
