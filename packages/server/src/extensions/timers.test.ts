// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger.js';
import type { LoadedTimer } from './api.js';
import { startTimers, timerRunner } from './timers.js';

afterEach(() => vi.restoreAllMocks());

const timer = (run: LoadedTimer['run'], id = 'tick'): LoadedTimer => ({ extension: 'sample', id, everyMs: 5_000, run });

describe('extension timers', () => {
  it('start nothing under NODE_ENV=test, or with none', () => {
    const every = vi.fn();
    startTimers([timer(() => undefined)], { env: { NODE_ENV: 'test' }, setIntervalFn: every });
    startTimers([], { env: { NODE_ENV: 'production' }, setIntervalFn: every });
    expect(every).not.toHaveBeenCalled();
  });

  it('start under NODE_ENV=test only when the full-stack e2e asks, every timer at its interval', () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    const every = vi.fn(() => ({ unref: () => undefined }));
    for (const bad of ['', 'soon', '50', '-1', '1.5']) {
      startTimers([timer(() => undefined)], { env: { NODE_ENV: 'test', LIBRESRS_E2E_TIMERS_EVERY_MS: bad }, setIntervalFn: every });
    }
    expect(every).not.toHaveBeenCalled();
    startTimers([timer(() => undefined, 'a'), timer(() => undefined, 'b')], { env: { NODE_ENV: 'test', LIBRESRS_E2E_TIMERS_EVERY_MS: '1500' }, setIntervalFn: every });
    expect(every.mock.calls.map((c) => (c as unknown[])[1])).toEqual([1_500, 1_500]);
    // Outside tests the variable changes nothing.
    every.mockClear();
    startTimers([timer(() => undefined)], { env: { NODE_ENV: 'production', LIBRESRS_E2E_TIMERS_EVERY_MS: '1500' }, setIntervalFn: every });
    expect(every.mock.calls.map((c) => (c as unknown[])[1])).toEqual([5_000]);
  });

  it('run each timer every everyMs, unref()d, and stop on request', () => {
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never);
    const unref = vi.fn();
    const handles: unknown[] = [];
    const every = vi.fn((_fn: () => void, _ms: number) => { const h = { unref }; handles.push(h); return h; });
    const clear = vi.fn();
    const stop = startTimers([timer(() => undefined, 'a'), timer(() => undefined, 'b')], { env: { NODE_ENV: 'production' }, setIntervalFn: every, clearIntervalFn: clear });
    expect(every.mock.calls.map((c) => c[1])).toEqual([5_000, 5_000]);
    expect(unref).toHaveBeenCalledTimes(2);
    stop();
    expect(clear.mock.calls.map((c) => c[0])).toEqual(handles);
  });

  it('never overlap a timer\'s own runs, and log a failure without stopping the next run', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation((() => undefined) as never);
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const tick = timerRunner(timer(run));
    const first = tick();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    const failing = timerRunner(timer(() => { throw new Error('boom'); }, 'bad'));
    await failing();
    await failing();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toMatchObject({ event: 'extension.timer_failed', extension: 'sample', timer: 'bad' });
  });
});
