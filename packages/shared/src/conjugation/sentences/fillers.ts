// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Complement slots: the hand-written phrases a frame's {slot} can hold,
 * with their English. A slot is filled only with phrases whose every word
 * the deck knows (vocab.ts), that suit the subject (a dog does not want to
 * be a teacher) and that agree with it (Mi abuela es alta / Mis primos son
 * altos). Phrases that agree carry four Spanish forms; when the subject's
 * gender does not show (yo, tú, usted, ustedes) only phrases that are the
 * same in both genders are used (joven, inteligente, estudiante).
 */
import { slug, contract } from './text.js';
import { deckNounPhrases } from './subjects.js';
import type { DeckContext } from './vocab.js';
import { wordStatus } from './vocab.js';
import { CITIES, kinKey, NAMES } from './words.js';
import type { GNumber } from '../types.js';
import type { ParsedSubject, SentenceCell, Tag } from './types.js';

/** Four agreeing forms: masculine / feminine, singular / plural. */
export interface Forms {
  ms: string;
  fs: string;
  mp: string;
  fp: string;
}

export interface FillerDef {
  id: string;
  es: string | Forms;
  /** English; {sg, pl} when it follows the subject's number (a teacher / teachers); Forms when it follows gender too (handsome / pretty). */
  en: string | { sg: string; pl: string } | Forms;
  /** The phrase's own number (the thing liked, a hay complement, a thing subject). */
  number?: GNumber;
  /** Nouns and names in it, so it never repeats the subject. */
  lemmas?: string[];
  /** Subjects it suits (any tag in common); unset: any subject. */
  who?: Tag[];
  /** Subjects it does not suit ("guapo" is not said of a teacher). */
  notWho?: Tag[];
  /** Not for a subject that includes the speaker ("Nosotros somos mis amigos"). */
  notFirst?: boolean;
  /** A person of the speaker's ("mi abuela", "mis amigos"): left out for a "we" subject, which would say nuestra. */
  kin?: boolean;
  /**
   * A thing subject's band: the slot `name.band` is used instead of `name` when it exists
   * (a juice costs price.cheap, a restaurant closes at hourClose.restaurant).
   */
  band?: string;
  /** A ":2" pick comes from the same set as the first (Luis, no Mateo; not Luis, no Sofía). */
  set?: string;
}

/** A slot filled for one subject. */
export interface Fill {
  id: string;
  es: string;
  en: string;
  number?: GNumber;
  band?: string;
  set?: string;
}

const F = (es: string, en: string, extra: Partial<FillerDef> = {}): FillerDef => ({ id: slug(es), es, en, ...extra });

function dollars(list: string[]): FillerDef[] {
  return list.map((p) => {
    const [es, en] = p.split(' ');
    return F(`${es} dólares`, `${en} dollars`);
  });
}

function pesos(list: string[]): FillerDef[] {
  return list.map((p) => {
    const [es, en] = p.split(' ');
    return F(`${es} pesos`, `${en} pesos`);
  });
}
function hours(list: string[]): FillerDef[] {
  return list.map((s) => {
    const [es, en] = s.split(' ');
    return F(`a las ${es}`, `at ${en}`);
  });
}
const sg = (es: string, en: string, extra: Partial<FillerDef> = {}) => F(es, en, { number: 'sg', ...extra });
const pl = (es: string, en: string, extra: Partial<FillerDef> = {}) => F(es, en, { number: 'pl', ...extra });

function forms(ms: string, fs?: string, mp?: string, fp?: string): Forms {
  const f = fs ?? `${ms.slice(0, -1)}a`;
  return { ms, fs: f, mp: mp ?? `${ms}s`, fp: fp ?? `${f}s` };
}
const same = (s: string, p: string): Forms => ({ ms: s, fs: s, mp: p, fp: p });
const adj = (id: string, f: Forms, en: string | Forms, who: Tag[]): FillerDef => ({ id, es: f, en, who });
/** guapo in English: handsome for a man, pretty for a woman, good-looking for a mixed group. */
const GUAPO_EN: Forms = { ms: 'handsome', fs: 'pretty', mp: 'good-looking', fp: 'pretty' };
/** After "look": "They look good-looking" is not English. */
const GUAPO_LOOK_EN: Forms = { ms: 'handsome', fs: 'pretty', mp: 'attractive', fp: 'pretty' };

