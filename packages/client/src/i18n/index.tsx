import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  MESSAGES,
  type Locale,
} from './messages';

const LOCALE_ALIASES: Record<string, Locale> = {
  en: 'en',
  es: 'es',
  ar: 'ar',
  zh: 'zh',
  vi: 'vi',
  'pt-br': 'pt-BR',
  ru: 'ru',
  fa: 'fa',
  he: 'he',
};

function normalizeLocale(value?: string | null): Locale | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  const direct = LOCALE_ALIASES[normalized];
  if (direct) {
    return direct;
  }

  const base = normalized.split('-')[0] ?? '';
  if (base === 'pt') {
    return 'pt-BR';
  }

  const aliased = LOCALE_ALIASES[base];
  if (aliased) {
    return aliased;
  }

  return null;
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  const candidates = Array.isArray(window.navigator.languages)
    ? window.navigator.languages
    : [window.navigator.language];

  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }

  return template.replace(/{{\s*([\w]+)\s*}}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/** Messages extensions bring (registerMessages): looked up after core's own. */
const EXTRA: Partial<Record<Locale, Record<string, string>>> = {};

/**
 * Adds extensions' messages to the catalog (main.tsx, before the first render; the
 * test setup likewise). Core's own message for a key wins: an extension adds keys,
 * it never changes core's.
 */
export function registerMessages(extra: Partial<Record<Locale, Record<string, string>>>): void {
  for (const [locale, catalog] of Object.entries(extra) as [Locale, Record<string, string> | undefined][]) {
    if (!catalog) continue;
    EXTRA[locale] = { ...(EXTRA[locale] ?? {}), ...catalog };
  }
}

function translate(locale: Locale, message: string, params?: Record<string, string | number>): string {
  const localized = MESSAGES[locale][message] ?? EXTRA[locale]?.[message] ?? message;
  return interpolate(localized, params);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (message: string, params?: Record<string, string | number>) => string;
  formatDate: (value: Date | number | string) => string;
}

const defaultContext: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (message, params) => translate(DEFAULT_LOCALE, message, params),
  formatDate: (value) => new Date(value).toLocaleDateString(DEFAULT_LOCALE),
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

const RTL_LOCALES: Set<string> = new Set(['ar', 'fa', 'he']);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    }
  }, []);

  // Sync lang and dir attributes on <html> when locale changes
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (message, params) => translate(locale, message, params),
      formatDate: (input) => new Date(input).toLocaleDateString(locale),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export type { Locale };
