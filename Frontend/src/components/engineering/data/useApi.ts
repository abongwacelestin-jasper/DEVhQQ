import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { onServerEvents } from './events';
import type { DataSource, ListResponse } from './types';

/**
 * Loading primitives for F-ENG pages, following WorkContext's rules: the API
 * is the only source of rows, failures are surfaced (never replaced by seed
 * data), and writes resync with the server when they fail.
 *
 * `status` is what pages switch on:
 * - `loading`      first page in flight
 * - `ready`        rows (possibly an empty list — check `items.length`)
 * - `unconfigured` 503 `integration_unconfigured`: the integration's env vars are unset
 * - `unavailable`  the endpoint does not exist on this server (route 404) or the service is down
 * - `forbidden`    403 for this member
 * - `not-found`    404 for a single resource
 * - `error`        anything else; `error` carries the message and request id
 */
export type LoadStatus =
  'loading' | 'ready' | 'unconfigured' | 'unavailable' | 'forbidden' | 'not-found' | 'error';

export function statusOf(e: unknown, single = false): LoadStatus {
  if (!(e instanceof ApiError)) return 'error';
  if (e.code === 'integration_unconfigured') return 'unconfigured';
  if (e.status === 503 || e.status === 502 || e.status === 0) return 'unavailable';
  if (e.status === 403) return 'forbidden';
  if (e.status === 404) {
    // The router answers unknown paths with "Route not found": the backend lane
    // hasn't shipped this endpoint here. A 404 from a real handler is "no such row".
    if (/route not found/i.test(e.message)) return 'unavailable';
    return single ? 'not-found' : 'unavailable';
  }
  return 'error';
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Error message suitable for an inline alert, including the request id for support. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError)
    return e.requestId ? `${e.message} (request ${e.requestId})` : e.message;
  return e instanceof Error ? e.message : 'Unexpected error';
}

function withCursor(path: string, cursor: string | null) {
  if (!cursor) return path;
  return `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`;
}

/** Accepts both `{items,nextCursor}` and the legacy bare-array lists. */
function normalise<T>(body: ListResponse<T> | T[] | undefined): ListResponse<T> {
  if (!body) return { items: [] };
  if (Array.isArray(body)) return { items: body };
  return { items: body.items ?? [], nextCursor: body.nextCursor ?? null, source: body.source };
}

export interface ListState<T> {
  items: T[];
  status: LoadStatus;
  error: ApiError | Error | null;
  source?: DataSource;
  hasMore: boolean;
  loadingMore: boolean;
  /** True while a refetch (event- or user-triggered) runs over existing rows. */
  refreshing: boolean;
  loadMore: () => void;
  reload: () => Promise<void>;
  /** Optimistic local edit; the next reload replaces it with the server's truth. */
  mutate: (fn: (items: T[]) => T[]) => void;
}

interface ListOptions<T, B> {
  /**
   * Maps the server's body to `{items,nextCursor,source}` in the UI's shape.
   * Defaults to accepting `{items,…}` or a bare array as-is.
   */
  select?: (body: B) => ListResponse<T>;
  /** SSE event types that should trigger a refetch. */
  events?: readonly string[];
  /** Poll interval in ms while mounted (for data the server doesn't push). */
  pollMs?: number;
}

/**
 * A paginated list. `path === null` means "don't load" (e.g. not signed in, or
 * waiting on another value). Aborts in-flight requests on unmount or path change.
 */
