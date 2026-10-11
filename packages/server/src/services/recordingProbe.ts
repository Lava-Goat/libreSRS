// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What a student's recording really holds, read from the file itself (v1.16.0).
 *
 * Before, the server stored the length and voice the page claimed in request
 * headers, and caught a repeat only by the page's per-take key: a console
 * could claim 45 s for a 3 s file, or post an old take again under a new key.
 *
 * A WebM (every Chromebook; Chrome, Edge and Firefox anywhere) is read here,
 * with no decoding: its audio blocks give the real length, a fingerprint of
 * the audio, and how much of it is digital silence. The Duration the page
 * writes into the file (client/utils/recording.ts) is never read, since the
 * page wrote it. An Ogg (Opus) is read the same way, from its pages.
 *
 * An MP4 (Safari) is only walked in v1: its boxes must run from the first
 * byte to the last, and its movie header gives the length when it states one.
 * A fragmented MP4, as Safari records, may state none and then keeps the
 * page's number; every MP4 keeps the whole-file fingerprint.
 *
 * Which of these a take is comes from its bytes (sniffContainer), never from
 * the type it was sent as: a WebM sent as audio/ogg is still read as a WebM,
 * and a body that is none of the three (an mp3 model sent as audio/mp4, say)
 * is refused rather than skipping every check here with the page's numbers.
 */
import { createHash } from 'crypto';
import { readId, readSize, readUint } from '@libresrs/shared';

/**
 * The most elements, boxes, pages and packets one read goes through before
 * it gives up (the take is then stored 'unmeasured', with the page's numbers).
 * An honest 15-minute MediaRecorder take is about 45k blocks of 20 ms, some
 * 90k steps; even 2.5 ms frames would be about 720k. Without a bound, 48 MB of
 * tiny crafted blocks held the event loop for 1–2 s per upload.
 */
export const MAX_PROBE_STEPS = 1_000_000;

/** One read's work so far, against MAX_PROBE_STEPS. */
class StepBudget {
  private steps = 0;
  /** Takes a step; true once the budget is spent, and from then on. */
  step(): boolean {
    this.steps += 1;
    return this.spent;
  }
  get spent(): boolean {
    return this.steps > MAX_PROBE_STEPS;
  }
}

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const SEEK_HEAD_ID = 0x114d9b74;
const INFO_ID = 0x1549a966;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_NUMBER_ID = 0xd7;
const CODEC_ID_ID = 0x86;
const CLUSTER_ID = 0x1f43b675;
const TIMECODE_ID = 0xe7;
const SIMPLE_BLOCK_ID = 0xa3;
const BLOCK_GROUP_ID = 0xa0;
const BLOCK_ID = 0xa1;
const CUES_ID = 0x1c53bb6b;
const TAGS_ID = 0x1254c367;
const CHAPTERS_ID = 0x1043a770;
const ATTACHMENTS_ID = 0x1941a469;

/** Longer than any codec ID (Matroska's are short names such as "A_OPUS"). */
const MAX_CODEC_ID_BYTES = 32;

/** What can follow a Cluster in a Segment: where a Cluster of unknown size (a live recorder's) ends. */
const SEGMENT_CHILDREN = new Set([SEEK_HEAD_ID, INFO_ID, TRACKS_ID, CLUSTER_ID, CUES_ID, TAGS_ID, CHAPTERS_ID, ATTACHMENTS_ID]);

/**
 * An Opus packet this small holds no sound: what a muted microphone, or a
 * take of zeros, encodes to (8 bytes a packet in the sim's silent take).
 * Room noise even at −80 dBFS comes out around 870 bytes at 128 kbps, so a
 * real microphone never gets here.
 */
export const SILENT_PACKET_BYTES = 12;
/** A take with at least this share of silent packets is digital silence: no voice, and never matched as a copy. */
export const DIGITAL_SILENCE_SHARE = 0.9;

export interface RecordingProbe {
  /** The audio's real length in ms: the blocks' time span, never more than their packets add up to. */
  durationMs: number;
  /** SHA-256 (hex) of the audio track's Opus packets in order: the same for a copy with other bytes around them. */
  payloadSha256: string;
  packets: number;
  /** Packets of SILENT_PACKET_BYTES or fewer. */
  silentPackets: number;
  /** At least DIGITAL_SILENCE_SHARE of the packets are silent. */
  digitalSilence: boolean;
}