const PERSON: Tag[] = ['person'];
const ANIMAL: Tag[] = ['animal'];

/** Static slot lists. */
export const FILLERS: Record<string, FillerDef[]> = {
  city: CITIES.map((c) => F(c.es, c.en, { lemmas: [c.es.toLowerCase()] })),
  // ser + adjective
  adjSer: [
    adj('alto', forms('alto'), 'tall', PERSON),
    adj('bajo', forms('bajo'), 'short', PERSON),
    adj('simpatico', forms('simpático'), 'nice', PERSON),
    adj('inteligente', same('inteligente', 'inteligentes'), 'smart', [...PERSON, ...ANIMAL]),
    adj('trabajador', forms('trabajador', 'trabajadora', 'trabajadores', 'trabajadoras'), 'hard-working', PERSON),
    adj('divertido', forms('divertido'), 'fun', [...PERSON, ...ANIMAL]),
    adj('serio', forms('serio'), 'serious', PERSON),
    // young: said of adults and pets, not of teenagers and children (or grandparents)
    { ...adj('joven', same('joven', 'jóvenes'), 'young', ['adult', 'animal']), notWho: ['learner', 'kid', 'elder'] },
    adj('fuerte', same('fuerte', 'fuertes'), 'strong', [...PERSON, ...ANIMAL]),
    // nobody comments on how a teacher or a server looks
    { ...adj('guapo', forms('guapo'), GUAPO_EN, PERSON), notWho: ['teacher', 'server'] },
    adj('grande', same('grande', 'grandes'), 'big', ANIMAL),
    adj('pequeno', forms('pequeño'), 'small', ANIMAL),
    adj('bonito', forms('bonito'), 'pretty', ANIMAL),
    adj('rapido', forms('rápido'), 'fast', ANIMAL),
    adj('negro', forms('negro'), 'black', ANIMAL),
    adj('blanco', forms('blanco'), 'white', ANIMAL),
  ],
  // verse + adjective (looks …)
  adjLook: [
    { ...adj('joven', same('joven', 'jóvenes'), 'young', ['adult', 'elder', 'animal']), notWho: ['learner', 'kid'] },
    adj('alto', forms('alto'), 'tall', PERSON),
    { ...adj('guapo', forms('guapo'), GUAPO_LOOK_EN, PERSON), notWho: ['teacher', 'server'] },
    adj('serio', forms('serio'), 'serious', PERSON),
    adj('fuerte', same('fuerte', 'fuertes'), 'strong', [...PERSON, ...ANIMAL]),
    adj('simpatico', forms('simpático'), 'nice', PERSON),
    adj('inteligente', same('inteligente', 'inteligentes'), 'smart', PERSON),
    adj('grande', same('grande', 'grandes'), 'big', ANIMAL),
    adj('pequeno', forms('pequeño'), 'small', ANIMAL),
    adj('bonito', forms('bonito'), 'pretty', ANIMAL),
    adj('viejo', forms('viejo'), 'old', ANIMAL),
  ],
  // ser + noun
  predSer: [
    { id: 'profesor', es: forms('profesor', 'profesora', 'profesores', 'profesoras'), en: { sg: 'a teacher', pl: 'teachers' }, lemmas: ['profesor', 'profesora'], who: ['adult'] },
    { id: 'estudiante', es: same('estudiante', 'estudiantes'), en: { sg: 'a student', pl: 'students' }, lemmas: ['estudiante'], who: ['learner'] },
    { id: 'amigo', es: forms('mi amigo', 'mi amiga', 'mis amigos', 'mis amigas'), en: { sg: 'my friend', pl: 'my friends' }, lemmas: ['amigo', 'amiga'], who: ['person'], notWho: ['teacher', 'server'], notFirst: true },
    { id: 'mesero', es: forms('mesero', 'mesera', 'meseros', 'meseras'), en: { sg: 'a server', pl: 'servers' }, lemmas: ['mesero', 'mesera'], who: ['adult'] },
  ],
  // querer ser + noun
  predWant: [
    { id: 'profesor', es: forms('profesor', 'profesora', 'profesores', 'profesoras'), en: { sg: 'a teacher', pl: 'teachers' }, lemmas: ['profesor', 'profesora'], who: ['learner'] },
    { id: 'mesero', es: forms('mesero', 'mesera', 'meseros', 'meseras'), en: { sg: 'a server', pl: 'servers' }, lemmas: ['mesero', 'mesera'], who: ['learner'] },
  ],
  pet: [
    F('un perro', 'a dog', { lemmas: ['perro'] }),
    F('un gato', 'a cat', { lemmas: ['gato'] }),
    F('dos perros', 'two dogs', { lemmas: ['perro'] }),
    F('dos gatos', 'two cats', { lemmas: ['gato'] }),
    F('tres gatos', 'three cats', { lemmas: ['gato'] }),
  ],
  eyes: [
    F('azules', 'blue'),
    F('verdes', 'green'),
    F('negros', 'dark'),
    F('cafés', 'brown'),
  ],
  hair: [F('negro', 'black'), F('café', 'brown'), F('blanco', 'white', { who: ['elder', 'animal'] })],
  // one each: a plural subject needs pencils, not one pencil to share
  schoolThing: [
    { id: 'un-lapiz', es: same('un lápiz', 'lápices'), en: { sg: 'a pencil', pl: 'pencils' } },
    { id: 'una-pluma', es: same('una pluma', 'plumas'), en: { sg: 'a pen', pl: 'pens' } },
    { id: 'un-boligrafo', es: same('un bolígrafo', 'bolígrafos'), en: { sg: 'a pen', pl: 'pens' } },
    { id: 'un-libro', es: same('un libro', 'libros'), en: { sg: 'a book', pl: 'books' } },
    { id: 'una-mochila', es: same('una mochila', 'mochilas'), en: { sg: 'a backpack', pl: 'backpacks' } },
    { id: 'una-mochila-nueva', es: same('una mochila nueva', 'mochilas nuevas'), en: { sg: 'a new backpack', pl: 'new backpacks' } },
    F('papel', 'paper'),
  ],
  // the subject's own: "Yo llevo la mochila" / "Mis amigos llevan las mochilas" (English: my backpack, their backpacks)
  backpack: [{ id: 'la-mochila', es: same('la mochila', 'las mochilas'), en: { sg: 'backpack', pl: 'backpacks' } }],
  classOwn: [{ id: 'la-clase', es: same('la clase', 'las clases'), en: { sg: 'class', pl: 'classes' } }],
  writeTool: [F('un lápiz', 'a pencil'), F('una pluma', 'a pen'), F('un bolígrafo', 'a pen')],
  sellThing: [F('libros', 'books'), F('mochilas', 'backpacks'), F('lápices', 'pencils'), F('plumas', 'pens'), F('papel', 'paper')],
  food: [
    F('pollo', 'chicken'),
    F('arroz', 'rice'),
    F('pan', 'bread'),
    F('carne', 'meat'),
    F('pescado', 'fish'),
    F('queso', 'cheese'),
    F('fruta', 'fruit'),
    F('ensalada', 'salad'),
    F('sopa', 'soup'),
    F('verduras', 'vegetables'),
    F('papas', 'potatoes'),
    F('tacos', 'tacos'),
    F('frijoles', 'beans'),
    F('huevos', 'eggs'),
    F('tortillas', 'tortillas'),
    F('manzanas', 'apples'),
    F('plátanos', 'bananas'),
    F('helado', 'ice cream'),
    F('pollo con arroz', 'chicken with rice'),
  ],
  // what a market or a store sells (raw food, not dishes)
  foodBuy: [
    F('fruta', 'fruit'),
    F('pan', 'bread'),
    F('queso', 'cheese'),
    F('tortillas', 'tortillas'),
    F('manzanas', 'apples'),
    F('naranjas', 'oranges'),
    F('plátanos', 'bananas'),
    F('verduras', 'vegetables'),
    F('pescado', 'fish'),
    F('pollo', 'chicken'),
    F('carne', 'meat'),
    F('huevos', 'eggs'),
    F('arroz', 'rice'),
    F('frijoles', 'beans'),
    F('papas', 'potatoes'),
  ],
  // what a restaurant serves (pedir)
  foodOrder: [
    F('sopa', 'soup'),
    F('ensalada', 'salad'),
    F('tacos', 'tacos'),
    F('pollo con arroz', 'chicken with rice'),
    F('pescado', 'fish'),
    F('carne', 'meat'),
    F('helado', 'ice cream'),
    F('tacos de pollo', 'chicken tacos'),
  ],
  // breakfast and the other meals
  foodBreakfast: [
    F('huevos', 'eggs'),
    F('pan', 'bread'),
    F('fruta', 'fruit'),
    F('tortillas', 'tortillas'),
    F('plátanos', 'bananas'),
    F('huevos y frijoles', 'eggs and beans'),
  ],
  foodMain: [
    F('pollo', 'chicken'),
    F('sopa', 'soup'),
    F('arroz', 'rice'),
    F('carne', 'meat'),
    F('tacos', 'tacos'),
    F('pescado', 'fish'),
    F('ensalada', 'salad'),
    F('pollo con arroz', 'chicken with rice'),
    F('verduras', 'vegetables'),
  ],
  mealMain: [F('el almuerzo', 'lunch'), F('la cena', 'dinner')],
  drinkBreakfast: [
    F('leche', 'milk'),
    F('jugo', 'juice'),
    F('jugo de naranja', 'orange juice'),
    F('café', 'coffee', { who: ['adult'] }),
  ],
  drinkMain: [F('agua', 'water'), F('jugo', 'juice'), F('un refresco', 'a soda'), F('leche', 'milk')],
  foodSell: [
    F('fruta', 'fruit'),
    F('pan', 'bread'),
    F('queso', 'cheese'),
    F('tortillas', 'tortillas'),
    F('manzanas', 'apples'),
    F('naranjas', 'oranges'),
    F('plátanos', 'bananas'),
    F('verduras', 'vegetables'),
    F('pescado', 'fish'),
  ],
  drink: [
    F('agua', 'water'),
    F('leche', 'milk'),
    F('jugo', 'juice'),
    F('jugo de naranja', 'orange juice'),
    F('café', 'coffee', { who: ['adult'] }),
    F('un refresco', 'a soda'),
  ],
  // preferir: the generic article in Spanish, none in English
  // sets: "Prefiero X, no Y" contrasts two of a kind (a dish with a dish, a dessert with a dessert)
  foodPrefer: [
    F('el pollo', 'chicken', { set: 'main' }),
    F('la sopa', 'soup', { set: 'main' }),
    F('el pescado', 'fish', { set: 'main' }),
    F('la ensalada', 'salad', { set: 'main' }),
    F('los tacos', 'tacos', { set: 'main' }),
    F('la carne', 'meat', { set: 'main' }),
    F('las papas', 'potatoes', { set: 'side' }),
    F('las verduras', 'vegetables', { set: 'side' }),
    F('el arroz', 'rice', { set: 'side' }),
    F('la fruta', 'fruit', { set: 'dessert' }),
    F('el helado', 'ice cream', { set: 'dessert' }),
    F('el pastel', 'cake', { set: 'dessert' }),
  ],
  drinkPrefer: [
    F('el agua', 'water'),
    F('la leche', 'milk'),
    F('el jugo', 'juice'),
    F('el jugo de naranja', 'orange juice'),
    F('el café', 'coffee', { who: ['adult'] }),
  ],
  // traer: a definite thing in both languages
  foodThe: [
    F('la sopa', 'the soup'),
    F('el pollo', 'the chicken'),
    F('los tacos', 'the tacos'),
    F('la ensalada', 'the salad'),
    F('el pan', 'the bread'),
    F('el agua', 'the water'),
    F('el postre', 'the dessert'),
    F('la comida', 'the food'),
  ],
  meal: [F('el desayuno', 'breakfast'), F('el almuerzo', 'lunch'), F('la cena', 'dinner')],
  priceMeal: dollars(['seis six', 'ocho eight', 'diez ten', 'doce twelve', 'quince fifteen']),
  // prices that suit what costs them (costar): a juice is cheap, a backpack is not
  'price.cheap': dollars(['dos two', 'tres three', 'cuatro four', 'cinco five']),
  'price.meal': dollars(['seis six', 'ocho eight', 'diez ten', 'doce twelve', 'quince fifteen']),
  'price.item': dollars(['doce twelve', 'quince fifteen', 'veinte twenty', 'veinticinco twenty-five', 'treinta thirty']),
  'pricePesos.cheap': pesos(['diez ten', 'quince fifteen', 'veinte twenty']),
  // opening and closing hours by place (a restaurant does not close at five)
  'hourOpen.store': hours(['nueve nine', 'diez ten']),
  'hourOpen.market': hours(['siete seven', 'ocho eight']),
  'hourOpen.restaurant': hours(['ocho eight', 'nueve nine', 'once eleven']),
  'hourOpen.school': hours(['siete seven', 'ocho eight']),
  'hourClose.store': hours(['ocho eight', 'nueve nine']),
  'hourClose.market': hours(['cinco five', 'seis six']),
  'hourClose.restaurant': hours(['diez ten', 'once eleven']),
  'hourClose.school': hours(['cuatro four', 'cinco five']),
  hourClass: hours(['siete seven', 'ocho eight', 'nueve nine', 'diez ten', 'once eleven']),
  // gustar: the thing liked fixes gusta / gustan
  like: [
    sg('la escuela', 'school'),
    sg('la clase', 'the class'),
    sg('la clase de español', 'Spanish class'),
    sg('el español', 'Spanish'),
    sg('la música', 'music'),
    sg('ir a la escuela', 'going to school'),
    sg('ir a clase', 'going to class'),
    sg('Lima', 'Lima'),
    sg('Madrid', 'Madrid'),
    sg('México', 'Mexico'),
    sg('el perro', 'the dog', { lemmas: ['perro'] }),
    sg('el gato', 'the cat', { lemmas: ['gato'] }),
    sg('la comida', 'the food'),
    sg('el helado', 'ice cream'),
    pl('las clases', 'the classes'),
    pl('las clases de español', 'Spanish classes'),
    pl('las fotos', 'photos'),
    pl('los animales', 'animals'),
    pl('los perros', 'dogs', { lemmas: ['perro'] }),
    pl('los gatos', 'cats', { lemmas: ['gato'] }),
    pl('los libros', 'books'),
    pl('los tacos', 'tacos'),
    pl('las papas', 'potatoes'),
  ],
  // gustar with "no": no places, no Spanish class
  // (a teacher-made app does not say a teacher dislikes school)
  likeNo: [
    sg('la escuela', 'school', { notWho: ['teacher'] }),
    sg('la música', 'music'),
    sg('ir a la escuela', 'going to school', { notWho: ['teacher'] }),
    sg('la comida', 'the food'),
    sg('el helado', 'ice cream'),
    sg('el perro', 'the dog', { lemmas: ['perro'] }),
    pl('las fotos', 'photos'),
    pl('los perros', 'dogs', { lemmas: ['perro'] }),
    pl('los gatos', 'cats', { lemmas: ['gato'] }),
    pl('los animales', 'animals'),
    pl('las papas', 'potatoes'),
  ],
  // hay complements, each frame its own list
  haySchool: [
    pl('muchos chicos', 'many boys'),
    pl('muchas chicas', 'many girls'),
    pl('muchos profesores', 'many teachers'),
    pl('muchos estudiantes', 'many students'),
    pl('muchas clases', 'many classes'),
    sg('una profesora nueva', 'a new teacher'),
    sg('un profesor nuevo', 'a new teacher'),
  ],
  hayClass: [
    pl('veinte chicos', 'twenty boys'),
    pl('quince chicas', 'fifteen girls'),
    pl('treinta estudiantes', 'thirty students'),
    pl('veinticinco estudiantes', 'twenty-five students'),
    sg('un profesor', 'one teacher'),
    sg('una profesora', 'one teacher'),
  ],
  hayTable: [
    sg('un libro', 'a book'),
    pl('dos lápices', 'two pencils'),
    sg('una mochila', 'a backpack'),
    pl('muchos papeles', 'a lot of papers'),
    sg('una pluma', 'a pen'),
  ],
  hayMarket: [
    sg('mucha fruta', 'a lot of fruit'),
    pl('muchas manzanas', 'a lot of apples'),
    pl('muchas verduras', 'a lot of vegetables'),
    pl('pan y queso', 'bread and cheese'),
    pl('pollo y pescado', 'chicken and fish'),
  ],
  hayRestaurant: [
    pl('muchas mesas', 'a lot of tables'),
    sg('un mesero nuevo', 'a new server'),
    sg('una mesera nueva', 'a new server'),
    pl('sopa y ensalada', 'soup and salad'),
    pl('tacos de pollo', 'chicken tacos'),
  ],
  hayCount: [
    pl('diez chicos y doce chicas', 'ten boys and twelve girls'),
    pl('quince chicos y catorce chicas', 'fifteen boys and fourteen girls'),
    pl('ocho chicos y nueve chicas', 'eight boys and nine girls'),
  ],
  // thing subjects
  costThing: [
    sg('el café', 'the coffee', { band: 'cheap' }),
    sg('la sopa', 'the soup', { band: 'meal' }),
    sg('el helado', 'the ice cream', { band: 'cheap' }),
    sg('el pastel', 'the cake', { band: 'meal' }),
    sg('la ensalada', 'the salad', { band: 'meal' }),
    sg('el libro', 'the book', { band: 'item' }),
    sg('la mochila', 'the backpack', { band: 'item' }),
    sg('el almuerzo', 'lunch', { band: 'meal' }),
    sg('el jugo', 'the juice', { band: 'cheap' }),
    pl('los tacos', 'the tacos', { band: 'meal' }),
    pl('las papas', 'the potatoes', { band: 'cheap' }),
    pl('los libros', 'the books', { band: 'item' }),
    pl('las manzanas', 'the apples', { band: 'cheap' }),
    pl('los huevos', 'the eggs', { band: 'cheap' }),
    pl('las tortillas', 'the tortillas', { band: 'cheap' }),
  ],
  // costar at the market: food only
  costMarket: [
    sg('el pan', 'the bread', { band: 'cheap' }),
    sg('el queso', 'the cheese', { band: 'cheap' }),
    sg('la fruta', 'the fruit', { band: 'cheap' }),
    pl('las manzanas', 'the apples', { band: 'cheap' }),
    pl('los huevos', 'the eggs', { band: 'cheap' }),
    pl('las tortillas', 'the tortillas', { band: 'cheap' }),
    pl('las papas', 'the potatoes', { band: 'cheap' }),
  ],
  // costar "mucho dinero": only what really costs a lot for a student
  costItem: [
    sg('el libro', 'the book'),
    sg('la mochila', 'the backpack'),
    pl('los libros', 'the books'),
    pl('las mochilas', 'the backpacks'),
  ],
  // costar in pesos: cheap things only (10-20 pesos is a juice, not a lunch)
  costPesos: [
    sg('el café', 'the coffee', { band: 'cheap' }),
    sg('el jugo', 'the juice', { band: 'cheap' }),
    sg('el helado', 'the ice cream', { band: 'cheap' }),
    sg('el pan', 'the bread', { band: 'cheap' }),
    pl('las tortillas', 'the tortillas', { band: 'cheap' }),
  ],
  openThing: [
    sg('la tienda', 'the store', { band: 'store' }),
    sg('el mercado', 'the market', { band: 'market' }),
    sg('el restaurante', 'the restaurant', { band: 'restaurant' }),
    sg('la escuela', 'the school', { band: 'school' }),
    pl('las tiendas', 'the stores', { band: 'store' }),
  ],
  classThing: [
    sg('la clase', 'the class'),
    pl('las clases', 'classes'),
    sg('el examen', 'the test'),
    sg('la clase de español', 'Spanish class'),
  ],
};

