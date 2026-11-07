/**
 * Integrations: built-in sources (GitHub App, uptime checks) plus outbound
 * notification channels (Slack incoming webhook, generic signed webhook,
 * PagerDuty Events v2).
 *
 *   GET    /api/integrations                  Administration:view
 *   POST   /api/integrations/:kind/connect    Administration:manage + step-up
 *   DELETE /api/integrations/:id              Administration:manage + step-up
 *
 * Credentials are sealed (AES-256-GCM) before they are stored and are never
 * returned — only a 4-character hint. A generic webhook's signing secret is
 * returned exactly once, on connect.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireArea, requireStepUp } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { config } from '../config/env.ts';
import { randomToken } from '../security/crypto.ts';
import { HttpError, type Principal } from '../types.ts';
import {
  PRODUCTS,
  ago,
  integrations,
  monitors,
  outboundWebhooks,
  webhookDeliveries,
} from '../domain/engineering/store.ts';
import type {
  IntegrationKind,
  IntegrationRow,
  OutboundWebhook,
} from '../domain/engineering/types.ts';
import { hint, seal } from '../domain/engineering/secrets.ts';
import { BlockedTargetError, vetUrl } from '../monitors/ssrf.ts';
import { OUTBOUND_EVENTS } from '../integrations/webhooks/dispatcher.ts';
import { githubLive, githubMode, githubSource } from '../integrations/github/config.ts';
import { ghInstallations, repos } from '../domain/engineering/store.ts';

const KINDS = ['slack', 'webhook', 'pagerduty'] as const;

const connectBody = v.object({
  name: v.optional(v.string({ min: 2, max: 60 })),
  url: v.optional(v.string({ min: 10, max: 2048 })),
  routingKey: v.optional(v.string({ pattern: /^[A-Za-z0-9]{32}$/ })),
  events: v.optional(v.array(v.enumOf(OUTBOUND_EVENTS), { max: OUTBOUND_EVENTS.length })),
  products: v.optional(v.array(v.enumOf(PRODUCTS), { max: PRODUCTS.length })),
});

const catalogue: Record<
  IntegrationKind,
  {
    name: string;
    category: 'Notifications' | 'Monitoring';
    authority: string;
    syncs: string[];
    defaultEvents: (typeof OUTBOUND_EVENTS)[number][];
  }
> = {
  slack: {
    name: 'Slack',
    category: 'Notifications',
    authority: 'Delivery channel only — discussions stay in DevHQ.',
    syncs: ['Outbound alerts'],
    defaultEvents: [
      'deployment.approved',
      'deployment.failed',
      'incident.opened',
      'incident.resolved',
      'monitor.down',
    ],
  },
  webhook: {
    name: 'Generic webhook',
    category: 'Notifications',
    authority: 'Signed JSON events (X-DevHQ-Signature) to your endpoint.',
    syncs: ['Outbound events'],
    defaultEvents: [...OUTBOUND_EVENTS],
  },
  pagerduty: {
    name: 'PagerDuty',
    category: 'Monitoring',
    authority: 'Pages on-call for incidents and down monitors; DevHQ stays the incident record.',
    syncs: ['Incident triggers', 'Resolves'],
    defaultEvents: ['incident.opened', 'incident.resolved', 'monitor.down', 'monitor.up'],
  },
};

/** Validates a destination URL through the SSRF guard. */
export async function vetDestination(raw: string): Promise<string> {
  try {
    const { url } = await vetUrl(raw, { allowHttp: !config.isProd });
    return url.toString();
  } catch (e) {
    if (e instanceof BlockedTargetError)
      throw new HttpError(422, 'blocked_target', e.message, { reason: e.reason });
    throw new HttpError(422, 'unresolvable_target', 'Destination host could not be resolved');
  }
}

export function newSigningSecret(): string {
  return `whsec_${randomToken(24)}`;
}

export function visibleIntegration(id: string): IntegrationRow {
  const i = integrations.get(id);
  if (!i) throw new HttpError(404, 'not_found', 'Not found');
  return i;
}

