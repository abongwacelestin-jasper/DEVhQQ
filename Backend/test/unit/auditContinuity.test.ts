import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuditLog, type AuditEntry } from '../../audit/auditLog.ts';
import {
  CHAIN_DISCONTINUITY,
  CHAIN_GENESIS,
  CHAIN_RESUMED,
  GENESIS,
  verifySource,
  type AuditSource,
} from '../../audit/chain.ts';
import { fileSource } from '../../audit/fileSource.ts';
import { pgAuditSource, startAuditSink } from '../../db/auditSink.ts';
import { fakePool } from '../helpers/fakePg.ts';
import { subscribe } from '../../lib/events.ts';

const dir = join(process.env.DEVHQ_TEST_DIR!, 'continuity');
mkdirSync(dir, { recursive: true });
let fileN = 0;
const freshFile = () => join(dir, `audit-${++fileN}.jsonl`);

/** The v2.0.0 digest, written out independently of the module. */
function v2digest(e: Omit<AuditEntry, 'hash'>) {
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

/** Entries exactly as v2.0.0 wrote them: every boot a fresh chain from genesis. */
function legacyBoot(n: number, tag: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  let prevHash = GENESIS;
  for (let seq = 1; seq <= n; seq++) {
    const base = {
      seq,
      at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
      actor: 'm1',
      action: seq === 1 ? 'server.started' : 'task.updated',
      target: `${tag}-${seq}`,
      sensitive: seq % 2 === 0,
      ...(seq % 3 === 0 ? { requestId: `req-${tag}-${seq}` } : {}),
      prevHash,
    };
    const e = { ...base, hash: v2digest(base) };
    out.push(e);
    prevHash = e.hash;
  }
  return out;
}

const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean);
const entriesOf = (file: string) => lines(file).map((l) => JSON.parse(l) as AuditEntry);
const writeEntries = (file: string, es: unknown[]) =>
  writeFileSync(file, es.map((e) => JSON.stringify(e)).join('\n') + '\n');

/** One process lifetime against a file store: resume, append `n` entries, flush. */
async function bootFile(file: string, n: number, tag = 'e') {
  const log = new AuditLog({ file });
  const continuity = await log.resume(fileSource(file, () => log.fileWrittenHead()));
  for (let i = 0; i < n; i++)
    log.append({
      actor: 'm4',
      action: 'task.updated',
      target: `${tag}${i}`,
      requestId: `r-${tag}${i}`,
    });
  await log.flushFile();
  return { log, continuity };
}

const verifyFile = (file: string) => verifySource(fileSource(file));

/** Builds a 3-boot file (genesis + 2 resumed) and returns its entries. */
async function threeBoots() {
  const file = freshFile();
  await bootFile(file, 3, 'a');
  await bootFile(file, 3, 'b');
  await bootFile(file, 2, 'c');
  return { file, all: entriesOf(file) };
}

