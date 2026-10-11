// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Entry-level helpers: the kind and label of an entry, the cells a drill of
 * it covers, the person label a student sees and, for dative cells, the noun
 * phrase that fixes the number of the thing liked.
 *
 * The same verb can be several entries, keyed to how a deck uses it: gustar
 * (gusto, gustas), gustarse (me gusto, nos gustamos) and gustarle (me gusta,
 * les gustan) are drilled separately, so a deck of "me gusta" never asks for
 * "yo gusto".
 */
import { conjugate, parseEntry } from './conjugate.js';
import { hashString } from './random.js';
import {
  EXPERIENCER_LABELS,
  NUMBER_IDS,
  PERSON_SUBJECTS,
  SHORT_PERSON_LABELS,
  TENSES,
  experiencerSubjects,
  isImperative,
  personLabel,
  type GNumber,
  type Person,
  type Tense,
  type VerbKind,
  type VosRegion,
} from './types.js';

/** One drillable cell of an entry. `number` is set only for dative entries. */
export interface Cell {
  tense: Tense;
  person: Person;
  number?: GNumber;
}

/** How an entry is used (plain when it cannot be parsed). */
export function entryKind(entry: string): VerbKind {
  return parseEntry(entry)?.kind ?? 'plain';
}

/**
 * The name a teacher sees: the id itself (gustar, gustarse, gustarle,
 * llover), except for the -impersonal entries, named with their present form:
 * "haber (hay)", "amanecer (amanece)".
 */
export function entryLabel(entry: string): string {
  const parsed = parseEntry(entry);
  if (!parsed) return entry.trim();
  if (parsed.kind === 'impersonal' && parsed.id.endsWith('-impersonal')) {
    const form = conjugate(parsed.id, 'present', 'el')?.[0];
    return form ? `${parsed.base} (${form})` : parsed.base;
  }
  return parsed.id;
}

/**
 * Every cell of an entry in the given tenses that has an answer, in tense
 * order, then person, then number (sg before pl). vosotros only with
 * opts.vosotros; vos (right after tú) only with opts.vos set to a region — the
 * cell itself carries no region, the caller passes it to conjugate. No yo in
 * commands (conjugate has none). Dative entries give both numbers per person
 * and no commands; impersonal entries one cell per tense (person el).
 */
export function cellsFor(
  entry: string,
  tenses: Tense[],
  opts: { vosotros: boolean; vos?: VosRegion | null },
): Cell[] {
  const parsed = parseEntry(entry);
  if (!parsed) return [];
  const out: Cell[] = [];
  for (const tense of tenses) {
    const def = TENSES.find((t) => t.id === tense);
    if (!def) continue;
    const persons = parsed.kind === 'impersonal' ? (['el'] as Person[]) : def.persons;
    for (const person of persons) {
      if (person === 'vosotros' && !opts.vosotros) continue;
      if (person === 'vos' && !opts.vos) continue;
      if (parsed.kind === 'dative') {
        for (const number of NUMBER_IDS) {
          if (conjugate(parsed.id, tense, person, number)) out.push({ tense, person, number });
        }
      } else if (conjugate(parsed.id, tense, person)) {
        out.push({ tense, person });
      }
    }
  }
  return out;
}

/**
 * The person label of a cell: the experiencer for dative entries ("a mí",
 * "a vos", "a ellos / a ellas / a ustedes"), nothing for impersonal ones, the
 * subject otherwise (vos; usted / ustedes in commands).
 */
export function personLabelFor(entry: string, tense: Tense, person: Person): string {
  const kind = entryKind(entry);
  if (kind === 'dative') return EXPERIENCER_LABELS[person];
  if (kind === 'impersonal') return '';
  return personLabel(tense, person);
}

