// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The engine's word knowledge: nouns (gender, plural, English, what they can
 * do as subjects), adjectives with their four forms, the neutral names and
 * places, and the core list every deck may use on top of its own cards.
 *
 * A deck noun can be a subject or a complement only if it is here, because the
 * checker must know its gender and number. The vocabulary rule is separate:
 * a word must also be on the deck's cards, an earlier deck's cards or the core
 * list (vocab.ts).
 */
import type { Tag } from './types.js';

export interface NounEntry {
  sg: string;
  /** null for nouns used only in the singular (dinero, arroz); same string when sg = pl (cumpleaños). */
  pl: string | null;
  /** 'mf': the article shows the gender (el / la estudiante). */
  g: 'm' | 'f' | 'mf';
  en: string;
  enPl: string;
  tags: Tag[];
  /** The determiner the subject bank uses: "mi abuela", "el chico". */
  det: 'mi' | 'el';
  /** May be a subject in the bank (people and animals). */
  subject?: boolean;
  /** Singular agreement for a plural meaning: never a subject (mi familia, la gente). */
  collective?: boolean;
  /** Feminine noun that takes el in the singular (el agua). */
  elArticle?: boolean;
  /** Plural-only in use (frijoles, verduras). */
  plOnly?: boolean;
  /**
   * Kin key: the nouns that name the same kind of person share it, across gender and synonyms
   * (abuela → abuelo, mamá → padre, profesora → profesor). Set from KIN below; default the singular.
   */
  kin?: string;
}

const P = (
  sg: string,
  pl: string | null,
  g: NounEntry['g'],
  en: string,
  enPl: string,
  tags: Tag[],
  det: 'mi' | 'el',
  extra: Partial<NounEntry> = {},
): NounEntry => ({ sg, pl, g, en, enPl, tags, det, subject: true, ...extra });

const T = (sg: string, pl: string | null, g: NounEntry['g'], en: string, enPl: string, extra: Partial<NounEntry> = {}): NounEntry => ({
  sg,
  pl,
  g,
  en,
  enPl,
  tags: ['thing'],
  det: 'el',
  ...extra,
});

