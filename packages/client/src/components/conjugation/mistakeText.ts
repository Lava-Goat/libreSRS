// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A named mistake in words: one line for the student under a wrong answer
 * (research report improvement 6), and a short label for the teacher's
 * "Common mistakes". The server names the mistake (classifyMistake in
 * @libresrs/shared/conjugation); this only words it, in the page's language.
 *
 * Only what the analysis is sure of is said: an accent slip already has its
 * own headline, and an unknown answer gets no line at all. The wording names
 * the rule, never calls a form "not Spanish".
 */
import {
  DATIVE_CLITICS,
  EXPERIENCER_LABELS,
  PERSON_IDS,
  SHORT_PERSON_LABELS,
  TENSES,
  isImperative,
  isPerson,
  parseEntry,
  personLabel,
  subjectPerson,
  type MistakeDetail,
  type MistakeKind,
  type Tense,
} from '@libresrs/shared/conjugation';
import { verbName } from './guide/Paradigm';

type Translate = (message: string, params?: Record<string, string | number>) => string;

/** A mistake as the answer response and the results carry it. */
export interface MistakeLike {
  kind: MistakeKind;
  detail: MistakeDetail;
}

/** What the line needs of the prompt it answers. */
export interface MistakePrompt {
  direction: 'toForm' | 'fromForm';
  entryLabel: string | null;
  /** Who the prompt named: one subject since v1.24.0 ("ustedes", "a ellas"), the whole group before. */
  personLabel: string | null;
  /** The cell's person ("ellos" for "ustedes"); absent from a prompt of a page older than v1.24.0. */
  personId?: string | null;
  /**
   * A sentence's subject (v1.25.0): `personLabel` is then the subject as written ("mis primos") and this the
   * pronoun it is the same as ("ellos"); null for a subject that is a pronoun itself ("ustedes").
   */
  subjectPronoun?: string | null;
  tense: string | null;
  tenseLabel: string | null;
  cue: string | null;
  form: string | null;
}

const tenseName = (tense: string | undefined) => TENSES.find((x) => x.id === tense)?.es ?? tense ?? '';

/** The prompt's verb: named on a "give the form" prompt, first in the answer of a "name the verb" one. */
function promptEntry(prompt: MistakePrompt, correctAnswer: string): string {
  return prompt.entryLabel ?? correctAnswer.split(' · ')[0];
}

/**
 * The line under a wrong answer (or an accent slip that is really another
 * form), or null when there is nothing sure to say.
 */
export function mistakeLine(mistake: MistakeLike | null | undefined, prompt: MistakePrompt, correctAnswer: string, t: Translate): string | null {
  if (!mistake || mistake.kind === 'accent' || mistake.kind === 'unknown') return null;
  const d = mistake.detail;
  const toForm = prompt.direction === 'toForm';
  const dative = prompt.cue !== null || parseEntry(promptEntry(prompt, correctAnswer))?.kind === 'dative';
  const tense = (prompt.tense ?? 'present') as Tense;
  // A gustar-type prompt names who by "a mí", "a ellas"…: its clitic is the one the answer needs. By the
  // person id (v1.24.0: "a ellas" is no longer the whole label), else by the label of an older prompt.
  const target = toForm && dative
    ? (isPerson(prompt.personId) ? prompt.personId : PERSON_IDS.find((p) => EXPERIENCER_LABELS[p] === prompt.personLabel))
    : undefined;
  switch (mistake.kind) {
    case 'person': {
      if (!toForm) {
        return dative ? t('Look at the pronoun (me, te, le…): it tells you who.') : t('Look at the ending: it tells you who.');
      }
      if (dative) {
        return target
          ? t('With {{target}}, the pronoun is {{pronoun}}.', { target: prompt.personLabel ?? EXPERIENCER_LABELS[target], pronoun: DATIVE_CLITICS[target] })
          : null;
      }
      if (!isPerson(d.person) || !prompt.personLabel) return null;
      const plural = pluralLine(prompt, d.person, tense, t);
      if (plural) return plural;
      return t('That’s the {{person}} form, not the {{target}} form.', { person: personLabel(tense, d.person), target: subjectTarget(prompt, tense) });
    }
    case 'tense':
      if (!d.tense) return null;
      if (!toForm || !prompt.tenseLabel) return t('That form isn’t in the {{tense}}.', { tense: tenseName(d.tense) });
      return t('That form is in the {{tense}}, not the {{target}}.', { tense: tenseName(d.tense), target: prompt.tenseLabel });
    case 'regularized':
      switch (d.change) {
        case 'yo': return t('This verb’s yo form is irregular, so the regular pattern doesn’t work here.');
        case 'stem': return t('The stem changes here: that form leaves the change out.');
        case 'stemEverywhere': return t('The stem doesn’t change in this form: the change isn’t in every person.');
        case 'spelling': return t('This form has a spelling change (like c → qu) that keeps its sound.');
        default: return t('This verb is irregular here, so the regular pattern doesn’t work.');
      }
    case 'dativeSubject':
      if (d.subjectPronoun && target) {
        return t('Verbs like gustar take {{pronoun}}, not {{subject}}.', { pronoun: DATIVE_CLITICS[target], subject: d.subjectPronoun });
      }
      return t('Verbs like gustar agree with the thing liked, not with who likes it.');
    case 'dativeNumber':
      if (toForm && prompt.cue) {
        // The answer's number is the wrong one: the cue has the other.
        const number = d.number === 'pl' ? t('singular') : t('plural');
        return t('The verb agrees with the thing liked, and {{cue}} is {{number}}.', { cue: prompt.cue, number });
      }
      return t('Look at the verb’s ending: singular for one thing liked, plural for more.');
    case 'dativeSelf':
      return t('That form is about liking yourself (me gusto: “I like myself”). The verb agrees with the thing liked.');
    case 'pronounMissing':
      return d.pronoun ? t('This verb needs its pronoun: {{pronoun}}.', { pronoun: d.pronoun }) : null;
    case 'pronounExtra':
      return d.pronoun ? t('This verb takes no {{pronoun}}.', { pronoun: d.pronoun }) : null;
    case 'pronounWrong':
      return d.pronoun && d.expectedPronoun
        ? t('The pronoun goes with the person: {{expected}}, not {{pronoun}}.', { expected: d.expectedPronoun, pronoun: d.pronoun })
        : null;
    case 'impersonal':
      return t('This verb has one form for everyone: there is no person to match.');
    case 'infinitive':
      return t('That’s the dictionary form (infinitive): the question asks for a conjugated form.');
    case 'otherVerb': {
      if (!d.entry) return null;
      const verb = verbName(d.entry);
      if (!toForm) return prompt.form ? t('{{form}} isn’t a form of {{verb}}.', { form: prompt.form, verb }) : null;
      return prompt.entryLabel ? t('That’s a form of {{verb}}, not {{target}}.', { verb, target: prompt.entryLabel }) : null;
    }
    default:
      return null;
  }
}

