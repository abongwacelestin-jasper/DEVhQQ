/**
 * Just-in-time access helpers for integration tests.
 *
 *   const g = await grantAccess(as.operations, as.admin, 'production:renewberry');
 *   … act with as.operations …
 *   await revokeAccess(as.admin, g.id);
 *
 * Both clients must have a fresh step-up (a new demo sign-in does).
 */

import assert from 'node:assert/strict';
import type { Client } from './server.ts';

export interface TestGrant {
  id: string;
  memberId: string;
  scope: string;
  reason: string;
  status: string;
  approvedBy?: string;
  expiresAt?: number;
  durationMs: number;
}

/** `requester` asks for `scope`, `approver` (a different Owner/Operations member) approves. */
export async function grantAccess(
  requester: Client,
  approver: Client,
  scope: string,
  durationMinutes = 30,
): Promise<TestGrant> {
  const req = await requester.post<TestGrant>('/api/access/grants', {
    scope,
    reason: 'Integration test: production change under review',
    durationMinutes,
  });
  assert.equal(req.status, 200, `request ${scope}: ${req.text}`);
  const ok = await approver.post<TestGrant>(`/api/access/grants/${req.json.id}/approve`);
  assert.equal(ok.status, 200, `approve ${scope}: ${ok.text}`);
  assert.equal(ok.json.status, 'active');
  return ok.json;
}

/** Revokes an active grant (or denies a pending one). */
export async function revokeAccess(by: Client, grantId: string): Promise<TestGrant> {
  const res = await by.post<TestGrant>(`/api/access/grants/${grantId}/revoke`);
  assert.equal(res.status, 200, `revoke ${grantId}: ${res.text}`);
  return res.json;
}
