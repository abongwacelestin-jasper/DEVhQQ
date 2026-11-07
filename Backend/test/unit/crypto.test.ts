import '../setup.ts';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../../config/env.ts';
import {
  dummyPasswordHash,
  hashPassword,
  hashToken,
  hmac,
  randomToken,
  safeEqual,
  signToken,
  verifyPassword,
  verifySignedToken,
} from '../../security/crypto.ts';

/** Builds a stored hash with chosen scrypt parameters, in the module's own format. */
function legacyHash(password: string, N: number) {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64, { N, r: 8, p: 1 });
  return ['scrypt-v1', N, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
}

describe('security/crypto — passwords', () => {
  it('hashes into the self-describing scrypt-v1 format with a random salt', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    const parts = a.split('$');
    assert.equal(parts.length, 6);
    assert.deepEqual(parts.slice(0, 4), ['scrypt-v1', String(2 ** 15), '8', '1']);
    assert.equal(Buffer.from(parts[4], 'base64url').length, 16, '16-byte salt');
    assert.equal(Buffer.from(parts[5], 'base64url').length, 64, '64-byte key');
    assert.notEqual(a, b, 'same password, different salt → different hash');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('s3cret-Passw0rd!');
    assert.deepEqual(await verifyPassword('s3cret-Passw0rd!', stored), {
      ok: true,
      needsRehash: false,
    });
    assert.deepEqual(await verifyPassword('s3cret-Passw0rd?', stored), {
      ok: false,
      needsRehash: false,
    });
    assert.deepEqual(await verifyPassword('', stored), { ok: false, needsRehash: false });
  });

  it('normalises Unicode (NFKC) so visually identical passwords match', async () => {
    const stored = await hashPassword('café'); // precomposed é
    assert.equal((await verifyPassword('café', stored)).ok, true); // e + combining accent
  });

  it('flags hashes made with a weaker cost for transparent rehash, only when correct', async () => {
    const weak = legacyHash('old-password', 2 ** 10);
    assert.deepEqual(await verifyPassword('old-password', weak), { ok: true, needsRehash: true });
    assert.deepEqual(await verifyPassword('wrong', weak), { ok: false, needsRehash: false });
  });

  it('rejects unknown KDFs and truncated records without throwing', async () => {
    const good = await hashPassword('x');
    for (const stored of [
      '',
      '!disabled',
      '!invited',
      good.replace('scrypt-v1', 'bcrypt'),
      good.split('$').slice(0, 5).join('$'),
      'scrypt-v1$$$$$',
    ]) {
      assert.deepEqual(
        await verifyPassword('x', stored),
        { ok: false, needsRehash: false },
        stored,
      );
    }
  });

  it('provides one cached dummy hash for timing equalisation', async () => {
    const a = await dummyPasswordHash();
    const b = await dummyPasswordHash();
    assert.equal(a, b);
    assert.match(a, /^scrypt-v1\$/);
    assert.equal((await verifyPassword('anything', a)).ok, false);
  });
});

describe('security/crypto — safeEqual', () => {
  it('compares strings and buffers by content', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual(Buffer.from('abc'), 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('', ''), true);
  });

  it('returns false (does not throw) for different lengths', () => {
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', 'a'), false);
    assert.equal(safeEqual(Buffer.alloc(32), Buffer.alloc(31)), false);
  });

  it('agrees with === on random inputs (property)', () => {
    for (let i = 0; i < 300; i++) {
      const a = randomBytes(i % 7).toString('hex');
      const b = i % 3 === 0 ? a : randomBytes(i % 7).toString('hex');
      assert.equal(safeEqual(a, b), a === b, `${a} vs ${b}`);
    }
  });
});

describe('security/crypto — tokens', () => {
  const originalPrev = config.sessionSecretPrevious;
  const originalSecret = config.sessionSecret;
  afterEach(() => {
    config.sessionSecretPrevious = originalPrev;
    config.sessionSecret = originalSecret;
  });

  it('randomToken yields url-safe strings of the requested entropy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = randomToken();
      assert.match(t, /^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    assert.equal(seen.size, 200);
    assert.equal(Buffer.from(randomToken(8), 'base64url').length, 8);
  });

  it('hashToken is SHA-256 hex and deterministic', () => {
    assert.equal(
      hashToken('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });

  it('hmac uses the configured algorithm and key', () => {
    const expected = createHmac(config.crypto.mac, config.sessionSecret)
      .update('v')
      .digest('base64url');
    assert.equal(hmac('v'), expected);
    assert.notEqual(hmac('v', 'other-key'), expected);
  });

  it('signs and verifies `<id>.<mac>` tokens', () => {
    const id = randomToken(32);
    const token = signToken(id);
    assert.equal(token.startsWith(`${id}.`), true);
    assert.equal(verifySignedToken(token), id);
  });

  it('keeps ids that contain dots intact (splits on the last dot)', () => {
    assert.equal(verifySignedToken(signToken('a.b.c')), 'a.b.c');
  });

  it('rejects tampered, truncated and malformed tokens', () => {
    const id = randomToken(32);
    const token = signToken(id);
    const mac = token.slice(id.length + 1);
    const flipped = mac[0] === 'A' ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
    for (const bad of [
      `${id}.${flipped}`,
      `${id}x.${mac}`,
      token.slice(0, -1),
      id,
      `.${mac}`,
      '',
      '.',
      `${id}.`,
    ])
      assert.equal(verifySignedToken(bad), null, bad);
  });

  it('accepts tokens signed with the previous key only while it is configured (rotation)', () => {
    const oldKey = 'old-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123';
    const id = randomToken(16);
    const oldToken = `${id}.${hmac(id, oldKey)}`;

    config.sessionSecretPrevious = undefined;
    assert.equal(verifySignedToken(oldToken), null, 'unknown key → rejected');

    config.sessionSecretPrevious = oldKey;
    assert.equal(verifySignedToken(oldToken), id, 'previous key accepted during rotation');
    assert.equal(verifySignedToken(signToken(id)), id, 'current key still accepted');

    config.sessionSecretPrevious = undefined;
    assert.equal(verifySignedToken(oldToken), null, 'rotation finished → old tokens die');
  });

  it('newly issued tokens always use the current key, never the previous one', () => {
    const oldKey = 'previous-key-for-rotation-test-0123456789abcdef0123456789abcdef';
    config.sessionSecretPrevious = oldKey;
    const id = 'abc';
    assert.equal(signToken(id), `${id}.${hmac(id, config.sessionSecret)}`);
    assert.notEqual(signToken(id), `${id}.${hmac(id, oldKey)}`);
  });
});
