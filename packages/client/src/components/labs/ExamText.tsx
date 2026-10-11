// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Exam labs (v1.19.0): what a student must not miss on a test page is said in
 * their language and, unless that is Spanish, in Spanish under it, so a
 * Spanish 1 class reads the rules in both. Each line is one of the texts
 * below, and its Spanish is the one in i18n/messages.ts.
 */
import { MESSAGES } from '../../i18n/messages';
import { useI18n } from '../../i18n';

/** The texts a test page shows in both languages (each has Spanish in messages.ts). */
export const EXAM_BILINGUAL_TEXTS = [
  'Headphones on.',
  'Your answers go on your paper, not here.',
  'The audio says the text twice. You hear it once, straight through: no pause, no going back.',
  "Don't close or reload this page. You can start this test only once.",
  'You already started this test. Ask your teacher.',
  'This test was changed. Reload the page.',
] as const;

export type ExamBilingualText = (typeof EXAM_BILINGUAL_TEXTS)[number];

/** The instructions before "Start the test", in order. */
export const EXAM_INSTRUCTIONS: readonly ExamBilingualText[] = EXAM_BILINGUAL_TEXTS.slice(0, 4);

/** A line in the page's language, then (unless that is Spanish) the same line in Spanish, smaller. */
export function Bilingual({ text }: { text: ExamBilingualText }) {
  const { t, locale } = useI18n();
  const spanish = MESSAGES.es[text];
  return (
    <>
      <span className="block">{t(text)}</span>
      {locale !== 'es' && spanish && (
        <span lang="es" className="block text-sm text-gray-600 dark:text-gray-400">{spanish}</span>
      )}
    </>
  );
}

/** The server's own code for a refused call (EXAM_USED…), from a tRPC error. */
export function appCodeOf(err: unknown): string | undefined {
  return (err as { data?: { appCode?: string } } | null)?.data?.appCode;
}
