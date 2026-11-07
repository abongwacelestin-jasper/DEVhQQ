import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { startApp, type TestServer } from '../helpers/server.ts';
import { signInAs } from '../helpers/auth.ts';

/**
 * Boots the app on an audit file left by an earlier (v2.0.0-format) process
 * whose second entry was edited while the service was down. The boot must
 * proceed, record a sensitive `audit.chain_discontinuity`, and surface it on
 * `/api/audit/verify`; readiness stays up (the live chain is intact).
 */

const GENESIS = '0'.repeat(64);
const digest = (e: Record<string, unknown>) =>
  createHash('sha256')
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

const stored: Record<string, unknown>[] = [];
let prevHash = GENESIS;
for (let seq = 1; seq <= 4; seq++) {
  const base = {
    seq,
    at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
    actor: 'm1',
    action: 'task.updated',
    target: `t${seq}`,
    sensitive: false,
    prevHash,
  };
  const e = { ...base, hash: digest(base) };
  stored.push(e);
  prevHash = e.hash;
}
stored[1].target = 'rewritten while the service was down';
writeFileSync(process.env.AUDIT_LOG_FILE!, stored.map((e) => JSON.stringify(e)).join('\n') + '\n');

let app: TestServer;
before(async () => {
  app = await startApp();
});
after(() => app.close());

interface Verify {
  ok: boolean;
  brokenAt?: number;
  live: { ok: boolean; discontinuity?: { reason: string; seq: number } };
  store: { kind: string; ok: boolean; firstBreak: { reason: string; seq: number } | null };
  continuity: { status: string; source: string; resumedFrom?: { seq: number; hash: string } };
}

describe('audit continuity — boot on a tampered store', () => {
  it('boots, links the discontinuity to the stored head and surfaces it on /api/audit/verify', async () => {
    const admin = await signInAs(app, 'admin');
    const v = await admin.get<Verify>('/api/audit/verify');
    assert.equal(v.status, 200);
    assert.deepEqual([v.json.ok, v.json.brokenAt], [false, 2]);
    assert.deepEqual(v.json.store.firstBreak?.reason, 'hash_mismatch');
    assert.deepEqual(
      [v.json.continuity.status, v.json.continuity.source, v.json.continuity.resumedFrom?.seq],
      ['discontinuity', 'file', 4],
    );
    assert.equal(v.json.live.ok, true);
    assert.deepEqual(
      [v.json.live.discontinuity?.reason, v.json.live.discontinuity?.seq],
      ['broken', 5],
    );

    const trail = await admin.get<{ seq: number; action: string; prevHash: string }[]>(
      '/api/audit?sensitive=1&action=audit.chain_discontinuity',
    );
    assert.equal(trail.json.length, 1);
    assert.deepEqual([trail.json[0].seq, trail.json[0].prevHash], [5, stored[3].hash]);
  });

  it('readiness stays up: the live chain is intact', async () => {
    const ready = await app.client().get<{ ready: boolean; auditChain: string }>('/api/ready');
    assert.deepEqual(
      [ready.status, ready.json.ready, ready.json.auditChain],
      [200, true, 'intact'],
    );
  });

  it('verification still needs Administration:view', async () => {
    const dev = await signInAs(app, 'developer');
    assert.equal((await dev.get('/api/audit/verify')).status, 403);
  });
});
