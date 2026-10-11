// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A conjugation table the engine fills in: one column per verb, one row per
 * person the deck drills (vos and vosotros only when it drills them), so the
 * table shows exactly the forms the quiz accepts. Shading shows what changes:
 * the ending of a regular form; a changed stem or spelling (quiero, busqué,
 * tendré); the whole of a form that follows no pattern (soy, fui, hay). In a
 * compound tense the helping verb is what changes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { EXPERIENCER_LABELS, conjugate, parseEntry, personLabel, type Person, type Tense } from '@libresrs/shared/conjugation';
import { useI18n } from '../../../i18n';
import type { GuideContext, L } from './types';
import { Rich, type GuideLang } from './text';

type Family = 'ar' | 'er' | 'ir';
type Row = Partial<Record<Person, string[]>>;

/** Regular endings: each person's accepted endings, per family. */
const ENDINGS: Partial<Record<Tense, Record<Family, Row>>> = {
  present: {
    ar: { yo: ['o'], tu: ['as'], vos: ['ás'], el: ['a'], nosotros: ['amos'], vosotros: ['áis'], ellos: ['an'] },
    er: { yo: ['o'], tu: ['es'], vos: ['és'], el: ['e'], nosotros: ['emos'], vosotros: ['éis'], ellos: ['en'] },
    ir: { yo: ['o'], tu: ['es'], vos: ['ís'], el: ['e'], nosotros: ['imos'], vosotros: ['ís'], ellos: ['en'] },
  },
  preterite: {
    ar: { yo: ['é'], tu: ['aste'], vos: ['aste'], el: ['ó'], nosotros: ['amos'], vosotros: ['asteis'], ellos: ['aron'] },
    er: { yo: ['í'], tu: ['iste'], vos: ['iste'], el: ['ió'], nosotros: ['imos'], vosotros: ['isteis'], ellos: ['ieron'] },
    ir: { yo: ['í'], tu: ['iste'], vos: ['iste'], el: ['ió'], nosotros: ['imos'], vosotros: ['isteis'], ellos: ['ieron'] },
  },
  imperfect: {
    ar: { yo: ['aba'], tu: ['abas'], vos: ['abas'], el: ['aba'], nosotros: ['ábamos'], vosotros: ['abais'], ellos: ['aban'] },
    er: { yo: ['ía'], tu: ['ías'], vos: ['ías'], el: ['ía'], nosotros: ['íamos'], vosotros: ['íais'], ellos: ['ían'] },
    ir: { yo: ['ía'], tu: ['ías'], vos: ['ías'], el: ['ía'], nosotros: ['íamos'], vosotros: ['íais'], ellos: ['ían'] },
  },
  presentSubjunctive: {
    ar: { yo: ['e'], tu: ['es'], vos: ['es', 'és'], el: ['e'], nosotros: ['emos'], vosotros: ['éis'], ellos: ['en'] },
    er: { yo: ['a'], tu: ['as'], vos: ['as', 'ás'], el: ['a'], nosotros: ['amos'], vosotros: ['áis'], ellos: ['an'] },
    ir: { yo: ['a'], tu: ['as'], vos: ['as', 'ás'], el: ['a'], nosotros: ['amos'], vosotros: ['áis'], ellos: ['an'] },
  },
  imperativeAffirmative: {
    ar: { tu: ['a'], vos: ['á'], el: ['e'], nosotros: ['emos'], vosotros: ['ad'], ellos: ['en'] },
    er: { tu: ['e'], vos: ['é'], el: ['a'], nosotros: ['amos'], vosotros: ['ed'], ellos: ['an'] },
    ir: { tu: ['e'], vos: ['í'], el: ['a'], nosotros: ['amos'], vosotros: ['id'], ellos: ['an'] },
  },
};
ENDINGS.imperativeNegative = {
  ar: { ...ENDINGS.presentSubjunctive!.ar, vosotros: ['éis'] },
  er: { ...ENDINGS.presentSubjunctive!.er, vosotros: ['áis'] },
  ir: { ...ENDINGS.presentSubjunctive!.ir, vosotros: ['áis'] },
};
const FUTURE: Row = { yo: ['é'], tu: ['ás'], vos: ['ás'], el: ['á'], nosotros: ['emos'], vosotros: ['éis'], ellos: ['án'] };
const CONDITIONAL: Row = { yo: ['ía'], tu: ['ías'], vos: ['ías'], el: ['ía'], nosotros: ['íamos'], vosotros: ['íais'], ellos: ['ían'] };
ENDINGS.future = { ar: FUTURE, er: FUTURE, ir: FUTURE };
ENDINGS.conditional = { ar: CONDITIONAL, er: CONDITIONAL, ir: CONDITIONAL };
const IMP_SUBJ = (v: string): Row => ({
  yo: [`${v}ra`, `${v}se`], tu: [`${v}ras`, `${v}ses`], vos: [`${v}ras`, `${v}ses`], el: [`${v}ra`, `${v}se`],
  nosotros: [`${v === 'a' ? 'á' : 'ié'}ramos`, `${v === 'a' ? 'á' : 'ié'}semos`], vosotros: [`${v}rais`, `${v}seis`], ellos: [`${v}ran`, `${v}sen`],
});
ENDINGS.imperfectSubjunctive = { ar: IMP_SUBJ('a'), er: IMP_SUBJ('ie'), ir: IMP_SUBJ('ie') };

