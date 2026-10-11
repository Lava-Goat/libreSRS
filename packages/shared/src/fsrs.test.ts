// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { createNewCardState, scheduleReview, getNextReviewOptions, Rating, State } from './fsrs';

describe('createNewCardState', () => {
  it('returns valid initial card state', () => {
    const card = createNewCardState();

    expect(card).toBeDefined();
    expect(card).toHaveProperty('stability');
    expect(card).toHaveProperty('difficulty');
    expect(card).toHaveProperty('elapsedDays');
    expect(card).toHaveProperty('scheduledDays');
    expect(card).toHaveProperty('reps');
    expect(card).toHaveProperty('lapses');
    expect(card).toHaveProperty('state');
    expect(card).toHaveProperty('lastReview');
  });

  it('has correct default values', () => {
    const card = createNewCardState();

    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.elapsedDays).toBe(0);
    expect(card.scheduledDays).toBe(0);
    expect(card.lastReview).toBeNull();
  });
});

describe('scheduleReview', () => {
  it('transitions New card to Learning on first review', () => {
    const card = createNewCardState();
    const result = scheduleReview(card, Rating.Good);

    expect(result.state).toBe(State.Learning);
  });

  it('increments reps counter', () => {
    const card = createNewCardState();
    expect(card.reps).toBe(0);

    const result = scheduleReview(card, Rating.Good);
    expect(result.reps).toBe(1);
  });

  it('different ratings produce different next review dates', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const againResult = scheduleReview(card, Rating.Again, now);
    const hardResult = scheduleReview(card, Rating.Hard, now);
    const goodResult = scheduleReview(card, Rating.Good, now);
    const easyResult = scheduleReview(card, Rating.Easy, now);

    // All should have different next review dates
    const dates = [
      againResult.nextReview.getTime(),
      hardResult.nextReview.getTime(),
      goodResult.nextReview.getTime(),
      easyResult.nextReview.getTime(),
    ];

    // Check that not all dates are the same (at least some variation)
    const uniqueDates = new Set(dates);
    expect(uniqueDates.size).toBeGreaterThan(1);
  });

  it('Rating.Again produces shortest interval', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const againResult = scheduleReview(card, Rating.Again, now);
    const goodResult = scheduleReview(card, Rating.Good, now);

    expect(againResult.nextReview.getTime()).toBeLessThanOrEqual(goodResult.nextReview.getTime());
  });

  it('Rating.Easy produces longest interval', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const hardResult = scheduleReview(card, Rating.Hard, now);
    const easyResult = scheduleReview(card, Rating.Easy, now);

    expect(easyResult.nextReview.getTime()).toBeGreaterThanOrEqual(hardResult.nextReview.getTime());
  });

  it('updates difficulty based on rating', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const againResult = scheduleReview(card, Rating.Again, now);
    const easyResult = scheduleReview(card, Rating.Easy, now);

    // Again should increase difficulty, Easy should decrease it
    expect(againResult.difficulty).toBeGreaterThan(easyResult.difficulty);
  });

  it('updates stability based on rating', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const againResult = scheduleReview(card, Rating.Again, now);
    const easyResult = scheduleReview(card, Rating.Easy, now);

    // Easy should have higher stability than Again
    expect(easyResult.stability).toBeGreaterThan(againResult.stability);
  });

  it('sets lastReview to the review time', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');

    const result = scheduleReview(card, Rating.Good, now);

    expect(result.lastReview.getTime()).toBe(now.getTime());
  });
});

describe('getNextReviewOptions', () => {
  it('returns dates for all 4 ratings', () => {
    const card = createNewCardState();
    const options = getNextReviewOptions(card);

    expect(options[Rating.Again]).toBeInstanceOf(Date);
    expect(options[Rating.Hard]).toBeInstanceOf(Date);
    expect(options[Rating.Good]).toBeInstanceOf(Date);
    expect(options[Rating.Easy]).toBeInstanceOf(Date);
  });

  it('Again <= Hard <= Good <= Easy ordering', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');
    const options = getNextReviewOptions(card, now);

    expect(options[Rating.Again].getTime()).toBeLessThanOrEqual(options[Rating.Hard].getTime());
    expect(options[Rating.Hard].getTime()).toBeLessThanOrEqual(options[Rating.Good].getTime());
    expect(options[Rating.Good].getTime()).toBeLessThanOrEqual(options[Rating.Easy].getTime());
  });

  it('dates are at or after the review time', () => {
    const card = createNewCardState();
    const now = new Date('2024-01-15T10:00:00Z');
    const options = getNextReviewOptions(card, now);

    expect(options[Rating.Again].getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(options[Rating.Hard].getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(options[Rating.Good].getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(options[Rating.Easy].getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});
