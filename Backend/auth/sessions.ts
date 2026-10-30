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
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config/env.ts';
import { randomToken, signToken, verifySignedToken } from '../security/crypto.ts';
import { lookupIp } from '../lib/geo.ts';
import { HttpError, type GeoLocation } from '../types.ts';

export type SessionStage = 'password' | 'verified';

export interface SessionRecord {
  id: string;
  memberId: string;
  stage: SessionStage;
  createdAt: number;
  lastSeenAt: number;
  /** Last strong verification (TOTP or passkey). 0 = step-up required. */
  verifiedAt: number;
  uaHash: string;
  /** Short, human-readable client label, e.g. "Chrome · macOS". Never the raw UA. */
  client: string;
  ip: string;
  location: GeoLocation;
  revoked: boolean;
  method: 'password' | 'passkey';
  /** Replay guard for TOTP. */
  lastTotpCounter: number;
}

const sessions = new Map<string, SessionRecord>();

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

export function createSession(
  memberId: string,
  req: IncomingMessage,
  ip: string,
  method: SessionRecord['method'],
  stage: SessionStage,
) {
  const id = randomToken(32);
  const now = Date.now();
  const rec: SessionRecord = {
    id,
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
  sessions.set(id, rec);
  return { token: signToken(id), session: rec };
}

/** Issues a fresh token for the same session state and kills the old one (prevents session fixation). */
export function rotateSession(old: SessionRecord, patch: Partial<SessionRecord> = {}) {
  old.revoked = true;
  sessions.delete(old.id);
  const id = randomToken(32);
  const rec: SessionRecord = { ...old, ...patch, id, revoked: false, lastSeenAt: Date.now() };
  sessions.set(id, rec);
  return { token: signToken(id), session: rec };
}

export type ValidationResult = { session: SessionRecord; stepUpRequired: boolean };

export function validateSession(token: string, req: IncomingMessage, ip: string): ValidationResult {
  const id = verifySignedToken(token);
  if (!id) throw new HttpError(401, 'invalid_token', 'Invalid session');
  const s = sessions.get(id);
  if (!s || s.revoked) throw new HttpError(401, 'session_revoked', 'Session ended');

  const now = Date.now();
  if (now - s.createdAt > config.sessionAbsoluteMs) {
    revoke(s.id);
    throw new HttpError(401, 'session_expired', 'Session expired — sign in again');
  }
  if (now - s.lastSeenAt > config.sessionIdleMs) {
    // Idle: keep the session but demand re-verification (maps to the frontend lock screen).
    s.verifiedAt = 0;
  }
  if (s.uaHash !== uaHash(req)) {
    revoke(s.id);
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
  }
  s.lastSeenAt = now;
  return { session: s, stepUpRequired: s.verifiedAt === 0 };
}

export function markVerified(s: SessionRecord, totpCounter?: number) {
  return rotateSession(s, {
    stage: 'verified',
    verifiedAt: Date.now(),
    lastTotpCounter: totpCounter ?? s.lastTotpCounter,
  });
}

export function revoke(id: string) {
  const s = sessions.get(id);
  if (s) s.revoked = true;
  sessions.delete(id);
}

/** Used on password reset, deactivation, role change, or suspected compromise. */
export function revokeAllFor(memberId: string): number {
  let n = 0;
  for (const s of [...sessions.values()]) {
    if (s.memberId === memberId) {
      revoke(s.id);
      n++;
    }
  }
  return n;
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

export function listSessions(memberId: string, currentId?: string) {
  return [...sessions.values()]
    .filter((s) => s.memberId === memberId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((s) => publicView(s, currentId));
}

export function listAllSessions(currentId?: string) {
  return [...sessions.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((s) => publicView(s, currentId));
}

export function findSessionByPrefix(memberId: string, prefix: string): SessionRecord | undefined {
  if (prefix.length < 8) return undefined;
  return [...sessions.values()].find((s) => s.memberId === memberId && s.id.startsWith(prefix));
}

export function sessionCount() {
  return sessions.size;
}

setInterval(() => {
  const cutoff = Date.now() - config.sessionAbsoluteMs;
  for (const s of [...sessions.values()]) if (s.createdAt < cutoff) revoke(s.id);
}, 5 * 60_000).unref();
