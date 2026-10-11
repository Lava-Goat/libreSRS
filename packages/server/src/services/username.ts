// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What a student types to name their account on the PIN sign-in: their student number, or their
 * full school email.
 */

/**
 * "123456" or "123456@school.example" (any case, spaces trimmed) → what to look for: the full address
 * when one is typed, else the part before the @.
 */
export function normalizeUsername(raw: unknown): { email: string } | { localPart: string } | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 200 || /\s/.test(value)) return null;
  if (value.includes('@')) return /^[^@]+@[^@]+$/.test(value) ? { email: value } : null;
  return { localPart: value };
}
