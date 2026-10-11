// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserPinPanel from './UserPinPanel';
import { timeOfDay } from './PinLoginSettings';
import { I18nProvider } from '../../i18n';
import { LOCALE_STORAGE_KEY } from '../../i18n/messages';

type Status = {
  userId: number;
  eligible: boolean;
  hasPin: boolean;
  createdAt: number | null;
  lastUsedAt: number | null;
  lockedUntil: number | null;
  failedCount: number;
};

/** A test PIN (never a real one). */
const PIN = '7305';

const h = vi.hoisted(() => ({
  status: undefined as unknown,
  inputs: [] as unknown[],
  refetch: vi.fn(async () => ({})),
  /** What each mutation was sent, by name. */
  sent: { createForUser: [] as unknown[], remove: [] as unknown[], unlock: [] as unknown[] },
  /** What createForUser answers. */
  created: null as unknown,
  resets: 0,
  /** The tRPC error a mutation fails with, by name (none: it succeeds). */
  failures: {} as Partial<Record<'createForUser' | 'remove' | 'unlock', unknown>>,
  /** The tRPC error forUser fails with. */
  statusError: null as unknown,
}));

vi.mock('../../api/trpc', async () => {
  const { useState } = await import('react');
  /** A mutation that answers at once, as far as the panel can tell. */
  const mutation = (name: 'createForUser' | 'remove' | 'unlock', answer: () => unknown) => ({
    useMutation: (options?: { onSuccess?: (data: unknown) => void }) => {
      const [data, setData] = useState<unknown>(undefined);
      const [error, setError] = useState<unknown>(null);
      return {
        data,
        error,
        isPending: false,
        mutate: (input: unknown) => {
          h.sent[name].push(input);
          if (h.failures[name]) {
            setError(h.failures[name]);
            return;
          }
          const result = answer();
          setData(result);
          options?.onSuccess?.(result);
        },
        reset: () => {
          h.resets += 1;
          setData(undefined);
          setError(null);
        },
      };
    },
  });
  return {
    trpc: {
      pins: {
        forUser: {
          useQuery: (input: unknown) => {
            h.inputs.push(input);
            return { data: h.statusError ? undefined : h.status, error: h.statusError, refetch: h.refetch };
          },
        },
        createForUser: mutation('createForUser', () => h.created),
        remove: mutation('remove', () => ({ removed: true })),
        unlock: mutation('unlock', () => ({ unlocked: true })),
      },
    },
  };
});

const SET_ON = Date.parse('2026-03-02T19:05:00Z');
const USED_ON = Date.parse('2026-03-03T15:30:00Z');

function status(overrides: Partial<Status> = {}): Status {
  return { userId: 2, eligible: true, hasPin: false, createdAt: null, lastUsedAt: null, lockedUntil: null, failedCount: 0, ...overrides };
}

const region = () => screen.getByRole('region', { name: 'PIN sign-in' });

