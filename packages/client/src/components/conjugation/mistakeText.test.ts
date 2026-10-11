// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { MISTAKE_KINDS, type MistakeDetail, type MistakeKind } from '@libresrs/shared/conjugation';
import { MESSAGES } from '../../i18n/messages';
import { guideSectionFor, mistakeLabel, mistakeLine, type MistakePrompt } from './mistakeText';

/** The page's t, in English: the message with its parameters filled in. */
const t = (message: string, params?: Record<string, string | number>) =>
  message.replace(/{{(\w+)}}/g, (_, key: string) => String(params?.[key] ?? `{{${key}}}`));

/** Every message a call asked for, to check each has its Spanish. */
function recording() {
  const asked: string[] = [];
  const tr = (message: string, params?: Record<string, string | number>) => {
    asked.push(message);
    return t(message, params);
  };
  return { asked, tr };
}

const m = (kind: MistakeKind, detail: MistakeDetail = {}) => ({ kind, detail });

/** "yo (tener)", present. */
const tenerYo: MistakePrompt = {
  direction: 'toForm', entryLabel: 'tener', personLabel: 'yo', tense: 'present', tenseLabel: 'presente', cue: null, form: null,
};
/** "a mí (gustarle) + el chocolate", present. */
const gustarMi: MistakePrompt = { ...tenerYo, entryLabel: 'gustarle', personLabel: 'a mí', cue: 'el chocolate' };
/** "tengo": which verb form is this? */
const tengo: MistakePrompt = {
  direction: 'fromForm', entryLabel: null, personLabel: null, tense: 'present', tenseLabel: 'presente', cue: null, form: 'tengo',
};

/** "ustedes (tener)", present (v1.24.0: one subject at a time). */
const tenerUstedes: MistakePrompt = { ...tenerYo, personLabel: 'ustedes', personId: 'ellos' };
/** "ellas (vivir)", present. */
const tenerEllas: MistakePrompt = { ...tenerYo, entryLabel: 'vivir', personLabel: 'ellas', personId: 'ellos' };

