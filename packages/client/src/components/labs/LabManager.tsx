// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: the pause rule, upload labs (a semester at a time, each scanned for
 * its answer pauses), release them week by week, find the pauses of labs
 * uploaded before, and open one to review what students turned in. A scan
 * that finds "write it down" pauses (10 s or longer) suggests leaving them out.
 *
 * Tests (v1.19.0): a lab's Edit row can make it an exam lab, a form of an exam
 * set ("U3"). The sets come first, each with "Students and resets", the list
 * where the teacher gives a student one more start (ExamSets, ExamRoster).
 */
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EXAM_SET_MAX_LENGTH, canonicalExamSet, scanNeedsCheck, validatePauseList, type LabPause, type LabPauseScan } from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { uploadRaw } from '../../api/rawUpload';
import { useI18n } from '../../i18n';
import { audioMimeTypeFor, formatClock, parseClock, scanLabFile, scanLabUrl, titleFromFilename } from '../../utils/labAudio';
import { examSetNames } from '../tests/testSets';
import ExamRoster from './ExamRoster';
import ExamSets from './ExamSets';
import LabPauseEditor, { LongPauseBanner, longPauseAdvice, withoutPauses, type LongPauseAdvice } from './LabPauseEditor';
import LabReview from './LabReview';
import LabSettings from './LabSettings';

interface QueuedFile {
  key: number;
  file: File;
  title: string;
  status: 'waiting' | 'scanning' | 'ready' | 'uploading' | 'done' | 'failed';
  durationMs: number;
  lastSpeechMs: number;
  /** The answer pauses the scan found (null until scanned). */
  pauses: LabPause[] | null;
  scan: LabPauseScan | null;
  /** What the teacher typed for "must hear through", m:ss. */
  requiredText: string;
  /** "Don't count pauses after", set from the long-pause suggestion; saved once the lab exists. */
  countUntilMs: number | null;
  /** The teacher kept the long pauses: no more suggestion. */
  longKept: boolean;
  error: string | null;
}

/** A lab uploaded before, just scanned, whose long pauses wait for the teacher's choice. */
interface LongFound {
  pauses: LabPause[];
  scan: LabPauseScan;
  advice: LongPauseAdvice;
}

const input = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const amber = 'text-amber-800 dark:text-amber-300';
const red = 'text-red-700 dark:text-red-400';
const testBadge = 'inline-block ml-2 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';

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
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('None checked means every student.')}</p>
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

