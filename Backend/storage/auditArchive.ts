/**
 * Audit archive: ships the hash-chained audit log to the WORM audit bucket.
 *
 * Entries are batched (every 200 entries or 60 s) and written as one JSONL
 * object per batch:
 *
 *   audit/YYYY/MM/DD/<bootId>/<fromSeq>-<toSeq>.jsonl
 *
 * Line 1 is a header carrying the sequence range, the hash the batch chains
 * from (`prevHash` of its first entry) and the chain head (`headHash`, the
 * hash of its last entry); the same values are set as object metadata.
 * Consecutive batches therefore link up: batch N's headHash is batch N+1's
 * prevHash, so a missing or altered batch is detectable offline.
 *
 * `bootId` keeps keys unique across restarts (sequence numbers restart with
 * the in-memory log). The bucket has Object Lock with a default retention —
 * the backend credential can only PutObject there, never delete.
 *
 * Failed uploads stay buffered and are retried on the next flush; the local
 * JSONL file (AUDIT_LOG_FILE) remains the first copy either way.
 */

import { randomBytes } from 'node:crypto';
import { audit, type AuditEntry } from '../audit/auditLog.ts';
import { config } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { buckets, objectStore } from './index.ts';

const BATCH = 200;
const INTERVAL_MS = 60_000;
const MAX_BUFFER = 100_000;

const bootId = `${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}-${randomBytes(3).toString('hex')}`;
let buffer: AuditEntry[] = [];
let installed = false;
let chain: Promise<void> = Promise.resolve();
const stats = {
  batches: 0,
  entries: 0,
  failures: 0,
  lastKey: '' as string,
  lastError: '' as string,
};

function pad(n: number) {
  return String(n).padStart(10, '0');
}

async function flushOnce(): Promise<void> {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  const first = batch[0];
  const last = batch[batch.length - 1];
  const day = first.at.slice(0, 10).split('-').join('/');
  const key = `audit/${day}/${bootId}/${pad(first.seq)}-${pad(last.seq)}.jsonl`;
  const header = {
    type: 'devhq.audit.batch',
    v: 1,
    bootId,
    from: first.seq,
    to: last.seq,
    count: batch.length,
    prevHash: first.prevHash,
    headHash: last.hash,
    createdAt: new Date().toISOString(),
  };
  const body = Buffer.from([header, ...batch].map((l) => JSON.stringify(l)).join('\n') + '\n');
  try {
    await objectStore().putObject(buckets.audit, key, body, {
      contentType: 'application/x-ndjson',
      metadata: {
        'boot-id': bootId,
        'from-seq': String(first.seq),
        'to-seq': String(last.seq),
        'prev-hash': first.prevHash,
        'head-hash': last.hash,
      },
    });
    stats.batches++;
    stats.entries += batch.length;
    stats.lastKey = key;
    stats.lastError = '';
  } catch (e) {
    stats.failures++;
    stats.lastError = String((e as Error).message ?? e);
    buffer = [...batch, ...buffer];
    if (buffer.length > MAX_BUFFER) {
      // Bounded memory: the local JSONL still has these entries.
      logger.error('audit archive buffer overflow — oldest entries left to the local log only', {
        dropped: buffer.length - MAX_BUFFER,
      });
      buffer = buffer.slice(-MAX_BUFFER);
    }
    logger.error('audit archive upload failed', { err: stats.lastError, pending: buffer.length });
  }
}

/** Flushes buffered entries now (serialised with any flush in progress). */
export function flushAuditArchive(): Promise<void> {
  chain = chain.then(flushOnce, flushOnce);
  return chain;
}

/**
 * Starts archiving. Idempotent. Enabled with S3, or with the local driver
 * outside production (production without S3 has nowhere immutable to ship to).
 */
export function installAuditArchive(): boolean {
  if (installed) return true;
  if (config.isProd && !config.storage.endpoint) return false;
  installed = true;
  audit.addSink((entry) => {
    buffer.push(entry);
    if (buffer.length >= BATCH) void flushAuditArchive();
  });
  setInterval(() => void flushAuditArchive(), INTERVAL_MS).unref();
  return true;
}

export function auditArchiveStatus() {
  return { enabled: installed, bootId, pending: buffer.length, ...stats };
}
