// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { downloadCsv } from '../../utils/downloadCsv';
import { pinsCsv, pinsTsv } from '../../utils/pinsCsv';

export interface GroupPinsButtonProps {
  groupId: number;
  groupName: string;
}

const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const th = 'px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider';
const td = 'px-3 py-2 text-sm text-gray-800 dark:text-gray-200 whitespace-nowrap';

/**
 * "Make PINs…" on a group's admin view (v1.22.0): PINs for "Sign in with a PIN" for every
 * student in the group who has none (or, ticked, new PINs for all of them). The list is shown
 * once, in this dialog only, to download as a CSV or copy into a Google Sheet: the server keeps
 * only hashes, and closing the dialog forgets the PINs.
 */
export default function GroupPinsButton({ groupId, groupName }: GroupPinsButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [replace, setReplace] = useState(false);
  // Downloaded or copied: closing then needs no question.
  const [kept, setKept] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const status = trpc.pins.groupStatus.useQuery({ groupId }, { enabled: open });
  const make = trpc.pins.createForGroup.useMutation({
    onSuccess: () => { void status.refetch(); },
  });
  const result = make.data;
  const unsaved = !!result && result.pins.length > 0 && !kept;

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const start = () => {
    make.reset();
    setReplace(false);
    setKept(false);
    setCopy('idle');
    setOpen(true);
  };

  const close = () => {
    // Not while PINs are being made: they would be made, and never shown.
    if (make.isPending) return;
    if (unsaved && !window.confirm(t('Close? These PINs will not be shown again.'))) return;
    make.reset();
    setOpen(false);
    setReplace(false);
    setKept(false);
    setCopy('idle');
    openerRef.current?.focus();
  };

  const toggleReplace = (checked: boolean) => {
    if (checked && !window.confirm(t('Replace the PINs students already have? Their old PINs stop working.'))) return;
    setReplace(checked);
  };

  const download = () => {
    if (!result) return;
    const slug = groupName.replace(/[^\w.-]+/g, '_');
    downloadCsv(pinsCsv(result.pins), `${slug}-pins.csv`);
    setKept(true);
  };

  const copyRows = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(pinsTsv(result.pins));
      setCopy('copied');
      setKept(true);
    } catch {
      setCopy('failed');
    }
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={start}
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
      >
        {t('Make PINs…')}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-pins-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/30 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto focus:outline-none space-y-4"
          >
            <h2 id="group-pins-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('Make PINs for {{name}}', { name: groupName })}
            </h2>

            {status.data && (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t('{{withPin}} of {{students}} students have a PIN.', { withPin: status.data.withPin, students: status.data.students })}
              </p>
            )}

            {!result && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">{t('Students without a PIN get one.')}</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => toggleReplace(e.target.checked)}
                    disabled={make.isPending}
                    className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('Also replace the PINs students already have (their old PINs stop working)')}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => make.mutate({ groupId, onlyMissing: !replace })}
                  disabled={make.isPending}
                  className={primary}
                >
                  {make.isPending ? t('Making PINs...') : t('Make PINs')}
                </button>
              </div>
            )}

            {make.isError && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('Could not make PINs. Try again.')}</p>
            )}

            {result && (
              <div className="space-y-3">
                {result.pins.length === 0 ? (
                  <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
                    {t('Nobody needed a PIN: every student in this group has one.')}
                  </p>
                ) : (
                  <>
                    <p role="status" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t(result.pins.length === 1
                        ? 'Made 1 PIN. This is the only time it is shown: download or copy it now.'
                        : 'Made {{count}} PINs. This is the only time they are shown: download or copy them now.', { count: result.pins.length })}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={download} className={secondary}>{t('Download CSV')}</button>
                      <button type="button" onClick={() => { void copyRows(); }} className={secondary}>{t('Copy for Google Sheets')}</button>
                      <span role="status" className="text-sm text-gray-700 dark:text-gray-300">
                        {copy === 'copied' ? t('Copied!') : copy === 'failed' ? t('Could not copy. Use “Download CSV” instead.') : ''}
                      </span>
                    </div>
                    <div tabIndex={0} className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                          <tr>
                            <th scope="col" className={th}>{t('Name')}</th>
                            <th scope="col" className={th}>{t('Email')}</th>
                            <th scope="col" className={th}>{t('School ID')}</th>
                            <th scope="col" className={th}>{t('PIN')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {result.pins.map((row) => (
                            <tr key={row.userId}>
                              <th scope="row" className={`${td} text-left font-medium`}>{row.name}</th>
                              <td className={td}>{row.email}</td>
                              <td className={td}>{row.studentNumber ?? '—'}</td>
                              <td className={`${td} font-mono tracking-widest`}>{row.pin}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {result.skippedHavePin > 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t(result.skippedHavePin === 1
                      ? 'Skipped 1 student who already has a PIN.'
                      : 'Skipped {{count}} students who already have a PIN.', { count: result.skippedHavePin })}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={close} disabled={make.isPending} className={secondary}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
