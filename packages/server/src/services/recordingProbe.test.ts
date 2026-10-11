// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  DIGITAL_SILENCE_SHARE,
  MAX_PROBE_STEPS,
  SILENT_PACKET_BYTES,
  fileSha256,
  fingerprintRecording,
  measureRecording,
  opusPacketMs,
  probeOgg,
  probeWebm,
  sniffContainer,
  walkMp4,
} from './recordingProbe.js';
import {
  CHROMIUM_TAKE_PAGE_MS,
  SILENT_TAKE_PAGE_MS,
  element,
  opusPacket,
  recordingFixture,
  steadyBlocks,
  testWebm,
  uintElement,
  withFakedDuration,
} from '../testUtils/webm.js';

describe('opusPacketMs', () => {
  it('reads the length from the packet’s first byte (RFC 6716 §3.1)', () => {
    const cases: [number[], number][] = [
      [[0 << 3], 10], // SILK narrowband 10 ms, one frame
      [[3 << 3], 60], // SILK 60 ms
      [[(13 << 3) | 1], 40], // hybrid 20 ms, two equal frames
      [[(16 << 3) | 2], 5], // CELT 2.5 ms, two frames
      [[(31 << 3) | 3, 3], 60], // Chrome's: CELT 20 ms, three frames
      [[(31 << 3) | 3, 0x80 | 2], 40], // the count is the low six bits
    ];
    for (const [packet, ms] of cases) expect([packet, opusPacketMs(Uint8Array.from(packet))]).toEqual([packet, ms]);
  });

  it('gives 0 for an empty packet or a missing frame count, and never more than 120 ms', () => {
    expect(opusPacketMs(new Uint8Array())).toBe(0);
    expect(opusPacketMs(Uint8Array.from([(31 << 3) | 3]))).toBe(0);
    expect(opusPacketMs(Uint8Array.from([(3 << 3) | 3, 63]))).toBe(120);
  });
});

describe('probeWebm: recordings Chromium made', () => {
  it('measures a take from the fake microphone within 100 ms of the page’s clock', () => {
    const probe = probeWebm(recordingFixture('chromium-fake-mic-3s.webm'))!;
    expect(probe).not.toBeNull();
    expect(Math.abs(probe.durationMs - CHROMIUM_TAKE_PAGE_MS)).toBeLessThanOrEqual(100);
    expect(probe.packets).toBe(50);
    expect(probe.digitalSilence).toBe(false);
    expect(probe.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('measures the simulation’s silent take, and calls it digital silence', () => {
    const probe = probeWebm(recordingFixture('silent-31s.webm'))!;
    expect(Math.abs(probe.durationMs - SILENT_TAKE_PAGE_MS)).toBeLessThanOrEqual(100);
    expect(probe.silentPackets).toBe(probe.packets);
    expect(probe.digitalSilence).toBe(true);
  });

  it('never reads the Duration the page wrote: a faked one changes neither length nor fingerprint', () => {
    const file = recordingFixture('silent-31s.webm');
    const honest = probeWebm(file)!;
    const faked = probeWebm(withFakedDuration(file, 45_000))!;
    expect(faked.durationMs).toBe(honest.durationMs);
    expect(faked.payloadSha256).toBe(honest.payloadSha256);
    expect(fileSha256(withFakedDuration(file, 45_000))).not.toBe(fileSha256(file));
  });

  it('keeps the fingerprint of a copy with a byte added or a bit flipped outside the audio', () => {
    const file = recordingFixture('chromium-fake-mic-3s.webm');
    const honest = probeWebm(file)!;
    const plusOne = Buffer.concat([file, Buffer.from([0x42])]);
    const flipped = Buffer.from(file);
    // Inside the EBML header's DocType ("webm" -> "webn"): outside every audio block.
    flipped[flipped.indexOf(Buffer.from('webm')) + 3] ^= 0x03;
    for (const copy of [plusOne, flipped]) {
      expect(fileSha256(copy)).not.toBe(fileSha256(file));
      expect(probeWebm(copy)).toMatchObject({ durationMs: honest.durationMs, payloadSha256: honest.payloadSha256 });
    }
  });

  it('measures a file cut short as the audio it still has, and returns null with no audio left', () => {
    const file = recordingFixture('chromium-fake-mic-3s.webm');
    const half = probeWebm(file.subarray(0, Math.floor(file.length / 2)))!;
    expect(half.durationMs).toBeGreaterThan(1000);
    expect(half.durationMs).toBeLessThan(2000);
    // Only the header, the tracks and the start of the first cluster: no block yet.
    const firstCluster = file.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
    expect(firstCluster).toBeGreaterThan(0);
    expect(probeWebm(file.subarray(0, firstCluster + 6))).toBeNull();
  });

  it('returns null for random bytes, an empty file and other formats', () => {
    let seed = 7;
    const random = Buffer.from(Array.from({ length: 4096 }, () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % 256; }));
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)]);
    for (const bytes of [random, Buffer.alloc(0), Buffer.from('v'), ogg, Buffer.from('ID3\x04\x00\x00')]) {
      expect(probeWebm(bytes)).toBeNull();
    }
  });
});

