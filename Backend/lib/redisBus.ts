/**
 * Redis pub/sub transport for the event bus (lib/events.ts) and the realtime
 * hub (domain/collab/realtime.ts).
 *
 * Each process publishes its local events on `<prefix>bus` / `<prefix>rt`
 * wrapped in `{ o: INSTANCE_ID, e: event }`, and delivers what it receives
 * from *other* instances to its local subscribers only (fan-out, never the
 * side-effect listeners). Its own echo is dropped: the publisher already
 * delivered locally, before Redis was involved, so a Redis outage never
 * delays or loses delivery on the replica where the event happened.
 *
 * Filtering stays where it was: every receiving replica runs
 * `canReceiveEvent` (security/eventPolicy.ts) and the private-channel check
 * per subscriber. Before forwarding a bus event, the publisher resolves its
 * product from the record it names (`eventProduct`) and puts it on the
 * envelope, because the receiving replica may not hold that record; the
 * policy reads the envelope product first, so the decision is the one the
 * publisher's data supports. An event whose product cannot be resolved is
 * forwarded without one and denied on arrival, as it would be locally.
 *
 * Pub/sub is fire-and-forget: a replica that is disconnected while an event
 * is published does not get it (SSE clients reconnect and replay from the
 * realtime ring buffer). Redis is inside the trust boundary: anyone who can
 * publish to it can inject events, which still pass the per-subscriber
 * policy. Keep it on the private network with a password (Railway default).
 */

import { deliverRemote, setBusTransport, type BusEvent } from './events.ts';
import { logger } from './logger.ts';
import { INSTANCE_ID, type RedisClient } from './redis.ts';
import { eventProduct } from '../security/eventPolicy.ts';
import {
  receiveRemote,
  setRealtimeTransport,
  type CollabEvent,
} from '../domain/collab/realtime.ts';

interface Envelope<T> {
  o: string;
  e: T;
}

/** Larger messages are dropped on receipt (a bus event is a few hundred bytes). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

export const counters = { published: 0, received: 0, ownEcho: 0, dropped: 0, publishFailed: 0 };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBusEvent(v: unknown): v is BusEvent {
  return (
    isObject(v) &&
    typeof v.type === 'string' &&
    typeof v.at === 'string' &&
    isObject(v.data) &&
    (v.product === undefined || typeof v.product === 'string')
  );
}

function isCollabEvent(v: unknown): v is CollabEvent {
  if (!isObject(v) || typeof v.id !== 'number' || typeof v.type !== 'string') return false;
  if (typeof v.at !== 'string' || !isObject(v.audience)) return false;
  const a = v.audience;
  return typeof a.channelId === 'string' || typeof a.memberId === 'string';
}

/** Parses an envelope from another instance; undefined for own echo or junk. */
export function parseEnvelope<T>(
  raw: string,
  guard: (v: unknown) => v is T,
  self = INSTANCE_ID,
): T | undefined {
  if (raw.length > MAX_MESSAGE_BYTES) {
    counters.dropped++;
    return undefined;
  }
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    counters.dropped++;
    return undefined;
  }
  if (!isObject(msg) || typeof msg.o !== 'string' || !guard(msg.e)) {
    counters.dropped++;
    return undefined;
  }
  if (msg.o === self) {
    counters.ownEcho++;
    return undefined;
  }
  counters.received++;
  return msg.e;
}

function send(client: RedisClient, channel: string, payload: Envelope<unknown>) {
  if (!client.isReady) {
    counters.publishFailed++;
    return;
  }
  counters.published++;
  client.publish(channel, JSON.stringify(payload)).catch((e: unknown) => {
    counters.publishFailed++;
    logger.warn('redis.publish_failed', { channel, err: String((e as Error)?.message ?? e) });
  });
}

/** Adds the resolved product to a product-scoped event before it leaves this replica. */
export function withResolvedProduct(e: BusEvent): BusEvent {
  if (e.product) return e;
  const product = eventProduct(e);
  return product ? { ...e, product } : e;
}

export async function installRedisBus(
  commands: RedisClient,
  subscriber: RedisClient,
  prefix: string,
): Promise<void> {
  const busChannel = `${prefix}bus`;
  const rtChannel = `${prefix}rt`;

  setBusTransport({
    publish: (e) => send(commands, busChannel, { o: INSTANCE_ID, e: withResolvedProduct(e) }),
  });
  setRealtimeTransport({
    publish: (e) => send(commands, rtChannel, { o: INSTANCE_ID, e }),
  });

  // Once subscribed, node-redis re-subscribes by itself after every reconnect.
  // If Redis is down at boot, subscribe on the first successful (re)connect.
  let subscribed = false;
  const subscribeAll = async () => {
    if (subscribed) return;
    await subscriber.subscribe(busChannel, (raw: string) => {
      const e = parseEnvelope(raw, isBusEvent);
      if (e) deliverRemote(e);
    });
    await subscriber.subscribe(rtChannel, (raw: string) => {
      const e = parseEnvelope(raw, isCollabEvent);
      if (e) receiveRemote(e);
    });
    subscribed = true;
    logger.info('redis.bus_subscribed', { channels: [busChannel, rtChannel] });
  };
  const retry = () =>
    void subscribeAll().catch((e: unknown) =>
      logger.warn('redis.subscribe_failed', { err: String((e as Error)?.message ?? e) }),
    );
  if (subscriber.isReady) {
    try {
      await subscribeAll();
    } catch {
      /* retried on the next ready event */
    }
  }
  if (!subscribed) subscriber.on('ready', retry);
}

export function uninstallRedisBus() {
  setBusTransport(undefined);
  setRealtimeTransport(undefined);
}
