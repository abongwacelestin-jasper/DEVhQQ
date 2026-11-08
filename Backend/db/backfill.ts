/**
 * Backfill: copies the migrated collections from the JSONB `documents` table
 * into their relational tables (ADR 0011, migration step 2), then verifies.
 *
 * Each collection is one `INSERT … SELECT … FROM documents` in its own
 * transaction, parents first (members → sessions → tasks → events, comments →
 * notifications), so it is fast and never half-applies a collection.
 *
 * Modes:
 *   fill    (default) insert rows that are missing; existing rows win
 *           (`ON CONFLICT DO NOTHING`). Idempotent: a second run inserts 0.
 *   resync  documents win: upsert every row and delete table rows that have
 *           no document. Only for rolling forward again after a rollback
 *           (the previous build wrote only to `documents`); run it with the
 *           API stopped.
 *
 * Verification, per collection: documents rows, table rows, and `missing` —
 * documents whose key has no table row. Rows that cannot move are reported,
 * not silently dropped: revoked sessions (never valid again), and orphans
 * whose parent row does not exist (e.g. a task assigned to an unknown member).
 *
 * CLI: `npm run backfill [-- --resync] [-- --verify-only]` (DATABASE_MIGRATION_URL,
 * else DATABASE_URL). Exits 1 if any collection has unexplained missing rows.
 * Boot runs `fill` automatically for any migrated table that is still empty
 * while `documents` holds rows for it (db/boot.ts).
 */

import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { ORG_ID } from '../data/common.ts';
import type { MigratedCollection } from '../data/index.ts';
import { MIGRATED } from '../data/index.ts';

export type BackfillMode = 'fill' | 'resync';

export interface CollectionReport {
  collection: MigratedCollection;
  table: string;
  documents: number;
  inserted: number;
  /** Rows deleted from the table because no document exists (resync only). */
  deleted: number;
  tableRows: number;
  /** Documents with no table row after the copy. */
  missing: number;
  /** Of `missing`: rows that are intentionally not copied (revoked sessions). */
  skipped: number;
  /** Of `missing`: rows whose parent (member / task) does not exist. */
  orphans: number;
  ok: boolean;
}

interface Spec {
  table: string;
  keyColumn: string;
  columns: string[];
  /** SELECT expressions over `d.data`, aligned with `columns` (after org_id and key). */
  select: string[];
  known: string[];
  /** Extra WHERE (parents exist). */
  parents?: string;
  /** Documents that are deliberately not copied. */
  skip?: string;
}

const bigint = (f: string) => `(d.data->>'${f}')::numeric::bigint`;
const jsonOrNull = (f: string) => `NULLIF(d.data->'${f}', 'null'::jsonb)`;
const member = (expr: string) =>
  `EXISTS (SELECT 1 FROM members p WHERE p.org_id = $1 AND p.id = ${expr})`;
const task = (expr: string) =>
  `EXISTS (SELECT 1 FROM tasks p WHERE p.org_id = $1 AND p.key = ${expr})`;

