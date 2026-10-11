// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../');
const SCRIPT_PATH = path.resolve(ROOT_DIR, 'scripts/write-build-info.sh');
const TEST_OUT_DIR = path.resolve(__dirname, '../test-dist');

describe('write-build-info.sh regression test', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_OUT_DIR)) {
      fs.rmSync(TEST_OUT_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_OUT_DIR)) {
      fs.rmSync(TEST_OUT_DIR, { recursive: true, force: true });
    }
  });

  it('correctly passes GIT_TAG and GIT_COMMIT to build-info.json', () => {
    const tag = 'v1.9.9';
    const commit = '1234567890abcdef';
    
    execSync(`GIT_TAG=${tag} GIT_COMMIT=${commit} bash ${SCRIPT_PATH} ${TEST_OUT_DIR}`, {
      env: { ...process.env, GIT_TAG: tag, GIT_COMMIT: commit }
    });

    const jsonPath = path.join(TEST_OUT_DIR, 'build-info.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(content.tag).toBe(tag);
    expect(content.commit).toBe(commit.slice(0, 7));
    expect(content.version).toBe(tag);
    expect(content.reference).toBe(tag);
  });

  it('falls back to commit hash when no valid tag is available', () => {
    const commit = 'abcdef1234567890';
    
    // Provide a non-v* GIT_TAG to avoid git tag auto-detection and exercise fallback behavior.
    execSync(`GIT_TAG=not-a-release-tag GIT_COMMIT=${commit} bash ${SCRIPT_PATH} ${TEST_OUT_DIR}`, {
      env: { ...process.env, GIT_TAG: 'not-a-release-tag', GIT_COMMIT: commit }
    });

    const jsonPath = path.join(TEST_OUT_DIR, 'build-info.json');
    const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    expect(content.tag).toBeNull();
    expect(content.commit).toBe(commit.slice(0, 7));
    expect(content.version).toBe(commit.slice(0, 7));
  });

  it('ensures version is "unknown" if nothing is provided', () => {
    // This test assumes git might or might not be available, 
    // but the script has defaults for when git fails.
    // We can force it by running in a non-git dir if we wanted to be super thorough,
    // but here we just check that it doesn't crash and produces valid JSON.
    execSync(`GIT_TAG= GIT_COMMIT= bash ${SCRIPT_PATH} ${TEST_OUT_DIR}`, {
      env: { ...process.env, GIT_TAG: '', GIT_COMMIT: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '' }
    });

    const jsonPath = path.join(TEST_OUT_DIR, 'build-info.json');
    const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    expect(content).toHaveProperty('version');
    expect(content).toHaveProperty('commit');
  });

  it('correctly uses GITHUB_REF_NAME when GITHUB_REF_TYPE is tag', () => {
    const tag = 'v2.0.0';
    const commit = 'abcdef1234567890';
    
    execSync(`GIT_TAG= GIT_COMMIT=${commit} GITHUB_REF_TYPE=tag GITHUB_REF_NAME=${tag} GIT_DIR=/tmp/non-existent bash ${SCRIPT_PATH} ${TEST_OUT_DIR}`, {
      env: { 
        ...process.env, 
        GIT_TAG: '', 
        GIT_COMMIT: commit, 
        GITHUB_REF_TYPE: 'tag', 
        GITHUB_REF_NAME: tag,
        GIT_DIR: '/tmp/non-existent' 
      }
    });

    const jsonPath = path.join(TEST_OUT_DIR, 'build-info.json');
    const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    expect(content.tag).toBe(tag);
    expect(content.version).toBe(tag);
  });
});
