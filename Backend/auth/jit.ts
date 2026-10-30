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
import { HttpError, type RoleName } from '../types.ts';

export interface Grant {
  id: string;
  memberId: string;
  /** e.g. "production:renewberry" */
  scope: string;
  reason: string;
  requestedAt: number;
  durationMs: number;
  status: 'pending' | 'active' | 'expired' | 'revoked' | 'denied';
  approvedBy?: string;
  expiresAt?: number;
}

const MAX_DURATION_MS = 8 * 60 * 60_000;
const APPROVER_ROLES: RoleName[] = ['Owner', 'Operations'];
const grants = new Map<string, Grant>();

export function requestGrant(
  memberId: string,
  scope: string,
  reason: string,
  durationMs: number,
): Grant {
  if (!/^production:(renewberry|blog|mirror)$/.test(scope))
    throw new HttpError(422, 'scope_invalid', 'Unknown scope');
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
  });
  return g;
}

export function approveGrant(id: string, approver: { memberId: string; role: RoleName }): Grant {
  const g = grants.get(id);
  if (!g || g.status !== 'pending') throw new HttpError(404, 'not_found', 'No pending grant');
  if (g.memberId === approver.memberId)
    throw new HttpError(403, 'self_approval', 'You can’t approve your own access');
  if (!APPROVER_ROLES.includes(approver.role))
    throw new HttpError(403, 'forbidden', 'Only Owners or Operations can approve');
  g.status = 'active';
  g.approvedBy = approver.memberId;
  g.expiresAt = Date.now() + g.durationMs;
  audit.append({
    actor: approver.memberId,
    action: 'jit.approved',
    target: `${g.memberId} → ${g.scope}`,
    sensitive: true,
  });
  return g;
}

export function revokeGrant(id: string, by: string): Grant {
  const g = grants.get(id);
  if (!g || (g.status !== 'active' && g.status !== 'pending'))
    throw new HttpError(404, 'not_found', 'No active grant');
  g.status = g.status === 'pending' ? 'denied' : 'revoked';
  audit.append({
    actor: by,
    action: `jit.${g.status}`,
    target: `${g.memberId} → ${g.scope}`,
    sensitive: true,
  });
  return g;
}

/** Active scopes for a member — read on every request when building the principal. */
export function activeElevations(memberId: string): string[] {
  const now = Date.now();
  return [...grants.values()]
    .filter((g) => g.memberId === memberId && g.status === 'active' && (g.expiresAt ?? 0) > now)
    .map((g) => g.scope);
}

export function listGrants(): Grant[] {
  return [...grants.values()].sort((a, b) => b.requestedAt - a.requestedAt);
}

// Auto-revoke on expiry, and record it.
setInterval(() => {
  const now = Date.now();
  for (const g of grants.values()) {
    if (g.status === 'active' && (g.expiresAt ?? 0) <= now) {
      g.status = 'expired';
      audit.append({
        actor: 'system',
        action: 'jit.expired',
        target: `${g.memberId} → ${g.scope}`,
        sensitive: true,
      });
    }
  }
}, 15_000).unref();