const FEMALE = NAMES.filter((n) => n.g === 'f').map((n) => n.es);
const MALE = NAMES.filter((n) => n.g === 'm').map((n) => n.es);
const PAIRS_F = ['Ana y Sofía', 'Elena y Rosa', 'Lucía y Marta'];
const PAIRS_M = ['Luis y Mateo', 'Diego y Carlos', 'Tomás y Miguel'];
const PAIRS_X = ['Ana y Luis', 'Sofía y Diego', 'Elena y Mateo'];

function agreeingForm(f: Forms, s: ParsedSubject): string | null {
  const invariant = f.ms === f.fs && f.mp === f.fp;
  if (s.gender === 'x' && !invariant) return null;
  const g = s.gender === 'f' ? 'f' : 'm';
  return s.number === 'sg' ? (g === 'f' ? f.fs : f.ms) : g === 'f' ? f.fp : f.mp;
}

function suits(who: Tag[] | undefined, s: ParsedSubject | null): boolean {
  if (!who || !s) return true;
  return who.some((t) => s.tags.includes(t));
}

function knownText(es: string, ctx: DeckContext): boolean {
  return contract(es)
    .split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/)
    .filter(Boolean)
    .every((w) => wordStatus(w, ctx) === 'ok');
}

/** Ages that suit a subject: teenagers 13-17, children 6-10, adults 25-30, pets 2-9; none for grandparents and babies. */
function ages(s: ParsedSubject): FillerDef[] {
  const pick = (list: string[]) =>
    list.map((p) => {
      const [es, en] = p.split(':');
      return F(`${es} años`, `${en} years old`);
    });
  if (s.tags.includes('kid')) return pick(['seis:six', 'siete:seven', 'ocho:eight', 'nueve:nine', 'diez:ten']);
  if (s.tags.includes('learner')) return pick(['trece:thirteen', 'catorce:fourteen', 'quince:fifteen', 'dieciséis:sixteen', 'diecisiete:seventeen']);
  if (s.tags.includes('animal')) return pick(['dos:two', 'tres:three', 'cinco:five', 'ocho:eight', 'nueve:nine']);
  if (s.tags.includes('elder') || s.tags.includes('baby')) return [];
  if (s.tags.includes('adult')) return pick(['veinticinco:twenty-five', 'veintiocho:twenty-eight', 'treinta:thirty']);
  return [];
}

