import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgCollectionDriver, type PgDriverOptions } from '../../db/driver.ts';
import { committed, fakePool, pgError, type FakePool } from '../helpers/fakePg.ts';

/** Fast retries, no coalescing delay surprises. */
const FAST: PgDriverOptions = { flushDelayMs: 1, maxBackoffMs: 2 };

function setup(opts: PgDriverOptions = {}) {
  const pg = fakePool();
  const driver = new PgCollectionDriver(pg.pool, { ...FAST, ...opts });
  return { pg, driver };
}

const statements = (pg: FakePool) =>
  pg.queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 2).join(' '));

describe('db/driver — write-behind basics', () => {
  it('a write is one transaction: BEGIN, upsert, COMMIT, then the client is released', async () => {
    const { pg, driver } = setup();
    driver.write('tasks', 'RB-1', { title: 'x' });
    await driver.flush();
    assert.deepEqual(statements(pg), ['BEGIN', 'INSERT INTO', 'COMMIT']);
    assert.deepEqual(committed(pg, 'tasks', 'RB-1'), { title: 'x' });
    assert.deepEqual(pg.releases, [{ connection: 1, destroyed: false }]);
    assert.equal(driver.status().pending, 0);
    assert.ok(driver.status().lastFlushAt);
  });

  it('writes and removes in one batch share a transaction', async () => {
    const { pg, driver } = setup();
    driver.write('a', '1', 1);
    driver.remove('a', '2');
    await driver.flush();
    assert.deepEqual(statements(pg), ['BEGIN', 'INSERT INTO', 'DELETE FROM', 'COMMIT']);
  });

  it('coalesces per key: last write wins; a delete after a write stays a delete', async () => {
    const { pg, driver } = setup({ flushDelayMs: 10_000 });
    driver.write('c', 'k', { v: 1 });
    driver.write('c', 'k', { v: 2 });
    driver.write('c', 'gone', { v: 1 });
    driver.remove('c', 'gone');
    assert.equal(driver.status().pending, 2);
    await driver.flush();
    const upsert = pg.queries.find((q) => q.sql.includes('INSERT'))!;
    assert.deepEqual(upsert.params, [['c'], ['k'], ['{"v":2}']]);
    const del = pg.queries.find((q) => q.sql.includes('DELETE'))!;
    assert.deepEqual(del.params, [['c'], ['gone']]);
  });

  it('snapshots the value at enqueue time (a later mutation without save never leaks)', async () => {
    const { pg, driver } = setup({ flushDelayMs: 10_000 });
    const row = { status: 'open' };
    driver.write('t', 'k', row);
    row.status = 'done';
    await driver.flush();
    assert.deepEqual(committed(pg, 't', 'k'), { status: 'open' });
  });

  it('batches follow the order of the most recent change', async () => {
    const { pg, driver } = setup({ flushDelayMs: 10_000 });
    driver.write('t', 'a', 1);
    driver.write('t', 'b', 2);
    driver.write('t', 'a', 3);
    await driver.flush();
    assert.deepEqual(pg.queries.find((q) => q.sql.includes('INSERT'))!.params[1], ['b', 'a']);
  });

  it('splits into batches of batchSize with only one transaction in flight', async () => {
    const { pg, driver } = setup({ batchSize: 2, flushDelayMs: 10_000 });
    pg.onQuery = () => new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 5; i++) driver.write('t', `k${i}`, i);
    await driver.flush();
    assert.equal(pg.commits, 3);
    assert.equal(pg.maxConcurrent, 1);
    for (let i = 0; i < 5; i++) assert.equal(committed(pg, 't', `k${i}`), i);
  });

  it('flushes in the background without an explicit flush()', async () => {
    const { pg, driver } = setup({ flushDelayMs: 1 });
    driver.write('t', 'bg', true);
    for (let i = 0; i < 100 && pg.commits === 0; i++) await new Promise((r) => setTimeout(r, 2));
    assert.equal(committed(pg, 't', 'bg'), true);
  });
});

