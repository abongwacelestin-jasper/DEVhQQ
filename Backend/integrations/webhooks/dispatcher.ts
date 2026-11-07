/**
 * Outbound webhooks: signing, SSRF-safe delivery, retries and the delivery log.
 *
 * - Subscribes to the internal event bus and fans out the events integrations
 *   care about (deployment approved/failed, incident opened/resolved,
 *   monitor down/up) to every active subscription for that event + product.
 * - Every request is signed: `X-DevHQ-Signature: t=<unix>,v1=<hex>` where
 *   v1 = HMAC-SHA256(secret, `${t}.${body}`). Receivers should reject
 *   timestamps older than 5 minutes (see `verifyOutboundSignature`).
 * - Delivery goes through the monitor SSRF guard (DNS pinning, blocked ranges,
 *   10 s timeout, no redirects).
 * - Failures retry with exponential backoff (≈ 2 s, 8 s, 32 s, 2 min, 8 min +
 *   jitter); pending deliveries are persisted and picked up by a sweeper, so a
 *   restart doesn't lose them. The log keeps the last 200 per integration.
 */

import { createHmac } from 'node:crypto';
import { audit } from '../../audit/auditLog.ts';
import { subscribe, type BusEvent } from '../../lib/events.ts';
import { logger } from '../../lib/logger.ts';
import { randomToken, safeEqual } from '../../security/crypto.ts';
import { db } from '../../store/db.ts';
import type { ProductId } from '../../types.ts';
import { open } from '../../domain/engineering/secrets.ts';
import {
  integrations,
  outboundWebhooks,
  webhookDeliveries,
} from '../../domain/engineering/store.ts';
import type {
  IntegrationRow,
  OutboundEvent,
  OutboundWebhook,
  WebhookDeliveryRow,
} from '../../domain/engineering/types.ts';
import { config } from '../../config/env.ts';
import { guardedRequest } from '../../monitors/ssrf.ts';

export const OUTBOUND_EVENTS = [
  'deployment.approved',
  'deployment.failed',
  'incident.opened',
  'incident.resolved',
  'monitor.down',
  'monitor.up',
] as const satisfies readonly OutboundEvent[];

const MAX_ATTEMPTS = 5;
const LOG_PER_INTEGRATION = 200;
let backoffBaseMs = 2_000;

/** Test seam: shrink the backoff so retries can be exercised quickly. */
export function setBackoffBase(ms: number) {
  backoffBaseMs = ms;
}

export function backoffMs(attempt: number): number {
  const base = backoffBaseMs * 4 ** (attempt - 1);
  return Math.round(base + Math.random() * base * 0.2);
}

export function signPayload(
  secret: string,
  body: string,
  t = Math.floor(Date.now() / 1000),
): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Reference verifier for receivers (and tests): 5-minute tolerance, constant-time compare. */
export function verifyOutboundSignature(
  secret: string,
  body: string,
  header: string,
  toleranceSec = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=') as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec || !parts.v1)
    return false;
  return safeEqual(signPayload(secret, body, t), header);
}

export interface OutboundEnvelope {
  id: string;
  type: OutboundEvent | 'ping';
  at: string;
  product?: ProductId;
  data: Record<string, unknown>;
}

/** Destination URL + request body for a subscription, per integration kind. */
function render(
  integration: IntegrationRow,
  hook: OutboundWebhook,
  env: OutboundEnvelope,
): { url: string; body: string } {
  const credential = open(integration.credential);
  if (integration.kind === 'slack') {
    const d = env.data;
    const text = `*${env.type}*${env.product ? ` · ${env.product}` : ''} — ${String(d.title ?? d.name ?? d.version ?? d.id ?? '')}${d.status ? ` (${String(d.status)})` : ''}`;
    return { url: credential, body: JSON.stringify({ text }) };
  }
  if (integration.kind === 'pagerduty') {
    const resolve = env.type === 'incident.resolved' || env.type === 'monitor.up';
    return {
      url: 'https://events.pagerduty.com/v2/enqueue',
      body: JSON.stringify({
        routing_key: credential,
        event_action: resolve ? 'resolve' : 'trigger',
        dedup_key: `devhq-${String(env.data.incidentId ?? env.data.id ?? env.id)}`,
        payload: {
          summary:
            `${env.type}: ${String(env.data.title ?? env.data.name ?? env.data.id ?? '')}`.slice(
              0,
              1024,
            ),
          source: 'devhq',
          severity:
            env.type.startsWith('monitor') || env.data.severity === 'SEV1' ? 'critical' : 'error',
          custom_details: env.data,
        },
      }),
    };
  }
  return { url: hook.url ?? credential, body: JSON.stringify(env) };
}

/** Queues one delivery and attempts it immediately. */
export function enqueue(hook: OutboundWebhook, env: OutboundEnvelope): WebhookDeliveryRow {
  const now = new Date().toISOString();
  const row: WebhookDeliveryRow = {
    id: `dl-${randomToken(8)}`,
    integrationId: hook.integrationId,
    webhookId: hook.id,
    event: env.type,
    payload: JSON.stringify(env),
    state: 'pending',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: Date.now(),
    lastStatus: 0,
    durationMs: 0,
    createdAt: now,
    updatedAt: now,
  };
  webhookDeliveries.set(row.id, row);
  trimLog(hook.integrationId);
  void attempt(row.id);
  return row;
}

const attempting = new Set<string>();

