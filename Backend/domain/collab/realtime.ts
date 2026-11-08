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
 * The member's role and products are read from the members repository on
 * every beat (and immediately when this process changes the member), and
 * channel events are checked against that view — members are no longer held
 * in process memory (ADR 0011), so a per-event database read is avoided.
 * Reconnects may send `Last-Event-ID` to replay recent events they can read.
 */

import type { ServerResponse } from 'node:http';
import { findSessionByPrefix } from '../../auth/sessions.ts';
import { HttpError, type Principal } from '../../types.ts';
import { onMemberWrite } from '../../data/members.ts';
import { canReadChannel, currentViewer, type Viewer } from './access.ts';
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
  /** Current role/products of the member; undefined once inactive. */
  viewer: Viewer | undefined;
}

const MAX_PER_MEMBER = 5;
const MAX_TOTAL = 2_000;
const MAX_BUFFERED = 512 * 1024;
const REPLAY = 500;
export const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS ?? 15_000);

const subscribers = new Set<Subscriber>();
const recent: CollabEvent[] = [];
let seq = 0;

function visibleTo(sub: Subscriber, e: CollabEvent): boolean {
  if ('memberId' in e.audience) return e.audience.memberId === sub.memberId;
  const viewer = sub.viewer;
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

async function refresh(sub: Subscriber) {
  sub.viewer = await currentViewer(sub.memberId);
}

async function stillValid(sub: Subscriber): Promise<boolean> {
  const s = await findSessionByPrefix(sub.memberId, sub.sessionId);
  await refresh(sub);
  return !!s && !s.revoked && !!sub.viewer;
}

onMemberWrite((memberId) => {
  for (const sub of subscribers)
    if (sub.memberId === memberId) void refresh(sub).catch(() => undefined);
});

/** Publishes a collaboration event. Never forwarded to the global /api/_events bus. */
export function emit(type: string, audience: Audience, data: unknown) {
  const e: CollabEvent = { id: ++seq, type, at: new Date().toISOString(), audience, data };
  recent.push(e);
  if (recent.length > REPLAY) recent.shift();
  for (const sub of [...subscribers]) if (visibleTo(sub, e)) write(sub, frame(e));
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
    viewer: { memberId: p.memberId, role: p.role, products: p.products },
    beat: setInterval(() => {
      void stillValid(sub).then(
        (ok) => {
          if (!ok) return close(sub, 'session_ended');
          write(sub, `: ping ${Date.now()}\n\n`);
        },
        () => undefined,
      );
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
