// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  automaticCredit,
  countingRow,
  decideCredit,
  effectiveCredit,
  neededForRow,
  parseHeldFor,
  rowStatus,
  studentLabStatus,
  type CreditFields,
} from './labCredit.js';

describe('decideCredit', () => {
  it('lets a session opened before the pause rule count, whatever it shows', () => {
    expect(decideCredit({ rule: 'legacy', pct: 75, answered: 0, needed: 76, mic: 'off' })).toBe(true);
  });

  it('lets every lab count while the rule is off (0%), with or without a microphone', () => {
    expect(decideCredit({ rule: 'scored', pct: 0, answered: 0, needed: 0, mic: 'on' })).toBe(true);
    expect(decideCredit({ rule: 'scored', pct: 0, answered: 0, needed: 0, mic: 'off' })).toBe(true);
    expect(decideCredit({ rule: 'unscored', pct: 0, answered: 0, needed: 0, mic: 'off' })).toBe(true);
  });

  it('counts a scored lab from the needed number of pauses on, whatever the microphone', () => {
    expect(decideCredit({ rule: 'scored', pct: 75, answered: 76, needed: 76, mic: 'on' })).toBe(true);
    expect(decideCredit({ rule: 'scored', pct: 75, answered: 75, needed: 76, mic: 'on' })).toBe(false);
    // Pauses answered before the microphone was lost still count.
    expect(decideCredit({ rule: 'scored', pct: 75, answered: 80, needed: 76, mic: 'off' })).toBe(true);
    expect(decideCredit({ rule: 'scored', pct: 75, answered: 10, needed: 76, mic: 'off' })).toBe(false);
  });

  it('counts an unscored lab only with a microphone', () => {
    expect(decideCredit({ rule: 'unscored', pct: 75, answered: 0, needed: 0, mic: 'on' })).toBe(true);
    expect(decideCredit({ rule: 'unscored', pct: 75, answered: 0, needed: 0, mic: 'off' })).toBe(false);
  });
});

const row = (fields: Partial<CreditFields> & { id?: number; submittedAt?: Date } = {}) => ({
  id: 1,
  submittedAt: new Date('2026-10-01T15:00:00Z'),
  credit: false,
  creditOverride: null,
  mic: 'on' as const,
  checkRequestedAt: null,
  flags: '[]',
  heldFor: null,
  ...fields,
});

describe('row status', () => {
  it('is done when it counts, automatically or by the teacher', () => {
    expect(rowStatus(row({ credit: true }))).toEqual({ status: 'done', reason: null });
    expect(rowStatus(row({ credit: false, creditOverride: true }))).toEqual({ status: 'done', reason: null });
    expect(effectiveCredit(row({ credit: false, creditOverride: true }))).toBe(true);
  });

  it('is a redo the teacher asked for when the teacher said no, even over automatic credit', () => {
    expect(rowStatus(row({ credit: true, creditOverride: false }))).toEqual({ status: 'redo', reason: 'teacher' });
    expect(rowStatus(row({ mic: 'off', creditOverride: false }))).toEqual({ status: 'redo', reason: 'teacher' });
    expect(effectiveCredit(row({ credit: true, creditOverride: false }))).toBe(false);
  });

  it('waits for the teacher without a microphone, or when the student asked', () => {
    expect(rowStatus(row({ mic: 'off' }))).toEqual({ status: 'check', reason: 'no-mic' });
    expect(rowStatus(row({ checkRequestedAt: new Date() }))).toEqual({ status: 'check', reason: 'asked' });
  });

  it('is otherwise an automatic redo', () => {
    expect(rowStatus(row())).toEqual({ status: 'redo', reason: null });
  });

  it('waits for the teacher when held, before no microphone and before asked: credit, the teacher’s no, held, no mic, asked', () => {
    const held = '["odd-answers"]';
    expect(rowStatus(row({ heldFor: held }))).toEqual({ status: 'check', reason: 'held' });
    // A no-mic session with results added by a script says why it waits.
    expect(rowStatus(row({ heldFor: held, mic: 'off' }))).toEqual({ status: 'check', reason: 'held' });
    expect(rowStatus(row({ heldFor: ['overlap'], checkRequestedAt: new Date() }))).toEqual({ status: 'check', reason: 'held' });
    // The teacher decides over a hold, either way; undoing goes back to it.
    expect(rowStatus(row({ heldFor: held, creditOverride: true }))).toEqual({ status: 'done', reason: null });
    expect(rowStatus(row({ heldFor: held, creditOverride: false }))).toEqual({ status: 'redo', reason: 'teacher' });
    expect(rowStatus(row({ heldFor: held, creditOverride: null }))).toEqual({ status: 'check', reason: 'held' });
    expect(effectiveCredit(row({ heldFor: held }))).toBe(false);
    // Automatic credit is never stored with a hold, but it would win.
    expect(rowStatus(row({ heldFor: held, credit: true }))).toEqual({ status: 'done', reason: null });
  });

  it('counts a row written by code older than v1.15 (no flags stored), whatever its credit column holds', () => {
    // A lab turned in under v1.14 during a rollback: credit is the column's default, 0.
    const rolledBack = row({ credit: false, flags: null });
    expect(automaticCredit(rolledBack)).toBe(true);
    expect(rowStatus(rolledBack)).toEqual({ status: 'done', reason: null });
    expect(rowStatus({ ...rolledBack, creditOverride: false })).toEqual({ status: 'redo', reason: 'teacher' });
    // v1.15 always stores its flags, none included.
    expect(automaticCredit(row({ credit: false, flags: '[]' }))).toBe(false);
    expect(automaticCredit(row({ credit: true, flags: '["late"]' }))).toBe(true);
  });
});

