// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Reading EBML, what WebM files are made of: each element is an ID, a size
 * and its content, and the ID and the size are both variable-length integers
 * whose first byte says how many bytes they take.
 *
 * Shared by the page, which writes a recording's Duration before upload
 * (client/utils/recording.ts), and the server, which reads a recording's real
 * length and audio (server/services/recordingProbe.ts). Each returns null for
 * bytes that are not a valid integer or run past the end, never throws.
 */

/** An element ID at `pos`, marker bits kept (0x1A45DFA3, as the spec writes IDs), or null. */
export function readId(bytes: Uint8Array, pos: number): { id: number; length: number } | null {
  const first = bytes[pos];
  if (!first) return null;
  let length = 1;
  for (let mask = 0x80; !(first & mask); mask >>= 1) length++;
  if (length > 4 || pos + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + bytes[pos + i];
  return { id, length };
}

/**
 * An element size at `pos`, marker bits removed, or null. `unknown` is true
 * when every value bit is set: the size of a Segment or Cluster that a live
 * recorder (Chrome's MediaRecorder) started before it knew how long it would be.
 */
export function readSize(bytes: Uint8Array, pos: number): { size: number; length: number; unknown: boolean } | null {
  const first = bytes[pos];
  if (!first) return null;
  let length = 1;
  let mask = 0x80;
  for (; !(first & mask); mask >>= 1) length++;
  if (length > 8 || pos + length > bytes.length) return null;
  let size = first & (mask - 1);
  let unknown = size === mask - 1;
  for (let i = 1; i < length; i++) {
    size = size * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) unknown = false;
  }
  return { size, length, unknown };
}

/** A big-endian unsigned integer of `length` bytes at `pos` (an EBML uint element's content). */
export function readUint(bytes: Uint8Array, pos: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[pos + i];
  return value;
}
