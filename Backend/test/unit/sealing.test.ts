/**
 * Encryption at rest (security/crypto.ts seal/open) with key rotation, and the
 * CSP builders in security/headers.ts. This file pins DATA_ENCRYPTION_KEY and
 * one previous key before the app modules load, and re-implements the sealed
 * format independently so a value "sealed by an older deployment" is real.
 */
import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

const CURRENT = Buffer.alloc(32, 0x11);
const PREVIOUS = Buffer.alloc(32, 0x22);
const RETIRED = Buffer.alloc(32, 0x33);
process.env.DATA_ENCRYPTION_KEY = CURRENT.toString('hex');
process.env.DATA_ENCRYPTION_KEYS_PREVIOUS = PREVIOUS.toString('hex');

type Crypto = typeof import('../../security/crypto.ts');
type Headers = typeof import('../../security/headers.ts');
let c: Crypto;
let h: Headers;
before(async () => {
  c = await import('../../security/crypto.ts');
  h = await import('../../security/headers.ts');
});

const keyId = (k: Buffer) =>
  createHash('sha256')
    .update('devhq-data-key-id:')
    .update(k)
    .digest()
    .subarray(0, 8)
    .toString('base64url');

/** Independent implementation of `enc:v1:<keyId>:<iv>:<ct>:<tag>`. */
function sealWith(key: Buffer, plaintext: string, context: string) {
  const id = keyId(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`devhq:enc:v1:${id}:${context}`));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `enc:v1:${id}:${iv.toString('base64url')}:${ct.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
}

function decryptFails(fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof c.DecryptionError && e.name === 'DecryptionError');
}

describe('security/crypto — seal/open (AES-256-GCM)', () => {
  it('round-trips text, including empty and non-ASCII, with a fresh IV each time', () => {
    for (const text of ['JBSWY3DPEHPK3PXP', '', 'ünïcødé ✓ 🔐', 'x'.repeat(10_000)]) {
      const a = c.seal(text, 'member:m4:totp');
      const b = c.seal(text, 'member:m4:totp');
      assert.notEqual(a, b, 'random IV');
      assert.ok(c.isSealed(a));
      assert.ok(!a.includes(text) || text === '', 'no plaintext in the envelope');
      assert.equal(c.open(a, 'member:m4:totp'), text);
    }
  });

  it('uses the configured current key and matches the documented format', () => {
    const s = c.seal('v', 'ctx');
    assert.equal(c.dataKeyId(), keyId(CURRENT));
    assert.match(s, new RegExp(`^enc:v1:${keyId(CURRENT)}:[\\w-]{16}:[\\w-]*:[\\w-]{22}$`));
    // The independent implementation produces values the module can open.
    assert.equal(c.open(sealWith(CURRENT, 'mine', 'ctx'), 'ctx'), 'mine');
  });

  it('binds the ciphertext to its context (copying it to another row fails)', () => {
    const s = c.seal('secret', 'member:m4:totp');
    decryptFails(() => c.open(s, 'member:m5:totp'));
    decryptFails(() => c.open(s, 'member:m4:totp '));
  });

  it('detects any tampering with iv, ciphertext, tag or key id', () => {
    const s = c.seal('secret-value', 'ctx');
    const [, , id, iv, ct, tag] = s.split(':');
    const flip = (b64: string) => {
      const b = Buffer.from(b64, 'base64url');
      b[0] ^= 0x01;
      return b.toString('base64url');
    };
    for (const bad of [
      `enc:v1:${id}:${flip(iv)}:${ct}:${tag}`,
      `enc:v1:${id}:${iv}:${flip(ct)}:${tag}`,
      `enc:v1:${id}:${iv}:${ct}:${flip(tag)}`,
      `enc:v1:${keyId(PREVIOUS)}:${iv}:${ct}:${tag}`,
    ])
      decryptFails(() => c.open(bad, 'ctx'));
  });

  it('rejects malformed envelopes and unknown keys without leaking partial plaintext', () => {
    const s = c.seal('x', 'ctx');
    const [, , id, iv, ct, tag] = s.split(':');
    for (const bad of [
      'plain text',
      'enc:v1:',
      `enc:v1:${id}:${iv}:${ct}`,
      `enc:v1:${id}:${iv}:${ct}:${tag}:extra`,
      `enc:v1:${id}:${Buffer.alloc(8).toString('base64url')}:${ct}:${tag}`,
      `enc:v1:${id}:${iv}:${ct}:${Buffer.alloc(8).toString('base64url')}`,
      sealWith(RETIRED, 'old', 'ctx'),
    ])
      decryptFails(() => c.open(bad, 'ctx'));
  });

  it('refuses to seal without a context', () => {
    assert.throws(() => c.seal('x', ''), /context/);
  });

  it('opens values sealed under a previous key and re-seals them under the current one', () => {
    const old = sealWith(PREVIOUS, 'rotated', 'member:m1:totp');
    assert.equal(c.open(old, 'member:m1:totp'), 'rotated');
    assert.equal(c.needsReseal(old), true);
    const fresh = c.reseal(old, 'member:m1:totp');
    assert.ok(fresh.startsWith(`enc:v1:${keyId(CURRENT)}:`));
    assert.equal(c.open(fresh, 'member:m1:totp'), 'rotated');
    assert.equal(c.needsReseal(fresh), false);
    assert.equal(c.reseal(fresh, 'member:m1:totp'), fresh, 'current values are left alone');
  });

  it('migrates legacy plaintext on reseal', () => {
    assert.equal(c.isSealed('JBSWY3DP'), false);
    assert.equal(c.isSealed(undefined), false);
    assert.equal(c.needsReseal('JBSWY3DP'), true);
    const sealed = c.reseal('JBSWY3DP', 'member:m2:totp');
    assert.equal(c.open(sealed, 'member:m2:totp'), 'JBSWY3DP');
  });
});

describe('security/headers — CSP builders and nonce', () => {
  it('the SPA CSP is nonce + strict-dynamic, with no unsafe script sources', () => {
    const csp = h.buildCsp('abc123');
    const directives = new Map(
      csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)] as const),
    );
    assert.deepEqual(directives.get('script-src')?.slice(0, 2), [
      "'nonce-abc123'",
      "'strict-dynamic'",
    ]);
    assert.ok(!directives.get('script-src')?.some((s) => /unsafe-(inline|eval)/.test(s)));
    for (const [d, v] of [
      ['script-src-attr', "'none'"],
      ['object-src', "'none'"],
      ['base-uri', "'none'"],
      ['frame-ancestors', "'none'"],
    ] as const)
      assert.deepEqual(directives.get(d), [v], d);
  });

  it('the console CSP allows only its nonce for scripts and nothing for forms or frames', () => {
    const csp = h.consoleCsp('n0nce');
    assert.match(csp, /script-src 'nonce-n0nce'(;|$)/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /frame-src 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  });

  it('the API CSP denies everything', () => {
    assert.equal(
      h.API_CSP,
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  it('cspNonce is stable per response and unique across responses', () => {
    const a = {} as ServerResponse;
    const b = {} as ServerResponse;
    const n = h.cspNonce(a);
    assert.equal(h.cspNonce(a), n);
    assert.notEqual(h.cspNonce(b), n);
    assert.equal(Buffer.from(n, 'base64').length, 16);
  });

  it('Permissions-Policy denies powerful features and allows passkeys on self only', () => {
    for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()'])
      assert.ok(h.PERMISSIONS_POLICY.includes(f), f);
    assert.ok(h.PERMISSIONS_POLICY.includes('publickey-credentials-get=(self)'));
  });
});
