// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { ROUND_SCOPES, type RoundScope } from './index.js';

describe('conjugation round scopes (v1.18.0)', () => {
  it('are one deck\'s quiz or Study all', () => {
    expect(ROUND_SCOPES).toEqual(['deck', 'all']);
    const scope: RoundScope = 'all';
    expect(ROUND_SCOPES).toContain(scope);
  });
});
