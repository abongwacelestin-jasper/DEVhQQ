/**
 * Sessions with continuous verification.
 *
 * Trust is not granted once at login and assumed forever. On every request we:
 *  - verify the token's HMAC (tamper check before any lookup),
 *  - enforce idle and absolute lifetimes,
 *  - compare the request context (user agent, IP) with the one bound at sign-in.
 * A user-agent change kills the session (likely token theft). An IP change or
 * idle timeout keeps the session but clears `verifiedAt`, so the next
 * sensitive action demands step-up verification.
 *
 * Storage: sessions live in the session store (`repos.sessions`, the shared
 * `SessionStore` contract of auth/sessionStore.ts, implemented in
 * data/sessions.ts) — the `sessions` table with DATABASE_URL, so every replica validates every
 * session and a revocation on one replica is effective on all of them on the
 * next request. The bearer token is `sign(rawId)`; the stored record is keyed
 * by SHA-256(rawId) and never contains the raw id or the token, so a database
 * dump cannot be replayed as a session even with the signing key. Activity
 * (`lastSeenAt`) is persisted at most once per LAST_SEEN_PERSIST_MS to avoid a
 * write per request; security-relevant changes are persisted immediately.
 * Revoking deletes the record.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config/env.ts';
import { randomToken, signToken, verifySignedToken } from '../security/crypto.ts';
import { lookupIp } from '../lib/geo.ts';
import { repos } from '../data/index.ts';
import type { SessionRecord, SessionStage } from '../data/sessions.ts';
import { HttpError } from '../types.ts';

export type { SessionRecord, SessionStage } from '../data/sessions.ts';


/** How stale a persisted `lastSeenAt` may get before it is written again. */
const LAST_SEEN_PERSIST_MS = 60_000;
/** Last persisted `lastSeenAt` per session handled by this process (memory only, best effort). */
const persistedSeen = new Map<string, number>();
const MAX_TRACKED = 50_000;

/** Storage key for a token's random id. */
function handleFor(rawId: string): string {
  return createHash('sha256').update(rawId).digest('base64url');
}

function track(s: SessionRecord) {
  if (persistedSeen.size >= MAX_TRACKED) persistedSeen.clear();
  persistedSeen.set(s.id, s.lastSeenAt);
}

async function store(s: SessionRecord) {
  // Valid through the absolute end inclusive (validateSession rejects only past it).
  await repos.sessions.put(s, s.createdAt + config.sessionAbsoluteMs + 1);
  track(s);
}

async function drop(id: string) {
  await repos.sessions.delete(id);
  persistedSeen.delete(id);
}

function uaHash(req: IncomingMessage): string {
  return createHash('sha256')
    .update(String(req.headers['user-agent'] ?? ''))
    .digest('base64url');
}

