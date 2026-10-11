// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { combineClient, type AnswerResponse, type ClientExtension, type RoundSummary, type StudyFinishReport } from './api';
import { clientExtensions, ExtensionSlot, extensionTabs, makeExtensionHelpers, tabIdsWith, tabsWith, useConjugationParts, useDeckFinishParts, useStudyAllFinishParts } from './index';
import { clientExtensions as none } from './none';

/** Sample extensions, written inline: no fixture folder named like an extension ships. */
const alpha: ClientExtension = {
  id: 'alpha',
  messages: { es: { 'Alpha news': 'Noticias alfa' } },
  adminTabs: [{ id: 'alpha-tab', after: 'groups', label: (t) => t('Alpha tab'), Component: () => <p>Alpha admin</p> }],
  slots: {
    'dashboard.top': ({ isAdmin }) => (isAdmin ? null : <p>Alpha top</p>),
    'userDetail.sections': () => <section>Alpha section</section>,
  },
  useDeckFinishScreen: ({ deckId, done }) => ({ top: done ? <p>Alpha top {deckId}</p> : null, note: <p>Alpha note</p> }),
  useStudyAllFinishScreen: ({ done }) => ({ top: done ? <p>Alpha all</p> : null }),
};
const beta: ClientExtension = {
  id: 'beta-2',
  messages: { es: { 'Beta news': 'Noticias beta' }, fr: { 'Beta news': 'Nouvelles bêta' } } as ClientExtension['messages'],
  adminTabs: [
    { id: 'beta-tab', after: 'groups', label: () => 'Beta', Component: () => null },
    { id: 'beta-end', after: 'no-such-tab', label: () => 'Beta end', Component: () => null },
  ],
  slots: { 'dashboard.top': () => <p>Beta top</p> },
  useDeckFinishScreen: () => ({ note: <p>Beta note</p> }),
};
const CORE_TABS = ['dashboard', 'groups', 'decks', 'users'] as const;
const t = (text: string) => `[${text}]`;
const report = null as StudyFinishReport | null;

describe('with no extensions (none.tsx, the core project)', () => {
  it('has nothing: no ids, messages or tabs, and every slot empty', () => {
    expect(none.ids).toEqual([]);
    expect(none.messages).toEqual({});
    expect(none.adminTabs).toEqual([]);
    for (const list of Object.values(none.slots)) expect(list).toEqual([]);
    expect(none.deckFinish).toEqual([]);
    expect(none.studyAllFinish).toEqual([]);
    expect(none.conjugationPage).toEqual([]);
  });

  it('is what the core project resolves @libresrs/client-extensions to', () => {
    expect(clientExtensions.ids).toEqual([]);
    expect(extensionTabs).toEqual([]);
  });

  it('renders nothing in a slot, and the page hooks give nothing', () => {
    const { container } = render(<div data-testid="host"><ExtensionSlot name="dashboard.top" isAdmin={false} /></div>);
    expect(container.querySelector('[data-testid="host"]')?.childNodes).toHaveLength(0);
    // The runner's two slots (v1.26.0) too, whatever the answer carries.
    const answer = { sampleField: { label: 'Sample note' } } as unknown as AnswerResponse;
    const runner = render(
      <div data-testid="runner">
        <ExtensionSlot name="conjugation.header" round={{ roundId: 1, scope: 'all', position: 2, prompts: 20 }} lastAnswer={answer} />
        <ExtensionSlot name="conjugation.verdictNote" answer={answer} />
      </div>,
    );
    expect(runner.getByTestId('runner').childNodes).toHaveLength(0);
    expect(renderHook(() => useDeckFinishParts({ deckId: 1, done: true, report })).result.current).toEqual({ top: null, note: null });
    expect(renderHook(() => useStudyAllFinishParts({ done: true, report })).result.current).toEqual({ top: null, note: null });
    const conj = renderHook(() => useConjugationParts({ scope: 'deck' })).result.current;
    expect(conj.top).toBeNull();
    expect(() => conj.onSetsFinished([{ deckId: 1, deckName: 'Unit 1' }])).not.toThrow();
    expect(() => conj.onRoundFinished({ roundId: 1 } as RoundSummary, 1)).not.toThrow();
  });

  it('keeps the core tabs as they are', () => {
    expect(tabIdsWith(CORE_TABS)).toEqual([...CORE_TABS]);
    const core = CORE_TABS.map((id) => ({ id, label: id.toUpperCase() }));
    expect(tabsWith(core, t)).toEqual(core);
  });
});

describe('combineClient', () => {
  it('merges ids, messages, tabs, slots and page hooks in order', () => {
    const x = combineClient(alpha, beta);
    expect(x.ids).toEqual(['alpha', 'beta-2']);
    expect(x.messages).toEqual({ es: { 'Alpha news': 'Noticias alfa', 'Beta news': 'Noticias beta' }, fr: { 'Beta news': 'Nouvelles bêta' } });
    expect(x.adminTabs.map((tab) => tab.id)).toEqual(['alpha-tab', 'beta-tab', 'beta-end']);
    expect(x.slots['dashboard.top']).toHaveLength(2);
    expect(x.slots['userDetail.sections']).toHaveLength(1);
    expect(x.slots['conjugation.summaryNote']).toEqual([]);
    expect(x.deckFinish).toHaveLength(2);
    expect(x.studyAllFinish).toHaveLength(1);
    expect(x.conjugationPage).toEqual([]);
  });

  it('refuses a duplicate or bad id, a duplicate tab id and a message key two extensions define', () => {
    expect(() => combineClient(alpha, alpha)).toThrow(/Duplicate extension id: alpha/);
    for (const id of ['', 'Alpha', 'a_b', 'x/y']) expect(() => combineClient({ id }), id).toThrow(/Extension id must match/);
    expect(() => combineClient(alpha, { id: 'gamma', adminTabs: [{ ...alpha.adminTabs![0] }] })).toThrow(/Duplicate admin tab id \(gamma\): alpha-tab/);
    expect(() => combineClient(alpha, { id: 'gamma', messages: { es: { 'Alpha news': 'otra' } } })).toThrow(/Duplicate message key for es \(gamma\): Alpha news/);
  });
});