/**
 * The real subjects a prompt for a cell names, one at a time (v1.24.0): "él",
 * "ella", "usted" for el; "a ellos", "a ellas", "a ustedes" for a dative entry;
 * one for yo, tú and vos; none for an impersonal entry. Commands keep their
 * one label (usted, ustedes, nosotros / nosotras): they already name who.
 */
export function subjectsFor(entry: string, tense: Tense, person: Person): string[] {
  const kind = entryKind(entry);
  if (kind === 'impersonal') return [];
  if (kind === 'dative') return experiencerSubjects(person);
  if (isImperative(tense)) return [personLabel(tense, person)];
  return [...PERSON_SUBJECTS[person]];
}

/**
 * A cell's person as the teacher's views name it, short (v1.24.0):
 * "ellos/ellas/Uds.", "a él/ella/Ud.", "usted" in commands; '' for impersonal.
 */
export function shortPersonLabelFor(entry: string, tense: Tense, person: Person): string {
  const kind = entryKind(entry);
  if (kind === 'impersonal') return '';
  if (kind === 'dative') return person === 'yo' || person === 'tu' ? EXPERIENCER_LABELS[person] : `a ${SHORT_PERSON_LABELS[person]}`;
  if (isImperative(tense) && (person === 'el' || person === 'ellos')) return personLabel(tense, person);
  return SHORT_PERSON_LABELS[person];
}

const GENERIC_CUES: Record<GNumber, string[]> = {
  sg: ['el chocolate', 'la música', 'el fútbol', 'la pizza', 'bailar', 'la clase de español'],
  pl: ['los perros', 'las películas', 'los deportes', 'las fresas', 'los videojuegos', 'los libros'],
};

