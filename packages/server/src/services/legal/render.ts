// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The legal pages as Markdown, ready for the client's renderer: a page's template, with its
 * placeholders filled from the operator configuration (operatorConfig.ts), the loaded extensions'
 * disclosures (extensions/api.ts, PrivacyDisclosures) and a few values the code itself knows.
 * Filled BEFORE parsing, so no "{{" ever reaches a reader.
 *
 * The template is this instance's own when an extension supplies one (LegalDocumentSet, with any
 * operator fields and computed placeholders it declares), else core's default
 * (src/legal/defaults/*.md, copied beside the build in dist/legal/defaults): short neutral pages
 * that tell the operator to publish its own, and state only what the software itself does and
 * what the site's settings show right now.
 *
 * Template syntax (a deliberately small one):
 *   {{name}}                the value ("" leaves the sentence without it, and the space before it)
 *   {{?name|text}}          text, only when name has a value     {{!name|text}}  only when it has none
 *   {{include: file.md}}    another page's body (its H1 dropped, its headings one level down)
 * A line that held a {{?…}}/{{!…}} and comes out empty is dropped, so a conditional table row
 * leaves no gap in its table. Front matter (title, version, lang) sits between "---" lines on top.
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { CombinedPrivacyDisclosures, PriorLegalVersion } from '../../extensions/api.js';
import { MISSING, OPERATOR_FIELDS, OPERATOR_FIELD_KEYS, readOperatorConfig, resolveOperatorValues } from './operatorConfig.js';
import { AI_COMPUTED_KEYS, aiLegalValues, type AiLegalState } from './aiDisclosure.js';

export const LEGAL_DOCUMENTS = ['privacy', 'privacy-summary', 'terms', 'subprocessors', 'coppa-notice'] as const;
export type LegalDocumentName = (typeof LEGAL_DOCUMENTS)[number];

const FILES: Record<LegalDocumentName, string> = {
  privacy: 'privacy-policy.md',
  'privacy-summary': 'privacy-summary.md',
  terms: 'terms-of-service.md',
  subprocessors: 'subprocessors.md',
  'coppa-notice': 'coppa-notice.md',
};

/** The page each template file name stands for (an {{include}} names a page by it). */
const NAME_OF_FILE: ReadonlyMap<string, LegalDocumentName> = new Map(
  (Object.entries(FILES) as [LegalDocumentName, string][]).map(([name, file]) => [file, name]),
);

/** Templates an extension supplies in place of core's defaults, by page. */
export type LegalDocumentTexts = Readonly<Partial<Record<LegalDocumentName, string>>>;

/** Placeholders the code fills (never operator configuration). */
export const COMPUTED_KEYS = [
  'security_txt_statement',
  'clever_disabled',
  'instance_specific_disclosures',
  'extension_disclosures',
  'instance_disclosures_short',
  'privacy_prior_versions',
  'terms_prior_versions',
  'planned_changes_instance',
  'instance_subprocessor_rows',
  'instance_subprocessor_sections',
  ...AI_COMPUTED_KEYS,
] as const;

export const NO_INSTANCE_DISCLOSURES = 'None: this instance sends student data to no school-directed system.';

export interface LegalFrontMatter { title: string; version: string; lang: string }

export interface RenderedLegalDocument extends LegalFrontMatter {
  name: string;
  markdown: string;
  /** False until the operator has named itself: the page then says it has not been filled in. */
  configured: boolean;
}

export interface RenderContext {
  env?: NodeJS.ProcessEnv;
  privacy: CombinedPrivacyDisclosures;
  /** Whether students can sign in with Clever here (services/setupState.ts). */
  cleverEnabled: boolean;
  /**
   * This instance's AI settings, read for this request (aiDisclosure.ts), or null when they could
   * not be read: the AI wording then claims nothing about what is switched on.
   */
  ai: AiLegalState | null;
}

const here = dirname(fileURLToPath(import.meta.url));
/** Core's defaults: src/legal/defaults (tsx), or dist/legal/defaults (the build). */
export const LEGAL_DIR = resolve(here, '../../legal/defaults');

const cache = new Map<string, string>();
function readTemplate(file: string): string {
  if (!NAME_OF_FILE.has(file)) throw new Error(`Not a legal template: ${file}`);
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(resolve(LEGAL_DIR, file), 'utf8').replace(/\r\n/g, '\n');
    if (process.env.NODE_ENV === 'production') cache.set(file, text);
  }
  return text;
}

