// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** Languages supported by gpt-4o-mini-tts-2025-12-15 */
export const TTS_LANGUAGES = [
  { value: 'af', label: 'Afrikaans' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hy', label: 'Armenian' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'be', label: 'Belarusian' },
  { value: 'bs', label: 'Bosnian' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'ca', label: 'Catalan' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hr', label: 'Croatian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'en', label: 'English' },
  { value: 'et', label: 'Estonian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'gl', label: 'Galician' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'is', label: 'Icelandic' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'kn', label: 'Kannada' },
  { value: 'kk', label: 'Kazakh' },
  { value: 'ko', label: 'Korean' },
  { value: 'lv', label: 'Latvian' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'ms', label: 'Malay' },
  { value: 'mr', label: 'Marathi' },
  { value: 'mi', label: 'Maori' },
  { value: 'ne', label: 'Nepali' },
  { value: 'no', label: 'Norwegian' },
  { value: 'fa', label: 'Persian' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sr', label: 'Serbian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'es', label: 'Spanish' },
  { value: 'sw', label: 'Swahili' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'ta', label: 'Tamil' },
  { value: 'th', label: 'Thai' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'cy', label: 'Welsh' },
] as const;

/** Accent/dialect variants supported by gpt-4o-mini-tts-2025-12-15 via instructions */
export const TTS_ACCENTS = [
  // English
  { value: 'American', label: 'American English' },
  { value: 'British', label: 'British English' },
  { value: 'Australian', label: 'Australian English' },
  { value: 'Indian English', label: 'Indian English' },
  { value: 'Irish', label: 'Irish English' },
  { value: 'Scottish', label: 'Scottish English' },
  { value: 'South African English', label: 'South African English' },
  // Spanish
  { value: 'Mexican', label: 'Mexican Spanish' },
  { value: 'Castilian', label: 'Castilian Spanish' },
  { value: 'Argentine', label: 'Argentine Spanish' },
  { value: 'Colombian', label: 'Colombian Spanish' },
  { value: 'Chilean', label: 'Chilean Spanish' },
  { value: 'Cuban', label: 'Cuban Spanish' },
  { value: 'Puerto Rican', label: 'Puerto Rican Spanish' },
  { value: 'Costa Rican', label: 'Costa Rican Spanish' },
  // French
  { value: 'Parisian', label: 'Parisian French' },
  { value: 'Canadian French', label: 'Canadian French' },
  { value: 'Belgian French', label: 'Belgian French' },
  { value: 'Swiss French', label: 'Swiss French' },
  { value: 'West African French', label: 'West African French' },
  // Portuguese
  { value: 'Brazilian', label: 'Brazilian Portuguese' },
  { value: 'European Portuguese', label: 'European Portuguese' },
  // German
  { value: 'Standard German', label: 'Standard German' },
  { value: 'Austrian', label: 'Austrian German' },
  { value: 'Swiss German', label: 'Swiss German' },
  // Arabic
  { value: 'Egyptian', label: 'Egyptian Arabic' },
  { value: 'Levantine', label: 'Levantine Arabic' },
  { value: 'Gulf', label: 'Gulf Arabic' },
  { value: 'Moroccan', label: 'Moroccan Arabic' },
  // Chinese
  { value: 'Mandarin', label: 'Mandarin Chinese' },
  { value: 'Cantonese', label: 'Cantonese Chinese' },
  { value: 'Taiwanese Mandarin', label: 'Taiwanese Mandarin' },
  // Italian
  { value: 'Standard Italian', label: 'Standard Italian' },
  { value: 'Sicilian', label: 'Sicilian Italian' },
  // Japanese
  { value: 'Tokyo', label: 'Tokyo Japanese' },
  { value: 'Kansai', label: 'Kansai Japanese' },
  // Korean
  { value: 'Seoul', label: 'Seoul Korean' },
  // Hindi
  { value: 'Standard Hindi', label: 'Standard Hindi' },
  // Russian
  { value: 'Moscow', label: 'Moscow Russian' },
] as const;

/** Map from language code to display name for TTS instructions */
export const TTS_LANGUAGE_MAP: Map<string, string> = new Map(TTS_LANGUAGES.map(l => [l.value, l.label]));
