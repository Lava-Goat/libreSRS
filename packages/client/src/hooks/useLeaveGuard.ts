// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useCallback, useEffect, useRef } from 'react';

type GuardState = { libresrsLeaveGuard?: boolean } | null;
const isGuardEntry = () => (window.history.state as GuardState)?.libresrsLeaveGuard === true;

/**
 * Asks before the browser's Back (a Chromebook key, a phone swipe) leaves a
 * page holding unsaved work, and warns before a reload or close.
 *
 * Back is caught by standing one extra history entry — same URL, same router
 * state — in front of the page while `active`. A capture-phase popstate
 * listener runs before the router's and asks first. When the work is done the
 * entry is taken off again, so a later Back never lands on a stale page (and
 * never reopens it). The page's own exit buttons go through `leave`, which
 * steps back over the entry before navigating — and stands it again when the
 * way out fails (a refused sign-out), since the page is still here.
 */
export function useLeaveGuard(active: boolean, message: string) {
  const messageRef = useRef(message);
  messageRef.current = message;
  /** Set while we are stepping back ourselves, so our own popstate is not questioned. */
  const exitingRef = useRef(false);
  const poppingRef = useRef<Promise<void> | null>(null);
  /** Stands the guard entry again; null while the guard is off. */
  const standRef = useRef<(() => void) | null>(null);

  const popGuard = useCallback((): Promise<void> => {
    if (!isGuardEntry()) return Promise.resolve();
    return new Promise((resolve) => {
      const after = () => { window.removeEventListener('popstate', after); resolve(); };
      window.addEventListener('popstate', after);
      window.history.back();
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    exitingRef.current = false;
    const stand = () => window.history.pushState(
      { ...(window.history.state as object | null), libresrsLeaveGuard: true }, '', window.location.href);
    if (!isGuardEntry()) stand();
    standRef.current = stand;

    const onPopState = (e: PopStateEvent) => {
      if (exitingRef.current) return;
      e.stopImmediatePropagation();
      if (window.confirm(messageRef.current)) {
        exitingRef.current = true;
        window.history.back();
      } else {
        stand();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('popstate', onPopState, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      standRef.current = null;
      window.removeEventListener('popstate', onPopState, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // The work is over but we are still here: take our entry off again.
      if (!exitingRef.current && isGuardEntry()) {
        poppingRef.current = popGuard().finally(() => { poppingRef.current = null; });
      }
    };
  }, [active, popGuard]);

  /**
   * Leaves through the page's own button: step back over the guard entry, then
   * navigate. If `go` rejects the page did not leave, so the guard stands again.
   */
  const leave = useCallback((go: () => void | Promise<unknown>) => {
    exitingRef.current = true;
    void (poppingRef.current ?? popGuard()).then(go).catch(() => {
      const stand = standRef.current;
      if (!stand) return;
      exitingRef.current = false;
      if (!isGuardEntry()) stand();
    });
  }, [popGuard]);

  return { leave };
}