describe('a student on a lab', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 15));

  it('is to do with no attempts', () => {
    expect(studentLabStatus([])).toEqual({ status: 'todo', reason: null });
    expect(countingRow([])).toBeNull();
  });

  it('is done once any attempt counts, even if a later one did not', () => {
    const rows = [row({ id: 1, credit: true, submittedAt: day(1) }), row({ id: 2, submittedAt: day(2) })];
    expect(studentLabStatus(rows).status).toBe('done');
    expect(countingRow(rows)?.id).toBe(1);
  });

  it('otherwise has the latest attempt’s status', () => {
    const rows = [row({ id: 1, mic: 'off', submittedAt: day(1) }), row({ id: 2, submittedAt: day(3) }), row({ id: 3, checkRequestedAt: day(2), submittedAt: day(2) })];
    expect(studentLabStatus(rows)).toEqual({ status: 'redo', reason: null });
    expect(countingRow(rows)?.id).toBe(2);
  });

  it('stays done while another attempt counts: credit is taken away from the student by taking it from every credited attempt', () => {
    // At 0% both attempts counted. Taking credit away from the latest leaves the first counting.
    const first = row({ id: 1, credit: true, submittedAt: day(20) });
    const second = row({ id: 2, credit: true, submittedAt: day(22) });
    expect(studentLabStatus([first, { ...second, creditOverride: false }])).toEqual({ status: 'done', reason: null });
    expect(countingRow([first, { ...second, creditOverride: false }])?.id).toBe(1);
    // From both (what the review page sends): a redo the teacher asked for.
    const both = [{ ...first, creditOverride: false }, { ...second, creditOverride: false }];
    expect(studentLabStatus(both)).toEqual({ status: 'redo', reason: 'teacher' });
    expect(countingRow(both)?.id).toBe(2);
  });

  it('takes the latest credited attempt as the counting row, by time then id', () => {
    const rows = [
      row({ id: 4, credit: true, submittedAt: day(1) }),
      row({ id: 7, credit: true, submittedAt: day(2) }),
      row({ id: 5, creditOverride: true, submittedAt: day(2) }),
      row({ id: 9, submittedAt: day(5) }),
    ];
    expect(countingRow(rows)?.id).toBe(7);
  });
});

describe('parseHeldFor', () => {
  it('reads the stored list: null when not held, known reasons only, in their order', () => {
    expect(parseHeldFor(null)).toBeNull();
    expect(parseHeldFor(undefined)).toBeNull();
    expect(parseHeldFor('["overlap","odd-answers"]')).toEqual(['odd-answers', 'overlap']);
    expect(parseHeldFor(['noisy', 'something-new'])).toEqual(['noisy']);
    expect(parseHeldFor('not json')).toEqual([]);
    expect(parseHeldFor('{"a":1}')).toEqual([]);
  });
});

describe('neededForRow', () => {
  it('is the snapshot’s needed count, or null for a row that was not scored', () => {
    expect(neededForRow({ pausesCounted: 101, minAnsweredPct: 75 })).toBe(76);
    expect(neededForRow({ pausesCounted: 101, minAnsweredPct: 0 })).toBe(0);
    expect(neededForRow({ pausesCounted: null, minAnsweredPct: 75 })).toBeNull();
  });
});
