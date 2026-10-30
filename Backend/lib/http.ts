/**
 * Minimal, dependency-free HTTP routing on top of node:http.
 *
 * Why no framework? Fewer dependencies means a smaller supply-chain attack
 * surface, and a single central route table doubles as our API inventory:
 * every endpoint must be registered here, so there are no undocumented
 * "shadow" APIs (a key WAAP concern). The same table generates the OpenAPI
 * document served at /api/openapi.json and drives the backend console.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.ts';
import { HttpError, type Principal } from '../types.ts';
import { logger } from './logger.ts';
import { metrics } from './metrics.ts';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Returned by a handler that has taken over the response (SSE, file download). */
export const STREAM = Symbol('stream');

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  ip: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body (only for methods that carry one). Always validate before use. */
  body: unknown;
  /** Raw body bytes — needed for webhook signature verification. */
  rawBody?: Buffer;
  principal?: Principal;
  /** Raw session token, if one was presented. */
  token?: string;
  /** Status to use for a successful response (defaults to 200 / 204). */
  status?: number;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
export type Middleware = (ctx: Ctx, next: () => Promise<unknown>) => Promise<unknown>;

export type AuthMode = 'public' | 'session' | 'partial';

export interface RouteMeta {
  summary: string;
  tag?: string;
  auth?: AuthMode;
  /** Status codes this route can return besides 200/204. */
  responses?: number[];
}

export interface RouteInfo {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  auth: AuthMode;
  responses: number[];
}

interface Route extends RouteInfo {
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  middleware: Middleware[];
}

export class Router {
  private routes: Route[] = [];
  private global: Middleware[] = [];

  use(mw: Middleware) {
    this.global.push(mw);
  }

  add(
    method: Method,
    path: string,
    meta: string | RouteMeta,
    ...chain: [...Middleware[], Handler]
  ) {
    const handler = chain.pop() as Handler;
    const middleware = chain as Middleware[];
    const m: RouteMeta = typeof meta === 'string' ? { summary: meta } : meta;
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/\/:([a-zA-Z]+)/g, (_x, k: string) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '/?$',
    );
    const guarded = middleware.length > 0;
    this.routes.push({
      method,
      path,
      pattern,
      keys,
      handler,
      middleware,
      summary: m.summary,
      tag: m.tag ?? path.split('/')[2] ?? 'root',
      auth: m.auth ?? (guarded ? 'session' : 'public'),
      responses: m.responses ?? (guarded ? [401, 403, 429] : [429]),
    });
  }

  inventory(): RouteInfo[] {
    return this.routes.map(({ method, path, summary, tag, auth, responses }) => ({
      method,
      path,
      summary,
      tag,
      auth,
      responses,
    }));
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const started = process.hrtime.bigint();
    const requestId =
      (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const url = new URL(req.url ?? '/', 'http://internal');
    const ctx: Ctx = {
      req,
      res,
      requestId,
      ip: clientIp(req),
      params: {},
      query: url.searchParams,
      body: undefined,
    };
    let routeKey = 'unmatched';

    try {
      const route = this.routes.find(
        (r) =>
          (r.method === req.method || (req.method === 'HEAD' && r.method === 'GET')) &&
          r.pattern.test(url.pathname),
      );
      if (route) routeKey = `${route.method} ${route.path}`;
      else if (this.routes.some((r) => r.pattern.test(url.pathname)) && req.method !== 'OPTIONS') {
        res.setHeader(
          'Allow',
          this.routes
            .filter((r) => r.pattern.test(url.pathname))
            .map((r) => r.method)
            .join(', '),
        );
        throw new HttpError(405, 'method_not_allowed', 'Method not allowed on this route');
      }
      // Global middleware (headers, rate limiting, CORS) runs for 404s too.
      const chain = [...this.global, ...(route?.middleware ?? [])];
      const final = (): Promise<unknown> => {
        if (!route) throw new HttpError(404, 'not_found', 'Route not found');
        return Promise.resolve(route.handler(ctx));
      };
      if (route) {
        const m = url.pathname.match(route.pattern)!;
        route.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
        if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'HEAD') {
          const { json, raw } = await readBody(req);
          ctx.body = json;
          ctx.rawBody = raw;
        }
      }
      const run = (i: number): Promise<unknown> =>
        i < chain.length ? chain[i](ctx, () => run(i + 1)) : final();
      const result = await run(0);
      if (result === STREAM) return;
      if (!res.writableEnded)
        send(res, ctx.status ?? (result === undefined ? 204 : 200), result, req.method === 'HEAD');
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', 'Unexpected error');
      // Never leak stack traces or internal messages to clients.
      if (!(err instanceof HttpError))
        logger.error('unhandled', { requestId, err: String((err as Error)?.stack ?? err) });
      if (!res.writableEnded)
        send(res, e.status, {
          error: {
            code: e.code,
            message: e.message,
            requestId,
            ...(e.details ? { details: e.details } : {}),
          },
        });
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.record(routeKey, res.statusCode, ms);
      if (routeKey !== 'GET /api/_events') {
        logger.info('request', {
          requestId,
          method: req.method,
          path: url.pathname,
          status: res.statusCode,
          ms: Math.round(ms * 10) / 10,
          ip: ctx.ip,
          member: ctx.principal?.memberId,
        });
      }
    }
  }
}

export function send(res: ServerResponse, status: number, body: unknown, headOnly = false) {
  res.statusCode = status;
  if (status === 204) return res.end();
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(headOnly ? undefined : payload);
}

async function readBody(req: IncomingMessage): Promise<{ json: unknown; raw?: Buffer }> {
  const type = req.headers['content-type'] ?? '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.maxBodyBytes)
      throw new HttpError(413, 'payload_too_large', 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return { json: undefined };
  // Rejecting form/text bodies blocks classic CSRF via cross-site <form> posts.
  if (!type.startsWith('application/json'))
    throw new HttpError(415, 'unsupported_media_type', 'Expected application/json');
  const raw = Buffer.concat(chunks);
  try {
    return { json: JSON.parse(raw.toString('utf8')), raw };
  } catch {
    throw new HttpError(400, 'invalid_json', 'Malformed JSON');
  }
}

function clientIp(req: IncomingMessage): string {
  // Only trust X-Forwarded-For when running behind our own proxy/WAAP edge.
  const fwd =
    process.env.TRUST_PROXY === '1'
      ? String(req.headers['x-forwarded-for'] ?? '')
          .split(',')[0]
          .trim()
      : '';
  return (fwd || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}
