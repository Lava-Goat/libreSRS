// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * /study/all (v1.18.0): flashcard "Study
 * all". Every deck of the student's groups with cards due today, the newest
 * deck first (cards.studyAll: by creation, so the newest unit leads), each
 * exactly as its own Study session: its own cards under its own daily limits
 * and directions (cards.getDueCards), its own reviews, its own "All Done!"
 * report (cards.logStudyCompletion, sent again when the network loses it:
 * "Saving your finish…"). When a deck's session ends the next one starts by
 * itself; after the last, anything that came due meanwhile (a card back from a
 * learning step) is another round, newest first; then one "All Done!" screen.
 *
 * Finishing ALL flashcards, by this page or deck by deck, is recorded by the
 * server at the review that empties the last deck; the last report's answer
 * goes to the extensions' finish screen (useStudyAllFinishParts), which may
 * show something above the saving line and after "More cards are due".
 * Individual decks stay studyable on their own (/study/:id).
 *
 * Each deck's session lives in its own component, keyed by the round and the
 * deck: a refetch of that deck's cards (the connection coming back) only adds
 * cards that came due, and never resets the session or starts another deck's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import type { CardDirection, State } from '@libresrs/shared';
import { trpc } from '../api/trpc';
import FlashcardReview from '../components/FlashcardReview';
import { useStudyAllFinishParts } from '../extensions';
import type { StudyFinishReport } from '../extensions/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { useI18n } from '../i18n';
import { finishRetry } from '../utils/finishRetry';
import { getTimezoneOffsetMinutes } from '../utils/time';

type NextReviewDates = Record<1 | 2 | 3 | 4, string | Date>;

interface CardWithState {
  card: { id: number; deckId: number; front: string; back: string };
  state: { id: number; stability: number; difficulty: number; reps: number; lapses: number; state: State };
  direction: CardDirection;
  nextReviewOptions: NextReviewDates;
}

interface DueCardsResponse {
  cards: CardWithState[];
}

/** A deck in the run, as cards.studyAll named it. */
export interface PlannedDeck {
  deckId: number;
  deckName: string;
}

/** What cards.studyAll answers (the parts this page reads). */
interface StudyAllView {
  decks: PlannedDeck[];
  learningLater: number;
  learningBackInMs: number | null;
}

/** One pass over the decks with cards due, newest first. */
interface Round {
  number: number;
  decks: PlannedDeck[];
}

const spinner = (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
  </div>
);

/**
 * Whether a query's data came from a fetch that succeeded at or after `since`
 * (ms): a list cached from an earlier visit, or kept after a fetch that failed
 * (TanStack keeps the old data then, and counts the failure as "fetched after
 * mount"), is not.
 */
const fetchedSince = (query: { status: string; dataUpdatedAt: number }, since: number) =>
  query.status === 'success' && query.dataUpdatedAt >= since;

/**
 * One deck's session in the run: its due cards fetched afresh (a list cached
 * from an earlier visit could hold cards done since), then FlashcardReview.
 * Tells `onDone` once: rated (the session ran to its end), or not (nothing to
 * study in it now, or the student skipped a deck whose cards would not load).
 * Its turn over, the deck's cached list is dropped: its own Study page
 * (/study/:id, the same query) would otherwise open on cards just done.
 */