/** An element's ID and where its content lies; `end` may run past what was read (the caller decides). */
interface Element {
  id: number;
  start: number;
  end: number;
  unknown: boolean;
}

function readElement(bytes: Uint8Array, pos: number, limit: number): Element | null {
  const id = readId(bytes, pos);
  if (!id) return null;
  const size = readSize(bytes, pos + id.length);
  if (!size) return null;
  const start = pos + id.length + size.length;
  if (start > limit) return null;
  return { id: id.id, start, end: size.unknown ? limit : start + size.size, unknown: size.unknown };
}

/**
 * How long an Opus packet plays, in ms, from its first (TOC) byte (RFC 6716
 * §3.1): the frame size its configuration gives, times the frames in it.
 */
export function opusPacketMs(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config & 3]
    : config < 16 ? [10, 20][config & 1]
      : [2.5, 5, 10, 20][config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet.length > 1 ? packet[1] & 0x3f : 0) : 2;
  // A packet never holds more than 120 ms.
  return Math.min(120, frameMs * frames);
}

/**
 * The frames (Opus packets) in a block's data, as [from, to) offsets, or null
 * when the lacing does not add up. MediaRecorder writes one packet a block;
 * the three lacings are read too, so a re-muxed file is not "unreadable".
 */
function blockFrames(bytes: Uint8Array, start: number, end: number, flags: number): [number, number][] | null {
  const lacing = (flags >> 1) & 3;
  if (lacing === 0) return start < end ? [[start, end]] : null;
  if (start >= end) return null;
  const count = bytes[start] + 1;
  let pos = start + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph: each size but the last as a run of 255s and a final byte under 255.
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      for (;;) {
        if (pos >= end) return null;
        const byte = bytes[pos++];
        size += byte;
        if (byte !== 255) break;
      }
      sizes.push(size);
    }
  } else if (lacing === 3) {
    // EBML: the first size, then each next one as a signed difference.
    let size = 0;
    for (let i = 0; i < count - 1; i++) {
      const raw = readSize(bytes, pos);
      if (!raw || pos + raw.length > end) return null;
      pos += raw.length;
      size = i === 0 ? raw.size : size + raw.size - (2 ** (7 * raw.length - 1) - 1);
      if (size < 0) return null;
      sizes.push(size);
    }
  } else {
    // Fixed: equal parts.
    if ((end - pos) % count !== 0) return null;
    for (let i = 0; i < count - 1; i++) sizes.push((end - pos) / count);
  }
  const last = end - pos - sizes.reduce((sum, size) => sum + size, 0);
  if (last < 0) return null;
  sizes.push(last);
  const frames: [number, number][] = [];
  for (const size of sizes) {
    frames.push([pos, pos + size]);
    pos += size;
  }
  return frames;
}

/**
 * Reads a WebM's audio, or returns null when the bytes are not a WebM with an
 * Opus track and at least one audio block. Reading stops quietly at the first
 * element that is cut short or is not EBML, keeping the blocks before it: a
 * byte added to the end of a take changes neither its length nor its
 * fingerprint, and a file cut short measures as long as the audio it still has.
 * A file that needs more than MAX_PROBE_STEPS elements and packets is not
 * read at all (null), so it is stored 'unmeasured'.
 */
