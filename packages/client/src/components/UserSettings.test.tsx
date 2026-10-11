import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import UserSettings from './UserSettings';

const setData = vi.fn();
const mutate = vi.fn();

const baseSettings = {
  userId: 1,
  newCardsPerDay: 20,
  reviewsPerDay: 30,
  aiEnabled: true,
  createdAt: '',
  updatedAt: '',
};
let mockSettingsData: Record<string, unknown> = baseSettings;
let mockAiConfig: Record<string, boolean> = { pronunciation: false, image: false, mnemonic: false };

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        get: {
          setData,
        },
      },
    }),
    settings: {
      get: {
        useQuery: () => ({
          data: mockSettingsData,
          isLoading: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutate,
          isPending: false,
          isSuccess: false,
        }),
      },
    },
    ai: {
      getConfig: {
        useQuery: () => ({
          data: mockAiConfig,
        }),
      },
    },
    cards: {
      exportMyHistory: {
        useQuery: () => ({ data: undefined, refetch: vi.fn() }),
      },
    },
  },
}));

describe('UserSettings', () => {
  beforeEach(() => {
    mockSettingsData = baseSettings;
    mockAiConfig = { pronunciation: false, image: false, mnemonic: false };
    mutate.mockClear();
  });

  it('offers Manual only or Disabled for mnemonics, with no cognate switch (v1.20.0), and saves no cognate setting', async () => {
    mockAiConfig = { pronunciation: false, image: false, mnemonic: true };
    mockSettingsData = { ...baseSettings, mnemonicMode: 'manual', mnemonicModeLocked: false };
    const user = userEvent.setup();
    await act(async () => {
      render(<UserSettings />);
    });

    const mode = screen.getByLabelText('Mnemonic generation');
    expect(mode).toHaveValue('manual');
    expect([...mode.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['manual', 'disabled']);
    expect(screen.queryByText(/cognate/i)).toBeNull();

    await act(async () => {
      await user.selectOptions(mode, 'disabled');
      await user.click(screen.getByRole('button', { name: /save settings/i }));
    });
    const sent = mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ mnemonicMode: 'disabled' });
    expect(sent).not.toHaveProperty('showCognateScore');
  });

  it('enables Save Settings when limits change', async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(<UserSettings />);
    });

    const saveButton = await screen.findByRole('button', { name: /save settings/i });
    const reviewsInput = screen.getByLabelText(/reviews per day/i);
    await waitFor(() => expect(reviewsInput).toHaveValue(30));
    await waitFor(() => expect(saveButton).toBeDisabled());

    const newCardsInput = screen.getByLabelText(/new cards per day/i);
    await act(async () => {
      await user.clear(newCardsInput);
      await user.type(newCardsInput, '25');
    });

    expect(saveButton).toBeEnabled();
  });

  it('explains what reviews are', async () => {
    await act(async () => {
      render(<UserSettings />);
    });
    expect(screen.getByText('Reviews are cards that come back after you learned them (not new cards).')).toBeInTheDocument();
  });

  it('disables the two limits when the teacher set them, and still saves the other fields', async () => {
    mockSettingsData = {
      ...baseSettings,
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      limitsLocked: true,
      limitsAllowHigher: true,
      limitsAllowLower: false,
      aiEnabled: true,
    };
    const user = userEvent.setup();
    await act(async () => {
      render(<UserSettings />);
    });

    const newCardsInput = screen.getByLabelText(/new cards per day/i);
    const reviewsInput = screen.getByLabelText(/reviews per day/i);
    await waitFor(() => expect(newCardsInput).toHaveValue(20));
    expect(newCardsInput).toBeDisabled();
    expect(reviewsInput).toBeDisabled();
    expect(screen.getByText('Set by your teacher.')).toHaveAttribute('id', 'limits-locked');
    expect(newCardsInput).toHaveAttribute('aria-describedby', 'limits-locked');
    expect(reviewsInput).toHaveAttribute('aria-describedby', 'limits-locked');

    // The language still saves; the limits go back unchanged.
    const saveButton = screen.getByRole('button', { name: /save settings/i });
    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Language'), 'es');
    });
    expect(saveButton).toBeEnabled();
    await act(async () => {
      await user.click(saveButton);
    });
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ newCardsPerDay: 20, reviewsPerDay: 20, locale: 'es' }));
  });

  it('leaves the limits editable without a teacher override', async () => {
    await act(async () => {
      render(<UserSettings />);
    });
    expect(screen.getByLabelText(/new cards per day/i)).toBeEnabled();
    expect(screen.getByLabelText(/reviews per day/i)).toBeEnabled();
    expect(screen.queryByText('Set by your teacher.')).not.toBeInTheDocument();
  });
});
