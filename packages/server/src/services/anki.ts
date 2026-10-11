// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeHtml, type CSVCard } from './csv.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

const NOTE_FIELD_SEPARATOR = '\u001f';
const SOUND_TAG_REGEX = /\[sound:[^\]]+\]/gi;
const CLOZE_REGEX = /{{c\d+::(.*?)(?:::[^}]*?)?}}/gi;
const TEMPLATE_REGEX = /{{[^{}]+}}/g;
const MEDIA_TAG_REGEX = /<(img|audio|source)\b[^>]*\bsrc\s*=\s*(['"])(.*?)\2[^>]*>/gi;

export const ANKI_IMPORT_LIMITATION_WARNING = 'Only front/back text and supported HTML are imported. Card templates, scheduling, tags, media attachments, audio references, cloze behavior, and extra note fields are stripped.';
export const ANKI_APKG_MAX_BYTES = 25 * 1024 * 1024;

export type AnkiNoteRow = {
  id: number;
  flds: string;
};

export interface ParseAnkiResult {
  cards: CSVCard[];
  errors: string[];
  warnings: string[];
}

export interface ParseAnkiBatchedResult {
  cardsAdded: number;
  errors: string[];
  warnings: string[];
}

function normalizeBase64Payload(payload: string): string {
  return payload.trim().replace(/\s+/g, '');
}

function decodeBase64(payload: string): Buffer | null {
  const normalized = normalizeBase64Payload(payload);
  if (!normalized) {
    return null;
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    return null;
  }

  const inputNoPadding = normalized.replace(/=+$/, '');
  const outputNoPadding = decoded.toString('base64').replace(/=+$/, '');
  if (inputNoPadding !== outputNoPadding) {
    return null;
  }

  return decoded;
}

function isSupportedMediaSrc(src: string): boolean {
  const normalized = src.trim().toLowerCase();
  return normalized.startsWith('https://')
    || normalized.startsWith('http://')
    || normalized.startsWith('//')
    || normalized.startsWith('data:');
}

function stripUnsupportedAnkiMarkup(content: string): { value: string; stripped: boolean } {
  let stripped = false;
  let value = content;

  const withoutSoundTags = value.replace(SOUND_TAG_REGEX, '');
  if (withoutSoundTags !== value) {
    stripped = true;
    value = withoutSoundTags;
  }

  const withoutCloze = value.replace(CLOZE_REGEX, '$1');
  if (withoutCloze !== value) {
    stripped = true;
    value = withoutCloze;
  }

  const withoutTemplates = value.replace(TEMPLATE_REGEX, '');
  if (withoutTemplates !== value) {
    stripped = true;
    value = withoutTemplates;
  }

  const withoutLocalMedia = value.replace(MEDIA_TAG_REGEX, (fullMatch, _tag, _quote, src: string) => {
    if (isSupportedMediaSrc(src)) {
      return fullMatch;
    }
    stripped = true;
    return '';
  });

  return { value: withoutLocalMedia, stripped };
}

type ParseAnkiWarningStats = {
  notesWithExtraFields: number;
  notesWithUnsupportedMarkup: number;
};

function createWarningStats(): ParseAnkiWarningStats {
  return {
    notesWithExtraFields: 0,
    notesWithUnsupportedMarkup: 0,
  };
}

function buildWarnings(stats: ParseAnkiWarningStats): string[] {
  const warnings: string[] = [ANKI_IMPORT_LIMITATION_WARNING];

  if (stats.notesWithExtraFields > 0) {
    warnings.push(`Stripped extra note fields (beyond front/back) in ${stats.notesWithExtraFields} notes.`);
  }

  if (stats.notesWithUnsupportedMarkup > 0) {
    warnings.push(`Stripped unsupported Anki markup/media references in ${stats.notesWithUnsupportedMarkup} notes.`);
  }

  return warnings;
}

function parseAnkiRow(
  row: AnkiNoteRow,
  warningStats: ParseAnkiWarningStats,
  frontFieldIndex = 0,
  backFieldIndex = 1,
): { card: CSVCard | null; error: string | null } {
  const fields = row.flds.split(NOTE_FIELD_SEPARATOR);

  const usedIndices = new Set([frontFieldIndex, backFieldIndex]);
  const extraFields = fields.filter((field, idx) => !usedIndices.has(idx) && field.trim().length > 0);
  if (extraFields.length > 0) {
    warningStats.notesWithExtraFields += 1;
  }

  const frontRaw = fields[frontFieldIndex]?.trim() ?? '';
  const backRaw = fields[backFieldIndex]?.trim() ?? '';

  if (!frontRaw || !backRaw) {
    return {
      card: null,
      error: `Note ${row.id}: Missing front/back fields at indices ${frontFieldIndex}/${backFieldIndex}.`,
    };
  }

  const frontStripped = stripUnsupportedAnkiMarkup(frontRaw);
  const backStripped = stripUnsupportedAnkiMarkup(backRaw);
  if (frontStripped.stripped || backStripped.stripped) {
    warningStats.notesWithUnsupportedMarkup += 1;
  }

  const front = sanitizeHtml(frontStripped.value.trim());
  const back = sanitizeHtml(backStripped.value.trim());
  if (!front || !back) {
    return {
      card: null,
      error: `Note ${row.id}: Front/back became empty after stripping unsupported features.`,
    };
  }

  return { card: { front, back }, error: null };
}

export function parseAnkiNotes(rows: AnkiNoteRow[], frontFieldIndex = 0, backFieldIndex = 1): ParseAnkiResult {
  const cards: CSVCard[] = [];
  const errors: string[] = [];
  const warningStats = createWarningStats();

  for (const row of rows) {
    const parsed = parseAnkiRow(row, warningStats, frontFieldIndex, backFieldIndex);
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }

    if (parsed.card) {
      cards.push(parsed.card);
    }
  }

  return { cards, errors, warnings: buildWarnings(warningStats) };
}

function normalizeRows(raw: unknown): AnkiNoteRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: AnkiNoteRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawId = (item as Record<string, unknown>).id;
    const rawFlds = (item as Record<string, unknown>).flds;

    if ((typeof rawId !== 'number' && typeof rawId !== 'string') || typeof rawFlds !== 'string') {
      continue;
    }

    const parsedId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(parsedId)) {
      continue;
    }

    rows.push({
      id: parsedId,
      flds: rawFlds,
    });
  }

  return rows;
}

