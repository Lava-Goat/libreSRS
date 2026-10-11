// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { ClassroomStudent } from './googleClassroom.js';
import { logger } from '../logger.js';

const CLEVER_API_BASE = 'https://api.clever.com/v3.0';

export interface CleverSection {
  id: string;
  name: string;
  subject: string | null;
  grade: string | null;
  period: string | null;
}

// Clever v3.0 response envelope: { data: [ { data: {...}, uri: "..." } ], links: [...] }
async function fetchCleverApiJson(path: string, token: string): Promise<unknown> {
  const url = `${CLEVER_API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    logger.warn({
      event: 'clever_api.request.failed',
      path,
      statusCode: response.status,
    }, 'Clever API request failed');
    throw new Error(`Clever API request failed (${response.status})`);
  }

  return response.json();
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

export async function fetchCleverSections(token: string): Promise<CleverSection[]> {
  const sections: CleverSection[] = [];
  let starting_after: string | null = null;

  logger.info({ event: 'clever_api.sections_fetch.start' }, 'Fetching Clever sections');

  do {
    const params = new URLSearchParams({ limit: '100' });
    if (starting_after) params.set('starting_after', starting_after);

    const payload = asObject(await fetchCleverApiJson(`/sections?${params.toString()}`, token));
    const items = asArray(payload.data);

    for (const item of items) {
      const entry = asObject(item);
      const data = asObject(entry.data);
      const id = readString(data, 'id');
      const name = readString(data, 'name');
      if (!id || !name) continue;
      sections.push({
        id,
        name,
        subject: readString(data, 'subject'),
        grade: readString(data, 'grade'),
        period: readString(data, 'period'),
      });
    }

    // Clever paginates via starting_after = last item id
    starting_after = items.length === 100
      ? readString(asObject(asObject(items[items.length - 1]).data), 'id')
      : null;
  } while (starting_after);

  logger.info({
    event: 'clever_api.sections_fetch.finish',
    sectionsFetched: sections.length,
  }, 'Finished fetching Clever sections');
  return sections;
}

export async function fetchCleverSectionStudents(
  sectionId: string,
  token: string
): Promise<ClassroomStudent[]> {
  const students: ClassroomStudent[] = [];
  const seenEmails = new Set<string>();
  let starting_after: string | null = null;

  logger.info({
    event: 'clever_api.section_students_fetch.start',
    sectionId,
  }, 'Fetching Clever section students');

  do {
    const params = new URLSearchParams({ limit: '100' });
    if (starting_after) params.set('starting_after', starting_after);

    const payload = asObject(
      await fetchCleverApiJson(`/sections/${encodeURIComponent(sectionId)}/students?${params.toString()}`, token)
    );
    const items = asArray(payload.data);

    for (const item of items) {
      const entry = asObject(item);
      const data = asObject(entry.data);
      const email = (readString(data, 'email') ?? '').toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);

      const nameObj = asObject(data.name);
      const firstName = readString(nameObj, 'first') ?? null;
      const lastName = readString(nameObj, 'last') ?? null;
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];

      students.push({ email, fullName, firstName, lastName });
    }

    starting_after = items.length === 100
      ? readString(asObject(asObject(items[items.length - 1]).data), 'id')
      : null;
  } while (starting_after);

  logger.info({
    event: 'clever_api.section_students_fetch.finish',
    sectionId,
    studentsFetched: students.length,
  }, 'Finished fetching Clever section students');
  return students;
}
