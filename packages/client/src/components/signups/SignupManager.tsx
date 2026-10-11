// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: sign-up sheets (who presents on which day), who they are for, and a
 * way into each one to see the whole roster and move students around.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { formatDay, parseDayLines } from '../../utils/calendarDate';
import SignupSheetAdmin from './SignupSheetAdmin';
import { studentLink } from './studentLink';

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const hint = 'text-xs text-gray-500 dark:text-gray-400';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';

// The server's limits (routers/signups.ts), checked here first so the teacher
// gets a plain message instead of a validation dump.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_DATES = 400;
const MAX_LABEL = 200;

const browserTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
})();

/** The parts of an adminList row the form edits. */
interface SheetFields {
  id: number;
  title: string;
  description: string | null;
  slotsPerDate: number;
  picksPerStudent: number;
  showNames: boolean;
  open: boolean;
  timeZone: string;
  active: boolean;
  forEveryone: boolean;
  groupIds: number[];
}

interface Draft {
  title: string;
  description: string;
  slotsText: string;
  picksText: string;
  showNames: boolean;
  open: boolean;
  timeZone: string;
  active: boolean;
  groupIds: number[];
  daysText: string;
}

function draftFrom(sheet: SheetFields | undefined): Draft {
  return {
    title: sheet?.title ?? '',
    description: sheet?.description ?? '',
    slotsText: String(sheet?.slotsPerDate ?? 2),
    picksText: String(sheet?.picksPerStudent ?? 1),
    showNames: sheet?.showNames ?? true,
    open: sheet?.open ?? true,
    timeZone: sheet?.timeZone ?? browserTimeZone,
    active: sheet?.active ?? false,
    groupIds: sheet?.groupIds ?? [],
    daysText: '',
  };
}

