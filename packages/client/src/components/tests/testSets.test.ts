// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The tests by exam set (v1.21.0): only test items, grouped whatever the case
 * of their set's name, sets in natural order, forms before speaking tests; and
 * what is left to take, one per listening part not started plus each speaking
 * test not turned in; and the set names the teacher's "Exam set" fields offer.
 */
import { describe, expect, it } from 'vitest';
import { examSetNames, testSets, testsToDo } from './testSets';

const start = { labId: 51, title: 'Examen U2 · Forma A', startedAt: 1_790_000_000_000, finished: true };
const lab = (id: number, set: string | null, started = false, preview = false) => ({
  id,
  title: `Lab ${id}`,
  ...(set === null ? {} : { exam: { set, preview, start: started ? start : null } }),
});
const task = (id: number, examSet: string | null | undefined, submittedAt: Date | null = null) => ({
  id, title: `Tarea ${id}`, examSet, submittedAt,
});

describe('testSets', () => {
  it('groups the forms and speaking tests of a set whatever the case, in the first spelling met, a lab’s first', () => {
    const sets = testSets([lab(41, 'U3'), lab(42, 'u3')], [task(7, 'U3'), task(8, 'u3')]);
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe('U3');
    expect(sets[0].labs.map((l) => l.id)).toEqual([41, 42]);
    expect(sets[0].speaking.map((t) => t.id)).toEqual([7, 8]);

    // A set named first by a task, when no lab spells it: the task's spelling.
    expect(testSets([], [task(7, 'u4'), task(8, 'U4')])[0].name).toBe('u4');
    // A lab's spelling wins even when the task comes first in its own list.
    expect(testSets([lab(41, 'U4')], [task(7, 'u4')])[0].name).toBe('U4');
  });

  it('leaves out practice labs and tasks (no exam, a null or a missing examSet)', () => {
    const sets = testSets([lab(1, null), lab(41, 'U3')], [task(1, null), task(2, undefined), task(3, ''), task(7, 'U3')]);
    expect(sets).toHaveLength(1);
    expect(sets[0].labs.map((l) => l.id)).toEqual([41]);
    expect(sets[0].speaking.map((t) => t.id)).toEqual([7]);
    expect(testSets([lab(1, null)], [task(1, null)])).toEqual([]);
    expect(testSets(undefined, undefined)).toEqual([]);
  });

  it('sorts the sets in natural order: U2, U3, U10', () => {
    const sets = testSets([lab(1, 'U10'), lab(2, 'U3')], [task(3, 'U2')]);
    expect(sets.map((set) => set.name)).toEqual(['U2', 'U3', 'U10']);
  });

  it('keeps the server’s order inside a set, forms apart from speaking tests', () => {
    const [set] = testSets([lab(42, 'U3'), lab(41, 'U3')], [task(9, 'U3'), task(8, 'U3')]);
    expect(set.labs.map((l) => l.id)).toEqual([42, 41]);
    expect(set.speaking.map((t) => t.id)).toEqual([9, 8]);
  });

  it('handles a set with only a speaking test, and one with only forms', () => {
    const sets = testSets([lab(41, 'U3')], [task(7, 'U2')]);
    expect(sets).toEqual([
      { name: 'U2', labs: [], speaking: [task(7, 'U2')] },
      { name: 'U3', labs: [lab(41, 'U3')], speaking: [] },
    ]);
  });
});

describe('testsToDo', () => {
  it('a set whose listening part is started counts 0', () => {
    expect(testsToDo(testSets([lab(51, 'U2', true), lab(52, 'U2', true)], []))).toBe(0);
  });

  it('a set not started counts once, however many forms it has', () => {
    expect(testsToDo(testSets([lab(41, 'U3'), lab(42, 'U3'), lab(43, 'U3'), lab(44, 'U3')], []))).toBe(1);
  });

  it('each speaking test not turned in counts one', () => {
    const turnedIn = new Date('2026-10-08T16:00:00Z');
    expect(testsToDo(testSets([], [task(7, 'U2'), task(8, 'U2'), task(9, 'U2', turnedIn)]))).toBe(2);
    // With a started listening part: only the speaking test.
    expect(testsToDo(testSets([lab(51, 'U2', true)], [task(7, 'U2')]))).toBe(1);
    // With one not started: both.
    expect(testsToDo(testSets([lab(41, 'U3')], [task(7, 'U3'), task(8, 'U2', turnedIn)]))).toBe(2);
  });

  it('the teacher’s preview (never a start) counts as to take', () => {
    expect(testsToDo(testSets([lab(41, 'U3', false, true)], []))).toBe(1);
  });

  it('nothing to take with no sets', () => {
    expect(testsToDo([])).toBe(0);
  });
});

describe('examSetNames', () => {
  it('lists every set once whatever the case, in the spelling met first, in natural order', () => {
    // A lab's U2 and a speaking test's u2 are one set, spelled as the lab spells it.
    expect(examSetNames(['U10', 'U2', 'U2'], ['u2', 'U3'])).toEqual(['U2', 'U3', 'U10']);
    expect(examSetNames(['u2'], ['U2'])).toEqual(['u2']);
  });

  it('skips practice items and lists not loaded yet', () => {
    expect(examSetNames([null, 'U3', undefined, ''], undefined)).toEqual(['U3']);
    expect(examSetNames(undefined, undefined)).toEqual([]);
    expect(examSetNames()).toEqual([]);
  });
});
