// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Sending the "All Done!" report (cards.logStudyCompletion) again when it is
 * lost: a Chromebook on flaky Wi-Fi reaches the end of a deck, and the report
 * must not vanish with the connection. The server also records the finish at
 * the last review, so this is the second line, not the only one.
 *
 * Only this mutation retries. Never add a global mutation retry: cards.review
 * is not idempotent, and a review whose answer was lost would be rated twice.
 */

/** How long to wait before each retry of a lost "All Done!" report: about 2.5 minutes in all. */
const FINISH_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000, 60000, 60000];

/**
 * Whether a failed "All Done!" report is worth sending again: the network (no
 * answer at all), the server failing (5xx) or too busy (429). Anything else is
 * the server's answer, and asking again would get the same one.
 */
export function finishRetryable(error: unknown): boolean {
  const data = (error as { data?: { httpStatus?: number } | null } | null)?.data;
  if (!data) return true;
  const status = data.httpStatus ?? 0;
  return status >= 500 || status === 429;
}

/** The "All Done!" report's retries: never a global mutation retry, since a review sent twice is rated twice. */
export const finishRetry = {
  retry: (failures: number, error: unknown) => failures < FINISH_RETRY_DELAYS_MS.length && finishRetryable(error),
  retryDelay: (failures: number) => FINISH_RETRY_DELAYS_MS[Math.min(failures, FINISH_RETRY_DELAYS_MS.length - 1)],
};
