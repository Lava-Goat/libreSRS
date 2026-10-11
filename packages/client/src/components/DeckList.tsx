import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../api/trpc';
import DeckSettings from './DeckSettings';
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';

export default function DeckList() {
  const { t } = useI18n();
  const { data: decks, isLoading } = trpc.cards.getMyDecks.useQuery({
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
  });
  // "[Deck] conjugation" links, for decks the teacher turned the quiz on for.
  const { data: quizzes } = trpc.conjugation.myQuizzes.useQuery();
  const quizByDeck = new Map((quizzes ?? []).map((quiz) => [quiz.deckId, quiz]));
  const [expandedDeckId, setExpandedDeckId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 animate-pulse"
          >
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (!decks || decks.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-8 text-center">
        <div className="text-4xl mb-4">📚</div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">{t('No decks available')}</h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t("You haven't been assigned to any groups with decks yet. Contact your administrator.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {decks.map((deck) => (
        <div
          key={deck.id}
          className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 hover:shadow-md dark:hover:shadow-gray-900/30 transition-shadow"
        >
          <div className="p-6">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{deck.name}</h3>
              <div className="flex items-center gap-2">
                {deck.dueCount > 0 && (
                  <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-sm font-medium px-2.5 py-0.5 rounded">
                    {t('{{count}} due', { count: deck.dueCount })}
                  </span>
                )}
                <button
                  onClick={() => setExpandedDeckId(expandedDeckId === deck.id ? null : deck.id)}
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title={t('Deck settings')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            {deck.description && (
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">{deck.description}</p>
            )}
            {/* The due number is what Study opens with today; reviews past today's limit wait for another day. */}
            {(deck.reviewsBeyondLimit ?? 0) > 0 && (
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-2" data-testid="due-beyond-limit">
                {t("+{{count}} more waiting after today's limit", { count: deck.reviewsBeyondLimit })}
              </p>
            )}
            <div className="flex items-center justify-between">
              <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>{t('{{count}} cards', { count: deck.cardCount })}</span>
                <span>{t('{{count}} learned', { count: deck.learnedCount })}</span>
              </div>
              <Link
                to={`/study/${deck.id}`}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  deck.dueCount > 0
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {deck.dueCount > 0 ? t('Study Now') : t('Review')}
              </Link>
            </div>
          </div>
          <div className="px-6 pb-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{
                  width: `${deck.cardCount > 0 ? (deck.learnedCount / deck.cardCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <ConjugationLink deckId={deck.id} deckName={deck.name} quiz={quizByDeck.get(deck.id)} />
          {expandedDeckId === deck.id && (
            <DeckSettings
              deckId={deck.id}
              onClose={() => setExpandedDeckId(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ConjugationLink({ deckId, deckName, quiz }: {
  deckId: number;
  deckName: string;
  /** due: mastered forms waiting for review ("N forms due"); absent from a server before v1.13. */
  quiz: { mastered: number; total: number; due?: number } | undefined;
}) {
  const { t } = useI18n();
  if (!quiz) return null;
  const due = quiz.due ?? 0;
  return (
    <div className="px-6 pb-4">
      <Link
        to={`/conjugation/${deckId}`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="font-medium text-blue-700 dark:text-blue-400">
          {t('{{deck}} conjugation', { deck: deckName })}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          {due > 0 && (
            <span className="bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium px-2 py-0.5 rounded">
              {due === 1 ? t('1 form due') : t('{{count}} forms due', { count: due })}
            </span>
          )}
          <span>{t('{{mastered}} / {{total}} mastered', { mastered: quiz.mastered, total: quiz.total })}</span>
        </span>
      </Link>
    </div>
  );
}
