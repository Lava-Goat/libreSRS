// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Starts the loaded extensions' timers (api.ts ExtensionTimer): index.ts calls
 * it once the server listens. Each timer runs every `everyMs`, never while its
 * previous run is still going; a run that throws is logged
 * ('extension.timer_failed') and the next one comes as planned. The intervals
 * are unref()'d, so they never keep a process alive, and nothing starts under
 * NODE_ENV=test (tests call a timer's run() themselves), unless the full-stack
 * e2e asks with LIBRESRS_E2E_TIMERS_EVERY_MS: then every timer runs that often
 * (tests/e2e-fullstack/startApi.ts), so a spec sees in seconds what a timer
 * does in production.
 */
import { logger } from '../logger.js';
import type { LoadedTimer } from './api.js';

export interface TimerOptions {
  env?: Record<string, string | undefined>;
  setIntervalFn?: (fn: () => void, ms: number) => { unref?: () => unknown };
  clearIntervalFn?: (handle: unknown) => void;
}

/** One run of a timer, logged and never rejected; skipped while the previous run is still going. */
export function timerRunner(timer: LoadedTimer): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await timer.run({ now: new Date() });
    } catch (err) {
      logger.error({ err, event: 'extension.timer_failed', extension: timer.extension, timer: timer.id }, 'Extension timer failed');
    } finally {
      running = false;
    }
  };
}

/** The full-stack e2e's interval for every timer under NODE_ENV=test (a whole number of ms, 100 or more), else null. */
export const E2E_TIMERS_ENV = 'LIBRESRS_E2E_TIMERS_EVERY_MS';
function e2eEveryMs(env: Record<string, string | undefined>): number | null {
  const raw = env[E2E_TIMERS_ENV]?.trim() ?? '';
  return /^\d+$/.test(raw) && Number(raw) >= 100 ? Number(raw) : null;
}

/** Starts every timer; returns a function that stops them. Starts nothing under NODE_ENV=test (but see E2E_TIMERS_ENV). */
export function startTimers(timers: readonly LoadedTimer[], options: TimerOptions = {}): () => void {
  const env = options.env ?? process.env;
  const e2e = env.NODE_ENV === 'test' ? e2eEveryMs(env) : null;
  if ((env.NODE_ENV === 'test' && e2e === null) || timers.length === 0) return () => undefined;
  const every = options.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = options.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
  const handles = timers.map((timer) => {
    const run = timerRunner(timer);
    const handle = every(() => { void run(); }, e2e ?? timer.everyMs);
    handle.unref?.();
    return handle;
  });
  logger.info({ event: 'extension.timers_started', timers: timers.map((t) => `${t.extension}:${t.id}`) }, 'Extension timers started');
  return () => { for (const handle of handles) clear(handle); };
}
