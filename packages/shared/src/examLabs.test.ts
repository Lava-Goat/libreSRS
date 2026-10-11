// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { EXAM_APP_CODES, EXAM_SET_MAX_LENGTH, canonicalExamSet } from './index.js';

describe('exam labs', () => {
  it('stores a set name trimmed, with inner whitespace collapsed to one space', () => {
    expect(canonicalExamSet('U3')).toBe('U3');
    expect(canonicalExamSet('  U3 ')).toBe('U3');
    expect(canonicalExamSet('Unidad   3\tfinal')).toBe('Unidad 3 final');
    expect(canonicalExamSet('\n Examen U2 \n')).toBe('Examen U2');
    // Case is kept: the server reuses an existing set's spelling, whatever the case.
    expect(canonicalExamSet('u3')).toBe('u3');
  });

  it('has no name for an empty or too-long set', () => {
    expect(EXAM_SET_MAX_LENGTH).toBe(40);
    for (const empty of ['', '   ', '\t\n', null, undefined]) expect(canonicalExamSet(empty)).toBeNull();
    expect(canonicalExamSet('x'.repeat(40))).toBe('x'.repeat(40));
    expect(canonicalExamSet('x'.repeat(41))).toBeNull();
    // Measured after trimming and collapsing.
    expect(canonicalExamSet(`  ${'x'.repeat(20)}     ${'y'.repeat(19)}  `)).toHaveLength(40);
    expect(canonicalExamSet(3 as unknown as string)).toBeNull();
  });

  it('names each refusal with an app code the page words itself', () => {
    expect(EXAM_APP_CODES).toEqual({
      used: 'EXAM_USED',
      changed: 'EXAM_CHANGED',
      notStarted: 'EXAM_NOT_STARTED',
      alreadyReset: 'EXAM_ALREADY_RESET',
      setInvalid: 'EXAM_SET_INVALID',
    });
  });
});
