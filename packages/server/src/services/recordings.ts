// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Students' voice recordings: private storage.
 *
 * Recordings are minors' voices, so they are NOT written to the asset store:
 * /api/assets is public, cached for a year and mounted ahead of the session
 * middleware. They go to their own directory and are served only through an
 * authenticated route that checks the viewer is the student or an admin.
 */
import { randomUUID } from 'crypto';
import { mkdir, readdir, rm, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '../logger.js';
import type { RecordingContainer } from './recordingProbe.js';

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
};

/** "audio/webm;codecs=opus" -> "audio/webm". */
export function baseMimeType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function audioExtensionFor(contentType: string | undefined): string | null {
  return AUDIO_EXTENSIONS[baseMimeType(contentType)] ?? null;
}

/**
 * What the page's recorder produces (client/utils/recording.ts
 * pickRecordingMimeType): Opus in WebM or Ogg, AAC in MP4 on Safari. A
 * speaking take in any other type (an mp3, a wav: the model recording, say)
 * never came from the page, so it is refused.
 */
const RECORDING_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

export function recordingExtensionFor(contentType: string | undefined): string | null {
  return RECORDING_EXTENSIONS[baseMimeType(contentType)] ?? null;
}

const RECORDING_CONTAINERS: Record<string, RecordingContainer> = { webm: 'webm', ogg: 'ogg', m4a: 'mp4' };

/**
 * The container a speaking take of this type should be, or null for a type
 * the recorder never makes. The upload compares it with what the bytes are
 * (recordingProbe.ts sniffContainer): a header is all a console has to change.
 */
export function recordingContainerFor(contentType: string | undefined): RecordingContainer | null {
  const ext = recordingExtensionFor(contentType);
  return ext ? RECORDING_CONTAINERS[ext] : null;
}

const RECORDING_TYPES: Record<RecordingContainer, string> = { webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4' };

/**
 * The type a take in this container is stored and served as when it was sent
 * as another one: the stored type is what the teacher's player is told.
 */
export function recordingTypeFor(container: RecordingContainer): string {
  return RECORDING_TYPES[container];
}

const EXTENSION_PATTERN = [...new Set(Object.values(AUDIO_EXTENSIONS))].join('|');

/** Course audio (a lab, a model recording) lives in the public asset store; it is not student data. */
export const ASSET_AUDIO_URL_RE = new RegExp(`^/api/assets/[0-9a-f-]{36}\\.(?:${EXTENSION_PATTERN})$`);

export function getRecordingsDir(): string {
  return resolve(process.cwd(), 'data', 'recordings');
}

const RECORDING_URL_PREFIX = '/api/recordings/';
const RECORDING_FILE_RE = new RegExp(`^[0-9a-f-]{36}\\.(?:${EXTENSION_PATTERN})$`);

export async function writeRecording(buffer: Buffer, extension: string): Promise<string> {
  const dir = getRecordingsDir();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const path = resolve(dir, filename);
  try {
    await writeFile(path, buffer);
  } catch (err) {
    // A failed write (disk full) can leave part of a student's voice behind.
    await unlink(path).catch(() => {});
    throw err;
  }
  return `${RECORDING_URL_PREFIX}${filename}`;
}

/** The on-disk path for a recording file name, or null if the name is not one we issued. */
export function recordingPathForFilename(filename: string): string | null {
  if (!RECORDING_FILE_RE.test(filename)) return null;
  return resolve(getRecordingsDir(), filename);
}

export function recordingUrlForFilename(filename: string): string {
  return `${RECORDING_URL_PREFIX}${filename}`;
}

/** Best-effort removal; a file already gone is not an error. */
export async function deleteRecordings(urls: string[]): Promise<void> {
  await Promise.all(urls.map(async (url) => {
    if (!url.startsWith(RECORDING_URL_PREFIX)) return;
    const path = recordingPathForFilename(url.slice(RECORDING_URL_PREFIX.length));
    if (!path) return;
    await unlink(path).catch((err: NodeJS.ErrnoException) => {
      // Already gone is fine; anything else leaves a recording on disk, so say so.
      if (err.code !== 'ENOENT') logger.error({ err, url }, 'Could not delete a recording');
    });
  }));
}

/**
 * v1.8.0 recorded lab sessions into data/lab-recordings. Labs are no longer
 * recorded and migration 0032 dropped lab_submissions.audio_url, so nothing can
 * play or delete those files: a minor's voice would sit there forever. Remove
 * the whole directory. Runs at boot, so it logs failures instead of throwing.
 */
export async function removeRetiredLabRecordings(): Promise<void> {
  const dir = resolve(process.cwd(), 'data', 'lab-recordings');
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => !entry.isDirectory()).length;
    await rm(dir, { recursive: true, force: true });
    logger.info({ dir, files }, 'Removed retired lab recordings');
  } catch (err) {
    // Never having had lab recordings is the usual case.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.error({ err, dir }, 'Could not remove retired lab recordings');
  }
}

/** A non-negative whole number of milliseconds from a header, or 0. */
export function headerMs(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 24 * 60 * 60 * 1000) : 0;
}
