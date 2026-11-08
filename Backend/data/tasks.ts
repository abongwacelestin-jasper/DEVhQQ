/**
 * Tasks, task events (the immutable timeline) and task comments.
 *
 * Ordering contract (same as the Maps these replace): ties are broken by
 * insertion order (`seq`), so `ORDER BY due, seq` here equals a stable sort
 * by `due` over insertion order there.
 *
 * Keys (RB-231) come from `allocateKey`, an atomic per-prefix counter, so two
 * replicas creating tasks at the same moment never pick the same key. Deleting
 * a task deletes its events and comments (ON DELETE CASCADE in PostgreSQL).
 */

import type { ProductId, Task, TaskComment, TaskEvent, TaskEventKind } from '../types.ts';
import {
  ORG_ID,
  applyChanges,
  changedFields,
  clone,
  compact,
  remember,
  decodeCursor,
  encodeCursor,
  extras,
  iso,
  json,
  pageLimit,
  text,
  type DocumentMirror,
  type Page,
  type PageOptions,
  type Queryable,
  noMirror,
} from './common.ts';

export interface TaskQuery {
  /** Only these products (the caller's visible scope). */
  products?: readonly ProductId[];
  product?: string;
  projectId?: string;
  statuses?: string[];
  priorities?: string[];
  assignee?: string;
  /** Case-insensitive substring of `key title description`. */
  q?: string;
}

export interface TasksRepo {
  get(key: string): Promise<Task | undefined>;
  getMany(keys: Iterable<string>): Promise<Map<string, Task>>;
  /** Matching tasks in insertion order. */
  list(q?: TaskQuery): Promise<Task[]>;
  /** Matching tasks ordered by due date, with the total count (offset paging, the public API). */
  search(q: TaskQuery, opts: { limit: number; offset: number }): Promise<{ total: number; items: Task[] }>;
  /** Keyset page ordered by (due, insertion). */
  page(q: TaskQuery, opts?: PageOptions): Promise<Page<Task>>;
  /** Next free key for a prefix (`RB` → `RB-232`). Atomic across replicas. */
  allocateKey(prefix: string): Promise<string>;
  /** Creates a task; false if the key already exists. */
  insert(t: Task): Promise<boolean>;
  put(t: Task): Promise<void>;
  /** Deletes the task and its events and comments. */
  delete(key: string): Promise<boolean>;
}

