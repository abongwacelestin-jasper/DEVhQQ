/**
 * Uptime monitor engine: scheduling, SSRF-safe checks, bounded history,
 * uptime math and automatic incidents.
 *
 * - Every monitor runs on its own interval (≥ 30 s) with ±10 % jitter so
 *   checks never stampede on a restart. Demo monitors are never probed.
 * - A check is `down` on a network error / unexpected status, `degraded` when
 *   it succeeds slower than `degradedMs`, otherwise `up`.
 * - After `failureThreshold` consecutive `down` checks an incident is opened
 *   in `db.incidents` with the exact shape used by routes/operations.routes.ts
 *   (owner = the product's Operations member). On recovery a timeline note is
 *   added; if no human has touched the incident yet it is auto-resolved.
 */

import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { logger } from '../lib/logger.ts';
import { runExclusive } from '../lib/scheduler.ts';
import { db } from '../store/db.ts';
import type { Incident } from '../types.ts';
import {
  monitorHistory,
  monitors,
  nextIncidentId,
  operationsOwner,
} from '../domain/engineering/store.ts';
import type { MonitorCheck, MonitorRow, UptimeTick } from '../domain/engineering/types.ts';
import { BlockedTargetError, guardedRequest } from './ssrf.ts';

export const MIN_INTERVAL_SEC = 30;
export const HISTORY_LIMIT = 500;
const TICK_MS = 5_000;
const MAX_CONCURRENT = 8;
const SYSTEM_ACTOR = 'system:monitor';

const inFlight = new Set<string>();

export function jitteredDelayMs(intervalSec: number): number {
  const base = Math.max(MIN_INTERVAL_SEC, intervalSec) * 1000;
  return Math.round(base + (Math.random() * 2 - 1) * base * 0.1);
}

export function historyOf(id: string): MonitorCheck[] {
  return monitorHistory.get(id)?.checks ?? [];
}

/** Uptime % over the stored history (degraded counts as up), 2 decimals. */
export function uptimeOf(checks: MonitorCheck[]): number {
  if (!checks.length) return 100;
  const ok = checks.filter((c) => c.status !== 'down').length;
  return Math.round((ok / checks.length) * 10_000) / 100;
}

/** Public monitor view in the frontend `Monitor` shape (+ operational fields). */
export function monitorView(m: MonitorRow) {
  const checks = historyOf(m.id);
  const last30 = checks.slice(-30);
  const ticks: UptimeTick[] = [
    ...Array<UptimeTick>(Math.max(0, 30 - last30.length)).fill('up'),
    ...last30.map((c) => c.status),
  ];
  return {
    id: m.id,
    product: m.product,
    name: m.name,
    target: m.target,
    url: m.url,
    kind: m.kind,
    method: m.method,
    status: m.status,
    responseMs: m.responseMs,
    uptime: uptimeOf(checks),
    ticks,
    latency: checks.slice(-10).map((c) => c.responseMs),
    intervalSec: m.intervalSec,
    failureThreshold: m.failureThreshold,
    degradedMs: m.degradedMs,
    expectStatus: m.expectStatus,
    paused: m.paused,
    consecutiveFailures: m.consecutiveFailures,
    lastCheckedAt: m.lastCheckedAt,
    lastError: m.lastError,
    nextCheckAt: m.paused || m.source === 'demo' ? null : new Date(m.nextCheckAt).toISOString(),
    openIncidentId: m.openIncidentId,
    checksStored: checks.length,
    createdBy: m.createdBy,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    source: m.source,
  };
}

function statusOk(m: MonitorRow, status: number): boolean {
  return m.expectStatus.length ? m.expectStatus.includes(status) : status >= 200 && status < 400;
}

/** Runs one SSRF-guarded check for a monitor and applies its consequences. */
export async function runCheck(id: string): Promise<MonitorCheck | null> {
  const m = monitors.get(id);
  if (!m || m.source === 'demo' || inFlight.has(id)) return null;
  inFlight.add(id);
  let check: MonitorCheck;
  try {
    const res = await guardedRequest(m.url, { method: m.method, maxBodyBytes: 16 * 1024 });
    const ok = statusOk(m, res.status);
    check = {
      at: new Date().toISOString(),
      status: !ok ? 'down' : res.ms > m.degradedMs ? 'degraded' : 'up',
      httpStatus: res.status,
      responseMs: res.ms,
      ip: res.ip,
      ...(ok ? {} : { error: `Unexpected HTTP ${res.status}` }),
    };
  } catch (e) {
    const err = e as Error;
    check = {
      at: new Date().toISOString(),
      status: 'down',
      responseMs: 0,
      error:
        err instanceof BlockedTargetError
          ? err.message
          : err.message === 'timeout'
            ? 'Timed out after 10 s'
            : `Request failed: ${err.message}`.slice(0, 200),
    };
  } finally {
    inFlight.delete(id);
  }
  // The monitor may have been deleted while the check was in flight.
  if (!monitors.has(id)) return check;
  applyCheck(m, check);
  return check;
}

