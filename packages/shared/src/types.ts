// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { State, Rating } from 'ts-fsrs';

export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
  createdAt: Date;
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface UserGroup {
  userId: number;
  groupId: number;
  joinedAt: Date;
}

export interface Deck {
  id: number;
  name: string;
  description: string | null;
  reversible: boolean;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  speechAccent: string | null;
  createdBy: number;
  createdAt: Date;
}

export interface DeckGroup {
  deckId: number;
  groupId: number;
}

export interface Card {
  id: number;
  deckId: number;
  front: string;
  back: string;
  createdAt: Date;
}

export enum CardDirection {
  Forward = 0,
  Reverse = 1,
}

export interface CardState {
  id: number;
  cardId: number;
  userId: number;
  direction: CardDirection;
  stability: number;
  difficulty: number;
  learningSteps?: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: Date | null;
  nextReview: Date;
}

export interface ReviewLog {
  id: number;
  cardId: number;
  cardStateId?: number | null;
  userId: number;
  rating: Rating;
  reviewedAt: Date;
  timeSpentMs: number;
  previousState: State;
  newState: State;
  previousStateSnapshot?: string | null;
}

export interface UserSettings {
  userId: number;
  newCardsPerDay: number;
  reviewsPerDay: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStats {
  totalCards: number;
  cardsDue: number;
  cardsLearned: number;
  retentionRate: number;
  totalTimeSpentMs: number;
  reviewsToday: number;
  streakDays: number;
}

export interface DeckWithStats extends Deck {
  cardCount: number;
  dueCount: number;
  learnedCount: number;
}

export interface GroupWithMembers extends Group {
  memberCount: number;
  deckCount: number;
}

export interface AdminUserStats {
  userId: number;
  userName: string;
  email: string;
  totalReviews: number;
  totalTimeMs: number;
  retentionRate: number;
  lastActive: Date | null;
}

// AI types
export type AiAssetType = 'image' | 'audio';
export type AiAssetStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface AiAsset {
  id: number;
  cardId: number;
  assetType: AiAssetType;
  provider: string;
  prompt: string;
  url: string | null;
  status: AiAssetStatus;
  errorMessage: string | null;
  createdAt: Date;
}

export interface AiMnemonic {
  id: number;
  cardId: number;
  userId: number;
  provider: string;
  text: string;
  sourcePrompt: string;
  accepted: boolean;
  acceptedAt: Date | null;
  createdAt: Date;
}
