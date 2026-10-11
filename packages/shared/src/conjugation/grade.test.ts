// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { conjugate, foldAccents, gradeTyped } from './index.js';
import type { GNumber, Person } from './index.js';

describe('gradeTyped', () => {
  it('accepts exact answers and alternatives, ignoring case, spacing and end punctuation', () => {
    expect(gradeTyped(['hablara', 'hablase'], 'hablase', true)).toBe('correct');
    expect(gradeTyped(['habló'], '  Habló ', true)).toBe('correct');
    expect(gradeTyped(['me llamo'], 'me    llamo', true)).toBe('correct');
    expect(gradeTyped(['ven'], '¡Ven!', true)).toBe('correct');
    expect(gradeTyped(['habló'], 'HABLÓ', true)).toBe('correct');
  });

  it('ignores a leading subject pronoun', () => {
    expect(gradeTyped(['tengo'], 'yo tengo', true)).toBe('correct');
    expect(gradeTyped(['me llamo'], 'yo me llamo', true)).toBe('correct');
    expect(gradeTyped(['habla'], 'él habla', true)).toBe('correct');
    expect(gradeTyped(['habla'], 'el habla', false)).toBe('correct');
    expect(gradeTyped(['hablamos'], 'nosotros hablamos', true)).toBe('correct');
    expect(gradeTyped(['hablan'], 'ustedes hablan', true)).toBe('correct');
    expect(gradeTyped(['no hables'], 'tú no hables', true)).toBe('correct');
    expect(gradeTyped(['tengo'], 'yo', true)).toBe('wrong');
  });

  it('forgives or flags accents depending on strictness', () => {
    expect(gradeTyped(['está'], 'esta', false)).toBe('correct');
    expect(gradeTyped(['habló'], 'hablo', true)).toBe('accent');
    expect(gradeTyped(['está'], 'esta', true)).toBe('accent');
    expect(gradeTyped(['levántate'], 'levantate', true)).toBe('accent');
    expect(gradeTyped(['averigüé'], 'averigue', true)).toBe('accent');
    expect(gradeTyped(['averigüé'], 'averigue', false)).toBe('correct');
    expect(gradeTyped(['tengo'], 'yo tengó', true)).toBe('accent');
  });

  it('never folds ñ', () => {
    expect(gradeTyped(['sueño'], 'sueno', false)).toBe('wrong');
    expect(gradeTyped(['tiño'], 'tino', false)).toBe('wrong');
  });

  it('marks other forms wrong', () => {
    expect(gradeTyped(['tengo'], 'teno', false)).toBe('wrong');
    expect(gradeTyped(['tengo'], 'tienes', false)).toBe('wrong');
    expect(gradeTyped(['tengo'], '', false)).toBe('wrong');
    expect(gradeTyped([], 'tengo', false)).toBe('wrong');
  });

  it('accepts the RAE 2010 spelling and the older accented one', () => {
    const rio = conjugate('reír', 'preterite', 'el') ?? [];
    expect(gradeTyped(rio, 'rio', true)).toBe('correct');
    expect(gradeTyped(rio, 'rió', true)).toBe('correct');
  });

  it('exports foldAccents', () => {
    expect(foldAccents('pingüino ñandú')).toBe('pinguino ñandu');
  });
});

