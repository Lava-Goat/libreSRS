// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The block structure of the legal pages' Markdown: the small subset the server's templates use
 * (packages/server/src/legal/defaults/*.md, or an extension's legal/*.md), parsed without a
 * dependency so tables, captions and heading ids render exactly as the pages need
 * (LegalMarkdown.tsx). Inline formatting stays as text here and is parsed when rendered.
 *
 * Blocks: headings ("## Title {#id}", or "## Title {#id #alias}": the alias is a second id that
 * lands on the same heading, so an older link keeps working), paragraphs (a line ending in "\" breaks the line), "-" and
 * "1." lists, GFM tables (a "<caption>…</caption>" line just before one is its caption), "---"
 * rules and "> " quotes.
 */
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; aliases: string[]; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'table'; caption: string | null; header: string[]; rows: string[][] }
  | { type: 'rule' }
  | { type: 'quote'; blocks: Block[] };

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+\{#([A-Za-z0-9-]+)((?:\s+#[A-Za-z0-9-]+)*)\})?\s*$/;
const ITEM_RE = /^([-*]|(\d+)\.)\s+(.*)$/;
const CAPTION_RE = /^<caption>(.*)<\/caption>$/;
const SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A heading's id when it names none: lower case, letters and digits joined by "-". */
export function slugify(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[`*_[\]()"'.,:;!?]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/** A table row's cells: split on "|" (not "\|"), the outer pipes dropped, each trimmed. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (text[i] === '|') { cells.push(current.trim()); current = ''; continue; }
    current += text[i];
  }
  cells.push(current.trim());
  return cells;
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();
  let caption: string | null = null;
  let i = 0;

  const uniqueId = (id: string) => {
    const n = usedIds.get(id) ?? 0;
    usedIds.set(id, n + 1);
    return n === 0 ? id : `${id}-${n + 1}`;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    const cap = CAPTION_RE.exec(trimmed);
    if (cap) { caption = cap[1].trim(); i++; continue; }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      const text = heading[2];
      const id = uniqueId(heading[3] ?? slugify(text));
      const aliases = (heading[4] ?? '').split(/\s+/).filter(Boolean).map((a) => uniqueId(a.slice(1)));
      blocks.push({ type: 'heading', level: heading[1].length as 1, id, aliases, text });
      caption = null;
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { blocks.push({ type: 'rule' }); i++; continue; }

    if (trimmed.startsWith('|') && i + 1 < lines.length && SEPARATOR_RE.test(lines[i + 1].trim())) {
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: 'table', caption, header, rows });
      caption = null;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner.join('\n')) });
      continue;
    }

    const item = ITEM_RE.exec(trimmed);
    if (item) {
      const ordered = item[2] !== undefined;
      const start = ordered ? Number(item[2]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const current = ITEM_RE.exec(lines[i].trim());
        if (current && (current[2] !== undefined) === ordered) {
          items.push(current[3]);
          i++;
          continue;
        }
        // An indented line continues the item before it.
        if (items.length > 0 && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    // A paragraph: this line and the next ones, until a blank line or the start of another block.
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (next === '' || HEADING_RE.test(next) || CAPTION_RE.test(next) || /^(-{3,}|\*{3,})$/.test(next)
        || ITEM_RE.test(next) || next.startsWith('|') || next.startsWith('>')) break;
      para.push(next);
      i++;
    }
    blocks.push({ type: 'paragraph', lines: para });
  }
  return blocks;
}

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

/** The inline formatting of one line: **strong**, *em*, `code`, [text](href), and "\" escapes. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => { if (buffer) { out.push({ type: 'text', text: buffer }); buffer = ''; } };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#|{}<>!.-]/.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) { flush(); out.push({ type: 'code', text: text.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (ch === '*' && text[i + 1] !== ' ') {
      const end = findEmEnd(text, i + 1);
      if (end > i + 1) { flush(); out.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    if (ch === '[') {
      const close = matchingBracket(text, i);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          flush();
          out.push({ type: 'link', href: text.slice(close + 2, paren).trim(), children: parseInline(text.slice(i + 1, close)) });
          i = paren + 1;
          continue;
        }
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** The closing "*" of an emphasis opened just before `from` (not one that is half of "**"). */
function findEmEnd(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '*' && text[j + 1] === '*') { j++; continue; }
    if (text[j] === '*' && text[j - 1] !== ' ') return j;
  }
  return -1;
}

function matchingBracket(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '[') depth++;
    if (text[j] === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}
