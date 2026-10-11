// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The dashboard's flashcard "Study all" button (v1.18.0): a link to /study/all,
 * which runs every deck of the student's groups with cards due today, the
 * newest deck first, each as its own session. It shows how many cards are due
 * in all (what the deck cards add up to), and nothing when none is due
 * anywhere (or for a teacher with no decks). Mounted beside "Your Decks"
 * (pages/Dashboard.tsx); no props.
 */
import { Link } from 'react-router-dom';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { getTimezoneOffsetMinutes } from '../../utils/time';

export function StudyAllFlashcardsButton() {
  const { t } = useI18n();
  const { data } = trpc.cards.studyAll.useQuery({ timezoneOffsetMinutes: getTimezoneOffsetMinutes() });
  if (!data || data.totalDue === 0) return null;
  return (
    <Link
      to="/study/all"
      title={t('Every deck with cards due today, the newest first')}
      className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
    >
      {t('Study all flashcards ({{count}})', { count: data.totalDue })}
    </Link>
  );
}
