// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The first two chapters of the guide, for every deck: what conjugating is
 * (dictionary form, stem and ending, the three families, the dropped subject
 * pronoun, and the app's names for -se, -le and impersonal entries), and the
 * persons (usted and ustedes, how the quiz names who: one subject at a time
 * since v1.24.0, with the whole group in the feedback; vosotros and vos).
 */
import type { Chapter } from '../types';

const basics: Chapter = {
  id: 'basics',
  title: { en: 'What is conjugation?', es: '¿Qué es la conjugación?' },
  summary: {
    en: 'Verbs change their form, mostly the ending, to show who does something and when.',
    es: 'Los verbos cambian su forma, sobre todo la terminación, para mostrar quién hace algo y cuándo.',
  },
  sections: [
    {
      id: 'basics-what',
      title: { en: 'One verb, many forms', es: 'Un verbo, muchas formas' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A verb is a word for an action or a state: “speak”, “eat”, “be”. To conjugate a verb is to change its form, mostly its ending, to show who does the action and when. The “who” is called the person.',
            es: 'Un verbo es una palabra que nombra una acción o un estado: hablar, comer, ser. Conjugar un verbo es cambiar su forma, sobre todo la terminación, para mostrar quién hace la acción y cuándo. A ese “quién” se le llama persona.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'English', es: 'Inglés' }, { en: 'Spanish', es: 'Español' }],
          rows: [
            [{ en: 'I speak', es: 'I speak' }, { en: '*yo hablo*', es: '*yo hablo*' }],
            [{ en: 'you speak', es: 'you speak' }, { en: '*tú hablas*', es: '*tú hablas*' }],
            [{ en: 'she speaks', es: 'she speaks' }, { en: '*ella habla*', es: '*ella habla*' }],
            [{ en: 'we speak', es: 'we speak' }, { en: '*nosotros hablamos*', es: '*nosotros hablamos*' }],
            [{ en: 'they speak', es: 'they speak' }, { en: '*ellos hablan*', es: '*ellos hablan*' }],
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'English adds an -s for “he” or “she”, and that’s it. Spanish gives each person its own ending. The ending also changes with time: *hablo* “I speak”, but *hablé* “I spoke”. Each time frame (present, past, future…) is called a tense.',
            es: 'El inglés solo agrega una -s con “he” o “she”. El español le da a cada persona su propia terminación. La terminación también cambia con el tiempo: *hablo* es presente, pero *hablé* es pasado. Cada uno de esos tiempos (presente, pasado, futuro…) se llama tiempo verbal.',
          },
        },
      ],
      keyIdea: {
        en: 'Conjugating means changing a verb’s form, mostly its ending, to show who does the action (the person) and when (the tense).',
        es: 'Conjugar es cambiar la forma de un verbo, sobre todo la terminación, para mostrar quién hace la acción (la persona) y cuándo (el tiempo verbal).',
      },
    },
    {
      id: 'basics-dictionary-form',
      title: { en: 'The dictionary form (infinitive)', es: 'La forma de diccionario (infinitivo)' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Before it’s conjugated, every verb has a basic form: the dictionary form (infinitive). It’s the form a dictionary or a vocabulary list gives you.',
            es: 'Antes de conjugarlo, cada verbo tiene una forma básica: la forma de diccionario (infinitivo). Es la forma que te da un diccionario o una lista de vocabulario.',
          },
        },
        {
          kind: 'list',
          items: [
            {
              en: 'It means “to …”: *hablar* “to speak”, *comer* “to eat”, *vivir* “to live”.',
              es: 'Equivale al inglés “to …”: *hablar* es “to speak”; *comer*, “to eat”; *vivir*, “to live”.',
            },
            { en: 'It always ends in *-ar*, *-er* or *-ir*.', es: 'Siempre termina en *-ar*, *-er* o *-ir*.' },
            { en: 'It doesn’t say who or when. Conjugating adds that.', es: 'No dice quién ni cuándo. Eso lo agrega la conjugación.' },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'In the quiz, the dictionary form names the verb. In “give the form” questions, it’s the word in parentheses: *yo (tener)* → *tengo*. In “name the verb” questions, it’s part of the option you pick: *tengo* → *tener · yo*.',
            es: 'En esta práctica, la forma de diccionario nombra el verbo. En las preguntas de “da la forma”, es la palabra entre paréntesis: *yo (tener)* → *tengo*. En las preguntas de “nombra el verbo”, es parte de la opción que eliges: *tengo* → *tener · yo*.',
          },
        },
      ],
      keyIdea: {
        en: 'The dictionary form ends in *-ar*, *-er* or *-ir* and means “to …”. It names the verb but doesn’t say who.',
        es: 'La forma de diccionario termina en *-ar*, *-er* o *-ir*. Nombra el verbo, pero no dice quién.',
      },
    },
    {
      id: 'basics-stem-ending',
      title: { en: 'Stem + ending', es: 'Raíz + terminación' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Take the *-ar*, *-er* or *-ir* off the dictionary form, and what’s left is the stem: *hablar* → *habl-*. The stem carries the meaning. To conjugate, you add a new ending to the stem, and the ending says who.',
            es: 'Quita la *-ar*, *-er* o *-ir* de la forma de diccionario, y lo que queda es la raíz: *hablar* → *habl-*. La raíz lleva el significado. Para conjugar, le agregas a la raíz una terminación nueva, y la terminación dice quién.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*habl-* + *-o* → *hablo* “I speak”', es: '*habl-* + *-o* → *hablo* (yo)' },
            { en: '*habl-* + *-as* → *hablas* “you speak”', es: '*habl-* + *-as* → *hablas* (tú)' },
            { en: '*habl-* + *-amos* → *hablamos* “we speak”', es: '*habl-* + *-amos* → *hablamos* (nosotros)' },
          ],
        },
        {
          kind: 'paradigm',
          tense: 'present',
          entries: ['hablar'],
          shade: 'ending',
          caption: {
            en: '*hablar* in the present tense. The shaded part is the ending: it changes with each person.',
            es: '*hablar* en presente. La parte sombreada es la terminación: cambia con cada persona.',
          },
        },
      ],
      keyIdea: {
        en: 'Stem + ending: the stem says what the action is; the ending says who and when.',
        es: 'Raíz + terminación: la raíz dice cuál es la acción; la terminación dice quién y cuándo.',
      },
    },
    {
      id: 'basics-families',
      title: { en: 'Three families: *-ar*, *-er*, *-ir*', es: 'Tres familias: -ar, -er, -ir' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The last two letters of the dictionary form put every verb in one of three families, each with its own endings.',
            es: 'Las dos últimas letras de la forma de diccionario ponen a cada verbo en una de tres familias, cada una con sus propias terminaciones.',
          },
        },
        {
          kind: 'paradigm',
          tense: 'present',
          entries: ['hablar', 'comer', 'vivir'],
          shade: 'ending',
          caption: {
            en: 'The present tense. Other tenses have their own chapters.',
            es: 'El presente. Los otros tiempos verbales tienen sus propios capítulos.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'In all three, the *yo* form ends in *-o*: *hablo*, *como*, *vivo*.', es: 'En las tres, la forma de *yo* termina en *-o*: *hablo*, *como*, *vivo*.' },
            { en: '*-ar* verbs have an *a* in the other endings: *hablas*, *habla*, *hablan*.', es: 'Los verbos en *-ar* llevan *a* en las otras terminaciones: *hablas*, *habla*, *hablan*.' },
            { en: '*-er* and *-ir* verbs share most endings, with an *e*: *comes*, *come*; *vives*, *vive*.', es: 'Los verbos en *-er* y en *-ir* comparten casi todas las terminaciones, con *e*: *comes*, *come*; *vives*, *vive*.' },
            { en: 'Where an *-ir* verb keeps its *i*, the two split: *comemos*, but *vivimos*.', es: 'Donde un verbo en *-ir* conserva su *i*, las dos familias se separan: *comemos*, pero *vivimos*.' },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'A verb that follows its family’s endings is regular. Many common verbs don’t: some change a stem vowel (*querer* → *quiero*: a stem-changing verb), some have an odd *yo* form (*ver* → *veo*), and some are irregular all over (*ser*: *soy*, *eres*, *es*).',
            es: 'Un verbo que sigue las terminaciones de su familia es regular. Muchos verbos comunes no lo hacen: algunos cambian una vocal de la raíz (*querer* → *quiero*: un verbo con cambio de raíz), otros tienen una forma de *yo* irregular (*ver* → *veo*) y otros son irregulares en todo (*ser*: *soy*, *eres*, *es*).',
          },
        },
      ],
      keyIdea: {
        en: 'Know the family (*-ar*, *-er* or *-ir*) and you know the endings of every regular verb in it.',
        es: 'Si sabes la familia (*-ar*, *-er* o *-ir*), sabes las terminaciones de todos sus verbos regulares.',
      },
    },
    {
      id: 'basics-no-pronoun',
      title: { en: 'The ending says who', es: 'La terminación dice quién' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Words like *yo*, *tú* and *ella* are subject pronouns: they say who does the action. English needs one every time. Spanish often leaves it out, because the ending already says who.',
            es: 'Palabras como *yo*, *tú* y *ella* son pronombres de sujeto: dicen quién hace la acción. El inglés los necesita siempre. El español muchas veces los omite, porque la terminación ya dice quién.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hablo* español.', en: 'I speak Spanish.', check: [{ entry: 'hablar', tense: 'present', person: 'yo' }] },
            { es: '¿*Tienes* hambre?', en: 'Are you hungry?', check: [{ entry: 'tener', tense: 'present', person: 'tu' }] },
            { es: '*Somos* de California.', en: 'We’re from California.', check: [{ entry: 'ser', tense: 'present', person: 'nosotros' }] },
            { es: '*Quiero* un taco.', en: 'I want a taco.', check: [{ entry: 'querer', tense: 'present', person: 'yo' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'In English, “speak Spanish” on its own sounds like an order. In Spanish, *Hablo español* is a full sentence: the *-o* means “I”.',
            es: 'En inglés, “speak Spanish”, sin más, suena a una orden. En español, *Hablo* español es una oración completa: la *-o* ya dice “yo”.',
          },
        },
      ],
      keyIdea: {
        en: 'The ending already says who, so Spanish often drops *yo*, *tú*, *él* and the rest.',
        es: 'La terminación ya dice quién, así que el español muchas veces omite *yo*, *tú*, *él* y los demás.',
      },
    },
    {
      id: 'basics-se-verbs',
      title: { en: 'Verbs ending in *-se*', es: 'Verbos que terminan en -se' },
      when: { kind: 'pronominal' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some verbs in the verb list end in *-se*, like *llamarse*. That’s still a dictionary form: an *-ar*, *-er* or *-ir* verb with *-se* on the end (*llamar* + *se*), so the part before the *-se* gives its family. The *-se* tells you the verb comes with a small pronoun, a reflexive pronoun, that matches the person: *me*, *te*, *se*…',
            es: 'Algunos verbos de la lista terminan en *-se*, como *llamarse*. Esa también es una forma de diccionario: un verbo en *-ar*, *-er* o *-ir* con *-se* al final (*llamar* + *se*), así que su familia la decide la parte que va antes del *-se*. El *-se* indica que el verbo va con un pronombre reflexivo que concuerda con la persona: *me*, *te*, *se*…',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me llamo* Sofía.', en: 'My name is Sofía.', check: [{ entry: 'llamarse', tense: 'present', person: 'yo' }] },
            { es: '¿Cómo *te llamas*?', en: 'What’s your name?', check: [{ entry: 'llamarse', tense: 'present', person: 'tu' }] },
            { es: 'Mi perro *se llama* Toby.', en: 'My dog’s name is Toby.', check: [{ entry: 'llamarse', tense: 'present', person: 'el' }] },
          ],
        },
        { kind: 'deckVerbs', verbKind: 'pronominal', text: { en: 'In this deck:', es: 'En este mazo:' } },
        {
          kind: 'tip',
          text: {
            en: 'The pronoun is part of the answer: *yo (llamarse)* → *me llamo*. In a “name the verb” question, the verb keeps its *-se*: *me llamo* is *llamarse*, not *llamar*. The chapter on *-se* verbs has the details.',
            es: 'El pronombre reflexivo es parte de la respuesta: *yo (llamarse)* → *me llamo*. En una pregunta de “nombra el verbo”, el verbo conserva el *-se*: *me llamo* es *llamarse*, no *llamar*. El capítulo de los verbos en *-se* tiene los detalles.',
          },
        },
      ],
      keyIdea: {
        en: 'A verb ending in *-se* is still a dictionary form, and its pronoun (*me*, *te*, *se*…) is part of every answer.',
        es: 'Un verbo que termina en *-se* también es una forma de diccionario, y su pronombre reflexivo (*me*, *te*, *se*…) es parte de cada respuesta.',
      },
    },
    {
      id: 'basics-le-verbs',
      title: { en: '*gustarle*: the app’s *-le* names', es: 'gustarle: los nombres en -le de la app' },
      when: { kind: 'dative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'You won’t find *gustarle* in a dictionary. It’s this app’s name for *gustar* used the *me gusta* way: the verb matches the thing liked, and a small pronoun (*me*, *te*, *le*…) says who likes it.',
            es: 'No vas a encontrar *gustarle* en un diccionario. Es el nombre que usa esta app para *gustar* cuando se usa como en *me gusta*: el verbo concuerda con lo que gusta, y un pronombre (*me*, *te*, *le*…) dice a quién le gusta.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me gusta* el chocolate.', en: 'I like chocolate.', check: [{ entry: 'gustarle', tense: 'present', person: 'yo', number: 'sg' }] },
            { es: '*Me gustan* los perros.', en: 'I like dogs.', check: [{ entry: 'gustarle', tense: 'present', person: 'yo', number: 'pl' }] },
            { es: '¿*Te gusta* bailar?', en: 'Do you like to dance?', check: [{ entry: 'gustarle', tense: 'present', person: 'tu', number: 'sg' }] },
          ],
        },
        {
          kind: 'list',
          items: [
            {
              en: 'The “who” is the person who likes it, and the quiz writes it the *gustar* way: *a mí* “to me”, *a ti* “to you”, *a él / a ella / a usted*, *a nosotros / a nosotras*, *a ellos / a ellas / a ustedes*.',
              es: 'El “quién” es la persona a quien le gusta, y la práctica lo escribe así: *a mí*, *a ti*, *a él / a ella / a usted*, *a nosotros / a nosotras*, *a ellos / a ellas / a ustedes*.',
            },
            {
              en: '“Give the form”: *a mí (gustarle) + el chocolate* → *me gusta*.',
              es: '“Da la forma”: *a mí (gustarle) + el chocolate* → *me gusta*.',
            },
            {
              en: '“Name the verb”: the options call it *gustarle*, as in *gustarle · a mí*.',
              es: '“Nombra el verbo”: las opciones lo llaman *gustarle*, como en *gustarle · a mí*.',
            },
          ],
        },
        { kind: 'deckVerbs', verbKind: 'dative', text: { en: 'In this deck:', es: 'En este mazo:' } },
      ],
      keyIdea: {
        en: '*gustarle* is the app’s name for *gustar* as in *me gusta*. When you name it, *gustar* or *gustarle* both count.',
        es: '*gustarle* es el nombre de la app para *gustar* como en *me gusta*. Cuando lo nombras, *gustar* y *gustarle* cuentan igual.',
      },
    },
    {
      id: 'basics-impersonal',
      title: { en: '*hay* and weather verbs: no “who”', es: 'hay y los verbos del clima: sin “quién”' },
      when: { kind: 'impersonal' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A few verbs have no “who”. *Hay* means “there is” or “there are”. It comes from *haber*, so the verb list shows *haber* with an “impersonal” tag. Weather verbs like *llover* “to rain” work the same way, and so does *hacer* in *hace frío* “it’s cold”. Each has just one form per tense, so the quiz never asks who.',
            es: 'Algunos verbos no tienen un “quién”. *Hay* viene de *haber*, por eso la lista de verbos muestra *haber* con la etiqueta “impersonal”. Los verbos del clima, como *llover*, funcionan igual, y también *hacer* en *hace frío*. Cada uno tiene una sola forma en cada tiempo verbal, así que la práctica nunca pregunta quién.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hay* una pizza en la mesa.', en: 'There’s a pizza on the table.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: '*Hay* treinta estudiantes en la clase.', en: 'There are thirty students in the class.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: '*Llueve* mucho en invierno.', en: 'It rains a lot in winter.', check: [{ entry: 'llover', tense: 'present', person: 'el' }] },
            { es: 'Hoy *hace* frío.', en: 'It’s cold today.', check: [{ entry: 'hacer-impersonal', tense: 'present', person: 'el' }] },
          ],
        },
        {
          kind: 'list',
          items: [
            {
              en: '“Give the form”: you see *haber* with an “impersonal” tag and no person. In the present, the answer is *hay*.',
              es: '“Da la forma”: ves *haber* con la etiqueta “impersonal” y sin persona. En el presente, la respuesta es *hay*.',
            },
            {
              en: '“Name the verb”: *hay* → *haber*; *llueve* → *llover*; *hace* (as in *hace frío*) → *hacer*.',
              es: '“Nombra el verbo”: *hay* → *haber*; *llueve* → *llover*; *hace* (como en *hace frío*) → *hacer*.',
            },
          ],
        },
        { kind: 'deckVerbs', verbKind: 'impersonal', text: { en: 'In this deck:', es: 'En este mazo:' } },
      ],
      keyIdea: {
        en: '*hay* and the weather verbs have one form per tense and no person: *hay* is both “there is” and “there are”.',
        es: '*hay* y los verbos del clima tienen una sola forma en cada tiempo verbal y ninguna persona: *hay* sirve para una cosa o para muchas.',
      },
    },
  ],
};

