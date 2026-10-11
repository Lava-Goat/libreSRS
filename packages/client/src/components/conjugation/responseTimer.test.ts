// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { ResponseTimer } from './responseTimer';

describe('ResponseTimer', () => {
  it('counts whole milliseconds from its start', () => {
    const timer = new ResponseTimer(1000);
    expect(timer.elapsed(1000)).toBe(0);
    expect(timer.elapsed(4250.4)).toBe(3250);
  });

  it('leaves out every stretch the page was hidden', () => {
    const timer = new ResponseTimer(0);
    timer.visibility(true, 2000);
    timer.visibility(false, 62_000);
    timer.visibility(true, 63_000);
    timer.visibility(false, 70_000);
    expect(timer.elapsed(71_000)).toBe(4000);
  });

  it('does not count a hidden stretch still going on', () => {
    const timer = new ResponseTimer(0);
    timer.visibility(true, 1000);
    expect(timer.elapsed(50_000)).toBe(1000);
  });

  it('starts paused when the page is hidden as the question shows', () => {
    const timer = new ResponseTimer(500, true);
    timer.visibility(false, 10_500);
    expect(timer.elapsed(12_500)).toBe(2000);
  });

  it('ignores repeated events of the same kind', () => {
    const timer = new ResponseTimer(0);
    timer.visibility(false, 100);
    timer.visibility(true, 1000);
    timer.visibility(true, 5000);
    timer.visibility(false, 6000);
    expect(timer.elapsed(7000)).toBe(2000);
  });

  it('never gives a negative time, whatever the clock does', () => {
    expect(new ResponseTimer(5000).elapsed(4000)).toBe(0);
  });
});
