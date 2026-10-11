// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Conjugation quizzes ("[Deck name] conjugation"): the pure logic. Settings,
 * the verbs and items a deck drills, the level ladder, round selection,
 * prompts and grading. No database here — routers/conjugation.ts stores
 * rounds and progress — and nothing random except through an injected rand,
 * so tests can replay a round exactly.
 *
 * An item is one cell of one verb entry in one direction, keyed
 * `${entry}|${tense}|${person}|${number ?? '-'}|${'to' | 'from'}`:
 *  - to (toForm): the entry, person and tense are shown; the student gives the form;
 *  - from (fromForm): the form is shown; the student names the entry and the
 *    person (and the tense, when the deck drills more than one).
 *
 * Mastery (v1.13): right at the top rung on two different school days. A
 * mastered item comes back when due, after 1, 3 and then every 8 weeks, and
 * each round reserves a quarter of its prompts for due items of any of the
 * student's decks (planRound), so earlier units stay alive.
 */
import {
  NOTE_UNKNOWN,
  TENSES,
  cellsFor,
  classifyMistake,
  classifyReading,
  conjugate,
  cueFor,
  detectVerbs,
  distractors,
  entryKind,
  entryLabel,
  foldAccents,
  gradeTyped,
  isKnownVerb,
  mistakeGuideSections,
  normalizeAnswer,
  parseEntry,
  personLabelFor,
  shortPersonLabelFor,
  subjectsFor,
  warmUp,
  type DeckCard,
  type DetectedVerb,
  type GNumber,
  type Grade,
  type Mistake,
  type Person,
  type Tense,
  type VerbKind,
} from '@libresrs/shared/conjugation';
import { SCHOOL_TIME_ZONE } from './schoolCalendar.js';
import {
  DEFAULT_SENTENCE_MODE,
  SENTENCE_MODES,
  clientSentence,
  isSentenceMode,
  pickPromptSentence,
  promptSentenceOf,
  sentenceFeedback,
  withoutContext,
  type ClientSentence,
  type HoldbackArm,
  type PoolSentence,
  type PromptSentence,
  type SentenceFeedback,
  type SentenceMode,
} from './conjugationSentences.js';

// ---------------------------------------------------------------------------
// Settings

export const VOS_SETTINGS = ['none', 'rioplatense', 'centroamericano'] as const;
export const DIRECTION_SETTINGS = ['both', 'toForm', 'fromForm'] as const;
export const ANSWER_MODES = ['progressive', 'choice', 'typed'] as const;
export const ACCENT_MODES = ['progressive', 'forgiven', 'required'] as const;

export type VosSetting = (typeof VOS_SETTINGS)[number];
export type VosRegion = Exclude<VosSetting, 'none'>;
export type DirectionSetting = (typeof DIRECTION_SETTINGS)[number];
export type AnswerMode = (typeof ANSWER_MODES)[number];
export type AccentMode = (typeof ACCENT_MODES)[number];
/** The engine's persons plus vos, whichever side of the engine's vos work this builds against. */
export type QuizPerson = Person | 'vos';
export type LevelKind = 'choice' | 'typed-lenient' | 'typed-strict';
export type ItemDirection = 'to' | 'from';

export const TENSE_IDS: readonly Tense[] = TENSES.map((t) => t.id);
export const ROUND_LENGTH_MIN = 5;
export const ROUND_LENGTH_MAX = 60;
/** A round left open longer than this is gone: its prompts were built for settings that may have changed. */
export const ROUND_TTL_MS = 3 * 60 * 60 * 1000;
/** Hand-added verbs and exclusions a deck may carry. */
export const MAX_ENTRY_LIST = 100;
/** The longest answer kept: anything longer is not an attempt at a verb form. */
export const MAX_ANSWER_LENGTH = 200;

export interface QuizSettings {
  enabled: boolean;
  /** Engine tense ids, in TENSES order, never empty. */
  tenses: Tense[];
  includeVosotros: boolean;
  vos: VosSetting;
  directions: DirectionSetting;
  answerMode: AnswerMode;
  accentMode: AccentMode;
  roundLength: number;
  /** Detected entries the teacher left out. */
  excludedEntries: string[];
  /** Entries the teacher added by hand. */
  extraEntries: string[];
  /**
   * How "give the form" prompts are shown (v1.25.0): the label ('off', the default) or sentences with a blank
   * (built-in, approved rows, or both). A round snapshot from before v1.25.0 has none: read it with sentenceModeOf.
   */
  sentences: SentenceMode;
  /** The holdback measurement (v1.25.0): half of each student's verbs show sentences, half the label. */
  sentenceHoldback: boolean;
}

/** A deck's sentence mode, 'off' for settings stored before v1.25.0 (a round snapshot, an old row). */
export const sentenceModeOf = (settings: Partial<Pick<QuizSettings, 'sentences'>>): SentenceMode =>
  isSentenceMode(settings.sentences) ? settings.sentences : DEFAULT_SENTENCE_MODE;

export { SENTENCE_MODES, type SentenceMode };

export const DEFAULT_SETTINGS: QuizSettings = {
  enabled: false,
  tenses: ['present'],
  includeVosotros: false,
  vos: 'none',
  directions: 'both',
  answerMode: 'progressive',
  accentMode: 'progressive',
  roundLength: 20,
  excludedEntries: [],
  extraEntries: [],
  sentences: DEFAULT_SENTENCE_MODE,
  sentenceHoldback: false,
};

/** The deck_conjugation row as stored (JSON lists as text). */
export interface SettingsRow {
  enabled: boolean;
  tenses: string;
  includeVosotros: boolean;
  vos: string;
  directions: string;
  answerMode: string;
  accentMode: string;
  roundLength: number;
  excludedEntries: string;
  extraEntries: string;
  /** v1.25.0 (0048). */
  sentences: string;
  sentenceHoldback: boolean;
}

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

function jsonList(text: string | null | undefined): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Known tense ids, once each, in TENSES order. */
export function orderTenses(tenses: Iterable<unknown>): Tense[] {
  const wanted = new Set(tenses);
  return TENSE_IDS.filter((t) => wanted.has(t));
}

/** The canonical id of an entry a teacher typed ("Gustarle" → gustarle, "haber (hay)" → haber-impersonal), or null. */
export function canonicalEntryId(input: string): string | null {
  if (input.length > 60) return null;
  return parseEntry(input)?.id ?? null;
}

/** Canonical ids, once each, invalid ones dropped. */
export function canonicalEntryList(list: Iterable<unknown>): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const id = typeof raw === 'string' ? canonicalEntryId(raw) : null;
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_ENTRY_LIST);
}

/**
 * The settings of a deck, from its row (or the defaults when it has none).
 * Tolerant: a value the code no longer knows falls back to its default rather
 * than breaking the quiz.
 */
export function parseSettings(row: SettingsRow | null | undefined): QuizSettings {
  if (!row) return { ...DEFAULT_SETTINGS, tenses: [...DEFAULT_SETTINGS.tenses], excludedEntries: [], extraEntries: [] };
  const tenses = orderTenses(jsonList(row.tenses));
  const length = Number.isInteger(row.roundLength) ? row.roundLength : DEFAULT_SETTINGS.roundLength;
  return {
    enabled: !!row.enabled,
    tenses: tenses.length > 0 ? tenses : [...DEFAULT_SETTINGS.tenses],
    includeVosotros: !!row.includeVosotros,
    vos: oneOf(VOS_SETTINGS, row.vos, DEFAULT_SETTINGS.vos),
    directions: oneOf(DIRECTION_SETTINGS, row.directions, DEFAULT_SETTINGS.directions),
    answerMode: oneOf(ANSWER_MODES, row.answerMode, DEFAULT_SETTINGS.answerMode),
    accentMode: oneOf(ACCENT_MODES, row.accentMode, DEFAULT_SETTINGS.accentMode),
    roundLength: Math.min(ROUND_LENGTH_MAX, Math.max(ROUND_LENGTH_MIN, length)),
    excludedEntries: canonicalEntryList(jsonList(row.excludedEntries)),
    extraEntries: canonicalEntryList(jsonList(row.extraEntries)),
    sentences: oneOf(SENTENCE_MODES, row.sentences, DEFAULT_SENTENCE_MODE),
    sentenceHoldback: !!row.sentenceHoldback,
  };
}

/** The row to store for some settings. */
export function settingsToRow(settings: QuizSettings): SettingsRow {
  return {
    enabled: settings.enabled,
    tenses: JSON.stringify(orderTenses(settings.tenses)),
    includeVosotros: settings.includeVosotros,
    vos: settings.vos,
    directions: settings.directions,
    answerMode: settings.answerMode,
    accentMode: settings.accentMode,
    roundLength: settings.roundLength,
    excludedEntries: JSON.stringify(settings.excludedEntries),
    extraEntries: JSON.stringify(settings.extraEntries),
    sentences: sentenceModeOf(settings),
    sentenceHoldback: !!settings.sentenceHoldback,
  };
}

// ---------------------------------------------------------------------------
// The engine, widened for vos

interface QuizCell {
  tense: Tense;
  person: QuizPerson;
  number?: GNumber;
}

// The engine gains vos (a person, cellsFor's opts.vos, conjugate's and
// distractors' vosRegion) in a concurrent change; these views of its
// functions compile against either side of it.
const engine = {
  cellsFor: cellsFor as unknown as (
    entry: string, tenses: Tense[], opts: { vosotros: boolean; vos?: VosRegion | null },
  ) => QuizCell[],
  conjugate: conjugate as unknown as (
    entry: string, tense: Tense, person: QuizPerson, number?: GNumber, opts?: { vosRegion?: VosRegion },
  ) => string[] | null,
  distractors: distractors as unknown as (
    entry: string, tense: Tense, person: QuizPerson, count: number,
    opts: { number?: GNumber; seed?: number; strictAccents?: boolean; vosotros?: boolean; vosRegion?: VosRegion; tenses?: readonly Tense[] },
  ) => string[],
  gradeTyped: gradeTyped as unknown as (
    accepted: string[], given: string, strictAccents: boolean, person?: QuizPerson, kind?: VerbKind,
  ) => Grade,
  personLabelFor: personLabelFor as unknown as (entry: string, tense: Tense, person: QuizPerson) => string | undefined,
  subjectsFor: subjectsFor as unknown as (entry: string, tense: Tense, person: QuizPerson) => string[],
  shortPersonLabelFor: shortPersonLabelFor as unknown as (entry: string, tense: Tense, person: QuizPerson) => string,
  cueFor: cueFor as unknown as (entry: string, cell: QuizCell, seed?: number) => string | null,
};

const vosRegion = (settings: Pick<QuizSettings, 'vos'>): VosRegion | undefined =>
  settings.vos === 'none' ? undefined : settings.vos;

const TENSE_ES = new Map(TENSES.map((t) => [t.id, t.es]));
export const tenseLabel = (tense: Tense): string => TENSE_ES.get(tense) ?? tense;

/** The label of a person for an entry: "yo", "a mí", "vos", "a vos"; '' for impersonal entries. */
export function personLabel(entry: string, tense: Tense, person: QuizPerson): string {
  const label = engine.personLabelFor(entry, tense, person);
  if (label !== undefined && label !== person) return label;
  if (person === 'vos') return entryKind(entry) === 'dative' ? 'a vos' : 'vos';
  return label ?? person;
}

/**
 * The real subjects a prompt for a cell names, one at a time (v1.24.0): "él",
 * "ella", "usted"; "a ellos", "a ellas", "a ustedes"; one for yo, tú, vos and
 * the commands; none for an impersonal entry.
 */
export function subjectsOf(entry: string, tense: Tense, person: QuizPerson): string[] {
  return engine.subjectsFor(entry, tense, person);
}

/** A cell's person for the teacher, short (v1.24.0): "ellos/ellas/Uds.", "a él/ella/Ud.", "usted" in commands. */
export function shortPersonLabel(entry: string, tense: Tense, person: QuizPerson): string {
  return engine.shortPersonLabelFor(entry, tense, person);
}

/** The accepted forms of a cell in a deck's settings (the vos region picks the vos forms). */
export function formsOf(entry: string, cell: QuizCell, settings: Pick<QuizSettings, 'vos'>): string[] {
  const region = vosRegion(settings);
  return engine.conjugate(entry, cell.tense, cell.person, cell.number ?? 'sg', region ? { vosRegion: region } : undefined) ?? [];
}

