// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { LOCALE_STORAGE_KEY } from '../../../i18n/messages';
import ConjugationGuide, { type GuideTarget } from './ConjugationGuide';
import { guideVerbs } from './unlock';
import type { Chapter, GuideContext } from './types';

// A guide of its own, so these tests follow the behaviour, not the prose.
vi.mock('./chapters', () => {
  const L = (en: string, es = `${en} (es)`) => ({ en, es });
  const chapters: Chapter[] = [
    {
      id: 'basics', title: L('What is conjugation?'), summary: L('The idea.'), sections: [
        { id: 'basics-idea', title: L('The idea'), keyIdea: L('Endings say who.'), blocks: [{ kind: 'p', text: L('A verb changes its *ending*.') }] },
      ],
    },
    {
      id: 'present', title: L('The present'), summary: L('Now.'), when: { tense: 'present' }, sections: [
        { id: 'present-build', title: L('How to build it'), blocks: [{ kind: 'paradigm', tense: 'present', entries: ['hablar'] }] },
        {
          id: 'present-stem', title: L('Stem changers'), when: { pattern: 'stem', tense: 'present' },
          blocks: [{ kind: 'deckVerbs', tense: 'present', pattern: 'stem', text: L('In this deck:') }],
        },
        { id: 'present-o-ue', title: L('o to ue'), when: { pattern: 'stem:o>ue', tense: 'present' }, blocks: [{ kind: 'p', text: L('puedo') }] },
      ],
    },
    {
      id: 'quiz', title: L('How this practice works'), summary: L('The screens.'), sections: [
        { id: 'quiz-typing', title: L('Typing your answer'), when: { reached: 'typed-lenient' }, blocks: [{ kind: 'figure', figure: 'ladder' }] },
        { id: 'quiz-who', title: L('Who is the subject?'), when: { sentenceSeen: true }, blocks: [{ kind: 'subjects', verb: 'vivir', caption: L('Your subjects:') }] },
      ],
    },
    { id: 'preterite', title: L('The preterite'), summary: L('Done.'), when: { tense: 'preterite' }, sections: [{ id: 'preterite-when', title: L('When'), blocks: [{ kind: 'p', text: L('ayer') }] }] },
  ];
  return { CHAPTERS: chapters };
});

function ctx(over: Partial<GuideContext> = {}): GuideContext {
  return {
    tenses: ['present'],
    includeVosotros: false,
    vos: null,
    directions: 'both',
    accentMode: 'progressive',
    levels: ['choice', 'typed-lenient', 'typed-strict'],
    reached: [],
    verbs: guideVerbs([{ entry: 'tener', label: 'tener', kind: 'plain' }, { entry: 'querer', label: 'querer', kind: 'plain' }], ['present']),
    ...over,
  };
}

function Harness({ target = null, known = new Set<string>(), isAdmin = false, context = ctx() }: {
  target?: GuideTarget | null; known?: ReadonlySet<string>; isAdmin?: boolean; context?: GuideContext;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      {open && <ConjugationGuide target={target} onClose={() => setOpen(false)} ctx={context} deckName="Unit 1" isAdmin={isAdmin} knownAtOpen={known} />}
    </>
  );
}

