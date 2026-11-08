/**
 * Just-in-time (JIT) privileged access.
 *
 * Nobody holds standing production rights. A member requests a scoped,
 * time-boxed grant with a reason; a *different* approver with the right role
 * signs it off (two-person rule); the grant expires automatically and every
 * step is written to the tamper-evident audit log.
 */

import { randomToken } from '../security/crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { createCollection } from '../store/collection.ts';
import { HttpError, type ProductId, type RoleName } from '../types.ts';

export interface Grant {
  id: string;
  memberId: string;
  /** `production:<product>`, e.g. "production:renewberry" (see `productionScope`). */
  scope: string;
  reason: string;
  requestedAt: number;
  durationMs: number;
  status: 'pending' | 'active' | 'expired' | 'revoked' | 'denied';
  approvedBy?: string;
  expiresAt?: number;
}

const MAX_DURATION_MS = 8 * 60 * 60_000;
export const APPROVER_ROLES: RoleName[] = ['Owner', 'Operations'];
const SCOPE_PATTERN = /^production:(renewberry|blog|mirror)$/;

/** The one scope format grants are issued for and production-impacting routes demand. */
export function productionScope(product: ProductId): string {
  return `production:${product}`;
}
/** Persisted so pending approvals and active (time-boxed) grants survive a restart. */
const grants = createCollection<Grant>('jitGrants');

export function requestGrant(
  memberId: string,
  scope: string,
  reason: string,
  durationMs: number,
  requestId?: string,
): Grant {
  if (!SCOPE_PATTERN.test(scope)) throw new HttpError(422, 'scope_invalid', 'Unknown scope');
  if (reason.trim().length < 10)
    throw new HttpError(422, 'reason_required', 'Give a reason of at least 10 characters');
  const g: Grant = {
    id: randomToken(12),
    memberId,
    scope,
    reason: reason.trim(),
    requestedAt: Date.now(),
    durationMs: Math.min(durationMs, MAX_DURATION_MS),
    status: 'pending',
  };
  grants.set(g.id, g);
  audit.append({
    actor: memberId,
    action: 'jit.requested',
    target: `${scope} · ${Math.round(g.durationMs / 60_000)}m`,
    sensitive: true,
    requestId,
  });
  return g;
}

export function approveGrant(
  id: string,
  approver: { memberId: string; role: RoleName },
  requestId?: string,
): Grant {
  const g = grants.get(id);
  if (!g || g.status !== 'pending') throw new HttpError(404, 'not_found', 'No pending grant');
  if (g.memberId === approver.memberId)
    throw new HttpError(403, 'self_approval', 'You can’t approve your own access');
  if (!APPROVER_ROLES.includes(approver.role))
    throw new HttpError(403, 'forbidden', 'Only Owners or Operations can approve');
  g.status = 'active';
  g.approvedBy = approver.memberId;
  g.expiresAt = Date.now() + g.durationMs;
  grants.save(g.id);
  audit.append({
    actor: approver.memberId,
    action: 'jit.approved',
    target: `${g.memberId} → ${g.scope}`,
    sensitive: true,
    requestId,
  });
  return g;
}

export function revokeGrant(id: string, by: string, requestId?: string): Grant {
  const g = grants.get(id);
  if (!g || (g.status !== 'active' && g.status !== 'pending'))
    throw new HttpError(404, 'not_found', 'No active grant');
  g.status = g.status === 'pending' ? 'denied' : 'revoked';
  grants.save(g.id);
  audit.append({
    actor: by,
    action: `jit.${g.status}`,
    target: `${g.memberId} → ${g.scope}`,
    sensitive: true,
    requestId,
  });
  return g;
}

/**
 * Live = approved and not past `expiresAt` *now*. Expiry is decided by the
 * clock on every read, never by the sweeper below, so an elapsed grant stops
 * working on the next request even if the sweeper has not run yet.
 */
function isLive(g: Grant, now: number): boolean {
  return g.status === 'active' && (g.expiresAt ?? 0) > now;
}

/** Active scopes for a member — read on every request when building the principal. */
export function activeElevations(memberId: string): string[] {
  const now = Date.now();
  return [...grants.values()]
    .filter((g) => g.memberId === memberId && isLive(g, now))
    .map((g) => g.scope);
}

/** The live grant that gives `memberId` the `scope`, if any (the one expiring last). */
export function activeGrantFor(memberId: string, scope: string): Grant | undefined {
  const now = Date.now();
  return [...grants.values()]
    .filter((g) => g.memberId === memberId && g.scope === scope && isLive(g, now))
    .sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
}

export function getGrant(id: string): Grant | undefined {
  return grants.get(id);
}

/** The product a `production:<product>` scope names. */
export function grantProduct(g: Pick<Grant, 'scope'>): ProductId {
  return g.scope.split(':')[1] as ProductId;
}

export function listGrants(): Grant[] {
  return [...grants.values()].sort((a, b) => b.requestedAt - a.requestedAt);
}

/** A member's own grants, newest first — what the requester sees beside the action. */
export function grantsOf(memberId: string): Grant[] {
  return listGrants().filter((g) => g.memberId === memberId);
}

/** Marks every elapsed active grant `expired` and audits it. Returns how many changed. */
export function expireDueGrants(now = Date.now()): number {
  let n = 0;
  for (const g of grants.values()) {
    if (g.status === 'active' && (g.expiresAt ?? 0) <= now) {
      g.status = 'expired';
      grants.save(g.id);
      n++;
      audit.append({
        actor: 'system',
        action: 'jit.expired',
        target: `${g.memberId} → ${g.scope}`,
        sensitive: true,
      });
    }
  }
  return n;
}

// Records expiry in the grant list and the audit log. Enforcement does not wait for it.
setInterval(() => expireDueGrants(), 15_000).unref();