/** People and animals that can be subjects, then things. */
export const NOUNS: NounEntry[] = [
  // Unit 1
  P('chico', 'chicos', 'm', 'boy', 'boys', ['person', 'learner'], 'el'),
  P('chica', 'chicas', 'f', 'girl', 'girls', ['person', 'learner'], 'el'),
  P('amigo', 'amigos', 'm', 'friend', 'friends', ['person', 'learner'], 'mi'),
  P('amiga', 'amigas', 'f', 'friend', 'friends', ['person', 'learner'], 'mi'),
  P('profesor', 'profesores', 'm', 'teacher', 'teachers', ['person', 'adult', 'teacher'], 'mi'),
  P('profesora', 'profesoras', 'f', 'teacher', 'teachers', ['person', 'adult', 'teacher'], 'mi'),
  // Unit 2
  P('madre', null, 'f', 'mother', 'mothers', ['person', 'adult', 'family', 'household'], 'mi'),
  P('mamá', null, 'f', 'mom', 'moms', ['person', 'adult', 'family', 'household'], 'mi'),
  P('padre', 'padres', 'm', 'father', 'parents', ['person', 'adult', 'family', 'household'], 'mi'),
  P('papá', null, 'm', 'dad', 'dads', ['person', 'adult', 'family', 'household'], 'mi'),
  P('hermano', 'hermanos', 'm', 'brother', 'brothers and sisters', ['person', 'learner', 'family', 'household'], 'mi'),
  P('hermana', 'hermanas', 'f', 'sister', 'sisters', ['person', 'learner', 'family', 'household'], 'mi'),
  P('abuelo', 'abuelos', 'm', 'grandfather', 'grandparents', ['person', 'adult', 'elder', 'family'], 'mi'),
  P('abuela', 'abuelas', 'f', 'grandmother', 'grandmothers', ['person', 'adult', 'elder', 'family'], 'mi'),
  P('tío', 'tíos', 'm', 'uncle', 'aunts and uncles', ['person', 'adult', 'family'], 'mi'),
  P('tía', 'tías', 'f', 'aunt', 'aunts', ['person', 'adult', 'family'], 'mi'),
  P('primo', 'primos', 'm', 'cousin', 'cousins', ['person', 'learner', 'family'], 'mi'),
  P('prima', 'primas', 'f', 'cousin', 'cousins', ['person', 'learner', 'family'], 'mi'),
  P('hombre', 'hombres', 'm', 'man', 'men', ['person', 'adult'], 'el', { subject: false }),
  P('mujer', 'mujeres', 'f', 'woman', 'women', ['person', 'adult'], 'el', { subject: false }),
  P('niño', 'niños', 'm', 'boy', 'children', ['person', 'kid', 'learner'], 'el'),
  P('niña', 'niñas', 'f', 'girl', 'girls', ['person', 'kid', 'learner'], 'el'),
  P('bebé', 'bebés', 'm', 'baby', 'babies', ['baby'], 'el'),
  P('perro', 'perros', 'm', 'dog', 'dogs', ['animal', 'family'], 'mi'),
  P('gato', 'gatos', 'm', 'cat', 'cats', ['animal', 'family'], 'mi'),
  // Known but not bank subjects: the narrator is a teenager (mi hijo), la persona is feminine for anyone.
  P('hijo', 'hijos', 'm', 'son', 'children', ['person'], 'mi', { subject: false }),
  P('hija', 'hijas', 'f', 'daughter', 'daughters', ['person'], 'mi', { subject: false }),
  P('persona', 'personas', 'f', 'person', 'people', ['person'], 'el', { subject: false }),
  // Unit 3
  P('estudiante', 'estudiantes', 'mf', 'student', 'students', ['person', 'learner'], 'el'),
  // Unit 4
  P('mesero', 'meseros', 'm', 'server', 'servers', ['person', 'adult', 'server'], 'el'),
  P('mesera', 'meseras', 'f', 'server', 'servers', ['person', 'adult', 'server'], 'el'),

  // Collectives: singular verb, plural meaning. Never subjects.
  T('familia', 'familias', 'f', 'family', 'families', { collective: true }),
  T('gente', null, 'f', 'people', 'people', { collective: true }),
  T('grupo', 'grupos', 'm', 'group', 'groups', { collective: true }),
  T('equipo', 'equipos', 'm', 'team', 'teams', { collective: true }),

  // Things (Units 1-4 and the core cognates)
  T('escuela', 'escuelas', 'f', 'school', 'schools'),
  T('clase', 'clases', 'f', 'class', 'classes'),
  T('año', 'años', 'm', 'year', 'years'),
  T('pelo', null, 'm', 'hair', 'hair'),
  T('ojo', 'ojos', 'm', 'eye', 'eyes'),
  T('color', 'colores', 'm', 'color', 'colors'),
  T('nombre', 'nombres', 'm', 'name', 'names'),
  T('cumpleaños', 'cumpleaños', 'm', 'birthday', 'birthdays'),
  T('libro', 'libros', 'm', 'book', 'books'),
  T('papel', 'papeles', 'm', 'paper', 'papers'),
  T('lápiz', 'lápices', 'm', 'pencil', 'pencils'),
  T('pluma', 'plumas', 'f', 'pen', 'pens'),
  T('bolígrafo', 'bolígrafos', 'm', 'pen', 'pens'),
  T('mochila', 'mochilas', 'f', 'backpack', 'backpacks'),
  T('escritorio', 'escritorios', 'm', 'desk', 'desks'),
  T('silla', 'sillas', 'f', 'chair', 'chairs'),
  T('mesa', 'mesas', 'f', 'table', 'tables'),
  T('puerta', 'puertas', 'f', 'door', 'doors'),
  T('ventana', 'ventanas', 'f', 'window', 'windows'),
  T('tarea', 'tareas', 'f', 'homework', 'homework'),
  T('examen', 'exámenes', 'm', 'test', 'tests'),
  T('pregunta', 'preguntas', 'f', 'question', 'questions'),
  T('respuesta', 'respuestas', 'f', 'answer', 'answers'),
  T('palabra', 'palabras', 'f', 'word', 'words'),
  T('día', 'días', 'm', 'day', 'days'),
  T('semana', 'semanas', 'f', 'week', 'weeks'),
  T('mes', 'meses', 'm', 'month', 'months'),
  T('hora', 'horas', 'f', 'hour', 'hours'),
  T('minuto', 'minutos', 'm', 'minute', 'minutes'),
  T('comida', 'comidas', 'f', 'food', 'meals'),
  T('desayuno', 'desayunos', 'm', 'breakfast', 'breakfasts'),
  T('almuerzo', 'almuerzos', 'm', 'lunch', 'lunches'),
  T('cena', 'cenas', 'f', 'dinner', 'dinners'),
  T('pan', 'panes', 'm', 'bread', 'breads'),
  T('queso', 'quesos', 'm', 'cheese', 'cheeses'),
  T('carne', 'carnes', 'f', 'meat', 'meats'),
  T('pollo', 'pollos', 'm', 'chicken', 'chickens'),
  T('pescado', 'pescados', 'm', 'fish', 'fish'),
  T('huevo', 'huevos', 'm', 'egg', 'eggs'),
  T('arroz', null, 'm', 'rice', 'rice'),
  T('frijol', 'frijoles', 'm', 'bean', 'beans', { plOnly: true }),
  T('ensalada', 'ensaladas', 'f', 'salad', 'salads'),
  T('sopa', 'sopas', 'f', 'soup', 'soups'),
  T('fruta', 'frutas', 'f', 'fruit', 'fruits'),
  T('manzana', 'manzanas', 'f', 'apple', 'apples'),
  T('naranja', 'naranjas', 'f', 'orange', 'oranges'),
  T('plátano', 'plátanos', 'm', 'banana', 'bananas'),
  T('verdura', 'verduras', 'f', 'vegetable', 'vegetables', { plOnly: true }),
  T('papa', 'papas', 'f', 'potato', 'potatoes'),
  T('tortilla', 'tortillas', 'f', 'tortilla', 'tortillas'),
  T('taco', 'tacos', 'm', 'taco', 'tacos'),
  T('postre', 'postres', 'm', 'dessert', 'desserts'),
  T('helado', 'helados', 'm', 'ice cream', 'ice creams'),
  T('pastel', 'pasteles', 'm', 'cake', 'cakes'),
  T('dulce', 'dulces', 'm', 'candy', 'candy'),
  T('agua', 'aguas', 'f', 'water', 'waters', { elArticle: true }),
  T('leche', null, 'f', 'milk', 'milk'),
  T('jugo', 'jugos', 'm', 'juice', 'juices'),
  T('refresco', 'refrescos', 'm', 'soda', 'sodas'),
  T('café', 'cafés', 'm', 'coffee', 'coffees'),
  T('restaurante', 'restaurantes', 'm', 'restaurant', 'restaurants'),
  T('menú', 'menús', 'm', 'menu', 'menus'),
  T('cuenta', 'cuentas', 'f', 'check', 'checks'),
  T('dinero', null, 'm', 'money', 'money'),
  T('dólar', 'dólares', 'm', 'dollar', 'dollars'),
  T('peso', 'pesos', 'm', 'peso', 'pesos'),
  T('tienda', 'tiendas', 'f', 'store', 'stores'),
  T('mercado', 'mercados', 'm', 'market', 'markets'),
  T('hambre', null, 'f', 'hunger', 'hunger', { elArticle: true }),
  T('sed', null, 'f', 'thirst', 'thirst'),
  // core cognates
  T('música', null, 'f', 'music', 'music'),
  T('foto', 'fotos', 'f', 'photo', 'photos'),
  T('animal', 'animales', 'm', 'animal', 'animals'),
  T('televisión', null, 'f', 'TV', 'TV'),
  T('español', null, 'm', 'Spanish', 'Spanish'),
  T('inglés', null, 'm', 'English', 'English'),
  T('idea', 'ideas', 'f', 'idea', 'ideas'),
  T('problema', 'problemas', 'm', 'problem', 'problems'),
];