export function splitFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: text.slice(m[0].length) };
}

/** A page's template: the extension's text when one is given, else core's default. */
function templateOf(name: LegalDocumentName, documents: LegalDocumentTexts = {}): string {
  const own = documents[name];
  return typeof own === 'string' ? own.replace(/\r\n/g, '\n') : readTemplate(FILES[name]);
}

/** A page's body for {{include}}: no front matter, no H1, every heading one level down. */
export function includedBody(file: string, documents: LegalDocumentTexts = {}): string {
  const name = NAME_OF_FILE.get(file);
  if (!name) throw new Error(`Not a legal template: ${file}`);
  const { body } = splitFrontMatter(templateOf(name, documents));
  const lines = body.split('\n');
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 >= 0) lines.splice(h1, 1);
  return lines.map((l) => (/^#{1,5} /.test(l) ? `#${l}` : l)).join('\n').trim();
}

function expandIncludes(body: string, documents: LegalDocumentTexts): string {
  return body.replace(/^\{\{include:\s*([a-z0-9-]+\.md)\s*\}\}$/gm, (_m, file: string) => includedBody(file, documents));
}

/** The index just past the "}}" that closes the "{{" at `start`, counting nested pairs; -1 if none. */
function closingOf(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; continue; }
    if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export class UnknownPlaceholderError extends Error {}

/** Expands every {{…}} in one piece of text. */
function expand(text: string, values: Record<string, string>): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) { out += text.slice(i); break; }
    out += text.slice(i, open);
    const close = closingOf(text, open);
    if (close < 0) throw new UnknownPlaceholderError(`Unclosed placeholder: ${text.slice(open, open + 40)}`);
    const inner = text.slice(open + 2, close - 2);
    const cond = /^([?!])([a-z0-9_]+)\|([\s\S]*)$/.exec(inner);
    if (cond) {
      const [, sign, key, body] = cond;
      if (!(key in values)) throw new UnknownPlaceholderError(`Unknown placeholder: ${key}`);
      const has = values[key] !== '' && values[key] !== MISSING;
      if ((sign === '?') === has) out += expand(body, values);
    } else {
      const key = inner.trim();
      if (!/^[a-z0-9_]+$/.test(key) || !(key in values)) throw new UnknownPlaceholderError(`Unknown placeholder: ${key}`);
      const value = values[key];
      if (value === '') out = out.replace(/[ \t]+$/, '');
      else out += value;
    }
    i = close;
  }
  return out;
}