export function integrationView(i: IntegrationRow) {
  const hooks = [...outboundWebhooks.values()].filter((h) => h.integrationId === i.id);
  const deliveries = [...webhookDeliveries.values()]
    .filter((d) => d.integrationId === i.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const last = deliveries.find((d) => d.state !== 'pending');
  const meta = catalogue[i.kind];
  return {
    id: i.id,
    kind: i.kind,
    name: i.name,
    category: meta.category,
    status: last?.state === 'failed' ? ('degraded' as const) : ('connected' as const),
    detail:
      last?.state === 'failed'
        ? `Last delivery failed: ${last.lastError ?? `HTTP ${last.lastStatus}`}`
        : `${hooks.length} subscription${hooks.length === 1 ? '' : 's'} · ${i.products.length ? i.products.join(', ') : 'all products'}`,
    lastSync: last ? `${ago(last.updatedAt)} ago`.replace('now ago', 'just now') : '—',
    authority: meta.authority,
    syncs: meta.syncs,
    events: [...new Set(hooks.flatMap((h) => h.events))],
    products: i.products,
    credentialHint: i.credentialHint,
    webhooks: hooks.length,
    connectedBy: i.connectedBy,
    connectedAt: i.connectedAt,
    builtIn: false,
    connectable: false,
    source: 'live' as const,
  };
}

function builtIns(p: Principal) {
  const mode = githubMode();
  const visibleRepos = [...repos.values()].filter(
    (r) =>
      (githubLive() ? r.source !== 'demo' : true) &&
      (p.role === 'Owner' || p.products.includes(r.product)),
  );
  const ownMonitors = [...monitors.values()].filter(
    (m) => p.role === 'Owner' || p.products.includes(m.product),
  );
  const failing = ownMonitors.filter((m) => m.status === 'down');
  return [
    {
      id: 'github',
      kind: 'github' as const,
      name: 'GitHub App',
      category: 'Source control' as const,
      status: githubLive() ? ('connected' as const) : ('not-connected' as const),
      detail:
        mode === 'demo'
          ? 'Not configured — showing labelled demo data'
          : mode === 'unconfigured'
            ? 'Not configured'
            : `${visibleRepos.length} repositories · ${[...ghInstallations.values()].filter((i) => !i.removedAt).length} installation(s) · webhooks signed`,
      lastSync: '—',
      authority: 'GitHub stays authoritative for code, reviews and merges.',
      syncs: ['Pull requests', 'Commits', 'Reviews', 'CI checks', 'Tags', 'Code findings'],
      builtIn: true,
      connectable: false,
      source: githubSource(),
    },
    {
      id: 'uptime',
      kind: 'uptime' as const,
      name: 'Uptime checks',
      category: 'Monitoring' as const,
      status: failing.length ? ('degraded' as const) : ('connected' as const),
      detail: `${ownMonitors.length} checks · ${failing.length} failing`,
      lastSync: 'Live',
      authority: 'Built into DevHQ. Source of truth for availability history.',
      syncs: ['Availability', 'Latency'],
      builtIn: true,
      connectable: false,
      source: ownMonitors.every((m) => m.source === 'demo') && ownMonitors.length ? 'demo' : 'live',
    },
  ];
}

export function registerIntegrationRoutes(r: Router) {
  r.add(
    'GET',
    '/api/integrations',
    {
      summary: 'Integrations: built-ins, connected channels and the connect catalogue',
      tag: 'integrations',
    },
    authenticate,
    requireArea('Administration', 'view'),
    (ctx) => {
      const connected = [...integrations.values()]
        .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt))
        .map(integrationView);
      const available = KINDS.map((kind) => ({
        id: `available-${kind}`,
        kind,
        name: catalogue[kind].name,
        category: catalogue[kind].category,
        status: 'not-connected' as const,
        detail:
          kind === 'webhook'
            ? 'HMAC-signed JSON to any HTTPS endpoint'
            : `Connect ${catalogue[kind].name}`,
        lastSync: '—',
        authority: catalogue[kind].authority,
        syncs: catalogue[kind].syncs,
        events: catalogue[kind].defaultEvents,
        builtIn: false,
        connectable: true,
        source: 'live' as const,
      }));
      return {
        items: [...builtIns(ctx.principal!), ...connected, ...available],
        events: OUTBOUND_EVENTS,
      };
    },
  );

  r.add(
    'POST',
    '/api/integrations/:kind/connect',
    {
      summary: 'Connect Slack, a generic webhook or PagerDuty (credential sealed at rest)',
      tag: 'integrations',
      responses: [401, 403, 404, 422, 503],
    },
    authenticate,
    requireArea('Administration', 'manage'),
    requireStepUp(),
    async (ctx) => {
      const kind = ctx.params.kind as IntegrationKind;
      if (!(KINDS as readonly string[]).includes(kind))
        throw new HttpError(404, 'not_found', 'Unknown integration kind');
      const body = parse(connectBody, ctx.body);
      let credential: string;
      if (kind === 'pagerduty') {
        if (!body.routingKey)
          throw new HttpError(422, 'validation_failed', 'routingKey is required');
        if (body.url)
          throw new HttpError(422, 'validation_failed', 'url is not used for PagerDuty');
        credential = body.routingKey;
      } else {
        if (!body.url) throw new HttpError(422, 'validation_failed', 'url is required');
        if (body.routingKey)
          throw new HttpError(422, 'validation_failed', 'routingKey is only for PagerDuty');
        if (
          kind === 'slack' &&
          !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{10,200}$/.test(body.url)
        )
          throw new HttpError(
            422,
            'validation_failed',
            'url must be a Slack incoming webhook (https://hooks.slack.com/services/…)',
          );
        credential = await vetDestination(body.url);
      }
      const now = new Date().toISOString();
      const integration: IntegrationRow = {
        id: `int-${randomToken(6)}`,
        kind,
        name: body.name ?? catalogue[kind].name,
        credential: seal(credential),
        credentialHint: hint(credential),
        products: body.products ?? [],
        connectedBy: ctx.principal!.memberId,
        connectedAt: now,
        updatedAt: now,
      };
      const secret = newSigningSecret();
      const hook: OutboundWebhook = {
        id: `wh-${randomToken(6)}`,
        integrationId: integration.id,
        url: kind === 'webhook' ? credential : undefined,
        events: body.events ?? catalogue[kind].defaultEvents,
        secret: seal(secret),
        secretHint: hint(secret),
        active: true,
        createdBy: ctx.principal!.memberId,
        createdAt: now,
        lastRotated: now,
      };
      integrations.set(integration.id, integration);
      outboundWebhooks.set(hook.id, hook);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'integration.connected',
        target: `${integration.name} (${kind}) · ${integration.credentialHint}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      publish('integration', { id: integration.id, kind, change: 'connected' });
      ctx.status = 201;
      return {
        ...integrationView(integration),
        webhook: { id: hook.id, events: hook.events, secretHint: hook.secretHint },
        // Shown once. Receivers verify X-DevHQ-Signature with it.
        signingSecret: secret,
      };
    },
  );

  r.add(
    'DELETE',
    '/api/integrations/:id',
    {
      summary: 'Disconnect an integration (removes its subscriptions)',
      tag: 'integrations',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Administration', 'manage'),
    requireStepUp(),
    (ctx) => {
      const i = visibleIntegration(ctx.params.id);
      for (const h of [...outboundWebhooks.values()])
        if (h.integrationId === i.id) outboundWebhooks.delete(h.id);
      for (const d of [...webhookDeliveries.values()])
        if (d.integrationId === i.id && d.state === 'pending') {
          d.state = 'failed';
          d.lastError = 'Integration disconnected';
          d.nextAttemptAt = undefined;
          webhookDeliveries.save(d.id);
        }
      integrations.delete(i.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'integration.disconnected',
        target: `${i.name} (${i.kind})`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      publish('integration', { id: i.id, kind: i.kind, change: 'disconnected' });
    },
  );
}
