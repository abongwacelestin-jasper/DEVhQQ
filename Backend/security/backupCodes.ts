/**
 * One-time backup codes: the second factor of last resort when a member has
 * lost their authenticator.
 *
 * - 10 codes of 8 base-32 characters shown as `xxxx-xxxx` (40 bits each).
 * - Only SHA-256 hashes are stored; the plaintext is returned once.
 * - Generating a new set replaces the old one.
 * - A code is consumed on first successful use (`usedAt`), compared in constant time.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from './crypto.ts';
import { persistMember } from './persist.ts';
import { repos } from '../data/index.ts';
import type { Member } from '../types.ts';

export const BACKUP_CODE_COUNT = 10;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i

export interface BackupCode {
  hash: string;
  usedAt?: string;
}

function oneCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Lower-cases and strips spaces/dashes so `ABCD EFGH` and `abcd-efgh` match. */
export function normalizeBackupCode(code: string): string {
  const flat = code.toLowerCase().replace(/[\s-]/g, '');
  return flat.length === 8 ? `${flat.slice(0, 4)}-${flat.slice(4)}` : flat;
}

/** Replaces the member's codes and returns the new plaintext set (shown once). */
export async function generateBackupCodes(member: Member): Promise<string[]> {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) codes.add(oneCode());
  member.backupCodes = [...codes].map((c) => ({ hash: hashToken(c) }));
  await persistMember(member);
  return [...codes];
}

export function remainingBackupCodes(member: Member): number {
  return (member.backupCodes ?? []).filter((c) => !c.usedAt).length;
}

function burn(codes: BackupCode[] | undefined, want: Buffer): BackupCode | undefined {
  let hit: BackupCode | undefined;
  // Check every entry so timing does not reveal which slot matched.
  for (const c of codes ?? []) {
    const ok = timingSafeEqual(Buffer.from(c.hash, 'hex'), want);
    if (ok && !c.usedAt && !hit) hit = c;
  }
  if (hit) hit.usedAt = new Date().toISOString();
  return hit;
}

/**
 * True (and the code is burnt) when `code` matches an unused backup code.
 * The burn is an atomic read-modify-write on the member row, so the same code
 * presented to two replicas at once succeeds at most once. `member` is
 * updated in place with the stored codes.
 */
export async function consumeBackupCode(member: Member, code: string): Promise<boolean> {
  const want = Buffer.from(hashToken(normalizeBackupCode(code)), 'hex');
  let hit: BackupCode | undefined;
  const stored = await repos.members.update(member.id, (m) => {
    hit = burn(m.backupCodes, want);
  });
  if (stored) member.backupCodes = stored.backupCodes;
  return !!hit;
}
