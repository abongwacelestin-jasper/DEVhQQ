import '../setup.ts';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  OUTBOUND_EVENTS,
  attempt,
  backoffMs,
  dispatch,
  setBackoffBase,
  startWebhookDispatcher,
  stopWebhookDispatcher,
  signPayload,
  translate,
  verifyOutboundSignature,
  type OutboundEnvelope,
} from '../../integrations/webhooks/dispatcher.ts';
import {
  setOutboundDeps,
  type OutboundRequest,
  type OutboundResponse,
} from '../../monitors/ssrf.ts';
import {
  integrations,
  outboundWebhooks,
  webhookDeliveries,
} from '../../domain/engineering/store.ts';
import { seal } from '../../domain/engineering/secrets.ts';
import type {
  IntegrationRow,
  OutboundWebhook,
  WebhookDeliveryRow,
} from '../../domain/engineering/types.ts';
import { audit } from '../../audit/auditLog.ts';
import { publish } from '../../lib/events.ts';
import type { ProductId } from '../../types.ts';

const SECRET = 'whsec_test_0123456789';
const NOW = 1_800_000_000_000;

describe('integrations/webhooks — signatures', () => {
  it('signs `${t}.${body}` with HMAC-SHA256 as t=<unix>,v1=<hex>', () => {
    const body = '{"type":"ping"}';
    const v1 = createHmac('sha256', SECRET).update(`1700000000.${body}`).digest('hex');
    assert.equal(signPayload(SECRET, body, 1700000000), `t=1700000000,v1=${v1}`);
  });

  it('defaults t to the current unix second (fake time)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW + 750 });
    assert.match(signPayload(SECRET, 'x'), new RegExp(`^t=${NOW / 1000},v1=[0-9a-f]{64}$`));
  });

  it('verifies within ±5 minutes, inclusive, and rejects outside', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const ts = NOW / 1000;
    for (const [offset, ok] of [
      [0, true],
      [-300, true],
      [300, true],
      [-301, false],
      [301, false],
    ] as const)
      assert.equal(
        verifyOutboundSignature(SECRET, 'b', signPayload(SECRET, 'b', ts + offset)),
        ok,
        String(offset),
      );
    assert.equal(
      verifyOutboundSignature(SECRET, 'b', signPayload(SECRET, 'b', ts - 50), 30),
      false,
      'custom tolerance',
    );
  });

  it('rejects a wrong secret, a modified body, a modified timestamp or signature', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const header = signPayload(SECRET, '{"a":1}');
    assert.equal(verifyOutboundSignature(SECRET, '{"a":1}', header), true);
    assert.equal(verifyOutboundSignature('other', '{"a":1}', header), false);
    assert.equal(verifyOutboundSignature(SECRET, '{"a":2}', header), false);
    assert.equal(
      verifyOutboundSignature(
        SECRET,
        '{"a":1}',
        header.replace(/t=(\d+)/, (_m, d: string) => `t=${Number(d) - 1}`),
      ),
      false,
    );
    assert.equal(
      verifyOutboundSignature(
        SECRET,
        '{"a":1}',
        header.slice(0, -1) + (header.endsWith('0') ? '1' : '0'),
      ),
      false,
    );
  });

  it('rejects malformed headers without throwing', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const good = signPayload(SECRET, 'b');
    for (const h of [
      '',
      't=',
      'v1=abc',
      `t=${NOW / 1000}`,
      't=abc,v1=00',
      `${good},v0=00`,
      good.replace(',', ', '),
      good.toUpperCase(),
      '=,=,=',
    ])
      assert.equal(verifyOutboundSignature(SECRET, 'b', h), false, JSON.stringify(h));
  });
});

describe('integrations/webhooks — backoff schedule', () => {
  after(() => setBackoffBase(2_000));

  it('grows ×4 per attempt from 2 s with up to +20 % jitter', (t) => {
    setBackoffBase(2_000);
    t.mock.method(Math, 'random', () => 0);
    assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [2_000, 8_000, 32_000, 128_000, 512_000]);
    t.mock.method(Math, 'random', () => 0.999999);
    const hi = [1, 2, 3, 4, 5].map(backoffMs);
    [2_000, 8_000, 32_000, 128_000, 512_000].forEach((b, i) => {
      assert.ok(hi[i] >= b && hi[i] <= b * 1.2, `${hi[i]} vs ${b}`);
    });
  });

  it('honours the test seam', (t) => {
    t.mock.method(Math, 'random', () => 0);
    setBackoffBase(10);
    assert.equal(backoffMs(1), 10);
    assert.equal(backoffMs(3), 160);
  });
});

