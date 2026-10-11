// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LegalPage from './LegalPage';
import { I18nProvider } from '../i18n';

type Doc = { name: string; title: string; version: string; lang: string; markdown: string; configured: boolean };

const h = vi.hoisted(() => ({
  current: null as Doc | null,
  prior: null as Doc | null,
  priorError: null as unknown,
  asked: [] as unknown[],
  loading: false,
}));

vi.mock('../api/trpc', () => ({
  trpc: {
    legal: {
      document: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          if (options.enabled) h.asked.push(input);
          return { data: options.enabled ? h.current ?? undefined : undefined, isLoading: options.enabled && h.loading };
        },
      },
      priorVersion: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          if (options.enabled) h.asked.push(input);
          return { data: options.enabled ? h.prior ?? undefined : undefined, isLoading: false, error: options.enabled ? h.priorError : null };
        },
      },
    },
  },
}));

const doc = (over: Partial<Doc> = {}): Doc => ({
  name: 'privacy', title: 'Privacy Policy', version: '2.0', lang: 'en', configured: true,
  markdown: '# libreSRS Privacy Policy\n\n## AI features on this site {#AI-Policy #ai}\n\nThe Vocabulómetro test.\n', ...over,
});

function show(element: Parameters<typeof Route>[0]['element'], entry = '/privacy') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="*" element={element} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  h.current = doc();
  h.prior = null;
  h.priorError = null;
  h.asked = [];
  h.loading = false;
  window.localStorage.removeItem('libresrs.locale');
});

describe('LegalPage', () => {
  it('asks the server for the page and shows it as an English article, titled', () => {
    const { container } = show(<LegalPage name="privacy" />);
    expect(h.asked).toEqual([{ name: 'privacy' }]);
    expect(screen.getByRole('heading', { level: 1, name: 'libreSRS Privacy Policy' })).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveAttribute('lang', 'en');
    expect(document.title).toBe('Privacy Policy — libreSRS');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('lands on the section the address names', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show(<LegalPage name="privacy" />, '/privacy#AI-Policy');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('AI-Policy'));
  });

  it('lands on the AI Policy from the older /privacy#ai address too', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show(<LegalPage name="privacy" />, '/privacy#ai');
    expect(scroll).toHaveBeenCalledTimes(1);
    const target = scroll.mock.contexts[0] as HTMLElement;
    expect(target).toBe(document.getElementById('ai'));
    expect(target.closest('h2')).toBe(document.getElementById('AI-Policy'));
  });

  it('says so when the operator has not filled in its details', () => {
    h.current = doc({ configured: false });
    show(<LegalPage name="privacy" />);
    expect(screen.getByRole('note')).toHaveTextContent('has not filled in its details');
  });

  it('serves a prior version by its address', () => {
    h.prior = doc({ name: 'privacy/v1', title: 'Privacy Policy', version: '1.0', markdown: '# Privacy Policy (version 1.0)\n' });
    show(<LegalPage prior={{ document: 'privacy', slug: 'v1' }} />, '/privacy/v1');
    expect(h.asked).toEqual([{ document: 'privacy', slug: 'v1' }]);
    expect(screen.getByRole('heading', { name: 'Privacy Policy (version 1.0)' })).toBeInTheDocument();
  });

  it('says a page could not be loaded, and links every legal page', () => {
    h.current = null;
    show(<LegalPage name="terms" />);
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be loaded.');
    const nav = screen.getByRole('navigation', { name: 'Privacy and terms' });
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/privacy/summary', '/privacy', '/terms', '/subprocessors']);
  });

  it('tells a reader in another language that the page is in English, and keeps the text English', () => {
    window.localStorage.setItem('libresrs.locale', 'es');
    const { container } = show(<LegalPage name="privacy" />);
    expect(screen.getByText('Esta página solo está disponible en inglés.')).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('link', { name: 'Resumen de privacidad' })).toBeInTheDocument();
  });

  it('says a mistyped version address is no such page, not an outage, and links the current one', () => {
    h.priorError = { message: 'No such version', data: { code: 'NOT_FOUND' } };
    show(<LegalPage prior={{ document: 'terms', slug: '2' }} />, '/terms/2');
    expect(screen.getByRole('alert')).toHaveTextContent('There is no such version of this page.');
    expect(screen.queryByText(/try again later/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Read the current version' })).toHaveAttribute('href', '/terms');
  });

  it('still says "try again later" when a prior version fails for another reason', () => {
    h.priorError = { message: 'boom', data: { code: 'INTERNAL_SERVER_ERROR' } };
    show(<LegalPage prior={{ document: 'privacy', slug: 'v1' }} />, '/privacy/v1');
    expect(screen.getByRole('alert')).toHaveTextContent('try again later');
  });
});
