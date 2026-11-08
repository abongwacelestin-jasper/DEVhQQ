/**
 * Personal access tokens (PATs) for CLIs and scripts.
 *
 * Format: `dhq_pat_<id>_<secret>` — `id` is 16 hex chars (the lookup key and
 * the part shown in lists), `secret` is 32 random bytes in base64url. The
 * fixed `dhq_pat_` prefix makes leaked tokens easy to find with secret
 * scanners.
 *
 * Storage: only the SHA-256 of the whole token is kept; the raw value is
 * returned exactly once, at creation. A database leak alone cannot be
 * replayed against the API.
 *
 * Authority: a token carries scopes (`<area>:<level>`, e.g. `project:contribute`)
 * that are intersected with the member's *current* role on every request (see
 * auth/rbac.ts → effectiveLevel). Tokens never satisfy step-up, cannot manage
 * credentials, and stop working the moment the member is not active.
 */

import { randomBytes } from 'node:crypto';
import { createCollection } from '../store/collection.ts';
import { hashToken, safeEqual } from './crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { subscribe } from '../lib/events.ts';
import { listGrants, revokeGrant } from '../auth/jit.ts';
import { repos } from '../data/index.ts';
import {
  GRANTABLE_LEVELS,
  PERMISSION_AREAS,
  permissionMatrix,
  levelAtLeast,
} from '../auth/rbac.ts';
import { HttpError, type PermissionArea, type PermissionLevel, type RoleName } from '../types.ts';

export interface PersonalAccessToken {
  id: string;
  memberId: string;
  name: string;
  /** SHA-256 (hex) of the full token string. */
  hash: string;
  /** Normalised scope strings, e.g. ["project:contribute", "repository:view"]. */
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
}

export const PAT_PREFIX = 'dhq_pat_';
export const PAT_MAX_DAYS = 90;
export const PAT_MAX_ACTIVE_PER_MEMBER = 20;
const PAT_PATTERN = /^dhq_pat_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;
/** lastUsedAt is written at most once a minute per token to avoid write amplification. */
const LAST_USED_WRITE_MS = 60_000;

export const personalAccessTokens = createCollection<PersonalAccessToken>(
  'auth.personal_access_tokens',
);

