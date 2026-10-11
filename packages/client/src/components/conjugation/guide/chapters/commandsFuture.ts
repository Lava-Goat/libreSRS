// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The guide's chapters on commands (imperativo afirmativo / negativo), the
 * future and the conditional. Every form here was checked against the
 * conjugation engine: a form it does not give is one the quiz marks wrong.
 */
import type { Chapter, L } from '../types';

const IN_THIS_DECK: L = { en: 'In this deck:', es: 'En este mazo:' };
const IN_THIS_DECK_DO: L = { en: 'In this deck, “do it” commands:', es: 'En este mazo, mandatos afirmativos:' };
const IN_THIS_DECK_DONT: L = { en: 'In this deck, “don’t” commands:', es: 'En este mazo, mandatos negativos:' };
const IN_THIS_DECK_IRREGULAR: L = { en: 'In this deck, verbs with irregular commands:', es: 'En este mazo, verbos con mandatos irregulares:' };

/**
 * The verbs with a short tú command (di, haz, ve, pon, sal, sé, ten, ven) and
 * common verbs built on them. The engine's 'irregular' tag is wider (esté,
 * conozca, dé), so the section on the eight is gated on the verbs themselves.
 */
const SHORT_TU_VERBS = [
  'decir', 'hacer', 'ir', 'poner', 'salir', 'ser', 'tener', 'venir',
  'irse', 'ponerse', 'hacerse', 'salirse', 'venirse', 'deshacer', 'deshacerse', 'rehacer', 'sobresalir',
  'mantener', 'mantenerse', 'obtener', 'detener', 'detenerse', 'contener', 'entretener', 'entretenerse', 'sostener', 'retener', 'abstenerse',
  'prevenir', 'convenir', 'intervenir',
  'suponer', 'componer', 'proponer', 'proponerse', 'disponer', 'exponer', 'imponer', 'oponerse', 'reponer', 'reponerse', 'posponer',
];