async function listZipEntries(apkgPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('unzip', ['-Z1', apkgPath], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function findCollectionEntry(entries: string[]): string | null {
  const preferred = entries.find((entry) => /^collection\.anki(?:2|21|21b)$/i.test(path.basename(entry)));
  if (preferred) {
    return preferred;
  }

  const fallback = entries.find((entry) => /^collection\.anki/i.test(path.basename(entry)));
  return fallback ?? null;
}

async function extractCollection(apkgPath: string, entry: string, outputPath: string): Promise<void> {
  const { stdout } = await execFileAsync('unzip', ['-p', apkgPath, entry], {
    encoding: 'buffer',
    maxBuffer: 50 * 1024 * 1024,
  });

  const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (data.length === 0) {
    throw new Error('Collection database extraction returned no data.');
  }

  // Modern Anki (2.1.50+) uses Zstd for collection.anki21.
  // Zstd frames start with 0xFD2FB528 (little-endian).
  const isZstd = data.length > 4 && data.readUInt32LE(0) === 0xFD2FB528;

  if (isZstd) {
    const tempZstdPath = `${outputPath}.zst`;
    await fs.writeFile(tempZstdPath, data);
    try {
      await execFileAsync('zstd', ['-d', '--force', tempZstdPath, '-o', outputPath]);
    } finally {
      await fs.rm(tempZstdPath, { force: true });
    }
  } else {
    await fs.writeFile(outputPath, data);
  }
}

async function queryNotesBatch(collectionPath: string, afterId: number, limit: number): Promise<AnkiNoteRow[]> {
  const safeAfterId = Number.isFinite(afterId) ? Math.floor(afterId) : Number.MIN_SAFE_INTEGER;
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
  const sql = `SELECT id, flds FROM notes WHERE id > ${safeAfterId} ORDER BY id LIMIT ${safeLimit};`;
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', collectionPath, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout || '[]') as unknown;
  return normalizeRows(parsed);
}

export interface AnkiFieldInfo {
  name: string;
  index: number;
  sample: string;
}

async function queryFieldNames(collectionPath: string): Promise<AnkiFieldInfo[]> {
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', collectionPath, 'SELECT models FROM col LIMIT 1;'], {
      maxBuffer: 5 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout || '[]') as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const row = rows[0] as Record<string, unknown>;
    const modelsJson = typeof row.models === 'string' ? row.models : null;
    if (!modelsJson) return [];
    const models = JSON.parse(modelsJson) as Record<string, { flds?: { name: string }[] }>;
    const fieldNames: string[] = [];
    for (const model of Object.values(models)) {
      if (Array.isArray(model.flds)) {
        for (const fld of model.flds) {
          if (typeof fld.name === 'string' && !fieldNames.includes(fld.name)) {
            fieldNames.push(fld.name);
          }
        }
      }
    }
    return fieldNames.map((name, index) => ({ name, index, sample: '' }));
  } catch {
    return [];
  }
}

