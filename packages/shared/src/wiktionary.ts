// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { TTS_LANGUAGE_MAP } from './ttsOptions.js';

/**
 * Where English Wiktionary's level-2 language heading differs from the
 * TTS_LANGUAGES label (each one checked against en.wiktionary.org, v1.26.1):
 * - bs/hr/sr: Wiktionary has no Bosnian, Croatian or Serbian sections, only
 *   Serbo-Croatian (its code sh, accepted here too).
 * - sl: "Slovene"; mi: "Māori", with the macron.
 * - no/nb: "Norwegian Bokmål". Wiktionary's "Norwegian" section is rare (mostly
 *   names); common words carry only Bokmål and Nynorsk, and a Norwegian deck is
 *   almost always Bokmål. nn: "Norwegian Nynorsk".
 */
const HEADING_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['bs', 'Serbo-Croatian'],
  ['hr', 'Serbo-Croatian'],
  ['sr', 'Serbo-Croatian'],
  ['sh', 'Serbo-Croatian'],
  ['sl', 'Slovene'],
  ['mi', 'Māori'],
  ['no', 'Norwegian Bokmål'],
  ['nb', 'Norwegian Bokmål'],
  ['nn', 'Norwegian Nynorsk'],
]);

/** Legacy codes still found in the wild, as their current code. */
const CODE_ALIASES: ReadonlyMap<string, string> = new Map([['iw', 'he']]);

/**
 * English Wiktionary's level-2 heading for a deck language code (es → "Spanish"),
 * or null when the code is empty or unknown. The code is trimmed, lowercased and
 * cut to its primary subtag, so es-MX and es_MX are Spanish.
 */
export function wiktionaryHeading(code: string | null | undefined): string | null {
  if (!code) return null;
  const primary = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (!primary) return null;
  const normalized = CODE_ALIASES.get(primary) ?? primary;
  return HEADING_OVERRIDES.get(normalized) ?? TTS_LANGUAGE_MAP.get(normalized) ?? null;
}

/**
 * The English Wiktionary page for a word, opened at the section of the deck
 * language when it is known (https://en.wiktionary.org/wiki/casa#Spanish), or
 * at the top of the page when it is not.
 */
export function wiktionaryUrl(word: string, languageCode?: string | null): string {
  const page = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
  const heading = wiktionaryHeading(languageCode);
  return heading ? `${page}#${encodeURIComponent(heading.replace(/ /g, '_'))}` : page;
}
