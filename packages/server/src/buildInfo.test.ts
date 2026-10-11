// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBuildInfo } from './buildInfo';
import * as fs from 'fs';
import * as child_process from 'child_process';

vi.mock('fs');
vi.mock('child_process');

describe('getBuildInfo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    // Clear build info env vars
    delete process.env.GIT_TAG;
    delete process.env.GIT_COMMIT;
    delete process.env.GITHUB_REF_TYPE;
    delete process.env.GITHUB_REF_NAME;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns unknown when no info is available', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error(); });
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error(); });

    const info = getBuildInfo();
    expect(info.commit).toBe('unknown');
    expect(info.tag).toBeNull();
    expect(info.version).toBe('unknown');
  });

  it('uses environment variables when available', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error(); });
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error(); });
    
    process.env.GIT_TAG = 'v1.2.3';
    process.env.GIT_COMMIT = 'abcdef12345';

    const info = getBuildInfo();
    expect(info.tag).toBe('v1.2.3');
    expect(info.commit).toBe('abcdef1');
    expect(info.version).toBe('v1.2.3');
  });

  it('strictly prefers stored build info from JSON file and ignores ENV vars', () => {
    const storedInfo = JSON.stringify({
      version: 'v1.0.0',
      tag: 'v1.0.0',
      commit: 'stored123',
      reference: 'v1.0.0'
    });
    vi.mocked(fs.readFileSync).mockReturnValue(storedInfo);
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error(); });
    
    process.env.GIT_TAG = 'stale-tag';
    process.env.GIT_COMMIT = 'stale-commit';

    const info = getBuildInfo();
    expect(info.tag).toBe('v1.0.0');
    expect(info.commit).toBe('stored1');
    expect(info.version).toBe('v1.0.0');
  });

  it('falls back to commit hash when tag is not available', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error(); });
    vi.mocked(child_process.execSync).mockImplementation((cmd) => {
      if (cmd.toString().includes('rev-parse')) return 'commit123';
      if (cmd.toString().includes('describe')) throw new Error();
      return '';
    });

    const info = getBuildInfo();
    expect(info.tag).toBeNull();
    expect(info.commit).toBe('commit1');
    expect(info.version).toBe('commit1');
  });
});
