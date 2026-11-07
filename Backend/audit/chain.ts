/**
 * Audit chain primitives shared by the live log (auditLog.ts), the boot-time
 * resume, `GET /api/audit/verify` and the offline verifier
 * (scripts/verify-audit.ts).
 *
 * The hash format is the v2.0.0 one, unchanged: SHA-256 over a fixed-order
 * JSON array of every field but `hash`. Since v2.1 a boot continues the
 * previous boot's chain: its first entry (`audit.chain_resumed`, or
 * `audit.chain_discontinuity` when the store could not be trusted) carries
 * `seq = last.seq + 1` and `prevHash = last.hash`, so history from every boot
 * is one verifiable chain. See ADR 0008 (addendum).
 *
 * `ChainVerifier` checks a stream of stored entries in storage order (file
 * lines, or `audit_entries` rows by id) and reports the first break:
 *
 *   hash_mismatch      an entry's fields no longer hash to its `hash` (edited)
 *   unknown_parent     `prevHash` names no earlier entry (missing entry, a
 *                      reordered entry, or a cut tail before a later boot)
 *   out_of_order       an entry does not follow the entry before it in the
 *                      same boot, and is not a boot marker
 *   seq_mismatch       `seq` is not its parent's `seq + 1`
 *   duplicate          the same entry appears twice
 *   unexpected_genesis a fresh 64-zero chain start after continuity began,
 *                      without a declared discontinuity
 *   malformed          a line or row that is not an audit entry
 *   truncated_tail     an expected head (last entry known to be written) is
 *                      absent from the store
 *
 * Fresh genesis starts written by v2.0.0 (one per boot, before any v2.1
 * marker) are accepted and counted as `legacyBoots`. v2.0.0 could also store
 * an entry a few lines before the entry it follows (a re-entrant append raced
 * the file write); before the first v2.1 marker such an entry is held until
 * its parent arrives (within LEGACY_WINDOW records, each parent continued at
 * most once) and counted as `legacyReordered`. v2.1+ data gets no tolerance.
 */

import { createHash } from 'node:crypto';

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

export const GENESIS = '0'.repeat(64);

/** First entry of a boot that continued the stored chain. */
export const CHAIN_RESUMED = 'audit.chain_resumed';
/** First entry of a boot whose store was empty (the very first boot). */
export const CHAIN_GENESIS = 'audit.chain_genesis';
/** First entry of a boot whose store was unreadable or already broken (sensitive). */
export const CHAIN_DISCONTINUITY = 'audit.chain_discontinuity';
const BOOT_MARKERS = new Set([CHAIN_RESUMED, CHAIN_GENESIS, CHAIN_DISCONTINUITY]);

export function digest(e: Omit<AuditEntry, 'hash'>): string {
  // Fixed field order so the hash is deterministic (v2.0.0 format).
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

export interface ChainHead {
  seq: number;
  hash: string;
}

export type BreakReason =
  | 'malformed'
  | 'hash_mismatch'
  | 'unknown_parent'
  | 'out_of_order'
  | 'seq_mismatch'
  | 'duplicate'
  | 'unexpected_genesis'
  | 'truncated_tail';

export interface ChainBreak {
  reason: BreakReason;
  /** The entry's `seq` (null for a malformed record or a missing head). */
  seq: number | null;
  /** 1-based line number (file) or row id (database). */
  position: number;
  /** File name, when several files were verified as one stream. */
  source?: string;
  detail: string;
}

export interface Discontinuity {
  seq: number;
  at: string;
  target: string;
  position: number;
  source?: string;
}

export interface ChainReport {
  ok: boolean;
  entries: number;
  /** Last valid entry in storage order: where the next boot resumes. */
  head: ChainHead | null;
  firstBreak: ChainBreak | null;
  /** Boots that continued an earlier entry (v2.1+). */
  resumedBoots: number;
  /** Fresh 64-zero chain starts written by v2.0.0 (accepted). */
  legacyBoots: number;
  /** Declared `audit.chain_discontinuity` boots (need review, not a break). */
  discontinuities: Discontinuity[];
  /** Entries that link to a parent already continued by another entry (replicas, lost file tail). */
  forks: number;
  /** v2.0.0 entries stored before the entry they follow (a v2.0.0 write race; accepted, linear). */
  legacyReordered: number;
}

/** How far (in records) a v2.0.0 entry may be stored ahead of its parent. */
const LEGACY_WINDOW = 1_000;

interface Parked {
  entry: AuditEntry;
  chainId: string | undefined;
  position: number;
  source: string | undefined;
  at: number;
}

/** A stored record: a file line (camelCase), a DB row (snake_case) or a `row_to_json` export. */
export interface StoredRecord {
  raw: unknown;
  position: number;
  source?: string;
}

const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** Reads an entry from any stored shape. Returns null when it is not an audit entry. */
export function normalizeEntry(raw: unknown): (AuditEntry & { chainId?: string }) | 'skip' | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Archive batch header line (storage/auditArchive.ts): not an entry.
  if (r.type === 'devhq.audit.batch') return 'skip';
  const seq = typeof r.seq === 'string' && /^\d+$/.test(r.seq) ? Number(r.seq) : r.seq;
  let at: unknown = r.at;
  if (at instanceof Date) at = at.toISOString();
  else if (typeof at === 'string' && !ISO_MS.test(at)) {
    // timestamptz from an export ("…+00:00"): the original was toISOString().
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) at = d.toISOString();
  }
  const prevHash = r.prevHash ?? r.prev_hash;
  const requestId = r.requestId ?? r.request_id;
  const chainId = r.chainId ?? r.chain_id;
  if (
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    typeof at !== 'string' ||
    typeof r.actor !== 'string' ||
    typeof r.action !== 'string' ||
    typeof r.target !== 'string' ||
    typeof r.sensitive !== 'boolean' ||
    typeof prevHash !== 'string' ||
    typeof r.hash !== 'string' ||
    (requestId !== undefined && requestId !== null && typeof requestId !== 'string')
  )
    return null;
  return {
    seq,
    at,
    actor: r.actor,
    action: r.action,
    target: r.target,
    sensitive: r.sensitive,
    ...(typeof requestId === 'string' ? { requestId } : {}),
    prevHash,
    hash: r.hash,
    ...(typeof chainId === 'string' ? { chainId } : {}),
  };
}

