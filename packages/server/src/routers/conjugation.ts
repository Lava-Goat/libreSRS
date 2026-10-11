// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Conjugation quizzes: "[Deck name] conjugation", built from the verbs of a
 * deck the teacher turned it on for. Students play rounds graded here, on
 * the server: a round's queue, with its answers, never leaves the server, and
 * an answer is taken only for the prompt the round is waiting on. The pure
 * logic (items, ladder, round plan, prompts, grading) is
 * services/conjugationQuiz.ts.
 *
 * A round also brings back due forms of the student's other decks (planRound):
 * each is asked, graded and written back under its own deck, and the same form
 * in decks that climb the same ladder shares one state (storeProgress), so one
 * review counts everywhere.
 *
 * "Study all" (v1.18.0): one round of
 * STUDY_ALL_LENGTH prompts from every quiz the student may play, due forms
 * first, then forms in progress, then new ones (planAllRound). The round's
 * `scope` is 'all'; its deck_id is its lead, the newest of those decks, kept
 * for the cascade (deleting the lead hands the round to its next deck first:
 * keepStudyAllRoundsOf), and each prompt carries its own deck. A deck's own
 * round plays and scores as before. An extension may add fields to a round's
 * summary, to an answer that finished sets and to the Study all overview
 * (the roundSummary, answer and studyAllOverview hooks).
 *
 * One answer call per prompt: a class of 35 answering every few seconds is a
 * small share of the school-wide per-IP API limit.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import { assertDeckAccess, getUserDeckIds } from '../services/deckAccess.js';
import { fieldsBeside, type FieldsBeside } from '../extensions/api.js';
import { ext, type ExtensionFields } from '../extensions/registry.js';
import type { HookContexts } from '../extensions/api.js';
import {
  ACCENT_MODES,
  ANSWER_MODES,
  AnswerShapeError,
  DIRECTION_SETTINGS,
  FROM_LADDER,
  MAX_ANSWER_LENGTH,
  MAX_ENTRY_LIST,
  ROUND_LENGTH_MAX,
  ROUND_LENGTH_MIN,
  ROUND_TTL_MS,
  STUDY_ALL_LENGTH,
  TENSE_IDS,
  TIME_MISMATCH_SLACK_MS,
  VOS_SETTINGS,
  advance,
  answerTime,
  buildPrompt,
  turnsInRound,
  subjectsOf,
  canonicalEntryId,
  cellKey,
  clampLevel,
  clientPrompt,
  deckView,
  describeEntries,
  describeItem,
  detectDeckVerbs,
  dueCount,
  dueEntries,
  effectiveEntries,
  entrySnapshot,
  gradeAnswer,
  isMastered,
  itemLadder,
  itemsFor,
  ladder,
  medianOf,
  mistakeView,
  orderTenses,
  parseSettings,
  planAllRound,
  planRound,
  playedToEnd,
  previewEntry,
  promptEntryName,
  requeue,
  responseMs,
  reviewThrough,
  roundScore,
  sameLadder,
  schoolDay,
  schoolDaysUntil,
  settingsToRow,
  siblingKey,
  snapshotOf,
  startLevel,
  startingState,
  tenseLabel,
  type ClientPrompt,
  type DeckSnapshot,
  type Graded,
  type Item,
  type ItemDirection,
  type LevelKind,
  type MistakeView,
  type Outcome,
  type PlanDeck,
  type ProgressState,
  type SharedBy,
  type QueueEntry,
  type QuizSettings,
  type RoundSnapshot,
  type VosSetting,
  type DirectionSetting,
  type AccentMode,
  type TwinRow,
  type SubjectTurns,
  SENTENCE_MODES,
  sentenceModeOf,
} from '../services/conjugationQuiz.js';
import { entryKind, entryLabel, isKnownVerb, mistakeKey, NOTE_UNKNOWN, SHORT_PERSON_LABELS, type Mistake, type Person, type Tense } from '@libresrs/shared/conjugation';
import {
  SEEN_PER_CELL,
  SUBJECT_TYPES,
  blankText,
  cellPool,
  cellSentences,
  subjectTypeOf,
  type SubjectType,
  planSentence,
  refKey,
  subjectsMet,
  type SentenceFeedback,
  type SentencePlan,
  type SentenceSubject,
} from '../services/conjugationSentences.js';
import { loadSentenceSource } from '../services/conjugationSentenceSource.js';
import { filledIn } from '@libresrs/shared/conjugation/sentences';
import { sentencesRouter } from './conjugationSentences.js';

type User = { id: number; role: string };
type Round = typeof schema.conjugationRounds.$inferSelect;

// ---------------------------------------------------------------------------
// Deck state

export interface DeckQuizState {
  deckId: number;
  deckName: string;
  settings: QuizSettings;
  detected: ReturnType<typeof detectDeckVerbs>;
  entries: string[];
  items: Item[];
  /** The deck's "give the form" ladder ("name the verb" items climb FROM_LADDER). */
  steps: LevelKind[];
  cardCount: number;
}

async function findDeck(deckId: number) {
  const deck = await db.query.decks.findFirst({ where: eq(schema.decks.id, deckId), columns: { id: true, name: true } });
  if (!deck) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
  return deck;
}

async function settingsFor(deckId: number): Promise<QuizSettings> {
  const row = await db.query.deckConjugation.findFirst({ where: eq(schema.deckConjugation.deckId, deckId) });
  return parseSettings(row);
}

/** A deck's quiz as it is now: settings, verbs (detected from the cards on every read) and items. */
export async function deckQuizState(deckId: number): Promise<DeckQuizState> {
  const deck = await findDeck(deckId);
  const settings = await settingsFor(deckId);
  const cards = await db.select({ id: schema.cards.id, front: schema.cards.front, back: schema.cards.back })
    .from(schema.cards)
    .where(eq(schema.cards.deckId, deckId))
    .orderBy(asc(schema.cards.id));
  const detected = detectDeckVerbs(cards);
  const entries = effectiveEntries(detected, settings);
  return {
    deckId,
    deckName: deck.name,
    settings,
    detected,
    entries,
    items: itemsFor(entries, settings),
    steps: ladder(settings),
    cardCount: cards.length,
  };
}

/** The deck ids with the quiz turned on. */
async function enabledDeckIds(): Promise<number[]> {
  const rows = await db.select({ deckId: schema.deckConjugation.deckId })
    .from(schema.deckConjugation)
    .where(eq(schema.deckConjugation.enabled, true));
  return rows.map((r) => r.deckId);
}

/** The quizzes a user may play now: turned on, and (for a student) of a deck they have. */
async function playableDeckIds(user: User): Promise<number[]> {
  const enabled = await enabledDeckIds();
  if (user.role === 'admin') return enabled;
  const mine = new Set(await getUserDeckIds(user.id));
  return enabled.filter((id) => mine.has(id));
}

/**
 * The deck, if this user may play its quiz: students need access to the deck
 * and the quiz turned on; teachers may play any deck ("Try it"), on or off.
 */
async function assertCanPlay(user: User, deckId: number) {
  const deck = await findDeck(deckId);
  if (user.role === 'admin') return deck;
  await assertDeckAccess(user.id, deckId);
  const settings = await settingsFor(deckId);
  if (!settings.enabled) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'This deck has no conjugation quiz',
      cause: { appCode: 'CONJUGATION_OFF' },
    });
  }
  return deck;
}

/** "Study all" with no quiz to play: none turned on for the student's decks, or none of theirs left. */
const noQuizError = () => new TRPCError({
  code: 'NOT_FOUND',
  message: 'You have no conjugation quiz to practice',
  cause: { appCode: 'CONJUGATION_NONE' },
});

/**
 * The quizzes "Study all" plays: every one the user may play now that drills
 * something, newest deck first (by creation, then id), so the first is the
 * round's lead and new forms come from the newest unit first.
 */
async function studyAllStates(user: User): Promise<DeckQuizState[]> {
  const ids = await playableDeckIds(user);
  if (ids.length === 0) return [];
  const order = db.select({ id: schema.decks.id }).from(schema.decks)
    .where(inArray(schema.decks.id, ids))
    .orderBy(desc(schema.decks.createdAt), desc(schema.decks.id))
    .all()
    .map((r) => r.id);
  const states = await Promise.all(order.map((id) => deckQuizState(id)));
  return states.filter((s) => s.items.length > 0);
}

/**
 * Whether this user may go on with a round: a deck's round needs its deck
 * (assertCanPlay); a "Study all" round needs at least one quiz they may play
 * now (prompts of a deck they lost are dropped before they are shown).
 */
async function assertCanPlayRound(user: User, round: Round) {
  if (round.scope !== 'all') {
    await assertCanPlay(user, round.deckId);
    return;
  }
  if ((await playableDeckIds(user)).length === 0) throw noQuizError();
}

type ProgressRow = typeof schema.conjugationProgress.$inferSelect;
const P = schema.conjugationProgress;

/** A stored row as the quiz logic reads it. */
function stateOf(row: ProgressRow): ProgressState {
  return {
    level: row.level,
    mastered: row.mastered,
    firstTopDay: row.firstTopDay,
    dueAt: row.dueAt ? row.dueAt.getTime() : null,
    reviewStep: row.reviewStep,
  };
}

function progressMap(rows: readonly ProgressRow[]): Map<string, ProgressState> {
  return new Map(rows.map((r) => [r.itemKey, stateOf(r)]));
}

/** Mastered items of the deck's current items, each on its own direction's ladder. */
function masteredCount(items: readonly Item[], progress: ReadonlyMap<string, ProgressState>, settings: QuizSettings): number {
  return items.filter((i) => isMastered(progress.get(i.key), itemLadder(settings, i.direction))).length;
}

export interface MasteryCounts {
  mastered: number;
  /** Right at the top once, not yet on a second school day: "need one more day". */
  almost: number;
  /** Past the first rung, not mastered and not waiting for a second day: "on the way up". */
  climbing: number;
}

/**
 * Where a deck's items stand, so a first perfect round does not read as
 * "0 / 50 mastered" and nothing else: mastery needs the top rung on two
 * school days (advance), so the first day only ever moves items up.
 */
function masteryCounts(items: readonly Item[], progress: ReadonlyMap<string, ProgressState>, settings: QuizSettings): MasteryCounts {
  const out: MasteryCounts = { mastered: 0, almost: 0, climbing: 0 };
  for (const item of items) {
    const state = progress.get(item.key);
    const steps = itemLadder(settings, item.direction);
    if (isMastered(state, steps)) out.mastered += 1;
    else if (!state) continue;
    else if (state.firstTopDay && clampLevel(state.level, steps) === steps.length - 1) out.almost += 1;
    else if (clampLevel(state.level, steps) > 0) out.climbing += 1;
  }
  return out;
}

/**
 * Mastery over several decks, each form (item key) counted once, in the first
 * deck that drills it (newest first): Unit 1's "soy" and Unit 3's are one
 * form, written to both by storeProgress.
 */
function masteryAcross(views: readonly Pick<PlanDeck, 'items' | 'progress' | 'settings'>[]): MasteryCounts & { total: number } {
  const seen = new Set<string>();
  const out = { mastered: 0, almost: 0, climbing: 0, total: 0 };
  for (const view of views) {
    const items = view.items.filter((i) => !seen.has(i.key));
    for (const i of items) seen.add(i.key);
    const counts = masteryCounts(items, view.progress, view.settings);
    out.mastered += counts.mastered;
    out.almost += counts.almost;
    out.climbing += counts.climbing;
    out.total += items.length;
  }
  return out;
}

/** A deck with the student's own rows only: enough for mastery and due counts. */
function ownView(deckId: number, settings: QuizSettings, items: readonly Item[], rows: readonly ProgressRow[]): PlanDeck {
  return { deckId, settings, items, progress: progressMap(rows.filter((r) => r.deckId === deckId)) };
}

const RUNGS: readonly LevelKind[] = ['choice', 'typed-lenient', 'typed-strict'];

/**
 * The rungs a student has answered at, for the guide: in any deck (a student
 * who has typed answers in Unit 1 has met typing), plus every rung below the
 * one a "give the form" item of this deck stands on. Answers of a replaced
 * round are gone, but its items' levels are not. ("Name the verb" items stay
 * at multiple choice, and their rows from v1.12 say nothing about typing.)
 */
export function reachedRungs(answered: readonly string[], rows: readonly ProgressRow[], steps: readonly LevelKind[]): LevelKind[] {
  const reached = new Set<string>(answered);
  const top = rows.filter((r) => r.itemKey.endsWith('|to')).reduce((max, r) => Math.max(max, clampLevel(r.level, steps)), -1);
  for (let i = 0; i <= top; i++) reached.add(steps[i]);
  return RUNGS.filter((rung) => reached.has(rung));
}

/**
 * A round that counts as a score: played to its end (playedToEnd), not
 * replaced by a newer one. A round ended early (a `finish` before its last
 * answer, which only a console can send) is no round, so it adds nothing to
 * Rounds or "played", and no extension hears of it.
 */
