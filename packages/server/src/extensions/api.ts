// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How an extension plugs into the server (see README.md beside this file).
 *
 * An extension is one object: its tRPC routers, the response fields it adds
 * (their "nothing to tell" defaults, and the hooks that fill them), and any
 * Express routers mounted before the session. Core never imports an extension:
 * it asks the loaded ones through ext() (registry.ts), filled once at boot by
 * loadExtensions() (load.ts).
 */
import type { Router as ExpressRouter } from 'express';
import type { AnyRouter } from '@trpc/server';
import type { AllFlashcardsDay } from '../services/allFlashcards.js';
import type { LegalDocumentName } from '../services/legal/render.js';
import { OPERATOR_FIELD_KEYS, type OperatorField } from '../services/legal/operatorConfig.js';
import { logger } from '../logger.js';

/** The signed-in user a hook is about (ctx.user). */
export interface HookUser { id: number; role: string }
export interface FinishedSet { deckId: number; deckName: string }
export type { AllFlashcardsDay };

/**
 * Where core asks extensions for extra response fields, and what it hands them.
 * Each hook runs OUTSIDE any database transaction.
 */
export interface HookContexts {
  /** cards.review, after the review and its finish of the deck's day. */
  review: { user: HookUser; reviewLogId: number; now: Date };
  /**
   * A study finish (cards.logStudyCompletion session_complete, and the finish a review records).
   * allDone: today's all-flashcards day when every deck is done and a card was rated today (core
   * already recorded it), else null. Admins always get null.
   */
  studyFinish: { user: HookUser; now: Date; allDone: AllFlashcardsDay | null };
  /** conjugation.answer, after its transaction, when it finished sets and the user is not an admin. */
  answer: { user: HookUser; sets: readonly FinishedSet[]; now: Date };
  /**
   * conjugation.answer, after its transaction and before the answer hook, for every answer it
   * graded and stored (never a replay, never one whose deck was deleted meanwhile); the user is
   * not an admin. The round's numbers are after this answer; the times are answerTime()'s.
   */
  answerGraded: AnswerGraded;
  /**
   * A round summary played to its end (not abandoned): from the answer that finished the round
   * (record=true), a replayed answer and conjugation.finish (record=false).
   */
  roundSummary: { user: HookUser; roundId: number; record: boolean };
  /** conjugation.studyAllOverview. */
  studyAllOverview: { user: HookUser; now: Date };
  /** admin.userDetail. */
  userDetail: { userId: number; now: Date };
}
export type HookName = keyof HookContexts;

/** The grading facts of one stored conjugation answer (the answerGraded hook). */
export interface AnswerGraded {
  user: HookUser;
  now: Date;
  /** The stored answer's row (conjugation_answers.id). */
  answerId: number;
  roundId: number;
  scope: 'deck' | 'all';
  /** The round's position and prompt count after this answer. */
  position: number;
  prompts: number;
  levelKind: 'choice' | 'typed-lenient' | 'typed-strict';
  result: 'correct' | 'accent' | 'wrong';
  counted: boolean;
  retry: boolean;
  review: boolean;
  /** What the answer did to the item (services/conjugationQuiz.ts Outcome, 'early' included). */
  outcome: string;
  /** The answer's time as the server trusts it, and whether the page claimed more than had passed. */
  usedMs: number | null;
  timeMismatch: boolean;
  /** This answer ended the round, and the round was played to its last prompt. */
  finished: boolean;
  playedToEnd: boolean;
}

/**
 * Periodic work an extension needs (index.ts starts every timer once the server listens; never
 * under NODE_ENV=test). A run never overlaps the same timer's previous one; a throw is logged
 * (event 'extension.timer_failed') and the next run comes as planned.
 */
export interface ExtensionTimer {
  /** [a-z0-9-]+, unique within its extension. */
  id: string;
  /** At least 1000. */
  everyMs: number;
  run(ctx: { now: Date }): Promise<void> | void;
}

