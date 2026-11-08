/**
 * Members repository: people, their role and product scope, and the
 * credentials attached to them (scrypt password hash, sealed TOTP secret,
 * hashed backup codes, passkey public keys, hashed invite token).
 *
 * Query on demand: nothing is cached in the process. Every call reads the
 * committed state, so a write through one replica is visible to the next
 * request on any other replica.
 *
 * Writes:
 *  - `put(m)`     upsert of the whole row (last writer wins on that row),
 *  - `insert(m)`  create only; reports an id or email collision instead of
 *                 overwriting (the unique index decides, not a prior read),
 *  - `update(id, fn)`  atomic read-modify-write: the row is locked
 *                 (`SELECT … FOR UPDATE`) while `fn` mutates it, so two
 *                 replicas counting failed sign-ins never lose an increment.
 *
 * Secrets are stored exactly as the application holds them (sealed /
 * hashed); this module never seals, opens or logs them.
 */

import type { Member, ProductId, RoleName } from '../types.ts';
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
  json,
  num,
  pageLimit,
  text,
  type DocumentMirror,
  type Page,
  type PageOptions,
  type Queryable,
  noMirror,
} from './common.ts';

export type InsertResult = 'ok' | 'id_taken' | 'email_taken';

export interface MemberFilter {
  status?: Member['status'];
  role?: RoleName;
  product?: ProductId;
}

export interface MembersRepo {
  get(id: string): Promise<Member | undefined>;
  getMany(ids: Iterable<string>): Promise<Map<string, Member>>;
  findByEmail(email: string): Promise<Member | undefined>;
  findByInviteTokenHash(hash: string): Promise<Member | undefined>;
  /** The member holding a passkey with this credential id (ids are globally unique). */
  findByPasskey(credentialId: string): Promise<Member | undefined>;
  /** Members in insertion order. Bounded by the organisation's size. */
  list(filter?: MemberFilter): Promise<Member[]>;
  /** Keyset page in insertion order. */
  page(opts?: PageOptions & MemberFilter): Promise<Page<Member>>;
  count(filter?: MemberFilter): Promise<number>;
  insert(m: Member): Promise<InsertResult>;
  put(m: Member): Promise<void>;
  /** Locks the row, applies `fn`, writes it back. Returns the new row (undefined if absent). */
  update(id: string, fn: (m: Member) => void): Promise<Member | undefined>;
  delete(id: string): Promise<boolean>;
}

type Listener = (memberId: string) => void;
const listeners = new Set<Listener>();

/**
 * Local hook fired after this process changes a member (used by the realtime
 * hub to refresh a stream's cached role/products immediately; other replicas
 * pick the change up on their next heartbeat).
 */