export function probeWebm(bytes: Uint8Array): RecordingProbe | null {
  const header = readElement(bytes, 0, bytes.length);
  if (!header || header.id !== EBML_ID || header.unknown || header.end > bytes.length) return null;
  const segment = readElement(bytes, header.end, bytes.length);
  if (!segment || segment.id !== SEGMENT_ID) return null;
  const segmentEnd = Math.min(bytes.length, segment.end);

  // Every loop below takes a step per element or packet; once over the budget each one stops.
  const budget = new StepBudget();
  const step = () => budget.step();

  let tickMs = 1;
  let opusTrack: number | null = null;
  const hash = createHash('sha256');
  let packets = 0;
  let silentPackets = 0;
  let packetMs = 0;
  let firstMs = Number.POSITIVE_INFINITY;
  let lastEndMs = Number.NEGATIVE_INFINITY;

  const readBlock = (start: number, end: number, clusterTime: number) => {
    const track = readSize(bytes, start);
    if (!track || track.unknown || opusTrack === null || track.size !== opusTrack) return;
    const headerEnd = start + track.length + 3;
    if (headerEnd > end) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start + track.length, 2);
    const timeMs = (clusterTime + view.getInt16(0, false)) * tickMs;
    const frames = blockFrames(bytes, headerEnd, end, bytes[headerEnd - 1]);
    if (!frames) return;
    let blockMs = 0;
    for (const [from, to] of frames) {
      if (step()) return;
      const packet = bytes.subarray(from, to);
      hash.update(packet);
      packets += 1;
      if (packet.length <= SILENT_PACKET_BYTES) silentPackets += 1;
      blockMs += opusPacketMs(packet);
    }
    packetMs += blockMs;
    firstMs = Math.min(firstMs, timeMs);
    lastEndMs = Math.max(lastEndMs, timeMs + blockMs);
  };

  const readTracks = (start: number, end: number) => {
    for (let pos = start; pos < end;) {
      if (step()) return;
      const entry = readElement(bytes, pos, end);
      if (!entry || entry.unknown || entry.end > end) return;
      if (entry.id === TRACK_ENTRY_ID) {
        let number: number | null = null;
        let codec = '';
        for (let p = entry.start; p < entry.end;) {
          if (step()) return;
          const field = readElement(bytes, p, entry.end);
          if (!field || field.unknown || field.end > entry.end) break;
          if (field.id === TRACK_NUMBER_ID && field.end - field.start <= 6) number = readUint(bytes, field.start, field.end - field.start);
          // A codec ID is a few letters ("A_OPUS"): a longer one is not Opus, and is never copied out.
          if (field.id === CODEC_ID_ID) codec = field.end - field.start <= MAX_CODEC_ID_BYTES ? Buffer.from(bytes.subarray(field.start, field.end)).toString('latin1') : '';
          p = field.end;
        }
        if (opusTrack === null && number !== null && codec === 'A_OPUS') opusTrack = number;
      }
      pos = entry.end;
    }
  };

  /** Reads a Cluster; returns where reading goes on, or null to stop (cut short, or not EBML). */
  const readCluster = (cluster: Element): number | null => {
    const end = Math.min(cluster.end, segmentEnd);
    let clusterTime = 0;
    for (let pos = cluster.start; pos < end;) {
      if (step()) return null;
      const child = readElement(bytes, pos, end);
      if (!child) return null;
      // A live recorder's Cluster has no size: it ends where the next Cluster (or Cues) starts.
      if (cluster.unknown && SEGMENT_CHILDREN.has(child.id)) return pos;
      if (child.unknown || child.end > end) return null;
      if (child.id === TIMECODE_ID && child.end - child.start <= 8) clusterTime = readUint(bytes, child.start, child.end - child.start);
      else if (child.id === SIMPLE_BLOCK_ID) readBlock(child.start, child.end, clusterTime);
      else if (child.id === BLOCK_GROUP_ID) {
        for (let p = child.start; p < child.end;) {
          if (step()) return null;
          const inner = readElement(bytes, p, child.end);
          if (!inner || inner.unknown || inner.end > child.end) break;
          if (inner.id === BLOCK_ID) readBlock(inner.start, inner.end, clusterTime);
          p = inner.end;
        }
      }
      pos = child.end;
    }
    return end;
  };

  for (let pos = segment.start; pos < segmentEnd;) {
    if (step()) break;
    const element = readElement(bytes, pos, segmentEnd);
    if (!element) break;
    if (element.id === CLUSTER_ID) {
      const next = readCluster(element);
      if (next === null) break;
      pos = next;
      continue;
    }
    if (element.unknown || element.end > segmentEnd) break;
    if (element.id === INFO_ID) {
      for (let p = element.start; p < element.end;) {
        if (step()) break;
        const field = readElement(bytes, p, element.end);
        if (!field || field.unknown || field.end > element.end) break;
        if (field.id === TIMECODE_SCALE_ID && field.end - field.start <= 8) {
          // Nanoseconds a tick; 0 is not a scale, so the default (1 ms) stands.
          const scale = readUint(bytes, field.start, field.end - field.start);
          if (scale > 0) tickMs = scale / 1_000_000;
        }
        p = field.end;
      }
    } else if (element.id === TRACKS_ID) {
      readTracks(element.start, element.end);
    }
    pos = element.end;
  }

  if (packets === 0 || budget.spent) return null;
  // Rewritten timestamps could stretch the span; the packets say how much audio there is.
  const spanMs = lastEndMs - Math.min(firstMs, 0);
  return {
    durationMs: Math.max(0, Math.round(Math.min(spanMs, packetMs))),
    payloadSha256: hash.digest('hex'),
    packets,
    silentPackets,
    digitalSilence: silentPackets >= DIGITAL_SILENCE_SHARE * packets,
  };
}

