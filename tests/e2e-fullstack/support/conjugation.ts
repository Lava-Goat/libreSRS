// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A student answering "[Deck] conjugation" prompts: reads the question off
 * the page, works out the answer with the conjugation engine itself (the
 * test's answer key; the server grades with the same engine, built), and
 * answers right or, on purpose, wrong.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  conjugate,
  entryLabel,
  personLabelFor,
  subjectsFor,
  type Person,
  type Tense,
} from '../../../packages/shared/src/conjugation/index';
import { parseExperiencer, parseSubject, tokenize } from '../../../packages/shared/src/conjugation/sentences/index';

/**
 * The person of a sentence's subject, read with the engine's own parser. The text before the blank can hold more
 * than the subject ("Yo también", "Hoy mis primos"), so the longest run of words that parses as one subject wins.
 * The engine's checker found the same subject before the sentence was shown (validate's subject region).
 */
function subjectPerson(before: string): Person {
  const toks = tokenize(before).filter((t) => !t.punct);
  const dative = /^A\s/i.test(before);
  for (let len = toks.length; len > 0; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const span = toks.slice(i, i + len);
      const parsed = dative ? parseExperiencer(span, { vosotros: false }) : parseSubject(span, { vosotros: false });
      if (parsed.ok && parsed.subject.persons.length === 1) return parsed.subject.persons[0];
    }
  }
  // hay and weather verbs have no subject: the él form.
  return 'el';
}

/** What the deck drills: its verb entries, the tense and the persons (the teacher's settings). */
export interface Drill {
  entries: string[];
  tense: Tense;
  tenseLabel: string;
  persons: Person[];
}

export interface Answered {
  direction: 'toForm' | 'fromForm';
  kind: 'choice' | 'typed';
  retry: boolean;
  /** The cell's form: the answer of a toForm prompt, the form shown by a fromForm one. */
  form: string;
  /** What the student picked or typed (the verb, for a typed fromForm prompt). */
  given: string;
  correct: boolean;
  /** v1.25.0: the prompt was a sentence with a blank; its text before and after the blank. */
  sentence?: { before: string; after: string };
}

/** One line per prompt played, for the report: "fromForm choice tengo → tener · yo ✓". */
export function describeAnswers(answers: Answered[]): string {
  return answers.map((a) => `${a.retry ? 'retry ' : ''}${a.direction} ${a.kind} ${a.form} → ${a.given} ${a.correct ? '✓' : '✗'}`).join('; ');
}

interface Reading {
  entry: string;
  person: Person;
}

export class ConjugationStudent {
  constructor(private readonly page: Page, private readonly drill: Drill) {}

  /** The question card on the page. */
  card(): Locator {
    return this.page.locator('[role="group"][aria-labelledby^="conj-prompt-"]');
  }

  /** The prompt's title: "yo (tener)" to conjugate, or the form to identify. */
  async title(): Promise<string> {
    return (await this.card().locator('[id^="conj-prompt-"]').innerText()).trim();
  }

  /** Answers the waiting prompt and checks the server's verdict. */
  async answer(correct: boolean): Promise<Answered> {
    const card = this.card();
    await expect(card).toBeVisible();
    const text = await card.innerText();
    // "Which verb form is this?", or since v1.24.0 "Which form of tener is this?" when every option is tener.
    const direction = /Which verb|Which form of/.test(text) ? 'fromForm' : 'toForm';
    const kind = (await card.getByRole('group', { name: 'Options' }).count()) > 0 ? 'choice' : 'typed';
    const retry = text.includes('Second try');
    // The deck drills one tense: the prompt names it.
    await expect(card.getByText(this.drill.tenseLabel, { exact: true })).toBeVisible();
    const title = await this.title();

    const sentence = direction === 'toForm' && /fills the blank/.test(text);
    const done = sentence
      ? await this.fillIt(card, kind, correct)
      : direction === 'toForm'
        ? await this.conjugateIt(card, kind, title, correct)
        : await this.identifyIt(card, kind, title, correct);

    const verdict = this.page.getByRole('status').filter({ hasText: /Correct|Not quite|Almost/ });
    if (correct) {
      await expect(verdict).toContainText('✓ Correct!');
    } else {
      await expect(verdict).toContainText('✗ Not quite. The answer:');
      await expect(verdict).toContainText(`You answered: ${done.given}`);
      // A first miss comes back once at the end of the round; a missed retry does not.
      if (!retry) await expect(verdict).toContainText('This one comes back at the end of the round.');
    }
    // A sentence comes back filled in with the form, after the answer (v1.25.0).
    if ('sentence' in done && done.sentence) await expect(verdict).toContainText(`${done.sentence.before} ${done.form}`.trim());
    return { direction, kind, retry, correct, ...done };
  }

