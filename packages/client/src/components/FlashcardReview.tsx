import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { trpc } from '../api/trpc';
import { CardDirection, State, Rating, wiktionaryUrl } from '@libresrs/shared';
import type { ReviewRating } from '@libresrs/shared';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import PronunciationButton from './PronunciationButton';
import { playAudio, preloadAudio, stopAudio } from '../utils/audioPlayer';
import MnemonicPanel from './MnemonicPanel';
import AiImagePanel from './AiImagePanel';

type MnemonicMode = 'manual' | 'disabled';
type NextReviewDates = Record<ReviewRating, string | Date>;

const MIN_CARD_FONT_SIZE_REM = 1;
// Hard ceiling for the slider so users (and a runaway binary search on
// empty content) can't pick an absurd value. The effective ceiling is
// usually clamped well below this by the box-fit calculation.
const MAX_CARD_FONT_SIZE_REM = 8;
// Slider position is stored as a fraction in [0, 1] from MIN to the
// dynamic box-fit ceiling. Storing the fraction (not an absolute rem)
// makes the font scale proportionately when the dynamic ceiling moves
// — e.g. on a window resize — instead of staying pinned to whatever
// the user last picked and then snapping when clamped.
const DEFAULT_CARD_FONT_SIZE_FRACTION = 0.1;
const CARD_FONT_SIZE_STORAGE_KEY = 'libresrs:cardFontSizeFraction';

/** The font-size slider persists per device (localStorage may be unavailable
 *  in privacy modes — fall back to the default silently). */
function loadStoredFontSizeFraction(): number {
  try {
    const raw = localStorage.getItem(CARD_FONT_SIZE_STORAGE_KEY);
    const v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch { /* ignore */ }
  return DEFAULT_CARD_FONT_SIZE_FRACTION;
}
// Minimum gap between rendered text and the top/bottom of the card box.
const CARD_TEXT_EDGE_CLEARANCE_PX = 10;
/** The most time a rating sends (cards.review's own limit, an hour). */
const MAX_TIME_SPENT_MS = 3_600_000;

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

/** The cards left in the session, by state: they add up to the cards left. */
export interface SessionCounts {
  newRemaining: number;
  learningRemaining: number;
  reviewRemaining: number;
}

interface Props {
  cards: CardWithState[];
  onComplete: () => void;
  onExit: () => void;
  onSessionCountsChange?: (counts: SessionCounts) => void;
}

interface UndoEntry {
  card: CardWithState;
  reviewLogId: number;
  wasRequeued: boolean;
}

/** Looks the side's text up on English Wiktionary, at its language's section when the deck names it. */
function WiktionaryButton({ text, language }: { text: string; language: string | null }) {
  const { t } = useI18n();
  const plainText = text.replace(/<[^>]*>/g, '').trim();
  if (!plainText) return null;

  const url = wiktionaryUrl(plainText, language);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-gray-300 hover:text-blue-500 transition-colors"
      title={t('Look up "{{word}}" on Wiktionary', { word: plainText })}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    </a>
  );
}

function AdminCardRegenPanel({ cardId, deckId }: { cardId: number; deckId: number }) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const assetsQuery = trpc.ai.getCardAssets.useQuery({ cardId });
  const regenMutation = trpc.ai.regenerateCardAssets.useMutation({
    onSuccess: () => assetsQuery.refetch(),
  });

  if (!isAdmin) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => regenMutation.mutate({ cardId, deckId })}
        disabled={regenMutation.isPending}
        className="text-xs text-orange-700 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300 disabled:opacity-50 transition-colors"
        title={t('Admin: delete and regenerate AI assets for this card')}
      >
        {regenMutation.isPending ? t('Regenerating...') : t('↺ Regenerate assets')}
      </button>
      {regenMutation.isSuccess && (
        <span className="text-xs text-green-600 dark:text-green-400">{t('Done')}</span>
      )}
      {regenMutation.isError && (
        <span className="text-xs text-red-500">{t('Failed')}</span>
      )}
    </div>
  );
}

