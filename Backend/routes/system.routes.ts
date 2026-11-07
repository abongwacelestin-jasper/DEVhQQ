/**
 * System routes: probes, observability, API discovery, the safe query runner
 * and the backend console itself.
 *
 * Console access policy (current): any authenticated member. The role filter
 * is a one-line change per route — add `requireArea('Administration', 'view')`
 * after `authenticate` — and is deliberately left off until the console is
 * signed off. Data returned here is still product-scoped per caller.
 */

import { persistenceStatus } from '../store/collection.ts';
import { pingDatabase } from '../db/boot.ts';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Ctx, Router } from '../lib/http.ts';
import { STREAM } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { canSeeProduct } from '../auth/rbac.ts';
import { logger } from '../lib/logger.ts';
import { metrics } from '../lib/metrics.ts';
import { subscribe } from '../lib/events.ts';
import { runQuery, type Query } from '../lib/query.ts';
import { consoleCsp } from '../security/headers.ts';
import { canReceiveEvent } from '../security/eventPolicy.ts';
import { audit } from '../audit/auditLog.ts';
import { config, publicConfig } from '../config/env.ts';
import { db, publicMember } from '../store/db.ts';
import { HttpError, type Principal, type ProductId } from '../types.ts';

// Server-rendered console page, resolved relative to this file (Backend/routes → Backend/backend.html).
const CONSOLE_FILE = new URL('../backend.html', import.meta.url);

type Row = Record<string, unknown>;
interface Collection {
  fields: string[];
  rows: (p: Principal) => Row[];
}

const scoped = <T extends { product: ProductId }>(list: T[], p: Principal) =>
  list.filter((x) => canSeeProduct(p, x.product)) as unknown as Row[];

/** Allow-listed collections and fields for the query runner. Secrets are never listed. */
export const collections: Record<string, Collection> = {
  tasks: {
    fields: [
      'key',
      'title',
      'product',
      'projectId',
      'type',
      'status',
      'priority',
      'assignee',
      'reviewer',
      'due',
      'estimate',
      'updatedAt',
    ],
    rows: (p) => scoped([...db.tasks.values()], p),
  },
  projects: {
    fields: ['id', 'product', 'name', 'lead', 'status'],
    rows: (p) => scoped([...db.projects.values()], p),
  },
  docs: {
    fields: [
      'id',
      'projectId',
      'product',
      'title',
      'kind',
      'status',
      'visibility',
      'updatedBy',
      'updatedAt',
    ],
    rows: (p) =>
      scoped(
        [...db.docs.values()].filter(
          (d) =>
            d.visibility !== 'restricted' || d.editors.includes(p.memberId) || p.role === 'Owner',
        ),
        p,
      ),
  },
  deployments: {
    fields: [
      'id',
      'product',
      'env',
      'version',
      'sha',
      'status',
      'requestedBy',
      'approvedBy',
      'createdAt',
    ],
    rows: (p) => scoped([...db.deployments.values()], p),
  },
  incidents: {
    fields: ['id', 'product', 'title', 'severity', 'status', 'owner', 'startedAt', 'resolvedAt'],
    rows: (p) => scoped([...db.incidents.values()], p),
  },
  members: {
    fields: ['id', 'name', 'email', 'role', 'products', 'status', 'mfa', 'passkeys'],
    rows: (p) =>
      [...db.members.values()]
        .filter((m) => p.role === 'Owner' || m.products.some((x) => p.products.includes(x)))
        .map(publicMember) as unknown as Row[],
  },
  signIns: {
    fields: [
      'id',
      'memberId',
      'at',
      'ip',
      'method',
      'result',
      'city',
      'country',
      'countryCode',
      'network',
      'risk',
    ],
    rows: (p) =>
      db.signIns
        .filter((s) => p.role === 'Owner' || s.memberId === p.memberId)
        .map((s) => ({
          id: s.id,
          memberId: s.memberId,
          at: s.at,
          ip: s.ip,
          method: s.method,
          result: s.result,
          city: s.location.city,
          country: s.location.country,
          countryCode: s.location.countryCode,
          network: s.location.network,
          risk: s.risk.score,
        })),
  },
  audit: {
    fields: ['seq', 'at', 'actor', 'action', 'target', 'sensitive'],
    rows: () => audit.list({ limit: 2000 }) as unknown as Row[],
  },
};

