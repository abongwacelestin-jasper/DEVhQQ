import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  MAX_SKEW_SECONDS,
  canonical,
  sign,
  signedHeaders,
  verifySignature,
} from '../../integrations/ml/signing.ts';

const TOKEN = 'ml-shared-secret-for-tests';
const NOW = 1_800_000_000_000;

/** Turns signedHeaders() output into the shape verifySignature() takes. */
function asInbound(h: Record<string, string>) {
  return {
    signature: h['X-DevHQ-Signature'],
    timestamp: h['X-DevHQ-Timestamp'],
    nonce: h['X-DevHQ-Nonce'],
  };
}

describe('integrations/ml/signing — canonical form and signature', () => {
  it('canonical string is v1, ts, nonce, METHOD, path, then the raw body', () => {
    assert.equal(
      canonical('1', 'n', 'post', '/v1/x?a=1', '{"b":2}'),
      'v1\n1\nn\nPOST\n/v1/x?a=1\n{"b":2}',
    );
    assert.equal(canonical('1', 'n', 'GET', '/h', ''), 'v1\n1\nn\nGET\n/h\n');
  });

  it('signature is v1=<hex HMAC-SHA256(token, canonical)> (cross-language reference value)', () => {
    const expected = createHmac('sha256', TOKEN)
      .update('v1\n1700000000\nabc\nPOST\n/v1/predict/task-eta\n{}')
      .digest('hex');
    assert.equal(
      sign(TOKEN, '1700000000', 'abc', 'post', '/v1/predict/task-eta', '{}'),
      `v1=${expected}`,
    );
    assert.match(sign(TOKEN, '1', 'n', 'GET', '/'), /^v1=[0-9a-f]{64}$/);
  });

  it('signedHeaders stamps unix seconds and a fresh 128-bit nonce', () => {
    const a = signedHeaders(TOKEN, 'POST', '/v1/x', '{}', NOW + 999);
    const b = signedHeaders(TOKEN, 'POST', '/v1/x', '{}', NOW + 999);
    assert.equal(a['X-DevHQ-Timestamp'], String(NOW / 1000));
    assert.match(a['X-DevHQ-Nonce'], /^[0-9a-f]{32}$/);
    assert.notEqual(a['X-DevHQ-Nonce'], b['X-DevHQ-Nonce']);
    assert.equal(
      a['X-DevHQ-Signature'],
      sign(TOKEN, a['X-DevHQ-Timestamp'], a['X-DevHQ-Nonce'], 'POST', '/v1/x', '{}'),
    );
  });
});