describe('probeWebm: what a file could be made to say', () => {
  it('measures blocks back to back as their packets add up', () => {
    expect(probeWebm(testWebm({ blocks: steadyBlocks(50) }))!.durationMs).toBe(3000);
  });

  it('does not let rewritten timestamps stretch a take: never more than its packets play', () => {
    const blocks = steadyBlocks(10).map((b, i) => ({ ...b, timeMs: i * 4000 }));
    expect(probeWebm(testWebm({ blocks }))!.durationMs).toBe(600);
  });

  it('counts a gap in the timestamps no more than the audio around it', () => {
    // 1.2 s, a gap, 1.2 s: the span is longer than the packets, so the packets win.
    const blocks = [...steadyBlocks(20), ...steadyBlocks(20, 120, 50).map((b) => ({ ...b, timeMs: b.timeMs + 5000 }))];
    expect(probeWebm(testWebm({ blocks }))!.durationMs).toBe(2400);
  });

  it('reads Blocks in BlockGroups and Clusters with a size, and ignores another track’s blocks', () => {
    const blocks = [
      ...steadyBlocks(10).map((b, i) => ({ ...b, group: i % 2 === 0 })),
      { timeMs: 900, packet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], track: 2 },
    ];
    const probe = probeWebm(testWebm({ blocks, sizedClusters: true, videoTrack: true }))!;
    expect(probe).toMatchObject({ durationMs: 600, packets: 10 });
    expect(probe.payloadSha256).toBe(probeWebm(testWebm({ blocks: steadyBlocks(10) }))!.payloadSha256);
  });

  it('returns null without an Opus track', () => {
    expect(probeWebm(testWebm({ blocks: steadyBlocks(10), codec: 'A_VORBIS' }))).toBeNull();
    expect(probeWebm(testWebm({ blocks: [] }))).toBeNull();
    // A codec ID a megabyte long is not Opus, however it begins.
    expect(probeWebm(testWebm({ blocks: steadyBlocks(10), codec: `A_OPUS${' '.repeat(1 << 20)}` }))).toBeNull();
    expect(probeWebm(testWebm({ blocks: steadyBlocks(10), codec: 'A_OPUS' }))).toMatchObject({ packets: 10 });
  });

  it('reads laced blocks (Xiph, EBML, fixed) packet by packet, the same audio as one packet a block', () => {
    const packets = [opusPacket(100, 1), opusPacket(130, 2), opusPacket(100, 3)];
    const plain = probeWebm(testWebm({ blocks: packets.map((packet, i) => ({ timeMs: i * 60, packet })) }))!;
    const laced = (flags: number, lacing: number[]) => {
      const file = testWebm({ blocks: [{ timeMs: 0, packet: [] }] });
      // Swap the one empty SimpleBlock for a laced one holding all three packets.
      const body = [0x81, 0, 0, flags, 2, ...lacing, ...packets.flat()];
      const at = file.lastIndexOf(Buffer.from(element(0xa3, [0x81, 0, 0, 0x80])));
      return Buffer.concat([file.subarray(0, at), Buffer.from(element(0xa3, body))]);
    };
    const xiph = laced(0x80 | 0x02, [100, 130]);
    // EBML: 100 as a 2-byte size, then +30 as a signed 1-byte difference (30 + 63).
    const ebmlLaced = laced(0x80 | 0x06, [0x40, 100, 0x80 | (30 + 63)]);
    for (const file of [xiph, ebmlLaced]) {
      expect(probeWebm(file)).toMatchObject({ durationMs: 180, packets: 3, payloadSha256: plain.payloadSha256 });
    }
    const equal = [opusPacket(100, 1), opusPacket(100, 2)];
    const fixedFile = (() => {
      const file = testWebm({ blocks: [{ timeMs: 0, packet: [] }] });
      const at = file.lastIndexOf(Buffer.from(element(0xa3, [0x81, 0, 0, 0x80])));
      return Buffer.concat([file.subarray(0, at), Buffer.from(element(0xa3, [0x81, 0, 0, 0x84, 1, ...equal.flat()]))]);
    })();
    expect(probeWebm(fixedFile)).toMatchObject({ durationMs: 120, packets: 2 });
  });

  it('calls a take digital silence at 90% silent packets, not below', () => {
    expect(SILENT_PACKET_BYTES).toBe(12);
    expect(DIGITAL_SILENCE_SHARE).toBe(0.9);
    const take = (silent: number, loud: number) => testWebm({
      blocks: [...Array.from({ length: silent }, () => opusPacket(8)), ...Array.from({ length: loud }, (_, i) => opusPacket(400, i))]
        .map((packet, i) => ({ timeMs: i * 60, packet })),
    });
    expect(probeWebm(take(9, 1))!.digitalSilence).toBe(true);
    expect(probeWebm(take(89, 11))!.digitalSilence).toBe(false);
  });

  it('ignores a zero timecode scale', () => {
    const file = testWebm({ blocks: steadyBlocks(10) });
    const scale = Buffer.from(uintElement(0x2ad7b1, 1_000_000));
    const at = file.indexOf(scale);
    // Three zero bytes: the same length, so every size around it still holds.
    const zero = Buffer.concat([file.subarray(0, at), Buffer.from(element(0x2ad7b1, [0, 0, 0])), file.subarray(at + scale.length)]);
    expect(probeWebm(zero)!.durationMs).toBe(600);
  });
});

