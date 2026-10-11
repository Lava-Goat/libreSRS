// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The routes that move audio as a raw request body (index.ts wires them):
 * course audio the teacher uploads, and students' speaking recordings.
 *
 * Audio does not go through tRPC: the JSON parser is capped at 10MB and base64
 * inflates by a third. Writing the bytes straight to disk also keeps them out
 * of the database, the mistake that once grew it to 199MB.
 *
 * Since v1.16.0 a speaking take is checked against the file itself when it
 * arrives (services/recordingProbe.ts): that its bytes are one of the
 * recorder's containers, whatever type it was sent as, its real length, and
 * whether its audio was posted before. The flags are for the teacher; a take
 * that is a recording is always kept.
 */
import type { Request, Response, NextFunction } from 'express';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { and, eq, sql } from 'drizzle-orm';
import {
  SPEAKING_FLAGS,
  isLengthMismatch,
  isLittleSpeech,
  pickMicSettings,
  type SpeakingFlag,
} from '@libresrs/shared';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';
import type { AuthenticatedUser } from '../middleware/auth.js';
import { getAssetsDir, writeAudioAsset } from '../services/ai/assetStorage.js';
import { fingerprintRecording, measureRecording, sniffContainer } from '../services/recordingProbe.js';
import {
  ASSET_AUDIO_URL_RE,
  audioExtensionFor,
  baseMimeType,
  deleteRecordings,
  headerMs,
  recordingContainerFor,
  recordingExtensionFor,
  recordingPathForFilename,
  recordingTypeFor,
  recordingUrlForFilename,
  writeRecording,
} from '../services/recordings.js';
import { MAX_SPEAKING_ATTEMPTS, assertSpeakingTaskVisible } from './speaking.js';

/** A lab's audio or a model recording: long, but the teacher's own file. */
export const MEDIA_BYTES = 64 * 1024 * 1024;
/**
 * The recorder stops at fifteen minutes; at 128 kbps that is ~15MB. The
 * headroom is for browsers that ignore the requested bitrate.
 */
export const RECORDING_BYTES = 48 * 1024 * 1024;

/** Chosen by the page once per recording, so a retry is recognised as the same one. */
const SUBMISSION_KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Refuses an upload before its body is read. express.raw buffers the whole
 * body, so the user, the type and the declared size are checked first and an
 * anonymous or oversized request never occupies memory.
 */
export function acceptAudioUpload(options: { adminOnly: boolean; maxBytes: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const currentUser = req.user as AuthenticatedUser | undefined;
    if (!currentUser) { res.status(401).json({ error: 'Not authenticated' }); return; }
    if (options.adminOnly && currentUser.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
    if (!audioExtensionFor(req.get('content-type'))) {
      res.status(415).json({ error: `Unsupported audio type: ${req.get('content-type') ?? 'none'}` });
      return;
    }
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      res.status(413).json({ error: 'File too large' });
      return;
    }
    next();
  };
}

/**
 * The teacher uploads course audio (a lab, a model recording). It is not
 * student data, so it goes to the public asset store; labs.create and
 * speaking.create take the URL this returns.
 */
export async function handleMediaUpload(req: Request, res: Response) {
  const contentType = req.get('content-type');
  const ext = audioExtensionFor(contentType);
  if (!ext) { res.status(415).json({ error: 'Unsupported audio type' }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'Empty upload' });
    return;
  }
  try {
    const audioUrl = await writeAudioAsset(req.body, ext);
    logger.info({ event: 'media.uploaded', bytes: req.body.length }, 'Course audio uploaded');
    res.json({ audioUrl, mimeType: baseMimeType(contentType), sizeBytes: req.body.length });
  } catch (err) {
    logger.error({ err }, 'Course audio upload failed');
    res.status(500).json({ error: 'Upload failed' });
  }
}

class AttemptCapReached extends Error {
  constructor(readonly stored: number) {
    super('attempt cap reached');
  }
}