function clientLabel(req: IncomingMessage): string {
  const ua = String(req.headers['user-agent'] ?? '');
  if (/^curl\//i.test(ua)) return 'curl';
  if (/HTTPie/i.test(ua)) return 'HTTPie';
  if (/PostmanRuntime/i.test(ua)) return 'Postman';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Client';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} · ${os}`;
}

export async function createSession(
  memberId: string,
  req: IncomingMessage,
  ip: string,
  method: SessionRecord['method'],
  stage: SessionStage,
) {
  const rawId = randomToken(32);
  const now = Date.now();
  const rec: SessionRecord = {
    id: handleFor(rawId),
    memberId,
    stage,
    createdAt: now,
    lastSeenAt: now,
    verifiedAt: stage === 'verified' ? now : 0,
    uaHash: uaHash(req),
    client: clientLabel(req),
    ip,
    location: lookupIp(ip),
    revoked: false,
    method,
    lastTotpCounter: -1,
  };
  await store(rec);
  return { token: signToken(rawId), session: rec };
}

/** Issues a fresh token for the same session state and kills the old one (prevents session fixation). */
export async function rotateSession(old: SessionRecord, patch: Partial<SessionRecord> = {}) {
  old.revoked = true;
  await drop(old.id);
  const rawId = randomToken(32);
  const rec: SessionRecord = {
    ...old,
    ...patch,
    id: handleFor(rawId),
    revoked: false,
    lastSeenAt: Date.now(),
  };
  await store(rec);
  return { token: signToken(rawId), session: rec };
}

export type ValidationResult = { session: SessionRecord; stepUpRequired: boolean };

export async function validateSession(
  token: string,
  req: IncomingMessage,
  ip: string,
): Promise<ValidationResult> {
  const rawId = verifySignedToken(token);
  if (!rawId) throw new HttpError(401, 'invalid_token', 'Invalid session');
  const s = await repos.sessions.get(handleFor(rawId));
  if (!s || s.revoked) throw new HttpError(401, 'session_revoked', 'Session ended');

  const now = Date.now();
  if (now - s.createdAt > config.sessionAbsoluteMs) {
    await revoke(s.id);
    throw new HttpError(401, 'session_expired', 'Session expired — sign in again');
  }
  let changed = false;
  if (now - s.lastSeenAt > config.sessionIdleMs && s.verifiedAt !== 0) {
    // Idle: keep the session but demand re-verification (maps to the frontend lock screen).
    s.verifiedAt = 0;
    changed = true;
  }
  if (s.uaHash !== uaHash(req)) {
    await revoke(s.id);
    throw new HttpError(
      401,
      'session_context_changed',
      'Session used from a different device — signed out for safety',
    );
  }
  if (s.ip !== ip) {
    s.ip = ip;
    s.location = lookupIp(ip);
    s.verifiedAt = 0;
    changed = true;
  }
  s.lastSeenAt = now;
  if (changed || now - (persistedSeen.get(s.id) ?? 0) >= LAST_SEEN_PERSIST_MS) await store(s);
  return { session: s, stepUpRequired: s.verifiedAt === 0 };
}

export function markVerified(s: SessionRecord, totpCounter?: number) {
  return rotateSession(s, {
    stage: 'verified',
    verifiedAt: Date.now(),
    lastTotpCounter: totpCounter ?? s.lastTotpCounter,
  });
}

export async function revoke(id: string) {
  await drop(id);
}

/** Used on password reset, deactivation, role change, or suspected compromise. */
export async function revokeAllFor(memberId: string): Promise<number> {
  return repos.sessions.deleteAllFor(memberId);
}

/**
 * Revokes every session of a member except `keepId` (the caller's own).
 * Used after a password change and for "sign out everywhere else".
 */
export async function revokeAllExcept(memberId: string, keepId: string): Promise<number> {
  return repos.sessions.deleteAllFor(memberId, keepId);
}

/** Public projection — the id is truncated to an 8-char handle and is useless as a credential. */
function publicView(s: SessionRecord, currentId?: string) {
  return {
    id: s.id.slice(0, 8),
    memberId: s.memberId,
    current: s.id === currentId,
    stage: s.stage,
    method: s.method,
    client: s.client,
    ip: s.ip,
    location: s.location,
    createdAt: new Date(s.createdAt).toISOString(),
    lastSeenAt: new Date(s.lastSeenAt).toISOString(),
    stepUpRequired: s.verifiedAt === 0,
  };
}

export async function listSessions(memberId: string, currentId?: string) {
  return (await repos.sessions.listByMember(memberId))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((s) => publicView(s, currentId));
}

export async function listAllSessions(currentId?: string) {
  return (await repos.sessions.listAll()).map((s) => publicView(s, currentId));
}

export async function findSessionByPrefix(
  memberId: string,
  prefix: string,
): Promise<SessionRecord | undefined> {
  if (prefix.length < 8) return undefined;
  return (await repos.sessions.listByMember(memberId)).find((s) => s.id.startsWith(prefix));
}

export function sessionCount(): Promise<number> {
  return repos.sessions.count();
}

/** Deletes sessions past their absolute lifetime. Idempotent on every replica. */
export async function pruneExpiredSessions(): Promise<number> {
  const n = await repos.sessions.deleteCreatedBefore(Date.now() - config.sessionAbsoluteMs);
  if (n) persistedSeen.clear();
  return n;
}

setInterval(() => void pruneExpiredSessions().catch(() => undefined), 5 * 60_000).unref();
