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
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publish(type: string, data: Record<string, unknown>) {
  bus.emit('event', { type, at: new Date().toISOString(), data } satisfies BusEvent);
}

export function subscribe(fn: (e: BusEvent) => void): () => void {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}
