// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin › Labs with exam labs (v1.19.0): the Edit row's "Exam (test audio)"
 * switch and set name (required, trimmed, sent only when it changed), the
 * notice for students already counted as started, the test badge, and the
 * Tests section whose "Students and resets" opens a set's list.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabManager from './LabManager';

const h = vi.hoisted(() => ({
  labs: [] as unknown[],
  updateCalls: [] as unknown[],
  updateResult: { success: true, examSet: null, pastStarts: 0 } as unknown,
  invalidated: [] as string[],
  examSetsCalls: 0,
  rosterInputs: [] as unknown[],
  /** Admin › Speaking's tasks (speaking.adminList), answered only while the query is enabled. */
  speakingTasks: [] as { examSet: string | null }[],
  speakingEnabled: [] as unknown[],
}));

vi.mock('../../api/trpc', () => {
  const mutation = (onCall?: (input: unknown) => unknown) => ({
    useMutation: (options?: { onSuccess?: () => void }) => ({
      isPending: false,
      mutate: (input: unknown, callOptions?: { onSuccess?: () => void }) => {
        onCall?.(input);
        options?.onSuccess?.();
        callOptions?.onSuccess?.();
      },
      mutateAsync: async (input: unknown) => { const out = onCall?.(input); options?.onSuccess?.(); return out; },
    }),
  });
  const invalidate = (name: string) => ({ invalidate: async () => { h.invalidated.push(name); } });
  return {
    trpc: {
      useUtils: () => ({
        labs: {
          adminList: invalidate('adminList'),
          examSets: invalidate('examSets'),
          examRoster: invalidate('examRoster'),
          settings: { setData: () => {}, invalidate: async () => {} },
          submissions: invalidate('submissions'),
        },
      }),
      admin: { getGroups: { useQuery: () => ({ data: [{ id: 1, name: 'Year 1 Spanish' }] }) } },
      speaking: {
        adminList: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
            h.speakingEnabled.push(options?.enabled);
            return { data: options?.enabled === false ? undefined : h.speakingTasks };
          },
        },
      },
      labs: {
        adminList: { useQuery: () => ({ data: h.labs, isLoading: false }) },
        create: mutation(() => ({ id: 99 })),
        update: mutation((input) => { h.updateCalls.push(input); return h.updateResult; }),
        remove: mutation(),
        setPauses: mutation(() => ({ success: true })),
        settings: { useQuery: () => ({ data: { minAnsweredPct: 0, voicePerPauseMs: 250 }, isLoading: false, error: null }) },
        saveSettings: mutation(),
        examSets: {
          useQuery: () => {
            h.examSetsCalls += 1;
            return {
              data: [{
                examSet: 'U3',
                labs: [{ id: 41, title: 'Examen U3 · Forma A', active: true }, { id: 42, title: 'Examen U3 · Forma B', active: false }],
                studentCount: 120, startedCount: 37, finishedCount: 30, resetCount: 2,
              }],
              isLoading: false,
              error: null,
            };
          },
        },
        examRoster: {
          useQuery: (input: unknown) => {
            h.rosterInputs.push(input);
            return { data: { examSet: 'U3', labs: [], students: [] }, isLoading: false, error: null };
          },
        },
        resetExamStart: mutation(),
      },
    },
  };
});

vi.mock('../../utils/labAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/labAudio')>()),
  scanLabUrl: async () => { throw new Error('not in these tests'); },
  scanLabFile: async () => { throw new Error('not in these tests'); },
}));

const scan = { minPauseMs: 3300, thresholdDb: -45.3, noiseDb: -200, shortestKeptMs: 3570, longestLeftOutMs: 2920, closeCalls: 0 };

function lab(overrides: Record<string, unknown>) {
  return {
    id: 1,
    title: 'ES1 Lab semana01',
    description: null,
    audioUrl: '/api/assets/semana01.mp3',
    mimeType: 'audio/mpeg',
    durationMs: 888_436,
    requiredThroughMs: 880_000,
    forEveryone: false,
    active: true,
    createdBy: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    pauseCountUntilMs: null,
    pauseCount: 97,
    pauseTotal: 97,
    pauseScan: { ...scan, scannedAt: 1 },
    needsCheck: false,
    groupIds: [1],
    turnedInCount: 0,
    studentCount: 0,
    doneCount: 0,
    redoCount: 0,
    checkCount: 0,
    flaggedCount: 0,
    lookCount: 0,
    lastSubmittedAt: null,
    examSet: null,
    ...overrides,
  };
}

