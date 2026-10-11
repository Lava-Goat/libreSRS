// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { ClassroomStudent } from './googleClassroom.js';
import { logger } from '../logger.js';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLASSROOM_BASE_URL = 'https://classroom.googleapis.com/v1';

export type GoogleClassroomAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
};

export interface GoogleClassroomCourse {
  id: string;
  name: string;
  section: string | null;
  description: string | null;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Google API response was not an object');
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

function readString(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    logger.error({
      event: 'google_classroom.token_refresh.missing_config',
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
    }, 'Cannot refresh Google access token without OAuth client configuration');
    throw new Error('Google OAuth client credentials are not configured on the server');
  }

  logger.debug({
    event: 'google_classroom.token_refresh.start',
  }, 'Refreshing Google Classroom access token');

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    logger.warn({
      event: 'google_classroom.token_refresh.failed',
      statusCode: response.status,
    }, 'Google token refresh failed');
    throw new Error(`Google token refresh failed (${response.status})`);
  }

  const payload = asObject(await response.json());
  const nextAccessToken = readString(payload, 'access_token');
  if (!nextAccessToken) {
    logger.error({
      event: 'google_classroom.token_refresh.invalid_payload',
    }, 'Google token refresh response did not include access token');
    throw new Error('Google token refresh did not return an access token');
  }

  logger.info({
    event: 'google_classroom.token_refresh.success',
  }, 'Google access token refreshed');
  return nextAccessToken;
}

async function fetchGoogleJson(
  path: string,
  tokens: GoogleClassroomAuthTokens
): Promise<JsonObject> {
  const url = `${GOOGLE_CLASSROOM_BASE_URL}${path}`;

  const doFetch = async (token: string) => fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  let response = await doFetch(tokens.accessToken);
  logger.debug({
    event: 'google_classroom.request.initial_response',
    path,
    statusCode: response.status,
  }, 'Received Google Classroom API response');

  if (response.status === 401 && tokens.refreshToken) {
    logger.warn({
      event: 'google_classroom.request.retry_with_refresh',
      path,
      statusCode: response.status,
    }, 'Google Classroom request returned 401; attempting token refresh');
    const refreshedToken = await refreshGoogleAccessToken(tokens.refreshToken);
    tokens.accessToken = refreshedToken;
    response = await doFetch(refreshedToken);
    logger.debug({
      event: 'google_classroom.request.retry_response',
      path,
      statusCode: response.status,
    }, 'Received Google Classroom API response after token refresh');
  }

  if (!response.ok) {
    logger.warn({
      event: 'google_classroom.request.failed',
      path,
      statusCode: response.status,
      usedRefreshToken: Boolean(tokens.refreshToken),
    }, 'Google Classroom API request failed');
    throw new Error(`Google Classroom API request failed (${response.status})`);
  }

  logger.debug({
    event: 'google_classroom.request.success',
    path,
    statusCode: response.status,
  }, 'Google Classroom API request succeeded');
  return asObject(await response.json());
}

export async function fetchGoogleClassroomCourse(
  courseId: string,
  tokens: GoogleClassroomAuthTokens
): Promise<GoogleClassroomCourse> {
  logger.info({
    event: 'google_classroom.course_fetch.start',
    courseId,
  }, 'Fetching Google Classroom course');
  const payload = await fetchGoogleJson(`/courses/${encodeURIComponent(courseId)}`, tokens);

  const course = {
    id: readString(payload, 'id') ?? courseId,
    name: readString(payload, 'name') ?? `Google Classroom ${courseId}`,
    section: readString(payload, 'section'),
    description: readString(payload, 'description'),
  };
  logger.info({
    event: 'google_classroom.course_fetch.finish',
    courseId: course.id,
    name: course.name,
    hasSection: Boolean(course.section),
    hasDescription: Boolean(course.description),
  }, 'Fetched Google Classroom course');
  return course;
}

export async function fetchGoogleClassroomCourses(
  tokens: GoogleClassroomAuthTokens
): Promise<GoogleClassroomCourse[]> {
  const courses: GoogleClassroomCourse[] = [];
  let nextPageToken: string | null = null;
  let pageCount = 0;

  logger.info({ event: 'google_classroom.courses_fetch.start' }, 'Fetching Google Classroom courses');

  do {
    pageCount += 1;
    const params = new URLSearchParams({ teacherId: 'me', courseStates: 'ACTIVE', pageSize: '100' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const payload = await fetchGoogleJson(`/courses?${params.toString()}`, tokens);

    for (const value of asArray(payload.courses)) {
      const row = asObject(value);
      const id = readString(row, 'id');
      const name = readString(row, 'name');
      if (!id || !name) continue;
      courses.push({
        id,
        name,
        section: readString(row, 'section'),
        description: readString(row, 'description'),
      });
    }

    logger.debug({
      event: 'google_classroom.courses_fetch.page',
      page: pageCount,
      coursesCollected: courses.length,
    }, 'Processed Google Classroom courses page');
    nextPageToken = readString(payload, 'nextPageToken');
  } while (nextPageToken);

  logger.info({
    event: 'google_classroom.courses_fetch.finish',
    coursesFetched: courses.length,
    pagesFetched: pageCount,
  }, 'Finished fetching Google Classroom courses');
  return courses;
}

export async function fetchGoogleClassroomStudents(
  courseId: string,
  tokens: GoogleClassroomAuthTokens
): Promise<ClassroomStudent[]> {
  const students: ClassroomStudent[] = [];
  const seenEmails = new Set<string>();
  let nextPageToken: string | null = null;
  let pageCount = 0;

  logger.info({
    event: 'google_classroom.students_fetch.start',
    courseId,
  }, 'Fetching Google Classroom students');

  do {
    pageCount += 1;
    const params = new URLSearchParams({ pageSize: '100' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const payload = await fetchGoogleJson(
      `/courses/${encodeURIComponent(courseId)}/students?${params.toString()}`,
      tokens
    );

    const pageStudents = asArray(payload.students);
    for (const value of pageStudents) {
      const row = asObject(value);
      const profile = asObject(row.profile ?? {});
      const nameObject = asObject(profile.name ?? {});
      const email = (readString(profile, 'emailAddress') ?? '').toLowerCase();
      if (!email || seenEmails.has(email)) {
        continue;
      }
      seenEmails.add(email);

      const fullName = readString(nameObject, 'fullName')
        ?? readString(profile, 'name')
        ?? email.split('@')[0]
        ?? email;

      students.push({
        email,
        fullName,
        firstName: readString(nameObject, 'givenName'),
        lastName: readString(nameObject, 'familyName'),
      });
    }

    logger.debug({
      event: 'google_classroom.students_fetch.page',
      courseId,
      page: pageCount,
      studentsCollected: students.length,
      pageStudentCount: pageStudents.length,
      hasNextPage: Boolean(readString(payload, 'nextPageToken')),
    }, 'Processed Google Classroom students page');
    nextPageToken = readString(payload, 'nextPageToken');
  } while (nextPageToken);

  logger.info({
    event: 'google_classroom.students_fetch.finish',
    courseId,
    studentsFetched: students.length,
    pagesFetched: pageCount,
  }, 'Finished fetching Google Classroom students');
  return students;
}
