import { useCallback, useEffect, useRef, useState } from 'react';
import { CodespacesError, type Codespace, type CodespacePhase } from '../types/codespaces';
import type { CodespacesTransport } from '../utils/codespacesApi';

const POLL_TRANSITION_MS = 1_500;
const POLL_IDLE_MS = 30_000;
const PROVISION_ESTIMATE_MS = 9_000;
const START_ESTIMATE_MS = 4_500;
const MAX_WAIT_MS = 5 * 60_000;

interface Options {
  transport: CodespacesTransport;
  repo: string;
  ref: string;
  /** Called for any non-auth failure; the page falls back to the local sandbox. */
  onFatal: (reason: string) => void;
}

/**
 * Codespace lifecycle state machine.
 *
 *   checking ─┬─ none ───────→ not-found → provisioning ─┐
 *             ├─ Shutdown ───→ starting ─────────────────┤
 *             └─ Available ──────────────────────────────┴→ available ⇄ sleeping
 *   any API error: 401 → auth-required · otherwise → failed (onFatal)
 */
export function useCodespace({ transport, repo, ref, onFatal }: Options) {
  const [phase, setPhase] = useState<CodespacePhase>('checking');
  const [codespace, setCodespace] = useState<Codespace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const run = useRef(0);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;

  const fail = useCallback((e: unknown) => {
    const err =
      e instanceof CodespacesError
        ? e
        : new CodespacesError(0, 'upstream', (e as Error)?.message ?? 'Unknown error');
    setError(err.message);
    if (err.code === 'auth') {
      setPhase('auth-required');
      return;
    }
    setPhase('failed');
    const why = {
      forbidden: 'Missing Codespaces permission or blocked by your organization',
      rate_limited: 'GitHub rate limit reached',
      not_found: 'Repository not found or not shared with the GitHub App',
      network: 'Network unreachable',
      timeout: 'GitHub did not respond in time',
      upstream: 'GitHub returned an error',
      auth: '',
    }[err.code];
    fatalRef.current(`${why} (${err.status || err.code})`);
  }, []);

  /** Poll until Available, animating progress against an estimate. */
  const waitUntilAvailable = useCallback(
    async (name: string, estimate: number, id: number) => {
      const started = Date.now();
      while (run.current === id) {
        const elapsed = Date.now() - started;
        setProgress(Math.min(95, Math.round((elapsed / estimate) * 90)));
        if (elapsed > MAX_WAIT_MS)
          throw new CodespacesError(0, 'timeout', 'Codespace took too long to start');
        await new Promise((r) => setTimeout(r, POLL_TRANSITION_MS));
        if (run.current !== id) return;
        const cs = await transport.get(name);
        setCodespace(cs);
        if (cs.state === 'Available') {
          setProgress(100);
          setPhase('available');
          return;
        }
        if (cs.state === 'Failed' || cs.state === 'Deleted' || cs.state === 'Unavailable')
          throw new CodespacesError(0, 'upstream', `Codespace is ${cs.state}`);
      }
    },
    [transport],
  );

  const boot = useCallback(async () => {
    const id = ++run.current;
    setPhase('checking');
    setError(null);
    setProgress(0);
    try {
      const list = await transport.list(repo);
      if (run.current !== id) return;
      // Prefer one that is already running, then the most recently used.
      const existing = [...list].sort(
        (a, b) =>
          Number(b.state === 'Available') - Number(a.state === 'Available') ||
          b.last_used_at.localeCompare(a.last_used_at),
      )[0];
      if (!existing) {
        setPhase('not-found');
        const cs = await transport.create(repo, ref);
        if (run.current !== id) return;
        setCodespace(cs);
        setPhase('provisioning');
        await waitUntilAvailable(cs.name, PROVISION_ESTIMATE_MS, id);
        return;
      }
      setCodespace(existing);
      if (existing.state === 'Available') {
        setPhase('available');
        return;
      }
      setPhase('starting');
      if (existing.state === 'Shutdown') setCodespace(await transport.start(existing.name));
      await waitUntilAvailable(existing.name, START_ESTIMATE_MS, id);
    } catch (e) {
      if (run.current === id) fail(e);
    }
  }, [transport, repo, ref, waitUntilAvailable, fail]);

  const wake = useCallback(async () => {
    if (!codespace) return boot();
    const id = ++run.current;
    setPhase('starting');
    setProgress(0);
    try {
      setCodespace(await transport.start(codespace.name));
      await waitUntilAvailable(codespace.name, START_ESTIMATE_MS, id);
    } catch (e) {
      if (run.current === id) fail(e);
    }
  }, [codespace, transport, waitUntilAvailable, fail, boot]);

  const stop = useCallback(async () => {
    if (!codespace) return;
    try {
      setCodespace(await transport.stop(codespace.name));
      setPhase('sleeping');
    } catch (e) {
      fail(e);
    }
  }, [codespace, transport, fail]);

  // Boot on mount and whenever the repo or transport changes.
  useEffect(() => {
    void boot();
    return () => {
      // `run` is a generation counter, not a DOM ref: bumping it on cleanup is what
      // invalidates in-flight requests for the previous repo/transport.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current++;
    };
  }, [boot]);

  // Idle watch: periodic status checks while available, plus one on tab focus.
  useEffect(() => {
    if (phase !== 'available' || !codespace) return;
    const check = async () => {
      try {
        const cs = await transport.get(codespace.name);
        setCodespace(cs);
        if (cs.state === 'Shutdown' || cs.state === 'ShuttingDown') setPhase('sleeping');
      } catch (e) {
        fail(e);
      }
    };
    const id = setInterval(check, POLL_IDLE_MS);
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [phase, codespace, transport, fail]);

  return { phase, codespace, error, progress, retry: boot, wake, stop, setPhase };
}