/** The fixture take up to its first Cluster (EBML header, Info, Tracks): a start for crafted files. */
function takeHead(): Buffer {
  const file = recordingFixture('chromium-fake-mic-3s.webm');
  return file.subarray(0, file.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75])));
}

/** A SimpleBlock on the Opus track (1) at time 0, holding one 1-byte packet (20 ms of SILK). */
const TINY_BLOCK = [0xa3, 0x85, 0x81, 0x00, 0x00, 0x80, 0x08];

/** The take's head, then one Cluster of unknown size at time 0: `lead`, then `unit` `count` times. */
function craftedWebm(unit: number[], count: number, lead: number[] = []): Buffer {
  const head = takeHead();
  const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00, ...lead]);
  const repeated = Buffer.from(unit);
  const out = Buffer.alloc(head.length + cluster.length + repeated.length * count);
  head.copy(out, 0);
  cluster.copy(out, head.length);
  for (let i = 0, pos = head.length + cluster.length; i < count; i++, pos += repeated.length) repeated.copy(out, pos);
  return out;
}

/** A SimpleBlock with 255 one-byte frames, Xiph-laced: 255 packets in one element. */
function lacedBlock(): number[] {
  const content = [0x81, 0x00, 0x00, 0x82, 254, ...Array<number>(254).fill(1), ...Array<number>(255).fill(0x08)];
  return [0xa3, 0x40 | (content.length >> 8), content.length & 0xff, ...content];
}