/**
 * Names that suit a subject for llamarse / ser: by its gender and number. When the gender
 * does not show (yo, tú) the list mixes both, and each name carries its gender as its set,
 * so "Te llamas Luis, no Mateo" never becomes "Luis, no Sofía".
 */
function names(s: ParsedSubject): FillerDef[] {
  if (s.number === 'sg') {
    if (s.tags.includes('animal')) return ['Lola', 'Rubén', 'Marcos'].map((n) => F(n, n, { lemmas: [n.toLowerCase()], set: 'pet' }));
    const list = s.gender === 'f' ? FEMALE : s.gender === 'm' ? MALE : [...FEMALE.slice(0, 3), ...MALE.slice(0, 3)];
    return list.map((n) => F(n, n, { lemmas: [n.toLowerCase()], set: FEMALE.includes(n) ? 'f' : 'm' }));
  }
  const list = s.gender === 'f' ? PAIRS_F : s.gender === 'm' ? [...PAIRS_M, ...PAIRS_X] : PAIRS_X;
  return list.map((n) => F(n, n.replace(' y ', ' and '), { lemmas: n.toLowerCase().split(' y ') }));
}

type PeopleKind = 'family' | 'elders' | 'peers' | 'teachers' | 'servers' | 'friends' | 'names';

/** Kin keys of the family nouns. */
const FAMILY_KEYS = new Set(['padre', 'hermano', 'abuelo', 'tío', 'primo', 'hijo']);
/** Parents and grandparents: who a student or a relative lives with. */
const ELDERS = new Set(['padre', 'abuelo']);
/** Siblings, cousins and friends: who a student studies or goes to school with. */
const PEERS = new Set(['hermano', 'primo', 'amigo']);

