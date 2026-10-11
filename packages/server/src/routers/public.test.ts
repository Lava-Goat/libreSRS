// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

function createContext() {
  return {
    req: {} as Request,
    res: {} as Response,
    user: null,
    requestId: 'public-test',
  };
}

describe('publicRouter.getReadme', () => {
  it('returns README contents when file read succeeds', async () => {
    vi.resetModules();
    const readFile = vi.fn().mockResolvedValue('# README');
    const scopedLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = {
      ...scopedLogger,
      child: vi.fn(() => scopedLogger),
    };

    vi.doMock('fs/promises', () => ({
      default: { readFile },
    }));
    vi.doMock('../logger.js', () => ({
      logger,
    }));

    const { publicRouter } = await import('./public.js');
    const caller = publicRouter.createCaller(createContext());

    await expect(caller.getReadme()).resolves.toBe('# README');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('returns fallback content when README read fails', async () => {
    vi.resetModules();
    const readFile = vi.fn().mockRejectedValue(new Error('not found'));
    const error = vi.fn();
    const scopedLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error,
    };
    const logger = {
      ...scopedLogger,
      child: vi.fn(() => scopedLogger),
    };

    vi.doMock('fs/promises', () => ({
      default: { readFile },
    }));
    vi.doMock('../logger.js', () => ({
      logger,
    }));

    const { publicRouter } = await import('./public.js');
    const caller = publicRouter.createCaller(createContext());

    await expect(caller.getReadme()).resolves.toBe('# Error\nCould not load README.md content.');
    expect(error).toHaveBeenCalledTimes(1);
  });
});
