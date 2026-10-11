// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The notice cards above "Your Decks" (vocabulary tests, tests,
 * audio labs, speaking, sign-ups), with a fold (v1.18.0) so they don't fill the front page. One button switches between
 * the full cards and one row of chips, and this browser remembers which
 * (noticesFold.ts).
 *
 * A chip is a link to the same page as its card: its name, then how many are
 * left to do (in the card's colour) or a done mark. A screen reader hears the
 * card's own line ("2 lab(s) to do") with the name instead of the bare number
 * or mark. (No tooltip: a title would be read a second time as the link's
 * description.)
 *
 * The fold button is one element in both states (the last child of the same
 * row), so it keeps the focus when pressed: after the chips when folded, above
 * the cards when not. aria-expanded says whether the full cards show;
 * aria-controls names the chips or the cards, whichever is shown.
 *
 * A message told once (an extension's news, marked seen as it shows, put
 * away with its own ✕) is not a notice: a fold must never hide it
 * (pages/Dashboard.tsx keeps the extensions' slot above).
 */
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { readNoticesFolded, writeNoticesFolded } from './noticesFold';

/** The card's colour (its top border), which its chip's border and count share. */
export type NoticeTone = 'red' | 'amber' | 'blue' | 'emerald' | 'violet';

export interface DashboardNotice {
  /** Stable and unique among the notices ('labs'). */
  id: string;
  /** Where the card and the chip go. */
  to: string;
  /** The chip's name: the card's heading ("Audio labs"). */
  label: string;
  /** How many are left to do; 0 shows the done mark. */
  toDo: number;
  /** The card's one line ("2 lab(s) to do", "All labs turned in"): what a screen reader hears with the chip's name. */
  status: string;
  tone: NoticeTone;
  /** The full card, a link to `to`, as it shows unfolded. */
  card: ReactNode;
}

/** Each tone's chip border and count badge; the badge's text keeps 4.5:1 or more in both themes. */
const TONES: Record<NoticeTone, { border: string; badge: string }> = {
  red: { border: 'border-red-800 dark:border-red-400', badge: 'bg-red-800 text-white dark:bg-red-400 dark:text-gray-900' },
  amber: { border: 'border-amber-600 dark:border-amber-400', badge: 'bg-amber-800 text-white dark:bg-amber-400 dark:text-gray-900' },
  blue: { border: 'border-blue-600 dark:border-blue-400', badge: 'bg-blue-700 text-white dark:bg-blue-400 dark:text-gray-900' },
  emerald: { border: 'border-emerald-600 dark:border-emerald-400', badge: 'bg-emerald-700 text-white dark:bg-emerald-400 dark:text-gray-900' },
  violet: { border: 'border-violet-600 dark:border-violet-400', badge: 'bg-violet-700 text-white dark:bg-violet-400 dark:text-gray-900' },
};

const CHIP = 'inline-flex items-center gap-2 rounded-full border-2 bg-white dark:bg-gray-800 px-3 py-1 text-sm font-medium '
  + 'text-gray-900 dark:text-gray-100 shadow-sm hover:shadow-md transition-shadow '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900';

function NoticeChip({ notice }: { notice: DashboardNotice }) {
  const tone = TONES[notice.tone];
  const toDo = notice.toDo > 0;
  return (
    <Link
      to={notice.to}
      // The spoken name, set whole: built from the flex items, browsers put a space before the comma.
      aria-label={`${notice.label}, ${notice.status}`}
      className={`${CHIP} ${toDo ? tone.border : 'border-gray-300 dark:border-gray-600'}`}
    >
      <span>{notice.label}</span>
      {toDo ? (
        <span aria-hidden="true" className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-bold leading-5 ${tone.badge}`}>
          {notice.toDo}
        </span>
      ) : (
        <span aria-hidden="true" className="font-bold text-green-700 dark:text-green-400">✓</span>
      )}
    </Link>
  );
}

export function DashboardNotices({ notices }: { notices: readonly DashboardNotice[] }) {
  const { t } = useI18n();
  const contentId = useId();
  const [folded, setFolded] = useState(readNoticesFolded);
  if (notices.length === 0) return null;

  const toggle = () => {
    const next = !folded;
    setFolded(next);
    writeNoticesFolded(next);
  };

  return (
    <div className="mb-8">
      <div className={`flex flex-wrap items-center gap-2 ${folded ? '' : 'mb-2'}`}>
        {folded && (
          <ul id={contentId} className="flex flex-wrap items-center gap-2" aria-label={t('To do')}>
            {notices.map((notice) => (
              <li key={notice.id}><NoticeChip notice={notice} /></li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          aria-controls={contentId}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {t('Details')}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 transition-transform ${folded ? '' : 'rotate-180'}`}
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {!folded && (
        <div id={contentId} className="space-y-6">
          {notices.map((notice) => <div key={notice.id}>{notice.card}</div>)}
        </div>
      )}
    </div>
  );
}
