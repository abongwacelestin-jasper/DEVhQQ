/**
 * Tamper-evident audit log.
 *
 * Each entry stores the SHA-256 hash of the previous entry, forming a chain.
 * Editing or deleting any historical record breaks every hash after it, which
 * `verify()` detects. Entries are also appended to a JSONL file opened in
 * append-only mode; in production ship them to write-once storage (object lock
 * / WORM) so an attacker with server access still can't rewrite history.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { publish } from '../lib/events.ts';

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive: boolean;
  requestId?: string;
  prevHash: string;
  hash: string;
}

type NewEntry = Pick<AuditEntry, 'actor' | 'action' | 'target'> & {
  sensitive?: boolean;
  requestId?: string;
};

const GENESIS = '0'.repeat(64);

function digest(e: Omit<AuditEntry, 'hash'>): string {
  // Fixed field order so the hash is deterministic.
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.seq,
        e.at,
        e.actor,
        e.action,
        e.target,
        e.sensitive,
        e.requestId ?? null,
        e.prevHash,
      ]),
    )
    .digest('hex');
}

class AuditLog {
  private entries: AuditEntry[] = [];
  private file = process.env.AUDIT_LOG_FILE ?? './.audit/audit.jsonl';
  private ready = mkdir(dirname(this.file), { recursive: true }).catch(() => undefined);

  append(input: NewEntry): AuditEntry {
    const prev = this.entries[this.entries.length - 1];
    const base = {
      seq: (prev?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      target: input.target,
      sensitive: !!input.sensitive,
      requestId: input.requestId,
      prevHash: prev?.hash ?? GENESIS,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    this.entries.push(entry);
    publish('audit', { ...entry });
    void this.ready
      .then(() => appendFile(this.file, JSON.stringify(entry) + '\n', { flag: 'a' }))
      .catch((err) => console.error('audit write failed', err));
    return entry;
  }

  /** Recomputes the chain. Returns the first broken sequence number, or null if intact. */
  verify(): { ok: true } | { ok: false; brokenAt: number } {
    let prevHash = GENESIS;
    for (const e of this.entries) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prevHash || digest(rest) !== hash) return { ok: false, brokenAt: e.seq };
      prevHash = hash;
    }
    return { ok: true };
  }

  list(opts: { limit?: number; sensitiveOnly?: boolean } = {}): AuditEntry[] {
    const l = opts.sensitiveOnly ? this.entries.filter((e) => e.sensitive) : this.entries;
    return l.slice(-(opts.limit ?? 200)).reverse();
  }
}

export const audit = new AuditLog();