describe('integrations/webhooks — delivery attempts', () => {
  const sent: OutboundRequest[] = [];
  let next: (req: OutboundRequest) => OutboundResponse | Promise<OutboundResponse>;
  let restore: () => void;
  let n = 0;

  before(() => {
    restore = setOutboundDeps({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async (req) => {
        sent.push(req);
        return next(req);
      },
    });
  });
  after(() => restore());
  beforeEach(() => {
    sent.length = 0;
    next = () => ({ status: 204, headers: {}, body: '', truncated: false });
  });

  function seed(
    kind: IntegrationRow['kind'],
    opts: {
      products?: ProductId[];
      credential?: string;
      url?: string;
      events?: OutboundWebhook['events'];
      active?: boolean;
    } = {},
  ) {
    n++;
    const now = new Date().toISOString();
    const integration: IntegrationRow = {
      id: `int-${n}`,
      kind,
      name: `${kind} ${n}`,
      credential: seal(opts.credential ?? 'https://hooks.example.com/in'),
      credentialHint: '••••/in',
      products: opts.products ?? [],
      connectedBy: 'm1',
      connectedAt: now,
      updatedAt: now,
    };
    const hook: OutboundWebhook = {
      id: `wh-${n}`,
      integrationId: integration.id,
      url: opts.url,
      events: opts.events ?? ['incident.opened'],
      secret: seal(SECRET),
      secretHint: '••••6789',
      active: opts.active ?? true,
      createdBy: 'm1',
      createdAt: now,
      lastRotated: now,
    };
    integrations.set(integration.id, integration);
    outboundWebhooks.set(hook.id, hook);
    return { integration, hook };
  }

  function pendingRow(
    hook: OutboundWebhook,
    env: Partial<OutboundEnvelope> = {},
  ): WebhookDeliveryRow {
    const envelope: OutboundEnvelope = {
      id: `evt-${n}`,
      type: 'incident.opened',
      at: new Date().toISOString(),
      data: { id: 'INC-1', title: 'API down' },
      ...env,
    };
    const now = new Date().toISOString();
    const row: WebhookDeliveryRow = {
      id: `dl-test-${n}-${Math.random().toString(36).slice(2)}`,
      integrationId: hook.integrationId,
      webhookId: hook.id,
      event: envelope.type,
      payload: JSON.stringify(envelope),
      state: 'pending',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: Date.now(),
      lastStatus: 0,
      durationMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    webhookDeliveries.set(row.id, row);
    return row;
  }

  it('signs the exact bytes it sends, and the receiver-side verifier accepts them', async () => {
    const { hook } = seed('webhook', { url: 'https://receiver.example.com/devhq' });
    const row = pendingRow(hook);
    const done = await attempt(row.id);
    assert.equal(done?.state, 'succeeded');
    assert.equal(sent.length, 1);
    const req = sent[0];
    assert.equal(req.url.toString(), 'https://receiver.example.com/devhq');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.headers['x-devhq-event'], 'incident.opened');
    assert.equal(req.headers['x-devhq-delivery'], row.id);
    assert.equal(
      verifyOutboundSignature(SECRET, req.body!, req.headers['x-devhq-signature']),
      true,
    );
    assert.equal(
      verifyOutboundSignature(SECRET, `${req.body} `, req.headers['x-devhq-signature']),
      false,
    );
    assert.deepEqual(
      JSON.parse(req.body!),
      JSON.parse(row.payload),
      'generic webhooks get the envelope',
    );
  });

  it('never sends the signing secret or the sealed credential', async () => {
    const { hook } = seed('webhook', { url: 'https://receiver.example.com/x' });
    await attempt(pendingRow(hook).id);
    const wire = JSON.stringify(sent[0]);
    assert.ok(!wire.includes(SECRET));
    assert.ok(!wire.includes(hook.secret));
  });

  it('renders Slack and PagerDuty payloads to their fixed endpoints', async () => {
    const slack = seed('slack', { credential: 'https://hooks.slack.example.com/T/B/x' });
    await attempt(
      pendingRow(slack.hook, {
        product: 'renewberry',
        data: { title: 'API down', status: 'investigating' },
      }).id,
    );
    assert.equal(sent[0].url.toString(), 'https://hooks.slack.example.com/T/B/x');
    assert.deepEqual(JSON.parse(sent[0].body!), {
      text: '*incident.opened* · renewberry — API down (investigating)',
    });

    const pd = seed('pagerduty', { credential: 'routing-key-123' });
    await attempt(
      pendingRow(pd.hook, {
        type: 'incident.resolved',
        data: { id: 'INC-9', title: 'x', severity: 'SEV1' },
      }).id,
    );
    assert.equal(sent[1].url.toString(), 'https://events.pagerduty.com/v2/enqueue');
    const body = JSON.parse(sent[1].body!) as {
      routing_key: string;
      event_action: string;
      dedup_key: string;
      payload: { severity: string };
    };
    assert.deepEqual(
      [body.routing_key, body.event_action, body.dedup_key, body.payload.severity],
      ['routing-key-123', 'resolve', 'devhq-INC-9', 'critical'],
    );
  });

  it('does not follow redirects (a 3xx counts as a failed attempt)', async () => {
    next = () => ({
      status: 302,
      headers: { location: 'https://elsewhere.example.com/' },
      body: '',
      truncated: false,
    });
    const { hook } = seed('webhook', { url: 'https://receiver.example.com/r' });
    const row = await attempt(pendingRow(hook).id);
    assert.equal(sent.length, 1);
    assert.deepEqual([row?.state, row?.lastError, row?.attempts], ['pending', 'HTTP 302', 1]);
  });

  it('refuses SSRF targets without sending anything', async () => {
    const { hook } = seed('webhook', { url: 'http://169.254.169.254/latest/meta-data/' });
    const row = await attempt(pendingRow(hook).id);
    assert.equal(sent.length, 0);
    assert.match(row?.lastError ?? '', /Blocked destination/);
    assert.equal(row?.state, 'pending', 'retried, then failed');
  });

  it('schedules retries with backoff and gives up after maxAttempts with an audit entry', async (t) => {
    t.mock.method(Math, 'random', () => 0);
    setBackoffBase(2_000);
    next = () => ({ status: 500, headers: {}, body: 'boom', truncated: false });
    const { hook, integration } = seed('webhook', { url: 'https://receiver.example.com/fail' });
    const row = pendingRow(hook);
    const gaps: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const before = Date.now();
      const r = await attempt(row.id);
      assert.equal(r?.attempts, i);
      if (i < 5) gaps.push((r?.nextAttemptAt ?? 0) - before);
    }
    assert.equal(webhookDeliveries.get(row.id)?.state, 'failed');
    assert.equal(webhookDeliveries.get(row.id)?.nextAttemptAt, undefined);
    // Each gap is the backoff for that attempt (allowing for a few ms of wall clock).
    [2_000, 8_000, 32_000, 128_000].forEach((b, i) =>
      assert.ok(gaps[i] >= b && gaps[i] < b + 1_000, `${gaps[i]}`),
    );
    assert.ok(
      audit
        .list({ limit: 20 })
        .some(
          (e) => e.action === 'webhook.delivery_failed' && e.target.startsWith(integration.name),
        ),
    );
    // A failed delivery is never retried again.
    await attempt(row.id);
    assert.equal(sent.length, 5);
  });

  it('a removed subscription fails the delivery without a request', async () => {
    const { hook } = seed('webhook', { url: 'https://receiver.example.com/gone' });
    const row = pendingRow(hook);
    outboundWebhooks.delete(hook.id);
    const r = await attempt(row.id);
    assert.deepEqual([r?.state, r?.lastError], ['failed', 'Subscription was removed']);
    assert.equal(sent.length, 0);
  });

  it('dispatch fans out only to active hooks subscribed to the event and scoped to the product', async () => {
    const blogOnly = seed('webhook', {
      url: 'https://a.example.com/',
      products: ['blog'],
      events: ['monitor.down'],
    });
    const all = seed('webhook', { url: 'https://b.example.com/', events: ['monitor.down'] });
    seed('webhook', { url: 'https://c.example.com/', events: ['monitor.up'] });
    seed('webhook', { url: 'https://d.example.com/', events: ['monitor.down'], active: false });
    const before = new Set(webhookDeliveries.keys());
    assert.equal(dispatch('monitor.down', 'renewberry', { id: 'mon-1' }), 1);
    assert.equal(dispatch('monitor.down', 'blog', { id: 'mon-2' }), 2);
    const created = [...webhookDeliveries.values()].filter((d) => !before.has(d.id));
    assert.deepEqual(
      created.map((d) => d.webhookId).sort(),
      [all.hook.id, all.hook.id, blogOnly.hook.id].sort(),
    );
    // enqueue() attempts immediately in the background; let those finish against
    // the fake transport so nothing outlives the test or touches the network.
    for (
      let i = 0;
      i < 200 && created.some((d) => webhookDeliveries.get(d.id)?.state === 'pending');
      i++
    )
      await new Promise((r) => setImmediate(r));
    assert.ok(created.every((d) => webhookDeliveries.get(d.id)?.state === 'succeeded'));
    assert.deepEqual(sent.map((r) => r.url.hostname).sort(), [
      'a.example.com',
      'b.example.com',
      'b.example.com',
    ]);
  });
});

