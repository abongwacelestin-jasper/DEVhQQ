/**
 * Session storage for auth/sessions.ts (ADR 0011).
 *
 * Decision: sessions live in PostgreSQL in phase 1 (`sessions` table, next to
 * members, durable and auditable, no extra component). The store implements
 * the shared `SessionStore` contract from auth/sessionStore.ts (the Redis
 * lane's seam, which also has a Redis implementation), plus three admin
 * reads the console needs (`AdminSessionStore`). Moving sessions to Redis
 * later means giving `RedisSessionStore` those three methods (SCAN-based) and
 * installing it as `repos.sessions`; auth/sessions.ts does not change.
 *
 * Records are keyed by SHA-256 of the token's random id; neither the token nor
 * the raw id is ever stored (auth/sessions.ts). A revoked session is deleted,
 * so `get` returning a row means "live" for every replica at once.
 */

import type { GeoLocation } from '../types.ts';
import {
  ORG_ID,
  clone,
  compact,
  extras,
  json,
  num,
  text,
  type DocumentMirror,
  type Queryable,
  noMirror,
} from './common.ts';

import type { SessionStore } from '../auth/sessionStore.ts';

export type SessionStage = 'password' | 'verified';

export interface SessionRecord {
  /** Opaque handle: SHA-256 (base64url) of the random id inside the token. Never the token itself. */
  id: string;
  memberId: string;
  stage: SessionStage;
  createdAt: number;
  lastSeenAt: number;
  /** Last strong verification (TOTP or passkey). 0 = step-up required. */
  verifiedAt: number;
  uaHash: string;
  /** Short, human-readable client label, e.g. "Chrome · macOS". Never the raw UA. */
  client: string;
  ip: string;
  location: GeoLocation;
  revoked: boolean;
  method: 'password' | 'passkey';
  /** Replay guard for TOTP. */
  lastTotpCounter: number;
}

/** The shared contract plus the admin reads the console uses. */
export interface AdminSessionStore extends SessionStore {
  /** Every session, newest activity first, at most `limit`. */
  listAll(limit?: number): Promise<SessionRecord[]>;
  /** Deletes sessions created before `cutoffMs`. Returns how many. */
  deleteCreatedBefore(cutoffMs: number): Promise<number>;
  count(): Promise<number>;
}

const byActivity = (a: SessionRecord, b: SessionRecord) => b.lastSeenAt - a.lastSeenAt;

/** One process (tests, development). Lists are newest activity first. */
export class MemorySessionStore implements AdminSessionStore {
  readonly name = 'memory';
  private readonly rows = new Map<string, SessionRecord>();

  async get(id: string) {
    const s = this.rows.get(id);
    return s && clone(s);
  }
  async put(s: SessionRecord, expiresAt?: number) {
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.rows.delete(s.id);
      return;
    }
    this.rows.set(s.id, clone({ ...s, revoked: false }));
  }
  async refresh(s: SessionRecord, expiresAt?: number) {
    if (!this.rows.has(s.id)) return false;
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.rows.delete(s.id);
      return false;
    }
    this.rows.set(s.id, clone({ ...s, revoked: false }));
    return true;
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
  async listByMember(memberId: string) {
    return [...this.rows.values()]
      .filter((s) => s.memberId === memberId)
      .sort(byActivity)
      .map(clone);
  }
  async listAll(limit = 1000) {
    return [...this.rows.values()].sort(byActivity).slice(0, limit).map(clone);
  }
  async deleteAllFor(memberId: string, keepId?: string) {
    let n = 0;
    for (const s of [...this.rows.values()])
      if (s.memberId === memberId && s.id !== keepId) {
        this.rows.delete(s.id);
        n++;
      }
    return n;
  }
  async deleteCreatedBefore(cutoffMs: number) {
    let n = 0;
    for (const s of [...this.rows.values()])
      if (s.createdAt < cutoffMs) {
        this.rows.delete(s.id);
        n++;
      }
    return n;
  }
  async count() {
    return this.rows.size;
  }
}

const KNOWN = [
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
] as const;

interface SessionRow {
  id: string;
  member_id: string;
  stage: string;
  method: string;
  created_at: string;
  last_seen_at: string;
  verified_at: string;
  ua_hash: string;
  client: string;
  ip: string;
  location: GeoLocation;
  last_totp_counter: string;
  extra: Record<string, unknown> | null;
}

const COLUMNS = `id, member_id, stage, method, created_at, last_seen_at, verified_at, ua_hash,
  client, ip, location, last_totp_counter, extra`;

function fromRow(r: SessionRow): SessionRecord {
  return compact({
    ...(r.extra ?? {}),
    id: r.id,
    memberId: r.member_id,
    stage: r.stage as SessionStage,
    createdAt: num(r.created_at) ?? 0,
    lastSeenAt: num(r.last_seen_at) ?? 0,
    verifiedAt: num(r.verified_at) ?? 0,
    uaHash: r.ua_hash,
    client: r.client,
    ip: r.ip,
    location: r.location,
    revoked: false,
    method: r.method as SessionRecord['method'],
    lastTotpCounter: num(r.last_totp_counter) ?? -1,
  });
}

