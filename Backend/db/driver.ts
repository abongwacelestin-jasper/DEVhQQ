/**
 * PostgreSQL CollectionDriver — write-behind persistence for store/collection.ts.
 *
 * Handlers stay synchronous: `write`/`remove` only enqueue. A single flusher
 * drains the queue in batches, one transaction per batch, so:
 *
 *  - Per-key ordering: the queue holds at most one pending op per
 *    (collection, key) — a newer op replaces an older one (last write wins,
 *    a delete after a write stays a delete). Only one batch is ever in flight,
 *    so an older value can never commit after a newer one.
 *  - Value snapshots: rows are serialised at enqueue time, so a later
 *    mutation without `save()` never leaks into an earlier write.
 *  - Bounded memory / backpressure: because ops coalesce per key, the backlog
 *    can never exceed the number of distinct rows. Past `highWaterMark` the
 *    driver reports `saturated` (readiness should fail so the edge sheds
 *    traffic) and logs loudly.
 *  - Retry: a failed batch is re-queued (unless a newer op for the same key
 *    arrived meanwhile) and retried with capped exponential backoff + jitter.
 *    A batch rejected for its *data* (SQLSTATE class 22/23) is split and
 *    retried row by row; a single row the database permanently rejects is
 *    logged as `db.persist_dropped` instead of blocking every other write.
 *
 * All SQL is parameterised; batches use `unnest` over typed arrays.
 */

import type { Pool } from 'pg';
import type { CollectionDriver, LoadOptions, PersistenceStatus } from '../store/collection.ts';
import { logger } from '../lib/logger.ts';

type Op =
  | { kind: 'write'; collection: string; key: string; json: string }
  | { kind: 'remove'; collection: string; key: string };

export interface PgDriverOptions {
  /** Max ops per transaction. */
  batchSize?: number;
  /** Coalescing delay before a flush starts. */
  flushDelayMs?: number;
  /** Backlog size at which the driver reports `saturated`. */
  highWaterMark?: number;
  maxBackoffMs?: number;
}