describe('db/driver — SQL is always parameterised', () => {
  it('no collection, key or value ever appears in SQL text', async () => {
    const { pg, driver } = setup();
    const hostile = ["x'); DROP TABLE documents;--", 'Robert"); --', 'k$9 OR 1=1', "' OR '1'='1"];
    for (const h of hostile) {
      driver.write(`col${h}`, `key${h}`, { text: h });
      driver.remove(`col${h}`, `del${h}`);
    }
    await driver.flush();
    await driver.load(`col${hostile[0]}`, { limit: 5 });
    for (const q of pg.queries) for (const h of hostile) assert.ok(!q.sql.includes(h), q.sql);
    // Values travel as typed arrays.
    const upsert = pg.queries.find((q) => q.sql.includes('INSERT'))!;
    assert.match(upsert.sql, /unnest\(\$1::text\[\], \$2::text\[\], \$3::text\[\]\)/);
    assert.equal(committed(pg, `col${hostile[0]}`, `key${hostile[0]}`) !== undefined, true);
  });
});

describe('db/driver — load', () => {
  it('maps rows to [key, data] and passes the limit as a parameter', async () => {
    const { pg, driver } = setup();
    pg.loadRows = [
      { key: 'a', data: { n: 1 } },
      { key: 'b', data: { n: 2 } },
    ];
    assert.deepEqual(await driver.load('things', { limit: 10 }), [
      ['a', { n: 1 }],
      ['b', { n: 2 }],
    ]);
    assert.deepEqual(pg.queries.at(-1)!.params, ['things', 10]);
    await driver.load('things');
    assert.deepEqual(pg.queries.at(-1)!.params, ['things', null], 'no limit → NULL (all rows)');
    assert.match(pg.queries.at(-1)!.sql, /ORDER BY updated_at DESC/);
  });

  it('propagates load errors (boot must fail rather than start empty)', async () => {
    const { pg, driver } = setup();
    pg.onQuery = () => {
      throw pgError('08006', 'connection lost');
    };
    await assert.rejects(driver.load('x'), /connection lost/);
  });
});

describe('db/driver — failures and retry', () => {
  it('a connection failure rolls back, re-queues and retries until it succeeds', async () => {
    const { pg, driver } = setup();
    let fails = 2;
    pg.onQuery = (q) => {
      if (q.sql.includes('INSERT') && fails-- > 0) throw pgError('08006', 'connection reset');
    };
    driver.write('t', 'k', { v: 1 });
    await driver.flush(5_000);
    assert.deepEqual(committed(pg, 't', 'k'), { v: 1 });
    assert.equal(statements(pg).filter((s) => s === 'ROLLBACK').length, 2);
    assert.equal(driver.status().consecutiveFailures, 0, 'reset after success');
    assert.equal(driver.status().lastError, undefined);
  });

  it('a broken connection (ROLLBACK fails too) is destroyed, not returned to the pool', async () => {
    const { pg, driver } = setup();
    let once = true;
    pg.onQuery = (q) => {
      if (once && q.sql.includes('INSERT')) throw pgError('57P01', 'terminating connection');
      if (once && q.sql.trim() === 'ROLLBACK') {
        once = false;
        throw new Error('socket closed');
      }
    };
    driver.write('t', 'k', 1);
    await driver.flush(5_000);
    assert.deepEqual(pg.releases[0], { connection: 1, destroyed: true });
    assert.equal(committed(pg, 't', 'k'), 1);
  });

  it('a newer write that arrives during a failed batch is never overwritten by the retry', async () => {
    const { pg, driver } = setup();
    let first = true;
    pg.onQuery = (q) => {
      if (first && q.sql.includes('INSERT')) {
        first = false;
        driver.write('t', 'k', { v: 'new' });
        throw pgError('08006');
      }
    };
    driver.write('t', 'k', { v: 'old' });
    await driver.flush(5_000);
    assert.deepEqual(committed(pg, 't', 'k'), { v: 'new' });
    const upserts = pg.queries
      .filter((q) => q.sql.includes('INSERT'))
      .map((q) => (q.params[2] as string[])[0]);
    assert.deepEqual(
      upserts.slice(1),
      ['{"v":"new"}'],
      'the stale value is not retried after the newer one',
    );
  });

  it('a row the database rejects for its data is dropped without blocking the others', async () => {
    const { pg, driver } = setup({ flushDelayMs: 10_000 });
    pg.onQuery = (q) => {
      if (q.sql.includes('INSERT') && (q.params[1] as string[]).includes('bad'))
        throw pgError('23514', 'check violation');
    };
    driver.write('t', 'good1', 1);
    driver.write('t', 'bad', 2);
    driver.write('t', 'good2', 3);
    await driver.flush(5_000);
    assert.equal(committed(pg, 't', 'good1'), 1);
    assert.equal(committed(pg, 't', 'good2'), 3);
    assert.equal(committed(pg, 't', 'bad'), undefined);
    assert.equal(driver.status().pending, 0);
    assert.equal(driver.status().consecutiveFailures, 0);
  });

  it('flush rejects at its deadline when the database stays down, and keeps the backlog', async () => {
    const { pg, driver } = setup({ maxBackoffMs: 5 });
    let down = true;
    pg.onQuery = (q) => {
      if (down && q.sql.trim() === 'BEGIN') throw pgError('08001', 'refused');
    };
    driver.write('t', 'k', 1);
    await assert.rejects(driver.flush(40), /Persistence flush incomplete: 1 row/);
    const s = driver.status();
    assert.equal(s.pending, 1);
    assert.ok(s.consecutiveFailures >= 1);
    assert.match(s.lastError ?? '', /^08001: /);
    down = false;
    await driver.close(5_000);
    assert.equal(committed(pg, 't', 'k'), 1);
  });
});

