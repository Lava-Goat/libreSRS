// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';

/** pins.settings' mode: who sees "Sign in with a PIN" on the login page. */
type PinLoginMode = 'auto' | 'on' | 'off';

const MODES: PinLoginMode[] = ['auto', 'on', 'off'];

/** A time of day ("12:05 PM"), with the date in front when it is not today. */
export function timeOfDay(ms: number, locale: string, now: number = Date.now()): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return at.toDateString() === new Date(now).toDateString() ? time : `${at.toLocaleDateString(locale)} ${time}`;
}

/**
 * Admin > Access: "Sign in with a PIN" (v1.22.0). Auto offers it on the login page only while
 * Google sign-in looks blocked for students (the server watches Google sign-ins from the school's
 * network start and not come back), On always, Off never. The status line is the server's live view
 * of Google sign-in, which it keeps in memory: a restart forgets it, so during a known outage the
 * teacher picks On. In Auto, a hint says when the server has no school network set (production
 * without PIN_AUTO_SCHOOL_IPS), since Auto can then never switch on.
 */
export default function PinLoginSettings() {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const settings = trpc.pins.settings.useQuery(undefined, { refetchInterval: 30_000 });
  const setMode = trpc.pins.setMode.useMutation({
    onSuccess: (next) => {
      utils.pins.settings.setData(undefined, next);
    },
  });
  const data = settings.data ?? null;
  const mode = setMode.isPending ? setMode.variables?.mode ?? data?.mode : data?.mode;

  const describe: Record<PinLoginMode, { label: string; description: string }> = {
    auto: { label: t('Auto'), description: t('Shows “Sign in with a PIN” only while Google sign-in looks blocked for students.') },
    on: { label: t('On'), description: t('Always shows “Sign in with a PIN”.') },
    off: { label: t('Off'), description: t('Never shows it, and PIN sign-ins are refused.') },
  };

  const google = data?.google;
  return (
    <section aria-labelledby="pin-login-title" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <h2 id="pin-login-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('Sign in with a PIN')}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t("Students type their student number (or school email) and a 4-digit PIN. Make PINs on a group's page or a student's page.")}
      </p>

      <fieldset className="space-y-2">
        <legend className="sr-only">{t('Sign in with a PIN')}</legend>
        {MODES.map((value) => (
          <div key={value} className="flex items-start gap-2">
            <input
              id={`pin-login-mode-${value}`}
              type="radio"
              name="pin-login-mode"
              value={value}
              checked={mode === value}
              disabled={!data || setMode.isPending}
              onChange={() => setMode.mutate({ mode: value })}
              aria-describedby={`pin-login-mode-${value}-description`}
              className="mt-1 border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <label htmlFor={`pin-login-mode-${value}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
                {describe[value].label}
              </label>
              <p id={`pin-login-mode-${value}-description`} className="text-xs text-gray-600 dark:text-gray-400">
                {describe[value].description}
              </p>
            </div>
          </div>
        ))}
      </fieldset>

      {mode === 'auto' && data?.autoNetworkConfigured === false && (
        <p className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-900 dark:text-amber-200">
          {t("Auto can't switch on yet: the server has no school network set (PIN_AUTO_SCHOOL_IPS), so it sees no browser as at school. Until it is set, choose “On” during an outage.")}
        </p>
      )}

      {setMode.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{t('Could not save. Try again.')}</p>
      )}

      {google && (
        <div className="mt-4 space-y-2">
          <p
            role="status"
            className={`rounded-lg border p-3 text-sm font-medium ${google.looksBlocked
              ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'}`}
          >
            {google.looksBlocked
              ? t('Google sign-in looks blocked for students since {{time}}.', { time: timeOfDay(google.since ?? google.watchingSince, locale) })
              : t('Google sign-in is working.')}
          </p>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <li>{data?.showing ? t('Students see “Sign in with a PIN” on the login page now.') : t("Students don't see “Sign in with a PIN” now.")}</li>
            <li>{t("Browsers on the school's network that started Google sign-in in the last 15 minutes and did not come back: {{count}}.", { count: google.unansweredBrowsers })}</li>
            <li>
              {google.lastStudentSignInAt !== null
                ? t('Last student Google sign-in: {{time}}.', { time: timeOfDay(google.lastStudentSignInAt, locale) })
                : t('No student has signed in with Google since the server started at {{time}}.', { time: timeOfDay(google.watchingSince, locale) })}
            </li>
            <li>{t("Auto counts only Google sign-ins from the school's network. While “Sign in with a PIN” shows, anyone can try PINs, as with “On”: five wrong PINs lock an account.")}</li>
            <li>{t('The server forgets this when it restarts: during a known outage, choose “On”.')}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
