// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { buildTtsInstructions } from './aiTemplates.js';

describe('buildTtsInstructions', () => {
  it('names the language even when only an accent is given', () => {
    const s = buildTtsInstructions({ accent: 'Mexican', language: 'Spanish' });
    expect(s).toContain('Mexican');
    expect(s).toContain('Spanish');
    expect(s.toLowerCase()).toContain('spelling-to-sound');
  });

  it('forces strict language phonetics for pseudowords and forbids English', () => {
    const s = buildTtsInstructions({ language: 'Spanish', pseudoword: true });
    expect(s).toContain('Spanish');
    expect(s.toLowerCase()).toContain('invented');
    expect(s.toLowerCase()).toContain("never use english");
    expect(s.toLowerCase()).toContain('letter by letter');
  });

  it('for real words, instructs language rules without the invented-word clause', () => {
    const s = buildTtsInstructions({ language: 'Spanish' });
    expect(s).toContain('Spanish');
    expect(s.toLowerCase()).not.toContain('invented');
    expect(s.toLowerCase()).toContain('do not switch to english');
  });

  it('accent-only (no language) keeps the simple accent instruction', () => {
    expect(buildTtsInstructions({ accent: 'Castilian' })).toBe('Speak with a Castilian accent. Speak naturally and clearly.');
  });

  it('empty options fall back to the neutral instruction', () => {
    expect(buildTtsInstructions({})).toBe('Speak naturally and clearly.');
  });
});
