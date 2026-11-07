/**
 * Mirrors the tamper-evident audit chain into the append-only `audit_entries`
 * table. It listens on the in-process event bus (audit/auditLog.ts publishes
 * every entry as an `audit` event), so the audit module itself is unchanged.
 *
 * Inserts are batched, retried with backoff, and flushed on shutdown. Each
 * process boot is identified by `chain_id`; since v2.1 a boot continues the
 * stored chain (its first row links to the newest row by `prev_hash`, with
 * `seq` continued), so `pgAuditSource()` reads the table back in insertion
 * order for resume and end-to-end verification (ADR 0008 addendum).
 */

import { randomUUID } from 'node:crypto';
import type { Client, Pool } from 'pg';
import type { AuditSource, ChainHead, StoredRecord } from '../audit/chain.ts';
import { subscribe } from '../lib/events.ts';
import { logger } from '../lib/logger.ts';

interface Row {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive: boolean;
  requestId: string | null;
  prevHash: string;
  hash: string;
}

const INSERT_SQL = `
  INSERT INTO audit_entries
    (chain_id, seq, at, actor, action, target, sensitive, request_id, prev_hash, hash)
  SELECT $1, s, a, ac, act, t, sen, r, p, h
  FROM unnest($2::bigint[], $3::timestamptz[], $4::text[], $5::text[], $6::text[],
              $7::boolean[], $8::text[], $9::text[], $10::text[])
       AS u(s, a, ac, act, t, sen, r, p, h)
  ON CONFLICT (hash) DO NOTHING`;

/** Far above any realistic outage backlog; past it the oldest rows are dropped loudly. */
const MAX_QUEUE = 50_000;

function toRow(d: Record<string, unknown>): Row | null {
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  const seq = d.seq;
  const at = str('at');
  const actor = str('actor');
  const action = str('action');
  const target = str('target');
  const prevHash = str('prevHash');
  const hash = str('hash');
  if (typeof seq !== 'number' || !at || !actor || !action || target === null) return null;
  if (!prevHash || !hash) return null;
  return {
    seq,
    at,
    actor,
    action,
    target,
    sensitive: d.sensitive === true,
    requestId: str('requestId'),
    prevHash,
    hash,
  };
}

export function startAuditSink(pool: Pool) {
  const chainId = randomUUID();
  const queue: Row[] = [];
  let running: Promise<void> | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPersisted: ChainHead | null = null;

  async function drainOnce(): Promise<boolean> {
    const batch = queue.slice(0, 500);
    if (!batch.length) return true;
    try {
      await pool.query(INSERT_SQL, [
        chainId,
        batch.map((r) => r.seq),
        batch.map((r) => r.at),
        batch.map((r) => r.actor),
        batch.map((r) => r.action),
        batch.map((r) => r.target),
        batch.map((r) => r.sensitive),
        batch.map((r) => r.requestId),
        batch.map((r) => r.prevHash),
        batch.map((r) => r.hash),
      ]);
      queue.splice(0, batch.length);
      const last = batch[batch.length - 1];
      lastPersisted = { seq: last.seq, hash: last.hash };
      failures = 0;
      return true;
    } catch (err) {
      failures += 1;
      logger.error('db.audit_persist_failed', {
        attempt: failures,
        pending: queue.length,
        err: String(err),
      });
      return false;
    }
  }

  function schedule(delayMs: number) {
    if (timer || running) return;
    timer = setTimeout(() => {
      timer = null;
      running = drainOnce().then((ok) => {
        running = null;
        if (queue.length) schedule(ok ? 0 : Math.min(30_000, 100 * 2 ** Math.min(failures, 9)));
      });
    }, delayMs);
    timer.unref();
  }

  const unsubscribe = subscribe((e) => {
    if (e.type !== 'audit') return;
    const row = toRow(e.data);
    if (!row) return;
    queue.push(row);
    if (queue.length > MAX_QUEUE) {
      const dropped = queue.splice(0, queue.length - MAX_QUEUE);
      logger.error('db.audit_backlog_dropped', { dropped: dropped.length });
    }
    schedule(25);
  });

  return {
    chainId,
    pending: () => queue.length,
    /** The newest entry this process has committed to `audit_entries`. */
    lastPersisted: () => lastPersisted,
    async close(timeoutMs = 5_000) {
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
      const deadline = Date.now() + timeoutMs;
      if (running) await running;
      while (queue.length && Date.now() < deadline) {
        if (!(await drainOnce())) await new Promise((r) => setTimeout(r, 200));
      }
      if (queue.length) logger.error('db.audit_flush_incomplete', { pending: queue.length });
    },
  };
}

const SCAN_SQL = `
  SELECT id::text AS id, chain_id, seq, at, actor, action, target, sensitive,
         request_id, prev_hash, hash
  FROM audit_entries
  WHERE audit_entries.id > $1::bigint
  ORDER BY audit_entries.id -- the bigint column, not the text alias (that would sort 1, 10, 2…)
  LIMIT $2`;

const SCAN_PAGE = 5_000;

/**
 * `audit_entries` as an AuditSource: every row in insertion (`id`) order,
 * paged by keyset so memory stays bounded. Parents always precede children
 * in this order (a boot reads the head before inserting rows that link to it).
 */
export function pgAuditSource(
  pool: Pick<Pool, 'query'> | Pick<Client, 'query'>,
  sink?: { lastPersisted(): ChainHead | null },
): AuditSource {
  return {
    kind: 'postgres',
    async *scan(): AsyncGenerator<StoredRecord> {
      let after = '0';
      for (;;) {
        const res = await (pool as Pick<Pool, 'query'>).query<
          Record<string, unknown> & { id: string }
        >(SCAN_SQL, [after, SCAN_PAGE]);
        for (const row of res.rows) yield { raw: row, position: Number(row.id) };
        if (res.rows.length < SCAN_PAGE) return;
        after = String(res.rows[res.rows.length - 1].id);
      }
    },
    ...(sink ? { expectedHead: () => sink.lastPersisted() } : {}),
  };
}
