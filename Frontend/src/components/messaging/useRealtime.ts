import { useEffect, useRef, useState } from 'react';
import type { RealtimeStatus } from './types';

/**
 * Server-Sent Events for messaging.
 *
 * - Uses B-COLLAB's authenticated, per-subscriber-filtered `GET /api/stream`
 *   (frames `event: <type>` + `data: {type, at, data}`). The global
 *   `/api/_events` bus is deliberately NOT used: it broadcasts to every session.
 *   The stream's existence is probed first so a server without it degrades to polling.
 * - Reconnects with capped exponential backoff + jitter, and asks the caller to
 *   resync after every reconnect so events missed while offline are fetched.
 * - When no stream is reachable (e.g. a bearer-only session, which EventSource
 *   cannot authenticate), it degrades to polling via `onResync`.
 *
 * Events are delivered as `{type, data}`; dedupe happens in the store by id.
 */

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

const CANDIDATES = ['/api/stream'];
const TOPICS = [
  'message.created',
  'message.updated',
  'message.deleted',
  'message.reaction',
  'message.pinned',
  'channel.created',
  'channel.updated',
  'channel.deleted',
  'channel.removed',
];
const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

async function detect(signal: AbortSignal): Promise<string | null> {
  for (const url of CANDIDATES) {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: { accept: 'text/event-stream' },
        signal,
      });
      // We only needed the status line; drop the body so the probe doesn't hold a connection.
      void res.body?.cancel().catch(() => undefined);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('text/event-stream'))
        return url;
      if (res.status === 404) continue;
      // 401/403: the stream exists but this session can't open it with cookies.
      return null;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return null;
    }
  }
  return null;
}

function parse(type: string, raw: string): StreamEvent | null {
  try {
    const body = JSON.parse(raw) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    const rec = body as Record<string, unknown>;
    // Frames wrap payloads as {type, at, data}; tolerate a bare payload too.
    const t = typeof rec.type === 'string' ? rec.type : type;
    const data =
      typeof rec.data === 'object' && rec.data !== null
        ? (rec.data as Record<string, unknown>)
        : rec;
    return { type: t, data };
  } catch {
    return null;
  }
}

export function useRealtime(
  enabled: boolean,
  onEvent: (e: StreamEvent) => void,
  onResync: () => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('off');
  const handlers = useRef({ onEvent, onResync });
  handlers.current = { onEvent, onResync };

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    const ctrl = new AbortController();
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;
    let url: string | null = null;
    let disposed = false;

    const startPolling = () => {
      setStatus('polling');
      if (poll) return;
      poll = setInterval(() => handlers.current.onResync(), POLL_MS);
    };

    const open = () => {
      if (disposed || !url) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const source = new EventSource(url, { withCredentials: true });
      es = source;
      const deliver = (type: string) => (ev: MessageEvent<string>) => {
        const parsed = parse(type, ev.data);
        if (parsed && (parsed.type.startsWith('message.') || parsed.type.startsWith('channel.')))
          handlers.current.onEvent(parsed);
      };
      TOPICS.forEach((t) => source.addEventListener(t, deliver(t) as EventListener));
      source.onmessage = deliver('message');
      // The server ends the stream when the session is no longer valid: stop, don't hammer it.
      source.addEventListener('end', () => {
        source.close();
        if (es === source) es = null;
        startPolling();
      });
      source.onopen = () => {
        const reconnected = attempt > 0;
        attempt = 0;
        setStatus('live');
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        if (reconnected) handlers.current.onResync();
      };
      source.onerror = () => {
        source.close();
        if (es === source) es = null;
        if (disposed) return;
        attempt += 1;
        // Keep the conversation fresh while the stream is down.
        if (attempt >= 3) startPolling();
        else setStatus('reconnecting');
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
        timer = setTimeout(open, delay / 2 + Math.random() * (delay / 2));
      };
    };

    setStatus('connecting');
    detect(ctrl.signal)
      .then((found) => {
        if (disposed) return;
        url = found;
        if (url) open();
        else startPolling();
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      ctrl.abort();
      es?.close();
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
  }, [enabled]);

  return status;
}
