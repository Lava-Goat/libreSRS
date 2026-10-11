// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Whether a Vocabulómetro test is actually visible to students right now.
// Mirrors isTestOpenNow in packages/server/src/routers/vocab.ts: a test is
// takeable only when isOpen is set AND now is inside [opensAt, closesAt]
// (both ends inclusive, either end optional). Keep the two in step.
//
// 'invalid' is a window that closes before it opens: the server never shows
// such a test, so the pill must not promise an opening that never comes.

export type VocabTestWindowState = 'closed' | 'scheduled' | 'open' | 'ended' | 'invalid';

export interface VocabTestWindow {
  isOpen: boolean;
  opensAt: string | Date | null | undefined;
  closesAt: string | Date | null | undefined;
}

function ms(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** True when both ends are set and the window closes before it opens. */
export function isVocabTestWindowInverted(
  opensAt: string | Date | null | undefined,
  closesAt: string | Date | null | undefined,
): boolean {
  const opens = ms(opensAt);
  const closes = ms(closesAt);
  return opens !== null && closes !== null && closes < opens;
}

export function vocabTestWindowState(test: VocabTestWindow, now: number = Date.now()): VocabTestWindowState {
  if (!test.isOpen) return 'closed';
  if (isVocabTestWindowInverted(test.opensAt, test.closesAt)) return 'invalid';
  const opens = ms(test.opensAt);
  if (opens !== null && now < opens) return 'scheduled';
  const closes = ms(test.closesAt);
  if (closes !== null && now > closes) return 'ended';
  return 'open';
}
