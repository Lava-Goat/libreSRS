// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabPause } from '@libresrs/shared';
import LabPauseEditor, { longPauseAdvice, withoutPauses, WRITING_PAUSE_MS, type LabPauseInfo } from './LabPauseEditor';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  updateCalls: [] as unknown[],
  setPausesCalls: [] as unknown[],
  setPausesFails: null as string | null,
  scanCalls: [] as string[],
  scan: null as null | (() => Promise<unknown>),
  invalidated: 0,
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ labs: { adminList: { invalidate: async () => { h.invalidated += 1; } } } }),
    labs: {
      update: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => { h.updateCalls.push(input); return { success: true }; },
        }),
      },
      setPauses: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            h.setPausesCalls.push(input);
            if (h.setPausesFails) throw new Error(h.setPausesFails);
            return { success: true };
          },
        }),
      },
    },
  },
}));

vi.mock('../../utils/labAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/labAudio')>()),
  scanLabUrl: (url: string) => {
    h.scanCalls.push(url);
    return h.scan!();
  },
}));

const scan = { minPauseMs: 3300, thresholdDb: -45.3, noiseDb: -200, shortestKeptMs: 3570, longestLeftOutMs: 2920, closeCalls: 0 };
const semana06: LabPauseInfo = {
  id: 6,
  audioUrl: '/api/assets/semana06.mp3',
  pauseCount: 95,
  pauseTotal: 101,
  pauseScan: scan,
  pauseCountUntilMs: 846_000,
  requiredThroughMs: 930_000,
  needsCheck: false,
};
const found = { durationMs: 939_548, lastSpeechMs: 930_000, pauses: [[28_670, 32_270], [32_760, 36_610]], scan };

const untilInput = () => screen.getByLabelText('Don\'t count pauses after (m:ss)');

/** 82 answer pauses of 3.5 s, then lab 08's dictation: three 11 s "write it down" pauses from 12:54, with two short ones between. */
const answerPauses: LabPause[] = Array.from({ length: 82 }, (_, i) => [10_000 + i * 9_000, 13_500 + i * 9_000]);
const dictation: LabPause[] = [[774_000, 785_200], [790_000, 796_700], [800_000, 811_300], [815_000, 821_700], [826_000, 837_200]];
const lab08 = [...answerPauses, ...dictation];
/** Two writing pauses among the answer pauses, early in the lab. */
const writingInside: LabPause[] = [[10_000, 13_500], [20_000, 31_300], [40_000, 43_500], [50_000, 61_000], ...answerPauses.slice(8)];

describe('longPauseAdvice', () => {
  it('suggests stopping at the first of the writing pauses when they all sit at the end', () => {
    expect(longPauseAdvice(lab08, null, 900_000)).toEqual({ long: [dictation[0], dictation[2], dictation[4]], cutOffMs: 774_000 });
  });

  it('suggests leaving them out when they sit among the answer pauses', () => {
    expect(longPauseAdvice(writingInside, null, 900_000)).toEqual({ long: [[20_000, 31_300], [50_000, 61_000]], cutOffMs: null });
  });

  it('says nothing when no pause that counts is 10 s or longer', () => {
    // The longest answer pause of any course lab.
    expect(longPauseAdvice([...answerPauses, [800_000, 809_610]], null, 900_000)).toBeNull();
    expect(longPauseAdvice([], null, 900_000)).toBeNull();
    // Already cut off, or past the must-hear-through point.
    expect(longPauseAdvice(lab08, 774_000, 900_000)).toBeNull();
    expect(longPauseAdvice(lab08, null, 780_000)).toBeNull();
  });

  it('counts a pause of exactly 10 s as a writing pause', () => {
    expect(longPauseAdvice([...answerPauses, [800_000, 800_000 + WRITING_PAUSE_MS]], null, 900_000)?.long).toEqual([[800_000, 810_000]]);
  });

  it('does not suggest a cut-off that would drop most of the counted pauses, or one more than three minutes from the end', () => {
    // Late in the lab, but more than half of the counted pauses come after it.
    const lateButMost: LabPause[] = [[10_000, 13_500], [20_000, 31_000], ...answerPauses.slice(4, 8)];
    expect(longPauseAdvice(lateButMost, null, 900_000)?.cutOffMs).toBeNull();
    // The writing pauses start over three minutes before the last pause ends.
    const spreadOut: LabPause[] = [...answerPauses.slice(0, 60), [560_000, 571_000], ...answerPauses.slice(63)];
    expect(longPauseAdvice(spreadOut, null, 900_000)).toEqual({ long: [[560_000, 571_000]], cutOffMs: null });
  });

  it('leaves out exactly the pauses given', () => {
    expect(withoutPauses(writingInside, [[20_000, 31_300], [50_000, 61_000]])).toEqual([[10_000, 13_500], [40_000, 43_500], ...answerPauses.slice(8)]);
  });
});

