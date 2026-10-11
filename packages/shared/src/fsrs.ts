// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { FSRS, createEmptyCard, Rating, State, type Card as FSRSCard } from 'ts-fsrs';

export { Rating, State };
export type { FSRSCard };

const fsrs = new FSRS({});

export interface CardForReview {
  stability: number;
  difficulty: number;
  learningSteps?: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: Date | null;
}

export interface SchedulingResult {
  stability: number;
  difficulty: number;
  learningSteps: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: Date;
  nextReview: Date;
}

export type ReviewRating = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;

export function createNewCardState(): CardForReview {
  const emptyCard = createEmptyCard();
  return {
    stability: emptyCard.stability,
    difficulty: emptyCard.difficulty,
    learningSteps: emptyCard.learning_steps,
    elapsedDays: emptyCard.elapsed_days,
    scheduledDays: emptyCard.scheduled_days,
    reps: emptyCard.reps,
    lapses: emptyCard.lapses,
    state: emptyCard.state,
    lastReview: emptyCard.last_review ?? null,
  };
}

export function scheduleReview(cardState: CardForReview, rating: ReviewRating, now: Date = new Date()): SchedulingResult {
  const fsrsCard: FSRSCard = {
    due: now,
    stability: cardState.stability,
    difficulty: cardState.difficulty,
    learning_steps: cardState.learningSteps ?? 0,
    elapsed_days: cardState.elapsedDays,
    scheduled_days: cardState.scheduledDays,
    reps: cardState.reps,
    lapses: cardState.lapses,
    state: cardState.state,
    last_review: cardState.lastReview ?? undefined,
  };

  const recordLog = fsrs.repeat(fsrsCard, now);
  const result = recordLog[rating];
  const newCard = result.card;

  return {
    stability: newCard.stability,
    difficulty: newCard.difficulty,
    learningSteps: newCard.learning_steps,
    elapsedDays: newCard.elapsed_days,
    scheduledDays: newCard.scheduled_days,
    reps: newCard.reps,
    lapses: newCard.lapses,
    state: newCard.state,
    lastReview: now,
    nextReview: newCard.due,
  };
}

export interface NextReviewOptions {
  [Rating.Again]: Date;
  [Rating.Hard]: Date;
  [Rating.Good]: Date;
  [Rating.Easy]: Date;
}

export function getNextReviewOptions(cardState: CardForReview, now: Date = new Date()): NextReviewOptions {
  const fsrsCard: FSRSCard = {
    due: now,
    stability: cardState.stability,
    difficulty: cardState.difficulty,
    learning_steps: cardState.learningSteps ?? 0,
    elapsed_days: cardState.elapsedDays,
    scheduled_days: cardState.scheduledDays,
    reps: cardState.reps,
    lapses: cardState.lapses,
    state: cardState.state,
    last_review: cardState.lastReview ?? undefined,
  };

  const recordLog = fsrs.repeat(fsrsCard, now);

  return {
    [Rating.Again]: recordLog[Rating.Again].card.due,
    [Rating.Hard]: recordLog[Rating.Hard].card.due,
    [Rating.Good]: recordLog[Rating.Good].card.due,
    [Rating.Easy]: recordLog[Rating.Easy].card.due,
  };
}
