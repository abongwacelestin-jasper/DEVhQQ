/**
 * In-process event bus. The audit log, auth and operations routes publish
 * here; the backend console subscribes via Server-Sent Events (/api/_events)
 * for a live activity stream. Swap for Redis pub/sub when running >1 instance.
 */

import { EventEmitter } from 'node:events';

export interface BusEvent {
  type: string;
  at: string;
  data: Record<string, unknown>;
  /**
   * Product the event belongs to, when it is product-scoped. Subscribers that
   * fan out to clients (GET /api/_events) deliver it only to principals who
   * can see that product — see security/eventPolicy.ts.
   */
  product?: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publish(
  type: string,
  data: Record<string, unknown>,
  meta: { product?: string } = {},
) {
  const product = meta.product ?? (typeof data.product === 'string' ? data.product : undefined);
  bus.emit('event', {
    type,
    at: new Date().toISOString(),
    data,
    ...(product ? { product } : {}),
  } satisfies BusEvent);
}

export function subscribe(fn: (e: BusEvent) => void): () => void {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}
