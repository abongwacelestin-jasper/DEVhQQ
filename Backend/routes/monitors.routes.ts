/**
 * Uptime monitors.
 *
 *   GET    /api/monitors                 Infrastructure:view (?product=)
 *   POST   /api/monitors                 Infrastructure:manage
 *   PATCH  /api/monitors/:id             Infrastructure:manage
 *   DELETE /api/monitors/:id             Infrastructure:manage
 *   GET    /api/monitors/:id/checks      Infrastructure:view (?limit=)
 *   POST   /api/monitors/:id/check       Infrastructure:manage — run a check now
 *
 * Targets are vetted by the SSRF guard on create/update (scheme, literal IP,
 * DNS → private/metadata ranges) and again on every check.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { randomToken } from '../security/crypto.ts';
import { HttpError, type Principal } from '../types.ts';
import { PRODUCTS, monitorHistory, monitors, paginate } from '../domain/engineering/store.ts';
import type { MonitorRow } from '../domain/engineering/types.ts';
import { ensureMonitorDemo } from '../domain/engineering/demo.ts';
import { BlockedTargetError, vetUrl } from '../monitors/ssrf.ts';
import { jobEnabled } from '../lib/jobs.ts';
import {
  MIN_INTERVAL_SEC,
  historyOf,
  jitteredDelayMs,
  monitorView,
  runCheck,
  startMonitorScheduler,
  uptimeOf,
} from '../monitors/scheduler.ts';

const statusList = v.array(v.int({ min: 100, max: 599 }), { max: 20 });
const createBody = v.object({
  product: v.enumOf(PRODUCTS),
  name: v.string({ min: 2, max: 80 }),
  url: v.string({ min: 8, max: 2048 }),
  kind: v.optional(v.enumOf(['HTTP', 'API'] as const)),
  method: v.optional(v.enumOf(['GET', 'HEAD'] as const)),
  intervalSec: v.optional(v.int({ min: MIN_INTERVAL_SEC, max: 86_400 })),
  failureThreshold: v.optional(v.int({ min: 1, max: 20 })),
  degradedMs: v.optional(v.int({ min: 50, max: 10_000 })),
  expectStatus: v.optional(statusList),
});
const patchBody = v.object({
  name: v.optional(v.string({ min: 2, max: 80 })),
  url: v.optional(v.string({ min: 8, max: 2048 })),
  method: v.optional(v.enumOf(['GET', 'HEAD'] as const)),
  intervalSec: v.optional(v.int({ min: MIN_INTERVAL_SEC, max: 86_400 })),
  failureThreshold: v.optional(v.int({ min: 1, max: 20 })),
  degradedMs: v.optional(v.int({ min: 50, max: 10_000 })),
  expectStatus: v.optional(statusList),
  paused: v.optional(v.boolean()),
});

/** SSRF vetting with a client-safe error. DNS failure is allowed (the host may come up later). */
async function vetTarget(raw: string): Promise<URL> {
  try {
    return (await vetUrl(raw)).url;
  } catch (e) {
    if (e instanceof BlockedTargetError)
      throw new HttpError(422, 'blocked_target', e.message, { reason: e.reason });
    try {
      return new URL(raw);
    } catch {
      throw new HttpError(422, 'validation_failed', 'url is not a valid URL');
    }
  }
}

function displayTarget(u: URL): string {
  return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
}

function visibleMonitor(p: Principal, id: string): MonitorRow {
  ensureMonitorDemo();
  const m = monitors.get(id);
  if (!m || !canSeeProduct(p, m.product)) throw new HttpError(404, 'not_found', 'Not found');
  return m;
}

