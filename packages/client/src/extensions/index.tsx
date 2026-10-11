// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What pages use to show the extensions this build has (@libresrs/client-extensions:
 * enabled.tsx when it exists, else none.tsx; see packages/client/extensions.alias.ts).
 * With none, every slot renders nothing, the page hooks give nothing and stable
 * no-op callbacks, and the admin tabs are core's.
 */
import { Fragment, useCallback, useRef, type ReactNode } from 'react';
import { clientExtensions } from '@libresrs/client-extensions';
import type {
  ClientExtensions, FinishedSet, RoundSummary, SlotName, SlotProps, StudyFinishReport, Translate,
} from './api';

export interface FinishParts { top: ReactNode; note: ReactNode }
export interface ConjugationParts {
  top: ReactNode;
  onSetsFinished: (sets: FinishedSet[]) => void;
  onRoundFinished: (summary: RoundSummary, leadDeckId: number) => void;
}

/** Several parts as one node, in extension order; null when none has anything to show. */
function join(nodes: ReactNode[]): ReactNode {
  if (!nodes.some((node) => node != null && node !== false)) return null;
  return <>{nodes.map((node, i) => <Fragment key={i}>{node}</Fragment>)}</>;
}

export function makeExtensionHelpers(x: ClientExtensions) {
  /** Every extension's component for this slot, in order (nothing with none). */
  function ExtensionSlot<K extends SlotName>({ name, ...props }: { name: K } & SlotProps[K]) {
    const components = x.slots[name] as unknown as React.ComponentType<SlotProps[K]>[];
    if (components.length === 0) return null;
    return <>{components.map((Component, i) => <Component key={i} {...(props as unknown as SlotProps[K] & React.JSX.IntrinsicAttributes)} />)}</>;
  }

  function useDeckFinishParts(p: { deckId: number; done: boolean; report: StudyFinishReport | null }): FinishParts {
    const parts = x.deckFinish.map((use) => use(p));
    return { top: join(parts.map((q) => q.top)), note: join(parts.map((q) => q.note)) };
  }

  function useStudyAllFinishParts(p: { done: boolean; report: StudyFinishReport | null }): FinishParts {
    const parts = x.studyAllFinish.map((use) => use(p));
    return { top: join(parts.map((q) => q.top)), note: join(parts.map((q) => q.note)) };
  }

  /** Callbacks are stable (useCallback over a ref to the latest parts), so the runner's effects never re-run on them. */
  function useConjugationParts(p: { scope: 'deck' | 'all' }): ConjugationParts {
    const parts = x.conjugationPage.map((use) => use(p));
    const ref = useRef(parts);
    ref.current = parts;
    const onSetsFinished = useCallback((sets: FinishedSet[]) => {
      for (const q of ref.current) q.onSetsFinished?.(sets);
    }, []);
    const onRoundFinished = useCallback((summary: RoundSummary, leadDeckId: number) => {
      for (const q of ref.current) q.onRoundFinished?.(summary, leadDeckId);
    }, []);
    return { top: join(parts.map((q) => q.top)), onSetsFinished, onRoundFinished };
  }

  /** Core tab ids with each extension tab inserted after its `after` (at the end when that id is unknown). */
  function tabIdsWith(core: readonly string[]): string[] {
    for (const tab of x.adminTabs) {
      if (core.includes(tab.id)) throw new Error(`Extension admin tab ${tab.id} has a core tab's id`);
    }
    const known = new Set(core);
    const out: string[] = [];
    for (const id of core) {
      out.push(id);
      for (const tab of x.adminTabs) if (tab.after === id) out.push(tab.id);
    }
    for (const tab of x.adminTabs) if (!known.has(tab.after)) out.push(tab.id);
    return out;
  }

  /** The tab buttons: core's, with the extension tabs (labelled in the viewer's language) in tabIdsWith's order. */
  function tabsWith<T extends { id: string; label: string }>(core: readonly T[], t: Translate): { id: string; label: string }[] {
    const byId = new Map<string, { id: string; label: string }>(core.map((tab) => [tab.id, tab]));
    for (const tab of x.adminTabs) byId.set(tab.id, { id: tab.id, label: tab.label(t) });
    return tabIdsWith(core.map((tab) => tab.id)).map((id) => byId.get(id)!);
  }

  return {
    ExtensionSlot,
    useDeckFinishParts,
    useStudyAllFinishParts,
    useConjugationParts,
    tabIdsWith,
    tabsWith,
    extensionTabs: x.adminTabs,
  };
}

export const {
  ExtensionSlot,
  useDeckFinishParts,
  useStudyAllFinishParts,
  useConjugationParts,
  tabIdsWith,
  tabsWith,
  extensionTabs,
} = makeExtensionHelpers(clientExtensions);

/** The extensions this build has (their ids, messages and the rest), for main.tsx and tests. */
export { clientExtensions };