const completed = (r: Round) => !!r.finishedAt && !r.abandoned && playedToEnd(r);

export interface RoundStats {
  rounds: number;
  lastScore: number | null;
  bestScore: number | null;
  lastPlayed: Date | null;
}

/** Scores of one student's rounds on one deck. */
export function roundStats(rounds: Round[], lastProgressAt: Date | null = null): RoundStats {
  const done = rounds.filter(completed).sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
  const scores = done.map((r) => roundScore(r.firstTryCorrect, r.prompts));
  // Only rounds with an answer taken (each one moves the position): starting a round, and ending it at once, is not playing.
  const times = [
    ...rounds.filter((r) => r.position > 0).map((r) => (r.finishedAt ?? r.startedAt).getTime()),
    ...(lastProgressAt ? [lastProgressAt.getTime()] : []),
  ];
  return {
    rounds: done.length,
    lastScore: scores[0] ?? null,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    lastPlayed: times.length > 0 ? new Date(Math.max(...times)) : null,
  };
}

// ---------------------------------------------------------------------------
// Progress, shared across decks

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The quiz settings of decks, by id (the defaults for a deck with no quiz row). */
function settingsById(tx: Tx, deckIds: readonly number[], known: ReadonlyMap<number, QuizSettings> = new Map()): Map<number, QuizSettings> {
  const out = new Map(known);
  const missing = [...new Set(deckIds)].filter((id) => !out.has(id));
  if (missing.length > 0) {
    const rows = tx.select().from(schema.deckConjugation).where(inArray(schema.deckConjugation.deckId, missing)).all();
    for (const id of missing) out.set(id, parseSettings(rows.find((r) => r.deckId === id)));
  }
  return out;
}

/** The student's rows of one item key, in every deck. */
function rowsOfKey(tx: Tx, userId: number, key: string): ProgressRow[] {
  return tx.select().from(P).where(and(eq(P.userId, userId), eq(P.itemKey, key))).all();
}

/** Where an item of a deck starts (startingState), read inside the transaction. */
function startOf(tx: Tx, userId: number, deckId: number, item: Item, settings: QuizSettings) {
  const rows = rowsOfKey(tx, userId, item.key);
  const settingsOf = settingsById(tx, rows.map((r) => r.deckId), new Map([[deckId, settings]]));
  const twins: TwinRow[] = rows.map((r) => ({ deckId: r.deckId, state: stateOf(r) }));
  return startingState(deckId, settings, item.direction, twins, (id) => settingsOf.get(id) ?? parseSettings(null));
}

/**
 * How long since the student last answered this form, either direction, in any
 * deck (every answer stamps its row's last_at); null the first time.
 */
function sinceLastSeen(tx: Tx, userId: number, key: string, now: Date): number | null {
  const row = tx.select({ last: sql<number | null>`max(${P.lastAt})` }).from(P)
    .where(and(eq(P.userId, userId), inArray(P.itemKey, [key, siblingKey(key)]))).get();
  return row?.last === null || row?.last === undefined ? null : Math.max(0, now.getTime() - Number(row.last));
}

/**
 * The subjects the student was shown for each cell of a round's queue, and
 * when last (v1.24.0): read once at round start into its snapshot, so each
 * prompt can name the subject seen least recently (buildPrompt). Both
 * directions of a cell count; answers from before v1.24.0 have none.
 */
export function subjectsSeenFor(tx: Tx, userId: number, items: readonly Item[]): Record<string, Record<string, number>> {
  const keys = [...new Set(items.flatMap((i) => [i.key, siblingKey(i.key)]))];
  if (keys.length === 0) return {};
  const A = schema.conjugationAnswers;
  const rows = tx.select({ itemKey: A.itemKey, subject: A.subjectShown, last: sql<number>`max(${A.at})` }).from(A)
    .where(and(eq(A.userId, userId), inArray(A.itemKey, keys), isNotNull(A.subjectShown)))
    .groupBy(A.itemKey, A.subjectShown)
    .all();
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!r.subject) continue;
    const cell = r.itemKey.slice(0, r.itemKey.lastIndexOf('|'));
    const seen = (out[cell] ??= {});
    seen[r.subject] = Math.max(seen[r.subject] ?? 0, Number(r.last));
  }
  return out;
}

/**
 * The sentences the student was shown for each "give the form" cell of a round's queue (v1.25.0): ref keys,
 * most recent first, read once at round start into its snapshot, so each prompt can show the sentence seen
 * least recently (buildPrompt). Nothing to read when no deck of the round has sentences on.
 */
export function sentencesSeenFor(tx: Tx, userId: number, items: readonly Item[], snapshot: RoundSnapshot): Record<string, string[]> {
  const decks = [snapshot, ...Object.values(snapshot.decks ?? {})];
  if (!decks.some((d) => sentenceModeOf(d.settings) !== 'off')) return {};
  const keys = [...new Set(items.filter((i) => i.direction === 'to').map((i) => i.key))];
  if (keys.length === 0) return {};
  const A = schema.conjugationAnswers;
  const rows = tx.select({ itemKey: A.itemKey, ref: A.sentenceRef, last: sql<number>`max(${A.at})` }).from(A)
    .where(and(eq(A.userId, userId), inArray(A.itemKey, keys), isNotNull(A.sentenceRef)))
    .groupBy(A.itemKey, A.sentenceRef)
    .all();
  const byCell = new Map<string, { ref: string; last: number }[]>();
  for (const r of rows) {
    if (!r.ref) continue;
    const cell = r.itemKey.slice(0, r.itemKey.lastIndexOf('|'));
    byCell.set(cell, [...(byCell.get(cell) ?? []), { ref: r.ref, last: Number(r.last) }]);
  }
  const out: Record<string, string[]> = {};
  for (const [cell, list] of byCell) {
    out[cell] = list.sort((a, b) => b.last - a.last).slice(0, SEEN_PER_CELL).map((x) => refKey(x.ref));
  }
  return out;
}

/**
 * The holdback's view of an item for a student, in one deck (progress is kept per deck, and a later deck
 * may repeat forms of earlier ones): when the student first answered it there (ms, or null), and whether they have
 * answered its probe there already. The probe is the first answer 7 days or more after that first showing.
 */
function holdbackHistory(tx: Tx, userId: number, deckId: number, key: string): { firstShownAt: number | null; probed: boolean } {
  const A = schema.conjugationAnswers;
  const row = tx.select({
    first: sql<number | null>`min(${A.at})`,
    probes: sql<number>`coalesce(sum(${A.holdbackProbe}), 0)`,
  }).from(A).where(and(eq(A.userId, userId), eq(A.deckId, deckId), eq(A.itemKey, key))).get();
  const first = row?.first === null || row?.first === undefined ? null : Number(row.first);
  return { firstShownAt: first, probed: Number(row?.probes ?? 0) > 0 };
}

/**
 * The round's turns for the entry at `position`, with its sentence (v1.25.0): under the deck's mode (from the
 * round's snapshot) and holdback, the cell's pool, read now, or none for the label. A retry shows what the
 * prompt it retries showed: a sentence (another one of its subject, when there is one) or the label. Under the
 * holdback a form with no sentence is left out of the measurement (no arm recorded): its label is no choice.
 */
function turnsFor(tx: Tx, userId: number, queue: readonly QueueEntry[], position: number, snapshot: RoundSnapshot, roundDeckId: number, now: number): SubjectTurns {
  const entry = queue[position];
  const turns = turnsInRound(queue, position, entry);
  if (entry.direction !== 'to') return turns;
  const deck = entrySnapshot(snapshot, entry);
  const mode = sentenceModeOf(deck.settings);
  if (mode === 'off') return turns;
  const deckId = entry.deckId ?? roundDeckId;
  const holdback = !!deck.settings.sentenceHoldback;
  const cell = { tense: entry.tense, person: entry.person as Person, ...(entry.number ? { number: entry.number } : {}) };
  const poolNow = () => cellPool(loadSentenceSource(tx, deckId, deck.settings, deck.entries), mode, entry.entry, cell);
  let plan: SentencePlan;
  let pool: ReturnType<typeof poolNow>;
  if (entry.retry && turns.retryOf) {
    plan = { show: !!turns.retryOf.sentence, holdback: turns.retryOf.holdback ?? null };
    pool = plan.show ? poolNow() : [];
  } else {
    const history = holdback ? holdbackHistory(tx, userId, deckId, entry.key) : { firstShownAt: null, probed: false };
    plan = planSentence({ mode, holdback, userId, entry: entry.entry, direction: 'to', ...history, now, coin: Math.random() });
    const all = plan.show || plan.holdback ? poolNow() : [];
    if (plan.holdback && all.length === 0) plan = { show: false, holdback: null };
    pool = plan.show ? all : [];
  }
  const recent = [...(turns.sentencesShown ?? []).map(refKey).reverse(), ...(snapshot.sentencesSeen?.[cellKey(entry)] ?? [])];
  return {
    ...turns,
    sentence: { pool, recent, ...(turns.retryOf?.sentence ? { again: turns.retryOf.sentence } : {}), holdback: plan.holdback },
  };
}

/** The level an entry of a round is asked at now, in its own deck. */
function levelNow(tx: Tx, userId: number, deckId: number, item: Item, settings: QuizSettings): number {
  const steps = itemLadder(settings, item.direction);
  const start = startOf(tx, userId, deckId, item, settings);
  return clampLevel(start.state?.level ?? (start.carried ? steps.length - 1 : 0), steps);
}

/**
 * Stores an item's progress in its deck — with the answer's counts when it is
 * the item answered, else only if the row exists — and writes the same state
 * to the item's row in each of the student's other decks with the same ladder,
 * so a form has one state and one due date whichever unit asks for it.
 * Returns the decks where the item is mastered for the first time.
 */
function storeProgress(tx: Tx, args: {
  userId: number;
  deckId: number;
  key: string;
  direction: ItemDirection;
  settings: QuizSettings;
  state: ProgressState;
  now: Date;
  answer?: { counted: boolean };
}): number[] {
  const { userId, deckId, key, state, now } = args;
  const rows = tx.select({ deckId: P.deckId, firstMasteredAt: P.firstMasteredAt }).from(P)
    .where(and(eq(P.userId, userId), eq(P.itemKey, key))).all();
  const values = {
    level: state.level,
    mastered: state.mastered,
    firstTopDay: state.firstTopDay ?? null,
    dueAt: state.dueAt === null || state.dueAt === undefined ? null : new Date(state.dueAt),
    reviewStep: state.reviewStep ?? 0,
    // Never cleared: "mastered at least once" survives a later lapse.
    ...(state.mastered ? { firstMasteredAt: sql`coalesce(${P.firstMasteredAt}, ${now.getTime()})` } : {}),
  };
  const firsts: number[] = [];
  const origin = rows.find((r) => r.deckId === deckId);
  if (state.mastered && !origin?.firstMasteredAt) firsts.push(deckId);
  const where = (id: number) => and(eq(P.userId, userId), eq(P.deckId, id), eq(P.itemKey, key));
  if (args.answer) {
    const counted = args.answer.counted;
    tx.insert(P).values({
      userId, deckId, itemKey: key, ...values,
      firstMasteredAt: state.mastered ? now : null,
      correct: counted ? 1 : 0,
      wrong: counted ? 0 : 1,
      lastAt: now,
    }).onConflictDoUpdate({
      target: [P.userId, P.deckId, P.itemKey],
      set: {
        ...values,
        correct: sql`${P.correct} + ${counted ? 1 : 0}`,
        wrong: sql`${P.wrong} + ${counted ? 0 : 1}`,
        lastAt: now,
      },
    }).run();
  } else if (origin) {
    tx.update(P).set(values).where(where(deckId)).run();
  } else {
    return [];
  }
  const twins = rows.filter((r) => r.deckId !== deckId);
  if (twins.length > 0) {
    const steps = itemLadder(args.settings, args.direction);
    const settingsOf = settingsById(tx, twins.map((t) => t.deckId));
    for (const twin of twins) {
      if (!sameLadder(itemLadder(settingsOf.get(twin.deckId) ?? parseSettings(null), args.direction), steps)) continue;
      if (state.mastered && !twin.firstMasteredAt) firsts.push(twin.deckId);
      tx.update(P).set(values).where(where(twin.deckId)).run();
    }
  }
  return firsts;
}

// ---------------------------------------------------------------------------
// Finished sets (every item of a deck mastered at least once)

export interface ConjugationSetFinished {
  userId: number;
  deckId: number;
  deckName: string;
  at: Date;
}

type SetFinishedListener = (event: ConjugationSetFinished) => void | Promise<void>;
const setFinishedListeners = new Set<SetFinishedListener>();

/**
 * Called after an answer (committed) finishes a student's conjugation set: every
 * item of the deck's quiz mastered at least once. "Mastered at once" almost
 * never happens in a 60–110-item deck on this calendar (mastered forms come
 * due and lapse), so a lapse later does not take a finish back. Students only;
 * a listener that throws is logged. Returns the function that unregisters it.
 */
