// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { initTRPC } from '@trpc/server';
import { combine, fieldsBeside, type ServerExtension } from './api.js';
import { extensions as none } from './none.js';
import { ext, resetExtensions, setExtensions } from './registry.js';
import { logger } from '../logger.js';

const t = initTRPC.create();
const sampleRouter = t.router({ ping: t.procedure.query(() => 'pong') });
const user = { id: 7, role: 'user' };
const now = new Date('2026-10-05T17:00:00Z');
const graded = {
  user, now, answerId: 11, roundId: 3, scope: 'all' as const, position: 4, prompts: 20, levelKind: 'choice' as const,
  result: 'correct' as const, counted: true, retry: false, review: false, outcome: 'up', usedMs: 2400, timeMismatch: false,
  finished: false, playedToEnd: false,
};

/** Two sample extensions, written inline: no fixture folder named like an extension ships. */
interface AlphaFields {
  review: { alpha: number | null };
  studyFinish: { alphaDay: string | null };
  answer: { alphaList: string[] };
  answerGraded: { alphaGraded: number | null };
  roundSummary: { alphaRound: boolean };
  studyAllOverview: { alphaOn: boolean };
  userDetail: { user: { alphaFlag: boolean }; detail: { alphaCount: number } };
}
const alphaDefaults = (): AlphaFields => ({
  review: { alpha: null },
  studyFinish: { alphaDay: null },
  answer: { alphaList: [] },
  answerGraded: { alphaGraded: null },
  roundSummary: { alphaRound: false },
  studyAllOverview: { alphaOn: false },
  userDetail: { user: { alphaFlag: false }, detail: { alphaCount: 0 } },
});
function alpha(hooks: ServerExtension<AlphaFields>['hooks'] = {}): ServerExtension<AlphaFields, { alpha: typeof sampleRouter }> {
  return { id: 'alpha', routers: { alpha: sampleRouter }, defaults: alphaDefaults(), hooks };
}
interface BetaFields {
  review: { beta: string };
  studyFinish: object; answer: object; answerGraded: object; roundSummary: object; studyAllOverview: object;
  userDetail: { user: { betaUser: number }; detail: { betaDetail: string[] } };
}
const beta = (hooks: ServerExtension<BetaFields>['hooks'] = {}): ServerExtension<BetaFields, { beta: typeof sampleRouter }> => ({
  id: 'beta-2',
  routers: { beta: sampleRouter },
  defaults: {
    review: { beta: 'none' }, studyFinish: {}, answer: {}, answerGraded: {}, roundSummary: {}, studyAllOverview: {},
    userDetail: { user: { betaUser: 0 }, detail: { betaDetail: [] } },
  },
  hooks,
  http: { beforeSession: [{ path: '/api/beta', router: () => express.Router() }] },
});

afterEach(() => {
  vi.restoreAllMocks();
  resetExtensions();
});

describe('combine() with no extensions', () => {
  it('is empty: no ids, routers or mounts, empty defaults, and every hook resolves to nothing', async () => {
    const x = combine();
    expect(x.ids).toEqual([]);
    expect(x.routers).toEqual({});
    expect(x.beforeSession).toEqual([]);
    expect(x.defaults).toEqual({
      review: {}, studyFinish: {}, answer: {}, answerGraded: {}, roundSummary: {}, studyAllOverview: {}, userDetail: { user: {}, detail: {} },
    });
    expect(x.timers).toEqual([]);
    expect(await x.run('review', { user, reviewLogId: 1, now })).toEqual({});
    expect(await x.run('studyFinish', { user, now, allDone: null })).toEqual({});
    expect(await x.run('answer', { user, sets: [], now })).toEqual({});
    expect(await x.run('answerGraded', graded)).toEqual({});
    expect(await x.run('roundSummary', { user, roundId: 3, record: true })).toEqual({});
    expect(await x.run('studyAllOverview', { user, now })).toEqual({});
    expect(await x.run('userDetail', { userId: 7, now })).toEqual({ user: {}, detail: {} });
  });

  it('is what none.ts exports and what the registry starts with', async () => {
    expect(none.ids).toEqual([]);
    expect(ext().ids).toEqual([]);
    expect(ext().routers).toEqual({});
    expect(await ext().run('studyFinish', { user, now, allDone: null })).toEqual({});
  });
});

