/**
 * Tamper-evident audit log.
 *
 * Each entry stores the SHA-256 hash of the previous entry, forming a chain.
 * Editing or deleting any historical record breaks every hash after it, which
 * `verify()` detects. Entries are also appended to a JSONL file opened in
 * append-only mode; in production ship them to write-once storage (object lock
 * / WORM) so an attacker with server access still can't rewrite history.
 *
 * Across restarts (ADR 0008 addendum): on boot `resume()` reads the durable
 * store (PostgreSQL `audit_entries` when DATABASE_URL is set, else the JSONL
 * file), verifies it end to end and continues it: the boot's first entry has
 * `seq = last.seq + 1` and `prevHash = last.hash`. When the store cannot be
 * read or is already broken the boot still proceeds, but its first entry is a
 * sensitive `audit.chain_discontinuity` — a fresh genesis is never silent.
 * Without `resume()` (unit tests, scripts) the log starts at genesis as before.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { publish } from '../lib/events.ts';
import {
  CHAIN_DISCONTINUITY,
  CHAIN_GENESIS,
  CHAIN_RESUMED,
  GENESIS,
  digest,
  verifySource,
  type AuditEntry,
  type AuditSource,
  type ChainBreak,
  type ChainHead,
  type ChainReport,
} from './chain.ts';
import { endsMidLine } from './fileSource.ts';

export type { AuditEntry } from './chain.ts';
export { GENESIS } from './chain.ts';

type NewEntry = Pick<AuditEntry, 'actor' | 'action' | 'target'> & {
  sensitive?: boolean;
  requestId?: string;
};

export interface Continuity {
  /** Where this boot's chain was resumed from. */
  source: 'none' | 'file' | 'postgres';
  /**
   * not_resumed — no durable store consulted (in-memory / unit tests);
   * genesis     — the store was empty: this is the first boot;
   * resumed     — the stored chain verified and this boot continues it;
   * discontinuity — the store was unreadable or broken (see `discontinuity`).
   */
  status: 'not_resumed' | 'genesis' | 'resumed' | 'discontinuity';
  /** The stored head this boot links to. */
  resumedFrom?: ChainHead;
  /** Entries found in the store at boot. */
  storedEntries?: number;
  discontinuity?: {
    reason: 'unreadable' | 'broken';
    /** seq of the `audit.chain_discontinuity` entry. */
    seq: number;
    detail: string;
    firstBreak?: ChainBreak;
  };
}

export type LiveVerify =
  | { ok: true; discontinuity?: Continuity['discontinuity'] }
  | { ok: false; brokenAt: number; discontinuity?: Continuity['discontinuity'] };

export interface FullVerify {
  ok: boolean;
  /** First broken seq (live chain first, then the store). */
  brokenAt?: number;
  /** The in-memory chain of this boot. */
  live: LiveVerify;
  /** The durable store, re-read end to end (null when there is none). */
  store:
    | (Omit<ChainReport, 'ok'> & { kind: AuditSource['kind']; ok: boolean })
    | { kind: AuditSource['kind']; ok: false; error: string }
    | null;
  continuity: Continuity;
}

const short = (h: string) => h.slice(0, 12);

export class AuditLog {
  private entries: AuditEntry[] = [];
  readonly file: string;
  /** The stored entry this boot continues (genesis when nothing was resumed). */
  private anchor: ChainHead = { seq: 0, hash: GENESIS };
  private source: AuditSource | null = null;
  private continuity: Continuity = { source: 'none', status: 'not_resumed' };
  /** File writes are serialised so lines land in chain order. */
  private writes: Promise<void>;
  private fileHead: ChainHead | null = null;
  private newlineFirst = false;
  /** Archive sinks (STORAGE: batches entries to the WORM audit bucket). Must not throw. */
  private sinks: ((entry: AuditEntry) => void)[] = [];
  private outbox: AuditEntry[] = [];
  private publishing = false;

  constructor(opts: { file?: string } = {}) {
    this.file = opts.file ?? process.env.AUDIT_LOG_FILE ?? './.audit/audit.jsonl';
    this.writes = mkdir(dirname(this.file), { recursive: true }).then(
      () => undefined,
      () => undefined,
    );
  }

  addSink(sink: (entry: AuditEntry) => void) {
    this.sinks.push(sink);
  }