/**
 * People as complements ("con mi abuela", "a mis primos"), from the deck's nouns plus two
 * names. Each kind is a group of nouns: family (every relative), elders (parents and
 * grandparents), peers (siblings, cousins, friends), teachers, servers, friends, names.
 */
function people(ctx: DeckContext, kinds: PeopleKind[]): FillerDef[] {
  const want = new Set(kinds);
  const out: FillerDef[] = deckNounPhrases(ctx)
    .filter((p) => p.noun.tags.includes('person'))
    .filter((p) => {
      const t = p.noun.tags;
      const key = kinKey(p.noun);
      return (
        (want.has('family') && t.includes('family')) ||
        (want.has('elders') && ELDERS.has(key)) ||
        (want.has('peers') && PEERS.has(key)) ||
        (want.has('teachers') && t.includes('teacher')) ||
        (want.has('servers') && t.includes('server')) ||
        (want.has('friends') && key === 'amigo')
      );
    })
    // two grandmothers living together with someone is odd: "mis abuelas" is not a household
    .filter((p) => !(want.has('elders') && !want.has('family') && p.noun.sg === 'abuela' && p.number === 'pl'))
    .map((p) => {
      const det = p.es.startsWith('mi') ? 'my' : 'the';
      // "mi abuela", "mis amigos": a "we" subject would say nuestra / nuestros
      const shared = p.es.startsWith('mi');
      return F(p.es, `${det} ${p.number === 'sg' ? p.noun.en : p.noun.enPl}`, {
        lemmas: [...new Set([p.noun.sg, kinKey(p.noun)])],
        number: p.number,
        ...(shared ? { kin: true } : {}),
      });
    });
  if (want.has('names')) out.push(F('Ana', 'Ana', { lemmas: ['ana'], number: 'sg' }), F('Luis', 'Luis', { lemmas: ['luis'], number: 'sg' }));
  return out;
}

