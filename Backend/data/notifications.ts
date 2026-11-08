/**
 * Notifications repository: a member's inbox.
 *
 * Inbox paging is keyset on the sortable id (`ntf-<time><counter><random>`),
 * newest first — the `before` cursor the API already exposes. Ids compare in
 * byte order (COLLATE "C"), exactly like JavaScript string comparison.
 */

import type { Notification, NotificationKind } from '../domain/collab/types.ts';
import {
  ORG_ID,
  clone,
  compact,
  extras,
  iso,
  json,
  text,
  type DocumentMirror,
  type Queryable,
  noMirror,
} from './common.ts';

export interface InboxQuery {
  unreadOnly?: boolean;
  kind?: string;
  /** Only ids strictly older than this one. */
  before?: string;
  limit: number;
}

export interface NotificationsRepo {
  insert(n: Notification): Promise<void>;
  get(id: string): Promise<Notification | undefined>;
  /** An unread notification of `kind` about `refId` for the member (duplicates collapse onto it). */
  findUnread(memberId: string, kind: NotificationKind, refId: string): Promise<Notification | undefined>;
  /** Newest first; `hasMore` when another page exists. */
  inbox(memberId: string, q: InboxQuery): Promise<{ items: Notification[]; hasMore: boolean }>;
  countUnread(memberId: string): Promise<number>;
  /** Marks the member's unread notifications read (`ids`, or all). Returns how many changed. */
  markRead(memberId: string, ids: string[] | 'all', at: string): Promise<number>;
  /** Closes every unread notification of `kind` about `refId` (any member). */
  markRefRead(kind: NotificationKind, refId: string, at: string): Promise<number>;
  /** Unread, not yet emailed, created at or before `cutoff`, oldest first. */
  pendingDigest(cutoff: string): Promise<Notification[]>;
  markEmailed(ids: string[], at: string): Promise<void>;
  /** Every notification (backups, tests). */
  list(memberId?: string): Promise<Notification[]>;
  put(n: Notification): Promise<void>;
  delete(id: string): Promise<boolean>;
}

