// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabManager from './LabManager';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  labs: [] as unknown[],
  createCalls: [] as unknown[],
  updateCalls: [] as unknown[],
  setPausesCalls: [] as unknown[],
  invalidated: 0,
  scanUrlCalls: [] as string[],
  scanUrl: null as null | ((url: string) => Promise<unknown>),
  scanFile: null as null | (() => Promise<unknown>),
}));

vi.mock('../../api/trpc', () => {
  const mutation = (onCall?: (input: unknown) => unknown) => ({
    useMutation: (options?: { onSuccess?: () => void }) => ({
      isPending: false,
      mutate: (input: unknown) => { onCall?.(input); options?.onSuccess?.(); },
      mutateAsync: async (input: unknown) => { const out = onCall?.(input); options?.onSuccess?.(); return out; },
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        labs: {
          adminList: { invalidate: async () => { h.invalidated += 1; } },
          settings: { setData: () => {}, invalidate: async () => {} },
          submissions: { invalidate: async () => {} },
        },
      }),
      admin: { getGroups: { useQuery: () => ({ data: [{ id: 1, name: 'Year 1 Spanish' }] }) } },
      speaking: { adminList: { useQuery: () => ({ data: [] }) } },
      labs: {
        adminList: { useQuery: () => ({ data: h.labs, isLoading: false }) },
        create: mutation((input) => { h.createCalls.push(input); return { id: 99 }; }),
        update: mutation((input) => { h.updateCalls.push(input); return { success: true }; }),
        remove: mutation(),
        setPauses: mutation((input) => { h.setPausesCalls.push(input); return { success: true }; }),
        settings: { useQuery: () => ({ data: { minAnsweredPct: 0, voicePerPauseMs: 250 }, isLoading: false, error: null }) },
        saveSettings: mutation(),
      },
    },
  };
});

vi.mock('../../api/rawUpload', () => ({
  uploadRaw: async () => ({ audioUrl: '/api/assets/new-lab.mp3', mimeType: 'audio/mpeg' }),
}));

vi.mock('../../utils/labAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/labAudio')>()),
  scanLabUrl: (url: string) => { h.scanUrlCalls.push(url); return h.scanUrl!(url); },
  scanLabFile: () => h.scanFile!(),
}));

const scan = { minPauseMs: 3300, thresholdDb: -45.3, noiseDb: -200, shortestKeptMs: 3570, longestLeftOutMs: 2920, closeCalls: 0 };
const pauses: [number, number][] = Array.from({ length: 12 }, (_, i) => [10_000 + i * 10_000, 13_600 + i * 10_000]);

function lab(overrides: Record<string, unknown>) {
  return {
    id: 1,
    title: 'ES1 Lab semana01',
    description: null,
    audioUrl: '/api/assets/semana01.mp3',
    mimeType: 'audio/mpeg',
    durationMs: 888_436,
    requiredThroughMs: 880_000,
    forEveryone: true,
    active: true,
    createdBy: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    pauseCountUntilMs: null,
    pauseCount: 97,
    pauseTotal: 97,
    pauseScan: { ...scan, scannedAt: 1 },
    needsCheck: false,
    groupIds: [],
    turnedInCount: 0,
    studentCount: 0,
    doneCount: 0,
    redoCount: 0,
    checkCount: 0,
    flaggedCount: 0,
    lookCount: 0,
    lastSubmittedAt: null,
    ...overrides,
  };
}

const renderManager = (onBusyChange?: (busy: boolean) => void) =>
  render(<MemoryRouter><LabManager onBusyChange={onBusyChange} /></MemoryRouter>);
const labsTable = () => screen.getAllByRole('table').at(-1)!;
const rowOf = (title: string) => within(labsTable()).getAllByRole('row').find((r) => r.textContent?.includes(title))!;

