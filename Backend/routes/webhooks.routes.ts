/**
 * Outbound webhook subscriptions and the delivery log, per integration.
 *
 *   GET    /api/integrations/:id/webhooks                         Administration:view
 *   POST   /api/integrations/:id/webhooks                         Administration:manage + step-up
 *   DELETE /api/integrations/:id/webhooks/:webhookId              Administration:manage
 *   DELETE /api/integrations/:id/webhooks?webhookId=              (same, contract form)
 *   POST   /api/integrations/:id/webhooks/:webhookId/test         Administration:manage — signed ping
 *
 * Starts the dispatcher that turns internal events into signed deliveries.
 */

import type { Router, Ctx } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireArea, requireStepUp } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { randomToken } from '../security/crypto.ts';
import { HttpError } from '../types.ts';
import { ago, outboundWebhooks, paginate, webhookDeliveries } from '../domain/engineering/store.ts';
import type { OutboundWebhook, WebhookDeliveryRow } from '../domain/engineering/types.ts';
import { hint, seal } from '../domain/engineering/secrets.ts';
import {
  OUTBOUND_EVENTS,
  enqueue,
  startWebhookDispatcher,
} from '../integrations/webhooks/dispatcher.ts';
import { newSigningSecret, vetDestination, visibleIntegration } from './integrations.routes.ts';

const createBody = v.object({
  url: v.optional(v.string({ min: 10, max: 2048 })),
  events: v.array(v.enumOf(OUTBOUND_EVENTS), { max: OUTBOUND_EVENTS.length }),
});

function hookView(h: OutboundWebhook) {
  return {
    id: h.id,
    integrationId: h.integrationId,
    url: h.url ?? null,
    events: h.events,
    secretHint: h.secretHint,
    lastRotated: h.lastRotated,
    active: h.active,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
  };
}

/** Frontend `WebhookDelivery` shape plus the operational fields. */
export function deliveryView(d: WebhookDeliveryRow) {
  return {
    id: d.id,
    event: d.event,
    status: d.lastStatus,
    when: d.attempts ? ago(d.updatedAt) : 'queued',
    duration: `${d.durationMs}ms`,
    state: d.state,
    attempts: d.attempts,
    maxAttempts: d.maxAttempts,
    nextAttemptAt: d.nextAttemptAt ? new Date(d.nextAttemptAt).toISOString() : null,
    error: d.lastError ?? null,
    webhookId: d.webhookId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function deleteHook(ctx: Ctx, webhookId: string | null) {
  const i = visibleIntegration(ctx.params.id);
  const h = webhookId ? outboundWebhooks.get(webhookId) : undefined;
  if (!h || h.integrationId !== i.id) throw new HttpError(404, 'not_found', 'Not found');
  outboundWebhooks.delete(h.id);
  audit.append({
    actor: ctx.principal!.memberId,
    action: 'webhook.deleted',
    target: `${i.name} · ${h.id}`,
    sensitive: true,
    requestId: ctx.requestId,
  });
}

export function registerWebhookRoutes(r: Router) {
  startWebhookDispatcher();

  r.add(
    'GET',
    '/api/integrations/:id/webhooks',
    {
      summary: 'Webhook subscriptions and recent deliveries for an integration',
      tag: 'webhooks',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Administration', 'view'),
    (ctx) => {
      const i = visibleIntegration(ctx.params.id);
      const hooks = [...outboundWebhooks.values()]
        .filter((h) => h.integrationId === i.id)
        .map(hookView);
      const deliveries = [...webhookDeliveries.values()]
        .filter((d) => d.integrationId === i.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(deliveryView);
      return { items: hooks, deliveries: paginate(deliveries, ctx.query, 50).items };
    },
  );

  r.add(
    'POST',
    '/api/integrations/:id/webhooks',
    {
      summary: 'Add a webhook subscription (signing secret shown once)',
      tag: 'webhooks',
      responses: [401, 403, 404, 422],
    },
    authenticate,
    requireArea('Administration', 'manage'),
    requireStepUp(),
    async (ctx) => {
      const body = parse(createBody, ctx.body);
      const i = visibleIntegration(ctx.params.id);
      if (!body.events.length)
        throw new HttpError(422, 'validation_failed', 'events must not be empty');
      if (i.kind !== 'webhook' && body.url)
        throw new HttpError(422, 'validation_failed', `url is fixed for ${i.kind} integrations`);
      const url = i.kind === 'webhook' && body.url ? await vetDestination(body.url) : undefined;
      const secret = newSigningSecret();
      const now = new Date().toISOString();
      const hook: OutboundWebhook = {
        id: `wh-${randomToken(6)}`,
        integrationId: i.id,
        url,
        events: [...new Set(body.events)],
        secret: seal(secret),
        secretHint: hint(secret),
        active: true,
        createdBy: ctx.principal!.memberId,
        createdAt: now,
        lastRotated: now,
      };
      outboundWebhooks.set(hook.id, hook);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'webhook.created',
        target: `${i.name} · ${hook.id} · ${hook.events.join(',')}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return { ...hookView(hook), signingSecret: secret };
    },
  );

  r.add(
    'DELETE',
    '/api/integrations/:id/webhooks/:webhookId',
    { summary: 'Remove a webhook subscription', tag: 'webhooks', responses: [401, 403, 404] },
    authenticate,
    requireArea('Administration', 'manage'),
    (ctx) => deleteHook(ctx, ctx.params.webhookId),
  );

  r.add(
    'DELETE',
    '/api/integrations/:id/webhooks',
    {
      summary: 'Remove a webhook subscription (?webhookId=)',
      tag: 'webhooks',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Administration', 'manage'),
    (ctx) => deleteHook(ctx, ctx.query.get('webhookId')),
  );

  r.add(
    'POST',
    '/api/integrations/:id/webhooks/:webhookId/test',
    { summary: 'Send a signed test ping', tag: 'webhooks', responses: [401, 403, 404] },
    authenticate,
    requireArea('Administration', 'manage'),
    (ctx) => {
      const i = visibleIntegration(ctx.params.id);
      const h = outboundWebhooks.get(ctx.params.webhookId);
      if (!h || h.integrationId !== i.id) throw new HttpError(404, 'not_found', 'Not found');
      const row = enqueue(h, {
        id: `evt-${randomToken(8)}`,
        type: 'ping',
        at: new Date().toISOString(),
        data: { id: 'ping', title: 'DevHQ test delivery', integration: i.name },
      });
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'webhook.test_sent',
        target: `${i.name} · ${h.id}`,
        requestId: ctx.requestId,
      });
      ctx.status = 202;
      return deliveryView(row);
    },
  );
}
