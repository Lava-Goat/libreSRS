// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The legal pages' Markdown as accessible HTML: headings with their ids (so /privacy#AI-Policy lands,
 * and an alias such as /privacy#ai on the same heading),
 * tables with a <caption>, column headers (scope="col") and a focusable, labelled scroll region
 * for narrow screens, the Spanish name "Vocabulómetro" marked lang="es", app links through the
 * router and server addresses as plain links. React elements only: no HTML string is injected.
 */
import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseBlocks, parseInline, type Block, type Inline } from './markdown';

/** The app's own pages a link may open without a reload. */
const APP_PATHS = /^\/(?:privacy(?:\/[a-z0-9-]+)?|terms(?:\/[a-z0-9-]+)?|subprocessors|login|readme)?(?:#[A-Za-z0-9-]*)?$/;

/** Words in Spanish inside the English pages. */
const SPANISH_WORDS = /(Vocabulómetro)/;

function textNodes(text: string, key: string): ReactNode {
  const parts = text.split(SPANISH_WORDS);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <span key={`${key}-${i}`} lang="es">{part}</span> : part));
}

/** An app page, opened by the router (no reload); a modified click still opens a tab as usual. */
function AppLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} className={className} onClick={onClick}>{children}</a>;
}

function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  const className = 'text-blue-700 dark:text-blue-300 underline hover:no-underline';
  if (href.startsWith('#')) return <a href={href} className={className}>{children}</a>;
  if (APP_PATHS.test(href)) return <AppLink href={href} className={className}>{children}</AppLink>;
  if (/^https?:\/\//.test(href)) {
    return <a href={href} className={className} rel="noopener noreferrer">{children}</a>;
  }
  if (/^mailto:/.test(href) || href.startsWith('/')) return <a href={href} className={className}>{children}</a>;
  // Anything else (javascript:, data:) is shown as text.
  return <>{children}</>;
}

function renderInline(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}.${i}`;
    switch (node.type) {
      case 'text': return <Fragment key={k}>{textNodes(node.text, k)}</Fragment>;
      case 'strong': return <strong key={k}>{renderInline(node.children, k)}</strong>;
      case 'em': return <em key={k}>{renderInline(node.children, k)}</em>;
      case 'code': return <code key={k} className="text-[0.9em] px-1 rounded bg-gray-100 dark:bg-gray-700">{node.text}</code>;
      case 'link': return <LegalLink key={k} href={node.href}>{renderInline(node.children, k)}</LegalLink>;
    }
  });
}

const inline = (text: string, key: string) => renderInline(parseInline(text), key);

const HEADING_CLASS: Record<number, string> = {
  1: 'text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4',
  2: 'text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-3',
  3: 'text-xl font-semibold text-gray-800 dark:text-gray-200 mt-8 mb-2',
  4: 'text-lg font-semibold text-gray-800 dark:text-gray-200 mt-6 mb-2',
  5: 'font-semibold mt-4 mb-1',
  6: 'font-semibold mt-4 mb-1',
};

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1';
      return (
        <Tag key={key} id={block.id} className={`${HEADING_CLASS[block.level]} scroll-mt-4`}>
          {block.aliases.map((alias) => <span key={alias} id={alias} />)}
          {inline(block.text, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="my-3 leading-relaxed">
          {block.lines.map((line, i) => {
            const broken = line.endsWith('\\');
            const text = broken ? line.slice(0, -1).trimEnd() : line;
            return (
              <Fragment key={i}>
                {i > 0 && !block.lines[i - 1].endsWith('\\') ? ' ' : null}
                {inline(text, `${key}.${i}`)}
                {broken && i < block.lines.length - 1 ? <br /> : null}
              </Fragment>
            );
          })}
        </p>
      );
    case 'list': {
      const items = block.items.map((item, i) => <li key={i} className="my-1">{inline(item, `${key}.${i}`)}</li>);
      return block.ordered
        ? <ol key={key} start={block.start === 1 ? undefined : block.start} className="list-decimal pl-6 my-3 space-y-1">{items}</ol>
        : <ul key={key} className="list-disc pl-6 my-3 space-y-1">{items}</ul>;
    }
    case 'table': {
      const captionId = `${key.replace(/[^a-z0-9-]/gi, '-')}-caption`;
      return (
        <div
          key={key}
          role="region"
          tabIndex={0}
          {...(block.caption ? { 'aria-labelledby': captionId } : { 'aria-label': 'Table' })}
          className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <table className="min-w-full text-sm text-left border-collapse">
            {block.caption && (
              <caption id={captionId} className="caption-top text-left text-sm font-medium text-gray-700 dark:text-gray-300 px-3 py-2">
                {inline(block.caption, `${key}.cap`)}
              </caption>
            )}
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} scope="col" className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 align-top">
                    {inline(cell, `${key}.h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700">
                  {row.map((cell, c) => <td key={c} className="px-3 py-2 align-top">{inline(cell, `${key}.${r}.${c}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'rule':
      return <hr key={key} className="my-8 border-gray-200 dark:border-gray-700" />;
    case 'quote':
      return <blockquote key={key} className="my-4 border-l-4 border-gray-300 dark:border-gray-600 pl-4">{block.blocks.map((b, i) => renderBlock(b, `${key}.${i}`))}</blockquote>;
  }
}

export default function LegalMarkdown({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return <>{blocks.map((block, i) => renderBlock(block, `b${i}`))}</>;
}