describe('audit continuity — file store', () => {
  it('the first boot on an empty store starts an explicit genesis', async () => {
    const file = freshFile();
    const { log, continuity } = await bootFile(file, 2);
    assert.equal(continuity.status, 'genesis');
    const [first] = entriesOf(file);
    assert.deepEqual([first.seq, first.prevHash, first.action], [1, GENESIS, CHAIN_GENESIS]);
    assert.deepEqual(log.verify(), { ok: true });
  });

  it('each restart continues seq and links to the last stored hash', async () => {
    const file = freshFile();
    await bootFile(file, 3, 'a');
    const before = entriesOf(file);
    const last = before[before.length - 1];
    const { log, continuity } = await bootFile(file, 2, 'b');
    assert.equal(continuity.status, 'resumed');
    assert.deepEqual(continuity.resumedFrom, { seq: last.seq, hash: last.hash });
    const after = entriesOf(file);
    const marker = after[before.length];
    assert.deepEqual(
      [marker.seq, marker.prevHash, marker.action, marker.sensitive],
      [last.seq + 1, last.hash, CHAIN_RESUMED, false],
    );
    // One chain: seq strictly consecutive, every entry linked to the one before.
    after.forEach((e, i) => {
      assert.equal(e.seq, i + 1);
      assert.equal(e.prevHash, i ? after[i - 1].hash : GENESIS);
      assert.equal(v2digest(e), e.hash);
    });
    assert.deepEqual(log.verify(), { ok: true });
    const full = await log.verifyAll();
    assert.equal(full.ok, true);
    assert.equal(full.store && 'entries' in full.store && full.store.entries, after.length);
    const third = await bootFile(file, 1, 'c');
    const report = await verifyFile(file);
    assert.deepEqual(
      [report.ok, report.entries, report.resumedBoots, report.legacyBoots, report.forks],
      [true, after.length + 2, 2, 0, 0],
    );
    assert.deepEqual(third.log.verify(), { ok: true });
  });

  it('a second resume() in the same process is a no-op', async () => {
    const file = freshFile();
    const { log } = await bootFile(file, 1);
    const again = await log.resume(fileSource(file));
    assert.equal(again.status, 'genesis');
    assert.equal(entriesOf(file).filter((e) => e.action === CHAIN_GENESIS).length, 1);
  });

  it('a torn last line (crash mid-write) is declared and the next line stays intact', async () => {
    const file = freshFile();
    await bootFile(file, 2);
    appendFileSync(file, '{"seq":4,"at":"2026-');
    const { continuity } = await bootFile(file, 1);
    assert.equal(continuity.status, 'discontinuity');
    assert.equal(continuity.discontinuity?.firstBreak?.reason, 'malformed');
    const tail = lines(file)
      .slice(-2)
      .map((l) => JSON.parse(l) as AuditEntry);
    assert.equal(tail[0].action, CHAIN_DISCONTINUITY);
    assert.equal(tail[0].seq, 4); // continues after the last valid entry (seq 3)
  });
});

describe('audit ordering', () => {
  it('an entry appended by a bus subscriber lands after the entry that triggered it, everywhere', async () => {
    const file = freshFile();
    const log = new AuditLog({ file });
    const sunk: number[] = [];
    log.addSink((e) => sunk.push(e.seq));
    const bus: number[] = [];
    const off = subscribe((ev) => {
      if (ev.type !== 'audit' || typeof ev.data.seq !== 'number') return;
      bus.push(ev.data.seq);
      if (ev.data.action === 'outer') log.append({ actor: 'system', action: 'inner', target: 'x' });
    });
    try {
      log.append({ actor: 'm1', action: 'first', target: 'x' });
      log.append({ actor: 'm1', action: 'outer', target: 'x' });
      log.append({ actor: 'm1', action: 'last', target: 'x' });
    } finally {
      off();
    }
    await log.flushFile();
    assert.deepEqual(
      entriesOf(file).map((e) => e.seq),
      [1, 2, 3, 4],
    );
    assert.deepEqual(bus, [1, 2, 3, 4]);
    assert.deepEqual(sunk, [1, 2, 3, 4]);
    assert.equal((await verifyFile(file)).ok, true);
  });
});

