// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegalMarkdown from './LegalMarkdown';
import { parseBlocks, parseInline, slugify, splitRow } from './markdown';

/** The server's page texts, as shipped (placeholders and all): the renderer must handle every construct they use. */
const TEMPLATES = import.meta.glob<string>('../../../server/src/legal/defaults/*.md', { query: '?raw', import: 'default', eager: true });

const show = (markdown: string) => render(<MemoryRouter><LegalMarkdown markdown={markdown} /></MemoryRouter>);

const SAMPLE = `# Title

## 1. Sample data {#data}

**Summary.** Small: \`sub\` and the *Vocabulómetro* result. [Who](#who) · [Terms](/terms#aup) · [Build](/api/build-info) · [OpenAI](https://openai.com/policies/business-terms)

<caption>Account data and who sees it.</caption>

| Data | Who can see it |
|---|---|
| Email \\| alias | The **teacher** |
| Picture | Admins |

- one
- two

1. first
2. second

Email: a@example.org\\
Mail: Somewhere

---

## Who we are {#who}
`;

describe('LegalMarkdown', () => {
  it('gives headings their ids, so a link to #id lands', () => {
    show(SAMPLE);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toHaveAttribute('id', 'title');
    expect(screen.getByRole('heading', { level: 2, name: '1. Sample data' })).toHaveAttribute('id', 'data');
    expect(screen.getByRole('heading', { level: 2, name: 'Who we are' })).toHaveAttribute('id', 'who');
  });

  it('gives a heading a second id when it names an alias, so an older link lands on it too', () => {
    const { container } = show('## AI features on this site {#AI-Policy #ai}\n\nText. [The policy](/privacy#AI-Policy)');
    const heading = screen.getByRole('heading', { level: 2, name: 'AI features on this site' });
    expect(heading).toHaveAttribute('id', 'AI-Policy');
    expect(container.querySelector('#ai')).not.toBeNull();
    expect(heading.contains(container.querySelector('#ai'))).toBe(true);
    // An app address with a mixed-case anchor opens in place.
    expect(screen.getByRole('link', { name: 'The policy' })).toHaveAttribute('href', '/privacy#AI-Policy');
    expect(parseBlocks('## A {#AI-Policy #ai}\n\n## B {#ai}')).toMatchObject([
      { type: 'heading', id: 'AI-Policy', aliases: ['ai'] },
      { type: 'heading', id: 'ai-2', aliases: [] },
    ]);
  });

  it('renders a table with its caption, column headers and a labelled, focusable scroll region', () => {
    show(SAMPLE);
    const region = screen.getByRole('region', { name: 'Account data and who sees it.' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table', { name: 'Account data and who sees it.' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Data', 'Who can see it']);
    expect(headers.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Email | alias')).toBeInTheDocument();
    expect(within(table).getByText('teacher').tagName).toBe('STRONG');
  });

  it('marks the Spanish name as Spanish, and formats code, bold and emphasis', () => {
    const { container } = show(SAMPLE);
    const spanish = container.querySelector('span[lang="es"]');
    expect(spanish?.textContent).toBe('Vocabulómetro');
    expect(container.querySelector('code')?.textContent).toBe('sub');
    expect(container.querySelector('em')?.textContent).toBe('Vocabulómetro');
  });

  it('links in-page anchors and app pages in place, and server or outside addresses as plain links', () => {
    show(SAMPLE);
    expect(screen.getByRole('link', { name: 'Who' })).toHaveAttribute('href', '#who');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms#aup');
    expect(screen.getByRole('link', { name: 'Build' })).toHaveAttribute('href', '/api/build-info');
    const outside = screen.getByRole('link', { name: 'OpenAI' });
    expect(outside).toHaveAttribute('href', 'https://openai.com/policies/business-terms');
    expect(outside).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never makes a javascript: link', () => {
    const { container } = show('[click](javascript:alert(1)) and [data](data:text/html,x)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click');
  });

  it('keeps lists, numbered lists and line breaks', () => {
    const { container } = show(SAMPLE);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
    expect(show('3. third\n4. fourth').container.querySelector('ol')).toHaveAttribute('start', '3');
  });

  it('renders every default page text the server ships: each table captioned and complete, every heading with its id', () => {
    const files = Object.keys(TEMPLATES);
    expect(files.map((f) => f.split('/').pop()).sort()).toEqual(['coppa-notice.md', 'privacy-policy.md', 'privacy-summary.md', 'subprocessors.md', 'terms-of-service.md']);
    for (const file of files) {
      const body = TEMPLATES[file].replace(/^---\n[\s\S]*?\n---\n/, '');
      const blocks = parseBlocks(body);
      const explicit = [...body.matchAll(/^#{1,6} .*\{#([A-Za-z0-9-]+)((?: +#[A-Za-z0-9-]+)*)\}\s*(?:\}\})?$/gm)]
        .flatMap((m) => [m[1], ...m[2].split(' ').filter(Boolean).map((a) => a.slice(1))]);
      const ids = blocks.flatMap((b) => (b.type === 'heading' ? [b.id, ...b.aliases] : []));
      for (const id of explicit) expect(ids, `${file}: #${id}`).toContain(id);
      for (const block of blocks) {
        if (block.type !== 'table') continue;
        expect(block.caption, `${file}: a table without a caption (${block.header.join(' | ')})`).toBeTruthy();
        for (const row of block.rows) expect(row, file).toHaveLength(block.header.length);
      }
      const { container, unmount } = show(body);
      expect(container.querySelectorAll('table').length, file).toBe(blocks.filter((b) => b.type === 'table').length);
      unmount();
    }
    // The default policy keeps the sections the app links to (/privacy#AI-Policy, #ai, #security, #changes).
    const policy = parseBlocks(TEMPLATES['../../../server/src/legal/defaults/privacy-policy.md'].replace(/^---\n[\s\S]*?\n---\n/, ''));
    expect(policy.flatMap((b) => (b.type === 'heading' ? [b.id, ...b.aliases] : []))).toEqual(expect.arrayContaining(['AI-Policy', 'ai', 'security', 'changes']));
  });
});

describe('the parser', () => {
  it('splits table rows on unescaped pipes only', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
    expect(splitRow('a|b')).toEqual(['a', 'b']);
  });

  it('makes an id from a heading that names none', () => {
    expect(slugify('What is libreSRS?')).toBe('what-is-libresrs');
    expect(slugify('Vocabulómetro results')).toBe('vocabulometro-results');
    expect(parseBlocks('## Same\n\n## Same').map((b) => (b.type === 'heading' ? b.id : ''))).toEqual(['same', 'same-2']);
  });

  it('reads inline formatting', () => {
    expect(parseInline('**A** *b* `c` [d](#e) \\*f')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'A' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'link', href: '#e', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' *f' },
    ]);
  });
});
