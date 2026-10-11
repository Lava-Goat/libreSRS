// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Accessibility scans with axe-core, for the e2e specs.
 *
 * axe-core is a root devDependency pinned to one exact version, not left to
 * arrive through eslint-plugin-jsx-a11y: a lint upgrade must not change the
 * rule set or the contrast maths under the scans. Its script is injected into
 * the page and run there.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AxeResults, NodeResult, Result, RunOptions } from 'axe-core';

/** WCAG 2.0, 2.1 and 2.2, levels A and AA: the bar a school site is held to. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * Best-practice rules on top of WCAG, each one a thing a screen-reader or
 * keyboard user actually trips on: landmarks to jump between, headings that
 * outline the page, a name on every dialog, a skip link that lands somewhere,
 * no positive tabindex. Left out: frame-tested (no iframes here) and the
 * experimental rules, which axe itself leaves out by default.
 */
export const BEST_PRACTICE_RULES = [
  'accesskeys',
  'aria-allowed-role',
  'aria-dialog-name',
  'aria-text',
  'aria-treeitem-name',
  'empty-heading',
  'empty-table-header',
  'heading-order',
  'image-redundant-alt',
  'label-title-only',
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
  'meta-viewport-large',
  'page-has-heading-one',
  'presentation-role-conflict',
  'region',
  'scope-attr-valid',
  'skip-link',
  'tabindex',
  'table-duplicate-name',
] as const;

export interface A11yScanOptions {
  /** Scan only these (CSS selectors), e.g. an open dialog. Page-level rules (landmarks, h1, title) then do not run. */
  include?: string[];
  /** Leave these out (CSS selectors). Say why at the call. */
  exclude?: string[];
  /** Rule ids not to run. Say why at the call. */
  disableRules?: string[];
  /** What the scan looked at, for the failure message; the page's path when left out. */
  label?: string;
  /** Record the failure and carry on, for a test that scans several states in a row. */
  soft?: boolean;
}

let axeSourcePath: string | undefined;

/**
 * Resolved from the running spec, then the config's directory, then the working
 * directory (not from this file: `require` and `import.meta` each exist in only
 * one of Playwright's CJS and ESM loaders).
 */
function axePath(): string {
  if (!axeSourcePath) {
    const info = test.info();
    const anchors = [info.file, path.join(info.config.rootDir, 'package.json'), path.join(process.cwd(), 'package.json')];
    for (const anchor of anchors) {
      try {
        axeSourcePath = createRequire(anchor).resolve('axe-core/axe.min.js');
        break;
      } catch { /* not under this anchor: try the next */ }
    }
    if (!axeSourcePath) throw new Error(`axe-core not found from ${anchors.join(', ')}. Run npm ci at the repository root.`);
  }
  return axeSourcePath;
}

const hasAxe = (page: Page) => page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe === 'object');

/** Once per document: a navigation or reload starts a fresh one without axe. */
async function injectAxe(page: Page): Promise<void> {
  if (await hasAxe(page)) return;
  await page.addScriptTag({ path: axePath() });
  if (!(await hasAxe(page))) {
    // The Vite dev server sends no CSP; a server that does would block the injected script.
    throw new Error('axe-core did not load in the page. Is a Content-Security-Policy blocking inline scripts? Use bypassCSP: true for that test.');
  }
}

/** The violations axe finds on the page as it stands now. */
export async function a11yViolations(page: Page, options: A11yScanOptions = {}): Promise<Result[]> {
  await injectAxe(page);
  const rules: NonNullable<RunOptions['rules']> = {};
  for (const id of BEST_PRACTICE_RULES) rules[id] = { enabled: true };
  for (const id of options.disableRules ?? []) rules[id] = { enabled: false };
  const runOptions: RunOptions = {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
    rules,
    resultTypes: ['violations'],
  };
  const context = {
    ...(options.include?.length ? { include: options.include.map((s) => [s]) } : {}),
    ...(options.exclude?.length ? { exclude: options.exclude.map((s) => [s]) } : {}),
  };
  const results = await page.evaluate(
    async ([ctx, opts]) => {
      const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<AxeResults> } }).axe;
      // No include means the whole document, so page-level rules (landmarks, h1, title) run too.
      return axe.run(Object.keys(ctx).length > 0 ? ctx : document, opts);
    },
    [context, runOptions] as const,
  );
  return results.violations;
}

/** One line of what is wrong at a node: the check's own message (for contrast, the colours and ratio). */
function nodeProblem(node: NodeResult): string {
  const checks = [...node.any, ...node.all, ...node.none];
  const messages = [...new Set(checks.map((c) => c.message).filter(Boolean))];
  if (messages.length > 0) return messages.join(' / ');
  return (node.failureSummary ?? '').replace(/\s+/g, ' ').trim();
}

const oneLine = (html: string, max = 180) => {
  const flat = html.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** A readable list: each rule with its impact, then every element it flagged and what is wrong there. */
export function formatViolations(where: string, violations: Result[]): string {
  const count = violations.reduce((n, v) => n + v.nodes.length, 0);
  const lines = [`axe: ${violations.length} rule(s), ${count} element(s) failing on ${where}`];
  for (const v of violations) {
    lines.push('', `${v.id} [${v.impact ?? 'unknown'}] ${v.help}`, `  ${v.helpUrl}`);
    for (const node of v.nodes) {
      lines.push(`  - ${node.target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(' | ')}`);
      lines.push(`      ${oneLine(node.html)}`);
      lines.push(`      ${nodeProblem(node)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Fails the test with a readable list (rule, impact, element, what is wrong)
 * when axe finds WCAG 2.0–2.2 A/AA or best-practice violations. The full axe
 * result is attached to the test for the HTML report.
 */
export async function expectNoA11yViolations(page: Page, options: A11yScanOptions = {}): Promise<void> {
  const violations = await a11yViolations(page, options);
  const url = new URL(page.url());
  const where = options.label ?? `${url.pathname}${url.search}`;
  if (violations.length > 0) {
    await test.info().attach(`axe violations: ${where}`, {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  }
  (options.soft ? expect.soft : expect)(
    violations.map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`),
    formatViolations(where, violations),
  ).toEqual([]);
}