/** A whole number in [min, max], or undefined. */
function wholeNumber(text: string, min: number, max: number): number | undefined {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function GroupPicker({ groups, selected, onChange, disabled = false }: {
  groups: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('For which groups?')}</legend>
      <p className={`${hint} mb-2`}>{t('None checked means every student who can sign in.')}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {groups.map((g) => (
          <label key={g.id} className="inline-flex items-center gap-1.5 text-sm text-gray-800 dark:text-gray-200">
            <input
              type="checkbox"
              checked={selected.includes(g.id)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...selected, g.id] : selected.filter((id) => id !== g.id))}
            />
            {g.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Creates a sheet with its days, or edits `sheet` (its days are edited on the sheet's own page). */
function SheetForm({ sheet, groups, onDone, onCancel }: {
  sheet?: SheetFields;
  groups: { id: number; name: string }[] | undefined;
  onDone: (id: number) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const createSheet = trpc.signups.create.useMutation();
  const updateSheet = trpc.signups.update.useMutation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(sheet));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  const parsed = parseDayLines(draft.daysText);
  const days = [...parsed.days].sort((a, b) => a.date.localeCompare(b.date));

  const problemWith = (): string | null => {
    if (!draft.title.trim()) return t('Give the sheet a title.');
    if (draft.title.trim().length > MAX_TITLE) return t('The title is too long (at most {{max}} characters).', { max: MAX_TITLE });
    if (draft.description.length > MAX_DESCRIPTION) return t('The description is too long (at most {{max}} characters).', { max: MAX_DESCRIPTION });
    if (wholeNumber(draft.slotsText, 1, 100) === undefined) return t('Students per day must be a whole number from 1 to 100.');
    if (wholeNumber(draft.picksText, 1, 50) === undefined) return t('Days per student must be a whole number from 1 to 50.');
    if (!draft.timeZone.trim()) return t('Enter the school’s time zone, like America/Los_Angeles.');
    if (!sheet) {
      if (parsed.problems.length > 0) {
        return t('Line {{line}} does not start with a date: {{text}}', { line: parsed.problems[0].line, text: parsed.problems[0].text });
      }
      if (days.length > MAX_DATES) return t('A sheet holds at most {{max}} days.', { max: MAX_DATES });
      if (days.some((d) => (d.label ?? '').length > MAX_LABEL)) return t('A day’s label is too long (at most {{max}} characters).', { max: MAX_LABEL });
    }
    return null;
  };

  const save = async () => {
    const problem = problemWith();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    // Groups go only when the teacher changed them: an unchanged empty list on
    // a sheet whose groups were deleted would otherwise open it to everyone.
    const sameGroups = !!sheet && sheet.groupIds.length === draft.groupIds.length
      && sheet.groupIds.every((g) => draft.groupIds.includes(g));
    const fields = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      slotsPerDate: wholeNumber(draft.slotsText, 1, 100)!,
      picksPerStudent: wholeNumber(draft.picksText, 1, 50)!,
      showNames: draft.showNames,
      open: draft.open,
      timeZone: draft.timeZone.trim(),
      active: draft.active,
      groupIds: sameGroups ? undefined : draft.groupIds,
    };
    try {
      let savedId: number;
      if (sheet) {
        await updateSheet.mutateAsync({ id: sheet.id, ...fields });
        savedId = sheet.id;
      } else {
        savedId = (await createSheet.mutateAsync({ ...fields, groupIds: draft.groupIds, dates: days })).id;
      }
      await utils.signups.adminList.invalidate();
      onDone(savedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the sheet.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div>
        <label htmlFor={`${id}-title`} className={fieldLabel}>{t('Title')}</label>
        <input id={`${id}-title`} value={draft.title} onChange={(e) => set({ title: e.target.value })} className={`${input} w-full`} maxLength={MAX_TITLE} />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className={fieldLabel}>{t('What students are signing up for')}</label>
        <textarea
          id={`${id}-description`}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          className={`${input} w-full`}
          rows={3}
          maxLength={MAX_DESCRIPTION}
        />
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <label htmlFor={`${id}-slots`} className={fieldLabel}>{t('Students per day')}</label>
          <input id={`${id}-slots`} inputMode="numeric" value={draft.slotsText} onChange={(e) => set({ slotsText: e.target.value })} className={`${input} w-20`} />
        </div>
        <div>
          <label htmlFor={`${id}-picks`} className={fieldLabel}>{t('Days per student')}</label>
          <input id={`${id}-picks`} inputMode="numeric" value={draft.picksText} onChange={(e) => set({ picksText: e.target.value })} className={`${input} w-20`} />
        </div>
        <div>
          <label htmlFor={`${id}-tz`} className={fieldLabel}>{t('Time zone')}</label>
          <input id={`${id}-tz`} value={draft.timeZone} onChange={(e) => set({ timeZone: e.target.value })} className={`${input} w-56`} />
          <p className={hint}>{t('A day locks for students at midnight here.')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm text-gray-800 dark:text-gray-200">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={draft.showNames} onChange={(e) => set({ showNames: e.target.checked })} />
          {t('Show classmates who took each day (first name and last initial)')}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={draft.open} onChange={(e) => set({ open: e.target.checked })} />
          {t('Open: students can pick and drop days')}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
          {t('Visible to students')}
        </label>
      </div>
      {groups && <GroupPicker groups={groups} selected={draft.groupIds} onChange={(groupIds) => set({ groupIds })} disabled={saving} />}
      {sheet && !sheet.forEveryone && sheet.groupIds.length === 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {t('This sheet’s groups were deleted, so no student sees it. Check a group to give it back to a class.')}
        </p>
      )}
      {!sheet && (
        <div>
          <label htmlFor={`${id}-days`} className={fieldLabel}>{t('Days')}</label>
          <p className={`${hint} mb-1`}>
            {t('One per line: a date, then an optional label. 2026-09-28, Presentations — or paste two columns from a spreadsheet.')}
          </p>
          <textarea
            id={`${id}-days`}
            value={draft.daysText}
            onChange={(e) => set({ daysText: e.target.value })}
            className={`${input} w-full font-mono text-sm`}
            rows={8}
            spellCheck={false}
          />
          <p className={hint} aria-live="polite">
            {days.length === 0
              ? t('No days yet. You can add them later too.')
              : t('{{count}} day(s): {{first}} to {{last}}', {
                count: days.length,
                first: formatDay(days[0].date, locale),
                last: formatDay(days[days.length - 1].date, locale),
              })}
            {parsed.problems.length > 0 && ` · ${t('{{count}} line(s) not understood', { count: parsed.problems.length })}`}
          </p>
        </div>
      )}
      {error && <div role="alert" className={alertBox}>{error}</div>}
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={saving} className={primary}>
          {saving ? t('Saving...') : sheet ? t('Save') : t('Create sheet')}
        </button>
        <button onClick={onCancel} disabled={saving} className={secondary}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

export default function SignupManager() {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const { data: sheets, isLoading, error: listError } = trpc.signups.adminList.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const remove = trpc.signups.remove.useMutation({ onSuccess: () => utils.signups.adminList.invalidate() });
  const [form, setForm] = useState<{ kind: 'new' } | { kind: 'edit'; id: number } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  if (viewing !== null) return <SignupSheetAdmin sheetId={viewing} onBack={() => setViewing(null)} />;

  const groupName = (gid: number) => groups?.find((g) => g.id === gid)?.name ?? `#${gid}`;
  const copyLink = async (sheetId: number) => {
    try {
      await navigator.clipboard.writeText(studentLink(sheetId));
      setCopied(sheetId);
    } catch {
      window.prompt(t('Copy the link for students:'), studentLink(sheetId));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('Sign-up sheets')}</h2>
          <p className={hint}>{t('Students pick days from a list you paste in — who presents on which day.')}</p>
        </div>
        {form?.kind !== 'new' && <button onClick={() => setForm({ kind: 'new' })} className={primary}>{t('New sign-up sheet')}</button>}
      </div>

      {form?.kind === 'new' && (
        <SheetForm groups={groups} onDone={(id) => { setForm(null); setViewing(id); }} onCancel={() => setForm(null)} />
      )}

      {isLoading ? (
        <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
      ) : listError ? (
        <div role="alert" className={alertBox}>{t('Could not load the sign-up sheets.')}</div>
      ) : !sheets || sheets.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t('No sign-up sheets yet.')}</p>
      ) : (
        // relative: keeps the table's sr-only texts inside the scroll box, not widening a phone's page.
        <div className="relative overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4 font-medium">{t('Title')}</th>
                <th className="py-2 pr-4 font-medium">{t('Status')}</th>
                <th className="py-2 pr-4 font-medium">{t('Days')}</th>
                <th className="py-2 pr-4 font-medium">{t('Spots taken')}</th>
                <th className="py-2 pr-4 font-medium">{t('For')}</th>
                <th className="py-2 font-medium"><span className="sr-only">{t('Actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                form?.kind === 'edit' && form.id === s.id ? (
                  <tr key={s.id}>
                    <td colSpan={6} className="py-3">
                      <SheetForm sheet={s} groups={groups} onDone={() => setForm(null)} onCancel={() => setForm(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-gray-800 align-top">
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 font-medium break-words max-w-xs">{s.title}</td>
                    <td className="py-2 pr-4 space-x-1 whitespace-nowrap">
                      <span className={s.active
                        ? 'px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                        : 'px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}
                      >
                        {s.active ? t('Visible') : t('Hidden')}
                      </span>
                      <span className={s.open
                        ? 'px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}
                      >
                        {s.open ? t('Open') : t('Closed')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {s.dateCount === 0
                        ? '—'
                        : `${s.dateCount} · ${formatDay(s.firstDate!, locale)} – ${formatDay(s.lastDate!, locale)}`}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">{s.claimCount} / {s.slots}</td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {s.forEveryone ? t('Everyone') : s.groupIds.length === 0 ? t('Nobody (its groups were deleted)') : s.groupIds.map(groupName).join(', ')}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setViewing(s.id)} className={secondary}>{t('Roster')}</button>
                        <button onClick={() => void copyLink(s.id)} className={secondary}>
                          {copied === s.id ? t('Link copied') : t('Copy student link')}
                        </button>
                        <Link to={`/signups?sheet=${s.id}`} target="_blank" rel="noopener" className={secondary}>{t('Student view')}</Link>
                        <button onClick={() => setForm({ kind: 'edit', id: s.id })} className={secondary}>{t('Edit')}</button>
                        <button
                          onClick={() => {
                            if (window.confirm(t('Delete “{{title}}” and every day students picked on it?', { title: s.title }))) remove.mutate({ id: s.id });
                          }}
                          disabled={remove.isPending}
                          className={`${secondary} text-red-700 dark:text-red-400`}
                        >
                          {t('Delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
