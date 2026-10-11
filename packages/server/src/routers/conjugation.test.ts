// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { formsOf, parseSettings, seededRandom, type QueueEntry } from '../services/conjugationQuiz.js';

const { client, db: testDb, sqlite } = createTestDb();

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: '=Beto', picture: null, role: 'user' as const };
const carla = { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const DAY = 24 * 60 * 60 * 1000;
/** Fri 2 Oct 2026, 11:00 in Los Angeles: a school day. */
const FRIDAY = Date.UTC(2026, 9, 2, 18);

const PERIOD_1 = 1;
const PERIOD_2 = 2;
const UNIT_1 = 1;
const OTHER_DECK = 2;

/** The verb cards of a sample "Unit 1" deck, and a few that are not verbs. */
const UNIT1_CARDS = (
  'es | he/she/it is (ser); soy | I am (ser); eres | you are (ser); son | they are (ser); hay | there is / there are; ' +
  'está | is (location/feeling); estoy | I am (location/feeling); tiene | has; tengo | I have; tienes | you have; ' +
  'se llama | is named; me llamo | my name is; quiere | wants; quiero | I want; va | goes; voy | I go; ' +
  'le gusta | he/she likes; me gusta | I like; te gusta | you like; se ve | looks, appears; vive | lives; vivo | I live; ' +
  'pelo | hair; escuela | school; hola | hello'
).split('; ').map((pair) => {
  const [front, back] = pair.split(' | ');
  return { deckId: UNIT_1, front, back };
});

async function load() {
  const { conjugationRouter } = await import('./conjugation.js');
  const { adminRouter } = await import('./admin.js');
  const callerFor = (user: AnyUser) => conjugationRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return {
    admin: callerFor(adminUser),
    ana: callerFor(ana),
    beto: callerFor(beto),
    carla: callerFor(carla),
    adminApi: adminRouter.createCaller({
      req: { user: adminUser } as unknown as Request, res: {} as Response, user: adminUser, requestId: null,
    }),
  };
}
type Api = Awaited<ReturnType<typeof load>>;
type Caller = Api['ana'];

/** A round summary's fields and an answer's, with no extension loaded (an extension may add its own). */
const CORE_SUMMARY_KEYS = ['abandoned', 'almost', 'answers', 'climbing', 'decks', 'firstTryCorrect', 'mastered', 'prompts', 'roundId', 'scope', 'score', 'total'];
const CORE_ANSWER_KEYS = [
  'alsoCorrect', 'correctAnswer', 'counted', 'finished', 'finishedSets', 'levelAfter', 'levelBefore', 'levelKindAfter', 'mastered', 'masteredNow',
  'masteryPending', 'mistake', 'nearMiss', 'next', 'nextReviewDays', 'outcome', 'requeued', 'result', 'review', 'rightOptions', 'sentence', 'sharedBy',
  'summary', 'total',
];

const roundRow = (id: number) => testDb.query.conjugationRounds.findFirst({ where: eq(schema.conjugationRounds.id, id) });

/** The prompt the round waits on, as the server keeps it (answers included). */
async function current(roundId: number): Promise<QueueEntry> {
  const round = await roundRow(roundId);
  if (!round) throw new Error('no round');
  return (JSON.parse(round.queue) as QueueEntry[])[round.position];
}

/** The right answer to the waiting prompt, read from the server's copy. */
async function rightAnswer(roundId: number) {
  const entry = await current(roundId);
  const built = entry.built!;
  if (built.levelKind === 'choice') return { choice: built.correctOptions![0] };
  if (entry.direction === 'to') return { text: built.accepted[0] };
  const text = entry.entry.endsWith('-impersonal') ? entry.entry.replace('-impersonal', '') : entry.entry;
  return { text, ...(entry.entry.endsWith('-impersonal') ? {} : { person: entry.person }), ...(built.askTense ? { tense: entry.tense } : {}) };
}

/** A wrong answer of the right shape. */
async function wrongAnswer(roundId: number) {
  const entry = await current(roundId);
  const built = entry.built!;
  if (built.levelKind === 'choice') return { choice: built.options!.find((o) => !built.correctOptions!.includes(o))! };
  return { ...(await rightAnswer(roundId)), text: 'zzz' };
}

async function playRound(caller: Caller, roundId: number, total: number, wrongAt: number[] = []) {
  let last;
  for (let index = 0; index < total; index++) {
    const answer = wrongAt.includes(index) ? await wrongAnswer(roundId) : await rightAnswer(roundId);
    last = await caller.answer({ roundId, index, answer });
    total = last.total;
  }
  return last!;
}

describe('conjugation router', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: '=Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([
      { id: PERIOD_1, name: 'Español 1 — P1' },
      { id: PERIOD_2, name: 'Español 1 — P2' },
    ]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 },
      { userId: beto.id, groupId: PERIOD_1 },
      { userId: carla.id, groupId: PERIOD_2 },
      { userId: adminUser.id, groupId: PERIOD_1 },
    ]);
    await testDb.insert(schema.decks).values([
      { id: UNIT_1, name: 'Unit 1', createdBy: adminUser.id },
      { id: OTHER_DECK, name: 'Unit 2', createdBy: adminUser.id },
    ]);
    await testDb.insert(schema.deckGroups).values([
      { deckId: UNIT_1, groupId: PERIOD_1 },
      { deckId: OTHER_DECK, groupId: PERIOD_2 },
    ]);
    await testDb.insert(schema.cards).values([
      ...UNIT1_CARDS,
      { deckId: OTHER_DECK, front: 'hablo | I speak', back: 'I speak' },
      { deckId: OTHER_DECK, front: 'come', back: 'eats' },
    ]);
  });

  describe('settings', () => {
    it('starts off, with the defaults and the verbs found in the deck', async () => {
      const api = await load();
      const view = await api.admin.settings({ deckId: UNIT_1 });
      expect(view.settings).toMatchObject({
        enabled: false, tenses: ['present'], includeVosotros: false, vos: 'none', directions: 'both',
        answerMode: 'progressive', accentMode: 'progressive', roundLength: 20,
      });
      expect(view.effective).toEqual(['ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir']);
      expect(view.entries.find((e) => e.entry === 'gustarle')).toMatchObject({ kind: 'dative', included: true, note: expect.stringContaining('me gusta') });
      expect(view.entries.find((e) => e.entry === 'haber-impersonal')).toMatchObject({ kind: 'impersonal', label: 'haber (hay)' });
      expect(view.entries.find((e) => e.entry === 'llamarse')).toMatchObject({ kind: 'pronominal' });
      expect(view).toMatchObject({ verbCount: 10, itemCount: 102, cardCount: 25 });
      await expect(api.admin.settings({ deckId: 99 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('saves only what is given, orders the tenses, and recounts the items', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 10 });
      const view = await api.admin.saveSettings({
        deckId: UNIT_1, tenses: ['preterite', 'present'], excludedEntries: ['IR', 'verse'], extraEntries: ['hablar', 'haber (hay)'],
      });
      expect(view.settings).toMatchObject({
        enabled: true, roundLength: 10, tenses: ['present', 'preterite'], excludedEntries: ['ir', 'verse'], extraEntries: ['hablar', 'haber-impersonal'],
      });
      expect(view.effective).toEqual(['ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'gustarle', 'vivir', 'hablar']);
      expect(view.entries.find((e) => e.entry === 'ir')).toMatchObject({ included: false });
      expect(view.entries.find((e) => e.entry === 'hablar')).toMatchObject({ extra: true, included: true, known: true });
      // 7 personal entries × 5 persons × 2 tenses + hay/hubo + gustarle 10 cells × 2 tenses, both ways.
      expect(view.itemCount).toBe((7 * 5 * 2 + 2 + 20) * 2);
    });

    it('refuses what is not a setting', async () => {
      const api = await load();
      await expect(api.admin.saveSettings({ deckId: UNIT_1, roundLength: 4 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveSettings({ deckId: UNIT_1, roundLength: 61 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveSettings({ deckId: UNIT_1, tenses: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveSettings({ deckId: UNIT_1, tenses: ['someday' as 'present'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveSettings({ deckId: UNIT_1, vos: 'andaluz' as 'none' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.admin.saveSettings({ deckId: UNIT_1, extraEntries: ['hablar', 'banana'] }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('banana') });
      await expect(api.admin.saveSettings({ deckId: 99, enabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await api.admin.settings({ deckId: UNIT_1 })).settings.extraEntries).toEqual([]);
      // Students cannot change or read a deck's settings.
      await expect(api.ana.saveSettings({ deckId: UNIT_1, enabled: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.ana.settings({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('adds vos cells only when the deck has vos', async () => {
      const api = await load();
      const without = await api.admin.settings({ deckId: UNIT_1 });
      const withVos = await api.admin.saveSettings({ deckId: UNIT_1, vos: 'rioplatense' });
      // One more person for the 8 personal entries and gustarle (2 numbers), both ways.
      expect(withVos.itemCount - without.itemCount).toBe((8 + 2) * 2);
      const preview = await api.admin.preview({ entry: 'tener', tenses: ['present'], vos: 'rioplatense' });
      expect(preview.cells.find((c) => c.person === 'vos')).toMatchObject({ forms: ['tenés'], personLabel: 'vos' });
      const plain = await api.admin.preview({ entry: 'tener', tenses: ['present'] });
      expect(plain.cells.map((c) => c.person)).toEqual(['yo', 'tu', 'el', 'nosotros', 'ellos']);
    });

    it('previews every cell of an entry for the teacher', async () => {
      const api = await load();
      const preview = await api.admin.preview({ entry: 'Gustarle', tenses: ['present'], vosotros: true });
      expect(preview).toMatchObject({ entry: 'gustarle', kind: 'dative', known: true, note: null });
      expect(preview.cells).toHaveLength(12);
      expect(preview.cells[0]).toMatchObject({ person: 'yo', personLabel: 'a mí', number: 'sg', forms: ['me gusta'], tenseLabel: 'presente' });
      expect(preview.cells[1]).toMatchObject({ number: 'pl', forms: ['me gustan'] });
      expect(preview.cells[0].cue).toBeTruthy();
      const hay = await api.admin.preview({ entry: 'haber (hay)', tenses: ['present', 'preterite'] });
      expect(hay.cells.map((c) => c.forms[0])).toEqual(['hay', 'hubo']);
      expect((await api.admin.preview({ entry: 'blorfar', tenses: ['present'] })).known).toBe(false);
      await expect(api.admin.preview({ entry: 'banana', tenses: ['present'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('who can play', () => {
    it('shows students the quizzes of their decks that are turned on', async () => {
      const api = await load();
      expect(await api.ana.myQuizzes()).toEqual([]);
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      expect(await api.ana.myQuizzes()).toEqual([{ deckId: UNIT_1, deckName: 'Unit 1', mastered: 0, total: 102, lastScore: null, due: 0 }]);
      expect((await api.carla.myQuizzes()).map((q) => q.deckId)).toEqual([OTHER_DECK]);
    });

    it('lets a student play only a deck they have, once it is turned on; the teacher any deck', async () => {
      const api = await load();
      await expect(api.ana.start({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.ana.overview({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // "Try it" before turning it on.
      const trial = await api.admin.start({ deckId: UNIT_1 });
      expect(trial.prompt.index).toBe(0);

      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      await expect(api.carla.start({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.carla.overview({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const round = await api.ana.start({ deckId: UNIT_1 });
      expect(round).toMatchObject({ deckName: 'Unit 1', total: 20, review: false, levels: ['choice', 'typed-lenient', 'typed-strict'] });
      await expect(api.ana.start({ deckId: 99 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('gives an overview of the deck’s verbs and the student’s mastery', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
      const before = await api.ana.overview({ deckId: UNIT_1 });
      expect(before).toMatchObject({ deckName: 'Unit 1', mastered: 0, total: 102, rounds: 0, lastScore: null, tenses: [{ id: 'present', label: 'presente' }] });
      // Nothing answered yet: the guide keeps its parts about typing and accents closed.
      expect(before.reachedRungs).toEqual([]);
      expect(before.verbs.find((v) => v.entry === 'gustarle')).toMatchObject({ kind: 'dative', total: 20, mastered: 0 });
      // Named for the student as the prompts name it: "haber (hay)" would answer "haber · presente".
      expect(before.verbs.find((v) => v.entry === 'haber-impersonal')).toMatchObject({ label: 'haber', kind: 'impersonal' });
      expect(JSON.stringify(before.verbs)).not.toContain('(hay)');
    });
  });

  describe('a round', () => {
    beforeEach(async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
    });

    it('never sends the answers or the queue to the page', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const server = await current(round.roundId);
      const sent = JSON.stringify(round);
      expect(sent).not.toMatch(/accepted|correctOptions|queue|seed/);
      expect(round.prompt.itemKey).not.toContain(server.entry);
      expect(round.prompt.itemKey).toBe(server.built!.token);
      if (server.direction === 'from') expect(round.prompt.entryLabel).toBeNull();
      if (server.built!.levelKind !== 'choice') expect(sent).not.toContain(server.built!.accepted[0]);
    });

    it('names one real subject per prompt, taking turns across rounds, and keeps it for a reload and the answer (v1.24.0)', async () => {
      const api = await load();
      await api.admin.saveSettings({
        deckId: UNIT_1, directions: 'toForm',
        excludedEntries: ['ser', 'haber-impersonal', 'estar', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'],
      });
      const shownBy = new Map<string, string[]>();
      for (let r = 0; r < 3; r++) {
        const round = await api.ana.start({ deckId: UNIT_1 });
        let prompt = round.prompt;
        for (let index = 0; index < round.total; index++) {
          const entry = await current(round.roundId);
          // The page sees the subject the server built the prompt with, and a reload shows the same one.
          expect(prompt.personLabel).toBe(entry.built!.subject);
          expect(prompt.personId).toBe(entry.person);
          expect((await api.ana.current({ roundId: round.roundId })).prompt?.personLabel).toBe(entry.built!.subject);
          shownBy.set(entry.person, [...(shownBy.get(entry.person) ?? []), entry.built!.subject!]);
          const answered = await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
          if (entry.person === 'ellos') expect(answered.sharedBy).toEqual({ form: 'tienen', person: 'ellos', persons: ['ellos'], subjects: ['ellos', 'ellas', 'ustedes'] });
          if (entry.person === 'yo') expect(answered.sharedBy).toBeNull();
          if (answered.next) prompt = answered.next;
        }
      }
      // Each answer keeps the subject it was asked with.
      const answers = await testDb.select().from(schema.conjugationAnswers);
      expect(answers).toHaveLength(15);
      for (const a of answers) expect(a.subjectShown).toBe(shownBy.get(a.itemKey.split('|')[2])?.[answers.filter((b) => b.itemKey === a.itemKey && b.id < a.id).length]);
      // Least recently seen first: three rounds show all three subjects of a group, two the two of nosotros.
      expect([...(shownBy.get('ellos') ?? [])].sort()).toEqual(['ellas', 'ellos', 'ustedes']);
      expect([...(shownBy.get('el') ?? [])].sort()).toEqual(['ella', 'usted', 'él']);
      expect(new Set(shownBy.get('nosotros')?.slice(0, 2)).size).toBe(2);
      expect(shownBy.get('yo')).toEqual(['yo', 'yo', 'yo']);

      // The teacher's Most missed splits by the subject shown.
      const round = await api.ana.start({ deckId: UNIT_1 });
      let missedWith: string | undefined;
      let retried = false;
      for (let index = 0; index < 10; index++) {
        const entry = await current(round.roundId);
        if (entry.person === 'ellos' && !entry.retry) missedWith = entry.built!.subject;
        // The miss comes back with the subject it was missed with.
        if (entry.retry) {
          expect(entry.built!.subject).toBe(missedWith);
          retried = true;
        }
        const answer = entry.person === 'ellos' && !entry.retry ? await wrongAnswer(round.roundId) : await rightAnswer(round.roundId);
        const answered = await api.ana.answer({ roundId: round.roundId, index, answer });
        if (answered.finished) break;
      }
      expect(retried).toBe(true);
      const missedSubject = (await testDb.select().from(schema.conjugationAnswers))
        .find((a) => a.itemKey === 'tener|present|ellos|-|to' && a.result === 'wrong')?.subjectShown;
      const results = await api.admin.results({ deckId: UNIT_1 });
      const row = results.mostMissed.find((m) => m.itemKey === 'tener|present|ellos|-|to');
      expect(row).toMatchObject({ personLabel: 'ellos/ellas/Uds.', misses: 1 });
      expect(row?.bySubject.find((x) => x.subject === missedSubject)).toMatchObject({ misses: 1 });
      expect(row?.bySubject.reduce((n, x) => n + x.attempts, 0)).toBe(row?.attempts);

      // Answers from before v1.24.0 (0047) recorded no subject: they count in the headline, not in the split.
      const some = (await testDb.select().from(schema.conjugationAnswers)).find((a) => a.itemKey === 'tener|present|ellos|-|to')!;
      const old = { roundId: some.roundId, userId: some.userId, deckId: some.deckId, itemKey: some.itemKey, levelKind: 'choice' as const, given: 'tiene' };
      await testDb.insert(schema.conjugationAnswers).values([
        { ...old, result: 'wrong', at: new Date(Date.now() - 30 * 86_400_000), subjectShown: null },
        { ...old, given: 'tienen', result: 'correct', at: new Date(Date.now() - 29 * 86_400_000), subjectShown: null },
      ]);
      const after = (await api.admin.results({ deckId: UNIT_1 })).mostMissed.find((m) => m.itemKey === 'tener|present|ellos|-|to');
      expect(after).toMatchObject({ misses: 2, attempts: (row?.attempts ?? 0) + 2 });
      expect(after?.bySubject).toEqual(row?.bySubject);
      expect(after?.bySubject.reduce((n, x) => n + x.attempts, 0)).toBe((after?.attempts ?? 0) - 2);
    });

    it('is graded on the server, climbs the ladder, and scores the first tries', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, directions: 'toForm' });
      const round = await api.ana.start({ deckId: UNIT_1 });
      expect(round.prompt.kind).toBe('choice');
      const first = await current(round.roundId);
      const answered = await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
      expect(answered).toMatchObject({ result: 'correct', counted: true, levelBefore: 0, levelAfter: 1, levelKindAfter: 'typed-lenient', mastered: false, requeued: false, finished: false });
      expect(answered.next?.index).toBe(1);
      const progress = await testDb.query.conjugationProgress.findFirst({ where: eq(schema.conjugationProgress.itemKey, first.key) });
      expect(progress).toMatchObject({ userId: ana.id, deckId: UNIT_1, level: 1, mastered: false, correct: 1, wrong: 0 });
      const answers = await testDb.select().from(schema.conjugationAnswers);
      expect(answers).toMatchObject([{ roundId: round.roundId, userId: ana.id, itemKey: first.key, levelKind: 'choice', result: 'correct' }]);
      expect((await roundRow(round.roundId))).toMatchObject({ position: 1, answers: 1, firstTryCorrect: 1, finishedAt: null });
      expect(await api.ana.current({ roundId: round.roundId })).toMatchObject({ index: 1, answers: 1, firstTryCorrect: 1, review: false });
    });

    it('finishes after the last prompt, with the score and mastery', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const queue = JSON.parse((await roundRow(round.roundId))!.queue) as QueueEntry[];
      const last = await playRound(api.ana, round.roundId, round.total);
      expect(last).toMatchObject({ finished: true, next: null });
      // A perfect first round masters nothing yet: "name the verb" (one rung) needs one more day, the rest climbed a rung.
      const named = queue.filter((e) => e.direction === 'from').length;
      expect(last.summary).toMatchObject({
        score: 1, firstTryCorrect: 5, prompts: 5, answers: 5, abandoned: false, mastered: 0, almost: named, climbing: 5 - named, total: 102,
      });
      // No extension loaded: the summary is core's fields only, and so is the answer.
      expect(Object.keys(last.summary!).sort()).toEqual(CORE_SUMMARY_KEYS);
      expect(Object.keys(last).sort()).toEqual(CORE_ANSWER_KEYS);
      expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ mastered: 0, almost: named, climbing: 5 - named });
      expect(await api.ana.finish({ roundId: round.roundId })).toEqual(last.summary);
      await expect(api.ana.answer({ roundId: round.roundId, index: 5, answer: { choice: 'x' } }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('over') });
      expect((await api.ana.myQuizzes())[0]).toMatchObject({ lastScore: 1 });
    });

    it('puts a missed item back once at the end, and counts only first tries', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const missed = await current(round.roundId);
      const wrong = await api.ana.answer({ roundId: round.roundId, index: 0, answer: await wrongAnswer(round.roundId) });
      expect(wrong).toMatchObject({ result: 'wrong', counted: false, levelBefore: 0, levelAfter: 0, requeued: true, total: 6 });
      expect(wrong.correctAnswer).toBeTruthy();
      for (let index = 1; index < 5; index++) {
        await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
      }
      const retry = await current(round.roundId);
      expect(retry).toMatchObject({ key: missed.key, retry: true });
      // Missed again: not put back a second time.
      const last = await api.ana.answer({ roundId: round.roundId, index: 5, answer: await wrongAnswer(round.roundId) });
      expect(last).toMatchObject({ requeued: false, total: 6, finished: true });
      expect(last.summary).toMatchObject({ firstTryCorrect: 4, prompts: 5, answers: 6, score: 0.8 });
      const answers = await testDb.select().from(schema.conjugationAnswers).where(eq(schema.conjugationAnswers.roundId, round.roundId));
      expect(answers).toHaveLength(6);
      expect(answers.filter((a) => a.result === 'wrong').map((a) => a.itemKey)).toEqual([missed.key, missed.key]);
    });

    it('takes an answer only for the prompt it is waiting on, from the round’s own student', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const answer = await rightAnswer(round.roundId);
      await expect(api.ana.answer({ roundId: round.roundId, index: 1, answer })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(api.beto.answer({ roundId: round.roundId, index: 0, answer })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.admin.answer({ roundId: round.roundId, index: 0, answer })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.beto.finish({ roundId: round.roundId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.ana.answer({ roundId: 999, index: 0, answer })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // A malformed answer is refused without being counted.
      await expect(api.ana.answer({ roundId: round.roundId, index: 0, answer: {} })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await roundRow(round.roundId))?.position).toBe(0);
      // Taken while the round still waits on prompt 0: once it is answered, wrongAnswer() reads prompt 1, whose
      // wrong option can be prompt 0's right one (the same answer again, a replay, not a conflict).
      const other = await wrongAnswer(round.roundId);
      const first = await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      // The same answer sent twice (a double click, a retry) gets the same response and is counted once.
      expect(await api.ana.answer({ roundId: round.roundId, index: 0, answer })).toEqual(first);
      // Another answer to a prompt already answered is refused.
      await expect(api.ana.answer({ roundId: round.roundId, index: 0, answer: other }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await testDb.select().from(schema.conjugationAnswers)).toHaveLength(1);
      expect(await roundRow(round.roundId)).toMatchObject({ position: 1, answers: 1 });
    });

    it('answers a retried request whose response was lost with the stored response, the last one of a round too', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const answer = await wrongAnswer(round.roundId);
      const lost = await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      const retried = await api.ana.answer({ roundId: round.roundId, index: 0, answer: { ...answer } });
      expect(retried).toEqual(lost);
      // The retry gets the next prompt as it was sent, and that prompt is still the one waited on.
      expect(retried.next?.itemKey).toBe((await current(round.roundId)).built!.token);
      const row = await roundRow(round.roundId);
      expect(row).toMatchObject({ position: 1, answers: 1, firstTryCorrect: 0 });
      // The miss was put back once, not twice.
      expect(JSON.parse(row!.queue)).toHaveLength(6);
      const progress = await testDb.select().from(schema.conjugationProgress);
      expect(progress).toMatchObject([{ wrong: 1, correct: 0 }]);

      // The round goes on from the prompt the retry was given.
      expect(await api.ana.answer({ roundId: round.roundId, index: 1, answer: await rightAnswer(round.roundId) }))
        .toMatchObject({ result: 'correct', next: { index: 2 } });
      expect(await testDb.select().from(schema.conjugationAnswers)).toHaveLength(2);
    });

    it('replays the answer that finished a round, and nothing once the round was replaced', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const answers = [];
      let last;
      for (let index = 0; index < 5; index++) {
        answers.push(await rightAnswer(round.roundId));
        last = await api.ana.answer({ roundId: round.roundId, index, answer: answers[index] });
      }
      expect(last).toMatchObject({ finished: true, next: null });
      expect(await api.ana.answer({ roundId: round.roundId, index: 4, answer: answers[4] })).toEqual(last);
      await expect(api.ana.answer({ roundId: round.roundId, index: 3, answer: answers[3] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await testDb.select().from(schema.conjugationAnswers)).toHaveLength(5);

      const open = await api.ana.start({ deckId: UNIT_1 });
      const answer = await rightAnswer(open.roundId);
      await api.ana.answer({ roundId: open.roundId, index: 0, answer });
      await api.ana.start({ deckId: UNIT_1 });
      // Replaced by a new round: the old one's last answer is not replayed.
      await expect(api.ana.answer({ roundId: open.roundId, index: 0, answer })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('does not replay an answer once the round was ended early', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const answer = await rightAnswer(round.roundId);
      await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      await api.ana.finish({ roundId: round.roundId });
      // Ended early: left, not played to its end (v1.16).
      expect(await roundRow(round.roundId)).toMatchObject({ abandoned: true, finishedAt: expect.any(Date) });
      await expect(api.ana.answer({ roundId: round.roundId, index: 0, answer }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', cause: { appCode: 'ROUND_FINISHED' } });
      expect(await testDb.select().from(schema.conjugationAnswers)).toHaveLength(1);
    });

    it('stops a round when the student leaves the deck’s group or the quiz is turned off; a lost response is still replayed', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      const answer = await rightAnswer(round.roundId);
      const first = await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      const next = await rightAnswer(round.roundId);

      await testDb.delete(schema.userGroups).where(eq(schema.userGroups.userId, ana.id));
      const denied = { code: 'FORBIDDEN', cause: { appCode: 'DECK_ACCESS_DENIED' } };
      await expect(api.ana.answer({ roundId: round.roundId, index: 1, answer: next })).rejects.toMatchObject(denied);
      await expect(api.ana.current({ roundId: round.roundId })).rejects.toMatchObject(denied);
      await expect(api.ana.finish({ roundId: round.roundId })).rejects.toMatchObject(denied);
      // The answer taken while she had the deck: its retry gets the same response.
      expect(await api.ana.answer({ roundId: round.roundId, index: 0, answer })).toEqual(first);

      await testDb.insert(schema.userGroups).values({ userId: ana.id, groupId: PERIOD_1 });
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
      const off = { code: 'NOT_FOUND', cause: { appCode: 'CONJUGATION_OFF' } };
      await expect(api.ana.answer({ roundId: round.roundId, index: 1, answer: next })).rejects.toMatchObject(off);
      await expect(api.ana.current({ roundId: round.roundId })).rejects.toMatchObject(off);
      await expect(api.ana.finish({ roundId: round.roundId })).rejects.toMatchObject(off);
      expect(await roundRow(round.roundId)).toMatchObject({ position: 1, answers: 1, finishedAt: null });
      expect(await testDb.select().from(schema.conjugationAnswers)).toHaveLength(1);

      // The teacher's "Try it" plays on with the quiz off.
      const trial = await api.admin.start({ deckId: UNIT_1 });
      expect(await api.admin.current({ roundId: trial.roundId })).toMatchObject({ index: 0 });
      expect(await api.admin.answer({ roundId: trial.roundId, index: 0, answer: await rightAnswer(trial.roundId) }))
        .toMatchObject({ result: 'correct' });
      expect(await api.admin.finish({ roundId: trial.roundId })).toMatchObject({ answers: 1 });

      // Back on and back in the group: the round goes on where it was.
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      expect(await api.ana.answer({ roundId: round.roundId, index: 1, answer: next })).toMatchObject({ result: 'correct' });
    });

    it('picks an open round up again: the overview names it, current gives the prompt it waits on', async () => {
      const api = await load();
      expect((await api.ana.overview({ deckId: UNIT_1 })).openRound).toBeNull();
      const round = await api.ana.start({ deckId: UNIT_1 });
      expect(round).toMatchObject({ index: 0, answers: 0, deckId: UNIT_1 });
      expect((await api.ana.overview({ deckId: UNIT_1 })).openRound).toMatchObject({ roundId: round.roundId, index: 0, total: 5, answers: 0 });
      const resumed = await api.ana.current({ roundId: round.roundId });
      expect(resumed).toEqual({
        roundId: round.roundId, scope: 'deck', deckId: UNIT_1, deckName: 'Unit 1', total: 5, review: false, reviews: 0, levels: round.levels,
        index: 0, answers: 0, firstTryCorrect: 0, prompt: round.prompt,
      });
      expect(JSON.stringify(resumed)).not.toMatch(/accepted|correctOptions|queue|seed/);

      const answered = await api.ana.answer({ roundId: round.roundId, index: 0, answer: await wrongAnswer(round.roundId) });
      expect(await api.ana.current({ roundId: round.roundId })).toMatchObject({ index: 1, answers: 1, total: 6, prompt: answered.next });
      expect((await api.ana.overview({ deckId: UNIT_1 })).openRound).toMatchObject({ roundId: round.roundId, index: 1, total: 6, answers: 1 });

      await expect(api.beto.current({ roundId: round.roundId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await testDb.update(schema.conjugationRounds)
        .set({ startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000) })
        .where(eq(schema.conjugationRounds.id, round.roundId));
      await expect(api.ana.current({ roundId: round.roundId })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('expired') });
      expect((await api.ana.overview({ deckId: UNIT_1 })).openRound).toBeNull();

      const next = await api.ana.start({ deckId: UNIT_1 });
      await api.ana.finish({ roundId: next.roundId });
      await expect(api.ana.current({ roundId: next.roundId })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('over') });
      expect((await api.ana.overview({ deckId: UNIT_1 })).openRound).toBeNull();
    });

    it('never shows in a fromForm prompt a form another prompt of the round asks for', async () => {
      // vivía is yo and él of the imperfect, vivimos present and preterite: the round must not show one and ask for the other.
      const api = await load();
      const view = await api.admin.saveSettings({
        deckId: UNIT_1, tenses: ['present', 'imperfect'], roundLength: 20, extraEntries: ['hablar'],
        excludedEntries: ['ser', 'haber-impersonal', 'estar', 'llamarse', 'querer', 'ir', 'gustarle', 'verse'],
      });
      expect(view.effective).toEqual(['tener', 'vivir', 'hablar']);
      const settings = parseSettings(null);
      settings.tenses = ['present', 'imperfect'];
      const formsOfItem = (it: QueueEntry) => formsOf(it.entry, it, settings);
      const random = vi.spyOn(Math, 'random');
      try {
        for (let seed = 0; seed < 20; seed++) {
          random.mockImplementation(seededRandom(seed));
          const round = await api.ana.start({ deckId: UNIT_1 });
          const row = await roundRow(round.roundId);
          const queue = JSON.parse(row!.queue) as QueueEntry[];
          expect(queue).toHaveLength(20);
          for (const from of queue.filter((it) => it.direction === 'from')) {
            const shown = formsOfItem(from)[0];
            for (const to of queue.filter((it) => it.direction === 'to')) {
              expect(formsOfItem(to), `seed ${seed}: ${from.key} shows ${shown}`).not.toContain(shown);
            }
          }
        }
      } finally {
        random.mockRestore();
      }
    });

    it('expires after three hours', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      await testDb.update(schema.conjugationRounds)
        .set({ startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000) })
        .where(eq(schema.conjugationRounds.id, round.roundId));
      await expect(api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('expired') });
      expect(await api.ana.finish({ roundId: round.roundId })).toMatchObject({ abandoned: true });
      expect((await api.ana.overview({ deckId: UNIT_1 })).rounds).toBe(0);
    });

    it('abandons an unfinished round when the student starts another, without scoring it', async () => {
      const api = await load();
      const first = await api.ana.start({ deckId: UNIT_1 });
      await api.ana.answer({ roundId: first.roundId, index: 0, answer: await rightAnswer(first.roundId) });
      const second = await api.ana.start({ deckId: UNIT_1 });
      expect(await roundRow(first.roundId)).toMatchObject({ abandoned: true, finishedAt: expect.any(Date) });
      await expect(api.ana.answer({ roundId: first.roundId, index: 1, answer: { choice: 'x' } }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await roundRow(second.roundId)).toMatchObject({ abandoned: false, finishedAt: null });
      // Another deck's round, or another student's, is left alone.
      const betoRound = await api.beto.start({ deckId: UNIT_1 });
      await api.ana.start({ deckId: UNIT_1 });
      expect(await roundRow(betoRound.roundId)).toMatchObject({ finishedAt: null });
      expect((await api.ana.overview({ deckId: UNIT_1 })).rounds).toBe(0);
    });

    it('ends a round early on finish as abandoned: no round, no score, not played (v1.16)', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_1 });
      await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
      expect(await api.ana.finish({ roundId: round.roundId })).toMatchObject({ score: 0.2, abandoned: true, answers: 1 });
      expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ rounds: 0, lastScore: null, bestScore: null });

      // Started and ended at once (only a console can): nothing, not even Last played.
      const empty = await api.beto.start({ deckId: UNIT_1 });
      expect(await api.beto.finish({ roundId: empty.roundId })).toMatchObject({ score: 0, answers: 0, abandoned: true });
      expect(await api.beto.finish({ roundId: empty.roundId })).toMatchObject({ abandoned: true });
      expect((await api.beto.myQuizzes()).find((q) => q.deckId === UNIT_1)).toMatchObject({ lastScore: null });
      const results = await api.admin.results({ deckId: UNIT_1 });
      expect(results.students.find((s) => s.name === '=Beto')).toMatchObject({ rounds: 0, lastScore: null, lastPlayed: null });
      expect(results.students.find((s) => s.name === 'Ana')).toMatchObject({ rounds: 0, lastScore: null, lastPlayed: expect.any(Date) });
      const { csv } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
      expect(csv.split('\n').find((line) => line.startsWith(`"'=Beto"`))).toBe(`"'=Beto","beto@example.com","Unit 1",not played,0,,,0,102,0.0,"",0,0,0,0,,,,"",,"",0`);
    });

    it('counts only rounds played to their end, old rows ended early included, with no migration (v1.16)', async () => {
      const { roundStats } = await import('./conjugation.js');
      const at = (minutes: number) => new Date(FRIDAY + minutes * 60_000);
      const round = (over: Partial<typeof schema.conjugationRounds.$inferSelect>) => ({
        id: 1, userId: ana.id, deckId: UNIT_1, startedAt: at(0), finishedAt: at(10), abandoned: false,
        queue: JSON.stringify([{}, {}, {}, {}, {}]), position: 5, prompts: 5, firstTryCorrect: 5, answers: 5,
        settingsSnapshot: '{}', lastAnswer: null, ...over,
      });
      const stats = roundStats([
        round({ id: 1, firstTryCorrect: 4, finishedAt: at(10) }), // to its end: 80 %
        round({ id: 2, position: 1, answers: 1, firstTryCorrect: 1, finishedAt: at(20) }), // ended early by v1.15: not a round
        round({ id: 3, position: 0, answers: 0, firstTryCorrect: 0, finishedAt: at(30) }), // started and ended at once
        // One missed and retried, the retry dropped when its deck left: shorter queue, still to its end.
        round({ id: 4, queue: JSON.stringify([{}, {}, {}, {}]), prompts: 4, position: 4, firstTryCorrect: 3, answers: 4, finishedAt: at(5) }),
        round({ id: 5, abandoned: true, finishedAt: at(40) }), // replaced by a newer round
      ]);
      expect(stats).toEqual({ rounds: 2, lastScore: 0.8, bestScore: 0.8, lastPlayed: at(40) });
      // Neither an empty round nor its end is "played".
      expect(roundStats([round({ position: 0, answers: 0, firstTryCorrect: 0 })])).toEqual({ rounds: 0, lastScore: null, bestScore: null, lastPlayed: null });
    });

    it('masters an item after the whole ladder and a second school day, brings it back when due, and loses it with a miss', async () => {
      const api = await load();
      // One verb, one tense, one direction: a small deck to climb.
      await api.admin.saveSettings({
        deckId: UNIT_1, directions: 'toForm', excludedEntries: ['ser', 'haber-impersonal', 'estar', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'],
      });
      expect((await api.ana.overview({ deckId: UNIT_1 })).total).toBe(5);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(FRIDAY);
        const levels: string[] = [];
        const reached: string[][] = [];
        const outcomes: string[] = [];
        const counts: unknown[] = [];
        for (let r = 0; r < 3; r++) {
          const round = await api.ana.start({ deckId: UNIT_1 });
          levels.push(round.prompt.level);
          const last = await playRound(api.ana, round.roundId, round.total);
          outcomes.push(last.outcome);
          counts.push({ mastered: last.summary?.mastered, almost: last.summary?.almost, climbing: last.summary?.climbing });
          reached.push((await api.ana.overview({ deckId: UNIT_1 })).reachedRungs);
        }
        expect(levels).toEqual(['choice', 'typed-lenient', 'typed-strict']);
        // Right at the top on the first day: not mastered yet.
        expect(outcomes).toEqual(['up', 'up', 'pending']);
        // What the round's end says instead of a bare "0 / 5 mastered": on the way up, then one more day to go.
        expect(counts).toEqual([
          { mastered: 0, almost: 0, climbing: 5 },
          { mastered: 0, almost: 0, climbing: 5 },
          { mastered: 0, almost: 5, climbing: 0 },
        ]);
        // Each round climbs a rung; the guide opens a part per rung the student has answered at (or stands on).
        expect(reached).toEqual([
          ['choice', 'typed-lenient'],
          ['choice', 'typed-lenient', 'typed-strict'],
          ['choice', 'typed-lenient', 'typed-strict'],
        ]);
        expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ mastered: 0, total: 5 });
        const sameDay = await api.ana.start({ deckId: UNIT_1 });
        expect(await playRound(api.ana, sameDay.roundId, sameDay.total)).toMatchObject({ outcome: 'pending', masteryPending: true, mastered: false });
        expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ mastered: 0 });

        // Another school day: mastered, back in a week (at 2 pm too: next Saturday is 7 days away, not 6.4).
        vi.setSystemTime(FRIDAY + DAY + 3 * 60 * 60 * 1000);
        const nextDay = await api.ana.start({ deckId: UNIT_1 });
        expect(await playRound(api.ana, nextDay.roundId, nextDay.total)).toMatchObject({
          outcome: 'mastered', masteredNow: true, nextReviewDays: 7, summary: { mastered: 5, almost: 0, climbing: 0 },
        });
        expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ mastered: 5, almost: 0, climbing: 0, total: 5, due: 0 });
        const rows = await testDb.select().from(schema.conjugationProgress);
        // Due from midnight a week on (Sat 10 Oct, PDT), not from the minute it was mastered.
        expect(rows.every((r) => r.mastered && r.dueAt?.getTime() === Date.UTC(2026, 9, 10, 7) && r.reviewStep === 0 && r.firstMasteredAt)).toBe(true);

        // A week on: all five are due, and the round is all review.
        vi.setSystemTime(FRIDAY + 8 * DAY);
        expect((await api.ana.myQuizzes())[0]).toMatchObject({ due: 5 });
        const review = await api.ana.start({ deckId: UNIT_1 });
        expect(review).toMatchObject({ review: true, reviews: 5, total: 5 });
        expect(review.prompt).toMatchObject({ scheduledReview: true, fromDeck: null });
        expect((await api.ana.current({ roundId: review.roundId })).review).toBe(true);
        const miss = await api.ana.answer({ roundId: review.roundId, index: 0, answer: await wrongAnswer(review.roundId) });
        expect(miss).toMatchObject({ levelBefore: 2, levelAfter: 1, mastered: false, outcome: 'lapse', review: true, nextReviewDays: null });
        const kept = await api.ana.answer({ roundId: review.roundId, index: 1, answer: await rightAnswer(review.roundId) });
        // Reviewed: the next interval is 3 weeks.
        expect(kept).toMatchObject({ outcome: 'reviewed', mastered: true, nextReviewDays: 21 });
        expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({
          mastered: 4,
          // The lapsed form dropped a rung: back on the way up.
          climbing: 1,
          almost: 0,
          due: 3,
          // A rung lost is not a part of the guide closed again.
          reachedRungs: ['choice', 'typed-lenient', 'typed-strict'],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('forgives an accent slip on the lenient rung, and not on the strict one', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, answerMode: 'typed', directions: 'toForm', extraEntries: ['estar'], excludedEntries: ['ser', 'haber-impersonal', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'] });
      const round = await api.ana.start({ deckId: UNIT_1 });
      expect(round.prompt).toMatchObject({ kind: 'typed', level: 'typed-lenient', strictAccents: false });
      // Find the él/ella/usted prompt: está.
      let index = 0;
      let entry = await current(round.roundId);
      while (entry.person !== 'el') {
        await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
        index += 1;
        entry = await current(round.roundId);
      }
      const slip = await api.ana.answer({ roundId: round.roundId, index, answer: { text: 'esta' } });
      expect(slip).toMatchObject({ result: 'accent', counted: true, nearMiss: true, correctAnswer: 'está', levelAfter: 1, requeued: false });

      const next = await api.ana.start({ deckId: UNIT_1 });
      let i = 0;
      entry = await current(next.roundId);
      while (entry.person !== 'el') {
        await api.ana.answer({ roundId: next.roundId, index: i, answer: await rightAnswer(next.roundId) });
        i += 1;
        entry = await current(next.roundId);
      }
      expect(entry.built?.levelKind).toBe('typed-strict');
      const strict = await api.ana.answer({ roundId: next.roundId, index: i, answer: { text: 'esta' } });
      expect(strict).toMatchObject({ result: 'accent', counted: false, nearMiss: true, levelBefore: 1, levelAfter: 0, requeued: true });
    });
  });

  describe('results', () => {
    it('shows every student of the deck, their scores and mastery, the teacher’s runs marked, and the items missed most', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
      const anaRound = await api.ana.start({ deckId: UNIT_1 });
      const missed = await current(anaRound.roundId);
      await playRound(api.ana, anaRound.roundId, 5, [0]);
      const teacherRound = await api.admin.start({ deckId: UNIT_1 });
      await playRound(api.admin, teacherRound.roundId, 5, [0, 1, 2, 3, 4]);

      const results = await api.admin.results({ deckId: UNIT_1 });
      expect(results).toMatchObject({ deckName: 'Unit 1', enabled: true, total: 102 });
      expect(results.students.map((s) => [s.name, s.isTeacher])).toEqual([['=Beto', false], ['Ana', false], ['Admin', true]]);
      expect(results.students.find((s) => s.name === 'Ana')).toMatchObject({ rounds: 1, lastScore: 0.8, bestScore: 0.8, mastered: 0, total: 102, lastPlayed: expect.any(Date) });
      expect(results.students.find((s) => s.name === '=Beto')).toMatchObject({ rounds: 0, lastScore: null, lastPlayed: null });
      expect(results.students.find((s) => s.isTeacher)).toMatchObject({ rounds: 1, lastScore: 0 });
      // The teacher's misses are not the class's.
      expect(results.mostMissed).toHaveLength(1);
      // Missed once, then right on the retry.
      expect(results.mostMissed[0]).toMatchObject({ itemKey: missed.key, misses: 1, attempts: 2, entry: missed.entry });
      await expect(api.ana.results({ deckId: UNIT_1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('exports a row per student per quiz the group sees, formula cells neutralised', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      const round = await api.ana.start({ deckId: UNIT_1 });
      await playRound(api.ana, round.roundId, 5);

      const { csv, rowCount } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
      const [header, ...rows] = csv.split('\n');
      // The v1.12 columns first, so existing sheets keep them; the new numbers after.
      expect(header).toBe(
        'student_name,student_email,deck,status,rounds,last_score,best_score,mastered,items_total,mastery_pct,last_played,'
        + 'due_now,days_practised_14d,days_practised,delayed_answers,delayed_accuracy,median_typed_s,median_choice_s,'
        + 'top_mistake,top_mistake_count,top_mistake_example,study_all_rounds',
      );
      expect(rowCount).toBe(2);
      expect(rows[0]).toBe(`"'=Beto","beto@example.com","Unit 1",not played,0,,,0,102,0.0,"",0,0,0,0,,,,"",,"",0`);
      // Her answers sent no time: the time that passed stands in (v1.16), all multiple choice on the first rung.
      expect(rows[1]).toMatch(/^"Ana","ana@example.com","Unit 1",played,1,100\.0,100\.0,0,102,0\.0,"\d{4}-\d\d-\d\dT[\d:.]+Z",0,1,1,0,,,\d+\.\d,"",,"",0$/);
      for (const row of rows) expect(row.split(',')).toHaveLength(header.split(',').length);

      // A deck turned off leaves the export.
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
      expect((await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' })).rowCount).toBe(0);
    });
  });

  describe('reviews across decks, two-day mastery, mistakes and response times (v1.13)', () => {
    const TENER = ['yo', 'tu', 'el', 'nosotros', 'ellos'];
    const tenerKey = (person: string, direction: 'to' | 'from' = 'to') => `tener|present|${person}|-|${direction}`;
    const row = (userId: number, deckId: number, itemKey: string, over: Partial<typeof schema.conjugationProgress.$inferInsert> = {}) =>
      ({ userId, deckId, itemKey, level: 0, mastered: false, lastAt: new Date(FRIDAY - 30 * DAY), ...over });
    const queueOf = async (roundId: number) => JSON.parse((await roundRow(roundId))!.queue) as QueueEntry[];
    const progressOf = (deckId: number, key: string) => testDb.query.conjugationProgress.findFirst({
      where: (p, { and: all, eq: is }) => all(is(p.userId, ana.id), is(p.deckId, deckId), is(p.itemKey, key)),
    });
    /** Plays a round to its end, right unless `wrong` says otherwise; returns every response and the entries answered. */
    async function playAll(caller: Caller, roundId: number, wrong: (e: QueueEntry) => boolean = () => false, before?: (e: QueueEntry, index: number) => Promise<void>) {
      const responses = [];
      const entries: QueueEntry[] = [];
      for (let index = 0; ; index++) {
        const entry = await current(roundId);
        await before?.(entry, index);
        entries.push(entry);
        const answer = wrong(entry) ? await wrongAnswer(roundId) : await rightAnswer(roundId);
        const response = await caller.answer({ roundId, index, answer });
        responses.push(response);
        if (response.finished) return { responses, entries };
      }
    }
    /** Unit 2 (hablar, comer) for Ana's period too; both quizzes on. */
    async function twoUnits(api: Api, unit1: Parameters<Api['admin']['saveSettings']>[0] = { deckId: UNIT_1 }) {
      await api.admin.saveSettings({ ...unit1, deckId: UNIT_1, enabled: true });
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      await testDb.insert(schema.deckGroups).values({ deckId: OTHER_DECK, groupId: PERIOD_1 });
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FRIDAY);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('brings back due forms of an earlier unit, asked and graded under that deck, written back to it', async () => {
      const api = await load();
      await twoUnits(api, { deckId: UNIT_1, accentMode: 'forgiven' });
      // Mastered in Unit 1 (choice, then typing with accents forgiven), due for a week or more.
      await testDb.insert(schema.conjugationProgress).values(TENER.map((p, i) => row(ana.id, UNIT_1, tenerKey(p), {
        level: 1, mastered: true, dueAt: new Date(FRIDAY - (7 + i) * DAY), reviewStep: 0,
      })));
      expect((await api.ana.myQuizzes()).find((q) => q.deckId === UNIT_1)).toMatchObject({ due: 5 });
      expect(await api.ana.overview({ deckId: UNIT_1 })).toMatchObject({ due: 5, mastered: 5 });

      const round = await api.ana.start({ deckId: OTHER_DECK });
      const reviews = (await queueOf(round.roundId)).filter((e) => e.review);
      // Unit 2 has 10 forms; a quarter of a 20-prompt round is 5 reviews.
      expect(round).toMatchObject({ total: 15, reviews: 5 });
      expect(reviews.map((e) => [e.deckId, e.key]).sort()).toEqual(TENER.map((p) => [UNIT_1, tenerKey(p)]).sort());
      const { entries } = await playAll(api.ana, round.roundId, () => false, async (entry) => {
        const { prompt } = await api.ana.current({ roundId: round.roundId });
        if (entry.deckId === UNIT_1) {
          // Built on Unit 1's ladder, where these forms stand: typing, accents forgiven.
          expect(prompt).toMatchObject({ scheduledReview: true, fromDeck: { deckId: UNIT_1, deckName: 'Unit 1' }, level: 'typed-lenient' });
        } else {
          expect(prompt).toMatchObject({ scheduledReview: false, fromDeck: null });
        }
      });
      expect(entries.filter((e) => e.deckId === UNIT_1)).toHaveLength(5);
      // Written back to Unit 1: reviewed, due in 3 weeks; nothing of Unit 1 in Unit 2.
      for (const p of TENER) {
        expect(await progressOf(UNIT_1, tenerKey(p))).toMatchObject({ mastered: true, reviewStep: 1, dueAt: new Date(Date.UTC(2026, 9, 23, 7)), correct: 1 });
        expect(await progressOf(OTHER_DECK, tenerKey(p))).toBeUndefined();
      }
      const logged = await testDb.select().from(schema.conjugationAnswers).where(eq(schema.conjugationAnswers.deckId, UNIT_1));
      expect(logged).toHaveLength(5);
      expect(logged.every((a) => a.review && a.roundId === round.roundId && a.levelKind === 'typed-lenient')).toBe(true);
      // Last answered 30 days ago (the rows' last_at): each review is a delayed answer.
      expect(logged.map((a) => a.gapMs)).toEqual(Array(5).fill(30 * DAY));
      const own = await testDb.select().from(schema.conjugationAnswers).where(eq(schema.conjugationAnswers.deckId, OTHER_DECK));
      expect(own.filter((a) => !a.retry).every((a) => a.gapMs === null)).toBe(true);
      expect((await api.ana.myQuizzes()).find((q) => q.deckId === UNIT_1)).toMatchObject({ due: 0 });
    });

    it('reviews only quizzes the student may play, and drops a review whose quiz is turned off mid-round', async () => {
      const api = await load();
      await twoUnits(api);
      await testDb.insert(schema.conjugationProgress).values(TENER.map((p) => row(ana.id, UNIT_1, tenerKey(p), {
        level: 2, mastered: true, dueAt: new Date(FRIDAY - DAY),
      })));
      // Carla has only Unit 2: her rows elsewhere are not hers to review here, and Unit 1 is not hers.
      await testDb.insert(schema.conjugationProgress).values(row(carla.id, UNIT_1, tenerKey('yo'), { level: 2, mastered: true, dueAt: new Date(FRIDAY - DAY) }));
      const carlas = await api.carla.start({ deckId: OTHER_DECK });
      expect((await queueOf(carlas.roundId)).some((e) => e.deckId !== undefined)).toBe(false);

      await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
      const off = await api.ana.start({ deckId: OTHER_DECK });
      expect((await queueOf(off.roundId)).some((e) => e.deckId !== undefined)).toBe(false);

      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      const round = await api.ana.start({ deckId: OTHER_DECK });
      expect(round.reviews).toBe(5);
      let shownAfter = 0;
      let turnedOff = false;
      const { responses } = await playAll(api.ana, round.roundId, () => false, async (entry, index) => {
        if (turnedOff && entry.deckId === UNIT_1) shownAfter += 1;
        if (index === 0) {
          await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
          turnedOff = true;
        }
      });
      expect(shownAfter).toBe(0);
      const last = responses[responses.length - 1];
      // The prompts not shown are not counted against the score.
      const firstWasReview = (await testDb.select().from(schema.conjugationAnswers)).some((a) => a.deckId === UNIT_1);
      expect(last.summary).toMatchObject({ prompts: firstWasReview ? 11 : 10, score: 1 });
    });

    it('carries a form mastered in Unit 1 over to a later deck at the top rung, and keeps one state for both', async () => {
      const api = await load();
      await twoUnits(api);
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
      // Give the form only, so no "name the verb" question takes the tú cell first.
      await api.admin.saveSettings({ deckId: OTHER_DECK, extraEntries: ['tener'], directions: 'toForm' });
      await testDb.insert(schema.conjugationProgress).values([
        row(ana.id, UNIT_1, tenerKey('yo'), { level: 2, mastered: true, dueAt: new Date(FRIDAY + 10 * DAY), reviewStep: 1, firstMasteredAt: new Date(FRIDAY - 30 * DAY) }),
        row(ana.id, UNIT_1, tenerKey('tu'), { level: 1 }),
      ]);
      const round = await api.ana.start({ deckId: OTHER_DECK });
      const queue = await queueOf(round.roundId);
      expect(queue.find((e) => e.key === tenerKey('yo'))).toMatchObject({ carried: true });
      const { responses, entries } = await playAll(api.ana, round.roundId);
      const yo = entries.findIndex((e) => e.key === tenerKey('yo'));
      const tu = entries.findIndex((e) => e.key === tenerKey('tu'));
      // Asked at the top rung, and one right answer masters it on Unit 1's schedule.
      expect(entries[yo].built?.levelKind).toBe('typed-strict');
      expect(responses[yo]).toMatchObject({ outcome: 'mastered', masteredNow: true, nextReviewDays: 10 });
      expect(await progressOf(OTHER_DECK, tenerKey('yo'))).toMatchObject({ mastered: true, reviewStep: 1, dueAt: new Date(FRIDAY + 10 * DAY) });
      expect(await progressOf(UNIT_1, tenerKey('yo'))).toMatchObject({ mastered: true, reviewStep: 1, dueAt: new Date(FRIDAY + 10 * DAY), correct: 0 });
      // Half-way up in Unit 1: it goes on from there, and both decks move together.
      expect(entries[tu].built?.levelKind).toBe('typed-lenient');
      expect(await progressOf(OTHER_DECK, tenerKey('tu'))).toMatchObject({ level: 2, mastered: false });
      expect(await progressOf(UNIT_1, tenerKey('tu'))).toMatchObject({ level: 2, mastered: false, correct: 0, lastAt: new Date(FRIDAY - 30 * DAY) });
      // A miss in one deck is a miss in the other.
      vi.setSystemTime(FRIDAY + 10 * DAY);
      const again = await api.ana.start({ deckId: OTHER_DECK });
      const lapse = await playAll(api.ana, again.roundId, (e) => e.key === tenerKey('yo') && !e.retry);
      expect(lapse.responses[lapse.entries.findIndex((e) => e.key === tenerKey('yo'))]).toMatchObject({ outcome: 'lapse', levelAfter: 1 });
      // Missed, then right on the second try (a rung back up): not mastered in either deck, the intervals start over.
      for (const deckId of [UNIT_1, OTHER_DECK]) {
        expect(await progressOf(deckId, tenerKey('yo'))).toMatchObject({ mastered: false, level: 2, dueAt: null, reviewStep: 0, firstTopDay: null });
      }
      // Mastered at least once stays so.
      expect((await progressOf(UNIT_1, tenerKey('yo')))?.firstMasteredAt).toEqual(new Date(FRIDAY - 30 * DAY));
    });

    it('never undoes a form mastered in one deck with a right answer in a deck whose row was behind (rows kept per deck in v1.12)', async () => {
      const api = await load();
      await twoUnits(api);
      await api.admin.saveSettings({ deckId: OTHER_DECK, extraEntries: ['tener'], directions: 'toForm' });
      await testDb.insert(schema.conjugationProgress).values([
        row(ana.id, UNIT_1, tenerKey('yo'), { level: 2, mastered: true, dueAt: new Date(FRIDAY + 20 * DAY), reviewStep: 1, firstMasteredAt: new Date(FRIDAY - 30 * DAY) }),
        row(ana.id, OTHER_DECK, tenerKey('yo'), { level: 0 }),
      ]);
      expect((await api.ana.overview({ deckId: UNIT_1 })).mastered).toBe(1);
      const round = await api.ana.start({ deckId: OTHER_DECK });
      const { responses, entries } = await playAll(api.ana, round.roundId);
      const yo = entries.findIndex((e) => e.key === tenerKey('yo'));
      // Asked where the form stands (the top rung), and right before it is due: nothing changes, in either deck.
      expect(entries[yo].built?.levelKind).toBe('typed-strict');
      expect(responses[yo]).toMatchObject({ outcome: 'early', mastered: true, nextReviewDays: 20 });
      for (const deckId of [UNIT_1, OTHER_DECK]) {
        expect(await progressOf(deckId, tenerKey('yo')), String(deckId)).toMatchObject({ level: 2, mastered: true, reviewStep: 1, dueAt: new Date(FRIDAY + 20 * DAY) });
      }
      expect((await api.ana.overview({ deckId: UNIT_1 })).mastered).toBe(1);
    });

    it('grades a review whose deck was deleted while it waited, keeps nothing of it, and goes on with the round', async () => {
      const api = await load();
      await twoUnits(api);
      await testDb.insert(schema.conjugationProgress).values(TENER.map((p) => row(ana.id, UNIT_1, tenerKey(p), {
        level: 2, mastered: true, dueAt: new Date(FRIDAY - DAY),
      })));
      const round = await api.ana.start({ deckId: OTHER_DECK });
      expect(round.reviews).toBe(5);
      let index = 0;
      while ((await current(round.roundId)).deckId !== UNIT_1) {
        await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
        index += 1;
      }
      const answer = await rightAnswer(round.roundId);
      await testDb.delete(schema.decks).where(eq(schema.decks.id, UNIT_1));
      const graded = await api.ana.answer({ roundId: round.roundId, index, answer });
      expect(graded).toMatchObject({ result: 'correct', counted: true, mastered: false, nextReviewDays: null, finished: false });
      // The rest of the round is Unit 2's, to its end.
      for (index += 1; ; index++) {
        expect((await current(round.roundId)).deckId).toBeUndefined();
        const response = await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
        if (response.finished) break;
      }
      expect(await testDb.select().from(schema.conjugationProgress).where(eq(schema.conjugationProgress.deckId, UNIT_1))).toEqual([]);
      expect(await testDb.select().from(schema.conjugationAnswers).where(eq(schema.conjugationAnswers.deckId, UNIT_1))).toEqual([]);
      expect((await roundRow(round.roundId))?.finishedAt).toBeInstanceOf(Date);
    });

    it('reviews a due "name the verb" form by asking for the form: right, the next interval; wrong, back in a week and still mastered', async () => {
      const api = await load();
      await twoUnits(api);
      await testDb.insert(schema.conjugationProgress).values([
        row(ana.id, UNIT_1, tenerKey('yo', 'from'), { mastered: true, dueAt: new Date(FRIDAY - 2 * DAY), reviewStep: 1 }),
        row(ana.id, UNIT_1, tenerKey('tu', 'from'), { mastered: true, dueAt: new Date(FRIDAY - DAY), reviewStep: 1 }),
      ]);
      const round = await api.ana.start({ deckId: OTHER_DECK });
      const reviews = (await queueOf(round.roundId)).filter((e) => e.review);
      expect(reviews.map((e) => [e.key, e.via]).sort()).toEqual([
        [tenerKey('tu'), tenerKey('tu', 'from')], [tenerKey('yo'), tenerKey('yo', 'from')],
      ]);
      await playAll(api.ana, round.roundId, (e) => e.key === tenerKey('yo') && !e.retry);
      expect(await progressOf(UNIT_1, tenerKey('yo', 'from'))).toMatchObject({ mastered: true, reviewStep: 0, dueAt: new Date(Date.UTC(2026, 9, 9, 7)) });
      expect(await progressOf(UNIT_1, tenerKey('tu', 'from'))).toMatchObject({ mastered: true, reviewStep: 2, dueAt: new Date(Date.UTC(2026, 10, 27, 8)) });
      // The forms themselves climbed (or not) on their own ladder.
      expect(await progressOf(UNIT_1, tenerKey('tu'))).toMatchObject({ level: 1, correct: 1 });
      expect(await progressOf(UNIT_1, tenerKey('yo'))).toMatchObject({ level: 1, wrong: 1, correct: 1 });
    });

    it('finishes a set in another deck whose last form a "name the verb" review writes there, and tells whoever listens', async () => {
      const api = await load();
      const { onConjugationSetFinished, deckQuizState } = await import('./conjugation.js');
      const heard: { deckId: number }[] = [];
      const stop = onConjugationSetFinished((event) => {
        heard.push(event);
      });
      try {
        await twoUnits(api);
        // A third quiz, "name the verb" only, on tener: Ana has every form of it but tengo.
        const TENER_REVIEW = 3;
        await testDb.insert(schema.decks).values({ id: TENER_REVIEW, name: 'Tener review', createdBy: adminUser.id });
        await testDb.insert(schema.cards).values({ deckId: TENER_REVIEW, front: 'tengo', back: 'I have' });
        await api.admin.saveSettings({ deckId: TENER_REVIEW, enabled: true, directions: 'fromForm' });
        const items = (await deckQuizState(TENER_REVIEW)).items.map((i) => i.key);
        expect(items).toContain(tenerKey('yo', 'from'));
        await testDb.insert(schema.conjugationProgress).values([
          ...items.filter((k) => k !== tenerKey('yo', 'from')).map((k) => row(ana.id, TENER_REVIEW, k, {
            mastered: true, dueAt: new Date(FRIDAY + 30 * DAY), firstMasteredAt: new Date(FRIDAY - 30 * DAY),
          })),
          // Divergent since v1.12: never mastered in this deck, mastered and due in Unit 1.
          row(ana.id, TENER_REVIEW, tenerKey('yo', 'from')),
          row(ana.id, UNIT_1, tenerKey('yo', 'from'), { mastered: true, dueAt: new Date(FRIDAY - DAY), reviewStep: 1, firstMasteredAt: new Date(FRIDAY - 60 * DAY) }),
        ]);

        // In Unit 2's round, the due "name the verb" form is reviewed through "give the form", in Unit 1.
        const round = await api.ana.start({ deckId: OTHER_DECK });
        expect((await queueOf(round.roundId)).filter((e) => e.review).map((e) => e.via)).toEqual([tenerKey('yo', 'from')]);
        const { responses } = await playAll(api.ana, round.roundId);

        expect(await progressOf(TENER_REVIEW, tenerKey('yo', 'from'))).toMatchObject({ mastered: true, firstMasteredAt: new Date(FRIDAY) });
        expect(responses.flatMap((r) => r.finishedSets)).toEqual([{ deckId: TENER_REVIEW, deckName: 'Tener review' }]);
        expect(heard.map((e) => e.deckId)).toEqual([TENER_REVIEW]);
      } finally {
        stop();
      }
    });

    it('names the mistake of a wrong answer, links the guide, and stores it with the response time, silently', async () => {
      const api = await load();
      await api.admin.saveSettings({
        deckId: UNIT_1, enabled: true, answerMode: 'typed', directions: 'toForm',
        excludedEntries: ['ser', 'haber-impersonal', 'estar', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'],
      });
      const round = await api.ana.start({ deckId: UNIT_1 });
      const times: unknown[] = [2345.4, 'soon', -5, 1e9, undefined];
      let index = 0;
      for (;;) {
        const entry = await current(round.roundId);
        const answer = entry.person === 'yo' && !entry.retry ? { text: 'tiene' } : await rightAnswer(round.roundId);
        const response = await api.ana.answer({ roundId: round.roundId, index, answer, ms: times[index] });
        if (entry.person === 'yo' && !entry.retry) {
          expect(response.mistake).toEqual({
            kind: 'person', detail: { person: 'el' }, guideSection: 'present-yo', guideSections: ['present-yo', 'present-build', 'persons-glance'],
          });
        } else {
          expect(response.mistake).toBeNull();
        }
        index += 1;
        if (response.finished) break;
      }
      const answers = await testDb.select().from(schema.conjugationAnswers).orderBy(schema.conjugationAnswers.id);
      expect(answers.map((a) => a.responseMs)).toEqual([2345, null, null, 600_000, null, null]);
      const miss = answers.find((a) => a.result === 'wrong');
      expect(miss).toMatchObject({ given: 'tiene', mistakeKind: 'person', mistakeDetail: '{"person":"el"}', retry: false });
      expect(answers.filter((a) => a.retry)).toMatchObject([{ itemKey: tenerKey('yo'), result: 'correct', mistakeKind: null }]);
      // Nothing about time reaches the page.
      expect(JSON.stringify(await api.ana.current({ roundId: round.roundId }).catch(() => ({})))).not.toMatch(/ms|time/i);
    });

    it('names a "name the verb" pick as the person, tense or verb chosen', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, directions: 'fromForm', roundLength: 5 });
      const round = await api.ana.start({ deckId: UNIT_1 });
      const entry = await current(round.roundId);
      expect(entry.built?.levelKind).toBe('choice');
      const response = await api.ana.answer({ roundId: round.roundId, index: 0, answer: await wrongAnswer(round.roundId) });
      expect(['person', 'tense', 'otherVerb', 'dativeNumber']).toContain(response.mistake?.kind);
      const logged = await testDb.select().from(schema.conjugationAnswers);
      expect(logged[0].mistakeKind).toBe(response.mistake?.kind);
    });

    it('gives the teacher days practised, accuracy after a week away, response times, forms due and the commonest mistakes, in the results and the export', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      vi.setSystemTime(FRIDAY + 3 * DAY);
      const round = (userId: number, finishedAt: number | null, queueLength: number, position: number, abandoned = false, prompts = queueLength, firstTryCorrect = 0) => ({
        userId, deckId: UNIT_1, startedAt: new Date((finishedAt ?? FRIDAY) - 60_000), finishedAt: finishedAt === null ? null : new Date(finishedAt),
        abandoned, queue: JSON.stringify(Array.from({ length: queueLength }, () => ({}))), position, prompts, firstTryCorrect, settingsSnapshot: '{}',
      });
      const [a, , , , , b] = await testDb.insert(schema.conjugationRounds).values([
        round(ana.id, FRIDAY, 1, 1), // a miss whose retry was dropped: played to its end all the same
        round(ana.id, FRIDAY + 60_000, 1, 1), // the same school day
        round(ana.id, FRIDAY + DAY, 3, 3, false, 2, 1), // two prompts, one missed and retried: to its end
        round(ana.id, FRIDAY + 2 * DAY, 2, 1, false, 2, 1), // ended after one answer: no practice day
        round(ana.id, FRIDAY + 2 * DAY, 3, 2, false, 2, 1), // ended before the retry: none either
        round(beto.id, FRIDAY, 1, 1, true), // replaced by another round
      ]).returning();
      const answer = (userId: number, roundId: number, itemKey: string, at: number, over: Partial<typeof schema.conjugationAnswers.$inferInsert> = {}) => ({
        roundId, userId, deckId: UNIT_1, itemKey, levelKind: 'typed-lenient' as const, given: 'x', result: 'correct' as const, at: new Date(at), ...over,
      });
      await testDb.insert(schema.conjugationAnswers).values([
        // tener · yo: seen as a form 20 days ago, named 10 days ago (a week away: right), then the next day (not away).
        answer(ana.id, a.id, tenerKey('yo'), FRIDAY - 20 * DAY, { responseMs: 1000 }),
        answer(ana.id, a.id, tenerKey('yo', 'from'), FRIDAY - 10 * DAY, { levelKind: 'choice', responseMs: 500, gapMs: 10 * DAY }),
        answer(ana.id, a.id, tenerKey('yo'), FRIDAY - 9 * DAY, { responseMs: 3000, gapMs: DAY }),
        // ser · yo: a month away, then wrong.
        answer(ana.id, a.id, 'ser|present|yo|-|to', FRIDAY - 30 * DAY, { responseMs: 2000 }),
        answer(ana.id, a.id, 'ser|present|yo|-|to', FRIDAY - DAY, {
          result: 'wrong', given: 'es', mistakeKind: 'person', mistakeDetail: '{"person":"el"}', levelKind: 'choice', responseMs: 700, gapMs: 29 * DAY,
        }),
        answer(ana.id, a.id, 'ser|present|yo|-|to', FRIDAY - DAY + 10_000, { retry: true, responseMs: 9000 }),
        // The commonest mistake: tiene for tengo, three times; teno once. A minute apart, each time well within
        // the time that passed (v1.16 caps a time at that), two under the median and two over.
        ...[1, 2, 3].map((i) => answer(ana.id, a.id, tenerKey('yo'), FRIDAY - 8 * DAY + i * 60_000, {
          result: 'wrong', given: 'tiene', mistakeKind: 'person', mistakeDetail: '{"person":"el"}', responseMs: [1500, 1500, 4000][i - 1],
        })),
        answer(ana.id, a.id, tenerKey('yo'), FRIDAY - 8 * DAY + 4 * 60_000, {
          result: 'wrong', given: 'teno', mistakeKind: 'regularized', mistakeDetail: '{"change":"yo"}', responseMs: 4000,
        }),
        answer(beto.id, b.id, 'gustarle|present|yo|sg|to', FRIDAY, { result: 'wrong', given: 'me gustan', mistakeKind: 'dativeNumber', mistakeDetail: '{"number":"pl"}' }),
        // The teacher's own tries are not the class's.
        answer(adminUser.id, b.id, tenerKey('yo'), FRIDAY, { result: 'wrong', given: 'tenemos', mistakeKind: 'person', mistakeDetail: '{"person":"nosotros"}' }),
      ]);

      const results = await api.admin.results({ deckId: UNIT_1 });
      expect(results.students.find((s) => s.name === 'Ana')).toMatchObject({
        daysPractised: 2, daysPractised14: 2, delayedAnswers: 2, delayedAccuracy: 0.5, medianTypedMs: 2000, medianChoiceMs: 600, due: 0,
        timeMismatches: 0, veryFast: false,
      });
      // Beto's answer sent no time: the minute since his round began stands in (v1.16).
      expect(results.students.find((s) => s.name === '=Beto')).toMatchObject({ daysPractised: 0, delayedAnswers: 0, delayedAccuracy: null, medianTypedMs: 60_000, medianChoiceMs: null });
      expect(results.topMistakes).toEqual([
        {
          key: 'person:el', kind: 'person', detail: { person: 'el' }, count: 4,
          example: { given: 'tiene', itemKey: tenerKey('yo'), expected: 'tengo', prompt: 'tener · yo · presente' },
        },
        expect.objectContaining({ key: 'dativeNumber:pl', count: 1 }),
        expect.objectContaining({ key: 'regularized:yo', count: 1, example: expect.objectContaining({ given: 'teno' }) }),
      ]);

      const { csv } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
      const anaRow = csv.split('\n').find((line) => line.startsWith('"Ana"'));
      expect(anaRow?.split(',').slice(11)).toEqual([
        '0', '2', '2', '2', '50.0', '2.0', '0.6', '"él/ella/Ud. form for another person"', '4', '"tiene for tengo (tener · yo · presente)"', '0',
      ]);
    });

    it('tells a student who has mastered every form of a quiz at least once, and whoever listens', async () => {
      const api = await load();
      const { onConjugationSetFinished } = await import('./conjugation.js');
      const heard: unknown[] = [];
      const stop = onConjugationSetFinished((event) => {
        heard.push(event);
      });
      try {
        await api.admin.saveSettings({
          deckId: UNIT_1, enabled: true, directions: 'toForm',
          excludedEntries: ['ser', 'haber-impersonal', 'estar', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir'],
        });
        await testDb.insert(schema.conjugationProgress).values([
          ...TENER.slice(0, 4).map((p) => row(ana.id, UNIT_1, tenerKey(p), {
            level: 2, mastered: true, dueAt: new Date(FRIDAY + 5 * DAY), firstMasteredAt: new Date(FRIDAY - 7 * DAY),
          })),
          row(ana.id, UNIT_1, tenerKey('ellos'), { level: 2, firstTopDay: '2026-10-01' }),
        ]);
        const round = await api.ana.start({ deckId: UNIT_1 });
        const { responses } = await playAll(api.ana, round.roundId);
        const finishing = responses.filter((r) => r.finishedSets.length > 0);
        expect(finishing).toHaveLength(1);
        expect(finishing[0]).toMatchObject({ masteredNow: true, finishedSets: [{ deckId: UNIT_1, deckName: 'Unit 1' }] });
        // No extension loaded: nothing beyond core's fields (an extension's: the answer hook).
        expect(Object.keys(finishing[0]).sort()).toEqual(CORE_ANSWER_KEYS);
        expect(heard).toEqual([{ userId: ana.id, deckId: UNIT_1, deckName: 'Unit 1', at: new Date(FRIDAY) }]);
        // A retried request gets the same message; the listener is not told twice.
        const index = responses.indexOf(finishing[0]);
        if (index === responses.length - 1) {
          const answers = await testDb.select().from(schema.conjugationAnswers).orderBy(schema.conjugationAnswers.id);
          const replay = await api.ana.answer({ roundId: round.roundId, index, answer: { text: answers[answers.length - 1].given } });
          expect(replay.finishedSets).toEqual(finishing[0].finishedSets);
        }
        expect(heard).toHaveLength(1);
      } finally {
        stop();
      }
    });

    describe('answer times: never more than the time that passed (v1.16)', () => {
      /** Answers the waiting prompt right at FRIDAY + `at` ms, with the page's `ms` when given. */
      async function answerAt(caller: Caller, roundId: number, index: number, at: number, ms?: number) {
        vi.setSystemTime(FRIDAY + at);
        return caller.answer({ roundId, index, answer: await rightAnswer(roundId), ...(ms === undefined ? {} : { ms }) });
      }
      const timesOf = async (api: Api, name = 'Ana', deckId = UNIT_1) =>
        (await api.admin.results({ deckId })).students.find((s) => s.name === name);

      beforeEach(async () => {
        const api = await load();
        // New forms: every first try is multiple choice.
        await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
      });

      it('caps a time the page claims at the time that passed, the first answer from the round’s start, and counts each', async () => {
        const api = await load();
        const round = await api.ana.start({ deckId: UNIT_1 });
        // A script that sends 4.2 s while answering every 0.3 s.
        for (let index = 0; index < 3; index++) await answerAt(api.ana, round.roundId, index, 300 * (index + 1), 4200);
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: 300, medianTypedMs: null, timeMismatches: 3, veryFast: false });
        // The page's claim is stored as it came; only what the teacher reads is capped.
        const stored = await testDb.select().from(schema.conjugationAnswers).orderBy(schema.conjugationAnswers.id);
        expect(stored.map((a) => a.responseMs)).toEqual([4200, 4200, 4200]);
        // The export agrees: median_typed_s, median_choice_s.
        const { csv } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
        expect(csv.split('\n').find((line) => line.startsWith('"Ana"'))?.split(',').slice(16, 18)).toEqual(['', '0.3']);
      });

      it('keeps an honest time as the page measured it, and uses the time that passed when the page sent none', async () => {
        const api = await load();
        const honest = await api.ana.start({ deckId: UNIT_1 });
        for (let index = 0; index < 3; index++) await answerAt(api.ana, honest.roundId, index, 5000 * (index + 1), 3200);
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: 3200, timeMismatches: 0 });

        vi.setSystemTime(FRIDAY + 60_000);
        const silent = await api.beto.start({ deckId: UNIT_1 });
        for (const [index, at] of [62_000, 64_500, 67_500].entries()) await answerAt(api.beto, silent.roundId, index, at);
        expect(await timesOf(api, '=Beto')).toMatchObject({ medianChoiceMs: 2500, timeMismatches: 0 });
      });

      it('keeps the time of an answer given after a reload minutes later', async () => {
        const api = await load();
        const round = await api.ana.start({ deckId: UNIT_1 });
        await answerAt(api.ana, round.roundId, 0, 3000, 2500);
        // The page reloads four minutes on and picks the round up; the next answer takes 3.5 s.
        vi.setSystemTime(FRIDAY + 4 * 60_000);
        expect(await api.ana.current({ roundId: round.roundId })).toMatchObject({ index: 1 });
        await answerAt(api.ana, round.roundId, 1, 4 * 60_000 + 3500, 3500);
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: 3000, timeMismatches: 0 });
      });

      it('takes a gap made negative by the server’s clock going back as unknown', async () => {
        const api = await load();
        const round = await api.ana.start({ deckId: UNIT_1 });
        await answerAt(api.ana, round.roundId, 0, 3000, 2000);
        // The clock goes back 10 s: the page's time stands, unchecked.
        await answerAt(api.ana, round.roundId, 1, -7000, 2600);
        // Back again, with no time sent: nothing to go on.
        await answerAt(api.ana, round.roundId, 2, -9000);
        await answerAt(api.ana, round.roundId, 3, -6000, 2800);
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: 2600, timeMismatches: 0 });
      });

      it('measures a round with answers in two decks answer to answer, whichever deck each is kept under', async () => {
        const api = await load();
        await twoUnits(api, { deckId: UNIT_1, accentMode: 'forgiven' });
        // Mastered in Unit 1 and due: a Unit 2 round brings them back as reviews, kept under Unit 1.
        await testDb.insert(schema.conjugationProgress).values(TENER.map((p, i) => row(ana.id, UNIT_1, tenerKey(p), {
          level: 1, mastered: true, dueAt: new Date(FRIDAY - (7 + i) * DAY), reviewStep: 0,
        })));
        const round = await api.ana.start({ deckId: OTHER_DECK });
        // One answer a second, each claiming 2.5 s.
        const decks: number[] = [];
        for (let index = 0; ; index++) {
          decks.push((await current(round.roundId)).deckId ?? OTHER_DECK);
          if ((await answerAt(api.ana, round.roundId, index, 1000 * (index + 1), 2500)).finished) break;
        }
        const reviews = decks.filter((d) => d === UNIT_1).length;
        expect(reviews).toBe(5);
        // Every gap is the second since the answer before, in either deck: all capped, all counted.
        expect(await timesOf(api, 'Ana', UNIT_1)).toMatchObject({ medianTypedMs: 1000, timeMismatches: reviews });
        expect(await timesOf(api, 'Ana', OTHER_DECK)).toMatchObject({ medianChoiceMs: 1000, timeMismatches: decks.length - reviews });
      });

      it('walks only the rounds holding an asked deck, each whole: a deck’s times are the same whatever other decks are asked', async () => {
        const { responseTimes } = await import('./conjugation.js');
        const api = await load();
        await twoUnits(api, { deckId: UNIT_1, accentMode: 'forgiven' });
        // A Unit 2 round with nothing of Unit 1 in it, an answer every 4 s and no time sent.
        const alone = await api.ana.start({ deckId: OTHER_DECK });
        let at = 0;
        let aloneAnswers = 0;
        for (let index = 0; ; index++) {
          at += 4000;
          aloneAnswers += 1;
          if ((await answerAt(api.ana, alone.roundId, index, at)).finished) break;
        }
        // Half a minute on, Unit 1's forms are due and the next Unit 2 round mixes them in:
        // an answer a second, each claiming 2.5 s.
        await testDb.insert(schema.conjugationProgress).values(TENER.map((p, i) => row(ana.id, UNIT_1, tenerKey(p), {
          level: 1, mastered: true, dueAt: new Date(FRIDAY - (7 + i) * DAY), reviewStep: 0,
        })));
        at += 30_000;
        vi.setSystemTime(FRIDAY + at);
        const mixed = await api.ana.start({ deckId: OTHER_DECK });
        const decks: number[] = [];
        for (let index = 0; ; index++) {
          decks.push((await current(mixed.roundId)).deckId ?? OTHER_DECK);
          if ((await answerAt(api.ana, mixed.roundId, index, at + 1000 * (index + 1), 2500)).finished) break;
        }
        const reviews = decks.filter((d) => d === UNIT_1).length;
        expect(reviews).toBeGreaterThan(0);

        const ids = [ana.id, beto.id];
        const unit1 = await responseTimes(ids, [UNIT_1]);
        const unit2 = await responseTimes(ids, [OTHER_DECK]);
        const both = await responseTimes(ids, [UNIT_1, OTHER_DECK]);
        // Only the mixed round's Unit 1 answers come back for Unit 1, each a second after the answer
        // before it in either deck (the first a second after the round's start, not after the other round).
        expect([...unit1.keys()]).toEqual([`${ana.id}:${UNIT_1}`]);
        expect(unit1.get(`${ana.id}:${UNIT_1}`)).toMatchObject({
          typedMs: 1000, choiceMs: null, typedTries: reviews, choiceTries: 0, timeMismatches: reviews,
        });
        // Unit 2 holds both rounds: no time sent in the first, 2.5 s claimed over a 1 s gap in the second.
        const own = unit2.get(`${ana.id}:${OTHER_DECK}`)!;
        expect([...unit2.keys()]).toEqual([`${ana.id}:${OTHER_DECK}`]);
        expect(own.typedTries + own.choiceTries).toBe(aloneAnswers + decks.length - reviews);
        expect(own.timeMismatches).toBe(decks.length - reviews);
        // Asking for both decks at once changes neither.
        expect(both).toEqual(new Map([[`${ana.id}:${UNIT_1}`, unit1.get(`${ana.id}:${UNIT_1}`)], [`${ana.id}:${OTHER_DECK}`, own]]));
      });

      it('on a long history, finds the asked deck’s rounds through the indexes and times them as walking everything would', async () => {
        const { responseTimes, responseTimesQuery } = await import('./conjugation.js');
        // A class year in small: 30 students, 6 decks, 24 rounds each of 12 answers, a quarter of them
        // reviews kept under the deck before; times from 0.4 to 6 s, some claims longer than the gap.
        const DECKS = [UNIT_1, OTHER_DECK, 3, 4, 5, 6];
        const students = Array.from({ length: 30 }, (_, i) => 100 + i);
        await testDb.insert(schema.decks).values(DECKS.slice(2).map((id) => ({ id, name: `Unit ${id}`, createdBy: adminUser.id })));
        await testDb.insert(schema.users).values(students.map((id) => ({ id, googleId: `g-${id}`, email: `s${id}@example.com`, name: `S${id}`, role: 'user' as const })));
        const random = seededRandom(7);
        const addRound = sqlite.prepare(`INSERT INTO conjugation_rounds (user_id, deck_id, started_at, finished_at, queue, prompts, settings_snapshot)
          VALUES (?, ?, ?, ?, '[]', 12, '{}')`);
        const addAnswer = sqlite.prepare(`INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at, response_ms, retry)
          VALUES (?, ?, ?, ?, ?, 'x', 'correct', ?, ?, ?)`);
        let clock = FRIDAY - 200 * DAY;
        sqlite.transaction(() => {
          for (let r = 0; r < 24; r++) {
            for (const userId of students) {
              const deck = DECKS[(r + userId) % DECKS.length];
              clock += 60_000;
              const roundId = Number(addRound.run(userId, deck, clock, clock + 60_000).lastInsertRowid);
              let at = clock;
              for (let a = 0; a < 12; a++) {
                at += 400 + Math.floor(random() * 5600);
                const kept = a % 4 === 0 && deck !== UNIT_1 ? DECKS[DECKS.indexOf(deck) - 1] : deck;
                const claim = random() < 0.1 ? null : Math.floor(random() * 7000);
                addAnswer.run(roundId, userId, kept, `k${a}`, a % 2 ? 'choice' : 'typed-lenient', at, claim, a >= 10 ? 1 : 0);
              }
            }
          }
        })();
        expect(sqlite.prepare('SELECT count(*) AS n FROM conjugation_answers').get()).toEqual({ n: 30 * 24 * 12 });

        // Unbounded: the gaps over every answer the students ever gave, then the deck's kept.
        const everything = (deckIds: number[]) => sqlite.prepare(`
          SELECT user_id, deck_id, level_kind, retry, ms, gap FROM (
            SELECT a.user_id AS user_id, a.deck_id AS deck_id, a.level_kind AS level_kind, a.retry AS retry, a.response_ms AS ms,
              a.at - COALESCE(LAG(a.at) OVER (PARTITION BY a.round_id ORDER BY a.id), r.started_at) AS gap
            FROM conjugation_answers a JOIN conjugation_rounds r ON r.id = a.round_id
            WHERE a.user_id IN (${students.join(',')})
          ) WHERE deck_id IN (${deckIds.join(',')})`).all();
        const sorted = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
        for (const deckIds of [[3], [UNIT_1], [OTHER_DECK, 5]]) {
          const bounded = await testDb.all(responseTimesQuery(students, deckIds));
          expect(bounded.length).toBeGreaterThan(0);
          expect(sorted(bounded)).toEqual(sorted(everything(deckIds)));
        }
        // Each deck's numbers are the same asked alone or with every other deck.
        const all = await responseTimes(students, DECKS);
        const one = await responseTimes(students, [3]);
        expect(one.size).toBe(students.length);
        expect(one).toEqual(new Map([...all].filter(([key]) => key.endsWith(':3'))));
        expect([...one.values()].some((times) => times.timeMismatches > 0)).toBe(true);

        // The plan: the asked deck's answers by the deck index, then each round's answers by the round
        // index. Never a walk of every answer of the students (their index), nor of the whole table.
        const plan = (await testDb.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${responseTimesQuery(students, [3])}`))
          .map((step) => step.detail);
        expect(plan).toContainEqual(expect.stringMatching(/^SEARCH conjugation_answers USING INDEX idx_conjugation_answers_deck_item \(deck_id=\?\)/));
        expect(plan).toContainEqual(expect.stringMatching(/^SEARCH a USING INDEX idx_conjugation_answers_round \(round_id=\?\)/));
        expect(plan.filter((step) => /idx_conjugation_answers_user|^SCAN (a|conjugation_answers)\b/.test(step))).toEqual([]);
      });

      it('notes "Very fast" at a median first try under the line, over enough first tries', async () => {
        const { VERY_FAST_CHOICE_MS, VERY_FAST_MIN_TRIES } = await import('./conjugation.js');
        const api = await load();
        await api.admin.saveSettings({ deckId: UNIT_1, roundLength: VERY_FAST_MIN_TRIES + 2 });
        const round = await api.ana.start({ deckId: UNIT_1 });
        const quick = VERY_FAST_CHOICE_MS - 100;
        for (let index = 0; index < VERY_FAST_MIN_TRIES - 1; index++) {
          await answerAt(api.ana, round.roundId, index, 1000 * (index + 1), quick);
        }
        // One first try short: too few to say.
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: quick, veryFast: false });
        await answerAt(api.ana, round.roundId, VERY_FAST_MIN_TRIES - 1, 1000 * VERY_FAST_MIN_TRIES, quick);
        expect(await timesOf(api)).toMatchObject({ medianChoiceMs: quick, veryFast: true, timeMismatches: 0 });
      });
    });
  });

  describe('"Study all" (v1.18.0)', () => {
    const queueOf = async (roundId: number) => JSON.parse((await roundRow(roundId))!.queue) as QueueEntry[];
    /** Plays a round to its end from `start`, right unless `wrong` says otherwise; returns every response and the entries answered. */
    async function playAll(caller: Caller, roundId: number, wrong: (e: QueueEntry) => boolean = () => false, start = 0) {
      const responses = [];
      const entries: QueueEntry[] = [];
      for (let index = start; ; index++) {
        const entry = await current(roundId);
        entries.push(entry);
        const answer = wrong(entry) ? await wrongAnswer(roundId) : await rightAnswer(roundId);
        const response = await caller.answer({ roundId, index, answer });
        responses.push(response);
        if (response.finished) return { responses, entries };
      }
    }
    /** Unit 2 (hablar, comer) for Ana's period too, both quizzes on. Both decks were made at once: the higher id is newer. */
    async function twoUnits(api: Api) {
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: true });
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      await testDb.insert(schema.deckGroups).values({ deckId: OTHER_DECK, groupId: PERIOD_1 });
    }

    it('plays 20 questions from every quiz the student may play, newest deck first, each under its own deck', async () => {
      const api = await load();
      await twoUnits(api);
      const round = await api.ana.startAll();
      expect(round).toMatchObject({ scope: 'all', deckId: OTHER_DECK, deckName: 'Unit 2', total: 20, index: 0, answers: 0, review: false });
      expect(round.prompt.fromDeck).toMatchObject({ deckName: expect.stringMatching(/^Unit [12]$/) });
      expect(JSON.stringify(round)).not.toMatch(/accepted|correctOptions|queue|seed/);
      expect(await roundRow(round.roundId)).toMatchObject({ scope: 'all', deckId: OTHER_DECK, prompts: 20 });
      // Unit 2's ten new forms (hablar, comer) first, then Unit 1's: every prompt names its deck.
      const queue = await queueOf(round.roundId);
      expect(queue.filter((e) => e.deckId === OTHER_DECK)).toHaveLength(10);
      expect(queue.filter((e) => e.deckId === UNIT_1)).toHaveLength(10);

      const { responses, entries } = await playAll(api.ana, round.roundId);
      for (const [i, entry] of entries.entries()) {
        expect(responses[i].next === null || responses[i].next?.fromDeck?.deckName).toBeTruthy();
        expect(entry.deckId).toBeDefined();
      }
      const summary = responses.at(-1)!.summary!;
      expect(summary).toMatchObject({ scope: 'all', prompts: 20, firstTryCorrect: 20, abandoned: false, mastered: 0, climbing: 20, total: 20 + 102 });
      expect(summary.decks?.map((d) => [d.deckId, d.deckName, d.climbing, d.total])).toEqual([[OTHER_DECK, 'Unit 2', 10, 20], [UNIT_1, 'Unit 1', 10, 102]]);
      // Each answer, and its progress, under the form's own deck.
      const answers = await testDb.select().from(schema.conjugationAnswers);
      expect(answers.map((a) => a.deckId).sort()).toEqual([...Array(10).fill(UNIT_1), ...Array(10).fill(OTHER_DECK)]);
      const rows = await testDb.select().from(schema.conjugationProgress).where(eq(schema.conjugationProgress.userId, ana.id));
      expect(rows.filter((r) => r.deckId === UNIT_1)).toHaveLength(10);
      expect(rows.filter((r) => r.deckId === OTHER_DECK)).toHaveLength(10);

      // Study all's own numbers; each deck's leave the round out.
      const overview = await api.ana.studyAllOverview();
      expect(overview).toMatchObject({
        scope: 'all', deckId: OTHER_DECK, deckName: 'Unit 2', roundLength: 20, rounds: 1, lastScore: 1, bestScore: 1,
        openRound: null, mastered: 0, climbing: 20, total: 122, due: 0, includeVosotros: false, vos: 'none', directions: 'both',
        tenses: [{ id: 'present', label: 'presente' }], reachedRungs: ['choice', 'typed-lenient'],
      });
      expect(overview.decks.map((d) => [d.deckId, d.climbing, d.total])).toEqual([[OTHER_DECK, 10, 20], [UNIT_1, 10, 102]]);
      expect(overview.verbs.map((v) => v.entry)).toEqual(['hablar', 'comer', 'ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir']);
      expect(await api.ana.overview({ deckId: OTHER_DECK })).toMatchObject({ rounds: 0, lastScore: null, openRound: null });
      expect((await api.ana.myQuizzes()).map((q) => q.lastScore)).toEqual([null, null]);

      // Newest by creation, not by id: Unit 1 made later leads.
      await testDb.update(schema.decks).set({ createdAt: new Date(Date.now() + DAY) }).where(eq(schema.decks.id, UNIT_1));
      expect(await api.ana.startAll()).toMatchObject({ deckId: UNIT_1, deckName: 'Unit 1' });
    });

    it('keeps a deck’s own round and a Study all round apart: each replaces only its own kind', async () => {
      const api = await load();
      await twoUnits(api);
      const all = await api.ana.startAll();
      await api.ana.answer({ roundId: all.roundId, index: 0, answer: await rightAnswer(all.roundId) });
      // The deck it leads starts its own round: the Study all round stays open.
      const own = await api.ana.start({ deckId: OTHER_DECK });
      expect(own.scope).toBe('deck');
      expect(await roundRow(all.roundId)).toMatchObject({ finishedAt: null, abandoned: false });
      expect((await api.ana.overview({ deckId: OTHER_DECK })).openRound).toMatchObject({ roundId: own.roundId });
      expect((await api.ana.studyAllOverview()).openRound).toMatchObject({ roundId: all.roundId, index: 1, total: 20, answers: 1 });
      const resumed = await api.ana.current({ roundId: all.roundId });
      expect(resumed).toMatchObject({ scope: 'all', deckId: OTHER_DECK, deckName: 'Unit 2', index: 1, total: 20 });
      expect(JSON.stringify(resumed)).not.toMatch(/accepted|correctOptions|queue|seed/);
      // A new Study all round replaces the old one, never the deck's.
      await api.ana.startAll();
      expect(await roundRow(all.roundId)).toMatchObject({ abandoned: true, finishedAt: expect.any(Date) });
      expect(await roundRow(own.roundId)).toMatchObject({ finishedAt: null, abandoned: false });
      expect((await api.ana.finish({ roundId: all.roundId })).abandoned).toBe(true);
    });

    it('needs a quiz the student may play: none, all turned off mid-round, or one taken away (its prompts dropped)', async () => {
      const api = await load();
      const none = { code: 'NOT_FOUND', cause: { appCode: 'CONJUGATION_NONE' } };
      await expect(api.ana.startAll()).rejects.toMatchObject(none);
      expect(await api.ana.studyAllOverview()).toMatchObject({ decks: [], deckId: null, total: 0, openRound: null, rounds: 0 });
      // A quiz with no verbs yet.
      await testDb.insert(schema.decks).values({ id: 9, name: 'Saludos', createdBy: adminUser.id });
      await testDb.insert(schema.cards).values({ deckId: 9, front: 'hola', back: 'hello' });
      await testDb.insert(schema.deckGroups).values({ deckId: 9, groupId: PERIOD_1 });
      await api.admin.saveSettings({ deckId: 9, enabled: true });
      await expect(api.ana.startAll()).rejects.toMatchObject({ code: 'BAD_REQUEST', cause: { appCode: 'CONJUGATION_EMPTY' } });

      await twoUnits(api);
      const round = await api.ana.startAll();
      const answer = await rightAnswer(round.roundId);
      await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      // Unit 1 turned off: its prompts are dropped before they are shown (the one on screen is still taken), and the round goes on.
      await api.admin.saveSettings({ deckId: UNIT_1, enabled: false });
      const { responses, entries } = await playAll(api.ana, round.roundId, () => false, 1);
      expect(entries.slice(1).every((e) => e.deckId === OTHER_DECK)).toBe(true);
      const last = responses.at(-1)!;
      expect(last.summary).toMatchObject({ scope: 'all', abandoned: false });
      expect(last.summary?.prompts).toBeLessThan(20);
      // Every quiz off: refused, as a deck's round is when its quiz is.
      const next = await api.ana.startAll();
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: false });
      await api.admin.saveSettings({ deckId: 9, enabled: false });
      await expect(api.ana.answer({ roundId: next.roundId, index: 0, answer: await rightAnswer(next.roundId) })).rejects.toMatchObject(none);
      await expect(api.ana.current({ roundId: next.roundId })).rejects.toMatchObject(none);
      await expect(api.ana.finish({ roundId: next.roundId })).rejects.toMatchObject(none);
      // Someone else's round is reported like a missing one.
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      await expect(api.beto.current({ roundId: next.roundId })).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'ROUND_NOT_FOUND' } });
    });

    it('counts a Study all round under each deck it asked forms of, in the results, the export and the student’s page, never in a deck’s scores', async () => {
      const api = await load();
      await twoUnits(api);
      const round = await api.ana.startAll();
      // One of Unit 1's forms missed (the round's forms are drawn at random: the first of Unit 1's, whatever it is).
      let missed = false;
      await playAll(api.ana, round.roundId, (e) => {
        if (missed || e.deckId !== UNIT_1 || e.retry) return false;
        missed = true;
        return true;
      });
      for (const deckId of [UNIT_1, OTHER_DECK]) {
        const results = await api.admin.results({ deckId });
        expect(results.students.find((s) => s.name === 'Ana')).toMatchObject({
          rounds: 0, lastScore: null, bestScore: null, studyAllRounds: 1, daysPractised: 1, lastPlayed: expect.any(Date),
        });
        expect(results.students.find((s) => s.name === '=Beto')).toMatchObject({ studyAllRounds: 0 });
      }
      // A miss in Unit 1 is Unit 1's.
      expect((await api.admin.results({ deckId: UNIT_1 })).mostMissed.length).toBeGreaterThan(0);
      expect((await api.admin.results({ deckId: OTHER_DECK })).mostMissed).toEqual([]);
      const { csv } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
      const anaRows = csv.split('\n').filter((line) => line.startsWith('"Ana"'));
      expect(anaRows).toHaveLength(2);
      for (const line of anaRows) {
        const cells = line.split(',');
        expect(cells[3]).toBe('played');
        expect(cells[4]).toBe('0');
        expect(cells.at(-1)).toBe('1');
      }
      const detail = await api.adminApi.userDetail({ userId: ana.id });
      expect(detail.conjugation.map((c) => [c.deckId, c.rounds, c.daysPractised])).toEqual(
        expect.arrayContaining([[UNIT_1, 0, 1], [OTHER_DECK, 0, 1]]),
      );
    });

    it('keeps a Study all round, and the older decks’ answers in it, when the deck that leads it is deleted', async () => {
      const api = await load();
      await twoUnits(api);
      // Unit 2 (the newest) leads; half the round is Unit 1's.
      const round = await api.ana.startAll();
      await playAll(api.ana, round.roundId);
      // A round of Unit 2's forms only goes with it: nothing else to keep.
      await testDb.update(schema.deckConjugation).set({ enabled: false }).where(eq(schema.deckConjugation.deckId, UNIT_1));
      const alone = await api.ana.startAll();
      expect(alone.deckId).toBe(OTHER_DECK);
      await testDb.update(schema.deckConjugation).set({ enabled: true }).where(eq(schema.deckConjugation.deckId, UNIT_1));
      // Carla's open round (her period has both units), led by Unit 2, nothing answered yet: its snapshot names Unit 1 next.
      await testDb.insert(schema.deckGroups).values({ deckId: UNIT_1, groupId: PERIOD_2 });
      const open = await api.carla.startAll();
      // A deck's own round of Unit 2 goes with its deck, as always.
      const own = await api.ana.start({ deckId: OTHER_DECK });
      const before = await api.admin.results({ deckId: UNIT_1 });
      const anaBefore = before.students.find((s) => s.name === 'Ana');
      expect(anaBefore).toMatchObject({ studyAllRounds: 1, daysPractised: 1 });

      // Unit 2 deleted (say, to import it again).
      await api.adminApi.deleteDeck({ id: OTHER_DECK });

      expect(await roundRow(round.roundId)).toMatchObject({ scope: 'all', deckId: UNIT_1 });
      expect(await roundRow(open.roundId)).toMatchObject({ scope: 'all', deckId: UNIT_1, finishedAt: null });
      expect(await roundRow(alone.roundId)).toBeUndefined();
      expect(await roundRow(own.roundId)).toBeUndefined();
      // Unit 1's answers stay; Unit 2's go with their deck.
      const answers = await testDb.select().from(schema.conjugationAnswers).where(eq(schema.conjugationAnswers.roundId, round.roundId));
      expect(answers.map((a) => a.deckId)).toEqual(Array(10).fill(UNIT_1));
      // The teacher's numbers for Unit 1 are as they were (but its median times: these answers sent no
      // time, and the time that passed since the round's answer before, now an earlier one, stands in).
      const after = await api.admin.results({ deckId: UNIT_1 });
      const withoutTimes = ({ medianChoiceMs: _c, medianTypedMs: _t, ...rest }: NonNullable<typeof anaBefore>) => rest;
      expect(withoutTimes(after.students.find((s) => s.name === 'Ana')!)).toEqual(withoutTimes(anaBefore!));
      expect(after.students.find((s) => s.name === 'Ana')?.medianChoiceMs).toEqual(expect.any(Number));
      expect(after.mostMissed).toEqual(before.mostMissed);
      const { csv } = await api.adminApi.exportGroupData({ groupId: PERIOD_1, dataset: 'conjugation' });
      const anaRow = csv.split('\n').find((line) => line.startsWith('"Ana"'))!;
      expect(anaRow.split(',')[2]).toBe('"Unit 1"');
      expect(anaRow.split(',').at(-1)).toBe('1');
      // The student's own Study all numbers keep the round too.
      expect(await api.ana.studyAllOverview()).toMatchObject({ rounds: 1, lastScore: 1 });
    });

    it('lets a teacher try Study all with every quiz turned on', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: OTHER_DECK, enabled: true });
      // The teacher is in no group of Unit 2: every quiz turned on is theirs to try.
      const round = await api.admin.startAll();
      expect(round).toMatchObject({ scope: 'all', deckId: OTHER_DECK, total: 10 });
      const { responses } = await playAll(api.admin, round.roundId);
      expect(responses.at(-1)?.summary).toMatchObject({ scope: 'all' });
      expect(Object.keys(responses.at(-1)!.summary!).sort()).toEqual(CORE_SUMMARY_KEYS);
    });
  });

  describe('migration 0036', () => {
    it('keeps v1.12 progress: mastered rows due now at the first step, "name the verb" rows past multiple choice mastered', async () => {
      const { default: Database } = await import('better-sqlite3');
      const { drizzle } = await import('drizzle-orm/better-sqlite3');
      const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
      const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import('fs');
      const { dirname, join, resolve } = await import('path');
      const { tmpdir } = await import('os');
      const { fileURLToPath } = await import('url');
      const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
      // The migrations of v1.12, to build the database it left behind.
      const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
      const upTo = journal.entries.findIndex((e) => e.tag === '0035_vocab_voice');
      const dir = mkdtempSync(join(tmpdir(), 'libresrs-migrations-'));
      mkdirSync(join(dir, 'meta'));
      writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }));
      for (const { tag } of journal.entries.slice(0, upTo + 1)) copyFileSync(join(folder, `${tag}.sql`), join(dir, `${tag}.sql`));

      const sqlite = new Database(':memory:');
      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder: dir });
      await db.insert(schema.users).values({ id: 1, googleId: 'g', email: 's@example.com', name: 'S' });
      await db.insert(schema.decks).values({ id: 1, name: 'Unit 1', createdBy: 1 });
      // The v1.12 rows, in the v1.12 columns.
      sqlite.exec(`
        INSERT INTO conjugation_progress (user_id, deck_id, item_key, level, mastered, correct, wrong, last_at) VALUES
          (1, 1, 'tener|present|yo|-|to', 2, 1, 3, 0, 1000),
          (1, 1, 'tener|present|yo|-|from', 1, 0, 1, 0, 2000),
          (1, 1, 'tener|present|tu|-|from', 2, 0, 2, 0, 3000),
          (1, 1, 'tener|present|el|-|from', 0, 0, 0, 1, 4000),
          (1, 1, 'tener|present|el|-|to', 1, 0, 1, 0, 5000);
        INSERT INTO conjugation_rounds (id, user_id, deck_id, started_at, queue, prompts, settings_snapshot) VALUES (1, 1, 1, 0, '[]', 0, '{}');
        INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at) VALUES
          (1, 1, 1, 'tener|present|yo|-|to', 'choice', 'tengo', 'correct', 0),
          (1, 1, 1, 'ser|present|yo|-|to', 'choice', 'soy', 'correct', 1000),
          (1, 1, 1, 'tener|present|yo|-|from', 'choice', 'tener · yo', 'correct', ${8 * DAY}),
          (1, 1, 1, 'tener|present|yo|-|to', 'choice', 'tengo', 'correct', ${8 * DAY + 5000});
      `);
      const before = Date.now();
      migrate(db, { migrationsFolder: folder });
      const after = Date.now();
      const rows = await db.select().from(schema.conjugationProgress).orderBy(schema.conjugationProgress.lastAt);
      const byKey = new Map(rows.map((r) => [r.itemKey, r]));
      for (const key of ['tener|present|yo|-|to', 'tener|present|yo|-|from', 'tener|present|tu|-|from']) {
        const r = byKey.get(key)!;
        expect(r.mastered, key).toBe(true);
        expect(r.reviewStep, key).toBe(0);
        expect(r.dueAt!.getTime(), key).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
        expect(r.dueAt!.getTime(), key).toBeLessThanOrEqual(after);
        expect(r.firstMasteredAt, key).toEqual(r.lastAt);
        expect(r.firstTopDay, key).toBeNull();
      }
      for (const key of ['tener|present|el|-|from', 'tener|present|el|-|to']) {
        expect(byKey.get(key), key).toMatchObject({ mastered: false, dueAt: null, reviewStep: 0, firstMasteredAt: null, firstTopDay: null });
      }
      expect(byKey.get('tener|present|el|-|to')).toMatchObject({ level: 1, correct: 1 });
      const old = await db.select().from(schema.conjugationAnswers).orderBy(schema.conjugationAnswers.id);
      expect(old[0]).toMatchObject({ given: 'tengo', responseMs: null, mistakeKind: null, mistakeDetail: null, retry: false, review: false });
      // The gap since the same form was last answered, either direction: none the first time.
      expect(old.map((a) => a.gapMs)).toEqual([null, null, 8 * DAY, 5000]);
      sqlite.close();
    });
  });

  it('forgets a deck’s quiz with the deck', async () => {
    const api = await load();
    await api.admin.saveSettings({ deckId: UNIT_1, enabled: true, roundLength: 5 });
    const round = await api.ana.start({ deckId: UNIT_1 });
    await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
    await testDb.delete(schema.decks).where(eq(schema.decks.id, UNIT_1));
    for (const table of ['deck_conjugation', 'conjugation_rounds', 'conjugation_progress', 'conjugation_answers']) {
      expect((await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });
});
