/**
 * Event bus. The audit log, auth and operations routes publish here; the
 * backend console subscribes via Server-Sent Events (/api/_events) for a
 * live activity stream.
 *
 * Two kinds of listener, because "every replica" and "exactly once" are
 * different needs:
 *
 *  - `subscribe`: in-process reactions with side effects (notifications,
 *    token revocation, doc snapshots). They see only events published by
 *    *this* process, so with N replicas a reaction still runs once.
 *  - `subscribeFanout`: delivery to clients (SSE). It sees local events and,
 *    when a transport is installed (lib/redisBus.ts, Redis pub/sub), events
 *    published on every other replica. The publishing process delivers its
 *    own events locally and ignores its own echo from Redis, so nothing is
 *    delivered twice.
 *
 * Per-subscriber filtering (security/eventPolicy.ts) happens at delivery in
 * each subscriber, on every replica, exactly as for local events.
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

/** Carries locally published events to the other replicas. */
export interface BusTransport {
  publish(e: BusEvent): void;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);
let transport: BusTransport | undefined;

export function setBusTransport(t: BusTransport | undefined) {
  transport = t;
}

export function publish(
  type: string,
  data: Record<string, unknown>,
  meta: { product?: string } = {},
) {
  const product = meta.product ?? (typeof data.product === 'string' ? data.product : undefined);
  const e: BusEvent = {
    type,
    at: new Date().toISOString(),
    data,
    ...(product ? { product } : {}),
  };
  bus.emit('event', e);
  bus.emit('fanout', e);
  transport?.publish(e);
}

/** Local events only: for reactions that must run once per event across replicas. */
export function subscribe(fn: (e: BusEvent) => void): () => void {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}

/** Local and remote events: for delivering to connected clients. */
export function subscribeFanout(fn: (e: BusEvent) => void): () => void {
  bus.on('fanout', fn);
  return () => bus.off('fanout', fn);
}

/** Entry point for events received from another replica (fan-out only, never side effects). */
export function deliverRemote(e: BusEvent) {
  bus.emit('fanout', e);
}

export function fanoutListenerCount(): number {
  return bus.listenerCount('fanout');
}
