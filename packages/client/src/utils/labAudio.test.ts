// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAUSE_SCAN_LIMITS, scanNeedsCheck, validatePauseList, type LabPauseScan } from '@libresrs/shared';
import {
  CLOSE_CALL_MS,
  DEFAULT_MIN_PAUSE_MS,
  ListeningCoverage,
  audioMimeTypeFor,
  findAnswerPauses,
  findLastSpeechMs,
  formatClock,
  parseClock,
  scanLabFile,
  scanLabUrl,
  titleFromFilename,
} from './labAudio';

describe('clock helpers', () => {
  it('formats and parses minutes:seconds', () => {
    expect(formatClock(754_321)).toBe('12:34');
    expect(formatClock(0)).toBe('0:00');
    expect(parseClock('12:34')).toBe(754_000);
    expect(parseClock(' 5:07 ')).toBe(307_000);
    expect(parseClock('90')).toBe(90_000);
    expect(parseClock('1:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });

  it('derives a title from the course file names', () => {
    expect(titleFromFilename('Lab_week01.mp3')).toBe('Lab week01');
  });

  it('works out a type for files the system did not label', () => {
    expect(audioMimeTypeFor({ name: 'ES1_Lab_semana01.mp3', type: '' })).toBe('audio/mpeg');
    expect(audioMimeTypeFor({ name: 'x.M4A', type: '' })).toBe('audio/mp4');
    expect(audioMimeTypeFor({ name: 'x.mp3', type: 'audio/mpeg' })).toBe('audio/mpeg');
    expect(audioMimeTypeFor({ name: 'notes.pdf', type: 'application/pdf' })).toBeNull();
  });

  it('refuses audio the server will not store, instead of letting it fail at upload', () => {
    expect(audioMimeTypeFor({ name: 'lab.flac', type: 'audio/flac' })).toBeNull();
    expect(audioMimeTypeFor({ name: 'lab.aiff', type: 'audio/x-aiff' })).toBeNull();
    // An odd label on a file the server does take: the extension decides.
    expect(audioMimeTypeFor({ name: 'lab.wav', type: 'audio/wave' })).toBe('audio/wav');
    expect(audioMimeTypeFor({ name: 'rec.webm', type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
  });
});

describe('findLastSpeechMs', () => {
  const rate = 16000;
  function tone(seconds: number, amplitude: number): Float32Array {
    return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / rate));
  }
  function noise(seconds: number, amplitude: number): Float32Array {
    return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(i * 12.9898) * 0.5);
  }
  function join(...parts: Float32Array[]): Float32Array {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  it('finds the end of the last spoken phrase, not the end of the file', () => {
    // 1 s speech, 2 s pause, 0.5 s quieter speech (the closing "Adiós"), 3 s of trailing silence.
    const samples = join(tone(1, 0.5), new Float32Array(2 * rate), tone(0.5, 0.1), new Float32Array(3 * rate));
    const end = findLastSpeechMs(samples, rate);
    expect(end).toBeGreaterThanOrEqual(3500);
    expect(end).toBeLessThanOrEqual(3900);
  });

  it('treats encoder hiss in the tail as silence', () => {
    const samples = join(tone(2, 0.5), noise(5, 0.0005));
    expect(findLastSpeechMs(samples, rate)).toBeLessThanOrEqual(2400);
  });

  it('never runs past the end of the file', () => {
    const samples = tone(1, 0.5);
    expect(findLastSpeechMs(samples, rate)).toBe(1000);
  });

  it('returns 0 for a silent file', () => {
    expect(findLastSpeechMs(new Float32Array(rate), rate)).toBe(0);
  });
});

describe('ListeningCoverage', () => {
  it('joins the steady ticks of normal playback', () => {
    const c = new ListeningCoverage();
    for (let t = 0; t < 10_000; t += 250) c.add(t, t + 250);
    expect(c.heardThroughMs()).toBe(10_000);
  });

  it('bridges the sliver a pause and resume leaves, but not a skip', () => {
    const c = new ListeningCoverage();
    c.add(0, 5000);
    c.add(5600, 9000);
    expect(c.heardThroughMs()).toBe(9000);
    c.add(20_000, 30_000);
    expect(c.heardThroughMs()).toBe(9000);
  });

  it('is not advanced by replaying a part already heard', () => {
    const c = new ListeningCoverage();
    c.add(0, 8000);
    c.add(0, 3000);
    expect(c.heardThroughMs()).toBe(8000);
  });

  it('ignores backwards and non-finite spans', () => {
    const c = new ListeningCoverage();
    c.add(5000, 1000);
    c.add(0, Number.NaN);
    expect(c.heardThroughMs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Answer pauses
// ---------------------------------------------------------------------------

describe('findAnswerPauses', () => {
  const rate = 16000;
  /** A 220 Hz tone standing in for speech; amplitude 0.5 is about −9 dBFS. */
  function tone(seconds: number, amplitude = 0.5): Float32Array {
    return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / rate));
  }
  const silence = (seconds: number) => new Float32Array(Math.round(seconds * rate));
  function join(...parts: Float32Array[]): Float32Array {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  /** Adds steady white noise at `db` dBFS RMS (a fixed seed, so the test never varies). */
  function withNoise(samples: Float32Array, db: number): Float32Array {
    const amplitude = Math.sqrt(3) * 10 ** (db / 20); // uniform [-a, a] has RMS a/√3
    let seed = 12345;
    return samples.map((v) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return v + amplitude * ((seed / 2147483648) * 2 - 1);
    });
  }
  const expectScanWithinServerLimits = (scan: LabPauseScan) => {
    for (const [key, [min, max]] of Object.entries(PAUSE_SCAN_LIMITS)) {
      const value = scan[key as keyof LabPauseScan];
      if (value === null) continue;
      expect(value, key).toBeGreaterThanOrEqual(min);
      expect(value, key).toBeLessThanOrEqual(max);
    }
  };

  it('finds 3.6 s answer pauses and leaves a 2.9 s silence out', () => {
    // prompt | 3.6 s pause | model answer | 2.9 s gap | prompt | 3.6 s pause | model answer
    const samples = join(tone(1), silence(3.6), tone(1), silence(2.9), tone(1), silence(3.6), tone(1));
    const { pauses, scan } = findAnswerPauses(samples, rate);

    expect(pauses).toEqual([[1000, 4600], [9500, 13100]]);
    expect(scan).toMatchObject({
      minPauseMs: DEFAULT_MIN_PAUSE_MS,
      shortestKeptMs: 3600,
      longestLeftOutMs: 2900,
      closeCalls: 0,
      noiseDb: -200,
    });
    expect(validatePauseList(pauses, samples.length / (rate / 1000))).toEqual({ ok: true });
    expectScanWithinServerLimits(scan);
  });

  it('drops the lead-in and the run-out, however long they are', () => {
    const samples = join(silence(4), tone(1), silence(3.6), tone(1), silence(5));
    const { pauses, scan } = findAnswerPauses(samples, rate);
    expect(pauses).toEqual([[5000, 8600]]);
    expect(scan.longestLeftOutMs).toBeNull();
  });

  it('does not let a 20 ms click end a pause, but a 60 ms sound does', () => {
    const clicked = join(tone(1), silence(1.8), tone(0.02), silence(1.8), tone(1));
    expect(findAnswerPauses(clicked, rate).pauses).toEqual([[1000, 4620]]);

    // The same click in the middle of a pause that starts off the 10 ms grid still spans three windows at most.
    const offGrid = join(tone(1.005), silence(1.8), tone(0.02), silence(1.8), tone(1));
    expect(findAnswerPauses(offGrid, rate).pauses).toHaveLength(1);

    const burst = join(tone(1), silence(1.8), tone(0.06), silence(1.8), tone(1));
    const split = findAnswerPauses(burst, rate);
    expect(split.pauses).toEqual([]);
    expect(split.scan.longestLeftOutMs).toBe(1800);
  });

  it('follows a quiet file down: a −30 dBFS lab still has its pauses found', () => {
    const quiet = Math.SQRT2 * 10 ** (-30 / 20); // RMS −30 dBFS
    const samples = join(tone(1, quiet), silence(3.6), tone(1, quiet), silence(3.6), tone(1, quiet));
    const { pauses, scan } = findAnswerPauses(samples, rate);
    expect(pauses).toEqual([[1000, 4600], [5600, 9200]]);
    // peak − 35 dB would be −65; the −60 dBFS floor wins.
    expect(scan.thresholdDb).toBe(-60);
  });

  it('stays above the noise floor, so hiss under the pauses does not hide them', () => {
    // Speech at about −9 dBFS: peak − 35 dB is about −44, under the −42 dB hiss.
    // Only the noise floor + 10 dB rule keeps the pauses quiet.
    const samples = withNoise(join(tone(1), silence(3.6), tone(1), silence(3.6), tone(1)), -42);
    const { pauses, scan } = findAnswerPauses(samples, rate);

    expect(pauses).toHaveLength(2);
    for (const [[s, e], expected] of pauses.map((p, i) => [p, [[1000, 4600], [5600, 9200]][i]] as const)) {
      expect(Math.abs(s - expected[0])).toBeLessThanOrEqual(10);
      expect(Math.abs(e - expected[1])).toBeLessThanOrEqual(10);
    }
    expect(scan.noiseDb).toBeGreaterThan(-43);
    expect(scan.noiseDb).toBeLessThan(-41);
    expect(scan.thresholdDb).toBeCloseTo(scan.noiseDb + 10, 1);
    // Sound under the pauses above −40 dBFS would ask the teacher to check; −42 does not.
    expect(scanNeedsCheck(scan, 20)).toBe(false);
  });

  it('reports a noise floor loud enough to ask the teacher to check the count', () => {
    const samples = withNoise(join(tone(1), silence(3.6), tone(1), silence(3.6), tone(1)), -35);
    const { pauses, scan } = findAnswerPauses(samples, rate);
    expect(pauses).toHaveLength(2);
    expect(scan.noiseDb).toBeGreaterThan(-40);
    expect(scanNeedsCheck(scan, 20)).toBe(true);
  });

  it(`counts silences within ${CLOSE_CALL_MS} ms of the cut-off as close calls`, () => {
    const lengths = [3.1, 3.14, 3.15, 3.45, 3.46, 3.5];
    const samples = join(tone(1), ...lengths.flatMap((l) => [silence(l), tone(1)]));
    const { pauses, scan } = findAnswerPauses(samples, rate);

    expect(pauses.map(([s, e]) => e - s)).toEqual([3450, 3460, 3500]);
    // 3.15 s and 3.45 s are 150 ms from 3.3 s; 3.14 s and 3.46 s are 160 ms away.
    expect(scan.closeCalls).toBe(2);
    expect(scan.shortestKeptMs).toBe(3450);
    expect(scan.longestLeftOutMs).toBe(3150);
  });

  it('takes a different cut-off when asked', () => {
    const samples = join(tone(1), silence(2.9), tone(1), silence(3.6), tone(1));
    expect(findAnswerPauses(samples, rate, { minPauseMs: 2500 }).pauses).toHaveLength(2);
    expect(findAnswerPauses(samples, rate, { minPauseMs: 2500 }).scan.minPauseMs).toBe(2500);
  });

  it('leaves a silence of over a minute out of the list, and says so', () => {
    const samples = join(tone(1), silence(3.6), tone(1), silence(61), tone(1));
    const { pauses, scan } = findAnswerPauses(samples, rate);
    expect(pauses).toEqual([[1000, 4600]]);
    expect(scan.longestLeftOutMs).toBe(60_000); // clamped to what the server accepts
    expect(scanNeedsCheck(scan, pauses.length)).toBe(true);
    expectScanWithinServerLimits(scan);
  });

  it('finds nothing in a silent or empty buffer', () => {
    for (const samples of [silence(10), new Float32Array(0), silence(0.01)]) {
      const { pauses, scan } = findAnswerPauses(samples, rate);
      expect(pauses).toEqual([]);
      expect(scan.shortestKeptMs).toBeNull();
      expect(scan.closeCalls).toBe(0);
      expectScanWithinServerLimits(scan);
    }
  });

  it('works at 44.1 kHz too', () => {
    const r = 44100;
    const t = (seconds: number) => Float32Array.from({ length: Math.round(seconds * r) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / r));
    const samples = join(t(1), new Float32Array(Math.round(3.6 * r)), t(1));
    expect(findAnswerPauses(samples, r).pauses).toEqual([[1000, 4600]]);
  });
});

describe('scanLabFile and scanLabUrl', () => {
  const rate = 16000;
  const originalContext = globalThis.OfflineAudioContext;
  afterEach(() => {
    globalThis.OfflineAudioContext = originalContext;
    vi.unstubAllGlobals();
  });

  /** A decoder that hands back the given channels at 16 kHz, as the browser does after resampling. */
  function stubDecoder(channels: Float32Array[]) {
    const decoded: ArrayBuffer[] = [];
    class FakeContext {
      decodeAudioData(bytes: ArrayBuffer) {
        decoded.push(bytes);
        return Promise.resolve({
          numberOfChannels: channels.length,
          length: channels[0].length,
          sampleRate: rate,
          duration: channels[0].length / rate,
          getChannelData: (c: number) => channels[c],
        });
      }
    }
    globalThis.OfflineAudioContext = FakeContext as unknown as typeof OfflineAudioContext;
    return decoded;
  }
  const tone = (seconds: number) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate));
  /** A file as the browser hands it over (jsdom's Blob has no arrayBuffer()). */
  const fileBytes = (...bytes: number[]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as Blob;
  const response = (status: number, body: Blob | null) => ({ ok: status >= 200 && status < 300, status, blob: async () => body });
  function lab(): Float32Array {
    const out = new Float32Array(Math.round(10.2 * rate));
    out.set(tone(1), 0);
    out.set(tone(1), Math.round(4.6 * rate));
    out.set(tone(1), Math.round(9.2 * rate)); // then 0 s of run-out: the file ends on speech
    return out.subarray(0, Math.round(10.2 * rate));
  }

  it('returns the length, the last speech and the pauses of a stereo file', async () => {
    const left = lab();
    stubDecoder([left, left.slice()]);
    const result = await scanLabFile(fileBytes(1, 2, 3));
    expect(result.durationMs).toBe(10_200);
    expect(result.lastSpeechMs).toBe(10_200);
    expect(result.pauses).toEqual([[1000, 4600], [5600, 9200]]);
    expect(result.scan).toMatchObject({ minPauseMs: 3300, shortestKeptMs: 3600, closeCalls: 0 });
  });

  it('fetches a lab already uploaded from this site and scans it', async () => {
    const decoded = stubDecoder([lab()]);
    const fetchMock = vi.fn(async () => response(200, fileBytes(9, 9)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await scanLabUrl('/api/assets/lab-1.mp3');

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/lab-1.mp3', { credentials: 'same-origin' });
    expect(decoded).toHaveLength(1);
    expect(new Uint8Array(decoded[0])).toEqual(new Uint8Array([9, 9]));
    expect(result.pauses).toHaveLength(2);
  });

  it('fails when the file cannot be fetched, and never fetches from another site', async () => {
    stubDecoder([lab()]);
    const fetchMock = vi.fn(async () => response(404, null));
    vi.stubGlobal('fetch', fetchMock);

    await expect(scanLabUrl('/api/assets/missing.mp3')).rejects.toThrow('404');
    await expect(scanLabUrl('https://example.com/lab.mp3')).rejects.toThrow();
    await expect(scanLabUrl('//example.com/lab.mp3')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
