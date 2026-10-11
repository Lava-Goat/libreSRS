// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin → Decks → selected deck: the deck's conjugation quiz ("[Deck]
 * conjugation"). The teacher turns it on, picks what it drills, reviews the
 * verbs found in the cards, and sees the scores. Everything is a local draft
 * until Save; students always play the saved settings.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import {
  TENSES,
  VOS_REGIONS,
  cellsFor,
  entryKind,
  entryLabel,
  isKnownVerb,
  parseEntry,
  NOTE_HAY,
  NOTE_UNKNOWN,
  NOTE_WEATHER,
  type Tense,
  type VerbKind,
} from '@libresrs/shared/conjugation';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import ConjugationResults from './ConjugationResults';
import SentencesPanel from './SentencesPanel';

type SettingsView = inferRouterOutputs<AppRouter>['conjugation']['settings'];
type QuizSettings = SettingsView['settings'];
type EntryView = SettingsView['entries'][number];

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const hint = 'text-xs text-gray-500 dark:text-gray-400';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';

// The server's limits (services/conjugationQuiz.ts), checked here first so
// the teacher gets a plain message instead of a validation dump.
const ROUND_LENGTH_MIN = 5;
const ROUND_LENGTH_MAX = 60;
const MAX_ENTRY_LIST = 100;
/** Source cards listed per verb before "and N more". */
const CARDS_SHOWN = 3;

interface Draft {
  enabled: boolean;
  tenses: Tense[];
  includeVosotros: boolean;
  vos: QuizSettings['vos'];
  directions: QuizSettings['directions'];
  answerMode: QuizSettings['answerMode'];
  accentMode: QuizSettings['accentMode'];
  roundLengthText: string;
  excludedEntries: string[];
  extraEntries: string[];
  /** v1.25.0: how "give the form" questions show who, and the holdback. */
  sentences: QuizSettings['sentences'];
  sentenceHoldback: boolean;
}