/** Performs one attempt for a pending delivery and schedules the next on failure. */
export async function attempt(id: string): Promise<WebhookDeliveryRow | undefined> {
  const row = webhookDeliveries.get(id);
  if (!row || row.state !== 'pending' || attempting.has(id)) return row;
  const hook = outboundWebhooks.get(row.webhookId);
  const integration = integrations.get(row.integrationId);
  if (!hook || !integration) {
    row.state = 'failed';
    row.lastError = 'Subscription was removed';
    row.nextAttemptAt = undefined;
    webhookDeliveries.save(id);
    return row;
  }
  attempting.add(id);
  row.attempts += 1;
  const started = Date.now();
  try {
    const env = JSON.parse(row.payload) as OutboundEnvelope;
    const { url, body } = render(integration, hook, env);
    const res = await guardedRequest(url, {
      method: 'POST',
      body,
      followRedirects: false,
      allowHttp: !config.isProd,
      maxBodyBytes: 4 * 1024,
      headers: {
        'content-type': 'application/json',
        'x-devhq-event': env.type,
        'x-devhq-delivery': row.id,
        'x-devhq-signature': signPayload(open(hook.secret), body),
      },
    });
    row.lastStatus = res.status;
    row.durationMs = res.ms;
    if (res.status >= 200 && res.status < 300) {
      row.state = 'succeeded';
      row.lastError = undefined;
    } else row.lastError = `HTTP ${res.status}`;
  } catch (e) {
    row.lastStatus = 0;
    row.durationMs = Date.now() - started;
    row.lastError = String((e as Error).message ?? e).slice(0, 200);
  } finally {
    attempting.delete(id);
  }
  if (row.state === 'pending') {
    if (row.attempts >= row.maxAttempts) {
      row.state = 'failed';
      row.nextAttemptAt = undefined;
      audit.append({
        actor: 'system:webhooks',
        action: 'webhook.delivery_failed',
        target: `${integration.name} · ${row.event} · ${row.lastError ?? 'error'}`,
      });
    } else row.nextAttemptAt = Date.now() + backoffMs(row.attempts);
  } else row.nextAttemptAt = undefined;
  row.updatedAt = new Date().toISOString();
  webhookDeliveries.save(id);
  return row;
}

function trimLog(integrationId: string) {
  const rows = [...webhookDeliveries.values()]
    .filter((d) => d.integrationId === integrationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const d of rows.slice(0, Math.max(0, rows.length - LOG_PER_INTEGRATION)))
    if (d.state !== 'pending') webhookDeliveries.delete(d.id);
}

/** Fans an internal event out to matching subscriptions. */
export function dispatch(
  type: OutboundEvent,
  product: ProductId | undefined,
  data: Record<string, unknown>,
): number {
  const env: OutboundEnvelope = {
    id: `evt-${randomToken(8)}`,
    type,
    at: new Date().toISOString(),
    product,
    data,
  };
  let n = 0;
  for (const hook of outboundWebhooks.values()) {
    if (!hook.active || !hook.events.includes(type)) continue;
    const integration = integrations.get(hook.integrationId);
    if (!integration) continue;
    if (product && integration.products.length && !integration.products.includes(product)) continue;
    enqueue(hook, env);
    n++;
  }
  return n;
}

const lastIncidentStatus = new Map<string, string>();

/** Maps internal bus events onto outbound event names. Exported for tests. */
export function translate(
  e: BusEvent,
): { type: OutboundEvent; product?: ProductId; data: Record<string, unknown> } | null {
  const d = e.data;
  if (e.type === 'audit' && d.action === 'deploy.approved') {
    const dep = [...db.deployments.values()].find((x) => `${x.product} ${x.version}` === d.target);
    return {
      type: 'deployment.approved',
      product: dep?.product,
      data: dep ? { ...dep } : { target: d.target },
    };
  }
  if (e.type === 'deployment' && d.status === 'failed') {
    const dep = db.deployments.get(String(d.id));
    return { type: 'deployment.failed', product: dep?.product, data: dep ? { ...dep } : { ...d } };
  }
  if (e.type === 'incident' && typeof d.id === 'string') {
    const inc = db.incidents.get(d.id);
    const prev = lastIncidentStatus.get(d.id);
    const status = String(d.status ?? inc?.status ?? '');
    lastIncidentStatus.set(d.id, status);
    if (lastIncidentStatus.size > 5000)
      lastIncidentStatus.delete(lastIncidentStatus.keys().next().value as string);
    const data = inc
      ? {
          id: inc.id,
          title: inc.title,
          severity: inc.severity,
          status: inc.status,
          service: inc.service,
          owner: inc.owner,
        }
      : { ...d };
    if (status === 'investigating' && prev === undefined && (inc?.timeline.length ?? 1) <= 1)
      return { type: 'incident.opened', product: inc?.product, data };
    if (status === 'resolved' && prev !== 'resolved')
      return { type: 'incident.resolved', product: inc?.product, data };
    return null;
  }
  if (e.type === 'monitor' && (d.status === 'down' || d.status === 'up')) {
    return {
      type: d.status === 'down' ? 'monitor.down' : 'monitor.up',
      product: d.product as ProductId | undefined,
      data: { ...d },
    };
  }
  return null;
}

let unsubscribe: (() => void) | undefined;
let sweeper: ReturnType<typeof setInterval> | undefined;

export function startWebhookDispatcher() {
  if (unsubscribe) return;
  unsubscribe = subscribe((e) => {
    try {
      const t = translate(e);
      if (t) dispatch(t.type, t.product, t.data);
    } catch (err) {
      logger.error('webhook dispatch failed', { err: String(err) });
    }
  });
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const d of webhookDeliveries.values())
      if (d.state === 'pending' && (d.nextAttemptAt ?? 0) <= now) void attempt(d.id);
  }, 1_000);
  sweeper.unref();
}

export function stopWebhookDispatcher() {
  unsubscribe?.();
  unsubscribe = undefined;
  if (sweeper) clearInterval(sweeper);
  sweeper = undefined;
}