  /**
   * v1.25.0: "Mis primos ___ (vivir) en Lima." → the form. The subject before the blank says who: the test
   * reads it with the engine's own parser. A right typed answer echoes the whole sentence (the server grades
   * the blank alone); a wrong one is the infinitive.
   */
  private async fillIt(card: Locator, kind: 'choice' | 'typed', correct: boolean) {
    const line = card.locator('[id^="conj-prompt-"]');
    const parts = await line.evaluate((el) => {
      const before: string[] = [];
      const after: string[] = [];
      let seen = false;
      let cue = '';
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) (seen ? after : before).push(node.textContent ?? '');
        else if ((node as Element).classList.contains('sr-only')) seen = true;
        else if (seen && /^\(.+\)$/.test((node.textContent ?? '').trim())) cue = (node.textContent ?? '').trim().slice(1, -1);
      }
      return { before: before.join('').trim(), after: after.join('').trim(), cue };
    });
    const entry = this.drill.entries.find((e) => entryLabel(e) === parts.cue || e === parts.cue);
    if (!entry) throw new Error(`${parts.cue} is not one of the deck's verbs`);
    const person = subjectPerson(parts.before);
    const forms = conjugate(entry, this.drill.tense, person) ?? [];
    expect(forms.length, `${entry} has a ${this.drill.tense} form for ${person} ("${parts.before}")`).toBeGreaterThan(0);
    if (kind === 'choice') {
      const given = await this.pick(card, (option) => forms.includes(option) === correct);
      return { form: forms[0], given, sentence: parts };
    }
    const given = correct ? `${parts.before} ${forms[0]} ${parts.after}`.trim() : entry;
    await card.getByLabel(/^Your answer/).fill(given);
    // The blank shows what is typed, as it is typed, without the sentence it repeats.
    await expect(line.locator('[aria-hidden="true"]')).toHaveText(correct ? forms[0] : given);
    await card.getByRole('button', { name: 'Check' }).click();
    return { form: forms[0], given, sentence: parts };
  }

  /** Moves on after the verdict ("Next", or "See results" after the last one). */
  async next(): Promise<'next' | 'results'> {
    const button = this.card().getByRole('button', { name: /^(Next|See results)$/ });
    const label = (await button.innerText()).trim();
    await button.click();
    return label === 'See results' ? 'results' : 'next';
  }

  /** Whether a person label on the page names a person of an entry: one subject since v1.24.0 ("ustedes"), or the group. */
  private names(entry: string, person: Person, text: string): boolean {
    return subjectsFor(entry, this.drill.tense, person).includes(text) || personLabelFor(entry, this.drill.tense, person) === text;
  }

  /** toForm: "ustedes (tener)" → the form. */
  private async conjugateIt(card: Locator, kind: 'choice' | 'typed', title: string, correct: boolean) {
    const match = /^(.+) \((.+)\)$/.exec(title);
    if (!match) throw new Error(`not a "person (verb)" prompt: ${title}`);
    const [, personText, verbText] = match;
    const entry = this.drill.entries.find((e) => entryLabel(e) === verbText);
    if (!entry) throw new Error(`${verbText} is not one of the deck's verbs`);
    const person = this.drill.persons.find((p) => this.names(entry, p, personText));
    if (!person) throw new Error(`${personText} is not one of the deck's persons`);
    const forms = conjugate(entry, this.drill.tense, person) ?? [];
    expect(forms.length, `${entry} has a ${this.drill.tense} form for ${person}`).toBeGreaterThan(0);

    if (kind === 'choice') {
      const given = await this.pick(card, (option) => forms.includes(option) === correct);
      return { form: forms[0], given };
    }
    // A wrong typed answer: the infinitive itself, the classic slip.
    const given = correct ? forms[0] : entry;
    await card.getByLabel(/^Your answer/).fill(given);
    await card.getByRole('button', { name: 'Check' }).click();
    return { form: forms[0], given };
  }

  /** fromForm: "tengo" → the verb and the person. */
  private async identifyIt(card: Locator, kind: 'choice' | 'typed', form: string, correct: boolean) {
    const readings = this.readingsOf(form);
    expect(readings.length, `${form} is a form of one of the deck's verbs`).toBeGreaterThan(0);
    // Since v1.24.0 an option names one subject ("tener · ustedes"), and just the subject ("ustedes") when the
    // question names the verb ("Which form of tener is this?").
    const shared = /Which form of (.+) is this\?/.exec(await card.innerText())?.[1];
    const fits = (option: string): boolean => {
      const parts = option.split(' · ');
      const [verb, who] = shared ? [shared, parts.join(' · ')] : [parts[0], parts.slice(1).join(' · ')];
      return readings.some((r) => entryLabel(r.entry) === verb && this.names(r.entry, r.person, who));
    };

    if (kind === 'choice') {
      const given = await this.pick(card, (option) => fits(option) === correct);
      return { form, given };
    }
    const reading = readings[0];
    // A wrong typed answer: another of the deck's verbs, with the right person.
    const verb = correct ? reading.entry : this.drill.entries.find((e) => !readings.some((r) => r.entry === e));
    if (!verb) throw new Error(`no wrong verb to give for ${form}`);
    await card.getByLabel(/^The verb, in its dictionary form/).fill(verb);
    await card.getByRole('group', { name: 'Who?' })
      .getByText(personLabelFor(reading.entry, this.drill.tense, reading.person), { exact: true })
      .click();
    await card.getByRole('button', { name: 'Check' }).click();
    return { form, given: verb };
  }

  /** Every (verb, person) of the deck with this form. */
  private readingsOf(form: string): Reading[] {
    return this.drill.entries.flatMap((entry) => this.drill.persons
      .filter((person) => conjugate(entry, this.drill.tense, person)?.includes(form))
      .map((person) => ({ entry, person })));
  }

  /** Clicks the first multiple-choice option that passes the test; returns its text. */
  private async pick(card: Locator, test: (option: string) => boolean): Promise<string> {
    const options = card.getByRole('group', { name: 'Options' });
    const texts = await options.locator('span[lang="es"]').allInnerTexts();
    const chosen = texts.map((t) => t.trim()).find(test);
    if (!chosen) throw new Error(`no option fits among ${JSON.stringify(texts)}`);
    // By its text: an option's button may also hold a gloss under it ("you all").
    await options.getByText(chosen, { exact: true }).click();
    return chosen;
  }
}
