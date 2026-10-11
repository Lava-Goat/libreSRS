// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** The guide's text: the English or the Spanish of an L, with its *starred* Spanish shown bold, in Spanish. */
import { Fragment, type ReactNode } from 'react';
import type { L } from './types';

/** The guide is written in English and Spanish; every other locale reads the English. */
export type GuideLang = 'en' | 'es';

export const guideLang = (locale: string): GuideLang => (locale === 'es' ? 'es' : 'en');

export const pick = (text: L, lang: GuideLang): string => text[lang];

/** Plain text with the stars taken out (for titles in attributes and lists of names). */
export const plain = (text: L, lang: GuideLang): string => text[lang].replace(/\*/g, '');

/** A text with its *starred* spans as Spanish: bold, lang="es". */
export function Rich({ text, lang }: { text: L; lang: GuideLang }): ReactNode {
  return <Inline source={text[lang]} />;
}

/** The same, for a raw string (an example's Spanish sentence). */
export function Inline({ source, spanClass = 'font-semibold' }: { source: string; spanClass?: string }): ReactNode {
  const parts = source.split('*');
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1
        ? <strong key={i} lang="es" className={spanClass}>{part}</strong>
        : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}