async function querySampleNoteFields(collectionPath: string, maxFields: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', collectionPath, 'SELECT flds FROM notes ORDER BY id LIMIT 1;'], {
      maxBuffer: 1 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout || '[]') as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const row = rows[0] as Record<string, unknown>;
    const flds = typeof row.flds === 'string' ? row.flds : '';
    return flds.split(NOTE_FIELD_SEPARATOR).slice(0, maxFields).map((f) => f.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  } catch {
    return [];
  }
}

export interface ParseAnkiFieldsResult {
  fields: AnkiFieldInfo[];
  noteCount: number;
}

export async function previewAnkiApkgFields(apkgBase64: string): Promise<ParseAnkiFieldsResult> {
  const decoded = decodeBase64(apkgBase64);
  if (!decoded) return { fields: [], noteCount: 0 };
  if (decoded.length > ANKI_APKG_MAX_BYTES) return { fields: [], noteCount: 0 };

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'libresrs-anki-preview-'));
  const apkgPath = path.join(tempDir, 'deck.apkg');
  const collectionPath = path.join(tempDir, 'collection.anki2');

  try {
    await fs.writeFile(apkgPath, decoded);
    const entries = await listZipEntries(apkgPath);
    const collectionEntry = findCollectionEntry(entries);
    if (!collectionEntry) return { fields: [], noteCount: 0 };
    await extractCollection(apkgPath, collectionEntry, collectionPath);

    const [fieldInfos, samples] = await Promise.all([
      queryFieldNames(collectionPath),
      querySampleNoteFields(collectionPath, 20),
    ]);

    const { stdout: countOut } = await execFileAsync('sqlite3', ['-readonly', '-json', collectionPath, 'SELECT COUNT(*) as cnt FROM notes;'], {
      maxBuffer: 1 * 1024 * 1024,
    });
    const countRows = JSON.parse(countOut || '[]') as unknown;
    const noteCount = Array.isArray(countRows) && countRows.length > 0
      ? Number((countRows[0] as Record<string, unknown>).cnt ?? 0)
      : 0;

    const fields = fieldInfos.map((f) => ({ ...f, sample: samples[f.index] ?? '' }));
    return { fields, noteCount };
  } catch {
    return { fields: [], noteCount: 0 };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function parseAnkiApkgBase64InBatches(input: {
  apkgBase64: string;
  noteBatchSize?: number;
  frontFieldIndex?: number;
  backFieldIndex?: number;
  onBatch: (cards: CSVCard[]) => Promise<void>;
}): Promise<ParseAnkiBatchedResult> {
  logger.info({
    event: 'anki.parse.start',
    payloadChars: input.apkgBase64.length,
    requestedBatchSize: input.noteBatchSize ?? null,
  }, 'Starting Anki deck parse');

  const decoded = decodeBase64(input.apkgBase64);
  if (!decoded) {
    logger.warn({
      event: 'anki.parse.invalid_payload',
      payloadChars: input.apkgBase64.length,
    }, 'Anki deck payload failed base64 validation');
    return {
      cardsAdded: 0,
      errors: ['Invalid Anki deck payload.'],
      warnings: [ANKI_IMPORT_LIMITATION_WARNING],
    };
  }

  if (decoded.length > ANKI_APKG_MAX_BYTES) {
    logger.warn({
      event: 'anki.parse.payload_too_large',
      payloadBytes: decoded.length,
      maxBytes: ANKI_APKG_MAX_BYTES,
    }, 'Anki deck payload exceeded max size');
    return {
      cardsAdded: 0,
      errors: [`Anki deck is too large. Maximum size is ${Math.floor(ANKI_APKG_MAX_BYTES / (1024 * 1024))} MB.`],
      warnings: [ANKI_IMPORT_LIMITATION_WARNING],
    };
  }

  const noteBatchSize = Math.min(1000, Math.max(1, Math.floor(input.noteBatchSize ?? 250)));
  const frontFieldIndex = Math.max(0, Math.floor(input.frontFieldIndex ?? 0));
  const backFieldIndex = Math.max(0, Math.floor(input.backFieldIndex ?? 1));
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'libresrs-anki-import-'));
  const apkgPath = path.join(tempDir, 'deck.apkg');
  const collectionPath = path.join(tempDir, 'collection.anki2');
  const warningStats = createWarningStats();
  const errors: string[] = [];
  let cardsAdded = 0;

  try {
    logger.debug({
      event: 'anki.parse.workspace.created',
      tempDir,
      noteBatchSize,
    }, 'Created temporary Anki import workspace');
    await fs.writeFile(apkgPath, decoded);

    const entries = await listZipEntries(apkgPath);
    const collectionEntry = findCollectionEntry(entries);
    logger.debug({
      event: 'anki.parse.entries_listed',
      entryCount: entries.length,
      hasCollectionEntry: Boolean(collectionEntry),
    }, 'Read Anki package entries');
    if (!collectionEntry) {
      logger.warn({
        event: 'anki.parse.collection_missing',
      }, 'Anki package did not contain a collection database');
      return {
        cardsAdded: 0,
        errors: ['No Anki collection database was found in the uploaded deck.'],
        warnings: buildWarnings(warningStats),
      };
    }

    await extractCollection(apkgPath, collectionEntry, collectionPath);

    let sawRows = false;
    let lastId = Number.MIN_SAFE_INTEGER;
    let batchCount = 0;
    let noteRowsRead = 0;

    while (true) {
      const rows = await queryNotesBatch(collectionPath, lastId, noteBatchSize);
      if (rows.length === 0) {
        break;
      }

      batchCount += 1;
      noteRowsRead += rows.length;
      sawRows = true;
      const currentBatchCards: CSVCard[] = [];
      for (const row of rows) {
        const parsed = parseAnkiRow(row, warningStats, frontFieldIndex, backFieldIndex);
        if (parsed.error) {
          errors.push(parsed.error);
          continue;
        }

        if (parsed.card) {
          currentBatchCards.push(parsed.card);
        }
      }

      if (currentBatchCards.length > 0) {
        await input.onBatch(currentBatchCards);
        cardsAdded += currentBatchCards.length;
      }

      logger.debug({
        event: 'anki.parse.batch_processed',
        batchNumber: batchCount,
        rowsReadInBatch: rows.length,
        cardsInBatch: currentBatchCards.length,
        totalRowsRead: noteRowsRead,
        totalCardsAdded: cardsAdded,
        totalErrors: errors.length,
      }, 'Processed Anki notes batch');
      lastId = rows[rows.length - 1]?.id ?? lastId;
    }

    if (!sawRows) {
      logger.warn({
        event: 'anki.parse.no_notes',
      }, 'Anki deck contained no note rows');
      return {
        cardsAdded: 0,
        errors: ['No notes were found in the uploaded Anki deck.'],
        warnings: buildWarnings(warningStats),
      };
    }

    logger.info({
      event: 'anki.parse.finish',
      cardsAdded,
      errors: errors.length,
      warnings: buildWarnings(warningStats).length,
    }, 'Finished parsing Anki deck');
    return {
      cardsAdded,
      errors,
      warnings: buildWarnings(warningStats),
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      logger.error({
        event: 'anki.parse.missing_system_tools',
        err: error,
      }, 'Anki import dependencies are missing from the host');
      errors.push('Anki import requires system tools "unzip", "sqlite3", and "zstd".');
      return {
        cardsAdded,
        errors,
        warnings: buildWarnings(warningStats),
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      event: 'anki.parse.failed',
      err: error,
      cardsAdded,
      errorMessage: message,
    }, 'Anki deck parse failed');
    errors.push(`Failed to parse Anki deck: ${message}`);
    return {
      cardsAdded,
      errors,
      warnings: buildWarnings(warningStats),
    };
  } finally {
    logger.debug({
      event: 'anki.parse.workspace.cleanup',
      tempDir,
    }, 'Cleaning up temporary Anki import workspace');
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function parseAnkiApkgBase64(apkgBase64: string): Promise<ParseAnkiResult> {
  const cards: CSVCard[] = [];
  const result = await parseAnkiApkgBase64InBatches({
    apkgBase64,
    onBatch: async (batch) => {
      cards.push(...batch);
    },
  });

  return {
    cards,
    errors: result.errors,
    warnings: result.warnings,
  };
}
