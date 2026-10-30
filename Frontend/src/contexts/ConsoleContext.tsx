import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { performRequest } from '../utils/consoleClient';
import type {
  ConnectionMode,
  ConsoleResponse,
  ConsoleSession,
  HistoryEntry,
  HttpMethod,
  RequestDraft,
} from '../types/console';

interface CallOptions {
  record?: boolean;
  headers?: Record<string, string>;
  token?: string | null;
}

interface ConsoleValue {
  mode: ConnectionMode;
  setMode: (m: ConnectionMode) => void;
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  origin: string;
  session: ConsoleSession | null;
  signIn: (s: ConsoleSession) => void;
  signOut: () => Promise<void>;
  call: (
    method: HttpMethod,
    url: string,
    body?: string,
    opts?: CallOptions,
  ) => Promise<ConsoleResponse>;
  history: HistoryEntry[];
  clearHistory: () => void;
  draft: RequestDraft;
  setDraft: (d: RequestDraft) => void;
  lastResponse: ConsoleResponse | null;
  setLastResponse: (r: ConsoleResponse | null) => void;
}

const ConsoleContext = createContext<ConsoleValue | null>(null);
const K = (k: string) => `devhq.console.${k}`;

function load<T>(key: string, fallback: T, store: Storage = localStorage): T {
  try {
    const raw = store.getItem(K(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown, store: Storage = localStorage) {
  try {
    if (value === null) store.removeItem(K(key));
    else store.setItem(K(key), JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const defaultDraft: RequestDraft = {
  method: 'GET',
  path: '/api/tasks',
  params: [
    { key: 'status', value: 'in-progress', on: true },
    { key: 'limit', value: '20', on: true },
  ],
  headers: [],
  body: '',
};

/** Connection, operator session, request draft and history for the backend console. */
export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ConnectionMode>(() => load('mode', 'preview'));
  const [baseUrl, setBaseUrlState] = useState(() => load('baseUrl', 'http://localhost:8080'));
  const [session, setSession] = useState<ConsoleSession | null>(() =>
    load('session', null, sessionStorage),
  );
  const [history, setHistory] = useState<HistoryEntry[]>(() => load('history', []));
  const [draft, setDraftState] = useState<RequestDraft>(() => load('draft', defaultDraft));
  const [lastResponse, setLastResponse] = useState<ConsoleResponse | null>(null);

  const setMode = useCallback((m: ConnectionMode) => {
    setModeState(m);
    save('mode', m);
    setSession(null);
    save('session', null, sessionStorage);
  }, []);
  const setBaseUrl = useCallback((u: string) => {
    setBaseUrlState(u);
    save('baseUrl', u);
  }, []);
  const setDraft = useCallback((d: RequestDraft) => {
    setDraftState(d);
    save('draft', d);
  }, []);

  const call = useCallback<ConsoleValue['call']>(
    async (method, url, body, opts = {}) => {
      const token = opts.token !== undefined ? opts.token : session?.token;
      const res = await performRequest({
        mode,
        baseUrl,
        token,
        method,
        url,
        body,
        headers: opts.headers,
      });
      if (opts.record) {
        setHistory((h) => {
          const next = [
            {
              id: crypto.randomUUID(),
              method,
              url,
              body: body ?? '',
              status: res.status,
              ms: Math.round(res.ms),
              at: res.at,
            },
            ...h,
          ].slice(0, 60);
          save('history', next);
          return next;
        });
      }
      if (res.status === 401 && session && opts.token === undefined) {
        const code = (res.body as { error?: { code?: string } } | null)?.error?.code;
        if (
          code === 'unauthenticated' ||
          code === 'session_revoked' ||
          code === 'session_expired'
        ) {
          setSession(null);
          save('session', null, sessionStorage);
        }
      }
      return res;
    },
    [mode, baseUrl, session],
  );

  const signIn = useCallback((s: ConsoleSession) => {
    setSession(s);
    save('session', s, sessionStorage);
  }, []);

  const signOut = useCallback(async () => {
    if (session)
      await performRequest({
        mode,
        baseUrl,
        token: session.token,
        method: 'POST',
        url: '/api/auth/sign-out',
      });
    setSession(null);
    save('session', null, sessionStorage);
  }, [mode, baseUrl, session]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    save('history', []);
  }, []);

  const origin = mode === 'preview' ? 'http://localhost:8080' : baseUrl;

  const value = useMemo<ConsoleValue>(
    () => ({
      mode,
      setMode,
      baseUrl,
      setBaseUrl,
      origin,
      session,
      signIn,
      signOut,
      call,
      history,
      clearHistory,
      draft,
      setDraft,
      lastResponse,
      setLastResponse,
    }),
    [
      mode,
      setMode,
      baseUrl,
      setBaseUrl,
      origin,
      session,
      signIn,
      signOut,
      call,
      history,
      clearHistory,
      draft,
      setDraft,
      lastResponse,
    ],
  );
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole() {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole must be used inside ConsoleProvider');
  return ctx;
}

/** Hook for views that load JSON from one endpoint, with reload. */
export function useConsoleData<T>(url: string | null, deps: unknown[] = []) {
  const { call } = useConsole();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    const r = await call('GET', url);
    setLoading(false);
    if (r.status >= 200 && r.status < 300) {
      setData(r.body as T);
      setError(null);
    } else
      setError(
        (r.body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, call, ...deps]);
  React.useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
