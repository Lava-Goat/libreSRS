// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkModeration } from './moderation.js';

describe('checkModeration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows content through when moderation API responds non-OK', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    const result = await checkModeration('hello', 'sk-test');
    expect(result).toEqual({ flagged: false, categories: {} });
  });

  it('returns parsed moderation result when API responds OK', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ flagged: true, categories: { violence: true } }],
      }),
    } as Response);

    const result = await checkModeration('text', 'sk-test');
    expect(result).toEqual({
      flagged: true,
      categories: { violence: true },
    });
  });

  it('falls back to safe defaults when payload is missing expected fields', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await checkModeration('text', 'sk-test');
    expect(result).toEqual({
      flagged: false,
      categories: {},
    });
  });

  it('sends moderation to the configured endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: false, categories: {} }] }),
    } as Response);

    await checkModeration('hello', 'local-token', 'http://model-host:8000/v1/');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://model-host:8000/v1/moderations',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer local-token' }),
      })
    );
  });
});
