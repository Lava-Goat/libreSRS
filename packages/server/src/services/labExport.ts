// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The group labs CSV (Admin → Groups → Export → Labs): one row per student per
 * lab, missing ones included, because a missing row is exactly what the
 * teacher is looking for. Labs appear once released, and stay after being
 * hidden again if anyone in the group turned them in.
 *
 * A student's row describes their counting row (the latest credited
 * submission, otherwise the latest), and `status` is done, redo, check or
 * missing. A lab held for the teacher is `check`, with why in `held_for`;
 * `level_only_answered` is what the page's old meter (any sound over −45
 * dBFS) would have counted, from the page's mic stats (v1.16.0 on). Every
 * text cell is formula-safe (csvCell), because the file is opened in a
 * spreadsheet and names and titles are typed by people.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { countedPauses, neededPauses, parseLabMicStats, parsePauseList, type LabPauseSettings } from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { countingRow, effectiveCredit, neededForRow, parseHeldFor, rowStatus } from './labCredit.js';
import { minimumVoicedMs, submissionFlags } from './labMedia.js';
import { getLabSettings } from './labSettings.js';

export const LABS_CSV_HEADER = [
  'student_name', 'student_email', 'lab', 'status', 'submitted_at', 'attempts', 'heard_through_s',
  'required_through_s', 'skips', 'started_at', 'elapsed_s', 'voice_s', 'min_voice_s',
  'pauses_answered', 'pauses_counted', 'needed', 'mic', 'credit_by', 'flags', 'held_for', 'level_only_answered',
].join(',');

/**
 * Text a spreadsheet would run as a formula (it starts with =, +, -, @, a tab
 * or a carriage return) gets a leading apostrophe, so it shows as text.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** A quoted, formula-safe CSV cell. null and undefined are empty. */
