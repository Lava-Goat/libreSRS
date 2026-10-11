// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeAll, describe, expect, it } from 'vitest';
import { patchWebmDuration, withWebmDuration } from './recording';

// ---------------------------------------------------------------------------
// WebM
// ---------------------------------------------------------------------------

const bytes = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
const TIMECODE_SCALE_1MS = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const MUXING_APP = [0x4d, 0x80, 0x84, 0x54, 0x65, 0x73, 0x74];
const TRACKS = [0x16, 0x54, 0xae, 0x6b, 0x82, 0xaa, 0xbb];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN_SIZE, 0xe7, 0x81, 0x00, 0xa3, 0x83, 0x81, 0x00, 0x00];

function info(...children: number[][]): number[] {
  const content = children.flat();
  return [0x15, 0x49, 0xa9, 0x66, 0x80 | content.length, ...content];
}

function recorderWebm(infoBytes = info(TIMECODE_SCALE_1MS, MUXING_APP), segmentSize = UNKNOWN_SIZE): Uint8Array {
  return bytes(EBML_HEADER, [0x18, 0x53, 0x80, 0x67], segmentSize, infoBytes, TRACKS, CLUSTER);
}

/** Reads the Duration back out of a patched file by walking it, as a player would. */
function readDuration(file: Uint8Array): number | null {
  let pos = EBML_HEADER.length + 4;
  const sizeLen = 8;
  pos += sizeLen;
  // Info
  if (file[pos] !== 0x15) return null;
  pos += 4;
  const first = file[pos];
  let len = 1;
  for (let m = 0x80; !(first & m); m >>= 1) len++;
  let size = first & ((0x80 >> (len - 1)) - 1);
  for (let i = 1; i < len; i++) size = size * 256 + file[pos + i];
  const start = pos + len;
  for (let p = start; p < start + size;) {
    const id = (file[p] << 8) | file[p + 1];
    const idLen = file[p] >= 0x80 ? 1 : file[p] >= 0x40 ? 2 : 3;
    const s = file[p + idLen] & 0x7f;
    if (idLen === 2 && id === 0x4489) return new DataView(file.buffer, file.byteOffset + p + 3, 8).getFloat64(0, false);
    p += idLen + 1 + s;
  }
  return null;
}