export interface TaskEventsRepo {
  append(e: TaskEvent): Promise<void>;
  /** Events of these tasks (all tasks when omitted), oldest first. */
  list(taskKeys?: Iterable<string>): Promise<TaskEvent[]>;
  /** Actor of the newest event of `kind` on a task. */
  latestActor(taskKey: string, kind: TaskEventKind): Promise<string | undefined>;
  put(e: TaskEvent): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface TaskCommentsRepo {
  insert(c: TaskComment): Promise<void>;
  get(id: string): Promise<TaskComment | undefined>;
  /** Comments of these tasks (all tasks when omitted), oldest first. */
  list(taskKeys?: Iterable<string>): Promise<TaskComment[]>;
  /** taskKey → number of comments, for the given tasks. */
  countByTask(taskKeys: Iterable<string>): Promise<Map<string, number>>;
  put(c: TaskComment): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Task key prefix per product (`RB-212`). A task's product never changes, nor does its key. */
export const TASK_KEY_PREFIX: Record<ProductId, string> = {
  renewberry: 'RB',
  blog: 'BL',
  mirror: 'MA',
};

/** The product a task key belongs to, from its prefix; undefined for anything else. */
export function productOfTaskKey(key: string): ProductId | undefined {
  const m = /^([A-Z]+)-\d+$/.exec(key);
  if (!m) return undefined;
  for (const [product, prefix] of Object.entries(TASK_KEY_PREFIX))
    if (prefix === m[1]) return product as ProductId;
  return undefined;
}

const keyNumber = (key: string, prefix: string) => {
  const m = /^([A-Z]+)-(\d+)$/.exec(key);
  return m && m[1] === prefix ? Number(m[2]) : 0;
};

function matchesTask(t: Task, q: TaskQuery = {}): boolean {
  const needle = q.q?.toLowerCase();
  return (
    (!q.products || q.products.includes(t.product)) &&
    (!q.product || t.product === q.product) &&
    (!q.projectId || t.projectId === q.projectId) &&
    (!q.statuses || q.statuses.includes(t.status)) &&
    (!q.priorities || q.priorities.includes(t.priority)) &&
    (!q.assignee || t.assignee === q.assignee) &&
    (!needle || `${t.key} ${t.title} ${t.description ?? ''}`.toLowerCase().includes(needle))
  );
}

// ─── in-memory implementations ────────────────────────────────────────────

/** A copy for a caller, remembered for field-level `put` (see data/common.ts). */
const outT = (t: Task): Task => remember(clone(t));

export class MemoryTaskStore {
  readonly tasks = new Map<string, Task>();
  readonly events = new Map<string, TaskEvent>();
  readonly comments = new Map<string, TaskComment>();
  readonly seq = new Map<string, number>();
  readonly counters = new Map<string, number>();
  next = 0;
}

export class MemoryTasksRepo implements TasksRepo {
  private readonly s: MemoryTaskStore;
  constructor(store: MemoryTaskStore) {
    this.s = store;
  }
  async get(key: string) {
    const t = this.s.tasks.get(key);
    return t && outT(t);
  }
  async getMany(keys: Iterable<string>) {
    const out = new Map<string, Task>();
    for (const k of keys) {
      const t = this.s.tasks.get(k);
      if (t) out.set(k, outT(t));
    }
    return out;
  }
  async list(q?: TaskQuery) {
    return [...this.s.tasks.values()].filter((t) => matchesTask(t, q)).map(outT);
  }
  private sorted(q: TaskQuery) {
    return [...this.s.tasks.values()]
      .filter((t) => matchesTask(t, q))
      .sort((a, b) => a.due.localeCompare(b.due));
  }
  async search(q: TaskQuery, opts: { limit: number; offset: number }) {
    const rows = this.sorted(q);
    return { total: rows.length, items: rows.slice(opts.offset, opts.offset + opts.limit).map(outT) };
  }
  async page(q: TaskQuery, opts: PageOptions = {}) {
    const limit = pageLimit(opts.limit);
    const after = decodeCursor(opts.cursor, 2);
    const seqOf = (t: Task) => this.s.seq.get(t.key) ?? 0;
    const rows = this.sorted(q).filter(
      (t) =>
        !after ||
        t.due > String(after[0]) ||
        (t.due === String(after[0]) && seqOf(t) > Number(after[1])),
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(outT),
      ...(rows.length > limit && last ? { nextCursor: encodeCursor([last.due, seqOf(last)]) } : {}),
    };
  }
  async allocateKey(prefix: string) {
    let max = this.s.counters.get(prefix) ?? 0;
    for (const k of this.s.tasks.keys()) max = Math.max(max, keyNumber(k, prefix));
    this.s.counters.set(prefix, max + 1);
    return `${prefix}-${max + 1}`;
  }
  async insert(t: Task) {
    if (this.s.tasks.has(t.key)) return false;
    await this.put(t);
    return true;
  }
  async put(t: Task) {
    const fields = changedFields(t);
    const stored = this.s.tasks.get(t.key);
    if (fields && stored) {
      applyChanges(stored, t, fields);
    } else {
      if (!this.s.seq.has(t.key)) this.s.seq.set(t.key, ++this.s.next);
      this.s.tasks.set(t.key, clone(t));
    }
    remember(t);
  }
  async delete(key: string) {
    if (!this.s.tasks.delete(key)) return false;
    this.s.seq.delete(key);
    for (const [id, e] of this.s.events) if (e.taskKey === key) this.s.events.delete(id);
    for (const [id, c] of this.s.comments) if (c.taskKey === key) this.s.comments.delete(id);
    return true;
  }
}

const byAt = <T extends { at: string }>(a: T, b: T) => a.at.localeCompare(b.at);
const inKeys = (keys: Iterable<string> | undefined) => (keys ? new Set(keys) : undefined);

export class MemoryTaskEventsRepo implements TaskEventsRepo {
  private readonly s: MemoryTaskStore;
  constructor(store: MemoryTaskStore) {
    this.s = store;
  }
  async append(e: TaskEvent) {
    this.s.events.set(e.id, clone(e));
  }
  async list(taskKeys?: Iterable<string>) {
    const keys = inKeys(taskKeys);
    return [...this.s.events.values()]
      .filter((e) => !keys || keys.has(e.taskKey))
      .sort(byAt)
      .map(clone);
  }
  async latestActor(taskKey: string, kind: TaskEventKind) {
    let best: TaskEvent | undefined;
    for (const e of this.s.events.values())
      if (e.taskKey === taskKey && e.kind === kind && (!best || e.at >= best.at)) best = e;
    return best?.actor;
  }
  async put(e: TaskEvent) {
    this.s.events.set(e.id, clone(e));
  }
  async delete(id: string) {
    return this.s.events.delete(id);
  }
}

export class MemoryTaskCommentsRepo implements TaskCommentsRepo {
  private readonly s: MemoryTaskStore;
  constructor(store: MemoryTaskStore) {
    this.s = store;
  }
  async insert(c: TaskComment) {
    this.s.comments.set(c.id, clone(c));
  }
  async get(id: string) {
    const c = this.s.comments.get(id);
    return c && clone(c);
  }
  async list(taskKeys?: Iterable<string>) {
    const keys = inKeys(taskKeys);
    return [...this.s.comments.values()]
      .filter((c) => !keys || keys.has(c.taskKey))
      .sort(byAt)
      .map(clone);
  }
  async countByTask(taskKeys: Iterable<string>) {
    const out = new Map<string, number>();
    for (const k of taskKeys) out.set(k, 0);
    for (const c of this.s.comments.values())
      if (out.has(c.taskKey)) out.set(c.taskKey, (out.get(c.taskKey) ?? 0) + 1);
    return out;
  }
  async put(c: TaskComment) {
    this.s.comments.set(c.id, clone(c));
  }
  async delete(id: string) {
    return this.s.comments.delete(id);
  }
}

// ─── PostgreSQL implementations ───────────────────────────────────────────

const TASK_KNOWN = [
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
] as const;

interface TaskRow {
  key: string;
  seq: string;
  title: string;
  product: string;
  project_id: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  reviewer: string | null;
  due_text: string;
  estimate: number;
  description: string | null;
  pr: number | null;
  blocked_by: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  extra: Record<string, unknown> | null;
}

const TASK_COLUMNS = `key, seq, title, product, project_id, type, status, priority, assignee,
  reviewer, due::text AS due_text, estimate, description, pr, blocked_by, created_by, created_at,
  updated_at, extra`;

/** Task field → column, value and cast, for field-level updates. */
const TASK_FIELD_COLUMNS: Record<string, [string, (t: Task) => unknown, string]> = {
  title: ['title', (t) => text(t.title), ''],
  projectId: ['project_id', (t) => text(t.projectId), ''],
  type: ['type', (t) => t.type, ''],
  status: ['status', (t) => t.status, ''],
  priority: ['priority', (t) => t.priority, ''],
  assignee: ['assignee', (t) => t.assignee, ''],
  reviewer: ['reviewer', (t) => t.reviewer ?? null, ''],
  due: ['due', (t) => t.due, '::date'],
  estimate: ['estimate', (t) => t.estimate, ''],
  description: ['description', (t) => text(t.description), ''],
  pr: ['pr', (t) => t.pr ?? null, ''],
  blockedBy: ['blocked_by', (t) => t.blockedBy ?? null, ''],
  updatedAt: ['updated_at', (t) => t.updatedAt, ''],
};

function taskFromRow(r: TaskRow): Task {
  return remember(compact({
    ...(r.extra ?? {}),
    key: r.key,
    title: r.title,
    product: r.product as ProductId,
    projectId: r.project_id,
    type: r.type as Task['type'],
    status: r.status as Task['status'],
    priority: r.priority as Task['priority'],
    assignee: r.assignee,
    reviewer: r.reviewer ?? undefined,
    due: r.due_text,
    estimate: r.estimate,
    description: r.description ?? undefined,
    pr: r.pr ?? undefined,
    blockedBy: r.blocked_by ?? undefined,
    createdBy: r.created_by,
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
  }));
}

const TASK_INSERT = `INSERT INTO tasks (org_id, key, title, product, project_id, type, status,
    priority, assignee, reviewer, due, estimate, description, pr, blocked_by, created_by,
    created_at, updated_at, extra)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13, $14, $15, $16, $17, $18,
    $19::jsonb)`;

function taskParams(t: Task): unknown[] {
  return [
    ORG_ID,
    t.key,
    text(t.title),
    t.product,
    text(t.projectId),
    t.type,
    t.status,
    t.priority,
    t.assignee,
    t.reviewer ?? null,
    t.due,
    t.estimate,
    text(t.description),
    t.pr ?? null,
    t.blockedBy ?? null,
    t.createdBy,
    t.createdAt,
    t.updatedAt,
    json(extras(t, TASK_KNOWN)) ?? '{}',
  ];
}

function taskWhere(q: TaskQuery, args: unknown[]): string {
  const parts = ['org_id = $1'];
  if (q.products) parts.push(`product = ANY ($${args.push([...q.products])}::text[])`);
  if (q.product) parts.push(`product = $${args.push(q.product)}`);
  if (q.projectId) parts.push(`project_id = $${args.push(q.projectId)}`);
  if (q.statuses) parts.push(`status = ANY ($${args.push(q.statuses)}::text[])`);
  if (q.priorities) parts.push(`priority = ANY ($${args.push(q.priorities)}::text[])`);
  if (q.assignee) parts.push(`assignee = $${args.push(q.assignee)}`);
  if (q.q)
    parts.push(
      `strpos(lower(key || ' ' || title || ' ' || coalesce(description, '')), $${args.push(q.q.toLowerCase())}) > 0`,
    );
  return parts.join(' AND ');
}

export class PgTasksRepo implements TasksRepo {
  private readonly pool: Queryable;
  private readonly mirror: DocumentMirror;
  constructor(pool: Queryable, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }
  async get(key: string) {
    const res = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE org_id = $1 AND key = $2`,
      [ORG_ID, key],
    );
    return res.rows[0] ? taskFromRow(res.rows[0]) : undefined;
  }
  async getMany(keys: Iterable<string>) {
    const list = [...new Set(keys)];
    const out = new Map<string, Task>();
    if (!list.length) return out;
    const res = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE org_id = $1 AND key = ANY ($2::text[])`,
      [ORG_ID, list],
    );
    for (const r of res.rows) out.set(r.key, taskFromRow(r));
    return out;
  }
  async list(q: TaskQuery = {}) {
    const args: unknown[] = [ORG_ID];
    const res = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${taskWhere(q, args)} ORDER BY seq`,
      args,
    );
    return res.rows.map(taskFromRow);
  }
  async search(q: TaskQuery, opts: { limit: number; offset: number }) {
    const args: unknown[] = [ORG_ID];
    const cond = taskWhere(q, args);
    const total = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tasks WHERE ${cond}`,
      args,
    );
    const res = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${cond} ORDER BY due, seq
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, opts.limit, opts.offset],
    );
    return { total: Number(total.rows[0]?.n ?? 0), items: res.rows.map(taskFromRow) };
  }
  async page(q: TaskQuery, opts: PageOptions = {}) {
    const limit = pageLimit(opts.limit);
    const args: unknown[] = [ORG_ID];
    let cond = taskWhere(q, args);
    const after = decodeCursor(opts.cursor, 2);
    if (after) {
      const d = args.push(String(after[0]));
      const s = args.push(Number(after[1]));
      cond += ` AND (due, seq) > ($${d}::date, $${s})`;
    }
    args.push(limit + 1);
    const res = await this.pool.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${cond} ORDER BY due, seq LIMIT $${args.length}`,
      args,
    );
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(taskFromRow),
      ...(res.rows.length > limit && last
        ? { nextCursor: encodeCursor([last.due_text, Number(last.seq)]) }
        : {}),
    };
  }
  async allocateKey(prefix: string) {
    const existing = `(SELECT coalesce(max(substring(key FROM '^[A-Z]+-([0-9]+)$')::int), 0)
        FROM tasks WHERE org_id = $1 AND key LIKE $2 || '-%')`;
    const res = await this.pool.query<{ last: number }>(
      `INSERT INTO task_key_counters (org_id, prefix, last) VALUES ($1, $2, ${existing} + 1)
       ON CONFLICT (org_id, prefix)
       DO UPDATE SET last = GREATEST(task_key_counters.last, ${existing}) + 1
       RETURNING last`,
      [ORG_ID, prefix],
    );
    return `${prefix}-${res.rows[0].last}`;
  }
  async insert(t: Task) {
    const res = await this.pool.query(`${TASK_INSERT} ON CONFLICT (org_id, key) DO NOTHING`, taskParams(t));
    if ((res.rowCount ?? 0) === 0) return false;
    this.mirror.write('tasks', t.key, t);
    return true;
  }
  async put(t: Task) {
    const fields = changedFields(t);
    if (fields && fields.every((f) => f in TASK_FIELD_COLUMNS)) {
      if (!fields.length) return;
      // Only what this caller changed: a concurrent change to another field survives.
      const args: unknown[] = [ORG_ID, t.key];
      const sets = fields.map((f) => {
        const [col, value, cast] = TASK_FIELD_COLUMNS[f];
        return `${col} = $${args.push(value(t))}${cast}`;
      });
      const res = await this.pool.query<TaskRow>(
        `UPDATE tasks SET ${sets.join(', ')} WHERE org_id = $1 AND key = $2
         RETURNING ${TASK_COLUMNS}`,
        args,
      );
      if (res.rows[0]) {
        remember(t);
        this.mirror.write('tasks', t.key, taskFromRow(res.rows[0]));
        return;
      }
    }
    remember(t);
    await this.pool.query(
      `${TASK_INSERT} ON CONFLICT (org_id, key) DO UPDATE SET title = EXCLUDED.title,
        product = EXCLUDED.product, project_id = EXCLUDED.project_id, type = EXCLUDED.type,
        status = EXCLUDED.status, priority = EXCLUDED.priority, assignee = EXCLUDED.assignee,
        reviewer = EXCLUDED.reviewer, due = EXCLUDED.due, estimate = EXCLUDED.estimate,
        description = EXCLUDED.description, pr = EXCLUDED.pr, blocked_by = EXCLUDED.blocked_by,
        created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at, extra = EXCLUDED.extra`,
      taskParams(t),
    );
    this.mirror.write('tasks', t.key, t);
  }
  async delete(key: string) {
    const ev = await this.pool.query<{ id: string }>(
      'SELECT id FROM task_events WHERE org_id = $1 AND task_key = $2',
      [ORG_ID, key],
    );
    const cm = await this.pool.query<{ id: string }>(
      'SELECT id FROM task_comments WHERE org_id = $1 AND task_key = $2',
      [ORG_ID, key],
    );
    const res = await this.pool.query('DELETE FROM tasks WHERE org_id = $1 AND key = $2', [
      ORG_ID,
      key,
    ]);
    if ((res.rowCount ?? 0) === 0) return false;
    this.mirror.remove('tasks', key);
    for (const r of ev.rows) this.mirror.remove('taskEvents', r.id);
    for (const r of cm.rows) this.mirror.remove('taskComments', r.id);
    return true;
  }
}

const EVENT_KNOWN = ['id', 'taskKey', 'actor', 'at', 'kind', 'from', 'to', 'note'] as const;

interface EventRow {
  id: string;
  task_key: string;
  actor: string;
  at: Date;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  extra: Record<string, unknown> | null;
}

const EVENT_COLUMNS = 'id, task_key, actor, at, kind, from_value, to_value, note, extra';

function eventFromRow(r: EventRow): TaskEvent {
  return compact({
    ...(r.extra ?? {}),
    id: r.id,
    taskKey: r.task_key,
    actor: r.actor,
    at: iso(r.at) ?? '',
    kind: r.kind as TaskEventKind,
    from: r.from_value ?? undefined,
    to: r.to_value ?? undefined,
    note: r.note ?? undefined,
  });
}

function eventParams(e: TaskEvent): unknown[] {
  return [
    ORG_ID,
    e.id,
    e.taskKey,
    e.actor,
    e.at,
    e.kind,
    text(e.from),
    text(e.to),
    text(e.note),
    json(extras(e, EVENT_KNOWN)) ?? '{}',
  ];
}

const EVENT_INSERT = `INSERT INTO task_events (org_id, id, task_key, actor, at, kind, from_value,
  to_value, note, extra) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`;

export class PgTaskEventsRepo implements TaskEventsRepo {
  private readonly pool: Queryable;
  private readonly mirror: DocumentMirror;
  constructor(pool: Queryable, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }
  async append(e: TaskEvent) {
    await this.pool.query(EVENT_INSERT, eventParams(e));
    this.mirror.write('taskEvents', e.id, e);
  }
  async list(taskKeys?: Iterable<string>) {
    const args: unknown[] = [ORG_ID];
    let cond = 'org_id = $1';
    if (taskKeys) cond += ` AND task_key = ANY ($${args.push([...taskKeys])}::text[])`;
    const res = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM task_events WHERE ${cond} ORDER BY at, seq`,
      args,
    );
    return res.rows.map(eventFromRow);
  }
  async latestActor(taskKey: string, kind: TaskEventKind) {
    const res = await this.pool.query<{ actor: string }>(
      `SELECT actor FROM task_events WHERE org_id = $1 AND task_key = $2 AND kind = $3
       ORDER BY at DESC, seq DESC LIMIT 1`,
      [ORG_ID, taskKey, kind],
    );
    return res.rows[0]?.actor;
  }
  async put(e: TaskEvent) {
    // Events are immutable; a re-put (restore) replaces the row.
    await this.pool.query('DELETE FROM task_events WHERE org_id = $1 AND id = $2', [ORG_ID, e.id]);
    await this.append(e);
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM task_events WHERE org_id = $1 AND id = $2', [
      ORG_ID,
      id,
    ]);
    this.mirror.remove('taskEvents', id);
    return (res.rowCount ?? 0) > 0;
  }
}