const SPECS: Record<MigratedCollection, Spec> = {
  members: {
    table: 'members',
    keyColumn: 'id',
    columns: [
      'name',
      'email',
      'role',
      'products',
      'status',
      'password_hash',
      'totp_secret',
      'backup_codes',
      'passkeys',
      'failed_logins',
      'locked_until',
      'invite_token_hash',
      'invite_expires_at',
      'nda_signed_at',
      'nda_version',
      'profile',
      'offboarding',
    ],
    select: [
      "d.data->>'name'",
      "d.data->>'email'",
      "d.data->>'role'",
      "COALESCE(ARRAY(SELECT jsonb_array_elements_text(d.data->'products')), '{}')",
      "d.data->>'status'",
      "d.data->>'passwordHash'",
      "d.data->>'totpSecret'",
      jsonOrNull('backupCodes'),
      "COALESCE(NULLIF(d.data->'passkeys', 'null'::jsonb), '[]'::jsonb)",
      "COALESCE((d.data->>'failedLogins')::int, 0)",
      bigint('lockedUntil'),
      "d.data->>'inviteTokenHash'",
      bigint('inviteExpiresAt'),
      "d.data->>'ndaSignedAt'",
      "d.data->>'ndaVersion'",
      jsonOrNull('profile'),
      jsonOrNull('offboarding'),
    ],
    known: [
      'id',
      'name',
      'email',
      'role',
      'products',
      'status',
      'passwordHash',
      'totpSecret',
      'backupCodes',
      'passkeys',
      'failedLogins',
      'lockedUntil',
      'inviteTokenHash',
      'inviteExpiresAt',
      'ndaSignedAt',
      'ndaVersion',
      'profile',
      'offboarding',
    ],
  },
  sessions: {
    table: 'sessions',
    keyColumn: 'id',
    columns: [
      'member_id',
      'stage',
      'method',
      'created_at',
      'last_seen_at',
      'verified_at',
      'ua_hash',
      'client',
      'ip',
      'location',
      'last_totp_counter',
    ],
    select: [
      "d.data->>'memberId'",
      "d.data->>'stage'",
      "d.data->>'method'",
      bigint('createdAt'),
      bigint('lastSeenAt'),
      `COALESCE(${bigint('verifiedAt')}, 0)`,
      "d.data->>'uaHash'",
      "COALESCE(d.data->>'client', 'Client')",
      "d.data->>'ip'",
      "COALESCE(NULLIF(d.data->'location', 'null'::jsonb), '{}'::jsonb)",
      `COALESCE(${bigint('lastTotpCounter')}, -1)`,
    ],
    known: [
      'id',
      'memberId',
      'stage',
      'createdAt',
      'lastSeenAt',
      'verifiedAt',
      'uaHash',
      'client',
      'ip',
      'location',
      'revoked',
      'method',
      'lastTotpCounter',
    ],
    parents: member("d.data->>'memberId'"),
    skip: "COALESCE((d.data->>'revoked')::boolean, false)",
  },
  tasks: {
    table: 'tasks',
    keyColumn: 'key',
    columns: [
      'title',
      'product',
      'project_id',
      'type',
      'status',
      'priority',
      'assignee',
      'reviewer',
      'due',
      'estimate',
      'description',
      'pr',
      'blocked_by',
      'created_by',
      'created_at',
      'updated_at',
    ],
    select: [
      "d.data->>'title'",
      "d.data->>'product'",
      "d.data->>'projectId'",
      "d.data->>'type'",
      "d.data->>'status'",
      "d.data->>'priority'",
      "d.data->>'assignee'",
      "d.data->>'reviewer'",
      "(d.data->>'due')::date",
      "(d.data->>'estimate')::numeric::int",
      "d.data->>'description'",
      "(d.data->>'pr')::numeric::int",
      "d.data->>'blockedBy'",
      "COALESCE(d.data->>'createdBy', 'system')",
      "COALESCE((d.data->>'createdAt')::timestamptz, d.updated_at)",
      "COALESCE((d.data->>'updatedAt')::timestamptz, d.updated_at)",
    ],
    known: [
      'key',
      'title',
      'product',
      'projectId',
      'type',
      'status',
      'priority',
      'assignee',
      'reviewer',
      'due',
      'estimate',
      'description',
      'pr',
      'blockedBy',
      'createdBy',
      'createdAt',
      'updatedAt',
    ],
    parents: `${member("d.data->>'assignee'")} AND (d.data->>'reviewer' IS NULL OR ${member("d.data->>'reviewer'")})`,
  },
  taskEvents: {
    table: 'task_events',
    keyColumn: 'id',
    columns: ['task_key', 'actor', 'at', 'kind', 'from_value', 'to_value', 'note'],
    select: [
      "d.data->>'taskKey'",
      "COALESCE(d.data->>'actor', 'system')",
      "COALESCE((d.data->>'at')::timestamptz, d.updated_at)",
      "d.data->>'kind'",
      "d.data->>'from'",
      "d.data->>'to'",
      "d.data->>'note'",
    ],
    known: ['id', 'taskKey', 'actor', 'at', 'kind', 'from', 'to', 'note'],
    parents: task("d.data->>'taskKey'"),
  },
  taskComments: {
    table: 'task_comments',
    keyColumn: 'id',
    columns: ['task_key', 'author', 'text', 'at'],
    select: [
      "d.data->>'taskKey'",
      "d.data->>'author'",
      "d.data->>'text'",
      "COALESCE((d.data->>'at')::timestamptz, d.updated_at)",
    ],
    known: ['id', 'taskKey', 'author', 'text', 'at'],
    parents: task("d.data->>'taskKey'"),
  },
  collab_notifications: {
    table: 'notifications',
    keyColumn: 'id',
    columns: [
      'member_id',
      'kind',
      'title',
      'body',
      'link',
      'ref_id',
      'actor',
      'at',
      'read_at',
      'emailed_at',
    ],
    select: [
      "d.data->>'memberId'",
      "d.data->>'kind'",
      "COALESCE(d.data->>'title', '')",
      "COALESCE(d.data->>'body', '')",
      "COALESCE(d.data->>'link', '')",
      "COALESCE(d.data->>'refId', '')",
      "COALESCE(d.data->>'actor', 'system')",
      "COALESCE((d.data->>'at')::timestamptz, d.updated_at)",
      "(d.data->>'readAt')::timestamptz",
      "(d.data->>'emailedAt')::timestamptz",
    ],
    known: [
      'id',
      'memberId',
      'kind',
      'title',
      'body',
      'link',
      'refId',
      'actor',
      'at',
      'readAt',
      'emailedAt',
    ],
    parents: member("d.data->>'memberId'"),
  },
};