/** The cells a deck drills of an entry: its tenses, vosotros and vos only when the deck has them. */
export function cellsOf(entry: string, settings: Pick<QuizSettings, 'tenses' | 'includeVosotros' | 'vos'>): QuizCell[] {
  const region = vosRegion(settings);
  return engine.cellsFor(entry, settings.tenses, { vosotros: settings.includeVosotros, vos: region ?? null })
    .filter((c) => (c.person !== 'vos' || !!region) && (c.person !== 'vosotros' || settings.includeVosotros));
}

// ---------------------------------------------------------------------------
// Verbs and items

const detectCache = new Map<string, DetectedVerb[]>();

/** detectVerbs, remembered per exact card list (the dashboard asks on every load). */
export function detectDeckVerbs(cards: DeckCard[]): DetectedVerb[] {
  const key = cards.map((c) => `${c.id ?? ''}\u0001${c.front}\u0001${c.back}`).join('\u0002');
  const hit = detectCache.get(key);
  if (hit) {
    detectCache.delete(key);
    detectCache.set(key, hit);
    return hit;
  }
  const found = detectVerbs(cards);
  detectCache.set(key, found);
  if (detectCache.size > 200) detectCache.delete(detectCache.keys().next().value as string);
  return found;
}

/**
 * Builds the engine's tables and runs one detection now. The first use in a
 * process takes about a second of synchronous CPU, and the server is one
 * thread: called at boot, before the port opens, so no request (and nobody
 * queued behind it) pays for it. Idempotent. Returns what it took.
 */
export function warmConjugationEngine(): { ms: number; forms: number } {
  const start = performance.now();
  const forms = warmUp();
  // Not through detectDeckVerbs: a warm-up deck has no place in its cache.
  detectVerbs([{ id: 0, front: 'tengo', back: 'I have' }]);
  return { ms: Math.round(performance.now() - start), forms };
}

/**
 * The entries a deck drills: the detected ones not excluded by default nor by
 * the teacher, then the teacher's own, once each.
 */
export function effectiveEntries(detected: DetectedVerb[], settings: Pick<QuizSettings, 'excludedEntries' | 'extraEntries'>): string[] {
  const excluded = new Set(settings.excludedEntries);
  const out = detected.filter((d) => !d.excludedByDefault && !excluded.has(d.infinitive)).map((d) => d.infinitive);
  for (const extra of settings.extraEntries) if (!out.includes(extra)) out.push(extra);
  return out;
}

export interface Item {
  key: string;
  entry: string;
  tense: Tense;
  person: QuizPerson;
  number?: GNumber;
  direction: ItemDirection;
}

export function itemKey(item: Omit<Item, 'key'>): string {
  return `${item.entry}|${item.tense}|${item.person}|${item.number ?? '-'}|${item.direction}`;
}

/** An item's cell, without its direction: `${entry}|${tense}|${person}|${number ?? '-'}`. */
export const cellKey = (item: Omit<Item, 'key'>): string => `${item.entry}|${item.tense}|${item.person}|${item.number ?? '-'}`;

export function parseItemKey(key: string): Item | null {
  const [entry, tense, person, number, direction, ...rest] = key.split('|');
  if (rest.length > 0 || !entry || !TENSE_IDS.includes(tense as Tense)) return null;
  if (direction !== 'to' && direction !== 'from') return null;
  if (number !== '-' && number !== 'sg' && number !== 'pl') return null;
  return {
    key,
    entry,
    tense: tense as Tense,
    person: person as QuizPerson,
    ...(number === '-' ? {} : { number: number as GNumber }),
    direction,
  };
}

export function directionsOf(settings: Pick<QuizSettings, 'directions'>): ItemDirection[] {
  if (settings.directions === 'toForm') return ['to'];
  if (settings.directions === 'fromForm') return ['from'];
  return ['to', 'from'];
}

