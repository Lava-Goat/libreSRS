// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import type { MnemonicContext } from '../services/ai/types.js';

const { client, db: testDb } = createTestDb();
const providerCalls: string[] = [];
/** What the model was given on each call. */
const providerContexts: MnemonicContext[] = [];

const admin = { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', picture: null, role: 'admin' as const };
const ana = { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', picture: null, role: 'user' as const };
const beto = { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', picture: null, role: 'user' as const };
type AnyUser = typeof admin | typeof ana;

const CARD = 10;

async function load() {
  const { aiRouter } = await import('./ai.js');
  const { adminRouter } = await import('./admin.js');
  const callerFor = (user: AnyUser) => aiRouter.createCaller({
    req: { user } as unknown as Request, res: {} as Response, user, requestId: null,
  });
  return {
    teacher: callerFor(admin), ana: callerFor(ana), beto: callerFor(beto),
    adminApi: adminRouter.createCaller({ req: { user: admin } as unknown as Request, res: {} as Response, user: admin, requestId: null }),
  };
}

describe('mnemonics are chosen by the teacher and read by students', () => {
  afterAll(async () => { await client.close(); });

  beforeEach(async () => {
    vi.resetModules();
    providerCalls.length = 0;
    providerContexts.length = 0;
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    vi.doMock('../services/ai/config.js', () => ({
      getAiRuntimeConfig: async () => ({ aiEnabled: true, mnemonicEnabled: true, openaiApiKey: null }),
      isMnemonicEnabled: async () => true,
    }));
    vi.doMock('../services/ai/providerFactory.js', () => ({
      createAiProvider: async () => ({
        name: 'fake',
        generateMnemonic: async (context: MnemonicContext) => {
          providerCalls.push(context.front);
          providerContexts.push(context);
          return { text: `suggestion ${providerCalls.length} for ${context.front}` };
        },
      }),
    }));

    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'teacher@example.com', name: 'Teacher', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values({ id: 1, name: 'P1' });
    // The teacher studies the deck through the class group, as in production.
    await testDb.insert(schema.userGroups).values([{ userId: 1, groupId: 1 }, { userId: 2, groupId: 1 }, { userId: 3, groupId: 1 }]);
    await testDb.insert(schema.decks).values({ id: 5, name: 'U1', createdBy: 1 });
    await testDb.insert(schema.deckGroups).values({ deckId: 5, groupId: 1 });
    await testDb.insert(schema.cards).values({ id: CARD, deckId: 5, front: 'perro', back: 'dog' });
  });

  it('never lets a student cause a generation', async () => {
    const api = await load();
    await expect(api.ana.generateMnemonic({ cardId: CARD })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(providerCalls).toEqual([]);
    expect(await testDb.query.aiMnemonics.findMany()).toHaveLength(0);
  });

  it('lets a student neither approve nor reject suggestions', async () => {
    const api = await load();
    const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });
    await expect(api.ana.acceptMnemonic({ mnemonicId: suggestion.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.ana.rejectMnemonic({ mnemonicId: suggestion.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('shows the teacher’s approved mnemonic to every student, as a read', async () => {
    const api = await load();
    const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });
    await api.teacher.acceptMnemonic({ mnemonicId: suggestion.id });
    expect(providerCalls).toHaveLength(1);

    for (const student of [api.ana, api.beto]) {
      const state = await student.getCardAiState({ cardId: CARD });
      expect(state.acceptedMnemonic).toEqual({ text: 'suggestion 1 for perro', source: 'teacher' });
      expect(state.pendingMnemonic).toBeNull();
    }
    expect(providerCalls).toHaveLength(1);
  });

  it('gives the teacher their stored suggestion back instead of generating a new one', async () => {
    const api = await load();
    const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });
    const state = await api.teacher.getCardAiState({ cardId: CARD });
    expect(state.acceptedMnemonic).toBeNull();
    expect(state.pendingMnemonic).toEqual({ id: suggestion.id, text: suggestion.text, style: 'keyword' });
    // Students never see a teacher's unapproved suggestion.
    expect((await api.ana.getCardAiState({ cardId: CARD })).pendingMnemonic).toBeNull();
  });

  it('replaces the card’s mnemonic when the teacher approves another, and removes it for everyone on delete', async () => {
    const api = await load();
    const first = await api.teacher.generateMnemonic({ cardId: CARD });
    await api.teacher.acceptMnemonic({ mnemonicId: first.id });
    const second = await api.teacher.generateMnemonic({ cardId: CARD });
    await api.teacher.acceptMnemonic({ mnemonicId: second.id });
    expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic?.text).toBe('suggestion 2 for perro');

    await api.teacher.deleteMnemonic({ cardId: CARD });
    expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic).toBeNull();
  });

  it('keeps a mnemonic a student accepted for themselves, only where the card has no teacher one', async () => {
    const api = await load();
    await testDb.insert(schema.aiMnemonics).values({
      cardId: CARD, userId: ana.id, provider: 'old', text: 'Ana’s own', sourcePrompt: 'perro → dog', accepted: true,
    });
    expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic).toEqual({ text: 'Ana’s own', source: 'own' });
    expect((await api.beto.getCardAiState({ cardId: CARD })).acceptedMnemonic).toBeNull();

    await testDb.update(schema.cards).set({ mnemonic: 'the teacher’s' }).where(eq(schema.cards.id, CARD));
    expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic).toEqual({ text: 'the teacher’s', source: 'teacher' });
  });

  it('publishes mnemonics a teacher imports from CSV to every student', async () => {
    const api = await load();
    await api.adminApi.uploadCards({ deckId: 5, csvContent: 'front,back,mnemonic\ngato,cat,"GAH-toh: a cat that ate a GATOR"\n' });
    const gato = await testDb.query.cards.findFirst({ where: eq(schema.cards.front, 'gato') });
    expect(gato?.mnemonic).toBe('GAH-toh: a cat that ate a GATOR');
    expect((await api.ana.getCardAiState({ cardId: gato!.id })).acceptedMnemonic).toEqual({ text: 'GAH-toh: a cat that ate a GATOR', source: 'teacher' });
  });

  it('exports the mnemonic students see, never a student’s private one', async () => {
    const api = await load();
    await testDb.update(schema.cards).set({ mnemonic: 'the teacher’s' }).where(eq(schema.cards.id, CARD));
    await testDb.insert(schema.aiMnemonics).values({
      cardId: CARD, userId: ana.id, provider: 'old', text: 'Ana’s own', sourcePrompt: 'p', accepted: true, acceptedAt: new Date(Date.now() + 60_000),
    });
    const { csv } = await api.adminApi.exportDeckCards({ deckId: 5 });
    expect(csv).toContain('"the teacher’s"');
    expect(csv).not.toContain('Ana’s own');
  });

  it('keeps no per-student AI state: a lapse, a suggestion, its approval and a delete write no card_ai_state row (deprecated in v1.20.0)', async () => {
    const api = await load();
    // A review card Ana is about to forget: the removed review trigger switched a mnemonic on for her here.
    await testDb.insert(schema.cardStates).values({
      id: 50, cardId: CARD, userId: ana.id, stability: 8, difficulty: 5, reps: 4, state: 2,
      lastReview: new Date(Date.now() - 9 * 86_400_000), nextReview: new Date(Date.now() - 60_000),
    });
    const { reviewCard } = await import('../services/fsrs.js');
    const { result } = await reviewCard(50, ana.id, 1, 2_000);
    expect(result.lapses).toBe(1);

    const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });
    await api.teacher.acceptMnemonic({ mnemonicId: suggestion.id });
    await api.teacher.deleteMnemonic({ cardId: CARD });
    await vi.dynamicImportSettled();

    expect((await client.execute('SELECT count(*) AS n FROM card_ai_state')).rows[0].n).toBe(0);
    // What the card's panel reads: its mnemonic, and nothing about cognates.
    expect(Object.keys(await api.ana.getCardAiState({ cardId: CARD })).sort()).toEqual(['acceptedMnemonic', 'pendingByStyle', 'pendingMnemonic']);
  });

  it('does not let a student delete the teacher’s mnemonic', async () => {
    const api = await load();
    await testDb.update(schema.cards).set({ mnemonic: 'the teacher’s' }).where(eq(schema.cards.id, CARD));
    await api.ana.deleteMnemonic({ cardId: CARD });
    expect((await api.beto.getCardAiState({ cardId: CARD })).acceptedMnemonic?.text).toBe('the teacher’s');
  });

  describe('styles and "Try another" (v1.20.0)', () => {
    const rows = () => testDb.query.aiMnemonics.findMany({ orderBy: (m, { asc }) => [asc(m.id)] });

    it('makes a keyword suggestion by default, and stores and returns its style', async () => {
      const api = await load();
      const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });

      expect(suggestion).toMatchObject({ cardId: CARD, userId: admin.id, text: 'suggestion 1 for perro', accepted: false, style: 'keyword' });
      // The row as before v1.20.0, plus its style.
      expect(suggestion).not.toHaveProperty('rejectedAt');
      expect(providerContexts[0].style).toBe('keyword');
      expect((await rows())[0]).toMatchObject({ style: 'keyword', rejectedAt: null });
    });

    it('makes a sentence suggestion when the teacher asks for one, and gives it back with its style', async () => {
      const api = await load();
      const suggestion = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });

      expect(suggestion.style).toBe('sentence');
      expect(providerContexts[0].style).toBe('sentence');
      expect((await rows())[0].style).toBe('sentence');
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic)
        .toEqual({ id: suggestion.id, text: suggestion.text, style: 'sentence' });
    });

    it('refuses a style it does not know, without calling the model', async () => {
      const api = await load();
      await expect(api.teacher.generateMnemonic({ cardId: CARD, style: 'rhyme' as 'keyword' }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(providerCalls).toEqual([]);
    });

    it('reads a suggestion from before v1.20.0 (no style) as a keyword', async () => {
      const api = await load();
      const [old] = await testDb.insert(schema.aiMnemonics).values({
        cardId: CARD, userId: admin.id, provider: 'openai', text: 'PEAR-oh', sourcePrompt: 'perro → dog', accepted: false,
      }).returning();
      expect(old.style).toBeNull();

      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic)
        .toEqual({ id: old.id, text: 'PEAR-oh', style: 'keyword' });
    });

    it('keeps a rejected suggestion, never shows it as pending again, and tells the model about it next time', async () => {
      const api = await load();
      const first = await api.teacher.generateMnemonic({ cardId: CARD });

      await expect(api.teacher.rejectMnemonic({ mnemonicId: first.id })).resolves.toEqual({ success: true });

      const [kept] = await rows();
      expect(kept).toMatchObject({ id: first.id, text: 'suggestion 1 for perro', accepted: false });
      expect(kept.rejectedAt).toBeInstanceOf(Date);
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic).toBeNull();

      // "Try another": the same style again, and the model hears what it already wrote.
      const second = await api.teacher.generateMnemonic({ cardId: CARD, style: first.style });
      expect(providerContexts[1].alreadySuggested).toEqual(['suggestion 1 for perro']);
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic)
        .toEqual({ id: second.id, text: 'suggestion 2 for perro', style: 'keyword' });
    });

    it('keeps the newest waiting suggestion of each style, so the teacher can switch between them for free', async () => {
      const api = await load();
      const keyword = await api.teacher.generateMnemonic({ cardId: CARD });
      // "Try a sentence" turns nothing down: the keyword still waits.
      const sentence = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });

      const state = await api.teacher.getCardAiState({ cardId: CARD });
      expect(state.pendingMnemonic).toEqual({ id: sentence.id, text: sentence.text, style: 'sentence' });
      expect(state.pendingByStyle).toEqual({
        keyword: { id: keyword.id, text: keyword.text, style: 'keyword' },
        sentence: { id: sentence.id, text: sentence.text, style: 'sentence' },
      });
      // Students are never sent a suggestion.
      expect((await api.ana.getCardAiState({ cardId: CARD })).pendingByStyle).toEqual({ keyword: null, sentence: null });

      // "Try another" on the keyword: a rejected one never comes back.
      await api.teacher.rejectMnemonic({ mnemonicId: keyword.id });
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingByStyle).toEqual({
        keyword: null,
        sentence: { id: sentence.id, text: sentence.text, style: 'sentence' },
      });
    });

    it('tells the teacher the approved mnemonic’s style, so Regenerate asks for the same kind', async () => {
      const api = await load();
      const sentence = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });
      await api.teacher.acceptMnemonic({ mnemonicId: sentence.id });

      expect((await api.teacher.getCardAiState({ cardId: CARD })).acceptedMnemonic)
        .toEqual({ text: sentence.text, source: 'teacher', style: 'sentence' });
      // Students read only the text.
      expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic).toEqual({ text: sentence.text, source: 'teacher' });

      // A mnemonic no suggestion explains (a CSV import) is a keyword.
      await testDb.update(schema.cards).set({ mnemonic: 'GAH-toh: a cat that ate a GATOR' }).where(eq(schema.cards.id, CARD));
      expect((await api.teacher.getCardAiState({ cardId: CARD })).acceptedMnemonic)
        .toEqual({ text: 'GAH-toh: a cat that ate a GATOR', source: 'teacher', style: 'keyword' });
    });

    it('shows the newest suggestion that is still waiting, skipping rejected ones', async () => {
      const api = await load();
      const waiting = await api.teacher.generateMnemonic({ cardId: CARD });
      const newer = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic?.id).toBe(newer.id);

      // "Try another" on the sentence turns it down: the older keyword is the newest waiting again.
      await api.teacher.rejectMnemonic({ mnemonicId: newer.id });
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic?.id).toBe(waiting.id);
      await api.teacher.rejectMnemonic({ mnemonicId: waiting.id });
      expect((await api.teacher.getCardAiState({ cardId: CARD })).pendingMnemonic).toBeNull();
    });

    it('keeps the first rejection time when a suggestion is rejected twice', async () => {
      const api = await load();
      const suggestion = await api.teacher.generateMnemonic({ cardId: CARD });
      await testDb.update(schema.aiMnemonics).set({ rejectedAt: new Date(1_000_000) }).where(eq(schema.aiMnemonics.id, suggestion.id));

      await api.teacher.rejectMnemonic({ mnemonicId: suggestion.id });

      expect((await rows())[0].rejectedAt).toEqual(new Date(1_000_000));
    });

    it('rejects only the teacher’s own suggestions', async () => {
      const api = await load();
      await expect(api.teacher.rejectMnemonic({ mnemonicId: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('passes back every suggestion for the card, pending, rejected and approved, of either style, and the card’s mnemonic', async () => {
      const api = await load();
      const rejected = await api.teacher.generateMnemonic({ cardId: CARD });
      await api.teacher.rejectMnemonic({ mnemonicId: rejected.id });
      const approved = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });
      await api.teacher.acceptMnemonic({ mnemonicId: approved.id });
      await api.teacher.generateMnemonic({ cardId: CARD }); // left waiting
      // The card's mnemonic, imported or approved before any row we know of.
      await testDb.update(schema.cards).set({ mnemonic: 'from a CSV' }).where(eq(schema.cards.id, CARD));
      // Not suggestions for this card: Ana's own pick from before v1.8.0, and another card's.
      await testDb.insert(schema.cards).values({ id: 11, deckId: 5, front: 'gato', back: 'cat' });
      await testDb.insert(schema.aiMnemonics).values([
        { cardId: CARD, userId: ana.id, provider: 'old', text: 'Ana’s own', sourcePrompt: 'p', accepted: true },
        { cardId: 11, userId: admin.id, provider: 'old', text: 'a cat cue', sourcePrompt: 'p', accepted: false },
      ]);

      await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });

      const last = providerContexts[providerContexts.length - 1];
      expect(last.style).toBe('sentence');
      // To avoid: the earlier sentence (approved, then replaced by the CSV text).
      expect(last.alreadySuggested).toEqual(['suggestion 2 for perro']);
      // For reference: the keywords, and the CSV text no row explains (a keyword), newest first.
      expect(last.suggestedInOtherStyle).toEqual(['from a CSV', 'suggestion 3 for perro', 'suggestion 1 for perro']);
    });

    it('tells the model the other style’s suggestions for reference only, so a style switch bans no keyword', async () => {
      const api = await load();
      const keyword = await api.teacher.generateMnemonic({ cardId: CARD });
      const sentence = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });
      await api.teacher.generateMnemonic({ cardId: CARD });

      expect(providerContexts[1]).toMatchObject({ style: 'sentence', alreadySuggested: [], suggestedInOtherStyle: [keyword.text] });
      expect(providerContexts[2]).toMatchObject({
        style: 'keyword', alreadySuggested: [keyword.text], suggestedInOtherStyle: [sentence.text],
      });
    });

    it('gives the model the approved mnemonics of the deck’s other cards, not other decks’ or this card’s', async () => {
      const api = await load();
      await testDb.insert(schema.decks).values({ id: 6, name: 'U2', createdBy: 1 });
      await testDb.insert(schema.cards).values([
        { id: 11, deckId: 5, front: 'pero', back: 'but', mnemonic: 'Quiero, PERO no puedo = I want to, but I can’t' },
        { id: 12, deckId: 5, front: '<b>pelo</b>', back: 'hair', mnemonic: 'PAY-low:\na barber paid low' },
        { id: 13, deckId: 5, front: 'gato', back: 'cat' },
        { id: 14, deckId: 6, front: 'pera', back: 'pear', mnemonic: 'a PEAR' },
      ]);
      await testDb.update(schema.cards).set({ mnemonic: 'this card’s own' }).where(eq(schema.cards.id, CARD));

      await api.teacher.generateMnemonic({ cardId: CARD });

      expect(providerContexts[0].otherCards).toEqual([
        'pero = but: Quiero, PERO no puedo = I want to, but I can’t',
        'pelo = hair: PAY-low:\na barber paid low',
      ]);
    });


    it('lists each text once, newest first, and at most 25', async () => {
      const api = await load();
      await testDb.update(schema.cards).set({ mnemonic: 'suggestion 0' }).where(eq(schema.cards.id, CARD));
      await testDb.insert(schema.aiMnemonics).values(Array.from({ length: 30 }, (_, i) => ({
        cardId: CARD, userId: admin.id, provider: 'openai', text: `suggestion ${i}`, sourcePrompt: 'p',
        accepted: false, rejectedAt: new Date(), createdAt: new Date(1_790_000_000_000 + i * 1000),
      })));

      await api.teacher.generateMnemonic({ cardId: CARD });

      const listed = providerContexts[0].alreadySuggested ?? [];
      expect(listed).toHaveLength(25);
      expect(new Set(listed).size).toBe(25);
      // The approved text first, then the newest rows.
      expect(listed.slice(0, 3)).toEqual(['suggestion 0', 'suggestion 29', 'suggestion 28']);
    });

    it('accepting one suggestion leaves the others as they were, rejected ones included', async () => {
      const api = await load();
      const rejected = await api.teacher.generateMnemonic({ cardId: CARD });
      await api.teacher.rejectMnemonic({ mnemonicId: rejected.id });
      const waiting = await api.teacher.generateMnemonic({ cardId: CARD });
      const chosen = await api.teacher.generateMnemonic({ cardId: CARD, style: 'sentence' });

      await api.teacher.acceptMnemonic({ mnemonicId: chosen.id });

      const after = await rows();
      expect(after.map((m) => ({ id: m.id, accepted: m.accepted, rejected: m.rejectedAt !== null }))).toEqual([
        { id: rejected.id, accepted: false, rejected: true },
        { id: waiting.id, accepted: false, rejected: false },
        { id: chosen.id, accepted: true, rejected: false },
      ]);
      expect((await api.ana.getCardAiState({ cardId: CARD })).acceptedMnemonic)
        .toEqual({ text: 'suggestion 3 for perro', source: 'teacher' });
    });

    it('keeps the teacher’s approved suggestion as rejected on delete, so the next one differs from it too', async () => {
      const api = await load();
      const approved = await api.teacher.generateMnemonic({ cardId: CARD });
      await api.teacher.acceptMnemonic({ mnemonicId: approved.id });

      await api.teacher.deleteMnemonic({ cardId: CARD });

      const [kept] = await rows();
      expect(kept).toMatchObject({ id: approved.id, accepted: false });
      expect(kept.rejectedAt).toBeInstanceOf(Date);
      const teacherState = await api.teacher.getCardAiState({ cardId: CARD });
      expect(teacherState).toEqual({ acceptedMnemonic: null, pendingMnemonic: null, pendingByStyle: { keyword: null, sentence: null } });

      await api.teacher.generateMnemonic({ cardId: CARD });
      expect(providerContexts[1].alreadySuggested).toEqual(['suggestion 1 for perro']);
    });

    it('still deletes a student’s own pick from before v1.8.0 when they remove it', async () => {
      const api = await load();
      await testDb.insert(schema.aiMnemonics).values({
        cardId: CARD, userId: ana.id, provider: 'old', text: 'Ana’s own', sourcePrompt: 'p', accepted: true,
      });

      await api.ana.deleteMnemonic({ cardId: CARD });

      expect(await rows()).toEqual([]);
    });
  });
});
