/**
 * Authorization of files by the resource they are attached to.
 *
 * A file is never authorized on its own: every request re-resolves the
 * referenced resource (doc, channel, member) for the caller. If the caller
 * can't see the resource, the file doesn't exist for them (404) — so losing
 * access to a doc or channel immediately cuts access to its attachments.
 *
 * Built in: `doc` (same visibility rules as routes/docs.routes.ts) and
 * `member` (avatars). `channel` belongs to B-COLLAB, which registers it:
 *
 *   registerRefResolver('channel', (p, id) => {
 *     const c = channels.get(id);
 *     return c && canSeeChannel(p, c) ? { product: c.product } : null;
 *   });
 *
 * Until then channel references resolve to "not found".
 */

import { canSeeProduct } from '../auth/rbac.ts';
import { db } from '../store/db.ts';
import { repos } from '../data/index.ts';
import type { Principal, ProductId } from '../types.ts';

export type RefKind = 'doc' | 'channel' | 'member';

/** `null` → not visible to this principal (respond 404). */
export type RefResult = { product: ProductId | null } | null;
export type RefResolver = (p: Principal, refId: string) => RefResult | Promise<RefResult>;

const resolvers = new Map<RefKind, RefResolver>();

export function registerRefResolver(kind: RefKind, resolver: RefResolver) {
  resolvers.set(kind, resolver);
}

export async function resolveRef(kind: RefKind, p: Principal, refId: string): Promise<RefResult> {
  const r = resolvers.get(kind);
  return r ? r(p, refId) : null;
}

registerRefResolver('doc', (p, id) => {
  const d = db.docs.get(id);
  if (!d || !canSeeProduct(p, d.product)) return null;
  if (d.visibility === 'restricted' && !d.editors.includes(p.memberId) && p.role !== 'Owner')
    return null;
  return { product: d.product };
});

registerRefResolver('member', async (_p, id) => {
  // Avatars are part of the team directory, visible to every signed-in member.
  const m = await repos.members.get(id);
  return m && m.status !== 'deactivated' ? { product: null } : null;
});