describe('mistakeLine', () => {
  it('names the él form given for yo, the commonest mistake', () => {
    expect(mistakeLine(m('person', { person: 'el' }), tenerYo, 'tengo', t))
      .toBe('That’s the él / ella / usted form, not the yo form.');
  });

  it('names another experiencer of a gustar-type verb by the pronoun it needs', () => {
    expect(mistakeLine(m('person', { person: 'tu', number: 'sg' }), gustarMi, 'me gusta', t)).toBe('With a mí, the pronoun is me.');
    // v1.24.0: one experiencer at a time, found by the person id ("a ellas" is not the whole label).
    expect(mistakeLine(m('person', { person: 'el', number: 'sg' }), { ...gustarMi, personLabel: 'a ellas', personId: 'ellos' }, 'les gusta', t))
      .toBe('With a ellas, the pronoun is les.');
    expect(mistakeLine(m('person', { person: 'ellos', number: 'sg' }), { ...gustarMi, personLabel: 'a usted', personId: 'el' }, 'le gusta', t))
      .toBe('With a usted, the pronoun is le.');
    // A prompt built before v1.24.0 still has the whole label, and no id on an older page.
    expect(mistakeLine(m('person', { person: 'el', number: 'sg' }), { ...gustarMi, personLabel: 'a ellos / a ellas / a ustedes' }, 'les gusta', t))
      .toBe('With a ellos / a ellas / a ustedes, the pronoun is les.');
  });

  it('says a plural subject needs the -n form, and that ustedes is not a tú form (v1.24.0)', () => {
    expect(mistakeLine(m('person', { person: 'el' }), tenerEllas, 'viven', t)).toBe('Ellas is plural, so the verb needs its -n form.');
    expect(mistakeLine(m('person', { person: 'el' }), tenerUstedes, 'tienen', t)).toBe('Ustedes is plural, so the verb needs its -n form.');
    expect(mistakeLine(m('person', { person: 'yo' }), { ...tenerEllas, personLabel: 'ellos' }, 'viven', t)).toBe('Ellos is plural, so the verb needs its -n form.');
    expect(mistakeLine(m('person', { person: 'tu' }), tenerUstedes, 'tienen', t)).toBe('That’s the tú form. Ustedes takes the -n form, like ellos and ellas.');
    // ellas with a tú form is the plural line, not the ustedes one.
    expect(mistakeLine(m('person', { person: 'tu' }), tenerEllas, 'viven', t)).toBe('Ellas is plural, so the verb needs its -n form.');
    // Another plural (nosotros) for ellos keeps the general line.
    expect(mistakeLine(m('person', { person: 'nosotros' }), tenerEllas, 'viven', t)).toBe('That’s the nosotros / nosotras form, not the ellas form.');
    // A singular subject keeps it too.
    expect(mistakeLine(m('person', { person: 'el' }), tenerYo, 'tengo', t)).toBe('That’s the él / ella / usted form, not the yo form.');
    // An old prompt (the whole group, no id) keeps the line it had.
    expect(mistakeLine(m('person', { person: 'el' }), { ...tenerYo, personLabel: 'ellos / ellas / ustedes' }, 'tienen', t))
      .toBe('That’s the él / ella / usted form, not the ellos / ellas / ustedes form.');
    // Never for gustar-type verbs: the verb follows the thing liked ("a ellas les gusta el perro"), so the line is the pronoun's.
    const gustarEllas = { ...gustarMi, personLabel: 'a ellas', personId: 'ellos', cue: 'el perro' };
    expect(mistakeLine(m('person', { person: 'el', number: 'sg' }), gustarEllas, 'les gusta', t)).toBe('With a ellas, the pronoun is les.');
    expect(mistakeLine(m('dativeNumber', { number: 'pl' }), gustarEllas, 'les gusta', t)).toBe('The verb agrees with the thing liked, and el perro is singular.');
    // Nor for hay: one form for everyone.
    const hay = { ...tenerYo, entryLabel: 'haber', personLabel: null, personId: null };
    expect(mistakeLine(m('impersonal', { person: 'ellos' }), hay, 'hay', t)).toBe('This verb has one form for everyone: there is no person to match.');
    // A ustedes command answered with the tú command: the plural line (ellos and ellas have no commands).
    const command = { ...tenerUstedes, tense: 'imperativeAffirmative', tenseLabel: 'imperativo afirmativo' };
    expect(mistakeLine(m('person', { person: 'tu' }), command, 'hablen', t)).toBe('Ustedes is plural, so the verb needs its -n form.');
  });

  it('points a "name the verb" pick to the ending (or the pronoun) that says who', () => {
    expect(mistakeLine(m('person', { person: 'el' }), tengo, 'tener · yo · presente', t)).toBe('Look at the ending: it tells you who.');
    expect(mistakeLine(m('person', { person: 'tu' }), { ...tengo, form: 'me gusta' }, 'gustarle · a mí · presente', t))
      .toBe('Look at the pronoun (me, te, le…): it tells you who.');
  });

  it('names another tense by its Spanish name', () => {
    expect(mistakeLine(m('tense', { tense: 'imperfect' }), { ...tenerYo, tense: 'preterite', tenseLabel: 'pretérito' }, 'tuve', t))
      .toBe('That form is in the imperfecto, not the pretérito.');
    expect(mistakeLine(m('tense', { tense: 'preterite' }), tengo, 'tener · yo · presente', t)).toBe('That form isn’t in the pretérito.');
  });

  it('says which rule a verb made regular broke', () => {
    const line = (change: MistakeDetail['change']) => mistakeLine(m('regularized', { change }), tenerYo, 'tengo', t);
    expect(line('yo')).toBe('This verb’s yo form is irregular, so the regular pattern doesn’t work here.');
    expect(line('stem')).toBe('The stem changes here: that form leaves the change out.');
    expect(line('stemEverywhere')).toBe('The stem doesn’t change in this form: the change isn’t in every person.');
    expect(line('spelling')).toBe('This form has a spelling change (like c → qu) that keeps its sound.');
    expect(line('irregular')).toBe('This verb is irregular here, so the regular pattern doesn’t work.');
  });

  it('explains the gustar construction: agreement with the thing liked, and me for yo', () => {
    expect(mistakeLine(m('dativeSubject', { person: 'yo' }), gustarMi, 'me gusta', t))
      .toBe('Verbs like gustar agree with the thing liked, not with who likes it.');
    expect(mistakeLine(m('dativeSubject', { person: 'yo', subjectPronoun: 'yo' }), gustarMi, 'me gusta', t))
      .toBe('Verbs like gustar take me, not yo.');
    // "me gustan" for el chocolate: the answer is plural, the cue singular.
    expect(mistakeLine(m('dativeNumber', { number: 'pl' }), gustarMi, 'me gusta', t))
      .toBe('The verb agrees with the thing liked, and el chocolate is singular.');
    expect(mistakeLine(m('dativeNumber', { number: 'sg' }), { ...gustarMi, cue: 'los perros' }, 'me gustan', t))
      .toBe('The verb agrees with the thing liked, and los perros is plural.');
    expect(mistakeLine(m('dativeSelf'), gustarMi, 'me gusta', t)).toMatch(/^That form is about liking yourself/);
  });

  it('names the pronoun left out, added or wrong', () => {
    const llamarse = { ...tenerYo, entryLabel: 'llamarse' };
    expect(mistakeLine(m('pronounMissing', { pronoun: 'me' }), llamarse, 'me llamo', t)).toBe('This verb needs its pronoun: me.');
    expect(mistakeLine(m('pronounExtra', { pronoun: 'me' }), { ...tenerYo, entryLabel: 'vivir' }, 'vivo', t)).toBe('This verb takes no me.');
    expect(mistakeLine(m('pronounWrong', { pronoun: 'se', expectedPronoun: 'me' }), llamarse, 'me llamo', t))
      .toBe('The pronoun goes with the person: me, not se.');
  });

  it('names hay given a person, the infinitive, and another verb', () => {
    const hay = { ...tenerYo, entryLabel: 'haber', personLabel: null };
    expect(mistakeLine(m('impersonal', { person: 'ellos' }), hay, 'hay', t)).toBe('This verb has one form for everyone: there is no person to match.');
    expect(mistakeLine(m('infinitive'), tenerYo, 'tengo', t)).toBe('That’s the dictionary form (infinitive): the question asks for a conjugated form.');
    expect(mistakeLine(m('otherVerb', { entry: 'estar' }), { ...tenerYo, entryLabel: 'ser' }, 'soy', t)).toBe('That’s a form of estar, not ser.');
    expect(mistakeLine(m('otherVerb', { entry: 'estar' }), { ...tengo, form: 'soy' }, 'ser · yo · presente', t)).toBe('soy isn’t a form of estar.');
    // hay by its infinitive, as the quiz names it, never "haber (hay)".
    expect(mistakeLine(m('otherVerb', { entry: 'haber-impersonal' }), { ...tenerYo, entryLabel: 'estar' }, 'estoy', t))
      .toBe('That’s a form of haber, not estar.');
  });

  it('says nothing for an accent slip (its headline says it), an unknown answer, or a right one', () => {
    expect(mistakeLine(m('accent'), tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(m('unknown'), tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(null, tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(undefined, tenerYo, 'tengo', t)).toBeNull();
  });

  it('says nothing rather than guess when a detail it needs is missing', () => {
    expect(mistakeLine(m('person'), tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(m('tense'), tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(m('pronounMissing'), tenerYo, 'tengo', t)).toBeNull();
    expect(mistakeLine(m('otherVerb'), tenerYo, 'tengo', t)).toBeNull();
  });

  it('has a Spanish translation for every line it can say', () => {
    const { asked, tr } = recording();
    const details: MistakeDetail[] = [
      { person: 'el', tense: 'imperfect', entry: 'estar', pronoun: 'me', expectedPronoun: 'se', subjectPronoun: 'yo', number: 'pl' },
      ...(['yo', 'stem', 'stemEverywhere', 'spelling', 'irregular'] as const).map((change) => ({ change })),
    ];
    for (const person of ['tu', 'el', 'yo'] as const) {
      mistakeLine(m('person', { person }), tenerUstedes, 'tienen', tr);
      mistakeLine(m('person', { person }), tenerEllas, 'tienen', tr);
    }
    for (const kind of MISTAKE_KINDS) {
      for (const detail of details) {
        for (const prompt of [tenerYo, gustarMi, tengo, { ...gustarMi, direction: 'fromForm' as const, entryLabel: null, cue: null }, tenerUstedes, tenerEllas]) {
          mistakeLine(m(kind, detail), prompt, prompt === tengo ? 'tener · yo · presente' : 'gustarle · a mí · presente', tr);
        }
        mistakeLabel(m(kind, detail), tr);
      }
      mistakeLabel(m(kind), tr);
    }
    expect([...new Set(asked)].filter((message) => !(message in MESSAGES.es))).toEqual([]);
  });
});

describe('guideSectionFor', () => {
  it('picks the first section the deck’s guide shows, most specific first', () => {
    expect(guideSectionFor(['present-stem-e-ie', 'present-stem', 'present-build'], new Set(['present-build', 'present-stem']))).toBe('present-stem');
  });

  it('gives none when the guide shows none of them, or nothing is known of the guide', () => {
    expect(guideSectionFor(['dative-how'], new Set(['present-build']))).toBeUndefined();
    expect(guideSectionFor([], new Set(['present-build']))).toBeUndefined();
    expect(guideSectionFor(['dative-how'], undefined)).toBeUndefined();
    expect(guideSectionFor(undefined, new Set(['dative-how']))).toBeUndefined();
  });
});

describe('mistakeLabel', () => {
  it('words each kind for the teacher, with its detail', () => {
    expect(mistakeLabel(m('person', { person: 'el' }), t)).toBe('The él/ella/Ud. form for another person');
    expect(mistakeLabel(m('person', { person: 'ellos' }), t)).toBe('The ellos/ellas/Uds. form for another person');
    expect(mistakeLabel(m('tense', { tense: 'preterite' }), t)).toBe('The pretérito for another tense');
    expect(mistakeLabel(m('regularized', { change: 'yo' }), t)).toBe('Irregular yo form made regular');
    expect(mistakeLabel(m('regularized', { change: 'stemEverywhere' }), t)).toBe('Stem change in a form that has none');
    expect(mistakeLabel(m('pronounWrong', { pronoun: 'se', expectedPronoun: 'me' }), t)).toBe('Wrong pronoun (se for me)');
    expect(mistakeLabel(m('otherVerb', { entry: 'estar' }), t)).toBe('Another verb (estar)');
    expect(mistakeLabel(m('dativeNumber', { number: 'pl' }), t)).toBe('gusta / gustan: the number of the thing liked');
    expect(mistakeLabel(m('infinitive'), t)).toBe('The dictionary form (infinitive)');
  });
});

describe('mistakeLine with a sentence (v1.25.0)', () => {
  /** "Mis primos ___ (vivir) en Lima.": the subject stands in for the label, its pronoun for the person. */
  const misPrimos: MistakePrompt = { ...tenerYo, entryLabel: 'vivir', personLabel: 'mis primos', personId: 'ellos', subjectPronoun: 'ellos' };

  it('says the plural subject needs its -n form, naming the subject as the sentence wrote it', () => {
    expect(mistakeLine(m('person', { person: 'el' }), misPrimos, 'viven', t)).toBe('Mis primos is plural, so the verb needs its -n form.');
    // "Ana y tú" is ustedes: a tú answer gets the ustedes line.
    const anaYTu = { ...misPrimos, personLabel: 'Ana y tú', subjectPronoun: 'ustedes' };
    expect(mistakeLine(m('person', { person: 'tu' }), anaYTu, 'viven', t)).toBe('That’s the tú form. Ustedes takes the -n form, like ellos and ellas.');
  });

  it('reads a thing subject by its pronoun too: "Las mochilas ___ (costar) mucho dinero."', () => {
    const mochilas = { ...misPrimos, entryLabel: 'costar', personLabel: 'las mochilas', subjectPronoun: 'ellas' };
    expect(mistakeLine(m('person', { person: 'el' }), mochilas, 'cuestan', t)).toBe('Las mochilas is plural, so the verb needs its -n form.');
    const almuerzo = { ...misPrimos, entryLabel: 'costar', personLabel: 'el almuerzo', personId: 'el', subjectPronoun: 'él' };
    expect(mistakeLine(m('person', { person: 'ellos' }), almuerzo, 'cuesta', t)).toBe('That’s the ellos / ellas / ustedes form, not the él form.');
    // A noun subject that came with no pronoun is never "the las mochilas form": its cell's person names it.
    const bare = { ...mochilas, subjectPronoun: null };
    expect(mistakeLine(m('person', { person: 'el' }), bare, 'cuestan', t)).toBe('Las mochilas is plural, so the verb needs its -n form.');
    expect(mistakeLine(m('person', { person: 'nosotros' }), bare, 'cuestan', t)).not.toContain('las mochilas form');
  });

  it('names the pronoun, not the noun, when another person\'s form was given', () => {
    const miAbuela = { ...misPrimos, personLabel: 'mi abuela', personId: 'el', subjectPronoun: 'ella' };
    expect(mistakeLine(m('person', { person: 'yo' }), miAbuela, 'vive', t)).toBe('That’s the yo form, not the ella form.');
  });
});
