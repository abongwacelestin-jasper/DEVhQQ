import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { limiterStats, rateLimit } from '../../security/rateLimit.ts';
import type { Ctx } from '../../lib/http.ts';
import { HttpError, type Principal } from '../../types.ts';

let uniq = 0;
const name = () => `t${++uniq}`;

function ctx(ip: string, sessionId?: string) {
  const headers: Record<string, string> = {};
  const c = {
    ip,
    principal: sessionId ? ({ sessionId } as Principal) : undefined,
    res: { setHeader: (k: string, v: string) => (headers[k] = v) },
  } as unknown as Ctx;
  return { c, headers };
}

/** Runs one request through the limiter; true if allowed. */
async function hit(mw: ReturnType<typeof rateLimit>, ip: string, sessionId?: string) {
  const { c, headers } = ctx(ip, sessionId);
  try {
    await mw(c, async () => undefined);
    return { ok: true, headers };
  } catch (e) {
    assert.ok(e instanceof HttpError && e.status === 429 && e.code === 'rate_limited');
    return { ok: false, headers };
  }
}

describe('security/rateLimit — token bucket', () => {
  it('allows a burst of `capacity`, then 429 with Retry-After', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const mw = rateLimit({ name: name(), capacity: 3, refillPerSec: 0.5 });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(mw, '1.1.1.1'));
    assert.deepEqual(
      results.map((r) => r.ok),
      [true, true, true, false],
    );
    assert.deepEqual(
      results.map((r) => r.headers['RateLimit-Remaining']),
      ['2', '1', '0', '0'],
    );
    assert.equal(results[3].headers['Retry-After'], '2', '1 token at 0.5/s → 2 s');
  });

  it('refills continuously at refillPerSec', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
    const mw = rateLimit({ name: name(), capacity: 2, refillPerSec: 1 });
    await hit(mw, 'a');
    await hit(mw, 'a');
    assert.equal((await hit(mw, 'a')).ok, false);
    t.mock.timers.tick(999);
    assert.equal((await hit(mw, 'a')).ok, false, 'not yet a whole token');
    t.mock.timers.tick(2);
    assert.equal((await hit(mw, 'a')).ok, true, 'one token after 1 s');
    assert.equal((await hit(mw, 'a')).ok, false);
  });

  it('never refills above capacity', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 3_000_000 });
    const mw = rateLimit({ name: name(), capacity: 3, refillPerSec: 10 });
    await hit(mw, 'b');
    t.mock.timers.tick(3_600_000);
    const burst = [];
    for (let i = 0; i < 5; i++) burst.push((await hit(mw, 'b')).ok);
    assert.deepEqual(burst, [true, true, true, false, false]);
  });

  it('keeps separate buckets per IP, per session and per limiter name', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 4_000_000 });
    const n = name();
    const mw = rateLimit({ name: n, capacity: 1, refillPerSec: 0.001 });
    assert.equal((await hit(mw, 'ip1')).ok, true);
    assert.equal((await hit(mw, 'ip1')).ok, false);
    assert.equal((await hit(mw, 'ip2')).ok, true, 'other IP unaffected');
    const other = rateLimit({ name: name(), capacity: 1, refillPerSec: 0.001 });
    assert.equal((await hit(other, 'ip1')).ok, true, 'other limiter unaffected');
    // A session is limited on its own key as well as its IP.
    assert.equal((await hit(mw, 'ip3', 'sessA')).ok, true);
    assert.equal(
      (await hit(mw, 'ip4', 'sessA')).ok,
      false,
      'same session from a new IP is still limited',
    );
    assert.ok(limiterStats().some((s) => s.key === `${n}:sess:sessA`));
  });

  it('a throttled caller does not drain tokens while blocked', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
    const mw = rateLimit({ name: name(), capacity: 1, refillPerSec: 1 });
    await hit(mw, 'c');
    for (let i = 0; i < 10; i++) await hit(mw, 'c');
    t.mock.timers.tick(1000);
    assert.equal((await hit(mw, 'c')).ok, true);
  });
});
