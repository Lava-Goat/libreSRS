// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The teacher's Sentences panel (v1.25.0, conjugation.sentences.*): what a
 * deck's sentences with a blank look like, and the few things the teacher does
 * with them. Admin only.
 *
 *  - panel: the mode and holdback as saved, the coverage line ("12 of 15 forms
 *    have a sentence; 3 use the label"), each verb's counts, the parked
 *    sentences (the checker rejects them under the deck's settings now), the
 *    students' reports, and the hard sentences (missed far more than their
 *    cell otherwise is, after HARD_MIN_ANSWERS answers).
 *  - list: one verb's sentences, cell by cell, filled in with their English,
 *    source, warnings and whether they are hidden.
 *  - hide: hides a built-in sentence from this deck's students (or shows it again).
 *  - preview: a sentence as a student sees it at a rung of the deck's ladder.
 *  - resolveReports: the reports of a sentence dealt with.
 *
 * The mode and the holdback are deck settings, saved with conjugation.saveSettings.
 * Rendering a large deck's sentences takes a second or two of CPU on the first
 * look (cached after), so the panel yields between verbs: students' answers
 * are not held up behind it.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { filledIn } from '@libresrs/shared/conjugation/sentences';
import { entryKind, type Person, type Tense } from '@libresrs/shared/conjugation';
import { router, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import {
  TENSE_IDS,
  buildPrompt,
  cellsOf,
  clientPrompt,
  describeItem,
  formsOf,
  itemKey,
  ladder,
  promptEntryName,
  sentenceModeOf,
  shortPersonLabel,
  snapshotOf,
  tenseLabel,
  type ClientPrompt,
  type QuizSettings,
} from '../services/conjugationQuiz.js';
import { blankText, cellPool, cellSentences, type ParkedSentence, type SentenceMode } from '../services/conjugationSentences.js';
import { loadSentenceSource } from '../services/conjugationSentenceSource.js';
import type { DeckQuizState } from './conjugation.js';

/** A sentence is flagged hard after this many answers (first tries) ... */
export const HARD_MIN_ANSWERS = 15;
/** ... when its miss rate is this much over its cell's with other sentences or labels (also over HARD_MIN_ANSWERS answers). */
export const HARD_GAP = 0.25;

/** Rows of a raw SQL query, on either driver. */
const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
/** Lets queued requests (students' answers) run between chunks of a long render. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

const cellInput = z.object({
  deckId: z.number().int(),
  entry: z.string().trim().min(1).max(60),
  tense: z.enum(TENSE_IDS as [Tense, ...Tense[]]),
  person: z.string().max(20),
  number: z.enum(['sg', 'pl']).nullish(),
});

const refInput = z.string().trim().min(1).max(400);

/** The mode the panel shows numbers for: the saved one, or what Built-in would give while sentences are off. */
const viewMode = (settings: QuizSettings): Exclude<SentenceMode, 'off'> => {
  const mode = sentenceModeOf(settings);
  return mode === 'off' ? 'builtIn' : mode;
};

export interface ParkedView extends ParkedSentence {
  entry: string;
  label: string;
  tenseLabel: string;
  personLabel: string;
}

export interface HardSentence {
  ref: string;
  itemKey: string;
  /** "vivir · ellos/ellas/Uds. · presente". */
  label: string;
  /** The sentence with its blank, when it is still in the pool. */
  sentence: string | null;
  answers: number;
  misses: number;
  otherAnswers: number;
  otherMisses: number;
}

interface HardRow { item_key: string; ref: string | null; n: number; m: number }

/** Sentences missed far more than their cell is otherwise (students' first tries in this deck). */
export async function hardSentences(state: DeckQuizState): Promise<HardSentence[]> {
  const rows = rowsOf<HardRow>(await db.all(sql`
    SELECT a.item_key AS item_key, a.sentence_ref AS ref, COUNT(*) AS n,
      SUM(CASE WHEN a.result = 'wrong' OR (a.result = 'accent' AND a.level_kind = 'typed-strict') THEN 1 ELSE 0 END) AS m
    FROM conjugation_answers a JOIN users u ON u.id = a.user_id
    WHERE a.deck_id = ${state.deckId} AND u.role != 'admin' AND a.retry = 0 AND a.item_key LIKE '%|to'
    GROUP BY a.item_key, a.sentence_ref
  `));
  const byItem = new Map<string, HardRow[]>();
  for (const r of rows) byItem.set(r.item_key, [...(byItem.get(r.item_key) ?? []), r]);
  const out: HardSentence[] = [];
  let data: ReturnType<typeof loadSentenceSource> | null = null;
  for (const [key, list] of byItem) {
    const total = list.reduce((acc, r) => ({ n: acc.n + Number(r.n), m: acc.m + Number(r.m) }), { n: 0, m: 0 });
    for (const r of list) {
      const n = Number(r.n);
      const m = Number(r.m);
      if (!r.ref || n < HARD_MIN_ANSWERS) continue;
      const on = total.n - n;
      const om = total.m - m;
      if (on < HARD_MIN_ANSWERS || m / n - om / on < HARD_GAP) continue;
      const view = describeItem(key, state.settings);
      if (!view) continue;
      data ??= loadSentenceSource(db, state.deckId, state.settings, state.entries);
      const cell = { tense: view.tense, person: view.person as Person, ...(view.number ? { number: view.number } : {}) };
      const all = cellSentences(data, view.entry, cell);
      const found = [...all.builtIn, ...all.written].find((s) => s.ref === r.ref);
      out.push({
        ref: r.ref,
        itemKey: key,
        label: [view.entryLabel, view.personLabel, view.tenseLabel].join(' · '),
        sentence: found ? blankText(found) : null,
        answers: n,
        misses: m,
        otherAnswers: on,
        otherMisses: om,
      });
    }
  }
  return out.sort((a, b) => b.misses / b.answers - a.misses / a.answers);
}

/** The deck's open reports, one row per sentence, newest first. */
function openReports(deckId: number) {
  const R = schema.conjugationSentenceReports;
  return db.select({
    ref: R.sentenceRef,
    sentence: sql<string>`max(${R.sentence})`,
    itemKey: sql<string>`max(${R.itemKey})`,
    count: sql<number>`count(*)`,
    lastAt: sql<number>`max(${R.createdAt})`,
  }).from(R)
    .where(and(eq(R.deckId, deckId), isNull(R.resolvedAt)))
    .groupBy(R.sentenceRef)
    .orderBy(desc(sql`max(${R.createdAt})`))
    .all()
    .map((r) => ({ ...r, count: Number(r.count), lastAt: new Date(Number(r.lastAt)) }));
}

/** The procedures, given the deck reader of routers/conjugation.ts (passed in, not imported: no import cycle). */
export function sentencesRouter(deps: { deckQuizState: (deckId: number) => Promise<DeckQuizState> }) {
  const { deckQuizState } = deps;

  async function cellOf(input: z.infer<typeof cellInput>) {
    const state = await deckQuizState(input.deckId);
    if (!state.entries.includes(input.entry)) throw new TRPCError({ code: 'NOT_FOUND', message: 'This deck does not drill that verb' });
    const cell = cellsOf(input.entry, state.settings).find((c) => c.tense === input.tense && c.person === input.person && (c.number ?? null) === (input.number ?? null));
    if (!cell) throw new TRPCError({ code: 'NOT_FOUND', message: 'This deck does not drill that form' });
    return { state, cell: { tense: cell.tense, person: cell.person as Person, ...(cell.number ? { number: cell.number } : {}) } };
  }

  return router({
    /** The panel: mode, holdback, coverage, each verb's counts, parked sentences, reports and hard sentences. */
    panel: adminProcedure
      .input(z.object({ deckId: z.number().int() }))
      .query(async ({ input }) => {
        const state = await deckQuizState(input.deckId);
        const mode = viewMode(state.settings);
        const deckRow = await db.query.deckConjugation.findFirst({ where: eq(schema.deckConjugation.deckId, input.deckId), columns: { sentencesSince: true } });
        const verbs = [];
        const parked: ParkedView[] = [];
        let cells = 0;
        let covered = 0;
        const data = loadSentenceSource(db, input.deckId, state.settings, state.entries);
        for (const entry of state.entries) {
          await breathe();
          let withSentence = 0;
          let sentences = 0;
          let hidden = 0;
          const list = cellsOf(entry, state.settings).filter((c) => formsOf(entry, c, state.settings).length > 0);
          for (const c of list) {
            const cell = { tense: c.tense, person: c.person as Person, ...(c.number ? { number: c.number } : {}) };
            const all = cellSentences(data, entry, cell);
            const pool = cellPool(data, mode, entry, cell);
            if (pool.length > 0) withSentence += 1;
            sentences += pool.length;
            hidden += all.builtIn.filter((x) => x.hidden).length;
            for (const p of all.parked) {
              parked.push({ ...p, entry, label: promptEntryName(entry), tenseLabel: tenseLabel(c.tense), personLabel: shortPersonLabel(entry, c.tense, c.person) });
            }
          }
          cells += list.length;
          covered += withSentence;
          verbs.push({ entry, label: promptEntryName(entry), kind: entryKind(entry), cells: list.length, covered: withSentence, sentences, hidden });
        }
        return {
          deckId: input.deckId,
          mode: sentenceModeOf(state.settings),
          /** The mode the numbers are for: the saved one, or Built-in while sentences are off (what turning them on gives). */
          countedMode: mode,
          holdback: !!state.settings.sentenceHoldback,
          sentencesSince: deckRow?.sentencesSince ?? null,
          levels: state.steps,
          coverage: { cells, covered, label: cells - covered },
          verbs,
          parked: parked.slice(0, 100),
          parkedCount: parked.length,
          reports: openReports(input.deckId),
          hard: await hardSentences(state),
        };
      }),

    /** One verb's sentences, cell by cell, as a student would see them filled in (with the hidden ones). */
    list: adminProcedure
      .input(z.object({ deckId: z.number().int(), entry: z.string().trim().min(1).max(60) }))
      .query(async ({ input }) => {
        const state = await deckQuizState(input.deckId);
        if (!state.entries.includes(input.entry)) throw new TRPCError({ code: 'NOT_FOUND', message: 'This deck does not drill that verb' });
        const mode = viewMode(state.settings);
        const data = loadSentenceSource(db, input.deckId, state.settings, state.entries);
        const cells = cellsOf(input.entry, state.settings).flatMap((c) => {
          const forms = formsOf(input.entry, c, state.settings);
          if (forms.length === 0) return [];
          const cell = { tense: c.tense, person: c.person as Person, ...(c.number ? { number: c.number } : {}) };
          const all = cellSentences(data, input.entry, cell);
          const shown = (source: 'builtIn' | 'approved') => mode === 'both' || mode === source;
          const view = (s: (typeof all.builtIn)[number] | (typeof all.written)[number], extra: { hidden: boolean; status: string | null; used: boolean }) => ({
            ref: s.ref,
            source: s.source,
            before: s.before,
            form: forms[0],
            after: s.after,
            cue: s.cue,
            english: s.english,
            subjectKind: s.subject?.kind ?? null,
            warnings: s.warnings.map((w) => ({ rule: w.rule, message: w.message, words: w.words ?? [] })),
            ...extra,
          });
          return [{
            tense: c.tense,
            tenseLabel: tenseLabel(c.tense),
            person: c.person,
            personLabel: shortPersonLabel(input.entry, c.tense, c.person),
            number: c.number ?? null,
            sentences: [
              ...all.builtIn.map((s) => view(s, { hidden: s.hidden, status: null, used: shown('builtIn') && !s.hidden })),
              ...all.written.map((s) => view(s, { hidden: false, status: s.status, used: shown('approved') && s.status === 'approved' })),
            ],
            parked: all.parked,
          }];
        });
        return { deckId: input.deckId, entry: input.entry, label: promptEntryName(input.entry), mode: sentenceModeOf(state.settings), cells };
      }),

    /** Hides a built-in sentence from this deck's students, or shows it again. */
    hide: adminProcedure
      .input(z.object({ deckId: z.number().int(), ref: refInput, hidden: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (!input.ref.startsWith('tpl:')) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a built-in sentence can be hidden' });
        const deck = await db.query.decks.findFirst({ where: eq(schema.decks.id, input.deckId), columns: { id: true } });
        if (!deck) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        const S = schema.conjugationSentences;
        const now = new Date();
        if (input.hidden) {
          db.insert(S).values({ deckId: input.deckId, ref: input.ref, source: 'builtIn', status: 'hidden', createdBy: ctx.user.id, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({ target: [S.deckId, S.ref], set: { status: 'hidden', updatedAt: now } })
            .run();
        } else {
          db.delete(S).where(and(eq(S.deckId, input.deckId), eq(S.ref, input.ref), eq(S.source, 'builtIn'))).run();
        }
        logger.info({ event: 'conjugation.sentence_hidden', deckId: input.deckId, userId: ctx.user.id, ref: input.ref, hidden: input.hidden }, 'Conjugation sentence hidden or shown');
        return { ref: input.ref, hidden: input.hidden };
      }),

    /** A sentence as a student sees it, at one rung of the deck's ladder (its answer and English for the teacher). */
    preview: adminProcedure
      .input(cellInput.extend({ ref: refInput, level: z.enum(['choice', 'typed-lenient', 'typed-strict']) }))
      .query(async ({ input }) => {
        const { state, cell } = await cellOf(input);
        const data = loadSentenceSource(db, input.deckId, state.settings, state.entries);
        const all = cellSentences(data, input.entry, cell);
        const sentence = [...all.builtIn, ...all.written].find((s) => s.ref === input.ref);
        if (!sentence) throw new TRPCError({ code: 'NOT_FOUND', message: 'That sentence is not in this deck any more' });
        const steps = ladder(state.settings);
        const level = Math.max(0, steps.indexOf(input.level));
        const snapshot = snapshotOf(state.settings, state.entries);
        const item = { entry: input.entry, tense: cell.tense, person: cell.person, ...(cell.number ? { number: cell.number } : {}), direction: 'to' as const };
        const entry = { key: itemKey(item), ...item };
        const built = buildPrompt(entry, level, snapshot, Math.random, { sentence: { pool: [sentence], recent: [], holdback: null } });
        const prompt: ClientPrompt = clientPrompt({ ...entry, built }, 0, 1, snapshot);
        return {
          levels: steps,
          prompt,
          answer: built.accepted.join(' / '),
          filled: filledIn({ before: sentence.before, after: sentence.after, answers: built.accepted }),
          english: sentence.english,
          hint: sentence.subject?.pronoun ?? null,
        };
      }),

    /** The students' reports of a sentence, dealt with (they leave the list; the sentence stays as it is). */
    resolveReports: adminProcedure
      .input(z.object({ deckId: z.number().int(), ref: refInput }))
      .mutation(({ ctx, input }) => {
        const R = schema.conjugationSentenceReports;
        const result = db.update(R).set({ resolvedAt: new Date() })
          .where(and(eq(R.deckId, input.deckId), eq(R.sentenceRef, input.ref), isNull(R.resolvedAt)))
          .run();
        logger.info({ event: 'conjugation.sentence_reports_resolved', deckId: input.deckId, userId: ctx.user.id, ref: input.ref }, 'Sentence reports resolved');
        return { resolved: result.changes };
      }),
  });
}