  /**
   * Continues the chain stored in `source`. Call once at boot, before the
   * first append; later calls (or calls after entries exist) are no-ops.
   */
  async resume(source: AuditSource): Promise<Continuity> {
    if (this.source || this.entries.length) return this.continuity;
    this.source = source;
    let report: ChainReport;
    try {
      report = await verifySource(source);
    } catch (err) {
      const detail = `${source.kind} store unreadable: ${String((err as Error)?.message ?? err)}`;
      const e = this.append({
        actor: 'system',
        action: CHAIN_DISCONTINUITY,
        target: detail,
        sensitive: true,
      });
      this.continuity = {
        source: source.kind,
        status: 'discontinuity',
        discontinuity: { reason: 'unreadable', seq: e.seq, detail },
      };
      return this.continuity;
    }
    // A torn last line (crash mid-write) must not swallow this boot's first entry.
    const tornTail = await endsMidLine(this.file);
    if (this.entries.length) {
      // Something appended while the store was being read: those entries
      // already chain from genesis and cannot be re-linked. Say so.
      const detail =
        `entries appended before the ${source.kind} chain was resumed` +
        (report.head ? ` · stored head seq ${report.head.seq} · ${short(report.head.hash)}` : '');
      const e = this.append({
        actor: 'system',
        action: CHAIN_DISCONTINUITY,
        target: detail,
        sensitive: true,
      });
      this.continuity = {
        source: source.kind,
        status: 'discontinuity',
        storedEntries: report.entries,
        discontinuity: { reason: 'broken', seq: e.seq, detail },
      };
      return this.continuity;
    }
    this.newlineFirst = tornTail;
    if (report.head) this.anchor = report.head;
    const base = { source: source.kind, storedEntries: report.entries } as const;
    if (!report.ok) {
      const b = report.firstBreak!;
      const detail =
        `${source.kind} chain broken at ${b.seq === null ? `position ${b.position}` : `seq ${b.seq}`} ` +
        `(${b.reason})` +
        (report.head
          ? ` · continuing from seq ${report.head.seq} · ${short(report.head.hash)}`
          : '');
      const e = this.append({
        actor: 'system',
        action: CHAIN_DISCONTINUITY,
        target: detail,
        sensitive: true,
      });
      this.continuity = {
        ...base,
        status: 'discontinuity',
        ...(report.head ? { resumedFrom: report.head } : {}),
        discontinuity: { reason: 'broken', seq: e.seq, detail, firstBreak: b },
      };
    } else if (!report.head) {
      this.append({
        actor: 'system',
        action: CHAIN_GENESIS,
        target: `${source.kind} · empty store`,
      });
      this.continuity = { ...base, status: 'genesis' };
    } else {
      this.append({
        actor: 'system',
        action: CHAIN_RESUMED,
        target: `${source.kind} · seq ${report.head.seq} · ${short(report.head.hash)} · ${report.entries} stored`,
      });
      this.continuity = { ...base, status: 'resumed', resumedFrom: report.head };
    }
    return this.continuity;
  }

  append(input: NewEntry): AuditEntry {
    const prev = this.entries[this.entries.length - 1] ?? this.anchor;
    const base = {
      seq: prev.seq + 1,
      at: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      target: input.target,
      sensitive: !!input.sensitive,
      requestId: input.requestId,
      prevHash: prev.hash,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    this.entries.push(entry);
    // Durable copies first, then the bus: a bus subscriber may itself append
    // (re-entrantly), and its entry must land after this one everywhere.
    const line = (this.newlineFirst ? '\n' : '') + JSON.stringify(entry) + '\n';
    this.newlineFirst = false;
    this.writes = this.writes
      .then(() => appendFile(this.file, line, { flag: 'a' }))
      .then(
        () => {
          this.fileHead = { seq: entry.seq, hash: entry.hash };
        },
        (err) => console.error('audit write failed', err),
      );
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch (err) {
        console.error('audit sink failed', err);
      }
    }
    this.emit(entry);
    return entry;
  }

  /** Publishes on the event bus in chain order, even when a subscriber appends re-entrantly. */
  private emit(entry: AuditEntry) {
    this.outbox.push(entry);
    if (this.publishing) return;
    this.publishing = true;
    try {
      for (let e = this.outbox.shift(); e; e = this.outbox.shift()) publish('audit', { ...e });
    } finally {
      this.publishing = false;
    }
  }

  /** Resolves once every entry appended so far has been written to the JSONL file (or failed). */
  flushFile(): Promise<void> {
    return this.writes;
  }

  /** The last entry confirmed written to the JSONL file. */
  fileWrittenHead(): ChainHead | null {
    return this.fileHead;
  }

  /**
   * Recomputes this boot's chain from its anchor (the stored head it resumed
   * from, or genesis). Returns the first broken sequence number, or null if
   * intact; a boot-time discontinuity is reported alongside, not as a break.
   */
  verify(): LiveVerify {
    const extra = this.continuity.discontinuity
      ? { discontinuity: this.continuity.discontinuity }
      : {};
    let prevHash = this.anchor.hash;
    let seq = this.anchor.seq;
    for (const e of this.entries) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prevHash || e.seq !== seq + 1 || digest(rest) !== hash)
        return { ok: false, brokenAt: e.seq, ...extra };
      prevHash = hash;
      seq = e.seq;
    }
    return { ok: true, ...extra };
  }

  /**
   * verify() plus the durable store re-read end to end, across every boot:
   * detects edited, missing, reordered and duplicated entries, and a cut tail
   * (the last entry this process wrote must still be there).
   */
  async verifyAll(): Promise<FullVerify> {
    const live = this.verify();
    const continuity = this.continuity;
    if (!this.source)
      return {
        ok: live.ok,
        ...(live.ok ? {} : { brokenAt: live.brokenAt }),
        live,
        store: null,
        continuity,
      };
    const kind = this.source.kind;
    if (kind === 'file') await this.flushFile();
    let store: FullVerify['store'];
    try {
      const report = await verifySource(this.source, this.source.expectedHead?.() ?? null);
      store = { kind, ...report };
    } catch (err) {
      store = { kind, ok: false, error: String((err as Error)?.message ?? err) };
    }
    const storeBreak = 'firstBreak' in store ? (store.firstBreak?.seq ?? undefined) : undefined;
    const brokenAt = !live.ok ? live.brokenAt : storeBreak;
    const ok = live.ok && store.ok;
    return { ok, ...(!ok && brokenAt !== undefined ? { brokenAt } : {}), live, store, continuity };
  }

  status(): Continuity {
    return this.continuity;
  }

  list(opts: { limit?: number; sensitiveOnly?: boolean } = {}): AuditEntry[] {
    const l = opts.sensitiveOnly ? this.entries.filter((e) => e.sensitive) : this.entries;
    return l.slice(-(opts.limit ?? 200)).reverse();
  }
}

export const audit = new AuditLog();