describe('audit continuity — tampering across a boot boundary', () => {
  it('detects an edited entry in an earlier boot', async () => {
    const { file, all } = await threeBoots();
    all[2].target = 'rewritten';
    writeEntries(file, all);
    const r = await verifyFile(file);
    assert.deepEqual([r.ok, r.firstBreak?.reason, r.firstBreak?.seq], [false, 'hash_mismatch', 3]);
  });

  it('detects an edit that recomputes the hash, at the next boot’s first entry', async () => {
    const { file, all } = await threeBoots();
    const lastOfBoot1 = all[3]; // genesis marker + 3 entries
    lastOfBoot1.actor = 'mallory';
    lastOfBoot1.hash = v2digest(lastOfBoot1);
    writeEntries(file, all);
    const r = await verifyFile(file);
    assert.equal(all[4].action, CHAIN_RESUMED);
    assert.deepEqual(
      [r.ok, r.firstBreak?.reason, r.firstBreak?.seq],
      [false, 'unknown_parent', all[4].seq],
    );
  });

  it('detects a missing entry (the cut tail of the previous boot)', async () => {
    const { file, all } = await threeBoots();
    writeEntries(file, [...all.slice(0, 3), ...all.slice(4)]);
    const r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unknown_parent', all[4].seq]);
  });

  it('detects a missing boot marker', async () => {
    const { file, all } = await threeBoots();
    writeEntries(file, [...all.slice(0, 4), ...all.slice(5)]);
    const r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unknown_parent', all[5].seq]);
  });

  it('detects entries reordered across and within boots', async () => {
    const { file, all } = await threeBoots();
    const swapped = [...all];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]]; // last of boot 1 ↔ marker of boot 2
    writeEntries(file, swapped);
    let r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unknown_parent', all[4].seq]);

    const inner = [...all];
    [inner[5], inner[6]] = [inner[6], inner[5]];
    writeEntries(file, inner);
    r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unknown_parent', all[6].seq]);
  });

  it('detects a duplicated line and a non-marker that jumps to an earlier entry', async () => {
    const { file, all } = await threeBoots();
    writeEntries(file, [...all.slice(0, 6), all[5], ...all.slice(6)]);
    assert.equal((await verifyFile(file)).firstBreak?.reason, 'duplicate');
    // Re-link an ordinary entry to an older parent (seq kept consistent): not a boot marker.
    const forged = { ...all[6], prevHash: all[1].hash, seq: all[1].seq + 1 };
    forged.hash = v2digest(forged);
    writeEntries(file, [...all.slice(0, 6), forged]);
    assert.equal((await verifyFile(file)).firstBreak?.reason, 'out_of_order');
  });

  it('detects a silent fresh genesis after continuity began', async () => {
    const { file, all } = await threeBoots();
    writeEntries(file, [...all.slice(0, 4), ...legacyBoot(3, 'forged')]);
    const r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unexpected_genesis', 1]);
  });

  it('verifyAll() detects a truncated tail of the running boot', async () => {
    const file = freshFile();
    await bootFile(file, 2, 'a');
    const { log } = await bootFile(file, 3, 'b');
    assert.equal((await log.verifyAll()).ok, true);
    const kept = lines(file).slice(0, -2);
    writeFileSync(file, kept.join('\n') + '\n');
    const full = await log.verifyAll();
    assert.equal(full.ok, false);
    assert.deepEqual(full.live, { ok: true }); // memory still has them
    assert.ok(full.store && 'firstBreak' in full.store);
    assert.equal(full.store.firstBreak?.reason, 'truncated_tail');
    assert.equal(full.brokenAt, log.list({ limit: 1 })[0].seq);
  });

  it('verifyAll() detects an edit to an earlier boot made while running', async () => {
    const file = freshFile();
    await bootFile(file, 3, 'a');
    const { log } = await bootFile(file, 1, 'b');
    const all = entriesOf(file);
    all[1].action = 'nothing.happened';
    writeEntries(file, all);
    const full = await log.verifyAll();
    assert.deepEqual([full.ok, full.brokenAt], [false, 2]);
  });

  it('a boot on a broken store records a sensitive discontinuity, linked, and boots anyway', async () => {
    const { file, all } = await threeBoots();
    all[1].target = 'rewritten';
    writeEntries(file, all);
    const { log, continuity } = await bootFile(file, 1, 'd');
    assert.equal(continuity.status, 'discontinuity');
    assert.equal(continuity.discontinuity?.reason, 'broken');
    assert.equal(continuity.discontinuity?.firstBreak?.seq, 2);
    const head = all[all.length - 1];
    const marker = entriesOf(file)[all.length];
    assert.deepEqual(
      [marker.action, marker.sensitive, marker.seq, marker.prevHash],
      [CHAIN_DISCONTINUITY, true, head.seq + 1, head.hash],
    );
    assert.match(marker.target, /chain broken at seq 2 \(hash_mismatch\)/);
    // The live chain is fine and says so; the discontinuity rides along.
    const live = log.verify();
    assert.equal(live.ok, true);
    assert.equal(live.discontinuity?.seq, marker.seq);
    const full = await log.verifyAll();
    assert.deepEqual([full.ok, full.brokenAt, full.continuity.status], [false, 2, 'discontinuity']);
  });
});