function sqliteCode(err: unknown): string | undefined {
  // Drizzle wraps driver errors; the SQLite code may be on the cause.
  return (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
}

const tooManyAttempts = (stored: number) =>
  `You have already turned this in ${stored} times. Ask your teacher before recording it again.`;

/** The recording this student already turned in under this key, if any. */
function submissionByKey(userId: number, clientKey: string) {
  return db.query.speakingSubmissions.findFirst({
    where: and(eq(schema.speakingSubmissions.userId, userId), eq(schema.speakingSubmissions.clientKey, clientKey)),
    columns: { id: true, taskId: true },
  });
}

/** Answers a retry of a recording that is already stored. */
function answerDuplicate(res: Response, existing: { id: number; taskId: number }, taskId: number) {
  if (existing.taskId !== taskId) { res.status(409).json({ error: 'That recording was turned in for another task' }); return; }
  res.json({ success: true, duplicate: true, submissionId: existing.id });
}

/**
 * Fingerprints of the tasks' model recordings, by URL, to find a take that is
 * the model posted again (/api/assets is public). An asset is never rewritten
 * (each upload gets a new name), so an entry never goes stale.
 */
const modelFingerprints = new Map<string, string>();
const MAX_MODEL_FINGERPRINTS = 500;

/** The model recording's fingerprint, read once per URL; null with no model, or when it cannot be read. */
async function modelFingerprint(url: string | null): Promise<string | null> {
  if (!url || !ASSET_AUDIO_URL_RE.test(url)) return null;
  const known = modelFingerprints.get(url);
  if (known) return known;
  try {
    const { sha256 } = fingerprintRecording(await readFile(resolve(getAssetsDir(), url.slice('/api/assets/'.length))));
    if (modelFingerprints.size >= MAX_MODEL_FINGERPRINTS) modelFingerprints.clear();
    modelFingerprints.set(url, sha256);
    return sha256;
  } catch (err) {
    // No comparison with the model this time; the take is still stored.
    logger.warn({ err, url }, 'Could not read a model recording to compare a take with');
    return null;
  }
}

/** The page's `track.getSettings()`, as JSON to store, or null when there is nothing usable in the header. */
function micSettingsFrom(header: string | undefined): string | null {
  if (!header || header.length > 1000) return null;
  try {
    const settings = pickMicSettings(JSON.parse(header));
    return settings ? JSON.stringify(settings) : null;
  } catch {
    return null;
  }
}

/** A student turns in a recording of a speaking task. */
export async function handleSpeakingSubmission(req: Request, res: Response) {
  const currentUser = req.user as AuthenticatedUser;
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId)) { res.status(400).json({ error: 'Bad task id' }); return; }

  const contentType = req.get('content-type');
  // Only what the page's recorder makes: an mp3 or a wav (a model recording, say) never came from it.
  if (!recordingExtensionFor(contentType)) { res.status(415).json({ error: 'Unsupported recording type' }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'Empty recording' });
    return;
  }
  const clientKey = req.get('x-submission-key') ?? '';
  if (!SUBMISSION_KEY_RE.test(clientKey)) { res.status(400).json({ error: 'Missing submission key' }); return; }

  let task;
  try {
    task = await assertSpeakingTaskVisible(currentUser, taskId);
  } catch (err) {
    const code = (err as { code?: string }).code;
    res.status(code === 'FORBIDDEN' ? 403 : 404).json({ error: (err as Error).message });
    return;
  }

  // What the take is comes from its bytes, never from the header, which is all a console has
  // to change. A body that is none of the recorder's containers is refused whatever type it
  // was sent as: an mp3 or a wav (the model recording, say) sent as audio/mp4 or audio/webm.
  const container = sniffContainer(req.body);
  if (!container) {
    logger.warn({
      event: 'speaking.submission_refused', taskId, userId: currentUser.id,
      declared: baseMimeType(contentType), bytes: req.body.length,
    }, 'A speaking take was not a recording');
    res.status(415).json({ error: 'Unsupported recording type' });
    return;
  }
  // A recording sent as another of the recorder's types (a WebM as audio/ogg, say) is read,
  // measured and flagged as what it is, and stored and served as that. The page always sends
  // the type it recorded, so only an edited request gets here.
  const declared = recordingContainerFor(contentType);
  const mimeType = container === declared ? baseMimeType(contentType) : recordingTypeFor(container);
  const ext = recordingExtensionFor(mimeType)!;
  if (container !== declared) {
    logger.warn({
      event: 'speaking.submission_relabelled', taskId, userId: currentUser.id,
      declared: baseMimeType(contentType), container, bytes: req.body.length,
    }, 'A speaking take was sent as another recording type than it is');
  }

  // A retry after a lost response is the same recording: say so and keep nothing new.
  const existing = await submissionByKey(currentUser.id, clientKey);
  if (existing) { answerDuplicate(res, existing, taskId); return; }

  const countFor = (executor: Pick<typeof db, 'select'>) => executor.select({ stored: sql<number>`count(*)` })
    .from(schema.speakingSubmissions)
    .where(and(eq(schema.speakingSubmissions.taskId, taskId), eq(schema.speakingSubmissions.userId, currentUser.id)))
    .get()!.stored;
  const before = countFor(db);
  if (before >= MAX_SPEAKING_ATTEMPTS) { res.status(429).json({ error: tooManyAttempts(before) }); return; }

  // What the page claims, kept as it claimed it; what is stored is checked against the file.
  const clientDurationMs = headerMs(req.get('x-recording-duration-ms'));
  const clientVoicedMs = headerMs(req.get('x-recording-voiced-ms'));
  const { sha256: contentSha256, probe, durationMs: fileMs, readable } = measureRecording(req.body, container);
  // The file's own length when it gives one (WebM, Ogg, an MP4 that states it); the page's
  // otherwise (Safari's fragmented MP4, or a file that could not be read).
  const durationMs = fileMs ?? clientDurationMs;
  // The voice is still the page's measure (nothing is decoded here), never longer than the
  // take, and none at all in a take of digital silence (a muted microphone, zeros).
  const voicedMs = probe?.digitalSilence ? 0 : Math.min(clientVoicedMs, durationMs);
  const flags = new Set<SpeakingFlag>();
  // Two silent takes can hold the same packets without being copies: they are never matched.
  const matchable = !probe?.digitalSilence;
  if (matchable && contentSha256 === await modelFingerprint(task.modelAudioUrl)) flags.add('model');
  if (fileMs !== null && isLengthMismatch(clientDurationMs, fileMs)) flags.add('length-mismatch');
  if (isLittleSpeech(voicedMs, durationMs)) flags.add('little-speech');
  // Only a file that could not be read as its container: Safari's MP4 reads, and just states no length.
  if (!readable) flags.add('unmeasured');
  const micSettings = micSettingsFrom(req.get('x-mic-settings'));

  let audioUrl: string | null = null;
  try {
    audioUrl = await writeRecording(req.body, ext);
    const recordingUrl = audioUrl;
    // The cap is checked again with the insert: other recordings may have
    // landed while this one was being written to disk.
    const { submissionId, stored: storedFlags } = db.transaction((tx) => {
      const stored = countFor(tx);
      if (stored >= MAX_SPEAKING_ATTEMPTS) throw new AttemptCapReached(stored);
      // Looked up with the insert, so two copies sent at once still find each other.
      // An honest page never sends the same audio twice: a retry reuses its key.
      const earlier = matchable
        ? tx.select({ userId: schema.speakingSubmissions.userId })
          .from(schema.speakingSubmissions)
          .where(eq(schema.speakingSubmissions.contentSha256, contentSha256))
          .all()
        : [];
      if (earlier.some((row) => row.userId === currentUser.id)) flags.add('same-file');
      if (earlier.some((row) => row.userId !== currentUser.id)) flags.add('copied');
      const decided = SPEAKING_FLAGS.filter((flag) => flags.has(flag));
      const [row] = tx.insert(schema.speakingSubmissions).values({
        taskId,
        userId: currentUser.id,
        clientKey,
        audioUrl: recordingUrl,
        mimeType,
        sizeBytes: req.body.length,
        durationMs,
        voicedMs,
        // What the grader compares against, as the task read when this was recorded.
        referenceText: task.referenceText,
        submittedAt: new Date(),
        contentSha256,
        clientDurationMs,
        clientVoicedMs,
        // '[]' when checked and nothing found; NULL is a take from before the checks (0040).
        flags: JSON.stringify(decided),
        micSettings,
      }).returning({ id: schema.speakingSubmissions.id }).all();
      return { submissionId: row.id, stored: decided };
    });
    logger.info({
      event: 'speaking.submission_received',
      taskId, userId: currentUser.id, submissionId, bytes: req.body.length, durationMs, voicedMs,
      clientDurationMs, clientVoicedMs, flags: storedFlags, container, measured: fileMs !== null,
    }, 'Speaking submission received');
    res.json({ success: true, submissionId });
  } catch (err) {
    // Never leave a student's voice on disk with no row pointing at it.
    if (audioUrl) await deleteRecordings([audioUrl]);
    const unique = sqliteCode(err) === 'SQLITE_CONSTRAINT_UNIQUE';
    if (unique || err instanceof AttemptCapReached) {
      // Another copy of this upload may have landed while this one was being
      // written: then it is a retry — even if that copy was the last attempt
      // the cap allows, or was sent for another task.
      const winner = await submissionByKey(currentUser.id, clientKey);
      if (winner) { answerDuplicate(res, winner, taskId); return; }
    }
    if (err instanceof AttemptCapReached) { res.status(429).json({ error: tooManyAttempts(err.stored) }); return; }
    if (unique) {
      // Two copies of the same retry raced; the other one was kept.
      res.json({ success: true, duplicate: true });
      return;
    }
    logger.error({ err, taskId }, 'Speaking submission failed');
    res.status(500).json({ error: 'Submission failed' });
  }
}

/** A recording, for the student who made it or an admin. Never cached. */
export async function handleRecording(req: Request, res: Response) {
  const currentUser = req.user as AuthenticatedUser | undefined;
  if (!currentUser) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const filename = String(req.params.filename);
  const path = recordingPathForFilename(filename);
  if (!path) { res.status(404).end(); return; }

  const submission = await db.query.speakingSubmissions.findFirst({
    where: eq(schema.speakingSubmissions.audioUrl, recordingUrlForFilename(filename)),
    columns: { userId: true, mimeType: true },
  });
  if (!submission || (currentUser.role !== 'admin' && submission.userId !== currentUser.id)) {
    res.status(404).end();
    return;
  }

  res.sendFile(path, {
    cacheControl: false,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': submission.mimeType,
    },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}
