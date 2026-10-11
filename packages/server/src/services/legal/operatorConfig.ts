// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The operator's values for the legal pages (/privacy, /privacy/summary, /terms, /subprocessors,
 * /privacy/coppa-notice). The page texts name nobody: whoever runs a copy of libreSRS fills these
 * in, and a fresh install shows "[not yet stated]" where a value is needed and leaves out a
 * sentence that only makes sense once a fact exists.
 *
 * Each value comes from the environment variable LEGAL_<KEY IN CAPITALS> (for example
 * LEGAL_OPERATOR_LEGAL_NAME), set on the host (an untracked compose override or .env), never in
 * the repository. Values are trusted Markdown written by the operator. doc/legal-documents.md
 * lists core's fields; an instance's own documents declare theirs (extensions/api.ts,
 * LegalDocumentSet.fields).
 */

/** What a field shows when the operator has not set it. */
export type Fallback =
  /** "[not yet stated]": the sentence needs the value, so the gap shows. */
  | { kind: 'missing' }
  /** Nothing: the sentence (or the line holding it) is left out. */
  | { kind: 'omit' }
  /** Another field's value (privacy and security contacts fall back to support). */
  | { kind: 'field'; key: string }
  /** A neutral text that is true of the software itself. */
  | { kind: 'text'; text: string };

export interface OperatorField {
  key: string;
  fallback: Fallback;
  /** What to write there (doc/legal-documents.md repeats it for core's fields). */
  help: string;
}

export const MISSING = '[not yet stated]';

const missing: Fallback = { kind: 'missing' };
const omit: Fallback = { kind: 'omit' };

/**
 * The operator fields core's default pages use (src/legal/defaults/*.md): who runs the site and how
 * to reach them, and its source. An instance's own documents (an extension's legalDocuments, extensions/api.ts)
 * may declare more; a test checks the default pages against this list both ways.
 */
export const OPERATOR_FIELDS: readonly OperatorField[] = [
  { key: 'operator_legal_name', fallback: missing, help: 'Legal name of the operating entity, e.g. "Example Learning, Inc.".' },
  { key: 'operator_short_name', fallback: missing, help: 'The name the operator does business as.' },
  { key: 'service_domain', fallback: missing, help: 'The site\'s domain (defaults to the host of FRONTEND_URL).' },
  { key: 'support_email', fallback: missing, help: 'General contact address.' },
  { key: 'privacy_email', fallback: { kind: 'field', key: 'support_email' }, help: 'Privacy contact (falls back to the support address).' },
  { key: 'security_email', fallback: { kind: 'field', key: 'support_email' }, help: 'Security contact; also the Contact line of /.well-known/security.txt.' },
  { key: 'operator_postal_address', fallback: missing, help: 'Postal contact address.' },
  { key: 'operator_phone', fallback: missing, help: 'Contact telephone number.' },
  { key: 'source_url', fallback: omit, help: 'Public repository of the source code this site runs (unset: no link is shown).' },
];

export const OPERATOR_FIELD_KEYS: ReadonlySet<string> = new Set(OPERATOR_FIELDS.map((f) => f.key));

export function envNameFor(key: string): string {
  return `LEGAL_${key.toUpperCase()}`;
}

/** The host of FRONTEND_URL, the default service_domain. */
function frontendHost(env: NodeJS.ProcessEnv): string | null {
  const raw = env.FRONTEND_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}

/**
 * The operator's own values, as set: every field's trimmed environment value, '' where unset
 * (`fields`: core's, plus any an instance's documents declare).
 */
export function readOperatorConfig(
  env: NodeJS.ProcessEnv = process.env,
  fields: readonly OperatorField[] = OPERATOR_FIELDS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) out[field.key] = env[envNameFor(field.key)]?.trim() ?? '';
  if (!out.service_domain) out.service_domain = frontendHost(env) ?? '';
  return out;
}

/**
 * What each field shows: the operator's value, else `supplied` (an extension's value for the same
 * placeholder), else the field's fallback.
 */
export function resolveOperatorValues(
  config: Record<string, string>,
  supplied: Partial<Record<string, string>> = {},
  fields: readonly OperatorField[] = OPERATOR_FIELDS,
): Record<string, string> {
  const own = (key: string) => config[key] || supplied[key]?.trim() || '';
  const out: Record<string, string> = {};
  const resolve = (field: OperatorField, depth = 0): string => {
    const value = own(field.key);
    if (value) return value;
    const fb = field.fallback;
    if (fb.kind === 'missing') return MISSING;
    if (fb.kind === 'omit') return '';
    if (fb.kind === 'text') return fb.text;
    const other = fields.find((f) => f.key === fb.key);
    return other && depth < 3 ? resolve(other, depth + 1) : MISSING;
  };
  for (const field of fields) out[field.key] = resolve(field);
  return out;
}
