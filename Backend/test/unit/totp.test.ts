import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateTotpSecret, totpAt, totpUri, verifyTotp } from '../../auth/totp.ts';

/** RFC 6238 Appendix B shared secret "12345678901234567890" (SHA-1), base32-encoded. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/**
 * RFC 6238 Appendix B test vectors (SHA-1). The RFC prints 8 digits; a 6-digit
 * TOTP is the same truncated value mod 10^6, i.e. the last six digits.
 */
const VECTORS: [unixSeconds: number, eightDigits: string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('auth/totp — RFC 6238 vectors', () => {
  for (const [t, code8] of VECTORS) {
    it(`T=${t} → ${code8.slice(-6)}`, () => {
      const counter = Math.floor(t / 30);
      assert.equal(totpAt(RFC_SECRET, counter), code8.slice(-6));
      assert.equal(verifyTotp(RFC_SECRET, code8.slice(-6), -1, t * 1000), counter);
    });
  }

  it('decodes lower-case and padded base32 secrets identically', () => {
    assert.equal(totpAt(RFC_SECRET.toLowerCase(), 1), totpAt(RFC_SECRET, 1));
    assert.equal(totpAt(`${RFC_SECRET}====`, 1), totpAt(RFC_SECRET, 1));
  });

  it('throws on characters outside the base32 alphabet', () => {
    assert.throws(() => totpAt('GEZDGNBV1', 1), /Invalid base32/);
  });
});

describe('auth/totp — verification window', () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / 30);

  it('accepts the current step and ±1 step of drift, returning the matched counter', () => {
    for (const drift of [-1, 0, 1])
      assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + drift), -1, now), step + drift);
  });

  it('rejects codes two or more steps away', () => {
    for (const drift of [-3, -2, 2, 3]) {
      const code = totpAt(RFC_SECRET, step + drift);
      // Guard against an accidental collision with an in-window code.
      if ([-1, 0, 1].some((d) => totpAt(RFC_SECRET, step + d) === code)) continue;
      assert.equal(verifyTotp(RFC_SECRET, code, -1, now), null, `drift ${drift}`);
    }
  });

  it('rejects anything that is not exactly six digits, before any HMAC work', () => {
    const good = totpAt(RFC_SECRET, step);
    for (const bad of [
      '',
      '12345',
      '1234567',
      `${good} `,
      ` ${good}`,
      'abcdef',
      '12345a',
      '١٢٣٤٥٦',
    ])
      assert.equal(verifyTotp(RFC_SECRET, bad, -1, now), null, JSON.stringify(bad));
  });

  it('rejects a code from a different secret', () => {
    const other = generateTotpSecret();
    const code = totpAt(other, step);
    if ([-1, 0, 1].every((d) => totpAt(RFC_SECRET, step + d) !== code))
      assert.equal(verifyTotp(RFC_SECRET, code, -1, now), null);
  });
});

describe('auth/totp — replay protection', () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / 30);

  it('a used counter cannot be replayed', () => {
    const code = totpAt(RFC_SECRET, step);
    const used = verifyTotp(RFC_SECRET, code, -1, now);
    assert.equal(used, step);
    assert.equal(verifyTotp(RFC_SECRET, code, used!, now), null);
  });

  it('after using step N, codes for N-1 are dead but N+1 still works', () => {
    assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), step, now), null);
    assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), step, now), step + 1);
  });

  it('the same code stays rejected for the rest of the window', () => {
    const code = totpAt(RFC_SECRET, step);
    for (let ms = 0; ms < 60_000; ms += 5_000)
      assert.equal(verifyTotp(RFC_SECRET, code, step, now + ms), null);
  });
});

describe('auth/totp — secrets and URIs', () => {
  it('generates 160-bit base32 secrets', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = generateTotpSecret();
      assert.match(s, /^[A-Z2-7]{32}$/);
      seen.add(s);
    }
    assert.equal(seen.size, 50);
  });

  it('builds an otpauth URI with encoded label and issuer', () => {
    const uri = totpUri('ABC', 'ada@example.com', 'Dev HQ');
    assert.equal(
      uri,
      'otpauth://totp/Dev%20HQ%3Aada%40example.com?secret=ABC&issuer=Dev%20HQ&algorithm=SHA1&digits=6&period=30',
    );
  });
});
