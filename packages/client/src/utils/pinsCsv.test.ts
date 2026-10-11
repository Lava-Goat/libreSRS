// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { PINS_CSV_HEADER, pinsCsv, pinsTsv, type PinRow } from './pinsCsv';

/** Test PINs (never real ones). */
const rows: PinRow[] = [
  { userId: 2, name: 'Ana López', email: '123456@students.school.test', studentNumber: '123456', pin: '5927' },
  { userId: 3, name: 'Ruiz, "Beto"', email: 'beto@students.school.test', studentNumber: null, pin: '6184' },
];

describe('pinsCsv', () => {
  it('starts with the header, in the order the sheet and the emails use', () => {
    expect([...PINS_CSV_HEADER]).toEqual(['Name', 'Email', 'Student number', 'PIN']);
    expect(pinsCsv([]).split('\r\n')).toEqual(['Name,Email,Student number,PIN']);
  });

  it('writes one line per student, quoting as RFC 4180 does', () => {
    expect(pinsCsv(rows).split('\r\n')).toEqual([
      'Name,Email,Student number,PIN',
      'Ana López,123456@students.school.test,123456,5927',
      '"Ruiz, ""Beto""",beto@students.school.test,,6184',
    ]);
  });

  it('quotes a line break inside a cell', () => {
    const csv = pinsCsv([{ ...rows[0], name: 'Ana\nLópez' }]);
    expect(csv.split('\r\n')[1]).toBe('"Ana\nLópez",123456@students.school.test,123456,5927');
  });

  it('keeps a spreadsheet from reading a cell as a formula', () => {
    const csv = pinsCsv([
      { userId: 4, name: '=HYPERLINK("http://x")', email: '+1@x.test', studentNumber: '-5', pin: '7305' },
      { userId: 5, name: '@SUM(A1)', email: 'ok@x.test', studentNumber: '\t9', pin: '8142' },
    ]);
    const [, first, second] = csv.split('\r\n');
    expect(first).toBe(`"'=HYPERLINK(""http://x"")",'+1@x.test,'-5,7305`);
    expect(second).toBe(`'@SUM(A1),ok@x.test,'\t9,8142`);
  });
});

describe('pinsTsv', () => {
  it('writes the same columns, tab-separated', () => {
    expect(pinsTsv(rows).split('\n')).toEqual([
      'Name\tEmail\tStudent number\tPIN',
      'Ana López\t123456@students.school.test\t123456\t5927',
      'Ruiz, "Beto"\tbeto@students.school.test\t\t6184',
    ]);
  });

  it('turns tabs and line breaks inside a cell into spaces, and defuses formulas', () => {
    const tsv = pinsTsv([{ userId: 4, name: 'Ana\tMaría\r\nLópez', email: '=1+1', studentNumber: '123456', pin: '5927' }]);
    expect(tsv.split('\n')[1]).toBe("Ana María López\t'=1+1\t123456\t5927");
  });
});