describe('probeWebm: a bound on the work (MAX_PROBE_STEPS)', () => {
  it('reads an honest take far under the bound: 15 minutes of 20 ms packets', () => {
    expect(MAX_PROBE_STEPS).toBe(1_000_000);
    expect(probeWebm(craftedWebm(TINY_BLOCK, 45_000))).toMatchObject({ packets: 45_000 });
    expect(probeWebm(recordingFixture('chromium-fake-mic-3s.webm'))).toMatchObject({ packets: 50 });
    expect(probeWebm(recordingFixture('silent-31s.webm'))).not.toBeNull();
  });

  it('gives up (null, so the take is stored unmeasured) just past the bound on tiny blocks, and not just under it', () => {
    // A block is two steps: its element and its packet.
    expect(probeWebm(craftedWebm(TINY_BLOCK, MAX_PROBE_STEPS / 2 - 1000))).not.toBeNull();
    expect(probeWebm(craftedWebm(TINY_BLOCK, MAX_PROBE_STEPS / 2 + 10))).toBeNull();
  });

  it('counts the packets of laced blocks, not only the blocks', () => {
    // 256 steps a block: well under the bound in blocks, over it in packets.
    expect(probeWebm(craftedWebm(lacedBlock(), 100))).toMatchObject({ packets: 25_500 });
    expect(probeWebm(craftedWebm(lacedBlock(), Math.ceil(MAX_PROBE_STEPS / 256) + 10))).toBeNull();
  });

  it('counts elements that hold no audio: Void elements in a Cluster, and between Clusters', () => {
    const VOID = [0xec, 0x80];
    expect(probeWebm(craftedWebm(VOID, 1000, TINY_BLOCK))).toMatchObject({ packets: 1 });
    expect(probeWebm(craftedWebm(VOID, MAX_PROBE_STEPS + 10, TINY_BLOCK))).toBeNull();
    // Blocks for another track: an element each, and never a packet.
    expect(probeWebm(craftedWebm([0xa3, 0x85, 0x82, 0x00, 0x00, 0x80, 0x08], MAX_PROBE_STEPS + 10, TINY_BLOCK))).toBeNull();
    // In the Segment, after Clusters with a size.
    const sized = testWebm({ blocks: steadyBlocks(10), sizedClusters: true });
    const voids = (count: number) => Buffer.concat([sized, Buffer.alloc(count * 2).fill(Buffer.from(VOID))]);
    expect(probeWebm(voids(1000))).toMatchObject({ durationMs: 600 });
    expect(probeWebm(voids(MAX_PROBE_STEPS + 10))).toBeNull();
  });
});

describe('sniffContainer', () => {
  it('knows the recorder’s three containers by their first bytes', () => {
    expect(sniffContainer(recordingFixture('chromium-fake-mic-3s.webm'))).toBe('webm');
    expect(sniffContainer(recordingFixture('silent-31s.webm'))).toBe('webm');
    expect(sniffContainer(recordingFixture('chromium-fake-mic-3s.ogg'))).toBe('ogg');
    expect(sniffContainer(recordingFixture('ffmpeg-aac-fragmented-3s.m4a'))).toBe('mp4');
    expect(sniffContainer(recordingFixture('ffmpeg-aac-3s.m4a'))).toBe('mp4');
  });

  it('knows nothing else: an mp3, a wav, text, or a start that only looks right', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
    for (const bytes of [
      Buffer.from('ID3\x04\x00\x00 an mp3'),
      Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]), // an MPEG frame with no ID3 tag
      wav,
      Buffer.from('v'),
      Buffer.alloc(0),
      Buffer.from('OggS not really'), // no version 0, no beginning of stream
      Buffer.from([0x00, 0x00, 0x01, 0x00, ...Buffer.from('ftypM4A ')]), // an ftyp box longer than the file
    ]) {
      expect([bytes.subarray(0, 8).toString('hex'), sniffContainer(bytes)]).toEqual([bytes.subarray(0, 8).toString('hex'), null]);
    }
  });
});