describe('integrations/webhooks — bus subscription', () => {
  it('start subscribes to the event bus (idempotently) and stop unsubscribes', async () => {
    const sent: OutboundRequest[] = [];
    const restore = setOutboundDeps({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async (req) => {
        sent.push(req);
        return { status: 200, headers: {}, body: '', truncated: false };
      },
    });
    try {
      const now = new Date().toISOString();
      integrations.set('int-bus', {
        id: 'int-bus',
        kind: 'webhook',
        name: 'bus',
        credential: seal('https://bus.example.com/'),
        credentialHint: '',
        products: [],
        connectedBy: 'm1',
        connectedAt: now,
        updatedAt: now,
      });
      outboundWebhooks.set('wh-bus', {
        id: 'wh-bus',
        integrationId: 'int-bus',
        events: ['monitor.up'],
        secret: seal(SECRET),
        secretHint: '',
        active: true,
        createdBy: 'm1',
        createdAt: now,
        lastRotated: now,
      });
      startWebhookDispatcher();
      startWebhookDispatcher();
      publish('monitor', { id: 'mon-bus', status: 'up' });
      const toBus = () => sent.filter((r) => r.url.hostname === 'bus.example.com').length;
      for (let i = 0; i < 200 && toBus() === 0; i++) await new Promise((r) => setImmediate(r));
      // Earlier tests left another active monitor.up subscriber; count only ours.
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      assert.equal(toBus(), 1, 'one delivery even though start() ran twice');
      stopWebhookDispatcher();
      publish('monitor', { id: 'mon-bus', status: 'up' });
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      assert.equal(toBus(), 1, 'no deliveries after stop()');
    } finally {
      stopWebhookDispatcher();
      restore();
    }
  });
});

