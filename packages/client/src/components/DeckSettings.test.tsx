import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import DeckSettings from './DeckSettings';

const setData = vi.fn();
const updateMutate = vi.fn();
const resetMutate = vi.fn();

const nullDeckOverrides = {
  deckAiEnabled: null,
  deckAutoPlayAudio: null,
  deckAutoPlayAudioFront: null,
  deckMnemonicMode: null,
};

let mockDeckSettings: Record<string, unknown> = {};
let mockAiConfig: Record<string, boolean> = { pronunciation: false, image: false, mnemonic: false };

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        getDeckSettings: { setData },
      },
    }),
    settings: {
      getDeckSettings: {
        useQuery: () => ({ data: mockDeckSettings, isLoading: false }),
      },
      get: {
        useQuery: () => ({
          data: {
            newCardsPerDay: 20,
            reviewsPerDay: 20,
            aiEnabled: true,
            autoPlayAudio: false,
            autoPlayAudioFront: false,
            mnemonicMode: 'manual',
          },
        }),
      },
      updateDeckSettings: {
        useMutation: () => ({ mutate: updateMutate, isPending: false }),
      },
      resetDeckSettings: {
        useMutation: () => ({ mutate: resetMutate, isPending: false }),
      },
    },
    ai: {
      getConfig: {
        useQuery: () => ({ data: mockAiConfig }),
      },
    },
  },
}));

function deckSettings(overrides: Record<string, unknown>) {
  return {
    userId: 1,
    deckId: 7,
    newCardsPerDay: 20,
    reviewsPerDay: 20,
    limitRule: 'free',
    teacherNewCardsPerDay: null,
    teacherReviewsPerDay: null,
    aiEnabled: true,
    autoPlayAudio: false,
    autoPlayAudioFront: false,
    mnemonicMode: 'manual',
    ...nullDeckOverrides,
    ...overrides,
  };
}

async function renderPanel() {
  await act(async () => {
    render(<DeckSettings deckId={7} onClose={() => {}} />);
  });
  const newCards = screen.getByLabelText('New cards/day');
  const reviews = screen.getByLabelText('Reviews/day');
  await waitFor(() => expect(newCards).toHaveValue(mockDeckSettings.newCardsPerDay as number));
  return { newCards, reviews, save: screen.getByRole('button', { name: 'Save' }) };
}

async function typeInto(input: HTMLElement, value: string) {
  const user = userEvent.setup();
  await act(async () => {
    await user.clear(input);
    await user.type(input, value);
  });
}