async function openGuide(props: Parameters<typeof Harness>[0] = {}) {
  render(<I18nProvider><Harness {...props} /></I18nProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
  return screen.getByRole('dialog', { name: 'Intro to conjugation' });
}

describe('ConjugationGuide', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.style.overflow = '';
  });

  it('opens as a dialog on the first chapter, listing only the chapters open to the student', async () => {
    const dialog = await openGuide();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'What is conjugation?' })).toHaveFocus();
    const contents = within(dialog).getByRole('navigation', { name: 'Contents' });
    const listed = within(contents).getAllByRole('listitem').map((li) => li.textContent);
    expect(listed).toEqual(['1.What is conjugation?', '2.The present']);
    // The key idea and the starred Spanish, as Spanish.
    expect(screen.getByText('Endings say who.')).toBeInTheDocument();
    expect(screen.getByText('ending')).toHaveAttribute('lang', 'es');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('shows the deck’s own verbs where a pattern fits them, and the parts for its patterns only', async () => {
    await openGuide({ target: { chapter: 'present' } });
    expect(screen.getByRole('heading', { name: 'Stem changers' })).toBeInTheDocument();
    expect(screen.getByText('In this deck:').parentElement).toHaveTextContent('In this deck: tener, querer');
    expect(screen.queryByRole('heading', { name: 'o to ue' })).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('hablamos');
  });

  it('opens at the section asked for', async () => {
    await openGuide({ target: { section: 'present-stem' }, context: ctx() });
    expect(screen.getByRole('heading', { level: 4, name: 'Stem changers' })).toHaveFocus();
  });

  it('opens a part about typing once the student types', async () => {
    await openGuide({ context: ctx({ reached: ['choice', 'typed-lenient'] }) });
    await userEvent.click(screen.getByRole('button', { name: /How this practice works/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'How this practice works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Typing your answer' })).toBeInTheDocument();
  });

  it('marks what opened since the student last looked, and opens there', async () => {
    const dialog = await openGuide({ known: new Set(['basics-idea', 'present-build']) });
    // present-stem is new: its chapter opens first, marked in the contents and at the section.
    expect(screen.getByRole('heading', { level: 3, name: 'The present' })).toHaveFocus();
    const contents = within(dialog).getByRole('navigation', { name: 'Contents' });
    expect(within(contents).getByRole('button', { name: /The present/ })).toHaveTextContent('New');
    expect(within(contents).getByRole('button', { name: /What is conjugation/ })).not.toHaveTextContent('New');
    expect(screen.getByRole('heading', { level: 4, name: /Stem changers/ })).toHaveTextContent('New');
  });

  it('marks nothing new on a first visit', async () => {
    await openGuide();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('closes on Escape and on Close, giving focus back', async () => {
    await openGuide();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open it' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives focus back to the control that opened it when the click focused nothing, as in Safari', async () => {
    function Opener() {
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return (
        <>
          <button type="button" onClick={(e) => setOpener(e.currentTarget)}>Open it</button>
          {opener && <ConjugationGuide target={null} onClose={() => setOpener(null)} ctx={ctx()} deckName="Unit 1" isAdmin={false} knownAtOpen={new Set()} opener={opener} />}
        </>
      );
    }
    render(<I18nProvider><Opener /></I18nProvider>);
    // fireEvent clicks without moving focus, the way Safari clicks a button: the page itself had focus.
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.getByRole('dialog', { name: 'Intro to conjugation' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open it' })).toHaveFocus();
  });

  it('still closes on Escape after a click on its text', async () => {
    await openGuide();
    // A click on plain text must leave focus in the dialog, where Escape is heard.
    await userEvent.click(screen.getByText(/A verb changes its/));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', async () => {
    // jsdom lays nothing out: every control counts as visible here, as it would on screen.
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    try {
      const dialog = await openGuide();
      const close = within(dialog).getByRole('button', { name: 'Close' });
      const next = within(dialog).getByRole('button', { name: 'The present →' });
      act(() => next.focus());
      await userEvent.tab();
      expect(close).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(next).toHaveFocus();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps Tab inside the dialog', async () => {
    const dialog = await openGuide();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    act(() => close.focus());
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('moves on chapter by chapter', async () => {
    await openGuide();
    await userEvent.click(screen.getByRole('button', { name: 'The present →' }));
    expect(screen.getByRole('heading', { level: 3, name: 'The present' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← What is conjugation?' })).toBeInTheDocument();
  });

  it('lets a teacher see every chapter, the parts students do not see yet marked', async () => {
    await openGuide({ isAdmin: true });
    await userEvent.click(screen.getByRole('checkbox', { name: /Show every chapter/ }));
    await userEvent.click(screen.getByRole('button', { name: /The preterite/ }));
    expect(screen.getByRole('heading', { level: 4, name: /When/ })).toHaveTextContent('Students do not see this yet');
  });

  it('has no teacher view for a student', async () => {
    await openGuide();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reads Spanish in Spanish', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    render(<I18nProvider><Harness /></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = screen.getByRole('dialog', { name: 'Introducción a la conjugación' });
    expect(dialog).toHaveAttribute('lang', 'es');
    expect(screen.getByRole('heading', { level: 3, name: 'What is conjugation? (es)' })).toBeInTheDocument();
  });

  it('opens "Who is the subject?" once a sentence was met, with a table of the student\'s own subjects (v1.25.0)', async () => {
    await openGuide({
      target: { section: 'quiz-who' },
      context: ctx({
        sentenceSeen: true,
        subjectsMet: [{ es: 'mis primos', pronoun: 'ellos', person: 'ellos' }, { es: 'ustedes', pronoun: null, person: 'ellos' }, { es: 'mi abuela', pronoun: 'ella', person: 'el' }],
      }),
    });
    expect(screen.getByRole('heading', { level: 4, name: 'Who is the subject?' })).toHaveFocus();
    const table = screen.getByRole('table', { name: 'Your subjects:' });
    const rows = within(table).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['SubjectSame asvivir', 'mis primosellosviven', 'ustedes— (you all)viven', 'mi abuelaellavive']);
    expect(within(table).getByRole('rowheader', { name: 'mis primos' })).toHaveAttribute('lang', 'es');
  });

  it('keeps "Who is the subject?" closed until a sentence was met; a teacher sees it with examples', async () => {
    await openGuide({ isAdmin: true });
    expect(screen.queryByRole('button', { name: /How this practice works/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Show every chapter/ }));
    await userEvent.click(screen.getByRole('button', { name: /How this practice works/ }));
    expect(screen.getByRole('heading', { level: 4, name: /Who is the subject\?/ })).toHaveTextContent('Students do not see this yet');
    expect(screen.getByRole('table', { name: 'Your subjects:' })).toHaveTextContent('mi hermano y yonosotrosvivimos');
  });
});
