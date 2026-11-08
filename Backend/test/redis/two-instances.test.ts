/**
 * Two real API processes (server.ts) sharing one Redis, as two Railway
 * replicas would: shared rate limits, cross-replica event and realtime
 * delivery with the per-subscriber policy intact, no double delivery.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  call,
  client,
  closeClient,
  collectSse,
  demoToken,
  dropPrefix,
  REDIS_URL,
  spawnInstance,
  uniquePrefix,
  until,
  type Instance,
} from './helpers.ts';

const prefix = uniquePrefix('two');
let A: Instance;
let B: Instance;

before(async () => {
  // A generous command timeout: these assertions are about sharing, not latency
  // (the Redis-down suites cover timeouts).
  const env = {
    REDIS_URL,
    REDIS_KEY_PREFIX: prefix,
    EXPECT_REPLICAS: '2',
    REDIS_COMMAND_TIMEOUT_MS: '10000',
  };
  [A, B] = await Promise.all([spawnInstance('A', env), spawnInstance('B', env)]);
});

after(async () => {
  await Promise.all([A?.stop(), B?.stop()]);
  const c = await client();
  await dropPrefix(c, prefix);
  await closeClient(c);
});

describe('two API instances, one Redis', () => {
  it('both report Redis up and ready', async () => {
    for (const i of [A, B]) {
      const r = await call(i.base, 'GET', '/api/ready');
      assert.equal(r.status, 200, i.log());
      assert.equal(r.json.redis, 'up');
    }
  });

  it('the auth limit is one budget across both instances', async () => {
    // Dev auth bucket: capacity 60, 1 token/s. 120 requests from one client IP,
    // alternating A/B, all at once: per-process buckets would allow all 120.
    const ip = '198.51.100.23';
    const started = Date.now();
    const statuses = await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        call(i % 2 ? A.base : B.base, 'POST', '/api/auth/webauthn/options', { ip, body: {} }).then(
          (r) => ({ via: i % 2 ? 'A' : 'B', status: r.status }),
        ),
      ),
    );
    const refill = Math.ceil((Date.now() - started) / 1000);
    const allowed = statuses.filter((s) => s.status !== 429);
    assert.ok(
      allowed.length >= 60 && allowed.length <= 60 + refill,
      `allowed ${allowed.length}, expected 60 (+${refill} refill)`,
    );
    for (const via of ['A', 'B'])
      assert.ok(
        statuses.some((s) => s.via === via && s.status === 429),
        `${via} enforced the shared budget`,
      );
    // The bucket is still drained, whichever instance is asked next.
    for (const i of [A, B]) {
      const r = await call(i.base, 'POST', '/api/auth/webauthn/options', { ip, body: {} });
      assert.equal(r.status, 429);
      assert.ok(Number(r.headers.get('retry-after')) >= 1);
    }
  });

  it('a bus event published on A reaches /api/_events on B, filtered per subscriber, once', async () => {
    const adminB = await demoToken(B.base, 'admin', '127.9.1.1');
    const testerB = await demoToken(B.base, 'tester', '127.9.1.2');
    const adminA = await demoToken(A.base, 'admin', '127.9.1.3');
    const owner = collectSse(B.base, '/api/_events', adminB, '127.9.1.1');
    const tester = collectSse(B.base, '/api/_events', testerB, '127.9.1.2');
    const local = collectSse(A.base, '/api/_events', adminA, '127.9.1.3');
    await Promise.all([owner.open, tester.open, local.open]);

    // `incident` events carry only the id: B cannot resolve the product from its
    // own data, so this proves the product travels with the event.
    const ids: Record<string, string> = {};
    for (const product of ['blog', 'renewberry']) {
      const r = await call(A.base, 'POST', '/api/incidents', {
        token: adminA,
        ip: '127.9.1.3',
        body: { product, title: `Cross-replica probe ${product}`, severity: 'SEV3' },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      ids[product] = String(r.json.id);
    }
    const incidents = (s: typeof owner) =>
      s.events
        .filter((e) => e.type === 'incident')
        .map((e) => (e.data as { data: { id: string } }).data.id);
    assert.ok(
      await until(() => incidents(owner).length >= 2 && incidents(tester).length >= 1),
      `owner ${incidents(owner)} tester ${incidents(tester)}`,
    );
    await new Promise((r) => setTimeout(r, 300)); // room for any duplicate to arrive
    await Promise.all([owner.stop(), tester.stop(), local.stop()]);

    assert.deepEqual(
      incidents(owner).sort(),
      [ids.blog, ids.renewberry].sort(),
      'Owner on B: both, once',
    );
    assert.deepEqual(
      incidents(tester),
      [ids.renewberry],
      'Tester on B: only a product they can see',
    );
    assert.deepEqual(
      incidents(local).sort(),
      [ids.blog, ids.renewberry].sort(),
      'publisher A: once each',
    );
    // Security events stay Administration-only across replicas too.
    assert.ok(
      owner.events.some((e) => e.type === 'audit'),
      'Owner sees audit events from A',
    );
    assert.ok(!tester.events.some((e) => e.type === 'audit' || e.type === 'signin'));
  });

  it('a private-channel message on A reaches members on B, not non-members, once', async () => {
    // `incidents` is a seeded private channel: m1 (Owner) and m4 (Developer) are members, m10 (Tester) is not.
    const adminA = await demoToken(A.base, 'admin', '127.9.2.1');
    const devA = await demoToken(A.base, 'developer', '127.9.2.2');
    const devB = await demoToken(B.base, 'developer', '127.9.2.3');
    const testerB = await demoToken(B.base, 'tester', '127.9.2.4');
    const member = collectSse(B.base, '/api/stream', devB, '127.9.2.3');
    const outsider = collectSse(B.base, '/api/stream', testerB, '127.9.2.4');
    const publisherSide = collectSse(A.base, '/api/stream', devA, '127.9.2.2');
    await Promise.all([member.open, outsider.open, publisherSide.open]);

    const secret = `cross-replica-${Date.now()}`;
    const r = await call(A.base, 'POST', '/api/channels/incidents/messages', {
      token: adminA,
      ip: '127.9.2.1',
      body: { kind: 'text', text: `@m4 ${secret}` },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));

    const created = (s: typeof member) =>
      s.events.filter(
        (e) => e.type === 'message.created' && JSON.stringify(e.data).includes(secret),
      );
    const mentioned = (s: typeof member) =>
      s.events.filter((e) => e.type === 'notification.created');
    assert.ok(
      await until(() => created(member).length >= 1 && mentioned(member).length >= 1),
      JSON.stringify(member.events.map((e) => e.type)),
    );
    await new Promise((r2) => setTimeout(r2, 300));
    await Promise.all([member.stop(), outsider.stop(), publisherSide.stop()]);

    assert.equal(created(member).length, 1, 'member on B: the message, once');
    assert.equal(mentioned(member).length, 1, 'member on B: the mention notification, once');
    assert.equal(created(publisherSide).length, 1, 'member on A: once (no echo from Redis)');
    assert.ok(!JSON.stringify(outsider.events).includes(secret), 'non-member on B: nothing');
    assert.equal(mentioned(outsider).length, 0, 'notifications reach only the addressee');
    // HLC ids: B's frame id is the id A assigned.
    assert.equal(created(member)[0].id, created(publisherSide)[0].id);
  });
});
