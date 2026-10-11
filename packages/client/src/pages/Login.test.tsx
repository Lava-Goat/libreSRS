// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { LOGO_SRC } from '../brand';

type PinOptions = { pin: boolean; reason: 'on' | 'auto' | null } | null | undefined;

const h = vi.hoisted(() => ({
  pinOptions: undefined as PinOptions,
  pinError: null as Error | null,
  pinAsked: [] as unknown[],
  refetch: vi.fn(async () => ({})),
  loginWithGoogle: vi.fn(),
  /** Re-renders the page as a refetch landing would. */
  rerender: null as null | (() => void),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false, loginWithGoogle: h.loginWithGoogle, loginWithClever: vi.fn() }),
}));

vi.mock('../api/trpc', async () => {
  const { useReducer } = await import('react');
  return {
    trpc: {
      setup: { getStatus: { useQuery: () => ({ data: { needsSetup: false, cleverEnabled: false } }) } },
      pins: {
        loginOptions: {
          useQuery: (input: unknown, options: unknown) => {
            const [, bump] = useReducer((n: number) => n + 1, 0);
            h.rerender = bump;
            h.pinAsked.push({ input, options });
            return { data: h.pinOptions, error: h.pinError, refetch: h.refetch };
          },
        },
      },
    },
  };
});

// The form is tested on its own (components/login/PinSignIn.test.tsx); nothing here signs in.
vi.mock('../api/pinLogin', () => ({ signInWithPin: vi.fn(async () => ({ ok: false, error: 'PIN_DISABLED' })) }));

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Login />
    </MemoryRouter>,
  );
}

const chip = () => screen.queryByRole('button', { name: 'Sign in with a PIN' });
const AUTO_NOTE = "Google sign-in isn't letting students in right now. Use your PIN.";

describe('Login: Sign in with a PIN', () => {
  beforeEach(() => {
    h.pinOptions = undefined;
    h.pinError = null;
    h.pinAsked = [];
    h.refetch.mockClear();
    h.loginWithGoogle.mockClear();
  });

  it('asks the server often whether to offer it', () => {
    renderLogin();
    expect(h.pinAsked[0]).toEqual({
      input: undefined,
      options: { staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false },
    });
  });

  it.each([
    ['{pin:false}', { pin: false, reason: null }],
    ['null', null],
    ['nothing yet', undefined],
  ] as [string, PinOptions][])('shows no chip for %s', (_name, options) => {
    h.pinOptions = options;
    renderLogin();
    expect(chip()).not.toBeInTheDocument();
    expect(screen.queryByText(AUTO_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  it('shows no chip when the question failed', () => {
    h.pinError = new Error('offline');
    renderLogin();
    expect(chip()).not.toBeInTheDocument();
  });

  it('shows the chip and the note while Google refuses students (auto)', () => {
    h.pinOptions = { pin: true, reason: 'auto' };
    renderLogin();
    expect(chip()).toBeVisible();
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent(AUTO_NOTE);
  });

  it('shows the chip without the note when the teacher switched it on', () => {
    h.pinOptions = { pin: true, reason: 'on' };
    renderLogin();
    expect(chip()).toBeVisible();
    expect(screen.queryByText(AUTO_NOTE)).not.toBeInTheDocument();
  });

  it('keeps the Google button as it was, above the chip', async () => {
    h.pinOptions = { pin: true, reason: 'on' };
    const user = userEvent.setup();
    renderLogin('/login?returnTo=%2Fsignups%3Fsheet%3D3');
    const google = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(google.compareDocumentPosition(chip()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(google);
    expect(h.loginWithGoogle).toHaveBeenCalledWith('/signups?sheet=3');
  });

  it('keeps an opened form when the offer ends (the server still takes PINs a while)', async () => {
    h.pinOptions = { pin: true, reason: 'auto' };
    const user = userEvent.setup();
    renderLogin();
    await user.click(chip()!);
    await user.type(screen.getByLabelText('Student number or school email'), '123456');

    h.pinOptions = { pin: false, reason: null };
    act(() => h.rerender?.());
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Student number or school email')).toHaveValue('123456');
    expect(screen.queryByText(AUTO_NOTE)).not.toBeInTheDocument();

    // Closed, the chip goes with the offer.
    await user.click(chip()!);
    expect(chip()).not.toBeInTheDocument();
  });

  it('asks again when the server says PIN sign-in is off', async () => {
    h.pinOptions = { pin: true, reason: 'auto' };
    const user = userEvent.setup();
    renderLogin();
    await user.click(chip()!);
    await user.type(screen.getByLabelText('Student number or school email'), '123456');
    await user.type(screen.getByLabelText('PIN'), '5927');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN sign-in is not available right now.');
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('asks again when Back restores the page from the cache (from Google’s error page)', () => {
    renderLogin();
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => { window.dispatchEvent(restored); });
    expect(h.refetch).toHaveBeenCalledTimes(1);

    // A first load is not a restore: the query asks by itself.
    const loaded = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(loaded, 'persisted', { value: false });
    act(() => { window.dispatchEvent(loaded); });
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Login: logo', () => {
  it('shows the logo above the heading, as decoration (the heading says the name)', () => {
    const { container } = renderLogin();
    const logo = container.querySelector(`img[src="${LOGO_SRC}"]`);
    const heading = screen.getByRole('heading', { level: 1, name: 'libreSRS' });
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', '');
    expect(logo!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Login: copyright line', () => {
  it('names the business, Lava Goat Software, and not the corporation', () => {
    renderLogin();
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Lava Goat Software$`))).toBeInTheDocument();
    expect(screen.queryByText(/Storm, Inc\./)).toBeNull();
  });
});

describe('Login: the privacy line (students are not parties to the Terms)', () => {
  it('says the school set the site up and links the summary, the policy and the rules, with no "you agree"', () => {
    h.pinOptions = { pin: false, reason: null };
    renderLogin();
    expect(screen.getByText('Your school set up this site for your class. Read how we handle your information:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy summary' })).toHaveAttribute('href', '/privacy/summary');
    expect(screen.getByRole('link', { name: 'Full privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Rules for using the site' })).toHaveAttribute('href', '/terms#aup');
    expect(screen.queryByText(/agree/i)).toBeNull();
  });
});