/**
 * Who a "that's the … form" line names: a sentence's subject by the pronoun it is the same as ("mis primos" →
 * ellos, "las mochilas" → ellas); a label, or a subject that is a pronoun ("ustedes"), as shown. A noun subject
 * that came with no pronoun is named by its cell's person ("ellos / ellas / ustedes"), never as a "form".
 */
function subjectTarget(prompt: MistakePrompt, tense: Tense): string {
  const label = prompt.personLabel ?? '';
  if (prompt.subjectPronoun) return prompt.subjectPronoun;
  if (prompt.subjectPronoun === undefined || subjectPerson(label) || !isPerson(prompt.personId)) return label;
  return personLabel(tense, prompt.personId);
}

/**
 * The two lines for a plural subject given a singular form (v1.24.0), worded from the person the answer's
 * form is (detail.person) and the one subject the prompt showed; never for gustar-type verbs or hay (their
 * verb follows the thing liked, or has one form), which never reach here. Null for anything else.
 *  - ustedes answered with a tú (or vos) form: ustedes is "you all", and takes the -n form;
 *  - ellos, ellas or ustedes answered with a singular form: the plural needs its -n form (not "add -n":
 *    comió → comieron).
 */
function pluralLine(prompt: MistakePrompt, given: string, tense: Tense, t: Translate): string | null {
  const subject = prompt.personLabel ?? '';
  // A sentence's subject ("mis primos") is read by the pronoun it is the same as (v1.25.0); a noun subject that
  // came with none by its cell's person.
  const nounOnly = prompt.subjectPronoun === null && !subjectPerson(subject);
  const pronoun = nounOnly ? prompt.personId ?? '' : prompt.subjectPronoun ?? subject;
  if (prompt.personId !== 'ellos' || subjectPerson(pronoun) !== 'ellos') return null;
  if (pronoun === 'ustedes' && (given === 'tu' || given === 'vos') && !isImperative(tense)) {
    return t('That’s the {{person}} form. Ustedes takes the -n form, like ellos and ellas.', { person: personLabel(tense, given) });
  }
  if (given === 'yo' || given === 'tu' || given === 'vos' || given === 'el') {
    return t('{{subject}} is plural, so the verb needs its -n form.', { subject: subject.charAt(0).toUpperCase() + subject.slice(1) });
  }
  return null;
}

/**
 * The first section of a mistake's list that this deck's guide shows (the
 * list is most specific first; a section the deck does not open is skipped),
 * or undefined for none.
 */
export function guideSectionFor(sections: readonly string[] | undefined, open: ReadonlySet<string> | undefined): string | undefined {
  if (!sections || !open) return undefined;
  return sections.find((id) => open.has(id));
}

/** A kind of mistake as the teacher's "Common mistakes" lists it. */
export function mistakeLabel(mistake: MistakeLike, t: Translate): string {
  const d = mistake.detail;
  switch (mistake.kind) {
    case 'person':
      return isPerson(d.person) ? t('The {{person}} form for another person', { person: SHORT_PERSON_LABELS[d.person] }) : t('Another person’s form');
    case 'tense':
      return d.tense ? t('The {{tense}} for another tense', { tense: tenseName(d.tense) }) : t('Another tense');
    case 'regularized':
      switch (d.change) {
        case 'yo': return t('Irregular yo form made regular');
        case 'stem': return t('Stem change left out');
        case 'stemEverywhere': return t('Stem change in a form that has none');
        case 'spelling': return t('Spelling change left out');
        default: return t('Irregular verb made regular');
      }
    case 'dativeSubject': return t('“gustar” type conjugated for the person (gusto)');
    case 'dativeNumber': return t('gusta / gustan: the number of the thing liked');
    case 'dativeSelf': return t('“me gusto” for “me gusta”');
    case 'pronounMissing': return t('Pronoun left out ({{pronoun}})', { pronoun: d.pronoun ?? '' });
    case 'pronounExtra': return t('Pronoun added ({{pronoun}})', { pronoun: d.pronoun ?? '' });
    case 'pronounWrong': return t('Wrong pronoun ({{pronoun}} for {{expected}})', { pronoun: d.pronoun ?? '', expected: d.expectedPronoun ?? '' });
    case 'impersonal': return t('hay or a weather verb given a person');
    case 'infinitive': return t('The dictionary form (infinitive)');
    case 'otherVerb': return d.entry ? t('Another verb ({{verb}})', { verb: verbName(d.entry) }) : t('Another verb');
    case 'accent': return t('Accent only');
    default: return t('Not named');
  }
}
