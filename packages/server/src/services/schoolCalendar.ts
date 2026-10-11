// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The school's calendar: its time zone, the school day of an instant, the
 * Monday that starts its week, the July 1 that starts its school year, and the
 * school's offset from UTC. A school day is a date in the school's time zone,
 * so 11 pm Sunday is still Sunday, whatever clock the page runs on.
 */
import { todayIn } from './signups.js';

/**
 * The school's time zone: a school day is a date there, so a round at 11 pm and
 * one at 7 am are different days, and two periods of one Friday are the same.
 */
export const SCHOOL_TIME_ZONE = 'America/Los_Angeles';

/** A YYYY-MM-DD day as midnight UTC of that date. */
export const utcDate = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
};

/** The school day of an instant: YYYY-MM-DD at the school, so 11 pm Sunday is still Sunday. */
export function schoolDayOf(at: Date): string {
  return todayIn(SCHOOL_TIME_ZONE, at);
}

/** The Monday that starts a school day's week. */
export function weekStartOf(day: string): string {
  const date = utcDate(day);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** The July 1 that starts a school day's school year. */
export function schoolYearStartOf(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return `${month >= 7 ? year : year - 1}-07-01`;
}

/**
 * The school's offset from UTC at `at`, in minutes (-420 in Pacific summer
 * time, -480 in winter). The server's "today" is the school's, never the
 * page's: a page can send any offset, and one that stretched today back into
 * yesterday would pass yesterday's cards off as today's.
 */
export function schoolOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, timeZoneName: 'shortOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}
