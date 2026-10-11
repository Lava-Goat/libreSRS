// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { formatDay, formatDayLong, formatMonth, isCalendarDate, parseDayLines } from './calendarDate';

describe('calendar days', () => {
  it('formats the day itself, whatever the browser’s time zone', () => {
    // As a Date, '2026-09-28' is UTC midnight: the 27th in California. Not here.
    expect(formatDay('2026-09-28', 'en-US')).toBe('Mon, Sep 28');
    expect(formatDayLong('2026-09-28', 'en-US')).toBe('Monday, September 28, 2026');
    expect(formatMonth('2026-12-01', 'en-US')).toBe('December 2026');
    expect(formatDay('not a day', 'en-US')).toBe('not a day');
  });

  it('knows real days', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });

  it('reads days pasted from a calendar or a spreadsheet', () => {
    const { days, problems } = parseDayLines([
      'date,label',
      '2026-09-28, Day 31 · Rivers',
      '2026-09-29\tDay 32 · Volcanoes, with a comma',
      '9/30/2026 | Day 33',
      '10/1/26',
      '',
      '# Fall break',
      '"2026-10-02"',
      'Oct 5, Day 34',
      '2026-02-30, not a day',
    ].join('\n'));
    expect(days).toEqual([
      { date: '2026-09-28', label: 'Day 31 · Rivers' },
      { date: '2026-09-29', label: 'Day 32 · Volcanoes, with a comma' },
      { date: '2026-09-30', label: 'Day 33' },
      { date: '2026-10-01', label: null },
    ]);
    expect(problems.map((p) => p.line)).toEqual([8, 9, 10]);
  });
});