function copySql(name: MigratedCollection, mode: BackfillMode): string {
  const s = SPECS[name];
  const cols = ['org_id', s.keyColumn, ...s.columns, 'extra'];
  const known = `ARRAY[${s.known.map((k) => `'${k}'`).join(', ')}]::text[]`;
  const exprs = ['$1', 'd.key', ...s.select, `d.data - ${known}`];
  const filters = [`d.collection = '${name}'`];
  if (s.parents) filters.push(s.parents);
  if (s.skip) filters.push(`NOT (${s.skip})`);
  const conflict =
    mode === 'fill'
      ? 'ON CONFLICT DO NOTHING'
      : `ON CONFLICT (org_id, ${s.keyColumn}${name === 'taskEvents' || name === 'collab_notifications' ? ', at' : ''})
         DO UPDATE SET ${[...s.columns, 'extra'].map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;
  return `INSERT INTO ${s.table} (${cols.join(', ')})
    SELECT ${exprs.join(', ')} FROM documents d
    WHERE ${filters.join(' AND ')}
    ORDER BY d.updated_at, d.key
    ${conflict}`;
}

async function count(pool: Pool, sql: string, args: unknown[]): Promise<number> {
  const res = await pool.query<{ n: string }>(sql, args);
  return Number(res.rows[0]?.n ?? 0);
}

async function verify(
  pool: Pool,
  name: MigratedCollection,
): Promise<Omit<CollectionReport, 'inserted' | 'deleted'>> {
  const s = SPECS[name];
  const documents = await count(
    pool,
    'SELECT count(*)::text AS n FROM documents WHERE collection = $1',
    [name],
  );
  const tableRows = await count(pool, `SELECT count(*)::text AS n FROM ${s.table} WHERE org_id = $1`, [
    ORG_ID,
  ]);
  const missingCond = `d.collection = '${name}' AND NOT EXISTS (
      SELECT 1 FROM ${s.table} t WHERE t.org_id = $1 AND t.${s.keyColumn} = d.key)`;
  const missing = await count(
    pool,
    `SELECT count(*)::text AS n FROM documents d WHERE ${missingCond}`,
    [ORG_ID],
  );
  const skipped = s.skip
    ? await count(
        pool,
        `SELECT count(*)::text AS n FROM documents d WHERE ${missingCond} AND (${s.skip})`,
        [ORG_ID],
      )
    : 0;
  const orphans = s.parents
    ? await count(
        pool,
        `SELECT count(*)::text AS n FROM documents d WHERE ${missingCond} AND NOT (${s.parents})${
          s.skip ? ` AND NOT (${s.skip})` : ''
        }`,
        [ORG_ID],
      )
    : 0;
  return {
    collection: name,
    table: s.table,
    documents,
    tableRows,
    missing,
    skipped,
    orphans,
    ok: missing - skipped - orphans === 0,
  };
}

/** Copies (and verifies) the given collections. Each collection is one transaction. */
export async function backfill(
  pool: Pool,
  opts: { mode?: BackfillMode; collections?: readonly MigratedCollection[]; verifyOnly?: boolean } = {},
): Promise<CollectionReport[]> {
  const mode = opts.mode ?? 'fill';
  const wanted = opts.collections ?? MIGRATED;
  const reports: CollectionReport[] = [];
  // Parents first on insert; on resync, children are pruned before parents.
  const order = MIGRATED.filter((c) => wanted.includes(c));
  const deleted = new Map<MigratedCollection, number>();
  if (mode === 'resync' && !opts.verifyOnly) {
    for (const name of [...order].reverse()) {
      const s = SPECS[name];
      const res = await pool.query(
        `DELETE FROM ${s.table} t WHERE t.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM documents d WHERE d.collection = $2 AND d.key = t.${s.keyColumn})`,
        [ORG_ID, name],
      );
      deleted.set(name, res.rowCount ?? 0);
    }
  }
  for (const name of order) {
    let inserted = 0;
    if (!opts.verifyOnly) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(copySql(name, mode), [ORG_ID]);
        inserted = res.rowCount ?? 0;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Backfill of ${name} failed: ${String(err)}`, { cause: err });
      } finally {
        client.release();
      }
    }
    reports.push({ ...(await verify(pool, name)), inserted, deleted: deleted.get(name) ?? 0 });
  }
  return reports;
}

