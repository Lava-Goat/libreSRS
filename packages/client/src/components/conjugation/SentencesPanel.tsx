// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin → Decks → Conjugation → Sentences (v1.25.0): how "give the form"
 * questions show who. Off is the person label ("ustedes (tener)"); the other
 * modes show a sentence with a blank ("Mis primos ___ (vivir) en Lima.") on
 * every rung, for the same questions and the same progress. A form with no
 * sentence keeps the label.
 *
 * The mode and the holdback are part of the settings draft (saved with
 * Save); everything else here acts at once: the coverage line, each verb's
 * sentences filled in with their English (Hide / Show again), a preview as a
 * student at each rung, the parked sentences, the students' reports and the
 * sentences missed far more than their form otherwise is.
 */
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { PromptText } from './ConjugationRunner';

type Outputs = inferRouterOutputs<AppRouter>['conjugation']['sentences'];
type Panel = Outputs['panel'];
type CellList = Outputs['list']['cells'][number];
type SentenceRow = CellList['sentences'][number];
export type SentenceMode = Panel['mode'];
type Rung = 'choice' | 'typed-lenient' | 'typed-strict';

const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
/** A small button's shape; its colours are one of the two sets below, never both (Tailwind orders them by stylesheet, not by class string). */
const smallBase = 'inline-flex items-center min-h-[24px] px-2 py-0.5 rounded text-xs font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const smallIdle = 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600';
const smallPressed = 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500';
const small = `${smallBase} ${smallIdle}`;
const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const hint = 'text-xs text-gray-500 dark:text-gray-400';

type T = (key: string, params?: Record<string, string | number>) => string;

export function modeLabel(mode: SentenceMode, t: T): string {
  switch (mode) {
    case 'builtIn': return t('Built-in sentences');
    case 'approved': return t('Approved sentences only');
    case 'both': return t('Built-in and approved sentences');
    default: return t('Off: the person label');
  }
}

function levelName(level: Rung, t: T): string {
  if (level === 'choice') return t('Multiple choice');
  if (level === 'typed-lenient') return t('Typed · accents forgiven');
  return t('Typed · accents count');
}

/** A sentence filled in, its form highlighted. */
function Filled({ row, id }: { row: Pick<SentenceRow, 'before' | 'form' | 'after'>; id?: string }) {
  return (
    <span id={id} lang="es">
      {row.before}{row.before && ' '}
      <mark className="bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100 rounded px-0.5 font-semibold">{row.form}</mark>
      {row.after && ' '}{row.after}
    </span>
  );
}