const COMPOUND: readonly Tense[] = ['presentPerfect', 'pluperfect', 'presentProgressive'];
const CLITICS = new Set(['me', 'te', 'se', 'nos', 'os', 'le', 'les', 'no', 'lo', 'la', 'los', 'las']);

export type Shade = 'plain' | 'ending' | 'changed' | 'irregular';
export interface Piece { text: string; shade: Shade }

const stripAccent = (s: string) => s.normalize('NFD').replace(/́/g, '').normalize('NFC');

/** Pronouns a pronominal verb's affirmative command or -ndo form carries on its end (siéntate, sentémonos, levantándome). */
const ENCLITICS = ['nos', 'os', 'me', 'te', 'se'];

function splitEnclitic(word: string, attached: boolean): { core: string; clitic: string } {
  const clitic = attached ? ENCLITICS.find((c) => word.length > c.length + 1 && word.endsWith(c)) : undefined;
  return clitic ? { core: word.slice(0, -clitic.length), clitic } : { core: word, clitic: '' };
}

/** An ending as spelled after a vowel, ñ or ll (leíste, leyó, gruñó); the regular spelling first. */
function spelledEndings(ending: string): string[] {
  if (!ending.startsWith('i')) return [ending];
  return /^i[aeoáéó]/.test(ending) ? [ending, `y${ending.slice(1)}`, ending.slice(1)] : [ending, `í${ending.slice(1)}`];
}

