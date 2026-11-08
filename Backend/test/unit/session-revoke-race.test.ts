/**
 * W5-01: a request that read a session before a concurrent revoke must not write
 * it back. Latency is injected into the read so the revoke lands in between.
 */
import '../setup.ts';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import {
  createSession,
  revokeAllExcept,
  rotateSession,
  validateSession,
} from '../../auth/sessions.ts';
import { repos } from '../../data/index.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/126.0 Safari/537.36';
const req = { headers: { 'user-agent': UA } } as unknown as IncomingMessage;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slowReads() {
  const realGet = repos.sessions.get.bind(repos.sessions);
  repos.sessions.get = async (id) => {
    const r = await realGet(id);
    await pause(20);
    return r;
  };
  return () => {
    repos.sessions.get = realGet;
  };
}

it('a revoke during an in-flight request is not undone by its write-back', async () => {
  const mid = 'w5-victim';
  const mine = await createSession(mid, req, '10.0.0.1', 'password', 'verified');
  const stolen = await createSession(mid, req, '10.0.0.2', 'password', 'verified');
  const restore = slowReads();
  try {
    // A new IP forces a write-back at the end of validation.
    const inFlight = validateSession(stolen.token, req, '203.0.113.9').catch((e: unknown) => e);
    await pause(5);
    assert.equal(await revokeAllExcept(mid, mine.session.id), 1);
    const outcome = await inFlight;
    assert.ok(outcome instanceof Error, 'the in-flight request ends with the session');
  } finally {
    restore();
  }
  await assert.rejects(validateSession(stolen.token, req, '203.0.113.9'), /Session ended|revoked/);
  assert.equal(await repos.sessions.get(stolen.session.id), undefined);
});

it('rotating a session that was revoked meanwhile does not mint a new one', async () => {
  const mid = 'w5-rotate';
  const s = await createSession(mid, req, '10.0.0.3', 'password', 'password');
  assert.equal(await revokeAllExcept(mid, 'none'), 1);
  await assert.rejects(rotateSession(s.session, { stage: 'verified' }), /Session ended/);
  assert.deepEqual(await repos.sessions.listByMember(mid), []);
});