/** The fields each hook adds. userDetail adds to `user` (merged one level deep) and to the top level. */
export interface FieldGroups {
  review: object;
  studyFinish: object;
  answer: object;
  answerGraded: object;
  roundSummary: object;
  studyAllOverview: object;
  userDetail: { user: object; detail: object };
}
export interface NoFields {
  review: {};
  studyFinish: {};
  answer: {};
  answerGraded: {};
  roundSummary: {};
  studyAllOverview: {};
  userDetail: { user: {}; detail: {} };
}
/** Several extensions' fields, group by group (enabled.ts writes MergeFields<A, B> for two). */
export type MergeFields<A extends FieldGroups, B extends FieldGroups> = {
  [K in Exclude<HookName, 'userDetail'>]: A[K] & B[K];
} & {
  userDetail: {
    user: A['userDetail']['user'] & B['userDetail']['user'];
    detail: A['userDetail']['detail'] & B['userDetail']['detail'];
  };
};

export type ServerHooks<F extends FieldGroups> = {
  [K in HookName]: (ctx: HookContexts[K]) => F[K] | Promise<F[K]>;
};
export type RouterMap = Record<string, AnyRouter>;
export interface HttpMount { path: string; router: () => ExpressRouter }

/** A placeholder name of the legal pages ({{name}}): lower case, digits and "_". */
const PLACEHOLDER_RE = /^[a-z0-9_]+$/;

/** A prior version of a legal page, served at /privacy/<slug> or /terms/<slug> and listed in its change log. */
export interface PriorLegalVersion {
  document: 'privacy' | 'terms';
  /** [a-z0-9-]+, the address after the page's own (e.g. "v1"). */
  slug: string;
  version: string;
  /** The change log's "Effective" cell. */
  effective: string;
  /** The change log's "What changed" cell. */
  summary: string;
  /** The full text, Markdown (the same subset and placeholders as the current pages). */
  markdown: string;
}

/**
 * What an extension tells the legal pages about this instance (services/legal/render.ts). Static
 * Markdown; it may use the pages' {{placeholders}}. Core renders it in its own places and never
 * names an extension: the pages place it with these placeholders.
 */
export interface PrivacyDisclosures {
  /**
   * The privacy policy's blocks about this site's own data flows, one each, in order:
   * {{extension_disclosures}} ('' with none) and {{instance_specific_disclosures}} (a "None" line
   * with none).
   */
  instanceSections?: string[];
  /** The privacy summary's paragraphs about this instance, one each: {{instance_disclosures_short}}. */
  summaryParagraphs?: string[];
  /**
   * Values for operator fields the operator configuration leaves unset (core's, or ones a
   * LegalDocumentSet declares): the operator's own value always wins.
   */
  values?: Partial<Record<string, string>>;
  /** Planned changes to where data goes, as whole Markdown table rows: {{planned_changes_instance}}. */
  plannedChanges?: string[];
  /**
   * Third parties this site sends student data to because of the extension, as whole Markdown
   * table rows (| Who | What they do | What student data reaches them | Location |):
   * {{instance_subprocessor_rows}} ('' with none).
   */
  subprocessorRows?: string[];
  /**
   * The same third parties as one block each (a ### heading with its {#anchor}, then bullets):
   * {{instance_subprocessor_sections}} ('' with none).
   */
  subprocessorSections?: string[];
  /** Listed by {{privacy_prior_versions}} / {{terms_prior_versions}} and served at their addresses. */
  priorVersions?: PriorLegalVersion[];
}

/** Placeholders an instance's documents work out from the resolved operator values. */
export type LegalComputed = (values: Readonly<Record<string, string>>) => Record<string, string>;

/**
 * An instance's own legal documents, in place of core's defaults (src/legal/defaults/*.md), page by
 * page: a page it leaves out keeps core's default. services/legal/render.ts fills them like the
 * defaults, with the same placeholders, conditionals and includes.
 */