describe('LabManager', () => {
  beforeEach(() => {
    h.labs = [
      lab({
        id: 1, title: 'ES1 Lab semana01', turnedInCount: 12, studentCount: 12, doneCount: 8, redoCount: 2, checkCount: 1, flaggedCount: 3, lookCount: 2,
        lastSubmittedAt: '2026-09-25T15:00:00.000Z',
      }),
      lab({ id: 6, title: 'ES1 Lab semana06', audioUrl: '/api/assets/semana06.mp3', pauseCount: 95, pauseTotal: 101, pauseCountUntilMs: 846_000 }),
      lab({ id: 7, title: 'ES1 Lab semana07', audioUrl: '/api/assets/semana07.mp3', needsCheck: true }),
      lab({ id: 8, title: 'ES1 Lab semana08', audioUrl: '/api/assets/semana08.mp3', pauseCount: null, pauseTotal: null, pauseScan: null, needsCheck: false }),
      lab({ id: 9, title: 'ES1 Lab semana09', audioUrl: '/api/assets/semana09.mp3', pauseCount: null, pauseTotal: null, pauseScan: null, needsCheck: false }),
    ];
    h.createCalls.length = 0;
    h.updateCalls.length = 0;
    h.setPausesCalls.length = 0;
    h.invalidated = 0;
    h.scanUrlCalls.length = 0;
    h.scanUrl = async () => ({ durationMs: 900_000, lastSpeechMs: 880_000, pauses, scan });
    h.scanFile = async () => ({ durationMs: 200_000, lastSpeechMs: 190_000, pauses, scan });
  });

  it('puts the pause rule at the top of the Labs tab', () => {
    renderManager();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent);
    expect(headings.slice(0, 3)).toEqual(['Speaking in the pauses', 'Upload labs', 'Labs']);
  });

  it('shows each lab’s pauses and where its students stand', () => {
    renderManager();

    expect(within(rowOf('semana01')).getByText('97')).toBeInTheDocument();
    expect(within(rowOf('semana06')).getByText('101 pauses · 95 count')).toBeInTheDocument();
    expect(within(rowOf('semana07')).getByText('Check the count')).toBeInTheDocument();
    expect(within(rowOf('semana01')).queryByText('Check the count')).toBeNull();
    expect(within(rowOf('semana08')).getByText('Not scanned')).toBeInTheDocument();
    expect(within(rowOf('semana08')).getByRole('button', { name: 'Find pauses' })).toBeInTheDocument();

    const cells = within(rowOf('semana01')).getAllByRole('cell');
    expect(cells[5].textContent).toMatch(/^12 turned in · 2 need a redo · 1 waiting for you · 3 flagged · 2 to look at · /);
    expect(within(cells[5]).getByText('· 3 flagged', { exact: false })).toHaveClass('text-red-700');
    // Amber: an amber flag on the attempt that counts, or on another attempt of a student not already counted.
    expect(within(cells[5]).getByText('· 2 to look at', { exact: false })).toHaveClass('text-amber-800');
    expect(within(rowOf('semana06')).getAllByRole('cell')[5]).toHaveTextContent(/^0 turned in$/);
  });

  it('finds the pauses of every unscanned lab, one at a time, and moves on past a failure', async () => {
    const user = userEvent.setup();
    const busy: boolean[] = [];
    const pending: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = {};
    h.scanUrl = (url) => new Promise((resolve, reject) => { pending[url] = { resolve, reject }; });
    renderManager((b) => busy.push(b));

    expect(screen.getByText('2 lab(s) have no pause list yet, so they use the old rule.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Find pauses in 2 lab(s)' }));

    expect(await screen.findByText('Finding pauses… 0 of 2')).toBeInTheDocument();
    expect(busy.at(-1)).toBe(true);
    // One at a time: the second lab is not fetched until the first is done.
    expect(h.scanUrlCalls).toEqual(['/api/assets/semana08.mp3']);
    expect(within(rowOf('semana09')).getByRole('button', { name: 'Find pauses' })).toBeDisabled();

    pending['/api/assets/semana08.mp3'].reject(new Error('decode failed'));
    expect(await screen.findByText('Finding pauses… 1 of 2')).toBeInTheDocument();
    await waitFor(() => expect(h.scanUrlCalls).toEqual(['/api/assets/semana08.mp3', '/api/assets/semana09.mp3']));

    pending['/api/assets/semana09.mp3'].resolve({ durationMs: 900_000, lastSpeechMs: 880_000, pauses, scan });
    await waitFor(() => expect(busy.at(-1)).toBe(false));

    expect(h.setPausesCalls).toEqual([{ id: 9, pauses, scan }]);
    expect(within(rowOf('semana08')).getByRole('alert')).toHaveTextContent("Could not read this lab's audio.");
    expect(h.invalidated).toBe(2);
  });

  it('finds one lab’s pauses from its row', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(within(rowOf('semana09')).getByRole('button', { name: 'Find pauses' }));

    await waitFor(() => expect(h.setPausesCalls).toEqual([{ id: 9, pauses, scan }]));
    expect(h.scanUrlCalls).toEqual(['/api/assets/semana09.mp3']);
  });

  it('shows no banner when every lab has a pause list', () => {
    h.labs = [lab({})];
    renderManager();
    expect(screen.queryByText(/have no pause list yet/)).toBeNull();
  });

  it('scans each upload for its pauses, flags a doubtful count and sends the list with the lab', async () => {
    const user = userEvent.setup();
    h.scanFile = async () => ({
      durationMs: 200_000, lastSpeechMs: 190_000, pauses, scan: { ...scan, noiseDb: -35.4 },
    });
    renderManager();

    await user.upload(screen.getByLabelText('Lab audio files'), new File(['x'], 'ES1_Lab_semana35.mp3', { type: 'audio/mpeg' }));

    const queue = screen.getAllByRole('table')[0];
    expect(within(queue).getByRole('columnheader', { name: 'Pauses' })).toBeInTheDocument();
    const item = within(queue).getAllByRole('row')[1];
    expect(await within(item).findByText('12')).toBeInTheDocument();
    expect(within(item).getByText('Check the count')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upload 1 lab(s)' }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0]).toMatchObject({
      title: 'ES1 Lab semana35',
      audioUrl: '/api/assets/new-lab.mp3',
      durationMs: 200_000,
      pauses,
      scan: { ...scan, noiseDb: -35.4 },
    });
  });

  it('uploads a lab whose list the server would refuse as unscanned instead of failing', async () => {
    const user = userEvent.setup();
    h.scanFile = async () => ({ durationMs: 20_000, lastSpeechMs: 19_000, pauses: [[1000, 5000], [4000, 9000]], scan });
    renderManager();

    await user.upload(screen.getByLabelText('Lab audio files'), new File(['x'], 'odd.mp3', { type: 'audio/mpeg' }));
    await screen.findByRole('button', { name: 'Upload 1 lab(s)' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload 1 lab(s)' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Upload 1 lab(s)' }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0]).toMatchObject({ pauses: null, scan: null });
  });

  describe('long pauses ("write it down")', () => {
    /** Twelve answer pauses, then three 11 s writing pauses with two short ones between (lab 08's shape). */
    const atEnd: [number, number][] = [...pauses, [130_000, 141_300], [143_000, 149_700], [151_000, 162_300], [164_000, 170_700], [172_000, 183_200]];
    /** Two writing pauses among the answer pauses. */
    const inside: [number, number][] = [[4_000, 15_000], ...pauses.slice(1, 6), [70_000, 81_000], ...pauses.slice(8)];

    it('suggests counting an upload’s pauses only until the writing starts, and saves that point on the new lab', async () => {
      const user = userEvent.setup();
      h.scanFile = async () => ({ durationMs: 200_000, lastSpeechMs: 190_000, pauses: atEnd, scan });
      renderManager();

      await user.upload(screen.getByLabelText('Lab audio files'), new File(['x'], 'ES1_Lab_semana08.mp3', { type: 'audio/mpeg' }));
      // A status line: the scan ends on its own, so a screen reader must hear that a choice is waiting.
      expect(screen.getAllByRole('status')).toContain(await screen.findByText(/^3 pause\(s\) are 10 seconds or longer\./));
      const item = within(screen.getAllByRole('table')[0]).getAllByRole('row')[1];
      expect(within(item).getAllByRole('cell')[3]).toHaveTextContent(/^17$/);

      await user.click(screen.getByRole('button', { name: 'Count pauses only until 2:10' }));
      expect(within(item).getAllByRole('cell')[3]).toHaveTextContent(/^17 pauses · 12 count$/);
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Upload 1 lab(s)' }));
      await waitFor(() => expect(h.updateCalls).toEqual([{ id: 99, pauseCountUntilMs: 130_000 }]));
      // The whole list goes with the lab; the point stops the counting.
      expect(h.createCalls[0]).toMatchObject({ pauses: atEnd });
    });

    it('leaves an upload’s writing pauses out of its list, or keeps them', async () => {
      const user = userEvent.setup();
      h.scanFile = async () => ({ durationMs: 200_000, lastSpeechMs: 190_000, pauses: inside, scan });
      renderManager();

      await user.upload(screen.getByLabelText('Lab audio files'), new File(['x'], 'a.mp3', { type: 'audio/mpeg' }));
      await user.click(await screen.findByRole('button', { name: "Don't count these 2" }));
      const item = within(screen.getAllByRole('table')[0]).getAllByRole('row')[1];
      // Nine left: fewer than a pause-and-respond lab has, so the count is worth a look.
      expect(within(item).getAllByRole('cell')[3]).toHaveTextContent(/^9Check the count$/);
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Upload 1 lab(s)' }));
      await waitFor(() => expect(h.createCalls).toHaveLength(1));
      expect(h.createCalls[0]).toMatchObject({ pauses: [...pauses.slice(1, 6), ...pauses.slice(8)] });
      expect(h.updateCalls).toEqual([]);

      // Another file: kept as found.
      await user.click(screen.getByRole('button', { name: 'Clear finished' }));
      await user.upload(screen.getByLabelText('Lab audio files'), new File(['x'], 'b.mp3', { type: 'audio/mpeg' }));
      await user.click(await screen.findByRole('button', { name: 'Keep them' }));
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Upload 1 lab(s)' }));
      await waitFor(() => expect(h.createCalls).toHaveLength(2));
      expect(h.createCalls[1]).toMatchObject({ pauses: inside });
    });

    it('suggests the same after finding the pauses of a lab uploaded before, under its row', async () => {
      const user = userEvent.setup();
      h.scanUrl = async (url) => ({ durationMs: 900_000, lastSpeechMs: 880_000, pauses: url.includes('semana08') ? inside : atEnd, scan });
      renderManager();

      await user.click(screen.getByRole('button', { name: 'Find pauses in 2 lab(s)' }));
      await waitFor(() => expect(h.setPausesCalls).toHaveLength(2));
      // semana08: among the answer pauses; semana09: at the end.
      const banner = (title: string) => within(labsTable()).getAllByRole('row')
        .find((r) => r.previousElementSibling?.textContent?.includes(title) && /10 seconds or longer/.test(r.textContent ?? ''))!;
      expect(within(banner('semana08')).getByRole('button', { name: "Don't count these 2" })).toBeInTheDocument();
      expect(within(banner('semana09')).getByRole('button', { name: 'Count pauses only until 2:10' })).toBeInTheDocument();
      // Each banner announces itself once "Finding pauses…" has gone.
      expect(within(banner('semana08')).getByRole('status')).toHaveTextContent(/^2 pause\(s\) are 10 seconds or longer\./);
      expect(within(banner('semana09')).getByRole('status')).toHaveTextContent(/^3 pause\(s\) are 10 seconds or longer\./);

      await user.click(within(banner('semana08')).getByRole('button', { name: "Don't count these 2" }));
      await waitFor(() => expect(h.setPausesCalls).toHaveLength(3));
      expect(h.setPausesCalls[2]).toEqual({ id: 8, pauses: [...pauses.slice(1, 6), ...pauses.slice(8)], scan });

      await user.click(within(banner('semana09')).getByRole('button', { name: 'Count pauses only until 2:10' }));
      await waitFor(() => expect(h.updateCalls).toEqual([{ id: 9, pauseCountUntilMs: 130_000 }]));
      await waitFor(() => expect(screen.queryByText(/10 seconds or longer/)).toBeNull());
    });
  });

  it('opens the pause settings in a lab’s Edit row', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(within(rowOf('semana06')).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: 'Pauses' })).toBeInTheDocument();
    expect(screen.getByText('101 pauses · 95 count')).toBeInTheDocument();
    expect(screen.getByLabelText("Don't count pauses after (m:ss)")).toHaveValue('14:06');
    expect(screen.getByRole('button', { name: 'Find pauses again' })).toBeInTheDocument();
  });
});