const UPSERT_SQL = `
  INSERT INTO documents (collection, key, data, updated_at)
  SELECT c, k, d::jsonb, clock_timestamp()
  FROM unnest($1::text[], $2::text[], $3::text[]) AS t(c, k, d)
  ON CONFLICT (collection, key)
  DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;

const DELETE_SQL = `
  DELETE FROM documents AS doc
  USING unnest($1::text[], $2::text[]) AS t(c, k)
  WHERE doc.collection = t.c AND doc.key = t.k`;

const LOAD_SQL = `
  SELECT key, data FROM documents
  WHERE collection = $1
  ORDER BY updated_at DESC, key
  LIMIT $2`;

const stripNul = (s: string) => (s.includes('\u0000') ? s.replaceAll('\u0000', '') : s);

/**
 * jsonb rejects NUL characters; strip them from string values *and* object keys
 * rather than poison a batch (FINDING B-30).
 */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'string') return stripNul(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.some((k) => k.includes('\u0000')))
        return Object.fromEntries(
          keys.map((k) => [stripNul(k), (v as Record<string, unknown>)[k]]),
        );
    }
    return v;
  });
}

function sqlState(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/** Errors caused by the row itself (bad data / constraint), not by the connection. */
function isDataError(err: unknown): boolean {
  const code = sqlState(err);
  return code.startsWith('22') || code.startsWith('23');
}

const opId = (collection: string, key: string) => `${collection}\u0000${key}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PgCollectionDriver implements CollectionDriver {
  private readonly pool: Pool;
  private readonly batchSize: number;
  private readonly flushDelayMs: number;
  private readonly highWaterMark: number;
  private readonly maxBackoffMs: number;

  private readonly pending = new Map<string, Op>();
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private saturatedLogged = false;
  private lastError: string | undefined;
  private lastFlushAt: string | undefined;
  private closed = false;

  constructor(pool: Pool, opts: PgDriverOptions = {}) {
    this.pool = pool;
    this.batchSize = opts.batchSize ?? 500;
    this.flushDelayMs = opts.flushDelayMs ?? 20;
    this.highWaterMark = opts.highWaterMark ?? 20_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  }

  write(collection: string, key: string, value: unknown): void {
    this.enqueue({ kind: 'write', collection, key, json: serialise(value) });
  }

  remove(collection: string, key: string): void {
    this.enqueue({ kind: 'remove', collection, key });
  }

  async load(collection: string, opts: LoadOptions = {}): Promise<[string, unknown][]> {
    const res = await this.pool.query<{ key: string; data: unknown }>(LOAD_SQL, [
      collection,
      opts.limit ?? null,
    ]);
    return res.rows.map((r) => [r.key, r.data]);
  }

  status(): PersistenceStatus {
    return {
      mode: 'postgres',
      pending: this.pending.size,
      saturated: this.pending.size >= this.highWaterMark,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      lastFlushAt: this.lastFlushAt,
    };
  }

  /** Drains the queue. Rejects if it cannot be drained before the deadline. */
  async flush(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    this.clearTimer();
    while (this.pending.size > 0 || this.inFlight) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      const ok = await this.runOnce();
      if (!ok) {
        const wait = Math.min(this.backoffMs(), deadline - Date.now());
        if (wait <= 0) break;
        await sleep(wait);
      }
      if (Date.now() >= deadline) break;
    }
    this.clearTimer();
    if (this.pending.size > 0) {
      logger.error('db.flush_incomplete', {
        pending: this.pending.size,
        lastError: this.lastError,
      });
      // Keep retrying in the background; the caller decides whether to exit.
      this.schedule(this.backoffMs());
      throw new Error(`Persistence flush incomplete: ${this.pending.size} row(s) not written`);
    }
  }

  /** Flushes and stops accepting background flush scheduling. */
  async close(timeoutMs?: number): Promise<void> {
    try {
      await this.flush(timeoutMs);
    } finally {
      this.closed = true;
      this.clearTimer();
    }
  }

  // ---------------------------------------------------------------------------

  private enqueue(op: Op) {
    const id = opId(op.collection, op.key);
    // Re-insert so iteration order follows the most recent change.
    this.pending.delete(id);
    this.pending.set(id, op);
    if (this.pending.size >= this.highWaterMark && !this.saturatedLogged) {
      this.saturatedLogged = true;
      logger.error('db.backlog_saturated', {
        pending: this.pending.size,
        highWaterMark: this.highWaterMark,
        lastError: this.lastError,
      });
    }
    this.schedule(this.pending.size >= this.batchSize ? 0 : this.flushDelayMs);
  }

  private schedule(delayMs: number) {
    if (this.closed || this.timer || this.inFlight) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce().then((ok) => {
        if (this.pending.size > 0) this.schedule(ok ? 0 : this.backoffMs());
      });
    }, delayMs);
    // Never keep the process alive just for the flusher: shutdown awaits flush().
    this.timer.unref();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private backoffMs(): number {
    const base = Math.min(this.maxBackoffMs, 100 * 2 ** Math.min(this.failures, 16));
    return Math.round(base / 2 + Math.random() * (base / 2));
  }

  /** Runs one batch. Returns false if it failed (ops were re-queued). */
  private runOnce(): Promise<boolean> {
    if (this.inFlight || this.pending.size === 0) return Promise.resolve(true);
    const batch: Op[] = [];
    for (const [id, op] of this.pending) {
      batch.push(op);
      this.pending.delete(id);
      if (batch.length >= this.batchSize) break;
    }
    let ok = true;
    const run = this.commit(batch)
      .then(() => this.onSuccess())
      .catch(async (err: unknown) => {
        if (isDataError(err) && batch.length > 1) {
          // Find the offending row(s) without blocking the healthy ones.
          try {
            await this.commitIndividually(batch);
            this.onSuccess();
          } catch (connErr) {
            ok = false;
            this.onFailure(connErr, []); // unprocessed rows were already re-queued
          }
          return;
        }
        ok = false;
        this.onFailure(err, batch);
      });
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight.then(() => ok);
  }

  private async commitIndividually(batch: Op[]) {
    for (let i = 0; i < batch.length; i++) {
      const op = batch[i];
      try {
        await this.commit([op]);
      } catch (err) {
        if (isDataError(err)) {
          logger.error('db.persist_dropped', {
            collection: op.collection,
            key: op.key,
            op: op.kind,
            code: sqlState(err),
            err: String(err),
          });
        } else {
          this.requeue(batch.slice(i));
          throw err;
        }
      }
    }
  }

  private async commit(batch: Op[]) {
    const writes = batch.filter((o): o is Extract<Op, { kind: 'write' }> => o.kind === 'write');
    const removes = batch.filter((o) => o.kind === 'remove');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (writes.length)
        await client.query(UPSERT_SQL, [
          writes.map((w) => w.collection),
          writes.map((w) => w.key),
          writes.map((w) => w.json),
        ]);
      if (removes.length)
        await client.query(DELETE_SQL, [
          removes.map((r) => r.collection),
          removes.map((r) => r.key),
        ]);
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch {
        // The connection itself is broken: discard it instead of returning it to the pool.
        client.release(true);
      }
      throw err;
    }
  }

  private onSuccess() {
    if (this.failures > 0)
      logger.info('db.persist_recovered', {
        afterFailures: this.failures,
        pending: this.pending.size,
      });
    this.failures = 0;
    this.lastError = undefined;
    this.lastFlushAt = new Date().toISOString();
    if (this.pending.size < this.highWaterMark) this.saturatedLogged = false;
  }

  private onFailure(err: unknown, batch: Op[]) {
    this.failures += 1;
    this.lastError = `${sqlState(err) || 'conn'}: ${String(err)}`;
    this.requeue(batch);
    logger.error('db.persist_failed', {
      attempt: this.failures,
      batch: batch.length,
      pending: this.pending.size,
      code: sqlState(err),
      err: String(err),
    });
  }

  /** Puts failed ops back unless a newer op for the same row arrived meanwhile. */
  private requeue(batch: Op[]) {
    const newer = new Map(this.pending);
    this.pending.clear();
    for (const op of batch) {
      const id = opId(op.collection, op.key);
      if (!newer.has(id)) this.pending.set(id, op);
    }
    for (const [id, op] of newer) this.pending.set(id, op);
  }
}