describe('audit continuity — unreadable store', () => {
  it('an unreadable file records a sensitive discontinuity instead of a silent genesis', async () => {
    const path = join(dir, 'a-directory');
    mkdirSync(path, { recursive: true });
    const log = new AuditLog({ file: join(dir, 'unreadable-out.jsonl') });
    const c = await log.resume(fileSource(path));
    assert.equal(c.status, 'discontinuity');
    assert.equal(c.discontinuity?.reason, 'unreadable');
    const [e] = log.list();
    assert.deepEqual(
      [e.seq, e.prevHash, e.action, e.sensitive],
      [1, GENESIS, CHAIN_DISCONTINUITY, true],
    );
    assert.match(e.target, /^file store unreadable: /);
    log.append({ actor: 'm1', action: 'x', target: 'y' });
    const live = log.verify();
    assert.equal(live.ok, true);
    assert.equal(live.discontinuity?.reason, 'unreadable');
  });

  it('a source that fails mid-scan is unreadable too', async () => {
    const failing: AuditSource = {
      kind: 'file',
      // eslint-disable-next-line require-yield -- the scan fails before its first record
      async *scan() {
        throw new Error('EIO: i/o error');
      },
    };
    const log = new AuditLog({ file: freshFile() });
    const c = await log.resume(failing);
    assert.deepEqual(
      [c.status, c.discontinuity?.detail],
      ['discontinuity', 'file store unreadable: EIO: i/o error'],
    );
  });

  it('a database that rejects the read records the discontinuity', async () => {
    const pg = fakePool();
    pg.onQuery = (q) => {
      if (q.sql.includes('FROM audit_entries'))
        throw new Error('permission denied for table audit_entries');
    };
    const log = new AuditLog({ file: freshFile() });
    const c = await log.resume(pgAuditSource(pg.pool));
    assert.equal(c.status, 'discontinuity');
    assert.match(c.discontinuity!.detail, /^postgres store unreadable: permission denied/);
    assert.equal(log.list()[0].action, CHAIN_DISCONTINUITY);
  });
});

describe('audit continuity — v2.0.0 data', () => {
  it('a v2.0.0 file (a fresh genesis per boot) still verifies, and the next boot links to it', async () => {
    const file = freshFile();
    const legacy = [...legacyBoot(5, 'x'), ...legacyBoot(3, 'y')];
    writeEntries(file, legacy);
    let r = await verifyFile(file);
    assert.deepEqual([r.ok, r.entries, r.legacyBoots, r.resumedBoots], [true, 8, 2, 0]);
    const { continuity } = await bootFile(file, 2);
    assert.equal(continuity.status, 'resumed');
    assert.deepEqual(continuity.resumedFrom, { seq: 3, hash: legacy[7].hash });
    r = await verifyFile(file);
    assert.deepEqual([r.ok, r.entries, r.legacyBoots, r.resumedBoots], [true, 11, 2, 1]);
  });

  it('tolerates the v2.0.0 write race (an entry stored before its parent), but not gaps or forks', async () => {
    const boot = legacyBoot(8, 'race');
    // v2.0.0 wrote a re-entrant append's line first: 1 2 3 5 6 4 7 8.
    const raced = [...boot.slice(0, 3), boot[4], boot[5], boot[3], ...boot.slice(6)];
    const file = freshFile();
    writeEntries(file, raced);
    let r = await verifyFile(file);
    assert.deepEqual([r.ok, r.legacyReordered, r.head?.seq], [true, 2, 8]);
    const { continuity } = await bootFile(file, 1);
    assert.deepEqual(continuity.resumedFrom, { seq: 8, hash: boot[7].hash });
    assert.equal((await verifyFile(file)).ok, true);

    writeEntries(file, [...boot.slice(0, 3), ...boot.slice(4)]); // seq 4 missing: never arrives
    r = await verifyFile(file);
    assert.deepEqual([r.ok, r.firstBreak?.reason, r.firstBreak?.seq], [false, 'unknown_parent', 5]);

    const fork = { ...boot[4], target: 'second child of seq 4' };
    fork.hash = v2digest(fork);
    writeEntries(file, [...boot.slice(0, 5), fork]);
    r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['out_of_order', 5]);
  });

  it('gives v2.1 data no reorder tolerance, even after legacy boots', async () => {
    const file = freshFile();
    writeEntries(file, legacyBoot(3, 'old'));
    await bootFile(file, 3);
    const all = entriesOf(file);
    [all[5], all[6]] = [all[6], all[5]];
    writeEntries(file, all);
    const r = await verifyFile(file);
    assert.deepEqual([r.firstBreak?.reason, r.firstBreak?.seq], ['unknown_parent', all[5].seq]);
  });

  it('a v2.1 file-mode file still passes the v2.0.0 documented verifier', async () => {
    const { file } = await threeBoots();
    // docs/operations/audit-verification.md (v2.0.0): reset to genesis on seq 1, else link to the previous line.
    let prev = GENESIS;
    for (const e of entriesOf(file)) {
      if (e.seq === 1) prev = GENESIS;
      assert.equal(e.prevHash, prev);
      assert.equal(v2digest(e), e.hash);
      prev = e.hash;
    }
  });
});