export function useApiList<T, B = ListResponse<T> | T[]>(
  path: string | null,
  opts: ListOptions<T, B> = {},
): ListState<T> {
  const selectRef = useRef(opts.select);
  selectRef.current = opts.select;
  const read = useCallback(
    (body: B): ListResponse<T> =>
      selectRef.current
        ? selectRef.current(body)
        : normalise(body as unknown as ListResponse<T> | T[] | undefined),
    [],
  );
  const { session } = useAuth();
  const effective = session?.memberId ? path : null;
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [source, setSource] = useState<DataSource | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ctrl.current?.abort();
    };
  }, []);

  const fetchFirst = useCallback(
    async (background: boolean) => {
      if (!effective) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (background) setRefreshing(true);
      try {
        const body = read(await api<B>(effective, { signal: c.signal }));
        if (c.signal.aborted || !mounted.current) return;
        setItems(body.items);
        setCursor(body.nextCursor ?? null);
        setSource(body.source);
        setError(null);
        setStatus('ready');
      } catch (e) {
        if (isAbort(e) || c.signal.aborted || !mounted.current) return;
        // A failed background refresh keeps the rows on screen and says so.
        setError(e instanceof Error ? e : new Error(String(e)));
        if (!background) {
          setItems([]);
          setStatus(statusOf(e));
        }
      } finally {
        if (ctrl.current === c && mounted.current) setRefreshing(false);
      }
    },
    [effective, read],
  );

  useEffect(() => {
    if (!effective) {
      setItems([]);
      setStatus('loading');
      return;
    }
    setStatus('loading');
    setItems([]);
    setCursor(null);
    void fetchFirst(false);
  }, [effective, fetchFirst]);

  const eventKey = (opts.events ?? []).join(',');
  useEffect(() => {
    if (!effective || !eventKey) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onServerEvents(eventKey.split(','), () => {
      clearTimeout(t);
      t = setTimeout(() => void fetchFirst(true), 400);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [effective, eventKey, fetchFirst]);

  useEffect(() => {
    if (!effective || !opts.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchFirst(true);
    }, opts.pollMs);
    return () => clearInterval(id);
  }, [effective, opts.pollMs, fetchFirst]);

  const loadMore = useCallback(() => {
    if (!effective || !cursor || loadingMore) return;
    setLoadingMore(true);
    const c = new AbortController();
    ctrl.current = c;
    api<B>(withCursor(effective, cursor), { signal: c.signal })
      .then((raw) => {
        if (c.signal.aborted || !mounted.current) return;
        const body = read(raw);
        setItems((l) => [...l, ...body.items]);
        setCursor(body.nextCursor ?? null);
      })
      .catch((e) => {
        if (isAbort(e) || !mounted.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (mounted.current) setLoadingMore(false);
      });
  }, [effective, cursor, loadingMore, read]);

  const reload = useCallback(() => fetchFirst(true), [fetchFirst]);
  const mutate = useCallback((fn: (items: T[]) => T[]) => setItems(fn), []);

  return {
    items,
    status,
    error,
    source,
    hasMore: !!cursor,
    loadingMore,
    refreshing,
    loadMore,
    reload,
    mutate,
  };
}

export interface ResourceState<T> {
  data: T | null;
  status: LoadStatus;
  error: ApiError | Error | null;
  reload: () => Promise<void>;
  /** Replace the local copy with a server response (e.g. after a POST). */
  set: (next: T) => void;
}

/** One resource. 404 from a real handler becomes `not-found`. */
export function useApiResource<T, B = T>(
  path: string | null,
  opts: { events?: readonly string[]; select?: (body: B) => T } = {},
): ResourceState<T> {
  const selectRef = useRef(opts.select);
  selectRef.current = opts.select;
  const { session } = useAuth();
  const effective = session?.memberId ? path : null;
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const fetchOne = useCallback(
    async (background: boolean) => {
      if (!effective) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      try {
        const raw = await api<B>(effective, { signal: c.signal });
        const body = selectRef.current ? selectRef.current(raw) : (raw as unknown as T);
        if (c.signal.aborted) return;
        setData(body);
        setError(null);
        setStatus('ready');
      } catch (e) {
        if (isAbort(e) || c.signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        if (!background) {
          setData(null);
          setStatus(statusOf(e, true));
        }
      }
    },
    [effective],
  );

  useEffect(() => {
    if (!effective) return;
    setStatus('loading');
    setData(null);
    void fetchOne(false);
  }, [effective, fetchOne]);

  const eventKey = (opts.events ?? []).join(',');
  useEffect(() => {
    if (!effective || !eventKey) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onServerEvents(eventKey.split(','), () => {
      clearTimeout(t);
      t = setTimeout(() => void fetchOne(true), 400);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [effective, eventKey, fetchOne]);

  const reload = useCallback(() => fetchOne(true), [fetchOne]);
  const set = useCallback((next: T) => {
    setData(next);
    setStatus('ready');
  }, []);
  return { data, status, error, reload, set };
}

/** Builds `path?k=v` from the defined, non-empty entries. */
export function withQuery(path: string, query: Record<string, string | number | undefined | null>) {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}
