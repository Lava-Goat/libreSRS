// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupPinsButton from './GroupPinsButton';
import { pinsCsv, pinsTsv, type PinRow } from '../../utils/pinsCsv';
import { downloadCsv } from '../../utils/downloadCsv';
import { I18nProvider } from '../../i18n';
import { LOCALE_STORAGE_KEY } from '../../i18n/messages';

type GroupResult = { pins: PinRow[]; skippedHavePin: number; skippedNotStudent: number };

const h = vi.hoisted(() => ({
  status: { students: 30, withPin: 4 } as unknown,
  statusAsked: [] as { input: unknown; enabled?: boolean }[],
  refetch: vi.fn(async () => ({})),
  sent: [] as unknown[],
  answer: null as unknown,
  fail: false,
  /** createForGroup stays in flight (the server is still making the PINs). */
  hold: false,
  resets: 0,
}));

vi.mock('../../utils/downloadCsv', () => ({ downloadCsv: vi.fn() }));

vi.mock('../../api/trpc', async () => {
  const { useState } = await import('react');
  return {
    trpc: {
      pins: {
        groupStatus: {
          useQuery: (input: unknown, options?: { enabled?: boolean }) => {
            h.statusAsked.push({ input, enabled: options?.enabled });
            return { data: options?.enabled === false ? undefined : h.status, refetch: h.refetch };
          },
        },
        createForGroup: {
          useMutation: (options?: { onSuccess?: (data: unknown) => void }) => {
            const [data, setData] = useState<unknown>(undefined);
            const [isError, setError] = useState(false);
            const [isPending, setPending] = useState(false);
            return {
              data,
              isError,
              isPending,
              mutate: (input: unknown) => {
                h.sent.push(input);
                if (h.hold) {
                  setPending(true);
                  return;
                }
                if (h.fail) {
                  setError(true);
                  return;
                }
                setData(h.answer);
                options?.onSuccess?.(h.answer);
              },
              reset: () => {
                h.resets += 1;
                setData(undefined);
                setError(false);
              },
            };
          },
        },
      },
    },
  };
});

/** Test PINs (never real ones). */
const ROWS: PinRow[] = [
  { userId: 2, name: 'Ana López', email: '123456@students.school.test', studentNumber: '123456', pin: '5927' },
  { userId: 3, name: 'Beto Ruiz', email: '234567@students.school.test', studentNumber: '234567', pin: '6184' },
];

function made(overrides: Partial<GroupResult> = {}): GroupResult {
  return { pins: ROWS, skippedHavePin: 0, skippedNotStudent: 1, ...overrides };
}

const dialog = () => screen.getByRole('dialog', { name: 'Make PINs for Year 1 Spanish' });