/** Records a check, updates the monitor and opens/resolves incidents. Exported for tests. */
export function applyCheck(m: MonitorRow, check: MonitorCheck) {
  const hist = monitorHistory.get(m.id) ?? { monitorId: m.id, checks: [] };
  hist.checks.push(check);
  if (hist.checks.length > HISTORY_LIMIT) hist.checks.splice(0, hist.checks.length - HISTORY_LIMIT);
  monitorHistory.set(m.id, hist);

  const prev = m.status;
  m.status = m.paused ? 'paused' : check.status;
  m.responseMs = check.responseMs;
  m.lastCheckedAt = check.at;
  m.lastError = check.error;
  m.consecutiveFailures = check.status === 'down' ? m.consecutiveFailures + 1 : 0;
  m.nextCheckAt = Date.now() + jitteredDelayMs(m.intervalSec);
  m.updatedAt = check.at;

  if (check.status === 'down' && prev !== 'down')
    publish('monitor', {
      id: m.id,
      product: m.product,
      name: m.name,
      status: 'down',
      error: check.error,
    });
  if (check.status !== 'down' && prev === 'down')
    publish('monitor', { id: m.id, product: m.product, name: m.name, status: 'up' });

  if (check.status === 'down' && m.consecutiveFailures >= m.failureThreshold && !openIncidentFor(m))
    openIncident(m, check);
  if (check.status !== 'down' && m.openIncidentId) recoverIncident(m);
  monitors.save(m.id);
}

function openIncidentFor(m: MonitorRow): Incident | undefined {
  const i = m.openIncidentId ? db.incidents.get(m.openIncidentId) : undefined;
  return i && i.status !== 'resolved' ? i : undefined;
}

function openIncident(m: MonitorRow, check: MonitorCheck) {
  const at = new Date().toISOString();
  const i: Incident = {
    id: nextIncidentId(),
    product: m.product,
    title: `${m.name} is down`,
    severity: 'SEV2',
    status: 'investigating',
    owner: operationsOwner(m.product),
    service: m.target.split('/')[0] || `${m.product}-app`,
    impact: `Automated check failing: ${check.error ?? 'no response'}`.slice(0, 1000),
    startedAt: at,
    timeline: [
      {
        at,
        by: SYSTEM_ACTOR,
        note: `Opened automatically after ${m.consecutiveFailures} consecutive failed checks of ${m.target}`,
      },
    ],
  };
  db.incidents.set(i.id, i);
  m.openIncidentId = i.id;
  audit.append({
    actor: SYSTEM_ACTOR,
    action: 'incident.auto_opened',
    target: `${i.id} ${i.severity} · ${i.title} (monitor ${m.id})`,
  });
  publish('incident', {
    id: i.id,
    severity: i.severity,
    status: i.status,
    product: i.product,
    monitorId: m.id,
    auto: true,
  });
  logger.warn('monitor incident opened', { monitor: m.id, incident: i.id });
}

function recoverIncident(m: MonitorRow) {
  const i = m.openIncidentId ? db.incidents.get(m.openIncidentId) : undefined;
  m.openIncidentId = undefined;
  if (!i || i.status === 'resolved') return;
  const at = new Date().toISOString();
  const untouched = i.timeline.every((t) => t.by === SYSTEM_ACTOR);
  if (untouched) {
    i.status = 'resolved';
    i.resolvedAt = at;
    i.timeline.push({ at, by: SYSTEM_ACTOR, note: `Auto-resolved: ${m.name} is passing again` });
  } else {
    i.timeline.push({
      at,
      by: SYSTEM_ACTOR,
      note: `${m.name} is passing again — confirm and resolve when ready`,
    });
  }
  db.incidents.set(i.id, i);
  audit.append({
    actor: SYSTEM_ACTOR,
    action: untouched ? 'incident.auto_resolved' : 'incident.recovery_noted',
    target: `${i.id} (monitor ${m.id})`,
  });
  publish('incident', {
    id: i.id,
    status: i.status,
    product: i.product,
    monitorId: m.id,
    auto: true,
  });
}

let timer: ReturnType<typeof setInterval> | undefined;

/**
 * One check per monitor per interval across every process that runs the
 * `monitors` job (lib/scheduler.ts lease; Redis-backed with REDIS_URL). A
 * loser pushes its local `nextCheckAt` out by one interval; when the lock
 * store is down the check is skipped and retried on a later tick.
 */
export function leaseMs(m: MonitorRow): number {
  return Math.round(Math.max(MIN_INTERVAL_SEC, m.intervalSec) * 1000 * 0.8);
}

async function checkOnce(m: MonitorRow) {
  try {
    const r = await runExclusive(`monitor:${m.id}`, leaseMs(m), () => runCheck(m.id));
    if (r === 'held') m.nextCheckAt = Date.now() + jitteredDelayMs(m.intervalSec);
  } catch (e) {
    logger.error('monitor check crashed', { monitor: m.id, err: String(e) });
  }
}

/** Starts the scheduler loop (idempotent). The interval is unref'd so it never holds the process open. */
export function startMonitorScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    const due = [...monitors.values()]
      .filter(
        (m) => !m.paused && m.source !== 'demo' && m.nextCheckAt <= now && !inFlight.has(m.id),
      )
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, Math.max(0, MAX_CONCURRENT - inFlight.size));
    for (const m of due) void checkOnce(m);
  }, TICK_MS);
  timer.unref();
}

export function stopMonitorScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