export function registerMonitorRoutes(r: Router) {
  if (jobEnabled('monitors')) startMonitorScheduler();

  r.add(
    'GET',
    '/api/monitors',
    { summary: 'Uptime monitors in my products (?product=)', tag: 'monitors' },
    authenticate,
    requireArea('Infrastructure', 'view'),
    (ctx) => {
      ensureMonitorDemo();
      const product = ctx.query.get('product');
      const rows = [...monitors.values()]
        .filter(
          (m) => canSeeProduct(ctx.principal!, m.product) && (!product || m.product === product),
        )
        .sort((a, b) => a.product.localeCompare(b.product) || a.name.localeCompare(b.name))
        .map(monitorView);
      const live = rows.filter((m) => m.source !== 'demo').length;
      return {
        ...paginate(rows, ctx.query),
        source: live === rows.length ? 'live' : live === 0 ? 'demo' : 'mixed',
      };
    },
  );

  r.add(
    'POST',
    '/api/monitors',
    {
      summary: 'Create an HTTP monitor (SSRF-vetted target)',
      tag: 'monitors',
      responses: [401, 403, 404, 422],
    },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    async (ctx) => {
      const body = parse(createBody, ctx.body);
      assertProduct(ctx.principal!, body.product);
      const url = await vetTarget(body.url);
      const now = new Date().toISOString();
      const interval = body.intervalSec ?? 60;
      const m: MonitorRow = {
        id: `mon-${randomToken(6)}`,
        product: body.product,
        name: body.name,
        target: displayTarget(url),
        url: url.toString(),
        kind: body.kind ?? 'HTTP',
        method: body.method ?? 'GET',
        intervalSec: interval,
        failureThreshold: body.failureThreshold ?? 3,
        degradedMs: body.degradedMs ?? 1000,
        expectStatus: body.expectStatus ?? [],
        paused: false,
        status: 'pending',
        responseMs: 0,
        consecutiveFailures: 0,
        // First check lands within one interval, spread by jitter.
        nextCheckAt: Date.now() + Math.round(Math.random() * Math.min(interval, 60) * 1000),
        createdBy: ctx.principal!.memberId,
        createdAt: now,
        updatedAt: now,
        source: 'manual',
      };
      monitors.set(m.id, m);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'monitor.created',
        target: `${m.id} ${m.product} · ${m.target}`,
        requestId: ctx.requestId,
      });
      publish('monitor', { id: m.id, product: m.product, status: m.status, change: 'created' });
      ctx.status = 201;
      return monitorView(m);
    },
  );

  r.add(
    'PATCH',
    '/api/monitors/:id',
    { summary: 'Update or pause a monitor', tag: 'monitors', responses: [401, 403, 404, 409, 422] },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    async (ctx) => {
      const patch = parse(patchBody, ctx.body);
      const m = visibleMonitor(ctx.principal!, ctx.params.id);
      if (m.source === 'demo')
        throw new HttpError(409, 'demo_monitor', 'Demo monitors are read-only');
      const changes = Object.keys(patch).filter(
        (k) => patch[k as keyof typeof patch] !== undefined,
      );
      if (!changes.length) throw new HttpError(422, 'no_change', 'Nothing to update');
      if (patch.url !== undefined) {
        const url = await vetTarget(patch.url);
        m.url = url.toString();
        m.target = displayTarget(url);
      }
      if (patch.name !== undefined) m.name = patch.name;
      if (patch.method !== undefined) m.method = patch.method;
      if (patch.failureThreshold !== undefined) m.failureThreshold = patch.failureThreshold;
      if (patch.degradedMs !== undefined) m.degradedMs = patch.degradedMs;
      if (patch.expectStatus !== undefined) m.expectStatus = patch.expectStatus;
      if (patch.intervalSec !== undefined) {
        m.intervalSec = patch.intervalSec;
        m.nextCheckAt = Date.now() + jitteredDelayMs(m.intervalSec);
      }
      if (patch.paused !== undefined) {
        m.paused = patch.paused;
        m.status = patch.paused ? 'paused' : 'pending';
        if (!patch.paused) m.nextCheckAt = Date.now();
      }
      m.updatedAt = new Date().toISOString();
      monitors.save(m.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'monitor.updated',
        target: `${m.id}: ${changes.join(', ')}`,
        requestId: ctx.requestId,
      });
      publish('monitor', { id: m.id, product: m.product, status: m.status, change: 'updated' });
      return monitorView(m);
    },
  );

  r.add(
    'DELETE',
    '/api/monitors/:id',
    {
      summary: 'Delete a monitor and its history',
      tag: 'monitors',
      responses: [401, 403, 404, 409],
    },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    (ctx) => {
      const m = visibleMonitor(ctx.principal!, ctx.params.id);
      if (m.source === 'demo')
        throw new HttpError(409, 'demo_monitor', 'Demo monitors are read-only');
      monitors.delete(m.id);
      monitorHistory.delete(m.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'monitor.deleted',
        target: `${m.id} ${m.product} · ${m.target}`,
        requestId: ctx.requestId,
      });
      publish('monitor', { id: m.id, product: m.product, change: 'deleted' });
    },
  );

  r.add(
    'GET',
    '/api/monitors/:id/checks',
    {
      summary: 'Check history for a monitor (newest first, ?limit=)',
      tag: 'monitors',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Infrastructure', 'view'),
    (ctx) => {
      const m = visibleMonitor(ctx.principal!, ctx.params.id);
      const checks = historyOf(m.id);
      const rows = [...checks].reverse();
      return {
        monitorId: m.id,
        uptime: uptimeOf(checks),
        total: checks.length,
        ...paginate(rows, ctx.query, 100),
        source: m.source,
      };
    },
  );

  r.add(
    'POST',
    '/api/monitors/:id/check',
    { summary: 'Run a check now', tag: 'monitors', responses: [401, 403, 404, 409] },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    async (ctx) => {
      const m = visibleMonitor(ctx.principal!, ctx.params.id);
      if (m.source === 'demo')
        throw new HttpError(409, 'demo_monitor', 'Demo monitors are not probed');
      const check = await runCheck(m.id);
      if (!check) throw new HttpError(409, 'check_in_progress', 'A check is already running');
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'monitor.checked',
        target: `${m.id} → ${check.status}`,
        requestId: ctx.requestId,
      });
      return { check, monitor: monitorView(monitors.get(m.id) ?? m) };
    },
  );
}