/** Same person, other word or gender: a complement never names the subject's kin key. */
const KIN: Record<string, string> = {
  chica: 'chico',
  amiga: 'amigo',
  profesora: 'profesor',
  madre: 'padre',
  mamá: 'padre',
  papá: 'padre',
  hermana: 'hermano',
  abuela: 'abuelo',
  tía: 'tío',
  prima: 'primo',
  niña: 'niño',
  hija: 'hijo',
  mesera: 'mesero',
  mujer: 'hombre',
};
for (const n of NOUNS) n.kin = KIN[n.sg] ?? n.sg;

/** A noun's kin key (abuela → abuelo, mamá → padre). */
export function kinKey(n: NounEntry): string {
  return n.kin ?? n.sg;
}

/** Surface form → noun and number. */
export const NOUN_FORMS: Map<string, { noun: NounEntry; number: 'sg' | 'pl' }[]> = (() => {
  const map = new Map<string, { noun: NounEntry; number: 'sg' | 'pl' }[]>();
  const add = (form: string, noun: NounEntry, number: 'sg' | 'pl') => {
    const list = map.get(form) ?? [];
    list.push({ noun, number });
    map.set(form, list);
  };
  for (const n of NOUNS) {
    if (!n.plOnly) add(n.sg, n, 'sg');
    if (n.pl) add(n.pl, n, 'pl');
  }
  return map;
})();

