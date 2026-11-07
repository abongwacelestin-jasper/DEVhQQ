import { useCallback, useEffect, useState } from 'react';
import type { ApiGrant } from '../../api/types';
import { isLive, myGrants, onGrantsChanged } from './jit';

/** How often time-left labels tick and the list is re-read (approvals happen elsewhere). */
const TICK_MS = 15_000;
const POLL_MS = 30_000;

/**
 * The signed-in member's own grants (`GET /api/access/grants/mine`), with a
 * ticking clock so "time left" counts down and an elapsed grant drops to
 * expired on screen exactly when the server stops honouring it.
 */
export function useMyGrants(scope?: string) {
  const [grants, setGrants] = useState<ApiGrant[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setGrants(await myGrants());
    } catch {
      // Not fatal: the action itself is still guarded by the server.
      setGrants((g) => g ?? []);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void reload();
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const poll = setInterval(() => void reload(), POLL_MS);
    const off = onGrantsChanged(() => void reload());
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      off();
    };
  }, [reload]);

  const inScope = (grants ?? []).filter((g) => !scope || g.scope === scope);
  return {
    loading: grants === null,
    now,
    reload,
    active: inScope.filter((g) => isLive(g, now)),
    pending: inScope.filter((g) => g.status === 'pending'),
  };
}
