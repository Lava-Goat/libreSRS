// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How an extension plugs into the client (packages/server/src/extensions/README.md):
 * slots core renders in place, React hooks a few pages call at a fixed place,
 * admin tabs and messages. Types only, plus combineClient. This module never
 * imports @libresrs/client-extensions (index.tsx does).
 */
import type { ComponentType, ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server/src/routers/index.ts';
import type { Locale } from '../i18n/messages';

type Out = inferRouterOutputs<AppRouter>;
export type StudyFinishReport = Out['cards']['logStudyCompletion'];
export type RoundSummary = NonNullable<Out['conjugation']['answer']['summary']>;
/** A conjugation answer as the server graded it (with any extension's fields). */
export type AnswerResponse = Out['conjugation']['answer'];
export type StudyAllOverview = Out['conjugation']['studyAllOverview'];
export type UserDetail = Out['admin']['userDetail'];
export type Translate = (text: string, params?: Record<string, string | number>) => string;
export type Messages = Partial<Record<Locale, Record<string, string>>>;
export interface FinishedSet { deckId: number; deckName: string }
/** A conjugation round while a question shows: its question number (from 1) and how many it has now. */
export interface RunnerRound { roundId: number; scope: 'deck' | 'all'; position: number; prompts: number }

/** Stateless slots: core renders each extension's component in place, in extension order. */
export interface SlotProps {
  /** The top of the dashboard. */
  'dashboard.top': { isAdmin: boolean };
  /** The dashboard's side column. */
  'dashboard.side': { isAdmin: boolean };
  /** Study all conjugation's intro, under its counts. */
  'conjugation.studyAllStatus': { overview: StudyAllOverview };
  /** A round's summary, after its results. */
  'conjugation.summaryNote': { summary: RoundSummary };
  /**
   * The runner's header, after "Round", while a question shows: the round, and the last answer the
   * server graded in it (null before its first, and when a round is picked up again). It changes
   * only when a graded answer arrives, never while the student is still answering.
   */
  'conjugation.header': { round: RunnerRound; lastAnswer: AnswerResponse | null };
  /** Inside the verdict's status text, after its headline (read in the same announcement): the answer as graded. */
  'conjugation.verdictNote': { answer: AnswerResponse };
  /** The user page's badges, after the role chip. */
  'userDetail.badges': { detail: UserDetail };
  /** The user page's last sections. */
  'userDetail.sections': { detail: UserDetail };
}
export type SlotName = keyof SlotProps;
export const SLOT_NAMES: readonly SlotName[] = [
  'dashboard.top', 'dashboard.side', 'conjugation.studyAllStatus', 'conjugation.summaryNote', 'conjugation.header', 'conjugation.verdictNote',
  'userDetail.badges', 'userDetail.sections',
];

/** What a finish-screen hook gives the page: `top` above "Saving your finish…", `note` after "More cards are due". */
export interface FinishScreenParts { top?: ReactNode; note?: ReactNode }
export interface ConjugationPageParts {
  /** Above the runner. */
  top?: ReactNode;
  onSetsFinished?(sets: FinishedSet[]): void;
  /** Every summary the runner shows (core decides nothing about its fields). */
  onRoundFinished?(summary: RoundSummary, leadDeckId: number): void;
}
export interface AdminTab {
  id: string;
  /** The core tab it follows (at the end when no core tab has this id). */
  after: string;
  label(t: Translate): string;
  Component: ComponentType;
}

export interface ClientExtension {
  id: string;
  messages?: Messages;
  adminTabs?: AdminTab[];
  slots?: { [K in SlotName]?: ComponentType<SlotProps[K]> };
  /** React hooks, called on every render of the page at a fixed place (the list is fixed at build time). */
  useDeckFinishScreen?(p: { deckId: number; done: boolean; report: StudyFinishReport | null }): FinishScreenParts;
  useStudyAllFinishScreen?(p: { done: boolean; report: StudyFinishReport | null }): FinishScreenParts;
  useConjugationPage?(p: { scope: 'deck' | 'all' }): ConjugationPageParts;
}

export interface ClientExtensions {
  ids: readonly string[];
  messages: Messages;
  adminTabs: readonly AdminTab[];
  slots: { [K in SlotName]: ComponentType<SlotProps[K]>[] };
  deckFinish: NonNullable<ClientExtension['useDeckFinishScreen']>[];
  studyAllFinish: NonNullable<ClientExtension['useStudyAllFinishScreen']>[];
  conjugationPage: NonNullable<ClientExtension['useConjugationPage']>[];
}

const ID_RE = /^[a-z0-9-]+$/;

/** Several client extensions as one. Throws on a bad or duplicate id, a duplicate tab id or a message key two of them define. */
export function combineClient(...list: ClientExtension[]): ClientExtensions {
  const ids = new Set<string>();
  const tabIds = new Set<string>();
  const messages: Record<string, Record<string, string>> = {};
  const slots = Object.fromEntries(SLOT_NAMES.map((name) => [name, []])) as unknown as ClientExtensions['slots'];
  const adminTabs: AdminTab[] = [];
  for (const extension of list) {
    if (!ID_RE.test(extension.id)) throw new Error(`Extension id must match ${ID_RE}: ${JSON.stringify(extension.id)}`);
    if (ids.has(extension.id)) throw new Error(`Duplicate extension id: ${extension.id}`);
    ids.add(extension.id);
    for (const [locale, catalog] of Object.entries(extension.messages ?? {})) {
      const into = (messages[locale] ??= {});
      for (const [key, value] of Object.entries(catalog ?? {})) {
        if (key in into) throw new Error(`Duplicate message key for ${locale} (${extension.id}): ${key}`);
        into[key] = value;
      }
    }
    for (const tab of extension.adminTabs ?? []) {
      if (tabIds.has(tab.id)) throw new Error(`Duplicate admin tab id (${extension.id}): ${tab.id}`);
      tabIds.add(tab.id);
      adminTabs.push(tab);
    }
    for (const name of SLOT_NAMES) {
      const component = extension.slots?.[name];
      if (component) (slots[name] as ComponentType<never>[]).push(component as ComponentType<never>);
    }
  }
  const hooks = <K extends 'useDeckFinishScreen' | 'useStudyAllFinishScreen' | 'useConjugationPage'>(key: K) =>
    list.flatMap((e) => (e[key] ? [e[key]] : [])) as NonNullable<ClientExtension[K]>[];
  return {
    ids: [...ids],
    messages: messages as Messages,
    adminTabs,
    slots,
    deckFinish: hooks('useDeckFinishScreen'),
    studyAllFinish: hooks('useStudyAllFinishScreen'),
    conjugationPage: hooks('useConjugationPage'),
  };
}
