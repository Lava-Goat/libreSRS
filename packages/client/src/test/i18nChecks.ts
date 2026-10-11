// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What the messages tests read from the code: each text handed to t() as a literal,
 * every string literal, and a text's {{placeholders}}. Shared by core's
 * i18n/messages.test.ts and each extension's own messages test, which pass the
 * sources they cover (import.meta.glob, raw text keyed by path).
 */
import ts from 'typescript';

export type Sources = Record<string, string>;

/** The texts an argument can be: 'text', or each side of cond ? 'a' : 'b'. */
export function literals(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  return [];
}

function parse(path: string, text: string): ts.SourceFile {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

/**
 * Each text the code passes to t() as a literal, with the first place it is used
 * (the path with `strip` taken off its front, then :line).
 */
export function textsForT(sources: Sources, strip: RegExp = /^\.\.\//): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, text] of Object.entries(sources)) {
    const source = parse(path, text);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments.length > 0) {
        for (const literal of literals(node.arguments[0])) {
          if (!found.has(literal)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            found.set(literal, `${path.replace(strip, '')}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/**
 * Every string literal in the code. A key the code reaches through a table (a lab log's
 * "Paused at") is passed to t() as a variable, so it is found here.
 */
export function literalsInCode(sources: Sources): Set<string> {
  const found = new Set<string>();
  for (const [path, text] of Object.entries(sources)) {
    const source = parse(path, text);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** A text's {{placeholders}}, sorted, as one string. */
export const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort().join(', ');

/**
 * Each “quoted” name in an English text that is itself a key (a button, "All Done!"),
 * and the texts whose translation does not quote that key's translation.
 */
export function quotedButtons(
  texts: Record<string, string>,
  lookup: (name: string) => string | undefined,
): { quoted: string[]; wrong: string[] } {
  const quoted: string[] = [];
  const wrong: string[] = [];
  for (const [english, translated] of Object.entries(texts)) {
    for (const [, name] of english.matchAll(/“([^”]+)”/g)) {
      const translatedName = lookup(name);
      if (translatedName === undefined) continue;
      quoted.push(name);
      if (!translated.includes(translatedName)) wrong.push(`${english} (${name} is “${translatedName}”)`);
    }
  }
  return { quoted, wrong };
}