export function csvCell(value: unknown): string {
  return '"' + neutralizeFormula(String(value ?? '')).replace(/"/g, '""') + '"';
}

const iso = (v: Date | null | undefined) => (v ? v.toISOString() : '');
const secs = (ms: number) => (ms / 1000).toFixed(0);

type Lab = typeof schema.labs.$inferSelect;
type Submission = typeof schema.labSubmissions.$inferSelect;

export type LabsCsvLab = Pick<Lab, 'id' | 'title' | 'requiredThroughMs' | 'pauses' | 'pauseCountUntilMs'>;
export type LabsCsvSubmission = Pick<Submission,
  | 'id' | 'labId' | 'userId' | 'requiredThroughMs' | 'voicedMs' | 'listenedCoveredMs' | 'skipCount'
  | 'startedAt' | 'submittedAt' | 'mic' | 'pausesCounted' | 'pausesAnswered' | 'rejectedAnswers'
  | 'lateAnswers' | 'minAnsweredPct' | 'flags' | 'credit' | 'creditOverride' | 'checkRequestedAt' | 'heldFor' | 'micStats'>
  /** The set a test was turned in under (v1.19.0): its flags leave out No microphone. Missing or null: practice. */
  & Partial<Pick<Submission, 'examSet'>>;

/** Who gave the counting row its credit: the automatic check, the teacher, or nobody (empty). */
export function creditBy(row: Pick<Submission, 'credit' | 'creditOverride' | 'flags'>): 'auto' | 'teacher' | '' {
  if (!effectiveCredit(row)) return '';
  return row.creditOverride === true ? 'teacher' : 'auto';
}

/**
 * The CSV for these labs (in this order) and students (in this order). Pure.
 * A missing student is measured against the lab as it is now (its must-hear
 * point and counted pauses, and the current % for `needed`); a turned-in row
 * against the values it was judged by.
 */
export function labsCsv(args: {
  labs: readonly LabsCsvLab[];
  members: readonly { id: number; name: string; email: string }[];
  submissions: readonly LabsCsvSubmission[];
  settings: LabPauseSettings;
}): { csv: string; rowCount: number } {
  const lines = [LABS_CSV_HEADER];
  for (const lab of args.labs) {
    const list = parsePauseList(lab.pauses);
    const countedNow = list === null ? null : countedPauses(list, lab.pauseCountUntilMs, lab.requiredThroughMs).length;
    for (const m of args.members) {
      const mine = args.submissions.filter((s) => s.labId === lab.id && s.userId === m.id);
      const row = countingRow(mine);
      if (!row) {
        lines.push([
          csvCell(m.name), csvCell(m.email), csvCell(lab.title), 'missing', '', 0, '', secs(lab.requiredThroughMs), '',
          '', '', '', secs(minimumVoicedMs(lab.requiredThroughMs)),
          '', countedNow ?? '', countedNow === null ? '' : neededPauses(countedNow, args.settings.minAnsweredPct),
          '', '', '', '', '',
        ].join(','));
        continue;
      }
      // Judged against what this submission was accepted under, so editing
      // the lab or the settings later does not rewrite the record.
      const required = row.requiredThroughMs;
      const flags = submissionFlags({
        voicedMs: row.voicedMs,
        skipCount: row.skipCount,
        requiredThroughMs: required,
        pausesCounted: row.pausesCounted,
        rejectedAnswers: row.rejectedAnswers,
        lateAnswers: row.lateAnswers,
        mic: row.mic,
        stored: row.flags,
        exam: row.examSet != null,
      });
      lines.push([
        csvCell(m.name), csvCell(m.email), csvCell(lab.title), rowStatus(row).status, csvCell(iso(row.submittedAt)), mine.length,
        secs(row.listenedCoveredMs), secs(required), row.skipCount,
        csvCell(iso(row.startedAt)), secs(row.submittedAt.getTime() - row.startedAt.getTime()),
        secs(row.voicedMs), secs(minimumVoicedMs(required)),
        row.pausesAnswered ?? '', row.pausesCounted ?? '', neededForRow(row) ?? '',
        row.mic, creditBy(row), csvCell(flags.join(' ')),
        csvCell(parseHeldFor(row.heldFor)?.join(' ') ?? ''), parseLabMicStats(row.micStats)?.levelOnlyAnswered ?? '',
      ].join(','));
    }
  }
  return { csv: lines.join('\n'), rowCount: lines.length - 1 };
}

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

/**
 * The labs CSV for a group: its students (never the teacher) by name, and the
 * labs for everyone or assigned to it, released or already turned in by
 * someone in it, in natural title order.
 */
export function groupLabsCsv(groupId: number): { csv: string; rowCount: number } {
  const members = db
    .selectDistinct({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
    .where(and(eq(schema.userGroups.groupId, groupId), ne(schema.users.role, 'admin')))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const memberIds = members.map((m) => m.id);

  const allLabs = db.select({
    id: schema.labs.id,
    title: schema.labs.title,
    active: schema.labs.active,
    forEveryone: schema.labs.forEveryone,
    requiredThroughMs: schema.labs.requiredThroughMs,
    pauses: schema.labs.pauses,
    pauseCountUntilMs: schema.labs.pauseCountUntilMs,
  }).from(schema.labs).all();
  const assigned = new Set(db.select({ labId: schema.labGroups.labId }).from(schema.labGroups)
    .where(eq(schema.labGroups.groupId, groupId)).all().map((g) => g.labId));
  const forGroup = allLabs.filter((lab) => lab.forEveryone || assigned.has(lab.id));

  const submissions = memberIds.length === 0 || forGroup.length === 0 ? [] : db.select()
    .from(schema.labSubmissions)
    .where(and(
      inArray(schema.labSubmissions.userId, memberIds),
      inArray(schema.labSubmissions.labId, forGroup.map((l) => l.id)),
    ))
    .orderBy(desc(schema.labSubmissions.submittedAt))
    .all();
  const labs = forGroup
    .filter((lab) => lab.active || submissions.some((s) => s.labId === lab.id))
    .sort(byTitle);

  return labsCsv({ labs, members, submissions, settings: getLabSettings() });
}