/** How one form breaks down: what is regular, what is the ending, what changed. */
export function shadeForm(form: string, entry: string, tense: Tense, person: Person): Piece[] {
  const parsed = parseEntry(entry);
  if (!parsed) return [{ text: form, shade: 'plain' }];
  const base = parsed.base;
  const pronominal = parsed.kind === 'pronominal';
  const family = (stripAccent(base).slice(-2) as Family);
  const stem = base.slice(0, -2);
  const words = form.split(' ');
  const out: Piece[] = [];
  const verbAt = COMPOUND.includes(tense)
    ? words.findIndex((w) => !CLITICS.has(w))
    : words.length - 1 - [...words].reverse().findIndex((w) => !CLITICS.has(w));
  words.forEach((word, i) => {
    if (i > 0) out.push({ text: ' ', shade: 'plain' });
    if (i !== verbAt && !(COMPOUND.includes(tense) && i === words.length - 1)) {
      out.push({ text: word, shade: 'plain' });
      return;
    }
    if (COMPOUND.includes(tense) && i === verbAt) {
      out.push({ text: word, shade: 'ending' });
      return;
    }
    // A pronoun on the end is not part of the verb; the accent it brings (siéntate, levantándome) is not a change.
    const { core, clitic } = splitEnclitic(word, pronominal && (tense === 'imperativeAffirmative' || tense === 'presentProgressive'));
    const tail: Piece[] = clitic ? [{ text: clitic, shade: 'plain' }] : [];
    const same = (a: string, b: string) => (clitic ? stripAccent(a) === stripAccent(b) : a === b);
    if (tense === 'presentProgressive') {
      // The -ndo form: regular as the stem and its usual ending (-yendo after a vowel, -endo after ñ / ll);
      // a changed stem when only the stem differs (durmiendo, pidiendo); else learned whole (yendo).
      const suffixes = family === 'ar' ? ['ando'] : /(ñ|ll)$/.test(stem) ? ['iendo', 'endo'] : ['iendo', 'yendo'];
      const suffix = suffixes.find((s) => core.length > s.length && same(core.slice(-s.length), s));
      if (!suffix) out.push({ text: core, shade: 'irregular' }, ...tail);
      else if (same(core.slice(0, -suffix.length), stem)) out.push({ text: core, shade: 'plain' }, ...tail);
      else out.push({ text: core.slice(0, -suffix.length), shade: 'changed' }, { text: core.slice(-suffix.length), shade: 'plain' }, ...tail);
      return;
    }
    if (COMPOUND.includes(tense)) {
      // The participle: regular when it is the stem and its usual ending.
      const regular = [`${stem}${family === 'ar' ? 'ado' : 'ido'}`, `${stem}ído`];
      out.push({ text: word, shade: regular.includes(word) ? 'plain' : 'irregular' });
      return;
    }
    // sentemos + nos → sentémonos, sentad + os → sentaos: the command loses its last letter.
    const endings = (ENDINGS[tense]?.[family]?.[person] ?? [])
      .map((e) => (clitic === 'nos' ? e.replace(/s$/, '') : clitic === 'os' ? e.replace(/d$/, '') : e));
    const regularStem = tense === 'future' || tense === 'conditional' ? stripAccent(base) : stem;
    const regular = endings.flatMap(spelledEndings)
      .find((e) => core.length >= e.length && same(core.slice(0, core.length - e.length), regularStem) && same(core.slice(core.length - e.length), e));
    if (regular !== undefined) {
      out.push({ text: core.slice(0, core.length - regular.length), shade: 'plain' }, { text: core.slice(core.length - regular.length), shade: 'ending' }, ...tail);
      return;
    }
    const ending = [...endings].sort((a, b) => b.length - a.length).find((e) => core.length > e.length && same(core.slice(-e.length), e));
    if (ending !== undefined) {
      out.push({ text: core.slice(0, -ending.length), shade: 'changed' }, { text: core.slice(-ending.length), shade: 'ending' }, ...tail);
      return;
    }
    out.push({ text: core, shade: 'irregular' }, ...tail);
  });
  return out.filter((p) => p.text !== '');
}

const SHADE_CLASS: Record<Shade, string> = {
  plain: '',
  ending: 'font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40 rounded-sm',
  changed: 'underline decoration-2 decoration-amber-700 dark:decoration-amber-400 underline-offset-2',
  irregular: 'font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-sm',
};

/** The persons a table has rows for: the deck's, less yo in commands; impersonal verbs have one. */
export function tablePersons(ctx: Pick<GuideContext, 'includeVosotros' | 'vos'>, tense: Tense): Person[] {
  const persons: Person[] = ['yo', 'tu'];
  if (ctx.vos) persons.push('vos');
  persons.push('el', 'nosotros');
  if (ctx.includeVosotros) persons.push('vosotros');
  persons.push('ellos');
  return tense === 'imperativeAffirmative' || tense === 'imperativeNegative' ? persons.filter((p) => p !== 'yo') : persons;
}

/** A verb's name as the quiz shows it: impersonal entries by their infinitive. */
export function verbName(entry: string): string {
  const parsed = parseEntry(entry);
  if (!parsed) return entry;
  return parsed.kind === 'impersonal' ? parsed.base : parsed.id;
}

function Form({ form, entry, tense, person, shade }: { form: string; entry: string; tense: Tense; person: Person; shade: boolean }) {
  if (!shade) return <>{form}</>;
  return (
    <>
      {shadeForm(form, entry, tense, person).map((piece, i) => (
        <span key={i} className={SHADE_CLASS[piece.shade]}>{piece.text}</span>
      ))}
    </>
  );
}

