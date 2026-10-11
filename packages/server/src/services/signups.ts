// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Calendar-day helpers for sign-up sheets. A sheet's days are plain
 * 'YYYY-MM-DD' strings: a class meets on a day, not at an instant, and the
 * server runs in UTC while the school does not.
 */

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' naming a real day (no 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const m = CALENDAR_DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** An IANA zone this runtime knows ('America/Los_Angeles'). */
export function isTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Today's date where the school is, as 'YYYY-MM-DD'. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * What classmates see: first name and last initial ("Ana R."). Null when the
 * name is not a person's name — an account with no display name carries its
 * email, and a pre-created one its email's local part or student number, and
 * those are not for classmates to see. "Ruiz, Ana" reads as last, first.
 */
export function shortName(name: string | null | undefined, email?: string | null): string | null {
  const raw = (name ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const address = (email ?? '').trim().toLowerCase();
  if (address && (lower === address || lower === address.split('@')[0])) return null;

  const comma = raw.indexOf(',');
  const ordered = comma >= 0 ? `${raw.slice(comma + 1)} ${raw.slice(0, comma)}` : raw;
  // Words that are ids, addresses or handles say nothing about the name.
  const words = ordered
    .split(/\s+/)
    .filter((w) => !/[@\d_]/.test(w))
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return null;
  if (words.length === 1) return /[.]/.test(words[0]) ? null : words[0];
  const last = words[words.length - 1];
  const initial = [...last].find((ch) => /\p{L}/u.test(ch)) ?? '';
  return `${words[0]} ${initial.toLocaleUpperCase()}.`;
}
