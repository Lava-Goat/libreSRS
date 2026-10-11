// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { parseGoogleClassroomRoster } from './googleClassroom.js';

describe('parseGoogleClassroomRoster', () => {
  it('parses standard Google Classroom roster columns', () => {
    const csv = `First Name,Last Name,Email Address
Alice,Anderson,alice@example.com
Bob,Brown,bob@example.com`;

    const result = parseGoogleClassroomRoster(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.students).toHaveLength(2);
    expect(result.students[0]).toMatchObject({
      email: 'alice@example.com',
      fullName: 'Alice Anderson',
      firstName: 'Alice',
      lastName: 'Anderson',
    });
  });

  it('skips non-student rows when role column is present', () => {
    const csv = `Name,Email,Role
Alice Student,alice@example.com,Student
Tom Teacher,tom@example.com,Teacher
Riley Learner,riley@example.com,Learner`;

    const result = parseGoogleClassroomRoster(csv);

    expect(result.students.map((s) => s.email)).toEqual([
      'alice@example.com',
      'riley@example.com',
    ]);
    expect(result.nonStudentRowsSkipped).toBe(1);
  });

  it('deduplicates email addresses case-insensitively', () => {
    const csv = `Name,Email
Alice Student,ALICE@example.com
Alice Duplicate,alice@example.com`;

    const result = parseGoogleClassroomRoster(csv);

    expect(result.students).toHaveLength(1);
    expect(result.students[0].email).toBe('alice@example.com');
    expect(result.duplicateEmailsSkipped).toBe(1);
  });

  it('reports missing and invalid email rows', () => {
    const csv = `Name,Email
No Email,
Bad Email,not-an-email`;

    const result = parseGoogleClassroomRoster(csv);

    expect(result.students).toHaveLength(0);
    expect(result.errors.some((error) => error.includes('Missing email value'))).toBe(true);
    expect(result.errors.some((error) => error.includes('Invalid email'))).toBe(true);
  });

  it('falls back to generic email/name headers', () => {
    const csv = `Student Name,Primary Email
Jamie Example,jamie@example.com`;

    const result = parseGoogleClassroomRoster(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.students).toHaveLength(1);
    expect(result.students[0]).toMatchObject({
      email: 'jamie@example.com',
      fullName: 'Jamie Example',
    });
  });
});