export interface AdjEntry {
  ms: string;
  fs: string;
  mp: string;
  fp: string;
  en: string;
}

const A = (ms: string, en: string): AdjEntry => {
  const stem = ms.slice(0, -1);
  return { ms, fs: `${stem}a`, mp: `${ms}s`, fp: `${stem}as`, en };
};
const I = (sg: string, pl: string, en: string): AdjEntry => ({ ms: sg, fs: sg, mp: pl, fp: pl, en });

/** Adjectives of Units 2-4 (four forms each), for agreement checks and the frames. */
export const ADJECTIVES: AdjEntry[] = [
  A('alto', 'tall'),
  A('bajo', 'short'),
  A('pequeño', 'small'),
  A('viejo', 'old'),
  A('nuevo', 'new'),
  A('bueno', 'good'),
  A('malo', 'bad'),
  A('bonito', 'pretty'),
  A('feo', 'ugly'),
  A('guapo', 'good-looking'),
  A('simpático', 'nice'),
  A('antipático', 'unfriendly'),
  A('tonto', 'silly'),
  A('divertido', 'fun'),
  A('serio', 'serious'),
  A('perezoso', 'lazy'),
  A('rápido', 'fast'),
  A('lento', 'slow'),
  A('favorito', 'favorite'),
  A('rojo', 'red'),
  A('amarillo', 'yellow'),
  A('negro', 'black'),
  A('blanco', 'white'),
  A('anaranjado', 'orange'),
  A('morado', 'purple'),
  A('rosado', 'pink'),
  A('delicioso', 'delicious'),
  A('rico', 'tasty'),
  { ms: 'trabajador', fs: 'trabajadora', mp: 'trabajadores', fp: 'trabajadoras', en: 'hard-working' },
  I('grande', 'grandes', 'big'),
  I('joven', 'jóvenes', 'young'),
  I('inteligente', 'inteligentes', 'smart'),
  I('fuerte', 'fuertes', 'strong'),
  I('azul', 'azules', 'blue'),
  I('verde', 'verdes', 'green'),
  I('café', 'cafés', 'brown'),
  I('marrón', 'marrones', 'brown'),
  I('dulce', 'dulces', 'sweet'),
  I('interesante', 'interesantes', 'interesting'),
  I('importante', 'importantes', 'important'),
  I('fácil', 'fáciles', 'easy'),
  I('difícil', 'difíciles', 'hard'),
];

/** Surface form → adjective, gender (x when the form is the same for both) and number. */
export const ADJ_FORMS: Map<string, { adj: AdjEntry; gender: 'm' | 'f' | 'x'; number: 'sg' | 'pl' }> = (() => {
  const map = new Map<string, { adj: AdjEntry; gender: 'm' | 'f' | 'x'; number: 'sg' | 'pl' }>();
  for (const a of ADJECTIVES) {
    const sgSame = a.ms === a.fs;
    const plSame = a.mp === a.fp;
    map.set(a.ms, { adj: a, gender: sgSame ? 'x' : 'm', number: 'sg' });
    if (!sgSame) map.set(a.fs, { adj: a, gender: 'f', number: 'sg' });
    map.set(a.mp, { adj: a, gender: plSame ? 'x' : 'm', number: 'pl' });
    if (!plSame) map.set(a.fp, { adj: a, gender: 'f', number: 'pl' });
  }
  return map;
})();

/** Neutral first names. No school, town or real-person names. */
export const NAMES: { es: string; g: 'm' | 'f' }[] = [
  { es: 'Ana', g: 'f' },
  { es: 'Luis', g: 'm' },
  { es: 'Sofía', g: 'f' },
  { es: 'Mateo', g: 'm' },
  { es: 'Elena', g: 'f' },
  { es: 'Diego', g: 'm' },
  { es: 'Lucía', g: 'f' },
  { es: 'Carlos', g: 'm' },
  { es: 'Valentina', g: 'f' },
  { es: 'Miguel', g: 'm' },
  { es: 'Marta', g: 'f' },
  { es: 'Tomás', g: 'm' },
  { es: 'Rosa', g: 'f' },
  { es: 'Mario', g: 'm' },
  { es: 'Gloria', g: 'f' },
  { es: 'Óscar', g: 'm' },
  { es: 'Lola', g: 'f' },
  { es: 'Rubén', g: 'm' },
  { es: 'Marcos', g: 'm' },
];