/** Every item of a deck: entry × cell × direction. */
export function itemsFor(entries: string[], settings: QuizSettings): Item[] {
  const directions = directionsOf(settings);
  const out: Item[] = [];
  for (const entry of entries) {
    for (const cell of cellsOf(entry, settings)) {
      if (formsOf(entry, cell, settings).length === 0) continue;
      for (const direction of directions) {
        const item = { entry, tense: cell.tense, person: cell.person, ...(cell.number ? { number: cell.number } : {}), direction };
        out.push({ key: itemKey(item), ...item });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Level ladder

/** The rungs a "give the form" item climbs, easiest first. */
export function ladder(settings: Pick<QuizSettings, 'answerMode' | 'accentMode'>): LevelKind[] {
  const steps: LevelKind[] = [];
  if (settings.answerMode !== 'typed') steps.push('choice');
  if (settings.answerMode !== 'choice') {
    if (settings.accentMode === 'progressive') steps.push('typed-lenient', 'typed-strict');
    else if (settings.accentMode === 'forgiven') steps.push('typed-lenient');
    else steps.push('typed-strict');
  }
  return steps;
}

/**
 * The ladder of a "name the verb" item, in every answer mode: multiple choice
 * only. Its typed rungs had the student type the infinitive and tap a person,
 * which trains recalling "tener", not producing "tengo"; half of all typed
 * practice went to that (research report, "What the evidence questions" item
 * 2 and improvement 3). The choice version stays: only the ending can answer
 * it. So every typed question produces a form.
 */
export const FROM_LADDER: readonly LevelKind[] = ['choice'];

/** The rungs an item climbs: the deck's ladder for "give the form", multiple choice for "name the verb". */
export function itemLadder(settings: Pick<QuizSettings, 'answerMode' | 'accentMode'>, direction: ItemDirection): LevelKind[] {
  return direction === 'from' ? [...FROM_LADDER] : ladder(settings);
}

/** A stored level on the current ladder (the teacher may have shortened it). */
export function clampLevel(level: number, steps: readonly LevelKind[]): number {
  return Math.max(0, Math.min(steps.length - 1, Math.floor(level) || 0));
}

export interface ProgressState {
  level: number;
  mastered: boolean;
  /** The school day (YYYY-MM-DD) of a first top-rung success, not yet confirmed on a later day. */
  firstTopDay?: string | null;
  /** When a mastered item is next due (ms); a mastered item without one is due now. */
  dueAt?: number | null;
  /** The review interval last scheduled: an index into REVIEW_INTERVAL_DAYS. */
  reviewStep?: number;
}

/** Mastered on the current ladder: a longer ladder (choice → progressive) reopens the item. */
export function isMastered(state: ProgressState | undefined, steps: readonly LevelKind[]): boolean {
  return !!state?.mastered && state.level >= steps.length - 1;
}

/**
 * Whether a result moves the student up. An accent slip is forgiven while
 * accents are (typed-lenient), and a miss once they are required.
 */
export function countsCorrect(result: Grade, levelKind: LevelKind): boolean {
  if (result === 'correct') return true;
  return result === 'accent' && levelKind !== 'typed-strict';
}

/**
 * The rung move of an answer alone: right → one up (staying at the top), wrong
 * → one down. Whether that masters the item is advance's call.
 */
export function nextLevel(level: number, steps: readonly LevelKind[], counted: boolean): number {
  const current = clampLevel(level, steps);
  if (!counted) return Math.max(0, current - 1);
  return Math.min(steps.length - 1, current + 1);
}

// ---------------------------------------------------------------------------
// Mastery on two school days, and reviews

/** The school's time zone (services/schoolCalendar.ts): a school day is a date there. */
export { SCHOOL_TIME_ZONE };

/** Days until a mastered item is due again: 1, then 3, then 8 weeks, and every 8 weeks after that. */
export const REVIEW_INTERVAL_DAYS: readonly number[] = [7, 21, 56];

const DAY_MS = 24 * 60 * 60 * 1000;

// One formatter for the process: building an Intl.DateTimeFormat per call is slow, and the teacher's numbers read thousands of dates.
const schoolDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The school day of an instant, YYYY-MM-DD in America/Los_Angeles (as todayIn in services/signups.ts). */
export function schoolDay(at: Date | number): string {
  const parts = schoolDayFormat.formatToParts(typeof at === 'number' ? new Date(at) : at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const schoolClock = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Milliseconds since midnight at the school, by its wall clock. */
function sinceSchoolMidnight(at: number): number {
  const parts = schoolClock.formatToParts(new Date(at));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + (((at % 1000) + 1000) % 1000);
}

/**
 * Midnight at the school that starts the school day of `at`. A review is due for
 * the whole of its day, as the simulation's dueDay <= today: a form mastered
 * at 11:08 comes back to a round started at 11:01 a week later.
 */
export function startOfSchoolDay(at: number): number {
  const start = at - sinceSchoolMidnight(at);
  // On a day the clocks change, the hours since midnight are one off from the time elapsed: one correction lands on it.
  const off = sinceSchoolMidnight(start);
  if (off === 0) return start;
  return off > DAY_MS / 2 ? start + (DAY_MS - off) : start - off;
}

/** Whole school days from `now` to `dueAt` (0 when due today or before), counted on the calendar, not in 24-hour spans. */
export function schoolDaysUntil(dueAt: number, now: number): number {
  const day = (at: number) => Date.parse(`${schoolDay(at)}T00:00:00Z`);
  return Math.max(0, Math.round((day(dueAt) - day(now)) / DAY_MS));
}

/** A review scheduled at a step (the last step repeats): due from the start of the school day that many days on. */
function scheduleAt(step: number, now: number): { reviewStep: number; dueAt: number } {
  const reviewStep = Math.min(Math.max(0, Math.floor(step) || 0), REVIEW_INTERVAL_DAYS.length - 1);
  // From today's midnight to around noon of the day it falls on, so a clock change cannot move it a day.
  const target = startOfSchoolDay(now) + REVIEW_INTERVAL_DAYS[reviewStep] * DAY_MS + DAY_MS / 2;
  return { reviewStep, dueAt: startOfSchoolDay(target) };
}

/** Whether a mastered item is due: its day has come, or it has none (a row mastered before v1.13). */
export function isDue(state: ProgressState | undefined, steps: readonly LevelKind[], now: number): boolean {
  return isMastered(state, steps) && (state?.dueAt ?? 0) <= now;
}

/**
 * What an answer did:
 *  - up / down: a rung climbed or lost below mastery;
 *  - pending: right at the top, but mastery waits for another school day;
 *  - mastered: right at the top on a later school day (or carried over): due in a week;
 *  - reviewed: a due mastered item right again: due after the next interval;
 *  - early: a mastered item right before it was due: nothing changes;
 *  - lapse: a mastered item missed: mastery lost, a rung down, the intervals start over.
 */
export type Outcome = 'up' | 'down' | 'pending' | 'mastered' | 'reviewed' | 'early' | 'lapse';

export interface AdvanceContext {
  /** The school day of the answer (schoolDay). */
  today: string;
  now: number;
  /**
   * No progress in this deck yet, and the same item mastered at the same top
   * rung in another deck: it starts at the top, and one right answer re-masters it.
   */
  carried?: boolean;
  /** The schedule of the deck it was carried from, which it shares. */
  carriedFrom?: { reviewStep: number; dueAt: number | null } | null;
}

/**
 * An item's progress after an answer (research report improvement 2, with the
 * simulation's rules): right below the top climbs a rung; right at the top
 * masters only when the first top-rung success was on an earlier school day,
 * so a small deck cannot be "mastered" in one evening; a miss drops a rung and
 * forgets that first day, and costs a mastered item its mastery.
 */
export function advance(
  before: ProgressState | undefined,
  steps: readonly LevelKind[],
  counted: boolean,
  ctx: AdvanceContext,
): { state: ProgressState; outcome: Outcome } {
  const top = steps.length - 1;
  const fresh = !before;
  const current = clampLevel(before?.level ?? (fresh && ctx.carried ? top : 0), steps);
  const was = isMastered(before, steps);
  const step = before?.reviewStep ?? 0;
  if (!counted) {
    return {
      state: { level: nextLevel(current, steps, false), mastered: false, firstTopDay: null, dueAt: null, reviewStep: was ? 0 : step },
      outcome: was ? 'lapse' : 'down',
    };
  }
  if (current < top) {
    return { state: { level: current + 1, mastered: false, firstTopDay: null, dueAt: null, reviewStep: step }, outcome: 'up' };
  }
  if (was) {
    const dueAt = before?.dueAt ?? null;
    if (dueAt !== null && dueAt > ctx.now) {
      return { state: { level: top, mastered: true, firstTopDay: null, dueAt, reviewStep: step }, outcome: 'early' };
    }
    return { state: { level: top, mastered: true, firstTopDay: null, ...scheduleAt(step + 1, ctx.now) }, outcome: 'reviewed' };
  }
  const carried = fresh && !!ctx.carried;
  if (carried || (!!before?.firstTopDay && before.firstTopDay < ctx.today)) {
    // A carried item shares its source's schedule: a due source counts as reviewed now.
    const source = carried ? ctx.carriedFrom : null;
    const schedule = !source ? scheduleAt(0, ctx.now)
      : source.dueAt === null || source.dueAt <= ctx.now ? scheduleAt(source.reviewStep + 1, ctx.now)
        : { reviewStep: source.reviewStep, dueAt: source.dueAt };
    return { state: { level: top, mastered: true, firstTopDay: null, ...schedule }, outcome: 'mastered' };
  }
  return {
    state: { level: top, mastered: false, firstTopDay: before?.firstTopDay ?? ctx.today, dueAt: null, reviewStep: step },
    outcome: 'pending',
  };
}

/**
 * A "name the verb" item reviewed through its "give the form" sibling (the
 * simulation's refinement: a due name-the-verb item is reviewed by producing
 * the form, or four in five review slots would be name-the-verb multiple
 * choice). Right: the next interval. Wrong: back in a week, still mastered —
 * the miss was on the harder direction. Null when it is not mastered and due.
 */
export function reviewThrough(before: ProgressState | undefined, counted: boolean, now: number): ProgressState | null {
  if (!before || !isDue(before, FROM_LADDER, now)) return null;
  return { ...before, firstTopDay: null, ...scheduleAt(counted ? (before.reviewStep ?? 0) + 1 : 0, now) };
}

// ---------------------------------------------------------------------------
// Randomness

/** A seeded PRNG (mulberry32), for tests and replayable rounds. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Round selection

/** Shuffled, then dealt one entry at a time, so a verb's items do not bunch together. */
export function spreadByEntry<T extends Item>(items: readonly T[], rand: () => number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of shuffle(items, rand)) {
    // Appended in place: copying the list on every item made a round start quadratic in the deck.
    const group = groups.get(item.entry);
    if (group) group.push(item);
    else groups.set(item.entry, [item]);
  }
  const order = shuffle([...groups.values()], rand);
  const out: T[] = [];
  while (out.length < items.length) {
    for (const group of order) {
      const next = group.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

/** One deck as a round sees it: its settings, its items and the student's progress in it. */
export interface PlanDeck {
  deckId: number;
  settings: QuizSettings;
  items: readonly Item[];
  progress: ReadonlyMap<string, ProgressState>;
  /** Items with no progress here that start at the top by carry-over (startingState). */
  carried?: ReadonlySet<string>;
}

/**
 * Where an item of a round comes from: a scheduled review (a due mastered
 * item of any of the student's decks), the round deck's own open items, or
 * its mastered ones topping up a round the rest cannot fill.
 */
export type Slot = 'review' | 'own' | 'filler';

export interface PlannedItem extends Item {
  /** The deck the item belongs to: asked, graded and written back under its settings and progress. */
  deckId: number;
  slot: Slot;
  /** A due "name the verb" item this "give the form" item reviews (reviewThrough). */
  via?: string;
  /** No progress in its deck yet, mastered at the same top rung in another deck: it starts at the top. */
  carried?: boolean;
}

/** A due review: the item to ask, its deck, its due date, and the "name the verb" item it stands for. */
export interface DueEntry {
  item: Item;
  deckId: number;
  dueAt: number;
  via?: string;
}

/** The other direction of an item's cell. */
export const siblingKey = (key: string): string =>
  (key.endsWith('|from') ? `${key.slice(0, -'|from'.length)}|to` : `${key.slice(0, -'|to'.length)}|from`);

/**
 * The reviews a deck has due now. A due "name the verb" item is asked as its
 * "give the form" sibling, so reviews produce forms (reviewThrough), unless
 * that sibling is mastered too (the two share a schedule and it comes due
 * itself) or the deck does not ask for forms.
 */
export function dueEntries(deck: PlanDeck, now: number): DueEntry[] {
  const byKey = new Map(deck.items.map((i) => [i.key, i]));
  const toSteps = itemLadder(deck.settings, 'to');
  const out: DueEntry[] = [];
  for (const item of deck.items) {
    const state = deck.progress.get(item.key);
    if (!isDue(state, itemLadder(deck.settings, item.direction), now)) continue;
    const dueAt = state?.dueAt ?? 0;
    if (item.direction === 'from') {
      const to = byKey.get(siblingKey(item.key));
      if (to && isMastered(deck.progress.get(to.key), toSteps)) continue;
      if (to) {
        out.push({ item: to, deckId: deck.deckId, dueAt, via: item.key });
        continue;
      }
    }
    out.push({ item, deckId: deck.deckId, dueAt });
  }
  return out;
}

/** "N forms due": the forms (cells) of a deck due for review now. */
export function dueCount(deck: PlanDeck, now: number): number {
  return new Set(dueEntries(deck, now).map((d) => cellKey(d.item))).size;
}

/** The share of a round reserved (and capped) for reviews: a quarter, 5 of 20 (the simulation's k). */
export function reviewSlice(length: number): number {
  return Math.ceil(length / 4);
}

/** Whether an item starts at the top by carry-over (see PlannedItem.carried). */
export function isCarried(deck: PlanDeck, item: Item): boolean {
  return !deck.progress.has(item.key) && !!deck.carried?.has(item.key);
}

/** The student's row of an item in one deck. */
export interface TwinRow {
  deckId: number;
  state: ProgressState;
}

type LadderSettings = Pick<QuizSettings, 'answerMode' | 'accentMode'>;

/**
 * How far along a state is on a ladder, to pick the furthest of two: mastered,
 * then the rung, then a first top-rung day waiting for its second.
 */
function progressRank(state: ProgressState, steps: readonly LevelKind[]): number {
  return (isMastered(state, steps) ? 1000 : 0) + clampLevel(state.level, steps) * 2 + (state.firstTopDay ? 1 : 0);
}

/**
 * Where an item of a deck starts, from the student's rows of the same item key
 * in every deck (the same form keyed the same way: gustarle only meets
 * gustarle):
 *  - its own row, or the row of a deck with the very same ladder that is
 *    further along (rows from v1.12, which kept progress per deck, or rows
 *    kept apart while two ladders differed): one form, one state, and the
 *    answer writes it to both, so a right answer here never undoes it there;
 * with no row of its own:
 *  - carried: mastered in another deck whose ladder tops out at the same rung
 *    (isMastered depends on the ladder), so it starts at the top and one right
 *    answer re-masters it, sharing that deck's review schedule;
 *  - the state it has in a deck with the very same ladder (it may be half-way
 *    up in Unit 1);
 *  - else nothing (the bottom rung).
 */
export function startingState(
  deckId: number,
  settings: LadderSettings,
  direction: ItemDirection,
  rows: readonly TwinRow[],
  settingsOf: (deckId: number) => LadderSettings,
): { state?: ProgressState; carried: boolean; carriedFrom: { reviewStep: number; dueAt: number | null } | null } {
  const steps = itemLadder(settings, direction);
  const others = rows.filter((r) => r.deckId !== deckId).map((r) => ({ ...r, steps: itemLadder(settingsOf(r.deckId), direction) }));
  const own = rows.find((r) => r.deckId === deckId);
  if (own) {
    const best = others.filter((r) => sameLadder(r.steps, steps))
      .reduce((b, r) => (progressRank(r.state, steps) > progressRank(b, steps) ? r.state : b), own.state);
    return { state: best === own.state ? own.state : { ...best }, carried: false, carriedFrom: null };
  }
  const top = steps[steps.length - 1];
  const sources = others.filter((r) => isMastered(r.state, r.steps) && r.steps[r.steps.length - 1] === top)
    .sort((a, b) => (b.state.reviewStep ?? 0) - (a.state.reviewStep ?? 0) || (b.state.dueAt ?? 0) - (a.state.dueAt ?? 0));
  if (sources.length > 0) {
    const source = sources[0].state;
    return { carried: true, carriedFrom: { reviewStep: source.reviewStep ?? 0, dueAt: source.dueAt ?? null } };
  }
  const same = others.filter((r) => sameLadder(r.steps, steps)).sort((a, b) => b.state.level - a.state.level);
  return same.length > 0 ? { state: { ...same[0].state }, carried: false, carriedFrom: null } : { carried: false, carriedFrom: null };
}

/** Whether two ladders are the same rungs: only then does a level mean the same in both decks. */
export function sameLadder(a: readonly LevelKind[], b: readonly LevelKind[]): boolean {
  return a.length === b.length && a.every((rung, i) => rung === b[i]);
}

/**
 * A deck as a round sees it, from the student's rows in every deck grouped by
 * item key: its own rows, plus the starting state of each item it has none of.
 */
export function deckView(
  deckId: number,
  settings: QuizSettings,
  items: readonly Item[],
  rowsByKey: ReadonlyMap<string, readonly TwinRow[]>,
  settingsOf: (deckId: number) => LadderSettings,
): PlanDeck {
  const progress = new Map<string, ProgressState>();
  const carried = new Set<string>();
  for (const item of items) {
    const rows = rowsByKey.get(item.key);
    if (!rows) continue;
    const start = startingState(deckId, settings, item.direction, rows, settingsOf);
    if (start.state) progress.set(item.key, start.state);
    else if (start.carried) carried.add(item.key);
  }
  return { deckId, settings, items, progress, carried };
}

/** The level an item of a deck is asked at: its (starting) state's, or the top when carried over. */
export function startLevel(deck: PlanDeck, item: Item): number {
  const steps = itemLadder(deck.settings, item.direction);
  const state = deck.progress.get(item.key);
  return clampLevel(state?.level ?? (isCarried(deck, item) ? steps.length - 1 : 0), steps);
}

export interface PlanInput {
  /** The deck the student started. */
  current: PlanDeck;
  /** The student's other decks, turned on and theirs: where due reviews may come from. */
  others?: readonly PlanDeck[];
  length: number;
  today: string;
  now: number;
  rand: () => number;
}

/** An item of a deck as a round plans it (PlannedItem). */
function plannedOf(item: Item, deck: PlanDeck, slot: Slot, via?: string): PlannedItem {
  return {
    ...item,
    deckId: deck.deckId,
    slot,
    ...(via ? { via } : {}),
    ...(isCarried(deck, item) ? { carried: true } : {}),
  };
}

/**
 * A round being filled, up to `length` prompts: one direction per cell, and
 * no form shown in a "name the verb" prompt that another prompt asks for.
 * `take` adds up to `cap` of a list, verbs not yet in the round first.
 */
function roundBuilder(length: number, settingsOf: (deckId: number) => QuizSettings) {
  const chosen: PlannedItem[] = [];
  const cells = new Set<string>();
  const shown = new Set<string>();
  const asked = new Set<string>();
  // A fromForm prompt shows a form; a round may not also ask for that form in
  // a toForm prompt, or it would answer one prompt with the other. That holds
  // for the two directions of one cell, and for different cells that share a
  // form ("vivía" is yo and él of the imperfect, "vivimos" present and preterite).
  const tryAdd = (planned: PlannedItem): boolean => {
    if (chosen.length >= length) return false;
    const cell = cellKey(planned);
    if (cells.has(cell)) return false;
    const forms = formsOf(planned.entry, planned, settingsOf(planned.deckId)).map(normalizeAnswer);
    if (planned.direction === 'from') {
      if (forms.length > 0 && asked.has(forms[0])) return false;
      if (forms.length > 0) shown.add(forms[0]);
    } else {
      if (forms.some((f) => shown.has(f))) return false;
      for (const f of forms) asked.add(f);
    }
    cells.add(cell);
    chosen.push(planned);
    return true;
  };
  const took = new Set<PlannedItem>();
  // Up to `cap` of a list. Verbs not yet in the round go first, so a round
  // still covers the verbs across tiers (`spread` false keeps the list's order).
  const take = (list: readonly PlannedItem[], cap: number, spread = true) => {
    let n = 0;
    const inRound = new Set(chosen.map((c) => c.entry));
    for (const pass of spread ? [0, 1] : [1]) {
      for (const item of list) {
        if (n >= cap) return;
        if (took.has(item) || (pass === 0 && inRound.has(item.entry))) continue;
        if (tryAdd(item)) {
          took.add(item);
          inRound.add(item.entry);
          n += 1;
        }
      }
    }
  };
  return { chosen, tryAdd, take };
}

/**
 * The items of a round (research report improvement 2, ordered as the
 * simulation found necessary):
 *  1. reviews: due items of any of the student's decks, most overdue first,
 *     up to a quarter of the round, so a long break is not a round of review;
 *  2. the deck's own open items, in the slots B left:
 *     a. second-day checks (right at the top on an earlier day, or carried
 *        over), up to ⌈B/3⌉;
 *     b. "give the form" multiple choice for forms not yet asked, up to ⌈B/2⌉;
 *     c. other multiple choice, up to ⌈B/3⌉ once any item is at a typed rung;
 *     d. typed items, lowest rung first;
 *     e. the rest of a–c, then items already right at the top today, which
 *        cannot progress until another day.
 *     With "name the verb" at multiple choice for good, "lowest rung first"
 *     would fill two thirds of every round with it and put off typing for weeks;
 *  3. more due reviews, when the deck cannot fill the round;
 *  4. the deck's mastered items, as before.
 * One direction per cell, and no form shown in a "name the verb" prompt that
 * another prompt asks for, across decks too. When the deck has nothing open,
 * the round is `review`.
 */
export function planRound(input: PlanInput): { items: PlannedItem[]; review: boolean } {
  const { current, length, today, now, rand } = input;
  const decks = [current, ...(input.others ?? []).filter((d) => d.deckId !== current.deckId)];
  const deckOf = new Map(decks.map((d) => [d.deckId, d]));
  const { chosen, tryAdd, take } = roundBuilder(length, (id) => deckOf.get(id)?.settings ?? current.settings);

  // 1. The reserved review slice.
  const due = shuffle(decks.flatMap((d) => dueEntries(d, now)), rand).sort((a, b) => a.dueAt - b.dueAt);
  const reviews = due.map((d) => plannedOf(d.item, deckOf.get(d.deckId) as PlanDeck, 'review', d.via));
  let taken = 0;
  for (const r of reviews) {
    if (taken >= reviewSlice(length)) break;
    if (tryAdd(r)) taken += 1;
  }

  // 2. The deck's own open items.
  const open: PlannedItem[] = [];
  const done: PlannedItem[] = [];
  for (const item of current.items) {
    const mastered = isMastered(current.progress.get(item.key), itemLadder(current.settings, item.direction));
    (mastered ? done : open).push(plannedOf(item, current, mastered ? 'filler' : 'own'));
  }
  const room = length - chosen.length;
  const started = new Set([...current.progress.keys()].map((key) => key.slice(0, key.lastIndexOf('|'))));
  const checks: PlannedItem[] = [];
  const fresh: PlannedItem[] = [];
  const choice: PlannedItem[] = [];
  const typed: PlannedItem[] = [];
  const later: PlannedItem[] = [];
  const levelOf = new Map<PlannedItem, number>();
  for (const item of open) {
    const steps = itemLadder(current.settings, item.direction);
    const top = steps.length - 1;
    const row = current.progress.get(item.key);
    const level = clampLevel(row?.level ?? (item.carried ? top : 0), steps);
    levelOf.set(item, level);
    if (row && level === top && row.firstTopDay === today) later.push(item);
    else if (item.carried || (row && level === top && !!row.firstTopDay && row.firstTopDay < today)) checks.push(item);
    else if (steps[level] === 'choice') (item.direction === 'to' && !started.has(cellKey(item)) ? fresh : choice).push(item);
    else typed.push(item);
  }
  const tiers = {
    checks: spreadByEntry(checks, rand),
    fresh: spreadByEntry(fresh, rand),
    choice: spreadByEntry(choice, rand),
    typed: byRung(typed, levelOf, rand),
    later: spreadByEntry(later, rand),
  };
  take(tiers.checks, Math.ceil(room / 3));
  take(tiers.fresh, Math.ceil(room / 2));
  take(tiers.choice, typed.length > 0 ? Math.ceil(room / 3) : Infinity);
  take(tiers.typed, Infinity, false);
  take(tiers.checks, Infinity);
  take(tiers.fresh, Infinity);
  take(tiers.choice, Infinity);
  take(tiers.later, Infinity);

  // 3. More reviews, when the deck cannot fill the round (a small deck).
  for (const r of reviews) tryAdd(r);
  // 4. The deck's mastered items.
  for (const item of spreadByEntry(done, rand)) tryAdd(item);
  return { items: spreadByEntry(chosen, rand), review: open.length === 0 && chosen.length > 0 };
}

/** Items lowest rung first, each rung's spread across its verbs. */
function byRung(items: readonly PlannedItem[], levelOf: ReadonlyMap<PlannedItem, number>, rand: () => number): PlannedItem[] {
  const byLevel = new Map<number, PlannedItem[]>();
  for (const item of items) {
    const level = levelOf.get(item) ?? 0;
    const list = byLevel.get(level);
    if (list) list.push(item);
    else byLevel.set(level, [item]);
  }
  return [...byLevel.keys()].sort((a, b) => a - b).flatMap((level) => spreadByEntry(byLevel.get(level) ?? [], rand));
}

/** A "Study all" conjugation round's length (v1.18.0): 20 questions, whatever each deck's own round length. */
export const STUDY_ALL_LENGTH = 20;

export interface PlanAllInput {
  /**
   * Every quiz the student may play now, with its items and the student's
   * progress (deckView), newest deck first: new forms are taken in this order.
   */
  decks: readonly PlanDeck[];
  length: number;
  today: string;
  now: number;
  rand: () => number;
}

/**
 * The items of a "Study all" round (v1.18.0): forms of every quiz the student
 * may play, in this order:
 *  1. every due review, of any deck, most overdue first (no quarter cap here:
 *     due forms come first);
 *  2. forms in progress (asked before, not mastered): second-day checks and
 *     forms carried over at the top first (one right answer masters them),
 *     then the rest lowest rung first;
 *  3. new forms (never asked), newest deck first, each deck's new "give the
 *     form" questions before its "name the verb" ones;
 *  4. only to fill a round the rest cannot: forms already right at the top
 *     today (they cannot move until another day), then mastered forms.
 * Each item keeps its own deck: it is asked, graded and written back under
 * that deck's settings and progress, as a review is in a deck's round. The
 * same form in two decks is asked once. One direction per cell, and no form
 * shown in a "name the verb" prompt that another prompt asks for (planRound).
 * The round is `review` when no deck has anything open.
 */
export function planAllRound(input: PlanAllInput): { items: PlannedItem[]; review: boolean } {
  const { decks, length, today, now, rand } = input;
  if (decks.length === 0) return { items: [], review: false };
  const deckOf = new Map(decks.map((d) => [d.deckId, d]));
  const { chosen, tryAdd, take } = roundBuilder(length, (id) => deckOf.get(id)?.settings ?? decks[0].settings);

  // 1. Due reviews, most overdue first.
  const due = shuffle(decks.flatMap((d) => dueEntries(d, now)), rand).sort((a, b) => a.dueAt - b.dueAt);
  for (const d of due) tryAdd(plannedOf(d.item, deckOf.get(d.deckId) as PlanDeck, 'review', d.via));

  const checks: PlannedItem[] = [];
  const progressing: PlannedItem[] = [];
  const later: PlannedItem[] = [];
  const done: PlannedItem[] = [];
  const levelOf = new Map<PlannedItem, number>();
  let open = 0;
  // 3. New forms, deck by deck, newest first: "give the form" of cells not yet started, then the rest.
  const fresh: PlannedItem[][] = [];
  for (const deck of decks) {
    const started = new Set([...deck.progress.keys()].map((key) => key.slice(0, key.lastIndexOf('|'))));
    const freshTo: PlannedItem[] = [];
    const freshOther: PlannedItem[] = [];
    for (const item of deck.items) {
      const steps = itemLadder(deck.settings, item.direction);
      const row = deck.progress.get(item.key);
      if (isMastered(row, steps)) {
        done.push(plannedOf(item, deck, 'filler'));
        continue;
      }
      open += 1;
      const planned = plannedOf(item, deck, 'own');
      const top = steps.length - 1;
      const level = clampLevel(row?.level ?? (planned.carried ? top : 0), steps);
      levelOf.set(planned, level);
      if (row && level === top && row.firstTopDay === today) later.push(planned);
      else if (planned.carried || (row && level === top && !!row.firstTopDay && row.firstTopDay < today)) checks.push(planned);
      else if (row) progressing.push(planned);
      else (item.direction === 'to' && !started.has(cellKey(item)) ? freshTo : freshOther).push(planned);
    }
    fresh.push(spreadByEntry(freshTo, rand), spreadByEntry(freshOther, rand));
  }

  // 2. In progress: checks, then lowest rung first.
  take(spreadByEntry(checks, rand), Infinity);
  take(byRung(progressing, levelOf, rand), Infinity, false);
  for (const list of fresh) take(list, Infinity);
  // 4. Filling up.
  take(spreadByEntry(later, rand), Infinity);
  take(spreadByEntry(done, rand), Infinity);
  return { items: spreadByEntry(chosen, rand), review: open === 0 && chosen.length > 0 };
}

// ---------------------------------------------------------------------------
// Rounds and prompts

/** What a deck's items of a round are built and graded with. */
export interface DeckSnapshot {
  settings: QuizSettings;
  entries: string[];
  /** The deck's "give the form" ladder (a "name the verb" item's is FROM_LADDER). */
  steps: LevelKind[];
}

/** What a round was built with, stored with it: its deck's snapshot, and those of the decks its reviews come from. */
export interface RoundSnapshot extends DeckSnapshot {
  /** Whether the round is all review (everything was mastered when it started). */
  review?: boolean;
  /**
   * The other decks the round reviews items of, by deck id, with their names.
   * A "Study all" round (v1.18.0) lists every deck it asks forms of, its lead
   * (the top-level snapshot's deck) included when it has some.
   */
  decks?: Record<string, DeckSnapshot & { name: string }>;
  /** "Study all": the decks of `decks`, newest first (object keys would come back in id order). */
  order?: number[];
  /**
   * The subjects the student was shown for each cell of the round before it
   * started (v1.24.0): cellKey → subject → when last shown (ms), read once
   * at round start (subjectsSeenFor), so buildPrompt stays pure.
   */
  subjectsSeen?: Record<string, Record<string, number>>;
  /**
   * The sentences the student was shown for each cell before the round (v1.25.0): cellKey → their ref keys
   * (refKey), most recent first, at most SEEN_PER_CELL, read once at round start (sentencesSeenFor).
   */
  sentencesSeen?: Record<string, string[]>;
}

export interface Reading {
  entry: string;
  tense: Tense;
  person: QuizPerson;
  number?: GNumber;
}

/** A prompt as the server keeps it, answers included. Never sent to the client. */
export interface BuiltPrompt {
  level: number;
  levelKind: LevelKind;
  seed: number;
  /**
   * The prompt's id on the page: random, since any id derived from the item
   * (whose key names the answer of a fromForm prompt) could be reversed.
   */
  token: string;
  /** The cell's accepted forms. */
  accepted: string[];
  /** fromForm: the form shown. */
  form?: string;
  cue?: string | null;
  options?: string[];
  /** The options that are right (fromForm: every one consistent with the form). */
  correctOptions?: string[];
  askTense: boolean;
  /**
   * The subject shown for the item's own person (v1.24.0): the heading of a
   * "give the form" prompt ("ustedes"), the person of the right option of a
   * "name the verb" one. Absent for impersonal entries, and in prompts built
   * before v1.24.0 (they show the whole group: "ellos / ellas / ustedes").
   */
  subject?: string;
  /** fromForm (v1.24.0): the reading each option names, in the order of `options`. */
  optionReadings?: Reading[];
  /** fromForm (v1.24.0): the verb every option shares, named in the question instead of in each option. */
  optionsVerb?: string;
  /**
   * toForm (v1.25.0): the sentence the prompt shows instead of a person label ("Mis primos ___ (vivir) en
   * Lima."), when the deck has sentences on and the cell has one. Its answer is `accepted`; its English goes
   * to the page only with the answer's response. A prompt with a sentence names no `subject`.
   */
  sentence?: PromptSentence;
  /** Under the deck's holdback (v1.25.0): the verb's half, and whether this prompt is a probe. */
  holdback?: { arm: HoldbackArm; probe: boolean };
}

export interface QueueEntry extends Item {
  /** Put back at the end after a miss; a retry is not put back again. */
  retry?: boolean;
  built?: BuiltPrompt;
  /**
   * The deck the item belongs to, when it is not the round's (a review from an
   * earlier unit). Set on every entry of a "Study all" round.
   */
  deckId?: number;
  /** A scheduled review: the item, or the "name the verb" item in `via`, was mastered and due. */
  review?: boolean;
  /** The due "name the verb" item this "give the form" prompt reviews. */
  via?: string;
  /** Started at the top by carry-over (PlannedItem.carried), if its deck still has no progress on it. */
  carried?: boolean;
}

/** The snapshot an entry of a round is built and graded with: its own deck's. */
export function entrySnapshot(snapshot: RoundSnapshot, entry: { deckId?: number }): DeckSnapshot {
  if (entry.deckId === undefined) return snapshot;
  return snapshot.decks?.[String(entry.deckId)] ?? snapshot;
}

export interface PersonOption {
  id: QuizPerson;
  label: string;
}

/** A prompt as the student sees it: nothing here gives the answer away. */
export interface ClientPrompt {
  index: number;
  total: number;
  /** Opaque: a random id of this prompt, which says nothing about the item. */
  itemKey: string;
  kind: 'choice' | 'typed';
  level: LevelKind;
  strictAccents: boolean;
  direction: 'toForm' | 'fromForm';
  retry: boolean;
  /**
   * toForm: the entry ("tener", "gustarle"); an impersonal entry by its
   * infinitive ("haber", not "haber (hay)", which is the present-tense answer).
   */
  entryLabel: string | null;
  /** toForm: 'impersonal' for impersonal entries (no person to conjugate for), else null. */
  entryHint: 'impersonal' | null;
  /** toForm, and fromForm when the deck drills one tense. */
  tense: Tense | null;
  tenseLabel: string | null;
  /**
   * toForm: who, one real subject (v1.24.0: "ustedes", "ella", "a ellas";
   * "yo", "a mí"); the whole group ("ellos / ellas / ustedes") in a prompt
   * built before v1.24.0; null for impersonal entries.
   */
  personLabel: string | null;
  /** toForm: the person id of the cell ("ellos" for "ustedes"); null for impersonal entries and fromForm. */
  personId: QuizPerson | null;
  /** toForm dative: the thing liked ("el chocolate", "los perros"). */
  cue: string | null;
  /**
   * toForm (v1.25.0): the sentence with its blank, shown instead of the person label: the subject decides
   * the person, so `personId` is null, and a v1.25.0 page shows neither `personLabel` nor `cue`. They are
   * still sent, for a page loaded before v1.25.0 that knows no sentence: `personLabel` is then the sentence's
   * subject as written ("mis primos"), `cue` the label prompt's. Null for a label prompt.
   */
  sentence: ClientSentence | null;
  /** fromForm: the form to identify. */
  form: string | null;
  /** fromForm (v1.24.0): the verb all the options share, named in the question ("Which form of tener is this?"). */
  optionsVerb: string | null;
  /** choice: the options, shuffled. */
  options: string[] | null;
  /** fromForm: the tense must be named too. */
  askTense: boolean;
  /** fromForm typed: a person chip must be picked. */
  askPerson: boolean;
  personOptions: PersonOption[] | null;
  tenseOptions: { id: Tense; label: string }[] | null;
  /** A form brought back for review: mastered earlier, and due. */
  scheduledReview: boolean;
  /**
   * The deck a review comes from, when it is not the round's ("Unit 1"). In a
   * "Study all" round, every prompt's own deck.
   */
  fromDeck: { deckId: number; deckName: string } | null;
}

export function snapshotOf(settings: QuizSettings, entries: string[]): RoundSnapshot {
  return { settings, entries: [...entries], steps: ladder(settings) };
}

/** The accent strictness of multiple-choice distractors: accent-only differences are fair game only when accents are required. */
function strictFor(levelKind: LevelKind, settings: QuizSettings): boolean {
  if (levelKind === 'choice') return settings.accentMode === 'required';
  return levelKind === 'typed-strict';
}

const readingsCache = new Map<string, Map<string, Reading[]>>();

/** Every form of every cell the round drills → the readings it has among them. */
export function deckReadings(snapshot: DeckSnapshot): Map<string, Reading[]> {
  const { settings } = snapshot;
  const key = JSON.stringify([snapshot.entries, settings.tenses, settings.includeVosotros, settings.vos]);
  const hit = readingsCache.get(key);
  if (hit) return hit;
  const map = new Map<string, Reading[]>();
  for (const entry of snapshot.entries) {
    for (const cell of cellsOf(entry, settings)) {
      for (const form of formsOf(entry, cell, settings)) {
        const norm = normalizeAnswer(form);
        const reading: Reading = { entry, tense: cell.tense, person: cell.person, ...(cell.number ? { number: cell.number } : {}) };
        map.set(norm, [...(map.get(norm) ?? []), reading]);
      }
    }
  }
  readingsCache.set(key, map);
  if (readingsCache.size > 100) readingsCache.delete(readingsCache.keys().next().value as string);
  return map;
}

/**
 * The name of an entry the student sees in a prompt or a fromForm answer:
 * impersonal entries by their infinitive, since "haber (hay)" would give the
 * present-tense form away.
 */
export function promptEntryName(entry: string): string {
  const parsed = parseEntry(entry);
  if (parsed?.kind === 'impersonal') return parsed.base;
  return entryLabel(entry);
}

/** "tener · yo", "gustarle · a mí", "haber", plus " · pretérito" when the tense is asked. */
export function readingLabel(reading: Reading, askTense: boolean): string {
  const parts = [promptEntryName(reading.entry)];
  const person = personLabel(reading.entry, reading.tense, reading.person);
  if (person) parts.push(person);
  if (askTense) parts.push(tenseLabel(reading.tense));
  return parts.join(' · ');
}

/** What a student may type for an entry: its id, and the bare infinitive of a dative or impersonal one (gustar, haber). */
export function acceptedEntryNames(entry: string): string[] {
  const parsed = parseEntry(entry);
  const names = [entry];
  if (parsed && (parsed.kind === 'dative' || parsed.kind === 'impersonal')) names.push(parsed.base);
  return [...new Set(names)];
}

/** The persons a fromForm answer picks from, for an entry kind; none for impersonal entries. */
export function personOptions(kind: VerbKind, settings: Pick<QuizSettings, 'includeVosotros' | 'vos'>): PersonOption[] {
  if (kind === 'impersonal') return [];
  const persons: QuizPerson[] = ['yo', 'tu'];
  if (settings.vos !== 'none') persons.push('vos');
  persons.push('el', 'nosotros');
  if (settings.includeVosotros) persons.push('vosotros');
  persons.push('ellos');
  const sample = kind === 'dative' ? 'gustarle' : 'hablar';
  return persons.map((id) => ({ id, label: personLabel(sample, 'present', id) }));
}

/** The item's own reading. */
const readingOf = (item: Item): Reading => ({
  entry: item.entry, tense: item.tense, person: item.person, ...(item.number ? { number: item.number } : {}),
});

/** What an option shows of a reading: entry, person ('' for none), tense ('' when not asked). */
function shownFields(reading: Reading, askTense: boolean): string[] {
  return [promptEntryName(reading.entry), personLabel(reading.entry, reading.tense, reading.person), askTense ? tenseLabel(reading.tense) : ''];
}

/** Whether values[index] is the only largest or the only smallest of two or more different values. */
function standsOut(values: readonly number[], index: number): boolean {
  if (new Set(values).size < 2) return false;
  const v = values[index];
  const max = Math.max(...values);
  const min = Math.min(...values);
  return (v === max || v === min) && values.filter((x) => x === v).length === 1;
}

/**
 * How a set of options (the right one first) could give the right one away:
 * 'tell' when it is the only option sharing the most (or the fewest) shown
 * fields with the others, or its person or tense is the only most (or least)
 * frequent one; 'balanced' when every option shares as many fields and every
 * shown value is as frequent as the others of its field; else 'fair'.
 */
function optionFairness(fields: readonly string[][]): 'balanced' | 'fair' | 'tell' {
  const scores = fields.map((a, i) => fields.reduce((sum, b, j) => (
    i === j ? sum : sum + a.filter((value, f) => value !== '' && value === b[f]).length
  ), 0));
  let balanced = new Set(scores).size === 1;
  if (standsOut(scores, 0)) return 'tell';
  // Whether an option names a person at all is compared too: an impersonal
  // verb ("haber") may not be the only option without one, nor a personal
  // verb the only one with one.
  const personless = fields.map((option) => option[1] === '');
  if (fields.length > 2 && personless.filter((p) => p === personless[0]).length === 1) return 'tell';
  for (let f = 0; f < fields[0].length; f++) {
    const counts = new Map<string, number>();
    for (const option of fields) counts.set(option[f], (counts.get(option[f]) ?? 0) + 1);
    if (new Set(counts.values()).size > 1) balanced = false;
    if (fields[0][f] === '') continue;
    const values = [...counts.keys()];
    if (standsOut(values.map((v) => counts.get(v) ?? 0), values.indexOf(fields[0][f]))) return 'tell';
  }
  return balanced ? 'balanced' : 'fair';
}

/** Search budget of the fallback: triples of wrong options tried per pass before settling for the closest ones. */
const OPTION_SEARCH_LIMIT = 20_000;

interface OptionPool {
  /** Every reading an option may name, once per label (a dative's numbers share one). */
  all: Reading[];
  label: Map<Reading, string>;
  fields: Map<Reading, string[]>;
  byCell: Map<string, Reading>;
}

const optionPoolCache = new Map<string, OptionPool>();

/** The readings fromForm options are drawn from: every tense when the tense is asked, else the one tense. */
function optionPool(snapshot: DeckSnapshot, askTense: boolean, tense: Tense): OptionPool {
  const { settings } = snapshot;
  const key = JSON.stringify([snapshot.entries, settings.tenses, settings.includeVosotros, settings.vos, askTense ? null : tense]);
  const hit = optionPoolCache.get(key);
  if (hit) return hit;
  const pool: OptionPool = { all: [], label: new Map(), fields: new Map(), byCell: new Map() };
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    for (const cell of cellsOf(entry, settings)) {
      if (!askTense && cell.tense !== tense) continue;
      const reading: Reading = { entry, tense: cell.tense, person: cell.person };
      const label = readingLabel(reading, askTense);
      if (seen.has(label)) continue;
      seen.add(label);
      pool.all.push(reading);
      pool.label.set(reading, label);
      pool.fields.set(reading, shownFields(reading, askTense));
      pool.byCell.set(`${entry}|${cell.tense}|${cell.person}`, reading);
    }
  }
  optionPoolCache.set(key, pool);
  if (optionPoolCache.size > 100) optionPoolCache.delete(optionPoolCache.keys().next().value as string);
  return pool;
}

/**
 * The options of a fromForm multiple-choice prompt: the item's own reading and
 * up to three that do not fit the form, none of them standing out.
 *
 * When the tense is asked the wrong ones are a grid around the right one,
 * {P, P'} × {T, T'}: (P, T'), (P', T), (P', T') — P' another person of the same
 * verb, T' another tense of the deck — so every person and tense shown appears
 * twice and each option shares as much with the others as the right one does;
 * an impersonal verb has no person, so its wrong options are its other tenses.
 * When the tense is not asked, the same verb in three other persons. When
 * those do not exist or are right readings ("vivimos" is present and
 * preterite), a search takes the closest set in which the right option does
 * not stand out, and failing that the closest wrong ones.
 */
function fromFormOptions(item: Item, form: string, snapshot: DeckSnapshot, askTense: boolean, rand: () => number): OptionSet {
  const pool = optionPool(snapshot, askTense, item.tense);
  const own = readingOf(item);
  const correct = readingLabel(own, askTense);
  const ownFields = shownFields(own, askTense);
  const right = new Set((deckReadings(snapshot).get(normalizeAnswer(form)) ?? []).map((r) => readingLabel(r, askTense)));
  right.add(correct);
  const labelOf = (r: Reading) => pool.label.get(r) ?? readingLabel(r, askTense);
  const usable = (r: Reading | undefined): r is Reading => !!r && !right.has(labelOf(r));
  const at = (tense: Tense, person: QuizPerson) => pool.byCell.get(`${item.entry}|${tense}|${person}`);
  const fairness = (wrong: Reading[]) => optionFairness([ownFields, ...wrong.map((r) => pool.fields.get(r) ?? shownFields(r, askTense))]);
  const done = (wrong: Reading[]): OptionSet => ({
    options: shuffle([own, ...wrong].map((reading) => ({ reading, person: true })), rand),
    correct: own,
  });
  const mine = pool.all.filter((r) => r.entry === item.entry);

  const persons = shuffle([...new Set(mine.filter((r) => r.person !== item.person).map((r) => r.person))], rand);
  if (askTense) {
    const tenses = snapshot.settings.tenses.filter((t) => t !== item.tense);
    for (const p of persons) {
      for (const t of shuffle(tenses, rand)) {
        const grid = [at(t, item.person), at(item.tense, p), at(t, p)];
        if (grid.every(usable) && fairness(grid) === 'balanced') return done(grid);
      }
    }
  } else {
    const others = persons.map((p) => at(item.tense, p)).filter(usable);
    if (others.length >= 3) return done(others.slice(0, 3));
  }

  // The search: the same verb first, then other verbs too; balanced before
  // merely fair, and sets that test the person and the tense (some wrong
  // option names another one) before those that do not.
  const same = shuffle(mine.filter((r) => usable(r)), rand);
  const rest = shuffle(pool.all.filter((r) => r.entry !== item.entry && usable(r)), rand).slice(0, 18);
  const fieldOf = (r: Reading, f: number) => (pool.fields.get(r) ?? shownFields(r, askTense))[f];
  const tests = (wrong: Reading[]) => [1, 2].every((f) => ownFields[f] === '' || wrong.some((r) => fieldOf(r, f) !== ownFields[f]));
  const search = (candidates: Reading[], want: 'balanced' | 'fair', varied: boolean): Reading[] | null => {
    let budget = OPTION_SEARCH_LIMIT;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          if (--budget < 0) return null;
          const wrong = [candidates[i], candidates[j], candidates[k]];
          if (varied && !tests(wrong)) continue;
          const found = fairness(wrong);
          if (found === 'balanced' || (want === 'fair' && found === 'fair')) return wrong;
        }
      }
    }
    return null;
  };
  const wider = [...same, ...rest];
  const found = search(same, 'balanced', true) ?? search(same, 'fair', true)
    ?? search(wider, 'balanced', true) ?? search(wider, 'fair', true)
    ?? search(same, 'fair', false) ?? search(wider, 'fair', false);
  // Nothing fair: the closest wrong ones (the same verb, then any).
  return done(found ?? [...same, ...rest].slice(0, 3));
}

/**
 * The options of a fromForm multiple-choice prompt for an impersonal verb
 * (hay, llueve, nieva, hace), which names no person: wrong options that name
 * none either, or the right one would be the only option without a person.
 * First the verb in the deck's other tenses and the deck's other impersonal
 * verbs; when there are too few, other verbs of the deck named by their
 * infinitive alone ("ser", "tener · pretérito": "hay" is no form of them).
 * Balanced sets first, then fair ones; a set that asks for the tense has a
 * wrong option in another tense.
 */
function impersonalOptions(item: Item, form: string, snapshot: DeckSnapshot, askTense: boolean, rand: () => number): OptionSet {
  const pool = optionPool(snapshot, askTense, item.tense);
  const own = readingOf(item);
  const correct = readingLabel(own, askTense);
  const rightReadings = deckReadings(snapshot).get(normalizeAnswer(form)) ?? [own];
  interface Opt { label: string; fields: string[]; spec: OptionSpec }
  const seen = new Set([correct, ...rightReadings.map((r) => readingLabel(r, askTense))]);
  const opt = (entry: string, tense: Tense): Opt | null => {
    const name = promptEntryName(entry);
    const label = [name, ...(askTense ? [tenseLabel(tense)] : [])].join(' · ');
    if (seen.has(label)) return null;
    // A verb the form is a form of (in that tense, when the tense is asked) would be a right answer.
    if (rightReadings.some((r) => promptEntryName(r.entry) === name && (!askTense || r.tense === tense))) return null;
    seen.add(label);
    // A personal verb is named by its infinitive alone: no person (optionReading reads it as el).
    return { label, fields: [name, '', askTense ? tenseLabel(tense) : ''], spec: { reading: { entry, tense, person: 'el' }, person: false } };
  };
  const tensesOf = (t: Tense) => (askTense ? snapshot.settings.tenses : [t]);
  const impersonal = pool.all.filter((r) => entryKind(r.entry) === 'impersonal');
  const mine = shuffle(impersonal.filter((r) => r.entry === item.entry), rand);
  const others = shuffle(impersonal.filter((r) => r.entry !== item.entry), rand);
  const real = [...mine, ...others].map((r) => opt(r.entry, r.tense)).filter((o): o is Opt => !!o);
  // Six other verbs at most, each in every tense the options name, so a balanced grid can be found.
  const personalEntries = shuffle(snapshot.entries.filter((e) => entryKind(e) !== 'impersonal'), rand).slice(0, 6);
  const named = personalEntries.flatMap((e) => shuffle(tensesOf(item.tense), rand).map((t) => opt(e, t)))
    .filter((o): o is Opt => !!o);
  const ownFields = [promptEntryName(item.entry), '', askTense ? tenseLabel(item.tense) : ''];
  const tests = (wrong: Opt[]) => !askTense || wrong.some((o) => o.fields[2] !== ownFields[2]);
  const search = (candidates: Opt[], want: 'balanced' | 'fair'): Opt[] | null => {
    let budget = OPTION_SEARCH_LIMIT;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          if (--budget < 0) return null;
          const wrong = [candidates[i], candidates[j], candidates[k]];
          if (!tests(wrong)) continue;
          const found = optionFairness([ownFields, ...wrong.map((o) => o.fields)]);
          if (found === 'balanced' || (want === 'fair' && found === 'fair')) return wrong;
        }
      }
    }
    return null;
  };
  const all = [...real, ...named];
  const wrong = search(real, 'balanced') ?? search(all, 'balanced') ?? search(real, 'fair') ?? search(all, 'fair') ?? all.slice(0, 3);
  return { options: shuffle([{ reading: own, person: false }, ...wrong.map((o) => o.spec)], rand), correct: own };
}

/** One option of a "name the verb" prompt: the reading it names, and whether it names a person (an impersonal verb's do not). */
interface OptionSpec {
  reading: Reading;
  person: boolean;
}

/** The options of a "name the verb" prompt before they are worded, shuffled; `correct` is the item's own reading. */
interface OptionSet {
  options: OptionSpec[];
  correct: Reading;
}

/**
 * The subject a prompt names for the item's own person (v1.24.0): of the
 * subjects that take turns for the cell, the one the student has seen least
 * recently, the seed breaking ties. `seen` holds when each was last shown
 * before the round (ms), `shown` the ones shown in this round, oldest first,
 * which are more recent than any of those. Undefined for none (impersonal).
 */
export function pickSubject(
  subjects: readonly string[],
  seen: Readonly<Record<string, number>> | undefined,
  shown: readonly string[],
  seed: number,
): string | undefined {
  if (subjects.length <= 1) return subjects[0];
  const rank = (subject: string): number => {
    const i = shown.lastIndexOf(subject);
    if (i >= 0) return Number.MAX_SAFE_INTEGER - shown.length + i;
    return seen?.[subject] ?? -1;
  };
  // Ties go to the first in a seeded order, so a student new to a cell still meets all of them.
  const order = shuffle(subjects, seededRandom(seed ^ 0x5bd1e995));
  return order.reduce((best, subject) => (rank(subject) < rank(best) ? subject : best), order[0]);
}

/** What a prompt's subject depends on within its round (buildPrompt). */
export interface SubjectTurns {
  /** The subjects shown earlier in the round for the item's cell, oldest first. */
  shown?: readonly string[];
  /** A retry: the subject the missed prompt showed, asked again (the miss was with that subject). */
  again?: string;
  /** The sentences (refs) shown earlier in the round for the item's cell, oldest first (v1.25.0). */
  sentencesShown?: readonly string[];
  /** A retry (v1.25.0): what the missed prompt showed, a sentence or a label, and its holdback. */
  retryOf?: { sentence?: PromptSentence; holdback?: BuiltPrompt['holdback'] };
  /** The sentence to show, if any (v1.25.0): the router's pool for the cell, by the deck's mode and holdback. */
  sentence?: SentenceTurn;
}

/** What a prompt's sentence is drawn from (v1.25.0): the router reads the pool, buildPrompt picks. */
export interface SentenceTurn {
  /** The cell's sentences the student may be shown now; empty for the label. */
  pool: readonly PoolSentence[];
  /** Ref keys (refKey), most recent first: this round's first, then those seen before it. */
  recent: readonly string[];
  /** A retry: the sentence missed (another one of the same subject is asked, when there is one). */
  again?: PromptSentence;
  holdback: { arm: HoldbackArm; probe: boolean } | null;
}

/**
 * The round's own turns for an item about to be built at `position`: the
 * subjects shown before it for its cell, and for a retry the subject of the
 * prompt it retries.
 */
export function turnsInRound(queue: readonly QueueEntry[], position: number, item: Item & { retry?: boolean }): SubjectTurns {
  const cell = cellKey(item);
  const before = queue.slice(0, position);
  const shown = before.filter((e) => cellKey(e) === cell && typeof e.built?.subject === 'string').map((e) => e.built?.subject as string);
  const missed = item.retry ? [...before].reverse().find((e) => e.key === item.key && !e.retry && typeof e.built?.subject === 'string') : undefined;
  const sentencesShown = before.filter((e) => cellKey(e) === cell && e.built?.sentence).map((e) => e.built?.sentence?.ref as string);
  const original = item.retry ? [...before].reverse().find((e) => e.key === item.key && !e.retry && e.built) : undefined;
  return {
    shown,
    ...(missed?.built?.subject ? { again: missed.built.subject } : {}),
    ...(sentencesShown.length > 0 ? { sentencesShown } : {}),
    ...(original?.built ? {
      retryOf: {
        ...(original.built.sentence ? { sentence: original.built.sentence } : {}),
        ...(original.built.holdback ? { holdback: original.built.holdback } : {}),
      },
    } : {}),
  };
}

/**
 * Words the options of a "name the verb" prompt (v1.24.0): each names one
 * subject for its person (the item's own person `subject`; another person a
 * seeded one, the same for every option of that person, so no option stands
 * out), and the tense only when it is asked. When every option is the same
 * verb, the verb moves into the question (`optionsVerb`): every option named
 * it, so that gives nothing away.
 */
function wordOptions(set: OptionSet, item: Item, subject: string | undefined, askTense: boolean, seed: number) {
  const srand = seededRandom(seed ^ 0x27d4eb2f);
  const ownSubjects = subjectsOf(item.entry, item.tense, item.person);
  const ownIndex = subject === undefined ? 0 : Math.max(0, ownSubjects.indexOf(subject));
  const pickOf = new Map<QuizPerson, number>([[item.person, ownIndex]]);
  const subjectFor = (r: Reading): string => {
    const subjects = subjectsOf(r.entry, r.tense, r.person);
    if (subjects.length === 0) return '';
    if (r.entry === item.entry && r.tense === item.tense && r.person === item.person && subject !== undefined) return subject;
    let index = pickOf.get(r.person);
    if (index === undefined) {
      index = Math.floor(srand() * 6);
      pickOf.set(r.person, index);
    }
    return subjects[index % subjects.length];
  };
  const subjects = set.options.map((o) => (o.person ? subjectFor(o.reading) : ''));
  const word = (withVerb: boolean) => set.options.map((o, i) => [
    withVerb ? promptEntryName(o.reading.entry) : '',
    subjects[i],
    askTense ? tenseLabel(o.reading.tense) : '',
  ].filter(Boolean).join(' · '));
  let sameVerb = new Set(set.options.map((o) => promptEntryName(o.reading.entry))).size === 1;
  let options = word(!sameVerb);
  // Without the verb, every option must still say something, and something different.
  if (sameVerb && (options.some((o) => o === '') || new Set(options).size < options.length)) {
    sameVerb = false;
    options = word(true);
  }
  const at = set.options.findIndex((o) => o.reading === set.correct);
  return {
    options,
    correctOptions: [options[at]],
    optionReadings: set.options.map((o) => ({ ...o.reading })),
    ...(sameVerb ? { optionsVerb: promptEntryName(set.correct.entry) } : {}),
  };
}

/**
 * Builds the prompt of a queue entry at a level: the server's copy, answers
 * included, under the settings of the entry's own deck.
 */
export function buildPrompt(
  item: Item & { deckId?: number },
  level: number,
  round: RoundSnapshot,
  rand: () => number,
  /** The round's own turns for the item's cell (turnsInRound). */
  turns: SubjectTurns = {},
): BuiltPrompt {
  const snapshot = entrySnapshot(round, item);
  const { settings } = snapshot;
  const steps = itemLadder(settings, item.direction);
  const at = clampLevel(level, steps);
  const levelKind = steps[at];
  const seed = Math.floor(rand() * 2 ** 31);
  const accepted = formsOf(item.entry, item, settings);
  if (accepted.length === 0) throw new Error(`No forms for ${item.key}`);
  const askTense = settings.tenses.length > 1;
  const token = [rand(), rand()].map((r) => Math.floor(r * 2 ** 32).toString(36)).join('');
  const built: BuiltPrompt = { level: at, levelKind, seed, token, accepted, askTense };
  // One real subject for the item's person, taking turns (v1.24.0); a retry asks again with the one it missed.
  const subjects = subjectsOf(item.entry, item.tense, item.person);
  const subject = turns.again !== undefined && subjects.includes(turns.again)
    ? turns.again
    : pickSubject(subjects, round.subjectsSeen?.[cellKey(item)], turns.shown ?? [], seed);
  if (subject !== undefined) built.subject = subject;
  if (item.direction === 'to') {
    built.cue = entryKind(item.entry) === 'dative' ? engine.cueFor(item.entry, item, seed) : null;
    // A sentence instead of the label (v1.25.0): the one seen least recently; the subject is then the sentence's.
    if (turns.sentence) {
      if (turns.sentence.holdback) built.holdback = { ...turns.sentence.holdback };
      const picked = pickPromptSentence(turns.sentence.pool, seed, turns.sentence.recent, turns.sentence.again);
      if (picked) {
        built.sentence = promptSentenceOf(picked);
        delete built.subject;
      }
    }
    if (levelKind === 'choice') {
      const region = vosRegion(settings);
      const wrong = engine.distractors(item.entry, item.tense, item.person, 3, {
        ...(item.number ? { number: item.number } : {}),
        seed,
        strictAccents: strictFor(levelKind, settings),
        vosotros: settings.includeVosotros,
        ...(region ? { vosRegion: region } : {}),
        // Wrong forms from the deck's own tenses only: a present-only class rules "quisiésemos" out on sight.
        tenses: settings.tenses,
      });
      built.options = shuffle([accepted[0], ...wrong], rand);
      built.correctOptions = [accepted[0]];
    }
    return built;
  }
  built.form = accepted[0];
  if (levelKind === 'choice') {
    const set = entryKind(item.entry) === 'impersonal'
      ? impersonalOptions(item, accepted[0], snapshot, askTense, rand)
      : fromFormOptions(item, accepted[0], snapshot, askTense, rand);
    Object.assign(built, wordOptions(set, item, subject, askTense, seed));
  }
  return built;
}

/** The student's view of a built prompt (`round`: the round's snapshot; the entry's own deck's is picked from it). */
export function clientPrompt(entry: QueueEntry, index: number, total: number, round: RoundSnapshot): ClientPrompt {
  const built = entry.built;
  if (!built) throw new Error('Prompt not built');
  const snapshot = entrySnapshot(round, entry);
  const from = entry.deckId === undefined ? undefined : round.decks?.[String(entry.deckId)];
  const kind = built.levelKind === 'choice' ? 'choice' : 'typed';
  const toForm = entry.direction === 'to';
  const entryKindOf = entryKind(entry.entry);
  const showTense = toForm || !built.askTense;
  // The subject the prompt was built with; a prompt from before v1.24.0 has none and keeps the group.
  // A sentence (v1.25.0): its subject decides the person, and the page shows the sentence alone. The label and
  // cue still go along for a page loaded before v1.25.0 (a Chromebook tab left open over the deploy), which
  // knows no `sentence` and would show the verb with no subject: its label is then the sentence's own subject
  // ("mis primos"), nothing the sentence does not show. personId stays null: the page reads the subject.
  const sentence = toForm && built.sentence ? clientSentence(built.sentence, kind === 'choice') : null;
  const person = !toForm
    ? ''
    : sentence
      ? built.sentence?.subject?.es ?? personLabel(entry.entry, entry.tense, entry.person)
      : built.subject ?? personLabel(entry.entry, entry.tense, entry.person);
  const askPerson = !toForm && kind === 'typed' && entryKindOf !== 'impersonal';
  return {
    index,
    total,
    itemKey: built.token,
    kind,
    level: built.levelKind,
    strictAccents: built.levelKind === 'typed-strict' || (kind === 'choice' && strictFor('choice', snapshot.settings)),
    direction: toForm ? 'toForm' : 'fromForm',
    retry: !!entry.retry,
    entryLabel: toForm ? promptEntryName(entry.entry) : null,
    entryHint: toForm && entryKindOf === 'impersonal' ? 'impersonal' : null,
    tense: showTense ? entry.tense : null,
    tenseLabel: showTense ? tenseLabel(entry.tense) : null,
    personLabel: person || null,
    personId: toForm && !sentence && entryKindOf !== 'impersonal' ? entry.person : null,
    cue: toForm ? built.cue ?? null : null,
    sentence,
    form: toForm ? null : built.form ?? null,
    optionsVerb: toForm ? null : built.optionsVerb ?? null,
    options: built.options ? [...built.options] : null,
    askTense: !toForm && built.askTense,
    askPerson,
    personOptions: askPerson ? personOptions(entryKindOf, snapshot.settings) : null,
    tenseOptions: !toForm && kind === 'typed' && built.askTense
      ? snapshot.settings.tenses.map((id) => ({ id, label: tenseLabel(id) }))
      : null,
    scheduledReview: !!entry.review,
    fromDeck: entry.deckId !== undefined && from ? { deckId: entry.deckId, deckName: from.name } : null,
  };
}

// ---------------------------------------------------------------------------
// Grading

export interface Answer {
  choice?: string;
  text?: string;
  person?: string;
  tense?: string;
}

/** A malformed answer (no choice on a choice prompt, a missing person chip): a client error, not a wrong answer. */
export class AnswerShapeError extends Error {}

export interface Graded {
  result: Grade;
  /** Whether it moves the student up (an accent slip does while accents are forgiven). */
  counted: boolean;
  nearMiss: boolean;
  /** What was right, for the feedback line. */
  correctAnswer: string;
  /** fromForm: the other readings that would also have been right. */
  alsoCorrect: string[];
  /** What the student gave, as logged. */
  given: string;
  /** What a wrong answer (or an accent slip) most likely was; null when right. */
  mistake: Mistake | null;
  /** choice: the options that were right, as shown (the page marks them). */
  rightOptions: string[];
  /**
   * Everyone who shares the form, for the feedback line "tienen = ellos ·
   * ellas · ustedes", "tenía = yo · él · ella · usted" (v1.24.0); null for a
   * form of one subject alone (tengo), a command and an impersonal verb.
   */
  sharedBy: SharedBy | null;
  /** A prompt with a sentence (v1.25.0): filled in, its English, and "mis primos = ellos → viven"; else null. */
  sentence: SentenceFeedback | null;
}

/**
 * A form and every subject that takes it in its tense ("tienen" = ellos,
 * ellas, ustedes; "tenía" = yo, él, ella, usted), in person order.
 */
export interface SharedBy {
  form: string;
  /** The item's own person. */
  person: QuizPerson;
  /** Every person whose form it is, the item's own included, in person order. */
  persons: QuizPerson[];
  subjects: string[];
}

const PERSON_ORDER: readonly QuizPerson[] = ['yo', 'tu', 'vos', 'el', 'nosotros', 'vosotros', 'ellos'];

/**
 * Who shares a cell's form, for the feedback line: the subjects of every
 * person of the entry and tense the deck drills (vosotros and vos only when
 * it has them) whose accepted forms include it. Null when it is one
 * subject's alone.
 */
export function sharedByOf(item: Item, form: string, settings: Pick<QuizSettings, 'tenses' | 'includeVosotros' | 'vos'>): SharedBy | null {
  if (isImperativeTense(item.tense)) return null;
  const norm = normalizeAnswer(form);
  const number = item.number ?? 'sg';
  const persons = new Set<QuizPerson>([item.person]);
  for (const cell of cellsOf(item.entry, { ...settings, tenses: [item.tense] })) {
    if (cell.tense !== item.tense || (cell.number ?? 'sg') !== number) continue;
    if (formsOf(item.entry, cell, settings).some((f) => normalizeAnswer(f) === norm)) persons.add(cell.person);
  }
  const ordered = PERSON_ORDER.filter((p) => persons.has(p));
  const subjects = ordered.flatMap((p) => subjectsOf(item.entry, item.tense, p));
  return subjects.length > 1 ? { form, person: item.person, persons: ordered, subjects } : null;
}

const isImperativeTense = (tense: Tense) => tense === 'imperativeAffirmative' || tense === 'imperativeNegative';

const RANK: Record<Grade, number> = { wrong: 0, accent: 1, correct: 2 };

/**
 * A dative answer without the thing liked, when the student typed the prompt's
 * cue after the verb as the prompt shows it: "me gusta el chocolate" and
 * "a mí me gusta el chocolate" (or "me gusta el chocolate a mí") for the cue
 * "el chocolate" are graded as "me gusta". The cue is given, not graded, so
 * its accents are forgiven. Anything else is returned as typed.
 */
export function withoutCue(text: string, cue: string | null | undefined): string {
  if (!cue) return text;
  const words = normalizeAnswer(text).split(' ');
  // The cue is given, not graded: an echo of it counts however it is spelled,
  // ñ included (foldAccents keeps ñ, which matters for the verb, not the cue).
  const loose = (w: string) => foldAccents(w).replace(/ñ/g, 'n');
  const cueWords = normalizeAnswer(cue).split(' ').map(loose);
  const k = cueWords.length;
  const n = words.length;
  // The cue ends at `end`, with at least one word before it.
  const cueEndsAt = (end: number): boolean => end - k >= 1 && cueWords.every((w, i) => loose(words[end - k + i]) === w);
  if (cueEndsAt(n)) return words.slice(0, n - k).join(' ');
  if (n >= 2 && words[n - 2] === 'a' && cueEndsAt(n - 2)) return [...words.slice(0, n - 2 - k), ...words.slice(n - 2)].join(' ');
  return text;
}

/** An infinitive typed for a fromForm prompt: exact, or right but for accents. */
function gradeName(accepted: string[], given: string): Grade {
  const answer = normalizeAnswer(given);
  if (!answer) return 'wrong';
  const names = accepted.map(normalizeAnswer);
  if (names.includes(answer)) return 'correct';
  return names.some((n) => foldAccents(n) === foldAccents(answer)) ? 'accent' : 'wrong';
}

/**
 * The reading a "name the verb" option names, or null. A prompt built since
 * v1.24.0 keeps each option's reading ("ustedes · presente"); one built before
 * (a round in progress at the deploy) is read from its long label ("tener ·
 * ellos / ellas / ustedes · presente").
 */
export function optionReading(label: string, item: Item, snapshot: DeckSnapshot, built: Pick<BuiltPrompt, 'askTense' | 'options' | 'optionReadings'>): Reading | null {
  const at = built.options?.indexOf(label) ?? -1;
  if (built.optionReadings && at >= 0 && built.optionReadings[at]) return built.optionReadings[at];
  const { askTense } = built;
  const pool = optionPool(snapshot, askTense, item.tense);
  const hit = pool.all.find((r) => pool.label.get(r) === label);
  if (hit) return hit;
  // An impersonal prompt's options may name a verb by its infinitive alone ("ser · pretérito").
  const [name, tenseName] = label.split(' · ');
  const entry = snapshot.entries.find((e) => promptEntryName(e) === name);
  if (!entry) return null;
  const tense = (askTense && tenseName ? TENSES.find((t) => t.es === tenseName)?.id : undefined) ?? item.tense;
  return { entry, tense, person: 'el' };
}

/**
 * Grades an answer to a built prompt, on the server, under the settings of
 * the entry's own deck (`round`: the round's snapshot).
 *
 * Typed answers are compared with accents required at every typed level, so
 * a slip is always seen; on the typed-lenient rung it still counts (the
 * student is told to watch the accent), on typed-strict it does not.
 * fromForm answers are right for any reading of the form among the deck's
 * cells ("hablaba" is yo or él). A wrong answer (or a slip) is named:
 * classifyMistake for a form, the reading picked for a "name the verb" option.
 */
export function gradeAnswer(entry: QueueEntry, answer: Answer, round: RoundSnapshot): Graded {
  const built = entry.built;
  if (!built) throw new Error('Prompt not built');
  const snapshot = entrySnapshot(round, entry);
  const toForm = entry.direction === 'to';
  const kind = entryKind(entry.entry);
  let result: Grade;
  let given: string;

  if (built.levelKind === 'choice') {
    if (typeof answer.choice !== 'string' || !built.options?.includes(answer.choice)) {
      throw new AnswerShapeError('Pick one of the options');
    }
    given = answer.choice;
    result = built.correctOptions?.includes(answer.choice) ? 'correct' : 'wrong';
  } else if (toForm) {
    if (typeof answer.text !== 'string') throw new AnswerShapeError('Type an answer');
    given = answer.text;
    result = engine.gradeTyped(built.accepted, typedForm(entry, built, answer.text), true, entry.person, kind);
  } else {
    if (typeof answer.text !== 'string') throw new AnswerShapeError('Type an answer');
    const persons = personOptions(kind, snapshot.settings).map((p) => p.id as string);
    if (persons.length > 0 && !persons.includes(answer.person ?? '')) throw new AnswerShapeError('Pick who');
    if (built.askTense && !snapshot.settings.tenses.includes(answer.tense as Tense)) throw new AnswerShapeError('Pick the tense');
    given = [answer.text, persons.length > 0 ? answer.person : null, built.askTense ? answer.tense : null]
      .filter(Boolean).join(' · ');
    result = 'wrong';
    const readings = deckReadings(snapshot).get(normalizeAnswer(built.form ?? '')) ?? [readingOf(entry)];
    for (const reading of readings) {
      if (entryKind(reading.entry) !== 'impersonal' && reading.person !== answer.person) continue;
      if (built.askTense && reading.tense !== answer.tense) continue;
      const grade = gradeName(acceptedEntryNames(reading.entry), answer.text);
      if (RANK[grade] > RANK[result]) result = grade;
    }
  }

  const counted = countsCorrect(result, built.levelKind);
  let mistake: Mistake | null = null;
  if (result !== 'correct' && toForm) {
    // A typed answer is named without the sentence (or the gustar cue) it may echo.
    const form = built.levelKind === 'choice' ? given : typedForm(entry, built, given);
    const region = vosRegion(snapshot.settings);
    mistake = classifyMistake(readingOf(entry), form, {
      ...(region ? { vosRegion: region } : {}), tenses: snapshot.settings.tenses, entries: snapshot.entries,
    }) ?? { kind: 'unknown', detail: {} };
  } else if (result !== 'correct' && built.levelKind === 'choice') {
    const chosen = optionReading(given, entry, snapshot, built);
    // The options name no number, so neither side has one.
    const cell = { entry: entry.entry, tense: entry.tense, person: entry.person };
    mistake = chosen ? classifyReading(cell, { entry: chosen.entry, tense: chosen.tense, person: chosen.person }) : { kind: 'unknown', detail: {} };
  }
  let correctAnswer: string;
  let alsoCorrect: string[] = [];
  if (toForm) {
    correctAnswer = built.levelKind === 'choice' ? built.accepted[0] : built.accepted.join(' / ');
  } else if (built.subject !== undefined) {
    // v1.24.0: the verb, the subject the options named and the tense (always, in the feedback).
    correctAnswer = [promptEntryName(entry.entry), built.subject, tenseLabel(entry.tense)].join(' · ');
    alsoCorrect = alsoCorrectOf(entry, snapshot, built, correctAnswer);
  } else {
    // A choice prompt names the tense only when asked; the feedback always does.
    correctAnswer = readingLabel(readingOf(entry), true);
    const others = (deckReadings(snapshot).get(normalizeAnswer(built.form ?? '')) ?? [])
      .map((r) => readingLabel(r, true))
      .filter((label) => label !== correctAnswer);
    alsoCorrect = [...new Set(others)];
  }
  return {
    result,
    counted,
    nearMiss: result === 'accent',
    correctAnswer,
    alsoCorrect,
    given: given.slice(0, MAX_ANSWER_LENGTH),
    mistake,
    rightOptions: built.levelKind === 'choice' ? [...(built.correctOptions ?? [])] : [],
    sharedBy: sharedByOf(entry, toForm ? built.accepted[0] : built.form ?? built.accepted[0], snapshot.settings),
    sentence: toForm && built.sentence ? sentenceFeedback(built.sentence, built.accepted) : null,
  };
}

/**
 * A typed "give the form" answer as it is graded: without the sentence it echoes (withoutContext, v1.25.0),
 * or for a gustar-type label prompt without the cue (withoutCue).
 */
function typedForm(entry: QueueEntry, built: BuiltPrompt, text: string): string {
  const kind = entryKind(entry.entry);
  if (built.sentence) {
    return withoutContext(text, built.sentence, built.accepted, (t) => engine.gradeTyped(built.accepted, t, true, entry.person, kind));
  }
  return kind === 'dative' ? withoutCue(text, built.cue) : text;
}

/** A fromForm prompt's other right readings, as the feedback lists them (with the tense, and the whole group). */
function alsoCorrectOf(entry: Item, snapshot: DeckSnapshot, built: BuiltPrompt, correctAnswer: string): string[] {
  const own = readingLabel(readingOf(entry), true);
  const others = (deckReadings(snapshot).get(normalizeAnswer(built.form ?? '')) ?? [])
    .map((r) => readingLabel(r, true))
    .filter((label) => label !== own && label !== correctAnswer);
  return [...new Set(others)];
}

/** A mistake as the answer response carries it: with the guide sections that explain it, most specific first. */
export interface MistakeView extends Mistake {
  /** The section to link ("Why?"): the first of guideSections, or null for none. */
  guideSection: string | null;
  /** Guide section ids, most specific first; the page opens the first one its guide shows (sections depend on the deck). */
  guideSections: string[];
}

export function mistakeView(mistake: Mistake | null, item: Item): MistakeView | null {
  if (!mistake) return null;
  const guideSections = mistakeGuideSections(mistake, readingOf(item));
  return { ...mistake, guideSection: guideSections[0] ?? null, guideSections };
}

/**
 * A response time the browser measured, as stored: whole milliseconds, capped
 * at 10 minutes (a tab left open); anything that is no duration (negative,
 * NaN, a string) is dropped, not guessed.
 */
export const MAX_RESPONSE_MS = 600_000;
export function responseMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.min(MAX_RESPONSE_MS, Math.round(raw));
}

