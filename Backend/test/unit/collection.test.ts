import '../setup.ts';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Collection,
  createCollection,
  hydrateAll,
  registeredCollections,
  setDriver,
  type CollectionDriver,
} from '../../store/collection.ts';

type Call = ['write', string, string, unknown] | ['remove', string, string] | ['load', string];

/** A recording driver backed by a plain object, like a tiny database. */
function recordingDriver(persisted: Record<string, [string, unknown][]> = {}) {
  const calls: Call[] = [];
  const driver: CollectionDriver = {
    write: (c, k, v) => void calls.push(['write', c, k, v]),
    remove: (c, k) => void calls.push(['remove', c, k]),
    load: async (c) => {
      calls.push(['load', c]);
      return persisted[c] ?? [];
    },
  };
  return { driver, calls };
}

let n = 0;
const uniqueName = () => `test-collection-${++n}`;

// Runs first, before any setDriver(): this is the no-DATABASE_URL mode used by
// smoke tests and the local quick start.
describe('store/collection — default in-memory driver', () => {
  it('set/save/delete work without a database and hydrate keeps memory as is', async () => {
    const c = createCollection<{ v: number }>(uniqueName());
    c.set('a', { v: 1 });
    c.save('a');
    assert.equal(await c.hydrate(), 0);
    assert.deepEqual(c.get('a'), { v: 1 });
    assert.equal(c.delete('a'), true);
    assert.equal(c.size, 0);
  });
});

describe('store/collection — persistence seam', () => {
  let rec: ReturnType<typeof recordingDriver>;
  beforeEach(() => {
    rec = recordingDriver();
    setDriver(rec.driver);
  });

  it('set() writes through to the driver', () => {
    const name = uniqueName();
    const c = createCollection<{ v: number }>(name);
    const row = { v: 1 };
    c.set('a', row);
    assert.deepEqual(rec.calls, [['write', name, 'a', row]]);
    assert.equal(c.get('a'), row);
  });

  it('delete() removes through the driver only when the key existed', () => {
    const name = uniqueName();
    const c = createCollection<number>(name);
    c.set('a', 1);
    assert.equal(c.delete('missing'), false);
    assert.equal(c.delete('a'), true);
    assert.deepEqual(rec.calls.slice(1), [['remove', name, 'a']]);
  });

  it('save() persists an in-place mutation; unknown keys are a no-op', () => {
    const name = uniqueName();
    const c = createCollection<{ status: string }>(name);
    const row = { status: 'open' };
    c.set('k', row);
    row.status = 'done';
    c.save('k');
    c.save('nope');
    assert.equal(rec.calls.length, 2);
    assert.deepEqual(rec.calls[1], ['write', name, 'k', { status: 'done' }]);
  });

  it('in-place mutation without save() is not persisted (documents the contract)', () => {
    const c = createCollection<{ status: string }>(uniqueName());
    const row = { status: 'open' };
    c.set('k', row);
    row.status = 'done';
    assert.equal(rec.calls.length, 1);
  });

  it('hydrate() loads persisted rows without writing them back', async () => {
    const name = uniqueName();
    const c = createCollection<{ v: number }>(name);
    c.set('stale', { v: 0 });
    const db = recordingDriver({
      [name]: [
        ['a', { v: 1 }],
        ['b', { v: 2 }],
      ],
    });
    setDriver(db.driver);
    assert.equal(await c.hydrate(), 2);
    assert.deepEqual(db.calls, [['load', name]], 'no write-back during hydrate');
    assert.deepEqual(
      [...c.entries()],
      [
        ['a', { v: 1 }],
        ['b', { v: 2 }],
      ],
      'replaces memory contents',
    );
    // After hydration, writes persist again.
    c.set('c', { v: 3 });
    assert.deepEqual(db.calls[1], ['write', name, 'c', { v: 3 }]);
  });

  it('hydrate() with nothing persisted keeps in-memory (seed) data', async () => {
    const c = createCollection<number>(uniqueName());
    c.set('seed', 1);
    assert.equal(await c.hydrate(), 0);
    assert.equal(c.get('seed'), 1);
  });

  it('a failing load leaves the collection writable (loading flag reset)', async () => {
    const name = uniqueName();
    const c = createCollection<number>(name);
    const calls: Call[] = [];
    setDriver({
      write: (col, k, v) => void calls.push(['write', col, k, v]),
      remove: () => undefined,
      load: async () => {
        throw new Error('db down');
      },
    });
    await assert.rejects(c.hydrate(), /db down/);
    c.set('x', 1);
    assert.deepEqual(calls, [['write', name, 'x', 1]]);
  });

  it('registering the same name twice throws', () => {
    const name = uniqueName();
    createCollection(name);
    assert.throws(() => createCollection(name), /registered twice/);
    assert.throws(() => new Collection(name), /registered twice/);
  });

  it('registeredCollections() and hydrateAll() cover every collection', async () => {
    const a = uniqueName();
    const b = uniqueName();
    createCollection(a);
    createCollection(b);
    const names = registeredCollections();
    assert.ok(names.includes(a) && names.includes(b));
    const db = recordingDriver({ [a]: [['k', 1]] });
    setDriver(db.driver);
    const loaded = await hydrateAll();
    assert.equal(loaded[a], 1);
    assert.equal(loaded[b], 0);
    assert.deepEqual(Object.keys(loaded).sort(), [...names].sort());
  });

  it('behaves as a Map for reads (handlers stay synchronous)', () => {
    const c = createCollection<number>(uniqueName());
    c.set('a', 1).set('b', 2);
    assert.equal(c.size, 2);
    assert.deepEqual([...c.keys()], ['a', 'b']);
    assert.ok(c instanceof Map);
  });
});