/** Fake pg pool whose audit_entries table behaves like the real one (append-only, ordered by id). */
function auditPool() {
  const pg = fakePool();
  const rows: Record<string, unknown>[] = [];
  let id = 0;
  pg.onQuery = (q) => {
    if (q.sql.includes('INSERT INTO audit_entries')) {
      const [chainId, seqs, ats, actors, actions, targets, sens, reqs, prevs, hashes] =
        q.params as [
          string,
          number[],
          string[],
          string[],
          string[],
          string[],
          boolean[],
          (string | null)[],
          string[],
          string[],
        ];
      seqs.forEach((seq, i) => {
        if (rows.some((r) => r.hash === hashes[i])) return; // ON CONFLICT (hash) DO NOTHING
        rows.push({
          id: String(++id),
          chain_id: chainId,
          seq: String(seq), // bigint comes back as text
          at: new Date(ats[i]), // timestamptz comes back as a Date
          actor: actors[i],
          action: actions[i],
          target: targets[i],
          sensitive: sens[i],
          request_id: reqs[i],
          prev_hash: prevs[i],
          hash: hashes[i],
        });
      });
      pg.loadRows = [];
    } else if (q.sql.includes('FROM audit_entries')) {
      // Real Postgres resolves a bare `ORDER BY id` to the `id::text` alias (1, 10, 2…):
      // the scan must order by the bigint column, which this fake then mirrors.
      assert.match(q.sql, /ORDER BY audit_entries\.id\b/);
      const [after, limit] = q.params as [string, number];
      pg.loadRows = rows
        .filter((r) => Number(r.id) > Number(after))
        .slice(0, limit)
        .map((r) => ({ ...r })) as typeof pg.loadRows;
    }
  };
  return { pg, rows };
}

/** One process lifetime against PostgreSQL: sink, resume, `n` entries, graceful flush. */
async function bootPg(pool: ReturnType<typeof auditPool>['pg']['pool'], n: number, tag = 'p') {
  const log = new AuditLog({ file: freshFile() }); // a fresh local file: resume must come from the DB
  const sink = startAuditSink(pool);
  const continuity = await log.resume(pgAuditSource(pool, sink));
  for (let i = 0; i < n; i++)
    log.append({ actor: 'm4', action: 'task.updated', target: `${tag}${i}` });
  return {
    log,
    sink,
    continuity,
    stop: async () => {
      await sink.close();
      await log.flushFile();
    },
  };
}

