// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Students' school IDs: the digits of a student's email (<ID>@school.example),
 * unless the teacher set another (student_number_overrides). Used by PIN
 * sign-in and the admin lists.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The school ID in a student's email: its local part, when that is all digits
 * (<student ID>@school.example; IDs vary in length). Null otherwise.
 */
export function studentNumberFromEmail(email: string): string | null {
  const local = email.trim().split('@')[0] ?? '';
  return /^\d{1,20}$/.test(local) ? local : null;
}

/**
 * A school ID the teacher typed, or null when it is not one. It goes on its
 * own line of an ID list, so it may hold no spaces or line breaks.
 */
export function normalizeStudentNumber(input: string): string | null {
  const trimmed = input.trim();
  return /^[A-Za-z0-9-]{1,32}$/.test(trimmed) ? trimmed : null;
}

/** A student's school ID: the teacher's override, else the digits of their email. */
export function studentNumberOf(tx: Tx | typeof db, userId: number, email: string): string | null {
  const override = tx.select({ studentNumber: schema.studentNumberOverrides.studentNumber })
    .from(schema.studentNumberOverrides)
    .where(eq(schema.studentNumberOverrides.userId, userId))
    .get();
  return override?.studentNumber ?? studentNumberFromEmail(email);
}

/** Every override the teacher set, by user id. */
export function studentNumberOverrideMap(): Map<number, string> {
  return new Map(db.select({ userId: schema.studentNumberOverrides.userId, studentNumber: schema.studentNumberOverrides.studentNumber })
    .from(schema.studentNumberOverrides).all().map((r) => [r.userId, r.studentNumber]));
}