export interface LegalDocumentSet {
  /**
   * Each page's Markdown template, front matter (title, version, lang) included. An
   * "{{include: privacy-summary.md}}" line names another page by its template file name
   * (privacy-policy.md, privacy-summary.md, terms-of-service.md, subprocessors.md,
   * coppa-notice.md) and takes this set's text of it, else core's.
   */
  documents: Partial<Record<LegalDocumentName, string>>;
  /** Operator fields these texts use beyond core's, each read from LEGAL_<KEY> like core's. */
  fields?: readonly OperatorField[];
  /**
   * Placeholders worked out from the resolved operator values (a sentence that needs a value, a
   * row that needs one of two): it may not reuse a name core or another extension fills.
   */
  computed?: LegalComputed;
}

/** Every extension's disclosures together, in extension order (values: the first extension that sets one). */
export interface CombinedPrivacyDisclosures {
  instanceSections: readonly string[];
  summaryParagraphs: readonly string[];
  values: Partial<Record<string, string>>;
  plannedChanges: readonly string[];
  subprocessorRows: readonly string[];
  subprocessorSections: readonly string[];
  priorVersions: readonly PriorLegalVersion[];
  /** The pages the extensions replace (each by one extension at most). */
  documents: Readonly<Partial<Record<LegalDocumentName, string>>>;
  /** The operator fields their documents declare. */
  fields: readonly OperatorField[];
  computed: readonly LegalComputed[];
}

export interface ServerExtension<F extends FieldGroups = NoFields, R extends RouterMap = {}> {
  /** [a-z0-9-]+; also its folder name under src/extensions/ and drizzle/extensions/. */
  id: string;
  /** Top-level tRPC routers (their paths are e.g. myExtension.list). A key core uses is refused. */
  routers: R;
  /**
   * The fields when a hook is not called (inside a transaction, a finish with nothing to tell)
   * or throws: the "nothing to tell" values.
   */
  defaults: F;
  hooks: Partial<ServerHooks<F>>;
  /**
   * Express routers mounted after the IP rate limiters and before /api/assets, the session and
   * passport (token-authenticated APIs).
   */
  http?: { beforeSession?: HttpMount[] };
  /** Periodic work (ExtensionTimer). */
  timers?: ExtensionTimer[];
  /** What the legal pages say about this extension's data flows (the instance disclosures and others). */
  privacy?: PrivacyDisclosures;
  /** This instance's own legal documents, in place of core's defaults (LegalDocumentSet). */
  legalDocuments?: LegalDocumentSet;
}

/** A timer as core starts it: with the extension it belongs to. */
export interface LoadedTimer extends ExtensionTimer { extension: string }

export interface Extensions<F extends FieldGroups = NoFields, R extends RouterMap = {}> {
  readonly ids: readonly string[];
  readonly routers: R;
  /** Every extension's defaults, merged group by group (fresh objects on each read: spread them). */
  readonly defaults: F;
  /**
   * Calls the hook of every extension in order. Each starts from its defaults; a throw is logged
   * (event 'extension.hook_failed') and that extension's defaults stand. Never rejects.
   */
  run<K extends HookName>(hook: K, ctx: HookContexts[K]): Promise<F[K]>;
  readonly beforeSession: readonly HttpMount[];
  /** Every extension's timers, in order. */
  readonly timers: readonly LoadedTimer[];
  readonly privacy: CombinedPrivacyDisclosures;
}

const ID_RE = /^[a-z0-9-]+$/;
const HOOK_NAMES: readonly HookName[] = ['review', 'studyFinish', 'answer', 'answerGraded', 'roundSummary', 'studyAllOverview', 'userDetail'];

type AnyGroups = Record<Exclude<HookName, 'userDetail'>, Record<string, unknown>> & {
  userDetail: { user: Record<string, unknown>; detail: Record<string, unknown> };
};