/** Where each page of an Ogg file starts. */
function oggPageStarts(file: Buffer): number[] {
  const starts: number[] = [];
  for (let pos = 0; pos < file.length;) {
    starts.push(pos);
    const segments = file[pos + 26];
    let body = 0;
    for (let i = 0; i < segments; i++) body += file[pos + 27 + i];
    pos += 27 + segments + body;
  }
  return starts;
}

/** A page in the take's stream holding 255 empty packets (no granule, as for a page no packet ends on). */
function emptyPacketsPage(file: Buffer): Buffer {
  const page = Buffer.alloc(27 + 255);
  file.copy(page, 0, 0, 27);
  page[5] = 0;
  page.fill(0xff, 6, 14);
  page[26] = 255;
  return page;
}

describe('probeOgg', () => {
  const webm = recordingFixture('chromium-fake-mic-3s.webm');
  const ogg = recordingFixture('chromium-fake-mic-3s.ogg');

  it('measures the take remuxed into Ogg by its last granule, with the WebM’s very fingerprint', () => {
    const probe = probeOgg(ogg)!;
    // Its last granule is 144000 samples at 48 kHz.
    expect(probe).toMatchObject({ durationMs: 3000, packets: 50, silentPackets: probeWebm(webm)!.silentPackets, digitalSilence: false });
    expect(Math.abs(probe.durationMs - CHROMIUM_TAKE_PAGE_MS)).toBeLessThanOrEqual(100);
    expect(probe.payloadSha256).toBe(probeWebm(webm)!.payloadSha256);
  });

  it('takes the stream’s pre-skip off, at 48 kHz', () => {
    const file = Buffer.from(ogg);
    file.writeUInt16LE(4800, file.indexOf('OpusHead') + 10);
    expect(probeOgg(file)!.durationMs).toBe(2900);
  });

  it('never measures more than the packets play, whatever the last granule says', () => {
    const file = Buffer.from(ogg);
    const last = oggPageStarts(file).at(-1)!;
    file.writeUInt32LE(45 * 48_000, last + 6);
    file.writeUInt32LE(0, last + 10);
    expect(probeOgg(file)!.durationMs).toBe(3000);
  });

  it('returns null for a byte added or missing, a stream that is not Opus, no audio, and junk', () => {
    const notOpus = Buffer.from(ogg);
    notOpus.write('OpusHeaX', notOpus.indexOf('OpusHead'), 'latin1');
    const headersOnly = ogg.subarray(0, oggPageStarts(ogg)[2]);
    const broken = Buffer.from(ogg);
    broken[oggPageStarts(ogg)[2]] = 0x6f; // "oggS": the chain of pages breaks
    for (const bytes of [
      Buffer.concat([ogg, Buffer.from([0])]),
      ogg.subarray(0, ogg.length - 10),
      notOpus,
      headersOnly,
      broken,
      Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)]),
      webm,
    ]) {
      expect(probeOgg(bytes)).toBeNull();
    }
  });

  it('gives up past the bound: pages of empty packets', () => {
    const page = emptyPacketsPage(ogg);
    const flood = (pages: number) => Buffer.concat([ogg, ...Array<Buffer>(pages).fill(page)]);
    expect(probeOgg(flood(100))).toMatchObject({ packets: 50 + 100 * 255 });
    // A page is a step and so is each packet on it.
    expect(probeOgg(flood(Math.ceil(MAX_PROBE_STEPS / 256) + 10))).toBeNull();
  });
});

