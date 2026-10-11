// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: speaking tasks (this week's cuento, a rung of the escalera oral),
 * who they are for, and a way into each one to hear and grade the recordings.
 * A task with an exam set is a speaking test (v1.21.0): students find it on
 * the Tests page with that set's listening forms, and record it the same way.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EXAM_SET_MAX_LENGTH, canonicalExamSet } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { uploadRaw } from '../../api/rawUpload';
import { useI18n } from '../../i18n';
import { audioMimeTypeFor, formatClock } from '../../utils/labAudio';
import { examSetNames } from '../tests/testSets';
import SpeakingReview from './SpeakingReview';

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
const hint = 'text-xs text-gray-500 dark:text-gray-400';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';
/** As the lab list's (LabManager). */
const testBadge = 'inline-block ml-2 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';

// The server's limits (routers/speaking.ts, routers/audioUploads.ts), checked
// here first so the teacher gets a plain message instead of a validation dump.
const MAX_TITLE = 200;
const MAX_INSTRUCTIONS = 4000;
const MAX_REFERENCE = 20_000;
const MIN_TARGET_SECONDS = 5;
const MAX_TARGET_SECONDS = 3600;
const MAX_MODEL_BYTES = 64 * 1024 * 1024;

/** The parts of an adminList row the form edits. */
interface TaskFields {
  id: number;
  title: string;
  instructions: string | null;
  referenceText: string | null;
  showReference: boolean;
  modelAudioUrl: string | null;
  targetSeconds: number | null;
  groupIds: number[];
  /** Null: a practice task. A name ("U2"): a speaking test of that exam set (v1.21.0). */
  examSet: string | null;
}

interface Draft {
  title: string;
  instructions: string;
  referenceText: string;
  showReference: boolean;
  modelAudioUrl: string | null;
  targetText: string;
  targetUnit: 'seconds' | 'minutes';
  groupIds: number[];
  active: boolean;
  /** As typed; empty is a practice task. */
  examSet: string;
}

function draftFrom(task: (TaskFields & { active: boolean }) | undefined): Draft {
  const seconds = task?.targetSeconds ?? null;
  const inMinutes = seconds !== null && seconds >= 60 && seconds % 60 === 0;
  return {
    title: task?.title ?? '',
    instructions: task?.instructions ?? '',
    referenceText: task?.referenceText ?? '',
    showReference: task?.showReference ?? true,
    modelAudioUrl: task?.modelAudioUrl ?? null,
    targetText: seconds === null ? '' : String(inMinutes ? seconds / 60 : seconds),
    targetUnit: inMinutes ? 'minutes' : 'seconds',
    groupIds: task?.groupIds ?? [],
    active: task?.active ?? false,
    examSet: task?.examSet ?? '',
  };
}

