// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n';
import { signInWithPin, type PinLoginResult } from '../../api/pinLogin';
import { safeReturnTo } from '../../utils/returnTo';

export interface PinSignInProps {
  /** The login page's validated ?returnTo, handed to the server (which checks it again). */
  returnTo: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server said PIN sign-in is off right now: the login page asks again whether to offer it. */
  onUnavailable?: () => void;
}

/** What went wrong, kept as a kind (not a text), so switching the language re-reads it. */
type Problem =
  | { kind: 'no-username' }
  | { kind: 'short-pin' }
  | { kind: 'invalid' }
  | { kind: 'use-full-email' }
  | { kind: 'locked'; minutes: number }
  | { kind: 'too-many' }
  | { kind: 'disabled' }
  | { kind: 'failed' };

/** The shortest lock (15 minutes): what "locked" says if the server ever leaves the minutes out. */
const FALLBACK_LOCK_MINUTES = 15;

function problemFor(result: Exclude<PinLoginResult, { ok: true }>): Problem {
  switch (result.error) {
    case 'INVALID':
    case 'BAD_REQUEST':
      return { kind: 'invalid' };
    case 'USE_FULL_EMAIL':
      return { kind: 'use-full-email' };
    case 'LOCKED':
      return { kind: 'locked', minutes: Math.max(1, result.retryAfterMinutes ?? FALLBACK_LOCK_MINUTES) };
    case 'TOO_MANY_ATTEMPTS':
      return { kind: 'too-many' };
    case 'PIN_DISABLED':
      return { kind: 'disabled' };
    default:
      return { kind: 'failed' };
  }
}

/**
 * "Sign in with a PIN" on the login page (v1.22.0), under the Google button: a chip that opens
 * a small form for a student number (or school email) and a 4-digit PIN. The login page shows it
 * while the server offers PIN sign-in (Admin > Access: Auto, On or Off), and keeps it once opened.
 * Every wrong answer reads the same, so the form never tells whether an account exists; only a
 * lock (five wrong PINs) says so, with the minutes to wait.
 */
export default function PinSignIn({ returnTo, open, onOpenChange, onUnavailable }: PinSignInProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  // Counts answers: the alert is drawn anew for each, so a second "wrong PIN" is announced again.
  const [answers, setAnswers] = useState(0);
  const [pending, setPending] = useState(false);
  // Set once the server let the student in: the button stays off while the next page loads.
  const [leaving, setLeaving] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(open);
  // A second Enter before the first answer: one request, not two.
  const inFlight = useRef(false);

  // Opening the form puts the cursor in its first field.
  useEffect(() => {
    if (open && !wasOpen.current) usernameRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || leaving) return;
    if (!username.trim()) {
      setProblem({ kind: 'no-username' });
      setAnswers((n) => n + 1);
      usernameRef.current?.focus();
      return;
    }
    if (pin.length !== 4) {
      setProblem({ kind: 'short-pin' });
      setAnswers((n) => n + 1);
      pinRef.current?.focus();
      return;
    }
    setProblem(null);
    setPending(true);
    inFlight.current = true;
    const result = await signInWithPin({ username, pin, returnTo });
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      setLeaving(true);
      window.location.assign(safeReturnTo(result.redirectTo) ?? '/');
      return;
    }
    const next = problemFor(result);
    setProblem(next);
    setAnswers((n) => n + 1);
    if (next.kind === 'invalid') {
      setPin('');
      pinRef.current?.focus();
    } else if (next.kind === 'use-full-email') {
      usernameRef.current?.focus();
    } else if (next.kind === 'disabled') {
      onUnavailable?.();
    }
  };

  const message = (() => {
    switch (problem?.kind) {
      case 'no-username': return t('Type your student number or school email.');
      case 'short-pin': return t('Your PIN has 4 digits.');
      case 'invalid': return t('Wrong student number, email or PIN.');
      case 'use-full-email': return t('More than one account uses that number. Type your full school email.');
      case 'locked':
        return t(problem.minutes === 1 ? 'Too many wrong PINs. Try again in 1 minute.' : 'Too many wrong PINs. Try again in {{minutes}} minutes.', { minutes: problem.minutes });
      case 'too-many': return t('Too many tries from this network. Wait a few minutes, then try again.');
      case 'disabled': return t('PIN sign-in is not available right now. Try Google, or ask your teacher.');
      case 'failed': return t('Could not sign in. Try again.');
      default: return null;
    }
  })();
  const usernameWrong = problem?.kind === 'no-username' || problem?.kind === 'use-full-email';
  const pinWrong = problem?.kind === 'short-pin' || problem?.kind === 'invalid';
  const busy = pending || leaving;
  const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className="mt-4">
      <div className="flex justify-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="pin-sign-in-form"
          onClick={() => onOpenChange(!open)}
          className="inline-flex items-center gap-2 rounded-full border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          {t('Sign in with a PIN')}
        </button>
      </div>

      <form id="pin-sign-in-form" noValidate hidden={!open} onSubmit={(e) => { void submit(e); }} className="mt-4 space-y-3 text-left">
        <div>
          <label htmlFor="pin-username" className={label}>{t('Student number or school email')}</label>
          <input
            ref={usernameRef}
            id="pin-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={usernameWrong || undefined}
            aria-describedby={usernameWrong ? 'pin-sign-in-problem' : undefined}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="pin-code" className={label}>{t('PIN')}</label>
          <input
            ref={pinRef}
            id="pin-code"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-invalid={pinWrong || undefined}
            aria-describedby={pinWrong ? 'pin-sign-in-hint pin-sign-in-problem' : 'pin-sign-in-hint'}
            className={`${field} font-mono tracking-widest`}
          />
          <p id="pin-sign-in-hint" className="mt-1 text-xs text-gray-600 dark:text-gray-400">{t("Don't know your PIN? Ask your teacher.")}</p>
        </div>
        {message && (
          <p key={answers} id="pin-sign-in-problem" role="alert" className="text-sm text-red-700 dark:text-red-400">{message}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? t('Signing in...') : t('Sign in')}
        </button>
      </form>
    </div>
  );
}