/** An MP4 box: a 32-bit size, its type, its content. */
function box(type: string, content: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(8 + content.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 'latin1');
  content.copy(out, 8);
  return out;
}

const FTYP = box('ftyp', Buffer.from('M4A \x00\x00\x00\x00isomM4A ', 'latin1'));
const MDAT = box('mdat', Buffer.alloc(64, 7));

/** A movie header, version 0 (32-bit duration) or 1 (64-bit), in `timescale` units. */
function mvhd(timescale: number, duration: number | 'unknown', version: 0 | 1 = 0): Buffer {
  const content = Buffer.alloc(version === 1 ? 112 : 100);
  content[0] = version;
  const at = version === 1 ? 20 : 12;
  content.writeUInt32BE(timescale, at);
  if (duration === 'unknown') content.fill(0xff, at + 4, at + (version === 1 ? 12 : 8));
  else if (version === 1) content.writeBigUInt64BE(BigInt(duration), at + 4);
  else content.writeUInt32BE(duration, at + 4);
  return box('mvhd', content);
}

/** The fragments' duration (mvex/mehd, version 0), in the movie header's units. */
function mvex(duration: number): Buffer {
  const mehd = Buffer.alloc(8);
  mehd.writeUInt32BE(duration, 4);
  return box('mvex', box('mehd', mehd));
}

const mp4 = (...moov: Buffer[]) => Buffer.concat([FTYP, box('moov', Buffer.concat(moov)), MDAT]);

describe('walkMp4', () => {
  it('walks the plain MP4 to the length its header states, and Safari’s fragmented kind to none', () => {
    expect(walkMp4(recordingFixture('ffmpeg-aac-3s.m4a'))).toEqual({ durationMs: 3000 });
    expect(walkMp4(recordingFixture('ffmpeg-aac-fragmented-3s.m4a'))).toEqual({ durationMs: null });
  });

  it('reads a version 1 header, the fragments’ length when the header states none, and 64-bit and open-ended sizes', () => {
    expect(walkMp4(mp4(mvhd(48_000, 48_000 * 5, 1)))).toEqual({ durationMs: 5000 });
    expect(walkMp4(mp4(mvhd(1000, 0), mvex(4200)))).toEqual({ durationMs: 4200 });
    // The mehd before the mvhd still takes its timescale.
    expect(walkMp4(mp4(mvex(8000), mvhd(2000, 0)))).toEqual({ durationMs: 4000 });
    expect(walkMp4(mp4(mvhd(1000, 'unknown')))).toEqual({ durationMs: null });
    expect(walkMp4(mp4(mvhd(0, 5000)))).toEqual({ durationMs: null });
    const big = Buffer.alloc(16 + 32);
    big.writeUInt32BE(1, 0);
    big.write('mdat', 4, 'latin1');
    big.writeBigUInt64BE(BigInt(big.length), 8);
    expect(walkMp4(Buffer.concat([FTYP, box('moov', mvhd(1000, 1500)), big]))).toEqual({ durationMs: 1500 });
    const toTheEnd = Buffer.from(MDAT);
    toTheEnd.writeUInt32BE(0, 0);
    expect(walkMp4(Buffer.concat([FTYP, box('moov', mvhd(1000, 1500)), toTheEnd]))).toEqual({ durationMs: 1500 });
  });

  it('returns null unless the boxes run from the ftyp to the last byte, with a movie header', () => {
    const plain = recordingFixture('ffmpeg-aac-3s.m4a');
    const mp3 = Buffer.from('ID3\x04\x00\x00 an mp3 model, not an MP4', 'latin1');
    const unprintable = box('mo\x00v', Buffer.alloc(4));
    for (const [label, bytes] of [
      ['a byte added', Buffer.concat([plain, Buffer.from([0])])],
      ['cut short', plain.subarray(0, plain.length - 1)],
      ['an mp3 behind an ftyp', Buffer.concat([FTYP, mp3])],
      ['an mp3 in an mdat, no moov', Buffer.concat([FTYP, box('mdat', mp3)])],
      ['a moov with no header', Buffer.concat([FTYP, box('moov'), box('mdat', mp3)])],
      ['a top-level type that is not text', Buffer.concat([FTYP, box('moov', mvhd(1000, 1500)), unprintable])],
      ['no ftyp first', Buffer.concat([box('moov', mvhd(1000, 1500)), FTYP])],
    ] as const) {
      expect([label, walkMp4(bytes)]).toEqual([label, null]);
    }
  });

  it('gives up past the bound: a flood of tiny boxes', () => {
    const free = box('free');
    const flood = (count: number) => Buffer.concat([mp4(mvhd(1000, 1500)), Buffer.alloc(count * 8).fill(free)]);
    expect(walkMp4(flood(1000))).toEqual({ durationMs: 1500 });
    expect(walkMp4(flood(MAX_PROBE_STEPS + 10))).toBeNull();
  });
});