export default function LabManager({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data: labs, isLoading } = trpc.labs.adminList.useQuery();
  const { data: groups } = trpc.admin.getGroups.useQuery();
  const createLab = trpc.labs.create.useMutation();
  const [listError, setListError] = useState<string | null>(null);
  const showError = (err: { message: string }) => setListError(err.message);
  const updateLab = trpc.labs.update.useMutation({
    onSuccess: () => { setListError(null); utils.labs.adminList.invalidate(); },
    onError: showError,
  });
  const removeLab = trpc.labs.remove.useMutation({
    onSuccess: () => { setListError(null); utils.labs.adminList.invalidate(); },
    onError: showError,
  });
  const setPauses = trpc.labs.setPauses.useMutation();
  // Its own mutation: a failure belongs to the queue row or the suggestion, not the list's error box.
  const saveCountUntil = trpc.labs.update.useMutation();

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  // The upload loop reads each item when its turn comes, not as it was when
  // the button was pressed, so an edit made meanwhile is what gets uploaded.
  const queueRef = useRef<QueuedFile[]>([]);
  queueRef.current = queue;
  const [scanning, setScanning] = useState(0);
  const [uploadGroups, setUploadGroups] = useState<number[]>([]);
  const [releaseNow, setReleaseNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<{
    id: number; title: string; description: string; requiredText: string; groupIds: number[]; originalGroupIds: number[];
    /** The "Exam (test audio)" switch, the set's name as typed, and the lab's set before the edit (null: practice). */
    exam: boolean; examSet: string; originalExamSet: string | null;
  } | null>(null);
  /** The exam set whose students and resets fill the tab (null: the labs). */
  const [rosterSet, setRosterSet] = useState<string | null>(null);
  /** After a lab joined a set: how many students who already played it now count as started. */
  const [pastNotice, setPastNotice] = useState<string | null>(null);
  const examSetListId = useId();
  // The speaking tests' sets, once the set field is open: a form joins a set a speaking test began.
  const { data: speakingTasks } = trpc.speaking.adminList.useQuery(undefined, { enabled: editing?.exam === true });
  const [editError, setEditError] = useState<string | null>(null);
  /** "Find pauses" in labs uploaded before: how far it has got. */
  const [finding, setFinding] = useState<{ done: number; total: number } | null>(null);
  /** Why finding a lab's pauses failed, by lab id. */
  const [findErrors, setFindErrors] = useState<Record<number, string>>({});
  /** Labs just scanned with long pauses, by lab id, until the teacher chooses. */
  const [longFound, setLongFound] = useState<Record<number, LongFound>>({});
  const [longBusy, setLongBusy] = useState(false);
  /** The Edit row's "Find pauses again" is decoding a lab. */
  const [editorBusy, setEditorBusy] = useState(false);
  const keyRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patch = (key: number, changes: Partial<QueuedFile>) => {
    queueRef.current = queueRef.current.map((item) => (item.key === key ? { ...item, ...changes } : item));
    setQueue(queueRef.current);
  };

  // Leaving mid-upload would strand the rest of the batch: ask on Back, warn on reload.
  const working = busy || scanning > 0 || finding !== null || editorBusy;
  /** Decoding a lab takes ~60 MB: one at a time. */
  const decoding = scanning > 0 || finding !== null || editorBusy;
  useEffect(() => { onBusyChange?.(working); }, [working, onBusyChange]);

  const groupName = (id: number) => groups?.find((g) => g.id === id)?.name ?? `#${id}`;
  /** The exam sets' counts and lists, after a change that moves them (a lab in or out of a set, shown or hidden, deleted). */
  const invalidateExams = () => {
    void utils.labs.examSets.invalidate();
    void utils.labs.examRoster.invalidate();
  };

  /** One file at a time: decoding a semester at once would take gigabytes. */
  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: QueuedFile[] = [...files].map((file) => ({
      key: ++keyRef.current,
      file,
      title: titleFromFilename(file.name),
      status: 'waiting',
      durationMs: 0,
      lastSpeechMs: 0,
      pauses: null,
      scan: null,
      requiredText: '',
      countUntilMs: null,
      longKept: false,
      error: null,
    }));
    queueRef.current = [...queueRef.current, ...added];
    setQueue(queueRef.current);
    if (fileInputRef.current) fileInputRef.current.value = '';

    setScanning((n) => n + 1);
    for (const item of added) {
      if (!audioMimeTypeFor(item.file)) {
        patch(item.key, { status: 'failed', error: t('Not a supported audio file (use MP3, M4A, WAV, OGG or WebM)') });
        continue;
      }
      patch(item.key, { status: 'scanning' });
      try {
        const { durationMs, lastSpeechMs, pauses, scan } = await scanLabFile(item.file);
        patch(item.key, {
          status: 'ready',
          durationMs,
          lastSpeechMs,
          pauses,
          scan,
          requiredText: formatClock(lastSpeechMs || durationMs),
        });
      } catch {
        patch(item.key, { status: 'failed', error: t('This browser could not read the file') });
      }
    }
    setScanning((n) => n - 1);
  };

  /**
   * The box shows whole seconds; left as scanned it means the exact scanned
   * point, and anything typed past the end means the end.
   */
  const requiredFrom = (text: string, exactMs: number, durationMs: number): number | null => {
    if (text.trim() === formatClock(exactMs)) return Math.min(exactMs, durationMs);
    const typed = parseClock(text);
    return typed === null ? null : Math.min(typed, durationMs);
  };

  const uploadAll = async () => {
    setBusy(true);
    // Chosen once for the whole batch; the controls are locked until it ends.
    const groupsForBatch = uploadGroups;
    const releaseBatch = releaseNow;
    for (const key of queueRef.current.filter((q) => q.status === 'ready').map((q) => q.key)) {
      const item = queueRef.current.find((q) => q.key === key);
      if (!item || item.status !== 'ready') continue;
      const required = requiredFrom(item.requiredText, item.lastSpeechMs || item.durationMs, item.durationMs);
      if (required === null || !item.title.trim()) {
        patch(item.key, { error: t('Check the title and the “must hear through” time') });
        continue;
      }
      patch(item.key, { status: 'uploading', error: null });
      try {
        const type = audioMimeTypeFor(item.file)!;
        // A list the server would refuse leaves the lab unscanned ("Find pauses" later) rather than failing the upload.
        const pauses = item.pauses && validatePauseList(item.pauses, item.durationMs).ok ? item.pauses : null;
        const media = await uploadRaw<{ audioUrl: string; mimeType: string }>(
          '/api/media',
          item.file.type === type ? item.file : new Blob([item.file], { type }),
          {},
        );
        const created = await createLab.mutateAsync({
          title: item.title.trim(),
          audioUrl: media.audioUrl,
          mimeType: media.mimeType,
          durationMs: item.durationMs,
          requiredThroughMs: required,
          groupIds: groupsForBatch,
          active: releaseBatch,
          pauses,
          scan: pauses === null ? null : item.scan,
        });
        if (pauses !== null && item.countUntilMs !== null) {
          // The lab exists now: a failure here must not offer the upload again (a second lab).
          try {
            await saveCountUntil.mutateAsync({ id: created.id, pauseCountUntilMs: item.countUntilMs });
          } catch {
            patch(item.key, { status: 'done', error: t("Uploaded, but the point to stop counting pauses was not saved. Set it in the lab's Edit row.") });
            continue;
          }
        }
        patch(item.key, { status: 'done' });
      } catch (err) {
        patch(item.key, { status: 'ready', error: err instanceof Error ? err.message : t('Upload failed') });
      }
    }
    setBusy(false);
    utils.labs.adminList.invalidate();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const lab = labs?.find((l) => l.id === editing.id);
    const required = lab ? requiredFrom(editing.requiredText, lab.requiredThroughMs, lab.durationMs) : null;
    if (!lab || required === null || !editing.title.trim()) {
      setEditError(t('Check the title and the “must hear through” time'));
      return;
    }
    const groupsChanged = editing.groupIds.length !== editing.originalGroupIds.length
      || editing.groupIds.some((id) => !editing.originalGroupIds.includes(id));
    // Trimmed, inner spaces made one; the server reuses a set's spelling whatever the case ("u3" joins "U3").
    const examSet = editing.exam ? canonicalExamSet(editing.examSet) : null;
    if (editing.exam && examSet === null) {
      setEditError(t('Name the exam set (for example U3).'));
      return;
    }
    const examChanged = examSet !== editing.originalExamSet;
    const wasExam = editing.originalExamSet !== null;
    try {
      const saved = await updateLab.mutateAsync({
        id: editing.id,
        title: editing.title.trim(),
        description: editing.description.trim() || null,
        requiredThroughMs: required,
        // Only when changed: saving a title must not turn a lab whose groups
        // were deleted into one for every student.
        ...(groupsChanged ? { groupIds: editing.groupIds } : {}),
        // Only when changed, like the groups: a plain edit never moves a lab in or out of a set.
        ...(examChanged ? { examSet } : {}),
      });
      setEditing(null);
      setEditError(null);
      if (examChanged || wasExam) invalidateExams();
      const pastStarts = saved?.pastStarts ?? 0;
      setPastNotice(examChanged && examSet !== null && pastStarts > 0
        ? t('{{count}} student(s) who already played this lab count as started in {{set}}.', { count: pastStarts, set: saved?.examSet ?? examSet })
        : null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('Could not save'));
    }
  };

  /**
   * Finds the pauses of labs uploaded before this release, one at a time:
   * fetch and decode the audio here, then save the list. Safe during class: a
   * session keeps the rules it began with. A lab with long pauses gets the
   * suggestion to leave them out.
   */
  const findPauses = async (targets: { id: number; audioUrl: string; requiredThroughMs: number; pauseCountUntilMs: number | null }[]) => {
    if (targets.length === 0) return;
    setFinding({ done: 0, total: targets.length });
    for (const [index, lab] of targets.entries()) {
      let problem: string | null = null;
      let found: LongFound | null = null;
      try {
        const { pauses, scan } = await scanLabUrl(lab.audioUrl);
        try {
          await setPauses.mutateAsync({ id: lab.id, pauses, scan });
          const advice = longPauseAdvice(pauses, lab.pauseCountUntilMs, lab.requiredThroughMs);
          if (advice) found = { pauses, scan, advice };
        } catch (err) {
          problem = err instanceof Error ? err.message : t('Could not save');
        }
      } catch {
        problem = t("Could not read this lab's audio.");
      }
      setLongFound((all) => {
        const next = { ...all };
        if (found) next[lab.id] = found;
        else delete next[lab.id];
        return next;
      });
      setFindErrors((errors) => {
        const next = { ...errors };
        if (problem) next[lab.id] = problem;
        else delete next[lab.id];
        return next;
      });
      setFinding({ done: index + 1, total: targets.length });
      await utils.labs.adminList.invalidate();
    }
    setFinding(null);
  };

  /** Ends the suggestion for a lab's long pauses (chosen, or kept). */
  const dropLongFound = (labId: number) => setLongFound((all) => {
    const next = { ...all };
    delete next[labId];
    return next;
  });

  /** The teacher's choice for a lab's long pauses: stop counting at the first, or leave them out of the list. */
  const settleLongPauses = async (labId: number, choice: { countUntilMs: number } | 'dont-count') => {
    const found = longFound[labId];
    if (!found) return;
    setLongBusy(true);
    try {
      if (choice === 'dont-count') {
        await setPauses.mutateAsync({ id: labId, pauses: withoutPauses(found.pauses, found.advice.long), scan: found.scan });
      } else {
        await saveCountUntil.mutateAsync({ id: labId, pauseCountUntilMs: choice.countUntilMs });
      }
      dropLongFound(labId);
      setFindErrors((errors) => {
        const next = { ...errors };
        delete next[labId];
        return next;
      });
      await utils.labs.adminList.invalidate();
    } catch (err) {
      setFindErrors((errors) => ({ ...errors, [labId]: err instanceof Error ? err.message : t('Could not save') }));
    } finally {
      setLongBusy(false);
    }
  };

  if (rosterSet !== null) {
    return <ExamRoster examSet={rosterSet} onBack={() => setRosterSet(null)} />;
  }
  if (reviewing !== null) {
    return (
      <LabReview
        labId={reviewing}
        onBack={() => setReviewing(null)}
        onOpenSet={(set) => { setReviewing(null); setRosterSet(set); }}
      />
    );
  }

  const ready = queue.filter((q) => q.status === 'ready').length;
  const statusLabel: Record<QueuedFile['status'], string> = {
    waiting: t('Waiting'),
    scanning: t('Scanning…'),
    ready: t('Ready'),
    uploading: t('Uploading…'),
    done: t('Uploaded'),
    failed: t('Failed'),
  };

  // A test counts no pauses: it never needs a pause list.
  const unscanned = (labs ?? []).filter((lab) => lab.pauseTotal === null && !lab.examSet);
  const examSets = [...new Set((labs ?? []).map((lab) => lab.examSet).filter((set): set is string => !!set))];
  const setNames = examSetNames(examSets, speakingTasks?.map((task) => task.examSet));

  return (
    <div className="space-y-8">
      {examSets.length > 0 && <ExamSets onOpenSet={setRosterSet} />}

      <LabSettings />

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('Upload labs')}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('Choose one lab or a whole semester. Each file is scanned for its answer pauses and for where the last speech ends; students must hear through that point, and you can change it before uploading.')}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
          multiple
          disabled={finding !== null || editorBusy}
          aria-label={t('Lab audio files')}
          onChange={(e) => void addFiles(e.target.files)}
          className="block text-sm text-gray-700 dark:text-gray-300"
        />

        {queue.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t('Title')}</th>
                    <th className="py-2 pr-3 font-medium">{t('Length')}</th>
                    <th className="py-2 pr-3 font-medium">{t('Must hear through')}</th>
                    <th className="py-2 pr-3 font-medium">{t('Pauses')}</th>
                    <th className="py-2 pr-3 font-medium">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {queue.map((item) => {
                    const pausesNow = item.pauses;
                    const until = item.countUntilMs;
                    // Judged by the "must hear through" typed so far (the scanned point while it can't be read).
                    const scannedEnd = item.lastSpeechMs || item.durationMs;
                    const advice = pausesNow !== null && item.status === 'ready' && !item.longKept
                      ? longPauseAdvice(pausesNow, until, requiredFrom(item.requiredText, scannedEnd, item.durationMs) ?? scannedEnd)
                      : null;
                    return (
                      <Fragment key={item.key}>
                        <tr>
                          <td className="py-2 pr-3">
                            <input
                              className={`${input} w-56`}
                              value={item.title}
                              disabled={busy || item.status === 'done' || item.status === 'uploading'}
                              onChange={(e) => patch(item.key, { title: e.target.value })}
                              aria-label={t('Title for {{file}}', { file: item.file.name })}
                            />
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.file.name}</div>
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                            {item.durationMs ? formatClock(item.durationMs) : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              className={`${input} w-20 tabular-nums`}
                              value={item.requiredText}
                              disabled={busy || item.status !== 'ready'}
                              onChange={(e) => patch(item.key, { requiredText: e.target.value })}
                              aria-label={t('Must hear through for {{file}}', { file: item.file.name })}
                            />
                            {item.lastSpeechMs > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {t('last speech at {{time}}', { time: formatClock(item.lastSpeechMs) })}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                            {pausesNow === null
                              ? '—'
                              : until === null
                                ? pausesNow.length
                                : t('{{count}} pauses · {{counted}} count', {
                                  count: pausesNow.length,
                                  counted: pausesNow.filter(([startMs]) => startMs < until).length,
                                })}
                            {pausesNow !== null && scanNeedsCheck(item.scan, pausesNow.length) && (
                              <div className={`text-xs font-medium ${amber}`}>{t('Check the count')}</div>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <span className={item.status === 'failed' ? 'text-red-600 dark:text-red-400' : item.status === 'done' ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}>
                              {statusLabel[item.status]}
                            </span>
                            {item.error && <div className="text-xs text-red-600 dark:text-red-400">{item.error}</div>}
                          </td>
                        </tr>
                        {advice && pausesNow !== null && (
                          <tr>
                            <td colSpan={5} className="pb-3">
                              <LongPauseBanner
                                advice={advice}
                                busy={busy}
                                onCountUntil={(cutOffMs) => patch(item.key, { countUntilMs: cutOffMs })}
                                onDontCount={() => patch(item.key, { pauses: withoutPauses(pausesNow, advice.long) })}
                                onKeep={() => patch(item.key, { longKept: true })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {groups && <GroupPicker groups={groups} selected={uploadGroups} onChange={setUploadGroups} disabled={busy} />}
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" checked={releaseNow} disabled={busy} onChange={(e) => setReleaseNow(e.target.checked)} />
              {t('Show to students now (otherwise they stay hidden until you turn each one on)')}
            </label>
            <div className="flex gap-3">
              <button onClick={() => void uploadAll()} disabled={busy || scanning > 0 || ready === 0} className={primary}>
                {t('Upload {{count}} lab(s)', { count: ready })}
              </button>
              <button
                onClick={() => {
                  queueRef.current = queueRef.current.filter((q) => q.status !== 'done' && q.status !== 'failed');
                  setQueue(queueRef.current);
                }}
                disabled={busy}
                className={secondary}
              >
                {t('Clear finished')}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Labs')}</h2>
        {(unscanned.length > 0 || finding) && (
          <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
            {finding ? (
              <p role="status">{t('Finding pauses… {{done}} of {{total}}', finding)}</p>
            ) : (
              <>
                <p>{t('{{count}} lab(s) have no pause list yet, so they use the old rule.', { count: unscanned.length })}</p>
                <button
                  onClick={() => void findPauses(unscanned)}
                  disabled={decoding}
                  className={secondary}
                >
                  {t('Find pauses in {{count}} lab(s)', { count: unscanned.length })}
                </button>
              </>
            )}
          </div>
        )}
        {pastNotice && (
          <div role="status" className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200">
            {pastNotice}
          </div>
        )}
        {listError && (
          <div role="alert" className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
            {listError}
          </div>
        )}
        {isLoading ? (
          <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
        ) : !labs || labs.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t('No labs yet. Upload the first one above.')}</p>
        ) : (
          // relative: keeps the table's sr-only texts inside the scroll box (see LabReview).
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('Visible')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Title')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Groups')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Must hear through')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Pauses')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Turned in')}</th>
                  <th className="py-2 font-medium"><span className="sr-only">{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {labs.map((lab) => (
                  editing?.id === lab.id ? (
                    <tr key={lab.id}>
                      <td colSpan={7} className="py-3">
                        <div className="space-y-3 bg-gray-50 dark:bg-gray-900/40 rounded p-3">
                          <div className="flex flex-wrap gap-3">
                            <label className="text-sm text-gray-700 dark:text-gray-300">
                              {t('Title')}
                              <input className={`${input} block w-64`} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                            </label>
                            <label className="text-sm text-gray-700 dark:text-gray-300">
                              {t('Must hear through')}
                              <input className={`${input} block w-24 tabular-nums`} value={editing.requiredText} onChange={(e) => setEditing({ ...editing, requiredText: e.target.value })} />
                              <span className="text-xs text-gray-500 dark:text-gray-400">{t('of {{length}}', { length: formatClock(lab.durationMs) })}</span>
                            </label>
                          </div>
                          <label className="block text-sm text-gray-700 dark:text-gray-300">
                            {t('Note for students (optional)')}
                            <input className={`${input} block w-full`} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                          </label>
                          {groups && <GroupPicker groups={groups} selected={editing.groupIds} onChange={(ids) => setEditing({ ...editing, groupIds: ids })} />}
                          <div className="space-y-2">
                            <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                              <input type="checkbox" checked={editing.exam} onChange={(e) => setEditing({ ...editing, exam: e.target.checked })} />
                              {t('Exam (test audio)')}
                            </label>
                            {editing.exam && (
                              <>
                                <label className="block text-sm text-gray-700 dark:text-gray-300">
                                  {t('Exam set')}
                                  <input
                                    className={`${input} block w-48`}
                                    value={editing.examSet}
                                    placeholder={t('for example U3')}
                                    list={examSetListId}
                                    maxLength={EXAM_SET_MAX_LENGTH}
                                    onChange={(e) => setEditing({ ...editing, examSet: e.target.value })}
                                  />
                                </label>
                                <datalist id={examSetListId}>
                                  {setNames.map((set) => <option key={set} value={set} />)}
                                </datalist>
                                {editing.originalExamSet !== null
                                  && (canonicalExamSet(editing.examSet) ?? editing.originalExamSet).toLowerCase() !== editing.originalExamSet.toLowerCase() && (
                                  <p className={`text-xs ${amber}`}>
                                    {t("Students who already played this lab count as started in the new set. Resets don't carry over.")}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
                                  {t("Each student can start one lab of an exam set, once. It plays straight through: no pause, no going back, no microphone; answers go on paper. Reset, in the set's student list, gives a student one more start. The audio file is still a public link: anyone who has the link can play it outside libreSRS.")}
                                </p>
                              </>
                            )}
                          </div>
                          {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
                          <div className="flex gap-2">
                            <button onClick={() => void saveEdit()} disabled={updateLab.isPending || editorBusy} className={primary}>{t('Save')}</button>
                            <button onClick={() => { setEditing(null); setEditError(null); }} disabled={editorBusy} className={secondary}>{t('Cancel')}</button>
                          </div>
                          <LabPauseEditor
                            lab={lab}
                            disabled={scanning > 0 || finding !== null}
                            onBusyChange={setEditorBusy}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={lab.id}>
                      <tr>
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={lab.active}
                            onChange={(e) => updateLab.mutate(
                              { id: lab.id, active: e.target.checked },
                              lab.examSet ? { onSuccess: invalidateExams } : undefined,
                            )}
                            aria-label={t('Visible to students: {{title}}', { title: lab.title })}
                          />
                        </td>
                        <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                          {lab.title}
                          {lab.examSet && <span className={testBadge}>{t('Test · {{set}}', { set: lab.examSet })}</span>}
                        </td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-gray-400">
                          {lab.forEveryone
                            ? t('Everyone')
                            : lab.groupIds.length === 0
                              ? <span className="text-amber-700 dark:text-amber-400">{t('No groups — hidden from students')}</span>
                              : lab.groupIds.map(groupName).join(', ')}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                          {formatClock(lab.requiredThroughMs)} <span className="text-gray-500 dark:text-gray-400">/ {formatClock(lab.durationMs)}</span>
                        </td>
                        <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                          {lab.pauseTotal === null ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-medium ${amber}`}>{t('Not scanned')}</span>
                              <button
                                onClick={() => void findPauses([lab])}
                                disabled={decoding}
                                className={secondary}
                              >
                                {t('Find pauses')}
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="tabular-nums">
                                {lab.pauseCount === lab.pauseTotal
                                  ? lab.pauseCount
                                  : t('{{count}} pauses · {{counted}} count', { count: lab.pauseTotal, counted: lab.pauseCount ?? 0 })}
                              </span>
                              {lab.needsCheck && <div className={`text-xs font-medium ${amber}`}>{t('Check the count')}</div>}
                            </>
                          )}
                          {findErrors[lab.id] && <div role="alert" className={`text-xs ${red}`}>{findErrors[lab.id]}</div>}
                        </td>
                        <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                          {t('{{count}} turned in', { count: lab.turnedInCount })}
                          {lab.redoCount > 0 && <span className={amber}> · {t('{{count}} need a redo', { count: lab.redoCount })}</span>}
                          {lab.checkCount > 0 && <span className={amber}> · {t('{{count}} waiting for you', { count: lab.checkCount })}</span>}
                          {lab.flaggedCount > 0 && <span className={red}> · {t('{{count}} flagged', { count: lab.flaggedCount })}</span>}
                          {lab.lookCount > 0 && <span className={amber}> · {t('{{count}} to look at', { count: lab.lookCount })}</span>}
                          {lab.lastSubmittedAt && <span className="text-xs text-gray-500 dark:text-gray-400"> · {formatDate(lab.lastSubmittedAt)}</span>}
                        </td>
                        <td className="py-2 whitespace-nowrap space-x-2 text-right">
                          <button onClick={() => setReviewing(lab.id)} className={secondary}>{t('Review')}</button>
                          <Link to={`/labs?lab=${lab.id}`} target="_blank" rel="noopener" className={secondary}>{t('Try it')}</Link>
                          <button
                            onClick={() => {
                              setPastNotice(null);
                              setEditing({
                                id: lab.id,
                                title: lab.title,
                                description: lab.description ?? '',
                                requiredText: formatClock(lab.requiredThroughMs),
                                groupIds: lab.groupIds,
                                originalGroupIds: lab.groupIds,
                                exam: !!lab.examSet,
                                examSet: lab.examSet ?? '',
                                originalExamSet: lab.examSet ?? null,
                              });
                            }}
                            className={secondary}
                          >
                            {t('Edit')}
                          </button>
                          <button
                            onClick={() => {
                              // A test's starts outlive the lab: they still count in its set.
                              const message = lab.examSet
                                ? t("Delete “{{title}}” and everything turned in for it? Students who started it keep their start in {{set}}: reset them in the set's student list. This cannot be undone.", { title: lab.title, set: lab.examSet })
                                : lab.studentCount > 0
                                  ? t('Delete “{{title}}” and everything turned in for it, from {{count}} student(s)? This cannot be undone.', { title: lab.title, count: lab.studentCount })
                                  : t('Delete “{{title}}”?', { title: lab.title });
                              if (window.confirm(message)) removeLab.mutate({ id: lab.id }, lab.examSet ? { onSuccess: invalidateExams } : undefined);
                            }}
                            className={`${secondary} text-red-700 dark:text-red-300`}
                          >
                            {t('Delete')}
                          </button>
                        </td>
                      </tr>
                      {longFound[lab.id] && (
                        <tr>
                          <td colSpan={7} className="pb-3">
                            <LongPauseBanner
                              advice={longFound[lab.id].advice}
                              busy={longBusy}
                              onCountUntil={(cutOffMs) => void settleLongPauses(lab.id, { countUntilMs: cutOffMs })}
                              onDontCount={() => void settleLongPauses(lab.id, 'dont-count')}
                              onKeep={() => dropLongFound(lab.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