/**
 * A page's time more than this over the time that passed since the previous
 * answer: an honest page never sends one (its clock starts after the previous
 * answer's response arrives), so it comes from an edited request.
 */
export const TIME_MISMATCH_SLACK_MS = 1000;

/**
 * One stored answer's time as the server counts it (the teacher's medians in
 * routers/conjugation.ts responseTimes, and anything else that judges a
 * round's pace): the page's `ms`, never more than the
 * server's own `gap` (the time since the previous answer of the round, or
 * since its start for the first). The gap also holds the feedback read and the
 * network, so an honest time stays as it is while an edited one is capped.
 * With no `ms` the gap stands in; a negative gap (a clock set back) is unknown.
 * `mismatch`: the page claimed more than TIME_MISMATCH_SLACK_MS over the gap.
 */
export function answerTime(rawMs: number | string | null, rawGap: number | string | null): { usedMs: number | null; mismatch: boolean } {
  const ms = rawMs === null ? null : Number(rawMs);
  const gap = rawGap === null || Number(rawGap) < 0 ? null : Number(rawGap);
  return {
    usedMs: ms === null ? gap : gap === null ? ms : Math.min(ms, gap),
    mismatch: ms !== null && gap !== null && ms > gap + TIME_MISMATCH_SLACK_MS,
  };
}

