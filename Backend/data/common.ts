/**
 * Shared building blocks of the relational data layer (ADR 0011).
 *
 *  - `ORG_ID`: the tenant key every row carries. Single tenant today.
 *  - Keyset cursors: opaque, URL-safe encodings of the last row's sort key.
 *  - `Queryable`: the slice of `pg.Pool` the repositories use (so tests can
 *    pass a fake pool or a transaction client).
 *  - Row mapping helpers that keep unknown fields in an `extra` JSON column,
 *    so a field added by a newer build survives a round trip through an
 *    older one.
 *  - `clone`: the in-memory repositories hand out copies, exactly like a
 *    database does, so a caller that mutates a row without writing it back is
 *    caught by the tests instead of only in production.
 */

import type { QueryResultRow } from 'pg';

/** Tenant key for every row. One organisation per deployment in phase 1. */
export const ORG_ID = 'default';

export interface Page<T> {
  items: T[];
  /** Opaque keyset cursor for the next page; absent on the last page. */
  nextCursor?: string;
}

export interface PageOptions {
  /** 1..500, default 50. */
  limit?: number;
  /** `nextCursor` of the previous page. */
  cursor?: string;
}

export function pageLimit(limit: number | undefined, def = 50, max = 500): number {
  const n = Math.trunc(Number(limit ?? def));
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : def;
}

/** Encodes a sort key tuple as an opaque cursor. */
export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** Decodes a cursor made by `encodeCursor`; malformed input yields undefined (treated as "start"). */
export function decodeCursor(
  cursor: string | undefined,
  arity: number,
): (string | number)[] | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === arity &&
      parsed.every((p) => typeof p === 'string' || typeof p === 'number')
    )
      return parsed as (string | number)[];
  } catch {
    // fall through
  }
  return undefined;
}

export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
}

/** What a repository needs from `pg.Pool` (or a checked-out client). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<R>>;
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/*
 * Field-level change tracking. Callers read a row, mutate it in place and
 * write it back with `put`. Writing the whole row would let a stale copy on
 * one replica overwrite a field another replica changed meanwhile (e.g. a
 * passkey sign-in resurrecting a member an Owner just deactivated). So every
 * row a repository hands out is remembered, and `put` writes only the fields
 * that differ from what was read: concurrent writers of *different* fields
 * never undo each other; writers of the same field are last-writer-wins.
 */
const snapshots = new WeakMap<object, Map<string, string>>();
const enc = (v: unknown) => (v === undefined || v === null ? '' : JSON.stringify(v));

/** Records the row's current field values as "what the caller read". Returns the row. */
export function remember<T extends object>(row: T): T {
  snapshots.set(row, new Map(Object.entries(row).map(([k, v]) => [k, enc(v)])));
  return row;
}

/** Fields changed since `remember(row)`; undefined when the row was never read (a new row). */
export function changedFields(row: object): string[] | undefined {
  const snap = snapshots.get(row);
  if (!snap) return undefined;
  const fields = new Set([...snap.keys(), ...Object.keys(row)]);
  return [...fields].filter(
    (k) => enc((row as Record<string, unknown>)[k]) !== (snap.get(k) ?? ''),
  );
}

/** Applies the changed fields of `row` onto `stored` (in-memory repositories). */
export function applyChanges<T extends object>(stored: T, row: T, fields: string[]) {
  const target = stored as Record<string, unknown>;
  const source = row as Record<string, unknown>;
  for (const k of fields) {
    if (source[k] === undefined || source[k] === null) delete target[k];
    else target[k] = clone(source[k]);
  }
}

/** Drops `undefined` and `null` members, matching how JSON rows looked before. */
export function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out as T;
}

/** The fields of `row` that have no column of their own. */
export function extras(row: object, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!known.includes(k) && v !== undefined) out[k] = v;
  return out;
}

/** jsonb rejects NUL characters; strip them from strings and keys (same rule as db/driver.ts). */
export function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'string' && v.includes('\u0000') ? v.replaceAll('\u0000', '') : v,
  );
}

/** text columns reject NUL too. */
export function text(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  return v.includes('\u0000') ? v.replaceAll('\u0000', '') : v;
}

export const iso = (v: Date | string | null | undefined): string | undefined =>
  v === null || v === undefined
    ? undefined
    : v instanceof Date
      ? v.toISOString()
      : new Date(v).toISOString();

/** bigint columns arrive as strings. */
export const num = (v: string | number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

/** Escapes LIKE metacharacters for a substring search. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Write-through copy into the legacy JSONB `documents` table (the dual-write
 * step of the migration plan, ADR 0011). Installed by db/boot.ts; a no-op in
 * memory mode or when DATA_DUAL_WRITE=0.
 */
export interface DocumentMirror {
  write(collection: string, key: string, value: unknown): void;
  remove(collection: string, key: string): void;
}

export const noMirror: DocumentMirror = { write() {}, remove() {} };
