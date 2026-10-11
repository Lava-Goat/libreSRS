// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The conjugation "Study all" button (v1.18.0): a link to /conjugation/all, a
 * 20-question round mixing forms of every conjugation quiz the student may
 * play. Mounted beside "Your Decks" (pages/Dashboard.tsx) and on a deck's
 * conjugation page between rounds. Hidden while the student has no quiz to
 * play: it reads conjugation.myQuizzes, which the dashboard's deck list loads
 * anyway (one request for both).
 */
import { Link } from 'react-router-dom';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';

const look = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors '
  + 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 '
  + 'hover:bg-blue-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function StudyAllConjugationButton({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const { data: quizzes } = trpc.conjugation.myQuizzes.useQuery();
  if (!quizzes || quizzes.length === 0) return null;
  return (
    <Link to="/conjugation/all" className={`${look} ${className}`}>
      {t('Study all conjugation')}
    </Link>
  );
}