/** The middle value, the two middle ones' mean rounded for an even count; null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * A round played to its last prompt, by the rule Days practised uses
 * (routers/conjugation.ts practiceDays): position at 2·prompts −
 * first_try_correct settles almost every round; only one that dropped a retry
 * has its queue read.
 */
export function playedToEnd(round: { position: number; prompts: number; firstTryCorrect: number; queue: string }): boolean {
  if (round.position >= 2 * round.prompts - round.firstTryCorrect) return true;
  try {
    return round.position >= (JSON.parse(round.queue) as unknown[]).length;
  } catch {
    return false;
  }
}

/** The queue after an answer: a miss comes back once, at the end of the round. */
export function requeue(queue: readonly QueueEntry[], position: number, counted: boolean): QueueEntry[] {
  const out = [...queue];
  const current = out[position];
  if (!counted && current && !current.retry) {
    const item: QueueEntry = { ...current, retry: true };
    delete item.built;
    out.push(item);
  }
  return out;
}

/** The round's score: right the first time, over the prompts it started with. */
export function roundScore(firstTryCorrect: number, prompts: number): number {
  return prompts > 0 ? firstTryCorrect / prompts : 0;
}

// ---------------------------------------------------------------------------
// Teacher views

export interface DetectedEntryView {
  entry: string;
  label: string;
  kind: VerbKind;
  known: boolean;
  cards: { id: number | null; front: string; back: string }[];
  note: string | null;
  excludedByDefault: boolean;
  /** Whether the deck drills it now. */
  included: boolean;
  /** Added by the teacher rather than found in the cards. */
  extra: boolean;
}

