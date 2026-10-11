// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import ConjugationRunner from '../components/conjugation/ConjugationRunner';
import ConjugationGuide, { type GuideTarget } from '../components/conjugation/guide/ConjugationGuide';
import GuideCard, { BookIcon } from '../components/conjugation/guide/GuideCard';
import { CHAPTERS } from '../components/conjugation/guide/chapters';
import { useKnownSections } from '../components/conjugation/guide/known';
import { guideLang, plain } from '../components/conjugation/guide/text';
import { guideVerbs, openChapters } from '../components/conjugation/guide/unlock';
import { guideContext, mergeSubjects, type LiveSentences } from '../components/conjugation/guide/context';
import type { SentenceSubject } from '../components/conjugation/ConjugationRunner';
import type { Rung } from '../components/conjugation/guide/types';
import { StudyAllConjugationButton } from '../components/conjugation/StudyAllConjugationButton';
import { useConjugationParts } from '../extensions';

export default function Conjugation() {
  const { user, isAdmin, logout } = useAuth();
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const params = useParams<{ deckId: string }>();
  const deckId = Number(params.deckId);
  const validId = Number.isInteger(deckId) && deckId > 0;

  const { data: overview, isLoading, error, refetch, isFetching } = trpc.conjugation.overview.useQuery(
    { deckId },
    { enabled: validId, retry: false },
  );
  usePageTitle(overview ? t('{{deck}} conjugation', { deck: overview.deckName }) : t('Conjugation'));

  // Only when a round ends: refetching the overview after every answer would cost the server a deck scan each time.
  const onRoundOver = useCallback(() => {
    void utils.conjugation.overview.invalidate({ deckId });
    void utils.conjugation.myQuizzes.invalidate();
  }, [utils, deckId]);

  // The guide: what it shows follows the deck and the student; what is new, what they last saw.
  const [guide, setGuide] = useState<{ target: GuideTarget | null; known: ReadonlySet<string>; opener: HTMLElement | null } | null>(null);
  // The control last pressed on the page: every way into the guide is a press (Enter and Space on a button click it too),
  // and Safari does not focus a clicked button, so this is where focus goes back when the guide closes.
  const pressed = useRef<HTMLElement | null>(null);
  const [rungs, setRungs] = useState<Rung[]>([]);
  // A question waiting for its answer holds the guide back (it opens between questions); asking meanwhile is counted, for the runner to say so.
  const [waiting, setWaiting] = useState(false);
  const [guideAsked, setGuideAsked] = useState(0);
  const onRung = useCallback((rung: Rung) => setRungs((prev) => (prev.includes(rung) ? prev : [...prev, rung])), []);
  // Sentences answered on this visit (v1.25.0): the guide's "Who is the subject?" opens, its table gains their subjects.
  const [live, setLive] = useState<LiveSentences>({ seen: false, subjects: [] });
  const onSentence = useCallback((subject: SentenceSubject | null) => setLive((prev) => {
    const subjects = subject ? mergeSubjects([subject], prev.subjects) : prev.subjects;
    return prev.seen && subjects === prev.subjects ? prev : { seen: true, subjects };
  }), []);
  const { known, remember } = useKnownSections(user?.id);
  // What extensions show above the runner, and hear of finished sets and rounds (nothing without them).
  const parts = useConjugationParts({ scope: 'deck' });
  const verbs = useMemo(
    () => (overview ? guideVerbs(overview.verbs, overview.tenses.map((x) => x.id)) : []),
    [overview],
  );
  const ctx = useMemo(() => (overview ? guideContext(overview, verbs, rungs, live) : null), [overview, verbs, rungs, live]);
  const openNow = useMemo(() => (ctx ? openChapters(CHAPTERS, ctx).flatMap((o) => o.sections) : []), [ctx]);
  // A named mistake links the first of its sections this deck's guide shows.
  const openSections = useMemo(() => new Set(openNow.map((s) => s.id)), [openNow]);
  const firstVisit = known.size === 0;
  const fresh = firstVisit ? [] : openNow.filter((s) => !known.has(s.id));
  const openGuide = useCallback((target?: GuideTarget) => {
    if (waiting) {
      setGuideAsked((n) => n + 1);
      return;
    }
    setGuide({ target: target ?? null, known, opener: pressed.current });
    remember(openNow.map((s) => s.id));
  }, [waiting, known, remember, openNow]);
  const closeGuide = useCallback(() => {
    // Parts that opened while it was open are known too.
    remember(openNow.map((s) => s.id));
    setGuide(null);
  }, [remember, openNow]);
  const lang = guideLang(locale);
  const guideCard = ctx ? (
    <GuideCard
      firstVisit={firstVisit}
      newTitles={fresh.map((s) => plain(s.title, lang))}
      firstNew={fresh[0]?.id}
      onOpen={openGuide}
    />
  ) : null;

  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  let body;
  if (!validId || code === 'NOT_FOUND') {
    body = <Notice>{t('This deck has no conjugation practice right now.')}</Notice>;
  } else if (code === 'FORBIDDEN') {
    body = <Notice>{t('You do not have access to this deck.')}</Notice>;
  } else if (isLoading) {
    body = <div className="animate-pulse text-gray-500 dark:text-gray-400" role="status">{t('Loading...')}</div>;
  } else if (!overview) {
    body = (
      <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 space-y-4">
        <p className="text-red-700 dark:text-red-400">{t('Could not load this practice. Check your connection and try again.')}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {t('Retry')}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {isAdmin && !overview.enabled && (
          <p className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200">
            {t('Conjugation practice is off for this deck: students cannot see it. You are trying it as a teacher.')}
          </p>
        )}
        {parts.top}
        {/* refreshing: a cached overview shown on coming back may not know of the round left open yet. */}
        <ConjugationRunner
          deckId={deckId}
          overview={overview}
          onRoundOver={onRoundOver}
          refreshing={isFetching}
          guideCard={guideCard}
          onOpenGuide={openGuide}
          paused={guide !== null}
          onRung={onRung}
          onSentence={onSentence}
          onWaiting={setWaiting}
          guideAsked={guideAsked}
          openSections={openSections}
          onSetsFinished={parts.onSetsFinished}
          onRoundFinished={parts.onRoundFinished}
          // v1.18.0: every quiz in one round (conjugation "Study all").
          between={<StudyAllConjugationButton />}
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900"
      onClickCapture={(e) => { pressed.current = (e.target as Element).closest<HTMLElement>('button, a[href]'); }}
    >
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6 flex flex-wrap justify-between items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
            <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
              ← {t('Back to Study')}
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 break-words min-w-0">
              {overview ? t('{{deck}} conjugation', { deck: overview.deckName }) : t('Conjugation')}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {ctx && (
              <button
                type="button"
                onClick={() => openGuide()}
                aria-disabled={waiting || undefined}
                className={`relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${waiting
                  ? 'text-gray-400 dark:text-gray-500 cursor-default'
                  : 'text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30'}`}
              >
                <BookIcon />
                <span>{t('Guide')}</span>
                {fresh.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase px-1.5 rounded bg-violet-600 text-white">{t('New')}</span>
                )}
              </button>
            )}
            <span className="hidden sm:inline text-gray-700 dark:text-gray-300">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {t('Sign out')}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-3xl mx-auto px-4 py-6 sm:py-8 sm:px-6">
        {body}
      </main>
      {guide && ctx && overview && (
        <ConjugationGuide
          target={guide.target}
          onClose={closeGuide}
          ctx={ctx}
          deckName={overview.deckName}
          isAdmin={isAdmin}
          knownAtOpen={guide.known}
          opener={guide.opener}
        />
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-700 dark:text-gray-300">
      {children}
    </div>
  );
}
