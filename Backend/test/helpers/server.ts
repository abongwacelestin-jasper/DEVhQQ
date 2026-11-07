/**
 * Test server factory and HTTP client.
 *
 *   const app = await startApp();           // buildApp() on an ephemeral port
 *   after(() => app.close());
 *   const res = await app.client().get('/api/health');
 *
 * `startRouter(router)` does the same for a hand-built Router (lib/http unit
 * tests). Every client has its own simulated source IP (X-Forwarded-For, with
 * TRUST_PROXY=1 from test/setup.ts) and User-Agent, so rate-limit buckets and
 * the session's IP/UA binding behave like separate devices.
 */

import '../setup.ts';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Router } from '../../lib/http.ts';

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or `undefined` for empty bodies. */
  json: T;
  text: string;
}

export interface RequestOptions {
  body?: unknown;
  /** Sent verbatim instead of JSON-encoding `body`. */
  rawBody?: string | Buffer;
  headers?: Record<string, string>;
  /** Override the client's token for one call (`null` sends none). */
  token?: string | null;
}

let ipCounter = 0;
/** A fresh loopback address per client (127.0.x.y) — geo resolves it to "Local", risk 0. */
export function nextIp(): string {
  ipCounter += 1;
  return `127.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export class Client {
  readonly base: string;
  ip: string;
  userAgent: string;
  token?: string;

  constructor(base: string, opts: { ip?: string; userAgent?: string; token?: string } = {}) {
    this.base = base;
    this.ip = opts.ip ?? nextIp();
    this.userAgent = opts.userAgent ?? 'devhq-test/1.0';
    this.token = opts.token;
  }

  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const token = opts.token === null ? undefined : (opts.token ?? this.token);
    const hasBody = opts.rawBody !== undefined || opts.body !== undefined;
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        'X-DevHQ-Client': 'console',
        'User-Agent': this.userAgent,
        'X-Forwarded-For': this.ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    let json: unknown = undefined;
    if (text && (res.headers.get('content-type') ?? '').includes('application/json'))
      json = JSON.parse(text);
    return { status: res.status, headers: res.headers, json: json as T, text };
  }

  get<T = Record<string, unknown>>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, opts);
  }
  post<T = Record<string, unknown>>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  patch<T = Record<string, unknown>>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T = Record<string, unknown>>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, opts);
  }
}

export interface TestServer {
  base: string;
  server: Server;
  /** A new anonymous client with its own IP and User-Agent. */
  client(opts?: { ip?: string; userAgent?: string; token?: string }): Client;
  close(): Promise<void>;
}

export async function startRouter(router: Router): Promise<TestServer> {
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    server,
    client: (opts) => new Client(base, opts),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Boots the real application (all routes, seeded demo data) on an ephemeral port. */
export async function startApp(): Promise<TestServer> {
  const { buildApp } = await import('../../server.ts');
  return startRouter(await buildApp());
}

/** Narrow helper for `{ error: { code } }` bodies. */
export function errorCode(res: ApiResponse<unknown>): string | undefined {
  const body = res.json as { error?: { code?: string } } | undefined;
  return body?.error?.code;
}
