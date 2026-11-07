import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { audit, type AuditEntry } from '../../audit/auditLog.ts';
import { subscribe, type BusEvent } from '../../lib/events.ts';

/** Same canonical form as the module (fixed field order). */
function digest(e: Omit<AuditEntry, 'hash'>) {
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

/** The live entry objects, oldest first (list() returns references, newest first). */
const chain = () => audit.list({ limit: 10_000 }).reverse();

describe('audit/auditLog — hash chain', () => {
  before(() => {
    for (let i = 0; i < 5; i++)
      audit.append({
        actor: `m${i}`,
        action: 'test.event',
        target: `t${i}`,
        sensitive: i % 2 === 0,
        requestId: `r${i}`,
      });
  });

  it('links each entry to the previous hash, from a zero genesis', () => {
    const entries = chain();
    assert.equal(entries[0].prevHash, '0'.repeat(64));
    entries.forEach((e, i) => {
      assert.equal(e.seq, i + 1);
      assert.equal(e.hash, digest(e));
      if (i > 0) assert.equal(e.prevHash, entries[i - 1].hash);
    });
    assert.deepEqual(audit.verify(), { ok: true });
  });

  it('detects an edited field at the edited entry', () => {
    const e = chain()[2];
    const original = e.target;
    e.target = 'rewritten history';
    try {
      assert.deepEqual(audit.verify(), { ok: false, brokenAt: e.seq });
    } finally {
      e.target = original;
    }
    assert.deepEqual(audit.verify(), { ok: true });
  });

  it('detects an edit that also recomputes the entry hash, at the next entry', () => {
    const entries = chain();
    const e = entries[1];
    const saved = { actor: e.actor, hash: e.hash };
    e.actor = 'attacker';
    e.hash = digest(e);
    try {
      assert.deepEqual(audit.verify(), { ok: false, brokenAt: entries[2].seq });
    } finally {
      e.actor = saved.actor;
      e.hash = saved.hash;
    }
    assert.deepEqual(audit.verify(), { ok: true });
  });

  it('detects flipping the sensitive flag and a broken prevHash link', () => {
    const entries = chain();
    const e = entries[3];
    e.sensitive = !e.sensitive;
    assert.deepEqual(audit.verify(), { ok: false, brokenAt: e.seq });
    e.sensitive = !e.sensitive;
    const prev = e.prevHash;
    e.prevHash = 'f'.repeat(64);
    assert.deepEqual(audit.verify(), { ok: false, brokenAt: e.seq });
    e.prevHash = prev;
    assert.deepEqual(audit.verify(), { ok: true });
  });

  it('list() returns newest first, honours limit and sensitiveOnly', () => {
    const all = audit.list();
    assert.ok(all[0].seq > all[all.length - 1].seq);
    assert.equal(audit.list({ limit: 2 }).length, 2);
    assert.ok(audit.list({ sensitiveOnly: true }).every((e) => e.sensitive));
  });

  it('publishes each entry on the event bus and appends it to the JSONL file', async () => {
    const got: BusEvent[] = [];
    const off = subscribe((e) => got.push(e));
    const entry = audit.append({ actor: 'm1', action: 'test.file', target: 'x' });
    off();
    assert.equal(got.length, 1);
    assert.equal(got[0].type, 'audit');
    assert.equal(got[0].data.hash, entry.hash);
    // The write is fire-and-forget; poll briefly for it.
    const file = process.env.AUDIT_LOG_FILE!;
    let lines: string[] = [];
    for (let i = 0; i < 50 && !lines.some((l) => l.includes(entry.hash)); i++) {
      await new Promise((r) => setTimeout(r, 10));
      lines = (await readFile(file, 'utf8').catch(() => '')).trim().split('\n');
    }
    const written = lines
      .map((l) => JSON.parse(l) as AuditEntry)
      .find((l) => l.hash === entry.hash);
    assert.deepEqual(written, JSON.parse(JSON.stringify(entry)));
    // The persisted record can be re-verified offline.
    assert.equal(digest(written!), written!.hash);
  });
});