export class ChainVerifier {
  private seen = new Map<string, { seq: number; children: number }>();
  private prev: AuditEntry | null = null;
  private chains = new Map<string, string>();
  private markerSeen = false;
  private roots = 0;
  private report: ChainReport = {
    ok: true,
    entries: 0,
    head: null,
    firstBreak: null,
    resumedBoots: 0,
    legacyBoots: 0,
    discontinuities: [],
    forks: 0,
    legacyReordered: 0,
  };

  private where: string | undefined;
  /** Records pushed so far (the clock for the legacy reorder window). */
  private records = 0;
  /** v2.0.0 entries waiting for their parent, by the parent's hash. */
  private parked = new Map<string, Parked[]>();
  private parkedHashes = new Set<string>();

  private fail(reason: BreakReason, seq: number | null, position: number, detail: string) {
    if (this.report.firstBreak) return;
    this.report.ok = false;
    this.report.firstBreak = {
      reason,
      seq,
      position,
      ...(this.where ? { source: this.where } : {}),
      detail,
    };
  }

  push({ raw, position, source }: StoredRecord): void {
    this.where = source;
    this.records++;
    const e = normalizeEntry(raw);
    if (e === 'skip') return;
    if (!e) {
      this.fail('malformed', null, position, 'not an audit entry');
      return;
    }
    this.report.entries++;
    const { chainId, ...entry } = e;
    const { hash, ...rest } = entry;
    if (digest(rest) !== hash)
      this.fail('hash_mismatch', e.seq, position, 'fields do not match hash');
    if (this.seen.has(hash) || this.parkedHashes.has(hash)) {
      this.fail('duplicate', e.seq, position, 'entry appears twice');
      return;
    }
    const isMarker = BOOT_MARKERS.has(e.action);
    if (isMarker) this.releaseParked(); // v2.1 data from here on: no legacy tolerance
    if (
      e.prevHash !== GENESIS &&
      !this.seen.has(e.prevHash) &&
      !this.markerSeen &&
      !isMarker &&
      this.parkedHashes.size < LEGACY_WINDOW
    ) {
      // v2.0.0 could write an entry before the one it follows (a re-entrant
      // append); hold it until its parent arrives, within a bounded window.
      const list = this.parked.get(e.prevHash) ?? [];
      list.push({ entry, chainId, position, source, at: this.records });
      this.parked.set(e.prevHash, list);
      this.parkedHashes.add(hash);
      this.expireParked();
      return;
    }
    this.link(entry, chainId, position, isMarker, false);
    this.expireParked();
  }