const scalar = (val: unknown, path: string) => {
  if (val === null || ['string', 'number', 'boolean'].includes(typeof val)) return val;
  if (
    Array.isArray(val) &&
    val.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))
  )
    return val;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    for (const x of Object.values(val)) {
      const ok =
        x === null ||
        ['string', 'number', 'boolean'].includes(typeof x) ||
        (Array.isArray(x) && x.every((y) => ['string', 'number', 'boolean'].includes(typeof y)));
      if (!ok)
        throw new HttpError(
          422,
          'validation_failed',
          `${path} operators take scalars or arrays of scalars`,
        );
    }
    return val;
  }
  throw new HttpError(422, 'validation_failed', `${path} has an invalid condition`);
};

const queryBody = v.object({
  from: v.enumOf(Object.keys(collections)),
  where: v.optional((val, path) => {
    if (val === undefined) return undefined;
    if (!val || typeof val !== 'object' || Array.isArray(val))
      throw new HttpError(422, 'validation_failed', `${path} must be an object`);
    return Object.fromEntries(Object.entries(val).map(([k, c]) => [k, scalar(c, `${path}.${k}`)]));
  }),
  select: v.optional(v.array(v.string({ max: 40 }), { max: 20 })),
  orderBy: v.optional(
    v.object({ field: v.string({ max: 40 }), dir: v.optional(v.enumOf(['asc', 'desc'] as const)) }),
  ),
  limit: v.optional(v.int({ min: 1, max: 500 })),
  offset: v.optional(v.int({ min: 0, max: 100_000 })),
});

function openApi(r: Router) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of r.inventory()) {
    const p = route.path.replace(/:([a-zA-Z]+)/g, '{$1}');
    const params = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    paths[p] ??= {};
    paths[p][route.method.toLowerCase()] = {
      summary: route.summary,
      tags: [route.tag],
      parameters: params,
      security: route.auth === 'public' ? [] : [{ session: [] }, { bearer: [] }],
      responses: Object.fromEntries([
        ['200', { description: 'OK' }],
        ...route.responses.map((c) => [String(c), { description: statusText[c] ?? 'Error' }]),
      ]),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'DevHQ API',
      version: config.version,
      description: 'Zero-trust API for DevHQ. Generated from the live route table.',
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: '__Host-devhq_session' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
    paths,
  };
}