describe('UserPinPanel', () => {
  let confirm: ReturnType<typeof vi.spyOn>;
  const writeText = vi.fn(async (_text: string) => {});

  beforeEach(() => {
    h.status = status();
    h.inputs = [];
    h.refetch.mockClear();
    h.sent = { createForUser: [], remove: [], unlock: [] };
    h.created = { userId: 2, name: 'Ana', email: '123456@students.school.test', studentNumber: '123456', pin: PIN };
    h.resets = 0;
    h.failures = {};
    h.statusError = null;
    window.localStorage.clear();
    confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  /** userEvent.setup() puts its own clipboard on navigator: ours goes on after it. */
  const setupUser = () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return user;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says when a student has no PIN yet', () => {
    render(<UserPinPanel userId={2} name="Ana" />);
    expect(h.inputs[0]).toEqual({ userId: 2 });
    expect(within(region()).getByText('PIN: not set')).toBeInTheDocument();
    expect(within(region()).queryByText(/Never used|Last used/)).not.toBeInTheDocument();
    expect(within(region()).getByRole('button', { name: 'Make a new PIN' })).toBeEnabled();
    expect(within(region()).queryByRole('button', { name: 'Remove PIN' })).not.toBeInTheDocument();
  });

  it('says when the PIN was made and last used', () => {
    h.status = status({ hasPin: true, createdAt: SET_ON, lastUsedAt: null });
    const view = render(<UserPinPanel userId={2} name="Ana" />);
    expect(within(region()).getByText(`PIN: set on ${new Date(SET_ON).toLocaleDateString('en')}`)).toBeInTheDocument();
    expect(within(region()).getByText('Never used')).toBeInTheDocument();
    view.unmount();

    h.status = status({ hasPin: true, createdAt: SET_ON, lastUsedAt: USED_ON });
    render(<UserPinPanel userId={2} name="Ana" />);
    expect(within(region()).getByText(`Last used ${new Date(USED_ON).toLocaleDateString('en')}`)).toBeInTheDocument();
    expect(within(region()).getByRole('button', { name: 'Remove PIN' })).toBeInTheDocument();
  });

  it('shows a lock, and unlocks it', async () => {
    const lockedUntil = Date.now() + 15 * 60_000;
    h.status = status({ hasPin: true, createdAt: SET_ON, lockedUntil, failedCount: 0 });
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    expect(within(region()).getByText(`Locked until ${timeOfDay(lockedUntil, 'en')} after too many wrong PINs.`)).toBeInTheDocument();
    await user.click(within(region()).getByRole('button', { name: 'Unlock' }));
    expect(h.sent.unlock).toEqual([{ userId: 2 }]);
    expect(h.refetch).toHaveBeenCalled();
  });

  it('says until when a PIN is locked, in Spanish with the time standing alone', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    const lockedUntil = Date.now() + 15 * 60_000;
    h.status = status({ hasPin: true, createdAt: SET_ON, lockedUntil });
    render(<I18nProvider><UserPinPanel userId={2} name="Ana" /></I18nProvider>);
    expect(screen.getByText(`Bloqueado por demasiados PIN incorrectos (hasta: ${timeOfDay(lockedUntil, 'es')}).`)).toBeInTheDocument();
  });

  it('offers nothing for an admin', () => {
    h.status = status({ eligible: false });
    render(<UserPinPanel userId={2} name="Ana" />);
    expect(within(region()).getByText('Admins sign in with Google only.')).toBeInTheDocument();
    expect(within(region()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('makes nothing when the teacher cancels', async () => {
    confirm.mockReturnValue(false);
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(screen.getByRole('button', { name: 'Make a new PIN' }));
    expect(confirm).toHaveBeenCalledWith('Make a PIN for Ana?');
    expect(h.sent.createForUser).toEqual([]);
  });

  it('warns that the old PIN stops working before replacing it', async () => {
    h.status = status({ hasPin: true, createdAt: SET_ON });
    confirm.mockReturnValue(false);
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(screen.getByRole('button', { name: 'Make a new PIN' }));
    expect(confirm).toHaveBeenCalledWith('Make a new PIN for Ana? Their old PIN stops working.');
    expect(h.sent.createForUser).toEqual([]);
  });

  it('shows the new PIN once, copies it, and forgets it on Done', async () => {
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(screen.getByRole('button', { name: 'Make a new PIN' }));
    expect(h.sent.createForUser).toEqual([{ userId: 2 }]);

    expect(within(region()).getByText('New PIN for Ana:')).toBeInTheDocument();
    expect(within(region()).getByText(PIN).tagName).toBe('CODE');
    expect(within(region()).getByText('This is the only time it is shown. Copy it now.')).toBeInTheDocument();
    // While it is on screen, no second PIN can be made over it.
    expect(within(region()).queryByRole('button', { name: 'Make a new PIN' })).not.toBeInTheDocument();

    await user.click(within(region()).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(PIN);
    expect(await within(region()).findByText('Copied!')).toBeInTheDocument();

    const before = h.refetch.mock.calls.length;
    await user.click(within(region()).getByRole('button', { name: 'Done' }));
    expect(h.resets).toBe(1);
    expect(h.refetch.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByText(PIN)).not.toBeInTheDocument();
    expect(within(region()).getByRole('button', { name: 'Make a new PIN' })).toBeInTheDocument();
  });

  it('says how to copy it by hand when the browser refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(screen.getByRole('button', { name: 'Make a new PIN' }));
    await user.click(within(region()).getByRole('button', { name: 'Copy' }));
    expect(await within(region()).findByText('Could not copy. Select the PIN and copy it.')).toBeInTheDocument();
  });

  it('asks before removing a PIN', async () => {
    h.status = status({ hasPin: true, createdAt: SET_ON });
    const user = setupUser();
    confirm.mockReturnValue(false);
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(screen.getByRole('button', { name: 'Remove PIN' }));
    expect(confirm).toHaveBeenCalledWith('Remove the PIN of Ana? They can no longer sign in with a PIN.');
    expect(h.sent.remove).toEqual([]);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Remove PIN' }));
    expect(h.sent.remove).toEqual([{ userId: 2 }]);
  });

  /** A tRPC error as the client sees it: the server's English message, and its appCode. */
  const trpcError = (message: string, appCode?: string) => ({ message, data: { appCode } });

  it('says why a new PIN failed in the teacher\'s language, never the server\'s English', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    h.failures.createForUser = trpcError('Admins sign in with Google only', 'PIN_NOT_FOR_ADMIN');
    const user = setupUser();
    render(<I18nProvider><UserPinPanel userId={2} name="Ana" /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Crear un PIN nuevo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Los administradores solo entran con Google.');
    expect(screen.queryByText(/Admins sign in with Google only/)).not.toBeInTheDocument();
  });

  it.each([
    ['createForUser', 'Make a new PIN', trpcError('User not found', 'USER_NOT_FOUND'), 'This account no longer exists.'],
    ['createForUser', 'Make a new PIN', trpcError('Internal error'), 'Could not save. Try again.'],
    ['remove', 'Remove PIN', trpcError('Internal error'), 'Could not save. Try again.'],
    ['unlock', 'Unlock', trpcError('User not found', 'USER_NOT_FOUND'), 'This account no longer exists.'],
  ] as const)('says when %s fails (%#)', async (name, button, error, message) => {
    h.status = status({ hasPin: true, createdAt: SET_ON, lockedUntil: Date.now() + 15 * 60_000 });
    h.failures[name] = error;
    const user = setupUser();
    render(<UserPinPanel userId={2} name="Ana" />);
    await user.click(within(region()).getByRole('button', { name: button }));
    expect(within(region()).getByRole('alert')).toHaveTextContent(message);
    expect(within(region()).getByRole('alert').textContent).not.toContain(error.message);
  });

  it.each([
    [trpcError('User not found', 'USER_NOT_FOUND'), 'This account no longer exists.'],
    [trpcError('Failed to fetch'), 'Could not load the PIN. Try again.'],
  ])('says when the PIN status cannot load (%#)', (error, message) => {
    h.statusError = error;
    render(<UserPinPanel userId={2} name="Ana" />);
    expect(within(region()).getByRole('alert')).toHaveTextContent(message);
    expect(within(region()).getByRole('alert').textContent).not.toContain(error.message);
  });
});