  private link(
    e: AuditEntry,
    chainId: string | undefined,
    position: number,
    isMarker: boolean,
    late: boolean,
  ): void {
    const legacy = !this.markerSeen && !isMarker;
    // Within one boot entries are strictly sequential. A boot boundary is the
    // first row of a new chain_id (database) or a link to anything but the
    // previous line (file); only a boot marker may start a new boot.
    const sameBootPrev = chainId !== undefined ? this.chains.get(chainId) : this.prev?.hash;
    const newBoot =
      chainId !== undefined ? sameBootPrev === undefined : e.prevHash !== sameBootPrev;
    if (e.prevHash === GENESIS) {
      if (e.seq !== 1) this.fail('seq_mismatch', e.seq, position, 'genesis entry must be seq 1');
      this.roots++;
      if (e.action === CHAIN_DISCONTINUITY) this.noteDiscontinuity(e, position);
      else if (this.roots > 1 && this.markerSeen)
        this.fail(
          'unexpected_genesis',
          e.seq,
          position,
          'fresh chain without a declared discontinuity',
        );
      else if (!isMarker) this.report.legacyBoots++; // a v2.0.0 boot
    } else {
      const parent = this.seen.get(e.prevHash);
      if (!parent) {
        this.fail('unknown_parent', e.seq, position, 'prevHash names no earlier entry');
      } else {
        if (e.seq !== parent.seq + 1)
          this.fail('seq_mismatch', e.seq, position, `expected seq ${parent.seq + 1}`);
        if (legacy) {
          // v2.0.0: order may be off by a write race, but the chain must stay linear.
          if (parent.children > 0)
            this.fail(
              'out_of_order',
              e.seq,
              position,
              `a second entry continues seq ${parent.seq}`,
            );
        } else if (newBoot && !isMarker) {
          this.fail(
            'out_of_order',
            e.seq,
            position,
            'does not follow the previous entry of its boot',
          );
        }
        if (parent.children++ > 0 && !legacy) this.report.forks++;
      }
      if (isMarker) {
        this.report.resumedBoots++;
        if (e.action === CHAIN_DISCONTINUITY) this.noteDiscontinuity(e, position);
      }
    }
    if (late) this.report.legacyReordered++;
    if (isMarker) this.markerSeen = true;
    this.seen.set(e.hash, { seq: e.seq, children: 0 });
    if (chainId !== undefined) this.chains.set(chainId, e.hash);
    this.prev = e;
    this.report.head = { seq: e.seq, hash: e.hash };
    // Children that arrived before this entry.
    const waiting = this.parked.get(e.hash);
    if (waiting) {
      this.parked.delete(e.hash);
      for (const w of waiting) {
        this.parkedHashes.delete(w.entry.hash);
        const where = this.where;
        this.where = w.source;
        this.link(w.entry, w.chainId, w.position, false, true);
        this.where = where;
      }
    }
  }

  /** Parked entries whose parent never arrived are breaks (missing entry). */
  private releaseParked(all = true) {
    const expired: Parked[] = [];
    for (const [prevHash, list] of this.parked) {
      const keep = all ? [] : list.filter((w) => this.records - w.at <= LEGACY_WINDOW);
      expired.push(...list.filter((w) => !keep.includes(w)));
      if (keep.length) this.parked.set(prevHash, keep);
      else this.parked.delete(prevHash);
    }
    expired.sort((a, b) => a.at - b.at);
    for (const w of expired) {
      this.parkedHashes.delete(w.entry.hash);
      const where = this.where;
      this.where = w.source;
      this.fail('unknown_parent', w.entry.seq, w.position, 'prevHash names no earlier entry');
      this.where = where;
    }
  }

  private expireParked() {
    if (this.parked.size) this.releaseParked(false);
  }

  private noteDiscontinuity(e: AuditEntry, position: number) {
    this.report.discontinuities.push({
      seq: e.seq,
      at: e.at,
      target: e.target,
      position,
      ...(this.where ? { source: this.where } : {}),
    });
  }

  /** Final report. `expectHead` is the last entry known to have been written to this store. */
  finish(expectHead?: ChainHead | null): ChainReport {
    this.releaseParked();
    this.where = undefined;
    if (expectHead && !this.seen.has(expectHead.hash))
      this.fail(
        'truncated_tail',
        expectHead.seq,
        0,
        `entry seq ${expectHead.seq} is missing from the store`,
      );
    return this.report;
  }
}

/** A durable copy of the chain that a boot resumes from and verifyAll() re-reads. */
export interface AuditSource {
  kind: 'file' | 'postgres';
  /** Stored records in storage order. Throws when the store cannot be read. */
  scan(): AsyncIterable<StoredRecord>;
  /** The last entry this process knows it wrote to the store, if tracked. */
  expectedHead?(): ChainHead | null;
}

export async function verifySource(
  source: AuditSource,
  expectHead?: ChainHead | null,
): Promise<ChainReport> {
  const v = new ChainVerifier();
  for await (const rec of source.scan()) v.push(rec);
  return v.finish(expectHead);
}
