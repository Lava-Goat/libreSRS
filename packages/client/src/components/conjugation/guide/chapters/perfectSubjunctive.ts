// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The last two chapters of the guide: the perfect tenses (haber + past
 * participle: he hablado, había hablado) and the subjunctive (what it is, the
 * WEIRDO triggers, the present subjunctive from the yo present, the imperfect
 * subjunctive from the ellos preterite, and si-clauses with the conditional).
 * Every form in an example is checked against the engine by guide.test.ts.
 */
import type { Chapter, Condition, Example, Section } from '../types';

/** The engine entries of the six present subjunctives that do not come from the yo form (DISHES). */
const DISHES = ['dar', 'darse', 'ir', 'irse', 'ser', 'haber', 'haber-impersonal', 'estar', 'saber'];

/**
 * The irregular participles, for the tense a deck drills: the present perfect
 * when it has it, else the pluperfect, so a deck with both sees the list once.
 * The two copies take different titles: the teacher's "every chapter" view
 * shows both, and two regions with one name are one too many for a screen reader.
 */
function irregularParticiples(
  id: string,
  tense: 'presentPerfect' | 'pluperfect',
  when: Condition,
  examples: Example[],
  title: Section['title'] = { en: 'Irregular past participles', es: 'Participios irregulares' },
): Section {
  return {
    id,
    title,
    when,
    blocks: [
      {
        kind: 'p',
        text: {
          en: 'A few common verbs have a past participle of their own. Most end in *-to* or *-cho*. Learn these by heart:',
          es: 'Algunos verbos muy comunes tienen un participio propio. Casi todos terminan en *-to* o *-cho*. Apréndelos de memoria:',
        },
      },
      {
        kind: 'compare',
        head: [{ en: 'Dictionary form', es: 'Forma de diccionario' }, { en: 'Past participle', es: 'Participio' }],
        rows: [
          [{ en: '*hacer* (“to do, make”)', es: '*hacer*' }, { en: '*hecho*', es: '*hecho*' }],
          [{ en: '*decir* (“to say”)', es: '*decir*' }, { en: '*dicho*', es: '*dicho*' }],
          [{ en: '*ver* (“to see”)', es: '*ver*' }, { en: '*visto*', es: '*visto*' }],
          [{ en: '*escribir* (“to write”)', es: '*escribir*' }, { en: '*escrito*', es: '*escrito*' }],
          [{ en: '*poner* (“to put”)', es: '*poner*' }, { en: '*puesto*', es: '*puesto*' }],
          [{ en: '*volver* (“to come back”)', es: '*volver*' }, { en: '*vuelto*', es: '*vuelto*' }],
          [{ en: '*abrir* (“to open”)', es: '*abrir*' }, { en: '*abierto*', es: '*abierto*' }],
          [{ en: '*romper* (“to break”)', es: '*romper*' }, { en: '*roto*', es: '*roto*' }],
          [{ en: '*morir* (“to die”)', es: '*morir*' }, { en: '*muerto*', es: '*muerto*' }],
          [{ en: '*cubrir* (“to cover”)', es: '*cubrir*' }, { en: '*cubierto*', es: '*cubierto*' }],
          [{ en: '*resolver* (“to solve”)', es: '*resolver*' }, { en: '*resuelto*', es: '*resuelto*' }],
        ],
      },
      {
        kind: 'tip',
        text: {
          en: 'Verbs built on these change the same way: *devolver* → *devuelto*, *describir* → *descrito*, *descubrir* → *descubierto*.',
          es: 'Los verbos que se forman a partir de estos cambian igual: *devolver* → *devuelto*, *describir* → *descrito*, *descubrir* → *descubierto*.',
        },
      },
      { kind: 'deckVerbs', tense, pattern: 'participle', withTables: true, text: { en: 'In this deck:', es: 'En este mazo:' } },
      { kind: 'examples', items: examples },
    ],
    keyIdea: {
      en: 'Most irregular participles end in *-to* or *-cho*: *hecho*, *dicho*, *visto*, *escrito*.',
      es: 'Casi todos los participios irregulares terminan en *-to* o *-cho*: *hecho*, *dicho*, *visto*, *escrito*.',
    },
  };
}

