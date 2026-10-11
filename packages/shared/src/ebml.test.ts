// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { readId, readSize, readUint } from './ebml.js';

const at = (...bytes: number[]) => Uint8Array.from(bytes);

describe('readId', () => {
  it('reads IDs of one to four bytes with their marker bits', () => {
    expect(readId(at(0xa3), 0)).toEqual({ id: 0xa3, length: 1 });
    expect(readId(at(0x44, 0x89), 0)).toEqual({ id: 0x4489, length: 2 });
    expect(readId(at(0x2a, 0xd7, 0xb1), 0)).toEqual({ id: 0x2ad7b1, length: 3 });
    expect(readId(at(0x00, 0x1f, 0x43, 0xb6, 0x75), 1)).toEqual({ id: 0x1f43b675, length: 4 });
  });

  it('is null past the end, for a zero byte, for an ID longer than four bytes, and for one cut short', () => {
    expect(readId(at(0xa3), 1)).toBeNull();
    expect(readId(at(0x00, 0xa3), 0)).toBeNull();
    expect(readId(at(0x08, 1, 2, 3, 4), 0)).toBeNull();
    expect(readId(at(0x1a, 0x45, 0xdf), 0)).toBeNull();
  });
});

describe('readSize', () => {
  it('reads sizes of one to eight bytes without the marker', () => {
    expect(readSize(at(0x84), 0)).toEqual({ size: 4, length: 1, unknown: false });
    expect(readSize(at(0x40, 0x02), 0)).toEqual({ size: 2, length: 2, unknown: false });
    expect(readSize(at(0x10, 0x00, 0x01, 0x00), 0)).toEqual({ size: 256, length: 4, unknown: false });
    expect(readSize(at(0x01, 0, 0, 0, 0, 0, 0x01, 0x02), 0)).toEqual({ size: 258, length: 8, unknown: false });
  });

  it('says when a size is unknown: every value bit set, as a live recorder writes it', () => {
    expect(readSize(at(0xff), 0)?.unknown).toBe(true);
    expect(readSize(at(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), 0)?.unknown).toBe(true);
    expect(readSize(at(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe), 0)?.unknown).toBe(false);
  });

  it('is null past the end, for a zero byte, and for a size cut short', () => {
    expect(readSize(at(), 0)).toBeNull();
    expect(readSize(at(0x00, 0x81), 0)).toBeNull();
    expect(readSize(at(0x40), 0)).toBeNull();
  });
});

describe('readUint', () => {
  it('reads a big-endian unsigned integer', () => {
    expect(readUint(at(0x0f, 0x42, 0x40), 0, 3)).toBe(1_000_000);
    expect(readUint(at(0xff, 0x00, 0x01), 1, 2)).toBe(1);
    expect(readUint(at(), 0, 0)).toBe(0);
  });
});