describe('audit continuity — PostgreSQL store (fake pg driver)', () => {
  it('a restart resumes from audit_entries and the table verifies as one chain', async () => {
    const { pg, rows } = auditPool();
    const b1 = await bootPg(pg.pool, 3, 'a');
    assert.equal(b1.continuity.status, 'genesis');
    await b1.stop();
    const head = rows[rows.length - 1];
    const b2 = await bootPg(pg.pool, 2, 'b');
    assert.equal(b2.continuity.status, 'resumed');
    assert.equal(b2.continuity.source, 'postgres');
    assert.deepEqual(b2.continuity.resumedFrom, { seq: Number(head.seq), hash: head.hash });
    await b2.stop();
    const marker = rows[4];
    assert.deepEqual(
      [marker.action, Number(marker.seq), marker.prev_hash, marker.chain_id !== head.chain_id],
      [CHAIN_RESUMED, Number(head.seq) + 1, head.hash, true],
    );
    const r = await verifySource(pgAuditSource(pg.pool));
    assert.deepEqual([r.ok, r.entries, r.resumedBoots, r.head?.seq], [true, 7, 1, 7]);
    const b3 = await bootPg(pg.pool, 1, 'c');
    const full = await b3.log.verifyAll();
    assert.deepEqual([full.ok, full.store?.kind], [true, 'postgres']);
    await b3.stop();
  });

  it('detects edited, missing and reordered rows across boots, and boots on with a discontinuity', async () => {
    const { pg, rows } = auditPool();
    await (await bootPg(pg.pool, 3, 'a')).stop();
    await (await bootPg(pg.pool, 3, 'b')).stop();
    const pristine = rows.map((r) => ({ ...r }));
    const check = async () => (await verifySource(pgAuditSource(pg.pool))).firstBreak;

    rows[2].target = 'rewritten';
    assert.deepEqual(await check().then((b) => [b?.reason, b?.seq]), ['hash_mismatch', 3]);
    rows.splice(0, rows.length, ...pristine.map((r) => ({ ...r })));

    rows.splice(3, 1); // last row of boot 1
    assert.deepEqual(await check().then((b) => [b?.reason, b?.seq]), ['unknown_parent', 5]);
    rows.splice(0, rows.length, ...pristine.map((r) => ({ ...r })));

    [rows[5].id, rows[6].id] = [rows[6].id, rows[5].id]; // two rows of boot 2 swapped
    rows.sort((x, y) => Number(x.id) - Number(y.id));
    assert.equal((await check())?.reason, 'unknown_parent');
    rows.splice(0, rows.length, ...pristine.map((r) => ({ ...r })));
    assert.equal(await check(), null);

    rows[1].actor = 'mallory';
    const b3 = await bootPg(pg.pool, 1, 'c');
    assert.equal(b3.continuity.status, 'discontinuity');
    assert.equal(b3.continuity.discontinuity?.firstBreak?.reason, 'hash_mismatch');
    await b3.stop();
    const marker = rows[pristine.length];
    assert.deepEqual([marker.action, marker.sensitive], [CHAIN_DISCONTINUITY, true]);
  });

  it('verifyAll() detects a missing row this process committed', async () => {
    const { pg, rows } = auditPool();
    const b = await bootPg(pg.pool, 3);
    await b.sink.close();
    assert.equal((await b.log.verifyAll()).ok, true);
    rows.pop();
    const full = await b.log.verifyAll();
    assert.equal(full.ok, false);
    assert.equal(
      full.store && 'firstBreak' in full.store && full.store.firstBreak?.reason,
      'truncated_tail',
    );
  });

  it('two replicas resuming from the same head verify as a fork, not a break', async () => {
    const { pg, rows } = auditPool();
    await (await bootPg(pg.pool, 2, 'a')).stop();
    // Replica 2 read the table before replica 1 wrote anything (a snapshot of it).
    const snapshot = rows.map((r) => ({ ...r }));
    await (await bootPg(pg.pool, 3, 'r1')).stop();
    const r2 = new AuditLog({ file: freshFile() });
    const sink2 = startAuditSink(pg.pool);
    const c2 = await r2.resume({
      kind: 'postgres',
      async *scan() {
        for (const row of snapshot) yield { raw: row, position: Number(row.id) };
      },
    });
    for (let i = 0; i < 3; i++) r2.append({ actor: 'm2', action: 'x', target: `r2-${i}` });
    await sink2.close();
    assert.deepEqual(c2.resumedFrom?.seq, 3);
    const r = await verifySource(pgAuditSource(pg.pool));
    assert.equal(r.ok, true, JSON.stringify(r.firstBreak));
    assert.deepEqual([r.forks, r.resumedBoots, rows.length], [1, 2, 3 + 4 + 4]);
  });

  it('v2.0.0 rows (a genesis chain per chain_id) still verify', async () => {
    const { pg } = auditPool();
    const legacy = [legacyBoot(4, 'x'), legacyBoot(2, 'y')];
    for (const [i, boot] of legacy.entries()) {
      await pg.pool.query('INSERT INTO audit_entries', [
        `legacy-${i}`,
        boot.map((e) => e.seq),
        boot.map((e) => e.at),
        boot.map((e) => e.actor),
        boot.map((e) => e.action),
        boot.map((e) => e.target),
        boot.map((e) => e.sensitive),
        boot.map((e) => e.requestId ?? null),
        boot.map((e) => e.prevHash),
        boot.map((e) => e.hash),
      ]);
    }
    const r = await verifySource(pgAuditSource(pg.pool));
    assert.deepEqual([r.ok, r.entries, r.legacyBoots], [true, 6, 2]);
    const b = await bootPg(pg.pool, 1);
    assert.deepEqual(
      [b.continuity.status, b.continuity.resumedFrom?.hash],
      ['resumed', legacy[1][1].hash],
    );
    await b.stop();
  });
});