const persons: Chapter = {
  id: 'persons',
  title: { en: 'Who? The persons', es: '¿Quién? Las personas' },
  summary: {
    en: '*yo*, *tú*, *usted* and the rest: who each form is for, and how the quiz labels them.',
    es: '*yo*, *tú*, *usted* y los demás: para quién es cada forma y cómo las muestra esta práctica.',
  },
  sections: [
    {
      id: 'persons-glance',
      title: { en: 'The persons at a glance', es: 'Las personas de un vistazo' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In grammar, the person is who does the action: the one speaking (“I”, “we”), the one spoken to (“you”, “you all”), or someone else (“he”, “she”, “they”). Each person has its own form of the verb.',
            es: 'En gramática, la persona es quien hace la acción: quien habla (yo, nosotros), a quien le hablas (tú, ustedes) o alguien más (él, ella, ellos). Cada persona tiene su propia forma del verbo.',
          },
        },
        {
          kind: 'compare',
          head: [{ en: 'In Spanish', es: 'En español' }, { en: 'In English', es: 'En inglés' }],
          rows: [
            [{ en: '*yo*', es: '*yo*' }, { en: 'I', es: 'I' }],
            [{ en: '*tú*', es: '*tú*' }, { en: 'you (a friend, a classmate, family)', es: 'you (un amigo, un compañero, la familia)' }],
            [{ en: '*él / ella / usted*', es: '*él / ella / usted*' }, { en: 'he / she / you (formal)', es: 'he / she / you (formal: usted)' }],
            [{ en: '*nosotros / nosotras*', es: '*nosotros / nosotras*' }, { en: 'we', es: 'we' }],
            [{ en: '*ellos / ellas / ustedes*', es: '*ellos / ellas / ustedes*' }, { en: 'they / you all', es: 'they / you (plural: ustedes)' }],
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'The first three rows are singular (one person). The last two are plural (more than one).',
            es: 'Las tres primeras filas son singulares (una persona). Las dos últimas son plurales (más de una).',
          },
        },
        {
          kind: 'tip',
          text: {
            en: 'Watch the accent mark: *tú* “you” but *tu* “your”; *él* “he” but *el* “the”.',
            es: 'Ojo con la tilde: *tú* es pronombre y *tu* es posesivo (tu casa); *él* es pronombre y *el* es artículo (el perro).',
          },
        },
      ],
      keyIdea: {
        en: 'Every verb form belongs to a person: *yo*, *tú*, *él / ella / usted*, *nosotros / nosotras* or *ellos / ellas / ustedes*.',
        es: 'Cada forma verbal pertenece a una persona: *yo*, *tú*, *él / ella / usted*, *nosotros / nosotras* o *ellos / ellas / ustedes*.',
      },
    },
    {
      id: 'persons-usted',
      title: { en: '*usted* and *ustedes*', es: 'usted y ustedes' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Spanish has more than one word for “you”:',
            es: 'En español hay más de una manera de dirigirse a alguien:',
          },
        },
        {
          kind: 'list',
          items: [
            {
              en: '*tú*: one person you’re close to: a friend, a classmate, a brother or sister, a child.',
              es: '*tú*: una persona de confianza: un amigo, un compañero, un hermano, un niño.',
            },
            {
              en: '*usted*: one person you speak to with respect: a teacher, a boss, an older neighbor, a stranger.',
              es: '*usted*: una persona a quien le hablas con respeto: un profesor, un jefe, un vecino mayor, un desconocido.',
            },
            {
              en: '*ustedes*: more than one person, “you all”. In Latin America it’s for friends and teachers alike.',
              es: '*ustedes*: más de una persona. En Latinoamérica sirve igual para amigos y para profesores.',
            },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'Here’s the key: *usted* takes the same form as *él* and *ella*, and *ustedes* the same form as *ellos* and *ellas*.',
            es: 'La clave: *usted* usa la misma forma que *él* y *ella*, y *ustedes* la misma que *ellos* y *ellas*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Carlos, ¿*tienes* un lápiz?', en: 'Carlos, do you have a pencil?', check: [{ entry: 'tener', tense: 'present', person: 'tu' }] },
            { es: 'Señora Díaz, ¿usted *tiene* un lápiz?', en: 'Mrs. Díaz, do you have a pencil?', check: [{ entry: 'tener', tense: 'present', person: 'el' }] },
            { es: '¿Ustedes *son* de aquí?', en: 'Are you all from here?', check: [{ entry: 'ser', tense: 'present', person: 'ellos' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'You’ll often see *usted* written *Ud.* and *ustedes* written *Uds.*',
            es: 'A menudo verás *usted* escrito *Ud.* y *ustedes* escrito *Uds.*',
          },
        },
      ],
      keyIdea: {
        en: '*usted* takes the *él / ella* form; *ustedes* takes the *ellos / ellas* form.',
        es: '*usted* usa la forma de *él / ella*; *ustedes*, la de *ellos / ellas*.',
      },
    },
    {
      id: 'persons-quiz-labels',
      title: { en: 'How the quiz shows who', es: 'Cómo indica la práctica la persona' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some persons always share one form: *él*, *ella* and *usted* all take *tiene*, and *ellos*, *ellas* and *ustedes* all take *tienen*. A “give the form” question names one of them at a time, before the dictionary form (infinitive) in parentheses. They take turns, so you meet all of them:',
            es: 'Algunas personas siempre comparten una forma: *él*, *ella* y *usted* usan *tiene*, y *ellos*, *ellas* y *ustedes* usan *tienen*. Una pregunta de “da la forma” nombra una de ellas cada vez, antes de la forma de diccionario (infinitivo) entre paréntesis. Se turnan, así que las ves todas:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*yo (tener)* → *tengo*', es: '*yo (tener)* → *tengo*' },
            { en: '*ella (tener)* → *tiene*, and *usted (tener)* → *tiene* too', es: '*ella (tener)* → *tiene*, y también *usted (tener)* → *tiene*' },
            { en: '*nosotras (tener)* → *tenemos*', es: '*nosotras (tener)* → *tenemos*' },
            { en: '*ustedes (tener)* → *tienen*, the same as *ellos (tener)* and *ellas (tener)*', es: '*ustedes (tener)* → *tienen*, igual que *ellos (tener)* y *ellas (tener)*' },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'After you answer, the quiz lists everyone who shares the form: *tienen = ellos · ellas · ustedes*. In multiple choice, a grey line under *usted* or *ustedes* says what it means: “you (formal)” or “you all”.',
            es: 'Después de contestar, la práctica muestra a todos los que comparten la forma: *tienen = ellos · ellas · ustedes*. En las preguntas de opción múltiple, una línea gris debajo de *usted* o *ustedes* dice qué significa.',
          },
        },
        {
          kind: 'p',
          text: {
            en: '“Name the verb” questions name one person in their answers too: *tener · ustedes*. When every option is a form of the same verb, the question names the verb, and the options say only who: *ustedes*.',
            es: 'Las preguntas de “nombra el verbo” también nombran una sola persona en sus respuestas: *tener · ustedes*. Cuando todas las opciones son formas del mismo verbo, la pregunta nombra el verbo y las opciones dicen solo quién: *ustedes*.',
          },
        },
      ],
      keyIdea: {
        en: '*ellos*, *ellas* and *ustedes* always share one form: *ustedes (tener)* → *tienen*, the same as *ellos (tener)*.',
        es: '*ellos*, *ellas* y *ustedes* siempre comparten una forma: *ustedes (tener)* → *tienen*, igual que *ellos (tener)*.',
      },
    },
    {
      id: 'persons-who-subject',
      title: { en: 'Who is the subject?', es: '¿Quién es el sujeto?' },
      // v1.25.0: opens the first time a student meets a question shown as a sentence.
      when: { sentenceSeen: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some questions are a sentence with a blank: *Mis primos … (vivir) en Lima.* The subject comes before the blank, and it tells you who. *Mis primos* “my cousins” are more than one person, the same as *ellos*, so the verb takes the *ellos* form: *viven*.',
            es: 'Algunas preguntas son una frase con un espacio en blanco: *Mis primos … (vivir) en Lima.* El sujeto va antes del espacio y te dice quién. *Mis primos* son más de una persona, igual que *ellos*, así que el verbo usa la forma de *ellos*: *viven*.',
          },
        },
        {
          kind: 'subjects',
          verb: 'vivir',
          caption: { en: 'Subjects from your sentences, and the pronoun each one is the same as:', es: 'Sujetos de tus frases, y el pronombre que es igual a cada uno:' },
        },
        {
          kind: 'list',
          items: [
            { en: 'One person or thing is *él* or *ella*: *mi abuela* → *ella* → *vive*', es: 'Una persona o cosa es *él* o *ella*: *mi abuela* → *ella* → *vive*' },
            { en: 'Two or more are *ellos* or *ellas*: *Ana y Luis* → *ellos* → *viven*', es: 'Dos o más son *ellos* o *ellas*: *Ana y Luis* → *ellos* → *viven*' },
            { en: 'Someone and *yo* are *nosotros*: *mi hermano y yo* → *nosotros* → *vivimos*', es: 'Alguien y *yo* son *nosotros*: *mi hermano y yo* → *nosotros* → *vivimos*' },
            { en: 'Someone and *tú* are *ustedes*: *Ana y tú* → *ustedes* → *viven*', es: 'Alguien y *tú* son *ustedes*: *Ana y tú* → *ustedes* → *viven*' },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: '*tu* with no accent means “your”: *tu perro* “your dog”. *tú* with an accent means “you”. Only *tú* can be the subject.',
            es: '*tu* sin acento quiere decir “your”: *tu perro*. *tú* con acento quiere decir “you”. Solo *tú* puede ser el sujeto.',
          },
        },
        {
          kind: 'p',
          text: {
            en: 'In multiple choice, the pronoun shows in grey after the subject: *Mis primos (ellos)*. When you type, it does not: find it in the subject. After you answer, the quiz shows the whole sentence, what it means, and *mis primos = ellos → viven*.',
            es: 'En las preguntas de opción múltiple, el pronombre sale en gris después del sujeto: *Mis primos (ellos)*. Cuando escribes, no sale: búscalo en el sujeto. Después de contestar, la práctica muestra la frase entera, qué quiere decir, y *mis primos = ellos → viven*.',
          },
        },
      ],
      keyIdea: {
        en: 'The subject before the blank tells you who: *mis primos* is *ellos*, so *viven*.',
        es: 'El sujeto antes del espacio te dice quién: *mis primos* es *ellos*, así que *viven*.',
      },
    },
    {
      id: 'persons-who-subject-gustar',
      title: { en: 'Who is it, with *gustar*?', es: '¿Quién es, con gustar?' },
      when: { all: [{ sentenceSeen: true }, { kind: 'dative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'With *gustar*, the sentence starts with *a* and the person who likes it: *A mi abuela … (gustar) los gatos.* That person picks the pronoun before the verb: *me* for *a mí*, *te* for *a ti*, *nos* when you are one of them (*a mi amigo y a mí*), *le* for one other person and *les* for more than one. But the verb goes with the thing liked, after the blank: *los gatos* is plural, so *gustan*.',
            es: 'Con *gustar*, la frase empieza con *a* y la persona a quien le gusta: *A mi abuela … (gustar) los gatos.* Esa persona decide el pronombre antes del verbo: *me* con *a mí*, *te* con *a ti*, *nos* cuando tú estás en el grupo (*a mi amigo y a mí*), *le* para otra persona y *les* para más de una. Pero el verbo va con la cosa que gusta, después del espacio: *los gatos* es plural, así que *gustan*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'A mi abuela *le gustan* los gatos.', en: 'My grandmother likes cats.', check: [{ entry: 'gustarle', tense: 'present', person: 'el', number: 'pl' }] },
            { es: 'A mis primos *les gusta* el perro.', en: 'My cousins like the dog.', check: [{ entry: 'gustarle', tense: 'present', person: 'ellos', number: 'sg' }] },
            { es: 'A mi amigo y a mí *nos gusta* Lima.', en: 'My friend and I like Lima.', check: [{ entry: 'gustarle', tense: 'present', person: 'nosotros', number: 'sg' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'More than one person does not make *gustar* plural: *A mis primos les gusta el perro* (one dog). Only the thing liked decides *gusta* or *gustan*.',
            es: 'Más de una persona no hace plural a *gustar*: *A mis primos les gusta el perro* (un perro). Solo la cosa que gusta decide *gusta* o *gustan*.',
          },
        },
      ],
      keyIdea: {
        en: 'The person picks the pronoun (*me*, *te*, *le*, *nos*, *les*); the thing liked picks *gusta* or *gustan*.',
        es: 'La persona decide el pronombre (*me*, *te*, *le*, *nos*, *les*); la cosa que gusta decide *gusta* o *gustan*.',
      },
    },
    {
      id: 'persons-command-labels',
      title: { en: 'Who, in commands', es: 'Quién, en los mandatos' },
      when: { any: [{ tense: 'imperativeAffirmative' }, { tense: 'imperativeNegative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A command tells someone to do something: “Speak!”, “Don’t eat that!”. You give orders to the person you’re talking to, not to “he” or “they”. So in commands the quiz writes just *usted* or *ustedes*. And there’s no *yo*: you don’t give yourself orders. With *nosotros / nosotras*, a command means “let’s”: *hablemos* “let’s speak”.',
            es: 'Un mandato le pide a alguien que haga algo. Los mandatos se le dan a la persona con quien hablas, no a “él” ni a “ellos”. Por eso, en los mandatos la práctica escribe solo *usted* o *ustedes*. Y no hay *yo*: uno no se da órdenes a sí mismo. Con *nosotros / nosotras*, el mandato te incluye a ti también: *hablemos* es “let’s speak”.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hable* más despacio, por favor.', en: 'Speak more slowly, please.', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'el' }] },
            { es: '*Hablen* en español, por favor.', en: 'Speak in Spanish, please. (to a group)', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'ellos' }] },
            { es: '¡*Hablemos* en español!', en: 'Let’s speak Spanish!', check: [{ entry: 'hablar', tense: 'imperativeAffirmative', person: 'nosotros' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'In a “name the verb” question about a command, the options say just *usted* or *ustedes*.',
            es: 'En una pregunta de “nombra el verbo” sobre un mandato, las opciones dicen solo *usted* o *ustedes*.',
          },
        },
      ],
      keyIdea: {
        en: 'In commands, the quiz says *usted* and *ustedes*, and there is no *yo*.',
        es: 'En los mandatos, la práctica dice *usted* y *ustedes*, y no hay *yo*.',
      },
    },
    {
      id: 'persons-gender',
      title: { en: '*nosotras* and *ellas*', es: 'nosotras y ellas' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some pronouns show gender. Use *nosotras* “we” and *ellas* “they” for a group of only women or girls. For a group of only men or boys, or a mixed group, use *nosotros* and *ellos*. The verb form stays the same.',
            es: 'Algunos pronombres muestran el género. Usa *nosotras* y *ellas* para un grupo solo de mujeres o de chicas. Para un grupo solo de hombres o de chicos, o para un grupo mixto, usa *nosotros* y *ellos*. La forma del verbo no cambia.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Nosotras *vamos* al cine.', en: 'We (girls) are going to the movies.', check: [{ entry: 'ir', tense: 'present', person: 'nosotros' }] },
            { es: 'Ellas *están* en la clase de español.', en: 'They (the girls) are in Spanish class.', check: [{ entry: 'estar', tense: 'present', person: 'ellos' }] },
            {
              es: 'Ana y Marcos *son* mis amigos. Ellos *quieren* pizza.',
              en: 'Ana and Marcos are my friends. They want pizza.',
              check: [
                { entry: 'ser', tense: 'present', person: 'ellos' },
                { entry: 'querer', tense: 'present', person: 'ellos' },
              ],
            },
          ],
        },
      ],
      keyIdea: {
        en: '*nosotras* and *ellas* are for groups of only women or girls. The verb form is the same as for *nosotros* and *ellos*.',
        es: '*nosotras* y *ellas* son para grupos solo de mujeres o de chicas. La forma del verbo es la misma que con *nosotros* y *ellos*.',
      },
    },
    {
      id: 'persons-optional',
      title: { en: 'When to say *yo*, *tú*, *él*…', es: 'Cuándo decir yo, tú, él…' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Since the ending says who, you can usually leave the subject pronoun out: *Tengo un perro*. Put it in when you want to:',
            es: 'Como la terminación dice quién, casi siempre puedes omitir el pronombre de sujeto: *Tengo* un perro. Úsalo cuando quieras:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: 'compare or contrast people', es: 'comparar o contrastar a varias personas' },
            { en: 'stress who you mean', es: 'destacar de quién hablas' },
            {
              en: 'make it clear, since one form can go with *él*, *ella* or *usted*',
              es: 'dejar claro quién es, porque una misma forma puede ser de *él*, *ella* o *usted*',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            {
              es: 'Yo *soy* de aquí, pero ella *es* de México.',
              en: 'I’m from here, but she’s from Mexico.',
              check: [
                { entry: 'ser', tense: 'present', person: 'yo' },
                { entry: 'ser', tense: 'present', person: 'el' },
              ],
            },
            { es: 'Estoy bien. ¿Y tú? ¿Cómo *estás*?', en: 'I’m fine. And you? How are you?', check: [{ entry: 'estar', tense: 'present', person: 'tu' }] },
            { es: '¿Usted *es* la profesora?', en: 'Are you the teacher?', check: [{ entry: 'ser', tense: 'present', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'In the quiz, the verb form alone is the answer: *tengo*. When you type, you may add a subject pronoun that fits (*yo tengo*).',
            es: 'En esta práctica, la forma verbal sola es la respuesta: *tengo*. Cuando escribes, también puedes poner el pronombre que corresponde (*yo tengo*).',
          },
        },
      ],
      keyIdea: {
        en: 'Leave the subject pronoun out unless you need it to contrast, stress or make things clear.',
        es: 'Omite el pronombre de sujeto a menos que lo necesites para contrastar, destacar o aclarar.',
      },
    },
    {
      id: 'persons-vosotros',
      title: { en: '*vosotros*: “you all” in Spain', es: 'vosotros: el plural de tú en España' },
      when: { vosotros: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In Spain, *vosotros* (or *vosotras*, for a group of only women or girls) is the plural “you” for friends and family; *ustedes* is kept for speaking with respect. It has its own endings. In the present they are *-áis*, *-éis* and *-ís*.',
            es: 'En España, *vosotros* (o *vosotras*, para un grupo solo de mujeres o de chicas) es el plural de *tú*, para amigos y familia; *ustedes* se reserva para hablar con respeto. Tiene sus propias terminaciones. En el presente son *-áis*, *-éis* e *-ís*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¿*Habláis* inglés?', en: 'Do you all speak English?', check: [{ entry: 'hablar', tense: 'present', person: 'vosotros' }] },
            { es: '¿Qué *coméis* hoy?', en: 'What are you all eating today?', check: [{ entry: 'comer', tense: 'present', person: 'vosotros' }] },
            { es: '¿Vosotras *vivís* en Madrid?', en: 'Do you (girls) live in Madrid?', check: [{ entry: 'vivir', tense: 'present', person: 'vosotros' }] },
            { es: '*Sois* muy simpáticos.', en: 'You guys are really nice.', check: [{ entry: 'ser', tense: 'present', person: 'vosotros' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Mind the accent marks: *habláis*, *coméis*, *vivís*.',
            es: 'Fíjate en las tildes: *habláis*, *coméis*, *vivís*.',
          },
        },
      ],
      keyIdea: {
        en: '*vosotros* is Spain’s plural “you” for friends. In the present its endings are *-áis*, *-éis* and *-ís*.',
        es: '*vosotros* es el plural de *tú* en España. En el presente sus terminaciones son *-áis*, *-éis* e *-ís*.',
      },
    },
    {
      id: 'persons-no-vosotros',
      title: { en: 'About *vosotros*', es: 'Sobre vosotros' },
      when: { vosotros: false },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In Spain you’ll hear one more person: *vosotros / vosotras*, “you all” among friends (*¿Habláis inglés?*). Latin America uses *ustedes* for that, and so does this practice: it leaves *vosotros* out.',
            es: 'En España vas a oír una persona más: *vosotros / vosotras*, el plural de *tú* entre amigos (*habláis*). En Latinoamérica se usa *ustedes*, y esta práctica hace lo mismo: deja fuera *vosotros*.',
          },
        },
      ],
    },
    {
      id: 'persons-vos',
      title: { en: '*vos*: another “you”', es: 'vos: otra forma de tú' },
      when: { vos: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In much of Central America and in Argentina and Uruguay, people say *vos* to one person they’re close to, where others say *tú*. In this practice, *vos* borrows the *tú* form almost everywhere. It has its own forms in three places:',
            es: 'En gran parte de Centroamérica y en Argentina y Uruguay se usa *vos* con una persona de confianza, donde otros dicen *tú*. En esta práctica, *vos* toma casi siempre la forma de *tú*. Tiene formas propias en tres casos:',
          },
        },
        {
          kind: 'list',
          items: [
            {
              en: 'The present: *hablás*, *comés*, *vivís*, and *sos* for *ser*.',
              es: 'El presente: *hablás*, *comés*, *vivís*, y *sos* para *ser*.',
            },
            {
              en: 'Affirmative commands: *hablá*, *comé*, *viví*.',
              es: 'Los mandatos afirmativos: *hablá*, *comé*, *viví*.',
            },
            {
              en: 'The present subjunctive and negative commands: the region your teacher picked decides which form the quiz gives. Río de la Plata (Argentina, Uruguay): *no hables*. Central America: *no hablés*. The other form counts too.',
              es: 'El presente de subjuntivo y los mandatos negativos: la región que eligió tu profesor / profesora decide qué forma da la práctica. Río de la Plata (Argentina, Uruguay): *no hables*. Centroamérica: *no hablés*. La otra forma también cuenta.',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '¿Vos *hablás* inglés?', en: 'Do you speak English?', check: [{ entry: 'hablar', tense: 'present', person: 'vos' }] },
            { es: '¿De dónde *sos*?', en: 'Where are you from?', check: [{ entry: 'ser', tense: 'present', person: 'vos' }] },
            { es: '¿*Tenés* hambre?', en: 'Are you hungry?', check: [{ entry: 'tener', tense: 'present', person: 'vos' }] },
            { es: '*Comé* algo, por favor.', en: 'Eat something, please.', check: [{ entry: 'comer', tense: 'imperativeAffirmative', person: 'vos' }] },
            {
              es: '*No hables* tan rápido.',
              en: 'Don’t talk so fast. (Río de la Plata)',
              check: [{ entry: 'hablar', tense: 'imperativeNegative', person: 'vos', vosRegion: 'rioplatense' }],
            },
            {
              es: '*No hablés* tan rápido.',
              en: 'Don’t talk so fast. (Central America)',
              check: [{ entry: 'hablar', tense: 'imperativeNegative', person: 'vos', vosRegion: 'centroamericano' }],
            },
          ],
        },
        {
          kind: 'p',
          text: {
            en: 'Every other tense uses the *tú* form: *vos hablaste*, *vos hablabas*.',
            es: 'Todos los demás tiempos verbales usan la forma de *tú*: *vos hablaste*, *vos hablabas*.',
          },
        },
      ],
      keyIdea: {
        en: '*vos* has its own forms in the present (*hablás*, *sos*) and in affirmative commands (*hablá*). In negative commands and the present subjunctive, the region decides (*no hables* or *no hablés*). Everywhere else it uses the *tú* form.',
        es: '*vos* tiene formas propias en el presente (*hablás*, *sos*) y en los mandatos afirmativos (*hablá*). En los mandatos negativos y el presente de subjuntivo, decide la región (*no hables* o *no hablés*). En todo lo demás usa la forma de *tú*.',
      },
    },
  ],
};

export default [basics, persons];
