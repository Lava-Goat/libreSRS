// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * How long a question took to answer, measured here in the browser and sent
 * with the answer (research report improvement 8). The server's own clock
 * cannot do it: the next prompt is built inside the previous answer call, so
 * its time would include reading the verdict and pressing Next.
 *
 * Silent by design: nothing on screen counts time, since a visible clock adds
 * pressure and guessing. Time the page spends hidden (another tab, a closed
 * Chromebook lid) is left out, so the teacher's medians are time spent on the
 * question.
 */
import { useEffect, useMemo, useRef } from 'react';

/** Milliseconds from a start, less the stretches spent hidden. */
export class ResponseTimer {
  private hiddenSince: number | null;
  private hiddenMs = 0;

  constructor(private readonly startedAt: number, hidden = false) {
    this.hiddenSince = hidden ? startedAt : null;
  }

  /** The page was hidden or shown again at `at`. */
  visibility(hidden: boolean, at: number): void {
    if (hidden && this.hiddenSince === null) this.hiddenSince = at;
    else if (!hidden && this.hiddenSince !== null) {
      this.hiddenMs += Math.max(0, at - this.hiddenSince);
      this.hiddenSince = null;
    }
  }

  /** Whole milliseconds of visible time up to `at` (never negative). */
  elapsed(at: number): number {
    const hiddenNow = this.hiddenSince !== null ? Math.max(0, at - this.hiddenSince) : 0;
    return Math.max(0, Math.round(at - this.startedAt - this.hiddenMs - hiddenNow));
  }
}

const now = () => performance.now();
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * A timer that starts when the component showing a question mounts (it is on
 * screen and takes answers). `elapsed()` is undefined before that, so an
 * answer is never sent with a made-up time.
 */
export function useResponseTimer(): { elapsed: () => number | undefined } {
  const timer = useRef<ResponseTimer | null>(null);
  useEffect(() => {
    // StrictMode mounts twice: the second start replaces the first, a moment later.
    const current = new ResponseTimer(now(), isHidden());
    timer.current = current;
    const onVisibility = () => current.visibility(isHidden(), now());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return useMemo(() => ({ elapsed: () => timer.current?.elapsed(now()) }), []);
}