describe('combine() with extensions', () => {
  it('merges ids, routers, mounts and defaults in order', () => {
    const x = combine(alpha(), beta());
    expect(x.ids).toEqual(['alpha', 'beta-2']);
    expect(Object.keys(x.routers)).toEqual(['alpha', 'beta']);
    expect(x.beforeSession.map((m) => m.path)).toEqual(['/api/beta']);
    expect(x.defaults.review).toEqual({ alpha: null, beta: 'none' });
    expect(x.defaults.userDetail).toEqual({ user: { alphaFlag: false, betaUser: 0 }, detail: { alphaCount: 0, betaDetail: [] } });
  });

  it('hands out fresh defaults on every read, so a caller that changes one changes nothing else', () => {
    const x = combine(alpha());
    const first = x.defaults.answer as { alphaList: string[] };
    first.alphaList = ['changed'];
    (x.defaults.userDetail.user as { alphaFlag: boolean }).alphaFlag = true;
    expect(x.defaults.answer).toEqual({ alphaList: [] });
    expect(x.defaults.userDetail.user).toEqual({ alphaFlag: false });
    expect(x.defaults.answer).not.toBe(x.defaults.answer);
  });

  it('runs each hook with its context and merges the fields over the defaults', async () => {
    const review = vi.fn(({ reviewLogId }: { reviewLogId: number }) => ({ alpha: reviewLogId * 2 }));
    const x = combine(
      alpha({ review, userDetail: async ({ userId }) => ({ user: { alphaFlag: userId === 7 }, detail: { alphaCount: 3 } }) }),
      beta({ review: () => ({ beta: 'told' }), userDetail: () => ({ user: { betaUser: 1 }, detail: { betaDetail: ['x'] } }) }),
    );
    expect(await x.run('review', { user, reviewLogId: 21, now })).toEqual({ alpha: 42, beta: 'told' });
    expect(review).toHaveBeenCalledWith({ user, reviewLogId: 21, now });
    // userDetail merges user and detail one level deep, extension after extension.
    expect(await x.run('userDetail', { userId: 7, now })).toEqual({
      user: { alphaFlag: true, betaUser: 1 }, detail: { alphaCount: 3, betaDetail: ['x'] },
    });
    // A hook not given: that extension's defaults.
    expect(await x.run('studyAllOverview', { user, now })).toEqual({ alphaOn: false });
  });

  it('hands answerGraded its grading facts, and keeps the defaults for a hook not given', async () => {
    const answerGraded = vi.fn(({ answerId, usedMs }: { answerId: number; usedMs: number | null }) => ({ alphaGraded: answerId + (usedMs ?? 0) }));
    const x = combine(alpha({ answerGraded }), beta());
    expect(await x.run('answerGraded', graded)).toEqual({ alphaGraded: 2411 });
    expect(answerGraded).toHaveBeenCalledWith(graded);
    expect(await combine(alpha()).run('answerGraded', graded)).toEqual({ alphaGraded: null });
  });

  it('collects every extension\'s timers with its id, and refuses a bad, duplicate or too-frequent one', async () => {
    const run = vi.fn();
    const x = combine({ ...alpha(), timers: [{ id: 'sweep', everyMs: 60_000, run }] }, beta());
    expect(x.timers.map((t) => [t.extension, t.id, t.everyMs])).toEqual([['alpha', 'sweep', 60_000]]);
    await x.timers[0].run({ now });
    expect(run).toHaveBeenCalledWith({ now });
    expect(() => combine({ ...alpha(), timers: [{ id: 'Bad', everyMs: 60_000, run }] })).toThrow(/Timer id must match/);
    expect(() => combine({ ...alpha(), timers: [{ id: 'a', everyMs: 60_000, run }, { id: 'a', everyMs: 60_000, run }] })).toThrow(/Duplicate timer id/);
    expect(() => combine({ ...alpha(), timers: [{ id: 'a', everyMs: 10, run }] })).toThrow(/at most once a second/);
  });

  it('keeps an extension\'s defaults for the fields its hook leaves out', async () => {
    const x = combine(alpha({ userDetail: () => ({ user: {}, detail: { alphaCount: 2 } }) as never }));
    expect(await x.run('userDetail', { userId: 7, now })).toEqual({ user: { alphaFlag: false }, detail: { alphaCount: 2 } });
  });

  it('logs a hook that throws or rejects and keeps that extension\'s defaults; the others still answer; run never rejects', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation((() => undefined) as never);
    const x = combine(
      alpha({ review: () => { throw new Error('boom'); }, answer: async () => { throw new Error('later'); } }),
      beta({ review: () => ({ beta: 'still here' }) }),
    );
    expect(await x.run('review', { user, reviewLogId: 1, now })).toEqual({ alpha: null, beta: 'still here' });
    expect(await x.run('answer', { user, sets: [{ deckId: 1, deckName: 'Unit 1' }], now })).toEqual({ alphaList: [] });
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toMatchObject({ event: 'extension.hook_failed', extension: 'alpha', hook: 'review' });
    expect(error.mock.calls[1][0]).toMatchObject({ event: 'extension.hook_failed', extension: 'alpha', hook: 'answer' });
  });

  it('refuses a duplicate id, a bad id and two extensions with one router key', () => {
    expect(() => combine(alpha(), alpha())).toThrow(/Duplicate extension id: alpha/);
    for (const id of ['', 'Alpha', 'my_ext', 'a/b', '../x']) {
      expect(() => combine({ ...alpha(), id }), id).toThrow(/Extension id must match/);
    }
    expect(() => combine(alpha(), { ...beta(), routers: { alpha: sampleRouter } })).toThrow(/alpha and beta-2 both define the router alpha/);
  });

  it('refuses two extensions that declare one response field, group by group', () => {
    const withDefaults = (defaults: object) => ({ ...beta(), defaults } as never);
    const empty = { review: {}, studyFinish: {}, answer: {}, roundSummary: {}, studyAllOverview: {}, userDetail: { user: {}, detail: {} } };
    expect(() => combine(alpha(), withDefaults({ ...empty, studyFinish: { alphaDay: 'x' } })))
      .toThrow(/alpha and beta-2 both declare the field studyFinish\.alphaDay/);
    expect(() => combine(alpha(), withDefaults({ ...empty, userDetail: { user: { alphaFlag: true }, detail: {} } })))
      .toThrow(/alpha and beta-2 both declare the field userDetail\.user\.alphaFlag/);
    expect(() => combine(alpha(), withDefaults({ ...empty, userDetail: { user: {}, detail: { alphaCount: 1 } } })))
      .toThrow(/alpha and beta-2 both declare the field userDetail\.detail\.alphaCount/);
    // One name in two groups (or in user and detail) is two fields: allowed.
    expect(() => combine(alpha(), withDefaults({ ...empty, answer: { alpha: 1 }, userDetail: { user: { alphaCount: 1 }, detail: {} } })))
      .not.toThrow();
  });

  it('keeps only the fields an extension declares: a hook cannot add another extension\'s or core\'s', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation((() => undefined) as never);
    const x = combine(
      alpha({ review: () => ({ alpha: 5 }) }),
      beta({
        review: () => ({ beta: 'told', alpha: 99, reviewLogId: 0 }) as never,
        userDetail: () => ({ user: { betaUser: 1, role: 'admin' }, detail: { betaDetail: [], user: null } }) as never,
      }),
    );
    expect(await x.run('review', { user, reviewLogId: 1, now })).toEqual({ alpha: 5, beta: 'told' });
    expect(await x.run('review', { user, reviewLogId: 2, now })).toEqual({ alpha: 5, beta: 'told' });
    expect(await x.run('userDetail', { userId: 7, now })).toEqual({
      user: { alphaFlag: false, betaUser: 1 }, detail: { alphaCount: 0, betaDetail: [] },
    });
    // Logged once per field, however often the hook says it.
    expect(warn.mock.calls.map(([fields]) => (fields as { field: string }).field)).toEqual([
      'review.alpha', 'review.reviewLogId', 'userDetail.user.role', 'userDetail.detail.user',
    ]);
    expect(warn.mock.calls[0][0]).toMatchObject({ event: 'extension.field_undeclared', extension: 'beta-2', hook: 'review' });
  });
});

