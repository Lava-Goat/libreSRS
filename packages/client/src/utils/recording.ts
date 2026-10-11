// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** Recording a student in the browser: picking a format, and repairing what MediaRecorder writes. */
import { readId, readSize, readUint } from '@libresrs/shared';

/**
 * The first recording format this browser can produce: Opus in WebM on
 * Chrome, Edge and Firefox; AAC in MP4 on Safari, including iPhones.
 */
export function pickRecordingMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

// ---------------------------------------------------------------------------
// WebM duration
//
// Chrome's MediaRecorder streams WebM without a Duration element, so the file
// reports an infinite length and players cannot seek in it — no good to a
// teacher, or a grader, working through a student's recitation. Firefox writes
// a Duration of 0 when it starts and never comes back to it. This writes the
// duration into the file's Info section before upload. Anything unexpected
// and the recording is sent exactly as recorded.
//
// The server never believes this Duration: it measures the file's own audio
// blocks (server/services/recordingProbe.ts), with the same EBML reader.
// ---------------------------------------------------------------------------

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const DURATION_ID = 0x4489;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const TRACKS_ID = 0x1654ae6b;
const CLUSTER_ID = 0x1f43b675;

function encodeSize8(size: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let rest = size;
  for (let i = 7; i >= 1; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/**
 * Given the first bytes of a WebM file, returns replacement bytes for
 * `head.subarray(0, consumed)` with a Duration added, or a Duration of 0
 * filled in where it stands — or null if the file already has a duration or
 * is not laid out the way MediaRecorder writes it.
 */
export function patchWebmDuration(head: Uint8Array, durationMs: number): { bytes: Uint8Array; consumed: number } | null {
  if (!(durationMs > 0)) return null;

  const ebml = readId(head, 0);
  if (!ebml || ebml.id !== EBML_ID) return null;
  const ebmlSize = readSize(head, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  const segmentStart = ebml.length + ebmlSize.length + ebmlSize.size;

  const segment = readId(head, segmentStart);
  if (!segment || segment.id !== SEGMENT_ID) return null;
  const segmentSizePos = segmentStart + segment.length;
  const segmentSize = readSize(head, segmentSizePos);
  if (!segmentSize) return null;

  let pos = segmentSizePos + segmentSize.length;
  while (pos < head.length) {
    const child = readId(head, pos);
    if (!child || child.id === TRACKS_ID || child.id === CLUSTER_ID) return null;
    const childSize = readSize(head, pos + child.length);
    if (!childSize || childSize.unknown) return null;
    const contentStart = pos + child.length + childSize.length;
    const contentEnd = contentStart + childSize.size;
    if (contentEnd > head.length) return null;

    if (child.id !== INFO_ID) {
      pos = contentEnd;
      continue;
    }

    let timecodeScale = 1_000_000;
    let existing: { at: number; size: number } | null = null;
    for (let p = contentStart; p < contentEnd;) {
      const inner = readId(head, p);
      const innerSize = inner && readSize(head, p + inner.length);
      if (!inner || !innerSize || innerSize.unknown) return null;
      const innerContent = p + inner.length + innerSize.length;
      if (inner.id === DURATION_ID) existing = { at: innerContent, size: innerSize.size };
      if (inner.id === TIMECODE_SCALE_ID && innerSize.size >= 1 && innerSize.size <= 8) {
        timecodeScale = readUint(head, innerContent, innerSize.size) || 1_000_000;
      }
      p = innerContent + innerSize.size;
    }
    const value = (durationMs * 1_000_000) / timecodeScale;

    if (existing) {
      // A float of 4 or 8 bytes, overwritten in place: nothing else in the file moves.
      if (existing.size !== 4 && existing.size !== 8) return null;
      const read = new DataView(head.buffer, head.byteOffset + existing.at, existing.size);
      const current = existing.size === 8 ? read.getFloat64(0, false) : read.getFloat32(0, false);
      if (Number.isFinite(current) && current > 0) return null;
      const bytes = head.slice(0, contentEnd);
      const write = new DataView(bytes.buffer, existing.at, existing.size);
      if (existing.size === 8) write.setFloat64(0, value, false);
      else write.setFloat32(0, value, false);
      return { bytes, consumed: contentEnd };
    }

    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]);
    new DataView(duration.buffer).setFloat64(3, value, false);

    const infoContent = head.subarray(contentStart, contentEnd);
    const newInfo = concat([head.subarray(pos, pos + child.length), encodeSize8(infoContent.length + duration.length), infoContent, duration]);
    const growth = newInfo.length - (contentEnd - pos);

    const segmentSizeBytes = segmentSize.unknown
      ? head.subarray(segmentSizePos, segmentSizePos + segmentSize.length)
      : encodeSize8(segmentSize.size + growth);

    return {
      bytes: concat([
        head.subarray(0, segmentSizePos),
        segmentSizeBytes,
        head.subarray(segmentSizePos + segmentSize.length, pos),
        newInfo,
      ]),
      consumed: contentEnd,
    };
  }
  return null;
}

/** The recording with its duration written in, or the recording untouched. */
export async function withWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm')) return blob;
  try {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer());
    const patched = patchWebmDuration(head, durationMs);
    if (!patched) return blob;
    return new Blob([patched.bytes as BlobPart, blob.slice(patched.consumed)], { type: blob.type });
  } catch {
    return blob;
  }
}
