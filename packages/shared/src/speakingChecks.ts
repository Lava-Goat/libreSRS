// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What the server checks on a speaking take when it arrives (v1.16.0), for
 * the server that decides it and the Review page that shows it.
 */
import { LAB_MIC_STATS_LIMITS, type LabMicProcessing } from './labPauses.js';

/**
 * A take's flags (`speaking_submissions.flags`, a JSON list), decided at upload:
 * - `same-file` (red): the same audio as an earlier take by this student, on any task;
 * - `copied` (red): the same audio as another student's take;
 * - `model` (red): the same audio as the task's model recording;
 * - `length-mismatch` (amber): the page timed it much longer than the file is;
 * - `little-speech` (amber): very little voice for its length;
 * - `unmeasured` (grey): a recording the server could not read as its type (a
 *   WebM or Ogg whose audio it cannot find, an MP4 whose boxes do not add up),
 *   so its length is the page's. A body that is not a recording at all is
 *   refused (415), and Safari's MP4, which states no length, is not flagged.
 */
export const SPEAKING_FLAGS = ['same-file', 'copied', 'model', 'length-mismatch', 'little-speech', 'unmeasured'] as const;
export type SpeakingFlag = (typeof SPEAKING_FLAGS)[number];

/**
 * The flags only a copied file raises: an honest page never sends the same
 * audio twice (a retry reuses its key, and every take is a new recording).
 * The Review carries these up from earlier takes to the take that counts.
 */
export const RED_SPEAKING_FLAGS: readonly SpeakingFlag[] = ['same-file', 'copied', 'model'];

/** A row's stored flags, in SPEAKING_FLAGS order; unknown or unreadable entries are left out. */
export function parseSpeakingFlags(text: string | null | undefined): SpeakingFlag[] {
  if (!text) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return SPEAKING_FLAGS.filter((flag) => parsed.includes(flag));
}

/** A page's timing may run long by this much before it is flagged: at least 3 s, or 20% of the file. */
export const LENGTH_MISMATCH_MIN_MS = 3000;
export const LENGTH_MISMATCH_SHARE = 0.2;

/**
 * The page timed the take much longer than the file is. Honest pages run
 * 35–70 ms long (the recorder stops after the clock); a stalled Chromebook a
 * little more. Only longer counts: a page that timed it short has claimed nothing.
 */
export function isLengthMismatch(claimedMs: number, fileMs: number): boolean {
  return claimedMs - fileMs > Math.max(LENGTH_MISMATCH_MIN_MS, LENGTH_MISMATCH_SHARE * fileMs);
}

const MIC_SWITCHES = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation'] as const;

/**
 * The microphone processing a browser reports (`track.getSettings()`), cut to
 * what the teacher needs: the four switches and the sample rate. Never a
 * device id. Echo cancellation reported as the newer 'all' reads as on; any
 * other unexpected entry is left out. Null when nothing known is left.
 */
export function pickMicSettings(raw: unknown): LabMicProcessing | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const reported = raw as Record<string, unknown>;
  const settings: LabMicProcessing = {};
  for (const key of MIC_SWITCHES) {
    const value = key === 'echoCancellation' && reported[key] === 'all' ? true : reported[key];
    if (typeof value === 'boolean') settings[key] = value;
  }
  const [minRate, maxRate] = LAB_MIC_STATS_LIMITS.sampleRate;
  const rate = reported.sampleRate;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= minRate && rate <= maxRate) settings.sampleRate = Math.round(rate);
  return Object.keys(settings).length > 0 ? settings : null;
}