/** A deep-enough copy of one group: its own object (userDetail: its user and detail too). */
function copyGroup(hook: HookName, value: unknown): Record<string, unknown> {
  const group = (value ?? {}) as Record<string, unknown>;
  if (hook !== 'userDetail') return { ...group };
  const ud = group as { user?: object; detail?: object };
  return { user: { ...(ud.user ?? {}) }, detail: { ...(ud.detail ?? {}) } };
}

/** Merges `from` into `into` (userDetail: user and detail one level deep; the others Object.assign). */
function mergeGroup(hook: HookName, into: Record<string, unknown>, from: unknown): void {
  if (from === null || typeof from !== 'object') return;
  if (hook !== 'userDetail') {
    Object.assign(into, from);
    return;
  }
  const add = from as { user?: object; detail?: object };
  Object.assign(into.user as object, add.user ?? {});
  Object.assign(into.detail as object, add.detail ?? {});
}

/** The parts of a group whose keys are its fields: [label, object] (userDetail: its user and detail). */
function partsOf(hook: HookName, group: Record<string, unknown>): [string, Record<string, unknown>][] {
  if (hook !== 'userDetail') return [[hook, group]];
  return [['userDetail.user', group.user as Record<string, unknown>], ['userDetail.detail', group.detail as Record<string, unknown>]];
}

/**
 * Keys that two objects share. Core spreads an extension's fields into its own responses, so a shared
 * key would replace core's field (or be replaced by it, depending on where the spread sits).
 */
export type SharedKeys<Core, Fields> = Extract<keyof Core, keyof Fields>;

/**
 * An extension's fields as a core response type declares them: tsc refuses, in a tree whose
 * extension declares one, a field with the name of one of core's (the response type then asks for
 * an impossible key that names it, so every place that builds the response fails to compile).
 */
export type FieldsBeside<Core, Fields> = [SharedKeys<Core, Fields>] extends [never]
  ? Fields
  : { [K in SharedKeys<Core, Fields> as `extension field "${K & string}" has the name of a core field`]: never };

/**
 * An extension's fields where core builds its response inline (`{ ...core, ...fieldsBeside(core,
 * fields) }`): tsc refuses a field with the name of one of `core`'s, in a tree whose extension
 * declares one, and at run time such a field is dropped (logged once), so core's value stands
 * wherever the spread sits.
 */
export function fieldsBeside<C extends object, E extends object>(
  core: C,
  fields: E & { [K in SharedKeys<C, E>]: never },
  where = 'a core response',
): E {
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(core, key)) continue;
    out ??= { ...(fields as Record<string, unknown>) };
    delete out[key];
    warnOnce(`core:${where}:${key}`, { event: 'extension.field_clash', where, field: key },
      'An extension field has the name of a core field; core\'s stands');
  }
  return (out ?? fields) as E;
}

const warned = new Set<string>();
function warnOnce(key: string, fields: Record<string, unknown>, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(fields, msg);
}

/** Any one extension, whatever its fields and routers. */
export type AnyServerExtension = ServerExtension<FieldGroups, RouterMap>;

/**
 * Several extensions as one: what core reads through ext(). With none, every value is empty.
 * Refuses a bad or duplicate id, and a router or a response field two extensions both declare.
 */
