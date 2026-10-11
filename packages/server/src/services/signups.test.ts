// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { isCalendarDate, isTimeZone, shortName, todayIn } from './signups.js';

describe('sign-up day helpers', () => {
  it('accepts real calendar days only', () => {
    expect(isCalendarDate('2026-09-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-9-28')).toBe(false);
    expect(isCalendarDate('2026-09-28T00:00:00Z')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });

  it('knows real time zones', () => {
    expect(isTimeZone('America/Los_Angeles')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('turns the day over at the school’s midnight, not UTC’s', () => {
    // 11:30 pm Sunday in California is already Monday in UTC.
    expect(todayIn('America/Los_Angeles', new Date('2026-09-28T06:30:00Z'))).toBe('2026-09-27');
    expect(todayIn('America/Los_Angeles', new Date('2026-09-28T07:30:00Z'))).toBe('2026-09-28');
    expect(todayIn('UTC', new Date('2026-09-28T06:30:00Z'))).toBe('2026-09-28');
  });

  it('shows classmates a first name and last initial, and never a bare student number', () => {
    expect(shortName('Mateo Ejemplo')).toBe('Mateo E.');
    expect(shortName('María José García López')).toBe('María L.');
    expect(shortName('  ana   ruiz ')).toBe('ana R.');
    expect(shortName('Beto')).toBe('Beto');
    expect(shortName('Zoë Ñúñez')).toBe('Zoë Ñ.');
    expect(shortName("Liam O'Brien")).toBe('Liam O.');
    expect(shortName('123456')).toBeNull();
    expect(shortName('')).toBeNull();
    expect(shortName(null)).toBeNull();
  });

  it('shows nothing when the "name" is really an address, a handle or an id', () => {
    // No display name from Google: the account's name is its email.
    expect(shortName('ana.rodriguez@students.school.test', 'ana.rodriguez@students.school.test')).toBeNull();
    expect(shortName('Ana.Rodriguez@students.school.test')).toBeNull();
    // A roster import with no name column keeps the email's local part.
    expect(shortName('ana.rodriguez', 'ana.rodriguez@students.school.test')).toBeNull();
    expect(shortName('arodriguez', 'arodriguez@students.school.test')).toBeNull();
    expect(shortName('ana.rodriguez')).toBeNull();
    expect(shortName('s1234567')).toBeNull();
    expect(shortName('ana_r')).toBeNull();
  });

  it('reads "Last, First" as a last name and a first name, and drops an id in the name', () => {
    expect(shortName('Rodriguez, Ana')).toBe('Ana R.');
    expect(shortName('Rodriguez Lopez, Ana Maria')).toBe('Ana L.');
    expect(shortName('Ana Rodriguez (S1234567)')).toBe('Ana R.');
    expect(shortName('Ana Rodriguez', 'ana.rodriguez@students.school.test')).toBe('Ana R.');
  });
});