export function onMemberWrite(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(id: string) {
  for (const fn of listeners) {
    try {
      fn(id);
    } catch {
      // a listener never fails a write
    }
  }
}

/** A copy for a caller, remembered for field-level `put`. */
const out = (m: Member): Member => remember(clone(m));

const matches = (m: Member, f: MemberFilter = {}) =>
  (!f.status || m.status === f.status) &&
  (!f.role || m.role === f.role) &&
  (!f.product || m.products.includes(f.product));

// ─── in-memory implementation (tests, development without DATABASE_URL) ───

export class MemoryMembersRepo implements MembersRepo {
  private readonly rows = new Map<string, Member>();
  private seq = new Map<string, number>();
  private next = 0;

  async get(id: string) {
    const m = this.rows.get(id);
    return m && out(m);
  }
  async getMany(ids: Iterable<string>) {
    const found = new Map<string, Member>();
    for (const id of ids) {
      const m = this.rows.get(id);
      if (m) found.set(id, out(m));
    }
    return found;
  }
  async findByEmail(email: string) {
    const e = email.trim().toLowerCase();
    for (const m of this.rows.values()) if (m.email.toLowerCase() === e) return out(m);
    return undefined;
  }
  async findByInviteTokenHash(hash: string) {
    for (const m of this.rows.values()) if (m.inviteTokenHash === hash) return out(m);
    return undefined;
  }
  async findByPasskey(credentialId: string) {
    for (const m of this.rows.values())
      if (m.passkeys.some((k) => k.id === credentialId)) return out(m);
    return undefined;
  }
  async list(filter?: MemberFilter) {
    return [...this.rows.values()].filter((m) => matches(m, filter)).map(out);
  }
  async page(opts: PageOptions & MemberFilter = {}) {
    const limit = pageLimit(opts.limit);
    const after = decodeCursor(opts.cursor, 1);
    const from = after ? Number(after[0]) : -1;
    const rows = [...this.rows.values()].filter(
      (m) => matches(m, opts) && (this.seq.get(m.id) ?? 0) > from,
    );
    const items = rows.slice(0, limit).map(out);
    const last = items[items.length - 1];
    return {
      items,
      ...(rows.length > limit && last
        ? { nextCursor: encodeCursor([this.seq.get(last.id) ?? 0]) }
        : {}),
    };
  }
  async count(filter?: MemberFilter) {
    let n = 0;
    for (const m of this.rows.values()) if (matches(m, filter)) n++;
    return n;
  }
  async insert(m: Member): Promise<InsertResult> {
    if (this.rows.has(m.id)) return 'id_taken';
    const e = m.email.toLowerCase();
    for (const x of this.rows.values()) if (x.email.toLowerCase() === e) return 'email_taken';
    this.write(m);
    return 'ok';
  }
  async put(m: Member) {
    const fields = changedFields(m);
    const stored = this.rows.get(m.id);
    if (fields && stored) {
      if (!fields.length) return;
      applyChanges(stored, m, fields);
      remember(m);
      changed(m.id);
      return;
    }
    this.write(m);
    remember(m);
  }
  async update(id: string, fn: (m: Member) => void) {
    const cur = this.rows.get(id);
    if (!cur) return undefined;
    const next = clone(cur);
    fn(next);
    this.write(next);
    return out(next);
  }
  async delete(id: string) {
    const existed = this.rows.delete(id);
    this.seq.delete(id);
    if (existed) changed(id);
    return existed;
  }
  private write(m: Member) {
    if (!this.seq.has(m.id)) this.seq.set(m.id, ++this.next);
    this.rows.set(m.id, clone(m));
    changed(m.id);
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────────────

const KNOWN = [
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
] as const;

interface MemberRow {
  seq: string;
  id: string;
  name: string;
  email: string;
  role: string;
  products: string[];
  status: string;
  password_hash: string;
  totp_secret: string | null;
  backup_codes: Member['backupCodes'] | null;
  passkeys: Member['passkeys'];
  failed_logins: number;
  locked_until: string | null;
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  nda_signed_at: string | null;
  nda_version: string | null;
  profile: Member['profile'] | null;
  offboarding: Member['offboarding'] | null;
  extra: Record<string, unknown> | null;
}

const COLUMNS = `seq, id, name, email, role, products, status, password_hash, totp_secret,
  backup_codes, passkeys, failed_logins, locked_until, invite_token_hash, invite_expires_at,
  nda_signed_at, nda_version, profile, offboarding, extra`;

function fromRow(r: MemberRow): Member {
  // Field order matches how members were always built (seed / invite).
  return remember(
    compact({
      ...(r.extra ?? {}),
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role as RoleName,
      products: r.products as ProductId[],
      status: r.status as Member['status'],
      passwordHash: r.password_hash,
      passkeys: r.passkeys ?? [],
      failedLogins: r.failed_logins,
      totpSecret: r.totp_secret ?? undefined,
      backupCodes: r.backup_codes ?? undefined,
      lockedUntil: num(r.locked_until),
      inviteTokenHash: r.invite_token_hash ?? undefined,
      inviteExpiresAt: num(r.invite_expires_at),
      ndaSignedAt: r.nda_signed_at ?? undefined,
      ndaVersion: r.nda_version ?? undefined,
      profile: r.profile ?? undefined,
      offboarding: r.offboarding ?? undefined,
    }),
  );
}

/** Member field → column, value and cast, for field-level updates. */
const FIELD_COLUMNS: Record<string, [string, (m: Member) => unknown, string]> = {
  name: ['name', (m) => text(m.name), ''],
  email: ['email', (m) => text(m.email), ''],
  role: ['role', (m) => m.role, ''],
  products: ['products', (m) => m.products, '::text[]'],
  status: ['status', (m) => m.status, ''],
  passwordHash: ['password_hash', (m) => text(m.passwordHash), ''],
  totpSecret: ['totp_secret', (m) => text(m.totpSecret), ''],
  backupCodes: ['backup_codes', (m) => json(m.backupCodes), '::jsonb'],
  passkeys: ['passkeys', (m) => json(m.passkeys ?? []), '::jsonb'],
  failedLogins: ['failed_logins', (m) => m.failedLogins ?? 0, ''],
  lockedUntil: ['locked_until', (m) => m.lockedUntil ?? null, ''],
  inviteTokenHash: ['invite_token_hash', (m) => text(m.inviteTokenHash), ''],
  inviteExpiresAt: ['invite_expires_at', (m) => m.inviteExpiresAt ?? null, ''],
  ndaSignedAt: ['nda_signed_at', (m) => text(m.ndaSignedAt), ''],
  ndaVersion: ['nda_version', (m) => text(m.ndaVersion), ''],
  profile: ['profile', (m) => json(m.profile), '::jsonb'],
  offboarding: ['offboarding', (m) => json(m.offboarding), '::jsonb'],
};

function params(m: Member): unknown[] {
  return [
    ORG_ID,
    text(m.id),
    text(m.name),
    text(m.email),
    m.role,
    m.products,
    m.status,
    text(m.passwordHash),
    text(m.totpSecret),
    json(m.backupCodes),
    json(m.passkeys ?? []),
    m.failedLogins ?? 0,
    m.lockedUntil ?? null,
    text(m.inviteTokenHash),
    m.inviteExpiresAt ?? null,
    text(m.ndaSignedAt),
    text(m.ndaVersion),
    json(m.profile),
    json(m.offboarding),
    json(extras(m, KNOWN)) ?? '{}',
  ];
}

const VALUES = `$1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15,
  $16, $17, $18::jsonb, $19::jsonb, $20::jsonb`;
const INSERT_COLS = `org_id, id, name, email, role, products, status, password_hash, totp_secret,
  backup_codes, passkeys, failed_logins, locked_until, invite_token_hash, invite_expires_at,
  nda_signed_at, nda_version, profile, offboarding, extra`;
const UPDATE_SET = `name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
  products = EXCLUDED.products, status = EXCLUDED.status, password_hash = EXCLUDED.password_hash,
  totp_secret = EXCLUDED.totp_secret, backup_codes = EXCLUDED.backup_codes,
  passkeys = EXCLUDED.passkeys, failed_logins = EXCLUDED.failed_logins,
  locked_until = EXCLUDED.locked_until, invite_token_hash = EXCLUDED.invite_token_hash,
  invite_expires_at = EXCLUDED.invite_expires_at, nda_signed_at = EXCLUDED.nda_signed_at,
  nda_version = EXCLUDED.nda_version, profile = EXCLUDED.profile,
  offboarding = EXCLUDED.offboarding, extra = EXCLUDED.extra, updated_at = now()`;

function where(f: MemberFilter, args: unknown[]): string {
  const parts = ['org_id = $1'];
  if (f.status) parts.push(`status = $${args.push(f.status)}`);
  if (f.role) parts.push(`role = $${args.push(f.role)}`);
  if (f.product) parts.push(`$${args.push(f.product)} = ANY (products)`);
  return parts.join(' AND ');
}

export interface TxPool extends Queryable {
  connect(): Promise<Queryable & { release(destroy?: boolean): void }>;
}

/** Runs `fn` in a transaction on a dedicated connection. */
export async function inTransaction<T>(pool: TxPool, fn: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    client.release();
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch {
      client.release(true);
    }
    throw err;
  }
}

function pgCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}
function pgConstraint(err: unknown): string {
  return err && typeof err === 'object' && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : '';
}

export class PgMembersRepo implements MembersRepo {
  private readonly pool: TxPool;
  private readonly mirror: DocumentMirror;

  constructor(pool: TxPool, mirror: DocumentMirror = noMirror) {
    this.pool = pool;
    this.mirror = mirror;
  }

  private async one(sql: string, args: unknown[]) {
    const res = await this.pool.query<MemberRow>(sql, args);
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  get(id: string) {
    return this.one(`SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND id = $2`, [ORG_ID, id]);
  }
  async getMany(ids: Iterable<string>) {
    const list = [...new Set(ids)];
    const out = new Map<string, Member>();
    if (!list.length) return out;
    const res = await this.pool.query<MemberRow>(
      `SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND id = ANY ($2::text[])`,
      [ORG_ID, list],
    );
    for (const r of res.rows) out.set(r.id, fromRow(r));
    return out;
  }
  findByEmail(email: string) {
    return this.one(`SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND lower(email) = $2`, [
      ORG_ID,
      email.trim().toLowerCase(),
    ]);
  }
  findByInviteTokenHash(hash: string) {
    return this.one(`SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND invite_token_hash = $2`, [
      ORG_ID,
      hash,
    ]);
  }
  findByPasskey(credentialId: string) {
    return this.one(
      `SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND passkeys @> $2::jsonb LIMIT 1`,
      [ORG_ID, JSON.stringify([{ id: credentialId }])],
    );
  }
  async list(filter: MemberFilter = {}) {
    const args: unknown[] = [ORG_ID];
    const res = await this.pool.query<MemberRow>(
      `SELECT ${COLUMNS} FROM members WHERE ${where(filter, args)} ORDER BY seq`,
      args,
    );
    return res.rows.map(fromRow);
  }
  async page(opts: PageOptions & MemberFilter = {}) {
    const limit = pageLimit(opts.limit);
    const args: unknown[] = [ORG_ID];
    let cond = where(opts, args);
    const after = decodeCursor(opts.cursor, 1);
    if (after) cond += ` AND seq > $${args.push(Number(after[0]))}`;
    args.push(limit + 1);
    const res = await this.pool.query<MemberRow>(
      `SELECT ${COLUMNS} FROM members WHERE ${cond} ORDER BY seq LIMIT $${args.length}`,
      args,
    );
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(fromRow),
      ...(res.rows.length > limit && last ? { nextCursor: encodeCursor([Number(last.seq)]) } : {}),
    };
  }
  async count(filter: MemberFilter = {}) {
    const args: unknown[] = [ORG_ID];
    const res = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM members WHERE ${where(filter, args)}`,
      args,
    );
    return Number(res.rows[0]?.n ?? 0);
  }
  async insert(m: Member): Promise<InsertResult> {
    try {
      await this.pool.query(`INSERT INTO members (${INSERT_COLS}) VALUES (${VALUES})`, params(m));
    } catch (err) {
      if (pgCode(err) === '23505')
        return pgConstraint(err) === 'members_email_unique' ? 'email_taken' : 'id_taken';
      throw err;
    }
    this.after(m);
    return 'ok';
  }
  async put(m: Member) {
    const fields = changedFields(m);
    if (fields) {
      if (!fields.length) return;
      // Only what this caller changed: a concurrent change to another field survives.
      const args: unknown[] = [ORG_ID, m.id];
      const sets: string[] = [];
      let extra = false;
      for (const f of fields) {
        const col = FIELD_COLUMNS[f];
        if (col) sets.push(`${col[0]} = $${args.push(col[1](m))}${col[2]}`);
        else if (f !== 'id') extra = true;
      }
      if (extra) sets.push(`extra = $${args.push(json(extras(m, KNOWN)) ?? '{}')}::jsonb`);
      const res = await this.pool.query<MemberRow>(
        `UPDATE members SET ${sets.join(', ')}, updated_at = now()
         WHERE org_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
        args,
      );
      if (res.rows[0]) {
        remember(m);
        this.after(fromRow(res.rows[0]));
        return;
      }
    }
    await this.pool.query(
      `INSERT INTO members (${INSERT_COLS}) VALUES (${VALUES})
       ON CONFLICT (org_id, id) DO UPDATE SET ${UPDATE_SET}`,
      params(m),
    );
    remember(m);
    this.after(m);
  }
  async update(id: string, fn: (m: Member) => void) {
    const next = await inTransaction(this.pool, async (c) => {
      const res = await c.query<MemberRow>(
        `SELECT ${COLUMNS} FROM members WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ORG_ID, id],
      );
      if (!res.rows[0]) return undefined;
      const m = fromRow(res.rows[0]);
      fn(m);
      await c.query(
        `INSERT INTO members (${INSERT_COLS}) VALUES (${VALUES})
         ON CONFLICT (org_id, id) DO UPDATE SET ${UPDATE_SET}`,
        params(m),
      );
      return m;
    });
    if (next) {
      remember(next);
      this.after(next);
    }
    return next;
  }
  async delete(id: string) {
    const res = await this.pool.query('DELETE FROM members WHERE org_id = $1 AND id = $2', [
      ORG_ID,
      id,
    ]);
    const existed = (res.rowCount ?? 0) > 0;
    if (existed) {
      this.mirror.remove('members', id);
      changed(id);
    }
    return existed;
  }
  private after(m: Member) {
    this.mirror.write('members', m.id, m);
    changed(m.id);
  }
}
