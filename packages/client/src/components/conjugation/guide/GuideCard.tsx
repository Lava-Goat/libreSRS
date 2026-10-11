// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** The guide's door on the quiz page: "start here" at first, then what is new since the student last looked. */
import { useI18n } from '../../../i18n';
import type { GuideTarget } from './ConjugationGuide';

export function BookIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}

export default function GuideCard({ firstVisit, newTitles, firstNew, onOpen }: {
  /** The student has never opened the guide. */
  firstVisit: boolean;
  /** Titles of the sections opened since the student last looked. */
  newTitles: string[];
  /** The first of those, to open at. */
  firstNew?: string;
  onOpen: (target?: GuideTarget) => void;
}) {
  const { t } = useI18n();
  let text: string;
  let action: string;
  if (firstVisit) {
    text = t('New to conjugation? Start here: what each part of a question means, and the grammar this deck practices.');
    action = t('Start here');
  } else if (newTitles.length > 0) {
    const shown = newTitles.slice(0, 3).join(' · ');
    text = newTitles.length > 3
      ? t('New in your guide: {{titles}} and {{n}} more', { titles: shown, n: newTitles.length - 3 })
      : t('New in your guide: {{titles}}', { titles: shown });
    action = t('Read what’s new');
  } else {
    text = t('What each part of a question means, and the grammar this deck practices. It grows as you practice.');
    action = t('Open the guide');
  }
  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
      <div className="flex gap-3 min-w-0">
        <BookIcon className="w-6 h-6 shrink-0 text-violet-700 dark:text-violet-300" />
        <div className="min-w-0">
          <h2 className="font-semibold text-violet-950 dark:text-violet-100">{t('Intro to conjugation')}</h2>
          <p className="text-sm text-violet-900 dark:text-violet-200 break-words">{text}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpen(!firstVisit && firstNew ? { section: firstNew } : undefined)}
        className="shrink-0 px-4 py-2 rounded-lg font-medium text-white bg-violet-600 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
      >
        {action}
      </button>
    </div>
  );
}
