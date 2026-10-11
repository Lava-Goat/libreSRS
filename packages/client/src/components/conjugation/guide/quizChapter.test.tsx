// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "How this practice works" against the quiz as it runs since v1.13: "name
 * the verb" is multiple choice on any ladder, mastery takes two school days,
 * and mastered forms come back for review, from earlier units' quizzes too.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from './chapters';
import Figure from './figures';
import { guideVerbs, openChapters } from './unlock';
import type { GuideContext, Section } from './types';

function ctx(over: Partial<GuideContext> = {}): GuideContext {
  const tenses = over.tenses ?? ['present'];
  return {
    tenses,
    includeVosotros: false,
    vos: null,
    directions: 'both',
    accentMode: 'progressive',
    levels: ['choice', 'typed-lenient', 'typed-strict'],
    reached: [],
    verbs: guideVerbs([{ entry: 'tener', label: 'tener', kind: 'plain' }, { entry: 'ser', label: 'ser', kind: 'plain' }], tenses),
    ...over,
  };
}

const quiz = CHAPTERS.find((c) => c.id === 'quiz')!;
const section = (id: string) => quiz.sections.find((s) => s.id === id) as Section;
const openIds = (c: GuideContext) => new Set(openChapters(CHAPTERS, c).flatMap((o) => o.sections.map((s) => s.id)));
/** A section's text in one language, all blocks together. */
const textOf = (s: Section, lang: 'en' | 'es') => JSON.stringify(s.blocks.map((b) => ('text' in b ? b.text[lang] : 'items' in b ? b.items : null))) + (s.keyIdea?.[lang] ?? '');

describe('the quiz chapter', () => {
  it('shows multiple choice to a typed-only deck that names the verb, since those questions are always multiple choice', () => {
    expect(openIds(ctx({ levels: ['typed-strict'], directions: 'both' })).has('quiz-choice')).toBe(true);
    expect(openIds(ctx({ levels: ['typed-strict'], directions: 'toForm' })).has('quiz-choice')).toBe(false);
  });

  it('tells every student that mastered forms come back, and that quiz mastery is not yet speaking', () => {
    const open = openIds(ctx({ directions: 'toForm' }));
    expect(open.has('quiz-reviews')).toBe(true);
    const reviews = textOf(section('quiz-reviews'), 'en');
    expect(reviews).toContain('Mastered forms come back now and then, to stay mastered.');
    expect(reviews).toContain('earlier unit’s quiz');
    expect(reviews).toContain('about a week after you master it, then three weeks later, then every eight weeks');
    expect(textOf(section('quiz-scores'), 'en')).toContain('Using it while talking takes longer, and that’s normal.');
  });

  it('says mastery takes a right answer on the top rung on two different days', () => {
    expect(textOf(section('quiz-ladder'), 'en')).toContain('Right there again on another day: mastered!');
    expect(section('quiz-ladder').keyIdea?.en).toContain('on two different days');
  });

  it('no longer tells anyone to type a verb’s infinitive', () => {
    const name = textOf(section('quiz-name-it'), 'en');
    expect(name).toContain('always multiple choice');
    expect(name).not.toMatch(/type the verb|Typed:/i);
  });
});

describe('how the quiz shows who (v1.24.0)', () => {
  const persons = CHAPTERS.find((c) => c.id === 'persons')!;
  const labels = persons.sections.find((s) => s.id === 'persons-quiz-labels') as Section;

  it('says a prompt names one subject at a time, and the feedback lists everyone who shares the form', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = textOf(labels, lang);
      expect(text).toContain('*ustedes (tener)* → *tienen*');
      expect(text).toContain('*tienen = ellos · ellas · ustedes*');
      // No slash labels any more in what the quiz shows.
      expect(text).not.toContain('ellos / ellas / ustedes (tener)');
    }
    expect(textOf(labels, 'en')).toContain('one of them at a time');
    expect(textOf(labels, 'en')).toContain('“you all”');
  });

  it('keeps the whole group in the table of persons', () => {
    const glance = persons.sections.find((s) => s.id === 'persons-glance') as Section;
    expect(JSON.stringify(glance.blocks)).toContain('*ellos / ellas / ustedes*');
  });
});

describe('the guide’s drawing of a "name the verb" question', () => {
  it('draws it as multiple choice: the same verb in other persons, with no box to type in', () => {
    render(<Figure block={{ kind: 'figure', figure: 'nameIt' }} ctx={ctx()} />);
    // As the quiz asks it since v1.24.0: the question names the verb, each option one subject.
    const verb = screen.getByText('tener', { selector: 'span' });
    expect(verb).toHaveAttribute('lang', 'es');
    expect(verb.parentElement).toHaveTextContent(/^Which form of tener is this\?$/);
    expect(screen.getByText('tienes')).toBeInTheDocument();
    const options = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(options.map((o) => o.textContent)).toEqual(['1yo', '2tú', '3él', '4ustedesyou all']);
    expect(options.some((o) => o.textContent?.includes(' / '))).toBe(false);
    expect(screen.queryByText('Who?')).not.toBeInTheDocument();
    expect(screen.queryByText(/dictionary form/)).not.toBeInTheDocument();
  });

  it('names the tense in each option when the deck drills more than one', () => {
    render(<Figure block={{ kind: 'figure', figure: 'nameIt' }} ctx={ctx({ tenses: ['present', 'preterite'] })} />);
    const options = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(options.map((o) => o.textContent)).toEqual(['1yo · 3presente', '2tú · presente', '3él · presente', '4ustedes · presenteyou all']);
    expect(options.some((o) => o.textContent?.includes(' / '))).toBe(false);
  });
});

describe('the guide’s drawing of the messages', () => {
  it('shows the line that names a mistake under "Not quite", as the quiz words it', () => {
    render(<Figure block={{ kind: 'figure', figure: 'verdicts' }} ctx={ctx()} />);
    expect(screen.getByText(/Not quite. The answer:/)).toHaveTextContent('That’s the él / ella / usted form, not the yo form. Why? See the guide.');
  });
});
