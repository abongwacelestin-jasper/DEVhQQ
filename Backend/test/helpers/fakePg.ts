/**
 * A hand-written stand-in for `pg.Pool` — enough for db/driver.ts and any
 * other module that only uses `pool.query` and `pool.connect()` →
 * `client.query` / `client.release`. Every statement is recorded, and a hook
 * can fail or delay any statement to simulate outages and bad rows.
 *
 *   const pg = fakePool();
 *   const driver = new PgCollectionDriver(pg.pool);
 *   pg.onQuery = (q) => { if (q.sql.includes('INSERT')) throw pgError('23505'); };
 *
 * Committed state is tracked like a tiny `documents` table so tests can
 * assert what actually reached "the database" (rolled-back work is discarded).
 */

import type { Pool } from 'pg';

export interface RecordedQuery {
  sql: string;
  params: unknown[];
  /** 'pool' for pool.query, otherwise the client's connection number. */
  via: 'pool' | number;
}

export class PgError extends Error {
  readonly code: string;
  constructor(code: string, message = `pg error ${code}`) {
    super(message);
    this.code = code;
  }
}
export const pgError = (code: string, message?: string) => new PgError(code, message);

export interface FakePool {
  pool: Pool;
  queries: RecordedQuery[];
  /** Committed rows: `${collection}\u0000${key}` → JSON text. */
  table: Map<string, string>;
  /** Called before each statement; throw to fail it, return a promise to delay it. */
  onQuery?: (q: RecordedQuery) => void | Promise<void>;
  /** Rows returned by the next pool.query SELECT (load). */
  loadRows: { key: string; data: unknown }[];
  releases: { connection: number; destroyed: boolean }[];
  /** Highest number of connections checked out at the same time. */
  maxConcurrent: number;
  /** Transactions that reached COMMIT. */
  commits: number;
}

const rowId = (c: string, k: string) => `${c}\u0000${k}`;

export function fakePool(): FakePool {
  let connections = 0;
  let open = 0;
  const state: FakePool = {
    pool: undefined as unknown as Pool,
    queries: [],
    table: new Map(),
    loadRows: [],
    releases: [],
    maxConcurrent: 0,
    commits: 0,
  };

  async function run(via: RecordedQuery['via'], sql: string, params: unknown[] = []) {
    const q = { sql, params, via };
    state.queries.push(q);
    await state.onQuery?.(q);
    return q;
  }

  const pool = {
    async query(sql: string, params?: unknown[]) {
      await run('pool', sql, params);
      return { rows: state.loadRows, rowCount: state.loadRows.length };
    },
    async connect() {
      const n = ++connections;
      open++;
      state.maxConcurrent = Math.max(state.maxConcurrent, open);
      let staged: (() => void)[] = [];
      let released = false;
      return {
        async query(sql: string, params?: unknown[]) {
          if (released) throw new Error('query on released client');
          await run(n, sql, params);
          const s = sql.trim();
          if (s === 'BEGIN') staged = [];
          else if (s === 'ROLLBACK') staged = [];
          else if (s === 'COMMIT') {
            for (const apply of staged) apply();
            staged = [];
            state.commits++;
          } else if (/^INSERT INTO documents/.test(s)) {
            const [cs, ks, ds] = params as [string[], string[], string[]];
            staged.push(() => cs.forEach((c, i) => state.table.set(rowId(c, ks[i]), ds[i])));
          } else if (/^DELETE FROM documents/.test(s)) {
            const [cs, ks] = params as [string[], string[]];
            staged.push(() => cs.forEach((c, i) => state.table.delete(rowId(c, ks[i]))));
          }
          return { rows: [], rowCount: 0 };
        },
        release(destroy?: boolean | Error) {
          if (released) throw new Error('client released twice');
          released = true;
          open--;
          state.releases.push({ connection: n, destroyed: !!destroy });
        },
      };
    },
  };
  state.pool = pool as unknown as Pool;
  return state;
}

/** Committed JSON for a row, parsed. */
export function committed(pg: FakePool, collection: string, key: string): unknown {
  const raw = pg.table.get(rowId(collection, key));
  return raw === undefined ? undefined : JSON.parse(raw);
}
