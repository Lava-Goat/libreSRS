// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The present tense: when to use it, how regular verbs build it, the boot
 * verbs, irregular yo forms, oír, spelling changes and the verbs to memorize
 * (each shown only when the deck has such a verb), vos and vosotros, and the
 * Spanish 1 verbs that come with a construction of their own (ser and estar,
 * ir a, tener, querer).
 */
import type { Chapter } from '../types';

const chapters: Chapter[] = [
  {
    id: 'present',
    title: { en: 'The present tense (*presente*)', es: 'El presente' },
    summary: {
      en: 'What you do, what’s happening now, and your plans: the tense you’ll use most.',
      es: 'Lo que haces, lo que pasa ahora y tus planes: el tiempo verbal que más vas a usar.',
    },
    when: { tense: 'present' },
    sections: [
      {
        id: 'present-when',
        title: { en: 'When to use it', es: 'Cuándo se usa' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The present tense (*presente*) is the one you’ll use most. Use it for:',
              es: 'El presente es el tiempo verbal que más vas a usar. Sirve para:',
            },
          },
          {
            kind: 'list',
            items: [
              { en: 'What you do in general, or as a habit.', es: 'Lo que haces en general o por costumbre.' },
              { en: 'What is happening right now.', es: 'Lo que pasa ahora mismo.' },
              {
                en: 'Plans for soon, with a time word like *mañana* (“tomorrow”).',
                es: 'Planes para pronto, con una expresión de tiempo como mañana.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'One Spanish form does the work of three English ones: *hablo* can mean “I speak”, “I do speak” or “I’m speaking”. And a question needs no extra “do”: *¿Hablas español?* is “Do you speak Spanish?”',
              es: 'Una sola forma en español hace el trabajo de tres en inglés: *hablo* puede ser “I speak”, “I do speak” o “I’m speaking”. Y en una pregunta no hace falta un verbo extra como el “do” del inglés: ¿*Hablas* español? es “Do you speak Spanish?”',
            },
          },
          {
            kind: 'p',
            text: {
              en: 'Words that often come with the present:',
              es: 'Palabras que suelen ir con el presente:',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Habits', es: 'Costumbres' },
              { en: 'Now and soon', es: 'Ahora y pronto' },
            ],
            rows: [
              [
                { en: '*siempre* (“always”)', es: 'siempre' },
                { en: '*ahora* (“now”)', es: 'ahora' },
              ],
              [
                { en: '*todos los días* (“every day”)', es: 'todos los días' },
                { en: '*ahora mismo* (“right now”)', es: 'ahora mismo' },
              ],
              [
                { en: '*los lunes* (“on Mondays”)', es: 'los lunes' },
                { en: '*hoy* (“today”)', es: 'hoy' },
              ],
              [
                { en: '*normalmente* (“usually”)', es: 'normalmente' },
                { en: '*esta noche* (“tonight”)', es: 'esta noche' },
              ],
              [
                { en: '*a veces* (“sometimes”)', es: 'a veces' },
                { en: '*mañana* (“tomorrow”)', es: 'mañana' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Siempre *como* pizza los viernes.',
                en: 'I always eat pizza on Fridays.',
                check: [{ entry: 'comer', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Mi hermano *juega* al fútbol los sábados.',
                en: 'My brother plays soccer on Saturdays.',
                check: [{ entry: 'jugar', tense: 'present', person: 'el' }],
              },
              {
                es: '¿Qué *haces*? — *Escucho* música.',
                en: 'What are you doing? — I’m listening to music.',
                check: [
                  { entry: 'hacer', tense: 'present', person: 'tu' },
                  { entry: 'escuchar', tense: 'present', person: 'yo' },
                ],
              },
              {
                es: '¿*Hablas* español? — Sí, un poco.',
                en: 'Do you speak Spanish? — Yes, a little.',
                check: [{ entry: 'hablar', tense: 'present', person: 'tu' }],
              },
              {
                es: 'Mañana *vamos* a la playa.',
                en: 'Tomorrow we’re going to the beach.',
                check: [{ entry: 'ir', tense: 'present', person: 'nosotros' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Use the present for habits, for what’s happening now and for plans. One form, like *hablo*, means “I speak”, “I do speak” and “I’m speaking”.',
          es: 'Usa el presente para costumbres, para lo que pasa ahora y para planes. Una sola forma, como *hablo*, vale por “I speak”, “I do speak” y “I’m speaking”.',
        },
      },
      {
        id: 'present-build',
        title: { en: 'Building it: regular verbs', es: 'Cómo se forma: los verbos regulares' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Start from the dictionary form (infinitive) and drop the *-ar*, *-er* or *-ir*: what’s left is the stem (*hablar* → *habl-*). Then add the ending for the person: *habl-* + *-o* = *hablo* (“I speak”). A regular verb uses its family’s endings. Here they are, in the order *yo*, *tú*, *él*, *nosotros*, *ellos*:',
              es: 'Toma la forma de diccionario (infinitivo) y quítale la -ar, -er o -ir: lo que queda es la raíz (hablar → *habl-*). Luego agrega la terminación de la persona: *habl-* + *-o* = *hablo*. Un verbo regular usa las terminaciones de su familia. Aquí están, en el orden yo, tú, él, nosotros, ellos:',
            },
          },
          {
            kind: 'list',
            items: [
              { en: '*-ar* verbs: *-o*, *-as*, *-a*, *-amos*, *-an*.', es: 'Verbos en -ar: *-o*, *-as*, *-a*, *-amos*, *-an*.' },
              { en: '*-er* verbs: *-o*, *-es*, *-e*, *-emos*, *-en*.', es: 'Verbos en -er: *-o*, *-es*, *-e*, *-emos*, *-en*.' },
              { en: '*-ir* verbs: *-o*, *-es*, *-e*, *-imos*, *-en*.', es: 'Verbos en -ir: *-o*, *-es*, *-e*, *-imos*, *-en*.' },
            ],
          },
          {
            kind: 'paradigm',
            tense: 'present',
            entries: ['hablar', 'comer', 'vivir'],
            caption: {
              en: 'The three regular patterns. The shaded part is the ending.',
              es: 'Los tres modelos regulares. La parte sombreada es la terminación.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*-ir* differs from *-er* in *nosotros*: *comemos*, but *vivimos* (and in *vosotros*: *coméis*, *vivís*).',
                es: 'Los verbos en -ir se distinguen de los verbos en -er en nosotros: *comemos*, pero *vivimos* (y en vosotros: *coméis*, *vivís*).',
              },
              {
                en: 'The *ellos*/*ellas*/*ustedes* form is the *él* form plus *-n*: *habla* → *hablan*. This works for irregular verbs too (*va* → *van*, *tiene* → *tienen*), except *ser* (*es* → *son*).',
                es: 'La forma de ellos, ellas y ustedes es la de él más una *-n*: *habla* → *hablan*. Vale también para los verbos irregulares (*va* → *van*, *tiene* → *tienen*), menos para ser (*es* → *son*).',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Stem + ending: drop *-ar*, *-er* or *-ir* and add the ending for the person. *-ar* verbs use *a* (*hablas*); *-er* and *-ir* verbs use *e* (*comes*, *vives*).',
          es: 'Raíz + terminación: quita la -ar, -er o -ir y agrega la terminación de la persona. Los verbos en -ar usan la a (*hablas*); los verbos en -er y en -ir usan la e (*comes*, *vives*).',
        },
      },
      {
        id: 'present-regular-deck',
        title: { en: 'Regular verbs in your deck', es: 'Los verbos regulares de tu mazo' },
        when: { pattern: 'regular', tense: 'present' },
        blocks: [
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'regular',
            text: { en: 'Regular in this deck:', es: 'Regulares en este mazo:' },
          },
        ],
      },
      {
        id: 'present-stem',
        title: { en: 'Stem-changing verbs (boot verbs)', es: 'Verbos con cambio de raíz (verbos bota)' },
        when: { pattern: 'stem', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Some verbs change a vowel in their stem (the part before the ending) when that vowel is stressed, that is, said the loudest: *querer* → *quiero*. The ending stays regular. The four common kinds: *e* → *ie* (*quiero*), *o* → *ue* (*puedo*), *u* → *ue* (*juego*) and *e* → *i* (*pido*).',
              es: 'Algunos verbos cambian una vocal de su raíz (la parte que va antes de la terminación) cuando esa vocal es tónica, es decir, cuando es la que suena más fuerte: querer → *quiero*. La terminación sigue siendo regular. Los cuatro tipos más comunes: e → ie (*quiero*), o → ue (*puedo*), u → ue (*juego*) y e → i (*pido*).',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'In *yo*, *tú*, *él* and *ellos* (inside the boot), the stem changes: *quiero*, *quieres*, *quiere*, *quieren*.',
                es: 'En yo, tú, él y ellos (dentro de la bota), la raíz cambia: *quiero*, *quieres*, *quiere*, *quieren*.',
              },
              {
                en: 'In *nosotros* and *vosotros* (outside the boot), it doesn’t: *queremos*, *queréis*. There the stress moves to the ending (*que-RE-mos*).',
                es: 'En nosotros y vosotros (fuera de la bota), no cambia: *queremos*, *queréis*. Ahí la fuerza de la voz pasa a la terminación (que-RE-mos).',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'Why “boot”? Write the forms in two columns: *yo*, *tú*, *él* on the left, *nosotros*, *vosotros*, *ellos* on the right. Circle the forms that change: the whole left column plus *ellos* at the bottom. The outline looks like a boot.',
              es: '¿Por qué “bota”? Escribe las formas en dos columnas: yo, tú, él a la izquierda y nosotros, vosotros, ellos a la derecha. Encierra las formas que cambian: toda la columna izquierda más ellos, abajo. El contorno parece una bota.',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'stem',
            text: { en: 'Boot verbs in this deck:', es: 'Verbos bota en este mazo:' },
          },
        ],
        keyIdea: {
          en: 'Boot verbs change their stem vowel only inside the boot: the *yo*, *tú*, *él* and *ellos* forms. The endings stay regular.',
          es: 'Los verbos bota cambian la vocal de la raíz solo dentro de la bota: en las formas de yo, tú, él y ellos. Las terminaciones siguen siendo regulares.',
        },
      },
      {
        id: 'present-stem-e-ie',
        title: { en: '*e* → *ie*: *quiero*, *pienso*, *prefiero*', es: 'e → ie: quiero, pienso, prefiero' },
        when: { pattern: 'stem:e>ie', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The stressed *e* becomes *ie*: *querer* → *quiero*, *pensar* → *pienso*, *preferir* → *prefiero*. Others you’ll meet: *empezar* (*empiezo*), *entender* (*entiendo*), *cerrar* (*cierro*).',
              es: 'La e tónica se vuelve ie: querer → *quiero*, pensar → *pienso*, preferir → *prefiero*. Otros que vas a ver: empezar (*empiezo*), entender (*entiendo*), cerrar (*cierro*).',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'stem:e>ie',
            withTables: true,
            text: { en: 'In this deck:', es: 'En este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Nosotros *queremos* pizza, pero mi hermana *quiere* tacos.',
                en: 'We want pizza, but my sister wants tacos.',
                check: [
                  { entry: 'querer', tense: 'present', person: 'nosotros' },
                  { entry: 'querer', tense: 'present', person: 'el' },
                ],
              },
              {
                es: '¿Qué *piensas*?',
                en: 'What do you think?',
                check: [{ entry: 'pensar', tense: 'present', person: 'tu' }],
              },
              {
                es: '*Prefiero* el azul.',
                en: 'I prefer the blue one.',
                check: [{ entry: 'preferir', tense: 'present', person: 'yo' }],
              },
              {
                es: 'La clase *empieza* a las ocho.',
                en: 'Class starts at eight.',
                check: [{ entry: 'empezar', tense: 'present', person: 'el' }],
              },
              {
                es: '¿*Entiendes*? — Sí, *entiendo*.',
                en: 'Do you understand? — Yes, I understand.',
                check: [
                  { entry: 'entender', tense: 'present', person: 'tu' },
                  { entry: 'entender', tense: 'present', person: 'yo' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'present-stem-o-ue',
        title: { en: '*o* → *ue*: *puedo*, *duermo*, *vuelvo*', es: 'o → ue: puedo, duermo, vuelvo' },
        when: { pattern: 'stem:o>ue', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The stressed *o* becomes *ue*: *poder* → *puedo*, *dormir* → *duermo*, *volver* → *vuelvo*. Others you’ll meet: *almorzar* (*almuerzo*), *encontrar* (*encuentro*), *costar* (*cuesta*).',
              es: 'La o tónica se vuelve ue: poder → *puedo*, dormir → *duermo*, volver → *vuelvo*. Otros que vas a ver: almorzar (*almuerzo*), encontrar (*encuentro*), costar (*cuesta*).',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'stem:o>ue',
            withTables: true,
            text: { en: 'In this deck:', es: 'En este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'No *puedo* salir hoy.',
                en: 'I can’t go out today.',
                check: [{ entry: 'poder', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Cuántas horas *duermes*?',
                en: 'How many hours do you sleep?',
                check: [{ entry: 'dormir', tense: 'present', person: 'tu' }],
              },
              {
                es: '¿A qué hora *vuelves* a casa?',
                en: 'What time do you get back home?',
                check: [{ entry: 'volver', tense: 'present', person: 'tu' }],
              },
              {
                es: '¿Cuánto *cuesta*?',
                en: 'How much does it cost?',
                check: [{ entry: 'costar', tense: 'present', person: 'el' }],
              },
              {
                es: '*Podemos* ir mañana.',
                en: 'We can go tomorrow.',
                check: [{ entry: 'poder', tense: 'present', person: 'nosotros' }],
              },
            ],
          },
        ],
      },
      {
        id: 'present-stem-u-ue',
        title: { en: '*u* → *ue*: *juego*', es: 'u → ue: juego' },
        when: { pattern: 'stem:u>ue', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Only one verb does this: *jugar* (“to play”). Its *u* becomes *ue*: *juego*, *juegas*, *juega*, *juegan*, but *jugamos*.',
              es: 'Solo un verbo hace esto: jugar. Su u se vuelve ue: *juego*, *juegas*, *juega*, *juegan*, pero *jugamos*.',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'stem:u>ue',
            withTables: true,
            text: { en: 'In this deck:', es: 'En este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Juego* videojuegos con mis amigos.',
                en: 'I play video games with my friends.',
                check: [{ entry: 'jugar', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿*Juegas* al fútbol?',
                en: 'Do you play soccer?',
                check: [{ entry: 'jugar', tense: 'present', person: 'tu' }],
              },
              {
                es: 'Nosotros *jugamos* los domingos.',
                en: 'We play on Sundays.',
                check: [{ entry: 'jugar', tense: 'present', person: 'nosotros' }],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'Don’t let *conjugar* (“to conjugate”) fool you: it isn’t a boot verb. *Yo conjugo.*',
              es: 'Que conjugar no te engañe: no es un verbo bota. Yo *conjugo*.',
            },
          },
        ],
      },
      {
        id: 'present-stem-e-i',
        title: { en: '*e* → *i*: *pido*, *sirvo*, *repito*', es: 'e → i: pido, sirvo, repito' },
        when: { pattern: 'stem:e>i', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Some *-ir* verbs change the stressed *e* to *i*: *pedir* → *pido*, *servir* → *sirvo*, *repetir* → *repito*. Only *-ir* verbs do this. Others you’ll meet: *seguir* (*sigo*), *vestirse* (*me visto*).',
              es: 'Algunos verbos en -ir cambian la e tónica por i: pedir → *pido*, servir → *sirvo*, repetir → *repito*. Solo lo hacen verbos en -ir. Otros que vas a ver: seguir (*sigo*), vestirse (*me visto*).',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'stem:e>i',
            withTables: true,
            text: { en: 'In this deck:', es: 'En este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Siempre *pido* tacos de pollo.',
                en: 'I always order chicken tacos.',
                check: [{ entry: 'pedir', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Me *repites* la pregunta, por favor?',
                en: 'Can you repeat the question for me, please?',
                check: [{ entry: 'repetir', tense: 'present', person: 'tu' }],
              },
              {
                es: 'En mi casa, mi papá *sirve* la cena.',
                en: 'At my house, my dad serves dinner.',
                check: [{ entry: 'servir', tense: 'present', person: 'el' }],
              },
              {
                es: 'Nosotros *pedimos* agua.',
                en: 'We ask for water.',
                check: [{ entry: 'pedir', tense: 'present', person: 'nosotros' }],
              },
            ],
          },
        ],
      },
      {
        id: 'present-yo',
        title: { en: 'Irregular *yo* forms', es: 'Formas de yo irregulares' },
        when: { pattern: 'yo', tense: 'present' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Some verbs are regular except in *yo*. Learn that one form by heart; the other forms follow the pattern, or, in a stem-changing verb (a boot verb) like *tener*, change the stem: *tienes*.',
              es: 'Algunos verbos son regulares menos en yo. Aprende de memoria esa forma; las demás siguen el modelo o, en un verbo con cambio de raíz (verbo bota) como tener, cambian la raíz: *tienes*.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'The *-go* verbs: *tener* → *tengo*, *hacer* → *hago*, *poner* → *pongo*, *salir* → *salgo*, *decir* → *digo*, *venir* → *vengo*, *traer* → *traigo*.',
                es: 'Los verbos en -go: tener → *tengo*, hacer → *hago*, poner → *pongo*, salir → *salgo*, decir → *digo*, venir → *vengo*, traer → *traigo*.',
              },
              {
                en: 'The *-zco* verbs: *conocer* → *conozco*, *conducir* → *conduzco*, *parecer* → *parezco*.',
                es: 'Los verbos en -zco: conocer → *conozco*, conducir → *conduzco*, parecer → *parezco*.',
              },
              {
                en: 'A few more: *ver* → *veo*, *saber* → *sé*, *dar* → *doy*.',
                es: 'Y algunos más: ver → *veo*, saber → *sé*, dar → *doy*.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: '*tener*, *venir* and *decir* also change a vowel in their stem, like the stem-changing verbs (boot verbs), but their *yo* form is its own: *tengo*, *tienes*, *tiene*, *tienen*; *vengo*, *vienes*; *digo*, *dices*.',
              es: 'Tener, venir y decir también cambian una vocal de la raíz, como los verbos con cambio de raíz (verbos bota), pero su forma de yo es aparte: *tengo*, *tienes*, *tiene*, *tienen*; *vengo*, *vienes*; *digo*, *dices*.',
            },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'yo',
            withTables: true,
            text: { en: 'In this deck:', es: 'En este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Tengo* un perro.',
                en: 'I have a dog.',
                check: [{ entry: 'tener', tense: 'present', person: 'yo' }],
              },
              {
                es: '*Hago* la tarea después de clase.',
                en: 'I do my homework after class.',
                check: [{ entry: 'hacer', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Los viernes *salgo* con mis amigos.',
                en: 'On Fridays I go out with my friends.',
                check: [{ entry: 'salir', tense: 'present', person: 'yo' }],
              },
              {
                es: 'No *sé*.',
                en: 'I don’t know.',
                check: [{ entry: 'saber', tense: 'present', person: 'yo' }],
              },
              {
                es: '*Conozco* a tu hermana.',
                en: 'I know your sister.',
                check: [{ entry: 'conocer', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿*Ves* la tele? — Sí, la *veo* todos los días.',
                en: 'Do you watch TV? — Yes, I watch it every day.',
                check: [
                  { entry: 'ver', tense: 'present', person: 'tu' },
                  { entry: 'ver', tense: 'present', person: 'yo' },
                ],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'For these verbs the *yo* form is the odd one out. Learn it by heart (*tengo*, *hago*, *salgo*, *conozco*, *sé*); the other forms follow the pattern, or a stem change (*tienes*).',
          es: 'En estos verbos, la forma de yo es la que no sigue el modelo. Apréndela de memoria (*tengo*, *hago*, *salgo*, *conozco*, *sé*); las demás siguen el modelo, o un cambio de raíz (*tienes*).',
        },
      },
      {
        id: 'present-oir',
        title: { en: '*oír*: *oigo*, *oyes*', es: 'Oír: oigo, oyes' },
        when: { verb: 'oír' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*oír* (“to hear”) has a *yo* form in *-go*, like *traigo*, and a *y* in *tú*, *él* and *ellos*: *oigo*, *oyes*, *oye*, *oímos*, *oyen*.',
              es: 'Oír tiene una forma de yo en -go, como *traigo*, y una y en tú, él y ellos: *oigo*, *oyes*, *oye*, *oímos*, *oyen*.',
            },
          },
          { kind: 'paradigm', tense: 'present', entries: ['oír'] },
          {
            kind: 'examples',
            items: [
              {
                es: '¿*Oyes* la música? — Sí, la *oigo*.',
                en: 'Do you hear the music? — Yes, I hear it.',
                check: [
                  { entry: 'oír', tense: 'present', person: 'tu' },
                  { entry: 'oír', tense: 'present', person: 'yo' },
                ],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*oigo* in *yo*, then a *y* in *oyes*, *oye*, *oyen*. *oímos* keeps its written accent.',
          es: 'Yo *oigo*, y luego una y: *oyes*, *oye*, *oyen*. *oímos* conserva la tilde.',
        },
      },
      {
        id: 'present-spelling',
        title: { en: 'Spelling changes: *escojo*, *esquío*, *construyo*', es: 'Cambios de ortografía: escojo, esquío, construyo' },
        when: {
          any: [
            { pattern: 'spelling', tense: 'present' },
            { pattern: 'accent', tense: 'present' },
            { pattern: 'y', tense: 'present' },
          ],
        },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Some verbs keep the regular endings but change their spelling a little. Three changes happen only in *yo*, to keep the sound of the stem:',
              es: 'Algunos verbos tienen las terminaciones regulares, pero cambian un poco la ortografía. Tres cambios pasan solo en yo, para conservar el sonido de la raíz:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*g* → *j* before *o*: *escoger* → *escojo*, *recoger* → *recojo*, *proteger* → *protejo*.',
                es: 'g → j delante de o: escoger → *escojo*, recoger → *recojo*, proteger → *protejo*.',
              },
              {
                en: '*c* → *z* before *o*: *vencer* → *venzo*.',
                es: 'c → z delante de o: vencer → *venzo*.',
              },
              {
                en: '*gu* → *g* before *o*: *seguir* → *sigo*, *distinguir* → *distingo*.',
                es: 'gu → g delante de o: seguir → *sigo*, distinguir → *distingo*.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'With these three, only *yo* changes: *escoges*, *escoge*, *escogemos* keep the *g*, because *g* before *e* already sounds like *j*.',
              es: 'Con estos tres cambios, solo cambia yo: *escoges*, *escoge*, *escogemos* conservan la g, porque delante de e ya suena como j.',
            },
          },
          {
            kind: 'p',
            text: {
              en: 'Two more change *yo*, *tú*, *él* and *ellos*, the same forms a boot verb changes:',
              es: 'Otros dos cambian yo, tú, él y ellos, las mismas formas que cambia un verbo bota:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'The *i* or *u* of the stem gets a written accent: *esquiar* → *esquío*, *enviar* → *envío*, *continuar* → *continúo*, *graduarse* → *me gradúo*.',
                es: 'La i o la u de la raíz lleva acento escrito: esquiar → *esquío*, enviar → *envío*, continuar → *continúo*, graduarse → *me gradúo*.',
              },
              {
                en: '*-uir* verbs add a *y*: *construir* → *construyo*, *incluir* → *incluyo*, *destruir* → *destruye*. Not *-guir* verbs like *seguir*, where the *u* is silent.',
                es: 'Los verbos en -uir agregan una y: construir → *construyo*, incluir → *incluyo*, destruir → *destruye*. Los verbos en -guir, como seguir, no, porque ahí la u no suena.',
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'spelling',
            withTables: true,
            text: { en: 'With a spelling change in this deck:', es: 'Con cambio de ortografía en este mazo:' },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'accent',
            withTables: true,
            text: { en: 'With a written accent in this deck:', es: 'Con tilde en este mazo:' },
          },
          {
            kind: 'deckVerbs',
            tense: 'present',
            pattern: 'y',
            withTables: true,
            text: { en: 'With an added *y* in this deck:', es: 'Con una y agregada en este mazo:' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Recojo* mi cuarto los sábados.',
                en: 'I clean up my room on Saturdays.',
                check: [{ entry: 'recoger', tense: 'present', person: 'yo' }],
              },
              {
                es: '*Sigo* las instrucciones.',
                en: 'I follow the instructions.',
                check: [{ entry: 'seguir', tense: 'present', person: 'yo' }],
              },
              {
                es: '*Esquío* con mi familia en invierno.',
                en: 'I ski with my family in the winter.',
                check: [{ entry: 'esquiar', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Le *envías* un mensaje a tu mamá?',
                en: 'Are you sending your mom a text?',
                check: [{ entry: 'enviar', tense: 'present', person: 'tu' }],
              },
              {
                es: 'Mis primos *construyen* una casa para su perro.',
                en: 'My cousins are building a house for their dog.',
                check: [{ entry: 'construir', tense: 'present', person: 'ellos' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Same endings, a small change in spelling: *escojo* and *sigo* in *yo* only; an accent (*esquío*) or a *y* (*construyo*) in *yo*, *tú*, *él* and *ellos*.',
          es: 'Las mismas terminaciones, con un pequeño cambio de ortografía: *escojo* y *sigo*, solo en yo; un acento (*esquío*) o una y (*construyo*), en yo, tú, él y ellos.',
        },
      },
      {
        id: 'present-irregular',
        title: { en: 'Verbs to memorize', es: 'Verbos para aprender de memoria' },
        when: { any: [{ verb: 'ser' }, { verb: 'estar' }, { verb: 'ir' }, { verb: 'irse' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Three of the verbs you use most follow no pattern in the present: *ser*, *estar* and *ir*. You just learn them. Say each one in order (*yo*, *tú*, *él*, *nosotros*, *ellos*) until it sounds right:',
              es: 'Tres de los verbos que más usas no siguen ningún modelo en el presente: ser, estar e ir. Hay que aprenderlos de memoria. Repite cada uno en orden (yo, tú, él, nosotros, ellos) hasta que te suene natural:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*ser* (“to be”): *soy*, *eres*, *es*, *somos*, *son*.',
                es: 'Ser: *soy*, *eres*, *es*, *somos*, *son*.',
              },
              {
                en: '*estar* (“to be”): *estoy*, *estás*, *está*, *estamos*, *están*. Watch the accents on *estás*, *está*, *están*.',
                es: 'Estar: *estoy*, *estás*, *está*, *estamos*, *están*. Ojo con los acentos de *estás*, *está*, *están*.',
              },
              {
                en: '*ir* (“to go”): *voy*, *vas*, *va*, *vamos*, *van*. It’s a *v* plus *-ar* endings, with *-oy* for *yo*.',
                es: 'Ir: *voy*, *vas*, *va*, *vamos*, *van*. Es una v más las terminaciones de -ar, con -oy para yo.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'Four *yo* forms end in *-oy*: *soy*, *estoy*, *voy*, *doy*. Learn them as a set.',
              es: 'Cuatro formas de yo terminan en -oy: *soy*, *estoy*, *voy*, *doy*. Apréndelas juntas.',
            },
          },
          {
            kind: 'paradigm',
            tense: 'present',
            entries: ['ser', 'estar', 'ir'],
            caption: {
              en: '*ser*, *estar* and *ir* in the present.',
              es: 'Ser, estar e ir en el presente.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Soy* de California.',
                en: 'I’m from California.',
                check: [{ entry: 'ser', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Cómo *estás*? — *Estoy* bien, gracias.',
                en: 'How are you? — I’m fine, thanks.',
                check: [
                  { entry: 'estar', tense: 'present', person: 'tu' },
                  { entry: 'estar', tense: 'present', person: 'yo' },
                ],
              },
              {
                es: '*Voy* a la escuela en autobús.',
                en: 'I go to school by bus.',
                check: [{ entry: 'ir', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Mis amigos *son* muy simpáticos.',
                en: 'My friends are really nice.',
                check: [{ entry: 'ser', tense: 'present', person: 'ellos' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*ser*, *estar* and *ir* follow no pattern: learn their forms by heart. You use them every day, so they stick fast.',
          es: 'Ser, estar e ir no siguen ningún modelo: aprende sus formas de memoria. Los usas todos los días, así que se te quedan rápido.',
        },
      },
      {
        id: 'present-vos',
        title: { en: '*vos* in the present', es: 'Vos en el presente' },
        when: { vos: true },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'In the present, *vos* has forms of its own. The stress falls on the ending, which gets a written accent: *hablás*, *comés*, *vivís*.',
              es: 'En el presente, vos tiene formas propias. La fuerza de la voz cae en la terminación, que lleva acento escrito: *hablás*, *comés*, *vivís*.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*-er* and *-ir* verbs split in *vos* too: *comés*, but *vivís*.',
                es: 'Los verbos en -er y en -ir también se separan con vos: *comés*, pero *vivís*.',
              },
              {
                en: 'Boot verbs don’t change for *vos*, because the stress isn’t on the stem: *querés*, *podés*, *dormís*.',
                es: 'Los verbos bota no cambian con vos, porque la fuerza no cae en la raíz: *querés*, *podés*, *dormís*.',
              },
              {
                en: 'Irregular *yo* forms don’t matter for *vos*: *tenés*, *hacés*, *salís*, *conocés*.',
                es: 'Las formas de yo irregulares no afectan a vos: *tenés*, *hacés*, *salís*, *conocés*.',
              },
              {
                en: '*ser* gives *sos*. *estar*, *ir* and *ver* are the same as for *tú*: *estás*, *vas*, *ves*.',
                es: 'Ser da *sos*. Estar, ir y ver son iguales que con tú: *estás*, *vas*, *ves*.',
              },
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Vos *sos* mi mejor amigo.',
                en: 'You’re my best friend.',
                check: [{ entry: 'ser', tense: 'present', person: 'vos' }],
              },
              {
                es: '¿*Querés* ir al cine?',
                en: 'Do you want to go to the movies?',
                check: [{ entry: 'querer', tense: 'present', person: 'vos' }],
              },
              {
                es: '¿Qué *hacés* el sábado?',
                en: 'What are you doing on Saturday?',
                check: [{ entry: 'hacer', tense: 'present', person: 'vos' }],
              },
              {
                es: 'Vos *tenés* razón.',
                en: 'You’re right.',
                check: [{ entry: 'tener', tense: 'present', person: 'vos' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*vos* in the present: stress and accent on the ending (*hablás*, *comés*, *vivís*), no boot change (*querés*), and *ser* gives *sos*.',
          es: 'Vos en el presente: fuerza y acento en la terminación (*hablás*, *comés*, *vivís*), sin cambio de raíz (*querés*), y ser da *sos*.',
        },
      },
      {
        id: 'present-vosotros',
        title: { en: '*vosotros* in the present', es: 'Vosotros en el presente' },
        when: { vosotros: true },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*vosotros* (“you all”, used in Spain) has endings with a written accent: *habláis*, *coméis*, *vivís*.',
              es: 'Vosotros (el plural de tú en España) tiene terminaciones con acento escrito: *habláis*, *coméis*, *vivís*.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'Boot verbs don’t change for *vosotros*: *queréis*, *podéis*, *pedís*.',
                es: 'Los verbos bota no cambian con vosotros: *queréis*, *podéis*, *pedís*.',
              },
              {
                en: 'Irregular *yo* forms don’t matter here either: *tenéis*, *hacéis*, *salís*.',
                es: 'Las formas de yo irregulares tampoco afectan aquí: *tenéis*, *hacéis*, *salís*.',
              },
              {
                en: 'The verbs to memorize: *sois* (*ser*), *estáis* (*estar*), *vais* (*ir*). One-syllable forms like *sois*, *vais*, *veis* and *dais* take no accent.',
                es: 'Los verbos para aprender de memoria: *sois* (ser), *estáis* (estar), *vais* (ir). Las formas de una sola sílaba, como *sois*, *vais*, *veis* y *dais*, no llevan acento.',
              },
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: '¿Vosotros *sois* de Madrid?',
                en: 'Are you all from Madrid?',
                check: [{ entry: 'ser', tense: 'present', person: 'vosotros' }],
              },
              {
                es: '¿Qué *queréis* comer?',
                en: 'What do you all want to eat?',
                check: [{ entry: 'querer', tense: 'present', person: 'vosotros' }],
              },
              {
                es: '*Vivís* muy cerca.',
                en: 'You all live really close.',
                check: [{ entry: 'vivir', tense: 'present', person: 'vosotros' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*vosotros* endings are *-áis*, *-éis*, *-ís*, with an accent, and boot verbs don’t change for it (*queréis*).',
          es: 'Las terminaciones de vosotros son *-áis*, *-éis*, *-ís*, con acento, y los verbos bota no cambian con vosotros (*queréis*).',
        },
      },
      {
        id: 'present-ser-estar',
        title: { en: 'Two verbs for “to be”: *ser* and *estar*', es: 'Ser y estar: dos verbos para “to be”' },
        when: { all: [{ verb: 'ser' }, { verb: 'estar' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'English has one verb “to be”. Spanish has two. Ask yourself: am I saying what someone or something is, or where and how it is right now?',
              es: 'En inglés hay un solo verbo “to be”. En español hay dos. Pregúntate: ¿estoy diciendo qué es alguien o algo, o dónde y cómo está ahora?',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: '*ser*', es: 'Ser' },
              { en: '*estar*', es: 'Estar' },
            ],
            rows: [
              [
                { en: 'Who or what someone is: *Soy estudiante* (“I’m a student”).', es: 'Quién o qué es alguien: *Soy* estudiante.' },
                { en: 'Where someone or something is: *Estoy en casa* (“I’m at home”).', es: 'Dónde está alguien o algo: *Estoy* en casa.' },
              ],
              [
                { en: 'Where someone is from: *Es de México* (“She’s from Mexico”).', es: 'De dónde es alguien: *Es* de México.' },
                { en: 'How someone feels: *Estoy cansado* (“I’m tired”).', es: 'Cómo se siente alguien: *Estoy* cansado.' },
              ],
              [
                { en: 'What someone is like: *Eres simpática* (“You’re nice”).', es: 'Cómo es alguien: *Eres* simpática.' },
                { en: 'How something is right now: *La sopa está fría* (“The soup is cold”).', es: 'Cómo está algo ahora: La sopa *está* fría.' },
              ],
              [
                { en: 'The time and the day: *Son las dos* (“It’s two o’clock”). *Hoy es lunes* (“Today is Monday”).', es: 'La hora y el día: *Son* las dos. Hoy *es* lunes.' },
                { en: 'Asking how someone is: *¿Cómo estás?* (“How are you?”)', es: 'Para preguntar cómo está alguien: ¿Cómo *estás*?' },
              ],
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'A rhyme to remember: “How you feel and where you are, that is when you use *estar*.”',
              es: 'Un truco: para cómo te sientes y dónde estás, usa estar.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Soy* de California, pero ahora *estoy* en México.',
                en: 'I’m from California, but right now I’m in Mexico.',
                check: [
                  { entry: 'ser', tense: 'present', person: 'yo' },
                  { entry: 'estar', tense: 'present', person: 'yo' },
                ],
              },
              {
                es: 'Mi hermano *es* alto.',
                en: 'My brother is tall.',
                check: [{ entry: 'ser', tense: 'present', person: 'el' }],
              },
              {
                es: '¿Dónde *está* el baño?',
                en: 'Where is the bathroom?',
                check: [{ entry: 'estar', tense: 'present', person: 'el' }],
              },
              {
                es: 'Hoy *estamos* muy cansados.',
                en: 'Today we’re really tired.',
                check: [{ entry: 'estar', tense: 'present', person: 'nosotros' }],
              },
              {
                es: '¿Qué hora *es*? — *Son* las tres.',
                en: 'What time is it? — It’s three o’clock.',
                check: [
                  { entry: 'ser', tense: 'present', person: 'el' },
                  { entry: 'ser', tense: 'present', person: 'ellos' },
                ],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*ser* is what someone or something is: who, where from, what it’s like, the time. *estar* is where it is and how it is right now.',
          es: 'Ser es lo que alguien o algo es: quién, de dónde, cómo es, la hora. Estar es dónde está y cómo está ahora.',
        },
      },
      {
        id: 'present-ir-a',
        title: { en: 'Going to: *ir a* + dictionary form', es: 'Ir a + forma de diccionario: lo que vas a hacer' },
        when: { verb: 'ir' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'To say what you’re going to do, use *ir* in the present, then *a*, then the dictionary form (infinitive) of the other verb: *Voy a estudiar* (“I’m going to study”). Only *ir* is conjugated; the second verb stays in the dictionary form. It’s the easiest way to talk about the future.',
              es: 'Para decir lo que vas a hacer, usa ir en presente, luego a, y luego la forma de diccionario (infinitivo) del otro verbo: *Voy* a estudiar. Solo se conjuga ir; el segundo verbo se queda en forma de diccionario. Es la manera más fácil de hablar del futuro.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Voy* a estudiar esta noche.',
                en: 'I’m going to study tonight.',
                check: [{ entry: 'ir', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Qué *vas* a hacer el sábado?',
                en: 'What are you going to do on Saturday?',
                check: [{ entry: 'ir', tense: 'present', person: 'tu' }],
              },
              {
                es: 'Mis amigos *van* a jugar al fútbol.',
                en: 'My friends are going to play soccer.',
                check: [{ entry: 'ir', tense: 'present', person: 'ellos' }],
              },
              {
                es: '*Vamos* a comer.',
                en: 'We’re going to eat. (Or: Let’s eat.)',
                check: [{ entry: 'ir', tense: 'present', person: 'nosotros' }],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: '*ir a* + a place is going somewhere: *Voy a la escuela*. *ir a* + a dictionary form is going to do something: *Voy a comer*. And *a* + *el* becomes *al*: *Voy al cine*.',
              es: 'Ir a + un lugar es ir a algún sitio: *Voy* a la escuela. Ir a + forma de diccionario es lo que vas a hacer: *Voy* a comer. Y a + el se convierte en al: *Voy* al cine.',
            },
          },
        ],
        keyIdea: {
          en: '*ir* + *a* + dictionary form = “going to do”: *Voy a estudiar*.',
          es: 'Ir + a + forma de diccionario = lo que vas a hacer: *Voy* a estudiar.',
        },
      },
      {
        id: 'present-tener',
        title: { en: '*tener*: more than “to have”', es: 'Expresiones con tener' },
        when: { verb: 'tener' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*tener* means “to have”. Spanish also uses it where English says “to be” or “have to”:',
              es: 'Tener sirve para mucho más que tener cosas. Fíjate en estas expresiones, que en inglés se dicen con “to be” o “have to”:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*tener … años*: “to be … years old”. *Tengo quince años* (“I’m fifteen”).',
                es: 'Tener … años, para decir la edad: *Tengo* quince años.',
              },
              {
                en: '*tener que* + dictionary form: “to have to” do something. *Tengo que estudiar* (“I have to study”).',
                es: 'Tener que + forma de diccionario, para lo que tienes que hacer: *Tengo* que estudiar.',
              },
              {
                en: '*tener hambre*, *sed*, *frío*, *calor*, *sueño*: “to be hungry, thirsty, cold, hot, sleepy”.',
                es: 'Tener hambre, sed, frío, calor, sueño: cómo te sientes.',
              },
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Tengo* quince años.',
                en: 'I’m fifteen (years old).',
                check: [{ entry: 'tener', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿Cuántos años *tienes*?',
                en: 'How old are you?',
                check: [{ entry: 'tener', tense: 'present', person: 'tu' }],
              },
              {
                es: '*Tenemos* que estudiar para el examen.',
                en: 'We have to study for the test.',
                check: [{ entry: 'tener', tense: 'present', person: 'nosotros' }],
              },
              {
                es: 'Mi hermanita *tiene* hambre.',
                en: 'My little sister is hungry.',
                check: [{ entry: 'tener', tense: 'present', person: 'el' }],
              },
              {
                es: '¿*Tienes* frío?',
                en: 'Are you cold?',
                check: [{ entry: 'tener', tense: 'present', person: 'tu' }],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'Careful: *tener frío* is how you feel (*Tengo frío*, “I’m cold”). For the weather, Spanish uses *hace*: *Hace frío* (“It’s cold out”).',
              es: 'Ojo: tener frío es cómo te sientes tú (*Tengo* frío); para hablar del clima se usa hacer: *Hace* frío.',
            },
          },
        ],
        keyIdea: {
          en: 'Age, hunger, thirst, feeling cold or hot, and “have to” all use *tener*: *Tengo quince años*. *Tengo que estudiar*.',
          es: 'La edad, el hambre, la sed, el frío, el calor y lo que tienes que hacer van con tener: *Tengo* quince años. *Tengo* que estudiar.',
        },
      },
      {
        id: 'present-querer',
        title: { en: '*querer* + dictionary form', es: 'Querer + forma de diccionario' },
        when: { verb: 'querer' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*querer* means “to want”. Follow it with a thing (*Quiero un taco*) or with the dictionary form (infinitive) of another verb to say what you want to do (*Quiero comer*). Only *querer* is conjugated.',
              es: 'Querer va seguido de una cosa (*Quiero* un taco) o de la forma de diccionario (infinitivo) de otro verbo, para decir lo que quieres hacer (*Quiero* comer). Solo se conjuga querer.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Quiero* comer.',
                en: 'I want to eat.',
                check: [{ entry: 'querer', tense: 'present', person: 'yo' }],
              },
              {
                es: '¿*Quieres* ir al cine?',
                en: 'Do you want to go to the movies?',
                check: [{ entry: 'querer', tense: 'present', person: 'tu' }],
              },
              {
                es: 'Mis padres *quieren* un perro.',
                en: 'My parents want a dog.',
                check: [{ entry: 'querer', tense: 'present', person: 'ellos' }],
              },
              {
                es: '¿Qué *quieren* hacer ustedes?',
                en: 'What do you all want to do?',
                check: [{ entry: 'querer', tense: 'present', person: 'ellos' }],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'With a person, *querer* means “to love”: *Te quiero, mamá* (“I love you, Mom”).',
              es: 'Con una persona, querer es sentir cariño: Te *quiero*, mamá.',
            },
          },
        ],
        keyIdea: {
          en: '*querer* + dictionary form = “want to do”: *Quiero comer*.',
          es: 'Querer + forma de diccionario = lo que quieres hacer: *Quiero* comer.',
        },
      },
      {
        id: 'present-accents',
        title: { en: 'Accents in the present', es: 'Los acentos en el presente' },
        blocks: [
          {
            kind: 'tip',
            text: {
              en: 'The present has almost no written accents. The main exceptions: *estar* (*estás*, *está*, *están*), *sé* (“I know”), verbs like *esquiar* and *enviar* (*esquío*, *envío*), and the *vosotros* and *vos* forms if your class uses them. So an accent on the last vowel usually means another tense: *hablo* (“I speak”) is not *habló* (“he spoke”).',
              es: 'El presente casi no lleva acentos escritos. Las excepciones más comunes: estar (*estás*, *está*, *están*), *sé* (de saber), verbos como esquiar y enviar (*esquío*, *envío*) y las formas de vosotros y de vos, si las usan en tu clase. Así que un acento en la última vocal suele indicar otro tiempo verbal: *hablo* no es lo mismo que *habló*.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Yo *hablo* con mi abuela todos los días.',
                en: 'I talk with my grandma every day.',
                check: [{ entry: 'hablar', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Ayer mi mamá *habló* con la profesora.',
                en: 'Yesterday my mom talked with the teacher.',
                check: [{ entry: 'hablar', tense: 'preterite', person: 'el' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*hablo* is “I speak”; *habló* is “he spoke” or “she spoke”. In the present a written accent is rare: learn *estás*, *está*, *están* and *sé*.',
          es: '*hablo* es presente; *habló* es pasado. En el presente casi nunca se escribe acento: apréndete *estás*, *está*, *están* y *sé*.',
        },
      },
    ],
  },
];

export default chapters;