/** The detected verbs and the teacher's additions, as the settings panel lists them. */
export function describeEntries(detected: DetectedVerb[], settings: QuizSettings): DetectedEntryView[] {
  const effective = new Set(effectiveEntries(detected, settings));
  const views: DetectedEntryView[] = detected.map((d) => ({
    entry: d.infinitive,
    label: entryLabel(d.infinitive),
    kind: entryKind(d.infinitive),
    known: isKnownVerb(d.infinitive),
    cards: d.cards.map((c) => ({ id: c.id ?? null, front: c.front, back: c.back })),
    note: d.note ?? null,
    excludedByDefault: d.excludedByDefault,
    included: effective.has(d.infinitive),
    extra: false,
  }));
  for (const extra of settings.extraEntries) {
    if (detected.some((d) => d.infinitive === extra)) continue;
    const known = isKnownVerb(extra);
    views.push({
      entry: extra,
      label: entryLabel(extra),
      kind: entryKind(extra),
      known,
      cards: [],
      note: known ? null : NOTE_UNKNOWN,
      excludedByDefault: false,
      included: true,
      extra: true,
    });
  }
  return views;
}

export interface PreviewCell {
  tense: Tense;
  tenseLabel: string;
  person: QuizPerson;
  personLabel: string;
  number: GNumber | null;
  cue: string | null;
  forms: string[];
}

