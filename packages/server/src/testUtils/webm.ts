// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * WebM files for tests, laid out the way Chrome's MediaRecorder writes them
 * (a Segment and Clusters of unknown size, one Opus packet a SimpleBlock),
 * with the knobs a test needs to fake one: timestamps, BlockGroups, a second
 * track, a Duration. The recordings Chromium really made are beside this file
 * in recordings/.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/** A recording from Chromium's fake microphone (its beep), 3001 ms by the page's clock. */
export const CHROMIUM_TAKE_PAGE_MS = 3001;
/** The v1.15 simulation's silent take (every packet digital silence), 31082 ms by its page. */
export const SILENT_TAKE_PAGE_MS = 31_082;

/**
 * The recordings beside this file. Besides the two WebMs Chromium made:
 * - chromium-fake-mic-3s.ogg: that take's own Opus packets, remuxed into Ogg by
 *   ffmpeg 8.1 (`-c:a copy -f ogg`), as Firefox can record;
 * - ffmpeg-aac-fragmented-3s.m4a: the take as AAC in a fragmented MP4 whose
 *   movie header states no length (`-movflags +empty_moov+frag_keyframe`), the
 *   way Safari records;
 * - ffmpeg-aac-3s.m4a: the same as a plain MP4, whose movie header states 3 s.
 */
export type RecordingFixture =
  | 'chromium-fake-mic-3s.webm'
  | 'silent-31s.webm'
  | 'chromium-fake-mic-3s.ogg'
  | 'ffmpeg-aac-fragmented-3s.m4a'
  | 'ffmpeg-aac-3s.m4a';

export function recordingFixture(name: RecordingFixture): Buffer {
  return readFileSync(fileURLToPath(new URL(`./recordings/${name}`, import.meta.url)));
}

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256);
  return out;
}

function size8(size: number): number[] {
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(size / 256 ** i) % 256);
  return out;
}

/** An element: its ID, an 8-byte size (or the unknown size), its content. */
export function element(id: number, content: ArrayLike<number>, unknownSize = false): number[] {
  return [...idBytes(id), ...(unknownSize ? UNKNOWN : size8(content.length)), ...Array.from(content)];
}

export function uintElement(id: number, value: number): number[] {
  const bytes = value === 0 ? [0] : idBytes(value);
  return element(id, bytes);
}

/**
 * An Opus packet that plays 60 ms, as Chrome writes them: CELT fullband,
 * three 20 ms frames (TOC 0xFB, count 3). `size` is its length in bytes, and
 * `seed` varies its content, so two takes can differ.
 */
export function opusPacket(size = 120, seed = 1): number[] {
  const out = [0xfb, 0x03];
  for (let i = 2; i < size; i++) out.push((i * 31 + seed * 17) % 251);
  return out.slice(0, size);
}

export interface TestBlock {
  timeMs: number;
  packet: number[];
  /** 1 is the Opus track. */
  track?: number;
  /** In a BlockGroup's Block instead of a SimpleBlock. */
  group?: boolean;
}

export interface TestWebmOptions {
  blocks: TestBlock[];
  /** A Duration in Info, in ms, as the page writes one before upload. */
  durationMs?: number;
  /** Clusters with a size, as a file rewritten by a tool has, instead of a live recorder's unknown size. */
  sizedClusters?: boolean;
  /** Track 2, a video track, is declared too. */
  videoTrack?: boolean;
  codec?: string;
}

/** A WebM with these blocks, a Cluster per started second. */
export function testWebm(options: TestWebmOptions): Buffer {
  const header = element(0x1a45dfa3, [
    ...uintElement(0x4286, 1),
    ...element(0x4282, Array.from(Buffer.from('webm'))),
  ]);
  const infoFields = [...uintElement(0x2ad7b1, 1_000_000), ...element(0x4d80, Array.from(Buffer.from('test')))];
  if (options.durationMs !== undefined) {
    const duration = Buffer.alloc(8);
    duration.writeDoubleBE(options.durationMs);
    infoFields.push(...element(0x4489, Array.from(duration)));
  }
  const tracks = element(0x1654ae6b, [
    ...element(0xae, [...uintElement(0xd7, 1), ...uintElement(0x83, 2), ...element(0x86, Array.from(Buffer.from(options.codec ?? 'A_OPUS')))]),
    ...(options.videoTrack
      ? element(0xae, [...uintElement(0xd7, 2), ...uintElement(0x83, 1), ...element(0x86, Array.from(Buffer.from('V_VP8')))])
      : []),
  ]);

  const clusters = new Map<number, number[]>();
  for (const block of options.blocks) {
    const clusterMs = Math.floor(block.timeMs / 1000) * 1000;
    const rel = block.timeMs - clusterMs;
    const body = [0x80 | (block.track ?? 1), (rel >> 8) & 0xff, rel & 0xff, 0x80, ...block.packet];
    const bytes = block.group ? element(0xa0, element(0xa1, body)) : element(0xa3, body);
    clusters.set(clusterMs, [...(clusters.get(clusterMs) ?? []), ...bytes]);
  }
  const clusterBytes = [...clusters.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([ms, blocks]) => element(0x1f43b675, [...uintElement(0xe7, ms), ...blocks], !options.sizedClusters));

  return Buffer.from([
    ...header,
    ...element(0x18538067, [...element(0x1549a966, infoFields), ...tracks, ...clusterBytes], true),
  ]);
}

/** `count` blocks of 60 ms, back to back from 0: a take of count × 60 ms. */
export function steadyBlocks(count: number, packetSize = 120, seed = 1): TestBlock[] {
  return Array.from({ length: count }, (_, i) => ({ timeMs: i * 60, packet: opusPacket(packetSize, seed + i) }));
}

/** The file with its Info Duration (an 8-byte float) set to `ms`, the way a page could fake it. */
export function withFakedDuration(file: Buffer, ms: number): Buffer {
  const out = Buffer.from(file);
  const at = out.indexOf(Buffer.from([0x44, 0x89, 0x88]));
  if (at < 0) throw new Error('no 8-byte Duration in this file');
  out.writeDoubleBE(ms, at + 3);
  return out;
}
