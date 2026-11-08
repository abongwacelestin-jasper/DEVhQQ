/**
 * Minimal, ordered SQL migration runner.
 *
 *  - Migrations are `db/migrations/NNN_name.sql`, applied in lexical order,
 *    each in its own transaction together with its `schema_migrations` row.
 *  - A session-level advisory lock serialises concurrent boots/replicas: the
 *    second process waits, then finds nothing left to do.
 *  - Applied files are checksummed; editing an applied migration is a hard
 *    error (write a new migration instead).
 *  - When everything is already applied, the runner issues no DDL at all, so
 *    the least-privileged runtime role can boot against a migrated database.
 *
 * CLI: `npm run migrate` (uses DATABASE_MIGRATION_URL, falling back to DATABASE_URL).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { logger } from '../lib/logger.ts';

/** Arbitrary constant shared by every DevHQ process ("devhq-migrate"). */
const MIGRATION_LOCK_KEY = 7_220_418_331;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const FILE_PATTERN = /^(\d{3,})_[a-z0-9_]+\.sql$/;

interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationReport {
  applied: string[];
  alreadyApplied: number;
}

async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => FILE_PATTERN.test(n)).sort();
  const files: MigrationFile[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const version = FILE_PATTERN.exec(name)![1];
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version}`);
    seen.add(version);
    const sql = await readFile(join(dir, name), 'utf8');
    files.push({ version, name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return files;
}

export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<MigrationReport> {
  const files = await readMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const exists = await client.query<{ present: boolean }>(
        "SELECT to_regclass('schema_migrations') IS NOT NULL AS present",
      );
      if (!exists.rows[0].present) {
        await client.query(`
          CREATE TABLE schema_migrations (
            version    text        PRIMARY KEY,
            name       text        NOT NULL,
            checksum   text        NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
          )`);
      }
      const done = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      );
      const applied = new Map(done.rows.map((r) => [r.version, r.checksum]));

      for (const [version, checksum] of applied) {
        const file = files.find((f) => f.version === version);
        if (!file) {
          logger.warn('db.migration_unknown', { version, hint: 'applied but missing on disk' });
        } else if (file.checksum !== checksum) {
          throw new Error(
            `Migration ${file.name} was edited after it was applied (checksum mismatch). ` +
              'Never edit an applied migration — add a new one.',
          );
        }
      }

      const report: MigrationReport = { applied: [], alreadyApplied: applied.size };
      for (const file of files) {
        if (applied.has(file.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(file.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [file.version, file.name, file.checksum],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file.name} failed: ${String(err)}`, { cause: err });
        }
        report.applied.push(file.name);
        logger.info('db.migration_applied', { migration: file.name });
      }
      return report;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Keeps a year of monthly partitions ahead for the append-heavy tables. Needs
 * DDL rights, so it runs on the migration connection; with a DML-only runtime
 * role it fails harmlessly (rows land in the DEFAULT partition until the next
 * `npm run migrate`, which calls this as well).
 */
export async function ensurePartitions(pool: Pool): Promise<void> {
  try {
    await pool.query(
      `SELECT devhq_ensure_monthly_partitions('task_events', now()::date, 12),
              devhq_ensure_monthly_partitions('notifications', now()::date, 12)`,
    );
  } catch (err) {
    logger.warn('db.partitions_not_extended', { err: String(err) });
  }
}

// CLI entry point: `npm run migrate`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createPool, redactUrl } = await import('./pool.ts');
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_MIGRATION_URL (preferred) or DATABASE_URL');
    process.exit(2);
  }
  const pool = createPool(url, 'migrate');
  try {
    const report = await migrate(pool);
    await ensurePartitions(pool);
    console.log(
      `${redactUrl(url)}: applied ${report.applied.length} migration(s)` +
        (report.applied.length ? ` (${report.applied.join(', ')})` : '') +
        `, ${report.alreadyApplied} already applied`,
    );
  } catch (err) {
    console.error(String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