/** SHA-256 (hex) of the whole file: the fingerprint of an upload the probe cannot read. */
export function fileSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The containers the page's recorder writes (client/utils/recording.ts pickRecordingMimeType). */
export type RecordingContainer = 'webm' | 'ogg' | 'mp4';

/** An Ogg page's fixed header, before its segment table (RFC 3533 §6). */
const OGG_PAGE_HEADER_BYTES = 27;

function hasAscii(bytes: Uint8Array, pos: number, text: string): boolean {
  if (pos + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[pos + i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * The container the bytes begin as, whatever type they were sent as: an EBML
 * header (WebM), the first page of an Ogg stream (version 0, "beginning of
 * stream"), or an MP4's ftyp box that fits in the file. Null for anything
 * else, which never came from the recorder: an mp3 (an ID3 tag or a frame
 * sync), a wav (RIFF), text. The readers below then check the rest.
 */
export function sniffContainer(bytes: Uint8Array): RecordingContainer | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (hasAscii(bytes, 0, 'OggS') && bytes.length >= OGG_PAGE_HEADER_BYTES && bytes[4] === 0 && (bytes[5] & 0x02)) return 'ogg';
  if (hasAscii(bytes, 4, 'ftyp')) {
    const size = readUint(bytes, 0, 4);
    if (size >= 8 && size <= bytes.length) return 'mp4';
  }
  return null;
}

/** Ogg Opus counts granule positions in 48 kHz samples, whatever rate was recorded (RFC 7845 §4). */
const OPUS_SAMPLES_PER_MS = 48;

/**
 * Reads an Ogg Opus recording, or returns null when the bytes are not one: the
 * pages must follow each other from the first byte to the very last (RFC 3533),
 * one stream must be Opus, and it must hold at least one audio packet. Unlike
 * a WebM, a byte added after the last page makes the file unreadable
 * ('unmeasured'), so a copy edited that way is still marked.
 *
 * The Opus packets are the audio, as in a WebM: the same audio remuxed from a
 * WebM has the same fingerprint. The length is the last granule position less
 * the stream's pre-skip, never more than the packets play (the granule is a
 * number the file states). Gives up past MAX_PROBE_STEPS.
 */
export function probeOgg(bytes: Uint8Array): RecordingProbe | null {
  const budget = new StepBudget();
  const hash = createHash('sha256');
  let opusSerial: number | null = null;
  let preSkip = 0;
  let lastGranule: number | null = null;
  // The Opus stream's packets so far: OpusHead, OpusTags, then the audio (RFC 7845 §3).
  let streamPackets = 0;
  // The packet being read, which may run on over pages: its size and first two bytes.
  let packetBytes = 0;
  let packetHead: number[] = [];
  let packetOpen = false;
  let packets = 0;
  let silentPackets = 0;
  let packetMs = 0;

  for (let pos = 0; pos < bytes.length;) {
    if (budget.step()) return null;
    if (!hasAscii(bytes, pos, 'OggS') || pos + OGG_PAGE_HEADER_BYTES > bytes.length || bytes[pos + 4] !== 0) return null;
    const flags = bytes[pos + 5];
    const segments = bytes[pos + 26];
    const bodyStart = pos + OGG_PAGE_HEADER_BYTES + segments;
    if (bodyStart > bytes.length) return null;
    let bodyEnd = bodyStart;
    for (let i = 0; i < segments; i++) bodyEnd += bytes[pos + OGG_PAGE_HEADER_BYTES + i];
    if (bodyEnd > bytes.length) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, OGG_PAGE_HEADER_BYTES);
    const serial = view.getUint32(14, true);
    // An Opus stream's first page holds its OpusHead, at least 19 bytes (RFC 7845 §5.1).
    if (opusSerial === null && (flags & 0x02) && bodyEnd - bodyStart >= 19 && hasAscii(bytes, bodyStart, 'OpusHead')) {
      opusSerial = serial;
      preSkip = bytes[bodyStart + 10] | (bytes[bodyStart + 11] << 8);
    }
    if (serial === opusSerial) {
      // A packet runs on to the next page only when that page says it continues one.
      if (packetOpen !== Boolean(flags & 0x01)) return null;
      let at = bodyStart;
      for (let i = 0; i < segments; i++) {
        if (budget.step()) return null;
        const size = bytes[pos + OGG_PAGE_HEADER_BYTES + i];
        const audio = streamPackets >= 2;
        if (audio && size > 0) hash.update(bytes.subarray(at, at + size));
        for (let b = at; b < at + size && packetHead.length < 2; b++) packetHead.push(bytes[b]);
        packetBytes += size;
        at += size;
        packetOpen = size === 255;
        if (packetOpen) continue;
        // A lacing value under 255 ends the packet.
        streamPackets += 1;
        if (audio) {
          packets += 1;
          if (packetBytes <= SILENT_PACKET_BYTES) silentPackets += 1;
          packetMs += packetBytes === 0 ? 0 : opusPacketMs(Uint8Array.from(packetHead));
        }
        packetBytes = 0;
        packetHead = [];
      }
      // All ones: no packet ends on this page.
      const low = view.getUint32(6, true);
      const high = view.getUint32(10, true);
      if (low !== 0xffffffff || high !== 0xffffffff) lastGranule = high * 2 ** 32 + low;
    }
    pos = bodyEnd;
  }

  if (opusSerial === null || packets === 0 || packetOpen) return null;
  const granuleMs = lastGranule === null ? packetMs : Math.max(0, lastGranule - preSkip) / OPUS_SAMPLES_PER_MS;
  return {
    durationMs: Math.max(0, Math.round(Math.min(granuleMs, packetMs))),
    payloadSha256: hash.digest('hex'),
    packets,
    silentPackets,
    digitalSilence: silentPackets >= DIGITAL_SILENCE_SHARE * packets,
  };
}

const PRINTABLE_TYPE = /^[\x20-\x7e]{4}$/;

/** Longer than any take could be: a length a file states is never stored above it. */
const MAX_STATED_MS = 24 * 60 * 60 * 1000;

interface Box {
  type: string;
  start: number;
  end: number;
}

/** An MP4 box at `pos`: its type and where its content lies, or null when it does not fit before `limit`. */
function readBox(bytes: Uint8Array, pos: number, limit: number): Box | null {
  if (pos + 8 > limit) return null;
  let size = readUint(bytes, pos, 4);
  let headerBytes = 8;
  if (size === 1) {
    // A 64-bit size follows the type.
    if (pos + 16 > limit) return null;
    size = readUint(bytes, pos + 8, 8);
    headerBytes = 16;
  } else if (size === 0) {
    // Runs to the end of what holds it.
    size = limit - pos;
  }
  if (size < headerBytes || pos + size > limit) return null;
  return { type: String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]), start: pos + headerBytes, end: pos + size };
}