export function onConjugationSetFinished(listener: SetFinishedListener): () => void {
  setFinishedListeners.add(listener);
  return () => setFinishedListeners.delete(listener);
}

/** Of decks where items were just mastered for the first time, those every item of which has now been mastered. */
async function finishedSets(userId: number, deckIds: readonly number[]): Promise<{ deckId: number; deckName: string }[]> {
  const out: { deckId: number; deckName: string }[] = [];
  for (const deckId of [...new Set(deckIds)]) {
    const state = await deckQuizState(deckId).catch(() => null);
    if (!state || state.items.length === 0) continue;
    const done = new Set((await db.select({ key: P.itemKey }).from(P)
      .where(and(eq(P.userId, userId), eq(P.deckId, deckId), isNotNull(P.firstMasteredAt)))).map((r) => r.key));
    if (state.items.every((i) => done.has(i.key))) out.push({ deckId, deckName: state.deckName });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rounds

const roundError = (code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string, appCode: string) =>
  new TRPCError({ code, message, cause: { appCode } });

const parseQueue = (round: Round): QueueEntry[] => JSON.parse(round.queue) as QueueEntry[];
const parseSnapshot = (round: Round): RoundSnapshot => JSON.parse(round.settingsSnapshot) as RoundSnapshot;

/** One deck's mastery, as a "Study all" round's summary lists it. */
export interface DeckMastery extends MasteryCounts {
  deckId: number;
  deckName: string;
  total: number;
}

/** A round's summary as core writes it (an extension may add fields: RoundSummary). */
export interface CoreRoundSummary {
  roundId: number;
  /** 'all': a "Study all" round, whose mastery is over its decks' forms (each once), listed deck by deck in `decks`. */
  scope: 'deck' | 'all';
  score: number;
  firstTryCorrect: number;
  prompts: number;
  answers: number;
  abandoned: boolean;
  mastered: number;
  /** Items right at the top once, mastered by a right answer on another school day. */
  almost: number;
  /** Items past the first rung, not mastered yet. */
  climbing: number;
  total: number;
  /** A "Study all" round: each deck it asked forms of, newest first, with its own mastery; null for a deck's round. */
  decks: DeckMastery[] | null;
}

/**
 * A round's summary: core's fields and the roundSummary hook's (optional: a build without
 * extensions has none). Their defaults sit at the end of the summary's first fields (after
 * `abandoned`); a summary played to its end gets the hook's values once the round's last answer
 * is saved, outside the transaction (withRoundFields, finish).
 */
export type RoundSummary = CoreRoundSummary & FieldsBeside<CoreRoundSummary, ExtensionFields['roundSummary']>;

function summaryOf(tx: Tx, round: Round, snapshot: RoundSnapshot): RoundSummary {
  const base = {
    roundId: round.id,
    scope: round.scope,
    score: roundScore(round.firstTryCorrect, round.prompts),
    firstTryCorrect: round.firstTryCorrect,
    prompts: round.prompts,
    answers: round.answers,
    abandoned: round.abandoned,
    ...ext().defaults.roundSummary,
  };
  if (round.scope === 'all') {
    // The decks the round asked forms of, as they were when it started.
    const ids = snapshot.order ?? Object.keys(snapshot.decks ?? {}).map(Number);
    const rows = ids.length === 0 ? [] : tx.select().from(P)
      .where(and(eq(P.userId, round.userId), inArray(P.deckId, ids)))
      .all();
    const views = ids.flatMap((deckId) => {
      const deck = snapshot.decks?.[String(deckId)];
      if (!deck) return [];
      const items = itemsFor(deck.entries, deck.settings);
      return [{ deckId, deckName: deck.name, items, settings: deck.settings, progress: progressMap(rows.filter((r) => r.deckId === deckId)) }];
    });
    return {
      ...base,
      ...masteryAcross(views),
      decks: views.map((v) => ({ deckId: v.deckId, deckName: v.deckName, ...masteryCounts(v.items, v.progress, v.settings), total: v.items.length })),
    };
  }
  const items = itemsFor(snapshot.entries, snapshot.settings);
  const rows = tx.select().from(P)
    .where(and(eq(P.userId, round.userId), eq(P.deckId, round.deckId)))
    .all();
  return {
    ...base,
    ...masteryCounts(items, progressMap(rows), snapshot.settings),
    total: items.length,
    decks: null,
  };
}

/** The caller's own round, read before its transaction (the access checks are async). */
async function findOwnRound(user: User, roundId: number): Promise<Round> {
  const round = await db.query.conjugationRounds.findFirst({ where: eq(schema.conjugationRounds.id, roundId) });
  // Someone else's round is reported like a missing one.
  if (!round || round.userId !== user.id) throw roundError('NOT_FOUND', 'Round not found', 'ROUND_NOT_FOUND');
  return round;
}

/**
 * The caller's own round, if they may still play its deck (a "Study all"
 * round: any quiz): a student taken out of the deck's group, or a quiz the
 * teacher turned off, is refused at once rather than playing on for the
 * round's 3 hours.
 */
async function playableRound(user: User, roundId: number): Promise<Round> {
  const round = await findOwnRound(user, roundId);
  await assertCanPlayRound(user, round);
  return round;
}

/** The caller's own round. */
function ownRound(tx: Tx, user: User, roundId: number): Round {
  const round = tx.select().from(schema.conjugationRounds).where(eq(schema.conjugationRounds.id, roundId)).get();
  // Someone else's round is reported like a missing one.
  if (!round || round.userId !== user.id) throw roundError('NOT_FOUND', 'Round not found', 'ROUND_NOT_FOUND');
  return round;
}

/** The caller's own round, open and in time. */
function openRound(tx: Tx, user: User, roundId: number, now: number, found?: Round): Round {
  const round = found ?? ownRound(tx, user, roundId);
  if (round.finishedAt) throw roundError('BAD_REQUEST', 'This round is over. Start a new one.', 'ROUND_FINISHED');
  if (now - round.startedAt.getTime() > ROUND_TTL_MS) {
    throw roundError('BAD_REQUEST', 'This round has expired. Start a new one.', 'ROUND_EXPIRED');
  }
  return round;
}

/** Whether a round is still open and in time (the one a student may pick up again). */
const isResumable = (round: Round, now: number) => !round.finishedAt && now - round.startedAt.getTime() <= ROUND_TTL_MS;

/** A round's prompt that waits on an answer, as the student sees it. */
function waitingPrompt(round: Round, snapshot: RoundSnapshot): ClientPrompt {
  const queue = parseQueue(round);
  const current = queue[round.position];
  if (!current?.built) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Round is damaged' });
  return clientPrompt(current, round.position, queue.length, snapshot);
}

/** What an answer gets from core (an extension may add fields: AnswerResponse). */
export interface CoreAnswerResponse {
  result: Graded['result'];
  counted: boolean;
  nearMiss: boolean;
  correctAnswer: string;
  alsoCorrect: string[];
  /** Multiple choice: the options that were right, as shown. Absent from a response stored before v1.24.0. */
  rightOptions?: string[];
  /** The persons that share the form ("tienen = ellos · ellas · ustedes"); null when none do. Absent before v1.24.0. */
  sharedBy?: SharedBy | null;
  /**
   * A prompt shown as a sentence (v1.25.0): the sentence filled in, its English (only now: it gives person and
   * tense away) and "mis primos = ellos → viven"; null for a label. Absent from a response stored before v1.25.0.
   */
  sentence?: SentenceFeedback | null;
  /** What a wrong answer (or an accent slip) most likely was, with the guide sections that explain it; null when right. */
  mistake: MistakeView | null;
  levelBefore: number;
  levelAfter: number;
  levelKindAfter: LevelKind;
  mastered: boolean;
  /** What the answer did to the item (see Outcome): 'pending' is "right; again on another day to master it". */
  outcome: Outcome;
  /** This answer mastered the item. */
  masteredNow: boolean;
  /** Right at the top, but mastery needs a right answer on another school day. */
  masteryPending: boolean;
  /** A scheduled review of a mastered form. */
  review: boolean;
  /** When a mastered item (or the "name the verb" item a review stood for) comes back, in whole days from now; null when not mastered. */
  nextReviewDays: number | null;
  requeued: boolean;
  total: number;
  next: ClientPrompt | null;
  finished: boolean;
  /** The round's score once this answer finished it, with the fields extensions add to it. */
  summary: RoundSummary | null;
  /** Conjugation sets this answer finished (every item mastered at least once), for the page and whoever listens. */
  finishedSets: { deckId: number; deckName: string }[];
}

/**
 * What an answer gets: core's fields and the answer and answerGraded hooks' (their defaults on
 * every answer, so a replay of the stored response has them too; the answer hook's values once
 * the answer finished sets, the answerGraded hook's on every newly graded answer).
 */
export type AnswerResponse = CoreAnswerResponse
  & FieldsBeside<CoreAnswerResponse, ExtensionFields['answer'] & ExtensionFields['answerGraded']>;

/** The last answer a round took, kept so that a retried request gets the same response. */
interface StoredAnswer {
  index: number;
  answer: string;
  response: AnswerResponse;
}

/** An answer as compared for a retry: the same fields, in one order. */
const answerKey = (answer: z.infer<typeof answerInput>['answer']) =>
  JSON.stringify([answer.choice ?? null, answer.text ?? null, answer.person ?? null, answer.tense ?? null]);

/**
 * The stored response when this is a retry of the answer the round took last
 * (its response was lost on the way): same index, same answer. A round since
 * replaced by a new one, or ended early, gives none.
 */
function replayOf(round: Round, input: z.infer<typeof answerInput>): AnswerResponse | null {
  if (!round.lastAnswer || input.index !== round.position - 1 || round.abandoned) return null;
  let stored: StoredAnswer;
  try {
    stored = JSON.parse(round.lastAnswer) as StoredAnswer;
  } catch {
    return null;
  }
  if (stored.index !== input.index || stored.answer !== answerKey(input.answer)) return null;
  if (round.finishedAt && !stored.response.finished) return null;
  return stored.response;
}

/**
 * A response that finished its round, with the fields extensions add to a
 * round played to its end (the roundSummary hook): asked once the answer is
 * saved, never in its transaction. Only the answer that finished the round
 * passes `record`; a retried request passes none, so an extension can tell
 * the same round the same (the stored response may predate its fields). Any
 * other response is as it was.
 */
async function withRoundFields(user: User, response: AnswerResponse, record = false): Promise<AnswerResponse> {
  if (!response.finished || !response.summary || response.summary.abandoned) return response;
  const fields: ExtensionFields['roundSummary'] = await ext().run('roundSummary', { user, roundId: response.summary.roundId, record });
  return { ...response, summary: { ...response.summary, ...fields } };
}

const answerInput = z.object({
  roundId: z.number().int(),
  index: z.number().int().min(0),
  answer: z.object({
    choice: z.string().max(MAX_ANSWER_LENGTH).optional(),
    text: z.string().max(MAX_ANSWER_LENGTH).optional(),
    person: z.string().max(20).optional(),
    tense: z.string().max(40).optional(),
  }),
  /**
   * Milliseconds from the question appearing to the answer being sent,
   * measured in the browser and stored silently (no clock is shown). Anything
   * that is no duration is ignored, never refused: a bad clock must not cost
   * an answer. Not part of the answer, so a retried request replays.
   */
  ms: z.unknown().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Teacher numbers

/** Rows of a raw SQL query, on either driver. */
const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * Days practised: distinct school days with a round played to its last
 * prompt, in any deck (a round ended after one answer does not count), all
 * told and over the last 14 days.
 *
 * Played to its end: position at the queue's length. The queue holds the
 * round's prompts and a retry per first-try miss, less retries dropped when
 * their deck left, so it is never longer than 2·prompts − first_try_correct;
 * reaching that settles almost every round without parsing its queue (about
 * 7 KB of JSON each, for every round of every student, on each results load).
 * SQLite reads the OR left to right, so only a round ended early, or one that
 * dropped a retry, has its queue parsed.
 */
export async function practiceDays(userIds: readonly number[], now = new Date()): Promise<Map<number, { days: number; days14: number }>> {
  const out = new Map<number, { days: number; days14: number }>();
  if (userIds.length === 0) return out;
  const rows = rowsOf<{ user_id: number; finished_at: number }>(await db.all(sql`
    SELECT user_id, finished_at FROM conjugation_rounds
    WHERE user_id IN (${idList(userIds)}) AND finished_at IS NOT NULL AND abandoned = 0
      AND (position >= 2 * prompts - first_try_correct OR position >= json_array_length(queue))
  `));
  const since = schoolDay(now.getTime() - 13 * DAY_MS);
  const days = new Map<number, Set<string>>();
  for (const r of rows) {
    const set = days.get(r.user_id) ?? new Set<string>();
    set.add(schoolDay(Number(r.finished_at)));
    days.set(r.user_id, set);
  }
  for (const id of userIds) {
    const set = days.get(id) ?? new Set<string>();
    out.set(id, { days: set.size, days14: [...set].filter((d) => d >= since).length });
  }
  return out;
}

/**
 * "Study all" rounds played to their end (as practiceDays counts them) that
 * asked forms of a deck, by student and deck ("user:deck"), each round once
 * per deck: a Study all round's answers count under each form's own deck,
 * and this is how many such rounds the teacher's numbers of a deck hold. Its
 * score is no deck's, so a deck's Rounds and scores leave it out.
 */
export async function studyAllRounds(userIds: readonly number[], deckIds: readonly number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0 || deckIds.length === 0) return out;
  const rows = rowsOf<{ user_id: number; deck_id: number; n: number }>(await db.all(sql`
    SELECT a.user_id AS user_id, a.deck_id AS deck_id, COUNT(DISTINCT a.round_id) AS n
    FROM conjugation_rounds r JOIN conjugation_answers a ON a.round_id = r.id
    WHERE r.user_id IN (${idList(userIds)}) AND r.scope = 'all' AND r.finished_at IS NOT NULL AND r.abandoned = 0
      AND (r.position >= 2 * r.prompts - r.first_try_correct OR r.position >= json_array_length(r.queue))
      AND a.deck_id IN (${idList(deckIds)})
    GROUP BY a.user_id, a.deck_id
  `));
  for (const r of rows) out.set(`${r.user_id}:${r.deck_id}`, Number(r.n));
  return out;
}

/**
 * Before a deck is deleted (admin.deleteDeck, in its transaction): every
 * "Study all" round it leads is led instead by the next deck that round asked
 * forms of (its snapshot's `order`, newest first; else a deck one of its
 * answers names) that is not being deleted. A round's deck_id cascades, and
 * its answers cascade from the round, so deleting the lead (say, Unit 3 to
 * import it again) would otherwise take every answer of the round with it,
 * the older units' too: their days practised, delayed accuracy, times,
 * mistakes and Study all rounds, and any pace an extension reads from them. Only the deleted
 * deck's own answers go (their deck_id cascades); a round with no other deck
 * goes with it. Returns how many rounds changed lead.
 */
export function keepStudyAllRoundsOf(tx: Tx, deckId: number): number {
  const byOrder = sql`
    SELECT d.id FROM json_each(r.settings_snapshot, '$.order') AS o JOIN decks d ON d.id = o.value
    WHERE d.id <> ${deckId} ORDER BY o.key LIMIT 1`;
  const byAnswer = sql`
    SELECT a.deck_id FROM conjugation_answers a JOIN decks d ON d.id = a.deck_id
    WHERE a.round_id = r.id AND a.deck_id <> ${deckId} ORDER BY a.id LIMIT 1`;
  const next = sql`coalesce((${byOrder}), (${byAnswer}))`;
  const result = tx.run(sql`
    UPDATE conjugation_rounds AS r SET deck_id = ${next}
    WHERE r.scope = 'all' AND r.deck_id = ${deckId} AND ${next} IS NOT NULL
  `);
  return result.changes;
}

/** A form not seen for this long before an answer makes it a delayed answer. */
export const DELAYED_GAP_MS = 7 * DAY_MS;

/**
 * Delayed accuracy: of the answers given after the student had not seen the
 * form (either direction, any deck) for 7 days or more, how many were right.
 * It predicts a test better than round scores, which reward cramming
 * (Lindsey et al. 2014). By student and deck ("user:deck"), from the gap each
 * answer stored.
 */
export async function delayedAnswers(userIds: readonly number[], deckIds: readonly number[]): Promise<Map<string, { answers: number; right: number }>> {
  const out = new Map<string, { answers: number; right: number }>();
  if (userIds.length === 0 || deckIds.length === 0) return out;
  const A = schema.conjugationAnswers;
  const rows = await db.select({
    userId: A.userId,
    deckId: A.deckId,
    n: sql<number>`count(*)`,
    ok: sql<number>`sum(CASE WHEN ${A.result} = 'correct' OR (${A.result} = 'accent' AND ${A.levelKind} != 'typed-strict') THEN 1 ELSE 0 END)`,
  }).from(A)
    .where(and(inArray(A.deckId, [...deckIds]), inArray(A.userId, [...userIds]), sql`${A.gapMs} >= ${DELAYED_GAP_MS}`))
    .groupBy(A.userId, A.deckId);
  for (const r of rows) out.set(`${r.userId}:${r.deckId}`, { answers: Number(r.n), right: Number(r.ok) });
  return out;
}

// Where an answer's time stops counting as the page's (services/conjugationQuiz.ts answerTime).
export { TIME_MISMATCH_SLACK_MS };

/**
 * "Very fast", a note for the teacher to look at (the lines are guessed, not
 * measured): a median first try under 1 s typed or 0.6 s multiple choice,
 * over at least 10 first tries of that kind.
 */
export const VERY_FAST_TYPED_MS = 1000;
export const VERY_FAST_CHOICE_MS = 600;
export const VERY_FAST_MIN_TRIES = 10;

export interface ResponseTimes {
  /** Median time used on a first try, in ms; null with none. */
  typedMs: number | null;
  choiceMs: number | null;
  /** First tries with a time, of each kind. */
  typedTries: number;
  choiceTries: number;
  /** Answers (retries too) whose page time was more than the time that passed by over TIME_MISMATCH_SLACK_MS. */
  timeMismatches: number;
  veryFast: boolean;
}

/**
 * responseTimes' answers with their gaps. The rounds come from the asked
 * decks' answers (idx_conjugation_answers_deck_item), then each round's answers
 * from idx_conjugation_answers_round; the test reads the plan.
 */
export function responseTimesQuery(userIds: readonly number[], deckIds: readonly number[]) {
  return sql`
    SELECT user_id, deck_id, level_kind, retry, ms, gap FROM (
      SELECT a.user_id AS user_id, a.deck_id AS deck_id, a.level_kind AS level_kind, a.retry AS retry, a.response_ms AS ms,
        a.at - COALESCE(LAG(a.at) OVER (PARTITION BY a.round_id ORDER BY a.id), r.started_at) AS gap
      FROM conjugation_answers a JOIN conjugation_rounds r ON r.id = a.round_id
      WHERE a.user_id IN (${idList(userIds)})
        AND a.round_id IN (SELECT round_id FROM conjugation_answers WHERE deck_id IN (${idList(deckIds)}) AND user_id IN (${idList(userIds)}))
    ) WHERE deck_id IN (${idList(deckIds)})
  `;
}

/**
 * Median response times of first tries, typed and multiple choice apart, by
 * student and deck ("user:deck").
 *
 * The time used is the page's `ms`, never more than the server's own gap: an
 * answer's `at` less the previous answer's in the same round, or less the
 * round's start for its first answer. The page's clock is honest only for an
 * honest page, and the gap also holds the feedback read and the network, so
 * honest times stay as they are while an edited `ms` is capped. With no `ms`
 * the gap stands in; a negative gap (a clock set back) is unknown.
 *
 * The gaps come from every answer of the round, before keeping this deck's:
 * an answer's deck_id is its form's deck, so a round can hold several, and
 * skipping another deck's answer would widen the gap. Rounds are walked in
 * the order the answers were stored (id), which a clock set back cannot change.
 * Only rounds holding an answer in one of these decks are walked, but every
 * answer of those rounds is, so the gaps are unchanged while the cost follows
 * these decks rather than the students' whole history (better-sqlite3 holds
 * the server while it runs, and the Results page asks for one deck).
 */
export async function responseTimes(userIds: readonly number[], deckIds: readonly number[]): Promise<Map<string, ResponseTimes>> {
  const out = new Map<string, ResponseTimes>();
  if (userIds.length === 0 || deckIds.length === 0) return out;
  const rows = rowsOf<{ user_id: number; deck_id: number; level_kind: string; retry: number; ms: number | null; gap: number | null }>(
    await db.all(responseTimesQuery(userIds, deckIds)),
  );
  const groups = new Map<string, { typed: number[]; choice: number[]; mismatches: number }>();
  for (const r of rows) {
    const key = `${r.user_id}:${r.deck_id}`;
    const group = groups.get(key) ?? { typed: [], choice: [], mismatches: 0 };
    groups.set(key, group);
    const { usedMs, mismatch } = answerTime(r.ms, r.gap);
    if (mismatch) group.mismatches += 1;
    if (usedMs === null || Number(r.retry) === 1) continue;
    (r.level_kind === 'choice' ? group.choice : group.typed).push(usedMs);
  }
  for (const [key, g] of groups) {
    const typedMs = medianOf(g.typed);
    const choiceMs = medianOf(g.choice);
    out.set(key, {
      typedMs,
      choiceMs,
      typedTries: g.typed.length,
      choiceTries: g.choice.length,
      timeMismatches: g.mismatches,
      veryFast: (typedMs !== null && g.typed.length >= VERY_FAST_MIN_TRIES && typedMs < VERY_FAST_TYPED_MS)
        || (choiceMs !== null && g.choice.length >= VERY_FAST_MIN_TRIES && choiceMs < VERY_FAST_CHOICE_MS),
    });
  }
  return out;
}

export interface MistakeCount {
  /** mistakeKey: "person:el", "regularized:yo", "dativeNumber:pl". */
  key: string;
  kind: Mistake['kind'];
  detail: Mistake['detail'];
  count: number;
  /** The commonest instance: what was given for which item, and the right form. */
  example: { given: string; itemKey: string; expected: string; prompt: string } | null;
}

interface MistakeRow { user_id: number; kind: string; detail: string | null; given: string; item_key: string; n: number }

function parseDetail(text: string | null): Mistake['detail'] {
  try {
    const parsed: unknown = JSON.parse(text ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Mistake['detail']) : {};
  } catch {
    return {};
  }
}

/** Mistake rows grouped by mistakeKey, most common first (unknown ones left out: they name nothing to teach). */
function countMistakes(rows: readonly MistakeRow[], settings: Pick<QuizSettings, 'vos'>): MistakeCount[] {
  const groups = new Map<string, MistakeCount & { best: number }>();
  for (const r of rows) {
    if (r.kind === 'unknown') continue;
    const mistake = { kind: r.kind as Mistake['kind'], detail: parseDetail(r.detail) };
    const key = mistakeKey(mistake);
    const group = groups.get(key) ?? { key, ...mistake, count: 0, example: null, best: 0 };
    group.count += Number(r.n);
    if (Number(r.n) > group.best) {
      const item = describeItem(r.item_key, settings);
      if (item) {
        group.best = Number(r.n);
        group.example = {
          given: r.given,
          itemKey: r.item_key,
          expected: item.form,
          prompt: [item.entryLabel, item.personLabel, item.tenseLabel].filter(Boolean).join(' · '),
        };
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map(({ best: _best, ...rest }) => rest);
}

/**
 * A person in the export's mistake column: the short group the teacher's pages and the export's example
 * column use ("ellos/ellas/Uds.", v1.24.0; v1.23.0 said "ellos/ellas", dropping ustedes).
 */
const PERSON_EN: Record<string, string> = { ...SHORT_PERSON_LABELS };
const CHANGE_EN: Record<string, string> = {
  yo: 'irregular yo form made regular',
  stem: 'stem change left out',
  stemEverywhere: 'stem change in nosotros too',
  spelling: 'spelling change left out',
  irregular: 'irregular verb made regular',
};

/** A mistake in words, for the teacher's export (English; the pages word it in the teacher's language). */
export function mistakeLabel(m: Pick<Mistake, 'kind' | 'detail'>): string {
  const d = m.detail;
  switch (m.kind) {
    case 'person': return `${PERSON_EN[d.person ?? ''] ?? d.person} form for another person`;
    case 'tense': return `${d.tense ? tenseLabel(d.tense) : 'another tense'} for another tense`;
    case 'regularized': return CHANGE_EN[d.change ?? ''] ?? 'verb made regular';
    case 'dativeSubject': return 'gustar-type verb conjugated for the person (gusto)';
    case 'dativeNumber': return 'gusta / gustan: number of the thing liked';
    case 'dativeSelf': return 'me gusto for me gusta';
    case 'pronounMissing': return `pronoun left out (${d.pronoun ?? ''})`;
    case 'pronounExtra': return `pronoun added (${d.pronoun ?? ''})`;
    case 'pronounWrong': return `wrong pronoun (${d.pronoun ?? ''} for ${d.expectedPronoun ?? ''})`;
    case 'impersonal': return 'hay or a weather verb given a person';
    case 'infinitive': return 'dictionary form';
    case 'otherVerb': return `another verb (${d.entry ? entryLabel(d.entry) : ''})`;
    case 'accent': return 'accent only';
    default: return 'not named';
  }
}

/** The mistakes of a deck's answers, grouped: the class's (students only), or one list per student. */
async function mistakeRows(deckId: number, userIds?: readonly number[]): Promise<MistakeRow[]> {
  const who = userIds ? sql`a.user_id IN (${idList(userIds.length > 0 ? userIds : [-1])})` : sql`u.role != 'admin'`;
  return rowsOf<MistakeRow>(await db.all(sql`
    SELECT a.user_id AS user_id, a.mistake_kind AS kind, a.mistake_detail AS detail, a.given AS given, a.item_key AS item_key, COUNT(*) AS n
    FROM conjugation_answers a JOIN users u ON u.id = a.user_id
    WHERE a.deck_id = ${deckId} AND a.mistake_kind IS NOT NULL AND ${who}
    GROUP BY a.user_id, a.mistake_kind, a.mistake_detail, a.given, a.item_key
  `));
}

/** The class's commonest mistakes in a deck (students only). */
export async function topMistakes(deckId: number, settings: Pick<QuizSettings, 'vos'>, limit = 8): Promise<MistakeCount[]> {
  return countMistakes(await mistakeRows(deckId), settings).slice(0, limit);
}

/** Each student's commonest mistake in a deck. */
export async function studentTopMistakes(deckId: number, userIds: readonly number[], settings: Pick<QuizSettings, 'vos'>): Promise<Map<number, MistakeCount>> {
  const rows = await mistakeRows(deckId, userIds);
  const out = new Map<number, MistakeCount>();
  for (const id of userIds) {
    const [top] = countMistakes(rows.filter((r) => r.user_id === id), settings);
    if (top) out.set(id, top);
  }
  return out;
}

/** "N forms due" of each student in a deck, now. */
export async function dueByStudent(state: DeckQuizState, userIds: readonly number[], now = Date.now()): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (userIds.length === 0) return out;
  const rows = await db.select().from(P).where(and(eq(P.deckId, state.deckId), inArray(P.userId, [...userIds])));
  for (const id of userIds) {
    out.set(id, dueCount(ownView(state.deckId, state.settings, state.items, rows.filter((r) => r.userId === id)), now));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Teacher settings

const tenseEnum = z.enum(TENSE_IDS as [Tense, ...Tense[]]);
const tenseList = z.array(tenseEnum).min(1).max(TENSE_IDS.length);
const entryList = z.array(z.string().trim().min(1).max(60)).max(MAX_ENTRY_LIST);

/** Canonical ids of entries a teacher typed; any that is not a Spanish verb entry is refused by name. */
function canonicalEntries(list: string[], what: string): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  for (const raw of list) {
    const id = canonicalEntryId(raw);
    if (!id) bad.push(raw);
    else if (!out.includes(id)) out.push(id);
  }
  if (bad.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${what}: not a Spanish verb (an infinitive in -ar, -er or -ír, with -se or -le, or "haber (hay)"): ${bad.join(', ')}`,
    });
  }
  return out;
}

/**
 * Whether a student has met a sentence prompt, and the subjects of their sentences (v1.25.0): the guide's
 * "Who is the subject?" opens on the first, and its table is built from the second (as the deck's bank
 * knows them, most recent first).
 */
async function sentencesMetBy(userId: number, state: DeckQuizState | undefined): Promise<{ sentenceSeen: boolean; subjectsMet: SentenceSubject[] }> {
  const A = schema.conjugationAnswers;
  const rows = db.select({ ref: A.sentenceRef }).from(A)
    .where(and(eq(A.userId, userId), isNotNull(A.sentenceRef)))
    .groupBy(A.sentenceRef)
    .orderBy(desc(sql`max(${A.at})`))
    .limit(200)
    .all();
  const refs = rows.map((r) => r.ref).filter((r): r is string => !!r);
  if (refs.length === 0) return { sentenceSeen: false, subjectsMet: [] };
  if (!state) return { sentenceSeen: true, subjectsMet: [] };
  return { sentenceSeen: true, subjectsMet: subjectsMet(refs, loadSentenceSource(db, state.deckId, state.settings, state.entries).deck) };
}

async function settingsView(deckId: number) {
  const state = await deckQuizState(deckId);
  const row = await db.query.deckConjugation.findFirst({ where: eq(schema.deckConjugation.deckId, deckId), columns: { sentencesSince: true } });
  return {
    deckId,
    deckName: state.deckName,
    settings: state.settings,
    /** When sentences last went on (v1.25.0), or null. */
    sentencesSince: row?.sentencesSince ?? null,
    entries: describeEntries(state.detected, state.settings),
    effective: state.entries,
    verbCount: state.entries.length,
    itemCount: state.items.length,
    cardCount: state.cardCount,
  };
}

export const conjugationRouter = router({
  /** The quizzes on the student's dashboard: enabled decks they can see, with their mastery and the forms due. */
  myQuizzes: protectedProcedure.query(async ({ ctx }) => {
    const deckIds = await playableDeckIds(ctx.user);
    if (deckIds.length === 0) return [];
    const progress = await db.select().from(P)
      .where(and(eq(P.userId, ctx.user.id), inArray(P.deckId, deckIds)));
    // A deck's own rounds: a "Study all" round's score is no deck's (its lead's deck_id says nothing of what it asked).
    const rounds = await db.select().from(schema.conjugationRounds)
      .where(and(
        eq(schema.conjugationRounds.userId, ctx.user.id),
        inArray(schema.conjugationRounds.deckId, deckIds),
        eq(schema.conjugationRounds.scope, 'deck'),
      ));
    const now = Date.now();
    const out = [];
    for (const deckId of deckIds) {
      const state = await deckQuizState(deckId);
      if (state.items.length === 0) continue;
      const stats = roundStats(rounds.filter((r) => r.deckId === deckId));
      const view = ownView(deckId, state.settings, state.items, progress);
      out.push({
        deckId,
        deckName: state.deckName,
        mastered: masteredCount(state.items, view.progress, state.settings),
        total: state.items.length,
        lastScore: stats.lastScore,
        /** "N forms due": mastered forms of this deck that are due for review. */
        due: dueCount(view, now),
      });
    }
    return out.sort((a, b) => a.deckName.localeCompare(b.deckName, undefined, { numeric: true, sensitivity: 'base' }));
  }),

  /** One deck's quiz before a round: what it drills and where the student stands. */
  overview: protectedProcedure
    .input(z.object({ deckId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertCanPlay(ctx.user, input.deckId);
      const state = await deckQuizState(input.deckId);
      const rows = await db.select().from(P)
        .where(and(eq(P.userId, ctx.user.id), eq(P.deckId, input.deckId)));
      const progress = progressMap(rows);
      // This deck's own rounds: a "Study all" round it leads is offered and scored on the Study all page.
      const rounds = await db.select().from(schema.conjugationRounds)
        .where(and(
          eq(schema.conjugationRounds.userId, ctx.user.id),
          eq(schema.conjugationRounds.deckId, input.deckId),
          eq(schema.conjugationRounds.scope, 'deck'),
        ));
      const stats = roundStats(rounds);
      const answered = await db.selectDistinct({ levelKind: schema.conjugationAnswers.levelKind }).from(schema.conjugationAnswers)
        .where(eq(schema.conjugationAnswers.userId, ctx.user.id));
      const now = Date.now();
      const open = rounds.filter((r) => isResumable(r, now)).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
      const { settings } = state;
      return {
        deckId: state.deckId,
        deckName: state.deckName,
        enabled: settings.enabled,
        tenses: settings.tenses.map((id) => ({ id, label: tenseLabel(id) })),
        includeVosotros: settings.includeVosotros,
        vos: settings.vos,
        directions: settings.directions,
        answerMode: settings.answerMode,
        accentMode: settings.accentMode,
        roundLength: settings.roundLength,
        levels: state.steps,
        /** The rungs the student has answered at, for which parts of the guide are open. */
        reachedRungs: reachedRungs(answered.map((a) => a.levelKind), rows, state.steps),
        /** v1.25.0: the student has met a sentence prompt, and the subjects of their sentences (the guide's "Who is the subject?"). */
        ...(await sentencesMetBy(ctx.user.id, state)),
        verbs: state.entries.map((entry) => {
          const mine = state.items.filter((i) => i.entry === entry);
          return {
            entry,
            // The student's name of the verb: "haber", never "haber (hay)", which
            // answers the present-tense prompt; `kind` says it is impersonal.
            label: promptEntryName(entry),
            kind: entryKind(entry),
            mastered: masteredCount(mine, progress, settings),
            total: mine.length,
          };
        }),
        // Mastered, "need one more day" and "on the way up".
        ...masteryCounts(state.items, progress, settings),
        total: state.items.length,
        /** "N forms due": mastered forms of this deck that are due for review. */
        due: dueCount({ deckId: state.deckId, settings, items: state.items, progress }, now),
        ...stats,
        /** The round left open, to continue with `current`; `start` replaces it. */
        openRound: open
          ? { roundId: open.id, index: open.position, total: parseQueue(open).length, answers: open.answers, startedAt: open.startedAt }
          : null,
      };
    }),

  /**
   * "Study all" before a round (v1.18.0): the quizzes it mixes, newest first,
   * each with the student's mastery and forms due; the same over all of them
   * (each form once); what the guide reads (the decks' settings merged: every
   * tense, vos and vosotros if any deck has them); the student's Study all
   * scores, the round left open, and what extensions add. No quiz to play: an
   * empty list, for the page to say so.
   */
  studyAllOverview: protectedProcedure.query(async ({ ctx }) => {
    const states = await studyAllStates(ctx.user);
    const R = schema.conjugationRounds;
    const rounds = await db.select().from(R).where(and(eq(R.userId, ctx.user.id), eq(R.scope, 'all')));
    const stats = roundStats(rounds);
    const now = Date.now();
    const open = rounds.filter((r) => isResumable(r, now)).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    const deckIds = states.map((s) => s.deckId);
    const rows = deckIds.length === 0 ? [] : await db.select().from(P)
      .where(and(eq(P.userId, ctx.user.id), inArray(P.deckId, deckIds)));
    const answered = await db.selectDistinct({ levelKind: schema.conjugationAnswers.levelKind }).from(schema.conjugationAnswers)
      .where(eq(schema.conjugationAnswers.userId, ctx.user.id));
    const views = states.map((s) => ({ state: s, view: ownView(s.deckId, s.settings, s.items, rows) }));
    const lead = states[0];

    // What the guide reads: the decks' settings merged.
    const same = <T>(values: readonly T[], fallback: T): T => (values.length > 0 && values.every((v) => v === values[0]) ? values[0] : fallback);
    const tenses = orderTenses(states.flatMap((s) => s.settings.tenses));
    const reached = new Set(views.flatMap(({ state, view }) => reachedRungs(answered.map((a) => a.levelKind), rows.filter((r) => r.deckId === view.deckId), state.steps)));
    const entries = [...new Set(states.flatMap((s) => s.entries))];
    const dueCells = new Set(views.flatMap(({ view }) => dueEntries(view, now).map((d) => cellKey(d.item))));
    const overview = {
      scope: 'all' as const,
      /** The lead deck (the newest), whose id a round keeps; null with no quiz. */
      deckId: lead?.deckId ?? null,
      deckName: lead?.deckName ?? '',
      roundLength: STUDY_ALL_LENGTH,
      /** The quizzes a round mixes, newest first, each with its own mastery and forms due. */
      decks: views.map(({ state, view }) => ({
        deckId: state.deckId,
        deckName: state.deckName,
        ...masteryCounts(state.items, view.progress, state.settings),
        total: state.items.length,
        due: dueCount(view, now),
      })),
      // Over all of them, each form once.
      ...masteryAcross(views.map(({ view }) => view)),
      /** "N forms due": mastered forms due for review, in any of the quizzes (each once). */
      due: dueCells.size,
      tenses: tenses.map((id) => ({ id, label: tenseLabel(id) })),
      includeVosotros: states.some((s) => s.settings.includeVosotros),
      vos: (states.find((s) => s.settings.vos !== 'none')?.settings.vos ?? 'none') as VosSetting,
      directions: same<DirectionSetting>(states.map((s) => s.settings.directions), 'both'),
      accentMode: same<AccentMode>(states.map((s) => s.settings.accentMode), 'progressive'),
      levels: RUNGS.filter((rung) => states.some((s) => s.steps.includes(rung))),
      reachedRungs: RUNGS.filter((rung) => reached.has(rung)),
      ...(await sentencesMetBy(ctx.user.id, lead)),
      verbs: entries.map((entry) => {
        const counts = masteryAcross(views.map(({ view }) => ({ ...view, items: view.items.filter((i) => i.entry === entry) })));
        return { entry, label: promptEntryName(entry), kind: entryKind(entry), mastered: counts.mastered, total: counts.total };
      }),
      ...stats,
      /** The Study all round left open, to continue with `current`; `startAll` replaces it. */
      openRound: open
        ? { roundId: open.id, index: open.position, total: parseQueue(open).length, answers: open.answers, startedAt: open.startedAt }
        : null,
    };
    // What extensions add (the studyAllOverview hook): last, as before; none may take a core field's name.
    const fields = await ext().run('studyAllOverview', { user: ctx.user, now: new Date(now) });
    return { ...overview, ...fieldsBeside(overview, fields, 'conjugation.studyAllOverview') };
  }),

  /**
   * Starts a round, replacing any round of this deck the student left
   * unfinished. Up to a quarter of it are due reviews from any of the
   * student's quizzes (planRound).
   */
  start: protectedProcedure
    .input(z.object({ deckId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanPlay(ctx.user, input.deckId);
      const state = await deckQuizState(input.deckId);
      if (state.items.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This deck has no verbs to practice yet', cause: { appCode: 'CONJUGATION_EMPTY' } });
      }
      // Reviews come only from quizzes the student may play now: nothing of a deck they cannot see.
      const otherIds = (await playableDeckIds(ctx.user)).filter((id) => id !== input.deckId);
      const others = (await Promise.all(otherIds.map((id) => deckQuizState(id)))).filter((s) => s.items.length > 0);
      const snapshot = snapshotOf(state.settings, state.entries);
      const rand = Math.random;
      const now = new Date();
      const result = db.transaction((tx) => {
        const rows = tx.select().from(P).where(eq(P.userId, ctx.user.id)).all();
        const known = new Map<number, QuizSettings>([[state.deckId, state.settings], ...others.map((o) => [o.deckId, o.settings] as const)]);
        const settingsOf = settingsById(tx, rows.map((r) => r.deckId), known);
        const byKey = new Map<string, TwinRow[]>();
        for (const r of rows) byKey.set(r.itemKey, [...(byKey.get(r.itemKey) ?? []), { deckId: r.deckId, state: stateOf(r) }]);
        const lookup = (id: number) => settingsOf.get(id) ?? parseSettings(null);
        const current = deckView(state.deckId, state.settings, state.items, byKey, lookup);
        const views = new Map<number, PlanDeck>([[state.deckId, current]]);
        for (const o of others) views.set(o.deckId, deckView(o.deckId, o.settings, o.items, byKey, lookup));
        const plan = planRound({
          current,
          others: [...views.values()].filter((v) => v.deckId !== state.deckId),
          length: state.settings.roundLength,
          today: schoolDay(now),
          now: now.getTime(),
          rand,
        });
        snapshot.review = plan.review;
        for (const deckId of new Set(plan.items.map((p) => p.deckId).filter((id) => id !== state.deckId))) {
          const other = others.find((o) => o.deckId === deckId) as DeckQuizState;
          (snapshot.decks ??= {})[String(deckId)] = { name: other.deckName, ...snapshotOf(other.settings, other.entries) };
        }
        const queue: QueueEntry[] = plan.items.map(({ deckId, slot, via, carried, ...item }) => ({
          ...item,
          ...(deckId !== state.deckId ? { deckId } : {}),
          ...(slot === 'review' ? { review: true } : {}),
          ...(via ? { via } : {}),
          ...(carried ? { carried: true } : {}),
        }));
        snapshot.subjectsSeen = subjectsSeenFor(tx, ctx.user.id, queue);
        snapshot.sentencesSeen = sentencesSeenFor(tx, ctx.user.id, queue, snapshot);
        const first = queue[0];
        first.built = buildPrompt(first, startLevel(views.get(first.deckId ?? state.deckId) as PlanDeck, first), snapshot, rand,
          turnsFor(tx, ctx.user.id, queue, 0, snapshot, state.deckId, now.getTime()));
        // This deck's own round left open, never a "Study all" round it happens to lead.
        tx.update(schema.conjugationRounds)
          .set({ finishedAt: now, abandoned: true })
          .where(and(
            eq(schema.conjugationRounds.userId, ctx.user.id),
            eq(schema.conjugationRounds.deckId, input.deckId),
            eq(schema.conjugationRounds.scope, 'deck'),
            isNull(schema.conjugationRounds.finishedAt),
          ))
          .run();
        const [round] = tx.insert(schema.conjugationRounds).values({
          userId: ctx.user.id,
          deckId: input.deckId,
          startedAt: now,
          queue: JSON.stringify(queue),
          position: 0,
          prompts: queue.length,
          settingsSnapshot: JSON.stringify(snapshot),
        }).returning().all();
        return { round, queue, review: plan.review };
      });
      return {
        roundId: result.round.id,
        scope: 'deck' as 'deck' | 'all',
        deckId: input.deckId,
        deckName: state.deckName,
        total: result.queue.length,
        review: result.review,
        /** Prompts that bring back mastered forms (of this deck or another). */
        reviews: result.queue.filter((e) => e.review).length,
        levels: state.steps,
        index: 0,
        answers: 0,
        firstTryCorrect: 0,
        prompt: clientPrompt(result.queue[0], 0, result.queue.length, snapshot),
      };
    }),

  /**
   * Starts a "Study all" round (v1.18.0): STUDY_ALL_LENGTH prompts from every
   * quiz the student may play, due forms first, then forms in progress, then
   * new ones, newest deck first (planAllRound). Each prompt is asked, graded
   * and written back under its own deck. Replaces the student's "Study all"
   * round left unfinished, never a deck's own. The round's deck is its lead,
   * the newest of those decks; played to its end, extensions hear of it
   * (the roundSummary hook).
   */
  startAll: protectedProcedure
    .mutation(async ({ ctx }) => {
      const states = await studyAllStates(ctx.user);
      if (states.length === 0) {
        // Quizzes turned on, but none with verbs yet: as a deck with none says it.
        if ((await playableDeckIds(ctx.user)).length > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'There are no verbs to practice yet', cause: { appCode: 'CONJUGATION_EMPTY' } });
        }
        throw noQuizError();
      }
      const lead = states[0];
      const rand = Math.random;
      const now = new Date();
      const result = db.transaction((tx) => {
        const rows = tx.select().from(P).where(eq(P.userId, ctx.user.id)).all();
        const known = new Map<number, QuizSettings>(states.map((s) => [s.deckId, s.settings] as const));
        const settingsOf = settingsById(tx, rows.map((r) => r.deckId), known);
        const byKey = new Map<string, TwinRow[]>();
        for (const r of rows) byKey.set(r.itemKey, [...(byKey.get(r.itemKey) ?? []), { deckId: r.deckId, state: stateOf(r) }]);
        const lookup = (id: number) => settingsOf.get(id) ?? parseSettings(null);
        const views = new Map<number, PlanDeck>(states.map((s) => [s.deckId, deckView(s.deckId, s.settings, s.items, byKey, lookup)]));
        const plan = planAllRound({
          decks: [...views.values()],
          length: STUDY_ALL_LENGTH,
          today: schoolDay(now),
          now: now.getTime(),
          rand,
        });
        // The lead's snapshot on top (what an entry with no deck would use; every entry names its deck),
        // and each deck the round asks forms of, newest first.
        const snapshot: RoundSnapshot = { ...snapshotOf(lead.settings, lead.entries), review: plan.review, decks: {}, order: [] };
        const used = new Set(plan.items.map((p) => p.deckId));
        for (const s of states) {
          if (!used.has(s.deckId)) continue;
          (snapshot.decks ??= {})[String(s.deckId)] = { name: s.deckName, ...snapshotOf(s.settings, s.entries) };
          snapshot.order?.push(s.deckId);
        }
        const queue: QueueEntry[] = plan.items.map(({ deckId, slot, via, carried, ...item }) => ({
          ...item,
          deckId,
          ...(slot === 'review' ? { review: true } : {}),
          ...(via ? { via } : {}),
          ...(carried ? { carried: true } : {}),
        }));
        const first = queue[0];
        if (!first) throw new TRPCError({ code: 'BAD_REQUEST', message: 'There are no verbs to practice yet', cause: { appCode: 'CONJUGATION_EMPTY' } });
        snapshot.subjectsSeen = subjectsSeenFor(tx, ctx.user.id, queue);
        snapshot.sentencesSeen = sentencesSeenFor(tx, ctx.user.id, queue, snapshot);
        first.built = buildPrompt(first, startLevel(views.get(first.deckId as number) as PlanDeck, first), snapshot, rand,
          turnsFor(tx, ctx.user.id, queue, 0, snapshot, lead.deckId, now.getTime()));
        tx.update(schema.conjugationRounds)
          .set({ finishedAt: now, abandoned: true })
          .where(and(
            eq(schema.conjugationRounds.userId, ctx.user.id),
            eq(schema.conjugationRounds.scope, 'all'),
            isNull(schema.conjugationRounds.finishedAt),
          ))
          .run();
        const [round] = tx.insert(schema.conjugationRounds).values({
          userId: ctx.user.id,
          deckId: lead.deckId,
          scope: 'all',
          startedAt: now,
          queue: JSON.stringify(queue),
          position: 0,
          prompts: queue.length,
          settingsSnapshot: JSON.stringify(snapshot),
        }).returning().all();
        return { round, queue, snapshot, review: plan.review };
      });
      return {
        roundId: result.round.id,
        scope: 'all' as 'deck' | 'all',
        /** The round's lead: the newest deck with a quiz the student may play. */
        deckId: lead.deckId,
        deckName: lead.deckName,
        total: result.queue.length,
        review: result.review,
        /** Prompts that bring back mastered forms. */
        reviews: result.queue.filter((e) => e.review).length,
        levels: lead.steps,
        index: 0,
        answers: 0,
        firstTryCorrect: 0,
        prompt: clientPrompt(result.queue[0], 0, result.queue.length, result.snapshot),
      };
    }),

  /**
   * Answers the prompt the round is waiting on, graded here under the item's
   * own deck. A miss comes back once at the end of the round. The next prompt
   * is built only now, at the level the item has reached.
   */
  answer: protectedProcedure
    .input(answerInput)
    .mutation(async ({ ctx, input }) => {
      const mine = await findOwnRound(ctx.user, input.roundId);
      // A retry of an answer already taken still gets its response; a new answer needs the deck.
      const replayed = replayOf(mine, input);
      if (replayed) return await withRoundFields(ctx.user, replayed);
      await assertCanPlayRound(ctx.user, mine);
      // A review (in a "Study all" round, any prompt) from a deck the student may no longer play is dropped before it is shown.
      const origins = new Set(parseQueue(mine).map((e) => e.deckId).filter((id): id is number => id !== undefined));
      const playable = origins.size > 0 ? new Set(await playableDeckIds(ctx.user)) : new Set<number>();
      const mayShow = (e: QueueEntry) => e.deckId === undefined || ctx.user.role === 'admin' || playable.has(e.deckId);
      const now = new Date();
      const ms = responseMs(input.ms);
      const firsts: number[] = [];
      // The grading facts of a newly stored answer, for the answerGraded hook (null for a replay).
      const newlyGraded: { facts: Omit<HookContexts['answerGraded'], 'user' | 'now'> | null } = { facts: null };
      const response = db.transaction((tx): AnswerResponse => {
        const found = ownRound(tx, ctx.user, input.roundId);
        const replay = replayOf(found, input);
        if (replay) return replay;
        const round = openRound(tx, ctx.user, input.roundId, now.getTime(), found);
        if (input.index !== round.position) {
          throw roundError('CONFLICT', 'That question was already answered. Reload the round.', 'ROUND_OUT_OF_SYNC');
        }
        const snapshot = parseSnapshot(round);
        const queue = parseQueue(round);
        const current = queue[round.position];
        if (!current?.built) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Round is damaged' });

        let graded: Graded;
        try {
          graded = gradeAnswer(current, input.answer, snapshot);
        } catch (err) {
          if (err instanceof AnswerShapeError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
          throw err;
        }

        // The item's own deck: its settings, its progress.
        const deckId = current.deckId ?? round.deckId;
        const deck: DeckSnapshot = entrySnapshot(snapshot, current);
        const steps = itemLadder(deck.settings, current.direction);
        // A review whose deck was deleted while it waited: graded, but there is nowhere to keep it
        // (its rows went with the deck, and a new one would break the foreign key on every try).
        const deckGone = current.deckId !== undefined
          && !tx.select({ id: schema.decks.id }).from(schema.decks).where(eq(schema.decks.id, deckId)).get();
        const gapMs = sinceLastSeen(tx, ctx.user.id, current.key, now);
        const levelBefore = current.built.level;
        let after: ProgressState;
        let outcome: Outcome;
        if (deckGone) {
          after = { level: clampLevel(levelBefore, steps), mastered: false };
          outcome = graded.counted ? 'up' : 'down';
        } else {
          const start = startOf(tx, ctx.user.id, deckId, current, deck.settings);
          ({ state: after, outcome } = advance(start.state, steps, graded.counted, {
            today: schoolDay(now),
            now: now.getTime(),
            carried: start.carried,
            carriedFrom: start.carriedFrom,
          }));
          firsts.push(...storeProgress(tx, {
            userId: ctx.user.id, deckId, key: current.key, direction: current.direction, settings: deck.settings, state: after, now,
            answer: { counted: graded.counted },
          }));
        }
        const rowOf = (key: string) => tx.select().from(P).where(and(eq(P.userId, ctx.user.id), eq(P.deckId, deckId), eq(P.itemKey, key))).get();
        let nextDue = after.mastered ? after.dueAt ?? null : null;
        // A "name the verb" item reviewed by producing its form.
        if (!deckGone && current.via && !current.retry) {
          const via = rowOf(current.via);
          const reviewed = via ? reviewThrough(stateOf(via), graded.counted, now.getTime()) : null;
          if (reviewed) {
            // Its twins in other decks take the state too, and one can be the last form of that deck's set.
            firsts.push(...storeProgress(tx, { userId: ctx.user.id, deckId, key: current.via, direction: 'from', settings: deck.settings, state: reviewed, now }));
            nextDue ??= reviewed.dueAt ?? null;
          }
        }
        // Both directions of a mastered form share the "give the form" schedule.
        if (!deckGone && current.direction === 'to' && (outcome === 'mastered' || outcome === 'reviewed')) {
          const sibling = rowOf(siblingKey(current.key));
          if (sibling && isMastered(stateOf(sibling), FROM_LADDER)) {
            firsts.push(...storeProgress(tx, {
              userId: ctx.user.id, deckId, key: sibling.itemKey, direction: 'from', settings: deck.settings, now,
              state: { ...stateOf(sibling), dueAt: after.dueAt ?? null, reviewStep: after.reviewStep ?? 0 },
            }));
          }
        }
        let answerId: number | null = null;
        // The answer's time as the round's pace reads it: the page's, never more than the gap since
        // the round's previous stored answer (or its start).
        const previousAt = tx.select({ at: schema.conjugationAnswers.at }).from(schema.conjugationAnswers)
          .where(eq(schema.conjugationAnswers.roundId, round.id))
          .orderBy(desc(schema.conjugationAnswers.id))
          .limit(1)
          .get()?.at ?? round.startedAt;
        const time = answerTime(ms, now.getTime() - previousAt.getTime());
        if (!deckGone) {
          [{ id: answerId }] = tx.insert(schema.conjugationAnswers).values({
            roundId: round.id,
            userId: ctx.user.id,
            deckId,
            itemKey: current.key,
            levelKind: current.built.levelKind,
            given: graded.given,
            result: graded.result,
            at: now,
            responseMs: ms,
            mistakeKind: graded.mistake?.kind ?? null,
            mistakeDetail: graded.mistake ? JSON.stringify(graded.mistake.detail) : null,
            retry: !!current.retry,
            review: !!current.review,
            gapMs,
            subjectShown: current.built.subject ?? null,
            sentenceRef: current.built.sentence?.ref ?? null,
            holdbackArm: current.built.holdback?.arm ?? null,
            holdbackProbe: !!current.built.holdback?.probe,
          }).returning({ id: schema.conjugationAnswers.id }).all();
        }

        const requeued = !graded.counted && !current.retry;
        const nextQueue = requeue(queue, round.position, graded.counted);
        const position = round.position + 1;
        let prompts = round.prompts;
        while (position < nextQueue.length && !mayShow(nextQueue[position])) {
          if (!nextQueue[position].retry) prompts -= 1;
          nextQueue.splice(position, 1);
        }
        const finished = position >= nextQueue.length;
        if (!finished) {
          const upcoming = nextQueue[position];
          const upcomingDeck = entrySnapshot(snapshot, upcoming);
          const level = levelNow(tx, ctx.user.id, upcoming.deckId ?? round.deckId, upcoming, upcomingDeck.settings);
          upcoming.built = buildPrompt(upcoming, level, snapshot, Math.random, turnsFor(tx, ctx.user.id, nextQueue, position, snapshot, round.deckId, now.getTime()));
        }
        const firstTryCorrect = round.firstTryCorrect + (graded.counted && !current.retry ? 1 : 0);
        const [updated] = tx.update(schema.conjugationRounds)
          .set({
            queue: JSON.stringify(nextQueue),
            position,
            prompts,
            answers: round.answers + 1,
            firstTryCorrect,
            ...(finished ? { finishedAt: now } : {}),
          })
          .where(eq(schema.conjugationRounds.id, round.id))
          .returning()
          .all();

        if (answerId !== null) {
          newlyGraded.facts = {
            answerId,
            roundId: round.id,
            scope: round.scope,
            position: updated.position,
            prompts: updated.prompts,
            levelKind: current.built.levelKind,
            result: graded.result,
            counted: graded.counted,
            retry: !!current.retry,
            review: !!current.review,
            outcome,
            usedMs: time.usedMs,
            timeMismatch: time.mismatch,
            finished,
            playedToEnd: finished && playedToEnd(updated),
          };
        }
        const next: ClientPrompt | null = finished ? null : clientPrompt(nextQueue[position], position, nextQueue.length, snapshot);
        const answerResponse: AnswerResponse = {
          result: graded.result,
          counted: graded.counted,
          nearMiss: graded.nearMiss,
          correctAnswer: graded.correctAnswer,
          alsoCorrect: graded.alsoCorrect,
          rightOptions: graded.rightOptions,
          sharedBy: graded.sharedBy,
          sentence: graded.sentence,
          mistake: mistakeView(graded.mistake, current),
          levelBefore: clampLevel(levelBefore, steps),
          levelAfter: after.level,
          levelKindAfter: steps[after.level],
          mastered: after.mastered,
          outcome,
          masteredNow: outcome === 'mastered',
          masteryPending: outcome === 'pending',
          review: !!current.review,
          // Days on the calendar: a form due next Friday is 7 days away, answered at 8 am or at 2 pm.
          nextReviewDays: nextDue === null ? null : schoolDaysUntil(nextDue, now.getTime()),
          requeued,
          total: nextQueue.length,
          next,
          finished,
          summary: finished ? summaryOf(tx, updated, snapshot) : null,
          finishedSets: [],
          ...ext().defaults.answer,
          ...ext().defaults.answerGraded,
        };
        const stored: StoredAnswer = { index: input.index, answer: answerKey(input.answer), response: answerResponse };
        tx.update(schema.conjugationRounds)
          .set({ lastAnswer: JSON.stringify(stored) })
          .where(eq(schema.conjugationRounds.id, round.id))
          .run();
        return answerResponse;
      });

      // What extensions add to a newly graded answer (the answerGraded hook), then to the sets it
      // finished (the answer hook): both before the response is stored again, so a replay gets the same.
      let restore = false;
      const facts = newlyGraded.facts;
      if (facts && ctx.user.role !== 'admin') {
        const fields = await ext().run('answerGraded', { user: ctx.user, now, ...facts });
        // Stored again only when a hook had something to tell: nothing is written for "nothing to tell".
        if (JSON.stringify(fields) !== JSON.stringify(ext().defaults.answerGraded)) {
          Object.assign(response, fields);
          restore = true;
        }
      }
      // Sets finished by this answer: told to the student, to extensions and to whoever listens.
      const sets = firsts.length > 0 && ctx.user.role !== 'admin' ? await finishedSets(ctx.user.id, firsts) : [];
      if (sets.length > 0) {
        response.finishedSets = sets;
        Object.assign(response, await ext().run('answer', { user: ctx.user, sets, now }));
        restore = true;
      }
      if (restore) {
        const stored: StoredAnswer = { index: input.index, answer: answerKey(input.answer), response };
        // Only while it is still the round's last answer: a quicker next answer keeps its own.
        await db.update(schema.conjugationRounds).set({ lastAnswer: JSON.stringify(stored) })
          .where(and(eq(schema.conjugationRounds.id, input.roundId), eq(schema.conjugationRounds.position, input.index + 1)));
      }
      for (const set of sets) {
        logger.info({ event: 'conjugation.set_finished', userId: ctx.user.id, deckId: set.deckId }, 'Conjugation set finished');
        for (const listener of setFinishedListeners) {
          try {
            await listener({ userId: ctx.user.id, deckId: set.deckId, deckName: set.deckName, at: now });
          } catch (err) {
            logger.error({ err, event: 'conjugation.set_finished_listener', userId: ctx.user.id, deckId: set.deckId }, 'Set-finished listener failed');
          }
        }
      }
      // The round finished just now: by this answer, or by a copy of it sent at the same moment (replayed in the transaction).
      return await withRoundFields(ctx.user, response, true);
    }),

  /**
   * The prompt an open round waits on, to pick the round up again (a reload,
   * a lost response): the same prompt as first sent, and where the round stands.
   */
  current: protectedProcedure
    .input(z.object({ roundId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await playableRound(ctx.user, input.roundId);
      return db.transaction((tx) => {
        const round = openRound(tx, ctx.user, input.roundId, Date.now());
        const snapshot = parseSnapshot(round);
        const deck = tx.select({ name: schema.decks.name }).from(schema.decks).where(eq(schema.decks.id, round.deckId)).get();
        const prompt = waitingPrompt(round, snapshot);
        return {
          roundId: round.id,
          scope: round.scope as 'deck' | 'all',
          deckId: round.deckId,
          deckName: deck?.name ?? '',
          total: prompt.total,
          review: !!snapshot.review,
          /** Prompts that bring back mastered forms, as `start` counted them. */
          reviews: parseQueue(round).filter((e) => e.review && !e.retry).length,
          levels: snapshot.steps,
          index: round.position,
          answers: round.answers,
          firstTryCorrect: round.firstTryCorrect,
          prompt,
        };
      });
    }),

  /**
   * Reports a round's score once its last answer has finished it, with the
   * fields extensions add (the roundSummary hook, record false: what that
   * answer recorded, never a new one). A round still open (the page never
   * asks for that; only a console does) or expired is ended here as
   * abandoned: it was left, not played to its end, so it is no score and no
   * round, and no extension is asked.
   */
  finish: protectedProcedure
    .input(z.object({ roundId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await playableRound(ctx.user, input.roundId);
      const now = new Date();
      const summary = db.transaction((tx) => {
        let round = tx.select().from(schema.conjugationRounds).where(eq(schema.conjugationRounds.id, input.roundId)).get();
        if (!round || round.userId !== ctx.user.id) throw roundError('NOT_FOUND', 'Round not found', 'ROUND_NOT_FOUND');
        if (!round.finishedAt) {
          [round] = tx.update(schema.conjugationRounds)
            .set({ finishedAt: now, abandoned: true })
            .where(eq(schema.conjugationRounds.id, round.id))
            .returning()
            .all();
        }
        return summaryOf(tx, round, parseSnapshot(round));
      });
      if (!summary.abandoned) {
        Object.assign(summary, await ext().run('roundSummary', { user: ctx.user, roundId: input.roundId, record: false }));
      }
      return summary;
    }),

  /**
   * "Something's wrong with this sentence" (v1.25.0): the student reports the sentence of a prompt of their
   * own round that they have answered. It only queues the sentence for the teacher (once per student and
   * sentence); nothing changes for anyone until the teacher acts.
   */
  reportSentence: protectedProcedure
    .input(z.object({ roundId: z.number().int(), index: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const round = await findOwnRound(ctx.user, input.roundId);
      const entry = parseQueue(round)[input.index];
      const sentence = entry?.built?.sentence;
      if (!entry || !sentence || input.index >= round.position) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'There is no answered sentence to report here' });
      }
      const deckId = entry.deckId ?? round.deckId;
      const deck = await db.query.decks.findFirst({ where: eq(schema.decks.id, deckId), columns: { id: true } });
      if (!deck) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
      const result = db.insert(schema.conjugationSentenceReports).values({
        deckId,
        userId: ctx.user.id,
        sentenceRef: sentence.ref,
        itemKey: entry.key,
        sentence: blankText(sentence),
        createdAt: new Date(),
      }).onConflictDoNothing().run();
      if (result.changes > 0) {
        logger.info({ event: 'conjugation.sentence_reported', userId: ctx.user.id, deckId, ref: sentence.ref }, 'Conjugation sentence reported');
      }
      return { reported: true };
    }),

  // -------------------------------------------------------------------------
  // Teacher

  /** The quiz settings of a deck, with the verbs found in it. */
  settings: adminProcedure
    .input(z.object({ deckId: z.number().int() }))
    .query(({ input }) => settingsView(input.deckId)),

  /** Saves a deck's settings; fields left out keep their value. */
  saveSettings: adminProcedure
    .input(z.object({
      deckId: z.number().int(),
      enabled: z.boolean().optional(),
      tenses: tenseList.optional(),
      includeVosotros: z.boolean().optional(),
      vos: z.enum(VOS_SETTINGS).optional(),
      directions: z.enum(DIRECTION_SETTINGS).optional(),
      answerMode: z.enum(ANSWER_MODES).optional(),
      accentMode: z.enum(ACCENT_MODES).optional(),
      roundLength: z.number().int().min(ROUND_LENGTH_MIN).max(ROUND_LENGTH_MAX).optional(),
      excludedEntries: entryList.optional(),
      extraEntries: entryList.optional(),
      /** v1.25.0: how "give the form" prompts are shown ('off', 'builtIn', 'approved', 'both'). */
      sentences: z.enum(SENTENCE_MODES).optional(),
      /** v1.25.0: the holdback measurement (half of each student's verbs keep the label). */
      sentenceHoldback: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await findDeck(input.deckId);
      const current = await settingsFor(input.deckId);
      const next: QuizSettings = {
        enabled: input.enabled ?? current.enabled,
        tenses: input.tenses ? orderTenses(input.tenses) : current.tenses,
        includeVosotros: input.includeVosotros ?? current.includeVosotros,
        vos: input.vos ?? current.vos,
        directions: input.directions ?? current.directions,
        answerMode: input.answerMode ?? current.answerMode,
        accentMode: input.accentMode ?? current.accentMode,
        roundLength: input.roundLength ?? current.roundLength,
        excludedEntries: input.excludedEntries ? canonicalEntries(input.excludedEntries, 'Left out') : current.excludedEntries,
        extraEntries: input.extraEntries ? canonicalEntries(input.extraEntries, 'Added') : current.extraEntries,
        sentences: input.sentences ?? current.sentences,
        sentenceHoldback: input.sentenceHoldback ?? current.sentenceHoldback,
      };
      const now = new Date();
      // The day sentences went on, for the results page (a change of format shows as a short dip there).
      const turnedOn = current.sentences === 'off' && next.sentences !== 'off';
      const row = { ...settingsToRow(next), updatedAt: now, ...(turnedOn ? { sentencesSince: now } : {}) };
      db.insert(schema.deckConjugation).values({ deckId: input.deckId, ...row })
        .onConflictDoUpdate({ target: schema.deckConjugation.deckId, set: row })
        .run();
      logger.info({
        event: 'conjugation.settings_saved', deckId: input.deckId, userId: ctx.user.id, enabled: next.enabled,
        sentences: next.sentences, sentenceHoldback: next.sentenceHoldback,
      }, 'Conjugation settings saved');
      return settingsView(input.deckId);
    }),

  /** Every cell of one entry with its forms, for the teacher to check before students see it. */
  preview: adminProcedure
    .input(z.object({
      entry: z.string().trim().min(1).max(60),
      tenses: tenseList,
      vosotros: z.boolean().default(false),
      vos: z.enum(VOS_SETTINGS).default('none'),
    }))
    .query(({ input }) => {
      const entry = canonicalEntryId(input.entry);
      if (!entry) throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a Spanish verb: ${input.entry}` });
      const known = isKnownVerb(entry);
      return {
        entry,
        label: entryLabel(entry),
        kind: entryKind(entry),
        known,
        note: known ? null : NOTE_UNKNOWN,
        cells: previewEntry(entry, { tenses: orderTenses(input.tenses), includeVosotros: input.vosotros, vos: input.vos }),
      };
    }),

  /** The teacher's Sentences panel (v1.25.0): routers/conjugationSentences.ts. */
  sentences: sentencesRouter({ deckQuizState }),

  /**
   * Scores per student, the items missed most, and the numbers that predict a
   * test: days practised, accuracy on forms not seen for a week, response
   * times, forms due, and the class's commonest mistakes. Teachers' own runs
   * are marked.
   */
  results: adminProcedure
    .input(z.object({ deckId: z.number().int() }))
    .query(async ({ input }) => {
      const state = await deckQuizState(input.deckId);
      const columns = { id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role };
      const withAccess = await db.selectDistinct(columns)
        .from(schema.users)
        .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
        .innerJoin(schema.deckGroups, eq(schema.deckGroups.groupId, schema.userGroups.groupId))
        .where(and(eq(schema.deckGroups.deckId, input.deckId), ne(schema.users.role, 'admin')));
      // This deck's own rounds; "Study all" rounds count under each form's deck (studyAllRounds, and every answer-based number).
      const rounds = await db.select().from(schema.conjugationRounds)
        .where(and(eq(schema.conjugationRounds.deckId, input.deckId), eq(schema.conjugationRounds.scope, 'deck')));
      const progress = await db.select().from(P).where(eq(P.deckId, input.deckId));
      const answeredIds = (await db.selectDistinct({ userId: schema.conjugationAnswers.userId }).from(schema.conjugationAnswers)
        .where(eq(schema.conjugationAnswers.deckId, input.deckId))).map((r) => r.userId);
      const played = [...new Set([...rounds.map((r) => r.userId), ...progress.map((p) => p.userId), ...answeredIds])]
        .filter((id) => !withAccess.some((u) => u.id === id));
      const others = played.length === 0 ? [] : await db.select(columns).from(schema.users).where(inArray(schema.users.id, played));
      const everyone = [...withAccess, ...others];
      const ids = everyone.map((u) => u.id);
      const now = new Date();
      const [days, delayed, times, due, studyAll] = await Promise.all([
        practiceDays(ids, now),
        delayedAnswers(ids, [input.deckId]),
        responseTimes(ids, [input.deckId]),
        dueByStudent(state, ids, now.getTime()),
        studyAllRounds(ids, [input.deckId]),
      ]);

      const students = everyone.map((u) => {
        const mine = progress.filter((p) => p.userId === u.id);
        const lastProgress = mine.reduce<Date | null>((max, p) => (!max || p.lastAt > max ? p.lastAt : max), null);
        const late = delayed.get(`${u.id}:${input.deckId}`);
        const time = times.get(`${u.id}:${input.deckId}`);
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          isTeacher: u.role === 'admin',
          ...roundStats(rounds.filter((r) => r.userId === u.id), lastProgress),
          /** "Study all" rounds played to their end that asked forms of this deck (not in Rounds or the scores). */
          studyAllRounds: studyAll.get(`${u.id}:${input.deckId}`) ?? 0,
          mastered: masteredCount(state.items, progressMap(mine), state.settings),
          total: state.items.length,
          /** Forms of this deck due for review now. */
          due: due.get(u.id) ?? 0,
          /** Distinct school days with a round played to its end, in any quiz; and in the last 14 days. */
          daysPractised: days.get(u.id)?.days ?? 0,
          daysPractised14: days.get(u.id)?.days14 ?? 0,
          /** Answers in this deck to forms not seen for 7 days or more, and the share right (null with none). */
          delayedAnswers: late?.answers ?? 0,
          delayedAccuracy: late && late.answers > 0 ? late.right / late.answers : null,
          /** Median seconds-to-answer of first tries in this deck, in ms: typed, and multiple choice (never more than the time that passed). */
          medianTypedMs: time?.typedMs ?? null,
          medianChoiceMs: time?.choiceMs ?? null,
          /** Answers whose page time was longer than the time that passed: an edited request. */
          timeMismatches: time?.timeMismatches ?? 0,
          /** Medians too fast to have read the question (VERY_FAST_*). */
          veryFast: time?.veryFast ?? false,
        };
      }).sort((a, b) => Number(a.isTeacher) - Number(b.isTeacher) || a.name.localeCompare(b.name));

      // A miss is a wrong answer, or an accent slip once accents are required. Students only.
      const missed = rowsOf<{ item_key: string; attempts: number; misses: number }>(await db.all(sql`
        SELECT a.item_key AS item_key, COUNT(*) AS attempts,
          SUM(CASE WHEN a.result = 'wrong' OR (a.result = 'accent' AND a.level_kind = 'typed-strict') THEN 1 ELSE 0 END) AS misses
        FROM conjugation_answers a
        JOIN users u ON u.id = a.user_id
        WHERE a.deck_id = ${input.deckId} AND u.role != 'admin'
        GROUP BY a.item_key
        HAVING misses > 0
        ORDER BY misses DESC, attempts DESC, a.item_key
        LIMIT 10
      `));
      // The same items split by the subject the prompt showed (v1.24.0): is "ustedes" the weak one?
      const bySubjectRows = missed.length === 0 ? [] : rowsOf<{ item_key: string; subject: string; attempts: number; misses: number }>(await db.all(sql`
        SELECT a.item_key AS item_key, a.subject_shown AS subject, COUNT(*) AS attempts,
          SUM(CASE WHEN a.result = 'wrong' OR (a.result = 'accent' AND a.level_kind = 'typed-strict') THEN 1 ELSE 0 END) AS misses
        FROM conjugation_answers a
        JOIN users u ON u.id = a.user_id
        WHERE a.deck_id = ${input.deckId} AND u.role != 'admin' AND a.subject_shown IS NOT NULL
          AND a.item_key IN (${sql.join(missed.map((m) => sql`${m.item_key}`), sql`, `)})
        GROUP BY a.item_key, a.subject_shown
        ORDER BY a.item_key, attempts DESC, a.subject_shown
      `));
      // The sentences a missed "give the form" item was shown as (v1.25.0), most missed first, filled in.
      const toMissed = missed.filter((m) => m.item_key.endsWith('|to'));
      const bySentenceRows = toMissed.length === 0 ? [] : rowsOf<{ item_key: string; ref: string; attempts: number; misses: number }>(await db.all(sql`
        SELECT a.item_key AS item_key, a.sentence_ref AS ref, COUNT(*) AS attempts,
          SUM(CASE WHEN a.result = 'wrong' OR (a.result = 'accent' AND a.level_kind = 'typed-strict') THEN 1 ELSE 0 END) AS misses
        FROM conjugation_answers a
        JOIN users u ON u.id = a.user_id
        WHERE a.deck_id = ${input.deckId} AND u.role != 'admin' AND a.sentence_ref IS NOT NULL
          AND a.item_key IN (${sql.join(toMissed.map((m) => sql`${m.item_key}`), sql`, `)})
        GROUP BY a.item_key, a.sentence_ref
        HAVING misses > 0
        ORDER BY misses DESC, attempts DESC, a.sentence_ref
      `));
      const sentenceData = bySentenceRows.length > 0 ? loadSentenceSource(db, input.deckId, state.settings, state.entries) : null;
      const mostMissed = missed.flatMap((m) => {
        const view = describeItem(m.item_key, state.settings);
        const subjects = bySubjectRows.filter((r) => r.item_key === m.item_key)
          .map((r) => ({ subject: r.subject, attempts: Number(r.attempts), misses: Number(r.misses) }));
        const sentences = view && sentenceData ? bySentenceRows.filter((r) => r.item_key === m.item_key).slice(0, 3).map((r) => {
          const cell = { tense: view.tense, person: view.person as Person, ...(view.number ? { number: view.number } : {}) };
          const all = cellSentences(sentenceData, view.entry, cell);
          const found = [...all.builtIn, ...all.written].find((x) => x.ref === r.ref);
          return {
            ref: r.ref,
            /** Filled in with the form; null for a sentence no longer in the deck's pool. */
            sentence: found ? filledIn({ before: found.before, after: found.after, answers: [view.form] }) : null,
            attempts: Number(r.attempts),
            misses: Number(r.misses),
          };
        }) : [];
        return view ? [{
          ...view,
          misses: m.misses,
          attempts: m.attempts,
          /** By the subject shown, for a person several subjects share (none before v1.24.0, or for yo / tú). */
          bySubject: subjectsOf(view.entry, view.tense, view.person).length > 1 ? subjects : [],
          /** v1.25.0: the sentences it was missed in, most missed first (at most 3). */
          bySentence: sentences,
        }] : [];
      });

      // Person mistakes by the kind of subject the prompt showed (v1.25.0): a label, or a sentence's subject.
      const typeRows = rowsOf<{ ref: string | null; n: number; p: number }>(await db.all(sql`
        SELECT a.sentence_ref AS ref, COUNT(*) AS n, SUM(CASE WHEN a.mistake_kind = 'person' THEN 1 ELSE 0 END) AS p
        FROM conjugation_answers a
        JOIN users u ON u.id = a.user_id
        WHERE a.deck_id = ${input.deckId} AND u.role != 'admin' AND a.item_key LIKE '%|to'
        GROUP BY a.sentence_ref
      `));
      const byType = new Map<SubjectType, { answers: number; personMistakes: number }>();
      for (const r of typeRows) {
        const type = subjectTypeOf(r.ref);
        const acc = byType.get(type) ?? { answers: 0, personMistakes: 0 };
        acc.answers += Number(r.n);
        acc.personMistakes += Number(r.p);
        byType.set(type, acc);
      }
      const personBySubject = typeRows.some((r) => r.ref !== null)
        ? SUBJECT_TYPES.filter((type) => byType.has(type)).map((type) => ({ type, ...(byType.get(type) as { answers: number; personMistakes: number }) }))
        : [];
      const sentencesRow = await db.query.deckConjugation.findFirst({ where: eq(schema.deckConjugation.deckId, input.deckId), columns: { sentencesSince: true } });

      return {
        deckId: state.deckId,
        deckName: state.deckName,
        enabled: state.settings.enabled,
        total: state.items.length,
        students,
        /** Where "Very fast" starts, for the legend. */
        veryFastLine: { typedMs: VERY_FAST_TYPED_MS, choiceMs: VERY_FAST_CHOICE_MS, minTries: VERY_FAST_MIN_TRIES },
        mostMissed,
        /** v1.25.0: "give the form" answers and person mistakes by the kind of subject shown; empty until a sentence was answered. */
        personBySubject,
        /** v1.25.0: how prompts are shown, and since when sentences are on (a change of format dips delayed accuracy for a while). */
        sentences: sentenceModeOf(state.settings),
        sentencesSince: sentencesRow?.sentencesSince ?? null,
        /** The class's commonest named mistakes in this deck (students only; unexplained answers left out). */
        topMistakes: await topMistakes(input.deckId, state.settings),
      };
    }),
});
