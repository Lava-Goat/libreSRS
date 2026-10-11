// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "Intro to conjugation": the guide, over the quiz page. It shows the
 * chapters and sections open to the student (unlock.ts) and marks the ones
 * that opened since they last looked. A teacher can also see everything, with
 * the parts students do not see yet marked.
 *
 * A modal dialog: focus moves in and stays in, Escape closes it, and the page
 * gets its focus back (the page's own keys, 1–4 and Enter, wait meanwhile).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { TENSES, conjugate } from '@libresrs/shared/conjugation';
import { useI18n } from '../../../i18n';
import { CHAPTERS } from './chapters';
import Figure from './figures';
import Paradigm, { verbName } from './Paradigm';
import { Inline, Rich, guideLang, plain, type GuideLang } from './text';
import { openChapters, verbsWith, type OpenChapter } from './unlock';
import type { Block, ChapterId, GuideContext, Section, SubjectMet, SubjectsBlock } from './types';

export interface GuideTarget {
  chapter?: ChapterId;
  /** A section id: its chapter opens, scrolled to it. */
  section?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const tenseName = (id: string) => TENSES.find((t) => t.id === id)?.es ?? id;

/** The chapter to open on: the target's, else the first with something new, else the first. */
function startChapter(open: OpenChapter[], target: GuideTarget | null, isNew: (s: Section) => boolean): ChapterId | undefined {
  if (target?.section) {
    const hit = open.find((o) => [...o.sections, ...o.closed].some((s) => s.id === target.section));
    if (hit) return hit.chapter.id;
  }
  if (target?.chapter && open.some((o) => o.chapter.id === target.chapter)) return target.chapter;
  return (open.find((o) => o.sections.some(isNew)) ?? open[0])?.chapter.id;
}

/** What a teacher's "show everything" shows before any student met a sentence. */
const EXAMPLE_SUBJECTS: SubjectMet[] = [
  { es: 'mi abuela', pronoun: 'ella', person: 'el' },
  { es: 'mis primos', pronoun: 'ellos', person: 'ellos' },
  { es: 'mi hermano y yo', pronoun: 'nosotros', person: 'nosotros' },
  { es: 'ustedes', pronoun: null, person: 'ellos' },
];

/**
 * "Who is the subject?" (v1.25.0): the subjects of the student's own sentences, the pronoun each one stands for,
 * and the verb's form for it ("mis primos → ellos → viven"); usted and ustedes say what they mean.
 */
function SubjectTable({ block, ctx, lang, showAll }: { block: SubjectsBlock; ctx: GuideContext; lang: GuideLang; showAll: boolean }) {
  const { t } = useI18n();
  const met = ctx.subjectsMet ?? [];
  const rows = met.length > 0 ? met : showAll ? EXAMPLE_SUBJECTS : [];
  if (rows.length === 0) return null;
  const meaning = (s: SubjectMet) => {
    const word = (s.pronoun ?? s.es).toLowerCase();
    if (word === 'ustedes') return t('you all');
    if (word === 'usted') return t('you (formal)');
    return null;
  };
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        {block.caption && <caption className="text-left text-sm text-gray-700 dark:text-gray-300 pb-1"><Rich text={block.caption} lang={lang} /></caption>}
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
            <th scope="col" className="py-1.5 pr-4 font-semibold text-gray-900 dark:text-gray-100">{t('Subject')}</th>
            <th scope="col" className="py-1.5 pr-4 font-semibold text-gray-900 dark:text-gray-100">{t('Same as')}</th>
            <th scope="col" className="py-1.5 font-semibold text-gray-900 dark:text-gray-100"><span lang="es">{verbName(block.verb)}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const gloss = meaning(s);
            return (
              <tr key={s.es} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <th scope="row" lang="es" className="py-1.5 pr-4 text-left font-normal text-gray-900 dark:text-gray-100">{s.es}</th>
                <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-300">
                  <span lang="es">{s.pronoun ?? '—'}</span>
                  {gloss && <span className="text-gray-600 dark:text-gray-400"> ({gloss})</span>}
                </td>
                <td lang="es" className="py-1.5 font-semibold text-blue-700 dark:text-blue-300">{conjugate(block.verb, 'present', s.person)?.[0] ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ block, ctx, lang, showAll }: { block: Block; ctx: GuideContext; lang: GuideLang; showAll: boolean }) {
  const { t } = useI18n();
  switch (block.kind) {
    case 'p':
      return <p className="text-gray-700 dark:text-gray-300 leading-relaxed"><Rich text={block.text} lang={lang} /></p>;
    case 'list':
      return (
        <ul className="list-disc pl-5 space-y-1 text-gray-700 dark:text-gray-300">
          {block.items.map((item, i) => <li key={i}><Rich text={item} lang={lang} /></li>)}
        </ul>
      );
    case 'tip':
      return (
        <p className="rounded-lg border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          <Rich text={block.text} lang={lang} />
        </p>
      );
    case 'examples':
      return (
        <ul className="space-y-2">
          {block.items.map((ex, i) => (
            <li key={i} className="pl-3 border-l-2 border-blue-200 dark:border-blue-800">
              <p lang="es" className="text-gray-900 dark:text-gray-100">
                <Inline source={ex.es} spanClass="font-semibold text-blue-700 dark:text-blue-300" />
              </p>
              <p lang="en" className="text-sm text-gray-500 dark:text-gray-400">{ex.en}</p>
            </li>
          ))}
        </ul>
      );
    case 'compare':
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {block.head.map((h, i) => (
                  <th key={i} scope="col" className="py-1.5 pr-4 text-left font-semibold text-gray-900 dark:text-gray-100 w-1/2"><Rich text={h} lang={lang} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0 align-top">
                  {row.map((cell, j) => <td key={j} className="py-1.5 pr-4 text-gray-700 dark:text-gray-300"><Rich text={cell} lang={lang} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'paradigm':
      return <Paradigm entries={block.entries} tense={block.tense} ctx={ctx} lang={lang} shade={block.shade} caption={block.caption} tenseLabel={tenseName(block.tense)} />;
    case 'deckVerbs': {
      const verbs = verbsWith(ctx, block.tense, block.pattern, block.verbKind);
      if (verbs.length === 0) {
        return showAll ? <p className="text-sm italic text-gray-500 dark:text-gray-400">{t('(No verb of this deck fits here.)')}</p> : null;
      }
      const tables: string[][] = [];
      if (block.withTables && block.tense) for (let i = 0; i < verbs.length; i += 3) tables.push(verbs.slice(i, i + 3).map((v) => v.entry));
      return (
        <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-3 py-2">
          <p className="text-sm text-violet-950 dark:text-violet-100">
            <Rich text={block.text} lang={lang} />{' '}
            <span lang="es" className="font-semibold">{verbs.map((v) => verbName(v.entry)).join(', ')}</span>
          </p>
          {tables.map((entries) => (
            <Paradigm key={entries.join()} entries={entries} tense={block.tense!} ctx={ctx} lang={lang} tenseLabel={tenseName(block.tense!)} />
          ))}
        </div>
      );
    }
    case 'subjects':
      return <SubjectTable block={block} ctx={ctx} lang={lang} showAll={showAll} />;
    case 'figure':
      return (
        <div>
          <Figure block={block} ctx={ctx} />
          {block.caption && <p className="text-xs text-gray-600 dark:text-gray-400 -mt-1"><Rich text={block.caption} lang={lang} /></p>}
        </div>
      );
  }
}

function SectionView({ section, ctx, lang, isNew, closed, showAll }: {
  section: Section;
  ctx: GuideContext;
  lang: GuideLang;
  isNew: boolean;
  /** Not open to students now (teacher view). */
  closed: boolean;
  showAll: boolean;
}) {
  const { t } = useI18n();
  // A hidden part is framed, not faded: fading it took the text under 4.5:1, and the badge already says why it is set apart.
  return (
    <section id={`guide-${section.id}`} aria-labelledby={`guide-${section.id}-title`} className={`space-y-3 scroll-mt-4 ${closed ? 'rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-4' : ''}`}>
      <h4 id={`guide-${section.id}-title`} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100 focus:outline-none">
        <span><Rich text={section.title} lang={lang} /></span>
        {isNew && <NewBadge />}
        {closed && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
            {t('Students do not see this yet')}
          </span>
        )}
      </h4>
      {section.keyIdea && (
        <p className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-sm font-medium text-blue-950 dark:text-blue-100">
          <Rich text={section.keyIdea} lang={lang} />
        </p>
      )}
      {section.blocks.map((block, i) => <BlockView key={i} block={block} ctx={ctx} lang={lang} showAll={showAll} />)}
    </section>
  );
}

export function NewBadge() {
  const { t } = useI18n();
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-600 text-white">{t('New')}</span>
  );
}

export default function ConjugationGuide({ target, onClose, ctx, deckName, quizName, isAdmin, knownAtOpen, opener = null }: {
  /** Where to open. */
  target: GuideTarget | null;
  /**
   * The control pressed to open it. Safari (Macs, iPhones) does not focus a button it clicks, so nothing
   * had focus when the guide opened; closing gives focus to this instead of dropping it on the page.
   */
  opener?: HTMLElement | null;
  onClose: () => void;
  ctx: GuideContext;
  deckName: string;
  /** The quiz as the guide names it, when it is not "[deck] conjugation" ("Study all conjugation", v1.18.0). */
  quizName?: string;
  isAdmin: boolean;
  /** The sections the student knew of when the guide opened; empty on a first visit (nothing is marked new then). */
  knownAtOpen: ReadonlySet<string>;
}) {
  const { t, locale } = useI18n();
  const lang = guideLang(locale);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const isNew = (s: Section) => knownAtOpen.size > 0 && !knownAtOpen.has(s.id);
  const open = useMemo(() => openChapters(CHAPTERS, ctx, showAll), [ctx, showAll]);
  const [chapterId, setChapterId] = useState<ChapterId | undefined>(() => startChapter(openChapters(CHAPTERS, ctx), target, isNew));
  const index = Math.max(0, open.findIndex((o) => o.chapter.id === chapterId));
  const current = open[index] as OpenChapter | undefined;

  // In: the section asked for, else the chapter's title. Out: back to whatever had focus, else to the opener.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const before = active && active !== document.body ? active : opener;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const section = target?.section ? document.getElementById(`guide-${target.section}-title`) : null;
    if (section) {
      section.scrollIntoView?.({ block: 'start' });
      section.focus();
    } else {
      document.getElementById(`${titleId}-chapter`)?.focus();
    }
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
    // Once per opening: the page mounts the guide anew each time.
  }, []);

  const go = (id: ChapterId, moveFocus = true) => {
    setChapterId(id);
    bodyRef.current?.scrollTo?.({ top: 0 });
    // After the chapter renders: its title takes focus, so a screen reader starts there. Not from the select:
    // arrow keys there change it option by option, and focus must stay on it.
    if (moveFocus) requestAnimationFrame(() => document.getElementById(`${titleId}-chapter`)?.focus());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    const panel = panelRef.current;
    if (e.key !== 'Tab' || !panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    // Focus can also sit on the panel or the chapter column (a click on their text puts it there), so the
    // ends are "no item before it" and "no item after it", not only the first and last items.
    const active = document.activeElement;
    const inside = active !== null && panel.contains(active);
    const itemAt = (position: number) => items.some((el) => active !== null && (active.compareDocumentPosition(el) & position) !== 0);
    if (e.shiftKey && (!inside || active === panel || !itemAt(Node.DOCUMENT_POSITION_PRECEDING))) {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (!e.shiftKey && (!inside || !itemAt(Node.DOCUMENT_POSITION_FOLLOWING))) {
      e.preventDefault();
      items[0].focus();
    }
  };

  const chapterNew = (o: OpenChapter) => o.sections.some(isNew);
  let body: ReactNode = null;
  if (current) {
    const shown = showAll ? current.chapter.sections : current.sections;
    body = (
      <article aria-labelledby={`${titleId}-chapter`} className="space-y-8">
        <header className="space-y-1">
          <h3 id={`${titleId}-chapter`} tabIndex={-1} className="text-2xl font-bold text-gray-900 dark:text-gray-100 focus:outline-none">
            <Rich text={current.chapter.title} lang={lang} />
          </h3>
          <p className="text-gray-600 dark:text-gray-400"><Rich text={current.chapter.summary} lang={lang} /></p>
        </header>
        {shown.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            ctx={ctx}
            lang={lang}
            isNew={!showAll && isNew(section)}
            closed={showAll && !current.sections.includes(section)}
            showAll={showAll}
          />
        ))}
        <nav aria-label={t('Chapters')} className="flex flex-wrap justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          {index > 0 ? (
            <button type="button" onClick={() => go(open[index - 1].chapter.id)} className="text-left text-blue-700 dark:text-blue-400 hover:underline">
              ← <Rich text={open[index - 1].chapter.title} lang={lang} />
            </button>
          ) : <span />}
          {index < open.length - 1 && (
            <button type="button" onClick={() => go(open[index + 1].chapter.id)} className="text-right text-blue-700 dark:text-blue-400 hover:underline">
              <Rich text={open[index + 1].chapter.title} lang={lang} /> →
            </button>
          )}
        </nav>
      </article>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // A click on text puts focus here (not on <body>), so Escape and the Tab trap keep working.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        lang={lang}
        // The guide is English or Spanish, left to right, also under an rtl page (ar, fa, he).
        dir="ltr"
        className="bg-white dark:bg-gray-800 w-full sm:max-w-5xl sm:rounded-xl shadow-xl flex flex-col h-full sm:h-[90vh] overflow-hidden focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Intro to conjugation')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 break-words">{quizName ?? t('{{deck}} conjugation', { deck: deckName })} · {t('The guide grows as you practice.')}</p>
          </div>
          <button
            type="button"
            // The one control translated in every locale: read in the page's language.
            lang={locale}
            onClick={onClose}
            className="shrink-0 px-3 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {t('Close')}
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <nav aria-label={t('Contents')} tabIndex={-1} className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 md:overflow-y-auto p-3 space-y-3 focus:outline-none">
            {/* Narrow screens: one line to pick a chapter; wide ones: the whole list. */}
            <label className="md:hidden block text-sm">
              <span className="sr-only">{t('Chapter')}</span>
              <select
                value={current?.chapter.id ?? ''}
                onChange={(e) => go(e.target.value as ChapterId, false)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2"
              >
                {open.map((o, i) => (
                  <option key={o.chapter.id} value={o.chapter.id}>
                    {`${i + 1}. ${plain(o.chapter.title, lang)}${chapterNew(o) ? ` · ${t('New')}` : ''}`}
                  </option>
                ))}
              </select>
            </label>
            <ol className="hidden md:block space-y-0.5">
              {open.map((o, i) => (
                <li key={o.chapter.id}>
                  <button
                    type="button"
                    onClick={() => go(o.chapter.id)}
                    aria-current={o.chapter.id === current?.chapter.id ? 'true' : undefined}
                    className={`group w-full text-left px-2.5 py-1.5 rounded-lg text-sm flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${o.chapter.id === current?.chapter.id
                      ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100 font-medium'
                      // A chapter students cannot open yet: lighter and in italics, never faded below 4.5:1.
                      : o.sections.length === 0
                        ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'} ${o.sections.length === 0 ? 'italic' : ''}`}
                  >
                    {/* Brightens with the row on hover: gray-400 on the dark hover fill is only 4:1. */}
                    <span className="text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-300 tabular-nums">{i + 1}.</span>
                    <span className="flex-1"><Rich text={o.chapter.title} lang={lang} /></span>
                    {chapterNew(o) && <NewBadge />}
                  </button>
                </li>
              ))}
            </ol>
            {isAdmin && (
              <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 px-1">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="mt-0.5" />
                <span>{t('Show every chapter, as a teacher (parts students do not see yet are marked)')}</span>
              </label>
            )}
          </nav>
          {/* Focusable, so a click in the text lands here and the arrow keys, Space and PageDown still scroll it. */}
          <div ref={bodyRef} tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 focus:outline-none">
            {body ?? <p className="text-gray-600 dark:text-gray-400">{t('Nothing to show yet.')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