describe('integrations/webhooks — event translation', () => {
  it('maps monitor and deployment bus events and ignores the rest', () => {
    assert.deepEqual(
      translate({ type: 'monitor', at: '', data: { status: 'down', product: 'blog', id: 'm' } }),
      {
        type: 'monitor.down',
        product: 'blog',
        data: { status: 'down', product: 'blog', id: 'm' },
      },
    );
    assert.equal(translate({ type: 'monitor', at: '', data: { status: 'degraded' } }), null);
    assert.equal(
      translate({ type: 'deployment', at: '', data: { id: 'x', status: 'running' } }),
      null,
    );
    assert.equal(
      translate({ type: 'deployment', at: '', data: { id: 'nope', status: 'failed' } })?.type,
      'deployment.failed',
    );
    assert.equal(translate({ type: 'task', at: '', data: {} }), null);
    assert.ok(OUTBOUND_EVENTS.includes('incident.opened'));
  });

  it('emits incident.opened once and incident.resolved only on the transition', () => {
    const ev = (status: string) => ({ type: 'incident', at: '', data: { id: 'INC-TX', status } });
    assert.equal(translate(ev('investigating'))?.type, 'incident.opened');
    assert.equal(translate(ev('investigating')), null, 'not re-opened');
    assert.equal(translate(ev('identified')), null);
    assert.equal(translate(ev('resolved'))?.type, 'incident.resolved');
    assert.equal(translate(ev('resolved')), null, 'not resolved twice');
  });
});