describe('measureRecording', () => {
  it('reads each container: the packets of a WebM or an Ogg, the header of an MP4', () => {
    const webm = recordingFixture('chromium-fake-mic-3s.webm');
    const probe = probeWebm(webm)!;
    expect(measureRecording(webm, 'webm')).toEqual({ sha256: probe.payloadSha256, probe, durationMs: probe.durationMs, readable: true });
    expect(measureRecording(recordingFixture('chromium-fake-mic-3s.ogg'), 'ogg')).toMatchObject({
      sha256: probe.payloadSha256, durationMs: 3000, readable: true,
    });
    const fragmented = recordingFixture('ffmpeg-aac-fragmented-3s.m4a');
    expect(measureRecording(fragmented, 'mp4')).toEqual({ sha256: fileSha256(fragmented), probe: null, durationMs: null, readable: true });
    expect(measureRecording(recordingFixture('ffmpeg-aac-3s.m4a'), 'mp4')).toMatchObject({ durationMs: 3000, readable: true });
  });

  it('calls a file it cannot read unreadable, with no length and the whole file’s fingerprint', () => {
    const cases: [Buffer, 'webm' | 'ogg' | 'mp4'][] = [
      [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x76]), 'webm'],
      [Buffer.concat([recordingFixture('chromium-fake-mic-3s.ogg'), Buffer.from([0])]), 'ogg'],
      [Buffer.concat([FTYP, Buffer.from('ID3\x04 an mp3', 'latin1')]), 'mp4'],
    ];
    for (const [bytes, container] of cases) {
      expect(measureRecording(bytes, container)).toEqual({ sha256: fileSha256(bytes), probe: null, durationMs: null, readable: false });
    }
  });
});

describe('fingerprintRecording', () => {
  it('is the audio’s fingerprint for a readable WebM or Ogg, and the whole file’s otherwise', () => {
    const webm = recordingFixture('chromium-fake-mic-3s.webm');
    expect(fingerprintRecording(webm)).toEqual({ sha256: probeWebm(webm)!.payloadSha256, probe: probeWebm(webm) });
    // The same audio in another container is the same audio.
    expect(fingerprintRecording(recordingFixture('chromium-fake-mic-3s.ogg')).sha256).toBe(probeWebm(webm)!.payloadSha256);
    const m4a = recordingFixture('ffmpeg-aac-3s.m4a');
    expect(fingerprintRecording(m4a)).toEqual({ sha256: fileSha256(m4a), probe: null });
    const mp3 = Buffer.from('ID3\x04\x00\x00 not a webm');
    expect(fingerprintRecording(mp3)).toEqual({ sha256: fileSha256(mp3), probe: null });
  });
});
