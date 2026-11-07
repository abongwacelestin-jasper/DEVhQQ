/**
 * Session storage contract for more than one API replica.
 *
 * Today auth/sessions.ts keeps sessions in the persisted `sessions`
 * collection: an in-memory Map hydrated at boot and written behind to
 * Postgres. With two replicas a session created on one is unknown to the
 * other until a restart, and a revocation on one is not seen by the other.
 * A replica-safe backend must answer every lookup from shared storage.
 *
 * This file is the seam, with two implementations:
 *
 *  - `MemorySessionStore`: one process (dev, tests); same semantics.
 *  - `RedisSessionStore`: `<prefix>sess:<id>` holds the JSON record with a
 *    PX expiry at the session's absolute end (so expired sessions vanish by
 *    themselves); `<prefix>sess:m:<memberId>` is the member's id set, used by
 *    "list my sessions" and "revoke all". Revocation deletes the record, so
 *    the very next lookup on any replica fails.
 *
 * Decision (coordinated with the data-layer lane, which owns
 * auth/sessions.ts and is moving sessions to query-on-demand Postgres): the
 * session *backend* is chosen by that lane. Postgres keeps sessions durable
 * and auditable next to members, and needs no extra component; Redis is the
 * drop-in if session lookups become the hot path (one GET per request).
 * sessions.ts adopts this interface when it goes async; until then it is not
 * wired, and replicas must stay at 1 (docs/operations/known-limits.md).
 */

import type { SessionRecord } from './sessions.ts';
import { withTimeout, type RedisClient } from '../lib/redis.ts';

export interface SessionStore {
  readonly name: string;
  get(id: string): Promise<SessionRecord | undefined>;
  /** Creates or replaces a session. `expiresAt` is the absolute end (epoch ms). */
  put(rec: SessionRecord, expiresAt: number): Promise<void>;
  /** Removes one session. Resolves true when it existed. */
  delete(id: string): Promise<boolean>;
  listByMember(memberId: string): Promise<SessionRecord[]>;
  /** Removes every session of a member except `keepId`. Resolves the number removed. */
  deleteAllFor(memberId: string, keepId?: string): Promise<number>;
}

export class MemorySessionStore implements SessionStore {
  readonly name = 'memory';
  private rows = new Map<string, { rec: SessionRecord; expiresAt: number }>();

  private live(id: string) {
    const row = this.rows.get(id);
    if (row && row.expiresAt <= Date.now()) {
      this.rows.delete(id);
      return undefined;
    }
    return row;
  }

  async get(id: string) {
    const row = this.live(id);
    return row ? structuredClone(row.rec) : undefined;
  }

  async put(rec: SessionRecord, expiresAt: number) {
    if (expiresAt <= Date.now()) {
      this.rows.delete(rec.id);
      return;
    }
    this.rows.set(rec.id, { rec: structuredClone(rec), expiresAt });
  }

  async delete(id: string) {
    return this.rows.delete(id);
  }

  async listByMember(memberId: string) {
    return [...this.rows.keys()]
      .map((id) => this.live(id))
      .filter((r): r is { rec: SessionRecord; expiresAt: number } => !!r)
      .filter((r) => r.rec.memberId === memberId)
      .map((r) => structuredClone(r.rec));
  }

  async deleteAllFor(memberId: string, keepId?: string) {
    let n = 0;
    for (const [id, row] of [...this.rows])
      if (row.rec.memberId === memberId && id !== keepId && this.rows.delete(id)) n++;
    return n;
  }
}

function isSessionRecord(v: unknown): v is SessionRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.memberId === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.revoked === 'boolean'
  );
}

export class RedisSessionStore implements SessionStore {
  readonly name = 'redis';
  private readonly client: RedisClient;
  private readonly prefix: string;
  private readonly timeoutMs: number;

  constructor(client: RedisClient, prefix: string, timeoutMs = 500) {
    this.client = client;
    this.prefix = `${prefix}sess:`;
    this.timeoutMs = timeoutMs;
  }

  private key(id: string) {
    return `${this.prefix}${id}`;
  }

  private memberKey(memberId: string) {
    return `${this.prefix}m:${memberId}`;
  }

  /** Every call fails fast when Redis is down: an unknown session is a 401, never a guess. */
  private run<T>(p: Promise<T>): Promise<T> {
    return withTimeout(p, this.timeoutMs, 'session store');
  }

  async get(id: string) {
    const raw = await this.run(this.client.get(this.key(id)));
    if (!raw) return undefined;
    const rec: unknown = JSON.parse(raw);
    return isSessionRecord(rec) && rec.id === id ? rec : undefined;
  }

  async put(rec: SessionRecord, expiresAt: number) {
    const ttl = Math.round(expiresAt - Date.now());
    if (ttl <= 0) {
      await this.delete(rec.id);
      return;
    }
    const mk = this.memberKey(rec.memberId);
    const m = this.client.multi();
    m.set(this.key(rec.id), JSON.stringify(rec), { expiration: { type: 'PX', value: ttl } });
    m.sAdd(mk, rec.id);
    // The index lives as long as the member's longest session.
    m.pExpire(mk, ttl, 'GT');
    m.pExpire(mk, ttl, 'NX');
    await this.run(m.exec());
  }

  async delete(id: string) {
    const raw = await this.run(this.client.get(this.key(id)));
    const removed = await this.run(this.client.del(this.key(id)));
    if (raw) {
      const rec: unknown = JSON.parse(raw);
      if (isSessionRecord(rec)) await this.run(this.client.sRem(this.memberKey(rec.memberId), id));
    }
    return removed > 0;
  }

  async listByMember(memberId: string) {
    const ids = await this.run(this.client.sMembers(this.memberKey(memberId)));
    if (!ids.length) return [];
    const raws = await this.run(this.client.mGet(ids.map((id) => this.key(id))));
    const out: SessionRecord[] = [];
    const gone: string[] = [];
    raws.forEach((raw, i) => {
      const rec: unknown = raw ? JSON.parse(raw) : undefined;
      if (isSessionRecord(rec) && rec.memberId === memberId) out.push(rec);
      else gone.push(ids[i]);
    });
    // Expired records leave stale ids in the index; prune them on read.
    if (gone.length) await this.run(this.client.sRem(this.memberKey(memberId), gone));
    return out;
  }

  async deleteAllFor(memberId: string, keepId?: string) {
    const ids = (await this.run(this.client.sMembers(this.memberKey(memberId)))).filter(
      (id) => id !== keepId,
    );
    if (!ids.length) return 0;
    const m = this.client.multi();
    for (const id of ids) m.del(this.key(id));
    m.sRem(this.memberKey(memberId), ids);
    const replies = await this.run(m.exec());
    return replies.slice(0, ids.length).filter((r) => Number(r) > 0).length;
  }
}
