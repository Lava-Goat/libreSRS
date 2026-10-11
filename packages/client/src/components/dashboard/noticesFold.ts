// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Whether the dashboard's notice cards (vocabulary tests, audio labs,
 * speaking, sign-ups) are folded into one row of chips (v1.18.0), as this
 * browser remembers it. A private window, a full disk or a blocked site can
 * refuse localStorage or throw: the page then opens unfolded and the choice
 * lasts until the page is left.
 */

/** '1' folded, '0' the full cards. */
export const NOTICES_FOLDED_KEY = 'libresrs.dashboard.noticesFolded';

/** With nothing remembered: the full cards, as before v1.18.0 (each student folds them once). */
export const NOTICES_FOLDED_BY_DEFAULT = false;

export function readNoticesFolded(): boolean {
  try {
    const stored = window.localStorage.getItem(NOTICES_FOLDED_KEY);
    return stored === null ? NOTICES_FOLDED_BY_DEFAULT : stored === '1';
  } catch {
    return NOTICES_FOLDED_BY_DEFAULT;
  }
}

export function writeNoticesFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(NOTICES_FOLDED_KEY, folded ? '1' : '0');
  } catch {
    // Not remembered: the choice holds until the page is left.
  }
}
