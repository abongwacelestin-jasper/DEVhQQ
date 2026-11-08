/**
 * Who may receive which bus event over `GET /api/_events` (CYBER-001).
 *
 * The bus carries everything: audit entries, sign-ins, team changes and
 * product activity. Delivery is filtered per subscriber, for every event:
 *
 *  - Security events (`audit`, `signin`, `team`, `member.*`, `auth.*`,
 *    `security.*`, `token.*`, `jit.*`) go only to principals with
 *    Administration:view.
 *  - Product events (`task`, `deployment`, `incident`, `monitor`, `repo`,
 *    `pull_request`, `ci`, `code_finding`, `integration`, plus dotted
 *    sub-types such as `monitor.check`) go only to principals who can see the
 *    event's product. The product comes from the envelope or payload
 *    `product`. If neither has one, it is resolved from the record the
 *    payload names (task key, deployment id, incident id). An event whose
 *    product cannot be determined is not delivered.
 *  - Any other event type is denied by default. A new event type stays
 *    invisible until it is added here.
 *
 * Collaboration messages use the separately filtered `/api/stream`.
 */

import type { BusEvent } from '../lib/events.ts';
import { can, canSeeProduct } from '../auth/rbac.ts';
import { db } from '../store/db.ts';
import { productOfTaskKey } from '../data/tasks.ts';
import type { Principal, ProductId } from '../types.ts';

const SECURITY_TYPES = new Set(['audit', 'signin', 'team']);
const SECURITY_PREFIXES = ['member.', 'auth.', 'security.', 'token.', 'jit.'];
const PRODUCT_TYPES = new Set([
  'task',
  'deployment',
  'incident',
  'monitor',
  'repo',
  'pull_request',
  'ci',
  'code_finding',
  'integration',
]);
const PRODUCTS: ReadonlySet<string> = new Set<ProductId>(['renewberry', 'blog', 'mirror']);

function baseType(type: string): string {
  const dot = type.indexOf('.');
  return dot === -1 ? type : type.slice(0, dot);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Product of a product-scoped event, or undefined when it cannot be determined. */
export function eventProduct(e: BusEvent): ProductId | undefined {
  const direct = e.product ?? str(e.data.product);
  if (direct) return PRODUCTS.has(direct) ? (direct as ProductId) : undefined;
  switch (baseType(e.type)) {
    case 'task': {
      // The key prefix is derived from the (immutable) product at creation, so no
      // lookup is needed — the same answer on every replica.
      const key = str(e.data.key) ?? str(e.data.taskKey);
      return key ? productOfTaskKey(key) : undefined;
    }
    case 'deployment': {
      const id = str(e.data.id);
      return id ? db.deployments.get(id)?.product : undefined;
    }
    case 'incident': {
      const id = str(e.data.id);
      return id ? db.incidents.get(id)?.product : undefined;
    }
    default:
      return undefined;
  }
}

export function canReceiveEvent(p: Principal, e: BusEvent): boolean {
  if (SECURITY_TYPES.has(e.type) || SECURITY_PREFIXES.some((x) => e.type.startsWith(x)))
    return can(p, 'Administration', 'view');
  if (PRODUCT_TYPES.has(baseType(e.type))) {
    const product = eventProduct(e);
    return product !== undefined && canSeeProduct(p, product);
  }
  return false;
}