describe('gradeTyped, audit regressions', () => {
  it('accepts the subject pronoun after a command', () => {
    const usted = conjugate('hablar', 'imperativeAffirmative', 'el') ?? [];
    expect(gradeTyped(usted, 'hable usted', true)).toBe('correct');
    expect(gradeTyped(usted, 'Hable Ud.', true)).toBe('correct');
    expect(gradeTyped(usted, 'usted hable', true)).toBe('correct');
    expect(gradeTyped(conjugate('hablar', 'imperativeAffirmative', 'tu') ?? [], 'habla tú', true)).toBe('correct');
    expect(gradeTyped(conjugate('hablar', 'imperativeNegative', 'el') ?? [], 'no hable usted', true)).toBe('correct');
    expect(gradeTyped(conjugate('sentarse', 'imperativeAffirmative', 'ellos') ?? [], 'siéntense ustedes', true)).toBe('correct');
  });

  it('marks a pronoun that disagrees with the verb wrong', () => {
    expect(gradeTyped(['tiene'], 'yo tiene', true)).toBe('wrong');
    expect(gradeTyped(['hablan'], 'nosotros hablan', true)).toBe('wrong');
    expect(gradeTyped(['hablo'], 'tú hablo', true)).toBe('wrong');
    expect(gradeTyped(['hable'], 'ustedes hable', true)).toBe('wrong');
    // With the cell's person given, only that person's pronouns fit.
    expect(gradeTyped(['hable'], 'yo hable', true, 'el')).toBe('wrong');
    expect(gradeTyped(['hable'], 'usted hable', true, 'el')).toBe('correct');
    // Forms the dictionary cannot place are not checked.
    expect(gradeTyped(['tuiteo'], 'yo tuiteo', true)).toBe('correct');
  });

  it('does not forgive, even leniently, an accent that makes another form of the verb', () => {
    expect(gradeTyped(['habló'], 'hablo', false)).toBe('accent');
    expect(gradeTyped(['hablo'], 'habló', false)).toBe('accent');
    expect(gradeTyped(['hablé'], 'hable', false)).toBe('accent');
    // A slip that is no form of the verb is still forgiven.
    expect(gradeTyped(['está'], 'esta', false)).toBe('correct');
    expect(gradeTyped(['levántate'], 'levantate', false)).toBe('correct');
    expect(gradeTyped(['averigüé'], 'averigue', false)).toBe('correct');
  });
});

describe('gradeTyped, dative and impersonal cells', () => {
  const cell = (person: Person, number: GNumber): string[] => conjugate('gustarle', 'present', person, number) ?? [];

  it('accepts an agreeing experiencer phrase before the clitic', () => {
    expect(gradeTyped(cell('yo', 'sg'), 'me gusta', true)).toBe('correct');
    expect(gradeTyped(cell('yo', 'sg'), 'a mí me gusta', true)).toBe('correct');
    expect(gradeTyped(cell('yo', 'sg'), '¡A mí me gusta!', true)).toBe('correct');
    expect(gradeTyped(cell('el', 'pl'), 'a ella le gustan', true)).toBe('correct');
    expect(gradeTyped(cell('el', 'pl'), 'a él le gustan', true)).toBe('correct');
    expect(gradeTyped(cell('el', 'pl'), 'a usted le gustan', true)).toBe('correct');
    expect(gradeTyped(cell('el', 'pl'), 'a Ud. le gustan', true)).toBe('correct');
    expect(gradeTyped(cell('ellos', 'sg'), 'a ustedes les gusta', true)).toBe('correct');
    expect(gradeTyped(cell('ellos', 'sg'), 'a ellas les gusta', true, 'ellos', 'dative')).toBe('correct');
    expect(gradeTyped(cell('nosotros', 'sg'), 'a nosotras nos gusta', true)).toBe('correct');
    expect(gradeTyped(cell('tu', 'pl'), 'a ti te gustan', true)).toBe('correct');
  });

  it('rejects a disagreeing experiencer, a subject pronoun, or a missing clitic', () => {
    expect(gradeTyped(cell('yo', 'sg'), 'a ti me gusta', true)).toBe('wrong');
    expect(gradeTyped(cell('el', 'pl'), 'a ellos le gustan', true)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'gusta', true)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'gusta', false)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'yo me gusta', true)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'yo gusto', false)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'me gusto', false)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'me gustan', false)).toBe('wrong');
    expect(gradeTyped(cell('yo', 'sg'), 'a mí', false)).toBe('wrong');
    // With the cell given, the experiencer must be that person.
    expect(gradeTyped(['me gusta'], 'a ella me gusta', true, 'yo', 'dative')).toBe('wrong');
  });

  it('treats a missing accent on the experiencer as an accent slip', () => {
    expect(gradeTyped(cell('yo', 'sg'), 'a mi me gusta', true)).toBe('accent');
    expect(gradeTyped(cell('yo', 'sg'), 'a mi me gusta', false)).toBe('correct');
    expect(gradeTyped(conjugate('gustarle', 'preterite', 'yo') ?? [], 'a mí me gusto', true)).toBe('accent');
  });

  it('accepts exactly the impersonal form', () => {
    const hay = conjugate('haber-impersonal', 'present', 'el') ?? [];
    expect(gradeTyped(hay, 'hay', true)).toBe('correct');
    expect(gradeTyped(hay, 'Hay.', true)).toBe('correct');
    expect(gradeTyped(hay, 'él hay', false)).toBe('wrong');
    expect(gradeTyped(hay, 'ha', false)).toBe('wrong');
    const habra = conjugate('haber-impersonal', 'future', 'el') ?? [];
    expect(gradeTyped(habra, 'habrá', true, 'el', 'impersonal')).toBe('correct');
    expect(gradeTyped(habra, 'habra', true, 'el', 'impersonal')).toBe('accent');
    expect(gradeTyped(habra, 'él habrá', true, 'el', 'impersonal')).toBe('wrong');
    const llueve = conjugate('llover', 'present', 'el') ?? [];
    expect(gradeTyped(llueve, 'llueve', true)).toBe('correct');
    expect(gradeTyped(llueve, 'él llueve', true)).toBe('wrong');
  });
});

