// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PinLoginSettings, { timeOfDay } from './PinLoginSettings';
import { I18nProvider } from '../../i18n';
import { LOCALE_STORAGE_KEY } from '../../i18n/messages';

type Settings = {
  mode: 'auto' | 'on' | 'off';
  showing: boolean;
  autoNetworkConfigured: boolean;
  google: {
    looksBlocked: boolean;
    since: number | null;
    reason: 'no_returns' | 'google_error' | null;
    unansweredBrowsers: number;
    lastStudentSignInAt: number | null;
    watchingSince: number;
  };
};

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  queryOptions: undefined as unknown,
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  variables: undefined as { mode: string } | undefined,
  onSuccess: undefined as undefined | ((next: unknown) => void),
  setData: vi.fn(),
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ pins: { settings: { setData: h.setData } } }),
    pins: {
      settings: {
        useQuery: (_input: unknown, options: unknown) => {
          h.queryOptions = options;
          return { data: h.data };
        },
      },
      setMode: {
        useMutation: (options: { onSuccess?: (next: unknown) => void }) => {
          h.onSuccess = options.onSuccess;
          return { mutate: h.mutate, isPending: h.isPending, isError: h.isError, variables: h.variables };
        },
      },
    },
  },
}));

/** Today at a given time, in this machine's zone (the page shows local times). */
const today = (hours: number, minutes = 0) => {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
};

function settings(overrides: Partial<Settings> = {}, google: Partial<Settings['google']> = {}): Settings {
  return {
    mode: 'auto',
    showing: false,
    autoNetworkConfigured: true,
    ...overrides,
    google: {
      looksBlocked: false,
      since: null,
      reason: null,
      unansweredBrowsers: 0,
      lastStudentSignInAt: null,
      watchingSince: today(7, 30),
      ...google,
    },
  };
}

