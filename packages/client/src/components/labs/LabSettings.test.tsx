// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabSettings from './LabSettings';

// Shared with the trpc mock below (vi.mock factories are hoisted).
type Settings = { minAnsweredPct: number; voicePerPauseMs: number; gateMarginDb: number; holdOutsideVoice: boolean };
const SAVED: Settings = { minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false };

const h = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  loadError: null as { message: string } | null,
  saveCalls: [] as unknown[],
  saveFails: null as string | null,
  setData: [] as unknown[],
  invalidated: [] as string[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      labs: {
        settings: {
          setData: (_input: undefined, value: unknown) => { h.setData.push(value); },
          invalidate: async () => { h.invalidated.push('settings'); },
        },
        submissions: { invalidate: async () => { h.invalidated.push('submissions'); } },
      },
    }),
    labs: {
      settings: {
        useQuery: () => ({ data: h.settings, isLoading: h.settings === undefined && !h.loadError, error: h.loadError }),
      },
      saveSettings: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: Settings) => {
            h.saveCalls.push(input);
            if (h.saveFails) throw new Error(h.saveFails);
            return input;
          },
        }),
      },
    },
  },
}));

const pctInput = () => screen.getByLabelText('Pauses a student must answer (%)');
const voiceInput = () => screen.getByLabelText('Voice needed in a pause (seconds)');
const holdBox = () => screen.getByRole('checkbox', { name: 'Also hold labs with voice outside the pauses' });
const marginInput = () => screen.getByLabelText('Room margin (dB)');

describe('LabSettings', () => {
  beforeEach(() => {
    h.settings = { ...SAVED };
    h.loadError = null;
    h.saveCalls.length = 0;
    h.saveFails = null;
    h.setData.length = 0;
    h.invalidated.length = 0;
  });

  it('shows the saved rule, with what each number means', () => {
    render(<LabSettings />);

    expect(screen.getByRole('heading', { name: 'Speaking in the pauses' })).toBeInTheDocument();
    expect(pctInput()).toHaveValue(0);
    expect(pctInput()).toHaveAttribute('step', '5');
    expect(pctInput()).toHaveAccessibleDescription('0 turns this off: every lab counts.');
    expect(voiceInput()).toHaveValue(0.25);
    expect(voiceInput()).toHaveAttribute('min', '0.2');
    expect(voiceInput()).toHaveAttribute('max', '2');
    expect(voiceInput()).toHaveAttribute('step', '0.05');
    expect(screen.getByText('The microphone hears whether there is a voice in a pause, not what is said.')).toBeInTheDocument();
    expect(screen.getByText('Changes apply to labs started from now on.')).toBeInTheDocument();
    // The two holds that always apply, and the one the teacher may add.
    expect(screen.getByText(/^While the rule is on, two kinds of lab always wait for you instead of counting/)).toBeInTheDocument();
    expect(holdBox()).not.toBeChecked();
    expect(holdBox()).toHaveAccessibleDescription('A phone, a video, music or a neighbour, not answers. In a loud room or on speakers this can hold honest students.');
    // The room margin, under Advanced.
    expect(screen.getByText('Advanced').closest('details')).not.toHaveAttribute('open');
    expect(marginInput()).toHaveValue(6);
    expect(marginInput()).toHaveAttribute('min', '4');
    expect(marginInput()).toHaveAttribute('max', '12');
    expect(marginInput()).toHaveAccessibleDescription('How much louder than the room a voice must be to count.');
  });

  it('saves the share and the voice in milliseconds, then says so', async () => {
    const user = userEvent.setup();
    render(<LabSettings />);

    await user.clear(pctInput());
    await user.type(pctInput(), '75');
    await user.clear(voiceInput());
    await user.type(voiceInput(), '0.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.saveCalls).toEqual([{ minAnsweredPct: 75, voicePerPauseMs: 500, gateMarginDb: 6, holdOutsideVoice: false }]);
    expect(h.setData).toEqual([{ minAnsweredPct: 75, voicePerPauseMs: 500, gateMarginDb: 6, holdOutsideVoice: false }]);
    expect(h.invalidated).toEqual(expect.arrayContaining(['settings', 'submissions']));
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('refuses a share outside 0–100 and a voice outside 0.2–2 s without saving', async () => {
    const user = userEvent.setup();
    render(<LabSettings />);

    await user.clear(pctInput());
    await user.type(pctInput(), '120');
    await user.clear(voiceInput());
    await user.type(voiceInput(), '0.1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.saveCalls).toEqual([]);
    expect(pctInput()).toHaveAttribute('aria-invalid', 'true');
    expect(voiceInput()).toHaveAttribute('aria-invalid', 'true');
    expect(pctInput()).toHaveAccessibleDescription(/Use a whole number from 0 to 100\./);
    expect(voiceInput()).toHaveAccessibleDescription('Use a number of seconds from 0.2 to 2.');
    expect(screen.getByRole('status')).toHaveTextContent('');

    // A fraction of a percent is not a whole number either; the voice is fixed.
    await user.clear(pctInput());
    await user.type(pctInput(), '7.5');
    await user.clear(voiceInput());
    await user.type(voiceInput(), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([]);
    expect(voiceInput()).not.toHaveAttribute('aria-invalid');

    await user.clear(pctInput());
    await user.type(pctInput(), '100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([{ minAnsweredPct: 100, voicePerPauseMs: 2000, gateMarginDb: 6, holdOutsideVoice: false }]);
  });

  it('takes 0.2 s, the lowest voice in a pause', async () => {
    const user = userEvent.setup();
    render(<LabSettings />);

    await user.clear(voiceInput());
    await user.type(voiceInput(), '0.2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([expect.objectContaining({ voicePerPauseMs: 200 })]);
  });

  it('saves the hold for voice outside the pauses, and shows it saved', async () => {
    const user = userEvent.setup();
    render(<LabSettings />);

    await user.click(holdBox());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([{ minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: true }]);

    h.settings = { ...SAVED, holdOutsideVoice: true };
    render(<LabSettings />);
    expect(screen.getAllByRole('checkbox', { name: 'Also hold labs with voice outside the pauses' }).at(-1)).toBeChecked();
  });

  it('saves the room margin, and opens Advanced to show a margin outside 4–12', async () => {
    const user = userEvent.setup();
    render(<LabSettings />);

    await user.click(screen.getByText('Advanced'));
    await user.clear(marginInput());
    await user.type(marginInput(), '13');
    // Closed again: the problem opens it.
    await user.click(screen.getByText('Advanced'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([]);
    expect(screen.getByText('Advanced').closest('details')).toHaveAttribute('open');
    expect(marginInput()).toHaveAttribute('aria-invalid', 'true');
    expect(marginInput()).toHaveAccessibleDescription('How much louder than the room a voice must be to count. Use a whole number from 4 to 12.');

    await user.clear(marginInput());
    await user.type(marginInput(), '8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.saveCalls).toEqual([{ minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 8, holdOutsideVoice: false }]);
    expect(marginInput()).not.toHaveAttribute('aria-invalid');
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    h.saveFails = 'Forbidden';
    render(<LabSettings />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.saveCalls).toEqual([SAVED]);
    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows loading and load errors inside the card', () => {
    h.settings = undefined;
    const { unmount } = render(<LabSettings />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    unmount();

    h.loadError = { message: 'Could not load' };
    render(<LabSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
  });
});