const newestFirst = (a: Notification, b: Notification) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export class MemoryNotificationsRepo implements NotificationsRepo {
  private readonly rows = new Map<string, Notification>();

  async insert(n: Notification) {
    this.rows.set(n.id, clone(n));
  }
  async get(id: string) {
    const n = this.rows.get(id);
    return n && clone(n);
  }
  async findUnread(memberId: string, kind: NotificationKind, refId: string) {
    for (const n of this.rows.values())
      if (n.memberId === memberId && n.refId === refId && n.kind === kind && !n.readAt)
        return clone(n);
    return undefined;
  }
  async inbox(memberId: string, q: InboxQuery) {
    const list = [...this.rows.values()]
      .filter(
        (n) =>
          n.memberId === memberId &&
          (!q.unreadOnly || !n.readAt) &&
          (!q.kind || n.kind === q.kind) &&
          (!q.before || n.id < q.before),
      )
      .sort(newestFirst);
    return { items: list.slice(0, q.limit).map(clone), hasMore: list.length > q.limit };
  }
  async countUnread(memberId: string) {
    let n = 0;
    for (const x of this.rows.values()) if (x.memberId === memberId && !x.readAt) n++;
    return n;
  }
  async markRead(memberId: string, ids: string[] | 'all', at: string) {
    const wanted = ids === 'all' ? undefined : new Set(ids);
    let changed = 0;
    for (const n of this.rows.values()) {
      if (n.memberId !== memberId || n.readAt || (wanted && !wanted.has(n.id))) continue;
      n.readAt = at;
      changed++;
    }
    return changed;
  }
  async markRefRead(kind: NotificationKind, refId: string, at: string) {
    let changed = 0;
    for (const n of this.rows.values())
      if (n.kind === kind && n.refId === refId && !n.readAt) {
        n.readAt = at;
        changed++;
      }
    return changed;
  }
  async pendingDigest(cutoff: string) {
    return [...this.rows.values()]
      .filter((n) => !n.readAt && !n.emailedAt && n.at <= cutoff)
      .map(clone);
  }
  async markEmailed(ids: string[], at: string) {
    for (const id of ids) {
      const n = this.rows.get(id);
      if (n) n.emailedAt = at;
    }
  }
  async list(memberId?: string) {
    return [...this.rows.values()].filter((n) => !memberId || n.memberId === memberId).map(clone);
  }
  async put(n: Notification) {
    this.rows.set(n.id, clone(n));
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
}

const KNOWN = [
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
] as const;

interface NotificationRow {
  id: string;
  member_id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  ref_id: string;
  actor: string;
  at: Date;
  read_at: Date | null;
  emailed_at: Date | null;
  extra: Record<string, unknown> | null;
}

const COLUMNS =
  'id, member_id, kind, title, body, link, ref_id, actor, at, read_at, emailed_at, extra';

function fromRow(r: NotificationRow): Notification {
  return compact({
    ...(r.extra ?? {}),
    memberId: r.member_id,
    kind: r.kind as NotificationKind,
    title: r.title,
    body: r.body,
    link: r.link,
    refId: r.ref_id,
    actor: r.actor,
    id: r.id,
    at: iso(r.at) ?? '',
    readAt: iso(r.read_at),
    emailedAt: iso(r.emailed_at),
  });
}

const INSERT = `INSERT INTO notifications (org_id, id, member_id, kind, title, body, link, ref_id,
  actor, at, read_at, emailed_at, extra)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`;

function params(n: Notification): unknown[] {
  return [
    ORG_ID,
    n.id,
    n.memberId,
    n.kind,
    text(n.title),
    text(n.body),
    text(n.link),
    text(n.refId),
    n.actor,
    n.at,
    n.readAt ?? null,
    n.emailedAt ?? null,
    json(extras(n, KNOWN)) ?? '{}',
  ];
}

export class PgNotificationsRepo implements NotificationsRepo {
  private readonly pool: Queryable;
  private readonly mirror: DocumentMirror;
  constructor(pool: Queryable, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }
  private async many(sql: string, args: unknown[]) {
    const res = await this.pool.query<NotificationRow>(sql, args);
    return res.rows.map(fromRow);
  }
  /** Re-reads changed rows so the JSONB mirror stays a faithful copy. */
  private async mirrorIds(ids: string[]) {
    if (!ids.length) return;
    for (const n of await this.many(
      `SELECT ${COLUMNS} FROM notifications WHERE org_id = $1 AND id = ANY ($2::text[])`,
      [ORG_ID, ids],
    ))
      this.mirror.write('collab_notifications', n.id, n);
  }

  async insert(n: Notification) {
    await this.pool.query(INSERT, params(n));
    this.mirror.write('collab_notifications', n.id, n);
  }
  async get(id: string) {
    const rows = await this.many(
      `SELECT ${COLUMNS} FROM notifications WHERE org_id = $1 AND id = $2`,
      [ORG_ID, id],
    );
    return rows[0];
  }
  async findUnread(memberId: string, kind: NotificationKind, refId: string) {
    const rows = await this.many(
      `SELECT ${COLUMNS} FROM notifications
       WHERE org_id = $1 AND member_id = $2 AND kind = $3 AND ref_id = $4 AND read_at IS NULL
       ORDER BY id LIMIT 1`,
      [ORG_ID, memberId, kind, refId],
    );
    return rows[0];
  }
  async inbox(memberId: string, q: InboxQuery) {
    const args: unknown[] = [ORG_ID, memberId];
    let cond = 'org_id = $1 AND member_id = $2';
    if (q.unreadOnly) cond += ' AND read_at IS NULL';
    if (q.kind) cond += ` AND kind = $${args.push(q.kind)}`;
    if (q.before) cond += ` AND id < $${args.push(q.before)}`;
    args.push(q.limit + 1);
    const rows = await this.many(
      `SELECT ${COLUMNS} FROM notifications WHERE ${cond} ORDER BY id DESC LIMIT $${args.length}`,
      args,
    );
    return { items: rows.slice(0, q.limit), hasMore: rows.length > q.limit };
  }
  async countUnread(memberId: string) {
    const res = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notifications
       WHERE org_id = $1 AND member_id = $2 AND read_at IS NULL`,
      [ORG_ID, memberId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
  async markRead(memberId: string, ids: string[] | 'all', at: string) {
    const args: unknown[] = [ORG_ID, memberId, at];
    let cond = 'org_id = $1 AND member_id = $2 AND read_at IS NULL';
    if (ids !== 'all') cond += ` AND id = ANY ($${args.push(ids)}::text[])`;
    const res = await this.pool.query<{ id: string }>(
      `UPDATE notifications SET read_at = $3 WHERE ${cond} RETURNING id`,
      args,
    );
    await this.mirrorIds(res.rows.map((r) => r.id));
    return res.rows.length;
  }
  async markRefRead(kind: NotificationKind, refId: string, at: string) {
    const res = await this.pool.query<{ id: string }>(
      `UPDATE notifications SET read_at = $4
       WHERE org_id = $1 AND kind = $2 AND ref_id = $3 AND read_at IS NULL RETURNING id`,
      [ORG_ID, kind, refId, at],
    );
    await this.mirrorIds(res.rows.map((r) => r.id));
    return res.rows.length;
  }
  pendingDigest(cutoff: string) {
    return this.many(
      `SELECT ${COLUMNS} FROM notifications
       WHERE org_id = $1 AND read_at IS NULL AND emailed_at IS NULL AND at <= $2
       ORDER BY at, id`,
      [ORG_ID, cutoff],
    );
  }
  async markEmailed(ids: string[], at: string) {
    if (!ids.length) return;
    await this.pool.query(
      'UPDATE notifications SET emailed_at = $3 WHERE org_id = $1 AND id = ANY ($2::text[])',
      [ORG_ID, ids, at],
    );
    await this.mirrorIds(ids);
  }
  list(memberId?: string) {
    return memberId
      ? this.many(
          `SELECT ${COLUMNS} FROM notifications WHERE org_id = $1 AND member_id = $2 ORDER BY id`,
          [ORG_ID, memberId],
        )
      : this.many(`SELECT ${COLUMNS} FROM notifications WHERE org_id = $1 ORDER BY id`, [ORG_ID]);
  }
  async put(n: Notification) {
    await this.pool.query('DELETE FROM notifications WHERE org_id = $1 AND id = $2', [ORG_ID, n.id]);
    await this.insert(n);
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM notifications WHERE org_id = $1 AND id = $2', [
      ORG_ID,
      id,
    ]);
    this.mirror.remove('collab_notifications', id);
    return (res.rowCount ?? 0) > 0;
  }
}
