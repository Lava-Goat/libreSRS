// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PinSignIn from './PinSignIn';
import { I18nProvider } from '../../i18n';
import { LOCALE_STORAGE_KEY } from '../../i18n/messages';
import type { PinLoginResult, PinSignInInput } from '../../api/pinLogin';

const h = vi.hoisted(() => ({
  calls: [] as PinSignInInput[],
  answers: [] as PinLoginResult[],
}));

vi.mock('../../api/pinLogin', () => ({
  signInWithPin: vi.fn(async (input: PinSignInInput) => {
    h.calls.push(input);
    return h.answers.shift() ?? { ok: false, error: 'SERVER_ERROR' };
  }),
}));

/** Test PINs (never real ones). */
const PIN = '5927';

/** The login page's part: it owns "opened", and asks again when told PIN sign-in is off. */
function Harness({ returnTo = null, onUnavailable }: { returnTo?: string | null; onUnavailable?: () => void }) {
  const [open, setOpen] = useState(false);
  return <PinSignIn returnTo={returnTo} open={open} onOpenChange={setOpen} onUnavailable={onUnavailable} />;
}

const chip = () => screen.getByRole('button', { name: 'Sign in with a PIN' });
// A string name matches the whole name: not "Sign in with a PIN".
const submitButton = () => screen.getByRole('button', { name: 'Sign in' });
const usernameField = () => screen.getByLabelText('Student number or school email');
const pinField = () => screen.getByLabelText('PIN');

async function openAndFill(user: ReturnType<typeof userEvent.setup>, username: string, pin: string) {
  await user.click(chip());
  if (username) await user.type(usernameField(), username);
  if (pin) await user.type(pinField(), pin);
}