/** Fills a whole template body (front matter already removed); includes come from `documents`, else core. */
export function fillTemplate(body: string, values: Record<string, string>, documents: LegalDocumentTexts = {}): string {
  const lines = expandIncludes(body, documents).split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const filled = expand(line, values).replace(/,\s*(?=[;.])/g, '').replace(/[ \t]+$/, '').replace(/^[ \t]+(?=\S)/, (m) => (line.startsWith(' ') ? m : ''));
    if (filled === '' && /\{\{[?!]/.test(line)) continue;
    kept.push(filled);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function priorRows(list: readonly PriorLegalVersion[], document: 'privacy' | 'terms'): string {
  return list
    .filter((p) => p.document === document)
    .map((p) => `| ${cell(p.version)} | ${cell(p.effective)} | [/${document}/${p.slug}](/${document}/${p.slug}) | ${cell(p.summary)} |`)
    .join('\n');
}

/** The operator fields this instance's pages use: core's, then those its documents declare. */
function fieldsOf(ctx: RenderContext) {
  return ctx.privacy.fields.length > 0 ? [...OPERATOR_FIELDS, ...ctx.privacy.fields] : OPERATOR_FIELDS;
}

/** Every placeholder's value for this instance. */
export function legalValues(ctx: RenderContext): Record<string, string> {
  const fields = fieldsOf(ctx);
  const config = readOperatorConfig(ctx.env ?? process.env, fields);
  const values = resolveOperatorValues(config, ctx.privacy.values, fields);
  const contact = values.security_email !== MISSING ? values.security_email : '';
  const sections = ctx.privacy.instanceSections.map((s) => s.trim()).join('\n\n');
  const computed: Record<(typeof COMPUTED_KEYS)[number], string> = {
    security_txt_statement: contact ? 'A `security.txt` file at [/.well-known/security.txt](/.well-known/security.txt) says the same.' : '',
    clever_disabled: ctx.cleverEnabled ? '' : 'yes',
    instance_specific_disclosures: sections || NO_INSTANCE_DISCLOSURES,
    extension_disclosures: sections,
    instance_disclosures_short: ctx.privacy.summaryParagraphs.map((s) => s.trim()).join('\n\n'),
    privacy_prior_versions: priorRows(ctx.privacy.priorVersions, 'privacy'),
    terms_prior_versions: priorRows(ctx.privacy.priorVersions, 'terms'),
    planned_changes_instance: ctx.privacy.plannedChanges.map((r) => r.trim()).join('\n'),
    instance_subprocessor_rows: ctx.privacy.subprocessorRows.map((r) => r.trim()).join('\n'),
    instance_subprocessor_sections: ctx.privacy.subprocessorSections.map((s) => s.trim()).join('\n\n'),
    ...aiLegalValues(ctx.ai),
  };
  const all: Record<string, string> = { ...values, ...computed };
  // An instance's documents may work out a few more from the operator values (never one core fills).
  for (const compute of ctx.privacy.computed) {
    for (const [key, value] of Object.entries(compute({ ...values }))) {
      if (key in all) throw new Error(`An extension's computed legal placeholder reuses the name ${key}`);
      all[key] = value;
    }
  }
  return all;
}

/** True once the operator has given its name. */
export function isLegalConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readOperatorConfig(env).operator_legal_name !== '';
}

function renderText(name: string, text: string, ctx: RenderContext): RenderedLegalDocument {
  const { meta, body } = splitFrontMatter(text);
  const values = legalValues(ctx);
  const documents = ctx.privacy.documents;
  // Text an extension gives may itself hold placeholders: fill twice.
  const markdown = fillTemplate(fillTemplate(body, values, documents), values, documents);
  return {
    name,
    title: meta.title ?? name,
    version: meta.version ?? '',
    lang: meta.lang ?? 'en',
    markdown,
    configured: isLegalConfigured(ctx.env ?? process.env),
  };
}

export function renderLegalDocument(name: LegalDocumentName, ctx: RenderContext): RenderedLegalDocument {
  return renderText(name, templateOf(name, ctx.privacy.documents), ctx);
}

/** A prior version an extension keeps, or null. */
export function renderPriorLegalVersion(document: 'privacy' | 'terms', slug: string, ctx: RenderContext): RenderedLegalDocument | null {
  const prior = ctx.privacy.priorVersions.find((p) => p.document === document && p.slug === slug);
  if (!prior) return null;
  const doc = renderText(`${document}/${slug}`, prior.markdown, ctx);
  return { ...doc, version: prior.version };
}

/** Every {{placeholder}} name a text uses (conditionals included; not includes). */
export function placeholdersIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/\{\{([?!]?)([a-z0-9_]+)(?=\||\}\})/g)) names.add(m[2]);
  return names;
}

export function templateFile(name: LegalDocumentName): string {
  return FILES[name];
}

/** A page's template: `documents`' own text when it has one, else core's default. */
export function readLegalTemplate(name: LegalDocumentName, documents: LegalDocumentTexts = {}): string {
  return templateOf(name, documents);
}

export { OPERATOR_FIELD_KEYS };