function StudyAllDeck({ deck, onDone, onExit }: {
  deck: PlannedDeck;
  onDone: (deck: PlannedDeck, rated: boolean) => void;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  // When this deck's turn began: only cards fetched since then may start its session.
  const turnStarted = useRef(Date.now());
  const query = trpc.cards.getDueCards.useQuery(
    { deckId: deck.deckId, timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
    { refetchOnMount: 'always' },
  );
  const { data, error, refetch, isFetching } = query;
  const fresh = fetchedSince(query, turnStarted.current) ? (data as DueCardsResponse | undefined)?.cards : undefined;

  // The session's cards: the latest fetch that had any. An empty refetch mid-session (the last cards
  // wait on a learning step) does not end it: only FlashcardReview's onComplete does.
  const [session, setSession] = useState<CardWithState[] | null>(null);
  const [complete, setComplete] = useState(false);
  if (fresh && fresh.length > 0 && !complete && session !== fresh) setSession(fresh);

  // Once (a ref: StrictMode runs effects twice, and the parent may answer slowly).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const told = useRef(false);
  const finish = useCallback((rated: boolean) => {
    if (told.current) return;
    told.current = true;
    // Every cached list of this deck (any clock offset): the next page to ask fetches it afresh.
    queryClient.removeQueries({ queryKey: getQueryKey(trpc.cards.getDueCards, { deckId: deck.deckId }, 'query') });
    onDoneRef.current(deck, rated);
  }, [deck, queryClient]);

  // Nothing to study in this deck now (done in another tab, or on its own page): on to the next.
  const emptyNow = !!fresh && fresh.length === 0 && session === null;
  useEffect(() => {
    if (emptyNow) finish(false);
  }, [emptyNow, finish]);

  const handleComplete = useCallback(() => {
    setComplete(true);
    finish(true);
  }, [finish]);

  if (session) {
    return <FlashcardReview cards={session} onComplete={handleComplete} onExit={onExit} />;
  }
  if (error && !isFetching) {
    return (
      <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-center space-y-4">
        <p className="text-gray-800 dark:text-gray-200">{t('Could not load the cards of {{deck}}.', { deck: deck.deckName })}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => void refetch()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            {t('Try again')}
          </button>
          <button type="button" onClick={() => finish(false)} className="px-4 py-2 rounded-lg font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('Skip this deck')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-label={t('Loading...')} role="img" />
    </div>
  );
}

export default function StudyAll() {
  const { t } = useI18n();
  usePageTitle('Study all flashcards');
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // When the page opened: the run is planned from an answer fetched since, never the dashboard
  // button's cached one (decks done since would be visited, and counted, again).
  const openedAt = useRef(Date.now());
  const overview = trpc.cards.studyAll.useQuery(
    { timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
    // The run is planned once; later refetches change nothing here.
    { refetchOnMount: 'always', refetchOnReconnect: false },
  );

  const [round, setRound] = useState<Round | null>(null);
  const [index, setIndex] = useState(0);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(false);
  // Cards still due after the last round although none was rated in it: the server and the page disagree.
  const [moreDue, setMoreDue] = useState(false);
  // The decks whose session ran to its end on this visit, in the order they were studied.
  const [studied, setStudied] = useState<PlannedDeck[]>([]);
  const [later, setLater] = useState<{ count: number; backInMs: number | null }>({ count: 0, backInMs: null });
  // The latest completion report's answer (extensions read their fields from it).
  const [report, setReport] = useState<StudyFinishReport | null>(null);
  const ratedThisRound = useRef(false);

  // Each deck's own "All Done!", as its Study page sends it: the server checks it, logs it for the
  // teacher's grid and answers with its report. A report the network lost is sent again.
  const logCompletion = trpc.cards.logStudyCompletion.useMutation({ ...finishRetry });
  const savingFinish = logCompletion.isPending && (logCompletion.failureCount > 0 || logCompletion.isPaused);

  const start = useCallback((view: StudyAllView, number: number) => {
    setLater({ count: view.learningLater, backInMs: view.learningBackInMs });
    ratedThisRound.current = false;
    if (view.decks.length === 0) {
      setRound(null);
      setDone(true);
      return;
    }
    setRound({ number, decks: view.decks.map((d) => ({ deckId: d.deckId, deckName: d.deckName })) });
    setIndex(0);
  }, []);

  // The plan, once: the decks due when the page opened, newest first.
  const planned = useRef(false);
  const view = fetchedSince(overview, openedAt.current) ? overview.data : undefined;
  useEffect(() => {
    if (planned.current || !view) return;
    planned.current = true;
    start(view, 1);
  }, [view, start]);

  const onDeckDone = (deck: PlannedDeck, rated: boolean) => {
    if (rated) {
      ratedThisRound.current = true;
      setStudied((prev) => (prev.some((d) => d.deckId === deck.deckId) ? prev : [...prev, deck]));
      logCompletion.mutate(
        { deckId: deck.deckId, reason: 'session_complete', timezoneOffsetMinutes: getTimezoneOffsetMinutes() },
        { onSuccess: (result) => setReport(result) },
      );
    }
    if (!round) return;
    if (index + 1 < round.decks.length) {
      setIndex(index + 1);
      return;
    }
    // The round is over. What came due meanwhile is another round, newest first; a round that
    // rated nothing ends the run, so a disagreement can never loop.
    setChecking(true);
    void utils.cards.studyAll.fetch({ timezoneOffsetMinutes: getTimezoneOffsetMinutes() })
      .then((fresh) => {
        if (fresh.decks.length > 0 && ratedThisRound.current) {
          start(fresh, round.number + 1);
          return;
        }
        setLater({ count: fresh.learningLater, backInMs: fresh.learningBackInMs });
        setMoreDue(fresh.decks.length > 0);
        setRound(null);
        setDone(true);
      })
      .catch(() => {
        setRound(null);
        setDone(true);
      })
      .finally(() => setChecking(false));
  };

  // What extensions show on the "All Done!" screen (nothing without them).
  const finish = useStudyAllFinishParts({ done, report });

  // The "All Done!" screen takes focus, so a screen reader hears that the run ended.
  const doneHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  if (overview.error && !round && !done) {
    return (
      <main id="main-content" className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 max-w-md w-full text-center space-y-4">
          <p className="text-gray-800 dark:text-gray-200">{t('Could not load your decks.')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => void overview.refetch()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
              {t('Try again')}
            </button>
            <Link to="/" className="px-4 py-2 rounded-lg font-medium text-blue-700 dark:text-blue-300 hover:underline">{t('Back to Dashboard')}</Link>
          </div>
        </div>
      </main>
    );
  }

  if (done) {
    const backInMinutes = Math.max(1, Math.ceil((later.backInMs ?? 0) / 60000));
    return (
      <main id="main-content" className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-gray-900/30 p-8 max-w-md w-full text-center">
          <img src="/mascot.png" alt="libreSRS mascot" className="w-24 h-24 mx-auto mb-4" />
          <h1 ref={doneHeading} tabIndex={-1} className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2 focus:outline-none">{t('All Done!')}</h1>
          {/* With cards still due (moreDue says so below), neither "every deck studied" nor "nothing due" is true. */}
          {!moreDue && (
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {studied.length > 0
                ? t("You've studied every deck with cards due today. Come back later for more!")
                : t('Nothing is due in any of your decks right now. Come back later for more!')}
            </p>
          )}
          {later.count > 0 && (
            <p className="text-gray-600 dark:text-gray-400 mb-6" data-testid="learning-later">
              {later.count === 1
                ? t('1 card comes back in about {{minutes}} min.', { minutes: backInMinutes })
                : t('{{count}} cards come back in about {{minutes}} min.', { count: later.count, minutes: backInMinutes })}
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
          {studied.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-6 text-left">
              <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{t('Decks studied')}</h2>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                {studied.map((deck) => (
                  <li key={deck.deckId}>
                    <span aria-hidden="true" className="text-green-700 dark:text-green-400">✓ </span>{deck.deckName}
                  </li>
                ))}
              </ul>
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

  if (!round || checking) return spinner;

  const deck = round.decks[index];
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <h1 className="sr-only">{t('Study all flashcards')}</h1>
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-wrap justify-between items-center gap-x-4 gap-y-2">
          <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
            ← {t('Back to Dashboard')}
          </Link>
          {/* A live region that stays on the page: each new deck is announced as it starts. */}
          <p role="status" className="text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="study-all-deck">
            {t('Deck {{position}} of {{count}}: {{deck}}', { position: index + 1, count: round.decks.length, deck: deck.deckName })}
          </p>
        </div>
        {savingFinish && (
          <p role="status" className="max-w-7xl mx-auto px-4 pb-3 sm:px-6 lg:px-8 text-sm text-amber-800 dark:text-amber-300">
            {t('Saving your finish… check your Wi-Fi.')}
          </p>
        )}
      </header>
      <main id="main-content" className="max-w-3xl mx-auto px-4 py-8">
        <StudyAllDeck key={`${round.number}:${deck.deckId}`} deck={deck} onDone={onDeckDone} onExit={() => navigate('/')} />
      </main>
    </div>
  );
}
