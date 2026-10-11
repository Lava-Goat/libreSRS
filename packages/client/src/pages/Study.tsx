import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { trpc } from '../api/trpc';
import FlashcardReview, { type SessionCounts } from '../components/FlashcardReview';
import type { State, CardDirection } from '@libresrs/shared';
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import { useDeckFinishParts } from '../extensions';
import type { StudyFinishReport } from '../extensions/api';
import { finishRetry } from '../utils/finishRetry';

interface NextReviewDates {
  1: string | Date;
  2: string | Date;
  3: string | Date;
  4: string | Date;
}

interface CardWithState {
  card: {
    id: number;
    deckId: number;
    front: string;
    back: string;
  };
  state: {
    id: number;
    stability: number;
    difficulty: number;
    reps: number;
    lapses: number;
    state: State;
  };
  direction: CardDirection;
  nextReviewOptions: NextReviewDates;
}

interface StudyCounts {
  remainingNewCardsToday: number;
  remainingReviewsToday: number;
  newCardsInBatch?: number;
  reviewCardsInBatch?: number;
  newCardsLimit: number;
  reviewsLimit: number;
  /** With nothing due now: cards in learning whose next step is later, and when the first comes back (ms). */
  learningLater?: number;
  learningBackInMs?: number | null;
}

/** A deck with cards still due today, as the completion report names it (routers/cards.ts DeckLeft). */
interface DeckLeft {
  deckId: number;
  deckName: string;
  total: number;
}

/** A deck whose only cards left today wait on a learning step (routers/cards.ts DeckWaiting). */
interface DeckWaiting {
  deckId: number;
  deckName: string;
  count: number;
  backInMs: number | null;
}

interface DueCardsResponse {
  cards: CardWithState[];
  counts: StudyCounts;
}

