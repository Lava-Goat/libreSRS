import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { trpc } from '../api/trpc';
import FlashcardReview, { type SessionCounts } from '../components/FlashcardReview';
import type { State, CardDirection } from '@libresrs/shared';
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import { finishRetry } from '../utils/finishRetry';
import { useDeckFinishParts } from '../extensions';
import type { StudyFinishReport } from '../extensions/api';

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

export default function VirtualStudy() {
  const { t } = useI18n();
  usePageTitle('Study');
  const { virtualDeckId } = useParams<{ virtualDeckId: string }>();
  const navigate = useNavigate();
  const virtualDeckIdNum = parseInt(virtualDeckId || '0', 10);

  const {
    data: virtualDeck,
    isFetching: isFetchingDeck,
    refetch: refetchDeck,
  } = trpc.virtualDecks.get.useQuery(
    { id: virtualDeckIdNum, timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
    { enabled: virtualDeckIdNum > 0 }
  );

  const {
    data: cardsData,
    isLoading,
    refetch,
  } = trpc.virtualDecks.getDueCards.useQuery(
    { virtualDeckId: virtualDeckIdNum, timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
    { enabled: virtualDeckIdNum > 0 }
  );

  const cards: CardWithState[] | undefined = cardsData as CardWithState[] | undefined;
  const hasCardsData = cards !== undefined;
  const cardCount = cards?.length ?? 0;
  // What the fetch holds, as a primitive: the same cards fetched again change nothing.
  const cardsKey = cards?.map((c) => `${c.state.id}:${c.state.state}:${c.state.reps}`).join(',') ?? '';
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  // The session in progress: the latest fetch that had cards. A refetch that comes back empty
  // mid-session (the last cards wait on a learning step) does not end it: only onComplete does.
  const [session, setSession] = useState<{ virtualDeckId: number; cards: CardWithState[] } | null>(null);
  if (cards && cards.length > 0 && !isSessionComplete && (session?.cards !== cards || session.virtualDeckId !== virtualDeckIdNum)) {
    setSession({ virtualDeckId: virtualDeckIdNum, cards });
  }
  const inSession = session !== null && session.virtualDeckId === virtualDeckIdNum && !isSessionComplete;
  const showSloth = isSessionComplete || (!inSession && cardCount === 0);
  // The cards left in the session, as FlashcardReview reports them after each rating.
  const [cardsLeft, setCardsLeft] = useState<number | null>(null);
  const handleSessionCountsChange = useCallback((counts: SessionCounts) => {
    setCardsLeft(counts.newRemaining + counts.learningRemaining + counts.reviewRemaining);
  }, []);

  // Log reaching the "All Done!" sloth screen (virtual decks), once per screen: a finished
  // session when the last card is rated, or an empty selection when the page opens. The server
  // counts the session's cards (only this virtual deck's) itself. A report the network lost is
  // sent again for a few minutes; a failed one can be sent again.
  // A study here that emptied the deck's whole day is the deck's finish (the server records it
  // at the last review): when that left nothing due in any deck, the report answers what Study's
  // would.
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
  const logSloth = (reason: 'session_complete' | 'nothing_due') => {
    completionLoggedRef.current = true;
    logCompletion.mutate({
      virtualDeckId: virtualDeckIdNum,
      reason,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
    }, {
      onSuccess: (result) => setReport(result),
    });
  };

  // Different cards from a fetch reopen the session; its own "All Done!" is then logged again.
  useEffect(() => {
    if (cardCount === 0) return;
    setIsSessionComplete(false);
    setCardsLeft(null);
    setReport(null);
    completionLoggedRef.current = false;
  }, [cardCount, cardsKey]);

  // Opening the virtual deck to nothing due (never an empty refetch in the middle of a session).
  useEffect(() => {
    if (isLoading || !hasCardsData || virtualDeckIdNum <= 0) return;
    if (isSessionComplete || inSession || cardCount > 0 || completionLoggedRef.current) return;
    // (logSloth is left out on purpose: useMutation's identity changes every render.)
    logSloth('nothing_due');
  }, [isLoading, hasCardsData, isSessionComplete, inSession, cardCount, virtualDeckIdNum]);

  const handleComplete = () => {
    setIsSessionComplete(true);
    setSession(null);
    // Fresh numbers for the "All Done!" screen.
    refetch();
    refetchDeck();
    if (!completionLoggedRef.current) logSloth('session_complete');
  };

  // What extensions show on the "All Done!" screen, as on Study's (for the source deck).
  const finish = useDeckFinishParts({ deckId: virtualDeck?.sourceDeckId ?? 0, done: !isLoading && showSloth, report });

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
            {t("You've reviewed all due cards in this virtual deck. Come back later for more!")}
          </p>
          {finish.top}
          {savingFinish && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-300 mb-6">
              {t('Saving your finish… check your Wi-Fi.')}
            </p>
          )}
          {finish.note}
          {virtualDeck && !isFetchingDeck && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-6 text-left">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Total Cards')}</span>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{virtualDeck.cardCount}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('Learned')}</span>
                  <p className="font-semibold text-green-700 dark:text-green-400">{virtualDeck.learnedCount}</p>
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
          <div className="flex items-center gap-2">
            <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
              ← {t('Back to Dashboard')}
            </Link>
            {virtualDeck && (
              <span className="text-gray-400 mx-2" aria-hidden="true">|</span>
            )}
            {virtualDeck && (
              <span className="text-gray-600 dark:text-gray-400 text-sm">
                {virtualDeck.name}
                <span className="text-gray-500 dark:text-gray-400 ml-1">{t('(from {{name}})', { name: virtualDeck.sourceDeckName })}</span>
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('{{count}} cards remaining', { count: cardsLeft ?? session.cards.length })}
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
