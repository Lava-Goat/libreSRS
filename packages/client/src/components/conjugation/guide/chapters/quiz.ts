// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "How this practice works": the quiz screens as they are (ConjugationRunner.tsx) and the rules the
 * server grades by (services/conjugationQuiz.ts, shared/conjugation/grade.ts): rounds, the two kinds
 * of question, the answer ladder (mastery on two different days), forms that come back for review
 * (from earlier units' quizzes too), typing and accents, the messages, second tries and scores.
 */
import type { Chapter } from '../types';

const chapters: Chapter[] = [
  {
    id: 'quiz',
    title: { en: 'How this practice works', es: 'Cómo funciona esta práctica' },
    summary: {
      en: 'Rounds, the questions, the answer ladder, and what each message means.',
      es: 'Las rondas, las preguntas, la escalera de respuestas y qué significa cada mensaje.',
    },
    sections: [
      {
        id: 'quiz-rounds',
        title: { en: 'Rounds', es: 'Las rondas' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'You practice in rounds. Your teacher decides how many questions a round has. Each question is one verb in one person and one tense.',
              es: 'Practicas en rondas. Tu profesor / profesora decide cuántas preguntas tiene una ronda. Cada pregunta es un verbo en una persona y un tiempo verbal.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'Before a round, the green bar shows how much you have mastered, like “12 / 60 mastered”.',
                es: 'Antes de una ronda, la barra verde muestra cuánto dominas, como “12 / 60 dominados”.',
              },
              {
                en: 'Under “Verbs”, each chip shows a verb and how many of its questions you have mastered: *tener* 3/12 means 3 of 12. It turns green when you have mastered them all.',
                es: 'En “Verbos”, cada etiqueta muestra un verbo y cuántas de sus preguntas dominas: *tener* 3/12 quiere decir 3 de 12. Se pone verde cuando las dominas todas.',
              },
              {
                en: 'During a round, the bar at the top counts the questions: “5 / 20” is question 5 of 20.',
                es: 'Durante la ronda, la barra de arriba cuenta las preguntas: “5 / 20” es la pregunta 5 de 20.',
              },
              {
                en: 'Left in the middle? Your answers are saved. “Continue the round” picks it up again, up to three hours after you started it.',
                es: '¿La dejaste a medias? Tus respuestas se guardan. “Seguir con la ronda” la retoma, hasta tres horas después de empezarla.',
              },
              {
                en: 'Once you have mastered everything, you get a “Review round”. A question you miss there is no longer mastered.',
                es: 'Cuando lo dominas todo, te toca una “Ronda de repaso”. Una pregunta que falles ahí deja de estar dominada.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'The green bar grows as you master questions, and every answer is saved as you go.',
          es: 'La barra verde crece a medida que dominas preguntas, y cada respuesta se guarda al momento.',
        },
      },
      {
        id: 'quiz-guide',
        title: { en: 'This guide', es: 'Esta guía' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'The guide opens before a round and between questions. After you answer, the “Guide” button and the tense in blue capitals (like *PRESENTE*) take you to the chapter you need. While a question waits for your answer, the guide waits too, so your score is your own work.',
              es: 'La guía se abre antes de una ronda y entre preguntas. Después de responder, el botón “Guía” y el tiempo verbal en mayúsculas azules (como *PRESENTE*) te llevan al capítulo que necesitas. Mientras una pregunta espera tu respuesta, la guía también espera, para que tu puntuación refleje solo tu propio trabajo.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'It grows as you practice: a new chapter opens when your teacher adds a tense or a new kind of verb, and new parts open when you start typing and when accents start to count.',
                es: 'Crece a medida que practicas: aparece un capítulo nuevo cuando tu profesor / profesora agrega un tiempo verbal o un tipo de verbo nuevo, y aparecen partes nuevas cuando empiezas a escribir y cuando los acentos empiezan a contar.',
              },
              {
                en: '“New” marks what opened since you last looked.',
                es: '“Nuevo” marca lo que apareció desde la última vez que abriste la guía.',
              },
              {
                en: 'After a wrong answer, a line can name the mistake, and “Why? See the guide.” opens the part that explains it.',
                es: 'Después de una respuesta equivocada, una línea puede nombrar el error, y “¿Por qué? Mira la guía.” abre la parte que lo explica.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Answer first, then look it up: the guide opens between questions.',
          es: 'Primero responde, después consulta: la guía se abre entre preguntas.',
        },
      },
      {
        id: 'quiz-form-it',
        title: { en: '“Give the form” questions', es: 'Preguntas de “da la forma”' },
        when: { direction: 'toForm' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'A “give the form” question names a verb and a person; you give the form that fits. It says “Pick the right form.” or, when you type, “Type the right form.”',
              es: 'Una pregunta de “da la forma” te da un verbo y una persona; tú das la forma que les corresponde. Dice “Elige la forma correcta” o, cuando escribes, “Escribe la forma correcta”.',
            },
          },
          {
            kind: 'figure',
            figure: 'formIt',
            caption: { en: 'A “give the form” question', es: 'Una pregunta de “da la forma”' },
          },
          {
            kind: 'list',
            items: [
              {
                en: '1 — The tense, in blue capitals, like *PRESENTE* (“present”).',
                es: '1 — El tiempo verbal, en mayúsculas azules, como PRESENTE.',
              },
              {
                en: '2 — Who does the action, like *yo* or *ustedes*: one person at a time, taking turns. With verbs like *gustar*, it is who likes it: *a mí*, *a ellas*…',
                es: '2 — Quién hace la acción, como *yo* o *ustedes*: una persona cada vez, por turnos. Con verbos como *gustar*, es a quien le gusta: *a mí*, *a ellas*…',
              },
              {
                en: '3 — The verb’s dictionary form (infinitive), in parentheses, like *(tener)*.',
                es: '3 — La forma de diccionario (infinitivo) del verbo, entre paréntesis, como *(tener)*.',
              },
              {
                en: '4 — Only with verbs like *gustar*: the cue, the thing liked. It decides between *me gusta* and *me gustan*.',
                es: '4 — Solo con verbos como *gustar*: la pista, lo que gusta. Decide entre *me gusta* y *me gustan*.',
              },
            ],
          },
          {
            kind: 'compare',
            head: [
              { en: 'The question (present)', es: 'La pregunta (presente)' },
              { en: 'Your answer', es: 'Tu respuesta' },
            ],
            rows: [
              [{ en: '*yo (tener)*', es: '*yo (tener)*' }, { en: '*tengo*', es: '*tengo*' }],
              [{ en: '*ella (ser)*', es: '*ella (ser)*' }, { en: '*es*', es: '*es*' }],
              [{ en: '*nosotras (ir)*', es: '*nosotras (ir)*' }, { en: '*vamos*', es: '*vamos*' }],
              [{ en: '*ustedes (hablar)*', es: '*ustedes (hablar)*' }, { en: '*hablan*', es: '*hablan*' }],
            ],
          },
        ],
        keyIdea: {
          en: 'Read the tense and who first, then change the dictionary form to fit them.',
          es: 'Lee primero el tiempo verbal y quién, y luego cambia la forma de diccionario para que encaje.',
        },
      },
      {
        id: 'quiz-name-it',
        title: { en: '“Name the verb” questions', es: 'Preguntas de “nombra el verbo”' },
        when: { direction: 'fromForm' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'A “name the verb” question works the other way round: it shows a form; you pick its verb and who does the action. These questions are always multiple choice, so everything you type is a form.',
              es: 'Una pregunta de “nombra el verbo” funciona al revés: te muestra una forma; tú eliges su verbo y quién hace la acción. Estas preguntas son siempre de opción múltiple, así que todo lo que escribes son formas.',
            },
          },
          {
            kind: 'figure',
            figure: 'nameIt',
            caption: { en: 'A “name the verb” question', es: 'Una pregunta de “nombra el verbo”' },
          },
          {
            kind: 'list',
            items: [
              {
                en: '1 — The form, like *tengo*. With only one tense in your deck, the tense is written above it.',
                es: '1 — La forma, como *tengo*. Si tu mazo tiene un solo tiempo verbal, el tiempo aparece encima.',
              },
              {
                en: '2 — The options. Each names a verb by its dictionary form, and who: *tener · yo*. They are often the same verb in different persons, so only the form’s ending tells you which one fits. Then the question names the verb (“Which form of tener is this?”), and the options say only who: *yo*, *ustedes*.',
                es: '2 — Las opciones. Cada una nombra un verbo por su forma de diccionario, y quién: *tener · yo*. A menudo son el mismo verbo en distintas personas, así que solo la terminación de la forma te dice cuál encaja. Entonces la pregunta nombra el verbo y las opciones dicen solo quién: *yo*, *ustedes*.',
              },
              {
                en: '3 — With more than one tense in your deck, each option names the tense too: *yo · presente* (or *tener · yo · presente* when the options mix verbs).',
                es: '3 — Si tu mazo tiene más de un tiempo verbal, cada opción nombra también el tiempo: *yo · presente* (o *tener · yo · presente* cuando las opciones mezclan verbos).',
              },
              {
                en: '“Name the verb” questions stay on the multiple-choice rung. Right there on two different days, and one is mastered.',
                es: 'Las preguntas de “nombra el verbo” se quedan en el peldaño de opción múltiple. Si aciertas ahí en dos días distintos, la dominas.',
              },
            ],
          },
          {
            kind: 'compare',
            head: [
              { en: 'The form', es: 'La forma' },
              { en: 'Its verb and who', es: 'Su verbo y quién' },
            ],
            rows: [
              [{ en: '*tengo*', es: '*tengo*' }, { en: '*tener · yo*', es: '*tener · yo*' }],
              [{ en: '*es*', es: '*es*' }, { en: '*ser · ella*', es: '*ser · ella*' }],
              [{ en: '*vamos*', es: '*vamos*' }, { en: '*ir · nosotros*', es: '*ir · nosotros*' }],
            ],
          },
        ],
        keyIdea: {
          en: 'Pick the option whose verb and person fit the form’s ending (and its tense, when the options name one).',
          es: 'Elige la opción cuyo verbo y persona encajan con la terminación de la forma (y su tiempo verbal, si las opciones lo nombran).',
        },
      },
      {
        id: 'quiz-name-it-shared',
        title: { en: 'One form, more than one answer', es: 'Una forma, más de una respuesta' },
        when: {
          all: [
            { direction: 'fromForm' },
            { any: [{ multipleTenses: true }, { not: { tense: 'present' } }, { vos: true }] },
          ],
        },
        blocks: [
          {
            kind: 'tip',
            text: {
              en: 'Some forms fit more than one answer. In the imperfect, *tenía* is *yo* and also *él / ella / usted*. And when your deck has both *ser* and *ir*, *fui* in the preterite belongs to either verb. Any answer that fits counts, and “Also correct:” shows the rest.',
              es: 'Algunas formas encajan con más de una respuesta. En el imperfecto, *tenía* es *yo* y también *él / ella / usted*. Y si tu mazo tiene *ser* e *ir*, *fui* en el pretérito es de los dos verbos. Cuenta cualquier respuesta que encaje, y “También es correcto:” muestra las demás.',
            },
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Yo *tenía* un perro.',
                en: 'I had a dog.',
                check: [{ entry: 'tener', tense: 'imperfect', person: 'yo' }],
              },
              {
                es: 'Mi abuela *tenía* un gato.',
                en: 'My grandmother had a cat.',
                check: [{ entry: 'tener', tense: 'imperfect', person: 'el' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'If a form fits more than one answer, any of them counts.',
          es: 'Si una forma encaja con más de una respuesta, cualquiera cuenta.',
        },
      },
      {
        id: 'quiz-ladder',
        title: { en: 'The answer ladder', es: 'La escalera de respuestas' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Every question climbs its own ladder, from easier rungs to harder ones. The rung a question is on shows at the top of it.',
              es: 'Cada pregunta sube su propia escalera, de los peldaños más fáciles a los más difíciles. El peldaño en el que está aparece arriba de la pregunta.',
            },
          },
          {
            kind: 'figure',
            figure: 'ladder',
            caption: { en: 'The rungs of your deck, easiest first', es: 'Los peldaños de tu mazo, del más fácil al más difícil' },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'Right: next time, the question is one rung up.',
                es: 'Si aciertas, la próxima vez la pregunta está un peldaño más arriba.',
              },
              {
                en: 'Wrong: it goes one rung down (never below the first).',
                es: 'Si fallas, baja un peldaño (nunca por debajo del primero).',
              },
              {
                en: 'Right on the top rung: good, but once is not enough. Right there again on another day: mastered! So nothing is mastered in one sitting.',
                es: 'Si aciertas en el peldaño más alto: bien, pero una vez no basta. Si vuelves a acertar ahí otro día: ¡dominada! Así, nada se domina de una sentada.',
              },
              {
                en: 'Each question climbs on its own: *tengo* can be mastered while *tienes* is still on the first rung.',
                es: 'Cada pregunta sube por su cuenta: la pregunta de *tengo* puede estar dominada mientras la de *tienes* sigue en el primer peldaño.',
              },
              {
                en: 'Mastered forms come back now and then, to stay mastered (see “Forms that come back”).',
                es: 'Las formas dominadas vuelven de vez en cuando, para seguir dominadas (mira “Formas que vuelven”).',
              },
              {
                en: 'Each round keeps up to a quarter of its questions for forms due for review, fills the rest with questions you haven’t mastered, then is shuffled. If there aren’t enough, it adds some you have mastered.',
                es: 'Cada ronda guarda hasta una cuarta parte de sus preguntas para formas que toca repasar, llena el resto con preguntas que aún no dominas y luego se mezcla. Si no hay suficientes, añade algunas que ya dominas.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'The usual ladder has three rungs: “Multiple choice”, “Typed · accents forgiven”, “Typed · accents count”. Your teacher can leave some out (no typing, no multiple choice, or just one typed rung), so yours may be shorter. The drawing above shows your deck’s.',
              es: 'La escalera habitual tiene tres peldaños: “Opción múltiple”, “Escrita · se perdonan los acentos” y “Escrita · los acentos cuentan”. Tu profesor / profesora puede quitar alguno (sin escribir, sin opción múltiple o con un solo peldaño escrito), así que la tuya puede ser más corta. El dibujo de arriba muestra la de tu mazo.',
            },
          },
        ],
        keyIdea: {
          en: 'Right moves a question up one rung, wrong moves it down one, and right on the top rung on two different days masters it.',
          es: 'Si aciertas, la pregunta sube un peldaño; si fallas, baja uno; y si aciertas en el peldaño más alto en dos días distintos, la dominas.',
        },
      },
      {
        id: 'quiz-reviews',
        title: { en: 'Forms that come back', es: 'Formas que vuelven' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Mastered forms come back now and then, to stay mastered. Remembering a form after a break is what makes it stick.',
              es: 'Las formas dominadas vuelven de vez en cuando, para seguir dominadas. Recordar una forma después de un descanso es lo que hace que se quede.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                en: 'A form comes back for review about a week after you master it, then three weeks later, then every eight weeks.',
                es: 'Una forma vuelve para repasarla más o menos una semana después de dominarla, luego tres semanas después y luego cada ocho semanas.',
              },
              {
                en: '“3 forms due”, before a round and on the quiz’s card, counts the mastered forms of this quiz waiting for review.',
                es: '“3 formas por repasar”, antes de una ronda y en la tarjeta de la práctica, cuenta las formas dominadas de esta práctica que esperan un repaso.',
              },
              {
                en: 'Up to a quarter of every round is kept for forms that are due, marked “Back for review”. They can come from an earlier unit’s quiz: the mark then names that quiz, like “Back for review · Unit 1”, and your answer counts there.',
                es: 'Hasta una cuarta parte de cada ronda se guarda para las formas que toca repasar, marcadas “De repaso”. Pueden venir de la práctica de una unidad anterior: entonces la marca nombra esa práctica, como “De repaso · Unidad 1”, y tu respuesta cuenta allí.',
              },
              {
                en: 'Right: “Still mastered.”, and next time it waits longer before it comes back. Wrong: it is no longer mastered and goes back to practice.',
                es: 'Si aciertas: “Sigue dominada.”, y la próxima vez tarda más en volver. Si fallas: deja de estar dominada y vuelve a la práctica.',
              },
              {
                en: 'So your “mastered” count can go down. That is the review doing its job: the form gets practiced until it sticks.',
                es: 'Por eso tu número de formas dominadas puede bajar. Es el repaso haciendo su trabajo: la forma se practica hasta que se queda.',
              },
              {
                en: 'A form you have mastered in one quiz usually starts on the top rung in another quiz that has it: one right answer masters it there too.',
                es: 'Una forma que ya dominas en una práctica suele empezar en el peldaño más alto en otra práctica que la tenga: con una respuesta correcta la dominas también allí.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Mastered forms come back now and then, to stay mastered; one you miss goes back to practice.',
          es: 'Las formas dominadas vuelven de vez en cuando, para seguir dominadas; la que falles vuelve a la práctica.',
        },
      },
      {
        id: 'quiz-choice',
        title: { en: 'Multiple choice', es: 'Opción múltiple' },
        // "Name the verb" questions are multiple choice whatever the deck's ladder.
        when: { any: [{ ladderHas: 'choice' }, { direction: 'fromForm' }] },
        blocks: [
          {
            kind: 'list',
            items: [
              {
                en: 'Click or tap an option, or press its number key: 1, 2, 3 or 4.',
                es: 'Toca o haz clic en una opción, o pulsa su número: 1, 2, 3 o 4.',
              },
              {
                en: 'Your pick is checked at once: the right option turns green, and a wrong pick turns red.',
                es: 'Tu elección se comprueba al momento: la opción correcta se pone verde, y una elección equivocada, roja.',
              },
              {
                en: 'Press Enter (or “Next”) to go on.',
                es: 'Pulsa Enter (o “Siguiente”) para seguir.',
              },
              {
                en: 'Wrong options are made to look close: the same verb with another person’s ending, or with a mistake students often make. Read each option all the way through.',
                es: 'Las opciones equivocadas se parecen a la correcta a propósito: el mismo verbo con la terminación de otra persona, o con un error que se comete a menudo. Lee cada opción entera.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'Say the answer in your head before you look at the options. That is how it sticks.',
              es: 'Piensa la respuesta antes de mirar las opciones. Así se te queda grabada.',
            },
          },
        ],
        keyIdea: {
          en: 'Pick with a click or the keys 1–4; Enter goes on.',
          es: 'Elige con un clic o con las teclas 1–4; Enter pasa a la siguiente.',
        },
      },
      {
        id: 'quiz-typing',
        title: { en: 'Typing your answer', es: 'Escribir tu respuesta' },
        when: { reached: 'typed-lenient' },
        blocks: [
          {
            kind: 'list',
            items: [
              {
                en: 'Type in the box, then press Enter (or “Check”). Press Enter again to go on.',
                es: 'Escribe en la casilla y pulsa Enter (o “Comprobar”). Pulsa Enter otra vez para seguir.',
              },
              {
                en: 'The keys under the box add *á é í ó ú ü ñ* where your cursor is.',
                es: 'Las teclas debajo de la casilla añaden *á é í ó ú ü ñ* donde está el cursor.',
              },
              {
                en: 'Capitals, extra spaces and a period at the end don’t matter. Spelling does: every letter must be right, and *ñ* is not *n*.',
                es: 'Las mayúsculas, los espacios de más y un punto al final no importan. La ortografía sí: cada letra tiene que estar bien, y la *ñ* no es una *n*.',
              },
              {
                en: 'If your deck has the “Typed · accents forgiven” rung: there, a missing or wrong accent still counts. You see “Correct, but watch the accent:” and the right spelling.',
                es: 'Si tu mazo tiene el peldaño “Escrita · se perdonan los acentos”: ahí, si falta un acento o está mal, la respuesta cuenta igual. Ves “Correcto, pero ojo con el acento:” y cómo se escribe.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Spelling must be exact. Only an accent can get a pass, and only on the “accents forgiven” rung.',
          es: 'La ortografía tiene que ser exacta. Solo un acento puede perdonarse, y solo en el peldaño “se perdonan los acentos”.',
        },
      },
      {
        id: 'quiz-typing-form',
        title: { en: 'Typing a “give the form” answer', es: 'Escribir una respuesta de “da la forma”' },
        when: { all: [{ reached: 'typed-lenient' }, { direction: 'toForm' }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'In a “give the form” question, type the whole form, little words and all:',
              es: 'En una pregunta de “da la forma”, escribe la forma entera, sin dejar fuera ninguna palabra:',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Question → you type', es: 'Pregunta → escribes' },
              { en: 'Does it count?', es: '¿Cuenta?' },
            ],
            rows: [
              [
                { en: '*yo (tener)* → *tengo* or *yo tengo*', es: '*yo (tener)* → *tengo* o *yo tengo*' },
                { en: 'Yes. A subject pronoun that fits is fine.', es: 'Sí. Un pronombre de sujeto que encaje con la persona está bien.' },
              ],
              [
                { en: '*yo (tener)* → *tú tengo*', es: '*yo (tener)* → *tú tengo*' },
                { en: 'No. The pronoun must fit the person.', es: 'No. El pronombre tiene que encajar con la persona.' },
              ],
              [
                { en: '*yo (llamarse)* → *llamo*', es: '*yo (llamarse)* → *llamo*' },
                { en: 'No. Type the whole form: *me llamo*.', es: 'No. Escribe la forma entera: *me llamo*.' },
              ],
              [
                { en: '*a mí (gustarle) + el chocolate* → *me gusta*, *a mí me gusta* or *me gusta el chocolate*', es: '*a mí (gustarle) + el chocolate* → *me gusta*, *a mí me gusta* o *me gusta el chocolate*' },
                { en: 'Yes, any of these.', es: 'Sí, cualquiera.' },
              ],
              [
                { en: '*a mí (gustarle) + el chocolate* → *yo me gusta*', es: '*a mí (gustarle) + el chocolate* → *yo me gusta*' },
                { en: 'No. *gustar* takes *me*, not *yo*.', es: 'No. Con *gustar* va *me*, no *yo*.' },
              ],
              [
                { en: '*haber* impersonal → *hay*', es: '*haber* impersonal → *hay*' },
                { en: 'Yes. Just *hay*, with no pronoun.', es: 'Sí. Solo *hay*, sin pronombre.' },
              ],
            ],
          },
        ],
        keyIdea: {
          en: 'Type the whole form, like *me llamo* or *me gusta*. A subject pronoun that fits is fine; one that doesn’t makes it wrong.',
          es: 'Escribe la forma entera, como *me llamo* o *me gusta*. Un pronombre de sujeto que encaje está bien; uno que no encaje la hace incorrecta.',
        },
      },
      {
        id: 'quiz-accents',
        title: { en: 'When accents count', es: 'Cuando los acentos cuentan' },
        when: { any: [{ reached: 'typed-strict' }, { accentsFromStart: true }] },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'On “Typed · accents count”, the accent is part of the spelling, and the box’s label says “accents count”. A missing or wrong accent gets “Almost — check the accent:”, and it counts as a miss.',
              es: 'En “Escrita · los acentos cuentan”, el acento es parte de la ortografía, y la etiqueta de la casilla dice “los acentos cuentan”. Si falta un acento o está mal, ves “Casi — revisa el acento:” y la respuesta cuenta como fallo.',
            },
          },
          {
            kind: 'tip',
            text: {
              en: 'If your teacher made accents count from the start, even multiple-choice options can differ by just an accent. Look closely.',
              es: 'Si tu profesor / profesora hizo que los acentos contaran desde el principio, hasta en opción múltiple las opciones pueden diferenciarse solo por un acento. Míralas bien.',
            },
          },
          {
            kind: 'p',
            text: {
              en: 'Why so strict? In Spanish, an accent can make a different word:',
              es: '¿Por qué tanto rigor? En español, un acento puede cambiar la palabra:',
            },
          },
          {
            kind: 'compare',
            head: [
              { en: 'No accent', es: 'Sin acento' },
              { en: 'With an accent', es: 'Con acento' },
            ],
            rows: [
              [
                { en: '*hablo*: “I speak” (present)', es: '*hablo*: yo, presente' },
                { en: '*habló*: “he / she spoke” (preterite)', es: '*habló*: él / ella / usted, pretérito' },
              ],
              [
                { en: '*esta*: “this”, as in *esta clase*', es: '*esta*: demostrativo, como en “esta clase”' },
                { en: '*está*: “is”, as in *está en casa*', es: '*está*: del verbo estar, como en “está en casa”' },
              ],
              [
                { en: '*tu*: “your”, as in *tu casa*', es: '*tu*: posesivo, como en “tu casa”' },
                { en: '*tú*: “you”, as in *tú tienes*', es: '*tú*: pronombre de sujeto, como en “tú tienes”' },
              ],
            ],
          },
          {
            kind: 'examples',
            items: [
              {
                es: 'Yo *hablo* inglés y español.',
                en: 'I speak English and Spanish.',
                check: [{ entry: 'hablar', tense: 'present', person: 'yo' }],
              },
              {
                es: 'Ayer mi amiga *habló* con la profesora.',
                en: 'Yesterday my friend talked with the teacher.',
                check: [{ entry: 'hablar', tense: 'preterite', person: 'el' }],
              },
              {
                es: 'Mi mochila *está* en esta silla.',
                en: 'My backpack is on this chair.',
                check: [{ entry: 'estar', tense: 'present', person: 'el' }],
              },
            ],
          },
        ],
        keyIdea: {
          en: 'When accents count, a missing or wrong accent is a miss: type the form exactly.',
          es: 'Cuando los acentos cuentan, un acento que falta o está mal es un fallo: escribe la forma exacta.',
        },
      },
      {
        id: 'quiz-verdicts',
        title: { en: 'What the messages mean', es: 'Qué significan los mensajes' },
        blocks: [
          {
            kind: 'figure',
            figure: 'verdicts',
            caption: { en: 'The messages you can get in this deck', es: 'Los mensajes que puedes recibir en este mazo' },
          },
          {
            kind: 'compare',
            head: [
              { en: 'Message', es: 'Mensaje' },
              { en: 'What it means', es: 'Qué significa' },
            ],
            rows: [
              [
                { en: '“Correct!” (green)', es: '“¡Correcto!” (verde)' },
                { en: 'Right. It counts.', es: 'Bien. Cuenta.' },
              ],
              [
                { en: '“Correct, but watch the accent:” (green)', es: '“Correcto, pero ojo con el acento:” (verde)' },
                { en: 'Right except for an accent, while accents are forgiven. It counts; look at the spelling it shows.', es: 'Acertaste salvo por un acento, y en este peldaño se perdonan los acentos. Cuenta; fíjate en cómo se escribe.' },
              ],
              [
                { en: '“Almost — check the accent:” (yellow)', es: '“Casi — revisa el acento:” (amarillo)' },
                { en: 'Only an accent was off, but accents count now. It does not count.', es: 'Solo te equivocaste en un acento, pero en este peldaño los acentos cuentan. No cuenta.' },
              ],
              [
                { en: '“Not quite. The answer:” (red)', es: '“No exactamente. La respuesta:” (rojo)' },
                { en: 'Wrong. You see the answer and what you gave.', es: 'Mal. Ves la respuesta y lo que respondiste.' },
              ],
            ],
          },
          {
            kind: 'list',
            items: [
              {
                en: '“Also correct:” lists other answers that were right too.',
                es: '“También es correcto:” muestra otras respuestas que también valían.',
              },
              {
                en: '“Right on the top rung! Get it right again on another day to master it.” means the question is one step from mastered.',
                es: '“¡Bien en el peldaño más alto! Acierta otra vez otro día para dominarla.” quiere decir que a la pregunta le falta un paso para estar dominada.',
              },
              {
                en: '“Mastered!” means you got it right on the top rung, on a second day. Under it, you see when it comes back for review.',
                es: '“¡Dominado!” quiere decir que acertaste en el peldaño más alto por segundo día. Debajo ves cuándo vuelve para repasarla.',
              },
              {
                en: '“Still mastered.” and “No longer mastered: it goes back to practice.” are about forms back for review.',
                es: '“Sigue dominada.” y “Ya no está dominada: vuelve a la práctica.” son de formas que vuelven para repasar.',
              },
              {
                en: 'Under a wrong answer, a line can name the mistake, like “That’s the él / ella / usted form, not the yo form.” “Why? See the guide.” opens the part that explains it.',
                es: 'Debajo de una respuesta equivocada, una línea puede nombrar el error, como “Esa es la forma de él / ella / usted, no la de yo.” “¿Por qué? Mira la guía.” abre la parte que lo explica.',
              },
              {
                en: '“Next time, you type it.”, “Next time, the accents count.” or “Next time, you type it, and the accents count.” means the question moved up a rung.',
                es: '“La próxima vez, lo escribes tú”, “La próxima vez, los acentos cuentan” o “La próxima vez, lo escribes tú, y los acentos cuentan” quiere decir que la pregunta subió un peldaño.',
              },
              {
                en: '“This one comes back at the end of the round.” means you get a second try.',
                es: '“Esta vuelve al final de la ronda” quiere decir que tendrás un segundo intento.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'Green messages count. “Almost” and “Not quite” don’t: the question moves down a rung.',
          es: 'Los mensajes verdes cuentan. “Casi” y “No exactamente” no: la pregunta baja un peldaño.',
        },
      },
      {
        id: 'quiz-second-try',
        title: { en: 'Second tries', es: 'Segundo intento' },
        blocks: [
          {
            kind: 'list',
            items: [
              {
                en: 'Miss a question, and it comes back once, at the end of the same round, marked “Second try”.',
                es: 'Si fallas una pregunta, vuelve una vez al final de la misma ronda, marcada “Segundo intento”.',
              },
              {
                en: 'The round gets one question longer: “5 / 20” becomes “5 / 21”.',
                es: 'La ronda tiene una pregunta más: “5 / 20” pasa a “5 / 21”.',
              },
              {
                en: 'It comes back one rung lower, if there is one: a typed question can come back as multiple choice.',
                es: 'Vuelve un peldaño más abajo, si lo hay: una pregunta escrita puede volver como opción múltiple.',
              },
              {
                en: 'Right on the second try moves it back up, but your score counts only answers right the first time.',
                es: 'Acertarla en el segundo intento la vuelve a subir, pero tu puntuación solo cuenta las preguntas que aciertas al primer intento.',
              },
              {
                en: 'Miss it again, and it waits for a later round.',
                es: 'Si la vuelves a fallar, queda para otra ronda.',
              },
            ],
          },
        ],
        keyIdea: {
          en: 'A missed question gets one second try, at the end of the round.',
          es: 'Una pregunta fallada tiene un segundo intento, al final de la ronda.',
        },
      },
      {
        id: 'quiz-scores',
        title: { en: 'Your scores', es: 'Tus puntuaciones' },
        blocks: [
          {
            kind: 'list',
            items: [
              {
                en: 'At the end of a round you see “Round complete” and your score: the percent of questions you got right the first time. “17 of 20 right the first time” is 85%.',
                es: 'Al final de una ronda ves “Ronda terminada” y tu puntuación: el porcentaje de preguntas que acertaste al primer intento. “17 de 20 bien al primer intento” es un 85%.',
              },
              {
                en: 'Before a round, “Scores” shows your last round and your best, like “Last round: 85% · Best: 90%”.',
                es: 'Antes de una ronda, “Puntuaciones” muestra tu última ronda y la mejor, como “Última ronda: 85% · Mejor: 90%”.',
              },
              {
                en: 'Only finished rounds get a score. A round you replace with “Start a new round”, or don’t finish within three hours of starting it, gets none.',
                es: 'Solo las rondas terminadas tienen puntuación. Una ronda que reemplazas con “Empezar una ronda nueva”, o que no terminas antes de que pasen tres horas desde que la empezaste, no tiene.',
              },
              {
                en: 'Your teacher sees your last and best scores, how many rounds you have finished, on how many days you practiced, when you last practiced, how much you have mastered, and how many forms you still get right after a week or more. Your teacher also sees which questions the class misses most, and which mistakes are most common.',
                es: 'Tu profesor / profesora ve tu última y tu mejor puntuación, cuántas rondas terminaste, cuántos días practicaste, cuándo practicaste por última vez, cuánto dominas y cuántas formas sigues acertando después de una semana o más. También ve qué preguntas falla más la clase y qué errores son más comunes.',
              },
            ],
          },
          {
            kind: 'tip',
            text: {
              en: 'A lower score on a new rung is normal: typing is harder than picking.',
              es: 'Una puntuación más baja en un peldaño nuevo es normal: escribir es más difícil que elegir.',
            },
          },
          {
            kind: 'tip',
            text: {
              en: 'Mastered in the quiz means you can produce it here. Using it while talking takes longer, and that’s normal.',
              es: 'Dominarla en la práctica quiere decir que puedes producirla aquí. Usarla al hablar lleva más tiempo, y es normal.',
            },
          },
        ],
        keyIdea: {
          en: 'Your score counts answers right the first time, and your teacher sees it.',
          es: 'Tu puntuación cuenta las preguntas que aciertas al primer intento, y tu profesor / profesora la ve.',
        },
      },
    ],
  },
];

export default chapters;
