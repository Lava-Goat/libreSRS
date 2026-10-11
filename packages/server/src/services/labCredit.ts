// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Whether a turned-in lab counts, and what the student and the teacher see.
 *
 * A submission row carries the automatic result (`credit`, decided once at
 * submit from the rules the session began with) and the teacher's decision
 * (`creditOverride`, which wins when set). From those:
 *
 * - a row is `done` (it counts), `redo` (it doesn't; do it again) or `check`
 *   (it doesn't yet; it waits for the teacher: it met the rule but was held,
 *   no microphone, or the student said the mic didn't hear them);
 * - a student is `done` on a lab if any row counts, otherwise has the status
 *   of their latest row, and is `todo` with no rows;
 * - the row that describes a student on a lab (the "counting row") is their
 *   latest credited row, otherwise their latest row.
 *
 * A row written by code older than v1.15 (a lab turned in while the server
 * was rolled back to v1.14, after migration 0039 had run) has no stored flags
 * and a `credit` of 0, the column's default: v1.14 never wrote it. Every lab
 * turned in then counted, so such a row counts (automaticCredit). v1.15
 * always stores its flags, even none ('[]').
 *
 * A held row (v1.16.0, `held_for`) met the pause rule, but something the page
 * could not have sent, or a second lab played at the same time, kept it from
 * counting by itself: it waits for the teacher, and "Give credit to all" leaves
 * it out. A server rolled back to v1.15 reads it as a redo.
 */
import { neededPauses } from '@libresrs/shared';

/** Which rule a session was judged by (routers/labs.ts `submit`). */
export type LabRule = 'legacy' | 'unscored' | 'scored';
export type LabMic = 'on' | 'off';

export type LabRowStatus = 'done' | 'redo' | 'check';
export type LabStudentStatus = LabRowStatus | 'todo';
/**
 * Why a row is not `done`: `check` rows wait because they were held (`held`),
 * there was no microphone (`no-mic`) or the student said it didn't hear them
 * (`asked`); a `redo` row is the teacher's (`teacher`, an override) or
 * automatic (null).
 */
export type LabStatusReason = 'held' | 'no-mic' | 'asked' | 'teacher' | null;

/**
 * Why a row that met the pause rule waits for the teacher instead of counting
 * (only while the rule is above 0%):
 * - `odd-answers`: results the page could not have sent (two or more for one
 *   pause in one playback, or pause voice a session without a microphone could
 *   not have heard);
 * - `overlap`: a different lab, already turned in, played at the same time;
 * - `noisy`: voice outside the pauses, when the teacher chose to hold for it.
 */
export const LAB_HOLD_REASONS = ['odd-answers', 'overlap', 'noisy'] as const;
export type LabHoldReason = (typeof LAB_HOLD_REASONS)[number];

export interface CreditFields {
  credit: boolean;
  creditOverride: boolean | null;
  mic: LabMic;
  checkRequestedAt: Date | null;
  /** The flags stored at submit (JSON text). NULL only on rows written by code older than v1.15. */
  flags: string | null;
  /**
   * Why the row is held for the teacher: the stored JSON list (`held_for`) or
   * the list itself. NULL is not held. Required, so every reader of a row's
   * status selects it.
   */
  heldFor: string | readonly string[] | null;
}

/** A row's hold reasons (`held_for`): null when it is not held. Unknown entries are left out. */
export function parseHeldFor(value: string | readonly string[] | null | undefined): LabHoldReason[] | null {
  if (value == null) return null;
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return LAB_HOLD_REASONS.filter((reason) => list.includes(reason));
}

/** The automatic result: what submit decided, or credit for a row written before v1.15 decided anything. */
export function automaticCredit(row: Pick<CreditFields, 'credit' | 'flags'>): boolean {
  return row.credit || row.flags === null;
}

/** The teacher's decision when there is one, otherwise the automatic result. */
export function effectiveCredit(row: Pick<CreditFields, 'credit' | 'creditOverride' | 'flags'>): boolean {
  return row.creditOverride ?? automaticCredit(row);
}

/**
 * A row's status and why. A hold comes before a missing microphone: a no-mic
 * session with results added by a script shows why it waits.
 */
export function rowStatus(row: CreditFields): { status: LabRowStatus; reason: LabStatusReason } {
  if (effectiveCredit(row)) return { status: 'done', reason: null };
  if (row.creditOverride === false) return { status: 'redo', reason: 'teacher' };
  if (row.heldFor != null) return { status: 'check', reason: 'held' };
  if (row.mic === 'off') return { status: 'check', reason: 'no-mic' };
  if (row.checkRequestedAt) return { status: 'check', reason: 'asked' };
  return { status: 'redo', reason: null };
}

/**
 * Whether a submit meets the rule (before any hold):
 * - a session opened before the pause rule (legacy) counts, as it did then;
 * - with the rule off (0%) every lab counts, with or without a microphone;
 * - a scored session counts when enough pauses were answered, whatever the
 *   microphone (pauses answered before a lost mic still count);
 * - an unscored session (a lab without a pause list) counts when the
 *   microphone was on; without it, it waits for the teacher.
 */
export function decideCredit(args: {
  rule: LabRule;
  pct: number;
  answered: number;
  needed: number;
  mic: LabMic;
}): boolean {
  if (args.rule === 'legacy') return true;
  if (args.pct <= 0) return true;
  if (args.rule === 'scored') return args.answered >= args.needed;
  return args.mic === 'on';
}

/** How many answered pauses a stored row needed: null when it was not scored. */
export function neededForRow(row: { pausesCounted: number | null; minAnsweredPct: number | null }): number | null {
  if (row.pausesCounted == null) return null;
  return neededPauses(row.pausesCounted, row.minAnsweredPct ?? 0);
}

interface Ordered {
  id: number;
  submittedAt: Date;
}

/** Newest first: by when it was turned in, then by id. */
export function newestFirst<T extends Ordered>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || b.id - a.id);
}

/** The row that describes a student on a lab: the latest credited row, otherwise the latest row. */
export function countingRow<T extends Ordered & CreditFields>(rows: readonly T[]): T | null {
  const ordered = newestFirst(rows);
  return ordered.find((row) => effectiveCredit(row)) ?? ordered[0] ?? null;
}

/** A student's status on a lab, from all of their rows for it (any order). */
export function studentLabStatus<T extends Ordered & CreditFields>(rows: readonly T[]): {
  status: LabStudentStatus;
  reason: LabStatusReason;
} {
  const row = countingRow(rows);
  if (!row) return { status: 'todo', reason: null };
  return rowStatus(row);
}
