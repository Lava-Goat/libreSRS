// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import Papa from 'papaparse';

type CsvRow = Record<string, string | undefined>;

const KNOWN_EMAIL_COLUMNS = [
  'email address',
  'email',
  'student email',
  'primary email',
  'user email',
];

const KNOWN_FULL_NAME_COLUMNS = [
  'name',
  'student name',
  'full name',
];

const KNOWN_FIRST_NAME_COLUMNS = [
  'first name',
  'first',
  'given name',
];

const KNOWN_LAST_NAME_COLUMNS = [
  'last name',
  'last',
  'family name',
  'surname',
];

const KNOWN_ROLE_COLUMNS = [
  'role',
  'user role',
  'classroom role',
];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function getCellValue(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw !== 'string') {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function findFallbackValue(row: CsvRow, matcher: (normalizedKey: string) => boolean): string {
  for (const [key, value] of Object.entries(row)) {
    if (!value) {
      continue;
    }
    const normalizedKey = normalizeHeader(key);
    if (!matcher(normalizedKey)) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function parseEmail(row: CsvRow): string {
  const known = getCellValue(row, KNOWN_EMAIL_COLUMNS);
  if (known) {
    return known;
  }
  return findFallbackValue(row, (key) => key.includes('email'));
}

function parseFullName(row: CsvRow, email: string): { fullName: string; firstName: string | null; lastName: string | null } {
  const knownFull = getCellValue(row, KNOWN_FULL_NAME_COLUMNS);
  if (knownFull) {
    return { fullName: knownFull, firstName: null, lastName: null };
  }

  const fallbackFull = findFallbackValue(
    row,
    (key) => key.includes('name') && !key.includes('first') && !key.includes('last')
  );
  if (fallbackFull) {
    return { fullName: fallbackFull, firstName: null, lastName: null };
  }

  const firstName = getCellValue(row, KNOWN_FIRST_NAME_COLUMNS) || null;
  const lastName = getCellValue(row, KNOWN_LAST_NAME_COLUMNS) || null;
  const joined = `${firstName ?? ''} ${lastName ?? ''}`.trim();

  if (joined) {
    return { fullName: joined, firstName, lastName };
  }

  return {
    fullName: email.split('@')[0] ?? email,
    firstName: null,
    lastName: null,
  };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStudentRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (
    normalized.includes('teacher')
    || normalized.includes('co-teacher')
    || normalized.includes('owner')
    || normalized.includes('guardian')
  ) {
    return false;
  }

  if (normalized.includes('student') || normalized.includes('learner')) {
    return true;
  }

  return true;
}

export interface ClassroomStudent {
  email: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ParseGoogleClassroomRosterResult {
  students: ClassroomStudent[];
  errors: string[];
  duplicateEmailsSkipped: number;
  nonStudentRowsSkipped: number;
}

export function parseGoogleClassroomRoster(csvContent: string): ParseGoogleClassroomRosterResult {
  const errors: string[] = [];
  const students: ClassroomStudent[] = [];
  let duplicateEmailsSkipped = 0;
  let nonStudentRowsSkipped = 0;

  const result = Papa.parse<CsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      errors.push(`Row ${error.row}: ${error.message}`);
    }
  }

  const seen = new Set<string>();

  for (let i = 0; i < result.data.length; i += 1) {
    const row = result.data[i] ?? {};
    const rowNumber = i + 2;

    const role = getCellValue(row, KNOWN_ROLE_COLUMNS);
    if (role && !isStudentRole(role)) {
      nonStudentRowsSkipped += 1;
      continue;
    }

    const rawEmail = parseEmail(row);
    if (!rawEmail) {
      errors.push(`Row ${rowNumber}: Missing email value`);
      continue;
    }

    const email = rawEmail.toLowerCase();
    if (!isEmail(email)) {
      errors.push(`Row ${rowNumber}: Invalid email "${rawEmail}"`);
      continue;
    }

    if (seen.has(email)) {
      duplicateEmailsSkipped += 1;
      continue;
    }
    seen.add(email);

    const parsedName = parseFullName(row, email);
    students.push({
      email,
      fullName: parsedName.fullName,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
    });
  }

  return {
    students,
    errors,
    duplicateEmailsSkipped,
    nonStudentRowsSkipped,
  };
}