/** The session's cards by state (Learning and Relearning are both "learning"). */
export function countSessionCards(queue: readonly CardWithState[]): SessionCounts {
  let newRemaining = 0;
  let learningRemaining = 0;
  for (const card of queue) {
    if (card.state.state === State.New) newRemaining += 1;
    else if (card.state.state === State.Learning || card.state.state === State.Relearning) learningRemaining += 1;
  }
  return { newRemaining, learningRemaining, reviewRemaining: queue.length - newRemaining - learningRemaining };
}

export default function FlashcardReview({ cards, onComplete, onExit, onSessionCountsChange }: Props) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<CardWithState[]>(cards);
  // Cards this session finished for good (rated out of learning, so not asked again today). The
  // counter reads "{{seen}} of {{total}} seen · {{done}} done" with total = done + the queue: an
  // "Again" leaves both alone, so it shows how close "All Done!" is instead of growing.
  const [doneCount, setDoneCount] = useState(0);
  const doneIdsRef = useRef<Set<number>>(new Set());
  // Cards answered at least once this session. With the default learning steps a new card needs
  // two answers to be done, so "done" alone sat at 0 for the whole first pass; "seen" moves with
  // every first answer. A count per card (not a flag), so only undoing a card's first answer
  // takes it back out.
  const [seenCount, setSeenCount] = useState(0);
  const answersRef = useRef<Map<number, number>>(new Map());
  const sessionDeckIdRef = useRef<number | undefined>(cards[0]?.card.deckId);
  const [showBack, setShowBack] = useState(false);
  const [startTime, setStartTime] = useState(Date.now());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [cardFontSizeFraction, setCardFontSizeFraction] = useState(loadStoredFontSizeFraction);
  useEffect(() => {
    try { localStorage.setItem(CARD_FONT_SIZE_STORAGE_KEY, String(cardFontSizeFraction)); } catch { /* ignore */ }
  }, [cardFontSizeFraction]);
  const [dynamicMaxFontSize, setDynamicMaxFontSize] = useState(MAX_CARD_FONT_SIZE_REM);
  const questionTextRef = useRef<HTMLDivElement>(null);
  const answerTextRef = useRef<HTMLDivElement>(null);
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const reviewMutation = trpc.cards.review.useMutation();
  const undoMutation = trpc.cards.undoReview.useMutation();
  const aiConfigQuery = trpc.ai.getConfig.useQuery();

  const currentCard = queue[0];
  const deckId = currentCard?.card.deckId ?? cards[0]?.card.deckId ?? 0;

  // Use deck-effective settings (includes per-deck AI/audio overrides falling back to user defaults)
  const deckSettingsQuery = trpc.settings.getDeckSettings.useQuery(
    { deckId },
    { enabled: deckId > 0 }
  );
  const deckSettings = deckSettingsQuery.data;

  // Effective settings from deck (with fallback)
  const effectiveAiEnabled = deckSettings?.aiEnabled ?? true;
  const effectiveAutoPlayAudio = deckSettings?.autoPlayAudio ?? false;
  const effectiveAutoPlayAudioFront = deckSettings?.autoPlayAudioFront ?? false;
  const effectiveMnemonicMode: MnemonicMode = deckSettings?.mnemonicMode ?? 'manual';

  // A new `cards` prop mid-session (a refetch when the connection comes back) only adds cards that
  // came due since. It never brings back a card this session finished, drops one still in
  // learning, or resets the count. Another deck's cards start a new session.
  useEffect(() => {
    const deckOfCards = cards[0]?.card.deckId;
    if (deckOfCards !== undefined && sessionDeckIdRef.current !== undefined && deckOfCards !== sessionDeckIdRef.current) {
      sessionDeckIdRef.current = deckOfCards;
      doneIdsRef.current = new Set();
      answersRef.current = new Map();
      setQueue(cards);
      setDoneCount(0);
      setSeenCount(0);
      setStartTime(Date.now());
      setShowBack(false);
      setUndoStack([]);
      return;
    }
    sessionDeckIdRef.current ??= deckOfCards;
    setQueue((prev) => {
      const queued = new Set(prev.map((c) => c.state.id));
      const added = cards.filter((c) => !queued.has(c.state.id) && !doneIdsRef.current.has(c.state.id));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [cards]);

  useEffect(() => {
    setStartTime(Date.now());
    setShowBack(false);
  }, [currentCard?.state.id]);

  // Compute the largest font size at which neither the question nor the
  // answer text comes within CARD_TEXT_EDGE_CLEARANCE_PX of the top or
  // bottom of the card box. Binary-searches over candidate sizes,
  // pinning the box to the height it would have *with text at MIN font*
  // during measurement — using the current rendered height instead let
  // a previously over-large font lock the container into a grown state
  // (and made the box jump bigger every time Show Answer was clicked).
  //
  // Runs in useLayoutEffect (not useEffect+RAF) so the recomputed font
  // size is applied to the DOM before the next paint; otherwise the
  // user sees the box briefly grow with the old too-large font before
  // we shrink it back.
  useLayoutEffect(() => {
    const computeMax = () => {
      const container = cardContainerRef.current;
      if (!container) return;

      const textEls: HTMLElement[] = [];
      if (questionTextRef.current) textEls.push(questionTextRef.current);
      if (showBack && answerTextRef.current) textEls.push(answerTextRef.current);
      if (textEls.length === 0) return;

      const savedFontSizes = textEls.map((el) => el.style.fontSize);
      const savedHeight = container.style.height;
      const savedMaxHeight = container.style.maxHeight;

      // Shrink text to MIN so the container relaxes to its natural
      // floor (typically driven by CSS min-height + non-text chrome
      // like the AI image panel). That's the height we'll constrain
      // larger fonts against — never the inflated post-growth height.
      for (const el of textEls) el.style.fontSize = `${MIN_CARD_FONT_SIZE_REM}rem`;
      void container.offsetHeight;
      const targetBoxHeight = container.clientHeight;
      if (targetBoxHeight <= 0) {
        // jsdom and other layout-less environments — bail out leaving
        // dynamicMaxFontSize at its current value so the slider stays
        // usable in tests.
        textEls.forEach((el, i) => {
          el.style.fontSize = savedFontSizes[i];
        });
        return;
      }

      container.style.height = `${targetBoxHeight}px`;
      container.style.maxHeight = `${targetBoxHeight}px`;

      const fits = (fsRem: number): boolean => {
        for (const el of textEls) el.style.fontSize = `${fsRem}rem`;
        void container.offsetHeight;
        const boxRect = container.getBoundingClientRect();
        for (const el of textEls) {
          const r = el.getBoundingClientRect();
          if (r.top - boxRect.top < CARD_TEXT_EDGE_CLEARANCE_PX) return false;
          if (boxRect.bottom - r.bottom < CARD_TEXT_EDGE_CLEARANCE_PX) return false;
        }
        return true;
      };

      let lo = MIN_CARD_FONT_SIZE_REM;
      let hi = MAX_CARD_FONT_SIZE_REM;
      if (fits(lo)) {
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
      }

      textEls.forEach((el, i) => {
        el.style.fontSize = savedFontSizes[i];
      });
      container.style.height = savedHeight;
      container.style.maxHeight = savedMaxHeight;

      const next = Math.max(MIN_CARD_FONT_SIZE_REM, lo);
      setDynamicMaxFontSize((prev) => (Math.abs(next - prev) < 0.01 ? prev : next));
    };

    computeMax();

    const container = cardContainerRef.current;
    let observer: ResizeObserver | undefined;
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(computeMax);
      observer.observe(container);
    }
    // Backstop for layouts where the container's width is governed by
    // a viewport-relative ancestor that doesn't propagate a size change
    // through ResizeObserver.
    window.addEventListener('resize', computeMax);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', computeMax);
    };
  }, [currentCard?.card.id, showBack]);

  // Proportional scaling: the slider position is a fraction of the
  // [MIN, dynamicMax] range. When dynamicMax moves (resize, show-back
  // flip) the effective rem scales with it and the slider thumb stays
  // visually parked at the same relative position.
  const effectiveFontSize =
    MIN_CARD_FONT_SIZE_REM +
    cardFontSizeFraction * Math.max(0, dynamicMaxFontSize - MIN_CARD_FONT_SIZE_REM);

  const nextCard1 = queue[1];
  const nextCard2 = queue[2];

  // Pre-fetch card assets whenever pronunciation is enabled so audio is ready immediately on card flip.
  const cardAssetsQuery = trpc.ai.getCardAssets.useQuery(
    { cardId: currentCard?.card.id ?? 0 },
    { enabled: !!currentCard && !!aiConfigQuery.data?.pronunciation && effectiveAiEnabled }
  );

  // The current card's mnemonic, fetched before the flip so it shows with the back.
  trpc.ai.getCardAiState.useQuery(
    { cardId: currentCard?.card.id ?? 0 },
    { enabled: !!currentCard }
  );

  // Pre-warm React Query cache for the next two cards so audio and AI state
  // are already fetched by the time the user advances.
  const pronunciationEnabled = !!aiConfigQuery.data?.pronunciation && effectiveAiEnabled;
  trpc.ai.getCardAiState.useQuery(
    { cardId: nextCard1?.card.id ?? 0 },
    { enabled: !!nextCard1 }
  );
  trpc.ai.getCardAiState.useQuery(
    { cardId: nextCard2?.card.id ?? 0 },
    { enabled: !!nextCard2 }
  );

  // Browser-level audio preloading for next cards so the audio decoder is warmed
  const nextCard1Assets = trpc.ai.getCardAssets.useQuery(
    { cardId: nextCard1?.card.id ?? 0 },
    { enabled: !!nextCard1 && pronunciationEnabled }
  );
  const nextCard2Assets = trpc.ai.getCardAssets.useQuery(
    { cardId: nextCard2?.card.id ?? 0 },
    { enabled: !!nextCard2 && pronunciationEnabled }
  );

  const preloadUrls = useMemo(() => {
    const urls: string[] = [];
    for (const assets of [nextCard1Assets.data, nextCard2Assets.data]) {
      if (assets?.audioFront?.url) urls.push(assets.audioFront.url);
      if (assets?.audioBack?.url) urls.push(assets.audioBack.url);
      if (assets?.audio?.url) urls.push(assets.audio.url);
    }
    return urls;
  }, [nextCard1Assets.data, nextCard2Assets.data]);

  useEffect(() => {
    preloadAudio(preloadUrls);
  }, [preloadUrls]);

  // Stop any clip when the review screen goes away.
  useEffect(() => () => stopAudio(), []);

  // Resolved clip URLs. These are plain strings, so a background refetch that
  // returns an identical payload no longer changes an effect dependency —
  // previously that re-ran the autoplay effect, whose cleanup aborted the clip
  // it had just started (autoplay "not working").
  const questionAudioUrl = currentCard
    ? cardAssetsQuery.data?.[currentCard.direction === CardDirection.Forward ? 'audioFront' : 'audioBack']?.url
      ?? cardAssetsQuery.data?.audio?.url ?? null
    : null;
  const answerAudioUrl = currentCard
    ? cardAssetsQuery.data?.[currentCard.direction === CardDirection.Forward ? 'audioBack' : 'audioFront']?.url
      ?? cardAssetsQuery.data?.audio?.url ?? null
    : null;
  const currentCardId = currentCard?.card.id ?? null;
  // A deck can turn audio off per side; when it is off there is no clip and no
  // play button, so nothing offers audio the teacher did not want generated.
  const audioFrontEnabled = cardAssetsQuery.data?.audioFrontEnabled ?? true;
  const audioBackEnabled = cardAssetsQuery.data?.audioBackEnabled ?? true;
  const questionAudioEnabled = currentCard
    ? (currentCard.direction === CardDirection.Forward ? audioFrontEnabled : audioBackEnabled)
    : false;
  const answerAudioEnabled = currentCard
    ? (currentCard.direction === CardDirection.Forward ? audioBackEnabled : audioFrontEnabled)
    : false;

  // Auto-play question side when card appears
  useEffect(() => {
    if (showBack) return;
    if (!effectiveAutoPlayAudioFront) return;
    if (!pronunciationEnabled) return;
    if (!questionAudioEnabled) return;
    if (!questionAudioUrl) return;
    const handle = playAudio(questionAudioUrl);
    return () => handle.stop();
  }, [showBack, effectiveAutoPlayAudioFront, pronunciationEnabled, questionAudioEnabled, questionAudioUrl, currentCardId]);

  // Auto-play answer side when card flips
  useEffect(() => {
    if (!showBack) return;
    if (!effectiveAutoPlayAudio) return;
    if (!pronunciationEnabled) return;
    if (!answerAudioEnabled) return;
    if (!answerAudioUrl) return;
    const handle = playAudio(answerAudioUrl);
    return () => handle.stop();
  }, [showBack, effectiveAutoPlayAudio, pronunciationEnabled, answerAudioEnabled, answerAudioUrl, currentCardId]);

  // Use a ref so the effect doesn't re-fire when the callback identity changes
  const onSessionCountsChangeRef = useRef(onSessionCountsChange);
  onSessionCountsChangeRef.current = onSessionCountsChange;

  useEffect(() => {
    if (!currentCard) {
      return;
    }
    onSessionCountsChangeRef.current?.(countSessionCards(queue));
  }, [queue, currentCard]);

  const handleRating = useCallback(async (rating: ReviewRating) => {
    if (!currentCard || reviewMutation.isPending || undoMutation.isPending) return;

    // Within the hour the server takes (it clamps too, for older pages): a card left open over a
    // closed lid, or a clock stepped back, must still take its rating.
    const timeSpent = Math.max(0, Math.min(Date.now() - startTime, MAX_TIME_SPENT_MS));

    const result = await reviewMutation.mutateAsync({
      cardStateId: currentCard.state.id,
      rating,
      timeSpentMs: timeSpent,
    });

    const isLearningState = result.state.state === State.Learning || result.state.state === State.Relearning;
    const updatedCard: CardWithState = {
      ...currentCard,
      state: result.state,
      nextReviewOptions: result.nextReviewOptions,
    };

    const nextQueue = queue.slice(1);
    if (isLearningState) {
      nextQueue.push(updatedCard);
    }

    if (result.reviewLogId) {
      setUndoStack((stack) => [...stack, {
        card: currentCard,
        reviewLogId: result.reviewLogId,
        wasRequeued: isLearningState,
      }]);
    }

    setQueue(nextQueue);
    // Hide the back in the same commit as the queue advance. Leaving it to
    // the [currentCard?.state.id] effect renders the next card's answer side
    // for one commit, where back-side children (the mnemonic panel, answer
    // audio autoplay) see the new card with showBack still true.
    setShowBack(false);
    // The next card is shown now. The effect on the card's id misses a lone card in learning
    // that comes straight back, whose next time would include this whole view.
    setStartTime(Date.now());
    const answers = answersRef.current.get(currentCard.state.id) ?? 0;
    answersRef.current.set(currentCard.state.id, answers + 1);
    if (answers === 0) setSeenCount((count) => count + 1);
    if (!isLearningState) {
      doneIdsRef.current.add(currentCard.state.id);
      setDoneCount((count) => count + 1);
    }

    if (nextQueue.length === 0) {
      onComplete();
    }
  }, [currentCard, queue, startTime, reviewMutation, undoMutation, onComplete]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || undoMutation.isPending || reviewMutation.isPending) {
      return;
    }

    const last = undoStack[undoStack.length - 1];
    const result = await undoMutation.mutateAsync({ reviewLogId: last.reviewLogId });

    const restoredCard: CardWithState = {
      ...last.card,
      state: result.state,
      nextReviewOptions: result.nextReviewOptions,
    };

    setUndoStack((stack) => stack.slice(0, -1));
    // Undoing a card's first answer makes it unseen again; a later answer leaves it seen.
    const answers = answersRef.current.get(last.card.state.id) ?? 0;
    if (answers <= 1) {
      answersRef.current.delete(last.card.state.id);
      if (answers === 1) setSeenCount((count) => Math.max(0, count - 1));
    } else {
      answersRef.current.set(last.card.state.id, answers - 1);
    }
    // Undoing the rating that finished a card puts it back among the cards left.
    if (!last.wasRequeued) {
      doneIdsRef.current.delete(last.card.state.id);
      setDoneCount((count) => Math.max(0, count - 1));
    }
    setQueue((prevQueue) => {
      const nextQueue = prevQueue.slice();
      if (last.wasRequeued) {
        for (let i = nextQueue.length - 1; i >= 0; i -= 1) {
          const candidate = nextQueue[i];
          if (candidate.card.id === restoredCard.card.id && candidate.direction === restoredCard.direction) {
            nextQueue.splice(i, 1);
            break;
          }
        }
      }
      return [restoredCard, ...nextQueue];
    });
    setShowBack(false);
    setStartTime(Date.now());
  }, [undoStack, undoMutation, reviewMutation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (reviewMutation.isPending) {
        return;
      }

      // Don't intercept keyboard events on interactive elements (links, buttons)
      // so that Exit / Back to Dashboard remain keyboard-accessible
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'A' || target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.tagName === 'INPUT')) {
        return;
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (!showBack) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          setShowBack(true);
        }
      } else {
        if (e.key === '1') handleRating(Rating.Again);
        else if (e.key === '2') handleRating(Rating.Hard);
        else if (e.key === '3') handleRating(Rating.Good);
        else if (e.key === '4') handleRating(Rating.Easy);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showBack, handleRating, handleUndo, reviewMutation.isPending]);

  if (!currentCard) {
    return null;
  }

  // Swap front/back based on direction
  const question = currentCard.direction === CardDirection.Forward ? currentCard.card.front : currentCard.card.back;
  const answer = currentCard.direction === CardDirection.Forward ? currentCard.card.back : currentCard.card.front;
  const questionSide: 'front' | 'back' = currentCard.direction === CardDirection.Forward ? 'front' : 'back';
  const answerSide: 'front' | 'back' = currentCard.direction === CardDirection.Forward ? 'back' : 'front';
  const isReverse = currentCard.direction === CardDirection.Reverse;
  // The languages of this card's own deck (front = source, back = target): settings fetched for
  // another deck (a session that mixes decks, before this deck's arrive) do not count.
  const cardDeckLanguages = deckSettings?.deckId === currentCard.card.deckId ? deckSettings : undefined;
  const sideLanguage = (side: 'front' | 'back') =>
    (side === 'front' ? cardDeckLanguages?.sourceLanguage : cardDeckLanguages?.targetLanguage) ?? null;

  const formatNextReview = (date: string | Date) => {
    const now = new Date();
    const diff = new Date(date).getTime() - now.getTime();
    const minutes = Math.round(diff / 60000);
    const hours = Math.round(diff / 3600000);
    const days = Math.round(diff / 86400000);

    if (minutes < 1) return '< 1m';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  };

  const totalCount = doneCount + queue.length;
  const progressText = t('{{seen}} of {{total}} seen · {{done}} done', { seen: seenCount, total: totalCount, done: doneCount });
  const progressPercent = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const seenPercent = totalCount > 0 ? (Math.min(seenCount, totalCount) / totalCount) * 100 : 0;

  // White labels need a -600 (red, blue) or -700 (orange, green) fill to
  // reach 4.5:1; the -500 fills read as low as 2.2:1.
  const ratingButtons: { rating: ReviewRating; label: string; color: string; key: string }[] = [
    { rating: Rating.Again, label: t('Again'), color: 'bg-red-600 hover:bg-red-700', key: '1' },
    { rating: Rating.Hard, label: t('Hard'), color: 'bg-orange-700 hover:bg-orange-800', key: '2' },
    { rating: Rating.Good, label: t('Good'), color: 'bg-green-700 hover:bg-green-800', key: '3' },
    { rating: Rating.Easy, label: t('Easy'), color: 'bg-blue-600 hover:bg-blue-700', key: '4' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
        <span>{progressText}</span>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">A</span>
            <input
              type="range"
              min={MIN_CARD_FONT_SIZE_REM}
              max={dynamicMaxFontSize}
              step={0.05}
              value={effectiveFontSize}
              onChange={(event) => {
                const val = Number(event.target.value);
                const range = dynamicMaxFontSize - MIN_CARD_FONT_SIZE_REM;
                const fraction = range > 1e-6 ? (val - MIN_CARD_FONT_SIZE_REM) / range : 0;
                const clamped = Math.max(0, Math.min(1, fraction));
                setCardFontSizeFraction(clamped);
                // Persist synchronously in the handler (not only via the
                // effect) so the setting survives even an immediate tab close
                // or crash mid-drag.
                try { localStorage.setItem(CARD_FONT_SIZE_STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
              }}
              aria-label={t('Card font size')}
              className="h-1.5 w-24 accent-blue-600"
            />
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-200">A</span>
          </label>
          <AdminCardRegenPanel cardId={currentCard.card.id} deckId={currentCard.card.deckId} />
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0 || undoMutation.isPending || reviewMutation.isPending}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
          >
            {t('Undo')}
          </button>
          <button onClick={onExit} className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            {t('Exit')}
          </button>
        </div>
      </div>

      <div ref={cardContainerRef} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 overflow-hidden min-h-[400px] flex flex-col" aria-live="polite">
        {isReverse && (
          <div className="px-4 pt-2 flex justify-end">
            <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-full">
              {t('Reverse')}
            </span>
          </div>
        )}
        <div className="flex-1 p-8 flex flex-col">
          <div className="relative flex-1 flex items-center justify-center">
            <div className="absolute top-0 right-0">
              <WiktionaryButton text={question} language={sideLanguage(questionSide)} />
            </div>
            <div className="flex items-center gap-2">
              <div
                ref={questionTextRef}
                className="card-content text-center"
                style={{ fontSize: `${effectiveFontSize}rem` }}
                dangerouslySetInnerHTML={{ __html: question }}
              />
              {aiConfigQuery.data?.pronunciation && effectiveAiEnabled && questionAudioEnabled && (
                  <PronunciationButton
                    cardId={currentCard.card.id}
                    side={questionSide}
                    audioUrl={
                      cardAssetsQuery.data?.[questionSide === 'front' ? 'audioFront' : 'audioBack']?.url ??
                      cardAssetsQuery.data?.audio?.url ??
                      undefined
                    }
                  />
                )}
            </div>
          </div>

          {showBack && (
            <>
              <hr className="my-6 border-gray-200 dark:border-gray-700" />
              <div className="relative flex-1 flex items-center justify-center">
                <div className="absolute top-0 right-0">
                  <WiktionaryButton text={answer} language={sideLanguage(answerSide)} />
                </div>
                <div className="flex items-center gap-2">
                  <div
                    ref={answerTextRef}
                    className="card-content text-center"
                    style={{ fontSize: `${effectiveFontSize}rem` }}
                    dangerouslySetInnerHTML={{ __html: answer }}
                  />
                  {aiConfigQuery.data?.pronunciation && effectiveAiEnabled && answerAudioEnabled && (
                    <PronunciationButton
                      cardId={currentCard.card.id}
                      side={answerSide}
                      audioUrl={
                        cardAssetsQuery.data?.[answerSide === 'front' ? 'audioFront' : 'audioBack']?.url ??
                        cardAssetsQuery.data?.audio?.url ??
                        undefined
                      }
                    />
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-col items-center gap-1">
                {/* AI image panel (only when AI is enabled) */}
                {aiConfigQuery.data && effectiveAiEnabled && (
                  <AiImagePanel cardId={currentCard.card.id} allowGenerate={!!aiConfigQuery.data.image} />
                )}
                {/* Mnemonic panel: always render so the approved mnemonic shows on the back even with AI off.
                    The mode only decides whether a teacher may ask for a suggestion. */}
                <MnemonicPanel
                  cardId={currentCard.card.id}
                  allowGenerate={!!aiConfigQuery.data?.mnemonic && effectiveAiEnabled}
                  mnemonicMode={effectiveMnemonicMode}
                />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
          {!showBack ? (
            <button
              onClick={() => setShowBack(true)}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              {t('Show Answer (Space)')}
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {ratingButtons.map(({ rating, label, color, key }) => (
                <button
                  key={rating}
                  onClick={() => handleRating(rating)}
                  disabled={reviewMutation.isPending || undoMutation.isPending}
                  className={`py-3 px-2 text-white rounded-lg font-medium transition-colors ${color} disabled:opacity-50`}
                >
                  <div className="text-sm">{label}</div>
                  <div className="text-xs">
                    {formatNextReview(currentCard.nextReviewOptions[rating])} ({key})
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Two tones: seen in a light fill, done in the dark one over it. The value is how close
          "All Done!" is; the label says both numbers. */}
      <div
        className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-label={progressText}
        aria-valuenow={Math.round(progressPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          data-testid="progress-seen"
          className="absolute inset-y-0 left-0 bg-blue-200 dark:bg-blue-900 rounded-full transition-all duration-300"
          style={{ width: `${seenPercent}%` }}
        />
        <div
          data-testid="progress-done"
          className="absolute inset-y-0 left-0 bg-blue-600 dark:bg-blue-400 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
