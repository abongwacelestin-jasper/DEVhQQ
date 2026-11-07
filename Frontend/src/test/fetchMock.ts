/**
 * Programmable `fetch` stand-in for API tests.
 *
 *   const f = mockFetch();
 *   f.reply(200, { ok: true });                         // next call
 *   f.reply(401, apiError('session_expired'));          // following call
 *   f.fail(new TypeError('Failed to fetch'));           // network error
 *   await api('/api/tasks');
 *   expect(f.calls[0].url).toBe('/api/tasks');
 *
 * Responses are consumed in order; a call with nothing queued throws loudly
 * instead of hanging. `route()` answers by method + path for tests that do not
 * care about order (phase 2: hooks that fire several requests).
 */
import { vi } from 'vitest';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit | undefined;
}

type Responder = () => Promise<Response>;

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The server's error envelope: `{ error: { code, message, requestId, details? } }`. */
export function apiError(code: string, message = code, details?: unknown, requestId = 'req-test') {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } };
}

export function mockFetch() {
  const queue: Responder[] = [];
  const routes = new Map<string, Responder>();
  const calls: RecordedCall[] = [];

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const raw = init?.body;
    calls.push({
      url,
      method,
      headers,
      body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw,
      init,
    });
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const routed = routes.get(`${method} ${path}`);
    if (routed) return routed();
    const next = queue.shift();
    if (!next) throw new Error(`mockFetch: unexpected ${method} ${url} (nothing queued)`);
    return next();
  });
  vi.stubGlobal('fetch', fn);

  const mock = {
    fn,
    calls,
    reply(status: number, body?: unknown, headers?: Record<string, string>) {
      queue.push(async () => jsonResponse(status, body, headers));
      return mock;
    },
    /** Replies with a raw (non-JSON) text body. */
    replyText(status: number, text: string) {
      queue.push(async () => new Response(text, { status, headers: { 'content-type': 'text/plain' } }));
      return mock;
    },
    fail(error: unknown) {
      queue.push(async () => {
        throw error;
      });
      return mock;
    },
    route(method: string, path: string, status: number, body?: unknown) {
      routes.set(`${method.toUpperCase()} ${path}`, async () => jsonResponse(status, body));
      return mock;
    },
    get pending() {
      return queue.length;
    },
  };
  return mock;
}
