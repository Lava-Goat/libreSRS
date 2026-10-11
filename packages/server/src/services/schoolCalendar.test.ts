// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import {
  SCHOOL_TIME_ZONE, schoolDayOf, schoolOffsetMinutes, schoolYearStartOf, utcDate, weekStartOf,
} from './schoolCalendar.js';
import { SCHOOL_TIME_ZONE as QUIZ_TIME_ZONE } from './conjugationQuiz.js';

// Los Angeles is on Pacific time: 7 hours behind UTC in October, 8 in winter.
/** Sun 11 Oct 2026, 22:00 in Los Angeles: already Monday in UTC, still the same school week. */
const SUNDAY_NIGHT = new Date(Date.UTC(2026, 9, 12, 5));

describe('the school calendar', () => {
  it('is on the school\'s clock, one time zone for every caller', () => {
    expect(SCHOOL_TIME_ZONE).toBe('America/Los_Angeles');
    expect(QUIZ_TIME_ZONE).toBe(SCHOOL_TIME_ZONE);
  });

  it('counts weeks from Monday and school years from 1 July', () => {
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(schoolYearStartOf('2026-07-01')).toBe('2026-07-01');
    expect(schoolYearStartOf('2027-06-30')).toBe('2026-07-01');
    expect(schoolDayOf(SUNDAY_NIGHT)).toBe('2026-10-11');
    expect(utcDate('2026-10-05').toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('judges "today" by the school\'s clock, whatever offset the page sends', () => {
    expect(schoolOffsetMinutes(new Date(Date.UTC(2026, 9, 7, 12)))).toBe(-420); // October: PDT
    expect(schoolOffsetMinutes(new Date(Date.UTC(2026, 11, 7, 12)))).toBe(-480); // December: PST
  });
});
