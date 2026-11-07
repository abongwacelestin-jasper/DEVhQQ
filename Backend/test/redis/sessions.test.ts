import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { client, closeClient, dropPrefix, sleep, uniquePrefix } from './helpers.ts';
import type { RedisClient } from '../../lib/redis.ts';
import {
  MemorySessionStore,
  RedisSessionStore,
  type SessionStore,
} from '../../auth/sessionStore.ts';
import type { SessionRecord } from '../../auth/sessions.ts';

let a: RedisClient;
let b: RedisClient;
const p = uniquePrefix('sess');

before(async () => {
  a = await client(undefined, 'sess-a');
  b = await client(undefined, 'sess-b');
});
after(async () => {
  await dropPrefix(a, p);
  await closeClient(a);
  await closeClient(b);
});

function rec(id: string, memberId: string): SessionRecord {
  const now = Date.now();
  return {
    id,
    memberId,
    stage: 'verified',
    createdAt: now,
    lastSeenAt: now,
    verifiedAt: now,
    uaHash: 'ua',
    client: 'Client · Linux',
    ip: '127.0.0.1',
    location: {
      city: 'Local',
      country: 'Local',
      countryCode: 'LO',
      region: 'Local',
      lat: 0,
      lon: 0,
      network: 'loopback',
    },
    revoked: false,
    method: 'password',
    lastTotpCounter: -1,
  };
}

async function contract(make: () => [SessionStore, SessionStore]) {
  const [one, two] = make();
  const hour = Date.now() + 3_600_000;
  await one.put(rec('s1', 'm1'), hour);
  await one.put(rec('s2', 'm1'), hour);
  await one.put(rec('s3', 'm2'), hour);

  assert.equal((await two.get('s1'))?.memberId, 'm1', 'created on one, valid on the other');
  assert.deepEqual((await two.listByMember('m1')).map((s) => s.id).sort(), ['s1', 's2']);

  assert.equal(await two.delete('s1'), true);
  assert.equal(await one.get('s1'), undefined, 'revoked on the other, gone here at once');
  assert.equal(await two.delete('s1'), false);

  await one.put(rec('s4', 'm1'), hour);
  assert.equal(await two.deleteAllFor('m1', 's4'), 1, 'everyone else signed out (s2)');
  assert.deepEqual(
    (await one.listByMember('m1')).map((s) => s.id),
    ['s4'],
  );
  assert.equal((await one.get('s3'))?.memberId, 'm2', 'other members untouched');

  await one.put(rec('short', 'm3'), Date.now() + 150);
  assert.ok(await two.get('short'));
  await sleep(300);
  assert.equal(await two.get('short'), undefined, 'expires at the absolute lifetime');
  assert.deepEqual(await two.listByMember('m3'), []);

  await one.put(rec('past', 'm3'), Date.now() - 1);
  assert.equal(await two.get('past'), undefined, 'an already-expired session is not stored');
}

describe('SessionStore — one session, two replicas', () => {
  it('RedisSessionStore: valid on both, revocation and expiry visible everywhere', async () => {
    await contract(() => [
      new RedisSessionStore(a, p, 10_000),
      new RedisSessionStore(b, p, 10_000),
    ]);
    assert.ok((await a.pTTL(`${p}sess:s4`)) > 0, 'records carry a TTL');
  });

  it('MemorySessionStore: same contract inside one process', async () => {
    const shared = new MemorySessionStore();
    await contract(() => [shared, shared]);
  });

  it('rejects records under the wrong key', async () => {
    const store = new RedisSessionStore(a, p);
    await a.set(`${p}sess:forged`, JSON.stringify(rec('other-id', 'm1')));
    assert.equal(await store.get('forged'), undefined);
  });
});
