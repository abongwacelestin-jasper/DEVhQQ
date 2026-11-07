import { useCallback, useEffect, useState } from 'react';

const KEY = 'devhq.starred-docs';
const EVENT = 'devhq:starred-docs';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Per-browser starred docs, kept in sync across every component that uses it.
 * A personal convenience (like a bookmark), deliberately not server state.
 */
export function useStarredDocs() {
  const [starred, setStarred] = useState<string[]>(read);

  useEffect(() => {
    const sync = () => setStarred(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = useCallback((id: string) => {
    const cur = read();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked (private mode) — stars are a per-browser convenience only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { starred, toggle, isStarred: (id: string) => starred.includes(id) };
}