interface CommentRow {
  id: string;
  task_key: string;
  author: string;
  text: string;
  at: Date;
  extra: Record<string, unknown> | null;
}

const COMMENT_KNOWN = ['id', 'taskKey', 'author', 'text', 'at'] as const;
const COMMENT_COLUMNS = 'id, task_key, author, text, at, extra';

function commentFromRow(r: CommentRow): TaskComment {
  return compact({
    ...(r.extra ?? {}),
    id: r.id,
    taskKey: r.task_key,
    author: r.author,
    text: r.text,
    at: iso(r.at) ?? '',
  });
}

export class PgTaskCommentsRepo implements TaskCommentsRepo {
  private readonly pool: Queryable;
  private readonly mirror: DocumentMirror;
  constructor(pool: Queryable, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }
  async insert(c: TaskComment) {
    await this.write(c, 'ON CONFLICT (org_id, id) DO NOTHING');
  }
  async get(id: string) {
    const res = await this.pool.query<CommentRow>(
      `SELECT ${COMMENT_COLUMNS} FROM task_comments WHERE org_id = $1 AND id = $2`,
      [ORG_ID, id],
    );
    return res.rows[0] ? commentFromRow(res.rows[0]) : undefined;
  }
  async list(taskKeys?: Iterable<string>) {
    const args: unknown[] = [ORG_ID];
    let cond = 'org_id = $1';
    if (taskKeys) cond += ` AND task_key = ANY ($${args.push([...taskKeys])}::text[])`;
    const res = await this.pool.query<CommentRow>(
      `SELECT ${COMMENT_COLUMNS} FROM task_comments WHERE ${cond} ORDER BY at, seq`,
      args,
    );
    return res.rows.map(commentFromRow);
  }
  async countByTask(taskKeys: Iterable<string>) {
    const keys = [...new Set(taskKeys)];
    const out = new Map<string, number>(keys.map((k) => [k, 0]));
    if (!keys.length) return out;
    const res = await this.pool.query<{ task_key: string; n: string }>(
      `SELECT task_key, count(*)::text AS n FROM task_comments
       WHERE org_id = $1 AND task_key = ANY ($2::text[]) GROUP BY task_key`,
      [ORG_ID, keys],
    );
    for (const r of res.rows) out.set(r.task_key, Number(r.n));
    return out;
  }
  async put(c: TaskComment) {
    await this.write(
      c,
      'ON CONFLICT (org_id, id) DO UPDATE SET task_key = EXCLUDED.task_key, author = EXCLUDED.author, text = EXCLUDED.text, at = EXCLUDED.at, extra = EXCLUDED.extra',
    );
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM task_comments WHERE org_id = $1 AND id = $2', [
      ORG_ID,
      id,
    ]);
    this.mirror.remove('taskComments', id);
    return (res.rowCount ?? 0) > 0;
  }
  private async write(c: TaskComment, conflict: string) {
    await this.pool.query(
      `INSERT INTO task_comments (org_id, id, task_key, author, text, at, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ${conflict}`,
      [ORG_ID, c.id, c.taskKey, c.author, text(c.text), c.at, json(extras(c, COMMENT_KNOWN)) ?? '{}'],
    );
    this.mirror.write('taskComments', c.id, c);
  }
}
