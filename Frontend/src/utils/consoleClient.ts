import { handleMock, mockLatency } from './consoleMockApi';
import type { ConnectionMode, ConsoleResponse } from '../types/console';

export interface PerformOptions {
  mode: ConnectionMode;
  baseUrl: string;
  token?: string | null;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const byteSize = (s: string) => new Blob([s]).size;

/** Sends a request to the live server or the in-browser preview server. Never throws. */
export async function performRequest(o: PerformOptions): Promise<ConsoleResponse> {
  const headers: Record<string, string> = { 'X-Return-Token': '1', ...(o.headers ?? {}) };
  if (o.token && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization'))
    headers.Authorization = `Bearer ${o.token}`;
  if (o.body) headers['Content-Type'] ??= 'application/json';

  return o.mode === 'preview' ? previewRequest(o, headers) : liveRequest(o, headers);
}

async function previewRequest(
  o: PerformOptions,
  headers: Record<string, string>,
): Promise<ConsoleResponse> {
  const ms = mockLatency();
  await sleep(ms);
  const u = new URL(o.url, 'http://preview.local');
  let body: Record<string, unknown> = {};
  let status: number;
  let payload: unknown;
  let extra: Record<string, string> = {};
  try {
    const parsed: unknown = o.body?.trim() ? JSON.parse(o.body) : {};
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Body must be a JSON object');
    body = parsed as Record<string, unknown>;
    const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    const r = handleMock(o.method, u.pathname, u.searchParams, body, auth, ms);
    status = r.status;
    payload = r.body;
    extra = r.headers ?? {};
  } catch (e) {
    status = 400;
    payload = {
      error: {
        code: 'bad_json',
        message: e instanceof Error ? e.message : 'Body must be valid JSON',
      },
    };
  }
  const text = payload === undefined ? '' : JSON.stringify(payload);
  const requestId = crypto.randomUUID();
  if (payload && typeof payload === 'object' && 'error' in payload)
    (payload as { error: Record<string, unknown> }).error.requestId = requestId;
  const finalText = payload === undefined ? '' : JSON.stringify(payload);
  return {
    status,
    ms,
    size: byteSize(finalText || text),
    at: Date.now(),
    body: payload ?? null,
    text: finalText,
    headers: [
      ['content-type', 'application/json; charset=utf-8'],
      ['x-request-id', requestId],
      ['cache-control', 'no-store'],
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['strict-transport-security', 'max-age=63072000; includeSubDomains; preload'],
      ['content-security-policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'"],
      ['ratelimit-remaining', String(110 + Math.floor(Math.random() * 10))],
      ...Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
    ],
  };
}

async function liveRequest(
  o: PerformOptions,
  headers: Record<string, string>,
): Promise<ConsoleResponse> {
  const t0 = performance.now();
  try {
    const res = await fetch(o.baseUrl.replace(/\/$/, '') + o.url, {
      method: o.method,
      headers,
      body: o.body || undefined,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      status: res.status,
      ms: performance.now() - t0,
      size: byteSize(text),
      at: Date.now(),
      headers: [...res.headers.entries()],
      body,
      text,
    };
  } catch {
    const msg = `Couldn’t reach ${o.baseUrl}. Start the backend with "cd backend && npm run dev" and allow this origin in CORS_ORIGINS.`;
    return {
      status: 0,
      ms: performance.now() - t0,
      size: 0,
      at: Date.now(),
      headers: [],
      body: { error: { code: 'network', message: msg } },
      text: '',
    };
  }
}

export function errorMessage(r: ConsoleResponse): string {
  const b = r.body as { error?: { message?: string } } | null;
  return b?.error?.message ?? (r.status ? `HTTP ${r.status}` : 'Network error');
}

export function statusTone(status: number): 'ok' | 'info' | 'warn' | 'bad' | 'muted' {
  if (!status) return 'bad';
  if (status < 300) return 'ok';
  if (status < 400) return 'info';
  if (status < 500) return 'warn';
  return 'bad';
}

export const statusText: Record<number, string> = {
  0: 'Network error',
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};