const commands: Chapter = {
  id: 'commands',
  title: { en: 'Commands (*imperativo*)', es: 'Los mandatos (imperativo)' },
  summary: {
    en: 'Telling someone to do something, or not to: *habla* “speak”, *no hables* “don’t speak”.',
    es: 'Decirle a alguien que haga algo, o que no lo haga: *habla*, *no hables*.',
  },
  when: { any: [{ tense: 'imperativeAffirmative' }, { tense: 'imperativeNegative' }] },
  sections: [
    {
      id: 'commands-intro',
      title: { en: 'What a command is', es: 'Qué es un mandato' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A command tells someone to do something (*come* “eat”) or not to do it (*no comas* “don’t eat”). The quiz calls the first kind *imperativo afirmativo* and the second *imperativo negativo*.',
            es: 'Un mandato le dice a alguien que haga algo (*come*) o que no lo haga (*no comas*). La práctica llama al primero imperativo afirmativo y al segundo, imperativo negativo.',
          },
        },
        {
          kind: 'p',
          text: {
            en: 'The form depends on who you are talking to. There is no *yo* form: you don’t give yourself commands.',
            es: 'La forma depende de a quién le hablas. No hay forma de yo: nadie se da mandatos a sí mismo.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*tú*: a friend, a brother or sister, someone your age.', es: 'tú: un amigo, tu hermano o hermana, alguien de tu edad.' },
            { en: '*usted*: an adult you are polite to, like a teacher.', es: 'usted: un adulto al que le hablas con respeto, como un profesor.' },
            { en: '*ustedes*: two or more people.', es: 'ustedes: dos personas o más.' },
            { en: '*nosotros*: you and others together, like “let’s …” in English.', es: 'nosotros: tú y otras personas juntas, para proponer algo (*hablemos*).' },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'The quiz names each verb by its dictionary form (infinitive), like *hablar*, and in commands writes just *usted* and *ustedes*, not *él / ella / usted* or *ellos / ellas / ustedes*.',
            es: 'La práctica nombra cada verbo por su forma de diccionario (infinitivo), como hablar, y en los mandatos escribe solo usted y ustedes, no él / ella / usted ni ellos / ellas / ustedes.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Habla* más despacio, por favor.', en: 'Speak more slowly, please.', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*No comas* en clase.', en: 'Don’t eat in class.', check: [{ entry: 'comer', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '¡*Vamos* a la playa!', en: 'Let’s go to the beach!', check: [{ entry: 'ir', tense: 'imperativeAffirmative', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Commands have no *yo*. The form depends on who you tell: *tú*, *usted*, *ustedes* or *nosotros* (“let’s”).',
        es: 'Los mandatos no tienen forma de yo. La forma depende de a quién se lo dices: tú, usted, ustedes o nosotros.',
      },
    },
    {
      id: 'commands-tu',
      title: { en: '*Tú* commands: the *él* form', es: 'Mandatos con tú: la forma de él' },
      when: { tense: 'imperativeAffirmative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'To tell a friend to do something, use the present-tense *él* form: *habla* “speak”, *come* “eat”, *escribe* “write”. Yes, *habla* also means “he speaks”. The situation tells you which one it is.',
            es: 'Para decirle a un amigo que haga algo, usa la forma de él del presente: *habla*, *come*, *escribe*. Sí, *habla* también quiere decir “él habla”. La situación te dice cuál es.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Escribe* tu nombre aquí.', en: 'Write your name here.', check: [{ entry: 'escribir', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Mira* este video.', en: 'Watch this video.', check: [{ entry: 'mirar', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Abre* la ventana, por favor.', en: 'Open the window, please.', check: [{ entry: 'abrir', tense: 'imperativeAffirmative', person: 'tu' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Eight common verbs have a short, irregular *tú* command instead: *di*, *haz*, *ve*, *pon*, *sal*, *sé*, *ten*, *ven*.',
            es: 'Ocho verbos comunes tienen, en cambio, un mandato con tú corto e irregular: *di*, *haz*, *ve*, *pon*, *sal*, *sé*, *ten*, *ven*.',
          },
        },
      ],
      keyIdea: {
        en: 'An affirmative *tú* command is the present-tense *él* form: *habla*, *come*, *vive*. Eight short ones (*ten*, *haz*, *ven*…) are the exception.',
        es: 'El mandato afirmativo con tú es la forma de él del presente: *habla*, *come*, *vive*. Ocho mandatos cortos (*ten*, *haz*, *ven*…) son la excepción.',
      },
    },
    {
      id: 'commands-irregular-tu',
      title: { en: 'Eight short *tú* commands', es: 'Ocho mandatos cortos con tú' },
      when: { all: [{ tense: 'imperativeAffirmative' }, { any: SHORT_TU_VERBS.map((verb) => ({ verb })) }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'These eight verbs break the rule. Their *tú* commands are short, so learn them by heart. Verbs built on them do the same: *irse* → *vete*, *ponerse* → *ponte*, *mantener* → *mantén*.',
            es: 'Estos ocho verbos no siguen la regla. Sus mandatos con tú son cortos: apréndelos de memoria. Los verbos que se forman con ellos hacen lo mismo: irse → *vete*, ponerse → *ponte*, mantener → *mantén*.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Dictionary form', es: 'Forma de diccionario' }, { en: '*tú* command', es: 'Mandato con tú' }],
          rows: [
            [{ en: '*decir* “to say, to tell”', es: 'decir' }, { en: '*di*', es: '*di*' }],
            [{ en: '*hacer* “to do, to make”', es: 'hacer' }, { en: '*haz*', es: '*haz*' }],
            [{ en: '*ir* “to go”', es: 'ir' }, { en: '*ve*', es: '*ve*' }],
            [{ en: '*poner* “to put”', es: 'poner' }, { en: '*pon*', es: '*pon*' }],
            [{ en: '*salir* “to leave, to go out”', es: 'salir' }, { en: '*sal*', es: '*sal*' }],
            [{ en: '*ser* “to be”', es: 'ser' }, { en: '*sé*', es: '*sé*' }],
            [{ en: '*tener* “to have”', es: 'tener' }, { en: '*ten*', es: '*ten*' }],
            [{ en: '*venir* “to come”', es: 'venir' }, { en: '*ven*', es: '*ven*' }],
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Memory trick: say them in this order, *ven, di, sal, haz, ten, ve, pon, sé*, and it sounds like “Vin Diesel has ten weapons.”',
            es: 'Truco para recordarlos: dilos en este orden, *ven, di, sal, haz, ten, ve, pon, sé*, y suena como “Vin Diesel has ten weapons” en inglés.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Ven* aquí, por favor.', en: 'Come here, please.', check: [{ entry: 'venir', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Ten* cuidado.', en: 'Be careful.', check: [{ entry: 'tener', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Haz* la tarea.', en: 'Do your homework.', check: [{ entry: 'hacer', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Sé* paciente.', en: 'Be patient.', check: [{ entry: 'ser', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Ve* a tu cuarto.', en: 'Go to your room.', check: [{ entry: 'ir', tense: 'imperativeAffirmative', person: 'tu' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Eight *tú* commands are short and irregular: *di, haz, ve, pon, sal, sé, ten, ven*.',
        es: 'Ocho mandatos con tú son cortos e irregulares: *di, haz, ve, pon, sal, sé, ten, ven*.',
      },
    },
    {
      id: 'commands-formal',
      title: { en: '*Usted*, *ustedes*, *nosotros*: the opposite vowel', es: 'Usted, ustedes, nosotros: la vocal contraria' },
      when: { tense: 'imperativeAffirmative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Commands for *usted*, *ustedes* and *nosotros* use new forms. Make them in three steps:',
            es: 'Los mandatos con usted, ustedes y nosotros usan otras formas. Se hacen en tres pasos:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Start from the present-tense *yo* form: *hablo*, *como*, *tengo*.', es: 'Empieza con la forma de yo del presente: *hablo*, *como*, *tengo*.' },
            { en: 'Drop the *-o*.', es: 'Quita la -o.' },
            { en: 'Add the opposite vowel: *-ar* verbs take *e*, *-er* and *-ir* verbs take *a*. Then the person’s ending: nothing for *usted*, *-n* for *ustedes*, *-mos* for *nosotros*.', es: 'Agrega la vocal contraria: los verbos en -ar llevan e; los verbos en -er y en -ir llevan a. Luego, la terminación de la persona: nada para usted, -n para ustedes, -mos para nosotros.' },
          ],
        },
        {
          kind: 'compare',
          head: [{ en: '*-ar* verbs: *e*', es: 'Verbos en -ar: e' }, { en: '*-er* and *-ir* verbs: *a*', es: 'Verbos en -er y en -ir: a' }],
          rows: [
            [{ en: '*usted*: *hable*', es: 'usted: *hable*' }, { en: '*usted*: *coma*, *viva*', es: 'usted: *coma*, *viva*' }],
            [{ en: '*ustedes*: *hablen*', es: 'ustedes: *hablen*' }, { en: '*ustedes*: *coman*, *vivan*', es: 'ustedes: *coman*, *vivan*' }],
            [{ en: '*nosotros*: *hablemos*', es: 'nosotros: *hablemos*' }, { en: '*nosotros*: *comamos*, *vivamos*', es: 'nosotros: *comamos*, *vivamos*' }],
          ],
        },
        {
          kind: 'list',
          items: [
            { en: 'Starting from *yo* carries an irregular *yo* form along: *tengo* → *tenga*, *hago* → *haga*, *salgo* → *salga*.', es: 'Como empiezas con yo, una forma de yo irregular pasa al mandato: *tengo* → *tenga*, *hago* → *haga*, *salgo* → *salga*.' },
            { en: 'Five verbs don’t end in *-o* in the *yo* form, so learn their commands: *ser* → *sea*, *ir* → *vaya*, *estar* → *esté*, *saber* → *sepa*, *dar* → *dé*. “Let’s go” is *vamos* (*vayamos* also counts).', es: 'Cinco verbos no terminan en -o en la forma de yo; aprende sus mandatos: ser → *sea*, ir → *vaya*, estar → *esté*, saber → *sepa*, dar → *dé*. Con nosotros, ir es *vamos* (*vayamos* también vale).' },
            { en: 'They are also the present subjunctive forms (*presente de subjuntivo*).', es: 'Son también las formas del presente de subjuntivo.' },
          ],
        },
        {
          kind: 'paradigm',
          tense: 'imperativeAffirmative',
          entries: ['hablar', 'comer', 'vivir'],
          caption: {
            en: '“Do it” commands. The *tú* row is the present-tense *él* form; *usted*, *nosotros* and *ustedes* take the opposite vowel.',
            es: 'Mandatos afirmativos. La fila de tú es la forma de él del presente; usted, nosotros y ustedes llevan la vocal contraria.',
          },
        },
        { kind: 'deckVerbs', tense: 'imperativeAffirmative', pattern: 'irregular', withTables: true, text: IN_THIS_DECK_IRREGULAR },
        {
          kind: 'examples',
          items: [
            { es: '*Abran* sus libros, por favor.', en: 'Open your books, please.', check: [{ entry: 'abrir', tense: 'imperativeAffirmative', person: 'ellos' }] },
            { es: '*Escriba* su nombre aquí, por favor.', en: 'Write your name here, please. (to an adult)', check: [{ entry: 'escribir', tense: 'imperativeAffirmative', person: 'el' }] },
            { es: '*Tengan* un buen fin de semana.', en: 'Have a good weekend. (to a group)', check: [{ entry: 'tener', tense: 'imperativeAffirmative', person: 'ellos' }] },
            { es: '*Hablemos* en español.', en: 'Let’s speak in Spanish.', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'For *usted*, *ustedes* and *nosotros*: take the *yo* form, drop the *-o*, and switch vowels: *-ar* → *e* (*hable*), *-er* and *-ir* → *a* (*coma*).',
        es: 'Para usted, ustedes y nosotros: toma la forma de yo, quita la -o y cambia la vocal: -ar → e (*hable*); -er y -ir → a (*coma*).',
      },
    },
    {
      id: 'commands-negative',
      title: { en: 'Don’t: negative commands', es: 'No lo hagas: los mandatos negativos' },
      when: { tense: 'imperativeNegative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'To tell someone not to do something, put *no* before the opposite-vowel form, for every person, *tú* included.',
            es: 'Para decirle a alguien que no haga algo, pon no delante de la forma con la vocal contraria, con todas las personas, también con tú.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'The opposite-vowel form: take the present-tense *yo* form, drop the *-o*, then *-ar* verbs take *e* and *-er* and *-ir* verbs take *a*: *hablo* → *hable*, *como* → *coma*, *tengo* → *tenga*.', es: 'La forma con la vocal contraria: toma la forma de yo del presente y quita la -o; los verbos en -ar llevan e y los verbos en -er y en -ir llevan a: *hablo* → *hable*, *como* → *coma*, *tengo* → *tenga*.' },
            { en: 'Five verbs don’t start from *yo*: *ser* → *no seas*, *ir* → *no vayas*, *estar* → *no estés*, *saber* → *no sepas*, *dar* → *no des*.', es: 'Cinco verbos no parten de yo: ser → *no seas*, ir → *no vayas*, estar → *no estés*, saber → *no sepas*, dar → *no des*.' },
            { en: 'For *tú*, add *-s*: *no hables*, *no comas*, *no tengas*.', es: 'Con tú, agrega -s: *no hables*, *no comas*, *no tengas*.' },
            { en: 'For *ustedes*, add *-n*; for *nosotros*, *-mos*: *no hablen*, *no hablemos*.', es: 'Con ustedes, agrega -n; con nosotros, -mos: *no hablen*, *no hablemos*.' },
          ],
        },
        {
          kind: 'paradigm',
          tense: 'imperativeNegative',
          entries: ['hablar', 'comer', 'vivir'],
          caption: { en: '“Don’t” commands: *no* + the opposite vowel, for every person.', es: 'Mandatos negativos: no + la vocal contraria, con todas las personas.' },
        },
        { kind: 'deckVerbs', tense: 'imperativeNegative', pattern: 'irregular', withTables: true, text: IN_THIS_DECK_IRREGULAR },
        {
          kind: 'examples',
          items: [
            { es: '*No hables* por teléfono en clase.', en: 'Don’t talk on the phone in class.', check: [{ entry: 'hablar', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*No corran* en el pasillo.', en: 'Don’t run in the hallway. (to a group)', check: [{ entry: 'correr', tense: 'imperativeNegative', person: 'ellos' }] },
            { es: '*No tengas* miedo.', en: 'Don’t be afraid.', check: [{ entry: 'tener', tense: 'imperativeNegative', person: 'tu' }] },
            { es: 'Por favor, *no coma* aquí.', en: 'Please don’t eat here. (to an adult)', check: [{ entry: 'comer', tense: 'imperativeNegative', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The *no* is part of the answer. In the quiz a negative command is the whole thing: *no hables*, not just *hables*.',
            es: 'El no es parte de la respuesta. En la práctica, un mandato negativo va completo: *no hables*, no solo “hables”.',
          },
        },
      ],
      keyIdea: {
        en: 'A “don’t” command is *no* + the opposite-vowel form, for everyone: *no hables*, *no coma*, *no vivan*.',
        es: 'Un mandato negativo es no + la forma con la vocal contraria, para todos: *no hables*, *no coma*, *no vivan*.',
      },
    },
    {
      id: 'commands-do-dont',
      title: { en: '*Tú*: “do it” and “don’t” look different', es: 'Con tú: el afirmativo y el negativo son distintos' },
      when: { all: [{ tense: 'imperativeAffirmative' }, { tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'With *tú*, the two kinds of command are built differently: “do it” is the *él* form, “don’t” is *no* + the opposite vowel + *-s*. Don’t mix them up.',
            es: 'Con tú, los dos mandatos se forman de manera distinta: el afirmativo es la forma de él; el negativo es no + la vocal contraria + -s. No los confundas.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Do it', es: 'Afirmativo' }, { en: 'Don’t', es: 'Negativo' }],
          rows: [
            [{ en: '*habla*', es: '*habla*' }, { en: '*no hables*', es: '*no hables*' }],
            [{ en: '*come*', es: '*come*' }, { en: '*no comas*', es: '*no comas*' }],
            [{ en: '*escribe*', es: '*escribe*' }, { en: '*no escribas*', es: '*no escribas*' }],
            [{ en: '*ven*', es: '*ven*' }, { en: '*no vengas*', es: '*no vengas*' }],
            [{ en: '*haz*', es: '*haz*' }, { en: '*no hagas*', es: '*no hagas*' }],
            [{ en: '*ve*', es: '*ve*' }, { en: '*no vayas*', es: '*no vayas*' }],
            [{ en: '*sé*', es: '*sé*' }, { en: '*no seas*', es: '*no seas*' }],
          ],
        },
      ],
      keyIdea: {
        en: 'The *tú* “do it” form looks like *él* (*habla*); the “don’t” form switches vowels and adds *-s* (*no hables*).',
        es: 'El afirmativo con tú se parece a la forma de él (*habla*); el negativo cambia la vocal y agrega -s (*no hables*).',
      },
    },
    {
      id: 'commands-stem',
      title: { en: 'Stem changes carry over', es: 'Los cambios de raíz se mantienen' },
      when: { any: [{ pattern: 'stem', tense: 'imperativeAffirmative' }, { pattern: 'stem', tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A stem-changing verb (boot verb) keeps its change in commands. The *tú* “do it” command comes from *él* (*piensa*), and the opposite-vowel forms come from *yo* (*pienso* → *piense*), so both have it.',
            es: 'Un verbo con cambio de raíz (verbo bota) conserva el cambio en los mandatos. El afirmativo con tú sale de la forma de él (*piensa*) y las formas con la vocal contraria salen de yo (*pienso* → *piense*), así que las dos lo tienen.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Do it (*tú*)', es: 'Afirmativo (tú)' }, { en: 'Don’t (*tú*)', es: 'Negativo (tú)' }],
          rows: [
            [{ en: '*piensa*', es: '*piensa*' }, { en: '*no pienses*', es: '*no pienses*' }],
            [{ en: '*vuelve*', es: '*vuelve*' }, { en: '*no vuelvas*', es: '*no vuelvas*' }],
            [{ en: '*duerme*', es: '*duerme*' }, { en: '*no duermas*', es: '*no duermas*' }],
            [{ en: '*pide*', es: '*pide*' }, { en: '*no pidas*', es: '*no pidas*' }],
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Like in the present, *nosotros* stays outside the boot: *pensemos*, *volvamos*. Only *-ir* verbs change a little there: *durmamos*, *pidamos*.',
            es: 'Como en el presente, nosotros se queda fuera de la bota: *pensemos*, *volvamos*. Solo los verbos en -ir cambian un poco ahí: *durmamos*, *pidamos*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Cierra* la puerta, por favor.', en: 'Close the door, please.', check: [{ entry: 'cerrar', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*No pierdas* tu teléfono.', en: 'Don’t lose your phone.', check: [{ entry: 'perder', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*Vuelvan* pronto.', en: 'Come back soon. (to a group)', check: [{ entry: 'volver', tense: 'imperativeAffirmative', person: 'ellos' }] },
          ],
        },
        { kind: 'deckVerbs', tense: 'imperativeAffirmative', pattern: 'stem', text: IN_THIS_DECK_DO },
        { kind: 'deckVerbs', tense: 'imperativeNegative', pattern: 'stem', text: IN_THIS_DECK_DONT },
      ],
      keyIdea: {
        en: 'Boot verbs keep their stem change in commands: *piensa*, *piensen*, *no pienses*.',
        es: 'Los verbos bota conservan el cambio de raíz en los mandatos: *piensa*, *piensen*, *no pienses*.',
      },
    },
    {
      id: 'commands-spelling',
      title: { en: 'Spelling changes: *busque*, *llegue*, *cruce*', es: 'Cambios de ortografía: *busque*, *llegue*, *cruce*' },
      when: { any: [{ pattern: 'spelling', tense: 'imperativeAffirmative' }, { pattern: 'spelling', tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Verbs ending in *-car*, *-gar* and *-zar* change a letter before the opposite vowel *e*, to keep the sound of the dictionary form (infinitive). It happens in every opposite-vowel command, “don’t” ones included, but not in the *tú* “do it” one: *busca*, *llega*, *cruza*.',
            es: 'Los verbos que terminan en -car, -gar y -zar cambian una letra antes de la vocal contraria e, para conservar el sonido de la forma de diccionario (infinitivo). Pasa en todos los mandatos con la vocal contraria, también en los negativos, pero no en el afirmativo con tú: *busca*, *llega*, *cruza*.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*c* → *qu*: *buscar* → *busque*, *no busques*', es: 'c → qu: buscar → *busque*, *no busques*' },
            { en: '*g* → *gu*: *llegar* → *llegue*, *no llegues*', es: 'g → gu: llegar → *llegue*, *no llegues*' },
            { en: '*z* → *c*: *cruzar* → *cruce*, *no cruces*', es: 'z → c: cruzar → *cruce*, *no cruces*' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Saquen* una hoja de papel.', en: 'Take out a sheet of paper. (to a group)', check: [{ entry: 'sacar', tense: 'imperativeAffirmative', person: 'ellos' }] },
            { es: '¡*No toques* eso!', en: 'Don’t touch that!', check: [{ entry: 'tocar', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*No llegues* tarde.', en: 'Don’t be late.', check: [{ entry: 'llegar', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*Practiquemos* el vocabulario.', en: 'Let’s practice the vocabulary.', check: [{ entry: 'practicar', tense: 'imperativeAffirmative', person: 'nosotros' }] },
          ],
        },
        { kind: 'deckVerbs', tense: 'imperativeAffirmative', pattern: 'spelling', text: IN_THIS_DECK_DO },
        { kind: 'deckVerbs', tense: 'imperativeNegative', pattern: 'spelling', text: IN_THIS_DECK_DONT },
      ],
      keyIdea: {
        en: '*-car* → *-que*, *-gar* → *-gue*, *-zar* → *-ce*: *busque*, *no llegues*, *cruce*.',
        es: '-car → -que, -gar → -gue, -zar → -ce: *busque*, *no llegues*, *cruce*.',
      },
    },
    {
      id: 'commands-pronouns',
      title: { en: 'Commands with *te*, *se*, *nos*', es: 'Mandatos con te, se, nos' },
      when: { kind: 'pronominal' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Verbs with *-se*, like *sentarse* “to sit down”, keep a pronoun in commands, and it matches the person: *te* for *tú*, *se* for *usted* and *ustedes*, *nos* for *nosotros*. Where it goes depends on the command:',
            es: 'Los verbos con -se, como sentarse, llevan un pronombre en los mandatos, y cambia según la persona: te para tú, se para usted y ustedes, nos para nosotros. Dónde va depende del mandato:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Do it: the pronoun is attached to the end: *siéntate*, *siéntese*, *siéntense*.', es: 'Afirmativo: el pronombre va pegado al final: *siéntate*, *siéntese*, *siéntense*.' },
            { en: 'Don’t: the pronoun goes before the verb, right after *no*: *no te sientes*, *no se sienten*.', es: 'Negativo: el pronombre va antes del verbo, justo después de no: *no te sientes*, *no se sienten*.' },
            { en: 'The added accent mark keeps the stress where it was: *sienta* + *te* = *siéntate*.', es: 'El acento escrito mantiene la fuerza de la voz donde estaba: sienta + te = *siéntate*.' },
            { en: 'With *nosotros*, drop the *-s* before *nos*: *sentemos* + *nos* = *sentémonos* “let’s sit down”.', es: 'Con nosotros, se quita la -s antes de nos: sentemos + nos = *sentémonos*.' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Acuéstate* temprano.', en: 'Go to bed early.', check: [{ entry: 'acostarse', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Levántense*, por favor.', en: 'Stand up, please. (to a group)', check: [{ entry: 'levantarse', tense: 'imperativeAffirmative', person: 'ellos' }] },
            { es: '*Lávate* las manos.', en: 'Wash your hands.', check: [{ entry: 'lavarse', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*No te duermas* en clase.', en: 'Don’t fall asleep in class.', check: [{ entry: 'dormirse', tense: 'imperativeNegative', person: 'tu' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Attach the pronoun to a “do it” command (*siéntate*); put it before a “don’t” command (*no te sientes*).',
        es: 'El pronombre va pegado al mandato afirmativo (*siéntate*) y antes del negativo (*no te sientes*).',
      },
    },
    {
      id: 'commands-vos',
      title: { en: '*Vos* commands', es: 'Mandatos con vos' },
      when: { all: [{ vos: true }, { tense: 'imperativeAffirmative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The *vos* “do it” command is easy: take the dictionary form, drop the *-r*, and put an accent on the last vowel: *hablá*, *comé*, *viví*. Stem changes and short forms don’t apply: *pensá*, *tené*, *vení*, *decí*. Watch for:',
            es: 'El mandato afirmativo con vos es fácil: toma la forma de diccionario, quita la -r y ponle acento a la última vocal: *hablá*, *comé*, *viví*. No hay cambios de raíz ni formas cortas: *pensá*, *tené*, *vení*, *decí*. Pero ojo con esto:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*ir* uses *andá* “go” (from *andar*).', es: 'ir usa *andá* (de andar).' },
            { en: '*ser* is *sé*, as with *tú*.', es: 'ser es *sé*, como con tú.' },
            { en: 'One-syllable forms get no accent: *da* “give”, *ve* “see”.', es: 'Las formas de una sílaba no llevan acento: *da* (de dar), *ve* (de ver).' },
            { en: 'With a pronoun, the accent goes away: *sentate*, *levantate*.', es: 'Con un pronombre, el acento desaparece: *sentate*, *levantate*.' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Vení* acá.', en: 'Come here.', check: [{ entry: 'venir', tense: 'imperativeAffirmative', person: 'vos' }] },
            { es: '*Hablá* más fuerte, que no te escucho.', en: 'Speak up, I can’t hear you.', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'vos' }] },
            { es: '*Andá* a tu cuarto.', en: 'Go to your room.', check: [{ entry: 'ir', tense: 'imperativeAffirmative', person: 'vos' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*vos* “do it” commands: drop the *-r* and accent the last vowel: *hablá*, *comé*, *viví*.',
        es: 'Mandatos afirmativos con vos: quita la -r y acentúa la última vocal: *hablá*, *comé*, *viví*.',
      },
    },
    {
      id: 'commands-vos-negative',
      title: { en: '*Vos*: negative commands', es: 'Vos: mandatos negativos' },
      when: { all: [{ vos: true }, { tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The *vos* “don’t” command has two forms. The region your teacher picked decides which one the quiz gives; the other one counts too. The *-és*/*-ás* form keeps the stem as it is: *no pensés*, *no querás*.',
            es: 'El mandato negativo con vos tiene dos formas. La región que eligió tu profesor / profesora decide cuál da la práctica; la otra también cuenta. La forma en -és/-ás no cambia la raíz: *no pensés*, *no querás*.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Río de la Plata', es: 'Río de la Plata' }, { en: 'Central America', es: 'Centroamérica' }],
          rows: [
            [{ en: '*no hables* (also *no hablés*)', es: '*no hables* (también *no hablés*)' }, { en: '*no hablés* (also *no hables*)', es: '*no hablés* (también *no hables*)' }],
            [{ en: '*no comas* (also *no comás*)', es: '*no comas* (también *no comás*)' }, { en: '*no comás* (also *no comas*)', es: '*no comás* (también *no comas*)' }],
            [{ en: '*no pienses* (also *no pensés*)', es: '*no pienses* (también *no pensés*)' }, { en: '*no pensés* (also *no pienses*)', es: '*no pensés* (también *no pienses*)' }],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*No hables* tan rápido.', en: 'Don’t talk so fast.', check: [{ entry: 'hablar', tense: 'imperativeNegative', person: 'vos', vosRegion: 'rioplatense' }] },
            { es: '*No comás* eso.', en: 'Don’t eat that.', check: [{ entry: 'comer', tense: 'imperativeNegative', person: 'vos', vosRegion: 'centroamericano' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'A *vos* “don’t” command is *no hables* or *no hablés*: the region your teacher picked decides which one the quiz gives, and both count.',
        es: 'El negativo con vos es *no hables* o *no hablés*: la región que eligió tu profesor / profesora decide cuál da la práctica, y las dos cuentan.',
      },
    },
    {
      id: 'commands-vosotros',
      title: { en: '*Vosotros* commands', es: 'Mandatos con vosotros' },
      when: { all: [{ vosotros: true }, { tense: 'imperativeAffirmative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In Spain, the *vosotros* “do it” command swaps the final *-r* of the dictionary form for *-d*: *hablad*, *comed*, *vivid*. Even *ir* follows the rule: *id*. With *os*, the *-d* drops: *sentaos*, *levantaos*.',
            es: 'En España, el mandato afirmativo con vosotros cambia la -r final de la forma de diccionario por -d: *hablad*, *comed*, *vivid*. Hasta ir sigue la regla: *id*. Con os, la -d se cae: *sentaos*, *levantaos*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Abrid* los libros.', en: 'Open your books. (to a group, in Spain)', check: [{ entry: 'abrir', tense: 'imperativeAffirmative', person: 'vosotros' }] },
            { es: '*Venid* conmigo.', en: 'Come with me. (to a group, in Spain)', check: [{ entry: 'venir', tense: 'imperativeAffirmative', person: 'vosotros' }] },
            { es: '*Sentaos*, por favor.', en: 'Sit down, please. (to a group, in Spain)', check: [{ entry: 'sentarse', tense: 'imperativeAffirmative', person: 'vosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*vosotros* “do it” commands end in *-d*: *hablad*, *comed*, *vivid*.',
        es: 'Los mandatos afirmativos con vosotros terminan en -d: *hablad*, *comed*, *vivid*.',
      },
    },
    {
      id: 'commands-vosotros-negative',
      title: { en: '*Vosotros*: negative commands', es: 'Vosotros: mandatos negativos' },
      when: { all: [{ vosotros: true }, { tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The *vosotros* “don’t” command uses the opposite vowel like the others: *-ar* verbs end in *-éis*, *-er* and *-ir* verbs in *-áis*: *no habléis*, *no comáis*, *no viváis*.',
            es: 'El mandato negativo con vosotros usa la vocal contraria, como los demás: los verbos en -ar terminan en -éis y los verbos en -er y en -ir, en -áis: *no habléis*, *no comáis*, *no viváis*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*No habléis* durante el examen.', en: 'Don’t talk during the test. (to a group, in Spain)', check: [{ entry: 'hablar', tense: 'imperativeNegative', person: 'vosotros' }] },
            { es: '*No os preocupéis*.', en: 'Don’t worry. (to a group, in Spain)', check: [{ entry: 'preocuparse', tense: 'imperativeNegative', person: 'vosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*vosotros* “don’t” commands: *no* + *-éis* (*-ar* verbs) or *-áis* (*-er* and *-ir* verbs).',
        es: 'Negativos con vosotros: no + -éis (verbos en -ar) o -áis (verbos en -er y en -ir).',
      },
    },
    {
      id: 'commands-accents',
      title: { en: 'Accents in commands', es: 'Los acentos en los mandatos' },
      when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'When you type commands, a few accent marks matter:',
            es: 'Cuando escribes mandatos, algunos acentos importan:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*sé* “be” (from *ser*) has one.', es: '*sé* (de ser) lleva acento.' },
            { en: '*dé* (from *dar*) has one too; without it, it’s the word *de* “of, from”.', es: '*dé* (del verbo dar) también lleva acento; sin él, es la preposición de.' },
            { en: 'Don’t add one where there is none: *hable* is a command, but *hablé* means “I spoke”.', es: 'No agregues acentos que no van: *hable* es un mandato, pero hablé, con acento, es pasado (“yo hablé”).' },
            { en: '*estar* keeps its accent: *esté*, *estén*, *no estés*.', es: 'estar conserva su acento: *esté*, *estén*, *no estés*.' },
            { en: 'A pronoun on the end often adds one, to keep the stress in place: *siéntate*, *levántense*.', es: 'Un pronombre al final muchas veces agrega uno, para que la fuerza de la voz no se mueva: *siéntate*, *levántense*.' },
          ],
        },
      ],
      keyIdea: {
        en: 'An accent can change the word: *hable* (a command) is not *hablé* (“I spoke”).',
        es: 'Un acento puede cambiar la palabra: *hable* (un mandato) no es hablé (pasado).',
      },
    },
  ],
};

const future: Chapter = {
  id: 'future',
  title: { en: 'The future (*futuro*)', es: 'El futuro' },
  summary: { en: 'What will happen: *hablaré* “I will speak”.', es: 'Lo que va a pasar: *hablaré*.' },
  when: { tense: 'future' },
  sections: [
    {
      id: 'future-uses',
      title: { en: 'When to use it', es: 'Cuándo se usa' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The future tells what will happen. It is the Spanish for “will”. Use it for:',
            es: 'El futuro dice lo que va a pasar. Equivale a “will” en inglés. Se usa para:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Predictions and plans: what will happen.', es: 'Predicciones y planes: lo que va a pasar.' },
            { en: 'Promises: what you will do.', es: 'Promesas: lo que vas a hacer.' },
            { en: 'Wondering about right now: *¿Dónde estará?* “Where can it be?” or “I wonder where it is.”', es: 'Suposiciones sobre el presente: ¿Dónde *estará*?' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Mañana *lloverá*.', en: 'It will rain tomorrow.', check: [{ entry: 'llover', tense: 'future', person: 'el' }] },
            { es: 'Te *llamaré* esta noche.', en: 'I’ll call you tonight.', check: [{ entry: 'llamar', tense: 'future', person: 'yo' }] },
            { es: '¿Qué *harás* este fin de semana?', en: 'What will you do this weekend?', check: [{ entry: 'hacer', tense: 'future', person: 'tu' }] },
            { es: '¿Dónde *estará* mi teléfono?', en: 'I wonder where my phone is.', check: [{ entry: 'estar', tense: 'future', person: 'el' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'The future is “will”: *hablaré* “I will speak”. It can also wonder about now: *¿Dónde estará?* “I wonder where it is.”',
        es: 'El futuro dice lo que va a pasar: *hablaré*. También sirve para suponer algo del presente: ¿Dónde *estará*?',
      },
    },
    {
      id: 'future-build',
      title: { en: 'Build it: dictionary form + ending', es: 'Cómo se forma: forma de diccionario + terminación' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Most tenses drop the *-ar*, *-er* or *-ir*. The future doesn’t: keep the whole dictionary form (infinitive) and add the ending. All three families (*-ar*, *-er*, *-ir*) take the same endings: *-é*, *-ás*, *-á*, *-emos*, *-án* (and *-éis* for *vosotros*).',
            es: 'La mayoría de los tiempos verbales quitan la -ar, -er o -ir. El futuro no: deja la forma de diccionario (infinitivo) completa y agrega la terminación. Las tres familias (-ar, -er, -ir) llevan las mismas terminaciones: -é, -ás, -á, -emos, -án (y -éis para vosotros).',
          },
        },
        {
          kind: 'paradigm',
          tense: 'future',
          entries: ['hablar', 'comer', 'vivir'],
          caption: { en: 'The endings are the same in all three columns.', es: 'Las terminaciones son iguales en las tres columnas.' },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Comeremos* pizza el viernes.', en: 'We’ll eat pizza on Friday.', check: [{ entry: 'comer', tense: 'future', person: 'nosotros' }] },
            { es: 'Mis primos *vivirán* con nosotros.', en: 'My cousins will live with us.', check: [{ entry: 'vivir', tense: 'future', person: 'ellos' }] },
            { es: '*Estaré* en casa a las cinco.', en: 'I’ll be home at five.', check: [{ entry: 'estar', tense: 'future', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Every ending has an accent mark except the *nosotros* one: *hablaré*, *hablarás*, *hablará*, *hablaremos*, *hablarán*.',
            es: 'Todas las terminaciones llevan acento menos la de nosotros: *hablaré*, *hablarás*, *hablará*, *hablaremos*, *hablarán*.',
          },
        },
      ],
      keyIdea: {
        en: 'Future = the whole dictionary form + *-é, -ás, -á, -emos, -án*. The same endings for *-ar*, *-er* and *-ir* verbs.',
        es: 'Futuro = la forma de diccionario completa + -é, -ás, -á, -emos, -án. Las mismas terminaciones para los verbos en -ar, -er e -ir.',
      },
    },
    {
      id: 'future-irregular',
      title: { en: 'Irregular stems', es: 'Raíces irregulares' },
      when: { pattern: 'irregular', tense: 'future' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'About a dozen verbs don’t use the whole dictionary form. They use a special stem (the part before the ending) instead. The endings stay the same. There are three groups:',
            es: 'Unos doce verbos no usan la forma de diccionario completa, sino una raíz especial (la parte antes de la terminación). Las terminaciones no cambian. Hay tres grupos:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Lose the *e*: *poder* → *podr-*, *querer* → *querr-*, *saber* → *sabr-*, *haber* → *habr-*, *caber* → *cabr-*.', es: 'Pierden la e: poder → *podr-*, querer → *querr-*, saber → *sabr-*, haber → *habr-*, caber → *cabr-*.' },
            { en: 'Swap the vowel for a *d*: *tener* → *tendr-*, *poner* → *pondr-*, *salir* → *saldr-*, *venir* → *vendr-*, *valer* → *valdr-*.', es: 'Cambian la vocal por una d: tener → *tendr-*, poner → *pondr-*, salir → *saldr-*, venir → *vendr-*, valer → *valdr-*.' },
            { en: 'Get shorter: *hacer* → *har-*, *decir* → *dir-*.', es: 'Se acortan: hacer → *har-*, decir → *dir-*.' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Tendré* dieciséis años en mayo.', en: 'I’ll be sixteen in May.', check: [{ entry: 'tener', tense: 'future', person: 'yo' }] },
            { es: '*Habrá* una fiesta el sábado.', en: 'There will be a party on Saturday.', check: [{ entry: 'haber-impersonal', tense: 'future', person: 'el' }] },
            { es: '¿Qué *dirá* mi mamá?', en: 'What will my mom say?', check: [{ entry: 'decir', tense: 'future', person: 'el' }] },
            { es: 'No *podremos* ir.', en: 'We won’t be able to go.', check: [{ entry: 'poder', tense: 'future', person: 'nosotros' }] },
          ],
        },
        { kind: 'deckVerbs', tense: 'future', pattern: 'irregular', text: IN_THIS_DECK, withTables: true },
      ],
      keyIdea: {
        en: 'Irregular verbs change only the stem (*tendr-*, *har-*, *dir-*…). The endings are always *-é, -ás, -á, -emos, -án*.',
        es: 'Los verbos irregulares solo cambian la raíz (*tendr-*, *har-*, *dir-*…). Las terminaciones son siempre -é, -ás, -á, -emos, -án.',
      },
    },
    {
      id: 'future-ir-a',
      title: { en: 'The everyday future: *ir a* + dictionary form', es: 'El futuro de todos los días: ir a + forma de diccionario' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In conversation, people usually say *ir a* + dictionary form: *voy a estudiar* “I’m going to study”. It means about the same as the future.',
            es: 'Al conversar, la gente suele decir ir a + forma de diccionario: *voy a estudiar*. Quiere decir más o menos lo mismo que el futuro.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: '*ir a* + dictionary form', es: 'ir a + forma de diccionario' }, { en: 'Future', es: 'Futuro' }],
          rows: [
            [{ en: '*voy a comer* “I’m going to eat”', es: '*voy a comer*' }, { en: '*comeré* “I will eat”', es: '*comeré*' }],
            [{ en: '*vamos a salir* “we’re going to go out”', es: '*vamos a salir*' }, { en: '*saldremos* “we will go out”', es: '*saldremos*' }],
            [{ en: '*va a llover* “it’s going to rain”', es: '*va a llover*' }, { en: '*lloverá* “it will rain”', es: '*lloverá*' }],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Voy* a estudiar esta noche.', en: 'I’m going to study tonight.', check: [{ entry: 'ir', tense: 'present', person: 'yo' }] },
            { es: '*Estudiaré* esta noche.', en: 'I will study tonight.', check: [{ entry: 'estudiar', tense: 'future', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The quiz asks for the one-word future, so learn both: *voy a comer* and *comeré*.',
            es: 'La práctica pide el futuro de una sola palabra, así que aprende los dos: *voy a comer* y *comeré*.',
          },
        },
      ],
      keyIdea: {
        en: '*voy a* + dictionary form is the everyday way to talk about the future; the quiz asks for the one-word form: *comeré*.',
        es: 'Voy a + forma de diccionario es la forma más común de hablar del futuro; la práctica pide la forma de una sola palabra: *comeré*.',
      },
    },
  ],
};

const conditional: Chapter = {
  id: 'conditional',
  title: { en: 'The conditional (*condicional*)', es: 'El condicional' },
  summary: { en: 'What would happen: *me gustaría* “I would like”.', es: 'Lo que pasaría: *me gustaría*.' },
  when: { tense: 'conditional' },
  sections: [
    {
      id: 'conditional-uses',
      title: { en: 'When to use it', es: 'Cuándo se usa' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The conditional is the Spanish for “would”. Use it for:',
            es: 'El condicional equivale a “would” en inglés. Se usa para:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Polite requests and wishes: *me gustaría…* “I would like…”, *¿podrías…?* “could you…?”', es: 'Pedidos amables y deseos: *me gustaría…*, *¿podrías…?*' },
            { en: 'What would happen if things were different: *yo iría, pero…* “I would go, but…”', es: 'Lo que pasaría si las cosas fueran distintas: *yo iría, pero…*' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me gustaría* ir a México.', en: 'I would like to go to Mexico.', check: [{ entry: 'gustarle', tense: 'conditional', person: 'yo', number: 'sg' }] },
            { es: '¿*Podrías* ayudarme?', en: 'Could you help me?', check: [{ entry: 'poder', tense: 'conditional', person: 'tu' }] },
            { es: 'Yo *iría*, pero tengo que trabajar.', en: 'I would go, but I have to work.', check: [{ entry: 'ir', tense: 'conditional', person: 'yo' }] },
            { es: '¿Qué *harías* con un millón de dólares?', en: 'What would you do with a million dollars?', check: [{ entry: 'hacer', tense: 'conditional', person: 'tu' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'The conditional is “would”: *me gustaría* “I would like”, *iría* “I would go”.',
        es: 'El condicional dice lo que pasaría: *me gustaría*, *iría*.',
      },
    },
    {
      id: 'conditional-build',
      title: { en: 'Build it: dictionary form + ending', es: 'Cómo se forma: forma de diccionario + terminación' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Build it like the future: keep the whole dictionary form (infinitive) and add the ending. The same endings go on *-ar*, *-er* and *-ir* verbs: *-ía*, *-ías*, *-ía*, *-íamos*, *-ían* (and *-íais* for *vosotros*).',
            es: 'Se forma como el futuro: deja la forma de diccionario (infinitivo) completa y agrega la terminación. Los verbos en -ar, -er e -ir llevan las mismas terminaciones: -ía, -ías, -ía, -íamos, -ían (y -íais para vosotros).',
          },
        },
        {
          kind: 'paradigm',
          tense: 'conditional',
          entries: ['hablar', 'comer', 'vivir'],
          caption: { en: 'Every ending starts with an accented *í*.', es: 'Todas las terminaciones empiezan con í con acento.' },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Comería* tacos todos los días.', en: 'I would eat tacos every day.', check: [{ entry: 'comer', tense: 'conditional', person: 'yo' }] },
            { es: 'Nosotros *viviríamos* cerca de la playa.', en: 'We would live near the beach.', check: [{ entry: 'vivir', tense: 'conditional', person: 'nosotros' }] },
            { es: 'Mis padres *estarían* felices.', en: 'My parents would be happy.', check: [{ entry: 'estar', tense: 'conditional', person: 'ellos' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The *yo* and *él* forms are the same: *hablaría* is “I would speak” or “he would speak”. Add *yo* or *él* when it isn’t clear.',
            es: 'Las formas de yo y de él son iguales: *hablaría* puede ser “yo” o “él”. Agrega yo o él cuando no quede claro.',
          },
        },
      ],
      keyIdea: {
        en: 'Conditional = the whole dictionary form + *-ía, -ías, -ía, -íamos, -ían*.',
        es: 'Condicional = la forma de diccionario completa + -ía, -ías, -ía, -íamos, -ían.',
      },
    },
    {
      id: 'conditional-irregular',
      title: { en: 'Irregular stems: the same as the future', es: 'Raíces irregulares: las mismas del futuro' },
      when: { pattern: 'irregular', tense: 'conditional' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A few verbs change their stem (the part before the ending). They are the same verbs, with the same stems, that the future uses. The endings don’t change:',
            es: 'Algunos verbos cambian la raíz (la parte antes de la terminación). Son los mismos verbos, con las mismas raíces, que usa el futuro. Las terminaciones no cambian:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'Lose the *e*: *poder* → *podría*, *querer* → *querría*, *saber* → *sabría*, *haber* → *habría*, *caber* → *cabría*.', es: 'Pierden la e: poder → *podría*, querer → *querría*, saber → *sabría*, haber → *habría*, caber → *cabría*.' },
            { en: 'Swap the vowel for a *d*: *tener* → *tendría*, *poner* → *pondría*, *salir* → *saldría*, *venir* → *vendría*, *valer* → *valdría*.', es: 'Cambian la vocal por una d: tener → *tendría*, poner → *pondría*, salir → *saldría*, venir → *vendría*, valer → *valdría*.' },
            { en: 'Get shorter: *hacer* → *haría*, *decir* → *diría*.', es: 'Se acortan: hacer → *haría*, decir → *diría*.' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Yo no *diría* eso.', en: 'I wouldn’t say that.', check: [{ entry: 'decir', tense: 'conditional', person: 'yo' }] },
            { es: '¿*Querrías* venir conmigo?', en: 'Would you like to come with me?', check: [{ entry: 'querer', tense: 'conditional', person: 'tu' }] },
            { es: 'Con una casa más grande, *tendríamos* un perro.', en: 'With a bigger house, we would have a dog.', check: [{ entry: 'tener', tense: 'conditional', person: 'nosotros' }] },
            { es: 'Sin tarea, *habría* más tiempo para jugar.', en: 'Without homework, there would be more time to play.', check: [{ entry: 'haber-impersonal', tense: 'conditional', person: 'el' }] },
          ],
        },
        { kind: 'deckVerbs', tense: 'conditional', pattern: 'irregular', text: IN_THIS_DECK, withTables: true },
      ],
      keyIdea: {
        en: 'Irregular stems are the future’s (*tendr-*, *podr-*, *har-*, *dir-*…), with the endings *-ía, -ías, -ía, -íamos, -ían*.',
        es: 'Las raíces irregulares son las del futuro (*tendr-*, *podr-*, *har-*, *dir-*…), con las terminaciones -ía, -ías, -ía, -íamos, -ían.',
      },
    },
    {
      id: 'conditional-used-to',
      title: { en: 'Careful: “would” that means “used to”', es: 'Cuidado: “would” cuando quiere decir “used to”' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'English also uses “would” for things that happened again and again in the past: “When I was little, I would play outside every day.” That “would” means “used to”, and Spanish uses the imperfect (*imperfecto*), a past tense for what used to happen, not the conditional.',
            es: 'En inglés, “would” también sirve para cosas que pasaban una y otra vez en el pasado: “When I was little, I would play outside every day”. Ese “would” quiere decir “used to”, y en español se dice con el imperfecto, un tiempo pasado para lo que solía pasar, no con el condicional.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: '“would” = “used to”: imperfect', es: '“would” = “used to”: imperfecto' }, { en: '“would” = if things were different: conditional', es: '“would” = si las cosas fueran distintas: condicional' }],
          rows: [
            [{ en: '*jugaba* “I used to play”', es: '*jugaba*' }, { en: '*jugaría* “I would play”', es: '*jugaría*' }],
            [{ en: '*comía* “I used to eat”', es: '*comía*' }, { en: '*comería* “I would eat”', es: '*comería*' }],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'De niño, *jugaba* afuera todos los días.', en: 'As a kid, I would play outside every day.', check: [{ entry: 'jugar', tense: 'imperfect', person: 'yo' }] },
            { es: 'Con más tiempo, *jugaría* afuera todo el día.', en: 'With more time, I would play outside all day.', check: [{ entry: 'jugar', tense: 'conditional', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The conditional endings look like the imperfect of *-er* and *-ir* verbs, but they go on the whole dictionary form: *comía* “I used to eat”, *comería* “I would eat”.',
            es: 'Las terminaciones del condicional se parecen al imperfecto de los verbos en -er y en -ir, pero van sobre la forma de diccionario completa: *comía* (pasado), *comería* (condicional).',
          },
        },
      ],
      keyIdea: {
        en: '“Would” = “used to” is the imperfect (*jugaba*). “Would” = if things were different is the conditional (*jugaría*).',
        es: 'Si “would” quiere decir “used to”, es imperfecto (*jugaba*). Si habla de lo que pasaría, es condicional (*jugaría*).',
      },
    },
    {
      id: 'conditional-vs-future',
      title: { en: 'Future or conditional?', es: '¿Futuro o condicional?' },
      when: { all: [{ tense: 'future' }, { tense: 'conditional' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The two are built the same way: the whole dictionary form, with the same irregular stems. Only the endings differ.',
            es: 'Los dos se forman igual: la forma de diccionario completa, con las mismas raíces irregulares. Solo cambian las terminaciones.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Future: “will”', es: 'Futuro' }, { en: 'Conditional: “would”', es: 'Condicional' }],
          rows: [
            [{ en: '*hablaré* “I will speak”', es: '*hablaré*' }, { en: '*hablaría* “I would speak”', es: '*hablaría*' }],
            [{ en: '*tendrás* “you will have”', es: '*tendrás*' }, { en: '*tendrías* “you would have”', es: '*tendrías*' }],
            [{ en: '*-é, -ás, -á, -emos, -án*', es: '-é, -ás, -á, -emos, -án' }, { en: '*-ía, -ías, -ía, -íamos, -ían*', es: '-ía, -ías, -ía, -íamos, -ían' }],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Dice que *vendrá*.', en: 'He says he will come.', check: [{ entry: 'venir', tense: 'future', person: 'el' }] },
            { es: 'Dijo que *vendría*.', en: 'He said he would come.', check: [{ entry: 'venir', tense: 'conditional', person: 'el' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Same base, different endings: *-é* is “will” (*hablaré*), *-ía* is “would” (*hablaría*).',
        es: 'La misma base, otras terminaciones: -é es futuro (*hablaré*); -ía es condicional (*hablaría*).',
      },
    },
  ],
};

const chapters: Chapter[] = [commands, future, conditional];

export default chapters;