export class PgSessionStore implements AdminSessionStore {
  readonly name = 'postgres';
  private readonly pool: Queryable;
  private readonly mirror: DocumentMirror;

  constructor(pool: Queryable, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }

  async get(id: string) {
    const res = await this.pool.query<SessionRow>(
      `SELECT ${COLUMNS} FROM sessions WHERE org_id = $1 AND id = $2`,
      [ORG_ID, id],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }
  /** `expiresAt` is implied by created_at + the absolute lifetime; validateSession enforces it. */
  async put(s: SessionRecord, expiresAt?: number) {
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.delete(s.id);
      return;
    }
    await this.pool.query(
      `INSERT INTO sessions (org_id, id, member_id, stage, method, created_at, last_seen_at,
         verified_at, ua_hash, client, ip, location, last_totp_counter, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb)
       ON CONFLICT (org_id, id) DO UPDATE SET stage = EXCLUDED.stage, method = EXCLUDED.method,
         last_seen_at = EXCLUDED.last_seen_at, verified_at = EXCLUDED.verified_at,
         ua_hash = EXCLUDED.ua_hash, client = EXCLUDED.client, ip = EXCLUDED.ip,
         location = EXCLUDED.location, last_totp_counter = EXCLUDED.last_totp_counter,
         extra = EXCLUDED.extra`,
      [
        ORG_ID,
        s.id,
        s.memberId,
        s.stage,
        s.method,
        s.createdAt,
        s.lastSeenAt,
        s.verifiedAt,
        s.uaHash,
        text(s.client),
        text(s.ip),
        json(s.location) ?? '{}',
        s.lastTotpCounter,
        json(extras(s, KNOWN)) ?? '{}',
      ],
    );
    this.mirror.write('sessions', s.id, { ...s, revoked: false });
  }
  /** UPDATE only: a row deleted by a concurrent revoke stays deleted (W5-01). */
  async refresh(s: SessionRecord, expiresAt?: number) {
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.delete(s.id);
      return false;
    }
    const res = await this.pool.query(
      `UPDATE sessions SET stage = $3, method = $4, last_seen_at = $5, verified_at = $6,
         ua_hash = $7, client = $8, ip = $9, location = $10::jsonb, last_totp_counter = $11,
         extra = $12::jsonb
       WHERE org_id = $1 AND id = $2`,
      [
        ORG_ID,
        s.id,
        s.stage,
        s.method,
        s.lastSeenAt,
        s.verifiedAt,
        s.uaHash,
        text(s.client),
        text(s.ip),
        json(s.location) ?? '{}',
        s.lastTotpCounter,
        json(extras(s, KNOWN)) ?? '{}',
      ],
    );
    const updated = (res.rowCount ?? 0) > 0;
    if (updated) this.mirror.write('sessions', s.id, { ...s, revoked: false });
    return updated;
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM sessions WHERE org_id = $1 AND id = $2', [
      ORG_ID,
      id,
    ]);
    this.mirror.remove('sessions', id);
    return (res.rowCount ?? 0) > 0;
  }
  async listByMember(memberId: string) {
    const res = await this.pool.query<SessionRow>(
      `SELECT ${COLUMNS} FROM sessions WHERE org_id = $1 AND member_id = $2
       ORDER BY last_seen_at DESC`,
      [ORG_ID, memberId],
    );
    return res.rows.map(fromRow);
  }
  async listAll(limit = 1000) {
    const res = await this.pool.query<SessionRow>(
      `SELECT ${COLUMNS} FROM sessions WHERE org_id = $1 ORDER BY last_seen_at DESC LIMIT $2`,
      [ORG_ID, limit],
    );
    return res.rows.map(fromRow);
  }
  async deleteAllFor(memberId: string, keepId?: string) {
    const res = await this.pool.query<{ id: string }>(
      `DELETE FROM sessions WHERE org_id = $1 AND member_id = $2 AND id IS DISTINCT FROM $3
       RETURNING id`,
      [ORG_ID, memberId, keepId ?? null],
    );
    for (const r of res.rows) this.mirror.remove('sessions', r.id);
    return res.rows.length;
  }
  async deleteCreatedBefore(cutoffMs: number) {
    const res = await this.pool.query<{ id: string }>(
      'DELETE FROM sessions WHERE org_id = $1 AND created_at < $2 RETURNING id',
      [ORG_ID, cutoffMs],
    );
    for (const r of res.rows) this.mirror.remove('sessions', r.id);
    return res.rows.length;
  }
  async count() {
    const res = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM sessions WHERE org_id = $1',
      [ORG_ID],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
}
