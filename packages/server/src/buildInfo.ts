// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

export type BuildInfo = {
  // Single source of truth for the running build:
  // - exact v* tag at HEAD when present
  // - otherwise the short git hash
  version: string;
  tag: string | null;
  commit: string;
  reference: string;
};

type PartialBuildInfo = Partial<BuildInfo>;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUILD_INFO_PATH = resolve(__dirname, './build-info.json');

function shortHash(value: string | null | undefined): string {
  return (value ?? '').trim().slice(0, 7);
}

function normalizeVTag(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('v') ? trimmed : '';
}

function getTagFromEnv(): string {
  const explicitTag = (process.env.GIT_TAG ?? '').trim();
  if (explicitTag) {
    return explicitTag;
  }

  if (process.env.GITHUB_REF_TYPE === 'tag') {
    return (process.env.GITHUB_REF_NAME ?? '').trim();
  }

  return '';
}

function readStoredBuildInfo(): PartialBuildInfo | null {
  try {
    return JSON.parse(readFileSync(BUILD_INFO_PATH, 'utf8')) as PartialBuildInfo;
  } catch {
    return null;
  }
}

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getGitTagAtHead(): string {
  try {
    return execSync("git describe --tags --match 'v*' --exact-match", {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function getBuildInfo(): BuildInfo {
  const storedBuildInfo = readStoredBuildInfo();

  if (storedBuildInfo) {
    return {
      version: storedBuildInfo.version || storedBuildInfo.reference || 'unknown',
      tag: storedBuildInfo.tag || null,
      commit: shortHash(storedBuildInfo.commit) || 'unknown',
      reference: storedBuildInfo.reference || 'unknown',
    };
  }

  const tag = normalizeVTag(getTagFromEnv()) || normalizeVTag(getGitTagAtHead());
  const commit = shortHash(process.env.GIT_COMMIT) || shortHash(getGitCommit()) || 'unknown';
  const reference = tag || commit;

  return {
    version: reference,
    tag: tag || null,
    commit,
    reference,
  };
}