export function combine<F extends FieldGroups = NoFields, R extends RouterMap = {}>(
  ...list: AnyServerExtension[]
): Extensions<F, R> {
  const seen = new Set<string>();
  const routerOwner = new Map<string, string>();
  for (const extension of list) {
    if (!ID_RE.test(extension.id)) throw new Error(`Extension id must match ${ID_RE}: ${JSON.stringify(extension.id)}`);
    if (seen.has(extension.id)) throw new Error(`Duplicate extension id: ${extension.id}`);
    seen.add(extension.id);
    for (const key of Object.keys(extension.routers ?? {})) {
      const owner = routerOwner.get(key);
      if (owner !== undefined) throw new Error(`Extensions ${owner} and ${extension.id} both define the router ${key}`);
      routerOwner.set(key, extension.id);
    }
    const timerIds = new Set<string>();
    for (const timer of extension.timers ?? []) {
      if (!ID_RE.test(timer.id)) throw new Error(`Timer id must match ${ID_RE} (${extension.id}): ${JSON.stringify(timer.id)}`);
      if (timerIds.has(timer.id)) throw new Error(`Duplicate timer id (${extension.id}): ${timer.id}`);
      if (!Number.isInteger(timer.everyMs) || timer.everyMs < 1000) throw new Error(`Timer ${extension.id}:${timer.id} must run at most once a second`);
      timerIds.add(timer.id);
    }
  }
  // A response field belongs to one extension: two declaring it would replace each other's.
  const fieldOwner = new Map<string, string>();
  for (const extension of list) {
    for (const hook of HOOK_NAMES) {
      for (const [part, fields] of partsOf(hook, copyGroup(hook, (extension.defaults as Partial<AnyGroups> | undefined)?.[hook]))) {
        for (const key of Object.keys(fields)) {
          const owner = fieldOwner.get(`${part}.${key}`);
          if (owner !== undefined) throw new Error(`Extensions ${owner} and ${extension.id} both declare the field ${part}.${key}`);
          fieldOwner.set(`${part}.${key}`, extension.id);
        }
      }
    }
  }
  const extensions = [...list];
  const routers = Object.assign({}, ...extensions.map((e) => e.routers ?? {})) as R;

  const defaultsOf = (extension: AnyServerExtension, hook: HookName) =>
    copyGroup(hook, (extension.defaults as Partial<AnyGroups> | undefined)?.[hook]);
  const merged = (hook: HookName): Record<string, unknown> => {
    const out = copyGroup(hook, undefined);
    for (const extension of extensions) mergeGroup(hook, out, defaultsOf(extension, hook));
    return out;
  };
  const defaults = {} as F;
  for (const hook of HOOK_NAMES) {
    Object.defineProperty(defaults, hook, { enumerable: true, get: () => merged(hook) });
  }
  Object.freeze(defaults);

  /** What a hook returned, minus any field its extension's defaults do not declare (logged once). */
  function declaredOnly(extension: AnyServerExtension, hook: HookName, declared: Record<string, unknown>, value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    const got = copyGroup(hook, value);
    const allowed = new Map(partsOf(hook, declared));
    for (const [part, fields] of partsOf(hook, got)) {
      for (const key of Object.keys(fields)) {
        if (Object.prototype.hasOwnProperty.call(allowed.get(part) ?? {}, key)) continue;
        delete fields[key];
        warnOnce(`${extension.id}:${part}:${key}`, { event: 'extension.field_undeclared', extension: extension.id, hook, field: `${part}.${key}` },
          'An extension hook returned a field its defaults do not declare; it is dropped');
      }
    }
    return got;
  }

  async function run<K extends HookName>(hook: K, ctx: HookContexts[K]): Promise<F[K]> {
    const out = merged(hook);
    for (const extension of extensions) {
      const fn = extension.hooks?.[hook] as ((c: HookContexts[K]) => unknown) | undefined;
      if (!fn) continue;
      try {
        // Each starts from its own defaults, so a hook that returns part of its fields keeps the rest,
        // and keeps only the fields it declares there (no other extension's, no core's).
        const own = defaultsOf(extension, hook);
        mergeGroup(hook, own, declaredOnly(extension, hook, own, await fn(ctx)));
        mergeGroup(hook, out, own);
      } catch (err) {
        logger.error({ err, event: 'extension.hook_failed', extension: extension.id, hook }, 'Extension hook failed; its defaults stand');
      }
    }
    return out as F[K];
  }

  return Object.freeze({
    ids: Object.freeze(extensions.map((e) => e.id)),
    routers,
    defaults,
    run,
    beforeSession: Object.freeze(extensions.flatMap((e) => e.http?.beforeSession ?? [])),
    timers: Object.freeze(extensions.flatMap((e) => (e.timers ?? []).map((timer): LoadedTimer => ({
      id: timer.id, everyMs: timer.everyMs, run: (c) => timer.run(c), extension: e.id,
    })))),
    privacy: combinePrivacy(extensions),
  });
}

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * The extensions' legal disclosures and documents as one. Refuses a prior version two of them (or
 * one, twice) give the same address, a page two of them replace, and an operator field core or
 * another extension already declares.
 */
