/**
 * One shared subscription to the API's live event stream (`GET /api/_events`,
 * Server-Sent Events, authenticated by the session cookie).
 *
 * Hooks register interest in event *types* (the first argument the backend
 * passes to `publish(type, data)`, e.g. `deployment`, `incident`, `monitor`).
 * The EventSource is opened on the first subscriber and closed after the last
 * one leaves, so pages that don't need live data don't hold a connection.
 *
 * The stream is a hint to refetch, never a source of data: rows always come
 * from the REST endpoints, so a dropped stream degrades to "refresh on visit".
 */

export interface ServerEvent {
  type: string;
  at?: string;
  data: Record<string, unknown>;
}

type Listener = (e: ServerEvent) => void;

const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
const attached = new Set<string>();
let failures = 0;

function dispatch(type: string, raw: MessageEvent<string>) {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw.data) as { data?: Record<string, unknown>; at?: string };
    data = parsed.data ?? {};
  } catch {
    /* a malformed frame still means "something changed" */
  }
  listeners.get(type)?.forEach((fn) => fn({ type, data }));
}

function attach(type: string) {
  if (!source || attached.has(type)) return;
  attached.add(type);
  source.addEventListener(type, (e) => dispatch(type, e as MessageEvent<string>));
}

function open() {
  if (source || typeof EventSource === 'undefined') return;
  // Give up after repeated failures (e.g. signed out): the browser would
  // otherwise retry forever. Pages still load over REST.
  if (failures >= 3) return;
  source = new EventSource('/api/_events', { withCredentials: true });
  attached.clear();
  source.addEventListener('hello', () => {
    failures = 0;
  });
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      failures += 1;
      source = null;
      if (listeners.size) setTimeout(open, 5_000 * failures);
    }
  };
  listeners.forEach((_, type) => attach(type));
}

function closeIfIdle() {
  if (listeners.size || !source) return;
  source.close();
  source = null;
  attached.clear();
}

/** Subscribe to one or more event types. Returns the unsubscribe function. */
export function onServerEvents(types: readonly string[], fn: Listener): () => void {
  types.forEach((t) => {
    let set = listeners.get(t);
    if (!set) {
      set = new Set();
      listeners.set(t, set);
    }
    set.add(fn);
  });
  open();
  types.forEach(attach);
  return () => {
    types.forEach((t) => {
      const set = listeners.get(t);
      set?.delete(fn);
      if (set && !set.size) listeners.delete(t);
    });
    // Defer so a re-render that unsubscribes and resubscribes keeps the connection.
    setTimeout(closeIfIdle, 0);
  };
}
