// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';

const ASSETS_DIR = resolve(process.cwd(), 'data', 'assets');

export async function writeAudioAsset(buffer: Buffer, extension: string): Promise<string> {
  await mkdir(ASSETS_DIR, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const filePath = resolve(ASSETS_DIR, filename);
  await writeFile(filePath, buffer);
  return `/api/assets/${filename}`;
}

export function getAssetsDir(): string {
  return ASSETS_DIR;
}