/** Whole seconds, null for none, undefined when unreadable or out of range. */
function targetSecondsFrom(draft: Draft): number | null | undefined {
  const text = draft.targetText.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  const seconds = Math.round(value * (draft.targetUnit === 'minutes' ? 60 : 1));
  return seconds >= MIN_TARGET_SECONDS && seconds <= MAX_TARGET_SECONDS ? seconds : undefined;
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
      <p className={`${hint} mb-2`}>{t('None checked means every student.')}</p>
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

/** Creates a task, or edits `task`. */
function TaskForm({ task, groups, examSets, onDone, onCancel, onBusyChange }: {
  task?: TaskFields & { active: boolean; forEveryone: boolean };
  groups: { id: number; name: string }[] | undefined;
  /** The exam sets in use, the labs' and the tasks', offered as the field's suggestions. */
  examSets: string[];
  onDone: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const utils = trpc.useUtils();
  const createTask = trpc.speaking.create.useMutation();
  const updateTask = trpc.speaking.update.useMutation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Fraction sent while a model recording uploads. */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = saving || uploadProgress !== null;
  // The admin page guards Back and reload while this is busy (see pages/Admin.tsx).
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  // Closed by a successful save before the effect above sees it go idle.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  const uploadModel = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setUploadError(null);
    const type = audioMimeTypeFor(file);
    if (!type) {
      setUploadError(t('Not a supported audio file (use MP3, M4A, WAV, OGG or WebM)'));
      return;
    }
    if (file.size > MAX_MODEL_BYTES) {
      setUploadError(t('That file is too large. The limit is 64 MB.'));
      return;
    }
    setUploadProgress(0);
    try {
      const media = await uploadRaw<{ audioUrl: string; mimeType: string; sizeBytes: number }>(
        '/api/media',
        file.type === type ? file : new Blob([file], { type }),
        {},
        setUploadProgress,
      );
      set({ modelAudioUrl: media.audioUrl });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('Upload failed'));
    } finally {
      setUploadProgress(null);
    }
  };

  const problemWith = (targetSeconds: number | null | undefined): string | null => {
    if (!draft.title.trim()) return t('Give the task a title.');
    if (draft.title.trim().length > MAX_TITLE) return t('The title can be at most {{count}} characters.', { count: MAX_TITLE });
    if (draft.instructions.length > MAX_INSTRUCTIONS) return t('The instructions can be at most {{count}} characters.', { count: MAX_INSTRUCTIONS });
    if (draft.referenceText.length > MAX_REFERENCE) return t('The reference text can be at most {{count}} characters.', { count: MAX_REFERENCE });
    if (!draft.showReference && !draft.referenceText.trim()) {
      return t('Add the text students should recite, or let them see it while recording.');
    }
    if (targetSeconds === undefined) return t('The target length must be between 5 seconds and 60 minutes.');
    return null;
  };

  const save = async () => {
    const targetSeconds = targetSecondsFrom(draft);
    const problem = problemWith(targetSeconds);
    if (problem) {
      setError(problem);
      return;
    }
    // Empty: a practice task. Otherwise the name as the server stores it (trimmed, inner spaces as one).
    const examSet = draft.examSet.trim() === '' ? null : canonicalExamSet(draft.examSet);
    if (draft.examSet.trim() !== '' && examSet === null) {
      setError(t('Name the exam set (for example U3).'));
      return;
    }
    const fields = {
      title: draft.title.trim(),
      instructions: draft.instructions.trim() || null,
      referenceText: draft.referenceText.trim() || null,
      showReference: draft.showReference,
      modelAudioUrl: draft.modelAudioUrl,
      targetSeconds: targetSeconds ?? null,
      active: draft.active,
      // Sent on every save: the server changes (and logs) it only when it differs.
      examSet,
    };
    setSaving(true);
    setError(null);
    try {
      if (task) {
        const groupsChanged = draft.groupIds.length !== task.groupIds.length
          || draft.groupIds.some((g) => !task.groupIds.includes(g));
        await updateTask.mutateAsync({
          id: task.id,
          ...fields,
          // Only when changed: saving a title must not turn a task whose groups
          // were deleted into one for every student.
          ...(groupsChanged ? { groupIds: draft.groupIds } : {}),
        });
      } else {
        await createTask.mutateAsync({ ...fields, groupIds: draft.groupIds });
      }
      await utils.speaking.adminList.invalidate();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const orphaned = task !== undefined && !task.forEveryone && task.groupIds.length === 0 && draft.groupIds.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-title`} className={fieldLabel}>{t('Title')}</label>
        <input
          id={`${id}-title`}
          className={`${input} mt-1 block w-full`}
          value={draft.title}
          maxLength={MAX_TITLE}
          disabled={saving}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor={`${id}-instructions`} className={fieldLabel}>{t('Instructions (optional)')}</label>
        <textarea
          id={`${id}-instructions`}
          rows={3}
          className={`${input} mt-1 block w-full`}
          value={draft.instructions}
          maxLength={MAX_INSTRUCTIONS}
          disabled={saving}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor={`${id}-reference`} className={fieldLabel}>{t('Reference text (optional)')}</label>
        <p id={`${id}-reference-hint`} className={hint}>
          {t('The exact words to say, such as this week’s cuento. The grader compares each recording against this text.')}
        </p>
        <textarea
          id={`${id}-reference`}
          aria-describedby={`${id}-reference-hint`}
          rows={12}
          className={`${input} mt-1 block w-full leading-relaxed`}
          value={draft.referenceText}
          maxLength={MAX_REFERENCE}
          disabled={saving}
          onChange={(e) => set({ referenceText: e.target.value })}
        />
        <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input
            type="checkbox"
            checked={draft.showReference}
            disabled={saving}
            onChange={(e) => set({ showReference: e.target.checked })}
          />
          {t('Students see the text while recording')}
        </label>
        {!draft.showReference && (
          <p className={hint}>{t('Recite from memory: students do not see the text, but the grader still uses it.')}</p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Model recording (optional)')}</legend>
        <p className={hint}>{t('Students can listen to it before they record.')}</p>
        {draft.modelAudioUrl && (
          <div className="flex flex-wrap items-center gap-3">
            <audio controls preload="metadata" src={draft.modelAudioUrl} aria-label={t('Model recording')} className="max-w-full" />
            <button type="button" onClick={() => set({ modelAudioUrl: null })} disabled={busy} className={secondary}>
              {t('Remove')}
            </button>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-model`} className="text-sm text-gray-700 dark:text-gray-300">
            {draft.modelAudioUrl ? t('Replace it with another file') : t('Upload an audio file')}
          </label>
          <input
            id={`${id}-model`}
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
            disabled={busy}
            onChange={(e) => void uploadModel(e.target.files?.[0])}
            className="mt-1 block text-sm text-gray-700 dark:text-gray-300"
          />
        </div>
        {uploadProgress !== null && (
          <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
            {t('Uploading… {{percent}}%', { percent: Math.round(uploadProgress * 100) })}
          </p>
        )}
        {uploadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
      </fieldset>

      <div>
        <label htmlFor={`${id}-target`} className={fieldLabel}>{t('Target length (optional)')}</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={`${id}-target`}
            inputMode="decimal"
            aria-describedby={`${id}-target-hint`}
            className={`${input} w-24 tabular-nums`}
            value={draft.targetText}
            disabled={saving}
            onChange={(e) => set({ targetText: e.target.value })}
          />
          <select
            aria-label={t('Unit for the target length')}
            className={input}
            value={draft.targetUnit}
            disabled={saving}
            onChange={(e) => set({ targetUnit: e.target.value as Draft['targetUnit'] })}
          >
            <option value="seconds">{t('seconds')}</option>
            <option value="minutes">{t('minutes')}</option>
          </select>
        </div>
        <p id={`${id}-target-hint`} className={`${hint} mt-1`}>{t('Shown to students as a goal; it is not enforced.')}</p>
      </div>

      <div>
        <label htmlFor={`${id}-exam-set`} className={fieldLabel}>{t('Exam set')}</label>
        <input
          id={`${id}-exam-set`}
          aria-describedby={`${id}-exam-set-hint`}
          className={`${input} mt-1 block w-48`}
          value={draft.examSet}
          placeholder={t('for example U3')}
          list={`${id}-exam-sets`}
          maxLength={EXAM_SET_MAX_LENGTH}
          disabled={saving}
          onChange={(e) => set({ examSet: e.target.value })}
        />
        <datalist id={`${id}-exam-sets`}>
          {examSets.map((name) => <option key={name} value={name} />)}
        </datalist>
        <p id={`${id}-exam-set-hint`} className={`${hint} mt-1`}>
          {t("Leave it empty for a practice task. A name such as U2 makes it a test: it shows on the Tests page with that set's listening forms instead of on the Speaking page. Students record it the same way.")}
        </p>
      </div>

      {groups && (
        <GroupPicker groups={groups} selected={draft.groupIds} onChange={(ids) => set({ groupIds: ids })} disabled={saving} />
      )}
      {orphaned && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('Its groups were deleted, so no student sees it. Check a group to assign it again.')}
        </p>
      )}

      <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={draft.active} disabled={saving} onChange={(e) => set({ active: e.target.checked })} />
        {t('Released to students (otherwise it is a draft only you can see)')}
      </label>

      {error && <div role="alert" className={alertBox}>{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className={primary}>
          {saving ? t('Saving...') : task ? t('Save') : t('Create task')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={secondary}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

export default function SpeakingManager({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data: tasks, isLoading, error: loadError } = trpc.speaking.adminList.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const [listError, setListError] = useState<string | null>(null);
  const removeTask = trpc.speaking.remove.useMutation({
    onSuccess: () => { setListError(null); utils.speaking.adminList.invalidate(); },
    onError: (err) => setListError(err.message),
  });
  const [form, setForm] = useState<{ kind: 'new' } | { kind: 'edit'; id: number } | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  // The labs' sets too, once a form is open: a speaking test joins the set of
  // its listening forms, and the teacher should not have to retype the name.
  const { data: labSets } = trpc.labs.examSets.useQuery(undefined, { enabled: form !== null });

  useEffect(() => { onBusyChange?.(formBusy); }, [formBusy, onBusyChange]);

  const groupName = (id: number) => groups?.find((g) => g.id === id)?.name ?? `#${id}`;
  const examSets = examSetNames(labSets?.map((set) => set.examSet), tasks?.map((task) => task.examSet));

  if (reviewing !== null) {
    return <SpeakingReview taskId={reviewing} onBack={() => setReviewing(null)} />;
  }

  const closeForm = () => setForm(null);
  // Opening another form or the review would unmount this one and drop the
  // draft, so those wait for its own Save or Cancel. A task deleted elsewhere
  // takes its form (and that Cancel) with it, so it no longer counts.
  const formOpen = form?.kind === 'new' || (form?.kind === 'edit' && !!tasks?.some((task) => task.id === form.id));
  const waitForForm = formOpen ? t('Save or cancel the task you are editing first.') : undefined;

  return (
    <div className="space-y-8">
      {form?.kind === 'new' && (
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('New speaking task')}</h2>
          <TaskForm groups={groups} examSets={examSets} onDone={closeForm} onCancel={closeForm} onBusyChange={setFormBusy} />
        </section>
      )}

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Speaking tasks')}</h2>
          {form?.kind !== 'new' && (
            <button onClick={() => setForm({ kind: 'new' })} disabled={formOpen} title={waitForForm} className={primary}>
              {t('New speaking task')}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('Students record each task in the browser. Open one to listen to the recordings and grade them.')}
        </p>
        {(listError || loadError) && (
          <div role="alert" className={`${alertBox} mb-4`}>{listError ?? loadError?.message}</div>
        )}
        {isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : !tasks || tasks.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t('No speaking tasks yet. Create the first one.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('Title')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Groups')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Text')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Target')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Turned in')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Ungraded')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {tasks.map((task) => (
                  form?.kind === 'edit' && form.id === task.id ? (
                    <tr key={task.id}>
                      <td colSpan={7} className="py-3">
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded p-3">
                          <TaskForm task={task} groups={groups} examSets={examSets} onDone={closeForm} onCancel={closeForm} onBusyChange={setFormBusy} />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={task.id}>
                      <td className="py-2 pr-3">
                        <div className="max-w-xs wrap-anywhere text-gray-900 dark:text-gray-100">{task.title}</div>
                        <span
                          className={`mt-0.5 inline-block px-2 py-0.5 rounded text-xs font-medium ${task.active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}
                        >
                          {task.active ? t('Active') : t('Draft')}
                        </span>
                        {task.examSet && <span className={testBadge}>{t('Test · {{set}}', { set: task.examSet })}</span>}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-400">
                        {task.forEveryone
                          ? t('Everyone')
                          : task.groupIds.length === 0
                            ? <span className="text-amber-700 dark:text-amber-400">{t('No groups — hidden from students')}</span>
                            : task.groupIds.map(groupName).join(', ')}
                      </td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                        {!task.referenceText
                          ? <span className="text-gray-400">{t('No reference text')}</span>
                          : task.showReference ? t('Text shown') : t('Recited from memory')}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                        {task.targetSeconds ? formatClock(task.targetSeconds * 1000) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                        {task.studentCount}
                        {task.lastSubmittedAt && <span className="text-xs text-gray-400"> · {formatDate(task.lastSubmittedAt)}</span>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <span className={task.ungraded > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-gray-400'}>
                          {task.ungraded}
                        </span>
                      </td>
                      <td className="py-2 whitespace-nowrap space-x-2 text-right">
                        <button onClick={() => setReviewing(task.id)} disabled={formOpen} title={waitForForm} className={secondary}>
                          {t('Review')}
                        </button>
                        <Link to={`/speaking?task=${task.id}`} target="_blank" rel="noopener" className={secondary}>{t('Try it')}</Link>
                        <button onClick={() => setForm({ kind: 'edit', id: task.id })} disabled={formOpen} title={waitForForm} className={secondary}>
                          {t('Edit')}
                        </button>
                        <button
                          onClick={() => {
                            const message = task.studentCount > 0
                              ? t('Delete “{{title}}” and the recordings {{count}} student(s) turned in for it? This cannot be undone.', { title: task.title, count: task.studentCount })
                              : t('Delete “{{title}}”? Any recordings made for it are deleted too.', { title: task.title });
                            if (window.confirm(message)) removeTask.mutate({ id: task.id });
                          }}
                          disabled={formBusy || removeTask.isPending}
                          className={`${secondary} text-red-700 dark:text-red-400`}
                        >
                          {t('Delete')}
                        </button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