/** Every cell of an entry with its forms, for the teacher to check. */
export function previewEntry(entry: string, settings: Pick<QuizSettings, 'tenses' | 'includeVosotros' | 'vos'>): PreviewCell[] {
  const kind = entryKind(entry);
  return cellsOf(entry, settings).map((cell) => ({
    tense: cell.tense,
    tenseLabel: tenseLabel(cell.tense),
    person: cell.person,
    personLabel: shortPersonLabel(entry, cell.tense, cell.person),
    number: cell.number ?? null,
    cue: kind === 'dative' ? engine.cueFor(entry, cell) : null,
    forms: formsOf(entry, cell, settings),
  }));
}

export interface ItemView {
  itemKey: string;
  entry: string;
  entryLabel: string;
  tense: Tense;
  tenseLabel: string;
  person: QuizPerson;
  personLabel: string;
  number: GNumber | null;
  direction: 'toForm' | 'fromForm';
  /** The form drilled (vos forms in the deck's region). */
  form: string;
}

/** An item described for the teacher ("most missed"); null for a key the code cannot read. */
export function describeItem(key: string, settings: Pick<QuizSettings, 'vos'>): ItemView | null {
  const item = parseItemKey(key);
  if (!item || !parseEntry(item.entry)) return null;
  return {
    itemKey: key,
    entry: item.entry,
    entryLabel: entryLabel(item.entry),
    tense: item.tense,
    tenseLabel: tenseLabel(item.tense),
    person: item.person,
    personLabel: shortPersonLabel(item.entry, item.tense, item.person),
    number: item.number ?? null,
    direction: item.direction === 'to' ? 'toForm' : 'fromForm',
    form: formsOf(item.entry, item, settings)[0] ?? '',
  };
}