describe('PinLoginSettings', () => {
  beforeEach(() => {
    h.data = settings();
    h.mutate.mockReset();
    h.setData.mockReset();
    h.isPending = false;
    h.isError = false;
    h.variables = undefined;
    window.localStorage.clear();
  });

  it('shows the mode, and saves a new one at once', async () => {
    h.data = settings({ mode: 'auto' });
    const user = userEvent.setup();
    render(<PinLoginSettings />);
    expect(screen.getByRole('heading', { name: 'Sign in with a PIN' })).toBeInTheDocument();
    expect(h.queryOptions).toEqual({ refetchInterval: 30_000 });
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'On' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Off' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAccessibleDescription('Shows “Sign in with a PIN” only while Google sign-in looks blocked for students.');

    await user.click(screen.getByRole('radio', { name: 'On' }));
    expect(h.mutate).toHaveBeenCalledWith({ mode: 'on' });

    // The answer is the new settings: the card shows them without asking again.
    const next = settings({ mode: 'on', showing: true });
    h.onSuccess?.(next);
    expect(h.setData).toHaveBeenCalledWith(undefined, next);
  });

  it('shows the mode being saved, with the radios off until it is', () => {
    h.data = settings({ mode: 'auto' });
    h.isPending = true;
    h.variables = { mode: 'off' };
    render(<PinLoginSettings />);
    expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked();
    for (const name of ['Auto', 'On', 'Off']) expect(screen.getByRole('radio', { name })).toBeDisabled();
  });

  it('says when it could not save', () => {
    h.isError = true;
    render(<PinLoginSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });

  it('says since when Google sign-in looks blocked for students', () => {
    const since = today(12, 0);
    h.data = settings({ mode: 'auto', showing: true }, { looksBlocked: true, since, reason: 'no_returns', unansweredBrowsers: 8 });
    render(<PinLoginSettings />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(`Google sign-in looks blocked for students since ${timeOfDay(since, 'en')}.`);
    expect(status).toHaveTextContent(/since 12:00/);
    expect(screen.getByText('Students see “Sign in with a PIN” on the login page now.')).toBeInTheDocument();
    expect(screen.getByText("Browsers on the school's network that started Google sign-in in the last 15 minutes and did not come back: 8.")).toBeInTheDocument();
    expect(screen.getByText(`No student has signed in with Google since the server started at ${timeOfDay(today(7, 30), 'en')}.`)).toBeInTheDocument();
    // Auto is not safer than On while it shows the chip, and says so.
    expect(screen.getByText("Auto counts only Google sign-ins from the school's network. While “Sign in with a PIN” shows, anyone can try PINs, as with “On”: five wrong PINs lock an account.")).toBeInTheDocument();
    expect(screen.getByText('The server forgets this when it restarts: during a known outage, choose “On”.')).toBeInTheDocument();
  });

  it('says Google sign-in is working otherwise, with the last student sign-in', () => {
    const last = today(9, 41);
    h.data = settings({ mode: 'off', showing: false }, { lastStudentSignInAt: last });
    render(<PinLoginSettings />);
    expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Google sign-in is working.');
    expect(screen.getByText("Students don't see “Sign in with a PIN” now.")).toBeInTheDocument();
    expect(screen.getByText(`Last student Google sign-in: ${timeOfDay(last, 'en')}.`)).toBeInTheDocument();
  });

  it('in Auto, says when the server has no school network set (and only then)', () => {
    const hint = "Auto can't switch on yet: the server has no school network set (PIN_AUTO_SCHOOL_IPS), so it sees no browser as at school. Until it is set, choose “On” during an outage.";
    h.data = settings({ mode: 'auto', autoNetworkConfigured: false });
    const view = render(<PinLoginSettings />);
    expect(screen.getByText(hint)).toBeInTheDocument();
    view.unmount();

    // Configured, or another mode: no hint.
    for (const data of [settings({ mode: 'auto' }), settings({ mode: 'on', autoNetworkConfigured: false }), settings({ mode: 'off', autoNetworkConfigured: false })]) {
      h.data = data;
      const other = render(<PinLoginSettings />);
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
      other.unmount();
    }

    // While "Auto" is being saved, the hint follows the mode being saved.
    h.data = settings({ mode: 'off', autoNetworkConfigured: false });
    h.isPending = true;
    h.variables = { mode: 'auto' };
    render(<PinLoginSettings />);
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('says it in Spanish, quoting “On” by its Spanish', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    h.data = settings({ mode: 'auto', autoNetworkConfigured: false });
    render(<I18nProvider><PinLoginSettings /></I18nProvider>);
    expect(screen.getByText('Automático aún no puede activarse: el servidor no tiene configurada la red de la escuela (PIN_AUTO_SCHOOL_IPS), así que no ve ningún navegador como de la escuela. Hasta entonces, si Google está fallando, elige “Activado”.')).toBeInTheDocument();
  });

  it('renders with nothing loaded (or null): the radios off, no status', () => {
    for (const data of [undefined, null]) {
      h.data = data;
      const view = render(<PinLoginSettings />);
      for (const name of ['Auto', 'On', 'Off']) {
        expect(screen.getByRole('radio', { name })).toBeDisabled();
        expect(screen.getByRole('radio', { name })).not.toBeChecked();
      }
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('puts the date in front of a time that is not today', () => {
    const now = new Date(2026, 9, 9, 12, 0).getTime(); // local noon
    expect(timeOfDay(now - 60_000, 'en', now)).not.toContain('/');
    const yesterday = now - 24 * 60 * 60_000;
    expect(timeOfDay(yesterday, 'en', now)).toBe(`${new Date(yesterday).toLocaleDateString('en')} ${new Date(yesterday).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}`);
  });

  it('reads in Spanish, quoting the chip and “On” by their Spanish', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    const since = today(12, 0);
    h.data = settings({ mode: 'on', showing: true }, { looksBlocked: true, since, reason: 'google_error', unansweredBrowsers: 1 });
    render(<I18nProvider><PinLoginSettings /></I18nProvider>);
    const card = screen.getByRole('region', { name: 'Entrar con un PIN' });
    expect(within(card).getByRole('radio', { name: 'Activado' })).toBeChecked();
    expect(within(card).getByRole('radio', { name: 'Automático' })).not.toBeChecked();
    // The time stands alone: no "desde 12:00" (desde las), "a las 1:05" (a la) or "a las 8/10/2026 7:30".
    expect(within(card).getByRole('status')).toHaveTextContent(`Parece que Google bloquea a los estudiantes (desde: ${timeOfDay(since, 'es')}).`);
    expect(within(card).getByText('Navegadores de la red de la escuela que empezaron a entrar con Google en los últimos 15 minutos y no volvieron: 1.')).toBeInTheDocument();
    expect(within(card).getByText(`Ningún estudiante ha entrado con Google desde que arrancó el servidor (${timeOfDay(today(7, 30), 'es')}).`)).toBeInTheDocument();
    expect(within(card).getByText('Automático solo cuenta los inicios de sesión con Google desde la red de la escuela. Mientras se muestra “Entrar con un PIN”, cualquiera puede probar PIN, igual que con “Activado”: cinco PIN incorrectos bloquean una cuenta.')).toBeInTheDocument();
    expect(within(card).getByText('El servidor lo olvida al reiniciarse: si sabes que Google está fallando, elige “Activado”.')).toBeInTheDocument();
  });

  it('names the last student Google sign-in as a time, in Spanish', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    const last = today(9, 41);
    h.data = settings({ mode: 'auto' }, { lastStudentSignInAt: last });
    render(<I18nProvider><PinLoginSettings /></I18nProvider>);
    expect(screen.getByText(`Último inicio de sesión de un estudiante con Google: ${timeOfDay(last, 'es')}.`)).toBeInTheDocument();
  });
});
