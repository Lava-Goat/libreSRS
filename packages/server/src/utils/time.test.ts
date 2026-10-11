// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it, vi } from 'vitest';
import { resolveTimezoneOffsetMinutes, startOfDayForOffset } from './time.js';

describe('time utilities', () => {
  it('returns explicit timezone offset when provided', () => {
    expect(resolveTimezoneOffsetMinutes(90)).toBe(90);
    expect(resolveTimezoneOffsetMinutes(-300)).toBe(-300);
  });

  it('falls back to local timezone offset when offset is omitted', () => {
    const getOffsetSpy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(120);

    expect(resolveTimezoneOffsetMinutes()).toBe(-120);
    expect(resolveTimezoneOffsetMinutes(Number.NaN)).toBe(-120);

    getOffsetSpy.mockRestore();
  });

  it('computes start of day for a positive UTC offset', () => {
    const now = new Date('2026-02-27T12:34:56.000Z');
    const start = startOfDayForOffset(600, now); // UTC+10
    expect(start.toISOString()).toBe('2026-02-26T14:00:00.000Z');
  });

  it('computes start of day for a negative UTC offset', () => {
    const now = new Date('2026-02-27T05:00:00.000Z');
    const start = startOfDayForOffset(-300, now); // UTC-5
    expect(start.toISOString()).toBe('2026-02-27T05:00:00.000Z');
  });
});