function combinePrivacy(list: readonly AnyServerExtension[]): CombinedPrivacyDisclosures {
  const values: Partial<Record<string, string>> = {};
  const seen = new Set<string>();
  const priorVersions: PriorLegalVersion[] = [];
  const documents: Partial<Record<LegalDocumentName, string>> = {};
  const documentOwner = new Map<string, string>();
  const fields: OperatorField[] = [];
  const fieldOwner = new Map<string, string>();
  const computed: LegalComputed[] = [];
  for (const extension of list) {
    const p = extension.privacy;
    if (p) {
      for (const [key, raw] of Object.entries(p.values ?? {})) {
        if (!PLACEHOLDER_RE.test(key)) throw new Error(`Legal value name must match ${PLACEHOLDER_RE} (${extension.id}): ${JSON.stringify(key)}`);
        const value = raw?.trim();
        if (value && values[key] === undefined) values[key] = value;
      }
      for (const prior of p.priorVersions ?? []) {
        if (!SLUG_RE.test(prior.slug)) throw new Error(`Prior legal version slug must match ${SLUG_RE} (${extension.id}): ${JSON.stringify(prior.slug)}`);
        const at = `${prior.document}/${prior.slug}`;
        if (seen.has(at)) throw new Error(`Two prior legal versions at /${at} (${extension.id})`);
        seen.add(at);
        priorVersions.push({ ...prior });
      }
    }
    const set = extension.legalDocuments;
    if (!set) continue;
    for (const [name, text] of Object.entries(set.documents) as [LegalDocumentName, string | undefined][]) {
      if (typeof text !== 'string') continue;
      const owner = documentOwner.get(name);
      if (owner !== undefined) throw new Error(`Extensions ${owner} and ${extension.id} both replace the legal page ${name}`);
      documentOwner.set(name, extension.id);
      documents[name] = text;
    }
    for (const field of set.fields ?? []) {
      if (!PLACEHOLDER_RE.test(field.key)) throw new Error(`Legal field name must match ${PLACEHOLDER_RE} (${extension.id}): ${JSON.stringify(field.key)}`);
      if (OPERATOR_FIELD_KEYS.has(field.key)) throw new Error(`Extension ${extension.id} declares the legal field ${field.key}, which core has`);
      const owner = fieldOwner.get(field.key);
      if (owner !== undefined) throw new Error(`Extensions ${owner} and ${extension.id} both declare the legal field ${field.key}`);
      fieldOwner.set(field.key, extension.id);
      fields.push({ ...field });
    }
    if (set.computed) computed.push(set.computed);
  }
  const all = <T>(pick: (p: PrivacyDisclosures) => T[] | undefined) =>
    Object.freeze(list.flatMap((e) => (e.privacy ? pick(e.privacy) ?? [] : [])));
  return Object.freeze({
    instanceSections: all((p) => p.instanceSections),
    summaryParagraphs: all((p) => p.summaryParagraphs),
    values: Object.freeze(values),
    plannedChanges: all((p) => p.plannedChanges),
    subprocessorRows: all((p) => p.subprocessorRows),
    subprocessorSections: all((p) => p.subprocessorSections),
    priorVersions: Object.freeze(priorVersions),
    documents: Object.freeze(documents),
    fields: Object.freeze(fields),
    computed: Object.freeze(computed),
  });
}
