/**
 * RFC 6238 time-based one-time passwords (TOTP), the fallback second factor
 * for members who haven't registered a passkey yet.
 *
 * SMS is intentionally not supported: SIM-swap and real-time phishing kits
 * make it unsuitable as a second factor.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { isSealed, needsReseal, open, reseal, safeEqual, seal } from '../security/crypto.ts';
import { createCollection } from '../store/collection.ts';
import type { Member } from '../types.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for authenticator-app QR codes. */
export function totpUri(secret: string, account: string, issuer = 'TavetaHQ'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function totpAt(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifies a code with ±1 step of clock drift. Returns the matched counter so
 * callers can store it and reject replays of the same code.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedCounter = -1,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const counter = current + drift;
    if (counter <= lastUsedCounter) continue; // replay protection
    if (safeEqual(totpAt(secret, counter), code)) return counter;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Secrets at rest, replay protection and enrollment
// ---------------------------------------------------------------------------

/** AAD context binding a sealed TOTP secret to its member (a copied ciphertext won't open). */
export function totpContext(memberId: string): string {
  return `member:${memberId}:totp`;
}

/** Seals a base32 secret for storage on `Member.totpSecret`. */
export function sealTotpSecret(memberId: string, secret: string): string {
  return seal(secret, totpContext(memberId));
}

/**
 * Upgrades a member's stored secret in place when it is legacy plaintext or
 * sealed under a retired key. Returns true when the caller must persist the
 * member.
 */
export function migrateTotpSecret(member: Member): boolean {
  if (!member.totpSecret || !needsReseal(member.totpSecret)) return false;
  member.totpSecret = reseal(member.totpSecret, totpContext(member.id));
  return true;
}

/** Plaintext base32 secret for verification only. Never log or return it. */
export function openTotpSecret(member: Member): string | null {
  if (!member.totpSecret) return null;
  return isSealed(member.totpSecret)
    ? open(member.totpSecret, totpContext(member.id))
    : member.totpSecret;
}

/**
 * Last accepted TOTP counter per member, across every session — a code that
 * worked once can never be replayed on another session or device.
 */
interface TotpCounter {
  memberId: string;
  lastCounter: number;
}
const totpCounters = createCollection<TotpCounter>('auth.totp_counters');

/**
 * Verifies `code` for a member, enforcing per-member and per-session replay
 * protection, and records the counter on success. Returns the matched counter.
 */
export function verifyMemberTotp(
  member: Member,
  code: string,
  sessionLastCounter = -1,
): number | null {
  const secret = openTotpSecret(member);
  if (!secret) return null;
  const memberLast = totpCounters.get(member.id)?.lastCounter ?? -1;
  const counter = verifyTotp(secret, code, Math.max(memberLast, sessionLastCounter));
  if (counter !== null) totpCounters.set(member.id, { memberId: member.id, lastCounter: counter });
  return counter;
}

interface PendingEnrollment {
  sealedSecret: string;
  sessionId: string;
  expiresAt: number;
  attempts: number;
}

export const ENROLLMENT_TTL_MS = 10 * 60_000;
const MAX_ENROLLMENT_ATTEMPTS = 5;
const enrollments = new Map<string, PendingEnrollment>();

/** Starts (or restarts) enrollment. The secret is kept sealed until confirmed. */
export function beginEnrollment(member: Member, sessionId: string) {
  const secret = generateTotpSecret();
  const expiresAt = Date.now() + ENROLLMENT_TTL_MS;
  enrollments.set(member.id, {
    sealedSecret: seal(secret, `member:${member.id}:totp-pending`),
    sessionId,
    expiresAt,
    attempts: 0,
  });
  return { secret, otpauthUri: totpUri(secret, member.email), expiresAt };
}

export type ConfirmResult =
  | { ok: true; sealedSecret: string; counter: number }
  | { ok: false; reason: 'no_enrollment' | 'wrong_session' | 'invalid_code' | 'too_many_attempts' };

/**
 * Confirms a pending enrollment with one valid code from the authenticator.
 * The enrollment must belong to the session that started it.
 */
export function confirmEnrollment(member: Member, sessionId: string, code: string): ConfirmResult {
  const p = enrollments.get(member.id);
  if (!p || p.expiresAt < Date.now()) {
    enrollments.delete(member.id);
    return { ok: false, reason: 'no_enrollment' };
  }
  if (p.sessionId !== sessionId) return { ok: false, reason: 'wrong_session' };
  const secret = open(p.sealedSecret, `member:${member.id}:totp-pending`);
  const counter = verifyTotp(secret, code);
  if (counter === null) {
    p.attempts += 1;
    if (p.attempts >= MAX_ENROLLMENT_ATTEMPTS) {
      enrollments.delete(member.id);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'invalid_code' };
  }
  enrollments.delete(member.id);
  totpCounters.set(member.id, { memberId: member.id, lastCounter: counter });
  return { ok: true, sealedSecret: sealTotpSecret(member.id, secret), counter };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of enrollments) if (e.expiresAt < now) enrollments.delete(k);
}, 60_000).unref();

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