describe('patchWebmDuration', () => {
  it('writes the duration into Info and leaves everything after it byte-for-byte', () => {
    const file = recorderWebm();
    const patched = patchWebmDuration(file, 723_456)!;
    expect(patched).not.toBeNull();

    const out = bytes(patched.bytes, file.subarray(patched.consumed));
    expect(readDuration(out)).toBe(723_456);
    expect(Array.from(out.subarray(out.length - TRACKS.length - CLUSTER.length))).toEqual([...TRACKS, ...CLUSTER]);
    expect(Array.from(out.subarray(0, EBML_HEADER.length + 12))).toEqual(Array.from(file.subarray(0, EBML_HEADER.length + 12)));
  });

  it('scales by the file’s own timecode scale', () => {
    const tenMs = [0x2a, 0xd7, 0xb1, 0x83, 0x98, 0x96, 0x80]; // 10,000,000 ns
    const patched = patchWebmDuration(recorderWebm(info(tenMs, MUXING_APP)), 5000)!;
    const out = bytes(patched.bytes);
    expect(readDuration(out)).toBe(500);
  });

  it('grows a known segment size by exactly what Info grew', () => {
    const tail = TRACKS.length + CLUSTER.length;
    const infoLen = info(TIMECODE_SCALE_1MS, MUXING_APP).length;
    const known = [0x01, 0, 0, 0, 0, 0, 0, infoLen + tail];
    const file = recorderWebm(undefined, known);
    const patched = patchWebmDuration(file, 1000)!;
    const out = bytes(patched.bytes, file.subarray(patched.consumed));

    const sizeAt = EBML_HEADER.length + 4;
    const newSize = new DataView(out.buffer, out.byteOffset + sizeAt + 1, 7);
    let value = 0;
    for (let i = 0; i < 7; i++) value = value * 256 + newSize.getUint8(i);
    expect(value).toBe(out.length - sizeAt - 8);
  });

  it('leaves a file that already has a duration alone', () => {
    const duration = [0x44, 0x89, 0x88, 0x40, 0x8f, 0x40, 0, 0, 0, 0, 0];
    expect(patchWebmDuration(recorderWebm(info(TIMECODE_SCALE_1MS, duration)), 5000)).toBeNull();
  });

  /** Where a Duration element's value starts. */
  const durationValueAt = (file: Uint8Array) => file.findIndex((b, i) => b === 0x44 && file[i + 1] === 0x89) + 3;

  it('fills in the Duration of 0 that Firefox writes, where it stands', () => {
    const zero = [0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0];
    const file = recorderWebm(info(TIMECODE_SCALE_1MS, zero, MUXING_APP));
    const patched = patchWebmDuration(file, 5000)!;
    expect(patched).not.toBeNull();
    const out = bytes(patched.bytes, file.subarray(patched.consumed));
    expect(readDuration(out)).toBe(5000);
    // Only the value's eight bytes change.
    const at = durationValueAt(file);
    expect(Array.from(out.subarray(0, at))).toEqual(Array.from(file.subarray(0, at)));
    expect(Array.from(out.subarray(at + 8))).toEqual(Array.from(file.subarray(at + 8)));
  });

  it('fills in a four-byte Duration of 0 as a four-byte float, scaled by a timecode scale that follows it', () => {
    const zero = [0x44, 0x89, 0x84, 0, 0, 0, 0];
    const tenMs = [0x2a, 0xd7, 0xb1, 0x83, 0x98, 0x96, 0x80]; // 10,000,000 ns
    const file = recorderWebm(info(zero, tenMs));
    const patched = patchWebmDuration(file, 1500)!;
    const out = bytes(patched.bytes, file.subarray(patched.consumed));
    expect(out.length).toBe(file.length);
    expect(new DataView(out.buffer, out.byteOffset + durationValueAt(out), 4).getFloat32(0, false)).toBe(150);
  });

  it('refuses anything it does not recognise instead of guessing', () => {
    expect(patchWebmDuration(new Uint8Array([0, 1, 2, 3]), 1000)).toBeNull();
    expect(patchWebmDuration(recorderWebm().subarray(0, 20), 1000)).toBeNull();
    expect(patchWebmDuration(recorderWebm(), 0)).toBeNull();
    // Info after Tracks is not how MediaRecorder writes; don't touch it.
    const swapped = bytes(EBML_HEADER, [0x18, 0x53, 0x80, 0x67], UNKNOWN_SIZE, TRACKS, info(TIMECODE_SCALE_1MS), CLUSTER);
    expect(patchWebmDuration(swapped, 1000)).toBeNull();
  });
});

describe('withWebmDuration', () => {
  beforeAll(() => {
    // jsdom's Blob predates arrayBuffer(); browsers have it. Without this the
    // function under test takes its fallback path and the test proves nothing.
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      };
    }
  });

  it('returns a patched blob for WebM and the same blob for anything else', async () => {
    const webm = new Blob([recorderWebm() as BlobPart], { type: 'audio/webm;codecs=opus' });
    const fixed = await withWebmDuration(webm, 42_000);
    expect(fixed.type).toBe('audio/webm;codecs=opus');
    expect(readDuration(new Uint8Array(await fixed.arrayBuffer()))).toBe(42_000);

    const mp4 = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });
    expect(await withWebmDuration(mp4, 42_000)).toBe(mp4);
  });

  it('sends a malformed recording exactly as recorded', async () => {
    const odd = new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/webm' });
    expect(await withWebmDuration(odd, 42_000)).toBe(odd);
  });
});
