import { api } from '../../api/client';
import type { AssistantAnswer } from '../../data/assistant';

/**
 * Asks the ML assistant through the backend bridge.
 *
 * 1. `POST /api/assistant/ask/stream` (optional SSE variant) — used only when it
 *    answers `200 text/event-stream`. Events:
 *      event: delta  data: {"text": "…"}            (appended to the answer)
 *      event: done   data: AssistantAnswer          (final answer + sources + model)
 *      event: error  data: {"error":{"code","message"}}
 * 2. Otherwise `POST /api/assistant/ask` → AssistantAnswer, through the shared
 *    API client (so 401/step-up handling and typed `ApiError`s apply).
 *
 * The streaming probe uses plain `fetch` with the session cookie. Any non-2xx
 * from it falls through to step 2, which surfaces the real error; a 404 also
 * disables streaming for the rest of the page's life.
 */

export interface AskScope {
  products?: string[];
  range?: string;
}

let streamSupported = true;

class StreamError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StreamError';
    this.code = code;
  }
}

function parseEvent(block: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

function isAnswer(x: unknown): x is AssistantAnswer {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as AssistantAnswer).answer === 'string' &&
    Array.isArray((x as AssistantAnswer).sources)
  );
}

async function tryStream(
  question: string,
  scope: AskScope | undefined,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<AssistantAnswer | null> {
  if (!streamSupported) return null;
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/api/assistant/ask/stream`, {
      method: 'POST',
      // Cookie-only session (F-SEC): same-origin credentials, no client/token headers.
      credentials: 'same-origin',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question, scope }),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    return null; // network trouble: let the non-streaming call report it
  }
  if (res.status === 404 || res.status === 405) streamSupported = false;
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !res.body || !type.includes('text/event-stream')) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const ev = parseEvent(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (!ev) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (ev.event === 'error') {
        const err = (payload as { error?: { code?: string; message?: string } }).error;
        throw new StreamError(
          err?.code ?? 'stream_error',
          err?.message ?? 'The answer stream failed.',
        );
      }
      if (ev.event === 'done' && isAnswer(payload)) return payload;
      const delta =
        (payload as { text?: unknown; delta?: unknown }).text ??
        (payload as { delta?: unknown }).delta;
      if (typeof delta === 'string') {
        text += delta;
        onDelta(text);
      }
    }
  }
  // Stream ended without a `done` event: keep what arrived, without sources.
  if (text) return { answer: text, sources: [], model: 'unknown' };
  return null;
}

export async function askAssistant(
  question: string,
  scope: AskScope | undefined,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<AssistantAnswer> {
  const streamed = await tryStream(question, scope, signal, onDelta);
  if (streamed) return streamed;
  return api<AssistantAnswer>('/api/assistant/ask', {
    method: 'POST',
    body: { question, scope },
    signal,
  });
}

export function isStreamError(e: unknown): e is StreamError {
  return e instanceof StreamError;
}
