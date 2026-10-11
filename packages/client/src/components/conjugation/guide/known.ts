// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The sections a student already knows are there: every section that was open
 * the last time they opened the guide, in any deck. A section open now and not
 * known is new. Kept in this browser only (a per-viewer convenience): cleared
 * storage just means nothing is marked new again until the guide is opened.
 */
import { useCallback, useState } from 'react';

const keyFor = (userId: number) => `libresrs.conjugationGuide.known.${userId}`;

function read(userId: number | undefined): Set<string> {
  if (userId === undefined) return new Set();
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(userId: number, known: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify([...known]));
  } catch {
    // Private mode or full storage: new parts are just not remembered.
  }
}

/** The known sections, and a way to add the ones open now. */
export function useKnownSections(userId: number | undefined): { known: ReadonlySet<string>; remember: (ids: readonly string[]) => void } {
  const [known, setKnown] = useState<ReadonlySet<string>>(() => read(userId));
  const [forUser, setForUser] = useState(userId);
  // Another account in the same browser: its own list.
  if (forUser !== userId) {
    setForUser(userId);
    setKnown(read(userId));
  }
  const remember = useCallback((ids: readonly string[]) => {
    if (userId === undefined) return;
    setKnown((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set([...read(userId), ...prev, ...ids]);
      write(userId, next);
      return next;
    });
  }, [userId]);
  return { known, remember };
}
