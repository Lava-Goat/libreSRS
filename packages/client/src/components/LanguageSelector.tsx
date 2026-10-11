import { useState, useRef, useEffect } from 'react';
import { useI18n, type Locale } from '../i18n';
import { trpc } from '../api/trpc';
import { useAuth } from '../hooks/useAuth';

const options: Array<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'zh', label: '中文（普通话）' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ru', label: 'Русский' },
  { value: 'fa', label: 'فارسی' },
  { value: 'he', label: 'עברית' },
];

export default function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Settings belong to a signed-in user. Asked for on the login page (or any
  // page before sign-in), the server refuses and logs an error every visit.
  const { isAuthenticated } = useAuth();
  const { data: settings } = trpc.settings.get.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const updateSettings = trpc.settings.update.useMutation();
  const [serverSynced, setServerSynced] = useState(false);

  // Sync locale from server on first load (if user is authenticated)
  useEffect(() => {
    if (settings?.locale && !serverSynced) {
      setLocale(settings.locale as Locale);
      setServerSynced(true);
    }
  }, [settings, serverSynced, setLocale]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col items-end" ref={containerRef}>
      {isOpen && (
        <div className="mb-2 w-48 rounded-md shadow-lg dark:shadow-gray-900/30 bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden transition-all">
          <div className="py-1 max-h-64 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setLocale(option.value);
                  setIsOpen(false);
                  if (settings) {
                    updateSettings.mutate({
                      newCardsPerDay: settings.newCardsPerDay,
                      reviewsPerDay: settings.reviewsPerDay,
                      aiEnabled: settings.aiEnabled,
                      locale: option.value,
                    });
                  }
                }}
                className={`block w-full text-left px-4 py-2 text-sm ${
                  locale === option.value
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-11 h-11 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-lg dark:shadow-gray-900/30 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        title={t('Language')}
        aria-label={t('Language')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-600 dark:text-gray-400" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
        </svg>
      </button>
    </div>
  );
}