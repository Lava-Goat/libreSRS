// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ASSET_AUDIO_URL_RE,
  audioExtensionFor,
  baseMimeType,
  headerMs,
  recordingContainerFor,
  recordingExtensionFor,
  recordingPathForFilename,
  recordingTypeFor,
  recordingUrlForFilename,
} from './recordings.js';

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('audio types', () => {
  it('maps recorder and upload types to extensions, ignoring codec parameters and case', () => {
    expect(audioExtensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtensionFor('Audio/MP4')).toBe('m4a');
    expect(audioExtensionFor('audio/mpeg')).toBe('mp3');
    expect(audioExtensionFor('audio/x-wav')).toBe('wav');
    expect(baseMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(baseMimeType(undefined)).toBe('');
  });

  it('takes what MediaRecorder produces, which some browsers label video/webm', () => {
    expect(audioExtensionFor('video/webm;codecs=opus')).toBe('webm');
  });

  it('refuses anything that is not audio', () => {
    expect(audioExtensionFor(undefined)).toBeNull();
    expect(audioExtensionFor('')).toBeNull();
    expect(audioExtensionFor('text/html')).toBeNull();
    expect(audioExtensionFor('application/octet-stream')).toBeNull();
    expect(audioExtensionFor('video/mp4')).toBeNull();
  });

  it('takes as a speaking take only what the page’s recorder makes (v1.16.0)', () => {
    expect(recordingExtensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingExtensionFor('video/webm')).toBe('webm');
    expect(recordingExtensionFor('Audio/Ogg; codecs=opus')).toBe('ogg');
    expect(recordingExtensionFor('audio/mp4')).toBe('m4a');
    for (const type of ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/aac', 'audio/opus', 'text/plain', undefined]) {
      expect([type, recordingExtensionFor(type)]).toEqual([type, null]);
    }
    // The container the bytes should then be.
    expect(['audio/webm;codecs=opus', 'video/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', undefined].map(recordingContainerFor))
      .toEqual(['webm', 'webm', 'ogg', 'mp4', null, null]);
    // What a take sent as another of those types is stored as: a type of its own container, with a recording extension.
    for (const container of ['webm', 'ogg', 'mp4'] as const) {
      expect(recordingContainerFor(recordingTypeFor(container))).toBe(container);
    }
  });
});

describe('course audio URLs', () => {
  it('accepts only files the asset store issued', () => {
    for (const ext of ['mp3', 'm4a', 'ogg', 'wav', 'webm']) {
      expect(ASSET_AUDIO_URL_RE.test(`/api/assets/${UUID}.${ext}`)).toBe(true);
    }
    expect(ASSET_AUDIO_URL_RE.test(`/api/assets/${UUID}.exe`)).toBe(false);
    expect(ASSET_AUDIO_URL_RE.test(`/api/assets/../${UUID}.mp3`)).toBe(false);
    expect(ASSET_AUDIO_URL_RE.test(`/api/assets/${UUID}.mp3?x=1`)).toBe(false);
    expect(ASSET_AUDIO_URL_RE.test(`/api/assets/nested/${UUID}.mp3`)).toBe(false);
    expect(ASSET_AUDIO_URL_RE.test(`https://evil.example/${UUID}.mp3`)).toBe(false);
  });

  it('never accepts a student’s recording as course audio', () => {
    expect(ASSET_AUDIO_URL_RE.test(`/api/recordings/${UUID}.webm`)).toBe(false);
    expect(ASSET_AUDIO_URL_RE.test(recordingUrlForFilename(`${UUID}.webm`))).toBe(false);
  });
});

describe('header parsing', () => {
  it('reads whole non-negative milliseconds and rejects junk', () => {
    expect(headerMs('1234.6')).toBe(1235);
    expect(headerMs('0')).toBe(0);
    expect(headerMs('-5')).toBe(0);
    expect(headerMs('abc')).toBe(0);
    expect(headerMs('')).toBe(0);
    expect(headerMs(undefined)).toBe(0);
    expect(headerMs('Infinity')).toBe(0);
    expect(headerMs('NaN')).toBe(0);
  });

  it('caps a value at a day', () => {
    expect(headerMs(String(24 * 60 * 60 * 1000))).toBe(24 * 60 * 60 * 1000);
    expect(headerMs('1e15')).toBe(24 * 60 * 60 * 1000);
  });
});

describe('recording storage', () => {
  let dir: string;
  const cwd = process.cwd();
  const logError = vi.fn();
  const logInfo = vi.fn();

  /** A fresh copy of the module, so a test can swap what it writes with. */
  async function load() {
    vi.resetModules();
    vi.doMock('../logger.js', () => ({ logger: { error: logError, warn: vi.fn(), info: logInfo } }));
    return import('./recordings.js');
  }

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'libresrs-recordings-')));
    process.chdir(dir);
    logError.mockClear();
    logInfo.mockClear();
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    vi.doUnmock('fs/promises');
    vi.doUnmock('../logger.js');
  });

  it('writes outside the public asset store and can delete what it wrote', async () => {
    const { writeRecording, deleteRecordings } = await load();
    const url = await writeRecording(Buffer.from('voice'), 'webm');
    expect(url).toMatch(/^\/api\/recordings\/[0-9a-f-]{36}\.webm$/);

    const path = recordingPathForFilename(url.split('/').pop()!)!;
    expect(path).toBe(join(dir, 'data', 'recordings', url.split('/').pop()!));
    expect(path).not.toContain(join('data', 'assets'));
    expect(readFileSync(path, 'utf8')).toBe('voice');

    await deleteRecordings([url]);
    expect(existsSync(path)).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  it('never reuses a name', async () => {
    const { writeRecording } = await load();
    const urls = await Promise.all(Array.from({ length: 5 }, () => writeRecording(Buffer.from('v'), 'ogg')));
    expect(new Set(urls).size).toBe(5);
    expect(readdirSync(join(dir, 'data', 'recordings'))).toHaveLength(5);
  });

  it('leaves no partial file behind when a write fails, and still reports the failure', async () => {
    const diskFull = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    vi.doMock('fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('fs/promises')>();
      return {
        ...actual,
        // Half the recording reaches the disk, then the disk fills up.
        writeFile: vi.fn(async (path: string, data: Buffer) => {
          await actual.writeFile(path, data.subarray(0, data.length / 2));
          throw diskFull;
        }),
      };
    });
    const { writeRecording } = await load();

    await expect(writeRecording(Buffer.from('a whole recording'), 'webm')).rejects.toBe(diskFull);
    expect(readdirSync(join(dir, 'data', 'recordings'))).toEqual([]);
  });

  it('deletes only recordings: course audio and names it did not issue are left alone', async () => {
    const { deleteRecordings } = await load();
    const recordings = join(dir, 'data', 'recordings');
    const assets = join(dir, 'data', 'assets');
    mkdirSync(recordings, { recursive: true });
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(recordings, `${UUID}.webm`), 'student');
    writeFileSync(join(assets, `${UUID}.webm`), 'course audio');
    writeFileSync(join(dir, 'data', 'flashcards.db'), 'db');

    await deleteRecordings([
      `/api/assets/${UUID}.webm`,
      '/api/recordings/../flashcards.db',
      `/api/recordings/../assets/${UUID}.webm`,
      `/api/recordings/${UUID.toUpperCase()}.webm`,
      `/api/labs/recordings/${UUID}.webm`,
    ]);

    expect(existsSync(join(recordings, `${UUID}.webm`))).toBe(true);
    expect(existsSync(join(assets, `${UUID}.webm`))).toBe(true);
    expect(existsSync(join(dir, 'data', 'flashcards.db'))).toBe(true);
  });

  it('treats a recording that is already gone as deleted', async () => {
    const { deleteRecordings } = await load();
    await expect(deleteRecordings([`/api/recordings/${UUID}.webm`])).resolves.toBeUndefined();
    expect(logError).not.toHaveBeenCalled();
  });

  it('reports, but does not throw on, a recording it could not delete — and deletes the rest', async () => {
    const { deleteRecordings } = await load();
    const recordings = join(dir, 'data', 'recordings');
    // A directory where the file should be: unlink fails with something other than ENOENT.
    mkdirSync(join(recordings, `${UUID}.webm`), { recursive: true });
    writeFileSync(join(recordings, `${OTHER_UUID}.webm`), 'voice');

    await expect(deleteRecordings([`/api/recordings/${UUID}.webm`, `/api/recordings/${OTHER_UUID}.webm`])).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toMatchObject({ url: `/api/recordings/${UUID}.webm` });
    expect(existsSync(join(recordings, `${OTHER_UUID}.webm`))).toBe(false);
  });

  it('only resolves file names it could have issued', () => {
    expect(recordingPathForFilename(`${UUID}.webm`)).not.toBeNull();
    expect(recordingPathForFilename(`${UUID}.m4a`)).not.toBeNull();
    for (const bad of [
      '../flashcards.db', `../${UUID}.webm`, `${UUID}.webm/..`, `${UUID.toUpperCase()}.webm`,
      `${UUID}.db`, `${UUID}.webm.exe`, `sub/${UUID}.webm`, `${UUID}`, '',
    ]) {
      expect(recordingPathForFilename(bad)).toBeNull();
    }
  });

  it('builds the private URL a recording is served from', () => {
    expect(recordingUrlForFilename(`${UUID}.webm`)).toBe(`/api/recordings/${UUID}.webm`);
  });

  describe('retired lab recordings', () => {
    const labRecordings = () => join(dir, 'data', 'lab-recordings');

    it('removes every file v1.8.0 left and the directory itself, and says how many', async () => {
      const { removeRetiredLabRecordings } = await load();
      mkdirSync(labRecordings(), { recursive: true });
      writeFileSync(join(labRecordings(), `${UUID}.webm`), 'student');
      writeFileSync(join(labRecordings(), `${OTHER_UUID}.m4a`), 'student');
      // Anything else in there is just as unreachable.
      writeFileSync(join(labRecordings(), 'partial'), 'half a student');

      await expect(removeRetiredLabRecordings()).resolves.toBeUndefined();

      expect(existsSync(labRecordings())).toBe(false);
      expect(logInfo).toHaveBeenCalledTimes(1);
      expect(logInfo.mock.calls[0][0]).toMatchObject({ files: 3 });
      expect(logError).not.toHaveBeenCalled();
    });

    it('does nothing, quietly, when there were never any', async () => {
      const { removeRetiredLabRecordings } = await load();

      await expect(removeRetiredLabRecordings()).resolves.toBeUndefined();

      expect(existsSync(labRecordings())).toBe(false);
      expect(logInfo).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('leaves speaking recordings, course audio and the database alone', async () => {
      const { removeRetiredLabRecordings, writeRecording } = await load();
      const speaking = await writeRecording(Buffer.from('speaking'), 'webm');
      const speakingPath = recordingPathForFilename(speaking.split('/').pop()!)!;
      mkdirSync(join(dir, 'data', 'assets'), { recursive: true });
      writeFileSync(join(dir, 'data', 'assets', `${UUID}.webm`), 'course audio');
      writeFileSync(join(dir, 'data', 'flashcards.db'), 'db');
      mkdirSync(labRecordings(), { recursive: true });
      writeFileSync(join(labRecordings(), `${UUID}.webm`), 'lab');

      await removeRetiredLabRecordings();

      expect(existsSync(labRecordings())).toBe(false);
      expect(readFileSync(speakingPath, 'utf8')).toBe('speaking');
      expect(readdirSync(join(dir, 'data', 'recordings'))).toHaveLength(1);
      expect(readFileSync(join(dir, 'data', 'assets', `${UUID}.webm`), 'utf8')).toBe('course audio');
      expect(readFileSync(join(dir, 'data', 'flashcards.db'), 'utf8')).toBe('db');
    });

    it('reports, but never throws into boot, when it cannot remove them', async () => {
      const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      vi.doMock('fs/promises', async (importOriginal) => {
        const actual = await importOriginal<typeof import('fs/promises')>();
        return { ...actual, rm: vi.fn(async () => { throw denied; }) };
      });
      const { removeRetiredLabRecordings } = await load();
      mkdirSync(labRecordings(), { recursive: true });
      writeFileSync(join(labRecordings(), `${UUID}.webm`), 'student');

      await expect(removeRetiredLabRecordings()).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toMatchObject({ err: denied, dir: labRecordings() });
      expect(logInfo).not.toHaveBeenCalled();
    });
  });
});