/**
 * Boot-time step: fills any migrated table that is still empty while
 * `documents` has rows for its collection (the first boot after upgrading).
 * Returns the reports of the collections it copied (empty when nothing to do).
 */
export async function backfillIfNeeded(pool: Pool): Promise<CollectionReport[]> {
  const todo: MigratedCollection[] = [];
  for (const name of MIGRATED) {
    const s = SPECS[name];
    const res = await pool.query<{ need: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM documents WHERE collection = $2)
          AND NOT EXISTS (SELECT 1 FROM ${s.table} WHERE org_id = $1) AS need`,
      [ORG_ID, name],
    );
    if (res.rows[0]?.need) todo.push(name);
  }
  return todo.length ? backfill(pool, { collections: todo }) : [];
}

export function formatReport(r: CollectionReport): string {
  return (
    `${r.ok ? '✓' : '✗'} ${r.collection.padEnd(22)} → ${r.table.padEnd(14)} ` +
    `documents=${r.documents} table=${r.tableRows} inserted=${r.inserted}` +
    (r.deleted ? ` deleted=${r.deleted}` : '') +
    ` missing=${r.missing}` +
    (r.skipped ? ` (skipped revoked=${r.skipped})` : '') +
    (r.orphans ? ` (orphans=${r.orphans})` : '')
  );
}

// CLI entry point: `npm run backfill`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createPool, redactUrl } = await import('./pool.ts');
  const { migrate } = await import('./migrate.ts');
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_MIGRATION_URL (preferred) or DATABASE_URL');
    process.exit(2);
  }
  const args = new Set(process.argv.slice(2));
  const pool = createPool(url, 'migrate');
  try {
    await migrate(pool);
    const reports = await backfill(pool, {
      mode: args.has('--resync') ? 'resync' : 'fill',
      verifyOnly: args.has('--verify-only'),
    });
    console.log(`${redactUrl(url)}: backfill (${args.has('--resync') ? 'resync' : 'fill'})`);
    for (const r of reports) console.log(formatReport(r));
    if (reports.some((r) => !r.ok)) {
      console.error('Backfill incomplete: some documents have no table row (see missing).');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