describe('GroupPinsButton', () => {
  let confirm: ReturnType<typeof vi.spyOn>;
  const writeText = vi.fn(async (_text: string) => {});

  beforeEach(() => {
    h.status = { students: 30, withPin: 4 };
    h.statusAsked = [];
    h.refetch.mockClear();
    h.sent = [];
    h.answer = made();
    h.fail = false;
    h.hold = false;
    h.resets = 0;
    window.localStorage.clear();
    vi.mocked(downloadCsv).mockClear();
    confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** userEvent.setup() puts its own clipboard on navigator: ours goes on after it. */
  const setupUser = () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return user;
  };

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    render(<GroupPinsButton groupId={7} groupName="Year 1 Spanish" />);
    await user.click(screen.getByRole('button', { name: 'Make PINs…' }));
    return dialog();
  }

  it('asks for the counts only once opened, and makes PINs for those without one by default', async () => {
    const user = setupUser();
    render(<GroupPinsButton groupId={7} groupName="Year 1 Spanish" />);
    expect(h.statusAsked.every((a) => a.enabled === false)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Make PINs…' }));
    expect(h.statusAsked.at(-1)).toEqual({ input: { groupId: 7 }, enabled: true });
    expect(within(dialog()).getByText('4 of 30 students have a PIN.')).toBeInTheDocument();
    expect(within(dialog()).getByText('Students without a PIN get one.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('checkbox', { name: /Also replace the PINs/ })).not.toBeChecked();

    await user.click(within(dialog()).getByRole('button', { name: 'Make PINs' }));
    expect(h.sent).toEqual([{ groupId: 7, onlyMissing: true }]);
    expect(h.refetch).toHaveBeenCalled();
  });

  it('asks before replacing the PINs students have, and sends onlyMissing false', async () => {
    const user = setupUser();
    const box = await openDialog(user);
    confirm.mockReturnValueOnce(false);
    await user.click(within(box).getByRole('checkbox', { name: /Also replace the PINs/ }));
    expect(confirm).toHaveBeenCalledWith('Replace the PINs students already have? Their old PINs stop working.');
    expect(within(box).getByRole('checkbox', { name: /Also replace the PINs/ })).not.toBeChecked();

    await user.click(within(box).getByRole('checkbox', { name: /Also replace the PINs/ }));
    expect(within(box).getByRole('checkbox', { name: /Also replace the PINs/ })).toBeChecked();
    // Unticking needs no question.
    confirm.mockClear();
    await user.click(within(box).getByRole('checkbox', { name: /Also replace the PINs/ }));
    expect(confirm).not.toHaveBeenCalled();
    await user.click(within(box).getByRole('checkbox', { name: /Also replace the PINs/ }));

    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    expect(h.sent).toEqual([{ groupId: 7, onlyMissing: false }]);
  });

  it('lists the new PINs once, to download as CSV or copy for Google Sheets', async () => {
    h.answer = made({ skippedHavePin: 4 });
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));

    expect(within(box).getByText('Made 2 PINs. This is the only time they are shown: download or copy them now.')).toBeInTheDocument();
    expect(within(box).getByText('Skipped 4 students who already have a PIN.')).toBeInTheDocument();
    const table = within(box).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Name', 'Email', 'School ID', 'PIN']);
    const ana = within(table).getByRole('rowheader', { name: 'Ana López' }).closest('tr')!;
    expect(within(ana).getAllByRole('cell').map((c) => c.textContent)).toEqual(['123456@students.school.test', '123456', '5927']);
    // Made: no second batch from this dialog.
    expect(within(box).queryByRole('button', { name: 'Make PINs' })).not.toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Download CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith(pinsCsv(ROWS), 'Year_1_Spanish-pins.csv');
    expect(vi.mocked(downloadCsv).mock.calls[0][0].split('\r\n')[0]).toBe('Name,Email,Student number,PIN');

    await user.click(within(box).getByRole('button', { name: 'Copy for Google Sheets' }));
    expect(writeText).toHaveBeenCalledWith(pinsTsv(ROWS));
    expect(await within(box).findByText('Copied!')).toBeInTheDocument();
  });

  it('asks before closing on PINs nobody saved, and forgets them on close', async () => {
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    const resets = h.resets;

    confirm.mockReturnValueOnce(false);
    await user.click(within(box).getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalledWith('Close? These PINs will not be shown again.');
    expect(dialog()).toBeInTheDocument();
    expect(h.resets).toBe(resets);

    await user.click(within(box).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.resets).toBe(resets + 1);
    expect(screen.queryByText('5927')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make PINs…' })).toHaveFocus();

    // Opened again: the list is gone for good.
    await user.click(screen.getByRole('button', { name: 'Make PINs…' }));
    expect(within(dialog()).queryByRole('table')).not.toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Make PINs' })).toBeInTheDocument();
  });

  it('closes without asking once the PINs were downloaded, and on Escape', async () => {
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    await user.click(within(box).getByRole('button', { name: 'Download CSV' }));
    confirm.mockClear();
    await user.keyboard('{Escape}');
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes with nothing made without asking', async () => {
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Close' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when nobody needed a PIN', async () => {
    h.answer = made({ pins: [], skippedHavePin: 30 });
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    expect(within(box).getByText('Nobody needed a PIN: every student in this group has one.')).toBeInTheDocument();
    expect(within(box).queryByRole('table')).not.toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Close' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says when it could not make them', async () => {
    h.fail = true;
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    expect(within(box).getByRole('alert')).toHaveTextContent('Could not make PINs. Try again.');
  });

  it('says how to keep them when the browser refuses the clipboard', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    await user.click(within(box).getByRole('button', { name: 'Copy for Google Sheets' }));
    expect(await within(box).findByText('Could not copy. Use “Download CSV” instead.')).toBeInTheDocument();
    // Still unsaved: closing asks.
    await user.click(within(box).getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalledWith('Close? These PINs will not be shown again.');
  });

  it('stays open while the PINs are being made: neither Escape nor Close loses them', async () => {
    h.hold = true;
    const user = setupUser();
    const box = await openDialog(user);
    await user.click(within(box).getByRole('button', { name: 'Make PINs' }));
    expect(within(box).getByRole('button', { name: 'Making PINs...' })).toBeDisabled();
    const close = within(box).getByRole('button', { name: 'Close' });
    expect(close).toBeDisabled();
    const resets = h.resets;

    // The disabled button lost focus: the teacher clicks in the dialog, then presses Escape there.
    await user.click(within(box).getByRole('heading', { name: 'Make PINs for Year 1 Spanish' }));
    expect(box).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await user.click(close);
    expect(dialog()).toBeInTheDocument();
    expect(h.resets).toBe(resets);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('counts in good Spanish: one PIN, one student skipped', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    h.answer = made({ pins: ROWS.slice(0, 1), skippedHavePin: 1 });
    const user = setupUser();
    render(<I18nProvider><GroupPinsButton groupId={7} groupName="Year 1 Spanish" /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Crear PIN…' }));
    const box = screen.getByRole('dialog', { name: 'Crear PIN para Year 1 Spanish' });
    await user.click(within(box).getByRole('button', { name: 'Crear PIN' }));
    expect(within(box).getByText('Se creó 1 PIN. Es la única vez que se muestra: descárgalo o cópialo ahora.')).toBeInTheDocument();
    expect(within(box).getByText('Se omitió 1 estudiante que ya tiene PIN.')).toBeInTheDocument();
  });

  it('counts in good Spanish: several PINs, several students skipped', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    h.answer = made({ skippedHavePin: 4 });
    const user = setupUser();
    render(<I18nProvider><GroupPinsButton groupId={7} groupName="Year 1 Spanish" /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Crear PIN…' }));
    const box = screen.getByRole('dialog', { name: 'Crear PIN para Year 1 Spanish' });
    await user.click(within(box).getByRole('button', { name: 'Crear PIN' }));
    expect(within(box).getByText('Se crearon 2 PIN. Es la única vez que se muestran: descárgalos o cópialos ahora.')).toBeInTheDocument();
    expect(within(box).getByText('Se omitieron 4 estudiantes que ya tienen PIN.')).toBeInTheDocument();
  });
});