describe('db/driver — backpressure and serialisation', () => {
  it('reports saturated at the high-water mark and recovers after a flush', async () => {
    const { driver } = setup({ highWaterMark: 3, flushDelayMs: 10_000, batchSize: 100 });
    driver.write('t', '1', 1);
    driver.write('t', '2', 2);
    assert.equal(driver.status().saturated, false);
    driver.write('t', '3', 3);
    assert.equal(driver.status().saturated, true);
    assert.equal(driver.status().mode, 'postgres');
    await driver.flush();
    assert.equal(driver.status().saturated, false);
  });

  it('strips NUL characters from string values (jsonb rejects them)', async () => {
    const { pg, driver } = setup();
    driver.write('t', 'k', { text: 'a\u0000b', nested: ['x\u0000'] });
    await driver.flush();
    const json = (pg.queries.find((q) => q.sql.includes('INSERT'))!.params[2] as string[])[0];
    assert.ok(!json.includes('\\u0000'), json);
    assert.deepEqual(JSON.parse(json), { text: 'ab', nested: ['x'] });
  });

  // FINDING B-30 (db/driver.ts:63-66): serialise() strips NUL only from string
  // *values*; object *keys* keep it and JSON.stringify emits "\u0000", which
  // PostgreSQL jsonb rejects (SQLSTATE 22P05). User input reaches object keys:
  // POST /api/messages/:id/reactions accepts emoji "\u0000" (pattern /^\S+$/u
  // in routes/messaging.routes.ts:113 matches NUL), stored as
  // message.reactions["\u0000"]. Every later save of that message is then a
  // data error → `db.persist_dropped`: the message's state silently stops
  // persisting. Keys need the same treatment as values.
  it(
    'never sends a \\u0000 escape to jsonb, even inside object keys',
    async () => {
      const { pg, driver } = setup();
      driver.write('collab_messages', 'msg-1', { reactions: { '\u0000': ['m4'] } });
      await driver.flush();
      const json = (pg.queries.find((q) => q.sql.includes('INSERT'))!.params[2] as string[])[0];
      assert.ok(!json.includes('\\u0000'), json);
    },
  );
});