describe('fieldsBeside()', () => {
  it('gives the fields as they are when none has the name of a core field', () => {
    const fields = { alphaFlag: true };
    expect(fieldsBeside({ id: 1, role: 'user' }, fields)).toBe(fields);
  });

  it('drops a field with the name of a core field (logged once), so core\'s stands wherever the spread sits', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation((() => undefined) as never);
    const core = { id: 1, role: 'user' };
    // Typed loosely here on purpose: with real types tsc refuses this call (FieldsBeside / fieldsBeside).
    const fields = { role: 'admin', alphaFlag: true } as Record<string, unknown>;
    const kept = fieldsBeside(core, fields as never, 'test.user');
    expect(kept).toEqual({ alphaFlag: true });
    expect(fields).toEqual({ role: 'admin', alphaFlag: true });
    expect({ ...core, ...kept }).toEqual({ id: 1, role: 'user', alphaFlag: true });
    expect({ ...kept, ...core }).toEqual({ alphaFlag: true, id: 1, role: 'user' });
    fieldsBeside(core, fields as never, 'test.user');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ event: 'extension.field_clash', where: 'test.user', field: 'role' });
  });
});

describe('the registry', () => {
  it('holds what setExtensions gives it until resetExtensions', async () => {
    setExtensions(combine(alpha({ review: () => ({ alpha: 1 }) })) as never);
    expect(ext().ids).toEqual(['alpha']);
    expect(await ext().run('review', { user, reviewLogId: 1, now })).toEqual({ alpha: 1 });
    resetExtensions();
    expect(ext().ids).toEqual([]);
    expect(await ext().run('review', { user, reviewLogId: 1, now })).toEqual({});
  });
});