const perfect: Chapter = {
  id: 'perfect',
  title: { en: 'Perfect tenses (*haber* + past participle)', es: 'Los tiempos perfectos (haber + participio)' },
  summary: {
    en: 'What you “have done” and “had done”: the helping verb *haber* plus a past participle.',
    es: 'Para decir lo que *has hecho* o lo que *habías hecho*: el verbo auxiliar *haber* más un participio.',
  },
  when: { any: [{ tense: 'presentPerfect' }, { tense: 'pluperfect' }] },
  sections: [
    {
      id: 'perfect-two-parts',
      title: { en: 'Two parts: *haber* + past participle', es: 'Dos partes: haber + participio' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In English you say “I have eaten” or “I had eaten”: a small verb (“have”, “had”) helps the main verb (“eaten”). Spanish works the same way. The helping verb is *haber*, and the main verb turns into a past participle, like *comido* (“eaten”).',
            es: 'En inglés se dice “I have eaten” o “I had eaten”: un verbo auxiliar (“have”, “had”) ayuda al verbo principal (“eaten”). En español pasa lo mismo: el verbo auxiliar es *haber*, y el verbo principal va en participio, como *comido*.',
          },
        },
        {
          kind: 'list',
          items: [
            {
              en: 'The helping verb *haber* changes with the person (who did it) and the tense: *he*, *has*, *había*…',
              es: 'El verbo auxiliar *haber* cambia según la persona (quién lo hizo) y el tiempo verbal: *he*, *has*, *había*…',
            },
            {
              en: 'The past participle carries the meaning. With *haber*, it never changes: *hablado*, *comido*, *vivido*.',
              es: 'El participio lleva el significado. Con *haber*, nunca cambia: *hablado*, *comido*, *vivido*.',
            },
          ],
        },
        {
          kind: 'compare',
          head: [{ en: 'English', es: 'Inglés' }, { en: 'Spanish', es: 'Español' }],
          rows: [
            [{ en: 'I have eaten', es: 'I have eaten' }, { en: '*he comido*', es: '*he comido*' }],
            [{ en: 'I had eaten', es: 'I had eaten' }, { en: '*había comido*', es: '*había comido*' }],
            [{ en: 'we have spoken', es: 'we have spoken' }, { en: '*hemos hablado*', es: '*hemos hablado*' }],
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'This “have” is always *haber*, never *tener*. *Tener* is for things you have: *tengo un perro* (“I have a dog”).',
            es: 'Este verbo auxiliar es siempre *haber*, nunca *tener*. *Tener* es para las cosas que tienes: tengo un perro.',
          },
        },
      ],
      keyIdea: {
        en: 'A perfect tense is a form of *haber* plus a past participle: *he comido* (“I have eaten”).',
        es: 'Un tiempo perfecto es una forma de *haber* más un participio: *he comido*.',
      },
    },
    {
      id: 'perfect-participle',
      title: { en: 'Making the past participle', es: 'Cómo se forma el participio' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Start from the dictionary form (infinitive), like *hablar*. Take off *-ar*, *-er* or *-ir* to get the stem (*habl-*). Then add the participle ending:',
            es: 'Empieza con la forma de diccionario (infinitivo), como *hablar*. Quita *-ar*, *-er* o *-ir* y te queda la raíz (*habl-*). Luego agrega la terminación del participio:',
          },
        },
        {
          kind: 'list',
          items: [
            {
              en: '*-ar* verbs add *-ado*: *hablar* → *hablado* (“spoken”).',
              es: 'Los verbos en *-ar* llevan *-ado*: *hablar* → *hablado*.',
            },
            {
              en: '*-er* and *-ir* verbs add *-ido*: *comer* → *comido* (“eaten”), *vivir* → *vivido* (“lived”).',
              es: 'Los verbos en *-er* y en *-ir* llevan *-ido*: *comer* → *comido*, *vivir* → *vivido*.',
            },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'When the stem ends in *a*, *e* or *o*, *-ido* gets an accent: *leer* → *leído*, *oír* → *oído*, *creer* → *creído*, *traer* → *traído*. The accent splits the two vowels into two sounds: *le-í-do*.',
            es: 'Si la raíz termina en *a*, *e* u *o*, *-ido* lleva acento: *leer* → *leído*, *oír* → *oído*, *creer* → *creído*, *traer* → *traído*. El acento separa las dos vocales: le-í-do.',
          },
        },
      ],
      keyIdea: {
        en: '*-ar* → *-ado*; *-er* and *-ir* → *-ido*.',
        es: '*-ar* → *-ado*; *-er* e *-ir* → *-ido*.',
      },
    },
    {
      id: 'perfect-present',
      title: { en: 'Present perfect: “have done”', es: 'Pretérito perfecto: “he hecho”' },
      when: { tense: 'presentPerfect' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The present perfect (in the quiz, *pretérito perfecto*) says what you “have done”. Use *he*, *has*, *ha*, *hemos*, *han* (*habéis* for *vosotros*) plus the past participle.',
            es: 'El pretérito perfecto dice lo que *has hecho*. Usa *he*, *has*, *ha*, *hemos*, *han* (*habéis* con *vosotros*) más el participio.',
          },
        },
        {
          kind: 'paradigm',
          tense: 'presentPerfect',
          entries: ['hablar', 'comer', 'vivir'],
          caption: { en: 'Only *haber* changes. The participle stays the same.', es: 'Solo cambia *haber*. El participio se queda igual.' },
        },
        {
          kind: 'list',
          items: [
            {
              en: 'Use it for something that just happened, or that happened in a time that isn’t over yet (today, this week, this year).',
              es: 'Úsalo para algo que acaba de pasar, o que pasó en un tiempo que todavía no termina (hoy, esta semana, este año).',
            },
            {
              en: 'Use it for experiences: what you have (or have never) done in your life.',
              es: 'Úsalo para las experiencias: lo que has hecho (o nunca has hecho) en tu vida.',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Hoy *hemos estudiado* mucho.', en: 'We have studied a lot today.', check: [{ entry: 'estudiar', tense: 'presentPerfect', person: 'nosotros' }] },
            { es: 'Mi hermano *ha comido* toda la pizza.', en: 'My brother has eaten all the pizza.', check: [{ entry: 'comer', tense: 'presentPerfect', person: 'el' }] },
            { es: '¿Alguna vez *has probado* el pozole?', en: 'Have you ever tried pozole?', check: [{ entry: 'probar', tense: 'presentPerfect', person: 'tu' }] },
            { es: 'Nunca *he ido* a España.', en: 'I have never been to Spain.', check: [{ entry: 'ir', tense: 'presentPerfect', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'In much of Latin America, people often use the simple past (preterite) for what just happened: *Hoy comí tacos* (“I ate tacos today”). Both are correct. The quiz tells you which tense it wants.',
            es: 'En gran parte de Latinoamérica se usa mucho el pretérito para lo que acaba de pasar: Hoy *comí* tacos. Las dos formas son correctas. La práctica te dice qué tiempo verbal quiere.',
          },
        },
      ],
      keyIdea: {
        en: '*he*, *has*, *ha*, *hemos*, *han* + past participle = “have done”.',
        es: '*he*, *has*, *ha*, *hemos*, *han* + participio = lo que *has hecho*.',
      },
    },
    {
      id: 'perfect-pluperfect',
      title: { en: 'Pluperfect: “had done”', es: 'Pluscuamperfecto: “había hecho”' },
      when: { tense: 'pluperfect' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The pluperfect (*pluscuamperfecto*) says what you “had done”: something that happened before another moment in the past. Use *había*, *habías*, *había*, *habíamos*, *habían* (*habíais* for *vosotros*) plus the past participle.',
            es: 'El pluscuamperfecto dice lo que *habías hecho*: algo que pasó antes de otro momento del pasado. Usa *había*, *habías*, *había*, *habíamos*, *habían* (*habíais* con *vosotros*) más el participio.',
          },
        },
        {
          kind: 'paradigm',
          tense: 'pluperfect',
          entries: ['hablar', 'comer', 'vivir'],
          caption: { en: 'Every form of *haber* here has an accent on the *í*.', es: 'Todas estas formas de *haber* llevan acento en la *í*.' },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Cuando llegué, la clase ya *había empezado*.', en: 'When I arrived, class had already started.', check: [{ entry: 'empezar', tense: 'pluperfect', person: 'el' }] },
            { es: 'Mis amigos ya *habían comido* cuando llamamos.', en: 'My friends had already eaten when we called.', check: [{ entry: 'comer', tense: 'pluperfect', person: 'ellos' }] },
            { es: 'Nunca *había nadado* en el mar antes de ese verano.', en: 'I had never swum in the ocean before that summer.', check: [{ entry: 'nadar', tense: 'pluperfect', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Picture two moments in the past. The pluperfect is the one that came first: the class started (first), then I arrived.',
            es: 'Piensa en dos momentos del pasado. El pluscuamperfecto es el que pasó primero: la clase empezó (primero) y después yo llegué.',
          },
        },
      ],
      keyIdea: {
        en: '*había*, *habías*, *había*, *habíamos*, *habían* + past participle = “had done”.',
        es: '*había*, *habías*, *había*, *habíamos*, *habían* + participio = lo que *habías hecho*.',
      },
    },
    irregularParticiples('perfect-irregular', 'presentPerfect', { pattern: 'participle', tense: 'presentPerfect' }, [
      { es: '¿Qué *has hecho* hoy?', en: 'What have you done today?', check: [{ entry: 'hacer', tense: 'presentPerfect', person: 'tu' }] },
      { es: 'Mi abuela *ha escrito* un libro.', en: 'My grandma has written a book.', check: [{ entry: 'escribir', tense: 'presentPerfect', person: 'el' }] },
      { es: 'Todavía no *he visto* esa película.', en: 'I still haven’t seen that movie.', check: [{ entry: 'ver', tense: 'presentPerfect', person: 'yo' }] },
    ]),
    irregularParticiples(
      'perfect-irregular-pluperfect',
      'pluperfect',
      { all: [{ pattern: 'participle', tense: 'pluperfect' }, { not: { tense: 'presentPerfect' } }] },
      [
        { es: 'Él no *había dicho* nada.', en: 'He hadn’t said anything.', check: [{ entry: 'decir', tense: 'pluperfect', person: 'el' }] },
        { es: 'Mis papás ya *habían puesto* la mesa.', en: 'My parents had already set the table.', check: [{ entry: 'poner', tense: 'pluperfect', person: 'ellos' }] },
        { es: 'Nunca *había visto* el mar.', en: 'I had never seen the ocean.', check: [{ entry: 'ver', tense: 'pluperfect', person: 'yo' }] },
      ],
      { en: 'Irregular past participles (pluperfect)', es: 'Participios irregulares (pluscuamperfecto)' },
    ),
    {
      id: 'perfect-together',
      title: { en: '*Haber* and the participle stay together', es: 'Haber y el participio van juntos' },
      blocks: [
        {
          kind: 'list',
          items: [
            {
              en: 'After *haber*, the past participle never changes: it always ends in *-o*, whoever did it. Only *haber* changes.',
              es: 'Después de *haber*, el participio nunca cambia: siempre termina en *-o*, sin importar quién lo hizo. Solo cambia *haber*.',
            },
            {
              en: 'Nothing goes between the two. *No* goes in front of *haber*.',
              es: 'No se pone nada entre los dos. El *no* va antes de *haber*.',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            {
              es: 'Ella *ha comido*. Ellas *han comido*.',
              en: 'She has eaten. They have eaten.',
              check: [{ entry: 'comer', tense: 'presentPerfect', person: 'el' }, { entry: 'comer', tense: 'presentPerfect', person: 'ellos' }],
            },
            { es: 'No *he terminado* la tarea.', en: 'I haven’t finished the homework.', check: [{ entry: 'terminar', tense: 'presentPerfect', person: 'yo' }] },
            { es: 'Todavía no *habíamos llegado*.', en: 'We hadn’t arrived yet.', check: [{ entry: 'llegar', tense: 'pluperfect', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Only *haber* changes, and nothing comes between it and the participle.',
        es: 'Solo cambia *haber*, y nada va entre *haber* y el participio.',
      },
    },
    {
      id: 'perfect-pronouns',
      title: { en: '*-se* verbs: the pronoun goes first', es: 'Verbos con -se: el pronombre va primero' },
      when: { kind: 'pronominal' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'With a verb like *levantarse*, the reflexive pronoun (*me*, *te*, *se*, *nos*, *se*) goes before *haber*, never between *haber* and the participle.',
            es: 'Con un verbo como *levantarse*, el pronombre reflexivo (*me*, *te*, *se*, *nos*, *se*) va antes de *haber*, nunca entre *haber* y el participio.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Hoy *me he despertado* tarde.', en: 'I woke up late today.', check: [{ entry: 'despertarse', tense: 'presentPerfect', person: 'yo' }] },
            { es: '¿*Te has lavado* las manos?', en: 'Have you washed your hands?', check: [{ entry: 'lavarse', tense: 'presentPerfect', person: 'tu' }] },
            { es: 'Ya *nos habíamos dormido* cuando llamaste.', en: 'We had already fallen asleep when you called.', check: [{ entry: 'dormirse', tense: 'pluperfect', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Pronoun, then *haber*, then the past participle: *te has lavado*.',
        es: 'Pronombre, luego *haber*, luego el participio: *te has lavado*.',
      },
    },
    {
      id: 'perfect-impersonal',
      title: { en: '*Hay* and weather verbs', es: 'Hay y los verbos del clima' },
      when: { kind: 'impersonal' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Verbs with no person, like *hay* (from *haber*) and weather verbs like *llover*, use only *ha* and *había*. So *hay* becomes *ha habido* (“there has been”) and *había habido* (“there had been”). It stays singular, even for many things.',
            es: 'Los verbos sin persona, como *hay* (de *haber*) y los verbos del clima como *llover*, usan solo *ha* y *había*. Así, *hay* se vuelve *ha habido* y *había habido*. Se queda en singular, aunque sean muchas cosas.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Ha habido* muchos exámenes esta semana.', en: 'There have been a lot of tests this week.', check: [{ entry: 'haber-impersonal', tense: 'presentPerfect', person: 'el' }] },
            { es: 'Nunca *había habido* tanta gente aquí.', en: 'There had never been so many people here.', check: [{ entry: 'haber-impersonal', tense: 'pluperfect', person: 'el' }] },
            { es: 'Este mes *ha llovido* mucho.', en: 'It has rained a lot this month.', check: [{ entry: 'llover', tense: 'presentPerfect', person: 'el' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*hay* → *ha habido*, *había habido*: never plural (not *han habido*).',
        es: '*hay* → *ha habido*, *había habido*: nunca en plural (no *han habido*).',
      },
    },
  ],
};

const subjunctive: Chapter = {
  id: 'subjunctive',
  title: { en: 'The subjunctive (*subjuntivo*)', es: 'El subjuntivo' },
  summary: {
    en: 'A mood for wishes, feelings, advice and doubt, usually after *que*.',
    es: 'Un modo para deseos, emociones, consejos y dudas, casi siempre después de *que*.',
  },
  when: { any: [{ tense: 'presentSubjunctive' }, { tense: 'imperfectSubjunctive' }] },
  sections: [
    {
      id: 'subjunctive-mood',
      title: { en: 'Not a tense: a mood', es: 'No es un tiempo verbal: es un modo' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A tense tells when something happens. A mood tells how the speaker sees it. The forms you already know, like the present tense, are the indicative mood: they state facts. The subjunctive mood is for things that are not plain facts: what someone wants, feels, advises or doubts.',
            es: 'El tiempo verbal dice cuándo pasa algo. El modo dice cómo lo ve quien habla. Las formas que ya conoces, como el presente, son del modo indicativo: dicen hechos. El modo subjuntivo es para lo que no es un simple hecho: lo que alguien quiere, siente, aconseja o duda.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'A fact (indicative)', es: 'Un hecho (indicativo)' }, { en: 'Not a fact (subjunctive)', es: 'No es un hecho (subjuntivo)' }],
          rows: [
            [
              { en: 'Sé que *vienes*. (“I know you’re coming.”)', es: 'Sé que *vienes*.' },
              { en: 'Quiero que *vengas*. (“I want you to come.”)', es: 'Quiero que *vengas*.' },
            ],
            [
              { en: 'Es verdad que *estudias*. (“It’s true that you study.”)', es: 'Es verdad que *estudias*.' },
              { en: 'Es importante que *estudies*. (“It’s important that you study.”)', es: 'Es importante que *estudies*.' },
            ],
            [
              { en: 'Creo que *está* en casa. (“I think he’s home.”)', es: 'Creo que *está* en casa.' },
              { en: 'No creo que *esté* en casa. (“I don’t think he’s home.”)', es: 'No creo que *esté* en casa.' },
            ],
          ],
        },
      ],
      keyIdea: {
        en: 'Indicative: facts. Subjunctive: wishes, feelings, advice and doubts.',
        es: 'Indicativo: hechos. Subjuntivo: deseos, emociones, consejos y dudas.',
      },
    },
    {
      id: 'subjunctive-que',
      title: { en: 'Two parts, joined by *que*', es: 'Dos partes unidas por que' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A subjunctive sentence usually has two parts, each with its own person. The first part wants, feels, advises or doubts: it’s the trigger. Then comes *que*, and the verb of the second part goes in the subjunctive.',
            es: 'Una oración con subjuntivo casi siempre tiene dos partes, cada una con su propia persona. La primera parte quiere, siente, aconseja o duda: es la que pide el subjuntivo. Luego viene *que*, y el verbo de la segunda parte va en subjuntivo.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Quiero que *vengas* a mi fiesta.', en: 'I want you to come to my party.', check: [{ entry: 'venir', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Espero que *tengas* un buen día.', en: 'I hope you have a good day.', check: [{ entry: 'tener', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Es importante que *estudies*.', en: 'It’s important that you study.', check: [{ entry: 'estudiar', tense: 'presentSubjunctive', person: 'tu' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Same person in both parts? Skip *que* and use the dictionary form (infinitive): *Quiero ir* (“I want to go”: I want, I go), but *Quiero que vayas* (“I want you to go”: I want, you go).',
            es: 'Si la persona es la misma en las dos partes, no uses *que*: usa la forma de diccionario (infinitivo). Quiero *ir* (yo quiero, yo voy), pero Quiero que *vayas* (yo quiero, tú vas).',
          },
        },
      ],
      keyIdea: {
        en: 'Trigger + *que* + a different person → subjunctive.',
        es: 'Expresión que pide el subjuntivo + *que* + otra persona → subjuntivo.',
      },
    },
    {
      id: 'subjunctive-weirdo',
      title: { en: 'When to use it: WEIRDO', es: 'Cuándo se usa: WEIRDO' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Many students remember the triggers with the word WEIRDO:',
            es: 'Muchos estudiantes recuerdan las expresiones que piden el subjuntivo con la palabra WEIRDO (sus iniciales en inglés):',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'W, Wishes: *querer que*, *esperar que*, *preferir que*', es: 'W, deseos: *querer que*, *esperar que*, *preferir que*' },
            { en: 'E, Emotions: *me alegra que* (“I’m glad that”), *tener miedo de que*', es: 'E, emociones: *me alegra que*, *tener miedo de que*' },
            {
              en: 'I, Impersonal expressions (“it’s … that”) of opinion or need: *es importante que*, *es necesario que*, *es mejor que*. But *es verdad que* states a fact: indicative.',
              es: 'I, expresiones impersonales (con *es*) de opinión o necesidad: *es importante que*, *es necesario que*, *es mejor que*. Pero *es verdad que* dice un hecho: indicativo.',
            },
            { en: 'R, Recommendations and requests: *recomendar que*, *pedir que*', es: 'R, recomendaciones y pedidos: *recomendar que*, *pedir que*' },
            { en: 'D, Doubt and denial: *dudar que*, *no creer que*', es: 'D, duda y negación: *dudar que*, *no creer que*' },
            { en: 'O, *Ojalá* (“I hope”, “if only”)', es: 'O, *ojalá*' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Me alegra que *estés* aquí.', en: 'I’m glad you’re here.', check: [{ entry: 'estar', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Mi mamá me pide que *limpie* mi cuarto.', en: 'My mom asks me to clean my room.', check: [{ entry: 'limpiar', tense: 'presentSubjunctive', person: 'yo' }] },
            { es: 'Dudo que *llueva* mañana.', en: 'I doubt it will rain tomorrow.', check: [{ entry: 'llover', tense: 'presentSubjunctive', person: 'el' }] },
            { es: 'Ojalá que *ganemos* el partido.', en: 'I hope we win the game.', check: [{ entry: 'ganar', tense: 'presentSubjunctive', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Wishes, Emotions, Impersonal expressions, Recommendations, Doubt, *Ojalá*.',
        es: 'Deseos, emociones, expresiones impersonales, recomendaciones, dudas y *ojalá*.',
      },
    },
    {
      id: 'subjunctive-present',
      title: { en: 'Present subjunctive: the “opposite” vowel', es: 'Presente de subjuntivo: la vocal “contraria”' },
      when: { tense: 'presentSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: { en: 'In the quiz, it’s *presente de subjuntivo*. To build it:', es: 'Para formar el presente de subjuntivo:' },
        },
        {
          kind: 'list',
          items: [
            { en: 'Start from the *yo* form of the present: *hablo*, *como*, *vivo*.', es: 'Empieza con la forma de *yo* del presente: *hablo*, *como*, *vivo*.' },
            { en: 'Drop the *-o*: *habl-*, *com-*, *viv-*.', es: 'Quita la *-o*: *habl-*, *com-*, *viv-*.' },
            {
              en: 'Add the endings with the “opposite” vowel: *-ar* verbs take *e*; *-er* and *-ir* verbs take *a*.',
              es: 'Agrega las terminaciones con la vocal “contraria”: los verbos en *-ar* llevan *e*; los verbos en *-er* e *-ir* llevan *a*.',
            },
          ],
        },
        {
          kind: 'paradigm',
          tense: 'presentSubjunctive',
          entries: ['hablar', 'comer', 'vivir'],
          caption: {
            en: 'The *yo* and *él / ella / usted* forms are the same: *hable*, *coma*, *viva*.',
            es: 'Las formas de *yo* y de *él / ella / usted* son iguales: *hable*, *coma*, *viva*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Espero que *hables* con ella.', en: 'I hope you talk to her.', check: [{ entry: 'hablar', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Es necesario que *comamos* bien.', en: 'We need to eat well.', check: [{ entry: 'comer', tense: 'presentSubjunctive', person: 'nosotros' }] },
            { es: 'Mis papás quieren que yo *viva* cerca.', en: 'My parents want me to live nearby.', check: [{ entry: 'vivir', tense: 'presentSubjunctive', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Negative commands (*no hables*) and *usted* commands (*hable*) borrow these same forms.',
            es: 'Los mandatos negativos (*no hables*) y los de *usted* (*hable*) usan estas mismas formas.',
          },
        },
      ],
      keyIdea: {
        en: '*Yo* present, drop the *-o*, add the opposite vowel: *-ar* → *e*, *-er* and *-ir* → *a*.',
        es: 'Forma de *yo* del presente, sin la *-o*, más la vocal contraria: *-ar* → *e*; *-er* e *-ir* → *a*.',
      },
    },
    {
      id: 'subjunctive-yo',
      title: { en: 'Irregular *yo* forms carry over', es: 'Las formas irregulares de yo pasan al subjuntivo' },
      // In the present subjunctive the engine tags tenga, haga, vea 'irregular' (every person
      // changes), never 'yo'; the six of DISHES are 'irregular' there too.
      when: {
        all: [
          { tense: 'presentSubjunctive' },
          { any: [{ pattern: 'irregular', tense: 'presentSubjunctive' }, { pattern: 'yo', tense: 'present' }] },
        ],
      },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Because you start from the *yo* form, an irregular *yo* form carries into every person of the subjunctive: *tengo* → *tenga*, *tengas*, *tengamos*, *tengan*.',
            es: 'Como empiezas con la forma de *yo*, si esa forma es irregular, lo irregular pasa a todas las personas del subjuntivo: *tengo* → *tenga*, *tengas*, *tengamos*, *tengan*.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Present (*yo*)', es: 'Presente (*yo*)' }, { en: 'Present subjunctive', es: 'Presente de subjuntivo' }],
          rows: [
            [{ en: '*tengo*', es: '*tengo*' }, { en: '*tenga*', es: '*tenga*' }],
            [{ en: '*hago*', es: '*hago*' }, { en: '*haga*', es: '*haga*' }],
            [{ en: '*conozco*', es: '*conozco*' }, { en: '*conozca*', es: '*conozca*' }],
            [{ en: '*salgo*', es: '*salgo*' }, { en: '*salga*', es: '*salga*' }],
            [{ en: '*digo*', es: '*digo*' }, { en: '*diga*', es: '*diga*' }],
            [{ en: '*veo*', es: '*veo*' }, { en: '*vea*', es: '*vea*' }],
          ],
        },
        {
          kind: 'deckVerbs',
          tense: 'presentSubjunctive',
          pattern: 'irregular',
          withTables: true,
          text: {
            en: 'In this deck, irregular in the present subjunctive (from an irregular *yo* form, or one of the six to memorize: *dar*, *ir*, *ser*, *haber*, *estar*, *saber*):',
            es: 'En este mazo, irregulares en el presente de subjuntivo (por una forma de *yo* irregular, o uno de los seis de memoria: *dar*, *ir*, *ser*, *haber*, *estar*, *saber*):',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Es mejor que *hagamos* la tarea ahora.', en: 'It’s better if we do the homework now.', check: [{ entry: 'hacer', tense: 'presentSubjunctive', person: 'nosotros' }] },
            { es: 'Ojalá que *conozcas* a mi abuela pronto.', en: 'I hope you meet my grandma soon.', check: [{ entry: 'conocer', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Mi papá no quiere que *salga* esta noche.', en: 'My dad doesn’t want me to go out tonight.', check: [{ entry: 'salir', tense: 'presentSubjunctive', person: 'yo' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*tengo* → *tenga*, *hago* → *haga*: the *yo* form decides.',
        es: '*tengo* → *tenga*, *hago* → *haga*: manda la forma de *yo*.',
      },
    },
    {
      id: 'subjunctive-stem',
      title: { en: 'Stem-changing verbs (boot verbs)', es: 'Verbos con cambio de raíz (verbos bota)' },
      when: { pattern: 'stem', tense: 'presentSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Stem changes are the same as in the present. They happen in the same persons, the ones inside the “boot”: every person but *nosotros* and *vosotros*.',
            es: 'Los cambios de raíz son los mismos que en el presente. Pasan en las mismas personas, las que están dentro de la “bota”: todas menos *nosotros* y *vosotros*.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*querer*: *quiera*, *quieras*, *quiera*, *queramos*, *quieran*', es: '*querer*: *quiera*, *quieras*, *quiera*, *queramos*, *quieran*' },
            { en: '*poder*: *pueda*, *puedas*, *pueda*, *podamos*, *puedan*', es: '*poder*: *pueda*, *puedas*, *pueda*, *podamos*, *puedan*' },
            {
              en: 'Boot verbs that end in *-ir* also change in *nosotros* (and *vosotros*): *e* → *i*, *o* → *u*. So *sentir* → *sintamos*, *dormir* → *durmamos*, *pedir* → *pidamos*.',
              es: 'Los verbos bota en *-ir* también cambian en *nosotros* (y *vosotros*): *e* → *i*, *o* → *u*. Así, *sentir* → *sintamos*, *dormir* → *durmamos*, *pedir* → *pidamos*.',
            },
          ],
        },
        { kind: 'deckVerbs', tense: 'presentSubjunctive', pattern: 'stem', withTables: true, text: { en: 'In this deck:', es: 'En este mazo:' } },
        {
          kind: 'examples',
          items: [
            { es: 'Ojalá que *puedas* venir.', en: 'I hope you can come.', check: [{ entry: 'poder', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Es mejor que *pidamos* una pizza.', en: 'It’s better if we order a pizza.', check: [{ entry: 'pedir', tense: 'presentSubjunctive', person: 'nosotros' }] },
            { es: 'Quiero que *duermas* bien.', en: 'I want you to sleep well.', check: [{ entry: 'dormir', tense: 'presentSubjunctive', person: 'tu' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Same stem change as the present. Boot verbs in *-ir* also change in *nosotros*: *pidamos*, *durmamos*.',
        es: 'El mismo cambio de raíz que en el presente. Los verbos bota en *-ir* también cambian en *nosotros*: *pidamos*, *durmamos*.',
      },
    },
    {
      id: 'subjunctive-spelling',
      title: { en: 'Spelling changes: *busque*, *llegue*, *empiece*', es: 'Cambios de ortografía: *busque*, *llegue*, *empiece*' },
      when: { pattern: 'spelling', tense: 'presentSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some verbs change a letter to keep the sound of the dictionary form. Verbs ending in *-car*, *-gar* and *-zar* change it before the *e*:',
            es: 'Algunos verbos cambian una letra para conservar el sonido de la forma de diccionario. Los verbos que terminan en *-car*, *-gar* y *-zar* la cambian antes de la *e*:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*c* → *qu*: *buscar* → *busque*', es: '*c* → *qu*: *buscar* → *busque*' },
            { en: '*g* → *gu*: *llegar* → *llegue*', es: '*g* → *gu*: *llegar* → *llegue*' },
            { en: '*z* → *c*: *empezar* → *empiece*', es: '*z* → *c*: *empezar* → *empiece*' },
            {
              en: 'A *yo* form that already changes a letter keeps the change: *escojo* → *escoja*, *sigo* → *siga*, *venzo* → *venza*.',
              es: 'Si la forma de *yo* ya cambia una letra, el cambio se queda: *escojo* → *escoja*, *sigo* → *siga*, *venzo* → *venza*.',
            },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'If you know the preterite, *-car*, *-gar* and *-zar* verbs make the same change in its *yo* form: *busqué*, *llegué*, *empecé*.',
            es: 'Si ya conoces el pretérito, los verbos en *-car*, *-gar* y *-zar* hacen el mismo cambio en su forma de *yo*: *busqué*, *llegué*, *empecé*.',
          },
        },
        { kind: 'deckVerbs', tense: 'presentSubjunctive', pattern: 'spelling', withTables: true, text: { en: 'In this deck:', es: 'En este mazo:' } },
        {
          kind: 'examples',
          items: [
            { es: 'Mi mamá quiere que *busque* trabajo.', en: 'My mom wants me to look for a job.', check: [{ entry: 'buscar', tense: 'presentSubjunctive', person: 'yo' }] },
            { es: 'Espero que *lleguen* a tiempo.', en: 'I hope they arrive on time.', check: [{ entry: 'llegar', tense: 'presentSubjunctive', person: 'ellos' }] },
            { es: 'Es mejor que *empecemos* ya.', en: 'It’s better if we start now.', check: [{ entry: 'empezar', tense: 'presentSubjunctive', person: 'nosotros' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*-car* → *-que*, *-gar* → *-gue*, *-zar* → *-ce*.',
        es: '*-car* → *-que*, *-gar* → *-gue*, *-zar* → *-ce*.',
      },
    },
    {
      id: 'subjunctive-dishes',
      title: { en: 'Six to memorize: DISHES', es: 'Seis de memoria: DISHES' },
      // By name, not only by the 'irregular' pattern: a verb whose subjunctive comes from an
      // irregular yo form (tenga) must not open "six to memorize" on its own.
      when: {
        all: [
          { pattern: 'irregular', tense: 'presentSubjunctive' },
          { any: DISHES.map((verb) => ({ verb })) },
        ],
      },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Six verbs don’t start from the *yo* form. Remember them with the word DISHES:',
            es: 'Seis verbos no salen de la forma de *yo*. Recuérdalos con la palabra DISHES:',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Dictionary form', es: 'Forma de diccionario' }, { en: 'Present subjunctive (*yo*)', es: 'Presente de subjuntivo (*yo*)' }],
          rows: [
            [{ en: 'D: *dar*', es: 'D: *dar*' }, { en: '*dé*', es: '*dé*' }],
            [{ en: 'I: *ir*', es: 'I: *ir*' }, { en: '*vaya*', es: '*vaya*' }],
            [{ en: 'S: *ser*', es: 'S: *ser*' }, { en: '*sea*', es: '*sea*' }],
            [{ en: 'H: *haber* (*hay*)', es: 'H: *haber* (*hay*)' }, { en: '*haya*', es: '*haya*' }],
            [{ en: 'E: *estar*', es: 'E: *estar*' }, { en: '*esté*', es: '*esté*' }],
            [{ en: 'S: *saber*', es: 'S: *saber*' }, { en: '*sepa*', es: '*sepa*' }],
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Watch the accents: *dé* is not *de* (“of”), and *esté* is not *este* (“this”).',
            es: 'Ojo con los acentos: *dé* no es *de*, y *esté* no es *este*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Espero que tu familia *esté* bien.', en: 'I hope your family is doing well.', check: [{ entry: 'estar', tense: 'presentSubjunctive', person: 'el' }] },
            { es: 'Es importante que *seas* amable.', en: 'It’s important for you to be kind.', check: [{ entry: 'ser', tense: 'presentSubjunctive', person: 'tu' }] },
            { es: 'Quiero que *vayamos* a la playa.', en: 'I want us to go to the beach.', check: [{ entry: 'ir', tense: 'presentSubjunctive', person: 'nosotros' }] },
            { es: 'Ojalá que *haya* pizza en la fiesta.', en: 'I hope there’s pizza at the party.', check: [{ entry: 'haber-impersonal', tense: 'presentSubjunctive', person: 'el' }] },
          ],
        },
      ],
      keyIdea: {
        en: '*dé*, *vaya*, *sea*, *haya*, *esté*, *sepa*: learn these six by heart.',
        es: '*dé*, *vaya*, *sea*, *haya*, *esté*, *sepa*: apréndelas de memoria.',
      },
    },
    {
      id: 'subjunctive-vos',
      title: { en: '*Vos* in the subjunctive', es: 'Vos en el subjuntivo' },
      when: { all: [{ vos: true }, { tense: 'presentSubjunctive' }] },
      blocks: [
        {
          kind: 'list',
          items: [
            {
              en: 'Present subjunctive: the region decides. In the Río de la Plata (Argentina, Uruguay), *que hables* is the standard form, and *que hablés* is common in speech. In Central America, *que hablés* is usual, and *que hables* is heard too. The quiz accepts both.',
              es: 'Presente de subjuntivo: depende de la región. En el Río de la Plata (Argentina, Uruguay), la forma estándar es *que hables*, y *que hablés* es común al hablar. En Centroamérica lo normal es *que hablés*, y también se oye *que hables*. La práctica acepta las dos.',
            },
            {
              en: 'In forms like *hablés*, the stress moves to the ending, so the stem is the one of *nosotros*: *querás* (*queramos*), *podás* (*podamos*), *durmás* (*durmamos*).',
              es: 'En las formas como *hablés*, la sílaba fuerte es la terminación, así que la raíz es la de *nosotros*: *querás* (*queramos*), *podás* (*podamos*), *durmás* (*durmamos*).',
            },
            {
              en: 'Imperfect subjunctive: *vos* uses the *tú* form (*hablaras*).',
              es: 'Imperfecto de subjuntivo: *vos* usa la forma de *tú* (*hablaras*).',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            {
              es: 'Quiero que *vengás* a mi casa.',
              en: 'I want you to come to my house. (Central America)',
              check: [{ entry: 'venir', tense: 'presentSubjunctive', person: 'vos', vosRegion: 'centroamericano' }],
            },
            {
              es: 'Ojalá que *puedas* venir.',
              en: 'I hope you can come. (Río de la Plata)',
              check: [{ entry: 'poder', tense: 'presentSubjunctive', person: 'vos', vosRegion: 'rioplatense' }],
            },
          ],
        },
      ],
      keyIdea: {
        en: 'Both *que hables* and *que hablés* are right. Your region decides which one you hear more.',
        es: 'Tanto *que hables* como *que hablés* son correctas. La región decide cuál se oye más.',
      },
    },
    {
      id: 'subjunctive-imperfect',
      title: { en: 'Imperfect subjunctive: from the *ellos* preterite', es: 'Imperfecto de subjuntivo: sale del pretérito de ellos' },
      when: { tense: 'imperfectSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: { en: 'In the quiz, it’s *imperfecto de subjuntivo*. To build it:', es: 'Para formar el imperfecto de subjuntivo:' },
        },
        {
          kind: 'list',
          items: [
            {
              en: 'Take the *ellos* form of the preterite: *hablaron*, *comieron*, *tuvieron*, *fueron*.',
              es: 'Toma la forma de *ellos* del pretérito: *hablaron*, *comieron*, *tuvieron*, *fueron*.',
            },
            { en: 'Drop *-ron*: *habla-*, *comie-*, *tuvie-*, *fue-*.', es: 'Quita *-ron*: *habla-*, *comie-*, *tuvie-*, *fue-*.' },
            {
              en: 'Add *-ra*, *-ras*, *-ra*, *-ramos*, *-ran* (*-rais* for *vosotros*). The *nosotros* form gets an accent on the vowel before *-ramos*: *habláramos*, *tuviéramos*.',
              es: 'Agrega *-ra*, *-ras*, *-ra*, *-ramos*, *-ran* (*-rais* con *vosotros*). La forma de *nosotros* lleva acento en la vocal antes de *-ramos*: *habláramos*, *tuviéramos*.',
            },
          ],
        },
        { kind: 'paradigm', tense: 'imperfectSubjunctive', entries: ['hablar', 'comer', 'vivir'] },
        {
          kind: 'examples',
          items: [
            { es: 'Mi mamá quería que *limpiara* mi cuarto.', en: 'My mom wanted me to clean my room.', check: [{ entry: 'limpiar', tense: 'imperfectSubjunctive', person: 'yo' }] },
            { es: 'Era importante que *estudiáramos*.', en: 'It was important for us to study.', check: [{ entry: 'estudiar', tense: 'imperfectSubjunctive', person: 'nosotros' }] },
            { es: 'Ojalá *fuera* viernes.', en: 'I wish it were Friday.', check: [{ entry: 'ser', tense: 'imperfectSubjunctive', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'There is a second set of endings with *-se*: *hablase*, *comiese*, *hablásemos*. They mean the same thing, you’ll see them more in Spain and in books, and the quiz accepts them too.',
            es: 'Hay otra serie de terminaciones, con *-se*: *hablase*, *comiese*, *hablásemos*. Significan lo mismo, se ven más en España y en los libros, y la práctica también las acepta.',
          },
        },
      ],
      keyIdea: {
        en: '*Ellos* preterite, minus *-ron*, plus *-ra*: *hablaron* → *hablara*, *tuvieron* → *tuviera*.',
        es: 'Pretérito de *ellos*, sin *-ron*, más *-ra*: *hablaron* → *hablara*, *tuvieron* → *tuviera*.',
      },
    },
    {
      id: 'subjunctive-imperfect-preterite',
      title: { en: 'Preterite changes carry over', es: 'Los cambios del pretérito pasan al subjuntivo' },
      when: {
        any: [
          { pattern: 'irregular', tense: 'imperfectSubjunctive' },
          { pattern: 'stem', tense: 'imperfectSubjunctive' },
          { pattern: 'spelling', tense: 'imperfectSubjunctive' },
        ],
      },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Since it starts from the preterite, every change in the *ellos* preterite carries over:',
            es: 'Como sale del pretérito, cada cambio del pretérito de *ellos* pasa también al imperfecto de subjuntivo:',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'Preterite (*ellos*)', es: 'Pretérito (*ellos*)' }, { en: 'Imperfect subjunctive (*yo*)', es: 'Imperfecto de subjuntivo (*yo*)' }],
          rows: [
            [{ en: '*tuvieron* (*tener*)', es: '*tuvieron* (*tener*)' }, { en: '*tuviera*', es: '*tuviera*' }],
            [{ en: '*fueron* (*ser*, *ir*)', es: '*fueron* (*ser*, *ir*)' }, { en: '*fuera*', es: '*fuera*' }],
            [{ en: '*hicieron* (*hacer*)', es: '*hicieron* (*hacer*)' }, { en: '*hiciera*', es: '*hiciera*' }],
            [{ en: '*dijeron* (*decir*)', es: '*dijeron* (*decir*)' }, { en: '*dijera*', es: '*dijera*' }],
            [{ en: '*pidieron* (*pedir*)', es: '*pidieron* (*pedir*)' }, { en: '*pidiera*', es: '*pidiera*' }],
            [{ en: '*durmieron* (*dormir*)', es: '*durmieron* (*dormir*)' }, { en: '*durmiera*', es: '*durmiera*' }],
            [{ en: '*leyeron* (*leer*)', es: '*leyeron* (*leer*)' }, { en: '*leyera*', es: '*leyera*' }],
          ],
        },
        { kind: 'deckVerbs', tense: 'imperfectSubjunctive', pattern: 'irregular', withTables: true, text: { en: 'In this deck, from an irregular preterite:', es: 'En este mazo, de un pretérito irregular:' } },
        { kind: 'deckVerbs', tense: 'imperfectSubjunctive', pattern: 'stem', withTables: true, text: { en: 'In this deck, with a stem change:', es: 'En este mazo, con cambio de raíz:' } },
        { kind: 'deckVerbs', tense: 'imperfectSubjunctive', pattern: 'spelling', withTables: true, text: { en: 'In this deck, with a spelling change:', es: 'En este mazo, con cambio de ortografía:' } },
      ],
      keyIdea: {
        en: 'An irregular preterite gives an irregular imperfect subjunctive: *tuvieron* → *tuviera*.',
        es: 'Un pretérito irregular da un imperfecto de subjuntivo irregular: *tuvieron* → *tuviera*.',
      },
    },
    {
      id: 'subjunctive-imperfect-uses',
      title: { en: 'When to use the imperfect subjunctive', es: 'Cuándo se usa el imperfecto de subjuntivo' },
      when: { tense: 'imperfectSubjunctive' },
      blocks: [
        {
          kind: 'list',
          items: [
            { en: 'After a trigger in the past: the same WEIRDO triggers, told in the past.', es: 'Después de una expresión en pasado: las mismas de WEIRDO, pero en pasado.' },
            { en: 'To be polite: *Quisiera…* (“I would like…”).', es: 'Para pedir algo con cortesía: *Quisiera…*' },
            {
              en: 'With *ojalá*, for a wish that probably won’t come true: *Ojalá tuviera un perro* (“I wish I had a dog”).',
              es: 'Con *ojalá*, para un deseo que probablemente no se va a cumplir: Ojalá *tuviera* un perro.',
            },
          ],
        },
        {
          kind: 'compare',
          head: [{ en: 'Trigger in the present', es: 'Expresión en presente' }, { en: 'Trigger in the past', es: 'Expresión en pasado' }],
          rows: [
            [{ en: 'Quiero que *vengas*.', es: 'Quiero que *vengas*.' }, { en: 'Quería que *vinieras*.', es: 'Quería que *vinieras*.' }],
            [{ en: 'Es importante que *estudies*.', es: 'Es importante que *estudies*.' }, { en: 'Era importante que *estudiaras*.', es: 'Era importante que *estudiaras*.' }],
            [{ en: 'Me pide que *llame*.', es: 'Me pide que *llame*.' }, { en: 'Me pidió que *llamara*.', es: 'Me pidió que *llamara*.' }],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Quería que *vinieras* a mi fiesta.', en: 'I wanted you to come to my party.', check: [{ entry: 'venir', tense: 'imperfectSubjunctive', person: 'tu' }] },
            { es: '*Quisiera* un vaso de agua, por favor.', en: 'I would like a glass of water, please.', check: [{ entry: 'querer', tense: 'imperfectSubjunctive', person: 'yo' }] },
            { es: 'Ojalá *tuviera* más tiempo.', en: 'I wish I had more time.', check: [{ entry: 'tener', tense: 'imperfectSubjunctive', person: 'yo' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Trigger in the past → imperfect subjunctive: *Quería que vinieras*.',
        es: 'Expresión en pasado → imperfecto de subjuntivo: Quería que *vinieras*.',
      },
    },
    {
      id: 'subjunctive-si',
      title: { en: '“If I had…, I would…”', es: '“Si tuviera…, haría…”' },
      when: { all: [{ tense: 'imperfectSubjunctive' }, { tense: 'conditional' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'To talk about something that isn’t true now, or probably won’t happen, use *si* (“if”) plus the imperfect subjunctive, then the conditional (the “would” form). The two halves can go in either order.',
            es: 'Para hablar de algo que no es verdad ahora, o que probablemente no va a pasar, usa *si* más el imperfecto de subjuntivo, y luego el condicional. Las dos partes pueden ir en cualquier orden.',
          },
        },
        {
          kind: 'examples',
          items: [
            {
              es: 'Si *tuviera* dinero, *viajaría* por todo el mundo.',
              en: 'If I had money, I would travel all over the world.',
              check: [{ entry: 'tener', tense: 'imperfectSubjunctive', person: 'yo' }, { entry: 'viajar', tense: 'conditional', person: 'yo' }],
            },
            {
              es: '¿Qué *harías* si *ganaras* la lotería?',
              en: 'What would you do if you won the lottery?',
              check: [{ entry: 'hacer', tense: 'conditional', person: 'tu' }, { entry: 'ganar', tense: 'imperfectSubjunctive', person: 'tu' }],
            },
            {
              es: 'Si *pudiera*, *iría* a la playa todos los días.',
              en: 'If I could, I would go to the beach every day.',
              check: [{ entry: 'poder', tense: 'imperfectSubjunctive', person: 'yo' }, { entry: 'ir', tense: 'conditional', person: 'yo' }],
            },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'When *si* means “if”, never put the conditional right after it: say *si tuviera*, not *si tendría*.',
            es: 'Cuando *si* introduce una condición, nunca pongas el condicional justo después: se dice *si tuviera*, no *si tendría*.',
          },
        },
      ],
      keyIdea: {
        en: '*Si* + imperfect subjunctive, then the conditional: *Si tuviera dinero, viajaría*.',
        es: '*Si* + imperfecto de subjuntivo, y luego el condicional: Si *tuviera* dinero, *viajaría*.',
      },
    },
  ],
};

const chapters: Chapter[] = [perfect, subjunctive];

export default chapters;