describe('DeckSettings study limits', () => {
  beforeEach(() => {
    updateMutate.mockClear();
    resetMutate.mockClear();
    mockAiConfig = { pronunciation: false, image: false, mnemonic: false };
  });

  it('free: any value from 0 to 500, with no teacher hint', async () => {
    mockDeckSettings = deckSettings({});
    const { newCards, reviews, save } = await renderPanel();

    expect(newCards).toBeEnabled();
    expect(newCards).toHaveAttribute('min', '0');
    expect(newCards).toHaveAttribute('max', '500');
    expect(reviews).toHaveAttribute('min', '0');
    expect(screen.queryByText(/Your teacher set/)).not.toBeInTheDocument();
    expect(screen.queryByText('Set by your teacher.')).not.toBeInTheDocument();

    await typeInto(newCards, '5');
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ deckId: 7, newCardsPerDay: 5, reviewsPerDay: 20 }));
  });

  it('a server or mock without limitRule is treated as free', async () => {
    mockDeckSettings = { ...deckSettings({}), limitRule: undefined, teacherNewCardsPerDay: undefined, teacherReviewsPerDay: undefined };
    const { newCards } = await renderPanel();

    expect(newCards).toBeEnabled();
    expect(newCards).toHaveAttribute('min', '0');
    expect(newCards).toHaveAttribute('max', '500');
  });

  it('higher-only: the teacher\'s value is the minimum, with a hint, and lower values do not save', async () => {
    mockDeckSettings = deckSettings({
      newCardsPerDay: 20,
      reviewsPerDay: 25,
      limitRule: 'higher',
      teacherNewCardsPerDay: 20,
      teacherReviewsPerDay: 25,
    });
    const { newCards, reviews, save } = await renderPanel();

    expect(newCards).toBeEnabled();
    expect(newCards).toHaveAttribute('min', '20');
    expect(newCards).toHaveAttribute('max', '500');
    expect(reviews).toHaveAttribute('min', '25');
    const newHint = screen.getByText('Your teacher set 20. You can go higher.');
    expect(screen.getByText('Your teacher set 25. You can go higher.')).toBeInTheDocument();
    expect(newCards).toHaveAttribute('aria-describedby', newHint.id);

    await typeInto(newCards, '10');
    expect(newCards).toHaveAttribute('aria-invalid', 'true');
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).not.toHaveBeenCalled();

    await typeInto(newCards, '35');
    expect(newCards).not.toHaveAttribute('aria-invalid');
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ newCardsPerDay: 35, reviewsPerDay: 25 }));
  });

  it('lower-only: the teacher\'s value is the maximum, with a hint, and higher values do not save', async () => {
    mockDeckSettings = deckSettings({
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      limitRule: 'lower',
      teacherNewCardsPerDay: 20,
      teacherReviewsPerDay: 20,
    });
    const { newCards, reviews, save } = await renderPanel();

    expect(newCards).toHaveAttribute('min', '0');
    expect(newCards).toHaveAttribute('max', '20');
    expect(reviews).toHaveAttribute('max', '20');
    expect(screen.getAllByText('Your teacher set 20. You can go lower.')).toHaveLength(2);

    await typeInto(reviews, '30');
    expect(reviews).toHaveAttribute('aria-invalid', 'true');
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).not.toHaveBeenCalled();

    await typeInto(reviews, '8');
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ newCardsPerDay: 20, reviewsPerDay: 8 }));
  });

  it('locked: both limits are disabled and say the teacher set them; other changes still save the teacher\'s values', async () => {
    mockAiConfig = { pronunciation: false, image: false, mnemonic: true };
    mockDeckSettings = deckSettings({
      newCardsPerDay: 15,
      reviewsPerDay: 30,
      limitRule: 'locked',
      teacherNewCardsPerDay: 15,
      teacherReviewsPerDay: 30,
    });
    const { newCards, reviews, save } = await renderPanel();

    expect(newCards).toBeDisabled();
    expect(reviews).toBeDisabled();
    const locked = screen.getByText('Set by your teacher.');
    expect(newCards).toHaveAttribute('aria-describedby', locked.id);
    expect(reviews).toHaveAttribute('aria-describedby', locked.id);
    expect(screen.queryByText(/Your teacher set/)).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Override defaults' }));
    });
    expect(save).toBeEnabled();
    await act(async () => {
      await userEvent.setup().click(save);
    });
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({
      deckId: 7,
      newCardsPerDay: 15,
      reviewsPerDay: 30,
      aiEnabled: true,
    }));
  });
});

describe('DeckSettings mnemonic mode (v1.20.0: no cognates)', () => {
  beforeEach(() => {
    updateMutate.mockClear();
    mockAiConfig = { pronunciation: false, image: false, mnemonic: true };
  });

  it('offers Manual only or Disabled, has no cognate switch, and saves no cognate setting', async () => {
    mockDeckSettings = deckSettings({});
    const { save } = await renderPanel();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('checkbox', { name: 'Override defaults' }));
    });

    const mode = screen.getByLabelText('Mnemonic generation');
    expect(mode).toHaveValue('manual');
    expect([...mode.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['manual', 'disabled']);
    expect(screen.queryByText(/cognate/i)).toBeNull();

    await act(async () => {
      await user.selectOptions(mode, 'disabled');
      await user.click(save);
    });
    const sent = updateMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ deckId: 7, mnemonicMode: 'disabled' });
    expect(sent).not.toHaveProperty('showCognateScore');
  });
});
