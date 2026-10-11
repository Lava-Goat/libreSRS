// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  MAX_CARD_SELECTION_ITEMS,
  MAX_CARD_SELECTION_LENGTH,
  MAX_CARD_SELECTION_RANGE_SPAN,
  parseCardSelection,
  validateCardSelection,
} from './virtualDecks.js';

describe('virtual deck selection parsing', () => {
  it('parses a valid mixed selection', () => {
    expect(parseCardSelection('1-3, 5, 10-11')).toEqual([1, 2, 3, 5, 10, 11]);
  });

  it('rejects ranges that exceed the maximum span', () => {
    const selection = `1-${MAX_CARD_SELECTION_RANGE_SPAN + 1}`;
    const result = validateCardSelection(selection);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('rejects selections that expand beyond the maximum total cards', () => {
    const selection = `1-${MAX_CARD_SELECTION_RANGE_SPAN}, ${MAX_CARD_SELECTION_RANGE_SPAN + 1}-${MAX_CARD_SELECTION_RANGE_SPAN * 2}, ${MAX_CARD_SELECTION_ITEMS + 1}`;
    const result = validateCardSelection(selection);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('rejects selections that exceed maximum string length', () => {
    const selection = `1${',1'.repeat(MAX_CARD_SELECTION_LENGTH)}`;
    const result = validateCardSelection(selection);

    expect(selection.length).toBeGreaterThan(MAX_CARD_SELECTION_LENGTH);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('returns an empty parse result for invalid selections', () => {
    expect(parseCardSelection(`1-${MAX_CARD_SELECTION_RANGE_SPAN + 1}`)).toEqual([]);
  });
});