/** Cues that make sense for a particular verb (me duele la cabeza, me quedan los zapatos). */
const VERB_CUES: Record<string, Record<GNumber, string[]>> = {
  doler: {
    sg: ['la cabeza', 'el estómago', 'la espalda', 'la garganta', 'el brazo'],
    pl: ['los pies', 'las piernas', 'los ojos', 'los dientes', 'las manos'],
  },
  faltar: {
    sg: ['el dinero', 'el tiempo', 'el lápiz', 'la tarea', 'la mochila'],
    pl: ['los libros', 'los cuadernos', 'las llaves', 'los papeles', 'los bolígrafos'],
  },
  quedar: {
    sg: ['la camisa', 'la chaqueta', 'el vestido', 'el sombrero', 'la falda'],
    pl: ['los zapatos', 'los pantalones', 'las botas', 'los jeans', 'las sandalias'],
  },
  parecer: {
    sg: ['la idea', 'el plan', 'la película', 'el libro', 'la clase'],
    pl: ['las ideas', 'los planes', 'las reglas', 'los precios', 'las películas'],
  },
  importar: {
    sg: ['la familia', 'la salud', 'el medio ambiente', 'la escuela', 'el dinero'],
    pl: ['los amigos', 'las notas', 'los animales', 'los estudios', 'las opiniones'],
  },
  interesar: {
    sg: ['la historia', 'el arte', 'la ciencia', 'la política', 'la música'],
    pl: ['los idiomas', 'las ciencias', 'los deportes', 'los museos', 'las noticias'],
  },
  molestar: {
    sg: ['el ruido', 'el tráfico', 'la tarea', 'el calor', 'la música fuerte'],
    pl: ['los mosquitos', 'las moscas', 'los exámenes', 'los ruidos', 'las reglas'],
  },
  preocupar: {
    sg: ['el examen', 'el futuro', 'la salud', 'el dinero', 'la tarea'],
    pl: ['los exámenes', 'las notas', 'los problemas', 'las noticias', 'los precios'],
  },
  aburrir: {
    sg: ['la televisión', 'el golf', 'la clase de historia', 'esperar', 'la tarea'],
    pl: ['los documentales', 'las noticias', 'los museos', 'las telenovelas', 'los discursos'],
  },
  tocar: {
    sg: ['la lotería', 'el premio', 'lavar los platos', 'sacar la basura', 'el turno'],
    pl: ['los platos', 'las preguntas fáciles', 'los premios', 'los quehaceres', 'las tareas'],
  },
  sobrar: {
    sg: ['el dinero', 'la comida', 'el tiempo', 'la pizza', 'el pastel'],
    pl: ['los boletos', 'las galletas', 'los lápices', 'las sillas', 'los minutos'],
  },
  costar: {
    sg: ['la química', 'el cálculo', 'levantarse temprano', 'la gramática', 'estudiar'],
    pl: ['las matemáticas', 'los exámenes', 'los verbos irregulares', 'las ciencias', 'los idiomas'],
  },
  caer: {
    sg: ['el profesor', 'la vecina', 'el nuevo estudiante', 'la directora', 'tu primo'],
    pl: ['los vecinos', 'tus amigos', 'las chicas nuevas', 'los profesores', 'mis primos'],
  },
  pasar: {
    sg: ['algo', 'algo raro', 'lo mismo', 'un accidente', 'eso'],
    pl: ['muchas cosas', 'cosas raras', 'accidentes', 'cosas buenas', 'problemas'],
  },
  asustar: {
    sg: ['la oscuridad', 'el trueno', 'la película de terror', 'el perro del vecino', 'volar'],
    pl: ['las arañas', 'los fantasmas', 'las serpientes', 'los truenos', 'los payasos'],
  },
  convenir: {
    sg: ['el horario', 'el precio', 'la fecha', 'el plan', 'salir temprano'],
    pl: ['los precios', 'las fechas', 'los horarios', 'las ofertas', 'los descuentos'],
  },
  apetecer: {
    sg: ['un helado', 'la pizza', 'un café', 'salir', 'dar un paseo'],
    pl: ['las fresas', 'los tacos', 'las papas fritas', 'los churros', 'las galletas'],
  },
  bastar: {
    sg: ['el dinero', 'el tiempo', 'una hora', 'la comida', 'un día'],
    pl: ['dos horas', 'los libros', 'cinco minutos', 'las sillas', 'diez dólares'],
  },
  sorprender: {
    sg: ['la noticia', 'el resultado', 'la sorpresa', 'el examen', 'el final'],
    pl: ['las noticias', 'los resultados', 'los regalos', 'las notas', 'los precios'],
  },
  fastidiar: {
    sg: ['el ruido', 'el tráfico', 'la tarea', 'esperar', 'el calor'],
    pl: ['los mosquitos', 'las reglas', 'los exámenes', 'los ruidos', 'las moscas'],
  },
};

/**
 * Dative verbs of DATIVE_VERBS whose meaning suits the generic cues (me
 * encanta el chocolate, me fascinan las películas); every other one has its
 * own list in VERB_CUES.
 */
export const GENERIC_CUE_VERBS: readonly string[] = [
  'gustar', 'encantar', 'fascinar', 'disgustar', 'agradar', 'entusiasmar', 'chiflar',
];

/**
 * For a dative cell, a Spanish noun phrase that fixes the number of the thing
 * liked (me gusta ___ el chocolate / me gustan ___ los perros). Verb-specific
 * where the verb needs it (le duele la cabeza, me faltan los libros, te
 * quedan los zapatos), otherwise generic. Deterministic for a seed (default:
 * derived from the entry and the cell). Null for cells of other kinds.
 */
export function cueFor(entry: string, cell: Cell, seed?: number): string | null {
  const parsed = parseEntry(entry);
  if (!parsed || parsed.kind !== 'dative' || isImperative(cell.tense)) return null;
  const number = cell.number ?? 'sg';
  const list = VERB_CUES[parsed.base]?.[number] ?? GENERIC_CUES[number];
  const key = `${parsed.id}|${cell.tense}|${cell.person}|${number}`;
  return list[hashString(seed === undefined ? key : `${key}|${seed}`) % list.length];
}