function allOnes(bytes: Uint8Array, pos: number, length: number): boolean {
  for (let i = 0; i < length; i++) if (bytes[pos + i] !== 0xff) return false;
  return true;
}

/** A duration of `length` bytes at `pos` in `timescale` units, as ms; null when it is 0 or unknown (all ones). */
function statedMs(bytes: Uint8Array, pos: number, length: number, timescale: number): number | null {
  if (timescale === 0 || allOnes(bytes, pos, length)) return null;
  const units = readUint(bytes, pos, length);
  if (units === 0) return null;
  return Math.min(MAX_STATED_MS, Math.round((units * 1000) / timescale));
}

/**
 * Walks an MP4 recording's boxes, or returns null when the bytes are not one:
 * top-level boxes must follow each other from the first byte (the ftyp) to the
 * very last, and a movie box (moov) with its header (mvhd) must be among them,
 * as in every MP4. So an mp3 behind an 8-byte ftyp, or a real file with a
 * byte added, is unreadable ('unmeasured'). The audio itself is not read yet.
 *
 * The length is the movie header's or, for a fragmented file, its fragments'
 * (mehd), when either states one. Safari records fragmented MP4, which may
 * state neither: durationMs is then null and the page's number stands. Gives
 * up past MAX_PROBE_STEPS.
 */
