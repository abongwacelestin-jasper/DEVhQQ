/**
 * Safe query engine for the console's query runner.
 *
 * Queries are JSON — never strings that get evaluated or concatenated into
 * SQL — so there is no injection surface. Supported:
 *
 *   {
 *     "from": "tasks",
 *     "where": { "status": { "in": ["review", "in-progress"] }, "priority": "urgent" },
 *     "select": ["key", "title", "assignee"],
 *     "orderBy": { "field": "due", "dir": "asc" },
 *     "limit": 50
 *   }
 *
 * Operators: eq (default), ne, in, nin, gt, gte, lt, lte, contains, startsWith, exists.
 * Field names are allow-listed per collection; secrets (password hashes, TOTP
 * secrets, passkey keys) are never selectable.
 */

import { HttpError } from '../types.ts';

type Op =
  'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'exists';
type Scalar = string | number | boolean | null;
type Condition = Scalar | Partial<Record<Op, Scalar | Scalar[]>>;

export interface Query {
  from: string;
  where?: Record<string, Condition>;
  select?: string[];
  orderBy?: { field: string; dir?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

const OPS: Op[] = [
  'eq',
  'ne',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'exists',
];

function test(value: unknown, cond: Condition): boolean {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return value === cond;
  return (Object.entries(cond) as [Op, Scalar | Scalar[]][]).every(([op, arg]) => {
    switch (op) {
      case 'eq':
        return value === arg;
      case 'ne':
        return value !== arg;
      case 'in':
        return (
          Array.isArray(arg) &&
          (Array.isArray(value)
            ? value.some((v) => arg.includes(v as Scalar))
            : arg.includes(value as Scalar))
        );
      case 'nin':
        // The complement of `in`, including array-valued fields (no overlap).
        return (
          Array.isArray(arg) &&
          (Array.isArray(value)
            ? !value.some((v) => arg.includes(v as Scalar))
            : !arg.includes(value as Scalar))
        );
      case 'gt':
        return (value as number | string) > (arg as number | string);
      case 'gte':
        return (value as number | string) >= (arg as number | string);
      case 'lt':
        return (value as number | string) < (arg as number | string);
      case 'lte':
        return (value as number | string) <= (arg as number | string);
      case 'contains':
        return typeof value === 'string'
          ? value.toLowerCase().includes(String(arg).toLowerCase())
          : Array.isArray(value) && value.includes(arg);
      case 'startsWith':
        return (
          typeof value === 'string' && value.toLowerCase().startsWith(String(arg).toLowerCase())
        );
      case 'exists':
        return arg ? value !== undefined && value !== null : value === undefined || value === null;
      default:
        return false;
    }
  });
}

export function runQuery<T extends Record<string, unknown>>(
  q: Query,
  rows: T[],
  allowedFields: string[],
) {
  const started = performance.now();
  const check = (f: string) => {
    if (!allowedFields.includes(f))
      throw new HttpError(422, 'field_not_allowed', `Field "${f}" can't be queried on ${q.from}`, {
        allowed: allowedFields,
      });
  };
  for (const [f, cond] of Object.entries(q.where ?? {})) {
    check(f);
    if (cond && typeof cond === 'object' && !Array.isArray(cond))
      for (const op of Object.keys(cond))
        if (!OPS.includes(op as Op))
          throw new HttpError(422, 'operator_unknown', `Unknown operator "${op}"`, {
            operators: OPS,
          });
  }
  q.select?.forEach(check);
  if (q.orderBy) check(q.orderBy.field);

  let out = rows.filter((r) => Object.entries(q.where ?? {}).every(([f, c]) => test(r[f], c)));
  const total = out.length;
  if (q.orderBy) {
    const { field, dir = 'asc' } = q.orderBy;
    out = [...out].sort(
      (a, b) =>
        (a[field]! > b[field]! ? 1 : a[field]! < b[field]! ? -1 : 0) * (dir === 'desc' ? -1 : 1),
    );
  }
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  const page = out.slice(offset, offset + limit);
  const fields = q.select?.length ? q.select : allowedFields;
  const projected = page.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
  return {
    from: q.from,
    total,
    returned: projected.length,
    offset,
    limit,
    ms: Math.round((performance.now() - started) * 100) / 100,
    rows: projected,
  };
}
