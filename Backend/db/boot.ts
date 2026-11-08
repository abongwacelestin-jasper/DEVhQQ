/**
 * Persistence boot sequence, called once from `buildApp()`.
 *
 * Without DATABASE_URL: today's in-memory behaviour (seed and go).
 * With DATABASE_URL:
 *   1. run migrations (DATABASE_MIGRATION_URL if set — the DDL-capable role),
 *   2. create the coming months' partitions (task_events, notifications),
 *   3. install the PostgreSQL CollectionDriver (collections still on the
 *      JSONB seam) and the relational repositories (data/, ADR 0011) — the
 *      repositories dual-write a JSONB copy into `documents` unless
 *      DATA_DUAL_WRITE=0, so rolling back to the previous build loses nothing,
 *   4. under an advisory lock: backfill any migrated table that is still
 *      empty (db/backfill.ts), hydrateAll() — every *registered* collection is
 *      loaded into memory (migrated data is not: it is queried on demand) —
 *      and seed demo data only when NODE_ENV !== 'production' AND the database
 *      is empty. The seed is flushed before the lock is released, so two
 *      replicas booting against an empty database cannot both seed.
 * The audit chain is mirrored into the append-only `audit_entries` table
 * (db/auditSink.ts). Before anything else is audited, the boot resumes the
 * stored chain (ADR 0008 addendum): from `audit_entries` with DATABASE_URL,
 * else from the JSONL file (AUDIT_LOG_FILE).
 */

import type { Pool } from 'pg';
import { audit, type Continuity } from '../audit/auditLog.ts';
import { fileSource } from '../audit/fileSource.ts';
import { logger } from '../lib/logger.ts';
import { flushPending, hydrateAll, setDriver } from '../store/collection.ts';
import { installRepositories, pgRepositories } from '../data/index.ts';
import { noMirror, type DocumentMirror } from '../data/common.ts';
import { pgAuditSource, startAuditSink } from './auditSink.ts';
import { backfillIfNeeded, formatReport } from './backfill.ts';
import { PgCollectionDriver } from './driver.ts';
import { ensurePartitions, migrate } from './migrate.ts';
import { createPool, redactUrl } from './pool.ts';

const SEED_LOCK_KEY = 7_220_418_332;

export interface PersistenceReport {
  mode: 'memory' | 'postgres';
  migrationsApplied?: string[];
  hydrated?: Record<string, number>;
  /** Migrated collections copied from `documents` by this boot (normally none). */
  backfilled?: string[];
  seeded: boolean;
  audit: Continuity;
}

function logContinuity(c: Continuity) {
  if (c.status === 'discontinuity') logger.error('audit.chain_discontinuity', { ...c });
  else
    logger.info('audit.chain', { source: c.source, status: c.status, resumedFrom: c.resumedFrom });
}

let pool: Pool | null = null;
let driver: PgCollectionDriver | null = null;
let auditSink: ReturnType<typeof startAuditSink> | null = null;

export async function initPersistence(seed: () => Promise<void>): Promise<PersistenceReport> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const chain = await audit.resume(fileSource(audit.file, () => audit.fileWrittenHead()));
    logContinuity(chain);
    await seed();
    return { mode: 'memory', seeded: true, audit: chain };
  }
  if (pool) throw new Error('Persistence already initialised');

  const migrationUrl = process.env.DATABASE_MIGRATION_URL || url;
  const migrationPool = migrationUrl === url ? null : createPool(migrationUrl, 'migrate');
  pool = createPool(url, 'runtime');
  let migrationsApplied: string[];
  try {
    migrationsApplied = (await migrate(migrationPool ?? pool)).applied;
    await ensurePartitions(migrationPool ?? pool);
  } finally {
    await migrationPool?.end();
  }

  driver = new PgCollectionDriver(pool);
  setDriver(driver);
  const d = driver;
  const mirror: DocumentMirror =
    process.env.DATA_DUAL_WRITE === '0'
      ? noMirror
      : { write: (c, k, v) => d.write(c, k, v), remove: (c, k) => d.remove(c, k) };
  installRepositories(pgRepositories(pool, mirror));
  auditSink = startAuditSink(pool);
  const chain = await audit.resume(pgAuditSource(pool, auditSink));
  logContinuity(chain);

  const allowSeed = process.env.NODE_ENV !== 'production';
  let seeded = false;
  let hydrated: Record<string, number> = {};
  let backfilled: string[] = [];
  const client = await pool.connect();
  try {
    // Hydrate under the seed lock so a replica never loads a half-seeded database.
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
    try {
      const reports = await backfillIfNeeded(pool);
      for (const r of reports)
        if (r.ok) logger.info('db.backfill', { report: formatReport(r) });
        else logger.error('db.backfill_incomplete', { report: formatReport(r) });
      backfilled = reports.map((r) => r.collection);
      hydrated = await hydrateAll();
      const res = await client.query<{ empty: boolean }>(
        `SELECT NOT EXISTS (SELECT 1 FROM documents) AND NOT EXISTS (SELECT 1 FROM members)
           AS empty`,
      );
      if (res.rows[0].empty && allowSeed) {
        await seed();
        await flushPending(30_000);
        seeded = true;
      } else if (res.rows[0].empty) {
        logger.warn('db.empty_production', {
          hint: 'No data and seeding is disabled in production — provision the first Owner',
        });
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  logger.info('db.ready', {
    url: redactUrl(url),
    migrationsApplied,
    rows: Object.values(hydrated).reduce((a, b) => a + b, 0),
    backfilled,
    seeded,
  });
  return { mode: 'postgres', migrationsApplied, hydrated, backfilled, seeded, audit: chain };
}

/** Lightweight connectivity probe for readiness checks. */
export async function pingDatabase(timeoutMs = 2_000): Promise<boolean> {
  if (!pool) return true; // memory mode: nothing to reach
  const active = pool;
  const probe = active.query('SELECT 1').then(
    () => true,
    () => false,
  );
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs).unref());
  return Promise.race([probe, timeout]);
}

/** Flushes queued writes and closes the pool. Safe to call more than once. */
export async function closePersistence(timeoutMs = 8_000): Promise<void> {
  if (!pool || !driver) return;
  const p = pool;
  const d = driver;
  const a = auditSink;
  pool = null;
  driver = null;
  auditSink = null;
  try {
    await d.close(timeoutMs);
  } finally {
    await a?.close();
    await p.end();
  }
}