describe('LabPauseEditor', () => {
  beforeEach(() => {
    h.updateCalls.length = 0;
    h.setPausesCalls.length = 0;
    h.setPausesFails = null;
    h.scanCalls.length = 0;
    h.scan = async () => found;
    h.invalidated = 0;
  });

  it('shows how many pauses the scan found, how many count, and the margins', () => {
    render(<LabPauseEditor lab={semana06} />);

    expect(screen.getByText('101 pauses · 95 count')).toBeInTheDocument();
    expect(screen.getByText('Shortest pause 3.57 s · longest other silence 2.92 s')).toBeInTheDocument();
    expect(screen.queryByText(/Compare it with the lab's transcript/)).toBeNull();
    expect(untilInput()).toHaveValue('14:06');
    expect(screen.getByRole('button', { name: 'Find pauses again' })).toBeEnabled();
  });

  it('warns when the count may be off', () => {
    render(<LabPauseEditor lab={{ ...semana06, needsCheck: true, pauseScan: { ...scan, closeCalls: 2 } }} />);
    expect(screen.getByText(/close to the cut-off, or there is sound under the pauses/)).toBeInTheDocument();
  });

  it('works the warning out itself when the lab row does not say', () => {
    const noisy = { ...scan, noiseDb: -35.4 };
    render(<LabPauseEditor lab={{ ...semana06, needsCheck: undefined, pauseScan: noisy }} />);
    expect(screen.getByText(/Compare it with the lab's transcript before you release the lab\./)).toBeInTheDocument();
  });

  it('says when a lab has no answer pauses, and when it was never scanned', () => {
    const { unmount } = render(<LabPauseEditor lab={{ ...semana06, pauseTotal: 0, pauseCount: 0 }} />);
    expect(screen.getByText('No answer pauses found.')).toBeInTheDocument();
    unmount();

    render(<LabPauseEditor lab={{ ...semana06, pauseTotal: null, pauseCount: null, pauseScan: null, pauseCountUntilMs: null }} />);
    expect(screen.getByText('Not scanned')).toBeInTheDocument();
    expect(untilInput()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Find pauses' })).toBeInTheDocument();
  });

  it('applies "don\'t count pauses after", and an empty box counts them all again', async () => {
    const user = userEvent.setup();
    render(<LabPauseEditor lab={{ ...semana06, pauseCountUntilMs: null }} />);

    await user.type(untilInput(), '14:06');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(h.updateCalls).toEqual([{ id: 6, pauseCountUntilMs: 846_000 }]);
    expect(h.invalidated).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');

    await user.clear(untilInput());
    await user.type(untilInput(), '{Enter}');
    expect(h.updateCalls).toEqual([{ id: 6, pauseCountUntilMs: 846_000 }, { id: 6, pauseCountUntilMs: null }]);
  });

  it('keeps the exact saved point when the box is left as shown', async () => {
    const user = userEvent.setup();
    // 14:06.8 shows as 14:07; applying it unchanged must not move the point past the dictation's first pause.
    render(<LabPauseEditor lab={{ ...semana06, pauseCountUntilMs: 846_800 }} />);

    expect(untilInput()).toHaveValue('14:07');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(h.updateCalls).toEqual([{ id: 6, pauseCountUntilMs: 846_800 }]);
  });

  it('refuses a time it cannot read', async () => {
    const user = userEvent.setup();
    render(<LabPauseEditor lab={semana06} />);

    await user.clear(untilInput());
    await user.type(untilInput(), '14h');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(h.updateCalls).toEqual([]);
    expect(untilInput()).toHaveAttribute('aria-invalid', 'true');
    expect(untilInput()).toHaveAccessibleDescription('Type a time like 14:06, or leave it empty.');
  });

  it('finds the pauses again from the lab’s own file and saves them', async () => {
    const user = userEvent.setup();
    const busy: boolean[] = [];
    let finish!: () => void;
    h.scan = () => new Promise((resolve) => { finish = () => resolve(found); });
    render(<LabPauseEditor lab={semana06} onBusyChange={(b) => busy.push(b)} />);

    await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
    expect(screen.getByRole('status')).toHaveTextContent('Scanning…');
    expect(screen.getByRole('button', { name: 'Find pauses again' })).toBeDisabled();
    expect(busy).toEqual([true]);

    finish();
    expect(await screen.findByText('Pauses saved.')).toBeInTheDocument();
    expect(h.scanCalls).toEqual(['/api/assets/semana06.mp3']);
    // The list and the scan only: the lab keeps its "don't count pauses after" point.
    expect(h.setPausesCalls).toEqual([{ id: 6, pauses: found.pauses, scan }]);
    expect(h.invalidated).toBe(1);
    // The busy flag clears in an effect after that render: under a loaded run it can land a moment later.
    await waitFor(() => expect(busy).toEqual([true, false]));
  });

  it('says so when the audio cannot be read, and saves nothing', async () => {
    const user = userEvent.setup();
    h.scan = async () => { throw new Error('decode failed'); };
    render(<LabPauseEditor lab={semana06} />);

    await user.click(screen.getByRole('button', { name: 'Find pauses again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Could not read this lab's audio.");
    expect(h.setPausesCalls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Find pauses again' })).toBeEnabled();
  });

  it('shows the server’s refusal of a pause list', async () => {
    const user = userEvent.setup();
    h.setPausesFails = 'This pause list does not fit the lab. Find the pauses again.';
    render(<LabPauseEditor lab={semana06} />);

    await user.click(screen.getByRole('button', { name: 'Find pauses again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This pause list does not fit the lab.');
    expect(screen.queryByText('Pauses saved.')).toBeNull();
  });

  describe('long pauses found again', () => {
    const noCutOff = { ...semana06, pauseCountUntilMs: null };

    it('suggests counting pauses only until the dictation, and saves that point', async () => {
      const user = userEvent.setup();
      h.scan = async () => ({ ...found, pauses: lab08 });
      render(<LabPauseEditor lab={noCutOff} />);

      await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
      const long = await screen.findByText('3 pause(s) are 10 seconds or longer. In the generator labs these are the “write it down” pauses, where students write instead of speaking.');
      // A status line, so a screen reader hears that a choice is waiting (beside "Pauses saved.").
      expect(screen.getAllByRole('status')).toContain(long);
      expect(h.setPausesCalls).toEqual([{ id: 6, pauses: lab08, scan }]);
      expect(screen.queryByRole('button', { name: "Don't count these 3" })).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Count pauses only until 12:54' }));
      expect(h.updateCalls).toEqual([{ id: 6, pauseCountUntilMs: 774_000 }]);
      expect(untilInput()).toHaveValue('12:54');
      expect(screen.getByRole('status')).toHaveTextContent('Saved.');
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();
    });

    it('offers to leave out writing pauses among the answer pauses, and saves the list without them', async () => {
      const user = userEvent.setup();
      h.scan = async () => ({ ...found, pauses: writingInside });
      render(<LabPauseEditor lab={noCutOff} />);

      await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
      await user.click(await screen.findByRole('button', { name: "Don't count these 2" }));
      expect(h.setPausesCalls).toEqual([
        { id: 6, pauses: writingInside, scan },
        { id: 6, pauses: withoutPauses(writingInside, [[20_000, 31_300], [50_000, 61_000]]), scan },
      ]);
      expect(h.invalidated).toBe(2);
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();
      expect(h.updateCalls).toEqual([]);
    });

    it('keeps them when asked, saving nothing more', async () => {
      const user = userEvent.setup();
      h.scan = async () => ({ ...found, pauses: writingInside });
      render(<LabPauseEditor lab={noCutOff} />);

      await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
      await user.click(await screen.findByRole('button', { name: 'Keep them' }));
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();
      expect(h.setPausesCalls).toHaveLength(1);
      expect(h.updateCalls).toEqual([]);
    });

    it('does not suggest anything for pauses the lab already stops counting', async () => {
      const user = userEvent.setup();
      h.scan = async () => ({ ...found, pauses: lab08 });
      render(<LabPauseEditor lab={{ ...semana06, pauseCountUntilMs: 770_000 }} />);

      await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
      expect(await screen.findByText('Pauses saved.')).toBeInTheDocument();
      expect(screen.queryByText(/10 seconds or longer/)).toBeNull();
    });

    it('shows a refused list and keeps the suggestion', async () => {
      const user = userEvent.setup();
      h.scan = async () => ({ ...found, pauses: writingInside });
      render(<LabPauseEditor lab={noCutOff} />);

      await user.click(screen.getByRole('button', { name: 'Find pauses again' }));
      const dontCount = await screen.findByRole('button', { name: "Don't count these 2" });
      h.setPausesFails = 'This pause list does not fit the lab. Find the pauses again.';
      await user.click(dontCount);
      expect(await screen.findByRole('alert')).toHaveTextContent('This pause list does not fit the lab.');
      expect(screen.getByRole('button', { name: "Don't count these 2" })).toBeEnabled();
    });
  });

  it('waits while another lab is being scanned', () => {
    render(<LabPauseEditor lab={semana06} disabled />);
    expect(screen.getByRole('button', { name: 'Find pauses again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });
});