export const NAME_GENDER: Map<string, 'm' | 'f'> = new Map(NAMES.map((n) => [n.es.toLowerCase(), n.g]));

/** Neutral places (no towns near the school). */
export const CITIES: { es: string; en: string }[] = [
  { es: 'Lima', en: 'Lima' },
  { es: 'Madrid', en: 'Madrid' },
  { es: 'México', en: 'Mexico' },
  { es: 'Texas', en: 'Texas' },
  { es: 'Bogotá', en: 'Bogotá' },
  { es: 'Guatemala', en: 'Guatemala' },
  { es: 'Los Ángeles', en: 'Los Angeles' },
];

/**
 * The core list: words any deck may use besides its cards (about 250 with
 * the numbers, days, names and places). Function words, subject and
 * prepositional pronouns, numbers 0-31, days, greetings, a few classroom
 * cognates (música, foto, animal, televisión, español, inglés) and the
 * neutral places and names. Lowercase.
 */
export const CORE_WORDS: string[] = [
  // articles, determiners, quantifiers
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del', 'lo',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'otro', 'otra', 'otros', 'otras', 'todo', 'toda', 'todos', 'todas',
  'mucho', 'mucha', 'muchos', 'muchas', 'poco', 'poca', 'pocos', 'pocas', 'muy', 'más', 'menos',
  // pronouns
  'yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'vos',
  'ellos', 'ellas', 'ustedes', 'mí', 'ti', 'me', 'te', 'se', 'nos', 'os', 'le', 'les',
  // prepositions, conjunctions, adverbs
  'a', 'de', 'en', 'con', 'sin', 'por', 'para', 'y', 'e', 'o', 'pero', 'que', 'porque', 'no', 'sí',
  'también', 'bien', 'mal', 'ya', 'aquí', 'allí',
  // questions and courtesy
  'qué', 'quién', 'quiénes', 'cómo', 'dónde', 'cuándo', 'cuánto', 'cuánta', 'cuántos', 'cuántas', 'cuál',
  'hola', 'adiós', 'gracias', 'favor',
  // numbers 0-31
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta',
  // days
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  // classroom cognates
  'clase', 'familia', 'persona', 'color', 'música', 'foto', 'animal', 'televisión', 'español', 'inglés',
  'idea', 'problema', 'favorito', 'importante', 'interesante', 'fácil', 'difícil',
  // places
  'lima', 'madrid', 'méxico', 'texas', 'bogotá', 'guatemala', 'ángeles',
  // names
  ...NAMES.map((n) => n.es.toLowerCase()),
];

/** Number words 0-31 with their English and value. */
export const NUMBERS: { es: string; en: string; n: number }[] = [
  'cero zero', 'uno one', 'dos two', 'tres three', 'cuatro four', 'cinco five', 'seis six', 'siete seven',
  'ocho eight', 'nueve nine', 'diez ten', 'once eleven', 'doce twelve', 'trece thirteen', 'catorce fourteen',
  'quince fifteen', 'dieciséis sixteen', 'diecisiete seventeen', 'dieciocho eighteen', 'diecinueve nineteen',
  'veinte twenty', 'veintiuno twenty-one', 'veintidós twenty-two', 'veintitrés twenty-three',
  'veinticuatro twenty-four', 'veinticinco twenty-five', 'veintiséis twenty-six', 'veintisiete twenty-seven',
  'veintiocho twenty-eight', 'veintinueve twenty-nine', 'treinta thirty',
].map((s, n) => {
  const [es, en] = s.split(' ');
  return { es, en, n };
});

export const NUMBER_WORDS: Set<string> = new Set(NUMBERS.map((n) => n.es));

/**
 * Words that are never read as a conjugated verb even though the engine's
 * reverse index knows a verb form spelled the same (para / parar, cuenta /
 * contar, desayuno / desayunar, Lucía / lucir).
 */
export const NON_VERBS: Set<string> = (() => {
  const set = new Set<string>(CORE_WORDS);
  for (const n of NOUNS) {
    set.add(n.sg);
    if (n.pl) set.add(n.pl);
  }
  for (const a of ADJECTIVES) for (const f of [a.ms, a.fs, a.mp, a.fp]) set.add(f);
  for (const w of ['para', 'tarde', 'temprano', 'mañana', 'noche', 'hoy', 'ayer', 'ahora', 'siempre', 'nunca', 'veces', 'bajo', 'entre', 'sobre']) {
    set.add(w);
  }
  return set;
})();
