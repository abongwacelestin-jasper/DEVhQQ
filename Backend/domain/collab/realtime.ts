/**
 * Authenticated, per-subscriber filtered realtime stream (GET /api/stream).
 *
 * Why not the existing GET /api/_events? That stream forwards *every* bus
 * event to *every* authenticated session (it exists for the backend console).
 * Publishing message bodies there would leak private channels and DMs to
 * anyone signed in. Collaboration events therefore never touch the global bus;
 * they go through this hub, and each event is checked against the
 * subscriber's *current* access at delivery time:
 *
 *  - channel events: the subscriber must be able to read the channel now
 *    (membership, privacy and product scope re-evaluated on every event);
 *  - member events (notifications): only the addressed member.
 *
 * Abuse/back-pressure controls: at most MAX_PER_MEMBER open streams per member
 * and MAX_TOTAL overall; a stream whose unsent buffer passes MAX_BUFFERED is
 * dropped (slow consumer); heartbeats every HEARTBEAT_MS also re-check that
 * the session still exists and the member is still active, so revoking
 * sessions or deactivating a member closes their streams within one beat.
 * Reconnects may send `Last-Event-ID` to replay recent events they can read.
 *
 * Across replicas (lib/redisBus.ts installs a transport when REDIS_URL is
 * set): the publishing process delivers to its own subscribers at once and
 * forwards the event; every other replica receives it through
 * `receiveRemote` and runs the same `visibleTo` check against its own
 * subscribers. The publisher ignores its own echo, so nothing is delivered
 * twice. Event ids are then hybrid-logical-clock values (wall-clock µs,
 * bumped past every id seen), so they stay increasing on every replica and a
 * reconnect to another replica can still replay by `Last-Event-ID`. Replay
 * across replicas is best effort: each replica keeps the last REPLAY events
 * it saw, and clock skew between replicas can reorder ids by the skew.
 */

import type { ServerResponse } from 'node:http';
import { findSessionByPrefix } from '../../auth/sessions.ts';
import { HttpError, type Principal } from '../../types.ts';
import { canReadChannel, currentViewer } from './access.ts';
import { channels } from './store.ts';

export type Audience = { channelId: string } | { memberId: string };

export interface CollabEvent {
  id: number;
  type: string;
  at: string;
  audience: Audience;
  data: unknown;
}

interface Subscriber {
  memberId: string;
  sessionId: string;
  res: ServerResponse;
  beat: ReturnType<typeof setInterval>;
}

const MAX_PER_MEMBER = 5;
const MAX_TOTAL = 2_000;
const MAX_BUFFERED = 512 * 1024;
const REPLAY = 500;
export const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS ?? 15_000);

const subscribers = new Set<Subscriber>();
const recent: CollabEvent[] = [];
let seq = 0;

/** Carries locally emitted events to the other replicas. */
export interface RealtimeTransport {
  publish(e: CollabEvent): void;
}
let transport: RealtimeTransport | undefined;

export function setRealtimeTransport(t: RealtimeTransport | undefined) {
  transport = t;
}

/** Sequential ids in one process; HLC ids (see above) once events cross replicas. */
function nextId(): number {
  seq = transport ? Math.max(seq + 1, Date.now() * 1000) : seq + 1;
  return seq;
}

function remember(e: CollabEvent) {
  recent.push(e);
  if (recent.length > REPLAY) recent.shift();
}

function deliver(e: CollabEvent) {
  for (const sub of [...subscribers]) if (visibleTo(sub, e)) write(sub, frame(e));
}

function visibleTo(sub: Subscriber, e: CollabEvent): boolean {
  if ('memberId' in e.audience) return e.audience.memberId === sub.memberId;
  const viewer = currentViewer(sub.memberId);
  const channel = channels.get(e.audience.channelId);
  return !!viewer && !!channel && canReadChannel(viewer, channel);
}

function close(sub: Subscriber, reason?: string) {
  if (!subscribers.delete(sub)) return;
  clearInterval(sub.beat);
  if (!sub.res.writableEnded) {
    if (reason) sub.res.write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
    sub.res.end();
  }
}

function write(sub: Subscriber, chunk: string) {
  if (sub.res.writableEnded || sub.res.destroyed) return close(sub);
  if (sub.res.writableLength > MAX_BUFFERED) return close(sub, 'slow_consumer');
  sub.res.write(chunk);
}

function frame(e: CollabEvent) {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ type: e.type, at: e.at, data: e.data })}\n\n`;
}

function stillValid(sub: Subscriber): boolean {
  const s = findSessionByPrefix(sub.memberId, sub.sessionId);
  return !!s && !s.revoked && !!currentViewer(sub.memberId);
}

/** Publishes a collaboration event. Never forwarded to the global /api/_events bus. */
export function emit(type: string, audience: Audience, data: unknown) {
  const e: CollabEvent = { id: nextId(), type, at: new Date().toISOString(), audience, data };
  remember(e);
  deliver(e);
  transport?.publish(e);
}

/** An event emitted on another replica: same per-subscriber checks, never re-forwarded. */
export function receiveRemote(e: CollabEvent) {
  if (!Number.isSafeInteger(e.id) || e.id <= 0) return;
  seq = Math.max(seq, e.id);
  remember(e);
  deliver(e);
}

/** Takes over the response and keeps it open. Caller returns STREAM. */
export function openStream(p: Principal, res: ServerResponse, lastEventId?: string) {
  const mine = [...subscribers].filter((s) => s.memberId === p.memberId);
  if (mine.length >= MAX_PER_MEMBER) close(mine[0], 'superseded');
  if (subscribers.size >= MAX_TOTAL)
    throw new HttpError(503, 'stream_capacity', 'Realtime is at capacity — retry shortly');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const sub: Subscriber = {
    memberId: p.memberId,
    sessionId: p.sessionId,
    res,
    beat: setInterval(() => {
      if (!stillValid(sub)) return close(sub, 'session_ended');
      write(sub, `: ping ${Date.now()}\n\n`);
    }, HEARTBEAT_MS),
  };
  sub.beat.unref();
  subscribers.add(sub);
  res.write(
    `retry: 5000\nevent: hello\ndata: ${JSON.stringify({ member: p.memberId, at: new Date().toISOString() })}\n\n`,
  );

  const after = Number(lastEventId);
  if (Number.isInteger(after) && after > 0)
    for (const e of recent) if (e.id > after && visibleTo(sub, e)) write(sub, frame(e));

  res.on('close', () => close(sub));
}

export function streamStats() {
  return { open: subscribers.size, lastEventId: seq };
}