export function walkMp4(bytes: Uint8Array): { durationMs: number | null } | null {
  const budget = new StepBudget();
  let movie: { durationMs: number | null } | null = null;
  for (let pos = 0; pos < bytes.length;) {
    if (budget.step()) return null;
    const box = readBox(bytes, pos, bytes.length);
    // Top-level box types are four printable characters (ftyp, moov, moof, mdat, free…).
    if (!box || !PRINTABLE_TYPE.test(box.type)) return null;
    if (pos === 0 && box.type !== 'ftyp') return null;
    if (box.type === 'moov' && !movie) movie = readMovie(bytes, box.start, box.end, budget);
    pos = box.end;
  }
  if (!movie || budget.spent) return null;
  return movie;
}

/**
 * A movie box's stated length: its header's (mvhd) or else its fragments'
 * (mvex/mehd), in the header's timescale; null when neither states one. The
 * whole result is null when there is no movie header.
 */
function readMovie(bytes: Uint8Array, start: number, end: number, budget: StepBudget): { durationMs: number | null } | null {
  let header: { timescale: number; durationMs: number | null } | null = null;
  // Where the mehd states the fragments' duration: read once the header's timescale is known.
  let fragments: { at: number; length: number } | null = null;
  for (let pos = start; pos < end;) {
    if (budget.step()) return null;
    const box = readBox(bytes, pos, end);
    if (!box) break;
    if (box.type === 'mvhd' && !header) {
      // version, flags, two dates (4 or 8 bytes each), timescale, duration (4 or 8)
      const [dates, durationBytes] = bytes[box.start] === 1 ? [16, 8] : [8, 4];
      if (box.end - box.start < 4 + dates + 4 + durationBytes) return null;
      const timescale = readUint(bytes, box.start + 4 + dates, 4);
      header = { timescale, durationMs: statedMs(bytes, box.start + 8 + dates, durationBytes, timescale) };
    } else if (box.type === 'mvex') {
      for (let p = box.start; p < box.end;) {
        if (budget.step()) return null;
        const inner = readBox(bytes, p, box.end);
        if (!inner) break;
        if (inner.type === 'mehd' && !fragments) {
          // version, flags, duration (4 or 8)
          const length = bytes[inner.start] === 1 ? 8 : 4;
          if (inner.end - inner.start >= 4 + length) fragments = { at: inner.start + 4, length };
        }
        p = inner.end;
      }
    }
    pos = box.end;
  }
  if (!header) return null;
  return { durationMs: header.durationMs ?? (fragments ? statedMs(bytes, fragments.at, fragments.length, header.timescale) : null) };
}

/** What the server could tell of a take from its bytes. */
export interface RecordingMeasure {
  /** The fingerprint copies are matched by: the audio's (probe.payloadSha256) when its packets were read, the whole file's otherwise. */
  sha256: string;
  /** What the packets said (WebM, Ogg), or null. */
  probe: RecordingProbe | null;
  /** The file's own length: its packets' (WebM, Ogg) or its movie header's (MP4); null when it does not give one. */
  durationMs: number | null;
  /** False when the file could not be read as its container: the take is 'unmeasured' and keeps the page's length. */
  readable: boolean;
}

/**
 * What a take in `container` (the one sniffContainer found in its bytes)
 * holds: its fingerprint, its length when the file gives one, and whether it
 * could be read at all.
 */
export function measureRecording(bytes: Uint8Array, container: RecordingContainer): RecordingMeasure {
  if (container === 'mp4') {
    const walk = walkMp4(bytes);
    return { sha256: fileSha256(bytes), probe: null, durationMs: walk ? walk.durationMs : null, readable: walk !== null };
  }
  const probe = container === 'webm' ? probeWebm(bytes) : probeOgg(bytes);
  return {
    sha256: probe ? probe.payloadSha256 : fileSha256(bytes),
    probe,
    durationMs: probe ? probe.durationMs : null,
    readable: probe !== null,
  };
}

/**
 * A recording's fingerprint and, for a WebM or an Ogg, what the probe read:
 * the audio's fingerprint (probe.payloadSha256) when the file's packets could
 * be read, and the whole file's otherwise, so an exact copy of any file (an
 * mp3 model, say) is still found. Used for the tasks' model recordings.
 */
export function fingerprintRecording(bytes: Uint8Array): { sha256: string; probe: RecordingProbe | null } {
  const container = sniffContainer(bytes);
  if (!container) return { sha256: fileSha256(bytes), probe: null };
  const { sha256, probe } = measureRecording(bytes, container);
  return { sha256, probe };
}
