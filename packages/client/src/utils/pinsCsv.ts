// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A group's new PINs (pins.createForGroup) as a file for the teacher's Google Sheet: a CSV to
 * download, or tab-separated rows to paste. The header is fixed English (it is a data file, read
 * by whoever drafts the emails). PINs never start with 0 (the server issues 1000-9999 only), so a
 * sheet keeps them as they are. Nothing here stores a PIN anywhere.
 */

/** One row of pins.createForGroup's answer. */
export interface PinRow {
  userId: number;
  name: string;
  email: string;
  studentNumber: string | null;
  pin: string;
}

export const PINS_CSV_HEADER = ['Name', 'Email', 'Student number', 'PIN'] as const;

/**
 * A cell a spreadsheet would read as a formula (= + - @, or a leading tab or carriage return)
 * gets a leading apostrophe, so a name like "=HYPERLINK(…)" stays text.
 */
function defused(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cells(row: PinRow): string[] {
  return [row.name, row.email, row.studentNumber ?? '', row.pin].map(defused);
}

/** RFC 4180: quoted when it holds a comma, a quote or a line break; quotes doubled. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The rows as CSV (CRLF line ends, as RFC 4180 has them), header first. */
export function pinsCsv(rows: PinRow[]): string {
  return [[...PINS_CSV_HEADER], ...rows.map(cells)]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
}

/** The rows tab-separated, header first, for pasting into a sheet: tabs and line breaks in a cell become spaces. */
export function pinsTsv(rows: PinRow[]): string {
  return [[...PINS_CSV_HEADER], ...rows.map(cells)]
    .map((line) => line.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}