describe('integrations/ml/signing — verification', () => {
  it('accepts a freshly signed request once, then reports a replay', () => {
    const h = asInbound(signedHeaders(TOKEN, 'POST', '/v1/score', '{"a":1}', NOW));
    assert.equal(verifySignature(TOKEN, h, 'POST', '/v1/score', '{"a":1}', NOW), null);
    assert.equal(verifySignature(TOKEN, h, 'POST', '/v1/score', '{"a":1}', NOW + 1000), 'replayed');
  });

  it('enforces the 5-minute skew in both directions, inclusive at the limit', () => {
    assert.equal(MAX_SKEW_SECONDS, 300);
    const ts = NOW / 1000;
    for (const [offsetSec, want] of [
      [-300, null],
      [300, null],
      [-301, 'signature_expired'],
      [301, 'signature_expired'],
      [-86_400, 'signature_expired'],
    ] as const) {
      const h = asInbound(signedHeaders(TOKEN, 'GET', '/health', '', (ts + offsetSec) * 1000));
      assert.equal(
        verifySignature(TOKEN, h, 'GET', '/health', '', NOW),
        want,
        `offset ${offsetSec}s`,
      );
    }
  });

  it('uses the real clock by default (fake time)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const h = asInbound(signedHeaders(TOKEN, 'GET', '/health'));
    t.mock.timers.tick(299_000);
    assert.equal(verifySignature(TOKEN, h, 'GET', '/health', ''), null);
    const late = asInbound(signedHeaders(TOKEN, 'GET', '/health'));
    t.mock.timers.tick(301_000);
    assert.equal(verifySignature(TOKEN, late, 'GET', '/health', ''), 'signature_expired');
  });

  it('detects tampering with any signed part', () => {
    const body = '{"question":"eta?"}';
    const fresh = () =>
      asInbound(signedHeaders(TOKEN, 'POST', '/v1/assistant/answer?x=1', body, NOW));
    const cases: [string, (h: ReturnType<typeof fresh>) => string | null][] = [
      [
        'body',
        (h) => verifySignature(TOKEN, h, 'POST', '/v1/assistant/answer?x=1', `${body} `, NOW),
      ],
      ['method', (h) => verifySignature(TOKEN, h, 'PUT', '/v1/assistant/answer?x=1', body, NOW)],
      ['path', (h) => verifySignature(TOKEN, h, 'POST', '/v1/assistant/answer', body, NOW)],
      ['query', (h) => verifySignature(TOKEN, h, 'POST', '/v1/assistant/answer?x=2', body, NOW)],
      [
        'token',
        (h) => verifySignature('other-token', h, 'POST', '/v1/assistant/answer?x=1', body, NOW),
      ],
      [
        'nonce',
        (h) =>
          verifySignature(
            TOKEN,
            { ...h, nonce: `${h.nonce}0` },
            'POST',
            '/v1/assistant/answer?x=1',
            body,
            NOW,
          ),
      ],
      [
        'timestamp',
        (h) =>
          verifySignature(
            TOKEN,
            { ...h, timestamp: String(Number(h.timestamp) - 1) },
            'POST',
            '/v1/assistant/answer?x=1',
            body,
            NOW,
          ),
      ],
      [
        'signature byte',
        (h) => {
          const s = h.signature;
          const flipped = s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
          return verifySignature(
            TOKEN,
            { ...h, signature: flipped },
            'POST',
            '/v1/assistant/answer?x=1',
            body,
            NOW,
          );
        },
      ],
      [
        'truncated signature',
        (h) =>
          verifySignature(
            TOKEN,
            { ...h, signature: h.signature.slice(0, -2) },
            'POST',
            '/v1/assistant/answer?x=1',
            body,
            NOW,
          ),
      ],
      [
        'upper-case hex',
        (h) =>
          verifySignature(
            TOKEN,
            { ...h, signature: h.signature.toUpperCase() },
            'POST',
            '/v1/assistant/answer?x=1',
            body,
            NOW,
          ),
      ],
    ];
    for (const [name, run] of cases) assert.equal(run(fresh()), 'bad_signature', name);
  });

  it('method case is normalised on both sides', () => {
    const h = asInbound(signedHeaders(TOKEN, 'post', '/v1/x', '', NOW));
    assert.equal(verifySignature(TOKEN, h, 'POST', '/v1/x', '', NOW), null);
  });

  it('a request that failed verification does not burn its nonce', () => {
    const h = asInbound(signedHeaders(TOKEN, 'POST', '/v1/y', 'b', NOW));
    assert.equal(verifySignature(TOKEN, h, 'POST', '/v1/y', 'tampered', NOW), 'bad_signature');
    assert.equal(verifySignature(TOKEN, h, 'POST', '/v1/y', 'b', NOW), null);
  });

  it('missing or malformed headers are unauthenticated', () => {
    const h = asInbound(signedHeaders(TOKEN, 'GET', '/v1/z', '', NOW));
    const bad: Parameters<typeof verifySignature>[1][] = [
      {},
      { ...h, signature: undefined },
      { ...h, timestamp: undefined },
      { ...h, nonce: undefined },
      { ...h, nonce: '' },
      { ...h, timestamp: '1.5e9' },
      { ...h, timestamp: '-1' },
      { ...h, timestamp: '1234567890123' },
      { ...h, nonce: 'n'.repeat(65) },
    ];
    for (const x of bad)
      assert.equal(
        verifySignature(TOKEN, x, 'GET', '/v1/z', '', NOW),
        'unauthenticated',
        JSON.stringify(x),
      );
  });

  it('a replay is refused for as long as the signature itself is within skew', () => {
    const h = asInbound(signedHeaders(TOKEN, 'GET', '/v1/cache', '', NOW));
    assert.equal(verifySignature(TOKEN, h, 'GET', '/v1/cache', '', NOW), null);
    // While the signature is still within skew, a replay is always caught.
    assert.equal(verifySignature(TOKEN, h, 'GET', '/v1/cache', '', NOW + 300_000), 'replayed');
    // Later it is simply expired.
    assert.equal(
      verifySignature(TOKEN, h, 'GET', '/v1/cache', '', NOW + 301_000),
      'signature_expired',
    );
  });
});
