/**
 * Channel access rules — one place, used by the REST routes and by the
 * realtime stream at delivery time (so leaving a channel or losing a product
 * stops delivery immediately).
 *
 *  - DMs and private channels: members only (Owners included — no peeking).
 *  - Product-scoped channels: the caller must be assigned to that product.
 *  - Public channels: any active member.
 *  - Unreadable channels answer 404, never 403.
 */

import { can } from '../../auth/rbac.ts';
import { repos } from '../../data/index.ts';
import { HttpError, type Principal } from '../../types.ts';
import { channels } from './store.ts';
import type { Channel } from './types.ts';

export type Viewer = Pick<Principal, 'memberId' | 'role' | 'products'>;

export function seesProduct(v: Viewer, product: string | undefined): boolean {
  return !product || v.role === 'Owner' || (v.products as string[]).includes(product);
}

export function canReadChannel(v: Viewer, c: Channel): boolean {
  if (!seesProduct(v, c.product)) return false;
  if (c.kind === 'dm' || c.private) return c.members.includes(v.memberId);
  return true;
}

/** Org admins moderate every channel they can read; channel admins moderate theirs. */
export function canModerate(v: Viewer, c: Channel): boolean {
  if (!canReadChannel(v, c)) return false;
  if (c.kind === 'dm') return false;
  return c.admins.includes(v.memberId) || can(asPrincipal(v), 'Organization', 'admin');
}

export function canPost(v: Viewer, c: Channel): boolean {
  if (c.archived || !canReadChannel(v, c)) return false;
  if (c.permissions.post === 'admins') return canModerate(v, c);
  if (c.permissions.post === 'members' || c.kind === 'dm') return c.members.includes(v.memberId);
  return true;
}

export function readableChannel(v: Viewer, id: string): Channel {
  const c = channels.get(id);
  if (!c || !canReadChannel(v, c)) throw new HttpError(404, 'not_found', 'Not found');
  return c;
}

/** Current role/products for a member (used by long-lived streams, never a stale snapshot). */
export async function currentViewer(memberId: string): Promise<Viewer | undefined> {
  const m = await repos.members.get(memberId);
  if (!m || m.status !== 'active') return undefined;
  return { memberId: m.id, role: m.role, products: m.products };
}

function asPrincipal(v: Viewer): Principal {
  return { ...v, sessionId: '', verifiedAt: 0, elevations: [] };
}