export default function Paradigm({ entries, tense, ctx, lang, shade = 'ending', caption, tenseLabel }: {
  entries: readonly string[];
  tense: Tense;
  ctx: Pick<GuideContext, 'includeVosotros' | 'vos'>;
  lang: GuideLang;
  shade?: 'ending' | 'none';
  caption?: L;
  /** The tense's name, for the table's accessible caption when there is no written one. */
  tenseLabel: string;
}) {
  const { t } = useI18n();
  // A table wider than its box scrolls sideways; then it takes keyboard focus, so the arrow keys can scroll it.
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const captionId = useId();
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const check = () => setScrolls(box.scrollWidth > box.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const kinds = entries.map((e) => parseEntry(e)?.kind ?? 'plain');
  const allImpersonal = kinds.every((k) => k === 'impersonal');
  const allDative = kinds.every((k) => k === 'dative');
  const persons: Person[] = allImpersonal ? ['el'] : tablePersons(ctx, tense);
  const region = ctx.vos ?? undefined;
  const cell = (entry: string, person: Person): string[] => {
    const kind = parseEntry(entry)?.kind;
    if (kind === 'impersonal' && person !== 'el') return [];
    if (kind === 'dative') {
      return (['sg', 'pl'] as const).flatMap((n) => conjugate(entry, tense, person, n, region ? { vosRegion: region } : undefined)?.slice(0, 1) ?? []);
    }
    return conjugate(entry, tense, person, undefined, region ? { vosRegion: region } : undefined) ?? [];
  };
  const shadeOn = shade === 'ending';
  const seen = new Set<Shade>();
  if (shadeOn) {
    for (const entry of entries) {
      for (const person of persons) {
        for (const form of cell(entry, person)) {
          const dative = parseEntry(entry)?.kind === 'dative';
          const endPerson = dative ? (form === cell(entry, person)[0] ? 'el' : 'ellos') : person;
          for (const piece of shadeForm(form, entry, tense, endPerson)) seen.add(piece.shade);
        }
      }
    }
  }
  const rowLabel = (person: Person): string => {
    if (allImpersonal) return '';
    if (allDative) return EXPERIENCER_LABELS[person];
    return personLabel(tense, person);
  };
  return (
    <figure className="my-3">
      <div
        ref={scroller}
        // relative: keeps the sr-only caption and "Who" inside this scroll box, not widening a phone's page.
        className="relative overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-labelledby': captionId } : {})}
      >
        <table className="w-auto text-sm border-collapse" lang="es">
          <caption id={captionId} className={caption ? 'caption-bottom text-left text-xs text-gray-600 dark:text-gray-400 pt-1.5' : 'sr-only'}>
            {caption ? <span lang={lang}><Rich text={caption} lang={lang} /></span> : `${tenseLabel}: ${entries.map(verbName).join(', ')}`}
          </caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="py-1.5 pr-2 sm:pr-6 text-left font-medium text-gray-500 dark:text-gray-400">
                <span className="sr-only" lang={lang}>{t('Who')}</span>
              </th>
              {entries.map((entry) => (
                <th key={entry} scope="col" className="py-1.5 pr-2 sm:pr-6 text-left font-semibold text-gray-900 dark:text-gray-100">{verbName(entry)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {persons.map((person) => (
              <tr key={person} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <th scope="row" className="py-1.5 pr-2 sm:pr-6 text-left font-normal text-gray-600 dark:text-gray-400 sm:whitespace-nowrap">{rowLabel(person)}</th>
                {entries.map((entry) => {
                  const forms = cell(entry, person);
                  const dative = parseEntry(entry)?.kind === 'dative';
                  return (
                    <td key={entry} className="py-1.5 pr-2 sm:pr-6 text-gray-900 dark:text-gray-100">
                      {forms.length === 0 ? '—' : forms.map((form, i) => (
                        <span key={form}>
                          {/* A gustar-type cell: one thing liked, then more than one; otherwise two accepted forms. */}
                          {i > 0 && <span className="text-gray-400">{dative ? ' · ' : ' / '}</span>}
                          <Form form={form} entry={entry} tense={tense} person={dative ? (i === 0 ? 'el' : 'ellos') : person} shade={shadeOn} />
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shadeOn && (seen.has('ending') || seen.has('changed') || seen.has('irregular')) && (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400" lang={lang}>
          {seen.has('ending') && <span><span className={`${SHADE_CLASS.ending} px-1`} lang="es">o</span> {t('ending')}</span>}
          {seen.has('changed') && <span><span className={`${SHADE_CLASS.changed} px-0.5`} lang="es">quier</span> {t('changed stem or spelling')}</span>}
          {seen.has('irregular') && <span><span className={`${SHADE_CLASS.irregular} px-1`} lang="es">soy</span> {t('irregular: learn it by heart')}</span>}
        </p>
      )}
    </figure>
  );
}