function draftFrom(settings: QuizSettings): Draft {
  return {
    enabled: settings.enabled,
    tenses: [...settings.tenses],
    includeVosotros: settings.includeVosotros,
    vos: settings.vos,
    directions: settings.directions,
    answerMode: settings.answerMode,
    accentMode: settings.accentMode,
    roundLengthText: String(settings.roundLength),
    excludedEntries: [...settings.excludedEntries],
    extraEntries: [...settings.extraEntries],
    sentences: settings.sentences ?? 'off',
    sentenceHoldback: !!settings.sentenceHoldback,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function sameDraft(a: Draft, b: Draft): boolean {
  return a.enabled === b.enabled
    && sameSet(a.tenses, b.tenses)
    && a.includeVosotros === b.includeVosotros
    && a.vos === b.vos
    && a.directions === b.directions
    && a.answerMode === b.answerMode
    && a.accentMode === b.accentMode
    && a.roundLengthText.trim() === b.roundLengthText.trim()
    && sameSet(a.excludedEntries, b.excludedEntries)
    && sameSet(a.extraEntries, b.extraEntries)
    && a.sentences === b.sentences
    && a.sentenceHoldback === b.sentenceHoldback;
}

/** The round length typed, or null when it is not a whole number in range. */
function roundLengthOf(draft: Draft): number | null {
  const text = draft.roundLengthText.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= ROUND_LENGTH_MIN && value <= ROUND_LENGTH_MAX ? value : null;
}

/** Whether the draft drills an entry: detected and not left out, or added by hand. */
function includedIn(draft: Draft, entry: Pick<EntryView, 'entry' | 'extra' | 'excludedByDefault'>): boolean {
  if (draft.extraEntries.includes(entry.entry)) return true;
  if (entry.extra || entry.excludedByDefault) return false;
  return !draft.excludedEntries.includes(entry.entry);
}

/** The draft with an entry included or left out. */
function withEntry(draft: Draft, entry: Pick<EntryView, 'entry' | 'extra' | 'excludedByDefault'>, on: boolean): Draft {
  const without = (list: string[]) => list.filter((e) => e !== entry.entry);
  // A detected verb is dropped through the exclusions; one the detector leaves
  // out, or one the teacher typed, only joins through the added list.
  const detectedByDefault = !entry.extra && !entry.excludedByDefault;
  if (on) {
    return detectedByDefault
      ? { ...draft, excludedEntries: without(draft.excludedEntries) }
      : { ...draft, extraEntries: draft.extraEntries.includes(entry.entry) ? draft.extraEntries : [...draft.extraEntries, entry.entry] };
  }
  return {
    ...draft,
    extraEntries: without(draft.extraEntries),
    excludedEntries: detectedByDefault && !draft.excludedEntries.includes(entry.entry)
      ? [...draft.excludedEntries, entry.entry]
      : draft.excludedEntries,
  };
}

/**
 * Card text without its HTML (cards may carry <b>, <i>, images), entities
 * decoded (&amp; → &). Tags go first, so the parse is of plain text and
 * loads nothing.
 */
function plain(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ');
  const decoded = new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text;
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Whether any included entry has a form in the draft's tenses and persons (the server builds no items otherwise). */
function drillsAnything(draft: Draft, entries: EntryView[]): boolean {
  const opts = { vosotros: draft.includeVosotros, vos: draft.vos === 'none' ? null : draft.vos };
  return entries.some((e) => includedIn(draft, e) && cellsFor(e.entry, draft.tenses, opts).length > 0);
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** The engine's notes (English) in the page's language. */
function noteText(note: string, t: T): string {
  if (note === NOTE_UNKNOWN) return t('Not in the dictionary: conjugated as a regular verb. Check the forms.');
  if (note === NOTE_HAY) return t('Impersonal: practiced as hay / había / hubo…');
  if (note === NOTE_WEATHER) return t('Impersonal: practiced only in the third person singular (llueve, nieva…)');
  const dative = note.match(/^used with me\/te\/le: practiced as "(.+)"$/);
  if (dative) return t('Used with me/te/le: practiced as “{{forms}}”', { forms: dative[1] });
  const impersonal = note.match(/^impersonal: practiced as (.+)$/);
  if (impersonal) return t('Impersonal: practiced as {{forms}}', { forms: impersonal[1] });
  return note;
}

function KindBadge({ kind }: { kind: VerbKind }) {
  const { t } = useI18n();
  const label = kind === 'pronominal' ? t('reflexive')
    : kind === 'dative' ? t('“me gusta” type')
      : kind === 'impersonal' ? t('impersonal')
        : null;
  if (!label) return null;
  const colour = kind === 'pronominal'
    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
    : kind === 'dative'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colour}`}>{label}</span>;
}

/** Every form of one entry for the draft's tenses, conjugated on the server. */
function EntryPreview({ id, entry, draft, rowNote }: {
  id: string;
  entry: string;
  draft: Draft;
  /** The note the row already shows: not repeated here. */
  rowNote: string | null;
}) {
  const { t } = useI18n();
  const noTenses = draft.tenses.length === 0;
  const { data, isLoading, error } = trpc.conjugation.preview.useQuery(
    { entry, tenses: draft.tenses, vosotros: draft.includeVosotros, vos: draft.vos },
    { enabled: !noTenses },
  );
  let body;
  if (noTenses) body = <p className={hint}>{t('Pick at least one tense to see the forms.')}</p>;
  else if (error) body = <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>;
  else if (isLoading || !data) body = <p className={hint}>{t('Loading...')}</p>;
  else {
    const tenses = [...new Set(data.cells.map((c) => c.tense))];
    body = data.cells.length === 0
      ? <p className={hint}>{t('No forms for these tenses.')}</p>
      : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tenses.map((tense) => {
            const cells = data.cells.filter((c) => c.tense === tense);
            return (
              <table key={tense} className="text-sm">
                <caption className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 pb-1">
                  {cells[0].tenseLabel}
                </caption>
                <tbody>
                  {cells.map((c) => (
                    <tr key={`${c.person}|${c.number ?? '-'}`}>
                      <th scope="row" className="pr-3 py-0.5 text-left font-normal text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.personLabel}
                        {c.cue && <span className="text-gray-500 dark:text-gray-400"> + {c.cue}</span>}
                      </th>
                      <td className="py-0.5 text-gray-900 dark:text-gray-100">{c.forms.join(' / ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
        </div>
      );
  }
  return (
    <div id={id} className="mt-2 rounded bg-gray-50 dark:bg-gray-900/40 p-3">
      {data?.note && data.note !== rowNote && <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">{noteText(data.note, t)}</p>}
      {body}
    </div>
  );
}

function EntryRow({ entry, draft, pending, disabled, onToggle }: {
  entry: EntryView;
  draft: Draft;
  /** Typed in this draft, not saved yet. */
  pending: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const included = includedIn(draft, entry);
  const moreCards = entry.cards.length - CARDS_SHOWN;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={included}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span lang="es">{entry.label}</span>
        </label>
        <KindBadge kind={entry.kind} />
        {pending && included && <span className={hint}>{t('added — saved when you press Save')}</span>}
        {!pending && entry.extra && <span className={hint}>{t('added by you')}</span>}
        {entry.excludedByDefault && !included && <span className={hint}>{t('left out by default')}</span>}
        <button
          type="button"
          className={`${secondary} ml-auto`}
          aria-expanded={previewOpen}
          aria-controls={previewOpen ? `${id}-preview` : undefined}
          aria-label={previewOpen ? t('Hide forms of {{verb}}', { verb: entry.label }) : t('Preview forms of {{verb}}', { verb: entry.label })}
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {previewOpen ? t('Hide forms') : t('Preview forms')}
        </button>
      </div>
      {entry.cards.length > 0 && (
        <p className={`${hint} mt-1`}>
          {t('From:')}{' '}
          {entry.cards.slice(0, CARDS_SHOWN).map((c, i) => (
            <span key={c.id ?? i}>
              {i > 0 && '; '}
              <span lang="es">{plain(c.front)}</span> — {plain(c.back)}
            </span>
          ))}
          {moreCards > 0 && ` ${t('and {{count}} more', { count: moreCards })}`}
        </p>
      )}
      {entry.note && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{noteText(entry.note, t)}</p>}
      {previewOpen && <EntryPreview id={`${id}-preview`} entry={entry.entry} draft={draft} rowNote={entry.note} />}
    </li>
  );
}

export default function ConjugationSettings({ deckId, cardCount, onDirtyChange }: {
  deckId: number;
  /** The deck's card count as the page knows it: a change (an import) re-reads the verbs. */
  cardCount?: number;
  /** Told whenever the draft gains or loses unsaved changes, so the page can confirm before dropping it. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const { data, isLoading, error: loadError, refetch } = trpc.conjugation.settings.useQuery({ deckId });
  const saveSettings = trpc.conjugation.saveSettings.useMutation();
  /** Null while nothing is edited: the form shows the saved settings. */
  const [edited, setEdited] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newVerb, setNewVerb] = useState('');
  const [verbError, setVerbError] = useState<string | null>(null);
  const [view, setView] = useState<'settings' | 'results'>('settings');
  /** Verbs typed since the last Save or Discard: listed even once unticked, so the row (and its focus) stays. */
  const [addedHere, setAddedHere] = useState<string[]>([]);

  const savedCardCount = data?.cardCount;
  // Cards imported since the verbs were read: read them again.
  useEffect(() => {
    if (cardCount !== undefined && savedCardCount !== undefined && cardCount !== savedCardCount) void refetch();
  }, [cardCount, savedCardCount, refetch]);

  // Worked out before the early returns so the hook order never changes.
  const dirty = !!data && edited !== null && !sameDraft(edited, draftFrom(data.settings));
  useEffect(() => {
    onDirtyChange?.(dirty);
    // Unmounting drops the draft: nothing is left unsaved here.
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  if (!data) {
    if (loadError) return <div role="alert" className={alertBox}>{loadError.message}</div>;
    return isLoading ? <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div> : null;
  }

  const saved = draftFrom(data.settings);
  const draft = edited ?? saved;
  const set = (changes: Partial<Draft>) => {
    setEdited({ ...draft, ...changes });
    setNotice(null);
    // An edit may fix what the last Save complained about; a stale alert would contradict the form.
    setError(null);
  };

  // The server's list, then verbs typed in this draft that it does not know yet.
  // Typing order first: unticking drops a verb from extraEntries, and ordering
  // by that list would move its row to the end.
  const pendingEntries: EntryView[] = [...new Set([...addedHere, ...draft.extraEntries])]
    .filter((entry) => !data.entries.some((e) => e.entry === entry))
    .map((entry) => {
      const known = isKnownVerb(entry);
      return {
        entry,
        label: entryLabel(entry),
        kind: entryKind(entry),
        known,
        cards: [],
        note: known ? null : NOTE_UNKNOWN,
        excludedByDefault: false,
        included: true,
        extra: true,
      };
    });
  const entries = [...data.entries, ...pendingEntries];
  const includedCount = entries.filter((e) => includedIn(draft, e)).length;
  const noItems = includedCount > 0 && draft.tenses.length > 0 && !drillsAnything(draft, entries);
  const roundLength = roundLengthOf(draft);
  const typedOnlyAccents = draft.answerMode === 'choice';

  const toggleTense = (tense: Tense, on: boolean) => {
    const wanted = new Set(on ? [...draft.tenses, tense] : draft.tenses.filter((x) => x !== tense));
    set({ tenses: TENSES.map((x) => x.id).filter((x) => wanted.has(x)) });
  };

  const addVerb = (e: FormEvent) => {
    e.preventDefault();
    const typed = newVerb.trim();
    if (!typed) return;
    const parsed = parseEntry(typed);
    if (!parsed) {
      setVerbError(t('“{{verb}}” is not a Spanish verb. Type an infinitive (bailar), with -se (llamarse) or -le (gustarle), or haber (hay).', { verb: typed }));
      return;
    }
    const existing = entries.find((x) => x.entry === parsed.id);
    if (existing && includedIn(draft, existing)) {
      setVerbError(t('{{verb}} is already in the list.', { verb: existing.label }));
      return;
    }
    const next = withEntry(draft, existing ?? { entry: parsed.id, extra: true, excludedByDefault: false }, true);
    if (next.extraEntries.length > MAX_ENTRY_LIST) {
      setVerbError(t('A deck can have at most {{count}} added verbs.', { count: MAX_ENTRY_LIST }));
      return;
    }
    setVerbError(null);
    setNewVerb('');
    if (!addedHere.includes(parsed.id)) setAddedHere([...addedHere, parsed.id]);
    set(next);
  };

  const problem = (): string | null => {
    if (draft.tenses.length === 0) return t('Pick at least one tense.');
    if (roundLength === null) {
      return t('The round length must be a whole number from {{min}} to {{max}}.', { min: ROUND_LENGTH_MIN, max: ROUND_LENGTH_MAX });
    }
    if (draft.excludedEntries.length > MAX_ENTRY_LIST || draft.extraEntries.length > MAX_ENTRY_LIST) {
      return t('A deck can have at most {{count}} added verbs.', { count: MAX_ENTRY_LIST });
    }
    return null;
  };

  const save = async () => {
    const found = problem();
    if (found) {
      setError(found);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSettings.mutateAsync({
        deckId,
        enabled: draft.enabled,
        tenses: draft.tenses,
        includeVosotros: draft.includeVosotros,
        vos: draft.vos,
        directions: draft.directions,
        answerMode: draft.answerMode,
        accentMode: draft.accentMode,
        roundLength: roundLength!,
        excludedEntries: draft.excludedEntries,
        extraEntries: draft.extraEntries,
        sentences: draft.sentences,
        sentenceHoldback: draft.sentenceHoldback,
      });
      utils.conjugation.settings.setData({ deckId }, result);
      setEdited(null);
      setAddedHere([]);
      setNotice(t('Saved.'));
      // The teacher's own dashboard link and the scores follow the new settings.
      void utils.conjugation.myQuizzes.invalidate();
      void utils.conjugation.results.invalidate({ deckId });
      // Coverage and parked sentences follow the saved tenses, persons and mode.
      void utils.conjugation.sentences.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const vosOptions: { value: QuizSettings['vos']; label: string }[] = [
    { value: 'none', label: t('Off') },
    ...VOS_REGIONS.map((r) => ({ value: r.id as QuizSettings['vos'], label: r.es })),
  ];

  return (
    <section aria-labelledby={`${id}-heading`} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${id}-heading`} className="font-semibold text-gray-900 dark:text-gray-100">{t('Conjugation')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('A quiz built from the verbs in this deck. Students see it as “{{name}}”.', { name: t('{{deck}} conjugation', { deck: data.deckName }) })}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('It comes with an “Intro to conjugation” guide that grows with it: a chapter for each tense you turn on and for the kinds of verb the deck has, and parts on typing and accents as each student reaches them. Try it to read it (a teacher can show every chapter).')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondary}
            onClick={() => setView(view === 'results' ? 'settings' : 'results')}
          >
            {view === 'results' ? t('Back to settings') : t('Results')}
          </button>
          <Link
            to={`/conjugation/${deckId}`}
            target="_blank"
            rel="noopener"
            className={secondary}
            title={t('Opens in a new tab, with the saved settings')}
          >
            {t('Try it')}
          </Link>
        </div>
      </div>

      {view === 'results' && <div className="mt-4"><ConjugationResults deckId={deckId} /></div>}

      {/* Hidden, not unmounted, while the results show: the draft survives. */}
      <div hidden={view === 'results'} className="mt-4 space-y-5">
        <div className="flex items-center justify-between gap-3 py-3 border-y border-gray-200 dark:border-gray-700">
          <div>
            <span id={`${id}-enabled`} className="font-medium text-gray-900 dark:text-gray-100">{t('Students can practice it')}</span>
            <p id={`${id}-enabled-hint`} className={hint}>
              {draft.enabled
                ? t('On: the quiz shows on the dashboard of every student who has this deck.')
                : t('Off: only you can open it, with Try it.')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-labelledby={`${id}-enabled`}
            aria-describedby={`${id}-enabled-hint`}
            disabled={saving}
            onClick={() => set({ enabled: !draft.enabled })}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 ${
              draft.enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <fieldset>
          <legend className={fieldLabel}>{t('Tenses')}</legend>
          <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {TENSES.map((tense) => (
              <label key={tense.id} className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={draft.tenses.includes(tense.id)}
                  disabled={saving}
                  onChange={(e) => toggleTense(tense.id, e.target.checked)}
                />
                <span><span lang="es">{tense.es}</span> <span className="text-gray-500 dark:text-gray-400">({tense.en})</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={fieldLabel}>{t('Persons')}</legend>
          <p className={hint}>{t('Ustedes is always part of the third person plural.')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                checked={draft.includeVosotros}
                disabled={saving}
                onChange={(e) => set({ includeVosotros: e.target.checked })}
              />
              {t('Include vosotros')}
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <span lang="es">vos</span>
              <select
                className={input}
                value={draft.vos}
                disabled={saving}
                onChange={(e) => set({ vos: e.target.value as QuizSettings['vos'] })}
              >
                {vosOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-directions`} className={fieldLabel}>{t('Directions')}</label>
            <select
              id={`${id}-directions`}
              className={`${input} mt-1 block w-full`}
              aria-describedby={draft.directions !== 'toForm' ? `${id}-directions-hint` : undefined}
              value={draft.directions}
              disabled={saving}
              onChange={(e) => set({ directions: e.target.value as QuizSettings['directions'] })}
            >
              <option value="both">{t('Both ways')}</option>
              <option value="toForm">{t('Infinitive → conjugated form')}</option>
              <option value="fromForm">{t('Conjugated form → verb and person')}</option>
            </select>
            {/* Typing infinitives trained recalling tener, not producing tengo (research report improvement 3). */}
            {draft.directions !== 'toForm' && (
              <p id={`${id}-directions-hint`} className={`${hint} mt-1`}>
                {t('Naming the verb is always multiple choice: every typed answer is a conjugated form.')}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-answer`} className={fieldLabel}>{t('Answers')}</label>
            <select
              id={`${id}-answer`}
              className={`${input} mt-1 block w-full`}
              value={draft.answerMode}
              disabled={saving}
              onChange={(e) => set({ answerMode: e.target.value as QuizSettings['answerMode'] })}
            >
              <option value="progressive">{t('Progressive: multiple choice, then typed')}</option>
              <option value="choice">{t('Multiple choice only')}</option>
              <option value="typed">{t('Typed only')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-accents`} className={fieldLabel}>{t('Accents')}</label>
            <select
              id={`${id}-accents`}
              className={`${input} mt-1 block w-full`}
              aria-describedby={typedOnlyAccents ? `${id}-accents-hint` : undefined}
              value={draft.accentMode}
              disabled={saving || typedOnlyAccents}
              onChange={(e) => set({ accentMode: e.target.value as QuizSettings['accentMode'] })}
            >
              <option value="progressive">{t('Progressive: forgiven, then required')}</option>
              <option value="forgiven">{t('Forgiven (slips are pointed out)')}</option>
              <option value="required">{t('Required')}</option>
            </select>
            {typedOnlyAccents && (
              <p id={`${id}-accents-hint`} className={`${hint} mt-1`}>{t('Accents only matter in typed answers.')}</p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-length`} className={fieldLabel}>{t('Questions per round')}</label>
            <input
              id={`${id}-length`}
              inputMode="numeric"
              className={`${input} mt-1 w-24 tabular-nums`}
              aria-describedby={`${id}-length-hint`}
              aria-invalid={roundLength === null}
              value={draft.roundLengthText}
              disabled={saving}
              onChange={(e) => set({ roundLengthText: e.target.value })}
            />
            <p id={`${id}-length-hint`} className={`${hint} mt-1`}>
              {t('{{min}} to {{max}}. A missed question comes back once at the end of the round.', { min: ROUND_LENGTH_MIN, max: ROUND_LENGTH_MAX })}
            </p>
          </div>
        </div>

        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">{t('Verbs')}</h4>
          <p className={hint}>
            {t('Found in the cards of this deck. Each verb is practiced the way the deck uses it: llamarse as me llamo, gustarle as me gusta(n).')}
          </p>
          {entries.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('No verbs found in this deck’s cards. Add one below.')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.entry}
                  entry={entry}
                  draft={draft}
                  pending={pendingEntries.includes(entry)}
                  disabled={saving}
                  onToggle={(on) => set(withEntry(draft, entry, on))}
                />
              ))}
            </ul>
          )}
          <form onSubmit={addVerb} className="mt-3">
            <label htmlFor={`${id}-add`} className={fieldLabel}>{t('Add a verb')}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                id={`${id}-add`}
                lang="es"
                className={`${input} w-56`}
                value={newVerb}
                maxLength={60}
                disabled={saving}
                aria-describedby={`${id}-add-hint`}
                aria-invalid={verbError !== null}
                placeholder="bailar, llamarse, gustarle"
                onChange={(e) => { setNewVerb(e.target.value); setVerbError(null); }}
              />
              <button type="submit" className={secondary} disabled={saving || !newVerb.trim()}>{t('Add')}</button>
            </div>
            <p id={`${id}-add-hint`} className={`${hint} mt-1`}>
              {t('An infinitive, with -se for the reflexive (llamarse) or -le for the “me gusta” type (gustarle), or haber (hay).')}
            </p>
            {verbError && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{verbError}</p>}
          </form>
        </div>

        <SentencesPanel
          deckId={deckId}
          mode={draft.sentences}
          holdback={draft.sentenceHoldback}
          saved={data.settings.sentences ?? 'off'}
          saving={saving}
          onMode={(sentences) => set({ sentences })}
          onHoldback={(sentenceHoldback) => set({ sentenceHoldback })}
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 tabular-nums">
            {t('{{verbs}} verbs · {{items}} items', { verbs: data.verbCount, items: data.itemCount })}
            {dirty && <span className={`${hint} ml-1`}>{t('(as saved)')}</span>}
          </p>
          {draft.enabled && includedCount === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('Students see no quiz until at least one verb is included.')}</p>
          )}
          {draft.enabled && noItems && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('Students see no quiz: these verbs have no forms in the tenses picked.')}</p>
          )}
        </div>

        {error && <div role="alert" className={alertBox}>{error}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={primary}>
            {saving ? t('Saving...') : t('Save')}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => { setEdited(null); setAddedHere([]); setError(null); setVerbError(null); }}
              disabled={saving}
              className={secondary}
            >
              {t('Discard changes')}
            </button>
          )}
          <span role="status" className="text-sm text-gray-600 dark:text-gray-400">
            {dirty ? t('Unsaved changes. Students play the saved settings.') : notice}
          </span>
        </div>
      </div>
    </section>
  );
}
