// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Lab audio for the lab specs: small mono WAVs built from tone (a voice) and
 * silence (a pause), and a route handler that serves them with byte ranges,
 * the way the real server does, so seeking works as in production.
 */
import type { Route } from '@playwright/test';

/** [seconds, amplitude] parts: amplitude 0 is silence, anything else a 330 Hz tone. */
export type WavPart = [seconds: number, amplitude: number];

export function wav(parts: WavPart[], rate = 16000): Buffer {
  const samples: number[] = [];
  for (const [seconds, amplitude] of parts) {
    const n = Math.round(seconds * rate);
    for (let i = 0; i < n; i++) samples.push(amplitude * Math.sin((2 * Math.PI * 330 * i) / rate));
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * A pause-and-respond lab in miniature: 1 s prompt, 3.6 s answer pause, 1 s
 * prompt, 3.6 s answer pause, 1 s closing line, 0.5 s of run-out. The scan
 * finds the two pauses (3.3 s or longer) and leaves the run-out out (it
 * touches the end). `lastTone` lengthens the closing line.
 */
export function pauseLabWav(lastTone = 1): Buffer {
  return wav([[1, 0.5], [3.6, 0], [1, 0.5], [3.6, 0], [lastTone, 0.5], [0.5, 0]]);
}

/** The answer pauses in pauseLabWav, [startMs, endMs]. */
export const PAUSE_LAB_PAUSES: [number, number][] = [[1000, 4600], [5600, 9200]];

/** pauseLabWav's length (ms). */
export const pauseLabMs = (lastTone = 1) => Math.round((1 + 3.6 + 1 + 3.6 + lastTone + 0.5) * 1000);

/** Serves audio the way a real server does, with byte ranges, so seeking works as in production. */
export async function serveAudio(route: Route, body: Buffer, contentType = 'audio/wav'): Promise<void> {
  const range = route.request().headers()['range'];
  const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (!match) {
    await route.fulfill({ status: 200, contentType, body, headers: { 'Accept-Ranges': 'bytes' } });
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
  await route.fulfill({
    status: 206,
    contentType,
    body: body.subarray(start, end + 1),
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` },
  });
}
