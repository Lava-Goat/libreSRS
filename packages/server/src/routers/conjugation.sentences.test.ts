// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Sentences with a blank (v1.25.0) through the router: the deck's mode and
 * holdback, prompts shown as sentences on every rung (with nothing of the
 * answer sent early), the echo trimmed before grading, what each answer
 * records, the student's report, the teacher's Sentences panel and results.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import type { QueueEntry, RoundSnapshot } from '../services/conjugationQuiz.js';
import { holdbackArm } from '../services/conjugationSentences.js';

const { client, db: testDb } = createTestDb();

const adminUser = { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
type AnyUser = typeof adminUser | typeof ana;

const PERIOD_1 = 1;
const UNIT_1 = 1;
const UNIT_2 = 2;

const cards = (deckId: number, list: string) => list.split('; ').map((pair) => {
  const [front, back] = pair.split(' | ');
  return { deckId, front, back };
});
/** Unit 1: the first verbs and a few words. */
const UNIT1_CARDS = cards(UNIT_1, 'es | he/she/it is (ser); soy | I am (ser); tiene | has; tengo | I have; mi | my; en | in, on, at; y | and; escuela | school; perro | dog');
/** Unit 2, after it in the same group: the family, and vivir. */
const UNIT2_CARDS = cards(UNIT_2, 'vive | lives; vivo | I live; primo / prima | cousin; abuelo / abuela | grandfather / grandmother; hermano / hermana | brother / sister; casa | house; con | with');

async function load() {
  const { conjugationRouter } = await import('./conjugation.js');
  const callerFor = (user: AnyUser) => conjugationRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return { admin: callerFor(adminUser), ana: callerFor(ana), beto: callerFor(beto) };
}

const roundRow = (id: number) => testDb.query.conjugationRounds.findFirst({ where: eq(schema.conjugationRounds.id, id) });
async function queueOf(roundId: number): Promise<{ queue: QueueEntry[]; position: number; snapshot: RoundSnapshot }> {
  const round = await roundRow(roundId);
  if (!round) throw new Error('no round');
  return { queue: JSON.parse(round.queue) as QueueEntry[], position: round.position, snapshot: JSON.parse(round.settingsSnapshot) as RoundSnapshot };
}
async function current(roundId: number): Promise<QueueEntry> {
  const { queue, position } = await queueOf(roundId);
  return queue[position];
}
async function rightAnswer(roundId: number) {
  const built = (await current(roundId)).built!;
  if (built.levelKind === 'choice') return { choice: built.correctOptions![0] };
  return { text: built.accepted[0] };
}

describe('sentences with a blank (v1.25.0)', () => {
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
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([{ id: PERIOD_1, name: 'Español 1 — P1' }, { id: 9, name: 'All' }]);
    await testDb.insert(schema.userGroups).values([
      { userId: ana.id, groupId: PERIOD_1 }, { userId: beto.id, groupId: PERIOD_1 }, { userId: adminUser.id, groupId: PERIOD_1 },
    ]);
    await testDb.insert(schema.decks).values([
      { id: UNIT_1, name: 'Unit 1', createdBy: adminUser.id, createdAt: new Date(1_790_000_000_000) },
      { id: UNIT_2, name: 'Unit 2', createdBy: adminUser.id, createdAt: new Date(1_790_100_000_000) },
    ]);
    await testDb.insert(schema.deckGroups).values([
      { deckId: UNIT_1, groupId: PERIOD_1 }, { deckId: UNIT_2, groupId: PERIOD_1 }, { deckId: UNIT_1, groupId: 9 }, { deckId: UNIT_2, groupId: 9 },
    ]);
    await testDb.insert(schema.cards).values([...UNIT1_CARDS, ...UNIT2_CARDS]);
  });

  describe('settings', () => {
    it('are off by default, and saveSettings turns them on, notes since when, and the holdback', async () => {
      const api = await load();
      const before = await api.admin.settings({ deckId: UNIT_2 });
      expect(before.settings).toMatchObject({ sentences: 'off', sentenceHoldback: false });
      expect(before.sentencesSince).toBeNull();
      const on = await api.admin.saveSettings({ deckId: UNIT_2, enabled: true, sentences: 'builtIn' });
      expect(on.settings.sentences).toBe('builtIn');
      const since = on.sentencesSince;
      expect(since).toBeInstanceOf(Date);
      // Another mode keeps the date; other settings keep the mode.
      const both = await api.admin.saveSettings({ deckId: UNIT_2, sentences: 'both', sentenceHoldback: true });
      expect(both.sentencesSince).toEqual(since);
      expect((await api.admin.saveSettings({ deckId: UNIT_2, roundLength: 10 })).settings).toMatchObject({ sentences: 'both', sentenceHoldback: true });
      await expect(api.admin.saveSettings({ deckId: UNIT_2, sentences: 'sometimes' as 'off' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.ana.saveSettings({ deckId: UNIT_2, sentences: 'builtIn' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('turns a deck\'s sentences on by the mode alone, changing nothing else (the deploy\'s switch of Units 1-3)', async () => {
      const api = await load();
      const set = await api.admin.saveSettings({ deckId: UNIT_2, enabled: true, roundLength: 12, directions: 'toForm', accentMode: 'required' });
      const on = await api.admin.saveSettings({ deckId: UNIT_2, sentences: 'builtIn' });
      expect(on.settings).toEqual({ ...set.settings, sentences: 'builtIn' });
      expect(on.settings.sentenceHoldback).toBe(false);
      expect(on.sentencesSince).toBeInstanceOf(Date);
      // And the holdback measurement by itself.
      const held = await api.admin.saveSettings({ deckId: UNIT_2, sentenceHoldback: true });
      expect(held.settings).toEqual({ ...on.settings, sentenceHoldback: true });
    });

    it('draws on the decks before it in its groups for words (the All group aside)', async () => {
      const { earlierDeckIds, loadSentenceSource } = await import('../services/conjugationSentenceSource.js');
      expect(earlierDeckIds(testDb, UNIT_2)).toEqual([UNIT_1]);
      expect(earlierDeckIds(testDb, UNIT_1)).toEqual([]);
      const data = loadSentenceSource(testDb, UNIT_2, { tenses: ['present'], includeVosotros: false, vos: 'none' }, ['vivir']);
      expect(data.deck.earlierCards?.map((c) => c.front)).toContain('perro');
      expect(data.deck.cards.map((c) => c.front)).toContain('primo / prima');
      // Unchanged data: the same deck object, so the engine's caches hold.
      expect(loadSentenceSource(testDb, UNIT_2, { tenses: ['present'], includeVosotros: false, vos: 'none' }, ['vivir']).deck).toBe(data.deck);
    });
  });

  describe('a round', () => {
    beforeEach(async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, enabled: true, roundLength: 5, directions: 'toForm', sentences: 'builtIn' });
    });

    it('shows "give the form" as a sentence at multiple choice, with the pronoun hint and nothing of the answer', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_2 });
      const entry = await current(round.roundId);
      const built = entry.built!;
      expect(built.levelKind).toBe('choice');
      expect(built.sentence).toBeDefined();
      expect(built.subject).toBeUndefined();
      const prompt = round.prompt;
      expect(prompt.sentence).toMatchObject({ before: built.sentence!.before, after: built.sentence!.after, cue: 'vivir' });
      expect(prompt.sentence!.hint).toBe(built.sentence!.subject?.pronoun ?? null);
      // The subject decides the person: no person id, and the English waits for the answer. A page from before
      // v1.25.0 (a tab left open over the deploy) knows no sentence: it gets the sentence's subject as its label.
      expect(prompt).toMatchObject({ personLabel: built.sentence!.subject?.es ?? expect.any(String), personId: null, cue: null });
      const sent = JSON.stringify(round);
      expect(sent).not.toContain(built.sentence!.english ?? '\u0000');
      expect(sent).not.toMatch(/english|accepted|correctOptions|sentenceRef|"ref"/);
      // A reload shows the same sentence.
      expect((await api.ana.current({ roundId: round.roundId })).prompt.sentence).toEqual(prompt.sentence);
      const answered = await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
      expect(answered.sentence).toMatchObject({ filled: expect.stringContaining(built.accepted[0]), english: built.sentence!.english });
      const [stored] = await testDb.select().from(schema.conjugationAnswers);
      expect(stored).toMatchObject({ sentenceRef: built.sentence!.ref, subjectShown: null, holdbackArm: null, holdbackProbe: false });
    });

    it('grades a typed echo of the sentence by its blank, and names the mistake on the verb alone', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, answerMode: 'typed' });
      const round = await api.ana.start({ deckId: UNIT_2 });
      let entry = await current(round.roundId);
      let s = entry.built!.sentence!;
      expect(entry.built!.levelKind).not.toBe('choice');
      expect(round.prompt.sentence?.hint).toBeNull();
      const echoed = `${s.before} ${entry.built!.accepted[0]} ${s.after}`.toLowerCase();
      const right = await api.ana.answer({ roundId: round.roundId, index: 0, answer: { text: echoed } });
      expect(right).toMatchObject({ result: 'correct', counted: true });
      expect(right.sentence?.filled).toBe(`${s.before} ${entry.built!.accepted[0]} ${s.after}`.replace(/\s+([.,])/g, '$1'));

      entry = await current(round.roundId);
      s = entry.built!.sentence!;
      const wrongForm = entry.person === 'yo' ? 'vive' : 'vivo';
      const wrong = await api.ana.answer({ roundId: round.roundId, index: 1, answer: { text: `${s.before} ${wrongForm} ${s.after}` } });
      expect(wrong.result).toBe('wrong');
      expect(wrong.mistake?.kind).toBe('person');
      // The miss comes back at the end with another sentence of the same subject, when its cell has one.
      const { queue } = await queueOf(round.roundId);
      expect(queue[queue.length - 1]).toMatchObject({ key: entry.key, retry: true });
    });

    it('asks a missed sentence again as a sentence, one not seen yet when its cell has more', async () => {
      const api = await load();
      const round = await api.ana.start({ deckId: UNIT_2 });
      const first = await current(round.roundId);
      let answer = { choice: first.built!.options!.find((o) => !first.built!.correctOptions!.includes(o))! };
      let res = await api.ana.answer({ roundId: round.roundId, index: 0, answer });
      const list = await api.admin.sentences.list({ deckId: UNIT_2, entry: 'vivir' });
      const pool = list.cells.find((c) => c.person === first.person)!.sentences;
      let retried = false;
      for (let index = 1; !res.finished; index++) {
        const entry = await current(round.roundId);
        if (entry.retry) {
          retried = true;
          // A sentence again (the miss was with one), another one when the cell has more.
          expect(entry.built!.sentence).toBeDefined();
          if (pool.length > 1) expect(entry.built!.sentence?.ref).not.toBe(first.built!.sentence!.ref);
        }
        answer = await rightAnswer(round.roundId) as { choice: string };
        res = await api.ana.answer({ roundId: round.roundId, index, answer });
      }
      expect(retried).toBe(true);
      // The next round starts from what this one showed: the snapshot holds each cell's recent sentences.
      const next = await api.ana.start({ deckId: UNIT_2 });
      const { snapshot } = await queueOf(next.roundId);
      expect(Object.keys(snapshot.sentencesSeen ?? {})).toContain(first.key.slice(0, first.key.lastIndexOf('|')));
    });

    it('leaves the label alone with sentences off, and never shows "name the verb" as a sentence', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, sentences: 'off', directions: 'both', roundLength: 10 });
      const off = await api.ana.start({ deckId: UNIT_2 });
      expect(off.prompt.sentence).toBeNull();
      await api.admin.saveSettings({ deckId: UNIT_2, sentences: 'builtIn' });
      const on = await api.ana.start({ deckId: UNIT_2 });
      const { queue } = await queueOf(on.roundId);
      const built = queue.filter((e) => e.built);
      for (const e of built) if (e.direction === 'from') expect(e.built!.sentence).toBeUndefined();
      // A round keeps the mode it started with: the teacher turning sentences off mid-round changes nothing in it.
      expect((await queueOf(on.roundId)).snapshot.settings.sentences).toBe('builtIn');
    });

    it('records the holdback: each verb\'s half, the label for the label half', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, sentenceHoldback: true });
      const arm = holdbackArm(ana.id, 'vivir');
      const round = await api.ana.start({ deckId: UNIT_2 });
      for (let index = 0; index < round.total; index++) {
        const entry = await current(round.roundId);
        expect(entry.built!.holdback).toEqual({ arm, probe: false });
        expect(!!entry.built!.sentence).toBe(arm === 'sentence');
        const res = await api.ana.answer({ roundId: round.roundId, index, answer: await rightAnswer(round.roundId) });
        if (res.finished) break;
      }
      const answers = await testDb.select().from(schema.conjugationAnswers);
      expect(answers.length).toBeGreaterThan(0);
      for (const a of answers) {
        expect(a).toMatchObject({ holdbackArm: arm, holdbackProbe: false });
        expect(a.sentenceRef === null).toBe(arm === 'label');
      }
      // A week after an item's first showing, its next answer is the probe (shown either way), and is recorded so.
      await testDb.update(schema.conjugationAnswers).set({ at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
      const later = await api.ana.start({ deckId: UNIT_2 });
      const probe = await current(later.roundId);
      expect(probe.built!.holdback).toEqual({ arm, probe: true });
      await api.ana.answer({ roundId: later.roundId, index: 0, answer: await rightAnswer(later.roundId) });
      const probeRows = (await testDb.select().from(schema.conjugationAnswers)).filter((a) => a.holdbackProbe);
      expect(probeRows).toEqual([expect.objectContaining({ itemKey: probe.key, holdbackArm: arm, retry: false })]);

      // Only the first: once an item's probe is answered, it is back in its verb's half.
      await testDb.update(schema.conjugationAnswers).set({ holdbackProbe: true });
      const after = await api.ana.start({ deckId: UNIT_2 });
      const next = await current(after.roundId);
      expect(next.built!.holdback).toEqual({ arm, probe: false });
      expect(!!next.built!.sentence).toBe(arm === 'sentence');

      // The first showing is the deck's own: answers to the same forms in another deck do not make a probe.
      await testDb.update(schema.conjugationAnswers).set({ holdbackProbe: false, deckId: UNIT_1 });
      const elsewhere = await api.ana.start({ deckId: UNIT_2 });
      expect((await current(elsewhere.roundId)).built!.holdback).toEqual({ arm, probe: false });
    });

    it('leaves a form with no sentence out of the holdback: no arm, the label', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, sentenceHoldback: true, directions: 'toForm' });
      // Hide every built-in sentence of vivir: no form has a sentence, so none is in the measurement.
      const list = await api.admin.sentences.list({ deckId: UNIT_2, entry: 'vivir' });
      for (const cell of list.cells) for (const row of cell.sentences) await api.admin.sentences.hide({ deckId: UNIT_2, ref: row.ref, hidden: true });
      const round = await api.ana.start({ deckId: UNIT_2 });
      const entry = await current(round.roundId);
      expect(entry.built!.holdback).toBeUndefined();
      expect(entry.built!.sentence).toBeUndefined();
      await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
      expect(await testDb.select().from(schema.conjugationAnswers)).toEqual([expect.objectContaining({ holdbackArm: null, holdbackProbe: false, sentenceRef: null })]);
    });
  });

  describe('a report', () => {
    it('queues an answered sentence for the teacher, once per student, and only the student\'s own', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, enabled: true, roundLength: 5, directions: 'toForm', sentences: 'builtIn' });
      const round = await api.ana.start({ deckId: UNIT_2 });
      const entry = await current(round.roundId);
      // Not before the answer.
      await expect(api.ana.reportSentence({ roundId: round.roundId, index: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await api.ana.answer({ roundId: round.roundId, index: 0, answer: await rightAnswer(round.roundId) });
      expect(await api.ana.reportSentence({ roundId: round.roundId, index: 0 })).toEqual({ reported: true });
      expect(await api.ana.reportSentence({ roundId: round.roundId, index: 0 })).toEqual({ reported: true });
      await expect(api.beto.reportSentence({ roundId: round.roundId, index: 0 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const reports = await testDb.select().from(schema.conjugationSentenceReports);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ deckId: UNIT_2, userId: ana.id, sentenceRef: entry.built!.sentence!.ref, itemKey: entry.key });
      expect(reports[0].sentence).toContain('___ (vivir)');

      const panel = await api.admin.sentences.panel({ deckId: UNIT_2 });
      expect(panel.reports).toEqual([expect.objectContaining({ ref: entry.built!.sentence!.ref, count: 1 })]);
      expect(await api.admin.sentences.resolveReports({ deckId: UNIT_2, ref: entry.built!.sentence!.ref })).toEqual({ resolved: 1 });
      expect((await api.admin.sentences.panel({ deckId: UNIT_2 })).reports).toEqual([]);
      await expect(api.ana.sentences.panel({ deckId: UNIT_2 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('the Sentences panel', () => {
    it('counts coverage, lists a verb\'s sentences filled in, hides one, and previews it at each rung', async () => {
      const api = await load();
      // Off: the numbers are what Built-in would give.
      const off = await api.admin.sentences.panel({ deckId: UNIT_2 });
      expect(off).toMatchObject({ mode: 'off', countedMode: 'builtIn', holdback: false });
      expect(off.coverage.cells).toBe(5);
      expect(off.coverage.covered + off.coverage.label).toBe(5);
      expect(off.verbs).toEqual([expect.objectContaining({ entry: 'vivir', cells: 5 })]);

      const list = await api.admin.sentences.list({ deckId: UNIT_2, entry: 'vivir' });
      const ellos = list.cells.find((c) => c.person === 'ellos')!;
      expect(ellos.personLabel).toBe('ellos/ellas/Uds.');
      const one = ellos.sentences[0];
      expect(one).toMatchObject({ source: 'builtIn', form: 'viven', cue: 'vivir', hidden: false, used: true });
      expect(one.english).toBeTruthy();

      await api.admin.sentences.hide({ deckId: UNIT_2, ref: one.ref, hidden: true });
      const after = await api.admin.sentences.list({ deckId: UNIT_2, entry: 'vivir' });
      expect(after.cells.find((c) => c.person === 'ellos')!.sentences.find((s) => s.ref === one.ref)).toMatchObject({ hidden: true, used: false });
      expect((await api.admin.sentences.panel({ deckId: UNIT_2 })).verbs[0].hidden).toBe(1);
      await api.admin.sentences.hide({ deckId: UNIT_2, ref: one.ref, hidden: false });
      expect((await api.admin.sentences.panel({ deckId: UNIT_2 })).verbs[0].hidden).toBe(0);
      await expect(api.admin.sentences.hide({ deckId: UNIT_2, ref: 'row:1', hidden: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const cell = { deckId: UNIT_2, entry: 'vivir', tense: 'present' as const, person: 'ellos', ref: one.ref };
      const choice = await api.admin.sentences.preview({ ...cell, level: 'choice' });
      expect(choice.levels).toEqual(['choice', 'typed-lenient', 'typed-strict']);
      expect(choice.prompt).toMatchObject({ kind: 'choice', sentence: { before: one.before, cue: 'vivir' } });
      expect(choice.prompt.options).toContain('viven');
      expect(choice).toMatchObject({ answer: 'viven', english: one.english });
      const typed = await api.admin.sentences.preview({ ...cell, level: 'typed-strict' });
      expect(typed.prompt).toMatchObject({ kind: 'typed', strictAccents: true, options: null });
      expect(typed.prompt.sentence?.hint).toBeNull();
      await expect(api.admin.sentences.preview({ ...cell, ref: 'tpl:nothing', level: 'choice' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.admin.sentences.list({ deckId: UNIT_2, entry: 'comer' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('parks a written row the checker rejects, and shows an approved one in "approved"', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, sentences: 'approved' });
      const now = new Date();
      await testDb.insert(schema.conjugationSentences).values([
        { deckId: UNIT_2, ref: 'row:a', source: 'teacher', status: 'approved', entry: 'vivir', tense: 'present', person: 'ellos', text: 'Mis primos ___ (vivir) en la casa.', english: 'My cousins live in the house.', createdAt: now, updatedAt: now },
        { deckId: UNIT_2, ref: 'row:b', source: 'teacher', status: 'approved', entry: 'vivir', tense: 'present', person: 'ellos', text: 'Mi primo ___ (vivir) en la casa.', english: null, createdAt: now, updatedAt: now },
      ]);
      const panel = await api.admin.sentences.panel({ deckId: UNIT_2 });
      expect(panel.coverage).toEqual({ cells: 5, covered: 1, label: 4 });
      expect(panel.parked).toEqual([expect.objectContaining({ ref: 'row:b', entry: 'vivir', personLabel: 'ellos/ellas/Uds.' })]);
      expect(panel.parkedCount).toBe(1);
    });
  });

  describe('results and the guide', () => {
    it('show a missed item\'s sentence filled in, person mistakes by subject, since when, and the subjects a student met', async () => {
      const api = await load();
      await api.admin.saveSettings({ deckId: UNIT_2, enabled: true, roundLength: 5, directions: 'toForm', sentences: 'builtIn' });
      expect(await api.ana.overview({ deckId: UNIT_2 })).toMatchObject({ sentenceSeen: false, subjectsMet: [] });
      const round = await api.ana.start({ deckId: UNIT_2 });
      let res;
      for (let index = 0; ; index++) {
        const entry = await current(round.roundId);
        const built = entry.built!;
        const answer = !entry.retry ? { choice: built.options!.find((o) => !built.correctOptions!.includes(o))! } : await rightAnswer(round.roundId);
        res = await api.ana.answer({ roundId: round.roundId, index, answer });
        if (res.finished) break;
      }
      const results = await api.admin.results({ deckId: UNIT_2 });
      expect(results.sentences).toBe('builtIn');
      expect(results.sentencesSince).toBeInstanceOf(Date);
      const missed = results.mostMissed[0];
      expect(missed.bySentence[0]).toMatchObject({ attempts: 1, misses: 1, sentence: expect.stringContaining(missed.form) });
      expect(results.personBySubject.reduce((n, x) => n + x.answers, 0)).toBe(10);
      for (const row of results.personBySubject) expect(row.type).not.toBe('label');

      const overview = await api.ana.overview({ deckId: UNIT_2 });
      expect(overview.sentenceSeen).toBe(true);
      for (const s of overview.subjectsMet) expect(s).toMatchObject({ es: expect.any(String), person: expect.any(String) });
    });
  });
});
