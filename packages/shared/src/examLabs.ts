// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0): test audio as its own thing. A lab with an exam set
 * ("U3") is one form of that test; the forms A–D are four labs in the same
 * set. Each student gets one start per set, across its forms, and the teacher
 * gives one more with Reset. An exam lab plays straight through once: no
 * pause, no going back, no microphone; the answers go on paper.
 */

/** Longest exam-set name ("U3", "Unidad 3 final"). */
export const EXAM_SET_MAX_LENGTH = 40;

/**
 * An exam set's name as stored: trimmed, inner whitespace collapsed to one space. Null when empty or longer
 * than EXAM_SET_MAX_LENGTH. (The server then reuses an existing set's spelling, case-insensitively.)
 */
export function canonicalExamSet(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const name = text.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > EXAM_SET_MAX_LENGTH) return null;
  return name;
}

/** The `appCode` (TRPCError cause) of each exam refusal; the page words them in the student's language. */
export const EXAM_APP_CODES = {
  /** This student's one start in the set is used. */
  used: 'EXAM_USED',
  /** The lab left the set (or exam was switched off) since the page opened it. */
  changed: 'EXAM_CHANGED',
  /** An exam session turned in without a start. */
  notStarted: 'EXAM_NOT_STARTED',
  /** The teacher's Reset on a start that was already reset. */
  alreadyReset: 'EXAM_ALREADY_RESET',
  /** An exam-set name that is empty or too long. */
  setInvalid: 'EXAM_SET_INVALID',
} as const;
export type ExamAppCode = (typeof EXAM_APP_CODES)[keyof typeof EXAM_APP_CODES];