/** One sentence as a student sees it, at a rung of the deck's ladder (the answer and the English below it). */
function Preview({ deckId, entry, cell, row, levels }: { deckId: number; entry: string; cell: CellList; row: SentenceRow; levels: readonly Rung[] }) {
  const { t } = useI18n();
  const id = useId();
  const [level, setLevel] = useState<Rung>(levels[0] ?? 'choice');
  const { data, error, isLoading } = trpc.conjugation.sentences.preview.useQuery({
    deckId, entry, tense: cell.tense, person: cell.person, number: cell.number, ref: row.ref, level,
  });
  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      <div role="group" aria-label={t('Preview as a student')} className="flex flex-wrap gap-2">
        {levels.map((l) => (
          <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
            className={`${smallBase} ${level === l ? smallPressed : smallIdle}`}>
            {levelName(l, t)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>}
      {isLoading || !data ? <p className={hint}>{t('Loading...')}</p> : (
        <div className="space-y-2">
          <PromptText prompt={data.prompt} titleId={`${id}-title`} />
          {data.prompt.options ? (
            <ol className="grid grid-cols-2 gap-2 text-sm" aria-label={t('Options')}>
              {data.prompt.options.map((o, i) => (
                <li key={o} lang="es" className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-gray-900 dark:text-gray-100">{i + 1}. {o}</li>
              ))}
            </ol>
          ) : (
            <p className={hint}>{data.prompt.strictAccents ? t('The student types the form; accents count.') : t('The student types the form; accent slips are forgiven.')}</p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('Answer:')} <span lang="es" className="font-semibold">{data.answer}</span>
            {' · '}<span lang="es">{data.filled}</span>
            {data.english && <> · <span lang="en">{data.english}</span></>}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One verb's sentences, form by form, with Hide / Show again and a preview. Each row's buttons are described
 * by its sentence (a list of "Hide" buttons is no help to a screen reader), a sentence the deck's mode does not
 * show says so, and the list ends with a second "Hide sentences" (`onClose`), since the first is far above.
 */
function VerbSentences({ deckId, entry, label, levels, onClose }: {
  deckId: number;
  entry: string;
  label: string;
  levels: readonly Rung[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const rowId = useId();
  const utils = trpc.useUtils();
  const { data, error, isLoading } = trpc.conjugation.sentences.list.useQuery({ deckId, entry });
  const hide = trpc.conjugation.sentences.hide.useMutation({
    onSuccess: () => {
      void utils.conjugation.sentences.list.invalidate({ deckId, entry });
      void utils.conjugation.sentences.panel.invalidate({ deckId });
    },
  });
  const [preview, setPreview] = useState<string | null>(null);
  if (error) return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>;
  if (isLoading || !data) return <p className={hint}>{t('Loading...')}</p>;
  return (
    <div className="mt-2 space-y-3">
      {data.cells.map((cell) => (
        <div key={`${cell.tense}|${cell.person}|${cell.number ?? '-'}`}>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span lang="es">{cell.personLabel} · {cell.tenseLabel}</span>
            {' · '}
            {cell.sentences.length === 0 ? t('no sentence: the label') : cell.sentences.length === 1 ? t('1 sentence') : t('{{count}} sentences', { count: cell.sentences.length })}
          </h5>
          {cell.sentences.length > 0 && (
            <ul className="mt-1 space-y-2">
              {cell.sentences.map((row, i) => {
                const key = `${cell.tense}|${cell.person}|${row.ref}`;
                const filledId = `${rowId}-${cell.tense}-${cell.person}-${cell.number ?? '-'}-${i}`;
                return (
                  <li key={row.ref} className={`text-sm ${row.hidden || !row.used ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Filled row={row} id={filledId} />
                      {row.hidden && <span className="text-xs font-medium px-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">{t('hidden')}</span>}
                      {!row.hidden && !row.used && <span className="text-xs font-medium px-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">{t('not shown in this mode')}</span>}
                      {row.source !== 'builtIn' && <span className="text-xs font-medium px-1.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300">{row.status === 'approved' ? t('approved') : t('not approved')}</span>}
                    </div>
                    {row.english && <div lang="en" className={hint}>{row.english}</div>}
                    {row.warnings.map((w) => (
                      <div key={w.rule} className="text-xs text-amber-700 dark:text-amber-400">
                        {w.rule === 'noTimeWord' ? t('No time word: only the tense label tells the tense.') : t('Words you allowed: {{words}}', { words: w.words.join(', ') })}
                      </div>
                    ))}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {row.source === 'builtIn' && (
                        <button type="button" className={small} disabled={hide.isPending} aria-describedby={filledId}
                          onClick={() => hide.mutate({ deckId, ref: row.ref, hidden: !row.hidden })}>
                          {row.hidden ? t('Show again') : t('Hide')}
                        </button>
                      )}
                      <button type="button" className={small} aria-expanded={preview === key} aria-describedby={filledId} onClick={() => setPreview(preview === key ? null : key)}>
                        {preview === key ? t('Close the preview') : t('Preview as a student')}
                      </button>
                    </div>
                    {preview === key && <Preview deckId={deckId} entry={entry} cell={cell} row={row} levels={levels} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {hide.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{hide.error.message}</p>}
      <button type="button" className={secondary} aria-label={t('Hide sentences: {{verb}}', { verb: label })} onClick={onClose}>
        {t('Hide sentences')}
      </button>
    </div>
  );
}

export default function SentencesPanel({ deckId, mode, holdback, saving, onMode, onHoldback, saved }: {
  deckId: number;
  /** The draft's mode and holdback (saved with Save). */
  mode: SentenceMode;
  holdback: boolean;
  saving: boolean;
  onMode: (mode: SentenceMode) => void;
  onHoldback: (on: boolean) => void;
  /** The saved mode, which the numbers below are for. */
  saved: SentenceMode;
}) {
  const { t, formatDate } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const { data, error, isLoading } = trpc.conjugation.sentences.panel.useQuery({ deckId });
  const resolve = trpc.conjugation.sentences.resolveReports.useMutation({ onSuccess: () => void utils.conjugation.sentences.panel.invalidate({ deckId }) });
  // "Done" removes its own row: once the list has it no more, the focus goes to the row that took its place (or
  // the one before, or the panel's heading), never to the top of the page.
  const [doneAt, setDoneAt] = useState<{ index: number; ref: string } | null>(null);
  const reportsList = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reports = data?.reports;
  useEffect(() => {
    if (!doneAt || !reports || reports.some((r) => r.ref === doneAt.ref)) return;
    const buttons = reportsList.current?.querySelectorAll<HTMLButtonElement>('button[data-report-done]');
    const next = buttons?.[Math.min(doneAt.index, buttons.length - 1)];
    (next ?? headingRef.current)?.focus();
    setDoneAt(null);
  }, [doneAt, reports]);
  const hide = trpc.conjugation.sentences.hide.useMutation({
    onSuccess: () => {
      void utils.conjugation.sentences.panel.invalidate({ deckId });
      void utils.conjugation.sentences.list.invalidate();
    },
  });
  const [open, setOpen] = useState<string | null>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const levels = (data?.levels ?? []) as Rung[];
  /** Closes a verb's list from its end: the focus goes back to the verb's own toggle. */
  const closeFromEnd = (entry: string) => {
    setOpen(null);
    requestAnimationFrame(() => toggles.current.get(entry)?.focus());
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
      <h4 id={`${id}-heading`} ref={headingRef} tabIndex={-1} className="font-medium text-gray-900 dark:text-gray-100 focus:outline-none">{t('Sentences')}</h4>
      <p className={hint}>
        {t('A “give the form” question can be a sentence with a blank instead of a person label: “Mis primos ___ (vivir) en Lima.” The subject tells the student who. Same questions, same progress; a form with no sentence keeps the label.')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-mode`} className={fieldLabel}>{t('How questions show who')}</label>
          <select id={`${id}-mode`} className={`${input} mt-1 block w-full`} value={mode} disabled={saving}
            onChange={(e) => onMode(e.target.value as SentenceMode)}>
            {(['off', 'builtIn', 'approved', 'both'] as const).map((m) => <option key={m} value={m}>{modeLabel(m, t)}</option>)}
          </select>
          {mode !== saved && <p className={`${hint} mt-1`}>{t('Saved when you press Save.')}</p>}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span id={`${id}-holdback`} className={fieldLabel}>{t('Measure it (holdback)')}</span>
            <p id={`${id}-holdback-hint`} className={hint}>
              {t('For each student, half the verbs show sentences and half the label. The first time a form comes back a week or more after the student first saw it, it is shown either way, at random. Results can then compare the two. Leave it off unless you are measuring.')}
            </p>
            {holdback && mode === 'off' && <p className="text-xs text-amber-700 dark:text-amber-400">{t('It needs sentences on: with Off, every question shows the label.')}</p>}
          </div>
          <button type="button" role="switch" aria-checked={holdback} aria-labelledby={`${id}-holdback`} aria-describedby={`${id}-holdback-hint`}
            disabled={saving} onClick={() => onHoldback(!holdback)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 ${holdback ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${holdback ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>}
      {isLoading || !data ? (!error && <p className={hint}>{t('Loading...')}</p>) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-800 dark:text-gray-200 tabular-nums">
            {data.coverage.label === 1
              ? t('{{covered}} of {{cells}} forms have a sentence; 1 uses the label.', data.coverage)
              : t('{{covered}} of {{cells}} forms have a sentence; {{label}} use the label.', data.coverage)}
            {data.mode === 'off' && <span className={`${hint} ml-1`}>{t('(with built-in sentences, once you turn them on)')}</span>}
            {data.mode !== 'off' && data.sentencesSince && (
              <span className={`${hint} ml-1`}>{t('On since {{date}}.', { date: formatDate(data.sentencesSince) })}</span>
            )}
          </p>

          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.verbs.map((v) => (
              <li key={v.entry} className="py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span lang="es" className="text-sm font-medium text-gray-900 dark:text-gray-100">{v.label}</span>
                  <span className={`${hint} tabular-nums`}>
                    {v.sentences === 1
                      ? t('{{covered}} of {{cells}} forms · 1 sentence', { covered: v.covered, cells: v.cells })
                      : t('{{covered}} of {{cells}} forms · {{n}} sentences', { covered: v.covered, cells: v.cells, n: v.sentences })}
                    {v.hidden > 0 && ` · ${t('{{n}} hidden', { n: v.hidden })}`}
                  </span>
                  {/* The name starts with the visible words (WCAG 2.5.3): "Show sentences: estudiar". */}
                  <button type="button" className={`${secondary} ml-auto`} aria-expanded={open === v.entry}
                    ref={(el) => { if (el) toggles.current.set(v.entry, el); else toggles.current.delete(v.entry); }}
                    aria-label={open === v.entry ? t('Hide sentences: {{verb}}', { verb: v.label }) : t('Show sentences: {{verb}}', { verb: v.label })}
                    onClick={() => setOpen(open === v.entry ? null : v.entry)}>
                    {open === v.entry ? t('Hide sentences') : t('Show sentences')}
                  </button>
                </div>
                {open === v.entry && <VerbSentences deckId={deckId} entry={v.entry} label={v.label} levels={levels} onClose={() => closeFromEnd(v.entry)} />}
              </li>
            ))}
          </ul>

          {data.reports.length > 0 && (
            <div>
              <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('Reported by students')}</h5>
              <ul ref={reportsList} className="mt-1 space-y-2 text-sm">
                {data.reports.map((r, i) => (
                  <li key={r.ref} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span id={`${id}-report-${i}`} lang="es" className="text-gray-900 dark:text-gray-100">{r.sentence}</span>
                    <span className={hint}>{r.count === 1 ? t('1 report') : t('{{count}} reports', { count: r.count })} · {formatDate(r.lastAt)}</span>
                    <span className="ml-auto flex gap-2">
                      {r.ref.startsWith('tpl:') && (
                        <button type="button" className={small} disabled={hide.isPending} aria-describedby={`${id}-report-${i}`} onClick={() => hide.mutate({ deckId, ref: r.ref, hidden: true })}>{t('Hide')}</button>
                      )}
                      <button type="button" data-report-done="" className={small} disabled={resolve.isPending} aria-describedby={`${id}-report-${i}`}
                        onClick={() => { setDoneAt({ index: i, ref: r.ref }); resolve.mutate({ deckId, ref: r.ref }); }}>{t('Done')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.hard.length > 0 && (
            <div>
              <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('Hard sentences')}</h5>
              <p className={hint}>{t('Missed far more often than the same form with other sentences or the label (after 15 answers or more).')}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {data.hard.map((h, i) => (
                  <li key={h.ref} className="flex flex-wrap items-baseline gap-x-2">
                    <span id={`${id}-hard-${i}`} lang="es" className="text-gray-900 dark:text-gray-100">{h.sentence ?? h.label}</span>
                    <span className={`${hint} tabular-nums`}>
                      {t('missed {{misses}} of {{attempts}}', { misses: h.misses, attempts: h.answers })}
                      {' · '}{t('otherwise {{misses}} of {{attempts}}', { misses: h.otherMisses, attempts: h.otherAnswers })}
                    </span>
                    {h.ref.startsWith('tpl:') && (
                      <button type="button" className={`${small} ml-auto`} disabled={hide.isPending} aria-describedby={`${id}-hard-${i}`} onClick={() => hide.mutate({ deckId, ref: h.ref, hidden: true })}>{t('Hide')}</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.parkedCount > 0 && (
            <div>
              <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('Parked sentences')}</h5>
              <p className={hint}>{t('With the settings as saved, the checker rejects these, so students never see them. Their forms use other sentences or the label.')}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {data.parked.map((p) => (
                  <li key={`${p.ref}|${p.tenseLabel}|${p.personLabel}`}>
                    <span lang="es" className="text-gray-900 dark:text-gray-100">{p.text}</span>
                    <span className={`${hint} ml-2`}>
                      <span lang="es">{p.label} · {p.personLabel} · {p.tenseLabel}</span>
                      {p.reasons.map((r, i) => <Fragment key={i}>{' · '}<span lang="en">{r.message}</span></Fragment>)}
                    </span>
                  </li>
                ))}
              </ul>
              {data.parkedCount > data.parked.length && <p className={hint}>{t('and {{count}} more', { count: data.parkedCount - data.parked.length })}</p>}
            </div>
          )}
          {(resolve.error || hide.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{(resolve.error ?? hide.error)?.message}</p>}
        </div>
      )}
    </section>
  );
}