export default function Study() {
  const { t } = useI18n();
  usePageTitle('Study');
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const deckIdNum = parseInt(deckId || '0', 10);

  const {
    data: cardsData,
    isLoading,
    isFetching: isFetchingCards,
    refetch,
  } = trpc.cards.getDueCards.useQuery(
    { deckId: deckIdNum, timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
    { enabled: deckIdNum > 0 }
  );

  const response = cardsData as DueCardsResponse | undefined;
  const cards = response?.cards;
  const counts = response?.counts;
  const hasCardsData = cards !== undefined;
  const cardCount = cards?.length ?? 0;
  // What the fetch holds, as a primitive: the same cards fetched again change nothing.
  const cardsKey = cards?.map((c) => `${c.state.id}:${c.state.state}:${c.state.reps}`).join(',') ?? '';
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  // The session in progress: the cards it opened with (or the latest fetch that had any). A refetch
  // that comes back empty mid-session (the connection came back while the last cards wait on a
  // learning step) does not end it: only FlashcardReview's onComplete does.
  const [session, setSession] = useState<{ deckId: number; cards: CardWithState[] } | null>(null);
  if (cards && cards.length > 0 && !isSessionComplete && (session?.cards !== cards || session.deckId !== deckIdNum)) {
    setSession({ deckId: deckIdNum, cards });
  }
  const inSession = session !== null && session.deckId === deckIdNum && !isSessionComplete;
  const showSloth = isSessionComplete || (!inSession && cardCount === 0);
  // "More cards are due": the server found cards left when the page thought it was done.
  const [moreDue, setMoreDue] = useState(false);
  // The cards left, by state, as FlashcardReview reports them after each rating.
  const [sessionCounts, setSessionCounts] = useState<SessionCounts | null>(null);
  const handleSessionCountsChange = useCallback((nextCounts: SessionCounts) => {
    setSessionCounts(nextCounts);
  }, []);

  const {
    data: progress,
    isFetching: isFetchingProgress,
    refetch: refetchProgress,
  } = trpc.cards.getDeckProgress.useQuery(
    { deckId: deckIdNum },
    { enabled: deckIdNum > 0 }
  );

  // Log reaching the "All Done!" sloth screen, once per screen: a finished session when the
  // last card is rated (FlashcardReview awaits that review before onComplete), or an empty deck
  // when the page opens to nothing due. The server counts the session's cards itself, checks
  // that nothing is left, and answers with its report, which an extension may add to. (It also
  // records the finish itself at the last review, so a report lost for good costs nothing.)
  // A report the network lost is sent again for a few minutes; a failed one can be sent again.
  const completionLoggedRef = useRef(false);
  const logCompletion = trpc.cards.logStudyCompletion.useMutation({
    ...finishRetry,
    onError: () => {
      completionLoggedRef.current = false;
    },
  });
  const savingFinish = logCompletion.isPending && (logCompletion.failureCount > 0 || logCompletion.isPaused);
  /** The completion report's answer (extensions read their fields from it). */
  const [report, setReport] = useState<StudyFinishReport | null>(null);
  // Other decks with cards still due today (the report's answer, newest first): "Study all" goes on with them.
  const [decksLeft, setDecksLeft] = useState<DeckLeft[]>([]);
  // Other decks with nothing due now but a card back from a learning step later today: the day is not done.
  const [decksWaiting, setDecksWaiting] = useState<DeckWaiting[]>([]);
  const logSloth = (reason: 'session_complete' | 'nothing_due') => {
    completionLoggedRef.current = true;
    logCompletion.mutate({
      deckId: deckIdNum,
      reason,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
    }, {
      onSuccess: (result) => {
        setReport(result);
        setDecksLeft((result.decksLeft ?? []).filter((d) => d.deckId !== deckIdNum));
        setDecksWaiting((result.decksWaiting ?? []).filter((d) => d.deckId !== deckIdNum));
        // The server still finds cards due: fetch again, which reopens the session when it finds them too.
        if (result.reason === 'cards-due') {
          void Promise.resolve(refetch()).then((fresh) => {
            const again = (fresh as { data?: DueCardsResponse } | undefined)?.data?.cards?.length ?? 0;
            if (again === 0) setMoreDue(true);
          });
        }
      },
    });
  };

  // Different cards from a fetch reopen the session: after "All Done!" (a card came due, or the
  // server found one left), or after an empty deck. Its own "All Done!" is then logged again.
  useEffect(() => {
    if (cardCount === 0) return;
    setIsSessionComplete(false);
    setReport(null);
    setDecksLeft([]);
    setDecksWaiting([]);
    setMoreDue(false);
    completionLoggedRef.current = false;
  }, [cardCount, cardsKey]);

  // Opening the deck to nothing due (never an empty refetch in the middle of a session).
  useEffect(() => {
    if (isLoading || !hasCardsData || deckIdNum <= 0) return;
    if (isSessionComplete || inSession || cardCount > 0 || completionLoggedRef.current) return;
    // (logSloth is left out on purpose: useMutation's identity changes every render.)
    logSloth('nothing_due');
  }, [isLoading, hasCardsData, isSessionComplete, inSession, cardCount, deckIdNum]);

  const handleComplete = () => {
    setIsSessionComplete(true);
    setSession(null);
    // Fresh numbers for the "All Done!" screen: today's counts and the deck's progress.
    refetch();
    refetchProgress();
    if (!completionLoggedRef.current) logSloth('session_complete');
  };

  // What extensions show on the "All Done!" screen (nothing without them): `top` above the
  // saving line, `note` after "More cards are due". Called before the early returns below.
  const finish = useDeckFinishParts({ deckId: deckIdNum, done: !isLoading && showSloth, report });
  // Nothing due now, but cards in learning come back later today.
  const learningLater = counts?.learningLater ?? 0;
  const backInMinutes = Math.max(1, Math.ceil((counts?.learningBackInMs ?? 0) / 60000));

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (showSloth || !session) {
    return (
      <main id="main-content" className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-gray-900/30 p-8 max-w-md w-full text-center">
          <img src="/mascot.png" alt="libreSRS mascot" className="w-24 h-24 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('All Done!')}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t("You've reviewed all due cards in this deck. Come back later for more!")}
          </p>
          {cardCount === 0 && !isFetchingCards && learningLater > 0 && (
            <p className="text-gray-600 dark:text-gray-400 mb-6" data-testid="learning-later">
              {learningLater === 1
                ? t('1 card comes back in about {{minutes}} min.', { minutes: backInMinutes })
                : t('{{count}} cards come back in about {{minutes}} min.', { count: learningLater, minutes: backInMinutes })}
            </p>
          )}
          {finish.top}
          {savingFinish && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-300 mb-6">
              {t('Saving your finish… check your Wi-Fi.')}
            </p>
          )}
          {moreDue && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-300 mb-6">
              {t('More cards are due. Reload the page to continue.')}
            </p>
          )}
          {finish.note}
          {decksLeft.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-6 text-left" data-testid="decks-left">
              <p className="text-sm text-gray-800 dark:text-gray-200">
                {t('Still due today: {{decks}}', { decks: decksLeft.map((d) => `${d.deckName} (${d.total})`).join(', ') })}
              </p>
              <Link to="/study/all" className="inline-block mt-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">
                {t('Study all flashcards')} →
              </Link>
            </div>
          )}
          {decksWaiting.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-6 text-left" data-testid="decks-waiting">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t('Later today:')}</p>
              <ul className="text-sm text-gray-700 dark:text-gray-300 mt-1 space-y-1">
                {decksWaiting.map((d) => {
                  const minutes = Math.max(1, Math.ceil((d.backInMs ?? 0) / 60000));
                  return (
                    <li key={d.deckId}>
                      {d.count === 1
                        ? t('{{deck}}: 1 card comes back in about {{minutes}} min.', { deck: d.deckName, minutes })
                        : t('{{deck}}: {{count}} cards come back in about {{minutes}} min.', { deck: d.deckName, count: d.count, minutes })}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {counts && !isFetchingCards && (
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 mb-4 text-left">
              <div className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">{t("Today's Progress")}</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-600 dark:text-blue-400">{t('New Cards')}</span>
                  <p className="font-semibold text-blue-900 dark:text-blue-200">
                    {counts.newCardsLimit - counts.remainingNewCardsToday} / {counts.newCardsLimit}
                  </p>
                </div>
                <div>
                  <span className="text-blue-600 dark:text-blue-400">{t('Reviews')}</span>
                  <p className="font-semibold text-blue-900 dark:text-blue-200">
                    {counts.reviewsLimit - counts.remainingReviewsToday} / {counts.reviewsLimit}
                  </p>
                </div>
              </div>
            </div>
          )}
          {progress && !isFetchingProgress && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-6 text-left">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Total Cards')}</span>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{progress.totalCards}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Learned')}</span>
                  <p className="font-semibold text-green-700 dark:text-green-400">{progress.learnedCards}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Retention')}</span>
                  <p className="font-semibold text-blue-600 dark:text-blue-400">
                    {(progress.retentionRate * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Time Spent')}</span>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">
                    {Math.round(progress.totalTimeMs / 60000)}m
                  </p>
                </div>
              </div>
            </div>
          )}
          <Link
            to="/"
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            {t('Back to Dashboard')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <h1 className="sr-only">{t('Study')}</h1>
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
            ← {t('Back to Dashboard')}
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {sessionCounts && (
              <div className="flex gap-3 text-gray-600 dark:text-gray-400" data-testid="session-counts">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" aria-hidden="true"></span>
                  <span className="font-medium">{sessionCounts.newRemaining}</span>
                  <span className="text-gray-500 dark:text-gray-400">{t('new')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-500" aria-hidden="true"></span>
                  <span className="font-medium">{sessionCounts.learningRemaining}</span>
                  <span className="text-gray-500 dark:text-gray-400">{t('learning')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden="true"></span>
                  <span className="font-medium">{sessionCounts.reviewRemaining}</span>
                  <span className="text-gray-500 dark:text-gray-400">{t('review')}</span>
                </span>
              </div>
            )}
            <div className="text-gray-500 dark:text-gray-400 border-l border-gray-200 dark:border-gray-700 pl-4">
              {t('{{count}} cards in session', { count: session.cards.length })}
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-3xl mx-auto px-4 py-8">
        <FlashcardReview
          cards={session.cards}
          onComplete={handleComplete}
          onExit={() => navigate('/')}
          onSessionCountsChange={handleSessionCountsChange}
        />
      </main>
    </div>
  );
}
