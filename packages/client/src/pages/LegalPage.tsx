// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The legal pages (/privacy, /privacy/summary, /privacy/coppa-notice, /terms, /subprocessors, and
 * a prior version such as /privacy/v1). The server fills each page for this instance
 * (legal.document); this page renders it in English (lang="en", whatever the interface language)
 * and lands on the #section the address names.
 */
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import LegalMarkdown from '../legal/LegalMarkdown';

export type LegalDocumentName = 'privacy' | 'privacy-summary' | 'terms' | 'subprocessors' | 'coppa-notice';

type Props =
  | { name: LegalDocumentName; prior?: undefined }
  | { name?: undefined; prior: { document: 'privacy' | 'terms'; slug: string } };

/** What the page shows while loading or when a page cannot be had. */
function useLegalDocument(props: Props) {
  const current = trpc.legal.document.useQuery({ name: props.name ?? 'privacy' }, { enabled: props.name !== undefined, retry: 1 });
  const prior = trpc.legal.priorVersion.useQuery(
    props.prior ?? { document: 'privacy', slug: 'v1' },
    { enabled: props.prior !== undefined, retry: false },
  );
  return props.name !== undefined ? current : prior;
}

/** Whether the server answered "no such page" (tRPC NOT_FOUND), rather than failing. */
function notFound(error: unknown): boolean {
  return (error as { data?: { code?: string } | null } | null)?.data?.code === 'NOT_FOUND';
}

/** The legal pages, for the links at the foot of each. */
const LEGAL_LINKS: { to: string; label: string }[] = [
  { to: '/privacy/summary', label: 'Privacy summary' },
  { to: '/privacy', label: 'Full privacy policy' },
  { to: '/terms', label: 'Terms of Service' },
  { to: '/subprocessors', label: 'Where data is stored' },
];

export default function LegalPage(props: Props) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useLegalDocument(props);
  const doc = query.data;
  usePageTitle(doc?.title ?? t('Privacy Policy'));

  // Land on the section the address names once the text is there (the router does not).
  const hash = location.hash;
  const loaded = Boolean(doc);
  useEffect(() => {
    if (!loaded || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView();
  }, [loaded, hash]);

  // Back where the reader came from; to the start when this page was opened directly.
  const canGoBack = typeof window !== 'undefined' && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  return (
    <main id="main-content" className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-gray-900/30 p-6 sm:p-8">
        <div className="mb-6">
          {canGoBack ? (
            <button type="button" onClick={() => navigate(-1)} className="text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200 flex items-center gap-2">
              &larr; {t('Back')}
            </button>
          ) : (
            <Link to="/" className="text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200 flex items-center gap-2">
              &larr; {t('Back')}
            </Link>
          )}
        </div>

        {locale !== 'en' && (
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('This page is available in English only.')}</p>
        )}

        {query.isLoading ? (
          <div className="flex justify-center py-16" role="status" aria-label={t('Loading...')}>
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          </div>
        ) : !doc && props.prior && notFound(query.error) ? (
          // A mistyped address (/privacy/summery, /terms/2) lands on the prior-version route: that is
          // a page that does not exist, not an outage.
          <div role="alert">
            <p className="text-gray-800 dark:text-gray-200">{t('There is no such version of this page.')}</p>
            <p className="mt-2">
              <Link to={`/${props.prior.document}`} className="text-blue-700 dark:text-blue-300 underline hover:no-underline">{t('Read the current version')}</Link>
            </p>
          </div>
        ) : !doc ? (
          <p role="alert" className="text-red-700 dark:text-red-400">{t('This page could not be loaded. Please try again later.')}</p>
        ) : (
          <>
            {!doc.configured && (
              <div role="note" className="mb-6 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 text-sm">
                {t('The operator of this site has not filled in its details on this page yet. "[not yet stated]" marks each one that is missing.')}
              </div>
            )}
            <article lang={doc.lang} className="text-gray-700 dark:text-gray-300">
              <LegalMarkdown markdown={doc.markdown} />
            </article>
          </>
        )}

        <nav aria-label={t('Privacy and terms')} className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700 text-sm">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="text-blue-700 dark:text-blue-300 underline hover:no-underline">{t(link.label)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