const renderManager = () => render(<MemoryRouter><LabManager /></MemoryRouter>);
const labsTable = () => screen.getAllByRole('table').at(-1)!;
const rowOf = (title: string) => within(labsTable()).getAllByRole('row').find((r) => r.textContent?.includes(title))!;
const edit = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  await user.click(within(rowOf(title)).getByRole('button', { name: 'Edit' }));
};
/** The Edit row's Save (the pause rule above has its own). */
const save = () => within(labsTable()).getByRole('button', { name: 'Save' });
const examSwitch = () => screen.getByRole('checkbox', { name: 'Exam (test audio)' });
const setBox = () => screen.getByRole('combobox', { name: 'Exam set' });

beforeEach(() => {
  h.labs = [
    lab({ id: 1, title: 'ES1 Lab semana01' }),
    lab({ id: 41, title: 'Examen U3 · Forma A', examSet: 'U3', pauseCount: null, pauseTotal: null, pauseScan: null }),
  ];
  h.updateCalls.length = 0;
  h.updateResult = { success: true, examSet: null, pastStarts: 0 };
  h.invalidated.length = 0;
  h.examSetsCalls = 0;
  h.rosterInputs.length = 0;
  h.speakingTasks = [];
  h.speakingEnabled.length = 0;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('LabManager: the lab editor’s exam switch', () => {
  it('makes a practice lab a test: the set is required, trimmed and sent with the save', async () => {
    const user = userEvent.setup();
    h.updateResult = { success: true, examSet: 'U3', pastStarts: 0 };
    renderManager();
    await edit(user, 'semana01');
    expect(examSwitch()).not.toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Exam set' })).toBeNull();

    await user.click(examSwitch());
    expect(setBox()).toHaveAttribute('placeholder', 'for example U3');
    // The honest limit is in the help text.
    expect(screen.getByText(/The audio file is still a public link: anyone who has the link can play it outside libreSRS\./)).toBeInTheDocument();

    // Empty: refused, nothing saved.
    await user.click(save());
    expect(screen.getByText('Name the exam set (for example U3).')).toBeInTheDocument();
    expect(h.updateCalls).toEqual([]);

    await user.type(setBox(), '  U3   final ');
    await user.click(save());
    expect(h.updateCalls).toEqual([expect.objectContaining({ id: 1, examSet: 'U3 final' })]);
    // Groups were not touched: not sent.
    expect(h.updateCalls[0]).not.toHaveProperty('groupIds');
    expect(h.invalidated).toEqual(expect.arrayContaining(['examSets', 'examRoster']));
  });

  it('a plain title edit sends no exam set, for a practice lab or a test', async () => {
    const user = userEvent.setup();
    renderManager();
    for (const title of ['semana01', 'Forma A']) {
      await edit(user, title);
      const titleBox = within(labsTable()).getByRole('textbox', { name: 'Title' });
      await user.type(titleBox, ' (editado)');
      await user.click(save());
    }
    expect(h.updateCalls).toHaveLength(2);
    for (const call of h.updateCalls) expect(call).not.toHaveProperty('examSet');
    expect(h.updateCalls.map((call) => (call as { title: string }).title))
      .toEqual(['ES1 Lab semana01 (editado)', 'Examen U3 · Forma A (editado)']);
  });

  it('shows a test with its set, and switching it off sends null', async () => {
    const user = userEvent.setup();
    renderManager();
    await edit(user, 'Forma A');
    expect(examSwitch()).toBeChecked();
    expect(setBox()).toHaveValue('U3');
    await user.click(examSwitch());
    await user.click(save());
    expect(h.updateCalls).toEqual([expect.objectContaining({ id: 41, examSet: null })]);
  });

  it('warns that moving a test to another set charges its past players there, and resets do not carry over', async () => {
    const user = userEvent.setup();
    renderManager();
    await edit(user, 'Forma A');
    const warning = "Students who already played this lab count as started in the new set. Resets don't carry over.";
    expect(screen.queryByText(warning)).toBeNull();
    // The same set whatever the case: no warning.
    await user.clear(setBox());
    await user.type(setBox(), 'u3');
    expect(screen.queryByText(warning)).toBeNull();
    await user.clear(setBox());
    await user.type(setBox(), 'U4');
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('says how many students who already played the lab now count as started', async () => {
    const user = userEvent.setup();
    h.updateResult = { success: true, examSet: 'U2', pastStarts: 14 };
    renderManager();
    await edit(user, 'semana01');
    await user.click(examSwitch());
    await user.type(setBox(), 'U2');
    await user.click(save());
    expect(screen.getByText('14 student(s) who already played this lab count as started in U2.')).toHaveAttribute('role', 'status');
  });

  it('offers the sets already used as suggestions, speaking tests’ too, each once, in natural order', async () => {
    const user = userEvent.setup();
    // Admin › Speaking has tests in U4, U10 and (another spelling) u3, and a practice task.
    h.speakingTasks = [{ examSet: 'U10' }, { examSet: null }, { examSet: 'u3' }, { examSet: 'U4' }];
    renderManager();
    // Not asked for until the set field is open.
    expect(h.speakingEnabled).not.toContain(true);
    await edit(user, 'semana01');
    expect(h.speakingEnabled).not.toContain(true);
    await user.click(examSwitch());
    const list = document.getElementById(setBox().getAttribute('list')!)!;
    // The lab's spelling of U3, as the server keeps it.
    expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual(['U3', 'U4', 'U10']);
  });
});

describe('LabManager: tests in the labs list and the Tests section', () => {
  it('badges a test with its set, and leaves tests out of the missing pause lists', () => {
    renderManager();
    expect(within(rowOf('Forma A')).getByText('Test · U3')).toBeInTheDocument();
    expect(within(rowOf('semana01')).queryByText(/Test ·/)).toBeNull();
    // The test has no pause list, and is not counted as missing one.
    expect(screen.queryByText(/have no pause list yet/)).toBeNull();
  });

  it('shows the Tests section first, only once a lab is in a set', () => {
    const { unmount } = renderManager();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent).slice(0, 2))
      .toEqual(['Tests (exam sets)', 'Speaking in the pauses']);
    const card = screen.getByRole('heading', { name: 'Exam set U3' }).closest('li')!;
    expect(card).toHaveTextContent('Examen U3 · Forma A · Visible');
    expect(card).toHaveTextContent('Examen U3 · Forma B · Hidden');
    expect(card).toHaveTextContent('37 of 120 started · 30 turned in · 2 reset(s)');
    unmount();

    h.labs = [lab({ id: 1 })];
    h.examSetsCalls = 0;
    renderManager();
    expect(screen.queryByRole('heading', { name: 'Tests (exam sets)' })).toBeNull();
    expect(h.examSetsCalls).toBe(0);
  });

  it('"Students and resets" opens the set’s list in place of the tab, and Back returns', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: 'Students and resets: U3' }));
    expect(h.rosterInputs.at(-1)).toEqual({ examSet: 'U3' });
    expect(screen.getByRole('heading', { name: 'Exam set U3' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Upload labs' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to labs' }));
    expect(screen.getByRole('heading', { name: 'Upload labs' })).toBeInTheDocument();
  });

  it('refreshes the sets when a test is shown or hidden', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('checkbox', { name: 'Visible to students: Examen U3 · Forma A' }));
    expect(h.updateCalls).toEqual([{ id: 41, active: false }]);
    expect(h.invalidated).toEqual(expect.arrayContaining(['adminList', 'examSets']));
  });

  it('says a deleted test’s starts still count in its set', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(within(rowOf('Forma A')).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalledWith(
      "Delete “Examen U3 · Forma A” and everything turned in for it? Students who started it keep their start in U3: reset them in the set's student list. This cannot be undone.",
    );
  });
});
