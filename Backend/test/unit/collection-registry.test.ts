import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCollection,
  flushPending,
  getCollection,
  persistenceStatus,
  registeredCollections,
  setDriver,
  type CollectionDriver,
  type LoadOptions,
} from '../../store/collection.ts';
import { PgCollectionDriver } from '../../db/driver.ts';
import { committed, fakePool } from '../helpers/fakePg.ts';

let n = 0;
const name = () => `registry-test-${++n}`;

// Runs first: nothing has called setDriver yet in this process.
describe('store/collection — defaults', () => {
  it('memory mode reports a healthy, empty status and flushPending resolves', async () => {
    assert.deepEqual(persistenceStatus(), {
      mode: 'memory',
      pending: 0,
      saturated: false,
      consecutiveFailures: 0,
    });
    await flushPending();
  });
});

describe('store/collection — registry', () => {
  it('getCollection returns the registered instance, undefined otherwise', () => {
    const id = name();
    const c = createCollection<number>(id);
    assert.equal(getCollection(id), c);
    assert.equal(getCollection('never-registered'), undefined);
    assert.ok(registeredCollections().includes(id));
  });

  it('app modules register their collections under unique names', async () => {
    await import('../../domain/collab/store.ts');
    await import('../../security/pats.ts');
    const names = registeredCollections();
    for (const expected of ['collab_channels', 'collab_messages', 'auth.personal_access_tokens'])
      assert.ok(names.includes(expected), expected);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('store/collection — write-through to the PostgreSQL driver', () => {
  it('set / save / delete reach the database after flushPending()', async () => {
    const pg = fakePool();
    setDriver(new PgCollectionDriver(pg.pool, { flushDelayMs: 10_000 }));
    const id = name();
    const c = createCollection<{ status: string }>(id);
    const row = { status: 'open' };
    c.set('k', row);
    c.set('gone', { status: 'x' });
    await flushPending();
    assert.deepEqual(committed(pg, id, 'k'), { status: 'open' });
    row.status = 'done';
    c.save('k');
    c.delete('gone');
    assert.equal(persistenceStatus().mode, 'postgres');
    assert.equal(persistenceStatus().pending, 2);
    await flushPending();
    assert.deepEqual(committed(pg, id, 'k'), { status: 'done' });
    assert.equal(committed(pg, id, 'gone'), undefined);
  });

  it('evict() drops a row from memory only; the persisted copy stays', async () => {
    const pg = fakePool();
    setDriver(new PgCollectionDriver(pg.pool, { flushDelayMs: 10_000 }));
    const id = name();
    const c = createCollection<number>(id);
    c.set('k', 1);
    await flushPending();
    assert.equal(c.evict('k'), true);
    assert.equal(c.evict('k'), false);
    assert.equal(c.has('k'), false);
    await flushPending();
    assert.equal(committed(pg, id, 'k'), 1);
    assert.ok(!pg.queries.some((q) => q.sql.includes('DELETE')));
  });

  it('hydrate passes hydrateLimit to the driver and calls onHydrate with the rows', async () => {
    const seen: { limit?: number }[] = [];
    let hydrated: [string, number][] | undefined;
    const driver: CollectionDriver = {
      write() {},
      remove() {},
      load: async (_c: string, opts?: LoadOptions) => {
        seen.push({ limit: opts?.limit });
        return [['a', 1]];
      },
    };
    setDriver(driver);
    const c = createCollection<number>(name(), {
      hydrateLimit: 2000,
      onHydrate: (rows) => (hydrated = rows),
    });
    assert.equal(await c.hydrate(), 1);
    assert.deepEqual(seen, [{ limit: 2000 }]);
    assert.deepEqual(hydrated, [['a', 1]]);
  });

  it('onHydrate also runs when nothing was persisted (derived indexes rebuild from seed)', async () => {
    setDriver({ write() {}, remove() {}, load: async () => [] });
    let calls = 0;
    const c = createCollection<number>(name(), { onHydrate: () => calls++ });
    c.set('seed', 1);
    assert.equal(await c.hydrate(), 0);
    assert.equal(calls, 1);
    assert.equal(c.get('seed'), 1);
  });

  it('flushPending surfaces a driver that cannot drain', async () => {
    setDriver({
      write() {},
      remove() {},
      load: async () => [],
      flush: async () => {
        throw new Error('Persistence flush incomplete: 3 row(s) not written');
      },
    });
    await assert.rejects(flushPending(10), /flush incomplete/);
  });
});