describe('scripts/verify-audit.ts', () => {
  const script = fileURLToPath(new URL('../../scripts/verify-audit.ts', import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'error' },
    });

  it('exits 0 on an intact multi-boot file and 1 with the first break on a tampered copy', async () => {
    const { file, all } = await threeBoots();
    const ok = run(file);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(
      ok.stdout,
      /^ok: 11 entries, head seq 11 .*2 linked boot\(s\), 0 v2\.0\.0 chain\(s\)/,
    );
    const bad = freshFile();
    writeEntries(bad, [...all.slice(0, 7), ...all.slice(8)]);
    const res = run(bad);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /broken: unknown_parent at line 8 \(seq 9\)/);
  });

  it('checks a DB export (row_to_json lines) and a trusted head', async () => {
    const { pg, rows } = auditPool();
    await (await bootPg(pg.pool, 2)).stop();
    await (await bootPg(pg.pool, 2)).stop();
    const exp = freshFile();
    // What `psql -At -c "SELECT row_to_json(a) FROM audit_entries a ORDER BY id"` prints.
    writeEntries(
      exp,
      rows.map((r) => ({
        ...r,
        id: Number(r.id),
        seq: Number(r.seq),
        at: (r.at as Date).toISOString().replace('Z', '+00:00'),
      })),
    );
    const ok = run(exp, '--head', String(rows[rows.length - 1].hash));
    assert.equal(ok.status, 0, ok.stderr);
    const cut = freshFile();
    writeFileSync(cut, lines(exp).slice(0, -1).join('\n') + '\n');
    const res = run(cut, '--head', String(rows[rows.length - 1].hash));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /broken: truncated_tail/);
  });

  it('exits 2 for declared discontinuities, 66 for unreadable input, 64 for bad usage', async () => {
    const file = freshFile();
    await bootFile(file, 1);
    const all = entriesOf(file);
    all[0].target = 'x';
    writeEntries(file, all);
    await bootFile(file, 1); // records a linked discontinuity…
    assert.equal(run(file).status, 1); // …but the edited entry is still the first break
    writeEntries(file, entriesOf(file).slice(2)); // dropping the broken boot leaves the next one unanchored
    assert.equal(run(file).status, 1);

    const declared = freshFile();
    const unreadable = new AuditLog({ file: declared });
    await unreadable.resume(fileSource(dir)); // a directory: unreadable → discontinuity at genesis
    unreadable.append({ actor: 'm1', action: 'x', target: 'y' });
    await unreadable.flushFile();
    const res = run(declared);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /discontinuity at line 1 \(seq 1/);
    assert.equal(run(join(dir, 'nope.jsonl')).status, 66);
    assert.equal(run().status, 64);
    assert.equal(run(file, '--head', 'abc').status, 64);
  });
});
