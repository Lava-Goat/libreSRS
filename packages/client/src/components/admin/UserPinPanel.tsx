// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState, type ReactNode } from 'react';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { timeOfDay } from './PinLoginSettings';

export interface UserPinPanelProps {
  userId: number;
  /** The student's name, for the confirmations ("Make a new PIN for Ana?"). */
  name: string;
}

type Translate = ReturnType<typeof useI18n>['t'];

/** Why a PIN action failed, in the teacher's language, by the server's own code (its message is English). */
function pinErrorMessage(err: unknown, t: Translate, fallback: string): string {
  switch ((err as { data?: { appCode?: string } | null } | null)?.data?.appCode) {
    case 'PIN_NOT_FOR_ADMIN':
      return t('Admins sign in with Google only.');
    case 'USER_NOT_FOUND':
      return t('This account no longer exists.');
    default:
      return fallback;
  }
}

const button = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
const dangerButton = 'px-3 py-1.5 rounded-lg text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * A student's page (Admin > Users > a name): their PIN for "Sign in with a PIN" (v1.22.0).
 * Whether one is set and used, a lock after too many wrong PINs (Unlock), a new PIN (shown here
 * once, never again: the server keeps only a hash), and removing it. Admins sign in with Google.
 */
export default function UserPinPanel({ userId, name }: UserPinPanelProps) {
  const { t, formatDate, locale } = useI18n();
  const status = trpc.pins.forUser.useQuery({ userId });
  const refresh = () => { void status.refetch(); };
  const create = trpc.pins.createForUser.useMutation({ onSuccess: refresh });
  const remove = trpc.pins.remove.useMutation({ onSuccess: refresh });
  const unlock = trpc.pins.unlock.useMutation({ onSuccess: refresh });
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const data = status.data;
  const busy = create.isPending || remove.isPending || unlock.isPending;
  // The new PIN, while the teacher has it on screen (only the answer to createForUser holds it).
  const shown = create.data?.userId === userId ? create.data.pin : null;
  const failed = create.error ?? remove.error ?? unlock.error;

  const makePin = () => {
    const question = data?.hasPin
      ? t('Make a new PIN for {{name}}? Their old PIN stops working.', { name })
      : t('Make a PIN for {{name}}?', { name });
    if (!window.confirm(question)) return;
    setCopy('idle');
    create.mutate({ userId });
  };

  const removePin = () => {
    if (!window.confirm(t('Remove the PIN of {{name}}? They can no longer sign in with a PIN.', { name }))) return;
    remove.mutate({ userId });
  };

  const copyPin = async (pin: string) => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  const done = () => {
    create.reset();
    setCopy('idle');
    refresh();
  };

  let body: ReactNode;
  if (status.error) {
    body = (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {pinErrorMessage(status.error, t, t('Could not load the PIN. Try again.'))}
      </p>
    );
  } else if (!data) {
    body = <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{t('Loading...')}</p>;
  } else if (!data.eligible) {
    body = <p className="text-sm text-gray-600 dark:text-gray-400">{t('Admins sign in with Google only.')}</p>;
  } else {
    body = (
      <div className="space-y-3">
        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
          <p>{data.hasPin && data.createdAt !== null ? t('PIN: set on {{date}}', { date: formatDate(data.createdAt) }) : t('PIN: not set')}</p>
          {data.hasPin && (
            <p>{data.lastUsedAt !== null ? t('Last used {{date}}', { date: formatDate(data.lastUsedAt) }) : t('Never used')}</p>
          )}
        </div>

        {data.lockedUntil !== null && (
          <div className="flex flex-wrap items-center gap-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {t('Locked until {{time}} after too many wrong PINs.', { time: timeOfDay(data.lockedUntil, locale) })}
            </p>
            <button type="button" onClick={() => unlock.mutate({ userId })} disabled={busy} className={button}>
              {t('Unlock')}
            </button>
          </div>
        )}

        {shown !== null ? (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('New PIN for {{name}}:', { name })}</p>
            <code className="block text-2xl font-mono tracking-widest text-gray-900 dark:text-gray-100 select-all">{shown}</code>
            <p className="text-sm text-gray-700 dark:text-gray-300">{t('This is the only time it is shown. Copy it now.')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => { void copyPin(shown); }} className={button}>{t('Copy')}</button>
              <button type="button" onClick={done} className={button}>{t('Done')}</button>
              <span role="status" className="text-sm text-gray-700 dark:text-gray-300">
                {copy === 'copied' ? t('Copied!') : copy === 'failed' ? t('Could not copy. Select the PIN and copy it.') : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={makePin} disabled={busy} className={button}>{t('Make a new PIN')}</button>
            {data.hasPin && (
              <button type="button" onClick={removePin} disabled={busy} className={dangerButton}>{t('Remove PIN')}</button>
            )}
          </div>
        )}

        {failed && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{pinErrorMessage(failed, t, t('Could not save. Try again.'))}</p>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="user-detail-pin" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
      <h3 id="user-detail-pin" className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
        {t('PIN sign-in')}
      </h3>
      <div className="px-4 py-3">{body}</div>
    </section>
  );
}