describe('combine(): the legal pages\' disclosures (privacy)', () => {
  const prior = (slug: string, document: 'privacy' | 'terms' = 'privacy') => ({
    document, slug, version: '1.0', effective: '(undated)', summary: 'First', markdown: '# Old',
  });

  it('is empty with no extension, or none that says anything', () => {
    for (const x of [combine(), combine(alpha())]) {
      expect(x.privacy).toEqual({
        instanceSections: [], summaryParagraphs: [], values: {}, plannedChanges: [], subprocessorRows: [], subprocessorSections: [], priorVersions: [], documents: {}, fields: [], computed: [],
      });
    }
  });

  it('keeps every block in extension order, and the first value each placeholder is given', () => {
    const one = { ...alpha(), privacy: {
      instanceSections: ['**A.** one'], summaryParagraphs: ['A says.'],
      values: { sample_fact: ' A fact. ', sample_note: '' },
      priorVersions: [prior('v1')],
    } };
    const two = { ...beta(), privacy: {
      instanceSections: ['**B.** two'], plannedChanges: ['| B | planned | row |'],
      subprocessorRows: ['| B Inc. | sends | a name | US |'], subprocessorSections: ['### B Inc. {#b}\n\n- **Function:** sends.'],
      values: { sample_fact: 'Ignored.', sample_note: 'plus B' },
      priorVersions: [prior('v1', 'terms')],
    } };
    const x = combine(one, two);
    expect(x.privacy.instanceSections).toEqual(['**A.** one', '**B.** two']);
    expect(x.privacy.summaryParagraphs).toEqual(['A says.']);
    expect(x.privacy.plannedChanges).toEqual(['| B | planned | row |']);
    expect(x.privacy.subprocessorRows).toEqual(['| B Inc. | sends | a name | US |']);
    expect(x.privacy.subprocessorSections).toEqual(['### B Inc. {#b}\n\n- **Function:** sends.']);
    expect(x.privacy.values).toEqual({ sample_fact: 'A fact.', sample_note: 'plus B' });
    expect(x.privacy.priorVersions.map((p) => `${p.document}/${p.slug}`)).toEqual(['privacy/v1', 'terms/v1']);
    expect(Object.isFrozen(x.privacy)).toBe(true);
  });

  it('refuses two prior versions at one address, and a bad slug', () => {
    expect(() => combine({ ...alpha(), privacy: { priorVersions: [prior('v1'), prior('v1')] } })).toThrow(/privacy\/v1/);
    expect(() => combine({ ...alpha(), privacy: { priorVersions: [prior('../x')] } })).toThrow(/slug/);
  });

  it('refuses a value name that is no placeholder name', () => {
    expect(() => combine({ ...alpha(), privacy: { values: { 'Bad-Name': 'x' } } })).toThrow(/Legal value name/);
  });
});

describe('combine(): an instance\'s own legal documents (legalDocuments)', () => {
  const field = (key: string) => ({ key, fallback: { kind: 'omit' as const }, help: 'A sample field.' });

  it('gathers each page, the fields and the computed placeholders, in extension order', () => {
    const one = { ...alpha(), legalDocuments: { documents: { privacy: '# A' }, fields: [field('a_fact')], computed: () => ({ a_line: 'x' }) } };
    const two = { ...beta(), legalDocuments: { documents: { terms: '# B' }, fields: [field('b_fact')] } };
    const x = combine(one, two);
    expect(x.privacy.documents).toEqual({ privacy: '# A', terms: '# B' });
    expect(x.privacy.fields.map((f) => f.key)).toEqual(['a_fact', 'b_fact']);
    expect(x.privacy.computed).toHaveLength(1);
    expect(Object.isFrozen(x.privacy.documents)).toBe(true);
  });

  it('refuses a page two extensions replace, a field core has, a field two declare, and a bad field name', () => {
    const page = (ext: ReturnType<typeof alpha>) => ({ ...ext, legalDocuments: { documents: { privacy: '# X' } } });
    expect(() => combine(page(alpha()), page(beta()))).toThrow(/both replace the legal page privacy/);
    expect(() => combine({ ...alpha(), legalDocuments: { documents: {}, fields: [field('support_email')] } })).toThrow(/which core has/);
    expect(() => combine(
      { ...alpha(), legalDocuments: { documents: {}, fields: [field('same')] } },
      { ...beta(), legalDocuments: { documents: {}, fields: [field('same')] } },
    )).toThrow(/both declare the legal field same/);
    expect(() => combine({ ...alpha(), legalDocuments: { documents: {}, fields: [field('Bad')] } })).toThrow(/Legal field name/);
  });
});
