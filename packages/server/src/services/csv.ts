// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import Papa from 'papaparse';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { logger } from '../logger.js';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const ALLOWED_TAGS = [
  'b',
  'i',
  'u',
  'strong',
  'em',
  'span',
  'br',
  'p',
  'ul',
  'ol',
  'li',
  'img',
  'audio',
  'source',
];
const ALLOWED_ATTR = [
  'style',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'loading',
  'decoding',
  'controls',
  'autoplay',
  'loop',
  'muted',
  'preload',
  'playsinline',
  'type',
];
const ALLOWED_STYLES = ['color', 'font-size', 'font-weight', 'font-style', 'text-decoration'];

function sanitizeStyle(style: string): string {
  const styleMap = new Map<string, string>();
  const parts = style.split(';');

  for (const part of parts) {
    const [prop, value] = part.split(':').map(s => s.trim());
    if (prop && value && ALLOWED_STYLES.includes(prop.toLowerCase())) {
      styleMap.set(prop.toLowerCase(), value);
    }
  }

  return Array.from(styleMap.entries())
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
}

export function sanitizeHtml(html: string): string {
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && data.attrValue) {
      data.attrValue = sanitizeStyle(data.attrValue);
    }
  });

  const clean = purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });

  purify.removeAllHooks();
  return clean;
}

export interface CSVCard {
  front: string;
  back: string;
  mnemonic?: string | null;
  audioFront?: string | null;
  audioBack?: string | null;
  imageFront?: string | null;
  imageBack?: string | null;
}

export interface ParseResult {
  cards: CSVCard[];
  errors: string[];
}

export function parseCSV(csvContent: string): ParseResult {
  logger.debug({
    event: 'csv.parse.start',
    charCount: csvContent.length,
  }, 'Parsing CSV content');

  const errors: string[] = [];
  const cards: CSVCard[] = [];

  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.toLowerCase().trim(),
  });

  if (result.errors.length > 0) {
    logger.warn({
      event: 'csv.parse.parser_errors',
      errorCount: result.errors.length,
    }, 'CSV parser reported row errors');
    for (const error of result.errors) {
      errors.push(`Row ${error.row}: ${error.message}`);
    }
  }

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i];
    const front = row['front'];
    const back = row['back'];

    if (!front || !back) {
      logger.debug({
        event: 'csv.parse.row_missing_columns',
        rowNumber: i + 2,
      }, 'CSV row missing front/back fields');
      errors.push(`Row ${i + 2}: Missing 'front' or 'back' column`);
      continue;
    }

    // Only the columns below are read: any other, such as the cognate_score column of a file
    // exported before v1.20.0, is ignored.
    cards.push({
      front: sanitizeHtml(front.trim()),
      back: sanitizeHtml(back.trim()),
      mnemonic: row['mnemonic']?.trim() || undefined,
      audioFront: row['audio_front']?.trim() || undefined,
      audioBack: row['audio_back']?.trim() || undefined,
      imageFront: row['image_front']?.trim() || undefined,
      imageBack: row['image_back']?.trim() || undefined,
    });
  }

  logger.info({
    event: 'csv.parse.finish',
    cardsParsed: cards.length,
    errorCount: errors.length,
    inputRows: result.data.length,
  }, 'Finished parsing CSV content');
  return { cards, errors };
}
