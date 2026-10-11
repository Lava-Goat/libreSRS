// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Calendar days ('YYYY-MM-DD') for sign-up sheets. These are days, not
 * instants: `new Date('2026-09-28')` is UTC midnight, which is the evening of
 * the 27th in California, so everything here formats in UTC on purpose.
 */

function utcDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, date));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === date ? d : null;
}

export function isCalendarDate(day: string): boolean {
  return utcDate(day) !== null;
}

/** "Mon, Sep 28" in the reader's language. */
export function formatDay(day: string, locale: string): string {
  const d = utcDate(day);
  return d ? d.toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : day;
}

/** "Monday, September 28, 2026", for screen readers and confirmations. */
export function formatDayLong(day: string, locale: string): string {
  const d = utcDate(day);
  return d ? d.toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : day;
}

/** "September 2026", a heading over that month's days. */
export function formatMonth(day: string, locale: string): string {
  const d = utcDate(day);
  return d ? d.toLocaleDateString(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }) : day.slice(0, 7);
}

export interface PastedDay {
  date: string;
  label: string | null;
}

/**
 * Days pasted from a calendar, one per line: a date, then an optional label.
 *   2026-09-28, Presentations
 *   9/29/2026	Lab day        (a spreadsheet's tab works too)
 * Blank lines, '#' comments and a "date" header row are skipped.
 */
export function parseDayLines(text: string): { days: PastedDay[]; problems: { line: number; text: string }[] } {
  const days: PastedDay[] = [];
  const problems: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(\S+?)(?:\s*[,|\t;]\s*|\s+|$)(.*)$/.exec(line);
    const first = m?.[1] ?? line;
    if (/^date$/i.test(first.replace(/[,|;]$/, ''))) return;
    const date = normalizeDate(first);
    if (!date) {
      problems.push({ line: index + 1, text: line });
      return;
    }
    const label = (m?.[2] ?? '').trim().replace(/^["']|["']$/g, '').trim();
    days.push({ date, label: label || null });
  });
  return { days, problems };
}

/** 'YYYY-MM-DD' from '2026-09-28' or '9/28/2026' (or '9/28/26'); null otherwise. */
function normalizeDate(value: string): string | null {
  if (isCalendarDate(value)) return value;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!us) return null;
  const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
  const day = `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return isCalendarDate(day) ? day : null;
}