export function looksLikePat(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

/** Every scope string a token may request. */
export const PAT_SCOPES: string[] = PERMISSION_AREAS.flatMap((area) =>
  GRANTABLE_LEVELS.map((level) => `${area.toLowerCase()}:${level}`),
);

const areaByName = new Map<string, PermissionArea>(
  PERMISSION_AREAS.map((a) => [a.toLowerCase(), a]),
);

/** Parses scope strings into a per-area level map. Throws 422 on unknown or duplicate areas. */
export function parseScopes(scopes: string[]): Partial<Record<PermissionArea, PermissionLevel>> {
  const out: Partial<Record<PermissionArea, PermissionLevel>> = {};
  for (const raw of scopes) {
    const [areaName, level] = raw.split(':');
    const area = areaByName.get(areaName ?? '');
    if (!area || !GRANTABLE_LEVELS.includes(level as (typeof GRANTABLE_LEVELS)[number]))
      throw new HttpError(422, 'validation_failed', `scopes: unknown scope "${raw}"`);
    if (out[area])
      throw new HttpError(422, 'validation_failed', `scopes: "${areaName}" listed more than once`);
    out[area] = level as PermissionLevel;
  }
  return out;
}

/** Rejects scopes above what the member's role grants today (they would be dead weight). */
export function assertScopesWithinRole(scopes: string[], role: RoleName) {
  const parsed = parseScopes(scopes);
  const over = (Object.entries(parsed) as [PermissionArea, PermissionLevel][])
    .filter(([area, level]) => !levelAtLeast(permissionMatrix[area][role], level))
    .map(([area, level]) => `${area.toLowerCase()}:${level}`);
  if (over.length)
    throw new HttpError(
      422,
      'scope_exceeds_role',
      `Your role (${role}) does not grant: ${over.join(', ')}`,
      { scopes: over },
    );
}

export function publicToken(t: PersonalAccessToken) {
  const now = Date.now();
  return {
    id: t.id,
    name: t.name,
    prefix: `${PAT_PREFIX}${t.id}`,
    scopes: t.scopes,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt ?? null,
    status: t.revokedAt ? 'revoked' : Date.parse(t.expiresAt) <= now ? 'expired' : 'active',
    revokedAt: t.revokedAt ?? null,
    revokedReason: t.revokedReason ?? null,
  };
}

export function activeTokenCount(memberId: string): number {
  const now = Date.now();
  let n = 0;
  for (const t of personalAccessTokens.values())
    if (t.memberId === memberId && !t.revokedAt && Date.parse(t.expiresAt) > now) n++;
  return n;
}

/** Creates a token. Returns the record and the raw token, which must be shown once and discarded. */
export function issueToken(input: {
  memberId: string;
  name: string;
  scopes: string[];
  expiresInDays: number;
}): { record: PersonalAccessToken; token: string } {
  const id = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const token = `${PAT_PREFIX}${id}_${secret}`;
  const now = Date.now();
  const record: PersonalAccessToken = {
    id,
    memberId: input.memberId,
    name: input.name,
    hash: hashToken(token),
    scopes: [...new Set(input.scopes)].sort(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.expiresInDays * 86_400_000).toISOString(),
  };
  personalAccessTokens.set(id, record);
  return { record, token };
}

export function revokeToken(
  t: PersonalAccessToken,
  by: string,
  reason: string,
  requestId?: string,
) {
  if (t.revokedAt) return false;
  t.revokedAt = new Date().toISOString();
  t.revokedBy = by;
  t.revokedReason = reason;
  personalAccessTokens.save(t.id);
  audit.append({
    actor: by,
    action: 'token.revoked',
    target: `${PAT_PREFIX}${t.id} (${t.name}) of ${t.memberId} · ${reason}`,
    sensitive: true,
    requestId,
  });
  return true;
}

/**
 * Revokes every live token a member holds. Call on deactivation, offboarding
 * or suspected compromise. Returns the number revoked.
 */
export function revokeTokensFor(memberId: string, by: string, reason: string, requestId?: string) {
  let n = 0;
  for (const t of personalAccessTokens.values())
    if (t.memberId === memberId && revokeToken(t, by, reason, requestId)) n++;
  return n;
}

/**
 * Resolves a presented PAT. Fails closed with 401 for malformed, unknown,
 * revoked or expired tokens, and revokes tokens whose owner is no longer
 * active.
 */
export async function verifyPat(token: string, ip: string): Promise<PersonalAccessToken> {
  const m = PAT_PATTERN.exec(token);
  const invalid = new HttpError(401, 'invalid_token', 'Invalid access token');
  if (!m) throw invalid;
  const record = personalAccessTokens.get(m[1]);
  // Hash comparison runs even for unknown ids so timing does not reveal which ids exist.
  const ok = safeEqual(hashToken(token), record?.hash ?? '0'.repeat(64));
  if (!record || !ok) throw invalid;
  if (record.revokedAt) throw new HttpError(401, 'token_revoked', 'Access token was revoked');
  if (Date.parse(record.expiresAt) <= Date.now())
    throw new HttpError(401, 'token_expired', 'Access token has expired');
  const member = await repos.members.get(record.memberId);
  if (!member || member.status !== 'active') {
    revokeToken(record, 'system', 'member_inactive');
    throw new HttpError(401, 'account_inactive', 'Account is not active');
  }
  const last = record.lastUsedAt ? Date.parse(record.lastUsedAt) : 0;
  if (Date.now() - last > LAST_USED_WRITE_MS || record.lastUsedIp !== ip) {
    record.lastUsedAt = new Date().toISOString();
    record.lastUsedIp = ip;
    personalAccessTokens.save(record.id);
  }
  return record;
}

/** Sweeps tokens whose owner was deactivated by any route, so revocation does not wait for use. */
export async function sweepInactiveMembers(): Promise<number> {
  let n = 0;
  const owners = await repos.members.getMany(
    [...personalAccessTokens.values()].filter((t) => !t.revokedAt).map((t) => t.memberId),
  );
  for (const t of personalAccessTokens.values()) {
    if (t.revokedAt) continue;
    const member = owners.get(t.memberId);
    if (!member || member.status !== 'active') if (revokeToken(t, 'system', 'member_inactive')) n++;
  }
  return n;
}

/**
 * Cuts every standing credential a member holds besides sessions: personal
 * access tokens and JIT production grants (active or pending). Each
 * revocation is audited individually, plus one summary entry.
 */
export function revokeStandingAccess(
  memberId: string,
  by: string,
  reason: string,
  requestId?: string,
): { tokens: number; grants: number } {
  const tokens = revokeTokensFor(memberId, by, reason, requestId);
  let grants = 0;
  for (const g of listGrants())
    if (g.memberId === memberId && (g.status === 'active' || g.status === 'pending')) {
      revokeGrant(g.id, by);
      grants++;
    }
  audit.append({
    actor: by,
    action: 'security.member_access_revoked',
    target: `${memberId} · ${reason} · ${tokens} token(s), ${grants} JIT grant(s)`,
    sensitive: true,
    requestId,
  });
  return { tokens, grants };
}

// Offboarding (B-COLLAB) publishes `member.deactivated {memberId, reason?}`.
subscribe((e) => {
  if (e.type !== 'member.deactivated') return;
  const memberId = e.data.memberId;
  if (typeof memberId !== 'string' || !memberId) return;
  const reason = typeof e.data.reason === 'string' ? e.data.reason : 'member_deactivated';
  revokeStandingAccess(memberId, 'system', `member_deactivated:${reason}`);
});

setInterval(() => void sweepInactiveMembers().catch(() => undefined), 30_000).unref();