describe('PinSignIn', () => {
  const assign = vi.fn();

  beforeEach(() => {
    h.calls = [];
    h.answers = [];
    assign.mockReset();
    vi.stubGlobal('location', { assign, pathname: '/login', search: '', hash: '', href: 'http://localhost/login' });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the form from the chip, with the cursor in the first field, and closes it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    expect(chip()).toHaveAttribute('aria-controls', 'pin-sign-in-form');
    // In the page (aria-controls names it), but hidden.
    expect(document.getElementById('pin-sign-in-form')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    await user.click(chip());
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    expect(usernameField()).toHaveFocus();
    expect(document.getElementById('pin-sign-in-form')).toBeVisible();
    expect(screen.getByText("Don't know your PIN? Ask your teacher.")).toBeInTheDocument();

    await user.click(chip());
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('pin-sign-in-form')).not.toBeVisible();
  });

  it('gives the fields what a phone and a password manager need', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip());
    expect(usernameField()).toHaveAttribute('autocomplete', 'username');
    expect(usernameField()).toHaveAttribute('autocapitalize', 'none');
    expect(usernameField()).toHaveAttribute('maxlength', '200');
    expect(pinField()).toHaveAttribute('type', 'password');
    expect(pinField()).toHaveAttribute('inputmode', 'numeric');
    expect(pinField()).toHaveAttribute('pattern', '[0-9]*');
    expect(pinField()).toHaveAttribute('autocomplete', 'off');
    expect(pinField()).toHaveAttribute('maxlength', '4');
  });

  it('keeps only digits in the PIN, four at most', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip());
    await user.type(pinField(), '5a9-2 7 3');
    expect(pinField()).toHaveValue(PIN);
  });

  it('checks the fields before asking the server', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip());

    await user.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Type your student number or school email.');
    expect(usernameField()).toHaveFocus();

    await user.type(usernameField(), '123456');
    await user.type(pinField(), '59');
    await user.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Your PIN has 4 digits.');
    expect(pinField()).toHaveFocus();
    expect(h.calls).toEqual([]);
  });

  it('signs in and opens the page the server names', async () => {
    h.answers.push({ ok: true, redirectTo: '/signups?sheet=3' });
    const user = userEvent.setup();
    render(<Harness returnTo="/signups?sheet=3" />);
    await openAndFill(user, ' 123456 ', PIN);
    await user.keyboard('{Enter}');

    expect(h.calls).toEqual([{ username: ' 123456 ', pin: PIN, returnTo: '/signups?sheet=3' }]);
    expect(assign).toHaveBeenCalledWith('/signups?sheet=3');
    // Off while the next page loads: no second sign-in.
    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  });

  it('sends one request for a double Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    // The first answer has not come back when the second Enter lands.
    h.answers.push({ ok: false, error: 'INVALID' });
    await Promise.all([user.keyboard('{Enter}'), user.keyboard('{Enter}')]);
    expect(h.calls).toHaveLength(1);
  });

  it.each(['//evil.example', 'https://evil.example/', '/login'])('opens the home page instead of an unsafe redirectTo (%s)', async (redirectTo) => {
    h.answers.push({ ok: true, redirectTo });
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    await user.click(submitButton());
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('says the same thing for every wrong answer, and clears the PIN', async () => {
    h.answers.push({ ok: false, error: 'INVALID' }, { ok: false, error: 'BAD_REQUEST' });
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    await user.click(submitButton());

    expect(screen.getByRole('alert')).toHaveTextContent('Wrong student number, email or PIN.');
    expect(pinField()).toHaveValue('');
    expect(pinField()).toHaveFocus();
    expect(pinField()).toHaveAttribute('aria-invalid', 'true');
    expect(usernameField()).toHaveValue('123456');

    await user.type(pinField(), '6184');
    await user.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong student number, email or PIN.');
    expect(assign).not.toHaveBeenCalled();
  });

  it('draws the alert anew for each answer, so a screen reader reads a second wrong PIN too', async () => {
    h.answers.push({ ok: false, error: 'INVALID' }, { ok: false, error: 'INVALID' });
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    await user.click(submitButton());
    const first = screen.getByRole('alert');
    expect(first).toHaveTextContent('Wrong student number, email or PIN.');

    await user.type(pinField(), '6184');
    await user.click(submitButton());
    const second = screen.getByRole('alert');
    expect(second).toHaveTextContent('Wrong student number, email or PIN.');
    expect(second).not.toBe(first);
    expect(first).not.toBeInTheDocument();
  });

  it('draws the alert anew for the same check failing twice in a row (nothing clears it in between)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip());
    await user.click(submitButton());
    const first = screen.getByRole('alert');
    expect(first).toHaveTextContent('Type your student number or school email.');
    await user.click(submitButton());
    const second = screen.getByRole('alert');
    expect(second).toHaveTextContent('Type your student number or school email.');
    expect(second).not.toBe(first);
    expect(first).not.toBeInTheDocument();
  });

  it('ties the hint, and then the problem, to the field they are about', async () => {
    h.answers.push({ ok: false, error: 'INVALID' }, { ok: false, error: 'USE_FULL_EMAIL' });
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    expect(pinField()).toHaveAccessibleDescription("Don't know your PIN? Ask your teacher.");
    expect(usernameField()).not.toHaveAccessibleDescription();

    await user.click(submitButton());
    expect(pinField()).toHaveAccessibleDescription("Don't know your PIN? Ask your teacher. Wrong student number, email or PIN.");
    expect(usernameField()).not.toHaveAccessibleDescription();

    // A shared number: the problem is the username's, and the cursor goes back there.
    await user.type(pinField(), PIN);
    await user.click(submitButton());
    expect(usernameField()).toHaveFocus();
    expect(usernameField()).toHaveAttribute('aria-invalid', 'true');
    expect(usernameField()).toHaveAccessibleDescription('More than one account uses that number. Type your full school email.');
    expect(pinField()).toHaveAccessibleDescription("Don't know your PIN? Ask your teacher.");
  });

  it.each([
    [{ ok: false, error: 'USE_FULL_EMAIL' }, 'More than one account uses that number. Type your full school email.'],
    [{ ok: false, error: 'LOCKED', retryAfterMinutes: 1 }, 'Too many wrong PINs. Try again in 1 minute.'],
    [{ ok: false, error: 'LOCKED', retryAfterMinutes: 15 }, 'Too many wrong PINs. Try again in 15 minutes.'],
    [{ ok: false, error: 'TOO_MANY_ATTEMPTS' }, 'Too many tries from this network. Wait a few minutes, then try again.'],
    [{ ok: false, error: 'SERVER_ERROR' }, 'Could not sign in. Try again.'],
    [{ ok: false, error: 'CROSS_ORIGIN' }, 'Could not sign in. Try again.'],
    [{ ok: false, error: 'NETWORK' }, 'Could not sign in. Try again.'],
  ] as [PinLoginResult, string][])('tells the student what happened: %o', async (answer, message) => {
    h.answers.push(answer);
    const user = userEvent.setup();
    render(<Harness />);
    await openAndFill(user, '123456', PIN);
    await user.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    // Only a wrong PIN is cleared: a lock or a network error keeps what was typed.
    expect(pinField()).toHaveValue(PIN);
  });

  it('asks the login page to look again when PIN sign-in is off', async () => {
    h.answers.push({ ok: false, error: 'PIN_DISABLED' });
    const onUnavailable = vi.fn();
    const user = userEvent.setup();
    render(<Harness onUnavailable={onUnavailable} />);
    await openAndFill(user, '123456', PIN);
    await user.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('PIN sign-in is not available right now. Try Google, or ask your teacher.');
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('reads in Spanish', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    h.answers.push({ ok: false, error: 'LOCKED', retryAfterMinutes: 30 });
    const user = userEvent.setup();
    render(<I18nProvider><Harness /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Entrar con un PIN' }));
    await user.type(screen.getByLabelText('Número de estudiante o correo escolar'), '123456');
    await user.type(screen.getByLabelText('PIN'), PIN);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Demasiados PIN incorrectos. Inténtalo de nuevo en 30 minutos.');
  });
});
