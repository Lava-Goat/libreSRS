// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The chapters on the kinds of verb that do not conjugate by subject alone:
 * verbs with -se (me llamo), verbs like gustar (me gusta, me gustan) and the
 * verbs with no person at all (hay, llueve, hace frío). Each opens when the
 * deck has a verb of its kind; the parts about other tenses open with those
 * tenses.
 */
import type { Chapter, Condition, L } from '../types';

/** The same text in both languages (Spanish words, pronouns). */
const same = (text: string): L => ({ en: text, es: text });

const THE_SE_VERBS: L = { en: 'The *-se* verbs in this deck:', es: 'Los verbos con *-se* de este mazo:' };

/** The deck has a weather verb: llover, nevar, hacer as in hace frío, and the rarer ones. */
const WEATHER: Condition = {
  any: [
    { verb: 'llover' },
    { verb: 'nevar' },
    { verb: 'hacer-impersonal' },
    { verb: 'lloviznar' },
    { verb: 'granizar' },
    { verb: 'tronar' },
    { verb: 'relampaguear' },
    { verb: 'diluviar' },
    { verb: 'escarchar' },
    { verb: 'garuar' },
  ],
};

const HAY: Condition = { verb: 'haber-impersonal' };

const pronominal: Chapter = {
  id: 'pronominal',
  title: { en: 'Verbs with *-se*', es: 'Verbos con *-se*' },
  summary: {
    en: 'Verbs like *llamarse* come with a pronoun that matches the subject: *me llamo*, *te llamas*.',
    es: 'Verbos como *llamarse* llevan un pronombre que concuerda con el sujeto: *me llamo*, *te llamas*.',
  },
  when: { kind: 'pronominal' },
  sections: [
    {
      id: 'pronominal-what',
      title: { en: 'What the *-se* means', es: 'Qué significa el *-se*' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Some verbs have a dictionary form (infinitive) that ends in *-se*, like *llamarse* and *verse*. The *-se* tells you the verb always comes with a small word, a reflexive pronoun, that matches the subject (who the sentence is about).',
            es: 'Algunos verbos tienen una forma de diccionario (infinitivo) que termina en *-se*, como *llamarse* y *verse*. El *-se* te avisa que el verbo siempre va con una palabrita, un pronombre reflexivo, que concuerda con el sujeto (de quien habla la oración).',
          },
        },
        {
          kind: 'compare',
          head: [
            { en: 'Subject pronoun', es: 'Pronombre de sujeto' },
            { en: 'Reflexive pronoun', es: 'Pronombre reflexivo' },
          ],
          rows: [
            [same('*yo*'), same('*me*')],
            [same('*tú*'), same('*te*')],
            [same('*él / ella / usted*'), same('*se*')],
            [same('*nosotros / nosotras*'), same('*nos*')],
            [same('*ellos / ellas / ustedes*'), same('*se*')],
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: 'Yo *me llamo* Ana.', en: 'My name is Ana.', check: [{ entry: 'llamarse', tense: 'present', person: 'yo' }] },
            { es: '¿Cómo *te llamas*?', en: 'What’s your name?', check: [{ entry: 'llamarse', tense: 'present', person: 'tu' }] },
            { es: 'Mi mejor amigo *se llama* Diego.', en: 'My best friend’s name is Diego.', check: [{ entry: 'llamarse', tense: 'present', person: 'el' }] },
            { es: 'Ellas *se llaman* Sofía y Lucía.', en: 'Their names are Sofía and Lucía.', check: [{ entry: 'llamarse', tense: 'present', person: 'ellos' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'A *-se* verb always travels with its pronoun, and the pronoun matches who the sentence is about: *me llamo*, *te llamas*, *se llama*.',
        es: 'Un verbo con *-se* siempre va con su pronombre, y el pronombre concuerda con el sujeto: *me llamo*, *te llamas*, *se llama*.',
      },
    },
    {
      id: 'pronominal-vosotros',
      title: { en: 'With *vosotros*: *os*', es: 'Con *vosotros*: *os*' },
      when: { vosotros: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*vosotros* (“you all”, as it’s said in Spain) has its own pronoun: *os*.',
            es: '*vosotros* (el plural de *tú* que se usa en España) tiene su propio pronombre: *os*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¿Cómo *os llamáis*?', en: 'What are your names? (in Spain)', check: [{ entry: 'llamarse', tense: 'present', person: 'vosotros' }] },
          ],
        },
      ],
    },
    {
      id: 'pronominal-vos',
      title: { en: 'With *vos*: *te*', es: 'Con *vos*: *te*' },
      when: { vos: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*vos* takes the same pronoun as *tú*: *te*. The verb can differ (*te llamás* in the present), but the pronoun never does.',
            es: '*vos* lleva el mismo pronombre que *tú*: *te*. El verbo puede cambiar (*te llamás* en el presente), pero el pronombre no.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Y vos, ¿cómo *te llamás*?', en: 'And you, what’s your name?', check: [{ entry: 'llamarse', tense: 'present', person: 'vos', vosRegion: 'rioplatense' }] },
          ],
        },
      ],
    },
    {
      id: 'pronominal-present',
      title: { en: 'In the present', es: 'En el presente' },
      when: { tense: 'present' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Here are *llamarse* (“to be called, to be named”) and *verse* (“to look”, as in how you look) in the present. Both parts change with the person: the pronoun and the ending.',
            es: 'Aquí tienes *llamarse* y *verse* en el presente. Las dos partes cambian con la persona: el pronombre y la terminación.',
          },
        },
        {
          kind: 'paradigm',
          tense: 'present',
          entries: ['llamarse', 'verse'],
        },
        { kind: 'deckVerbs', tense: 'present', verbKind: 'pronominal', text: THE_SE_VERBS },
      ],
    },
    {
      id: 'pronominal-meaning',
      title: { en: 'What the pronoun adds', es: 'Qué aporta el pronombre' },
      blocks: [
        {
          kind: 'list',
          items: [
            {
              en: 'Sometimes it means “myself”, “yourself”, “herself”…: the action comes back to the person who does it.',
              es: 'A veces significa “a mí mismo”, “a ti mismo”, “a sí misma”…: la acción vuelve a la persona que la hace.',
            },
            {
              en: 'Sometimes it’s just part of what the verb means: *llamarse* is “to be called, to be named”, and *verse* can be “to look (a certain way)”.',
              es: 'A veces es simplemente parte del significado: *llamarse* es tener un nombre, y *verse* puede ser tener cierto aspecto.',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me veo* en el espejo.', en: 'I see myself in the mirror.', check: [{ entry: 'verse', tense: 'present', person: 'yo' }] },
            {
              es: '¿Cómo *te ves*? — *Me veo* bien.',
              en: 'How do you look? — I look good.',
              check: [
                { entry: 'verse', tense: 'present', person: 'tu' },
                { entry: 'verse', tense: 'present', person: 'yo' },
              ],
            },
          ],
        },
        {
          kind: 'compare',
          head: [
            { en: 'Without *-se*', es: 'Sin *-se*' },
            { en: 'With *-se*', es: 'Con *-se*' },
          ],
          rows: [
            [
              { en: '*llamar*, “to call”: *Llamo a mi mamá.* (“I call my mom.”)', es: '*llamar*: *Llamo* a mi mamá.' },
              { en: '*llamarse*, “to be called”: *Me llamo Ana.* (“My name is Ana.”)', es: '*llamarse*: *Me llamo* Ana.' },
            ],
            [
              { en: '*ver*, “to see”: *Veo a mis amigos.* (“I see my friends.”)', es: '*ver*: *Veo* a mis amigos.' },
              { en: '*verse*, “to look”: *Me veo cansado.* (“I look tired.”)', es: '*verse*: *Me veo* cansado.' },
            ],
          ],
        },
        {
          kind: 'tip',
          text: {
            en: '*llamar* and *llamarse* are two different verbs, and the app drills each one separately. The “Verbs” list on the quiz page tells you which one your deck has.',
            es: '*llamar* y *llamarse* son dos verbos distintos, y en la app se practican por separado. La lista “Verbos” de la práctica te dice cuál tiene tu mazo.',
          },
        },
      ],
      keyIdea: {
        en: 'Without *-se*, it’s a different verb: *llamo* is “I call”, *me llamo* is “my name is”.',
        es: 'Sin *-se*, es otro verbo: *llamo* es hacer una llamada; *me llamo* es decir tu nombre.',
      },
    },
    {
      id: 'pronominal-placement',
      title: { en: 'Where the pronoun goes', es: 'Dónde va el pronombre' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The pronoun goes right before the conjugated verb (the verb with the ending for its person). To make it negative, *no* goes in front of both: *no* + pronoun + verb.',
            es: 'El pronombre va justo antes del verbo conjugado (el verbo con la terminación de su persona). Para negar, *no* va delante de los dos: *no* + pronombre + verbo.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Mi hermana *se llama* Valeria.', en: 'My sister’s name is Valeria.', check: [{ entry: 'llamarse', tense: 'present', person: 'el' }] },
            {
              es: 'No, no *me llamo* Luis. *Me llamo* Lucas.',
              en: 'No, my name isn’t Luis. It’s Lucas.',
              check: [
                { entry: 'llamarse', tense: 'present', person: 'yo' },
                { entry: 'llamarse', tense: 'present', person: 'yo' },
              ],
            },
            { es: 'Hoy no *me veo* bien.', en: 'I don’t look good today.', check: [{ entry: 'verse', tense: 'present', person: 'yo' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'Pronoun first, then the verb: *me llamo*. With *no*: *no me llamo*.',
        es: 'Primero el pronombre, luego el verbo: *me llamo*. Con *no*: *no me llamo*.',
      },
    },
    {
      id: 'pronominal-tenses',
      title: { en: 'The same spot in other tenses', es: 'El mismo lugar en otros tiempos' },
      when: {
        any: [
          { tense: 'preterite' },
          { tense: 'imperfect' },
          { tense: 'future' },
          { tense: 'conditional' },
          { tense: 'presentSubjunctive' },
          { tense: 'imperfectSubjunctive' },
        ],
      },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In every tense where the verb is a single word, the pronoun stays right before the verb: *me llamo*, *me llamé*, *me llamaba*. Only the verb changes, to that tense’s form. The one exception is an affirmative command, where the pronoun goes on the end: *siéntate*.',
            es: 'En todos los tiempos verbales en los que el verbo es una sola palabra, el pronombre se queda justo antes del verbo: *me llamo*, *me llamé*, *me llamaba*. Solo cambia el verbo, que toma la forma de ese tiempo. La única excepción es el mandato afirmativo, donde el pronombre va al final: *siéntate*.',
          },
        },
        {
          kind: 'deckVerbs',
          tense: 'preterite',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the preterite (*pretérito*):', es: 'En el pretérito:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'imperfect',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the imperfect (*imperfecto*):', es: 'En el imperfecto:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'future',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the future (*futuro*):', es: 'En el futuro:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'conditional',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the conditional (*condicional*):', es: 'En el condicional:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'presentSubjunctive',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the present subjunctive (*presente de subjuntivo*):', es: 'En el presente de subjuntivo:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'imperfectSubjunctive',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the imperfect subjunctive (*imperfecto de subjuntivo*):', es: 'En el imperfecto de subjuntivo:' },
        },
      ],
    },
    {
      id: 'pronominal-progressive',
      title: { en: 'With the *-ando*/*-iendo* form', es: 'Con el gerundio' },
      when: { tense: 'presentProgressive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the present progressive (*estar* + the *-ando*/*-iendo* form, or gerund), the pronoun has two homes: before *estar*, or attached to the end of the *-ando*/*-iendo* form. Both mean the same thing, and the quiz takes either one.',
            es: 'En el presente progresivo (*estar* + gerundio), el pronombre tiene dos lugares: antes de *estar*, o pegado al final del gerundio. Los dos significan lo mismo, y la práctica acepta cualquiera de los dos.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me estoy lavando* las manos.', en: 'I’m washing my hands.', check: [{ entry: 'lavarse', tense: 'presentProgressive', person: 'yo' }] },
            { es: '*Estoy lavándome* las manos.', en: 'I’m washing my hands. (The same thing.)', check: [{ entry: 'lavarse', tense: 'presentProgressive', person: 'yo' }] },
            { es: 'Los niños *se están divirtiendo*.', en: 'The kids are having fun.', check: [{ entry: 'divertirse', tense: 'presentProgressive', person: 'ellos' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Attached, the pronoun adds a syllable, so the *-ando*/*-iendo* form gets an accent mark to keep its stress: *lavando* → *lavándome*, *divirtiendo* → *divirtiéndose*.',
            es: 'Al pegarse, el pronombre añade una sílaba, así que el gerundio lleva tilde para no perder su acento: *lavando* → *lavándome*, *divirtiendo* → *divirtiéndose*.',
          },
        },
        { kind: 'deckVerbs', tense: 'presentProgressive', verbKind: 'pronominal', withTables: true, text: THE_SE_VERBS },
      ],
      keyIdea: {
        en: '*Me estoy lavando* or *estoy lavándome*: before *estar*, or on the end with an accent mark.',
        es: '*Me estoy lavando* o *estoy lavándome*: antes de *estar*, o al final con tilde.',
      },
    },
    {
      id: 'pronominal-command-yes',
      title: { en: 'In affirmative commands: on the end', es: 'En los mandatos afirmativos: al final' },
      when: { tense: 'imperativeAffirmative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'When you tell someone to do something (an affirmative command), the pronoun attaches to the end of the command. Usually an accent mark keeps the stress where it was: *siéntate*. A one-syllable command doesn’t need one: *ponte*, *vete*.',
            es: 'Cuando le dices a alguien que haga algo (un mandato afirmativo), el pronombre se pega al final del mandato. Casi siempre una tilde mantiene el acento donde estaba: *siéntate*. Un mandato de una sílaba no la necesita: *ponte*, *vete*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¡*Siéntate*, por favor!', en: 'Sit down, please!', check: [{ entry: 'sentarse', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '¡*Levántate*! Ya son las siete.', en: 'Get up! It’s already seven.', check: [{ entry: 'levantarse', tense: 'imperativeAffirmative', person: 'tu' }] },
            { es: '*Siéntese* aquí, señora.', en: 'Have a seat here, ma’am.', check: [{ entry: 'sentarse', tense: 'imperativeAffirmative', person: 'el' }] },
            { es: '*Siéntense*, por favor.', en: 'Please sit down, everyone.', check: [{ entry: 'sentarse', tense: 'imperativeAffirmative', person: 'ellos' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'With *nosotros*, drop the final *-s* before *nos*: *sentemos* + *nos* → *sentémonos* (“let’s sit down”).',
            es: 'Con *nosotros*, se quita la *-s* final antes de *nos*: *sentemos* + *nos* → *sentémonos*.',
          },
        },
        { kind: 'deckVerbs', tense: 'imperativeAffirmative', verbKind: 'pronominal', withTables: true, text: THE_SE_VERBS },
      ],
      keyIdea: {
        en: 'Affirmative commands carry the pronoun on the end: *siéntate*, *levántate*.',
        es: 'Los mandatos afirmativos llevan el pronombre al final: *siéntate*, *levántate*.',
      },
    },
    {
      id: 'pronominal-command-vos',
      title: { en: 'With *vos*: *sentate*', es: 'Con *vos*: *sentate*' },
      when: { all: [{ vos: true }, { tense: 'imperativeAffirmative' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A *vos* command is stressed on its last syllable (*sentá*, *levantá*). With *te* attached, that syllable is next to last, so no accent mark is needed: *sentate*, *levantate*.',
            es: 'El mandato de *vos* lleva el acento en la última sílaba (*sentá*, *levantá*). Con *te* pegado, esa sílaba pasa a ser la penúltima, así que no hace falta tilde: *sentate*, *levantate*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Sentate* acá.', en: 'Sit here.', check: [{ entry: 'sentarse', tense: 'imperativeAffirmative', person: 'vos', vosRegion: 'rioplatense' }] },
            { es: '¡*Levantate*, ya es tarde!', en: 'Get up, it’s late!', check: [{ entry: 'levantarse', tense: 'imperativeAffirmative', person: 'vos', vosRegion: 'rioplatense' }] },
          ],
        },
      ],
    },
    {
      id: 'pronominal-command-no',
      title: { en: 'In negative commands: before the verb', es: 'En los mandatos negativos: antes del verbo' },
      when: { tense: 'imperativeNegative' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'When you tell someone not to do something (a negative command), the pronoun goes back to its usual spot: after *no*, right before the verb.',
            es: 'Cuando le dices a alguien que no haga algo (un mandato negativo), el pronombre vuelve a su lugar de siempre: después de *no*, justo antes del verbo.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¡*No te sientes* ahí!', en: 'Don’t sit there!', check: [{ entry: 'sentarse', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*No te preocupes*.', en: 'Don’t worry.', check: [{ entry: 'preocuparse', tense: 'imperativeNegative', person: 'tu' }] },
            { es: '*No se preocupe*, señor.', en: 'Don’t worry, sir.', check: [{ entry: 'preocuparse', tense: 'imperativeNegative', person: 'el' }] },
          ],
        },
        {
          kind: 'compare',
          head: [
            { en: 'Do it', es: 'Afirmativo' },
            { en: 'Don’t', es: 'Negativo' },
          ],
          rows: [
            [same('*siéntate*'), same('*no te sientes*')],
            [same('*levántate*'), same('*no te levantes*')],
          ],
        },
        { kind: 'deckVerbs', tense: 'imperativeNegative', verbKind: 'pronominal', withTables: true, text: THE_SE_VERBS },
      ],
      keyIdea: {
        en: '*Siéntate*, but *no te sientes*: on the end for “do it”, before the verb for “don’t”.',
        es: '*Siéntate*, pero *no te sientes*: al final en el afirmativo, antes del verbo en el negativo.',
      },
    },
    {
      id: 'pronominal-perfect',
      title: { en: 'With *haber*: before it', es: 'Con *haber*: antes' },
      when: { any: [{ tense: 'presentPerfect' }, { tense: 'pluperfect' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the tenses made with the helping verb *haber* (*he*, *has*, *ha*… + a past participle), the pronoun goes before *haber*. It never goes between the two words, or on the end of the past participle.',
            es: 'En los tiempos que se forman con el verbo auxiliar *haber* (*he*, *has*, *ha*… + participio), el pronombre va antes de *haber*. Nunca va entre las dos palabras ni pegado al participio.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me he levantado* temprano toda la semana.', en: 'I’ve gotten up early all week.', check: [{ entry: 'levantarse', tense: 'presentPerfect', person: 'yo' }] },
            { es: 'Cuando llegaste, ya *me había acostado*.', en: 'When you got here, I had already gone to bed.', check: [{ entry: 'acostarse', tense: 'pluperfect', person: 'yo' }] },
          ],
        },
        {
          kind: 'deckVerbs',
          tense: 'presentPerfect',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the present perfect (*pretérito perfecto*):', es: 'En el pretérito perfecto:' },
        },
        {
          kind: 'deckVerbs',
          tense: 'pluperfect',
          verbKind: 'pronominal',
          withTables: true,
          text: { en: 'In the pluperfect (*pluscuamperfecto*):', es: 'En el pluscuamperfecto:' },
        },
      ],
      keyIdea: {
        en: 'Pronoun, then *haber*, then the past participle: *me he levantado*.',
        es: 'Pronombre, luego *haber*, luego el participio: *me he levantado*.',
      },
    },
    {
      id: 'pronominal-quiz-form',
      title: { en: 'In the quiz: giving the form', es: 'En la práctica: dar la forma' },
      when: { direction: 'toForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A “give the form” question like *yo (llamarse)* wants the pronoun and the verb together: *me llamo*. Check both parts: the pronoun and the ending have to match the person.',
            es: 'Una pregunta de “da la forma” como *yo (llamarse)* pide el pronombre y el verbo juntos: *me llamo*. Revisa las dos partes: el pronombre y la terminación tienen que concordar con la persona.',
          },
        },
      ],
    },
    {
      id: 'pronominal-quiz-typing',
      title: { en: 'Typing a *-se* verb', es: 'Escribir un verbo con *-se*' },
      when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
      blocks: [
        {
          kind: 'list',
          items: [
            {
              en: 'Type the pronoun too: *me llamo*. Just *llamo* is marked wrong.',
              es: 'Escribe también el pronombre: *me llamo*. *llamo* sin el pronombre cuenta como error.',
            },
            {
              en: 'You may add the subject pronoun: *yo me llamo* counts too.',
              es: 'Puedes añadir el pronombre de sujeto: *yo me llamo* también vale.',
            },
          ],
        },
      ],
    },
    {
      id: 'pronominal-quiz-name',
      title: { en: 'In the quiz: naming the verb', es: 'En la práctica: nombrar el verbo' },
      when: { direction: 'fromForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In a “name the verb” question, a form like *me llamo* belongs to *llamarse*, not *llamar*, so its name keeps the *-se*. For who, look at both parts: *me* and the *-o* both point to *yo*.',
            es: 'En una pregunta de “nombra el verbo”, una forma como *me llamo* es de *llamarse*, no de *llamar*, así que su nombre lleva el *-se*. Para saber quién, mira las dos partes: tanto *me* como la *-o* corresponden a *yo*.',
          },
        },
        {
          kind: 'tip',
          text: {
            en: '*se* goes with both *él / ella / usted* and *ellos / ellas / ustedes*, so let the ending decide: *se llama* is one person, *se llaman* more than one.',
            es: '*se* va con *él / ella / usted* y con *ellos / ellas / ustedes*, así que fíjate en la terminación: *se llama* es una persona; *se llaman*, más de una.',
          },
        },
      ],
    },
  ],
};

const dative: Chapter = {
  id: 'dative',
  title: { en: 'Verbs like *gustar*', es: 'Verbos como *gustar*' },
  summary: {
    en: '*Me gusta*, *me gustan*: the thing you like decides the ending.',
    es: '*Me gusta*, *me gustan*: lo que te gusta decide la terminación.',
  },
  when: { kind: 'dative' },
  sections: [
    {
      id: 'dative-how',
      title: { en: 'How *gustar* works', es: 'Cómo funciona *gustar*' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*gustar* doesn’t work like “to like”. It really means “to be pleasing to”. In *Me gusta el chocolate*, the subject (who or what does the action) is the chocolate: it “is pleasing to me”.',
            es: '*gustar* no funciona como “to like” en inglés. En *Me gusta* el chocolate, el sujeto (quien o lo que hace la acción) es el chocolate: es el chocolate lo que gusta.',
          },
        },
        {
          kind: 'p',
          text: {
            en: 'The person who likes it gets an indirect object pronoun, a small word that says who something is pleasing to:',
            es: 'La persona a quien le gusta lleva un pronombre de objeto indirecto, una palabrita que dice a quién le gusta:',
          },
        },
        {
          kind: 'compare',
          head: [
            { en: 'Who likes it', es: 'A quién le gusta' },
            { en: 'Pronoun', es: 'Pronombre' },
          ],
          rows: [
            [same('*a mí*'), same('*me*')],
            [same('*a ti*'), same('*te*')],
            [same('*a él / a ella / a usted*'), same('*le*')],
            [same('*a nosotros / a nosotras*'), same('*nos*')],
            [same('*a ellos / a ellas / a ustedes*'), same('*les*')],
          ],
        },
        {
          kind: 'examples',
          items: [
            {
              es: '*Me gusta* el chocolate.',
              en: 'I like chocolate. (Literally: “Chocolate is pleasing to me.”)',
              check: [{ entry: 'gustarle', tense: 'present', person: 'yo', number: 'sg' }],
            },
            { es: '¿*Te gusta* el fútbol?', en: 'Do you like soccer?', check: [{ entry: 'gustarle', tense: 'present', person: 'tu', number: 'sg' }] },
          ],
        },
      ],
      keyIdea: {
        en: 'With *gustar*, the thing liked is the subject. The person who likes it is *me*, *te*, *le*, *nos* or *les*.',
        es: 'Con *gustar*, lo que gusta es el sujeto. La persona a quien le gusta es *me*, *te*, *le*, *nos* o *les*.',
      },
    },
    {
      id: 'dative-vosotros',
      title: { en: 'With *vosotros*: *os*', es: 'Con *vosotros*: *os*' },
      when: { vosotros: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'For *vosotros* (“you all”, as it’s said in Spain), the pronoun is *os*, and the phrase is *a vosotros* or *a vosotras*.',
            es: 'Para *vosotros*, el pronombre es *os*, y la frase es *a vosotros* o *a vosotras*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¿*Os gusta* la paella?', en: 'Do you all like paella? (in Spain)', check: [{ entry: 'gustarle', tense: 'present', person: 'vosotros', number: 'sg' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-vos',
      title: { en: 'With *vos*: *te*', es: 'Con *vos*: *te*' },
      when: { vos: true },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*vos* uses *te*, just like *tú*, and the phrase is *a vos*. The verb is the same as with *tú*.',
            es: '*vos* usa *te*, igual que *tú*, y la frase es *a vos*. El verbo es el mismo que con *tú*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Y a vos, ¿*te gusta* el fútbol?', en: 'And you, do you like soccer?', check: [{ entry: 'gustarle', tense: 'present', person: 'vos', number: 'sg', vosRegion: 'rioplatense' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-agree',
      title: { en: '*gusta* or *gustan*?', es: '¿*gusta* o *gustan*?' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The verb agrees with the thing liked, never with the person:',
            es: 'El verbo concuerda con lo que gusta, nunca con la persona:',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*gusta* for one thing: *me gusta la pizza*', es: '*gusta* con una sola cosa: *me gusta* la pizza' },
            { en: '*gusta* for an action, a dictionary form (infinitive): *me gusta bailar*', es: '*gusta* con una acción, una forma de diccionario (infinitivo): *me gusta* bailar' },
            { en: '*gustan* for two or more things: *me gustan los perros*', es: '*gustan* con dos o más cosas: *me gustan* los perros' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Nos gusta* bailar.', en: 'We like to dance.', check: [{ entry: 'gustarle', tense: 'present', person: 'nosotros', number: 'sg' }] },
            { es: '*Les gustan* los videojuegos.', en: 'They like video games.', check: [{ entry: 'gustarle', tense: 'present', person: 'ellos', number: 'pl' }] },
            { es: '¿*Te gustan* las fresas?', en: 'Do you like strawberries?', check: [{ entry: 'gustarle', tense: 'present', person: 'tu', number: 'pl' }] },
            { es: '*Me gusta* cantar y bailar.', en: 'I like to sing and dance.', check: [{ entry: 'gustarle', tense: 'present', person: 'yo', number: 'sg' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Two actions still take *gusta*: *me gusta cantar y bailar*. And the person never changes the ending: *me gusta*, *te gusta*, *nos gusta*, *les gusta*.',
            es: 'Dos acciones siguen con *gusta*: *me gusta* cantar y bailar. Y la persona nunca cambia la terminación: *me gusta*, *te gusta*, *nos gusta*, *les gusta*.',
          },
        },
      ],
      keyIdea: {
        en: 'One thing or an action: *gusta*. Two or more things: *gustan*.',
        es: 'Una cosa o una acción: *gusta*. Dos o más cosas: *gustan*.',
      },
    },
    {
      id: 'dative-a-mi',
      title: same('*a mí*, *a ti*, *a ella*…'),
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A phrase like *a mí* or *a ella* names the person. It’s extra, since *me* already says who. Add it to stress the person, or to make *le* and *les* clear: *le* can mean him, her or you (*usted*).',
            es: 'Una frase como *a mí* o *a ella* nombra a la persona. Es un extra, porque *me* ya dice quién. Úsala para dar énfasis o para aclarar *le* y *les*: *le* puede ser él, ella o usted.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'A mí *me gusta* el rock. ¿Y a ti?', en: 'I like rock. What about you?', check: [{ entry: 'gustarle', tense: 'present', person: 'yo', number: 'sg' }] },
            { es: 'A ella *le gustan* los gatos, pero a él no.', en: 'She likes cats, but he doesn’t.', check: [{ entry: 'gustarle', tense: 'present', person: 'el', number: 'pl' }] },
            { es: 'A mis padres *les gusta* cocinar.', en: 'My parents like to cook.', check: [{ entry: 'gustarle', tense: 'present', person: 'ellos', number: 'sg' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The phrase never replaces the pronoun: it’s *a mí me gusta*, with *me*. Before a name, use *a*: *A Juan le gusta el béisbol*.',
            es: 'La frase nunca reemplaza al pronombre: es *a mí me gusta*, con *me*. Delante de un nombre, usa *a*: A Juan *le gusta* el béisbol.',
          },
        },
      ],
      keyIdea: {
        en: '*a mí*, *a ti*, *a él*… is optional; *me*, *te*, *le*… is not.',
        es: '*a mí*, *a ti*, *a él*… es opcional; *me*, *te*, *le*… no.',
      },
    },
    {
      id: 'dative-name',
      title: { en: 'Why the app says *gustarle*', es: 'Por qué la app dice *gustarle*' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'The dictionary form (infinitive) is *gustar*. The app calls it *gustarle* when it’s used this way (*me gusta*, *les gustan*), and shows it like that in the quiz: *a mí (gustarle)*. That keeps it apart from *gustar* with the person as its subject (*gusto*, *gustas*), which is drilled separately. The *-le* stands for the pronoun. Other verbs like *gustar* get it too: *encantarle*, *dolerle*.',
            es: 'La forma de diccionario (infinitivo) es *gustar*. La app lo llama *gustarle* cuando se usa así (*me gusta*, *les gustan*), y así aparece en la práctica: *a mí (gustarle)*. Eso lo distingue de *gustar* con la persona como sujeto (*gusto*, *gustas*), que se practica aparte. El *-le* representa el pronombre. Otros verbos como *gustar* también lo llevan: *encantarle*, *dolerle*.',
          },
        },
      ],
    },
    {
      id: 'dative-others',
      title: { en: 'Other verbs like *gustar*', es: 'Otros verbos como *gustar*' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'These work the same way: the thing is the subject, and the person gets *me*, *te*, *le*, *nos* or *les*.',
            es: 'Estos funcionan igual: la cosa es el sujeto, y la persona lleva *me*, *te*, *le*, *nos* o *les*.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*encantar*: “to love” (things, activities)', es: '*encantar*: gustar mucho' },
            { en: '*interesar*: “to interest”', es: '*interesar*: despertar interés' },
            { en: '*importar*: “to matter”', es: '*importar*: tener importancia para alguien' },
            { en: '*doler*: “to hurt” (a stem-changing verb, or boot verb: *duele*)', es: '*doler*: causar dolor (verbo con cambio de raíz, o verbo bota: *duele*)' },
            { en: '*faltar*: “to be missing, to lack”', es: '*faltar*: no estar algo que se necesita' },
            { en: '*parecer*: “to seem”', es: '*parecer*: dar cierta impresión a alguien' },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me encantan* los tacos.', en: 'I love tacos.', check: [{ entry: 'encantarle', tense: 'present', person: 'yo', number: 'pl' }] },
            { es: '*Nos interesa* la historia.', en: 'We’re interested in history.', check: [{ entry: 'interesarle', tense: 'present', person: 'nosotros', number: 'sg' }] },
            { es: '*Me importa* mi familia.', en: 'My family matters to me.', check: [{ entry: 'importarle', tense: 'present', person: 'yo', number: 'sg' }] },
            { es: '*Me duele* la cabeza.', en: 'My head hurts.', check: [{ entry: 'dolerle', tense: 'present', person: 'yo', number: 'sg' }] },
            { es: '*Me falta* un lápiz.', en: 'I’m missing a pencil.', check: [{ entry: 'faltarle', tense: 'present', person: 'yo', number: 'sg' }] },
            { es: '¿Qué *te parece*?', en: 'What do you think? (Literally: “How does it seem to you?”)', check: [{ entry: 'parecerle', tense: 'present', person: 'tu', number: 'sg' }] },
          ],
        },
        {
          kind: 'deckVerbs',
          verbKind: 'dative',
          text: { en: 'Verbs of this kind in this deck:', es: 'Verbos de este tipo en este mazo:' },
        },
      ],
    },
    {
      id: 'dative-gustarse',
      title: { en: 'Careful: *me gusto*', es: 'Ojo: *me gusto*' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*Me gusto*, with *-o*, is a different verb: *gustarse*, “to like yourself”. With *nos* or *se*, it often means “to like each other”. For things and activities you like, it’s always *gusta* or *gustan*.',
            es: '*Me gusto*, con *-o*, es otro verbo: *gustarse*, cuando te gustas a ti mismo o a ti misma. Con *nos* o *se*, muchas veces quiere decir que dos personas se gustan mutuamente. Para las cosas y actividades que te gustan, siempre es *gusta* o *gustan*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me gusto* en esta foto.', en: 'I like how I look in this photo.', check: [{ entry: 'gustarse', tense: 'present', person: 'yo' }] },
            { es: 'Ana y Leo *se gustan*.', en: 'Ana and Leo like each other.', check: [{ entry: 'gustarse', tense: 'present', person: 'ellos' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'The app keeps *gustar*, *gustarse* and *gustarle* apart. The “Verbs” list on the quiz page shows which one you’re practicing.',
            es: 'La app trata *gustar*, *gustarse* y *gustarle* como verbos distintos. La lista “Verbos” de la práctica muestra cuál estás practicando.',
          },
        },
      ],
    },
    {
      id: 'dative-progressive',
      title: { en: 'In the present progressive', es: 'En el presente progresivo' },
      when: { tense: 'presentProgressive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Here *estar* is the part that agrees with the thing: *me está gustando* for one thing, *me están gustando* for more than one.',
            es: 'Aquí la parte que concuerda con la cosa es *estar*: *me está gustando* con una cosa, *me están gustando* con más de una.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me está gustando* esta serie.', en: 'I’m enjoying this show.', check: [{ entry: 'gustarle', tense: 'presentProgressive', person: 'yo', number: 'sg' }] },
            { es: '¿*Te están gustando* las clases?', en: 'Are you enjoying your classes?', check: [{ entry: 'gustarle', tense: 'presentProgressive', person: 'tu', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-preterite',
      title: { en: 'In the preterite', es: 'En el pretérito' },
      when: { tense: 'preterite' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Same rule in the preterite: *gustó* for one thing or an action, *gustaron* for more than one.',
            es: 'La misma regla en el pretérito: *gustó* con una cosa o una acción, *gustaron* con más de una.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me gustó* la película.', en: 'I liked the movie.', check: [{ entry: 'gustarle', tense: 'preterite', person: 'yo', number: 'sg' }] },
            { es: '*Nos gustaron* los tacos.', en: 'We liked the tacos.', check: [{ entry: 'gustarle', tense: 'preterite', person: 'nosotros', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-imperfect',
      title: { en: 'In the imperfect', es: 'En el imperfecto' },
      when: { tense: 'imperfect' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the imperfect, for what you used to like: *gustaba* and *gustaban*.',
            es: 'En el imperfecto, para lo que te gustaba antes: *gustaba* y *gustaban*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Cuando era niño, *me gustaban* los dinosaurios.', en: 'When I was little, I liked dinosaurs.', check: [{ entry: 'gustarle', tense: 'imperfect', person: 'yo', number: 'pl' }] },
            { es: 'A mi abuela *le gustaba* cantar.', en: 'My grandma liked to sing.', check: [{ entry: 'gustarle', tense: 'imperfect', person: 'el', number: 'sg' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-future',
      title: { en: 'In the future', es: 'En el futuro' },
      when: { tense: 'future' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the future: *gustará* for one thing, *gustarán* for more than one.',
            es: 'En el futuro: *gustará* con una cosa, *gustarán* con más de una.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Esta canción *te gustará*.', en: 'You’ll like this song.', check: [{ entry: 'gustarle', tense: 'future', person: 'tu', number: 'sg' }] },
            { es: '*Les gustarán* las fotos.', en: 'They’ll like the photos.', check: [{ entry: 'gustarle', tense: 'future', person: 'ellos', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-conditional',
      title: { en: 'In the conditional', es: 'En el condicional' },
      when: { tense: 'conditional' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*Me gustaría* (“I would like”) is the polite way to say what you want. With more than one thing, it’s *gustarían*.',
            es: '*Me gustaría* es la forma amable de decir lo que quieres. Con más de una cosa, es *gustarían*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Me gustaría* ir a México.', en: 'I’d like to go to Mexico.', check: [{ entry: 'gustarle', tense: 'conditional', person: 'yo', number: 'sg' }] },
            { es: '¿*Te gustaría* ir al cine?', en: 'Would you like to go to the movies?', check: [{ entry: 'gustarle', tense: 'conditional', person: 'tu', number: 'sg' }] },
            { es: '*Nos gustarían* más días de vacaciones.', en: 'We’d like more vacation days.', check: [{ entry: 'gustarle', tense: 'conditional', person: 'nosotros', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-present-perfect',
      title: { en: 'In the present perfect', es: 'En el pretérito perfecto' },
      when: { tense: 'presentPerfect' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'With the helping verb *haber*, it’s *haber* that agrees with the thing, and *gustado* never changes: *me ha gustado*, *me han gustado*.',
            es: 'Con el verbo auxiliar *haber*, es *haber* el que concuerda con la cosa, y *gustado* nunca cambia: *me ha gustado*, *me han gustado*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¿*Te ha gustado* la clase?', en: 'Have you enjoyed the class?', check: [{ entry: 'gustarle', tense: 'presentPerfect', person: 'tu', number: 'sg' }] },
            { es: '*Me han gustado* mucho tus fotos.', en: 'I’ve really liked your photos.', check: [{ entry: 'gustarle', tense: 'presentPerfect', person: 'yo', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-pluperfect',
      title: { en: 'In the pluperfect', es: 'En el pluscuamperfecto' },
      when: { tense: 'pluperfect' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the pluperfect, *había* or *habían* agrees with the thing: *me había gustado*, *me habían gustado*.',
            es: 'En el pluscuamperfecto, *había* o *habían* concuerda con la cosa: *me había gustado*, *me habían gustado*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Nunca *me habían gustado* las verduras.', en: 'I had never liked vegetables.', check: [{ entry: 'gustarle', tense: 'pluperfect', person: 'yo', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-present-subjunctive',
      title: { en: 'In the present subjunctive', es: 'En el presente de subjuntivo' },
      when: { tense: 'presentSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the present subjunctive: *guste* for one thing, *gusten* for more than one.',
            es: 'En el presente de subjuntivo: *guste* con una cosa, *gusten* con más de una.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Espero que *te guste*.', en: 'I hope you like it.', check: [{ entry: 'gustarle', tense: 'presentSubjunctive', person: 'tu', number: 'sg' }] },
            { es: 'Ojalá que *les gusten* los regalos.', en: 'I hope they like the presents.', check: [{ entry: 'gustarle', tense: 'presentSubjunctive', person: 'ellos', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-imperfect-subjunctive',
      title: { en: 'In the imperfect subjunctive', es: 'En el imperfecto de subjuntivo' },
      when: { tense: 'imperfectSubjunctive' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the imperfect subjunctive: *gustara* for one thing, *gustaran* for more than one. The *-se* forms (*gustase*, *gustasen*) count too.',
            es: 'En el imperfecto de subjuntivo: *gustara* con una cosa, *gustaran* con más de una. Las formas en *-se* (*gustase*, *gustasen*) también valen.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Ojalá *me gustara* el brócoli.', en: 'I wish I liked broccoli.', check: [{ entry: 'gustarle', tense: 'imperfectSubjunctive', person: 'yo', number: 'sg' }] },
            { es: 'Si *te gustaran* los deportes, jugarías con nosotros.', en: 'If you liked sports, you’d play with us.', check: [{ entry: 'gustarle', tense: 'imperfectSubjunctive', person: 'tu', number: 'pl' }] },
          ],
        },
      ],
    },
    {
      id: 'dative-quiz-form',
      title: { en: 'In the quiz: the cue', es: 'En la práctica: la pista' },
      when: { direction: 'toForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A “give the form” question shows who likes it and the verb, like *a mí (gustarle)*, with a cue under it: the thing liked. The cue decides the ending:',
            es: 'Una pregunta de “da la forma” muestra a quién le gusta y el verbo, como *a mí (gustarle)*, con una pista debajo: lo que gusta. La pista decide la terminación:',
          },
        },
        {
          kind: 'list',
          items: [
            same('*a mí (gustarle)* + *el chocolate* → *me gusta*'),
            same('*a mí (gustarle)* + *bailar* → *me gusta*'),
            same('*a mí (gustarle)* + *los perros* → *me gustan*'),
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Who likes it picks the pronoun (*a mí* → *me*); the cue picks *gusta* or *gustan*.',
            es: 'A quién le gusta decide el pronombre (*a mí* → *me*); la pista decide *gusta* o *gustan*.',
          },
        },
      ],
    },
    {
      id: 'dative-quiz-typing',
      title: { en: 'Typing a *gustar* form', es: 'Escribir una forma de *gustar*' },
      when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
      blocks: [
        {
          kind: 'list',
          items: [
            { en: 'Type the pronoun and the verb: *me gusta*.', es: 'Escribe el pronombre y el verbo: *me gusta*.' },
            {
              en: '*a mí me gusta* counts too, and so does typing the cue after it: *me gusta el chocolate*.',
              es: '*a mí me gusta* también vale, y también escribir la pista después: *me gusta el chocolate*.',
            },
            {
              en: 'Just *gusta*, or *yo me gusta*, is marked wrong: the pronoun is required, and *yo* is never the subject here.',
              es: '*gusta* sin el pronombre, o *yo me gusta*, cuenta como error: el pronombre es obligatorio, y *yo* nunca es el sujeto aquí.',
            },
            {
              en: 'You don’t have to type *a mí*. If you do, *mí* needs its accent: *a mi* is treated like any missing accent.',
              es: 'No hace falta escribir *a mí*. Si lo escribes, *mí* lleva tilde: *a mi* cuenta como cualquier acento que falta.',
            },
          ],
        },
      ],
    },
    {
      id: 'dative-quiz-name',
      title: { en: 'In the quiz: naming the verb', es: 'En la práctica: nombrar el verbo' },
      when: { direction: 'fromForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In a “name the verb” question, *me gustan* is *gustarle · a mí*. The “who” is the person the pronoun points to (*me* → *a mí*, *les* → *a ellos / a ellas / a ustedes*), not the thing liked: *me gusta* and *me gustan* are both *a mí*.',
            es: 'En una pregunta de “nombra el verbo”, *me gustan* es *gustarle · a mí*. El “quién” es la persona del pronombre (*me* → *a mí*, *les* → *a ellos / a ellas / a ustedes*), no lo que gusta: *me gusta* y *me gustan* son los dos *a mí*.',
          },
        },
      ],
    },
  ],
};

const impersonal: Chapter = {
  id: 'impersonal',
  title: { en: '*hay* and weather verbs', es: '*hay* y los verbos del clima' },
  summary: {
    en: 'Verbs with no “who”: *hay*, *llueve*, *hace frío*.',
    es: 'Verbos sin sujeto: *hay*, *llueve*, *hace frío*.',
  },
  when: { kind: 'impersonal' },
  sections: [
    {
      id: 'impersonal-what',
      title: { en: 'Verbs with no “who”', es: 'Verbos sin “quién”' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Most verbs change with the person: *tengo*, *tienes*, *tiene*. A few have no person at all, because nobody does them: *hay* (“there is”), *llueve* (“it rains”). These are impersonal verbs, and they have just one form in each tense.',
            es: 'Casi todos los verbos cambian con la persona: *tengo*, *tienes*, *tiene*. Unos pocos no tienen persona, porque nadie hace la acción: *hay*, *llueve*. Son verbos impersonales, y tienen una sola forma en cada tiempo verbal.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hay* un examen mañana.', en: 'There’s a test tomorrow.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: '*Llueve*.', en: 'It’s raining.', check: [{ entry: 'llover', tense: 'present', person: 'el' }] },
          ],
        },
        {
          kind: 'deckVerbs',
          verbKind: 'impersonal',
          text: { en: 'The impersonal verbs in this deck:', es: 'Los verbos impersonales de este mazo:' },
        },
      ],
      keyIdea: {
        en: 'Impersonal verbs have no person to match: one form per tense, like *hay* or *llueve*.',
        es: 'Los verbos impersonales no tienen persona: una sola forma por tiempo verbal, como *hay* o *llueve*.',
      },
    },
    {
      id: 'impersonal-hay',
      title: { en: '*hay*: “there is, there are”', es: '*hay*: una forma para todo' },
      when: HAY,
      blocks: [
        {
          kind: 'p',
          text: {
            en: '*hay* comes from *haber*. It means both “there is” and “there are”: the same form for one thing or many.',
            es: '*hay* viene de *haber*. Sirve para decir que algo existe o está en un lugar, y es la misma forma para una cosa o para muchas.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hay* un perro en el parque.', en: 'There’s a dog in the park.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: '*Hay* dos perros en el parque.', en: 'There are two dogs in the park.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: '¿*Hay* tarea para mañana?', en: 'Is there homework for tomorrow?', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
            { es: 'No *hay* clase el lunes.', en: 'There’s no class on Monday.', check: [{ entry: 'haber-impersonal', tense: 'present', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: '*hay* has no plural: it’s *hay dos perros*, never *han dos perros*. (*ha* and *han* are *haber* used as a helping verb, as in *ha comido*, “has eaten”.)',
            es: '*hay* no tiene plural: es *hay* dos perros, nunca *han* dos perros. (*ha* y *han* son *haber* como verbo auxiliar, como en *ha comido*.)',
          },
        },
      ],
      keyIdea: {
        en: 'One thing or many, it’s *hay*.',
        es: 'Una cosa o muchas: siempre *hay*.',
      },
    },
    {
      id: 'impersonal-hay-estar',
      title: { en: '*hay* or *está*?', es: '¿*hay* o *está*?' },
      when: HAY,
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Use *hay* to say that something exists or is somewhere, usually with *un*, *una*, a number, or no article. To say where a particular thing is, use *estar*.',
            es: 'Usa *hay* para decir que algo existe o que se encuentra en un lugar, normalmente con *un*, *una*, un número o sin artículo. Para decir dónde está una cosa concreta, usa *estar*.',
          },
        },
        {
          kind: 'compare',
          head: [
            { en: '*hay*: “there is / there are”', es: '*hay*' },
            { en: '*estar*: “is / are” (where)', es: '*estar*' },
          ],
          rows: [
            [
              { en: '*Hay un gato en la mesa.* (“There’s a cat on the table.”)', es: '*Hay* un gato en la mesa.' },
              { en: '*El gato está en la mesa.* (“The cat is on the table.”)', es: 'El gato *está* en la mesa.' },
            ],
            [
              { en: '*Hay dos libros en mi mochila.* (“There are two books in my backpack.”)', es: '*Hay* dos libros en mi mochila.' },
              { en: '*Mis libros están en mi mochila.* (“My books are in my backpack.”)', es: 'Mis libros *están* en mi mochila.' },
            ],
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-imperfect',
      title: { en: '*había*: “there was, there were”', es: '*había*, en el imperfecto' },
      when: { all: [HAY, { tense: 'imperfect' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the imperfect, *hay* becomes *había*, still one form for one thing or many. Use it to describe how things were.',
            es: 'En el imperfecto, *hay* se convierte en *había*, que sigue siendo una forma para una cosa o muchas. Sirve para describir cómo eran las cosas.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'En la fiesta *había* mucha gente.', en: 'There were a lot of people at the party.', check: [{ entry: 'haber-impersonal', tense: 'imperfect', person: 'el' }] },
            { es: 'Antes *había* un parque aquí.', en: 'There used to be a park here.', check: [{ entry: 'haber-impersonal', tense: 'imperfect', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'Many things, still *había*: *había dos perros*, not *habían*.',
            es: 'Muchas cosas, pero siempre *había*: *había* dos perros, no *habían*.',
          },
        },
      ],
    },
    {
      id: 'impersonal-hay-preterite',
      title: { en: '*hubo*: “there was” (it happened)', es: '*hubo*, en el pretérito' },
      when: { all: [HAY, { tense: 'preterite' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the preterite, it’s *hubo*: for something that happened, like an event.',
            es: 'En el pretérito es *hubo*: para algo que pasó, como un evento.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Hubo* un accidente en la carretera.', en: 'There was an accident on the highway.', check: [{ entry: 'haber-impersonal', tense: 'preterite', person: 'el' }] },
            { es: 'Ayer *hubo* dos exámenes.', en: 'There were two tests yesterday.', check: [{ entry: 'haber-impersonal', tense: 'preterite', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: 'For “there were”, never *hubieron*: it’s *hubo dos exámenes*.',
            es: 'Con este sentido, nunca *hubieron*: es *hubo* dos exámenes.',
          },
        },
      ],
    },
    {
      id: 'impersonal-hay-future',
      title: { en: '*habrá*: “there will be”', es: '*habrá*, en el futuro' },
      when: { all: [HAY, { tense: 'future' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the future, *hay* becomes *habrá*, still one form for one thing or many: *habrá dos exámenes*, not *habrán*.',
            es: 'En el futuro, *hay* se convierte en *habrá*, que sigue siendo una forma para una cosa o muchas: *habrá* dos exámenes, no *habrán*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Mañana *habrá* examen.', en: 'There will be a test tomorrow.', check: [{ entry: 'haber-impersonal', tense: 'future', person: 'el' }] },
            { es: '¿*Habrá* pizza en la fiesta?', en: 'Will there be pizza at the party?', check: [{ entry: 'haber-impersonal', tense: 'future', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-conditional',
      title: { en: '*habría*: “there would be”', es: '*habría*, en el condicional' },
      when: { all: [HAY, { tense: 'conditional' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the conditional, *hay* becomes *habría*, still one form for one thing or many: *habría dos exámenes*, not *habrían*.',
            es: 'En el condicional, *hay* se convierte en *habría*, que sigue siendo una forma para una cosa o muchas: *habría* dos exámenes, no *habrían*.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Sin música, no *habría* fiesta.', en: 'Without music, there would be no party.', check: [{ entry: 'haber-impersonal', tense: 'conditional', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-present-perfect',
      title: { en: '*ha habido*: “there has been”', es: '*ha habido*, en el pretérito perfecto' },
      when: { all: [HAY, { tense: 'presentPerfect' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the present perfect, *haber* is both the helping verb and the main verb: *ha habido* (“there has been, there have been”). The *ha* stays singular, even for many things.',
            es: 'En el pretérito perfecto, *haber* es a la vez el verbo auxiliar y el verbo principal: *ha habido*. El *ha* no cambia, aunque sean muchas cosas.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Ha habido* muchos cambios este año.', en: 'There have been a lot of changes this year.', check: [{ entry: 'haber-impersonal', tense: 'presentPerfect', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-pluperfect',
      title: { en: '*había habido*: “there had been”', es: '*había habido*, en el pluscuamperfecto' },
      when: { all: [HAY, { tense: 'pluperfect' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the pluperfect, it’s *había habido*, singular for one thing or many.',
            es: 'En el pluscuamperfecto es *había habido*, en singular para una cosa o muchas.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Nunca *había habido* tanta nieve.', en: 'There had never been so much snow.', check: [{ entry: 'haber-impersonal', tense: 'pluperfect', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-present-subjunctive',
      title: { en: '*haya*: in the present subjunctive', es: '*haya*, en el presente de subjuntivo' },
      when: { all: [HAY, { tense: 'presentSubjunctive' }] },
      blocks: [
        { kind: 'p', text: { en: 'In the present subjunctive, *hay* becomes *haya*.', es: 'En el presente de subjuntivo, *hay* se convierte en *haya*.' } },
        {
          kind: 'examples',
          items: [
            { es: 'Espero que *haya* pizza.', en: 'I hope there’s pizza.', check: [{ entry: 'haber-impersonal', tense: 'presentSubjunctive', person: 'el' }] },
            { es: 'No creo que *haya* clase mañana.', en: 'I don’t think there’s class tomorrow.', check: [{ entry: 'haber-impersonal', tense: 'presentSubjunctive', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-hay-imperfect-subjunctive',
      title: { en: '*hubiera*: in the imperfect subjunctive', es: '*hubiera*, en el imperfecto de subjuntivo' },
      when: { all: [HAY, { tense: 'imperfectSubjunctive' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the imperfect subjunctive, it’s *hubiera*, or *hubiese*: both count.',
            es: 'En el imperfecto de subjuntivo es *hubiera* o *hubiese*: las dos valen.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Ojalá *hubiera* más tiempo.', en: 'I wish there were more time.', check: [{ entry: 'haber-impersonal', tense: 'imperfectSubjunctive', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-weather',
      title: { en: 'Weather: *llueve*, *nieva*, *hace frío*', es: 'El clima: *llueve*, *nieva*, *hace frío*' },
      when: WEATHER,
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Weather verbs have no person either. English says “it rains”, but Spanish has no word for that “it”: just *llueve*.',
            es: 'Los verbos del clima tampoco tienen persona. Se dice solo *llueve*, sin sujeto.',
          },
        },
        {
          kind: 'list',
          items: [
            { en: '*llover* → *llueve*: “it rains, it’s raining”', es: '*llover* → *llueve*' },
            { en: '*nevar* → *nieva*: “it snows, it’s snowing”', es: '*nevar* → *nieva*' },
            {
              en: '*hacer* for the weather → *hace frío* (“it’s cold”), *hace calor* (“it’s hot”), *hace sol* (“it’s sunny”), *hace viento* (“it’s windy”)',
              es: '*hacer* para el clima → *hace frío*, *hace calor*, *hace sol*, *hace viento*',
            },
          ],
        },
        {
          kind: 'examples',
          items: [
            { es: '*Llueve* mucho en invierno.', en: 'It rains a lot in the winter.', check: [{ entry: 'llover', tense: 'present', person: 'el' }] },
            { es: 'En Lima casi nunca *nieva*.', en: 'It almost never snows in Lima.', check: [{ entry: 'nevar', tense: 'present', person: 'el' }] },
            { es: 'Hoy *hace* sol.', en: 'It’s sunny today.', check: [{ entry: 'hacer-impersonal', tense: 'present', person: 'el' }] },
            { es: '¿Qué tiempo *hace*?', en: 'What’s the weather like?', check: [{ entry: 'hacer-impersonal', tense: 'present', person: 'el' }] },
          ],
        },
        {
          kind: 'tip',
          text: {
            en: '*llover* and *nevar* are stem-changing verbs (boot verbs): *o* → *ue* in *llueve*, *e* → *ie* in *nieva*. No plural either: always *llueve*, never *llueven*.',
            es: '*llover* y *nevar* son verbos con cambio de raíz (verbos bota): *o* → *ue* en *llueve*, *e* → *ie* en *nieva*. Tampoco tienen plural: siempre *llueve*, nunca *llueven*.',
          },
        },
      ],
      keyIdea: {
        en: 'No “it” in Spanish weather: *llueve*, *nieva*, *hace frío*.',
        es: 'Los verbos del clima no llevan sujeto: *llueve*, *nieva*, *hace frío*.',
      },
    },
    {
      id: 'impersonal-weather-progressive',
      title: { en: 'Right now: *está lloviendo*', es: 'Ahora mismo: *está lloviendo*' },
      when: { all: [WEATHER, { tense: 'presentProgressive' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'To say it’s happening right now, use the present progressive: *está* + the *-ando*/*-iendo* form (gerund).',
            es: 'Para decir que está pasando ahora mismo, usa el presente progresivo: *está* + gerundio.',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '¡*Está lloviendo*!', en: 'It’s raining!', check: [{ entry: 'llover', tense: 'presentProgressive', person: 'el' }] },
            { es: '*Está nevando* en las montañas.', en: 'It’s snowing in the mountains.', check: [{ entry: 'nevar', tense: 'presentProgressive', person: 'el' }] },
            { es: '*Está haciendo* mucho frío.', en: 'It’s really cold out.', check: [{ entry: 'hacer-impersonal', tense: 'presentProgressive', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-weather-preterite',
      title: { en: 'Weather in the preterite', es: 'El clima en el pretérito' },
      when: { all: [WEATHER, { tense: 'preterite' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the preterite, for weather that happened and is over:',
            es: 'En el pretérito, para el clima de un momento que ya pasó:',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Ayer *llovió* mucho.', en: 'It rained a lot yesterday.', check: [{ entry: 'llover', tense: 'preterite', person: 'el' }] },
            { es: 'Anoche *hizo* mucho frío.', en: 'It was really cold last night.', check: [{ entry: 'hacer-impersonal', tense: 'preterite', person: 'el' }] },
            { es: '*Nevó* en las montañas.', en: 'It snowed in the mountains.', check: [{ entry: 'nevar', tense: 'preterite', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-weather-imperfect',
      title: { en: 'Weather in the imperfect', es: 'El clima en el imperfecto' },
      when: { all: [WEATHER, { tense: 'imperfect' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the imperfect, to set the scene:',
            es: 'En el imperfecto, para describir la escena:',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: '*Llovía* cuando salí de la escuela.', en: 'It was raining when I left school.', check: [{ entry: 'llover', tense: 'imperfect', person: 'el' }] },
            { es: '*Hacía* mucho calor.', en: 'It was really hot.', check: [{ entry: 'hacer-impersonal', tense: 'imperfect', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-weather-future',
      title: { en: 'Weather in the future', es: 'El clima en el futuro' },
      when: { all: [WEATHER, { tense: 'future' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In the future, like a forecast:',
            es: 'En el futuro, como un pronóstico:',
          },
        },
        {
          kind: 'examples',
          items: [
            { es: 'Mañana *lloverá*.', en: 'It will rain tomorrow.', check: [{ entry: 'llover', tense: 'future', person: 'el' }] },
            { es: '*Hará* calor el fin de semana.', en: 'It’ll be hot this weekend.', check: [{ entry: 'hacer-impersonal', tense: 'future', person: 'el' }] },
          ],
        },
      ],
    },
    {
      id: 'impersonal-quiz-form',
      title: { en: 'In the quiz: no “who”', es: 'En la práctica: sin “quién”' },
      when: { direction: 'toForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'A “give the form” question for these verbs shows the tense and the verb with an “impersonal” tag, and no person. Give its one form in that tense. In the present: *haber* → *hay*, *llover* → *llueve*, *hacer* → *hace*.',
            es: 'Una pregunta de “da la forma” con estos verbos muestra el tiempo verbal y el verbo con la etiqueta “impersonal”, sin persona. Da su única forma en ese tiempo verbal. En el presente: *haber* → *hay*, *llover* → *llueve*, *hacer* → *hace*.',
          },
        },
      ],
    },
    {
      id: 'impersonal-quiz-typing',
      title: { en: 'Typing these verbs', es: 'Escribir estos verbos' },
      when: { all: [{ direction: 'toForm' }, { reached: 'typed-lenient' }] },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'Type the verb form alone: *hay*, not *hay un perro*; *hace*, not *hace frío*. Don’t add *él* or *ella*: there’s no subject to add.',
            es: 'Escribe solo la forma verbal: *hay*, no *hay un perro*; *hace*, no *hace frío*. No añadas *él* ni *ella*: no hay sujeto.',
          },
        },
      ],
    },
    {
      id: 'impersonal-quiz-name',
      title: { en: 'In the quiz: naming the verb', es: 'En la práctica: nombrar el verbo' },
      when: { direction: 'fromForm' },
      blocks: [
        {
          kind: 'p',
          text: {
            en: 'In a “name the verb” question, *hay* is named by its dictionary form (infinitive): *haber*. The same goes for the weather: *llueve* is *llover*, and *hace* (as in *hace frío*) is *hacer*. There’s no “who” to pick.',
            es: 'En una pregunta de “nombra el verbo”, *hay* se nombra con su forma de diccionario (infinitivo): *haber*. Lo mismo con el clima: *llueve* es *llover*, y *hace* (como en *hace frío*) es *hacer*. No hay “quién” que elegir.',
          },
        },
      ],
    },
  ],
};

const chapters: Chapter[] = [pronominal, dative, impersonal];

export default chapters;