describe('the helpers, with sample extensions', () => {
  const x = makeExtensionHelpers(combineClient(alpha, beta));

  it('renders each extension\'s slot component in order, with the slot\'s props', () => {
    const { rerender } = render(<x.ExtensionSlot name="dashboard.top" isAdmin={false} />);
    expect(screen.getAllByText(/top$/).map((p) => p.textContent)).toEqual(['Alpha top', 'Beta top']);
    rerender(<x.ExtensionSlot name="dashboard.top" isAdmin />);
    expect(screen.queryByText('Alpha top')).toBeNull();
    expect(screen.getByText('Beta top')).toBeInTheDocument();
  });

  it('renders nothing for a slot no extension fills', () => {
    const { container } = render(<x.ExtensionSlot name="conjugation.summaryNote" summary={{} as RoundSummary} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('merges the finish-screen parts in extension order, and gives null when none has anything', () => {
    const { result, rerender } = renderHook((p: { done: boolean }) => x.useDeckFinishParts({ deckId: 4, done: p.done, report }), { initialProps: { done: true } });
    render(<div data-testid="top">{result.current.top}</div>);
    render(<div data-testid="note">{result.current.note}</div>);
    expect(screen.getByTestId('top').textContent).toBe('Alpha top 4');
    expect(screen.getByTestId('note').textContent).toBe('Alpha noteBeta note');
    rerender({ done: false });
    expect(result.current.top).toBeNull();

    const all = renderHook((p: { done: boolean }) => x.useStudyAllFinishParts({ done: p.done, report }), { initialProps: { done: false } });
    expect(all.result.current).toEqual({ top: null, note: null });
  });

  it('calls every extension\'s conjugation callbacks, which stay the same across renders, with the latest parts', () => {
    const seen: string[] = [];
    const counting: ClientExtension = {
      id: 'counting',
      useConjugationPage: ({ scope }) => {
        const [n, setN] = useState(0);
        useEffect(() => { if (n === 0) setN(1); }, [n]);
        return {
          top: <p>{scope} {n}</p>,
          onSetsFinished: (sets) => seen.push(`sets ${sets.length} at ${n}`),
          onRoundFinished: (summary, deckId) => seen.push(`round ${summary.roundId} in ${deckId} at ${n}`),
        };
      },
    };
    const other: ClientExtension = { id: 'other', useConjugationPage: () => ({ onRoundFinished: () => seen.push('other round') }) };
    const y = makeExtensionHelpers(combineClient(counting, other));
    const { result, rerender } = renderHook((p: { scope: 'deck' | 'all' }) => y.useConjugationParts(p), { initialProps: { scope: 'deck' } });
    const first = result.current;
    rerender({ scope: 'all' });
    expect(result.current.onSetsFinished).toBe(first.onSetsFinished);
    expect(result.current.onRoundFinished).toBe(first.onRoundFinished);
    result.current.onSetsFinished([{ deckId: 1, deckName: 'Unit 1' }, { deckId: 2, deckName: 'Unit 2' }]);
    first.onRoundFinished({ roundId: 9 } as RoundSummary, 3);
    expect(seen).toEqual(['sets 2 at 1', 'round 9 in 3 at 1', 'other round']);
    render(<div data-testid="conj">{result.current.top}</div>);
    expect(screen.getByTestId('conj').textContent).toBe('all 1');
  });

  it('inserts each extension tab after its core tab, in order, and one with an unknown `after` at the end', () => {
    expect(x.tabIdsWith(CORE_TABS)).toEqual(['dashboard', 'groups', 'alpha-tab', 'beta-tab', 'decks', 'users', 'beta-end']);
    const core = CORE_TABS.map((id) => ({ id, label: id }));
    expect(x.tabsWith(core, t)).toEqual([
      { id: 'dashboard', label: 'dashboard' }, { id: 'groups', label: 'groups' },
      { id: 'alpha-tab', label: '[Alpha tab]' }, { id: 'beta-tab', label: 'Beta' },
      { id: 'decks', label: 'decks' }, { id: 'users', label: 'users' }, { id: 'beta-end', label: 'Beta end' },
    ]);
    expect(x.extensionTabs.map((tab) => tab.id)).toEqual(['alpha-tab', 'beta-tab', 'beta-end']);
  });

  it('refuses an extension tab with a core tab\'s id', () => {
    const y = makeExtensionHelpers(combineClient({ id: 'clash', adminTabs: [{ id: 'users', after: 'groups', label: () => 'x', Component: () => null }] }));
    expect(() => y.tabIdsWith(CORE_TABS)).toThrow(/has a core tab's id/);
  });

  it('calls no page hook it does not have (the hooks list is fixed at build time)', () => {
    const use = vi.fn(() => ({}));
    const y = makeExtensionHelpers(combineClient({ id: 'one', useStudyAllFinishScreen: use }));
    renderHook(() => y.useDeckFinishParts({ deckId: 1, done: true, report }));
    expect(use).not.toHaveBeenCalled();
    renderHook(() => y.useStudyAllFinishParts({ done: true, report }));
    expect(use).toHaveBeenCalledWith({ done: true, report: null });
  });
});
