import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { trpc } from '../api/trpc';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import LegalLinks from '../components/LegalLinks';

declare const __BUILD_COMMIT__: string;

const buildCacheKey = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';

function addCacheKey(url: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const separator = withoutHash.includes('?') ? '&' : '?';
  return `${withoutHash}${separator}v=${encodeURIComponent(buildCacheKey)}${hash}`;
}

function resolveMarkdownAssetUrl(url?: string) {
  if (!url) {
    return url;
  }
  if (url.startsWith('/')) {
    return addCacheKey(url);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    return url;
  }

  return addCacheKey(`/${url.replace(/^\.?\//, '')}`);
}

export default function Readme() {
  const { t } = useI18n();
  const { data: content, isLoading } = trpc.public.getReadme.useQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <main id="main-content">
          <div className="mb-8 flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-4">
            <Link to="/" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-2 font-medium">
              &larr; {t('Back to Dashboard')}
            </Link>
            <span className="text-gray-500 dark:text-gray-400 text-sm italic">{t('Documentation')}</span>
          </div>
        
          <article className="prose dark:prose-invert prose-blue prose-lg max-w-none prose-headings:border-b prose-headings:pb-2 prose-img:rounded-xl prose-img:shadow-lg prose-pre:bg-gray-900 prose-pre:text-gray-100">
            <ReactMarkdown
              rehypePlugins={[rehypeRaw]}
              components={{
                img: ({ src, ...props }) => {
                  const { ref: ignoredRef, ...imgProps } = props;
                  void ignoredRef;
                  return <img src={resolveMarkdownAssetUrl(src)} alt={imgProps.alt ?? ''} {...imgProps} />;
                },
              }}
            >
              {content ?? ''}
            </ReactMarkdown>
          </article>
        </main>

        <footer className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400 text-sm">
          <LegalLinks className="mb-2" />
          <p>&copy; {new Date().getFullYear()} Lava Goat Software</p>
        </footer>
      </div>
    </div>
  );
}