export const statusText: Record<number, string> = {
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

export function registerSystemRoutes(r: Router) {
  const bootedAt = Date.now();

  r.add('GET', '/api/health', { summary: 'Liveness probe', tag: 'system', auth: 'public' }, () => ({
    ok: true,
    uptimeSec: Math.round((Date.now() - bootedAt) / 1000),
  }));

  r.add(
    'GET',
    '/api/ready',
    {
      summary: 'Readiness probe — database reachable, write queue healthy, audit chain intact',
      tag: 'system',
      auth: 'public',
      responses: [503],
    },
    async (ctx) => {
      const chain = audit.verify();
      const persistence = persistenceStatus();
      const dbOk = await pingDatabase();
      // An empty production database is still "ready" (the deploy gate must pass before the
      // first Owner exists); `bootstrapRequired` tells operators no one can sign in yet.
      const ready = dbOk && chain.ok && !persistence.saturated;
      if (!ready) ctx.status = 503;
      return {
        ready,
        database: dbOk ? 'up' : 'down',
        persistence: {
          mode: persistence.mode,
          pending: persistence.pending,
          saturated: persistence.saturated,
        },
        members: db.members.size,
        bootstrapRequired: db.members.size === 0,
        auditChain: chain.ok ? 'intact' : 'broken',
      };
    },
  );

  r.add(
    'GET',
    '/api/version',
    { summary: 'Build and runtime version', tag: 'system', auth: 'public' },
    () => ({
      version: config.version,
      env: config.env,
      node: process.version,
      startedAt: new Date(bootedAt).toISOString(),
    }),
  );

  r.add(
    'GET',
    '/api/openapi.json',
    {
      summary: 'OpenAPI 3.1 document generated from the route table',
      tag: 'system',
      auth: 'public',
    },
    () => openApi(r),
  );

  r.add(
    'GET',
    '/api/_inventory',
    { summary: 'Every registered route — API discovery', tag: 'system' },
    authenticate,
    () => r.inventory(),
  );

  r.add(
    'GET',
    '/api/_status-codes',
    { summary: 'Status codes this API can return', tag: 'system', auth: 'public' },
    () => statusText,
  );

  r.add(
    'GET',
    '/api/_config',
    { summary: 'Effective configuration, secrets redacted', tag: 'system' },
    authenticate,
    () => publicConfig(),
  );

  r.add(
    'GET',
    '/api/_metrics',
    { summary: 'Request metrics (format=prometheus for text exposition)', tag: 'system' },
    authenticate,
    (ctx) => {
      if (ctx.query.get('format') === 'prometheus') {
        ctx.res.statusCode = 200;
        ctx.res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        ctx.res.end(metrics.prometheus());
        return STREAM;
      }
      return metrics.snapshot();
    },
  );

  r.add(
    'GET',
    '/api/_logs',
    { summary: 'Recent structured logs (level, q, limit)', tag: 'system' },
    authenticate,
    (ctx) => {
      const level = ctx.query.get('level') as 'debug' | 'info' | 'warn' | 'error' | null;
      const q = ctx.query.get('q')?.toLowerCase();
      return logger
        .recent({
          level: level ?? undefined,
          limit: Math.min(500, Number(ctx.query.get('limit') ?? 200)),
        })
        .filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q));
    },
  );

  r.add(
    'GET',
    '/api/_events',
    { summary: 'Live event stream (Server-Sent Events)', tag: 'system' },
    authenticate,
    (ctx) => {
      const res = ctx.res;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(
        `event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), member: ctx.principal!.memberId })}\n\n`,
      );
      // CYBER-001: filter per subscriber at delivery time (security/eventPolicy.ts),
      // and end the stream once the member is no longer active.
      const principal = ctx.principal!;
      const off = subscribe((e) => {
        if (db.members.get(principal.memberId)?.status !== 'active') {
          off();
          clearInterval(beat);
          res.end();
          return;
        }
        if (canReceiveEvent(principal, e))
          res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      const beat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
      ctx.req.on('close', () => {
        clearInterval(beat);
        off();
      });
      return STREAM;
    },
  );

  r.add(
    'GET',
    '/api/_query/collections',
    { summary: 'Queryable collections and their fields', tag: 'query' },
    authenticate,
    (ctx) =>
      Object.fromEntries(
        Object.entries(collections).map(([k, c]) => [
          k,
          { fields: c.fields, count: c.rows(ctx.principal!).length },
        ]),
      ),
  );

  r.add(
    'POST',
    '/api/_query',
    {
      summary: 'Run a safe JSON query against an allow-listed collection',
      tag: 'query',
      responses: [401, 422],
    },
    authenticate,
    (ctx) => {
      const q = parse(queryBody, ctx.body) as Query;
      const c = collections[q.from];
      const result = runQuery(q, c.rows(ctx.principal!), c.fields);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'console.query',
        target: `${q.from} · ${result.total} rows`,
        requestId: ctx.requestId,
      });
      return result;
    },
  );

  // ── Console ───────────────────────────────────────────────────
  const serveConsole = async (ctx: Ctx) => {
    let html: string;
    try {
      html = await readFile(CONSOLE_FILE, 'utf8');
    } catch {
      throw new HttpError(404, 'not_found', 'backend.html is missing from Backend/');
    }
    const nonce = randomBytes(16).toString('base64');
    const res = ctx.res;
    res.statusCode = 200;
    res.setHeader('Content-Security-Policy', consoleCsp(nonce));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html.replace(/<script>/g, `<script nonce="${nonce}">`));
    return STREAM;
  };
  r.add(
    'GET',
    '/console',
    { summary: 'Backend console (HTML)', tag: 'system', auth: 'public' },
    serveConsole,
  );
  r.add(
    'GET',
    '/backend.html',
    { summary: 'Backend console (HTML, alias)', tag: 'system', auth: 'public' },
    serveConsole,
  );
  // Self-hosted console typefaces (Inter, JetBrains Mono). The filename is
  // allow-listed, so no traversal is possible; the cache is immutable because
  // font files are content-addressed by release.
  const FONTS_DIR = new URL('../fonts/', import.meta.url);
  const serveFont = async (ctx: Ctx) => {
    const name = ctx.params.file ?? '';
    if (!/^[a-z0-9-]+\.woff2$/.test(name)) throw new HttpError(404, 'not_found', 'Font not found');
    let bytes: Buffer;
    try {
      bytes = await readFile(new URL(name, FONTS_DIR));
    } catch {
      throw new HttpError(404, 'not_found', 'Font not found');
    }
    const res = ctx.res;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'font/woff2');
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(bytes);
    return STREAM;
  };
  r.add(
    'GET',
    '/fonts/:file',
    { summary: 'Console webfonts (self-hosted)', tag: 'system', auth: 'public' },
    serveFont,
  );
  r.add(
    'GET',
    '/',
    { summary: 'Redirect to the console', tag: 'system', auth: 'public' },
    (ctx) => {
      ctx.res.statusCode = 302;
      ctx.res.setHeader('Location', '/console');
      ctx.res.end();
      return STREAM;
    },
  );
}
