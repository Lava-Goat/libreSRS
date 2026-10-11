// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGoogleClassroomCourse,
  fetchGoogleClassroomStudents,
  type GoogleClassroomAuthTokens,
} from './googleClassroomApi.js';

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const originalEnv = process.env;

describe('googleClassroomApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes Google Classroom course metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'course-1',
        name: 'Spanish 1',
        section: 'A',
        description: 'Morning class',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const tokens: GoogleClassroomAuthTokens = { accessToken: 'token-1', refreshToken: null };
    const course = await fetchGoogleClassroomCourse('course-1', tokens);

    expect(course).toEqual({
      id: 'course-1',
      name: 'Spanish 1',
      section: 'A',
      description: 'Morning class',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://classroom.googleapis.com/v1/courses/course-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          Accept: 'application/json',
        }),
      })
    );
  });

  it('paginates and deduplicates student roster emails case-insensitively', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          students: [
            {
              profile: {
                emailAddress: 'ALICE@example.com',
                name: {
                  fullName: 'Alice Anderson',
                  givenName: 'Alice',
                  familyName: 'Anderson',
                },
              },
            },
            {
              profile: {
                emailAddress: 'alice@example.com',
                name: {
                  fullName: 'Duplicate Alice',
                },
              },
            },
          ],
          nextPageToken: 'page-2',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          students: [
            {
              profile: {
                emailAddress: 'bob@example.com',
                name: {
                  givenName: 'Bob',
                  familyName: 'Brown',
                },
              },
            },
          ],
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const tokens: GoogleClassroomAuthTokens = { accessToken: 'token-2', refreshToken: null };
    const students = await fetchGoogleClassroomStudents('course-2', tokens);

    expect(students).toEqual([
      {
        email: 'alice@example.com',
        fullName: 'Alice Anderson',
        firstName: 'Alice',
        lastName: 'Anderson',
      },
      {
        email: 'bob@example.com',
        fullName: 'bob',
        firstName: 'Bob',
        lastName: 'Brown',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('pageToken=page-2');
  });

  it('retries with refreshed access token after 401 response', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'course-3', name: 'Refreshed Course' }));

    vi.stubGlobal('fetch', fetchMock);

    const tokens: GoogleClassroomAuthTokens = {
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
    };

    const course = await fetchGoogleClassroomCourse('course-3', tokens);

    expect(course).toEqual({
      id: 'course-3',
      name: 'Refreshed Course',
      section: null,
      description: null,
    });
    expect(tokens.accessToken).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]).toEqual([
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
      }),
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-token',
      }),
    }));
  });

  it('fails refresh attempts when Google OAuth client credentials are not configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'expired' }));
    vi.stubGlobal('fetch', fetchMock);

    const tokens: GoogleClassroomAuthTokens = {
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
    };

    await expect(fetchGoogleClassroomCourse('course-4', tokens)).rejects.toThrow(
      'Google OAuth client credentials are not configured on the server'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces API failure status when request is not authorized and cannot be retried', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    vi.stubGlobal('fetch', fetchMock);

    const tokens: GoogleClassroomAuthTokens = {
      accessToken: 'token-3',
      refreshToken: null,
    };

    await expect(fetchGoogleClassroomCourse('course-5', tokens)).rejects.toThrow(
      'Google Classroom API request failed (403)'
    );
  });
});
