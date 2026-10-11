// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The present progressive, the preterite and the imperfect: when to use each,
 * how to build it, the spelling, stem and irregular patterns (each shown only
 * when the deck has such a verb in that tense), the accents (with a part on
 * typing them once the student types answers), and, when a deck drills both
 * past tenses, how to choose between them. The -se, gustar-type and impersonal
 * verbs in each tense are taught in their own chapters (verbKinds.ts); these
 * chapters keep only a short reminder where the tense itself asks for one.
 */
import type { Chapter } from '../types';

const chapters: Chapter[] = [
  {
    id: 'presentProgressive',
    title: { en: 'The present progressive (*presente progresivo*)', es: 'El presente progresivo' },
    summary: {
      en: 'What is going on right now: *estar* + the *-ando*/*-iendo* form.',
      es: 'Lo que está pasando ahora mismo: *estar* + el gerundio.',
    },
    when: { tense: 'presentProgressive' },
    sections: [
      {
        id: 'progressive-when',
        title: { en: 'When to use it', es: 'Cuándo se usa' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The present progressive tells what is happening right now, at this very moment. It is the Spanish “am / is / are + -ing”: *estoy comiendo* means “I am eating”.',
              es: 'El presente progresivo dice lo que está pasando ahora mismo, en este preciso momento. Equivale al “am / is / are + -ing” del inglés: *estoy comiendo* es “I am eating”.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '¿Qué *estás haciendo*?',
                en: 'What are you doing?',
                check: [{ entry: 'hacer', tense: 'presentProgressive', person: 'tu' }],
              },
              {
                es: '*Estoy estudiando* para el examen.',
                en: 'I’m studying for the test.',
                check: [{ entry: 'estudiar', tense: 'presentProgressive', person: 'yo' }],
              },
              {
                es: 'Mi hermano *está jugando* videojuegos.',
                en: 'My brother is playing video games.',
                check: [{ entry: 'jugar', tense: 'presentProgressive', person: 'el' }],
              },
              {
                es: '¡Mira! *Está lloviendo*.',
                en: 'Look! It’s raining.',
                check: [{ entry: 'llover', tense: 'presentProgressive', person: 'el' }],
              },
            ],
          },
          {
            kind: 'p',
            text: {
              en: 'Words that often go with it: *ahora* (“now”), *ahora mismo* (“right now”), *en este momento* (“at this moment”).',
              es: 'Palabras que suelen acompañarlo: *ahora*, *ahora mismo*, *en este momento*.',
            },
          },
        ],
        keyIdea: {
          en: 'Use it for what is going on right now, as you speak.',
          es: 'Úsalo para lo que está pasando ahora mismo, mientras hablas.',
        },
      },
      {
        id: 'progressive-less-than-english',
        title: { en: 'Less “-ing” than in English', es: 'Se usa menos que el “-ing” del inglés' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'English uses “-ing” all the time. Spanish saves the progressive for things in progress right now, and even then the simple present often does the job. For plans, Spanish uses the present, not the progressive.',
              es: 'El inglés usa “-ing” todo el tiempo. El español guarda el progresivo para lo que está pasando ahora mismo, y aun así muchas veces basta con el presente. Para los planes se usa el presente, no el progresivo.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'In English', es: 'En inglés' },
              { en: 'In Spanish', es: 'En español' },
            ],
            rows: [
              [
                { en: '“I’m eating.” (right now)', es: '“I’m eating.” (ahora mismo)' },
                { en: '*Estoy comiendo.*', es: '*Estoy comiendo*.' },
              ],
              [
                { en: '“What are you doing?”', es: '“What are you doing?”' },
                { en: '*¿Qué haces?* or *¿Qué estás haciendo?*', es: '¿Qué *haces*? o ¿Qué *estás haciendo*?' },
              ],
              [
                { en: '“I’m going to the movies tomorrow.”', es: '“I’m going to the movies tomorrow.”' },
                { en: '*Mañana voy al cine.* (not *estoy yendo*)', es: 'Mañana *voy* al cine. (no *estoy yendo*)' },
              ],
            ],
          },
        ],
        keyIdea: {
          en: 'When the English “-ing” is about a plan, Spanish uses the simple present: *Mañana voy al cine.*',
          es: 'Cuando el “-ing” del inglés habla de un plan, en español se usa el presente: Mañana *voy* al cine.',
        },
      },
      {
        id: 'progressive-build',
        title: { en: 'How to build it', es: 'Cómo se forma' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'It takes two words: *estar* in the present, then the *-ando*/*-iendo* form (gerund) of the verb. *Estar* is the helping verb: it changes with the person. The *-ando*/*-iendo* form never changes.',
              es: 'Son dos palabras: *estar* en presente y después el gerundio del verbo (la forma en -ando/-iendo). *Estar* es el verbo auxiliar: cambia según la persona. El gerundio nunca cambia.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: '*-ar* verbs: take *-ar* off the dictionary form (infinitive) and add *-ando*: *hablar* → *hablando*.',
                es: 'Verbos en -ar: quita -ar de la forma de diccionario (infinitivo) y agrega -ando: *hablar* → *hablando*.',
              },
              {
                en: '*-er* and *-ir* verbs: take off *-er* or *-ir* and add *-iendo*: *comer* → *comiendo*, *vivir* → *viviendo*.',
                es: 'Verbos en -er y en -ir: quita -er o -ir y agrega -iendo: *comer* → *comiendo*, *vivir* → *viviendo*.',
              },
            ],
          },
          {
            kind: 'paradigm',
            tense: 'presentProgressive',
            entries: ['hablar', 'comer', 'vivir'],
            caption: {
              en: '*Estar* changes with the person; the *-ando*/*-iendo* form stays the same.',
              es: '*Estar* cambia según la persona; el gerundio no cambia.',
            },
          },
          {
            kind: 'tip',
            text: {
              en: 'The quiz wants both words, accent included: *estás hablando*, not *hablando* or *estas hablando*.',
              es: 'La práctica pide las dos palabras, con su tilde: *estás hablando*, no *hablando* ni *estas hablando*.',
            },
          },
          {
            kind: 'p',
            text: {
              en: 'Since *estar* is the helping verb, *estar* itself is not practiced in this tense: Spanish does not say *estoy estando*.',
              es: 'Como *estar* es el verbo auxiliar, *estar* no se practica en este tiempo verbal: en español no se dice *estoy estando*.',
            },
          },
        ],
        keyIdea: {
          en: '*estar* in the present + the *-ando*/*-iendo* form: *estoy hablando*, *estamos comiendo*.',
          es: '*estar* en presente + gerundio: *estoy hablando*, *estamos comiendo*.',
        },
      },
      {
        id: 'progressive-spelling',
        title: { en: '*-iendo* becomes *-yendo*', es: '-iendo se vuelve -yendo' },
        when: { pattern: 'spelling', tense: 'presentProgressive' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'When the stem (the dictionary form minus *-er* or *-ir*) ends in a vowel, *-iendo* is spelled *-yendo*. Spanish does not leave that *i* between two vowels: it turns into a *y*. One exception: *reír* (“to laugh”) and *sonreír* (“to smile”) give *riendo* and *sonriendo*.',
              es: 'Cuando la raíz (la forma de diccionario sin -er o -ir) termina en vocal, -iendo se escribe -yendo. El español no deja esa i entre dos vocales: la cambia por y. Una excepción: *reír* y *sonreír* dan *riendo* y *sonriendo*.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Dictionary form', es: 'Forma de diccionario' },
              { en: '*-ando*/*-iendo* form', es: 'Gerundio' },
            ],
            rows: [
              [{ en: '*leer*', es: '*leer*' }, { en: '*leyendo*', es: '*leyendo*' }],
              [{ en: '*creer*', es: '*creer*' }, { en: '*creyendo*', es: '*creyendo*' }],
              [{ en: '*oír*', es: '*oír*' }, { en: '*oyendo*', es: '*oyendo*' }],
              [{ en: '*traer*', es: '*traer*' }, { en: '*trayendo*', es: '*trayendo*' }],
              [{ en: '*construir*', es: '*construir*' }, { en: '*construyendo*', es: '*construyendo*' }],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Estoy leyendo* un libro muy bueno.',
                en: 'I’m reading a really good book.',
                check: [{ entry: 'leer', tense: 'presentProgressive', person: 'yo' }],
              },
              {
                es: '¿Me *estás oyendo*?',
                en: 'Can you hear me?',
                check: [{ entry: 'oír', tense: 'presentProgressive', person: 'tu' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'presentProgressive',
            pattern: 'spelling',
            text: { en: 'In this deck:', es: 'En este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: 'After a vowel, *-iendo* becomes *-yendo*: *leer* → *leyendo*.',
          es: 'Después de vocal, -iendo se vuelve -yendo: *leer* → *leyendo*.',
        },
      },
      {
        id: 'progressive-stem',
        title: { en: '*-ir* verbs that change their stem', es: 'Verbos en -ir que cambian la raíz' },
        when: { pattern: 'stem', tense: 'presentProgressive' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Stem-changing verbs (boot verbs) that end in *-ir* change here too, but the change is just one vowel: *e* becomes *i*, and *o* becomes *u*. Most *-ar* and *-er* ones keep their stem: *pensando*, *queriendo*, *volviendo*.',
              es: 'Los verbos con cambio de raíz (verbos bota) que terminan en -ir también cambian aquí, pero el cambio es de una sola vocal: la e se vuelve i y la o se vuelve u. Casi todos los de -ar y -er conservan la raíz: *pensando*, *queriendo*, *volviendo*.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: '*e* → *i*', es: 'e → i' },
              { en: '*o* → *u*', es: 'o → u' },
            ],
            rows: [
              [
                { en: '*pedir* → *pidiendo*', es: '*pedir* → *pidiendo*' },
                { en: '*dormir* → *durmiendo*', es: '*dormir* → *durmiendo*' },
              ],
              [
                { en: '*decir* → *diciendo*', es: '*decir* → *diciendo*' },
                { en: '*morir* → *muriendo*', es: '*morir* → *muriendo*' },
              ],
              [
                { en: '*servir* → *sirviendo*', es: '*servir* → *sirviendo*' },
                { en: '*poder* → *pudiendo* (an *-er* verb)', es: '*poder* → *pudiendo* (un verbo en -er)' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Mi perro *está durmiendo* en el sofá.',
                en: 'My dog is sleeping on the couch.',
                check: [{ entry: 'dormir', tense: 'presentProgressive', person: 'el' }],
              },
              {
                es: '¿Qué *estás diciendo*?',
                en: 'What are you saying?',
                check: [{ entry: 'decir', tense: 'presentProgressive', person: 'tu' }],
              },
              {
                es: '*Estamos pidiendo* una pizza.',
                en: 'We’re ordering a pizza.',
                check: [{ entry: 'pedir', tense: 'presentProgressive', person: 'nosotros' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'presentProgressive',
            pattern: 'stem',
            text: { en: 'In this deck:', es: 'En este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: '*-ir* boot verbs change *e* to *i*, or *o* to *u*: *pidiendo*, *durmiendo*.',
          es: 'Los verbos bota en -ir cambian la e por i, o la o por u: *pidiendo*, *durmiendo*.',
        },
      },
      {
        id: 'progressive-ir',
        title: { en: 'An odd one: *ir* → *yendo*', es: 'Un caso raro: ir → yendo' },
        when: {
          any: [
            { verb: 'ir' },
            { verb: 'irse' },
            { pattern: 'irregular', tense: 'presentProgressive' },
          ],
        },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The *-ando*/*-iendo* form of *ir* (“to go”) is *yendo*: *estoy yendo*, *están yendo*. It is real, but you will rarely need it. For “I’m going”, Spanish usually just says *voy*, and for plans, *voy a* + a dictionary form: *Voy a comer.* (“I’m going to eat.”)',
              es: 'El gerundio de *ir* es *yendo*: *estoy yendo*, *están yendo*. Existe, pero casi nunca lo vas a necesitar. Para decir “I’m going”, en español casi siempre basta con *voy*, y para los planes, *voy a* + forma de diccionario: *Voy a comer*.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Voy* a la escuela.',
                en: 'I’m going to school.',
                check: [{ entry: 'ir', tense: 'present', person: 'yo' }],
              },
              {
                es: '*Estoy yendo* para allá.',
                en: 'I’m on my way over there.',
                check: [{ entry: 'ir', tense: 'presentProgressive', person: 'yo' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'presentProgressive',
            pattern: 'irregular',
            text: { en: 'Irregular *-ando*/*-iendo* forms in this deck:', es: 'Gerundios irregulares en este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: '*ir* → *yendo*, but “I’m going” is usually just *voy*.',
          es: '*ir* → *yendo*, pero para “I’m going” casi siempre basta con *voy*.',
        },
      },
      {
        id: 'progressive-pronominal',
        title: { en: '*-se* verbs: two places for the pronoun', es: 'Verbos con -se: dos lugares para el pronombre' },
        when: { kind: 'pronominal' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'With a *-se* verb like *lavarse* (“to wash oneself”), the reflexive pronoun (*me*, *te*, *se*, *nos*…) can go in two places. Both mean the same thing, and the quiz takes either one:',
              es: 'Con un verbo con -se como *lavarse*, el pronombre reflexivo (*me*, *te*, *se*, *nos*…) puede ir en dos lugares. Los dos significan lo mismo, y la práctica acepta cualquiera de los dos:',
            },
          },
          {
            kind: 'list',
            items: [
              { en: 'before *estar*: *me estoy lavando*', es: 'antes de *estar*: *me estoy lavando*' },
              {
                en: 'on the end of the *-ando*/*-iendo* form, with a written accent: *estoy lavándome*',
                es: 'pegado al final del gerundio, con tilde: *estoy lavándome*',
              },
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: '¡*Nos estamos divirtiendo* mucho!',
                en: 'We’re having a lot of fun!',
                check: [{ entry: 'divertirse', tense: 'presentProgressive', person: 'nosotros' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*me estoy lavando* = *estoy lavándome*. With the pronoun on the end, the *-ando*/*-iendo* form takes a written accent.',
          es: '*me estoy lavando* = *estoy lavándome*. Con el pronombre pegado al final, el gerundio lleva tilde.',
        },
      },
      {
        id: 'progressive-impersonal',
        title: { en: '*hay* in the progressive', es: 'hay en el progresivo' },
        when: { verb: 'haber-impersonal' },
        blocks: [
          {
            kind: 'tip',
            text: {
              en: '*hay* is almost never used in the progressive, so the quiz skips it in this tense.',
              es: '*hay* casi nunca se usa en progresivo, así que la práctica no lo pregunta en este tiempo verbal.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'preterite',
    title: { en: 'The preterite (*pretérito*)', es: 'El pretérito' },
    summary: {
      en: 'What happened: finished actions at a certain time in the past.',
      es: 'Lo que pasó: acciones terminadas en un momento del pasado.',
    },
    when: { tense: 'preterite' },
    sections: [
      {
        id: 'preterite-when',
        title: { en: 'When to use it', es: 'Cuándo se usa' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The preterite tells what happened: an action that began and ended at a certain time in the past. It usually matches the English simple past: “I talked”, “she ate”, “did you go?”',
              es: 'El pretérito cuenta lo que pasó: una acción que empezó y terminó en un momento del pasado. Suele equivaler al pasado simple del inglés: “I talked”, “she ate”, “did you go?”.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Ayer *hablé* con mi abuela.',
                en: 'Yesterday I talked to my grandma.',
                check: [{ entry: 'hablar', tense: 'preterite', person: 'yo' }],
              },
              {
                es: 'Anoche *comimos* tacos.',
                en: 'Last night we ate tacos.',
                check: [{ entry: 'comer', tense: 'preterite', person: 'nosotros' }],
              },
              {
                es: 'De repente, *sonó* mi celular.',
                en: 'Suddenly, my phone rang.',
                check: [{ entry: 'sonar', tense: 'preterite', person: 'el' }],
              },
              {
                es: '¿*Escribiste* el ensayo?',
                en: 'Did you write the essay?',
                check: [{ entry: 'escribir', tense: 'preterite', person: 'tu' }],
              },
            ],
          },
          {
            kind: 'p',
            text: {
              en: 'Words that point to the preterite:',
              es: 'Palabras que anuncian el pretérito:',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Signal word', es: 'Palabra clave' },
              { en: 'Meaning', es: 'Significado' },
            ],
            rows: [
              [{ en: '*ayer*', es: '*ayer*' }, { en: '“yesterday”', es: '“yesterday”' }],
              [{ en: '*anoche*', es: '*anoche*' }, { en: '“last night”', es: '“last night”' }],
              [{ en: '*la semana pasada*', es: '*la semana pasada*' }, { en: '“last week”', es: '“last week”' }],
              [{ en: '*el año pasado*', es: '*el año pasado*' }, { en: '“last year”', es: '“last year”' }],
              [{ en: '*una vez*', es: '*una vez*' }, { en: '“once, one time”', es: '“once, one time”' }],
              [{ en: '*de repente*', es: '*de repente*' }, { en: '“suddenly”', es: '“suddenly”' }],
            ],
          },
        ],
        keyIdea: {
          en: 'Preterite = what happened: a finished action at a certain time.',
          es: 'Pretérito = lo que pasó: una acción terminada en un momento dado.',
        },
      },
      {
        id: 'preterite-build',
        title: { en: 'How to build it', es: 'Cómo se forma' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Take the dictionary form (infinitive), drop *-ar*, *-er* or *-ir* to get the stem, and add the preterite ending for the person. *-er* and *-ir* verbs share the same endings.',
              es: 'Toma la forma de diccionario (infinitivo), quítale -ar, -er o -ir para tener la raíz y agrega la terminación del pretérito que va con la persona. Los verbos en -er y en -ir tienen las mismas terminaciones.',
            },
          },
          {
            kind: 'paradigm',
            tense: 'preterite',
            entries: ['hablar', 'comer', 'vivir'],
            caption: {
              en: 'The shaded part is the ending. *comer* and *vivir* end the same way.',
              es: 'La parte sombreada es la terminación. *comer* y *vivir* terminan igual.',
            },
          },
          {
            kind: 'tip',
            text: {
              en: '*hablamos* and *vivimos* are the same in the present and the preterite (*-er* verbs are not: *comemos*, *comimos*); words like *ayer* tell you which one it is. If a deck drills both tenses and asks which tense *hablamos* is, either answer is right.',
              es: '*hablamos* y *vivimos* son iguales en presente y en pretérito (los verbos en -er no: *comemos*, *comimos*); palabras como *ayer* te dicen cuál es. Si un mazo practica los dos tiempos y pregunta de qué tiempo es *hablamos*, las dos respuestas son correctas.',
            },
          },
        ],
        keyIdea: {
          en: 'Stem + preterite ending: *hablé*, *comiste*, *vivió*.',
          es: 'Raíz + terminación del pretérito: *hablé*, *comiste*, *vivió*.',
        },
      },
      {
        id: 'preterite-accents',
        title: { en: 'Watch the accents', es: 'Ojo con las tildes' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Regular preterites have a written accent in two persons: *yo* (*hablé*, *comí*) and *él / ella / usted* (*habló*, *comió*). The accent is not decoration. It changes the meaning:',
              es: 'Los pretéritos regulares llevan tilde en dos personas: yo (*hablé*, *comí*) y él / ella / usted (*habló*, *comió*). La tilde no es un adorno: cambia el significado.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'No accent', es: 'Sin tilde' },
              { en: 'Accent', es: 'Con tilde' },
            ],
            rows: [
              [
                { en: '*hablo* “I talk” (present)', es: '*hablo*: yo, presente' },
                { en: '*habló* “he / she talked” (preterite)', es: '*habló*: él / ella / usted, pretérito' },
              ],
              [
                { en: '*estudio* “I study” (present)', es: '*estudio*: yo, presente' },
                { en: '*estudió* “he / she studied” (preterite)', es: '*estudió*: él / ella / usted, pretérito' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Yo *hablo* con Ana todos los días.',
                en: 'I talk to Ana every day.',
                check: [{ entry: 'hablar', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Ayer Ana *habló* con la profesora.',
                en: 'Yesterday Ana talked to the teacher.',
                check: [{ entry: 'hablar', tense: 'preterite', person: 'el' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'The accent makes *habló* “he talked”; without it, *hablo* is “I talk”.',
          es: 'La tilde hace que *habló* sea pasado; sin ella, *hablo* es presente.',
        },
      },
      {
        id: 'preterite-accents-typed',
        title: { en: 'Typing *habló*', es: 'Al escribir habló' },
        when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
        blocks: [
          {
            kind: 'tip',
            text: {
              en: 'Typed *hablo* for *habló*? That’s an accent slip. While accents are forgiven, it still counts: you see “Correct, but watch the accent:” and the right spelling. Once accents count, you get “Almost — check the accent:” and it counts as a miss.',
              es: '¿Escribiste *hablo* en lugar de *habló*? Es un error de tilde. Mientras se perdonan los acentos, cuenta igual: ves “Correcto, pero ojo con el acento:” y cómo se escribe. Cuando los acentos cuentan, recibes “Casi — revisa el acento:” y cuenta como fallo.',
            },
          },
        ],
      },
      {
        id: 'preterite-spelling',
        title: { en: 'Spelling changes', es: 'Cambios de ortografía' },
        when: { pattern: 'spelling', tense: 'preterite' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Some verbs change a letter to keep their sound. The endings stay regular; only the spelling moves.',
              es: 'Algunos verbos cambian una letra para conservar su sonido. Las terminaciones son regulares; solo cambia la ortografía.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Verbs ending in', es: 'Verbos en' },
              { en: 'What changes', es: 'Qué cambia' },
            ],
            rows: [
              [
                { en: '*-car*: *buscar*, *tocar*, *practicar*', es: '-car: *buscar*, *tocar*, *practicar*' },
                { en: '*c* → *qu* in *yo*: *busqué*, *toqué*, *practiqué*', es: 'c → qu en yo: *busqué*, *toqué*, *practiqué*' },
              ],
              [
                { en: '*-gar*: *llegar*, *jugar*, *pagar*', es: '-gar: *llegar*, *jugar*, *pagar*' },
                { en: '*g* → *gu* in *yo*: *llegué*, *jugué*, *pagué*', es: 'g → gu en yo: *llegué*, *jugué*, *pagué*' },
              ],
              [
                { en: '*-zar*: *empezar*, *almorzar*', es: '-zar: *empezar*, *almorzar*' },
                { en: '*z* → *c* in *yo*: *empecé*, *almorcé*', es: 'z → c en yo: *empecé*, *almorcé*' },
              ],
              [
                { en: 'a vowel + *-er* or *-ir*: *leer*, *creer*, *oír*', es: 'vocal + -er o -ir: *leer*, *creer*, *oír*' },
                { en: '*i* → *y* in *él* and *ellos*: *leyó*, *leyeron*, *oyó*', es: 'i → y en él y ellos: *leyó*, *leyeron*, *oyó*' },
              ],
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'For *-car*, *-gar* and *-zar*, only *yo* changes: *buscaste* and *buscó* are regular. *leer*, *creer* and *oír* also add accents: *leíste*, *leímos*. *reír* has no *y*: *rio*, *rieron*.',
              es: 'En -car, -gar y -zar solo cambia yo: *buscaste* y *buscó* son regulares. *leer*, *creer* y *oír* además llevan tilde: *leíste*, *leímos*. *reír* no lleva y: *rio*, *rieron*.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Llegué* tarde a clase.',
                en: 'I got to class late.',
                check: [{ entry: 'llegar', tense: 'preterite', person: 'yo' }],
              },
              {
                es: '*Busqué* mi celular por todas partes.',
                en: 'I looked everywhere for my phone.',
                check: [{ entry: 'buscar', tense: 'preterite', person: 'yo' }],
              },
              {
                es: 'Mi hermana *leyó* el libro en un día.',
                en: 'My sister read the book in one day.',
                check: [{ entry: 'leer', tense: 'preterite', person: 'el' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'preterite',
            pattern: 'spelling',
            text: { en: 'In this deck:', es: 'En este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: 'The *yo* form of *-car*, *-gar* and *-zar* verbs changes its spelling: *busqué*, *llegué*, *empecé*. After a vowel, *i* becomes *y*: *leyó*, *leyeron*.',
          es: 'La forma de yo de los verbos en -car, -gar y -zar cambia de ortografía: *busqué*, *llegué*, *empecé*. Después de vocal, la i se vuelve y: *leyó*, *leyeron*.',
        },
      },
      {
        id: 'preterite-stem',
        title: { en: 'Boot verbs in *-ir*: only *él* and *ellos* change', es: 'Verbos bota en -ir: solo cambian él y ellos' },
        when: { pattern: 'stem', tense: 'preterite' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Most stem-changing verbs (boot verbs) in *-ar* and *-er* lose their stem change in the preterite: *pensé*, *volví*. Those in *-ir* keep a change, but only in the *él / ella / usted* and *ellos / ellas / ustedes* forms, and it is just one vowel: *e* becomes *i*, *o* becomes *u*. (*querer*, *poder*, *tener* and *venir* are another story: they are irregular in the preterite, with a new stem in every person: *quise*, *pude*, *tuve*, *vine*.)',
              es: 'Casi todos los verbos con cambio de raíz (verbos bota) en -ar y en -er pierden ese cambio en el pretérito: *pensé*, *volví*. Los de -ir sí cambian, pero solo en las formas de él / ella / usted y ellos / ellas / ustedes, y el cambio es de una sola vocal: la e se vuelve i, la o se vuelve u. (*querer*, *poder*, *tener* y *venir* son otra historia: son irregulares en el pretérito, con una raíz nueva en todas las personas: *quise*, *pude*, *tuve*, *vine*.)',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: '*e* → *i*', es: 'e → i' },
              { en: '*o* → *u*', es: 'o → u' },
            ],
            rows: [
              [
                { en: '*pedir*: *pidió*, *pidieron*', es: '*pedir*: *pidió*, *pidieron*' },
                { en: '*dormir*: *durmió*, *durmieron*', es: '*dormir*: *durmió*, *durmieron*' },
              ],
              [
                { en: '*preferir*: *prefirió*, *prefirieron*', es: '*preferir*: *prefirió*, *prefirieron*' },
                { en: '*morir*: *murió*, *murieron*', es: '*morir*: *murió*, *murieron*' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Yo *pedí* agua, pero mi hermano *pidió* un refresco.',
                en: 'I ordered water, but my brother ordered a soda.',
                check: [
                  { entry: 'pedir', tense: 'preterite', person: 'yo' },
                  { entry: 'pedir', tense: 'preterite', person: 'el' },
                ],
              },
              {
                es: 'Los niños *durmieron* toda la noche.',
                en: 'The kids slept all night.',
                check: [{ entry: 'dormir', tense: 'preterite', person: 'ellos' }],
              },
              {
                es: '¿*Se divirtieron* en la fiesta?',
                en: 'Did you all have fun at the party?',
                check: [{ entry: 'divertirse', tense: 'preterite', person: 'ellos' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'preterite',
            pattern: 'stem',
            text: { en: 'In this deck:', es: 'En este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: 'In the preterite, only *-ir* boot verbs keep a stem change, and only in *él* and *ellos*: *pidió*, *durmieron*.',
          es: 'En el pretérito solo los verbos bota en -ir conservan un cambio de raíz, y solo en él y ellos: *pidió*, *durmieron*.',
        },
      },
      {
        id: 'preterite-irregular',
        title: { en: 'Irregular preterites', es: 'Pretéritos irregulares' },
        when: { pattern: 'irregular', tense: 'preterite' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Many everyday verbs use a new stem in the preterite, with endings of their own. The *yo* form ends in *-e* and the *él / ella / usted* form in *-o*, and neither has a written accent: *tuve*, *tuvo*. (*ser*, *ir*, *dar* and *ver* are irregular in their own way: *fui*, *fue*; *di*, *dio*; *vi*, *vio*.)',
              es: 'Muchos verbos muy comunes usan una raíz nueva en el pretérito, con sus propias terminaciones. La forma de yo termina en -e y la de él / ella / usted en -o, y ninguna lleva tilde: *tuve*, *tuvo*. (*ser*, *ir*, *dar* y *ver* son irregulares a su manera: *fui*, *fue*; *di*, *dio*; *vi*, *vio*.)',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Dictionary form', es: 'Forma de diccionario' },
              { en: 'New stem: *yo*, *él*', es: 'Raíz nueva: yo, él' },
            ],
            rows: [
              [{ en: '*tener*', es: '*tener*' }, { en: '*tuv-*: *tuve*, *tuvo*', es: '*tuv-*: *tuve*, *tuvo*' }],
              [{ en: '*estar*', es: '*estar*' }, { en: '*estuv-*: *estuve*, *estuvo*', es: '*estuv-*: *estuve*, *estuvo*' }],
              [{ en: '*poder*', es: '*poder*' }, { en: '*pud-*: *pude*, *pudo*', es: '*pud-*: *pude*, *pudo*' }],
              [{ en: '*poner*', es: '*poner*' }, { en: '*pus-*: *puse*, *puso*', es: '*pus-*: *puse*, *puso*' }],
              [{ en: '*saber*', es: '*saber*' }, { en: '*sup-*: *supe*, *supo*', es: '*sup-*: *supe*, *supo*' }],
              [{ en: '*querer*', es: '*querer*' }, { en: '*quis-*: *quise*, *quiso*', es: '*quis-*: *quise*, *quiso*' }],
              [{ en: '*venir*', es: '*venir*' }, { en: '*vin-*: *vine*, *vino*', es: '*vin-*: *vine*, *vino*' }],
              [{ en: '*hacer*', es: '*hacer*' }, { en: '*hic-*: *hice*, *hizo*', es: '*hic-*: *hice*, *hizo*' }],
              [{ en: '*decir*', es: '*decir*' }, { en: '*dij-*: *dije*, *dijo*', es: '*dij-*: *dije*, *dijo*' }],
              [{ en: '*traer*', es: '*traer*' }, { en: '*traj-*: *traje*, *trajo*', es: '*traj-*: *traje*, *trajo*' }],
            ],
          },
          {
            kind: 'tip',
            text: {
              en: '*hizo* is spelled with *z* to keep its sound. After *j*, the *ellos* form drops the *i*: *dijeron*, *trajeron*.',
              es: '*hizo* se escribe con z para conservar su sonido. Después de j, la forma de ellos pierde la i: *dijeron*, *trajeron*.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Ayer *tuve* un examen de matemáticas.',
                en: 'Yesterday I had a math test.',
                check: [{ entry: 'tener', tense: 'preterite', person: 'yo' }],
              },
              {
                es: '¿Dónde *estuviste* anoche?',
                en: 'Where were you last night?',
                check: [{ entry: 'estar', tense: 'preterite', person: 'tu' }],
              },
              {
                es: 'No *pude* dormir.',
                en: 'I couldn’t sleep.',
                check: [{ entry: 'poder', tense: 'preterite', person: 'yo' }],
              },
              {
                es: '*Hice* la tarea en el autobús.',
                en: 'I did my homework on the bus.',
                check: [{ entry: 'hacer', tense: 'preterite', person: 'yo' }],
              },
              {
                es: 'Mis primos *vinieron* a la fiesta.',
                en: 'My cousins came to the party.',
                check: [{ entry: 'venir', tense: 'preterite', person: 'ellos' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'preterite',
            pattern: 'irregular',
            text: { en: 'Irregular in this deck:', es: 'Irregulares en este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: 'A new stem and no accents: *tuve*, *hice*, *dijo*.',
          es: 'Raíz nueva y sin tildes: *tuve*, *hice*, *dijo*.',
        },
      },
      {
        id: 'preterite-ser-ir',
        title: { en: '*ser* and *ir*: the same forms', es: 'ser e ir: las mismas formas' },
        when: { any: [{ verb: 'ser' }, { verb: 'ir' }, { verb: 'irse' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'In the preterite, *ser* (“to be”) and *ir* (“to go”) share every form: *fui*, *fuiste*, *fue*, *fuimos*, *fueron*. The rest of the sentence tells you which verb it is.',
              es: 'En el pretérito, *ser* e *ir* comparten todas sus formas: *fui*, *fuiste*, *fue*, *fuimos*, *fueron*. El resto de la oración te dice cuál de los dos es.',
            },
          },
          {
            kind: 'paradigm',
            tense: 'preterite',
            entries: ['ser', 'ir'],
            caption: { en: 'Two verbs, one set of forms.', es: 'Dos verbos, un solo juego de formas.' },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Fui* al cine con mis amigos.',
                en: 'I went to the movies with my friends.',
                check: [{ entry: 'ir', tense: 'preterite', person: 'yo' }],
              },
              {
                es: 'La película *fue* muy divertida.',
                en: 'The movie was really fun.',
                check: [{ entry: 'ser', tense: 'preterite', person: 'el' }],
              },
              {
                es: '¿*Fuiste* a la fiesta?',
                en: 'Did you go to the party?',
                check: [{ entry: 'ir', tense: 'preterite', person: 'tu' }],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'In a “name the verb” question, if your deck has both verbs, *fui* can be *ser* or *ir*: either answer is right.',
              es: 'En una pregunta de “nombra el verbo”, si tu mazo tiene los dos verbos, *fui* puede ser *ser* o *ir*: las dos respuestas son correctas.',
            },
          },
        ],
        keyIdea: {
          en: '*fui*, *fue*, *fueron*: “went” (*ir*) or “was / were” (*ser*). The sentence decides.',
          es: '*fui*, *fue*, *fueron*: de *ir* o de *ser*. La oración decide.',
        },
      },
      {
        id: 'preterite-dar-ver',
        title: { en: '*dar* and *ver*: no accents', es: 'dar y ver: sin tildes' },
        when: { any: [{ verb: 'dar' }, { verb: 'ver' }, { verb: 'verse' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*dar* (“to give”) is an *-ar* verb, but it takes the *-er*/*-ir* endings. *ver* (“to see”) takes them too, like any *-er* verb. Their *yo* and *él / ella / usted* forms have just one syllable, so they need no written accent: *di*, *dio*; *vi*, *vio*.',
              es: '*dar* es un verbo en -ar, pero usa las terminaciones de -er/-ir; *ver* también, como cualquier verbo en -er. Sus formas de yo y de él / ella / usted tienen una sola sílaba, así que no llevan tilde: *di*, *dio*; *vi*, *vio*.',
            },
          },
          {
            kind: 'paradigm',
            tense: 'preterite',
            entries: ['dar', 'ver'],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Anoche *vi* una película de terror.',
                en: 'Last night I saw a horror movie.',
                check: [{ entry: 'ver', tense: 'preterite', person: 'yo' }],
              },
              {
                es: 'Mi abuela me *dio* veinte dólares.',
                en: 'My grandma gave me twenty dollars.',
                check: [{ entry: 'dar', tense: 'preterite', person: 'el' }],
              },
              {
                es: '*Me vi* en el espejo.',
                en: 'I saw myself in the mirror.',
                check: [{ entry: 'verse', tense: 'preterite', person: 'yo' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*di*, *dio*, *vi*, *vio*: short forms, no accents.',
          es: '*di*, *dio*, *vi*, *vio*: formas cortas, sin tilde.',
        },
      },
    ],
  },
  {
    id: 'imperfect',
    title: { en: 'The imperfect (*imperfecto*)', es: 'El imperfecto' },
    summary: {
      en: 'The past as a scene: what was going on, what used to happen, what things were like.',
      es: 'El pasado como escena: lo que pasaba, lo que solía pasar, cómo eran las cosas.',
    },
    when: { tense: 'imperfect' },
    sections: [
      {
        id: 'imperfect-when',
        title: { en: 'When to use it', es: 'Cuándo se usa' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The imperfect describes the past with no clear beginning or end. Use it for:',
              es: 'El imperfecto describe el pasado sin un principio ni un final claros. Úsalo para:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'habits: what used to happen (“used to”, “would”)',
                es: 'costumbres: lo que solía pasar (“used to”, “would”)',
              },
              { en: 'actions in progress (“was / were -ing”)', es: 'acciones en curso (“was / were -ing”)' },
              {
                en: 'descriptions: what people, places and things were like',
                es: 'descripciones: cómo eran las personas, los lugares y las cosas',
              },
              { en: 'age and time: how old someone was, what time it was', es: 'la edad y la hora: cuántos años tenía alguien, qué hora era' },
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'De niño, *jugaba* fútbol todos los días.',
                en: 'As a kid, I played soccer every day.',
                check: [{ entry: 'jugar', tense: 'imperfect', person: 'yo' }],
              },
              {
                es: 'Mi mamá *cocinaba* y yo *hacía* la tarea.',
                en: 'My mom was cooking and I was doing my homework.',
                check: [
                  { entry: 'cocinar', tense: 'imperfect', person: 'el' },
                  { entry: 'hacer', tense: 'imperfect', person: 'yo' },
                ],
              },
              {
                es: 'La casa *era* grande y *tenía* un jardín.',
                en: 'The house was big and had a yard.',
                check: [
                  { entry: 'ser', tense: 'imperfect', person: 'el' },
                  { entry: 'tener', tense: 'imperfect', person: 'el' },
                ],
              },
              {
                es: '*Tenía* diez años.',
                en: 'I was ten years old.',
                check: [{ entry: 'tener', tense: 'imperfect', person: 'yo' }],
              },
              {
                es: '*Eran* las tres de la tarde.',
                en: 'It was three in the afternoon.',
                check: [{ entry: 'ser', tense: 'imperfect', person: 'ellos' }],
              },
            ],
          },
          {
            kind: 'p',
            text: {
              en: 'Words that point to the imperfect:',
              es: 'Palabras que anuncian el imperfecto:',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Signal word', es: 'Palabra clave' },
              { en: 'Meaning', es: 'Significado' },
            ],
            rows: [
              [{ en: '*siempre*', es: '*siempre*' }, { en: '“always”', es: '“always”' }],
              [{ en: '*todos los días*', es: '*todos los días*' }, { en: '“every day”', es: '“every day”' }],
              [{ en: '*cada verano*', es: '*cada verano*' }, { en: '“every summer”', es: '“every summer”' }],
              [{ en: '*mientras*', es: '*mientras*' }, { en: '“while”', es: '“while”' }],
              [{ en: '*de niño*, *de niña*', es: '*de niño*, *de niña*' }, { en: '“as a kid”', es: '“as a kid”' }],
              [{ en: '*antes*', es: '*antes*' }, { en: '“before, back then”', es: '“before, back then”' }],
            ],
          },
        ],
        keyIdea: {
          en: 'Imperfect = the past as a scene: what was going on, what used to happen, what things were like.',
          es: 'Imperfecto = el pasado como escena: lo que pasaba, lo que solía pasar, cómo eran las cosas.',
        },
      },
      {
        id: 'imperfect-build',
        title: { en: 'How to build it', es: 'Cómo se forma' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Take the dictionary form (infinitive), drop *-ar*, *-er* or *-ir*, and add the ending. There are only two sets: *-aba* for *-ar* verbs, and *-ía* for *-er* and *-ir* verbs.',
              es: 'Toma la forma de diccionario (infinitivo), quítale -ar, -er o -ir y agrega la terminación. Hay solo dos juegos: -aba para los verbos en -ar, e -ía para los verbos en -er y en -ir.',
            },
          },
          {
            kind: 'paradigm',
            tense: 'imperfect',
            entries: ['hablar', 'comer', 'vivir'],
            caption: {
              en: 'The shaded part is the ending. *comer* and *vivir* end the same way.',
              es: 'La parte sombreada es la terminación. *comer* y *vivir* terminan igual.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'No stem changes and no irregular *yo* forms: *quería*, *podía*, *tenía*, *hacía*.',
                es: 'No hay cambios de raíz ni formas de yo irregulares: *quería*, *podía*, *tenía*, *hacía*.',
              },
              {
                en: '*yo* and *él / ella / usted* look the same, so add *yo*, *él*, *ella* or a name when it isn’t clear.',
                es: 'Las formas de *yo* y de *él / ella / usted* son iguales; agrega *yo*, *él*, *ella* o un nombre si no queda claro.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'In a “name the verb” question, *hablaba* can be *yo* or *él / ella / usted*: either one is right.',
              es: 'En una pregunta de “nombra el verbo”, *hablaba* puede ser yo o él / ella / usted: las dos respuestas son correctas.',
            },
          },
        ],
        keyIdea: {
          en: '*-ar* verbs take *-aba*; *-er* and *-ir* verbs take *-ía*.',
          es: 'Los verbos en -ar llevan -aba; los de -er y -ir, -ía.',
        },
      },
      {
        id: 'imperfect-accents',
        title: { en: 'Watch the accents', es: 'Ojo con las tildes' },
        blocks: [
          {
            kind: 'list',
            items: [
              {
                en: 'Every *-ía* ending has a written accent: *comía*, *vivías*, *tenían*.',
                es: 'Toda terminación en -ía lleva tilde: *comía*, *vivías*, *tenían*.',
              },
              {
                en: 'In *-ar* verbs, only the *nosotros* form has one: *hablábamos*, *estábamos*.',
                es: 'En los verbos en -ar, solo la forma de nosotros la lleva: *hablábamos*, *estábamos*.',
              },
            ],
          },
        ],
        keyIdea: {
          en: '*-ía* always has its accent; *-aba* has one only in *-ábamos*.',
          es: '-ía siempre lleva tilde; -aba solo en -ábamos.',
        },
      },
      {
        id: 'imperfect-accents-typed',
        title: { en: 'Typing *comía*', es: 'Al escribir comía' },
        when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
        blocks: [
          {
            kind: 'tip',
            text: {
              en: 'Typed *comia* for *comía*? That’s an accent slip. While accents are forgiven, it still counts: you see “Correct, but watch the accent:” and the right spelling. Once accents count, you get “Almost — check the accent:” and it counts as a miss.',
              es: '¿Escribiste *comia* en lugar de *comía*? Es un error de tilde. Mientras se perdonan los acentos, cuenta igual: ves “Correcto, pero ojo con el acento:” y cómo se escribe. Cuando los acentos cuentan, recibes “Casi — revisa el acento:” y cuenta como fallo.',
            },
          },
        ],
      },
      {
        id: 'imperfect-irregular',
        title: { en: 'Only three irregular verbs', es: 'Solo tres verbos irregulares' },
        when: { pattern: 'irregular', tense: 'imperfect' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The imperfect has just three irregular verbs: *ser* (*era*), *ir* (*iba*) and *ver* (*veía*). Every other verb follows the pattern, even the ones that are irregular in other tenses.',
              es: 'El imperfecto tiene solo tres verbos irregulares: *ser* (*era*), *ir* (*iba*) y *ver* (*veía*). Todos los demás siguen el modelo, incluso los que son irregulares en otros tiempos.',
            },
          },
          {
            kind: 'tip',
            text: {
              en: 'Watch the *nosotros* forms: *éramos*, *íbamos*, *veíamos*.',
              es: 'Ojo con las formas de nosotros: *éramos*, *íbamos*, *veíamos*.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Mi abuelo *era* muy alto.',
                en: 'My grandpa was very tall.',
                check: [{ entry: 'ser', tense: 'imperfect', person: 'el' }],
              },
              {
                es: 'Siempre *íbamos* a la playa en verano.',
                en: 'We always went to the beach in the summer.',
                check: [{ entry: 'ir', tense: 'imperfect', person: 'nosotros' }],
              },
              {
                es: 'De niña, *veía* caricaturas todas las mañanas.',
                en: 'As a little girl, I watched cartoons every morning.',
                check: [{ entry: 'ver', tense: 'imperfect', person: 'yo' }],
              },
            ],
          },
          {
            kind: 'deckVerbs',
            tense: 'imperfect',
            pattern: 'irregular',
            text: { en: 'Irregular in this deck:', es: 'Irregulares en este mazo:' },
            withTables: true,
          },
        ],
        keyIdea: {
          en: 'Only *ser* (*era*), *ir* (*iba*) and *ver* (*veía*) are irregular in the imperfect.',
          es: 'Solo *ser* (*era*), *ir* (*iba*) y *ver* (*veía*) son irregulares en el imperfecto.',
        },
      },
      {
        id: 'imperfect-impersonal',
        title: { en: '*hay* becomes *había*', es: 'hay se vuelve había' },
        when: { verb: 'haber-impersonal' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: '*hay* (“there is / there are”) becomes *había* (“there was / there were”) in the imperfect. Like *hay*, it has one form for one thing or many.',
              es: '*hay* se vuelve *había* en el imperfecto. Igual que *hay*, tiene una sola forma para una cosa o para muchas.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Había* tres perros en el parque.',
                en: 'There were three dogs in the park.',
                check: [{ entry: 'haber-impersonal', tense: 'imperfect', person: 'el' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: '*hay* → *había*: “there was” and “there were”.',
          es: '*hay* → *había*, para una cosa o para muchas.',
        },
      },
      {
        id: 'preterite-vs-imperfect',
        title: { en: 'Preterite or imperfect?', es: '¿Pretérito o imperfecto?' },
        when: { all: [{ tense: 'preterite' }, { tense: 'imperfect' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Think of the past as a movie. The imperfect sets the scene: what was going on and what things were like. The preterite is the event: what happened.',
              es: 'Piensa en el pasado como en una película. El imperfecto pinta la escena: lo que pasaba y cómo eran las cosas. El pretérito es el suceso: lo que pasó.',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Imperfect: the scene', es: 'Imperfecto: la escena' },
              { en: 'Preterite: the event', es: 'Pretérito: el suceso' },
            ],
            rows: [
              [
                { en: 'what was going on (“was / were -ing”)', es: 'lo que estaba pasando (“was / were -ing”)' },
                { en: 'what happened, start to finish', es: 'lo que pasó, de principio a fin' },
              ],
              [
                { en: 'what used to happen, again and again', es: 'lo que pasaba una y otra vez' },
                { en: 'what happened once, or a set number of times', es: 'lo que pasó una vez, o un número exacto de veces' },
              ],
              [
                { en: 'descriptions, age, time, weather', es: 'descripciones, edad, hora, clima' },
                { en: 'actions that move the story forward', es: 'acciones que hacen avanzar la historia' },
              ],
              [
                { en: '*siempre*, *todos los días*, *mientras*', es: '*siempre*, *todos los días*, *mientras*' },
                { en: '*ayer*, *una vez*, *de repente*', es: '*ayer*, *una vez*, *de repente*' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: '*Llovía* cuando *salí*.',
                en: 'It was raining when I left.',
                check: [
                  { entry: 'llover', tense: 'imperfect', person: 'el' },
                  { entry: 'salir', tense: 'preterite', person: 'yo' },
                ],
              },
              {
                es: 'Mientras *estudiaba*, mi hermano *llegó* a casa.',
                en: 'While I was studying, my brother got home.',
                check: [
                  { entry: 'estudiar', tense: 'imperfect', person: 'yo' },
                  { entry: 'llegar', tense: 'preterite', person: 'el' },
                ],
              },
              {
                es: '*Eran* las diez y *hacía* frío. De repente, *sonó* el teléfono.',
                en: 'It was ten o’clock and it was cold. Suddenly, the phone rang.',
                check: [
                  { entry: 'ser', tense: 'imperfect', person: 'ellos' },
                  { entry: 'hacer-impersonal', tense: 'imperfect', person: 'el' },
                  { entry: 'sonar', tense: 'preterite', person: 'el' },
                ],
              },
              {
                es: 'De niño *iba* a la playa todos los veranos, pero una vez *fui* a las montañas.',
                en: 'As a kid I went to the beach every summer, but once I went to the mountains.',
                check: [
                  { entry: 'ir', tense: 'imperfect', person: 'yo' },
                  { entry: 'ir', tense: 'preterite', person: 'yo' },
                ],
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'The trick: ask yourself, “Is this the scene, or the event?” Scene: imperfect. Event: preterite.',
              es: 'El truco: pregúntate “¿es la escena o el suceso?”. Escena: imperfecto. Suceso: pretérito.',
            },
          },
        ],
        keyIdea: {
          en: 'Imperfect = the scene (what was going on). Preterite = the event (what happened).',
          es: 'Imperfecto = la escena (lo que pasaba). Pretérito = el suceso (lo que pasó).',
        },
      },
    ],
  },
];

export default chapters;