describe('gradeTyped, usage audit regressions', () => {
  it('grades forms shared by two kinds by either kind when none is given, and exactly when it is', () => {
    for (const tense of ['imperfect', 'conditional', 'presentSubjunctive', 'imperfectSubjunctive'] as const) {
      const acc = conjugate('gustarle', tense, 'yo', 'sg') ?? [];
      const a = `a mí ${acc[acc.length - 1]}`;
      expect(gradeTyped(acc, a, true, 'yo'), a).toBe('correct');
      expect(gradeTyped(acc, a, true, 'yo', 'dative'), a).toBe('correct');
      expect(gradeTyped(acc, `yo ${acc[0]}`, true, 'yo', 'dative')).toBe('wrong');
      // Without kind "yo me gustaba" is right for gustarse yo, which has the same forms.
      expect(gradeTyped(acc, `yo ${acc[0]}`, true, 'yo', 'pronominal')).toBe('correct');
    }
    expect(gradeTyped(conjugate('preocuparle', 'imperfect', 'yo', 'sg') ?? [], 'a mí me preocupaba', true, 'yo')).toBe('correct');
    for (const [tense, form] of [['imperfect', 'él había'], ['preterite', 'ella hubo'], ['future', 'habrá usted'], ['presentPerfect', 'él ha habido']] as const) {
      const acc = conjugate('haber-impersonal', tense, 'el') ?? [];
      expect(gradeTyped(acc, form, true, 'el', 'impersonal'), form).toBe('wrong');
      expect(gradeTyped(acc, acc[0], true, 'el', 'impersonal')).toBe('correct');
    }
  });

  it('treats "a tí" as an accent slip and accepts the experiencer after the verb', () => {
    expect(gradeTyped(['te gusta'], 'a tí te gusta', false, 'tu', 'dative')).toBe('correct');
    expect(gradeTyped(['te gusta'], 'a tí te gusta', true, 'tu', 'dative')).toBe('accent');
    expect(gradeTyped(['me gusta'], 'me gusta a mí', true, 'yo', 'dative')).toBe('correct');
    expect(gradeTyped(['les gustan'], 'les gustan a ellas', true)).toBe('correct');
    expect(gradeTyped(['me gusta'], 'me gusta a ti', true, 'yo', 'dative')).toBe('wrong');
    expect(gradeTyped(['me gusta'], 'me gusta a mi', true, 'yo', 'dative')).toBe('accent');
  });
});