/** The person slots: which people each one holds. */
const PEOPLE_SLOTS: Record<string, PeopleKind[]> = {
  // talk with, listen to, see, hear, thank
  personObj: ['family', 'teachers', 'servers', 'friends', 'names'],
  // live with (vivir): parents and grandparents only; anyone else reads as moving in together
  familyObj: ['elders'],
  // study, do homework, go to school, learn with: siblings, cousins, friends
  peerObj: ['peers', 'names'],
  // a server brings the menu to the customers
  customerObj: ['family', 'friends', 'names'],
  // the money goes to the server
  serverObj: ['servers'],
};

/** The fills a slot can take for a subject in a deck, in a stable order. */
export function slotFills(slot: string, ctx: DeckContext, subject: ParsedSubject | null, cell: SentenceCell): Fill[] {
  let defs: FillerDef[];
  if (slot === 'age') defs = subject ? ages(subject) : [];
  else if (slot === 'names') defs = subject ? names(subject) : [];
  else if (slot === 'serverObj') defs = people(ctx, ['servers']).filter((d) => d.number === 'sg');
  else if (PEOPLE_SLOTS[slot]) defs = people(ctx, PEOPLE_SLOTS[slot]);
  else if (slot === 'knowObj') {
    // conocer: a relative "knows" their own family trivially, so family subjects get non-family objects
    // and the speaker trivially knows "mi amigo" or "mi profesora": only names and the server then
    const speaker = subject && (subject.enPerson === '1sg' || subject.enPerson === '1pl');
    defs = people(ctx, ['family', 'teachers', 'servers', 'friends', 'names'])
      .filter((d) => !(subject?.tags.includes('family') && d.lemmas?.some((l) => FAMILY_KEYS.has(l))))
      .filter((d) => !(speaker && typeof d.es === 'string' && /^mis? /.test(d.es)));
  } else if (slot === 'companionObj') {
    // travel with: family; friends only for a student (an adult does not take a student's friend on a trip)
    defs = people(ctx, subject?.tags.includes('learner') ? ['family', 'friends'] : ['family']);
  } else defs = FILLERS[slot] ?? [];
  const out: Fill[] = [];
  const avoid = new Set(subject?.lemmas ?? []);
  const first = subject && (subject.enPerson === '1sg' || subject.enPerson === '1pl');
  for (const d of defs) {
    if (!suits(d.who, subject)) continue;
    if (d.notWho && subject && suits(d.notWho, subject)) continue;
    if (d.notFirst && first) continue;
    // "Nosotros vivimos con mi madre": a native says nuestra madre, which would give the form away
    if (d.kin && subject?.enPerson === '1pl') continue;
    if (d.lemmas?.some((l) => avoid.has(l))) continue;
    let es: string | null;
    if (typeof d.es === 'string') es = d.es;
    else es = subject ? agreeingForm(d.es, subject) : null;
    if (!es || !knownText(es, ctx)) continue;
    const n = subject?.number ?? 'sg';
    const en =
      typeof d.en === 'string'
        ? d.en
        : 'ms' in d.en
          ? subject
            ? agreeingForm(d.en, { ...subject, gender: subject.gender === 'x' ? 'm' : subject.gender })!
            : d.en.ms
          : d.en[n];
    out.push({
      id: d.id,
      es,
      en,
      ...(d.number ? { number: d.number } : {}),
      ...(d.band ? { band: d.band } : {}),
      ...(d.set ? { set: d.set } : {}),
    });
  }
  void cell;
  return out;
}
